(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengDropWindowModel = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function validDays(kind, n) {
    const min = kind === 'peak' ? 2 : kind === 'loss' ? 1 : Infinity;
    return Number.isInteger(n) && n >= min && n <= 2520;
  }
  const validThreshold = n => Number.isFinite(n) && n > 0 && n < 100 && Math.round(n * 100) / 100 === n;
  // Computing percentages from decimal-valued closes can leave a tiny residue at an exact boundary.
  const exceeds = (metric, threshold) => metric != null && validThreshold(threshold) &&
    metric.pct - threshold > 200 * Number.EPSILON;
  const gapMs = 10 * 86400000;
  const metric = ([date, close], endClose) => ({ date, close, pct: ((close - endClose) / close) * 100 });

  // Input: validated [ISO trading date, positive index close] pairs, strictly ascending.
  function rolling(series, {peakDays, lossDays} = {}) {
    if ((peakDays != null && !validDays('peak', peakDays)) || (lossDays != null && !validDays('loss', lossDays)))
      throw new Error('交易日窗口超出范围');
    // The descending deque stores candidate high indices. Each index is appended and removed at most once.
    const highs = peakDays == null ? null : new Int32Array(series.length);
    let head = 0, tail = 0, start = 0, previousDay;
    return series.map(([date, close], i) => {
      const day = Date.parse(date);
      if (i && day - previousDay > gapMs) { start = i; head = tail = 0; }
      previousDay = day;
      let peak = null, loss = null;
      if (highs) {
        const first = i - peakDays + 1;
        while (head < tail && highs[head] < first) head++;
        // A more recent equal high survives longer and supplies the auditable reference date.
        while (head < tail && series[highs[tail - 1]][1] <= close) tail--;
        highs[tail++] = i;
        if (first >= start) peak = metric(series[highs[head]], close);
      }
      if (lossDays != null && i - lossDays >= start) loss = metric(series[i - lossDays], close);
      return { peak, loss };
    });
  }
  return { rolling, validDays, validThreshold, exceeds };
});
