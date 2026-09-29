#!/usr/bin/env python3
"""Build the published buy-location comparison from dated ETF closes and fund NAVs.

Usage: python3 scripts/build_buy_location_data.py --end 2026-09-22
The output is a fixed research snapshot. The ignored raw caches can be refreshed
independently; the committed data file is sufficient for the static page.
"""
import argparse
import hashlib
import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update import history_fetch, total_return_series  # noqa: E402
from fund_evidence import fund_actions  # noqa: E402

RAW = ROOT / '.tmp-buy-location'
OUT = ROOT / 'data/buy-location.js'
HISTORY_START = '2010-01-01'
PRODUCTS = [
    ('SPY', 'SPY · 标普500 ETF', 'us', 'SPY'),
    ('513500', '标普500ETF博时', 'exchange', '513500.SS'),
    ('050025', '博时标普500ETF联接A', 'off', None),
    ('QQQ', 'QQQ · 纳指100 ETF', 'us', 'QQQ'),
    ('513100', '纳指ETF国泰', 'exchange', '513100.SS'),
    ('159941', '纳指ETF广发', 'exchange', '159941.SZ'),
    ('270042', '广发纳斯达克100ETF联接A', 'off', None),
    ('040046', '华安纳斯达克100ETF联接A', 'off', None),
]
FAMILY = {'SPY': 'sp', '513500': 'sp', '050025': 'sp',
          'QQQ': 'nq', '513100': 'nq', '159941': 'nq', '270042': 'nq', '040046': 'nq'}


def chart(symbol, end, offline, min_observations=500):
    path = RAW / (symbol.lower().replace('=', '-') + '.json')
    if offline:
        if not path.exists():
            raise RuntimeError('缺少行情缓存：' + str(path))
        payload = json.loads(path.read_text(encoding='utf-8'))
    else:
        begin = int(datetime.strptime(HISTORY_START, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp())
        finish = int((datetime.strptime(end, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                      + timedelta(days=2)).timestamp())
        url = ('https://query1.finance.yahoo.com/v8/finance/chart/'
               + urllib.parse.quote(symbol, safe='')
               + '?period1=%d&period2=%d&interval=1d&events=div%%2Csplits' % (begin, finish))
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.load(response)
        RAW.mkdir(exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    result = (payload.get('chart') or {}).get('result') or []
    if len(result) != 1:
        raise ValueError('Yahoo chart 无有效结果：' + symbol)
    node = result[0]
    meta = node.get('meta') or {}
    if meta.get('symbol', '').upper() != symbol.upper():
        raise ValueError('Yahoo chart 标的身份不符：' + symbol)
    currency = 'CNY' if symbol == 'CNY=X' or symbol.endswith(('.SS', '.SZ')) else 'USD'
    if meta.get('currency') != currency:
        raise ValueError('Yahoo chart 币种不符：' + symbol)
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    stamps = node.get('timestamp') or []
    indicators = node.get('indicators') or {}
    closes = (indicators.get('quote') or [{}])[0].get('close') or []
    adjusted = (indicators.get('adjclose') or [{}])[0].get('adjclose') or []
    if not (len(stamps) == len(closes) == len(adjusted)):
        raise ValueError('行情长度或复权收盘价缺失：' + symbol)
    rows = {}
    for stamp, close, adj in zip(stamps, closes, adjusted):
        local = datetime.fromtimestamp(stamp, zone)
        day = local.date().isoformat()
        if day > end:
            continue
        # The trailing FX chart can include a provisional non-midnight quote.
        if symbol == 'CNY=X' and (local.hour, local.minute, local.second) != (0, 0, 0):
            continue
        if day in rows:
            raise ValueError('重复交易日：%s %s' % (symbol, day))
        if close is None or adj is None or not all(math.isfinite(float(v)) and float(v) > 0 for v in (close, adj)):
            continue
        rows[day] = (float(adj), float(close))
    dividends = {}
    for event in (node.get('events') or {}).get('dividends', {}).values():
        day = datetime.fromtimestamp(event['date'], zone).date().isoformat()
        if day not in rows:
            continue
        amount = float(event['amount'])
        if not math.isfinite(amount) or amount < 0:
            raise ValueError('分红金额无效：' + symbol)
        dividends[day] = dividends.get(day, 0) + amount
    fractions = {day: round(amount / (rows[day][1] + amount), 9)
                 for day, amount in dividends.items()}
    if len(rows) < min_observations:
        raise ValueError('行情观测不足：' + symbol)
    source = 'https://finance.yahoo.com/quote/' + urllib.parse.quote(symbol, safe='') + '/history/'
    return sorted((day, round(price, 7)) for day, (price, _) in rows.items()), fractions, source, hashlib.sha256(path.read_bytes()).hexdigest()


def chart_actions(symbol, end):
    path = RAW / (symbol.lower().replace('=', '-') + '.json')
    node = json.loads(path.read_text())['chart']['result'][0]
    if node['meta']['symbol'].upper() != symbol.upper():
        raise ValueError('分红记录标的身份不符')
    zone = ZoneInfo(node['meta']['exchangeTimezoneName'])
    def day(event):
        return datetime.fromtimestamp(event['date'], zone).date().isoformat()
    events = node.get('events') or {}
    return {'cash': sorted([{'date': day(e), 'perUnit': e['amount']} for e in events.get('dividends', {}).values() if day(e) <= end], key=lambda e: e['date']),
            'splits': sorted([{'date': day(e), 'factor': e['numerator'] / e['denominator']} for e in events.get('splits', {}).values() if day(e) <= end], key=lambda e: e['date']),
            'through': end, 'historyFrom': HISTORY_START, 'status': 'recorded',
            'source': 'https://finance.yahoo.com/quote/' + symbol + '/history/',
            'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'returnTreatment': 'reinvested_in_total_return'}


def fund_nav(code, end, offline):
    path = ROOT / '.tmp-hist' / (code + '.json')
    if not path.exists() and offline:
        raise RuntimeError('缺少基金净值缓存：' + str(path))
    rows = json.loads(path.read_text(encoding='utf-8')) if offline else history_fetch(code)
    if not rows:
        raise ValueError('基金历史净值缺失：' + code)
    series = total_return_series([r for r in rows if r.get('FSRQ', '') <= end])
    if len(series) < 500:
        raise ValueError('基金净值观测不足：' + code)
    return [[day, round(value, 7)] for day, value in series if day >= HISTORY_START], {}, 'https://fundf10.eastmoney.com/jjjz_' + code + '.html', hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--end', default='2026-09-22')
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    datetime.strptime(args.end, '%Y-%m-%d')
    products = []
    for code, name, channel, symbol in PRODUCTS:
        series, dividends, source, digest = (fund_nav(code, args.end, args.offline)
                                             if channel == 'off' else chart(symbol, args.end, args.offline))
        nav_data = fund_nav(code, args.end, args.offline) if channel == 'exchange' else None
        products.append({'code': code, 'name': name, 'family': FAMILY[code],
                         'channel': channel, 'basis': 'fund_nav_total_return' if channel == 'off' else 'yahoo_adjusted_close',
                         'source': source, 'sourceSha256': digest, 'series': series,
                         'navSeries': nav_data[0] if nav_data else [],
                         'actions': chart_actions(symbol, args.end) if channel == 'us' else fund_actions(code, args.end),
                         'navSource': nav_data[2] if nav_data else None,
                         'navSourceSha256': nav_data[3] if nav_data else None,
                         'dividendFraction': dividends if channel == 'us' else {}})
    fx, _, fx_source, fx_hash = chart('CNY=X', args.end, args.offline)
    actual_end = min([p['series'][-1][0] for p in products] + [fx[-1][0]])
    if actual_end < args.end:
        raise ValueError('有数据落后请求截至日，拒绝伪装为同期：' + actual_end)
    out = {'schemaVersion': 1, 'asOf': actual_end,
           'builtAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'fxSource': fx_source, 'fxSourceSha256': fx_hash, 'fx': fx,
           'products': products}
    OUT.write_text('window.BUY_LOCATION_DATA=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    print('已生成 %s：%d只产品，截至%s' % (OUT, len(products), actual_end))


if __name__ == '__main__':
    main()
