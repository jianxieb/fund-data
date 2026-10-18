// Diagnostic-device research uses millions of CNY; test volumes retain 万人份.
const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';

export function diagnosticAudit(c, sources, n) {
  const a = c.diagnosticAudit;
  if (!a) return '';
  const h = a.history, f = a.cash, g = a.goodwill;
  const ttm = key => h.annual[key] + h.current[key] - h.prior[key];
  const pct = v => n(v * 100) + '%';
  const moneyRows = rows => rows.map(([label, ...values]) => [label, ...values.map(v => n(v, 4))]);
  let out = '\n### 试剂收入与量价：先识别增长来自哪里\n\n金额为百万人民币；试剂销量为万人份，不代表独立患者。\n\n';
  out += table(['业务', '2025收入', '2024收入', '变化'], a.mainRevenue.map(p => [p.label, n(p.current, 4), n(p.prior, 4), pct(p.current / p.prior - 1)]));
  out += `试剂占IVD收入 ${pct(a.reagentRevenue / a.ivdRevenue)}，占主营收入 ${pct(a.reagentRevenue / a.mainRevenueTotal)}。分项沿用问询万元精度，合计允许四舍五入尾差；主营不是全部营业收入。\n\n`;
  out += table(['2025主要产品', '收入', '收入变化', '销量变化', '均价变化'], a.products.map(p => [p.label, n(p.revenue, 4), pct(p.revenueGrowth), pct(p.volumeGrowth), pct(p.priceGrowth)]));
  out += '三个主要平台合计占IVD收入约95.68%，不代表全部IVD。量价关系以(1+销量变化)×(1+均价变化)复核，百分数披露到两位小数。均价变化也含产品结构变化。\n\n' + sources(['pumen-inquiry', 'pumen-auditor']) + '\n\n';
  out += '### 新增装机、境外出货与试剂销量\n\n';
  out += table(['产品/地区', '仪器口径', '2025台数', '2024台数', '2025试剂/万人份', '2024试剂/万人份'], a.installations.map(p => [p.label, p.deviceBasis === 'new_domestic_installations' ? '当年新增装机' : '境外出货', ...p.devices.map(v => v === null ? '原表未列（—）' : n(v, 0)), ...p.reagents.map(v => n(v, 2))]));
  out += a.installationNote + '\n\n' + a.regionNote + '\n\n' + a.production.note + '\n\n' + sources(['pumen-inquiry']) + '\n\n';
  out += '### 历史利润与归母变动桥\n\n';
  out += table(['指标', h.annual.label, h.prior.label, h.current.label, 'TTM至2026-06-30'], [['收入','revenue'],['归母利润','netIncome'],['经营现金','operatingCash']].map(([label,key])=>[label,...[h.annual[key],h.prior[key],h.current[key],ttm(key)].map(v=>n(v,4))]));
  out += `TTM归母净利率 ${pct(ttm('netIncome') / ttm('revenue'))}。以下将收益列正、费用列负；少数股东亏损加回归母。\n\n`;
  out += table(['归母构成/百万元', '2026H1', '2025H1', '同比贡献变化'], a.profitRows.map(p=>[p.label,n(p.current,4),n(p.prior,4),n(p.current-p.prior,4)]));
  out += table(['财务费用附注/费用正数', '2026H1', '2025H1', '费用变化'], a.financeRows.map(p=>[p.label,n(p.current,4),n(p.prior,4),n(p.current-p.prior,4)]));
  out += a.profitNote + '\n\n' + sources(['pumen','pumen-2025','pumen-ir']) + '\n\n';
  out += '### 现金可用性与资本分配\n\n';
  out += table(['货币资金组成/百万元', '2026-06-30'], moneyRows([['现金及等价物',f.end],['定期存款',f.termDeposits],['应计利息',f.accruedInterest],['诉讼冻结',f.frozen],['货币资金合计',f.monetaryFunds],['短期银行借款',f.shortDebtEnd],['现金及等价物减银行借款',f.end-f.shortDebtEnd],['另列租赁负债',f.leases],['外币货币资金折人民币',f.foreignCurrencyCash],['其中美元货币资金折人民币',f.usdCashInCny]]));
  out += table(['现金流总桥/百万元', '2026H1'], moneyRows([['期初现金及等价物',f.start],['经营现金',f.operating],['投资现金',f.investing],['筹资现金',f.financing],['汇率影响',f.fx],['期末现金及等价物',f.end]]));
  out += table(['来源与用途/百万元', '2026H1'], moneyRows([['经营现金减长期资产购建',f.operating-f.capex],['长期资产购建',f.capex],['其他投资收款',f.investmentReceipts],['其他投资付款',f.investmentPayments],['资产处置收款',f.assetDisposalCash],['借款收现',f.borrowed],['偿还银行借款',f.repaid],['分红及付息现金',f.dividendsAndInterest],['其他筹资付款',f.otherFinancingOut]]));
  out += `短借 ${n(f.shortDebtStart,3)} + 借入 ${n(f.borrowed,3)} − 偿还 ${n(f.repaid,3)} = ${n(f.shortDebtEnd,3)}。其他投资收款减付款及购建、加资产处置收款，对至投资净额；筹资支出不在经营现金中重复扣除。\n\n${a.cashNote}\n\n${sources(['pumen','pumen-inquiry','pumen-cash-management'])}\n\n`;
  out += '### 收购与建设：管理层的资本回报记录\n\n';
  out += table(['已全额减值的业务', '商誉原值', '累计减值'], g.selected.map(p=>[p.label,n(p.original,4),n(p.impairment,4)]));
  out += `2025商誉减值准备 ${n(g.openingProvision,4)} + 当年计提 ${n(g.annualCharge,4)} − 优力威处置 ${n(g.disposedImpaired,4)} = ${n(g.endingProvision,4)}；年末商誉原值 ${n(g.endingGross,4)} − 减值准备 = 净额 ${n(g.endingNet,4)}。\n\n`;
  out += `智信母公司往来借款 ${n(g.zhixinParentLoan,4)}；南京总部在建 ${n(g.nanjingCip,4)}、累计含税付款 ${n(g.nanjingPaid,4)}、应付账款 ${n(g.nanjingPayable,4)}。${g.note}\n\n${sources(['pumen-inquiry','pumen-auditor','pumen-2025'])}\n\n`;
  out += '### 海外商业路径：准入、订单与回款分别验证\n\n';
  out += table(['路径', '日期', '已验证', '未验证边界'], a.commercial.map(p=>[p.label,p.date,p.evidence,p.boundary]));
  out += sources([...new Set(a.commercial.flatMap(p=>p.sources))]) + '\n\n';
  out += '### 18亿元试剂情景的产品与价格压力\n\n';
  out += table(['研究拆解/百万元', '2025实际', '2031假设', '六年收入CAGR', ...a.priceChanges.map(p=>'均价年变动'+pct(p)+'时所需销量CAGR')], a.reagentTargets.map(p=>{const factor=(p.target/p.base)**(1/a.targetYears);return[p.label,n(p.base,4),n(p.target),pct(factor-1),...a.priceChanges.map(change=>pct(factor/(1+change)-1))];}));
  out += a.targetNote + '\n\n' + sources(['pumen-inquiry','pumen-quidel']) + '\n\n';
  out += '### 半年后股本与公告核验\n\n';
  out += `${a.shares.confirmedDate}公告再次确认总股本 ${n(a.shares.confirmedIssued,0)}股；2024/2026期权行权价 ${a.shares.exercisePrices.join('/')}元。潜在余额仍标为 ${a.shares.knownPotentialDate}。${a.shares.note}\n\n`;
  out += `[7月以来${a.shares.directoryCount}项公告索引](pumen-filings-2026-10-18.json)。7月个人增持计划为1000万–3000万元，不能作公司融资；10月候选资料持股比例高于7月披露，但不据比例倒推出精确成交金额或宣布计划完成。\n\n${sources(['pumen-exercise-q2','pumen-insider-sale','pumen-filings','pumen-buy-plan','pumen-board'])}\n\n`;
  return out;
}
