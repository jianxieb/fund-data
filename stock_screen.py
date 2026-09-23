#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内长期股 / 高股息快照生成脚本

数据源：
  1) push2.eastmoney.com          股票现价、市值、PE(TTM)、PB、ROE、行业
  2) push2his.eastmoney.com       后复权日线，用于区间收益、回撤和波动
     接口限流时改用腾讯 hfq；再失败使用 Yahoo 明确 adjclose 字段
  3) datacenter-web.eastmoney.com 现金分红记录，用于近12月股息率和分红年数

用法：
  python stock_screen.py

脚本只更新 data/snapshot.js 中 /*__DATA_STOCKS_BEGIN__*/ 与
/*__DATA_STOCKS_END__*/ 之间的数据块；接口失败时保留上一版个股数据。
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from data_status import write_status
from update import add_years

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'data', 'snapshot.js')
UA = {'User-Agent': 'Mozilla/5.0'}
WINDOWS = [1, 2, 3, 5, 10]
OFFLINE = False
YAHOO_CACHE = os.path.join(HERE, '.tmp-snap', 'stocks')

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


def fetch_json(url, tries=2):
    if OFFLINE:
        raise RuntimeError('离线模式禁止网络请求')
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=12) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i + 1 < tries:
                time.sleep(1)
    raise last


def secid(code):
    return ('1.' if code[0] in '5689' else '0.') + code


def yahoo_stock(code):
    """A third source with an explicit adjusted-close field and instrument identity."""
    symbol = code + ('.SS' if code[0] in '5689' else '.SZ')
    start = int(datetime(2010, 1, 1, tzinfo=timezone.utc).timestamp())
    end = int(time.time()) + 86400
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=div%%2Csplits' % (symbol, start, end)
    payload = fetch_json(url, tries=1)
    node = (payload.get('chart', {}).get('result') or [None])[0]
    if not node or node.get('meta', {}).get('symbol') != symbol or node.get('meta', {}).get('currency') != 'CNY':
        raise RuntimeError('Yahoo股票标识或人民币币种不匹配：' + symbol)
    adjusted = (node.get('indicators', {}).get('adjclose') or [{}])[0].get('adjclose', [])
    timestamps = node.get('timestamp') or []
    if not adjusted or len(adjusted) != len(timestamps):
        raise RuntimeError('Yahoo缺少明确复权收盘价字段')
    china = timezone(timedelta(hours=8))
    today = datetime.now(china).strftime('%Y-%m-%d')
    series = sorted((datetime.fromtimestamp(stamp, china).strftime('%Y-%m-%d'), float(value))
                    for stamp, value in zip(timestamps, adjusted) if value is not None and value > 0)
    series = [(day, value) for day, value in series if day <= today]
    if len(series) < 250:
        raise RuntimeError('Yahoo股票复权历史不足一年')
    meta = node['meta']
    os.makedirs(YAHOO_CACHE, exist_ok=True)
    with open(os.path.join(YAHOO_CACHE, code + '.json'), 'w', encoding='utf-8') as fh:
        json.dump({'sourceUrl': url, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'meta': meta,
                   'basis': 'yahoo_adjusted_close', 'series': series}, fh, ensure_ascii=False)
    dividends = [{'date': datetime.fromtimestamp(int(event.get('date', stamp)), china).strftime('%Y-%m-%d'),
                  'amount': event.get('amount')} for stamp, event in (node.get('events', {}).get('dividends') or {}).items()]
    return {'series': series, 'meta': meta, 'sourceUrl': url, 'dividends': dividends}


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
    base_date = add_years(latest, -years)
    base = at_or_before(series, base_date)
    if base is None or base <= 0:
        return None
    return round((end / base - 1) * 100, 4)


def return_periods(series, latest):
    """Expose the actual traded endpoints used for each calendar-year window."""
    observations = sorted((day, value) for day, value in series if day <= latest and value > 0)
    end = observations[-1][0] if observations else None
    periods = []
    for years in WINDOWS:
        anniversary = add_years(end, -years) if end else None
        earlier = [day for day, _ in observations if anniversary and day <= anniversary]
        periods.append({'years': years, 'start': earlier[-1] if earlier else None, 'end': end})
    return periods


def risk_metrics(series, latest, years=5):
    start = add_years(latest, -years)
    prior = [(d, v) for d, v in series if d <= start]
    values = ([prior[-1][1]] if prior else []) + [v for d, v in series if d > start and v > 0]
    # 不足约四年半时不展示五年风险指标，避免把短历史包装成长期结论。
    if not prior or len(values) < 1000:
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
    if not isinstance(result, dict) or not isinstance(result.get('data'), list):
        raise RuntimeError('分红数据缺失，不能按零股息处理')
    data = result['data']
    cash = []
    for row in data:
        try:
            amount = float(row.get('PRETAX_BONUS_RMB') or 0) / 10
        except (TypeError, ValueError):
            amount = 0.0
        ex_date = (row.get('EX_DIVIDEND_DATE') or '')[:10]
        report_date = (row.get('REPORT_DATE') or '')[:10]
        if amount > 0 and ex_date and ex_date <= latest:
            cash.append((ex_date, amount, report_date))
    cash = set(cash)
    cutoff = add_years(latest, -1)
    yield_12m = sum(amount for ex_date, amount, _ in cash if cutoff < ex_date <= latest) / price * 100
    current_year = int(latest[:4])
    years = {
        report_date[:4]
        for _, _, report_date in cash
        if report_date[:4].isdigit() and current_year - 5 <= int(report_date[:4]) < current_year
    }
    return round(yield_12m, 2), len(years)


def fetch_stock(item):
    code = item['code']
    alternate = None
    source_errors = []

    def yahoo():
        nonlocal alternate
        if alternate is None:
            alternate = yahoo_stock(code)
        return alternate

    def number(value, scale=1, digits=2):
        try:
            result = float(value) / scale
            return round(result, digits) if math.isfinite(result) else None
        except (TypeError, ValueError):
            return None

    quote_source = 'Eastmoney quote'
    try:
        quote = fetch_json('https://push2.eastmoney.com/api/qt/stock/get?secid=%s&fields=f43,f57,f58,f86,f116,f127,f164,f167,f170,f173' % secid(code)).get('data') or {}
        if number(quote.get('f43')) is None or not quote.get('f86'):
            raise ValueError('行情缺价格或时间戳')
    except Exception as exc:
        source_errors.append('Eastmoney quote: ' + str(exc))
        meta = yahoo()['meta']
        quote_source = 'Yahoo Finance chart metadata'
        quote = {'f43': meta['regularMarketPrice'] * 100, 'f86': meta['regularMarketTime'],
                 'f58': item.get('name') or meta.get('longName') or code}

    series = []
    history_source = 'Eastmoney backward-adjusted daily close'
    source_url = 'https://quote.eastmoney.com/' + ('sh' if code[0] in '5689' else 'sz') + code + '.html'
    basis = 'provider_backward_adjusted_close'
    if alternate is None:
        try:
            raw = fetch_json('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=2&end=20500101&lmt=4000' % secid(code)).get('data') or {}
            series = [(row.split(',')[0], float(row.split(',')[1])) for row in raw.get('klines') or []]
            if len(series) < 250:
                raise ValueError('历史行情不足一年')
        except Exception as exc:
            source_errors.append('Eastmoney history: ' + str(exc))
            market = 'sh' if code[0] in '5689' else 'sz'
            try:
                payload = fetch_json('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s%s,day,,,4000,hfq' % (market, code))
                raw = ((payload.get('data') or {}).get(market + code) or {}).get('hfqday') or []
                series = [(row[0], float(row[2])) for row in raw if len(row) >= 3]
                history_source = 'Tencent backward-adjusted daily close'
                source_url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=%s%s,day,,,4000,hfq' % (market, code)
            except Exception as exc:
                source_errors.append('Tencent history: ' + str(exc))
                series = []
    if alternate is not None or len(series) < 250:
        resolved = yahoo()
        series = resolved['series']
        history_source = 'Yahoo Finance chart indicators.adjclose'
        source_url = resolved['sourceUrl']
        basis = 'provider_adjusted_close'
    series = sorted((d, v) for d, v in series if v > 0 and d <= datetime.now().strftime('%Y-%m-%d'))
    latest = series[-1][0]
    price = number(quote.get('f43'), 100)
    if price is None or price <= 0:
        raise RuntimeError('现价无效')
    quoted_at = datetime.fromtimestamp(float(quote['f86']), timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    quote_date = quoted_at[:10]
    returns = [window_return(series, latest, years) for years in WINDOWS]
    volatility, max_drawdown = risk_metrics(series, latest)
    dividend_source = 'Eastmoney implemented cash dividends by report year'
    try:
        yield_12m, dividend_years = dividend_stats(code, quote_date, price)
    except Exception as exc:
        source_errors.append('Eastmoney dividends: ' + str(exc))
        resolved = yahoo()
        cutoff = add_years(quote_date, -1)
        dividends = resolved['dividends']
        yield_12m = round(sum(float(row['amount']) for row in dividends if row.get('amount') is not None and cutoff < row['date'] <= quote_date) / price * 100, 2)
        dividend_years = None  # ex-dates do not establish fiscal reporting years.
        dividend_source = 'Yahoo Finance chart cash dividends by ex-date; fiscal years unavailable'
    market_cap = number(quote.get('f116'), 1e8, 1)
    long_term = returns[4] is not None and returns[4] >= 80 and returns[3] is not None and returns[3] > 20 and market_cap is not None and market_cap >= 500
    high_dividend = yield_12m >= 3.2 and dividend_years is not None and dividend_years >= 4
    styles = (['长期核心'] if long_term else []) + (['高股息'] if high_dividend else [])
    return {'c': code, 'n': quote.get('f58') or item.get('name') or code, 'ind': quote.get('f127') or item.get('industry') or '',
            'style': styles, 'price': price, 'chg': number(quote.get('f170'), 100),
            'mcap': market_cap, 'pe': number(quote.get('f164'), 100), 'pb': number(quote.get('f167'), 100),
            'roe': number(quote.get('f173')), 'yield12': yield_12m, 'divYears': dividend_years,
            'r': returns, 'vol5': volatility, 'mdd5': max_drawdown, 'note': item['note'], 'latest': latest,
            'priceAsOf': quoted_at, 'dividendAsOf': quote_date, 'returnAsOf': latest, 'riskAsOf': latest,
            'returnPeriods': return_periods(series, latest),
            'returnBasis': basis, 'historySource': history_source, 'sourceUrl': source_url,
            'quoteSource': quote_source, 'dividendSource': dividend_source, 'sourceFallbacks': source_errors,
            'dataStatus': 'computed', 'dividendWindow': '%d–%d' % (int(quote_date[:4]) - 5, int(quote_date[:4]) - 1) if dividend_years is not None else None,
            'fundamentalsStatus': 'report_period_unverified'}


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
    global OFFLINE
    parser = argparse.ArgumentParser(description='股票观察清单数据刷新')
    parser.add_argument('--offline', action='store_true', help='只检查已有快照，不联网')
    parser.add_argument('--only', help='限定股票代码，以逗号分隔')
    args = parser.parse_args()
    OFFLINE = args.offline
    with open(HTML, encoding='utf-8') as f:
        src = f.read()
    old = load_old_rows(src)
    if OFFLINE:
        write_status('stocks', 'cached' if old else 'unavailable', records=len(old),
                     asOf=max((row.get('latest', '') for row in old.values()), default=''),
                     message='仅保留股票快照；未下载或重算历史，复权口径尚需独立核验。')
        return 0 if old else 3
    only = {x.strip() for x in args.only.split(',') if x.strip()} if args.only else None
    if only and only - {row['code'] for row in STOCK_UNIVERSE}:
        parser.error('存在未知股票代码')
    universe = [{**x, 'name': old.get(x['code'], {}).get('n'), 'industry': old.get(x['code'], {}).get('ind')} for x in STOCK_UNIVERSE if not only or x['code'] in only]
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
                rows.append({**old[code], 'dataStatus': 'refresh_failed', 'refreshError': str(exc)})
                log('  ~ %s 获取失败，保留上一版：%s' % (code, exc))
            else:
                log('  !! %s 获取失败：%s' % (code, exc))

    expected = len(set(old) | {item['code'] for item in universe}) if only else len(STOCK_UNIVERSE)
    if len(rows) < max(1, int(expected * 0.8)):
        log('成功数据不足 80%%，放弃写回；失败：%s' % ','.join(failures))
        write_status('stocks', 'failed', records=len(rows), failures=failures, message='有效数据不足80%，保留旧数据')
        return 2
    order = {item['code']: i for i, item in enumerate(STOCK_UNIVERSE)}
    rows.sort(key=lambda row: order.get(row.get('c'), 9999))
    block = format_block(rows)
    pattern = re.compile(r'/\*__DATA_STOCKS_BEGIN__\*/.*?/\*__DATA_STOCKS_END__\*/', re.S)
    if not pattern.search(src):
        log('index.html 未找到 STOCKS 数据块，放弃写回')
        return 2
    with open(HTML, encoding='utf-8') as fh:
        src = fh.read()  # Other independent datasets may have refreshed since this job began.
    src = pattern.sub(block, src, count=1)
    tmp = HTML + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(src)
    os.replace(tmp, HTML)
    log('完成：%d 只股票，数据截至 %s' % (len(rows), rows[0].get('latest', '')))
    write_status('stocks', 'partial' if failures else 'success', mode='online', records=len(rows), failures=failures,
                 asOf=max((row.get('latest', '') for row in rows), default=''))
    return 3 if failures else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log('中断')
        sys.exit(1)
    except Exception as exc:
        write_status('stocks', 'failed', message=str(exc))
        log('股票更新失败：', exc)
        sys.exit(1)
