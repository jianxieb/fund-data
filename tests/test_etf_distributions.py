import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.build_etf_distributions import ROOT, OUTPUT, parse_chart, build, read_js, validate, qii_evidence


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
        self.assertEqual(item['records'], [{'exDate': '2025-01-03', 'perShare': 0.25, 'subsequentSplit': True}])
        self.assertNotIn('payableDate', item['records'][0])
        self.assertEqual(item['splits'], [{'date': '2025-01-06', 'ratio': '2:1'}])

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
