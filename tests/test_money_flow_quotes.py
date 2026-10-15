import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.error import URLError

from scripts.refresh_money_flow_quotes import (parse_boc, parse_cmb, parse_bochk, parse_icbc,
    parse_ccb, parse_abc, parse_comm, parse_hsbc, parse_cib, parse_hsbc_hk, parse_hang_hk,
    hkd_cross_quotes, parse_hang_cn, parse_icbc_asia, parse_ccb_asia, validate_quote, merge_bank, read_snapshot, fetch_bank, main)


class BankQuotesTests(unittest.TestCase):
    def test_ccb_asia_uses_visible_ordinary_tt_prices_and_preserves_mainland_quotes(self):
        raw = (Path(__file__).parent / 'fixtures' / 'ccb-asia-fx-20261015.js').read_text()
        quotes = parse_ccb_asia(raw)
        self.assertEqual(quotes, {'HKD': {'bidPerUsd': 7.8242, 'askPerUsd': 7.8727, 'asOf': '2026-10-15 10:23:58'}})
        # The source repeats ExR_Grp: a plain JSON parse would select tier 301.
        self.assertNotEqual(quotes['HKD']['bidPerUsd'], 7.8268)
        self.assertNotEqual(quotes['HKD']['bidPerUsd'], 7.8468)  # Interbank price.
        snapshot = {'banks': {'ccb': {'quotes': {'USD': {'buy': 6.68, 'sell': 6.71}}}}}
        original = copy.deepcopy(snapshot['banks'])
        merge_bank(snapshot, 'ccb-asia', quotes)
        self.assertEqual(snapshot['banks'], original)
        self.assertEqual(snapshot['offshoreUsd']['ccb-asia']['quotes'], quotes)
        self.assertNotIn('CNH', quotes)
        for bad in [raw.replace('"210"', '"999"'), raw.replace('"7.8242"', '"-7.8242"'), 'var x = "not a quote";']:
            with self.assertRaises(ValueError):
                parse_ccb_asia(bad)
        older = copy.deepcopy(quotes)
        older['HKD']['asOf'] = '2026-10-14 10:23:58'
        with self.assertRaisesRegex(ValueError, 'regress'):
            merge_bank(snapshot, 'ccb-asia', older)

    def test_icbc_asia_current_fractional_timestamp_refreshes_on_python_39(self):
        raw = json.loads((Path(__file__).parent / 'fixtures' / 'icbc-asia-fx-fractional-20261012.json').read_text())
        quotes = parse_icbc_asia(raw)
        self.assertEqual(quotes['HKD']['asOf'], '2026-10-12 05:50:05.07754')
        self.assertEqual(quotes['HKD']['bidPerUsd'], 7.8344)
        self.assertEqual(quotes['HKD']['askPerUsd'], 7.8644)
        self.assertEqual(quotes['CNH']['legs'], {
            'usdBuy': 7.8344, 'usdSell': 7.8644, 'cnhBuy': 1.16501, 'cnhSell': 1.18001})
        snapshot = {'offshoreUsd': {'icbc-asia': {'quotes': {
            'HKD': {'bidPerUsd': 7.8344, 'askPerUsd': 7.8644, 'asOf': '2026-10-12 02:40:04.117532'}}}}}
        merge_bank(snapshot, 'icbc-asia', quotes)
        self.assertEqual(snapshot['offshoreUsd']['icbc-asia']['quotes']['HKD']['asOf'],
                         raw['data'][0]['updateTime'])
        for fraction in ['1', '12', '1234', '12345', '123456']:
            timestamp = '2026-01-02 10:00:00.' + fraction
            self.assertEqual(validate_quote(668, 671, timestamp)['asOf'], timestamp)
        with self.assertRaisesRegex(ValueError, 'future'):
            validate_quote(668, 671, '2099-01-02 10:00:00.07754')
        with self.assertRaises(ValueError):
            validate_quote(668, 671, '2026-01-02 10:00:00.invalid')

    def test_icbc_asia_platform_tls_fallback_keeps_certificate_checks_and_does_not_mask_other_errors(self):
        raw = (Path(__file__).parent / 'fixtures' / 'icbc-asia-fx-20261012.json').read_text()
        with patch('scripts.refresh_money_flow_quotes.urlopen', side_effect=URLError('UNSAFE_LEGACY_RENEGOTIATION_DISABLED')), \
             patch('scripts.refresh_money_flow_quotes.subprocess.run', return_value=SimpleNamespace(stdout=raw)) as curl:
            self.assertEqual(fetch_bank('icbc-asia')['HKD']['askPerUsd'], 7.8644)
            command = curl.call_args.args[0]
            self.assertIn('--fail', command)
            self.assertEqual(command[-1], 'https://papi.icbc.com.cn/rest/currencies/asia/foreign')
            self.assertNotIn('--insecure', command)
            self.assertNotIn('-k', command)
        for bank, error in [('icbc-asia', 'CERTIFICATE_VERIFY_FAILED'), ('boc', 'UNSAFE_LEGACY_RENEGOTIATION_DISABLED')]:
            with patch('scripts.refresh_money_flow_quotes.urlopen', side_effect=URLError(error)), \
                 patch('scripts.refresh_money_flow_quotes.subprocess.run') as curl:
                with self.assertRaises(URLError):
                    fetch_bank(bank)
                curl.assert_not_called()

    def test_icbc_asia_uses_its_own_per_unit_hkd_quotes_and_two_real_exchange_legs(self):
        raw = json.loads((Path(__file__).parent / 'fixtures' / 'icbc-asia-fx-20261012.json').read_text())
        quotes = parse_icbc_asia(raw)
        self.assertEqual(quotes['HKD']['bidPerUsd'], 7.8344)
        self.assertEqual(quotes['HKD']['askPerUsd'], 7.8644)
        self.assertAlmostEqual(quotes['CNH']['bidPerUsd'], 7.8344 / 1.18001, places=7)
        self.assertAlmostEqual(quotes['CNH']['askPerUsd'], 7.8644 / 1.16501, places=7)
        self.assertEqual(quotes['CNH']['path'], 'via-HKD')
        self.assertEqual(quotes['CNH']['asOf'], '2026-10-12 02:40:04.117532')
        snapshot = {'banks': {'icbc': {'quotes': {'USD': {'sell': 6.8}}}}}
        before = copy.deepcopy(snapshot['banks'])
        merge_bank(snapshot, 'icbc-asia', quotes)
        self.assertEqual(snapshot['banks'], before)
        self.assertEqual(snapshot['offshoreUsd']['icbc-asia']['quotes'], quotes)
        bad = copy.deepcopy(raw)
        bad['data'] = [row for row in raw['data'] if row['currename'] != 'CNY']
        with self.assertRaises(KeyError):
            parse_icbc_asia(bad)
        bad = copy.deepcopy(raw)
        bad['code'] = 1
        with self.assertRaisesRegex(ValueError, 'unsuccessful'):
            parse_icbc_asia(bad)

    def test_hang_seng_china_uses_current_api_timestamp_and_one_unit_cny_quotes(self):
        raw = json.loads((Path(__file__).parent / 'fixtures' / 'hang-cn-20261010.json').read_text())
        quotes = parse_hang_cn(raw)
        self.assertEqual(quotes['USD'], {'buy': 6.5918663, 'sell': 6.7926338, 'asOf': '2026-10-10 19:27:00'})
        self.assertEqual(quotes['HKD']['sell'], .8655518)
        self.assertNotIn('ATS', quotes)
        snapshot = {'offshoreUsd': {'hang': {'quotes': {'CNH': {'bidPerUsd': 6.5, 'askPerUsd': 6.8}}}}}
        before = copy.deepcopy(snapshot['offshoreUsd'])
        merge_bank(snapshot, 'hang', quotes)
        self.assertEqual(snapshot['offshoreUsd'], before)
        self.assertEqual(snapshot['banks']['hang']['quotes']['USD'], quotes['USD'])
        del raw['time']
        with self.assertRaises(KeyError):
            parse_hang_cn(raw)

    def test_hong_kong_banks_use_their_own_tt_prices_and_two_explicit_hkd_legs(self):
        fixtures = Path(__file__).parent / 'fixtures'
        hsbc = parse_hsbc_hk(json.loads((fixtures / 'hsbc-hk-20261010.json').read_text()))
        hang = parse_hang_hk(json.loads((fixtures / 'hang-hk-20261010.json').read_text()))
        self.assertEqual(hsbc['HKD']['bidPerUsd'], 7.8134)
        self.assertEqual(hsbc['HKD']['askPerUsd'], 7.8823)
        self.assertAlmostEqual(hsbc['CNH']['bidPerUsd'], 7.8134 / 1.1821, places=7)
        self.assertAlmostEqual(hsbc['CNH']['askPerUsd'], 7.8823 / 1.163, places=7)
        self.assertEqual(hang['HKD']['bidPerUsd'], 7.819)
        self.assertAlmostEqual(hang['CNH']['bidPerUsd'], 7.819 / 1.1833, places=7)
        self.assertAlmostEqual(hang['CNH']['askPerUsd'], 7.878 / 1.1622, places=7)
        self.assertEqual(hsbc['CNH']['path'], 'via-HKD')
        self.assertEqual(hsbc['CNH']['legs']['usdBuy'], hsbc['HKD']['bidPerUsd'])
        snapshot = {'banks': {'hsbc': {'quotes': {'USD': {'buy': 6.7, 'sell': 6.8, 'asOf': '2026-10-09'}}}}}
        before = copy.deepcopy(snapshot['banks'])
        merge_bank(snapshot, 'hsbchk', hsbc)
        merge_bank(snapshot, 'hanghk', hang)
        self.assertEqual(snapshot['banks'], before)
        self.assertEqual(snapshot['offshoreUsd']['hsbc']['quotes'], hsbc)
        self.assertEqual(snapshot['offshoreUsd']['hang']['quotes'], hang)
        older = copy.deepcopy(hsbc)
        older['CNH']['asOf'] = '2026-01-01'
        with self.assertRaisesRegex(ValueError, 'regress'):
            merge_bank(snapshot, 'hsbchk', older)
        self.assertEqual(snapshot['offshoreUsd']['hsbc']['quotes'], hsbc)

    def test_hong_kong_cross_uses_the_older_leg_timestamp_and_rejects_bad_prices(self):
        q = hkd_cross_quotes({'buy': 7.8, 'sell': 8, 'asOf': '2026-10-09 12:00:00'},
                             {'buy': 1.1, 'sell': 1.2, 'asOf': '2026-10-09 11:00:00'})
        self.assertEqual(q['HKD']['asOf'], '2026-10-09 12:00:00')
        self.assertEqual(q['CNH']['asOf'], '2026-10-09 11:00:00')
        self.assertAlmostEqual(q['CNH']['bidPerUsd'], 6.5)
        self.assertAlmostEqual(q['CNH']['askPerUsd'], 8 / 1.1, places=7)
        source = json.loads((Path(__file__).parent / 'fixtures/hsbc-hk-20261010.json').read_text())
        for row in source['detailRates']:
            row['bankBuyRt'], row['bankSellRt'] = 999, 1000
        self.assertEqual(parse_hsbc_hk(source)['HKD']['bidPerUsd'], 7.8134)
        usd = next(x for x in source['detailRates'] if x['ccy'] == 'USD')
        usd['ttBuyRt'] = 99
        with self.assertRaisesRegex(ValueError, 'bid/ask'):
            parse_hsbc_hk(source)

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

    def test_cib_reads_jqgrid_remittance_columns_and_labels_observation_time(self):
        payload = {"page": "1", "records": "2", "rows": [
            {"cell": ["美元", "USD", "100.00", "668.27", "670.81", "662.65", "670.68"], "id": "5"},
            {"cell": ["港币", "HKD", "100.00", "85.15", "85.48", "84.44", "85.46"], "id": "4"}]}
        q = parse_cib(payload, '2026-10-09 12:00:00')
        self.assertEqual(q['USD'], {'buy': 6.6827, 'sell': 6.7081, 'asOf': '2026-10-09 12:00:00', 'timeBasis': 'observed'})
        self.assertEqual(q['HKD']['sell'], .8548)
        # Never apply the card's spread discount in the raw bank snapshot.
        self.assertNotIn('spreadDiscount', q['USD'])
        with self.assertRaisesRegex(ValueError, 'unsuccessful'):
            parse_cib({'error': True, 'msg': 'missing dataSet parameters'}, '2026-10-09')
        with self.assertRaisesRegex(ValueError, 'missing'):
            parse_cib({'rows': []}, '2026-10-09')

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
