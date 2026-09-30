import unittest
from datetime import datetime, timezone

from scripts.fetch_company_filings import select_filing


class FilingSelectionTests(unittest.TestCase):
    def announcement(self, title, code='300037', day='2026-08-21', identity='123'):
        return {'announcementTitle': title, 'secCode': code, 'announcementId': identity,
                'adjunctUrl': 'finalpage/' + day + '/' + identity + '.PDF',
                'announcementTime': datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() * 1000}

    def test_disclosure_notices_and_abstracts_cannot_displace_full_report(self):
        rows = [self.announcement('2026年半年度报告全文', identity='100'),
                self.announcement('2026年半年度报告披露提示性公告', identity='999'),
                self.announcement('2026年半年度报告摘要', identity='998')]
        selected = select_filing(rows, '300037', '2026年半年度报告', '2026-09-30')
        self.assertEqual(selected['announcementId'], '100')

    def test_issuer_prefix_optional_year_character_and_revision_are_preserved(self):
        row = self.announcement('北方稀土2025年度报告全文', code='600111')
        self.assertIsNotNone(select_filing([row], '600111', '2025年年度报告', '2026-09-30'))
        row = self.announcement('新宙邦2026年半年度报告（修订版）')
        self.assertIsNotNone(select_filing([row], '300037', '2026年半年度报告', '2026-09-30'))

    def test_other_security_and_future_announcement_are_rejected(self):
        rows = [self.announcement('2026年半年度报告', code='300502'),
                self.announcement('2026年半年度报告', day='2026-10-01')]
        self.assertIsNone(select_filing(rows, '300037', '2026年半年度报告', '2026-09-30'))


if __name__ == '__main__':
    unittest.main()
