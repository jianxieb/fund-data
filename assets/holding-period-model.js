(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio-model.js'));
  else root.ChanghengHoldingPeriodModel = factory(root.ChanghengPortfolioModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const DAY = 86400000, YEAR = 365.2425, PERIODS = [1, 2, 3, 5, 10];
  const time = day => Date.parse(day + 'T00:00:00Z');
  const days = (a, b) => (time(b) - time(a)) / DAY;
  const validDate = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(time(day)) && new Date(time(day)).toISOString().slice(0, 10) === day;
  const fail = message => { throw new Error(message); };
  const eligibleAssets = catalog => (catalog?.assets || []).filter(a => a.market === 'us' && a.currency === 'USD' && ['stock', 'etf'].includes(a.kind));
  function validateHistory(asset, history, fx = false) {
    if (!asset || (fx ? asset.id !== 'fx:CNY' || asset.code !== 'CNY=X' || asset.currency !== 'CNY' : !eligibleAssets({ assets: [asset] }).length)) fail(fx ? '缺少明确的美元兑人民币汇率身份' : '只支持已收录美股或海外ETF的自身美元历史');
    if (asset.status !== 'available') fail(asset.name + '：' + (asset.missing || '缺已发布的完整历史'));
    const rows = P.validateHistory(asset, history);
    if (history.basis !== 'provider_adjusted_close') fail(asset.name + '：复权股价口径不支持');
    if (asset.first !== history.first || asset.asOf !== history.asOf) fail(asset.name + '：目录与历史日期不一致，请刷新页面');
    if (asset.observations != null && asset.observations !== rows.length) fail(asset.name + '：目录与历史条数不一致');
    return rows;
  }
  function indexAt(rows, day, maxGap = 7) {
    let low = 0, high = rows.length - 1, result = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (rows[middle][0] <= day) { result = middle; low = middle + 1; } else high = middle - 1;
    }
    return result >= 0 && days(rows[result][0], day) <= maxGap ? result : -1;
  }
  function monthEnd(day) {
    const d = new Date(time(day));
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * p, i = Math.floor(at);
    return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (at - i);
  }
  function summarize(samples, latest = null) {
    const sorted = samples.map(s => s.annualReturn).sort((a, b) => a - b);
    if (!samples.length) return { count: 0, median: null, p10: null, p90: null, worst: null, best: null, lossCount: 0, lossShare: null, latestRank: null };
    const worst = samples.reduce((a, b) => b.annualReturn < a.annualReturn ? b : a);
    const best = samples.reduce((a, b) => b.annualReturn > a.annualReturn ? b : a);
    const lossCount = samples.filter(s => s.totalReturn < 0).length;
    const latestRank = latest ? 100 * (sorted.filter(v => v < latest.annualReturn).length + .5 * sorted.filter(v => v === latest.annualReturn).length) / sorted.length : null;
    return { count: samples.length, median: quantile(sorted, .5), p10: quantile(sorted, .1), p90: quantile(sorted, .9), worst, best, lossCount, lossShare: lossCount / samples.length * 100, latestRank };
  }
  function analyze({ asset, history, fxAsset, fxHistory, currency = 'USD', asOf }) {
    if (!['USD', 'CNY'].includes(currency)) fail('收益币种仅支持美元或人民币');
    const full = validateHistory(asset, history);
    if (asOf !== undefined && !validDate(asOf)) fail('研究截至日期无效');
    const cutoff = asOf && asOf < history.asOf ? asOf : history.asOf;
    const prices = full.filter(([d]) => d <= cutoff);
    if (prices.length < 2) fail('所选截至日之前没有足够的真实行情');
    const fx = currency === 'CNY' ? validateHistory(fxAsset, fxHistory, true).filter(([d]) => d <= cutoff) : null;
    const gapCounts = [0];
    for (let i = 1; i < prices.length; i++) gapCounts[i] = gapCounts[i - 1] + (days(prices[i - 1][0], prices[i][0]) > 14 ? 1 : 0);
    const monthIndices = [];
    prices.forEach(([day], i) => {
      if ((i === prices.length - 1 || prices[i + 1][0].slice(0, 7) !== day.slice(0, 7)) && monthEnd(day) <= cutoff) monthIndices.push(i);
    });
    function outcome(startIndex, endIndex, targetEnd, years) {
      if (startIndex < 0 || endIndex <= startIndex) return { reason: '缺少周年端点7天内的有效收盘' };
      if (gapCounts[endIndex] !== gapCounts[startIndex]) return { reason: '期间股价有超过14天的历史缺口' };
      const [start, startPrice] = prices[startIndex], [end, endPrice] = prices[endIndex];
      let startFx = null, endFx = null, fxStart = null, fxEnd = null;
      if (fx) {
        const a = indexAt(fx, start), b = indexAt(fx, end);
        if (a < 0 || b < 0) return { reason: '缺少端点7天内的美元兑人民币汇率' };
        [fxStart, startFx] = fx[a]; [fxEnd, endFx] = fx[b];
      }
      const ratio = endPrice / startPrice * (fx ? endFx / startFx : 1), actualYears = days(start, end) / YEAR;
      return { years, start, end, targetEnd, startPrice, endPrice, fxStart, fxEnd, startFx, endFx, actualYears,
        totalReturn: (ratio - 1) * 100, annualReturn: (Math.pow(ratio, 1 / actualYears) - 1) * 100, startIndex, endIndex };
    }
    const periods = PERIODS.map(years => {
      const samples = [], excluded = {}, skip = reason => { excluded[reason] = (excluded[reason] || 0) + 1; };
      for (const i of monthIndices) {
        const start = prices[i][0], target = P.addYears(start, years);
        if (target > cutoff) continue;
        if (days(start, monthEnd(start)) > 7) { skip('买入月份缺少月末7天内的收盘'); continue; }
        const row = outcome(i, indexAt(prices, target), target, years);
        if (row.reason) skip(row.reason); else samples.push(row);
      }
      const endIndex = prices.length - 1, lastDay = prices[endIndex][0], targetStart = P.addYears(lastDay, -years);
      let latest = outcome(indexAt(prices, targetStart), endIndex, lastDay, years);
      if (latest.reason && prices[0][0] > targetStart) latest = { reason: '自身行情不足' + years + '年' };
      return { years, samples, excluded, latest: latest.reason ? null : latest, latestMissing: latest.reason || null,
        ...summarize(samples, latest.reason ? null : latest) };
    });
    return { asset, currency, asOf: prices.at(-1)[0], requestedAsOf: cutoff, first: prices[0][0], prices, fx, periods,
      priceSource: history.sourceUrl || asset.sourceUrl, fxSource: fxHistory?.sourceUrl || null,
      basis: 'provider_adjusted_close', dividends: 'reinvested' };
  }
  function windowPath(study, sample) {
    const base = sample.startPrice * (study.currency === 'CNY' ? sample.startFx : 1);
    return study.prices.slice(sample.startIndex, sample.endIndex + 1).map(([day, price]) => {
      const i = study.fx ? indexAt(study.fx, day) : null;
      return [day, study.fx && i < 0 ? null : price * (study.fx ? study.fx[i][1] : 1) / base * 100];
    });
  }
  function toCSV(study, years) {
    const period = study.periods.find(p => p.years === years);
    if (!period) fail('持有期限无效');
    const rows = [['标的代码', '标的名称', '资产类别', '币种', '持有年数', '买入收盘日', '周年目标日', '卖出收盘日', '实际持有年数', '买入复权价', '卖出复权价', '起日汇率日期', '终日汇率日期', '起日USD/CNY', '终日USD/CNY', '累计收益%', '实际天数年化收益%', '研究截至', '回报口径', '分红', '个人税费', '样本性质', '股价来源', '汇率来源', '当前策略起日', '策略历史说明', '策略变更来源']];
    for (const s of period.samples) rows.push([study.asset.code, study.asset.name, study.asset.kind, study.currency, years, s.start, s.targetEnd, s.end, s.actualYears,
      s.startPrice, s.endPrice, s.fxStart, s.fxEnd, s.startFx, s.endFx, s.totalReturn, s.annualReturn, study.asOf, study.basis, '再投资', '未扣', '重叠的历史月末窗口', study.priceSource, study.currency === 'CNY' ? study.fxSource : '', study.asset.currentIndexSince, study.asset.historyNote, study.asset.historySourceUrl]);
    return '\ufeff' + rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  }
  return { PERIODS, eligibleAssets, validateHistory, indexAt, monthEnd, quantile, summarize, analyze, windowPath, toCSV };
});
