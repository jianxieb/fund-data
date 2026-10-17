import unittest
from datetime import date

from data_quality import audit


class CatalogCoverageQualityTests(unittest.TestCase):
    def test_alternative_funds_are_required_as_independent_ids(self):
        snapshot = {
            'XOTHERS': [{'c': '006593', 'dup': '000962'}, {'c': '006593', 'dup': '000962'}],
            'PORTFOLIO_CATALOG': {'assets': [
                {'id': 'fund:006593', 'status': 'unavailable', 'missing': 'test fixture lacks daily NAV'}
            ]},
        }

        def mismatch():
            report = audit(snapshot, date(2026, 10, 17))
            return [i for d in report['datasets'] for i in d['issues']
                    if i['code'] == 'portfolio_universe_mismatch']

        self.assertFalse(mismatch())
        snapshot['PORTFOLIO_CATALOG']['assets'][0]['id'] = 'fund:000962'
        self.assertTrue(mismatch(), 'A representative fund cannot replace an alternative security')
        snapshot['PORTFOLIO_CATALOG']['assets'] = []
        self.assertTrue(mismatch())


if __name__ == '__main__':
    unittest.main()
