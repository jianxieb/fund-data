import json
import unittest
from copy import deepcopy
from pathlib import Path

from us_stock_groups import classify


class UsStockGroupsTests(unittest.TestCase):
    def company(self):
        annual = [dict(period=f'{y}-12', reportDate=f'{y}-12-31',
                       NetIncome=100, OperatingCashFlow=120, roe=20,
                       profitGrowth=20) for y in range(2021, 2026)]
        quarterly = {}
        for y, amount in [(2025, 10), (2026, 25)]:
            for month in ['03', '06']:
                key = f'{y}-{month}'
                quarterly[key] = dict(period=key, reportDate=key + ('-31' if month == '03' else '-30'),
                    NetIncome=amount, TotalOperatingIncomeAsReported=amount,
                    OperatingCashFlow=amount)
        review = dict(reportPeriod='2026-06-30', driver='订阅交付增长',
                      nonOperating='投资收益已核对', priceCycle='可比单价',
                      consolidation='合并范围相同', invalidation='订单下滑',
                      qualityDecision='retain', growthDecision='retain',
                      breakoutDecision='retain', evidence=[dict(label='主营收入',
                      value=100, unit='USD', sourceUrl='https://example.com/filing',
                      location='分部表', basis='disclosed', reportPeriod='2026-06-30')])
        return dict(accountingModel='corporate',
            financials=dict(reportDate='2026-06-30', publishedAt='2026-08-01',
                profitGrowth={'value': 150}, operatingGrowth={'value': 150},
                roeTTM=20, ttmProfit=100, ttmCash=120,
                OperatingCashFlow=25, NetIncome=25),
            analysis=dict(annual=annual, profitCagr3={'value': 20}, cashConversion=1.2),
            financialHistory={'quarterly': quarterly},
            research=dict(reportPeriod='2026-06-30', reviewedAt='2026-10-07',
                sources=[dict(reportPeriod='2026-06-30', publishedAt='2026-08-01',
                              url='https://example.com/filing')], earningsReview=review,
                longTerm=dict(decision='retain', durability='客户粘性',
                              reinvestment='产品研发', invalidation='留存下降')),
            dividendRecords=[], cashDividend12=0, epsTTM=10, yield12=0)

    def groups(self, row, asof='2026-10-08'):
        return classify(row, asof)['screening']['groups']

    def test_quality_and_growth_overlap_but_do_not_duplicate_lower_quality_breakout(self):
        self.assertEqual(self.groups(self.company()), ['quality', 'growth'])

    def test_new_financial_period_requires_a_new_business_review(self):
        row = self.company()
        row['financials'].update(reportDate='2026-09-30', publishedAt='2026-10-07')
        self.assertEqual(self.groups(row), ['other'])
        self.assertIn('最新财报为2026-09-30', '；'.join(row['screening']['otherReasons']))
        self.assertEqual(self.groups(self.company(), '2027-01-01'), ['other'])

    def test_prior_loss_is_not_a_positive_growth_base(self):
        row = self.company()
        row['financialHistory']['quarterly']['2025-03']['NetIncome'] = -10
        self.assertEqual(self.groups(row), ['quality'])
        self.assertIsNone(row['screening']['quarters'][0]['profitGrowth'])

    def test_oneoff_review_cannot_be_replaced_by_large_reported_growth(self):
        row = self.company()
        review = row['research']['earningsReview']
        review.update(qualityDecision='hold', growthDecision='hold',
                      breakoutDecision='hold', growthRationale='存储涨价占比尚未拆清')
        self.assertEqual(self.groups(row), ['other'])
        self.assertIn('存储涨价占比尚未拆清', row['screening']['otherReasons'])
        row = self.company()
        row['research']['earningsReview']['evidence'][0]['reportPeriod'] = '2025-06-30'
        self.assertEqual(self.groups(row), ['other'])

    def test_missing_year_and_unrounded_roe_cannot_satisfy_quality_gate(self):
        row = self.company()
        for q in row['analysis']['annual']:
            q['roe'] = 14.999
        self.assertEqual(self.groups(row), ['growth'])
        row = self.company()
        row['analysis']['annual'][0]['period'] = '2020-12'
        self.assertEqual(self.groups(row), ['growth'])

    def test_ipo_breakout_uses_actual_profit_and_cash_without_erasing_prior_loss(self):
        row = self.company()
        row['analysis']['annual'] = row['analysis']['annual'][-2:]
        row['analysis']['annual'][0]['NetIncome'] = -100
        self.assertEqual(self.groups(row), ['breakout'])
        row['financials']['OperatingCashFlow'] = 10
        self.assertEqual(self.groups(row), ['other'])

    def test_reit_uses_affo_payout_and_is_independent_of_growth(self):
        row = self.company()
        row.update(accountingModel='reits', yield12=5, cashDividend12=3, epsTTM=1,
                   dividendRecords=[{'day': f'{y}-06-01', 'amount': .5} for y in range(2021, 2026)])
        row['research']['incomeReview'] = dict(decision='retain', payoutRatio=.745,
            rationale='本期AFFO覆盖派息', capitalReview='出租率和杠杆已核对')
        self.assertEqual(self.groups(row), ['dividend'])
        row['research']['incomeReview']['payoutRatio'] = .86
        self.assertEqual(self.groups(row), ['other'])

    def test_published_universe_has_current_evidence_reports_and_bluechip_coverage(self):
        root = Path(__file__).resolve().parents[1]
        values = {}
        for line in (root / 'data/overseas-stocks.js').read_text().splitlines():
            if line.startswith('var '):
                key, value = line[4:].split('=', 1)
                values[key] = json.loads(value.rstrip(';'))
        rows = values['OVERSEAS_STOCKS']
        self.assertGreaterEqual(len(rows), 60)
        required = {'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'JPM', 'BRK-B', 'LLY', 'XOM',
                    'LITE', 'TSM', 'NVDA', 'MU', 'TSLA', 'SPCX'}
        self.assertTrue(required <= {r['symbol'] for r in rows})
        for row in rows:
            self.assertEqual(row['research']['reportPeriod'], row['financials']['reportDate'])
            self.assertTrue(row['research']['earningsReview']['evidence'])
            self.assertEqual(classify(deepcopy(row), row['screening']['checkedAt'])['screening'], row['screening'])
        apple = next(r for r in rows if r['symbol'] == 'AAPL')
        self.assertEqual(apple['screening']['groups'], ['other'])
        self.assertTrue(apple['screening']['otherReasons'])
        self.assertIn('重要蓝筹', apple['coverageBasis'])


if __name__ == '__main__':
    unittest.main()
