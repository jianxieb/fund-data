#!/usr/bin/env python3
"""Publish verified daily histories for every tracked investable research object."""
import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import strategy_backtest
import update
from data_status import atomic_text, now_iso, write_status

OUTPUT = ROOT / 'data' / 'portfolio'
END = (datetime.now(ZoneInfo('Asia/Shanghai')).date() - timedelta(days=1)).isoformat()


def universe():
    # Use the same identity merge and ETF classification as the research UI.
    script = """
const fs=require('fs'),vm=require('vm'),M=require('./assets/model.js');
const s={};vm.createContext(s);vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),s);
const funds=M.dedupeFunds(s.FUNDS,s.EXTRA).map(f=>({
 id:'fund:'+f.c,code:f.c,name:f.n,kind:f.exchange?'etf':'fund',market:'cn',currency:'CNY',
 category:f.ix||f.asset||'基金',exchange:!!f.exchange,fee:f.fee||null,feesEmbedded:true,
 sourceUrl:f.returnSourceUrl||'https://fundf10.eastmoney.com/jjjz_'+f.c+'.html',
 inception:f.d||null,subscriptionStatus:f.st||null}));
const stocks=(s.STOCKS||[]).map(f=>({id:'stock:'+f.c,code:f.c,name:f.n,kind:'stock',
 market:'cn',currency:'CNY',category:f.businessLabel||f.ind||'个股',board:M.stockBoard(f.c),
 sourceUrl:f.sourceUrl||'https://finance.yahoo.com/quote/'+f.c+( /^[5689]/.test(f.c)?'.SS':'.SZ')+'/history/'}));
const us=(s.BM||[]).filter(f=>f.symbol&&f.feesEmbedded).map(f=>({
 id:'us:'+f.symbol,code:f.symbol,name:f.symbol+' · '+(f.label||f.category||f.n),kind:'etf',
 market:'us',currency:'USD',category:f.category,style:f.style,leverage:f.leverage,
 expenseRatio:f.expenseRatio,feeAddbackRate:f.feeAddbackRate,feesEmbedded:true,
 sourceUrl:f.sourceUrl,inception:f.inception,distribution:f.distribution}));
process.stdout.write(JSON.stringify([...us,...stocks,...funds]));
"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, check=True)
    rows = json.loads(result.stdout)
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError('组合标的身份重复')
    return rows


def fund_request(code, size):
    url = ('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=%s&pageIndex=1&pageSize=%s'
           '&startDate=&endDate=&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1' % (code, size))
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=18) as response:
        payload = json.load(response)
    rows = payload.get('Datas')
    if not isinstance(rows, list) or not rows:
        raise ValueError('历史净值接口未返回记录（%s）' % payload.get('ErrCode', '空结果'))
    if any(not isinstance(row, dict) or not row.get('FSRQ') or not row.get('DWJZ') for row in rows):
        raise ValueError('历史净值接口结构不完整')
    return rows


def supplement_published_growth(code, rows, offline=False):
    """Fill only missing rates using the same provider's explicitly published trend.

    Historical interim NAV observations (NAVTYPE=0) can lack API growth rates.
    A matching NAV and explicit equityReturn, including zero, provides evidence;
    guessing zero or taking a cumulative-NAV ratio does not.
    """
    if all(update.finite_number(row.get('JZZZL')) is not None for row in rows[1:]):
        return rows
    path = ROOT / '.tmp-portfolio' / 'fund-trend' / (code + '.json')
    url = 'https://fund.eastmoney.com/pingzhongdata/' + code + '.js'
    try:
        trend = json.loads(path.read_text(encoding='utf-8'))
        if trend.get('code') != code or trend.get('sourceUrl') != url:
            trend = None
    except (OSError, ValueError):
        trend = None
    missing_days = {row['FSRQ'] for row in rows if update.finite_number(row.get('JZZZL')) is None}
    if trend and not offline:
        covered_days = {datetime.fromtimestamp(p['x'] / 1000, ZoneInfo('Asia/Shanghai')).date().isoformat() for p in trend['points']}
        if missing_days - covered_days:
            trend = None
    if trend is None and not offline:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=18) as response:
            source = response.read().decode('utf-8')
        identity = re.search(r'var\s+fS_code\s*=\s*[\"\'](\d{6})[\"\']', source)
        match = re.search(r'var\s+Data_netWorthTrend\s*=\s*(\[.*?\]);', source, re.S)
        if not identity or identity.group(1) != code or not match:
            raise ValueError('净值走势补充来源未通过基金身份核对')
        points = json.loads(match.group(1))
        trend = {'code': code, 'sourceUrl': url, 'points': points, 'fetchedAt': now_iso()}
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_text(path, json.dumps(trend, ensure_ascii=False, allow_nan=False))
    if not trend:
        return rows
    china = ZoneInfo('Asia/Shanghai')
    points = {datetime.fromtimestamp(p['x'] / 1000, china).date().isoformat(): p for p in trend['points']}
    output = []
    for row in rows:
        copy = dict(row)
        if update.finite_number(row.get('JZZZL')) is None:
            point = points.get(row['FSRQ'])
            nav = update.finite_number(row.get('DWJZ'))
            rate = update.finite_number(point.get('equityReturn')) if point else None
            if point and nav is not None and abs(nav - point.get('y', -1)) < 1e-8 and rate is not None:
                copy.update(JZZZL=rate, JZZZL_SOURCE=url)
        output.append(copy)
    return output


def fund_history(asset, offline=False, refresh=False):
    path = ROOT / '.tmp-hist' / (asset['code'] + '.json')
    try:
        cached = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(cached, list):
            cached = []
    except (OSError, ValueError):
        cached = []
    warning = None
    if not offline and (refresh or not cached):
        try:
            latest = fund_request(asset['code'], 20 if cached else 10000)
            old = {row['FSRQ']: row for row in cached}
            if cached and min(row['FSRQ'] for row in latest) > max(old):
                latest = fund_request(asset['code'], 10000)
            # Keep explicit archived actions when a fresh API row lacks them.
            for row in latest:
                previous = old.get(row['FSRQ'], {})
                old[row['FSRQ']] = {**previous, **row}
                for key in ('FHFCZ', 'SPLIT_FACTOR', 'ACTIONS_SOURCE', 'ACTIONS_ASOF'):
                    if previous.get(key) is not None and key not in row:
                        old[row['FSRQ']][key] = previous[key]
            cached = sorted(old.values(), key=lambda row: row['FSRQ'], reverse=True)
            path.parent.mkdir(exist_ok=True)
            atomic_text(path, json.dumps(cached, ensure_ascii=False, allow_nan=False))
        except (OSError, ValueError, TypeError) as exc:
            warning = '本次历史接口未更新：' + str(exc)[:150]
    if not cached:
        raise ValueError(warning or '缺每日净值历史；离线缓存未收录')
    rows = [row for row in cached if row.get('FSRQ', '') <= END]
    rows = supplement_published_growth(asset['code'], rows, offline)
    # This shared implementation handles cash distributions and splits. It never
    # pretends cumulative NAV is a reinvested total-return series.
    try:
        series = update.total_return_series(rows)
    except ValueError as exc:
        # Preserve the provable continuous tail when an older interval is missing
        # daily growth or has a suspended-publication gap. The catalog records the
        # actual later start, so this never masquerades as a full 10-year history.
        if not any(label in str(exc) for label in ('缺少每日收益', '超过21日的缺口', '无效单位净值')):
            raise
        ordered = sorted(rows, key=lambda row: row['FSRQ'])
        resets = [i for i, row in enumerate(ordered) if i and
                  (update.finite_number(row.get('JZZZL')) is None and update.finite_number(row.get('FHFCZ')) is None
                   or (datetime.fromisoformat(row['FSRQ']) - datetime.fromisoformat(ordered[i - 1]['FSRQ'])).days > 21)]
        resets += [i + 1 for i, row in enumerate(ordered) if not (update.finite_number(row.get('DWJZ')) or 0) > 0]
        if not resets:
            raise
        series = update.total_return_series(ordered[max(resets):])
        warning = '早期净值、每日收益或连续历史不完整，仅使用自 ' + series[0][0] + ' 起的已核对历史'
    return series, 'provider_daily_return_or_explicit_actions', asset['sourceUrl'], warning


def stock_history(asset, offline=False, refresh=False):
    path = ROOT / '.tmp-snap' / 'stocks' / (asset['code'] + '.json')
    suffix = '.SS' if asset['code'][0] in '5689' else '.SZ'
    symbol = asset['code'] + suffix
    try:
        cached = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cached = None
    if not cached:
        if offline:
            raise ValueError('缺含分红复权股价；离线缓存未收录')
        import stock_screen
        observation = stock_screen.yahoo_stock(asset['code'])
        if not observation.get('series'):
            raise ValueError('含分红复权股价接口未返回记录')
        cached = json.loads(path.read_text(encoding='utf-8'))
    meta = cached.get('meta') or {}
    if meta.get('symbol') != symbol or meta.get('currency') != 'CNY' or cached.get('basis') != 'yahoo_adjusted_close':
        raise ValueError('个股缓存的身份、币种或复权口径未通过核对')
    return cached.get('series') or [], 'provider_adjusted_close', cached.get('sourceUrl') or asset['sourceUrl'], None


def overseas_history(symbol, offline=False):
    series = strategy_backtest.load_history(symbol, offline=offline)
    path = Path(strategy_backtest.cache_path(symbol))
    cached = json.loads(path.read_text(encoding='utf-8'))
    expected = 'CNY' if symbol == 'CNY=X' else 'USD'
    if cached.get('currency') != expected or cached.get('symbol') != symbol:
        raise ValueError('海外行情缓存的身份或币种未通过核对')
    return sorted(series.items()), 'provider_adjusted_close', cached.get('source'), None


def validate_series(series, end=END):
    valid = []
    previous = None
    for day, value in series:
        datetime.strptime(day, '%Y-%m-%d')
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError('无效历史值：' + day)
        if previous and day <= previous:
            raise ValueError('历史日期重复或逆序：' + day)
        previous = day
        if day <= end:
            valid.append([day, float(format(value, '.12g'))])
    if len(valid) < 2:
        raise ValueError('可用每日历史不足两条')
    return valid


def publish_history(asset, series, basis, source, warning=None):
    series = validate_series(series)
    body = {'schemaVersion': 1, 'id': asset['id'], 'currency': asset['currency'],
            'basis': basis, 'dividends': 'reinvested', 'first': series[0][0],
            'asOf': series[-1][0], 'sourceUrl': source, 'series': series}
    encoded = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n'
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    namespace, code = asset['id'].split(':')
    relative = '%s/%s-%s.json' % (namespace, code, digest[:16])
    destination = OUTPUT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        atomic_text(destination, encoded)
    result = {**asset, 'status': 'available', 'basis': basis, 'first': body['first'],
              'asOf': body['asOf'], 'observations': len(series),
              'historyUrl': 'data/portfolio/' + relative, 'sha256': digest}
    if warning:
        result['refreshWarning'] = warning
    return result


def build_asset(asset, offline=False, refresh=False):
    try:
        if asset['id'].startswith('fund:'):
            values = fund_history(asset, offline, refresh)
        elif asset['id'].startswith('stock:'):
            values = stock_history(asset, offline, refresh)
        else:
            values = overseas_history(asset['code'], offline)
        return publish_history(asset, *values)
    except Exception as exc:
        return {**asset, 'status': 'missing', 'missing': str(exc)[:220]}


def validate_catalog(catalog, expected=None, verify_files=True):
    rows = catalog.get('assets') or []
    ids = [row.get('id') for row in rows]
    if len(ids) != len(set(ids)) or (expected is not None and set(ids) != {row['id'] for row in expected}):
        raise ValueError('组合标的库未完整覆盖研究对象或身份重复')
    for row in [*rows, catalog.get('fx') or {}]:
        if row.get('status') != 'available':
            if not row.get('missing'):
                raise ValueError('缺历史标的未说明具体原因')
            continue
        relative = row.get('historyUrl', '')
        if not relative.startswith('data/portfolio/') or '..' in relative:
            raise ValueError('历史文件路径不合法')
        if verify_files:
            path = ROOT / relative
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest() != row.get('sha256'):
                raise ValueError('历史文件校验和不一致：' + row['id'])
            history = json.loads(data)
            if history.get('id') != row['id'] or history.get('currency') != row['currency']:
                raise ValueError('历史文件身份不一致：' + row['id'])
            series = validate_series(history.get('series') or [])
            if series[0][0] != row['first'] or series[-1][0] != row['asOf'] or len(series) != row['observations']:
                raise ValueError('历史文件区间不一致：' + row['id'])
    return True


def prune():
    # Called only after a successful stage, so failed builds preserve every file
    # referenced by the previously published content-addressed catalog.
    source = (OUTPUT / 'catalog.js').read_text(encoding='utf-8')
    catalog = json.loads(source.split('=', 1)[1].strip().rstrip(';'))
    used = {row['historyUrl'] for row in [*catalog['assets'], catalog.get('fx') or {}] if row.get('historyUrl')}
    for path in OUTPUT.glob('*/*.json'):
        if path.relative_to(ROOT).as_posix() not in used:
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--refresh', action='store_true', help='incrementally refresh all fund histories')
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--prune', action='store_true')
    parser.add_argument('--check', action='store_true', help='validate committed coverage and every history checksum without mutation')
    args = parser.parse_args()
    if args.check:
        catalog = json.loads((OUTPUT / 'catalog.js').read_text(encoding='utf-8').split('=', 1)[1].strip().rstrip(';'))
        validate_catalog(catalog, universe())
        print('组合历史校验通过：', catalog['summary'])
        return 0
    if args.prune:
        prune()
        return 0
    OUTPUT.mkdir(parents=True, exist_ok=True)
    rows = universe()
    results = {}
    with ThreadPoolExecutor(max_workers=max(1, min(24, args.workers))) as pool:
        jobs = {pool.submit(build_asset, row, args.offline, args.refresh): row for row in rows}
        for index, job in enumerate(as_completed(jobs), 1):
            row = job.result()
            results[row['id']] = row
            if index % 100 == 0 or index == len(rows):
                print('组合每日历史：%d / %d；已可用 %d' % (index, len(rows), sum(r['status'] == 'available' for r in results.values())), flush=True)
    fx_asset = {'id': 'fx:CNY', 'code': 'CNY=X', 'name': '美元兑人民币', 'currency': 'CNY'}
    try:
        fx = publish_history(fx_asset, *overseas_history('CNY=X', args.offline))
    except Exception as exc:
        fx = {**fx_asset, 'status': 'missing', 'missing': '缺美元兑人民币日汇率：' + str(exc)[:160]}
    assets = [results[row['id']] for row in rows]
    catalog = {'schemaVersion': 1, 'generatedAt': now_iso(), 'endLimit': END,
               'currency': 'CNY', 'assets': assets, 'fx': fx,
               'summary': {'total': len(assets), 'available': sum(row['status'] == 'available' for row in assets),
                           'missing': sum(row['status'] != 'available' for row in assets)}}
    validate_catalog(catalog, rows)
    # A failed interface call may retain a dated, validated history. Never replace
    # an existing usable published series with an unavailable one or an older tail.
    prior_path = OUTPUT / 'catalog.js'
    if prior_path.exists():
        prior = json.loads(prior_path.read_text(encoding='utf-8').split('=', 1)[1].strip().rstrip(';'))
        old = {row['id']: row for row in prior.get('assets') or []}
        for row in assets:
            previous = old.get(row['id'])
            if previous and previous.get('status') == 'available' and (row['status'] != 'available' or row['asOf'] < previous['asOf']):
                retained = {**row, **{k: previous[k] for k in ('status', 'basis', 'first', 'asOf', 'observations', 'historyUrl', 'sha256')}}
                retained['refreshWarning'] = row.get('missing') or '本次历史末日倒退，保留上一版已验证序列'
                results[row['id']] = retained
        catalog['assets'] = [results[row['id']] for row in rows]
        catalog['summary'].update(available=sum(row['status'] == 'available' for row in catalog['assets']),
                                  missing=sum(row['status'] != 'available' for row in catalog['assets']))
        previous_fx = prior.get('fx') or {}
        if previous_fx.get('status') == 'available' and (fx['status'] != 'available' or fx['asOf'] < previous_fx['asOf']):
            catalog['fx'] = {**previous_fx, 'refreshWarning': fx.get('missing') or '本次汇率末日倒退，保留上一版'}
    validate_catalog(catalog, rows)
    atomic_text(prior_path, 'var PORTFOLIO_CATALOG=' + json.dumps(catalog, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + ';\n')
    write_status('portfolio', 'cached' if args.offline else 'success', mode='offline' if args.offline else 'online',
                 records=len(rows), **catalog['summary'], message='全部研究对象纳入标的库；可用性与实际历史末日逐项保存。')
    print('组合历史发布：', catalog['summary'], flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
