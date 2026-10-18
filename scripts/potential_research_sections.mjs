import { createRequire } from 'node:module';
import { operatingReviewSections } from './potential_operating_review.mjs';
const M = createRequire(import.meta.url)('../assets/potential-model.js');
const n = (v, digits = 2) => v.toLocaleString('zh-CN', { maximumFractionDigits: digits });
const pct = v => n(v * 100, 1) + '%';
const range = values => values ? values.map(v => n(v)).join('–') : '亏损，不使用PE';

// Shared presentation for the product and downloadable report, computed from
// the same operating and financing assumptions rather than hand-copied prices.
export function researchSections(c) {
  const r = c.research;
  if (!r) return [];
  if (r.kind === 'evidence_review') return operatingReviewSections(c);
  // Withdrawn inputs are retained for accountability, but must never produce
  // an earnings forecast or valuation table in the product or its export.
  if (r.modelStatus === 'withdrawn') {
    const review = r.evidenceReview;
    const covered = new Set(review.assumptions.flatMap(a => a.inputs));
    const required = [...new Set(r.cases.flatMap(s => Object.keys(s).filter(k => !['id', 'label', 'story'].includes(k)))), ...Object.keys(r.capital).map(k => 'capital.' + k)];
    for (const key of required) if (!covered.has(key)) throw new Error(c.id + ': missing input evidence review for ' + key);
    if (review.assumptions.some(a => !a.evidence || !a.gap || !a.sources?.length)) throw new Error(c.id + ': incomplete input evidence review');
    return [
      { title: '原盈利预测已撤回', paragraphs: [review.summary] },
      ...review.sections,
      { title: '原利润输入及依据（逐项）', collapsed: true, paragraphs: ['保留原数值以说明撤回原因；这些输入不再生成利润、股价或十倍回报结论。已披露事实与未证实假设分别列明。'],
        headers: ['原输入（已撤回）', '已知事实', '采用该数字还缺什么', '来源'],
        rows: review.assumptions.map(a => [a.label + '：' + a.prior, a.evidence, a.gap]), rowSources: review.assumptions.map(a => a.sources), proseTable: true },
      { title: '重新估算需要的依据', paragraphs: review.reopenBasis }
    ];
  }
  const cases = r.cases, results = cases.map(s => M.researchProjection(c, s));
  const shared = r.kind === 'shared_drug';
  const k = r.capital, main = M.researchCapital(k);
  const stressCapital = { netFunding: k.stressNetFunding, issuePrice: k.stressIssuePrice };
  const stressed = M.researchCapital(k, stressCapital);
  const strong = cases.find(s => s.id === 'strong');
  const stressRows = [
    ['原强经营情景', {}],
    ['付费患者年数少25%', { patientYears: strong.patientYears * .75 }],
    ['每患者年实收低25%', { netAnnualReceipt: strong.netAnnualReceipt * .75 }],
    ...(shared ? [['海外净提成降至10%', { royaltyRate: .10 }]] : []),
    ['融资额增大且发行价下降', { capital: stressCapital }],
    ['上述三项同时发生', { patientYears: strong.patientYears * .75, netAnnualReceipt: strong.netAnnualReceipt * .75, capital: stressCapital }]
  ].map(([label, overrides]) => {
    const p = M.researchProjection(c, strong, overrides);
    return [label, n(p.netIncome / 100), n(p.shares / 100), range(p.multiples) + (p.multiples ? '×' : '')];
  });
  const metrics = [
    ['付费患者年 / 年', s => n(s.patientYears, 0)],
    ['每患者年净收入 / 美元', s => n(s.netAnnualReceipt, 0)],
    [shared ? '美国净产品销售 / 百万美元' : '净产品销售 / 百万美元', (_, p) => n(p.revenue)],
    [shared ? '扣制造、许可及销售费用后利润率' : '扣制造等产品成本后毛利率', s => pct(s.contributionMargin)],
    [shared ? '美国商业利润 / 百万美元' : '产品毛利 / 百万美元', (_, p) => n(p.commercialProfit)],
    ...(shared ? [
      ['归Kura的美国商业利润份额', s => pct(s.profitShare)],
      ['归Kura的美国商业利润 / 百万美元', (_, p) => n(p.retainedProfit)],
      ['海外销售 / 百万美元（非Kura全额收入）', s => n(s.foreignRevenue)],
      ['假设海外净提成比例（扣原始许可负担）', s => pct(s.royaltyRate)],
      ['海外净提成 / 百万美元', (_, p) => n(p.royalty)]
    ] : []),
    ['再扣研发、管理等费用 / 百万美元', s => n(s.operatingExpense)],
    ['净融资费用 / 百万美元', s => n(s.interest)],
    ['税前利润 / 百万美元', (_, p) => n(p.pretax)],
    ['正常化正利润税率', s => pct(s.taxRate)],
    ['归属股东净利 / 百万美元', (_, p) => n(p.netIncome)],
    ['每股利润 / 美元', (_, p) => n(p.eps)]
  ];
  return [
    { title: '2031年条件情景', paragraphs: [r.conclusion, r.failure,
      '以下全部是研究假设。只比较2031年终点股价与2026-10-16盘后价格，未计分红、交易税费、汇率或等待期间收益；不是今天的合理价值或买入目标价。'],
      headers: ['情景', '归属净利 / 亿美元', '期末股数 / 亿股', 'PE假设区间', '每股 / 美元', '股价倍数'],
      rows: cases.map((s, i) => { const p = results[i]; return [s.label, n(p.netIncome / 100), n(p.shares / 100), s.peRange.join('–'), range(p.prices), range(p.multiples) + '×']; }),
      notes: cases.map(s => s.label + '：' + s.story) },
    { title: '销量、费用与利润的计算依据', collapsed: true,
      paragraphs: [r.unitBasis, r.expenseBasis], headers: ['指标', ...cases.map(s => s.label)],
      rows: metrics.map(([label, fn]) => [label, ...cases.map((s, i) => fn(s, results[i]))]), sources: c.sources.filter(id => id !== 'screen-quotes') },
    { title: '融资与每股分母', collapsed: true, paragraphs: [c.capitalBasis, r.capitalNote],
      headers: ['股本与融资假设', '主情景', '融资压力情景'], rows: [
        ['当前已发行 / 百万股', n(k.outstanding, 6), n(k.outstanding, 6)],
        ['既有潜在股份 / 百万股', n(k.potential, 6), n(k.potential, 6)],
        ['另预留未来激励 / 百万股', n(k.futureAwards), n(k.futureAwards)],
        ['尚需净融资 / 百万美元', n(k.netFunding), n(k.stressNetFunding)],
        ['发行价假设 / 美元', n(k.issuePrice), n(k.stressIssuePrice)],
        ['发行费用假设', pct(k.issueFee), pct(k.issueFee)],
        ['新增融资股份 / 百万股', n(main.newShares), n(stressed.newShares)],
        ['合计期末股份 / 百万股', n(main.shares), n(stressed.shares)]
      ], sources: r.capitalSources },
    { title: '估值与失败条件的压力检验', paragraphs: [r.valuationBasis,
      '下表沿用强情景同一PE区间及费用，仅改变列明变量，隔离销量、价格和融资的影响。现实中销售失利还可能压低PE，因此不是下跌底线。'],
      headers: ['变动', '归属净利 / 亿美元', '期末股数 / 亿股', '股价倍数'], rows: stressRows },
    { title: '哪些新证据会改变判断', paragraphs: [],
      headers: ['具体事件', '要看到的证据', '判断后果'], rows: r.milestones.map(m => [m.event, m.evidence, m.consequence]), proseTable: true }
  ];
}
