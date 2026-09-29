#!/usr/bin/env python3
"""Archive pre-2018 PE observations; never import the supplement's recent quotes."""
import argparse
import hashlib
import json
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from stock_fundamentals import source_url
from stock_screen import STOCK_UNIVERSE, fetch_json


def archive_record(code, supplement, modern, observed):
    dates, pes = supplement['date'], supplement['pe_ttm']
    if len(dates) != len(pes):
        raise ValueError('历史日期和PE长度不一致：' + code)
    daily = {}
    for day, pe in zip(dates, pes):
        if day in daily and daily[day] != pe:
            raise ValueError('历史同日PE冲突：' + code + ' ' + day)
        daily[day] = pe
    # A substantial same-date overlap is mandatory before joining sources.
    errors = []
    for r in modern:
        day = r['TRADE_DATE'][:10]
        old, new = daily.get(day), r.get('PE_TTM')
        if '2018-01-01' <= day <= '2019-12-31' and old is not None and new is not None and old > 0 and new > 0:
            errors.append(abs(old / new - 1) * 100)
    median = statistics.median(errors) if errors else None
    p90 = sorted(errors)[min(len(errors) - 1, int(len(errors) * .9))] if errors else None
    accepted = len(errors) >= 100 and median <= .5 and p90 <= 5
    early = [[d, pe] for d, pe in sorted(daily.items()) if '2016-01-01' <= d < '2018-01-01']
    symbol = ('sh' if code[0] in '5689' else 'sz') + code
    digest = hashlib.sha256(json.dumps(supplement, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'code': code, 'sourceUrl': 'https://eniu.com/chart/pea/' + symbol + '/t/all',
            'fetchedAt': observed, 'sourceSha256': digest,
            'firstSourceDate': min(daily) if daily else None,
            'crossCheck': {'status': 'accepted' if accepted else 'conflict' if early else 'no_early_history',
                           'start': '2018-01-01', 'end': '2019-12-31', 'samples': len(errors),
                           'medianErrorPercent': round(median, 4) if median is not None else None,
                           'p90ErrorPercent': round(p90, 4) if p90 is not None else None},
            'rows': early if accepted else []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cached', action='store_true', help='Only read the local source archive')
    args = parser.parse_args()
    cache = ROOT / '.tmp-snap/stocks/valuation-history'
    cache.mkdir(parents=True, exist_ok=True)
    observed = datetime.now(timezone.utc).isoformat()
    records = {}
    for item in STOCK_UNIVERSE:
        code = item['code']
        symbol = ('sh' if code[0] in '5689' else 'sz') + code
        sources = {}
        for name, url in [('eastmoney', source_url(code, 'RPT_VALUEANALYSIS_DET', 'TRADE_DATE', 10000)),
                          ('eniu', 'https://eniu.com/chart/pea/' + symbol + '/t/all')]:
            path = cache / (code + '-' + name + '.json')
            if not args.cached:
                path.write_text(json.dumps(fetch_json(url)), encoding='utf-8')
            sources[name] = json.loads(path.read_text(encoding='utf-8'))
        records[code] = archive_record(code, sources['eniu'], sources['eastmoney']['result']['data'], observed)
    output = {'schemaVersion': 1, 'cutover': '2018-01-01', 'stocks': records}
    (ROOT / 'data/stock-pe-legacy.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print('Archived %d supplemental histories; %d accepted by overlap checks.' % (
        len(records), sum(r['crossCheck']['status'] == 'accepted' for r in records.values())))


if __name__ == '__main__':
    main()
