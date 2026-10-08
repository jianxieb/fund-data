#!/usr/bin/env python3
"""Read public bank FX reference quotes; never infer customer-specific tariffs.

Use --output to generate a snapshot. Failed banks keep their previous quote and
timestamp; a network outage never becomes an invented zero or today's date.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CURRENCIES = {"美元": "USD", "港币": "HKD", "欧元": "EUR", "英镑": "GBP", "日元": "JPY"}
BOC_URL = "https://www.boc.cn/sourcedb/whpj/"
CMB_URL = "https://fx.cmbchina.com/api/v1/fx/rate"


class QuoteTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], [], None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        if tag in ("td", "th"):
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(self.cell.strip())
            self.cell = None
        if tag == "tr" and self.row:
            self.rows.append(self.row)


def validate_quote(buy, sell, at):
    buy, sell = round(float(buy) / 100, 8), round(float(sell) / 100, 8)
    timestamp = datetime.fromisoformat(at)
    if not 0 < buy <= sell or sell / buy > 1.15:
        raise ValueError("invalid bank bid/ask")
    if timestamp.year < 2025:
        raise ValueError("unexpected old timestamp")
    if timestamp.replace(tzinfo=timezone(timedelta(hours=8))) > datetime.now(timezone.utc) + timedelta(minutes=15):
        raise ValueError("future bank timestamp")
    return {"buy": buy, "sell": sell, "asOf": at}


def parse_boc(html):
    parser = QuoteTable()
    parser.feed(html)
    out = {}
    for row in parser.rows:
        if len(row) < 8 or row[0] not in CURRENCIES:
            continue
        date = datetime.strptime(row[6].split()[0].replace("/", "-"), "%Y-%m-%d").strftime("%Y-%m-%d")
        at = date + " " + row[7]
        out.setdefault(CURRENCIES[row[0]], validate_quote(row[1], row[3], at))
    if "USD" not in out or "HKD" not in out:
        raise ValueError("BOC USD/HKD rows missing")
    return out


def parse_cmb(payload):
    if payload.get("returnCode") != "SUC0000":
        raise ValueError("CMB unsuccessful response")
    out = {}
    for row in payload["body"]:
        if row.get("ccyNbr") not in CURRENCIES:
            continue
        date = datetime.strptime(row["ratDat"], "%Y年%m月%d日").strftime("%Y-%m-%d")
        # rthBid / rthOfr are remittance buying/selling, not rtbBid conversion.
        out[CURRENCIES[row["ccyNbr"]]] = validate_quote(row["rthBid"], row["rthOfr"], date + " " + row["ratTim"])
    if "USD" not in out or "HKD" not in out:
        raise ValueError("CMB USD/HKD rows missing")
    return out


def read_snapshot(path):
    if not path.exists():
        return {"banks": {}}
    source = path.read_text(encoding="utf-8")
    match = re.search(r"window\.MONEY_FLOW_QUOTES\s*=\s*(\{.*\})\s*;", source, re.S)
    if not match:
        raise ValueError("unrecognized quote snapshot wrapper")
    return json.loads(match.group(1))


def fetch_bank(bank):
    url = BOC_URL if bank == "boc" else CMB_URL
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://fx.cmbchina.com/hq/"})
    with urlopen(request, timeout=25) as response:
        body = response.read().decode("utf-8")
    return parse_boc(body) if bank == "boc" else parse_cmb(json.loads(body))


def merge_bank(snapshot, bank, quotes):
    previous = snapshot.setdefault("banks", {}).get(bank, {}).get("quotes", {})
    if any(key in previous and row["asOf"] < previous[key]["asOf"] for key, row in quotes.items()):
        raise ValueError("bank timestamp would regress")
    snapshot["banks"][bank] = {"quotes": {**previous, **quotes}, "source": BOC_URL if bank == "boc" else "https://fx.cmbchina.com/hq/"}


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--output", type=Path, default=ROOT / "data/money-flow-quotes.js")
    options = args.parse_args()
    snapshot = read_snapshot(options.output)
    snapshot.update({"unit": "CNY per 1 foreign currency", "capturedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    success = 0
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {bank: pool.submit(fetch_bank, bank) for bank in ("boc", "cmb")}
        for bank, job in jobs.items():
            try:
                merge_bank(snapshot, bank, job.result())
                success += 1
                print(f"{bank}: reference quotes updated")
            except Exception as error:
                print(f"{bank}: keeping previous timestamp ({type(error).__name__})")
    if not success:
        raise SystemExit("No bank quote refreshed; existing snapshot unchanged")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = options.output.with_suffix(".tmp")
    temporary.write_text("// Public reference prices, not executable customer quotes.\nwindow.MONEY_FLOW_QUOTES = " + json.dumps(snapshot, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    temporary.replace(options.output)


if __name__ == "__main__":
    main()
