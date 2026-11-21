#!/usr/bin/env python3
"""Publish Cboe's complete daily VIX closes for the market-condition study."""
import argparse
import csv
import hashlib
import io
import json
import math
import sys
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text

OUT = ROOT / 'data' / 'condition-study'
CACHE = ROOT / '.tmp-strategy'
CACHE_NAME = 'condition-study-vix.json'
# The same official file the market-history page reads; that page keeps only its own 20-year window.
SOURCE_URL = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'
HEADER = ['DATE', 'OPEN', 'HIGH', 'LOW', 'CLOSE']
NEW_YORK = ZoneInfo('America/New_York')
# Cboe settles the VIX close shortly after 16:15 New York time. A row dated on the fetch
# day is accepted only after 17:00 there, so an unfinished session never becomes a close.
SETTLED = time(17, 0)
META = {'id': 'index:^VIX', 'code': '^VIX', 'name': 'Cboe 波动率指数 VIX', 'kind': 'volatility_index',
        'basis': 'implied_volatility_index', 'unit': 'index_points'}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def settled_day(fetched_at):
    local = fetched_at.astimezone(NEW_YORK)
    return local.date() if local.time() >= SETTLED else local.date() - timedelta(days=1)


def parse(raw, fetched_at):
    """Return actual Cboe closes as [[ISO date, close]] plus rows that carry no usable close."""
    rows = csv.reader(io.StringIO(raw.lstrip('﻿')))
    header = next(rows, None)
    if header != HEADER:
        raise ValueError('VIX 来源表头不符：' + ','.join(header or []))
    last_day, series, missing, previous = settled_day(fetched_at), [], [], ''
    for line, row in enumerate(rows, start=2):
        if not row:
            continue
        if len(row) != len(HEADER):
            raise ValueError('VIX 来源第 %d 行字段数不符' % line)
        try:
            day = datetime.strptime(row[0], '%m/%d/%Y').date()
        except ValueError:
            raise ValueError('VIX 来源第 %d 行日期无效' % line) from None
        iso = day.isoformat()
        if iso <= previous:
            raise ValueError('VIX 来源日期重复或倒序：' + iso)
        previous = iso
        if day > last_day:
            continue
        try:
            close = float(row[4])
        except ValueError:
            close = math.nan
        if not math.isfinite(close) or close <= 0:
            missing.append({'date': iso, 'reason': 'missing_or_invalid_close'})
            continue
        series.append([iso, close])
    if len(series) < 2:
        raise ValueError('VIX 来源少于两个已收盘的有效读数')
    return series, missing


def history_of(saved):
    series, missing = parse(saved['raw'], datetime.fromisoformat(saved['fetchedAt']))
    return {'schemaVersion': 1, 'id': META['id'], 'code': META['code'], 'basis': META['basis'], 'unit': META['unit'],
            'field': 'CLOSE', 'dateConvention': 'cboe_trade_date', 'closedSessionsOnly': True,
            'first': series[0][0], 'asOf': series[-1][0], 'sourceUrl': saved['sourceUrl'],
            'sourceSha256': saved['sha256'], 'fetchedAt': saved['fetchedAt'],
            'series': series, 'missingObservations': missing}


def source(refresh=False, offline=False, timeout=25):
    path = CACHE / CACHE_NAME
    if path.exists() and (offline or not refresh):
        saved = json.loads(path.read_text())
        if saved.get('sourceUrl') != SOURCE_URL or digest(saved['raw']) != saved['sha256']:
            raise ValueError('VIX 原始缓存身份或哈希无效')
        return saved
    if offline:
        raise ValueError('缺已保存的 VIX 原始日线')
    request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode('utf-8')
    return {'sourceUrl': SOURCE_URL, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'sha256': digest(raw), 'raw': raw}


def validate_history(history, row):
    assert row['id'] == history['id'] == META['id'] and row['code'] == history['code'] == META['code']
    assert history['schemaVersion'] == 1 and history['basis'] == row['basis'] == META['basis']
    assert history['unit'] == row['unit'] == META['unit'] and history['field'] == 'CLOSE'
    assert history['closedSessionsOnly'] is True and history['dateConvention'] == 'cboe_trade_date'
    assert history['first'] == row['first'] and history['asOf'] == row['asOf']
    series = history['series']
    assert len(series) == row['observations'] >= 2 and len(history['missingObservations']) == row['missingObservations']
    assert series[0][0] == row['first'] and series[-1][0] == row['asOf']
    for i, (day, close) in enumerate(series):
        datetime.strptime(day, '%Y-%m-%d')
        assert i == 0 or series[i - 1][0] < day
        assert isinstance(close, (int, float)) and not isinstance(close, bool) and math.isfinite(close) and close > 0
    assert history['sourceUrl'] == SOURCE_URL and len(history['sourceSha256']) == 64
    datetime.fromisoformat(history['fetchedAt'])
    return history


def read_existing(row):
    if not row or row.get('status') != 'available':
        return None
    raw = (ROOT / row['historyUrl']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != row['sha256']:
        raise ValueError('原 VIX 文件哈希不一致')
    return validate_history(json.loads(raw), row)


def build(refresh=False, offline=False):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / 'catalog.json'
    rows = json.loads(path.read_text()).get('assets', []) if path.exists() else []
    previous = next((row for row in rows if row.get('id') == META['id']), None)
    prior, prior_error = None, None
    try:
        prior = read_existing(previous)
    except (OSError, ValueError, AssertionError, KeyError, TypeError) as error:
        prior_error = str(error) or '原 VIX 文件未通过校验'
    try:
        saved = source(refresh, offline)
        history = history_of(saved)
        if prior and not {day for day, _ in prior['series']}.issubset(day for day, _ in history['series']):
            raise ValueError('新来源缺少已保存的 VIX 日期，保留上次读数')
        if not offline:
            CACHE.mkdir(exist_ok=True)
            atomic_text(CACHE / CACHE_NAME, encode(saved))
        # An unchanged recheck does not manufacture a new observation time.
        if prior and history['series'] == prior['series'] and history['missingObservations'] == prior['missingObservations']:
            row = {key: value for key, value in previous.items() if key != 'refreshMissing'}
        else:
            text = encode(history)
            sha = digest(text)
            filename = 'VIX-' + sha[:16] + '.json'
            atomic_text(OUT / filename, text)
            row = {**META, 'status': 'available', 'first': history['first'], 'asOf': history['asOf'],
                   'observations': len(history['series']), 'missingObservations': len(history['missingObservations']),
                   'historyUrl': 'data/condition-study/' + filename, 'sha256': sha, 'sourceUrl': SOURCE_URL,
                   'fetchedAt': history['fetchedAt']}
            validate_history(history, row)
    except Exception as error:  # Any source failure keeps the last verified closes and their times.
        if prior:
            row = {**previous, 'refreshMissing': str(error) or type(error).__name__}
        else:
            row = {**META, 'status': 'unavailable',
                   'missing': (str(error) or type(error).__name__) + ('；旧记录无效：' + prior_error if prior_error else '')}
    atomic_text(path, encode({'schemaVersion': 1, 'assets': [row]}))
    used = {Path(row['historyUrl']).name} if row.get('historyUrl') else set()
    for file in OUT.glob('VIX-*.json'):
        if file.name not in used:
            file.unlink()
    return row


def check():
    catalog = json.loads((OUT / 'catalog.json').read_text())
    assert catalog['schemaVersion'] == 1 and len(catalog['assets']) == 1
    row = catalog['assets'][0]
    assert row['id'] == META['id']
    if row['status'] == 'available':
        read_existing(row)
    else:
        assert row['status'] == 'unavailable' and row['missing']
    return row


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='fetch the Cboe file again')
    parser.add_argument('--offline', action='store_true', help='rebuild from the saved raw file only')
    parser.add_argument('--check', action='store_true', help='validate the published catalog and file')
    options = parser.parse_args()
    result = check() if options.check else build(options.refresh, options.offline)
    print('VIX 日线：' + (result.get('first', '') + ' 至 ' + result['asOf'] if result['status'] == 'available' else result['missing']) +
          ('（保留旧数据：' + result['refreshMissing'] + '）' if result.get('refreshMissing') else ''))
