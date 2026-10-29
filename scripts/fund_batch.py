"""Dated, identity-checked batch NAV observations for one daily refresh."""
import hashlib
import json
import math
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from data_status import ROOT, DATA, atomic_text, write_status

ENDPOINT = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
CACHE = ROOT / '.tmp-snap' / 'fund-latest.json'


def merge_history(previous, rows, observed_at, sources):
    """Keep dated daily evidence across runs, including failed history builds."""
    history = {}
    for code in set(previous.get('history', {})) | set(previous.get('rows', {})) | set(rows):
        saved = {}
        for row in [*previous.get('history', {}).get(code, []), previous.get('rows', {}).get(code), rows.get(code)]:
            if not row:
                continue
            try:
                clean = observation({'FCODE': row.get('FCODE'), 'PDATE': row.get('FSRQ'),
                                     'NAV': row.get('DWJZ'), 'NAVCHGRT': row.get('JZZZL')}, {code})
            except (KeyError, TypeError, ValueError):
                continue
            clean.update({k: row[k] for k in ('sourceObservedAt', 'sourceSha256') if row.get(k)})
            if row is rows.get(code):
                clean['sourceObservedAt'] = observed_at
                clean['sourceSha256'] = next((source['sha256'] for source in sources
                    if code in source['url'].split('Fcodes=')[-1].split(',')), None)
            saved[clean['FSRQ']] = clean
        if saved:
            history[code] = [saved[day] for day in sorted(saved)[-10:]]
    return history


def observation(row, expected, today=None):
    code = str(row.get('FCODE') or '')
    if code not in expected:
        raise ValueError('批量净值证券身份不符：' + code)
    day = str(row.get('PDATE') or '')
    parsed = date.fromisoformat(day)
    if parsed > (today or date.today()):
        raise ValueError('批量净值日期在未来：' + code)
    if isinstance(row.get('NAV'), bool) or isinstance(row.get('NAVCHGRT'), bool):
        raise ValueError('净值和收益不能为布尔值')
    nav, daily = float(row['NAV']), float(row['NAVCHGRT'])
    if not math.isfinite(nav) or nav <= 0 or not math.isfinite(daily) or not -100 < daily <= 400:
        raise ValueError('批量净值或日收益无效：' + code)
    return {'FCODE': code, 'FSRQ': day, 'DWJZ': nav, 'JZZZL': daily,
            'NEWPRICE': row.get('NEWPRICE'), 'CHANGERATIO': row.get('CHANGERATIO')}


def fetch(codes):
    url = ENDPOINT + '?pageIndex=1&pageSize=100&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=' + ','.join(codes)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=8) as response:
        raw = response.read()
    payload = json.loads(raw)
    if payload.get('ErrCode') or not isinstance(payload.get('Datas'), list):
        raise ValueError('批量净值接口未返回记录：' + str(payload.get('ErrCode')))
    found, failures = {}, {}
    for row in payload['Datas']:
        if not isinstance(row, dict):
            failures['response'] = '批量接口包含无效记录结构'
            continue
        code = str(row.get('FCODE') or '')
        if code in failures:
            continue
        try:
            current = observation(row, set(codes))
            if code in found and current != found[code]:
                raise ValueError('同一基金存在冲突净值：' + code)
            found[code] = current
        except (KeyError, TypeError, ValueError) as error:
            found.pop(code, None)
            failures[code] = str(error)
    for code in codes:
        if code not in found:
            failures.setdefault(code, '批量接口缺该基金的有效净值')
    return found, failures, {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'records': len(found)}


def prepare(codes, token):
    try:
        previous = json.loads((DATA / 'fund-latest-observations.json').read_text())
    except (OSError, ValueError):
        previous = {}
    codes = sorted(set(codes))
    chunks = [codes[i:i + 100] for i in range(0, len(codes), 100)]
    def requested(chunk):
        try:
            return fetch(chunk)
        except Exception as error:
            return {}, {code: str(error)[:200] for code in chunk}, None
    rows, failures, sources = {}, {}, []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for found, missing, source in pool.map(requested, chunks):
            rows.update(found); failures.update(missing)
            if source:
                sources.append(source)
    audit = {'observedAt': datetime.now(timezone.utc).isoformat(), 'endpoint': ENDPOINT,
             'rows': rows, 'failures': failures, 'sources': sources}
    audit['history'] = merge_history(previous, rows, audit['observedAt'], sources)
    if previous.get('historyBackfill'):
        audit['historyBackfill'] = previous['historyBackfill']
    atomic_text(CACHE, json.dumps({**audit, 'token': token}, ensure_ascii=False))
    atomic_text(DATA / 'fund-latest-observations.json', json.dumps(audit, ensure_ascii=False, separators=(',', ':')) + '\n')
    write_status('fund_batch', 'success' if not failures else 'partial' if rows else 'failed',
                 mode='online', records=len(rows), requested=len(codes), failures=failures,
                 message='批量取得最新净值及其原日期；缺项基金使用独立历史接口')
    return len(rows)


@lru_cache(maxsize=1)
def _load(token):
    if not token:
        return {}
    try:
        payload = json.loads(CACHE.read_text())
        return payload['rows'] if payload.get('token') == token else {}
    except (OSError, KeyError, ValueError):
        return {}


@lru_cache(maxsize=1)
def _history(token):
    if not token:
        return {}
    try:
        payload = json.loads(CACHE.read_text())
        return payload.get('history', {}) if payload.get('token') == token else {}
    except (OSError, ValueError):
        return {}


def recent(code):
    return _history(os.environ.get('FUND_DATA_REFRESH_TOKEN')).get(code, [])


def latest(code, through=None):
    current = _load(os.environ.get('FUND_DATA_REFRESH_TOKEN')).get(code)
    if not current or not through or current['FSRQ'] <= through:
        return current
    return max((row for row in recent(code) if row['FSRQ'] <= through),
               key=lambda row: row['FSRQ'], default=None)


def verified_weekday_tail(code, end, target, quote, previous):
    """Bridge consecutive weekdays only when every official observation exists."""
    saved = {row['FSRQ']: row for row in recent(code) if row.get('FCODE') == code}
    start, stop = date.fromisoformat(end), date.fromisoformat(target)
    days = [(start + timedelta(days=i)) for i in range(1, (stop - start).days + 1)]
    if not days or len(days) > 7 or any(day.weekday() >= 5 or day.isoformat() not in saved for day in days):
        return None
    initial = saved.get(end)
    nav = previous.get('navObservation') or {}
    if not initial or nav.get('navdate') != end or abs(float(nav.get('nav') or 0) - initial['DWJZ']) > 1e-8:
        return None
    if not matches_latest(saved[target], quote):
        return None
    return [initial, *(saved[day.isoformat()] for day in days)]


def cached_rows(code):
    """Read just the existing raw tail, not megabytes of unchanged history."""
    try:
        with (ROOT / '.tmp-hist' / (code + '.json')).open(encoding='utf-8') as source:
            text = source.read(32768).lstrip()
        if not text.startswith('['):
            return []
        decoder, position, rows = json.JSONDecoder(), 1, []
        while len(rows) < 20:
            while position < len(text) and text[position] in ' \r\n\t,':
                position += 1
            if position >= len(text) or text[position] == ']':
                break
            try:
                row, position = decoder.raw_decode(text, position)
            except ValueError:
                break
            if isinstance(row, dict) and row.get('FSRQ'):
                rows.append(row)
        return rows
    except (OSError, ValueError, TypeError):
        return []


def matches_latest(row, quote):
    try:
        if isinstance(row.get('DWJZ'), bool) or isinstance(row.get('JZZZL'), bool):
            return False
        return (row['FSRQ'] == quote['FSRQ'] and abs(float(row['DWJZ']) - quote['DWJZ']) < 1e-8
                and round(float(row['JZZZL']), 2) == round(quote['JZZZL'], 2))
    except (KeyError, TypeError, ValueError):
        return False


def ordinary_weekend(end, quote, rows, asset):
    """Use the official return only when NAV also confirms the entire interval."""
    old_day, new_day = date.fromisoformat(end), date.fromisoformat(quote['FSRQ'])
    if ((new_day - old_day).days != 3 or old_day.weekday() != 4 or new_day.weekday() != 0
            or old_day.month != new_day.month or '货币' in asset.get('name', '')
            or any(date.fromisoformat(r['FSRQ']).weekday() >= 5 for r in rows)):
        return False
    previous = next((r for r in rows if r['FSRQ'] == end), None)
    if previous is None:
        return False
    try:
        if isinstance(previous.get('DWJZ'), bool):
            return False
        raw_change = (quote['DWJZ'] / float(previous['DWJZ']) - 1) * 100
        return abs(raw_change - quote['JZZZL']) <= 0.00500001
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return False


def cached_tail(code, rows):
    """An unchanged observation or exactly one new calendar day needs no history request."""
    quote = latest(code)
    if not quote or not rows:
        return None
    last = max(rows, key=lambda row: row['FSRQ'])
    if quote['FSRQ'] == last['FSRQ']:
        if matches_latest(last, quote):
            return rows
    if (date.fromisoformat(quote['FSRQ']) - date.fromisoformat(last['FSRQ'])).days == 1:
        return [{**quote, 'NAV_SOURCE': ENDPOINT}, *rows]
    return None
