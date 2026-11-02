#!/usr/bin/env python3
"""Frozen daily drawdown-rank research. Scores and forward account outcomes are separate passes."""
import argparse
from bisect import bisect_left, bisect_right, insort
from calendar import monthrange
from collections import Counter
from datetime import date
from hashlib import sha256
import json
from math import isfinite, sqrt
from pathlib import Path
from statistics import fmean
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = (.3, .3)
CASH_WEIGHT = .4
FEE = .001
WINDOW = 252
MIN_PRIOR = 504
HORIZONS = (3, 6, 12)
BANDS = ("high", "normal", "low")
PROTOCOL_PATH = "docs/research/portfolio-buy-date-protocol-v1.json"
PROTOCOL_SHA = "2e47aeeed9a13ea45e417c365b2aa0ea17361b743a5eca5af220abaf1ea0aced"
FROZEN_COMMIT = "4106b061"
CALENDAR_SHA = "2e3851fc6cf968b09f2a1f33a76ff1eaa949e824537cdc9678a665333f65f952"


def common_cny_market(usd_series, tqqq_series, fx_series):
    """Trade on real closes of both products only; FX is the latest rate on or before the day."""
    def validated(series):
        days, prices = [], {}
        for day, price in series:
            if date.fromisoformat(day).isoformat() != day or (days and day <= days[-1]):
                raise ValueError("non-increasing/non-ISO source date")
            if not isinstance(price, (float, int)) or not isfinite(price) or price <= 0:
                raise ValueError("invalid source price")
            days.append(day)
            prices[day] = price
        return days, prices
    usd_days, usd = validated(usd_series)
    _, tqqq = validated(tqqq_series)
    fx_days, fx = validated(fx_series)
    market = []
    for day in usd_days:
        if day not in tqqq:
            continue
        i = bisect_right(fx_days, day) - 1
        if i < 0:
            continue
        fx_day = fx_days[i]
        if (date.fromisoformat(day) - date.fromisoformat(fx_day)).days > 7:
            continue
        market.append({"day": day, "fxDay": fx_day, "prices": [usd[day] * fx[fx_day], tqqq[day] * fx[fx_day]]})
    return market


def midrank_percentile(sorted_prior, value):
    if not sorted_prior:
        return None
    left, right = bisect_left(sorted_prior, value), bisect_right(sorted_prior, value)
    return 100 * (left + .5 * (right - left)) / len(sorted_prior)


def score_band(score):
    return None if score is None else "high" if score >= 80 else "low" if score <= 20 else "normal"


def score_market(market, window=WINDOW, min_prior=MIN_PRIOR):
    """Reference rebalances daily. The prior distribution is updated only after scoring the day."""
    if window <= 0 or min_prior <= 0:
        raise ValueError("positive window and prior-depth requirement expected")
    series, prior, signals = [], [], []
    for i, row in enumerate(market):
        if i == 0:
            value = 100.
        else:
            previous = market[i - 1]
            r0, r1 = tuple(row["prices"][j] / previous["prices"][j] - 1 for j in range(2))
            value = series[-1] * (1 + (WEIGHTS[0] * r0 + WEIGHTS[1] * r1))
        if not isfinite(value) or value <= 0:
            raise ValueError("nonpositive reference value")
        series.append(value)
        peak = max(series[i + 1 - window:i + 1]) if i + 1 >= window else None
        depth = 1 - value / peak if peak is not None else None
        score = midrank_percentile(prior, depth) if depth is not None and len(prior) >= min_prior else None
        signals.append({"signalIndex": i, "day": row["day"], "reference": value, "peak252": peak,
                        "depth": depth, "priorDepthN": len(prior), "score": score, "band": score_band(score)})
        if depth is not None:
            insort(prior, depth)
    return signals


def add_months(day, months):
    point = date.fromisoformat(day)
    year, zero_month = divmod(point.year * 12 + point.month - 1 + months, 12)
    month = zero_month + 1
    return date(year, month, min(point.day, monthrange(year, month)[1])).isoformat()


def account_outcome(market, entry, end, fee=FEE):
    """Buy actual units at entry; includes initial capital 1, buy fee and terminal sale mark."""
    if not 0 <= entry <= end < len(market) or not 0 <= fee < 1:
        raise ValueError("invalid account window/fee")
    unit0, unit1 = (WEIGHTS[j] / ((1 + fee) * market[entry]["prices"][j]) for j in range(2))
    peak, drawdown = 1., 0.
    for i in range(entry, end + 1):
        p0, p1 = market[i]["prices"]
        risk = unit0 * p0 + unit1 * p1
        # End-of-day path uses one mark per common close. On exit use the post-sale cash.
        wealth = CASH_WEIGHT + risk * (1 - fee if i == end else 1)
        peak = max(peak, wealth)
        drawdown = min(drawdown, wealth / peak - 1)
    return {"netReturnPp": 100 * (wealth - 1), "maxDrawdownPp": 100 * drawdown}


def build_outcomes(market, signals, partitions, horizons=HORIZONS):
    """Record one mutually exclusive result per signal and horizon, including insufficient history."""
    if len(market) != len(signals):
        raise ValueError("score/market calendars differ")
    def phase(day):
        return next((p["id"] for p in partitions if
                     (not p.get("start") or p["start"] <= day) and (not p.get("end") or day <= p["end"])), None)
    days = [r["day"] for r in market]
    phases = [phase(day) for day in days]
    outcomes, excluded = [], []
    for i, sig in enumerate(signals):
        if sig["signalIndex"] != i or sig["day"] != days[i]:
            raise ValueError("score/market date mismatch")
        for months in horizons:
            reason = None
            base = {"signalIndex": i, "day": days[i], "partition": phases[i], "months": months}
            entry = i + 1
            if phases[i] is None:
                reason = "outside_partition"
            elif sig["score"] is None:
                reason = "insufficient_score_history"
            elif entry == len(market):
                reason = "no_next_common_close"
            elif phases[entry] != phases[i]:
                reason = "entry_crosses_partition"
            else:
                target = add_months(days[entry], months)
                end = bisect_left(days, target)
                if end == len(days):
                    reason = "unmatured_endpoint"
                elif (date.fromisoformat(days[end]) - date.fromisoformat(target)).days > 14:
                    reason = "endpoint_more_than_14_days_late"
                elif phases[end] != phases[i]:
                    reason = "endpoint_crosses_partition"
                else:
                    outcomes.append({**base, "score": sig["score"], "band": sig["band"], "entryIndex": entry,
                                     "entryDay": days[entry], "anniversary": target, "endIndex": end,
                                     "endDay": days[end], **account_outcome(market, entry, end)})
            if reason:
                excluded.append({**base, "reason": reason})
    return outcomes, excluded


def quantile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    location = (len(ordered) - 1) * p
    lo = int(location)
    return ordered[lo] + (ordered[min(lo + 1, len(ordered) - 1)] - ordered[lo]) * (location - lo)


def ranks(values):
    ordered = sorted(values)
    return [.5 * (bisect_left(ordered, x) + bisect_right(ordered, x) + 1) for x in values]


def spearman(xs, ys):
    if len(xs) != len(ys):
        raise ValueError("vectors differ in length")
    if len(xs) < 2:
        return None
    x, y = ranks(xs), ranks(ys)
    mx, my = fmean(x), fmean(y)
    sx = sum((a - mx) ** 2 for a in x)
    sy = sum((b - my) ** 2 for b in y)
    if not sx or not sy:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / sqrt(sx * sy)


def summarize_band(rows):
    returns = [r["netReturnPp"] for r in rows]
    dd = [r["maxDrawdownPp"] for r in rows]
    return {"n": len(rows), "meanReturnPp": fmean(returns) if returns else None,
            "medianReturnPp": quantile(returns, .5), "p10ReturnPp": quantile(returns, .1),
            "medianMaxDrawdownPp": quantile(dd, .5), "worstMaxDrawdownPp": min(dd) if dd else None}


def difference(a, b):
    return a - b if a is not None and b is not None else None


def summarize_group(rows, partition, months):
    rows = sorted(rows, key=lambda r: r["signalIndex"])
    by_band = {band: [r for r in rows if r["band"] == band] for band in BANDS}
    bands = {band: summarize_band(items) for band, items in by_band.items()}
    high = by_band["high"]
    chosen = []
    for r in high:
        if not chosen or r["entryIndex"] > chosen[-1]["endIndex"]:
            chosen.append(r)
    firsts = []
    for i, r in enumerate(high):
        if i == 0 or r["signalIndex"] != high[i - 1]["signalIndex"] + 1:
            firsts.append(r)
    years = []
    for year in sorted({r["entryDay"][:4] for r in rows}):
        year_rows = [r for r in rows if r["entryDay"][:4] == year]
        year_bands = {b: summarize_band([r for r in year_rows if r["band"] == b]) for b in BANDS}
        years.append({"entryYear": year, "bands": year_bands,
                      "highMinusNormalMedianPp": difference(year_bands["high"]["medianReturnPp"], year_bands["normal"]["medianReturnPp"])})
    return {"partition": partition, "months": months, "n": len(rows), "bands": bands,
            "spearman": spearman([r["score"] for r in rows], [r["netReturnPp"] for r in rows]),
            "highMinusNormalMedianPp": difference(bands["high"]["medianReturnPp"], bands["normal"]["medianReturnPp"]),
            "highMinusLowMedianPp": difference(bands["high"]["medianReturnPp"], bands["low"]["medianReturnPp"]),
            "highNonoverlap": {"n": len(chosen), "windows": [{"day": r["day"], "entryDay": r["entryDay"], "endDay": r["endDay"]} for r in chosen]},
            "highClusters": len(firsts), "highRunFirst": [
                {k: r[k] for k in ("signalIndex", "day", "entryDay", "endDay", "score", "netReturnPp", "maxDrawdownPp")}
                for r in firsts], "highRunFirstSummary": summarize_band(firsts), "entryYears": years}


def digest(raw):
    return sha256(raw).hexdigest()


def compact_json(document):
    return json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def read_frozen_source(info, root=ROOT):
    """Scheduled refreshes may remove content-addressed source paths from the working tree."""
    name = info["path"]
    filepath = Path(root) / name
    if filepath.is_file():
        raw, origin, commit = filepath.read_bytes(), "working_tree_content_addressed_file", None
    else:
        # Read immutable bytes; never restore into production data or substitute a newer snapshot.
        raw = subprocess.run(["rtk", "proxy", "git", "show", FROZEN_COMMIT + ":" + name],
                             cwd=root, check=True, capture_output=True).stdout
        origin, commit = "git_show_frozen_protocol_commit", FROZEN_COMMIT
    actual = digest(raw)
    if actual != info["sha256"]:
        raise ValueError(f"{name}: checksum mismatch ({actual})")
    history = json.loads(raw)
    if not history.get("series"):
        raise ValueError(f"{name}: no observations")
    if info["id"] != "fx":
        if (history.get("id"), history.get("currency"), history.get("basis"), history.get("dividends")) != (
                info["id"], "USD", "provider_adjusted_close", "reinvested"):
            raise ValueError(f"{name}: wrong product/price basis")
    return history["series"], {**info, "origin": origin, "commit": commit, "sourceId": history.get("id"),
                               "basis": history.get("basis"), "currency": history.get("currency"),
                               "first": history["series"][0][0], "end": history["series"][-1][0], "n": len(history["series"])}


def load_inputs():
    protocol_raw = (ROOT / PROTOCOL_PATH).read_bytes()
    if digest(protocol_raw) != PROTOCOL_SHA:
        raise ValueError("protocol hash does not match the frozen protocol")
    p = json.loads(protocol_raw)
    if p["status"] != "frozen_before_new_candidate_outcomes" or tuple(p["labels"]["horizonsCalendarMonths"]) != HORIZONS:
        raise ValueError("unexpected protocol status or horizon")
    sources = p["market"]["sources"]
    if [r["id"] for r in sources] != ["us:USD", "us:TQQQ", "fx"] or tuple(r["weight"] for r in sources[:2]) != WEIGHTS:
        raise ValueError("unexpected fixed portfolio")
    loaded = [read_frozen_source(info) for info in sources]
    market = common_cny_market(*(series for series, _ in loaded))
    days = [r["day"] for r in market]
    calendar_sha = digest(compact_json(days))
    if len(days) != 4206 or days[0] != "2010-02-11" or days[-1] != p["market"]["asOf"] or calendar_sha != CALENDAR_SHA:
        raise ValueError("common calendar differs from the registered one")
    partitions = []
    for name, span in p["labels"]["partitions"].items():
        start, end = span.split("..")
        partitions.append({"id": name, "start": days[0] if start == "first" else start,
                           "end": days[-1] if end == "snapshot_end" else end})
    inputs = {"protocol": {"id": p["id"], "path": PROTOCOL_PATH, "sha256": PROTOCOL_SHA, "frozenCommit": FROZEN_COMMIT},
              "engine": {"path": str(Path(__file__).resolve().relative_to(ROOT)), "sha256": digest(Path(__file__).read_bytes())},
              "histories": [meta for _, meta in loaded], "calendarSha256": calendar_sha, "first": days[0],
              "asOf": days[-1], "commonObservations": len(days), "partitions": partitions}
    return market, inputs


def run_research(market, inputs):
    signals = score_market(market)
    partitions = inputs["partitions"]
    outcomes, excluded = build_outcomes(market, signals, partitions)
    if len(outcomes) + len(excluded) != len(market) * len(HORIZONS):
        raise ValueError("candidate rows do not cover the entire calendar")
    groups, exclusions = [], []
    for p in partitions:
        for months in HORIZONS:
            def matches(row):
                return row["partition"] == p["id"] and row["months"] == months
            groups.append(summarize_group([r for r in outcomes if matches(r)], p["id"], months))
            exclusions.append({"partition": p["id"], "months": months,
                               "counts": dict(sorted(Counter(r["reason"] for r in excluded if matches(r)).items()))})
    ledger = {"inputs": inputs, "signals": signals, "outcomes": outcomes, "excluded": excluded}
    summary = {"protocolId": inputs["protocol"]["id"], "inputs": inputs, "asOf": market[-1]["day"],
               "currentObservation": signals[-1], "observationBasis": "Frozen historical snapshot. Score measures prior depth percentile, not success probability.",
               "returnUnit": "percentage_points_of_initial_unit_after_buy_and_sell_fees_before_personal_tax",
               "firstEligibleSignal": next((r["day"] for r in signals if r["score"] is not None), None),
               "eligibleScores": sum(r["score"] is not None for r in signals), "outcomeCount": len(outcomes),
               "exclusionCount": len(excluded), "groups": groups, "exclusions": exclusions}
    return summary, ledger


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=ROOT / "docs/evidence/portfolio-buy-date-drawdown-v1.json")
    parser.add_argument("--ledger", type=Path, default=Path("/tmp/portfolio-buy-date-drawdown-v1-ledger.json"))
    args = parser.parse_args()
    market, inputs = load_inputs()
    summary, ledger = run_research(market, inputs)
    ledger_bytes = compact_json(ledger) + b"\n"
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    args.ledger.write_bytes(ledger_bytes)
    summary["ledgerPath"] = str(args.ledger)
    summary["ledgerSha256"] = digest(ledger_bytes)
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(json.dumps(summary, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    print(json.dumps({"summary": str(args.summary), "ledger": str(args.ledger), "ledgerSha256": summary["ledgerSha256"],
                      "groups": len(summary["groups"]), "outcomes": len(ledger["outcomes"]),
                      "exclusions": len(ledger["excluded"]), "eligibleScores": summary["eligibleScores"]}))


if __name__ == "__main__":
    main()
