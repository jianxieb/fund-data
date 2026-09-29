import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update
from scripts.build_fund_actions import build_archive
from stock_fundamentals import parse_evidence, quality_review
from fund_evidence import fund_actions
from update import total_return_series
from scripts.build_crossborder_data import summarize


class ResearchEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.quote = {'SECUCODE': '601899.SH', 'SECURITY_CODE': '601899', 'TRADE_DATE': '2026-09-29',
                      'PE_TTM': 12, 'PB_MRQ': 3, 'TOTAL_MARKET_CAP': 200e8, 'CLOSE_PRICE': 30,
                      'BOARD_NAME': '工业金属'}
        self.reports = [{'SECUCODE': '601899.SH', 'SECURITY_CODE': '601899', 'REPORT_DATE': '%d-12-31' % y,
                         'NOTICE_DATE': '%d-03-01' % (y + 1), 'ROEJQ': 15, 'PARENTNETPROFIT': 10e8,
                         'NETCASH_OPERATE_PK': 12e8, 'TOTALOPERATEREVE': 50e8} for y in (2025, 2024, 2023)]

    def test_named_valuation_fields_and_annual_roe_keep_independent_dates(self):
        evidence = parse_evidence('601899', [self.quote], self.reports, '2026-09-29')
        self.assertEqual(evidence['pe'], 12)
        self.assertEqual(evidence['pb'], 3)
        self.assertEqual(evidence['mcap'], 200)
        self.assertEqual(evidence['valuationAsOf'], '2026-09-29')
        self.assertEqual(evidence['roeAsOf'], '2025-12-31')
        self.assertEqual(evidence['financialHistory'][0]['announcedAt'], '2026-03-01')

    def test_identity_future_quotes_and_unannounced_reports_cannot_enter_evidence(self):
        with self.assertRaisesRegex(ValueError, '身份'):
            parse_evidence('601899', [{**self.quote, 'SECUCODE': '600900.SH'}], [], '2026-09-29')
        future = [{**r, 'NOTICE_DATE': '2027-01-01'} for r in self.reports]
        evidence = parse_evidence('601899', [self.quote], future, '2026-09-28')
        self.assertIsNone(evidence['pe'])
        self.assertIsNone(evidence['roe'])
        self.assertFalse(evidence['financialHistory'])
        self.assertFalse(parse_evidence('601899', [], [{**self.reports[0], 'NOTICE_DATE': None}], '2026-09-29')['financialHistory'])

    def test_quality_screen_rejects_cashflow_gaps_missing_years_and_financial_industries(self):
        row = {**parse_evidence('601899', [self.quote], self.reports, '2026-09-29'),
               'historyFirst': '2010-01-01', 'n': '紫金矿业'}
        self.assertTrue(quality_review(row, '2026-09-29')['qualified'])
        for kind in ('cash', 'year', 'industry', 'roe', 'short'):
            changed = copy.deepcopy(row)
            if kind == 'cash': changed['financialHistory'][1]['operatingCashFlow'] = -1
            if kind == 'year': changed['financialHistory'][1]['year'] = 2022
            if kind == 'industry': changed['valuationIndustry'] = '银行Ⅱ'
            if kind == 'roe': changed['financialHistory'][1]['roe'] = None
            if kind == 'short': changed['historyFirst'] = '2023-01-01'
            self.assertFalse(quality_review(changed, '2026-09-29')['qualified'], kind)

    def test_cash_distribution_and_split_are_distinct_and_preserved(self):
        archive = {'160213': {'dividends': {'2025-05-13': 1.1, '2027-01-01': 2}, 'splits': {},
                              'observedAt': '2026-09-29', 'sourceUrl': 'https://fundf10.eastmoney.com/fhsp_160213.html'}}
        actions = fund_actions('160213', '2026-09-24', archive, [])
        self.assertEqual(actions['cash'], [{'date': '2025-05-13', 'perUnit': 1.1}])
        rows = [{'FSRQ': '2022-07-04', 'SPLIT_FACTOR': 4, 'ACTIONS_SOURCE': 'original history'}]
        actions = fund_actions('159941', '2026-09-24', {'159941': {'dividends': {}, 'splits': {}}}, rows)
        self.assertEqual(actions['splits'], [{'date': '2022-07-04', 'factor': 4}])
        self.assertFalse(actions['cash'])
        self.assertEqual(fund_actions('missing', '2026-09-24', {}, [])['status'], 'unavailable')

    def test_dividend_drop_and_split_do_not_create_false_losses_or_extra_gains(self):
        rows = [
            {'FSRQ': '2025-01-01', 'DWJZ': '10', 'FHFCZ': 0, 'SPLIT_FACTOR': 1},
            {'FSRQ': '2025-01-02', 'DWJZ': '9', 'FHFCZ': 1, 'SPLIT_FACTOR': 1},
            {'FSRQ': '2025-01-03', 'DWJZ': '3', 'FHFCZ': 0, 'SPLIT_FACTOR': 3},
        ]
        series = total_return_series(rows)
        self.assertAlmostEqual(series[-1][1], series[0][1])
        self.assertTrue(all(v is None for v in summarize(series, '2025-01-03')['r']))
        with self.assertRaisesRegex(ValueError, '缺口'):
            summarize([('2025-01-01', 1), ('2025-03-01', 2)], '2025-03-01')

    def test_official_split_survives_newer_empty_listing_in_a_cold_run(self):
        event = {'code': '159941', 'kind': 'split', 'date': '2022-07-04', 'value': 4,
                 'announcedAt': '2022-07-05', 'verifiedAt': '2026-09-29',
                 'sourceUrl': 'https://www.gffunds.com.cn/jjgg/zdsj/202207/t20220705_376047.shtml'}
        record = {'sourceUrl': 'https://fundf10.eastmoney.com/fhsp_159941.html', 'observedAt': '2026-09-29',
                  'sourceSha256': 'a' * 64, 'dividends': {}, 'splits': {}, 'verifiedEvents': [event]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'fund-actions.json'
            archive.write_text(json.dumps({'funds': {'159941': record}}))
            # A syntactically valid provider listing erroneously omits the split.
            (root / 'fhsp_159941.html').write_text("<table class='cfxq'>暂无分红信息</table><table class='fhxq'>暂无拆分信息</table>")
            snapshot = root / 'snapshot.js'; snapshot.write_text('fixture')
            with patch.object(update, 'HTML', snapshot), patch.object(update, 'parse_fund_lines', return_value=[('', '159941', '')]):
                rebuilt = build_archive(root, archive)['funds']['159941']
            self.assertEqual(rebuilt['splits'], {'2022-07-04': 4})
            self.assertEqual(rebuilt['verifiedEvents'], [event])
            with patch.object(update, 'ACTION_ARCHIVE', str(archive)), patch.object(update, 'FHSP_DIR', directory), patch.object(update, 'OFFLINE', True):
                rows = update.attach_corporate_actions('159941', [{'FSRQ': '2022-07-01', 'DWJZ': '4'},
                                                                 {'FSRQ': '2022-07-04', 'DWJZ': '1'}])
            self.assertEqual(rows[1]['SPLIT_FACTOR'], 4)
            self.assertEqual(rows[1]['ACTIONS_SOURCE'], event['sourceUrl'])
            self.assertEqual(total_return_series(rows)[-1][1], 1)

    def test_official_correction_requires_matching_fund_identity(self):
        with self.assertRaisesRegex(ValueError, '格式无效'):
            update.with_verified_actions('159941', {'verifiedEvents': [{'code': '513100'}]}, {'dividends': {}, 'splits': {}})


if __name__ == '__main__':
    unittest.main()
