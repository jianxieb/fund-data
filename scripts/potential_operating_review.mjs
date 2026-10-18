// Reverse requirements are diagnostic hurdles, not earnings forecasts.
export function tenfoldRequirements(price, shares, pe) {
  if (![price, shares, pe].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid tenfold requirement input');
  return { price: price * 10, equity: price * 10 * shares, profit: price * 10 * shares / pe, profitPerNewMillionShares: price * 10 / pe };
}

export function organicGrowth(current, acquired, prior) {
  if (![current, acquired, prior].every(Number.isFinite) || prior <= 0 || acquired < 0 || acquired > current) throw new Error('Invalid organic revenue bridge');
  return (current - acquired) / prior - 1;
}

export function integrationHurdle(neededProfit, b) {
  if (![neededProfit, b.revenue, b.grossProfit, b.halfYearPretax, b.taxRate].every(Number.isFinite) || b.revenue <= 0 || b.grossProfit <= 0 || b.taxRate < 0 || b.taxRate >= 1) throw new Error('Invalid integration hurdle input');
  const grossMargin = b.grossProfit / b.revenue;
  const normalizedAnnualProfit = b.halfYearPretax * 2 * (1 - b.taxRate);
  return { grossMargin, normalizedAnnualProfit, additionalRevenue: Math.max(0, neededProfit - normalizedAnnualProfit) / (grossMargin * (1 - b.taxRate)) };
}

export function operatingReviewSections(c) {
  const r = c.research, h = r.hurdle;
  const n = (v, d = 2) => v.toLocaleString('zh-CN', { maximumFractionDigits: d });
  if (!h.sources?.length || !h.shareBasis || h.peCases.some(p => !p.reason)) throw new Error(c.id + ': missing hurdle evidence');
  if (r.inputs.some(x => !x.evidence || !x.use || !x.gap || !x.sources?.length)) throw new Error(c.id + ': incomplete operating input evidence');
  const cases = h.peCases.map(p => ({ ...p, ...tenfoldRequirements(c.quote.priceUsd, h.shares, p.pe) }));
  const bridge = r.revenueBridge;
  const revenueSections = bridge ? [{ title: '49%增长中，多少来自原有业务',
    paragraphs: ['按公司披露的ESI并入收入从当期总收入中扣除，再与原公司同期比较。这是报告口径下的并购剔除计算，不代表已消除所有价格、汇率或协同效应。'],
    headers: ['2026Q2 / 百万美元', '金额或增速'],
    rows: [['合并收入', n(bridge.current, 3)], ['其中收购ESI并入', n(bridge.acquired, 3)], ['扣ESI后原有业务收入', n(bridge.current - bridge.acquired, 3)], ['2025Q2原公司收入', n(bridge.prior, 3)], ['原有业务同比', n(organicGrowth(bridge.current, bridge.acquired, bridge.prior) * 100) + '%']],
    sources: bridge.sources
  }] : [];
  const sections = [...revenueSections, ...r.evidenceSections, {
    title: '当前价格要求多大的利润',
    paragraphs: [h.shareBasis, '下表是十倍股价的反算门槛，不是2031年利润或股价预测。10、20、40倍PE用于检验估值依赖，没有选定一个“最终PE”；40倍一列也不表示公司值得40倍。以披露股数保持不变反算，未计未来奖励或融资，不能当作完全摊薄结果。分红、汇率和交易费用不在股价倍数内。'],
    headers: ['终点PE压力值', '使用这一档要面对什么', '所需年净利润 / 百万美元', '每新增100万股再需净利 / 百万美元'],
    rows: cases.map(p => [p.pe + '倍', p.reason, n(p.profit), n(p.profitPerNewMillionShares)]),
    sources: h.sources, proseTable: true
  }];
  if (r.integrationBridge) {
    const b = r.integrationBridge;
    sections.push({ title: '利润率变化能否让收入少于十倍',
      paragraphs: ['可以，利润率和业务组合都会改变结果。但需要检验利润能否留在公司。下表只做偏宽松的量级检验：保留2026H1税前利润的年化量级，将新增收入全部视为系统集成服务，毛利率维持2026Q2实际水平，额外管理费用、融资费用均为零。它忽略了新增产能、人员与营运资金的压力，不能作为经营预测。', '基期税前利润4.512百万美元×2，再按公司披露的2026下半年预计正常税率27.5%换算为6.54百万美元；这既不是2026全年指引，也不是2031税率承诺。系统集成基期半年收入28.245百万美元，机械年化为56.49百万美元，只用于比较量级。'],
      headers: ['终点PE压力值', '需额外系统集成年收入 / 百万美元', '含基期的服务收入量级 / 百万美元'],
      rows: cases.map(p => { const x = integrationHurdle(p.profit, b); return [p.pe + '倍', n(x.additionalRevenue), n(x.additionalRevenue + b.halfYearRevenue * 2)]; }),
      sources: b.sources,
      notes: ['新增毛利按4.439÷14.169＝31.33%计算，已含收入成本中的折旧。采购及设施业务保持原利润量级仅用于隔离变量，没有预测它们不变。', '即使总营收不必十倍，服务业务仍需显著放大。公开资料没有相应机柜数量、单柜收费和扩产回报，不能把反算结果写成客户会购买的数量。']
    });
  }
  sections.push({ title: '每项经营输入：依据、用途与缺口', collapsed: true,
    paragraphs: ['只有已披露数字用于财务拆分。缺少客户采用、价格或资金依据的项保持空缺，不用所谓乐观情景补数。'],
    headers: ['输入', '已有依据', '本轮如何使用', '尚缺什么', '来源'],
    rows: r.inputs.map(x => [x.label, x.evidence, x.use, x.gap]), rowSources: r.inputs.map(x => x.sources), proseTable: true });
  return sections;
}
