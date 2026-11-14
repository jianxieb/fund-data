"""Issuer index valuations with a source document for every observation.

The archive is shared by the normal refresh and offline migration. Selection
never estimates a daily value, moves an as-of date, or joins different providers.
"""
import hashlib
import json
from datetime import date
from pathlib import Path

from scripts.collect_portfolio_benchmark_pe import ALL_NAMES, BASE, checked

ARCHIVE = Path(__file__).resolve().parent / 'data/market-history-pe.json'
SYMBOLS = {'spx': 'SSO', 'ndx': 'TQQQ'}
BASIS = 'issuer_trailing_pe'
VINTAGE = 'latest_verified_publication'


def encode(publications):
    return json.dumps({'schemaVersion': 1, 'observations': publications},
                      ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def read_archive(market_id, path=None):
    payload = json.loads((path or ARCHIVE).read_bytes())
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('observations'), list):
        raise ValueError('Unsupported issuer valuation archive')
    publications = [checked(row) for row in payload['observations'] if row.get('symbol') == SYMBOLS[market_id]]
    if not publications:
        raise ValueError(market_id + ': issuer index publications missing')
    return encode(publications), max(row['knownBy'] for row in publications)


def publication_versions(publications, asof):
    versions = {}
    for row in publications:
        if row['asOf'] > asof:
            continue
        observed = date.fromisoformat(row['asOf'])
        quarter = observed.year, (observed.month - 1) // 3
        versions[quarter] = max(versions.get(quarter, ('', '')), (row['asOf'], row['knownBy']))
    return versions


def parse(raw, market_id, asof):
    payload = json.loads(raw)
    if payload.get('schemaVersion') != 1 or not isinstance(payload.get('observations'), list):
        raise ValueError('Unsupported issuer valuation evidence')
    rows = payload['observations']
    if not rows:
        raise ValueError('Empty issuer valuation evidence')
    quarters = {}
    for row in rows:
        checked(row)
        if row['symbol'] != SYMBOLS[market_id] or row['indexName'] != ALL_NAMES[SYMBOLS[market_id]]:
            raise ValueError('Wrong issuer index identity')
        if row['asOf'] > asof:
            continue
        observed = date.fromisoformat(row['asOf'])
        quarter = observed.year, (observed.month - 1) // 3
        version = row['asOf'], row['knownBy']
        prior = quarters.get(quarter)
        if prior is None or version > (prior['asOf'], prior['knownBy']):
            quarters[quarter] = row
        elif version == (prior['asOf'], prior['knownBy']) and (
                row['indexPE'] != prior['indexPE'] or bool(row.get('qualityNote')) != bool(prior.get('qualityNote'))):
            raise ValueError('Conflicting issuer publication versions')
    # Select the edition before considering its quality. An unverified newer
    # edition must not resurrect an older, apparently acceptable quarter.
    selected = [quarters[q] for q in sorted(quarters)]
    valid = [row for row in selected if not row.get('qualityNote') and row['indexPE'] > 0]
    points = [[row['asOf'], row['indexPE']] for row in valid]
    if not points:
        raise ValueError('No usable issuer index observations')
    return rows, points, [row for row in selected if row not in valid]


def metric(raw, market_id, asof):
    publications, points, excluded = parse(raw, market_id, asof)
    return dict(id='pe', label='指数 PE · TTM', english='ISSUER INDEX P/E · TRAILING 12M',
        unit='倍', category='valuation', frequency='quarterly', points=points,
        source='proshares-' + market_id, evidence='provider', valuationBasis=BASIS, vintage=VINTAGE,
        basis='ProShares 指数资料披露的滚动市盈率，分母为最近12个月成分股盈利。取 SSO/TQQQ 的基准指数栏，非杠杆基金自身估值。每个自然季度最多保留一个实际披露日期的观测；保留原日期与原值，不补成日频。',
        limitations='采用已取得资料的最新版本，不能还原历史当时已知信息。历史资料有缺季，分位只统计实际披露季度。发行人盈利调整口径与其他供应商可能不同，不能直接拼接或比较高低；部分同日值与 Nasdaq 后续研究版本有差异，见数据方法记录。',
        methodologyUrl='https://www.proshares.com/glossary',
        sourceRange=[points[0][0], points[-1][0]], publications=publications,
        excludedPublicationDates=[row['asOf'] for row in excluded])


def validate_metric(value, source, market_id, asof):
    if (value.get('valuationBasis') != BASIS or value.get('vintage') != VINTAGE
            or value.get('frequency') != 'quarterly' or not value.get('limitations')):
        raise ValueError('Issuer PE methodology or revision boundary missing')
    raw = encode(value.get('publications', []))
    _, points, excluded = parse(raw, market_id, asof)
    if value['points'] != points:
        raise ValueError('PE observations do not match their issuer publications')
    if value.get('excludedPublicationDates') != [row['asOf'] for row in excluded]:
        raise ValueError('PE excluded publications do not match source evidence')
    if source.get('sha256') != hashlib.sha256(raw).hexdigest():
        raise ValueError('PE publication evidence SHA-256 mismatch')
    if source.get('url') != BASE + SYMBOLS[market_id].lower():
        raise ValueError('Wrong issuer index source URL')
