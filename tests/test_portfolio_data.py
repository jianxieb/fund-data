import hashlib
import json
import subprocess
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from scripts import build_portfolio_data as portfolio
import refresh
import update
from screens.fund_screen import parse_js_record


class PortfolioHistoryTests(unittest.TestCase):
    def test_preview_annual_returns_use_full_windows_and_actual_holding_days(self):
        start, end = date(2020, 10, 5), date(2025, 10, 6)
        series = []
        for n in range((end - start).days + 1):
            day = start + timedelta(days=n)
            if day.weekday() < 5:
                series.append([day.isoformat(), 100 * 1.1 ** (n / 365.2425)])
        preview = portfolio.performance_preview(series)
        for years in ('1', '3', '5'):
            self.assertAlmostEqual(preview['annual'][years]['value'], 10)
        self.assertEqual(preview['annual']['1']['start'], '2024-10-04')  # anniversary is Sunday
        self.assertEqual(preview['risk5']['mdd'], 0)
        self.assertFalse(preview['risk5']['partial'])
        # An observation weeks before the anniversary is not a valid window start.
        gapped = [r for r in series if not '2024-09-01' < r[0] < '2024-10-07']
        missing = portfolio.performance_preview(gapped)['annual']['1']
        self.assertIsNone(missing['value'])
        self.assertIn('起点前14日', missing['reason'])

    def test_preview_five_year_drawdown_excludes_older_losses_and_allows_short_history(self):
        start, end = date(2019, 1, 1), date(2026, 1, 1)
        series = []
        for n in range((end - start).days + 1):
            day = start + timedelta(days=n)
            if day.weekday() < 5:
                value = 250 if n == 0 else 80 if day >= date(2025, 12, 1) else 100
                series.append([day.isoformat(), value])
        self.assertAlmostEqual(portfolio.performance_preview(series)['risk5']['mdd'], -20)
        short = [['2026-09-%02d' % day, 2 if day == 1 else 1] for day in range(1, 21)]
        preview = portfolio.performance_preview(short)
        self.assertTrue(all(r['value'] is None for r in preview['annual'].values()))
        self.assertAlmostEqual(preview['risk5']['mdd'], -50)
        self.assertTrue(preview['risk5']['partial'])
        self.assertEqual(preview['risk5']['start'], '2026-09-01')

    def test_preview_and_history_must_reconcile_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(portfolio, 'ROOT', root), patch.object(portfolio, 'OUTPUT', root / 'data/portfolio'):
                row = portfolio.publish_history({'id': 'fund:000001', 'currency': 'CNY'},
                    [['2026-09-%02d' % day, day] for day in range(1, 11)],
                    'provider_daily_return_or_explicit_actions', 'https://example.test/nav')
                catalog = {'assets': [row], 'fx': {'missing': 'fixture has no FX'}}
                self.assertTrue(portfolio.validate_catalog(catalog, [row]))
                row['performance']['risk5']['mdd'] = -99
                with self.assertRaisesRegex(ValueError, '预览与每日历史不一致'):
                    portfolio.validate_catalog(catalog, [row])

    def test_published_catalog_covers_all_research_objects_with_valid_history_files(self):
        source = (portfolio.OUTPUT / 'catalog.js').read_text(encoding='utf-8')
        catalog = json.loads(source.split('=', 1)[1].strip().rstrip(';'))
        self.assertTrue(portfolio.validate_catalog(catalog, portfolio.universe()))
        self.assertTrue(all('performance' in row for row in catalog['assets'] if row['status'] == 'available'))
        self.assertEqual(catalog['summary']['total'], len(catalog['assets']))
        self.assertEqual(catalog['summary']['missing'], sum(row['status'] != 'available' for row in catalog['assets']))

    def test_only_explicit_same_nav_published_growth_can_fill_a_missing_rate(self):
        rows = [{'FSRQ': '2019-06-28', 'DWJZ': '1.229', 'JZZZL': '.2447'},
                {'FSRQ': '2019-06-30', 'DWJZ': '1.228', 'JZZZL': '--'}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.tmp-portfolio' / 'fund-trend' / '000001.json'
            path.parent.mkdir(parents=True)
            record = {'code': '000001', 'sourceUrl': 'https://fund.eastmoney.com/pingzhongdata/000001.js',
                      'points': [{'x': 1561824000000, 'y': 1.228, 'equityReturn': 0}]}
            path.write_text(json.dumps(record))
            with patch.object(portfolio, 'ROOT', Path(directory)), patch('urllib.request.urlopen') as network:
                observed = portfolio.supplement_published_growth('000001', rows, offline=True)
                self.assertEqual(observed[1]['JZZZL'], 0)
                self.assertEqual(observed[1]['JZZZL_SOURCE'], record['sourceUrl'])
                network.assert_not_called()
                record['points'][0]['y'] = 1.3
                path.write_text(json.dumps(record))
                unmatched = portfolio.supplement_published_growth('000001', rows, offline=True)
                self.assertEqual(unmatched[1]['JZZZL'], '--')
                with self.assertRaisesRegex(ValueError, '缺少每日收益'):
                    update.total_return_series(unmatched)

    def test_unproven_early_interval_is_not_pretended_to_be_a_full_history(self):
        rows = [{'FSRQ': '2024-01-01', 'DWJZ': '--'},
                {'FSRQ': '2024-01-02', 'DWJZ': '1', 'JZZZL': '0'},
                {'FSRQ': '2024-01-03', 'DWJZ': '1.1', 'JZZZL': '10'}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.tmp-hist' / '000001.json'
            path.parent.mkdir()
            path.write_text(json.dumps(rows))
            with patch.object(portfolio, 'ROOT', Path(directory)):
                series, basis, _, warning = portfolio.fund_history({'code': '000001', 'sourceUrl': 'https://example.com'}, offline=True)
        self.assertEqual(series, [('2024-01-02', 1), ('2024-01-03', 1.1)])
        self.assertIn('2024-01-02', warning)
        self.assertEqual(basis, 'provider_daily_return_or_explicit_actions')

    def test_wrong_currency_and_content_hash_fail_instead_of_loading_another_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'data' / 'portfolio' / 'fund' / '000001-abc.json'
            path.parent.mkdir(parents=True)
            history = dict(schemaVersion=1, id='fund:000001', currency='USD',
                           series=[['2024-01-01', 1], ['2024-01-02', 2]])
            path.write_text(json.dumps(history))
            row = dict(id='fund:000001', currency='CNY', status='available',
                       historyUrl='data/portfolio/fund/000001-abc.json', sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            with patch.object(portfolio, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, '身份'):
                    portfolio.validate_catalog({'assets': [row], 'fx': {'missing': 'fixture has no FX'}}, [row])
                row['sha256'] = '0' * 64
                with self.assertRaisesRegex(ValueError, '校验和'):
                    portfolio.validate_catalog({'assets': [row], 'fx': {'missing': 'fixture has no FX'}}, [row])

    def test_daily_refresh_uses_incremental_portfolio_stage_and_preserves_catalog_on_failure(self):
        self.assertIn('portfolio', refresh.DATASETS)
        self.assertLess(refresh.DATASETS.index('portfolio'), refresh.DATASETS.index('quality'))
        self.assertIn('--refresh', refresh.commands()['portfolio'])
        self.assertIn('--offline', refresh.commands(True)['portfolio'])
        self.assertNotIn('--refresh', refresh.commands(True)['portfolio'])
        self.assertEqual(refresh.PUBLISHED_OUTPUTS['portfolio'], ('portfolio/catalog.js', 'snapshot.js'))

    def test_risk_sync_uses_own_verified_path_and_preserves_return_and_nav_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            history_path = root / 'data/portfolio/fund/000001-test.json'
            history_path.parent.mkdir(parents=True)
            series = [['2026-09-%02d' % i, 2 if i == 1 else 1] for i in range(1, 11)]
            history = dict(id='fund:000001', currency='CNY', basis='provider_daily_return_or_explicit_actions', dividends='reinvested', series=series)
            history_path.write_text(json.dumps(history))
            asset = dict(code='000001', id='fund:000001', status='available', sourceUrl='https://example.test/own-nav',
                         historyUrl=history_path.relative_to(root).as_posix(), sha256=hashlib.sha256(history_path.read_bytes()).hexdigest())
            snapshot = root / 'snapshot.js'
            original = "/*__DATA_FUNDS_BEGIN__*/\nvar FUNDS=[\n{c:'000001',d:'2026-09-01',navdate:'2026-09-05',r:[1,null,null,null,null],returnAsOf:'2026-09-04'},\n];\n/*__DATA_FUNDS_END__*/\n/*__DATA_EXTRA_BEGIN__*/\nvar EXTRA=[];\n/*__DATA_EXTRA_END__*/\nvar STOCKS=['untouched'];\n"
            snapshot.write_text(original)
            with patch.object(portfolio, 'ROOT', root):
                result = portfolio.sync_fund_risk({'assets': [asset]}, snapshot)
                row = parse_js_record(next(line for line in snapshot.read_text().splitlines() if line.startswith('{')))
                self.assertEqual(result['updated'], 1)
                self.assertEqual(row['mdd5'], -50)
                self.assertEqual(row['riskAsOf'], '2026-09-10')
                self.assertTrue(row['risk5Period']['partial'])
                self.assertEqual(row['risk5Period']['start'], '2026-09-01')
                self.assertEqual(row['returnAsOf'], '2026-09-04')
                self.assertEqual(row['navdate'], '2026-09-05')
                self.assertEqual(row['r'], [1, None, None, None, None])
                self.assertIn("var STOCKS=['untouched']", snapshot.read_text())
                published = snapshot.read_bytes()
                self.assertEqual(portfolio.sync_fund_risk({'assets': [asset]}, snapshot)['updated'], 0)
                self.assertEqual(snapshot.read_bytes(), published)
                asset['sha256'] = '0' * 64
                with self.assertRaisesRegex(ValueError, '校验和'):
                    portfolio.sync_fund_risk({'assets': [asset]}, snapshot)

    def test_failed_stage_restores_catalog_and_keeps_its_immutable_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'data'
            published = data / 'portfolio' / 'catalog.js'
            history = data / 'portfolio' / 'fund' / '000001-old.json'
            history.parent.mkdir(parents=True)
            history.write_text('previous proven series')
            published.write_text('previous catalog')

            def partial(*args, **kwargs):
                published.write_text('incomplete catalog')
                (history.parent / '000001-new.json').write_text('new series')
                return subprocess.CompletedProcess(['fake'], 1, stdout='failed midway', stderr='')

            with patch.object(refresh, 'ROOT', root), patch.object(refresh, 'DATA', data), \
                    patch.object(refresh.subprocess, 'run', side_effect=partial), patch.object(refresh, 'write_status'):
                step = refresh.execute('portfolio', ['fake'], 5)
            self.assertTrue(step['publishedRollback'])
            self.assertEqual(published.read_text(), 'previous catalog')
            self.assertEqual(history.read_text(), 'previous proven series')


if __name__ == '__main__':
    unittest.main()
