#!/usr/bin/env python3
"""Audit shipped observations without representing structural checks as source verification."""
import argparse
import json
import math
import re
import shutil
import subprocess
from datetime import date, datetime
from pathlib import Path

from data_status import DATA, ROOT, atomic_text, now_iso


def read_snapshot():
    node = shutil.which('node')
    if not node:
        raise RuntimeError('质量校验需要 Node.js 18+ 来读取本地 JS 数据快照')
    script = """
const fs=require('fs'),vm=require('vm'),path=require('path');
const context={}; vm.createContext(context);
for(const name of ['snapshot.js','indices.js','screening.js']) {
  const file=path.join(process.argv[1],name);
  if(fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),context,{timeout:1000});
}
process.stdout.write(JSON.stringify(context));
"""
    result = subprocess.run([node, '-e', script, str(DATA)], text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError('数据脚本不可读：' + result.stderr[:300])
    return json.loads(result.stdout)


def age_days(value, today):
    try:
        return (today - date.fromisoformat(str(value)[:10])).days
    except (TypeError, ValueError):
        return None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def audit(snapshot, today=None):
    today = today or date.today()
    datasets = []
    checks = []

    def dataset(identifier, label, rows, asof=None):
        dates = sorted({str(value)[:10] for row in rows for value in
                        [row.get('returnAsOf') or row.get('retdate') or row.get('asOf') or row.get('asof') or row.get('navdate') or row.get('latest')]
                        if value and age_days(value, today) is not None})
        result = {'id': identifier, 'label': label, 'asOf': asof or (dates[-1] if dates else None),
                  'dateRange': [dates[0], dates[-1]] if dates else None,
                  'records': len(rows), 'issues': []}
        datasets.append(result)
        return result

    def issue(target, code, severity, message, affected=None):
        item = {'code': code, 'severity': severity, 'message': message}
        if affected is not None:
            item['affected'] = affected
        target['issues'].append(item)

    funds = snapshot.get('FUNDS', [])
    fd = dataset('funds', '海外基金', funds, snapshot.get('META', {}).get('navdate'))
    for row in funds:
        code = row.get('c', '?')
        if not finite(row.get('nav')) or row['nav'] <= 0:
            issue(fd, 'invalid_nav', 'error', '单位净值缺失或无效', code)
        if len(row.get('r') or []) != 5:
            issue(fd, 'return_shape', 'error', '收益窗口必须为1/2/3/5/10年', code)
        elif any(value is not None and (not finite(value) or value <= -100) for value in row['r']):
            issue(fd, 'return_range', 'error', '收益包含无效数值', code)
        age = age_days(row.get('navdate'), today)
        if age is None or age > 10:
            issue(fd, 'stale_nav', 'warning', '净值缺日期或超过10个自然日；不能当作最新值', code)
        elif age < 0:
            issue(fd, 'future_nav', 'error', '净值日期在未来', code)
    legacy = [r.get('c') for r in funds if not r.get('returnBasis')]
    if legacy:
        issue(fd, 'legacy_return_basis', 'unverified', '历史收益缺少可重算的原始序列与复权记录，暂未独立核验', legacy)
    static_fees = [r.get('c') for r in funds if not r.get('feeAsOf')]
    if static_fees:
        issue(fd, 'fee_source_date', 'unverified', '费率缺生效日期，购买前需以基金正式文件与交易渠道为准', static_fees)
    if len({row.get('c') for row in funds}) != len(funds):
        issue(fd, 'duplicate_code', 'error', '海外基金存在重复代码')
    checks.append({'id': 'fund_schema', 'status': 'pass' if not any(i['severity'] == 'error' for i in fd['issues']) else 'fail',
                   'scope': '只检查字段、数值范围、重复代码及日期；不证明收益数值正确'})

    benchmark_rows = snapshot.get('BM', [])
    bd = dataset('benchmarks', '海外指数与ETF基准', benchmark_rows)
    composites = {r.get('n'): r for r in benchmark_rows}
    nasdaq, ndx = composites.get('纳斯达克综合指数'), composites.get('纳斯达克100指数')
    if nasdaq and ndx and any(finite(x) for x in nasdaq.get('usd', [])) and nasdaq.get('usd') == ndx.get('usd'):
        issue(bd, 'duplicate_distinct_indices', 'error', '纳综和纳指100的全部收益完全相同，疑似串线，禁止用于比较')
    for row in benchmark_rows:
        name = row.get('n', '?')
        if row.get('status') in ('unverified_legacy', 'quarantined', 'unavailable') or not row.get('basis'):
            issue(bd, 'benchmark_not_recomputed', 'unverified', '基准尚未用具有标的身份、币种与端点日期的原始序列重算', name)
        if row.get('status') == 'computed' and age_days(row.get('asOf'), today) not in range(0, 11):
            issue(bd, 'stale_benchmark', 'warning', '基准日期不在最近10个自然日内', name)
        if any(x is not None for x in row.get('cny', [])) and not row.get('periods'):
            issue(bd, 'fx_without_endpoints', 'error', '人民币收益缺少可核对的汇率起止日期', name)
        if 'ETF' in row.get('tp', '') and '未复权' in row.get('note', ''):
            issue(bd, 'unadjusted_etf', 'error', '未复权ETF价格含拆分断点，不能作为总收益基准', name)
    missing_fx = [row.get('n') for row in benchmark_rows if row.get('riskCNY5', {}).get('status') == 'incomplete_fx']
    if missing_fx:
        dates = sorted({day for row in benchmark_rows for day in row.get('riskCNY5', {}).get('missingFxDates', [])})
        issue(bd, 'fx_risk_incomplete', 'warning', '完整人民币日风险缺少实际汇率（%s）；未沿用美元风险或填补汇率' % '、'.join(dates[:5]), missing_fx)

    stocks = snapshot.get('STOCKS', [])
    sd = dataset('stocks', '股票观察清单', stocks, snapshot.get('STOCK_ASOF'))
    if any(not r.get('historySource') for r in stocks):
        issue(sd, 'legacy_stock_metrics', 'unverified', '旧股票快照没有逐项行情来源，后复权收益不等同于已核验分红再投资收益')
    if any(not r.get('dividendWindow') for r in stocks):
        issue(sd, 'legacy_dividend_window', 'unverified', '旧股息统计存在固定起始年和未来除息过滤问题，待重新抓取')
    if any(not r.get('fundamentalsAsOf') for r in stocks):
        issue(sd, 'fundamentals_period', 'unverified', '估值/ROE缺少报告期，不用于盈利质量打分')
    failed_stocks = [row.get('c') for row in stocks if row.get('dataStatus') == 'refresh_failed']
    if failed_stocks:
        issue(sd, 'stock_refresh_failed', 'warning', '更新失败，保留旧数据及原日期；详情见最近在线尝试', failed_stocks)
    for row in stocks:
        if age_days(row.get('latest'), today) not in range(0, 11):
            issue(sd, 'stale_stock', 'warning', '股票历史日期缺失或超过10日', row.get('c'))

    strategy = snapshot.get('STRATEGY_RESULTS', [])
    meta = snapshot.get('STRATEGY_META', {})
    td = dataset('strategy', '买入策略实验', strategy, meta.get('end'))
    if meta.get('modelVersion', 1) < 2 or not meta.get('initialCashIncluded'):
        issue(td, 'legacy_cashflow_model', 'error', '旧模型将分批投入的期初资金当未来现金流，收益和风险结果已隔离')
    if meta.get('basis') != 'provider_adjusted_close':
        issue(td, 'unknown_adjusted_close', 'unverified', '旧第三方close字段无法证明为复权收盘价')
    issue(td, 'single_window_backtest', 'warning', '单一起止窗口有起点偏差；不同预算策略不可只按期末金额排序')
    issue(td, 'leverage_daily_target', 'warning', '杠杆ETF目标是单日倍数，长期路径与指数倍数不同；仅作为独立实验')

    extra = snapshot.get('EXTRA', [])
    ed = dataset('domestic_funds', '扩展基金研究池', extra)
    unknown = [r.get('c') for r in extra if not r.get('returnBasis') and not r.get('basis')]
    if unknown:
        issue(ed, 'domestic_basis_unverified', 'unverified', '扩展研究池的历史快照尚未逐只重算，候选资格不代表收益数据已核验', unknown)
    # Exchange-traded ETFs incur broker commissions, not the OTC subscription/
    # redemption schedule represented by these fields. LOF OTC routes still need it.
    fees_missing = [r.get('c') for r in extra if r.get('t') not in ('场内ETF', 'ETF')
                    and (r.get('buy') is None or r.get('rd') is None)]
    if fees_missing:
        issue(ed, 'domestic_fee_missing', 'warning', '场外申购或赎回费率缺失，统一显示待核验', fees_missing)
    stale_extra = [r.get('c') for r in extra if age_days(r.get('navdate'), today) is None
                   or age_days(r.get('navdate'), today) > 10]
    if stale_extra:
        issue(ed, 'stale_research_nav', 'warning', '%d只扩展基金的净值缺日期或超过10日；规则重生成不代表净值已更新' % len(stale_extra), stale_extra)
    # Manager observations belong to their own source date. Running the policy
    # again must not silently advance the appointment record or its freshness.
    for target, records in ((fd, funds), (ed, extra)):
        missing_managers, stale_managers, invalid_managers = [], [], []
        for row in records:
            people, asof = row.get('managerRecords') or [], row.get('managerAsOf')
            age = age_days(asof, today)
            if not isinstance(people, list) or any(not isinstance(person, dict) for person in people):
                invalid_managers.append(row.get('c'))
            elif not people or age is None or not row.get('managerSourceUrl'):
                missing_managers.append(row.get('c'))
            elif age < 0 or any(not p.get('name') or age_days(p.get('start'), date.fromisoformat(str(asof)[:10])) is None
                                or age_days(p.get('start'), date.fromisoformat(str(asof)[:10])) < 0 for p in people):
                invalid_managers.append(row.get('c'))
            elif age > 30:
                stale_managers.append(row.get('c'))
        if missing_managers:
            issue(target, 'manager_date_unverified', 'unverified', '个人经理任职起点、观察日期或来源未完整核验', missing_managers)
        if invalid_managers:
            issue(target, 'manager_date_invalid', 'error', '经理资料出现未来日期、无效起点或缺少姓名', invalid_managers)
        if stale_managers:
            issue(target, 'stale_manager_observation', 'warning', '%d只基金的经理资料超过30日，需重新核对现任名单' % len(stale_managers), stale_managers)

    indices = snapshot.get('INDEX_DATA', snapshot.get('INDICES', []))
    if isinstance(indices, dict):
        indices = indices.get('indices', indices.get('rows', []))
    idata = dataset('indices', '国内指数', indices if isinstance(indices, list) else [], snapshot.get('INDEX_META', {}).get('asof'))
    if not indices:
        issue(idata, 'index_data_missing', 'warning', '独立指数价格序列未就绪，不得用关联基金替代')
    for row in indices if isinstance(indices, list) else []:
        if row.get('status') in ('unavailable', 'unverified', 'error'):
            issue(idata, 'index_source_unavailable', 'warning', '指数源数据不可用，收益留空', row.get('n', row.get('c')))
        elif age_days(row.get('asof'), today) not in range(0, 11):
            issue(idata, 'stale_index', 'warning', '指数日期缺失或超过10个自然日', row.get('c'))
        if len(row.get('r', [])) != 5 or any(x is not None and not finite(x) for x in row.get('r', [])):
            issue(idata, 'index_return_schema', 'error', '指数收益窗口或数值异常', row.get('c'))

    for result in datasets:
        severities = {i['severity'] for i in result['issues']}
        result['status'] = 'attention' if 'error' in severities else 'unverified' if 'unverified' in severities else 'warning' if 'warning' in severities else 'checked'
    counts = {kind: sum(i['severity'] == level for d in datasets for i in d['issues'])
              for kind, level in [('errors', 'error'), ('warnings', 'warning'), ('unverified', 'unverified')]}
    return {'schemaVersion': 1, 'checkedAt': now_iso(), 'asOf': today.isoformat(),
            'status': 'attention' if counts['errors'] else 'unverified' if counts['unverified'] else 'warning' if counts['warnings'] else 'checked',
            'summary': counts, 'datasets': datasets, 'checks': checks,
            'scope': '结构校验、计算逻辑回归和部分官方资料核对；不是对全部历史数值的独立审计。'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--strict', action='store_true', help='存在数据错误时以非零码退出')
    args = parser.parse_args()
    report = audit(read_snapshot())
    encoded = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    atomic_text(DATA / 'quality.json', encoded + '\n')
    atomic_text(DATA / 'quality.js', 'var DATA_QUALITY=' + encoded + ';\n')
    print(json.dumps({'status': report['status'], **report['summary']}, ensure_ascii=False))
    return 2 if args.strict and report['summary']['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
