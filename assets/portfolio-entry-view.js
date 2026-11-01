(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengPortfolioEntryView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = Number.isFinite;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 1) => finite(v) ? v.toFixed(d) : '—';
  const pct = v => finite(v) ? num(v, 2) + '%' : '—';
  const rows = t => (t?.entry?.history || []).filter(r => finite(r.value));
  function inspect(t, index) {
    const data = rows(t); if (!data.length) return null;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(Number(index) || 0))), r = data[i];
    const first = Date.parse(data[0].asOf), last = Date.parse(data.at(-1).asOf);
    return { x: 44 + (last > first ? (Date.parse(r.asOf) - first) / (last - first) : 1) * 938, y: 16 + (100 - r.value) * 1.96,
      text: r.asOf + ' · ' + num(r.value) + ' 分 · 当时已成熟 ' + r.trainingN + ' 个月 · 随后一年 ' + (r.actual ? pct(r.actual.return) : '尚未走完') };
  }
  function table(groups) {
    return '<div class="table-wrap"><table><thead><tr><th>分组</th><th>一年收益中位数</th><th>收益较差10%位置</th><th>持有期回撤中位数</th><th>最深回撤</th><th>月份 / 不重叠窗口</th></tr></thead><tbody>' + groups.map(g => '<tr><th>' + esc(g.label) + '</th><td>' + pct(g.median) + '</td><td>' + pct(g.p10) + '</td><td>' + pct(g.medianDrawdown) + '</td><td>' + pct(g.worstDrawdown) + '</td><td>' + (g.n || 0) + ' / ' + (g.nonOverlappingN || 0) + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function chart(t) {
    const data = rows(t); if (!data.length) return '';
    const last = inspect(t, data.length - 1);
    const path = data.map((r, i) => { const p = inspect(t, i); return (i ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' ');
    return '<section class="portfolio-score-history"><div class="portfolio-score-chart-head"><h3>历史分数 · 逐月重演</h3><span>' + esc(data[0].asOf) + ' — ' + esc(data.at(-1).asOf) + '</span></div><svg viewBox="0 0 1000 240" role="img" aria-label="历史买点分，每个月仅使用当时已经实现的一年收益"><g class="portfolio-score-chart-grid">' + [0, 50, 100].map(v => '<line x1="44" x2="982" y1="' + (16 + (100 - v) * 1.96) + '" y2="' + (16 + (100 - v) * 1.96) + '"/><text x="30" y="' + (20 + (100 - v) * 1.96) + '" text-anchor="end">' + v + '</text>').join('') + '</g><path d="' + path + '" class="portfolio-score-path"/><line id="portfolio-entry-cursor" x1="' + last.x + '" x2="' + last.x + '" y1="16" y2="212" class="portfolio-score-cursor"/><circle id="portfolio-entry-point" cx="' + last.x + '" cy="' + last.y + '" r="4" class="portfolio-score-point"/></svg><div class="portfolio-score-history-control"><label for="portfolio-entry-day">查看历史月份</label><input id="portfolio-entry-day" data-portfolio-entry-day type="range" min="0" max="' + (data.length - 1) + '" value="' + (data.length - 1) + '" step="1" aria-label="查看买点历史分" aria-valuetext="' + esc(last.text) + '"><output id="portfolio-entry-readout" for="portfolio-entry-day">' + esc(last.text) + '</output></div></section>';
  }
  function render(t) {
    const e = t?.entry;
    if (!e) return '<p class="portfolio-score-missing">缺历史买点分析结果，请重新运行模拟。</p>';
    const available = t.status === 'available' && e.status === 'available' && !t.missing && finite(e.value) && e.value >= 0 && e.value <= 100 && !e.missing;
    const m = e.matched || {}, b = e.baseline || {}, wf = e.walkForward || {}, cmp = wf.highVsRest || {}, h = cmp.high || {}, rest = cmp.rest || {};
    const direction = !available ? '暂无法计算' : e.value >= 60 ? '相似位置的历史收益排名偏高' : e.value < 40 ? '相似位置的历史收益排名偏低' : '相似位置的历史收益排名居中';
    const gap = finite(cmp.medianDifference) ? '高分组一年收益中位数比其余月份' + (cmp.medianDifference >= 0 ? '高 ' : '低 ') + num(Math.abs(cmp.medianDifference), 2) + ' 个百分点' : '尚缺高分组或其余月份的完整一年结果';
    const count = '高分组 ' + (h.n || 0) + ' 个月 / 不重叠 ' + (h.nonOverlappingN || 0) + ' 个；其余 ' + (rest.n || 0) + ' 个月 / 不重叠 ' + (rest.nonOverlappingN || 0) + ' 个';
    const cards = available ? '<div class="portfolio-entry-stats">' + [
      ['相似月份 · 一年收益中位数', pct(m.median), '全部成熟月份 ' + pct(b.median)],
      ['相似月份 · 收益较差10%位置', pct(m.p10), '最差一年 ' + pct(m.worstReturn)],
      ['相似月份 · 持有期回撤中位数', pct(m.medianDrawdown), '最深回撤 ' + pct(m.worstDrawdown)],
      ['相似月份样本', (m.n || 0) + ' 个月', '不重叠 ' + (m.nonOverlappingN || 0) + ' 个窗口 · 全部 ' + e.trainingN + ' 个月']
    ].map(([label, value, note]) => '<div><span>' + label + '</span><strong>' + value + '</strong><small>' + note + '</small></div>').join('') + '</div>' : '';
    const bands = (wf.bands || []).map((g, i) => ({ ...g, label: ['低于40分', '40至不足60分', '60分及以上'][i] }));
    const neighborTable = available ? '<details class="portfolio-score-evidence"><summary>本次参考了哪些历史买点</summary><p>按当时的200日均线偏离历史分位寻找距离最接近的24个历史月份，边界同距全部纳入；收益不会参与挑选。</p><div class="table-wrap"><table><thead><tr><th>观察日</th><th>买入日</th><th>一年到期日</th><th>一年收益</th><th>收益历史排名</th><th>位置距离</th></tr></thead><tbody>' + (e.neighbors || []).slice().sort((a, b) => a.signal.localeCompare(b.signal)).map(r => '<tr><th>' + esc(r.signal) + '</th><td>' + esc(r.entry) + '</td><td>' + esc(r.exit) + '</td><td>' + pct(r.return) + '</td><td>' + num(r.rank) + '</td><td>' + num(r.distance) + '</td></tr>').join('') + '</tbody></table></div></details>' : '';
    return '<div class="portfolio-score portfolio-entry"><div class="portfolio-entry-hero"><div class="portfolio-entry-number"><span>' + (t.historical ? '历史时点 · 买点历史分' : '买点历史分') + '</span><div><strong>' + (available ? num(e.value) : '—') + '</strong><span>/ 100</span></div><small>50为历史排名中点 · 非上涨概率</small></div><div><div class="portfolio-score-asof">截至 ' + esc(e.asOf || t.end || '缺共同收盘日期') + ' · 持有一年 · ' + (t.historical ? '历史复盘' : '按本次行情重算') + '</div><h3>' + direction + '</h3><p>' + (available ? '分数来自相似买点随后一年收益的历史排名均值。' : esc(e.missing || t.missing || '缺成熟历史样本')) + '</p>' + (available ? '<small>当前均线偏离分位 ' + num(e.feature?.value) + '% · 当前回撤 ' + pct(t.latest?.drawdown) + '</small>' : '') + '</div></div>' + cards + '<div class="portfolio-entry-replay"><strong>逐月重演 · 预测是否比普通历史更准</strong><p>' + (finite(wf.predictionMAE) && finite(wf.baselineMAE) ? '相似买点预测的平均误差' + (wf.predictionMAE < wf.baselineMAE ? '较小' : '没有更小') : '缺足够成熟回放结果') + '</p><div><span>相似买点误差 <b>' + num(wf.predictionMAE, 2) + ' 个百分点</b></span><span>普通历史误差 <b>' + num(wf.baselineMAE, 2) + ' 个百分点</b></span><small>' + (wf.baseline?.n || 0) + ' 个已走完一年月份 · 分数与后来收益秩相关 ' + num(wf.rankingCorrelation, 2) + '</small></div><p class="portfolio-entry-limit">研究指标；历史重演尚不能证明可跟随的择时优势。参考组合未计交易费和个人税，月份持有期重叠。</p></div>' + chart(t) + '<details class="portfolio-score-evidence"><summary>分组收益、风险与时间分段</summary><p>' + gap + '。' + count + '</p>' + table([...bands, { ...(wf.baseline || {}), label: '全部可比月份' }]) + (wf.periods || []).map(p => '<h4>' + esc(p.label || p.id) + '</h4>' + table([{ ...(p.high || p.highVsRest?.high || {}), label: '60分及以上' }, { ...(p.rest || p.highVsRest?.rest || {}), label: '其余月份' }])).join('') + '<p>每个月只使用当时已走完一年的结果。规则在看过历史后设计，因此这里是按时间顺序的历史重演，不是全新留出样本验证。</p></details>' + neighborTable + '</div>';
  }
  return { render, inspect };
});
