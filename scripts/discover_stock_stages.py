#!/usr/bin/env python3
"""Discover company research across the market using the published stage rules."""
import argparse
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.discover_quality import in_scope
from stock_screen import fetch_json
from stock_fundamentals import parse_evidence, source_url
from stock_groups import long_term_review, growth_review, breakout_review

CACHE = ROOT / '.tmp-snap/stocks/stage-discovery.json'


def bulk(report, condition, columns, sort):
    rows, sources, page, pages = [], [], 1, 1
    while page <= pages:
        url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + urlencode({
            'reportName': report, 'columns': columns, 'filter': condition,
            'pageSize': 500, 'pageNumber': page, 'sortColumns': sort, 'sortTypes': 1})
        payload = fetch_json(url)
        result = payload.get('result') or {}
        if not payload.get('success') or not isinstance(result.get('data'), list):
            raise ValueError('市场初筛响应不完整：' + report)
        sources.append(url)
        rows.extend(result['data'])
        pages = int(result['pages'])
        page += 1
    return rows, sources


def fetch_market(asof, annual, latest, quote):
    columns = 'SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE,REPORT_DATE,NOTICE_DATE,ROEJQ'
    current, current_sources = bulk('RPT_F10_FINANCE_MAINFINADATA',
        "(REPORT_DATE='%s')(TOTALOPERATEREVETZ>=10)(PARENTNETPROFITTZ>=10)(KCFJCXSYJLRTZ>=10)(PARENTNETPROFIT>0)(KCFJCXSYJLR>0)" % latest,
        columns, 'SECURITY_CODE')
    prior, annual_sources = bulk('RPT_F10_FINANCE_MAINFINADATA',
        "(REPORT_DATE='%s')(ROEJQ>=5)(PARENTNETPROFIT>0)(KCFJCXSYJLR>0)" % annual,
        columns, 'SECURITY_CODE')
    quotes, quote_sources = bulk('RPT_VALUEANALYSIS_DET',
        "(TRADE_DATE='%s')(TOTAL_MARKET_CAP>=10000000000)" % quote,
        'SECURITY_CODE,SECUCODE,TRADE_DATE,TOTAL_MARKET_CAP,BOARD_NAME,CLOSE_PRICE,PE_TTM,PE_LAR,PB_MRQ', 'SECURITY_CODE')
    current = {r['SECURITY_CODE']: r for r in current if in_scope(r, latest, asof)}
    prior = {r['SECURITY_CODE']: r for r in prior if in_scope(r, annual, asof)}
    quotes = {r['SECURITY_CODE']: r for r in quotes if r['SECURITY_CODE'] in current}
    codes = sorted(set(current) & set(prior) & set(quotes))
    def details(code):
        url = source_url(code, 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 24)
        try:
            payload = fetch_json(url)
            reports = (payload.get('result') or {}).get('data')
            if not payload.get('success') or not reports:
                raise ValueError('无完整财报响应')
            return {'code': code, 'quote': quotes[code], 'financials': reports, 'sourceUrl': url}
        except Exception as exc:
            return {'code': code, 'sourceUrl': url, 'error': str(exc)}
    with ThreadPoolExecutor(max_workers=4) as executor:
        records = list(executor.map(details, codes))
    return {'asOf': asof, 'annual': annual, 'latest': latest, 'quoteDate': quote,
            'scope': '沪深非ST、非金融A股，市值≥100亿元；全市场财报查询，非点名名单',
            'bulkCounts': {'currentGrowth': len(current), 'positiveAnnualRoe5': len(prior), 'intersection': len(codes)},
            'sources': current_sources + annual_sources + quote_sources, 'records': records}


def summarize(discovery):
    rows = []
    for raw in discovery['records']:
        if raw.get('error'):
            rows.append({'code': raw['code'], 'error': raw['error'], 'status': 'source_unavailable'})
            continue
        data = parse_evidence(raw['code'], [raw['quote']], raw['financials'], discovery['asOf'])
        data.update(c=raw['code'], n=raw['financials'][0]['SECURITY_NAME_ABBR'], group='quality')
        reviews = {'quality': long_term_review(data, discovery['asOf']),
                   'growth': growth_review(data, discovery['asOf']),
                   'breakout': breakout_review(data, discovery['asOf'])}
        stages = {}
        for name, review in reviews.items():
            # Financial discovery never invents a reviewed business dossier or price history.
            checks = review['checks'][:8] if name == 'growth' else review['checks'][:9] if name == 'breakout' else [
                c for c in review['checks'] if c['label'] not in ('可观察历史≥5年', '已核对具名公司报告、业务入选依据及风险', '本期业务持续性、再投资路径和失效信号均有研究记录')]
            stages[name] = {'financialQualified': all(c['pass'] for c in checks),
                            'failedConditions': [c.get('reason') or c['label'] for c in checks if not c['pass']]}
        rows.append({'code': raw['code'], 'name': data['n'], 'category': data['researchCategory'],
                     'latestReport': data['latestFinancials']['reportDate'], 'stages': stages,
                     'growth3': data['financialGrowth3'],
                     'sourceUrl': raw['sourceUrl'],
                     'sourceSha256': hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()})
    return {k: v for k, v in discovery.items() if k != 'records'} | {
        'schemaVersion': 1, 'stageCounts': {s: sum(r.get('stages', {}).get(s, {}).get('financialQualified', False) for r in rows) for s in ('quality', 'growth', 'breakout')},
        'note': '仅为财务研究线索；上市历史、增长来源、周期/并购/低基数及对应公司报告需逐家复核后才进入产品名单。', 'records': rows}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--asof', required=True)
    p.add_argument('--annual', default='2025-12-31')
    p.add_argument('--latest', default='2026-06-30')
    p.add_argument('--quote-date', default='2026-09-29')
    p.add_argument('--cached', action='store_true')
    p.add_argument('--output', required=True)
    args = p.parse_args()
    for d in (args.asof, args.annual, args.latest, args.quote_date):
        date.fromisoformat(d)
    if not args.annual <= args.latest <= args.asof or args.quote_date > args.asof:
        p.error('报告期或行情日期晚于研究日期')
    if args.cached:
        discovery = json.loads(CACHE.read_text())
        if discovery['asOf'] != args.asof:
            p.error('缓存与研究截止日不一致')
    else:
        discovery = fetch_market(args.asof, args.annual, args.latest, args.quote_date)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(discovery, ensure_ascii=False))
    result = summarize(discovery)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'bulkCounts': result['bulkCounts'], 'financialLeads': result['stageCounts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
