#!/usr/bin/env python3
"""Fetch dated, normalized CNY consolidated report inputs without AKShare."""
import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from company_report import fetch_report
from stock_screen import fetch_json, load_old_rows, STOCK_UNIVERSE

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('code')
    p.add_argument('--as-of', default=datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d'))
    args = p.parse_args()
    if len(args.code) != 6 or not args.code.isdigit():
        p.error('证券代码须为6位数字')
    data = fetch_report(args.code, args.as_of, fetch_json)
    row = load_old_rows((ROOT / 'data/snapshot.js').read_text()).get(args.code, {})
    data['screeningContext'] = {
        'profile': next((p for p in STOCK_UNIVERSE if p['code'] == args.code), None),
        'security': {k: row[k] for k in ('historyFirst', 'valuationIndustry', 'ind') if k in row},
    }
    if row.get('valuationAsOf') == data['quote']['valuationAsOf']:
        data['pePercentiles'] = row.get('pePercentiles', {})
        data['pePercentilesAsOf'] = row['valuationAsOf']
    folder = ROOT / 'company-report/data' / args.code
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'summary.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(args.code, data['name'], data['asOf'], '财务记录', len(data['reports']), '缺口', data['fetchErrors'])
