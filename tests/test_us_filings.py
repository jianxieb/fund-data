import unittest
from us_filings import normalize, fiscal_month


class UsFilingsTests(unittest.TestCase):
    def payload(self):
        def fact(start, end, value, filed='2026-08-01', form='10-Q'):
            return dict(start=start, end=end, val=value, filed=filed, form=form, accn='0000000001-26-000001')
        series = [fact('2026-01-01', '2026-03-31', 10),
                  fact('2026-01-01', '2026-06-30', 25),
                  fact('2026-01-01', '2026-09-30', 40, '2026-11-01'),
                  fact('2025-01-01', '2025-09-30', 30, '2026-02-01'),
                  fact('2025-01-01', '2025-12-31', 50, '2026-02-01', '10-K')]
        return {'cik': 1, 'entityName': 'Example', 'facts': {'us-gaap': {
            k: {'units': {unit: series}} for k, unit in [
                ('Revenues', 'USD'), ('NetIncomeLoss', 'USD'),
                ('NetCashProvidedByUsedInOperatingActivities', 'USD'),
                ('EarningsPerShareDiluted', 'USD/shares')]}}}

    def test_ytd_cash_and_q4_amounts_are_differences_but_eps_is_not(self):
        out = normalize(self.payload(), 1, '2026-10-06')
        self.assertEqual(out['quarterly']['2026-06']['OperatingCashFlow'], 15)
        self.assertEqual(out['quarterly']['2025-12']['NetIncome'], 20)
        self.assertNotIn('DilutedEPS', out['quarterly']['2026-06'])
        self.assertNotIn('2026-09', out['quarterly'])
        evidence = out['quarterly']['2026-06']['provenance']['OperatingCashFlow']
        self.assertEqual(evidence['basis'], 'calculated')
        self.assertEqual(len(evidence['operands']), 2)
        self.assertEqual(evidence['start'], '2026-04-01')

    def test_latest_known_restatement_wins_and_future_filings_are_excluded(self):
        p = self.payload()
        rows = p['facts']['us-gaap']['NetIncomeLoss']['units']['USD']
        rows += [dict(rows[0], val=12, filed='2026-09-01'),
                 dict(rows[0], val=99, filed='2026-11-01')]
        self.assertEqual(normalize(p, 1, '2026-10-06')['quarterly']['2026-03']['NetIncome'], 12)
        with self.assertRaisesRegex(ValueError, 'CIK'):
            normalize(p, 2, '2026-10-06')

    def test_week_based_fiscal_year_is_not_confused_with_calendar_month(self):
        self.assertEqual(fiscal_month('2026-09-03'), '2026-08')
        self.assertEqual(fiscal_month('2026-06-27'), '2026-06')
        self.assertEqual(fiscal_month('2026-02-01'), '2026-01')

    def test_instant_equity_does_not_create_an_extra_income_quarter(self):
        p = self.payload()
        p['facts']['us-gaap']['StockholdersEquity'] = {'units': {'USD': [
            dict(end='2026-06-30', val=100, filed='2026-08-01', form='10-Q', accn='0000000001-26-000001'),
            dict(end='2026-09-30', val=200, filed='2026-10-01', form='10-Q', accn='0000000001-26-000002')]}}
        out = normalize(p, 1, '2026-10-06')
        self.assertEqual(out['quarterly']['2026-06']['StockholdersEquity'], 100)
        self.assertNotIn('2026-09', out['quarterly'])


if __name__ == '__main__':
    unittest.main()
