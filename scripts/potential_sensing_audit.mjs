// Ouster statements use millions of USD; procurement prices and share counts do not.
const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';

export function sensingAudit(c, sources, n) {
  const a = c.sensingAudit;
  if (!a) return '';
  const f = a.cash, k = a.customerContract, acq = a.acquisition, contracts = a.contracts, s = a.shares;
  const pct = x => n(x * 100) + '%';
  const money = rows => rows.map(([label, ...values]) => [label, ...values.map(x => n(x, 3))]);
  let out = '\n### 软件商业化：合同、交付与续费分别核验\n\n';
  out += table(['项目', '证据日期', '阶段', '证据', '边界'], a.commercial.map(r => [r.label, r.date, r.stage, r.evidence, r.boundary]));
  out += a.software.note + '\n\n' + a.software.recognition + '\n\n' + sources([...new Set(['oust-k', ...a.commercial.flatMap(r => r.sources)])]) + '\n\n';
  out += '### 客户采购附件：真实报价不等于厂家净收入\n\n';
  out += table(['合同6599268 / 美元', '客户单价', '单件运费'], k.priceRows.map(r => [r.label, n(r.price), n(r.shipping)]));
  out += k.note + '\n\n' + sources(['oust-nashville', 'oust-nashville-contract']) + '\n\n';
  out += '### 收入与并购范围\n\n';
  out += table(['报告期 / 百万美元', '本期报表', '上年报表', '报表增速', '本期备考', '上年备考', '备考增速'], a.revenue.map(r => [r.label, n(r.reported, 3), n(r.priorReported, 3), pct(r.reported/r.priorReported-1), n(r.proforma, 3), n(r.priorProforma, 3), pct(r.proforma/r.priorProforma-1)]));
  out += table(['报告期 / 百万美元', '本期产品', '上年产品', '本期IP许可费', '上年IP许可费'], a.revenue.map(r => [r.label, ...[r.product, r.priorProduct, r.royalty, r.priorRoyalty].map(v=>n(v,3))]));
  out += a.proformaNote + '\n\n';
  out += table(['H1备考损失调整 / 百万美元', '金额'], money(a.proformaNet.adjustments.map(r => [r.label, r.value])));
  out += `H1报表损失 ${n(a.proformaNet.reported,3)}百万，备考损失 ${n(a.proformaNet.proforma,3)}百万。${a.proformaNet.note}\n\n`;
  out += `客户E占H1收入 ${pct(a.concentration.revenueH1CustomerE)}、Q2 ${pct(a.concentration.revenueQ2CustomerE)}；客户F占Q2 ${pct(a.concentration.revenueQ2CustomerF)}。应收客户A/E分别占 ${pct(a.concentration.receivableA)}/${pct(a.concentration.receivableE)}，身份未公开，不用行业多样性抵销集中度。\n\n${sources(['oust-q'])}\n\n`;
  out += '### 现金桥与退款：到账和利润分开\n\n';
  out += table(['2026H1现金 / 百万美元', '金额'], money([['期初现金及受限现金',f.start],['经营现金',f.operating],['投资现金',f.investing],['融资现金',f.financing],['汇率影响',f.fx],['期末现金及受限现金',f.endIncludingRestricted],['其中现金及等价物',f.cashEquivalents],['其中受限现金',f.restrictedCurrent+f.restrictedNoncurrent],['另有短期投资',f.shortInvestments],['非受限现金及短期投资',f.cashEquivalents+f.shortInvestments]]));
  out += table(['净亏损至经营现金 / 百万美元', '金额'], money(a.cashRows));
  out += table(['投资与筹资分解 / 百万美元', '金额'], money([['资本开支付款',-f.capex],['购买短期投资',-f.investmentPurchases],['短期投资出售/到期',f.investmentMaturities],['净并购付款',-f.acquisitionNet],['ATM净收款行',f.atmNetLine],['另付ATM费用',-f.extraAtmFees],['ESPP购买收款',f.espp],['期权行权收款',f.options],['员工提供RSU税款',f.employeeTaxReceipts]]));
  out += table(['关税退款 / 百万美元', '金额'], money([['成本抵减收益',f.tariffProfitBenefit],['H1已到账',f.tariffCashReceived],['H1未到账本金约数',f.tariffUnreceivedRounded],['含息应收账面数',f.tariffReceivableWithInterest],['只移除已到账退款后的经营现金',f.operating-f.tariffCashReceived],['再减资本开支',f.operating-f.tariffCashReceived-f.capex]]));
  out += a.cashNote + `\n\nH1另有未付资本开支0.432百万，不能加入已付现金再扣一次。7月191.9百万发行收款为后续事件，不拼成10月现金；该数字扣除承销折佣，招股书另估发行费用后净额191.5百万，口径不同。第三方制造商/其他供应商不可撤销采购承诺 ${n(f.manufacturerCommitments)}/${n(f.otherCommitments)}百万，租赁负债 ${n(f.leaseLiabilities,3)}百万，均与银行借款分开。\n\n${sources(['oust-q','oust-offering'])}\n\n`;
  out += '### 收购对价与未来履约\n\n';
  out += table(['Stereolabs / 百万美元', '金额'], money([['现金对价',acq.cashConsideration],['取得现金',acq.acquiredCash],['净支付现金',acq.cashConsideration-acq.acquiredCash],['对价中的普通股',acq.stockConsideration],['总对价',acq.totalConsideration],['取得可辨认净资产',acq.netAssets],['商誉',acq.goodwill],['可辨认无形资产',acq.intangibles],['税务负债',acq.taxLiability],['对应赔偿资产上限',acq.indemnificationCap]]));
  out += acq.note + '\n\n';
  out += table(['合同负债桥 / 百万美元', '金额'], money([['期初',contracts.start],['本期递延',contracts.deferred],['收购带入',contracts.acquired],['期初递延转收入',-contracts.recognized],['期末',contracts.end],['其中多期IP许可递延',contracts.licenseCurrent+contracts.licenseNoncurrent]]));
  out += contracts.note + `非流动未开票应收另为 ${n(contracts.noncurrentUnbilled,3)}百万，合同资产 ${n(contracts.contractAssets,3)}百万；这些不是当期现金。\n\n${sources(['oust-q'])}\n\n`;
  out += '### 股本对平与工具到期\n\n';
  out += table(['已发行股数桥 / 实际股数', '股数'], [['2026-06-30',s.juneIssued],['7月公开发行',s.julyIssued],['7月董事费股份',s.julyDirector],['2026-07-31',s.julyTotal]].map(([label,v])=>[label,n(v,0)]));
  out += table(['6月底潜在工具 / 实际股数', '股数'], [['期权',s.options],['RSU',s.rsu],['ESPP',s.espp],['Amazon权证',s.amazon],['待服务归属、但已发行的收购股份',s.issuedService],['EPS反稀释工具合计',s.totalAntidilutive],['剔除已发行股份后的潜在池',s.totalAntidilutive-s.issuedService]].map(([label,v])=>[label,n(v,0)]));
  out += table(['6月底期权行权价 / 美元', '期权股数', '全部现金行权条件收款 / 百万美元'], s.optionTranches.map(r => [n(r.strike),n(r.shares,0),n(r.strike*r.shares/1e6,6)]));
  out += `Amazon权证 ${n(s.amazon,0)}股，已归属 ${n(s.amazonVested,0)}股，6月底行权价 ${s.amazonStrike}美元，${s.amazonExpiry}到期；全部数量按该行权价现金行使才对应 ${n(s.amazon*s.amazonStrike/1e6,6)}百万美元，并非保证到账。8月26日已披露10万股期权行权，不能与6月底存量再计一遍潜在新增。\n\n${s.note}\n\n`;
  out += `[7月至10月18日${s.directoryCount}项SEC申报索引](ouster-filings-2026-10-18.json)，附原文链接、字节数和SHA-256。\n\n${sources(c.shares.sources)}\n\n`;
  return out;
}

export function sensingTargets(c, sources, n) {
  const a = c.sensingAudit;
  if (!a) return '';
  const s = a.softwareStress;
  return '\n\n### 软件规模与渠道实收敏感性\n\n' + table(['客户年度订阅报价 / 美元','厂家实收比例假设','厂家年收入/计费单位 / 美元','达到1.8亿美元所需年度计费单位'], s.realizationFractions.map(r => [n(s.retailAnnualFee),n(r*100)+'%',n(s.retailAnnualFee*r),n(s.annualRevenueTarget*1e6/(s.retailAnnualFee*r),0)])) + s.note + '\n\n' + sources(['oust-nashville-contract','oust-k','oust-software']) + '\n\n';
}
