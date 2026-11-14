"""Regression coverage for the issuer archive -> historical PE refresh chain."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import tempfile
from threading import Event
import unittest
from unittest.mock import call, patch

import market_history as history
import market_history_pe as issuer
from scripts import collect_portfolio_benchmark_pe as collector
from scripts import post_refresh


def index_page(symbol, pe="24.77", as_of="9/30/2026"):
    return f'''<section id="Index"><h2>Index</h2>
      <p id="index-asOfDate">as of {as_of}</p>
      <li><span>Price/Earnings Ratio</span><span>{pe}</span></li>
      <li><span>Price/Book Ratio</span><span>5.59</span></li>
      <li><span>Dividend Yield (%)</span><span>1.07%</span></li>
      <h6>About the Index</h6>
      <p>The {collector.ALL_NAMES[symbol]} is designed to track an index.</p>
      </section>'''


def observation(symbol, value="24.77", as_of="9/30/2026", known="2026-11-14T00:00:00Z"):
    return collector.parse_page(symbol, index_page(symbol, value, as_of).encode(), known)


def completed(name, exit_code=0, retained=False):
    return dict(dataset=name, status="completed" if exit_code == 0 else "failed",
                exitCode=exit_code, retainedPrevious=retained, seconds=0)


class MarketHistoryPeRefreshTests(unittest.TestCase):
    def test_sso_uses_index_date_and_value_despite_other_performance_dates(self):
        # Regression for the actual archive extraction error: a performance
        # month-end appeared before the index's earlier quarter-end date.
        performance = '''<section id="Performance"><h2>Performance</h2>
          <p>as of 11/30/2021</p><p id="index-asOfDate">as of 11/30/2021</p>
          <li>Price/Earnings Ratio 99.99</li></section>'''
        raw = (performance + index_page("SSO", "25.80", "9/30/2021") + performance).encode()
        row = collector.parse_page("SSO", raw, "2021-12-25T01:52:54Z")
        self.assertEqual((row["symbol"], row["indexName"], row["asOf"], row["indexPE"]),
                         ("SSO", "S&P 500 Index", "2021-09-30", 25.8))
        self.assertEqual(row["sourceSha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(row["displayDecimals"]["indexPE"], 2)
        self.assertEqual(row["sourceUrl"], collector.BASE + "sso")

    def test_explicit_history_symbols_do_not_change_default_portfolio_symbols(self):
        expected_default = {"USD": "Dow Jones U.S. Semiconductors Index", "TQQQ": "Nasdaq-100 Index"}
        self.assertEqual(collector.NAMES, expected_default)
        with tempfile.TemporaryDirectory() as directory:
            for symbols, expected in ((["SSO", "TQQQ"], ["SSO", "TQQQ"]),
                                      (None, ["USD", "TQQQ"])):
                out = Path(directory) / ("history.json" if symbols else "portfolio.json")
                with self.subTest(symbols=symbols), patch.object(collector, "fetch", side_effect=observation) as fetch:
                    result = collector.collect(out, symbols=symbols)
                    self.assertEqual(fetch.call_args_list, [call(s) for s in expected])
                    self.assertEqual({r["symbol"] for r in result["observations"]}, set(expected))
                    self.assertEqual(json.loads(out.read_bytes()), result)
                self.assertEqual(collector.NAMES, expected_default)
        self.assertEqual(post_refresh.TASKS["market_history_pe"][1],
                         ["--output", "data/market-history-pe.json", "--symbols", "SSO,TQQQ"])
        self.assertEqual(post_refresh.TASKS["benchmark_valuations"][1], [])

    def test_either_history_source_failure_leaves_saved_archive_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "history.json"
            payload = {"schemaVersion": 1, "observations": [observation("SSO"), observation("TQQQ")]}
            # Preserve formatting as well as the prior evidence values/times.
            stored = (json.dumps(payload, indent=4) + "\n\n").encode()
            out.write_bytes(stored)
            for failed in ("SSO", "TQQQ"):
                def fetch(symbol):
                    if symbol == failed:
                        raise OSError("issuer unavailable")
                    return observation(symbol, "31.00", known="2026-11-15T00:00:00Z")

                with self.subTest(failed=failed), patch.object(collector, "fetch", side_effect=fetch), \
                        self.assertRaisesRegex(ValueError, failed + ": issuer unavailable"):
                    collector.collect(out, symbols=["SSO", "TQQQ"])
                self.assertEqual(out.read_bytes(), stored)

    def test_default_refresh_waits_for_archive_completion_even_when_prior_archive_is_retained(self):
        for archive_failed in (False, True):
            archive_started, release_archive, archive_finished, history_started = (Event() for _ in range(4))

            def run_task(name, timeout=60):
                if name == "market_history_pe":
                    archive_started.set()
                    if not release_archive.wait(5):
                        raise AssertionError("test did not release archive collector")
                    archive_finished.set()
                    return completed(name, int(archive_failed), archive_failed)
                if name == "market_history":
                    history_started.set()
                    self.assertTrue(archive_finished.is_set(), "history raced the issuer archive collection")
                return completed(name)

            with self.subTest(archive_failed=archive_failed), \
                    patch.object(post_refresh, "run_task", side_effect=run_task) as task, \
                    patch.object(post_refresh.refresh, "execute", return_value=completed("quality")) as execute, \
                    patch.object(post_refresh, "atomic_text") as write, ThreadPoolExecutor(max_workers=1) as runner:
                future = runner.submit(post_refresh.main)
                try:
                    self.assertTrue(archive_started.wait(5), "default refresh omitted the issuer archive task")
                    self.assertFalse(history_started.is_set(), "history started before the blocked collector ended")
                finally:
                    release_archive.set()
                self.assertEqual(future.result(timeout=5), 0)
                self.assertTrue(history_started.is_set())
                self.assertEqual(sum(c.args[0] == "market_history_pe" for c in task.call_args_list), 1)
                self.assertEqual(sum(c.args[0] == "market_history" for c in task.call_args_list), 1)
                self.assertEqual(execute.call_count, 1)
                self.assertEqual(execute.call_args.args[0], "quality")
                report = json.loads(write.call_args.args[1])
                self.assertEqual(report["status"], "partial" if archive_failed else "completed")

    def test_market_history_only_uses_saved_archive_without_running_or_fetching_collector(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "saved-issuer-archive.json"
            rows = [observation(symbol, str(20 + year - 2021), f"{month}/{day}/{year}")
                    for symbol in ("SSO", "TQQQ") for year in range(2021, 2026)
                    for month, day in ((3, 31), (6, 30), (9, 30), (12, 31))]
            archive.write_text(json.dumps({"schemaVersion": 1, "observations": rows}))
            stored = archive.read_bytes()
            received = {}

            def run_task(name, timeout=60):
                self.assertEqual(name, "market_history")
                for market, symbol in issuer.SYMBOLS.items():
                    raw, timestamp, failure = history.fetch_source(
                        "proshares-" + market, collector.BASE + symbol.lower(), "2026-11-14")
                    self.assertIsNone(failure)
                    self.assertEqual(timestamp, "2026-11-14T00:00:00Z")
                    received[market] = issuer.metric(raw, market, "2026-11-14")["points"]
                return completed(name)

            with patch.object(issuer, "ARCHIVE", archive), \
                    patch.object(post_refresh, "run_task", side_effect=run_task) as task, \
                    patch.object(post_refresh.refresh, "execute", return_value=completed("quality")), \
                    patch.object(post_refresh, "atomic_text"), \
                    patch.object(collector, "fetch", side_effect=AssertionError("unexpected issuer fetch")) as fetch, \
                    patch.object(collector, "urlopen", side_effect=AssertionError("unexpected issuer network")), \
                    patch.object(history.urllib.request, "urlopen", side_effect=AssertionError("unexpected network")):
                # This is the selected list produced by --datasets market_history.
                self.assertEqual(post_refresh.main(["market_history"]), 0)
                task.assert_called_once_with("market_history")
                fetch.assert_not_called()
            self.assertEqual(set(received), {"spx", "ndx"})
            self.assertTrue(all(len(points) == 20 for points in received.values()))
            self.assertEqual(received["spx"][0], ["2021-03-31", 20])
            self.assertEqual(received["ndx"][-1], ["2025-12-31", 24])
            self.assertEqual(archive.read_bytes(), stored)


if __name__ == "__main__":
    unittest.main()
