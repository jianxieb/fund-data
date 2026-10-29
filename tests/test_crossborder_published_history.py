import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_crossborder_data as crossborder


class CrossborderPublishedHistoryTests(unittest.TestCase):
    def test_dated_published_curve_replaces_duplicate_requests_and_rejects_wrong_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'data/portfolio/fund/000001-test.json'
            path.parent.mkdir(parents=True)
            body = dict(id='fund:000001', currency='CNY', basis='provider_daily_return_or_explicit_actions',
                        dividends='reinvested', series=[['2026-10-26', 1], ['2026-10-27', 1.1], ['2026-10-28', 1.2]])
            raw = json.dumps(body).encode()
            path.write_bytes(raw)
            fund = dict(c='000001', exchange=False, returnAsOf='2026-10-28',
                        returnHistoryUrl=path.relative_to(root).as_posix(), returnHistorySha256=hashlib.sha256(raw).hexdigest())
            with patch.object(crossborder, 'ROOT', root), patch.object(crossborder, 'history_fetch') as fetch, \
                    patch.object(crossborder, 'fund_actions', return_value={'status': 'unavailable'}):
                _, row = crossborder.build(fund, False)
                self.assertEqual(row['nav']['returnAsOf'], '2026-10-28')
                self.assertEqual(row['errors'], [])
                fetch.assert_not_called()
                with self.assertRaisesRegex(ValueError, '哈希'):
                    crossborder.published_nav({**fund, 'returnHistorySha256': 'bad'}, '2026-10-28')
                previous = dict(nav={'returnAsOf': '2026-10-26'}, market={'returnAsOf': '2026-10-26'})
                with patch.object(crossborder, 'chart', side_effect=TimeoutError('source timeout')):
                    _, retained = crossborder.build({**fund, 'exchange': True}, False, previous)
                self.assertEqual(retained['nav'], previous['nav'])
                self.assertEqual(retained['market'], previous['market'])
                self.assertIn('source timeout', retained['errors'][-1])


if __name__ == '__main__':
    unittest.main()
