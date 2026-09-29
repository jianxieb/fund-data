"""Dated valuation and annual financial evidence for the stock research pool."""
import json
import math
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

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
    annual = [r for r in reports if str(r['REPORT_DATE'])[:10].endswith('-12-31')][:3]
    history = [{'year': int(r['REPORT_DATE'][:4]), 'reportDate': r['REPORT_DATE'][:10],
                'announcedAt': str(r.get('NOTICE_DATE') or '')[:10],
                'roe': numeric(r.get('ROEJQ')), 'netProfit': numeric(r.get('PARENTNETPROFIT')),
                'operatingCashFlow': numeric(r.get('NETCASH_OPERATE_PK')),
                'revenue': numeric(r.get('TOTALOPERATEREVE'))} for r in annual]
    return {'pe': numeric(q.get('PE_TTM')), 'pb': numeric(q.get('PB_MRQ')),
            'valuationIndustry': q.get('BOARD_NAME') or None,
            'mcap': numeric(q.get('TOTAL_MARKET_CAP')) / 1e8 if numeric(q.get('TOTAL_MARKET_CAP')) is not None else None,
            'valuationPrice': numeric(q.get('CLOSE_PRICE')),
            'valuationAsOf': str(q.get('TRADE_DATE') or '')[:10] or None,
            'valuationSource': 'Eastmoney RPT_VALUEANALYSIS_DET: PE_TTM / PB_MRQ',
            'valuationSourceUrl': source_url(code, 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 2),
            'roe': history[0]['roe'] if history else None,
            'roeAsOf': history[0]['reportDate'] if history else None,
            'roeBasis': '年度加权平均ROE', 'financialHistory': history,
            'fundamentalsAsOf': str(reports[0]['REPORT_DATE'])[:10] if reports else None,
            'fundamentalsSourceUrl': source_url(code, 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 20),
            'fundamentalsStatus': 'dated_source' if q and len(history) == 3 else 'incomplete_source'}


def fetch_evidence(code, fetcher, asof):
    results, errors = {}, []
    for key, report, sort, size in [('valuation', 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 2),
                                    ('financials', 'RPT_F10_FINANCE_MAINFINADATA', 'REPORT_DATE', 20)]:
        try:
            payload = fetcher(source_url(code, report, sort, size))
            if not payload.get('success') or not (payload.get('result') or {}).get('data'):
                raise ValueError(payload.get('message') or '没有财务记录')
            results[key] = payload['result']['data']
        except Exception as exc:
            results[key] = []
            errors.append(key + ': ' + str(exc))
    parsed = parse_evidence(code, results['valuation'], results['financials'], asof)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / (code + '.json')).write_text(json.dumps({'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'sourceResponses': results, 'errors': errors}, ensure_ascii=False), encoding='utf-8')
    parsed['fundamentalsErrors'] = errors
    return parsed


def quality_review(row, asof):
    history = row.get('financialHistory') or []
    years = [r['year'] for r in history]
    complete = len(years) == 3 and years == list(range(int(asof[:4]) - 1, int(asof[:4]) - 4, -1))
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
    return {'qualified': all(c['pass'] for c in checks), 'checks': checks,
            'roe3': round(average, 2) if average is not None else None,
            'years': years, 'checkedAt': asof, 'basis': 'research_pool_financial_screen_v1'}
