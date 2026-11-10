#!/usr/bin/env python3
"""Freeze the pre-1990 S&P price history for the midterm study; keep the live tail in its catalog.

Run with --check for an offline integrity check, --fetch to rebuild, or
--source-json FILE to reproduce the artifact from a saved Yahoo chart response.
All checks run before replacing the published file.
"""
import argparse
from datetime import date, datetime
import hashlib
import json
import math
from pathlib import Path
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text

OUTPUT = ROOT / 'data/us-midterms-history.json'
CATALOG = ROOT / 'data/return-comparison/catalog.json'
URL = ('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC'
       '?period1=-631152000&period2=633830400&interval=1d&events=history')
HISTORY_URL = 'https://finance.yahoo.com/quote/%5EGSPC/history/'
SPDJI = 'https://www.spglobal.com/spdji/en/indices/equity/sp-500/'
NY = ZoneInfo('America/New_York')
IDENTITY = dict(id='index:^GSPC', currency='USD', basis='price_index', dividends='excluded')
START, LAST, SEAM, AUDIT_END = '1950-01-03', '1989-12-29', '1990-01-02', '1990-01-31'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def valid_rows(rows, first, last, count):
    require(isinstance(rows, list) and len(rows) == count, 'Incomplete historical observation count')
    require(rows[0][0] == first and rows[-1][0] == last, 'Unexpected historical coverage')
    previous = None
    for day, close in rows:
        current = date.fromisoformat(day)
        require(day == current.isoformat() and (previous is None or 0 < (current-previous).days <= 10),
                'Duplicate, unsorted or interrupted history at ' + day)
        require(type(close) in (int, float) and math.isfinite(close) and close > 0, 'Invalid close at ' + day)
        previous = current


def published_overlap():
    catalog = json.loads(CATALOG.read_text())
    row = next(r for r in catalog['assets'] if r['id'] == IDENTITY['id'])
    raw = (ROOT / row['historyUrl']).read_bytes()
    require(digest(raw) == row['sha256'], 'Published S&P history digest mismatch')
    shard = json.loads(raw)
    require(all(shard.get(k) == v for k, v in IDENTITY.items()), 'Wrong continuation index or basis')
    require(shard['first'] == shard['series'][0][0] == SEAM, 'The continuation no longer starts at the expected seam')
    return [point for point in shard['series'] if SEAM <= point[0] <= AUDIT_END]


def check(payload):
    require(all(payload.get(k) == v for k, v in IDENTITY.items()) and payload.get('schemaVersion') == 1,
            'Wrong archive index or basis')
    require((payload['first'], payload['asOf'], payload['launchDate']) == (START, LAST, '1957-03-04'),
            'Incorrect archive range or index launch date')
    archive, overlap = payload['series'], payload['overlap']
    valid_rows(archive, START, LAST, 10054)
    valid_rows(overlap['series'], SEAM, AUDIT_END, 22)
    require((overlap['first'], overlap['asOf']) == (SEAM, AUDIT_END), 'Incorrect audit overlap dates')
    require(overlap['series'] == published_overlap(), 'January 1990 overlap differs from published daily index')
    require(digest(encoded(archive).encode()) == payload['source']['seriesSha256'], 'Historical series digest mismatch')
    return payload


def build(raw):
    chart = json.loads(raw)['chart']
    require(not chart['error'] and len(chart['result']) == 1, 'Invalid Yahoo chart response')
    block = chart['result'][0]
    meta = block['meta']
    require((meta['symbol'], meta['currency'], meta['instrumentType'], meta['exchangeTimezoneName'],
             meta['dataGranularity']) == ('^GSPC', 'USD', 'INDEX', 'America/New_York', '1d'),
            'Unexpected index, currency, trading timezone or frequency')
    quotes = block['indicators']
    closes = quotes['adjclose'][0]['adjclose']
    require(closes == quotes['quote'][0]['close'] and len(closes) == len(block['timestamp']),
            'Price index close and adjusted close do not agree')
    rows = [[datetime.fromtimestamp(t, NY).date().isoformat(), v] for t, v in zip(block['timestamp'], closes)]
    archive = [p for p in rows if p[0] < SEAM]
    overlap = [p for p in rows if p[0] >= SEAM]
    return check({
        'schemaVersion': 1, **IDENTITY, 'launchDate': '1957-03-04', 'first': START, 'asOf': LAST,
        'sourceUrl': HISTORY_URL,
        'source': {'endpoint': URL, 'field': 'indicators.adjclose[0].adjclose',
                   'timezone': 'America/New_York', 'indexFactsUrl': SPDJI,
                   'preLaunchBasis': 'pre_launch_backtested', 'seriesSha256': digest(encoded(archive).encode())},
        'overlap': {'first': SEAM, 'asOf': AUDIT_END, 'series': overlap}, 'series': archive,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--fetch', action='store_true')
    mode.add_argument('--source-json', type=Path)
    args = parser.parse_args()
    if args.check:
        result = check(json.loads(OUTPUT.read_text()))
    else:
        if args.fetch:
            with urlopen(Request(URL, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as response:
                raw = response.read()
        else:
            raw = args.source_json.read_bytes()
        result = build(raw)
        atomic_text(OUTPUT, encoded(result) + '\n')
    print(f"{len(result['series'])} historical closes; {len(result['overlap']['series'])} identical overlap closes.")


if __name__ == '__main__':
    main()
