import copy
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import stock_screen
from stock_earnings import margin_bridge, profit_bridge, unit_bridge, contribution_residual
from stock_fundamentals import quality_review
from stock_groups import growth_review, operating_review
from scripts.build_stock_reports import report_row
from scripts.build_stock_stage_review import build

ROOT = Path(__file__).resolve().parents[1]


class AttributionTests(unittest.TestCase):
    def test_quantity_price_and_cost_reconcile_with_cost_increases_negative(self):
        record = {'label': 'test', 'quantityBasis': 'sales', 'comparable': True,
                  'quantityUnit': 'tonne', 'priceQuantityUnit': 'tonne',
                  'previous': {'quantity': 100, 'price': 10, 'unitCost': 6},
                  'current': {'quantity': 120, 'price': 12, 'unitCost': 7}}
        bridge = unit_bridge(record)
        self.assertEqual([bridge[k] for k in ('volumeEffect', 'priceMixEffect', 'unitCostEffect')], [80, 240, -120])
        self.assertEqual(bridge['grossProfitChange'], 200)
        for change in ({'quantityBasis': 'production'}, {'comparable': False}, {'priceQuantityUnit': 'kg'}):
            self.assertIsNone(unit_bridge({**record, **change}))
        for value in (None, float('nan'), float('inf'), True):
            invalid = copy.deepcopy(record)
            invalid['current']['price'] = value
            self.assertIsNone(unit_bridge(invalid))

    def test_revenue_scale_and_margin_are_not_volume_and_price(self):
        bridge = margin_bridge({'revenue': 100, 'cost': 60}, {'revenue': 120, 'cost': 60})
        self.assertAlmostEqual(bridge['revenueScaleEffect'], 8)
        self.assertAlmostEqual(bridge['marginEffect'], 12)
        self.assertAlmostEqual(bridge['grossProfitChange'], 20)
        self.assertIsNone(margin_bridge({'revenue': 0, 'cost': 1}, {'revenue': 120, 'cost': 60}))
        self.assertIsNone(margin_bridge({'revenue': 100, 'cost': None}, {'revenue': 120, 'cost': 60}))

    def test_gross_profit_tax_minority_and_nonrecurring_sum_to_core(self):
        previous = {'revenue': 100, 'cost': 60, 'profitBeforeTax': 30, 'incomeTax': 5,
                    'netProfit': 20, 'deductedProfit': 18}
        current = {'revenue': 120, 'cost': 60, 'profitBeforeTax': 45, 'incomeTax': 8,
                   'netProfit': 30, 'deductedProfit': 29}
        b = profit_bridge(previous, current)
        self.assertEqual([b[k] for k in ('grossProfitChange', 'otherProfitEffect', 'taxEffect',
                                        'minorityEffect', 'nonRecurringEffect')], [20, -5, -3, -2, 1])
        self.assertEqual(sum(v for k, v in b.items() if k != 'coreProfitChange'), 11)
        self.assertEqual(b['coreProfitChange'], 11)
        self.assertIsNone(profit_bridge(previous, {**current, 'incomeTax': None}))

    def test_attributable_contribution_is_subtracted_once_and_bad_base_is_unknown(self):
        result = contribution_residual(824554019.49, 508000000, 26649378.25)
        self.assertAlmostEqual(result['residual'], 316554019.49)
        self.assertAlmostEqual(result['growth'], 1087.8476732942)
        self.assertIsNone(contribution_residual(10, 5, -1)['growth'])
        self.assertIsNone(contribution_residual(10, None, 1))

    def test_all_frozen_earnings_bridges_reconcile_with_dated_reports(self):
        records = json.loads((ROOT / 'data/stock-earnings-research.json').read_text())['companies']
        for r in records:
            with self.subTest(code=r['code']):
                d = json.loads((ROOT / 'company-report/data' / r['code'] / 'summary.json').read_text())
                current = d['reports'][0]
                prior = next(x for x in d['reports'] if x['reportDate'] == '2025-06-30')
                self.assertEqual(r['marginBridge'], margin_bridge(prior, current))
                self.assertEqual(r['profitBridge'], profit_bridge(prior, current))
                b = r['profitBridge']
                self.assertAlmostEqual(sum(v for k, v in b.items() if k != 'coreProfitChange'), b['coreProfitChange'], places=4)
                for u in r['unitInputs']:
                    b = unit_bridge(u)
                    self.assertIsNotNone(b)
                    self.assertAlmostEqual(sum(b[k] for k in ('volumeEffect', 'priceMixEffect', 'unitCostEffect')),
                                           b['grossProfitChange'], places=4)

    def test_low_revenue_growth_no_longer_rejects_but_profit_decline_still_does(self):
        d = json.loads((ROOT / 'company-report/data/601899/summary.json').read_text())
        row = report_row(d)
        self.assertLess(row['latestFinancials']['revenueGrowth'], 20)
        self.assertTrue(row['longTermReview']['qualified'])
        self.assertTrue(row['growthReview']['qualified'])
        row['latestFinancials']['revenueGrowth'] = -20
        row['financialGrowth3']['revenue'] = -10
        self.assertTrue(quality_review(row, d['asOf'])['qualified'])
        self.assertTrue(growth_review(row, d['asOf'])['qualified'])
        row['latestFinancials']['deductedProfitGrowth'] = -80
        self.assertFalse(quality_review(row, d['asOf'])['qualified'])
        self.assertFalse(growth_review(row, d['asOf'])['qualified'])
        row['latestFinancials']['revenue'] = None
        self.assertFalse(quality_review(row, d['asOf'])['recentChecks'][2]['pass'])

    def test_growth_requires_current_numeric_evidence_bound_to_known_disclosure(self):
        d = json.loads((ROOT / 'company-report/data/601899/summary.json').read_text())
        for change in ('missing', 'future', 'stale', 'unknown_source', 'unpublished_source', 'no_value', 'no_page', 'boolean'):
            row = report_row(copy.deepcopy(d))
            self.assertTrue(growth_review(row, d['asOf'])['qualified'])
            e = row['qualityResearch']['earningsReview']
            if change == 'missing': row['qualityResearch'].pop('earningsReview')
            if change == 'future': e['checkedAt'] = '2026-10-02'
            if change == 'stale': e['reportPeriod'] = '2025-12-31'
            if change == 'unknown_source': e['quantitativeEvidence'][0]['sourceUrl'] = 'https://example.test/unknown'
            if change == 'unpublished_source': row['qualityResearch']['sources'][0]['publishedAt'] = '2026-10-02'
            if change == 'no_value': e['quantitativeEvidence'][0]['value'] = None
            if change == 'no_page': e['quantitativeEvidence'][0]['sourcePages'] = ''
            if change == 'boolean': e['quantitativeEvidence'][0]['value'] = True
            self.assertFalse(operating_review(row, d['asOf'], 'growth')[1]['pass'], change)

    def test_breakout_coverage_is_complete_without_claiming_all_growth_was_reviewed(self):
        discovery = json.loads((ROOT / 'docs/research/stock-stages-discovery-2026-10-01.json').read_text())
        research = json.loads((ROOT / 'data/stock-earnings-research.json').read_text())
        audit = build(discovery, research)
        self.assertEqual(audit, json.loads((ROOT / 'docs/research/stock-stages-review-2026-10-01.json').read_text()))
        self.assertEqual(audit['coverage']['financialBreakoutLeads'], 30)
        self.assertEqual(audit['coverage']['pendingBreakoutLeads'], 0)
        self.assertGreater(audit['coverage']['pendingFinancialLeads'], 0)
        self.assertTrue(all(not r['publishedGroups'] for r in audit['records'] if r['businessStatus'] != 'reviewed'))


class ShortPriceHistoryTests(unittest.TestCase):
    def test_delayed_history_keeps_newer_returns_without_reverting_financial_update(self):
        prior = {'returnAsOf': '2026-09-30', 'riskAsOf': '2026-09-30', 'latest': '2026-09-30',
                 'r': [1, 2, 3, 4, 5], 'historySource': 'source A', 'returnBasis': 'adjusted',
                 'historyFirst': '2010-01-01', 'sourceUrl': 'https://example.test/a', 'mdd5': -20,
                 'vol5': 30, 'returnPeriods': [{'end': '2026-09-30'}]}
        refreshed = {'returnAsOf': '2026-09-29', 'riskAsOf': '2026-09-29', 'latest': '2026-09-29',
                     'r': [0, 1, 2, 3, 4], 'historySource': 'source B', 'price': 10,
                     'valuationAsOf': '2026-09-30', 'latestFinancials': {'netProfit': 100}}
        result = stock_screen.retain_newer_history(refreshed, prior)
        for key in prior:
            self.assertEqual(result[key], prior[key])
        self.assertEqual(result['price'], 10)
        self.assertEqual(result['latestFinancials']['netProfit'], 100)
        newer = {**refreshed, 'returnAsOf': '2026-10-01'}
        self.assertEqual(stock_screen.retain_newer_history(copy.deepcopy(newer), prior), newer)

    def payload(self):
        return {'chart': {'result': [{'meta': {'symbol': '688808.SS', 'currency': 'CNY'},
                 'timestamp': [int(datetime(2026, 4, 24, tzinfo=timezone.utc).timestamp()),
                               int(datetime(2026, 9, 29, tzinfo=timezone.utc).timestamp())],
                 'indicators': {'adjclose': [{'adjclose': [100, 110]}]}}]}}

    def test_new_ipo_history_is_retained_with_unavailable_long_windows(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(stock_screen, 'YAHOO_CACHE', directory), \
                patch.object(stock_screen, 'fetch_json', return_value=self.payload()):
            series = stock_screen.yahoo_stock('688808')['series']
        self.assertEqual(len(series), 2)
        self.assertIsNone(stock_screen.window_return(series, series[-1][0], 1))
        self.assertTrue(all(p['start'] is None for p in stock_screen.return_periods(series, series[-1][0])))
        self.assertEqual(stock_screen.risk_metrics(series, series[-1][0]), (None, None))

    def test_short_history_still_requires_instrument_currency_and_two_valid_prices(self):
        for change in ('identity', 'currency', 'missing_adjusted', 'one_price', 'infinite'):
            p = self.payload();node = p['chart']['result'][0]
            if change == 'identity': node['meta']['symbol'] = '688766.SS'
            if change == 'currency': node['meta']['currency'] = 'USD'
            if change == 'missing_adjusted': node['indicators'] = {}
            if change == 'one_price': node['indicators']['adjclose'][0]['adjclose'][1] = None
            if change == 'infinite': node['indicators']['adjclose'][0]['adjclose'][1] = float('inf')
            with patch.object(stock_screen, 'fetch_json', return_value=p):
                with self.assertRaises(RuntimeError, msg=change):
                    stock_screen.yahoo_stock('688808')


if __name__ == '__main__':
    unittest.main()
