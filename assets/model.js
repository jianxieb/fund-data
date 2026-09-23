/* Pure helpers for public investment research and source-aware data normalization. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Changheng = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const copy = x => JSON.parse(JSON.stringify(x));
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const escapeHtml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function annualized(total, years) {
    if (!finite(total) || total < -100 || !finite(years) || years <= 0) return null;
    const value = (Math.pow(1 + total / 100, 1 / years) - 1) * 100;
    return finite(value) ? value : null;
  }
  function yearsBetween(start, end) {
    if (!validDate(start) || !validDate(end) || end < start) return null;
    return (Date.parse(end) - Date.parse(start)) / 86400000 / 365.2425;
  }
  function hasWindow(start, end, years) {
    if (!validDate(start) || !validDate(end) || !Number.isInteger(years) || years <= 0 || start > end) return false;
    const d = new Date(end + 'T00:00:00Z'), m = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    if (!Number.isFinite(d.getTime()) || d.getUTCFullYear() < 0) return false;
    if (d.getUTCMonth() !== m) d.setUTCDate(0);
    return start <= d.toISOString().slice(0, 10);
  }
  function dedupeFunds(funds, extra) {
    const groups = new Map(), periods = [1, 2, 3, 5, 10];
    const date = value => validDate(value) ? value : null;
    const explicitEnd = (f, kind) => kind === 'return' ? date(f.returnAsOf) || date(f.retdate) : date(f.riskAsOf);
    const end = (f, kind) => explicitEnd(f, kind) || date(f.navdate);
    const first = (f, kind) => {
      const dates = [date(f.d), date(kind === 'return' ? f.returnFirst : f.riskFirst), kind === 'risk' ? date(f.riskStart) : null].filter(Boolean);
      return dates.length ? dates.sort().at(-1) : null;
    };
    // Net value, return and risk snapshots can have different dates. Select each
    // domain independently, without blending different return windows into one row.
    const latest = (rows, kind) => rows.slice().sort((a, b) => {
      if (kind !== 'nav') {
        const verifiedDates = Number(!!explicitEnd(b, kind)) - Number(!!explicitEnd(a, kind));
        if (verifiedDates) return verifiedDates;
      }
      const ad = kind === 'nav' ? date(a.navdate) : end(a, kind), bd = kind === 'nav' ? date(b.navdate) : end(b, kind);
      return (bd || '').localeCompare(ad || '') || Number(b.origin === 'overseas') - Number(a.origin === 'overseas');
    })[0];
    for (const [rows, origin] of [[extra, 'research'], [funds, 'overseas']]) for (const f of Array.isArray(rows) ? rows : []) {
      if (!record(f) || typeof f.c !== 'string' || !/^\d{6}$/.test(f.c)) continue;
      if (!groups.has(f.c)) groups.set(f.c, []);
      groups.get(f.c).push({ ...f, origin });
    }
    return [...groups.values()].map(rows => {
      const f = latest(rows, 'nav'), returns = latest(rows, 'return'), risk = latest(rows, 'risk');
      const returnEnd = end(returns, 'return'), riskEnd = end(risk, 'risk');
      const n = { ...f, exchange: !f.t || f.t === '场内ETF', returnAsOf: explicitEnd(returns, 'return'), riskAsOf: explicitEnd(risk, 'risk'),
        returnDateInferred: !explicitEnd(returns, 'return'), riskDateInferred: !explicitEnd(risk, 'risk'),
        returnFirst: date(returns.returnFirst), riskFirst: date(risk.riskFirst) || date(risk.riskStart),
        returnPeriods: Array.isArray(returns.returnPeriods) ? copy(returns.returnPeriods) : null,
        returnSource: returns.returnSource, returnSourceUrl: returns.returnSourceUrl,
        returnBasis: returns.returnBasis || returns.basis, riskBasis: risk.riskBasis || risk.basis,
        performanceVerifiedAt: returns.performanceVerifiedAt, riskVerifiedAt: risk.performanceVerifiedAt };
      n.r = periods.map((y, i) => {
        const raw = returns.r && returns.r[i];
        if (!hasWindow(first(returns, 'return'), returnEnd, y) || !finite(raw) || raw < -100) return null;
        if (n.returnPeriods) {
          const p = n.returnPeriods.find(p => record(p) && p.years === y);
          if (!p || !hasWindow(p.start, p.end, y) || p.end !== returnEnd || p.start < first(returns, 'return')) return null;
        }
        return raw;
      });
      n.returnYears = periods.map(y => {
        const p = n.returnPeriods && n.returnPeriods.find(p => record(p) && p.years === y);
        return p ? yearsBetween(p.start, p.end) : null;
      });
      for (const [key, y] of [['mdd5', 5], ['vol5', 5], ['mdd3', 3], ['v3', 3]]) {
        const v = risk[key], allowed = key.startsWith('mdd') ? finite(v) && v >= -100 && v <= 0 : finite(v) && v >= 0;
        n[key] = hasWindow(first(risk, 'risk'), riskEnd, y) && allowed ? v : null;
      }
      const fees = [0, 1, 2].map(i => Array.isArray(f.fee) && finite(f.fee[i]) && f.fee[i] >= 0 ? f.fee[i] : null);
      n.fee = fees;
      n.annualFee = fees[0] !== null && fees[1] !== null ? fees[0] + fees[1] : null;
      n.feeCoverage = fees.every(v => v !== null) ? 'complete' : fees.some(v => v !== null) ? 'partial' : 'unknown';
      n.knownOngoingFee = fees.some(v => v !== null) ? sum(fees.filter(v => v !== null)) : null;
      n.totalOngoingFee = n.feeCoverage === 'complete' ? sum(fees) : null;
      const text = (f.ix || '') + ' ' + (f.n || '');
      const indexLike = /指数|ETF|联接/.test(text);
      const mixed = /混合|灵活配置|固收[+＋]|偏债|可转债|转债|FOF|多资产|资产配置/.test(text);
      const physicalGold = /黄金|上海金|Au99|伦敦金/i.test(text) && !/黄金股|产业|矿业|股票/.test(text);
      const overseas = f.origin === 'overseas' || /QDII|海外|全球|美国|标普|纳斯达克|恒生|港股|香港|沪港深/.test(text);
      n.dividend = /红利|股息/.test(text);
      n.overseasExposure = overseas;
      n.fixedIncomeOrMixed = f.g === 'x5' || mixed || /债券|纯债|货币/.test(text);
      n.active = /主动|增强/.test(text) || !indexLike;
      n.asset = physicalGold && !mixed ? 'gold' : f.g === 'x5' || mixed || /原油|商品|期货|白银|沪港深/.test(text) ? 'other' : overseas ? 'global' : 'cn';
      n.assetInferred = true;
      return n;
    });
  }
  function visiblePeriods(value) {
    const selected = Array.isArray(value) ? [1, 2, 3, 5, 10].filter(y => value.includes(y)) : [];
    return selected.length ? selected : [3, 5, 10];
  }
  function compareNullable(a, b, descending = true) {
    if (a == null || typeof a === 'number' && !finite(a)) return b == null || typeof b === 'number' && !finite(b) ? 0 : 1;
    if (b == null || typeof b === 'number' && !finite(b)) return -1;
    return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * (descending ? -1 : 1);
  }
  function equityQualifies(rule, limits) {
    if (!record(rule) || !rule.equityEligible || !record(rule.thresholdInputs)) return false;
    const t = rule.thresholdInputs;
    for (const [field, limit] of [['a3', 'minA3'], ['a5', 'minA5'], ['historyYears', 'minHistoryYears'], ['scale', 'minScale']]) {
      if (!finite(t[field]) || !finite(limits[limit]) || t[field] < limits[limit]) return false;
    }
    if (limits.minA10 != null && (!finite(t.a10) || !finite(limits.minA10) || t.a10 < limits.minA10)) return false;
    if (!t.passive && (!finite(t.managerYears) || !finite(limits.minManagerYears) || t.managerYears < limits.minManagerYears)) return false;
    return true;
  }
  function csv(rows) {
    return '\ufeff' + rows.map(row => row.map(v => {
      let s = v == null ? '' : String(v);
      if (typeof v === 'string' && (/^[=+\-@\t\r\n]/.test(s) || /^[\s\u0000]*[=+\-@]/.test(s))) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  return { finite, sum, copy, escapeHtml, validDate, annualized, yearsBetween, hasWindow, dedupeFunds, visiblePeriods, compareNullable, equityQualifies, csv };
}));
