"""Current, independently evidenced research groups for US listed companies."""
from datetime import date
from overseas_research import finite

LABELS = {'quality': '长期优质', 'growth': '高质成长', 'breakout': '业绩爆发',
          'dividend': '红利价值', 'other': '其他已收录'}


def classify(row, asof):
    f, a, research = row['financials'], row['analysis'], row['research']
    annual = a['annual']
    quarters = row['financialHistory']['quarterly']
    last5, last2 = annual[-5:], annual[-2:]
    last = annual[-1] if annual else {}
    recent_keys = sorted(quarters)[-2:]
    recent = []
    for key in recent_keys:
        current = quarters[key]
        prior = quarters.get(str(int(key[:4]) - 1) + key[4:], {})
        growth = lambda metric: (current[metric] / prior[metric] - 1) * 100 if finite(current.get(metric)) and finite(prior.get(metric)) and prior[metric] > 0 else None
        recent.append({'period': key, 'reportDate': current['reportDate'],
                       'profitGrowth': growth('NetIncome'),
                       'operatingGrowth': growth('TotalOperatingIncomeAsReported')})
    consecutive = lambda rows, months: bool(rows) and all(
        int(b['period'][:4]) * 12 + int(b['period'][5:]) - int(c['period'][:4]) * 12 - int(c['period'][5:]) == months
        for c, b in zip(rows, rows[1:]))
    two_quarters = len(recent) == 2 and consecutive(recent, 3)
    contiguous5 = len(last5) == 5 and consecutive(last5, 12)
    contiguous2 = len(last2) == 2 and consecutive(last2, 12)
    roes5 = [q.get('roe') for q in last5]
    roe5 = sum(roes5) / 5 if contiguous5 and all(finite(v) for v in roes5) else None
    f_age = (date.fromisoformat(asof) - date.fromisoformat(f['reportDate'])).days
    published = f.get('publishedAt')
    current = 0 <= f_age <= 155 and bool(published) and f['reportDate'] <= published <= asof
    sources = research.get('sources') or []
    reviewed = (research.get('reportPeriod') == f['reportDate']
                and f['reportDate'] <= research.get('reviewedAt', '') <= asof
                and any(s.get('reportPeriod') == f['reportDate'] and f['reportDate'] <= s.get('publishedAt', '') <= research['reviewedAt'] and s.get('url') for s in sources))
    sector = row.get('accountingModel', 'corporate')
    corporate = sector == 'corporate'
    review = research.get('earningsReview') or {}
    # Financial rows alone cannot renew a business review after a new filing.
    evidence = review.get('evidence') or []
    operating_review = reviewed and review.get('reportPeriod') == f['reportDate'] and all(
        review.get(k) for k in ('driver', 'nonOperating', 'priceCycle', 'consolidation', 'invalidation')) and bool(evidence) and all(
            e.get('label') and finite(e.get('value')) and e.get('unit') and e.get('sourceUrl')
            and e.get('location') and e.get('basis') in ('disclosed', 'calculated') for e in evidence) and any(e.get('reportPeriod') == f['reportDate'] for e in evidence)
    checks = {}
    def check(group, label, passed, observed):
        checks.setdefault(group, []).append({'label': label, 'pass': bool(passed),
                                            'reason': None if passed else observed})
    def metric(value, suffix='%'):
        return f'{value:.2f}{suffix}' if finite(value) else '缺对应可比数据'
    def positive_years(rows):
        return all(finite(q.get(k)) and q[k] > 0 for q in rows for k in ('NetIncome', 'OperatingCashFlow'))
    def common(group):
        check(group, '非金融、非REIT的经营企业', corporate, '采用' + {'bank': '银行资本与信用风险', 'financial': '金融业务', 'reits': 'REIT的AFFO', 'holding': '投资控股分部'}.get(sector, sector) + '模型，保留专题研究，不套工业企业门槛')
        check(group, '当前财季已披露且距研究日不超过155天', current, f['reportDate'] + '；' + ('缺公告日' if not published else '公告' + published))
        check(group, '本期经营复核对应最新财报', reviewed, '经营复核仅覆盖' + research.get('reportPeriod', '未注明报告期') + '，最新财报为' + f['reportDate'])
    common('quality')
    check('quality', '连续5个完整财年报表利润和经营现金流均为正', contiguous5 and positive_years(last5), '缺连续5年正利润/正经营现金流；亏损期：' + ('、'.join(q['period'] for q in last5 if finite(q.get('NetIncome')) and q['NetIncome'] <= 0) or '见年度表'))
    check('quality', '5年平均ROE≥15%，各年为正，最新年度≥15%', finite(roe5) and roe5 >= 15 and all(v > 0 for v in roes5) and (last.get('roe') or 0) >= 15, '5年平均ROE ' + metric(roe5) + '；最新年度 ' + metric(last.get('roe')))
    check('quality', '三年报表利润复合增速≥10%，最新完整年度利润增长≥10%', (a['profitCagr3'].get('value') or 0) >= 10 and (last.get('profitGrowth') or 0) >= 10, '三年利润复合 ' + metric(a['profitCagr3'].get('value')) + '；年度同比 ' + metric(last.get('profitGrowth')))
    check('quality', '最新单季利润增长≥10%，当前TTM ROE≥10%', (f['profitGrowth'].get('value') or 0) >= 10 and (f.get('roeTTM') or 0) >= 10, '最新单季利润 ' + metric(f['profitGrowth'].get('value')) + '；TTM ROE ' + metric(f.get('roeTTM')))
    check('quality', 'TTM利润与经营现金均为正', (f.get('ttmProfit') or 0) > 0 and (f.get('ttmCash') or 0) > 0, 'TTM利润或经营现金非正/期间不完整；现金/利润 ' + metric(a.get('cashConversion'), '倍'))
    check('quality', '最新单季营业利润增长≥10%，主营与非经营项已复核',
          (f.get('operatingGrowth', {}).get('value') or 0) >= 10 and operating_review and review.get('qualityDecision') == 'retain',
          '营业利润同比 ' + metric(f.get('operatingGrowth', {}).get('value')) + '；' + (review.get('qualityRationale') or '缺本期盈利来源研究'))
    long = research.get('longTerm') or {}
    check('quality', '有当前业务持续性、再投资和失效信号研究', reviewed and long.get('decision') == 'retain' and all(long.get(k) for k in ('durability', 'reinvestment', 'invalidation')), long.get('rationale') or '缺本期长期经营研究')
    for group, threshold in [('growth', 30), ('breakout', 100)]:
        common(group)
        check(group, f'连续两个相邻单季报表利润、营业利润均增长≥{threshold}%，基数为正', two_quarters and all(finite(q.get(k)) and q[k] >= threshold for q in recent for k in ('profitGrowth', 'operatingGrowth')),
              '；'.join(q['reportDate'] + '：利润' + metric(q['profitGrowth']) + '、营业利润' + metric(q['operatingGrowth']) for q in recent) or '缺相邻季度与上年同期')
        years_ok = contiguous2 and positive_years(last2) if group == 'growth' else bool(last) and positive_years([last])
        check(group, '最近两个完整财年正利润、正经营现金' if group == 'growth' else '最新完整财年正利润、正经营现金', years_ok, '未形成对应完整财年的正盈利和现金记录')
        minimum = 10 if group == 'growth' else 5
        check(group, f'最新年度与当前TTM ROE均≥{minimum}%', (last.get('roe') or 0) >= minimum and (f.get('roeTTM') or 0) >= minimum, '年度ROE ' + metric(last.get('roe')) + '；TTM ROE ' + metric(f.get('roeTTM')))
        cash_ok = finite(a.get('cashConversion')) and a['cashConversion'] >= .5
        if group == 'breakout':
            cash_ok = cash_ok and finite(f.get('OperatingCashFlow')) and f.get('NetIncome', 0) > 0 and f['OperatingCashFlow'] >= f['NetIncome'] * .5
        check(group, 'TTM现金/利润≥50%' + ('，最新单季亦≥50%' if group == 'breakout' else ''), cash_ok, 'TTM现金/利润 ' + metric(a.get('cashConversion'), '倍'))
        check(group, '本期主营、非经营项、周期与并表已有金额复核', operating_review and review.get(group + 'Decision') == 'retain', review.get(group + 'Rationale') or '缺本期盈利来源复核')
    # Dividend value is independent of growth. A profitable bank is not rejected
    # because operating cash movements include deposits and securities trading.
    income = research.get('incomeReview') or {}
    dividend_years = {int(d['day'][:4]) for d in row.get('dividendRecords', []) if finite(d.get('amount')) and d['amount'] > 0}
    full_years = set(range(int(asof[:4]) - 5, int(asof[:4])))
    payout = row.get('cashDividend12', 0) / row['epsTTM'] if finite(row.get('cashDividend12')) and finite(row.get('epsTTM')) and row['epsTTM'] > 0 else None
    coverage = finite(payout) and payout <= .85 and f.get('ttmCash', 0) is not None and f.get('ttmCash', 0) > 0
    if sector in ('bank', 'financial', 'reits'):
        coverage = reviewed and income.get('decision') == 'retain' and finite(income.get('payoutRatio')) and income['payoutRatio'] <= .85 and bool(income.get('capitalReview'))
        payout = income.get('payoutRatio')
    check('dividend', '当前财报与分红承受能力已复核', current and reviewed and income.get('decision') == 'retain', income.get('rationale') or '缺本期分红承受能力研究')
    check('dividend', '近12月已付现金股息率≥3%', (row.get('yield12') or 0) >= 3, '近12月股息率 ' + metric(row.get('yield12')))
    check('dividend', '最近5个完整日历年均有现金分红', full_years <= dividend_years, '有现金分红的完整年度：' + '、'.join(map(str, sorted(full_years & dividend_years))))
    check('dividend', '分红覆盖充足：派息比率≤85%、行业现金/资本条件成立', coverage, '派息比率 ' + metric(payout * 100 if finite(payout) else None) + '；' + (income.get('capitalReview') or '需要正经营现金流'))
    qualified = {g: all(c['pass'] for c in values) for g, values in checks.items()}
    # Independent breakout tab contains current explosions without a quality or
    # growth qualification; overlapping quality+growth stays colored in both.
    qualified['breakout'] = qualified['breakout'] and not (qualified['quality'] or qualified['growth'])
    groups = [g for g in LABELS if g != 'other' and qualified.get(g)] or ['other']
    other_reasons = list(dict.fromkeys(next((c['reason'] for c in checks[g] if not c['pass']), review.get(g + 'Rationale') or '未进入本期分组') for g in ('quality', 'growth', 'breakout'))) if groups == ['other'] else []
    row['screening'] = {'basis': 'us_company_quality_growth_v1', 'checkedAt': asof,
        'groups': groups, 'reviews': {g: {'qualified': qualified[g], 'checks': values} for g, values in checks.items()},
        'roe5': roe5, 'quarters': recent, 'dividendYears5': len(full_years & dividend_years), 'payoutRatio': payout,
        'otherReasons': other_reasons}
    return row
