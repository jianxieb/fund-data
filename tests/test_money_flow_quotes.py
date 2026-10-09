import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.refresh_money_flow_quotes import (parse_boc, parse_cmb, parse_bochk, parse_icbc,
    parse_ccb, parse_abc, parse_comm, parse_hsbc, validate_quote, merge_bank, read_snapshot, main)


class BankQuotesTests(unittest.TestCase):
    def test_icbc_remittance_prices_are_per_100_and_not_reference_or_cash_prices(self):
        payload = {'code': 0, 'data': [dict(currencyENName=c, foreignBuy=b, foreignSell=s,
            reference='1', cashBuy='1', publishDate='2026-01-02', publishTime='10:20:00')
            for c, b, s in [('USD', '668', '671.49'), ('HKD', '85.13', '85.56')]]}
        quotes = parse_icbc(payload)
        self.assertEqual(quotes['USD']['buy'], 6.68)
        self.assertEqual(quotes['HKD']['sell'], .8556)

    def test_ccb_uses_per_one_customer_prices_not_interbank_or_cash_prices(self):
        xml = '<ReferencePriceSettlements>' + ''.join(
            f'<ReferencePriceSettlement><Ofrd_Ccy_CcyCd>{c}</Ofrd_Ccy_CcyCd><Ofr_Ccy_CcyCd>156</Ofr_Ccy_CcyCd>'
            f'<BidRateOfCcy>{b}</BidRateOfCcy><OfrRateOfCcy>{s}</OfrRateOfCcy>'
            '<BidRateOfCash>1</BidRateOfCash><HBBnk_Bss_Buy_Prc>2</HBBnk_Bss_Buy_Prc>'
            '<LstPr_Dt>20260102</LstPr_Dt><LstPr_Tm>102000</LstPr_Tm></ReferencePriceSettlement>'
            for c, b, s in [('840', '6.6872', '6.716'), ('344', '.852', '.8554')]) + '</ReferencePriceSettlements>'
        quotes = parse_ccb(xml)
        self.assertEqual(quotes['USD']['sell'], 6.716)
        self.assertEqual(quotes['HKD']['buy'], .852)

    def test_abc_uses_each_rows_timestamp_and_remittance_bid(self):
        payload = {'ErrorCode': '0', 'Data': {'Table': [dict(CurrName=c, BuyingPrice=b, SellPrice=s,
            CashBuyingPrice='1', PublishTime=t) for c, b, s, t in [
                ('美元(USD)', '668.535', '671.349', '2026-01-02T10:22:15+08:00'),
                ('港元(HKD)', '85.19', '85.531', '2026-01-02T10:23:00+08:00')]]}}
        quotes = parse_abc(payload)
        self.assertEqual(quotes['USD']['buy'], 6.68535)
        self.assertEqual(quotes['HKD']['asOf'], '2026-01-02 10:23:00')

    def test_comm_respects_explicit_row_units_and_requires_source_timestamp(self):
        html = '更新时间：2026-01-02 10:15:00<table>' + ''.join(
            '<tr>' + ''.join(f'<td>{x}</td>' for x in [c, u, b, s, 1, 2]) + '</tr>'
            for c, u, b, s in [('美元(USD/CNY)', 100, 668.8, 671.8), ('港币(HKD/CNY)', 1, .85, .86)]) + '</table>'
        quotes = parse_comm({'RSP_BODY': {'fileContent': html}})
        self.assertEqual(quotes['USD']['buy'], 6.688)
        self.assertEqual(quotes['HKD']['sell'], .86)
        with self.assertRaisesRegex(ValueError, 'timestamp'):
            parse_comm({'RSP_BODY': {'fileContent': ''}})

    def test_hsbc_inverts_the_two_remittance_prices_without_fabricating_a_time(self):
        quotes = parse_hsbc({'responseCode': '000', 'data': {'lastUpdateDate': '2026-01-02',
            'counterForRepeatingBlock': [dict(exchangeRateCurrency=c, transferBuyingRate=1/b,
                transferSellingRate=1/s, notesBuyingRate=1) for c, b, s in [('USD', 6.66, 6.73), ('HKD', .85, .86)]]}})
        self.assertEqual(quotes['USD']['buy'], 6.66)
        self.assertEqual(quotes['USD']['sell'], 6.73)
        self.assertEqual(quotes['USD']['asOf'], '2026-01-02')
        self.assertEqual(quotes['USD']['timePrecision'], 'day')

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

    def test_bochk_units_are_cnh_hkd_per_one_usd_not_mainland_cny_per_100(self):
        html = '<table><tr><td>美元/人民币</td><td>6.66741</td><td>6.74338</td></tr><tr><td>美元/港元</td><td>7.8242</td><td>7.8744</td></tr></table>资料更新于香港时间： 2026/10/08 10:00:00'
        quotes = parse_bochk(html)
        self.assertEqual(quotes['CNH'], {'bidPerUsd': 6.66741, 'askPerUsd': 6.74338, 'asOf': '2026-10-08 10:00:00'})
        self.assertEqual(quotes['HKD']['askPerUsd'], 7.8744)
        self.assertNotIn('CNY', quotes)
        snapshot = {'banks': {'boc': {'quotes': {'USD': {'buy': 6.7, 'sell': 6.8, 'asOf': '2026-10-08 10:00:00'}}}}}
        before = copy.deepcopy(snapshot['banks'])
        merge_bank(snapshot, 'bochk', quotes)
        self.assertEqual(snapshot['banks'], before)
        self.assertIn('CNH', snapshot['offshoreUsd']['bochk']['unit'])
        earlier = copy.deepcopy(quotes)
        earlier['CNH']['asOf'] = '2026-10-07 10:00:00'
        with self.assertRaisesRegex(ValueError, 'regress'):
            merge_bank(snapshot, 'bochk', earlier)
        self.assertEqual(snapshot['offshoreUsd']['bochk']['quotes'], quotes)

    def test_bochk_rejects_missing_rows_direction_errors_and_future_dates(self):
        html = '<tr><td>美元/人民币</td><td>7.2</td><td>7.1</td></tr><tr><td>美元/港元</td><td>7.8</td><td>7.9</td></tr>资料更新于香港时间： 2026/10/08 10:00:00'
        with self.assertRaisesRegex(ValueError, 'bid/ask'):
            parse_bochk(html)
        with self.assertRaisesRegex(ValueError, 'future'):
            parse_bochk(html.replace('7.2', '7.0').replace('2026/10/08', '2099/10/08'))
        with self.assertRaisesRegex(ValueError, 'timestamp'):
            parse_bochk('<table></table>')
        with self.assertRaisesRegex(ValueError, 'rows missing'):
            parse_bochk('资料更新于香港时间： 2026/10/08 10:00:00')

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
