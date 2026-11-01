#!/usr/bin/env python3
"""Audit only observed dates; never read prices, fit a model or compute returns."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "data/portfolio/us/USD-7da045c18fc6ba1a.json": "7da045c18fc6ba1a7f4dc7259f930f8176c67f5679a7b422052bba7355a13675",
    "data/portfolio/us/TQQQ-0694d4779afd68bd.json": "0694d4779afd68bd9c0392d62592b1908601719f2eabfbebc5f8fa7be80e6d2c",
}
REPORT_PATH = "docs/evidence/portfolio-entry-ssi-v5.json"
REPORT_SHA = "475f489fdf9f942d0c3b583d3d8826268e0b9bba4c1b782dc9b0768474bb3f99"
CALENDAR_SHA = "2e3851fc6cf968b09f2a1f33a76ff1eaa949e824537cdc9678a665333f65f952"


def read_bound(relative, expected):
    raw = (ROOT / relative).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == expected, relative
    return json.loads(raw)


def audit():
    date_sets = []
    for relative, expected in SOURCES.items():
        dates = [row[0] for row in read_bound(relative, expected)["series"]]
        assert dates == sorted(set(dates)), relative
        date_sets.append(set(dates))
    dates = sorted(set.intersection(*date_sets))
    encoded = json.dumps(dates, separators=(",", ":")).encode()
    assert hashlib.sha256(encoded).hexdigest() == CALENDAR_SHA
    report = read_bound(REPORT_PATH, REPORT_SHA)
    assert dates == [row["day"] for row in report["dailyPredictions"]]
    assert len(dates) == 4206 and dates[0] == "2010-02-11" and dates[-1] == "2026-10-30"
    months = collections.defaultdict(list)
    for day in dates:
        if day[:7] > "2010-02":
            months[day[:7]].append(day)
    assert len(months) == 200
    arrivals = []
    for nominal in (1, 10, 20):
        rows = []
        for month, observed in months.items():
            index = next(i for i, day in enumerate(observed) if int(day[-2:]) >= nominal)
            rows.append({"month": month, "arrival": observed[index], "ordinal": index + 1})
        counts = collections.Counter(row["ordinal"] for row in rows)
        arrivals.append({"nominalDay": nominal, "months": len(rows),
                         "ordinalCounts": dict(sorted(counts.items())), "rows": rows})
    return {
        "id": "portfolio-entry-calendar-date-audit-v1",
        "scope": "observed_dates_only_no_strategy_or_return_test",
        "sources": [{"path": p, "sha256": sha} for p, sha in SOURCES.items()],
        "independentCrossCheck": {"path": REPORT_PATH, "sha256": REPORT_SHA,
                                  "field": "dailyPredictions[*].day", "equal": True},
        "calendar": {"first": dates[0], "last": dates[-1], "observations": len(dates),
                     "sha256": CALENDAR_SHA},
        "monthSelection": "Exclude initial partial month 2010-02; retain all 200 observed months 2010-03..2026-10, without model warmup, maturity or partition filtering.",
        "arrivalDefinition": "First observed common date with calendar day >= nominal day; ordinal is one-based within that month's observed common dates.",
        "limitations": ["Observed dates are not a historical as-of schedule or a settlement calendar.",
                        "Matching date sources does not independently prove complete exchange coverage.",
                        "No outcome was calculated and no trading candidate was registered."],
        "arrivals": arrivals,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    result = audit()
    if args.write:
        output = ROOT / "docs/evidence/portfolio-entry-calendar-date-audit-v1.json"
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"calendar": result["calendar"], "arrivals": [
        {k: v for k, v in row.items() if k != "rows"} for row in result["arrivals"]
    ]}, ensure_ascii=False))
