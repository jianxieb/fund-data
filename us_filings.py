"""Normalize dated SEC Company Facts without turning cumulative values into quarters."""
from datetime import date, timedelta
import math

TAGS = {
    'TotalRevenue': ('RevenuesNetOfInterestExpense', 'Revenues',
                     'RevenueFromContractWithCustomerExcludingAssessedTax',
                     'RevenueFromContractWithCustomerIncludingAssessedTax',
                     'SalesRevenueNet'),
    'NetIncome': ('NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'),
    'TotalOperatingIncomeAsReported': ('OperatingIncomeLoss',),
    'GrossProfit': ('GrossProfit',),
    'StockholdersEquity': ('StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'),
    'OperatingCashFlow': ('NetCashProvidedByUsedInOperatingActivities',
                         'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'),
    'DilutedEPS': ('EarningsPerShareDiluted',),
    'CapitalExpenditures': ('PaymentsToAcquirePropertyPlantAndEquipment',),
}
IFRS_TAGS = {
    'TotalRevenue': ('Revenue',), 'NetIncome': ('ProfitLossAttributableToOwnersOfParent',),
    'TotalOperatingIncomeAsReported': ('ProfitLossFromOperatingActivities',),
    'GrossProfit': ('GrossProfit',), 'StockholdersEquity': ('EquityAttributableToOwnersOfParent',),
    'OperatingCashFlow': ('CashFlowsFromUsedInOperatingActivities',),
    'DilutedEPS': ('DilutedEarningsLossPerShare',),
    'CapitalExpenditures': ('PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',),
}


def fiscal_month(day, year_end_month=None):
    """Week based fiscal years ending in the first week use the preceding month."""
    d = date.fromisoformat(day)
    previous = d.replace(day=1) - timedelta(days=1)
    if year_end_month is not None:
        months = {(year_end_month - 1 - n * 3) % 12 + 1 for n in range(4)}
        if d.month in months:
            return d.strftime('%Y-%m')
        if previous.month in months and d.day <= 10:
            return previous.strftime('%Y-%m')
    return (previous if d.day <= 7 else d).strftime('%Y-%m')


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def normalize(payload, cik, asof, year_end_month=None, currency='USD', standard='us-gaap', no_nci=False):
    if str(payload.get('cik', '')).lstrip('0') != str(int(cik)) or not payload.get('entityName'):
        raise ValueError('SEC财报CIK身份不符')
    if standard not in ('us-gaap', 'ifrs-full'):
        raise ValueError('不支持的SEC会计准则')
    gaap = payload.get('facts', {}).get(standard, {})
    tags_for = TAGS if standard == 'us-gaap' else IFRS_TAGS
    forms = ('10-K', '10-K/A', '10-Q', '10-Q/A') if standard == 'us-gaap' else ('20-F', '20-F/A', '6-K')
    output = {'annual': {}, 'quarterly': {}}
    floor = str(int(asof[:4]) - 8) + '-01-01'

    def known_no_nci(r):
        return no_nci is True or isinstance(no_nci, str) and r['end'] <= no_nci

    def source(r, tag, basis='disclosed', operands=None):
        url = 'https://www.sec.gov/Archives/edgar/data/' + str(int(cik)) + '/' + r['accn'].replace('-', '') + '/' + r['accn'] + '-index.html'
        return {'tag': tag, 'start': r.get('start'), 'end': r['end'], 'publishedAt': r['filed'],
                'sourceUrl': url, 'value': r.get('_rawValue', r['val']), 'basis': basis,
                **({'operands': operands} if operands else {})}

    def put(prefix, r, metric, value, provenance):
        key = fiscal_month(r['end'], year_end_month)
        row = output[prefix].setdefault(key, {'period': key, 'reportDate': r['end'],
            'dateBasis': 'issuer_report_end', 'currency': currency, 'provenance': {}})
        # Prefer the reported consolidated total (net of interest expense for
        # banks). Contract sales can omit membership, insurance or lease income.
        # These are overlapping tags, so they must never be summed.
        if metric in row:
            previous = row['provenance'][metric]
            if (metric != 'TotalRevenue' or
                    (provenance['publishedAt'], provenance['sourceUrl']) <=
                    (previous['publishedAt'], previous['sourceUrl'])):
                return
            # A newer filing may change the revenue tag after a restructuring.
            # An old shell-company total must not override the restated business.
        row[metric] = value
        row['provenance'][metric] = provenance
        if metric == 'NetIncome' or 'sourceUrl' not in row:
            row.update(sourceUrl=provenance['sourceUrl'], publishedAt=provenance['publishedAt'])

    def minority(tag, r):
        matches = [p for p in gaap.get(tag, {}).get('units', {}).get('USD', [])
                   if p.get('start') == r.get('start') and p.get('end') == r['end']
                   and p.get('form') in ('10-K', '10-K/A', '10-Q', '10-Q/A')
                   and r['end'] <= p.get('filed', '') <= asof and number(p.get('val'))]
        return max(matches, key=lambda p: (p['filed'], p['accn'])) if matches else None

    for metric, tags in tags_for.items():
        for tag in tags:
            unit = currency + '/shares' if metric == 'DilutedEPS' else currency
            rows = gaap.get(tag, {}).get('units', {}).get(unit, [])
            unique = {}
            for r in rows:
                if (r.get('form') not in forms
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
                        value, evidence = r['val'], source(r, tag)
                        if standard == 'us-gaap' and tag != 'StockholdersEquity':
                            nci = minority('MinorityInterest', r)
                            if nci is None and not known_no_nci(r):
                                continue  # Unknown NCI is not assumed to be zero.
                            if nci is not None:
                                value -= nci['val']
                                evidence = source(r, tag, 'calculated', [source(r, tag), source(nci, 'MinorityInterest')])
                        for prefix in output:
                            key = fiscal_month(r['end'], year_end_month)
                            if key in output[prefix]:
                                put(prefix, r, metric, value, evidence)
                continue
            if tag == 'ProfitLoss':
                converted = []
                for r in entries:
                    nci = minority('NetIncomeLossAttributableToNoncontrollingInterest', r)
                    if nci is not None:
                        converted.append(dict(r, val=r['val'] - nci['val'], _rawValue=r['val'], _nci=nci))
                    elif known_no_nci(r):
                        converted.append(r)
                entries = converted  # Consolidated income is not parent income.
            cumulative = []
            for r in entries:
                if not r.get('start'):
                    continue
                days = (date.fromisoformat(r['end']) - date.fromisoformat(r['start'])).days + 1
                evidence = source(r, tag, 'calculated', [source(r, tag), source(r['_nci'], 'NetIncomeLossAttributableToNoncontrollingInterest')]) if '_nci' in r else source(r, tag)
                if 330 <= days <= 385:
                    put('annual', r, metric, r['val'], evidence)
                if 70 <= days <= 120:
                    put('quarterly', r, metric, r['val'], evidence)
                if 150 <= days <= 385:
                    cumulative.append(r)
            # Cash flow usually appears as YTD. Q4 earnings are often absent as
            # a direct fact. Derive only additive amounts from identical starts.
            # EPS with varying weighted shares cannot be subtracted safely.
            if metric != 'DilutedEPS':
                for r in cumulative:
                    priors = [p for p in entries if p.get('start') == r['start']
                              and 70 <= (date.fromisoformat(r['end']) - date.fromisoformat(p['end'])).days <= 120]
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
