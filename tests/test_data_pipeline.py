import tempfile
import unittest
import subprocess
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import data_quality
import data_status
import refresh
import stock_screen
import strategy_backtest as strategy
import update


class FundReturns(unittest.TestCase):
    def test_action_coverage_requires_both_recognized_tables(self):
        dividend = "<table class='comm cfxq'><tr><td>2025-05-13</td><td>每10份派现金11.0000元</td></tr></table>"
        split = "<table class='comm fhxq'><tr><td>2022年</td><td>2022-03-29</td><td>份额分拆</td><td>1:2.0000</td></tr></table>"
        self.assertIsNone(update.parse_actions_page(dividend))
        actions = update.parse_actions_page(dividend + split)
        self.assertEqual(actions['dividends']['2025-05-13'], 1.1)
        self.assertEqual(actions['splits']['2022-03-29'], 2)

    def test_irrelevant_pre_window_source_gap_is_not_filled_or_used(self):
        start = date(2016, 9, 14)
        rows = [{'FSRQ': (start + timedelta(days=i)).isoformat(), 'DWJZ': 1, 'JZZZL': 0} for i in range(3657)]
        rows.insert(0, {'FSRQ': '2015-01-19', 'DWJZ': '--'})
        result = update.calc_metrics(rows)
        self.assertEqual(result['r'], [0] * 5)
        self.assertGreaterEqual(result['first'], '2016-09-14')

    def test_dividend_is_reinvested_without_guessing_the_market_move(self):
        rows = [
            {'FSRQ': '2025-01-01', 'DWJZ': 10, 'LJJZ': 10},
            {'FSRQ': '2025-01-02', 'DWJZ': 10, 'LJJZ': 11, 'FHFCZ': 1},
            {'FSRQ': '2025-01-03', 'DWJZ': 9, 'LJJZ': 11, 'FHFCZ': 1},
        ]
        result = update.total_return_series(rows)
        self.assertAlmostEqual(result[-1][1], 1.1)

    def test_explicit_split_is_not_a_loss(self):
        result = update.total_return_series([
            {'FSRQ': '2025-01-01', 'DWJZ': 10},
            {'FSRQ': '2025-01-02', 'DWJZ': 5, 'SPLIT_FACTOR': 2},
        ])
        self.assertEqual(result[-1][1], 1)

    def test_cumulative_nav_alone_does_not_prove_total_return(self):
        with self.assertRaises(ValueError):
            update.total_return_series([
                {'FSRQ': '2025-01-01', 'DWJZ': 10, 'LJJZ': 10},
                {'FSRQ': '2025-01-02', 'DWJZ': 9, 'LJJZ': 10},
            ])

    def test_short_history_does_not_claim_three_year_risk(self):
        start = date(2025, 1, 1)
        rows = [{'FSRQ': (start + timedelta(days=i)).isoformat(), 'DWJZ': 1 + i / 1000, 'JZZZL': 0.1} for i in range(250)]
        metrics = update.calc_metrics(rows)
        self.assertIsNone(metrics['v3'])
        self.assertIsNone(metrics['mdd3'])
        self.assertEqual(metrics['r'], [None] * 5)

    def test_dividend_adjusted_daily_change(self):
        rows = [{'FSRQ': '2025-01-01', 'DWJZ': 10},
                {'FSRQ': '2025-01-02', 'DWJZ': 9, 'FHFCZ': 1}]
        growth, base = update.dz_from_hist(rows, '2025-01-02')
        self.assertEqual((growth, base), (0, '2025-01-01'))


class FundManagers(unittest.TestCase):
    checked_at = '2026-09-21T12:00:00+00:00'
    source_url = 'https://fundf10.eastmoney.com/jjjl_050025.html'

    @staticmethod
    def biography(name, start):
        return '<div class="jl_intro"><div class="text"><p><strong>姓名：</strong><a href="/manager/1.html">%s</a></p><p><strong>上任日期：</strong>%s</p></div></div>' % (name, start)

    def test_individual_appointment_is_not_the_latest_team_change(self):
        history = '<table><tr><td>2021-09-23</td><td>至今</td><td>万琼</td></tr></table>'
        parsed = update.manager_parse(history + self.biography('万琼', '2015-10-08'), self.checked_at, self.source_url)
        self.assertEqual(parsed['mstart'], '2015-10-08')
        self.assertGreater(parsed['mten'], 10)
        self.assertEqual(parsed['managerAsOf'], '2026-09-21')

    def test_multiple_manager_dates_remain_individual(self):
        parsed = update.manager_parse(self.biography('甲', '2015-01-01') + self.biography('乙', '2025-01-01'), self.checked_at, self.source_url)
        self.assertIsNone(parsed['mstart'])
        self.assertIsNone(parsed['mten'])
        self.assertEqual([row['start'] for row in parsed['managerRecords']], ['2015-01-01', '2025-01-01'])
        self.assertLess(parsed['managerTenureMin'], 2)
        self.assertGreater(parsed['managerTenureMax'], 11)

    def test_missing_individual_date_does_not_borrow_a_team_date(self):
        parsed = update.manager_parse('<table><td>2020-01-01</td><td>至今</td></table>' + self.biography('甲', '--'), self.checked_at, self.source_url)
        self.assertEqual(parsed['mgr'], '甲')
        self.assertIsNone(parsed['mstart'])
        self.assertIsNone(parsed['managerRecords'][0]['tenureYears'])

    def test_manager_short_of_five_years_is_not_rounded_into_eligibility(self):
        parsed = update.manager_parse(self.biography('甲', '2021-09-22'), self.checked_at, self.source_url)
        self.assertLess(parsed['mten'], 5)
        self.assertEqual(parsed['managerRecords'][0]['tenureText'], '4年364天')

    def test_manager_cache_replay_preserves_actual_observation_time(self):
        import json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory, patch.object(update, 'MANAGER_DIR', directory), patch.object(update, 'OFFLINE', True), patch.object(update, 'http_get') as network:
            Path(directory, '050025.json').write_text(json.dumps({'html': self.biography('甲', '2015-01-01'), 'fetchedAt': self.checked_at, 'sourceUrl': self.source_url}))
            result = update.manager_fetch('050025', refresh=True)
        network.assert_not_called()
        self.assertEqual(result['managerCheckedAt'], self.checked_at)
        self.assertEqual(result['managerDataStatus'], 'cached')

    def test_invalid_manager_refresh_keeps_previous_source_date(self):
        import json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory, patch.object(update, 'MANAGER_DIR', directory), patch.object(update, 'OFFLINE', False), patch.object(update, 'http_get', return_value='<html>invalid response</html>'):
            Path(directory, '050025.json').write_text(json.dumps({'html': self.biography('甲', '2015-01-01'), 'fetchedAt': self.checked_at, 'sourceUrl': self.source_url}))
            result = update.manager_fetch('050025', refresh=True)
        self.assertEqual(result['managerCheckedAt'], self.checked_at)
        self.assertEqual(result['managerDataStatus'], 'refresh_failed')
        self.assertEqual(result['mgr'], '甲')

    def test_manager_patch_preserves_other_fund_fields_and_other_blocks(self):
        source = "/*__DATA_FUNDS_BEGIN__*/\nvar FUNDS=[{c:'050025',r:[1,2,3,4,5],sz:10}];\n/*__DATA_FUNDS_END__*/\nvar EXTRA=[{c:'000001',mgr:'旧经理',mstart:'2001-01-01'}];"
        output, count = update.apply_fund_patches(source, {'050025': {'mgr': '"万琼"', 'managerRecords': '[{"name":"万琼","start":"2015-10-08"}]'}})
        output, _ = update.apply_fund_patches(output, {'050025': {'managerRecords': '[{"name":"万琼","start":"2015-10-08"}]'}})
        self.assertEqual(count, 1)
        self.assertIn('r:[1,2,3,4,5],sz:10', output)
        self.assertEqual(output.split('/*__DATA_FUNDS_END__*/')[1], source.split('/*__DATA_FUNDS_END__*/')[1])
        self.assertEqual(output.count('managerRecords:'), 1)


class Benchmarks(unittest.TestCase):
    @staticmethod
    def full_window():
        begin, end = date(2021, 9, 17), date(2026, 9, 18)
        return [((begin + timedelta(days=i)).isoformat(), 100.0)
                for i in range((end - begin).days + 1) if (begin + timedelta(days=i)).weekday() < 5]

    def test_five_year_risk_requires_full_window_and_uses_initial_peak(self):
        series = self.full_window()
        series = [(day, 200.0 if i == 0 else 100.0) for i, (day, _) in enumerate(series)]
        result = update.risk_window(series, '2026-09-18', 5)
        self.assertEqual(result['mdd'], -50)
        self.assertEqual(result['start'], '2021-09-17')
        partial = update.risk_window(series[100:], '2026-09-18', 5)
        self.assertIsNone(partial['mdd'])

    def test_yuan_risk_uses_daily_fx_instead_of_reusing_dollar_risk(self):
        series = self.full_window()
        rates = [(day, 7.0 if i < 500 else 5.6) for i, (day, _) in enumerate(series)]
        usd = update.risk_window(series, '2026-09-18', 5)
        cny = update.currency_risk_window(series, rates, '2026-09-18', 5)
        self.assertEqual(usd['mdd'], 0)
        self.assertAlmostEqual(cny['mdd'], -20)
        self.assertGreater(cny['vol'], usd['vol'])

    def test_missing_fx_day_does_not_create_filled_or_dollar_risk(self):
        series = self.full_window()
        rates = [(day, 7.0) for i, (day, _) in enumerate(series) if i != 500]
        result = update.currency_risk_window(series, rates, '2026-09-18', 5)
        self.assertEqual(result['status'], 'incomplete_fx')
        self.assertEqual(result['missingFxDates'], [series[500][0]])
        self.assertIsNone(result['mdd'])

    def test_forex_chart_dates_follow_london_daylight_saving_time(self):
        from datetime import datetime, timezone
        summer = int(datetime(2026, 9, 17, 23, tzinfo=timezone.utc).timestamp())
        winter = int(datetime(2026, 1, 8, 0, tzinfo=timezone.utc).timestamp())
        node = {'meta': {'symbol': 'CNY=X', 'exchangeTimezoneName': 'Europe/London', 'currency': 'CNY'},
                'timestamp': [winter, summer], 'indicators': {'adjclose': [{'adjclose': [7, 6.7]}]}}
        output = strategy.normalize_chart(node, 'CNY=X', 'https://query1.finance.yahoo.com')
        self.assertEqual([row['date'] for row in output['data']], ['2026-01-08', '2026-09-18'])
        self.assertEqual(output['data'][-1]['timestamp'], summer)
        self.assertEqual(output['dateConvention'], 'exchange_local_date')

    def test_fx_cache_without_timezone_proof_is_rejected(self):
        import json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory, patch.object(strategy, 'CACHE_DIR', directory):
            Path(strategy.cache_path('CNY=X')).write_text(json.dumps({'schemaVersion': 2, 'basis': 'yahoo_adjusted_close', 'symbol': 'CNY=X', 'data': []}))
            with self.assertRaises(RuntimeError):
                strategy.load_history('CNY=X', offline=True)

    def test_fx_source_failure_is_explicit_without_an_unverified_replacement(self):
        def history(symbol, **_kwargs):
            if symbol == 'CNY=X':
                raise RuntimeError('FX upstream timeout')
            return {'2025-09-18': 100.0, '2026-09-18': 120.0}
        with patch.object(strategy, 'load_history', side_effect=history), patch.object(update, 'kline_closes') as fallback:
            computed = update.bench_compute('2026-09-18')
        fallback.assert_not_called()
        self.assertFalse(computed['complete'])
        self.assertAlmostEqual(computed['bm'][0]['usd'][0], 20.0)
        self.assertEqual(computed['bm'][0]['cny'], [None] * 5)

    def test_currency_quote_direction(self):
        self.assertAlmostEqual(update.convert_usd_return(10, 7, 7.7), 21)
        self.assertAlmostEqual(update.convert_usd_return(0, 7.7, 7), -9.09090909)

    def test_observation_before_weekend_and_stale_rejection(self):
        values = [('2026-09-18', 100)]
        self.assertEqual(update.observation_at(values, '2026-09-20'), ('2026-09-18', 100))
        self.assertIsNone(update.observation_at(values, '2026-10-01'))

    def test_duplicate_distinct_index_paths_are_quarantined(self):
        start = date(2025, 1, 1)
        values = {(start + timedelta(days=i)).isoformat(): 100 + i for i in range(300)}
        with patch.object(strategy, 'load_history', return_value=values):
            computed = update.bench_compute('2025-10-27')
        rows = {r['n']: r for r in computed['bm']}
        self.assertEqual(rows['纳斯达克综合指数']['status'], 'unavailable')
        self.assertEqual(rows['纳斯达克100指数']['usd'], [None] * 5)


class StrategyAccounting(unittest.TestCase):
    def test_missing_moving_average_is_not_a_downtrend(self):
        for contrarian in (False, True):
            events = strategy.dca_ma_events([100] * 200, [0, 20, 199], contrarian)
            self.assertEqual(list(events.values()), [strategy.MONTHLY_CONTRIBUTION] * 3)

    def test_scheduled_cash_deployment_precedes_same_close_signal(self):
        prices = [100] * 38
        prices[36] = 50
        events = strategy.drawdown_ladder_events(prices, list(range(38)), 100)
        self.assertEqual(events[36], 75)
        self.assertNotIn(37, events)

    def test_initial_cash_is_part_of_the_portfolio_before_deployment(self):
        result = strategy.simulate(['2025-01-01', '2026-01-01'], [100, 50], {0: 50, 1: 50}, initial_capital=100)
        self.assertEqual(result['invested'], 100)
        self.assertEqual(result['end_value'], 75)
        self.assertAlmostEqual(result['mdd'], -25)
        self.assertAlmostEqual(result['avg_exposure'], 75)

    def test_costs_cannot_create_unintended_borrowing(self):
        with patch.object(strategy, 'TRADING_COST', 0.01):
            result = strategy.simulate(['2025-01-01', '2026-01-01'], [100, 100], {0: 100}, exposure=[1, 1], initial_capital=100)
        self.assertGreaterEqual(result['minimum_cash'], 0)
        self.assertAlmostEqual(result['end_value'], 100 / 1.01)
        self.assertEqual(result['trades'], 1)

    def test_frequency_comparison_has_equal_partial_year_budgets(self):
        dates = ['2025-%02d-03' % m for m in range(3, 10)]
        inputs = strategy.strategy_inputs([100] * len(dates), dates)
        totals = [sum(inputs[name][0].values()) for name in ('dca_month', 'dca_quarter', 'dca_year')]
        self.assertEqual(totals, [7000] * 3)

    def test_last_close_signal_is_not_executed_at_the_same_close(self):
        events = strategy.drawdown_ladder_events([100, 100, 50], [0], 100)
        self.assertNotIn(2, events)

    def test_cashflows_do_not_hide_market_drawdown(self):
        result = strategy.simulate(['2025-01-01', '2026-01-01'], [100, 50], {0: 100, 1: 100})
        self.assertAlmostEqual(result['mdd'], -50)
        self.assertEqual(result['end_value'], 150)

    def test_curve_uses_actual_month_end_dates_and_keeps_final_observation(self):
        dates = ['2025-01-02', '2025-01-31', '2025-02-03', '2025-02-28', '2025-03-03']
        self.assertEqual(strategy.monthly_sample_indices(dates), [0, 1, 3, 4])

    def test_weekly_curve_uses_actual_last_trading_day_and_both_endpoints(self):
        dates = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07',
                 '2025-01-10', '2025-01-13']
        self.assertEqual(strategy.weekly_sample_indices(dates), [0, 1, 4, 5])

    def test_earlier_windows_exclude_etfs_without_history_yet(self):
        dates = [(date(1999, 1, 1) + timedelta(days=i)).isoformat() for i in range(1827)]
        dates = [day for day in dates if date.fromisoformat(day).weekday() < 5]
        raw = {
            'SPY': {day: 100 for day in dates},
            'QQQ': {day: 100 for day in dates if day >= '1999-03-10'},
            'SOXX': {day: 100 for day in dates if day >= '2001-07-13'},
        }
        with patch.object(strategy, 'END_DATE', '2003-12-31'):
            early_dates, _, early_assets = strategy.window_history(raw, 1999)
            later_dates, _, later_assets = strategy.window_history(raw, 2001)
        self.assertEqual(early_dates[0], '1999-03-10')
        self.assertEqual([item['c'] for item in early_assets], ['SPY', 'QQQ'])
        self.assertEqual(later_dates[0], '2001-07-13')
        self.assertEqual([item['c'] for item in later_assets], ['SPY', 'QQQ', 'SOXX'])

    def test_curve_excludes_external_contributions_from_unit_value(self):
        dates = ['2025-01-02', '2025-02-03', '2025-03-03']
        sample = strategy.monthly_sample_indices(dates)
        result = strategy.simulate(dates, [100, 100, 100], {0: 100, 1: 100, 2: 100}, sample_indices=sample)
        self.assertEqual(result['invested'], 300)
        self.assertEqual(result['end_value'], 300)
        self.assertEqual(result['curve'], [100, 100, 100])
        self.assertEqual(result['account_curve'], [100, 200, 300])

    def test_account_and_xirr_curves_show_dca_timing_difference(self):
        dates = ['2025-01-02', '2025-07-02', '2026-01-05']
        prices = [100, 150, 200]
        early = strategy.simulate(dates, prices, {0: 200}, sample_indices=[0, 1, 2], annualized_indices=[2])
        split = strategy.simulate(dates, prices, {0: 100, 1: 100}, sample_indices=[0, 1, 2], annualized_indices=[2])
        self.assertEqual(early['curve'], split['curve'])
        self.assertNotEqual(early['account_curve'], split['account_curve'])
        self.assertNotEqual(early['irr_curve'], split['irr_curve'])
        self.assertAlmostEqual(early['irr_curve'][-1], early['irr'], places=3)
        self.assertAlmostEqual(split['irr_curve'][-1], split['irr'], places=3)

    def test_quality_rejects_account_curve_not_matching_result(self):
        snapshot = {'STRATEGY_META': {'modelVersion': 3, 'initialCashIncluded': True,
                                      'basis': 'provider_adjusted_close', 'start': '2025-01-02', 'end': '2026-01-05'},
                    'STRATEGY_RESULTS': [{'a': 'SPY', 's': 'lump_sum', 'p': 'initial', 'inv': 100,
                                          'end': 150, 'irr': 50}],
                    'STRATEGY_CURVES': {'dates': ['2025-01-02', '2026-01-05'],
                                        'series': {'SPY': {'lump_sum': [100, 150]}},
                                        'account': {'SPY': {'lump_sum': [100, 140]}},
                                        'irrDates': ['2026-01-05'],
                                        'irr': {'SPY': {'lump_sum': [50]}}}}
        report = data_quality.audit(snapshot, date(2026, 1, 5))
        findings = next(d for d in report['datasets'] if d['id'] == 'strategy')['issues']
        self.assertIn('strategy_metric_curves', {finding['code'] for finding in findings})

    def test_quality_rejects_curve_with_wrong_period(self):
        snapshot = {'STRATEGY_META': {'modelVersion': 2, 'initialCashIncluded': True,
                                      'basis': 'provider_adjusted_close', 'start': '2025-01-02', 'end': '2025-03-03'},
                    'STRATEGY_RESULTS': [{'a': 'SPY', 's': 'lump_sum'}],
                    'STRATEGY_CURVES': {'dates': ['2025-01-02', '2025-02-03'],
                                        'series': {'SPY': {'lump_sum': [100, 110]}}}}
        report = data_quality.audit(snapshot, date(2025, 3, 3))
        findings = next(d for d in report['datasets'] if d['id'] == 'strategy')['issues']
        self.assertIn('curve_dates', {finding['code'] for finding in findings})

    def test_quality_rejects_curve_that_disagrees_with_initial_account(self):
        snapshot = {'STRATEGY_META': {'modelVersion': 2, 'initialCashIncluded': True,
                                      'basis': 'provider_adjusted_close', 'start': '2025-01-02', 'end': '2025-03-03'},
                    'STRATEGY_RESULTS': [{'a': 'SPY', 's': 'lump_sum', 'p': 'initial', 'inv': 100, 'end': 150}],
                    'STRATEGY_CURVES': {'dates': ['2025-01-02', '2025-03-03'],
                                        'series': {'SPY': {'lump_sum': [100, 120]}}}}
        report = data_quality.audit(snapshot, date(2025, 3, 3))
        findings = next(d for d in report['datasets'] if d['id'] == 'strategy')['issues']
        self.assertIn('curve_end_mismatch', {finding['code'] for finding in findings})

    def test_quality_rejects_corrupt_optional_year_curve(self):
        snapshot = {
            'STRATEGY_META': {'modelVersion': 2, 'initialCashIncluded': True,
                              'basis': 'provider_adjusted_close', 'start': '2025-01-02', 'end': '2025-03-03',
                              'windows': [
                                  {'year': 1999, 'start': '2025-01-02', 'end': '2025-03-03', 'records': 1},
                                  {'year': 2010, 'start': '2025-01-02', 'end': '2025-03-03', 'records': 1},
                              ]},
            'STRATEGY_DEFS': [{'id': 'lump_sum'}],
            'STRATEGY_RESULTS': [{'a': 'SPY', 's': 'lump_sum', 'p': 'initial', 'inv': 100, 'end': 110}],
            'STRATEGY_CURVES': {'dates': ['2025-01-02', '2025-03-03'],
                                'series': {'SPY': {'lump_sum': [100, 110]}}},
            'STRATEGY_WINDOWS': {'1999': {
                'start': '2025-01-02', 'end': '2025-03-03', 'assets': ['SPY'],
                'results': [{'a': 'SPY', 's': 'lump_sum', 'p': 'initial', 'inv': 100, 'end': 110}],
                'curves': {'dates': ['2025-01-02', '2025-03-03'],
                           'series': {'SPY': {'lump_sum': [100]}}},
            }},
        }
        report = data_quality.audit(snapshot, date(2025, 3, 3))
        findings = next(d for d in report['datasets'] if d['id'] == 'strategy')['issues']
        self.assertIn('window_curve_series', {finding['code'] for finding in findings})


class FreshnessAndOffline(unittest.TestCase):
    def test_scale_without_its_own_date_is_marked_unverified(self):
        rows = [{'c': '000001', 'sz': 5.4, 'navdate': '2026-09-21'},
                {'c': '000002', 'sz': 5.4, 'szdate': '2026-06-30'}]
        report = data_quality.audit({'EXTRA': rows}, date(2026, 9, 21))
        issues = {item['code']: item for item in next(d for d in report['datasets']
                                                      if d['id'] == 'domestic_funds')['issues']}
        self.assertEqual(issues['research_scale_date_unverified']['affected'], ['000001'])

    def test_manager_and_extended_nav_freshness_do_not_follow_policy_run_date(self):
        rows = [{'c': '000001', 'navdate': '2026-09-01', 'managerAsOf': '2026-08-01',
                 'managerSourceUrl': 'https://example.org/manager', 'managerRecords': [{'name': '甲', 'start': '2020-01-01'}]},
                {'c': '000002', 'navdate': '2026-09-21', 'managerAsOf': '2026-09-21',
                 'managerSourceUrl': 'https://example.org/manager', 'managerRecords': [{'name': '乙', 'start': '2027-01-01'}]},
                {'c': '000003', 'navdate': '2026-09-21', 'managerAsOf': '2026-09-21',
                 'managerSourceUrl': 'https://example.org/manager', 'managerRecords': ['invalid']}]
        result = data_quality.audit({'EXTRA': rows}, date(2026, 9, 21))
        issues = {i['code']: i for d in result['datasets'] if d['id'] == 'domestic_funds' for i in d['issues']}
        self.assertEqual(issues['stale_research_nav']['affected'], ['000001'])
        self.assertEqual(issues['stale_manager_observation']['affected'], ['000001'])
        self.assertEqual(issues['manager_date_invalid']['affected'], ['000002', '000003'])

    def test_stock_periods_use_actual_trading_dates_and_preserve_missing_history(self):
        series = [('2025-09-19', 100), ('2026-09-21', 110)]
        periods = stock_screen.return_periods(series, '2026-09-21')
        self.assertEqual(periods[0], {'years': 1, 'start': '2025-09-19', 'end': '2026-09-21'})
        self.assertIsNone(periods[-1]['start'])

    def test_exchange_funds_do_not_require_otc_fee_schedules(self):
        extra = [{'c': '512890', 't': '场内ETF', 'buy': None, 'rd': None},
                 {'c': '123456', 't': 'LOF', 'buy': None, 'rd': None}]
        report = data_quality.audit({'EXTRA': extra}, date(2026, 9, 21))
        issues = next(item for item in report['datasets'] if item['id'] == 'domestic_funds')['issues']
        fee_issue = next(item for item in issues if item['code'] == 'domestic_fee_missing')
        self.assertEqual(fee_issue['affected'], ['123456'])

    def test_offline_replay_preserves_last_online_failure(self):
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory, patch.object(data_status, 'DATA', Path(directory)):
            data_status.write_status('stocks', 'failed', mode='online', message='upstream unavailable')
            result = data_status.write_status('stocks', 'cached', mode='offline')
        self.assertEqual(result['datasets']['stocks']['status'], 'cached')
        self.assertEqual(result['datasets']['stocks']['lastOnlineAttempt']['message'], 'upstream unavailable')

    def test_repeated_stock_refresh_warnings_are_grouped_with_codes(self):
        rows = [{'c': str(i), 'latest': '2026-09-21', 'dataStatus': 'refresh_failed'} for i in range(3)]
        result = data_quality.audit({'STOCKS': rows}, date(2026, 9, 21))
        issues = next(item for item in result['datasets'] if item['id'] == 'stocks')['issues']
        failures = [item for item in issues if item['code'] == 'stock_refresh_failed']
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]['affected'], ['0', '1', '2'])

    def test_yahoo_equity_fallback_preserves_identity_and_missing_fundamentals(self):
        from datetime import datetime, timezone
        start = datetime(2025, 1, 1, tzinfo=timezone.utc)
        stamps = [int((start + timedelta(days=i)).timestamp()) for i in range(300)]
        chart = {'chart': {'result': [{'meta': {'symbol': '600900.SS', 'currency': 'CNY',
                                             'regularMarketPrice': 100, 'regularMarketTime': stamps[-1]},
                                      'timestamp': stamps,
                                      'indicators': {'adjclose': [{'adjclose': [100.0] * 300}]}}]}}

        def source(url, **kwargs):
            if 'push2.' in url:
                raise OSError('upstream unavailable')
            if 'query1.finance.yahoo.com' in url:
                return chart
            return {'result': {'data': []}}

        with tempfile.TemporaryDirectory() as directory, patch.object(stock_screen, 'YAHOO_CACHE', directory), patch.object(stock_screen, 'fetch_json', side_effect=source):
            row = stock_screen.fetch_stock({'code': '600900', 'name': '长江电力', 'note': 'test'})
        self.assertEqual(row['n'], '长江电力')
        self.assertEqual(row['returnBasis'], 'provider_adjusted_close')
        self.assertIsNone(row['pe'])
        self.assertIsNone(row['mcap'])
        self.assertIsNone(row['mdd5'])
        self.assertIn('600900.SS', row['sourceUrl'])

    def test_declared_future_dividend_is_not_received_income(self):
        payload = {'result': {'data': [
            {'PRETAX_BONUS_RMB': 10, 'EX_DIVIDEND_DATE': '2026-06-01', 'REPORT_DATE': '2025-12-31'},
            {'PRETAX_BONUS_RMB': 20, 'EX_DIVIDEND_DATE': '2027-01-01', 'REPORT_DATE': '2026-12-31'},
            {'PRETAX_BONUS_RMB': 50, 'EX_DIVIDEND_DATE': '2020-06-01', 'REPORT_DATE': '2019-12-31'},
        ]}}
        with patch.object(stock_screen, 'fetch_json', return_value=payload):
            yield_pct, years = stock_screen.dividend_stats('test', '2026-09-21', 100)
        self.assertEqual((yield_pct, years), (1, 1))

    def test_offline_is_a_network_boundary_even_when_cache_missing(self):
        with patch('urllib.request.urlopen', side_effect=AssertionError('network accessed')):
            with patch.object(update, 'OFFLINE', True):
                self.assertIsNone(update.http_get('https://invalid.example'))
            with patch.object(stock_screen, 'OFFLINE', True):
                with self.assertRaises(RuntimeError):
                    stock_screen.fetch_json('https://invalid.example')
            with tempfile.TemporaryDirectory() as directory, patch.object(strategy, 'CACHE_DIR', directory):
                with self.assertRaises(RuntimeError):
                    strategy.load_history('QQQ', offline=True, refresh=True)

    def test_offline_entrypoint_preserves_offline_for_every_network_job(self):
        commands = refresh.commands(True)
        for name in ('funds', 'indices', 'stocks', 'strategy'):
            self.assertIn('--offline', commands[name])

    def test_failed_refresh_restores_published_data_but_keeps_failure_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'data'
            data.mkdir()
            published = data / 'snapshot.js'
            published.write_text('previous snapshot', encoding='utf-8')

            def partial_run(*_args, **_kwargs):
                published.write_text('incomplete replacement', encoding='utf-8')
                return subprocess.CompletedProcess(['fake'], 3, stdout='partial', stderr='')

            with patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', data), \
                    patch.object(refresh.subprocess, 'run', side_effect=partial_run), \
                    patch.object(refresh, 'write_status') as status:
                result = refresh.execute('funds', ['fake'], 5, offline=True)
            self.assertEqual(result['exitCode'], 3)
            self.assertTrue(result['publishedRollback'])
            self.assertEqual(published.read_text(encoding='utf-8'), 'previous snapshot')
            self.assertIn('已恢复页面数据：snapshot.js', (root / result['log']).read_text(encoding='utf-8'))
            self.assertEqual(status.call_args.args[:2], ('funds', 'failed'))

    def test_successful_refresh_keeps_new_published_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'data'
            data.mkdir()
            published = data / 'snapshot.js'
            published.write_text('previous snapshot', encoding='utf-8')

            def successful_run(*_args, **_kwargs):
                published.write_text('new snapshot', encoding='utf-8')
                return subprocess.CompletedProcess(['fake'], 0, stdout='done', stderr='')

            with patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', data), \
                    patch.object(refresh.subprocess, 'run', side_effect=successful_run), \
                    patch.object(refresh, 'write_status'):
                result = refresh.execute('funds', ['fake'], 5, offline=True)
            self.assertEqual(result['exitCode'], 0)
            self.assertFalse(result['publishedRollback'])
            self.assertEqual(published.read_text(encoding='utf-8'), 'new snapshot')

    def test_timed_out_refresh_restores_published_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'data'
            data.mkdir()
            published = data / 'indices.js'
            published.write_text('previous indices', encoding='utf-8')

            def timed_out(*_args, **_kwargs):
                published.write_text('incomplete indices', encoding='utf-8')
                raise subprocess.TimeoutExpired(['fake'], 5, output=b'partial')

            with patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', data), \
                    patch.object(refresh.subprocess, 'run', side_effect=timed_out), \
                    patch.object(refresh, 'write_status'):
                result = refresh.execute('indices', ['fake'], 5, offline=True)
            self.assertEqual(result['exitCode'], 124)
            self.assertTrue(result['publishedRollback'])
            self.assertEqual(published.read_text(encoding='utf-8'), 'previous indices')

    def test_structural_pass_is_not_independent_data_verification(self):
        report = data_quality.audit({'FUNDS': [{'c': '123456', 'nav': 1, 'r': [1] * 5, 'navdate': '2026-09-18'}]}, date(2026, 9, 21))
        fund_report = report['datasets'][0]
        self.assertEqual(fund_report['status'], 'unverified')
        self.assertTrue(any(item['code'] == 'legacy_return_basis' for item in fund_report['issues']))


if __name__ == '__main__':
    unittest.main()
