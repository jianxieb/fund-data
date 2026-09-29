"""Dated valuation and annual financial evidence for the stock research pool."""
import json
import math
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path
from stock_valuations import percentile_evidence

CACHE = Path(__file__).resolve().parent / '.tmp-snap/stocks/fundamentals'


def numeric(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def source_url(code, report, sort, size):
    symbol = code + ('.SH' if code[0] in '5689' else '.SZ')
    return 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + urllib.parse.urlencode({
        'reportName': report, 'columns': 'ALL', 'filter': '(SECUCODE="%s")' % symbol,
        'pageSize': size, 'pageNumber': 1, 'sortColumns': sort, 'sortTypes': '-1'})


def financial_report(row, reports):
    """Keep cumulative report-period growth separate from quarterly growth and ROE."""
    day = row['REPORT_DATE'][:10]
    prior_day = str(int(day[:4]) - 1) + day[4:]
    prior = next((r for r in reports if r['REPORT_DATE'][:10] == prior_day), {})
    result = {'year': int(day[:4]), 'reportDate': day,
              'announcedAt': str(row.get('NOTICE_DATE') or '')[:10],
              'roe': numeric(row.get('ROEJQ')),
              'roePrevious': numeric(prior.get('ROEJQ')),
              'roePreviousPeriod': prior_day if prior else None,
              'deductedRoe': numeric(row.get('ROEKCJQ')),
              'operatingCashFlow': numeric(row.get('NETCASH_OPERATE_PK'))}
    result['roeChangePoints'] = round(result['roe'] - result['roePrevious'], 4) if result['roe'] is not None and result['roePrevious'] is not None else None
    result['roeChangePercent'] = round((result['roe'] / result['roePrevious'] - 1) * 100, 4) if result['roe'] is not None and result['roePrevious'] is not None and result['roePrevious'] > 0 else None
    for key, field, growth_field in [
        ('revenue', 'TOTALOPERATEREVE', 'TOTALOPERATEREVETZ'),
        ('netProfit', 'PARENTNETPROFIT', 'PARENTNETPROFITTZ'),
        ('deductedProfit', 'KCFJCXSYJLR', 'KCFJCXSYJLRTZ'),
    ]:
        value, base = numeric(row.get(field)), numeric(prior.get(field))
        growth, status = numeric(row.get(growth_field)), None
        if value is None:
            growth, status = None, '缺本期金额'
        elif base is not None and base <= 0:
            # Positive percentages from a loss or zero base are not normal growth.
            growth = None
            status = '扭亏' if base < 0 < value else '上年同期为零' if base == 0 else '减亏' if value > base else '亏损扩大' if value < base else '持续亏损'
        elif growth is None and base is not None and base > 0:
            growth = (value / base - 1) * 100
        elif growth is None:
            status = '缺同比数据'
        result[key] = value
        result[key + 'Growth'] = round(growth, 4) if growth is not None else None
        result[key + 'GrowthStatus'] = status
    return result


def research_category(industry):
    for category, terms in [
        ('科技制造', ('消费电子', '半导体', '通信设备', '计算机', '光学光电子')),
        ('医药健康', ('医疗', '制药', '医药', '中药', '生物制品')),
        ('汽车与装备', ('汽车', '乘用车', '商用车', '自动化', '工程机械', '电网设备')),
        ('新能源', ('电池', '光伏', '风电')),
        ('资源与化工', ('金属', '煤炭', '石油', '油气', '炼化', '化学', '化工', '水泥')),
        ('消费', ('食品', '饮料', '白酒', '调味', '家电', '养殖', '广告')),
        ('公用事业', ('电力', '运营商', '通信服务')),
        ('交通物流', ('物流', '航运', '铁路', '公路')),
        ('金融服务', ('银行', '证券', '保险', '金融')),
        ('基础建设', ('建设', '建筑')),
    ]:
        if any(term in industry for term in terms):
            return category
    return industry or '行业未收录'


def parse_evidence(code, valuation, financials, asof):
    symbol = code + ('.SH' if code[0] in '5689' else '.SZ')
    def valid(rows, day_key, announcement=False):
        accepted = []
        for row in rows:
            if row.get('SECUCODE') != symbol or str(row.get('SECURITY_CODE')) != code:
                raise ValueError('财务数据标的身份不符：' + code)
            day = str(row.get(day_key) or '')[:10]
            date.fromisoformat(day)
            notice = str(row.get('NOTICE_DATE') or '')[:10]
            if announcement and not notice:
                continue
            if announcement:
                date.fromisoformat(notice)
            if day > asof or (announcement and notice > asof):
                continue
            accepted.append(row)
        return sorted(accepted, key=lambda row: row[day_key], reverse=True)
    quotes = valid(valuation, 'TRADE_DATE')
    reports = valid(financials, 'REPORT_DATE', True)
    q = quotes[0] if quotes else {}
    quote_day = str(q.get('TRADE_DATE') or '')[:10]
    known = next((r for r in reports if str(r['NOTICE_DATE'])[:10] <= quote_day), {})
    period = str(known.get('REPORT_DATE') or '')[:10]
    months = int(period[5:7]) if period and period[5:] in ('03-31', '06-30', '09-30', '12-31') else 0
    profit = numeric(known.get('PARENTNETPROFIT'))
    market_cap = numeric(q.get('TOTAL_MARKET_CAP'))
    annualized_profit = profit * 12 / months if profit is not None and months else None
    dynamic_pe = market_cap / annualized_profit if market_cap is not None and market_cap > 0 and annualized_profit is not None and annualized_profit > 0 else None
    annual = [r for r in reports if str(r['REPORT_DATE'])[:10].endswith('-12-31')][:3]
    history = [financial_report(r, reports) for r in annual]
    growth = {'years': 3, 'start': None, 'end': history[0]['reportDate'] if history else None,
              'revenue': None, 'netProfit': None}
    if annual:
        start = str(int(annual[0]['REPORT_DATE'][:4]) - 3) + '-12-31'
        base = next((r for r in reports if r['REPORT_DATE'][:10] == start), {})
        growth['start'] = start if base else None
        for key, field in [('revenue', 'TOTALOPERATEREVE'), ('netProfit', 'PARENTNETPROFIT')]:
            first, last = numeric(base.get(field)), numeric(annual[0].get(field))
            if first is not None and first > 0 and last is not None and last > 0:
                growth[key] = round(((last / first) ** (1 / 3) - 1) * 100, 4)
    return {'pe': numeric(q.get('PE_TTM')), 'peStatic': numeric(q.get('PE_LAR')),
            'peDynamic': round(dynamic_pe, 4) if dynamic_pe is not None else None,
            'peDynamicBasis': {'method': 'latest_report_profit_annualized', 'reportDate': period or None,
                               'announcedAt': str(known.get('NOTICE_DATE') or '')[:10] or None,
                               'valuationAsOf': quote_day or None, 'months': months or None,
                               'profit': profit, 'annualizedProfit': annualized_profit,
                               'status': 'available' if dynamic_pe is not None else 'loss' if profit is not None and profit <= 0 else 'missing_report'},
            'pb': numeric(q.get('PB_MRQ')),
            'valuationIndustry': q.get('BOARD_NAME') or None,
            'researchCategory': research_category(q.get('BOARD_NAME') or ''),
            'mcap': numeric(q.get('TOTAL_MARKET_CAP')) / 1e8 if numeric(q.get('TOTAL_MARKET_CAP')) is not None else None,
            'valuationPrice': numeric(q.get('CLOSE_PRICE')),
            'valuationAsOf': str(q.get('TRADE_DATE') or '')[:10] or None,
            'valuationSource': 'Eastmoney RPT_VALUEANALYSIS_DET: PE_TTM / PB_MRQ',
            'valuationSourceUrl': source_url(code, 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 2),
            'roe': history[0]['roe'] if history else None,
            'roeAsOf': history[0]['reportDate'] if history else None,
            'roeBasis': '年度加权平均ROE', 'financialHistory': history,
            'latestFinancials': financial_report(reports[0], reports) if reports else None,
            'financialGrowth3': growth,
            'fundamentalsAsOf': str(reports[0]['REPORT_DATE'])[:10] if reports else None,
            'fundamentalsSourceUrl': source_url(code, 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 20),
            'fundamentalsStatus': 'dated_source' if q and len(history) == 3 else 'incomplete_source'}


def fetch_evidence(code, fetcher, asof):
    results, errors = {}, []
    for key, report, sort, size in [('valuation', 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 10000),
                                    ('financials', 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 20)]:
        try:
            payload = fetcher(source_url(code, report, sort, size))
            if not payload.get('success') or not (payload.get('result') or {}).get('data'):
                raise ValueError(payload.get('message') or '没有财务记录')
            if key == 'valuation' and payload['result'].get('count', 0) > len(payload['result']['data']):
                raise ValueError('历史估值响应被分页截断')
            results[key] = payload['result']['data']
        except Exception as exc:
            results[key] = []
            errors.append(key + ': ' + str(exc))
    parsed = parse_evidence(code, results['valuation'], results['financials'], asof)
    parsed['pePercentiles'] = percentile_evidence(code, results['valuation'], parsed['pe'], parsed['valuationAsOf'] or asof)
    parsed['peHistorySourceUrl'] = source_url(code, 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 10000)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / (code + '.json')).write_text(json.dumps({'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'sourceResponses': results, 'errors': errors}, ensure_ascii=False), encoding='utf-8')
    parsed['fundamentalsErrors'] = errors
    return parsed


def latest_report_review(latest, asof):
    """Recheck current operations against the same reporting period, not full-year ROE."""
    year, month_day = int(asof[:4]), asof[5:]
    due = '%d-09-30' % (year - 1)
    for deadline, report_end in [('04-30', '03-31'), ('08-31', '06-30'), ('10-31', '09-30')]:
        if month_day >= deadline:
            due = '%d-%s' % (year, report_end)
    day = latest.get('reportDate') or ''
    def growth_ok(key):
        value = numeric(latest.get(key + 'Growth'))
        return (value is not None and value >= -20) or latest.get(key + 'GrowthStatus') == '扭亏'
    def growth_failure(keys):
        declines, unavailable = [], []
        for key, label in keys:
            if growth_ok(key):
                continue
            value = numeric(latest.get(key + 'Growth'))
            if value is not None:
                declines.append(label + '同比下降%.2f%%' % -value)
            else:
                status = latest.get(key + 'GrowthStatus') or '缺同比数据'
                unavailable.append(label + '：' + status)
        text = '、'.join(declines) + '，超过20%降幅上限' if declines else ''
        return '；'.join(([text] if text else []) + unavailable), 'threshold' if declines else 'evidence'
    roe, previous = numeric(latest.get('roe')), numeric(latest.get('roePrevious'))
    roe_ok = roe is not None and roe > 0 and previous is not None and (previous <= 0 or roe / previous >= 0.7)
    revenue_reason, revenue_kind = growth_failure([('revenue', '营收')])
    profit_reason, profit_kind = growth_failure([('netProfit', '归母利润'), ('deductedProfit', '扣非利润')])
    amounts = [(label, numeric(latest.get(key))) for key, label in [('netProfit', '归母利润'), ('deductedProfit', '扣非利润')]]
    positive_failures = [label + ('金额缺失' if value is None else '为%.2f亿元，未满足大于0的条件' % (value / 1e8))
                         for label, value in amounts if value is None or value <= 0]
    roe_reason, roe_kind = '', 'threshold'
    if roe is None:
        roe_reason, roe_kind = '缺最新报告加权平均ROE', 'evidence'
    elif roe <= 0:
        roe_reason = '最新报告ROE为%.2f%%，未满足大于0的条件' % roe
    elif previous is None:
        roe_reason, roe_kind = '缺上年同期ROE，无法比较相对降幅', 'evidence'
    elif not roe_ok:
        roe_reason = 'ROE %.2f%%→%.2f%%，相对下降%.2f%%，超过30%%降幅上限' % (previous, roe, (1 - roe / previous) * 100)
    checks = [
        {'label': '已收录最新应披露报告（截至%s）' % due, 'pass': day >= due,
         'reason': '缺截至%s的应披露财报，现有报告截至%s' % (due, day or '未知') if day < due else None, 'failureKind': 'evidence'},
        {'label': '最新报告归母及扣非利润均为正', 'pass': not positive_failures,
         'reason': '；'.join(positive_failures) or None,
         'failureKind': 'threshold' if any(v is not None and v <= 0 for _, v in amounts) else 'evidence'},
        {'label': '最新营收同比降幅不超过20%', 'pass': growth_ok('revenue'),
         'reason': revenue_reason or None, 'failureKind': revenue_kind},
        {'label': '最新归母及扣非利润同比降幅均不超过20%', 'pass': growth_ok('netProfit') and growth_ok('deductedProfit'),
         'reason': profit_reason or None, 'failureKind': profit_kind},
        {'label': '最新ROE为正，较上年同期相对降幅不超过30%', 'pass': roe_ok,
         'reason': roe_reason or None, 'failureKind': roe_kind},
    ]
    return checks


def quality_review(row, asof):
    history = row.get('financialHistory') or []
    years = [r['year'] for r in history]
    latest_due_year = int(asof[:4]) - (1 if asof[5:] >= '04-30' else 2)
    complete = len(years) == 3 and years[0] >= latest_due_year and years == list(range(years[0], years[0] - 3, -1))
    def every(key):
        return complete and all(numeric(r.get(key)) is not None and r[key] > 0 for r in history)
    roes = [numeric(r.get('roe')) for r in history]
    average = sum(roes) / 3 if complete and all(v is not None for v in roes) else None
    first = row.get('historyFirst')
    observed_years = (date.fromisoformat(asof) - date.fromisoformat(first)).days / 365.2425 if first else 0
    checks = [
        {'label': '非金融企业（金融企业单独观察）', 'pass': not any(k in (row.get('valuationIndustry') or row.get('ind') or '') for k in ('银行', '保险', '证券', '金融'))},
        {'label': '可观察历史≥5年', 'pass': observed_years >= 5},
        {'label': '总市值≥100亿元', 'pass': (numeric(row.get('mcap')) or 0) >= 100},
        {'label': '最近3个完整财年持续盈利', 'pass': every('netProfit')},
        {'label': '最近3个完整财年经营现金流为正', 'pass': every('operatingCashFlow')},
        {'label': '3年平均年度ROE≥10%', 'pass': average is not None and average >= 10 and all(v > 0 for v in roes)},
        {'label': '非ST企业', 'pass': 'ST' not in row.get('n', '').upper()},
    ]
    cash = sum(r['operatingCashFlow'] for r in history) if complete and all(numeric(r.get('operatingCashFlow')) is not None for r in history) else None
    profit = sum(r['netProfit'] for r in history) if complete and all(numeric(r.get('netProfit')) is not None for r in history) else None
    cash_ratio = cash / profit if cash is not None and profit is not None and profit > 0 else None
    historical_qualified = all(c['pass'] for c in checks)
    latest = row.get('latestFinancials') or {}
    recent_checks = latest_report_review(latest, asof)
    recent_pass = all(c['pass'] for c in recent_checks)
    qualified = historical_qualified and recent_pass
    reasons = []
    if every('netProfit'):
        reasons.append('连续3年盈利，合计归母利润%.1f亿元' % (profit / 1e8))
    if average is not None:
        reasons.append('3年平均ROE %.1f%%，各年%.1f%%–%.1f%%' % (average, min(roes), max(roes)))
    if every('operatingCashFlow') and cash_ratio is not None:
        reasons.append('连续3年经营现金流为正，合计为归母利润的%.2f倍' % cash_ratio)
    growth = row.get('financialGrowth3') or {}
    growing = [label + '复合增长%+.1f%%' % growth[key]
               for key, label in [('revenue', '营收'), ('netProfit', '归母利润')]
               if numeric(growth.get(key)) is not None and growth[key] > 0]
    if growing:
        reasons.append('3年' + '，'.join(growing))
    watchouts = []
    if not recent_checks[0]['pass']:
        watchouts.append('最新应披露财报未收录；现有报告截至' + (latest.get('reportDate') or '未知'))
    for report in [latest] + history[:1]:
        if not report or (report is not latest and report.get('reportDate') == latest.get('reportDate')):
            continue
        period = report['reportDate'][:4] + {'03-31': '一季报', '06-30': '中报', '09-30': '三季报', '12-31': '年报'}.get(report['reportDate'][5:], '')
        for key, label in [('netProfitGrowth', '归母利润'), ('deductedProfitGrowth', '扣非利润'), ('revenueGrowth', '营收')]:
            if numeric(report.get(key)) is not None and report[key] < 0:
                watchouts.append(period + label + '同比%+.1f%%' % report[key])
        if numeric(report.get('netProfit')) is not None and report['netProfit'] < 0:
            watchouts.append(period + '归母净亏损')
        if numeric(report.get('operatingCashFlow')) is not None and report['operatingCashFlow'] < 0:
            watchouts.append(period + '经营现金流为负（%.1f亿元）' % (report['operatingCashFlow'] / 1e8))
    if numeric(latest.get('roeChangePoints')) is not None and latest['roeChangePoints'] < 0:
        watchouts.append('最新ROE较上年同期下降%.2f个百分点（%.2f%%→%.2f%%）' % (-latest['roeChangePoints'], latest['roePrevious'], latest['roe']))
    for key, label in [('revenue', '营收'), ('netProfit', '归母利润')]:
        if numeric(growth.get(key)) is not None and growth[key] < 0:
            watchouts.append('3年' + label + '复合增长%+.1f%%' % growth[key])
    if cash_ratio is not None and cash_ratio < 1:
        watchouts.append('3年经营现金流合计低于归母利润（%.2f倍）' % cash_ratio)
    if history and numeric(history[0].get('roe')) is not None and history[0]['roe'] < 10:
        watchouts.append('%s年ROE低于10%%（%.1f%%）' % (history[0]['year'], history[0]['roe']))
    return {'qualified': qualified, 'historicalQualified': historical_qualified,
            'reviewRequired': historical_qualified and not recent_pass,
            'status': 'qualified' if qualified else 'review' if historical_qualified else 'outside_screen',
            'checks': checks + recent_checks, 'historicalChecks': checks, 'recentChecks': recent_checks,
            'reasons': reasons, 'watchouts': watchouts,
            'cashProfitRatio3': round(cash_ratio, 4) if cash_ratio is not None else None,
            'roe3': round(average, 2) if average is not None else None,
            'years': years, 'checkedAt': asof, 'basis': 'research_pool_financial_screen_v2'}
