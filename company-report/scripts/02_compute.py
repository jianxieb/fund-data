#!/usr/bin/env python3
"""Compute from the normalized v2 schema produced by 01_fetch_data.py."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from company_report import compute

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('用法：02_compute.py company-report/data/CODE/summary.json')
    path = Path(sys.argv[1])
    result = compute(json.loads(path.read_text(encoding='utf-8')))
    output = path.with_name('computed.json')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(output, '完整年度', len(result['annual']), '单季', len(result['quarters']))
