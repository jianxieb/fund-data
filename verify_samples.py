#!/usr/bin/env python3
"""Bounded representative checks, preserving raw evidence rather than a blanket accuracy claim."""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import update
from data_status import DATA, atomic_text, now_iso

SAMPLES = [
    {'code': '050025', 'reason': '常规海外指数基金'},
    {'code': '160213', 'reason': '多次大额现金分红', 'officialEvidence':
     'https://st.gtfund.com/report/2025/05/国泰纳斯达克100指数证券投资基金分红公告.pdf',
     'officialCheck': {'date': '2025-05-13', 'cashPerUnit': 1.1}},
    {'code': '513500', 'reason': '2022年1:2拆分', 'officialEvidence':
     'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2022-03-30/513500_20220330_2_VODYJTry.pdf',
     'officialCheck': {'date': '2022-03-29', 'splitFactor': 2}},
    {'code': '539001', 'reason': '2021年由主动QDII转为指数跟踪，长历史不可视作同一策略',
     'officialEvidence': 'https://www.ccbfund.cn/u/cms/jx/brief/012752.pdf',
     'officialCheck': {'contractEffective': '2021-09-22', 'scope': '同基金主代码539001的产品概要；不是原始净值逐行核验'}},
    {'code': '512890', 'reason': '国内红利低波ETF'},
]


def verify(item):
    code = item['code']
    result = {**item, 'checkedAt': now_iso(), 'source': 'Eastmoney public NAV history and corporate action tables',
              'historyUrl': 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=' + code + '&pageIndex=1&pageSize=10000&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1',
              'actionUrl': 'https://fundf10.eastmoney.com/fhsp_' + code + '.html',
              'profileUrl': 'https://fundf10.eastmoney.com/jjfl_' + code + '.html'}
    try:
        rows = update.history_fetch(code)
        if not rows:
            raise ValueError('上游历史为空且没有缓存')
        metrics = update.calc_metrics(rows)
        if not metrics:
            raise ValueError('有效历史不足')
        ordered = sorted(rows, key=lambda row: row['FSRQ'])
        dates = set([ordered[0]['FSRQ'], ordered[-1]['FSRQ']])
        for years in update.WINDOWS:
            target = update.add_years(metrics['asOf'], -years)
            earlier = [row['FSRQ'] for row in ordered if row['FSRQ'] <= target]
            if earlier:
                dates.add(earlier[-1])
        actions = []
        for index, row in enumerate(ordered):
            if (update.finite_number(row.get('FHFCZ')) or 0) > 0 or (update.finite_number(row.get('SPLIT_FACTOR')) or 1) != 1:
                actions.append({key: row.get(key) for key in ['FSRQ', 'FHFCZ', 'SPLIT_FACTOR', 'DWJZ', 'LJJZ', 'JZZZL']})
                dates.add(row['FSRQ'])
                if index:
                    dates.add(ordered[index - 1]['FSRQ'])
        result.update({'status': 'recomputed', 'observations': len(rows), 'metrics': metrics,
                       'rawEvidence': [row for row in ordered if row['FSRQ'] in dates], 'corporateActions': actions,
                       'normalizedHistorySha256': hashlib.sha256(json.dumps(ordered, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                       'limitation': '按所列第三方原始净值及分红拆分表重算；仅指定公告与官方资料独立核对，不代表全部历史已独立审计。'})
        official = item.get('officialCheck', {})
        if official.get('date'):
            action = next((row for row in actions if row['FSRQ'] == official['date']), {})
            for expected, field in [('cashPerUnit', 'FHFCZ'), ('splitFactor', 'SPLIT_FACTOR')]:
                if expected in official and abs((update.finite_number(action.get(field)) or 0) - official[expected]) > 1e-8:
                    raise ValueError('原始企业动作与所列官方公告不符：' + field)
            result['officialActionComparison'] = 'pass'
    except Exception as exc:
        result.update({'status': 'unavailable', 'error': str(exc)})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    update.OFFLINE = args.offline
    for folder in (update.HIST_DIR, update.FHSP_DIR):
        Path(folder).mkdir(exist_ok=True)
    results = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        pending = [pool.submit(verify, item) for item in SAMPLES]
        for future in as_completed(pending):
            result = future.result()
            results.append(result)
            print(result['code'], result['status'], result.get('error', ''), flush=True)
    results.sort(key=lambda row: row['code'])
    payload = {'schemaVersion': 1, 'checkedAt': now_iso(), 'samples': results,
               'scope': '五项代表样本的来源留存与计算复核；非全市场独立审计。'}
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    atomic_text(DATA / 'verification-samples.json', encoded + '\n')
    atomic_text(DATA / 'verification-samples.js', 'var VERIFICATION_SAMPLES=' + encoded + ';\n')
    return 0 if all(row['status'] == 'recomputed' for row in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
