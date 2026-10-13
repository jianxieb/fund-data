import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_portfolio_data as portfolio
from screens.fund_screen import parse_js_record


class PortfolioNavSync(unittest.TestCase):
    def sync(self, rows, old_day='2026-09-30'):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / '.tmp-hist'
            cache.mkdir()
            (cache / '000001.json').write_text(json.dumps(rows))
            snapshot = root / 'snapshot.js'
            snapshot.write_text("/*__DATA_EXTRA_BEGIN__*/\n{c:'000001',nav:1,navdate:'" + old_day +
                "',dz:0.2,r:[10,20,30,40,50],returnAsOf:'2026-09-30',fee:[1.2,0.2,0]},\n/*__DATA_EXTRA_END__*/")
            catalog = {'assets': [dict(id='fund:000001', code='000001', status='available', asOf='2026-10-13')]}
            with patch.object(portfolio, 'ROOT', root):
                result = portfolio.sync_fund_nav(catalog, snapshot)
            row = parse_js_record(snapshot.read_text().splitlines()[1])
            return result, row

    def test_current_nav_does_not_renew_unverified_returns_or_fee_evidence(self):
        result, row = self.sync([dict(FSRQ='2026-10-13', DWJZ='1.25', JZZZL='-0.8')])
        self.assertEqual(result, {'updated': 1, 'warnings': {}})
        self.assertEqual((row['nav'], row['navdate'], row['dz']), (1.25, '2026-10-13', -.8))
        self.assertEqual(row['r'], [10, 20, 30, 40, 50])
        self.assertEqual(row['returnAsOf'], '2026-09-30')
        self.assertEqual(row['fee'], [1.2, .2, 0])
        self.assertNotIn('performanceVerifiedAt', row)
        self.assertIn('000001', row['navSourceUrl'])

    def test_conflicting_same_day_nav_keeps_the_previous_value_and_date(self):
        result, row = self.sync([dict(FSRQ='2026-10-13', DWJZ='1.25', JZZZL='1'),
                                 dict(FSRQ='2026-10-13', DWJZ='2.25', JZZZL='1')])
        self.assertEqual(result['updated'], 0)
        self.assertIn('唯一有效单位净值', result['warnings']['000001'])
        self.assertEqual(row['navdate'], '2026-09-30')

    def test_a_nav_newer_than_the_simulation_boundary_never_moves_back(self):
        result, row = self.sync([dict(FSRQ='2026-10-13', DWJZ='1.25')], old_day='2026-10-14')
        self.assertEqual(result, {'updated': 0, 'warnings': {}})
        self.assertEqual(row['navdate'], '2026-10-14')

    def test_malformed_raw_cache_is_reported_without_erasing_valid_observations(self):
        result, row = self.sync({'not': 'NAV rows'})
        self.assertEqual(result['updated'], 0)
        self.assertIn('缓存结构无效', result['warnings']['000001'])
        self.assertEqual(row['nav'], 1)


if __name__ == '__main__':
    unittest.main()
