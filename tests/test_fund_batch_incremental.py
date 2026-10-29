import hashlib
import io
import json
import os
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from scripts import fund_batch as batch
from scripts import build_portfolio_data as portfolio


class FundBatchTests(unittest.TestCase):
    def test_observation_checks_identity_date_and_return_instead_of_inventing_zero(self):
        row = dict(FCODE='000001', PDATE='2026-10-26', NAV='2', NAVCHGRT='0')
        result = batch.observation(row, {'000001'}, date(2026, 10, 27))
        self.assertEqual((result['DWJZ'], result['JZZZL']), (2, 0))
        for changed in ({'FCODE': '000002'}, {'PDATE': '2099-01-01'}, {'NAV': '0'},
                        {'NAVCHGRT': None}, {'NAVCHGRT': 'nan'}, {'NAVCHGRT': '-100'}):
            with self.subTest(changed=changed), self.assertRaises((ValueError, TypeError)):
                batch.observation({**row, **changed}, {'000001'}, date(2026, 10, 27))

    def test_batch_fetch_keeps_valid_symbols_when_another_symbol_is_invalid(self):
        payload = {'ErrCode': 0, 'Datas': [
            dict(FCODE='000001', PDATE='2026-10-26', NAV='2', NAVCHGRT='0'),
            dict(FCODE='000002', PDATE='2026-10-26', NAV=None, NAVCHGRT=None)]}
        with patch.object(batch.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(payload).encode())):
            rows, failures, source = batch.fetch(['000001', '000002'])
        self.assertEqual(set(rows), {'000001'})
        self.assertEqual(set(failures), {'000002'})
        self.assertEqual(source['records'], 1)

    def test_same_nav_and_date_reuse_history_but_missing_days_require_history_endpoint(self):
        rows = [dict(FSRQ='2026-10-23', DWJZ='2', JZZZL='0')]
        with patch.object(batch, 'latest', return_value=dict(FSRQ='2026-10-23', DWJZ=2, JZZZL=0)):
            self.assertIs(batch.cached_tail('000001', rows), rows)
        with patch.object(batch, 'latest', return_value=dict(FSRQ='2026-10-24', DWJZ=.4, JZZZL=0)):
            self.assertEqual(batch.cached_tail('000001', rows)[0]['DWJZ'], .4)
        with patch.object(batch, 'latest', return_value=dict(FSRQ='2026-10-26', DWJZ=2.1, JZZZL=1)):
            self.assertIsNone(batch.cached_tail('000001', rows))

    def test_a_previous_run_batch_is_not_reused_as_a_current_network_observation(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'quotes.json'
            path.write_text(json.dumps({'token': 'old-run', 'rows': {'000001': {'FSRQ': '2026-10-23'}}}))
            with patch.object(batch, 'CACHE', path), patch.dict(os.environ, {'FUND_DATA_REFRESH_TOKEN': 'new-run'}):
                batch._load.cache_clear()
                self.assertIsNone(batch.latest('000001'))
            batch._load.cache_clear()

    def test_weekend_shortcut_requires_matching_nav_and_excludes_period_boundary_or_money_funds(self):
        old = [dict(FSRQ='2026-10-23', DWJZ='2', JZZZL='0')]
        quote = dict(FSRQ='2026-10-26', DWJZ=2.01, JZZZL=.5)
        self.assertTrue(batch.ordinary_weekend('2026-10-23', quote, old, {'name': '普通基金'}))
        self.assertFalse(batch.ordinary_weekend('2026-10-23', {**quote, 'DWJZ': .4}, old, {}))
        self.assertFalse(batch.ordinary_weekend('2026-10-23', quote, old, {'name': '货币基金'}))
        self.assertFalse(batch.ordinary_weekend('2026-01-30', {**quote, 'FSRQ': '2026-02-02'},
            [dict(FSRQ='2026-01-30', DWJZ='2')], {}))

    def test_batch_keeps_original_dated_observations_after_a_failed_history_run(self):
        old = {'rows': {'000001': dict(FCODE='000001', FSRQ='2026-10-27', DWJZ=2, JZZZL=1)}}
        new = {'000001': dict(FCODE='000001', FSRQ='2026-10-28', DWJZ=2.02, JZZZL=1)}
        history = batch.merge_history(old, new, '2026-10-29T01:00:00+00:00', [])
        self.assertEqual([r['FSRQ'] for r in history['000001']], ['2026-10-27', '2026-10-28'])
        self.assertEqual(history['000001'][-1]['sourceObservedAt'], '2026-10-29T01:00:00+00:00')
        self.assertNotIn('sourceObservedAt', history['000001'][0])

    def test_a_newer_nav_does_not_hide_the_saved_observation_at_the_history_limit(self):
        newer = dict(FCODE='000001', FSRQ='2026-10-29', DWJZ=2.1, JZZZL=1)
        yesterday = dict(FCODE='000001', FSRQ='2026-10-28', DWJZ=2.0, JZZZL=1)
        with patch.object(batch, '_load', return_value={'000001': newer}), patch.object(batch, 'recent', return_value=[yesterday]):
            self.assertEqual(batch.latest('000001', '2026-10-28'), yesterday)


class IncrementalFundHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for target, value in [('ROOT', self.root), ('OUTPUT', self.root / 'data/portfolio')]:
            patcher = patch.object(portfolio, target, value)
            patcher.start(); self.addCleanup(patcher.stop)
        self.asset = dict(id='fund:000001', code='000001', currency='CNY', name='fixture')
        patcher = patch.object(batch, 'ROOT', self.root)
        patcher.start(); self.addCleanup(patcher.stop)
        self.previous = portfolio.publish_history(self.asset, [['2026-10-21', 1.9], ['2026-10-22', 2]],
            'provider_daily_return_or_explicit_actions', 'https://fund.eastmoney.com/000001.html')

    def test_one_day_uses_published_total_return_even_when_unit_nav_splits(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-23', DWJZ=.4, JZZZL=0)
        with patch.object(batch, 'latest', return_value=quote), patch.object(portfolio, 'fund_request') as request:
            row = portfolio.incremental_fund(self.asset, self.previous)
        request.assert_not_called()
        history = json.loads((self.root / row['historyUrl']).read_text())
        self.assertEqual(history['series'], [['2026-10-21', 1.9], ['2026-10-22', 2], ['2026-10-23', 2]])
        self.assertEqual(row['navObservation'], dict(nav=.4, navdate='2026-10-23', dz=0))
        self.assertEqual(json.loads((self.root / self.previous['historyUrl']).read_text())['asOf'], '2026-10-22')

    def test_gap_fetches_tail_and_requires_an_overlap_with_verified_history(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-26', DWJZ=2.2, JZZZL=10)
        raw = [dict(FSRQ='2026-10-22', DWJZ='2', JZZZL='0'),
               dict(FSRQ='2026-10-23', DWJZ='2.1', JZZZL='5'),
               dict(FSRQ='2026-10-26', DWJZ='2.2', JZZZL='10')]
        with patch.object(batch, 'latest', return_value=quote), patch.object(portfolio, 'fund_request', return_value=raw) as request:
            row = portfolio.incremental_fund(self.asset, self.previous)
        request.assert_called_once_with('000001', 20)
        history = json.loads((self.root / row['historyUrl']).read_text())
        self.assertAlmostEqual(history['series'][-1][1], 2 * 1.05 * 1.10)
        with patch.object(batch, 'latest', return_value=quote), patch.object(portfolio, 'fund_request', return_value=raw[1:]):
            self.assertIsNone(portfolio.incremental_fund(self.asset, self.previous))

    def test_two_missed_weekdays_use_saved_official_returns_without_per_fund_requests(self):
        previous = portfolio.publish_history(self.asset, [['2026-10-23', 1.9], ['2026-10-26', 2]],
            'provider_daily_return_or_explicit_actions', 'https://fund.eastmoney.com/000001.html')
        previous['navObservation'] = dict(nav=2, navdate='2026-10-26', dz=0)
        tail = [dict(FCODE='000001', FSRQ='2026-10-26', DWJZ=2, JZZZL=0),
                dict(FCODE='000001', FSRQ='2026-10-27', DWJZ=2.01, JZZZL=.5),
                dict(FCODE='000001', FSRQ='2026-10-28', DWJZ=.41, JZZZL=2)]
        with patch.object(batch, 'latest', return_value=tail[-1]), patch.object(batch, 'recent', return_value=tail), \
                patch.object(portfolio, 'fund_request') as request:
            row = portfolio.incremental_fund(self.asset, previous)
        request.assert_not_called()
        history = json.loads((self.root / row['historyUrl']).read_text())
        self.assertAlmostEqual(history['series'][-1][1], 2 * 1.005 * 1.02)
        self.assertEqual(row['asOf'], '2026-10-28')
        with patch.object(batch, 'recent', return_value=[tail[0], tail[2]]):
            self.assertIsNone(batch.verified_weekday_tail('000001', '2026-10-26', '2026-10-28', tail[-1], previous))
        with patch.object(batch, 'recent', return_value=tail):
            self.assertIsNone(batch.verified_weekday_tail('000001', '2026-10-26', '2026-10-28', tail[-1],
                {**previous, 'navObservation': dict(nav=3, navdate='2026-10-26')}))

    def test_saved_raw_tail_confirmed_by_batch_quote_is_not_requested_again(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-26', DWJZ=2.2, JZZZL=10)
        raw = [dict(FSRQ='2026-10-26', DWJZ=2.2, JZZZL=10),
               dict(FSRQ='2026-10-23', DWJZ=2, JZZZL=0),
               dict(FSRQ='2026-10-22', DWJZ=2, JZZZL=0)]
        with patch.object(batch, 'latest', return_value=quote), patch.object(batch, 'cached_rows', return_value=raw), \
                patch.object(portfolio, 'fund_request') as request:
            row = portfolio.incremental_fund(self.asset, self.previous)
        request.assert_not_called()
        history = json.loads((self.root / row['historyUrl']).read_text())
        self.assertEqual(history['series'][-1], ['2026-10-26', 2.2])

    def test_cached_explicit_cash_distribution_keeps_precedence_over_rounded_daily_return(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-26', DWJZ=1.8, JZZZL=9.52)
        raw = [dict(FSRQ='2026-10-26', DWJZ=1.8, JZZZL=9.52, FHFCZ=.5, SPLIT_FACTOR=1),
               dict(FSRQ='2026-10-23', DWJZ=2.1, JZZZL=5),
               dict(FSRQ='2026-10-22', DWJZ=2, JZZZL=0)]
        with patch.object(batch, 'latest', return_value=quote), patch.object(batch, 'cached_rows', return_value=raw), \
                patch.object(portfolio, 'fund_request') as request:
            row = portfolio.incremental_fund(self.asset, self.previous)
        request.assert_not_called()
        history = json.loads((self.root / row['historyUrl']).read_text())
        self.assertEqual(history['series'][-1], ['2026-10-26', 2.3])

    def test_unchanged_date_reuses_verified_file_without_rebuilding_it(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-22', DWJZ=2, JZZZL=5.26)
        with patch.object(batch, 'latest', return_value=quote), patch.object(portfolio, 'fund_request') as request:
            row = portfolio.incremental_fund(self.asset, self.previous)
        request.assert_not_called()
        self.assertEqual(row['sha256'], self.previous['sha256'])
        self.assertEqual(row['asOf'], '2026-10-22')

    def test_lagging_batch_cannot_hide_a_newer_already_published_fund_observation(self):
        quote = dict(FCODE='000001', FSRQ='2026-10-22', DWJZ=2, JZZZL=0)
        raw = [dict(FSRQ='2026-10-22', DWJZ='2', JZZZL='0'),
               dict(FSRQ='2026-10-23', DWJZ='2.1', JZZZL='5')]
        with patch.object(batch, 'latest', return_value=quote), patch.object(portfolio, 'fund_request', return_value=raw) as request:
            row = portfolio.incremental_fund({**self.asset, 'knownThrough': '2026-10-23'}, self.previous)
        request.assert_called_once_with('000001', 20)
        self.assertEqual(row['asOf'], '2026-10-23')

    def test_wrong_history_identity_is_not_used_for_a_new_fund_return(self):
        path = self.root / self.previous['historyUrl']
        history = json.loads(path.read_text()); history['id'] = 'fund:999999'
        path.write_text(json.dumps(history))
        self.previous['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        with patch.object(batch, 'latest', return_value=dict(FSRQ='2026-10-23', DWJZ=2, JZZZL=0)), \
                self.assertRaisesRegex(ValueError, '身份'):
            portfolio.incremental_fund(self.asset, self.previous)

    def test_verified_fund_sync_uses_new_history_once_and_preserves_original_fee_audit(self):
        (self.root / 'data').mkdir(exist_ok=True)
        evidence = dict(code='000001', asof='2026-10-21', checkedAt='2026-09-01', fees=[.1, .2, 0])
        path = self.root / 'data/screening-validation.json'
        path.write_text(json.dumps([evidence]))
        catalog = {'assets': [{**self.previous, 'navObservation': dict(nav=2, navdate='2026-10-22', dz=0)}]}
        (portfolio.OUTPUT / 'catalog.js').write_text('var PORTFOLIO_CATALOG=' + json.dumps(catalog) + ';')
        row = dict(c='000001', returnAsOf='2026-10-22', returnFirst='2026-10-21', r=[None] * 5,
                   returnBasis='provider_daily_return_or_explicit_actions', returnPeriods=[],
                   nav=2, navdate='2026-10-22', dz=0)
        with patch('screens.fund_screen.parse_snapshot_extra', return_value=[row]), \
                patch.object(portfolio, 'write_status') as status:
            self.assertEqual(portfolio.sync_verified_evidence(), 0)
        current = json.loads(path.read_text())[0]
        self.assertEqual(current['asof'], '2026-10-22')
        self.assertEqual(current['checkedAt'], evidence['checkedAt'])
        self.assertEqual(current['fees'], evidence['fees'])
        self.assertEqual(current['historySha256'], self.previous['sha256'])
        self.assertEqual(status.call_args.args[:2], ('research_funds', 'success'))
        with patch('screens.fund_screen.parse_snapshot_extra', return_value=[row]), \
                patch.object(batch, 'latest', return_value=dict(FSRQ='2026-10-23')), \
                patch.object(portfolio, 'write_status') as status:
            self.assertEqual(portfolio.sync_verified_evidence(), 0)
        self.assertEqual(json.loads(path.read_text())[0], current)
        self.assertEqual(status.call_args.args[:2], ('research_funds', 'partial'))
        self.assertIn('收益历史仍截至2026-10-22', status.call_args.kwargs['failures']['000001'])


if __name__ == '__main__':
    unittest.main()
