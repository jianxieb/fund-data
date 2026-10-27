#!/usr/bin/env python3
"""Update independent derived data concurrently, retaining failed sources."""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import refresh
from data_status import DATA, atomic_text, now_iso

TASKS = {
    'fund_actions': ('scripts/build_fund_actions.py', ['--apply'], ('fund-actions.json',)),
    'crossborder': ('scripts/build_crossborder_data.py', [], ('crossborder.js',)),
    'etf_distributions': ('scripts/build_etf_distributions.py', [], ('etf-distributions.js',)),
    'return_indices': ('scripts/build_return_indices.py', [], ()),
    'financial_events': ('scripts/build_financial_events.py', [], ('financial-events-history.json',)),
    'bank_fx': ('scripts/refresh_money_flow_quotes.py', ['--timeout', '8'], ('money-flow-quotes.js',)),
    'market_history': ('market_history.py', [], ('market-history.json',)),
}


def run_task(name, timeout=60):
    script, args, outputs = TASKS[name]
    # The index builder also prunes superseded content-addressed files. Keep
    # every old referenced file available if this process is interrupted.
    if name == 'return_indices':
        outputs = tuple(p.relative_to(DATA).as_posix() for p in (DATA / 'return-comparison').glob('*.json'))
    refresh.PUBLISHED_OUTPUTS[name] = outputs
    step = refresh.execute(name, [sys.executable, str(ROOT / script), *args], timeout, allow_partial=True)
    print(name + ': ' + step['status'] + ' (%.2fs)' % step['seconds'], flush=True)
    return step


def main():
    report = {'startedAt': now_iso(), 'steps': []}
    report['steps'].append(run_task('fund_actions'))
    # Event chapters consume the new index catalog; do not race its atomic
    # catalog replacement and old-file cleanup. Unrelated sources stay parallel.
    names = [name for name in TASKS if name not in ('fund_actions', 'financial_events')]
    with ThreadPoolExecutor(max_workers=len(names)) as pool:
        report['steps'].extend(pool.map(run_task, names))
    report['steps'].append(run_task('financial_events'))
    report['steps'].append(refresh.execute('quality', [sys.executable, str(ROOT / 'data_quality.py'), '--strict'],
                                           30, allow_partial=True))
    report['completedAt'] = now_iso()
    report['status'] = 'completed' if all(s['exitCode'] == 0 for s in report['steps']) else 'partial'
    atomic_text(DATA / 'post-refresh-report.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(s['exitCode'] == 0 or s['retainedPrevious'] for s in report['steps']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
