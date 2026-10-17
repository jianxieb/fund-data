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
        result = assess('UNREVIEWED', 'us', '2026-06-30', '2026-10-17', 100, 200, annual, 500)
        self.assertEqual(result['groups'], ['other'])
        self.assertEqual(result['status'], 'pending')

    def test_actual_a_share_roster_withdrawals_and_growth_restorations(self):
        removed = [r for r in self.cn.values() if any(g in (r.get('companySelection') or {}).get('previousGroups', []) for g in ('quality','growth','breakout'))
                   and r['companySelection']['groups'] == ['other']]
        self.assertEqual(len(removed), 19)
        for code in ['688188','688278','300661','002558','603444','300972','688808']:
            self.assertEqual(self.cn[code]['companySelection']['groups'], ['other'])
            self.assertIn('撤回', self.cn[code]['companySelection']['rationale'])
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
        verdict = cn_selection(row, '2026-10-17')
        self.assertEqual(verdict['groups'], ['quality', 'growth'])
        evidence = {e['label']: e for e in verdict['evidence']}
        self.assertEqual(evidence['矿产金锭销量']['value'], 27424)
        self.assertEqual(evidence['上年同期矿产金锭销量']['value'], 21178)
        self.assertEqual(evidence['矿产铜精矿销量']['value'], 353831)
        self.assertTrue(evidence['矿产金锭销量']['sourceUrl'].endswith('1225550244.PDF'))
        self.assertIn('售价上升', verdict['reviews']['growth']['rationale'])
        self.assertNotIn('旧报告', verdict['rationale'])
        self.assertIn('1.53', verdict['reviews']['quality']['rationale'])

    def test_fii_quality_hold_does_not_pretend_five_year_records_are_missing(self):
        verdict = cn_selection(self.cn['601138'], '2026-10-17')
        quality = verdict['reviews']['quality']
        self.assertEqual(verdict['groups'], ['growth'])
        self.assertTrue(next(c['pass'] for c in quality['checks'] if c['label'].startswith('连续五个')))
        self.assertEqual([c['label'] for c in quality['checks'] if not c['pass']], ['逐家公司评审明确入选本组'])
        for amount in ['52.38', '172.30', '73.91', '90.92', '23.92']:
            self.assertIn(amount, quality['rationale'])

    def test_cash_and_earnings_deterioration_still_vetoes_manual_approval(self):
        row = deepcopy(self.us['ANET'])
        row['financials']['ttmCash'] = -1
        result = classify(row, '2026-10-17')
        self.assertEqual(result['screening']['groups'], ['other'])
        self.assertIn('经营现金', result['companySelection']['rationale'])
        self.assertIn('失效', result['companySelection']['rationale'])
        row = deepcopy(self.us['FTNT'])
        row['financials']['operatingGrowth']['value'] = -1
        self.assertNotIn('growth', classify(row, '2026-10-17')['screening']['groups'])

    def test_missing_primary_source_cannot_be_replaced_by_a_retain_label(self):
        record = deepcopy(self.cn['601138']['companySelection'])
        record['sources'] = []
        with patch('company_selection.json.loads', return_value={'companies': {'cn:601138': record}}):
            result = cn_selection(self.cn['601138'], '2026-10-17')
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
            refresh_quality_review(copy, '2026-10-17')
            for key in ['r','price','latestFinancials','financialReports','financialHistory5']:
                self.assertEqual(copy.get(key), row.get(key))
        for row in self.us.values():
            copy = classify(deepcopy(row), '2026-10-17')
            self.assertEqual(copy, row)

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
        verdict = cn_selection(row, '2026-10-17')
        self.assertEqual(verdict['coreGrowth']['value'], -50)
        self.assertNotIn('growth', verdict['groups'])
        us = deepcopy(self.us['FTNT'])
        us['financials']['operatingGrowth']['value'] = -50
        self.assertNotIn('growth', classify(us, '2026-10-17')['screening']['groups'])

    def test_identical_normalized_evidence_has_identical_rules_in_both_markets(self):
        record = deepcopy(self.cn['601138']['companySelection'])
        record['groups'] = ['quality','growth','breakout']
        annual = [dict(period=str(y)+'-12', profit=100, cash=150) for y in range(2021,2026)]
        records = {'companies': {'cn:SAME':record,'us:SAME':record}}
        for cash,growth,published,eligible in [(150,10,'2026-08-20',True),(-1,10,'2026-08-20',True),(150,-1,'2026-08-20',True),(150,10,'2026-11-01',True),(150,10,'2026-08-20',False)]:
            with self.subTest(cash=cash,growth=growth,published=published,eligible=eligible), patch('company_selection.json.loads', return_value=records):
                results = [assess('SAME', market, '2026-06-30','2026-10-17',100,cash,annual,growth,
                                  core_period='2026-06-30',core_basis='test',published_at=published,eligible=eligible)
                           for market in ('cn','us')]
                self.assertEqual(results[0],results[1])


if __name__ == '__main__':
    unittest.main()
