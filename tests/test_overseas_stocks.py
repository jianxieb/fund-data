import unittest
from datetime import datetime
from unittest.mock import patch

import overseas_stocks as stocks
import refresh
from scripts import build_portfolio_data as portfolio
from scripts import check_refresh


class OverseasStockTests(unittest.TestCase):
    def test_reused_ticker_rejects_old_etf_and_filters_pre_ipo_bars(self):
        company = next(r for r in stocks.CATALOG if r['symbol'] == 'SPCX')
        days = ['2026-06-11', '2026-06-12', '2026-06-15']
        node = {'meta': {'symbol': 'SPCX', 'longName': company['issuer'], 'currency': 'USD', 'instrumentType': 'EQUITY', 'exchangeTimezoneName': 'America/New_York'},
                'timestamp': [int(datetime.fromisoformat(d + 'T20:00:00+00:00').timestamp()) for d in days],
                'indicators': {'adjclose': [{'adjclose': [9, 150, 160]}], 'quote': [{'close': [9, 151, 161]}]}}
        normalized = stocks.normalize_history(node, company, '2026-06-15')
        self.assertEqual([r['date'] for r in normalized['data']], days[1:])
        self.assertEqual(normalized['close'], 161)
        node['meta']['instrumentType'] = 'ETF'
        with self.assertRaisesRegex(ValueError, '发行人'):
            stocks.normalize_history(node, company, '2026-06-15')
        node['meta']['instrumentType'] = 'EQUITY'
        node['meta']['longName'] = 'The SPAC and New Issue ETF'
        with self.assertRaisesRegex(ValueError, '发行人'):
            stocks.normalize_history(node, company, '2026-06-15')

    def test_short_history_has_own_risk_but_no_fake_annual_windows(self):
        series = [('2026-06-12', 100), ('2026-06-15', 80), ('2026-06-16', 110)]
        result = stocks.performance(series, '2026-06-16')
        self.assertEqual(result['r'], [None] * 5)
        self.assertAlmostEqual(result['sinceListing'], 10)
        self.assertAlmostEqual(result['mdd5'], -20)
        self.assertTrue(result['risk5']['partial'])

    def test_four_discontinuous_quarters_do_not_make_ttm_roe(self):
        q = {day: {'period': day, 'NetIncome': 10} for day in ['2025-03', '2025-06', '2026-03', '2026-06']}
        self.assertIsNone(stocks.trailing_total(q, 'NetIncome'))
        continuous = {day: {'period': day, 'NetIncome': 10} for day in ['2025-09', '2025-12', '2026-03', '2026-06']}
        self.assertEqual(stocks.trailing_total(continuous, 'NetIncome'), 40)

    def test_roe_uses_four_quarters_and_average_equity(self):
        q = {day: {'period': day, 'NetIncome': 10, 'TotalRevenue': 100, 'StockholdersEquity': 100} for day in ['2025-06', '2025-09', '2025-12', '2026-03', '2026-06']}
        q['2026-06']['StockholdersEquity'] = 300
        summary = stocks.financial_summary({'quarterly': q})
        self.assertEqual(summary['roeTTM'], 20)
        self.assertEqual(summary['revenueGrowth']['value'], 0)

    def test_negative_base_is_not_fake_positive_growth(self):
        self.assertEqual(stocks.growth(-5, -10)['label'], '亏损收窄')
        self.assertIsNone(stocks.growth(-5, -10)['value'])
        self.assertEqual(stocks.growth(5, -10)['label'], '扭亏')
        self.assertEqual(stocks.growth(-5, 10)['value'], -150)

    def test_official_new_report_and_fiscal_date_supplement_api(self):
        facts = stocks.parse_facts({'timeseries': {'result': []}}, 'MU', 'USD')
        newest = facts['quarterly']['2026-08']
        self.assertEqual(newest['reportDate'], '2026-09-03')
        self.assertEqual(newest['TotalRevenue'], 54229000000)
        self.assertEqual(facts['annual']['2026-08']['NetIncome'], 84969000000)
        raw = {'timeseries': {'result': [{'meta': {'symbol': ['MU'], 'type': ['quarterlyTotalRevenue']}, 'quarterlyTotalRevenue': [dict(asOfDate='2026-08-31', periodType='3M', currencyCode='USD', reportedValue={'raw': 1})]}]}}
        with self.assertRaisesRegex(ValueError, '不一致'):
            stocks.parse_facts(raw, 'MU', 'USD')
        raw['timeseries']['result'][0]['quarterlyTotalRevenue'][0]['currencyCode'] = 'TWD'
        with self.assertRaisesRegex(ValueError, '币种'):
            stocks.parse_facts(raw, 'MU', 'USD')

    def test_usd_adr_pe_never_uses_twd_statement_eps(self):
        company = next(r for r in stocks.CATALOG if r['symbol'] == 'TSM')
        quote = dict(symbol='TSM', quoteType='EQUITY', currency='USD', longName=company['issuer'], financialCurrency='TWD', epsTrailingTwelveMonths=10, epsForward=20)
        hist = dict(close=200, data=[{'date': '2026-10-05', 'adjustedClose': 199}, {'date': '2026-10-06', 'adjustedClose': 200}], source='source')
        financial = dict(reportDate='2026-06-30', DilutedEPS=136.25)
        with patch.object(stocks, 'cache_json', side_effect=[quote, {}]), patch.object(stocks, 'stock_history', return_value=hist), patch.object(stocks, 'parse_facts', return_value={}), patch.object(stocks, 'financial_summary', return_value=financial):
            result = stocks.build_stock(company, '2026-10-06', offline=True)
        self.assertEqual(result['pe'], 20)
        self.assertEqual(result['peForward'], 10)

    def test_reported_operating_profit_does_not_use_provider_adjusted_metric(self):
        entries = []
        for key, amount in [('TotalRevenue', 1000), ('NetIncome', 10), ('OperatingIncome', 22), ('TotalOperatingIncomeAsReported', 18)]:
            metric = 'quarterly' + key
            entries.append({'meta': {'symbol': ['NVDA'], 'type': [metric]}, metric: [{'asOfDate': '2026-07-31', 'periodType': '3M', 'currencyCode': 'USD', 'reportedValue': {'raw': amount}}]})
        payload = {'timeseries': {'result': entries}}
        parsed = stocks.parse_facts(payload, 'NVDA', 'USD')
        self.assertAlmostEqual(stocks.financial_summary(parsed)['operatingMargin'], 1.8)
        payload['timeseries']['result'] = entries[:-1]
        self.assertIsNone(stocks.financial_summary(stocks.parse_facts(payload, 'NVDA', 'USD'))['operatingMargin'])

    def test_overseas_equities_are_stocks_in_portfolio_universe(self):
        assets = {r['id']: r for r in portfolio.universe()}
        for company in stocks.CATALOG:
            row = assets['stock:' + company['symbol']]
            self.assertEqual((row['kind'], row['market'], row['currency']), ('stock', 'us', 'USD'))
        self.assertEqual(assets['us:QQQM']['kind'], 'etf')

    def test_daily_refresh_precedes_portfolio_and_gate_tracks_foreign_dates(self):
        self.assertLess(refresh.DATASETS.index('overseas_stocks'), refresh.DATASETS.index('portfolio'))
        self.assertEqual(refresh.PUBLISHED_OUTPUTS['overseas_stocks'], ('overseas-stocks.js',))
        self.assertIn('--offline', refresh.commands(True)['overseas_stocks'])
        before = {'OVERSEAS_STOCKS': [{'symbol': 'LITE', 'returnAsOf': '2026-10-06'}]}
        after = {'OVERSEAS_STOCKS': [{'symbol': 'LITE', 'returnAsOf': '2026-10-01'}]}
        self.assertTrue(check_refresh.check_snapshots(before, after))


if __name__ == '__main__':
    unittest.main()
