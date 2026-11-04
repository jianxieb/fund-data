import base64
import hashlib
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts import collect_portfolio_benchmark_pe as pe


def index_html(name, value, as_of="9/30/2026"):
    return f'''<section id="Index"><h2>Index</h2>
      <p id="index-asOfDate">as of {as_of}</p>
      <li><span>Price/Earnings Ratio</span><span>{value}</span></li>
      <h6>About the Index</h6><p>The {name} is designed to track an index.</p></section>'''


def observation(symbol="USD", value=30, known="2026-10-15T14:00:00Z"):
    body = index_html(pe.NAMES[symbol], value).encode()
    return pe.parse_page(symbol, body, known)


def archived(symbol, value, known):
    row = observation(symbol, value, known)
    stamp = known.replace("-", "").replace(":", "").replace("T", "").removesuffix("Z")
    body = index_html(pe.NAMES[symbol], value).encode()
    return {**row, "evidenceType": "verified_archive",
            "archiveUrl": f"https://web.archive.org/web/{stamp}id_/" + row["sourceUrl"],
            "archiveDigestSha1Base32": base64.b32encode(hashlib.sha1(body).digest()).decode()}


def live_metrics(as_of, known, pb="9.45", dividend="0.59", value="44.39", symbol="USD"):
    items = ((f'<li><span>Price/Book Ratio</span><span>{pb}</span></li>' if pb is not None else '') +
             (f'<li><span>Dividend Yield ( % )</span><span>{dividend}</span></li>' if dividend is not None else ''))
    page = index_html(pe.NAMES[symbol], value, as_of).replace('<h6>', items + '<h6>')
    return pe.parse_page(symbol, page.encode(), known)


class BenchmarkValuationTests(unittest.TestCase):
    def test_as_of_replays_the_issued_version_before_filtering_flagged_quarters(self):
        def quote(as_of, known, value, flagged=False):
            row = live_metrics(as_of, known + "T14:00:00Z", value=value, symbol="TQQQ")
            return {**row, "qualityNote": "Check printed figure"} if flagged else row

        rows = [quote("3/31/2017", "2017-04-10", "10"), quote("6/30/2017", "2017-07-10", "20"),
                quote("9/30/2017", "2017-10-10", "30"), quote("12/31/2017", "2018-01-10", "40"),
                quote("3/31/2018", "2018-04-10", "50"), quote("3/31/2018", "2018-04-20", "500", True),
                quote("12/31/2018", "2019-01-16", "221.09", True),
                quote("12/31/2018", "2019-03-19", "20")]

        def state(day):
            return pe.benchmark_pe_as_of(list(reversed(rows)), date.fromisoformat(day))["benchmarks"]["TQQQ"]

        # The corrected edition was observed during March 19, not before that date.
        blocked = state("2019-03-19")
        self.assertEqual((blocked["knownBy"][:10], blocked["indexPE"], blocked["missingReason"]),
                         ("2019-01-16", None, "flagged_current_observation"))
        clean = state("2019-03-20")
        self.assertEqual((clean["indexPE"], clean["priorValidQuarters"], clean["cheapnessPercentile"]),
                         (20, 4, 62.5))  # Half credit for the tie. Neither version of 2018 Q1 counts.
        self.assertEqual(state("2019-07-03")["missingReason"], "older_than_183_days")
        self.assertEqual(state("2017-04-10")["missingReason"], "no_known_observation")
        self.assertEqual(state("2017-04-11")["missingReason"], "fewer_than_four_prior_valid_quarters")

    def test_only_named_index_section_supplies_value_date_and_benchmark_identity(self):
        # The fund and index can report different values under an identically named field.
        fund = '''<section id="Fund"><h2>Fund Characteristics</h2><p>Nasdaq-100 Index</p>
          <p>as of 10/31/2026</p><li>Price/Earnings Ratio 99.12</li></section>'''
        fake = index_html("Nasdaq-100 Index", "99.12")
        page = (fund + '<!--' + fake + '--><script>' + fake + '</script>' +
                index_html("Nasdaq-100 Index", "31.69") + fund).encode()
        known = "2026-11-02T17:42:15Z"
        row = pe.parse_page("TQQQ", page, known)
        self.assertEqual((row["symbol"], row["indexName"], row["indexPE"], row["asOf"], row["knownBy"]),
                         ("TQQQ", "Nasdaq-100 Index", 31.69, "2026-09-30", known))
        self.assertEqual(row["sourceSha256"], hashlib.sha256(page).hexdigest())
        for bad in (fund, fund + index_html("S&P 500 Index", "31.69"),
                    fund + index_html("Nasdaq-100 Index", "31.69").replace(
                        '<h6>', '<li>Price/Earnings Ratio 31.69</li><h6>')):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                pe.parse_page("TQQQ", bad.encode(), known)

    def test_same_quarter_revisions_keep_first_known_time_and_restore_prior_value(self):
        clocks = ["2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z", "2026-10-15T13:00:00Z",
                  "2026-10-15T13:30:00Z", "2026-10-17T09:00:00Z"]
        a, same_a, b, same_b, restored = [observation(value=value, known=known)
                                         for value, known in zip([30, 30, 33, 33, 30], clocks)]
        rows = pe.merge_observations([a, b], [restored, same_b, same_a])
        self.assertEqual([(r["knownBy"], r["indexPE"]) for r in rows],
                         [(clocks[0], 30), (clocks[2], 33), (clocks[4], 30)])
        self.assertTrue(all(r["asOf"] == "2026-09-30" for r in rows))
        # Replay evidence available *before* each decision, never from its valuation day alone.
        for cutoff, expected in [("2026-10-01T00:00:00Z", []), (clocks[0], []),
                                 (clocks[2], [30]), (clocks[4], [30, 33])]:
            self.assertEqual([r["indexPE"] for r in rows if r["knownBy"] < cutoff], expected)
        # A duplicate preceding a contradictory observation at the very same instant
        # must not mask the conflict when consecutive equal P/Es are compressed.
        with self.assertRaises(ValueError):
            pe.merge_observations([a], [same_a, observation(value=33, known=clocks[1])])

    def test_optional_index_metrics_use_printed_units_and_precision(self):
        r = live_metrics("3/31/2026", "2026-04-05T00:00:00Z", pb="9.450", dividend="0.590")
        self.assertEqual((r['indexPB'], r['dividendYieldPct']), (9.45, .59))
        self.assertEqual(r['displayDecimals'], {'indexPE': 2, 'indexPB': 3, 'dividendYieldPct': 3})
        for pb, dy in [(None, None), ('--', 'N/A')]:
            missing = live_metrics("3/31/2026", r['knownBy'], pb=pb, dividend=dy)
            self.assertNotIn('indexPB', missing); self.assertNotIn('dividendYieldPct', missing)
        doc = index_html(pe.NAMES['USD'], '44.39', '3/31/2026')
        doc = '<section id="fund"><li>Price/Book Ratio 37.25</li></section>' + doc.replace('<h6>', '<li>Dividend Yield 0.59</li><h6>')
        ambiguous = pe.parse_page('USD', doc.encode(), r['knownBy'])
        self.assertNotIn('indexPB', ambiguous); self.assertNotIn('dividendYieldPct', ambiguous)
        with self.assertRaises(ValueError):
            pe.checked({**r, 'displayDecimals': {'indexPB': 1}})

    def test_triple_repeat_and_same_asof_change_or_reversion_without_pe_change(self):
        before = live_metrics('12/31/2025', '2026-01-10T12:00:00Z')
        clocks = [f'2026-04-{day:02d}T12:00:00Z' for day in (8, 9, 10, 11, 12)]
        fresh = [live_metrics('3/31/2026', t, pb, dy) for t, (pb, dy) in zip(clocks,
                 [('9.45', '0.59'), ('9.45', '0.59'), ('9.46', '0.59'), ('9.45', '0.59'), ('9.45', '0.58')])]
        fresh[2]['qualityNote'] = 'Previous edition warning, no longer applicable.'
        rows = pe.merge_observations([before], fresh)[1:]
        self.assertEqual([r['knownBy'] for r in rows], [clocks[i] for i in (0, 2, 3, 4)])
        self.assertEqual(['qualityNote' in r for r in rows], [True, False, True, False])
        self.assertIn(before['asOf'], rows[0]['qualityNote'])
        self.assertTrue(all(r['indexPE'] == before['indexPE'] for r in rows))
        self.assertEqual(pe.merge_observations([before, *rows], fresh), [before, *rows])

    def test_only_latest_then_known_earlier_date_and_same_precision_are_comparable(self):
        current = live_metrics('6/30/2026', '2026-07-08T12:00:00Z')
        older = live_metrics('12/31/2025', '2026-01-08T12:00:00Z')
        prev = live_metrics('3/31/2026', '2026-04-08T12:00:00Z', pb='9.47')
        def note(evidence):
            rows = pe.merge_observations(evidence, [current]);return next(r.get('qualityNote') for r in rows if r['knownBy'] == current['knownBy'] and r['asOf'] == current['asOf'])
        self.assertIsNotNone(note([older]))
        self.assertIsNone(note([older, prev]))  # Never skip the latest date to find an older match.
        self.assertIsNone(note([older, prev, live_metrics('3/31/2026', current['knownBy'])]))
        self.assertIsNone(note([older, prev, live_metrics('3/31/2026', '2026-07-09T12:00:00Z')]))
        for other in (live_metrics('3/31/2026', prev['knownBy'], dividend=None),
                      live_metrics('3/31/2026', prev['knownBy'], pb='9.450'),
                      {k: v for k, v in older.items() if k != 'displayDecimals'},
                      live_metrics('3/31/2026', prev['knownBy'], symbol='TQQQ')):
            self.assertIsNone(note([other]))
        self.assertIsNone(note([older, live_metrics('3/31/2026', prev['knownBy'], dividend=None)]))

    def test_archive_enrichment_from_same_body_preserves_existing_live_history(self):
        base = {**archived('USD', 30, '2026-10-03T00:00:00Z'), 'asOf':'2026-06-30'}
        rich = {**base, 'indexPB':9.45, 'dividendYieldPct':.59,
                'displayDecimals':{'indexPE':0, 'indexPB':2, 'dividendYieldPct':2}, 'qualityNote':'Archived source check.'}
        current = live_metrics('9/30/2026', '2026-10-10T00:00:00Z', value='30')
        initial = pe.merge_observations([base], [current]); self.assertNotIn('qualityNote', initial[1])
        self.assertEqual(pe.merge_observations(initial, [rich]), [rich, current])
        self.assertEqual(pe.merge_observations([rich, current], [base, rich]), [rich, current])
        for change in ({'indexPB':9.47}, {'qualityNote':'different'}, {'sourceSha256':'0'*64},
                       {'displayDecimals':{**rich['displayDecimals'], 'indexPB':3}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                pe.merge_observations([rich, current], [{**rich, **change}])

    def test_invalid_archive_leaves_published_history_byte_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "history.json"; archive = Path(directory) / "archive.json"
            stored = json.dumps({"schemaVersion": 1, "observations": [observation()]}).encode()
            out.write_bytes(stored)
            row = observation("TQQQ", 32, "2026-10-12T13:22:33Z")
            source = row["sourceUrl"]
            valid = {**row, "evidenceType": "verified_archive", "archiveDigestSha1Base32": "A" * 32,
                     "archiveUrl": "https://web.archive.org/web/20261012132233id_/" + source}
            with patch.object(pe, "fetch", side_effect=AssertionError("unexpected network request")):
                for change in [{"archiveUrl": valid["archiveUrl"].replace("132233", "132234")},
                               {"archiveUrl": valid["archiveUrl"].replace("/tqqq", "/usd")},
                               {"archiveDigestSha1Base32": "!" * 32}, {"evidenceType": "issuer_live"}]:
                    archive.write_text(json.dumps([valid, {**valid, **change}]))
                    with self.subTest(change=change), self.assertRaises(ValueError):
                        pe.collect(out, archive=archive, archive_only=True)
                    self.assertEqual(out.read_bytes(), stored)
                archive.write_text(json.dumps([valid]))
                known = pe.collect(out, archive=archive, archive_only=True)["observations"]
                self.assertEqual(next(r for r in known if r["symbol"] == "TQQQ"), valid)

    def test_late_archive_correction_preserves_subsequent_reconfirmation_and_rejects_conflicts(self):
        times = ["2026-10-10T12:00:00Z", "2026-10-12T12:00:00Z", "2026-10-14T12:00:00Z"]
        a1, b2, a3 = [archived("TQQQ", v, t) for v, t in zip([30, 33, 30], times)]
        with tempfile.TemporaryDirectory() as directory, patch.object(pe, "fetch", side_effect=AssertionError("unexpected fetch")):
            out = Path(directory) / "out.json"
            feed = Path(directory) / "archive.json"

            def ingest(rows):
                feed.write_text(json.dumps(rows))
                return pe.collect(out, archive=feed, archive_only=True)["observations"]

            self.assertEqual(ingest([a3, a1]), [a1, a3])
            before = out.read_bytes()
            # Same original URL and capture time cannot support two different P/Es.
            with self.assertRaises(ValueError):
                ingest([b2, archived("TQQQ", 35, times[2])])
            self.assertEqual(out.read_bytes(), before)
            self.assertEqual(ingest([b2]), [a1, b2, a3])
            # Re-importing overlapping evidence is idempotent; inspect the stored timeline.
            state = out.read_bytes()
            ingest([b2, a3])
            self.assertEqual(out.read_bytes(), state)
            rows = json.loads(state)["observations"]
            for cutoff, value in zip(times, [None, 30, 33]):
                known = [r for r in rows if r["knownBy"] < cutoff]
                self.assertEqual(known[-1]["indexPE"] if known else None, value)
            self.assertEqual(rows[-1]["indexPE"], 30)
            # The first live retrieval remains identifiable, even when the archived
            # value matches it. The next unchanged live retrieval must not rewrite it.
            with patch.object(pe, "fetch", side_effect=lambda s: observation(s, 30, "2026-10-18T11:00:00Z")):
                live = pe.collect(out)["observations"]
            self.assertEqual([r["knownBy"] for r in live if r["symbol"] == "TQQQ" and r["evidenceType"] == "issuer_live"],
                             ["2026-10-18T11:00:00Z"])
            state = out.read_bytes()
            with patch.object(pe, "fetch", side_effect=lambda s: observation(s, 30, "2026-10-19T11:00:00Z")):
                pe.collect(out)
            self.assertEqual(out.read_bytes(), state)

    def test_live_batch_is_atomic_and_recapturing_unchanged_values_keeps_original_times(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "history.json"
            stored = json.dumps({"schemaVersion": 1, "observations": sorted(
                [observation(symbol) for symbol in pe.NAMES], key=lambda r: r["symbol"])}).encode()
            out.write_bytes(stored)
            later = "2026-11-03T08:25:00Z"
            for failed_symbol in pe.NAMES:
                def fetch(symbol):
                    if symbol == failed_symbol:
                        raise OSError("test source unavailable")
                    return observation(symbol, 31, later)
                with self.subTest(failed_symbol=failed_symbol), patch.object(pe, "fetch", side_effect=fetch), self.assertRaises(ValueError):
                    pe.collect(out)
                self.assertEqual(out.read_bytes(), stored)
            with patch.object(pe, "fetch", side_effect=lambda symbol: observation(symbol, 30, later)):
                refreshed = pe.collect(out)
            self.assertEqual(refreshed["observations"], json.loads(stored)["observations"])
            self.assertEqual(out.read_bytes(), stored)


if __name__ == "__main__":
    unittest.main()
