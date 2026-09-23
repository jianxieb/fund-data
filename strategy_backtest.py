#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ETF 买入策略固定快照回测
=========================

一次性计算 9 个美股 ETF 在 12 种买入策略下的结果，并写入 data/snapshot.js 的
/*__DATA_STRATEGY_BEGIN__*/ ... /*__DATA_STRATEGY_END__*/ 数据块。

口径：
  1) 直接读取 Yahoo chart indicators.adjclose，记录源字段；拒绝含糊的第三方 close。
  2) 统一起点 2010-03-11；截止日默认昨天，可 --end 指定；输出使用真实共同交易日期。
  3) 初始资金 100,000 美元期初全额入账（含待投现金）；持续定投按每月 1,000 美元、每季 3,000 美元、
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
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from data_status import write_status

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'data', 'snapshot.js')
CACHE_DIR = os.path.join(HERE, '.tmp-strategy')
API_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/'

START_DATE = '2010-03-11'
END_DATE = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
INITIAL_CAPITAL = 100000.0
MONTHLY_CONTRIBUTION = 1000.0
TRADING_COST = 0.0
SOURCE_LABEL = 'Yahoo Finance chart: indicators.adjclose (provider adjusted close)'

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
        'desc': '每季度首个交易日投入 3,000 美元，不完整季度按样本月数预算，与月定投总预算相同。',
    },
    {
        'id': 'dca_year', 'panel': 'dca', 'name': '每年定投',
        'desc': '每年首个交易日投入 12,000 美元，不完整年度按样本月数预算，与月定投总预算相同。',
    },
    {
        'id': 'dca_drawdown', 'panel': 'dca', 'name': '回撤倍数定投',
        'desc': '基础月投 1,000 美元；回撤 10%/20%/30% 时分别按 1.5/2/3 倍投入。',
    },
    {
        'id': 'dca_ma_trend', 'panel': 'dca', 'name': '均线顺势定投',
        'desc': '价格在 200 日均线上方时月投 1 倍，下方时降为 0.5 倍；均线未形成时按 1 倍。',
    },
    {
        'id': 'dca_ma_contrarian', 'panel': 'dca', 'name': '均线逆势定投',
        'desc': '价格在 200 日均线上方时月投 1 倍，下方时提高为 2 倍；均线未形成时按 1 倍。',
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
    p.add_argument('--end', default=END_DATE, help='回测截止日 YYYY-MM-DD')
    return p.parse_args()


def cache_path(symbol):
    return os.path.join(CACHE_DIR, '%s-adjusted-v3.json' % symbol.lower())


def normalize_chart(node, symbol, source_url):
    """A daily bar belongs to the exchange's civil date, not necessarily its UTC date."""
    metadata = node.get('meta', {}) if node else {}
    if metadata.get('symbol', '').upper() != symbol.upper():
        raise ValueError('标的标识不匹配')
    if symbol == 'CNY=X' and metadata.get('currency') != 'CNY':
        raise ValueError('美元兑人民币日线的报价币种不匹配')
    zone_name = metadata.get('exchangeTimezoneName')
    if not zone_name:
        raise ValueError('缺少交易时区，不能确定日线日期')
    local_zone = ZoneInfo(zone_name)
    timestamps = node.get('timestamp') or []
    adjusted = (node.get('indicators', {}).get('adjclose') or [{}])[0].get('adjclose') or []
    if len(timestamps) != len(adjusted) or not adjusted:
        raise ValueError('缺少显式 adjusted close 字段；不接受普通 close 替代')
    rows, missing, dates = [], [], set()
    for stamp, value in zip(timestamps, adjusted):
        day = datetime.fromtimestamp(stamp, local_zone).strftime('%Y-%m-%d')
        if day in dates:
            raise ValueError('源日线在当地日期重复：' + day)
        dates.add(day)
        if value is None or not math.isfinite(float(value)) or float(value) <= 0:
            missing.append({'date': day, 'timestamp': stamp, 'reason': 'provider_null_or_invalid'})
            continue
        rows.append({'date': day, 'adjustedClose': value, 'timestamp': stamp})
    return {'schemaVersion': 3, 'symbol': symbol, 'basis': 'yahoo_adjusted_close',
            'source': source_url, 'exchangeTimezoneName': zone_name,
            'dateConvention': 'exchange_local_date', 'currency': metadata.get('currency'),
            'fetchedAt': datetime.now(timezone.utc).isoformat(), 'data': rows,
            'missingObservations': missing}


def load_history(symbol, refresh=False, offline=False):
    path = cache_path(symbol)
    # Existing US-ETF snapshots remain usable offline; FX v2 is expressly excluded
    # because London summer-midnight bars were assigned to the preceding UTC date.
    legacy = os.path.join(CACHE_DIR, '%s-adjusted-v2.json' % symbol.lower())
    if not os.path.exists(path) and symbol in {item['c'] for item in ASSETS} | {'^GSPC', '^IXIC', '^NDX'} and (offline or not refresh) and os.path.exists(legacy):
        path = legacy
    if os.path.exists(path) and (offline or not refresh):
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        if data.get('basis') != 'yahoo_adjusted_close' or data.get('symbol') != symbol:
            raise RuntimeError('缓存未通过标的/复权口径验证：' + symbol)
        if symbol.endswith('=X') and (data.get('schemaVersion', 0) < 3 or data.get('dateConvention') != 'exchange_local_date'):
            raise RuntimeError('旧外汇缓存没有交易时区证明，必须重新获取原始时间戳')
    else:
        if offline:
            raise RuntimeError('缺少经口径校验的缓存：' + symbol)
        start = int(datetime(2009, 1, 1, tzinfo=timezone.utc).timestamp())
        end = int((datetime.strptime(END_DATE, '%Y-%m-%d').replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp())
        url = API_URL + symbol + '?period1=%d&period2=%d&interval=1d&events=div%%2Csplits' % (start, end)
        last = None
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=15) as response:
                    payload = json.load(response)
                node = (payload.get('chart', {}).get('result') or [None])[0]
                data = normalize_chart(node, symbol, url)
                if len(data['data']) < 250:
                    raise ValueError('历史数据不足一年')
                os.makedirs(CACHE_DIR, exist_ok=True)
                temporary = path + '.tmp'
                with open(temporary, 'w', encoding='utf-8') as fh:
                    json.dump(data, fh, ensure_ascii=False, allow_nan=False)
                os.replace(temporary, path)
                break
            except Exception as exc:
                last = exc
        else:
            raise RuntimeError('%s 复权历史获取失败：%s' % (symbol, last))
    out = {}
    for row in data.get('data') or []:
        date, close = row.get('date'), row.get('adjustedClose')
        if date and close is not None and math.isfinite(float(close)) and float(close) > 0:
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
    return [i for n, i in enumerate(months) if n == 0 or dates[i][:4] != dates[months[n-1]][:4] or (int(dates[i][5:7])-1)//3 != (int(dates[months[n-1]][5:7])-1)//3]


def year_indices(dates, months):
    return [i for n, i in enumerate(months) if n == 0 or dates[i][:4] != dates[months[n-1]][:4]]


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
    fallback = months[36] if len(months) > 36 else len(prices)

    for i, price in enumerate(prices):
        if i >= fallback and remaining > 1e-9:
            events[i] = events.get(i, 0.0) + remaining
            remaining = 0.0
            break
        peak = max(peak, price)
        dd = price / peak - 1.0
        for threshold in (0.10, 0.20, 0.30):
            if threshold in hit or dd > -threshold or remaining <= 1e-9:
                continue
            amount = min(budget * 0.25, remaining)
            if i + 1 >= len(prices):
                continue
            execute = i + 1
            events[execute] = events.get(execute, 0.0) + amount
            remaining -= amount
            hit.add(threshold)

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
        if i < 200:
            multiplier = 1.0  # Missing history does not constitute a downtrend signal.
        elif signal[i] == 0.0:
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
        'dca_quarter': ({i: MONTHLY_CONTRIBUTION * sum(1 for j in months if dates[j][:4] == dates[i][:4] and (int(dates[j][5:7])-1)//3 == (int(dates[i][5:7])-1)//3) for i in quarters}, None),
        'dca_year': ({i: MONTHLY_CONTRIBUTION * sum(1 for j in months if dates[j][:4] == dates[i][:4]) for i in years}, None),
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


def simulate(dates, prices, events, exposure=None, initial_capital=None, sample_indices=None):
    """All pre-existing capital enters on day zero, including undeployed cash.

    events are purchases from that cash for initial-capital experiments; otherwise
    they are external contributions. Trades execute at that day's close; signals
    must therefore have been observed no later than the prior trading close.
    """
    if not dates or len(prices) != len(dates) or any(p <= 0 for p in prices):
        raise ValueError('日期与价格无效')
    funded = initial_capital is not None
    cash = float(initial_capital or 0.0)
    units = cash
    asset_units = 0.0
    nav, flows = [], []
    total_contrib, trade_count, exposure_sum = cash, 0, 0.0
    min_cash = cash
    if cash:
        flows.append((datetime.strptime(dates[0], '%Y-%m-%d'), -cash))
    for i, (date, price) in enumerate(zip(dates, prices)):
        value_before = cash + asset_units * price
        amount = events.get(i, 0.0)
        if amount < 0:
            raise ValueError('不支持负贡献')
        if not funded and amount > 0:
            nav_before = value_before / units if units > 0 else 1.0
            units += amount / nav_before
            cash += amount
            total_contrib += amount
            flows.append((datetime.strptime(date, '%Y-%m-%d'), -amount))
        if exposure is None:
            buy_budget = min(cash, amount)
            buy_value = buy_budget / (1.0 + TRADING_COST)
            if buy_value > 1e-8:
                asset_units += buy_value / price
                cash -= buy_budget
                trade_count += 1
        else:
            target = exposure[i]
            if not 0 <= target <= 1:
                raise ValueError('组合仓位必须在0到1之间；ETF自带杠杆已在价格里')
            value = cash + asset_units * price
            held = asset_units * price
            desired = value * target
            delta = desired - held
            if delta > 1e-8:
                # Account for the cost in post-trade portfolio value.
                buy_value = min(cash / (1 + TRADING_COST), delta / (1 + target * TRADING_COST))
                asset_units += buy_value / price
                cash -= buy_value * (1 + TRADING_COST)
                trade_count += 1
            elif delta < -1e-8:
                sell_value = min(held, -delta / (1 - target * TRADING_COST))
                asset_units -= sell_value / price
                cash += sell_value * (1 - TRADING_COST)
                trade_count += 1
        if cash < -1e-7:
            raise ValueError('交易导致无意借款')
        cash = max(0.0, cash)
        min_cash = min(min_cash, cash)
        value = cash + asset_units * price
        nav.append(value / units if units > 0 else 1.0)
        exposure_sum += asset_units * price / value if value > 0 else 0.0
    final_value = cash + asset_units * prices[-1]
    flows.append((datetime.strptime(dates[-1], '%Y-%m-%d'), final_value))
    max_dd, underwater = drawdown_metrics(nav)
    annualized = xirr(flows)
    result = {'invested': total_contrib, 'end_value': final_value,
            'total_return': (final_value / total_contrib - 1) * 100 if total_contrib else None,
            'irr': annualized * 100 if annualized is not None else None,
            'mdd': max_dd * 100, 'underwater': underwater,
            'avg_exposure': exposure_sum / len(prices) * 100, 'trades': trade_count,
            'cash': cash, 'minimum_cash': min_cash}
    if sample_indices is not None:
        result['curve'] = [round(nav[i] * 100, 4) for i in sample_indices]
    return result


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


def monthly_sample_indices(dates):
    """Keep actual first and last observations plus each month's last trading day."""
    if not dates:
        return []
    indices = [0]
    for i in range(1, len(dates)):
        if dates[i][:7] != dates[i - 1][:7]:
            indices.append(i - 1)
    indices.append(len(dates) - 1)
    return sorted(set(indices))


def build_results(dates, prices):
    results, curves = [], {'dates': [], 'series': {}}
    samples = monthly_sample_indices(dates)
    curves['dates'] = [dates[i] for i in samples]
    for asset in ASSETS:
        symbol = asset['c']
        inputs = strategy_inputs(prices[symbol], dates)
        curves['series'][symbol] = {}
        for strategy in STRATEGIES:
            events, exposure = inputs[strategy['id']]
            simulated = simulate(dates, prices[symbol], events, exposure,
                                 initial_capital=INITIAL_CAPITAL if strategy['panel'] == 'initial' else None,
                                 sample_indices=samples)
            curves['series'][symbol][strategy['id']] = simulated['curve']
            metrics = round_metrics(simulated)
            metrics.update({'a': symbol, 'p': strategy['panel'], 's': strategy['id']})
            results.append(metrics)
    return results, curves


def js_data(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


def write_html(results, dates, curves):
    with open(HTML, 'r', encoding='utf-8') as fh:
        src = fh.read()

    meta = {
        'start': dates[0],
        'end': dates[-1],
        'requestedEnd': END_DATE,
        'status': 'computed',
        'basis': 'provider_adjusted_close',
        'modelVersion': 2,
        'initialCashIncluded': True,
        'maWarmup': '200 observations; hold cash until first available signal',
        'limitations': ['单一起止窗口，存在起点偏差', '税费、汇兑及现金收益未建模', '部分年度按样本月数预算；倍数定投资金总额不同'],
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
        'var STRATEGY_CURVES=' + js_data(curves) + ';\n'
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
            raise RuntimeError('data/snapshot.js 缺少 DATA_META_END 标记')
        out = src.replace(marker, marker + '\n\n' + block, 1)

    tmp = HTML + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(out)
    os.replace(tmp, HTML)


def main():
    global END_DATE
    args = parse_args()
    datetime.strptime(args.end, '%Y-%m-%d')
    END_DATE = args.end
    log('ETF 策略回测: %s -> %s' % (START_DATE, END_DATE))
    dates, prices = align_history(refresh=args.refresh, offline=args.offline)
    results, curves = build_results(dates, prices)
    write_html(results, dates, curves)
    write_status('strategy', 'cached' if args.offline else 'success', asOf=dates[-1], records=len(results), basis='provider_adjusted_close')

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
        write_status('strategy', 'unavailable', message=str(exc))
        log('!! 回测失败: %s' % exc)
        sys.exit(1)
