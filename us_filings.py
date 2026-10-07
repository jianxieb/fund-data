"""Normalize dated SEC Company Facts without turning cumulative values into quarters."""
from datetime import date, timedelta
import math

TAGS = {
    'TotalRevenue': ('RevenueFromContractWithCustomerExcludingAssessedTax',
                     'RevenueFromContractWithCustomerIncludingAssessedTax',
                     'Revenues', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'),
    'NetIncome': ('NetIncomeLoss',),
    'TotalOperatingIncomeAsReported': ('OperatingIncomeLoss',),
    'GrossProfit': ('GrossProfit',),
    'StockholdersEquity': ('StockholdersEquity',),
    'OperatingCashFlow': ('NetCashProvidedByUsedInOperatingActivities',
                         'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'),
    'DilutedEPS': ('EarningsPerShareDiluted',),
    'CapitalExpenditures': ('PaymentsToAcquirePropertyPlantAndEquipment',),
}


def fiscal_month(day):
    """Week based fiscal years ending in the first week use the preceding month."""
    d = date.fromisoformat(day)
    return ((d.replace(day=1) - timedelta(days=1)) if d.day <= 7 else d).strftime('%Y-%m')


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def normalize(payload, cik, asof):
    if payload.get('cik') != int(cik) or not payload.get('entityName'):
        raise ValueError('SEC财报CIK身份不符')
    gaap = payload.get('facts', {}).get('us-gaap', {})
    output = {'annual': {}, 'quarterly': {}}
    floor = str(int(asof[:4]) - 8) + '-01-01'

    def source(r, tag, basis='disclosed', operands=None):
        url = 'https://www.sec.gov/Archives/edgar/data/' + str(int(cik)) + '/' + r['accn'].replace('-', '') + '/' + r['accn'] + '-index.html'
        return {'tag': tag, 'start': r.get('start'), 'end': r['end'], 'publishedAt': r['filed'],
                'sourceUrl': url, 'basis': basis, **({'operands': operands} if operands else {})}

    def put(prefix, r, metric, value, provenance):
        key = fiscal_month(r['end'])
        row = output[prefix].setdefault(key, {'period': key, 'reportDate': r['end'],
            'dateBasis': 'issuer_report_end', 'currency': 'USD', 'provenance': {}})
        # Different tags may describe gross and net revenue. Prefer the first
        # supported tag for a given period instead of silently summing them.
        if metric in row:
            return
        row[metric] = value
        row['provenance'][metric] = provenance
        if metric == 'NetIncome' or 'sourceUrl' not in row:
            row.update(sourceUrl=provenance['sourceUrl'], publishedAt=provenance['publishedAt'])

    for metric, tags in TAGS.items():
        for tag in tags:
            unit = 'USD/shares' if metric == 'DilutedEPS' else 'USD'
            rows = gaap.get(tag, {}).get('units', {}).get(unit, [])
            unique = {}
            for r in rows:
                if (r.get('form') not in ('10-K', '10-K/A', '10-Q', '10-Q/A')
                        or not floor <= r.get('end', '') <= asof
                        or not r.get('filed') or not r['end'] <= r['filed'] <= asof
                        or not r.get('accn') or not number(r.get('val'))):
                    continue
                key = (r.get('start'), r['end'])
                if key not in unique or (r['filed'], r['accn']) > (unique[key]['filed'], unique[key]['accn']):
                    unique[key] = r
            entries = list(unique.values())
            if metric == 'StockholdersEquity':
                # Instant values attach only to actual income-statement periods
                # below; an extra balance-sheet date must not create a new quarter.
                for r in entries:
                    if 'start' not in r:
                        for prefix in output:
                            key = fiscal_month(r['end'])
                            if key in output[prefix]:
                                put(prefix, r, metric, r['val'], source(r, tag))
                continue
            cumulative = []
            for r in entries:
                if not r.get('start'):
                    continue
                days = (date.fromisoformat(r['end']) - date.fromisoformat(r['start'])).days + 1
                if 330 <= days <= 385:
                    put('annual', r, metric, r['val'], source(r, tag))
                if 70 <= days <= 105:
                    put('quarterly', r, metric, r['val'], source(r, tag))
                if 150 <= days <= 385:
                    cumulative.append(r)
            # Cash flow usually appears as YTD. Q4 earnings are often absent as
            # a direct fact. Derive only additive amounts from identical starts.
            # EPS with varying weighted shares cannot be subtracted safely.
            if metric != 'DilutedEPS':
                for r in cumulative:
                    priors = [p for p in entries if p.get('start') == r['start']
                              and 70 <= (date.fromisoformat(r['end']) - date.fromisoformat(p['end'])).days <= 105]
                    if not priors:
                        continue
                    p = max(priors, key=lambda x: x['end'])
                    evidence = source(r, tag, 'calculated', [source(r, tag), source(p, tag)])
                    evidence['start'] = (date.fromisoformat(p['end']) + timedelta(days=1)).isoformat()
                    evidence['publishedAt'] = max(r['filed'], p['filed'])
                    put('quarterly', r, metric, r['val'] - p['val'], evidence)

    # The equity pass occurs before cash/EPS but after income. Only retain
    # identifiable income periods, preserving specific missing fields as null.
    for prefix, rows in output.items():
        output[prefix] = {k: r for k, r in sorted(rows.items())
                          if number(r.get('TotalRevenue')) and number(r.get('NetIncome'))}
    return output
