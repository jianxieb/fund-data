#!/usr/bin/env python3
"""Apply a dated classification policy to published evidence without altering prices."""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text
from stock_screen import load_old_rows, refresh_quality_review, format_block
from us_stock_groups import classify, LABELS
from overseas_research import report_for


def run(asof):
    path = ROOT / 'data/snapshot.js'
    source = path.read_text()
    rows = list(load_old_rows(source).values())
    for row in rows:
        refresh_quality_review(row, asof)
    source = re.sub(r'/\*__DATA_STOCKS_BEGIN__\*/.*?/\*__DATA_STOCKS_END__\*/', lambda _: format_block(rows), source, flags=re.S)
    atomic_text(path, source)
    path = ROOT / 'data/overseas-stocks.js'
    values = {}
    for line in path.read_text().splitlines():
        if line.startswith('var '):
            key, value = line[4:].split('=', 1)
            values[key] = json.loads(value.rstrip(';'))
    for row in values['OVERSEAS_STOCKS']:
        classify(row, asof)
    values['OVERSEAS_STOCK_META'].update(screeningAsOf=asof, groupCounts={g: sum(g in r['screening']['groups'] for r in values['OVERSEAS_STOCKS']) for g in LABELS})
    values['OVERSEAS_REPORTS'] = {'reports': [report_for(r) for r in values['OVERSEAS_STOCKS']]}
    atomic_text(path, ''.join('var ' + k + '=' + json.dumps(v,ensure_ascii=False,allow_nan=False,separators=(',', ':')) + ';\n' for k,v in values.items()))
    print('US', values['OVERSEAS_STOCK_META']['groupCounts'])
    print('CN', {k: sum(bool((r.get(k) or {}).get('qualified')) for r in rows) for k in ('longTermReview','growthReview','breakoutReview')})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--asof',default=date.today().isoformat())
    run(p.parse_args().asof)
