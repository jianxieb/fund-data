#!/usr/bin/env python3
"""Reconcile the published legacy SSI workbook with current official SO files.

No portfolio data, future-return labels, prediction model or investment test is read.
Only the author's two published coverage windows are reconstructed.
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = Path('/tmp/portfolio-entry-signal-inputs-20261101')
OUTPUT = ROOT / 'docs/evidence/portfolio-entry-ssi-replication-v1.json'
LONG = ('SSO', 'QLD', 'DDM')
SHORT = ('SDS', 'QID', 'DXD')
FUNDS = LONG + SHORT
AUTHOR_FILE = 'SpeculationSentimentIndex_04172020.xlsx'
PAPER_URL = 'https://www.cambridge.org/core/services/aop-cambridge-core/content/view/846E44374D60D2760DFE5CE4B291F4EA/S0022109022000291a.pdf/speculation_sentiment.pdf'
APPENDIX_URL = 'https://static.cambridge.org/content/id/urn:cambridge.org:id:article:S0022109022000291/resource/name/S0022109022000291sup001.pdf'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def previous_month(month):
    year, number = map(int, month.split('-'))
    return f'{year - (number == 1):04d}-{12 if number == 1 else number - 1:02d}'


def read_author(data):
    """Read only the two source columns and notes, preserving Excel dates."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        properties = workbook.find('m:workbookPr', NS)
        assert properties is None or properties.get('date1904', '0') in ('0', 'false')
        strings = [''.join(t.text or '' for t in item.findall('.//m:t', NS))
                   for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        relationships = {item.get('Id'): item.get('Target')
                         for item in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        result = {}
        for sheet in workbook.findall('m:sheets/m:sheet', NS):
            name = sheet.get('name')
            relationship = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            rows, notes = [], []
            for row in ET.fromstring(archive.read('xl/' + relationships[relationship])).findall('m:sheetData/m:row', NS):
                cells = {}
                for cell in row:
                    value = cell.findtext('m:v', namespaces=NS)
                    if value is None:
                        continue
                    column = ''.join(c for c in cell.get('r') if c.isalpha())
                    value = strings[int(value)] if cell.get('t') == 's' else float(value)
                    cells[column] = value
                    if column in ('A', 'B'):
                        assert cell.find('m:f', NS) is None, 'source columns must be stored values'
                    if column not in ('A', 'B') and isinstance(value, str):
                        notes.append(value)
                if row.get('r') == '1':
                    assert cells.get('A') == 'AsOfDate' and cells.get('B') == 'SSI'
                elif isinstance(cells.get('A'), float) and isinstance(cells.get('B'), float):
                    assert cells['A'].is_integer() and math.isfinite(cells['B'])
                    date = (dt.date(1899, 12, 30) + dt.timedelta(days=int(cells['A']))).isoformat()
                    rows.append({'month': date[:7], 'date': date, 'ssi': cells['B']})
            assert len({r['month'] for r in rows}) == len(rows)
            assert [r['month'] for r in rows] == sorted(r['month'] for r in rows)
            result[name] = {'rows': rows, 'notes': list(dict.fromkeys(notes))}
    expected = {'Series From Paper': (123, '2006-10', '2016-12'), 'Current Series': (149, '2006-10', '2019-02')}
    assert set(result) == set(expected)
    for name, (n, first, last) in expected.items():
        rows = result[name]['rows']
        assert (len(rows), rows[0]['month'], rows[-1]['month']) == (n, first, last)
        assert all(previous_month(rows[i]['month']) == rows[i-1]['month'] for i in range(1, n))
    return result


def read_nav(data, symbol):
    rows = []
    for row in csv.DictReader(io.StringIO(data.decode('utf-8-sig'))):
        assert row['Ticker'] == symbol
        date = dt.datetime.strptime(row['Date'], '%m/%d/%Y').date().isoformat()
        shares, nav, aum = [float(row[k]) for k in ('Shares Outstanding (000)', 'NAV', 'Assets Under Management')]
        assert all(math.isfinite(v) and v > 0 for v in (shares, nav, aum))
        rows.append({'date': date, 'displayedShares000': shares, 'implicitShares000': aum / nav / 1000})
    rows.sort(key=lambda r: r['date'])
    assert len({r['date'] for r in rows}) == len(rows)
    month_ends = {}
    for row in rows:
        month_ends[row['date'][:7]] = row
    return month_ends, {'rows': len(rows), 'firstDate': rows[0]['date'], 'lastDate': rows[-1]['date']}, {r['date'] for r in rows}


def reconstruct(months, data, splits):
    result = []
    for month in months:
        prior = previous_month(month)
        funds = {}
        for symbol in FUNDS:
            current, previous = data[symbol][month], data[symbol][prior]
            funds[symbol] = {'date': current['date'], 'priorDate': previous['date'],
                             'displayedGrowth': current['displayedShares000'] / previous['displayedShares000'] - 1,
                             'implicitGrowth': current['implicitShares000'] / previous['implicitShares000'] - 1,
                             'displayedShares000': current['displayedShares000'], 'priorDisplayedShares000': previous['displayedShares000'],
                             'implicitShares000': current['implicitShares000'], 'priorImplicitShares000': previous['implicitShares000']}
        raw = {}
        for variant, key in [('displayed_so', 'displayedGrowth'), ('implicit_so_precision_sensitivity', 'implicitGrowth')]:
            raw[variant] = math.fsum(funds[s][key] for s in LONG) - math.fsum(funds[s][key] for s in SHORT)
        result.append({'month': month, 'rawSsi': raw, 'funds': funds,
                       'splitEventsInMonth': [s for s in splits if s['date'][:7] == month]})
    return result


def affine(x, y):
    assert len(x) == len(y) and len(x) > 2 and all(math.isfinite(v) for v in x + y)
    mx, my = statistics.mean(x), statistics.mean(y)
    xx = math.fsum((a - mx) ** 2 for a in x)
    yy = math.fsum((b - my) ** 2 for b in y)
    xy = math.fsum((a - mx) * (b - my) for a, b in zip(x, y))
    assert xx > 0 and yy > 0
    slope = xy / xx
    intercept = my - slope * mx
    predicted = [intercept + slope * a for a in x]
    residuals = [b - p for b, p in zip(y, predicted)]
    rmse = math.sqrt(statistics.mean(r * r for r in residuals))
    return {'intercept': intercept, 'slope': slope, 'pearsonCorrelation': max(-1., min(1., xy / math.sqrt(xx * yy))),
            'rmseAuthorUnits': rmse, 'maximumAbsoluteResidualAuthorUnits': max(map(abs, residuals)),
            'rmseDividedByAuthorPopulationSd': rmse / math.sqrt(yy / len(y)),
            'xMean': mx, 'xPopulationSd': math.sqrt(xx / len(x)), 'yMean': my, 'yPopulationSd': math.sqrt(yy / len(y)),
            'ySampleSd': math.sqrt(yy / (len(y) - 1)), 'affineResidualWithin1eMinus10': max(map(abs, residuals)) <= 1e-10}, predicted, residuals


def compare_series(name, author, monthly, variant):
    keyed = {r['month']: r for r in monthly}
    rows = author['rows']
    x, y = [keyed[r['month']]['rawSsi'][variant] for r in rows], [r['ssi'] for r in rows]
    fit, predicted, residuals = affine(x, y)
    comparisons = []
    for r, raw, fitted, residual in zip(rows, x, predicted, residuals):
        item = keyed[r['month']]
        comparisons.append({'month': r['month'], 'authorDate': r['date'], 'officialMonthEndDates': sorted({f['date'] for f in item['funds'].values()}),
                            'rawSsi': raw, 'authorStandardizedSsi': r['ssi'], 'affineFittedAuthorSsi': fitted, 'affineResidualAuthorUnits': residual,
                            'splitEventsInMonth': item['splitEventsInMonth']})
    standardized_rmse = {}
    for denominator, sd in [('population', statistics.pstdev(x)), ('sample', statistics.stdev(x))]:
        standardized_rmse[denominator] = math.sqrt(statistics.mean(((a - statistics.mean(x)) / sd - b) ** 2 for a, b in zip(x, y)))
    return {'sheet': name, 'inputVariant': variant, 'months': len(rows), 'firstMonth': rows[0]['month'], 'lastMonth': rows[-1]['month'],
            'equation': 'author_standardized_ssi = intercept + slope * reconstructed_raw_ssi + residual',
            'affine': fit, 'sameCoverageStandardizationRmseAuthorUnits': standardized_rmse,
            'dateDifferences': [r for r in comparisons if r['officialMonthEndDates'] != [r['authorDate']]],
            'largestAbsoluteResidualMonths': sorted(comparisons, key=lambda r: (-abs(r['affineResidualAuthorUnits']), r['month']))[:10],
            'comparisons': comparisons}


def self_test():
    assert previous_month('2007-01') == '2006-12'
    fit, _, residual = affine([1., 2., 3.], [5., 8., 11.])
    assert fit['slope'] == 3 and fit['intercept'] == 2 and max(map(abs, residual)) == 0
    data = {}
    for symbol in FUNDS:
        growth = .1 if symbol in LONG else .02
        data[symbol] = {'2020-01': {'date': '2020-01-31', 'displayedShares000': 100., 'implicitShares000': 100.},
                        '2020-02': {'date': '2020-02-28', 'displayedShares000': 100 * (1 + growth), 'implicitShares000': 100 * (1 + growth)}}
    rebuilt = reconstruct(['2020-02'], data, [])[0]
    assert abs(rebuilt['rawSsi']['displayed_so'] - .24) < 1e-12
    # A constant whole-history split basis cancels from a growth ratio.
    assert math.isclose((110 / 25) / (100 / 25) - 1, 110 / 100 - 1)
    csv_bytes = b'Date,Ticker,NAV,Shares Outstanding (000),Assets Under Management\n01/30/2020,SSO,10,1,10000\n01/31/2020,SSO,10,1.1,11000\n'
    months, _, _ = read_nav(csv_bytes, 'SSO')
    assert months['2020-01']['date'] == '2020-01-31' and months['2020-01']['implicitShares000'] == 1.1
    assert .10 / .09 - 1 != .1001 / .0901 - 1  # Display rounding can alter growth.
    return {'status': 'verified', 'cases': 6, 'coverage': ['previous calendar month', 'known affine transform', 'three-long minus three-short arithmetic', 'constant split-basis invariance', 'last actual monthly record and thousands units', 'rounding sensitivity']}


def run(input_dir):
    manifest_path = input_dir / 'retrieval-manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    metadata = {r['id']: r for r in manifest}
    filenames = {s: s + '-historical_nav.csv' for s in FUNDS}
    filenames.update(author_ssi=AUTHOR_FILE, splits='etf_splits.csv')
    sources, payloads = [], {}
    for identity, filename in filenames.items():
        data = (input_dir / filename).read_bytes()
        assert sha(data) == metadata[identity]['sha256'], f'{identity}: saved response hash mismatch'
        payloads[identity] = data
        sources.append({'id': identity, 'path': str(input_dir / filename), 'sha256': sha(data), 'url': metadata[identity]['url'],
                        'retrievedAt': metadata[identity]['retrievedAt'], 'httpStatus': metadata[identity]['httpStatus']})
    author = read_author(payloads['author_ssi'])
    data, coverage, calendars = {}, {}, {}
    for symbol in FUNDS:
        data[symbol], coverage[symbol], calendars[symbol] = read_nav(payloads[symbol], symbol)
    splits = [{'symbol': r['Symbol'], 'type': r['Split Type'], 'ratio': float(r['Ratio']),
               'date': dt.datetime.strptime(r['Date of Split'], '%m/%d/%Y').date().isoformat()}
              for r in csv.DictReader(io.StringIO(payloads['splits'].decode('utf-8-sig'))) if r['Symbol'] in FUNDS]
    assert len(splits) == 25
    months = sorted({r['month'] for sheet in author.values() for r in sheet['rows']})
    assert len(months) == 149
    common_month_ends = {}
    for date in sorted(set.intersection(*(calendars[s] for s in FUNDS))):
        common_month_ends[date[:7]] = date
    endpoint_months = [previous_month(months[0])] + months
    endpoint_differences = []
    for month in endpoint_months:
        dates = {symbol: data[symbol][month]['date'] for symbol in FUNDS}
        common = common_month_ends[month]
        if any(date != common for date in dates.values()):
            endpoint_differences.append({'month': month, 'perFundLastActualDates': dates, 'lastCommonDate': common})
    monthly = reconstruct(months, data, splits)
    variants = ['displayed_so', 'implicit_so_precision_sensitivity']
    comparisons = [compare_series(name, sheet, monthly, variant) for name, sheet in author.items() for variant in variants]
    paper, current = [{r['month']: r for r in author[name]['rows']} for name in ['Series From Paper', 'Current Series']]
    overlap = sorted(set(paper) & set(current))
    overlap_fit, _, _ = affine([paper[m]['ssi'] for m in overlap], [current[m]['ssi'] for m in overlap])
    sensitivity = []
    for name, sheet in author.items():
        chosen = [r for r in monthly if r['month'] in {a['month'] for a in sheet['rows']}]
        differences = [r['rawSsi'][variants[1]] - r['rawSsi'][variants[0]] for r in chosen]
        sensitivity.append({'sheet': name, 'months': len(chosen), 'meanAbsoluteRawSsiDifference': statistics.mean(map(abs, differences)),
                            'maximumAbsoluteRawSsiDifference': max(map(abs, differences)),
                            'largestRawDifferenceMonths': sorted([{'month': r['month'], 'implicitMinusDisplayedRawSsi': d} for r, d in zip(chosen, differences)], key=lambda r: -abs(r['implicitMinusDisplayedRawSsi']))[:10]})
    evidence = {'id': 'portfolio-entry-ssi-replication-v1', 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'status': 'definition_reconciliation_only', 'predictiveValidation': False, 'pointInTimeValidated': False, 'integrationEligible': False,
                'portfolioReturnsRead': False, 'investmentModelsRun': False, 'signalVariantsSelected': False,
                'script': {'path': str(Path(__file__).resolve().relative_to(ROOT)), 'sha256': sha(Path(__file__).read_bytes())},
                'manifest': {'path': str(manifest_path), 'sha256': sha(manifest_bytes)}, 'sources': sources,
                'references': [{'url': PAPER_URL, 'location': 'Section III.A pp2497; III.B Eq1/Eq2 pp2498-2499; standardization pp2500 and footnote31 pp2513'},
                               {'url': APPENDIX_URL, 'location': 'IA.3 reporting and strategic lags; IA.8 pp54-55 unstandardized portfolio variable'},
                               {'url': 'https://www.shaunwdavies.com/research', 'location': 'Speculation Sentiment Index link to the saved public workbook'}],
                'definitions': {'formula': 'sum_i_in_SSO_QLD_DDM(SO_i_month/SO_i_previous_month-1) - sum_i_in_SDS_QID_DXD(SO_i_month/SO_i_previous_month-1)',
                                'units': 'Raw SSI is a sum of fractional monthly growth rates. No division by three, extra leverage multiplier or percentage-point conversion.',
                                'monthlySelection': 'Last actual dated record within each calendar month for each fund, compared with the immediately preceding calendar month. No forward fill; source and author dates are retained and joined on YYYY-MM.',
                                'monthlyDefinitionEvidence': 'The published Eq1 defines monthly SO but does not state a precise within-month observation rule there. Last actual month record is the explicit replication convention, consistent with nearly all legacy workbook dates. Its exceptions are reported, not silently shifted.',
                                'displayed_so': 'Shares Outstanding (000) as printed in the current official CSV. The common thousands unit cancels in ratios.',
                                'implicit_so_precision_sensitivity': 'Assets Under Management / NAV / 1000. Only a precision/accounting sensitivity, not adopted as a verified substitute SO field.',
                                'splitTreatment': 'Use the saved histories as printed, with no additional split factors. A constant retrospective unit multiplier cancels from within-series growth; printed rounding need not cancel. Event-by-event split validation is a separate audit. No claim of a complete historical vintage is made.',
                                'normalization': 'Fit only descriptive affine author = a+b*raw on each sheet coverage. Also report direct population/sample standardization on that identical coverage. These are ex-post definition comparisons and cannot be inputs available at the historical decision time.',
                                'anomalies': 'Report the ten largest absolute affine residual months in each fixed comparison; retain every month and make no exclusion or alternate definition selection.'},
                'officialInputCoverage': coverage, 'reconstructedWindow': {'months': len(months), 'firstMonth': months[0], 'lastMonth': months[-1], 'firstBaselineMonth': previous_month(months[0])},
                'monthEndCalendarCheck': {'endpointMonthsIncludingBaseline': len(endpoint_months), 'ssiMonths': len(months),
                                          'definition': 'Compare each per-fund last actual month record to the last date present for all six funds in that month; check the previous-month baseline too.',
                                          'allPerFundEndpointsEqualLastCommonDate': not endpoint_differences, 'differentEndpointMonths': endpoint_differences,
                                          'primaryDefinitionUnchanged': 'All SSI calculations remain per-fund last actual record. Differences, if any, are reported rather than silently substituted.'},
                'authorSheets': {name: {'months': len(s['rows']), 'firstDate': s['rows'][0]['date'], 'lastDate': s['rows'][-1]['date'], 'notes': s['notes']} for name, s in author.items()},
                'authorOverlap': {'months': len(overlap), 'equation': 'current = intercept + slope * paper + residual', 'affine': overlap_fit,
                                  'dateDifferences': [{'month': m, 'paperDate': paper[m]['date'], 'currentDate': current[m]['date']} for m in overlap if paper[m]['date'] != current[m]['date']],
                                  'interpretation': 'Near-exact affine overlap is compatible with changed centering/scaling. It is not evidence identifying or ruling out revisions to the underlying share data.'},
                'comparisons': comparisons, 'roundingSensitivity': sensitivity, 'monthlyReconstruction': monthly, 'selfTests': self_test(),
                'limitations': ['The published paper primarily uses Bloomberg SO; ProShares is a crosscheck and daily-test source. Current official CSVs are not the original Bloomberg inputs or the original historical vintage.',
                                'The author workbook supplies standardized legacy outputs, not raw six-fund inputs or its exact centering/scaling parameters. The two sheets do not cover the complete final published sample.',
                                'No source-return association, portfolio payoff or predictive test enters this reconciliation. Matching data definitions alone would not validate an investment signal.',
                                'Observation dates, HTTP retrieval/Last-Modified and retrospective affine normalization do not establish when a historical observation was first publicly available. Split, precision, revision and timing questions remain distinct.']}
    for item in sources:
        assert sha(Path(item['path']).read_bytes()) == item['sha256']
    assert sha(manifest_path.read_bytes()) == sha(manifest_bytes)
    evidence['statisticsSha256'] = sha(json.dumps({'comparisons': comparisons, 'authorOverlap': evidence['authorOverlap'], 'roundingSensitivity': sensitivity, 'monthlyReconstruction': monthly}, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, default=DEFAULT_INPUT)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), indent=2)); return
    evidence = run(args.input_dir)
    if args.write:
        OUTPUT.write_text(json.dumps(evidence, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
        print(json.dumps({'output': str(OUTPUT.relative_to(ROOT)), 'statisticsSha256': evidence['statisticsSha256'],
                          'comparisons': [{k: c[k] for k in ('sheet', 'inputVariant', 'months', 'affine')} for c in evidence['comparisons']]}, indent=2))
    else:
        print(json.dumps(evidence, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == '__main__':
    main()
