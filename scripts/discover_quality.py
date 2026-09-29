#!/usr/bin/env python3
"""Discover financial research leads; this command never adds companies to the product."""
import argparse
import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stock_fundamentals import parse_evidence, quality_review, source_url
from stock_screen import fetch_json

CACHE = ROOT / '.tmp-snap/stocks'
COLUMNS = ('SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE,REPORT_DATE,NOTICE_DATE,ROEJQ,'
           'TOTALOPERATEREVETZ,PARENTNETPROFITTZ,KCFJCXSYJLRTZ,PARENTNETPROFIT,KCFJCXSYJLR')


def in_scope(row, period, asof):
    code = str(row.get('SECURITY_CODE') or '')
    notice = str(row.get('NOTICE_DATE') or '')[:10]
    symbol = code + ('.SH' if code.startswith('6') else '.SZ')
    return (bool(re.fullmatch(r'(60|68|00|30)\d{4}', code)) and row.get('SECUCODE') == symbol
            and str(row.get('REPORT_DATE', ''))[:10] == period and bool(notice) and notice <= asof
            and 'ST' not in str(row.get('SECURITY_NAME_ABBR', '')).upper())


def bulk(period, asof, annual=False):
    condition = ("(REPORT_DATE='%s')(TOTALOPERATEREVETZ>=10)(PARENTNETPROFITTZ>=10)"
                 "(KCFJCXSYJLRTZ>=10)(PARENTNETPROFIT>0)(KCFJCXSYJLR>0)" % period)
    if annual:
        condition += '(ROEJQ>=15)'
    sources, rows, page, pages = [], [], 1, 1
    while page <= pages:
        url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + urlencode({
            'reportName': 'RPT_F10_FINANCE_MAINFINADATA', 'columns': COLUMNS, 'filter': condition,
            'pageSize': 500, 'pageNumber': page, 'sortColumns': 'SECURITY_CODE', 'sortTypes': 1})
        payload = fetch_json(url)
        result = payload.get('result') or {}
        if not payload.get('success') or not isinstance(result.get('data'), list):
            raise ValueError('财报初筛响应不完整：' + period)
        sources.append({'url': url, 'result': result})
        rows.extend(r for r in result['data'] if in_scope(r, period, asof))
        pages = int(result['pages'])
        page += 1
    return {r['SECURITY_CODE']: r for r in rows}, sources


def details(code, asof):
    try:
        responses = {}
        for key, report, sort, size in [('valuation', 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 2),
                                       ('financials', 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 20)]:
            payload = fetch_json(source_url(code, report, sort, size))
            rows = (payload.get('result') or {}).get('data')
            if not payload.get('success') or not rows:
                raise ValueError('缺完整' + key + '响应')
            responses[key] = rows
        return {'code': code, 'sourceResponses': responses}
    except Exception as exc:
        return {'code': code, 'error': str(exc)}


def summarize(discovery, records):
    asof = discovery['asof']
    results = []
    for item in records:
        code = item['code']
        if 'error' in item:
            results.append({'code': code, 'status': 'source_unavailable', 'error': item['error']})
            continue
        raw = item['sourceResponses']
        data = parse_evidence(code, raw['valuation'], raw['financials'], asof)
        data.update(c=code, n=raw['financials'][0]['SECURITY_NAME_ABBR'], group='quality')
        review = quality_review(data, asof)
        # Full price history and a reviewed business dossier are separate admission steps.
        checks = [c for c in review['historicalChecks'] + review['recentChecks']
                  if c['label'] != '可观察历史≥5年']
        eligible = all(c['pass'] for c in checks)
        results.append({'code': code, 'name': data['n'], 'status': 'financial_lead' if eligible else 'excluded',
                        'growth3': data['financialGrowth3'], 'roe3': review['roe3'],
                        'latestReport': data['latestFinancials']['reportDate'],
                        'latestGrowth': {k: data['latestFinancials'][k + 'Growth']
                                         for k in ('revenue', 'netProfit', 'deductedProfit')},
                        'failedConditions': [c.get('reason') or c['label'] for c in checks if not c['pass']],
                        'financialsUrl': data['fundamentalsSourceUrl'],
                        'sourceSha256': hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()})
    manifest = json.loads((ROOT / 'data/stock-quality-research.json').read_text())
    reviewed = [r['code'] for r in manifest['companies']]
    return {'schemaVersion': 1, 'asOf': asof, 'scope': discovery['scope'],
            'financialRule': 'report_backed_quality_v4',
            'note': '财务线索并非优质企业名单；须另核实五年价格历史及具名公司报告。手工研究覆盖有限，不是全A排名。',
            'annualCount': discovery['annualCount'], 'latestCount': discovery['latestCount'],
            'intersectionCount': len(discovery['codes']),
            'financialLeadCount': sum(r['status'] == 'financial_lead' for r in results),
            'sourceErrors': [r['code'] for r in results if r['status'] == 'source_unavailable'],
            'bulkSources': [s['url'] for k in ('annualSources', 'latestSources') for s in discovery[k]],
            'reportResearchFile': 'data/stock-quality-research.json', 'reportReviewedCodes': reviewed,
            'records': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asof', required=True)
    parser.add_argument('--annual', default='2025-12-31')
    parser.add_argument('--latest', default='2026-06-30')
    parser.add_argument('--cached', action='store_true')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    for day in (args.asof, args.annual, args.latest):
        date.fromisoformat(day)
    if args.annual > args.latest or args.latest > args.asof:
        parser.error('报告期不能晚于核算日')
    CACHE.mkdir(exist_ok=True, parents=True)
    bulk_path, detail_path = CACHE / 'quality-discovery.json', CACHE / 'quality-discovery-details.json'
    if args.cached:
        discovery = json.loads(bulk_path.read_text())
        records = json.loads(detail_path.read_text())
        if discovery['asof'] != args.asof:
            parser.error('缓存日期与核算日不同')
    else:
        annual, annual_sources = bulk(args.annual, args.asof, annual=True)
        latest, latest_sources = bulk(args.latest, args.asof)
        codes = sorted(set(annual) & set(latest))
        discovery = {'asof': args.asof, 'scope': '沪深A股（不含北交所、ST）',
                     'annualCount': len(annual), 'latestCount': len(latest), 'codes': codes,
                     'annualSources': annual_sources, 'latestSources': latest_sources}
        bulk_path.write_text(json.dumps(discovery, ensure_ascii=False))
        with ThreadPoolExecutor(max_workers=4) as pool:
            records = list(pool.map(lambda code: details(code, args.asof), codes))
        detail_path.write_text(json.dumps(records, ensure_ascii=False))
    if {r['code'] for r in records} != set(discovery['codes']):
        raise ValueError('详细财报记录与初筛交集不一致')
    output = Path(args.output)
    output.parent.mkdir(exist_ok=True, parents=True)
    result = summarize(discovery, records)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('%d家交集 → %d家财务研究线索；%d家取数不完整。未更改产品名单。' % (
        result['intersectionCount'], result['financialLeadCount'], len(result['sourceErrors'])))


if __name__ == '__main__':
    main()
