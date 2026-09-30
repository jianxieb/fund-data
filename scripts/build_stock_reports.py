#!/usr/bin/env python3
"""Build dated report readers and Markdown from reviewed analysis + frozen inputs."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from company_report import compute
from stock_fundamentals import numeric
from stock_screen import apply_research_profile, refresh_quality_review
from stock_earnings import margin_bridge, profit_bridge, unit_bridge


def fmt(value, digits=2, suffix=''):
    return f'{value:,.{digits}f}' + suffix if numeric(value) is not None else '—'


def amount(value):
    return fmt(value / 1e8) if numeric(value) is not None else '—'


def growth(value):
    return f'{value:+.2f}%' if numeric(value) is not None else '无可比正基数'


def report_row(data):
    context = data['screeningContext']
    profile = context['profile']
    reports = data['reports']
    annual = [r for r in reports if r['reportDate'].endswith('12-31')]
    q = data['quote']
    row = dict(context['security'])
    row.update(c=data['code'], n=data['name'], mcap=q['mcap'], pe=q['pe'],
               financialHistory=annual[:3], financialHistory5=annual[:5],
               financialReports=reports, latestFinancials=reports[0])
    end = annual[0] if annual else {}
    start = next((r for r in annual if r['year'] == end.get('year', 0) - 3), {})
    row['financialGrowth3'] = {'years': 3, 'start': start.get('reportDate'), 'end': end.get('reportDate')}
    for key in ('revenue', 'netProfit', 'deductedProfit'):
        a, b = numeric(end.get(key)), numeric(start.get(key))
        row['financialGrowth3'][key] = ((a / b) ** (1 / 3) - 1) * 100 if a is not None and b is not None and min(a, b) > 0 else None
    if profile:
        apply_research_profile(row, profile)
        refresh_quality_review(row, data['asOf'])
    return row


def make_report(research, data, row):
    calculated = compute(data)
    latest, annual, q = calculated['latest'], calculated['annual'], data['quote']
    if research['reportPeriod'] != latest['reportDate'] or research['reviewedAt'] != data['asOf']:
        raise ValueError(data['code'] + ' 的业务研究与财报/研究日期不一致，需要重新审阅后生成')
    financial = research['sectorModel'] == 'financial'
    groups = [label for key, label in [('longTermReview', '长期优质'), ('growthReview', '高质成长')]
               if (row.get(key) or {}).get('qualified')]
    if not groups and (row.get('breakoutReview') or {}).get('qualified'):
        groups = ['业绩爆发']
    if row.get('group') == 'dividend':
        groups = ['红利价值']
    core = calculated['cashMetrics'][0]
    sections = []
    def section(id_, title, **kwargs):
        sections.append({'id': id_, 'title': title, **kwargs})
    section('view', '研究判断', paragraphs=[research['assessment']], bullets=research['thesis'])
    if row.get('qualityResearch'):
        selection = []
        for key, label in [('longTermReview', '长期优质企业'), ('growthReview', '高质成长股'), ('breakoutReview', '业绩爆发股')]:
            review = row.get(key)
            if not review or (key == 'breakoutReview' and not research.get('breakout')):
                continue
            failures = [c.get('reason') or c['label'] for c in review['checks'] if not c['pass']]
            selection.append([label, '满足条件' if review['qualified'] else '未入选', '；'.join(failures) or '满足当前财务条件及对应报告研究要求'])
        section('selection', '筛选定位', table={'headers': ['研究方向', '本次结果', '具体依据'], 'rows': selection})
    business = research.get('longTerm') or {}
    if business:
        section('durability', '长期经营能力', paragraphs=[business['durability'], business['reinvestment']],
                bullets=['失效信号：' + business['invalidation']])
    growth_research = research.get('growth') or {}
    if growth_research:
        section('growth', '当前成长阶段', paragraphs=[growth_research['driver'], growth_research['quality']],
                bullets=['失效信号：' + growth_research['invalidation']])
    breakout_research = research.get('breakout') or {}
    if breakout_research:
        operating = research.get('earningsReview') or {}
        section('breakout', '盈利扩张的来源', paragraphs=[breakout_research['driver'], breakout_research['quality']],
                bullets=['失效信号：' + breakout_research['invalidation']])
    attribution = research.get('earningsReview') or {}
    if attribution:
        previous = next((r for r in data['reports'] if r['reportDate'] == str(int(latest['reportDate'][:4]) - 1) + latest['reportDate'][4:]), {})
        # Conclusions and numbers are frozen together; stale edited tables cannot silently pass.
        for key, calculation in [('marginBridge', margin_bridge), ('profitBridge', profit_bridge)]:
            if attribution.get(key) != calculation(previous, latest):
                raise ValueError(data['code'] + ' 的盈利贡献表与冻结财报金额不一致')
        section('attribution', '利润增量与经营拆分', paragraphs=[attribution[k] for k in ('rationale', 'priceEffect', 'consolidationEffect')],
                table={'headers': ['经营证据', '数值', '口径', '来源位置'], 'rows': [
                    [e['label'], amount(e['value']) + ' 亿元' if e['unit'] == '元' else fmt(e['value']) + ' ' + e['unit'],
                     {'disclosed': '公司披露', 'calculated': '金额复算', 'estimate': '估算'}[e['basis']] + ('；' + e['note'] if e.get('note') else ''), e['sourcePages']]
                    for e in attribution['quantitativeEvidence']]}, links=[{'label': '本期拆分所用公司报告 / 披露', 'url': u} for u in attribution['sourceUrls']])
        bridge = attribution.get('profitBridge')
        if bridge:
            section('profit-bridge', '从毛利到归母扣非', paragraphs=['下表是同比金额变化，单位亿元；各项相加等于扣非利润增量。费用和其他损益合并项不等于纯降本。'],
                    table={'headers': ['同比增量项目', '贡献 / 亿元'], 'rows': [[label, amount(bridge[key])] for key, label in [
                        ('grossProfitChange', '毛利变化'), ('otherProfitEffect', '期间费用、减值、投资及其他税前损益'),
                        ('taxEffect', '所得税变化'), ('minorityEffect', '少数股东归属变化'),
                        ('nonRecurringEffect', '归母非经常损益扣除变化'), ('coreProfitChange', '合计：归母扣非增量')]]})
        unit_rows = []
        for item in attribution.get('unitInputs', []):
            b = unit_bridge(item)
            if b is None:
                raise ValueError(data['code'] + ' 的销量/单价/单位成本基准不一致')
            unit_rows.append([item['label']] + [amount(b[k]) for k in ('volumeEffect', 'priceMixEffect', 'unitCostEffect', 'grossProfitChange')])
        if unit_rows:
            section('unit-bridge', '销量、售价与单位成本', paragraphs=attribution.get('limitations', []),
                    table={'headers': ['产品', '销量贡献 / 亿元', '售价及组合 / 亿元', '单位成本 / 亿元', '毛利增量 / 亿元'], 'rows': unit_rows})
    section('financials', '五年财务与最新报告',
            paragraphs=['金额为人民币亿元；ROE为各报告期加权平均值，中报不年化。历史数为本次取数时已知口径，可能含后续重述。'],
            table={'headers': ['报告期', '营收', '归母利润', '扣非利润', '经营现金流', '购建长期资产', 'ROE', '公告日'],
                   'rows': [[r['reportDate'], amount(r['revenue']), amount(r['netProfit']), amount(r['deductedProfit']),
                             amount(r['operatingCashFlow']), amount(r['capex']), fmt(r['roe'], 2, '%'), r['announcedAt']]
                            for r in [latest] + [a for a in annual if a['reportDate'] != latest['reportDate']]]})
    section('quarters', '最近八个单季',
            paragraphs=['单季由累计金额相减，分别与上年同季比较。归母或扣非基数非正时不以普通增速展示。'],
            table={'headers': ['单季截至', '营收', '营收同比', '归母利润', '归母同比', '扣非同比'],
                   'rows': [[r['reportDate'], amount(r['revenue']), growth(r['revenueGrowth']), amount(r['netProfit']),
                             growth(r['netProfitGrowth']), growth(r['deductedProfitGrowth'])] for r in calculated['quarters']]})
    cash_paragraphs = [
        '本期归母利润' + amount(latest['netProfit']) + '亿元，扣非利润' + amount(latest['deductedProfit']) +
        '亿元；扣非占归母' + fmt(core['deductedRatio'] * 100 if core['deductedRatio'] is not None else None, 2, '%') +
        '。归母与扣非的差额需区分处置、补助、公允价值等因素，不能全归因于主营。']
    if financial:
        cash_paragraphs.append('金融租赁现金流包含资产投放与回收，不采用工业净现比或经营现金流减资本开支来判断可分配收益。利差、信用减值和监管资本是本公司的分析重点。')
    else:
        cash_paragraphs += [
            '本期经营现金流' + amount(latest['operatingCashFlow']) + '亿元，为归母利润的' + fmt(core['cashProfitRatio']) +
            '倍；TTM经营现金流' + amount(calculated['ttm']['operatingCashFlow']) + '亿元。累计盈利和当期回款须同时观察。',
            '本期购建长期资产现金支出' + amount(latest['capex']) + '亿元，扣除后的经营现金余量为' +
            amount(core['cashAfterCapex']) + '亿元。这一口径尚未拆分维护/扩张投资、租赁、并购和融资影响，不能当作严格FCFF或可分配现金。',
            '期末应收账款' + amount(latest['receivables']) + '亿元、存货' + amount(latest['inventory']) +
            '亿元，资产负债率' + fmt(latest['debtRatio'], 2, '%') + '。后续应与同期间收入、回款和备货用途比较，避免把较年末变化冒充同比。']
    section('cash', '盈利质量与现金回收', paragraphs=cash_paragraphs)
    valuation = [['交易日', q['valuationAsOf']], ['价格 / 元', fmt(q['valuationPrice'])],
                 ['市值 / 亿元', fmt(q['mcap'])], ['PE / TTM（来源）', fmt(q['pe'])],
                 ['PE / TTM（利润金额复算）', fmt(calculated['peFromProfitAmounts'])],
                 ['静态PE', fmt(q['peStatic'])], ['动态PE（累计利润年化）', fmt(q['peDynamic'])], ['PB / MRQ', fmt(q['pb'])]]
    # Do not splice a newer live percentile into an older dated report.
    if data.get('pePercentilesAsOf') == q['valuationAsOf']:
        for years in (5, 10):
            p = (data.get('pePercentiles') or {}).get(str(years), {})
            valuation.append([str(years) + '年PE分位', fmt(p['value'], 1, '%') if numeric(p.get('value')) is not None else p.get('reason', '缺同日历史估值')])
    section('valuation', '估值与定价条件', paragraphs=[research['valuationContext'],
            '动态PE按最新已公告累计利润年化，受季节性影响，不是分析师预测。当前缺逐公司可核验的预测/可比倍数/资本成本假设，本版不输出目标价。'],
            table={'headers': ['指标', '数值'], 'rows': valuation})
    section('sensitivity', '盈利与估值变化的影响',
            paragraphs=['以下是固定股本、忽略分红的代数敏感性，不是盈利预测或合理价格：价格变化=(1+每股盈利变化)×(1+PE变化)−1。'],
            table={'headers': ['每股盈利变化', 'PE下降20%', 'PE不变', 'PE上升20%'],
                   'rows': [[growth(g * 100)] + [growth(((1 + g) * (1 + m) - 1) * 100) for m in (-.2, 0, .2)] for g in (-.2, 0, .2)]})
    dividend = calculated['dividend']
    section('dividends', '股息与分配', paragraphs=[
        '近12月已实施分红折合当前每股' + fmt(dividend['cash12'], 4) + '元，按' + q['valuationAsOf'] + '价格计算股息率' + fmt(dividend['yield12'], 2, '%') + '。',
        dividend['yieldBasis'] + '。财年合计记录原每股金额，跨送转前后须另作股本核对；因此不混用历史EPS生成分红率。'],
            table={'headers': ['所属报告期', '每股现金 / 元', '除权日', '状态'],
                   'rows': [[r['fiscalPeriod'], fmt(r['cashPerShare'], 4), r['exDate'], '已实施']
                            for r in sorted(dividend['records'], key=lambda x: x['exDate'], reverse=True)[:6]]})
    section('risks', '风险与下一次验证', bullets=research['risks'] + ['跟踪：' + t for t in research['watchMetrics']])
    notes = data.get('researchNotes', [])[:6]
    section('broker', '近期公开研报线索', paragraphs=[
        '近180日目录按机构保留最新一篇；标题不是本报告认可的结论。未逐篇核对EPS财年与股本口径，因此不合成为一致预期。' if notes else '近180日目录未取得可列示的研报，未沿用陈旧样本充当当前机构预期。'],
            links=[{'label': n['institution'] + ' · ' + n['publishedAt'] + ' · ' + n['title'], 'url': n['sourceUrl']} for n in notes])
    if research.get('corrections'):
        section('changes', '对原报告的更正', bullets=research['corrections'])
    source_links = [{'label': x['title'] + ' · ' + x['publishedAt'] + ' · 页' + x['pages'], 'url': x['url']} for x in research['sources']]
    source_links += [{'label': x['title'], 'url': x['url']} for x in data['sources']]
    section('sources', '来源与本次研究范围', paragraphs=[research['coverage'],
            '本版财报期' + latest['reportDate'] + '，市场数据' + q['valuationAsOf'] + '，研究日' + data['asOf'] + '。以后行情刷新不代表本文业务判断同步更新。'],
            links=source_links)
    return {'code': data['code'], 'name': data['name'], 'business': research['business'], 'category': research['category'],
            'asOf': data['asOf'], 'marketAsOf': q['valuationAsOf'], 'reportPeriod': latest['reportDate'],
            'groups': groups, 'summary': research['assessment'], 'sections': sections,
            'markdownPath': 'docs/company-reports/' + data['code'] + '-' + data['asOf'] + '.md',
            'archivePath': research.get('archivePath'),
            'metrics': {'revenueGrowth': latest['revenueGrowth'], 'profitGrowth': latest['deductedProfitGrowth'],
                        'roe': latest['roe'], 'pe': q['pe']}}


def markdown(report):
    lines = ['# ' + report['name'] + '（' + report['code'] + '）深入分析', '',
             report['business'] + ' · ' + (' / '.join(report['groups']) or '专题研究'), '',
             '研究日：' + report['asOf'] + '；行情：' + report['marketAsOf'] + '；财报期：' + report['reportPeriod'], '']
    for section in report['sections']:
        lines += ['## ' + section['title'], '']
        for p in section.get('paragraphs', []):
            lines += [p, '']
        for p in section.get('bullets', []):
            lines.append('- ' + p)
        if section.get('bullets'):
            lines.append('')
        if section.get('table'):
            t = section['table']
            lines += ['| ' + ' | '.join(t['headers']) + ' |', '| ' + ' | '.join(['---'] * len(t['headers'])) + ' |']
            lines += ['| ' + ' | '.join(map(str, row)) + ' |' for row in t['rows']]
            lines.append('')
        for link in section.get('links', []):
            lines.append('- [' + link['label'] + '](' + link['url'] + ')')
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def build(check_only=False):
    research = json.loads((ROOT / 'data/stock-report-research.json').read_text())
    reports, outputs = [], {}
    for r in research['companies']:
        data = json.loads((ROOT / 'company-report/data' / r['code'] / 'summary.json').read_text())
        report = make_report(r, data, report_row(data))
        reports.append(report)
        outputs[report['markdownPath']] = markdown(report)
    outputs['data/stock-reports.js'] = '/* Dated research reports; generated by scripts/build_stock_reports.py. */\nvar STOCK_REPORTS=' + json.dumps({'schemaVersion': 1, 'asOf': research['reviewedAt'], 'reports': reports}, ensure_ascii=False, separators=(',', ':')) + ';\n'
    for path, body in outputs.items():
        target = ROOT / path
        if check_only:
            if not target.exists() or target.read_text() != body:
                raise ValueError('报告产物需重建：' + path)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding='utf-8')
    print('报告', len(reports), '检查通过' if check_only else '已生成')
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    build(parser.parse_args().check)
