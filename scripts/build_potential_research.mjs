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
let md = `# 五年潜力股研究 · ${data.reviewedAt}\n\n研究起点：${data.priceDate}收盘；终点：${data.horizonDate}。美国普通股使用美元，A股使用人民币。\n\n重点跟踪 Amprius、普门科技；Ouster、爱博医疗保留为边界观察。十倍都只是需要多项突破同时成功的乐观情景，基准情景远低于十倍。没有可信成功概率，不做概率加权目标价。\n\n`;
md += '## 口径与取舍\n\n' + Object.values(data.method).join('\n\n') + '\n\n';
md += '研究先比较商业化、单位经济、竞争与资本配置，再反算终点。不是按市值或过去增长率打分。其余备选公司的证据没有达到同等深度，未入选不意味着公司能力不存在。行业容量部分明确包含研究假设，不能把模型可计算理解为需求已验证。\n\n';
md += '| 公司 | 研究优先级 | 起始价 | 悲观股价倍数 | 基准股价倍数 | 乐观股价倍数 | 十倍所需收入CAGR |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n';
for (const c of data.companies) {
  const h = M.hurdle(c, M.scenario(c, 'bull'));
  md += `| ${c.name} ${c.id} | ${c.status === 'priority' ? '重点候选' : '边界观察'} | ${c.currency} ${n(c.price.value)} | ${c.scenarios.map(s => n(M.project(c, s).priceMultiple) + '×').join(' | ')} | ${n(h.revenueCagr * 100)}% |\n`;
}
for (const c of data.companies) {
  const f = c.financials, bull = M.scenario(c, 'bull'), h = M.hurdle(c, bull);
  const amount = x => n(x / 100) + '亿' + (c.currency === 'USD' ? '美元' : '元');
  md += `\n## ${c.name} · ${c.id}\n\n**${c.decision}**\n\n${c.tagline}。\n\n### 已验证事实与财务\n\n`;
  md += `股价 ${c.price.value}（${c.price.asOf}常规交易收盘、未复权）；来源：[Yahoo Finance](${c.price.url})。已发行股数 ${n(c.shares.value, 6)}百万股，股本截至 ${c.shares.asOf}；不是同日报价市值。\n\n`;
  md += `${f.label}：收入 ${amount(f.revenue)}，归母/普通股利润 ${amount(f.netIncome)}，经营现金流 ${amount(f.operatingCash)}，现金口径 ${amount(f.cash)}，借款口径 ${amount(f.debt)}。利润口径：${f.netIncomeBasis}。债务口径：${f.debtBasis}。\n\n${sources([f.source])}\n\n`;
  for (const fact of c.facts) md += `- 已发生：${fact.text} ${sources(fact.sources)}\n`;
  md += '\n### 管理层指引与研究假设\n\n';
  md += c.guidance.length ? c.guidance.map(g => `- 管理层指引：${g.text} ${sources(g.sources)}`).join('\n') : '未将未核实的全年经营目标设为公司指引。';
  md += `\n\n收入增长锚点：${f.anchorLabel}，金额 ${amount(f.anchorRevenue)}。下面所有2031参数、行业份额和里程碑阈值均为研究者假设，不是公司承诺或外部一致预期。\n\n### 经营路径、竞争与资本配置\n\n${c.thesis.join('\n\n')}\n\n${c.economics}\n\n${c.management}\n\n${c.funding}\n\n${sources(c.fundingSources)}\n\n### 股本与稀释\n\n${c.shares.potentialBasis}\n\n${c.shares.futureBasis}\n\n${c.shares.convertibles}\n\n具体缺项：${c.shares.gap}\n\n### 五年情景\n\n`;
  md += `金额为亿${c.currency === 'USD' ? '美元' : '元'}；股数为百万股；分红为五年累计每股原币现金。\n\n| 情景 | 收入 | 归母净利率 | 归母利润 | 期末股数 | PE | 股权价值 | 每股价格 | 每股现金分红 | 股价倍数 | 含现金分红财富倍数 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const s of c.scenarios) {
    const p = M.project(c, s);
    md += `| ${s.label} | ${n(s.revenue / 100)} | ${n(s.margin * 100)}% | ${n(p.profit / 100)} | ${n(s.shares)} | ${s.pe ?? '亏损残值'} | ${n(p.equity / 100)} | ${n(p.price)} | ${n(s.dividends)} | ${n(p.priceMultiple)}× | ${n(p.totalMultiple)}× |\n`;
  }
  md += '\n' + c.scenarios.map(s => `- ${s.label}：${s.story}`).join('\n') + '\n\n';
  md += `**十倍反算**：每股价格需 ${n(h.price)}；按乐观期末 ${n(bull.shares)}百万股，股权价值需 ${amount(h.equity)}，相对起始股本折算值为 ${n(h.capitalMultiple)}倍。用 ${bull.pe}倍PE与 ${n(bull.margin * 100)}%归母净利率，需利润 ${amount(h.profit)}、收入 ${amount(h.revenue)}，收入五年CAGR ${n(h.revenueCagr * 100)}%。\n\n若终值PE下降25%，乐观股价倍数变为 ${n(M.project(c, { ...bull, pe: bull.pe * .75 }).priceMultiple)}倍；若期末股数再增20%，变为 ${n(M.project(c, { ...bull, shares: bull.shares * 1.2 }).priceMultiple)}倍。两项同时发生则为 ${n(M.project(c, { ...bull, pe: bull.pe * .75, shares: bull.shares * 1.2 }).priceMultiple)}倍。分红不用于掩盖股价十倍未达标。\n\n### 市场容量与单位经济反查\n\n${c.marketTest.headline}\n\n`;
  md += '| 收入组成（2031假设） | 数量 | 单位净收入 | 收入 / 亿原币 |\n| --- | ---: | ---: | ---: |\n' + c.marketTest.parts.map(p => `| ${p.label} | ${n(p.units)} ${p.unitLabel} | ${n(p.price)} | ${n(p.revenue / 100)} |`).join('\n');
  md += `\n\n${c.marketTest.assumptions}\n\n${c.marketTest.boundary}\n\n缺项：${c.marketTest.gap}\n\n${sources(c.marketTest.sources)}\n\n### 验证里程碑与撤回信号\n\n`;
  md += c.milestones.map(m => `- ${m.when}：${m.test}`).join('\n') + '\n\n撤回或下修：\n\n' + c.withdraw.map(t => '- ' + t).join('\n');
  md += '\n\n尚缺的具体证据：\n\n' + c.gaps.map(t => '- ' + t).join('\n') + '\n\n### 为什么不选常见替代\n\n';
  md += c.alternatives.map(a => `- **${a.name}**：${a.reason} ${sources(a.sources)}`.trimEnd()).join('\n') + '\n';
}
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
