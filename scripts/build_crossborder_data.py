#!/usr/bin/env python3
"""Build dated NAV/market total-return summaries and distribution evidence."""
import argparse
import json
import math
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update import add_years, total_return_series, risk_window, history_fetch
from fund_evidence import fund_actions
from scripts.build_buy_location_data import chart


def summarize(series, end):
    series = sorted((d, v) for d, v in series if d <= end)
    if len(series) < 2 or any(not math.isfinite(v) or v <= 0 for _, v in series):
        raise ValueError('复权序列无效或不足')
    if any(not 0 < (date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days <= 21 for a, b in zip(series, series[1:])):
        raise ValueError('日线重复或缺口超过21日')
    last = series[-1][0]
    returns, periods = [], []
    for years in (1, 2, 3, 5, 10):
        prior = [(d, v) for d, v in series if d <= add_years(last, -years)]
        baseline = prior[-1] if prior else None
        returns.append(round((series[-1][1] / baseline[1] - 1) * 100, 6) if baseline else None)
        periods.append({'years': years, 'start': baseline[0] if baseline else None, 'end': last})
    risk = risk_window(series, last, 5)
    return {'r': returns, 'returnPeriods': periods, 'returnAsOf': last,
            'first': series[0][0], 'mdd5': risk['mdd'], 'vol5': risk['vol'], 'riskAsOf': last}


def build(fund, offline):
    code, end = fund['c'], fund['returnAsOf']
    out = {'errors': []}
    if not end:
        return code, {'errors': ['净值历史：缺独立复算截至日'],
            'nav': {'r': [None] * 5, 'returnAsOf': None, 'returnPeriods': [],
                    'mdd5': None, 'vol5': None, 'missing': '缺独立复算净值历史'},
            'actions': {'status': 'unavailable', 'missing': '缺独立复算截至日'}}
    try:
        path = ROOT / '.tmp-hist' / (code + '.json')
        rows = json.loads(path.read_text()) if path.exists() else []
        if not offline and max((r.get('FSRQ', '') for r in rows), default='') < end:
            rows = history_fetch(code) or rows
        first = fund.get('returnFirst') or ''
        # Use the same independently verified history boundary as the snapshot.
        # An invalid source observation before all displayed windows cannot turn
        # an otherwise valid ten-year series into a missing NAV result.
        nav = total_return_series([row for row in rows if first <= row.get('FSRQ', '') <= end])
        out['nav'] = {**summarize(nav, end), 'basis': 'fund_nav_total_return',
                      'source': 'https://fundf10.eastmoney.com/jjjz_' + code + '.html'}
    except (OSError, ValueError) as exc:
        out['errors'].append('净值历史：' + str(exc))
        nav = None
    out['actions'] = fund_actions(code, end)
    if fund['exchange']:
        try:
            symbol = code + ('.SS' if code.startswith('5') else '.SZ')
            prices, _, source, digest = chart(symbol, end, offline, min_observations=2)
            if not nav:
                raise ValueError('缺少同期净值历史')
            common = set(d for d, _ in nav) & set(d for d, _ in prices)
            common_end = max(common)
            if (date.fromisoformat(end) - date.fromisoformat(common_end)).days > 7:
                raise ValueError('成交价历史落后净值超过7日')
            # Both bases end on the same actual day. Individual window baselines
            # remain explicit; there is no invented price/holiday interpolation.
            out['nav'] = {**out['nav'], **summarize(nav, common_end)}
            out['market'] = {**summarize(prices, common_end), 'basis': 'market_adjusted_close',
                             'source': source, 'sourceSha256': digest}
        except Exception as exc:
            out['errors'].append('成交价历史：' + str(exc))
    return code, out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    code = "const fs=require('fs'),vm=require('vm'),M=require('./assets/model.js'),ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync('data/snapshot.js','utf8'),ctx);console.log(JSON.stringify(M.dedupeFunds(ctx.FUNDS,ctx.EXTRA).filter(f=>M.isCrossborderIndex(f)&&f.returnAsOf)))"
    funds = json.loads(subprocess.check_output(['node', '-e', code], cwd=ROOT, text=True))
    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = list(pool.map(lambda f: build(f, args.offline), funds))
    out = {'schemaVersion': 1, 'builtAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'byCode': dict(entries)}
    path = ROOT / 'data/crossborder.js'
    temp = path.with_suffix('.js.tmp')
    temp.write_text('window.CROSSBORDER_DATA=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    temp.replace(path)
    print('跨境基金 %d；场内成交价 %d；分红记录 %d' % (len(entries), sum('market' in row for _, row in entries), sum(row['actions']['status'] == 'recorded' for _, row in entries)))
    for c, row in entries:
        if row['errors']:
            print(c, '；'.join(row['errors']))


if __name__ == '__main__':
    main()
