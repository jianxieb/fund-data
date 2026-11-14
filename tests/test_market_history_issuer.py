import copy
from datetime import date, timedelta
import hashlib
import json
import unittest

import market_history as mh
import market_history_pe as pe


def publication(asof, value, known=None, market='spx', **extra):
    symbol = pe.SYMBOLS[market]
    return dict(symbol=symbol, indexName=pe.ALL_NAMES[symbol], asOf=asof,
                knownBy=known or asof + 'T21:00:00Z', indexPE=value,
                sourceUrl=pe.BASE + symbol.lower(), sourceSha256='a' * 64,
                evidenceType='issuer_live', **extra)


class MarketHistoryIssuerTests(unittest.TestCase):
    def refresh_inputs(self):
        previous = json.loads(mh.OUTPUT.read_text())
        asof = (date.fromisoformat(previous['asOf']) + timedelta(days=1)).isoformat()
        metric = next(m for m in previous['markets'][0]['metrics'] if m['id'] == 'pe')
        publications = metric['publications'] + [publication(asof, 25.05)]
        raw = {'proshares-spx': pe.encode(publications)}
        vix = next(m for m in previous['markets'][0]['metrics'] if m['id'] == 'vix')
        raw['vix'] = ('DATE,CLOSE\n' + '\n'.join(date.fromisoformat(day).strftime('%m/%d/%Y') + ',' + str(value)
                      for day, value in vix['points'] + [[asof, 21.25]])).encode()
        fetched = {key: asof + 'T21:00:00+00:00' for key in raw}
        return previous, asof, raw, fetched

    def test_both_indices_reproduce_every_published_point_from_the_retained_issuer_records(self):
        report = json.loads(mh.OUTPUT.read_text())
        mh.validate(report)
        for market in report['markets']:
            metric = next(m for m in market['metrics'] if m['id'] == 'pe')
            raw, _ = pe.read_archive(market['id'])
            self.assertEqual(metric, pe.metric(raw, market['id'], report['asOf']))
            source = report['sources'][metric['source']]
            self.assertEqual(source['sha256'], hashlib.sha256(raw).hexdigest())
            quarters = [(d[:4], (int(d[5:7]) - 1) // 3) for d, _ in metric['points']]
            self.assertEqual(len(quarters), len(set(quarters)))

    def test_same_quarter_versions_count_once_and_keep_the_actual_date_without_daily_fill(self):
        rows = [
            publication('2022-06-30', 20),
            publication('2022-09-30', 30, '2022-11-01T21:00:00Z'),
            publication('2022-09-30', 31, '2022-12-01T21:00:00Z'),
            publication('2022-12-31', 25, '2023-02-01T21:00:00Z'),
            publication('2023-06-30', 28),
            publication('2024-03-31', 90),
        ]
        _, points, excluded = pe.parse(pe.encode(rows), 'spx', '2023-06-30')
        self.assertEqual(points, [['2022-06-30', 20], ['2022-09-30', 31],
                                  ['2022-12-31', 25], ['2023-06-30', 28]])
        self.assertEqual(excluded, [])
        self.assertNotIn('2022-12-30', dict(points))
        self.assertNotIn('2023-03-31', dict(points))
        conflicted = rows + [publication('2022-09-30', 32, '2022-12-01T21:00:00Z')]
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            pe.parse(pe.encode(conflicted), 'spx', '2023-06-30')

    def test_a_flagged_latest_edition_does_not_restore_an_older_acceptable_number(self):
        rows = [publication('2022-06-30', 20),
                publication('2022-09-30', 30, '2022-11-01T21:00:00Z'),
                publication('2022-09-30', 31, '2022-12-01T21:00:00Z', qualityNote='Unresolved source inconsistency')]
        _, points, excluded = pe.parse(pe.encode(rows), 'spx', '2022-12-31')
        self.assertEqual(points, [['2022-06-30', 20]])
        self.assertEqual([row['asOf'] for row in excluded], ['2022-09-30'])

    def test_wrong_index_identity_and_invalid_publication_values_are_rejected(self):
        row = publication('2022-12-31', 25)
        for patch in ({'symbol': 'TQQQ', 'indexName': pe.ALL_NAMES['TQQQ']},
                      {'indexName': 'QQQ'}, {'sourceSha256': ''},
                      {'sourceUrl': pe.BASE + 'tqqq'}, {'knownBy': '2022-12-30T21:00:00Z'},
                      *({'indexPE': value} for value in [float('nan'), float('inf'), True, '25', None])):
            with self.subTest(patch=patch), self.assertRaises((ValueError, TypeError)):
                pe.parse(pe.encode([{**row, **patch}]), 'spx', '2022-12-31')

    def test_historical_point_or_publication_tampering_cannot_pass_latest_only_checks(self):
        published = json.loads(mh.OUTPUT.read_text())
        for target in ('points', 'publications'):
            data = copy.deepcopy(published)
            metric = data['markets'][0]['metrics'][0]
            if target == 'points':
                metric['points'][3][1] = 99999
            else:
                metric['publications'][3]['indexPE'] = 99999
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'PE observations|PE publication evidence'):
                mh.validate(data)
        for field in ('valuationBasis', 'vintage', 'frequency', 'limitations', 'publications', 'excludedPublicationDates'):
            data = copy.deepcopy(published)
            del data['markets'][0]['metrics'][0][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                mh.validate(data)

    def test_bad_issuer_refresh_retains_only_the_previous_documented_series_while_vix_advances(self):
        previous, asof, original, fetched = self.refresh_inputs()
        for bad in (b'not JSON', pe.encode([]), pe.encode([publication(asof, 25, market='ndx')]), None):
            raw = dict(original)
            if bad is None:
                del raw['proshares-spx']
            else:
                raw['proshares-spx'] = bad
            data = mh.build_with_source_fallback(raw, asof, fetched, previous=copy.deepcopy(previous),
                                                 failures={'proshares-spx': 'Source unavailable'})
            current = {m['id']: m for m in data['markets'][0]['metrics']}
            old = {m['id']: m for m in previous['markets'][0]['metrics']}
            self.assertEqual(current['pe'], old['pe'])
            self.assertEqual(data['sources']['proshares-spx'], previous['sources']['proshares-spx'])
            self.assertTrue(data['refreshFailures']['proshares-spx'])
            self.assertEqual(current['vix']['points'][-1], [asof, 21.25])
            mh.validate(data)

    def test_new_issuer_evidence_advances_without_reusing_a_withdrawn_source_or_prefix(self):
        previous, asof, raw, fetched = self.refresh_inputs()
        data = mh.build_with_source_fallback(raw, asof, fetched, previous=previous)
        metric = data['markets'][0]['metrics'][0]
        self.assertEqual(metric['points'][-1], [asof, 25.05])
        self.assertEqual(data['sources']['proshares-spx']['fetchedAt'], fetched['proshares-spx'])
        self.assertEqual(data['sources']['proshares-spx']['sha256'], hashlib.sha256(raw['proshares-spx']).hexdigest())
        self.assertFalse(any(key.startswith('jiucai-') for key in data['sources']))
        with self.assertRaisesRegex(ValueError, 'Missing source evidence'):
            mh.build_with_source_fallback(raw, asof, fetched)
        legacy = copy.deepcopy(previous)
        legacy['markets'][0]['metrics'][0]['source'] = 'jiucai-spx'
        legacy['sources']['jiucai-spx'] = legacy['sources'].pop('proshares-spx')
        with self.assertRaisesRegex(ValueError, 'unreviewed source'):
            mh.validate(legacy)
        del raw['proshares-spx']
        with self.assertRaisesRegex(ValueError, 'no previous evidence'):
            mh.build_with_source_fallback(raw, asof, fetched, previous=legacy)

    def test_new_quality_evidence_can_withdraw_a_quarter_but_silent_history_loss_is_rejected(self):
        previous, asof, raw, fetched = self.refresh_inputs()
        prior = previous['markets'][0]['metrics'][0]
        last_date = '2026-09-30'
        last_value = dict(prior['points'])[last_date]
        flagged = publication(last_date, last_value, asof + 'T22:00:00Z',
                              qualityNote='New source edition is not verified')
        raw['proshares-spx'] = pe.encode(prior['publications'] + [flagged])
        data = mh.build_with_source_fallback(raw, asof, fetched, previous=previous)
        current = data['markets'][0]['metrics'][0]
        self.assertNotIn(last_date, dict(current['points']))
        self.assertIn(last_date, current['excludedPublicationDates'])
        mh.validate(data)
        mh.reject_regression(data, previous)
        truncated = [row for row in prior['publications'] if row['asOf'][:7] not in ('2026-07', '2026-08', '2026-09')]
        raw['proshares-spx'] = pe.encode(truncated)
        with self.assertRaisesRegex(ValueError, 'historical quarter disappeared'):
            mh.build_with_source_fallback(raw, asof, fetched, previous=previous)

    def test_a_complete_rehashed_snapshot_cannot_roll_a_quarter_back_to_an_older_publication(self):
        previous = json.loads(mh.OUTPUT.read_text())
        prior = previous['markets'][0]['metrics'][0]
        self.assertEqual(dict(prior['points'])['2025-06-30'], 26.76)
        # These are actual captured editions. Keeping the July/August value but
        # dropping September/October still preserves every quarter and parses.
        publications = [row for row in prior['publications']
                        if row['asOf'] != '2025-06-30' or row['knownBy'] <= '2025-08-05T19:30:52Z']
        raw = pe.encode(publications)
        data = copy.deepcopy(previous)
        current = pe.metric(raw, 'spx', data['asOf'])
        data['markets'][0]['metrics'][0] = current
        data['sources']['proshares-spx']['sha256'] = hashlib.sha256(raw).hexdigest()
        self.assertEqual(dict(current['points'])['2025-06-30'], 26.761)
        self.assertEqual(len(current['points']), len(prior['points']))
        mh.validate(data)
        with self.assertRaisesRegex(ValueError, 'publication version regressed'):
            mh.reject_regression(data, previous)


if __name__ == '__main__':
    unittest.main()
