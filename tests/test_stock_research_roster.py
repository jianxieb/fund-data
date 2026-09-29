import unittest
from pathlib import Path

import stock_screen
from stock_fundamentals import quality_review
from scripts.discover_quality import in_scope

ROOT = Path(__file__).resolve().parents[1]


class StockResearchRosterTests(unittest.TestCase):
    def test_quality_profiles_require_company_research_and_stay_separate_from_dividends(self):
        profiles = stock_screen.STOCK_UNIVERSE
        self.assertEqual(len({r['code'] for r in profiles}), len(profiles))
        for profile in profiles:
            if profile.get('group', 'dividend') == 'quality':
                research = profile['quality_research']
                self.assertEqual(research['code'], profile['code'])
                self.assertTrue(research['thesis'])
                self.assertTrue(research['risks'])
                self.assertTrue(research['sources'])
            else:
                self.assertNotIn('quality_research', profile)

    def test_published_snapshot_uses_only_reviewed_roster_and_reproducible_admission(self):
        rows = stock_screen.load_old_rows((ROOT / 'data/snapshot.js').read_text())
        self.assertEqual(set(rows), {r['code'] for r in stock_screen.STOCK_UNIVERSE})
        for row in rows.values():
            if row['group'] == 'dividend':
                self.assertNotIn('qualityReview', row)
                self.assertNotIn('qualityResearch', row)
                continue
            review = row['qualityReview']
            recalculated = quality_review(row, review['checkedAt'])
            self.assertEqual(review['qualified'], recalculated['qualified'], row['c'])
            if review['qualified']:
                self.assertTrue(all(c['pass'] for c in recalculated['checks']), row['c'])

    def test_discovery_excludes_other_exchanges_and_future_announcements(self):
        row = {'SECURITY_CODE': '601138', 'SECUCODE': '601138.SH', 'SECURITY_NAME_ABBR': '工业富联',
               'REPORT_DATE': '2026-06-30', 'NOTICE_DATE': '2026-08-12'}
        self.assertTrue(in_scope(row, '2026-06-30', '2026-09-29'))
        for changes in ({'NOTICE_DATE': '2026-10-01'}, {'SECURITY_CODE': '920001', 'SECUCODE': '920001.BJ'},
                        {'SECURITY_NAME_ABBR': '*ST测试'}, {'SECUCODE': '601899.SH'},
                        {'REPORT_DATE': '2025-06-30'}):
            self.assertFalse(in_scope({**row, **changes}, '2026-06-30', '2026-09-29'))


if __name__ == '__main__':
    unittest.main()
