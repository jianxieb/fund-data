import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import update
import stock_screen
from datetime import datetime
from scripts.build_fund_actions import build_archive
from stock_fundamentals import parse_evidence, quality_review, latest_report_review
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
        self.interims = [{**self.reports[0], 'REPORT_DATE': '%d-06-30' % y,
                          'NOTICE_DATE': '%d-08-12' % y, 'ROEJQ': 8, 'KCFJCXSYJLR': 9e8}
                         for y in (2026, 2025)]

    def test_named_valuation_fields_and_reported_roe_keep_independent_dates(self):
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
        row = {**parse_evidence('601899', [self.quote], self.interims + self.reports, '2026-09-29'),
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

    def test_growth_uses_reported_same_period_and_does_not_annualize_interim_roe(self):
        current = {**self.reports[0], 'REPORT_DATE': '2026-06-30', 'NOTICE_DATE': '2026-08-12',
                   'TOTALOPERATEREVE': 70e8, 'TOTALOPERATEREVETZ': 40,
                   'PARENTNETPROFIT': 12e8, 'PARENTNETPROFITTZ': 20,
                   'KCFJCXSYJLR': 11e8, 'KCFJCXSYJLRTZ': 22.2222,
                   'DJD_TOI_YOY': 999, 'DJD_DPNP_YOY': 999, 'ROEJQ': 8}
        prior = {**self.reports[0], 'REPORT_DATE': '2025-06-30', 'NOTICE_DATE': '2025-08-12',
                 'KCFJCXSYJLR': 9e8}
        evidence = parse_evidence('601899', [self.quote], [current, prior] + self.reports, '2026-09-29')
        latest = evidence['latestFinancials']
        self.assertEqual(latest['revenueGrowth'], 40)
        self.assertEqual(latest['netProfitGrowth'], 20)
        self.assertAlmostEqual(latest['deductedProfitGrowth'], 22.2222)
        self.assertEqual(latest['roe'], 8)
        self.assertEqual(latest['roePrevious'], 15)
        self.assertEqual(latest['roeChangePoints'], -7)
        self.assertEqual(evidence['roe'], 8)
        self.assertEqual(evidence['roeAsOf'], '2026-06-30')
        self.assertEqual(evidence['financialHistory'][0]['roe'], 15)
        self.assertEqual(latest['announcedAt'], '2026-08-12')
        before_release = parse_evidence('601899', [], [current, prior] + self.reports, '2026-08-11')
        self.assertEqual(before_release['latestFinancials']['reportDate'], '2025-12-31')
        self.assertEqual(before_release['roeAsOf'], '2025-12-31')

    def test_missing_current_roe_does_not_fall_back_to_a_high_annual_value(self):
        reports = [{**self.interims[0], 'ROEJQ': None}, self.interims[1]] + self.reports
        evidence = parse_evidence('601899', [self.quote], reports, '2026-09-29')
        self.assertIsNone(evidence['roe'])
        self.assertEqual(evidence['roeAsOf'], '2026-06-30')
        self.assertEqual(evidence['financialHistory'][0]['roe'], 15)
        row = {**evidence, 'historyFirst': '2010-01-01', 'n': '测试公司'}
        self.assertFalse(quality_review(row, '2026-09-29')['qualified'])

    def test_cached_stock_loses_qualification_when_next_report_becomes_due(self):
        row = {**parse_evidence('601899', [self.quote], self.interims + self.reports, '2026-09-29'),
               'c': '601899', 'n': '紫金矿业', 'historyFirst': '2010-01-01', 'latest': '2026-09-29'}
        row['qualityReview'] = quality_review(row, '2026-09-29')
        self.assertTrue(row['qualityReview']['qualified'])
        profile = next(x for x in stock_screen.STOCK_UNIVERSE if x['code'] == row['c'])
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory) / 'snapshot.js'
            snapshot.write_text(stock_screen.format_block([row]))
            with patch.object(stock_screen, 'HTML', str(snapshot)), \
                 patch.object(stock_screen, 'STOCK_UNIVERSE', [profile]), \
                 patch.object(stock_screen, 'fetch_stock', side_effect=RuntimeError('upstream unavailable')), \
                 patch.object(stock_screen, 'write_status'), patch.object(stock_screen, 'log'), \
                 patch.object(stock_screen, 'datetime') as clock, patch('sys.argv', ['stock_screen.py']):
                clock.now.return_value = datetime(2026, 10, 31)
                self.assertEqual(stock_screen.main(), 3)
            cached = stock_screen.load_old_rows(snapshot.read_text())[row['c']]
            self.assertFalse(cached['qualityReview']['qualified'])
            self.assertIn('缺截至2026-09-30', cached['qualityReview']['recentChecks'][0]['reason'])
            self.assertEqual(cached['latestFinancials']['reportDate'], '2026-06-30')
            self.assertEqual(cached['businessLabel'], profile['business'])
            self.assertEqual(cached['valuationIndustry'], row['valuationIndustry'])

    def test_loss_and_zero_bases_are_not_presented_as_normal_growth(self):
        reports = copy.deepcopy(self.reports)
        reports[0].update({'PARENTNETPROFIT': 10, 'PARENTNETPROFITTZ': 200})
        reports[1]['PARENTNETPROFIT'] = -10
        result = parse_evidence('601899', [], reports, '2026-09-29')['latestFinancials']
        self.assertIsNone(result['netProfitGrowth'])
        self.assertEqual(result['netProfitGrowthStatus'], '扭亏')
        reports[1]['PARENTNETPROFIT'] = 0
        result = parse_evidence('601899', [], reports, '2026-09-29')['latestFinancials']
        self.assertIsNone(result['netProfitGrowth'])
        self.assertEqual(result['netProfitGrowthStatus'], '上年同期为零')
        reports[0]['PARENTNETPROFIT'] = -20
        reports[1]['PARENTNETPROFIT'] = -10
        result = parse_evidence('601899', [], reports, '2026-09-29')['latestFinancials']
        self.assertEqual(result['netProfitGrowthStatus'], '亏损扩大')

    def test_three_year_growth_needs_four_annual_endpoints_and_positive_base(self):
        reports = copy.deepcopy(self.reports)
        reports[0]['TOTALOPERATEREVE'] = 80e8
        reports.append({**reports[0], 'REPORT_DATE': '2022-12-31', 'NOTICE_DATE': '2023-03-01',
                        'TOTALOPERATEREVE': 10e8, 'PARENTNETPROFIT': -1})
        evidence = parse_evidence('601899', [], reports, '2026-09-29')
        self.assertEqual(evidence['financialGrowth3']['revenue'], 100)
        self.assertEqual(evidence['financialGrowth3']['start'], '2022-12-31')
        self.assertIsNone(evidence['financialGrowth3']['netProfit'])
        self.assertEqual(len(evidence['financialHistory']), 3)
        self.assertIsNone(parse_evidence('601899', [], reports[:-1], '2026-09-29')['financialGrowth3']['revenue'])

    def test_quality_reasons_expose_declines_but_history_alone_no_longer_qualifies(self):
        reports = copy.deepcopy(self.reports)
        reports[0].update({'PARENTNETPROFIT': 5e8, 'PARENTNETPROFITTZ': -50, 'ROEJQ': 9})
        for report in reports:
            report['NETCASH_OPERATE_PK'] = 1e8
        row = {**parse_evidence('601899', [self.quote], reports, '2026-09-29'),
               'historyFirst': '2010-01-01', 'n': '紫金矿业',
               'financialGrowth3': {'revenue': -5, 'netProfit': -20}}
        review = quality_review(row, '2026-09-29')
        self.assertTrue(review['historicalQualified'])
        self.assertTrue(review['reviewRequired'])
        self.assertFalse(review['qualified'])
        self.assertAlmostEqual(review['cashProfitRatio3'], 3 / 25)
        self.assertTrue(any('平均ROE 13.0%' in s for s in review['reasons']))
        self.assertTrue(any('归母利润同比-50.0%' in s for s in review['watchouts']))
        self.assertTrue(any('经营现金流合计低于归母利润' in s for s in review['watchouts']))
        self.assertTrue(any('ROE低于10%' in s for s in review['watchouts']))
        self.assertFalse(any('复合增长-' in s for s in review['reasons']))
        self.assertTrue(any('3年归母利润复合增长-20.0%' in s for s in review['watchouts']))

    def test_dynamic_pe_annualizes_only_the_report_known_on_the_valuation_day(self):
        evidence = parse_evidence('601899', [{**self.quote, 'PE_LAR': 18}], self.interims + self.reports, '2026-09-29')
        self.assertEqual(evidence['pe'], 12)
        self.assertEqual(evidence['peStatic'], 18)
        self.assertEqual(evidence['peDynamic'], 10)  # 200亿元 / (10亿元 * 2)
        self.assertEqual(evidence['peDynamicBasis']['reportDate'], '2026-06-30')
        before = parse_evidence('601899', [{**self.quote, 'TRADE_DATE': '2026-08-11'}], self.interims + self.reports, '2026-09-29')
        self.assertEqual(before['peDynamic'], 20)
        self.assertEqual(before['peDynamicBasis']['reportDate'], '2025-12-31')
        loss = [{**r, 'PARENTNETPROFIT': -10e8} for r in self.interims]
        evidence = parse_evidence('601899', [self.quote], loss + self.reports, '2026-09-29')
        self.assertIsNone(evidence['peDynamic'])
        self.assertEqual(evidence['peDynamicBasis']['status'], 'loss')

    def test_high_annual_roe_does_not_override_deteriorating_interim_results(self):
        reports = [{**r, 'ROEJQ': value} for r, value in zip(self.reports, (31.26, 33.99, 40.96))]
        current = {**self.interims[0], 'ROEJQ': 10.73, 'TOTALOPERATEREVETZ': -28.9914,
                   'PARENTNETPROFITTZ': -32.013, 'KCFJCXSYJLRTZ': -42.9571}
        previous = {**self.interims[1], 'ROEJQ': 19.18}
        row = {**parse_evidence('601899', [self.quote], [current, previous] + reports, '2026-09-29'),
               'historyFirst': '2010-01-01', 'n': '测试公司'}
        review = quality_review(row, '2026-09-29')
        self.assertEqual(review['roe3'], 35.4)
        self.assertEqual(row['latestFinancials']['roeChangePoints'], -8.45)
        self.assertTrue(review['historicalQualified'])
        self.assertEqual(review['status'], 'review')
        self.assertFalse(review['qualified'])
        self.assertEqual([r['pass'] for r in review['recentChecks']], [True, True, False, False, False])
        failures = [r for r in review['recentChecks'] if not r['pass']]
        self.assertIn('28.99%，超过20%', failures[0]['reason'])
        self.assertIn('归母利润同比下降32.01%、扣非利润同比下降42.96%', failures[1]['reason'])
        self.assertIn('19.18%→10.73%，相对下降44.06%，超过30%', failures[2]['reason'])
        self.assertTrue(all(r['failureKind'] == 'threshold' for r in failures))

    def test_recent_screen_requires_due_report_and_same_period_roe(self):
        report = {'reportDate': '2026-06-30', 'roe': 7, 'roePrevious': 10,
                  'netProfit': 1, 'deductedProfit': 1, 'revenueGrowth': -20,
                  'netProfitGrowth': -20, 'deductedProfitGrowth': -20}
        self.assertTrue(all(c['pass'] for c in latest_report_review(report, '2026-09-29')))
        self.assertFalse(latest_report_review(report, '2026-10-31')[0]['pass'])
        report['roePrevious'] = None
        missing = latest_report_review(report, '2026-09-29')[-1]
        self.assertFalse(missing['pass'])
        self.assertEqual(missing['failureKind'], 'evidence')
        self.assertIn('缺上年同期ROE', missing['reason'])
        stale = latest_report_review(report, '2026-10-31')[0]
        self.assertEqual(stale['failureKind'], 'evidence')
        self.assertIn('缺截至2026-09-30', stale['reason'])
        self.assertIn('现有报告截至2026-06-30', stale['reason'])

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
