import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update
from fund_evidence import ROOT, fund_actions
from scripts.build_fund_actions import build_archive


class FundDistributionReportTests(unittest.TestCase):
    def test_reports_do_not_create_dividend_events_or_use_future_periods(self):
        archive = json.loads((ROOT / 'data/fund-actions.json').read_text())['funds']
        actions = fund_actions('513100', '2026-09-22', archive, [])
        self.assertEqual(actions['cash'], [])
        self.assertEqual(actions['splits'], [{'date': '2022-01-13', 'factor': 5}])
        self.assertEqual([p['cashDistributed'] for p in actions['verifiedDistributionPeriods']], [0, 0])
        self.assertEqual(actions['verifiedDistributionPeriods'][1]['underlyingDividends'], 47104790.09)
        before = fund_actions('513100', '2025-12-31', archive, [])
        self.assertEqual(len(before['verifiedDistributionPeriods']), 1)
        other = fund_actions('160213', '2026-09-22', archive, [])
        self.assertEqual(other['verifiedDistributionPeriods'], [])
        self.assertTrue(other['cash'])

    def test_newer_provider_listing_preserves_official_report_evidence(self):
        archived = json.loads((ROOT / 'data/fund-actions.json').read_text())['funds']['513100']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'actions.json'
            archive.write_text(json.dumps({'funds': {'513100': archived}}))
            (root / 'fhsp_513100.html').write_text("<table class='cfxq'>暂无分红信息</table><table class='fhxq'>暂无拆分信息</table>")
            snapshot = root / 'snapshot.js'
            snapshot.write_text('fixture')
            with patch.object(update, 'HTML', snapshot), patch.object(update, 'parse_fund_lines', return_value=[('', '513100', '')]):
                rebuilt = build_archive(root, archive, root / 'missing-validation.json')['funds']['513100']
            self.assertEqual(rebuilt['verifiedDistributionPeriods'], archived['verifiedDistributionPeriods'])


if __name__ == '__main__':
    unittest.main()
