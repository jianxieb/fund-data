import json
import unittest
from copy import deepcopy
from pathlib import Path

from stock_income import income_review, cn_income_review, us_income_review
from stock_screen import load_old_rows
from company_selection import apply_cn

ROOT=Path(__file__).resolve().parents[1]

class SharedIncomeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cn=load_old_rows((ROOT/'data/snapshot.js').read_text())
        cls.us={r['symbol']:r for r in json.loads(next(l.split('=',1)[1].rstrip(';') for l in (ROOT/'data/overseas-stocks.js').read_text().splitlines() if l.startswith('var OVERSEAS_STOCKS=')))}

    def inputs(self):
        return dict(asof='2026-10-17', period='2026-06-30', published='2026-08-20', report_source='https://example.com/report',
                    yield12=3,paid_years=[2021,2022,2023,2024,2025],dividend_asof='2026-10-14',
                    dividend_source='https://example.com/dividends',payout=.85,cash=100,
                    review=dict(reportPeriod='2026-06-30',publishedAt='2026-08-20',reviewedAt='2026-10-17',
                                sourceUrl='https://example.com/report',decision='retain',rationale='Dated cash coverage review'))

    def test_equal_boundary_and_bad_inputs_are_applied_by_one_engine(self):
        self.assertTrue(income_review(**self.inputs())['qualified'])
        for key,value in [('yield12',2.99),('payout',.851),('payout',None),('cash',0),('paid_years',[2022,2023,2024,2025]),('dividend_asof','2026-10-01'),('dividend_asof','2026-10-18'),('published','2026-10-18')]:
            with self.subTest(key=key,value=value):
                args=self.inputs();args[key]=value
                self.assertFalse(income_review(**args)['qualified'])

    def test_cash_or_yield_does_not_replace_company_review(self):
        for change in ({'decision':'hold'},{'reportPeriod':'2025-12-31'},{'sourceUrl':None},{'reviewedAt':'2026-10-18'}):
            args=self.inputs();args['review'].update(change)
            self.assertFalse(income_review(**args)['qualified'])

    def test_missing_dividend_history_is_not_zero_years(self):
        args=self.inputs();args['paid_years']=None
        result=income_review(**args)
        self.assertIsNone(result['dividendYears5'])
        self.assertFalse(result['qualified'])

    def test_financials_need_capital_review_and_reits_use_disclosed_affo(self):
        args=self.inputs();args.update(sector='bank',cash=-1)
        self.assertFalse(income_review(**args)['qualified'])
        args['review']['capitalReview']='Current capital, credit and loss-absorption review'
        self.assertTrue(income_review(**args)['qualified'])
        args.update(sector='reits',payout=1.8)
        args['review'].update(payoutRatio=.745,payoutBasis='本季已付普通股股息 / AFFO')
        result=income_review(**args)
        self.assertTrue(result['qualified']);self.assertEqual(result['payoutRatio'],.745)

    def test_new_reports_expire_income_reviews_on_both_sides(self):
        cn=deepcopy(self.cn['600900']);us=deepcopy(self.us['O'])
        cn['latestFinancials']['reportDate']='2026-09-30';us['financials']['reportDate']='2026-09-30'
        self.assertFalse(cn_income_review(cn,'2026-10-17')['qualified'])
        self.assertFalse(us_income_review(us,'2026-10-17')['qualified'])
        pep=us_income_review(self.us['PEP'],'2026-10-17')
        self.assertFalse(pep['qualified'])
        self.assertIn('2026-06-13',pep['rationale'])
        apply_cn(cn,'2026-10-30')
        self.assertEqual(cn['companySelection']['reviewedAt'],'2026-10-17')
        self.assertEqual(cn['companySelection']['reportPeriod'],'2026-06-30')
        self.assertNotIn('dividend',cn['companySelection']['groups'])

    def test_catalog_label_and_high_yield_do_not_bypass_missing_evidence(self):
        for code in ('000333','601006','600519','600690'):
            row=self.cn[code]
            self.assertEqual(row['group'],'dividend')
            self.assertNotIn('dividend',row['companySelection']['groups'])
            self.assertIn('同股本',row['incomeReview']['rationale'])
        for code in ('600941','600938','601728'):
            self.assertIn('2021',self.cn[code]['incomeReview']['rationale'])
        self.assertNotIn('dividend',self.cn['002558']['companySelection']['groups'])
        self.assertNotIn('dividend',self.cn['603444']['companySelection']['groups'])

    def test_banks_are_not_rejected_for_industrial_cash_rules(self):
        for code in ('600901','601398','601939','601288','601988','600036'):
            review=cn_income_review(self.cn[code],'2026-10-17')
            self.assertTrue(review['qualified'],(code,review['rationale']))
            self.assertTrue(review['businessReview']['capitalReview'])
            self.assertFalse(any(c['label']=='最近12个月经营现金流为正' for c in review['checks']))

    def test_share_basis_changes_cannot_be_summed_as_unchanged_eps(self):
        row=deepcopy(self.cn['600900'])
        self.assertTrue(cn_income_review(row,'2026-10-17')['qualified'])
        row['incomeShareEvidence']['reports'][0]['shares'] *= 1.1
        review=cn_income_review(row,'2026-10-17')
        self.assertIsNone(review['payoutRatio']);self.assertFalse(review['qualified'])

if __name__=='__main__':unittest.main()
