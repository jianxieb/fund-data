import io
import unittest
from unittest.mock import patch
from urllib.error import URLError

import overseas_stocks as source


class OverseasSourceRetry(unittest.TestCase):
    def test_transient_source_failure_retries_before_rejecting_the_stage(self):
        with patch.object(source.urllib.request, 'urlopen', side_effect=[URLError('timeout'), io.BytesIO(b'{"ok":true}')]) as fetch, \
             patch.object(source.time, 'sleep'):
            self.assertEqual(source.request_json('https://query1.finance.yahoo.com/v8/finance/chart/MSFT'), {'ok': True})
            self.assertEqual(fetch.call_count, 2)

    def test_failure_names_endpoint_without_exposing_session_query(self):
        with patch.object(source.urllib.request, 'urlopen', side_effect=URLError('timeout')), \
             patch.object(source.time, 'sleep'):
            with self.assertRaises(ValueError) as caught:
                source.request_json('https://query1.finance.yahoo.com/v7/finance/quote?crumb=private-session-value')
            self.assertIn('/v7/finance/quote', str(caught.exception))
            self.assertNotIn('private-session-value', str(caught.exception))

    def test_quote_session_retries_network_failures_but_not_bad_identity(self):
        with patch.object(source, '_fetch_quotes', side_effect=[URLError('timeout'), None]) as session, \
             patch.object(source.time, 'sleep'):
            source.fetch_quotes()
            self.assertEqual(session.call_count, 2)
        with patch.object(source, '_fetch_quotes', side_effect=ValueError('证券身份不完整')) as session:
            with self.assertRaises(ValueError):
                source.fetch_quotes()
            self.assertEqual(session.call_count, 1)


if __name__ == '__main__':
    unittest.main()
