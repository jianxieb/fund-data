import copy
import json
import unittest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch

import stock_screen
from stock_dividends import (eastmoney_dividend_summary, source_split_factor,
                             update_dividend_fields, yahoo_dividend_summary)
from scripts.repair_stock_dividend_basis import repair

ROOT = Path(__file__).resolve().parents[1]


def event(day, cash=1, bonus=0, transfer=0, fiscal='2025-12-31', **overrides):
    return {'SECURITY_CODE': '123456', 'ASSIGN_PROGRESS': '实施分配',
            'NOTICE_DATE': day, 'EX_DIVIDEND_DATE': day, 'REPORT_DATE': fiscal,
            'PRETAX_BONUS_RMB': cash * 10 if cash is not None else None,
            'BONUS_RATIO': bonus, 'IT_RATIO': transfer, 'BONUS_IT_RATIO': bonus + transfer,
            **overrides}


class DividendShareBasisTests(unittest.TestCase):
    def test_same_day_cash_uses_pre_action_shares(self):
        row = event('2026-05-22', 1.8, transfer=4)
        result = eastmoney_dividend_summary([row], '2026-05-22', 100)
        self.assertAlmostEqual(result['cashDividend12'], 1.8 / 1.4)
        self.assertEqual(result['yield12'], 1.29)
        self.assertEqual(result['dividendCashRecords'][0]['cashPerShare'], 1.8)

    def test_several_actions_equal_cash_received_per_final_share(self):
        rows = [event('2026-01-02', .5), event('2026-03-02', 1, bonus=2, transfer=3),
                event('2026-05-02', .2), event('2026-07-02', .3, transfer=4),
                event('2026-09-02', .8)]
        # Independently simulate the cash and units of one original share.
        shares, cash = 1, 0
        for row in rows:
            cash += shares * row['PRETAX_BONUS_RMB'] / 10
            shares *= 1 + (row['BONUS_RATIO'] + row['IT_RATIO']) / 10
        before = copy.deepcopy(rows)
        result = eastmoney_dividend_summary(list(reversed(rows)), '2026-10-14', 10)
        self.assertAlmostEqual(result['cashDividend12'], cash / shares)
        self.assertEqual(rows, before)
        self.assertEqual(result['dividendCashRecords'][-1]['adjustmentFactor'], 1)

    def test_bonus_total_is_not_added_to_its_own_components(self):
        self.assertEqual(source_split_factor(event('2026-05-22', bonus=2, transfer=3)), 1.5)
        with self.assertRaisesRegex(ValueError, '总比例'):
            source_split_factor(event('2026-05-22', transfer=4, BONUS_IT_RATIO=5))

    def test_no_action_null_columns_are_known_no_bonus(self):
        row = event('2026-05-22', BONUS_RATIO=None, IT_RATIO=None, BONUS_IT_RATIO=None,
                    IMPL_PLAN_PROFILE='10派10.00元(含税)')
        result = eastmoney_dividend_summary([row], '2026-10-14', 10)
        self.assertEqual(result['yield12'], 10)
        self.assertEqual(result['divYears'], 1)
        self.assertEqual(result['dividendShareActions'], [])

    def test_missing_or_invalid_ratio_is_not_assumed_to_be_zero(self):
        row = event('2026-05-22')
        for key in ('BONUS_RATIO', 'IT_RATIO', 'BONUS_IT_RATIO'):
            row.pop(key)
        with self.assertRaisesRegex(ValueError, '缺已实施'):
            eastmoney_dividend_summary([row], '2026-10-14', 10)
        for value in ('bad', float('nan'), -1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                source_split_factor(event('2026-05-22', IT_RATIO=value))
        with self.assertRaisesRegex(ValueError, '方案含送转'):
            source_split_factor(event('2026-05-22', IMPL_PLAN_PROFILE='10转4派10元'))

    def test_pure_share_distribution_still_adjusts_earlier_cash(self):
        rows = [event('2026-03-01'), event('2026-06-01', None, transfer=10,
                 IMPL_PLAN_PROFILE='10转10.00')]
        result = eastmoney_dividend_summary(rows, '2026-10-14', 10)
        self.assertEqual(result['cashDividend12'], .5)
        self.assertEqual(result['divYears'], 1)

    def test_future_ex_date_or_announcement_cannot_adjust_past_cash(self):
        base = event('2026-05-22', 1)
        rows = [base, event('2026-11-01', 99, transfer=10, NOTICE_DATE='2026-08-01'),
                event('2026-06-01', 99, transfer=10, NOTICE_DATE='2026-10-15'),
                event('2026-06-01', 99, transfer=10, ASSIGN_PROGRESS='股东大会通过')]
        result = eastmoney_dividend_summary(rows, '2026-10-14', 10)
        self.assertEqual(result['cashDividend12'], 1)
        self.assertEqual(result['dividendShareActions'], [])

    def test_action_before_payment_and_outside_window_has_no_effect(self):
        rows = [event('2025-10-14', 5, transfer=10), event('2026-05-22', 1)]
        result = eastmoney_dividend_summary(rows, '2026-10-14', 10)
        self.assertEqual(result['cashDividend12'], 1)
        self.assertEqual(result['dividendShareActions'], [])

    def test_duplicate_rows_and_same_day_fiscal_records_change_shares_once(self):
        base = event('2026-05-22', 1, transfer=4)
        other = event('2026-05-22', .5, transfer=4, fiscal='2026-03-31')
        result = eastmoney_dividend_summary([base, base, other], '2026-10-14', 10)
        self.assertAlmostEqual(result['cashDividend12'], 1.5 / 1.4)
        self.assertEqual(len(result['dividendCashRecords']), 2)
        self.assertEqual(len(result['dividendShareActions']), 1)
        with self.assertRaisesRegex(ValueError, '记录冲突'):
            eastmoney_dividend_summary([base, {**base, 'PRETAX_BONUS_RMB': 50}], '2026-10-14', 10)

    def test_missing_cash_and_wrong_security_do_not_become_zero(self):
        with self.assertRaisesRegex(ValueError, '现金分红金额'):
            eastmoney_dividend_summary([event('2026-05-22', None)], '2026-10-14', 10)
        with self.assertRaisesRegex(ValueError, '身份'):
            eastmoney_dividend_summary([event('2026-05-22')], '2026-10-14', 10, 'another')
        for key, reason in [('ASSIGN_PROGRESS', '实施状态'), ('NOTICE_DATE', '实施公告日'),
                            ('EX_DIVIDEND_DATE', '除权日')]:
            row = event('2026-05-22')
            row.pop(key)
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, reason):
                eastmoney_dividend_summary([row], '2026-10-14', 10)
        self.assertEqual(eastmoney_dividend_summary([], '2026-10-14', 10)['yield12'], 0)

    def test_irrelevant_ancient_missing_data_does_not_erase_recent_evidence(self):
        old = event('1991-03-11', None, fiscal='1991-12-31')
        result = eastmoney_dividend_summary([old, event('2026-05-22')], '2026-10-14', 10)
        self.assertEqual(result['yield12'], 10)

    def test_api_wrapper_rejects_truncated_actions(self):
        payload = {'result': {'data': [event('2026-05-22')], 'count': 2, 'pages': 2}}
        with patch.object(stock_screen, 'fetch_json', return_value=payload):
            with self.assertRaisesRegex(RuntimeError, '分页截断'):
                stock_screen.dividend_evidence('123456', '2026-10-14', 10)

    def test_refresh_keeps_other_data_when_known_share_evidence_is_missing(self):
        stamp = datetime(2026, 10, 14, 7, tzinfo=timezone.utc).timestamp()
        invalid = event('2026-05-22', IMPL_PLAN_PROFILE='10转4派10元')
        def response(url, **_):
            if 'push2.eastmoney' in url:
                return {'data': {'f43': 1000, 'f86': stamp, 'f58': 'test'}}
            if 'push2his' in url:
                return {'data': {'klines': ['2026-10-13,100', '2026-10-14,102']}}
            if 'RPT_SHAREBONUS_DET' in url:
                return {'result': {'data': [invalid]}}
            raise AssertionError('known share-basis gap must not invoke a fallback: ' + url)
        with patch.object(stock_screen, 'fetch_evidence', return_value={}), \
                patch.object(stock_screen, 'fetch_json', side_effect=response):
            row = stock_screen.fetch_stock({'code': '123456', 'business': 'test', 'note': 'test'})
        self.assertIsNone(row['yield12'])
        self.assertIn('方案含送转', row['dividendMissing'])
        self.assertEqual(row['price'], 10)
        self.assertEqual(row['returnAsOf'], '2026-10-14')
        self.assertEqual(row['dataStatus'], 'computed')

    def test_yahoo_does_not_double_adjust_unverified_split_adjusted_cash(self):
        dividends = [{'date': '2026-05-22', 'amount': 1}]
        result = yahoo_dividend_summary(dividends, [{'date': '2026-05-22'}], '2026-10-14', 10)
        self.assertIsNone(result['yield12'])
        self.assertIn('缺统一股本口径', result['dividendMissing'])
        for split in ('2026-10-15', '2025-10-14'):
            self.assertEqual(yahoo_dividend_summary(dividends, [{'date': split}], '2026-10-14', 10)['yield12'], 10)

    def test_dividend_change_does_not_reapply_to_adjusted_returns(self):
        row = {'yield12': 4, 'style': ['长期核心', '高股息'], 'r': [30, 45, 80],
               'returnBasis': 'provider_backward_adjusted_close', 'price': 10,
               'priceAsOf': '2026-10-14', 'financialReports': [{'netProfit': 200}]}
        before = copy.deepcopy(row)
        result = eastmoney_dividend_summary([event('2026-05-22', .4, transfer=10)], '2026-10-14', 10)
        update_dividend_fields(row, result)
        self.assertEqual(row['style'], ['长期核心'])
        for key in ('r', 'returnBasis', 'price', 'priceAsOf', 'financialReports'):
            self.assertEqual(row[key], before[key])


class PublishedDividendRepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence = json.loads((ROOT / 'docs/evidence/audit-20261016/a-share-dividends-source.json').read_text())

    def test_official_deye_distributions_and_historical_cutoff(self):
        deye = next(row for row in self.evidence['companies'] if row['code'] == '605117')
        current = eastmoney_dividend_summary(deye['records'], '2026-10-14', 73.08, '605117')
        self.assertAlmostEqual(current['cashDividend12'], (1.108 + 1.8) / 1.4 + 1.6)
        self.assertEqual(current['yield12'], 5.03)
        # At the old report date the October ex-date was still in the future.
        historical = eastmoney_dividend_summary(deye['records'], '2026-10-01', 73.08, '605117')
        self.assertAlmostEqual(historical['cashDividend12'], (1.108 + 1.8) / 1.4)

    def test_all_71_frozen_companies_recompute_with_exactly_seven_corrections(self):
        expected = {'300394': .44, '688188': 2.05, '300573': 2.97, '688019': .2,
                    '300502': .22, '605117': 5.03, '300857': .11}
        changed = {}
        for company in self.evidence['companies']:
            result = eastmoney_dividend_summary(company['records'], company['asOf'], company['price'], company['code'])
            if result['yield12'] != company['previousYield12']:
                changed[company['code']] = result['yield12']
        self.assertEqual(len(self.evidence['companies']), 71)
        self.assertEqual(changed, expected)

    def test_minimal_repair_preserves_other_blocks_and_nondividend_fields(self):
        src = (ROOT / 'data/snapshot.js').read_text()
        output, report = repair(src, self.evidence)
        before, after = stock_screen.load_old_rows(src), stock_screen.load_old_rows(output)
        affected = {row['code'] for row in report['affected']}
        self.assertEqual(len(affected), 7)
        allowed = {'yield12', 'divYears', 'style', 'cashDividend12', 'dividendBasis',
                   'dividendCashRecords', 'dividendShareActions', 'dividendMissing'}
        for code in before:
            if code not in affected:
                self.assertEqual(before[code], after[code])
            else:
                for key in set(before[code]) | set(after[code]):
                    if key not in allowed:
                        self.assertEqual(before[code].get(key), after[code].get(key), (code, key))
        for marker, side in [('/*__DATA_STOCKS_BEGIN__*/', 0), ('/*__DATA_STOCKS_END__*/', 1)]:
            self.assertEqual(src.split(marker)[side], output.split(marker)[side])
        again, repeated = repair(output, self.evidence)
        self.assertEqual(output, again)
        self.assertEqual(repeated['updatedRows'], [])

    def test_repair_refuses_to_overwrite_newer_quotes(self):
        src = (ROOT / 'data/snapshot.js').read_text()
        evidence = copy.deepcopy(self.evidence)
        next(row for row in evidence['companies'] if row['code'] == '605117')['asOf'] = '2026-10-13'
        with self.assertRaisesRegex(ValueError, '日期已变化'):
            repair(src, evidence)


if __name__ == '__main__':
    unittest.main()
