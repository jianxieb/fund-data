#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海外基金与基准 — 数据更新脚本
====================================================
数据源（2026-09 实测可用）：
  1) fundf10.eastmoney.com/jjfl_<代码>.html  申购状态 / 单日累计购买上限 / 净资产规模（缓存 .tmp-fhsp/）
  2) fundmobapi FundMNFInfo                  批量净值 NAV / 日涨跌幅 NAVCHGRT（核心：涨跌幅）
  3) fundmobapi FundMNHisNetList             全量历史净值（含分红 FHFCZ，缓存 .tmp-hist/，增量合并）
     → 重算 近1/2/3/5/10年区间涨幅（红利再投口径）、完整3年/5年风险
  4) qt.gtimg.cn/q=sh513100,sz159941,...     场内ETF 现价/涨跌幅/IOPV/溢价率（快照 = "当时溢价率"）
  5) Yahoo chart显式adjclose / CNY=X         真实基准与美元兑人民币；汇率须有币种与交易时区证明
  6) fundf10.eastmoney.com/jjjl_<代码>.html  现任经理及个人明确上任日期（缓存 .tmp-managers/）

更新 data/snapshot.js 中 /*__DATA_*__*/ 标记区块（FUNDS 逐行补丁、BM、META）。

用法：
  python update.py           全量更新（历史增量合并 + 基准重算）
  python update.py --quick   跳过基准（指数/SPY/SSO/UPRO/QQQ/QLD/TQQQ，其余全刷，日常用）
  python update.py --hist    只补历史与基准（限流缓解后回填缓存用）
  python update.py --offline 只用本地缓存（.tmp-fhsp/.tmp-hist），不联网
  python update.py --managers-only --refresh-managers 只重新核对经理资料

统一日更入口为 python refresh.py；本脚本只负责海外基金与基准。
观测日期、收益截至日、现价时间各自保存，更新失败不伪装为当日数据。
"""
import argparse
import hashlib
import html as html_text
import json
import math
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from data_status import write_status

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, 'data', 'snapshot.js')
FHSP_DIR = os.path.join(HERE, '.tmp-fhsp')
HIST_DIR = os.path.join(HERE, '.tmp-hist')
MANAGER_DIR = os.path.join(HERE, '.tmp-managers')
SNAP_DIR = os.path.join(HERE, '.tmp-snap')   # 上一版 data/snapshot.js 备份 + 申赎状态快照 + 变动记录
CHG_KEEP = 40                                # 页面里保留的变动条数
UA = {'User-Agent': 'Mozilla/5.0'}  # fundmobapi 对完整桌面 UA 会返回 61136403 网络繁忙
OFFLINE = False

# 近N年窗口
WINDOWS = [1, 2, 3, 5, 10]
# 基准 secid（失败按顺序尝试；None 表示不适用）
BM_DEFS = [
    ('标普500指数', '指数·价格', ['100.SPX'], '价格口径，未含分红', 0),
    ('SPY', '美股ETF', ['106.SPY', '107.SPY', '105.SPY'], '标普500ETF，前复权含分红', 1),
    ('SSO', '美股ETF·2倍做多', ['107.SSO', '106.SSO', '105.SSO'], '标普500两倍做多ETF，前复权含分红；每日再平衡', 1),
    ('UPRO', '美股ETF·3倍做多', ['107.UPRO', '106.UPRO', '105.UPRO'], '标普500三倍做多ETF，前复权含分红；每日再平衡', 1),
    ('纳斯达克综合指数', '指数·价格', ['100.COMPX', '100.IXIC'], '价格口径', 0),
    ('纳斯达克100指数', '指数·价格', ['100.NDX'], '价格口径', 0),
    ('QQQ', '美股ETF', ['105.QQQ'], '纳指100ETF，前复权含分红', 1),
    ('QLD', '美股ETF·2倍做多', ['105.QLD', '106.QLD', '107.QLD'], '纳指100两倍做多ETF，前复权含分红；每日再平衡', 1),
    ('TQQQ', '美股ETF·3倍做多', ['105.TQQQ', '106.TQQQ', '107.TQQQ'], '纳指100三倍做多ETF，前复权含分红；每日再平衡', 1),
]
FX_SECIDS = ['133.USDCNY', '119.USDCNY']  # CNY 与 CNH 不互换


def log(*a):
    try:
        print(*a, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode('gbk', 'replace').decode('gbk') for x in a], flush=True)


def http_get(url, referer=None, tries=2, delay=1.0, timeout=12):
    """带重试的 GET，返回解码后的文本；彻底失败返回 None。"""
    if OFFLINE:
        return None
    last = None
    tries = min(tries, 2)
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
            if i + 1 < tries:
                time.sleep(min(delay, 1.0))
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
    """从 data/snapshot.js 提取 FUNDS 数组：返回 [(行文本, code, is_etf), ...]"""
    m = re.search(r'/\*__DATA_FUNDS_BEGIN__\*/(.*?)/\*__DATA_FUNDS_END__\*/', src, re.S)
    if not m:
        raise ValueError('snapshot.js 缺少 FUNDS 数据块')
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
    pat = re.compile(r'\b' + re.escape(name) + r"\s*:\s*(?:'[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|\[[^\]]*\]|null|true|false)")
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


# ---------------------------------------------------------------- 校验 / 原子写回
FIELD_RE = {
    'nav': re.compile(r"nav:(-?\d+(?:\.\d+)?|null)"),
    'v3': re.compile(r"v3:(-?\d+(?:\.\d+)?|null)"),
    'mdd3': re.compile(r"mdd3:(-?\d+(?:\.\d+)?|null)"),
    'prem': re.compile(r"prem:(-?\d+(?:\.\d+)?|null)"),
    'sz': re.compile(r"sz:(-?\d+(?:\.\d+)?|null)"),
    'r': re.compile(r"r:\[([^\]]*)\]"),
}


def _num(pat, line):
    m = FIELD_RE[pat].search(line)
    if not m:
        return None, False
    v = m.group(1)
    if v == 'null':
        return None, True
    try:
        return float(v), True
    except ValueError:
        return None, False


def validate_src(src, expect_funds):
    """写回前的自检：行数、必需字段、数值范围、META/BM 结构。返回问题列表（空=通过）。"""
    bad = []
    rows = parse_fund_lines(src)
    if len(rows) != expect_funds:
        bad.append('基金行数 %d != 预期 %d' % (len(rows), expect_funds))
    codes = set()
    for line, code, _is_etf in rows:
        if code in codes:
            bad.append('%s 重复出现' % code)
        codes.add(code)
        for need in ("n:'", "ix:'", "d:'", 'fee:[', "r:["):
            if need not in line:
                bad.append('%s 缺少字段 %s' % (code, need))
        nav, ok = _num('nav', line)
        if not ok:
            bad.append('%s nav 格式异常' % code)
        elif nav is not None and nav <= 0:
            bad.append('%s nav=%.4f 非正' % (code, nav))
        v3, ok = _num('v3', line)
        if ok and v3 is not None and not (0 <= v3 < 200):
            bad.append('%s 波动率 %.2f 越界' % (code, v3))
        mdd, ok = _num('mdd3', line)
        if ok and mdd is not None and not (-100 <= mdd <= 0):
            bad.append('%s 最大回撤 %.2f 越界' % (code, mdd))
        prem, ok = _num('prem', line)
        if ok and prem is not None and not (-50 < prem < 50):
            bad.append('%s 溢价率 %.2f 越界' % (code, prem))
        sz, ok = _num('sz', line)
        if ok and sz is not None and sz < 0:
            bad.append('%s 规模 %.1f 为负' % (code, sz))
        m = FIELD_RE['r'].search(line)
        if m:
            vals = [x.strip() for x in m.group(1).split(',')]
            if len(vals) != len(WINDOWS):
                bad.append('%s 区间涨幅列数 %d != %d' % (code, len(vals), len(WINDOWS)))
            for x in vals:
                if x == 'null':
                    continue
                try:
                    fv = float(x)
                except ValueError:
                    bad.append('%s 区间涨幅 %r 非数值' % (code, x))
                    continue
                if not (-100 < fv < 20000):
                    bad.append('%s 区间涨幅 %.2f 越界' % (code, fv))
    m = re.search(r'var META=\{(.*?)\};', src, re.S)
    if not m:
        bad.append('META 块缺失')
    else:
        for k in ('gen', 'navdate', 'snpdate', 'snptime', 'szdate'):
            if (k + ':') not in m.group(1):
                bad.append('META 缺少 %s' % k)
        fm = re.search(r'fx:\[([^\]]*)\]', m.group(1))
        if not fm or len([x for x in fm.group(1).split(',') if x.strip()]) != len(WINDOWS):
            bad.append('META.fx 长度不为 %d' % len(WINDOWS))
    mb = re.search(r'/\*__DATA_BM_BEGIN__\*/(.*?)/\*__DATA_BM_END__\*/', src, re.S)
    if not mb or len(re.findall(r'[\"\']?usd[\"\']?\s*:', mb.group(1))) != len(BM_DEFS):
        bad.append('BM 基准行数不为 %d' % len(BM_DEFS))
    return bad


def backup_and_write(src):
    """先备份上一版，再临时文件 + 原子替换，避免写一半把 data/snapshot.js 弄坏。"""
    try:
        os.makedirs(SNAP_DIR, exist_ok=True)
    except OSError:
        pass
    if os.path.exists(HTML):
        try:
            with open(HTML, encoding='utf-8') as f:
                prev = f.read()
            with open(os.path.join(SNAP_DIR, 'snapshot.js.prev'), 'w', encoding='utf-8') as f:
                f.write(prev)
        except OSError as e:
            log('  ~ 备份上一版失败（继续写回）：%s' % e)
    tmp = HTML + '.tmp'
    # 与原来的写法保持一致：Windows 上 \n 会写成 CRLF，避免整文件换行符被改写
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(src)
    os.replace(tmp, HTML)


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save_json(path, obj):
    try:
        os.makedirs(SNAP_DIR, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False)
    except OSError as e:
        log('  !! 快照写入失败：%s' % e)


def write_changes_block(src, changes):
    """把最近的状态/限额变动写进 data/snapshot.js 的 CHANGES 数据块（页面按最新在前展示）。"""
    rows = []
    for x in reversed(changes[-CHG_KEEP:]):
        rows.append(' {d:%s,c:%s,n:%s,f:%s,a:%s,b:%s},' % (
            json.dumps(x.get('d', ''), ensure_ascii=False),
            json.dumps(x.get('c', ''), ensure_ascii=False),
            json.dumps(x.get('n', ''), ensure_ascii=False),
            json.dumps(x.get('f', ''), ensure_ascii=False),
            json.dumps(x.get('a', ''), ensure_ascii=False),
            json.dumps(x.get('b', ''), ensure_ascii=False)))
    block = ('var CHANGES=[\n' + '\n'.join(rows) + '\n];') if rows else 'var CHANGES=[];'
    m = re.search(r'(/\*__DATA_CHG_BEGIN__\*/\n)(.*?)(\n/\*__DATA_CHG_END__\*/)', src, re.S)
    if not m:
        log('  ~ 未找到 CHANGES 数据块，跳过申购变动写回')
        return src
    log('  ✓ 申购变动 %d 条已写回' % len(rows))
    return src[:m.start()] + m.group(1) + block + m.group(3) + src[m.end():]


# ---------------------------------------------------------------- jjfl 页面
def jjfl_parse(html, reference_date=None):
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
        today = reference_date or datetime.now()
        y = today.year if (today.month, today.day) >= tuple(map(int, mmdd.split('-'))) else today.year - 1
        out['nav'] = float(m.group(2))
        out['navdate'] = '%d-%s' % (y, mmdd)
        out['dz'] = float(m.group(3))
    return out


def manager_parse(html, checked_at, source_url):
    """Read each incumbent's explicit appointment date, never a team-change date.

    The provider's latest history-table row starts whenever the combination of
    co-managers changes. The incumbent biography separately publishes the actual
    personal appointment date for this fund, which is the only accepted basis here.
    """
    checked = datetime.fromisoformat(checked_at.replace('Z', '+00:00'))
    if checked.tzinfo is None:
        raise ValueError('经理资料核对时间缺少时区')
    asof = checked.astimezone(ZoneInfo('Asia/Shanghai')).date()
    records = []
    parts = re.split(r'<div\s+class=[\"\']jl_intro[\"\'][^>]*>', html, flags=re.I)[1:]
    for part in parts:
        # Stop before the manager's other-fund table or the next biography.
        part = re.split(r'<div\s+class=[\"\']jl_office[\"\']', part, maxsplit=1, flags=re.I)[0]
        name_match = re.search(r'<strong>\s*姓名[：:]\s*</strong>\s*<a[^>]*>(.*?)</a>', part, re.S)
        start_match = re.search(r'<strong>\s*上任日期[：:]\s*</strong>\s*([^<]*)', part, re.S)
        if not name_match:
            continue
        name = html_text.unescape(re.sub('<[^>]*>', '', name_match.group(1))).strip()
        if not name or any(row['name'] == name for row in records):
            raise ValueError('现任基金经理姓名为空或重复')
        raw_start = html_text.unescape(start_match.group(1)).strip() if start_match else ''
        start, tenure, tenure_text = None, None, None
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw_start):
            appointment = datetime.strptime(raw_start, '%Y-%m-%d').date()
            if appointment > asof:
                raise ValueError('现任经理上任日期在核对日之后：' + raw_start)
            start = raw_start
            tenure = (asof - appointment).days / 365.2425
            full_years = asof.year - appointment.year
            anniversary = datetime.strptime(add_years(start, full_years), '%Y-%m-%d').date()
            if anniversary > asof:
                full_years -= 1
                anniversary = datetime.strptime(add_years(start, full_years), '%Y-%m-%d').date()
            remaining_days = (asof - anniversary).days
            tenure_text = ('%d年%d天' % (full_years, remaining_days)) if full_years else '%d天' % remaining_days
        records.append({'name': name, 'start': start, 'end': None,
                        'tenureYears': tenure, 'tenureText': tenure_text})
    if not records:
        raise ValueError('缺少可识别的现任经理简介；不能用团队变动表推测个人任职起点')
    starts = {row['start'] for row in records}
    common_start = records[0]['start'] if len(starts) == 1 and None not in starts else None
    tenures = [row['tenureYears'] for row in records if row['tenureYears'] is not None]
    return {'mgr': '、'.join(row['name'] for row in records), 'mstart': common_start,
            'mten': records[0]['tenureYears'] if common_start else None,
            'managerRecords': records, 'managerCheckedAt': checked_at, 'managerAsOf': asof.isoformat(),
            'managerSourceUrl': source_url, 'managerDateBasis': 'source_observed_at',
            'managerStartBasis': 'explicit_individual_appointment',
            'managerTenureMin': min(tenures) if len(tenures) == len(records) else None,
            'managerTenureMax': max(tenures) if len(tenures) == len(records) else None,
            'managerTenureBasis': 'calendar_days_since_explicit_appointment/365.2425'}


def manager_fetch(code, refresh=False):
    """Cache source text with its real observation time; offline replay keeps that time."""
    path = os.path.join(MANAGER_DIR, code + '.json')
    cached = load_json(path, {})
    source_url = 'https://fundf10.eastmoney.com/jjjl_' + code + '.html'
    fresh = False
    if cached.get('fetchedAt') and cached.get('html'):
        try:
            when = datetime.fromisoformat(cached['fetchedAt'])
            fresh = 0 <= (datetime.now(timezone.utc) - when).total_seconds() < 7 * 86400
        except (TypeError, ValueError):
            pass
    failed = False
    if not OFFLINE and (refresh or not fresh):
        page = http_get(source_url, referer='https://fundf10.eastmoney.com/', tries=2, timeout=10)
        checked_at = datetime.now(timezone.utc).isoformat()
        if page:
            try:
                manager_parse(page, checked_at, source_url)
                cached = {'schemaVersion': 1, 'sourceUrl': source_url, 'fetchedAt': checked_at,
                          'htmlSha256': hashlib.sha256(page.encode('utf-8')).hexdigest(), 'html': page}
                os.makedirs(MANAGER_DIR, exist_ok=True)
                temp = path + '.tmp'
                with open(temp, 'w', encoding='utf-8') as fh:
                    json.dump(cached, fh, ensure_ascii=False)
                os.replace(temp, path)
            except ValueError as exc:
                failed = True
                log('  !! %s 经理资料拒绝解析：%s' % (code, exc))
        else:
            failed = True
    if not cached.get('html') or not cached.get('fetchedAt'):
        return {'managerDataStatus': 'unavailable'}
    try:
        result = manager_parse(cached['html'], cached['fetchedAt'], cached.get('sourceUrl') or source_url)
        result['managerDataStatus'] = 'refresh_failed' if failed else 'cached' if OFFLINE or fresh and not refresh else 'checked'
        result['managerSourceSha256'] = cached.get('htmlSha256')
        return result
    except ValueError as exc:
        log('  !! %s 经理缓存未通过解析：%s' % (code, exc))
        return {'managerDataStatus': 'unavailable'}


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
        log('  ~ %s jjfl %s' % (code, '离线缓存' if OFFLINE else '网络失败，用缓存'))
    if not html:
        return {}
    reference = datetime.fromtimestamp(os.path.getmtime(cache)) if os.path.exists(cache) else datetime.now()
    return jjfl_parse(html, reference)


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
    fresh = os.path.exists(cache) and (time.time() - os.path.getmtime(cache)) < 86400
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


def parse_actions_page(html):
    """Accept only recognized dividend AND split tables, including explicit empty tables."""
    dividend_table = re.search(r"<table[^>]*class=['\"][^'\"]*\bcfxq\b[^'\"]*['\"][^>]*>(.*?)</table>", html, re.S)
    split_table = re.search(r"<table[^>]*class=['\"][^'\"]*\bfhxq\b[^'\"]*['\"][^>]*>(.*?)</table>", html, re.S)
    if not dividend_table or not split_table:
        return None
    divs = {m.group(1): float(m.group(2)) / 10 for m in re.finditer(
        r'<td>(\d{4}-\d{2}-\d{2})</td>\s*<td>每10份派现金([\d.]+)元</td>', dividend_table.group(1))}
    splits = {m.group(1): float(m.group(2)) for m in re.finditer(
        r'<td>(\d{4}-\d{2}-\d{2})</td>\s*<td>[^<]*</td>\s*<td>1[:：]([\d.]+)</td>', split_table.group(1))}
    if not divs and '暂无分红信息' not in dividend_table.group(1):
        return None
    if not splits and '暂无拆分信息' not in split_table.group(1):
        return None
    # Reject partial parsing: every declared action row must have a recognized value.
    if len(divs) != len(re.findall('每10份派现金', dividend_table.group(1))):
        return None
    if splits and len(splits) != len(re.findall(r'<td>\d{4}年</td>', split_table.group(1))):
        return None
    return {'dividends': divs, 'splits': splits}


def attach_corporate_actions(code, rows):
    fhsp_fetch(code)
    cache = os.path.join(FHSP_DIR, 'fhsp_%s.html' % code)
    if not os.path.exists(cache):
        return rows
    with open(cache, encoding='utf-8', errors='replace') as fh:
        actions = parse_actions_page(fh.read())
    if actions is None:
        return rows
    action_date = datetime.fromtimestamp(os.path.getmtime(cache)).strftime('%Y-%m-%d')
    if max((row.get('FSRQ', '') for row in rows), default='') > action_date:
        return rows  # A stale action table cannot certify absence of a newer distribution.
    result = []
    for row in rows:
        date = row.get('FSRQ')
        result.append({**row, 'FHFCZ': actions['dividends'].get(date, 0),
                       'SPLIT_FACTOR': actions['splits'].get(date, 1),
                       'ACTIONS_SOURCE': 'Eastmoney dividend and split tables',
                       'ACTIONS_ASOF': action_date})
    return result


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
            log('  ~ %s %s（%d 行）' % (code, '离线历史缓存' if OFFLINE else '历史接口失败，用缓存', len(old)))
            return attach_corporate_actions(code, sorted(old.values(), key=lambda r: r.get('FSRQ') or '', reverse=True))
        log('  !! %s 历史无数据且无缓存' % code)
        return None
    for r in rows:
        if r.get('FSRQ'):
            old[r['FSRQ']] = r
    merged = sorted(old.values(), key=lambda r: r.get('FSRQ') or '', reverse=True)
    merged = attach_corporate_actions(code, merged)
    with open(cache, 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False)
    return merged


def dz_from_hist(rows, navdate):
    """净值接口没给日涨跌幅时，用历史净值算：最新净值日 ÷ 上一个有净值的日期 − 1。
    返回 (涨跌幅%, 基准日)；算不出来返回 (None, None)。
    注意：上一个净值日不一定就是昨天（如 539001 跳过了 09-05/09-07），基准日要一起返回给页面标注。"""
    if not rows or not navdate:
        return None, None
    try:
        ser = total_return_series(rows)
    except ValueError:
        return None, None
    if len(ser) < 2:
        return None, None
    ser.sort(key=lambda x: x[0])
    idx = None
    for i, (d, _v) in enumerate(ser):
        if d == navdate:
            idx = i
    if idx is None or idx == 0:
        return None, None
    base, prev = ser[idx - 1]
    cur = ser[idx][1]
    if prev <= 0:
        return None, None
    return (cur / prev - 1) * 100, base


def finite_number(value):
    try:
        number = float(str(value).replace('%', ''))
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def total_return_series(rows):
    """Return [(date, wealth_index)] without treating cumulative NAV as total return.

    Explicit corporate actions use (NAV * split_factor + cash_per_old_unit) / prior_NAV.
    Otherwise use the provider's published daily growth rate, which handles actions.
    A plain NAV ratio is allowed only when both action fields are explicitly supplied;
    a missing action record is not evidence that no distribution happened.
    Provider daily rates are rounded, so this basis is labelled, never 'independently verified'.
    """
    unique = {}
    for row in rows or []:
        date = row.get('FSRQ')
        if not date:
            continue
        datetime.strptime(date, '%Y-%m-%d')
        if date in unique and unique[date] != row:
            raise ValueError('历史净值日期冲突：' + date)
        unique[date] = row
    series, previous_nav, previous_date, wealth = [], None, None, 1.0
    for date, row in sorted(unique.items()):
        nav = finite_number(row.get('DWJZ'))
        if nav is None or nav <= 0:
            raise ValueError('无效单位净值：' + date)
        if previous_nav is not None:
            daily = finite_number(row.get('JZZZL'))
            dividend = finite_number(row.get('FHFCZ'))
            split = finite_number(row.get('SPLIT_FACTOR'))
            gap = (datetime.strptime(date, '%Y-%m-%d') - datetime.strptime(previous_date, '%Y-%m-%d')).days
            if gap > 21:
                raise ValueError('净值历史存在超过21日的缺口：' + date)
            if split is not None or (dividend is not None and dividend > 0):
                factor = (nav * (split if split is not None else 1.0) + (dividend or 0.0)) / previous_nav
                if split is not None and split <= 0:
                    raise ValueError('无效拆分比例：' + date)
            elif daily is not None:
                factor = 1.0 + daily / 100.0
            elif 'FHFCZ' in row and 'SPLIT_FACTOR' in row and dividend is not None:
                factor = nav / previous_nav
            else:
                raise ValueError('缺少每日收益或完整分红拆分记录：' + date)
            if not math.isfinite(factor) or factor <= 0 or factor > 5:
                raise ValueError('日收益倍率异常：' + date)
            if daily is None and abs(factor - 1) > 0.35 and split is None:
                raise ValueError('未解释的净值断裂：' + date)
            wealth *= factor
        series.append((date, wealth))
        previous_nav, previous_date = nav, date
    return series


def risk_window(series, anchor, years=5):
    """Risk of a complete calendar window, including its initial peak observation."""
    result = {'vol': None, 'mdd': None, 'start': None, 'end': None,
              'years': years, 'observations': 0, 'annualization': 250,
              'status': 'insufficient_history', 'reason': '历史未覆盖完整窗口'}
    ordered = sorted((day, value) for day, value in series if day <= anchor)
    if not ordered:
        return result
    end = ordered[-1][0]
    result['end'] = end
    anniversary = add_years(end, -years)
    before = [(day, value) for day, value in ordered if day <= anniversary]
    if not before:
        return result
    start = before[-1][0]
    window = [(day, value) for day, value in ordered if start <= day <= end]
    result['observations'] = len(window)
    if len(window) < years * 200:
        result['reason'] = '观测数量不足以计算完整日频风险'
        return result
    if any(not math.isfinite(value) or value <= 0 for _, value in window):
        result.update(status='invalid_data', reason='风险窗口内有无效价格')
        return result
    gaps = [(datetime.strptime(b[0], '%Y-%m-%d') - datetime.strptime(a[0], '%Y-%m-%d')).days
            for a, b in zip(window, window[1:])]
    if any(gap <= 0 or gap > 21 for gap in gaps):
        result.update(status='incomplete_history', reason='风险窗口内有重复日期或超过21日的缺口')
        return result
    values = [value for _, value in window]
    logs = [math.log(b / a) for a, b in zip(values, values[1:])]
    mean = sum(logs) / len(logs)
    variance = sum((value - mean) ** 2 for value in logs) / (len(logs) - 1)
    peak, drawdown = values[0], 0.0
    for value in values:
        peak = max(peak, value)
        drawdown = min(drawdown, value / peak - 1)
    result.update(vol=math.sqrt(variance * 250) * 100, mdd=drawdown * 100,
                  start=start, status='available', reason=None)
    return result


def currency_risk_window(series, fx_series, anchor, years=5):
    """Require an actual FX observation for every asset day; never fill a missing FX close."""
    original = risk_window(series, anchor, years)
    result = {**original, 'vol': None, 'mdd': None, 'currency': 'CNY',
              'fxAlignment': 'same_exchange_local_calendar_date', 'missingFxDates': []}
    if original['status'] != 'available':
        return result
    window = [(day, value) for day, value in series if original['start'] <= day <= original['end']]
    rates = {day: value for day, value in fx_series or [] if value is not None and math.isfinite(value) and value > 0}
    missing = [day for day, _ in window if day not in rates]
    if missing:
        result.update(start=None, status='incomplete_fx', reason='缺少%d个资产交易日的同日实际汇率；完整人民币日风险留空' % len(missing),
                      missingFxDates=missing, requiredStart=original['start'])
        return result
    converted = [(day, value * rates[day]) for day, value in window]
    result.update(risk_window(converted, anchor, years))
    return result


def calc_metrics(rows):
    """Calendar-year windows of an explicitly adjusted wealth series."""
    ordered = sorted(rows or [], key=lambda row: row.get('FSRQ', ''))
    if not ordered:
        return None
    earliest_needed = add_years(ordered[-1]['FSRQ'], -max(WINDOWS))
    before = [row for row in ordered if row.get('FSRQ', '') <= earliest_needed]
    # History before the earliest requested baseline is outside these calculations.
    relevant = (before[-1:] if before else []) + [row for row in ordered if row.get('FSRQ', '') > earliest_needed]
    ser = total_return_series(relevant)
    if len(ser) < 2:
        return None
    latest = ser[-1][0]
    Tend = ser[-1][1]
    out = {'r': [], 'periods': [], 'first': ser[0][0], 'asOf': latest, 'basis': 'provider_daily_return_or_explicit_actions',
           'observations': len(ser)}
    for n in WINDOWS:
        b = add_years(latest, -n)
        base, base_date = None, None
        for date, t in ser:
            if date <= b:
                base, base_date = t, date
            else:
                break
        out['r'].append(None if base is None else (Tend / base - 1) * 100)
        out['periods'].append({'years': n, 'start': base_date, 'end': latest})
    risk3, risk5 = risk_window(ser, latest, 3), risk_window(ser, latest, 5)
    out.update(v3=risk3['vol'], mdd3=risk3['mdd'], vol5=risk5['vol'], mdd5=risk5['mdd'],
               riskStart=risk5['start'], risk3First=risk3['start'], risk5First=risk5['start'],
               risk5Status=risk5['status'])
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
            return sorted((k.split(',')[0], float(k.split(',')[1])) for k in d['data']['klines'] if k.split(',')[0] <= end)
        last = s
        time.sleep(2.0)
    log('  !! 基准行情失败: %s' % last)
    return None


# 只有价格指数允许同口径备用源；ETF 禁止未复权价格降级。
SINA_SYM = {'标普500指数': '.INX', '纳斯达克综合指数': '.IXIC', '纳斯达克100指数': '.NDX'}


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


def observation_at(series, target, max_gap=7):
    eligible = [(d, v) for d, v in series or [] if d <= target and v > 0]
    if not eligible:
        return None
    date, value = max(eligible, key=lambda row: row[0])
    if (datetime.strptime(target, '%Y-%m-%d') - datetime.strptime(date, '%Y-%m-%d')).days > max_gap:
        return None
    return date, value


def convert_usd_return(usd_return, start_usdcny, end_usdcny):
    """USDCNY is yuan per dollar: yuan wealth grows by end FX / start FX."""
    if any(v is None for v in (usd_return, start_usdcny, end_usdcny)) or start_usdcny <= 0 or end_usdcny <= 0:
        return None
    return ((1 + usd_return / 100) * end_usdcny / start_usdcny - 1) * 100


def bench_compute(anchor, fx_old=None):
    """Keep basis, identity, and actual endpoint dates for every benchmark.

    An unavailable adjusted ETF series is missing, never unadjusted fallback.
    Old FX changes are not reused for a new observation date.
    """
    # This endpoint exposes adjclose explicitly, unlike the former third-party close field.
    import strategy_backtest as strategy_source
    symbols = {'标普500指数': '^GSPC', '纳斯达克综合指数': '^IXIC', '纳斯达克100指数': '^NDX'}
    closes, source = {}, {}
    for name, tp, secids, note, fqt in BM_DEFS:
        symbol = symbols.get(name, name)
        try:
            values = list(strategy_source.load_history(symbol, refresh=not OFFLINE, offline=OFFLINE).items())
            source[name] = 'Yahoo Finance chart indicators.adjclose: ' + symbol
        except Exception as exc:
            log('  ~ %s Yahoo 数据不可用：%s' % (name, exc))
            values = kline_closes(secids, anchor, fqt) if not OFFLINE else None
            source[name] = 'Eastmoney adjusted close' if fqt else 'Eastmoney index close'
        if not values and fqt == 0 and name in SINA_SYM and not OFFLINE:
            values = sina_us_kline(SINA_SYM[name])
            source[name] = 'Sina index close'
        if values:
            closes[name] = sorted((d, v) for d, v in values if d <= anchor and v > 0)
    # Distinct indices cannot share an identical multiyear path.
    a, b = closes.get('纳斯达克综合指数'), closes.get('纳斯达克100指数')
    if a and b and len(a) > 200 and a == b:
        closes.pop('纳斯达克综合指数')
        closes.pop('纳斯达克100指数')
        log('  !! 纳综与纳指100行情完全相同，拒绝展示两条可疑基准')
    try:
        fxk = sorted(strategy_source.load_history('CNY=X', refresh=not OFFLINE, offline=OFFLINE).items())
    except Exception as exc:
        # A replacement must prove both currency and calendar convention first.
        # Do not silently switch to an unvalidated FX endpoint after a source failure.
        log('  !! 同币种且有交易时区证明的汇率不可用：%s' % exc)
        fxk = None
    bm = []
    for name, tp, secids, note, fqt in BM_DEFS:
        cl = closes.get(name, [])
        last = observation_at(cl, anchor)
        row = {'n': name, 'tp': tp, 'usd': [], 'cny': [], 'note': note,
               'source': source[name], 'basis': 'provider_adjusted_close' if fqt else 'price_index',
               'sourceUrl': ('https://finance.yahoo.com/quote/' + urllib.parse.quote(symbols.get(name, name), safe='') + '/history/')
                            if source[name].startswith('Yahoo') else
                            'https://stock.finance.sina.com.cn/usstock/quotes/' + SINA_SYM[name] + '.html'
                            if source[name].startswith('Sina') else 'https://quote.eastmoney.com/',
               'asOf': last[0] if last else None, 'periods': [],
               'status': 'computed' if last else 'unavailable'}
        for years in WINDOWS:
            base = observation_at(cl, add_years(last[0], -years)) if last else None
            usd = (last[1] / base[1] - 1) * 100 if base and last else None
            fx_start = observation_at(fxk, base[0]) if base else None
            fx_end = observation_at(fxk, last[0]) if last else None
            cny = convert_usd_return(usd, fx_start[1] if fx_start else None, fx_end[1] if fx_end else None)
            row['usd'].append(usd)
            row['cny'].append(cny)
            row['periods'].append({'years': years, 'start': base[0] if base else None,
                                   'end': last[0] if last else None,
                                   'fxStart': fx_start[0] if fx_start else None,
                                   'fxEnd': fx_end[0] if fx_end else None})
        risk_anchor = last[0] if last else anchor
        usd_risk = risk_window(cl, risk_anchor, 5)
        usd_risk['currency'] = 'USD'
        cny_risk = currency_risk_window(cl, fxk, risk_anchor, 5)
        row.update(riskUSD5=usd_risk, riskCNY5=cny_risk,
                   vol5USD=usd_risk['vol'], mdd5USD=usd_risk['mdd'],
                   vol5CNY=cny_risk['vol'], mdd5CNY=cny_risk['mdd'],
                   fxSourceUrl='https://finance.yahoo.com/quote/CNY%3DX/history/',
                   fxDateConvention='exchange_local_date')
        bm.append(row)
    fx_end = observation_at(fxk, anchor)
    fx = []
    for years in WINDOWS:
        fx_start = observation_at(fxk, add_years(anchor, -years))
        fx.append((fx_end[1] / fx_start[1] - 1) * 100 if fx_end and fx_start else None)
    return {'bm': bm, 'fx': fx,
            'complete': bool(fxk) and all(row['status'] == 'computed' and all(
                usd is None or cny is not None for usd, cny in zip(row['usd'], row['cny'])) for row in bm)}


# ---------------------------------------------------------------- 写回
def apply_fund_patches(src, fund_patches):
    """Change only FUNDS; preserve all other concurrently maintained data blocks."""
    fund_block = re.search(r'(/\*__DATA_FUNDS_BEGIN__\*/)(.*?)(/\*__DATA_FUNDS_END__\*/)', src, re.S)
    lines = fund_block.group(2).splitlines(keepends=True)
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
    src = src[:fund_block.start(2)] + ''.join(lines) + src[fund_block.end(2):]
    return src, changed


def write_patches(fund_patches, bench, meta, quick, changes=None):
    with open(HTML, encoding='utf-8') as f:
        src = f.read()
    expect_funds = len(parse_fund_lines(src))  # 以写回前的行数为基准，避免因只补丁部分基金而误判
    src, changed = apply_fund_patches(src, fund_patches)
    # BM 块
    if bench:
        m = re.search(r'(/\*__DATA_BM_BEGIN__\*/\n)(.*?)(\n/\*__DATA_BM_END__\*/)', src, re.S)
        if m:
            rows = [json.dumps(b, ensure_ascii=False, allow_nan=False) + ',' for b in bench['bm'] if b]
            src = src[:m.start()] + m.group(1) + 'var BM=[\n' + '\n'.join(rows) + '\n];' + m.group(3) + src[m.end():]
            log('  ✓ 基准 BM 已更新（%d 条）' % len(rows))
    # META 块
    m = re.search(r'(/\*__DATA_META_BEGIN__\*/\n)(.*?)(\n/\*__DATA_META_END__\*/)', src, re.S)
    if m:
        fx = bench['fx'] if bench else meta.get('fx_old', [None] * len(WINDOWS))
        fx = [fnum(v) for v in fx]
        meta_lit = ('var META={gen:%s,navdate:%s,snpdate:%s,snptime:%s,szdate:%s,fx:[%s]};' % (
            json.dumps(meta['gen'], ensure_ascii=False),
            json.dumps(meta['navdate'], ensure_ascii=False),
            json.dumps(meta['snpdate'], ensure_ascii=False),
            json.dumps(meta['snptime'], ensure_ascii=False),
            json.dumps(meta['szdate'], ensure_ascii=False),
            ','.join(fx)))
        src = src[:m.start()] + m.group(1) + meta_lit + m.group(3) + src[m.end():]
    # 申购变动块（页面「申购变动」卡片的数据源）
    if changes is not None:
        src = write_changes_block(src, changes)
    # 写回前自检：任何一项不过就整份放弃，宁可保留上一版也不要把页面写坏
    problems = validate_src(src, expect_funds)
    if problems:
        log('  !! 写回前校验未通过，已放弃本次写回（data/snapshot.js 保持原样）：')
        for p in problems[:10]:
            log('     - %s' % p)
        return False
    backup_and_write(src)
    log('  ✓ FUNDS 更新 %d 行，META 已写回（结构校验通过，上一版备份 .tmp-snap/snapshot.js.prev）' % changed)
    return True


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


# ---------------------------------------------------------------- main
def main():
    global OFFLINE
    parser = argparse.ArgumentParser(description='刷新海外基金与真实基准；失败显式保留日期')
    parser.add_argument('--quick', action='store_true', help='只刷新基金，跳过基准')
    parser.add_argument('--hist', action='store_true', help='只重算历史与基准')
    parser.add_argument('--offline', action='store_true', help='严格只用缓存')
    parser.add_argument('--only', help='限定基金代码，逗号分隔；用于诊断')
    parser.add_argument('--managers-only', action='store_true', help='只更新经理姓名、个人任职日期和资料来源；不改收益与其他数据块')
    parser.add_argument('--refresh-managers', action='store_true', help='重新核对经理公开资料，跳过7日缓存时效')
    args = parser.parse_args()
    OFFLINE = args.offline
    for directory in (FHSP_DIR, HIST_DIR, SNAP_DIR, MANAGER_DIR):
        os.makedirs(directory, exist_ok=True)
    with open(HTML, encoding='utf-8') as fh:
        src = fh.read()
    old_meta = read_old_meta(src)
    funds = parse_fund_lines(src)
    requested = set(args.only.split(',')) if args.only else None
    if requested:
        unknown = requested - {code for _, code, _ in funds}
        if unknown:
            parser.error('未知基金代码：' + ','.join(sorted(unknown)))
        funds = [row for row in funds if row[1] in requested]
    codes = [code for _, code, _ in funds]
    if args.managers_only:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda code: manager_fetch(code, refresh=args.refresh_managers), codes))
        manager_patches = {code: {key: json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
                                  for key, value in result.items()} for code, result in zip(codes, results)}
        # Re-read immediately before applying the narrow patch; EXTRA has its own writer.
        with open(HTML, encoding='utf-8') as fh:
            original = fh.read()
        updated, changed = apply_fund_patches(original, manager_patches)
        problems = validate_src(updated, len(parse_fund_lines(original)))
        if problems:
            log('经理字段写回校验失败：', problems)
            return 2
        backup_and_write(updated)
        failed = [code for code, result in zip(codes, results) if result['managerDataStatus'] in ('unavailable', 'refresh_failed')]
        log('FUNDS经理更新 %d/%d；无法核对：%s' % (changed, len(codes), ','.join(failed) or '无'))
        return 3 if failed else 0
    patches, failures, dates, size_dates, refreshed = {}, [], [], [], 0
    quotes = fund_mnfinfo(codes) if not args.offline and not args.hist else {}
    for line, code, is_etf in funds:
        patch = {}
        row_ok = True
        rows = history_fetch(code)
        try:
            metrics = calc_metrics(rows)
        except ValueError as exc:
            metrics = None
            log('  !! %s 收益拒绝计算：%s' % (code, exc))
        if metrics:
            if code == '539001':
                # The provider retains predecessor history. It is not five/ten years
                # of Nasdaq-100 tracking under the contract effective 2021-09-22.
                patch['historyReturns'] = '[' + ','.join(fnum(v) for v in metrics['r']) + ']'
                patch['strategySince'] = "'2021-09-22'"
                patch['historyNote'] = "'2021-09-22转为指数基金；跨转型窗口不参与同策略收益比较'"
                metrics['r'] = [value if add_years(metrics['asOf'], -years) >= '2021-09-22' else None
                                for years, value in zip(WINDOWS, metrics['r'])]
                if metrics['risk5First'] and metrics['risk5First'] < '2021-09-22':
                    patch['historyMdd5'] = fnum(metrics['mdd5'], 2)
                    patch['historyVol5'] = fnum(metrics['vol5'], 2)
                    metrics.update(mdd5=None, vol5=None, risk5First=None, riskStart=None, risk5Status='cross_strategy_change')
            patch['r'] = '[' + ','.join(fnum(v) for v in metrics['r']) + ']'
            patch['v3'] = fnum(metrics['v3'], 2)
            patch['mdd3'] = fnum(metrics['mdd3'], 2)
            patch['vol5'] = fnum(metrics['vol5'], 2)
            patch['mdd5'] = fnum(metrics['mdd5'], 2)
            patch['risk3First'] = json.dumps(metrics['risk3First'])
            patch['risk5First'] = json.dumps(metrics['risk5First'])
            patch['risk5Status'] = json.dumps(metrics['risk5Status'])
            patch['retdate'] = "'%s'" % metrics['asOf']
            patch['returnPeriods'] = json.dumps(metrics['periods'], separators=(',', ':'))
            patch['riskStart'] = json.dumps(metrics['riskStart'])
            patch['returnFirst'] = json.dumps(metrics['first'])
            patch['riskFirst'] = json.dumps(metrics['riskStart'])
            patch['returnAsOf'] = "'%s'" % metrics['asOf']
            patch['riskAsOf'] = "'%s'" % metrics['asOf']
            patch['returnBasis'] = "'%s'" % metrics['basis']
        else:
            failures.append(code + ':history')
            row_ok = False
        info = {}
        if not args.hist:
            manager = manager_fetch(code, refresh=args.refresh_managers)
            for key, value in manager.items():
                patch[key] = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
            if manager['managerDataStatus'] in ('unavailable', 'refresh_failed'):
                failures.append(code + ':manager')
                row_ok = False
            info = jjfl_fetch(code)
            if info:
                if not is_etf and info.get('st'):
                    patch['st'] = "'%s'" % info['st']
                    patch['lm'] = json.dumps(info.get('lm') or '--', ensure_ascii=False)
                if info.get('sz') is not None:
                    patch['sz'] = fnum(info['sz'], 1)
                    patch['szdate'] = "'%s'" % info['szdate']
                    size_dates.append(info['szdate'])
            elif not args.offline:
                failures.append(code + ':profile')
                row_ok = False
            nav = quotes.get(code) or info
            if not nav.get('navdate') and rows:
                latest_row = max(rows, key=lambda row: row.get('FSRQ', ''))
                nav = {'nav': finite_number(latest_row.get('DWJZ')), 'navdate': latest_row.get('FSRQ'),
                       'dz': finite_number(latest_row.get('JZZZL'))}
            if nav.get('nav') is not None and nav.get('navdate'):
                patch['nav'] = fnum(nav['nav'])
                patch['navdate'] = "'%s'" % nav['navdate']
                dates.append(nav['navdate'])
                daily, daily_from = nav.get('dz'), None
                if daily is None:
                    daily, daily_from = dz_from_hist(rows, nav['navdate'])
                patch['dz'] = fnum(daily, 2)
                patch['dzfrom'] = "'%s'" % daily_from if daily_from else 'null'
            elif not args.offline:
                failures.append(code + ':nav')
                row_ok = False
        if patch:
            patch['dataStatus'] = "'%s'" % ('cached' if args.offline else 'computed' if row_ok else 'partial')
            patches[code] = patch
            refreshed += 1
    etf_codes = [code for _, code, is_etf in funds if is_etf]
    tq = tencent_etf(etf_codes) if not args.offline and not args.hist else {}
    for code in etf_codes:
        quote = tq.get(code)
        if quote:
            patch = patches.setdefault(code, {})
            for field, key in [('p', 'price'), ('prem', 'prem'), ('pct', 'pct'), ('iopv', 'iopv')]:
                patch[field] = fnum(quote[key])
            patch['quotedAt'] = json.dumps(quote.get('time'))
        elif not args.offline and not args.hist:
            failures.append(code + ':quote')
    navdate = max(set(dates), key=dates.count) if dates else old_meta.get('navdate', '')
    bench = None
    if not args.quick:
        bench = bench_compute(navdate or datetime.now().strftime('%Y-%m-%d'))
        if not bench['complete']:
            failures.append('benchmarks')
    quote_times = sorted(q['time'] for q in tq.values() if re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', q.get('time', '')))
    quote_time = quote_times[-1] if quote_times else None
    meta = {'gen': datetime.now().strftime('%Y-%m-%d %H:%M') if patches or bench else old_meta.get('gen', ''),
            'navdate': navdate,
            'snpdate': quote_time[:10] if quote_time else old_meta.get('snpdate', ''),
            'snptime': quote_time[11:] if quote_time else old_meta.get('snptime', ''),
            'szdate': max(set(size_dates), key=size_dates.count) if size_dates else old_meta.get('szdate', ''),
            'fx_old': [finite_number(x) for x in old_meta.get('fx', [None] * len(WINDOWS))]}
    if not patches and not bench:
        write_status('funds', 'unavailable', mode='offline' if args.offline else 'online',
                     message='没有可重算的历史缓存或有效新数据；保留原始观测日期。', failures=failures)
        return 3
    if not write_patches(patches, bench, meta, args.quick):
        write_status('funds', 'failed', message='写回前校验失败，旧数据未替换', failures=failures)
        return 2
    # All writers target snapshot.js; rendered UI is never modified by a refresh.
    status = 'partial' if failures else 'cached' if args.offline else 'success'
    write_status('funds', status, asOf=navdate, records=refreshed, requested=len(funds),
                 mode='offline' if args.offline else 'online', failures=failures)
    log('FUNDS 更新 %d/%d，状态 %s；净值截至 %s' % (refreshed, len(funds), status, navdate))
    return 3 if failures else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        write_status('funds', 'failed', message='更新被中断，不能宣称完成')
        sys.exit(130)
    except Exception as exc:
        write_status('funds', 'failed', message=str(exc))
        log('!! 更新失败:', exc)
        sys.exit(1)
