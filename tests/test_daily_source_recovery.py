import io
import unittest
from datetime import datetime, timezone
from unittest.mock import call, patch
from urllib.error import URLError

import indices
import stock_screen


class IndexSourceRecoveryTests(unittest.TestCase):
    def test_connection_resets_recover_with_bounded_backoff(self):
        replies = [URLError('connection reset'), URLError('connection reset'), io.BytesIO(b'{"code":200}')]
        with patch.object(indices.urllib.request, 'urlopen', side_effect=replies) as fetch, \
                patch.object(indices.time, 'sleep') as sleep:
            self.assertEqual(indices.request_json(indices.CSI, timeout=15), {'code': 200})
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(3)])
        self.assertTrue(all(c.kwargs['timeout'] == 15 for c in fetch.call_args_list))

    def test_exhausted_requests_still_fail_instead_of_claiming_fresh_data(self):
        with patch.object(indices.urllib.request, 'urlopen', side_effect=URLError('connection reset')) as fetch, \
                patch.object(indices.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'connection reset'):
                indices.request_json(indices.CSI)
        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(sleep.call_args_list, [call(1), call(3), call(7)])


class StockQuoteRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.item = {'code': '123456', 'name': 'fixture', 'business': 'fixture', 'note': 'fixture'}
        self.stamp = datetime(2026, 10, 14, 7, tzinfo=timezone.utc).timestamp()
        self.alternate = {'series': [('2026-10-13', 100), ('2026-10-14', 102)],
                          'sourceUrl': 'https://example.com/123456',
                          'meta': {'regularMarketPrice': 12.5, 'regularMarketTime': self.stamp}}

    def fetch(self, quote, evidence):
        def response(url, **_):
            if 'push2.eastmoney' in url:
                if isinstance(quote, Exception):
                    raise quote
                return {'data': quote}
            if 'push2his' in url:
                return {'data': {'klines': ['2026-10-13,100', '2026-10-14,102']}}
            raise AssertionError('Unexpected endpoint: ' + url)

        with patch.object(stock_screen, 'fetch_evidence', return_value=evidence), \
                patch.object(stock_screen, 'fetch_json', side_effect=response), \
                patch.object(stock_screen, 'dividend_evidence', return_value={'yield12': 0, 'divYears': 0}), \
                patch.object(stock_screen, 'yahoo_stock', return_value=self.alternate) as yahoo:
            return stock_screen.fetch_stock(self.item), yahoo.call_count

    def test_preopen_zero_or_missing_quote_keeps_verified_dated_close(self):
        evidence = {'valuationPrice': 15.5, 'valuationAsOf': '2026-10-14'}
        for quote in ({'f43': 0, 'f86': self.stamp}, {}, URLError('quote timeout')):
            with self.subTest(quote=quote):
                row, alternate_calls = self.fetch(quote, evidence)
                self.assertEqual(alternate_calls, 0)
                self.assertEqual(row['price'], 15.5)
                self.assertEqual(row['priceAsOf'], '2026-10-14')
                self.assertEqual(row['quoteSource'], 'Eastmoney RPT_VALUEANALYSIS_DET dated close')
                self.assertEqual(row['returnAsOf'], '2026-10-14')

    def test_invalid_live_quote_uses_verified_alternate_when_dated_close_missing(self):
        for price in (0, -100, None, float('nan')):
            with self.subTest(price=price):
                row, alternate_calls = self.fetch({'f43': price, 'f86': self.stamp}, {})
                self.assertEqual(alternate_calls, 1)
                self.assertEqual(row['price'], 12.5)
                self.assertEqual(row['priceAsOf'][:10], '2026-10-14')
                self.assertEqual(row['quoteSource'], 'Yahoo Finance chart metadata')
                self.assertTrue(row['sourceFallbacks'])

    def test_no_valid_price_remains_a_failure(self):
        self.alternate['meta']['regularMarketPrice'] = 0
        with self.assertRaisesRegex(RuntimeError, '现价无效'):
            self.fetch({'f43': 0, 'f86': self.stamp}, {})


if __name__ == '__main__':
    unittest.main()
