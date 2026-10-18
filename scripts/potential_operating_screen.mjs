// Comparison dossiers use the same per-share model as the full candidates.
export function operatingScreenAudit(c, M, sources, n) {
  const a = c.audit;
  if (a?.kind !== 'operating_screen') return '';
  const unit = c.currency === 'USD' ? '美元' : '人民币';
  const table = (headers, rows) => '| ' + headers.join(' | ') + ' |\n| ' + headers.map(() => '---').join(' | ') + ' |\n' + rows.map(r => '| ' + r.map(v => typeof v === 'number' ? n(v, 6) : v).join(' | ') + ' |').join('\n') + '\n\n';
  let out = '#### 报表利润与现金\n\n';
  out += table(['期间 / 百万' + unit, '收入', '毛利率', '集团营业利润', a.netLabel || '归母净利', '经营现金'], a.periods.map(p => [p.label, p.revenue, n((1-p.cost/p.revenue)*100) + '%', p.operating, p.net, p.operatingCash ?? '未单列季度数']));
  out += a.earningsNote + '\n\n';
  const f = a.cash;
  out += table([f.period + ' / 百万' + unit, '金额'], [
    ['期初' + (f.basis || '现金及等价物'), f.start], ['经营现金', f.operating], ['购建长期资产现金支出', -f.capex], ['设备预付款', -f.capexPrepaid],
    ['经营现金减上述资本投入', f.operating-f.capex-f.capexPrepaid], ['投资现金合计', f.investing], ['融资现金合计', f.financing], ['汇率影响', f.fx], ['期末' + (f.basis || '现金及等价物'), f.end]
  ]);
  out += f.period + '净增现金 = 经营 + 投资 + 融资 + 汇率 = ' + n(f.end-f.start, 6) + '百万。资本开支已经在投资现金内，不能再次扣期末余额。\n\n' + a.cashNote + '\n\n';
  for (const section of a.sections) {
    out += '#### ' + section.title + '\n\n';
    if (section.rows) out += table(section.headers, section.rows);
    out += section.paragraphs.join('\n\n') + '\n\n' + sources(section.sources) + '\n\n';
  }
  const company = { price:c.price, shares:{value:c.shares}, financials:{anchorRevenue:null} };
  out += '#### 五年经营情景：2031年终值\n\n' + a.scenarioNote + '\n\n';
  out += table(['情景', '收入 / 亿' + unit, '归母净利率', 'PE', '期末股数 / 百万', '每股价格 / 原币', '股价倍数'], a.scenarios.map(s => {
    const p = M.project(company,s);
    return [s.label, s.revenue/100, n(s.margin*100)+'%', s.pe ?? '亏损残值法', s.shares, n(p.price), n(p.priceMultiple)+'×'];
  }));
  out += a.scenarios.map(s => '- ' + s.label + '：' + s.story).join('\n') + '\n\n';
  out += table(['十倍反算假设', '期末股数 / 百万', '净利率', 'PE', '所需收入 / 亿' + unit], a.hurdleCases.map(s => [s.label,s.shares,n(s.margin*100)+'%',s.pe,n(c.price.value*10*s.shares/s.margin/s.pe/100)]));
  const bull = a.scenarios.find(s => s.id === 'bull');
  out += `若终值PE降低25%，乐观股价倍数为${n(M.project(company,{...bull,pe:bull.pe*.75}).priceMultiple)}×；若总股数增加20%，为${n(M.project(company,{...bull,shares:bull.shares*1.2}).priceMultiple)}×；两者同时发生为${n(M.project(company,{...bull,pe:bull.pe*.75,shares:bull.shares*1.2}).priceMultiple)}×。\n\n${a.valuationNote}\n\n`;
  return out;
}
