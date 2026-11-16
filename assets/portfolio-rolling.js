(function () {
  'use strict';
  // 起点检验: the tab's markup, chart and CSV. The windows themselves are run by the model.
  const M = window.Changheng, P = window.ChanghengPortfolioModel;
  const PERIODS = [1, 3, 5, 10];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const LINES = [['setup', '本组合', '#35654a', ''], ['lumpSum', '一次性投入', '#555b50', '2 5'], ['benchmark', '对照', '#9c8d6e', '7 4']];
  const valueOf = (row, key) => key === 'setup' ? row.annualReturn : row[key];
  function controls(state, H) {
    const progress = state.progress;
    return '<div class="portfolio-rolling-controls"><span id="portfolio-rolling-label">持有期</span><div class="segmented" role="group" aria-labelledby="portfolio-rolling-label">' +
      PERIODS.map(years => H.action(years + '年', 'portfolio-rolling-years', years === state.years ? 'active' : '', 'data-value="' + years + '" aria-pressed="' + (years === state.years) + '"')).join('') + '</div>' +
      (progress ? '<span id="portfolio-rolling-progress" class="portfolio-rolling-progress" role="status">' + (progress.total ? '已完成 ' + progress.done + ' / ' + progress.total + ' 个起点' : '正在读取行情…') + '</span>' +
        H.action('停止', 'portfolio-rolling-stop', 'btn') : '') + '</div>';
  }
  function chart(run, H) {
    const rows = run.rows.filter(row => !row.error), lines = LINES.filter(([key]) => rows.some(row => finite(valueOf(row, key))));
    if (rows.length < 2) return '';
    const W = 1120, HH = 300, left = 70, right = W - 20, top = 18, bottom = HH - 36;
    const first = Date.parse(rows[0].start), last = Date.parse(rows.at(-1).start);
    const x = day => left + (Date.parse(day) - first) / Math.max(1, last - first) * (right - left);
    let min = 0, max = 0;
    for (const row of rows) for (const [key] of lines) { const v = valueOf(row, key); if (finite(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
    const span = max - min || 1, low = min - span * .06, high = max + span * .06;
    const y = value => top + (high - value) / (high - low) * (bottom - top);
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const value = low + (high - low) * i / 4;
      grid += '<line x1="' + left + '" x2="' + right + '" y1="' + y(value).toFixed(2) + '" y2="' + y(value).toFixed(2) + '" stroke="#e5eadd"/><text x="' + (left - 10) + '" y="' + (y(value) + 4).toFixed(2) + '" text-anchor="end">' + value.toFixed(1) + '%</text>';
    }
    if (low < 0 && high > 0) grid += '<line x1="' + left + '" x2="' + right + '" y1="' + y(0).toFixed(2) + '" y2="' + y(0).toFixed(2) + '" stroke="#b9c2b0"/>';
    grid += '<text x="' + left + '" y="' + (HH - 10) + '">' + H.esc(rows[0].start) + '</text><text x="' + right + '" y="' + (HH - 10) + '" text-anchor="end">' + H.esc(rows.at(-1).start) + '</text>';
    const paths = lines.map(([key, , color, dash]) => {
      let path = '', connected = false;
      for (const row of rows) {
        const v = valueOf(row, key);
        if (!finite(v)) { connected = false; continue; }
        path += (connected ? 'L' : 'M') + x(row.start).toFixed(2) + ',' + y(v).toFixed(2); connected = true;
      }
      return '<path data-rolling-line="' + key + '" d="' + path + '" stroke="' + color + '" stroke-width="2"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' fill="none" stroke-linecap="round"/>';
    }).join('');
    const legend = lines.map(([key, name, color]) => '<span><i style="background:' + color + '"></i>' + H.esc(key === 'benchmark' ? name + ' ' + run.benchmark : name) + '</span>').join('');
    return '<section class="card portfolio-rolling-chart"><div class="card-head"><div><h2>各起点的年化收益</h2><p>横轴为建仓月份，每个起点持有 ' + run.years + ' 年</p></div></div><div class="portfolio-rolling-legend">' + legend +
      '</div><div class="portfolio-compare-plot-scroll"><svg class="portfolio-compare-plot" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="各起点持有' + run.years + '年的年化收益">' + grid + paths + '</svg></div></section>';
  }
  function extremes(title, rows, run, H) {
    const { unit } = P.currencyInfo(run.config);
    return H.card(title, '按年化收益', '<div class="table-wrap" tabindex="0" role="region" aria-label="' + title + '"><table class="portfolio-risk-table"><thead><tr><th scope="col">起点</th><th scope="col">结束日</th><th scope="col">年化收益</th><th scope="col">最大回撤</th><th scope="col">期末税后估值 / ' + unit + '</th></tr></thead><tbody>' +
      rows.map(row => '<tr><td>' + row.start + '</td><td>' + row.end + '</td><td class="num">' + H.pc(row.annualReturn) + '</td><td class="num">' + H.pc(row.mdd) + '</td><td class="num">' + H.money(row.value) + '</td></tr>').join('') + '</tbody></table></div>');
  }
  function results(state, H) {
    const run = state.run;
    if (!run) return '';
    const s = run.summary, cell = (label, value, note = '') => '<div><span>' + H.esc(label) + '</span><strong class="num">' + value + '</strong>' + (note ? '<small>' + H.esc(note) + '</small>' : '') + '</div>';
    const count = item => item.wins + ' / ' + item.of;
    const grid = '<div class="portfolio-year-grid portfolio-rolling-grid">' +
      cell('最差年化收益', H.pct(s.annual.min, 2)) + cell('25%分位', H.pct(s.annual.q1, 2)) + cell('中位年化收益', H.pct(s.annual.median, 2)) + cell('75%分位', H.pct(s.annual.q3, 2)) + cell('最好年化收益', H.pct(s.annual.max, 2)) +
      cell('最深最大回撤', H.pct(s.drawdown.worst, 2, false)) + cell('最大回撤中位', H.pct(s.drawdown.median, 2, false)) + cell('亏损起点', s.losses + ' / ' + s.count, '累计收益为负') +
      (s.beatLumpSum ? cell('胜过一次性投入', count(s.beatLumpSum), '年化收益更高的起点') : '') + (s.beatBenchmark ? cell('胜过对照 ' + run.benchmark, count(s.beatBenchmark), '年化收益更高的起点') : '') + '</div>';
    return (run.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(run.catalogRefresh.missing) + '</p>' : '') +
      H.card('起点分布', '起点 ' + s.firstStart + ' — ' + s.lastStart + ' · ' + s.count + ' 个 · 每个持有 ' + run.years + ' 年' + (s.failed ? ' · ' + s.failed + ' 个起点无法模拟' : ''),
        '<p class="portfolio-warning portfolio-rolling-caveat">相邻起点的区间大部分重叠，不是 ' + s.count + ' 次独立检验。</p>' + grid,
        H.action('导出全部起点 CSV', 'portfolio-rolling-export', 'portfolio-result-link')) +
      chart(run, H) + extremes('最差5个起点', s.worst, run, H) + extremes('最好5个起点', s.best, run, H);
  }
  function view(state, H) {
    const run = state.run, empty = run && !run.summary.count;
    return '<div class="portfolio-comparison portfolio-rolling">' + (state.error ? '<p class="portfolio-compare-error negative" role="alert">' + H.esc(state.error) + '</p>' : '') +
      '<section class="card portfolio-rolling-setup"><div class="card-head"><div><h2>起点检验</h2><p>每个月的首个共同交易日各建一次仓，按当前设置持有到期。</p></div></div>' + controls(state, H) + '</section>' +
      (empty ? '<p class="portfolio-warning">' + run.summary.failed + ' 个起点都无法模拟：' + H.esc(run.rows[0].error) + '</p>' : results(state, H)) + '</div>';
  }
  function csv(run) {
    const code = P.currencyInfo(run.config).code;
    const rows = [['起点', '实际开始日', '结束日', '模拟状态', '缺项', '年化收益%', '累计收益%', '最大回撤%', '总投入本金' + code, '期末税后估值' + code, '一次性投入年化%', '对照年化%']];
    for (const row of run.rows) {
      rows.push(row.error ? [row.start, '', '', '未完成', row.error, '', '', '', '', '', '', ''] :
        [row.start, row.actualStart, row.end, '已完成', '', row.annualReturn, row.totalReturn, row.mdd, row.contributed, row.value, row.lumpSum, row.benchmark]);
    }
    return M.csv(rows);
  }
  window.ChanghengPortfolioRolling = { view, csv, PERIODS };
})();
