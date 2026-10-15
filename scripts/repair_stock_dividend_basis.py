#!/usr/bin/env python3
"""Recompute frozen A-share dividends without refreshing quotes or financials.

Dry run is the default. --apply replaces only affected STOCKS rows, only when
their quote date/price and old or already-corrected yield still match evidence.
Other snapshot blocks are preserved byte for byte; no network access is used.
"""
import argparse
import copy
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stock_screen import load_old_rows
from stock_dividends import eastmoney_dividend_summary, update_dividend_fields


def repair(src, evidence):
    rows = load_old_rows(src)
    if {c['code'] for c in evidence['companies']} != set(rows):
        raise ValueError('冻结分红证据与当前股票名单不同，须重新核对')
    changed, updates = [], {}
    for company in evidence['companies']:
        code = company['code']
        if company.get('error'):
            raise ValueError(code + ' 的来源获取失败')
        records = company['records']
        if company.get('count', len(records)) != len(records) or company.get('pages', 1) > 1:
            raise ValueError(code + ' 的分红/送转证据被截断')
        result = eastmoney_dividend_summary(records, company['asOf'], company['price'], code)
        old_yield = company['previousYield12']
        if result['yield12'] == old_yield:
            continue
        row = rows[code]
        if row.get('price') != company['price'] or row.get('dividendAsOf') != company['asOf']:
            raise ValueError(code + ' 的价格或日期已变化，禁止覆盖更新快照')
        if row.get('yield12') not in (old_yield, result['yield12']):
            raise ValueError(code + ' 的股息率已变化，须重新核对')
        updated = update_dividend_fields(copy.deepcopy(row), result)
        if updated != row:
            updates[code] = updated
        changed.append({'code': code, 'name': company['name'], 'asOf': company['asOf'],
                        'price': company['price'], 'before': old_yield, 'after': result['yield12'],
                        'cashDividend12': result['cashDividend12'],
                        'shareActions': result['dividendShareActions'],
                        'styleBefore': company.get('previousStyle', row.get('style', [])), 'styleAfter': updated['style']})
    pattern = re.compile(r'(/\*__DATA_STOCKS_BEGIN__\*/)(.*?)(/\*__DATA_STOCKS_END__\*/)', re.S)
    match = pattern.search(src)
    if not match:
        raise ValueError('缺 STOCKS 数据块')
    block = match.group(2)
    for code, row in updates.items():
        line = re.compile(r'^\{"c":' + re.escape(json.dumps(code)) + r',.*\}(,?)$', re.M)
        if len(line.findall(block)) != 1:
            raise ValueError(code + ' 未找到唯一快照行')
        block = line.sub(lambda m: json.dumps(row, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + m.group(1), block)
    output = src[:match.start(2)] + block + src[match.end(2):]
    return output, {'audited': len(rows), 'affected': changed, 'updatedRows': sorted(updates)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=ROOT / 'docs/evidence/audit-20261016/a-share-dividends-source.json')
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'data/snapshot.js')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    original = args.snapshot.read_text(encoding='utf-8')
    output, report = repair(original, json.loads(args.evidence.read_text(encoding='utf-8')))
    if args.apply and output != original:
        # A separately running dataset refresh must finish before applying.
        if args.snapshot.read_text(encoding='utf-8') != original:
            raise RuntimeError('snapshot 在复算期间变化，未写入；请等待其它刷新结束后重试')
        temporary = args.snapshot.with_name(args.snapshot.name + '.dividend-repair.tmp')
        temporary.write_text(output, encoding='utf-8')
        os.replace(temporary, args.snapshot)
    report['applied'] = args.apply
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
