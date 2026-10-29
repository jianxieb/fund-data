import json
import os
import multiprocessing
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import refresh
import data_quality
import strategy_backtest
from data_status import atomic_text, file_transaction, replace_snapshot_blocks
from scripts import build_portfolio_data, build_return_indices, check_refresh, post_refresh


def block(name, value):
    return '/*__DATA_%s_BEGIN__*/%s/*__DATA_%s_END__*/' % (name, value, name)


def increment(path, name):
    for _ in range(20):
        with file_transaction(path):
            src = Path(path).read_text()
            prefix = '/*__DATA_' + name + '_BEGIN__*/'
            count = int(src.split(prefix)[1].split('/*')[0])
            atomic_text(path, replace_snapshot_blocks(src, block(name, count + 1), (name,)))


class DailyIsolationTests(unittest.TestCase):
    def test_targeted_repair_is_explicit_and_does_not_claim_all_nine_stages(self):
        steps = [dict(dataset=name, status='completed', exitCode=0) for name in ('research_funds', 'portfolio', 'quality')]
        report = {'scope': 'targeted', 'datasets': [s['dataset'] for s in steps], 'status': 'completed', 'steps': steps}
        self.assertEqual(check_refresh.check_results(report, {'summary': {'errors': 0}}), [])
        self.assertTrue(check_refresh.check_results({**report, 'scope': 'all'}, {'summary': {'errors': 0}}))
        self.assertTrue(check_refresh.check_results({**report, 'datasets': ['portfolio']}, {'summary': {'errors': 0}}))
        with tempfile.TemporaryDirectory() as temporary:
            def done(name, *args, **kwargs):
                return dict(dataset=name, status='completed', exitCode=0)
            with patch.object(post_refresh, 'DATA', Path(temporary)), \
                    patch.object(post_refresh, 'run_task', side_effect=done) as run, \
                    patch.object(refresh, 'execute', side_effect=done):
                self.assertEqual(post_refresh.main(['crossborder']), 0)
            self.assertEqual([call.args[0] for call in run.call_args_list], ['crossborder'])

    def test_timeout_keeps_a_valid_checkpoint_and_requires_metric_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(build_portfolio_data, 'ROOT', root), patch.object(build_portfolio_data, 'OUTPUT', root / 'data/portfolio'), \
                    patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', root / 'data'), \
                    patch.dict(os.environ, {'FUND_DATA_REFRESH_TOKEN': 'this-run'}):
                a = dict(id='fund:000001', code='000001', currency='CNY')
                b = dict(id='fund:000002', code='000002', currency='CNY')
                old = [build_portfolio_data.publish_history(row, [['2026-10-23', 1], ['2026-10-26', 2]], 'provider_daily_return_or_explicit_actions', 'https://example.com') for row in (a, b)]
                prior = {'assets': old, 'fx': {'id': 'fx:CNY', 'status': 'missing', 'missing': 'fixture FX absent'}}
                path = root / 'data/portfolio/catalog.js'
                before = ('var PORTFOLIO_CATALOG=' + json.dumps(prior) + ';').encode()
                path.write_bytes(before)
                updated = build_portfolio_data.publish_history(a, [['2026-10-23', 1], ['2026-10-26', 2], ['2026-10-27', 2.1]], 'provider_daily_return_or_explicit_actions', 'https://example.com')
                checkpoint = build_portfolio_data.history_catalog([a, b], {a['id']: updated}, prior)
                def interrupted(*args, **kwargs):
                    path.write_text('var PORTFOLIO_CATALOG=' + json.dumps(checkpoint) + ';')
                    raise subprocess.TimeoutExpired(args[0], 90)
                with patch.object(refresh.subprocess, 'run', side_effect=interrupted), patch.object(refresh, 'write_status'):
                    result = refresh.execute('portfolio', ['collector'], 90, allow_partial=True)
                self.assertTrue(result['checkpointValidated'])
                self.assertTrue(result['sourcePartial'])
                self.assertFalse(result['publishedRollback'])
                saved = json.loads(path.read_text().split('=', 1)[1].rstrip(';'))
                self.assertEqual([r['asOf'] for r in saved['assets']], ['2026-10-27', '2026-10-26'])
                steps = [dict(dataset=name, status='completed', exitCode=0) for name in check_refresh.EXPECTED_STEPS]
                steps[7] = result
                report = {'dailyMode': True, 'status': 'partial', 'steps': steps}
                self.assertTrue(check_refresh.check_results(report, {'summary': {'errors': 0}}))
                report['portfolioSync'] = {'exitCode': 0}
                self.assertEqual(check_refresh.check_results(report, {'summary': {'errors': 0}}), [])
                saved['refreshToken'] = 'previous-run'
                path.write_text('var PORTFOLIO_CATALOG=' + json.dumps(saved) + ';')
                self.assertIsNone(refresh.validated_portfolio_checkpoint(before))
                saved['refreshToken'] = 'this-run'
                saved['assets'][0]['sha256'] = 'corrupt'
                path.write_text('var PORTFOLIO_CATALOG=' + json.dumps(saved) + ';')
                self.assertIsNone(refresh.validated_portfolio_checkpoint(before))

    def test_individual_retained_histories_name_errors_and_original_dates(self):
        catalog = {'assets': [
            {'id': 'fund:020516', 'status': 'available', 'asOf': '2026-10-23',
             'refreshWarning': '本次历史接口未更新：The read operation timed out'},
            {'id': 'fund:513650', 'status': 'available', 'asOf': '2026-10-23',
             'refreshWarning': '本次历史接口未更新：Connection reset by peer'},
            {'id': 'fund:006111', 'status': 'available', 'asOf': '2026-10-23',
             'refreshWarning': '早期净值、每日收益或连续历史不完整，仅使用自 2019-06-06 起的已核对历史'},
            {'id': 'fund:000071', 'status': 'available', 'asOf': '2026-10-26'},
        ]}
        failures = build_portfolio_data.retained_history_failures(catalog)
        self.assertEqual(set(failures), {'fund:020516', 'fund:513650'})
        self.assertEqual(failures['fund:020516']['asOf'], '2026-10-23')
        report = data_quality.audit({'UPDATE_STATUS': {'datasets': {'portfolio': {
            'status': 'partial', 'historyFailures': failures}}}})
        source = next(d for d in report['datasets'] if d['id'] == 'source_refresh')
        self.assertEqual(len(source['issues']), 2)
        issue = next(i for i in source['issues'] if i['affected'] == 'fund:020516')
        self.assertIn('2026-10-23', issue['message'])
        self.assertIn('timed out', issue['message'])
        self.assertEqual(issue['severity'], 'warning')

    def test_strategy_commit_rereads_fund_updates_that_arrived_during_calculation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'data').mkdir()
            path = directory / 'snapshot.js'
            path.write_text(block('FUNDS', 'old fund') + block('META', 'meta') + block('STRATEGY', 'old strategy'))
            @contextmanager
            def concurrent_fund_update(_):
                path.write_text(path.read_text().replace('old fund', 'new fund'))
                yield
            with patch.object(strategy_backtest, 'HTML', str(path)), patch.object(strategy_backtest, 'HERE', str(directory)), \
                    patch.object(strategy_backtest, 'file_transaction', side_effect=concurrent_fund_update):
                strategy_backtest.write_html([], ['2026-10-23', '2026-10-26'], {}, [], [], {})
            self.assertIn('new fund', path.read_text())
            self.assertNotIn('old strategy', path.read_text())
            self.assertTrue((directory / 'data/strategy-fees.js').exists())

    def test_retained_source_failure_names_the_missing_source_in_quality_view(self):
        report = data_quality.audit({'UPDATE_STATUS': {'datasets': {
            'market_history': {'status': 'timeout', 'error': '估值接口60秒内未完成'},
            'bank_fx': {'status': 'failed', 'error': '  '},
        }}})
        source = next(d for d in report['datasets'] if d['id'] == 'source_refresh')
        self.assertEqual(len(source['issues']), 2)
        self.assertIn('市场历史：估值接口60秒内未完成', source['issues'][0]['message'])
        self.assertIn('银行参考牌价：来源本次未返回可用数据', source['issues'][1]['message'])
        self.assertTrue(all(i['severity'] == 'warning' for i in source['issues']))

    def test_parallel_processes_cannot_lose_other_collectors_or_status_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'snapshot.js'
            names = ('FUNDS', 'EXTRA', 'STOCKS', 'STRATEGY')
            path.write_text('\n'.join(block(name, 0) for name in names))
            context = multiprocessing.get_context('spawn')
            jobs = [context.Process(target=increment, args=(str(path), name)) for name in names for _ in range(2)]
            for job in jobs:
                job.start()
            for job in jobs:
                job.join(10)
                self.assertEqual(job.exitcode, 0)
            self.assertEqual(path.read_text(), '\n'.join(block(name, 40) for name in names))

    def test_failed_stock_stage_restores_only_stocks_preserving_new_fund_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / 'snapshot.js'
            path.write_text(block('FUNDS', 'old fund') + block('STOCKS', 'old stock'))

            def fail(*args, **kwargs):
                path.write_text(block('FUNDS', 'new fund') + block('STOCKS', 'invalid stock'))
                return subprocess.CompletedProcess(args[0], 1, 'upstream timeout', '')

            with patch.object(refresh, 'DATA', directory), patch.object(refresh, 'ROOT', directory), \
                    patch.object(refresh.subprocess, 'run', side_effect=fail), patch.object(refresh, 'write_status'):
                step = refresh.execute('stocks', ['collector'], 1, allow_partial=True)
            self.assertEqual(path.read_text(), block('FUNDS', 'new fund') + block('STOCKS', 'old stock'))
            self.assertEqual(step['exitCode'], 1)
            self.assertTrue(step['retainedPrevious'])
            self.assertTrue(step['publishedRollback'])

    def test_native_per_stock_failure_does_not_discard_other_valid_stock_updates(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / 'snapshot.js'
            path.write_text(block('STOCKS', 'old rows'))
            def partial(*args, **kwargs):
                path.write_text(block('STOCKS', 'fresh valid row; failed row retains original date'))
                return subprocess.CompletedProcess(args[0], 3, 'one stock failed', '')
            with patch.object(refresh, 'DATA', directory), patch.object(refresh, 'ROOT', directory), \
                    patch.object(refresh.subprocess, 'run', side_effect=partial), patch.object(refresh, 'write_status'):
                step = refresh.execute('stocks', ['collector'], 1, allow_partial=True)
            self.assertIn('fresh valid row', path.read_text())
            self.assertTrue(step['sourcePartial'])
            self.assertEqual(step['exitCode'], 3)
            self.assertFalse(step['publishedRollback'])

    def test_missing_prior_data_and_failed_quality_cannot_be_blessed_as_retained(self):
        for name in ('stocks', 'quality'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                with patch.object(refresh, 'DATA', directory), patch.object(refresh, 'ROOT', directory), \
                        patch.object(refresh.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, 'failed', '')), \
                        patch.object(refresh, 'write_status'):
                    step = refresh.execute(name, ['collector'], 1, allow_partial=True)
                self.assertFalse(step['retainedPrevious'])
                self.assertFalse(step['sourcePartial'])

    def test_daily_gate_accepts_explicit_retention_but_keeps_quality_and_dates_strict(self):
        steps = [dict(dataset=name, status='completed', exitCode=0) for name in check_refresh.EXPECTED_STEPS]
        steps[2].update(status='failed', exitCode=1, retainedPrevious=True)
        report = {'dailyMode': True, 'status': 'partial', 'steps': steps}
        self.assertEqual(check_refresh.check_results(report, {'summary': {'errors': 0}}), [])
        self.assertTrue(check_refresh.check_results({**report, 'dailyMode': False}, {'summary': {'errors': 0}}))
        self.assertTrue(check_refresh.check_results(report, {'summary': {'errors': 1}}))
        steps[-1].update(status='failed', exitCode=1, retainedPrevious=True)
        self.assertTrue(check_refresh.check_results(report, {'summary': {'errors': 0}}))
        previous = {'STOCKS': [{'c': '1', 'valuationAsOf': '2026-10-23'}]}
        current = {'STOCKS': [{'c': '1', 'valuationAsOf': None}]}
        self.assertTrue(check_refresh.check_snapshots(previous, current))

    def test_daily_phases_run_independent_sources_together_and_quality_last(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            barrier = threading.Barrier(4)
            done, guard = set(), threading.Lock()
            first = {'funds', 'indices', 'stocks', 'overseas_stocks'}

            def execute(name, command, timeout, offline, allow_partial=False):
                self.assertTrue(allow_partial)
                if name in first:
                    barrier.wait(3)
                else:
                    self.assertTrue(first <= done)
                if name == 'quality':
                    self.assertEqual(done, (set(refresh.DATASETS) - {'quality'}) | {'benchmark_sync'})
                with guard:
                    done.add(name)
                return dict(dataset=name, status='completed', exitCode=0, seconds=0)

            with patch.object(refresh, 'ROOT', directory), patch.object(refresh, 'DATA', directory / 'data'), \
                    patch.object(refresh, 'execute', side_effect=execute), patch.object(refresh, 'prepare_daily_funds', return_value=2), \
                    patch('scripts.build_portfolio_data.prune'), \
                    patch('sys.argv', ['refresh.py', '--daily', '--timeout', '90']):
                self.assertEqual(refresh.main(), 0)
            report = json.loads((directory / 'data/refresh-report.json').read_text())
            self.assertEqual(tuple(s['dataset'] for s in report['steps']), refresh.DATASETS)

    def test_missing_snapshot_marker_cannot_overwrite_another_data_block(self):
        with self.assertRaisesRegex(ValueError, 'STOCKS'):
            replace_snapshot_blocks(block('FUNDS', 'new'), block('STOCKS', 'old'), ('STOCKS',))

    def test_index_timeout_restores_catalog_and_pruned_old_history_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            folder = directory / 'return-comparison'
            folder.mkdir()
            (folder / 'catalog.json').write_text('old catalog')
            (folder / 'old.json').write_text('old referenced history')

            def timeout(*args, **kwargs):
                (folder / 'catalog.json').write_text('new incomplete catalog')
                (folder / 'old.json').unlink()
                raise subprocess.TimeoutExpired(args[0], 1)

            with patch.object(post_refresh, 'DATA', directory), patch.object(refresh, 'DATA', directory), \
                    patch.object(refresh, 'ROOT', directory), patch.object(refresh.subprocess, 'run', side_effect=timeout), \
                    patch.object(refresh, 'write_status'):
                step = post_refresh.run_task('return_indices', timeout=1)
            self.assertTrue(step['retainedPrevious'])
            self.assertEqual((folder / 'catalog.json').read_text(), 'old catalog')
            self.assertEqual((folder / 'old.json').read_text(), 'old referenced history')

    def test_event_chapters_wait_for_the_new_index_catalog_while_unrelated_tasks_run_together(self):
        with tempfile.TemporaryDirectory() as temporary:
            independent = set(post_refresh.TASKS) - {'fund_actions', 'financial_events'}
            barrier = threading.Barrier(len(independent))
            done, guard = set(), threading.Lock()

            def run_task(name):
                if name in independent:
                    barrier.wait(3)
                if name == 'financial_events':
                    self.assertTrue(independent <= done)
                with guard:
                    done.add(name)
                return dict(dataset=name, status='completed', exitCode=0, seconds=0)

            def quality(name, *args, **kwargs):
                self.assertEqual(name, 'quality')
                self.assertEqual(done, set(post_refresh.TASKS))
                return dict(dataset=name, status='completed', exitCode=0, seconds=0)

            with patch.object(post_refresh, 'DATA', Path(temporary)), \
                    patch.object(post_refresh, 'run_task', side_effect=run_task), \
                    patch.object(refresh, 'execute', side_effect=quality):
                self.assertEqual(post_refresh.main(), 0)

    def test_index_cleanup_preserves_histories_used_by_retained_event_chapters(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'data/return-comparison'
            folder.mkdir(parents=True)
            old = folder / 'IXIC-old.json'
            old.write_text('previous source still used by published chapters')
            unused = folder / 'IXIC-unreferenced.json'
            unused.write_text('no published consumer')
            event_path = root / 'data/financial-events-history.json'
            event_path.write_text(json.dumps({'events': {'kept': [{'sourceFile': old.relative_to(root).as_posix()}]}}))
            indices_path = root / 'indices.json'
            indices_path.write_text('{"indices":{}}')
            with patch.object(build_return_indices, 'ROOT', root), patch.object(build_return_indices, 'OUT', folder), \
                    patch.object(build_return_indices.indices, 'HISTORY_PATH', indices_path), \
                    patch.object(build_return_indices.indices, 'SPECS', []), \
                    patch.object(build_return_indices.strategy_backtest, 'load_history', return_value={'2026-10-23': 100, '2026-10-26': 101}):
                rows = build_return_indices.build(offline=True)
                self.assertTrue(old.exists())
                self.assertFalse(unused.exists())
                self.assertEqual(len(build_return_indices.check()), 3)
                # Once the consumer advances, the next cleanup may collect the
                # superseded file; protection is tied to live references.
                event_path.write_text(json.dumps({'events': {'fresh': [{'sourceFile': rows[2]['historyUrl']}]}}))
                build_return_indices.build(offline=True)
                self.assertFalse(old.exists())
                self.assertTrue((root / rows[2]['historyUrl']).exists())

    def test_portfolio_cleanup_preserves_event_sources_until_the_consumer_advances(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'data/portfolio'
            (folder / 'us').mkdir(parents=True)
            paths = {name: folder / 'us' / (name + '.json') for name in ('new', 'old', 'unused')}
            for name, path in paths.items():
                path.write_text(name)
            current = paths['new'].relative_to(root).as_posix()
            (folder / 'catalog.js').write_text('var PORTFOLIO_CATALOG=' + json.dumps({'assets': [{'historyUrl': current}]}))
            event_path = root / 'data/financial-events-history.json'
            event_path.write_text(json.dumps({'events': {'kept': [{'sourceFile': paths['old'].relative_to(root).as_posix()}]}}))
            with patch.object(build_portfolio_data, 'ROOT', root), patch.object(build_portfolio_data, 'OUTPUT', folder):
                build_portfolio_data.prune()
                self.assertTrue(paths['new'].exists())
                self.assertTrue(paths['old'].exists())
                self.assertFalse(paths['unused'].exists())
                event_path.write_text(json.dumps({'events': {'fresh': [{'sourceFile': current}]}}))
                build_portfolio_data.prune()
                self.assertTrue(paths['new'].exists())
                self.assertFalse(paths['old'].exists())


if __name__ == '__main__':
    unittest.main()
