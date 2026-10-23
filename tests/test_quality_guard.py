import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from company_selection import assess
from overseas_research import profit_bridge
from quality_guard import operating_trend, quality_checks

ROOT = Path(__file__).resolve().parents[1]


class QualityGuardTests(unittest.TestCase):
    def quarters(self):
        return [dict(period=day, profit=p, revenue=100, profitPrevious=20, revenuePrevious=100)
                for day, p in [('2026-03-31', 18), ('2026-06-30', 15)]]

    def trend(self, rows=None):
        return operating_trend(self.quarters() if rows is None else rows, '2026-06-30', '核心利润')

    def test_persistent_operating_deterioration_blocks_even_positive_profit_and_cash(self):
        trend = self.trend()
        self.assertFalse(trend['qualified'])
        self.assertEqual(trend['status'], 'deteriorating')
        self.assertAlmostEqual(trend['quarters'][-1]['marginChangePp'], -5)
        self.assertIn('2026-03-31', trend['reason'])
        self.assertIn('2026-06-30', trend['reason'])

    def test_slow_growth_or_one_bad_quarter_does_not_imply_persistent_deterioration(self):
        rows = self.quarters()
        rows[-1]['profit'] = 20.01
        self.assertTrue(self.trend(rows)['qualified'])
        rows[-1].update(profit=18, revenue=80)  # Falling profit but expanding margin.
        self.assertTrue(self.trend(rows)['qualified'])

    def test_missing_prior_amount_nonpositive_base_and_nonadjacent_periods_do_not_pass(self):
        for key, value in [('profitPrevious', None), ('revenuePrevious', 0), ('profit', -1)]:
            rows = self.quarters(); rows[-1][key] = value
            trend = self.trend(rows)
            self.assertFalse(trend['qualified'])
            self.assertIn('2026-06-30', trend['reason'])
        rows = self.quarters(); rows[0]['period'] = '2025-12-31'
        self.assertIn('相邻', self.trend(rows)['reason'])
        self.assertFalse(self.trend(rows[:-1])['qualified'])

    def test_open_challenge_cannot_be_closed_by_a_bare_label_or_future_evidence(self):
        challenge = dict(openedAt='2026-10-23', status='unresolved', question='缺付费留存和定价证据')
        record = {'qualityChallenges': [challenge]}
        trend = {'qualified': True}
        self.assertFalse(quality_checks(record, trend, '2026-10-23', {'filing'})[-1]['pass'])
        challenge.update(status='resolved', resolution='本期复核', resolvedAt='2026-10-24', resolutionSourceUrls=['filing'])
        self.assertFalse(quality_checks(record, trend, '2026-10-23', {'filing'})[-1]['pass'])
        challenge['resolvedAt'] = '2026-10-23'
        self.assertFalse(quality_checks(record, trend, '2026-10-23', {'different-filing'})[-1]['pass'])
        self.assertTrue(quality_checks(record, trend, '2026-10-23', {'filing'})[-1]['pass'])

    def test_same_normalized_trend_has_same_veto_in_both_markets(self):
        source = dict(url='filing', reportPeriod='2026-06-30', publishedAt='2026-08-01')
        record = dict(reviewedAt='2026-10-23', reportPeriod='2026-06-30', groups=['quality'],
                      sources=[source], evidence=[dict(label='金额', unit='USD', value=1, sourceUrl='filing', location='利润表')]*2,
                      risk='竞争', invalidation='经营恶化', rationale='历史现金为正')
        annual = [dict(period=f'{year}-12', profit=100, cash=120) for year in range(2021, 2026)]
        for market in ['us', 'cn']:
            with patch('company_selection.json.loads', return_value={'companies': {market+':TEST': record}}):
                result = assess('TEST', market, '2026-06-30', '2026-10-23', 100, 120, annual,
                                published_at='2026-08-01', quality_trend=self.trend())
                self.assertNotIn('quality', result['groups'])
                self.assertIn('连续两季', result['rationale'])


class DatedReassessmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = json.loads((ROOT/'tests/fixtures/quality-reassessment-20261023.json').read_text())
        cls.records = fixture['companies']
        cls.research = fixture['research']

    def setUp(self):
        source = patch('company_selection.PATH', ROOT/'tests/fixtures/quality-reassessment-20261023.json')
        source.start()
        self.addCleanup(source.stop)

    def sample(self, symbol):
        record = self.records['us:'+symbol]
        return dict(financials={'reportDate': record['reportPeriod'],
                               'TotalOperatingIncomeAsReported': self.research[symbol]['profitBridge']['operatingIncome'],
                               'NetIncome': self.research[symbol]['profitBridge']['netIncome']},
                    financialCurrency='USD', research=deepcopy(self.research[symbol]))

    def test_withdrawals_preserve_the_previous_decision_and_reject_restored_approval(self):
        annual = [dict(period=f'{year}-12', profit=100, cash=120) for year in range(2021, 2026)]
        for symbol in ['ADBE', 'QCOM']:
            rec = self.records['us:'+symbol]
            old = assess(symbol, 'us', rec['reportPeriod'], '2026-10-22', 100, 120, annual,
                         published_at=rec['sources'][0]['publishedAt'])
            self.assertIn('quality', old['groups'])
            restored = deepcopy(rec); restored['groups'] = ['quality']
            with patch('company_selection.json.loads', return_value={'companies': {'us:'+symbol: restored}}):
                current = assess(symbol, 'us', rec['reportPeriod'], '2026-10-23', 100, 120, annual,
                                 published_at=rec['sources'][0]['publishedAt'], quality_trend={'qualified': True})
                self.assertNotIn('quality', current['groups'])
                self.assertIn('尚未解决', current['rationale'])

    def test_both_bridges_reconcile_and_new_filings_cannot_inherit_old_explanations(self):
        for symbol in ['ADBE', 'QCOM']:
            row = self.sample(symbol)
            bridge = profit_bridge(row, '2026-10-23')
            self.assertEqual(bridge['status'], 'reconciled')
            self.assertEqual(bridge['operatingIncome'] + sum(x['value'] for x in bridge['adjustments']), bridge['netIncome'])
            self.assertEqual(profit_bridge(row, '2026-10-22')['status'], 'missing')
            row['financials']['reportDate'] = '2026-09-30'
            self.assertEqual(profit_bridge(row, '2026-10-23')['status'], 'missing')

    def test_mismatched_currency_amount_or_unbalanced_adjustment_is_not_an_explanation(self):
        for case in ['amount', 'currency', 'adjustment']:
            row = self.sample('QCOM')
            if case == 'amount': row['financials']['NetIncome'] += 1e6
            elif case == 'currency': row['financialCurrency'] = 'TWD'
            else: row['research']['profitBridge']['adjustments'][0]['value'] += 1e6
            self.assertEqual(profit_bridge(row, '2026-10-23')['status'], 'missing')


if __name__ == '__main__':
    unittest.main()
