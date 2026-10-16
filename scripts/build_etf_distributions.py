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
from datetime import date, datetime, timedelta
from bisect import bisect_right
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text

OUTPUT = ROOT / 'data/etf-distributions.js'
PREFIX = 'window.ETF_DISTRIBUTIONS='
BASIS = 'provider_cash_events_split_adjusted'
METRIC_BASIS = 'split_adjusted_close_and_cash_no_reinvestment'


def read_js(path):
    return json.loads(path.read_text().split('=', 1)[1].strip().rstrip(';'))


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def prior_close(prices, target):
    days = sorted(prices)
    index = bisect_right(days, target) - 1
    if index < 0:
        return None
    day = days[index]
    if (date.fromisoformat(target) - date.fromisoformat(day)).days > 7:
        return None
    return day


def cash_window(prices, records, start_target, end_target, allow_partial=False):
    """An unchanged holding, cash retained: price gain + cash / opening capital.

    All source prices and cash use the same split-adjusted share unit. End/start
    prices are ordinary closes, NOT dividend-adjusted closes; adding dividends
    to a total-return series would count those dividends twice.
    """
    start = prior_close(prices, start_target)
    partial = False
    if start is None and allow_partial:
        candidates = [d for d in prices if start_target < d <= end_target]
        start = min(candidates) if candidates else None
        partial = bool(start)
    end = prior_close(prices, end_target)
    if start is None or end is None or start >= end:
        return {'status': 'missing', 'reason': '缺 ' + start_target + ' 至 ' + end_target + ' 的完整首末收盘价'}
    selected = [r for r in records if start < r['exDate'] <= end]
    cash = math.fsum(r['perShare'] for r in selected)
    opening, closing = prices[start], prices[end]
    price_return = (closing / opening - 1) * 100
    cash_return = cash / opening * 100
    total_return = price_return + cash_return
    share = cash_return / total_return * 100 if total_return > 0.01 else None
    return {'status': 'available', 'start': start, 'end': end, 'partialStart': partial,
            'openingPrice': opening, 'closingPrice': closing, 'cashPerShare': cash,
            'payments': len(selected), 'priceReturn': price_return, 'cashReturn': cash_return,
            'totalReturn': total_return, 'cashShareOfGain': share,
            'shareReason': None if share is not None else '亏损期' if total_return < 0 else '净收益接近零'}


def distribution_metrics(prices, records, first, through):
    end = date.fromisoformat(through)
    try:
        anniversary = end.replace(year=end.year - 1).isoformat()
    except ValueError:
        anniversary = end.replace(year=end.year - 1, day=28).isoformat()
    full_year = first <= anniversary
    trailing_records = [r for r in records if anniversary < r['exDate'] <= through]
    cash = math.fsum(r['perShare'] for r in trailing_records) if full_year else None
    trailing = {'startExclusive': anniversary, 'end': through, 'cashPerShare': cash,
                'price': prices[through], 'payments': len(trailing_records),
                'rate': cash / prices[through] * 100 if cash is not None else None,
                'reason': None if full_year else '缺满12个月的现金记录',
                'return': cash_window(prices, records, anniversary, through)}
    annual = []
    for year in range(end.year, int(first[:4]) - 1, -1):
        target_end = min(f'{year}-12-31', through)
        row = cash_window(prices, records, f'{year - 1}-12-31', target_end, allow_partial=True)
        row.update(year=year, yearToDate=year == end.year and target_end < f'{year}-12-31')
        annual.append(row)
    return {'basis': METRIC_BASIS, 'trailing': trailing, 'annual': annual}


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
    prices = {local_day(t): p for t, p in zip(stamps, closes) if finite(p) and p > 0 and first <= local_day(t) <= through}
    if first not in prices or through not in prices:
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
        if day not in prices or day in seen:
            raise ValueError('除息日期缺行情或重复：' + day)
        seen.add(day)
        if amount == 0:
            continue
        previous = prior_close(prices, (date.fromisoformat(day) - timedelta(days=1)).isoformat())
        records.append({'exDate': day, 'perShare': amount,
                        'referenceDate': previous, 'referencePrice': prices[previous] if previous else None,
                        'pricePercent': amount / prices[previous] * 100 if previous else None,
                        'subsequentSplit': any(s['date'] > day for s in splits)})
    records.sort(key=lambda r: r['exDate'], reverse=True)
    return {'status': 'recorded' if records else 'no_events', 'currency': 'USD',
            'first': first, 'through': through, 'amountBasis': BASIS,
            'sourceUrl': f'https://finance.yahoo.com/quote/{symbol}/history/?filter=div',
            'sourceSha256': digest, 'records': records, 'splits': splits,
            'metrics': distribution_metrics(prices, records, first, through)}


def validate_metrics(item):
    metrics = item.get('metrics')
    if not metrics:
        if not item.get('metricsMissingEvidence'):
            raise ValueError('缺分配率的价格证据与缺口标识')
        return
    if metrics.get('basis') != METRIC_BASIS:
        raise ValueError('分配回报必须使用未复权股息的收盘价')
    trailing = metrics['trailing']
    if trailing['end'] != item['through'] or not finite(trailing['price']) or trailing['price'] <= 0:
        raise ValueError('分配率的价格日期或金额错误')
    if trailing['rate'] is not None:
        cash = math.fsum(r['perShare'] for r in item['records'] if trailing['startExclusive'] < r['exDate'] <= trailing['end'])
        if not math.isclose(cash, trailing['cashPerShare'], abs_tol=1e-9) or not math.isclose(cash / trailing['price'] * 100, trailing['rate'], abs_tol=1e-9):
            raise ValueError('近12月分配率与现金记录不符')
    for row in [trailing['return'], *metrics['annual']]:
        if row['status'] == 'missing':
            if not row.get('reason'):
                raise ValueError('缺区间首末价却未说明原因')
            continue
        if not item['first'] <= row['start'] < row['end'] <= item['through']:
            raise ValueError('分红收益区间不符')
        if any(not finite(row.get(key)) or row[key] <= 0 for key in ['openingPrice', 'closingPrice']):
            raise ValueError('收益拆分首末价格无效')
        cash = math.fsum(r['perShare'] for r in item['records'] if row['start'] < r['exDate'] <= row['end'])
        checks = {
            'cashPerShare': cash, 'cashReturn': cash / row['openingPrice'] * 100,
            'priceReturn': (row['closingPrice'] / row['openingPrice'] - 1) * 100,
            'totalReturn': row['priceReturn'] + row['cashReturn']}
        if any(not finite(row[k]) or not math.isclose(row[k], value, abs_tol=1e-9) for k, value in checks.items()):
            raise ValueError('价格与现金回报未正确对账')
        expected_share = row['cashReturn'] / row['totalReturn'] * 100 if row['totalReturn'] > 0.01 else None
        if expected_share is None:
            if row['cashShareOfGain'] is not None:
                raise ValueError('亏损或近零收益不得生成分配占收益比')
        elif not finite(row['cashShareOfGain']) or not math.isclose(expected_share, row['cashShareOfGain'], abs_tol=1e-9):
            raise ValueError('现金占净收益比例错误')


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
            if row.get('pricePercent') is not None:
                if not row['referenceDate'] < row['exDate'] or not finite(row['referencePrice']) or row['referencePrice'] <= 0:
                    raise ValueError(symbol + ' 单次分配参考价格错误')
                if not math.isclose(row['pricePercent'], row['perShare'] / row['referencePrice'] * 100, abs_tol=1e-9):
                    raise ValueError(symbol + ' 单次分配率错误')
        validate_metrics(item)


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
            if not old.get('metrics'):
                output[symbol]['metricsMissingEvidence'] = '缺普通收盘价记录，无法计算分配率和收益贡献'
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
