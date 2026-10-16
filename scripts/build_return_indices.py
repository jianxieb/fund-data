#!/usr/bin/env python3
"""Publish genuine index histories for the cross-asset return explorer."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import indices
import strategy_backtest
from data_status import atomic_text

OUT = ROOT / 'data' / 'return-comparison'


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def publish(meta, series):
    series = [[d, v] for d, v in series if d >= meta.get('launchDate', '1900-01-01')]
    if len(series) < 2:
        return {**meta, 'status': 'unavailable', 'missing': '缺已发布后的指数日线'}
    history = {'schemaVersion': 1, 'id': meta['id'], 'currency': meta['currency'],
               'basis': 'price_index', 'dividends': 'excluded', 'first': series[0][0],
               'asOf': series[-1][0], 'sourceUrl': meta['sourceUrl'], 'series': series}
    text = encode(history)
    sha = hashlib.sha256(text.encode()).hexdigest()
    filename = meta['code'].replace('^', '') + '-' + sha[:16] + '.json'
    atomic_text(OUT / filename, text)
    return {**meta, 'status': 'available', 'basis': 'price_index', 'first': history['first'],
            'asOf': history['asOf'], 'observations': len(series),
            'historyUrl': 'data/return-comparison/' + filename, 'sha256': sha}


def build(offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for symbol, name in [('^GSPC', '标普500指数'), ('^NDX', '纳斯达克100指数'), ('^IXIC', '纳斯达克综合指数')]:
        meta = {'id': 'index:' + symbol, 'code': symbol, 'name': name, 'kind': 'index',
                'market': 'us', 'currency': 'USD', 'category': '宽基',
                'sourceUrl': 'https://finance.yahoo.com/quote/' + symbol.replace('^', '%5E') + '/history/'}
        # The shared loader checks identity, currency, exchange-local dates and
        # closed sessions. Indices do not turn into ETF dividend-adjusted returns.
        history = strategy_backtest.load_history(symbol, refresh=not offline, offline=offline)
        rows.append(publish(meta, sorted(history.items())))
    saved = json.loads(indices.HISTORY_PATH.read_text())['indices']
    for spec in indices.SPECS:
        meta = {'id': 'index:' + spec['c'], 'code': spec['c'], 'name': spec['n'],
                'kind': 'index', 'market': 'cn', 'currency': 'CNY', 'category': spec['category'],
                'launchDate': spec.get('launchDate'), 'sourceUrl': indices.official_url(spec)}
        history = saved.get(spec['c'])
        if history and spec.get('provider') != 'licensed':
            meta['sourceUrl'] = history['sourceUrl']
            rows.append(publish(meta, indices.normalize_series(history['points'], history['points'][-1][0])))
        else:
            rows.append({**meta, 'status': 'unavailable', 'missing': '缺可复核的授权指数日线'})
    atomic_text(OUT / 'catalog.json', encode({'schemaVersion': 1, 'assets': rows}))
    used = {Path(row['historyUrl']).name for row in rows if row.get('historyUrl')} | {'catalog.json'}
    for path in OUT.glob('*.json'):
        if path.name not in used:
            path.unlink()
    return rows


def check():
    rows = json.loads((OUT / 'catalog.json').read_text())['assets']
    assert len({r['id'] for r in rows}) == len(rows) == 3 + len(indices.SPECS)
    for row in rows:
        if row['status'] != 'available':
            assert row.get('missing')
            continue
        path = ROOT / row['historyUrl']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
        h = json.loads(path.read_text())
        assert h['id'] == row['id'] and h['basis'] == 'price_index'
        points = h['series']
        assert points[0][0] == row['first'] and points[-1][0] == row['asOf']
        assert all(v > 0 for _, v in points)
        assert all(points[i][0] > points[i - 1][0] for i in range(1, len(points)))
        assert not row.get('launchDate') or points[0][0] >= row['launchDate']
    return rows


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--offline', action='store_true')
    p.add_argument('--check', action='store_true')
    args = p.parse_args()
    result = check() if args.check else build(args.offline)
    print('收益对比指数：%d 可用，%d 缺日线' % (sum(r['status'] == 'available' for r in result), sum(r['status'] != 'available' for r in result)))
