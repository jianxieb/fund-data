"""Shared economic tests for durable operating businesses, effective prospectively.

Historical dossiers keep their original dated policy. These tests do not rank
countries or use price returns to select companies.
"""
import json
import math
from pathlib import Path

POLICY_FROM = '2026-10-17'
REVIEWS_PATH = Path(__file__).resolve().parent / 'data/company-screening-reviews.json'


def finite(v):
    return isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v)


def check(label, passed, reason):
    return {'label': label, 'pass': bool(passed), 'reason': None if passed else reason}


def durable_financials(annual, cash_ttm, profit_ttm):
    """Annual records are ascending and normalized; never annualize one quarter."""
    rows = annual[-5:]
    periods = [int(r['period'][:4]) * 12 + int(r['period'][5:7]) for r in rows]
    complete = len(rows) == 5 and all(b - a == 12 for a, b in zip(periods, periods[1:]))
    roes = [r.get('roe') for r in rows]
    average = sum(roes) / 5 if complete and all(finite(v) for v in roes) else None
    last_roe = roes[-1] if roes else None
    cash_ratio = cash_ttm / profit_ttm if finite(cash_ttm) and finite(profit_ttm) and profit_ttm > 0 else None
    profitability_failures = '；'.join(r['period'] + ('缺' if not finite(r.get(k)) else '') + label + ('' if not finite(r.get(k)) else '非正')
                                     for r in rows for k,label in [('profit','报表利润'),('cash','经营现金')]
                                     if not finite(r.get(k)) or r[k] <= 0)
    missing_roe = '；'.join(r['period'] + ('净资产非正，ROE不适用' if finite(r.get('equity')) and r['equity'] <= 0 else '缺可比年度ROE') for r in rows if not finite(r.get('roe')))
    checks = [
        check('连续5个完整财年利润及经营现金均为正', complete and all(finite(r.get(k)) and r[k] > 0 for r in rows for k in ('profit', 'cash')), profitability_failures or '缺连续5个完整财年的利润与现金记录'),
        check('5年平均ROE≥15%，每个完整年度≥10%，最新年度≥15%', average is not None and average >= 15 and min(roes) >= 10 and last_roe >= 15,
              missing_roe or ('5年平均ROE %.2f%%、最低%.2f%%、最新%.2f%%' % (average,min(roes),last_roe) if average is not None else '缺连续5个完整年度ROE')),
        check('TTM正利润，经营现金至少覆盖利润50%', cash_ratio is not None and cash_ratio >= .5,
              'TTM经营现金 / 利润 %.2f%%，低于50%%' % (cash_ratio * 100) if cash_ratio is not None else '缺连续12个月正利润或经营现金金额'),
    ]
    return checks, average, cash_ratio


def business_decision(code, group, period, asof, fallback=None):
    """Specific source-bound reassessments take effect only on/after review day."""
    fallback = fallback or {}
    if asof < POLICY_FROM:
        return fallback
    reviews = json.loads(REVIEWS_PATH.read_text()) if REVIEWS_PATH.exists() else {}
    row = reviews.get('companies', {}).get(code, {})
    verdict = row.get(group)
    if not verdict:
        return fallback
    if not (row.get('reportPeriod') == period and period <= row.get('reviewedAt', '') <= asof and row.get('sources')):
        return {'decision': 'pending', 'rationale': '经营复核仅覆盖' + row.get('reportPeriod', '未注明报告期') + '，最新财报为' + str(period)}
    return {**verdict, 'sources': row['sources'], 'reviewedAt': row['reviewedAt']}
