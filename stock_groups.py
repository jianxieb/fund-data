"""Independent long-term quality and current high-quality growth classifications."""
from stock_fundamentals import numeric, quality_review, research_evidence_check, latest_report_review
from company_report import quarter_history, ttm_amount

GROWTH_LIMITS = {'revenueGrowth': 20, 'netProfitGrowth': 30, 'deductedProfitGrowth': 30,
                 'deductedRatio': .8, 'annualRoe': 10, 'marketCap': 100}
BREAKOUT_LIMITS = {'revenueGrowth': 20, 'netProfitGrowth': 100, 'deductedProfitGrowth': 100,
                   'deductedRatio': .8, 'annualRoe': 5, 'marketCap': 100, 'cashProfitRatio': .5}


def check(label, passed, reason):
    return {'label': label, 'pass': bool(passed), 'reason': None if passed else reason}


def growth_values(report):
    return report.get('reportDate', '未知报告期') + '：' + '、'.join(
        label + ('%+.2f%%' % report[key] if numeric(report.get(key)) is not None else '缺正基数同比')
        for key, label in [('revenueGrowth', '营收'), ('netProfitGrowth', '归母'), ('deductedProfitGrowth', '扣非')])


def long_term_review(row, asof):
    review = row.get('qualityReview') or quality_review(row, asof)
    if review is None:
        return None
    history = row.get('financialHistory5') or []
    years = [r['year'] for r in history]
    due = int(asof[:4]) - (1 if asof[5:] >= '04-30' else 2)
    complete = len(years) == 5 and years[0] >= due and years == list(range(years[0], years[0] - 5, -1))
    roes = [numeric(r.get('roe')) for r in history]
    average = sum(roes) / 5 if complete and all(r is not None for r in roes) else None
    research = row.get('qualityResearch') or {}
    business = research.get('longTerm') or {}
    evidence_current = research.get('reportPeriod') == (row.get('latestFinancials') or {}).get('reportDate')
    checks = review['checks'] + [
        check('连续5个完整财年归母、扣非利润及经营现金流均为正', complete and all((numeric(r.get(k)) or 0) > 0 for r in history for k in ('netProfit', 'deductedProfit', 'operatingCashFlow')), '缺连续5年正利润、正扣非利润或正经营现金流'),
        check('5年平均年度ROE≥15%，各年ROE均为正', average is not None and average >= 15 and min(roes) > 0, '缺连续5年年度ROE' if average is None else '5年平均年度ROE %.2f%%、最低年度%.2f%%，平均须≥15%%且各年为正' % (average, min(roes))),
        check('本期业务持续性、再投资路径和失效信号均有研究记录', evidence_current and all(isinstance(business.get(k), str) and business[k].strip() for k in ('durability', 'reinvestment', 'invalidation')), '缺本期长期业务持续性研究'),
    ]
    return {'qualified': all(c['pass'] for c in checks), 'checks': checks, 'years': years,
            'roe5': round(average, 2) if average is not None else None, 'checkedAt': asof,
            'basis': 'long_term_quality_v1', 'reasons': review['reasons'], 'watchouts': review['watchouts']}


def growth_review(row, asof):
    if row.get('group') not in ('quality', 'growth'):
        return None
    latest = row.get('latestFinancials') or {}
    history = row.get('financialHistory5') or row.get('financialHistory') or []
    annual = history[:2]
    due = int(asof[:4]) - (1 if asof[5:] >= '04-30' else 2)
    complete = len(annual) == 2 and [r['year'] for r in annual] == [due, due - 1]
    reports = row.get('financialReports') or []
    quarters = quarter_history(reports)[:2]
    def growth_ok(report):
        return all(numeric(report.get(k)) is not None and report[k] >= GROWTH_LIMITS[k]
                   for k in ('revenueGrowth', 'netProfitGrowth', 'deductedProfitGrowth'))
    q_contiguous = False
    if len(quarters) == 2:
        y, m = int(quarters[0]['reportDate'][:4]), int(quarters[0]['reportDate'][5:7])
        prev = '%d-%s' % (y - 1, '12-31') if m == 3 else '%d-%s' % (y, {6: '03-31', 9: '06-30', 12: '09-30'}[m])
        q_contiguous = quarters[1]['reportDate'] == prev and quarters[0]['reportDate'] == latest.get('reportDate')
    profit, core = numeric(latest.get('netProfit')), numeric(latest.get('deductedProfit'))
    core_ratio = core / profit if profit is not None and profit > 0 and core is not None else None
    ocf = ttm_amount(reports, 'operatingCashFlow')
    research = row.get('qualityResearch') or {}
    business = research.get('growth') or {}
    # A prior dossier cannot approve newly reported growth without another review.
    evidence_current = research.get('reportPeriod') == latest.get('reportDate')
    checks = [
        check('非ST、非金融企业，总市值≥100亿元', 'ST' not in row.get('n', '').upper() and not any(k in (row.get('valuationIndustry') or row.get('ind') or '') for k in ('银行', '保险', '证券', '金融')) and (numeric(row.get('mcap')) or 0) >= 100, '证券类别或规模未满足适用范围'),
        latest_report_review(latest, asof)[0],
        check('最新累计营收同比≥20%，归母及扣非利润同比均≥30%', growth_ok(latest), growth_values(latest) + '；须达到20% / 30% / 30%'),
        check('连续两个单季营收≥20%、归母及扣非利润增长均≥30%', q_contiguous and all(growth_ok(q) for q in quarters), '缺连续两个可比单季' if not q_contiguous else '；'.join(growth_values(q) for q in quarters if not growth_ok(q)) + '；单季须达到20% / 30% / 30%'),
        check('最新扣非利润占归母利润≥80%，ROE为正', core_ratio is not None and core_ratio >= .8 and (numeric(latest.get('roe')) or 0) > 0, '经常性盈利占比或当期资本回报不足'),
        check('最近2个完整财年归母、扣非利润和经营现金流均为正', complete and all((numeric(r.get(k)) or 0) > 0 for r in annual for k in ('netProfit', 'deductedProfit', 'operatingCashFlow')), '尚未形成两年正利润和正现金回收记录'),
        check('最新完整年度ROE≥10%', complete and (numeric(annual[0].get('roe')) or 0) >= 10, '缺上年完整年度ROE' if not complete or numeric(annual[0].get('roe')) is None else '%d年度ROE %.2f%%，低于10%%' % (annual[0]['year'], annual[0]['roe'])),
        check('最近12个月经营现金流为正', ocf is not None and ocf > 0, '缺TTM正经营现金流'),
        research_evidence_check(row, asof),
        check('本期主营增长、持续性及失效信号有报告依据', evidence_current and all(isinstance(business.get(k), str) and business[k].strip() for k in ('driver', 'quality', 'invalidation')), '缺本期高质成长的主营增长、持续性或失效信号记录'),
    ]
    return {'qualified': all(c['pass'] for c in checks), 'checks': checks,
            'financialQualified': all(c['pass'] for c in checks[:8]), 'checkedAt': asof,
            'quarters': quarters, 'coreProfitRatio': core_ratio, 'operatingCashFlowTtm': ocf,
            'basis': 'high_quality_growth_v1', 'thresholds': GROWTH_LIMITS.copy(),
            'reasons': [business[k] for k in ('driver', 'quality') if business.get(k)], 'watchouts': []}


def breakout_review(row, asof):
    """Current core earnings expansion, independently of the quality classifications."""
    if row.get('group') not in ('quality', 'growth'):
        return None
    latest = row.get('latestFinancials') or {}
    reports = row.get('financialReports') or []
    quarters = quarter_history(reports)[:2]
    annual = (row.get('financialHistory5') or row.get('financialHistory') or [])[:2]
    due = int(asof[:4]) - (1 if asof[5:] >= '04-30' else 2)
    complete = [r['year'] for r in annual] == [due, due - 1]
    def expanding(report):
        return all(numeric(report.get(k)) is not None and report[k] >= BREAKOUT_LIMITS[k]
                   for k in ('revenueGrowth', 'netProfitGrowth', 'deductedProfitGrowth'))
    contiguous = False
    if len(quarters) == 2:
        year, month = int(quarters[0]['reportDate'][:4]), int(quarters[0]['reportDate'][5:7])
        previous = '%d-12-31' % (year - 1) if month == 3 else '%d-%s' % (year, {6: '03-31', 9: '06-30', 12: '09-30'}[month])
        contiguous = quarters[0]['reportDate'] == latest.get('reportDate') and quarters[1]['reportDate'] == previous
    previous_ok = contiguous and expanding(quarters[1])
    profit, core = numeric(latest.get('netProfit')), numeric(latest.get('deductedProfit'))
    ratio = core / profit if profit is not None and profit > 0 and core is not None else None
    ocf = ttm_amount(reports, 'operatingCashFlow')
    research = row.get('qualityResearch') or {}
    business = research.get('breakout') or {}
    operating = business.get('operatingReview') or {}
    current_operating = operating.get('reportPeriod') == latest.get('reportDate') and bool(operating.get('checkedAt')) and latest.get('reportDate', '') <= operating['checkedAt'] <= asof
    source = next((s for s in research.get('sources', []) if s.get('url') == operating.get('sourceUrl')), {})
    evidence = bool(source) and source.get('publishedAt', '') <= asof and bool(operating.get('sourcePages'))
    reviewed = current_operating and evidence and all(isinstance(operating.get(k), str) and operating[k].strip() for k in ('rationale', 'priceEffect', 'consolidationEffect', 'valuationAssessment'))
    structural = reviewed and operating.get('decision') == 'retain' and operating.get('growthSource') in ('product_delivery', 'structural_demand')
    reported = latest_report_review(latest, asof)[0]
    notice = latest.get('announcedAt') or ''
    known = bool(notice) and latest.get('reportDate', '') <= notice <= asof
    checks = [
        check('非ST、非金融企业，总市值≥100亿元', 'ST' not in row.get('n', '').upper() and not any(k in (row.get('valuationIndustry') or row.get('ind') or '') for k in ('银行', '保险', '证券', '金融')) and (numeric(row.get('mcap')) or 0) >= BREAKOUT_LIMITS['marketCap'], '证券类别或规模未满足适用范围'),
        check(reported['label'] + '，且已公告', reported['pass'] and known, reported.get('reason') or '报告期/公告日缺失或晚于研究截止日'),
        check('最新累计营收同比≥20%，归母及扣非利润同比均≥100%', expanding(latest), growth_values(latest) + '；须达到20% / 100% / 100%'),
        check('最新单季营收同比≥20%，归母及扣非利润同比均≥100%', contiguous and expanding(quarters[0]), '缺可比最新单季' if not contiguous else growth_values(quarters[0]) + '；须达到20% / 100% / 100%'),
        check('前一相邻单季营收同比≥20%，归母及扣非利润同比均≥100%', previous_ok, '缺相邻单季' if not contiguous else growth_values(quarters[1]) + '；须达到20% / 100% / 100%'),
        check('最新归母及扣非利润为正，扣非占比≥80%，ROE为正', ratio is not None and ratio >= BREAKOUT_LIMITS['deductedRatio'] and (numeric(latest.get('roe')) or 0) > 0, '当期盈利质量或资本回报不足'),
        check('最近2个完整财年归母、扣非利润及经营现金流均为正', complete and all((numeric(r.get(k)) or 0) > 0 for r in annual for k in ('netProfit', 'deductedProfit', 'operatingCashFlow')), '未形成两年正盈利和正现金回收记录'),
        check('最新完整年度ROE≥5%', complete and (numeric(annual[0].get('roe')) or 0) >= BREAKOUT_LIMITS['annualRoe'], '上年ROE不足5%或缺完整年度证据'),
        check('最新经营现金流≥归母利润50%，TTM经营现金流为正', profit is not None and profit > 0 and (numeric(latest.get('operatingCashFlow')) or 0) >= profit * BREAKOUT_LIMITS['cashProfitRatio'] and ocf is not None and ocf > 0, '当前现金回收不足归母利润50%，或TTM经营现金流未转正'),
        research_evidence_check(row, asof),
        check('本期增长来源、周期/并购/基数影响和失效信号均有报告依据', research.get('reportPeriod') == latest.get('reportDate') and all(isinstance(business.get(k), str) and business[k].strip() for k in ('driver', 'quality', 'invalidation')), '缺本期业绩爆发的增长来源、周期/并购/基数影响或失效信号记录'),
        check('有产品交付或结构性需求依据，增长不依赖商品涨价或未拆分并表', structural, operating.get('rationale') if reviewed else '缺本期价格、并表与主营交付的独立复核'),
    ]
    return {'qualified': all(c['pass'] for c in checks), 'checks': checks, 'checkedAt': asof,
            'quarters': quarters, 'coreProfitRatio': ratio, 'operatingCashFlowTtm': ocf,
            'financialQualified': all(c['pass'] for c in checks[:9]),
            'operatingReview': operating, 'basis': 'core_earnings_breakout_v3', 'thresholds': BREAKOUT_LIMITS.copy(),
            'reasons': [business[k] for k in ('driver', 'quality') if business.get(k)], 'watchouts': []}
