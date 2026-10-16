import json
import unittest
from pathlib import Path

import annual_fees
import update


ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = ('SGOV', 'SHY', 'IEI', 'IEF', 'TLH', 'TLT', 'GOVT', 'TIP')


class TreasuryEtfDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (ROOT / 'data/snapshot.js').read_text()
        block = source.split('/*__DATA_BM_BEGIN__*/', 1)[1].split('/*__DATA_BM_END__*/', 1)[0]
        cls.benchmarks = {r['n']: r for r in (
            json.loads(line.rstrip(',')) for line in block.splitlines() if line.startswith('{'))}
        catalog = json.loads((ROOT / 'data/portfolio/catalog.js').read_text().split('=', 1)[1].strip().rstrip(';'))
        cls.assets = {r['code']: r for r in catalog['assets'] if r['id'].startswith('us:')}
        cls.fx = dict(json.loads((ROOT / catalog['fx']['historyUrl']).read_text())['series'])

    def test_treasuries_keep_fund_identity_and_enter_the_existing_refresh(self):
        products = [r for r in annual_fees.ETFS.values() if r['section'] == 'treasury']
        self.assertEqual([r['symbol'] for r in products], list(SYMBOLS))
        for symbol in SYMBOLS:
            with self.subTest(symbol=symbol):
                facts = annual_fees.fee_metadata(symbol)
                self.assertEqual(facts['leverage'], 1)
                self.assertEqual(facts['distribution'], '每月')
                self.assertTrue(facts['maturityBand'])
                self.assertIn('Treasury', facts['underlying'])
                self.assertTrue(facts['identityUrl'].startswith('https://www.ishares.com/'))
                self.assertEqual([r[0] for r in update.BM_DEFS].count(symbol), 1)
                self.assertEqual(self.benchmarks[symbol]['section'], 'treasury')
        self.assertEqual(annual_fees.ETFS['TIP']['category'], '通胀保值国债')

    def test_published_periods_and_risk_reconcile_to_each_funds_reinvested_prices(self):
        for symbol in SYMBOLS:
            with self.subTest(symbol=symbol):
                row, asset = self.benchmarks[symbol], self.assets[symbol]
                history = json.loads((ROOT / asset['historyUrl']).read_text())
                self.assertEqual(history['id'], 'us:' + symbol)
                self.assertEqual(history['currency'], 'USD')
                self.assertEqual(history['basis'], 'provider_adjusted_close')
                self.assertEqual(history['dividends'], 'reinvested')
                self.assertGreaterEqual(history['first'], row['inception'])
                self.assertEqual(asset['expenseRatio'], row['expenseRatio'])
                self.assertEqual(history['dividendEvidence']['status'], 'recorded')
                self.assertGreater(len(history['dividendEvidence']['fractions']), 48)
                prices = dict(history['series'])
                for index, period in enumerate(row['periods']):
                    if period['start'] is None:
                        self.assertIsNone(row['usd'][index])
                        self.assertIsNone(row['cny'][index])
                        continue
                    factor = prices[period['end']] / prices[period['start']]
                    self.assertAlmostEqual(row['usd'][index], (factor - 1) * 100, places=7)
                    yuan_factor = factor * self.fx[period['fxEnd']] / self.fx[period['fxStart']]
                    self.assertAlmostEqual(row['cny'][index], (yuan_factor - 1) * 100, places=7)
                risk = row['riskUSD5']
                path = [value for day, value in history['series'] if risk['start'] <= day <= risk['end']]
                peak, mdd = path[0], 0
                for price in path:
                    peak = max(peak, price)
                    mdd = min(mdd, price / peak - 1)
                self.assertAlmostEqual(risk['mdd'], mdd * 100, places=7)
                if row['riskCNY5']['status'] == 'incomplete_fx':
                    self.assertTrue(row['riskCNY5']['missingFxDates'])
                    self.assertIsNone(row['riskCNY5']['mdd'])
        sgov = self.benchmarks['SGOV']
        if sgov['asOf'] < '2030-06-01':
            self.assertIsNone(sgov['usd'][4])

    def test_independent_issuer_quarterly_market_price_returns(self):
        evidence = json.loads((ROOT / 'docs/evidence/treasury-etfs/issuer-check.json').read_text())
        self.assertEqual({r['symbol'] for r in evidence['results']}, set(SYMBOLS))
        checked = 0
        for row in evidence['results']:
            asset = self.assets[row['symbol']]
            prices = dict(json.loads((ROOT / asset['historyUrl']).read_text())['series'])
            for comparison in row['comparisons']:
                with self.subTest(symbol=row['symbol'], years=comparison['years']):
                    # Match the issuer's nominal-year annualization, independently
                    # of the site's actual-calendar-day display conversion.
                    result = ((prices[comparison['end']] / prices[comparison['start']]) **
                              (1 / comparison['years']) - 1) * 100
                    self.assertLess(abs(result - comparison['issuerMarketPriceAnnual']), .03)
                    checked += 1
        self.assertEqual(checked, 31)


if __name__ == '__main__':
    unittest.main()
