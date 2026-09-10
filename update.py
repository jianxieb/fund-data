#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
标普500与纳斯达克基金清单 — 每日自动更新脚本
====================================================
数据源（2026-09 实测可用）：
  1) fundf10.eastmoney.com/jjfl_<代码>.html  申购状态 / 单日累计购买上限 / 净资产规模（缓存 .tmp-fhsp/）
  2) fundmobapi FundMNFInfo                  批量净值 NAV / 日涨跌幅 NAVCHGRT（核心：涨跌幅）
  3) fundmobapi FundMNHisNetList             全量历史净值（含分红 FHFCZ，缓存 .tmp-hist/，增量合并）
     → 重算 近1/2/3/5/10年区间涨幅（红利再投口径）、近3年年化波动率、近3年最大回撤
  4) qt.gtimg.cn/q=sh513100,sz159941,...     场内ETF 现价/涨跌幅/IOPV/溢价率（快照 = "当时溢价率"）
  5) push2his.eastmoney.com kline            标普500/纳指综合/纳指100/SPY/QQQ + USDCNY 汇率（基准）

更新 index.html 中 /*__DATA_*__*/ 标记区块（FUNDS 逐行补丁、BM、META、标题日期）。

用法：
  python update.py           全量更新（历史增量合并 + 基准重算）
  python update.py --quick   跳过基准（指数/SPY/QQQ，其余全刷，日常用）
  python update.py --hist    只补历史与基准（限流缓解后回填缓存用）
  python update.py --offline 只用本地缓存（.tmp-fhsp/.tmp-hist），不联网

建议：Windows 任务计划程序每个交易日 11:30 左右（午间休市前）运行 `python update.py --quick`——
此刻能拿到最新已公布净值/涨跌幅（QDII T+1）、当日申购限额/状态与场内 ETF 上午快照价/溢价率，
正好用于判断当天是否买入；需要当天完整净值可再加一次 15:30 的运行。
"""
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'index.html')
FHSP_DIR = os.path.join(HERE, '.tmp-fhsp')
HIST_DIR = os.path.join(HERE, '.tmp-hist')
UA = {'User-Agent': 'Mozilla/5.0'}  # fundmobapi 对完整桌面 UA 会返回 61136403 网络繁忙
OFFLINE = False

# 近N年窗口
WINDOWS = [1, 2, 3, 5, 10]
# 基准 secid（失败按顺序尝试；None 表示不适用）
BM_DEFS = [
    ('标普500指数', '指数·价格', ['100.SPX'], '价格口径，未含分红', 0),
    ('纳斯达克综合指数', '指数·价格', ['100.COMPX', '100.IXIC'], '价格口径', 0),
    ('纳斯达克100指数', '指数·价格', ['100.NDX'], '价格口径', 0),
    ('SPY', '美股ETF', ['106.SPY', '107.SPY', '105.SPY'], '标普500ETF，前复权含分红', 1),
    ('QQQ', '美股ETF', ['105.QQQ'], '纳指100ETF，前复权含分红', 1),
]
FX_SECIDS = ['133.USDCNY', '119.USDCNY', '133.USDCNH']  # 在岸优先，离岸兜底


def log(*a):
    try:
        print(*a, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode('gbk', 'replace').decode('gbk') for x in a], flush=True)


def http_get(url, referer=None, tries=6, delay=2.0, timeout=25):
    """带重试的 GET，返回解码后的文本；彻底失败返回 None。"""
    if OFFLINE:
        return None
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=dict(UA, **( {'Referer': referer} if referer else {})))
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError:
                return raw.decode('gbk', 'replace')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(delay * (1 + 0.7 * i))
    log('  !! 请求失败（%d 次）: %s (%s)' % (tries, last, url[:90]))
    return None


def get_json(url, referer=None, tries=4, delay=1.5):
    t = http_get(url, referer, tries, delay)
    if t is None:
        return None
    try:
        return json.loads(t)
    except Exception as e:  # noqa: BLE001
        log('  !! JSON 解析失败: %s (%s)' % (e, url[:90]))
        return None


def add_years(dstr, n):
    d = datetime.strptime(dstr, '%Y-%m-%d')
    y, m, dd = d.year + n, d.month, d.day
    while True:
        try:
            return datetime(y, m, dd).strftime('%Y-%m-%d')
        except ValueError:
            dd -= 1


# ---------------------------------------------------------------- 基金解析
def parse_fund_lines(src):
    """从 index.html 提取 FUNDS 数组：返回 [(行文本, code, is_etf), ...]"""
    m = re.search(r'/\*__DATA_FUNDS_BEGIN__\*/(.*?)/\*__DATA_FUNDS_END__\*/', src, re.S)
    body = m.group(1)
    out = []
    for line in body.splitlines():
        cm = re.search(r"c:'(\d{6})'", line)
        if not cm:
            continue
        code = cm.group(1)
        # 场内ETF：无 t 字段，或 t:'场内ETF'（标普500四只）
        is_etf = ("t:'" not in line) or ("t:'场内ETF'" in line)
        out.append((line, code, is_etf))
    return out


def patch_field(line, name, literal):
    """替换行内已有字段值，若无则插入到 ,note: 前 / } 前。"""
    pat = re.compile(r'\b' + re.escape(name) + r"\s*:\s*(?:'[^']*'|-?\d+(?:\.\d+)?|\[[^\]]*\]|null|true|false)")
    m = pat.search(line)
    if m:
        return line[:m.start()] + name + ':' + literal + line[m.end():]
    idx = line.rfind(',note:')
    if idx >= 0:
        return line[:idx] + ',' + name + ':' + literal + line[idx:]
    idx = line.rfind('}')
    return line[:idx] + ',' + name + ':' + literal + line[idx:]


def fnum(v, nd=4):
    if v is None:
        return 'null'
    return ('%.' + str(nd) + 'f') % float(v)


# ---------------------------------------------------------------- jjfl 页面
def jjfl_parse(html):
    """解析 fundf10 jjfl 页面：返回 {st, lm, sz, szdate, nav, navdate, dz}"""
    out = {'st': None, 'lm': None, 'sz': None, 'szdate': None, 'nav': None, 'navdate': None, 'dz': None}
    m = re.search(r'交易状态：<span>([^<]+?)</span>', html)
    if m:
        st = m.group(1).strip()
        if '暂停' in st:
            out['st'] = '暂停'
        elif '限大额' in st or '限制' in st:
            out['st'] = '限大额'
        else:
            out['st'] = '开放'
    m = re.search(r'单日累计购买上限([^<]+)', html)
    if m:
        out['lm'] = m.group(1).strip()
        if out['st'] == '开放':  # 有上限说明实为限大额
            out['st'] = '限大额'
        if out['st'] == '暂停':  # 暂停申购不展示限额（页面层显示 --）
            out['lm'] = None
    else:
        out['lm'] = None
    m = re.search(r'净资产规模：<span>\s*([\d.]+)\s*亿元\s*（截止至：(\d{4}-\d{2}-\d{2})）', html)
    if m:
        out['sz'] = float(m.group(1))
        out['szdate'] = m.group(2)
    # 单位净值（MM-DD）：x.xxxx ( y.yy% ) —— FundMNFInfo 被限流时的兜底
    m = re.search(r'单位净值（(\d{2}-\d{2})）[：:]\s*<b[^>]*>\s*([\d.]+)\s*\(\s*([+-]?[\d.]+)\s*%\s*\)', html, re.S)
    if m:
        mmdd = m.group(1)
        today = datetime.now()
        y = today.year if (today.month, today.day) >= tuple(map(int, mmdd.split('-'))) else today.year - 1
        out['nav'] = float(m.group(2))
        out['navdate'] = '%d-%s' % (y, mmdd)
        out['dz'] = float(m.group(3))
    return out


def jjfl_fetch(code):
    cache = os.path.join(FHSP_DIR, '%s.html' % code)
    html = http_get('https://fundf10.eastmoney.com/jjfl_%s.html' % code,
                    referer='https://fundf10.eastmoney.com/', tries=4, delay=1.2)
    if html is not None:
        try:
            with open(cache, 'w', encoding='utf-8') as f:
                f.write(html)
        except OSError:
            pass
    elif os.path.exists(cache):
        with open(cache, encoding='utf-8', errors='replace') as f:
            html = f.read()
        log('  ~ %s jjfl 网络失败，用缓存' % code)
    if not html:
        return {}
    return jjfl_parse(html)


# ---------------------------------------------------------------- 净值/涨跌幅
def fund_mnfinfo(codes):
    """批量净值：{code:{nav,navdate,dz,price,pct}}；网络繁忙（ErrCode!=0）时等待重试。"""
    out = {}
    for attempt in range(2):
        got = False
        for i in range(0, len(codes), 15):
            chunk = codes[i:i + 15]
            url = ('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=20'
                   '&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=' + ','.join(chunk))
            d = get_json(url, tries=3, delay=2.0)
            if not d or not d.get('Datas') or d.get('ErrCode'):
                continue
            got = True
            for r in d['Datas']:
                c = r.get('FCODE')
                if not c:
                    continue
                def fl(v):
                    try:
                        return float(v)
                    except (TypeError, ValueError):
                        return None
                out[c] = {'nav': fl(r.get('NAV')), 'navdate': r.get('PDATE'),
                          'dz': fl(r.get('NAVCHGRT')), 'price': fl(r.get('NEWPRICE')),
                          'pct': fl(r.get('CHANGERATIO'))}
            time.sleep(1.2)
        if got:
            return out
        log('  ~ FundMNFInfo 网络繁忙，30 秒后重试…')
        time.sleep(30)
    return out


# ---------------------------------------------------------------- 历史净值
def fhsp_fetch(code):
    """分红送配页 → {除息日: 每份分红}（缓存 .tmp-fhsp/fhsp_<code>.html，7 天内不重复抓取）。"""
    cache = os.path.join(FHSP_DIR, 'fhsp_%s.html' % code)
    fresh = os.path.exists(cache) and (time.time() - os.path.getmtime(cache)) < 7 * 86400
    html = None
    if not fresh and not OFFLINE:
        html = http_get('https://fundf10.eastmoney.com/fhsp_%s.html' % code,
                        referer='https://fundf10.eastmoney.com/', tries=3, delay=1.5)
        if html is not None:
            try:
                with open(cache, 'w', encoding='utf-8') as f:
                    f.write(html)
            except OSError:
                pass
    if html is None and os.path.exists(cache):
        with open(cache, encoding='utf-8', errors='replace') as f:
            html = f.read()
    if not html:
        return {}
    divs = {}
    for m in re.finditer(r'<td>(\d{4}-\d{2}-\d{2})</td><td>每10份派现金([\d.]+)元</td>', html):
        try:
            divs[m.group(1)] = float(m.group(2)) / 10.0
        except ValueError:
            continue
    return divs


def history_fetch(code):
    cache = os.path.join(HIST_DIR, '%s.json' % code)
    old = {}
    if os.path.exists(cache):
        try:
            with open(cache, encoding='utf-8') as f:
                old = {r.get('FSRQ'): r for r in json.load(f)}
        except Exception:  # noqa: BLE001
            old = {}
    rows = None
    if not OFFLINE:
        # 有缓存 → 先取最近 20 行做增量；无缓存或缺口 → 全量
        for full in ([False, True] if old else [True]):
            ps = '10000' if full else '20'
            url = ('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?FCODE=%s&pageIndex=1&pageSize=%s'
                   '&startDate=&endDate=&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1' % (code, ps))
            for attempt in range(2):
                d = get_json(url, tries=3, delay=2.0)
                if d and d.get('Datas'):
                    break
                if d and d.get('ErrCode'):
                    time.sleep(15)
                else:
                    time.sleep(6)
            else:
                d = None
            if d and d.get('Datas'):
                r0 = d['Datas']
                if not full and r0 and old and r0[-1].get('FSRQ', '9999') <= max(old):
                    rows = r0  # 增量已覆盖
                    break
                if full:
                    rows = r0
                    break
            time.sleep(1.0)
    if not rows:
        if old:
            log('  ~ %s 历史接口失败，用缓存（%d 行）' % (code, len(old)))
            return sorted(old.values(), key=lambda r: r.get('FSRQ') or '', reverse=True)
        log('  !! %s 历史无数据且无缓存' % code)
        return None
    for r in rows:
        if r.get('FSRQ'):
            old[r['FSRQ']] = r
    merged = sorted(old.values(), key=lambda r: r.get('FSRQ') or '', reverse=True)
    # 新版历史接口不再返回分红字段，用分红送配页补上（红利再投复权必需）
    divs = fhsp_fetch(code)
    if divs:
        for r in merged:
            d = divs.get(r.get('FSRQ'))
            if d is not None:
                r['FHFCZ'] = '%.4f' % d
                r['FHFCZ10'] = '%.4f' % (d * 10)
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False)
    return merged


def calc_metrics(rows):
    """由历史行（含分红）计算：r{1,2,3,5,10年区间涨幅%}、v3、mdd3。无数据返回 None。
    口径：有分红的基金按 单位净值+每份分红 红利再投复权；无分红基金按 累计净值 复权
    （累计净值已含份额折算/拆分调整，避免 ETF 拆分造成假暴跌）。"""
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r.get('FSRQ') or '')
    has_div = any((r.get('FHFCZ') or '').strip() for r in rows)
    ser = []  # (date, dwjz, T)
    T = 1.0
    for i, r in enumerate(rows):
        try:
            dwjz = float(r.get('DWJZ'))
        except (TypeError, ValueError):
            continue
        try:
            ljjz = float(r.get('LJJZ') or dwjz)
        except (TypeError, ValueError):
            ljjz = dwjz
        try:
            fhfcz = float(r.get('FHFCZ') or 0)
        except (TypeError, ValueError):
            fhfcz = 0.0
        if i > 0 and ser:
            prev_dw, prev_lj = ser[-1][1], ser[-1][3]
            if has_div:
                if fhfcz > 0 and prev_dw > 0:
                    drop = prev_dw - dwjz
                    if drop > 0 and abs(drop - fhfcz) / prev_dw < 0.02:
                        # 除息日净值确已下跳≈分红金额：红利再投复权
                        T *= (dwjz + fhfcz) / prev_dw
                    else:
                        # 净值序列已复权（如部分ETF分红不除息）：直接比，避免重复计分红
                        T *= dwjz / prev_dw
                elif prev_dw > 0:
                    T *= dwjz / prev_dw
            elif prev_lj > 0:
                T *= ljjz / prev_lj
        ser.append((r.get('FSRQ'), dwjz, T, ljjz))
    if len(ser) < 2:
        return None
    latest = ser[-1][0]
    Tend = ser[-1][2]
    out = {'r': []}
    for n in WINDOWS:
        b = add_years(latest, -n)
        base = None
        for date, dwjz, t, lj in ser:
            if date <= b:
                base = t
            else:
                break
        out['r'].append(None if base is None else (Tend / base - 1) * 100)
    # 近3年 波动率/回撤（基于复权序列 T）
    b3 = add_years(latest, -3)
    win = [t for date, dwjz, t, lj in ser if date > b3 and t > 0]
    if len(win) > 150:
        import math
        lr = [math.log(win[i] / win[i - 1]) for i in range(1, len(win))]
        mean = sum(lr) / len(lr)
        var = sum((x - mean) ** 2 for x in lr) / (len(lr) - 1)
        out['v3'] = math.sqrt(var) * math.sqrt(250) * 100
        peak, mdd = win[0], 0.0
        for t in win:
            peak = max(peak, t)
            mdd = min(mdd, t / peak - 1)
        out['mdd3'] = mdd * 100
    else:
        out['v3'] = None
        out['mdd3'] = None
    return out


# ---------------------------------------------------------------- 场内行情
def tencent_etf(codes):
    """腾讯行情批量：{code:{price,pct,prem,iopv,time}}"""
    out = {}
    if not codes:
        return out
    qs = ','.join(('sh' if c[0] == '5' else 'sz') + c for c in codes)
    t = http_get('https://qt.gtimg.cn/q=' + qs + '&r=' + str(int(time.time() * 1000)),
                 tries=4, delay=1.0)
    if not t:
        return out
    for m in re.finditer(r'v_(\w{2}\d{6})="([^"]*)"', t):
        key = m.group(1)
        a = m.group(2).split('~')
        if len(a) < 82:
            continue
        try:
            price = float(a[3])
            pct = float(a[32])
            prem = float(a[77])   # 溢价率% = (现价-IOPV)/IOPV
            iopv = float(a[78])   # IOPV
        except (ValueError, IndexError):
            continue
        qtime = a[30]
        if re.fullmatch(r'\d{14}', qtime):
            qtime = '%s-%s-%s %s:%s:%s' % (qtime[0:4], qtime[4:6], qtime[6:8],
                                           qtime[8:10], qtime[10:12], qtime[12:14])
        out[key[-6:]] = {'price': price, 'prem': prem, 'iopv': iopv,
                         'pct': pct, 'time': qtime}
    return out


# ---------------------------------------------------------------- 基准
def kline_closes(secids, end, fqt=0, need=3000):
    ut = 'fa5fd1943c7b386f172d6893dbfba10b'
    last = None
    for s in secids:
        url = ('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=%s&ut=%s'
               '&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=%d&end=20500101&lmt=%d'
               % (s, ut, fqt, need))
        d = get_json(url, referer='https://quote.eastmoney.com/', tries=6, delay=3.0)
        if d and d.get('data') and d['data'].get('klines'):
            return [(k.split(',')[0], float(k.split(',')[1])) for k in d['data']['klines']]
        last = s
        time.sleep(2.0)
    log('  !! 基准行情失败: %s' % last)
    return None


# push2his 被限流时的备用源：新浪美股日线（含 SPY/QQQ，价格口径未复权）
SINA_SYM = {'标普500指数': '.INX', '纳斯达克综合指数': '.IXIC',
            '纳斯达克100指数': '.NDX', 'SPY': 'spy', 'QQQ': 'qqq'}
SINA_NOTE = {'标普500指数': '价格口径，未含分红（Sina）',
             '纳斯达克综合指数': '价格口径（Sina）',
             '纳斯达克100指数': '价格口径（Sina）',
             'SPY': '标普500ETF，价格口径（Sina，未复权）',
             'QQQ': '纳指100ETF，价格口径（Sina，未复权）'}


def sina_us_kline(symbol):
    url = ('https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20_X='
           '/US_MinKService.getDailyK?symbol=' + symbol + '&___qn=3')
    t = http_get(url, referer='https://stock.finance.sina.com.cn/', tries=4, delay=1.5)
    if not t:
        return None
    m = re.search(r'=\((\[.*\])\)', t, re.S)
    if not m:
        return None
    try:
        arr = json.loads(m.group(1))
    except Exception:  # noqa: BLE001
        return None
    return [(r['d'], float(r['c'])) for r in arr if r.get('d') and r.get('c')]


def bench_compute(anchor, fx_old=None):
    """按最新净值日 anchor 计算基准：usd/cny 各期涨幅与 fx 汇率变动。任一基准缺失则整体返回 None（保留原值，避免行错位）。
    行情源：push2his（前复权）优先，失败降级到新浪美股日线（价格口径）。
    汇率接口失败时沿用上一版各期汇率变动，保证人民币口径可算。"""
    closes = {}
    sina_used = set()
    for name, tp, secids, note, fqt in BM_DEFS:
        k = kline_closes(secids, anchor, fqt)
        if not k and name in SINA_SYM:
            k = sina_us_kline(SINA_SYM[name])
            if k:
                sina_used.add(name)
                log('  ~ %s push2his 失败，已用新浪日线兜底' % name)
        if k:
            closes[name] = k
        time.sleep(1.5)
    if len(closes) != len(BM_DEFS):
        log('  !! 基准缺失（%d/%d），整体保留原值' % (len(closes), len(BM_DEFS)))
        return None
    fxk = kline_closes(FX_SECIDS, anchor, 0)
    def at(clist, dstr):
        best = None
        for date, v in clist:
            if date <= dstr:
                best = v
            else:
                break
        return best
    end = anchor
    bases = [add_years(end, -n) for n in WINDOWS]
    bm = []
    for name, tp, secids, note, fqt in BM_DEFS:
        if name not in closes:
            continue
        cl = closes[name]
        cend = at(cl, end)
        usd = [None if (cend is None or at(cl, b) is None) else (cend / at(cl, b) - 1) * 100 for b in bases]
        if name in sina_used:
            note = SINA_NOTE.get(name, note + '（Sina价格口径）')
        bm.append({'n': name, 'tp': tp, 'usd': usd, 'note': note})
    fx = [None] * len(WINDOWS)
    if fxk:
        fend = at(fxk, end)
        for i, b in enumerate(bases):
            fb = at(fxk, b)
            if fend and fb:
                fx[i] = (fb / fend - 1) * 100
    # 汇率接口失败：沿用上一版各期汇率变动，保证人民币口径可算
    if fx_old:
        try:
            fo = [float(x) for x in fx_old]
            if len(fo) == len(fx):
                for i, v in enumerate(fx):
                    if v is None:
                        fx[i] = fo[i]
        except (TypeError, ValueError):
            pass
    for row in bm:
        row['cny'] = [None if (u is None or fx[i] is None) else ((1 + u / 100) * (1 + fx[i] / 100) - 1) * 100
                      for i, u in enumerate(row['usd'])]
    # 补全顺序与 BM 表一致
    bmmap = {r['n']: r for r in bm}
    return {'bm': [bmmap.get(d[0]) for d in BM_DEFS if bmmap.get(d[0])], 'fx': fx}


# ---------------------------------------------------------------- 写回
def write_patches(fund_patches, bench, meta, quick):
    with open(HTML, encoding='utf-8') as f:
        src = f.read()
    lines = src.splitlines(keepends=True)
    changed = 0
    for idx, l in enumerate(lines):
        cm = re.search(r"c:'(\d{6})'", l)
        if not cm or cm.group(1) not in fund_patches:
            continue
        line = l
        for name, literal in fund_patches[cm.group(1)].items():
            line = patch_field(line, name, literal)
        if line != l:
            lines[idx] = line
            changed += 1
    src = ''.join(lines)
    # BM 块
    if bench:
        m = re.search(r'(/\*__DATA_BM_BEGIN__\*/\n)(.*?)(\n/\*__DATA_BM_END__\*/)', src, re.S)
        if m:
            rows = [' {n:%s,tp:%s,usd:%s,cny:%s,note:%s},' % (
                json.dumps(b['n'], ensure_ascii=False), json.dumps(b['tp'], ensure_ascii=False),
                '[' + ','.join(fnum(v) for v in b['usd']) + ']',
                '[' + ','.join(fnum(v) for v in b['cny']) + ']',
                json.dumps(b['note'], ensure_ascii=False)) for b in bench['bm'] if b]
            src = src[:m.start()] + m.group(1) + 'var BM=[\n' + '\n'.join(rows) + '\n];' + m.group(3) + src[m.end():]
            log('  ✓ 基准 BM 已更新（%d 条）' % len(rows))
    # META 块
    m = re.search(r'(/\*__DATA_META_BEGIN__\*/\n)(.*?)(\n/\*__DATA_META_END__\*/)', src, re.S)
    if m:
        fx = bench['fx'] if bench and all(v is not None for v in bench['fx']) else meta.get('fx_old')
        fx = [fnum(v) for v in fx]
        meta_lit = ('var META={gen:%s,navdate:%s,snpdate:%s,snptime:%s,szdate:%s,fx:[%s]};' % (
            json.dumps(meta['gen'], ensure_ascii=False),
            json.dumps(meta['navdate'], ensure_ascii=False),
            json.dumps(meta['snpdate'], ensure_ascii=False),
            json.dumps(meta['snptime'], ensure_ascii=False),
            json.dumps(meta['szdate'], ensure_ascii=False),
            ','.join(fx)))
        src = src[:m.start()] + m.group(1) + meta_lit + m.group(3) + src[m.end():]
    # 标题日期
    src = re.sub(r'(<title>.*?（)\d{4}-\d{2}-\d{2}(）</title>)',
                 lambda mm: mm.group(1) + meta['gen'][:10] + mm.group(2), src, count=1)
    with open(HTML, 'w', encoding='utf-8') as f:
        f.write(src)
    log('  ✓ FUNDS 更新 %d 行，META/标题已写回' % changed)


def read_old_meta(src):
    m = re.search(r'var META=\{([^}]*)\};', src)
    out = {}
    if m:
        for k, vq, vd, vl in re.findall(r"(\w+):(?:\"([^\"]*)\"|'([^']*)'|\[([^\]]*)\])", m.group(1)):
            if vq or vd:
                out[k] = vq or vd
            elif vl:
                out[k] = [x.strip() or 'null' for x in vl.split(',')]
    return out


# ---------------------------------------------------------------- Markdown
def write_md(src):
    """由 index.html 数据块重新生成 标普500与纳斯达克基金清单.md"""
    md = os.path.join(HERE, '标普500与纳斯达克基金清单.md')
    lines = [l for l in src.splitlines(keepends=True)]
    fund_rows = {}
    for l in lines:
        cm = re.search(r"\{g:'(sp|nq|etf|nx)',c:'(\d{6})',n:'([^']*)',(?:t:'([^']*)',)?ix:'([^']*)',d:'([^']*)',fee:\[([^\]]*)\],", l)
        if not cm:
            continue
        code = cm.group(2)
        g = cm.group(1)
        def fg(name):
            m2 = re.search(r"\b" + name + r":\s*('([^']*)'|-?\d+(?:\.\d+)?|\[[^\]]*\]|null)", l)
            return m2.group(2) if m2 and m2.group(2) is not None else (m2.group(1) if m2 else '')
        fund_rows[code] = {
            'g': g, 'c': code, 'n': cm.group(3), 't': cm.group(4) or '', 'ix': cm.group(5), 'd': cm.group(6),
            'fee': cm.group(7), 'buy': fg('buy'), 'rd': fg('rd'), 'st': fg('st'), 'lm': fg('lm'),
            'r': [x.strip() for x in fg('r').strip('[]').split(',')],
            'sz': fg('sz'), 'nav': fg('nav'), 'navdate': fg('navdate'), 'dz': fg('dz'),
            'p': fg('p'), 'prem': fg('prem'), 'note': fg('note'),
        }
    m = re.search(r'var META=\{([^}]*)\};', src)
    meta = {}
    if m:
        for k, vq, vd, vl in re.findall(r"(\w+):(?:\"([^\"]*)\"|'([^']*)'|\[([^\]]*)\])", m.group(1)):
            meta[k] = vq or vd or vl
    if not meta:
        meta = {'gen': '', 'navdate': '', 'snpdate': '', 'snptime': ''}
    def pct(v):
        v = v.strip()
        if not v or v == 'null':
            return '--'
        f = float(v)
        return ('+%.2f%%' if f >= 0 else '%.2f%%') % f
    def ann(v, n):
        v = v.strip()
        if not v or v == 'null':
            return '--'
        f = float(v)
        return ('+%.2f%%' if f >= 0 else '%.2f%%') % ((1 + f / 100) ** (1 / n) - 1) * 100
    def row(code, comm):
        f = fund_rows[code]
        is_etf = (f['t'] == '') or (f['t'] == '场内ETF')
        r = f['r'] + [''] * (5 - len(f['r']))
        st = {'暂停': '暂停申购', '限大额': '限大额', '开放': '开放申购'}.get(f['st'], f['st'])
        st = '--' if is_etf else (st or '--')
        lm = '--' if f['st'] == '暂停' else (f['lm'] or '--')
        buy = comm if is_etf else (f['buy'] or '--')
        rd = comm if is_etf else (f['rd'] or '--')
        nav = ('%s (%.4f%s)' % (f['navdate'], float(f['nav']), ('%+.2f%%' % float(f['dz'])) if f['dz'] and f['dz'] != 'null' else '')) if f['nav'] and f['nav'] != 'null' else '--'
        if is_etf:
            prem = ('（%+.2f%%）' % float(f['prem'])) if f['prem'] and f['prem'] != 'null' else ''
            price = '%s%s' % (f['p'] if f['p'] and f['p'] != 'null' else '--', prem)
        else:
            price = '--'
        return '| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            f['c'], f['n'], f['t'] or '场内ETF', f['ix'], f['d'], f['fee'].replace(',', '/'), buy, rd, st, lm,
            pct(r[0]), pct(r[1]), pct(r[2]), pct(r[3]), pct(r[4]), nav, price, f['sz'])
    def tbl(title, ids, comm):
        head = ('| 代码 | 名称 | 类别 | 跟踪指数 | 成立 | 年费 | 买入费用 | 卖出费用 | 申购状态 | 日限额 | '
                '近1年 | 近2年 | 近3年 | 近5年 | 近10年 | 净值/日涨跌 | 盘中价(溢价率) | 规模(亿) |')
        sep = '|' + '---|' * 18
        return '## %s\n\n%s\n%s\n' % (title, head, sep) + '\n'.join(row(c, comm) for c in ids) + '\n'
    sp = [c for c, f in fund_rows.items() if f['g'] == 'sp']
    nq = [c for c, f in fund_rows.items() if f['g'] == 'nq']
    etf = [c for c, f in fund_rows.items() if f['g'] == 'etf']
    nxo = [c for c, f in fund_rows.items() if f['g'] == 'nx' and f['t']]
    nxe = [c for c, f in fund_rows.items() if f['g'] == 'nx' and not f['t']]
    out = []
    out.append('# 标普500 与 纳斯达克 基金清单\n')
    out.append('> 生成时间：%s ｜ 净值数据截至：**%s**（QDII T+1）；场内 ETF 另有当日盘中价（%s %s 快照，括号为当时溢价率）\n' % (
        meta.get('gen', ''), meta.get('navdate', ''), meta.get('snpdate', ''), meta.get('snptime', '')))
    out.append('> 数据来源：天天基金/东方财富公开接口 + 腾讯行情（IOPV/溢价率）｜ 由 update.py 自动更新，仅供研究参考，不构成投资建议。\n')
    out.append('\n## 口径说明\n\n'
               '1. **份额筛选**：同一基金有 A/C 份额的只保留 **A 类**；C/D/E/I 与美元份额剔除。\n'
               '2. **区间涨幅**：滚动近N年（最新净值日回推），按累计净值含分红再投资计算；国泰纳指100、大成标普500等权重按红利再投逐笔复权。成立不足 N 年标注 "--"。\n'
               '3. **年化收益率** = (1+区间涨幅)^(1/N)−1（页面/CSV 可切换显示）。\n'
               '4. **场内溢价率** = (盘中价−IOPV)/IOPV（腾讯行情口径）；QDII 净值 T+1 公布，溢价率可能失真，请对照 IOPV。\n'
               '5. **日限额** = 单日累计申购上限；**暂停申购的基金不显示日限额**；场内 ETF 的申购状态/日限额显示 --（场内买卖不受申赎通道限制）。\n'
               '6. **买入/卖出费用**：场外=申购费（原费率/1折）与赎回费档（按持有期递减）；场内=券商佣金（默认万2.5、最低5元，买卖同费率，免印花税/过户费）。\n'
               '7. **风险收益**：近3年年化波动率（日收益标准差×√250）× 近3年年化收益率，气泡=规模。\n')
    comm = '≈%.2f' % max(2.5, 5.0)  # 默认万2.5/最低5元，与页面默认一致
    out.append(tbl('一、标普500 基金（%d 只）' % len(sp), sp, comm))
    out.append(tbl('二、纳斯达克100 基金 — 场外（%d 只）' % len(nq), nq, comm))
    out.append(tbl('三、纳斯达克100 基金 — 场内 ETF（%d 只）' % len(etf), etf, comm))
    out.append(tbl('四、其他纳斯达克指数基金 — 场外（%d 只）' % len(nxo), nxo, comm))
    out.append(tbl('五、其他纳斯达克指数基金 — 场内 ETF（%d 只）' % len(nxe), nxe, comm))
    out.append('\n## 备注\n\n'
               '- ★ 国泰纳斯达克100（160213）：2025 年四次大额分红 + 2020-01 分红，收益按红利再投资逐笔复权。\n'
               '- ★ 大成标普500等权重A（096001）：每年分红（窗口内 10 次），收益按红利再投逐笔复权。\n'
               '- ⚠ 建信纳斯达克100（539001）：2010-2021 为主动型 QDII"建信全球机遇"，2021 转型跟踪纳指100；近5/10年含主动管理阶段，不可直接比较。\n'
               '- ⚠ 标普500ETF博时（513500）：2022-03-29 做过 1:2 份额拆分，收益已按拆分复权核对。\n')
    with open(md, 'w', encoding='utf-8') as f:
        f.write(''.join(out))
    log('  ✓ Markdown 清单已重新生成')


# ---------------------------------------------------------------- main
def main():
    global OFFLINE
    quick = '--quick' in sys.argv
    offline = '--offline' in sys.argv
    hist_only = '--hist' in sys.argv  # 只补历史/基准（限流缓解后回填缓存用）
    if offline:
        OFFLINE = True
        log('== 离线模式：只用缓存（.tmp-fhsp / .tmp-hist） ==')
    with open(HTML, encoding='utf-8') as f:
        src = f.read()
    old_meta = read_old_meta(src)
    funds = parse_fund_lines(src)
    codes = [c for _, c, _ in funds]
    etf_codes = [c for _, c, e in funds if e]
    log('基金 %d 只（场内 %d 只）' % (len(funds), len(etf_codes)))

    now = datetime.now()
    gen = now.strftime('%Y-%m-%d') + (' 盘中' if (9, 30) <= (now.hour, now.minute) <= (15, 5) else ' 收盘后')

    # 节流：fundmobapi 对快速连发会限流，先打净值/历史，再打 fundf10
    patches = {c: {} for _, c, _ in funds}

    # 1) 批量净值/涨跌幅（失败时用 jjfl 页面兜底）
    navdates = [old_meta.get('navdate')]
    mn = {}
    if not offline and not hist_only:
        mn = fund_mnfinfo(codes)
    if not hist_only:
        for code, p in patches.items():
            r = mn.get(code)
            if r and r.get('nav') is not None:
                p['nav'] = fnum(r['nav'])
                if r.get('navdate'):
                    p['navdate'] = "'%s'" % r['navdate']
                    navdates.append(r['navdate'])
                if r.get('dz') is not None:
                    p['dz'] = fnum(r['dz'], 2)
    if not offline and not hist_only and not mn:
        log('  !! FundMNFInfo 失败，稍后用 jjfl 页面兜底净值/涨跌幅')
    time.sleep(2)

    # 2) 历史 → 区间涨幅/年化波动率/回撤（--quick 也跑：增量取最近20行，窗口每日滑动）
    busy_streak = 0
    for _, code, _ in funds:
        rows = history_fetch(code)
        if rows is None:
            busy_streak += 1
            if busy_streak >= 3:
                log('  !! 历史接口连续受限（网络繁忙），本次跳过剩余基金；改日再跑会自动补齐缓存')
                break
            continue
        busy_streak = 0
        met = calc_metrics(rows)
        if not met:
            continue
        p = patches[code]
        p['r'] = '[' + ','.join(fnum(v, 2) for v in met['r']) + ']'
        if met.get('v3') is not None:
            p['v3'] = fnum(met['v3'], 2)
        if met.get('mdd3') is not None:
            p['mdd3'] = fnum(met['mdd3'], 2)
        time.sleep(1.0)
    time.sleep(3)

    # 3) jjfl：状态/限额/规模（+ 净值兜底）
    jjnav = {}  # FundMNFInfo 失败时的净值兜底
    szdates = []
    if not hist_only:
        for _, code, is_etf in funds:
            if offline and not os.path.exists(os.path.join(FHSP_DIR, '%s.html' % code)):
                continue
            jj = jjfl_fetch(code)
            p = patches[code]
            if not is_etf:
                if jj.get('st'):
                    p['st'] = "'%s'" % jj['st']
                if jj.get('st') != '暂停':
                    p['lm'] = "'%s'" % (jj.get('lm') or '--')
            if jj.get('sz') is not None:
                p['sz'] = fnum(jj['sz'], 1)
                szdates.append(jj['szdate'])
            if jj.get('nav') is not None:
                jjnav[code] = jj
                if code not in mn:
                    p['nav'] = fnum(jj['nav'])
                    p['navdate'] = "'%s'" % jj['navdate']
                    navdates.append(jj['navdate'])
                    p['dz'] = fnum(jj['dz'], 2)
            time.sleep(0.5)
    szdate = max(set(szdates), key=szdates.count) if szdates else (old_meta.get('szdate') or '')
    # 净值日期取众数（个别基金公布节奏不同，避免带偏整体口径）
    navdate = max(set(navdates), key=navdates.count) if navdates else ''

    # 4) 场内行情快照（当时溢价率）
    snpdate, snptime = old_meta.get('snpdate', ''), old_meta.get('snptime', '')
    if not offline and not hist_only:
        tq = tencent_etf(etf_codes)
        if tq:
            snpdate = now.strftime('%Y-%m-%d')
            snptime = sorted((v['time'] for v in tq.values() if v.get('time')))[-1][-8:] if any(v.get('time') for v in tq.values()) else now.strftime('%H:%M')
        for code in etf_codes:
            r = tq.get(code)
            if not r:
                continue
            p = patches[code]
            p['p'] = fnum(r['price'], 3)
            p['prem'] = fnum(r['prem'], 2)
            p['pct'] = fnum(r['pct'], 2)
            p['iopv'] = fnum(r['iopv'], 3)
    else:
        tq = {}

    # 5) 基准
    bench = None
    if not quick and not offline:
        bench = bench_compute(navdate or now.strftime('%Y-%m-%d'), old_meta.get('fx'))
        if not bench:
            log('  !! 基准获取失败，保留原值')

    meta = {'gen': gen, 'navdate': navdate or '', 'snpdate': snpdate or now.strftime('%Y-%m-%d'),
            'snptime': snptime or now.strftime('%H:%M'), 'szdate': szdate,
            'fx_old': old_meta.get('fx') or [0, 0, 0, 0, 0]}
    write_patches(patches, bench, meta, quick)
    with open(HTML, encoding='utf-8') as f:
        write_md(f.read())
    log('完成：净值截至 %s ｜ 生成 %s ｜ 场内快照 %s %s' % (navdate, gen, snpdate, snptime))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log('中断')
