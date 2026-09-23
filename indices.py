#!/usr/bin/env python3
"""Fetch index closes and calculate independent price-index returns.

No fund records are read by this module. Missing history stays missing. The
checked-in history makes calculations reproducible without a working network.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import json
import math
from pathlib import Path
import statistics
import sys
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
HISTORY_PATH = ROOT / 'data' / 'index-history.json'
OUTPUT_PATH = ROOT / 'data' / 'indices.js'
PERIODS = [1, 2, 3, 5, 10]
CSI = 'https://www.csindex.com.cn/csindex-home/perf/index-perf'
SINA = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
CNI = 'https://hq.cnindex.com.cn/market/market/getIndexDailyDataWithDataFormat'
PRICE_BASIS = '价格指数收盘点位；不含现金分红再投资'

# Codes refer to indices, never similarly named funds. Launch dates distinguish
# an index provider's pre-launch back-calculation from a live track record.
SPECS = [
    dict(c='000001', n='上证指数', category='宽基', launchDate='1991-07-15', symbol='sh000001'),
    dict(c='000016', n='上证50', category='宽基', launchDate='2004-01-02', symbol='sh000016'),
    dict(c='000300', n='沪深300', category='宽基', launchDate='2005-04-08', symbol='sh000300'),
    dict(c='000905', n='中证500', category='宽基', launchDate='2007-01-15', symbol='sh000905'),
    dict(c='000852', n='中证1000', category='小微盘', launchDate='2014-10-17', symbol='sh000852'),
    dict(c='932000', n='中证2000', category='小微盘', launchDate='2023-08-11', baseDate='2013-12-31'),
    dict(c='399001', n='深证成指', category='宽基', launchDate='1995-01-23', symbol='sz399001', provider='cni'),
    dict(c='399006', n='创业板指', category='成长', launchDate='2010-06-01', symbol='sz399006', provider='cni'),
    dict(c='000688', n='科创50', category='成长', launchDate='2020-07-23', baseDate='2019-12-31', symbol='sh000688'),
    dict(c='000698', n='科创100', category='成长', launchDate='2023-08-07', baseDate='2019-12-31', symbol='sh000698'),
    dict(c='899050', n='北证50', category='小微盘', launchDate='2022-11-21', baseDate='2022-04-29', symbol='bj899050'),
    dict(c='931643', n='科创创业50', category='成长', launchDate='2021-06-01', baseDate='2019-12-31'),
    dict(c='8841431.WI', n='万得微盘股指数', category='小微盘', provider='licensed'),
]


def subtract_years(day: str, years: int) -> str:
    d = date.fromisoformat(day)
    try:
        return d.replace(year=d.year - years).isoformat()
    except ValueError:
        return d.replace(year=d.year - years, day=28).isoformat()


def default_asof() -> str:
    now = datetime.now(ZoneInfo('Asia/Shanghai'))
    # A daily bar can contain a live quote. Do not label it a closing price.
    return (now.date() if now.hour >= 16 else now.date() - timedelta(days=1)).isoformat()


def request_json(url: str, timeout: float = 15):
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.csindex.com.cn/'
                if 'csindex' in url else 'https://www.cnindex.com.cn/'})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except (OSError, ValueError) as exc:
            last = exc
            if not attempt:
                time.sleep(.4)
    raise RuntimeError(str(last))


def normalize_series(rows, asof: str):
    points = {}
    for day, close in rows:
        date.fromisoformat(day)
        value = float(close)
        if not math.isfinite(value) or value <= 0:
            raise ValueError('指数点位必须为有限正数')
        if day in points and points[day] != value:
            raise ValueError('同交易日存在冲突点位：' + day)
        if day <= asof:
            points[day] = value
    return sorted(points.items())


def official_url(spec):
    if spec['c'].startswith('399'):
        return 'https://www.cnindex.com.cn/module/index-detail.html?act_menu=1&indexCode=' + spec['c']
    if spec.get('provider') == 'licensed':
        return 'https://www.windindices.com/indices/zh/IndexF9/1a073179a3f0bebf923a0259cee963e4'
    return 'https://www.csindex.com.cn/#/indices/family/detail?indexCode=' + spec['c']


def fetch_history(spec, asof, timeout=15):
    start = (date.fromisoformat(subtract_years(asof, 10)) - timedelta(days=20)).isoformat()
    source = '中证指数官网'
    if spec.get('provider') == 'cni':
        url = CNI + '?' + urllib.parse.urlencode(dict(indexCode=spec['c'], startDate=start, endDate=asof, frequency='day'))
        payload = request_json(url, timeout)
        data = payload.get('data') or {}
        if str(payload.get('code')) != '200' or not data.get('data'):
            raise ValueError('国证指数官方日线为空')
        if data.get('indexCode') != spec['c'] or data.get('indexName') != spec['n']:
            raise ValueError('国证返回的指数身份与请求不一致')
        day_pos, close_pos = data['item'].index('timestamp'), data['item'].index('close')
        rows = [(r[day_pos][:10], r[close_pos]) for r in data['data']]
        source = '国证指数官网'
    else:
        url = CSI + '?' + urllib.parse.urlencode(dict(indexCode=spec['c'], startDate=start.replace('-', ''), endDate=asof.replace('-', '')))
        payload = request_json(url, timeout)
        data = payload.get('data') or []
        if str(payload.get('code')) != '200' or not data:
            raise ValueError('中证指数官方日线为空')
        if any(str(r.get('indexCode')) != spec['c'] or r.get('indexNameCn') != spec['n'] for r in data):
            raise ValueError('供应商返回的指数身份与请求不一致')
        rows = [(datetime.strptime(r['tradeDate'], '%Y%m%d').date().isoformat(), r['close']) for r in data]
    # CSI's chart API sometimes inserts a base-value anchor on the requested
    # start date, even before the index base date. It is not an observation.
    normalized = normalize_series(rows, asof)
    discarded = [(d, p) for d, p in normalized if d < spec.get('baseDate', '0000-00-00')]
    series = [(d, p) for d, p in normalized if d >= max(start, spec.get('baseDate', '0000-00-00'))]
    if len(series) < 2:
        raise ValueError('没有足够的有效指数收盘数据')
    return dict(c=spec['c'], n=spec['n'], source=source, sourceUrl=url,
                fetchedAt=datetime.now(timezone.utc).isoformat(), points=series, discardedBeforeBase=discarded)


def calculate(series):
    """Cumulative returns and complete-window risk; no partial-period fallback."""
    if not series:
        return dict(r=[None] * 5, mdd5=None, vol5=None, asof=None, first=None, baseDates=[None] * 5)
    days = [d for d, _p in series]
    latest, end = series[-1]
    returns, bases = [], []
    for years in PERIODS:
        target = subtract_years(latest, years)
        pos = bisect_right(days, target) - 1
        base = series[pos] if pos >= 0 else None
        # Do not bridge a stale or incomplete base period using a distant quote.
        if base is None or (date.fromisoformat(target) - date.fromisoformat(base[0])).days > 15:
            returns.append(None)
            bases.append(None)
        else:
            returns.append(round((end / base[1] - 1) * 100, 4))
            bases.append(base[0])
    mdd = vol = None
    if bases[3]:
        window = series[bisect_right(days, bases[3]) - 1:]
        gaps_ok = all((date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days <= 15
                      for a, b in zip(window, window[1:]))
        if len(window) >= 5 * 180 and gaps_ok:
            peak, mdd = window[0][1], 0.0
            for _d, price in window:
                peak = max(peak, price)
                mdd = min(mdd, (price / peak - 1) * 100)
            logs = [math.log(b[1] / a[1]) for a, b in zip(window, window[1:])]
            vol = statistics.stdev(logs) * math.sqrt(252) * 100
            mdd, vol = round(mdd, 4), round(vol, 4)
    return dict(r=returns, mdd5=mdd, vol5=vol, asof=latest, first=series[0][0], baseDates=bases,
                observations=len(series), close=end)


def make_record(spec, history=None, status='available', error=None, asof=None):
    rec = {k: spec[k] for k in ('c', 'n', 'category')}
    rec.update(dict(source=None, sourceUrl=official_url(spec), basis=PRICE_BASIS, status=status,
                    note='', launchDate=spec.get('launchDate'), baseDate=spec.get('baseDate'), identityUrl=official_url(spec)))
    if history:
        points = [(d, p) for d, p in normalize_series(history['points'], asof or history['points'][-1][0])
                  if d >= spec.get('baseDate', '0000-00-00')]
        rec.update(calculate(points))
        rec.update({k: history.get(k) for k in ('source', 'sourceUrl', 'fetchedAt')})
    else:
        rec.update(calculate([]))
    if spec.get('provider') == 'licensed':
        rec.update(status='unavailable', source='Wind', note='未接入可复核的完整授权日线；不以基金或其他微盘指数代替。')
    else:
        notes = []
        if error:
            notes.append('本次抓取失败；保留缓存原日期。' if history else '本次抓取失败，暂无有效历史。')
            rec['error'] = error
        if rec.get('asof') and asof and (date.fromisoformat(asof) - date.fromisoformat(rec['asof'])).days > 7:
            rec['status'] = 'stale'
            notes.append('源数据超过7个自然日未更新。')
        rec['backfilledPeriods'] = [y for y, d in zip(PERIODS, rec['baseDates'])
                                   if d and spec.get('launchDate') and d < spec['launchDate']]
        if rec['backfilledPeriods']:
            notes.append('部分长周期包含指数发布前回溯，非同期可投资记录。')
        if rec['mdd5'] is None:
            notes.append('没有覆盖完整5年的连续日线，5年风险留空。')
        rec['note'] = ' '.join(notes)
    return rec


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    temp.replace(path)


def verify_history(timeout=15):
    """Cross-check sampled official closes against an independent distributor."""
    history = json.loads(HISTORY_PATH.read_text(encoding='utf-8'))['indices']
    checks = []
    failures = 0
    for spec in SPECS:
        if spec.get('provider') == 'licensed':
            continue
        if not spec.get('symbol'):
            checks.append(dict(code=spec['c'], name=spec['n'], status='primary_only',
                               note='已校验官方代码名称与基日；本次未取得第二来源的可比日线。'))
            continue
        url = SINA + '?' + urllib.parse.urlencode(dict(symbol=spec['symbol'], scale=240, ma='no', datalen=4000))
        try:
            rows = request_json(url, timeout)
            secondary = {row['day'][:10]: float(row['close']) for row in rows}
            primary = dict(history[spec['c']]['points'])
            common = sorted(set(primary).intersection(secondary))
            if len(common) < 3:
                raise ValueError('没有足够的相同交易日')
            sample_days = [common[0], common[len(common) // 2], common[-1]]
            samples = [dict(date=day, official=primary[day], secondSource=secondary[day],
                            delta=round(primary[day] - secondary[day], 7)) for day in sample_days]
            matched = all(abs(sample['delta']) <= .006 for sample in samples)
            checks.append(dict(code=spec['c'], name=spec['n'], source=history[spec['c']]['source'],
                               primaryUrl=history[spec['c']]['sourceUrl'], checkUrl=url, samples=samples,
                               withinRounding=matched, status='matched' if matched else 'mismatch'))
            failures += not matched
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            failures += 1
            checks.append(dict(code=spec['c'], name=spec['n'], status='failed', error=str(exc)))
    atomic_json(ROOT / 'data' / 'index-validation.json', dict(
        checkedAt=datetime.now(timezone.utc).isoformat(), checks=checks,
        matchedCount=sum(c['status'] == 'matched' for c in checks),
        primaryOnlyCount=sum(c['status'] == 'primary_only' for c in checks),
        tolerancePoints=.006, scope='每条可比指数首、中、末三个相同交易日；非全历史逐点交叉验证'))
    print('指数交叉抽验：%d条相符，%d条仅官方源，%d条失败' %
          (sum(c['status'] == 'matched' for c in checks), sum(c['status'] == 'primary_only' for c in checks), failures))
    return 1 if failures else 0


def refresh(asof=None, offline=False, timeout=15, history_path=HISTORY_PATH, output_path=OUTPUT_PATH):
    asof = asof or default_asof()
    date.fromisoformat(asof)
    cached = json.loads(history_path.read_text(encoding='utf-8')) if history_path.exists() else {'indices': {}}
    saved = cached.setdefault('indices', {})
    errors = {}

    def one(spec):
        if spec.get('provider') == 'licensed' or offline:
            return spec['c'], None, None
        try:
            return spec['c'], fetch_history(spec, asof, timeout), None
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            return spec['c'], None, str(exc)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for code, result, error in pool.map(one, SPECS):
            if result:
                saved[code] = result
            elif error:
                errors[code] = error
    records = []
    for spec in SPECS:
        history = saved.get(spec['c'])
        if history and (history.get('c'), history.get('n')) != (spec['c'], spec['n']):
            errors[spec['c']] = '缓存指数身份不匹配'
            history = None
        status = ('cached' if offline or spec['c'] in errors else 'available') if history else 'unavailable'
        records.append(make_record(spec, history, status, errors.get(spec['c']), asof))
        if not history and spec.get('provider') != 'licensed':
            errors.setdefault(spec['c'], '缺少有效缓存')
    if not offline:
        atomic_json(history_path, cached)
    dates = sorted(r['asof'] for r in records if r['asof'])
    meta = dict(version=1, generatedAt=datetime.now(timezone.utc).isoformat(), requestedAsOf=asof,
                asof=dates[-1] if dates else None, dateRange=[dates[0], dates[-1]] if dates else [],
                periods=PERIODS, returnType='cumulative', unit='percent', basis=PRICE_BASIS,
                riskWindowYears=5, volatilityAnnualization=252, offline=offline,
                historyFile='data/index-history.json', observedCount=sum(bool(r['asof']) for r in records),
                availableCount=sum(r['status'] == 'available' for r in records), unavailableCount=sum(not r['asof'] for r in records),
                errors=errors, methodology='区间累计=期末收盘/周年日或此前最近交易日收盘−1；5年回撤为日收盘峰谷跌幅，波动为日对数收益样本标准差×√252。价格指数不含现金分红再投资。')
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_suffix('.js.tmp')
    tmp.write_text('// Generated by indices.py. Index prices are independent of fund returns.\nvar INDEX_DATA=' +
                   json.dumps(records, ensure_ascii=False, separators=(',', ':')) + ';\nvar INDEX_META=' +
                   json.dumps(meta, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    tmp.replace(output_path)
    for rec in records:
        print(f"{rec['c']} {rec['n']}: {rec['status']} {rec['asof'] or '无日线'}", flush=True)
    if errors:
        print(json.dumps(errors, ensure_ascii=False), file=sys.stderr)
    return 1 if errors else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--as-of', help='截至交易日 YYYY-MM-DD；默认仅使用已结束交易日')
    ap.add_argument('--offline', action='store_true', help='只用已保存的原始指数收盘序列重新计算')
    ap.add_argument('--verify', action='store_true', help='用新浪日线抽样交叉核验已保存的官方指数点位')
    ap.add_argument('--timeout', type=float, default=15, help='单次网络请求超时秒数（每源最多2次）')
    args = ap.parse_args()
    if args.timeout <= 0 or args.timeout > 60:
        ap.error('--timeout 必须大于0且不超过60')
    if args.verify:
        return verify_history(args.timeout)
    return refresh(args.as_of, args.offline, args.timeout)


if __name__ == '__main__':
    sys.exit(main())
