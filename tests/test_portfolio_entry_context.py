import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import refresh
from scripts import build_portfolio_entry_context as context, post_refresh


def csv_bytes(rows, header="DATE,OPEN,HIGH,LOW,CLOSE"):
    return (header + "\n" + "\n".join(f"{day},1,1,1,{value}" for day, value in rows) + "\n").encode()


def snapshots(vix=None, term=None, retrieved="2026-11-02"):
    defaults = [("10/29/2026", 19.0), ("10/30/2026", 20.0)]
    return {symbol: context.snapshot(symbol, csv_bytes(rows), retrieved)
            for symbol, rows in (("VIX", defaults if vix is None else vix), ("VIX3M", defaults if term is None else term))}


class EntryContextTests(unittest.TestCase):
    def test_pairs_only_same_dates_without_carry_or_union(self):
        doc = context.pair_snapshots(snapshots(
            vix=[("10/27/2026", 18), ("10/28/2026", 19), ("10/30/2026", 20)],
            term=[("10/27/2026", 22), ("10/29/2026", 23), ("10/30/2026", 24)]))
        self.assertEqual(doc["series"], [["2026-10-27", 18.0, 22.0], ["2026-10-30", 20.0, 24.0]])
        self.assertEqual(doc["asOf"], "2026-10-30")
        self.assertEqual(doc["sources"]["VIX"]["retrievedAtPrecision"], "day")

    def test_default_and_check_equivalent_read_path_do_not_fetch(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "context.json"
            saved = context.build(target, local_snapshots=snapshots())
            before = target.read_bytes()
            with patch.object(context, "fetch", side_effect=AssertionError("unexpected network")):
                self.assertEqual(context.build(target), saved)
            self.assertEqual(target.read_bytes(), before)

    def test_second_download_failure_preserves_values_and_all_original_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "context.json"
            context.build(target, local_snapshots=snapshots())
            before = target.read_bytes()
            with patch.object(context, "fetch", side_effect=[snapshots()["VIX"], TimeoutError("VIX3M unavailable")]):
                with self.assertRaises(TimeoutError):
                    context.build(target, refresh=True)
            self.assertEqual(target.read_bytes(), before)
            saved = json.loads(before)
            self.assertEqual(saved["asOf"], "2026-10-30")
            self.assertEqual(saved["sources"]["VIX3M"]["retrievedAt"], "2026-11-02")

    def test_post_refresh_retains_saved_pair_and_dates_when_second_source_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / "data"
            target = data / "portfolio/entry-context.json"
            context.build(target, local_snapshots=snapshots())
            before = target.read_bytes()

            def collector(command, **kwargs):
                self.assertEqual(Path(command[1]).name, "build_portfolio_entry_context.py")
                self.assertEqual(command[2:], ["--refresh"])
                try:
                    context.build(target, refresh=True)
                except TimeoutError as exc:
                    return subprocess.CompletedProcess(command, 1, "", "Entry context unchanged: " + str(exc))
                self.fail("the second Cboe source should have failed")

            with patch.object(post_refresh, "DATA", data), patch.object(refresh, "DATA", data), \
                    patch.object(refresh, "ROOT", root), patch.dict(refresh.PUBLISHED_OUTPUTS), \
                    patch.object(refresh.subprocess, "run", side_effect=collector), \
                    patch.object(refresh, "write_status"), \
                    patch.object(context, "fetch", side_effect=[snapshots()["VIX"], TimeoutError("VIX3M unavailable")]) as fetch:
                step = post_refresh.run_task("portfolio_stress")
                self.assertEqual(refresh.PUBLISHED_OUTPUTS["portfolio_stress"], ("portfolio/entry-context.json",))
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(step["status"], "failed")
            self.assertTrue(step["retainedPrevious"])
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(json.loads(before)["asOf"], "2026-10-30")

    def test_missing_columns_duplicate_dates_and_nonfinite_values_are_rejected(self):
        bad = [b"<html>Access denied</html>", b"DATE,OPEN\n10/30/2026,20\n",
               csv_bytes([("10/30/2026", 20), ("10/30/2026", 21)]),
               csv_bytes([("10/30/2026", 20), ("10/29/2026", 21)])]
        bad += [csv_bytes([("10/29/2026", 20), ("10/30/2026", value)]) for value in ("NaN", "inf", "", "0", "-1")]
        for payload in bad:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                context.snapshot("VIX", payload, "2026-11-02")

    def test_malformed_refresh_cannot_replace_valid_artifact(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "context.json"
            context.build(target, local_snapshots=snapshots())
            before = target.read_bytes()
            def broken(symbol):
                return context.snapshot(symbol, b"DATE,OPEN\n10/30/2026,20\n", "2026-11-03T21:30:00Z")
            with patch.object(context, "fetch", side_effect=broken), self.assertRaises(ValueError):
                context.build(target, refresh=True)
            self.assertEqual(target.read_bytes(), before)

    def test_refresh_appends_but_refuses_old_value_revisions_or_missing_saved_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "context.json"
            context.build(target, local_snapshots=snapshots())
            added = [("10/29/2026", 19), ("10/30/2026", 20), ("11/02/2026", 21)]
            fresh = snapshots(added, added, "2026-11-03T01:30:00Z")
            with patch.object(context, "fetch", side_effect=lambda symbol: fresh[symbol]):
                doc = context.build(target, refresh=True)
            self.assertEqual(doc["asOf"], "2026-11-02")
            self.assertEqual(doc["overlapVerification"]["unchangedPairedRows"], 2)
            before = target.read_bytes()
            for changed in ([added[0], ("10/30/2026", 999), added[2]], [added[0], added[2]]):
                bad = snapshots(changed, added, "2026-11-03T02:30:00Z")
                with patch.object(context, "fetch", side_effect=lambda symbol: bad[symbol]), self.assertRaises(ValueError):
                    context.build(target, refresh=True)
                self.assertEqual(target.read_bytes(), before)

    def test_saved_schema_does_not_accept_nonfinite_or_misidentified_sources(self):
        good = context.pair_snapshots(snapshots())
        for mutate in (lambda d: d["series"][0].__setitem__(1, float("nan")),
                       lambda d: d["series"][0].__setitem__(2, True),
                       lambda d: d.__setitem__("asOf", "2026-11-01"),
                       lambda d: d["sources"]["VIX"].__setitem__("actualUrl", context.URLS["VIX3M"]),
                       lambda d: d["sources"]["VIX"].__setitem__("sha256", "bad"),
                       lambda d: d.__setitem__("schemaVersion", True)):
            doc = copy.deepcopy(good)
            mutate(doc)
            with self.assertRaises(ValueError):
                context.validate_document(doc)


if __name__ == "__main__":
    unittest.main()
