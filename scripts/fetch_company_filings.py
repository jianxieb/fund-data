#!/usr/bin/env python3
"""Cache dated issuer filings from CNINFO; keep source metadata before PDF extraction."""
import argparse
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.cninfo.com.cn/'}
QUERY = 'https://www.cninfo.com.cn/new/hisAnnouncement/query'


def read(url, data=None):
    with urlopen(Request(url, data=data, headers=HEADERS), timeout=30) as response:
        return response.read()


def select_filing(rows, code, title, asof):
    matches = []
    for row in rows:
        label = re.sub('<[^>]+>', '', row['announcementTitle'])
        published = datetime.fromtimestamp(row['announcementTime'] / 1000,
                                          timezone(timedelta(hours=8))).date().isoformat()
        pattern = re.escape(title[:4]) + r'年?' + re.escape(title[5:]) + r'(?:全文)?(?:[（(][^（）()]*[）)])?$'
        if row.get('secCode') != code or published > asof or not re.search(pattern, label):
            continue
        if any(word in label for word in ('摘要', '英文', '取消', '更正公告', '董事会', '审核', '审议')):
            continue
        if not row.get('adjunctUrl', '').lower().endswith('.pdf'):
            continue
        matches.append({'code': code, 'title': label, 'publishedAt': published,
                        'url': 'https://static.cninfo.com.cn/' + row['adjunctUrl'],
                        'announcementId': row.get('announcementId')})
    return max(matches, key=lambda r: (r['publishedAt'], str(r['announcementId']))) if matches else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codes', required=True, help='Comma separated security codes')
    parser.add_argument('--asof', required=True)
    parser.add_argument('--periods', default='2026-06-30,2025-12-31', help='Half-year or annual report periods')
    parser.add_argument('--output', required=True)
    parser.add_argument('--pdftotext', required=True, help='Available Poppler executable')
    args = parser.parse_args()
    periods = args.periods.split(',')
    for period in periods:
        datetime.fromisoformat(period)
        if period[5:] not in ('06-30', '12-31') or period > args.asof:
            parser.error('仅支持不晚于研究日期的中报和年报期间')
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'filings.json'
    saved = json.loads(path.read_text()) if path.exists() else []
    by_key = {(r['code'], r['period']): r for r in saved}
    stocks = {r['code']: r for r in json.loads(read('https://www.cninfo.com.cn/new/data/szse_stock.json'))['stockList']}
    for code in args.codes.split(','):
        for period in periods:
            title = period[:4] + '年' + ('年度报告' if period.endswith('12-31') else '半年度报告')
            start = str(int(period[:4]) + (1 if period.endswith('12-31') else 0)) + '-01-01'
            key = code, period
            try:
                source = by_key.get(key)
                if source and ('title' not in source or not re.search(re.escape(title[:4]) + r'年?' + re.escape(title[5:]) + r'(?:全文)?(?:[（(][^（）()]*[）)])?$', source['title'])):
                    source = None
                if not source or not source.get('url'):
                    payload = urlencode({'pageNum': 1, 'pageSize': 30,
                        'column': 'sse' if code.startswith('6') else 'szse', 'tabName': 'fulltext',
                        'stock': code + ',' + stocks[code]['orgId'], 'searchkey': title,
                        'seDate': start + '~' + args.asof, 'isHLtitle': 'true'}).encode()
                    result = json.loads(read(QUERY, payload))
                    source = select_filing(result.get('announcements') or [], code, title, args.asof)
                    if not source:
                        retry = dict(pageNum=1, pageSize=100, column='sse' if code.startswith('6') else 'szse',
                                     tabName='fulltext', stock=code + ',' + stocks[code]['orgId'],
                                     searchkey=title[5:], seDate=start + '~' + args.asof, isHLtitle='true')
                        time.sleep(.5)
                        result = json.loads(read(QUERY, urlencode(retry).encode()))
                        source = select_filing(result.get('announcements') or [], code, title, args.asof)
                    if not source:
                        raise ValueError('无匹配的公司原始全文报告')
                    source.update(period=period, name=stocks[code]['zwjc'], retrievedAt=args.asof)
                    by_key[key] = source
                    path.write_text(json.dumps(list(by_key.values()), ensure_ascii=False, indent=2) + '\n')
                    time.sleep(.5)
                pdf = folder / (code + '-' + period + '.pdf')
                # Old local files without a source binding may be notices rather than the full filing.
                if not pdf.exists() or not source.get('sha256'):
                    pdf.write_bytes(read(source['url']))
                    pdf.with_suffix('.txt').unlink(missing_ok=True)
                if not pdf.read_bytes().startswith(b'%PDF-'):
                    raise ValueError('下载内容不是PDF')
                source['sha256'] = hashlib.sha256(pdf.read_bytes()).hexdigest()
                txt = pdf.with_suffix('.txt')
                if not txt.exists():
                    subprocess.run(['rtk', 'proxy', args.pdftotext, '-layout', str(pdf), str(txt)], check=True,
                                   capture_output=True, text=True)
                if len(txt.read_text().split('\f')) < 20:
                    raise ValueError('报告全文页数异常，需核对原文')
                source['extracted'] = True
                source.pop('error', None)
            except Exception as exc:
                by_key.setdefault(key, {'code': code, 'period': period})['error'] = str(exc)
            path.write_text(json.dumps(list(by_key.values()), ensure_ascii=False, indent=2) + '\n')
        print(code, '完整' if all(by_key.get((code, p), {}).get('extracted') and not by_key.get((code, p), {}).get('error') for p in periods) else '有缺口', flush=True)


if __name__ == '__main__':
    main()
