import math
from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import research_portfolio_entry_drawdown as rd


def market(prices, start="2020-01-01", days=None):
    first = date.fromisoformat(start)
    return [{"day": days[i] if days else (first + timedelta(days=i)).isoformat(), "prices": list(p)}
            for i, p in enumerate(prices)]


class DrawdownResearchTests(unittest.TestCase):
    def test_pin_verifies_identical_bytes_from_disk_or_frozen_git_blob(self):
        raw = b'{"id":"fx:test","series":[["2011-01-04",7]]}'
        spec = {"id": "fx", "path": "test.json", "sha256": rd.digest(raw)}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(rd.subprocess, "run") as run:
                run.return_value.stdout = raw
                _, fallback = rd.read_frozen_source(spec, root)
                self.assertEqual(fallback["commit"], rd.FROZEN_COMMIT)
                self.assertEqual(run.call_args.args[0][-1], rd.FROZEN_COMMIT + ":test.json")
                (root / "test.json").write_bytes(raw)
                _, direct = rd.read_frozen_source(spec, root)
                self.assertEqual(direct["sha256"], fallback["sha256"])
                self.assertIsNone(direct["commit"])
                self.assertEqual(run.call_count, 1)
                (root / "test.json").write_bytes(raw + b" ")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    rd.read_frozen_source(spec, root)

    def test_common_calendar_does_not_forward_fill_asset_or_use_future_or_old_fx(self):
        usd = [["2020-01-02", 3], ["2020-01-03", 3], ["2020-01-09", 4], ["2020-01-10", 5], ["2020-01-11", 6]]
        tqqq = [["2020-01-02", 7], ["2020-01-09", 8], ["2020-01-10", 9], ["2020-01-11", 10]]
        fx = [["2020-01-02", 7], ["2020-01-11", 8]]
        rows = rd.common_cny_market(usd, tqqq, fx)
        self.assertEqual([r["day"] for r in rows], ["2020-01-02", "2020-01-09", "2020-01-11"])
        self.assertEqual(rows[1]["prices"], [28, 56])
        self.assertEqual(rows[-1]["prices"], [48, 80])
        self.assertEqual(rd.common_cny_market(usd[:1], tqqq, fx[1:]), [])
        with self.assertRaises(ValueError):
            rd.common_cny_market(usd + [usd[-1]], tqqq, fx)

    def test_reference_uses_daily_target_weights_not_forward_fixed_units(self):
        m = market([(100, 100), (200, 50), (100, 100)])
        sig = rd.score_market(m, 2, 1)
        self.assertAlmostEqual(sig[1]["reference"], 115)
        self.assertAlmostEqual(sig[2]["reference"], 132.25)
        self.assertAlmostEqual(rd.account_outcome(m, 0, 2, fee=0)["netReturnPp"], 0)

    def test_peak_includes_signal_day_and_drops_the_outgoing_old_peak(self):
        m = market([(200, 200), (100, 100), (100, 100), (150, 150)])
        a = rd.score_market(m, 2, 1)
        self.assertIsNone(a[0]["depth"])
        self.assertAlmostEqual(a[1]["depth"], .3)
        self.assertEqual(a[2]["peak252"], 70)
        self.assertEqual(a[2]["depth"], 0)
        self.assertEqual(a[3]["peak252"], a[3]["reference"])

    def test_504_strictly_prior_valid_depths_and_exact_tie_midrank(self):
        sig = rd.score_market(market([(100, 100)] * 757))
        self.assertIsNone(sig[754]["score"])
        self.assertEqual(sig[754]["priorDepthN"], 503)
        self.assertEqual((sig[755]["priorDepthN"], sig[755]["score"], sig[755]["band"]), (504, 50, "normal"))
        prior = [0, .1, .1, .2]
        self.assertEqual(rd.midrank_percentile(prior, .1), 50)
        self.assertEqual(rd.midrank_percentile(prior, math.nextafter(.1, 0)), 25)
        self.assertEqual(rd.midrank_percentile(prior, math.nextafter(.1, 1)), 75)
        self.assertEqual(rd.score_band(80), "high")
        self.assertEqual(rd.score_band(20), "low")
        self.assertEqual(rd.score_band(math.nextafter(80, 0)), "normal")
        self.assertEqual(rd.score_band(math.nextafter(20, 100)), "normal")

    def test_append_and_shock_after_observation_cannot_change_score(self):
        prices = [(100 + 15 * math.sin(i / 13), 120 - 9 * math.cos(i / 7)) for i in range(925)]
        m = market(prices)
        full = rd.score_market(m)
        cutoff = 810
        self.assertAlmostEqual(full[cutoff]["score"], rd.score_market(m[:cutoff + 1])[-1]["score"])
        changed = market(prices[:cutoff + 1] + [(1e5, .01)] * (len(m) - cutoff - 1))
        self.assertEqual(rd.score_market(changed)[:cutoff + 1], full[:cutoff + 1])
        self.assertNotEqual(rd.account_outcome(m, cutoff + 1, cutoff + 40), rd.account_outcome(changed, cutoff + 1, cutoff + 40))

    def test_fixed_budget_fees_and_path_drawdown_including_entry_and_final_sale(self):
        m = market([(100, 100), (200, 200), (100, 100)])
        result = rd.account_outcome(m, 0, 2)
        peak = .4 + 1.2 / 1.001
        terminal = .4 + .6 / 1.001 * .999
        self.assertAlmostEqual(result["netReturnPp"], 100 * (terminal - 1))
        self.assertAlmostEqual(result["maxDrawdownPp"], 100 * (terminal / peak - 1))
        flat = rd.account_outcome(market([(100, 100)] * 3), 0, 2)
        self.assertAlmostEqual(flat["maxDrawdownPp"], flat["netReturnPp"])
        upward = rd.account_outcome(market([(100, 100), (200, 200)]), 0, 1)
        self.assertAlmostEqual(upward["maxDrawdownPp"], 100 * (.4 + .6 / 1.001 - 1))

    def test_calendar_clamp_and_endpoint_gap_at_14_not_15(self):
        self.assertEqual(rd.add_months("2024-02-29", 12), "2025-02-28")
        self.assertEqual(rd.add_months("2023-11-30", 3), "2024-02-29")
        self.assertEqual(rd.add_months("2021-01-31", 3), "2021-04-30")
        start, entry = "2021-01-29", "2021-01-31"
        for end, valid in [("2021-05-14", True), ("2021-05-15", False)]:
            m = market([(100, 100)] * 3, days=[start, entry, end])
            s = [{"signalIndex": i, "day": r["day"], "score": 99, "band": "high"} for i, r in enumerate(m)]
            outcomes, excluded = rd.build_outcomes(m, s, [{"id": "all"}], (3,))
            if valid:
                self.assertEqual((outcomes[0]["entryDay"], outcomes[0]["anniversary"], outcomes[0]["endDay"]), (entry, "2021-04-30", end))
            else:
                self.assertEqual(outcomes, [])
                self.assertEqual(excluded[0]["reason"], "endpoint_more_than_14_days_late")

    def test_entry_is_strict_next_close_and_three_dates_share_a_partition(self):
        days = ["2018-09-27", "2018-09-28", "2018-12-28", "2018-12-31", "2019-01-02", "2019-04-02"]
        m = market([(4000, 4000), (100, 100), (200, 200), (300, 300), (400, 400), (500, 500)], days=days)
        s = [{"signalIndex": i, "day": d, "score": 99, "band": "high"} for i, d in enumerate(days)]
        parts = [{"id": "dev", "end": "2018-12-31"}, {"id": "val", "start": "2019-01-01"}]
        a, x = rd.build_outcomes(m, s, parts, (3,))
        self.assertEqual(len(a), 1)
        self.assertEqual((a[0]["entryDay"], a[0]["endDay"]), (days[1], days[2]))
        self.assertEqual(a[0]["netReturnPp"], rd.account_outcome(m, 1, 2)["netReturnPp"])
        by_i = {r["signalIndex"]: r["reason"] for r in x}
        self.assertEqual(by_i[2], "endpoint_crosses_partition")
        self.assertEqual(by_i[3], "entry_crosses_partition")
        self.assertEqual(by_i[4], "unmatured_endpoint")
        self.assertEqual(by_i[5], "no_next_common_close")
        self.assertEqual(len(a) + len(x), len(s))

    def test_null_and_tied_spearman_and_group_summary(self):
        self.assertIsNone(rd.spearman([], []))
        self.assertIsNone(rd.spearman([1, 1], [1, 2]))
        self.assertAlmostEqual(rd.spearman([1, 1, 2], [1, 2, 3]), math.sqrt(3) / 2)
        self.assertEqual(rd.spearman([3, 2, 1], [1, 2, 3]), -1)
        def result(i, entry, end, band, ret, dd, year="2020"):
            return {"signalIndex": i, "day": f"{year}-01-{i:02d}", "entryIndex": entry, "endIndex": end,
                    "entryDay": f"{year}-01-{entry:02d}", "endDay": f"{year}-02-{end:02d}", "score": {"low": 10, "normal": 50, "high": 90}[band],
                    "band": band, "netReturnPp": ret, "maxDrawdownPp": dd}
        rows = [result(1, 2, 4, "high", -2, -5), result(2, 3, 6, "high", 1, -4),
                result(3, 4, 7, "high", 2, -8), result(4, 5, 9, "normal", 1, -7),
                result(5, 6, 10, "high", 4, -2), result(7, 8, 12, "low", -3, -9, "2021")]
        g = rd.summarize_group(rows, "test", 12)
        self.assertEqual(g["highNonoverlap"]["n"], 2)
        self.assertEqual([w["day"] for w in g["highNonoverlap"]["windows"]], [rows[0]["day"], rows[4]["day"]])
        self.assertEqual(g["highClusters"], 2)
        self.assertEqual([r["signalIndex"] for r in g["highRunFirst"]], [1, 5])
        self.assertEqual(g["highRunFirstSummary"]["medianReturnPp"], 1)
        self.assertEqual(g["bands"]["high"]["worstMaxDrawdownPp"], -8)
        self.assertEqual(g["highMinusNormalMedianPp"], .5)
        self.assertEqual(g["highMinusLowMedianPp"], 4.5)
        self.assertIsNone(g["entryYears"][1]["highMinusNormalMedianPp"])


if __name__ == "__main__":
    unittest.main()
