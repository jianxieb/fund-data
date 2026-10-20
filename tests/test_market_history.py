import copy
from datetime import date, timedelta
import json
import math
from pathlib import Path
import statistics
import unittest

import market_history as mh


class MarketHistoryTests(unittest.TestCase):
    def test_provider_valuation_requires_identity_positive_values_and_snapshot_alignment(self):
        payload = dict(code='SPX.GI', metric='pe', latest=25.2089,
            series=[dict(date='2026-10-12', value=25.19), dict(date='2026-10-13', value=25.2089)])
        detail = dict(header=dict(code='SPX.GI', name='标普500', metric='pe', value=25.2), update_time='2026-10-13')
        raw = lambda d: json.dumps(d).encode()
        metric = mh.valuation_metric(raw(payload), raw(detail), 'spx', '2026-10-13')
        self.assertEqual(metric['points'][-1], ['2026-10-13', 25.2089])
        self.assertEqual(metric['valuationBasis'], 'aggregate_ttm')
        self.assertEqual(metric['vintage'], 'latest_available')
        self.assertIn('逐成分股', metric['limitations'])
        for update in [dict(code='NDX.GI'), dict(metric='forward_pe'), dict(latest=26)]:
            with self.assertRaises(ValueError):
                mh.valuation_history(raw(dict(payload, **update)), 'spx', '2026-10-13')
        for value in [float('nan'), float('inf'), -1, 0, True, '25.2', None]:
            changed = copy.deepcopy(payload)
            changed['series'][0]['value'] = value
            with self.assertRaises(ValueError):
                mh.valuation_history(raw(changed), 'spx', '2026-10-13')
            with self.assertRaises(ValueError):
                mh.valuation_history(raw(dict(payload, latest=value)), 'spx', '2026-10-13')
            changed_detail = copy.deepcopy(detail)
            changed_detail['header']['value'] = value
            with self.assertRaises(ValueError):
                mh.valuation_metric(raw(payload), raw(changed_detail), 'spx', '2026-10-13')
            with self.assertRaises(ValueError):
                mh.check_source('jiucai-spx-detail', raw(changed_detail), '2026-10-13')
        detail['update_time'] = '2026-10-12'
        with self.assertRaisesRegex(ValueError, 'date or value mismatch'):
            mh.valuation_metric(raw(payload), raw(detail), 'spx', '2026-10-13')

    def test_rolling_provider_history_preserves_archived_prefix_with_original_provenance(self):
        # Begin with explicit old provenance, independent of how many rolling
        # prefixes the daily job has already archived in the published data.
        previous = {'sources': {'source': {'sha256': 'old-response'}}, 'context': {'id': 'macro', 'metrics': []},
                    'markets': [{'id': 'spx', 'metrics': [{'id': 'pe', 'source': 'source',
                        'points': [['2016-10-13', 20], ['2016-10-14', 21], ['2016-10-17', 22], ['2016-10-18', 23]],
                        'sourceRange': ['2016-10-13', '2016-10-18']}]}]}
        data = copy.deepcopy(previous)
        old = previous['markets'][0]['metrics'][0]
        current = data['markets'][0]['metrics'][0]
        current['points'] = current['points'][2:]
        current['sourceRange'] = [current['points'][0][0], current['points'][-1][0]]
        data['sources'][current['source']]['sha256'] = 'new-response'
        mh.retain_valuation_prefix(data, previous)
        self.assertEqual(current['points'], old['points'])
        self.assertEqual(current['archivedSources'][0]['sha256'], previous['sources'][old['source']]['sha256'])
        self.assertEqual(current['archivedSources'][0]['retainedThrough'], old['points'][1][0])
        mh.reject_regression(data, previous)
        next_report = copy.deepcopy(data)
        next_report['markets'][0]['metrics'][0]['points'] = current['points'][2:]
        mh.retain_valuation_prefix(next_report, data)
        self.assertEqual(next_report['markets'][0]['metrics'][0]['archivedSources'], current['archivedSources'])

    def test_published_pe_cannot_lose_method_or_latest_snapshot_evidence(self):
        published = json.loads(mh.OUTPUT.read_text())
        for field in ['valuationBasis', 'vintage', 'limitations', 'publisherCheck']:
            data = copy.deepcopy(published)
            del data['markets'][0]['metrics'][0][field]
            with self.assertRaises(ValueError):
                mh.validate(data)
        for value in [float('nan'), float('inf'), True, '25.2', None]:
            data = copy.deepcopy(published)
            data['markets'][0]['metrics'][0]['publisherCheck']['detailValue'] = value
            with self.assertRaises(ValueError):
                mh.validate(data)

    def test_parser_retains_estimate_and_negative_sign(self):
        raw = '<table><tr><td>Oct 13, 2026</td><td><abbr>†</abbr>26.64</td></tr><tr><td>Sep 30, 2025</td><td>−16.87%</td></tr></table>'.encode()
        points, estimates = mh.multpl(raw, '2026-10-13')
        self.assertEqual(points, [['2025-09-30', -16.87], ['2026-10-13', 26.64]])
        self.assertEqual(estimates, ['2026-10-13'])
        self.assertIsNone(mh.number('N/A'))

    def test_conflicting_dates_and_nonfinite_values(self):
        self.assertEqual(mh.normalize([['2025-01-01', float('nan')], ['2027-01-01', 4]], '2026-10-13'), [])
        with self.assertRaisesRegex(ValueError, 'Conflicting'):
            mh.normalize([['2025-01-01', 2], ['2025-01-01', 3]], '2026-10-13')

    def test_index_identity_and_missing_quotes(self):
        payload = {'chart': {'result': [{'meta': {'symbol': '^NDX', 'exchangeTimezoneName': 'America/New_York'},
            'timestamp': [1767304800, 1767391200], 'indicators': {'quote': [{'close': [100, None]}]}}]}}
        raw = json.dumps(payload).encode()
        self.assertEqual(len(mh.yahoo(raw, '^NDX', '2026-10-13')), 1)
        with self.assertRaisesRegex(ValueError, 'identity'):
            mh.yahoo(raw, '^GSPC', '2026-10-13')

    def test_trailing_calculations_with_known_path_and_no_lookahead(self):
        prices = [[(date(2020, 1, 1) + timedelta(days=i)).isoformat(), 100 * math.exp(.001 * i)] for i in range(300)]
        metrics = mh.price_metrics(prices)
        self.assertAlmostEqual(metrics['momentum'][-1][1], (math.exp(.252) - 1) * 100, places=5)
        self.assertEqual(metrics['drawdown'][-1][1], 0)
        self.assertEqual(metrics['rv21'][-1][1], 0)
        self.assertAlmostEqual(metrics['ma200'][-1][1], (prices[-1][1] / statistics.mean(p[1] for p in prices[-200:]) - 1) * 100, places=5)
        extended = mh.price_metrics(prices + [['2021-01-01', 1]])
        for key in metrics:
            self.assertEqual(metrics[key], extended[key][:-1])
        self.assertEqual(len(metrics['rv21']), 279)

    def test_invalid_live_responses_do_not_pass_source_guards(self):
        with self.assertRaises(ValueError):
            mh.check_source('multpl-pe', b'<html>temporarily unavailable</html>', '2026-10-13')
        with self.assertRaises(ValueError):
            mh.check_source('finviz-ndx', b'<table><tr><td>P/E</td><td>30</td></tr></table>', '2026-10-13')

    def test_treasury_archives_and_xml_keep_missing_values_missing(self):
        csv = b'date,10 yr\n10/13/2026,2.88\n10/14/2026,\n'
        self.assertEqual(mh.treasury(csv, '2026-10-14', '10 yr'), [['2026-10-13', 2.88]])
        xml = b'<?xml version="1.0"?><feed xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"><m:properties><d:NEW_DATE>2026-10-13T00:00:00</d:NEW_DATE><d:TC_10YEAR>-1.23</d:TC_10YEAR></m:properties></feed>'
        self.assertEqual(mh.treasury(xml, '2026-10-13', '10 yr', 'TC_10YEAR'), [['2026-10-13', -1.23]])

    def test_risk_statistics_match_manual_loss_distribution(self):
        prices = [['2020-01-01', 100]]
        returns = [-.02, -.01, 0, .01, .02, .03] * 42
        for i, value in enumerate(returns):
            prices.append([(date(2020, 1, 2) + timedelta(days=i)).isoformat(), prices[-1][1] * (1 + value)])
        metrics = mh.price_metrics(prices)
        self.assertAlmostEqual(metrics['var95'][-1][1], 2, places=5)
        self.assertAlmostEqual(metrics['es95'][-1][1], 2, places=5)
        self.assertAlmostEqual(metrics['downside'][-1][1], math.sqrt(42 * (.02 ** 2 + .01 ** 2)) * 100, places=5)
        window = [v for _, v in prices[-252:]]
        worst = min(window[j] / window[i] - 1 for i in range(len(window)) for j in range(i, len(window)))
        self.assertAlmostEqual(metrics['mdd252'][-1][1], worst * 100, places=5)

    def test_derived_spreads_use_exact_common_dates(self):
        self.assertEqual(mh.same_date([['2026-10-09', 5], ['2026-10-13', 6]], [['2026-10-12', 2], ['2026-10-13', 3]], lambda a, b: a - b), [['2026-10-13', 3]])

    def test_outage_retains_old_evidence_and_its_dates(self):
        previous = json.loads(mh.OUTPUT.read_text())
        data = copy.deepcopy(previous)
        data['markets'][1]['metrics'] = [m for m in data['markets'][1]['metrics'] if m['source'] != 'vxn']
        data['sources']['vxn'] = {'status': 'missing'}
        mh.retain_unavailable_sources(data, previous, {'vxn'})
        self.assertEqual(data['markets'][1]['metrics'], previous['markets'][1]['metrics'])
        self.assertEqual(data['sources']['vxn'], previous['sources']['vxn'])
        mh.validate(data)

    def test_outage_preserves_original_query_and_crosscheck_dates_across_report_days(self):
        previous = json.loads(mh.OUTPUT.read_text())
        data = copy.deepcopy(previous)
        data['asOf'] = (date.fromisoformat(previous['asOf']) + timedelta(days=1)).isoformat()
        data['crossChecks'] = []
        mh.retain_unavailable_sources(data, previous, {'finviz-ndx'})
        mh.validate(mh.curate_report(data))
        self.assertEqual(data['sources']['yahoo-ndx'], previous['sources']['yahoo-ndx'])
        self.assertEqual(data['crossChecks'][0], next(c for c in previous['crossChecks'] if c['id'] == 'ndx-close'))

    def test_published_evidence_valid_and_unverified_fundamentals_rejected(self):
        data = json.loads(mh.OUTPUT.read_text())
        mh.validate(data)
        data['markets'][1]['snapshots'] = [{'id': 'P/E', 'value': 29.3, 'percentile': None}]
        with self.assertRaisesRegex(ValueError, 'snapshots'):
            mh.validate(data)

    def test_estimates_and_changed_publishers_cannot_pass_publication(self):
        published = json.loads(mh.OUTPUT.read_text())
        for field, value in [('estimated', True), ('estimatedDates', ['2026-01-01']), ('caution', 'unverified')]:
            data = copy.deepcopy(published)
            data['markets'][0]['metrics'][0][field] = value
            # Selection must not strip warning flags to make a series pass.
            with self.assertRaisesRegex(ValueError, 'estimated or unverified'):
                mh.validate(mh.curate_report(data))
        data = copy.deepcopy(published)
        data['sources']['vix']['url'] = 'https://example.com/reposted-vix.csv'
        with self.assertRaisesRegex(ValueError, 'reviewed publisher'):
            mh.validate(data)

    def test_old_artifacts_cannot_reintroduce_withdrawn_pe_and_snapshots(self):
        data = json.loads(mh.OUTPUT.read_text())
        data['markets'][0]['metrics'].append(mh.metric('forward_pe', 'Forward PE', 'NTM', 'x', 'valuation', 'weekly',
            [['2026-08-05', 20.12]], 'sp-forward', 'undisclosed terminal'))
        data['sources']['sp-forward'] = {'url': 'https://example.com', 'status': 'available'}
        data['markets'][1]['snapshots'] = [{'id': 'P/E', 'value': 29.3}]
        with self.assertRaisesRegex(ValueError, 'essential series'):
            mh.validate(data)
        mh.validate(mh.curate_report(data))
        self.assertNotIn('sp-forward', data['sources'])
        self.assertFalse(data['markets'][1]['snapshots'])
        self.assertTrue(data['markets'][0]['withheld'])
        self.assertFalse(set(mh.source_specs(data['asOf'])) & {'sp-forward', 'ndx-forward', 'sp-profit', 'multpl-pe'})

    def test_truncated_history_cannot_replace_good_snapshot(self):
        previous = json.loads(mh.OUTPUT.read_text())
        data = copy.deepcopy(previous)
        data['markets'][0]['metrics'][0]['points'] = data['markets'][0]['metrics'][0]['points'][20:]
        with self.assertRaisesRegex(ValueError, 'regressed'):
            mh.reject_regression(data, previous)

    def test_price_history_identity_close_and_regression_guards(self):
        previous = json.loads(mh.OUTPUT.read_text())
        for field, value in [('symbol', 'SPY'), ('basis', 'etf_price'), ('source', 'yahoo-ndx'), ('currency', 'CNY')]:
            data = copy.deepcopy(previous)
            data['markets'][0]['prices'][field] = value
            with self.assertRaisesRegex(ValueError, 'price history identity'):
                mh.validate(data)
        data = copy.deepcopy(previous)
        data['markets'][0]['prices']['points'][-1][1] += 1
        with self.assertRaisesRegex(ValueError, 'does not match the displayed close'):
            mh.validate(data)
        data = copy.deepcopy(previous)
        data['markets'][0]['prices']['points'] = data['markets'][0]['prices']['points'][30:]
        with self.assertRaisesRegex(ValueError, 'price history regressed'):
            mh.reject_regression(data, previous)

    def test_price_outage_preserves_exact_history_and_original_source_metadata(self):
        previous = json.loads(mh.OUTPUT.read_text())
        data = copy.deepcopy(previous)
        market = data['markets'][0]
        market['close'] = None
        del market['prices']
        market['metrics'] = [m for m in market['metrics'] if m['source'] != 'yahoo-spx']
        data['sources']['yahoo-spx'] = {'status': 'missing'}
        mh.retain_unavailable_sources(data, previous, {'yahoo-spx'})
        mh.validate(data)
        self.assertEqual(market['prices'], previous['markets'][0]['prices'])
        self.assertEqual(market['close'], previous['markets'][0]['close'])
        self.assertEqual(data['sources']['yahoo-spx'], previous['sources']['yahoo-spx'])


if __name__ == '__main__':
    unittest.main()
