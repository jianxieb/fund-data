#!/usr/bin/env python3
"""Read public bank and broker FX references; never infer private tariffs.

Use --output to generate a snapshot. Failed banks keep their previous quote and
timestamp; a network outage never becomes an invented zero or today's date.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from http.cookiejar import CookieJar
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
from urllib.error import URLError
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
CURRENCIES = {"美元": "USD", "港币": "HKD", "欧元": "EUR", "英镑": "GBP", "日元": "JPY"}
BOC_URL = "https://www.boc.cn/sourcedb/whpj/"
CMB_URL = "https://fx.cmbchina.com/api/v1/fx/rate"
BOCHK_USD_URL = "https://www.bochk.com/whk/rates/exchangeRatesUSD/exchangeRatesUSD-input.action?lang=cn"
ICBC_URL = "https://papi.icbc.com.cn/exchanges/ns/getLatest"
CCB_URL = "https://ebank1.ccb.com/cn/home/news/jshckpj_new2.xml"
ABC_URL = "https://ewealth.abchina.com.cn/app/data/api/DataService/ExchangeRateV2"
COMM_URL = "https://www.bankcomm.com/SITE/queryExchangeResult.do"
HSBC_URL = "https://www.services.cn-banking.hsbc.com.cn/mobile/channel/digital-proxy/cnyTransfer/ratesInfo/remittanceRate"
CIB_URL = "https://personalbank.cib.com.cn/pers/main/pubinfo/ifxQuotationQuery/list"
HANG_HK_URL = "https://rbwm-api.hsbc.com.hk/pws-hk-hase-rates-papi-prod-proxy/v1/fxtt-exchange-rates"
HSBC_HK_URL = "https://rbwm-api.hsbc.com.hk/digital-pws-tools-investments-eapi-prod-proxy/v1/investments/exchange-rate?locale=en_HK"
HANG_CN_URL = "https://hacndb-api.hangseng.com.cn/hacn-mobile-experience-platform-papi-prod-proxy/v1/exchange-rate"
ICBC_ASIA_URL = "https://papi.icbc.com.cn/rest/currencies/asia/foreign"
CCB_ASIA_URL = "https://www.asia.ccb.com/hongkong/js/ho_js/hkwhhl01.js"
IBKR_URL = "https://portal.interactivebrokers.com/portal.proxy/v1/mkt/iserver/marketdata/snapshot?conids=12087792,12087797,113342317,15016062,15016059,14433401,12087820,35045199&fields=84,86,6509"
BANK_URLS = {"boc": BOC_URL, "cmb": CMB_URL, "icbc": ICBC_URL, "ccb": CCB_URL,
             "abc": ABC_URL, "comm": COMM_URL, "hsbc": HSBC_URL, "cib": CIB_URL, "bochk": BOCHK_USD_URL, "hanghk": HANG_HK_URL, "hsbchk": HSBC_HK_URL, "hang": HANG_CN_URL, "icbc-asia": ICBC_ASIA_URL, "ccb-asia": CCB_ASIA_URL}
BANK_URLS["ibkr"] = IBKR_URL
SOURCE_URLS = {**BANK_URLS, "cmb": "https://fx.cmbchina.com/hq/",
               "ibkr": "https://portal.interactivebrokers.com/en/whyib/global-access.php",
               "hang": "https://www.hangseng.com.cn/zh-cn/index/useful-information/deposit-exchange-rates/",
               "hanghk": "https://www.hangseng.com/en-hk/rates/foreign-currency-tt-exchange-rates/",
               "hsbchk": "https://www.hsbc.com.hk/investments/products/foreign-exchange/currency-rate/",
               "icbc-asia": "https://www.icbcasia.com/hk/sc/personal/banking/rate/foreign-exchange-rate/default.html",
               "ccb-asia": "https://www.asia.ccb.com/hongkong/personal/accounts/exchange_rate_enquiry.html",
               "cib": "https://personalbank.cib.com.cn/pers/main/pubinfo/ifxQuotationQuery.do",
               "icbc": "https://www.icbc.com.cn/page/721852558099644433.html",
               "ccb": "https://ebank1.ccb.com/chn/forex/exchange-quotations.shtml",
               "abc": "https://ewealth.abchina.com.cn/ForeignExchange/ListPrice/",
               "comm": "https://www.bankcomm.com/BankCommSite/zonghang/cn/newWhpj/foreignExchangeSearch_Cn.html",
               "hsbc": "https://www.services.cn-banking.hsbc.com.cn/PublicContent/common/rate/zh/exchange-rates.html"}


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


def validate_quote(buy, sell, at, divisor=100):
    buy, sell = round(float(buy) / divisor, 8), round(float(sell) / divisor, 8)
    # Python 3.9 accepts only three or six fractional second digits, while
    # the bank API also emits e.g. .07754. Pad for validation only; preserve
    # the original source timestamp in the saved quote.
    compatible_at = re.sub(r"(\d{2}:\d{2}:\d{2}\.)(\d{1,6})(?!\d)",
                           lambda match: match[1] + match[2].ljust(6, "0"), at)
    timestamp = datetime.fromisoformat(compatible_at)
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


def parse_bochk(html):
    parser = QuoteTable()
    parser.feed(html)
    match = re.search(r"资料更新于香港时间：\s*(\d{4}/\d{1,2}/\d{1,2}\s+\d{2}:\d{2}:\d{2})", html)
    if not match:
        raise ValueError("BOCHK timestamp missing")
    at = datetime.strptime(match.group(1), "%Y/%m/%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
    currencies = {"美元/人民币": "CNH", "美元/港元": "HKD"}
    out = {}
    for row in parser.rows:
        if len(row) == 3 and row[0] in currencies:
            quote = validate_quote(row[1], row[2], at, divisor=1)
            out[currencies[row[0]]] = {"bidPerUsd": quote["buy"], "askPerUsd": quote["sell"], "asOf": at}
    if "CNH" not in out or "HKD" not in out:
        raise ValueError("BOCHK CNH/HKD rows missing")
    return out


def parse_ibkr(payload):
    """IBKR's public FX widget: 84 bid, 86 ask, 6509 availability.

    The contract is USD.CNH, so prices are CNH per USD. _updated is the
    snapshot timestamp, NOT the last trade or market-close timestamp.
    Keep Z/Y frozen prices as explicitly labelled references, never live.
    """
    rows = [row for row in payload if row.get("conid") == 113342317]
    if len(rows) != 1:
        raise ValueError("IBKR USD.CNH contract missing or ambiguous")
    row = rows[0]
    availability = row.get("6509", "")
    statuses = {"R": "live", "D": "delayed", "Z": "frozen", "Y": "frozen-delayed"}
    if availability[:1] not in statuses:
        raise ValueError("IBKR quote unavailable or incomplete")
    at = datetime.fromtimestamp(float(row["_updated"]) / 1000, timezone(timedelta(hours=8))).replace(tzinfo=None).isoformat(sep=" ", timespec="milliseconds")
    quote = validate_quote(row["84"], row["86"], at, divisor=1)
    return {"CNH": {"bidPerUsd": quote["buy"], "askPerUsd": quote["sell"], "asOf": at,
                    "timeBasis": "snapshot", "marketDataAvailability": availability,
                    "quoteStatus": statuses[availability[0]], "conid": row["conid"]}}


def required_quotes(out, bank):
    if "USD" not in out or "HKD" not in out:
        raise ValueError(f"{bank} USD/HKD rows missing")
    return out


def parse_hang_hk(payload):
    """Price two actual HKD legs, not an invented preferential USD/CNH quote."""
    at = datetime.fromisoformat(payload["lastUpdateTime"]).astimezone(
        timezone(timedelta(hours=8))).replace(tzinfo=None).isoformat(sep=" ")
    rows = {row["ccyDisplayCode"]: row for row in payload["fxttExchangeRates"]}
    usd = validate_quote(rows["USD"]["ttBuyRate"], rows["USD"]["ttSellRate"], at, divisor=1)
    cnh = validate_quote(rows["CNH"]["ttBuyRate"], rows["CNH"]["ttSellRate"], at, divisor=1)
    return hkd_cross_quotes(usd, cnh)


def parse_hsbc_hk(payload):
    rows = {row["ccy"]: row for row in payload["detailRates"]}
    quotes = {}
    for currency in ("USD", "CNY"):
        row = rows[currency]
        at = datetime.strptime(row["lastUpdateDate"], "%Y-%m-%d %H:%M:%S %z").astimezone(
            timezone(timedelta(hours=8))).replace(tzinfo=None).isoformat(sep=" ")
        # ttBuyRt/ttSelRt are account conversion rates. bankBuyRt/bankSellRt
        # refer to notes and must not enter an account-to-account calculation.
        quotes[currency] = validate_quote(row["ttBuyRt"], row["ttSelRt"], at, divisor=1)
    return hkd_cross_quotes(quotes["USD"], quotes["CNY"])


def hkd_cross_quotes(usd, cnh):
    at = min(usd["asOf"], cnh["asOf"])
    cross = validate_quote(usd["buy"] / cnh["sell"], usd["sell"] / cnh["buy"], at, divisor=1)
    return {
        "HKD": {"bidPerUsd": usd["buy"], "askPerUsd": usd["sell"], "asOf": usd["asOf"]},
        "CNH": {"bidPerUsd": cross["buy"], "askPerUsd": cross["sell"], "asOf": at,
                "path": "via-HKD", "legs": {"usdBuy": usd["buy"], "usdSell": usd["sell"],
                                              "cnhBuy": cnh["buy"], "cnhSell": cnh["sell"]}},
    }


def parse_icbc(payload):
    if payload.get("code") != 0:
        raise ValueError("ICBC unsuccessful response")
    return required_quotes({row["currencyENName"]: validate_quote(
        row["foreignBuy"], row["foreignSell"], row["publishDate"] + " " + row["publishTime"])
        for row in payload["data"] if row.get("currencyENName") in CURRENCIES.values()}, "ICBC")


def parse_icbc_asia(payload):
    """The Asia page prices one foreign unit in HKD, unlike mainland /100 quotes."""
    if payload.get("code") != 0:
        raise ValueError("ICBC Asia unsuccessful response")
    rows = {row["currename"]: row for row in payload["data"]}
    quotes = {}
    for currency in ("USD", "CNY"):
        row = rows[currency]
        quotes[currency] = validate_quote(row["buyrate"], row["salrate"], row["updateTime"], divisor=1)
    return hkd_cross_quotes(quotes["USD"], quotes["CNY"])


def parse_ccb(xml):
    names = {"840": "USD", "344": "HKD", "978": "EUR", "826": "GBP", "392": "JPY"}
    out = {}
    for row in ET.fromstring(xml).findall("ReferencePriceSettlement"):
        currency = names.get(row.findtext("Ofrd_Ccy_CcyCd"))
        if currency and row.findtext("Ofr_Ccy_CcyCd") == "156":
            at = datetime.strptime(row.findtext("LstPr_Dt") + row.findtext("LstPr_Tm"), "%Y%m%d%H%M%S").isoformat(sep=" ")
            # CCB prices are already per ONE currency. Do not use interbank prices.
            out[currency] = validate_quote(row.findtext("BidRateOfCcy"), row.findtext("OfrRateOfCcy"), at, divisor=1)
    return required_quotes(out, "CCB")


def parse_ccb_asia(body):
    """Read public TT prices from the visible ordinary-customer table (210).

    Never execute the wrapper, use interbank fields or grant a privileged tier.
    The source publishes HKD per USD; it is not a direct USD/CNH quote.
    """
    match = re.search(r"jqueryHkInfo\((\{.*\})\)", body, re.S)
    if not match:
        raise ValueError("CCB Asia quote payload missing")
    # The bank repeats the top-level key; its own display script joins these
    # arrays before parsing. A plain JSON parse silently discards the first tier.
    groups = json.loads(match[1].replace('],"ExR_Grp":[', ','))["ExR_Grp"]
    rows = [row for group in groups if group.get("Dif_Dmsn_Val") == "210"
            for row in group["ToCusOfrOutGrp"]
            if row.get("Ofr_Ccy_CcyCd") == "344" and row.get("Ofrd_Ccy_CcyCd") == "840"]
    if len(rows) != 1:
        raise ValueError("CCB Asia ordinary USD/HKD quote missing or ambiguous")
    row = rows[0]
    at = datetime.strptime(row["LstPr_Dt"] + row["LstPr_Tm"], "%Y%m%d%H%M%S").isoformat(sep=" ")
    quote = validate_quote(row["BidRateOfCcy"], row["OfrRateOfCcy"], at, divisor=1)
    return {"HKD": {"bidPerUsd": quote["buy"], "askPerUsd": quote["sell"], "asOf": at}}


def parse_abc(payload):
    if str(payload.get("ErrorCode")) != "0":
        raise ValueError("ABC unsuccessful response")
    out = {}
    for row in payload["Data"]["Table"]:
        match = re.search(r"\(([A-Z]{3})\)", row.get("CurrName", ""))
        if match and match.group(1) in CURRENCIES.values():
            at = datetime.fromisoformat(row["PublishTime"]).astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None).isoformat(sep=" ")
            out[match.group(1)] = validate_quote(row["BuyingPrice"], row["SellPrice"], at)
    return required_quotes(out, "ABC")


def parse_comm(payload):
    html = payload["RSP_BODY"]["fileContent"]
    match = re.search(r"更新时间[：:]\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", html)
    if not match:
        raise ValueError("COMM timestamp missing")
    table, out = QuoteTable(), {}
    table.feed(html)
    for row in table.rows:
        currency = re.search(r"\(([A-Z]{3})/CNY\)", row[0])
        if len(row) >= 6 and currency and currency.group(1) in CURRENCIES.values():
            out[currency.group(1)] = validate_quote(row[2], row[3], match.group(1), divisor=float(row[1]))
    return required_quotes(out, "COMM")


def parse_hsbc(payload):
    if payload.get("responseCode") != "000":
        raise ValueError("HSBC unsuccessful response")
    data, out = payload["data"], {}
    at = datetime.strptime(data["lastUpdateDate"], "%Y-%m-%d").strftime("%Y-%m-%d")
    for row in data["counterForRepeatingBlock"]:
        currency = row.get("exchangeRateCurrency")
        if currency in CURRENCIES.values():
            # HSBC publishes inverse prices; its own website takes reciprocals.
            out[currency] = {**validate_quote(1 / float(row["transferBuyingRate"]), 1 / float(row["transferSellingRate"]), at, divisor=1), "timePrecision": "day"}
    return required_quotes(out, "HSBC")


def parse_cib(payload, observed_at):
    # The official jqGrid endpoint has no quote publication timestamp. Its
    # parent page's clock is NOT a publication time. Record observation time
    # explicitly, and keep the ordinary remittance prices un-discounted here.
    if payload.get("error"):
        raise ValueError("CIB unsuccessful response")
    out = {}
    for row in payload.get("rows", []):
        cells = row.get("cell", [])
        if len(cells) >= 7 and cells[1] in CURRENCIES.values():
            out[cells[1]] = {**validate_quote(cells[3], cells[4], observed_at, divisor=float(cells[2])),
                            "timeBasis": "observed"}
    return required_quotes(out, "CIB")


def parse_hang_cn(payload):
    at = datetime.fromisoformat(payload["time"]).isoformat(sep=" ", timespec="seconds")
    quotes = {row["currencyCode"]: validate_quote(row["ttBuyRate"], row["ttSellRate"], at, divisor=1)
              for row in payload.get("exchangeRateList", []) if row.get("currencyCode") in CURRENCIES.values()}
    return required_quotes(quotes, "Hang Seng China")


def read_snapshot(path):
    if not path.exists():
        return {"banks": {}}
    source = path.read_text(encoding="utf-8")
    match = re.search(r"window\.MONEY_FLOW_QUOTES\s*=\s*(\{.*\})\s*;", source, re.S)
    if not match:
        raise ValueError("unrecognized quote snapshot wrapper")
    return json.loads(match.group(1))


def fetch_bank(bank):
    if bank == "cib":
        opener = build_opener(HTTPCookieProcessor(CookieJar()))
        opener.addheaders = [("User-Agent", "Mozilla/5.0")]
        with opener.open(SOURCE_URLS[bank], timeout=25) as response:
            response.read()
        # Match getPrmNames('dataSet') in the bank's own jqGrid script. Without
        # pagination parameters the endpoint returns 520, not an empty quote.
        query = urlencode({"dataSet.page": 1, "dataSet.rows": 80, "dataSet.sidx": "", "dataSet.sord": "asc", "_search": "false"})
        request = Request(CIB_URL + "?" + query, headers={"Referer": SOURCE_URLS[bank], "X-Requested-With": "XMLHttpRequest"})
        with opener.open(request, timeout=25) as response:
            payload = json.load(response)
        observed_at = datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")
        return parse_cib(payload, observed_at)
    url = BANK_URLS[bank]
    headers = {"User-Agent": "Mozilla/5.0", "Referer": SOURCE_URLS[bank], "Content-Type": "application/json"}
    if bank == "hang":
        headers.update({"Accept": "application/json", "X-HSBC-Locale": "zh_CN", "X-HSBC-Channel-Id": "PWS", "X-HSBC-Chnl-CountryCode": "CN", "Accept-Language": "zh-CN"})
    request = Request(url, data=b"{}" if bank == "icbc" else None, headers=headers)
    try:
        with urlopen(request, timeout=25) as response:
            body = response.read().decode("utf-8")
        if bank == "ibkr":
            payload = json.loads(body)
            # The documented first request may only initialize a subscription.
            # Retry that response once; never loop or erase the last good quote.
            if isinstance(payload, list) and payload and all("84" not in row and "86" not in row for row in payload):
                with urlopen(request, timeout=25) as response:
                    body = response.read().decode("utf-8")
    except URLError as error:
        # The Asia endpoint is compatible with the platform curl TLS backend.
        # Keep curl's certificate verification; never enable unsafe SSL options.
        if bank != "icbc-asia" or "UNSAFE_LEGACY_RENEGOTIATION_DISABLED" not in str(error):
            raise
        body = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "25", url],
                              check=True, capture_output=True, text=True, timeout=30).stdout
    parsers = {"boc": parse_boc, "cmb": parse_cmb, "bochk": parse_bochk, "ibkr": parse_ibkr, "icbc": parse_icbc,
               "ccb": parse_ccb, "abc": parse_abc, "comm": parse_comm, "hsbc": parse_hsbc, "hanghk": parse_hang_hk, "hsbchk": parse_hsbc_hk, "hang": parse_hang_cn, "icbc-asia": parse_icbc_asia, "ccb-asia": parse_ccb_asia}
    return parsers[bank](body if bank in ("boc", "bochk", "ccb", "ccb-asia") else json.loads(body))


def merge_bank(snapshot, bank, quotes):
    offshore_ids = {"bochk": "bochk", "hanghk": "hang", "hsbchk": "hsbc", "icbc-asia": "icbc-asia", "ccb-asia": "ccb-asia"}
    section = snapshot.setdefault("brokerUsd" if bank == "ibkr" else "offshoreUsd" if bank in offshore_ids else "banks", {})
    bank_id = offshore_ids.get(bank, bank)
    previous = section.get(bank_id, {}).get("quotes", {})
    if any(key in previous and row["asOf"] < previous[key]["asOf"] for key, row in quotes.items()):
        raise ValueError("bank timestamp would regress")
    section[bank_id] = {"quotes": {**previous, **quotes}, "source": SOURCE_URLS[bank]}
    if bank in offshore_ids or bank == "ibkr":
        section[bank_id]["unit"] = "foreign currency per 1 USD; Hong Kong renminbi is CNH"
    if bank == "ibkr":
        section[bank_id]["endpoint"] = IBKR_URL


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--output", type=Path, default=ROOT / "data/money-flow-quotes.js")
    args.add_argument("--banks", nargs="+", choices=list(BANK_URLS), default=list(BANK_URLS))
    options = args.parse_args()
    snapshot = read_snapshot(options.output)
    snapshot.update({"unit": "CNY per 1 foreign currency", "capturedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    success = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {bank: pool.submit(fetch_bank, bank) for bank in options.banks}
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
