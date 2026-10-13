import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import update
from screens.fund_screen import parse_js_record
from scripts import build_portfolio_data as portfolio


class PortfolioReturnSync(unittest.TestCase):
    def sync(self, first='2014-01-01', extra='', corrupt=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / 'data/portfolio'
            snapshot = root / 'snapshot.js'
            snapshot.write_text("/*__DATA_EXTRA_BEGIN__*/\n{c:'000001',d:'2014-01-01',r:[10,20,30,40,50],"
                "returnAsOf:'2026-09-30',navdate:'2026-10-13',fee:[1.2,0.2,0]" + extra +
                "},\n/*__DATA_EXTRA_END__*/")
            start, end = date.fromisoformat(first), date(2026, 10, 13)
            series = [[(start + timedelta(days=i)).isoformat(), 100 * 1.1 ** (i / 365.2425)]
                      for i in range((end - start).days + 1) if (start + timedelta(days=i)).weekday() < 5]
            with patch.object(portfolio, 'ROOT', root), patch.object(portfolio, 'OUTPUT', output):
                asset = portfolio.publish_history({'id':'fund:000001','code':'000001','currency':'CNY'},
                    series, 'provider_daily_return_or_explicit_actions', 'https://fundf10.eastmoney.com/jjjz_000001.html')
                if corrupt:
                    (root / asset['historyUrl']).write_text('{}')
                if corrupt:
                    with self.assertRaisesRegex(ValueError, '校验和不一致'):
                        portfolio.sync_fund_returns({'assets':[asset]}, snapshot)
                    return None, parse_js_record(snapshot.read_text().splitlines()[1])
                result = portfolio.sync_fund_returns({'assets':[asset]}, snapshot)
            return result, parse_js_record(snapshot.read_text().splitlines()[1])

    def test_all_five_windows_use_the_proven_path_and_leave_fee_dates_independent(self):
        result, row = self.sync(extra=",feeCheckedAt:'2026-09-01'")
        self.assertEqual(result, {'updated':1,'retained':{}})
        for value, period in zip(row['r'], row['returnPeriods']):
            years = (date.fromisoformat(period['end']) - date.fromisoformat(period['start'])).days / 365.2425
            self.assertAlmostEqual(((1 + value / 100) ** (1 / years) - 1) * 100, 10, places=7)
        self.assertEqual(row['returnAsOf'], '2026-10-13')
        self.assertEqual(row['feeCheckedAt'], '2026-09-01')
        self.assertEqual(row['fee'], [1.2,.2,0])
        self.assertIn('returnHistorySha256', row)

    def test_incomplete_new_window_keeps_previously_verified_returns_and_their_date(self):
        result, row = self.sync(first='2025-01-01', extra=",performanceVerifiedAt:'2026-09-30'")
        self.assertEqual(result['updated'], 0)
        self.assertIn('000001', result['retained'])
        self.assertEqual(row['r'], [10,20,30,40,50])
        self.assertEqual(row['returnAsOf'], '2026-09-30')

    def test_strategy_transition_never_claims_the_predecessor_as_a_ten_year_window(self):
        result, row = self.sync(extra=",strategySince:'2021-09-22'")
        self.assertEqual(result['updated'], 1)
        self.assertEqual(row['returnFirst'], '2021-09-22')
        self.assertIsNone(row['r'][-1])
        self.assertIsNone(row['returnPeriods'][-1]['start'])

    def test_bad_history_checksum_cannot_replace_any_return(self):
        result, row = self.sync(corrupt=True)
        self.assertEqual(row['returnAsOf'], '2026-09-30')
        self.assertEqual(row['r'], [10,20,30,40,50])


if __name__ == '__main__':
    unittest.main()
