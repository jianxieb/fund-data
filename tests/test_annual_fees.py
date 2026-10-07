import math
import unittest
from unittest.mock import patch

import annual_fees
import strategy_backtest as strategy


class AnnualFeeEstimates(unittest.TestCase):
    def test_qqqm_is_a_distinct_lower_fee_nasdaq_product(self):
        qqqm, qqq = annual_fees.fee_metadata('QQQM'), annual_fees.fee_metadata('QQQ')
        self.assertEqual(qqqm['section'], 'other')
        self.assertEqual(qqqm['underlying'], qqq['underlying'])
        self.assertEqual(qqqm['inception'], '2020-10-13')
        self.assertEqual(qqqm['expenseRatio'], .15)
        self.assertEqual(qqqm['feeCheckedAt'], '2026-10-07')
        self.assertLess(qqqm['expenseRatio'], qqq['expenseRatio'])

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
        asset = {'c': 'SPY'}
        with patch.object(strategy, 'strategy_inputs', wraps=strategy.strategy_inputs) as inputs:
            result, curves = strategy.build_results(dates, prices, [asset], before_fees=True)
        inputs.assert_called_once_with(prices['SPY'], dates)
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
