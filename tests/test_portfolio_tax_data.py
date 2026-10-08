import unittest
from datetime import datetime, timezone
from scripts.build_portfolio_tax_data import from_chart


class DistributionEvidenceTests(unittest.TestCase):
    def payload(self, days, closes, dividends):
        stamp = lambda day: int(datetime.fromisoformat(day).replace(hour=20, tzinfo=timezone.utc).timestamp())
        return {'chart': {'result': [{'meta': {'symbol': 'TEST', 'currency': 'USD', 'exchangeTimezoneName': 'America/New_York'},
            'timestamp': [stamp(day) for day in days], 'indicators': {'quote': [{'close': closes}]},
            'events': {'dividends': {str(stamp(day)): {'date': stamp(day), 'amount': cash} for day, cash in dividends}}}]}}

    def evidence(self, payload, first='2025-01-02', end='2025-01-06'):
        return from_chart(payload, {'code': 'TEST', 'market': 'us', 'currency': 'USD'}, first, end, 'digest')

    def test_cash_distribution_uses_ex_date_close_and_not_adjusted_return_as_income(self):
        p = self.payload(['2025-01-02', '2025-01-03', '2025-01-06'], [100, 99, 110], [('2025-01-03', 1)])
        e = self.evidence(p)
        self.assertEqual(e['fractions'], {'2025-01-03': .01})
        self.assertEqual(e['sourceSha256'], 'digest')

    def test_explicit_no_distribution_is_distinct_from_missing_quotes(self):
        p = self.payload(['2025-01-02', '2025-01-06'], [100, 101], [])
        self.assertEqual(self.evidence(p)['fractions'], {})
        p['chart']['result'][0]['indicators']['quote'][0]['close'][0] = None
        with self.assertRaisesRegex(ValueError, '完整价格区间'):
            self.evidence(p)

    def test_unpriced_early_events_limit_tax_coverage_without_inventing_an_ex_date(self):
        p = self.payload(['2025-01-02', '2025-01-06'], [100, 101], [('2025-01-03', 1)])
        e = self.evidence(p)
        self.assertEqual(e['first'], '2025-01-06')
        self.assertEqual(e['fractions'], {})
        self.assertIn('2025-01-03', e['coverageWarning'])

    def test_bad_security_or_negative_distribution_is_rejected(self):
        p = self.payload(['2025-01-02', '2025-01-06'], [100, 101], [('2025-01-06', -1)])
        with self.assertRaisesRegex(ValueError, '金额无效'):
            self.evidence(p)
        p['chart']['result'][0]['meta']['currency'] = 'CNY'
        with self.assertRaisesRegex(ValueError, '身份或币种'):
            self.evidence(p)


if __name__ == '__main__':
    unittest.main()
