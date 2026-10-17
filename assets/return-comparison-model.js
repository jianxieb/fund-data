(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.ChanghengReturnComparisonModel = factory(root.Changheng);
})(typeof window === 'object' ? window : this, function (M) {
  'use strict';
  const dayMs = 86400000;
  function priorYear(day, years) {
    const [y, m, d] = day.split('-').map(Number);
    const end = new Date(Date.UTC(y - years, m, 0)).getUTCDate();
    return [y - years, String(m).padStart(2, '0'), String(Math.min(d, end)).padStart(2, '0')].join('-');
  }
  function validate(row, history) {
    if (!row || history?.id !== row.id || history.currency !== row.currency || history.basis !== row.basis) throw new Error((row?.name || '') + '：日线身份、币种或口径不一致');
    const s = history.series;
    if (!Array.isArray(s) || s.length < 2 || s[0][0] !== row.first || s.at(-1)[0] !== row.asOf) throw new Error(row.name + '：历史区间不一致');
    s.forEach(([d, v], i) => {
      if (!M.validDate(d) || !M.finite(v) || v <= 0 || i && d <= s[i - 1][0]) throw new Error(row.name + '：日期重复或日线无效');
    });
    return history;
  }
  function drawdown(series) {
    let peak = 0, worst = 0;
    const points = series.map(([d, v]) => { peak = Math.max(peak, v); const dd = (v / peak - 1) * 100; worst = Math.min(worst, dd); return [d, dd]; });
    return { value: worst, points };
  }
  const collections = [['all','全部标的'],['index','指数'],['us-etf','海外ETF'],['cn-etf','境内ETF'],['fund','场外基金'],['us-stock','美股'],['cn-stock','A股']];
  function describeAsset(a) {
    const text = [a.name, a.category, a.style].join(' '), stock = a.kind === 'stock';
    const product = ['etf','stock'].includes(a.kind) ? a.market + '-' + a.kind : a.kind;
    let assetClass = stock ? '股票' : /黄金|Gold|GOLD|金价/.test(text) && !/黄金股|金矿/.test(text) ? '黄金' : /REIT|房地产/.test(text) ? '房地产' : /原油|期货|QDII-商品|商品型/.test(text) && !/商品股票/.test(text) ? '商品' : /国债|国库券|债券|纯债|利率债|信用债|美债/.test(text) ? '债券' : /混合|FOF|多资产|多元/.test(text) ? '混合资产' : '股票';
    let region = a.market === 'us' ? '美国' : '中国内地';
    if (!stock) {
      if (/A股/.test(text)) region = '中国内地';
      else if (/沪港深|中美|中韩/.test(text)) region = '跨境多地区';
      else if (/全球|环球|世界/.test(text)) region = '全球';
      else if (/恒生|港股|香港/.test(text)) region = '中国香港';
      else if (/标普|纳斯达克|纳指|美国|美股|道琼斯|NASDAQ|S&P/.test(text)) region = '美国';
      else if (/日本|日经|东证/.test(text)) region = '日本';
      else if (/德国|法国|欧洲|英国|DAX|CAC|富时100/.test(text)) region = '欧洲';
      else if (/印度|东南亚|越南|巴西|沙特|新兴市场|新兴亚洲|Emerging/.test(text)) region = '新兴市场';
      else if (/QDII|亚太|亚洲/.test(text)) region = '跨境多地区';
      if (['黄金','商品'].includes(assetClass)) region = '全球';
    }
    let strategy = stock ? '公司股票' : a.kind === 'index' ? '价格指数' : /杠杆|每日[23]倍/.test(text) || a.leverage > 1 ? '每日杠杆' : /动量/.test(text) ? '动量' : /备兑|期权/.test(text) ? '期权收益' : /增强|量化/.test(text) ? '指数增强 / 量化' : /红利|股息|高息/.test(text) ? '红利' : /指数|ETF|联接|跟踪|国债|国库券/.test(text) ? '指数跟踪' : '主动管理';
    return { ...a, product, assetClass, region, strategy, direction:stock ? a.sector || '行业未分类' : a.category || '未分类' };
  }
  function filterAssets(assets, { query = '', kind = 'all', market = 'all', category = 'all', collection = 'all', assetClass = 'all', region = 'all', strategy = 'all', direction = 'all', availability = 'all', minHistory = 'all', sort = 'default' } = {}) {
    const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = assets.filter(a => (kind === 'all' || a.kind === kind) && (market === 'all' || a.market === market) && (category === 'all' || a.category === category) &&
      (collection === 'all' || a.product === collection) && (assetClass === 'all' || a.assetClass === assetClass) && (region === 'all' || a.region === region) && (strategy === 'all' || a.strategy === strategy) && (direction === 'all' || a.direction === direction) &&
      (availability === 'all' || (availability === 'available' ? a.status === 'available' : a.status !== 'available')) && (minHistory === 'all' || a.first && a.asOf && M.yearsBetween(a.first,a.asOf) >= +minHistory) &&
      q.every(s => [a.name, a.code, a.category, a.style, a.direction, a.manager, a.issuer, a.assetClass, a.region, a.strategy].join(' ').toLowerCase().includes(s)));
    if (sort === 'name') rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    if (sort === 'code') rows.sort((a,b)=>a.code.localeCompare(b.code));
    if (sort === 'history') rows.sort((a,b)=>(a.first||'9999').localeCompare(b.first||'9999'));
    if (sort === 'return1' || sort === 'return5') rows.sort((a,b)=>M.compareNullable(a.performance?.annual?.[sort==='return1'?1:5]?.value,b.performance?.annual?.[sort==='return1'?1:5]?.value,true));
    return rows;
  }
  function compare({ assets, histories, fx, currency = 'native', years = 5, start = '', end = '' }) {
    if (!assets.length) throw new Error('先选择至少一个标的');
    const fxMap = new Map(fx?.series || []);
    const gaps = [];
    const series = assets.map(a => {
      const history = validate(a, histories[a.id]);
      const convert = currency !== 'native' && currency !== a.currency;
      if (convert && !['USD', 'CNY'].includes(a.currency)) throw new Error(a.name + '：缺可核验的币种转换');
      if (convert && !fxMap.size) throw new Error('缺美元兑人民币日线');
      let missing = [];
      const points = history.series.flatMap(([d, p]) => {
        if (!convert) return [[d, p]];
        const rate = fxMap.get(d);
        if (!M.finite(rate) || rate <= 0) { missing.push(d); return []; }
        return [[d, currency === 'CNY' ? p * rate : p / rate]];
      });
      if (!points.length) throw new Error(a.name + '：没有同日汇率可用');
      return { asset: a, points, missing, map: new Map(points) };
    });
    const last = series.map(s => s.points.at(-1)[0]).sort()[0];
    const requestedEnd = end && years === 'custom' ? end : last;
    if (!M.validDate(requestedEnd)) throw new Error('请选择有效结束日期');
    const requestedStart = years === 'custom' ? start : years === 'common' ? series.map(s => s.points[0][0]).sort().at(-1) : priorYear(requestedEnd, Number(years));
    if (years === 'common' && requestedStart >= requestedEnd) throw new Error('所选标的没有共同交易日');
    if (!M.validDate(requestedStart) || requestedStart >= requestedEnd) throw new Error('开始日期必须早于结束日期');
    // Endpoints must be actual observations for every asset and the requested FX.
    const dates = series[0].points.map(p => p[0]).filter(d => d <= requestedEnd && series.every(s => s.map.has(d)));
    const opening = dates.filter(d => d <= requestedStart).at(-1) || dates.find(d => d >= requestedStart);
    const closing = dates.at(-1);
    if (!opening || !closing || opening >= closing) throw new Error('所选标的在这个区间没有足够的共同交易日');
    const common = dates.filter(d => d >= opening && d <= closing);
    if (common.length < 2) throw new Error('缺共同交易日');
    const elapsed = M.yearsBetween(opening, closing);
    const rows = series.map(s => {
      const own = s.points.filter(([d]) => d >= opening && d <= closing);
      const base = s.map.get(opening), total = (s.map.get(closing) / base - 1) * 100;
      const missingFx = s.missing.filter(d => d >= opening && d <= closing);
      const longGaps = own.slice(1).filter((p, i) => (Date.parse(p[0]) - Date.parse(own[i][0])) / dayMs > 21).map(p => p[0]);
      const riskMissing = missingFx.length ? '缺' + missingFx.length + '个交易日的同日汇率' : longGaps.length ? '历史存在超过21日的缺口' : '';
      if (riskMissing) gaps.push(s.asset.name + '：' + riskMissing + '，回撤留空');
      const dd = drawdown(own);
      const ddMap = new Map(dd.points);
      return { ...s.asset, total, annual: elapsed >= 1 - 3 / 365.2425 ? M.annualized(total, elapsed) : null,
        years: elapsed, mdd: riskMissing ? null : dd.value, riskMissing, missingFx,
        points: common.map(d => [d, (s.map.get(d) / base - 1) * 100]),
        drawdowns: riskMissing ? [] : common.map(d => [d, ddMap.get(d)]),
        observations: own.length };
    });
    const calendar = [];
    let from = opening;
    for (let y = +opening.slice(0, 4); y <= +closing.slice(0, 4); y++) {
      const to = common.filter(d => d <= y + '-12-31').at(-1);
      if (!to || to <= from) continue;
      calendar.push({ year: y, start: from, end: to, partial: from !== common.filter(d => d <= (y - 1) + '-12-31').at(-1) || to === closing && !/^12-(2[89]|3[01])$/.test(to.slice(5)),
        returns: series.map(s => (s.map.get(to) / s.map.get(from) - 1) * 100) });
      from = to;
    }
    return { start: opening, end: closing, requestedStart, requestedEnd, currency, dates: common, rows, calendar,
      shortened: opening > requestedStart, endShortened: (Date.parse(requestedEnd) - Date.parse(closing)) / dayMs > 7, gaps };
  }
  return { compare, validate, drawdown, filterAssets, priorYear, describeAsset, collections };
});
