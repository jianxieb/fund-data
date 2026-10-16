#!/usr/bin/env python3
"""Publish actual daily observations for curated financial-event chapters."""
import argparse
import hashlib
import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import strategy_backtest as history
from data_status import atomic_text

DEFINITIONS = ROOT / 'data/financial-events.json'
OUT = ROOT / 'data/financial-events-history.json'
SUPPLEMENT = {
    'GLD': ('黄金信托 GLD', 'USD', 'provider_adjusted_close'),
    'KRE': ('美国地区银行 ETF KRE', 'USD', 'provider_adjusted_close'),
    'EWU': ('英国股票 ETF EWU', 'USD', 'provider_adjusted_close'),
    'EWJ': ('日本股票 ETF EWJ', 'USD', 'provider_adjusted_close'),
    'FXI': ('香港上市中国大盘股 ETF FXI', 'USD', 'provider_adjusted_close'),
    'VGK': ('欧洲股票 ETF VGK', 'USD', 'provider_adjusted_close'),
    'USO': ('原油期货基金 USO', 'USD', 'provider_adjusted_close'),
    '000001.SS': ('上证指数', 'CNY', 'price_index'),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_definitions():
    data = json.loads(DEFINITIONS.read_text())
    assert data['schemaVersion'] == 1 and len(data['events']) >= 15
    assert len({e['id'] for e in data['events']}) == len(data['events'])
    for e in data['events']:
        assert e['windowStart'] <= e['eventDate'] <= e['marketDate']
        assert e['ongoing'] == (e['windowEnd'] is None)
        assert not e['windowEnd'] or e['windowEnd'] >= e['marketDate']
        assert all(t['sources'] and all(s in data['sources'] for s in t['sources']) for t in e['timeline'])
        assert e['channels'] and e['watch'] and e['lesson'] and e['china']
    return data


def source_histories(offline):
    text = (ROOT / 'data/portfolio/catalog.js').read_text()
    portfolio = json.loads(text[text.index('{'):].rstrip().rstrip(';'))
    indices = json.loads((ROOT / 'data/return-comparison/catalog.json').read_text())
    sources = {}
    for row in portfolio['assets'] + indices['assets']:
        if row['code'] not in {'SPY', 'QQQ', 'TLT', '^GSPC', '^IXIC'}:
            continue
        path = ROOT / row['historyUrl']
        assert sha(path) == row['sha256'], '日线文件哈希不一致'
        h = json.loads(path.read_text())
        assert h['id'] == row['id'] and h['basis'] == row['basis'] and h['currency'] == row['currency']
        sources[row['code']] = dict(code=row['code'], name=row['name'], currency=row['currency'],
            basis=row['basis'], sourceUrl=row['sourceUrl'], sourceFile=row['historyUrl'], sourceSha256=row['sha256'],
            historyAsOf=h['asOf'], missingObservations=h.get('missingObservations', []), series=h['series'])
    for code, (name, currency, basis) in SUPPLEMENT.items():
        points = history.load_history(code, refresh=not offline, offline=offline)
        path = Path(history.cache_path(code))
        raw = json.loads(path.read_text())
        assert raw['symbol'] == code and raw['currency'] == currency
        assert raw['schemaVersion'] == 3 and raw['closedSessionsOnly'] is True
        assert raw['dateConvention'] == 'exchange_local_date'
        sources[code] = dict(code=code, name=name, currency=currency, basis=basis,
            sourceUrl='https://finance.yahoo.com/quote/' + code + '/history/',
            sourceRequest=raw['source'], sourceSha256=sha(path), fetchedAt=raw['fetchedAt'],
            exchangeTimezoneName=raw['exchangeTimezoneName'], closedSessionsOnly=True,
            historyAsOf=max(points), missingObservations=raw.get('missingObservations', []),
            series=sorted(points.items()))
    return sources


def build(offline=False):
    definitions = read_definitions()
    sources = source_histories(offline)
    events = {}
    for e in definitions['events']:
        # Include enough observations for a 252-trading-day outcome. This is
        # separate from the authored chapter window, never an invented forecast.
        anchor = date.fromisoformat(e['marketDate'])
        start = min(e['windowStart'], (anchor - timedelta(days=60)).isoformat())
        end = max(e['windowEnd'] or date.today().isoformat(), (anchor + timedelta(days=420)).isoformat())
        rows = []
        for code in e['assetCodes']:
            s = sources[code]
            points = [[d, v] for d, v in s['series'] if start <= d <= end]
            assert points and any(d < e['marketDate'] for d, _ in points), code + '缺事件前收盘'
            rows.append({**s, 'series': points,
                         'missingObservations': [m for m in s['missingObservations'] if start <= m['date'] <= points[-1][0]]})
        events[e['id']] = rows
    result = dict(schemaVersion=1, definitionsSha256=sha(DEFINITIONS), events=events)
    atomic_text(OUT, json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    return check()


def check():
    definitions = read_definitions()
    result = json.loads(OUT.read_text())
    assert result['schemaVersion'] == 1 and result['definitionsSha256'] == sha(DEFINITIONS)
    assert set(result['events']) == {e['id'] for e in definitions['events']}
    for e in definitions['events']:
        rows = result['events'][e['id']]
        assert [r['code'] for r in rows] == e['assetCodes']
        for r in rows:
            points = r['series']
            assert r['basis'] in {'provider_adjusted_close', 'price_index'}
            assert r['currency'] in {'USD', 'CNY'} and r['sourceUrl'].startswith('https://')
            assert len(r['sourceSha256']) == 64
            assert len(points) >= 2 and points[-1][0] <= r['historyAsOf'] < date.today().isoformat()
            assert all(math.isfinite(v) and v > 0 for _, v in points)
            assert all(points[i][0] > points[i-1][0] for i in range(1, len(points)))
            assert points[0][0] < e['marketDate'] <= points[-1][0]
            if 'sourceFile' in r:
                assert sha(ROOT / r['sourceFile']) == r['sourceSha256']
            else:
                assert r['closedSessionsOnly'] and r['exchangeTimezoneName']
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--offline', action='store_true')
    p.add_argument('--check', action='store_true')
    args = p.parse_args()
    data = check() if args.check else build(args.offline)
    print('历史事件：%d章，%d组真实日线' % (len(data['events']), sum(map(len, data['events'].values()))))
