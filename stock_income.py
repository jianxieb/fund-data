"""The same dividend admission checks for A shares and US listings.

Financial institutions and REITs need a dated capital/AFFO review; deposit
movements are never treated as industrial operating cash generation.
"""
from datetime import date
import math
import json
from pathlib import Path

REVIEWS = Path(__file__).resolve().parent / 'data/stock-income-reviews.json'


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def income_review(*, asof, period, published, report_source, yield12, paid_years,
                  dividend_asof, dividend_source, payout, cash, sector='corporate', review=None):
    checks, missing = [], []
    def check(label, ok, reason, unknown=False):
        checks.append({'label': label, 'pass': bool(ok), 'reason': None if ok else reason})
        if not ok and unknown:
            missing.append(reason)
    current = bool(period and published and report_source) and period <= published <= asof
    check('本期财报已公告并有来源', current, '缺本期公告日或财报来源', not current)
    review = review or {}
    reviewed = (bool(period) and review.get('reportPeriod') == period and period <= (review.get('publishedAt') or '')
                <= (review.get('reviewedAt') or '') <= asof and bool(review.get('sourceUrl'))
                and bool(review.get('rationale')))
    check('本期分红承受能力已逐家公司复核', reviewed and review.get('decision') == 'retain',
          review['rationale'] if reviewed else '分红承受能力复核覆盖' + str(review.get('reportPeriod') or '未记录') + '，当前财报为' + str(period), not reviewed)
    cash_known = bool(dividend_asof and dividend_source) and dividend_asof <= asof and (date.fromisoformat(asof) - date.fromisoformat(dividend_asof)).days <= 10
    check('现金分红和价格来自同一截至日', cash_known, '缺近10天内的现金分红及价格证据', not cash_known)
    check('近12月已付现金股息率≥3%', finite(yield12) and yield12 >= 3,
          '近12月股息率' + (f'{yield12:.2f}%，低于3%' if finite(yield12) else '缺失'), not finite(yield12))
    expected = set(range(int(asof[:4]) - 5, int(asof[:4])))
    years = set(paid_years or [])
    check('最近5个完整日历年均实施现金分红（按除息日）', expected <= years,
          '缺已实施现金分红的日历年：' + '、'.join(map(str, sorted(expected - years))), paid_years is None)
    special = sector in ('bank', 'financial', 'reits', 'holding')
    if special:
        verified = reviewed and review.get('capitalReview') and review.get('decision') == 'retain'
        if not verified:
            payout = None
        elif review.get('payoutBasis'):
            payout = review.get('payoutRatio')
        check('金融/REIT/控股公司有本期资本或AFFO覆盖复核', verified,
              '缺' + str(period or '') + '资本充足、资产质量或AFFO覆盖的具名复核', not verified)
    else:
        check('最近12个月经营现金流为正', finite(cash) and cash > 0,
              'TTM经营现金流非正或缺完整期间', not finite(cash))
    check('现金派息比率≤85%，盈利或AFFO基数为正', finite(payout) and 0 <= payout <= .85,
          f'派息比率{payout * 100:.2f}%，高于85%' if finite(payout) else '缺同股本口径的正盈利或AFFO派息比率', not finite(payout))
    qualified = all(c['pass'] for c in checks)
    rationale = ('近12月现金股息率' + f'{yield12:.2f}%，连续5个日历年实施现金分红（按除息日），派息比率{payout * 100:.1f}%；' + ('本期资本/AFFO覆盖已复核。' if special else 'TTM经营现金为正。')) if qualified else '；'.join(c['reason'] for c in checks if not c['pass'])
    return {'qualified': qualified, 'checks': checks, 'checkedAt': asof,
            'basis': 'shared_cash_income_v1', 'payoutRatio': payout,
            'dividendYears5': len(expected & years) if paid_years is not None else None, 'missing': missing, 'rationale': rationale,
            'businessReview': review,
            'payoutBasis': review.get('payoutBasis') or '近12月现金分红 / TTM盈利'}


def cn_income_review(row, asof):
    from company_report import ttm_amount
    from stock_fundamentals import latest_report_review
    latest = row.get('latestFinancials') or {}
    period = latest.get('reportDate')
    shares = row.get('incomeShareEvidence') or {}
    reports = row.get('financialReports') or []
    profit = ttm_amount(reports, 'netProfit', asof)
    cash = ttm_amount(reports, 'operatingCashFlow', asof)
    current_shares = shares.get('currentShares')
    start = str(int(period[:4]) - 1) + period[4:] if period else ''
    history = [r for r in shares.get('reports', []) if start <= r['reportDate'] <= (period or '')]
    stable = (shares.get('reportPeriod') == period and len(history) >= 5
              and finite(current_shares) and current_shares > 0
              and all(finite(r.get('shares')) and math.isclose(r['shares'], current_shares, rel_tol=1e-8) for r in history))
    cash12 = row.get('cashDividend12')
    payout = cash12 * current_shares / profit if stable and finite(cash12) and finite(profit) and profit > 0 else None
    sector = 'financial' if any(k in (row.get('valuationIndustry') or row.get('ind') or '') for k in ('银行', '保险', '证券', '金融', '租赁')) else 'corporate'
    review = json.loads(REVIEWS.read_text()).get('companies', {}).get(row['c'], {})
    result = income_review(asof=asof, period=period, published=latest.get('announcedAt'), report_source=row.get('fundamentalsSourceUrl'),
                           yield12=row.get('yield12'), paid_years=row.get('dividendPaidCalendarYears'), dividend_asof=row.get('dividendAsOf'),
                           dividend_source=row.get('dividendSourceUrl'), payout=payout, cash=cash, sector=sector, review=review)
    result['payoutInputs'] = {'cashDividend12': cash12, 'currentShares': current_shares,
                             'ttmProfit': profit, 'stableShareBasis': stable}
    freshness = latest_report_review(latest, asof)[0]
    result['checks'].append(freshness)
    if not freshness['pass']:
        result['qualified'] = False
        result['missing'].append(freshness['reason'])
        result['rationale'] = freshness['reason']
    if 'ST' in row.get('n', '').upper():
        result['checks'].append({'label': '非风险警示证券', 'pass': False, 'reason': '当前证券为风险警示状态'})
        result['qualified'] = False
        result['rationale'] += '；当前证券为风险警示状态'
    if not stable and sector == 'corporate':
        result['shareBasisMissing'] = '缺连续四季不变股本证据；不把跨股本EPS直接相加'
        result['rationale'] += '；' + result['shareBasisMissing']
    return result


def us_income_review(row, asof):
    f = row['financials']
    period = f['reportDate']
    eps, cash12 = row.get('epsTTM'), row.get('cashDividend12')
    payout = cash12 / eps if finite(cash12) and finite(eps) and eps > 0 else None
    years = sorted({int(d['day'][:4]) for d in row.get('dividendRecords', []) if finite(d.get('amount')) and d['amount'] > 0 and d['day'] <= asof})
    research = row['research']
    source = next((s for s in research.get('sources', []) if s.get('reportPeriod') == research.get('reportPeriod') and s.get('publishedAt')), {})
    review = {'reportPeriod': research.get('reportPeriod'), 'reviewedAt': research.get('reviewedAt'),
              'sourceUrl': source.get('url'), 'publishedAt': source.get('publishedAt'),
              **(research.get('incomeReview') or {})}
    if row.get('accountingModel') == 'reits' and finite(review.get('payoutRatio')):
        review['payoutBasis'] = '本季已付普通股股息 / AFFO'
    result = income_review(asof=asof, period=period, published=f.get('publishedAt'), report_source=f.get('sourceUrl'),
                           yield12=row.get('yield12'), paid_years=years, dividend_asof=row.get('priceAsOf'),
                           dividend_source=row.get('returnSourceUrl'), payout=payout, cash=f.get('ttmCash'),
                           sector=row.get('accountingModel', 'corporate'), review=review)
    fresh = 0 <= (date.fromisoformat(asof) - date.fromisoformat(period)).days <= 155
    result['checks'].append({'label': '当前财报距研究日不超过155天', 'pass': fresh, 'reason': None if fresh else '财报超过155天，缺更新报告'})
    if not fresh:
        result['qualified'] = False
        result['missing'].append('财报超过155天，缺更新报告')
        result['rationale'] = '财报超过155天，缺更新报告'
    if f.get('missingFields'):
        reason = f['missingEvidence']
        result['checks'].append({'label': '当前财季营业收入和净利润来源齐备', 'pass': False, 'reason': reason})
        result['qualified'] = False
        result['missing'].append(reason)
        result['rationale'] += '；' + reason
    return result
