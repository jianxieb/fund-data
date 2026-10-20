import hashlib
import json
import unittest
from pathlib import Path

import annual_fees
import update


ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ('VOO', 'IVV', 'BOXX')


class AddedEtfDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        block = (ROOT / 'data/snapshot.js').read_text().split('/*__DATA_BM_BEGIN__*/', 1)[1].split('/*__DATA_BM_END__*/', 1)[0]
        cls.benchmarks = {row['n']: row for row in (
            json.loads(line.rstrip(',')) for line in block.splitlines() if line.startswith('{'))}
        catalog = json.loads((ROOT / 'data/portfolio/catalog.js').read_text().split('=', 1)[1].strip().rstrip(';'))
        cls.assets = {row['code']: row for row in catalog['assets'] if row['id'].startswith('us:')}
        cls.fx = dict(json.loads((ROOT / catalog['fx']['historyUrl']).read_text())['series'])

    def test_each_security_has_its_own_identity_in_the_daily_refresh_and_portfolio(self):
        for symbol in SYMBOLS:
            with self.subTest(symbol=symbol):
                row, asset = self.benchmarks[symbol], self.assets[symbol]
                facts = annual_fees.ETFS[symbol]
                self.assertEqual([r[0] for r in update.BM_DEFS].count(symbol), 1)
                self.assertEqual(row['identityUrl'], facts['sourceUrl'])
                self.assertEqual(row['feeCheckedAt'], facts['checkedAt'])
                self.assertIn('/' + symbol + '/', row['sourceUrl'])
                self.assertEqual(asset['id'], 'us:' + symbol)
                self.assertEqual(asset['expenseRatio'], facts['expenseRatio'])
                self.assertEqual(row['basis'], 'provider_adjusted_close')
                self.assertEqual(row['status'], 'computed')
        for symbol in ('VOO', 'IVV'):
            self.assertEqual(self.benchmarks[symbol]['section'], 'main')
            self.assertEqual(self.benchmarks[symbol]['underlying'], 'S&P 500 Index')
        boxx = self.benchmarks['BOXX']
        self.assertEqual(boxx['section'], 'other')
        self.assertEqual(boxx['category'], '短期现金管理')
        self.assertEqual(boxx['style'], '箱式期权')
        self.assertEqual(boxx['distribution'], '不定期')

    def test_all_periods_use_the_securitys_own_hashed_history_and_exact_fx_dates(self):
        for symbol in SYMBOLS:
            with self.subTest(symbol=symbol):
                row, asset = self.benchmarks[symbol], self.assets[symbol]
                raw = (ROOT / asset['historyUrl']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), asset['sha256'])
                history = json.loads(raw)
                self.assertEqual(history['id'], 'us:' + symbol)
                self.assertEqual(history['currency'], 'USD')
                self.assertEqual(history['dividends'], 'reinvested')
                self.assertGreaterEqual(history['first'], row['inception'])
                self.assertEqual(history['first'], row['first'])
                prices = dict(history['series'])
                for index, period in enumerate(row['periods']):
                    if period['start'] is None:
                        self.assertIsNone(row['usd'][index])
                        self.assertIsNone(row['cny'][index])
                        self.assertLess(update.add_years(period['end'], -period['years']), history['first'])
                        continue
                    factor = prices[period['end']] / prices[period['start']]
                    self.assertAlmostEqual(row['usd'][index], (factor - 1) * 100, places=7)
                    yuan = factor * self.fx[period['fxEnd']] / self.fx[period['fxStart']]
                    self.assertAlmostEqual(row['cny'][index], (yuan - 1) * 100, places=7)
                if update.add_years(row['asOf'], -5) < history['first']:
                    self.assertEqual(row['riskUSD5']['status'], 'insufficient_history')
                    self.assertIsNone(row['riskUSD5']['mdd'])

    def test_boxx_cash_history_is_not_inferred_from_its_recent_zero_distribution_rate(self):
        source = (ROOT / 'data/etf-distributions.js').read_text()
        item = json.loads(source.split('=', 1)[1].strip().rstrip(';'))['products']['BOXX']
        self.assertEqual(item['status'], 'recorded')
        record = next(r for r in item['records'] if r['exDate'] == '2024-08-13')
        # A later split may revise the vendor's historical per-share amount.
        self.assertGreater(record['perShare'], 0)
        history = json.loads((ROOT / self.assets['BOXX']['historyUrl']).read_text())
        self.assertGreater(history['dividendEvidence']['fractions']['2024-08-13'], 0)
        self.assertTrue(all(item['first'] <= r['exDate'] <= item['through'] for r in item['records']))

    def test_observed_total_returns_agree_with_independent_issuer_disclosures(self):
        # Vanguard F0968 (2026-06-30 market price), Alpha Architect product page
        # (2026-09-30 market price). Issuers use nominal-year annualization.
        # Small differences can arise from closing-price and DRIP conventions.
        checks = [
            ('VOO', '2025-06-30', '2026-06-30', 1, 22.34),
            ('VOO', '2023-06-30', '2026-06-30', 3, 20.58),
            ('BOXX', '2025-09-30', '2026-09-30', 1, 3.98),
            ('BOXX', '2023-09-29', '2026-09-30', 3, 4.62),
        ]
        for symbol, start, end, years, issuer_return in checks:
            with self.subTest(symbol=symbol, years=years):
                prices = dict(json.loads((ROOT / self.assets[symbol]['historyUrl']).read_text())['series'])
                actual = ((prices[end] / prices[start]) ** (1 / years) - 1) * 100
                self.assertLess(abs(actual - issuer_return), .04)


if __name__ == '__main__':
    unittest.main()
