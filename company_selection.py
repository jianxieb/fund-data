"""Dated, company-specific selection decisions, separate from numeric screens.

Passing a screen creates no endorsement. A named business review must approve
each group and expires when a newer financial period is published. Historical
reports before the review date retain their original conclusions.
"""
import json
from datetime import date
from pathlib import Path

FROM = '2026-10-17'
PATH = Path(__file__).resolve().parent / 'data/company-selection.json'
GROUPS = ('quality', 'growth', 'breakout', 'dividend')


def finite(value):
    import math
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def assess(code, market, period, asof, profit, cash, annual, core_growth=None):
    if asof < FROM:
        return None
    record = json.loads(PATH.read_text()).get('companies', {}).get(market + ':' + code, {})
    sources = record.get('sources') or []
    source_urls = {s.get('url') for s in sources if s.get('url') and s.get('reportPeriod') == period
                   and period <= s.get('publishedAt', '') <= record.get('reviewedAt', '')}
    evidence = record.get('evidence') or []
    current = bool(record) and record.get('reportPeriod') == period and period <= record.get('reviewedAt', '') <= asof
    current = current and 0 <= (date.fromisoformat(asof) - date.fromisoformat(period)).days <= (155 if market == 'us' else 200)
    evidenced = bool(source_urls) and len(evidence) >= 2 and all(
        e.get('sourceUrl') in source_urls and e.get('label') and e.get('unit')
        and e.get('location') and finite(e.get('value')) for e in evidence)
    decisions = record.get('groups') or []
    reviews = {}
    for group in GROUPS:
        reason = (record.get('groupReasons') or {}).get(group) or record.get('rationale') or '缺本公司逐项业务入选结论'
        checks = [
            {'label': '逐家公司评审明确入选本组', 'pass': group in decisions, 'reason': None if group in decisions else reason},
            {'label': '评审对应最新已披露财报', 'pass': current, 'reason': None if current else '选股评审覆盖' + record.get('reportPeriod', '未记录') + '，当前财报为' + period},
            {'label': '本期原始财报、定量证据及风险齐备', 'pass': evidenced and bool(record.get('risk')) and bool(record.get('invalidation')),
             'reason': None if evidenced and record.get('risk') and record.get('invalidation') else '缺本期原始财报金额、风险或退出条件'},
        ]
        if group != 'dividend':
            ok = finite(profit) and profit > 0 and finite(cash) and cash > 0
            checks.append({'label': '最近12个月报表利润、经营现金为正', 'pass': ok, 'reason': None if ok else '缺连续12个月正利润与正经营现金'})
        if group == 'quality':
            last = annual[-5:]
            periods = [r['period'] for r in last]
            contiguous = len(last) == 5 and all(int(b[:4]) - int(a[:4]) == 1 and a[4:] == b[4:] for a, b in zip(periods, periods[1:]))
            if periods:
                months = lambda value: int(value[:4]) * 12 + int(value[5:7])
                contiguous = contiguous and 0 <= months(period) - months(periods[-1]) < 12
            ok = contiguous and all(finite(r.get(k)) and r[k] > 0 for r in last for k in ('profit', 'cash'))
            checks.append({'label': '连续五个完整财年有正利润和正经营现金', 'pass': ok, 'reason': None if ok else '缺连续五个完整财年正利润与现金记录'})
        if group in ('growth', 'breakout'):
            ok = finite(core_growth) and core_growth > 0
            checks.append({'label': '最新核心经营盈利仍在增长', 'pass': ok, 'reason': None if ok else '最新扣非/营业利润未增长或缺可比数据'})
        reviews[group] = {'qualified': all(c['pass'] for c in checks), 'checks': checks, 'rationale': reason}
    groups = [g for g in GROUPS if reviews[g]['qualified']]
    if 'breakout' in groups and any(g in groups for g in ('quality', 'growth')):
        groups.remove('breakout')
        reviews['breakout']['qualified'] = False
    rationale = record.get('rationale') if current and evidenced else '缺对应最新财报的公司入选复核：' + period
    if not groups and decisions and current and evidenced:
        failures = list(dict.fromkeys(c['reason'] for g in decisions if g in reviews for c in reviews[g]['checks'] if not c['pass']))
        rationale = '本期入选条件失效：' + '；'.join(failures)
    return {**record, 'status': 'selected' if groups else 'excluded' if current and evidenced else 'pending',
            'groups': groups or ['other'], 'reviews': reviews, 'checkedAt': asof,
            'rationale': rationale}


def cn_selection(row, asof):
    from company_report import ttm_amount
    from stock_fundamentals import latest_report_review
    latest = row.get('latestFinancials') or {}
    period = latest.get('reportDate')
    # Income selections use their separate payout/industry model. This review
    # re-underwrites operating quality and earnings-growth endorsements.
    if not period or asof < FROM or row.get('group') == 'dividend':
        return None
    annual = [{'period': str(r['year']) + '-12', 'profit': r.get('netProfit'), 'cash': r.get('operatingCashFlow')}
              for r in reversed(row.get('financialHistory5') or row.get('financialHistory') or [])]
    result = assess(row['c'], 'cn', period, asof, ttm_amount(row.get('financialReports') or [], 'netProfit'),
                    ttm_amount(row.get('financialReports') or [], 'operatingCashFlow'), annual, latest.get('deductedProfitGrowth'))
    freshness = latest_report_review(latest, asof)[0]
    eligible = 'ST' not in row.get('n', '').upper()
    for verdict in result['reviews'].values():
        verdict['checks'] += [freshness, {'label': '非风险警示证券', 'pass': eligible, 'reason': None if eligible else '当前证券为风险警示状态'}]
        verdict['qualified'] = verdict['qualified'] and freshness['pass'] and eligible
    result['groups'] = [g for g in GROUPS if result['reviews'][g]['qualified']] or ['other']
    if not freshness['pass'] or not eligible:
        result['status'] = 'pending'
        result['rationale'] = freshness.get('reason') or '当前证券为风险警示状态'
    return result


def reviewed_group(group):
    """Keep the public group functions reproducible for both dates and snapshots."""
    from functools import wraps
    def decorate(function):
        @wraps(function)
        def reviewed(row, asof):
            old = function(row, asof)
            selection = cn_selection(row, asof)
            if selection is None:
                return old
            return {**(old or {}), **selection['reviews'][group], 'checkedAt': asof,
                    'basis': 'company_selection_v1', 'businessReview': {'rationale': selection['reviews'][group]['rationale']}}
        return reviewed
    return decorate


def apply_cn(row, asof):
    selection = cn_selection(row, asof)
    if selection is None:
        return row
    row['companySelection'] = selection
    for group, key in [('quality', 'longTermReview'), ('growth', 'growthReview'), ('breakout', 'breakoutReview')]:
        old = row.get(key) or {}
        row[key] = {**old, **selection['reviews'][group], 'checkedAt': asof, 'basis': 'company_selection_v1',
                    'businessReview': {'rationale': selection['reviews'][group]['rationale']}}
    return row


def apply_us(row, asof):
    if asof < FROM:
        return row
    f = row['financials']
    annual = [{'period': r['period'], 'profit': r.get('NetIncome'), 'cash': r.get('OperatingCashFlow')}
              for r in row['analysis']['annual']]
    selection = assess(row.get('symbol', ''), 'us', f['reportDate'], asof, f.get('ttmProfit'), f.get('ttmCash'), annual,
                       f.get('operatingGrowth', {}).get('value'))
    income = row['screening']['reviews']['dividend']
    selection['reviews']['dividend'] = income
    selection['groups'] = [g for g in selection['groups'] if g not in ('other', 'dividend')]
    if income['qualified']:
        selection['groups'].append('dividend')
    if not selection['groups']:
        selection['groups'] = ['other']
        if selection['status'] == 'selected':
            selection['status'] = 'excluded'
            selection['rationale'] = '红利入选条件失效：' + '；'.join(c['reason'] for c in income['checks'] if not c['pass'])
    elif income['qualified'] or selection['status'] == 'excluded':
        selection['status'] = 'selected'
    row['companySelection'] = selection
    row['screening'].update(groups=selection['groups'], reviews=selection['reviews'], basis='company_selection_v1',
                            otherReasons=[selection['rationale']] if selection['groups'] == ['other'] else [])
    return row
