// Detailed medical-device evidence; all amounts are millions of CNY except shares.
const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';

export function medicalAudit(c, sources, n) {
  const a = c.medicalAudit;
  if (!a) return '';
  const h = a.history, f = a.cash, debt = a.debt, g = a.goodwill, k = a.commitment, project = a.project, i = a.incentives;
  const ttm = key => h.annual[key] + h.current[key] - h.prior[key];
  const bank = index => debt.short[index] + debt.long[index] + debt.currentLong[index];
  const cashRows = rows => rows.map(([label, value]) => [label, n(value, 3)]);
  let out = '\n### 历史利润与产品毛利：结构变化不能省略\n\n金额均为百万人民币；股份表另以实际股数列示。\n\n';
  out += table(['指标', h.annual.label, h.prior.label, h.current.label, 'TTM至2026-06-30'], [['收入', 'revenue'], ['归母净利润', 'netIncome'], ['经营现金流', 'operatingCash']].map(([label, key]) => [label, ...[h.annual[key], h.prior[key], h.current[key], ttm(key)].map(v => n(v, 3))]));
  out += `TTM归母净利率 ${n(ttm('netIncome') / ttm('revenue') * 100)}%；H1经营现金/归母净利 ${n(f.operating / h.current.netIncome * 100)}%。${h.note}\n\n${sources(['aibo', 'aibo-2025-audit'])}\n\n`;
  out += table(['2026H1产品', '收入', '成本', '毛利率'], a.products.map(p => [p.label, n(p.revenue, 3), n(p.cost, 3), n((1 - p.cost / p.revenue) * 100) + '%']));
  out += `合并毛利率 ${n((1 - a.totalCost / h.current.revenue) * 100)}%；销售费用 ${n(a.sellingExpense, 3)}，同比 ${n((a.sellingExpense / a.priorSellingExpense - 1) * 100)}%，占收入 ${n(a.sellingExpense / h.current.revenue * 100)}%。${a.productNote}\n\n${sources(['aibo'])}\n\n`;
  out += '### 并购现金：两套披露如何对上\n\n';
  out += table(['收购现金桥', '百万人民币'], cashRows([
    ['现金流表取得子公司净支出', f.acquisitionOutflow], ['减：其他投资收款中“收购子公司”', -f.acquisitionRelatedReceipt], ['两项相抵/附注79净支出', f.acquisitionNet],
    ['附注：本期合并支付现金', f.currentCombinationsPaid], ['减：取得的子公司现金', -f.acquiredCash], ['加：以往合并本期支付', f.priorCombinationsPaid],
    ['另购少数股权（列筹资）', f.minorityPurchases], ['经营现金减长期资产购建', f.operating - f.capex]
  ]));
  out += a.cashNote + '\n\n';
  out += table(['完整现金总桥', '百万人民币'], cashRows([['期初现金', f.start], ['经营现金', f.operating], ['投资现金合计', f.investing], ['筹资现金合计', f.financing], ['汇兑影响', f.fx], ['期末现金', f.end]]));
  out += `当期借款收现 ${n(f.borrowed, 3)}、偿还 ${n(f.repaid, 3)}，净额 ${n(f.borrowed - f.repaid, 3)}。已计入上述筹资现金，不在总桥重复追加。分红及付息现金合计 ${n(f.dividendsAndInterest, 3)}；经营现金减购建支出仅 ${n(f.operating - f.capex, 3)}。\n\n${sources(['aibo'])}\n\n`;
  out += '### 债务与商誉：银行净债务不是全部义务\n\n';
  out += table(['项目', ...debt.dates], [
    ['短期借款', ...debt.short], ['长期借款非流动部分', ...debt.long], ['一年内到期长期借款', ...debt.currentLong], ['银行借款合计', bank(0), bank(1)], ['现金及等价物', ...debt.cash], ['银行净债务', bank(0) - debt.cash[0], bank(1) - debt.cash[1]]
  ].map(([label, ...values]) => [label, ...values.map(v => n(v, 3))]));
  out += table(['6月底另列义务', '百万人民币'], cashRows([['租赁负债（含一年内到期）', debt.leases], ['非流动股东借款', debt.shareholderBorrowingNonCurrent], ['非流动应付股权款', debt.equityPayableNonCurrent], ['一年内到期长期应付款', debt.otherLongPayableCurrent], ['其他流动负债内借款利息', debt.interestInOtherCurrentLiabilities]]));
  out += debt.note + '\n\n';
  out += `商誉原值 ${n(g.startGross, 3)} + 本期新购 ${n(g.additions, 3)} = ${n(g.endGross, 3)}；减已有减值准备 ${n(g.impairmentBalance, 3)}，净额 ${n(g.net, 3)}。既有减值准备不是H1新发生支出，不能再次从现金扣除。\n\n${sources(['aibo'])}\n\n`;
  out += '### 被收购业务：利润归属与现金口径\n\n';
  out += table(['对象', '购买日（照录）', '持股', '合并成本', '净资产份额', '新商誉'], a.acquisitions.map(x => [x.label, x.date, n(x.ownership * 100) + '%', ...[x.cost, x.netAssetsShare, x.goodwill].map(v => n(v, 3))]));
  out += table(['购买日至期末', '被购买方收入', '被购买方净利润', '原表“现金流量”'], a.acquisitions.map(x => [x.label, ...[x.revenue, x.netIncome, x.reportedCashFlow].map(v => n(v, 3))]));
  out += a.acquisitionNote + '\n\n';
  const demei = a.acquisitions[0];
  out += `德美按首年合同利润 ${n(k.targets[0])} × 持股 ${n(demei.ownership * 100)}% = ${n(k.targets[0] * demei.ownership, 4)}；再除现金对价 ${n(demei.cashCost, 3)}，仅约 ${n(k.targets[0] * demei.ownership / demei.cashCost * 100)}%。这只是未扣买方融资费用的利润份额/对价，不是ROIC、现金收益或已实现归母利润。4月管理层预计全年新增财务费用约 ${n(k.annualInterestGuidance)}，不能与三个月并表利润直接相减当全年结果。\n\n${k.note}\n\n${sources(['aibo', 'aibo-acquisition', 'aibo-investor-april'])}\n\n`;
  out += '### 产线与融资：延期改变兑现节奏\n\n';
  out += `隐形眼镜及注塑模具产线募集资金投资额 ${n(project.fundedBudget, 3)}，7月底已投 ${n(project.spentAtJuly, 4)}，余 ${n(project.fundedBudget - project.spentAtJuly, 4)}；投入进度约 ${n(project.spentAtJuly / project.fundedBudget * 100)}%。预定可使用日期 ${project.oldReady} → ${project.newReady}。${project.note}\n\n${sources(['aibo-project-delay'])}\n\n`;
  out += '### 2021激励计划：从未知余额到完整归零证据\n\n';
  out += table(['年度', '期初实际股数', '当年调整倍数', '归属', '作废', '剩余'], i.rollforward.map(r => [r.year, n(r.opening, 0), r.multiplier, n(r.vested, 0), n(r.canceled, 0), n(r.remaining, 0)]));
  out += `调整后总授予 ${n(i.adjustedAwards, 0)} = 已归属 ${n(i.adjustedVested, 0)} + 作废 ${n(i.adjustedCanceled, 0)} + 剩余 ${n(i.remaining, 0)}。${i.note}\n\n`;
  out += `最后登记 ${i.registeredDate}、上市 ${i.listedDate}；总股本 ${n(i.registeredBefore, 0)} + ${n(i.rollforward.at(-1).vested, 0)} = ${n(i.registeredAfter, 0)}。其中库存股 ${n(i.treasury, 0)} 已在登记股本内；参与分红 ${n(i.dividendEligible, 0)} × ${i.dividendPerShare}元 = ${n(i.cashDividend, 2)}元。未来库存股转让不再在登记总股本上重复相加。\n\n`;
  out += `[2026年${i.directoryCount}项公告索引](aibo-filings-2026-10-18.json)，其中6月底后${i.postJuneCount}项，核验至10月18日。旧计划零余额只解决既有奖励；报价与股数仍各自保留日期，未来融资/激励假设继续保留。\n\n${sources(['aibo-vesting-conditions', 'aibo-final-vesting', 'aibo-dividend', 'aibo-filings'])}\n\n`;
  return out;
}
