import json
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
from scripts import check_refresh, post_refresh


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
            barrier = threading.Barrier(5)
            done, guard = set(), threading.Lock()
            first = {'funds', 'research_funds', 'indices', 'stocks', 'overseas_stocks'}

            def execute(name, command, timeout, offline, allow_partial=False):
                self.assertTrue(allow_partial)
                if name in first:
                    barrier.wait(3)
                else:
                    self.assertTrue(first <= done)
                if name == 'quality':
                    self.assertEqual(done, set(refresh.DATASETS) - {'quality'})
                with guard:
                    done.add(name)
                return dict(dataset=name, status='completed', exitCode=0, seconds=0)

            with patch.object(refresh, 'ROOT', directory), patch.object(refresh, 'DATA', directory / 'data'), \
                    patch.object(refresh, 'execute', side_effect=execute), patch('scripts.build_portfolio_data.prune'), \
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


if __name__ == '__main__':
    unittest.main()
