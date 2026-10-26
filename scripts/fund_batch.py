"""Dated, identity-checked batch NAV observations for one daily refresh."""
import hashlib
import json
import math
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path

from data_status import ROOT, DATA, atomic_text, write_status

ENDPOINT = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
CACHE = ROOT / '.tmp-snap' / 'fund-latest.json'


def observation(row, expected, today=None):
    code = str(row.get('FCODE') or '')
    if code not in expected:
        raise ValueError('批量净值证券身份不符：' + code)
    day = str(row.get('PDATE') or '')
    parsed = date.fromisoformat(day)
    if parsed > (today or date.today()):
        raise ValueError('批量净值日期在未来：' + code)
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


def latest(code):
    return _load(os.environ.get('FUND_DATA_REFRESH_TOKEN')).get(code)


def cached_tail(code, rows):
    """An unchanged observation or exactly one new calendar day needs no history request."""
    quote = latest(code)
    if not quote or not rows:
        return None
    last = max(rows, key=lambda row: row['FSRQ'])
    if quote['FSRQ'] == last['FSRQ']:
        try:
            if abs(float(last['DWJZ']) - quote['DWJZ']) < 1e-8 and round(float(last['JZZZL']), 2) == round(quote['JZZZL'], 2):
                return rows
        except (KeyError, TypeError, ValueError):
            pass
    if (date.fromisoformat(quote['FSRQ']) - date.fromisoformat(last['FSRQ'])).days == 1:
        return [{**quote, 'NAV_SOURCE': ENDPOINT}, *rows]
    return None
