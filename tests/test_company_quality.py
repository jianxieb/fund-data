import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

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
        # The archived numeric policy is still reproducible. It no longer
        # endorses a company without an explicit current selection decision.
        with patch('company_selection.apply_us', side_effect=lambda r, day: r):
            self.assertIn('quality', classify(row, '2026-10-17')['screening']['groups'])
        self.assertNotIn('quality', classify(row, '2026-10-17')['screening']['groups'])
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

    def test_published_selections_have_reproducible_decisions_and_no_cash_toggle(self):
        rows=load_old_rows((ROOT/'data/snapshot.js').read_text())
        for row in rows.values():
            if row['group']=='dividend':continue
            for key,fn in [('longTermReview',long_term_review),('growthReview',growth_review)]:
                actual=row[key]
                self.assertEqual(actual,fn(deepcopy(row),actual['checkedAt']),row['c'])
            # Membership can change after a new filing or an expired review.
            # Dated company outcomes are exercised with frozen financial inputs
            # in test_company_selection; live rows must reproduce their checks.
            for key in ('longTermReview', 'growthReview'):
                review = row[key]
                self.assertEqual(review['qualified'], all(c['pass'] for c in review['checks']), row['c'])
        for filename in ['assets/app.js','assets/overseas-stocks.js']:
            self.assertNotIn('stockCashOnly',(ROOT/filename).read_text())

    def test_archived_numeric_growth_rule_uses_two_complete_years(self):
        row=legacy.UsStockGroupsTests().company()
        row['analysis']['annual'][-2]['roe']=9.99
        with patch('company_selection.apply_us', side_effect=lambda r, day: r):
            self.assertNotIn('growth',classify(row,'2026-10-17')['screening']['groups'])
        # The archived numeric rule needs the archived company's inputs too.
        from scripts.build_stock_reports import report_row
        row=report_row(json.loads((ROOT/'company-report/data/300750/summary.json').read_text()))
        self.assertTrue(growth_review.__wrapped__(row,'2026-10-17')['qualified'])
        row['financialHistory5'][1]['roe']=9.99
        self.assertFalse(growth_review.__wrapped__(row,'2026-10-17')['qualified'])


if __name__=='__main__':
    unittest.main()
