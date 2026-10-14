import copy
from datetime import date, timedelta
import json
import math
from pathlib import Path
import statistics
import unittest

import market_history as mh


class MarketHistoryTests(unittest.TestCase):
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
        data['markets'][1]['metrics'] = [m for m in data['markets'][1]['metrics'] if m['source'] != 'ndx-forward']
        data['sources']['ndx-forward'] = {'status': 'missing'}
        mh.retain_unavailable_sources(data, previous, {'ndx-forward'})
        self.assertEqual(data['markets'][1]['metrics'], previous['markets'][1]['metrics'])
        self.assertEqual(data['sources']['ndx-forward'], previous['sources']['ndx-forward'])
        mh.validate(data)

    def test_published_evidence_valid_and_snapshot_ranks_rejected(self):
        data = json.loads(mh.OUTPUT.read_text())
        mh.validate(data)
        data['markets'][1]['snapshots'][0]['percentile'] = 50
        with self.assertRaisesRegex(ValueError, 'Snapshots'):
            mh.validate(data)

    def test_truncated_history_cannot_replace_good_snapshot(self):
        previous = json.loads(mh.OUTPUT.read_text())
        data = copy.deepcopy(previous)
        data['markets'][0]['metrics'][0]['points'] = data['markets'][0]['metrics'][0]['points'][20:]
        with self.assertRaisesRegex(ValueError, 'regressed'):
            mh.reject_regression(data, previous)


if __name__ == '__main__':
    unittest.main()
