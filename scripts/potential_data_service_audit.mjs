const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';

export function dataServiceAudit(c, sources, n) {
  const a = c.dataServiceAudit;
  if (!a) return '';
  const f = a.cash, s = a.capital;
  const money = rows => rows.map(([label, ...values]) => [label, ...values.map(v => n(v, 3))]);
  let out = '\n### 数据服务：GAAP盈利与项目现金\n\n';
  out += table(['期间 / 百万美元','收入','成本','SG&A','营业利润','净利息收入','税前利润','所得税','归母净利','其中SBC成本'], a.periods.map(p => [p.label,...['revenue','cost','sga','operating','interest','pretax','tax','net','sbc'].map(k=>n(p[k],3))]));
  out += a.earningsNote + '\n\n' + sources(['inod-q','inod-k']) + '\n\n';
  out += table(['H1净利润至经营现金 / 百万美元','金额'], money(a.ocfRows));
  out += table(['H1现金桥 / 百万美元','金额'], money([['期初现金及等价物',f.start],['经营现金',f.operating],['投资现金',f.investing],['筹资现金',f.financing],['汇率影响',f.fx],['期末现金及等价物',f.end],['另有短期投资',f.shortInvestments]]));
  out += table(['投资和融资组成 / 百万美元','现金流'], money([['资本开支及资本化软件',-f.capex],['购买短期投资',-f.investmentPurchases],['期权行权款',f.optionCash],['RSU代扣税',f.rsuTax],['长期义务付款',f.obligationPayments]]));
  out += table(['期末资金与义务 / 百万美元','金额'], money([['现金及短期投资',f.end+f.shortInvestments],['客户预收',f.advances],['项目已发生未付成本',f.unpaidProjectCosts],['静态扣除两项项目余额后',f.end+f.shortInvestments-f.advances-f.unpaidProjectCosts],['公司所述剔项目预收现金约数',f.managementNetCash],['尚未衔接的口径差额',f.managementNetCash-(f.end+f.shortInvestments-f.advances-f.unpaidProjectCosts)],['应收账款净额',f.receivables],['供应商预付',f.supplierAdvances],['养老金义务',f.pension],['软件许可义务',f.softwareObligations],['经营租赁负债',f.leases],['未用授信可借基数',f.creditBorrowingBase]]));
  out += a.cashNote + `\n\nH1经营现金减资本开支 ${n(f.operating-f.capex,3)}百万仍含项目款，不能当作可持续自由现金。未来12个月资本开支预期 ${n(f.next12MonthsCapex)}百万。未提款授信最高 ${n(f.creditLimit)}百万、实际可借基数 ${n(f.creditBorrowingBase)}百万，另受1.10倍覆盖约束，利率SOFR+2.25%。\n\n` + sources(['inod-q','inod-release']) + '\n\n';
  out += '### 股本口径与最高业绩RSU\n\n';
  out += table(['6月底股份 / 百万股','数量'], ([['已发行（含库存股）',s.juneIssued],['减：库存股',-s.juneTreasury],['外部股数',s.juneOutstanding],['2013计划期权',s.juneOptions[0].shares],['2021计划期权',s.juneOptions[1].shares],['普通RSU',s.ordinaryRsu],['业绩RSU（已按最大股数）',s.performanceRsu],['既有潜在股份合计',c.shares.knownPotential]].map(([label,v])=>[label,n(v,6)])));
  out += table(['期权条件 / 美元','股数 / 百万','加权行权价','全部现金行权条件收入 / 百万美元'], s.juneOptions.map(p=>[p.plan,n(p.shares,6),n(p.strike),n(p.shares*p.strike,6)]));
  out += a.shareNote + '\n\n';
  out += table(['后续已知授予（非全体滚动）','股数 / 百万','类型'], s.postJuneAwards.map(p=>[p.date,n(p.shares,6),p.kind]));
  out += `八月4日普通股 ${n(s.augOutstanding,6)}百万；九月旧期权合计 ${n(s.septemberOldOptionsExercised,6)}百万行权，属于已有潜在工具转股。新增计划预留 ${n(s.newPlanAdditionalReserve)}百万、原未使用预留 ${n(s.previousUnusedReserve,6)}百万均不直接加进已授予余额。\n\n` + sources(c.shares.sources) + '\n\n';
  return out;
}

export function dataServiceFunding(c, M, sources, n) {
  if (!c.dataServiceAudit) return '';
  const a = c.dataServiceAudit, s = a.capital, bull = M.scenario(c,'bull');
  let out = '\n### ATM发行价格与营运资金敏感性\n\n';
  out += table(['假设发行价 / 美元','发行总额 / 百万美元','佣金后净款（未扣其他费用）','新股 / 百万','合计期末股数 / 百万','保持乐观经营时股价倍数'], s.issuePrices.map(price=>{
    const x=M.dataServiceFunding(c,price);
    return [n(price),n(s.atmGross),n(x.netProceeds),n(x.newShares),n(x.shares,6),n(M.project(c,{...bull,shares:x.shares}).priceMultiple)+'×'];
  }));
  out += table(['乐观收入对应净营运占用比例假设','终点占用 / 百万美元'],a.workingCapitalRatios.map(r=>[n(r*100)+'%',n(bull.revenue*r)]));
  return out + a.fundingNote + '\n\n' + sources(['inod-q','inod-atm']) + '\n\n';
}

export function chemicalScreenAudit(c, M, sources, n) {
  const a=c.audit,f=a.cash,s=a.capital;
  const money=rows=>rows.map(([label,...values])=>[label,...values.map(v=>n(v,6))]);
  let out='#### 化学品收入、回款与产能阶段\n\n';
  out+=table(['2026H1 / 百万元','收入','成本','毛利率'],a.products.map(p=>[p.label,n(p.revenue,6),n(p.cost,6),n((1-p.cost/p.revenue)*100)+'%']));
  out+=a.businessNote+'\n\n';
  out+=table(['现金桥 / 百万元','金额'],money([['期初现金等价物',f.start],['经营现金',f.operating],['投资现金',f.investing],['筹资现金',f.financing],['汇率影响',f.fx],['期末现金等价物',f.end],['另有受限资金',f.restricted],['另有交易性金融资产',f.tradingAssets]]));
  out+=table(['现金与营运资金 / 百万元','金额'],money([['经营现金减资本开支',f.operating-f.capex],['理财/投资收回',f.investmentRecovered],['投资收益收现',f.investmentIncome],['投资购买',-f.investmentPaid],['借款',f.borrowed],['还款',-f.repaid],['分红及付息',-f.dividendsInterest],['其他筹资流出',-f.otherFinancing],['期末应收净额',f.receivables],['期初应收净额',f.priorReceivables],['应收票据',f.notes],['应收融资',f.receivablesFinancing],['存货',f.inventory],['短期借款',f.shortDebt]]));
  out+=a.cashNote+'\n\n'+sources(['tiancheng-h1'])+'\n\n';
  out+='#### 激励目标、库存股过户与H股筹划\n\n';
  out+=table(['收入考核年度','目标 / 百万元'],s.targets.map(p=>[p.year,n(p.revenue)]));
  out+=table(['首次授予预计费用年度','金额 / 百万元'],s.expenseByYear.map((v,i)=>[2026+i,n(v,4)]));
  out+=a.capitalNote+'\n\n'+sources(['tiancheng-old-vest','tiancheng-grant','tiancheng-plan','tiancheng-h'])+'\n\n';
  out+='#### 当前买入价与未来股数压力\n\n';
  out+=table(['条件（均为研究假设）','期末股数 / 百万','归母净利率','PE','十倍所需收入 / 亿元','相对2026考核目标'],a.hurdleCases.map(p=>{
    const rev=c.price.value*10*p.shares/p.margin/p.pe;
    return [p.label,n(p.shares,6),n(p.margin*100)+'%',p.pe,n(rev/100),n(rev/c.anchorRevenue)+'×'];
  }));
  const p=M.project({price:c.price,shares:{value:c.shares},financials:{anchorRevenue:null}}, {...a.scaleExample,dividends:0});
  out+=`收入 ${n(a.scaleExample.revenue/100,4)}亿元、净利率 ${n(a.scaleExample.margin*100)}%、${a.scaleExample.pe}倍PE、期末 ${n(a.scaleExample.shares)}百万股，对应 ${n(p.price)}元、股价 ${n(p.priceMultiple)}倍。${a.scaleNote}\n\n`;
  out+=a.milestones.map(m=>'- '+m.when+'：'+m.test).join('\n')+'\n\n';
  return out;
}
