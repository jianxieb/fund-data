import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.refresh_money_flow_quotes import parse_boc, parse_cmb, validate_quote, merge_bank, read_snapshot, main


class BankQuotesTests(unittest.TestCase):
    def test_boc_uses_remittance_buy_and_sell_per_one_currency(self):
        cells = lambda c, bid, ask: '<tr>' + ''.join(f'<td>{x}</td>' for x in [c, bid, '1', ask, '2', '3', '2026/1/2', '10:20:00']) + '</tr>'
        quotes = parse_boc('<table>' + cells('美元', '699.10', '702.30') + cells('港币', '89.1', '90.2') + '</table>')
        self.assertEqual(quotes['USD'], {'buy': 6.991, 'sell': 7.023, 'asOf': '2026-01-02 10:20:00'})
        self.assertEqual(quotes['HKD']['sell'], .902)

    def test_cmb_uses_remittance_columns_and_pads_single_digit_date(self):
        rows = [{'ccyNbr': c, 'rthBid': b, 'rthOfr': s, 'rtbBid': '1', 'ratDat': '2026年1月2日', 'ratTim': '10:20:00'}
                for c, b, s in [('美元', '699.10', '702.30'), ('港币', '89.1', '90.2')]]
        q = parse_cmb({'returnCode': 'SUC0000', 'body': rows})
        self.assertEqual(q['USD']['buy'], 6.991)
        self.assertEqual(q['USD']['asOf'], '2026-01-02 10:20:00')

    def test_bad_quotes_missing_required_rows_and_future_dates_fail(self):
        for bid, ask, at in [('0', '702', '2026-01-02 10:00:00'), ('702', '699', '2026-01-02 10:00:00'), ('699', '702', '2099-01-02 10:00:00')]:
            with self.assertRaises(ValueError):
                validate_quote(bid, ask, at)
        with self.assertRaisesRegex(ValueError, 'missing'):
            parse_boc('<table></table>')
        with self.assertRaisesRegex(ValueError, 'unsuccessful'):
            parse_cmb({'returnCode': 'ERROR'})

    def test_partial_refresh_preserves_unavailable_bank_and_original_date(self):
        old = {'banks': {'boc': {'quotes': {'USD': {'buy': 7, 'sell': 7.1, 'asOf': '2026-01-02 10:00:00'}}},
                         'cmb': {'quotes': {'USD': {'buy': 7, 'sell': 7.1, 'asOf': '2026-01-01 10:00:00'}}}}}
        before = copy.deepcopy(old['banks']['cmb'])
        merge_bank(old, 'boc', {'USD': {'buy': 7, 'sell': 7.1, 'asOf': '2026-01-03 10:00:00'}})
        self.assertEqual(old['banks']['cmb'], before)
        with self.assertRaisesRegex(ValueError, 'regress'):
            merge_bank(old, 'boc', {'USD': {'buy': 7, 'sell': 7.1, 'asOf': '2026-01-01 10:00:00'}})
        self.assertEqual(old['banks']['boc']['quotes']['USD']['asOf'], '2026-01-03 10:00:00')

    def test_complete_network_outage_never_rewrites_the_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'quotes.js'
            source = 'window.MONEY_FLOW_QUOTES = ' + json.dumps({'banks': {}}) + ';\n'
            path.write_text(source)
            with patch.object(sys, 'argv', ['refresh', '--output', str(path)]), patch('scripts.refresh_money_flow_quotes.fetch_bank', side_effect=OSError('offline')):
                with self.assertRaisesRegex(SystemExit, 'unchanged'):
                    main()
            self.assertEqual(path.read_text(), source)
            self.assertEqual(read_snapshot(path), {'banks': {}})


if __name__ == '__main__':
    unittest.main()
