import copy
import hashlib
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from scripts import build_drop_highs as high


def fixture(symbol='^NDX'):
    dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09']
    stamps = [int(datetime.fromisoformat(day + 'T14:30:00+00:00').timestamp()) for day in dates]
    closes, highs = [100, 90, 95, 99], [101, 101, 102, 100]
    node = {'meta': {'symbol': symbol, 'currency': 'USD', 'instrumentType': 'INDEX',
                     'exchangeTimezoneName': 'America/New_York'}, 'timestamp': stamps,
            'indicators': {'adjclose': [{'adjclose': closes}], 'quote': [{'close': closes, 'high': highs}]}}
    published = {'schemaVersion': 1, 'id': 'index:' + symbol, 'currency': 'USD',
                 'basis': 'price_index', 'dividends': 'excluded', 'first': dates[0], 'asOf': dates[-1],
                 'series': list(map(list, zip(dates, closes))), 'historyUrl': 'data/return-comparison/NDX.json',
                 'sha256': 'b' * 64}
    observed = datetime(2025, 1, 10, 12, tzinfo=timezone.utc)
    return node, published, observed


def normalize(node, published, observed):
    return high.normalize(node, node['meta']['symbol'], 'https://query1.finance.yahoo.com/v8/finance/chart/' + node['meta']['symbol'],
                          published, observed, 'a' * 64)


class DropHighTests(unittest.TestCase):
    def test_highs_remain_actual_highs_and_keep_same_bar_close_evidence(self):
        node, published, observed = fixture()
        result = normalize(node, published, observed)
        self.assertEqual(result['series'], [['2025-01-06', 101], ['2025-01-07', 101], ['2025-01-08', 102], ['2025-01-09', 100]])
        self.assertEqual(result['closes'], published['series'])
        self.assertEqual(result['field'], 'indicators.quote[0].high')
        self.assertTrue(result['closedSessionsOnly'])
        self.assertEqual(result['closeValidation']['sha256'], published['sha256'])
        self.assertEqual(result['fetchedAt'], observed.isoformat())

    def test_missing_or_inconsistent_highs_never_use_close_as_a_substitute(self):
        for bad, reason in [(None, 'missing_or_invalid_high_or_close'), (94, 'high_below_same_bar_close'), (float('nan'), 'missing_or_invalid_high_or_close')]:
            node, published, observed = fixture()
            node['indicators']['quote'][0]['high'][2] = bad
            result = normalize(node, published, observed)
            self.assertNotIn('2025-01-08', dict(result['series']))
            self.assertIn({'date': '2025-01-08', 'reason': reason, 'sourceClose': 95, 'publishedClose': 95}, result['missingObservations'])
        node, published, observed = fixture()
        del node['indicators']['quote'][0]['high']
        with self.assertRaisesRegex(ValueError, '最高价'):
            normalize(node, published, observed)

    def test_quote_identity_and_close_revisions_cannot_silently_mix_sources(self):
        node, published, observed = fixture()
        published['series'][2][1] = 95.004
        self.assertIn('2025-01-08', dict(normalize(node, published, observed)['series']))
        published['series'][2][1] = 95.006
        result = normalize(node, published, observed)
        self.assertNotIn('2025-01-08', dict(result['series']))
        self.assertTrue(any(row['reason'] == 'published_close_mismatch' for row in result['missingObservations']))
        node['meta']['instrumentType'] = 'ETF'
        with self.assertRaisesRegex(ValueError, '指数身份'):
            normalize(node, published, observed)
        node['meta']['instrumentType'] = 'INDEX'
        with self.assertRaisesRegex(ValueError, '标的标识'):
            high.normalize(node, '^GSPC', 'url', published, observed)

    def test_unclosed_and_post_market_quotes_do_not_enter_daily_highs(self):
        node, published, _ = fixture()
        node['meta']['currentTradingPeriod'] = {'regular': {'end': int(datetime(2025, 1, 9, 21, tzinfo=timezone.utc).timestamp())}}
        live = normalize(node, published, datetime(2025, 1, 9, 20, tzinfo=timezone.utc))
        self.assertEqual(live['asOf'], '2025-01-08')
        closed = normalize(node, published, datetime(2025, 1, 9, 22, tzinfo=timezone.utc))
        self.assertEqual(closed['asOf'], '2025-01-09')
        node['timestamp'][-1] += 8 * 3600
        self.assertEqual(normalize(node, published, datetime(2025, 1, 9, 23, tzinfo=timezone.utc))['asOf'], '2025-01-08')

    def test_failed_or_truncated_refresh_preserves_values_source_dates_and_original_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / 'data' / 'return-comparison'
            folder.mkdir(parents=True)
            node, published, observed = fixture()
            close = {k: v for k, v in published.items() if k not in ('historyUrl', 'sha256')}
            text = high.encode(close)
            (folder / 'NDX.json').write_text(text)
            row = {**published, 'code': '^NDX', 'name': '纳斯达克100', 'kind': 'index', 'status': 'available',
                   'sha256': hashlib.sha256(text.encode()).hexdigest()}
            (folder / 'catalog.json').write_text(high.encode({'schemaVersion': 1, 'assets': [row]}))
            def saved(value):
                raw = high.encode({'chart': {'result': [value]}})
                return {'raw': raw, 'sourceUrl': 'https://query1.finance.yahoo.com/v8/finance/chart/^NDX',
                        'fetchedAt': observed.isoformat(), 'sha256': hashlib.sha256(raw.encode()).hexdigest()}
            with patch.multiple(high, ROOT=root, OUT=root / 'data' / 'drop-study', CACHE=root / 'cache', SYMBOLS=('^NDX',)):
                with patch.object(high, 'source', return_value=saved(node)):
                    original = high.build()[0]
                data_path = root / original['historyUrl']
                original_bytes = data_path.read_bytes()
                with patch.object(high, 'source', side_effect=TimeoutError('source timed out')):
                    retained = high.build(refresh=True)[0]
                self.assertEqual(data_path.read_bytes(), original_bytes)
                self.assertEqual(retained['asOf'], original['asOf'])
                self.assertEqual(retained['fetchedAt'], original['fetchedAt'])
                self.assertIn('timed out', retained['refreshMissing'])
                truncated = copy.deepcopy(node)
                truncated['indicators']['quote'][0]['high'][1] = None
                with patch.object(high, 'source', return_value=saved(truncated)):
                    retained = high.build(refresh=True)[0]
                self.assertEqual(retained['sha256'], original['sha256'])
                self.assertIn('缺少已保存', retained['refreshMissing'])
                self.assertEqual(data_path.read_bytes(), original_bytes)
                high.check()
                data_path.write_text('{}')
                with patch.object(high, 'source', side_effect=TimeoutError('source timed out')):
                    broken = high.build(refresh=True)[0]
                self.assertEqual(broken['status'], 'unavailable')
                self.assertIn('旧记录无效', broken['missing'])
                with patch.object(high, 'source', return_value=saved(node)):
                    restored = high.build(refresh=True)[0]
                self.assertEqual(restored['status'], 'available')
                high.check()

    def test_published_highs_have_real_matching_price_index_evidence(self):
        rows = high.check()
        indices = {row['id']: row for row in json.loads((high.ROOT / 'data/return-comparison/catalog.json').read_text())['assets']}
        for row in rows:
            self.assertEqual(row['status'], 'available')
            history = high.read_existing(row)
            current = dict(high.read_published(indices[row['id']])['series'])
            self.assertEqual(history['first'], '1990-01-02')
            for day, close in history['closes']:
                if day in current and history['closeValidation']['sha256'] == indices[row['id']]['sha256']:
                    self.assertLessEqual(abs(close - current[day]), high.CLOSE_TOLERANCE + math.ulp(float(close)) * 4)


if __name__ == '__main__':
    unittest.main()
