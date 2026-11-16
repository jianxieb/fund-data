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
  const GAIN = '#6f9f7e', LOSS = '#cf8072';
  const textWidth = (text, size = 12) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? size : size * .6), 0);
  // A label beside a marker, kept inside [left, right] by switching its anchor.
  function label(x, y, name, value, side, left, right, attrs = '') {
    const width = textWidth(name + ' ' + value) + 4;
    let anchor = side, at = side === 'end' ? x - 5 : side === 'start' ? x + 5 : x;
    if (side === 'middle') { if (x - width / 2 < left) { anchor = 'start'; at = left; } else if (x + width / 2 > right) { anchor = 'end'; at = right; } }
    else if (side === 'end' && at - width < left) { anchor = 'start'; at = Math.max(left, x + 5); }
    else if (side === 'start' && at + width > right) { anchor = 'end'; at = Math.min(right, x - 5); }
    return '<text' + attrs + ' x="' + at.toFixed(2) + '" y="' + y + '" text-anchor="' + anchor + '">' + name + ' <tspan class="strong">' + value + '</tspan></text>';
  }
  // Bins on a round step aligned to 0, so a bin is wholly a gain or wholly a loss.
  function histogram(run, H) {
    const s = run.summary, a = s.annual, values = run.rows.filter(row => !row.error).map(row => row.annualReturn);
    const raw = Math.max(a.max - a.min, 1e-6) / 12, magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(v => v >= raw - 1e-12);
    const lo = Math.floor(a.min / step + 1e-9) * step, n = Math.max(1, Math.ceil((a.max - lo) / step - 1e-9)), counts = Array(n).fill(0);
    for (const v of values) counts[Math.min(n - 1, Math.floor((v - lo) / step + 1e-9))]++;
    const W = 760, HH = 266, left = 24, right = W - 24, top = 52, base = 204, most = Math.max(...counts);
    const x = v => left + (v - lo) / (n * step) * (right - left), edge = i => +(lo + i * step).toFixed(10), width = (right - left) / n;
    let svg = '<line x1="' + left + '" x2="' + right + '" y1="' + base + '" y2="' + base + '" stroke="#b9c2b0"/>', countLabels = '';
    svg += counts.map((count, i) => {
      const from = edge(i), to = edge(i + 1), h = most ? count / most * (base - top - 18) : 0, bx = x(from) + 1;
      // Counts go on top of the quartile markers, with a halo so a marker never runs through a number.
      if (count) countLabels += '<text class="halo" x="' + (bx + width / 2 - 1).toFixed(2) + '" y="' + (base - h - 6).toFixed(2) + '" text-anchor="middle">' + count + '</text>';
      return '<rect data-rolling-bin="' + from + '|' + to + '" data-count="' + count + '" fill="' + (from >= 0 ? GAIN : LOSS) + '" x="' + bx.toFixed(2) + '" y="' + (base - h).toFixed(2) + '" width="' + Math.max(1, width - 2).toFixed(2) + '" height="' + h.toFixed(2) + '" rx="3">' +
        '<title>' + H.esc(H.pct(from, 1) + ' 至 ' + H.pct(to, 1) + '：' + count + ' 个起点') + '</title></rect>';
    }).join('');
    const every = n > 12 ? 2 : 1;
    for (let i = 0; i <= n; i += every) svg += '<text x="' + x(edge(i)).toFixed(2) + '" y="' + (base + 24) + '" text-anchor="middle">' + tickLabel(edge(i)) + '</text>';
    if (lo < 0 && edge(n) > 0) svg += '<line x1="' + x(0).toFixed(2) + '" x2="' + x(0).toFixed(2) + '" y1="' + (top - 6) + '" y2="' + base + '" stroke="#8d988a"/>';
    svg += [['q1', '25%分位', 'end'], ['median', '中位', 'middle'], ['q3', '75%分位', 'start']].map(([key, name, side]) => {
      const px = x(a[key]).toFixed(2);
      return '<line data-rolling-marker="' + key + '" x1="' + px + '" x2="' + px + '" y1="' + (key === 'median' ? 22 : 40) + '" y2="' + base + '" stroke="#34463b" stroke-width="' + (key === 'median' ? 1.8 : 1.2) + '"' + (key === 'median' ? '' : ' stroke-dasharray="4 3"') + '/>' +
        label(x(a[key]), key === 'median' ? 16 : 36, name, H.pct(a[key], 2), side, left, right);
    }).join('') + countLabels;
    for (const [key, name, side] of [['min', '最差', 'start'], ['max', '最好', 'end']]) {
      const px = x(a[key]);
      svg += '<path d="M' + px.toFixed(2) + ',' + (base + 2) + 'l-4,7h8z" fill="#5d6b60"/>' + label(key === 'min' ? Math.max(left, px - 5) - 5 : Math.min(right, px + 5) + 5, base + 54, name, H.pct(a[key], 2), side, left, right);
    }
    return '<svg class="portfolio-rolling-dist" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="' + H.esc('各起点年化收益分布：最差 ' + H.pct(a.min, 2) + '，25%分位 ' + H.pct(a.q1, 2) + '，中位 ' + H.pct(a.median, 2) + '，75%分位 ' + H.pct(a.q3, 2) + '，最好 ' + H.pct(a.max, 2)) + '">' + svg + '</svg>';
  }
  function drawdownStrip(s, H) {
    const d = s.drawdown, { low, ticks } = axis(d.worst, 0), W = 420, left = 18, right = W - 18, mid = 58;
    const x = v => left + (v - low) / (0 - low) * (right - left), pct = v => H.pct(v, 2, false);
    const worstWidth = textWidth('最深 ' + pct(d.worst)) + 10, bestWidth = textWidth('最浅 ' + pct(d.best)) + 10;
    const crowded = Math.max(left, x(d.worst)) + worstWidth > Math.min(right, x(d.best)) - bestWidth, HH = crowded ? 148 : 130;
    let svg = '<line x1="' + left + '" x2="' + right + '" y1="' + (mid + 24) + '" y2="' + (mid + 24) + '" stroke="#b9c2b0"/>';
    svg += ticks.filter((_, i) => ticks.length <= 7 || i % 2 === 0).map(v => '<text x="' + x(v).toFixed(2) + '" y="' + (mid + 40) + '" text-anchor="middle">' + tickLabel(v) + '</text>').join('');
    svg += '<line x1="' + x(d.worst).toFixed(2) + '" x2="' + x(d.best).toFixed(2) + '" y1="' + mid + '" y2="' + mid + '" stroke="' + LOSS + '" stroke-width="2"/>' +
      '<rect x="' + x(d.q1).toFixed(2) + '" y="' + (mid - 11) + '" width="' + Math.max(2, x(d.q3) - x(d.q1)).toFixed(2) + '" height="22" rx="4" fill="rgba(207,128,114,.32)" stroke="' + LOSS + '"/>' +
      [d.worst, d.best].map(v => '<circle cx="' + x(v).toFixed(2) + '" cy="' + mid + '" r="4" fill="' + LOSS + '"/>').join('') +
      '<line x1="' + x(d.median).toFixed(2) + '" x2="' + x(d.median).toFixed(2) + '" y1="' + (mid - 15) + '" y2="' + (mid + 15) + '" stroke="#7d3529" stroke-width="2.4"/>';
    svg += label(x(d.median), 16, '中位', pct(d.median), 'middle', left, right, ' data-rolling-drawdown="median"') +
      label(x(d.q1), 34, '25%', pct(d.q1), 'end', left, right, ' data-rolling-drawdown="q1"') + label(x(d.q3), 34, '75%', pct(d.q3), 'start', left, right, ' data-rolling-drawdown="q3"') +
      label(Math.max(left, x(d.worst) - 5) - 5, mid + 64, '最深', pct(d.worst), 'start', left, right, ' data-rolling-drawdown="worst"') +
      label(Math.min(right, x(d.best) + 5) + 5, mid + (crowded ? 82 : 64), '最浅', pct(d.best), 'end', left, right, ' data-rolling-drawdown="best"');
    return '<svg class="portfolio-rolling-dist" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="' + H.esc('各起点最大回撤：最深 ' + pct(d.worst) + '，25% ' + pct(d.q1) + '，中位 ' + pct(d.median) + '，75% ' + pct(d.q3) + '，最浅 ' + pct(d.best)) + '">' + svg + '</svg>';
  }
  function meters(s, run, H) {
    const tile = (key, name, item, note, tone) => '<div class="portfolio-rolling-meter"><div><span>' + H.esc(name) + '<small>' + note + '</small></span><strong class="num">' + item.wins + ' / ' + item.of + '</strong></div>' +
      '<div class="portfolio-rolling-meter-track"><i class="' + tone + '" data-rolling-meter="' + key + '" style="width:' + +(100 * item.wins / item.of).toFixed(2) + '%"></i></div></div>';
    return '<div class="portfolio-rolling-panel portfolio-rolling-meters"><h3>起点计数</h3>' + tile('losses', '亏损起点', { wins: s.losses, of: s.count }, '累计收益为负', 'loss') +
      (s.beatLumpSum ? tile('beatLumpSum', '胜过一次性投入', s.beatLumpSum, '年化收益更高的起点', 'gain') : '') +
      (s.beatBenchmark ? tile('beatBenchmark', '胜过对照 ' + run.benchmark, s.beatBenchmark, '年化收益更高的起点', 'gain') : '') + '</div>';
  }
  function results(state, H) {
    const run = state.run;
    if (!run) return '';
    const s = run.summary;
    const overview = '<div class="portfolio-rolling-overview"><div class="portfolio-rolling-panel"><h3>年化收益分布</h3><div class="portfolio-rolling-headline"><span>中位年化收益</span><strong class="num">' + H.pct(s.annual.median, 2) + '</strong>' +
      '<small>中间一半起点在 ' + H.pct(s.annual.q1, 2) + ' 至 ' + H.pct(s.annual.q3, 2) + ' 之间</small></div>' + histogram(run, H) + '</div>' +
      '<div class="portfolio-rolling-aside"><div class="portfolio-rolling-panel"><h3>最大回撤</h3>' + drawdownStrip(s, H) + '</div>' + meters(s, run, H) + '</div></div>';
    return (run.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(run.catalogRefresh.missing) + '</p>' : '') +
      H.card('起点分布', '起点 ' + s.firstStart + ' — ' + s.lastStart + ' · ' + s.count + ' 个 · 每个持有 ' + run.years + ' 年' + (s.failed ? ' · ' + s.failed + ' 个起点无法模拟' : ''),
        '<p class="portfolio-warning portfolio-rolling-caveat">相邻起点的区间大部分重叠，不是 ' + s.count + ' 次独立检验。</p>' + overview,
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
