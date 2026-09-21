#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ETF 买入策略固定快照回测
=========================

一次性计算 9 个美股 ETF 在 12 种买入策略下的结果，并写入 index.html 的
/*__DATA_STRATEGY_BEGIN__*/ ... /*__DATA_STRATEGY_END__*/ 数据块。

口径：
  1) 行情使用 Yahoo Finance 复权收盘价（含分红、拆分和基金费用）。
  2) 统一起点取 SOXX / USD / SOXL 上线后的 2010-03-11，截至 2026-09-18。
  3) 初始资金 100,000 美元；持续定投按每月 1,000 美元、每季 3,000 美元、
     每年 12,000 美元的基础预算。
  4) 交易成本、税费和现金利息均按 0；ETF 管理费等已包含在复权价格中。
  5) 定投年化使用 XIRR，最大回撤按剔除外部现金流影响后的单位净值计算。

用法：
  python strategy_backtest.py            使用缓存，缺失时联网抓取
  python strategy_backtest.py --refresh  强制刷新历史行情缓存
  python strategy_backtest.py --offline  只用缓存，不联网
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'index.html')
CACHE_DIR = os.path.join(HERE, '.tmp-strategy')
API_URL = 'https://qqq.tools24.uk/api/price-change/history-download'

START_DATE = '2010-03-11'
END_DATE = '2026-09-18'
INITIAL_CAPITAL = 100000.0
MONTHLY_CONTRIBUTION = 1000.0
TRADING_COST = 0.0
SOURCE_LABEL = 'Yahoo Finance adjusted close via GlobalAssetHistory'

ASSETS = [
    {'c': 'SPY', 'n': 'SPY', 'g': '标普500', 'lev': '1x'},
    {'c': 'SSO', 'n': 'SSO', 'g': '标普500', 'lev': '2x'},
    {'c': 'UPRO', 'n': 'UPRO', 'g': '标普500', 'lev': '3x'},
    {'c': 'QQQ', 'n': 'QQQ', 'g': '纳斯达克100', 'lev': '1x'},
    {'c': 'QLD', 'n': 'QLD', 'g': '纳斯达克100', 'lev': '2x'},
    {'c': 'TQQQ', 'n': 'TQQQ', 'g': '纳斯达克100', 'lev': '3x'},
    {'c': 'SOXX', 'n': 'SOXX', 'g': '半导体', 'lev': '1x'},
    {'c': 'USD', 'n': 'USD', 'g': '半导体', 'lev': '2x'},
    {'c': 'SOXL', 'n': 'SOXL', 'g': '半导体', 'lev': '3x'},
]

STRATEGIES = [
    {
        'id': 'lump_sum', 'panel': 'initial', 'name': '一次性买入',
        'desc': '期初 100,000 美元一次投入，持有到期末。',
    },
    {
        'id': 'tranche_6', 'panel': 'initial', 'name': '6个月分批',
        'desc': '连续 6 个月，每月首个交易日等额买入。',
    },
    {
        'id': 'tranche_12', 'panel': 'initial', 'name': '12个月分批',
        'desc': '连续 12 个月，每月首个交易日等额买入。',
    },
    {
        'id': 'tranche_24', 'panel': 'initial', 'name': '24个月分批',
        'desc': '连续 24 个月，每月首个交易日等额买入。',
    },
    {
        'id': 'drawdown_ladder', 'panel': 'initial', 'name': '回撤阶梯',
        'desc': '首投 25%，回撤 10%/20%/30% 各追加 25%；36 个月未触发则补投剩余资金。',
    },
    {
        'id': 'ma200_hold', 'panel': 'initial', 'name': '200日均线择时',
        'desc': '收盘站上 200 日均线时满仓，跌破转现金；信号下一交易日执行，现金收益按 0。',
    },
    {
        'id': 'dca_month', 'panel': 'dca', 'name': '每月定投',
        'desc': '每月首个交易日投入 1,000 美元。',
    },
    {
        'id': 'dca_quarter', 'panel': 'dca', 'name': '每季定投',
        'desc': '每季度首个交易日投入 3,000 美元，与月定投的年度基础预算一致。',
    },
    {
        'id': 'dca_year', 'panel': 'dca', 'name': '每年定投',
        'desc': '每年首个交易日投入 12,000 美元，与月定投的年度基础预算一致。',
    },
    {
        'id': 'dca_drawdown', 'panel': 'dca', 'name': '回撤倍数定投',
        'desc': '基础月投 1,000 美元；回撤 10%/20%/30% 时分别按 1.5/2/3 倍投入。',
    },
    {
        'id': 'dca_ma_trend', 'panel': 'dca', 'name': '均线顺势定投',
        'desc': '价格在 200 日均线上方时月投 1 倍，下方时降为 0.5 倍。',
    },
    {
        'id': 'dca_ma_contrarian', 'panel': 'dca', 'name': '均线逆势定投',
        'desc': '价格在 200 日均线上方时月投 1 倍，下方时提高为 2 倍。',
    },
]


def log(*args):
    try:
        print(*args, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode('gbk', 'replace').decode('gbk') for x in args], flush=True)


def parse_args():
    p = argparse.ArgumentParser(description='ETF 买入策略固定快照回测')
    p.add_argument('--refresh', action='store_true', help='强制刷新历史行情缓存')
    p.add_argument('--offline', action='store_true', help='只用本地缓存')
    return p.parse_args()


def http_json(url, payload, tries=6):
    body = json.dumps(payload).encode('utf-8')
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url,
                data=body,
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0',
                },
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i + 1 < tries:
                time.sleep(1.5 * (i + 1))
    raise RuntimeError('历史行情请求失败: %s' % last)


def cache_path(symbol):
    return os.path.join(CACHE_DIR, '%s.json' % symbol.lower())


def load_history(symbol, refresh=False, offline=False):
    path = cache_path(symbol)
    if os.path.exists(path) and not refresh:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
    else:
        if offline:
            raise RuntimeError('缺少缓存 %s，不能使用 --offline' % path)
        log('  - 获取 %s %s -> %s' % (symbol, START_DATE, END_DATE))
        data = http_json(API_URL, {
            'symbol': symbol,
            'type': 'stock',
            'period': 'daily',
            'start_date': START_DATE,
            'end_date': END_DATE,
        })
        rows = data.get('data') or []
        if len(rows) < 4000:
            raise RuntimeError('%s 历史数据不足: %d' % (symbol, len(rows)))
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, path)

    rows = data.get('data') or []
    out = {}
    for row in rows:
        date = str(row.get('date') or '')
        close = row.get('close')
        if date and close is not None and float(close) > 0:
            out[date] = float(close)
    return out


def align_history(refresh=False, offline=False):
    raw = {}
    for asset in ASSETS:
        symbol = asset['c']
        raw[symbol] = load_history(symbol, refresh=refresh, offline=offline)
    dates = sorted(set.intersection(*(set(v) for v in raw.values())))
    dates = [d for d in dates if START_DATE <= d <= END_DATE]
    if len(dates) < 4000:
        raise RuntimeError('共同交易日不足: %d' % len(dates))
    prices = {s: [raw[s][d] for d in dates] for s in raw}
    return dates, prices


def first_indices(dates):
    months = []
    seen = set()
    for i, date in enumerate(dates):
        key = date[:7]
        if key not in seen:
            months.append(i)
            seen.add(key)
    return months


def quarter_indices(dates, months):
    return [i for i in months if int(dates[i][5:7]) in (1, 4, 7, 10)]


def year_indices(dates, months):
    return [i for i in months if dates[i][5:7] == '01']


def moving_average(values, window):
    out = [None] * len(values)
    running = 0.0
    for i, value in enumerate(values):
        running += value
        if i >= window:
            running -= values[i - window]
        if i >= window - 1:
            out[i] = running / window
    return out


def previous_ma_signal(prices, window=200):
    ma = moving_average(prices, window)
    signal = [0.0] * len(prices)
    for i in range(1, len(prices)):
        if ma[i - 1] is not None:
            signal[i] = 1.0 if prices[i - 1] > ma[i - 1] else 0.0
    return signal


def prior_drawdown(prices, i):
    if i <= 0:
        return 0.0
    peak = max(prices[:i])
    return prices[i - 1] / peak - 1.0 if peak > 0 else 0.0


def tranche_events(months, count, budget):
    return {months[i]: budget / count for i in range(min(count, len(months)))}


def drawdown_ladder_events(prices, months, budget):
    events = {months[0]: budget * 0.25}
    remaining = budget * 0.75
    peak = prices[months[0]]
    hit = set()
    fallback = months[min(36, len(months) - 1)]

    for i, price in enumerate(prices):
        peak = max(peak, price)
        dd = price / peak - 1.0
        for threshold in (0.10, 0.20, 0.30):
            if threshold in hit or dd > -threshold or remaining <= 1e-9:
                continue
            amount = min(budget * 0.25, remaining)
            execute = min(i + 1, len(prices) - 1)
            events[execute] = events.get(execute, 0.0) + amount
            remaining -= amount
            hit.add(threshold)
        if i >= fallback and remaining > 1e-9:
            events[i] = events.get(i, 0.0) + remaining
            remaining = 0.0
            break

    if remaining > 1e-9:
        events[len(prices) - 1] = events.get(len(prices) - 1, 0.0) + remaining
    return events


def drawdown_multiplier(dd):
    if dd > -0.10:
        return 1.0
    if dd > -0.20:
        return 1.5
    if dd > -0.30:
        return 2.0
    return 3.0


def dca_drawdown_events(prices, months):
    events = {}
    peak = prices[0]
    for i in months:
        if i > 0:
            peak = max(peak, max(prices[:i]))
            dd = prices[i - 1] / peak - 1.0
        else:
            dd = 0.0
        events[i] = MONTHLY_CONTRIBUTION * drawdown_multiplier(dd)
    return events


def dca_ma_events(prices, months, contrarian=False):
    signal = previous_ma_signal(prices)
    events = {}
    for i in months:
        if i == 0 or signal[i] == 0.0:
            multiplier = 2.0 if contrarian else 0.5
        else:
            multiplier = 1.0
        events[i] = MONTHLY_CONTRIBUTION * multiplier
    return events


def strategy_inputs(prices, dates):
    months = first_indices(dates)
    quarters = quarter_indices(dates, months)
    years = year_indices(dates, months)
    ma_signal = previous_ma_signal(prices)
    return {
        'lump_sum': ({months[0]: INITIAL_CAPITAL}, None),
        'tranche_6': (tranche_events(months, 6, INITIAL_CAPITAL), None),
        'tranche_12': (tranche_events(months, 12, INITIAL_CAPITAL), None),
        'tranche_24': (tranche_events(months, 24, INITIAL_CAPITAL), None),
        'drawdown_ladder': (drawdown_ladder_events(prices, months, INITIAL_CAPITAL), None),
        'ma200_hold': ({months[0]: INITIAL_CAPITAL}, ma_signal),
        'dca_month': ({i: MONTHLY_CONTRIBUTION for i in months}, None),
        'dca_quarter': ({i: MONTHLY_CONTRIBUTION * 3 for i in quarters}, None),
        'dca_year': ({i: MONTHLY_CONTRIBUTION * 12 for i in years}, None),
        'dca_drawdown': (dca_drawdown_events(prices, months), None),
        'dca_ma_trend': (dca_ma_events(prices, months, False), None),
        'dca_ma_contrarian': (dca_ma_events(prices, months, True), None),
    }


def xirr(flows):
    flows = sorted(flows, key=lambda x: x[0])
    if not flows:
        return None

    def value(rate):
        base = flows[0][0]
        return sum(
            amount / ((1.0 + rate) ** ((day - base).days / 365.2425))
            for day, amount in flows
        )

    low, high = -0.999999, 10.0
    f_low, f_high = value(low), value(high)
    if f_low * f_high > 0:
        high = 100.0
        f_high = value(high)
    if f_low * f_high > 0:
        return None

    for _ in range(240):
        mid = (low + high) / 2.0
        if value(low) * value(mid) <= 0:
            high = mid
        else:
            low = mid
    return (low + high) / 2.0


def drawdown_metrics(nav):
    peak = nav[0] if nav else 1.0
    peak_index = 0
    max_dd = 0.0
    longest = 0
    for i, value in enumerate(nav):
        if value >= peak:
            peak = value
            peak_index = i
        else:
            longest = max(longest, i - peak_index)
            max_dd = min(max_dd, value / peak - 1.0)
    return max_dd, longest


def simulate(dates, prices, events, exposure=None):
    units = 0.0
    asset_units = 0.0
    cash = 0.0
    nav = []
    flows = []
    total_contrib = 0.0
    trade_count = 0
    exposure_sum = 0.0

    for i, (date, price) in enumerate(zip(dates, prices)):
        value_before = cash + asset_units * price
        contribution = events.get(i, 0.0)
        if contribution > 0:
            nav_before = value_before / units if units > 0 else 1.0
            units += contribution / nav_before
            cash += contribution
            total_contrib += contribution
            flows.append((datetime.strptime(date, '%Y-%m-%d'), -contribution))

        target = 1.0 if exposure is None else exposure[i]
        total_value = cash + asset_units * price
        target_units = total_value * target / price
        delta_units = target_units - asset_units
        if abs(delta_units * price) > 1e-7:
            trade_value = abs(delta_units) * price
            cost = trade_value * TRADING_COST
            if delta_units > 0:
                cash -= delta_units * price + cost
            else:
                cash += (-delta_units) * price - cost
            asset_units = target_units
            trade_count += 1

        value = cash + asset_units * price
        nav.append(value / units if units > 0 else 1.0)
        exposure_sum += (asset_units * price / value) if value > 0 else 0.0

    final_value = cash + asset_units * prices[-1]
    flows.append((datetime.strptime(dates[-1], '%Y-%m-%d'), final_value))
    max_dd, underwater = drawdown_metrics(nav)
    annualized = xirr(flows)
    return {
        'invested': total_contrib,
        'end_value': final_value,
        'total_return': (final_value / total_contrib - 1.0) * 100.0 if total_contrib else None,
        'irr': annualized * 100.0 if annualized is not None else None,
        'mdd': max_dd * 100.0,
        'underwater': underwater,
        'avg_exposure': exposure_sum / len(prices) * 100.0,
        'trades': trade_count,
    }


def round_metrics(metrics):
    return {
        'inv': round(metrics['invested'], 2),
        'end': round(metrics['end_value'], 2),
        'ret': round(metrics['total_return'], 4) if metrics['total_return'] is not None else None,
        'irr': round(metrics['irr'], 4) if metrics['irr'] is not None else None,
        'mdd': round(metrics['mdd'], 4),
        'uw': metrics['underwater'],
        'exp': round(metrics['avg_exposure'], 4),
        'tr': metrics['trades'],
    }


def build_results(dates, prices):
    results = []
    for asset in ASSETS:
        symbol = asset['c']
        inputs = strategy_inputs(prices[symbol], dates)
        for strategy in STRATEGIES:
            events, exposure = inputs[strategy['id']]
            metrics = round_metrics(simulate(dates, prices[symbol], events, exposure))
            metrics.update({'a': symbol, 'p': strategy['panel'], 's': strategy['id']})
            results.append(metrics)
    return results


def js_data(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


def write_html(results):
    with open(HTML, 'r', encoding='utf-8') as fh:
        src = fh.read()

    meta = {
        'start': START_DATE,
        'end': END_DATE,
        'initial': INITIAL_CAPITAL,
        'monthly': MONTHLY_CONTRIBUTION,
        'cost': TRADING_COST,
        'source': SOURCE_LABEL,
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }
    block = (
        '/*__DATA_STRATEGY_BEGIN__*/\n'
        'var STRATEGY_META=' + js_data(meta) + ';\n'
        'var STRATEGY_ASSETS=' + js_data(ASSETS) + ';\n'
        'var STRATEGY_DEFS=' + js_data(STRATEGIES) + ';\n'
        'var STRATEGY_RESULTS=' + js_data(results) + ';\n'
        '/*__DATA_STRATEGY_END__*/'
    )
    pattern = re.compile(
        r'/\*__DATA_STRATEGY_BEGIN__\*/.*?/\*__DATA_STRATEGY_END__\*/',
        re.S,
    )
    if pattern.search(src):
        out = pattern.sub(block, src, count=1)
    else:
        marker = '/*__DATA_META_END__*/'
        if marker not in src:
            raise RuntimeError('index.html 缺少 DATA_META_END 标记')
        out = src.replace(marker, marker + '\n\n' + block, 1)

    tmp = HTML + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(out)
    os.replace(tmp, HTML)


def main():
    args = parse_args()
    log('ETF 策略回测: %s -> %s' % (START_DATE, END_DATE))
    dates, prices = align_history(refresh=args.refresh, offline=args.offline)
    results = build_results(dates, prices)
    write_html(results)

    def pick(asset, strategy):
        return next(
            x for x in results
            if x['a'] == asset and x['s'] == strategy
        )

    qqq = pick('QQQ', 'dca_month')
    tqqq = pick('TQQQ', 'dca_month')
    soxl = pick('SOXL', 'dca_month')
    log('')
    log('固定月定投（资金加权年化 / 最大回撤）:')
    log('  QQQ : %8.2f%% / %7.2f%%' % (qqq['irr'], qqq['mdd']))
    log('  TQQQ: %8.2f%% / %7.2f%%' % (tqqq['irr'], tqqq['mdd']))
    log('  SOXL: %8.2f%% / %7.2f%%' % (soxl['irr'], soxl['mdd']))
    log('')
    log('已写入 %s（%d 行结果，固定快照，不参与每日更新）' % (HTML, len(results)))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        log('!! 回测失败: %s' % exc)
        sys.exit(1)
