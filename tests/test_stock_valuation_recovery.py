import copy
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

import data_quality
import stock_screen
from scripts.check_refresh import check_snapshots
from stock_fundamentals import parse_evidence, retain_valuation_evidence
from stock_valuations import percentile_evidence


FIXTURE = json.loads((Path(__file__).parent / 'fixtures/stock-valuation-outage-20261026.json').read_text())


class StockValuationRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.previous = copy.deepcopy(FIXTURE['previous'])
        self.current = copy.deepcopy(FIXTURE['failed'])

    def test_real_timeout_preserves_original_valuation_but_keeps_new_price_and_reports(self):
        before = copy.deepcopy(self.previous)
        failed = copy.deepcopy(self.current)
        self.assertEqual(failed['fundamentalsErrors'], ['valuation: The read operation timed out'])
        self.assertEqual(len(check_snapshots({'STOCKS': [before]}, {'STOCKS': [failed]})), 2)
        row = retain_valuation_evidence('300604', self.current, self.previous)
        self.assertEqual(check_snapshots({'STOCKS': [before]}, {'STOCKS': [row]}), [])
        for field in ('pe', 'peStatic', 'pb', 'mcap', 'valuationPrice', 'valuationAsOf',
                      'valuationSourceUrl', 'pePercentiles', 'peHistorySourceUrl'):
            self.assertEqual(row[field], before[field], field)
        for field in ('price', 'priceAsOf', 'r', 'returnAsOf', 'financialReports', 'fundamentalsErrors'):
            self.assertEqual(row[field], failed[field], field)
        self.assertEqual(row['price'], 180.49)
        self.assertEqual(row['valuationAsOf'], '2026-10-23')
        self.assertEqual(row['incomeShareEvidence']['currentShares'], before['incomeShareEvidence']['currentShares'])
        self.assertEqual(row['incomeShareEvidence']['reports'], failed['incomeShareEvidence']['reports'])
        self.assertIn('2026-10-23', row['valuationRefreshError'])
        report = data_quality.audit({'STOCKS': [row]}, date(2026, 10, 26))
        issues = next(d for d in report['datasets'] if d['id'] == 'stocks')['issues']
        notice = next(i for i in issues if i['code'] == 'stock_valuation_retained')
        self.assertEqual((notice['severity'], notice['affected']), ('warning', '300604'))
        self.assertIn('估值接口本次未返回有效记录', notice['message'])
        row['pePercentiles']['5']['value'] = 0
        self.assertEqual(self.previous, before)

    def test_fetch_stock_uses_new_quote_before_retaining_older_valuation(self):
        fields = set(parse_evidence('300604', [], [], '2026-10-26')) | {
            'pePercentiles', 'peHistorySourceUrl', 'fundamentalsErrors'}
        evidence = {k: v for k, v in self.current.items() if k in fields}
        stamp = datetime(2026, 10, 26, 7, tzinfo=timezone.utc).timestamp()

        def fetch(url, **_):
            if 'push2.eastmoney' in url:
                return {'data': {'f43': 18049, 'f86': stamp}}
            if 'push2his' in url:
                return {'data': {'klines': ['2026-10-23,202', '2026-10-26,180.49']}}
            raise AssertionError(url)

        item = next(x for x in stock_screen.STOCK_UNIVERSE if x['code'] == '300604')
        for incoming in (evidence, {**evidence, 'valuationAsOf': '2026-10-22', 'valuationPrice': 190}):
            with self.subTest(valuationAsOf=incoming['valuationAsOf']), \
                    patch.object(stock_screen, 'fetch_evidence', return_value=copy.deepcopy(incoming)), \
                    patch.object(stock_screen, 'fetch_json', side_effect=fetch), \
                    patch.object(stock_screen, 'dividend_evidence', return_value={'yield12': 0, 'divYears': 0}):
                row = stock_screen.fetch_stock(item, self.previous)
            self.assertEqual(row['price'], 180.49)
            self.assertEqual(row['priceAsOf'][:10], '2026-10-26')
            self.assertEqual(row['quoteSource'], 'Eastmoney quote')
            self.assertEqual(row['valuationPrice'], 202)
            self.assertEqual(row['valuationAsOf'], '2026-10-23')
            self.assertEqual(row['pePercentiles'], self.previous['pePercentiles'])

    def test_lagging_source_is_retained_without_lookahead_into_newly_announced_report(self):
        self.current['valuationAsOf'] = '2026-10-22'
        newer = {**self.current['financialReports'][0], 'reportDate': '2026-09-30',
                 'announcedAt': '2026-10-26', 'netProfit': 1}
        self.current['financialReports'].insert(0, newer)
        self.current['latestFinancials'] = newer
        self.current['fundamentalsAsOf'] = '2026-09-30'
        row = retain_valuation_evidence('300604', self.current, self.previous)
        self.assertEqual(row['fundamentalsAsOf'], '2026-09-30')
        self.assertEqual(row['peDynamicBasis']['reportDate'], '2026-06-30')
        self.assertEqual(row['peDynamicBasis']['valuationAsOf'], '2026-10-23')
        self.assertEqual(row['peDynamic'], self.previous['peDynamic'])
        self.assertIn('仅返回截至2026-10-22', row['valuationRefreshError'])

    def test_new_valid_loss_valuation_is_never_replaced_by_previous_positive_pe(self):
        quote = {'SECUCODE': '300604.SZ', 'SECURITY_CODE': '300604',
                 'TRADE_DATE': '2026-10-26', 'PE_TTM': -5, 'CLOSE_PRICE': 180.49,
                 'TOTAL_MARKET_CAP': 117e9}
        current = parse_evidence('300604', [quote], [], '2026-10-26')
        current['pePercentiles'] = percentile_evidence('300604', [quote], -5, '2026-10-26', {})
        self.previous['valuationRefreshStatus'] = 'retained_previous_valuation'
        self.previous['valuationRefreshError'] = 'old outage'
        expected = copy.deepcopy(current)
        self.assertEqual(retain_valuation_evidence('300604', current, self.previous), expected)
        self.assertEqual(current['pePercentiles']['5']['status'], 'loss')
        self.assertNotIn('valuationRefreshError', current)

    def test_unverified_or_mismatched_fallback_still_fails_existing_gate(self):
        for change in ({'c': '300605'}, {'valuationSourceUrl': ''}, {'peHistorySourceUrl': ''},
                       {'pePercentiles': {}}, {'pe': None}, {'valuationPrice': 0}):
            with self.subTest(change=change):
                row = retain_valuation_evidence('300604', copy.deepcopy(self.current), {**self.previous, **change})
                problems = check_snapshots({'STOCKS': [self.previous]}, {'STOCKS': [row]})
                self.assertTrue(any('valuationAsOf 日期倒退' in p for p in problems))
                self.assertTrue(any('5年PE历史退化' in p for p in problems))
        wrong_window = copy.deepcopy(self.previous)
        wrong_window['pePercentiles']['5']['end'] = '2026-10-26'
        self.assertIsNone(retain_valuation_evidence('300604', self.current, wrong_window)['valuationAsOf'])

    def test_stage_records_retained_valuation_as_partial_with_exact_warning(self):
        row = retain_valuation_evidence('300604', self.current, self.previous)
        item = next(x for x in stock_screen.STOCK_UNIVERSE if x['code'] == '300604')
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'snapshot.js'
            path.write_text(stock_screen.format_block([self.previous]))
            with patch.object(stock_screen, 'HTML', str(path)), \
                    patch.object(stock_screen, 'STOCK_UNIVERSE', [item]), \
                    patch.object(stock_screen, 'fetch_stock', return_value=row), \
                    patch.object(stock_screen, 'write_status') as status, \
                    patch('sys.argv', ['stock_screen.py']):
                self.assertEqual(stock_screen.main(), 0)
            self.assertEqual(status.call_args.args, ('stocks', 'partial'))
            warnings = status.call_args.kwargs['metadataWarnings']
            self.assertEqual(warnings, [{'code': '300604', 'message': row['valuationRefreshError']}])


if __name__ == '__main__':
    unittest.main()
