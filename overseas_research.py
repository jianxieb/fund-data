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
    f, a, r = s['financials'], s['analysis'], s['research']
    c = '亿新台币' if s['financialCurrency'] == 'TWD' else '亿美元'
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
        '最新单季营收同比' + g(f['revenueGrowth']) + '，净利润同比' + g(f['profitGrowth']) + '；TTM ROE ' + fmt(f.get('roeTTM'), '%') + '，营业利润率' + fmt(f.get('operatingMargin'), '%') + '。'],
        links=[{'label': '对应公司原始财报', 'url': f['sourceUrl']}])
    add('business', '业务与竞争力', bullets=r['thesis'])
    add('quarterly', '最新季度与盈利变化', paragraphs=[f.get('note') or '单季数据与年度数据分开。同比使用同一币种的上年同期；负基数不计算具有误导性的增长百分比。'],
        table={'headers': ['财季截至', '营收 / ' + c, '报表净利润 / ' + c, '营业利润 / ' + c, '经营现金流 / ' + c],
            'rows': [[period(q)] + [fmt(q.get(k), scale=1e8) for k in ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'OperatingCashFlow']] for q in sorted(s['financialHistory']['quarterly'].values(), key=lambda x: x['period'], reverse=True)]})
    add('annual', '年度财务与增长持续性', paragraphs=[
        '三年营收复合增长：' + g(a['revenueCagr3']) + '；三年报表利润复合增长：' + g(a['profitCagr3']) + '。',
        '最近三个完整财年平均ROE：' + fmt(a['roe3'], '%') + '；使用各年利润除以该年期初期末平均净资产，不能替代当前TTM。',
        '已收录年度中的亏损期：' + ('、'.join(a['lossYears']) or '无') + '。未收录年度不能据此推断。'],
        table={'headers': ['财年截至', '营收 / ' + c, '营收同比', '净利润 / ' + c, '利润同比', '经营现金流 / ' + c, 'ROE'],
            'rows': [[q['reportDate'] if q.get('dateBasis') == 'issuer_report_end' else q['period'], fmt(q.get('TotalRevenue'), scale=1e8), fmt(q['revenueGrowth'], '%'), fmt(q.get('NetIncome'), scale=1e8), fmt(q['profitGrowth'], '%'), fmt(q.get('OperatingCashFlow'), scale=1e8), fmt(q['roe'], '%')] for q in reversed(a['annual'])]})
    cash_note = 'TTM利润非正或连续季度不足，不计算现金流/净利润倍数。' if a['cashConversion'] is None else ('现金回收暂低于同期利润，应继续核对营运资金、税款和非现金项目。' if a['cashConversion'] < 1 else '经营现金流覆盖同期利润；仍需扣除资本支出后才能判断自由现金流。')
    add('quality', '盈利质量与现金回收', paragraphs=[cash_note,
        '报表利润保留一次性项目。Non-GAAP调整口径因公司而异，不能与A股扣非归母利润直接比较。'],
        table={'headers': ['指标', '数值', '口径'], 'rows': [
            ['TTM营收', fmt(f.get('ttmRevenue'), scale=1e8), c], ['TTM净利润', fmt(f.get('ttmProfit'), scale=1e8), c],
            ['TTM经营现金流', fmt(f.get('ttmCash'), scale=1e8), c], ['现金流 / 净利润', fmt(a['cashConversion'], '倍'), '连续四季、净利润为正'],
            ['TTM净利率', fmt(a['ttmNetMargin'], '%'), 'TTM利润 / TTM营收'], ['最新单季毛利率', fmt(a['grossMargin'], '%'), '报表毛利 / 营收'],
            ['最新单季营业利润率', fmt(f.get('operatingMargin'), '%'), '报表营业利润 / 营收']]})
    add('valuation', '估值与盈利假设', paragraphs=[
        'TTM和预测EPS均为美元上市证券口径。预测EPS是分析师预期，采集日' + s['estimateAsOf'] + '，不代表已经兑现的利润。',
        '预测EPS较TTM变化' + fmt(s['epsForecastGrowth'], '%') + '。TTM EPS非正时不计算增长率；从亏损转为盈利的预测需要单独检验。',
        '季度年化PE只将最新一季EPS乘4，存在季节性，和分析师预测PE分开。历史5年/10年PE分位缺逐时点已披露EPS序列，未以今天的EPS回填历史。'],
        table={'headers': ['指标', '数值', '说明'], 'rows': [
            ['收盘价', fmt(s['price']), '美元 · ' + s['priceAsOf']], ['PE / TTM', fmt(s['pe']) if s['peStatus'] != 'loss' else '亏损', '收盘价 / TTM EPS'],
            ['季度年化PE', pe_value('peDynamic'), period(f) + '单季EPS × 4'], ['静态PE', pe_value('peStatic'), (s.get('staticPeriod') or '') + '完整财年；须美元EPS'],
            ['预测PE', fmt(s['peForward']), '分析师年度预期'], ['TTM EPS', fmt(s['epsTTM']), '美元 / 上市证券单位'], ['预测EPS', fmt(s['epsForward']), '美元 / 上市证券单位']]})
    add('dividends', '分红与持有回报', paragraphs=[
        '近12月已除息的每份现金分红' + fmt(s.get('cashDividend12'), '美元', 1) + '，以当前收盘价计算股息率' + fmt(s.get('yield12'), '%') + '。ADR使用美元上市份额，不混用新台币普通股分红。',
        '下表为美元含分红再投资回报，未扣投资者佣金及税款；不是组合策略的资金收益。'],
        table={'headers': ['区间', '累计收益', '年化收益'], 'rows': [[str(y) + '年', fmt(v, '%'), fmt(((1 + v / 100) ** (1 / y) - 1) * 100, '%') if finite(v) else '历史不足'] for y, v in zip([1, 2, 3, 5, 10], s['r'])]})
    add('risks', '风险与后续验证', bullets=r['risks'] + r['watch'])
    add('sources', '来源与计算边界', paragraphs=[
        '观点复核日' + r['reviewedAt'] + '；行情与财务指标随数据刷新重新生成。这里是公司研究，未自动授予“长期优质”或“高质成长”的筛选结论。',
        '财报币种与美元行情分开。年度历史来自下列财报接口；最新财季按公司原始披露核对。TTM和三年指标均要求相应完整期间。只标年月的历史期间表示接口归一化财季月份，完整日期按公司披露。',
        f.get('roeMissing') or 'TTM ROE使用连续四季净利润和期初期末平均净资产。'], links=[
            {'label': '公司原始财报', 'url': s['sourceUrl']}, {'label': '年度及季度历史财务', 'url': 'https://finance.yahoo.com/quote/' + s['symbol'] + '/financials/'},
            {'label': '美元行情、拆分与分红', 'url': s['returnSourceUrl']}, {'label': '分析师盈利预期', 'url': 'https://finance.yahoo.com/quote/' + s['symbol'] + '/analysis/'}] + ([{'label': 'SPCX证券身份与历史隔离', 'url': s['identitySourceUrl']}] if s.get('identitySourceUrl') else []))
    report = {'code': s['symbol'], 'name': s['name'], 'business': s['business'], 'category': s['category'], 'groups': ['海外研究'],
        'asOf': r['reviewedAt'], 'marketAsOf': s['priceAsOf'], 'reportPeriod': f['reportDate'], 'summary': r['summary'], 'sections': sections}
    from scripts.build_stock_reports import markdown
    report['markdown'] = markdown(report)
    return report
