#!/usr/bin/env python3
"""Collect issuer-reported benchmark P/E; knownBy is evidence time, not publication time.

--archive accepts already verified Wayback evidence in the observations format below.
It validates provenance, not the upstream operator's extraction from historical PDFs.
Every distinct archive capture is kept; unchanged daily live reads are not snapshots.
An anomalous printed P/E flagged by qualityNote is retained for source reconciliation
only, without changing the number or inferring that the issuer corrected it.
For new live reads only, compare the printed P/E, P/B and dividend yield (%) to
the latest earlier as-of then known. Require the same displayed decimals on all
three; a rounded PDF, missing field or missing precision is not a match.
"""
import argparse
import hashlib
import html
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from http.client import HTTPException
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text, file_transaction

NAMES = {"USD": "Dow Jones U.S. Semiconductors Index", "TQQQ": "Nasdaq-100 Index"}
BASE = "https://www.proshares.com/our-etfs/leveraged-and-inverse/"
DEFAULT_OUTPUT = ROOT / "data/portfolio/benchmark-valuations.json"
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
METRICS = ("indexPE", "indexPB", "dividendYieldPct")


def one(items, label):
    if len(items) != 1:
        raise ValueError(f"expected one {label}, found {len(items)}")
    return items[0]


def visible(markup):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", markup)).split())


def parse_page(symbol, body, known_by):
    """Extract the named Index section only. Do not infer earnings method or frequency."""
    markup = body.decode("utf-8-sig")
    markup = re.sub(r"<!--.*?-->|<(script|style)\b[^>]*>.*?</\1\s*>", "", markup, flags=re.I | re.S)
    section = one(re.findall(r'''<section\b[^>]*?\sid\s*=\s*['"]Index['"][^>]*>(.*?)</section\s*>''',
                             markup, re.I | re.S), "Index section")
    if [visible(v) for v in re.findall(r"<h2\b[^>]*>(.*?)</h2>", section, re.I | re.S)] != ["Index"]:
        raise ValueError("wrong Index heading")
    about = one(re.findall(r"<h6\b[^>]*>\s*About the Index\s*</h6>\s*<p\b[^>]*>(.*?)</p>",
                           section, re.I | re.S), "About the Index paragraph")
    if not re.match(r"^(?:The )?" + re.escape(NAMES[symbol]) + r"\s+is\b", visible(about), re.I):
        raise ValueError(f"About the Index does not identify {NAMES[symbol]}")
    date_text = one(re.findall(r'''<p\b[^>]*?\sid\s*=\s*['"]index-asOfDate['"][^>]*>(.*?)</p>''',
                               section, re.I | re.S), "index as-of date")
    match = re.fullmatch(r"as of (\d{1,2}/\d{1,2}/\d{4})", visible(date_text), re.I)
    if not match:
        raise ValueError("missing or invalid index as-of date")
    as_of = datetime.strptime(match[1], "%m/%d/%Y").date().isoformat()
    rows = [visible(li) for li in re.findall(r"<li\b[^>]*>(.*?)</li>", section, re.I | re.S)]
    values, decimals = {}, {}
    for key, label in zip(METRICS, (r"Price/Earnings Ratio", r"Price/Book Ratio", r"Dividend Yield(?:\s*\(\s*%\s*\))?")):
        hits = [v for v in rows if re.match(label + r"(?:\s|$)", v)]
        if not hits and key != "indexPE":
            continue
        value = one(hits, f"index {key} row")
        numeric = re.sub(r"^" + label, "", value, count=1).strip()
        if key != "indexPE" and numeric.upper() in ("", "-", "--", "—", "N/A"):
            continue
        if key == "dividendYieldPct":
            if "%" not in value:  # An unqualified yield number has no verified unit.
                continue
            numeric = numeric.removesuffix("%").strip()
        if not re.fullmatch(r"[+-]?(?:\d+\.?\d*|\.\d+)", numeric):
            raise ValueError(f"missing or invalid numeric index {key}")
        values[key] = float(numeric)
        decimals[key] = len(numeric.partition(".")[2])
    return checked({"symbol": symbol, "indexName": NAMES[symbol], "asOf": as_of, "knownBy": known_by,
                    **values, "displayDecimals": decimals, "sourceUrl": BASE + symbol.lower(),
                    "sourceSha256": hashlib.sha256(body).hexdigest(), "evidenceType": "issuer_live"})


def official_path(url, symbol):
    parsed = urlsplit(url)
    if (parsed.scheme not in ("http", "https") or parsed.hostname not in ("proshares.com", "www.proshares.com")
            or parsed.username or parsed.password or parsed.port not in (None, 80 if parsed.scheme == "http" else 443)
            or parsed.query or parsed.fragment):
        raise ValueError("expected an official ProShares source URL")
    s = symbol.lower()
    path = parsed.path.rstrip("/").lower()
    if path not in {f"/our-etfs/leveraged-and-inverse/{s}", f"/funds/{s}_index.html",
                    f"/media/fact_sheet/prosharesfactsheet{s}.pdf", f"/globalassets/proshares/fact-sheet/prosharesfactsheet{s}.pdf"}:
        raise ValueError(f"source URL does not identify {symbol}")
    return parsed.scheme, parsed.hostname, parsed.path.rstrip("/")


def checked(row, archive_only=False):
    symbol = row["symbol"]
    if symbol not in NAMES or row["indexName"] != NAMES[symbol]:
        raise ValueError("unexpected product/benchmark combination")
    as_of = date.fromisoformat(row["asOf"])
    known = datetime.strptime(row["knownBy"], UTC_FORMAT)
    if as_of.isoformat() != row["asOf"] or known.strftime(UTC_FORMAT) != row["knownBy"] or known.date() < as_of:
        raise ValueError("invalid asOf or UTC knownBy")
    for key in METRICS:
        value = row.get(key)
        if (key == "indexPE" or value is not None) and (type(value) not in (float, int) or not math.isfinite(value)):
            raise ValueError(f"{key} must be a finite number")
    decimals = row.get("displayDecimals", {})
    if not isinstance(decimals, dict) or any(key not in METRICS or row.get(key) is None or type(n) is not int
                                             or n < 0 or -Decimal(str(row[key])).normalize().as_tuple().exponent > n
                                             for key, n in decimals.items()):
        raise ValueError("displayDecimals must identify actual numeric fields and their printed precision")
    for note in ("qualityNote", "sourceNote"):
        if row.get(note) is not None and not isinstance(row[note], str):
            raise ValueError(f"{note} must be text")
    if not re.fullmatch(r"[0-9a-f]{64}", row["sourceSha256"]):
        raise ValueError("invalid source SHA-256")
    source = official_path(row["sourceUrl"], symbol)
    if row["evidenceType"] == "verified_archive":
        replay = re.fullmatch(r"https://web\.archive\.org/web/(\d{14})(?:id_)?/(https?://.+)", row["archiveUrl"])
        if not replay or replay[1] != known.strftime("%Y%m%d%H%M%S") or official_path(replay[2], symbol) != source:
            raise ValueError("archive capture time or source does not match")
        if not re.fullmatch(r"[A-Z2-7]{32}", row["archiveDigestSha1Base32"]):
            raise ValueError("missing or invalid verified CDX body digest")
    elif archive_only or row["evidenceType"] != "issuer_live" or row["sourceUrl"] != BASE + symbol.lower():
        raise ValueError("invalid evidence type or live source URL")
    return row


def metric_state(row):
    decimals = row.get("displayDecimals", {})
    return tuple((row.get(key), decimals.get(key)) for key in METRICS)


def annotate_live(row, evidence):
    # A previous edition's diagnostic is not a fact printed on this live page.
    row = {k: v for k, v in row.items() if k != "qualityNote"}
    previous = [r for r in evidence if r["symbol"] == row["symbol"] and r["asOf"] < row["asOf"]
                and r["knownBy"] < row["knownBy"]]
    state = metric_state(row)
    if not previous or any(value is None or precision is None for value, precision in state):
        return row
    latest = max((r["asOf"], r["knownBy"]) for r in previous)
    if all(metric_state(r) == state for r in previous if (r["asOf"], r["knownBy"]) == latest):
        return {**row, "qualityNote": f"疑似沿用：与 {latest[0]} 的最近已知资料相比，指数 P/E、P/B 和股息率在相同公布精度下均未变化。保留原值，未证实发行人出错。"}
    return row


def enrich_capture(stored, row):
    """Fill previously absent facts from the same verified source bytes; never replace conflicting ones."""
    for key in ("symbol", "asOf", "sourceSha256", "archiveDigestSha1Base32", *METRICS, "qualityNote", "sourceNote"):
        if stored.get(key) is not None and row.get(key) is not None and stored[key] != row[key]:
            raise ValueError(f"conflicting {key} for capture {row['archiveUrl']}")
    merged = {**stored, **{key: row[key] for key in (*METRICS, "qualityNote", "sourceNote") if stored.get(key) is None and row.get(key) is not None}}
    decimals = {**stored.get("displayDecimals", {})}
    for key, n in row.get("displayDecimals", {}).items():
        if key in decimals and decimals[key] != n:
            raise ValueError(f"conflicting {key} precision for capture {row['archiveUrl']}")
        decimals[key] = n
    if decimals:
        merged["displayDecimals"] = decimals
    return merged


def merge_observations(existing, incoming):
    """Archive captures are independent evidence; live logs keep only changes.

    Once live collection starts for an asOf, reject new captures at or after its
    first live read: we deliberately cannot reconstruct later unchanged live reads.
    Older captures can always be backfilled, and exact reimports are idempotent.
    """
    old = [checked(r) for r in existing]
    new = [checked(r) for r in incoming]
    first_live = {}
    for r in old:
        if r["evidenceType"] == "issuer_live":
            key = r["symbol"], r["asOf"]
            first_live[key] = min(first_live.get(key, r["knownBy"]), r["knownBy"])
    observations, archive, live, at_time = [], {}, {}, {}
    for is_new, rows in ((False, old), (True, new)):
        for r in rows:
            series = r["symbol"], r["asOf"]
            key = (*series, r["knownBy"])
            facts = at_time.setdefault(key, {})
            for metric in METRICS:
                if r.get(metric) is not None:
                    if metric in facts and facts[metric] != r[metric]:
                        raise ValueError(f"conflicting {r['symbol']} {metric} at {r['knownBy']} for {r['asOf']}")
                    facts[metric] = r[metric]
            if r["evidenceType"] == "issuer_live":
                live.setdefault(series, []).append((is_new, r))
                continue
            identity = r["knownBy"], official_path(r["sourceUrl"], r["symbol"])
            if identity in archive:
                archive[identity] = enrich_capture(archive[identity], r)
                continue
            if is_new and series in first_live and r["knownBy"] >= first_live[series]:
                raise ValueError(f"cannot backfill capture in live collection period: {r['archiveUrl']}")
            archive[identity] = r
    observations.extend(archive.values())
    evidence = [*archive.values(), *(r for rows in live.values() for _, r in rows)]
    for rows in live.values():
        last = None
        for is_new, r in sorted(rows, key=lambda item: item[1]["knownBy"]):
            state = metric_state(r)
            if state != last:
                observations.append(annotate_live(r, evidence) if is_new else r)
            last = state
    return sorted(observations, key=lambda r: (r["symbol"], r["asOf"], r["knownBy"], r["evidenceType"], r["sourceUrl"]))


def fetch(symbol):
    url = BASE + symbol.lower()
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 (benchmark valuation data collector)"}), timeout=30) as response:
        if response.geturl().rstrip("/") != url or response.headers.get_content_type() != "text/html":
            raise ValueError("unexpected response URL or MIME type")
        limit = 4 * 1024 * 1024
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError("response too large")
    return parse_page(symbol, body, datetime.now(timezone.utc).strftime(UTC_FORMAT))


def collect(output, archive=None, archive_only=False, dry_run=False):
    new = []
    if archive is not None:
        payload = json.loads(archive.read_bytes())
        rows = payload.get("observations") if isinstance(payload, dict) else payload
        if not isinstance(rows, list) or not rows:
            raise ValueError("archive must contain a nonempty observations array")
        new.extend(checked(row, archive_only=True) for row in rows)
    if archive_only and archive is None:
        raise ValueError("--archive-only requires --archive")
    if not archive_only:
        for symbol in NAMES:
            try:
                new.append(fetch(symbol))
            except (OSError, HTTPException, ValueError) as e:
                raise ValueError(f"{symbol}: {e}") from e
    # Another successful collector may have added evidence while this one was fetching.
    with file_transaction(output):
        existing = json.loads(output.read_bytes()) if output.exists() else {"schemaVersion": 1, "observations": []}
        if existing.get("schemaVersion") != 1 or not isinstance(existing.get("observations"), list):
            raise ValueError("unsupported existing valuation file; leaving it intact")
        result = {**existing, "observations": merge_observations(existing["observations"], new)}
        if result != existing and not dry_run:
            atomic_text(output, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--archive", type=Path, help="previously byte-verified archive observations (JSON)")
    parser.add_argument("--archive-only", action="store_true", help="only import archive rows; do not fetch live pages")
    parser.add_argument("--dry-run", action="store_true", help="validate and print merged records without writing")
    args = parser.parse_args()
    try:
        result = collect(args.output, args.archive, args.archive_only, args.dry_run)
    except (OSError, TypeError, KeyError, AttributeError, ValueError) as exc:
        parser.exit(1, f"Benchmark valuations unchanged: {exc}\n")
    if args.dry_run:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Benchmark valuations: {len(result['observations'])} observations; {args.output}")


if __name__ == "__main__":
    main()
