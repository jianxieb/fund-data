export function screeningReport(data, process) {
  const source = id => {
    const s = data.sources.find(s => s.id === id);
    if (!s) throw new Error('Unknown screening source: ' + id);
    return `[${s.title}](${s.url.startsWith('data/') ? '../../' : ''}${s.url})`;
  };
  const refs = ids => ids.map(source).join('；');
  let md = `# 行业筛选与公司研究 · ${data.reviewedAt}\n\n${data.summary}\n\n${data.scope}\n\n${data.horizon}。${data.judgmentBasis}\n\n`;
  md += '## 已确认的方法\n\n' + process.stages.map((s, i) => `${i + 1}. **${s.title}**：${s.body}`).join('\n') + `\n\n${data.profitPrinciple}\n\n${data.historyLesson}\n\n`;
  md += '## 行业变化\n\n';
  for (const s of data.sectors.filter(s=>s.sources)) md += `### ${s.name} · ${s.verdict}\n\n${s.change}\n\n${s.profit}\n\n${s.evidence}\n\n${refs(s.sources)}\n\n`;
  md += '## 研究取舍\n\n| 公司 | 五年十倍可能性 | 研究优先级 | 研究阶段 | 判断 |\n| --- | --- | --- | --- | --- |\n' + data.companies.map(c => `| ${c.name} ${c.id} | ${c.tenfold} | ${c.priority} | ${c.stage} | ${c.judgment} |`).join('\n') + '\n\n';
  for (const c of data.companies) {
    const quote = c.quote;
    md += `## ${c.name} · ${c.id}\n\n研究更新：${c.reviewedAt || data.reviewedAt}\n\n### 公司做什么\n\n${c.business}\n\n### 机会为什么出现\n\n${c.opportunity}\n\n### 利润如何放大\n\n${c.profitMechanism}\n\n### 当前判断\n\n**五年十倍可能性：${c.tenfold}；研究优先级：${c.priority}。** ${c.judgment}\n\n${c.startingValue}\n\n股价快照：${quote.priceValue ?? quote.priceUsd}${quote.currency==='CNY'?'元':'美元'}，${quote.tradeTimeUtc ? 'UTC '+quote.tradeTimeUtc : quote.date}（${quote.sessionLabel || '盘后'}）。${c.capitalBasis}\n\n${refs(c.sources)}\n\n### 关键风险与依据\n\n`;
    md += c.risks.map(r => '- ' + r).join('\n') + '\n\n';
    for (const f of c.facts) md += `**${f.label}**：${f.text} ${refs(f.sources)}\n\n`;
    for (const s of c.research?.sections || []) {
      md += `### ${s.title}\n\n` + s.paragraphs.join('\n\n') + '\n\n';
      if (s.headers) md += '| ' + s.headers.join(' | ') + ' |\n| ' + s.headers.map(() => '---').join(' | ') + ' |\n' + s.rows.map((row, i) => '| ' + [...row, ...(s.rowSources ? [refs(s.rowSources[i])] : [])].join(' | ') + ' |').join('\n') + '\n\n';
      if (s.notes) md += s.notes.map(t => '- ' + t).join('\n') + '\n\n';
      if (s.sources) md += refs(s.sources) + '\n\n';
    }
    md += `**已检验问题：${c.check.question}**\n\n${c.check.answer} ${refs(c.check.sources)}\n\n**改变判断的条件**\n\n- 上调：${c.upgrade}\n- 下调：${c.downgrade}\n\n${c.nextQuestion}\n\n`;
    if (c.legacyReference) md += '[此前详细材料（其中情景是历史假设）](../../'+c.legacyReference.reportPath+')\n\n';
  }
  md += `## 来源与时点\n\n${data.priceBasis}\n\n` + data.sources.map(s => `- ${source(s.id)} · 公布/记录 ${s.publishedAt} · ${s.locator}`).join('\n') + '\n';
  return md;
}
