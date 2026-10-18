// Generate the detailed battery cash and funding audit from the reviewed dataset.
const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';

export function batteryAudit(c, sources, n) {
  if (!c.cashAudit) return '';
  const a = c.cashAudit, f = a.cash, w = c.awardAudit, d = c.dilutionAudit;
  let out = '\n### 现金流复核：退租、营运占用与融资分开\n\n';
  out += table(['2026H1现金桥', '百万美元'], [
    ['期初现金及受限现金', f.startCashAndRestricted], ['经营现金流', f.operating],
    ['购买固定资产现金支出', -f.capexPaid], ['处置资产收款', f.assetSale],
    ['权证现金行权', f.warrantExerciseCash], ['期权现金行权', f.optionExerciseCash],
    ['汇兑影响', f.fx], ['期末现金及受限现金', f.endCashAndRestricted],
    ['其中可用现金', f.endCash], ['其中受限现金', f.restrictedCurrent + f.restrictedOther],
    ['经营现金减固定资产支出', f.operating - f.capexPaid]
  ].map(([label, value]) => [label, n(value, 3)]));
  const labels = { netLoss: 'GAAP净亏损', sbc: '非现金股权薪酬', depreciation: '折旧摊销',
    leaseTerminationLoss: '退租账面损失', ppeWriteDown: '固定资产减值', nonCashLeaseExpense: '非现金租赁费用',
    gainOnSale: '资产处置收益调整', otherNonCash: '其他非现金项目', receivables: '应收账款变动',
    inventory: '库存变动', prepaids: '预付及其他流动资产变动', otherAssets: '其他资产变动',
    payables: '应付账款变动', accruals: '应计及其他流动负债变动', deferredRevenue: '递延收入变动', leaseCash: '经营租赁负债变动（含退租付款）' };
  out += table(['净利润到经营现金的桥', '百万美元'], Object.entries(a.ocfBridge).map(([key, value]) => [labels[key], n(value, 3)]));
  out += `桥中非租赁营运项目合计 ${n(f.workingCapitalExcludingLeases, 3)}百万；只移除退租现金后经营现金 ${n(f.ocfExcludingTermination, 3)}百万；再移除这些营运项目后 ${n(f.beforeWorkingCapitalAndTermination, 3)}百万。${a.note}\n\n${sources(a.sources)}\n\n`;
  out += '### 项目合同：额度不是已到账现金\n\n';
  out += table(['acCELLerate合同附件', '金额 / 百万美元'], [
    ['精确总额', n(w.maximum, 8)], ['已落实', n(w.obligated, 3)], ['待后续落实', n(w.unfunded, 8)], ['约定公司配套份额', n(w.costShare)]
  ]);
  out += `基础期间 ${w.agreementDate} 至 ${w.baseEnd}。${w.note}\n\n${sources(w.sources)}\n\n`;
  out += '### 股份核验：到期、行权现金和预留额度\n\n';
  out += table(['6月底潜在证券', '百万股', '原行权价 / 美元', '全部现金行权 / 百万美元'], [
    ...d.warrants.map(w => [w.label, n(w.shares, 6), n(w.strike), n(w.shares * w.strike, 6)]),
    ['期权', n(d.options, 6), '缺逐笔有效行权价，未假定收款', '未计'],
    ['RSU', n(d.rsus, 6), '归属条件', '无行权现金']
  ]);
  out += `权证共同到期日 ${d.expiry}。${d.note}\n\n${d.postQuarterNote}\n\n[检索目录与${d.inventoryCount}项申报记录](ampx-filings-2026-10-18.json)，检索区间为8月1日至10月18日；这是有边界的公开披露核验，不是实时股东名册。\n\n${sources(d.sources)}\n\n`;
  return out;
}

export function annualFunding(c, M, sources, n) {
  const f = c.liquidityCheck;
  if (!f) return '';
  let out = '### 逐年融资敏感性：中途现金不能只看2031终点\n\n**' + f.headline + '**\n\n';
  out += f.basis.map(t => '- ' + t).join('\n') + '\n\n';
  out += table(['期间 / 全为研究假设', '本期收入', '期末营运占用的全年收入基数', '折旧摊销', '非现金SBC', '其他现金调整', '商业资本开支'],
    f.periods.map(p => [p.label, ...[p.revenue, p.annualRevenue, p.depreciation, p.stockComp, p.otherCashAdjustment, p.capex].map(v => n(v, 3))]));
  out += '上表及后续现金表均为百万美元。2026H2只包含半年流量；期末营运资金按2026全年140百万收入基数计算。后续年度流量为全年；用2031年度经营量级作五年终点估值参照，不称其为2031-10-16已实现的全年结果。\n\n';
  for (const r of f.routes) {
    const x = M.liquidityProjection(c, r, 4);
    out += `#### ${r.label}\n\n`;
    out += table(['期间', 'GAAP净利率', '营运占用/收入', '净利润', '营运变动前现金', '新增营运占用', '资本开支', '项目支出', '项目回款', '新增股权资金', '期末现金'],
      x.rows.map((row, i) => [row.label, n(r.netMargins[i] * 100) + '%', n(r.workingCapitalRatios[i] * 100) + '%',
        ...[row.netIncome, row.cashBeforeWorkingCapital, row.workingCapitalChange, row.capex, row.projectSpend, row.projectReceipts, row.raised, row.cash].map(v => n(v, 3))]));
  }
  out += '#### 发行价格与每股回报\n\n相同终点仍假定10亿美元收入、15%归母净利率、30倍PE、零分红。股份=已发行+既有潜在+未来激励+逐期筹资/净发行价。不同发行价格不改变资金缺口，却改变每股终值；较好现金路径也不意味着可以把原2.1亿股情景自动升级。\n\n';
  out += table(['现金路径', '净发行价 / 美元', '累计筹资 / 百万美元', '融资新股 / 百万', '全部期末股份 / 百万', '相对原210百万股余量', '终点每股 / 美元', '股价倍数'], f.routes.flatMap(r => f.netIssuePrices.map(price => {
    const x = M.liquidityProjection(c, r, price);
    return [r.label, price, n(x.totalRaised, 3), n(x.newShares, 3), n(x.shares, 3), n(x.shareHeadroom, 3), n(x.terminal.price), n(x.terminal.priceMultiple) + '×'];
  })));
  const delayed = f.routes.find(r => r.id === 'delayed'), d = c.dilutionAudit;
  const cashExercise = d.warrants.reduce((sum, w) => sum + w.shares * w.strike, 0);
  const allWarrants = d.warrants.reduce((sum, w) => sum + w.shares, 0);
  const branches = [
    ['不承诺行权现金、保留全部潜在股数压力', {}],
    ['权证全部失效，移除对应潜在股数', { potentialShares: c.shares.knownPotential - allWarrants }],
    ['权证全部按原价于2027现金行权', { exerciseCash: f.periods.map(p => p.label === '2027' ? cashExercise : 0) }],
    ['未来激励改为20百万股，其余同默认压力', { futureAwards: f.awardSensitivity }]
  ];
  out += '#### 权证与激励的条件分支\n\n均沿用“盈利推迟两年”和4美元净发行价。全部现金行权只测算一条有条件的资金来源：到期前股价、持有人选择及条款需配合，全年模型也无法保证行权早于现金缺口。失效分支没有现金，也不继续保留这些权证股数。\n\n';
  out += table(['分支', '另需股权筹资 / 百万美元', '期末股数 / 百万', '每股价格 / 美元', '股价倍数'], branches.map(([label, options]) => {
    const x = M.liquidityProjection(c, delayed, 4, options);
    return [label, n(x.totalRaised, 3), n(x.shares, 3), n(x.terminal.price), n(x.terminal.priceMultiple) + '×'];
  }));
  out += f.caveat + '\n\n' + sources(f.sources) + '\n\n';
  return out;
}
