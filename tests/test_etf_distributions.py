import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.build_etf_distributions import (ROOT, OUTPUT, parse_chart, build, read_js,
    validate, qii_evidence, cash_window, distribution_metrics, validate_metrics)


class EtfCashRecordsTests(unittest.TestCase):
    @staticmethod
    def stamp(day):
        return int(datetime.fromisoformat(day).replace(hour=20, tzinfo=timezone.utc).timestamp())

    def chart(self, amount=0.25):
        days = ['2025-01-02', '2025-01-03', '2025-01-06']
        return {'chart': {'result': [{'meta': {'symbol': 'TEST', 'currency': 'USD', 'exchangeTimezoneName': 'America/New_York'},
            'timestamp': [self.stamp(d) for d in days], 'indicators': {'quote': [{'close': [10, 11, 12]}]},
            'events': {'dividends': {'event': {'date': self.stamp('2025-01-03'), 'amount': amount}},
                       'splits': {'split': {'date': self.stamp('2025-01-06'), 'numerator': 2, 'denominator': 1}}}}]}}

    def parse(self, payload):
        return parse_chart(payload, 'TEST', '2025-01-02', '2025-01-06', 'a' * 64)

    def test_cash_amount_is_not_reconstructed_from_adjusted_prices_or_split_again(self):
        item = self.parse(self.chart())
        self.assertEqual(item['records'], [{'exDate': '2025-01-03', 'perShare': 0.25,
            'referenceDate': '2025-01-02', 'referencePrice': 10, 'pricePercent': 2.5,
            'subsequentSplit': True}])
        self.assertNotIn('payableDate', item['records'][0])
        self.assertEqual(item['splits'], [{'date': '2025-01-06', 'ratio': '2:1'}])
        self.assertAlmostEqual(item['metrics']['annual'][0]['cashReturn'], 2.5)
        self.assertAlmostEqual(item['metrics']['annual'][0]['totalReturn'], 22.5)

    def test_no_dividend_adjusted_close_is_used_for_cash_return(self):
        payload = self.chart()
        payload['chart']['result'][0]['indicators']['adjclose'] = [{'adjclose': [8, 9, 12]}]
        self.assertEqual(self.parse(payload)['metrics'], self.parse(self.chart())['metrics'])

    def test_single_payment_missing_prior_close_is_not_zero_percent(self):
        payload = self.chart()
        payload['chart']['result'][0]['events']['dividends']['event']['date'] = self.stamp('2025-01-02')
        row = self.parse(payload)['records'][0]
        self.assertIsNone(row['referencePrice'])
        self.assertIsNone(row['pricePercent'])

    def test_cash_distribution_yield_and_contribution_have_different_denominators(self):
        prices = {'2024-12-31': 100, '2025-06-30': 105, '2025-12-31': 110}
        records = [{'exDate': '2025-06-30', 'perShare': 5}]
        metrics = distribution_metrics(prices, records, '2024-12-31', '2025-12-31')
        t = metrics['trailing']
        self.assertAlmostEqual(t['rate'], 5 / 110 * 100)
        r = t['return']
        self.assertAlmostEqual(r['priceReturn'], 10)
        self.assertAlmostEqual(r['cashReturn'], 5)
        self.assertAlmostEqual(r['totalReturn'], 15)
        self.assertAlmostEqual(r['cashShareOfGain'], 100 / 3)

    def test_losses_zero_return_and_cash_share_above_100(self):
        records = [{'exDate': '2025-06-30', 'perShare': 5}]
        for closing, expected_total, expected_share in [(80, -15, None), (95, 0, None), (98, 3, 500 / 3)]:
            r = cash_window({'2024-12-31': 100, '2025-12-31': closing}, records, '2024-12-31', '2025-12-31')
            self.assertAlmostEqual(r['totalReturn'], expected_total)
            if expected_share is None:
                self.assertIsNone(r['cashShareOfGain'])
                self.assertTrue(r['shareReason'])
            else:
                self.assertAlmostEqual(r['cashShareOfGain'], expected_share)

    def test_ex_date_at_opening_close_is_not_income_to_new_buyer(self):
        r = cash_window({'2024-12-31': 100, '2025-12-31': 110}, [
            {'exDate': '2024-12-31', 'perShare': 10},
            {'exDate': '2025-12-31', 'perShare': 2},
            {'exDate': '2026-01-02', 'perShare': 20}], '2024-12-31', '2025-12-31')
        self.assertEqual(r['cashPerShare'], 2)
        self.assertEqual(r['payments'], 1)

    def test_short_history_partial_year_and_leap_day_do_not_invent_full_year(self):
        metrics = distribution_metrics({'2024-01-02': 10, '2024-02-29': 12},
            [{'exDate': '2024-02-29', 'perShare': .1}], '2024-01-02', '2024-02-29')
        self.assertEqual(metrics['trailing']['startExclusive'], '2023-02-28')
        self.assertIsNone(metrics['trailing']['rate'])
        self.assertEqual(metrics['trailing']['return']['status'], 'missing')
        r = metrics['annual'][0]
        self.assertTrue(r['partialStart'])
        self.assertTrue(r['yearToDate'])
        self.assertAlmostEqual(r['totalReturn'], 21, msg='partial year must remain cumulative, not annualized')

    def test_stale_endpoint_is_not_substituted_for_current_price(self):
        r = cash_window({'2024-12-01': 100, '2025-12-31': 110}, [], '2024-12-31', '2025-12-31')
        self.assertEqual(r['status'], 'missing')
        self.assertIn('2024-12-31', r['reason'])

    def test_validation_reconciles_percentages_and_rejects_invalid_prices(self):
        item = self.parse(self.chart())
        validate_metrics(item)
        bad = copy.deepcopy(item)
        bad['metrics']['annual'][0]['cashReturn'] += 1
        with self.assertRaisesRegex(ValueError, '对账'):
            validate_metrics(bad)
        bad = copy.deepcopy(item)
        bad['metrics']['annual'][0]['openingPrice'] = 0
        with self.assertRaisesRegex(ValueError, '首末价格'):
            validate_metrics(bad)

    def test_zero_event_is_not_cash_payment_or_missing_data(self):
        item = self.parse(self.chart(0))
        self.assertEqual(item['status'], 'no_events')
        self.assertEqual(item['records'], [])
        payload = self.chart()
        payload['chart']['result'][0]['timestamp'].pop()
        with self.assertRaises(ValueError):
            self.parse(payload)

    def test_rejects_wrong_security_negative_cash_and_unpriced_event(self):
        with self.assertRaisesRegex(ValueError, '金额'):
            self.parse(self.chart(-1))
        payload = self.chart()
        payload['chart']['result'][0]['meta']['symbol'] = 'QQQ'
        with self.assertRaisesRegex(ValueError, '身份'):
            self.parse(payload)
        payload = self.chart()
        payload['chart']['result'][0]['events']['dividends']['event']['date'] = self.stamp('2025-01-04')
        with self.assertRaisesRegex(ValueError, '缺行情'):
            self.parse(payload)

    def test_missing_cache_preserves_actual_prior_date_and_names_gap(self):
        prior = {'products': {'TEST': self.parse(self.chart())}}
        products = [{'symbol': 'TEST', 'distribution': '季度', 'sourceUrl': 'https://example.com/issuer'}]
        assets = {'us:TEST': {'first': '2025-01-02', 'asOf': '2025-01-07'}}
        with tempfile.TemporaryDirectory() as tmp:
            result = build(products, assets, prior, Path(tmp))
            self.assertEqual(result['products']['TEST']['through'], '2025-01-06')
            self.assertEqual(result['products']['TEST']['status'], 'stale')
            self.assertIn('2025-01-06', result['products']['TEST']['missingEvidence'])
            with self.assertRaisesRegex(ValueError, '无可发布现金记录'):
                build(products, assets, {}, Path(tmp))

    def test_published_coverage_and_issuer_evidence_are_reproducible_without_cache(self):
        products = json.loads((ROOT / 'data/overseas-etf-catalog.json').read_text())['products']
        assets = {a['id']: a for a in read_js(ROOT / 'data/portfolio/catalog.js')['assets']}
        data = read_js(OUTPUT)
        validate(data, products, assets)
        self.assertEqual(data['qiiEvidence'], qii_evidence())
        self.assertEqual(data['qiiEvidence']['taxYear'], 2025)
        self.assertEqual(data['qiiEvidence']['products']['TIP']['positivePayments'], 10)
        self.assertEqual(data['qiiEvidence']['products']['SGOV']['positivePayments'], 12)
        self.assertEqual(set(data['qiiEvidence']['products']), {p['symbol'] for p in products if p['section'] == 'treasury'})
        bad = copy.deepcopy(data)
        bad['products']['QQQ']['records'][0]['payableDate'] = '2026-10-13'
        with self.assertRaisesRegex(ValueError, '支付日'):
            validate(bad, products, assets)


if __name__ == '__main__':
    unittest.main()
