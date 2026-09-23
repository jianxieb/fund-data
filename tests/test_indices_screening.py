import json
from datetime import date, timedelta, datetime, timezone
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import indices
from screens import fund_screen as screening


def weekdays(start='2020-09-18', end='2026-09-21'):
    day, last = date.fromisoformat(start), date.fromisoformat(end)
    rows = []
    while day <= last:
        if day.weekday() < 5:
            rows.append((day.isoformat(), 100 * 1.0001 ** len(rows)))
        day += timedelta(days=1)
    return rows


class IndexMetricsTests(unittest.TestCase):
    def test_anniversary_uses_previous_trading_day_and_keeps_missing_windows(self):
        result = indices.calculate([('2025-09-19', 100), ('2026-09-21', 120)])
        self.assertAlmostEqual(result['r'][0], 20)
        self.assertEqual(result['baseDates'][0], '2025-09-19')
        self.assertIsNone(result['r'][1])
        self.assertIsNone(result['mdd5'])

    def test_short_history_never_labels_partial_risk_as_five_years(self):
        result = indices.calculate(weekdays('2023-01-01'))
        self.assertIsNotNone(result['r'][0])
        self.assertIsNone(result['r'][3])
        self.assertIsNone(result['mdd5'])
        self.assertIsNone(result['vol5'])

    def test_complete_risk_includes_the_starting_peak(self):
        rows = weekdays()
        rows[-20] = (rows[-20][0], rows[-21][1] * .5)
        result = indices.calculate(rows)
        self.assertAlmostEqual(result['mdd5'], -50, places=3)
        self.assertGreater(result['vol5'], 0)

    def test_conflicting_closes_are_rejected(self):
        with self.assertRaisesRegex(ValueError, '冲突'):
            indices.normalize_series([('2026-09-18', 100), ('2026-09-18', 110)], '2026-09-21')

    def test_pre_base_chart_anchor_is_not_an_observation(self):
        spec = next(s for s in indices.SPECS if s['c'] == '899050')
        history = dict(points=[('2016-09-21', 1000), ('2022-04-29', 1000), ('2026-09-21', 1100)])
        result = indices.make_record(spec, history, asof='2026-09-21')
        self.assertEqual(result['first'], '2022-04-29')
        self.assertIsNone(result['r'][4])
        self.assertIsNone(result['mdd5'])

    def test_failure_uses_cache_original_date_and_returns_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            hist = Path(tmp) / 'history.json'
            output = Path(tmp) / 'indices.js'
            specs = [indices.SPECS[0], indices.SPECS[-1]]
            original = {'indices': {'000001': dict(c='000001', n='上证指数', source='test', sourceUrl='https://example.com',
                                                   points=[['2025-09-16', 100], ['2026-09-16', 110]])}}
            hist.write_text(json.dumps(original))
            with patch.object(indices, 'SPECS', specs), patch.object(indices, 'fetch_history', side_effect=RuntimeError('timeout')):
                code = indices.refresh('2026-09-21', history_path=hist, output_path=output)
            self.assertEqual(code, 1)
            content = output.read_text()
            self.assertIn('"asof":"2026-09-16"', content)
            self.assertIn('"status":"cached"', content)
            self.assertEqual(json.loads(hist.read_text())['indices'], original['indices'])

    def test_checked_in_artifact_is_reproducible_and_shanghai_is_populated(self):
        history = json.loads(indices.HISTORY_PATH.read_text())['indices']
        data = json.loads(indices.OUTPUT_PATH.read_text().split('var INDEX_DATA=', 1)[1].split(';\nvar INDEX_META=', 1)[0])
        self.assertEqual(len(data), 13)
        for row in data:
            if row['c'] == '8841431.WI':
                self.assertEqual(row['status'], 'unavailable')
                continue
            result = indices.calculate(indices.normalize_series(history[row['c']]['points'], row['asof']))
            for field in ('r', 'mdd5', 'vol5', 'first'):
                self.assertEqual(result[field], row[field], (row['c'], field))
        self.assertTrue(all(v is not None for v in data[0]['r']))


def research_row(code, manager=None, bucket='x1'):
    manager = manager or ('经理' + code)
    return dict(c=code, n='长期研究基金' + code, g=bucket, t='场外', ix='混合型-灵活',
                d='2010-01-01', navdate='2026-09-16', r=[10, 20, 25, 80, 170],
                sz=10, fee=[.4, .1, 0], mdd5=-20, vol5=15,
                mgr=manager, mten=5, st='开放', score=80,
                managerRecords=[dict(name=manager, start='2010-01-01', end=None)],
                managerAsOf='2026-09-16', managerStartBasis='explicit_individual_appointment')


class ScreeningTests(unittest.TestCase):
    def test_verified_nav_uses_the_return_endpoint_not_an_older_display_quote(self):
        history = [dict(FSRQ='2026-09-21', DWJZ='3.3550', JZZZL='0.72'),
                   dict(FSRQ='2026-09-10', DWJZ='3.1360', JZZZL='-0.44')]
        self.assertEqual(screening.latest_nav_observation(history, '2026-09-21'),
                         dict(nav=3.355, navdate='2026-09-21', dz=.72))
        self.assertIsNone(screening.latest_nav_observation(history, '2026-09-18'))
        self.assertIsNone(screening.latest_nav_observation(history +
                          [dict(FSRQ='2026-09-21', DWJZ='3.4000', JZZZL='0.72')], '2026-09-21'))

    def test_fallback_value_keeps_its_own_observation_date(self):
        self.assertEqual(screening.dated_value((3.136, '2026-09-10'), (3.355, '2026-09-21')),
                         (3.355, '2026-09-21'))
        self.assertEqual(screening.dated_value((3.136, None), (3.355, '2026-09-21')),
                         (3.355, '2026-09-21'))
        self.assertEqual(screening.dated_value((3.136, None), (None, '2026-09-21')),
                         (3.136, None))

    def test_scale_date_requires_its_own_matching_source_value(self):
        row = {'sz': 10.8}
        self.assertEqual(screening.checked_scale_observation(
            row, {'sz': 10.85, 'szdate': '2026-06-30'}, date(2026, 9, 24)),
            {'szdate': '2026-06-30'})
        with self.assertRaisesRegex(ValueError, '不符'):
            screening.checked_scale_observation(
                row, {'sz': 11.25, 'szdate': '2026-06-30'}, date(2026, 9, 24))
        with self.assertRaisesRegex(ValueError, '未来'):
            screening.checked_scale_observation(
                row, {'sz': 10.85, 'szdate': '2026-09-25'}, date(2026, 9, 24))
        with self.assertRaisesRegex(ValueError, '独立观察日'):
            screening.checked_scale_observation(row, {'sz': 10.85, 'szdate': None}, date(2026, 9, 24))

    def test_scale_reconciliation_cites_the_actual_cached_page_and_checks_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            page = cache / 'fhsp_000001.html'
            page.write_text('<title>示例基金(000001)基金分红送配</title>'
                            '净资产规模：<span>10.85 亿元 （截止至：2020-06-30）', encoding='utf-8')
            rows = [{'c': '000001', 'n': '示例基金', 'sz': 10.8, 'szdate': None}]
            with patch.object(screening, 'parse_snapshot_extra', return_value=rows), \
                    patch.object(screening.U, 'FHSP_DIR', str(cache)), \
                    patch.object(screening, 'JJFL_DIR', str(cache / 'jjfl')):
                result = screening.cmd_sync_scale_dates(SimpleNamespace(codes='all', apply=False))
                self.assertEqual(result[0]['newSizeDate'], '2020-06-30')
                self.assertEqual(result[0]['sourceUrl'], 'https://fundf10.eastmoney.com/fhsp_000001.html')
                page.write_text(page.read_text(encoding='utf-8').replace('(000001)', '(000002)'), encoding='utf-8')
                with self.assertRaisesRegex(RuntimeError, '未写入任何数据'):
                    screening.cmd_sync_scale_dates(SimpleNamespace(codes='all', apply=False))

    def test_later_scale_reconciliation_keeps_prior_source_evidence(self):
        previous = {'checkedAt': '2026-09-24T01:00:00+00:00',
                    'records': [{'code': '000001', 'newSizeDate': '2026-06-30'}]}
        result = screening.merge_scale_evidence(
            previous, [{'code': '000002', 'newSizeDate': '2026-06-30'}], '2026-09-24T02:00:00+00:00')
        self.assertEqual(result['count'], 2)
        self.assertEqual(result['records'][0]['checkedAt'], previous['checkedAt'])
        self.assertEqual(result['records'][1]['checkedAt'], result['checkedAt'])

    def test_institutional_share_is_not_a_default_candidate(self):
        row = research_row('000001')
        row['n'] = '示例长期混合I'
        result = screening.build_policy([row])
        self.assertEqual(result['shortlist'], [])
        self.assertIn('资格', result['byCode']['000001']['reason'])

    def test_manager_limit_does_not_delete_the_research_pool(self):
        rows = [research_row('%06d' % i, '同一经理') for i in range(1, 12)]
        result = screening.build_policy(rows)
        self.assertEqual(len(result['shortlist']), 2)
        self.assertEqual(result['counts']['total'], 11)
        self.assertEqual(result['managerCounts']['同一经理'], 2)

    def test_recent_returns_and_legacy_scores_do_not_change_selection(self):
        rows = [research_row('%06d' % i) for i in range(1, 20)]
        before = screening.build_policy(rows)['shortlist']
        rows[-1]['r'][0] = 9999
        rows[-1]['score'] = 9999
        self.assertEqual(screening.build_policy(rows)['shortlist'], before)

    def test_total_and_company_limits_across_buckets(self):
        rows = []
        for i in range(100):
            row = research_row('%06d' % i, bucket=['x1', 'x2', 'x3', 'x4', 'x5', 'x8', 'x9'][i % 7])
            row['company'] = '同一公司' if i < 20 else '公司%d' % i
            rows.append(row)
        result = screening.build_policy(rows)
        self.assertLessEqual(len(result['shortlist']), 24)
        self.assertLessEqual(result['companyCounts']['同一公司'], 3)

    def test_missing_fee_is_visible_without_hiding_eligible_research(self):
        row = research_row('000001')
        row['fee'] = [None, None, None]
        result = screening.build_policy([row])
        self.assertEqual(result['shortlist'], ['000001'])
        self.assertIsNone(screening.research_record(row)['feeAnnual'])
        self.assertTrue(any('未知' in flag for flag in result['byCode']['000001']['flags']))

    def test_promoted_fund_distinguishes_unknown_service_fee_from_explicit_zero(self):
        spec = dict(code='000001', g='sp', t='场外', ix='示例指数', note='测试')
        with patch.object(screening, 'jjfl_page', return_value=''), \
                patch.object(screening, 'fee_info', return_value=dict(fee_m=.5, fee_c=.1)), \
                patch.object(screening, '_metrics_of', return_value={}), \
                patch.object(screening, '_v3_mdd3', return_value=(None, None)):
            for raw, expected in [(None, None), ('0.00%', 0.0), ('0.20%', .2)]:
                with self.subTest(fee=raw):
                    enriched = {'000001': {'basic': {'fee_s': raw}}}
                    generated = screening.fund_line(spec, {}, enriched, {})
                    row = screening.parse_js_record(generated)
                    self.assertEqual(row['fee'], [.5, .1, expected])

    def test_etf_unknown_service_fee_stays_unknown_after_policy(self):
        row = research_row('000001', bucket='x4')
        row.update(n='示例宽基ETF', t='场内ETF', ix='宽基指数', fee=[.5, .1, None])
        normalized = screening.research_record(row)
        self.assertIsNone(normalized['feeAnnual'])
        self.assertAlmostEqual(normalized['feeKnownAnnual'], .6)
        result = screening.build_policy([row])
        item = result['byCode']['000001']
        self.assertIn('000001', result['shortlist'])
        self.assertEqual(item['feeUnknownItems'], ['销售服务费'])
        self.assertEqual(item['feeScope'], 'known_items_only')
        self.assertTrue(any('未知' in flag for flag in item['flags']))
        self.assertIsNone(row['fee'][2])
        row['fee'][2] = 0
        explicit_zero = screening.research_record(row)
        self.assertAlmostEqual(explicit_zero['feeAnnual'], .6)
        self.assertEqual(explicit_zero['feeMissing'], [])

    def test_cash_added_to_cumulative_nav_does_not_dampen_fund_risk(self):
        rows = []
        for i, (day, _) in enumerate(weekdays()):
            nav = max(1.6, 2.3 - max(0, i - 450) * .002)
            rows.append(dict(FSRQ=day, DWJZ=nav, LJJZ=nav + 3.168,
                             FHFCZ=0, SPLIT_FACTOR=1))
        result = screening.deep_metrics(rows)
        self.assertAlmostEqual(result['mdd5'], (1.6 / 2.3 - 1) * 100)
        dampened_mdd = ((1.6 + 3.168) / (2.3 + 3.168) - 1) * 100
        self.assertLess(result['mdd5'], dampened_mdd - 10)

    def test_representative_prefers_a_share_not_high_return_i_share(self):
        rows = [dict(name='示例混合I', code='000001', estab='2010-01-01', r5w=1000),
                dict(name='示例混合A', code='000002', estab='2015-01-01', r5w=1)]
        self.assertEqual(min(rows, key=screening.representative_key)['code'], '000002')

    def test_gold_and_pure_bond_are_not_excluded_for_low_returns(self):
        self.assertIsNone(screening.exclusion_reason(dict(code='000001', name='示例纯债A', ftype='债券型-长债'), page=set()))
        self.assertIsNone(screening.exclusion_reason(dict(code='000002', name='示例黄金ETF', ftype='商品'), page=set()))
        self.assertEqual(screening.classify('示例黄金ETF', ['fb:all']), '商品/黄金')

    def test_prefilter_keeps_low_return_defensive_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'data'
            directory.mkdir()
            funds = {code: dict(code=code, name=name, estab='2016-01-01', r5w=1, rsince=5, srcs=['kf:all'])
                     for code, name in [('999991', '示例纯债A'), ('999992', '示例黄金ETF')]}
            (directory / 'universe.json').write_text(json.dumps(dict(asof='2026-09-16', funds=funds)))
            with patch.object(screening, 'DATA', str(directory)), patch.object(screening, 'CACHE', str(Path(tmp) / 'cache')):
                screening.cmd_prefilter(SimpleNamespace())
            result = json.loads((directory / 'shortlist.json').read_text())
            self.assertEqual(len(result['kept']), 2)

    def test_fund_risk_requires_a_full_window_and_yearly_includes_first_day(self):
        series = weekdays('2023-01-01')
        with patch.object(screening.U, 'total_return_series', return_value=series):
            result = screening.deep_metrics([{}])
        self.assertNotIn('mdd5', result)
        self.assertNotIn('vol5', result)
        prior = [v for d, v in series if d.startswith('2023')][-1]
        current = [v for d, v in series if d.startswith('2024')][-1]
        self.assertAlmostEqual(result['yearly']['2024'], (current / prior - 1) * 100)
        self.assertNotIn('2023', result['yearly'])

    def test_pre_window_gap_does_not_become_fake_since_inception_history(self):
        rows = [dict(FSRQ='2002-10-18', DWJZ='1', FHFCZ='0', SPLIT_FACTOR='1')]
        rows += [dict(FSRQ=d, DWJZ=str(v), FHFCZ='0', SPLIT_FACTOR='1')
                 for d, v in weekdays('2016-09-01')]
        result = screening.deep_metrics(rows)
        self.assertIsNotNone(result['ret10'])
        self.assertFalse(result['historyComplete'])
        self.assertNotIn('cagr_since', result)
        self.assertNotIn('mdd_all', result)
        self.assertGreaterEqual(result['first'], '2016-09-01')

    def test_verifying_a_subset_keeps_previous_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / 'data'
            directory.mkdir()
            previous = dict(code='000002', oldAsOf='2026-09-16', oldR=[1] * 5,
                            oldMdd5=-20, oldVol5=15, oldFees=[.4, .1, 0], asof='2026-09-21')
            (directory / 'screening-validation.json').write_text(json.dumps([previous]))
            metric = dict(first='2010-01-01', latest='2026-09-21', rows=3000,
                          basis='provider_daily_return_or_explicit_actions', ret1=1, ret2=2, ret3=3, ret5=4, ret10=5)
            current = research_row('000001')
            current['returnAsOf'] = '2026-09-18'
            with patch.object(screening, 'ROOT', tmp), patch.object(screening, 'parse_snapshot_extra', return_value=[current]), \
                    patch.object(screening.U, 'history_fetch', return_value=[{'FSRQ': '2026-09-16'}]), \
                    patch.object(screening, 'deep_metrics', return_value=metric), \
                    patch.object(screening, 'get', return_value='fixture'), \
                    patch.object(screening, 'fee_info', return_value=dict(fee_m=.4, fee_c=.1, fee_s=0)):
                screening.cmd_verify_samples(SimpleNamespace(codes='000001', apply=False))
            updated = json.loads((directory / 'screening-validation.json').read_text())
            self.assertEqual({r['code'] for r in updated}, {'000001', '000002'})
            self.assertEqual(next(r for r in updated if r['code'] == '000001')['oldAsOf'], '2026-09-18')

    def test_official_type_overrides_the_name_keyword(self):
        row = dict(name='中信保诚有色指数A', years=10, srcs=['kf:all'])
        self.assertEqual(screening.classify_enriched(row, {'ftype': '指数型-股票'}), '指数/指数增强')
        row = dict(name='稳健投资A', years=10, srcs=['kf:all'])
        self.assertEqual(screening.classify_enriched(row, {'ftype': '债券型-长债'}), '债券/固收')

    def test_actual_policy_counts_and_limits_match_snapshot(self):
        policy_path = Path(screening.ROOT) / 'data' / 'screening.js'
        policy = json.loads(policy_path.read_text().split('var SCREEN_POLICY=', 1)[1].rsplit(';', 1)[0])
        records = screening.parse_snapshot_extra()
        self.assertEqual(len(records), policy['counts']['total'])
        self.assertEqual(len(policy['shortlist']), policy['counts']['shortlist'])
        self.assertLessEqual(len(policy['shortlist']), 24)
        self.assertTrue(all(n <= 2 for n in policy['managerCounts'].values()))
        self.assertTrue(all(n <= 3 for n in policy['companyCounts'].values()))

    def test_equity_returns_rank_before_low_risk_or_fees(self):
        high = research_row('000001')
        low = research_row('000002')
        high.update(r=[1, 1, 50, 150, 220], mdd5=-55, fee=[1.5, .25, 0])
        low.update(r=[999, 20, 25, 80, 170], mdd5=-1, fee=[.1, .01, 0], score=999)
        result = screening.build_policy([low, high])
        self.assertEqual(result['shortlist'], ['000001', '000002'])

    def test_debt_and_dividend_have_independent_research_categories(self):
        equity = research_row('000001')
        bond = research_row('000002')
        bond.update(ix='混合型-偏债', mdd5=-1, r=[1, 2, 3, 5, None])
        dividend = research_row('000003')
        dividend.update(n='示例红利指数A', ix='中证红利指数', mdd5=-2)
        result = screening.build_policy([equity, bond, dividend])
        self.assertEqual(result['shortlist'], ['000001'])
        self.assertEqual(result['byCode']['000002']['category'], 'fixed_income')
        self.assertEqual(result['byCode']['000003']['category'], 'dividend')
        self.assertFalse(result['byCode']['000002']['equityEligible'])
        self.assertNotIn('8%', result['byCode']['000002']['reason'])
        self.assertNotIn('5%', result['byCode']['000002']['reason'])

    def test_manager_exact_anniversary_and_individual_dates(self):
        row = research_row('000001')
        row['managerRecords'][0]['start'] = '2021-09-17'
        row['mten'] = 20  # A legacy team number must not override actual dates.
        self.assertEqual(screening.build_policy([row])['shortlist'], [])
        row['managerRecords'][0]['start'] = '2021-09-16'
        row['managerRecords'].append(dict(name='新协同经理', start='2026-01-01', end=None))
        result = screening.build_policy([row])
        self.assertEqual(result['shortlist'], ['000001'])
        self.assertEqual(result['byCode']['000001']['thresholdInputs']['managerYears'], 5)
        self.assertTrue(any('并非全员' in flag for flag in result['byCode']['000001']['flags']))

    def test_nested_manager_literals_are_data_not_executable_expressions(self):
        row = screening.parse_js_record("{c:'000001',managerRecords:[{name:'LIU DONG(刘冬)',start:'2020-01-01',end:null}],r:[1,null,3]},")
        self.assertEqual(row['managerRecords'][0]['name'], 'LIU DONG(刘冬)')
        with self.assertRaises(ValueError):
            screening.parse_js_record("{c:'000001',x:dangerous()}")

    def test_hang_seng_a_share_index_is_not_overseas(self):
        row = research_row('540012', bucket='x2')
        row.update(n='汇丰晋信恒生龙头指数A', ix='恒生A股行业龙头指数')
        item = screening.build_policy([row])['byCode']['540012']
        self.assertEqual(item['category'], 'equity')
        self.assertEqual(item['region'], 'cn')

    def test_new_qualifying_legacy_row_is_not_marked_verified(self):
        row = research_row('000001')
        result = screening.build_policy([row])
        self.assertEqual(result['shortlist'], ['000001'])
        self.assertEqual(result['byCode']['000001']['verificationStatus'], 'legacy_unverified')
        self.assertEqual(result['counts']['shortlistRecomputed'], 0)

    def test_dynamic_inputs_remain_available_below_default_thresholds(self):
        row = research_row('000001')
        row['r'][3] = 35
        result = screening.build_policy([row])
        item = result['byCode']['000001']
        self.assertTrue(item['equityEligible'])
        self.assertFalse(item['defaultQualified'])
        self.assertIsNotNone(item['thresholdInputs']['a5'])
        self.assertEqual(result['universe'], ['000001'])

    def test_policy_annualization_uses_actual_return_dates(self):
        row = research_row('000001')
        row['returnPeriods'] = [dict(years=3, start='2023-09-15', end='2026-09-16'),
                                dict(years=5, start='2021-09-16', end='2026-09-16')]
        result = screening.build_policy([row])['byCode']['000001']
        years3 = (date(2026, 9, 16) - date(2023, 9, 15)).days / 365.2425
        expected = ((1 + row['r'][2] / 100) ** (1 / years3) - 1) * 100
        self.assertAlmostEqual(result['thresholdInputs']['a3'], expected)
        self.assertEqual(result['annualization']['3']['basis'], 'actual_days/365.2425')
        interval = (date(2023, 9, 15) - date(2021, 9, 16)).days / 365.2425
        expected_prior = (((1 + row['r'][3] / 100) / (1 + row['r'][2] / 100)) ** (1 / interval) - 1) * 100
        self.assertAlmostEqual(result['intervalEvidence']['prior2Annual'], expected_prior)

    def test_paused_purchase_is_a_status_not_a_research_exclusion(self):
        row = research_row('000001')
        row['st'] = '暂停'
        result = screening.build_policy([row])
        self.assertEqual(result['shortlist'], ['000001'])
        self.assertTrue(any('暂停' in flag for flag in result['byCode']['000001']['flags']))

    def test_recent_legacy_enrichment_cache_still_migrates_individual_dates(self):
        observed = '2026-09-21T06:00:00+00:00'
        current = dict(bucket='国内权益', forced=False)
        previous = dict(current, basic={'name': '旧基金'}, fetchedAt=observed,
                        manager_hist=[{'start': '2020-01-01', 'names': ['甲', '乙']}])
        now = datetime(2026, 9, 21, 7, tzinfo=timezone.utc)
        self.assertTrue(screening.enriched_needs_refresh(previous, current, now))
        previous['manager_info'] = dict(managerStartBasis='explicit_individual_appointment',
                                       managerRecords=[{'name': '甲', 'start': '2015-01-01'}], managerCheckedAt=observed)
        self.assertFalse(screening.enriched_needs_refresh(previous, current, now))

    def test_html_retains_dated_manager_evidence_when_refresh_fails(self):
        previous = research_row('000001')
        previous.update(managerCheckedAt='2026-09-20T04:00:00+00:00', managerAsOf='2026-09-20',
                        managerSourceUrl='https://example.com/manager', managerSourceSha256='source-hash',
                        managerDataStatus='checked', legacyManagerStart='2024-01-01')
        result = screening.manager_fields_for_output(dict(managerDataStatus='unavailable', mstart='2026-09-21', mgr='未经验证的新组合'), previous)
        for key in ('managerRecords', 'managerCheckedAt', 'managerAsOf', 'managerSourceUrl', 'managerSourceSha256', 'legacyManagerStart'):
            self.assertEqual(result[key], previous[key])
        self.assertEqual(result['mgr'], previous['mgr'])
        self.assertEqual(result['managerDataStatus'], 'refresh_failed')
        legacy = screening.manager_fields_for_output({'managers': '甲', 'cur_start': '2026-01-01'}, {})
        self.assertIsNone(legacy['mstart'])
        self.assertIsNone(legacy['mten'])
        self.assertEqual(legacy['managerDataStatus'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
