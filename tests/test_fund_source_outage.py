import errno
import io
import json
import tempfile
import threading
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import update


class FundPageHostOutageTests(unittest.TestCase):
    def setUp(self):
        for target, value in [('OFFLINE', False), ('_unavailable_metadata_hosts', set())]:
            replacement = patch.object(update, target, value)
            replacement.start()
            self.addCleanup(replacement.stop)

    def unavailable(self):
        return urllib.error.URLError(OSError(errno.ENETUNREACH, 'Network is unreachable'))

    def test_unreachable_metadata_host_does_not_repeat_for_each_fund_or_block_nav(self):
        with patch.object(update.urllib.request, 'urlopen', side_effect=self.unavailable()) as network, \
             patch.object(update.time, 'sleep') as sleep:
            for code in range(46):
                self.assertIsNone(update.http_get('https://fundf10.eastmoney.com/jjfl_%06d.html' % code, tries=4))
            self.assertEqual(network.call_count, 1)
            sleep.assert_not_called()
            network.side_effect = lambda *args, **kwargs: io.BytesIO(b'{"NAV":1.5}')
            self.assertEqual(update.http_get('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList'), '{"NAV":1.5}')
            # A fresh process has no remembered outage and probes the host again.
            with patch.object(update, '_unavailable_metadata_hosts', set()):
                self.assertEqual(update.http_get('https://fundf10.eastmoney.com/fhsp_000001.html'), '{"NAV":1.5}')

    def test_concurrent_failures_stop_after_the_requests_already_in_flight(self):
        barrier = threading.Barrier(3)
        def request(*args, **kwargs):
            barrier.wait(timeout=5)
            raise self.unavailable()
        with patch.object(update.urllib.request, 'urlopen', side_effect=request) as network, \
             patch.object(update.time, 'sleep') as sleep, ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda code: update.http_get(
                'https://fundf10.eastmoney.com/fhsp_%06d.html' % code, tries=3), range(395)))
            self.assertTrue(all(result is None for result in results))
            self.assertEqual(network.call_count, 3)
            sleep.assert_not_called()

    def test_timeouts_exhaust_normal_retries_but_http_errors_do_not_disable_the_host(self):
        url = 'https://fundf10.eastmoney.com/fhsp_000001.html'
        with patch.object(update.urllib.request, 'urlopen', side_effect=TimeoutError('timed out')) as network, \
             patch.object(update.time, 'sleep') as sleep:
            self.assertIsNone(update.http_get(url, tries=3))
            self.assertEqual(network.call_count, 3)
            self.assertEqual(sleep.call_count, 2)
            self.assertIsNone(update.http_get(url.replace('000001', '000002')))
            self.assertEqual(network.call_count, 3)
        with patch.object(update, '_unavailable_metadata_hosts', set()), \
             patch.object(update.urllib.request, 'urlopen', side_effect=[
                 urllib.error.HTTPError(url, 503, 'unavailable', {}, None), io.BytesIO(b'page')]) as network, \
             patch.object(update.time, 'sleep'):
            self.assertEqual(update.http_get(url), 'page')
            self.assertEqual(network.call_count, 2)
            self.assertEqual(update._unavailable_metadata_hosts, set())

    def test_outage_keeps_archive_dates_and_requires_evidence_for_new_navs(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'fund-actions.json'
            source = {'sourceUrl': 'https://fundf10.eastmoney.com/fhsp_513100.html',
                      'sourceSha256': 'a' * 64, 'observedAt': '2026-10-22', 'dividends': {}, 'splits': {}}
            archive.write_text(json.dumps({'funds': {'513100': source}}))
            original = archive.read_bytes()
            rows = [{'FSRQ': '2026-10-22', 'DWJZ': 1},
                    {'FSRQ': '2026-10-23', 'DWJZ': 1.1, 'JZZZL': 10}]
            with patch.object(update, 'ACTION_ARCHIVE', str(archive)), \
                 patch.object(update, 'FHSP_DIR', directory), \
                 patch.object(update.urllib.request, 'urlopen', side_effect=self.unavailable()) as network:
                enriched = update.attach_corporate_actions('513100', rows)
                self.assertEqual(enriched[0]['ACTIONS_ASOF'], '2026-10-22')
                self.assertNotIn('ACTIONS_ASOF', enriched[1])
                self.assertAlmostEqual(update.total_return_series(enriched)[-1][1], 1.1)
                rows[1].pop('JZZZL')
                with self.assertRaisesRegex(ValueError, '缺少每日收益'):
                    update.total_return_series(update.attach_corporate_actions('513100', rows))
                self.assertEqual(network.call_count, 1)
                self.assertEqual(archive.read_bytes(), original)
                self.assertFalse((Path(directory) / 'fhsp_513100.html').exists())


if __name__ == '__main__':
    unittest.main()
