#!/usr/bin/env python3
"""Reproduce PE source comparisons without changing any published observations.

Dates are literal source dates. No month alignment, trading-day shift, forward
fill, interpolation, or substitution is used in exact-date comparisons.
Run: python3 scripts/audit_market_history_pe.py
The raw input directories are intentionally separate from the published data.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
from html.parser import HTMLParser
from io import BytesIO
import itertools
import json
import math
from pathlib import Path
import re
import statistics
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / ".tmp-snap/market-history/pe-review-20261113"
NEW = ROOT / ".tmp-snap/market-history/pe-review-20261114"
EVIDENCE = ROOT / "docs/evidence/market-history/pe-source-review-20261113.json"
CHINA = timezone(timedelta(hours=8))


def positive(value):
    if isinstance(value, bool):
        raise ValueError("boolean is not a PE/price")
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ValueError(f"non-positive/non-finite PE/price: {value!r}")
    return result


def observation(day, pe, **extra):
    parsed = date.fromisoformat(day)
    if parsed.isoformat() != day:
        raise ValueError(f"noncanonical date: {day}")
    return dict(date=day, pe=positive(pe), **extra)


def unique(rows):
    out = {}
    for row in rows:
        if row["date"] in out:
            raise ValueError(f"duplicate date requires explicit version selection: {row['date']}")
        out[row["date"]] = row
    return out


def parse_jiucai(data, code):
    if data["code"] != code or data["metric"] != "pe":
        raise ValueError("Jiucai series identity mismatch")
    rows = [observation(r["date"], r["value"], close=positive(r["close"]))
            for r in data["series"]]
    unique(rows)
    return rows


def danjuan_date(timestamp_ms):
    dt = datetime.fromtimestamp(timestamp_ms / 1000, CHINA)
    if dt.time().isoformat() != "00:00:00":
        raise ValueError(f"Danjuan timestamp is not UTC+08 midnight: {timestamp_ms}")
    return dt.date().isoformat()


def parse_danjuan(data):
    rows = [observation(danjuan_date(r["ts"]), r["pe"], ts=r["ts"])
            for r in data["data"]["index_eva_pe_growths"]]
    unique(rows)
    return rows


def parse_danjuan_snapshot(data, code, filename):
    rows = [r for r in data["data"]["items"] if r["index_code"] == code]
    if len(rows) != 1:
        raise ValueError(f"expected one {code} in {filename}")
    r = rows[0]
    return observation(danjuan_date(r["ts"]), r["pe"], ts=r["ts"],
                       file=filename, printedDate=r.get("date"),
                       url=f"https://raw.githubusercontent.com/caibingcheng/djeva/master/source/{filename[6:16]}.json",
                       updatedAt=r.get("updated_at"))


def parse_legu(data):
    dates, series = data["xAxis"], data["series"]
    if len(series) != 2 or any(len(s) != len(dates) for s in series):
        raise ValueError("Legu price/PE arrays are not aligned")
    if "市盈率" not in data["yAxisNames"][1]:
        raise ValueError("Legu second series is not PE")
    rows = []
    for day, close, pe in zip(dates, *series):
        if pe is not None:
            rows.append(observation(day, pe, **({"close": positive(close)} if close is not None else {})))
    unique(rows)
    return rows


class MultplTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.cell = None
        self.cells = []
        self.estimated = False
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table" and attrs.get("id") == "datatable":
            self.active = True
        if not self.active:
            return
        if tag == "tr":
            self.cells, self.estimated = [], False
        elif tag == "td":
            self.cell = ""
        elif attrs.get("title", "").lower() == "estimate":
            self.estimated = True

    def handle_data(self, data):
        if self.active and self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if not self.active:
            return
        if tag == "td" and self.cell is not None:
            self.cells.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and len(self.cells) == 2:
            day = datetime.strptime(self.cells[0], "%b %d, %Y").date().isoformat()
            pe = re.sub(r"[^0-9.\-]", "", self.cells[1])
            self.rows.append(observation(day, pe, estimated=self.estimated or "†" in self.cells[1]))
        elif tag == "table":
            self.active = False


def parse_multpl(html):
    parser = MultplTable()
    parser.feed(html)
    if not parser.rows:
        raise ValueError("Multpl datatable is empty")
    unique(parser.rows)
    return parser.rows


def quarter_number(day):
    dt = date.fromisoformat(day)
    return dt.year * 4 + (dt.month - 1) // 3


def parse_spglobal(rows, basis):
    """Derive trailing PE only from four consecutive, complete EPS quarters."""
    if basis not in ("reported", "operating"):
        raise ValueError("unknown EPS basis")
    rows = sorted(rows, key=lambda r: r["d"])
    result = []
    for i in range(3, len(rows)):
        window = rows[i - 3:i + 1]
        quarters = [quarter_number(r["d"]) for r in window]
        if quarters != list(range(quarters[0], quarters[0] + 4)):
            continue
        if any(r.get(basis) is None for r in window) or rows[i].get("p") is None:
            continue
        eps = sum(float(r[basis]) for r in window)
        if not math.isfinite(eps) or eps <= 0:
            continue
        result.append(observation(rows[i]["d"], positive(rows[i]["p"]) / eps,
                                  close=positive(rows[i]["p"]), ttmEps=eps,
                                  quarterlyRows=[r["row"] for r in window]))
    unique(result)
    return result


def parse_spglobal_workbook(raw):
    """Read the publisher's cached XLSX values; never calculate unknown cells."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    relationship_id = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        properties = workbook.find("m:workbookPr", ns)
        if properties is not None and properties.get("date1904") in ("1", "true"):
            raise ValueError("unexpected Excel date epoch")
        sheet = next(s for s in workbook.findall("m:sheets/m:sheet", ns) if s.get("name") == "QUARTERLY DATA")
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in relationships if r.get("Id") == sheet.get(relationship_id))
        sheet_path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        root = ET.fromstring(archive.read(sheet_path))
        rows = []
        for row in root.findall("m:sheetData/m:row", ns):
            values = {}
            for cell in row.findall("m:c", ns):
                value = cell.find("m:v", ns)
                if value is not None and cell.get("t") not in ("s", "str", "b", "e"):
                    values[re.sub(r"\d", "", cell.get("r"))] = float(value.text)
            serial = values.get("A")
            if serial is None or not 30000 <= serial <= 60000 or not serial.is_integer():
                continue
            rows.append(dict(d=(date(1899, 12, 30) + timedelta(days=serial)).isoformat(),
                             reported=values.get("C"), operating=values.get("B"),
                             p=values.get("H"), row=int(row.get("r"))))
    return sorted(rows, key=lambda r: r["d"])


def select_editions(rows):
    """Select latest knownBy edition, retaining every same-date PE disagreement."""
    grouped = {}
    for row in rows:
        grouped.setdefault(row["date"], []).append(row)
    selected, conflicts = [], []
    for day, editions in sorted(grouped.items()):
        editions.sort(key=lambda r: (r.get("knownBy", ""), r.get("file", "")))
        chosen = editions[-1]
        selected.append(chosen)
        if len({r["pe"] for r in editions}) > 1:
            conflicts.append(dict(date=day, selected=chosen, editions=editions))
    return selected, conflicts


def pair_rows(a, b):
    left, right = unique(a), unique(b)
    result = []
    for day in sorted(left.keys() & right.keys()):
        x, y = left[day], right[day]
        item = dict(date=day, a=x["pe"], b=y["pe"],
                    difference=x["pe"] - y["pe"], relativePct=(x["pe"] / y["pe"] - 1) * 100,
                    estimated=bool(x.get("estimated") or y.get("estimated")))
        if "close" in x and "close" in y:
            item["closeRelativePct"] = (x["close"] / y["close"] - 1) * 100
        result.append(item)
    return result


def percentile(values, p):
    values = sorted(values)
    pos = (len(values) - 1) * p
    low = math.floor(pos)
    return values[low] + (values[math.ceil(pos)] - values[low]) * (pos - low)


def distribution(values):
    if not values:
        return None
    return dict(min=min(values), p10=percentile(values, .1), median=statistics.median(values),
                p90=percentile(values, .9), max=max(values))


def pair_summary(a, b):
    joined = pair_rows(a, b)
    relative = [r["relativePct"] for r in joined]
    absolute = [abs(v) for v in relative]
    return dict(exactDateCount=len(joined), leftUnmatched=len(a) - len(joined),
                rightUnmatched=len(b) - len(joined),
                equalAt1eMinus8=sum(abs(r["difference"]) < 1e-8 for r in joined),
                within001PE=sum(abs(r["difference"]) <= .0100000001 for r in joined),
                within1Percent=sum(v <= 1 for v in absolute),
                signedRelativePct=distribution(relative), absoluteRelativePct=distribution(absolute),
                nonEstimatedCount=sum(not r["estimated"] for r in joined),
                nonEstimatedAbsoluteRelativePct=distribution([abs(r["relativePct"]) for r in joined if not r["estimated"]]),
                sourcePriceRelativePct=distribution([r["closeRelativePct"] for r in joined if "closeRelativePct" in r]),
                largestDifferences=sorted(joined, key=lambda r: abs(r["relativePct"]), reverse=True)[:5])


def source_summary(rows, prices):
    rows = sorted(rows, key=lambda r: r["date"])
    days = [r["date"] for r in rows]
    gaps = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(days, days[1:])]
    eligible = {d for d in prices if days[0] <= d <= days[-1]}
    overlap = set(days) & eligible
    price_first, price_last = min(prices), max(prices)
    missing_within = sorted(d for d in set(days) - set(prices) if price_first <= d <= price_last)
    return dict(count=len(rows), first=days[0], last=days[-1],
                estimatedCount=sum(bool(r.get("estimated")) for r in rows),
                gapDays=distribution(gaps), sameDateIndexPrices=len(overlap),
                sourceDatesWithoutIndexPrice=len(set(days) - set(prices)),
                sourceDatesOutsideSavedPriceSpan=sum(d < price_first or d > price_last for d in days),
                sourceDatesMissingPriceWithinSavedSpan=missing_within,
                indexPriceCoverageWithinSourceSpan=len(overlap) / len(eligible) if eligible else None,
                firstDatesWithoutIndexPrice=sorted(set(days) - set(prices))[:10])


def anomalies(rows, prices):
    """Only consecutive observations in the saved index-price trading sequence."""
    by_date = unique(rows)
    events = []
    for prev, day in zip(sorted(prices), sorted(prices)[1:]):
        if prev not in by_date or day not in by_date:
            continue
        if (date.fromisoformat(day) - date.fromisoformat(prev)).days > 10:
            continue
        a, b = by_date[prev]["pe"], by_date[day]["pe"]
        price_ratio = prices[day] / prices[prev]
        normalized = b / a / price_ratio - 1
        if abs(normalized) >= .05:
            events.append(dict(date=day, previousDate=prev, previousPE=a, pe=b,
                               previousClose=prices[prev], close=prices[day],
                               peChangePct=(b / a - 1) * 100,
                               indexChangePct=(price_ratio - 1) * 100,
                               priceNormalizedPEChangePct=normalized * 100))
    return events


def build(old=OLD, new=NEW, evidence=EVIDENCE):
    inputs = {}

    def read(path, as_json=True):
        raw = path.read_bytes()
        try:
            key = str(path.relative_to(ROOT))
        except ValueError:
            key = str(path)
        inputs[key] = dict(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
        return json.loads(raw) if as_json else raw.decode()

    review = read(evidence)
    published = read(old / "published-market-history.json")
    prices = {m["id"]: dict(m["prices"]["points"]) for m in published["markets"]}
    sources, definitions, edition_conflicts = {}, {}, {}

    def add(market, name, rows, url, convention, method):
        key = f"{market}:{name}"
        if not rows:
            raise ValueError(f"empty source {key}")
        unique(rows)
        sources[key] = sorted(rows, key=lambda r: r["date"])
        definitions[key] = dict(url=url, dateConvention=convention, method=method)

    for market, code, djcode, legu in [("spx", "SPX.GI", "SP500", "sandp"), ("ndx", "NDX.GI", "NDX", "nasdaq100")]:
        add(market, "jiucai", parse_jiucai(read(old / f"pe-research-{code}-pe.json"), code),
            f"https://ai2.jiucaishuo.com/api/index-valuation/history?code={code}&metric=pe",
            "literal series.date; paired source close available",
            "Page labels aggregate TTM; upstream and historical known-at EPS unavailable")
        djpath = new / "danjuan-spx-all.json" if market == "spx" else old / "danjuan-ndx-all.json"
        add(market, "danjuan_weekly", parse_danjuan(read(djpath)),
            f"https://danjuanfunds.com/djapi/index_eva/pe_history/{djcode}?day=all",
            "literal ts converted to UTC+08 date; mostly weekly samples; US market close alignment unverified",
            "Danjuan article 337 describes TTM and Choice; no same-day index price in response")
        add(market, "legu", parse_legu(read(old / f"fund-pe-legu-{legu}.json")),
            f"https://legulegu.com/stockdata/market/{legu}",
            "literal xAxis date for non-null PE only; mostly month-end; economic-date convention unverified",
            "Page labels TTM; no historical EPS/estimate flags; price may be null")
        daily = []
        for path in sorted(new.glob("djeva-????-??-??.json")):
            daily.append(parse_danjuan_snapshot(read(path), djcode, path.name))
        if daily:
            for row in daily:
                row["knownBy"] = row["file"][6:16]
            daily, conflicts = select_editions(daily)
            edition_conflicts[f"{market}:danjuan_archive"] = conflicts
            add(market, "danjuan_archive", daily,
                "https://raw.githubusercontent.com/caibingcheng/djeva/master/source/DATE.json",
                "literal snapshot item ts in UTC+08; archive filename is capture date only",
                "Third-party preservation of Danjuan responses; ts vs US price date unverified")

    add("spx", "multpl", parse_multpl(read(old / "fund-pe-multpl.html", False)),
        "https://www.multpl.com/s-p-500-pe-ratio/table/by-month",
        "literal printed table date; mostly month-first; do not reinterpret as month-end",
        "TTM table; monthly/estimated rows retained as labelled; not a daily series")
    extracted_quarters = read(old / "fund-pe-spglobal-quarterly.json")
    workbook = old / "fund-pe-spglobal-20260527232437.xlsx"
    raw = workbook.read_bytes()
    inputs[str(workbook.relative_to(ROOT))] = dict(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
    quarter_rows = parse_spglobal_workbook(raw)
    by_row = {r["row"]: r for r in quarter_rows}
    for saved in extracted_quarters:
        original = by_row[saved["row"]]
        if original["d"] != saved["d"] or any(not math.isclose(original[k], saved[k], abs_tol=1e-10) for k in ("reported", "operating", "p")):
            raise ValueError(f"saved S&P extraction differs from workbook at row {saved['row']}")
    for basis in ("reported", "operating"):
        add("spx", f"spglobal_{basis}", parse_spglobal(quarter_rows, basis),
            "https://web.archive.org/web/20260527232437id_/https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-eps-est.xlsx",
            "literal QUARTERLY DATA date; four consecutive EPS quarters; workbook publication 2026-01-30",
            f"Quarter close / sum of four {basis} EPS quarters, using later revised workbook; not historical known-at earnings")
    spx_editions = []
    # The older fund-pe-sso-new-results.json captured dates outside the Index
    # block. Never use its date arrays: this corrected artifact was parsed from
    # the bounded Index section, including previously compressed responses.
    corrected_spx = read(evidence.with_name("proshares-spx-archive-20261114.json"))
    for r in corrected_spx["observations"]:
        if r["symbol"] != "SSO" or r["indexName"] != "S&P 500 Index":
            raise ValueError("corrected SPX archive contains a different benchmark")
        capture = re.search(r"/web/(\d{14})", r["archiveUrl"])[1]
        candidates = [p for directory in (old, new) for p in directory.glob(f"*sso-{capture}.html")]
        matching = [p for p in candidates if hashlib.sha256(p.read_bytes()).hexdigest() == r["sourceSha256"]]
        if not matching:
            raise ValueError(f"missing exact original SPX source bytes for {capture}")
        path = matching[0]
        inputs[str(path.relative_to(ROOT))] = dict(sha256=r["sourceSha256"], bytes=path.stat().st_size)
        spx_editions.append(observation(r["asOf"], r["indexPE"], knownBy=r["knownBy"],
                                       url=r["archiveUrl"], file=path.name,
                                       sourceSha256=r["sourceSha256"]))
    current = review["proshares"]["currentPrintedIndex"]
    spx_editions.append(observation(current["date"], current["pe"], knownBy="2026-11-13T00:00:00Z",
                                    file="fund-pe-proshares-sso.html"))
    read(old / "fund-pe-proshares-sso.html", False)
    selected, conflicts = select_editions(spx_editions)
    edition_conflicts["spx:proshares"] = conflicts
    add("spx", "proshares", selected, "https://www.proshares.com/our-etfs/leveraged-and-inverse/sso",
        "literal issuer Index as-of date; latest retained capture per date, conflicts listed",
        "Issuer benchmark PE; TTM and negative-earner treatment not confirmed; sparse observations")
    ndx_editions = [observation(r["asOf"], r["indexPE"], knownBy=r["knownBy"],
                               url=r.get("archiveUrl", r["sourceUrl"]), qualityNote=r.get("qualityNote"))
                    for r in read(old / "existing-proshares-benchmark-valuations.json")["observations"]
                    if r["symbol"] == "TQQQ"]
    selected, conflicts = select_editions(ndx_editions)
    edition_conflicts["ndx:proshares"] = conflicts
    add("ndx", "proshares", selected, "https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq",
        "literal issuer Index as-of date; latest retained capture per date, conflicts listed",
        "Existing archived issuer benchmark PE extraction; sparse; historical method not confirmed")

    summaries = {key: dict(**definitions[key], **source_summary(rows, prices[key.split(":")[0]]))
                 for key, rows in sources.items()}
    pairs = {}
    for market in prices:
        names = [s for s in sources if s.startswith(market + ":")]
        for a, b in itertools.combinations(names, 2):
            pairs[f"{a} vs {b}"] = pair_summary(sources[a], sources[b])

    anomaly_output = {}
    for market in ("spx", "ndx"):
        events = anomalies(sources[f"{market}:jiucai"], prices[market])
        for event in events:
            pivot = date.fromisoformat(event["date"])
            start, end = (pivot - timedelta(days=7)).isoformat(), (pivot + timedelta(days=7)).isoformat()
            event["observationsWithin7CalendarDays"] = {
                name: [r for r in rows if start <= r["date"] <= end]
                for name, rows in sources.items() if name.startswith(market + ":")
            }
        anomaly_output[market] = events

    # Diagnostic only: matching a month label is deliberately outside pair_rows.
    legu = {r["date"][:7]: r for r in sources["spx:legu"]}
    multpl = {r["date"][:7]: r for r in sources["spx:multpl"] if r["date"].endswith("-01")}
    month_pairs = [(legu[m], multpl[m]) for m in sorted(legu.keys() & multpl.keys())]
    month_end_pairs = [(a, b) for a, b in month_pairs
                       if (date.fromisoformat(a["date"]) + timedelta(days=1)).month != date.fromisoformat(a["date"]).month]
    month_diagnostic = dict(
        warning="Different literal dates. Calendar-month association is diagnostic only and never used for replacement or exact-date joins.",
        monthPairs=len(month_pairs), exactPEEqual=sum(a["pe"] == b["pe"] for a, b in month_pairs),
        trueMonthEndToMonthFirstPairs=len(month_end_pairs),
        trueMonthEndPEEqual=sum(a["pe"] == b["pe"] for a, b in month_end_pairs),
        nonEstimatedMonthPairs=sum(not b["estimated"] for _, b in month_pairs),
        nonEstimatedPEEqual=sum(a["pe"] == b["pe"] and not b["estimated"] for a, b in month_pairs),
        examples=[dict(legu=a, multpl=b) for a, b in month_pairs if a["date"] in ("2020-12-31", "2021-03-31", "2026-07-31", "2026-10-31")])

    # A direct comparison of preserved snapshots with the public weekly history.
    archive_checks = {}
    for market in ("spx", "ndx"):
        key = f"{market}:danjuan_archive"
        if key in sources:
            a, b = sources[key], sources[f"{market}:danjuan_weekly"]
            archive_checks[market] = dict(summary=pair_summary(a, b), exactDateRows=pair_rows(a, b),
                unpairedArchiveRows=[r for r in a if r["date"] not in unique(b)])

    dj_script = read(old / "danjuan-detail.js", False)
    allowed_periods = [{"label": "近3年", "value": "3y"}, {"label": "近5年", "value": "5y"}, {"label": "近10年", "value": "all"}]
    # Require the exact observed public-script enumeration, not guessed API periods.
    expected = '[{label:"近3年",value:"3y"},{label:"近5年",value:"5y"},{label:"近10年",value:"all"}]'
    if expected not in dj_script:
        raise ValueError("Danjuan public period-list changed; review script before asserting supported periods")
    dj_sampling = dict(publicScript="https://djfunds-static.imedao.com/static/js/valuation_table-dj-valuation-table-detail.172fd239.js",
                       verifiedPublicPeriods=allowed_periods, periods={})
    for period in ("3y", "5y", "all"):
        rows = parse_danjuan(read(old / f"danjuan-ndx-{period}.json"))
        all_rows = unique(sources["ndx:danjuan_weekly"])
        exact = [r for r in rows if r["date"] in all_rows]
        dj_sampling["periods"][period] = dict(**source_summary(rows, prices["ndx"]),
            sameDateWithAll=len(exact), equalToAll=sum(r["pe"] == all_rows[r["date"]]["pe"] for r in exact))
    if (new / "danjuan-spx-all.manifest.json").exists():
        dj_sampling["spxFetch"] = read(new / "danjuan-spx-all.manifest.json")

    anchors = []
    for day in ("2020-12-31", "2021-03-31", "2022-07-18", "2025-09-30", "2026-09-30"):
        anchors.append(dict(date=day, observations={name: unique(rows)[day]
                       for name, rows in sources.items() if day in unique(rows)}))

    official_ndx = None
    official_path = evidence.with_name("nasdaq-pe-crosschecks-20261114.json")
    if official_path.exists():
        official_ndx = read(official_path)
        for source in official_ndx["sources"]:
            if source.get("path"):
                path = ROOT / source["path"]
                source_raw = path.read_bytes()
                actual_hash = hashlib.sha256(source_raw).hexdigest()
                if actual_hash != source["sha256"]:
                    raise ValueError(f"official Nasdaq PDF fingerprint mismatch: {path}")
                inputs[source["path"]] = dict(sha256=actual_hash, bytes=len(source_raw))
        for check in official_ndx["sameLabelDateChecks"]:
            day = check["asOf"]
            check["otherSameLabelDateValues"] = {name: unique(rows)[day]["pe"] for name, rows in sources.items()
                                                if name.startswith("ndx:") and day in unique(rows)}
    ndx_spotchecks = None
    spotcheck_path = evidence.with_name("proshares-ndx-original-spotchecks-20261114.json")
    if spotcheck_path.exists():
        ndx_spotchecks = read(spotcheck_path)
        for check in ndx_spotchecks["checks"]:
            if check.get("file"):
                raw = (ROOT / check["file"]).read_bytes()
                if hashlib.sha256(raw).hexdigest() != check["sha256"]:
                    raise ValueError("NDX original spot-check fingerprint mismatch")
                inputs[check["file"]] = dict(sha256=check["sha256"], bytes=len(raw))

    report = dict(schemaVersion=1, reviewDate="2026-11-14", frozenPublishedAsOf=published["asOf"],
        rules={"join": "exact literal ISO source date only", "noDateShift": True, "noForwardFill": True,
               "relativeDifference": "100 * (left PE / right PE - 1)",
               "datesDoNotEstablishCompatibleMethods": True,
               "anomaly": "consecutive saved index-price observations, both with PE, gap <= 10 calendar days; abs((PE_t/PE_prev)/(close_t/close_prev)-1) >= 0.05",
               "editionSelection": "latest knownBy capture per source date; all different-PE editions retained in editionConflicts",
               "sourceFiles": "sha256 over saved raw bytes; no network during this audit"},
        supersededEvidence={"file": "fund-pe-sso-new-results.json", "notUsed": True,
            "reason": "Its date arrays extracted performance-section dates instead of bounded Index as-of dates for some modern SPX pages; all SPX archive dates now come from the corrected Index-section extraction and original bytes are hash-verified."},
        sources=summaries, exactDateComparisons=pairs, editionConflicts=edition_conflicts,
        jiucaiAnomalies=anomaly_output, danjuanArchiveVsWeekly=archive_checks,
        danjuanPublicSampling=dj_sampling, selectedExactDateExamples=anchors,
        officialNasdaqCrosschecks=official_ndx,
        prosharesNdxOriginalSpotchecks=ndx_spotchecks,
        spglobalWorkbookVerification=dict(extractedCompleteRows=len(extracted_quarters),
            originalDateRows=len(quarter_rows), extractionMatchesOriginalWorkbook=True,
            incompleteOriginalRows=[r for r in quarter_rows if r["reported"] is None or r["operating"] is None]),
        differentDateDiagnostics={"leguVsMultplSameCalendarMonth": month_diagnostic},
        limitations=[
            "Literal same-date matches can still have different economic dates and earnings methods. No source is certified reliable solely by agreement or smoothness.",
            "Danjuan weekly has no paired index close. Daily snapshots have a timestamp but US market-close alignment is not established by a timestamp alone.",
            "Legu non-null PE observations are mainly monthly; its month-end labels strongly correspond to Multpl month-first labels. They are not independent daily confirmation.",
            "S&P Global is authoritative for this workbook's reported/operating EPS basis but is quarterly and subsequently revised; it cannot establish point-in-time daily PE.",
            "ProShares observations belong to the Index section and preserve issuer as-of dates; sparse coverage and unverified PE method prevent treating them as a complete daily TTM replacement.",
        ], inputFiles=inputs)
    return report, sources


def write_csv(path, sources):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["market", "source", "date", "pe", "close", "estimated", "ts", "knownBy", "file"])
        writer.writeheader()
        for key, rows in sorted(sources.items()):
            market, source = key.split(":", 1)
            for row in rows:
                writer.writerow({k: v for k, v in dict(market=market, source=source, **row).items() if k in writer.fieldnames})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old-raw", type=Path, default=OLD)
    parser.add_argument("--new-raw", type=Path, default=NEW)
    parser.add_argument("--evidence", type=Path, default=EVIDENCE)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/evidence/market-history/pe-date-comparison-20261114.json")
    parser.add_argument("--csv", type=Path, default=NEW / "pe-date-comparison-20261114.csv")
    args = parser.parse_args()
    report, sources = build(args.old_raw, args.new_raw, args.evidence)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    write_csv(args.csv, sources)
    print(json.dumps(dict(output=str(args.output), csv=str(args.csv),
                         sourceCounts={k: v["count"] for k, v in report["sources"].items()},
                         anomalyCounts={k: len(v) for k, v in report["jiucaiAnomalies"].items()}), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
