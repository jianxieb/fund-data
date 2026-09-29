"""Reproducible A-share report inputs and calculations; amounts are CNY yuan.

No default target prices, inferred forecast years, EPS addition across share bases,
or substitution of missing capex with zero. Research conclusions live separately.
"""
import json
import math
import statistics
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from stock_fundamentals import numeric, financial_report, source_url, parse_evidence


def known_rows(code, rows, asof, day_key='REPORT_DATE'):
    symbol = code + ('.SH' if code[0] in '5689' else '.SZ')
    result = {}
    for row in rows:
        if row.get('SECUCODE') != symbol or str(row.get('SECURITY_CODE')) != code:
            raise ValueError('证券身份不符：' + code)
        day = str(row.get(day_key) or '')[:10]
        notice = str(row.get('NOTICE_DATE') or '')[:10]
        date.fromisoformat(day)
        if day > asof or (day_key == 'REPORT_DATE' and (not notice or notice > asof)):
            continue
        if day_key == 'REPORT_DATE':
            date.fromisoformat(notice)
        if day not in result or notice > str(result[day].get('NOTICE_DATE') or '')[:10]:
            result[day] = row
    return sorted(result.values(), key=lambda r: r[day_key], reverse=True)


def quarter_history(reports):
    """Derive individual quarters from cumulative amounts, never subtract ROE."""
    by_day = {r['reportDate']: r for r in reports}
    result = []
    for r in reports:
        day, month = r['reportDate'], int(r['reportDate'][5:7])
        if month not in (3, 6, 9, 12):
            continue
        prior_end = {6: '03-31', 9: '06-30', 12: '09-30'}.get(month)
        left = by_day.get(day[:4] + '-' + prior_end) if prior_end else None
        if prior_end and not left:
            continue
        q = {'reportDate': day, 'announcedAt': r['announcedAt']}
        for key in ('revenue', 'netProfit', 'deductedProfit', 'operatingCashFlow'):
            current, previous = numeric(r.get(key)), numeric(left.get(key)) if left else 0
            q[key] = current - previous if current is not None and previous is not None else None
        result.append(q)
    indexed = {r['reportDate']: r for r in result}
    for q in result:
        prev = indexed.get(str(int(q['reportDate'][:4]) - 1) + q['reportDate'][4:], {})
        for key in ('revenue', 'netProfit', 'deductedProfit'):
            current, previous = numeric(q.get(key)), numeric(prev.get(key))
            q[key + 'Growth'] = (current / previous - 1) * 100 if current is not None and previous is not None and previous > 0 else None
            q[key + 'Previous'] = previous
    return sorted(result, key=lambda r: r['reportDate'], reverse=True)


def ttm_amount(reports, key, cutoff=None):
    eligible = [r for r in reports if not cutoff or r['announcedAt'] <= cutoff]
    if not eligible:
        return None
    latest = max(eligible, key=lambda r: r['reportDate'])
    value = numeric(latest.get(key))
    day = latest['reportDate']
    if day.endswith('12-31'):
        return value
    by_day = {r['reportDate']: r for r in eligible}
    last_year = str(int(day[:4]) - 1)
    annual = numeric(by_day.get(last_year + '-12-31', {}).get(key))
    previous = numeric(by_day.get(last_year + day[4:], {}).get(key))
    return value + annual - previous if all(v is not None for v in (value, annual, previous)) else None


def normalize(code, raw, asof, sources=None):
    date.fromisoformat(asof)
    financials = known_rows(code, raw.get('financials', []), asof)
    valuations = known_rows(code, raw.get('valuation', []), asof, 'TRADE_DATE')
    if not financials or not valuations:
        raise ValueError('缺已公告财报或有日期的行情：' + code)
    statements = {key: {r['REPORT_DATE'][:10]: r for r in known_rows(code, raw.get(key, []), asof)}
                  for key in ('balance', 'cashflow')}
    reports = []
    for row in financials:
        r = financial_report(row, financials)
        r.update({key: numeric(row.get(field)) for key, field in
                  [('eps', 'EPSJB'), ('grossMargin', 'XSMLL'), ('netMargin', 'XSJLL'), ('debtRatio', 'ZCFZL')]})
        for key, mapping in [('cashflow', {'capex': 'CONSTRUCT_LONG_ASSET'}),
                             ('balance', {'assets': 'TOTAL_ASSETS', 'cash': 'MONETARYFUNDS',
                                          'receivables': 'ACCOUNTS_RECE', 'inventory': 'INVENTORY',
                                          'liabilities': 'TOTAL_LIABILITIES', 'equity': 'TOTAL_EQUITY'})]:
            record = statements[key].get(r['reportDate'], {})
            r.update({out: numeric(record.get(field)) for out, field in mapping.items()})
            if record:
                r['announcedAt'] = max(r['announcedAt'], str(record['NOTICE_DATE'])[:10])
        reports.append(r)
    evidence = parse_evidence(code, valuations, financials, asof)
    return {'schemaVersion': 2, 'code': code, 'name': financials[0]['SECURITY_NAME_ABBR'],
            'asOf': asof, 'currency': 'CNY', 'amountUnit': 'yuan', 'consolidated': True,
            'quote': {key: evidence[key] for key in ('valuationAsOf', 'valuationPrice', 'mcap', 'pe', 'peStatic', 'peDynamic', 'pb')},
            'reports': reports, 'sources': sources or [], 'forecasts': [], 'dividends': [], 'peers': []}


def forecast_sample(forecasts, asof, max_age_days=180):
    """One latest institution estimate per explicit fiscal year and share basis."""
    latest, excluded = {}, 0
    for row in forecasts:
        try:
            published = date.fromisoformat(row['publishedAt'])
            age = (date.fromisoformat(asof) - published).days
            eps = numeric(row.get('eps'))
            year = row['fiscalYear']
            valid = (0 <= age <= max_age_days and row.get('institution') and row.get('shareBasis')
                     and row.get('sourceUrl', '').startswith('https://') and isinstance(year, int)
                     and year >= int(asof[:4]) and eps is not None and eps > 0)
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            excluded += 1
            continue
        key = (row['institution'].strip(), year)
        row = {**row, 'eps': eps}
        if key not in latest or row['publishedAt'] > latest[key]['publishedAt']:
            if key in latest:
                excluded += 1
            latest[key] = row
        else:
            excluded += 1
    grouped = {}
    for row in latest.values():
        grouped.setdefault((row['fiscalYear'], row['shareBasis']), []).append(row)
    return {'label': '公开研报样本（非全市场一致预期）', 'excluded': excluded,
            'groups': [{'fiscalYear': year, 'shareBasis': basis, 'institutions': len(rows),
                        'medianEps': statistics.median(r['eps'] for r in rows),
                        'meanEps': statistics.mean(r['eps'] for r in rows), 'records': rows}
                       for (year, basis), rows in sorted(grouped.items())]}


def dividend_summary(dividends, price, asof):
    today = date.fromisoformat(asof)
    try:
        cutoff = today.replace(year=today.year - 1).isoformat()
    except ValueError:
        cutoff = today.replace(year=today.year - 1, day=28).isoformat()
    paid, incomplete = {}, False
    for row in dividends:
        if row.get('status') != 'implemented':
            continue
        if not row.get('exDate'):
            incomplete = True
            continue
        if row['exDate'] > asof:
            continue
        if not row.get('announcedAt') or not row.get('fiscalPeriod'):
            incomplete = True
            continue
        if row['announcedAt'] > asof:
            continue
        try:
            for key in ('exDate', 'fiscalPeriod', 'announcedAt'):
                date.fromisoformat(row[key])
        except (ValueError, TypeError):
            incomplete = True
            continue
        cash, factor = numeric(row.get('cashPerShare')), numeric(row.get('splitFactor', 1))
        if (cash is None or cash >= 0) and factor is not None and factor > 0:
            paid[(row['exDate'], row['fiscalPeriod'])] = {**row, 'cashPerShare': cash, 'splitFactor': factor}
        else:
            incomplete = True
    fiscal = {}
    for row in paid.values():
        year = row['fiscalPeriod'][:4]
        previous = fiscal.get(year, 0)
        fiscal[year] = previous + row['cashPerShare'] if previous is not None and row['cashPerShare'] is not None else None
    def adjusted_cash(row):
        factor = math.prod(r.get('splitFactor', 1) for r in paid.values() if row['exDate'] <= r['exDate'] <= asof)
        return row['cashPerShare'] / factor
    recent = [r for r in paid.values() if cutoff < r['exDate'] <= asof]
    known = bool(dividends) and not incomplete and all(r['cashPerShare'] is not None for r in recent)
    cash12 = sum(adjusted_cash(r) for r in recent) if known else None
    # Empty input is unknown, not proof of no dividends. Split-adjusted payout
    # ratios require a separately verified share basis, so no default payout.
    return {'cash12': cash12,
            'yield12': cash12 / price * 100 if cash12 is not None and price and price > 0 else None,
            'byFiscalYear': fiscal, 'payoutRatio': None, 'records': list(paid.values()),
            'payoutReason': '需核对同一财年已实施分红及送转调整后的每股盈利口径',
            'yieldBasis': '除权日近12月已实施现金分红，按已收录送转事件折为当前每股；不含预案'}


def wacc(equity, debt, cost_equity, cost_debt, tax):
    values = [numeric(x) for x in (equity, debt, cost_equity, cost_debt, tax)]
    if any(x is None for x in values) or equity <= 0 or debt < 0 or not 0 <= tax <= 1 or min(cost_equity, cost_debt) < 0:
        raise ValueError('WACC需要正权益市值、非负有息债务市值及有效成本、税率；现金另列')
    return equity / (equity + debt) * cost_equity + debt / (equity + debt) * cost_debt * (1 - tax)


def compute(data):
    if data.get('schemaVersion') != 2 or data.get('currency') != 'CNY' or data.get('amountUnit') != 'yuan' or data.get('consolidated') is not True:
        raise ValueError('仅接受schemaVersion=2、CNY元、合并报表输入；旧summary需重新取数')
    asof = data['asOf']
    date.fromisoformat(asof)
    reports = sorted(data['reports'], key=lambda r: r['reportDate'], reverse=True)
    if not reports or any(r['reportDate'] > asof or r['announcedAt'] > asof for r in reports):
        raise ValueError('财务输入为空或含截止日后数据')
    if len({r['reportDate'] for r in reports}) != len(reports):
        raise ValueError('财务报告期重复')
    q = data['quote']
    date.fromisoformat(q['valuationAsOf'])
    if q['valuationAsOf'] > asof:
        raise ValueError('行情日期晚于研究截止日')
    if any(numeric(q.get(k)) is None or q[k] <= 0 for k in ('valuationPrice', 'mcap')):
        raise ValueError('价格与市值须为正数')
    annual = [r for r in reports if r['reportDate'].endswith('12-31')][:5]
    latest = reports[0]
    def ratio(a, b):
        return a / b if numeric(a) is not None and numeric(b) is not None and b > 0 else None
    ttm = {key: ttm_amount(reports, key) for key in ('revenue', 'netProfit', 'deductedProfit', 'operatingCashFlow', 'capex')}
    quoted_profit = ttm_amount(reports, 'netProfit', q['valuationAsOf'])
    pe = ratio(q['mcap'] * 1e8 if numeric(q.get('mcap')) is not None else None, quoted_profit)
    cash_metrics = []
    for r in [latest] + [a for a in annual if a['reportDate'] != latest['reportDate']]:
        ocf, capex = numeric(r.get('operatingCashFlow')), numeric(r.get('capex'))
        cash_metrics.append({'reportDate': r['reportDate'], 'cashProfitRatio': ratio(ocf, r.get('netProfit')),
                             'deductedRatio': ratio(r.get('deductedProfit'), r.get('netProfit')),
                             'cashAfterCapex': ocf - capex if ocf is not None and capex is not None else None})
    # Currency/date/basis and business comparability must be supplied explicitly.
    peers = [p for p in data.get('peers', []) if p.get('code') != data['code']
             and p.get('asOf') == q['valuationAsOf'] and p.get('currency') == 'CNY'
             and p.get('peBasis') == 'TTM' and p.get('comparabilityReason')
             and p.get('sourceUrl', '').startswith('https://') and (numeric(p.get('pe')) or 0) > 0]
    peers = list({p['code']: p for p in peers}.values())
    return {'schemaVersion': 2, 'code': data['code'], 'asOf': asof, 'annual': annual, 'latest': latest,
            'quarters': quarter_history(reports)[:8], 'ttm': ttm, 'peFromProfitAmounts': pe,
            'cashMetrics': cash_metrics,
            'forecasts': forecast_sample(data.get('forecasts', []), asof),
            'dividend': dividend_summary(data.get('dividends', []), q.get('valuationPrice'), q['valuationAsOf']),
            'peers': {'records': peers, 'medianPe': statistics.median(p['pe'] for p in peers) if len(peers) >= 3 else None},
            'valuation': {'targetPrice': None, 'reason': '缺逐公司可核验的预测、可比估值或资本成本假设；不输出固定倍数目标价'},
            'cashFlowBasis': '经营现金流减购建长期资产现金支出；不是完整FCFF，也不代表可分配现金'}


def fetch_report(code, asof, fetcher, cached_financials=None):
    raw, sources, errors = dict(cached_financials or {}), [], []
    for key, report, sort, size in [
        ('financials', 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 40),
        ('valuation', 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 2),
        ('balance', 'RPT_DMSK_FN_BALANCE', 'REPORT_DATE', 32),
        ('cashflow', 'RPT_DMSK_FN_CASHFLOW', 'REPORT_DATE', 32),
    ]:
        url = source_url(code, report, sort, size)
        try:
            if key not in raw:
                payload = fetcher(url)
                if not payload.get('success') or not (payload.get('result') or {}).get('data'):
                    raise ValueError(payload.get('message') or '空数据')
                raw[key] = payload['result']['data']
            sources.append({'title': report, 'url': url, 'fetchedAt': datetime.now(timezone.utc).isoformat()})
        except Exception as exc:
            raw[key] = []
            errors.append(key + ': ' + str(exc))
    data = normalize(code, raw, asof, sources)
    extras = fetch_supplements(code, asof, fetcher)
    data['sources'] += extras.pop('supplementSources', [])
    errors += extras.pop('supplementErrors', [])
    data.update(extras)
    data['fetchErrors'] = errors
    return data


def fetch_supplements(code, asof, fetcher):
    """Retain broker titles as leads; unverified EPS share bases stay unaggregated."""
    data = {'dividends': [], 'researchNotes': [], 'forecasts': [], 'supplementErrors': [], 'supplementSources': []}
    dividend_url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + urllib.parse.urlencode({
        'reportName': 'RPT_SHAREBONUS_DET', 'columns': 'ALL', 'filter': '(SECURITY_CODE="%s")' % code,
        'pageSize': 100, 'pageNumber': 1, 'sortColumns': 'REPORT_DATE', 'sortTypes': -1})
    begin = (date.fromisoformat(asof) - timedelta(days=180)).isoformat()
    research_url = 'https://reportapi.eastmoney.com/report/list?' + urllib.parse.urlencode({
        'industryCode': '*', 'pageSize': 100, 'industry': '*', 'rating': '*', 'ratingChange': '*',
        'beginTime': begin, 'endTime': asof, 'pageNo': 1, 'qType': 0, 'code': code})
    try:
        payload = fetcher(dividend_url)
        result = payload.get('result') or {}
        if not isinstance(result.get('data'), list) or result.get('count', 0) > len(result['data']):
            raise ValueError('分红响应缺失或被分页截断')
        for row in result['data']:
            if str(row.get('SECURITY_CODE')) != code:
                raise ValueError('分红证券身份不符')
            data['dividends'].append({'fiscalPeriod': str(row.get('REPORT_DATE') or '')[:10],
                'announcedAt': str(row.get('NOTICE_DATE') or '')[:10], 'exDate': str(row.get('EX_DIVIDEND_DATE') or '')[:10],
                'status': 'implemented' if row.get('ASSIGN_PROGRESS') == '实施分配' else 'proposed',
                'cashPerShare': numeric(row.get('PRETAX_BONUS_RMB')) / 10 if numeric(row.get('PRETAX_BONUS_RMB')) is not None else None,
                'splitFactor': 1 + ((numeric(row.get('BONUS_RATIO')) or 0) + (numeric(row.get('IT_RATIO')) or 0)) / 10,
                'sourceUrl': dividend_url})
        data['supplementSources'].append({'title': '已实施及拟议权益分派', 'url': dividend_url, 'fetchedAt': asof})
    except Exception as exc:
        data['supplementErrors'].append('dividends: ' + str(exc))
    try:
        payload = fetcher(research_url)
        if not isinstance(payload.get('data'), list) or payload.get('TotalPage', 0) > 1:
            raise ValueError('研报响应缺失或被分页截断')
        latest = {}
        for row in payload['data']:
            day, org = str(row.get('publishDate') or '')[:10], row.get('orgSName')
            if row.get('stockCode') != code or not org or not row.get('infoCode') or not begin <= day <= asof:
                continue
            note = {'institution': org, 'publishedAt': day, 'title': row['title'],
                    'sourceUrl': 'https://pdf.dfcfw.com/pdf/H3_' + row['infoCode'] + '_1.pdf',
                    'status': '仅核对目录，未把标题视为本研究结论'}
            if org not in latest or day > latest[org]['publishedAt']:
                latest[org] = note
        data['researchNotes'] = sorted(latest.values(), key=lambda r: r['publishedAt'], reverse=True)
        data['supplementSources'].append({'title': '近180日公开研报目录（同机构留最新）', 'url': research_url, 'fetchedAt': asof})
    except Exception as exc:
        data['supplementErrors'].append('researchNotes: ' + str(exc))
    return data
