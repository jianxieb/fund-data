#!/usr/bin/env python3
"""Attach dated distribution evidence without changing any published return path."""
import argparse
import hashlib
import json
import math
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def from_chart(payload, asset, first, end, digest):
    nodes = payload.get('chart', {}).get('result') or []
    if len(nodes) != 1:
        raise ValueError('分红行情未返回唯一证券')
    node, symbol = nodes[0], asset['code']
    if asset['market'] == 'cn':
        symbol += '.SS' if symbol[0] in '5689' else '.SZ'
    meta = node.get('meta', {})
    if meta.get('symbol', '').upper() != symbol.upper() or meta.get('currency') != asset['currency']:
        raise ValueError('分红行情的证券身份或币种不符')
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    local_day = lambda stamp: datetime.fromtimestamp(stamp, zone).date().isoformat()
    stamps = node.get('timestamp') or []
    closes = (node.get('indicators', {}).get('quote') or [{}])[0].get('close') or []
    if len(stamps) != len(closes) or not stamps:
        raise ValueError('缺分红日的普通收盘价')
    prices = {local_day(t): p for t, p in zip(stamps, closes) if finite(p) and p > 0 and first <= local_day(t) <= end}
    if first not in prices or end not in prices:
        raise ValueError('现金分红行情未覆盖完整价格区间 ' + first + ' - ' + end)
    amounts, missing_days = {}, []
    for event in (node.get('events') or {}).get('dividends', {}).values():
        day, amount = local_day(event['date']), event.get('amount')
        if not first <= day <= end:
            continue
        if not finite(amount) or amount < 0:
            raise ValueError('现金分红金额无效：' + day)
        if day not in prices:
            missing_days.append(day)
            continue
        amounts[day] = amounts.get(day, 0) + amount
    coverage_first = min((d for d in prices if d > max(missing_days)), default=None) if missing_days else first
    if coverage_first is None:
        raise ValueError('末段现金分红缺除权日收盘价')
    return {'status': 'recorded', 'first': coverage_first, 'through': end,
            'fractions': {d: value / (prices[d] + value) for d, value in amounts.items() if value > 0 and d >= coverage_first},
            'sourceUrl': 'https://finance.yahoo.com/quote/' + symbol + '/history/',
            'sourceSha256': digest, 'basis': 'cash_distribution_over_ex_date_close_plus_distribution',
            **({'coverageWarning': '分红日 ' + max(missing_days) + ' 缺除权收盘价；分红计税明细仅自 ' + coverage_first + ' 完整'} if missing_days else {})}


def fund_evidence(asset, first, end):
    path = ROOT / '.tmp-hist' / (asset['code'] + '.json')
    rows = json.loads(path.read_text())
    rows = [r for r in rows if first <= r['FSRQ'] <= end]
    if not rows or min(r['FSRQ'] for r in rows) != first or max(r['FSRQ'] for r in rows) != end:
        raise ValueError('缺覆盖区间的基金现金分配记录')
    if any(not r.get('ACTIONS_SOURCE') or not finite(r.get('SPLIT_FACTOR')) or not finite(r.get('FHFCZ')) for r in rows):
        raise ValueError('缺逐日完整基金现金分红与拆分记录；净值日收益不能替代分红明细')
    fractions = {}
    for r in rows:
        nav, cash, split = float(r['DWJZ']), r['FHFCZ'], r['SPLIT_FACTOR']
        if cash < 0 or split <= 0 or nav <= 0:
            raise ValueError('基金现金分红或拆分比例无效')
        if cash:
            fractions[r['FSRQ']] = cash / (nav * split + cash)
    return {'status': 'recorded', 'first': first, 'through': end, 'fractions': fractions,
            'sourceUrl': asset['sourceUrl'], 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'basis': 'explicit_fund_cash_distribution_and_split'}


def dividend_evidence(asset, first, end, offline=False):
    try:
        if asset['id'].startswith('fund:'):
            return fund_evidence(asset, first, end)
        cache = ROOT / '.tmp-portfolio' / 'dividends' / (asset['code'] + '.json')
        candidates = [cache]
        if asset['market'] == 'us' and asset['kind'] == 'stock':
            candidates.append(ROOT / '.tmp-snap' / 'overseas-stocks' / (asset['code'].lower() + '-chart.json'))
        for path in candidates:
            if not path.exists():
                continue
            raw = path.read_bytes()
            try:
                return from_chart(json.loads(raw), asset, first, end, hashlib.sha256(raw).hexdigest())
            except (ValueError, KeyError, TypeError):
                pass
        if offline:
            raise ValueError('缺覆盖区间的现金分红与除权收盘价缓存')
        symbol = asset['code']
        if asset['market'] == 'cn':
            symbol += '.SS' if symbol[0] in '5689' else '.SZ'
        begin = int(datetime.fromisoformat(first).replace(tzinfo=timezone.utc).timestamp())
        finish = int((datetime.fromisoformat(end).replace(tzinfo=timezone.utc) + timedelta(days=2)).timestamp())
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(symbol, safe='') + '?' + urllib.parse.urlencode({'period1': begin, 'period2': finish, 'interval': '1d', 'events': 'div,splits'})
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20) as response:
            raw = response.read()
        evidence = from_chart(json.loads(raw), asset, first, end, hashlib.sha256(raw).hexdigest())
        cache.parent.mkdir(parents=True, exist_ok=True)
        atomic_text(cache, raw.decode())
        return evidence
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return {'status': 'missing', 'missing': str(exc)[:220] if not isinstance(exc, FileNotFoundError) else '缺逐日基金现金分红与拆分档案'}


def enrich(row, offline):
    if row['status'] != 'available':
        return row
    path = ROOT / row['historyUrl']
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError('原始历史校验失败：' + row['id'])
    body = json.loads(raw)
    evidence = dividend_evidence(row, row['first'], row['asOf'], offline)
    # Missing fund action detail must not rewrite its otherwise valid net history.
    if evidence['status'] != 'recorded':
        return {**row, 'dividendTaxData': evidence}
    body['dividendEvidence'] = evidence
    encoded = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n'
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    namespace, code = row['id'].split(':')
    relative = 'data/portfolio/%s/%s-%s.json' % (namespace, code, digest[:16])
    atomic_text(ROOT / relative, encoded)
    return {**row, 'historyUrl': relative, 'sha256': digest,
            'dividendTaxData': {k: v for k, v in evidence.items() if k not in ('fractions', 'sourceSha256')}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    path = ROOT / 'data' / 'portfolio' / 'catalog.js'
    catalog = json.loads(path.read_text().split('=', 1)[1].strip().rstrip(';'))
    rows = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(enrich, row, args.offline): row['id'] for row in catalog['assets']}
        for n, job in enumerate(as_completed(jobs), 1):
            row = job.result(); rows[row['id']] = row
            if n % 200 == 0:
                print('已核对', n, '只', flush=True)
    catalog['assets'] = [rows[row['id']] for row in catalog['assets']]
    atomic_text(path, 'var PORTFOLIO_CATALOG=' + json.dumps(catalog, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + ';\n')
    from scripts.build_portfolio_data import prune, validate_catalog
    validate_catalog(catalog); prune()
    for market in ('us', 'cn'):
        selected = [r for r in catalog['assets'] if r['market'] == market and (r['kind'] == 'stock' or market == 'us')]
        print(market, '现金分红依据', sum(r.get('dividendTaxData', {}).get('status') == 'recorded' for r in selected), '/', len(selected))


if __name__ == '__main__':
    main()
