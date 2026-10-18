#!/usr/bin/env node
// One reviewed dataset feeds both the application and the downloadable research.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const M = require('../assets/potential-model.js');
const data = JSON.parse(readFileSync(resolve(root, 'data/potential-stocks.json'), 'utf8'));
const n = (x, d = 2) => x.toLocaleString('zh-CN', { maximumFractionDigits: d });
const sources = ids => ids.map(id => { const s = data.sources.find(x => x.id === id); if (!s) throw new Error('Unknown source: ' + id); return `[${s.title}](${s.url})（公布 ${s.publishedAt}；报告期 ${s.period}；${s.locator}）`; }).join('；');
let md = `# 五年潜力股研究 · ${data.reviewedAt} · 修订${data.revision}\n\n研究起点：${data.priceDate}收盘；终点：${data.horizonDate}。美国普通股使用美元，A股使用人民币。\n\n${data.summary}\n\n没有可信成功概率，不做概率加权目标价。\n\n`;
md += '## 本次复核与撤回记录\n\n' + data.revisions.map(r => `${r.date}：${r.reason} 原版见 Git 提交 \`${r.previousCommit}\`。`).join('\n\n') + '\n\n';
md += '## 口径与取舍\n\n' + Object.values(data.method).join('\n\n') + '\n\n';
md += '研究先比较商业化、单位经济、竞争与资本配置，再反算终点。不是按市值或过去增长率打分。其余备选公司的证据没有达到同等深度，未入选不意味着公司能力不存在。行业容量部分明确包含研究假设，不能把模型可计算理解为需求已验证。\n\n';
md += '| 公司 | 研究优先级 | 起始价 | 悲观股价倍数 | 基准股价倍数 | 乐观股价倍数 | 十倍所需收入CAGR |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n';
for (const c of data.companies) {
  const h = M.hurdle(c, M.scenario(c, 'bull'));
  md += `| ${c.name} ${c.id} | ${c.status === 'priority' ? '优先补证' : '边界观察'} | ${c.currency} ${n(c.price.value)} | ${c.scenarios.map(s => n(M.project(c, s).priceMultiple) + '×').join(' | ')} | ${n(h.revenueCagr * 100)}% |\n`;
}
for (const c of data.companies) {
  const f = c.financials, bull = M.scenario(c, 'bull'), h = M.hurdle(c, bull);
  const amount = x => n(x / 100) + '亿' + (c.currency === 'USD' ? '美元' : '元');
  md += `\n## ${c.name} · ${c.id}\n\n**${c.decision}**\n\n${c.tagline}。\n\n### 已验证事实与财务\n\n`;
  md += `股价 ${c.price.value}（${c.price.asOf}常规交易收盘、未复权）；来源：[Yahoo Finance](${c.price.url})。已发行股数 ${n(c.shares.value, 6)}百万股，股本截至 ${c.shares.asOf}；不是同日报价市值。\n\n`;
  md += `${f.label}：收入 ${amount(f.revenue)}，归母/普通股利润 ${amount(f.netIncome)}，经营现金流 ${amount(f.operatingCash)}，现金口径 ${amount(f.cash)}，借款口径 ${amount(f.debt)}。利润口径：${f.netIncomeBasis}。债务口径：${f.debtBasis}。\n\n${sources([f.source])}\n\n`;
  for (const fact of c.facts) md += `- 已发生：${fact.text} ${sources(fact.sources)}\n`;
  if (c.earningsAdjustment) {
    const a = c.earningsAdjustment;
    md += `\n毛利复算（百万原币）：(${a.revenue} − ${a.reportedCost} − ${a.costBenefit}) / ${a.revenue} = ${n(M.adjustedGrossMargin(a.revenue, a.reportedCost, a.costBenefit) * 100)}%。上年同季亦去除${a.priorBenefitLabel}：(${a.priorRevenue} − ${a.priorReportedCost} − ${a.priorCostBenefit}) / ${a.priorRevenue} = ${n(M.adjustedGrossMargin(a.priorRevenue, a.priorReportedCost, a.priorCostBenefit) * 100)}%。仅调整明确抵减项，不冒充完全有机或标准化毛利。\n`;
  }
  if (c.productCheck) {
    const a = c.productCheck, total = xs => xs.reduce((v, x) => v + x, 0);
    md += '\n| 眼科产品 / 百万人民币 | 2026H1 | 2025H1 |\n| --- | ---: | ---: |\n' + a.labels.map((label, i) => `| ${label} | ${n(a.current[i], 4)} | ${n(a.prior[i], 4)} |`).join('\n');
    md += `\n\n同项合计 ${n(total(a.current), 4)} / ${n(total(a.prior), 4)}，增长 ${n((total(a.current) / total(a.prior) - 1) * 100)}%。不含运动医学及“其他收入”，不等同全部并购调整后的有机增长。\n`;
  }
  if (c.profitCheck) {
    const a = c.profitCheck, current = M.investmentProfit(a.current), prior = M.investmentProfit(a.prior);
    const rows = [
      ['GAAP归母利润', a.current.reportedParentNet, a.prior.reportedParentNet],
      ['集团未实现投资收益', a.current.consolidatedGain, a.prior.consolidatedGain],
      ['其中归属于少数股东的调整额', a.current.minorityGain, a.prior.minorityGain],
      ['归母未实现投资收益调整额', current.parentGain, prior.parentGain],
      ['扣除上述收益，保留股权薪酬', current.withoutGain, prior.withoutGain],
      ['公司加回的股权薪酬', a.current.stockComp, a.prior.stockComp],
      ['公司non-GAAP归母利润', a.current.issuerNonGaap, a.prior.issuerNonGaap],
      ['集团权益法投资收益（尚未按归母拆分）', a.current.equityIncome, a.prior.equityIncome],
      ['集团营业利润', a.current.operatingIncome, a.prior.operatingIncome]
    ];
    md += `\n### 归母利润复核\n\n| 百万原币 | ${a.current.label} | ${a.prior.label} |\n| --- | ---: | ---: |\n` + rows.map(([label, x, y]) => `| ${label} | ${n(x, 3)} | ${n(y, 3)} |`).join('\n');
    md += `\n\n扣除上述投资收益后同比增长 ${n((current.withoutGain / prior.withoutGain - 1) * 100)}%，归母利润率 ${n(current.margin * 100)}%；集团营业利润率 ${n(a.current.operatingIncome / a.current.revenue * 100)}%。${a.caveat}\n\n${sources(a.sources)}\n`;
  }
  if (c.cashCheck) {
    const a = c.cashCheck;
    const rows = [['经营现金流', a.operatingCash], ['购建固定资产支出', -a.capex],
      ['经营现金减固定资产支出', a.operatingCash - a.capex], ['公司定义FCF（再扣长期投资）', a.issuerFcf],
      ['母公司发行净筹资', a.parentEquityProceeds], ['出售子公司股权税前收入', a.subsidiarySaleGross],
      ['银行净借款', a.shortBorrowed - a.shortRepaid + a.longBorrowed - a.longRepaid],
      ['集团期权行权收入', a.optionProceeds], ['融资现金合计', a.financingTotal]];
    md += '\n### 现金来源与去向\n\n| 2026H1项目 | 百万原币 |\n| --- | ---: |\n' + rows.map(([label, value]) => `| ${label} | ${n(value, 3)} |`).join('\n');
    md += `\n\n存货现金占用 ${n(a.inventoryOutflow, 3)}百万，客户预收减少占用 ${n(a.advanceOutflow, 3)}百万。现金及等价物 ${n(a.cash, 3)}百万，短期定存 ${n(a.timeDeposits, 3)}百万，另有受限现金 ${n(a.restrictedCash, 3)}百万。现金及等价物按所在地：${Object.entries(a.jurisdictions).map(([label, v]) => `${label} ${n(v, 3)}百万`).join('；')}。地域不等于法律所有权，不能按所在地直接分配给母公司股东。\n\n${a.caveat}\n\n${sources(a.sources)}\n`;
  }
  md += '\n### 管理层指引与研究假设\n\n';
  md += c.guidance.length ? c.guidance.map(g => `- 管理层指引：${g.text} ${sources(g.sources)}`).join('\n') : '未将未核实的全年经营目标设为公司指引。';
  md += `\n\n收入增长锚点：${f.anchorLabel}，金额 ${amount(f.anchorRevenue)}。下面所有2031参数、行业份额和里程碑阈值均为研究者假设，不是公司承诺或外部一致预期。\n\n### 经营路径、竞争与资本配置\n\n${c.thesis.join('\n\n')}\n\n${c.economics}\n\n${c.management}\n\n${c.funding}\n\n${sources(c.fundingSources)}\n\n### 股本与稀释\n\n${c.shares.potentialBasis}\n\n${c.shares.futureBasis}\n\n${c.shares.convertibles}\n\n具体缺项：${c.shares.gap}\n\n`;
  md += sources(c.shares.sources || [c.shares.source]) + '\n\n### 五年情景\n\n';
  if (c.ownershipCheck) {
    const o = c.ownershipCheck;
    md += `子公司稀释压力：持股 ${n(o.ownership * 100)}%，若H股占发行后 ${n(o.proposedFraction * 100)}%，新股/原股为 ${n(o.proposedFraction / (1 - o.proposedFraction) * 100, 4)}%。母公司不认购时，持股变为 ${n(M.subsidiaryOwnership(o.ownership, o.proposedFraction) * 100, 4)}%；再按初始H股的 ${n(o.overAllotment * 100)}%超额配售，变为 ${n(M.subsidiaryOwnership(o.ownership, o.proposedFraction, o.overAllotment) * 100, 4)}%。${o.caveat}\n\n${sources(o.sources)}\n\n`;
  }
  md += '参数根据与未验证条件：\n\n' + c.calibration.map(a => `- **${a.label}**：${a.basis} ${sources(a.sources)}`).join('\n') + '\n\n';
  md += `金额为亿${c.currency === 'USD' ? '美元' : '元'}；股数为百万股；分红为五年累计每股原币现金。\n\n| 情景 | 收入 | 归母净利率 | 归母利润 | 期末股数 | PE | 股权价值 | 每股价格 | 每股现金分红 | 股价倍数 | 含现金分红财富倍数 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const s of c.scenarios) {
    const p = M.project(c, s);
    md += `| ${s.label} | ${n(s.revenue / 100)} | ${n(s.margin * 100)}% | ${n(p.profit / 100)} | ${n(s.shares)} | ${s.pe ?? '亏损残值'} | ${n(p.equity / 100)} | ${n(p.price)} | ${n(s.dividends)} | ${n(p.priceMultiple)}× | ${n(p.totalMultiple)}× |\n`;
  }
  md += '\n' + c.scenarios.map(s => `- ${s.label}：${s.story}`).join('\n') + '\n\n';
  const prior = c.priorBull;
  if (prior) md += `**已撤回旧乐观组合**：收入 ${amount(prior.revenue)}、净利率 ${n(prior.margin * 100)}%、PE ${prior.pe}、股数 ${n(prior.shares)}百万，原计算 ${n(M.project(c, prior).priceMultiple)}倍；仅供追溯，不与当前经营情景并列。当前乐观情景 ${n(M.project(c, bull).priceMultiple)}倍，未用十倍目标倒逼参数。\n\n`;
  if (c.financingCheck) {
    const f = c.financingCheck;
    md += `### 融资敏感性：先检查营运资金\n\n截至${f.asOf}，简化营运资金 = 应收 ${f.receivables} + 存货 ${f.inventory} − 应付 ${f.payables} = ${n(f.receivables + f.inventory - f.payables)}百万原币。收入用H1简单年化 ${f.annualizedRevenue}百万；起点现金 ${f.cash}百万。预留未来激励 ${f.reservedFutureAwards}百万股，既有潜在股份 ${c.shares.knownPotential}百万股也不能当作新增现金发行。\n\n`;
    md += '| 终点营运资金/收入 | 净发行价/股 | 可融资新股/百万 | 假设筹资/百万 | 额外营运资金/百万 | 其他现金流前余额/百万 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n';
    for (const ratio of f.ratios) for (const price of f.netIssuePrices) {
      const x = M.fundingStress(c, bull, ratio, price);
      md += `| ${n(ratio * 100)}% | ${price} | ${n(x.fundingShares, 6)} | ${n(x.proceeds)} | ${n(x.additionalWorkingCapital)} | ${n(x.balanceBeforeOtherFlows)} |\n`;
    }
    md += `\n${f.caveat} 负值说明在这些条件下，仅营运资金就需要更多现金来源；正值也不等于资金已足够。\n\n${sources(f.sources)}\n\n`;
  }
  md += `**十倍反算**：每股价格需 ${n(h.price)}；按乐观期末 ${n(bull.shares)}百万股，股权价值需 ${amount(h.equity)}，相对起始股本折算值为 ${n(h.capitalMultiple)}倍。用 ${bull.pe}倍PE与 ${n(bull.margin * 100)}%归母净利率，需利润 ${amount(h.profit)}、收入 ${amount(h.revenue)}，收入五年CAGR ${n(h.revenueCagr * 100)}%。\n\n若终值PE下降25%，乐观股价倍数变为 ${n(M.project(c, { ...bull, pe: bull.pe * .75 }).priceMultiple)}倍；若期末股数再增20%，变为 ${n(M.project(c, { ...bull, shares: bull.shares * 1.2 }).priceMultiple)}倍。两项同时发生则为 ${n(M.project(c, { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }).priceMultiple)}倍。分红不用于掩盖股价十倍未达标。\n\n### 市场容量与单位经济反查\n\n${c.marketTest.headline}\n\n`;
  if (c.marketTest.kind === 'segment_growth') {
    md += '| 产品线 / 亿原币 | 2025H1 | 2026H1 | 同比 | 2026H1简单年化 | 2031假设 | 所需五年增速 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n' + c.marketTest.parts.map(p => `| ${p.label} | ${n(p.priorRevenue / 100, 3)} | ${n(p.reportedRevenue / 100, 3)} | ${n((p.reportedRevenue / p.priorRevenue - 1) * 100)}% | ${n(p.baseRevenue / 100, 3)} | ${n(p.revenue / 100)} | ${n(((p.revenue / p.baseRevenue) ** (1 / data.horizonYears) - 1) * 100)}% |`).join('\n');
  } else md += '| 收入组成（2031假设） | 数量 | 单位净收入 | 收入 / 亿原币 |\n| --- | ---: | ---: | ---: |\n' + c.marketTest.parts.map(p => `| ${p.label} | ${n(p.units)} ${p.unitLabel} | ${n(p.price)} | ${n(p.revenue / 100)} |`).join('\n');
  md += `\n\n${c.marketTest.assumptions}\n\n${c.marketTest.boundary}\n\n缺项：${c.marketTest.gap}\n\n${sources(c.marketTest.sources)}\n\n### 验证里程碑与撤回信号\n\n`;
  md += c.milestones.map(m => `- ${m.when}：${m.test}`).join('\n') + '\n\n撤回或下修：\n\n' + c.withdraw.map(t => '- ' + t).join('\n');
  md += '\n\n尚缺的具体证据：\n\n' + c.gaps.map(t => '- ' + t).join('\n') + '\n\n### 为什么不选常见替代\n\n';
  md += c.alternatives.map(a => `- **${a.name}**：${a.reason} ${sources(a.sources)}`.trimEnd()).join('\n') + '\n';
}
function comparisonAudit(c) {
  const a = c.audit;
  if (!a) return '';
  const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
  let out = '#### 财年与过渡期\n\n';
  out += table(['报告期间', '开始', '结束', '长度'], a.periods.map(p => [p.label, p.start, p.end, `${p.days}天 / ${p.days / 7}周`]));
  out += a.periodNote + '\n\n' + sources(['aehr-calendar', 'aehr-next']) + '\n\n';
  const r = a.productRevenue;
  out += '#### 设备、接触器与服务：先核验复购\n\n';
  out += table(['百万美元', ...r.periods, 'FY2026同比'], [...r.rows, { label: '合计', values: r.total }, { label: '其中随时间确认的服务', values: r.overTime }].map(p => [p.label, ...p.values.map(v => n(v, 3)), n((p.values[0] / p.values[1] - 1) * 100) + '%']));
  out += r.note + '\n\n' + sources(['aehr-k']) + '\n\n';
  const e = a.earnings;
  out += '#### GAAP盈利与税项\n\n';
  out += table(['FY2026项目', '百万美元'], [
    ['收入', e.revenue], ['毛利', e.grossProfit], ['研发', -e.rd], ['销售及管理', -e.sga], ['重组费用', -e.restructuring],
    ['营业利润', e.operating], ['净利息收入', e.interest], ['其他净收入', e.other], ['税前利润', e.pretax], ['所得税收益', e.taxBenefit], ['净利润', e.net], ['股权薪酬（已含在成本费用）', e.stockComp], ['期末净递延税资产（资产余额）', e.deferredTaxAsset]
  ].map(([label, value]) => [label, n(value, 3)]));
  out += `Q4营业利润 ${n(e.q4.operating, 3)}百万、税前利润 ${n(e.q4.pretax, 3)}百万、税惠 ${n(e.q4.taxBenefit, 3)}百万，净利润 ${n(e.q4.net, 3)}百万。${e.note}\n\n${sources(['aehr-k', 'aehr-results'])}\n\n`;
  const f = a.cash;
  out += '#### 现金桥与履约资金\n\n';
  out += table([f.period + '项目', '百万美元'], [
    ['期初现金及受限现金', f.startTotal], ['经营现金流', f.operating], ['固定资产支出', -f.capex], ['收购相关支付', -f.acquisitionPayment],
    ['投资现金流合计', f.investing], ['ATM发行净筹资', f.atmNet], ['员工计划发行收入', f.employeeProceeds], ['归属代扣税回购', -f.withholdingRepurchase],
    ['融资现金流合计', f.financing], ['汇兑变动', f.fx], ['期末现金及受限现金', f.endTotal], ['其中受限现金', f.restricted], ['经营现金减固定资产支出', f.operating - f.capex]
  ].map(([label, value]) => [label, n(value, 3)]));
  out += `应收 ${n(f.receivables, 3)} + 存货 ${n(f.inventory, 3)} − 应付 ${n(f.payables, 3)} = ${n(f.receivables + f.inventory - f.payables, 3)}百万美元；再减流动递延收入 ${n(f.deferredRevenueCurrent, 3)}，为 ${n(f.receivables + f.inventory - f.payables - f.deferredRevenueCurrent, 3)}百万美元。此为简化占用，未覆盖全部营运资金项目。\n\n${f.note}\n\n${sources(['aehr-k'])}\n\n`;
  const k = a.concentration;
  out += '#### 客户集中与订单边界\n\n';
  out += `前五大客户收入占比：${k.periods.map((p, i) => p + ' ' + n(k.topFiveRevenue[i] * 100) + '%').join('；')}。FY2026收入客户 ${k.revenueCustomers.map(p => p.id + ' ' + n(p.share * 100) + '%').join('、')}；2026-05-29应收客户 ${k.receivableCustomers.map(p => p.id + ' ' + n(p.share * 100) + '%').join('、')}，三者合计 ${n(k.receivableCustomers.reduce((sum, p) => sum + p.share, 0) * 100)}%。${k.note}\n\n${sources(['aehr-k'])}\n\n`;
  out += table(['时点', '事项', '百万美元', '口径'], a.orders.map(o => [o.date, o.label, (o.approximate ? '约' : '') + n(o.amount), o.basis]));
  out += a.orderNote + '\n\n' + sources([...new Set(a.orders.flatMap(o => o.sources))]) + '\n\n';
  const s = a.shareCheck;
  out += '#### 已发行股份与潜在股份分开\n\n';
  out += table(['时点', '已发行普通股 / 百万', '证据'], s.snapshots.map(p => [p.asOf, n(p.shares, 6), p.basis]));
  out += table(['FY2026激励滚动 / 百万股', '期初', '新授', '归属或行权', '取消', '期末'], [
    ['RSU及业绩RSU', s.rsu.begin, s.rsu.granted, s.rsu.vested, s.rsu.canceled, s.rsu.end],
    ['期权', s.options.begin, s.options.grantedRounded, s.options.exercised, s.options.canceled, s.options.end]
  ].map(([label, ...values]) => [label, ...values.map(v => n(v, 3))]));
  out += `截至${s.periodEnd}，已披露潜在奖励合计 ${n(s.reportedPotential, 3)}百万股；股权计划剩余 ${n(s.equityPlanReserve, 3)}百万、ESPP剩余 ${n(s.esppReserve, 3)}百万属于未来额度。FY2026 ATM分批发行 ${s.atmIssues.map(p => p.month + ' ' + n(p.shares, 6) + '百万股').join('、')}，合计 ${n(s.atmTotal, 6)}百万股，已包含在期末普通股中，不能再次加入。\n\n${s.note}\n\n${sources(['aehr-k', 'aehr-proxy'])}\n\n`;
  for (const note of a.businessNotes) out += '#### ' + note.title + '\n\n' + note.text + '\n\n' + sources(note.sources) + '\n\n';
  out += '#### 股价十倍门槛：检验未来分母\n\n' + a.valuationNote + '\n\n';
  out += table(['压力条件', '终点股数 / 百万', 'GAAP净利率', 'PE', '十倍所需年收入 / 亿美元', '相对FY2027指引中点'], a.hurdleCases.map(s => {
    const revenue = c.price.value * 10 * s.shares / s.pe / s.margin;
    return [s.label, n(s.shares, 6), n(s.margin * 100) + '%', s.pe, n(revenue / 100), n(revenue / c.anchorRevenue) + '×'];
  }));
  const example = M.project({ price: c.price, shares: { value: c.shares }, financials: { anchorRevenue: null } }, { ...a.scaleExample, dividends: 0 });
  out += `量级示例：收入 ${n(a.scaleExample.revenue / 100)}亿美元 × GAAP净利率 ${n(a.scaleExample.margin * 100)}% × PE ${a.scaleExample.pe} ÷ ${n(a.scaleExample.shares)}百万股 = 每股 ${n(example.price)}美元，相对起点 ${n(example.priceMultiple)}倍。${a.scaleNote}\n\n`;
  out += '#### 后续验证\n\n' + a.milestones.map(m => '- ' + m.when + '：' + m.test).join('\n') + '\n\n';
  return out;
}
md += '\n## 新增比较：经营证据与买入价格分别检验\n\n以下保留为比较观察，详细核验不会自动升级候选资格。Aehr与新产业默认使用已披露普通股作不再增股的下限压力；Aehr另列未来稀释敏感性。不同财年中点不作为统一五年增长起点。\n\n';
for (const c of data.comparisons) {
  const equity = c.price.value * 10 * c.shares, revenue = equity / c.pe / c.margin;
  md += `### ${c.name} · ${c.id}\n\n${c.facts}\n\n${sources(c.sources)}\n\n${c.judgment}\n\n起始收盘价 ${c.currency} ${n(c.price.value)}（${c.price.asOf}），[报价接口](${c.price.url})。股数 ${n(c.shares, 6)}百万，${c.shareDate ? '截至' + c.shareDate + '；未计未来稀释，故只是门槛下限' : c.shareBasis}。\n\n按归母净利率 ${n(c.margin * 100)}%、PE ${c.pe} 的研究假设，股价十倍需股权价值 ${n(equity / 100)}亿原币、收入 ${n(revenue / 100)}亿原币；相对“${c.anchorLabel}”的 ${n(c.anchorRevenue / 100)}亿原币为 ${n(revenue / c.anchorRevenue)}倍。不同期间比较仅看量级，不给成功概率。\n\n未完成：${c.gaps}\n\n下次核验：${c.next}\n\n`;
  md += comparisonAudit(c);
}
md += '## 剩余研究工作\n\n' + data.remainingWork.map(t => '- [ ] ' + t).join('\n') + '\n';
md += '\n## 复核与更新纪律\n\n报价原始接口、时点及近三个交易日观察另存 `data/potential-quotes.json`。市场报价来自数据供应商，财务来自公司公告；不声称已取得交易所逐笔行情。没有回测“成功率”，没有把财报未披露的单位经济当成已验证事实。已知股本日期落后报价；新增融资发生时先更新分母，再讨论目标价。\n\n候选与既有质量、成长、爆发、红利分类相互独立。本专题不改写既有分类结论。旧候选应保留版本和撤回理由，不因一次模型计算通过而自动升级研究结论。\n';
const outputs = new Map([
  ['data/potential-stocks.js', '// Generated by scripts/build_potential_research.mjs; edit potential-stocks.json.\nwindow.POTENTIAL_RESEARCH = ' + JSON.stringify(data) + ';\n'],
  ['docs/research/potential-stocks-2026-10-18.md', md]
]);
for (const [file, text] of outputs) {
  if (process.argv.includes('--check')) {
    if (readFileSync(resolve(root, file), 'utf8') !== text) throw new Error(file + ' 与研究数据不同步');
  } else writeFileSync(resolve(root, file), text);
}
console.log(`潜力研究：${data.companies.length}家公司，页面数据与研究文档${process.argv.includes('--check') ? '一致' : '已生成'}`);
