(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.ChanghengResearchCharts = factory(root.Changheng);
})(typeof window === 'object' ? window : this, function (M) {
  'use strict';
  const colors = ['#2c654b', '#3d6fb3', '#b7782e', '#895fa8', '#a94e64', '#338c91', '#697438', '#6d6f7e'];
  const pct = x => (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  const esc = M.escapeHtml;
  function line(rows, { title = '累计收益', key = 'points', marker, markerLabel = '', cursor } = {}) {
    const available = rows.filter(r => r[key]?.length), all = available.flatMap(r => r[key]);
    if (!all.length) return '<div class="empty">这个区间缺可绘制的日线</div>';
    const dates = all.map(p => p[0]).sort(), first = Date.parse(dates[0]), last = Date.parse(dates.at(-1));
    const vals = all.map(p => p[1]);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), pad = Math.max(1, (hi - lo) * .09);
    const min = lo - pad, max = hi + pad, w = 1120, h = 390, l = 72, r = 30, top = 28, bottom = 44;
    const x = d => l + (Date.parse(d) - first) / Math.max(1, last - first) * (w - l - r);
    const y = v => h - bottom - (v - min) / (max - min) * (h - top - bottom);
    const grid = Array.from({ length: 6 }, (_, i) => { const v = min + (max - min) * i / 5, py = y(v); return `<line x1="${l}" x2="${w - r}" y1="${py}" y2="${py}" class="rc-grid"/><text x="${l - 10}" y="${py + 4}" text-anchor="end">${pct(v)}</text>`; }).join('');
    const axis = Array.from({ length: 5 }, (_, i) => { const stamp = first + (last - first) * i / 4; const date = new Date(stamp).toISOString().slice(0, 10); return `<text x="${x(date)}" y="${h - 14}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${date}</text>`; }).join('');
    const lines = available.map(row => {
      const points = row[key], color = row.color || colors[rows.indexOf(row) % colors.length];
      // Keep all observations. Downsampling could hide an extreme in a crisis.
      const path = points.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"><title>${esc(row.name)} · ${pct(points.at(-1)[1])}</title></path><circle cx="${x(points.at(-1)[0])}" cy="${y(points.at(-1)[1])}" r="3.5" fill="${color}"/>`;
    }).join('');
    const mark = marker && Date.parse(marker) >= first && Date.parse(marker) <= last ? `<line x1="${x(marker)}" x2="${x(marker)}" y1="${top}" y2="${h - bottom}" class="rc-event-line"/><text x="${Math.min(w - 200, x(marker) + 8)}" y="18">${esc(markerLabel)}</text>` : '';
    return `<svg class="rc-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}，${dates[0]}至${dates.at(-1)}，纵轴为${key === 'drawdowns' ? '回撤' : '累计收益率'}"><title>${esc(title)}</title>${grid}<line class="rc-zero" x1="${l}" x2="${w - r}" y1="${y(0)}" y2="${y(0)}"/>${axis}${lines}${mark}<line data-rc-cursor x1="${x(cursor || dates.at(-1))}" x2="${x(cursor || dates.at(-1))}" y1="${top}" y2="${h - bottom}" class="rc-cursor"/></svg>`;
  }
  function bars(rows, annual = false) {
    const key = annual ? 'annual' : 'total', values = rows.map(r => r[key]).filter(M.finite);
    const min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1;
    const zero = -min / span * 100;
    return `<div class="rc-bars" role="img" aria-label="${annual ? '年化' : '累计'}回报柱状图">${rows.map((r, i) => { const v = r[key]; return `<div class="rc-bar-row"><span>${esc(r.code)}</span><div class="rc-bar-track"><i class="rc-bar-zero" style="left:${zero}%"></i>${M.finite(v) ? `<i style="left:${Math.min(zero, (v - min) / span * 100)}%;width:${Math.abs(v) / span * 100}%;background:${colors[i]}"></i>` : ''}</div><b>${M.finite(v) ? pct(v) : '不足1年'}</b></div>`; }).join('')}</div>`;
  }
  return { line, bars, colors };
});
