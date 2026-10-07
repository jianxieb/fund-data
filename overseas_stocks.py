#!/usr/bin/env python3
"""Identity-checked overseas equities, separate from the A-share screening model."""
import argparse
import http.cookiejar
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import strategy_backtest
import overseas_research
import us_filings
from us_stock_groups import classify, LABELS
from data_status import ROOT, DATA, atomic_text, now_iso, write_status
from update import add_years, risk_window

CACHE = ROOT / '.tmp-snap' / 'overseas-stocks'
CATALOG = json.loads((DATA / 'overseas-stock-catalog.json').read_text())['stocks']
EVIDENCE = json.loads((DATA / 'overseas-stock-evidence.json').read_text())['companies']
RESEARCH = json.loads((DATA / 'overseas-stock-research.json').read_text())
HISTORY_PATH = DATA / 'us-financial-history.json'
SEC_HISTORY = json.loads(HISTORY_PATH.read_text()).get('companies', {}) if HISTORY_PATH.exists() else {}
METRICS = ['TotalRevenue', 'NetIncome', 'TotalOperatingIncomeAsReported', 'GrossProfit',
           'StockholdersEquity', 'OperatingCashFlow', 'DilutedEPS']
UA = {'User-Agent': 'Mozilla/5.0'}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def request_json(url, client=None):
    opener = client.open if client else urllib.request.urlopen
    with opener(urllib.request.Request(url, headers=UA), timeout=25) as response:
        return json.load(response)


def cache_json(symbol, name, value=None):
    path = CACHE / (symbol + '-' + name + '.json')
    if value is None:
        return json.loads(path.read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    atomic_text(path, json.dumps(value, ensure_ascii=False, allow_nan=False))
    return value


def fetch_quotes():
    # A fresh anonymous Yahoo session; no account, saved credentials or cookie files.
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    try:
        client.open(urllib.request.Request('https://fc.yahoo.com', headers=UA), timeout=15).read()
    except urllib.error.HTTPError:
        pass  # This endpoint sets the public cookie even when returning 404.
    with client.open(urllib.request.Request('https://query1.finance.yahoo.com/v1/test/getcrumb', headers=UA), timeout=15) as response:
        crumb = response.read().decode()
    url = 'https://query1.finance.yahoo.com/v7/finance/quote?' + urllib.parse.urlencode({
        'symbols': ','.join(s['symbol'] for s in CATALOG), 'crumb': crumb})
    rows = request_json(url, client).get('quoteResponse', {}).get('result', [])
    if {q.get('symbol') for q in rows} != {s['symbol'] for s in CATALOG}:
        raise ValueError('美股报价未完整返回已收录证券身份')
    for row in rows:
        row['_fetchedAt'] = now_iso()
        cache_json(row['symbol'], 'quote', row)


def normalize_history(node, company, end):
    symbol, meta = company['symbol'], node.get('meta', {})
    name = meta.get('longName') or meta.get('shortName') or ''
    if meta.get('instrumentType') != 'EQUITY' or meta.get('currency') != 'USD' or name != company['issuer']:
        raise ValueError(symbol + ' 发行人、股票类型或美元身份不符')
    source = 'https://finance.yahoo.com/quote/' + symbol + '/history/'
    result = strategy_backtest.normalize_chart(node, symbol, source, end)
    # A ticker reuse is not a continuous security. Reject the old issuer, then
    # remove observations before the verified listing date from every price field.
    floor = company.get('listingDate', '1900-01-01')
    result['data'] = [r for r in result['data'] if r['date'] >= floor]
    result.update(issuer=name, instrumentType='EQUITY', identitySourceUrl=company.get('identitySourceUrl'))
    if len(result['data']) < 2:
        raise ValueError(symbol + ' 缺至少两条已收盘复权历史')
    series = [[r['date'], r['adjustedClose']] for r in result['data']]
    if any((date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days > 14 for a, b in zip(series, series[1:])):
        raise ValueError(symbol + ' 日线存在超过14日的缺口')
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    prices = (node.get('indicators', {}).get('quote') or [{}])[0].get('close') or []
    closes = {datetime.fromtimestamp(t, zone).date().isoformat(): p for t, p in zip(node['timestamp'], prices) if finite(p) and p > 0}
    result['close'] = closes.get(series[-1][0])
    if not result['close']:
        raise ValueError(symbol + ' 缺同日收盘价，不能以复权价格计算PE')
    events = node.get('events', {})
    cutoff = add_years(series[-1][0], -1)
    event_day = lambda event: datetime.fromtimestamp(event['date'], zone).date().isoformat()
    dividends = sorted([{'day': event_day(event), 'amount': event['amount']} for event in events.get('dividends', {}).values()
                        if finite(event.get('amount')) and floor <= event_day(event) <= series[-1][0]], key=lambda e: e['day'])
    recent_split = any(cutoff < event_day(event) <= series[-1][0] and event_day(event) >= floor
                       for event in events.get('splits', {}).values())
    cash12 = sum(d['amount'] for d in dividends if d['day'] > cutoff) if not recent_split else None
    result.update(dividendRecords=dividends, cashDividend12=cash12,
                  dividendMissing='近12月有拆股，缺每份分红统一股本口径' if recent_split else None)
    return result


def stock_history(symbol, offline=True, end=None):
    company = next(s for s in CATALOG if s['symbol'] == symbol)
    end = end or (datetime.now(ZoneInfo('Asia/Shanghai')).date() - timedelta(days=1)).isoformat()
    if not offline:
        stamp = int(datetime.combine(date.fromisoformat(end) + timedelta(days=1), datetime.min.time(), timezone.utc).timestamp())
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?' + urllib.parse.urlencode({
            'period1': 0, 'period2': stamp, 'interval': '1d', 'events': 'div,splits'})
        raw = cache_json(symbol, 'chart', request_json(url))
    else:
        raw = cache_json(symbol, 'chart')
    nodes = raw.get('chart', {}).get('result') or []
    if len(nodes) != 1:
        raise ValueError(symbol + ' 行情接口未返回唯一股票')
    return normalize_history(nodes[0], company, end)


def parse_facts(payload, symbol, financial_currency):
    output = {'quarterly': {}, 'annual': {}}
    for item in payload.get('timeseries', {}).get('result') or []:
        if item.get('meta', {}).get('symbol') != [symbol]:
            raise ValueError(symbol + ' 财报接口身份不符')
        metric = (item['meta'].get('type') or [''])[0]
        prefix = next((p for p in output if metric.startswith(p)), None)
        if not prefix or metric[len(prefix):] not in METRICS:
            continue
        for value in item.get(metric, []):
            if value.get('currencyCode') != financial_currency or value.get('periodType') != ('3M' if prefix == 'quarterly' else '12M'):
                raise ValueError(symbol + ' 财报币种或周期不符')
            # The provider's ADR EPS in the statement currency is not an
            # ordinary-share EPS. USD ADR EPS comes only from issuer evidence.
            if metric[len(prefix):] == 'DilutedEPS' and financial_currency != 'USD':
                continue
            raw = value.get('reportedValue', {}).get('raw')
            if not finite(raw):
                continue
            period = value['asOfDate'][:7]
            record = output[prefix].setdefault(period, {'period': period, 'reportDate': value['asOfDate'], 'dateBasis': 'provider_month_end', 'currency': financial_currency})
            record[metric[len(prefix):]] = raw
    for entry in EVIDENCE.get(symbol, []):
        for prefix in output:
            period = entry['providerPeriod']
            if period not in output[prefix] and not entry.get(prefix):
                continue
            row = output[prefix].setdefault(period, {'period': period, 'currency': financial_currency})
            if entry.get('currency', financial_currency) != financial_currency:
                raise ValueError('官方补充与财报币种不一致')
            # Official publication supplies missing periods/fields. Conflicting
            # reported numbers fail rather than silently overwriting the provider.
            for key, value in entry.get(prefix, {}).items():
                if key in row and abs(row[key] - value) > max(abs(value) * .005, .02):
                    raise ValueError(symbol + ' ' + period + ' 官方与接口财报不一致：' + key)
                row[key] = value
            row.update(reportDate=entry['reportDate'], dateBasis='issuer_report_end', sourceUrl=entry['sourceUrl'],
                       publishedAt=entry.get('publishedAt'), note=entry.get('note'))
    for rows in output.values():
        for row in rows.values():
            row.setdefault('sourceUrl', 'https://finance.yahoo.com/quote/' + symbol + '/financials/')
    return output


def month_number(period):
    y, m = map(int, period.split('-'))
    return y * 12 + m


def merge_filings(provider, official):
    """Keep current provider periods; official statements own overlapping amounts."""
    result = {p: {k: dict(r) for k, r in rows.items()} for p, rows in provider.items()}
    for prefix, rows in official.items():
        for key, evidence in rows.items():
            row = result[prefix].setdefault(key, {})
            differences = {metric: {'provider': row[metric], 'official': value}
                           for metric, value in evidence.items() if metric in METRICS
                           and finite(row.get(metric)) and finite(value)
                           and abs(row[metric] - value) > max(abs(value) * .005, .02)}
            row.update(evidence)
            if differences:
                row['providerDifferences'] = differences
    return result


def official_history(company, asof, offline):
    symbol = company['symbol']
    old = SEC_HISTORY.get(symbol, {'annual': {}, 'quarterly': {}})
    if offline or not company.get('cik'):
        return old, 'saved_official_filings'
    try:
        raw = request_json('https://data.sec.gov/api/xbrl/companyfacts/CIK' + str(company['cik']).zfill(10) + '.json')
        cache_json(symbol, 'sec', raw)
        new = us_filings.normalize(raw, company['cik'], asof, company['fiscalYearEndMonth'],
            company.get('financialCurrency', 'USD'), company.get('accountingStandard', 'us-gaap'),
            company.get('noNciThrough') if company.get('noNciStatementSource') else False)
        if company.get('predecessorCik'):
            # Only a source-verified legal successor may retain earlier filings.
            # XOM's July 2026 one-for-one holding reorganization preserves the
            # operating group; this is distinct from SPCX's unrelated ticker reuse.
            if not company.get('identitySourceUrl') or not company.get('predecessorThrough'):
                raise ValueError(symbol + ' 缺继承主体与前身期间边界')
            new = {p: {**{k:r for k,r in old[p].items() if r['reportDate'] <= company['predecessorThrough']}, **new[p]} for p in new}
        return {p: dict(sorted(rows.items())[-(7 if p == 'annual' else 12):]) for p, rows in new.items()}, 'live_official_filings'
    except (urllib.error.URLError, TimeoutError, OSError):
        if not any(old.values()):
            raise ValueError(symbol + ' 缺SEC历史财报，无法完成本次筛选')
        return old, 'saved_official_filings_after_network_failure'


def trailing_total(rows, metric):
    recent = sorted(rows.values(), key=lambda r: r['period'])[-4:]
    if len(recent) == 4 and all(finite(r.get(metric)) for r in recent) and all(month_number(b['period']) - month_number(a['period']) == 3 for a, b in zip(recent, recent[1:])):
        return sum(r[metric] for r in recent)
    return None


def growth(current, prior):
    if not finite(current) or not finite(prior):
        return {'value': None, 'status': 'missing', 'label': '缺上年同期数据'}
    if prior <= 0:
        label = '扭亏' if current > 0 else '亏损扩大' if current < prior else '亏损收窄' if current > prior else '持平'
        return {'value': None, 'status': 'nonpositive_base', 'label': label}
    return {'value': (current / prior - 1) * 100, 'status': 'available', 'label': '转亏' if current < 0 else ''}


def financial_summary(facts):
    quarters = facts['quarterly']
    if not quarters:
        raise ValueError('缺最近季度收入利润')
    latest = quarters[max(quarters)]
    if not all(finite(latest.get(key)) for key in ['TotalRevenue', 'NetIncome']):
        raise ValueError('最近季度缺收入或利润')
    year, month = map(int, latest['period'].split('-'))
    previous = quarters.get(f'{year-1:04}-{month:02}', {})
    ttm_profit = trailing_total(quarters, 'NetIncome')
    ttm_revenue = trailing_total(quarters, 'TotalRevenue')
    ttm_cash = trailing_total(quarters, 'OperatingCashFlow')
    equity = [latest.get('StockholdersEquity'), previous.get('StockholdersEquity')]
    roe = ttm_profit / (sum(equity) / 2) * 100 if finite(ttm_profit) and all(finite(x) and x > 0 for x in equity) else None
    missing = []
    if ttm_profit is None:
        missing.append('缺连续四季利润')
    for value, period in zip(equity, [latest['period'], f'{year-1:04}-{month:02}']):
        if not finite(value):
            missing.append('缺' + period + '母公司净资产')
        elif value <= 0:
            missing.append(period + '净资产非正，ROE不适用')
    return {**latest, 'revenueGrowth': growth(latest.get('TotalRevenue'), previous.get('TotalRevenue')),
            'profitGrowth': growth(latest.get('NetIncome'), previous.get('NetIncome')),
            'ttmRevenue': ttm_revenue, 'ttmProfit': ttm_profit, 'ttmCash': ttm_cash,
            'roeTTM': roe, 'roeMissing': None if roe is not None else '；'.join(missing),
            'operatingGrowth': growth(latest.get('TotalOperatingIncomeAsReported'), previous.get('TotalOperatingIncomeAsReported')),
            'operatingMargin': latest.get('TotalOperatingIncomeAsReported') / latest['TotalRevenue'] * 100 if finite(latest.get('TotalOperatingIncomeAsReported')) and latest['TotalRevenue'] > 0 else None}


def performance(series, end):
    rows = sorted((d, v) for d, v in series if d <= end)
    values, periods = [], []
    for years in [1, 2, 3, 5, 10]:
        target = add_years(rows[-1][0], -years)
        earlier = [(d, v) for d, v in rows if d <= target]
        start = earlier[-1] if earlier else None
        valid = start and (date.fromisoformat(target) - date.fromisoformat(start[0])).days <= 7
        values.append((rows[-1][1] / start[1] - 1) * 100 if valid else None)
        periods.append({'years': years, 'start': start[0] if valid else None, 'end': rows[-1][0]})
    risk = risk_window(rows, rows[-1][0], 5, allow_partial=True)
    return {'r': values, 'periods': periods, 'risk5': risk, 'mdd5': risk['mdd'], 'vol5': risk['vol'],
            'sinceListing': (rows[-1][1] / rows[0][1] - 1) * 100,
            'first': rows[0][0], 'returnAsOf': rows[-1][0], 'riskAsOf': rows[-1][0]}


def build_stock(company, end, offline=False):
    symbol = company['symbol']
    quote = cache_json(symbol, 'quote')
    if quote.get('symbol') != symbol or quote.get('quoteType') != 'EQUITY' or quote.get('currency') != 'USD' or quote.get('longName') != company['issuer']:
        raise ValueError(symbol + ' 估值报价身份不符')
    history = stock_history(symbol, offline=offline, end=end)
    if not offline:
        url = 'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' + symbol + '?' + urllib.parse.urlencode({
            'type': ','.join(p + m for p in ['quarterly', 'annual'] for m in METRICS),
            'period1': 1262304000, 'period2': int(datetime.now(timezone.utc).timestamp())})
        raw = cache_json(symbol, 'facts', request_json(url))
    else:
        raw = cache_json(symbol, 'facts')
    provider = parse_facts(raw, symbol, quote['financialCurrency'])
    reviewed_asof = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    official, filing_status = official_history(company, reviewed_asof, offline)
    facts = merge_filings(provider, official)
    # Issuer earnings releases may precede the structured SEC submission.
    # Date/source overlays are bound to this exact fiscal period in the dossier.
    dossier = RESEARCH[symbol]
    for prefix, rows in facts.items():
        for entry in EVIDENCE.get(symbol, []):
            key = entry['providerPeriod']
            if key in rows and (entry.get(prefix) or rows[key].get('dateBasis') == 'provider_month_end'):
                rows[key].update(entry.get(prefix, {}))
                rows[key].update(reportDate=entry['reportDate'], dateBasis='issuer_report_end',
                    sourceUrl=entry['sourceUrl'], publishedAt=entry.get('publishedAt'), note=entry.get('note'))
    financials = financial_summary(facts)
    if date.fromisoformat(financials['reportDate']) > date.fromisoformat(end):
        raise ValueError(symbol + ' 财报日期在行情截至日之后')
    price = history['close']
    eps, forward_eps = quote.get('epsTrailingTwelveMonths'), quote.get('epsForward')
    # Per-share EPS from the USD listing quote handles ADR conversion. Do not
    # divide TSM's USD ADR price by financial-statement EPS denominated in TWD.
    pe = price / eps if finite(eps) and eps > 0 else None
    forward_pe = price / forward_eps if finite(forward_eps) and forward_eps > 0 else None
    series = [[r['date'], r['adjustedClose']] for r in history['data']]
    result = {**company, 'c': symbol, 'n': company['name'], **performance(series, end), 'price': price,
              'priceAsOf': series[-1][0], 'valuationAsOf': series[-1][0], 'pe': pe, 'peForward': forward_pe,
              'epsTTM': eps, 'epsForward': forward_eps, 'estimateAsOf': quote.get('_fetchedAt', now_iso())[:10],
              'peStatus': 'available' if pe is not None else 'loss' if finite(eps) and eps <= 0 else 'missing',
              'financials': financials, 'financialCurrency': quote['financialCurrency'],
              'fundamentalsAsOf': financials['reportDate'], 'financialHistory': facts,
              'returnBasis': 'provider_adjusted_close', 'returnSourceUrl': history['source'],
              'dividends': 'reinvested', 'investorTaxesIncluded': False,
              'cashDividend12': history.get('cashDividend12'),
              'yield12': history['cashDividend12'] / price * 100 if finite(history.get('cashDividend12')) else None,
              'dividendMissing': history.get('dividendMissing'),
              'dividendRecords': history.get('dividendRecords', []),
              'research': dossier, 'financialSourceStatus': filing_status, '_officialHistory': official,
              'fetchedAt': now_iso()}
    return classify(overseas_research.enrich(result), reviewed_asof)


def validate_rows(rows):
    if {r['symbol'] for r in rows} != {r['symbol'] for r in CATALOG} or len(rows) != len(CATALOG):
        raise ValueError('海外个股名单缺失或重复')
    for row in rows:
        if row['currency'] != 'USD' or row['returnBasis'] != 'provider_adjusted_close' or len(row['r']) != 5:
            raise ValueError('海外个股收益口径不完整')
        if row['symbol'] == 'SPCX' and row['first'] < '2026-06-12':
            raise ValueError('SPCX混入旧ETF历史')
        if row['peStatus'] == 'loss' and row['pe'] is not None:
            raise ValueError('亏损股票不应给出正PE')
        if row['screening']['groups'] == ['other'] and not row['screening']['otherReasons']:
            raise ValueError(row['symbol'] + ' 缺具体未入选原因')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--end', default=(datetime.now(ZoneInfo('Asia/Shanghai')).date() - timedelta(days=1)).isoformat())
    args = parser.parse_args()
    try:
        if not args.offline:
            fetch_quotes()
        with ThreadPoolExecutor(max_workers=3) as executor:
            rows = list(executor.map(lambda c: build_stock(c, args.end, args.offline), CATALOG))
        validate_rows(rows)
        meta = {'schemaVersion': 2, 'updatedAt': now_iso(), 'asOf': max(r['returnAsOf'] for r in rows),
                'currency': 'USD', 'selection': 'reviewed_us_companies', 'companies': len(rows),
                'screeningAsOf': max(r['screening']['checkedAt'] for r in rows),
                'groupCounts': {g: sum(g in r['screening']['groups'] for r in rows) for g in LABELS}}
        history = {'schemaVersion': 1, 'checkedAt': meta['screeningAsOf'],
                   'companies': {r['symbol']: r.pop('_officialHistory') for r in rows}}
        # The audit snapshot preserves field provenance. Public rows retain the
        # values, filing links and dates without repeating every XBRL operand.
        for row in rows:
            for periods in row['financialHistory'].values():
                for record in periods.values():
                    record.pop('provenance', None)
            for record in row['analysis']['annual']:
                record.pop('provenance', None)
        reports = {'reports': [overseas_research.report_for(row) for row in rows]}
        atomic_text(HISTORY_PATH, json.dumps(history, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
        atomic_text(DATA / 'overseas-stocks.js', 'var OVERSEAS_STOCK_META=' + json.dumps(meta, ensure_ascii=False) + ';\nvar OVERSEAS_STOCKS=' + json.dumps(rows, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + ';\nvar OVERSEAS_REPORTS=' + json.dumps(reports, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + ';\n')
        write_status('overseas_stocks', 'cached' if args.offline else 'success', mode='offline' if args.offline else 'online',
                     asOf=meta['asOf'], records=len(rows), message='发行人、股票类型、币种及上市历史已核对；财报与估值分别标注日期。')
        print(json.dumps({'companies': len(rows), 'asOf': meta['asOf'], 'financials': {r['symbol']: r['fundamentalsAsOf'] for r in rows}}, ensure_ascii=False))
        return 0
    except Exception as exc:
        # Never log request URLs containing an anonymous quote-session crumb.
        message = str(exc) if isinstance(exc, ValueError) else type(exc).__name__ + ': 海外数据源访问失败'
        write_status('overseas_stocks', 'failed', mode='offline' if args.offline else 'online', message=message)
        print(message)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
