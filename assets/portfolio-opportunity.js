(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChanghengPortfolioOpportunity = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, WINDOW = 1260, MIN_PRIOR = 252;
  const families = ['discount', 'volatility', 'fear', 'mixed'];
  const definitions = Object.freeze({
    opportunity_discount_10: Object.freeze({ family: 'discount', reserve: .1, threshold: 35 }),
    opportunity_discount_20: Object.freeze({ family: 'discount', reserve: .2, threshold: 50 }),
    opportunity_mixed_10: Object.freeze({ family: 'mixed', reserve: .1, threshold: 35 })
  });
  const formulas = Object.freeze({
    discount: '100 × (0.6D + 0.4S)',
    volatility: '100 × (0.5D + 0.35Z + 0.15 × clamp(1 − RV21/(2RV126)))',
    fear: '100 × (0.5D + 0.25F + 0.25R)',
    mixed: '100 × (0.4D + 0.3S + 0.15F + 0.15R)'
  });
  const coefficients = Object.freeze({ discount: Object.freeze({ D: .6, S: .4 }),
    volatility: Object.freeze({ D: .5, Z: .35, volatilityRatio: .15 }),
    fear: Object.freeze({ D: .5, F: .25, R: .25 }), mixed: Object.freeze({ D: .4, S: .3, F: .15, R: .15 }) });
  const reasons = {
    missing_proxy: '缺实际基准ETF历史', stale_proxy: '基准ETF最近收盘已超过7日',
    missing_vix: '缺VIX与VIX3M同日收盘记录', stale_vix: '信号日前VIX收盘已超过7日',
    proxy_gap: '基准ETF历史中存在超过7日的报价缺口', vix_gap: 'VIX历史中存在超过7日的报价缺口',
    price_warmup: '基准ETF不足252个实际收盘', stretch_warmup: '此前完整252日均线比率不足252个',
    volatility_warmup: '实际波动率预热不足或为零', fear_warmup: '此前VIX实际观察不足252个',
    reversal_warmup: 'VIX不足63个实际观察'
  };
  const clip = value => Math.max(0, Math.min(1, value));
  const sum = values => values.reduce((a, b) => a + b, 0);
  const mean = values => sum(values) / values.length;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const time = day => Date.parse(day + 'T00:00:00Z');
  const gap = (a, b) => (time(a) - time(b)) / DAY;
  const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(time(day)) && new Date(time(day)).toISOString().slice(0, 10) === day;
  const clone = value => JSON.parse(JSON.stringify(value));
  function series(value, label, columns = 2) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(label + '须为日期与价格记录');
    return value.map((row, i) => {
      if (!Array.isArray(row) || row.length < columns || !validDay(row[0]) || i && row[0] <= value[i - 1][0] ||
          row.slice(1, columns).some(v => !finite(v) || v <= 0)) throw new Error(label + '日期、顺序或正值记录无效');
      return row.slice(0, columns);
    });
  }
  function annualVolatility(values) {
    const average = mean(values);
    return Math.sqrt(sum(values.map(v => (v - average) ** 2)) / (values.length - 1) * 252);
  }
  function priceFeatures(input) {
    const observations = series(input, '基准ETF'), out = [], returns = [], stretches = []; let sourceGap = null;
    for (let i = 0; i < observations.length; i++) {
      const [day, price] = observations[i];
      if (i && gap(day, observations[i - 1][0]) > 7) sourceGap ||= { from: observations[i - 1][0], to: day };
      if (i) returns.push(Math.log(price / observations[i - 1][1]));
      const window = i >= 251 ? observations.slice(i - 251, i + 1).map(r => r[1]) : null;
      const high252 = window ? Math.max(...window) : null, ma252 = window ? mean(window) : null;
      const drawdown = window ? 1 - price / high252 : null, stretch = window ? price / ma252 : null;
      // Only ratios with a complete 252-observation moving average enter the
      // history. The current ratio is excluded from its own rank.
      const prior = stretches.slice(-WINDOW).filter(finite);
      const rankGreater = stretch === null ? 0 : prior.filter(v => v > stretch).length;
      const rankEqual = stretch === null ? 0 : prior.filter(v => v === stretch).length;
      const S = stretch !== null && prior.length >= MIN_PRIOR ?
        (rankGreater + .5 * rankEqual) / prior.length : null;
      const rv21 = i >= 21 ? annualVolatility(returns.slice(-21)) : null;
      const rv126 = i >= 126 ? annualVolatility(returns.slice(-126)) : null;
      out.push({ day, price, high252, ma252, drawdown, stretch, rv21, rv126, sourceGap,
        priorStretchN: prior.length, rankGreater, rankEqual, rankCount: prior.length,
        D: drawdown === null ? null : clip(drawdown / .25), S,
        Z: drawdown !== null && rv21 > 0 ? clip(drawdown / rv21) : null });
      stretches.push(stretch);
    }
    return out;
  }
  function fearFeatures(input) {
    let sourceGap = null;
    return series(input, 'VIX/VIX3M', 3).map(([day, vix, vix3m], i, all) => {
      if (i && gap(day, all[i - 1][0]) > 7) sourceGap ||= { from: all[i - 1][0], to: day };
      const prior = all.slice(Math.max(0, i - WINDOW), i).map(r => r[1]);
      const peak63 = i >= 62 ? Math.max(...all.slice(i - 62, i + 1).map(r => r[1])) : null;
      const fearBelow = prior.filter(v => v < vix).length;
      return { day, vix, vix3m, ratio: vix / vix3m, peak63, priorVixN: prior.length, sourceGap,
        fearBelow, fearCount: prior.length,
        // The frozen VIX formula is strict-less-than, whereas S uses half ties.
        F: prior.length >= MIN_PRIOR ? fearBelow / prior.length : null,
        R: peak63 === null ? null : clip((peak63 - vix) / (.4 * peak63)) * clip((peak63 - 20) / 30) };
    });
  }
  function latest(rows, day, strict = false) {
    let left = 0, right = rows.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (rows[mid].day < day || !strict && rows[mid].day === day) left = mid + 1; else right = mid;
    }
    return rows[left - 1] || null;
  }
  function createFeatures({ rawHistories = {}, vixContext } = {}) {
    const proxies = ['us:SOXX', 'us:QQQ'], ids = ['us:USD', 'us:TQQQ'];
    const prices = proxies.map(id => priceFeatures(rawHistories[id]));
    const fears = fearFeatures(vixContext?.series);
    const cache = new Map();
    function compute(day) {
      if (!validDay(day)) throw new Error('买点评分日期无效');
      const fear = latest(fears, day, true);
      const vixMissing = !fear ? 'missing_vix' : gap(day, fear.day) > 7 ? 'stale_vix' : fear.sourceGap ? 'vix_gap' : null;
      const legs = prices.map((rows, i) => {
        const p = latest(rows, day), proxyMissing = !p ? 'missing_proxy' : gap(day, p.day) > 7 ? 'stale_proxy' : p.sourceGap ? 'proxy_gap' : null;
        const components = { D: proxyMissing ? null : p.D, S: proxyMissing ? null : p.S, Z: proxyMissing ? null : p.Z,
          F: vixMissing ? null : fear.F, R: vixMissing ? null : fear.R };
        const required = { discount: ['D', 'S'], volatility: ['D', 'Z'], fear: ['D', 'F', 'R'], mixed: ['D', 'S', 'F', 'R'] };
        const scores = {}, missingReasons = {};
        for (const family of families) {
          const missing = required[family].filter(key => !finite(components[key])).map(field => {
            const code = ['F', 'R'].includes(field) ? vixMissing || (field === 'F' ? 'fear_warmup' : 'reversal_warmup') :
              proxyMissing || (field === 'D' ? 'price_warmup' : field === 'S' ? 'stretch_warmup' : 'volatility_warmup');
            return { field, code, message: reasons[code] };
          });
          if (family === 'volatility' && !(p?.rv21 > 0 && p?.rv126 > 0)) missing.push({ field: 'rv126', code: 'volatility_warmup', message: reasons.volatility_warmup });
          missingReasons[family] = missing;
          if (missing.length) { scores[family] = null; continue; }
          const { D, S, Z, F, R } = components;
          scores[family] = family === 'discount' ? 100 * (.6 * D + .4 * S) : family === 'volatility' ?
            100 * (.5 * D + .35 * Z + .15 * clip(1 - p.rv21 / (2 * p.rv126))) :
            family === 'fear' ? 100 * (.5 * D + .25 * F + .25 * R) : 100 * (.4 * D + .3 * S + .15 * F + .15 * R);
        }
        return { id: ids[i], proxyId: proxies[i], sourceDay: p?.day || null, inputs: { ...(p || {}),
          vixDay: fear?.day || null, vix: fear?.vix ?? null, vix3m: fear?.vix3m ?? null, vixPeak63: fear?.peak63 ?? null,
          fearBelow: fear?.fearBelow ?? 0, fearCount: fear?.fearCount ?? 0, priorVixN: fear?.priorVixN ?? 0 }, components, scores, missingReasons };
      });
      return { day, legs, vix: { ...(fear || {}), sourceDay: fear?.day || null,
        missing: vixMissing ? { code: vixMissing, message: reasons[vixMissing] } : null },
      metadata: { version: 'opportunity-1', scoreUnit: 'points', probability: false, formulas, coefficients } };
    }
    function at(day) {
      if (!cache.has(day)) cache.set(day, compute(day));
      return clone(cache.get(day));
    }
    // Chart references need only the scores, not thousands of cached audit snapshots.
    function scoresAt(day) { return compute(day).legs.map(leg => leg.scores); }
    return { at, scoresAt };
  }
  return { createFeatures, priceFeatures, fearFeatures, definitions, formulas, coefficients };
});
