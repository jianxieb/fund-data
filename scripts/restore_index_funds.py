#!/usr/bin/env python3
"""Restore reviewed index exposures with full NAV histories, independent of equity screens."""
import argparse
import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from screens import fund_screen as F
import update as U


def build_product(product, refresh=False):
    code = product['code']
    basic = F.basic_fetch(code, refresh=refresh)
    if not basic or not basic.get('index_name') or 'ETF' not in basic.get('name', ''):
        raise ValueError(code + ' 缺指数名称或ETF身份')
    if basic['name'] != product['expectedName']:
        raise ValueError(code + ' 产品名称与已复核目录不一致：' + basic['name'])
    rows = U.history_fetch(code)
    metrics = F.deep_metrics(rows)
    if not metrics or metrics['latest'] < '2026-09-28':
        raise ValueError(code + ' 缺当前完整净值历史')
    nav = F.latest_nav_observation(rows, metrics['latest'])
    if not nav:
        raise ValueError(code + ' 缺收益截止日对应的唯一净值')
    fees = F.fee_info(F.jjfl_page(code, refresh=refresh))
    if fees.get('fee_m') is None or fees.get('fee_c') is None:
        raise ValueError(code + ' 缺管理费或托管费')
    checked = datetime.now(timezone.utc).isoformat()
    returns = [metrics.get('ret%d' % y) for y in (1, 2, 3, 5, 10)]
    periods = [p for p in metrics['periods'] if p['years'] in (1, 2, 3, 5, 10)]
    scale, scale_date = F.dated_value((fees.get('sz'), fees.get('szdate')),
        (F.fnum(basic.get('scale')) / 1e8 if F.fnum(basic.get('scale')) else None, basic.get('scale_date')))
    source = 'https://fundf10.eastmoney.com/jjjz_%s.html' % code
    fee_source = 'https://fundf10.eastmoney.com/jjfl_%s.html' % code
    row = dict(g='x4', c=code, n=basic['name'], t='场内ETF', ix=basic['index_name'],
        d=basic['estab'][:10], fee=[fees.get(k) for k in ('fee_m', 'fee_c', 'fee_s')],
        r=returns, returnAsOf=metrics['latest'], riskAsOf=metrics['latest'],
        returnFirst=metrics['first'], riskFirst=metrics['first'], returnPeriods=periods,
        mdd5=metrics.get('mdd5'), vol5=metrics.get('vol5'), sz=scale, szdate=scale_date,
        **nav, mgr=basic.get('managers') or '', basis=metrics['basis'],
        returnSource='Eastmoney历史净值与公司行为', returnSourceUrl=source,
        feeSource=fee_source, feeCheckedAt=checked, performanceVerifiedAt=checked,
        indexCode=basic.get('index_code'), indexCoverageReviewedAt='2026-09-30')
    row.update(U.manager_fetch(code, refresh=refresh))
    evidence = dict(code=code, name=row['n'], sourceUrl=source, feeSource=fee_source,
        asof=metrics['latest'], first=metrics['first'], rows=len(rows), metricRows=metrics['rows'],
        basis=metrics['basis'], r=returns, mdd5=row['mdd5'], vol5=row['vol5'], returnPeriods=periods,
        fees=row['fee'], checkedAt=checked, navObservation=nav, navSyncStatus='matched_return_endpoint',
        comparisonStatus='initial_full_history', comparisonNote='首次补齐，未声称旧快照收益已重演',
        rawHistorySha256=hashlib.sha256((Path(U.HIST_DIR) / (code + '.json')).read_bytes()).hexdigest())
    return row, evidence


def sync_managers(products):
    changes, failures = {}, {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {p['code']: pool.submit(U.manager_fetch, p['code']) for p in products}
        for code, future in futures.items():
            result = future.result()
            if result.get('managerRecords'):
                changes[code] = result
            else:
                failures[code] = '缺明确个人经理上任日，保留原始状态'
    if changes:
        F.write_extra_fields(changes)
    path = ROOT / 'data/screening-manager-validation.json'
    audit = json.loads(path.read_text()) if path.exists() else {'records': {}}
    audit.setdefault('records', {}).update({c: {k: v for k, v in r.items() if k.startswith('manager')}
                                           for c, r in changes.items()})
    audit['indexCoverageCheckedAt'] = datetime.now(timezone.utc).isoformat()
    audit['indexCoverageRequested'] = len(products)
    audit['indexCoverageChecked'] = len(changes)
    audit['indexCoverageFailures'] = failures
    path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    print('个人经理资料', len(changes), '/', len(products), '缺证据', failures, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--managers-only', action='store_true')
    args = parser.parse_args()
    F.ensure_dirs()
    Path(F.JJFL_DIR).mkdir(exist_ok=True)
    catalog = json.loads((ROOT / 'data/index-fund-catalog.json').read_text())
    if args.managers_only:
        sync_managers(catalog['products'])
        return
    old = {r['c']: r for r in F.parse_snapshot_extra()}
    evidence_path = ROOT / 'data/screening-validation.json'
    previous = {r['code']: r for r in json.loads(evidence_path.read_text())}
    targets = [p for p in catalog['products'] if args.refresh or p['code'] not in previous]
    results, failures = {}, {}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {p['code']: pool.submit(build_product, p, args.refresh) for p in targets}
        for code, future in futures.items():
            try:
                results[code] = future.result()
                print('✓', code, results[code][0]['n'], results[code][0]['returnAsOf'], flush=True)
            except Exception as exc:
                failures[code] = str(exc)
                print('缺证据', code, str(exc), flush=True)
    if failures:
        raise RuntimeError('目录补齐未完成，已发布数据未写入：' + json.dumps(failures, ensure_ascii=False))
    changes = {c: row for c, (row, _evidence) in results.items() if c in old}
    if changes:
        F.write_extra_fields(changes)
    src = (ROOT / 'data/snapshot.js').read_text()
    block = re.search(r'var EXTRA=\[(.*?)\n\];', src, re.S)
    if not block:
        raise ValueError('EXTRA 数据标记缺失')
    additions = [row for c, (row, _evidence) in results.items() if c not in old]
    lines = ['{' + ','.join(key + ':' + (F.js_str(value) if isinstance(value, str)
        else json.dumps(value, ensure_ascii=False, separators=(',', ':'))) for key, value in row.items()) + '},' for row in additions]
    if lines:
        src = src[:block.end(1)] + '\n' + '\n'.join(lines) + src[block.end(1):]
        (ROOT / 'data/snapshot.js').write_text(src)
    previous.update({c: evidence for c, (_row, evidence) in results.items()})
    evidence_path.write_text(json.dumps(list(previous.values()), ensure_ascii=False, indent=2) + '\n')
    F.cmd_policy(args)
    print('目录', len(catalog['products']), '只；新增', len(additions), '；核验', len(results), flush=True)


if __name__ == '__main__':
    main()
