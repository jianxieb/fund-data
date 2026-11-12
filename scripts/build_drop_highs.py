#!/usr/bin/env python3
"""Publish closed-session index highs without changing the return-study closes."""
import argparse
import hashlib
import json
import math
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import strategy_backtest
from data_status import atomic_text

OUT = ROOT / 'data' / 'drop-study'
CACHE = ROOT / '.tmp-strategy'
SYMBOLS = ('^NDX', '^GSPC')
CLOSE_TOLERANCE = .005  # Half of the provider's quoted 0.01 index point.


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def valid_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def normalize(node, symbol, source_url, published, observed_at=None, source_sha=None):
    meta = node.get('meta', {}) if node else {}
    if meta.get('instrumentType') != 'INDEX' or meta.get('currency') != 'USD':
        raise ValueError(symbol + ' 缺美元价格指数身份')
    # Reuse the established exchange-date, duplicate and unfinished-session rules.
    closed = strategy_backtest.normalize_chart(node, symbol, source_url,
        max_day=published['asOf'], observed_at=observed_at)
    quote = (node.get('indicators', {}).get('quote') or [{}])[0]
    timestamps = node.get('timestamp') or []
    highs, closes = quote.get('high') or [], quote.get('close') or []
    if len(highs) != len(timestamps) or len(closes) != len(timestamps):
        raise ValueError(symbol + ' 缺显式每日最高价或同条收盘字段')
    quotes = {stamp: (highs[i], closes[i]) for i, stamp in enumerate(timestamps)}
    prior = dict(published['series'])
    series, close_series, missing = [], [], list(closed['missingObservations'])
    seen = set()
    for row in closed['data']:
        day = row['date']
        if day not in prior:
            continue
        seen.add(day)
        high, close = quotes[row['timestamp']]
        reason = None
        if not valid_number(high) or not valid_number(close):
            reason = 'missing_or_invalid_high_or_close'
        elif high < close - max(math.ulp(float(high)), math.ulp(float(close))) * 4:
            reason = 'high_below_same_bar_close'
        elif abs(close - row['adjustedClose']) > max(math.ulp(float(close)) * 4, 1e-8):
            reason = 'index_close_and_adjusted_close_disagree'
        elif abs(close - prior[day]) > CLOSE_TOLERANCE + math.ulp(float(close)) * 4:
            reason = 'published_close_mismatch'
        if reason:
            missing.append({'date': day, 'reason': reason, 'sourceClose': close, 'publishedClose': prior[day]})
            continue
        series.append([day, high])
        close_series.append([day, close])
    missing_days = {row['date'] for row in missing}
    missing.extend({'date': day, 'reason': 'missing_source_bar'} for day in prior if day not in seen and day not in missing_days)
    if len(series) < 2:
        raise ValueError(symbol + ' 缺两日可与已发布收盘核对的真实最高价')
    return {'schemaVersion': 1, 'id': 'index:' + symbol, 'currency': 'USD',
        'basis': 'price_index_high', 'dividends': 'excluded', 'field': 'indicators.quote[0].high',
        'closedSessionsOnly': True, 'dateConvention': 'exchange_local_date',
        'exchangeTimezoneName': closed['exchangeTimezoneName'], 'first': series[0][0], 'asOf': series[-1][0],
        'sourceUrl': source_url, 'sourceSha256': source_sha, 'fetchedAt': closed['fetchedAt'],
        'closeValidation': {'historyUrl': published['historyUrl'], 'sha256': published['sha256'],
                            'tolerance': CLOSE_TOLERANCE},
        'series': series, 'closes': close_series, 'missingObservations': missing}


def source(symbol, end, refresh=False, offline=False, timeout=15):
    path = CACHE / ('drop-study-' + symbol[1:] + '-chart.json')
    if path.exists() and (offline or not refresh):
        saved = json.loads(path.read_text())
        if saved.get('symbol') != symbol or hashlib.sha256(saved['raw'].encode()).hexdigest() != saved['sha256']:
            raise ValueError(symbol + ' 最高价缓存身份或哈希无效')
        return saved
    if offline:
        raise ValueError(symbol + ' 缺已保存的原始最高价日线')
    finish = int((datetime.fromisoformat(end).replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp())
    url = strategy_backtest.API_URL + symbol + '?period1=631152000&period2=' + str(finish) + '&interval=1d&events=div%2Csplits&includePrePost=false'
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode('utf-8')
    # Validate structure before replacing the raw evidence cache.
    payload = json.loads(raw)
    if not (payload.get('chart', {}).get('result') or [None])[0]:
        raise ValueError(symbol + ' 最高价来源没有实际日线')
    saved = {'symbol': symbol, 'sourceUrl': url, 'fetchedAt': datetime.now(timezone.utc).isoformat(),
             'sha256': hashlib.sha256(raw.encode()).hexdigest(), 'raw': raw}
    return saved


def read_published(row):
    path = ROOT / row['historyUrl']
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError(row['id'] + ' 已发布收盘哈希不一致')
    history = json.loads(raw)
    if row['code'] not in SYMBOLS or row.get('status') != 'available' or row.get('kind') != 'index' or row.get('currency') != 'USD' or history.get('currency') != 'USD' or history.get('id') != row['id'] or history.get('basis') != 'price_index' or history.get('dividends') != 'excluded':
        raise ValueError('收盘必须为同一价格指数，不接受 ETF 或含息指数')
    return {**history, 'historyUrl': row['historyUrl'], 'sha256': row['sha256']}


def read_existing(row):
    if not row or row.get('status') != 'available':
        return None
    path = ROOT / row['historyUrl']
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError(row['id'] + ' 原最高价文件哈希不一致')
    history = json.loads(raw)
    validate_history(history, row)
    return history


def validate_history(history, row):
    assert row['id'] == 'index:' + row['code'] and row['code'] in SYMBOLS
    assert history['schemaVersion'] == 1 and history['id'] == row['id']
    assert history['basis'] == row['basis'] == 'price_index_high' and history['currency'] == 'USD'
    assert history['closedSessionsOnly'] is True and history['dateConvention'] == 'exchange_local_date'
    assert history['field'] == 'indicators.quote[0].high' and history['dividends'] == 'excluded'
    assert history['first'] == row['first'] and history['asOf'] == row['asOf']
    series, closes = history['series'], history['closes']
    assert len(series) == len(closes) == row['observations'] and len(series) >= 2
    assert series[0][0] == row['first'] and series[-1][0] == row['asOf']
    assert all(i == 0 or series[i - 1][0] < day for i, (day, _) in enumerate(series))
    for (day, high), (close_day, close) in zip(series, closes):
        datetime.strptime(day, '%Y-%m-%d')
        assert day == close_day and valid_number(high) and valid_number(close)
        assert high >= close - max(math.ulp(float(high)), math.ulp(float(close))) * 4
    assert history['closeValidation']['tolerance'] == CLOSE_TOLERANCE
    assert len(history['closeValidation']['sha256']) == len(history['sourceSha256']) == 64
    datetime.fromisoformat(history['fetchedAt'])
    return history


def build(refresh=False, offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'catalog.json'
    old = {row['id']: row for row in json.loads(path.read_text()).get('assets', [])} if path.exists() else {}
    index_rows = json.loads((ROOT / 'data' / 'return-comparison' / 'catalog.json').read_text())['assets']
    rows = []
    for symbol in SYMBOLS:
        index = next(row for row in index_rows if row['id'] == 'index:' + symbol)
        meta = {key: index[key] for key in ('id', 'code', 'name', 'currency')}
        meta.update({'kind': 'index', 'basis': 'price_index_high'})
        previous = old.get(index['id'])
        prior, prior_error = None, None
        try:
            prior = read_existing(previous)
        except (OSError, ValueError, AssertionError, KeyError) as error:
            prior_error = str(error) or '原最高价文件未通过校验'
        try:
            published = read_published(index)
            saved = source(symbol, published['asOf'], refresh, offline)
            node = json.loads(saved['raw'])['chart']['result'][0]
            history = normalize(node, symbol, saved['sourceUrl'], published,
                observed_at=datetime.fromisoformat(saved['fetchedAt']), source_sha=saved['sha256'])
            if prior and not {day for day, _ in prior['series']}.issubset(day for day, _ in history['series']):
                raise ValueError(symbol + ' 新来源缺少已保存的有效历史日期，保留上次最高价')
            if not offline:
                CACHE.mkdir(exist_ok=True)
                atomic_text(CACHE / ('drop-study-' + symbol[1:] + '-chart.json'), encode(saved))
            # An unchanged recheck does not manufacture a new observation timestamp.
            if prior and all(history[key] == prior[key] for key in ('series', 'closes', 'closeValidation', 'missingObservations')):
                row = {key: value for key, value in previous.items() if key != 'refreshMissing'}
            else:
                text = encode(history)
                sha = hashlib.sha256(text.encode()).hexdigest()
                filename = symbol[1:] + '-' + sha[:16] + '.json'
                atomic_text(OUT / filename, text)
                row = {**meta, 'status': 'available', 'first': history['first'], 'asOf': history['asOf'],
                    'observations': len(history['series']), 'historyUrl': 'data/drop-study/' + filename, 'sha256': sha,
                    'fetchedAt': history['fetchedAt'], 'missingObservations': len(history['missingObservations'])}
                validate_history(history, row)
        except Exception as error:
            if prior:
                row = {**previous, 'refreshMissing': str(error)}
            else:
                row = {**meta, 'status': 'unavailable', 'missing': str(error) + ('；旧记录无效：' + prior_error if prior_error else '')}
        rows.append(row)
    atomic_text(path, encode({'schemaVersion': 1, 'assets': rows}))
    # Cleanup after the new manifest is safely published; never touch the close files.
    used = {Path(row['historyUrl']).name for row in rows if row.get('historyUrl')} | {'catalog.json'}
    for file in OUT.glob('*.json'):
        if file.name not in used:
            file.unlink()
    return rows


def check():
    catalog = json.loads((OUT / 'catalog.json').read_text())
    assert catalog['schemaVersion'] == 1
    rows = catalog['assets']
    assert {row['code'] for row in rows} == set(SYMBOLS) and len(rows) == len(SYMBOLS)
    for row in rows:
        if row['status'] == 'available':
            read_existing(row)
        else:
            assert row['status'] == 'unavailable' and row['missing']
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--check', action='store_true')
    options = parser.parse_args()
    result = check() if options.check else build(options.refresh, options.offline)
    print('盘中收复最高价：' + '；'.join(row['code'] + ' ' + (row.get('asOf', '') if row['status'] == 'available' else row['missing']) +
        ('（保留旧数据：' + row['refreshMissing'] + '）' if row.get('refreshMissing') else '') for row in result))
