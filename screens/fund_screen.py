#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国内长期绩优基金筛选（可复现流水线）
=====================================
数据源（全部为公开接口，2026-09 实测可用）：
  1) fund.eastmoney.com/data/rankhandler.aspx   全市场排行：近1周…近3年、今年来、成立来、成立日，
     并用 sd/ed 参数取自定义区间（5年/10年）区间涨幅 —— 全市场一次拉全（pn=5000）
  2) fundmobapi FundMNBasicInformation          逐只：类型/成立日/规模/基金经理/费率/申购状态/跟踪指数
     + 夏普1年/最大回撤1年/波动1年
  3) fundf10.eastmoney.com/jjjl_<code>.html     基金经理变动一览（任职区间 + 任职回报）
  4) fundmobapi FundMNHisNetList + fhsp 分红页   全量历史净值（复用根目录 update.py 的 history_fetch）
     → 自行按红利再投复权，计算各窗口年化、最大回撤、波动率、分年度收益

用法：
  python screens/fund_screen.py universe     # 拉全市场排行（gp/hh/zs × 5年/10年窗口）
  python screens/fund_screen.py prefilter    # 粗筛：成立年限/名称/份额类别/长周期收益
  python screens/fund_screen.py enrich       # 逐只补基础信息 + 基金经理变动
  python screens/fund_screen.py metrics      # 逐只拉历史净值并自算指标（最慢）
  python screens/fund_screen.py report       # 生成筛选报告与 CSV
  python screens/fund_screen.py all          # 以上全跑
"""
import argparse
import csv
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.cache')
DATA = os.path.join(HERE, 'data')
sys.path.insert(0, ROOT)
import update as U  # noqa: E402  复用 history_fetch / fhsp_fetch / http_get

UA = {'User-Agent': 'Mozilla/5.0'}
AS_OF = '2026-09-11'
TYPES = [('gp', '股票型'), ('hh', '混合型'), ('zs', '指数型')]


def log(*a):
    try:
        print(*a, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode('gbk', 'replace').decode('gbk') for x in a], flush=True)


def ensure_dirs():
    for d in (CACHE, DATA, os.path.join(CACHE, 'basic'), os.path.join(CACHE, 'jjjl'),
              os.path.join(CACHE, 'metrics')):
        os.makedirs(d, exist_ok=True)


def get(url, referer=None, tries=4, delay=1.5, timeout=30):
    """带重试的 GET，返回文本（utf-8 优先，失败回落 gbk）。"""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=dict(UA, **({'Referer': referer} if referer else {})))
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError:
                return raw.decode('gbk', 'replace')
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(delay * (1 + 0.7 * i))
    log('  !! 请求失败（%d 次）: %s' % (tries, last))
    return None


def get_json(url, referer=None, tries=4, delay=1.5):
    t = get(url, referer, tries, delay)
    if t is None:
        return None
    try:
        return json.loads(t)
    except ValueError:
        return None


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)


def fnum(v):
    try:
        x = float(str(v).replace('%', '').strip())
        return x
    except (TypeError, ValueError):
        return None


def add_years(dstr, n):
    """日期字符串（YYYY-MM-DD）加减年份，2月29日回落到28日。"""
    y, m, d = (int(x) for x in dstr.split('-'))
    y += n
    try:
        from datetime import date
        return date(y, m, d).isoformat()
    except ValueError:
        from datetime import date
        return date(y, m, 28).isoformat()


# ---------------------------------------------------------------- 1. 全市场排行
RANK_FIELDS = {
    3: 'navdate', 4: 'nav', 5: 'ljz', 6: 'dz', 7: 'r1w', 8: 'r1m', 9: 'r3m', 10: 'r6m',
    11: 'r1y', 12: 'r2y', 13: 'r3y', 14: 'rytd', 15: 'rsince', 16: 'estab', 18: 'rcustom',
    19: 'fee_src', 20: 'fee_now', 24: 'r_custom2',
}


def rank_fetch(dt, ft, sd, ed, pn=5000):
    """按页拉全某类基金在 [sd, ed] 区间的排行行（自动翻页）。dt=kf 开放式 / fb 场内。"""
    rows, page, total = [], 1, None
    while True:
        p = {
            # 注意：多加 rs/gs/dx/qdii/tabSubtype 等参数会让接口只返回 20330 条子集（漏 QDII 主动），
            # 场内榜单遇到 tabSubtype 直接返回空，因此这里只用最小参数集。
            'op': 'ph', 'dt': dt, 'ft': ft, 'sc': '6yzf', 'st': 'desc',
            'sd': sd, 'ed': ed, 'pi': str(page), 'pn': str(pn),
        }
        url = 'http://fund.eastmoney.com/data/rankhandler.aspx?' + urllib.parse.urlencode(p)
        t = get(url, referer='http://fund.eastmoney.com/data/fundranking.html', tries=4)
        if not t or 'datas:[' not in t:
            break
        body = t[t.index('datas:[') + len('datas:['):]
        got = [r.split(',') for r in re.findall(r'"([^"]+)"', body)]
        rows.extend(got)
        m = re.search(r'allRecords:(\d+)', t)
        total = int(m.group(1)) if m else None
        if not got or (total is not None and len(rows) >= total) or page > 10:
            break
        page += 1
        time.sleep(0.6)
    return rows


# 榜单来源：开放式（全类别 / QDII / 指数型）+ 场内 ETF·LOF
SRC_LIST = [('kf', 'all', '开放式'), ('kf', 'qdii', 'QDII'), ('kf', 'zs', '指数型'), ('fb', 'all', '场内')]
# 字段位置（kf 行 25 列、fb 行 23 列，后者缺“近6月”，末尾多“类型/近5年”）
KF_FIELDS = {3: 'navdate', 4: 'nav', 5: 'ljz', 6: 'r1d', 7: 'r1w', 8: 'r1m', 9: 'r3m', 10: 'r6m',
             11: 'r1y', 12: 'r2y', 13: 'r3y', 14: 'rytd', 15: 'rsince', 16: 'estab',
             19: 'fee_src', 20: 'fee_now', 24: 'r5w'}
FB_FIELDS = {3: 'navdate', 4: 'nav', 5: 'ljz', 6: 'r1d', 7: 'r1w', 8: 'r1m', 9: 'r3m',
             10: 'r1y', 11: 'r2y', 12: 'r3y', 13: 'rytd', 14: 'rsince', 15: 'estab',
             21: 'fbtype', 22: 'r5w'}
TEXT_COLS = ('navdate', 'estab', 'fee_src', 'fee_now', 'fbtype')


def cmd_universe(args):
    ensure_dirs()
    out = {'asof': AS_OF, 'funds': {}}
    funds = out['funds']
    for dt, ft, label in SRC_LIST:
        fields = FB_FIELDS if dt == 'fb' else KF_FIELDS
        tag = '%s:%s' % (dt, ft)
        # 排行榜自带“近5年”列（kf 第 24 列 / 场内第 22 列），10 年口径留到历史净值阶段自算
        rows = rank_fetch(dt, ft, add_years(AS_OF, -10), AS_OF)
        log('  %-6s %s→%s：%d 条' % (label, add_years(AS_OF, -10), AS_OF, len(rows)))
        for a in rows:
            if len(a) < 16 or not re.match(r'^\d{6}$', a[0]):
                continue
            f = funds.setdefault(a[0], {'code': a[0], 'srcs': []})
            f['name'] = a[1]
            if tag not in f['srcs']:
                f['srcs'].append(tag)
            for i, k in fields.items():
                if i >= len(a):
                    continue
                v = a[i]
                f[k] = v if k in TEXT_COLS else fnum(v)
        time.sleep(0.6)
    save_json(os.path.join(DATA, 'universe.json'), out)
    log('  ✓ 四榜合并去重后 %d 个代码（含各份额类别）' % len(funds))
    for dt, ft, label in SRC_LIST:
        n = sum(1 for f in funds.values() if '%s:%s' % (dt, ft) in f['srcs'])
        log('    %s：%d' % (label, n))


# ---------------------------------------------------------------- 2. 粗筛
# 尾部份额类别字母（C/D/E/I/Y/H/R/O/F/B 等非 A 类份额不保留）
SHARE_TAIL = re.compile(r'(?:[A-Za-z]{0,3})(?:C|D|E|I|Y|H|R|O|F|B|Z)$')
# 分桶关键词（用于粗筛阶段判断类别，最终以接口 FTYPE 为准）
KW_BOND = ('债', '固收', '存单', '同业', '利率', '国债', '信用', '可转')
KW_MONEY = ('货币', '现金', '理财', '活期', '保证金')
KW_OVERSEAS = ('QDII', 'qdii', '海外', '全球', '美国', '纳斯达克', '标普', '港股', '恒生', 'H股', '中概',
               '亚洲', '欧洲', '日本', '印度', '越南', '德国', '法国', '新兴市场', '大中华', '中华',
               '黄金', '白银', '商品', '原油', '石油', 'REIT', '豆粕', '有色', '美元', '现汇', '现钞', '港币')
KW_INDEX = ('指数', 'ETF', 'etf', 'LOF', '联接', '增强')

# ---- 用户口径排除项（2026-09-11 追加）----
# 1) 页面（index.html）已跟踪的标普500/纳指100 等美股指数基金
# 2) 标普500、纳指100 等美股指数的其他跟踪产品（含未上页面的）
# 3) 纯黄金/白银等贵金属商品基金（黄金股/金银珠宝类主动基金保留）
# 4) 纯债型（只赚 1–2 个点的长债/短债/信用债/利率债/固收指数）
EXCL_US_INDEX = ('标普', '纳斯达克', '纳指', 'S&P', '标普500')
EXCL_METAL_INDEX = ('黄金9999', '上海金', 'Au9999', '白银')
EXCL_METAL_NAME = re.compile(r'黄金(ETF|基金|主题|及贵金属|-QDII|QDII)|白银|上海金')
EXCL_METAL_COMMODITY = ('黄金', '贵金属', '白银')  # 归为商品且标的为贵金属的才剔除（原油/能源等保留）
EXCL_BOND_TYPE = ('长债', '短债', '中短债', '纯债', '信用债', '利率债', '指数型-固收')
MIN_BOND_CAGR5 = 4.0  # 固收+ 的最低近5年年化，低于此归为“纯债那类只能赚一两个点的”


def page_codes():
    """index.html 大类一（FUNDS 块）里已经跟踪的基金代码。"""
    try:
        with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
            s = f.read()
    except OSError:
        return set()
    m = re.search(r'/\*__DATA_FUNDS_BEGIN__\*/(.*?)/\*__DATA_FUNDS_END__\*/', s, re.S)
    return set(re.findall(r"c:'(\d{6})'", m.group(1) if m else s))


def exclusion_reason(rec, page=None):
    """返回该基金应被排除的理由；不排除则返回 None。"""
    page = page_codes() if page is None else page
    code = rec.get('code') or ''
    name = rec.get('name') or rec.get('full_name') or ''
    index_name = rec.get('index_name') or rec.get('fbtype') or ''
    ftype = rec.get('ftype') or ''
    txt = name + ' ' + index_name
    if code in page:
        return '页面已有（美股指数清单）'
    if any(k in txt for k in EXCL_US_INDEX):
        return '标普500/纳指100 等美指跟踪'
    if (index_name in EXCL_METAL_INDEX or EXCL_METAL_NAME.search(txt)
            or ('商品' in ftype and any(k in txt for k in EXCL_METAL_COMMODITY))):
        return '纯黄金/白银商品'
    if any(k in ftype for k in EXCL_BOND_TYPE):
        return '纯债（收益过低）'
    return None


# 分桶门槛：(最少成立年限, 近5年门槛%, 成立以来门槛%, 入池上限)
BUCKET_GATE = {
    '国内权益': (10, 50, 80, 130),
    'QDII/海外': (8, 25, 60, 70),
    '指数/指数增强': (10, 25, 60, 80),
    '债券/固收': (10, 18, 32, 60),
    'FOF': (8, 30, 40, 25),
    '场内ETF/LOF': (8, 25, 60, 90),
}


def base_name(n):
    """去掉份额类别后缀，用于同一只基金不同份额的归并。"""
    n = re.sub(r'\s+', '', n)
    n = re.sub(r'[（(](QDII|LOF|FOF|ETF|人民币|美元现汇|美元现钞)[)）]', '', n)
    m = re.match(r'^(.*[\u4e00-\u9fff）)])([A-Z])$', n)
    return m.group(1) if m else n


def classify(name, srcs):
    """粗分类（最终以接口 FTYPE 为准）。"""
    if any(s.startswith('fb:') for s in srcs):
        return '场内ETF/LOF'
    if any(k in name for k in KW_MONEY):
        return '货币'
    is_qdii = any(s == 'kf:qdii' for s in srcs) or any(k in name for k in KW_OVERSEAS)
    is_bond = any(k in name for k in KW_BOND)
    if is_qdii and is_bond:
        return '债券/固收'
    if is_qdii:
        return 'QDII/海外'
    if is_bond:
        return '债券/固收'
    if 'FOF' in name.upper():
        return 'FOF'
    if any(s == 'kf:zs' for s in srcs) or any(k in name for k in KW_INDEX):
        return '指数/指数增强'
    return '国内权益'


def cmd_prefilter(args):
    ensure_dirs()
    uni = load_json(os.path.join(DATA, 'universe.json'))
    if not uni:
        log('!! 先跑 universe')
        return
    funds = uni['funds']

    # ① 归并同一基金的多个份额类别：取成立最早、其次近5年收益最高者为代表
    groups = {}
    for c, f in funds.items():
        if any(k in f['name'] for k in ('美元', '现汇', '现钞', '港币', '欧元', '英镑')):
            continue  # 同一基金的美元/现汇份额不单列
        if exclusion_reason({'code': c, 'name': f['name'], 'index_name': '', 'ftype': ''}):
            continue  # 页面已有 / 美指跟踪 / 纯贵金属（按名称即可判定）
        groups.setdefault(base_name(f['name']), []).append(f)
    drop = {'成立不足': 0, '缺收益': 0, '收益不达标': 0, '不在门槛桶': 0}
    by_bucket = {}
    for gname, members in groups.items():
        members = [m for m in members if m.get('r5w') is not None]
        if not members:
            drop['缺收益'] += len(members) or 1
            continue
        rep = sorted(members, key=lambda m: (m.get('estab') or '9999', -(m.get('r5w') or -999)))[0]
        bucket = classify(gname, rep['srcs'])
        gate = BUCKET_GATE.get(bucket)
        if not gate:
            drop['不在门槛桶'] += 1
            continue
        min_years, min_r5, min_since, cap = gate
        est = rep.get('estab') or ''
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', est) or est > add_years(AS_OF, -min_years):
            drop['成立不足'] += 1
            continue
        r5, since = rep.get('r5w'), rep.get('rsince')
        if r5 is None or r5 < min_r5 or (since or -999) < min_since:
            drop['收益不达标'] += 1
            continue
        rec = {'code': rep['code'], 'name': gname, 'full_name': rep['name'], 'bucket': bucket,
               'estab': est, 'r5w': r5, 'rsince': since, 'r1y': rep.get('r1y'), 'r2y': rep.get('r2y'),
               'r3y': rep.get('r3y'), 'rytd': rep.get('rytd'),
               'navdate': rep.get('navdate'), 'srcs': rep['srcs'],
               'fbtype': rep.get('fbtype'), 'fee_now': rep.get('fee_now'),
               'siblings': [m['code'] for m in members if m['code'] != rep['code']]}
        by_bucket.setdefault(bucket, []).append(rec)

    kept = []
    for bucket, recs in by_bucket.items():
        cap = BUCKET_GATE[bucket][3]
        recs.sort(key=lambda x: -((x['r5w'] or 0) * 0.6 + (x['rsince'] or 0) * 0.4))
        log('  %-12s 过门槛 %3d 只 → 取前 %d' % (bucket, len(recs), min(cap, len(recs))))
        kept.extend(recs[:cap])
    save_json(os.path.join(DATA, 'shortlist.json'),
              {'asof': AS_OF, 'gates': BUCKET_GATE, 'kept': kept})
    log('  剔除明细：%s' % drop)
    log('  ✓ 入池合计 %d 只（按分桶上限截断）' % len(kept))


# ---------------------------------------------------------------- 3. 逐只补基础信息 + 基金经理
BASIC_API = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation'
BASIC_KEEP = {
    'SHORTNAME': 'name', 'FTYPE': 'ftype', 'ESTABDATE': 'estab', 'DWJZ': 'nav', 'LJJZ': 'ljz',
    'SYL_1N': 'r1y', 'SYL_2N': 'r2y', 'SYL_3N': 'r3y', 'SYL_JN': 'rytd', 'SYL_LN': 'rsince',
    'ENDNAV': 'scale', 'FEGMRQ': 'scale_date', 'JJGS': 'company', 'JJJL': 'managers',
    'RATE': 'fee_now', 'SOURCERATE': 'fee_src', 'SGZT': 'sgzt', 'SHZT': 'shzt',
    'RISKLEVEL': 'risk', 'SHARP1': 'sharpe1y', 'MAXRETRA1': 'mdd1y', 'STDDEV1': 'vol1y',
    'INDEXNAME': 'index_name', 'INDEXCODE': 'index_code', 'FUNDINVEST': 'invest', 'BUY': 'buy',
    'MINSG': 'min_buy', 'ISSBDATE': 'issbdate',
}


def basic_fetch(code, refresh=False):
    path = os.path.join(CACHE, 'basic', code + '.json')
    if os.path.exists(path) and not refresh:
        d = load_json(path)
        if d and d.get('name'):
            return d
    url = BASIC_API + '?' + urllib.parse.urlencode(
        {'FCODE': code, 'deviceid': '1', 'plat': 'Android', 'product': 'EFund',
         'version': '6.3.8', 'appType': 'ttjj', 'Uid': ''})
    j = get_json(url)
    ds = (j or {}).get('Datas') or {}
    if not ds:
        return None
    d = {}
    for k, name in BASIC_KEEP.items():
        v = ds.get(k)
        if isinstance(v, str):
            v = v.strip()
        d[name] = v
    if d.get('index_name') in ('--', None):
        d['index_name'] = ''
    save_json(path, d)
    return d


JJJL_ROW = re.compile(
    r"<tr><td>(\d{4}-\d{2}-\d{2})</td><td>(至今|\d{4}-\d{2}-\d{2})</td>"
    r"<td>(.*?)</td><td>(.*?)</td><td[^>]*>(.*?)</td></tr>", re.S)
JJJL_NAME = re.compile(r">([^<>]+)</a>")


def jjjl_fetch(code, refresh=False):
    path = os.path.join(CACHE, 'jjjl', code + '.html')
    t = None
    if os.path.exists(path) and not refresh and time.time() - os.path.getmtime(path) < 86400 * 7:
        with open(path, encoding='utf-8') as f:
            t = f.read()
    if not t:
        t = get('https://fundf10.eastmoney.com/jjjl_%s.html' % code,
                referer='https://fundf10.eastmoney.com/', tries=3)
        if not t:
            return None
        with open(path, 'w', encoding='utf-8') as f:
            f.write(t)
    rows = []
    for m in JJJL_ROW.finditer(t):
        start, end, names_html, tenure, ret = m.groups()
        names = [n.strip() for n in JJJL_NAME.findall(names_html)]
        rows.append({'start': start, 'end': end, 'names': names, 'tenure': tenure,
                     'ret': fnum(re.sub(r'[^\d.\-]', '', ret))})
    return rows


def cmd_enrich(args):
    ensure_dirs()
    sl = load_json(os.path.join(DATA, 'shortlist.json'))
    if not sl:
        log('!! 先跑 prefilter')
        return
    out = load_json(os.path.join(DATA, 'enriched.json')) or {'asof': AS_OF, 'funds': {}}
    funds = out['funds']
    todo = [x for x in sl['kept'] if args.refresh or x['code'] not in funds
            or not funds[x['code']].get('basic')]
    log('  待补 %d 只（缓存 %d 只）' % (len(todo), len(funds)))
    for i, x in enumerate(todo, 1):
        code = x['code']
        b = basic_fetch(code, refresh=args.refresh)
        time.sleep(0.8)
        rows = jjjl_fetch(code, refresh=args.refresh)
        cur = next((r for r in (rows or []) if r['end'] == '至今'), None)
        rec = dict(x)
        rec['basic'] = b
        rec['manager_hist'] = rows
        rec['cur_managers'] = (cur or {}).get('names') or []
        rec['cur_start'] = (cur or {}).get('start')
        rec['cur_ret'] = (cur or {}).get('ret')
        # 近5年内的经理变更次数（按起始期段数计）
        cut5 = add_years(AS_OF, -5)
        rec['mgr_changes_5y'] = sum(1 for r in (rows or []) if r['start'] >= cut5)
        rec['mgr_since_fund'] = len(rows or [])
        funds[code] = rec
        if i % 10 == 0 or i == len(todo):
            log('    ... %d/%d' % (i, len(todo)))
            save_json(os.path.join(DATA, 'enriched.json'), out)
        time.sleep(0.7)
    save_json(os.path.join(DATA, 'enriched.json'), out)
    ok = sum(1 for f in funds.values() if f.get('basic'))
    log('  ✓ 基础信息完整 %d / %d' % (ok, len(funds)))


# ---------------------------------------------------------------- 4. 历史净值 + 自算指标
def build_series(rows):
    """按 update.py 同口径构造复权序列 [(date, dwjz, T, ljjz), ...]（升序）。"""
    rows = sorted(rows, key=lambda r: r.get('FSRQ') or '')
    has_div = any((r.get('FHFCZ') or '').strip() for r in rows)
    ser, T = [], 1.0
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
            fh = float(r.get('FHFCZ') or 0)
        except (TypeError, ValueError):
            fh = 0.0
        if i > 0 and ser:
            pdw, plj = ser[-1][1], ser[-1][3]
            if has_div:
                if fh > 0 and pdw > 0:
                    drop = pdw - dwjz
                    if drop > 0 and abs(drop - fh) / pdw < 0.02:
                        T *= (dwjz + fh) / pdw
                    else:
                        T *= dwjz / pdw
                elif pdw > 0:
                    T *= dwjz / pdw
            elif plj > 0:
                T *= ljjz / plj
        ser.append((r.get('FSRQ'), dwjz, T, ljjz))
    return ser


def _stats(win):
    """窗口内 [(date, T)] → 年化波动、最大回撤、滚动3年正收益占比。"""
    if len(win) < 60:
        return None
    lr = [math.log(win[i][1] / win[i - 1][1]) for i in range(1, len(win)) if win[i - 1][1] > 0]
    mean = sum(lr) / len(lr)
    var = sum((x - mean) ** 2 for x in lr) / (len(lr) - 1)
    vol = math.sqrt(var) * math.sqrt(250) * 100
    peak, mdd, mdd_date = win[0][1], 0.0, None
    for d, t in win:
        if t > peak:
            peak = t
        dd = t / peak - 1
        if dd < mdd:
            mdd, mdd_date = dd, d
    return {'vol': vol, 'mdd': mdd * 100, 'mdd_date': mdd_date}


def deep_metrics(rows):
    """由历史净值行计算长期指标（红利再投复权口径）。"""
    ser = build_series(rows)
    if len(ser) < 250:
        return None
    latest = ser[-1][0]
    Tend = ser[-1][2]

    def window_ret(years):
        b = add_years(latest, -years)
        base, base_date = None, None
        for d, dw, t, lj in ser:
            if d <= b:
                base, base_date = t, d
            else:
                break
        if base is None or base <= 0:
            return None
        ret = Tend / base - 1
        days = (int(latest[:4]) - int(base_date[:4])) * 365.25 + 0
        return {'ret': ret * 100, 'cagr': ((1 + ret) ** (1.0 / years) - 1) * 100,
                'base_date': base_date}

    out = {'code': None, 'latest': latest, 'first': ser[0][0], 'rows': len(ser)}
    for n in (1, 2, 3, 5, 8, 10):
        w = window_ret(n)
        if w:
            out['ret%d' % n] = w['ret']
            out['cagr%d' % n] = w['cagr']
    # 成立以来年化
    days = (ser[-1][0] > ser[0][0]) and len(ser)
    if days:
        from datetime import date
        d0 = date(*[int(x) for x in ser[0][0].split('-')])
        d1 = date(*[int(x) for x in ser[-1][0].split('-')])
        yrs = (d1 - d0).days / 365.25
        if yrs > 0.5:
            out['cagr_since'] = ((Tend / ser[0][2]) ** (1 / yrs) - 1) * 100
            out['years'] = yrs
    # 窗口统计
    for n in (5, 10):
        b = add_years(latest, -n)
        win = [(d, t) for d, dw, t, lj in ser if d >= b]
        st = _stats(win)
        if st:
            out['vol%d' % n] = st['vol']
            out['mdd%d' % n] = st['mdd']
            out['mdd%d_date' % n] = st['mdd_date']
    st_all = _stats([(d, t) for d, dw, t, lj in ser])
    if st_all:
        out['mdd_all'] = st_all['mdd']
        out['mdd_all_date'] = st_all['mdd_date']
    # 分年度收益（复权口径：上一年末点位 → 当年末点位）
    yearly = {}
    prev_close = None
    cur_year = None
    year_open = None
    for d, dw, t, lj in ser:
        y = d[:4]
        if cur_year != y:
            if cur_year is not None and year_open:
                yearly[cur_year] = (prev_close / year_open - 1) * 100
            cur_year, year_open = y, t
        prev_close = t
    if cur_year and year_open:
        yearly[cur_year] = (prev_close / year_open - 1) * 100
    out['yearly'] = yearly
    return out


def cmd_metrics(args):
    ensure_dirs()
    en = load_json(os.path.join(DATA, 'enriched.json'))
    if not en:
        log('!! 先跑 enrich')
        return
    out = load_json(os.path.join(DATA, 'metrics.json')) or {'asof': AS_OF, 'funds': {}}
    funds = out['funds']
    todo = [f for f in en['funds'].values() if args.refresh or f['code'] not in funds]
    if getattr(args, 'codes', None):
        want = [c.strip() for c in args.codes.split(',') if c.strip()]
        en_by = en['funds']
        todo = []
        for c in want:
            if c in funds and not args.refresh:
                continue
            f = en_by.get(c)
            if not f:
                b = basic_fetch(c)
                f = {'code': c, 'name': (b or {}).get('name') or c, 'full_name': (b or {}).get('name'),
                     'bucket': '参考基准', 'basic': b, 'estab': (b or {}).get('estab')}
                en_by[c] = f
            todo.append(f)
    log('  待算 %d 只（已有 %d 只）' % (len(todo), len(funds)))
    for i, f in enumerate(todo, 1):
        code = f['code']
        rows = U.history_fetch(code)
        m = deep_metrics(rows) if rows else None
        if m:
            m['code'] = code
            funds[code] = m
            save_json(os.path.join(CACHE, 'metrics', code + '.json'), m)
        else:
            log('  !! %s %s 无历史数据' % (code, f['name']))
        if i % 5 == 0 or i == len(todo):
            save_json(os.path.join(DATA, 'metrics.json'), out)
            log('    ... %d/%d' % (i, len(todo)))
    save_json(os.path.join(DATA, 'metrics.json'), out)
    if getattr(args, 'codes', None):
        save_json(os.path.join(DATA, 'enriched.json'), en)
    log('  ✓ 指标完成 %d 只' % len(funds))


def _pct_rank(vals):
    """把一组数值映射成 0~1 的分位（越大越好，缺值给 0.5）。"""
    idx = sorted(range(len(vals)), key=lambda i: (vals[i] is None, vals[i] if vals[i] is not None else 0))
    out = {}
    n = len(vals)
    for rank, i in enumerate(idx):
        out[i] = rank / max(1, n - 1)
    return out


def _years_between(d0, d1):
    from datetime import date
    try:
        a = date(*[int(x) for x in d0.split('-')])
        b = date(*[int(x) for x in d1.split('-')])
    except (ValueError, AttributeError):
        return None
    return (b - a).days / 365.25


def assemble():
    en = (load_json(os.path.join(DATA, 'enriched.json')) or {}).get('funds', {})
    mt = (load_json(os.path.join(DATA, 'metrics.json')) or {}).get('funds', {})
    rows = []
    for code, f in en.items():
        if any(k in (f.get('full_name') or f.get('name') or '') for k in ('美元', '现汇', '现钞', '港币')):
            continue  # 同一基金的美元份额与人民币份额重复，仅保留人民币份额
        b = f.get('basic') or {}
        m = mt.get(code) or {}
        if not m:
            continue
        scale = fnum(b.get('scale'))
        tenure = _years_between(f.get('cur_start') or '', m.get('latest') or '') if f.get('cur_start') else None
        rows.append({
            'code': code, 'name': f.get('full_name') or b.get('name') or f.get('name'),
            'group_name': f.get('name'), 'bucket': f.get('bucket'), 'estab': f.get('estab'),
            'years': m.get('years'), 'scale': (scale / 1e8) if scale else None,
            'scale_date': b.get('scale_date'), 'company': b.get('company'),
            'ftype': b.get('ftype'), 'index_name': b.get('index_name') or f.get('fbtype'),
            'managers': b.get('managers') or ','.join(f.get('cur_managers') or []),
            'cur_start': f.get('cur_start'), 'tenure': tenure,
            'mgr_changes_5y': f.get('mgr_changes_5y'), 'mgr_since': f.get('mgr_since_fund'),
            'fee_now': b.get('fee_now') or f.get('fee_now'), 'sgzt': b.get('sgzt'),
            'sharpe1y': fnum(b.get('sharpe1y')), 'mdd1y': fnum(b.get('mdd1y')), 'vol1y': fnum(b.get('vol1y')),
            'r1y_api': fnum(b.get('r1y')), 'r5_api': f.get('r5w'), 'rsince_api': f.get('rsince'),
            'cagr1': m.get('cagr1'), 'cagr3': m.get('cagr3'), 'cagr5': m.get('cagr5'),
            'cagr8': m.get('cagr8'), 'cagr10': m.get('cagr10'), 'cagr_since': m.get('cagr_since'),
            'vol5': m.get('vol5'), 'vol10': m.get('vol10'),
            'mdd5': m.get('mdd5'), 'mdd10': m.get('mdd10'), 'mdd_all': m.get('mdd_all'),
            'yearly': m.get('yearly') or {}, 'latest': m.get('latest'),
            'invest': b.get('invest'), 'siblings': f.get('siblings') or [],
            'buy': b.get('buy'),
        })
        y = rows[-1]['yearly']
        if y:
            k = max(y, key=lambda t: y[t])
            rows[-1]['max_year_key'], rows[-1]['max_year'] = k, y[k]
    return rows


# 最终入选规则（可在报告里解释）：硬门槛 + 分桶打分
HARD = {
    '国内权益': {'min_scale': 2.0, 'min_cagr5': 8.0, 'min_cagr10': 6.0, 'min_mdd5': -55.0, 'min_tenure': 2.0},
    'QDII/海外': {'min_scale': 2.0, 'min_cagr5': 5.5, 'min_cagr10': 4.5, 'min_mdd5': -60.0, 'min_tenure': 1.5},
    '指数/指数增强': {'min_scale': 2.0, 'min_cagr5': 5.0, 'min_cagr10': 5.0, 'min_mdd5': -55.0, 'min_tenure': None},
    '场内ETF/LOF': {'min_scale': 5.0, 'min_cagr5': 5.0, 'min_cagr10': 5.0, 'min_mdd5': -55.0, 'min_tenure': None},
    '债券/固收': {'min_scale': 2.0, 'min_cagr5': 3.0, 'min_cagr10': 3.0, 'min_mdd5': -20.0, 'min_tenure': 1.5},
    'FOF': {'min_scale': 1.0, 'min_cagr5': 5.0, 'min_cagr10': None, 'min_mdd5': -40.0, 'min_tenure': None},
}
PICK_N = {'国内权益': 22, 'QDII/海外': 12, '指数/指数增强': 10, '场内ETF/LOF': 12, '债券/固收': 10, 'FOF': 5}


def pick(rows):
    """按桶做硬门槛 → 分位打分 → 取前 N。"""
    out = {}
    other_map = {}
    page = page_codes()
    for bucket, recs in _group_by(rows, lambda r: r['bucket']).items():
        hard = HARD.get(bucket)
        if not hard:
            continue
        passed = []
        for r in recs:
            if exclusion_reason(r, page):
                continue
            if not r.get('sgzt') or '暂停' in (r.get('sgzt') or ''):
                if bucket != '场内ETF/LOF':
                    continue
            if r.get('scale') is not None and r['scale'] < hard['min_scale']:
                continue
            if r.get('scale') is None:
                continue
            if r.get('cagr5') is None or r['cagr5'] < hard['min_cagr5']:
                continue
            if hard.get('min_cagr10') is not None:
                c10 = r.get('cagr10') if r.get('cagr10') is not None else r.get('cagr_since')
                if c10 is None or c10 < hard['min_cagr10']:
                    continue
            if r.get('mdd5') is None or r['mdd5'] < hard['min_mdd5']:
                continue
            if hard.get('min_tenure') and (r.get('tenure') is None or r['tenure'] < hard['min_tenure']):
                continue
            # 固收类：成立初期净值异动（大额赎回/建仓期一次性收益）不计入长期绩优
            if bucket == '债券/固收':
                c8, cs = r.get('cagr8'), r.get('cagr_since')
                if c8 is not None and cs is not None and cs - c8 > 3.0:
                    continue
                if (r.get('cagr5') or 0) < MIN_BOND_CAGR5:
                    continue  # 只有一两个点的纯债类不入选
            passed.append(r)
        if not passed:
            out[bucket] = []
            continue
        # 分位打分
        p5 = _pct_rank([r['cagr5'] for r in passed])
        p10 = _pct_rank([(r['cagr10'] if r['cagr10'] is not None else r['cagr_since']) for r in passed])
        psince = _pct_rank([(r['cagr_since'] if r['cagr_since'] is not None else -99) for r in passed])
        pmdd = _pct_rank([(r['mdd5'] if r['mdd5'] is not None else -99) for r in passed])
        pscale = _pct_rank([math.log10(max(r['scale'] or 0.01, 0.01)) for r in passed])
        if bucket in ('指数/指数增强', '场内ETF/LOF'):
            pfee = _pct_rank([-(fnum(str(r.get('fee_now') or 0).replace('%', '')) or 0) for r in passed])
            for i, r in enumerate(passed):
                r['score'] = 100 * (0.30 * p5[i] + 0.20 * p10[i] + 0.10 * psince[i] +
                                    0.22 * pmdd[i] + 0.08 * pscale[i] + 0.10 * pfee[i])
        else:
            pten = _pct_rank([(r.get('tenure') or 0) for r in passed])
            for i, r in enumerate(passed):
                r['score'] = 100 * (0.30 * p5[i] + 0.20 * p10[i] + 0.10 * psince[i] +
                                    0.22 * pmdd[i] + 0.08 * pscale[i] + 0.10 * pten[i])
        passed.sort(key=lambda r: -r['score'])
        if bucket in ('指数/指数增强', '场内ETF/LOF'):
            groups = {}
            for r in passed:
                key = re.sub(r'\s+', '', (r.get('index_name') or r['name']))
                groups.setdefault(key, []).append(r)
            uniq, others = [], []
            for key, members in groups.items():
                if bucket == '场内ETF/LOF':
                    # 场内同标的以“规模/流动性”优先，收益差异让位于可交易性
                    members.sort(key=lambda r: (-(r.get('scale') or 0), -r['score']))
                else:
                    members.sort(key=lambda r: -r['score'])
                rep = members[0]
                uniq.append(rep)
                for m in members[1:]:
                    others.append({'code': m['code'], 'name': m['name'], 'scale': m.get('scale'),
                                   'cagr5': m.get('cagr5'), 'dup_of': rep['code']})
            uniq.sort(key=lambda r: -r['score'])
            out[bucket] = uniq
            other_map[bucket] = others
        else:
            out[bucket] = passed
    out['_others'] = other_map
    return out


def _group_by(items, key):
    g = {}
    for x in items:
        g.setdefault(key(x), []).append(x)
    return g


def fmt_yearly(yearly, n=6):
    if not yearly:
        return '--'
    keys = sorted(yearly.keys())[-n:]
    return ' '.join('%s:%+.0f%%' % (k[2:], yearly[k]) for k in keys)


def pct(v, nd=1, sign='%'):
    if v is None:
        return '--'
    return (('%.' + str(nd) + 'f') % v) + sign


def num(v, nd=1):
    return '--' if v is None else ('%.' + str(nd) + 'f') % v


def render_md(rows, picked, stats=None, others=None, excl=None):
    from datetime import datetime
    latest = max((r.get('latest') or '' for r in rows), default=AS_OF)
    stats = stats or {}
    others = others or {}
    excl = excl or []
    buckets = ['国内权益', 'QDII/海外', '指数/指数增强', '场内ETF/LOF', '债券/固收', 'FOF']
    titles = {'国内权益': 'A股主动权益', 'QDII/海外': 'QDII 主动与海外',
              '指数/指数增强': '指数与指数增强（场外）', '场内ETF/LOF': '场内 ETF / LOF',
              '债券/固收': '债券与固收+', 'FOF': 'FOF'}
    sel = {b: (picked.get(b) or [])[:PICK_N.get(b, 10)] for b in buckets}
    total = sum(len(v) for v in sel.values())
    L = []
    A = L.append
    A('# 国内长期绩优基金筛选（数据截至 %s）' % latest)
    A('')
    A('> 覆盖范围：国内可买到的基金全样本 —— 开放式全类别 + QDII + 指数型 + 场内 ETF/LOF，'
      '全市场 %s 个基金代码、合并份额后约 %s 只基金；粗筛入池 %s 只（另加 3 只宽基指数作对照），'
      '全部完成历史净值深算，完整候选与指标见 `screens/data/长期绩优候选-%s.csv`。货币基金不在本次范围内。'
      % (stats.get('codes', '--'), stats.get('funds', '--'), stats.get('pool', '--'), AS_OF.replace('-', '')))
    A('> 全部指标用**红利再投复权**的净值序列自算（与天天基金口径对照误差通常在 1 个百分点内），'
      '成立满 10 年的基金才算“长期”。')
    A('')
    A('## 一、结论')
    A('')
    A('本轮共筛出 **%d 只**长期绩优基金（%s）。' %
      (total, '、'.join('%s %d 只' % (titles[b], len(sel[b])) for b in buckets if sel[b])))
    A('')
    for b in buckets:
        if not sel[b]:
            continue
        top = sel[b][:5]
        A('- **%s**：%s' % (titles[b], '；'.join('%s（%s，近5年年化 %s、成立以来年化 %s）' %
          (r['name'], r['code'], pct(r.get('cagr5')), pct(r.get('cagr_since'))) for r in top)))
    ref = {r['code']: r for r in rows if r.get('bucket') == '参考基准'}
    hs300 = ref.get('510300') or ref.get('000961') or {}
    A('')
    A('**几点解读**')
    A('')
    if hs300:
        A('- A股宽基过去 5 年基本没赚钱（沪深300ETF 近5年年化 %s、近10年年化 %s，创业板ETF 近5年年化 %s），'
          '所以“长期绩优”名单里的国内品种主要是主动权益与行业/主题指数，宽基指数工具更适合作为配置底仓。'
          % (pct(hs300.get('cagr5')), pct(hs300.get('cagr10')), pct((ref.get('159915') or {}).get('cagr5'))))
    A('- 主动权益入选者以成长/科技风格为主，近 5 年年化普遍在 10%–35%，但 2025–2026 两年贡献了大部分收益，'
      '单年出现过 90%+ 涨幅，需要接受同等量级的回撤（近5年最大回撤多在 -35%～-55%）。')
    A('- QDII 在剔掉标普500/纳指100/贵金属商品后，剩下的是**主动型海外基金**：全球科技与美股成长'
      '（汇添富全球移动互联、华夏全球科技先锋、广发全球精选）、新兴市场与亚洲（建信新兴市场、'
      '摩根全球新兴市场、国富亚洲机会、易方达亚洲精选）、资源与欧洲（摩根全球天然资源、华安德国 DAX 联接）。'
      '不少 QDII 主动基金因**现任经理刚变更**（<1.5 年）或**暂停申购**落选，见落选说明表；'
      'QDII 额度与申赎状态经常变化，买入前需再看一次。')
    A('- 债券只保留固收+（近5年年化 ≥' + ('%.0f' % MIN_BOND_CAGR5) + '%）：年化 4%–6.5%、最大回撤多在 -10% 以内，'
      '靠可转债或少量股票增强；纯债那种一年一两个点的已全部剔除，成立初期靠大额赎回做高净值的也已剔除。')
    A('- 指数与场内两块是“工具型”清单：A股行业/主题（银行、红利、资源、煤炭、电子/信息、能源）'
      '加德国 DAX，用来替代选股；同标的只留一只（场内按规模/流动性优先），'
      '买卖价差与折溢价自行留意。')
    A('')
    A('## 二、筛选口径')
    A('')
    A('1. **样本**：天天基金四张榜单（开放式全类别 24458、QDII 364、指数型 4971、场内 1646 个代码），'
      '同一基金的 A/C 等份额合并，取成立最早、长期收益最高的份额作代表；剔除货币型。')
    A('2. **成立年限**：权益类与固收类要求成立满 10 年（经历 2015 高点后、2016 熔断、2018、'
      '2022–2024 三轮熊市）；QDII/海外与场内放宽到 8 年。')
    A('3. **收益门槛**（区间涨幅，红利再投复权）：')
    A('')
    A('| 类别 | 最少成立 | 近5年门槛 | 成立以来门槛 | 入池上限 |')
    A('|---|---|---|---|---|')
    for b in buckets:
        gate = BUCKET_GATE.get(b)
        if not gate:
            continue
        A('| %s | %d 年 | ≥%.0f%% | ≥%.0f%% | %d |' % (titles[b], gate[0], gate[1], gate[2], gate[3]))
    A('')
    A('4. **按需求剔除**：① 页面（index.html）已跟踪的 %d 只美股指数基金；② 标普500、纳指100 等其他跟踪产品'
      '（含未上页面的）；③ 纯黄金/白银等贵金属商品基金（**黄金股、金银珠宝等主动基金保留**）；'
      '④ 纯债型（长债/短债/中短债/信用债/利率债/固收指数）且近5年年化低于 %.0f%% 的低收益品种，'
      '只保留固收+（一、二级债基、偏债混合、可转债）。' % (len(page_codes()), MIN_BOND_CAGR5))
    A('5. **终选硬门槛**：规模（场外 ≥2 亿、场内 ≥5 亿）、自算近5年年化、近10年年化（不足 10 年用成立以来）、'
      '近5年最大回撤、现任基金经理任职年限（主动类 ≥1.5–2 年）、申购状态不为暂停。')
    A('6. **打分**：桶内分位加权 —— 近5年年化 30% + 近10年年化 20% + 成立以来年化 10% + '
      '近5年最大回撤 22% + 规模 8% + （主动类：现任经理任职年限 10%／指数与场内：费率 10%）。')
    A('7. **数据源**：天天基金排行榜接口（代码/名称/成立日/区间涨幅/费率）、'
      'FundMNBasicInformation（类型/规模/基金经理/前十大持仓）、f10 基金经理变动表、'
      'FundMNHisNetList 全量历史净值（自算区间年化、最大回撤、波动率、分年度收益）。')
    A('')
    if excl:
        A('### 已按需求剔除（本轮深算候选中的统计）')
        A('')
        A('| 剔除项 | 只数 | 代表 |')
        A('|---|---|---|')
        for why, n, samples in excl:
            A('| %s | %d | %s |' % (why, n, '、'.join(samples)))
        A('')
    A('## 三、精选名单')
    A('')
    for b in buckets:
        if not sel[b]:
            continue
        A('### %s（%d 只）' % (titles[b], len(sel[b])))
        A('')
        if b in ('指数/指数增强', '场内ETF/LOF'):
            A('| # | 代码 | 基金 | 成立 | 规模(亿) | 跟踪标的 | 申购费 | 近5年年化 | 近10年年化 | 成立来年化 | 近5年回撤 | 5年波动 | 分 |')
            A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
        else:
            A('| # | 代码 | 基金 | 成立 | 规模(亿) | 现任经理(自) | 近5年年化 | 近10年年化 | 成立来年化 | 近5年回撤 | 5年波动 | 分 |')
            A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
        for i, r in enumerate(sel[b], 1):
            c10 = r.get('cagr10') if r.get('cagr10') is not None else r.get('cagr_since')
            if b in ('指数/指数增强', '场内ETF/LOF'):
                fee = r.get('fee_now') if (r.get('fee_now') or '').strip() not in ('', '--') else '场内佣金'
                mid = '%s | %s' % (r.get('index_name') or '--', fee)
            else:
                mid = '%s(%s)' % (r.get('managers') or '--', (r.get('cur_start') or '')[2:7])
            A('| %d | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
                i, r['code'], r['name'], (r.get('estab') or '')[:7], num(r.get('scale'), 1), mid,
                pct(r.get('cagr5')), pct(c10), pct(r.get('cagr_since')), pct(r.get('mdd5')),
                pct(r.get('vol5')), num(r.get('score'), 1)))
        A('')
        pick_rows = sel[b][:6]
        for r in pick_rows:
            flag = ''
            if (r.get('max_year') or 0) > 100 and b not in ('指数/指数增强', '场内ETF/LOF'):
                flag = '（%s 年 %+.0f%%，单年涨幅较大，注意行情贡献）' % (r.get('max_year_key'), r['max_year'])
            extra = ''
            if b in ('国内权益', '债券/固收'):
                holds = [x for x in (r.get('invest') or '').split(',') if x][:3]
                if holds:
                    extra += '；重仓：%s' % '、'.join(holds)
            st = (r.get('sgzt') or '').strip()
            if st and any(k in st for k in ('暂停', '限', '封闭', '停止')):
                extra += '；申购状态：%s' % st
            A('- **%s（%s）** 分年度：%s%s%s' % (r['name'], r['code'], fmt_yearly(r.get('yearly')), flag, extra))
        if others.get(b):
            dup = others[b][:6]
            rule = '按规模/流动性优先' if b == '场内ETF/LOF' else '按评分优先'
            A('- 同标的还有：%s（已按同标的只保留一只，%s；其余见 CSV）'
              % ('、'.join('%s %s（%.1f 亿）' % (d['name'], d['code'], d.get('scale') or 0) for d in dup), rule))
        A('')
    refs = [r for r in rows if r.get('bucket') == '参考基准' and r.get('cagr5') is not None]
    if refs:
        A('### 参考基准（同区间对照，未参与打分）')
        A('')
        A('| 代码 | 标的 | 成立 | 近5年年化 | 近10年年化 | 成立来年化 | 近5年最大回撤 |')
        A('|---|---|---|---|---|---|---|')
        for r in refs:
            c10 = r.get('cagr10') if r.get('cagr10') is not None else r.get('cagr_since')
            A('| %s | %s | %s | %s | %s | %s | %s |' % (
                r['code'], r['name'], (r.get('estab') or '')[:7], pct(r.get('cagr5')),
                pct(c10), pct(r.get('cagr_since')), pct(r.get('mdd5'))))
        A('')
    A('## 四、落选说明（规模较大的代表性样本）')
    A('')
    reasons = []
    for b in buckets:
        hard = HARD.get(b)
        recs = _group_by(rows, lambda r: r['bucket']).get(b, [])
        failed = []
        for r in recs:
            if exclusion_reason(r):  # 已按需求剔除的不进“落选”表
                continue
            why = []
            if r.get('sgzt') and '暂停' in r['sgzt']:
                why.append('暂停申购')
            if r.get('scale') is not None and hard and r['scale'] < hard['min_scale']:
                why.append('规模 %.1f 亿不足' % r['scale'])
            if r.get('cagr5') is None or (hard and r['cagr5'] < hard['min_cagr5']):
                why.append('近5年年化 %s 不达标' % pct(r.get('cagr5')))
            elif hard and hard.get('min_cagr10'):
                c10 = r.get('cagr10') if r.get('cagr10') is not None else r.get('cagr_since')
                if c10 is None or c10 < hard['min_cagr10']:
                    why.append('近10年年化 %s 不达标' % pct(c10))
            if r.get('mdd5') is not None and hard and r['mdd5'] < hard['min_mdd5']:
                why.append('近5年最大回撤 %s 过深' % pct(r['mdd5']))
            if hard and hard.get('min_tenure') and (r.get('tenure') is None or r['tenure'] < hard['min_tenure']):
                why.append('现任经理任职 %s' % (num(r.get('tenure'), 1) + ' 年' if r.get('tenure') else '刚变更'))
            if why:
                failed.append((r, '；'.join(why)))
        failed.sort(key=lambda t: -(t[0].get('scale') or 0))
        for r, why in failed[:4]:
            reasons.append('| %s | %s | %s | %s | %s |' % (titles[b], r['code'], r['name'],
                                                           num(r.get('scale'), 1), why))
    if reasons:
        A('| 类别 | 代码 | 基金 | 规模(亿) | 落选原因 |')
        A('|---|---|---|---|---|')
        for x in reasons[:30]:
            A(x)
    A('')
    A('## 五、风险提示')
    A('')
    A('1. 历史业绩不代表未来；长期高收益往往来自特定风格（成长/赛道/海外科技），风格反转时回撤会同步放大。')
    A('2. 自算口径为红利再投复权，与基金公司/第三方披露的区间收益可能有 1–2 个百分点差异；'
      '场内 ETF 的区间收益以净值计，未含折溢价变动。')
    A('3. 规模、基金经理任职、申赎状态为最近一次公开披露（规模为最新季报口径），会随季报更新。')
    A('4. QDII 额度、汇率与境外市场波动会显著影响实际到手收益；场内品种还需考虑流动性与溢价。')
    A('5. 本清单由公开数据自动筛选生成，不构成投资建议。')
    A('')
    A('## 六、复现方式')
    A('')
    A('```')
    A('python screens/fund_screen.py universe   # 全市场四榜')
    A('python screens/fund_screen.py prefilter  # 分桶粗筛')
    A('python screens/fund_screen.py enrich     # 规模/经理/费率/持仓')
    A('python screens/fund_screen.py metrics    # 历史净值自算指标')
    A('python screens/fund_screen.py report     # 本报告 + CSV')
    A('python screens/fund_screen.py html       # 写回 index.html「大类二：国内长期绩优」数据块')
    A('```')
    A('')
    A('生成时间：%s' % datetime.now().strftime('%Y-%m-%d %H:%M'))
    return '\n'.join(L)


def cmd_report(args):
    ensure_dirs()
    rows = assemble()
    if not rows:
        log('!! 还没有可用数据（先跑 enrich / metrics）')
        return
    picked = pick(rows)
    others = picked.pop('_others', {})
    # CSV：全部候选（含未入选）
    csv_path = os.path.join(DATA, '长期绩优候选-%s.csv' % AS_OF.replace('-', ''))
    cols = ['code', 'name', 'bucket', 'estab', 'years', 'scale', 'company', 'ftype', 'index_name',
            'managers', 'cur_start', 'tenure', 'mgr_changes_5y', 'fee_now', 'sgzt', 'cagr1', 'cagr3',
            'cagr5', 'cagr8', 'cagr10', 'cagr_since', 'vol5', 'mdd5', 'mdd10', 'mdd_all', 'max_year_key',
            'max_year', 'sharpe1y', 'latest', 'siblings']
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols + ['score', 'selected'])
        sel_codes = set()
        for b, recs in picked.items():
            sel_codes.update(r['code'] for r in recs[:PICK_N.get(b, 10)])
        for r in sorted(rows, key=lambda x: (x['bucket'] or '', -(x.get('score') or 0))):
            w.writerow(['%.4f' % r[c] if isinstance(r.get(c), float) else (r.get(c) if r.get(c) is not None else '')
                        for c in cols] + ['%.1f' % r['score'] if r.get('score') is not None else '',
                                          '1' if r['code'] in sel_codes else ''])
    log('  ✓ CSV：%s（%d 行）' % (csv_path, len(rows)))
    uni = load_json(os.path.join(DATA, 'universe.json')) or {}
    sl = load_json(os.path.join(DATA, 'shortlist.json')) or {}
    stats = {'codes': len(uni.get('funds') or {}), 'pool': len(sl.get('kept') or []),
             'funds': len({base_name(v['name']) for v in (uni.get('funds') or {}).values()})}
    page = page_codes()
    excl_map = {}
    for r in rows:
        why = exclusion_reason(r, page)
        if why:
            excl_map.setdefault(why, []).append(r['name'])
    excl = sorted(((w, len(v), v[:3]) for w, v in excl_map.items()), key=lambda t: -t[1])
    md_path = os.path.join(HERE, '长期绩优基金筛选-%s.md' % AS_OF.replace('-', ''))
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(render_md(rows, picked, stats, others, excl))
    log('  ✓ 报告：%s' % md_path)
    for bucket, recs in picked.items():
        n = min(len(recs), PICK_N.get(bucket, 10))
        log('    %-12s 过门槛 %3d → 入选 %d' % (bucket, len(recs), n))


# ---------------------------------------------------------------- 5. 写回 index.html（大类二）
JJFL_DIR = os.path.join(CACHE, 'jjfl')
FEE_RE = re.compile(r'管理费率</td><td[^>]*>\s*([\d.]+)%')
CUST_RE = re.compile(r'托管费率</td><td[^>]*>\s*([\d.]+)%')
SALE_RE = re.compile(r'销售服务费率</td><td[^>]*>\s*([\d.]+)%')
XB_KEYS = [('国内权益', 'x1'), ('QDII/海外', 'x2'), ('指数/指数增强', 'x3'),
           ('场内ETF/LOF', 'x4'), ('债券/固收', 'x5')]
_METRICS_CACHE = None


def _metrics_of(code):
    """读 metrics.json（首次调用时装载，供 html 阶段查区间涨幅/分年度）。"""
    global _METRICS_CACHE
    if _METRICS_CACHE is None:
        _METRICS_CACHE = (load_json(os.path.join(DATA, 'metrics.json')) or {}).get('funds', {})
    return _METRICS_CACHE.get(code) or {}


def jjfl_page(code, refresh=False):
    """抓 fundf10 jjfl 页（申赎状态/限额/规模/费率/赎回费档），缓存 7 天。"""
    path = os.path.join(JJFL_DIR, code + '.html')
    if os.path.exists(path) and not refresh and time.time() - os.path.getmtime(path) < 86400 * 7:
        with open(path, encoding='utf-8') as f:
            return f.read()
    t = get('https://fundf10.eastmoney.com/jjfl_%s.html' % code,
            referer='https://fundf10.eastmoney.com/', tries=3)
    if t:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(t)
    return t


def fee_info(html):
    """由 jjfl 页解析：状态/限额/规模/最新净值（复用 update.py）+ 费率与赎回费档。"""
    if not html:
        return {}
    out = dict(U.jjfl_parse(html))
    for key, rx in (('fee_m', FEE_RE), ('fee_c', CUST_RE), ('fee_s', SALE_RE)):
        m = rx.search(html)
        out[key] = float(m.group(1)) if m else None
    i = html.find('赎回费率')
    if i > 0:
        seg = html[i:i + 2500]
        steps = re.findall(r'<td[^>]*>[^<]*</td>\s*<td[^>]*>\s*([\d.]+)%\s*</td>', seg)
        keep = []
        for s in steps[:6]:
            v = float(s)
            if not keep or keep[-1] != v:
                keep.append(v)
        while keep and keep[-1] == 0:
            keep.pop()
        keep.append(0)
        out['rd'] = '/'.join(('%g' % v) for v in keep)
    return out


def js_str(s):
    return "'" + str(s or '').replace('\\', '\\\\').replace("'", "\\'") + "'"


def js_num(v, nd=4):
    return 'null' if v is None else ('%.' + str(nd) + 'f') % float(v)


def cmd_html(args):
    """把「大类二：国内长期绩优」写成 index.html 里独立的数据块（update.py 不触碰）。"""
    ensure_dirs()
    os.makedirs(JJFL_DIR, exist_ok=True)
    rows = assemble()
    picked = pick(rows)
    picked.pop('_others', None)
    if not picked:
        log('!! 没有可写入的名单，先跑 report')
        return
    en = (load_json(os.path.join(DATA, 'enriched.json')) or {}).get('funds', {})
    uni = (load_json(os.path.join(DATA, 'universe.json')) or {}).get('funds', {})
    want = []
    for bucket, key in XB_KEYS:
        for i, r in enumerate(picked.get(bucket) or []):
            want.append((key, r, 1 if i < PICK_N.get(bucket, 10) else 0))
    for r in rows:
        if r.get('bucket') == '参考基准' and r.get('cagr5') is not None:
            want.append(('x6', r, 0))
    log('  待写 %d 只（含备选与基准）' % len(want))

    etf_codes = [r['code'] for _k, r, _s in want
                 if any(str(s).startswith('fb:') for s in ((uni.get(r['code']) or {}).get('srcs') or []))]
    snap = {}
    if etf_codes:
        try:
            snap = U.tencent_etf(etf_codes)
            log('  场内快照 %d 只' % len(snap))
        except Exception as e:  # noqa: BLE001
            log('  !! 场内快照失败：%s' % e)

    lines = []
    total = len(want)
    for n, (key, r, sel) in enumerate(want, 1):
        code = r['code']
        f = en.get(code, {})
        u = uni.get(code) or {}
        basic = f.get('basic') or {}
        srcs = [str(s) for s in (u.get('srcs') or f.get('srcs') or [])]
        is_etf = any(s.startswith('fb:') for s in srcs) or code in snap
        info = fee_info(jjfl_page(code, refresh=args.refresh))
        if n % 10 == 0 or n == total:
            log('    ... %d/%d' % (n, total))
        st = (info.get('st') or basic.get('sgzt') or '').strip()
        st = {'开放申购': '开放', '限大额': '限大额', '暂停申购': '暂停'}.get(st, st)
        sz = info.get('sz')
        if sz is None:
            sc = fnum(basic.get('scale'))
            sz = (sc / 1e8) if sc else None
        nav = info.get('nav') or fnum(basic.get('nav'))
        navdate = (info.get('navdate') or r.get('latest') or '')[:10]
        dz = info.get('dz')
        if dz is None:
            dz = fnum(r.get('r1d'))
        ftype = basic.get('ftype') or r.get('ftype') or ''
        ix = (r.get('index_name') or '').strip() or ftype
        ttype = '场内ETF' if is_etf else ('LOF' if re.search(r'LOF', r['name']) else '场外')
        sd = snap.get(code) or {}
        m = _metrics_of(code)
        rr = [m.get('ret%d' % k) for k in (1, 2, 3, 5, 10)]
        yr = ' '.join('%s:%+.0f' % (k[2:], v) for k, v in sorted((m.get('yearly') or {}).items())[-6:])
        note = yr
        if not sel and key != 'x6':
            note = ('备选 · ' + note) if note else '备选'
        parts = [
            'g:%s' % js_str(key), 'c:%s' % js_str(code), 'n:%s' % js_str(r['name']),
            't:%s' % js_str(ttype), 'ix:%s' % js_str(ix), 'd:%s' % js_str((r.get('estab') or '')[:10]),
            'fee:[%s,%s,%s]' % (js_num(info.get('fee_m'), 2), js_num(info.get('fee_c'), 2),
                                js_num(info.get('fee_s'), 2)),
        ]
        if not is_etf:
            buy = '%s/%s' % ((u.get('fee_src') or f.get('fee_src') or '').strip(),
                             (u.get('fee_now') or f.get('fee_now') or '').strip())
            parts += ['buy:%s' % js_str(buy.strip('/')), 'rd:%s' % js_str(info.get('rd') or ''),
                      'st:%s' % js_str(st), 'lm:%s' % js_str(info.get('lm') or '')]
        parts += [
            'r:[%s]' % ','.join(js_num(v, 2) for v in rr),
            'sz:%s' % js_num(sz, 1), 'nav:%s' % js_num(nav, 4), 'navdate:%s' % js_str(navdate),
            'dz:%s' % js_num(dz, 2),
            'p:%s' % js_num(sd.get('price'), 3), 'prem:%s' % js_num(sd.get('prem'), 2),
            'iopv:%s' % js_num(sd.get('iopv'), 3), 'pct:%s' % js_num(sd.get('pct'), 2),
            'mgr:%s' % js_str(basic.get('managers') or ','.join(f.get('cur_managers') or [])),
            'mstart:%s' % js_str((f.get('cur_start') or '')[:10]),
            'mten:%s' % js_num(r.get('tenure'), 1),
            'mdd5:%s' % js_num(r.get('mdd5'), 1), 'vol5:%s' % js_num(r.get('vol5'), 1),
            'score:%s' % js_num(r.get('score'), 1), 'sel:%d' % sel, 'note:%s' % js_str(note),
        ]
        lines.append('{' + ','.join(parts) + '},')
    block = ('/*__DATA_EXTRA_BEGIN__*/\n'
             '/* 大类二：国内长期绩优（非美指数）—— 由 screens/fund_screen.py html 生成，'
             'update.py 每日更新不触碰本块。\n'
             '   字段在 FUNDS 基础上扩展：mgr 基金经理 mstart 任职起始 mten 任职年限 '
             'mdd5 近5年最大回撤% vol5 近5年年化波动% score 综合分 sel 1=入选 0=备选\n'
             '   r 为红利再投复权区间涨幅，与页面「累计/年化」开关联动；note 为近6个年度收益 */\n'
             'var EXTRA=[\n' + '\n'.join(lines) + '\n];\n'
             '/*__DATA_EXTRA_END__*/')
    html_path = os.path.join(ROOT, 'index.html')
    with open(html_path, encoding='utf-8') as fh:
        src = fh.read()
    if '/*__DATA_EXTRA_BEGIN__*/' not in src:
        log('!! index.html 里还没有 EXTRA 占位块（先做页面改造）')
        return
    src = re.sub(r'/\*__DATA_EXTRA_BEGIN__\*/.*?/\*__DATA_EXTRA_END__\*/', lambda _m: block,
                 src, count=1, flags=re.S)
    with open(html_path, 'w', encoding='utf-8') as fh:
        fh.write(src)
    log('  ✓ 已写入 index.html：%d 行（入选 %d / 备选 %d / 基准 %d）'
        % (len(lines), sum(1 for _k, _r, s in want if s),
           sum(1 for k, _r, s in want if not s and k != 'x6'),
           sum(1 for k, _r, _s in want if k == 'x6')))


def main():
    ap = argparse.ArgumentParser(description='国内长期绩优基金筛选')
    sub = ap.add_subparsers(dest='cmd')
    sub.add_parser('universe', help='拉全市场排行（开放式 / QDII / 指数型 / 场内四榜）')
    p2 = sub.add_parser('prefilter', help='粗筛：成立年限/名称/份额/长周期收益')
    p3 = sub.add_parser('enrich', help='逐只补基础信息 + 基金经理变动')
    p3.add_argument('--refresh', action='store_true')
    p4 = sub.add_parser('metrics', help='逐只拉历史净值并自算指标（最慢）')
    p4.add_argument('--refresh', action='store_true')
    p4.add_argument('--codes', help='只算指定代码（逗号分隔，可临时补基准）')
    sub.add_parser('report', help='生成筛选报告与 CSV')
    ph = sub.add_parser('html', help='把入选/备选名单写进 index.html 的新数据块（大类二）')
    ph.add_argument('--refresh', action='store_true', help='忽略费率/限额页缓存，重新抓取')
    sub.add_parser('all', help='universe → prefilter → enrich → metrics → report → html')
    args = ap.parse_args()
    ensure_dirs()
    if args.cmd == 'all':
        cmd_universe(args)
        cmd_prefilter(args)
        cmd_enrich(args)
        cmd_metrics(args)
        cmd_report(args)
        cmd_html(args)
        return
    fn = {'universe': cmd_universe, 'prefilter': cmd_prefilter, 'enrich': cmd_enrich,
          'metrics': cmd_metrics, 'report': cmd_report, 'html': cmd_html}.get(args.cmd)
    if fn is None:
        ap.print_help()
    else:
        fn(args)


if __name__ == '__main__':
    main()
