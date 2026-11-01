#!/usr/bin/env python3
"""Audit archived SSI inputs without creating SSI or reading investment outcomes.

Methods are fixed here before the first real-data execution:
1. Hash-check the six official NAV CSVs and official split CSV against the saved
   retrieval manifest. Use Decimal arithmetic and preserve source text.
2. For each of the 25 six-fund split events, compare the current row's Prior NAV
   with the previous row's NAV, and with previous NAV / split share factor.
   Show both exact residuals and overlap under the explicitly hypothetical
   rounding interval of half the last printed decimal place. A forward r:1
   split has share factor r; a reverse 1:r split has share factor 1/r.
   Inspect links around the stated date, not just a presumed intraday effective
   instant: the split CSV does not state that instant. Preserve before/event/
   after rows. Continuity is a basis fingerprint, not an official adjustment
   statement or an independent original-vintage observation.
3. Examine reported shares against AUM / NAV / 1000. The latter is an accounting
   diagnostic, not a certified replacement. Reported-share rounding bounds
   assume a fixed 0.01-thousand-share quantum; those bounds are a sensitivity
   assumption, not a provider promise. Independently allow rounding of NAV/AUM
   to their last printed places and report all interval inconsistencies.
4. Take the last actually shared observation in every YYYY-MM of the six CSVs.
   Compare successive month-end growth of printed shares and accounting-implied
   shares, and the bounds induced by the share-rounding assumption. This is
   input arithmetic only: no sum into SSI, target, prediction, or asset return.
5. Exact common rescaling cancels from S1/S0 - 1. Rounding after rescaling need
   not cancel. A historical split crossing the two dates needs one adjustment
   only if the source is unadjusted; applying it twice creates a false change.

Run --self-test for synthetic cases only. Default execution writes the new
audit evidence. No existing research or production data is changed.
"""

import argparse
import csv
import hashlib
import io
import json
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ("SSO", "SDS", "QLD", "QID", "DDM", "DXD")
SHARE_QUANTUM = Decimal("0.01")  # thousands of shares; assumed reporting quantum
ZERO = Decimal(0)
ONE = Decimal(1)

METHOD = {
    "version": "ssi-input-accounting-audit-v1",
    "scope": "Archived input arithmetic only; no SSI or investment outcomes.",
    "arithmetic": "Python Decimal, precision 40; JSON numbers are presentation only.",
    "splitFactor": "Forward ratio r => shares factor r; Reverse ratio r => 1/r.",
    "navBasisFingerprint": {
        "adjusted": "event.PriorNAV versus previous.NAV",
        "unadjusted": "event.PriorNAV versus previous.NAV / shareFactor",
        "roundingAssumption": "Half the last printed place, inclusive intervals.",
        "clock": "Examine links ending before, on, and after stated split date; no exact effective intraday time is assumed.",
        "epistemicLimit": "Compatibility is inferred, not an official adjustment definition or original-vintage proof.",
    },
    "shareAccounting": {
        "impliedSharesThousands": "AUM / NAV / 1000",
        "relativeIdentityDifference": "NAV * reportedSharesThousands * 1000 / AUM - 1",
        "reportedShareQuantumThousands": "0.01",
        "roundingSensitivityAssumption": "Nearest 0.01 thousand shares, half-unit inclusive; not a provider guarantee.",
        "fullIntervalCheck": "Intersect reported-share interval with AUM/NAV interval allowing half of each field's last printed place.",
        "notApprovedReplacement": True,
    },
    "monthly": {
        "calendar": "Last date actually present in all six source histories in each YYYY-MM; no external exchange-calendar completeness claim.",
        "continuity": "Require consecutive calendar months; never label a multi-month gap as one month's growth.",
        "growth": "S_current / S_previous - 1",
        "comparison": "Reported-share growth minus AUM/NAV-implied-share growth, in percentage points.",
        "bounds": "[(S1-q/2)/(S0+q/2)-1, (S1+q/2)/(S0-q/2)-1], q=0.01 thousand shares.",
        "latestMonth": "Include final observed month, preserving its actual source date and without assuming unpublished later rows.",
    },
    "rescaling": {
        "identity": "(c*S1)/(c*S0)-1 = S1/S0-1 for any common c > 0 in exact arithmetic.",
        "futureSplit": "A later split's common back-adjustment alone does not change an earlier percentage growth. Rounding can.",
        "crossEvent": "An unadjusted split crossing the endpoints requires one factor; already-adjusted endpoints must not be adjusted again.",
        "revision": "Common rescaling, quantization, and substantive historical revisions are distinct; this snapshot does not identify all historical causes.",
    },
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def dec(value):
    result = Decimal(str(value))
    require(result.is_finite(), "Non-finite source number")
    return result


def day(value):
    return datetime.strptime(value, "%m/%d/%Y").date().isoformat()


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def printed_interval(value):
    number = dec(value)
    half = Decimal(1).scaleb(number.as_tuple().exponent) / 2
    return number - half, number + half


def overlap(a, b):
    return max(a[0], b[0]) <= min(a[1], b[1])


def share_interval(value):
    number = dec(value)
    return number - SHARE_QUANTUM / 2, number + SHARE_QUANTUM / 2


def share_factor(event):
    ratio = dec(event["Ratio"])
    require(ratio > 1, "Split ratio must exceed one")
    kind = event["Split Type"]
    require(kind in ("Forward", "Reverse"), "Unknown split direction")
    return ratio if kind == "Forward" else ONE / ratio


def growth(start, end):
    require(start > 0 and end > 0, "Share growth requires positive observations")
    return end / start - 1


def growth_bounds(start, end):
    lo0, hi0 = share_interval(start)
    lo1, hi1 = share_interval(end)
    require(lo0 > 0 and lo1 > 0, "Rounding interval reaches non-positive shares")
    return lo1 / hi0 - 1, hi1 / lo0 - 1


def implied_shares(row):
    return dec(row["Assets Under Management"]) / dec(row["NAV"]) / 1000


def accounting(row):
    nav = dec(row["NAV"])
    shares = dec(row["Shares Outstanding (000)"])
    aum = dec(row["Assets Under Management"])
    require(nav > 0 and shares > 0 and aum > 0, "Non-positive accounting input")
    implied = aum / nav / 1000
    slo, shi = share_interval(shares)
    nlo, nhi = printed_interval(row["NAV"])
    alo, ahi = printed_interval(row["Assets Under Management"])
    require(nlo > 0 and alo > 0, "Printed accounting interval reaches zero")
    ilo, ihi = alo / nhi / 1000, ahi / nlo / 1000
    return {
        "day": day(row["Date"]),
        "reportedSharesThousands": shares,
        "impliedSharesThousands": implied,
        "reportedMinusImpliedThousands": shares - implied,
        "relativeNavSharesAumDifference": nav * shares * 1000 / aum - 1,
        "impliedInsideReportedShareRoundingInterval": slo <= implied <= shi,
        "reportedShareIntervalThousands": [slo, shi],
        "impliedIntervalWithNavAumRoundingThousands": [ilo, ihi],
        "fullRoundingIntervalsOverlap": overlap((slo, shi), (ilo, ihi)),
    }


def nav_link(previous, current, factor):
    old = dec(previous["NAV"])
    prior = dec(current["Prior NAV"])
    a = printed_interval(previous["NAV"])
    b = printed_interval(current["Prior NAV"])
    adjusted = overlap(a, b)
    unadjusted = overlap((a[0] / factor, a[1] / factor), b)
    classification = (
        "compatible_with_continuous_adjusted_nav_basis" if adjusted and not unadjusted
        else "compatible_with_unadjusted_split_boundary" if unadjusted and not adjusted
        else "ambiguous_under_printed_precision" if adjusted and unadjusted
        else "neither_basis_matches_prior_nav_link"
    )
    return {
        "previousDay": day(previous["Date"]),
        "currentDay": day(current["Date"]),
        "previousNavText": previous["NAV"],
        "currentPriorNavText": current["Prior NAV"],
        "adjustedBasisAbsoluteResidual": abs(prior - old),
        "unadjustedBasisAbsoluteResidual": abs(prior - old / factor),
        "adjustedBasisSignedResidual": prior - old,
        "unadjustedBasisSignedResidual": prior - old / factor,
        "adjustedIntervalsOverlap": adjusted,
        "unadjustedIntervalsOverlap": unadjusted,
        "classification": classification,
    }


def source_record(row):
    fields = ("Date", "Ticker", "NAV", "Prior NAV", "NAV Change (%)", "NAV Change ($)",
              "Shares Outstanding (000)", "Assets Under Management")
    return {"day": day(row["Date"]), "rawFields": {k: row[k] for k in fields},
            "accounting": accounting(row)}


def event_audit(event, rows):
    event_day = day(event["Date of Split"])
    index = next((i for i, row in enumerate(rows) if day(row["Date"]) == event_day), None)
    require(index is not None and 2 <= index < len(rows) - 1, "Missing split neighborhood: " + event_day)
    factor = share_factor(event)
    links = [nav_link(rows[i - 1], rows[i], factor) for i in (index - 1, index, index + 1)]
    before, at, after = rows[index - 1:index + 2]
    inferred = all(x["adjustedIntervalsOverlap"] and not x["unadjustedIntervalsOverlap"] for x in links)
    account_consistent = all(accounting(r)["fullRoundingIntervalsOverlap"] for r in (before, at, after))
    return {
        "symbol": event["Symbol"], "statedSplitDate": event_day, "officialSplitRow": event,
        "shareFactor": factor, "before": source_record(before), "onStatedDate": source_record(at),
        "after": source_record(after), "nearbyPriorNavLinks": links,
        "reportedSharesAtOverBefore": dec(at["Shares Outstanding (000)"]) / dec(before["Shares Outstanding (000)"]),
        "impliedSharesAtOverBefore": implied_shares(at) / implied_shares(before),
        "mechanicalUnadjustedShareFactor": factor,
        "inference": {
            "navNeighborhoodConsistentWithRetrospectiveAdjustment": inferred,
            "allThreeRowsAccountingConsistentUnderRoundingAssumptions": account_consistent,
            "shareBasis": "consistent_with_adjusted_nav_and_aum" if inferred and account_consistent else "requires_inspection",
            "officialExplicitAdjustmentStatementObtained": False,
            "limits": "Prior NAV continuity and the accounting relation support the basis inference. Real creation/redemption can coincide with a split; share jumps alone do not identify the factor or original-vintage values. The CSV does not specify the event's intraday effective clock.",
        },
    }


def quantile(values, probability):
    ordered = sorted(values)
    if not ordered:
        return None
    position = Decimal(len(ordered) - 1) * dec(probability)
    low = int(position)
    fraction = position - low
    return ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * fraction


def summarize_accounting(rows):
    checks = [accounting(r) for r in rows]
    rel = [abs(x["relativeNavSharesAumDifference"]) for x in checks]
    residual = [abs(x["reportedMinusImpliedThousands"]) for x in checks]
    return {
        "rows": len(rows), "first": day(rows[0]["Date"]), "last": day(rows[-1]["Date"]),
        "medianAbsoluteRelativeIdentityDifference": quantile(rel, "0.5"),
        "maximumAbsoluteRelativeIdentityDifference": max(rel),
        "maximumAbsoluteReportedMinusImpliedThousands": max(residual),
        "worstRelativeDifferenceRow": max(checks, key=lambda x: abs(x["relativeNavSharesAumDifference"])),
        "impliedOutsideReportedShareRoundingIntervalCount": sum(not x["impliedInsideReportedShareRoundingInterval"] for x in checks),
        "fullRoundingIntervalMismatchCount": sum(not x["fullRoundingIntervalsOverlap"] for x in checks),
        "fullRoundingIntervalMismatches": [x for x in checks if not x["fullRoundingIntervalsOverlap"]],
        "interpretation": "A close identity may be mechanically generated from common accounting inputs. It is not independent proof that AUM/NAV recovers timely, original, unrounded shares.",
    }


def month_ends(histories):
    dates = set.intersection(*(set(day(r["Date"]) for r in rows) for rows in histories.values()))
    ends = {}
    for d in sorted(dates):
        ends[d[:7]] = d
    return sorted(ends.values()), len(dates)


def validate_month_sequence(endpoints):
    for previous, current in zip(endpoints, endpoints[1:]):
        a, b = date.fromisoformat(previous), date.fromisoformat(current)
        require((b.year * 12 + b.month) - (a.year * 12 + a.month) == 1,
                "Non-consecutive calendar months: " + previous + " -> " + current)


def compare_individual_month_ends(histories, endpoints):
    output = {}
    for symbol, rows in histories.items():
        individual = {}
        for row in rows:
            d = day(row["Date"])
            individual[d[:7]] = d
        mismatches = [{"month": d[:7], "commonMonthEnd": d,
                       "individualMonthEnd": individual.get(d[:7])}
                      for d in endpoints if individual.get(d[:7]) != d]
        output[symbol] = {"comparedMonths": len(endpoints),
                          "identicalForEveryComparedMonth": not mismatches,
                          "mismatches": mismatches,
                          "individualMonthsOutsideCommonScope": sorted(set(individual) - {d[:7] for d in endpoints})}
    return output


def monthly_audit(rows, endpoints):
    validate_month_sequence(endpoints)
    lookup = {day(r["Date"]): r for r in rows}
    results = []
    for start, end in zip(endpoints, endpoints[1:]):
        a, b = lookup[start], lookup[end]
        s0, s1 = dec(a["Shares Outstanding (000)"]), dec(b["Shares Outstanding (000)"])
        i0, i1 = implied_shares(a), implied_shares(b)
        reported, implied = growth(s0, s1), growth(i0, i1)
        lo, hi = growth_bounds(s0, s1)
        results.append({
            "previousMonthEnd": start, "currentMonthEnd": end,
            "reportedSharesPreviousThousands": s0, "reportedSharesCurrentThousands": s1,
            "impliedSharesPreviousThousands": i0, "impliedSharesCurrentThousands": i1,
            "reportedGrowthFraction": reported, "accountingImpliedGrowthFraction": implied,
            "reportedMinusImpliedGrowthPercentagePoints": (reported - implied) * 100,
            "reportedRoundingGrowthLowerFraction": lo, "reportedRoundingGrowthUpperFraction": hi,
            "roundingBoundWidthPercentagePoints": (hi - lo) * 100,
            "accountingImpliedGrowthInsideShareRoundingBounds": lo <= implied <= hi,
        })
    differences = [abs(r["reportedMinusImpliedGrowthPercentagePoints"]) for r in results]
    widths = [r["roundingBoundWidthPercentagePoints"] for r in results]
    return {"n": len(results), "medianAbsoluteGrowthDifferencePercentagePoints": quantile(differences, "0.5"),
            "p95AbsoluteGrowthDifferencePercentagePoints": quantile(differences, "0.95"),
            "maximumAbsoluteGrowthDifferencePercentagePoints": max(differences),
            "maximumShareRoundingBoundWidthPercentagePoints": max(widths),
            "impliedGrowthOutsideShareRoundingBoundsCount": sum(not r["accountingImpliedGrowthInsideShareRoundingBounds"] for r in results),
            "worstDifference": max(results, key=lambda r: abs(r["reportedMinusImpliedGrowthPercentagePoints"])),
            "observations": results}


def load_inputs(directory):
    manifest_path = directory / "retrieval-manifest.json"
    manifest = {x["id"]: x for x in json.loads(manifest_path.read_text())}
    histories, hashes = {}, []
    for symbol in (*SYMBOLS, "splits"):
        name = "etf_splits.csv" if symbol == "splits" else symbol + "-historical_nav.csv"
        path = directory / name
        raw = path.read_bytes()
        require(sha256(raw) == manifest[symbol]["sha256"], "Archived source hash changed: " + symbol)
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        hashes.append({"id": symbol, "path": str(path), "sha256": sha256(raw), "bytes": len(raw),
                       "url": manifest[symbol]["url"], "retrievedAt": manifest[symbol]["retrievedAt"],
                       "httpHeaders": manifest[symbol]["httpHeaders"]})
        if symbol == "splits":
            events = [r for r in rows if r["Symbol"] in SYMBOLS]
            continue
        require(all(r["Ticker"] == symbol for r in rows), "Wrong symbol")
        rows.sort(key=lambda r: day(r["Date"]))
        require(len({r["Date"] for r in rows}) == len(rows), "Duplicate source date")
        histories[symbol] = rows
    require(len(events) == 25, "Expected the archived 25-event audit universe")
    return histories, sorted(events, key=lambda r: (day(r["Date of Split"]), r["Symbol"])), hashes, manifest_path


def run_audit(directory):
    histories, events, hashes, manifest_path = load_inputs(directory)
    endpoints, common_days = month_ends(histories)
    event_results = [event_audit(e, histories[e["Symbol"]]) for e in events]
    accounts = {s: summarize_accounting(histories[s]) for s in SYMBOLS}
    monthly = {s: monthly_audit(histories[s], endpoints) for s in SYMBOLS}
    return {
        "schemaVersion": 1, "id": "portfolio-entry-ssi-input-audit-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(), "method": METHOD,
        "script": {"path": str(Path(__file__).resolve()), "sha256": sha256(Path(__file__).read_bytes())},
        "inputs": hashes, "manifestSha256": sha256(manifest_path.read_bytes()),
        "inputUniverse": {"symbols": list(SYMBOLS), "splitEvents": len(event_results),
                          "commonObservedDays": common_days, "monthEndDates": endpoints,
                          "consecutiveCalendarMonthsVerified": True,
                          "individualMonthEndComparison": compare_individual_month_ends(histories, endpoints)},
        "splitEvents": event_results, "shareAccounting": accounts, "monthlySharePrecision": monthly,
        "summary": {
            "splitEventsCompatibleWithRetrospectiveNavAdjustment": sum(x["inference"]["navNeighborhoodConsistentWithRetrospectiveAdjustment"] for x in event_results),
            "splitEventsWithAccountingCompatibleShareBasis": sum(x["inference"]["shareBasis"] == "consistent_with_adjusted_nav_and_aum" for x in event_results),
            "printPrecisionExceptionEvents": [{"symbol": x["symbol"], "statedSplitDate": x["statedSplitDate"]}
                                             for x in event_results if not x["inference"]["navNeighborhoodConsistentWithRetrospectiveAdjustment"]],
            "exceptionInterpretation": "A failed printed-precision continuity check does not establish an unadjusted split boundary. Inspect both residuals and classifications; no tolerance is widened after seeing the source data.",
            "officialExplicitAdjustmentStatementObtained": False,
            "reportedSharesReplacementApproved": False,
            "pointInTimeEstablished": False,
            "absenceOfHistoricalSnapshotsProvesAllUseInvalid": False,
            "newSsiOrInvestmentOutcomeComputed": False,
            "conclusionScope": "Input basis and quantization only. Current arithmetic agreement does not establish original disclosure times. Lack of complete vintages is a specific unresolved evidence gap, not an automatic refutation of all prospective use.",
        },
        "remainingEvidence": [
            "Official definition of each historical field's adjustment and rounding basis.",
            "Split announcement effective clocks and independent pre/post original snapshots.",
            "Whether AUM and NAV share an unrounded internal source and their actual precision.",
            "Creation/redemption action, settlement, recording and public disclosure times, separately.",
            "Historical substantive revisions versus common split rescaling and quantization.",
        ],
    }


def self_test():
    cases = 0
    require(share_factor({"Split Type": "Forward", "Ratio": "2"}) == 2, "Forward factor")
    require(share_factor({"Split Type": "Reverse", "Ratio": "4"}) == Decimal("0.25"), "Reverse factor")
    cases += 2
    require(nav_link({"Date": "01/01/2020", "NAV": "100.0000"}, {"Date": "01/02/2020", "Prior NAV": "100.0000"}, Decimal(2))["adjustedIntervalsOverlap"], "Adjusted link")
    require(nav_link({"Date": "01/01/2020", "NAV": "200.0000"}, {"Date": "01/02/2020", "Prior NAV": "100.0000"}, Decimal(2))["classification"] == "compatible_with_unadjusted_split_boundary", "Unadjusted link")
    require(nav_link({"Date": "01/01/2020", "NAV": "25.0000"}, {"Date": "01/02/2020", "Prior NAV": "100.0000"}, Decimal("0.25"))["classification"] == "compatible_with_unadjusted_split_boundary", "Reverse link")
    cases += 3
    s0, s1, factor = Decimal("150"), Decimal("210"), Decimal("0.000625")
    require(growth(s0, s1) == growth(factor * s0, factor * s1), "Common scaling cancels")
    rounded0 = (factor * s0).quantize(SHARE_QUANTUM, rounding=ROUND_HALF_UP)
    rounded1 = (factor * s1).quantize(SHARE_QUANTUM, rounding=ROUND_HALF_UP)
    require(growth(rounded0, rounded1) != growth(s0, s1), "Quantization does not cancel")
    lo, hi = growth_bounds(rounded0, rounded1)
    require(lo <= growth(s0, s1) <= hi, "Rounding sensitivity covers latent growth")
    cases += 3
    require(growth(Decimal(100) * 2, Decimal(200)) == 0, "One split adjustment removes mechanical growth")
    require(growth(Decimal(200) * 2, Decimal(200)) == Decimal("-0.5"), "Double adjustment creates false growth")
    cases += 2
    fixture = {"Date": "01/01/2020", "NAV": "112000", "Assets Under Management": "10500000", "Shares Outstanding (000)": "0.09"}
    check = accounting(fixture)
    require(check["impliedSharesThousands"] == Decimal("0.09375") and check["impliedInsideReportedShareRoundingInterval"], "Accounting rounding fixture")
    require(abs(check["relativeNavSharesAumDifference"]) == Decimal("0.04"), "Identity precision fixture")
    cases += 2
    histories = {s: [{"Date": "01/30/2020"}, {"Date": "01/31/2020"}, {"Date": "02/28/2020"}] for s in SYMBOLS}
    histories["SSO"] = [{"Date": "01/30/2020"}, {"Date": "02/28/2020"}]
    require(month_ends(histories)[0] == ["2020-01-30", "2020-02-28"], "Common-observation month ends")
    cases += 1
    validate_month_sequence(["2020-12-31", "2021-01-29"])
    try:
        validate_month_sequence(["2020-01-31", "2020-03-31"])
    except ValueError:
        pass
    else:
        raise ValueError("Missing whole month was not rejected")
    cases += 2
    link = nav_link({"Date": "01/01/2020", "NAV": "100.0000"},
                    {"Date": "01/02/2020", "Prior NAV": "99.9999"}, Decimal(2))
    require(link["adjustedBasisAbsoluteResidual"] == Decimal("0.0001")
            and link["adjustedBasisSignedResidual"] == Decimal("-0.0001"), "Absolute and signed residual semantics")
    cases += 1
    return {"syntheticCases": cases, "passed": True, "realSourceRead": False}


def encode(value):
    if isinstance(value, Decimal):
        require(value.is_finite(), "Non-finite result")
        return float(value)
    raise TypeError(type(value).__name__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("/tmp/portfolio-entry-signal-inputs-20261101"))
    parser.add_argument("--output", type=Path, default=ROOT / "docs/evidence/portfolio-entry-ssi-input-audit-v1.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    with localcontext() as context:
        context.prec = 40
        if args.self_test:
            print(json.dumps(self_test()))
            return
        result = run_audit(args.input_dir)
        args.output.write_text(json.dumps(result, default=encode, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        print(json.dumps({"output": str(args.output), "sha256": sha256(args.output.read_bytes()),
                          "summary": result["summary"], "monthly": {s: {k: v for k, v in r.items() if k not in ("observations", "worstDifference")} for s, r in result["monthlySharePrecision"].items()}}, default=encode))


if __name__ == "__main__":
    main()
