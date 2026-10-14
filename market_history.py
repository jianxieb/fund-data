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
        'multpl-pe': ('Multpl · S&P / Shiller', 'https://www.multpl.com/s-p-500-pe-ratio/table/by-month'),
        'sp-cape': ('Multpl · Robert Shiller', 'https://www.multpl.com/shiller-pe/table/by-month'),
        'sp-pb': ('Multpl · S&P', 'https://www.multpl.com/s-p-500-price-to-book/table/by-quarter'),
        'sp-ps': ('Multpl · S&P', 'https://www.multpl.com/s-p-500-price-to-sales/table/by-quarter'),
        'sp-dividend': ('Multpl · S&P / Shiller', 'https://www.multpl.com/s-p-500-dividend-yield/table/by-month'),
        'sp-earnings-growth': ('Multpl · S&P', 'https://www.multpl.com/s-p-500-earnings-growth/table/by-quarter'),
        'sp-sales-growth': ('Multpl · S&P', 'https://www.multpl.com/s-p-500-sales-growth/table/by-quarter'),
        'sp-profit': ('DQYDJ · Shiller / reconstructed sales', 'https://dqydj.com/sp-500-profit-margin/'),
        'vix': ('Cboe', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'),
        'vxn': ('Cboe · VXN', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VXN_History.csv'),
        'sp-forward': ('History of Market', 'https://historyofmarket.com/api/sp500/forward-pe.json'),
        'ndx-forward': ('History of Market', 'https://historyofmarket.com/api/ndx/forward-pe.json'),
        'finviz-ndx': ('Finviz', 'https://finviz.com/index/NDX?p=d'),
        'finviz-spx': ('Finviz', 'https://finviz.com/index/SPX?p=d'),
        'vix3m': ('Cboe · VIX3M', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv'),
        'vix9d': ('Cboe · VIX9D', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX9D_History.csv'),
        'vvix': ('Cboe · VVIX', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv'),
        'skew': ('Cboe · SKEW', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/SKEW_History.csv'),
        'nfci': ('Federal Reserve Bank of Chicago', 'https://api.data.chicagofed.org/NFCI/nfci-data-series-csv.csv'),
    }
    base = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
    for kind in ('nominal', 'real'):
        specs['treasury-' + kind + '-archive'] = ('U.S. Treasury · ' + kind + ' archive', base + 'daily-treasury-rate-archives/par-' + ('real-' if kind == 'real' else '') + 'yield-curve-rates-' + ('2003' if kind == 'real' else '1990') + '-2023.csv')
        for year in range(2024, int(asof[:4]) + 1):
            specs['treasury-' + kind + '-' + str(year)] = ('U.S. Treasury · ' + kind + ' ' + str(year), base + 'pages/xml?data=daily_treasury_' + ('real_' if kind == 'real' else '') + 'yield_curve&field_tdr_date_value=' + str(year))
    for key, symbol in [('yahoo-spx', '^GSPC'), ('yahoo-ndx', '^NDX')]:
        specs[key] = ('Yahoo Finance · ' + symbol, 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(symbol, safe='') + '?' + query)
    return specs


def metric(key, label, english, unit, category, frequency, points, source, basis, **extra):
    return dict(id=key, label=label, english=english, unit=unit, category=category,
                frequency=frequency, points=points, source=source, basis=basis, **extra)


def build(raw, asof, fetched):
    markets = [dict(id='spx', name='标普500', english='S&P 500', symbol='SPX', metrics=[], snapshots=[]),
               dict(id='ndx', name='纳斯达克100', english='NASDAQ-100', symbol='NDX', metrics=[], snapshots=[])]
    specs = source_specs(asof)
    sources = {k: dict(name=name, url=url, fetchedAt=fetched.get(k), status='available' if k in raw else 'missing',
                       sha256=hashlib.sha256(raw[k]).hexdigest() if k in raw else None)
               for k, (name, url) in specs.items()}
    spx, ndx = markets
    definitions = [
        ('multpl-pe', 'pe', '滚动市盈率', 'P/E · TTM', '倍', 'valuation', 'monthly', '价格 / 过去12个月GAAP盈利；历史月频值，最近值为供应商估算。'),
        ('sp-cape', 'cape', '席勒市盈率', 'CAPE', '倍', 'valuation', 'monthly', '价格 / 过去10年经通胀调整的平均盈利。'),
        ('sp-pb', 'pb', '市净率', 'PRICE / BOOK', '倍', 'valuation', 'quarterly', '价格 / 每股净资产；最近价格读数沿用供应商最新已报告净资产。'),
        ('sp-ps', 'ps', '市销率', 'PRICE / SALES', '倍', 'valuation', 'quarterly', '价格 / 过去12个月销售额；最近价格读数沿用供应商最新已报告销售额。'),
        ('sp-dividend', 'dividend', '股息率', 'DIVIDEND YIELD', '%', 'valuation', 'monthly', '过去12个月现金股息 / 价格；不是ETF分红收益率。'),
        ('sp-earnings-growth', 'earnings_growth', '盈利同比增长', 'EPS GROWTH · TTM', '%', 'profitability', 'quarterly', '名义过去12个月每股收益同比增长，非未来盈利预测。'),
        ('sp-sales-growth', 'sales_growth', '营收同比增长', 'SALES GROWTH · TTM', '%', 'profitability', 'quarterly', '过去12个月每股销售额同比增长，未经通胀调整。'),
    ]
    for source, key, label, english, unit, cat, freq, basis in definitions:
        if source not in raw:
            continue
        points, estimated = multpl(raw[source], asof)
        if not points:
            raise ValueError(source + ': no valid observations')
        spx['metrics'].append(metric(key, label, english, unit, cat, freq, points, source, basis,
                                     estimatedDates=estimated))
        if key == 'pe':
            spx['metrics'].append(metric('earnings_yield', '盈利收益率', 'EARNINGS YIELD', '%', cat, freq,
                [[d, round(100 / v, 6)] for d, v in points if v > 0], source, '滚动PE的倒数 × 100；与同来源PE共用日期。', estimatedDates=estimated))
    if 'sp-profit' in raw:
        points = []
        for row in rows_of(raw['sp-profit']):
            if len(row) == 5 and re.fullmatch(r'\d{2}-\d{4}', row[0]):
                month, year = map(int, row[0].split('-'))
                value = number(row[-1])
                if value is not None:
                    points.append([date(year, month, calendar.monthrange(year, month)[1]).isoformat(), value])
        spx['metrics'].append(metric('margin', '净利率 · 估算', 'NET MARGIN · EST.', '%', 'profitability', 'monthly',
            normalize(points, asof), 'sp-profit', 'DQYDJ以Shiller盈利和重建销售序列计算TTM净利率；包含估算及最近季度的数值沿用，不是官方已报告季度净利率。', estimated=True))
    for market in markets:
        source = 'sp-forward' if market['id'] == 'spx' else 'ndx-forward'
        if source in raw:
            data = json.loads(raw[source])
            points = normalize([[r['date'], r['value']] for r in data['forward']], asof)
            market['metrics'].insert(1, metric('forward_pe', '预期市盈率', 'FORWARD P/E · NTM', '倍', 'valuation', 'weekly', points, source,
                '未来12个月混合一致预期PE，使用发布方独立的终端周频序列。未与其自算forwardOwn或其他供应商最新PE拼接。原始终端供应商未披露。',
                caution='转载周频序列；原始终端来源未披露', attribution='History of Market (historyofmarket.com), CC BY 4.0'))
        source = 'yahoo-' + market['id']
        if source in raw:
            symbol = '^GSPC' if market['id'] == 'spx' else '^NDX'
            prices = yahoo(raw[source], symbol, asof)
            market['close'] = dict(date=prices[-1][0], value=prices[-1][1], source=source, basis='price_index')
            derived = price_metrics(prices)
            for key, label, english, basis in [
                ('rv21', '21日实际波动率', 'REALIZED VOL · 21D', '过去21个交易日对数收益率样本标准差 × √252。'),
                ('rv63', '63日实际波动率', 'REALIZED VOL · 63D', '过去63个交易日对数收益率样本标准差 × √252。'),
                ('rv252', '一年实际波动率', 'REALIZED VOL · 252D', '过去252个交易日对数收益率样本标准差 × √252。'),
                ('downside', '一年下行波动率', 'DOWNSIDE DEVIATION', '过去252个交易日日简单收益相对零收益门槛的下偏标准差 × √252，分母包含全部252个收益。'),
                ('var95', '单日损失 VaR 95%', 'HISTORICAL VaR · 95%', '过去252个交易日简单收益的5%分位数取负号。采用线性插值分位数；是历史经验单日损失阈值，不是未来损失上限。'),
                ('es95', '尾部平均损失 ES 95%', 'EXPECTED SHORTFALL · 95%', '过去252个交易日中，所有不高于5%收益分位数的日收益平均值取负号。历史尾部风险统计，不是损失上限。'),
                ('mdd252', '一年内最大回撤', 'MAX DRAWDOWN · 252D', '过去252个交易日窗口内，从较早收盘高点到其后低点的最大跌幅；不同于当前距高点的距离。'),
                ('drawdown', '距一年高点', 'DRAWDOWN · 252D', '当前价格 / 过去252个交易日最高收盘价 − 1；越负表示距高点越远。'),
                ('ma50', '50日均线偏离', 'DISTANCE TO 50D MA', '当前价格 / 过去50个交易日简单平均收盘价 − 1。'),
                ('ma200', '200日均线偏离', 'DISTANCE TO 200D MA', '当前价格 / 过去200个交易日简单平均收盘价 − 1。'),
                ('momentum63', '一季价格动量', 'PRICE MOMENTUM · 63D', '当前价格 / 63个交易日前价格 − 1，不含现金分红。'),
                ('momentum', '一年价格动量', 'PRICE MOMENTUM · 252D', '当前价格 / 252个交易日前价格 − 1，不含现金分红。'),
            ]:
                market['metrics'].append(metric(key, label, english, '%', 'trend' if key.startswith(('ma', 'momentum')) else 'risk',
                    'daily', derived[key], source, basis))
        volsource, volkey = ('vix', 'vix') if market['id'] == 'spx' else ('vxn', 'vxn')
        if volsource in raw:
            points = cboe(raw[volsource], asof)
            market['metrics'].insert(2, metric(volkey, '隐含波动率 ' + volkey.upper(), volkey.upper() + ' · 30D IMPLIED', '点', 'risk', 'daily',
                points, volsource, ('标普500期权' if volkey == 'vix' else '纳斯达克100期权') + '隐含未来30日年化波动率指数收盘值。'))
            realized = next((m for m in market['metrics'] if m['id'] == 'rv21'), None)
            if realized:
                market['metrics'].append(metric('vol_gap', '隐含与实际波动差', 'IMPLIED − REALIZED VOL', '百分点', 'risk', 'daily',
                    same_date(points, realized['points'], lambda a, b: a - b), volsource,
                    '当日' + volkey.upper() + '减去当日过去21交易日年化实际波动率。只配对同一天观测；这是预期与已实现波动的差，不能等同于事后实现的方差风险溢价。',
                    dependencies=[volsource, source]))
    for key, label, english, column, basis in [
        ('vix3m', '三个月隐含波动率', 'VIX3M · 3M IMPLIED', 'CLOSE', 'Cboe标普500未来三个月年化隐含波动率；可用历史始于2009-09-18，不回填20年。'),
        ('vix9d', '九日隐含波动率', 'VIX9D · 9D IMPLIED', 'CLOSE', 'Cboe标普500未来九日年化隐含波动率；可用历史始于2011-01-04，不回填20年。'),
        ('vvix', '波动率的波动 VVIX', 'VVIX · VOL OF VOL', 'VVIX', '由VIX期权价格推导的VIX未来波动预期，反映波动率自身的不确定性，不是标普500价格波动率。'),
        ('skew', '尾部风险偏度 SKEW', 'SKEW · TAIL RISK', 'SKEW', 'Cboe基于标普500期权价格计算的收益分布偏度指标。数值较高表示尾部保护定价较高，不是暴跌概率。'),
    ]:
        if key in raw:
            points = cboe(raw[key], asof, column)
            spx['metrics'].append(metric(key, label, english, '点', 'risk', 'daily', points, key, basis))
    if 'vix' in raw and 'vix3m' in raw:
        spx['metrics'].append(metric('vol_term', '波动率期限结构', 'VIX / VIX3M', '倍', 'risk', 'daily',
            same_date(cboe(raw['vix'], asof), cboe(raw['vix3m'], asof), lambda a, b: a / b), 'vix3m',
            '同一天的30天隐含波动率VIX / 3个月隐含波动率VIX3M。大于1表示短端波动预期高于长端，非VIX期货期限结构。始于共同可用日。', dependencies=['vix', 'vix3m']))
    for market in markets:
        source = 'finviz-' + market['id']
        if source not in raw:
            continue
        lookup = {row[0]: row[1] for row in rows_of(raw[source]) if len(row) == 2}
        for field, label, unit, cat in [
            ('P/E', '滚动市盈率 PE', '倍', 'valuation'), ('Forward P/E', '预期PE · Finviz口径', '倍', 'valuation'),
            ('P/B', '市净率 PB', '倍', 'valuation'), ('P/S', '市销率 PS', '倍', 'valuation'),
            ('Dividend Yield', '股息率', '%', 'valuation'), ('P/FCF', '自由现金流市盈率', '倍', 'valuation'),
            ('PEG', '市盈增长比 PEG', '倍', 'valuation'), ('EV/EBITDA', '企业价值 / EBITDA', '倍', 'valuation'),
            ('EV/Sales', '企业价值 / 销售额', '倍', 'valuation'), ('P/C', '价格 / 现金', '倍', 'valuation'),
            ('ROE', '净资产收益率 ROE', '%', 'profitability'), ('ROA', '总资产收益率 ROA', '%', 'profitability'),
            ('ROIC', '投入资本回报率 ROIC', '%', 'profitability'), ('Gross Margin', '毛利率', '%', 'profitability'),
            ('Oper. Margin', '营业利润率', '%', 'profitability'), ('Profit Margin', '净利率', '%', 'profitability'),
            ('EPS next 5Y', '预期5年盈利增速', '%', 'profitability'),
            ('Debt/Eq', '负债权益比', '倍', 'profitability'), ('LT Debt/Eq', '长期负债权益比', '倍', 'profitability'),
            ('Quick Ratio', '速动比率', '倍', 'profitability'), ('Current Ratio', '流动比率', '倍', 'profitability'),
        ]:
            if market['id'] == 'spx' and field in ('P/E', 'Forward P/E', 'P/B', 'P/S', 'Dividend Yield'):
                continue
            value = number(lookup.get(field, ''))
            if value is not None:
                market['snapshots'].append(dict(id=field, label=label, value=value, unit=unit, category=cat,
                    source=source, observedAt=fetched.get(source),
                    gap='缺少Finviz同口径20年历史序列', percentile=None))
    ndx['gaps'] = ['滚动PE、PB、PS、股息率与自由现金流估值：缺20年同口径历史',
                   'ROE、ROA、ROIC、毛利率、营业利润率、净利率：缺20年同口径历史']
    spx['gaps'] = ['ROE、ROA、ROIC、现金流估值与财务杠杆等快照指标：缺20年同口径历史']
    order = ['pe', 'forward_pe', 'cape', 'pb', 'ps', 'dividend', 'earnings_yield', 'margin', 'earnings_growth', 'sales_growth', 'vix', 'vxn', 'vix9d', 'vix3m', 'vvix', 'skew', 'vol_term', 'vol_gap', 'rv21', 'rv63', 'rv252', 'downside', 'var95', 'es95', 'drawdown', 'mdd252', 'ma50', 'ma200', 'momentum63', 'momentum']
    for market in markets:
        market['metrics'].sort(key=lambda m: order.index(m['id']))
    context = dict(id='macro', name='利率与金融环境', english='RATES & FINANCIAL CONDITIONS', symbol='MACRO', metrics=[], snapshots=[],
                   gaps=['高收益与投资级公司债OAS：缺可稳定取得的20年历史序列'])
    nominal_keys = [key for key in specs if key.startswith('treasury-nominal-')]
    real_keys = [key for key in specs if key.startswith('treasury-real-')]
    rates = {}
    for key, label, english, column, xml_column, real in [
        ('yield3m', '3个月国债收益率', 'U.S. TREASURY · 3M', '3 mo', 'BC_3MONTH', False),
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
    for key, label, english, left, right, basis in [
        ('curve10_2', '10年—2年期限利差', 'YIELD CURVE · 10Y − 2Y', 'yield10y', 'yield2y', '同日10年减2年名义国债收益率。负值表示该段收益率曲线倒挂。'),
        ('curve10_3m', '10年—3个月期限利差', 'YIELD CURVE · 10Y − 3M', 'yield10y', 'yield3m', '同日10年减3个月名义国债收益率。负值表示该段收益率曲线倒挂。'),
        ('inflation_comp', '10年名义—实际利差', 'NOMINAL − REAL · 10Y', 'yield10y', 'real10y', '同日10年名义平价收益率减10年TIPS实际平价收益率，是通胀补偿的近似量，含流动性与风险溢价，不是纯通胀预测。'),
    ]:
        if left in rates and right in rates:
            keys = nominal_keys + (real_keys if right == 'real10y' else [])
            context['metrics'].append(metric(key, label, english, '百分点', 'macro', 'daily', same_date(rates[left], rates[right], lambda a, b: a - b), keys[-1], basis, dependencies=keys))
    if 'nfci' in raw:
        for key, label, column, basis in [
            ('nfci', '金融条件指数 NFCI', 'NFCI', '芝加哥联储综合金融条件指数。正值代表相对历史平均更紧，负值更松。'),
            ('anfci', '调整后金融条件 ANFCI', 'ANFCI', '芝加哥联储剔除宏观经济条件影响后的金融条件指数。正值相对更紧，负值更松。'),
            ('credit', '信用条件分项', 'Credit', '芝加哥联储NFCI信用子指数，反映信贷供给和融资条件；不是信用利差，也不是加权贡献值。'),
            ('leverage', '杠杆条件分项', 'Leverage', '芝加哥联储NFCI杠杆子指数；观察融资杠杆环境，不是企业资产负债率。'),
            ('nonfinancial_leverage', '非金融杠杆分项', 'Nonfinancial_Leverage', '芝加哥联储非金融部门杠杆子指数，覆盖非金融企业与家庭杠杆条件。'),
        ]:
            context['metrics'].append(metric(key, label, column.upper(), '点', 'macro', 'weekly', nfci(raw['nfci'], asof, column), 'nfci', basis + ' 采用最新修订历史，不代表历史当时可获得的数据版本。'))
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
    return dict(schemaVersion=1, asOf=asof, generatedAt=datetime.now(timezone.utc).isoformat(), crossChecks=checks,
                sources=sources, markets=markets, context=context,
                methodology=dict(percentile='midrank', windowYears=20, reference='each_index_own_history',
                                 sampling='原始发布频率；不把季频/月频前向填充成日频',
                                 formula='100 × (小于当前值的样本数 + 0.5 × 等于当前值的样本数) / 有效样本数'))


def check_source(key, raw, asof):
    """Reject block pages / changed schemas before replacing a reusable cache."""
    if key.startswith('yahoo-'):
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
        if any(fields.get(k) is None for k in ('P/E', 'P/B', 'ROE', 'Profit Margin')):
            raise ValueError(key + ': missing snapshot fields')
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
    for market in data['markets'] + ([data['context']] if 'context' in data else []):
        if market['id'] != 'macro' and (not market.get('close') or len(market['metrics']) < 7):
            raise ValueError(market['id'] + ': essential series missing')
        if market['id'] != 'macro' and (market['close']['basis'] != 'price_index' or market['close']['date'] > data['asOf']):
            raise ValueError('Wrong index basis or future close')
        if len({m['id'] for m in market['metrics']}) != len(market['metrics']):
            raise ValueError('Duplicate metric identity')
        for m in market['metrics']:
            points = m['points']
            if len(points) < 30 or points != normalize(points, data['asOf']):
                raise ValueError(m['id'] + ': invalid dates or values')
            if m['id'] in ('vix', 'vxn', 'pe', 'forward_pe', 'cape', 'pb', 'ps') and any(v <= 0 for _, v in points):
                raise ValueError(m['id'] + ': must be positive')
            if m['source'] not in data['sources'] or not data['sources'][m['source']]['fetchedAt']:
                raise ValueError(m['id'] + ': source capture date missing')
        for snapshot in market['snapshots']:
            if snapshot['percentile'] is not None or not snapshot['observedAt']:
                raise ValueError('Snapshots cannot carry historical ranks or omit capture dates')
    return data


def retain_unavailable_sources(data, previous, missing):
    """A source outage never silently removes previously published evidence."""
    for key in missing:
        if key not in previous['sources']:
            raise ValueError(key + ': no previous evidence to retain')
        data['sources'][key] = previous['sources'][key]
    sections = data['markets'] + ([data['context']] if 'context' in data and 'context' in previous else [])
    old_sections = previous['markets'] + ([previous['context']] if 'context' in data and 'context' in previous else [])
    for market, old in zip(sections, old_sections):
        existing = {m['id'] for m in market['metrics']}
        market['metrics'].extend(m for m in old['metrics'] if m['id'] not in existing and (set(m.get('dependencies', [])) | {m['source']}) & missing)
        market['snapshots'].extend(m for m in old['snapshots'] if m['source'] in missing)
        if market['id'] != 'macro' and not market.get('close'):
            market['close'] = old['close']
        order = {m['id']: i for i, m in enumerate(old['metrics'])}
        market['metrics'].sort(key=lambda m: order.get(m['id'], 100))
    return data


def reject_regression(data, previous):
    sections = {s['id']: s for s in data['markets'] + [data['context']]}
    for old in previous['markets'] + ([previous['context']] if 'context' in previous else []):
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
        validate(json.loads(OUTPUT.read_text()))
        print('Offline: retained published observations and their source dates.')
        return
    now = datetime.now(ZoneInfo('America/New_York'))
    asof = args.as_of or (now.date() if now.hour >= 17 else now.date() - timedelta(days=1)).isoformat()
    CACHE.mkdir(parents=True, exist_ok=True)
    raw, fetched, failures = {}, {}, {}
    specs = source_specs(asof)
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(fetch_source, key, url, asof, args.offline): key for key, (_, url) in specs.items()}
        for job in as_completed(jobs):
            key = jobs[job]
            content, stamp, error = job.result()
            if content:
                raw[key] = content
                meta = CACHE / (key + '.meta.json')
                fetched[key] = stamp or (json.loads(meta.read_text()).get('fetchedAt') if meta.exists() else None)
            if error:
                failures[key] = error
    data = build(raw, asof, fetched)
    missing = set(specs) - set(raw)
    if missing:
        if not OUTPUT.exists():
            raise ValueError('Missing source evidence: ' + ', '.join(sorted(missing)))
        retain_unavailable_sources(data, json.loads(OUTPUT.read_text()), missing)
    validate(data)
    if OUTPUT.exists():
        reject_regression(data, json.loads(OUTPUT.read_text()))
    data['refreshFailures'] = failures
    # Only a fully parsed, validated snapshot replaces the published artifact.
    temporary = OUTPUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    temporary.replace(OUTPUT)
    print('Saved:', [(m['id'], len(m['metrics']), len(m['snapshots'])) for m in data['markets']], 'source failures:', list(failures))


if __name__ == '__main__':
    main()
