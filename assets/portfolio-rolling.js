(function () {
  'use strict';
  // 起点检验: the tab's markup, chart and CSV. The windows themselves are run by the model.
  const M = window.Changheng, P = window.ChanghengPortfolioModel;
  const PERIODS = [1, 3, 5, 10];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  // 一次性投入 is drawn last and in its own hue: when a strategy never acts in a window its line lies exactly on the setup's.
  const LINES = [['setup', '本组合', '#35654a', ''], ['lumpSum', '一次性投入', '#4a6fb5', '5 5'], ['benchmark', '对照', '#9c8d6e', '7 4']];
  const DRAW_ORDER = ['benchmark', 'setup', 'lumpSum'];
  const GAPS = [['above', '本组合更高', 'rgba(65,118,88,.26)'], ['below', '本组合更低', 'rgba(179,81,66,.24)']];
  const SAME = 1e-9;
  const valueOf = (row, key) => key === 'setup' ? row.annualReturn : row[key];
  const tickLabel = value => String(+value.toFixed(2)) + '%';
  // Round steps that always include 0, so no negative tick appears unless a value is negative.
  function axis(min, max) {
    const lo = Math.min(0, min), hi = Math.max(0, max), raw = (hi - lo || 1) / 5, magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw - 1e-12);
    const low = Math.floor(lo / step + 1e-9) * step, high = Math.max(low + step, Math.ceil(hi / step - 1e-9) * step);
    return { low, high, step, ticks: Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => +(low + i * step).toFixed(10)) };
  }
  function timeTicks(first, last) {
    const firstYear = Number(first.slice(0, 4)), lastYear = Number(last.slice(0, 4)), ticks = [];
    if (Date.parse(last) - Date.parse(first) < 3 * 365.25 * 864e5) {
      for (let y = firstYear; y <= lastYear; y++) for (const m of ['01', '04', '07', '10']) {
        const day = y + '-' + m + '-01';
        if (day > first && day <= last) ticks.push({ day, label: y + '-' + m, kind: 'month' });
      }
      return ticks;
    }
    const every = lastYear - firstYear > 12 ? 2 : 1;
    for (let y = firstYear + 1; y <= lastYear; y++) if ((y - firstYear) % every === 0 || every === 1) ticks.push({ day: y + '-01-01', label: String(y), kind: 'year' });
    return ticks;
  }
  // Shade between the setup and 一次性投入: one quadrilateral per pair of starts, split where the lines cross.
  function gapPaths(rows, x, y) {
    const parts = { above: '', below: '' }, side = d => d > SAME ? 'above' : d < -SAME ? 'below' : null;
    const add = (key, points) => { parts[key] += 'M' + points.map(([px, py]) => px.toFixed(2) + ',' + py.toFixed(2)).join('L') + 'Z'; };
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (![a.annualReturn, a.lumpSum, b.annualReturn, b.lumpSum].every(finite)) continue;
      const d0 = a.annualReturn - a.lumpSum, d1 = b.annualReturn - b.lumpSum, s0 = side(d0), s1 = side(d1);
      if (!s0 && !s1) continue;
      const x0 = x(a.start), x1 = x(b.start);
      if (!s0 || !s1 || s0 === s1) { add(s0 || s1, [[x0, y(a.annualReturn)], [x1, y(b.annualReturn)], [x1, y(b.lumpSum)], [x0, y(a.lumpSum)]]); continue; }
      const t = d0 / (d0 - d1), xc = x0 + t * (x1 - x0), yc = y(a.annualReturn + t * (b.annualReturn - a.annualReturn));
      add(s0, [[x0, y(a.annualReturn)], [xc, yc], [x0, y(a.lumpSum)]]);
      add(s1, [[xc, yc], [x1, y(b.annualReturn)], [x1, y(b.lumpSum)]]);
    }
    return parts;
  }
  const sample = (key, color, dash) => '<svg width="28" height="10" aria-hidden="true"><line data-rolling-sample="' + key + '" x1="2" x2="26" y1="5" y2="5" stroke="' + color + '" stroke-width="2.4"' +
    (dash ? ' stroke-dasharray="' + dash + '" stroke-linecap="butt"' : ' stroke-linecap="round"') + '/></svg>';
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
    const W = 1120, HH = 320, left = 64, right = W - 20, top = 16, bottom = HH - 38;
    const first = Date.parse(rows[0].start), last = Date.parse(rows.at(-1).start);
    const x = day => left + (Date.parse(day) - first) / Math.max(1, last - first) * (right - left);
    const values = rows.flatMap(row => lines.map(([key]) => valueOf(row, key))).filter(finite);
    const { low, high, ticks } = axis(Math.min(...values), Math.max(...values));
    const y = value => top + (high - value) / (high - low) * (bottom - top);
    const line = (y0, stroke) => '<line x1="' + left + '" x2="' + right + '" y1="' + y0.toFixed(2) + '" y2="' + y0.toFixed(2) + '" stroke="' + stroke + '"/>';
    let grid = ticks.map(value => line(y(value), value === 0 ? '#b9c2b0' : '#e5eadd') +
      '<text data-rolling-tick="' + value + '" x="' + (left - 10) + '" y="' + (y(value) + 4).toFixed(2) + '" text-anchor="end">' + tickLabel(value) + '</text>').join('');
    grid += timeTicks(rows[0].start, rows.at(-1).start).map(tick => {
      const px = x(tick.day).toFixed(2);
      return '<line x1="' + px + '" x2="' + px + '" y1="' + bottom + '" y2="' + (bottom + 5) + '" stroke="#b9c2b0"/><text data-rolling-' + tick.kind + '="' + tick.label + '" x="' + px + '" y="' + (HH - 12) + '" text-anchor="middle">' + tick.label + '</text>';
    }).join('');
    const hasLumpSum = lines.some(([key]) => key === 'lumpSum'), gaps = hasLumpSum ? gapPaths(rows, x, y) : { above: '', below: '' };
    const shading = GAPS.filter(([key]) => gaps[key]).map(([key, , fill]) => '<path data-rolling-gap="' + key + '" fill="' + fill + '" d="' + gaps[key] + '"/>').join('');
    const style = Object.fromEntries(LINES.map(([key, , color, dash]) => [key, { color, dash }]));
    const paths = DRAW_ORDER.filter(key => lines.some(([k]) => k === key)).map(key => {
      let path = '', connected = false;
      for (const row of rows) {
        const v = valueOf(row, key);
        if (!finite(v)) { connected = false; continue; }
        path += (connected ? 'L' : 'M') + x(row.start).toFixed(2) + ',' + y(v).toFixed(2); connected = true;
      }
      const { color, dash } = style[key];
      return '<path data-rolling-line="' + key + '" d="' + path + '" stroke="' + color + '" stroke-width="' + (key === 'setup' ? 2.4 : 2) + '"' + (dash ? ' stroke-dasharray="' + dash + '" stroke-linecap="butt"' : ' stroke-linecap="round"') + ' fill="none"/>';
    }).join('');
    // Hover: one transparent column per start, with every plotted value in its title.
    const hits = rows.map((row, i) => {
      const at = x(row.start), from = i ? (x(rows[i - 1].start) + at) / 2 : left, to = i < rows.length - 1 ? (at + x(rows[i + 1].start)) / 2 : right;
      const label = [row.start + ' 起持有 ' + run.years + ' 年', ...lines.filter(([key]) => finite(valueOf(row, key))).map(([key, name]) => (key === 'benchmark' ? name + ' ' + run.benchmark : name) + ' ' + H.pct(valueOf(row, key), 2))].join('\n');
      return '<rect x="' + from.toFixed(2) + '" y="' + top + '" width="' + Math.max(1, to - from).toFixed(2) + '" height="' + (bottom - top) + '"><title>' + H.esc(label) + '</title></rect>';
    }).join('');
    const same = hasLumpSum ? rows.filter(row => finite(row.lumpSum) && Math.abs(row.annualReturn - row.lumpSum) <= SAME).length : 0;
    const legend = lines.map(([key, name, color, dash]) => '<span>' + sample(key, color, dash) + H.esc(key === 'benchmark' ? name + ' ' + run.benchmark : name) + '</span>').join('') +
      GAPS.filter(([key]) => gaps[key]).map(([, name, fill]) => '<span><i class="portfolio-rolling-swatch" style="background:' + fill + '"></i>' + name + '</span>').join('');
    return '<section class="card portfolio-rolling-chart"><div class="card-head"><div><h2>各起点的年化收益</h2><p>横轴为建仓月份，每个起点持有 ' + run.years + ' 年</p></div></div><div class="portfolio-rolling-legend">' + legend +
      '</div><div class="portfolio-compare-plot-scroll"><svg class="portfolio-compare-plot" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="各起点持有' + run.years + '年的年化收益">' + grid + shading + paths +
      '<g class="portfolio-rolling-hits">' + hits + '</g></svg></div>' + (same ? '<p class="portfolio-rolling-note">' + same + ' 个起点的结果与一次性投入完全相同，两条线重合。</p>' : '') + '</section>';
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
