import copy
import io
import unittest
from datetime import date, datetime, timezone
from unittest.mock import call, patch
from urllib.error import URLError

import indices
import data_quality
import stock_screen
from scripts.check_refresh import check_snapshots
from stock_fundamentals import latest_report_review, parse_evidence, retain_report_evidence


def report_fixture():
    identity = {'SECUCODE': '123456.SZ', 'SECURITY_CODE': '123456'}
    quote = {**identity, 'TRADE_DATE': '2026-10-14', 'TOTAL_MARKET_CAP': 20e9,
             'TOTAL_SHARES': 1.5e9, 'CLOSE_PRICE': 15.5, 'PE_TTM': 20}
    reports = [{**identity, 'REPORT_DATE': '2026-06-30', 'NOTICE_DATE': '2026-08-12',
                'PARENTNETPROFIT': 1e9, 'TOTAL_SHARE': 1.5e9},
               {**identity, 'REPORT_DATE': '2025-12-31', 'NOTICE_DATE': '2026-03-30',
                'PARENTNETPROFIT': 1.2e9, 'TOTAL_SHARE': 1.5e9}]
    previous = {'c': '123456', **parse_evidence('123456', [quote], reports, '2026-10-14')}
    return quote, reports, previous


class IndexSourceRecoveryTests(unittest.TestCase):
    def test_connection_resets_recover_with_bounded_backoff(self):
        replies = [URLError('connection reset'), URLError('connection reset'), io.BytesIO(b'{"code":200}')]
        with patch.object(indices.urllib.request, 'urlopen', side_effect=replies) as fetch, \
                patch.object(indices.time, 'sleep') as sleep:
            self.assertEqual(indices.request_json(indices.CSI, timeout=15), {'code': 200})
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(1), call(3)])
        self.assertTrue(all(c.kwargs['timeout'] == 15 for c in fetch.call_args_list))

    def test_exhausted_requests_still_fail_instead_of_claiming_fresh_data(self):
        with patch.object(indices.urllib.request, 'urlopen', side_effect=URLError('connection reset')) as fetch, \
                patch.object(indices.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'connection reset'):
                indices.request_json(indices.CSI)
        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(sleep.call_args_list, [call(1), call(3), call(7)])


class StockQuoteRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.item = {'code': '123456', 'name': 'fixture', 'business': 'fixture', 'note': 'fixture'}
        self.stamp = datetime(2026, 10, 14, 7, tzinfo=timezone.utc).timestamp()
        self.alternate = {'series': [('2026-10-13', 100), ('2026-10-14', 102)],
                          'sourceUrl': 'https://example.com/123456',
                          'meta': {'regularMarketPrice': 12.5, 'regularMarketTime': self.stamp}}

    def fetch(self, quote, evidence, previous=None):
        def response(url, **_):
            if 'push2.eastmoney' in url:
                if isinstance(quote, Exception):
                    raise quote
                return {'data': quote}
            if 'push2his' in url:
                return {'data': {'klines': ['2026-10-13,100', '2026-10-14,102']}}
            raise AssertionError('Unexpected endpoint: ' + url)

        with patch.object(stock_screen, 'fetch_evidence', return_value=evidence), \
                patch.object(stock_screen, 'fetch_json', side_effect=response), \
                patch.object(stock_screen, 'dividend_evidence', return_value={'yield12': 0, 'divYears': 0}), \
                patch.object(stock_screen, 'yahoo_stock', return_value=self.alternate) as yahoo:
            return stock_screen.fetch_stock(self.item, previous), yahoo.call_count

    def test_financial_source_outage_preserves_dated_reports_through_fetch_and_audit(self):
        quote, _, previous = report_fixture()
        current = parse_evidence('123456', [quote], [], '2026-10-14')
        current['fundamentalsErrors'] = ['financials: connection reset']
        row, _ = self.fetch({'f43': 0, 'f86': self.stamp}, current, previous)
        self.assertEqual(row['fundamentalsAsOf'], '2026-06-30')
        self.assertEqual(row['latestFinancials']['announcedAt'], '2026-08-12')
        self.assertEqual(row['fundamentalsErrors'], ['financials: connection reset'])
        self.assertEqual(check_snapshots({'STOCKS': [previous]}, {'STOCKS': [row]}), [])
        report = data_quality.audit({'STOCKS': [row]}, date(2026, 10, 14))
        issues = next(d for d in report['datasets'] if d['id'] == 'stocks')['issues']
        retained = next(i for i in issues if i['code'] == 'stock_financials_retained')
        self.assertEqual(retained['severity'], 'warning')
        self.assertEqual(retained['affected'], '123456')
        self.assertIn('财报接口本次未返回有效报告', retained['message'])
        self.assertIn('2026-06-30', retained['message'])

    def test_preopen_zero_or_missing_quote_keeps_verified_dated_close(self):
        evidence = {'valuationPrice': 15.5, 'valuationAsOf': '2026-10-14'}
        for quote in ({'f43': 0, 'f86': self.stamp}, {}, URLError('quote timeout')):
            with self.subTest(quote=quote):
                row, alternate_calls = self.fetch(quote, evidence)
                self.assertEqual(alternate_calls, 0)
                self.assertEqual(row['price'], 15.5)
                self.assertEqual(row['priceAsOf'], '2026-10-14')
                self.assertEqual(row['quoteSource'], 'Eastmoney RPT_VALUEANALYSIS_DET dated close')
                self.assertEqual(row['returnAsOf'], '2026-10-14')

    def test_invalid_live_quote_uses_verified_alternate_when_dated_close_missing(self):
        for price in (0, -100, None, float('nan')):
            with self.subTest(price=price):
                row, alternate_calls = self.fetch({'f43': price, 'f86': self.stamp}, {})
                self.assertEqual(alternate_calls, 1)
                self.assertEqual(row['price'], 12.5)
                self.assertEqual(row['priceAsOf'][:10], '2026-10-14')
                self.assertEqual(row['quoteSource'], 'Yahoo Finance chart metadata')
                self.assertTrue(row['sourceFallbacks'])

    def test_no_valid_price_remains_a_failure(self):
        self.alternate['meta']['regularMarketPrice'] = 0
        with self.assertRaisesRegex(RuntimeError, '现价无效'):
            self.fetch({'f43': 0, 'f86': self.stamp}, {})


class StockReportRecoveryTests(unittest.TestCase):
    def test_missing_or_lagging_reports_retain_evidence_but_recalculate_current_valuation(self):
        quote, reports, previous = report_fixture()
        original = copy.deepcopy(previous)
        fresh_quote = {**quote, 'TRADE_DATE': '2026-10-19', 'TOTAL_MARKET_CAP': 30e9,
                       'TOTAL_SHARES': 2e9, 'CLOSE_PRICE': 18}
        for incoming in ([], reports[1:]):
            with self.subTest(report_count=len(incoming)):
                current = parse_evidence('123456', [fresh_quote], incoming, '2026-10-20')
                row = retain_report_evidence('123456', current, previous)
                self.assertEqual(row['financialReports'], previous['financialReports'])
                self.assertEqual(row['fundamentalsAsOf'], '2026-06-30')
                self.assertEqual(row['fundamentalsRefreshStatus'], 'retained_previous_report')
                self.assertEqual(row['valuationAsOf'], '2026-10-19')
                self.assertEqual(row['valuationPrice'], 18)
                self.assertEqual(row['mcap'], 300)
                self.assertEqual(row['incomeShareEvidence']['currentShares'], 2e9)
                self.assertEqual(row['incomeShareEvidence']['reports'][0]['shares'], 1.5e9)
                self.assertEqual(row['peDynamic'], 15)
                self.assertEqual(row['peDynamicBasis']['announcedAt'], '2026-08-12')
                self.assertTrue(latest_report_review(row['latestFinancials'], '2026-10-20')[0]['pass'])
                self.assertFalse(latest_report_review(row['latestFinancials'], '2026-11-01')[0]['pass'])
                row['financialReports'][0]['netProfit'] = 0
                self.assertEqual(previous, original)

    def test_retained_report_cannot_be_used_before_its_announcement(self):
        quote, _, previous = report_fixture()
        current = parse_evidence('123456', [{**quote, 'TRADE_DATE': '2026-08-11'}], [], '2026-10-20')
        row = retain_report_evidence('123456', current, previous)
        self.assertEqual(row['peDynamic'], round(20e9 / 1.2e9, 4))
        self.assertEqual(row['peDynamicBasis']['reportDate'], '2025-12-31')

    def test_available_new_report_is_used_without_carrying_failure_status(self):
        quote, reports, previous = report_fixture()
        previous['fundamentalsRefreshStatus'] = 'retained_previous_report'
        previous['fundamentalsRefreshError'] = 'prior outage'
        newer = {**reports[0], 'REPORT_DATE': '2026-09-30', 'NOTICE_DATE': '2026-10-20'}
        current = parse_evidence('123456', [quote], [newer] + reports, '2026-10-20')
        expected = copy.deepcopy(current)
        self.assertEqual(retain_report_evidence('123456', current, previous), expected)
        self.assertEqual(current['fundamentalsAsOf'], '2026-09-30')
        self.assertNotIn('fundamentalsRefreshError', current)

    def test_unverified_or_wrong_identity_fallback_still_fails_regression_gate(self):
        quote, _, previous = report_fixture()
        for changed in ({'c': '654321'}, {'fundamentalsSourceUrl': None},
                        {'latestFinancials': None}, {'financialReports': []}):
            with self.subTest(changed=changed):
                current = parse_evidence('123456', [quote], [], '2026-10-20')
                row = {'c': '123456', **retain_report_evidence('123456', current, {**previous, **changed})}
                self.assertIsNone(row['fundamentalsAsOf'])
                problems = check_snapshots({'STOCKS': [previous]}, {'STOCKS': [row]})
                self.assertTrue(any('fundamentalsAsOf 日期倒退' in p for p in problems))


if __name__ == '__main__':
    unittest.main()
