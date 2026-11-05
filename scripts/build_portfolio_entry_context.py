#!/usr/bin/env python3
"""Keep same-date Cboe VIX/VIX3M closes for reproducible portfolio entry context.

The saved artifact is the default cache; only --refresh accesses the network.
Failed refreshes leave the last valid artifact, including its dates, untouched.
These are modern historical exports, not proof of original daily publication.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
from datetime import date, datetime, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from data_status import atomic_text

DEFAULT_OUTPUT = ROOT / "data/portfolio/entry-context.json"
URLS = {symbol: f"https://cdn.cboe.com/api/global/us_indices/daily_prices/{symbol}_History.csv"
        for symbol in ("VIX", "VIX3M")}
MAX_BYTES = 8 * 1024 * 1024


def iso_day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("expected an ISO calendar date")
    return date.fromisoformat(value)


def positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def retrieval_time(value):
    """Keep a day-only historical receipt honest instead of inventing an hour."""
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return iso_day(value), "day"
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise ValueError("retrievedAt must be an actual UTC timestamp or a documented ISO day")
    parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    return parsed.date(), "second"


def official_url(value, symbol):
    if not isinstance(value, str):
        raise ValueError("missing official CSV URL")
    u = urlsplit(value)
    if (u.scheme != "https" or u.hostname not in ("cdn.cboe.com", "cdn-api.cboe.com")
            or u.port not in (None, 443) or u.username or u.password or u.query or u.fragment
            or u.path != f"/api/global/us_indices/daily_prices/{symbol}_History.csv"):
        raise ValueError(f"unexpected {symbol} source URL")


def parse_csv(body, symbol):
    if not isinstance(body, bytes) or not body or len(body) > MAX_BYTES:
        raise ValueError(f"{symbol}: empty or oversized CSV")
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)) or not {"DATE", "CLOSE"}.issubset(headers):
        raise ValueError(f"{symbol}: missing or duplicate DATE/CLOSE columns")
    values, previous = {}, ""
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"{symbol}: malformed CSV row")
        text = row["DATE"].strip()
        if not re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", text):
            raise ValueError(f"{symbol}: invalid observation date")
        day = datetime.strptime(text, "%m/%d/%Y").date().isoformat()
        value = float(row["CLOSE"])
        if day <= previous or not positive(value):
            raise ValueError(f"{symbol}: dates must increase uniquely and closes must be finite positive numbers")
        values[day] = value
        previous = day
    if len(values) < 2:
        raise ValueError(f"{symbol}: fewer than two valid observations")
    return values


def snapshot(symbol, body, retrieved_at, actual_url=None, last_modified=None):
    observed, precision = retrieval_time(retrieved_at)
    if actual_url is not None:
        official_url(actual_url, symbol)
    values = parse_csv(body, symbol)
    first, last = min(values), max(values)
    if iso_day(last) > observed:
        raise ValueError(f"{symbol}: observation is after the retrieval date")
    meta = {"url": URLS[symbol], "retrievedAt": retrieved_at,
            "retrievedAtPrecision": precision, "sha256": hashlib.sha256(body).hexdigest(),
            "bytes": len(body), "observations": len(values), "first": first, "asOf": last}
    if actual_url is not None:
        meta["actualUrl"] = actual_url
    if last_modified:
        meta["lastModified"] = last_modified
    return values, meta


def fetch(symbol):
    request = Request(URLS[symbol], headers={"User-Agent": "Changheng research data collector/1.0",
                                             "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.1"})
    with urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
        retrieved = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        return snapshot(symbol, body, retrieved, response.geturl(), response.headers.get("Last-Modified"))


def validate_document(doc):
    if not isinstance(doc, dict) or type(doc.get("schemaVersion")) is not int or doc["schemaVersion"] != 1:
        raise ValueError("unsupported entry-context schema")
    if doc.get("status") != "available" or not isinstance(doc.get("sources"), dict) or set(doc["sources"]) != set(URLS):
        raise ValueError("expected available paired VIX/VIX3M sources")
    rows = doc.get("series")
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("paired history requires at least two observations")
    previous = ""
    for row in rows:
        if not isinstance(row, list) or len(row) != 3:
            raise ValueError("expected [date,VIX close,VIX3M close]")
        iso_day(row[0])
        if row[0] <= previous or not all(positive(v) for v in row[1:]):
            raise ValueError("paired dates must be unique, increasing; closes finite and positive")
        previous = row[0]
    if doc.get("first") != rows[0][0] or doc.get("asOf") != rows[-1][0]:
        raise ValueError("paired history dates disagree with metadata")
    for symbol, source in doc["sources"].items():
        if not isinstance(source, dict) or source.get("url") != URLS[symbol]:
            raise ValueError(f"{symbol}: wrong canonical source")
        if "actualUrl" in source:
            official_url(source["actualUrl"], symbol)
        observed, precision = retrieval_time(source.get("retrievedAt"))
        if source.get("retrievedAtPrecision") != precision:
            raise ValueError(f"{symbol}: retrieval timestamp precision disagrees")
        if not isinstance(source.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
            raise ValueError(f"{symbol}: invalid source SHA-256")
        if (type(source.get("observations")) is not int or source["observations"] < len(rows)
                or type(source.get("bytes")) is not int or not 0 < source["bytes"] <= MAX_BYTES):
            raise ValueError(f"{symbol}: invalid source size/count")
        if not iso_day(source["first"]) <= iso_day(doc["first"]) <= iso_day(doc["asOf"]) <= iso_day(source["asOf"]) <= observed:
            raise ValueError(f"{symbol}: source date range does not contain the paired observations")
    return doc


def pair_snapshots(snapshots):
    if set(snapshots) != set(URLS):
        raise ValueError("both independent Cboe closes are required")
    a, b = (snapshots[symbol][0] for symbol in URLS)
    dates = sorted(a.keys() & b.keys())
    if len(dates) < 2:
        raise ValueError("fewer than two same-date pairs; dates cannot be carried or substituted")
    return validate_document({"schemaVersion": 1, "status": "available", "first": dates[0], "asOf": dates[-1],
                              "sources": {symbol: snapshots[symbol][1] for symbol in URLS},
                              "series": [[day, a[day], b[day]] for day in dates]})


def compare_cached(previous, candidate):
    """Never silently truncate or rewrite a successfully saved historical edition."""
    new = {row[0]: row[1:] for row in candidate["series"]}
    for day, *values in previous["series"]:
        if day not in new:
            raise ValueError(f"refresh omitted saved paired date {day}; previous edition retained")
        if new[day] != values:
            raise ValueError(f"refresh revised saved closes on {day}; review the source revision before replacing history")
    return {"previousAsOf": previous["asOf"], "unchangedPairedRows": len(previous["series"]),
            "spotChecks": [previous["series"][i] for i in sorted({0, len(previous["series"]) // 2, len(previous["series"]) - 1})]}


def build(output=DEFAULT_OUTPUT, refresh=False, local_snapshots=None):
    output = Path(output)
    previous = validate_document(json.loads(output.read_bytes())) if output.exists() else None
    if not refresh and local_snapshots is None:
        if previous is None:
            raise ValueError("no saved context; use --refresh or import two timestamped local CSVs")
        return previous
    if refresh and local_snapshots is not None:
        raise ValueError("choose an explicit network refresh or a cached-file import")
    # No write occurs until BOTH downloads, parsing, pairing and validation finish.
    snapshots = {symbol: fetch(symbol) for symbol in URLS} if refresh else local_snapshots
    candidate = pair_snapshots(snapshots)
    # Re-read immediately before replacement; do not discard a completed intervening update.
    if output.exists():
        previous = validate_document(json.loads(output.read_bytes()))
        candidate["overlapVerification"] = compare_cached(previous, candidate)
    atomic_text(output, json.dumps(candidate, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh", action="store_true", help="explicitly download both current official CSVs")
    mode.add_argument("--check", action="store_true", help="validate saved paired data without networking")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--vix-file", type=Path, help="already downloaded official VIX CSV")
    parser.add_argument("--vix3m-file", type=Path, help="already downloaded official VIX3M CSV")
    parser.add_argument("--retrieved-at", help="documented retrieval timestamp, or ISO day if only the day is known")
    args = parser.parse_args()
    local = None
    if any((args.vix_file, args.vix3m_file, args.retrieved_at)):
        if not all((args.vix_file, args.vix3m_file, args.retrieved_at)) or args.refresh or args.check:
            parser.error("cached import needs both CSV paths and --retrieved-at, without --refresh/--check")
    try:
        if args.vix_file:
            local = {symbol: snapshot(symbol, file.read_bytes(), args.retrieved_at)
                     for symbol, file in (("VIX", args.vix_file), ("VIX3M", args.vix3m_file))}
        doc = build(args.output, refresh=args.refresh, local_snapshots=local)
    except (OSError, HTTPException, UnicodeError, csv.Error, ValueError, TypeError, KeyError) as exc:
        parser.exit(1, f"Entry context unchanged: {exc}\n")
    print(json.dumps({"status": doc["status"], "asOf": doc["asOf"], "pairedObservations": len(doc["series"]),
                      "mode": "refresh" if args.refresh else "import" if local else "cached"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
