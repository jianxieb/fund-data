#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内长期股 / 高股息快照生成脚本

数据源：
  1) push2.eastmoney.com          股票现价、市值、PE(TTM)、PB、ROE、行业
  2) push2his.eastmoney.com       后复权日线，用于区间收益、回撤和波动
     接口限流时自动改用腾讯 hfq 日线兜底
  3) datacenter-web.eastmoney.com 现金分红记录，用于近12月股息率和分红年数

用法：
  python stock_screen.py

脚本只更新 index.html 中 /*__DATA_STOCKS_BEGIN__*/ 与
/*__DATA_STOCKS_END__*/ 之间的数据块；接口失败时保留上一版个股数据。
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'index.html')
UA = {'User-Agent': 'Mozilla/5.0'}
WINDOWS = [1, 2, 3, 5, 10]

# 核心观察清单：优先覆盖稳定现金流、行业龙头和常见高股息标的。
# note 只写业务和筛选逻辑，不写推荐语。
STOCK_UNIVERSE = [
    {'code': '600900', 'note': '水电龙头，现金流稳定，长期高比例分红'},
    {'code': '000333', 'note': '白电龙头，全球化经营，分红稳定'},
    {'code': '600901', 'note': '金融租赁平台，高股息与稳健资产扩张'},
    {'code': '600941', 'note': '通信运营龙头，派息率高、现金流稳定'},
    {'code': '601088', 'note': '煤电一体化龙头，分红比例高'},
    {'code': '601225', 'note': '动力煤龙头，现金流与分红能力强'},
    {'code': '601857', 'note': '油气一体化龙头，长期分红与资源属性'},
    {'code': '600938', 'note': '海上油气龙头，高资本开支后现金流改善'},
    {'code': '601398', 'note': '大型银行，低估值、高股息代表'},
    {'code': '601939', 'note': '大型银行，资产质量稳健、分红持续'},
    {'code': '601288', 'note': '大型银行，县域金融覆盖广、分红稳定'},
    {'code': '601988', 'note': '大型银行，低估值与稳定现金分红'},
    {'code': '600036', 'note': '零售银行龙头，ROE与分红质量较高'},
    {'code': '601668', 'note': '大型建筑央企，订单与分红稳定'},
    {'code': '601006', 'note': '铁路运输资产，现金流稳定、分红持续'},
    {'code': '600377', 'note': '长三角收费公路资产，现金流稳定'},
    {'code': '600886', 'note': '水电与能源综合运营商，分红稳定'},
    {'code': '600674', 'note': '水电资产质量较好，长期现金流稳定'},
    {'code': '600519', 'note': '高端白酒龙头，盈利与现金分红稳定'},
    {'code': '000651', 'note': '空调龙头，估值较低、股息率较高'},
    {'code': '000895', 'note': '肉类加工龙头，现金流与分红较稳定'},
    {'code': '601728', 'note': '通信运营龙头，低估值高股息'},
    {'code': '600690', 'note': '全球化白电龙头，现金流与分红改善'},
]


def log(*args):
    try:
        print(*args, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode('gbk', 'replace').decode('gbk') for x in args], flush=True)


def fetch_json(url, tries=6):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=35) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 + i * 1.2)
    raise last


def secid(code):
    return ('1.' if code[0] in '5689' else '0.') + code


def at_or_before(series, date):
    value = None
    for d, v in series:
        if d <= date:
            value = v
        else:
            break
    return value


def window_return(series, latest, years):
    end = series[-1][1]
    base_date = (datetime.strptime(latest, '%Y-%m-%d') - timedelta(days=365 * years)).strftime('%Y-%m-%d')
    base = at_or_before(series, base_date)
    if base is None or base <= 0:
        return None
    return round((end / base - 1) * 100, 4)


def risk_metrics(series, latest, years=5):
    start = (datetime.strptime(latest, '%Y-%m-%d') - timedelta(days=365 * years)).strftime('%Y-%m-%d')
    values = [v for d, v in series if d >= start and v > 0]
    # 不足约四年半时不展示五年风险指标，避免把短历史包装成长期结论。
    if len(values) < 1000:
        return None, None
    changes = [math.log(values[i] / values[i - 1]) for i in range(1, len(values)) if values[i - 1] > 0]
    mean = sum(changes) / len(changes)
    variance = sum((x - mean) ** 2 for x in changes) / (len(changes) - 1)
    volatility = math.sqrt(variance) * math.sqrt(250) * 100
    peak = values[0]
    max_drawdown = 0.0
    for value in values:
        peak = max(peak, value)
        max_drawdown = min(max_drawdown, value / peak - 1)
    return round(volatility, 2), round(max_drawdown * 100, 2)


def dividend_stats(code, latest, price):
    url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?' + urllib.parse.urlencode({
        'reportName': 'RPT_SHAREBONUS_DET',
        'columns': 'ALL',
        'filter': '(SECURITY_CODE="%s")' % code,
        'pageNumber': 1,
        'pageSize': 100,
        'sortColumns': 'REPORT_DATE',
        'sortTypes': -1,
        'source': 'WEB',
        'client': 'WEB',
    })
    result = fetch_json(url).get('result')
    data = result.get('data', []) if isinstance(result, dict) else []
    cash = []
    for row in data:
        try:
            amount = float(row.get('PRETAX_BONUS_RMB') or 0) / 10
        except (TypeError, ValueError):
            amount = 0.0
        ex_date = (row.get('EX_DIVIDEND_DATE') or '')[:10]
        report_date = (row.get('REPORT_DATE') or '')[:10]
        if amount > 0 and ex_date:
            cash.append((ex_date, amount, report_date))
    cutoff = (datetime.strptime(latest, '%Y-%m-%d') - timedelta(days=365)).strftime('%Y-%m-%d')
    yield_12m = sum(amount for ex_date, amount, _ in cash if ex_date > cutoff) / price * 100
    years = {
        report_date[:4]
        for _, _, report_date in cash
        if report_date[:4].isdigit() and int(report_date[:4]) >= 2021
    }
    return round(yield_12m, 2), len(years)


def fetch_stock(item):
    code = item['code']
    quote = fetch_json(
        'https://push2.eastmoney.com/api/qt/stock/get?secid=%s&fields=f43,f57,f58,f116,f127,f164,f167,f170,f173'
        % secid(code)
    ).get('data') or {}
    if not quote:
        raise RuntimeError('行情为空')

    try:
        kline = fetch_json(
            'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s'
            '&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3&fields2=f51,f53'
            '&klt=101&fqt=2&end=20500101&lmt=4000' % secid(code)
        ).get('data') or {}
        series = [(row.split(',')[0], float(row.split(',')[1])) for row in kline.get('klines') or []]
    except Exception:  # noqa: BLE001
        market = 'sh' if code[0] in '5689' else 'sz'
        fallback = fetch_json(
            'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s%s,day,,,4000,hfq'
            % (market, code)
        )
        node = (fallback.get('data') or {}).get(market + code) or {}
        raw = node.get('hfqday') or []
        series = [(row[0], float(row[2])) for row in raw if len(row) >= 3]
    if len(series) < 250:
        raise RuntimeError('历史行情不足')

    latest = series[-1][0]
    price = round((quote.get('f43') or 0) / 100, 2)
    if price <= 0:
        raise RuntimeError('现价无效')
    returns = [window_return(series, latest, years) for years in WINDOWS]
    volatility, max_drawdown = risk_metrics(series, latest)
    yield_12m, dividend_years = dividend_stats(code, latest, price)

    long_term = (
        returns[4] is not None and returns[4] >= 80
        and returns[3] is not None and returns[3] > 20
        and (quote.get('f116') or 0) >= 5e10
    )
    high_dividend = yield_12m >= 3.2 and dividend_years >= 4
    styles = []
    if long_term:
        styles.append('长期核心')
    if high_dividend:
        styles.append('高股息')

    return {
        'c': code,
        'n': quote.get('f58') or '',
        'ind': quote.get('f127') or '',
        'style': styles,
        'price': price,
        'chg': round((quote.get('f170') or 0) / 100, 2),
        'mcap': round((quote.get('f116') or 0) / 1e8, 1),
        'pe': round((quote.get('f164') or 0) / 100, 2),
        'pb': round((quote.get('f167') or 0) / 100, 2),
        'roe': round(quote.get('f173') or 0, 2),
        'yield12': yield_12m,
        'divYears': dividend_years,
        'r': returns,
        'vol5': volatility,
        'mdd5': max_drawdown,
        'note': item['note'],
        'latest': latest,
    }


def load_old_rows(src):
    match = re.search(r'var STOCKS=\[(.*?)\n\];', src, re.S)
    if not match:
        return {}
    try:
        rows = json.loads('[' + match.group(1) + ']')
    except Exception:  # noqa: BLE001
        # 兼容旧版本最后一行带尾逗号的格式。
        rows = []
        for line in match.group(1).splitlines():
            line = line.strip().rstrip(',')
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:  # noqa: BLE001
                continue
    return {row['c']: row for row in rows if row.get('c')}


def format_block(rows):
    lines = ['/*__DATA_STOCKS_BEGIN__*/']
    asof = max((row.get('latest') or '') for row in rows) if rows else ''
    lines.append('var STOCK_ASOF=%s;' % json.dumps(asof, ensure_ascii=False))
    lines.append('var STOCKS=[')
    lines.append(',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows))
    lines.append('];')
    lines.append('/*__DATA_STOCKS_END__*/')
    return '\n'.join(lines)


def main():
    with open(HTML, encoding='utf-8') as f:
        src = f.read()
    old = load_old_rows(src)
    only = None
    if '--only' in sys.argv:
        idx = sys.argv.index('--only')
        if idx + 1 < len(sys.argv):
            only = {x.strip() for x in sys.argv[idx + 1].split(',') if x.strip()}
    universe = [x for x in STOCK_UNIVERSE if not only or x['code'] in only]
    rows = [old[x['code']] for x in STOCK_UNIVERSE if only and x['code'] not in only and x['code'] in old]
    failures = []
    for item in universe:
        code = item['code']
        try:
            row = fetch_stock(item)
            rows.append(row)
            log('  ✓ %s %s' % (code, row['n']))
        except Exception as exc:  # noqa: BLE001
            failures.append(code)
            if code in old:
                rows.append(old[code])
                log('  ~ %s 获取失败，保留上一版：%s' % (code, exc))
            else:
                log('  !! %s 获取失败：%s' % (code, exc))
        time.sleep(1.0)

    expected = len(old) + len(universe) if only else len(STOCK_UNIVERSE)
    if len(rows) < max(1, int(expected * 0.8)):
        log('成功数据不足 80%%，放弃写回；失败：%s' % ','.join(failures))
        return 2
    order = {item['code']: i for i, item in enumerate(STOCK_UNIVERSE)}
    rows.sort(key=lambda row: order.get(row.get('c'), 9999))
    block = format_block(rows)
    pattern = re.compile(r'/\*__DATA_STOCKS_BEGIN__\*/.*?/\*__DATA_STOCKS_END__\*/', re.S)
    if not pattern.search(src):
        log('index.html 未找到 STOCKS 数据块，放弃写回')
        return 2
    src = pattern.sub(block, src, count=1)
    tmp = HTML + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(src)
    os.replace(tmp, HTML)
    log('完成：%d 只股票，数据截至 %s' % (len(rows), rows[0].get('latest', '')))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log('中断')
        sys.exit(1)
