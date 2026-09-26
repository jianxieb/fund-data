#!/usr/bin/env python3
"""Archive parsed fund distributions/splits with source dates for cache-free runs."""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import update


def build_archive(cache_dir=Path(update.FHSP_DIR), current_path=Path(update.ACTION_ARCHIVE)):
    old = json.loads(current_path.read_text(encoding='utf-8')) if current_path.exists() else {}
    previous = old.get('funds', {})
    funds = update.parse_fund_lines(Path(update.HTML).read_text(encoding='utf-8'))
    result = {}
    for _, code, _ in funds:
        candidate = previous.get(code)
        path = cache_dir / f'fhsp_{code}.html'
        if path.exists():
            raw = path.read_bytes()
            actions = update.parse_actions_page(raw.decode('utf-8', 'replace'))
            if actions is not None:
                observed = datetime.fromtimestamp(path.stat().st_mtime, ZoneInfo('Asia/Shanghai')).date().isoformat()
                refreshed = {
                    'sourceUrl': f'https://fundf10.eastmoney.com/fhsp_{code}.html',
                    'observedAt': observed,
                    'sourceSha256': hashlib.sha256(raw).hexdigest(),
                    'dividends': dict(sorted(actions['dividends'].items())),
                    'splits': dict(sorted(actions['splits'].items())),
                }
                if candidate is None or refreshed['observedAt'] >= candidate.get('observedAt', ''):
                    candidate = refreshed
        if candidate is None:
            raise ValueError(f'{code} has neither a parseable source page nor archived actions')
        if (candidate.get('sourceUrl') != f'https://fundf10.eastmoney.com/fhsp_{code}.html'
                or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(candidate.get('observedAt')))
                or not re.fullmatch(r'[0-9a-f]{64}', str(candidate.get('sourceSha256')))
                or not isinstance(candidate.get('dividends'), dict)
                or not isinstance(candidate.get('splits'), dict)):
            raise ValueError(f'{code} has malformed action evidence')
        result[code] = candidate
    return {'schemaVersion': 1, 'funds': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='write data/fund-actions.json')
    args = parser.parse_args()
    report = build_archive()
    if args.apply:
        path = Path(update.ACTION_ARCHIVE)
        temporary = path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(path)
    print(f"Fund action evidence: {len(report['funds'])} records; "
          + ('archive updated' if args.apply else 'preview only'))


if __name__ == '__main__':
    main()
