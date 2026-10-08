(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio-model.js'));
  else root.ChanghengPortfolioPdf = factory(root.ChanghengPortfolioModel);
})(typeof window !== 'undefined' ? window : this, function (P) {
  'use strict';
  const WIDTH = 1120, MARGIN = 48, BAND = 1280, SCALE = 2;
  const C = { ink: '#24362c', green: '#35654a', muted: '#748074', line: '#e0e6dc', pale: '#f3f5ef', gold: '#a18b63', negative: '#b45f4f', lime: '#dbe6a8' };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const number = n => finite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const pct = n => finite(n) ? number(n) + '%' : '—';
  const settingPct = n => finite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 12 }) + '%' : '—';
  const kindName = { stock: '个股', fund: '基金', etf: 'ETF' };
  const rebalanceName = { none: '不再平衡', month: '每月', quarter: '每季度', year: '每年' };
  const font = (size, weight = 400) => weight + ' ' + size + 'px Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  const sourceUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };

  function snapshot(result, catalog, createdAt = new Date().toISOString()) {
    if (!result || result.error || !result.config || !result.curve?.length) throw new Error('先完成组合模拟，再导出 PDF');
    const ids = new Set([...result.config.positions.map(p => p.id), result.config.benchmarkId].filter(Boolean));
    return JSON.parse(JSON.stringify({ result, createdAt, assets: catalog.assets.filter(a => ids.has(a.id)), fx: catalog.fx }));
  }
  function wrap(ctx, value, width, size = 15, weight = 400) {
    ctx.font = font(size, weight);
    const lines = [];
    for (const paragraph of String(value ?? '').split('\n')) {
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  }
  function layout(report, ctx) {
    const r = report.result, cfg = r.config, assets = new Map(report.assets.map(a => [a.id, a]));
    const ops = [], links = [], width = WIDTH - MARGIN * 2;
    let y = 46, sectionNumber = 0;
    const rect = (x, top, w, h, color) => ops.push({ type: 'rect', x, y: top, w, h, color });
    const line = (x, top, w, color = C.line) => ops.push({ type: 'line', x, y: top, w, h: 1, color });
    const text = (value, x, top, size = 15, color = C.ink, weight = 400, align = 'left') => ops.push({ type: 'text', value: String(value), x, y: top, h: size * 1.6, size, color, weight, align });
    function paragraph(value, color = C.muted, size = 15) {
      const lines = wrap(ctx, value, width, size);
      lines.forEach((s, i) => text(s, MARGIN, y + i * (size + 8), size, color));
      y += lines.length * (size + 8) + 8;
    }
    function section(title, subtitle = '') {
      y += 28; line(MARGIN, y, width); y += 26;
      text(String(++sectionNumber).padStart(2, '0'), MARGIN, y, 16, C.green, 700);
      text(title, MARGIN + 40, y - 3, 23, C.ink, 700); y += 40;
      if (subtitle) paragraph(subtitle);
    }
    function table(headers, rows, proportions, options = {}) {
      const widths = proportions.map(n => n / proportions.reduce((a, b) => a + b, 0) * width);
      function row(cells, header, index) {
        const size = header ? 14 : 15, leading = size + 7;
        const values = cells.map(v => typeof v === 'object' && v !== null ? v : { text: v });
        const sizes = values.map((v, i) => {
          let fitted = size;
          if (!header && options.numeric?.includes(i) && /^-?[\d,.]+%?$/.test(String(v.text))) {
            ctx.font = font(fitted);
            while (ctx.measureText(String(v.text)).width > widths[i] - 24 && fitted > 10) ctx.font = font(--fitted);
          }
          return fitted;
        });
        const lines = values.map((v, i) => wrap(ctx, v.text, widths[i] - 24, sizes[i], header ? 700 : 400));
        const height = Math.max(46, Math.max(...lines.map(s => s.length)) * leading + 20);
        if (header || index % 2 === 1) rect(MARGIN, y, width, height, header ? C.pale : '#fafbf8');
        let x = MARGIN;
        lines.forEach((ls, i) => {
          const align = !header && options.numeric?.includes(i) ? 'right' : 'left';
          ls.forEach((s, n) => text(s, align === 'right' ? x + widths[i] - 12 : x + 12, y + 10 + n * leading, sizes[i], values[i].color || C.ink, header ? 700 : 400, align));
          const url = sourceUrl(values[i].url);
          if (url) links.push({ url, x: x + 8, y: y + 6, w: widths[i] - 16, h: height - 12 });
          x += widths[i];
        });
        y += height; line(MARGIN, y, width);
      }
      row(headers, true, 0); rows.forEach((cells, i) => row(cells, false, i)); y += 14;
    }
    function cards(values) {
      const colWidth = width / 4;
      for (let offset = 0; offset < values.length; offset += 4) {
        let height = 104;
        const items = values.slice(offset, offset + 4).map(([label, value, note]) => {
          const lines = wrap(ctx, label, colWidth - 28, 14), notes = note ? wrap(ctx, note, colWidth - 38, 12) : [];
          height = Math.max(height, 84 + lines.length * 20 + notes.length * 18);
          let size = 24; ctx.font = font(size, 700);
          while (ctx.measureText(value).width > colWidth - 38 && size > 10) ctx.font = font(--size, 700);
          return { lines, value, notes, size };
        });
        items.forEach((item, i) => {
          const x = MARGIN + i * colWidth;
          rect(x, y, colWidth - 10, height - 10, C.pale);
          item.lines.forEach((label, j) => text(label, x + 14, y + 13 + j * 20, 14, C.muted));
          text(item.value, x + 14, y + 22 + item.lines.length * 20, item.size, C.green, 700);
          item.notes.forEach((note, j) => text(note, x + 14, y + 60 + item.lines.length * 20 + j * 18, 12, C.muted));
        });
        y += height;
      }
      y += 4;
    }
    function structure(positions) {
      const a = P.allocation(positions, report.assets);
      paragraph(['ETF ' + pct(a.etf), '个股 ' + pct(a.stock), '基金 ' + pct(a.fund), '现金 ' + pct(a.cash)].join('    '), C.ink);
      paragraph('其中杠杆 ETF：2x ' + pct(a.x2) + '    3x ' + pct(a.x3));
    }
    function chart(title, primary, secondary, secondaryName, unit = '%') {
      text(title, MARGIN, y, 19, C.ink, 700); y += 30;
      text('● 我的组合', MARGIN, y, 14, C.green);
      if (secondary) {
        const legends = wrap(ctx, '● ' + secondaryName, width - 160, 14);
        legends.forEach((s, i) => text(s, MARGIN + 150, y + i * 22, 14, C.gold));
        y += (legends.length - 1) * 22;
      }
      y += 30;
      const plot = { x: MARGIN + 90, y, w: width - 108, h: 256 };
      const all = [0, ...primary, ...(secondary || [])].filter(finite);
      const min = all.reduce((v, n) => Math.min(v, n), 0), max = all.reduce((v, n) => Math.max(v, n), 0), span = max - min || 1, lo = min - span * .08, hi = max + span * .08;
      const first = Date.parse(r.curve[0].day), last = Date.parse(r.curve.at(-1).day);
      const point = (value, i) => [plot.x + (Date.parse(r.curve[i].day) - first) / Math.max(1, last - first) * plot.w, plot.y + (hi - value) / (hi - lo) * plot.h];
      for (let i = 0; i < 5; i++) {
        const value = hi - (hi - lo) * i / 4, yy = plot.y + plot.h * i / 4;
        line(plot.x, yy, plot.w); text(unit === '元' ? number(value / 10000) + '万' : number(value) + '%', plot.x - 14, yy - 8, 12, C.muted, 400, 'right');
      }
      for (const [values, color, dash] of [[primary, C.green, false], [secondary, C.gold, true]]) {
        if (values) ops.push({ type: 'path', points: values.map(point), y: plot.y - 2, h: plot.h + 4, color, dash });
      }
      const days = [r.curve[0].day, r.curve[Math.floor((r.curve.length - 1) / 2)].day, r.curve.at(-1).day];
      days.forEach((day, i) => text(day, plot.x + (Date.parse(day) - first) / Math.max(1, last - first) * plot.w, plot.y + plot.h + 12, 12, C.muted, 400, i === 0 ? 'left' : i === 2 ? 'right' : 'center'));
      y += plot.h + 66;
    }
    rect(MARGIN, y, 44, 44, C.lime); text('衡', MARGIN + 22, y + 8, 25, C.ink, 700, 'center');
    text('长衡', MARGIN + 60, y + 6, 28, C.ink, 700); text('PORTFOLIO RESEARCH', WIDTH - MARGIN, y + 16, 12, C.muted, 600, 'right');
    y += 76; text('组合模拟报告', MARGIN, y, 36, C.ink, 700); y += 56;
    text(r.start + ' - ' + r.end, MARGIN, y, 20, C.green, 600); y += 36;
    paragraph('人民币 · 分红再投 · ' + (cfg.feeBasis === 'net' ? '年费已含' : '扣费前估算') + ' · 已计模拟税费 · ' + (cfg.tax?.liquidate ? '期末清仓' : '期末持仓估值'));
    paragraph('导出时间 ' + new Date(report.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）', C.muted, 13);

    section('策略与组合');
    const benchmark = assets.get(cfg.benchmarkId);
    const strategy = P.strategyNames(cfg);
    const years = typeof cfg.years === 'number' ? '近' + cfg.years + '年' : cfg.years === 'common' ? '共同历史' : '自定义区间';
    table(['设置', '参数', '设置', '参数'], [
      ['本金投入方式', cfg.initial > 0 ? strategy.initial : '无初始本金', '持续投入方式', cfg.monthly > 0 ? strategy.contribution : '不追加'],
      ['回测窗口', years, '信号依据', '目标组合 · 前共同交易日收盘'],
      ['初始投入 / 元', number(cfg.initial), '基础月预算 / 元', number(cfg.monthly)],
      ['再平衡', rebalanceName[cfg.rebalance], '买卖交易费率', settingPct(cfg.transactionFee)],
      ['指定区间', r.requestedStart + ' - ' + r.requestedEnd, '实际模拟区间', r.start + ' - ' + r.end],
      ['对照标的', benchmark ? benchmark.name + ' · ' + benchmark.code : '不设置', '持续年费', cfg.feeBasis === 'net' ? '使用已扣年费的真实历史' : '扣费前估算，按有效费率加回']
    ], [1, 2, 1, 2]);
    const tax = P.taxConfig(cfg.tax);
    table(['类别', '卖出盈利税率', '分红综合税率'], [
      ['美股', settingPct(tax.usCapitalGains), settingPct(tax.usDividend)],
      ['A股', settingPct(tax.cnStockCapitalGains), settingPct(tax.cnStockDividend)],
      ['境内基金 / ETF', settingPct(tax.cnFundCapitalGains), settingPct(tax.cnFundDividend)],
      ...Object.keys(tax.overrides).map(id => { const a = assets.get(id), rates = a && P.taxRates(a, tax); return [(a?.name || id) + ' · 单项设置', settingPct(rates?.gain), settingPct(rates?.dividend)]; })
    ], [2, 1, 1]);
    structure(cfg.positions);
    const firstTrades = new Map();
    r.transactions.filter(t => t.side === 'buy').forEach(t => {
      const first = firstTrades.get(t.id);
      if (!first) firstTrades.set(t.id, { day: t.day, amount: t.amount + t.fee });
      else if (first.day === t.day) first.amount += t.amount + t.fee;
    });
    const initialRows = cfg.positions.map(p => {
      const a = assets.get(p.id);
      return [(a?.name || p.id) + '\n' + (a?.code || p.id) + ' · ' + (kindName[a?.kind] || '未识别类型') + (a?.leverage > 1 ? ' · ' + a.leverage + 'x' : '') + (a?.currency === 'USD' ? ' · 美元资产' : ''), settingPct(p.weight), number(cfg.initial * p.weight / 100), number(cfg.monthly * p.weight / 100), firstTrades.has(p.id) ? number(firstTrades.get(p.id).amount) + '\n' + firstTrades.get(p.id).day : '0.00（未投入）'];
    });
    initialRows.push(['人民币现金', pct(r.cashWeight), number(cfg.initial * r.cashWeight / 100), number(cfg.monthly * r.cashWeight / 100), '—']);
    table(['标的 / 类型', '目标权重', '初始预算 / 元', '基础月预算 / 元', '首次买入含费 / 元'], initialRows, [3.1, 1.1, 1.5, 1.5, 1.8], { numeric: [1, 2, 3, 4] });
    if (cfg.feeBasis === 'gross_estimate') paragraph('有效年费假设：' + r.holdings.map(h => h.name + ' ' + pct(h.feeRate)).join('；'));

    section('模拟概览', '组合收益基于现金流中性净值；新增本金不会被计为收益。');
    cards([
      ['组合年化收益', pct(r.annualReturn)], ['组合累计收益', pct(r.totalReturn)], ['期末资产 / 元', number(r.value)], ['累计投入 / 元', number(r.contributed)],
      ['账面盈亏 / 元', number(r.profit)], ['最大回撤', pct(r.mdd)], ['年化波动', pct(r.volatility)], ['资金年化 / XIRR', pct(r.xirr), r.xirr === null ? (Date.parse(r.end) - Date.parse(r.start)) / 86400000 < 365.2425 ? '不足一年不外推' : '缺可用年化解' : '按实际投入日期与金额']
    ]);
    paragraph('入金 ' + r.deposits + '笔    再平衡 ' + r.rebalances + '次    买卖 ' + r.transactions.length + '笔    交易费合计 ' + number(r.tradeCost) + '元    期末现金 ' + number(r.cash) + '元');
    paragraph('投资者税合计 ' + number(r.taxCost) + '元    卖出盈利税 ' + number(r.capitalTax) + '元    分红税 ' + number(r.dividendTax) + '元');
    if (r.initialReserve > .005) paragraph('待投入本金 ' + number(r.initialReserve) + '元，计入期末现金。');
    if (r.timingChanges) paragraph('200日均线择时切换 ' + r.timingChanges + '次，实际卖出税费已经计入。');
    if ((cfg.initial > 0 && cfg.initialMethod === 'ma200_hold' || cfg.monthly > 0 && ['dca_ma_trend', 'dca_ma_contrarian'].includes(cfg.contributionMethod)) && r.strategy?.insufficientMaDays) paragraph('不足200个共同交易日的均线阶段按常规投入；起始日已有 ' + r.strategy.warmupDays + '个共同交易日的历史。', C.gold);
    if (r.benchmark) paragraph('对照持有回报：年化 ' + pct(r.benchmark.annualReturn) + '，累计 ' + pct(r.benchmark.totalReturn) + '；同区间、同币种、同税率及期末设置，不计用户交易费。');
    if (r.benchmarkError) paragraph('对照数据：' + r.benchmarkError, C.negative);

    section('区间快照', '近1/2/3/5年分别重新建仓，使用相同组合与策略。');
    const windows = r.snapshots || [];
    table(['指标', ...windows.map(s => '近' + s.years + '年\n' + (s.error ? '历史未覆盖' : s.start + '\n' + s.end))], [
      ['组合年化收益', ...windows.map(s => s.error ? '—' : pct(s.annualReturn))],
      ['组合累计收益', ...windows.map(s => s.error ? '—' : pct(s.totalReturn))],
      ['对照年化收益', ...windows.map(s => s.error || !s.benchmark ? '无覆盖' : pct(s.benchmark.annualReturn))],
      ['对照累计收益', ...windows.map(s => s.error || !s.benchmark ? '无覆盖' : pct(s.benchmark.totalReturn))],
      ['期末资产 / 元', ...windows.map(s => s.error ? '—' : number(s.value))],
      ['累计投入 / 元', ...windows.map(s => s.error ? '—' : number(s.contributed))],
      ['账面盈亏 / 元', ...windows.map(s => s.error ? '—' : number(s.profit))],
      ['最大回撤', ...windows.map(s => s.error ? '—' : pct(s.mdd))],
      ['年化波动', ...windows.map(s => s.error ? '—' : pct(s.volatility))]
    ], [1.4, ...windows.map(() => 1)], { numeric: windows.map((s, i) => i + 1) });
    windows.forEach(s => { if (s.error) paragraph('近' + s.years + '年：' + s.error, C.negative); else if (s.benchmarkError) paragraph('近' + s.years + '年对照：' + s.benchmarkError, C.negative); });

    section('组合走势', '收益率消除外部本金影响；账户资产同时显示累计投入。');
    const comparison = r.benchmark?.curve;
    chart('累计收益 / 现金流中性', r.curve.map(p => p.totalReturn), comparison?.map(p => (p.nav - 1) * 100), r.benchmark?.name);
    chart('年化收益 / 首年按至少一年计算', r.curve.map(p => p.annualReturn), comparison?.map(p => p.day === r.start ? 0 : P.annualReturn(p.nav, r.start, p.day)), r.benchmark?.name);
    chart('账户资产与累计投入 / 人民币', r.curve.map(p => p.value), r.curve.map(p => p.contributed), '累计投入', '元');
    chart('组合回撤', r.curve.map(p => p.drawdown));

    section('持仓贡献', '人民币 · 实际投入、追加、再平衡与买卖税费均已计入。');
    structure(r.holdings.map(h => ({ id: h.id, weight: h.actualWeight })));
    const cashRow = r.cash > .005;
    const label = h => h.name + '\n' + h.code;
    const contributions = r.holdings.map(h => [label(h), pct(h.targetWeight), pct(h.actualWeight), number(h.value), { text: number(h.profit), color: h.profit < 0 ? C.negative : C.green }, number(h.transactionCost)]);
    if (cashRow) contributions.push(['人民币现金', pct(r.cashWeight), pct(r.cash / r.value * 100), number(r.cash), '0.00', '0.00']);
    table(['标的', '目标权重', '期末权重', '期末市值 / 元', '盈亏贡献 / 元', '交易费 / 元'], contributions, [2.5, 1, 1, 1.5, 1.5, 1.3], { numeric: [1, 2, 3, 4, 5] });
    table(['标的', '卖出盈利税 / 元', '分红税 / 元', '税费合计 / 元'], r.holdings.map(h => [label(h), number(h.capitalTax), number(h.dividendTax), number(h.taxCost)]), [2.5, 1.5, 1.5, 1.5], { numeric: [1, 2, 3] });
    const performance = r.holdings.map(h => { const p = h.performance; return [label(h), pct(p.annualReturn) + '\n' + (p.annualMissing || (p.annualBasis === 'money_weighted_xirr' ? 'XIRR' : '不足一年不外推')), pct(p.totalReturn), pct(p.mdd), pct(p.volatility), p.start + '\n' + p.end]; });
    if (cashRow) performance.push(['人民币现金', '0.00%', '0.00%', '0.00%', '0.00%', r.start + '\n' + r.end]);
    table(['标的', '策略年化收益', '累计投入收益', '最大回撤', '年化波动', '实际持仓区间'], performance, [2.5, 1.4, 1.25, 1.2, 1.2, 1.25], { numeric: [1, 2, 3, 4] });
    paragraph('持仓年化使用实际买卖资金流的 XIRR；不足一年不外推。累计投入收益的分母含重复买入资金，与组合净值收益分开。回撤、波动基于持仓过程的现金流中性净值。');

    section('年度表现', '现金流中性 · 每个实际年度窗口的累计收益，首末年可不完整。');
    table(['年度', '实际区间', '累计收益'], r.annual.map(a => [a.year, a.start + ' - ' + a.end, pct(a.return)]), [1, 3, 1.5], { numeric: [2] });

    section('数据与口径');
    const sourceRows = r.holdings.map(h => {
      const a = assets.get(h.id);
      return [label(h), (h.basis === 'provider_adjusted_close' ? '含分红复权股价' : '净值及已发布每日收益') + '\n' + (h.currency === 'USD' ? '美元换算人民币' : '人民币') + (a?.refreshWarning ? '\n' + a.refreshWarning : ''), h.first + '\n' + h.asOf, { text: a?.sourceUrl || '缺来源链接', url: a?.sourceUrl, color: C.green }];
    });
    if (r.holdings.some(h => h.currency === 'USD') || r.benchmark && benchmark?.currency === 'USD') sourceRows.push(['美元兑人民币', 'CNY=X 实际日汇率', report.fx.first + '\n' + report.fx.asOf, { text: 'https://finance.yahoo.com/quote/CNY%3DX/history/', url: 'https://finance.yahoo.com/quote/CNY%3DX/history/', color: C.green }]);
    if (benchmark && !r.holdings.some(h => h.id === benchmark.id)) sourceRows.push([benchmark.name + '\n' + benchmark.code + ' · 对照', '同区间持有回报', benchmark.first + '\n' + benchmark.asOf, { text: benchmark.sourceUrl || '缺来源链接', url: benchmark.sourceUrl, color: C.green }]);
    table(['标的', '收益依据', '可用历史', '来源'], sourceRows, [2, 2, 1.4, 3]);
    paragraph('价格或净值已经包含产品持续年费；净收益模拟不重复扣费。分红再投资，境内 ETF 默认使用净值，不计场内溢价；海外资产使用历史汇率。');
    paragraph('自定义交易费从账户扣除；未含最低佣金、换汇价差及阶梯申赎费。' + (cfg.tax?.liquidate ? '期末卖出所有持仓，并扣除清仓交易费与正收益税。' : '期末为持仓估值，浮盈未征税。') + '现金为零息，允许碎股和任意基金份额。');
    paragraph('卖出税按人民币移动平均成本逐次预留；买入费和税后分红再投入进入成本。分红仅扣设定综合税额，不重复记收益。未模拟跨笔亏损抵扣、申报延期、抵免结转或A股差别化持有期补税；ADR、REIT及特殊分配的实际税率需单项设置。');
    paragraph('本金投入与持续投入独立选择。分批按6/12/24个月等分；回撤阶梯先买25%，前收盘从窗口起点峰值跌10%/20%/30%时各买25%，36个月后释放剩余本金。待投入本金计入零息现金，不参加再平衡。');
    paragraph('持续投入以月预算为基数。季投、年投在周期首个共同交易日入金该周期预算，末期仅计窗口内月份；回撤倍数为1/1.5/2/3，顺势不高于均线买0.5份、逆势买2份。入金倍数改变实际本金。200日均线择时作用于整个已释放组合。');
    paragraph('信号使用独立、按目标权重每日复位的人民币参考组合，只读取前一个共同交易日收盘；参考曲线不包含投资者现金流、交易费和税。均线可用窗口前真实历史，不足200次时按常规投入。');
    paragraph('指定开始日前取最近共同实际交易日。休市沿用价格 ' + r.carriedPrices + '次、汇率 ' + r.carriedFx + '日；价格最多沿用14日、汇率7日。追加与再平衡在共同实际交易日执行。');
    if (r.holdings.some(h => h.leveraged)) paragraph('每日杠杆 ETF 的长期表现取决于价格路径，不能按固定倍数外推长期回报。', C.negative);
    y += 20; line(MARGIN, y, width); y += 22;
    text('长衡 · 组合模拟', MARGIN, y, 13, C.muted); text('组合、策略与结果来自同一次模拟', WIDTH - MARGIN, y, 13, C.muted, 400, 'right');
    return { width: WIDTH, height: Math.ceil(y + 52), ops, links };
  }
  function paint(ctx, document, top, height) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, document.width, height);
    ctx.save(); ctx.translate(0, -top);
    for (const op of document.ops) {
      if (op.y + op.h < top || op.y > top + height) continue;
      ctx.fillStyle = op.color; ctx.strokeStyle = op.color;
      if (op.type === 'rect') ctx.fillRect(op.x, op.y, op.w, op.h);
      else if (op.type === 'line') { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(op.x, op.y); ctx.lineTo(op.x + op.w, op.y); ctx.stroke(); }
      else if (op.type === 'text') { ctx.font = font(op.size, op.weight); ctx.textBaseline = 'top'; ctx.textAlign = op.align; ctx.fillText(op.value, op.x, op.y); }
      else if (op.type === 'path') {
        ctx.save(); ctx.lineWidth = 2.6; ctx.setLineDash(op.dash ? [7, 5] : []); ctx.beginPath();
        op.points.forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.restore();
      }
    }
    ctx.restore();
  }
  const encode = s => new TextEncoder().encode(s);
  const hexText = s => '<feff' + Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join('') + '>';
  const pdfNumber = n => Number(n.toFixed(6)).toString();
  // A single PDF page contains adjacent RGB JPEG bands. Banding avoids the
  // browser's maximum canvas height without cropping or paginating the report.
  // PDF 1.6 UserUnit preserves very long physical pages within 14,400 user units.
  function assemble(document, bands, title = '长衡组合模拟报告') {
    const scale = 720 / document.width, physicalHeight = document.height * scale, userUnit = Math.max(1, Math.ceil(physicalHeight / 14400));
    const unit = scale / userUnit, pageWidth = document.width * unit, pageHeight = document.height * unit;
    const commands = bands.map((b, i) => 'q ' + pdfNumber(pageWidth) + ' 0 0 ' + pdfNumber(b.logicalHeight * unit) + ' 0 ' + pdfNumber((document.height - b.top - b.logicalHeight) * unit) + ' cm /B' + i + ' Do Q\n').join('');
    const imageIds = bands.map((b, i) => 6 + i), linkBase = 6 + bands.length;
    const chunks = [encode('%PDF-1.6\n'), Uint8Array.from([37, 226, 227, 207, 211, 10])], offsets = [0];
    let length = chunks.reduce((s, b) => s + b.length, 0);
    const append = bytes => { chunks.push(bytes); length += bytes.length; };
    function object(id, text, bytes) {
      offsets[id] = length; append(encode(id + ' 0 obj\n' + text));
      if (bytes) { append(encode('\nstream\n')); append(bytes); append(encode('\nendstream')); }
      append(encode('\nendobj\n'));
    }
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pdfNumber(pageWidth) + ' ' + pdfNumber(pageHeight) + '] /UserUnit ' + userUnit + ' /Resources << /XObject << ' + imageIds.map((id, i) => '/B' + i + ' ' + id + ' 0 R').join(' ') + ' >> >> /Contents 4 0 R /Annots [' + document.links.map((l, i) => (linkBase + i) + ' 0 R').join(' ') + '] >>');
    object(4, '<< /Length ' + encode(commands).length + ' >>', encode(commands));
    object(5, '<< /Title ' + hexText(title) + ' /Creator (Changheng Portfolio Simulator) /Producer (Changheng) >>');
    bands.forEach((b, i) => object(imageIds[i], '<< /Type /XObject /Subtype /Image /Width ' + b.width + ' /Height ' + b.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + b.bytes.length + ' >>', b.bytes));
    document.links.forEach((l, i) => {
      const url = new URL(l.url).href.replace(/[\\()]/g, '\\$&');
      const box = [l.x * unit, (document.height - l.y - l.h) * unit, (l.x + l.w) * unit, (document.height - l.y) * unit].map(pdfNumber).join(' ');
      object(linkBase + i, '<< /Type /Annot /Subtype /Link /Rect [' + box + '] /Border [0 0 0] /A << /S /URI /URI (' + url + ') >> >>');
    });
    const xref = length, count = offsets.length;
    append(encode('xref\n0 ' + count + '\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    const result = new Uint8Array(length); let offset = 0;
    chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length; });
    return result;
  }
  async function create(report) {
    await document.fonts?.ready;
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法绘制 PDF，请换一个浏览器重试');
    const content = layout(report, ctx), bands = [];
    canvas.width = WIDTH * SCALE;
    for (let top = 0; top < content.height; top += BAND) {
      const height = Math.min(BAND, content.height - top);
      canvas.height = height * SCALE; ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); paint(ctx, content, top, height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PDF 图表绘制失败，请重试')), 'image/jpeg', .96));
      bands.push({ top, logicalHeight: height, width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    canvas.width = canvas.height = 0;
    return new Blob([assemble(content, bands)], { type: 'application/pdf' });
  }
  return { snapshot, layout, paint, assemble, create };
});
