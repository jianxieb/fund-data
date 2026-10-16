(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'), require('./return-comparison-model.js'));
  else root.ChanghengFinancialEventsModel = factory(root.Changheng, root.ChanghengReturnComparisonModel);
})(typeof window === 'object' ? window : this, function (M, R) {
  'use strict';
  const horizons = [1, 5, 21, 63, 252];
  function validate(event, rows) {
    if (!rows?.length || rows.map(r => r.code).join('|') !== event.assetCodes.join('|')) throw new Error('事件与行情标的不一致');
    for (const r of rows) {
      if (!['USD', 'CNY'].includes(r.currency) || !['price_index', 'provider_adjusted_close'].includes(r.basis)) throw new Error('缺明确的行情币种或回报口径');
      if (!r.series?.length || r.series.at(-1)[0] > r.historyAsOf) throw new Error('行情结束日期无效');
      r.series.forEach(([d, p], i) => {
        if (!M.validDate(d) || !M.finite(p) || p <= 0 || i && d <= r.series[i - 1][0]) throw new Error('日线存在重复日期或无效价格');
      });
    }
    return rows;
  }
  function missingBetween(row, start, end) {
    return (row.missingObservations || []).some(m => m.date > start && m.date <= end && m.reason !== 'unclosed_exchange_session');
  }
  function outcomes(event, row) {
    const index = row.series.findIndex(p => p[0] >= event.marketDate);
    const base = index > 0 ? row.series[index - 1] : null;
    return { ...row, baseDate: base?.[0], results: horizons.map(n => {
      const end = base && row.series[index + n - 1];
      const reason = !base ? '缺事件前收盘' : !end ? '未到第' + n + '个交易日' : missingBetween(row, base[0], end[0]) ? '区间缺有效日线' : '';
      return { days: n, start: base?.[0], end: end?.[0], value: reason ? null : (end[1] / base[1] - 1) * 100, reason };
    }) };
  }
  function study(event, raw, mode = 'chapter') {
    const rows = validate(event, raw), maps = rows.map(r => new Map(r.series));
    const dates = rows[0].series.map(p => p[0]).filter(d => maps.every(m => m.has(d)));
    const before = dates.filter(d => d < event.marketDate).at(-1);
    if (!before) throw new Error('缺共同的事件前收盘');
    const reaction = dates.findIndex(d => d >= event.marketDate);
    const requestedEnd = mode === 'chapter' ? event.windowEnd || dates.at(-1) : dates[Math.min(dates.length - 1, reaction + (mode === 'year' ? 251 : 62))];
    const start = mode === 'chapter' ? dates.find(d => d >= event.windowStart) : dates[Math.max(0, reaction - 21)];
    const end = dates.filter(d => d <= requestedEnd).at(-1), baseDate = mode === 'chapter' ? start : before;
    if (!start || !end || start >= end) throw new Error('缺该观察窗口的共同日线');
    const plotRows = rows.map((row, i) => {
      const base = maps[i].get(baseDate), own = row.series.filter(p => p[0] >= start && p[0] <= end);
      const riskMissing = missingBetween(row, start, end);
      const total = (maps[i].get(end) / base - 1) * 100, years = M.yearsBetween(baseDate, end);
      return { ...row, total, annual: years >= 1 - 3 / 365.2425 ? M.annualized(total, years) : null,
        mdd: riskMissing ? null : R.drawdown(own).value,
        points: own.map(([d, p]) => [d, (p / base - 1) * 100]) };
    });
    return { start, end, baseDate, mode, rows: plotRows, outcomes: rows.map(r => outcomes(event, r)),
      dates: dates.filter(d => d >= start && d <= end), incomplete: mode !== 'chapter' && dates.length - reaction < (mode === 'year' ? 252 : 63) };
  }
  return { horizons, validate, outcomes, study };
});
