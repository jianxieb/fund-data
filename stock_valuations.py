"""PE-TTM percentiles from dated daily observations, with explicit source coverage."""
import json
import math
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

LEGACY = Path(__file__).resolve().parent / 'data/stock-pe-legacy.json'
CUTOVER = '2018-01-01'


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=1)
def legacy_archive():
    return json.loads(LEGACY.read_text(encoding='utf-8'))['stocks'] if LEGACY.exists() else {}


def percentile_evidence(code, quotes, current, asof, legacy=None):
    """Never extend a window with today's earnings or count duplicate trading dates."""
    record = (legacy_archive() if legacy is None else legacy).get(code, {})
    modern = {}
    symbol = code + ('.SH' if code[0] in '5689' else '.SZ')
    for row in quotes:
        if row.get('SECUCODE') != symbol or str(row.get('SECURITY_CODE')) != code:
            raise ValueError('历史估值标的身份不符：' + code)
        day = str(row.get('TRADE_DATE') or '')[:10]
        date.fromisoformat(day)
        if day > asof:
            continue
        pe = number(row.get('PE_TTM'))
        if day in modern and modern[day] != pe:
            raise ValueError('同一交易日存在冲突PE：' + code + ' ' + day)
        modern[day] = pe
    history = {}
    checked = record.get('crossCheck', {}).get('status') == 'accepted'
    if checked:
        for day, pe in record.get('rows', []):
            date.fromisoformat(day)
            if day < CUTOVER and day <= asof:
                history[day] = number(pe)
    history.update(modern)
    ordered = sorted(history)
    result = {}
    end = date.fromisoformat(asof)
    for years in (5, 10):
        try:
            start = end.replace(year=end.year - years)
        except ValueError:
            start = end.replace(year=end.year - years, day=28)
        window = [(d, history[d]) for d in ordered if start.isoformat() <= d <= asof]
        positives = [v for _, v in window if v is not None and v > 0]
        anchors = [d for d in ordered if (start - timedelta(days=14)).isoformat() <= d <= start.isoformat()]
        coverage = ([(anchors[-1], history[anchors[-1]])] if anchors else []) + window
        gaps = [(a[0], b[0]) for a, b in zip(coverage, coverage[1:]) if (date.fromisoformat(b[0]) - date.fromisoformat(a[0])).days > 45]
        item = {'value': None, 'start': start.isoformat(), 'end': asof,
                'observedStart': window[0][0] if window else None,
                'observedEnd': window[-1][0] if window else None,
                'samples': len(positives), 'observations': len(window),
                'excluded': len(window) - len(positives),
                'gaps': gaps,
                'method': 'positive_pe_ttm_midrank',
                'legacySource': record.get('sourceUrl') if checked and start.isoformat() < CUTOVER else None}
        if number(current) is None:
            item.update(status='missing_current', reason='缺当期PE')
        elif current <= 0:
            item.update(status='loss', reason='亏损期PE不适用')
        elif not ordered or ordered[-1] != asof:
            item.update(status='stale_history', reason='缺估值日历史记录')
        elif not anchors:
            conflict = start.isoformat() < CUTOVER and record.get('crossCheck', {}).get('status') == 'conflict'
            item.update(status='source_conflict' if conflict else 'short_history',
                        reason='早期估值来源有差异' if conflict else '历史不足%d年' % years)
        elif len(window) < 180 * years or not positives:
            item.update(status='insufficient_samples', reason='有效历史样本不足')
        elif gaps:
            item.update(status='history_gaps', reason='历史记录有长缺口')
        else:
            # Compare like precision: the supplemental historical source has two decimals.
            rounded = [round(v, 2) for v in positives]
            value = round(current, 2)
            rank = (sum(v < value for v in rounded) + sum(v == value for v in rounded) / 2) / len(rounded)
            item.update(status='available', value=round(rank * 100, 2))
        result[str(years)] = item
    return result
