import json
import tempfile
import unittest
from copy import deepcopy
from datetime import date
from pathlib import Path
from unittest.mock import patch

import data_quality
import overseas_stocks as stocks
from us_stock_groups import classify

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/company-selection-20261020.json'


class PartialOverseasQuarterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.historical = json.loads(FIXTURE.read_text())['us']
        cls.cases = json.loads((ROOT / 'tests/fixtures/overseas-partial-quarter-20261026.json').read_text())['cases']

    def facts(self, case):
        old = deepcopy(case['previous']['financialHistory'])
        with patch.object(stocks, 'EVIDENCE', {}):
            provider = stocks.parse_facts(case['response'], case['symbol'], case['currency'])
        return stocks.merge_filings(provider, old)

    def build(self, case):
        symbol = case['symbol']
        company = next(c for c in stocks.CATALOG if c['symbol'] == symbol)
        old = deepcopy(case['previous'])
        quote = dict(symbol=symbol, quoteType='EQUITY', currency='USD', longName=company['issuer'],
                     financialCurrency='USD', epsTrailingTwelveMonths=10, epsForward=11,
                     _fetchedAt='2026-10-26T00:00:00+00:00')
        history = dict(close=210, source='https://finance.yahoo.com/quote/' + symbol + '/history/',
                       data=[{'date': '2026-10-22', 'adjustedClose': 200},
                             {'date': '2026-10-23', 'adjustedClose': 210}])
        with patch.object(stocks, 'EVIDENCE', {}), \
             patch.object(stocks, 'RESEARCH', {symbol: old['research']}), \
             patch.object(stocks, 'cache_json', side_effect=[quote, deepcopy(case['response'])]), \
             patch.object(stocks, 'stock_history', return_value=history), \
             patch.object(stocks, 'official_history', return_value=(old['financialHistory'], 'saved_official_filings')), \
             patch('company_selection.PATH', FIXTURE):
            return stocks.build_stock(company, '2026-10-25', offline=True)

    def test_actual_eps_only_responses_do_not_borrow_income_from_the_previous_quarter(self):
        for case in self.cases:
            with self.subTest(symbol=case['symbol']):
                facts = self.facts(case)
                before = deepcopy(facts)
                result = stocks.financial_summary(facts)
                self.assertEqual(result['period'], '2026-09')
                self.assertEqual(result['reportDate'], '2026-09-30')
                self.assertEqual(result['missingFields'], case['expectedMissingFields'])
                self.assertEqual(result['dataStatus'], 'partial')
                self.assertIsNone(result.get('TotalRevenue'))
                self.assertIsNone(result.get('NetIncome'))
                self.assertIsNone(result['ttmRevenue'])
                self.assertIsNone(result['ttmProfit'])
                self.assertIsNone(result['roeTTM'])
                self.assertIsNone(result['operatingMargin'])
                self.assertEqual(result['profitGrowth']['label'], '缺本季净利润')
                self.assertEqual(result['revenueGrowth']['label'], '缺本季营业收入')
                self.assertIn('2026-09', result['missingEvidence'])
                self.assertIn('营业收入、净利润', result['missingEvidence'])
                self.assertGreater(result['DilutedEPS'], 0)
                self.assertEqual(facts, before)

    def test_partial_quarter_does_not_stop_valid_prices_or_company_reports(self):
        for case in self.cases:
            with self.subTest(symbol=case['symbol']):
                row = self.build(case)
                self.assertEqual(row['price'], 210)
                self.assertEqual(row['priceAsOf'], '2026-10-23')
                self.assertEqual(row['fundamentalsAsOf'], '2026-09-30')
                self.assertEqual(row['screening']['groups'], ['other'])
                self.assertEqual(row['companySelection']['status'], 'pending')
                self.assertTrue(all(not r['qualified'] for r in row['screening']['reviews'].values()))
                self.assertIn('营业收入、净利润', row['companySelection']['rationale'])
                report = stocks.overseas_research.report_for(row)
                quarterly = next(s for s in report['sections'] if s['id'] == 'quarterly')
                self.assertEqual(quarterly['paragraphs'][0], row['financials']['missingEvidence'])
                self.assertEqual(quarterly['table']['rows'][0][1:3], ['—', '—'])

    def test_an_existing_business_approval_cannot_bypass_missing_income(self):
        row = deepcopy(self.historical['MSCI'])
        with patch('company_selection.PATH', FIXTURE):
            self.assertIn('quality', classify(row, '2026-10-20')['screening']['groups'])
            row['financials'].update(NetIncome=None, dataStatus='partial', missingFields=['NetIncome'],
                                     missingEvidence='2026-06财季来源缺净利润')
            result = classify(row, '2026-10-20')
        self.assertEqual(result['screening']['groups'], ['other'])
        self.assertEqual(result['companySelection']['status'], 'pending')
        for review in result['screening']['reviews'].values():
            self.assertFalse(review['qualified'])
            self.assertTrue(any(c['reason'] == '2026-06财季来源缺净利润' for c in review['checks']))

    def test_audit_requires_explicit_missing_fields_and_withdrawn_approvals(self):
        row = self.build(self.cases[0])

        def issue(value):
            report = data_quality.audit({'OVERSEAS_STOCKS': [value]}, date(2026, 10, 26))
            dataset = next(d for d in report['datasets'] if d['id'] == 'overseas_stocks')
            return next(i for i in dataset['issues'] if i['code'] == 'overseas_financial_fields_missing')

        result = issue(row)
        self.assertEqual(result['severity'], 'unverified')
        self.assertEqual(result['affected'], 'JPM')
        self.assertIn('2026-09-30财季来源缺营业收入、净利润', result['message'])
        unlabelled = deepcopy(row)
        unlabelled['financials'].pop('missingEvidence')
        self.assertEqual(issue(unlabelled)['severity'], 'error')
        wrong_fields = deepcopy(row)
        wrong_fields['financials']['missingFields'] = ['NetIncome']
        self.assertEqual(issue(wrong_fields)['severity'], 'error')
        generic = deepcopy(row)
        generic['financials']['missingEvidence'] = '来源缺项'
        self.assertEqual(issue(generic)['severity'], 'error')
        selected = deepcopy(row)
        selected['screening']['groups'] = ['quality']
        self.assertEqual(issue(selected)['severity'], 'error')

    def test_later_complete_source_clears_the_gap_and_zero_profit_is_valid(self):
        facts = self.facts(self.cases[0])
        self.assertEqual(stocks.financial_summary(facts)['dataStatus'], 'partial')
        facts['quarterly']['2026-09'].update(TotalRevenue=100, NetIncome=0,
                                             TotalOperatingIncomeAsReported=10)
        result = stocks.financial_summary(facts)
        self.assertEqual(result['dataStatus'], 'complete')
        self.assertEqual(result['missingFields'], [])
        self.assertIsNone(result['missingEvidence'])
        self.assertEqual(result['NetIncome'], 0)
        self.assertEqual(result['operatingMargin'], 10)

    def test_no_usable_quarter_or_wrong_currency_remains_a_failure(self):
        with self.assertRaisesRegex(ValueError, '缺最近季度'):
            stocks.financial_summary({'quarterly': {}})
        response = deepcopy(self.cases[0]['response'])
        item = response['timeseries']['result'][0]
        item[item['meta']['type'][0]][0]['currencyCode'] = 'CNY'
        with patch.object(stocks, 'EVIDENCE', {}), self.assertRaisesRegex(ValueError, '币种'):
            stocks.parse_facts(response, 'JPM', 'USD')

    def test_stage_records_specific_metadata_gaps_without_claiming_complete_financials(self):
        row = self.build(self.cases[0])
        company = next(c for c in stocks.CATALOG if c['symbol'] == 'JPM')
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            with patch.object(stocks, 'DATA', data), patch.object(stocks, 'HISTORY_PATH', data / 'history.json'), \
                 patch.object(stocks, 'CATALOG', [company]), \
                 patch.object(stocks, 'build_stock', return_value=deepcopy(row)), \
                 patch.object(stocks, 'write_status') as status, \
                 patch('sys.argv', ['overseas_stocks.py', '--offline', '--end', '2026-10-25']):
                self.assertEqual(stocks.main(), 0)
            self.assertTrue((data / 'overseas-stocks.js').exists())
            self.assertEqual(status.call_args.args, ('overseas_stocks', 'partial'))
            gap = status.call_args.kwargs['metadataWarnings'][0]
            self.assertEqual(gap['symbol'], 'JPM')
            self.assertEqual(gap['missingFields'], ['TotalRevenue', 'NetIncome'])
            self.assertEqual(status.call_args.kwargs['asOf'], '2026-10-23')


if __name__ == '__main__':
    unittest.main()
