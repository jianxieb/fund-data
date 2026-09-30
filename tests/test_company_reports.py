import copy
import json
import unittest
from pathlib import Path
from company_report import (normalize, compute, known_rows, forecast_sample, dividend_summary,
                            ttm_amount, quarter_history, wacc)
from stock_screen import load_old_rows, refresh_quality_review
from stock_groups import growth_review, long_term_review, breakout_review
from scripts.build_stock_reports import build, report_row

ROOT = Path(__file__).resolve().parents[1]


class ReportCalculationTests(unittest.TestCase):
    def setUp(self):
        self.input = json.loads((ROOT / 'company-report/data/601138/summary.json').read_text())

    def test_schema_pipeline_and_real_report_amount_reconciliation(self):
        r = compute(self.input)
        self.assertEqual(len(r['annual']), 5)
        self.assertEqual(len(r['quarters']), 8)
        self.assertEqual([a['year'] for a in r['annual']], [2025, 2024, 2023, 2022, 2021])
        reports = {r['reportDate']: r for r in self.input['reports']}
        amount = reports['2026-06-30']['netProfit'] + reports['2025-12-31']['netProfit'] - reports['2025-06-30']['netProfit']
        self.assertAlmostEqual(r['ttm']['netProfit'], amount)
        self.assertAlmostEqual(r['peFromProfitAmounts'], self.input['quote']['mcap'] * 1e8 / amount)
        altered = copy.deepcopy(self.input)
        for row in altered['reports']:
            row['eps'] = 99999  # EPS share-base changes cannot contaminate profit-amount TTM.
        self.assertEqual(r['peFromProfitAmounts'], compute(altered)['peFromProfitAmounts'])
        self.assertIsNone(r['valuation']['targetPrice'])

    def test_all_frozen_calculations_reproduce(self):
        for path in (ROOT / 'company-report/data').glob('*/summary.json'):
            with self.subTest(code=path.parent.name):
                expected = json.loads(path.with_name('computed.json').read_text())
                self.assertEqual(compute(json.loads(path.read_text())), expected)

    def test_reject_old_schema_and_future_information(self):
        with self.assertRaises(ValueError):
            compute({'schemaVersion': 1})
        d = copy.deepcopy(self.input)
        d['reports'][0]['announcedAt'] = '2026-10-02'
        with self.assertRaises(ValueError):
            compute(d)
        row = {'SECUCODE': '601138.SH', 'SECURITY_CODE': '601138', 'REPORT_DATE': '2026-06-30', 'NOTICE_DATE': '2026-08-12'}
        self.assertEqual(known_rows('601138', [row], '2026-08-11'), [])
        with self.assertRaises(ValueError):
            known_rows('601899', [row], '2026-09-30')

    def test_missing_capex_is_unknown_and_negative_profit_base_not_growth(self):
        d = copy.deepcopy(self.input)
        d['reports'][0]['capex'] = None
        self.assertIsNone(compute(d)['cashMetrics'][0]['cashAfterCapex'])
        q = quarter_history([
            {'reportDate': '2026-03-31', 'announcedAt': '2026-04-30', 'revenue': 200, 'netProfit': 20, 'deductedProfit': 19},
            {'reportDate': '2025-03-31', 'announcedAt': '2025-04-30', 'revenue': 100, 'netProfit': -10, 'deductedProfit': 0}])[0]
        self.assertEqual(q['revenueGrowth'], 100)
        self.assertIsNone(q['netProfitGrowth'])
        self.assertIsNone(q['deductedProfitGrowth'])

    def test_quote_day_does_not_use_later_announcement_for_ttm(self):
        periods = [{'reportDate': '2026-06-30', 'announcedAt': '2026-08-12', 'netProfit': 50},
                   {'reportDate': '2025-12-31', 'announcedAt': '2026-03-12', 'netProfit': 100},
                   {'reportDate': '2025-06-30', 'announcedAt': '2025-08-12', 'netProfit': 20}]
        self.assertEqual(ttm_amount(periods, 'netProfit', '2026-08-11'), 100)
        self.assertEqual(ttm_amount(periods, 'netProfit', '2026-08-12'), 130)

    def test_forecasts_deduplicate_and_do_not_guess_year_or_share_basis(self):
        base = {'institution': '机构甲', 'fiscalYear': 2026, 'publishedAt': '2026-08-01', 'eps': 2,
                'shareBasis': '10亿股', 'sourceUrl': 'https://example.com/report'}
        result = forecast_sample([base, {**base, 'publishedAt': '2026-09-01', 'eps': '3'},
                                  {**base, 'institution': '机构乙', 'eps': 5},
                                  {**base, 'institution': '未来', 'publishedAt': '2026-10-01'},
                                  {**base, 'institution': '旧', 'publishedAt': '2026-01-01'},
                                  {**base, 'fiscalYear': None}, {**base, 'shareBasis': ''}], '2026-09-30')
        self.assertEqual(result['groups'][0]['institutions'], 2)
        self.assertEqual(result['groups'][0]['medianEps'], 4)
        self.assertEqual(result['excluded'], 5)

    def test_dividends_fiscal_years_future_implementation_and_splits(self):
        base = {'status': 'implemented', 'announcedAt': '2026-04-01', 'exDate': '2026-05-01',
                'fiscalPeriod': '2025-12-31', 'cashPerShare': 1}
        rows = [base, {**base}, {**base, 'fiscalPeriod': '2026-06-30', 'exDate': '2026-09-01', 'cashPerShare': .5, 'splitFactor': 2},
                {**base, 'exDate': '2026-10-01', 'cashPerShare': 10},
                {**base, 'status': 'proposed', 'exDate': '2026-09-15', 'cashPerShare': 5}]
        d = dividend_summary(rows, 10, '2026-09-30')
        self.assertEqual(d['cash12'], .75)
        self.assertEqual(d['byFiscalYear'], {'2025': 1, '2026': .5})
        self.assertEqual(d['yield12'], 7.5)
        self.assertIsNone(d['payoutRatio'])
        self.assertIsNone(dividend_summary([], 10, '2026-09-30')['yield12'])
        unknown = {**base, 'cashPerShare': None, 'splitFactor': 2}
        self.assertIsNone(dividend_summary([unknown], 10, '2026-09-30')['yield12'])
        earlier = {**unknown, 'exDate': '2025-01-01'}
        self.assertEqual(dividend_summary([earlier, base], 10, '2026-09-30')['yield12'], 10)

    def test_capital_weights_exclude_negative_debt(self):
        self.assertAlmostEqual(wacc(80, 20, .1, .05, .25), .0875)
        with self.assertRaises(ValueError):
            wacc(100, -10, .1, .05, .25)

    def test_peers_exclude_self_mixed_date_and_missing_business_comparison(self):
        d = copy.deepcopy(self.input)
        p = {'code': '601138', 'asOf': d['quote']['valuationAsOf'], 'currency': 'CNY', 'peBasis': 'TTM',
             'pe': 20, 'comparabilityReason': '同类主营', 'sourceUrl': 'https://example.com/pe'}
        d['peers'] = [p, {**p, 'code': '002475', 'asOf': '2026-09-28'}, {**p, 'code': '000977', 'comparabilityReason': ''}]
        self.assertEqual(compute(d)['peers']['records'], [])
        self.assertIsNone(compute(d)['peers']['medianPe'])


class IndependentGroupTests(unittest.TestCase):
    def setUp(self):
        self.live_rows = load_old_rows((ROOT / 'data/snapshot.js').read_text())
        self.rows = {}
        for path in (ROOT / 'company-report/data').glob('*/summary.json'):
            data = json.loads(path.read_text())
            if data.get('screeningContext', {}).get('profile'):
                self.rows[data['code']] = report_row(data)
        self.asof = self.rows['601138']['growthReview']['checkedAt']

    def test_current_groups_overlap_without_importing_dividend_pool(self):
        quality = {c for c, r in self.rows.items() if (r.get('longTermReview') or {}).get('qualified')}
        growth = {c for c, r in self.rows.items() if (r.get('growthReview') or {}).get('qualified')}
        self.assertTrue({'601138', '601899', '300750', '300308', '002463', '603979'} <= quality & growth)
        self.assertTrue({'600183', '300604', '001389', '002916', '688183'} <= growth - quality)
        self.assertEqual(sum(r['group'] == 'dividend' for r in self.live_rows.values()), 23)
        for row in self.live_rows.values():
            asof = (row.get('qualityReview') or {}).get('checkedAt', '2026-09-30')
            self.assertEqual(growth_review(row, asof), row.get('growthReview'))
            self.assertEqual(long_term_review(row, asof), row.get('longTermReview'))

    def test_positive_years_or_halfyear_alone_cannot_admit(self):
        self.assertFalse(self.rows['300693']['growthReview']['qualified'])  # Q1 not yet high growth.
        row = copy.deepcopy(self.rows['601138'])
        row['financialHistory5'] = row['financialHistory5'][:3]
        self.assertFalse(long_term_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601138'])
        row['qualityResearch'].pop('growth')
        self.assertFalse(growth_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601138'])
        row['qualityResearch']['reportPeriod'] = '2025-12-31'
        self.assertFalse(growth_review(row, self.asof)['qualified'])
        self.assertFalse(long_term_review(row, self.asof)['qualified'])

    def test_reviewed_earnings_breakouts_keep_quality_failures_explicit(self):
        expected = {'601869', '688700', '600150'}
        breakout = {c for c, r in self.rows.items() if (r.get('breakoutReview') or {}).get('qualified')
                    and not any((r.get(k) or {}).get('qualified') for k in ('longTermReview', 'growthReview'))}
        self.assertEqual(breakout, expected)
        for code in expected:
            row = self.rows[code]
            self.assertFalse(row['longTermReview']['qualified'])
            self.assertFalse(row['growthReview']['qualified'])
            self.assertEqual(breakout_review(row, self.asof), row['breakoutReview'])
            live = self.live_rows[code]
            self.assertEqual(breakout_review(live, live['breakoutReview']['checkedAt']), live['breakoutReview'])
            self.assertTrue(all(c['reason'] for c in row['growthReview']['checks'] if not c['pass']))
        for code in ('002648', '603259'):
            self.assertFalse(self.rows[code]['breakoutReview']['qualified'])
            self.assertFalse(self.live_rows[code]['breakoutReview']['qualified'])

    def test_breakout_financial_growth_cannot_override_prices_or_unseparated_consolidation(self):
        for code in ('002384', '002266', '002756', '600111', '688766'):
            with self.subTest(code=code):
                review = self.rows[code]['breakoutReview']
                self.assertTrue(review['financialQualified'])
                self.assertFalse(review['qualified'])
                self.assertEqual(review['operatingReview']['breakoutDecision'], 'exclude')
                self.assertFalse(review['checks'][-1]['pass'])
                self.assertTrue(review['checks'][-1]['reason'])
                self.assertEqual(review, self.live_rows[code]['breakoutReview'])
        for change in ('missing', 'future', 'stale', 'no_source', 'prices'):
            row = copy.deepcopy(self.rows['601869'])
            review = row['qualityResearch']['earningsReview']
            if change == 'missing': row['qualityResearch'].pop('earningsReview')
            elif change == 'future': review['checkedAt'] = '2026-10-02'
            elif change == 'stale': review['reportPeriod'] = '2025-12-31'
            elif change == 'no_source': review['sourceUrls'] = ['https://example.com/unknown']
            elif change == 'prices': review['breakoutDecision'] = 'exclude'
            self.assertFalse(breakout_review(row, self.asof)['qualified'], change)

    def test_breakout_rejects_losses_declining_prior_quarter_and_missing_research(self):
        row = copy.deepcopy(self.rows['601869'])
        self.assertTrue(breakout_review(row, self.asof)['qualified'])
        row['latestFinancials']['netProfit'] = -1
        self.assertFalse(breakout_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601869'])
        prior = next(r for r in row['financialReports'] if r['reportDate'] == '2026-03-31')
        prior['deductedProfit'] = 1  # positive profit alone cannot conceal a collapse.
        self.assertFalse(breakout_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601869'])
        row['qualityResearch'].pop('breakout')
        self.assertFalse(breakout_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601869'])
        row['latestFinancials']['announcedAt'] = '2026-10-02'
        self.assertFalse(breakout_review(row, self.asof)['qualified'])
        row = copy.deepcopy(self.rows['601869'])
        row['latestFinancials']['operatingCashFlow'] = None
        self.assertFalse(breakout_review(row, self.asof)['qualified'])

    def test_breakout_requires_cash_conversion_and_two_doubling_quarters(self):
        row = copy.deepcopy(self.rows['601869'])
        row['latestFinancials']['operatingCashFlow'] = row['latestFinancials']['netProfit'] * .49
        self.assertFalse(breakout_review(row, self.asof)['financialQualified'])
        self.assertFalse(self.rows['002648']['breakoutReview']['financialQualified'])  # Q2 spike alone.
        self.assertFalse(self.rows['603259']['breakoutReview']['financialQualified'])  # Steady growth is not doubling.

    def test_reports_reproduce_have_source_links_and_cover_published_companies(self):
        reports = build(check_only=True)
        codes = {r['code'] for r in reports}
        manifest = json.loads((ROOT / 'data/stock-report-research.json').read_text())
        self.assertEqual(codes, {r['code'] for r in manifest['companies']})
        self.assertTrue({'300866', '001389', '688019', '688700', '688766'} <= codes)
        self.assertTrue({c for c, r in self.live_rows.items() if r['group'] != 'dividend'} <= codes)
        for report in reports:
            self.assertTrue((ROOT / report['markdownPath']).is_file())
            self.assertTrue(any(s['id'] == 'sources' and s['links'] for s in report['sections']))
        litong = next(r for r in reports if r['code'] == '603629')
        self.assertEqual(litong['groups'], [])
        self.assertIn('7.65%', json.dumps(litong, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
