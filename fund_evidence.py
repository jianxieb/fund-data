"""Distribution/split evidence shared by fund and channel research pages."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def fund_actions(code, end, archive=None, rows=None):
    if archive is None:
        archive = json.loads((ROOT / 'data/fund-actions.json').read_text())['funds']
    record = archive.get(code)
    dividends, splits = {}, {}
    if record:
        dividends.update(record.get('dividends') or {})
        splits.update(record.get('splits') or {})
    if rows is None:
        path = ROOT / '.tmp-hist' / (code + '.json')
        rows = json.loads(path.read_text()) if path.exists() else []
    # Preserve previously sourced explicit events when a newer listing omits them.
    evidence = []
    for row in rows:
        day = row.get('FSRQ', '')
        if not row.get('ACTIONS_SOURCE') or not day or day > end:
            continue
        cash, factor = row.get('FHFCZ'), row.get('SPLIT_FACTOR')
        if cash is not None and float(cash) > 0:
            dividends.setdefault(day, float(cash))
        if factor is not None and float(factor) != 1:
            splits.setdefault(day, float(factor))
        if (cash and float(cash) > 0) or (factor and float(factor) != 1):
            evidence.append({'date': day, 'source': row['ACTIONS_SOURCE'], 'observedAt': row.get('ACTIONS_ASOF')})
    return {
        'cash': [{'date': day, 'perUnit': value} for day, value in sorted(dividends.items()) if day <= end],
        'splits': [{'date': day, 'factor': value} for day, value in sorted(splits.items()) if day <= end],
        'observedAt': record.get('observedAt') if record else None,
        'through': end, 'status': 'recorded' if record else 'unavailable',
        'source': record.get('sourceUrl') if record else None,
        'sourceSha256': record.get('sourceSha256') if record else None,
        'historicalEvidence': evidence,
        'verifiedEvents': record.get('verifiedEvents', []) if record else [],
        # Report-period evidence is descriptive, never an extra cash-flow event.
        # Do not show a report period that ends after the requested snapshot.
        'verifiedDistributionPeriods': [p for p in (record or {}).get('verifiedDistributionPeriods', [])
                                        if p.get('code') == code and p.get('end', '') <= end],
        'returnTreatment': 'reinvested_in_total_return',
    }
