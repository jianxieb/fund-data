#!/usr/bin/env python3
"""Rebuild shipped strategy endpoints with a separate cash/share ledger.

Run after ``python3 strategy_backtest.py --refresh``. The raw Yahoo cache is
local by design; this check never downloads data or rewrites the snapshot.
"""

import math
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import data_quality  # noqa: E402
import strategy_backtest as source  # noqa: E402


def annualized_cashflow_return(contributions, terminal_date, terminal_value):
    """Bisect terminal future value without using the production XIRR solver."""
    terminal = date.fromisoformat(terminal_date)
    ages = [(amount, (terminal - date.fromisoformat(day)).days / 365.2425)
            for day, amount in contributions]
    if not ages or not any(age > 0 for _, age in ages):
        return None

    def future(log_growth):
        return sum(amount * math.exp(log_growth * age) for amount, age in ages)

    low, high = -30.0, 5.0
    if not future(low) <= terminal_value <= future(high):
        raise ValueError('资金流超出独立求根区间')
    for _ in range(100):
        mid = (low + high) / 2
        if future(mid) < terminal_value:
            low = mid
        else:
            high = mid
    return math.expm1((low + high) / 2) * 100


def independent_ledger(dates, prices, events, exposure, funded, additions=None):
    """Use cash plus shares, then evaluate capital shortfall at each close."""
    cash = source.INITIAL_CAPITAL if funded else 0.0
    shares = 0.0
    paid = cash
    contributions = [(dates[0], cash)] if funded else []
    worst_paid = 0.0
    below_streak = longest_below = 0
    nav_units = cash
    nav_peak = 1.0
    peak_index = 0
    worst_nav = 0.0
    longest_underwater = 0
    exposure_sum = 0.0
    trades = 0
    for index, (day, price) in enumerate(zip(dates, prices)):
        amount = events.get(index, 0.0)
        income = (additions or {}).get(index, 0.0) if funded else amount
        if income:
            before = cash + shares * price
            unit_price = before / nav_units if nav_units else 1.0
            nav_units += income / unit_price
            cash += income
            paid += income
            contributions.append((day, income))
        if exposure is None:
            spend = min(cash, amount + (income if funded else 0))
            if spend > 1e-8:
                shares += spend / ((1 + source.TRADING_COST) * price)
                cash -= spend
                trades += 1
        elif exposure[index] == 1.0:
            if cash > 1e-8:
                shares += cash / ((1 + source.TRADING_COST) * price)
                cash = 0.0
                trades += 1
        elif exposure[index] == 0.0:
            if shares * price > 1e-8:
                cash += shares * price * (1 - source.TRADING_COST)
                shares = 0.0
                trades += 1
        else:
            raise ValueError('独立审计只接受当前策略使用的0%或100%目标仓位')
        value = cash + shares * price
        unit_nav = value / nav_units if nav_units else 1.0
        if unit_nav >= nav_peak:
            nav_peak = unit_nav
            peak_index = index
        else:
            worst_nav = min(worst_nav, (unit_nav / nav_peak - 1) * 100)
            longest_underwater = max(longest_underwater, index - peak_index)
        exposure_sum += shares * price / value if value else 0.0
        if paid:
            worst_paid = min(worst_paid, (value / paid - 1) * 100)
            below_streak = below_streak + 1 if value < paid - max(1e-8, paid * 1e-10) else 0
            longest_below = max(longest_below, below_streak)
    return {'invested': paid, 'end_value': value,
            'xirr_points': annualized_cashflow_return(contributions, dates[-1], value),
            'worst_paid_points': worst_paid, 'below_paid_days': longest_below,
            'mdd_points': worst_nav, 'underwater_days': longest_underwater,
            'exposure_points': exposure_sum / len(dates) * 100, 'trades': trades}


def audit():
    snapshot = data_quality.read_snapshot()
    meta = snapshot['STRATEGY_META']
    source.END_DATE = meta['end']
    raw = source.load_all_history(offline=True)
    max_errors = {'invested': 0.0, 'end_value': 0.0, 'xirr_points': 0.0,
                  'worst_paid_points': 0.0, 'below_paid_days': 0,
                  'mdd_points': 0.0, 'underwater_days': 0,
                  'exposure_points': 0.0, 'trades': 0}
    shipped_keys = {'invested': 'inv', 'end_value': 'end', 'xirr_points': 'irr',
                    'worst_paid_points': 'worst_paid', 'below_paid_days': 'below_paid',
                    'mdd_points': 'mdd', 'underwater_days': 'uw',
                    'exposure_points': 'exp', 'trades': 'tr'}
    checked = 0
    for summary in meta['windows']:
        year = str(summary['year'])
        shipped = {'results': snapshot['STRATEGY_RESULTS']} if year == '2010' else snapshot['STRATEGY_WINDOWS'][year]
        dates, prices, assets = source.window_history(raw, int(year))
        actual = {(row['a'], row['s']): row for row in shipped['results']}
        for asset in assets:
            symbol = asset['c']
            events_by_strategy = source.strategy_inputs(prices[symbol], dates)
            monthly_budget = sum(events_by_strategy['dca_month'][0].values())
            for method in ('dca_quarter', 'dca_year'):
                if abs(sum(events_by_strategy[method][0].values()) - monthly_budget) > 0.01:
                    raise AssertionError(f'{year}/{symbol}/{method}: 定投总预算不相等')
            for definition in source.STRATEGIES:
                method = definition['id']
                events, exposure = events_by_strategy[definition.get('initialMethod', method)]
                additions = {i: source.MONTHLY_CONTRIBUTION for i in source.first_indices(dates)[1:]} if definition['panel'] == 'combined' else None
                rebuilt = independent_ledger(
                    dates, prices[symbol], events, exposure, definition['panel'] in ('initial', 'combined'), additions)
                row = actual[symbol, method]
                differences = {name: abs(rebuilt[name] - row[shipped])
                               for name, shipped in shipped_keys.items()}
                for metric, error in differences.items():
                    max_errors[metric] = max(max_errors[metric], error)
                if differences['invested'] > 0.02 or differences['end_value'] > 0.02 or \
                        any(differences[name] > 0.001 for name in
                            ('xirr_points', 'worst_paid_points', 'mdd_points', 'exposure_points')) or \
                        any(differences[name] for name in ('below_paid_days', 'underwater_days', 'trades')):
                    raise AssertionError(f'{year}/{symbol}/{method}: {differences}')
                checked += 1
    print(f'独立现金/份额账本核对通过：{checked}组，行情截至{meta["end"]}')
    print('最大绝对差：' + ', '.join(f'{name}={error:.6f}' for name, error in max_errors.items()))


if __name__ == '__main__':
    try:
        audit()
    except Exception as exc:
        print(f'策略独立核对失败：{exc}', file=sys.stderr)
        print('先联网运行 python3 strategy_backtest.py --refresh，再运行本脚本。', file=sys.stderr)
        raise SystemExit(1)
