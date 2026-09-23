#!/usr/bin/env python3
"""Cross-platform, bounded update entry point. Never commits, pushes, or edits the UI."""
import argparse
import json
import os
import subprocess
import sys
import time

from data_status import DATA, ROOT, atomic_text, now_iso, write_status

DATASETS = ('funds', 'indices', 'stocks', 'screening', 'strategy', 'quality')


def commands(offline=False):
    flag = ['--offline'] if offline else []
    return {
        'funds': [sys.executable, str(ROOT / 'update.py'), *flag],
        'indices': [sys.executable, str(ROOT / 'indices.py'), *flag],
        'stocks': [sys.executable, str(ROOT / 'stock_screen.py'), *flag],
        # Daily policy regeneration is offline. A whole-market screen is a separate
        # expensive research job, not a daily download of all 1,268 legacy candidates.
        'screening': [sys.executable, str(ROOT / 'screens' / 'fund_screen.py'), 'policy'],
        'strategy': [sys.executable, str(ROOT / 'strategy_backtest.py'), *(flag if offline else ['--refresh'])],
        'quality': [sys.executable, str(ROOT / 'data_quality.py'), '--strict'],
    }


def execute(dataset, command, timeout, offline=False):
    started = time.monotonic()
    attempted = now_iso()
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
    duration = round(time.monotonic() - started, 2)
    directory = ROOT / '.tmp-snap'
    directory.mkdir(exist_ok=True)
    atomic_text(directory / ('refresh-' + dataset + '.log'), log)
    # A zero exit code can mean cache-only validation: do not replace it with 'fresh'.
    if code != 0:
        write_status(dataset, status, exitCode=code, seconds=duration, message=log[-1200:], mode='offline' if offline else 'online')
    else:
        try:
            existing = json.loads((DATA / 'update-status.json').read_text(encoding='utf-8')).get('datasets', {}).get(dataset, {})
        except (OSError, ValueError):
            existing = {}
        if existing.get('attemptedAt', '') >= attempted:
            details = {key: value for key, value in existing.items() if key not in ('status', 'attemptedAt', 'execution', 'mode', 'lastOnlineAttempt')}
            details['mode'] = 'offline' if offline else 'online'
            write_status(dataset, existing['status'], **details, execution={'exitCode': 0, 'seconds': duration})
        else:
            write_status(dataset, 'cached' if offline and dataset not in ('quality', 'screening') else 'checked' if dataset in ('quality', 'screening') else 'success',
                         exitCode=0, seconds=duration, mode='offline' if offline else 'online', message='执行成功；数据准确性与日期由质量报告单独说明。')
    return {'dataset': dataset, 'status': status, 'exitCode': code, 'seconds': duration,
            'log': '.tmp-snap/refresh-' + dataset + '.log'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='所有被选的数据集严格不联网')
    parser.add_argument('--datasets', default=','.join(DATASETS), help='逗号分隔：' + ','.join(DATASETS))
    parser.add_argument('--timeout', type=int, default=180, help='每个数据集最大运行秒数（默认180）')
    args = parser.parse_args()
    selected = list(dict.fromkeys(x.strip() for x in args.datasets.split(',') if x.strip()))
    if not selected or set(selected) - set(DATASETS):
        parser.error('未知或空的数据集列表')
    if args.timeout < 1:
        parser.error('--timeout 必须大于0')
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
        run = {'schemaVersion': 1, 'startedAt': now_iso(), 'mode': 'offline' if args.offline else 'online', 'steps': []}
        available = commands(args.offline)
        for name in selected:
            print('刷新 %s …' % name, flush=True)
            step = execute(name, available[name], args.timeout, args.offline)
            run['steps'].append(step)
            print('  %s（exit=%d，%.1fs）' % (step['status'], step['exitCode'], step['seconds']), flush=True)
        run['completedAt'] = now_iso()
        run['status'] = 'completed' if all(step['exitCode'] == 0 for step in run['steps']) else 'partial'
        encoded = json.dumps(run, ensure_ascii=False, indent=2)
        atomic_text(DATA / 'refresh-report.json', encoded + '\n')
        atomic_text(DATA / 'refresh-report.js', 'var REFRESH_REPORT=' + encoded + ';\n')
        print('刷新结果：%s；数据质量详见 data/quality.json。' % run['status'])
        return 0 if run['status'] == 'completed' else 1
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    raise SystemExit(main())
