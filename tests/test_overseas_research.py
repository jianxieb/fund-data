import json
import unittest
from copy import deepcopy
from datetime import datetime

import overseas_research as research
import overseas_stocks as stocks


class OverseasResearchTests(unittest.TestCase):
    def row(self):
        return {'price': 200, 'financialCurrency': 'USD', 'epsTTM': 10, 'epsForward': 12,
                'financials': {'DilutedEPS': 2, 'ttmProfit': 40, 'ttmRevenue': 200, 'ttmCash': 50},
                'financialHistory': {'annual': {
                    str(year) + '-12': {'period': str(year) + '-12', 'TotalRevenue': revenue,
                                       'NetIncome': profit, 'StockholdersEquity': equity, 'DilutedEPS': 5}
                    for year, revenue, profit, equity in [(2022, 100, 10, 100), (2023, 110, 15, 200),
                                                         (2024, 121, 25, 300), (2025, 133.1, 35, 400)]}}}

    def test_annual_growth_roe_and_cash_conversion_have_independent_bases(self):
        row = research.enrich(self.row())
        a = row['analysis']
        self.assertAlmostEqual(a['revenueCagr3']['value'], 10)
        self.assertAlmostEqual(a['roe3'], 10)  # 15/150, 25/250, 35/350
        self.assertEqual(a['cashConversion'], 1.25)
        self.assertEqual(a['ttmNetMargin'], 20)
        self.assertEqual(row['peDynamic'], 25)
        self.assertEqual(row['peStatic'], 40)
        row['financials']['ttmProfit'] = -40
        row['financials']['ttmCash'] = -50
        self.assertIsNone(research.enrich(row)['analysis']['cashConversion'])

    def test_three_year_history_does_not_turn_two_year_growth_into_three_year_growth(self):
        row = self.row()
        del row['financialHistory']['annual']['2022-12']
        a = research.enrich(row)['analysis']
        self.assertIsNone(a['revenueCagr3']['value'])
        self.assertIsNone(a['roe3'])  # no opening equity for first of the three years
        row = self.row()
        row['financialHistory']['annual']['2022-12']['NetIncome'] = -10
        a = research.enrich(row)['analysis']
        self.assertIsNone(a['profitCagr3']['value'])
        self.assertIn('2022-12', a['lossYears'])
        self.assertIsNone(a['annual'][1]['profitGrowth'])
        row = self.row()
        row['financialHistory']['annual']['2024-06'] = row['financialHistory']['annual'].pop('2024-12')
        row['financialHistory']['annual']['2024-06']['period'] = '2024-06'
        self.assertIsNone(research.enrich(row)['analysis']['roe3'])

    def test_adr_dynamic_and_static_pe_require_matching_usd_listing_eps(self):
        row = self.row()
        row['financialCurrency'] = 'TWD'
        row['financials']['DilutedEPS'] = 27.25
        self.assertIsNone(research.enrich(row)['peDynamic'])
        self.assertIsNone(row['peStatic'])
        row['financials']['ListingDilutedEPSUSD'] = 4.31
        research.enrich(row)
        self.assertAlmostEqual(row['peDynamic'], 200 / (4.31 * 4))
        self.assertIsNone(row['peStatic'])

    def test_dividends_use_issuer_history_exchange_day_and_actual_usd_amount(self):
        company = next(r for r in stocks.CATALOG if r['symbol'] == 'SPCX')
        timestamp = lambda day: int(datetime.fromisoformat(day).timestamp())
        days = ['2026-06-12T20:00:00+00:00', '2026-06-15T20:00:00+00:00']
        node = {'meta': {'symbol': 'SPCX', 'longName': company['issuer'], 'currency': 'USD',
                         'instrumentType': 'EQUITY', 'exchangeTimezoneName': 'America/New_York'},
                'timestamp': [timestamp(d) for d in days],
                'indicators': {'adjclose': [{'adjclose': [150, 160]}], 'quote': [{'close': [151, 161]}]},
                'events': {'dividends': {
                    'old': {'date': timestamp('2026-06-11T20:00:00+00:00'), 'amount': 99},
                    'current': {'date': timestamp('2026-06-16T01:00:00+00:00'), 'amount': 0.5},
                    'future': {'date': timestamp('2026-06-17T20:00:00+00:00'), 'amount': 88}}}}
        result = stocks.normalize_history(node, company, '2026-06-15')
        self.assertEqual(result['cashDividend12'], 0.5)
        self.assertEqual(result['dividendRecords'], [{'day': '2026-06-15', 'amount': 0.5}])
        node['events']['splits'] = {'old': {'date': timestamp('2026-06-11T20:00:00+00:00'), 'numerator': 2, 'denominator': 1}}
        self.assertEqual(stocks.normalize_history(node, company, '2026-06-15')['cashDividend12'], 0.5)
        node['events']['splits'] = {'new': {'date': timestamp(days[0]), 'numerator': 2, 'denominator': 1}}
        result = stocks.normalize_history(node, company, '2026-06-15')
        self.assertIsNone(result['cashDividend12'])
        self.assertIn('统一股本口径', result['dividendMissing'])

    def test_published_reports_and_downloads_are_regenerated_from_same_snapshot(self):
        values = {}
        for line in (stocks.DATA / 'overseas-stocks.js').read_text().splitlines():
            if line.startswith('var '):
                key, value = line[4:].split('=', 1)
                values[key] = json.loads(value.rstrip(';'))
        rows = values['OVERSEAS_STOCKS']
        reports = values['OVERSEAS_REPORTS']['reports']
        self.assertEqual({r['code'] for r in reports}, {r['symbol'] for r in rows})
        for row, report in zip(rows, reports):
            self.assertEqual(report, research.report_for(research.enrich(deepcopy(row))))
            self.assertIn(research.fmt(row['price']), report['markdown'])
            self.assertEqual(report['reportPeriod'], row['financials']['reportDate'])
            revenue = row.get('revenueLabel', '营收')
            quarterly = next(s for s in report['sections'] if s['id'] == 'quarterly')
            self.assertEqual(quarterly['table']['headers'][1].split(' / ')[0], revenue)


if __name__ == '__main__':
    unittest.main()
