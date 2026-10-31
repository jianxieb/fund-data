(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengPortfolioScoreView = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const bands = [
    { id: 'wait', min: 0, max: 39, label: '0–39 规则分' },
    { id: 'watch', min: 40, max: 59, label: '40–59 规则分' },
    { id: 'small', min: 60, max: 79, label: '60–79 规则分' },
    { id: 'priority', min: 80, max: 100, label: '80–100 规则分' }
  ];
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = (value, digits = 1) => finite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
  const percent = value => finite(value) ? number(value, 2) + '%' : '—';
  const validScore = value => finite(value) && value >= 0 && value <= 100;
  const bandFor = (id, value) => bands.find(b => b.id === id) || bands.find(b => validScore(value) && value >= b.min && value <= b.max);
  const timestamp = day => Date.parse(day + 'T00:00:00Z');
  const plot = { left: 44, top: 16, width: 938, height: 196 };
  function history(timing) {
    return (timing?.scoring?.history || []).filter(p => validScore(p.value) && /^\d{4}-\d{2}-\d{2}$/.test(p.day) && Number.isFinite(timestamp(p.day)));
  }
  function inspect(timing, requested) {
    const rows = history(timing);
    if (!rows.length) return null;
    const index = Math.max(0, Math.min(rows.length - 1, Number.isFinite(Number(requested)) ? Math.round(Number(requested)) : rows.length - 1));
    const point = rows[index], band = bandFor(typeof point.band === 'object' ? point.band?.id : point.band, point.value);
    const elapsed = timestamp(rows.at(-1).day) - timestamp(rows[0].day);
    return { index, point,
      text: point.day + ' · ' + number(point.value, 0) + ' 分 · ' + (band?.label || '未分组') + (point.gateActive || point.gate?.active ? ' · 旧规则触发限分' : '') + ' · 已撤回',
      x: plot.left + (elapsed > 0 ? (timestamp(point.day) - timestamp(rows[0].day)) / elapsed : 1) * plot.width,
      y: plot.top + (100 - point.value) / 100 * plot.height };
  }
  function chart(timing, available) {
    const rows = history(timing);
    if (!rows.length) return '<div class="portfolio-score-chart-empty">尚无满足评分条件的历史记录</div>';
    const first = rows[0].day, last = rows.at(-1).day, duration = timestamp(last) - timestamp(first);
    const x = day => plot.left + (duration > 0 ? (timestamp(day) - timestamp(first)) / duration : 1) * plot.width;
    const y = value => plot.top + (100 - value) / 100 * plot.height;
    let path = '';
    for (let i = 0; i < rows.length; i++) {
      const disconnected = !i || timestamp(rows[i].day) - timestamp(rows[i - 1].day) > 14 * 86400000;
      path += (disconnected ? 'M' : 'L') + x(rows[i].day).toFixed(2) + ' ' + y(rows[i].value).toFixed(2) + ' ';
    }
    const selected = inspect(timing, rows.length - 1);
    const thresholds = [0, 40, 60, 80, 100].map(value => '<line x1="44" x2="982" y1="' + y(value) + '" y2="' + y(value) + '"/><text x="32" y="' + (y(value) + 4) + '" text-anchor="end">' + value + '</text>').join('');
    return '<section class="portfolio-score-history" aria-label="旧规则分历史（已撤回）"><div class="portfolio-score-chart-head"><h3>' + (available ? '旧规则分走势' : '过往规则分记录') + '</h3><span>' + first + ' — ' + last + ' · 共同收盘</span></div>' +
      '<svg id="portfolio-score-chart" data-portfolio-score-chart data-score-first="' + first + '" data-score-last="' + last + '" data-score-left="44" data-score-top="16" data-score-width="938" data-score-height="196" viewBox="0 0 1000 240" role="img" aria-label="0至100分的旧规则分历史（已撤回），不能用于加仓决策"><title>旧规则分历史（已撤回）；仅供审计，不用于加仓决策</title><g class="portfolio-score-chart-bands"><rect x="44" y="16" width="938" height="39.2" class="priority"/><rect x="44" y="55.2" width="938" height="39.2" class="small"/><rect x="44" y="94.4" width="938" height="39.2" class="watch"/><rect x="44" y="133.6" width="938" height="78.4" class="wait"/></g><g class="portfolio-score-chart-grid">' + thresholds + '</g><path d="' + path.trim() + '" class="portfolio-score-path"/><line id="portfolio-score-cursor" x1="' + selected.x + '" x2="' + selected.x + '" y1="16" y2="212" class="portfolio-score-cursor"/><circle id="portfolio-score-point" cx="' + selected.x + '" cy="' + selected.y + '" r="4" class="portfolio-score-point"/><g class="portfolio-score-chart-dates"><text x="44" y="235">' + first + '</text><text x="982" y="235" text-anchor="end">' + last + '</text></g></svg>' +
      '<div class="portfolio-score-history-control"><label for="portfolio-score-day">查看旧规则历史</label><input id="portfolio-score-day" data-portfolio-score-day type="range" min="0" max="' + (rows.length - 1) + '" step="1" value="' + (rows.length - 1) + '" aria-label="查看旧规则历史" aria-valuetext="' + esc(selected.text) + '"' + (rows.length === 1 ? ' disabled' : '') + '><output id="portfolio-score-readout" for="portfolio-score-day" aria-live="polite">' + (available ? '' : '历史记录：') + esc(selected.text) + '</output></div></section>';
  }
  function evidence(timing) {
    const score = timing?.scoring, horizons = score?.evidence?.horizons || [];
    if (!horizons.length) return '<p class="portfolio-score-missing">缺完整的历史评分后续收益样本</p>';
    const latestId = score?.band?.id;
    return '<details class="portfolio-score-evidence"><summary>旧规则分档后的历史收益与风险</summary><p>每月取一个已知评分，从下一共同收盘进入；只统计已完整结束的持有期，以下均为累计收益。</p>' + (score.evidence.assessment?.detail ? '<p>' + esc(score.evidence.assessment.detail) + '</p>' : '') + horizons.map(h => {
      const rows = [...bands.map(b => ({ ...b, ...(h.bands || []).find(row => row.id === b.id) })), { id: 'baseline', label: '全部可比月份', ...h.baseline }];
      const tableRows = rows.map(row => '<tr' + (row.id === latestId ? ' class="portfolio-score-evidence-current"' : '') + '><th scope="row">' + (row.id === 'baseline' ? '全部可比月份' : row.min + '–' + row.max + ' 分') + (row.id === latestId ? '<small>本次所在分组</small>' : '') + '</th><td>' + percent(row.median) + '</td><td>' + percent(row.positiveRate) + '</td><td>' + percent(row.worstReturn) + '</td><td>' + percent(row.worstDrawdown) + '</td><td>' + (finite(row.n) ? row.n : 0) + ' 个月<small>不重叠 ' + (finite(row.nonOverlappingN) ? row.nonOverlappingN : 0) + ' 个</small></td></tr>').join('');
      const empty = bands.filter(b => !(h.bands || []).find(row => row.id === b.id)?.n).map(b => b.min + '–' + b.max).join('、');
      return '<div class="portfolio-score-evidence-period"><h4>随后 ' + esc(h.years) + ' 年</h4><div class="table-wrap"><table><thead><tr><th scope="col">评分区间</th><th scope="col">收益中位数</th><th scope="col">正收益比例</th><th scope="col">最差收益</th><th scope="col">期间最深回撤</th><th scope="col">样本</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' + (empty ? '<p class="portfolio-score-missing">' + empty + ' 分组缺完整 ' + esc(h.years) + ' 年后续样本。</p>' : '') + '</div>';
    }).join('') + '<p class="portfolio-score-evidence-limit">月度持有期存在重叠，历史正收益比例不是未来胜率。旧规则已撤回；这些分组不表示加仓时机好坏。</p></details>';
  }
  function assessment(score) {
    const a = score?.evidence?.assessment;
    const label = { insufficient: '旧规则缺足够历史样本', not_supported: '旧规则未证实高分更好', mixed: '旧规则高分组收益与风险表现不一致', favorable: '旧规则高分组回溯收益较高，仍未经验证' }[a?.status] || '旧规则缺足够历史样本';
    const detail = '以下是一年持有期的回溯对照，不能据此恢复加仓指引。';
    const compare = finite(a?.high?.median) && finite(a?.low?.median) ? '<div class="portfolio-score-evidence-compare"><span>≥60 分后一年中位收益 <strong>' + percent(a.high.median) + '</strong><small>' + (finite(a.high.n) ? a.high.n : 0) + ' 个月</small></span><span>&lt;60 分后一年中位收益 <strong>' + percent(a.low.median) + '</strong><small>' + (finite(a.low.n) ? a.low.n : 0) + ' 个月</small></span></div>' : '';
    return '<div class="portfolio-score-assessment" role="note"><strong>' + esc(label) + '</strong><p>' + esc(detail) + '</p>' + compare + '</div>';
  }
  function render(timing, helpers = {}) {
    const score = timing?.scoring;
    const available = timing?.status === 'available' && validScore(score?.value);
    const currentBand = available ? bandFor(score?.band?.id, score.value) : null;
    const historical = !!timing?.historical;
    const missing = score?.missing || timing?.missing || '缺满足评分条件的长期历史，暂不评分';
    const version = score?.version || 'add-score-v1';
    const title = historical ? '历史时点旧规则分' : available ? '旧规则分（已撤回）' : '旧规则分不可用';
    const action = available ? '仅用于复核原有计算，分数和档位均不代表加仓机会。' : missing;
    const change = available && finite(score?.change20?.value) ? '<span class="portfolio-score-change">较20个共同交易日前 ' + (score.change20.value > 0 ? '+' : '') + number(score.change20.value, 0) + ' 分<small>' + esc(score.change20.day) + ' · ' + number(score.change20.previous, 0) + ' 分</small></span>' : '<span class="portfolio-score-change">' + (available ? '尚无20个共同交易日前的有效规则分' : '更新有效行情后可复核旧规则') + '</span>';
    const components = available ? '<div class="portfolio-score-components">' + (score.components || []).map(c => {
      const width = finite(c.points) && finite(c.max) && c.max > 0 ? Math.max(0, Math.min(100, c.points / c.max * 100)) : 0;
      return '<div class="portfolio-score-component"><div><strong>' + esc(c.label) + '</strong><span>' + number(c.points) + '<small> / ' + number(c.max, 0) + '</small></span></div><div class="portfolio-score-component-bar" role="meter" aria-label="' + esc(c.label) + '得分" aria-valuemin="0" aria-valuemax="' + (finite(c.max) ? c.max : 0) + '" aria-valuenow="' + (finite(c.points) ? c.points : 0) + '"><i style="width:' + width.toFixed(2) + '%"></i></div><p>' + esc(c.detail) + '</p></div>';
    }).join('') + '</div>' : '';
    const gate = available && score.gate?.active ? '<p class="portfolio-score-gate"><strong>旧规则限分已触发</strong> ' + esc(score.gate.reason) + ' · 原始 ' + number(score.raw) + ' 分，限制为 ' + number(score.value, 0) + ' 分' + (finite(score.gate.deduction) && score.gate.deduction > 0 ? '（扣减 ' + number(score.gate.deduction) + ' 分）' : '') + '</p>' : '';
    const legend = '<div class="portfolio-score-legend" aria-label="旧规则分区间">' + bands.map(b => '<div class="' + b.id + (b.id === currentBand?.id ? ' active' : '') + '"' + (b.id === currentBand?.id ? ' aria-current="true"' : '') + '><strong>' + b.min + '–' + b.max + '</strong><span>' + b.label + '</span></div>').join('') + '</div>';
    const notice = '<div class="portfolio-score-withdrawn"><h3>当前没有通过验证的加仓评分</h3><p>已撤回原有加仓档位。原规则奖励趋势转强并限制下跌期得分，未验证能识别更好的买点。</p>' + (!available ? '<p class="portfolio-score-missing">' + esc(missing) + '</p>' : '') + '</div>';
    return '<div class="portfolio-score">' + notice + assessment(score) + evidence(timing) + '<details class="portfolio-score-audit"><summary>已撤回规则的历史记录（仅供核对）</summary><div class="portfolio-score-hero"><div class="portfolio-score-value ' + (currentBand?.id || 'unavailable') + '"><span>' + title + '</span><div><strong>' + (available ? number(score.value, 0) : '—') + '</strong><span>/ 100</span></div><small>已撤回 · 不用于加仓决策</small></div><div class="portfolio-score-decision"><div class="portfolio-score-asof">' + (timing?.end ? '截至 ' + esc(timing.end) + ' 共同收盘' : '缺有效共同收盘日期') + ' · ' + esc(version) + '</div><h3>' + (available ? '<small>旧规则分组</small>' + esc(currentBand?.label) : '等待有效数据') + '</h3><p>' + esc(action) + '</p>' + change + '</div></div>' + legend + components + gate + chart(timing, available) + '</details></div>';
  }
  return { render, inspect };
});
