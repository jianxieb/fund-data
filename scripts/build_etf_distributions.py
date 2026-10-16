#!/usr/bin/env python3
"""Publish observed ETF cash events, independently of adjusted price returns.

Run after build_portfolio_data.py, which refreshes the raw Yahoo dividend cache.
No ex-date is relabelled as a payable date, and no tax classification is inferred
from a fund name, distribution frequency, or adjusted-price change.
"""
import argparse
import hashlib
import json
import math
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text

OUTPUT = ROOT / 'data/etf-distributions.js'
PREFIX = 'window.ETF_DISTRIBUTIONS='
BASIS = 'provider_cash_events_split_adjusted'


def read_js(path):
    return json.loads(path.read_text().split('=', 1)[1].strip().rstrip(';'))


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def parse_chart(payload, symbol, first, through, digest):
    nodes = payload.get('chart', {}).get('result') or []
    if len(nodes) != 1:
        raise ValueError('缺唯一证券的现金分配行情')
    node = nodes[0]
    meta = node.get('meta', {})
    if meta.get('symbol') != symbol or meta.get('currency') != 'USD':
        raise ValueError('现金分配证券身份或币种不符')
    zone = ZoneInfo(meta['exchangeTimezoneName'])
    local_day = lambda t: datetime.fromtimestamp(t, zone).date().isoformat()
    stamps = node.get('timestamp') or []
    closes = (node.get('indicators', {}).get('quote') or [{}])[0].get('close') or []
    if not stamps or len(stamps) != len(closes):
        raise ValueError('缺完整行情覆盖日期')
    days = {local_day(t) for t, p in zip(stamps, closes) if finite(p) and p > 0}
    if first not in days or through not in days:
        raise ValueError('现金分配来源未覆盖 ' + first + ' 至 ' + through)
    events = node.get('events') or {}
    # Later splits can change earlier vendor cash amounts; disclose every split
    # in the retrieved source, including any later than the display cut-off.
    splits = []
    for event in events.get('splits', {}).values():
        numerator, denominator = event.get('numerator'), event.get('denominator')
        if not finite(numerator) or not finite(denominator) or min(numerator, denominator) <= 0:
            raise ValueError('无效的拆分比例')
        splits.append({'date': local_day(event['date']), 'ratio': str(numerator) + ':' + str(denominator)})
    splits.sort(key=lambda r: r['date'])
    records = []
    seen = set()
    for event in events.get('dividends', {}).values():
        day, amount = local_day(event['date']), event.get('amount')
        if not first <= day <= through:
            continue
        if not finite(amount) or amount < 0:
            raise ValueError('无效的现金分配金额：' + day)
        if day not in days or day in seen:
            raise ValueError('除息日期缺行情或重复：' + day)
        seen.add(day)
        if amount == 0:
            continue
        records.append({'exDate': day, 'perShare': amount,
                        'subsequentSplit': any(s['date'] > day for s in splits)})
    records.sort(key=lambda r: r['exDate'], reverse=True)
    return {'status': 'recorded' if records else 'no_events', 'currency': 'USD',
            'first': first, 'through': through, 'amountBasis': BASIS,
            'sourceUrl': f'https://finance.yahoo.com/quote/{symbol}/history/?filter=div',
            'sourceSha256': digest, 'records': records, 'splits': splits}


def validate(data, products, assets):
    expected = {p['symbol'] for p in products}
    if data.get('schemaVersion') != 1 or set(data.get('products', {})) != expected:
        raise ValueError('ETF分配目录未完整覆盖产品目录')
    for symbol, item in data['products'].items():
        asset = assets['us:' + symbol]
        date.fromisoformat(item['first'])
        date.fromisoformat(item['through'])
        if not item['first'] <= item['through'] <= asset['asOf']:
            raise ValueError(symbol + ' 分配覆盖日期错误')
        if item['status'] not in {'recorded', 'no_events', 'stale'}:
            raise ValueError(symbol + ' 分配状态错误')
        if item['through'] < asset['asOf'] and item['status'] != 'stale':
            raise ValueError(symbol + ' 缺少分配过期标识')
        if item['amountBasis'] != BASIS or item['currency'] != 'USD':
            raise ValueError(symbol + ' 分配口径错误')
        if len(item.get('sourceSha256', '')) != 64:
            raise ValueError(symbol + ' 缺原始来源校验值')
        rows = item['records']
        dates = [r['exDate'] for r in rows]
        if dates != sorted(set(dates), reverse=True):
            raise ValueError(symbol + ' 除息记录未去重排序')
        if item['status'] == 'recorded' and not rows:
            raise ValueError(symbol + ' 无现金记录却标注有分配')
        for row in rows:
            date.fromisoformat(row['exDate'])
            if not item['first'] <= row['exDate'] <= item['through'] or not finite(row['perShare']) or row['perShare'] <= 0:
                raise ValueError(symbol + ' 现金分配记录错误')
            if row.get('subsequentSplit') != any(s['date'] > row['exDate'] for s in item['splits']):
                raise ValueError(symbol + ' 拆分口径标识错误')
            if 'payableDate' in row:
                raise ValueError(symbol + ' 行情源不提供支付日，不得补造')


def build(products, assets, previous, cache_dir):
    output = {}
    for product in products:
        symbol = product['symbol']
        asset = assets['us:' + symbol]
        try:
            raw = (cache_dir / (symbol + '.json')).read_bytes()
            output[symbol] = parse_chart(json.loads(raw), symbol, asset['first'], asset['asOf'], hashlib.sha256(raw).hexdigest())
        except (OSError, ValueError, KeyError) as exc:
            old = previous.get('products', {}).get(symbol)
            if not old:
                raise ValueError(symbol + ' 无可发布现金记录：' + str(exc)) from exc
            output[symbol] = {**old}
            if old['through'] < asset['asOf']:
                output[symbol].update(status='stale', missingEvidence='缺 ' + old['through'] + ' 之后的现金分配记录')
        output[symbol].update(frequency=product['distribution'], issuerUrl=product['sourceUrl'])
    return {'schemaVersion': 1, 'products': output}


def qii_evidence():
    source = json.loads((ROOT / 'docs/evidence/etf-distributions/ishares-qii-2025.json').read_text())
    products = {}
    for symbol, rows in source['products'].items():
        positive = [r for r in rows if r['qiiPerShare'] > 0]
        # A zero-dollar row does not disprove a 100% designation for payments.
        if not positive or any(r['qiiPercent'] != 100 for r in positive):
            raise ValueError(symbol + ' QII证据不满足当前展示口径')
        products[symbol] = {'positivePayments': len(positive), 'qiiPercent': 100,
                            'lastPayment': positive[-1], 'pages': sorted({r['page'] for r in rows})}
    return {'taxYear': source['taxYear'], 'checkedAt': source['checkedAt'],
            'sourceUrl': source['sourceUrl'], 'sourceSha256': source['sourceSha256'], 'products': products}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate published data without private caches or network')
    args = parser.parse_args()
    products = json.loads((ROOT / 'data/overseas-etf-catalog.json').read_text())['products']
    assets = {a['id']: a for a in read_js(ROOT / 'data/portfolio/catalog.js')['assets']}
    previous = read_js(OUTPUT) if OUTPUT.exists() else {}
    data = previous if args.check else build(products, assets, previous, ROOT / '.tmp-portfolio/dividends')
    if not args.check:
        data['qiiEvidence'] = qii_evidence()
    if data.get('qiiEvidence') != qii_evidence():
        raise ValueError('QII展示与正式年度证据不一致')
    validate(data, products, assets)
    if not args.check:
        atomic_text(OUTPUT, PREFIX + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('ETF cash distributions: ' + str(len(data['products'])) + ' products validated; ' +
          str(sum(len(p['records']) for p in data['products'].values())) + ' observed cash events.')


if __name__ == '__main__':
    main()
