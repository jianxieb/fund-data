#!/usr/bin/env python3
"""Reject a generated refresh that loses records or moves source dates backward."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import data_quality
from data_status import DATA, ROOT


EXPECTED_STEPS = ('funds', 'research_funds', 'indices', 'stocks', 'overseas_stocks', 'screening', 'strategy', 'portfolio', 'quality')
IDENTITIES = {'FUNDS': 'c', 'EXTRA': 'c', 'STOCKS': 'c', 'INDEX_DATA': 'c',
              'OVERSEAS_STOCKS': 'symbol', 'BM': 'n', 'STRATEGY_ASSETS': 'c'}
DATED_FIELDS = {'FUNDS': ('navdate', 'returnAsOf', 'riskAsOf', 'szdate'),
                'EXTRA': ('navdate', 'returnAsOf', 'riskAsOf', 'szdate'),
                'STOCKS': ('priceAsOf', 'returnAsOf', 'riskAsOf', 'valuationAsOf', 'fundamentalsAsOf'),
                'OVERSEAS_STOCKS': ('priceAsOf', 'returnAsOf', 'riskAsOf', 'valuationAsOf', 'fundamentalsAsOf'),
                'INDEX_DATA': ('asof',), 'BM': ('asOf',)}
TOP_LEVEL_DATES = (('META', 'navdate'), ('INDEX_META', 'asof'),
                   ('STRATEGY_META', 'end'))


def baseline_snapshot(ref='HEAD'):
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        for name in ('snapshot.js', 'indices.js', 'screening.js', 'overseas-stocks.js', 'portfolio/catalog.js'):
            result = subprocess.run(['git', 'show', f'{ref}:data/{name}'], cwd=ROOT,
                                    capture_output=True, check=False)
            if result.returncode and name in ('portfolio/catalog.js', 'overseas-stocks.js'):
                continue  # The initial portfolio publication has no previous catalog.
            result.check_returncode()
            destination = directory / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(result.stdout)
        original = data_quality.DATA
        try:
            data_quality.DATA = directory
            return data_quality.read_snapshot()
        finally:
            data_quality.DATA = original


def check_results(report, quality):
    problems = []
    steps = report.get('steps') or []
    if report.get('status') != 'completed' or tuple(item.get('dataset') for item in steps) != EXPECTED_STEPS:
        problems.append('刷新报告不是完整九阶段成功结果')
    for item in steps:
        if item.get('exitCode') != 0 or item.get('status') != 'completed':
            problems.append('阶段失败：' + str(item.get('dataset')))
    if quality.get('summary', {}).get('errors') != 0:
        problems.append('质量检查仍有错误')
    return problems


def check_snapshots(before, after):
    problems = []
    for section, key in IDENTITIES.items():
        old_rows, new_rows = before.get(section) or [], after.get(section) or []
        old_ids = [row.get(key) for row in old_rows]
        new_ids = [row.get(key) for row in new_rows]
        if len(old_ids) != len(set(old_ids)) or len(new_ids) != len(set(new_ids)):
            problems.append(section + ' 标的身份重复')
        if set(old_ids) != set(new_ids):
            problems.append(section + ' 标的集合变化')
        old_by_id = {row.get(key): row for row in old_rows}
        for row in new_rows:
            identity = row.get(key)
            previous = old_by_id.get(identity, {})
            for field in DATED_FIELDS.get(section, ()):
                old_day, new_day = previous.get(field), row.get(field)
                if old_day and (not new_day or str(new_day)[:10] < str(old_day)[:10]):
                    problems.append(f'{section} {identity} {field} 日期倒退：{old_day} → {new_day}')
            if section == 'STOCKS':
                for years, prior in (previous.get('pePercentiles') or {}).items():
                    current = (row.get('pePercentiles') or {}).get(years, {})
                    if prior.get('status') == 'available' and current.get('status') not in ('available', 'loss'):
                        problems.append(f'STOCKS {identity} {years}年PE历史退化：{current.get("status", "missing")}')
    for section, field in TOP_LEVEL_DATES:
        old_day = (before.get(section) or {}).get(field)
        new_day = (after.get(section) or {}).get(field)
        if old_day and (not new_day or str(new_day)[:10] < str(old_day)[:10]):
            problems.append(f'{section}.{field} 日期倒退：{old_day} → {new_day}')
    previous = before.get('PORTFOLIO_CATALOG') or {}
    current = after.get('PORTFOLIO_CATALOG') or {}
    if previous:
        old_rows = {row['id']: row for row in previous.get('assets') or []}
        new_rows = {row['id']: row for row in current.get('assets') or []}
        if set(old_rows) != set(new_rows):
            problems.append('PORTFOLIO_CATALOG 标的集合变化')
        for identity, prior in old_rows.items():
            row = new_rows.get(identity) or {}
            if prior.get('status') == 'available' and (row.get('status') != 'available' or row.get('asOf', '') < prior.get('asOf', '')):
                problems.append('组合历史退化：' + identity)
        old_fx, new_fx = previous.get('fx') or {}, current.get('fx') or {}
        if old_fx.get('status') == 'available' and (new_fx.get('status') != 'available' or new_fx.get('asOf', '') < old_fx.get('asOf', '')):
            problems.append('组合美元兑人民币历史退化')
    return problems


def main():
    report = json.loads((DATA / 'refresh-report.json').read_text(encoding='utf-8'))
    quality = json.loads((DATA / 'quality.json').read_text(encoding='utf-8'))
    problems = check_results(report, quality)
    problems.extend(check_snapshots(baseline_snapshot(), data_quality.read_snapshot()))
    from scripts.build_portfolio_data import universe, validate_catalog
    try:
        validate_catalog(data_quality.read_snapshot().get('PORTFOLIO_CATALOG') or {}, universe())
    except (ValueError, OSError) as exc:
        problems.append('组合每日历史校验失败：' + str(exc))
    if problems:
        for item in problems:
            print('拒绝发布：' + item)
        return 1
    print('刷新通过：九阶段成功、质量错误为零、标的集合及来源日期未倒退。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
