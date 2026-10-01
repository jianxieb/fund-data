#!/usr/bin/env python3
"""Reconcile RMB overseas equity index funds against the current fund registry."""
import argparse
import hashlib
import json
import re
import sys
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from screens import fund_screen as F
import update as U

CATALOG = ROOT / 'data/crossborder-fund-catalog.json'
VALIDATION = ROOT / 'data/screening-validation.json'


def registry_candidates(registry):
    # Currency classes are distinct products. This view compares RMB investments;
    # USD/cash/remittance classes and enhanced mandates are separate exposures.
    return [dict(code=r[0], expectedName=r[2], registryType=r[3]) for r in registry
            if r[3] == '指数型-海外股票'
            and not re.search('美元|美汇|美钞|现汇|现钞|日元|欧元|港币|增强', r[2])]


def index_identity(basic):
    name, code = basic['index_name'], basic.get('index_code') or ''
    text = basic['name'] + ' ' + name
    if code == 'SP500EWTR' or re.fullmatch('S&P 500 EQUAL WEIGHTED TOTAL RETURN', name, re.I):
        label = '标普500等权重'
    elif re.search('纳斯达克100|纳指100|NDX100', text) or code in ('NDX', 'NDX100'):
        label = '纳斯达克100'
    elif re.search('标普500', text) and not re.search('信息|医疗|生物|消费|能源|等权', text):
        label = '标普500'
    elif re.search('纳斯达克科技|纳指科技', text):
        label = '纳斯达克科技'
    elif re.search('纳斯达克生物|纳指生物', text):
        label = '纳斯达克生物科技'
    elif re.search('恒生科技', text):
        label = '恒生科技'
    elif re.search('日经225|日经ETF', text):
        label = '日经225'
    else:
        label = name
    if re.search('恒生|香港|港股|H股|中概|海外中国|香港小型|中国(?:互联网|新经济|教育)', text):
        region = '港股与中概'
    elif re.search('日本|日经|东证|东京', text):
        region = '日本'
    elif re.search('德国|DAX|法国|CAC|富时100|FTSE 100', text, re.I):
        region = '欧洲'
    elif re.search('沙特|巴西|新兴亚洲|东南亚|亚太|中韩|中美', text):
        region = '其他与跨区域'
    elif re.search('全球|发达市场|环球', text):
        region = '全球'
    else:
        region = '美国'
    return dict(ix=label, trackedIndexName=name, indexCode=code, crossborderIndex=True,
                crossborderRegion=region, indexCoverageReviewedAt=date.today().isoformat())


def product_channel(basic):
    name = basic['name']
    if 'ETF' in name and '联接' not in name:
        return '场内ETF'
    share = re.search(r'([ACDEFHI])(?:人民币|\(人民币\))?$', name)
    return '场外' + (share.group(1) if share else '')


def purchase_fee(basic, code):
    values = [basic.get(k) or '' for k in ('fee_src', 'fee_now')]
    if product_channel(basic) == '场内ETF' or not all(re.fullmatch(r'\d+(?:\.\d+)?%', v) for v in values):
        return {}
    source = F.BASIC_API + '?' + urllib.parse.urlencode(dict(FCODE=code, deviceid='1', plat='Android',
        product='EFund', version='6.3.8', appType='ttjj', Uid=''))
    return dict(buy='/'.join(values), buyFeeSourceUrl=source, buyFeeCheckedAt=basic.get('fetchedAt'))


def build_product(product):
    code = product['code']
    basic = F.basic_fetch(code)
    if not basic or not basic.get('index_name') or basic.get('ftype') != '指数型-海外股票':
        raise ValueError('缺明确的海外股票指数基金身份或跟踪指数')
    if basic['name'] != product['expectedName']:
        raise ValueError('登记名称与基金基本资料不一致：' + basic['name'])
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', basic.get('estab') or '') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', basic.get('navdate') or ''):
        raise ValueError('尚未披露成立日或单位净值；登记发行日：' + (basic.get('issbdate') or '未披露')[:10])
    rows = U.history_fetch(code)
    metrics = F.deep_metrics(rows)
    cutoff = (date.today() - timedelta(days=10)).isoformat()
    if not metrics or metrics['latest'] < cutoff:
        raise ValueError('缺近10日内的有效净值及连续历史')
    nav = F.latest_nav_observation(rows, metrics['latest'])
    if not nav:
        raise ValueError('缺收益截至日对应的唯一净值')
    fees = F.fee_info(F.jjfl_page(code))
    if fees.get('fee_m') is None or fees.get('fee_c') is None:
        raise ValueError('缺管理费或托管费来源')
    channel = product_channel(basic)
    checked = datetime.now(timezone.utc).isoformat()
    returns = [metrics.get('ret%d' % y) for y in (1, 2, 3, 5, 10)]
    periods = [p for p in metrics['periods'] if p['years'] in (1, 2, 3, 5, 10)]
    scale, scale_date = F.dated_value((fees.get('sz'), fees.get('szdate')),
        (F.fnum(basic.get('scale')) / 1e8 if F.fnum(basic.get('scale')) else None, basic.get('scale_date')))
    source = 'https://fundf10.eastmoney.com/jjjz_%s.html' % code
    fee_source = 'https://fundf10.eastmoney.com/jjfl_%s.html' % code
    row = dict(g='x4', c=code, n=basic['name'], t=channel, d=basic['estab'][:10],
        fee=[fees.get(k) for k in ('fee_m', 'fee_c', 'fee_s')],
        r=returns, returnAsOf=metrics['latest'], riskAsOf=metrics['latest'],
        returnFirst=metrics['first'], riskFirst=metrics['first'], returnPeriods=periods,
        mdd5=metrics.get('mdd5'), vol5=metrics.get('vol5'), sz=scale, szdate=scale_date,
        **nav, mgr=basic.get('managers') or '', basis=metrics['basis'],
        returnSource='Eastmoney历史净值与公司行为', returnSourceUrl=source,
        feeSource=fee_source, feeCheckedAt=checked, performanceVerifiedAt=checked,
        **index_identity(basic))
    row.update(purchase_fee(basic, code))
    for key in ('st', 'lm', 'fb', 'rd', 'price', 'prem', 'quotedAt', 'priceAsOf'):
        if key in fees:
            row[key] = fees[key]
    evidence = dict(code=code, name=row['n'], sourceUrl=source, feeSource=fee_source,
        asof=metrics['latest'], first=metrics['first'], rows=len(rows), metricRows=metrics['rows'],
        basis=metrics['basis'], r=returns, mdd5=row['mdd5'], vol5=row['vol5'], returnPeriods=periods,
        fees=row['fee'], checkedAt=checked, navObservation=nav, navSyncStatus='matched_return_endpoint',
        comparisonStatus='initial_full_history', comparisonNote='目录补齐并复算实际净值历史',
        rawHistorySha256=hashlib.sha256((Path(U.HIST_DIR) / (code + '.json')).read_bytes()).hexdigest())
    return row, evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, help='parsed fundcode_search.js array')
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    F.ensure_dirs()
    Path(F.JJFL_DIR).mkdir(exist_ok=True)
    if args.registry:
        raw = args.registry.read_bytes()
        catalog = dict(schemaVersion=1, checkedAt=datetime.now(timezone.utc).isoformat(),
            source='https://fund.eastmoney.com/js/fundcode_search.js',
            registrySha256=hashlib.sha256(raw).hexdigest(),
            scope='人民币份额、海外股票指数型；含ETF、联接、LOF申购及各份额，不按历史收益筛掉指数',
            products=registry_candidates(json.loads(raw)))
    else:
        catalog = json.loads(CATALOG.read_text())
    src = (ROOT / 'data/snapshot.js').read_text()
    original = {code for _, code, _ in U.parse_fund_lines(src)}
    old = {r['c']: r for r in F.parse_snapshot_extra()}
    previous = {r['code']: r for r in json.loads(VALIDATION.read_text())}
    targets = [p for p in catalog['products'] if p['code'] not in original
               and (p['code'] not in previous or p['code'] not in old)]
    results, failures = {}, {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(build_product, p): p for p in targets}
        for future in as_completed(futures):
            p = futures[future]
            try:
                results[p['code']] = future.result()
                print('✓', p['code'], p['expectedName'], results[p['code']][0]['returnAsOf'], flush=True)
            except Exception as exc:
                failures[p['code']] = str(exc)
                print('缺证据', p['code'], p['expectedName'], str(exc), flush=True)
    # A coverage audit distinguishes source failures from rejected mandates. Never
    # display a missing series as zero, and never drop a previously verified row.
    catalog['coverage'] = dict(existing=len(set(p['code'] for p in catalog['products']) & (original | set(previous))),
        added=len(results), missingEvidence=failures)
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    changes = {c: row for c, (row, _) in results.items() if c in old}
    for p in catalog['products']:
        c = p['code']
        if c in old and c not in changes:
            basic = F.basic_fetch(c)
            if basic and basic.get('index_name'):
                changes[c] = {**index_identity(basic), 't': product_channel(basic), **purchase_fee(basic, c)}
    if changes:
        F.write_extra_fields(changes)
    src = (ROOT / 'data/snapshot.js').read_text()
    block = re.search(r'var EXTRA=\[(.*?)\n\];', src, re.S)
    if not block:
        raise ValueError('EXTRA 数据标记缺失')
    additions = [row for c, (row, _) in sorted(results.items()) if c not in old]
    lines = ['{' + ','.join(key + ':' + (F.js_str(value) if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, separators=(',', ':'))) for key, value in row.items()) + '},' for row in additions]
    if lines:
        src = src[:block.end(1)] + '\n' + '\n'.join(lines) + src[block.end(1):]
        (ROOT / 'data/snapshot.js').write_text(src)
    previous.update({c: evidence for c, (_, evidence) in results.items()})
    VALIDATION.write_text(json.dumps(list(previous.values()), ensure_ascii=False, indent=2) + '\n')
    F.cmd_policy(args)
    print('跨境目录', len(catalog['products']), '只；新增', len(additions), '；缺证据', len(failures), flush=True)


if __name__ == '__main__':
    main()
