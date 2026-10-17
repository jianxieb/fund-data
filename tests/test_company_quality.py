import json
import unittest
from copy import deepcopy
from pathlib import Path

from company_quality import durable_financials, business_decision
from stock_screen import load_old_rows
from stock_groups import long_term_review, growth_review
from us_stock_groups import classify
from tests import test_us_stock_groups as legacy

ROOT = Path(__file__).resolve().parents[1]


class DurableQualityTests(unittest.TestCase):
    def test_mature_profit_growth_does_not_control_long_term_quality(self):
        row = legacy.UsStockGroupsTests().company()
        row['analysis']['profitCagr3']['value'] = 3
        row['analysis']['annual'][-1]['profitGrowth'] = -2
        row['financials']['profitGrowth']['value'] = 4
        row['financials']['operatingGrowth']['value'] = 4
        self.assertIn('quality', classify(row, '2026-10-17')['screening']['groups'])
        self.assertNotIn('quality', classify(row, '2026-10-08')['screening']['groups'])

    def test_five_year_roe_floor_cash_and_gaps_cannot_be_bypassed(self):
        records = [dict(period=str(y)+'-12',profit=100,cash=100,roe=20) for y in range(2021,2026)]
        self.assertTrue(all(c['pass'] for c in durable_financials(records,50,100)[0]))
        for records_,cash in [(records,49.999),(records[:-1],100)]:
            self.assertFalse(all(c['pass'] for c in durable_financials(records_,cash,100)[0]))
        records[0]['roe']=9.999
        self.assertFalse(all(c['pass'] for c in durable_financials(records,100,100)[0]))
        records[0]['roe']=20
        records[0]['period']='2021-09'
        self.assertFalse(all(c['pass'] for c in durable_financials(records,100,100)[0]))

    def test_mean_is_stable_across_python_float_sum_versions(self):
        roes=[15.32, 24.67, 25.89, 28.12, 25.27]
        records=[dict(period=str(y)+'-12',profit=100,cash=100,roe=roe)
                 for y,roe in zip(range(2021,2026),roes)]
        self.assertEqual(durable_financials(records,100,100)[1],23.854)

    def test_business_reassessment_does_not_backdate_or_approve_new_periods(self):
        old={'decision':'retain'}
        self.assertEqual(business_decision('601899','quality','2026-06-30','2026-10-01',old),old)
        self.assertEqual(business_decision('601899','quality','2026-06-30','2026-10-17',old)['decision'],'hold')
        self.assertEqual(business_decision('601899','quality','2026-09-30','2026-10-30',old)['decision'],'pending')

    def test_published_candidates_have_reproducible_rules_and_no_cash_toggle(self):
        rows=load_old_rows((ROOT/'data/snapshot.js').read_text())
        for row in rows.values():
            if row['group']=='dividend':continue
            for key,fn in [('longTermReview',long_term_review),('growthReview',growth_review)]:
                actual=row[key]
                self.assertEqual(actual,fn(deepcopy(row),actual['checkedAt']),row['c'])
            if row['c'] in ('601138','300308','601899','603979','000792','300857'):
                self.assertFalse(row['growthReview']['qualified'],row['c'])
        for filename in ['assets/app.js','assets/overseas-stocks.js']:
            self.assertNotIn('stockCashOnly',(ROOT/filename).read_text())

    def test_growth_roe_uses_two_complete_years_in_both_markets(self):
        row=legacy.UsStockGroupsTests().company()
        row['analysis']['annual'][-2]['roe']=9.99
        self.assertNotIn('growth',classify(row,'2026-10-17')['screening']['groups'])
        rows=load_old_rows((ROOT/'data/snapshot.js').read_text())
        row=deepcopy(rows['300750'])
        row['financialHistory5'][1]['roe']=9.99
        self.assertFalse(growth_review(row,'2026-10-17')['qualified'])


if __name__=='__main__':
    unittest.main()
