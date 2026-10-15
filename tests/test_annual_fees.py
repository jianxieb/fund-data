import math
import unittest
from unittest.mock import patch

import annual_fees
import strategy_backtest as strategy


class AnnualFeeEstimates(unittest.TestCase):
    def test_momentum_funds_keep_their_own_identity_and_enter_scheduled_updates(self):
        from update import BM_DEFS
        expected = {'SPMO': (.13, '2015-10-09'), 'MTUM': (.15, '2013-04-16'),
                    'XMMO': (.34, '2005-03-03'), 'FDMO': (.15, '2016-09-12')}
        for symbol, (fee, inception) in expected.items():
            with self.subTest(symbol=symbol):
                data = annual_fees.fee_metadata(symbol)
                self.assertEqual((data['expenseRatio'], data['inception']), (fee, inception))
                self.assertEqual(data['category'], '动量策略')
                self.assertEqual(data['section'], 'other')
                self.assertEqual(data['leverage'], 1)
                self.assertEqual(data['feeCheckedAt'], '2026-10-15')
                self.assertIn('Momentum', data['underlying'])
                self.assertEqual([row[0] for row in BM_DEFS].count(symbol), 1)
        self.assertEqual(annual_fees.fee_metadata('MTUM')['currentIndexSince'], '2020-11-23')
        self.assertEqual(annual_fees.fee_metadata('XMMO')['currentIndexSince'], '2019-06-24')

    def test_qqqm_is_a_distinct_lower_fee_nasdaq_product(self):
        qqqm, qqq = annual_fees.fee_metadata('QQQM'), annual_fees.fee_metadata('QQQ')
        self.assertEqual(qqqm['section'], 'main')
        self.assertEqual(qqqm['underlying'], qqq['underlying'])
        self.assertEqual(qqqm['inception'], '2020-10-13')
        self.assertEqual(qqqm['expenseRatio'], .15)
        self.assertEqual(qqqm['feeCheckedAt'], '2026-10-07')
        self.assertLess(qqqm['expenseRatio'], qqq['expenseRatio'])
        from update import BM_DEFS
        self.assertEqual([row[0] for row in BM_DEFS].count('QQQM'), 1)

    def test_calendar_accrual_matches_browser_math_including_leap_day(self):
        actual = annual_fees.addback_factor(1.7, '2020-01-01', '2021-01-01')
        expected = math.pow(1 - 0.017 / 365.2425, -366)
        self.assertAlmostEqual(actual, expected, places=12)
        self.assertEqual(annual_fees.addback_factor(0, '2020-01-01', '2021-01-01'), 1)
        for rate in (None, -1, 100, math.nan):
            with self.assertRaises(ValueError):
                annual_fees.addback_factor(rate, '2020-01-01', '2021-01-01')

    def test_split_investment_leaves_uninvested_cash_without_fee_addback(self):
        dates = ['2020-01-01', '2020-07-01', '2021-01-01']
        prices = [100, 100, 100]
        with patch.dict(annual_fees.ETFS, {'SPY': {'expenseRatio': 10}}):
            gross_prices = annual_fees.before_fee_prices(dates, prices, 'SPY')
        result = strategy.simulate(dates, gross_prices, {0: 50, 1: 50}, initial_capital=100)
        expected = 50 * math.pow(1 - 0.1 / 365.2425, -366) + 50 * math.pow(1 - 0.1 / 365.2425, -184)
        self.assertAlmostEqual(result['end_value'], expected, places=8)
        self.assertLess(result['end_value'], 100 * gross_prices[-1] / gross_prices[0])

    def test_fee_scenario_preserves_real_market_signal_and_contribution_schedule(self):
        dates = ['2020-01-01', '2020-02-03', '2021-01-01']
        prices = {'SPY': [100, 70, 100]}
        warmup = {'SPY': [90] * 199 + [100]}
        asset = {'c': 'SPY'}
        with patch.object(strategy, 'strategy_inputs', wraps=strategy.strategy_inputs) as inputs:
            result, curves = strategy.build_results(dates, prices, [asset], before_fees=True, warmup=warmup)
        inputs.assert_called_once_with(prices['SPY'], dates, warmup['SPY'])
        self.assertEqual(len(result), len(strategy.STRATEGIES))
        self.assertEqual(curves['dates'][0], dates[0])

    def test_semiconductor_fee_and_benchmark_identity_are_not_inferred_from_SOXX(self):
        self.assertEqual(annual_fees.fee_metadata('USD')['underlying'], 'Dow Jones U.S. Semiconductors Index')
        soxl = annual_fees.fee_metadata('SOXL')
        self.assertEqual(soxl['expenseRatio'], 0.75)
        self.assertEqual(soxl['feeAddbackRate'], 0.71)
        self.assertEqual(annual_fees.fee_metadata('QQQI')['style'], '主动期权')
        metadata = annual_fees.fee_metadata('QQQI')
        self.assertNotIn('sourceUrl', metadata)
        self.assertEqual(metadata['identityUrl'], metadata['feeSourceUrl'])


if __name__ == '__main__':
    unittest.main()
