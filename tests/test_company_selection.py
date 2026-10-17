import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from company_selection import assess, cn_selection, apply_us
from stock_screen import load_old_rows, refresh_quality_review
from us_stock_groups import classify

ROOT = Path(__file__).resolve().parents[1]


class CompanySelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cn = load_old_rows((ROOT / 'data/snapshot.js').read_text())
        cls.us = {r['symbol']: r for r in json.loads(next(l.split('=', 1)[1].rstrip(';')
            for l in (ROOT / 'data/overseas-stocks.js').read_text().splitlines() if l.startswith('var OVERSEAS_STOCKS=')))}

    def test_numeric_outperformance_alone_cannot_select_an_unreviewed_company(self):
        annual = [dict(period=str(y)+'-12', profit=100, cash=200) for y in range(2021,2026)]
        result = assess('UNREVIEWED', 'us', '2026-06-30', '2026-10-18', 100, 200, annual, 500)
        self.assertEqual(result['groups'], ['other'])
        self.assertEqual(result['status'], 'pending')

    def test_actual_a_share_roster_withdrawals_and_growth_restorations(self):
        removed = [r for r in self.cn.values() if any(g in (r.get('companySelection') or {}).get('previousGroups', []) for g in ('quality','growth','breakout'))
                   and r['companySelection']['groups'] == ['other']]
        self.assertEqual(len(removed), 19)
        for code in ['688188','688278','300661','002558','603444','300972','688808']:
            self.assertEqual(self.cn[code]['companySelection']['groups'], ['other'])
            self.assertGreater(len(self.cn[code]['companySelection']['rationale']), 30)
        for code in ['601138','300308']:
            self.assertIn('growth', self.cn[code]['companySelection']['groups'])
        self.assertIn('424.25', self.cn['601138']['companySelection']['risk'])

    def test_a_new_report_or_missed_disclosure_expires_the_decision(self):
        row = deepcopy(self.cn['601138'])
        row['latestFinancials']['reportDate'] = '2026-09-30'
        self.assertEqual(cn_selection(row, '2026-10-30')['groups'], ['other'])
        self.assertEqual(cn_selection(self.cn['601138'], '2026-11-01')['status'], 'pending')
        row = deepcopy(self.us['MSFT'])
        row['financials']['reportDate'] = '2026-09-30'
        self.assertEqual(classify(row, '2026-10-30')['screening']['groups'], ['other'])

    def test_zijin_selection_uses_operating_evidence_not_a_previous_label(self):
        row = self.cn['601899']
        verdict = cn_selection(row, '2026-10-18')
        self.assertEqual(verdict['groups'], ['quality', 'growth'])
        evidence = {e['label']: e for e in verdict['evidence']}
        self.assertEqual(evidence['矿产金锭销量']['value'], 27424)
        self.assertEqual(evidence['上年同期矿产金锭销量']['value'], 21178)
        self.assertEqual(evidence['矿产铜精矿销量']['value'], 353831)
        self.assertTrue(evidence['矿产金锭销量']['sourceUrl'].endswith('1225550244.PDF'))
        self.assertIn('售价上升', verdict['reviews']['growth']['rationale'])
        self.assertNotIn('旧报告', verdict['rationale'])
        self.assertIn('1.53', verdict['reviews']['quality']['rationale'])

    def test_fii_quality_review_uses_liquidity_and_industry_in_addition_to_cash_conversion(self):
        verdict = cn_selection(self.cn['601138'], '2026-10-18')
        self.assertEqual(verdict['groups'], ['quality','growth'])
        self.assertTrue(verdict['reviews']['quality']['qualified'])
        liquidity = verdict['liquidityReview']
        self.assertEqual(liquidity['cashEquivalents'], 97044724000)
        self.assertEqual(liquidity['shortTermDebt'], 102325205000)
        self.assertFalse(liquidity['cashConversionIsSolvencyTest'])
        self.assertIn('23.92%',verdict['groupReasons']['quality'])
        self.assertIn('不足以单独',verdict['groupReasons']['quality'])

    def test_cash_and_earnings_deterioration_still_vetoes_manual_approval(self):
        row = deepcopy(self.us['ANET'])
        row['financials']['ttmCash'] = -1
        result = classify(row, '2026-10-18')
        self.assertEqual(result['screening']['groups'], ['other'])
        self.assertIn('经营现金', result['companySelection']['rationale'])
        self.assertIn('失效', result['companySelection']['rationale'])
        row = deepcopy(self.us['FTNT'])
        row['financials']['operatingGrowth']['value'] = -1
        self.assertNotIn('growth', classify(row, '2026-10-18')['screening']['groups'])

    def test_missing_primary_source_cannot_be_replaced_by_a_retain_label(self):
        record = deepcopy(self.cn['601138']['companySelection'])
        record['sources'] = []
        with patch('company_selection.json.loads', return_value={'companies': {'cn:601138': record}}):
            result = cn_selection(self.cn['601138'], '2026-10-18')
        self.assertEqual(result['groups'], ['other'])
        self.assertEqual(result['status'], 'pending')

    def test_new_companies_have_independent_identity_history_and_honest_results(self):
        for code in ['CDNS','KLAC','FTNT','NOW']:
            row = self.us[code]
            self.assertEqual(row['symbol'], code)
            self.assertIn('/'+code+'/', row['returnSourceUrl'])
            self.assertEqual(row['financials']['reportDate'], '2026-06-30')
            self.assertEqual(row['priceAsOf'], '2026-10-14')
            self.assertTrue(row['companySelection']['newCoverage'])
            self.assertTrue(all(v is not None for v in row['r']))
        self.assertIn('growth', self.us['FTNT']['screening']['groups'])
        self.assertEqual(self.us['NOW']['screening']['groups'], ['other'])
        self.assertIn('1.62', self.us['NOW']['companySelection']['rationale'])

    def test_selection_refresh_preserves_prices_returns_and_financials(self):
        for row in self.cn.values():
            copy = deepcopy(row)
            refresh_quality_review(copy, '2026-10-18')
            for key in ['r','price','latestFinancials','financialReports','financialHistory5']:
                self.assertEqual(copy.get(key), row.get(key))
        for row in self.us.values():
            copy = classify(deepcopy(row), '2026-10-18')
            self.assertEqual(copy, row)

    def test_eight_added_us_companies_have_current_filings_and_independent_histories(self):
        expected = {'MCO':'2026-06-30','MSCI':'2026-06-30','CTAS':'2026-08-31','ROP':'2026-06-30',
                    'PH':'2026-06-30','FAST':'2026-09-30','CPRT':'2026-07-31','ADSK':'2026-07-31'}
        catalog = json.loads((ROOT/'data/portfolio/catalog.js').read_text().split('=',1)[1].rstrip(';\n'))
        assets = {a['id']:a for a in catalog['assets']}
        reports = json.loads(next(l.split('=',1)[1].rstrip(';') for l in (ROOT/'data/overseas-stocks.js').read_text().splitlines() if l.startswith('var OVERSEAS_REPORTS=')))['reports']
        for symbol, period in expected.items():
            with self.subTest(symbol=symbol):
                row = self.us[symbol]
                self.assertEqual(row['financials']['reportDate'], period)
                self.assertEqual(row['research']['reportPeriod'], period)
                self.assertEqual(row['priceAsOf'], '2026-10-16')
                self.assertTrue(row['companySelection']['newCoverage'])
                self.assertTrue(all(v is not None for v in row['r']))
                self.assertGreaterEqual(len(row['analysis']['annual']), 5)
                asset=assets['stock:'+symbol]
                history=json.loads((ROOT/asset['historyUrl']).read_text())
                self.assertEqual(history['id'], 'stock:'+symbol)
                self.assertEqual(history['currency'], 'USD')
                self.assertEqual(history['dividends'], 'reinvested')
                self.assertEqual(history['series'][-1][0], '2026-10-16')
                self.assertTrue(any(r['code']==symbol for r in reports))

    def test_new_reviews_do_not_turn_investment_gains_or_falling_profit_into_growth(self):
        copart=self.us['CPRT']
        self.assertEqual(copart['screening']['groups'], ['quality'])
        self.assertAlmostEqual(copart['financials']['operatingGrowth']['value'], -10.5884520021)
        self.assertIn('下降10.6%',copart['companySelection']['groupReasons']['growth'])
        self.assertIn('经营现金下降18.5%',copart['companySelection']['groupReasons']['quality'])
        self.assertIn('8.35亿美元',self.us['ROP']['research']['earningsReview']['nonOperating'])
        self.assertAlmostEqual(self.us['ROP']['financials']['operatingGrowth']['value'],6.6387014408)
        self.assertIsNone(self.us['MSCI']['financials']['roeTTM'])
        self.assertIn('quality',self.us['MSCI']['screening']['groups'])

    def test_fastenal_uses_released_q3_and_single_quarter_cash(self):
        f=self.us['FAST']['financials']
        self.assertEqual(f['reportDate'],'2026-09-30')
        self.assertEqual(f['publishedAt'],'2026-10-14')
        self.assertEqual(f['OperatingCashFlow'],421600000)
        self.assertNotEqual(f['OperatingCashFlow'],1065700000)
        self.assertEqual(f['NetIncome'],401600000)
        self.assertAlmostEqual(f['operatingGrowth']['value'],20.22650056625)

    def test_review_does_not_backdate_endorsements(self):
        self.assertIsNone(cn_selection(self.cn['601138'], '2026-10-16'))
        self.assertIsNone(assess('ANET','us','2026-06-30','2026-10-16',100,200,[],50))

    def test_positive_cumulative_income_cannot_hide_a_falling_single_quarter(self):
        row = deepcopy(self.cn['601138'])
        amounts = {'2025-03-31':100, '2025-06-30':200, '2026-03-31':300, '2026-06-30':350}
        for r in row['financialReports']:
            if r['reportDate'] in amounts:
                r['deductedProfit'] = amounts[r['reportDate']]
        row['latestFinancials']['deductedProfitGrowth'] = 75
        verdict = cn_selection(row, '2026-10-18')
        self.assertEqual(verdict['coreGrowth']['value'], -50)
        self.assertNotIn('growth', verdict['groups'])
        us = deepcopy(self.us['FTNT'])
        us['financials']['operatingGrowth']['value'] = -50
        self.assertNotIn('growth', classify(us, '2026-10-18')['screening']['groups'])

    def test_identical_normalized_evidence_has_identical_rules_in_both_markets(self):
        record = deepcopy(self.cn['601138']['companySelection'])
        record['groups'] = ['quality','growth','breakout']
        annual = [dict(period=str(y)+'-12', profit=100, cash=150) for y in range(2021,2026)]
        records = {'companies': {'cn:SAME':record,'us:SAME':record}}
        for cash,growth,published,eligible in [(150,10,'2026-08-20',True),(-1,10,'2026-08-20',True),(150,-1,'2026-08-20',True),(150,10,'2026-11-01',True),(150,10,'2026-08-20',False)]:
            with self.subTest(cash=cash,growth=growth,published=published,eligible=eligible), patch('company_selection.json.loads', return_value=records):
                results = [assess('SAME', market, '2026-06-30','2026-10-18',100,cash,annual,growth,
                                  core_period='2026-06-30',core_basis='test',published_at=published,eligible=eligible)
                           for market in ('cn','us')]
                self.assertEqual(results[0],results[1])


if __name__ == '__main__':
    unittest.main()
