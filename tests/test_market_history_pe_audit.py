"""Date/field integrity tests for the offline cross-source PE audit."""
from datetime import datetime, timezone
from io import BytesIO
import unittest
import zipfile

from scripts import audit_market_history_pe as audit


class PeSourceAuditTests(unittest.TestCase):
    def test_danjuan_uses_explicit_china_date_not_utc_or_capture_filename(self):
        # 16:00 UTC is the following date at the provider's UTC+08 midnight.
        ts = int(datetime(2026, 11, 11, 16, tzinfo=timezone.utc).timestamp() * 1000)
        data = {"data": {"items": [{"index_code": "NDX", "pe": 27.1704, "ts": ts,
                                     "date": "11-12", "updated_at": 1794533520212}]}}
        row = audit.parse_danjuan_snapshot(data, "NDX", "djeva-2026-11-13.json")
        self.assertEqual(row["date"], "2026-11-12")
        self.assertIn("2026-11-13.json", row["url"])

    def test_non_midnight_timestamp_requires_review(self):
        with self.assertRaisesRegex(ValueError, "midnight"):
            audit.danjuan_date(1794412800001)

    def test_exact_join_does_not_shift_month_ends_or_holidays_or_fill(self):
        left = [audit.observation("2021-03-31", 30.5), audit.observation("2026-07-03", 28)]
        right = [audit.observation("2021-03-01", 30.5), audit.observation("2026-07-02", 28)]
        self.assertEqual(audit.pair_rows(left, right), [])
        self.assertEqual(audit.pair_summary(left, right)["leftUnmatched"], 2)

    def test_legu_retains_only_non_null_pe_and_keeps_literal_date(self):
        rows = audit.parse_legu({"xAxis": ["2021-03-30", "2021-03-31", "2021-04-01"],
            "series": [[3958.55, 3972.89, None], [None, 30.5, 30.6]],
            "yAxisNames": ["标普500指数", "标普500市盈率"]})
        self.assertEqual([r["date"] for r in rows], ["2021-03-31", "2021-04-01"])
        self.assertEqual(rows[0]["close"], 3972.89)
        self.assertNotIn("close", rows[1])

    def test_legu_rejects_array_misalignment(self):
        with self.assertRaisesRegex(ValueError, "aligned"):
            audit.parse_legu({"xAxis": ["2021-03-31"], "series": [[], [30.5]],
                              "yAxisNames": ["指数", "市盈率"]})

    def test_multpl_table_preserves_estimate_and_date(self):
        html = '''<table><tr><td>unrelated</td></tr></table><table id="datatable">
        <tr><th>Date</th><th>PE</th></tr>
        <tr><td>Nov 12, 2026</td><td><abbr title="Estimate">†</abbr>25.91</td></tr>
        <tr><td>Mar 1, 2021</td><td>30.50</td></tr></table>'''
        rows = audit.parse_multpl(html)
        self.assertEqual(rows[0], {"date": "2026-11-12", "pe": 25.91, "estimated": True})
        self.assertEqual(rows[1], {"date": "2021-03-01", "pe": 30.5, "estimated": False})

    def test_spglobal_requires_four_complete_consecutive_quarters(self):
        days = ["2020-03-31", "2020-06-30", "2020-09-30", "2020-12-31"]
        rows = [dict(d=d, reported=v, operating=v * 2, p=400, row=i)
                for i, (d, v) in enumerate(zip(days, [1, 2, 3, 4]))]
        self.assertEqual(audit.parse_spglobal(rows, "reported")[0]["pe"], 40)
        self.assertEqual(audit.parse_spglobal(rows, "operating")[0]["pe"], 20)
        rows[1]["d"] = "2020-03-30"  # duplicate quarter, still four rows
        self.assertEqual(audit.parse_spglobal(rows, "reported"), [])
        rows[1]["d"], rows[1]["reported"] = "2020-06-30", None
        self.assertEqual(audit.parse_spglobal(rows, "reported"), [])

    def test_workbook_parser_uses_sheet_identity_and_does_not_fill_empty_eps(self):
        stream = BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("xl/workbook.xml", '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
              <sheet name="QUARTERLY DATA" r:id="rId9"/></sheets></workbook>''')
            archive.writestr("xl/_rels/workbook.xml.rels", '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId9" Target="worksheets/data.xml"/></Relationships>''')
            archive.writestr("xl/worksheets/data.xml", '''<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
              <row r="7"><c r="A7"><v>46022</v></c><c r="B7"/><c r="C7"/><c r="H7"><v>6845.5</v></c></row>
              <row r="8"><c r="A8"><v>45930</v></c><c r="B8"><v>72.03</v></c><c r="C8"><v>63.52</v></c><c r="H8"><v>6688.46</v></c></row>
              </sheetData></worksheet>''')
        rows = audit.parse_spglobal_workbook(stream.getvalue())
        self.assertEqual(rows[0], dict(d="2025-09-30", reported=63.52, operating=72.03, p=6688.46, row=8))
        self.assertEqual(rows[1]["d"], "2025-12-31")
        self.assertIsNone(rows[1]["reported"])
        self.assertIsNone(rows[1]["operating"])

    def test_proshares_editions_preserve_rounding_disagreement(self):
        rows = [audit.observation("2025-06-30", 26.761, knownBy="20250726115632"),
                audit.observation("2025-06-30", 26.76, knownBy="20250805193052")]
        selected, conflicts = audit.select_editions(rows)
        self.assertEqual(selected[0]["pe"], 26.76)
        self.assertEqual(len(conflicts[0]["editions"]), 2)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            audit.pair_rows(rows, selected)

    def test_identity_and_invalid_numeric_values_rejected(self):
        with self.assertRaisesRegex(ValueError, "identity"):
            audit.parse_jiucai({"code": "NDX.GI", "metric": "pe", "series": []}, "SPX.GI")
        for value in (float("nan"), float("inf"), 0, -1, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                audit.observation("2020-01-01", value)

    def test_anomaly_normalizes_price_and_requires_consecutive_price_days(self):
        prices = {"2020-03-13": 100, "2020-03-16": 88, "2020-03-17": 90, "2020-03-18": 91}
        proportional = [audit.observation("2020-03-13", 20), audit.observation("2020-03-16", 17.6)]
        self.assertEqual(audit.anomalies(proportional, prices), [])
        # A missing PE on the intervening price date is never bridged.
        missing = proportional + [audit.observation("2020-03-18", 50)]
        self.assertEqual(audit.anomalies(missing, prices), [])
        present = missing + [audit.observation("2020-03-17", 18)]
        self.assertEqual(audit.anomalies(present, prices)[0]["date"], "2020-03-18")

    def test_missing_prices_distinguish_outside_coverage_from_inside_gap(self):
        rows = [audit.observation("2010-01-01", 10), audit.observation("2026-07-03", 20),
                audit.observation("2026-07-06", 21)]
        summary = audit.source_summary(rows, {"2026-07-02": 100, "2026-07-06": 101})
        self.assertEqual(summary["sourceDatesOutsideSavedPriceSpan"], 1)
        self.assertEqual(summary["sourceDatesMissingPriceWithinSavedSpan"], ["2026-07-03"])


if __name__ == "__main__":
    unittest.main()
