#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
长期配置基金研究池（可复现流水线）

universe → prefilter → enrich → metrics → report → html。
全市场榜单用于发现产品，粗筛只按至少3年历史和份额去重；不按近期高收益截断。
历史净值与明确公司行为复用 update.py，统一计算复权收益、完整期间风险和年度收益。
数据写入 data/snapshot.js 的 EXTRA，展示分层写入 data/screening.js。

python screens/fund_screen.py policy                 # 离线重算研究分层
python screens/fund_screen.py verify-samples --apply  # 样本全历史与费率核验
python screens/fund_screen.py all                    # 全量重建（网络工作量较大）
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
from datetime import date, datetime, timezone
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.cache')
DATA = os.path.join(HERE, 'data')
sys.path.insert(0, ROOT)
import update as U  # noqa: E402  复用 history_fetch / fhsp_fetch / http_get
from data_status import atomic_text

UA = {'User-Agent': 'Mozilla/5.0'}
AS_OF = date.today().isoformat()
SNAPSHOT = os.path.join(ROOT, 'data', 'snapshot.js')
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


def get(url, referer=None, tries=2, delay=0.5, timeout=15):
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
            if i < tries - 1:
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
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(path + '.tmp', path)


def fnum(v):
    try:
        x = float(str(v).replace('%', '').strip())
        return x if math.isfinite(x) else None
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
    rows, page, total, seen_pages = [], 1, None, set()
    while True:
        p = {
            # 注意：多加 rs/gs/dx/qdii/tabSubtype 等参数会让接口只返回 20330 条子集（漏 QDII 主动），
            # 场内榜单遇到 tabSubtype 直接返回空，因此这里只用最小参数集。
            'op': 'ph', 'dt': dt, 'ft': ft, 'sc': '6yzf', 'st': 'desc',
            'sd': sd, 'ed': ed, 'pi': str(page), 'pn': str(pn),
        }
        url = 'https://fund.eastmoney.com/data/rankhandler.aspx?' + urllib.parse.urlencode(p)
        t = get(url, referer='https://fund.eastmoney.com/data/fundranking.html', tries=2)
        if not t or 'datas:[' not in t:
            raise RuntimeError('排行请求失败或响应结构变化；不发布部分全市场样本：%s' % url)
        body = t[t.index('datas:[') + len('datas:['):]
        got = [r.split(',') for r in re.findall(r'"([^"]+)"', body)]
        fingerprint = tuple(r[0] for r in got)
        if got and fingerprint in seen_pages:
            raise RuntimeError('排行接口重复返回同一页；拒绝发布不完整样本')
        seen_pages.add(fingerprint)
        rows.extend(got)
        m = re.search(r'allRecords:(\d+)', t)
        total = int(m.group(1)) if m else None
        if not got and total is not None and len(rows) < total:
            raise RuntimeError('排行分页提前结束：%d/%d' % (len(rows), total))
        if not got or (total is not None and len(rows) >= total):
            break
        if page >= 100:
            raise RuntimeError('排行超过100页防护上限；保留旧样本而不静默截断')
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
    out = {'requestedAsOf': AS_OF, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'funds': {}}
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
            # 第 18 列 = 自定义区间（sd=10 年前 → ed=今天）累计涨幅。
            # 注意：基金成立不足 10 年时接口会把“成立以来”兜底填进这一列（数值与 rsince 相同），
            # 必须按成立日过滤，否则 3-7 年的新基金会显示一个假的“近10年”收益。
            est = f.get('estab') or ''
            if (dt != 'fb' and len(a) > 18 and a[18].strip()
                    and re.match(r'^\d{4}-\d{2}-\d{2}$', est) and est <= add_years(AS_OF, -10)):
                f['r10w'] = fnum(a[18])
        time.sleep(0.6)
    if not funds:
        raise RuntimeError('排行样本为空；保留旧数据')
    out['asof'] = max((f.get('navdate') or '' for f in funds.values()), default='') or None
    save_json(os.path.join(DATA, 'universe.json'), out)
    log('  ✓ 四榜合并去重后 %d 个代码（含各份额类别）' % len(funds))
    for dt, ft, label in SRC_LIST:
        n = sum(1 for f in funds.values() if '%s:%s' % (dt, ft) in f['srcs'])
        log('    %s：%d' % (label, n))


# ---------------------------------------------------------------- 2. 粗筛
# 份额不是质量排序。A/C费用结构应比较；I/Y等须核实投资者资格。
SHARE_TAIL = re.compile(r'(?<=[\u4e00-\u9fff）)])[A-Z]$')
# 分桶关键词（用于粗筛阶段判断类别，最终以接口 FTYPE 为准）
KW_BOND = ('债', '固收', '存单', '同业', '利率', '国债', '信用', '可转')
KW_MONEY = ('货币', '现金', '理财', '活期', '保证金')
KW_OVERSEAS = ('QDII', 'qdii', '海外', '全球', '美国', '纳斯达克', '标普', '港股', '恒生', 'H股', '中概',
               '亚洲', '欧洲', '日本', '印度', '越南', '德国', '法国', '新兴市场', '大中华', '中华',
               '美元', '现汇', '现钞', '港币')
KW_INDEX = ('指数', 'ETF', 'etf', 'LOF', '联接', '增强')

# 黄金属于独立配置资产；只用名称识别分类，不作为收益筛选排除项。
KW_METAL_NAME = re.compile(r'黄金(ETF|基金|主题|及贵金属|-QDII|QDII)|白银|上海金')


def page_codes():
    """统一快照 FUNDS 块里已经跟踪的基金代码。"""
    try:
        with open(SNAPSHOT, encoding='utf-8') as f:
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
    # 黄金和纯债是配置工具，不能以收益低为由从研究宇宙剔除。
    # 海外指数仅按代码去重，不按名称删除整个资产类别。
    return None


# 三至七年历史单独观察，不混入长期候选。
YOUNG_BUCKET = '新锐（3-7年）'


def years_between(est, ref=None):
    """成立日到 ref（默认 AS_OF）的年数。"""
    from datetime import date
    try:
        a = date(*[int(x) for x in (est or '').split('-')])
        b = date(*[int(x) for x in (ref or AS_OF).split('-')])
    except (ValueError, AttributeError):
        return None
    return (b - a).days / 365.25


def annualized(total_pct, years):
    """区间累计涨幅% → 年化%。"""
    if total_pct is None or years is None or years <= 0 or total_pct < -100:
        return None
    try:
        return ((1 + total_pct / 100.0) ** (1.0 / years) - 1) * 100
    except (OverflowError, ValueError):
        return None


def base_name(n):
    """去掉份额类别后缀，用于同一只基金不同份额的归并。"""
    n = re.sub(r'\s+', '', n)
    n = re.sub(r'[（(](QDII|LOF|FOF|ETF|人民币|美元现汇|美元现钞)[)）]', '', n)
    m = re.match(r'^(.*[\u4e00-\u9fff）)])([A-Z])$', n)
    return m.group(1) if m else n


def share_class(name):
    m = SHARE_TAIL.search(name or '')
    return m.group(0) if m else ''


def representative_key(rec):
    """优先可比较的普通份额；不按过去收益挑同基金份额。"""
    share = share_class(rec.get('name', ''))
    return ({'A': 0, '': 1, 'C': 2}.get(share, 3), rec.get('estab') or '9999', rec.get('code') or '')


def classify(name, srcs):
    """粗分类（最终以接口 FTYPE 为准）。"""
    if any(k in name for k in KW_MONEY):
        return '货币'
    if KW_METAL_NAME.search(name) or any(k in name for k in ('黄金9999', '上海金', '原油', '豆粕')):
        return '商品/黄金'
    is_qdii = any(s == 'kf:qdii' for s in srcs) or any(k in name for k in KW_OVERSEAS)
    is_bond = any(k in name for k in KW_BOND)
    if is_qdii and is_bond:
        return '债券/固收'
    if is_qdii:
        return 'QDII/海外'
    if is_bond:
        return '债券/固收'
    if any(s.startswith('fb:') for s in srcs):
        return '场内ETF/LOF'
    if 'FOF' in name.upper():
        return 'FOF'
    if any(s == 'kf:zs' for s in srcs) or any(k in name for k in KW_INDEX):
        return '指数/指数增强'
    return '国内权益'


def classify_enriched(rec, basic):
    """Fund type takes precedence over loose name keywords and trading venue."""
    name = rec.get('full_name') or rec.get('name') or ''
    ftype = basic.get('ftype') or ''
    if '货币' in ftype:
        bucket = '货币'
    elif '债券' in ftype or '固收' in ftype:
        bucket = '债券/固收'
    elif '商品' in ftype or KW_METAL_NAME.search(name):
        bucket = '商品/黄金'
    elif 'QDII' in ftype:
        bucket = 'QDII/海外'
    elif 'FOF' in ftype:
        bucket = 'FOF'
    elif '指数' in ftype:
        bucket = '场内ETF/LOF' if any(s.startswith('fb:') for s in rec.get('srcs', [])) else '指数/指数增强'
    else:
        bucket = classify(name, rec.get('srcs') or [])
    if (rec.get('years') or 0) < 7 and bucket not in ('债券/固收', '商品/黄金', '货币'):
        return YOUNG_BUCKET
    return bucket


def cmd_prefilter(args):
    """研究池不按历史涨幅截取；默认候选在 policy 阶段独立产生。"""
    ensure_dirs()
    uni = load_json(os.path.join(DATA, 'universe.json'))
    if not uni or not uni.get('funds'):
        raise RuntimeError('缺少全市场排行，先运行 universe；保留已有研究池')
    ref = uni.get('asof') or AS_OF
    groups, exclusions = {}, {}
    page = page_codes()
    for code, fund in uni['funds'].items():
        name = fund.get('name') or ''
        reason = exclusion_reason({'code': code, 'name': name}, page)
        if any(k in name for k in ('美元', '现汇', '现钞', '港币', '欧元', '英镑')):
            reason = '同基金外币份额不重复列入人民币研究池'
        if reason:
            exclusions[reason] = exclusions.get(reason, 0) + 1
            continue
        groups.setdefault(base_name(name), []).append(fund)
    kept, counts = [], {}
    for name, members in groups.items():
        rep = min(members, key=representative_key)
        yrs = years_between(rep.get('estab'), ref)
        bucket = classify(name, rep.get('srcs') or [])
        if yrs is None or yrs < 3 or bucket == '货币':
            why = '成立不足3年或缺少成立日' if bucket != '货币' else '货币工具单列现金管理'
            exclusions[why] = exclusions.get(why, 0) + 1
            continue
        # Retain defensive assets even when their recent return is modest or
        # negative. No recent-return leaderboard limits the research universe.
        if yrs < 7 and bucket not in ('债券/固收', '商品/黄金'):
            bucket = YOUNG_BUCKET
        rec = dict(rep)
        rec.update(full_name=rep['name'], name=name, bucket=bucket, years=yrs,
                   a5=annualized(rep.get('r5w'), 5) if yrs >= 5 else None,
                   a10=annualized(rep.get('r10w'), 10) if yrs >= 10 else None,
                   asince=annualized(rep.get('rsince'), yrs),
                   siblings=[m['code'] for m in members if m['code'] != rep['code']])
        kept.append(rec)
        counts[bucket] = counts.get(bucket, 0) + 1
    kept.sort(key=lambda x: (x['bucket'], x['code']))
    out = dict(asof=ref, requestedAsOf=AS_OF, kept=kept, counts=counts, excluded=exclusions,
               policy='v2: 成立至少3年、人民币份额去重；不按历史收益过滤、不设PAGE_CAP；候选另行分层')
    save_json(os.path.join(DATA, 'shortlist.json'), out)
    log('  ✓ 研究池 %d 只；候选在 policy 阶段依据资料、风险、费用与集中度独立产生' % len(kept))


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
    if os.path.exists(path) and not refresh and time.time() - os.path.getmtime(path) < 86400 * 7:
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
    d['fetchedAt'] = datetime.now(timezone.utc).isoformat()
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


def enriched_needs_refresh(previous, current, now=None):
    """Legacy cached team histories must migrate even inside the normal TTL."""
    if not previous or not previous.get('basic'):
        return True
    manager = previous.get('manager_info') or {}
    if manager.get('managerStartBasis') != 'explicit_individual_appointment' or not manager.get('managerRecords'):
        return True
    now = now or datetime.now(timezone.utc)
    for observed in (previous.get('fetchedAt'), manager.get('managerCheckedAt')):
        try:
            age = (now - datetime.fromisoformat(observed)).total_seconds()
            if age < 0 or age > 86400 * 7:
                return True
        except (ValueError, TypeError):
            return True
    return previous.get('bucket') != current.get('bucket') or bool(previous.get('forced')) != bool(current.get('forced'))


def cmd_enrich(args):
    ensure_dirs()
    sl = load_json(os.path.join(DATA, 'shortlist.json'))
    if not sl:
        raise RuntimeError('缺少研究池输入，先运行 prefilter')
    out = load_json(os.path.join(DATA, 'enriched.json')) or {'asof': AS_OF, 'funds': {}}
    funds = out['funds']
    todo = [x for x in sl['kept'] if args.refresh or enriched_needs_refresh(funds.get(x['code']), x)]
    workers = max(1, int(getattr(args, 'workers', 1) or 1))
    log('  待补 %d 只（缓存 %d 只，并发 %d）' % (len(todo), len(funds), workers))

    def one(x):
        code = x['code']
        prev = funds.get(code) or {}
        b = basic_fetch(code, refresh=args.refresh)
        if not b:
            raise RuntimeError('基础信息抓取失败，旧值保持原日期')
        rows = jjjl_fetch(code, refresh=args.refresh)
        cur = next((r for r in (rows or []) if r['end'] == '至今'), None)
        manager_info = U.manager_fetch(code, refresh=args.refresh)
        rec = dict(x)
        rec['basic'] = b
        rec['bucket'] = classify_enriched(rec, b)
        rec['manager_hist'] = rows
        rec['manager_info'] = manager_info
        rec['cur_managers'] = [person['name'] for person in manager_info.get('managerRecords', [])] or (cur or {}).get('names') or []
        rec['legacy_cur_start'] = (cur or {}).get('start')
        rec['cur_start'] = manager_info.get('mstart')
        rec['cur_ret'] = (cur or {}).get('ret')
        cut5 = add_years(AS_OF, -5)
        rec['mgr_changes_5y'] = sum(1 for r in (rows or []) if r['start'] >= cut5)
        rec['mgr_since_fund'] = len(rows or [])
        rec['fetchedAt'] = datetime.now(timezone.utc).isoformat()
        return code, rec

    from concurrent.futures import ThreadPoolExecutor, as_completed
    done = 0
    failures = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, x): x for x in todo}
        for fut in as_completed(futs):
            try:
                code, rec = fut.result()
            except Exception as e:  # noqa: BLE001
                log('  !! %s 补基础信息失败：%s' % (futs[fut].get('code'), e))
                failures[futs[fut]['code']] = str(e)
                continue
            funds[code] = rec
            done += 1
            if done % 10 == 0 or done == len(todo):
                log('    ... %d/%d' % (done, len(todo)))
                save_json(os.path.join(DATA, 'enriched.json'), out)
    out['asof'] = sl.get('asof')
    out['errors'] = failures
    save_json(os.path.join(DATA, 'enriched.json'), out)
    ok = sum(1 for f in funds.values() if f.get('basic'))
    log('  ✓ 基础信息完整 %d / %d' % (ok, len(funds)))
    if failures:
        raise RuntimeError('%d只基金补充失败；已保存成功项，失败项保持原始日期' % len(failures))


# ---------------------------------------------------------------- 4. 历史净值 + 自算指标
def build_series(rows):
    """兼容现有四元组调用，复权算法只维护 update.total_return_series 一份。"""
    return [(day, wealth, wealth, wealth) for day, wealth in U.total_return_series(rows)]


def _stats(win):
    """窗口内 [(date, T)] → 年化波动、最大回撤、滚动3年正收益占比。"""
    if len(win) < 60:
        return None
    lr = [math.log(win[i][1] / win[i - 1][1]) for i in range(1, len(win)) if win[i - 1][1] > 0]
    mean = sum(lr) / len(lr)
    var = sum((x - mean) ** 2 for x in lr) / (len(lr) - 1)
    vol = math.sqrt(var) * math.sqrt(252) * 100
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
    full_history, history_note = True, None
    ordered = sorted(rows or [], key=lambda r: r.get('FSRQ', ''))
    try:
        ser = build_series(ordered)
    except ValueError as exc:
        # A gap before every requested window must not invalidate valid recent
        # windows. It does invalidate any claim about since-inception history.
        if not ordered:
            raise
        cutoff = add_years(ordered[-1]['FSRQ'], -10)
        before = [r for r in ordered if r.get('FSRQ', '') <= cutoff]
        relevant = before[-1:] + [r for r in ordered if r.get('FSRQ', '') > cutoff]
        ser = build_series(relevant)  # A gap inside the requested period still fails.
        full_history = False
        history_note = '更早历史未通过连续性校验，只复核最近完整10年窗口；成立以来收益和全历史风险不可用。' + str(exc)
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
        gap = (date.fromisoformat(b) - date.fromisoformat(base_date)).days
        if gap > 15:
            return None
        actual_years = (date.fromisoformat(latest) - date.fromisoformat(base_date)).days / 365.2425
        return {'ret': ret * 100, 'cagr': ((1 + ret) ** (1.0 / actual_years) - 1) * 100,
                'base_date': base_date}

    out = {'code': None, 'latest': latest, 'first': ser[0][0], 'rows': len(ser), 'periods': [],
           'historyComplete': full_history, 'historyNote': history_note,
           'rawFirst': ordered[0].get('FSRQ') if ordered else None}
    for n in (1, 2, 3, 5, 8, 10):
        w = window_ret(n)
        if w:
            out['ret%d' % n] = w['ret']
            out['cagr%d' % n] = w['cagr']
        out['periods'].append(dict(years=n, start=w['base_date'] if w else None, end=latest))
    # 成立以来年化
    days = (ser[-1][0] > ser[0][0]) and len(ser)
    if days and full_history:
        d0 = date(*[int(x) for x in ser[0][0].split('-')])
        d1 = date(*[int(x) for x in ser[-1][0].split('-')])
        yrs = (d1 - d0).days / 365.2425
        if yrs > 0.5:
            out['cagr_since'] = ((Tend / ser[0][2]) ** (1 / yrs) - 1) * 100
            out['years'] = yrs
    # 窗口统计
    for n in (5, 10):
        b = add_years(latest, -n)
        before = [(d, t) for d, dw, t, lj in ser if d <= b]
        if not before or (date.fromisoformat(b) - date.fromisoformat(before[-1][0])).days > 15:
            continue
        win = [before[-1]] + [(d, t) for d, dw, t, lj in ser if d > b]
        if len(win) < n * 180 or any((date.fromisoformat(d2) - date.fromisoformat(d1)).days > 20
                                    for (d1, _), (d2, _) in zip(win, win[1:])):
            continue
        st = _stats(win)
        if st:
            out['vol%d' % n] = st['vol']
            out['mdd%d' % n] = st['mdd']
            out['mdd%d_date' % n] = st['mdd_date']
            out['risk%dFirst' % n] = win[0][0]
    st_all = _stats([(d, t) for d, dw, t, lj in ser])
    if st_all and full_history:
        out['mdd_all'] = st_all['mdd']
        out['mdd_all_date'] = st_all['mdd_date']
    # 分年度收益（复权口径：上一年末点位 → 当年末点位）
    year_ends = {}
    for d, _dw, t, _lj in ser:
        year_ends[int(d[:4])] = t
    yearly = {str(y): (t / year_ends[y - 1] - 1) * 100
              for y, t in year_ends.items() if y - 1 in year_ends}
    out['yearly'] = yearly
    out['yearlyPartial'] = latest[:4]
    out['basis'] = 'provider_daily_return_or_explicit_actions'
    return out


def cmd_metrics(args):
    ensure_dirs()
    en = load_json(os.path.join(DATA, 'enriched.json'))
    if not en:
        raise RuntimeError('缺少基础信息，先运行 enrich')
    out = load_json(os.path.join(DATA, 'metrics.json')) or {'asof': AS_OF, 'funds': {}}
    funds = out['funds']
    todo = [f for f in en['funds'].values() if args.refresh or f['code'] not in funds
            or (funds.get(f['code']) or {}).get('basis') != 'provider_daily_return_or_explicit_actions']
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
    workers = max(1, int(getattr(args, 'workers', 1) or 1))

    def one(f):
        code = f['code']
        rows = U.history_fetch(code)
        m = deep_metrics(rows) if rows else None
        if m:
            m['code'] = code
            save_json(os.path.join(CACHE, 'metrics', code + '.json'), m)
        return code, f.get('name'), m

    from concurrent.futures import ThreadPoolExecutor, as_completed
    done = 0
    failures = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, f): f for f in todo}
        for fut in as_completed(futs):
            try:
                code, name, m = fut.result()
            except Exception as e:  # noqa: BLE001
                log('  !! %s 历史净值失败：%s' % (futs[fut].get('code'), e))
                failures[futs[fut]['code']] = str(e)
                continue
            if m:
                funds[code] = m
            else:
                log('  !! %s %s 无历史数据' % (code, name))
                failures[code] = '无有效历史数据'
            done += 1
            if done % 5 == 0 or done == len(todo):
                save_json(os.path.join(DATA, 'metrics.json'), out)
                log('    ... %d/%d' % (done, len(todo)))
    out['asof'] = max((m.get('latest') or '' for m in funds.values()), default='') or None
    out['errors'] = failures
    save_json(os.path.join(DATA, 'metrics.json'), out)
    if getattr(args, 'codes', None):
        save_json(os.path.join(DATA, 'enriched.json'), en)
    if failures:
        raise RuntimeError('%d只基金历史复权未完成；失败项未伪装为已更新' % len(failures))
    log('  ✓ 指标完成 %d 只' % len(funds))


def _pct_rank(vals):
    """把一组数值映射成 0~1 的分位（越大越好；缺值按最差分位 0 处理）。"""
    idx = sorted(range(len(vals)),
                 key=lambda i: (vals[i] is not None, vals[i] if vals[i] is not None else 0))
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


# 参照基准（A股宽基，不参与打分；不随短名单变化，单独放行）
BENCH_CODES = ('510300', '159915', '000961')


def assemble():
    en = (load_json(os.path.join(DATA, 'enriched.json')) or {}).get('funds', {})
    mt = (load_json(os.path.join(DATA, 'metrics.json')) or {}).get('funds', {})
    sl = load_json(os.path.join(DATA, 'shortlist.json')) or {}
    keep = {x['code'] for x in (sl.get('kept') or [])}
    rows = []
    for code, f in en.items():
        if keep and code not in keep and code not in BENCH_CODES:
            continue  # 已不在当前入池名单里的历史记录（门槛/口径变了）不再输出
        if any(k in (f.get('full_name') or f.get('name') or '') for k in ('美元', '现汇', '现钞', '港币')):
            continue  # 同一基金的美元份额与人民币份额重复，仅保留人民币份额
        b = f.get('basic') or {}
        m = mt.get(code) or {}
        if not m:
            continue
        scale = fnum(b.get('scale'))
        manager_info = f.get('manager_info') or {}
        tenure = manager_info.get('mten')
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
            'r10_api': f.get('r10w'),
            'cagr1': m.get('cagr1'), 'cagr3': m.get('cagr3'), 'cagr5': m.get('cagr5'),
            'cagr8': m.get('cagr8'), 'cagr10': m.get('cagr10'), 'cagr_since': m.get('cagr_since'),
            # 供应商区间值仅供与统一复权结果核对，不用于替换缺失窗口。
            'a5_api': annualized(f.get('r5w'), 5),
            'a10_api': annualized(f.get('r10w'), 10) if f.get('r10w') is not None else None,
            'asince_api': annualized(f.get('rsince'), m.get('years')),
            'r1y_2': fnum(b.get('r2y')), 'r3y_api': fnum(b.get('r3y')), 'rtd_api': fnum(b.get('rytd')),
            'vol5': m.get('vol5'), 'vol10': m.get('vol10'),
            'mdd5': m.get('mdd5'), 'mdd10': m.get('mdd10'), 'mdd_all': m.get('mdd_all'),
            'yearly': m.get('yearly') or {}, 'latest': m.get('latest'), 'basis': m.get('basis'),
            'returnPeriods': [period for period in m.get('periods', []) if period['years'] in (1, 2, 3, 5, 10)],
            'invest': b.get('invest'), 'siblings': f.get('siblings') or [],
            'buy': b.get('buy'), 'forced': bool(f.get('forced')),
        })
        rows[-1].update(manager_info)
        y = rows[-1]['yearly']
        if y:
            k = max(y, key=lambda t: y[t])
            rows[-1]['max_year_key'], rows[-1]['max_year'] = k, y[k]
        # 对外展示使用同一条可追溯复权序列；供应商区间值仅作独立核对。
        row = rows[-1]
        row['a5'] = row['cagr5']
        row['a10'] = row['cagr10']
        row['asince'] = row['cagr_since']
    return rows


# 最终入选规则（可在报告里解释）：硬门槛 + 分桶打分
# 终选硬门槛：规模 / 近5年最大回撤 / 现任经理任职年限 + 多周期年化（近5年 or 近10年 or 成立来，任一项达标）
HARD = {
    '国内权益': {'min_scale': 1.0, 'min_mdd5': -70.0, 'min_tenure': 0.5,
                 'any_cagr': {'cagr5': 15.0, 'cagr10': 7.0, 'cagr_since': 8.0}},
    'QDII/海外': {'min_scale': 1.0, 'min_mdd5': -75.0, 'min_tenure': 0.5,
                  'any_cagr': {'cagr5': 13.0, 'cagr10': 6.5, 'cagr_since': 7.5}},
    '指数/指数增强': {'min_scale': 0.5, 'min_mdd5': -70.0, 'min_tenure': None,
                      'any_cagr': {'cagr5': 15.0, 'cagr10': 7.0, 'cagr_since': 8.0}},
    '场内ETF/LOF': {'min_scale': 2.0, 'min_mdd5': -70.0, 'min_tenure': None,
                    'any_cagr': {'cagr5': 15.0, 'cagr10': 7.0, 'cagr_since': 8.0}},
    '债券/固收': {'min_scale': 1.0, 'min_mdd5': -30.0, 'min_tenure': 0.5,
                  'any_cagr': {'cagr5': 6.0, 'cagr10': 4.5, 'cagr_since': 5.0}},
    'FOF': {'min_scale': 1.0, 'min_mdd5': -45.0, 'min_tenure': None,
            'any_cagr': {'cagr5': 8.0, 'cagr10': 5.0, 'cagr_since': 6.0}},
    # 新锐档：成立 3-7 年，用成立以来年化把关（不设近10年口径）
    YOUNG_BUCKET: {'min_scale': 1.0, 'min_mdd5': -70.0, 'min_tenure': 0.5,
                   'any_cagr': {'cagr5': 25.0, 'cagr_since': 18.0}},
}
# 旧历史研究评分保留供复核；页面候选只由 build_policy 产生。

def pick(rows):
    """旧口径历史研究分（非推荐分）；默认候选只由 build_policy 生成。"""
    out = {}
    other_map = {}
    page = page_codes()
    for bucket, recs in _group_by(rows, lambda r: r['bucket']).items():
        hard = HARD.get(bucket)
        if not hard:
            continue
        passed = []
        for r in recs:
            if r.get('forced'):
                passed.append(r)  # 用户手动指定纳入：不受排除规则与硬门槛限制（数据不全时排在后面）
                continue
            if exclusion_reason(r, page):
                continue
            # 暂停申购的基金也保留（状态列会显示"暂停申购"），避免"因为暂时买不到就从长期名单里消失"
            if r.get('scale') is not None and r['scale'] < hard['min_scale']:
                continue
            if r.get('scale') is None:
                continue
            ac = hard.get('any_cagr') or {}
            if ac:
                key_map = {'cagr5': 'a5', 'cagr10': 'a10', 'cagr_since': 'asince'}
                hit = [k for k, v in ac.items()
                       if r.get(key_map[k]) is not None and r[key_map[k]] >= v]
                if not hit:
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
            passed.append(r)
        if not passed:
            out[bucket] = []
            continue
        # 分位打分
        p5 = _pct_rank([r['a5'] for r in passed])
        p10 = _pct_rank([(r['a10'] if r['a10'] is not None else r['asince']) for r in passed])
        psince = _pct_rank([(r['asince'] if r['asince'] is not None else -99) for r in passed])
        pmdd = _pct_rank([(r['mdd5'] if r['mdd5'] is not None else -99) for r in passed])
        pscale = _pct_rank([math.log10(max(r['scale'] or 0.01, 0.01)) for r in passed])
        if bucket in ('指数/指数增强', '场内ETF/LOF'):
            pfee = _pct_rank([-(fnum(str(r.get('fee_now') or 0).replace('%', '')) or 0) for r in passed])
            for i, r in enumerate(passed):
                r['score'] = 100 * (0.25 * p5[i] + 0.25 * p10[i] + 0.15 * psince[i] +
                                    0.20 * pmdd[i] + 0.05 * pscale[i] + 0.10 * pfee[i])
        elif bucket == YOUNG_BUCKET:
            # 新锐档没有近5/10年数据，按 成立来年化 45% + 回撤 30% + 规模 10% + 经理任职 15% 打分
            pten = _pct_rank([(r.get('tenure') or 0) for r in passed])
            for i, r in enumerate(passed):
                r['score'] = 100 * (0.45 * psince[i] + 0.30 * pmdd[i] +
                                    0.10 * pscale[i] + 0.15 * pten[i])
        else:
            pten = _pct_rank([(r.get('tenure') or 0) for r in passed])
            for i, r in enumerate(passed):
                r['score'] = 100 * (0.25 * p5[i] + 0.25 * p10[i] + 0.15 * psince[i] +
                                    0.20 * pmdd[i] + 0.05 * pscale[i] + 0.10 * pten[i])
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


# ---------------------------------------------------------------- 研究分层（与历史收益评分分离）
POLICY_DEFAULTS = dict(minA3=5, minA5=8, minHistoryYears=7, minScale=1, minManagerYears=5, maxShortlist=24)
POLICY_RULES = [
    '公开权益研究默认条件：至少7年历史、规模至少1亿元、近3年年化至少5%、近5年年化至少8%；页面可调整收益门槛。',
    '主动基金至少一位现任经理在本基金连续任满5年；逐人使用明确上任日期。其他现任经理任期较短会单独提示，基金业绩不归因于某个人。',
    '默认按近5年年化降序；同时展示3年和10年，缺10年不填成立以来。回撤、波动、费用、申购状态是独立研究证据，不按低回撤跨资产排总榜。',
    '默认最多24只，同经理最多2只、同公司最多3只、同策略或同指数工具最多1只；可以展开全部符合数值条件的基金，集中度限制不删除研究记录。',
    '债券及偏债混合、红利、显式行业主题、商品分别设研究入口，不占权益默认候选名额。灵活配置基金保留股票仓位需核实的提示。',
    '费用缺失保持未知，暂停申购不等于缺乏研究价值；A/C等份额先去同策略重复，I/Y等其他份额需核实资格。',
    '新进入条件筛选的基金不自动视为已核验；历史研究分不参与排序。旧池有幸存者与收益预筛偏差，不代表全市场，也不是投资建议。',
]


def parse_js_record(line):
    """Parse the small data-literal subset used by the snapshot, never execute JS."""
    import ast
    token = re.compile(r'''\s*(?:('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][\w$]*)|([{}\[\],:]))''')
    source = line.strip().rstrip(',')
    tokens, pos = [], 0
    while pos < len(source):
        match = token.match(source, pos)
        if not match:
            raise ValueError('快照中有不支持的数据表达式：' + source[pos:pos + 30])
        string, number, name, symbol = match.groups()
        tokens.append(('string', ast.literal_eval(string)) if string else
                      ('value', json.loads(number)) if number else ('name', name) if name else ('symbol', symbol))
        pos = match.end()
    cursor = 0

    def read():
        nonlocal cursor
        if cursor >= len(tokens):
            raise ValueError('快照数据意外结束')
        kind, value = tokens[cursor]
        cursor += 1
        if kind in ('string', 'value'):
            return value
        if kind == 'name' and value in ('null', 'true', 'false'):
            return {'null': None, 'true': True, 'false': False}[value]
        if value in ('{', '['):
            closing, result = ('}', {}) if value == '{' else (']', [])
            while cursor < len(tokens) and tokens[cursor][1] != closing:
                if isinstance(result, dict):
                    key_kind, key = tokens[cursor]
                    cursor += 1
                    if key_kind not in ('name', 'string') or cursor >= len(tokens) or tokens[cursor][1] != ':':
                        raise ValueError('快照对象字段无效')
                    if key in result:
                        raise ValueError('快照对象字段重复：' + key)
                    cursor += 1
                    result[key] = read()
                else:
                    result.append(read())
                if cursor < len(tokens) and tokens[cursor][1] == ',':
                    cursor += 1
                elif cursor >= len(tokens) or tokens[cursor][1] != closing:
                    raise ValueError('快照字段缺少分隔符')
            if cursor >= len(tokens):
                raise ValueError('快照数组或对象未闭合')
            cursor += 1
            return result
        raise ValueError('快照值不是数据字面量')

    result = read()
    if cursor != len(tokens) or not isinstance(result, dict):
        raise ValueError('快照记录包含多余表达式')
    return result


def parse_snapshot_extra(path=SNAPSHOT, text=None):
    """Read our data-only JS records, including dated individual-manager arrays."""
    text = Path(path).read_text(encoding='utf-8') if text is None else text
    match = re.search(r'var\s+EXTRA\s*=\s*\[(.*?)\n\];', text, re.S)
    if not match:
        raise RuntimeError('统一快照缺少可解析的 EXTRA 数据块')
    records = []
    for line in match.group(1).splitlines():
        if not line.lstrip().startswith('{'):
            continue
        rec = parse_js_record(line)
        if rec.get('c'):
            records.append(rec)
    if not records or len({r['c'] for r in records}) != len(records):
        raise RuntimeError('研究池为空或出现重复基金代码；拒绝生成筛选策略')
    return records


def write_extra_fields(changes):
    """Patch only successful EXTRA rows, re-reading other agents' blocks at commit."""
    src = Path(SNAPSHOT).read_text(encoding='utf-8')
    match = re.search(r'/\*__DATA_EXTRA_BEGIN__\*/.*?/\*__DATA_EXTRA_END__\*/', src, re.S)
    if not match:
        raise RuntimeError('缺少 EXTRA 标记，拒绝写入')
    lines = []
    for line in match.group(0).splitlines():
        cm = re.search(r"\bc:'(\d{6})'", line)
        if cm and cm.group(1) in changes:
            row = parse_js_record(line)
            row.update(changes[cm.group(1)])
            line = '{' + ','.join(key + ':' + (js_str(value) if isinstance(value, str)
                                else json.dumps(value, ensure_ascii=False, separators=(',', ':')))
                                for key, value in row.items()) + '},'
        lines.append(line)
    temp = Path(SNAPSHOT).with_suffix('.extra.tmp')
    temp.write_text(src[:match.start()] + '\n'.join(lines) + src[match.end():], encoding='utf-8')
    temp.replace(SNAPSHOT)


def cmd_managers(args):
    """Verify each person's appointment date; historical team dates stay labelled."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    records = {row['c']: row for row in parse_snapshot_extra()}
    codes = list(records) if args.codes == 'all' else [code.strip() for code in args.codes.split(',') if code.strip()]
    changes, failures = {}, {}
    import threading
    pacing_lock, last_request = threading.Lock(), [0.0]

    def one(code):
        cached = U.load_json(os.path.join(U.MANAGER_DIR, code + '.json'), {})
        cache_fresh = False
        if cached.get('fetchedAt'):
            try:
                cache_fresh = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['fetchedAt'])).total_seconds() < 86400 * 7
            except (ValueError, TypeError):
                pass
        if not U.OFFLINE and (getattr(args, 'refresh', False) or not cache_fresh):
            with pacing_lock:
                time.sleep(max(0, .5 - (time.monotonic() - last_request[0])))
                last_request[0] = time.monotonic()
        result = U.manager_fetch(code, refresh=getattr(args, 'refresh', False))
        if not result.get('managerRecords'):
            raise RuntimeError('缺少明确个人上任日期；不能用团队组合起点代替')
        row = records[code]
        result['legacyManagerStart'] = row.get('legacyManagerStart', row.get('mstart'))
        result['legacyManagerTenure'] = row.get('legacyManagerTenure', row.get('mten'))
        return result

    with ThreadPoolExecutor(max_workers=max(1, min(2, args.workers))) as executor:
        futures = {executor.submit(one, code): code for code in codes}
        for future in as_completed(futures):
            code = futures[future]
            try:
                changes[code] = future.result()
            except (OSError, RuntimeError, ValueError, KeyError, TypeError) as exc:
                failures[code] = str(exc)
            if (len(changes) + len(failures)) % 100 == 0:
                log('  个人经理资料：成功 %d，待补 %d，目标 %d' % (len(changes), len(failures), len(codes)))
    if changes:
        write_extra_fields(changes)
    output = Path(ROOT) / 'data' / 'screening-manager-validation.json'
    save_json(str(output), dict(checkedAt=datetime.now(timezone.utc).isoformat(), requested=len(codes),
                               checked=len(changes), failures=failures,
                               records={code: {key: val for key, val in row.items() if key.startswith('manager')}
                                        for code, row in changes.items()}))
    log('  ✓ 个人经理资料 %d / %d；原团队起点保留在 legacyManagerStart' % (len(changes), len(codes)))
    if failures:
        raise RuntimeError('%d只经理资料未取得，原资料保留且不升级为个人任期核验' % len(failures))
    return changes


def calendar_years(start, end):
    """Completed anniversaries plus the fraction of the current calendar year."""
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
        if last < first:
            return None
        completed = last.year - first.year
        if add_years(start, completed) > end:
            completed -= 1
        anniversary = date.fromisoformat(add_years(start, completed))
        next_anniversary = date.fromisoformat(add_years(start, completed + 1))
        return completed + (last - anniversary).days / (next_anniversary - anniversary).days
    except (ValueError, TypeError):
        return None


THEME_WORDS = ('半导体|集成电路|通信|科技|芯片|医药|医疗|银行|煤炭|石油|油气|能源|军工|国防|新能源|消费|资源|有色|电子|信息|互联网|'
               '移动互联|人工智能|大数据|传媒|TMT|金银珠宝|金融地产|房地产|证券|券商|汽车|材料|农业|家电|'
               '白酒|计算机|生物|光伏|稀土|机器人|5G|储能|电力|碳中和|交通|运输|物流|环保|教育|健康|文娱|文体|娱乐|主题|战略新兴|新兴产业')


def research_category(name, fund_type, index_name, bucket):
    combined = name + ' ' + fund_type + ' ' + index_name
    if bucket == 'x6':
        return 'reference'
    if '债' in fund_type or '债券' in name or '存单' in combined:
        return 'fixed_income'
    if '商品' in fund_type or any(word in name for word in ('黄金ETF', '上海金', '黄金9999')):
        return 'commodity'
    if 'FOF' in fund_type:
        return 'fof'
    if '红利' in combined:
        return 'dividend'
    if re.search(THEME_WORDS, combined, re.I):
        return 'theme'
    return 'equity'


def research_record(raw, supplement=None):
    """Normalize facts without using old UI buckets as asset classifications."""
    old = supplement or {}
    code = raw.get('c') or raw.get('code')
    name = raw.get('n') or raw.get('name') or code
    bucket = raw.get('g') or dict(XB_KEYS).get(raw.get('bucket'), 'x6')
    returns = raw.get('r') or []
    periods = {period.get('years'): period for period in raw.get('returnPeriods', [])}
    annual, annual_basis = {}, {}
    for i, year in enumerate((1, 2, 3, 5, 10)):
        period = periods.get(year) or {}
        span, basis = year, 'nominal_years_dates_unconfirmed'
        if period.get('start') and period.get('end'):
            try:
                span = (date.fromisoformat(period['end']) - date.fromisoformat(period['start'])).days / 365.2425
                anniversary = add_years(period['end'], -year)
                complete = period['start'] <= anniversary and (date.fromisoformat(anniversary) - date.fromisoformat(period['start'])).days <= 15
                basis = 'actual_days/365.2425' if complete and span > 0 else 'incomplete_period'
            except (ValueError, TypeError):
                basis = 'invalid_period'
        annual[year] = (annualized(returns[i], span) if len(returns) > i else
                        fnum(raw.get('a%d' % year) if raw.get('a%d' % year) is not None else raw.get('cagr%d' % year)))
        if basis in ('incomplete_period', 'invalid_period'):
            annual[year] = None
        annual_basis[str(year)] = dict(basis=basis, start=period.get('start'), end=period.get('end'), years=span)
    latest = raw.get('returnAsOf') or raw.get('latest') or raw.get('navdate') or old.get('latest')
    estab = raw.get('d') or raw.get('estab') or old.get('estab')
    years = calendar_years(estab, latest)
    for year in (1, 2, 3, 5, 10):
        if years is None or years < year:
            annual[year] = None
    ftype = raw.get('ftype') or old.get('ftype') or raw.get('ix') or ''
    index_name = raw.get('index_name') or old.get('index_name') or raw.get('ix') or ''
    combined = name + ' ' + ftype + ' ' + index_name
    passive = ('指数' in combined or 'ETF' in name) and '增强' not in combined
    category = research_category(name, ftype, index_name, bucket)
    # A-share indices published by Hang Seng are still domestic A-share tools.
    region = ('cn' if 'A股' in index_name else 'overseas' if 'QDII' in ftype or
              re.search('日经|日本|美国|标普|纳斯达克|欧洲|全球|亚洲|香港|港股', index_name) else
              'cn_hk' if '沪港深' in combined else 'cn')
    people = raw.get('managerRecords') or []
    managers = [person['name'] for person in people if person.get('name')] if people else [name.strip() for name in
                re.split(r'[,，、]+', raw.get('mgr') or raw.get('managers') or old.get('managers') or '') if name.strip()]
    manager_asof = raw.get('managerAsOf')
    manager_years = [calendar_years(person.get('start'), manager_asof) for person in people]
    manager_explicit = raw.get('managerStartBasis') == 'explicit_individual_appointment' and bool(people)
    known_years = [value for value in manager_years if value is not None] if manager_explicit else []
    tenure = max(known_years) if known_years else None
    min_tenure = min(known_years) if len(known_years) == len(people) and people else None
    fee = raw.get('fee')
    fee_names = ('管理费', '托管费', '销售服务费')
    fee_missing = [label for i, label in enumerate(fee_names) if not fee or len(fee) <= i or fee[i] is None]
    fee_known = sum(value for value in (fee or [])[:3] if value is not None)
    strategy = ('index:' + re.sub(r'\s|（价格）|\(价格\)', '', index_name) if passive and index_name else
                'fund:' + base_name(name))
    role = {'fixed_income': '债券及偏债混合', 'commodity': '商品研究', 'dividend': '红利风格',
            'theme': '行业主题', 'fof': 'FOF研究', 'reference': '参考基准'}.get(category) or (
            '海外权益' if region == 'overseas' else '权益指数工具' if passive else '主动混合（仓位可变）' if '混合' in ftype else '主动权益')
    interval_years, interval_basis = {}, {}
    for older, recent, nominal in ((5, 3, 2), (10, 5, 5)):
        first, last = periods.get(older) or {}, periods.get(recent) or {}
        interval_years[nominal], interval_basis[nominal] = nominal, 'nominal_years_dates_unconfirmed'
        if first.get('start') and last.get('start') and first.get('end') == last.get('end'):
            try:
                span = (date.fromisoformat(last['start']) - date.fromisoformat(first['start'])).days / 365.2425
                if span > 0:
                    interval_years[nominal], interval_basis[nominal] = span, 'actual_days/365.2425'
            except (ValueError, TypeError):
                interval_basis[nominal] = 'invalid_period_dates'
    prior2 = (((1 + returns[3] / 100) / (1 + returns[2] / 100)) ** (1 / interval_years[2]) - 1) * 100 if len(returns) > 3 and all(
        returns[i] is not None and returns[i] > -100 for i in (2, 3)) and annual[5] is not None else None
    prior5 = (((1 + returns[4] / 100) / (1 + returns[3] / 100)) ** (1 / interval_years[5]) - 1) * 100 if len(returns) > 4 and all(
        returns[i] is not None and returns[i] > -100 for i in (3, 4)) and annual[10] is not None else None
    return dict(code=code, name=name, bucket=bucket, category=category, region=region, managers=managers,
                managerRecords=people, managerExplicit=manager_explicit, managerAsOf=manager_asof,
                company=raw.get('company') or old.get('company') or '', tenure=tenure, minTenure=min_tenure,
                years=years, a3=annual[3], a5=annual[5], a10=annual[10], annualization=annual_basis,
                prior2=prior2, prior5=prior5, intervalYears=interval_years, intervalBasis=interval_basis,
                mdd5=fnum(raw.get('mdd5')), vol5=fnum(raw.get('vol5')), scale=fnum(raw.get('sz') if 'sz' in raw else raw.get('scale')),
                fee=fee, feeAnnual=fee_known if not fee_missing else None, feeKnownAnnual=fee_known, feeMissing=fee_missing,
                status=raw.get('st') or raw.get('sgzt') or old.get('sgzt') or '',
                shareClass=share_class(name), passive=passive, theme=category == 'theme', role=role,
                strategy=strategy, latest=latest, score=fnum(raw.get('score')),
                legacy=(raw.get('basis') or raw.get('returnBasis')) != 'provider_daily_return_or_explicit_actions')


def build_policy(records, supplements=None):
    supplements = supplements or {}
    normalized = [research_record(row, supplements.get(row.get('c') or row.get('code'))) for row in records]
    # Missing ten-year history never becomes a low score or an invented return.
    ranked = sorted(normalized, key=lambda row: (-(row['a5'] if row['a5'] is not None else -math.inf),
                                                row['code']))
    by_code, eligible = {}, []
    latest = max((row['latest'] or '' for row in normalized), default='')
    category_counts = {}
    for rank, row in enumerate(ranked, 1):
        flags, blocking = [], []
        category_counts[row['category']] = category_counts.get(row['category'], 0) + 1
        equity_eligible = row['category'] == 'equity' and row['shareClass'] in ('', 'A', 'C')
        if row['category'] != 'equity':
            blocking.append(row['role'] + '在独立研究入口')
        if row['shareClass'] not in ('', 'A', 'C'):
            blocking.append('份额资格待核实（%s类）' % row['shareClass'])
        if row['category'] == 'equity':
            for value, cutoff, reason in ((row['years'], 7, '基金历史不足7年或日期缺失'),
                                           (row['scale'], 1, '规模不足1亿元或数据缺失'),
                                           (row['a3'], 5, '3年年化未达5%或完整期间缺失'),
                                           (row['a5'], 8, '5年年化未达8%或完整期间缺失')):
                if value is None or value < cutoff:
                    blocking.append(reason)
            if not row['passive'] and (row['tenure'] is None or row['tenure'] < 5):
                blocking.append('没有可核对的现任个人经理连续任满5年记录')
        if row['legacy']:
            flags.append('历史快照业绩待逐只复算；符合条件不等于已核验')
        if not row['managerExplicit']:
            flags.append('个人上任日期待核对；旧团队起点不当作个人任期')
        elif len(row['managerRecords']) > 1 and (row['minTenure'] is None or row['minTenure'] < 5):
            flags.append('至少一位现任经理满5年；现任团队并非全员覆盖5年')
        if row['feeMissing']:
            flags.append('、'.join(row['feeMissing']) + '未知；不能据此判断完整费用高低')
        if row['mdd5'] is None or row['vol5'] is None:
            flags.append('完整5年风险数据待补')
        if any(word in row['status'] for word in ('暂停', '封闭', '限')):
            flags.append('当前申购状态：' + row['status'])
        if row['a10'] is None:
            flags.append('没有完整10年收益，不填成立以来')
        if any(row['annualization'][str(year)]['basis'] == 'nominal_years_dates_unconfirmed' for year in (3, 5)):
            flags.append('旧收益缺实际起止日，年化按名义期限估算')
        if '混合' in row['role']:
            flags.append('基金股票仓位与持仓集中度需按定期报告另核')
        if latest and row['latest'] and (date.fromisoformat(latest) - date.fromisoformat(row['latest'])).days > 30:
            flags.append('收益快照比研究池最新日期落后超过30天')
        inputs = dict(a3=row['a3'], a5=row['a5'], a10=row['a10'], historyYears=row['years'], scale=row['scale'],
                      managerYears=row['tenure'], managerMinYears=row['minTenure'], passive=row['passive'],
                      asof=row['latest'], managerAsOf=row['managerAsOf'])
        by_code[row['code']] = dict(tier='research', category=row['category'], region=row['region'],
                                   equityEligible=equity_eligible, thresholdInputs=inputs, defaultQualified=not blocking,
                                   reason='；'.join(blocking) or '符合默认权益研究条件', flags=flags, role=row['role'],
                                   shareClass=row['shareClass'], historicalScore=row['score'], priorityRank=rank,
                                   strategyKey=row['strategy'], managerKey=row['managers'], company=row['company'],
                                   verificationStatus='legacy_unverified' if row['legacy'] else 'performance_recomputed',
                                   managerVerificationStatus='individual_dates_checked' if row['managerExplicit'] else 'legacy_or_missing',
                                   annualization=row['annualization'],
                                   feeUnknownItems=row['feeMissing'], feeScope='known_items_only' if row['feeMissing'] else 'recorded_items_complete',
                                   intervalEvidence=dict(prior2Annual=row['prior2'], prior5Annual=row['prior5'],
                                       years=row['intervalYears'], basis=row['intervalBasis'],
                                       note='较早独立区间仅作辅助观察，不作硬门槛；有实际起点则按实际天数年化，否则标名义估算'))
        if not blocking:
            eligible.append(row)
    selected, manager_count, company_count, bucket_count, strategies = [], {}, {}, {}, set()
    for row in eligible:
        limits = []
        if len(selected) >= POLICY_DEFAULTS['maxShortlist']:
            limits.append('默认24只已满，可展开全部合格')
        if any(manager_count.get(manager, 0) >= 2 for manager in row['managers']):
            limits.append('同经理最多2只')
        if row['company'] and company_count.get(row['company'], 0) >= 3:
            limits.append('同公司最多3只')
        if row['strategy'] in strategies:
            limits.append('同基金或同指数工具已保留代表')
        if limits:
            by_code[row['code']]['reason'] = '符合收益与历史条件；' + '；'.join(limits)
            continue
        selected.append(row['code'])
        by_code[row['code']].update(tier='shortlist', reason='3年年化%.2f%%、5年年化%.2f%%；按长期收益顺序进入默认权益研究' %
                                   (row['a3'], row['a5']))
        strategies.add(row['strategy'])
        bucket_count[row['bucket']] = bucket_count.get(row['bucket'], 0) + 1
        for manager in row['managers']:
            manager_count[manager] = manager_count.get(manager, 0) + 1
        if row['company']:
            company_count[row['company']] = company_count.get(row['company'], 0) + 1
    return dict(version=3, generatedAt=datetime.now(timezone.utc).isoformat(), asof=latest or None,
                mode='public_equity_research', label='长期权益研究', defaults=POLICY_DEFAULTS,
                universe=[row['code'] for row in ranked], qualifiedCodes=[row['code'] for row in eligible],
                shortlist=selected, byCode=by_code, rules=POLICY_RULES, maxShortlist=24, maxPerManager=2, maxPerCompany=3,
                sort=dict(field='a5', direction='desc', tieBreak='code_asc', concentrationAppliedAfterReturns=True),
                counts=dict(total=len(records), shortlist=len(selected), qualified=len(eligible), research=len(records) - len(selected),
                            recomputed=sum(not row['legacy'] for row in normalized),
                            shortlistRecomputed=sum(not row['legacy'] and row['code'] in selected for row in normalized),
                            managersChecked=sum(row['managerExplicit'] for row in normalized)),
                categoryCounts=category_counts, bucketCounts=bucket_count, managerCounts=manager_count, companyCounts=company_count,
                scoreLabel='历史研究分（不参与排序）', dataStatus='公开条件筛选与数据核验状态分开显示',
                benchmark=dict(label='标普500参照', comparisonCurrency='CNY',
                               rule='须用相同实际起止日和同币种含分红序列；价格指数不能冒充全收益。SPY或人民币跟踪基金必须明确工具与费用差异。'),
                limitations=['历史池有幸存者和收益预筛偏差，不代表全市场；默认收益门槛不是对未来回报的预测。',
                             '行业与地区先依据产品名称、基金类型和指数标的识别，不等于已检查最新持仓。',
                             '3年与5年收益区间重叠；较早独立区间作辅助观察，不把多个重叠期限当作独立胜率。',
                             '尚未复算的新候选保留旧快照标记；历史10年收益差异仍须按原始序列逐只核验。'])


def cmd_policy(args):
    records = parse_snapshot_extra()
    supplements = {}
    paths = sorted(Path(DATA).glob('长期绩优候选-*.csv'))
    if paths:
        with paths[-1].open(encoding='utf-8-sig', newline='') as f:
            supplements = {r['code']: r for r in csv.DictReader(f)}
    policy = build_policy(records, supplements)
    dest = Path(ROOT) / 'data' / 'screening.js'
    temp = dest.with_suffix('.js.tmp')
    temp.write_text('// Generated by screens/fund_screen.py policy. No performance is newly verified here.\nvar SCREEN_POLICY=' +
                    json.dumps(policy, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    temp.replace(dest)
    log('  ✓ 研究池 %d；优先研究 %d；其余可搜索 %d' % (policy['counts']['total'], policy['counts']['shortlist'], policy['counts']['research']))
    return policy


def cmd_verify_samples(args):
    """Fetch full histories for representative research rows, preserving evidence."""
    ensure_dirs()
    lookup = {r['c']: r for r in parse_snapshot_extra()}
    codes = (cmd_policy(args)['shortlist'] if args.codes == 'shortlist'
             else [c.strip() for c in args.codes.split(',') if c.strip()])
    output = Path(ROOT) / 'data' / 'screening-validation.json'
    previous = {r['code']: r for r in (load_json(str(output), []) or [])}
    checks, changes, failures = [], {}, {}
    for code in codes:
        try:
            old = lookup[code]
            baseline = previous.get(code) or dict(oldAsOf=old.get('returnAsOf') or old['navdate'], oldR=old.get('r'),
                                                 oldAsOfBasis='explicit_return_date' if old.get('returnAsOf') else 'legacy_nav_date_only',
                                                 oldMdd5=old.get('mdd5'), oldVol5=old.get('vol5'), oldFees=old.get('fee'))
            rows = U.history_fetch(code)
            m = deep_metrics(rows)
            aligned = deep_metrics([r for r in rows if r.get('FSRQ', '') <= baseline['oldAsOf']])
            if not m or not aligned:
                raise RuntimeError('没有覆盖核验期间的完整净值')
            fee_url = 'https://fundf10.eastmoney.com/jjfl_%s.html' % code
            fee = fee_info(get(fee_url, referer='https://fundf10.eastmoney.com/'))
            if fee.get('fee_m') is None or fee.get('fee_c') is None:
                raise RuntimeError('持续费率未能解析')
            rvalues = [m.get('ret%d' % y) for y in (1, 2, 3, 5, 10)]
            aligned_r = [aligned.get('ret%d' % y) for y in (1, 2, 3, 5, 10)]
            check = {k: baseline[k] for k in ('oldAsOf', 'oldR', 'oldMdd5', 'oldVol5', 'oldFees')}
            check['oldAsOfBasis'] = baseline.get('oldAsOfBasis', 'legacy_nav_date_only')
            check['comparisonStatus'] = ('aligned_return_date' if check['oldAsOfBasis'] == 'explicit_return_date'
                                         else 'replay_at_legacy_nav_date_not_confirmed_return_date')
            check['comparisonNote'] = ('' if check['comparisonStatus'] == 'aligned_return_date' else
                                      '旧收益未保存独立源日期；按旧净值日期重演仅供定位，差异不能直接归因于算法。')
            check.update(code=code, name=old['n'], sourceUrl='https://fundf10.eastmoney.com/jjjz_%s.html' % code,
                         asof=m['latest'], first=m['first'], rows=len(rows), metricRows=m['rows'], historyNote=m.get('historyNote'),
                         basis=m['basis'], r=rvalues, mdd5=m.get('mdd5'), vol5=m.get('vol5'),
                         returnPeriods=[period for period in m.get('periods', []) if period['years'] in (1, 2, 3, 5, 10)],
                         fees=[fee.get('fee_m'), fee.get('fee_c'), fee.get('fee_s')], feeSource=fee_url,
                         alignedAsOf=aligned['latest'], alignedR=aligned_r,
                         alignedDelta=[round(b - a, 6) if a is not None and b is not None else None
                                       for a, b in zip(baseline['oldR'], aligned_r)],
                         alignedMdd5=aligned.get('mdd5'), alignedVol5=aligned.get('vol5'),
                         alignedRiskDelta={key: round(aligned[key] - baseline[old_key], 6)
                                           if aligned.get(key) is not None and baseline.get(old_key) is not None else None
                                           for key, old_key in (('mdd5', 'oldMdd5'), ('vol5', 'oldVol5'))},
                         feeCheckedItems=[label for key, label in (('fee_m', '管理费'), ('fee_c', '托管费'), ('fee_s', '销售服务费'))
                                          if fee.get(key) is not None],
                         feeUnknownItems=[label for key, label in (('fee_m', '管理费'), ('fee_c', '托管费'), ('fee_s', '销售服务费'))
                                          if fee.get(key) is None],
                         checkedAt=datetime.now(timezone.utc).isoformat())
            checks.append(check)
            changes[code] = dict(r=rvalues, mdd5=m.get('mdd5'), vol5=m.get('vol5'), basis=m['basis'],
                                 returnAsOf=m['latest'], riskAsOf=m['latest'], returnSource='Eastmoney历史净值与公司行为',
                                 returnFirst=m['first'], riskFirst=m['first'],
                                 returnPeriods=check['returnPeriods'], risk5First=m.get('risk5First'),
                                 historyNote=m.get('historyNote') or '',
                                 note='复算年度收益（截至%s）：%s' % (m['latest'], fmt_yearly(m.get('yearly'))),
                                 returnSourceUrl=check['sourceUrl'], fee=check['fees'], feeSource=fee_url,
                                 feeCheckedAt=check['checkedAt'], performanceVerifiedAt=check['checkedAt'])
            log('  ✓ %s %s：%d 条净值；截至 %s；旧日期重演差 %s' %
                (code, old['n'], len(rows), m['latest'], check['alignedDelta']))
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            failures[code] = str(exc)
    if checks:
        merged = dict(previous)
        merged.update({r['code']: r for r in checks})
        save_json(str(output), list(merged.values()))
    if getattr(args, 'apply', False) and changes:
        write_extra_fields(changes)
        cmd_policy(args)
    if failures:
        raise RuntimeError('部分样本核验失败：' + json.dumps(failures, ensure_ascii=False))
    return checks


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


def policy_for_rows(rows):
    policy_records = rows
    try:
        snapshot = {r['c']: r for r in parse_snapshot_extra()}
        # The report can reuse dated fee fields, but fresh metrics win.
        policy_records = []
        for row in rows:
            item = dict(snapshot.get(row['code'], {}))
            item.update(row)
            for key in ('r', 'navdate', 'mdd5', 'vol5', 'mten', 'sz'):
                item.pop(key, None)
            item.update(mdd5=row.get('mdd5'), vol5=row.get('vol5'))
            policy_records.append(item)
    except (OSError, RuntimeError):
        pass
    return build_policy(policy_records)


def render_md(rows, picked, stats=None, others=None, excl=None):
    """Use executable policy text and actual counts instead of canned claims."""
    latest = max((r.get('latest') or '' for r in rows), default='')
    policy = policy_for_rows(rows)
    lookup = {r['code']: r for r in rows}
    lines = ['# 长期配置基金研究池', '', '指标最新日期：%s。生成日期不代表全部指标已更新。' % (latest or '未知'), '',
             '研究记录 %d 只；优先研究 %d 只。旧历史研究分不作为推荐分或候选默认排序。' % (len(rows), len(policy['shortlist'])), '',
             '## 执行中的候选规则', '']
    lines.extend('- ' + rule for rule in policy['rules'])
    lines.extend(['', '## 优先研究名单', '',
                  '| 代码 | 基金 | 近5年年化 | 近10年年化 | 5年回撤 | 现任团队年限 | 研究理由 |',
                  '|---|---|---:|---:|---:|---:|---|'])
    for code in policy['shortlist']:
        r = lookup[code]
        lines.append('| %s | %s | %s | %s | %s | %s | %s |' %
                     (code, r['name'], pct(r.get('a5')), pct(r.get('a10')), pct(r.get('mdd5')),
                      num(r.get('tenure')), policy['byCode'][code]['reason']))
    lines.extend(['', '## 数据口径与限制', '',
                  '- 近10年缺值保持缺值，不用成立以来年化填充；未覆盖完整5年/10年不展示相应周期风险。',
                  '- 基金复权收益统一由供应商日涨跌或明确分红/拆分链接；累计净值比不能代替分红再投资收益。',
                  '- 年度收益按前一年末至当年末（今年为截至日）计算；首个不完整年度不列全年收益。',
                  '- 现任经理任期不等于经理贡献归因；基金更换经理前的业绩不能归于现任经理。'])
    lines.extend('- ' + item for item in policy['limitations'])
    lines.extend(['', '## 复现', '', '```sh',
                  'python screens/fund_screen.py universe',
                  'python screens/fund_screen.py prefilter',
                  'python screens/fund_screen.py enrich',
                  'python screens/fund_screen.py metrics',
                  'python screens/fund_screen.py report',
                  'python screens/fund_screen.py html',
                  'python screens/fund_screen.py policy', '```', ''])
    return '\n'.join(lines)


def cmd_report(args):
    ensure_dirs()
    rows = assemble()
    if not rows:
        raise RuntimeError('没有可用数据，先运行 enrich / metrics')
    picked = pick(rows)
    others = picked.pop('_others', {})
    # CSV：全部候选（含未入选）
    csv_path = os.path.join(DATA, '长期绩优候选-%s.csv' % AS_OF.replace('-', ''))
    cols = ['code', 'name', 'bucket', 'estab', 'years', 'scale', 'company', 'ftype', 'index_name',
            'managers', 'cur_start', 'tenure', 'mgr_changes_5y', 'fee_now', 'sgzt', 'cagr1', 'cagr3',
            'cagr5', 'cagr8', 'cagr10', 'cagr_since', 'vol5', 'mdd5', 'mdd10', 'mdd_all', 'max_year_key',
            'max_year', 'sharpe1y', 'latest', 'siblings',
            'a5', 'a10', 'asince', 'r5_api', 'r10_api', 'rsince_api']
    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols + ['score', 'selected'])
        sel_codes = set(policy_for_rows(rows)['shortlist'])
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
        n = sum(r['code'] in sel_codes for r in recs)
        log('    %-12s 旧口径研究评分 %3d；优先研究 %d' % (bucket, len(recs), n))


# ---------------------------------------------------------------- 5. 写回统一快照（研究池）
JJFL_DIR = os.path.join(CACHE, 'jjfl')
FEE_RE = re.compile(r'管理费率</td><td[^>]*>\s*([\d.]+)%')
CUST_RE = re.compile(r'托管费率</td><td[^>]*>\s*([\d.]+)%')
SALE_RE = re.compile(r'销售服务费率</td><td[^>]*>\s*([\d.]+)%')
XB_KEYS = [('国内权益', 'x1'), ('QDII/海外', 'x2'), ('指数/指数增强', 'x3'),
           ('场内ETF/LOF', 'x4'), ('债券/固收', 'x5'), (YOUNG_BUCKET, 'x7'),
           ('商品/黄金', 'x8'), ('FOF', 'x9')]
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


def manager_fields_for_output(current, previous):
    """Keep a dated verified incumbent record when a later enrichment lacks one."""
    def fields(row):
        return {key: value for key, value in row.items() if key in ('mgr', 'mstart', 'mten', 'legacyManagerStart', 'legacyManagerTenure')
                or key.startswith('manager') and key != 'managers'}

    def explicit(row):
        return bool(row.get('managerStartBasis') == 'explicit_individual_appointment' and row.get('managerRecords')
                    and row.get('managerAsOf') and row.get('managerCheckedAt'))

    if explicit(current):
        if not explicit(previous) or datetime.fromisoformat(current['managerCheckedAt']) >= datetime.fromisoformat(previous['managerCheckedAt']):
            result = fields(current)
            for key in ('legacyManagerStart', 'legacyManagerTenure'):
                if key not in result and key in previous:
                    result[key] = previous[key]
            return result
    if explicit(previous):
        result = fields(previous)
        result['managerDataStatus'] = ('refresh_failed' if current.get('managerDataStatus') in ('unavailable', 'refresh_failed')
                                       else 'cached' if explicit(current) else 'stale')
        return result
    return dict(mgr=current.get('mgr') or current.get('managers') or previous.get('mgr') or '',
                mstart=None, mten=None, managerRecords=[], managerDataStatus='unavailable',
                managerStartBasis='unverified_legacy_team_date',
                legacyManagerStart=previous.get('legacyManagerStart', previous.get('mstart', current.get('cur_start'))),
                legacyManagerTenure=previous.get('legacyManagerTenure', previous.get('mten', current.get('tenure'))))


def cmd_html(args):
    """更新统一快照的 EXTRA；保留可检索历史，不再把所有研究样本当推荐。"""
    ensure_dirs()
    os.makedirs(JJFL_DIR, exist_ok=True)
    rows = assemble()
    previous_rows = {row['c']: row for row in parse_snapshot_extra()}
    rows = [dict(row, **manager_fields_for_output(row, previous_rows.get(row['code'], {}))) for row in rows]
    picked = pick(rows)
    others = picked.pop('_others', {}) or {}
    if not rows:
        raise RuntimeError('没有可写入的研究池，先运行 report')
    en = (load_json(os.path.join(DATA, 'enriched.json')) or {}).get('funds', {})
    uni = (load_json(os.path.join(DATA, 'universe.json')) or {}).get('funds', {})
    want = []
    for bucket, key in XB_KEYS:
        for r in [x for x in rows if x.get('bucket') == bucket]:
            want.append((key, r, 0))
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
        # A single validated wealth series and source date for every horizon.
        rr = [m.get('ret%d' % years) for years in (1, 2, 3, 5, 10)]
        yr = ' '.join('%s:%+.0f' % (k[2:], v) for k, v in sorted((m.get('yearly') or {}).items())[-6:])
        note = yr
        if key == 'x7':
            a_since = r.get('asince')
            tot = r.get('rsince_api')
            note = ('成立来 %s（年化 %s） · %s'
                    % (('+%.1f%%' % tot) if tot is not None else '--',
                       ('%.1f%%' % a_since) if a_since is not None else '--', yr)).strip(' ·')
        if not sel and key != 'x6':
            note = ('研究记录 · ' + note) if note else '研究记录'
        if r.get('forced'):
            note = ('手动加入 · ' + note) if note else '手动加入'
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
            'returnAsOf:%s' % js_str(m.get('latest')), 'riskAsOf:%s' % js_str(m.get('latest')),
            'returnFirst:%s' % js_str(m.get('first')), 'riskFirst:%s' % js_str(m.get('first')),
            'basis:%s' % js_str(m.get('basis')), 'returnSource:%s' % js_str('Eastmoney历史净值与公司行为'),
            'sz:%s' % js_num(sz, 1), 'nav:%s' % js_num(nav, 4), 'navdate:%s' % js_str(navdate),
            'dz:%s' % js_num(dz, 2),
            'p:%s' % js_num(sd.get('price'), 3), 'prem:%s' % js_num(sd.get('prem'), 2),
            'iopv:%s' % js_num(sd.get('iopv'), 3), 'pct:%s' % js_num(sd.get('pct'), 2),
            'mgr:%s' % js_str(r.get('mgr') or basic.get('managers') or ','.join(f.get('cur_managers') or [])),
            'mstart:%s' % (js_str(r['mstart']) if r.get('mstart') else 'null'),
            'mten:%s' % js_num(r.get('mten')),
            'mdd5:%s' % js_num(r.get('mdd5'), 1), 'vol5:%s' % js_num(r.get('vol5'), 1),
            'score:%s' % js_num(r.get('score'), 1), 'sel:%d' % sel, 'note:%s' % js_str(note),
        ]
        for field in (key for key in r if key.startswith('manager')):
            if field == 'managers':
                continue
            value = r[field]
            parts.append(field + ':' + (js_str(value) if isinstance(value, str) else
                                        json.dumps(value, ensure_ascii=False, separators=(',', ':'))))
        parts.append('returnPeriods:' + json.dumps([period for period in m.get('periods', [])
                                                   if period['years'] in (1, 2, 3, 5, 10)], separators=(',', ':')))
        legacy_start = r.get('legacyManagerStart') or f.get('legacy_cur_start')
        parts.append('legacyManagerStart:' + (js_str(legacy_start) if legacy_start else 'null'))
        parts.append('legacyManagerTenure:' + js_num(r.get('legacyManagerTenure')))
        lines.append('{' + ','.join(parts) + '},')
    key_of = dict((b, k) for b, k in XB_KEYS)
    xother_lines = []
    for bucket, dup in others.items():
        key = key_of.get(bucket)
        if not key:
            continue
        for d in dup:
            xother_lines.append('{b:%s,c:%s,n:%s,sz:%s,dup:%s},'
                                % (js_str(key), js_str(d['code']), js_str(d['name']),
                                   js_num(d.get('scale'), 1), js_str(d.get('dup_of'))))
    # Preserve historical records omitted from a fresh research run; never turn
    # a changed screen into silent history deletion.
    current = Path(SNAPSHOT).read_text(encoding='utf-8')
    old_match = re.search(r'var\s+EXTRA\s*=\s*\[(.*?)\n\];', current, re.S)
    new_codes = {r['code'] for _key, r, _sel in want}
    if old_match:
        for line in old_match.group(1).splitlines():
            code_match = re.search(r"c:'(\d{6})'", line)
            if code_match and code_match.group(1) not in new_codes:
                lines.append(re.sub(r'\bsel:\d+', 'sel:0', line))
    policy = build_policy(parse_snapshot_extra(text='var EXTRA=[\n' + '\n'.join(lines) + '\n];'),
                          {r['code']: r for r in rows})
    selected = set(policy['shortlist'])
    lines = [re.sub(r'\bsel:\d+', 'sel:%d' % (re.search(r"c:'(\d{6})'", line).group(1) in selected), line) for line in lines]
    block = ('/*__DATA_EXTRA_BEGIN__*/\n'
             '/* 长期配置研究池 —— 由 screens/fund_screen.py html 生成；默认候选见 SCREEN_POLICY。\n'
             '   字段在 FUNDS 基础上扩展：mgr 基金经理 mstart 任职起始 mten 任职年限 '
             'mdd5 完整近5年最大回撤% vol5 完整近5年年化波动% score 历史研究分（非推荐分） sel 1=优先研究 0=研究池\n'
             '   r 为红利再投复权区间涨幅，与页面「累计/年化」开关联动；note 为近6个年度收益 */\n'
             'var EXTRA=[\n' + '\n'.join(lines) + '\n];\n'
             '/* 同标的未入表的备选（页面在该表下方以「同标的还有」列出） */\n'
             'var XOTHERS=[\n' + '\n'.join(xother_lines) + '\n];\n'
             '/*__DATA_EXTRA_END__*/')
    html_path = SNAPSHOT
    with open(html_path, encoding='utf-8') as fh:
        src = fh.read()
    if '/*__DATA_EXTRA_BEGIN__*/' not in src:
        raise RuntimeError('data/snapshot.js 缺少 EXTRA 数据块')
    src = re.sub(r'/\*__DATA_EXTRA_BEGIN__\*/.*?/\*__DATA_EXTRA_END__\*/', lambda _m: block,
                 src, count=1, flags=re.S)
    atomic_text(html_path, src)
    cmd_policy(args)
    log('  ✓ 已写入 data/snapshot.js：%d 行；优先研究 %d' % (len(lines), len(selected)))


# ---------------------------------------------------------------- 6. 并入大类一（写进 FUNDS 块）
# 按需求：标普100等权重 → 标普组（表一）；美国50ETF → 其他美股指数·场内（表五）。
# 写进 FUNDS 后由 update.py 每日更新（净值/区间涨幅/波动回撤/申赎状态/规模/场内快照）。
PROMOTE = [
    {'code': '519981', 'g': 'sp', 't': '场外', 'ix': '标普100等权重',
     'note': '标普100等权重指数增强(QDII)，按需求并入标普组'},
    {'code': '513850', 'g': 'nx', 't': None, 'ix': 'MSCI美国50', 'note': '美国50（MSCI USA 50）'},
    {'code': '159577', 'g': 'nx', 't': None, 'ix': 'MSCI美国50', 'note': '美国50（MSCI USA 50）'},
]


def _v3_mdd3(code):
    """近3年年化波动率 / 最大回撤（页面 v3/mdd3 列，与 update.py 口径一致）。"""
    rows = U.history_fetch(code)
    if not rows:
        return None, None
    ser = build_series(rows)
    b = add_years(ser[-1][0], -3)
    st = _stats([(d, t) for d, dw, t, lj in ser if d >= b])
    return (st['vol'], st['mdd']) if st else (None, None)


def fund_line(spec, uni, en, snap, refresh=False):
    """生成一条 FUNDS 行（字段顺序与现有行一致，便于 update.py 之后每日更新）。"""
    code = spec['code']
    u = uni.get(code) or {}
    f = en.get(code) or {}
    b = f.get('basic') or {}
    info = fee_info(jjfl_page(code, refresh=refresh))
    m = _metrics_of(code)
    v3, mdd3 = _v3_mdd3(code)
    is_etf = spec['t'] is None
    fee = [info.get('fee_m'), info.get('fee_c'), info.get('fee_s')]
    if fee[2] is None and not is_etf:
        fee[2] = fnum(b.get('fee_s'))
    sz = info.get('sz')
    if sz is None:
        sc = fnum(b.get('scale'))
        sz = (sc / 1e8) if sc else None
    nav = info.get('nav') or fnum(b.get('nav'))
    navdate = (info.get('navdate') or m.get('latest') or '')[:10]
    dz = info.get('dz')
    if dz is None:
        dz = fnum(u.get('r1d'))
    name = b.get('name') or f.get('name') or code
    parts = ['{g:%s' % js_str(spec['g']), 'c:%s' % js_str(code), 'n:%s' % js_str(name)]
    if spec['t']:
        parts.append('t:%s' % js_str(spec['t']))
    parts += ['ix:%s' % js_str(spec['ix']),
              'd:%s' % js_str((u.get('estab') or b.get('estab') or '')[:10]),
              'fee:[%s]' % ','.join(js_num(v, 2) for v in (fee if is_etf else fee[:3]))]
    if not is_etf:
        buy = '%s/%s' % ((u.get('fee_src') or '').strip(), (u.get('fee_now') or '').strip())
        parts += ['buy:%s' % js_str(buy.strip('/')), 'rd:%s' % js_str(info.get('rd') or ''),
                  'st:%s' % js_str(info.get('st') or ''), 'lm:%s' % js_str(info.get('lm') or '')]
    sd = snap.get(code) or {}
    parts += ['r:[%s]' % ','.join(js_num(m.get('ret%d' % k), 2) for k in (1, 2, 3, 5, 10)),
              'sz:%s' % js_num(sz, 1)]
    if is_etf:
        parts += ['p:%s' % js_num(sd.get('price'), 3), 'prem:%s' % js_num(sd.get('prem'), 2),
                  'pct:%s' % js_num(sd.get('pct'), 2), 'iopv:%s' % js_num(sd.get('iopv'), 3)]
    parts += ['nav:%s' % js_num(nav, 4), 'navdate:%s' % js_str(navdate), 'dz:%s' % js_num(dz, 2),
              'v3:%s' % js_num(v3, 2), 'mdd3:%s' % js_num(mdd3, 2), 'dzfrom:null',
              'note:%s' % js_str(spec['note'])]
    return ','.join(parts) + '},'


def cmd_promote(args):
    """把 PROMOTE 的标的写进 data/snapshot.js 的 FUNDS 块（大类一）；它们随 update.py 每日更新。"""
    ensure_dirs()
    os.makedirs(JJFL_DIR, exist_ok=True)
    uni = (load_json(os.path.join(DATA, 'universe.json')) or {}).get('funds', {})
    en = (load_json(os.path.join(DATA, 'enriched.json')) or {}).get('funds', {})
    etf_codes = [s['code'] for s in PROMOTE if s['t'] is None]
    snap = U.tencent_etf(etf_codes) if etf_codes else {}
    lines = []
    for spec in PROMOTE:
        if spec['code'] not in uni and spec['code'] not in en:
            log('  !! %s 不在全市场名单里，跳过' % spec['code'])
            continue
        lines.append(fund_line(spec, uni, en, snap, refresh=args.refresh))
        log('  ★ 并入大类一：%s %s → %s' % (spec['code'], spec['ix'], spec['g']))
    html_path = SNAPSHOT
    with open(html_path, encoding='utf-8') as fh:
        src = fh.read()
    m = re.search(r'(/\*__DATA_FUNDS_BEGIN__\*/)(.*?)(/\*__DATA_FUNDS_END__\*/)', src, re.S)
    if not m:
        log('!! 找不到 FUNDS 数据块')
        return
    codes = [s['code'] for s in PROMOTE]
    body = '\n'.join(l for l in m.group(2).splitlines()
                     if not any(("c:'%s'" % c) in l for c in codes)     # 先去重（含上一轮插入的位置）
                     and not l.lstrip().startswith('// —— 按需求并入'))
    add = ('// —— 按需求并入：标普100等权重 / 美国50ETF（由 screens/fund_screen.py promote 写入，'
           '之后随 update.py 每日更新）\n' + '\n'.join(lines) + '\n')
    stripped = body.rstrip()
    if not stripped.endswith('];'):
        log('!! FUNDS 块结构与预期不符（结尾不是 ]）；），已放弃写入')
        return
    head = stripped[:-2].rstrip()                          # 去掉结尾的 ];
    if head.splitlines() and not head.splitlines()[-1].rstrip().endswith(','):
        head += ','                                        # 原最后一行没有逗号，插入前要补上
    body = head + '\n' + add + '];\n'                      # 必须插在数组的 ]; 之前
    src = src[:m.start(2)] + body + src[m.end(2):]
    atomic_text(html_path, src)
    log('  ✓ 已写入 FUNDS：%d 行（大类一现共 %d 只）' % (len(lines), len(U.parse_fund_lines(src))))


def main():
    global AS_OF
    ap = argparse.ArgumentParser(description='长期配置基金研究池与可解释候选分层')
    ap.add_argument('--as-of', default=AS_OF, help='抓取参考日，不覆盖源数据原日期')
    sub = ap.add_subparsers(dest='cmd')
    sub.add_parser('universe', help='拉全市场排行（开放式 / QDII / 指数型 / 场内四榜）')
    sub.add_parser('prefilter', help='研究池：成立至少3年、人民币份额去重，不按近期收益截断')
    p3 = sub.add_parser('enrich', help='逐只补基础信息 + 基金经理变动')
    p3.add_argument('--refresh', action='store_true')
    p3.add_argument('--workers', type=int, default=1, help='并发线程数（默认 1，建议 6~8）')
    p4 = sub.add_parser('metrics', help='逐只拉历史净值并自算指标（最慢）')
    p4.add_argument('--refresh', action='store_true')
    p4.add_argument('--codes', help='只算指定代码（逗号分隔，可临时补基准）')
    p4.add_argument('--workers', type=int, default=1, help='并发线程数（默认 1，建议 6~8）')
    sub.add_parser('report', help='生成筛选报告与 CSV')
    sub.add_parser('policy', help='离线重算优先研究名单与原因，写入 data/screening.js')
    pv = sub.add_parser('verify-samples', help='全历史核验代表候选并保留同日对比证据')
    pv.add_argument('--codes', default='shortlist', help='逗号分隔基金代码；默认核验当前全部优先研究候选')
    pv.add_argument('--apply', action='store_true', help='仅回写核验成功样本的收益、风险、费用和独立日期')
    pm = sub.add_parser('managers', help='核对EXTRA每位现任经理的明确个人上任日期')
    pm.add_argument('--codes', default='all', help='默认全部EXTRA；也可逗号分隔代码')
    pm.add_argument('--workers', type=int, default=6)
    pm.add_argument('--refresh', action='store_true')
    ph = sub.add_parser('html', help='更新 data/snapshot.js 的 EXTRA 研究池')
    ph.add_argument('--refresh', action='store_true', help='忽略费率/限额页缓存，重新抓取')
    pp = sub.add_parser('promote', help='把指定标的并入 data/snapshot.js 的 FUNDS')
    pp.add_argument('--refresh', action='store_true')
    sub.add_parser('all', help='universe → prefilter → enrich → metrics → report → html')
    args = ap.parse_args()
    date.fromisoformat(args.as_of)
    AS_OF = args.as_of
    args.refresh = getattr(args, 'refresh', False)
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
          'metrics': cmd_metrics, 'report': cmd_report, 'html': cmd_html,
           'promote': cmd_promote, 'policy': cmd_policy, 'verify-samples': cmd_verify_samples,
           'managers': cmd_managers}.get(args.cmd)
    if fn is None:
        ap.print_help()
    else:
        fn(args)


if __name__ == '__main__':
    main()
