import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import refresh
import update
from screens import fund_screen as screening


class FundStageFailures(unittest.TestCase):
    def run_update(self, history_ok=True, is_etf=False):
        metrics = dict(r=[1] * 5, v3=15, mdd3=-20, vol5=16, mdd5=-30,
                       risk3First='2023-09-28', risk5First='2021-09-28', risk5Status='complete',
                       asOf='2026-09-29', periods=[], riskStart='2021-09-28',
                       first='2010-01-01', basis='provider_daily_return_or_explicit_actions')
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            source = Path(tmp) / 'snapshot.js'
            source.write_text('fixture')
            for name in ('FHSP_DIR', 'HIST_DIR', 'SNAP_DIR', 'MANAGER_DIR'):
                stack.enter_context(patch.object(update, name, tmp))
            fixtures = dict(HTML=str(source), read_old_meta={}, parse_fund_lines=[('fixture', '000001', is_etf)],
                            history_fetch=[dict(FSRQ='2026-09-29', DWJZ='1.5', JZZZL='0.2')],
                            calc_metrics=metrics if history_ok else None, fund_mnfinfo={}, tencent_etf={},
                            manager_fetch=dict(managerDataStatus='unavailable'), jjfl_fetch={})
            for name, value in fixtures.items():
                stack.enter_context(patch.object(update, name, value) if name == 'HTML'
                                    else patch.object(update, name, return_value=value))
            stack.enter_context(patch('sys.argv', ['update.py', '--quick']))
            stack.enter_context(patch.object(update, 'log'))
            writer = stack.enter_context(patch.object(update, 'write_patches', return_value=True))
            status = stack.enter_context(patch.object(update, 'write_status'))
            code = update.main()
            return code, writer.call_args.args[0]['000001'], status.call_args.kwargs

    def test_metadata_failure_keeps_valid_performance_publishable(self):
        code, changes, status = self.run_update()
        self.assertEqual(code, 0)
        self.assertEqual(changes['returnAsOf'], "'2026-09-29'")
        self.assertEqual(status['failures'], [])
        self.assertEqual(status['metadataWarnings'], ['000001:manager', '000001:profile'])
        self.assertNotIn('managerAsOf', changes)
        self.assertNotIn('szdate', changes)

    def test_history_failure_still_rejects_fund_stage(self):
        code, changes, status = self.run_update(history_ok=False)
        self.assertEqual(code, 3)
        self.assertEqual(status['failures'], ['000001:history'])
        self.assertNotIn('returnAsOf', changes)

    def test_missing_quote_keeps_its_prior_price_and_date(self):
        code, changes, status = self.run_update(is_etf=True)
        self.assertEqual(code, 0)
        self.assertIn('000001:quote', status['metadataWarnings'])
        self.assertNotIn('p', changes)
        self.assertNotIn('quotedAt', changes)


class ResearchFundDailyRefresh(unittest.TestCase):
    def run_refresh(self, fail_code=None, source_day='2026-09-29'):
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            directory = Path(tmp) / 'data'
            directory.mkdir()
            evidence_path = directory / 'screening-validation.json'
            evidence_path.write_text(json.dumps([dict(code=code, asof='2026-09-21', oldAsOf='2026-09-16',
                                                     checkedAt='2026-09-22T00:00:00Z', fees=[.4, .1, 0],
                                                     feeSource='original-fee-source')
                                                 for code in ('000001', '000002')]))
            records = [dict(c=code, n=code, r=[1] * 5, mdd5=-20, vol5=15,
                            returnAsOf='2026-09-21', riskAsOf='2026-09-21', navdate='2026-09-21')
                       for code in ('000001', '000002')]
            metric = dict(first='2010-01-01', latest=source_day, rows=3000, periods=[],
                          basis='provider_daily_return_or_explicit_actions', ret1=2, ret2=3, ret3=4,
                          ret5=5, ret10=6, mdd5=-21, vol5=16, risk5First='2021-09-28')

            def history(code):
                if code == fail_code:
                    raise ValueError('净值源缺完整历史')
                return [dict(FSRQ=source_day, DWJZ='1.5', JZZZL='0.2')]

            stack.enter_context(patch.object(screening, 'ROOT', tmp))
            stack.enter_context(patch.object(screening, 'ensure_dirs'))
            stack.enter_context(patch.object(screening, 'parse_snapshot_extra', return_value=records))
            stack.enter_context(patch.object(screening.U, 'history_fetch', side_effect=history))
            stack.enter_context(patch.object(screening, 'deep_metrics', return_value=metric))
            stack.enter_context(patch.object(screening, 'get', side_effect=AssertionError('fee metadata must not be fetched')))
            stack.enter_context(patch.object(screening, 'log'))
            writer = stack.enter_context(patch.object(screening, 'write_extra_fields'))
            status = stack.enter_context(patch.object(screening, 'write_status'))
            error = None
            try:
                screening.cmd_refresh_performance(SimpleNamespace(codes='verified', workers=2, offline=False))
            except RuntimeError as exc:
                error = str(exc)
            return error, writer.call_args, json.loads(evidence_path.read_text()), status.call_args

    def test_refresh_updates_both_dates_and_preserves_dated_fee_audit(self):
        error, call, evidence, status = self.run_refresh()
        self.assertIsNone(error)
        for row in call.args[0].values():
            self.assertEqual(row['returnAsOf'], '2026-09-29')
            self.assertEqual(row['riskAsOf'], '2026-09-29')
            self.assertEqual(row['navdate'], '2026-09-29')
            self.assertNotIn('fee', row)
            self.assertNotIn('feeCheckedAt', row)
        self.assertEqual(evidence[0]['checkedAt'], '2026-09-22T00:00:00Z')
        self.assertEqual(evidence[0]['feeSource'], 'original-fee-source')
        self.assertEqual(evidence[0]['oldAsOf'], '2026-09-16')
        self.assertEqual(evidence[0]['asof'], '2026-09-29')
        self.assertEqual(status.kwargs['records'], 2)

    def test_failed_history_cannot_partially_replace_published_evidence(self):
        error, call, evidence, status = self.run_refresh(fail_code='000002')
        self.assertIn('000002', error)
        self.assertIsNone(call)
        self.assertEqual(evidence[0]['asof'], '2026-09-21')
        self.assertIn('000002', status.kwargs['failures'])

    def test_old_source_date_cannot_replace_verified_returns(self):
        error, call, evidence, status = self.run_refresh(source_day='2026-09-18')
        self.assertIn('来源日期倒退', error)
        self.assertIsNone(call)
        self.assertEqual(evidence[0]['asof'], '2026-09-21')

    def test_scheduled_and_offline_entrypoints_include_verified_performance(self):
        self.assertIn('research_funds', refresh.DATASETS)
        self.assertIn('refresh-performance', refresh.commands()['research_funds'])
        self.assertIn('--offline', refresh.commands(True)['research_funds'])
        self.assertIn('screening-validation.json', refresh.PUBLISHED_OUTPUTS['research_funds'])


if __name__ == '__main__':
    unittest.main()
