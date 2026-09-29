import copy
import unittest
from datetime import date, timedelta

from stock_valuations import percentile_evidence
from scripts.build_stock_pe_legacy import archive_record


class StockValuationTests(unittest.TestCase):
    def setUp(self):
        day, self.quotes = date(2016, 9, 26), []
        while day <= date(2026, 9, 29):
            if day.weekday() < 5:
                self.quotes.append({'SECUCODE': '300274.SZ', 'SECURITY_CODE': '300274',
                                    'TRADE_DATE': day.isoformat(), 'PE_TTM': 10 if day.year >= 2021 else 30})
            day += timedelta(days=1)
        self.quotes[-1]['PE_TTM'] = 20

    def test_five_and_ten_years_use_distinct_daily_ttm_windows(self):
        result = percentile_evidence('300274', self.quotes, 20, '2026-09-29', {})
        self.assertEqual(result['5']['status'], 'available')
        self.assertGreater(result['5']['value'], 99)
        self.assertGreater(result['10']['value'], 50)
        self.assertLess(result['10']['value'], 60)
        self.assertEqual(result['10']['observedStart'], '2016-09-29')

    def test_duplicates_future_observations_and_loss_pe_do_not_bias_rank(self):
        quotes = [{**r, 'PE_TTM': 20} for r in self.quotes]
        quotes[100]['PE_TTM'], quotes[101]['PE_TTM'] = -1, None
        future = {**quotes[-1], 'TRADE_DATE': '2027-01-01', 'PE_TTM': 1}
        a = percentile_evidence('300274', quotes, 20, '2026-09-29', {})
        b = percentile_evidence('300274', quotes + [quotes[-1], future], 20, '2026-09-29', {})
        self.assertEqual(a, b)
        self.assertEqual(a['10']['value'], 50)
        self.assertEqual(a['10']['excluded'], 2)
        loss = percentile_evidence('300274', quotes, -1, '2026-09-29', {})
        self.assertEqual(loss['5']['status'], 'loss')
        self.assertIsNone(loss['5']['value'])
        with self.assertRaisesRegex(ValueError, '冲突'):
            percentile_evidence('300274', quotes + [{**quotes[-1], 'PE_TTM': 1}], 20, '2026-09-29', {})

    def test_partial_stale_wrong_identity_and_long_gaps_are_rejected(self):
        recent = [r for r in self.quotes if r['TRADE_DATE'] >= '2018-01-01']
        result = percentile_evidence('300274', recent, 20, '2026-09-29', {})
        self.assertEqual(result['5']['status'], 'available')
        self.assertEqual(result['10']['status'], 'short_history')
        self.assertIsNone(result['10']['value'])
        stale = percentile_evidence('300274', recent[:-1], 20, '2026-09-29', {})
        self.assertEqual(stale['5']['status'], 'stale_history')
        gap = [r for r in self.quotes if not '2022-01-01' <= r['TRADE_DATE'] <= '2022-05-01']
        self.assertEqual(percentile_evidence('300274', gap, 20, '2026-09-29', {})['5']['status'], 'history_gaps')
        with self.assertRaisesRegex(ValueError, '身份'):
            percentile_evidence('600519', self.quotes, 20, '2026-09-29', {})

    def test_supplement_is_checked_and_cannot_replace_modern_values(self):
        modern = [r for r in self.quotes if r['TRADE_DATE'] >= '2018-01-01']
        raw = {'date': [r['TRADE_DATE'] for r in self.quotes], 'pe_ttm': [r['PE_TTM'] for r in self.quotes]}
        raw['pe_ttm'][-1] = 999  # Stale or inconsistent recent values are never imported.
        record = archive_record('300274', raw, modern, '2026-09-29')
        self.assertEqual(record['crossCheck']['status'], 'accepted')
        self.assertTrue(all(d < '2018-01-01' for d, _ in record['rows']))
        result = percentile_evidence('300274', modern, 20, '2026-09-29', {'300274': record})
        self.assertEqual(result['10']['value'], percentile_evidence('300274', self.quotes, 20, '2026-09-29', {})['10']['value'])
        conflict = copy.deepcopy(raw)
        conflict['pe_ttm'] = [v * 1.2 for v in conflict['pe_ttm']]
        rejected = archive_record('300274', conflict, modern, '2026-09-29')
        self.assertEqual(rejected['crossCheck']['status'], 'conflict')
        self.assertEqual(rejected['rows'], [])
        result = percentile_evidence('300274', modern, 20, '2026-09-29', {'300274': rejected})
        self.assertEqual(result['10']['status'], 'source_conflict')
        self.assertEqual(result['5']['status'], 'available')


if __name__ == '__main__':
    unittest.main()
