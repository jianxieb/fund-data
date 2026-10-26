#!/usr/bin/env python3
"""Cross-platform, bounded update entry point. Never commits, pushes, or edits the UI."""
import argparse
import json
import os
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from data_status import DATA, ROOT, atomic_text, now_iso, write_status, file_transaction, replace_snapshot_blocks

DATASETS = ('funds', 'research_funds', 'indices', 'stocks', 'overseas_stocks', 'screening', 'strategy', 'portfolio', 'quality')
PUBLISHED_OUTPUTS = {
    'funds': ('snapshot.js',),
    'research_funds': ('snapshot.js', 'screening-validation.json'),
    'indices': ('indices.js', 'index-history.json'),
    'stocks': ('snapshot.js',),
    'overseas_stocks': ('overseas-stocks.js', 'us-financial-history.json'),
    'screening': ('screening.js',),
    'strategy': ('snapshot.js', 'strategy-fees.js'),
    'portfolio': ('portfolio/catalog.js', 'snapshot.js', 'screening.js'),
    'benchmark_sync': ('snapshot.js',),
}
SNAPSHOT_BLOCKS = {'funds': ('FUNDS', 'META', 'BM', 'CHG'), 'research_funds': ('EXTRA',),
                   'stocks': ('STOCKS',), 'strategy': ('STRATEGY',), 'portfolio': ('FUNDS', 'EXTRA'),
                   'benchmark_sync': ('BM', 'META')}


def prepare_daily_funds(token):
    from scripts.build_portfolio_data import universe
    from scripts.fund_batch import prepare
    return prepare([row['code'] for row in universe() if row['id'].startswith('fund:')], token)


def commands(offline=False):
    flag = ['--offline'] if offline else []
    return {
        'funds': [sys.executable, str(ROOT / 'update.py'), *flag],
        'research_funds': [sys.executable, str(ROOT / 'screens' / 'fund_screen.py'), 'refresh-performance', *flag],
        'indices': [sys.executable, str(ROOT / 'indices.py'), *flag],
        'stocks': [sys.executable, str(ROOT / 'stock_screen.py'), *flag],
        'overseas_stocks': [sys.executable, str(ROOT / 'overseas_stocks.py'), *flag],
        # Daily policy regeneration is offline. A whole-market screen is a separate
        # expensive research job, not a daily download of all 1,268 legacy candidates.
        'screening': [sys.executable, str(ROOT / 'screens' / 'fund_screen.py'), 'policy'],
        'strategy': [sys.executable, str(ROOT / 'strategy_backtest.py'), *(flag if offline else ['--refresh'])],
        'portfolio': [sys.executable, str(ROOT / 'scripts' / 'build_portfolio_data.py'), *(flag if offline else ['--refresh'])],
        'quality': [sys.executable, str(ROOT / 'data_quality.py'), '--strict'],
    }


def execute(dataset, command, timeout, offline=False, allow_partial=False):
    started = time.monotonic()
    attempted = now_iso()
    published_before = {}
    for name in PUBLISHED_OUTPUTS.get(dataset, ()):
        path = DATA / name
        published_before[path] = path.read_bytes() if path.exists() else None
    try:
        result = subprocess.run(command, cwd=ROOT, text=True, encoding='utf-8', errors='replace',
                                capture_output=True, timeout=timeout)
        log = (result.stdout or '') + (result.stderr or '')
        status = 'completed' if result.returncode == 0 else 'failed'
        code = result.returncode
    except subprocess.TimeoutExpired as exc:
        status, code = 'timeout', 124
        output = exc.stdout or b''
        log = output.decode('utf-8', 'replace') if isinstance(output, bytes) else output
        log += '\n执行超过 %s 秒，子进程已终止；该数据集不能视为更新成功。\n' % timeout
    except OSError as exc:
        status, code, log = 'failed', 1, str(exc)
    restored = []
    # These collectors validate their output and preserve failed individual rows
    # themselves. Exit 3 reports the source failures without discarding good rows.
    source_partial = allow_partial and code == 3 and dataset in ('funds', 'stocks')
    error = next((line.strip() for line in reversed(log.splitlines()) if line.strip()), '')[:240] if code else None
    if source_partial:
        status = 'partial'
    if code != 0 and not source_partial:
        for path, previous in published_before.items():
            with file_transaction(path):
                if previous is None:
                    if path.exists():
                        path.unlink()
                        restored.append(path.name)
                elif not path.exists() or path.read_bytes() != previous:
                    if allow_partial and path.name == 'snapshot.js' and path.exists():
                        merged = replace_snapshot_blocks(path.read_text(encoding='utf-8'),
                            previous.decode('utf-8'), SNAPSHOT_BLOCKS[dataset])
                        atomic_text(path, merged)
                    else:
                        temporary = path.with_name(path.name + '.rollback.tmp')
                        temporary.write_bytes(previous)
                        os.replace(temporary, path)
                    restored.append(path.name)
        if restored:
            log += '\n本阶段未成功，已恢复页面数据：%s。\n' % ', '.join(restored)
    duration = round(time.monotonic() - started, 2)
    directory = ROOT / '.tmp-snap'
    directory.mkdir(exist_ok=True)
    atomic_text(directory / ('refresh-' + dataset + '.log'), log)
    # A zero exit code can mean cache-only validation: do not replace it with 'fresh'.
    if code != 0 and not source_partial:
        write_status(dataset, status, exitCode=code, seconds=duration, message=log[-1200:], error=error,
                     mode='offline' if offline else 'online')
    else:
        try:
            existing = json.loads((DATA / 'update-status.json').read_text(encoding='utf-8')).get('datasets', {}).get(dataset, {})
        except (OSError, ValueError):
            existing = {}
        if existing.get('attemptedAt', '') >= attempted:
            details = {key: value for key, value in existing.items() if key not in ('status', 'attemptedAt', 'execution', 'mode', 'lastOnlineAttempt')}
            details['mode'] = 'offline' if offline else 'online'
            write_status(dataset, existing['status'], **details, execution={'exitCode': code, 'seconds': duration})
        else:
            write_status(dataset, 'cached' if offline and dataset not in ('quality', 'screening') else 'checked' if dataset in ('quality', 'screening') else 'success',
                         exitCode=0, seconds=duration, mode='offline' if offline else 'online', message='执行成功；数据准确性与日期由质量报告单独说明。')
    def retained_file(path, previous):
        with file_transaction(path):
            if previous is None or not path.exists():
                return False
            current = path.read_bytes()
        if path.name == 'snapshot.js':
            text = current.decode('utf-8')
            return replace_snapshot_blocks(text, previous.decode('utf-8'), SNAPSHOT_BLOCKS[dataset]) == text
        return current == previous
    retained = allow_partial and code != 0 and not source_partial and bool(published_before) and all(
        retained_file(path, previous) for path, previous in published_before.items())
    return {'dataset': dataset, 'status': status, 'exitCode': code, 'seconds': duration,
            'log': '.tmp-snap/refresh-' + dataset + '.log',
            'publishedRollback': bool(restored), 'retainedPrevious': bool(retained),
            'sourcePartial': source_partial}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='所有被选的数据集严格不联网')
    parser.add_argument('--daily', action='store_true', help='并行更新独立来源；局部失败保留原数据和日期')
    parser.add_argument('--datasets', default=','.join(DATASETS), help='逗号分隔：' + ','.join(DATASETS))
    parser.add_argument('--timeout', type=int, default=180, help='每个数据集最大运行秒数（默认180）')
    parser.add_argument('--funds-timeout', type=int, help='基础与已核验扩展基金阶段的运行秒数上限；默认使用 --timeout')
    parser.add_argument('--portfolio-timeout', type=int, help='组合全库每日历史阶段的运行秒数上限；默认使用 --timeout')
    args = parser.parse_args()
    selected = list(dict.fromkeys(x.strip() for x in args.datasets.split(',') if x.strip()))
    if not selected or set(selected) - set(DATASETS):
        parser.error('未知或空的数据集列表')
    if any(value is not None and value < 1 for value in (args.timeout, args.funds_timeout, args.portfolio_timeout)):
        parser.error('运行秒数上限必须大于0')
    # Quality always runs after mutations, including unsuccessful refreshes.
    selected = [name for name in selected if name != 'quality'] + ['quality']
    lock = ROOT / '.tmp-snap' / 'refresh.lock'
    lock.parent.mkdir(exist_ok=True)
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        print('已有刷新锁。确认没有刷新进程后才可移除 .tmp-snap/refresh.lock。', file=sys.stderr)
        return 2
    try:
        os.write(descriptor, json.dumps({'pid': os.getpid(), 'startedAt': now_iso()}).encode())
        os.close(descriptor)
        run = {'schemaVersion': 1, 'startedAt': now_iso(), 'mode': 'offline' if args.offline else 'online',
               'dailyMode': args.daily, 'steps': []}
        available = commands(args.offline)
        previous_token = os.environ.get('FUND_DATA_REFRESH_TOKEN')
        if args.daily and not args.offline:
            token = uuid.uuid4().hex
            os.environ['FUND_DATA_REFRESH_TOKEN'] = token
            batch_start = time.monotonic()
            run['batchFundRecords'] = (prepare_daily_funds(token)
                if set(selected) & {'funds', 'research_funds', 'portfolio'} else 0)
            run['batchFundSeconds'] = round(time.monotonic() - batch_start, 2)
            print('批量净值：%d条，%.2fs' % (run['batchFundRecords'], run['batchFundSeconds']), flush=True)
            available['stocks'].extend(['--workers', '12'])
            available['portfolio'].extend(['--workers', '24'])
            available['research_funds'] = [sys.executable, str(ROOT / 'scripts/build_portfolio_data.py'), '--sync-verified']
        results = {}
        def run_one(name):
            print('刷新 %s …' % name, flush=True)
            limit = args.funds_timeout if name in ('funds', 'research_funds') and args.funds_timeout else args.timeout
            if name == 'portfolio' and args.portfolio_timeout:
                limit = args.portfolio_timeout
            step = (execute(name, available[name], limit, args.offline, allow_partial=True)
                    if args.daily else execute(name, available[name], limit, args.offline))
            if name == 'portfolio' and step['exitCode'] == 0 and not (args.daily and not args.offline):
                from scripts.build_portfolio_data import prune
                prune()
            print('  %s（exit=%d，%.1fs）' % (step['status'], step['exitCode'], step['seconds']), flush=True)
            return step
        if args.daily and not args.offline:
            for phase in (('funds', 'indices', 'stocks', 'overseas_stocks'),
                          ('strategy', 'portfolio'), ('research_funds', 'screening'), ('quality',)):
                names = [name for name in phase if name in selected]
                with ThreadPoolExecutor(max_workers=max(1, len(names))) as pool:
                    futures = {pool.submit(run_one, name): name for name in names}
                    for future in as_completed(futures):
                        results[futures[future]] = future.result()
                if 'portfolio' in names and results['portfolio']['exitCode'] == 0:
                    from scripts.build_portfolio_data import prune
                    prune()  # Strategy readers have finished using the previous catalog.
                if 'portfolio' in names:
                    run['benchmarkSync'] = execute('benchmark_sync',
                        [sys.executable, str(ROOT / 'scripts/build_portfolio_data.py'), '--sync-benchmarks'],
                        15, args.offline, allow_partial=True)
            run['steps'] = [results[name] for name in selected]
        else:
            run['steps'] = [run_one(name) for name in selected]
        run['completedAt'] = now_iso()
        run['status'] = 'completed' if all(step['exitCode'] == 0 for step in run['steps']) else 'partial'
        encoded = json.dumps(run, ensure_ascii=False, indent=2)
        atomic_text(DATA / 'refresh-report.json', encoded + '\n')
        atomic_text(DATA / 'refresh-report.js', 'var REFRESH_REPORT=' + encoded + ';\n')
        print('刷新结果：%s；数据质量详见 data/quality.json。' % run['status'])
        safe_partial = args.daily and all(step['exitCode'] == 0 or step.get('retainedPrevious')
                                         or step.get('sourcePartial') for step in run['steps'])
        return 0 if run['status'] == 'completed' or safe_partial else 1
    finally:
        if 'previous_token' in locals():
            if previous_token is None:
                os.environ.pop('FUND_DATA_REFRESH_TOKEN', None)
            else:
                os.environ['FUND_DATA_REFRESH_TOKEN'] = previous_token
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    raise SystemExit(main())
