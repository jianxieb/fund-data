#!/usr/bin/env python3
"""Bind market financial leads to dated, frozen company reviews without approving leads."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.build_stock_reports import report_row


def build(discovery, research):
    asof = discovery['asOf']
    reviewed = {r['code']: r for r in research['companies']
                if r['checkedAt'] == asof and r['reportPeriod'] == discovery['latest']}
    leads = {r['code']: r for r in discovery['records']
             if any(s['financialQualified'] for s in r.get('stages', {}).values())}
    dossiers = {r['code']: r for r in json.loads((ROOT / 'data/stock-report-research.json').read_text())['companies']}
    records = []
    for code in sorted(set(leads) | set(reviewed)):
        lead, evidence = leads.get(code, {}), reviewed.get(code)
        record = {'code': code, 'name': lead.get('name') or evidence['name'],
                  'stages': lead.get('stages', {}), 'businessStatus': 'business_review_pending',
                  'publishedGroups': [], 'sources': []}
        if evidence:
            data = json.loads((ROOT / 'company-report/data' / code / 'summary.json').read_text())
            if data['asOf'] != asof or dossiers[code].get('earningsReview') != evidence:
                raise ValueError(code + ' 的经营复核和冻结报告不一致')
            row = report_row(data)
            groups = [name for key, name in [('longTermReview', 'quality'), ('growthReview', 'growth')]
                      if (row.get(key) or {}).get('qualified')]
            if not groups and (row.get('breakoutReview') or {}).get('qualified'):
                groups = ['breakout']
            record.update(businessStatus='reviewed', publishedGroups=groups,
                          decision=evidence['rationale'], growthDecision=evidence['growthDecision'],
                          breakoutDecision=evidence['breakoutDecision'],
                          sources=dossiers[code]['sources'],
                          reportPath='docs/company-reports/' + code + '-' + asof + '.md')
        else:
            record['decision'] = '仅财务线索，尚未覆盖本期经营复核；不作淘汰或质量结论。'
        records.append(record)
    breakout = {code for code, lead in leads.items() if lead['stages']['breakout']['financialQualified']}
    return {'schemaVersion': 2, 'asOf': asof, 'reportPeriod': discovery['latest'],
            'discoveryPath': 'docs/research/stock-stages-discovery-' + asof + '.json',
            'scope': '营收增速不设统一淘汰线；财务发现、经营覆盖和实际发布分别计数。',
            'coverage': {'financialLeads': len(leads), 'reviewedCompanies': len(reviewed),
                         'reviewedFinancialLeads': len(set(leads) & set(reviewed)),
                         'pendingFinancialLeads': len(set(leads) - set(reviewed)),
                         'financialBreakoutLeads': len(breakout),
                         'reviewedBreakoutLeads': len(breakout & set(reviewed)),
                         'pendingBreakoutLeads': len(breakout - set(reviewed))},
            'publishedCounts': {stage: sum(stage in r['publishedGroups'] for r in records)
                                for stage in ('quality', 'growth', 'breakout')},
            'records': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asof', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    discovery = json.loads((ROOT / 'docs/research' / ('stock-stages-discovery-' + args.asof + '.json')).read_text())
    research = json.loads((ROOT / 'data/stock-earnings-research.json').read_text())
    result = build(discovery, research)
    path = ROOT / 'docs/research' / ('stock-stages-review-' + args.asof + '.json')
    if args.check:
        if json.loads(path.read_text()) != result:
            raise ValueError('逐公司复核记录需要重新生成')
    else:
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'coverage': result['coverage'], 'publishedCounts': result['publishedCounts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
