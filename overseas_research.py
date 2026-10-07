"""Derived financial evidence and full reports for the overseas research table."""
import math


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def ratio(a, b, scale=100):
    return a / b * scale if finite(a) and finite(b) and b > 0 else None


def change(a, b):
    return ratio(a - b, b) if finite(a) and finite(b) else None


def enrich(row):
    f = row['financials']
    history = row.get('financialHistory', {}).get('annual', {})
    annual = []
    for key, original in sorted(history.items()):
        prior = history.get(str(int(key[:4]) - 1) + key[4:], {})
        equity = [original.get('StockholdersEquity'), prior.get('StockholdersEquity')]
        annual.append({**original,
            'revenueGrowth': change(original.get('TotalRevenue'), prior.get('TotalRevenue')),
            'profitGrowth': change(original.get('NetIncome'), prior.get('NetIncome')),
            'roe': ratio(original.get('NetIncome'), sum(equity) / 2) if all(finite(v) and v > 0 for v in equity) else None})
    last = annual[-1] if annual else {}
    base = history.get(str(int(last['period'][:4]) - 3) + last['period'][4:], {}) if last else {}
    def cagr(metric):
        a, b = last.get(metric), base.get(metric)
        if not finite(a) or not finite(b):
            return {'value': None, 'reason': '缺满三年的年度端点'}
        if a <= 0 or b <= 0:
            return {'value': None, 'reason': '利润端点亏损或为零' if metric == 'NetIncome' else '营收端点非正'}
        return {'value': ((a / b) ** (1 / 3) - 1) * 100, 'start': base['period'], 'end': last['period']}
    recent = annual[-3:]
    consecutive = len(recent) == 3 and all(int(b['period'][:4]) - int(a['period'][:4]) == 1 and a['period'][4:] == b['period'][4:] for a, b in zip(recent, recent[1:]))
    row['analysis'] = {'annual': annual, 'revenueCagr3': cagr('TotalRevenue'), 'profitCagr3': cagr('NetIncome'),
        'roe3': sum(r['roe'] for r in recent) / 3 if consecutive and all(finite(r['roe']) for r in recent) else None,
        'roe3Periods': [r['period'] for r in recent], 'lossYears': [r['period'] for r in annual if finite(r.get('NetIncome')) and r['NetIncome'] < 0],
        'ttmNetMargin': ratio(f.get('ttmProfit'), f.get('ttmRevenue')),
        'cashConversion': ratio(f.get('ttmCash'), f.get('ttmProfit'), 1),
        'grossMargin': ratio(f.get('GrossProfit'), f.get('TotalRevenue'))}
    quarterly_eps = f.get('ListingDilutedEPSUSD') if row['financialCurrency'] != 'USD' else f.get('DilutedEPS')
    annual_eps = last.get('DilutedEPS') if row['financialCurrency'] == 'USD' else last.get('ListingDilutedEPSUSD')
    row['peDynamic'] = ratio(row['price'], quarterly_eps * 4 if finite(quarterly_eps) else None, 1)
    row['peStatic'] = ratio(row['price'], annual_eps, 1)
    row['staticPeriod'] = last.get('reportDate') if last.get('dateBasis') == 'issuer_report_end' else last.get('period')
    row['epsForecastGrowth'] = change(row.get('epsForward'), row.get('epsTTM'))
    return row


def fmt(v, suffix='', scale=1):
    return f'{v / scale:,.2f}{suffix}' if finite(v) else '—'


def report_for(s):
    from us_stock_groups import LABELS
    f, a, r = s['financials'], s['analysis'], s['research']
    c = '亿新台币' if s['financialCurrency'] == 'TWD' else '亿美元'
    revenue = s.get('revenueLabel', '营收')
    g = lambda v: fmt(v.get('value'), '%') if finite(v.get('value')) else v.get('label') or v.get('reason') or '—'
    period = lambda q: q['reportDate'] if q.get('dateBasis') == 'issuer_report_end' else q['period'] + '季'
    def pe_value(key):
        if finite(s.get(key)):
            return fmt(s[key])
        base = f if key == 'peDynamic' else a['annual'][-1] if a['annual'] else {}
        eps = base.get('DilutedEPS' if s['financialCurrency'] == 'USD' else 'ListingDilutedEPSUSD')
        return ('亏损' if eps < 0 else 'EPS为零') if finite(eps) else '缺美元' + ('ADR' if s['financialCurrency'] != 'USD' else '') + ('季度' if key == 'peDynamic' else '年度') + 'EPS'
    sections = []
    def add(id, title, **values):
        sections.append({'id': id, 'title': title, **values})
    add('thesis', '核心判断', paragraphs=[r['summary'],
        '最新单季' + revenue + '同比' + g(f['revenueGrowth']) + '，净利润同比' + g(f['profitGrowth']) + '；TTM ROE ' + fmt(f.get('roeTTM'), '%') + '，营业利润率' + fmt(f.get('operatingMargin'), '%') + '。'],
        links=[{'label': '对应公司原始财报', 'url': f['sourceUrl']}])
    add('business', '业务与竞争力', bullets=r['thesis'])
    screening = s['screening']
    add('screening', '分类、收录依据与当前条件', paragraphs=[
        '本期分类：' + '、'.join(LABELS[g] for g in screening['groups']) + '；财务核对日' + screening['checkedAt'] + '，经营研究覆盖' + r['reportPeriod'] + '。',
        s['coverageBasis'] + '。',
        '五年平均年度ROE ' + fmt(screening.get('roe5'), '%') + '；三年利润复合 ' + g(a['profitCagr3']) + '。回购会改变净资产，ROE与营业利润、现金、业务持续性一起判断。'],
        table={'headers':['分类','当前结论','具体依据'], 'rows':[
            [LABELS[group], '入选' if verdict['qualified'] else '未入选',
             '；'.join(check['reason'] for check in verdict['checks'] if not check['pass']) or
             ('同时符合长期优质或高质成长，已在对应分类收录' if group == 'breakout' and not verdict['qualified'] else '财务条件与当前经营/分红研究均成立')]
            for group, verdict in screening['reviews'].items()]})
    operating = r['earningsReview']
    add('drivers', '主营增长、特殊项目与周期', paragraphs=[
        operating['driver'], operating['nonOperating'], operating['priceCycle'], operating['consolidation']],
        table={'headers':['金额或指标','数值','来源位置'], 'rows':[
            [e['label'], fmt(e['value'], '亿美元' if e['unit'] == 'USD' else '亿新台币' if e['unit'] == 'TWD' else e['unit'], 1e8 if e['unit'] in ('USD','TWD') else 1),
             e['location'] + (' · 由对应报表金额计算' if e['basis'] == 'calculated' else '')]
            for e in operating['evidence']]},
        links=[{'label':source['label'],'url':source['url']} for source in r['sources']])
    add('quarterly', '最新季度与盈利变化', paragraphs=[f.get('note') or '单季数据与年度数据分开。同比使用同一币种的上年同期；负基数不计算具有误导性的增长百分比。'],
        table={'headers': ['财季截至', revenue + ' / ' + c, '报表净利润 / ' + c, '营业利润 / ' + c, '经营现金流 / ' + c],
            'rows': [[period(q)] + [fmt(q.get(k), scale=1e8) for k in ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'OperatingCashFlow']] for q in sorted(s['financialHistory']['quarterly'].values(), key=lambda x: x['period'], reverse=True)]})
    add('annual', '年度财务与增长持续性', paragraphs=[
        '三年' + revenue + '复合增长：' + g(a['revenueCagr3']) + '；三年报表利润复合增长：' + g(a['profitCagr3']) + '。',
        '最近三个完整财年平均ROE：' + fmt(a['roe3'], '%') + '；使用各年利润除以该年期初期末平均净资产，不能替代当前TTM。',
        '已收录年度中的亏损期：' + ('、'.join(a['lossYears']) or '无') + '。未收录年度不能据此推断。'],
        table={'headers': ['财年截至', revenue + ' / ' + c, revenue + '同比', '净利润 / ' + c, '利润同比', '经营现金流 / ' + c, 'ROE'],
            'rows': [[q['reportDate'] if q.get('dateBasis') == 'issuer_report_end' else q['period'], fmt(q.get('TotalRevenue'), scale=1e8), fmt(q['revenueGrowth'], '%'), fmt(q.get('NetIncome'), scale=1e8), fmt(q['profitGrowth'], '%'), fmt(q.get('OperatingCashFlow'), scale=1e8), fmt(q['roe'], '%')] for q in reversed(a['annual'])]})
    cash_note = 'TTM利润非正或连续季度不足，不计算现金流/净利润倍数。' if a['cashConversion'] is None else ('现金回收暂低于同期利润，应继续核对营运资金、税款和非现金项目。' if a['cashConversion'] < 1 else '经营现金流覆盖同期利润；仍需扣除资本支出后才能判断自由现金流。')
    if s.get('accountingModel') in ('bank', 'financial', 'holding'):
        cash_note = '金融与投资控股公司的经营现金包含存贷款、证券及投资活动变化，现金/净利润只作报表展示，不套经营企业现金回收门槛；需要信用、资本和分部盈利专题判断。'
    elif s.get('accountingModel') == 'reits':
        cash_note = 'REIT的资产折旧影响GAAP利润，派息承受能力单独看AFFO及债务、出租率；不以现金/GAAP净利润倍数授予工业企业质量标签。'
    add('quality', '盈利质量与现金回收', paragraphs=[cash_note,
        '报表利润保留一次性项目。Non-GAAP调整口径因公司而异，不能与A股扣非归母利润直接比较。'],
        table={'headers': ['指标', '数值', '口径'], 'rows': [
            ['TTM' + revenue, fmt(f.get('ttmRevenue'), scale=1e8), c], ['TTM净利润', fmt(f.get('ttmProfit'), scale=1e8), c],
            ['TTM经营现金流', fmt(f.get('ttmCash'), scale=1e8), c], ['现金流 / 净利润', fmt(a['cashConversion'], '倍'), '连续四季、净利润为正'],
            ['TTM净利率', fmt(a['ttmNetMargin'], '%'), 'TTM利润 / TTM' + revenue], ['最新单季毛利率', fmt(a['grossMargin'], '%'), '报表毛利 / ' + revenue],
            ['最新单季营业利润率', fmt(f.get('operatingMargin'), '%'), '报表营业利润 / ' + revenue]]})
    add('valuation', '估值与盈利假设', paragraphs=[
        'TTM和预测EPS均为美元上市证券口径。预测EPS是分析师预期，采集日' + s['estimateAsOf'] + '，不代表已经兑现的利润。',
        '预测EPS较TTM变化' + fmt(s['epsForecastGrowth'], '%') + '。TTM EPS非正时不计算增长率；从亏损转为盈利的预测需要单独检验。',
        '季度年化PE只将最新一季EPS乘4，存在季节性，和分析师预测PE分开。历史5年/10年PE分位缺逐时点已披露EPS序列，未以今天的EPS回填历史。'],
        table={'headers': ['指标', '数值', '说明'], 'rows': [
            ['收盘价', fmt(s['price']), '美元 · ' + s['priceAsOf']], ['PE / TTM', fmt(s['pe']) if s['peStatus'] != 'loss' else '亏损', '收盘价 / TTM EPS'],
            ['季度年化PE', pe_value('peDynamic'), period(f) + '单季EPS × 4'], ['静态PE', pe_value('peStatic'), (s.get('staticPeriod') or '') + '完整财年；须美元EPS'],
            ['预测PE', fmt(s['peForward']), '分析师年度预期'], ['TTM EPS', fmt(s['epsTTM']), '美元 / 上市证券单位'], ['预测EPS', fmt(s['epsForward']), '美元 / 上市证券单位']]})
    income = r.get('incomeReview') or {}
    income_notes = [income[k] for k in ('rationale', 'capitalReview') if income.get(k)]
    add('dividends', '分红与持有回报', paragraphs=[
        '近12月已除息的每份现金分红' + fmt(s.get('cashDividend12'), '美元', 1) + '，以当前收盘价计算股息率' + fmt(s.get('yield12'), '%') + '。ADR使用美元上市份额，不混用新台币普通股分红。',
        '下表为美元含分红再投资回报，未扣投资者佣金及税款；不是组合策略的资金收益。'] + income_notes,
        table={'headers': ['区间', '累计收益', '年化收益'], 'rows': [[str(y) + '年', fmt(v, '%'), fmt(((1 + v / 100) ** (1 / y) - 1) * 100, '%') if finite(v) else '历史不足'] for y, v in zip([1, 2, 3, 5, 10], s['r'])]})
    add('risks', '风险与后续验证', bullets=r['risks'] + r['watch'])
    add('sources', '来源与计算边界', paragraphs=[
        '观点复核日' + r['reviewedAt'] + '；行情与财务指标随数据刷新重新生成。新财报出现后，旧经营研究不自动续期；必须复核新期间才能保持对应分类。',
        'SEC结构化年度与季度财报为历史主来源，接口用于补充；公司原始业绩披露补足尚未进入SEC结构化数据的财季。保留公告日、财年实际结束日、计算操作数及原始链接。报表净利润优先归属母公司口径，普通股EPS扣优先股等影响，二者不混用。',
        f.get('roeMissing') or 'TTM ROE使用连续四季净利润和期初期末平均净资产。'], links=[
            {'label': '公司原始财报', 'url': s['sourceUrl']}, {'label': 'SEC历史财报与XBRL', 'url': 'https://data.sec.gov/api/xbrl/companyfacts/CIK' + str(s['cik']).zfill(10) + '.json'}, {'label': '补充财务接口', 'url': 'https://finance.yahoo.com/quote/' + s['symbol'] + '/financials/'},
            {'label': '美元行情、拆分与分红', 'url': s['returnSourceUrl']}, {'label': '分析师盈利预期', 'url': 'https://finance.yahoo.com/quote/' + s['symbol'] + '/analysis/'}] + ([{'label': '证券身份与历史延续边界', 'url': s['identitySourceUrl']}] if s.get('identitySourceUrl') else []))
    report = {'code': s['symbol'], 'name': s['name'], 'business': s['business'], 'category': s['category'], 'groups': [LABELS[g] for g in screening['groups']],
        'asOf': r['reviewedAt'], 'marketAsOf': s['priceAsOf'], 'reportPeriod': f['reportDate'], 'summary': r['summary'], 'sections': sections}
    from scripts.build_stock_reports import markdown
    report['markdown'] = markdown(report)
    return report
