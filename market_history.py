#!/usr/bin/env python3
"""Reproducible index-level observations for the historical-position report.

No ETF substitutions, interpolated missing observations or cross-provider joins.
Sources are independently timestamped; a failed source retains its old dates.
"""
from __future__ import annotations

import argparse
import calendar
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
import io
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'data/market-history.json'
CACHE = ROOT / '.tmp-snap/market-history'
START = '2004-01-01'  # Warm-up before the 20-year observation window.
PUBLICATION_POLICY = 'research-evidence-v2'
CORE_METRICS = {
    'spx': ('pe', 'vix', 'rv21', 'drawdown', 'mdd252', 'ma200', 'momentum'),
    'ndx': ('pe', 'vxn', 'rv21', 'drawdown', 'mdd252', 'ma200', 'momentum'),
    'macro': ('yield10y', 'real10y', 'curve10_2', 'nfci'),
}
WITHHELD = {
    'spx': [
        dict(label='20年PE、CAPE、PB、PS、股息率', reason='已接入韭圈整体法TTM PE，公开历史始于2016-10；此前同口径PE及其他估值序列仍缺。'),
        dict(label='预期PE', reason='原始终端供应商未披露；现有观测停留在2026-08-05，与滚动PE日期和盈利口径不一致。'),
        dict(label='净利率、ROE、ROIC、盈利与营收增长', reason='现有净利率为重建估算；其余数据缺完整指数聚合方法或及时、同口径历史。'),
    ],
    'ndx': [
        dict(label='20年PE、PB、PS、股息率', reason='已接入韭圈整体法TTM PE，公开历史始于2016-10；此前同口径PE及其他估值序列仍缺。'),
        dict(label='预期PE', reason='原始终端供应商未披露；现有观测停留在2026-08-05，未核实与滚动PE一致的日期和盈利口径。'),
        dict(label='净利率、ROE、ROIC、盈利与营收增长', reason='缺已核验的指数级财报期、完整聚合方法和同口径历史。'),
    ],
    'macro': [],
}


def evidence_kind(market_id, metric):
    """Only explicitly reviewed source/metric pairs may enter the report."""
    key, source = metric['id'], metric['source']
    if key not in CORE_METRICS.get(market_id, ()):
        raise ValueError(key + ': outside core publication scope')
    if market_id in ('spx', 'ndx'):
        if key == 'pe' and source == 'jiucai-' + market_id:
            return 'provider'
        vol = 'vix' if market_id == 'spx' else 'vxn'
        if key == vol and source == vol:
            return 'published'
        if key in ('rv21', 'drawdown', 'mdd252', 'ma200', 'momentum') and source == 'yahoo-' + market_id:
            return 'calculated'
    elif market_id == 'macro':
        if key == 'nfci' and source == 'nfci':
            return 'published'
        if key in ('yield10y', 'curve10_2') and source.startswith('treasury-nominal-'):
            return 'calculated' if key == 'curve10_2' else 'published'
        if key == 'real10y' and source.startswith('treasury-real-'):
            return 'published'
    raise ValueError(key + ': unreviewed source identity')


def curate_report(data):
    """Remove withdrawn series from the artifact, not merely from the screen."""
    used = set()
    for section in data['markets'] + [data['context']]:
        order = CORE_METRICS[section['id']]
        section['metrics'] = sorted((m for m in section['metrics'] if m['id'] in order), key=lambda m: order.index(m['id']))
        section['snapshots'] = []
        section['withheld'] = WITHHELD[section['id']]
        section.pop('gaps', None)
        for m in section['metrics']:
            m['evidence'] = evidence_kind(section['id'], m)
            used.update([m['source'], *m.get('dependencies', [])])
        if section.get('close'):
            used.add(section['close']['source'])
    for check in data.get('crossChecks', []):
        used.update(check['sources'])
    data['sources'] = {key: source for key, source in data['sources'].items() if key in used}
    data['refreshFailures'] = {key: error for key, error in data.get('refreshFailures', {}).items() if key in used}
    data['publicationPolicy'] = PUBLICATION_POLICY
    return data


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_data(self, value):
        if self.cell is not None:
            self.cell.append(value)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row, self.cell = None, None


def rows_of(raw):
    parser = Tables()
    parser.feed(raw.decode('utf-8'))
    return parser.rows


def number(value):
    value = value.replace('−', '-')
    match = re.fullmatch(r'[^\d+\-]*([+\-]?[\d,]+(?:\.\d+)?)[%\s]*', value.strip())
    if not match:
        return None
    result = float(match[1].replace(',', ''))
    return result if math.isfinite(result) else None


def normalize(points, asof):
    result = {}
    for day, value in points:
        date.fromisoformat(day)
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        if day > asof or day < START:
            continue
        if day in result and abs(result[day] - value) > 1e-8:
            raise ValueError('Conflicting observations on ' + day)
        result[day] = round(value, 6)
    return [[day, value] for day, value in sorted(result.items())]


def multpl(raw, asof):
    points, estimates = [], []
    for row in rows_of(raw):
        if len(row) != 2:
            continue
        try:
            day = datetime.strptime(row[0], '%b %d, %Y').date().isoformat()
        except ValueError:
            continue
        value = number(row[1])
        if value is not None:
            points.append([day, value])
            if '†' in row[1] and day <= asof:
                estimates.append(day)
    return normalize(points, asof), estimates


def yahoo(raw, symbol, asof):
    payload = json.loads(raw)['chart']['result'][0]
    if payload['meta']['symbol'] != symbol:
        raise ValueError('Wrong index identity')
    closes = payload['indicators']['quote'][0]['close']
    zone = ZoneInfo(payload['meta'].get('exchangeTimezoneName', 'America/New_York'))
    points = [[datetime.fromtimestamp(ts, zone).date().isoformat(), close]
              for ts, close in zip(payload['timestamp'], closes) if close is not None and close > 0]
    return normalize(points, asof)


def cboe(raw, asof, column='CLOSE'):
    return normalize([[datetime.strptime(r['DATE'], '%m/%d/%Y').date().isoformat(), float(r[column])]
                      for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))], asof)


def valid_valuation_number(value):
    return not isinstance(value, bool) and isinstance(value, (float, int)) and math.isfinite(value) and value > 0


def valuation_history(raw, market_id, asof):
    """Read the publisher's aggregate TTM series, never relabel it index-weighted PE."""
    payload = json.loads(raw)
    if payload.get('code') != market_id.upper() + '.GI' or payload.get('metric') != 'pe':
        raise ValueError('Wrong valuation identity or earnings basis')
    rows = payload['series']
    if not rows:
        raise ValueError('Empty valuation history')
    points = []
    for row in rows:
        value = row['value']
        if not valid_valuation_number(value):
            raise ValueError('Invalid valuation observation')
        date.fromisoformat(row['date'])
        if points and row['date'] <= points[-1][0]:
            raise ValueError('Unsorted or duplicate valuation dates')
        points.append([row['date'], value])
    if not valid_valuation_number(payload.get('latest')) or abs(payload['latest'] - points[-1][1]) > 1e-6:
        raise ValueError('Valuation latest/history mismatch')
    return normalize(points, asof)


def valuation_metric(raw, detail_raw, market_id, asof):
    points = valuation_history(raw, market_id, asof)
    detail = json.loads(detail_raw)
    expected_name = '标普500' if market_id == 'spx' else '纳斯达克100'
    header = detail['header']
    if header.get('code') != market_id.upper() + '.GI' or header.get('name') != expected_name or header.get('metric') != 'pe':
        raise ValueError('Wrong valuation detail identity')
    if not points or not valid_valuation_number(header.get('value')) or detail['update_time'] != points[-1][0] or abs(header['value'] - points[-1][1]) > .015:
        raise ValueError('Valuation detail/history date or value mismatch')
    return metric('pe', '整体法 PE · TTM', 'AGGREGATE P/E · TRAILING 12M', '倍', 'valuation', 'daily',
        points, 'jiucai-' + market_id,
        '韭圈发布口径：成分股市值之和 / 成分股最近12个月净利润之和。保留供应商发布值，不自行估算或插值；不等同于其他供应商的指数加权PE。公开接口约10年历史。',
        dependencies=['jiucai-' + market_id + '-detail'], valuationBasis='aggregate_ttm', vintage='latest_available',
        sourceRange=[points[0][0], points[-1][0]],
        methodologyUrl='https://www.jiucaishuo.com/indicators?tab=index',
        limitations='未提供逐成分股财报、GAAP调整清单、亏损股处理明细及各时点发布版本；不能据此复原盈利增长或执行当时可交易的回测。',
        publisherCheck=dict(date=points[-1][0], historyValue=points[-1][1], detailValue=header['value']))


def quantile(values, probability):
    values = sorted(values)
    position = (len(values) - 1) * probability
    lo, hi = math.floor(position), math.ceil(position)
    return values[lo] + (values[hi] - values[lo]) * (position - lo)


def same_date(left, right, operation):
    lookup = dict(right)
    return [[day, round(operation(value, lookup[day]), 6)] for day, value in left if day in lookup]


def treasury(raw, asof, column, xml_column=None):
    if raw.lstrip().startswith(b'<?xml'):
        root = ET.fromstring(raw)
        rows = [{child.tag.rsplit('}', 1)[-1]: child.text for child in item}
                for item in root.findall('.//{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}properties')]
        points = [[r['NEW_DATE'][:10], number(r.get(xml_column) or '')] for r in rows]
    else:
        rows = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        points = [[datetime.strptime(r['date'], '%m/%d/%Y').date().isoformat(), number(r[column])] for r in rows]
    return normalize(points, asof)


def nfci(raw, asof, column):
    rows = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    return normalize([[datetime.strptime(r['Friday_of_Week'], '%m/%d/%Y').date().isoformat(), number(r[column])] for r in rows], asof)


def price_metrics(points):
    """Trailing windows use only observations known at each date, never future prices."""
    values = [p[1] for p in points]
    logs = [math.log(values[i] / values[i - 1]) for i in range(1, len(values))]
    output = {key: [] for key in ('rv21', 'rv63', 'rv252', 'downside', 'var95', 'es95', 'mdd252', 'drawdown', 'ma50', 'ma200', 'momentum63', 'momentum')}
    for i, (day, close) in enumerate(points):
        for n in (21, 63, 252):
            if i >= n:
                output['rv' + str(n)].append([day, round(statistics.stdev(logs[i - n:i]) * math.sqrt(252) * 100, 6)])
        if i >= 251:
            output['drawdown'].append([day, round((close / max(values[i - 251:i + 1]) - 1) * 100, 6)])
            peak, worst = values[i - 251], 0
            for value in values[i - 251:i + 1]:
                peak = max(peak, value)
                worst = min(worst, value / peak - 1)
            output['mdd252'].append([day, round(worst * 100, 6)])
        if i >= 49:
            output['ma50'].append([day, round((close / statistics.mean(values[i - 49:i + 1]) - 1) * 100, 6)])
        if i >= 199:
            output['ma200'].append([day, round((close / statistics.mean(values[i - 199:i + 1]) - 1) * 100, 6)])
        if i >= 252:
            output['momentum'].append([day, round((close / values[i - 252] - 1) * 100, 6)])
            returns = [math.expm1(r) for r in logs[i - 252:i]]
            cutoff = quantile(returns, .05)
            output['downside'].append([day, round(math.sqrt(sum(min(r, 0) ** 2 for r in returns) / 252) * math.sqrt(252) * 100, 6)])
            output['var95'].append([day, round(-cutoff * 100, 6)])
            output['es95'].append([day, round(-statistics.mean(r for r in returns if r <= cutoff) * 100, 6)])
        if i >= 63:
            output['momentum63'].append([day, round((close / values[i - 63] - 1) * 100, 6)])
    return output


def source_specs(asof):
    end = datetime.combine(date.fromisoformat(asof) + timedelta(days=1), datetime.min.time(), timezone.utc)
    query = urllib.parse.urlencode({'period1': 1072915200, 'period2': int(end.timestamp()), 'interval': '1d'})
    specs = {
        'vix': ('Cboe · VIX', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'),
        'vxn': ('Cboe · VXN', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv'),
        'finviz-ndx': ('Finviz · index close cross-check', 'https://finviz.com/index/NDX?p=d'),
        'finviz-spx': ('Finviz · index close cross-check', 'https://finviz.com/index/SPX?p=d'),
        'nfci': ('Federal Reserve Bank of Chicago', 'https://api.data.chicagofed.org/NFCI/nfci-data-series-csv.csv'),
    }
    base = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
    for kind in ('nominal', 'real'):
        specs['treasury-' + kind + '-archive'] = ('U.S. Treasury · ' + kind + ' archive', base + 'daily-treasury-rate-archives/par-' + ('real-' if kind == 'real' else '') + 'yield-curve-rates-' + ('2003' if kind == 'real' else '1990') + '-2023.csv')
        for year in range(2024, int(asof[:4]) + 1):
            specs['treasury-' + kind + '-' + str(year)] = ('U.S. Treasury · ' + kind + ' ' + str(year), base + 'pages/xml?data=daily_treasury_' + ('real_' if kind == 'real' else '') + 'yield_curve&field_tdr_date_value=' + str(year))
    for key, symbol in [('yahoo-spx', '^GSPC'), ('yahoo-ndx', '^NDX')]:
        specs[key] = ('Yahoo Finance · ' + symbol, 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(symbol, safe='') + '?' + query)
    for market_id in ('spx', 'ndx'):
        base = 'https://ai2.jiucaishuo.com/api/index-valuation/'
        code = market_id.upper() + '.GI'
        specs['jiucai-' + market_id] = ('韭圈 · ' + code + '整体法TTM PE', base + 'history?code=' + code + '&metric=pe')
        specs['jiucai-' + market_id + '-detail'] = ('韭圈 · ' + code + '同日快照核对', base + 'detail?code=' + code)
    return specs


def metric(key, label, english, unit, category, frequency, points, source, basis, **extra):
    return dict(id=key, label=label, english=english, unit=unit, category=category,
                frequency=frequency, points=points, source=source, basis=basis, **extra)


def build(raw, asof, fetched, source_urls=None):
    markets = [dict(id='spx', name='标普500', english='S&P 500', symbol='SPX', metrics=[], snapshots=[]),
               dict(id='ndx', name='纳斯达克100', english='NASDAQ-100', symbol='NDX', metrics=[], snapshots=[])]
    specs = source_specs(asof)
    sources = {k: dict(name=name, url=(source_urls or {}).get(k, url), fetchedAt=fetched.get(k), status='available' if k in raw else 'missing',
                       sha256=hashlib.sha256(raw[k]).hexdigest() if k in raw else None)
               for k, (name, url) in specs.items()}
    for market in markets:
        pe_source = 'jiucai-' + market['id']
        if pe_source in raw and pe_source + '-detail' in raw:
            market['metrics'].append(valuation_metric(raw[pe_source], raw[pe_source + '-detail'], market['id'], asof))
        source = 'yahoo-' + market['id']
        if source in raw:
            symbol = '^GSPC' if market['id'] == 'spx' else '^NDX'
            prices = yahoo(raw[source], symbol, asof)
            market['close'] = dict(date=prices[-1][0], value=prices[-1][1], source=source, basis='price_index')
            market['prices'] = dict(points=prices, source=source, symbol=symbol, basis='price_index', currency='USD')
            derived = price_metrics(prices)
            for key, label, english, basis in [
                ('rv21', '21日实际波动率', 'REALIZED VOL · 21D', '过去21个交易日对数收益率样本标准差 × √252。由Yahoo Finance的指数收盘序列复算，不预测未来波动。'),
                ('drawdown', '距一年高点', 'DRAWDOWN · 252D', '当前价格 / 过去252个交易日最高收盘价 − 1；越负表示距高点越远。由指数收盘序列复算。'),
                ('mdd252', '一年内最大回撤', 'MAX DRAWDOWN · 252D', '过去252个交易日内，从先前最高收盘到随后最低收盘的最大跌幅；峰值与谷值都在该窗口内。由同一指数收盘序列计算。'),
                ('ma200', '200日均线偏离', 'DISTANCE TO 200D MA', '当前价格 / 过去200个交易日简单平均收盘价 − 1。由指数收盘序列复算。'),
                ('momentum', '近一年涨跌幅', 'PRICE RETURN · 252D', '当前收盘 / 252个交易日前收盘 − 1，累计价格涨跌幅，不含分红、税费。交易日窗口不等同于精确日历年。'),
            ]:
                market['metrics'].append(metric(key, label, english, '%', 'trend' if key in ('ma200', 'momentum') else 'risk',
                    'daily', derived[key], source, basis))
        volkey = 'vix' if market['id'] == 'spx' else 'vxn'
        if volkey in raw:
            market['metrics'].insert(0, metric(volkey, '隐含波动率 ' + volkey.upper(), volkey.upper() + ' · 30D IMPLIED', '点', 'risk', 'daily',
                cboe(raw[volkey], asof), volkey, 'Cboe官方发布的' + ('标普500期权' if volkey == 'vix' else '纳斯达克100期权') + '隐含未来30日年化波动率指数收盘值。它记录期权市场对未来波动的定价，不保证未来实际波动等于该值。'))
    context = dict(id='macro', name='市场环境', english='RATES & FINANCIAL CONDITIONS', symbol='MACRO', metrics=[], snapshots=[])
    nominal_keys = [key for key in specs if key.startswith('treasury-nominal-')]
    real_keys = [key for key in specs if key.startswith('treasury-real-')]
    rates = {}
    for key, label, english, column, xml_column, real in [
        ('yield2y', '2年国债收益率', 'U.S. TREASURY · 2Y', '2 yr', 'BC_2YEAR', False),
        ('yield10y', '10年国债收益率', 'U.S. TREASURY · 10Y', '10 yr', 'BC_10YEAR', False),
        ('real10y', '10年实际国债收益率', 'U.S. TIPS · 10Y', '10 yr', 'TC_10YEAR', True),
    ]:
        keys = real_keys if real else nominal_keys
        if all(part in raw for part in keys):
            points = normalize([p for part in keys for p in treasury(raw[part], asof, column, xml_column)], asof)
            rates[key] = points
            context['metrics'].append(metric(key, label, english, '%', 'macro', 'daily', points, keys[-1],
                '美国财政部发布的' + ('通胀保值国债实际' if real else '国债名义') + '平价收益率。同一官方口径的历史档案与年度文件合并，缺值不补齐。', dependencies=keys))
    if 'yield10y' in rates and 'yield2y' in rates:
        context['metrics'].append(metric('curve10_2', '10年—2年期限利差', 'YIELD CURVE · 10Y − 2Y', '百分点', 'macro', 'daily',
            same_date(rates['yield10y'], rates['yield2y'], lambda a, b: a - b), nominal_keys[-1],
            '同日10年减2年美国财政部名义国债平价收益率。负值表示该段收益率曲线倒挂。仅配对同日观测。', dependencies=nominal_keys))
    if 'nfci' in raw:
        context['metrics'].append(metric('nfci', '金融条件指数 NFCI', 'NFCI', '点', 'macro', 'weekly', nfci(raw['nfci'], asof, 'NFCI'), 'nfci',
            '芝加哥联储综合金融条件指数。正值代表相对历史平均更紧，负值更松。采用官方最新修订历史，不代表各历史时点当时已知的版本。'))
    checks = []
    for market in markets:
        source = 'finviz-' + market['id']
        price_source = 'yahoo-' + market['id']
        if source in raw and price_source in raw:
            fields = {row[0]: row[1] for row in rows_of(raw[source]) if len(row) == 2}
            previous_close = number(fields.get('Prev Close', ''))
            prices = yahoo(raw[price_source], '^GSPC' if market['id'] == 'spx' else '^NDX', asof)
            matches = [p for p in prices[-3:] if previous_close is not None and abs(p[1] - previous_close) < .02]
            checks.append(dict(id=market['id'] + '-close', sources=[source, price_source], status='matched' if matches else 'date_not_aligned',
                               matchedDate=matches[-1][0] if matches else None, observedValue=previous_close))
    return curate_report(dict(schemaVersion=1, asOf=asof, generatedAt=datetime.now(timezone.utc).isoformat(), crossChecks=checks,
                sources=sources, markets=markets, context=context,
                methodology=dict(percentile='midrank', windowYears=20, reference='each_index_own_history',
                                 sampling='原始发布频率；不把季频/月频前向填充成日频',
                                 formula='100 × (小于当前值的样本数 + 0.5 × 等于当前值的样本数) / 有效样本数')))


def check_source(key, raw, asof):
    """Reject block pages / changed schemas before replacing a reusable cache."""
    if key.startswith('jiucai-'):
        market_id = key.split('-')[1]
        if key.endswith('-detail'):
            data = json.loads(raw)
            if data['header']['code'] != market_id.upper() + '.GI' or data['header']['metric'] != 'pe' or not valid_valuation_number(data['header'].get('value')):
                raise ValueError('Wrong valuation detail identity')
            date.fromisoformat(data['update_time'])
            return
        points = valuation_history(raw, market_id, asof)
    elif key.startswith('yahoo-'):
        symbol = {'yahoo-spx': '^GSPC', 'yahoo-ndx': '^NDX', 'yahoo-vxn': '^VXN'}[key]
        points = yahoo(raw, symbol, asof)
    elif key in ('vix', 'vxn', 'vix3m', 'vix9d', 'vvix', 'skew'):
        points = cboe(raw, asof, key.upper() if key in ('vvix', 'skew') else 'CLOSE')
    elif key.startswith('treasury-'):
        points = treasury(raw, asof, '10 yr', 'TC_10YEAR' if 'real' in key else 'BC_10YEAR')
        if not key.endswith('archive') and int(key[-4:]) == int(asof[:4]) and len(points) >= 1:
            return
    elif key == 'nfci':
        points = nfci(raw, asof, 'NFCI')
    elif key.endswith('forward'):
        data = json.loads(raw)
        points = normalize([[p['date'], p['value']] for p in data['forward']], asof)
    elif key.startswith('finviz-'):
        fields = {row[0]: number(row[1]) for row in rows_of(raw) if len(row) == 2}
        if fields.get('Prev Close') is None:
            raise ValueError(key + ': previous index close missing')
        return
    elif key == 'sp-profit':
        points = [row for row in rows_of(raw) if len(row) == 5 and re.fullmatch(r'\d{2}-\d{4}', row[0]) and number(row[-1]) is not None]
    else:
        points, _ = multpl(raw, asof)
    if len(points) < 60:
        raise ValueError(key + ': historical observations missing')


def fetch_source(key, url, asof, offline=False):
    path = CACHE / (key + '.raw')
    if offline:
        return path.read_bytes(), None, None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=25) as response:
            raw = response.read()
        if len(raw) < 100:
            raise ValueError('Empty response')
        check_source(key, raw, asof)
        path.write_bytes(raw)
        stamp = datetime.now(timezone.utc).isoformat()
        path.with_suffix('.meta.json').write_text(json.dumps({'fetchedAt': stamp, 'url': url}))
        return raw, stamp, None
    except (OSError, ValueError, KeyError, TypeError, IndexError, ET.ParseError) as error:
        if path.exists():
            cached = path.read_bytes()
            try:
                check_source(key, cached, asof)
                return cached, None, str(error)
            except (ValueError, KeyError, TypeError, IndexError, ET.ParseError):
                pass
        return None, None, str(error)


def validate(data):
    if data.get('schemaVersion') != 1 or [m['id'] for m in data['markets']] != ['spx', 'ndx']:
        raise ValueError('Invalid report identity')
    if data.get('publicationPolicy') != PUBLICATION_POLICY:
        raise ValueError('Unreviewed publication policy')
    for market in data['markets'] + ([data['context']] if 'context' in data else []):
        if tuple(m['id'] for m in market['metrics']) != CORE_METRICS[market['id']]:
            raise ValueError(market['id'] + ': essential series missing')
        if market['id'] != 'macro' and (not market.get('close') or market['close']['basis'] != 'price_index' or market['close']['date'] > data['asOf']):
            raise ValueError('Wrong index basis or future close')
        if market['id'] != 'macro':
            prices = market.get('prices', {})
            points = prices.get('points', [])
            expected_symbol = '^GSPC' if market['id'] == 'spx' else '^NDX'
            if prices.get('basis') != 'price_index' or prices.get('currency') != 'USD' or prices.get('symbol') != expected_symbol or prices.get('source') != 'yahoo-' + market['id']:
                raise ValueError('Wrong price history identity or basis')
            if len(points) < 252 or points != normalize(points, data['asOf']) or any(v <= 0 for _, v in points):
                raise ValueError('Invalid price history')
            if points[-1] != [market['close']['date'], market['close']['value']]:
                raise ValueError('Price history does not match the displayed close')
        if len({m['id'] for m in market['metrics']}) != len(market['metrics']):
            raise ValueError('Duplicate metric identity')
        for m in market['metrics']:
            if m.get('estimated') or m.get('estimatedDates') or m.get('caution'):
                raise ValueError(m['id'] + ': estimated or unverified series cannot be published')
            if m.get('evidence') != evidence_kind(market['id'], m):
                raise ValueError(m['id'] + ': evidence classification missing')
            if m['id'] == 'pe':
                if m.get('valuationBasis') != 'aggregate_ttm' or m.get('vintage') != 'latest_available' or not m.get('limitations'):
                    raise ValueError('PE methodology or revision boundary missing')
                check = m.get('publisherCheck', {})
                if check.get('date') != m['points'][-1][0] or check.get('historyValue') != m['points'][-1][1] or not valid_valuation_number(check.get('detailValue')) or abs(check['detailValue'] - m['points'][-1][1]) > .015:
                    raise ValueError('PE publisher cross-check missing')
            points = m['points']
            if len(points) < 30 or points != normalize(points, data['asOf']):
                raise ValueError(m['id'] + ': invalid dates or values')
            if m['id'] in ('vix', 'vxn', 'pe', 'forward_pe', 'cape', 'pb', 'ps') and any(v <= 0 for _, v in points):
                raise ValueError(m['id'] + ': must be positive')
            for key in [m['source'], *m.get('dependencies', [])]:
                source = data['sources'].get(key, {})
                if not source.get('fetchedAt') or source.get('status') != 'available':
                    raise ValueError(m['id'] + ': source evidence missing')
                expected_url = source_specs(data['asOf']).get(key, (None, None))[1]
                actual_url = source.get('url')
                matches = actual_url == expected_url
                if key.startswith('yahoo-') and actual_url and expected_url:
                    actual, expected = urllib.parse.urlsplit(actual_url), urllib.parse.urlsplit(expected_url)
                    actual_query, expected_query = dict(urllib.parse.parse_qsl(actual.query)), dict(urllib.parse.parse_qsl(expected.query))
                    actual_end, expected_end = actual_query.pop('period2', ''), expected_query.pop('period2')
                    matches = (actual._replace(query='') == expected._replace(query='') and actual_query == expected_query
                               and actual_end.isdigit() and 1072915200 < int(actual_end) <= int(expected_end))
                if not matches:
                    raise ValueError(m['id'] + ': source URL does not match the reviewed publisher')
        if market.get('snapshots'):
            raise ValueError('Unverified fundamental snapshots cannot be published')
    return data


def retain_unavailable_sources(data, previous, missing):
    """A source outage never silently removes previously published evidence."""
    for key in missing:
        if key not in previous['sources']:
            raise ValueError(key + ': no previous evidence to retain')
        data['sources'][key] = previous['sources'][key]
    checks = {check['id'] for check in data.get('crossChecks', [])}
    data.setdefault('crossChecks', []).extend(check for check in previous.get('crossChecks', [])
        if check['id'] not in checks and set(check['sources']) & missing)
    sections = data['markets'] + ([data['context']] if 'context' in data and 'context' in previous else [])
    old_sections = previous['markets'] + ([previous['context']] if 'context' in data and 'context' in previous else [])
    for market, old in zip(sections, old_sections):
        existing = {m['id'] for m in market['metrics']}
        market['metrics'].extend(m for m in old['metrics'] if m['id'] not in existing and (set(m.get('dependencies', [])) | {m['source']}) & missing)
        market['snapshots'].extend(m for m in old['snapshots'] if m['source'] in missing)
        if market['id'] != 'macro' and not market.get('close'):
            market['close'] = old['close']
            market['prices'] = old.get('prices')
        order = {m['id']: i for i, m in enumerate(old['metrics'])}
        market['metrics'].sort(key=lambda m: order.get(m['id'], 100))
    return data


def reject_regression(data, previous):
    sections = {s['id']: s for s in data['markets'] + [data['context']]}
    for old in previous['markets'] + ([previous['context']] if 'context' in previous else []):
        if old.get('prices'):
            before, after = old['prices']['points'], sections[old['id']].get('prices', {}).get('points', [])
            if not after or after[-1][0] < before[-1][0] or after[0][0] > before[0][0] or len(after) < .99 * len(before):
                raise ValueError(old['id'] + ': price history regressed')
        current = {m['id']: m for m in sections[old['id']]['metrics']}
        for old_metric in old['metrics']:
            new = current.get(old_metric['id'])
            if new is None:
                raise ValueError(old['id'] + '/' + old_metric['id'] + ': historical metric disappeared')
            # A reviewed source change can intentionally use a shorter official series.
            if new['source'] != old_metric['source']:
                continue
            before, after = old_metric['points'], new['points']
            if after[-1][0] < before[-1][0] or after[0][0] > before[0][0] or len(after) < .99 * len(before):
                raise ValueError(old['id'] + '/' + new['id'] + ': historical evidence regressed')


def retain_valuation_prefix(data, previous):
    """The public endpoint rolls ten years; retain older archived observations, with provenance."""
    for market, old in zip(data['markets'], previous['markets']):
        current = next((m for m in market['metrics'] if m['id'] == 'pe'), None)
        prior = next((m for m in old['metrics'] if m['id'] == 'pe' and current and m['source'] == current['source']), None)
        if not prior:
            continue
        prefix = [p for p in prior['points'] if p[0] < current['points'][0][0]]
        if prefix:
            current['points'] = prefix + current['points']
            archived = list(prior.get('archivedSources', []))
            new_prefix = [p for p in prefix if p[0] >= prior.get('sourceRange', [prior['points'][0][0]])[0]]
            if new_prefix:
                record = dict(**previous['sources'][prior['source']], retainedFrom=new_prefix[0][0], retainedThrough=new_prefix[-1][0])
                if record not in archived:
                    archived.append(record)
            current['archivedSources'] = archived


def build_with_source_fallback(raw, asof, fetched, source_urls=None, previous=None, failures=None):
    """Retain an unverified valuation pair without stopping independent sources."""
    raw, failures = dict(raw), dict(failures or {})
    for market in ('spx', 'ndx'):
        history, detail = 'jiucai-' + market, 'jiucai-' + market + '-detail'
        if history not in raw and detail not in raw:
            continue
        try:
            if history not in raw or detail not in raw:
                raise ValueError('Valuation history/detail pair incomplete')
            valuation_metric(raw[history], raw[detail], market, asof)
        except (ValueError, KeyError, TypeError, IndexError) as error:
            # Never pair a new response with an old, independently dated half.
            # Both published source hashes, dates and observations are retained.
            for key in (history, detail):
                raw.pop(key, None)
                failures[key] = str(error)
    data = build(raw, asof, fetched, source_urls)
    missing = set(source_specs(asof)) - set(raw)
    if missing:
        if previous is None:
            raise ValueError('Missing source evidence: ' + ', '.join(sorted(missing)))
        retain_unavailable_sources(data, previous, missing)
    curate_report(data)
    validate(data)
    if previous is not None:
        retain_valuation_prefix(data, previous)
        validate(data)
        reject_regression(data, previous)
    data['refreshFailures'] = {key: error for key, error in failures.items() if key in data['sources']}
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--as-of')
    args = parser.parse_args()
    if args.check:
        data = validate(json.loads(OUTPUT.read_text()))
        print('Historical-position dataset valid:', [(m['id'], len(m['metrics'])) for m in data['markets']])
        return
    if args.offline and OUTPUT.exists():
        data = curate_report(json.loads(OUTPUT.read_text()))
        for market in data['markets']:
            if not any(m['id'] == 'pe' for m in market['metrics']):
                source = 'jiucai-' + market['id']
                raw = {}
                for key in (source, source + '-detail'):
                    raw[key] = (CACHE / (key + '.raw')).read_bytes()
                    meta = json.loads((CACHE / (key + '.meta.json')).read_text())
                    data['sources'][key] = dict(name=source_specs(data['asOf'])[key][0], status='available',
                        sha256=hashlib.sha256(raw[key]).hexdigest(), **meta)
                market['metrics'].insert(0, valuation_metric(raw[source], raw[source + '-detail'], market['id'], data['asOf']))
            if market.get('prices') and {'rv21', 'drawdown', 'mdd252', 'ma200', 'momentum'} <= {m['id'] for m in market['metrics']}:
                continue
            source = 'yahoo-' + market['id']
            raw = (CACHE / (source + '.raw')).read_bytes()
            if hashlib.sha256(raw).hexdigest() != data['sources'][source]['sha256']:
                raise ValueError(source + ': cached price evidence differs from the published source')
            symbol = '^GSPC' if market['id'] == 'spx' else '^NDX'
            market['prices'] = dict(points=yahoo(raw, symbol, data['asOf']), source=source, symbol=symbol, basis='price_index', currency='USD')
            # Reuse the normal builder so an offline schema upgrade and scheduled
            # refresh publish the same formulas, labels and original source dates.
            rebuilt = build({source: raw}, data['asOf'], {})
            additions = next(m for m in rebuilt['markets'] if m['id'] == market['id'])['metrics']
            existing = {m['id'] for m in market['metrics']}
            market['metrics'].extend(m for m in additions if m['id'] not in existing)
        curate_report(data)
        validate(data)
        data['generatedAt'] = datetime.now(timezone.utc).isoformat()
        temporary = OUTPUT.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
        temporary.replace(OUTPUT)
        print('Offline: applied publication selection; retained original observations and source dates.')
        return
    now = datetime.now(ZoneInfo('America/New_York'))
    asof = args.as_of or (now.date() if now.hour >= 17 else now.date() - timedelta(days=1)).isoformat()
    CACHE.mkdir(parents=True, exist_ok=True)
    raw, fetched, failures, source_urls = {}, {}, {}, {}
    specs = source_specs(asof)
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(fetch_source, key, url, asof, args.offline): key for key, (_, url) in specs.items()}
        for job in as_completed(jobs):
            key = jobs[job]
            content, stamp, error = job.result()
            if content:
                raw[key] = content
                meta = CACHE / (key + '.meta.json')
                metadata = json.loads(meta.read_text()) if meta.exists() else {}
                fetched[key] = stamp or metadata.get('fetchedAt')
                source_urls[key] = metadata.get('url', specs[key][1])
            if error:
                failures[key] = error
    previous = curate_report(json.loads(OUTPUT.read_text())) if OUTPUT.exists() else None
    data = build_with_source_fallback(raw, asof, fetched, source_urls, previous, failures)
    # Only a fully parsed, validated snapshot replaces the published artifact.
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(OUTPUT)
    print('Saved:', [(m['id'], len(m['metrics']), len(m['snapshots'])) for m in data['markets']], 'source failures:', data['refreshFailures'])


if __name__ == '__main__':
    main()
