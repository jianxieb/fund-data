import unittest

from scripts import check_refresh


class RefreshGateTests(unittest.TestCase):
    def test_rejects_missing_or_failed_refresh_stage(self):
        steps = [dict(dataset=name, status='completed', exitCode=0) for name in check_refresh.EXPECTED_STEPS]
        self.assertEqual(check_refresh.check_results({'status': 'completed', 'steps': steps},
                                                      {'summary': {'errors': 0}}), [])
        steps[1]['exitCode'] = 1
        self.assertTrue(any('indices' in item for item in check_refresh.check_results(
            {'status': 'partial', 'steps': steps}, {'summary': {'errors': 0}})))

    def test_rejects_date_regression_and_changed_identity_set(self):
        before = {'FUNDS': [dict(c='000001', navdate='2026-09-21', returnAsOf='2026-09-21')],
                  'INDEX_DATA': [dict(c='399001', asof='2026-09-21')],
                  'META': {'navdate': '2026-09-21'}}
        after = {'FUNDS': [dict(c='000001', navdate='2026-09-18', returnAsOf='2026-09-22')],
                 'INDEX_DATA': [dict(c='399006', asof='2026-09-22')],
                 'META': {'navdate': '2026-09-18'}}
        failures = check_refresh.check_snapshots(before, after)
        self.assertTrue(any('FUNDS 000001 navdate' in item for item in failures))
        self.assertTrue(any('INDEX_DATA 标的集合变化' in item for item in failures))
        self.assertTrue(any('META.navdate' in item for item in failures))
        good = {'FUNDS': [dict(c='000001', navdate='2026-09-22', returnAsOf='2026-09-22')],
                'INDEX_DATA': [dict(c='399001', asof='2026-09-21')],
                'META': {'navdate': '2026-09-22'}}
        self.assertEqual(check_refresh.check_snapshots(before, good), [])

    def test_stock_valuation_dates_and_history_cannot_silently_disappear(self):
        prior = {'c': '300274', 'valuationAsOf': '2026-09-29', 'fundamentalsAsOf': '2026-06-30',
                 'pePercentiles': {'5': {'status': 'available', 'value': 25}}}
        changed = {**prior, 'valuationAsOf': None, 'pePercentiles': {}}
        failures = check_refresh.check_snapshots({'STOCKS': [prior]}, {'STOCKS': [changed]})
        self.assertTrue(any('valuationAsOf' in s for s in failures))
        self.assertTrue(any('5年PE历史退化' in s for s in failures))
        # An actual loss can legitimately make PE inapplicable, while source dates remain valid.
        loss = {**prior, 'pePercentiles': {'5': {'status': 'loss', 'value': None}}}
        self.assertEqual(check_refresh.check_snapshots({'STOCKS': [prior]}, {'STOCKS': [loss]}), [])


if __name__ == '__main__':
    unittest.main()
