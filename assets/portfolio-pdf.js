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

  function dailyDisplay(item) {
    if (item.kind === 'buy_score') return { label: item.label, value: finite(item.value) ? number(item.value) + ' 分' : '—',
      basis: '历史研究规则分数，不是胜率或仓位比例' };
    const allocation = item.basis === 'pair_stock_budget';
    return { label: allocation ? item.label : 'TQQQ策略状态',
      value: !finite(item.value) ? '—' : allocation ? pct(item.value) : item.value === 100 ? '持有状态' : '退出状态',
      basis: allocation ? '占USD与TQQQ股票预算' : '持有开关，不是加仓评分' };
  }
  function accountActivity(r) {
    const strategy = r.transactions.filter(t => t.reason === r.config.initialMethod);
    return { deposits: r.deposits, contributed: r.contributed, initial: r.config.initial,
      buys: strategy.filter(t => t.side === 'buy').length, sells: strategy.filter(t => t.side === 'sell').length,
      contributionBuys: r.transactions.filter(t => t.reason === 'contribution' && t.side === 'buy').length,
      days: r.systematic?.daily?.length || 0, holdDays: (r.systematic?.daily || []).filter(row => row.status === 'ready' && row.indicators?.some(i => i.kind === 'holding_state' && i.value === 100)).length };
  }
  function explainDaily(row) {
    if (!row) return [];
    const m = row.metadata || {}, out = [], n = value => finite(value) ? String(Number(value.toPrecision(8))) : '—';
    const yes = value => value ? '满足' : '不满足', state = value => value ? '持有' : '退出';
    if (row.status !== 'ready' && !(m.opportunity && ['warming-up', 'liquidated'].includes(row.status))) return [['状态不可计算', row.missing || m.reason || (row.status === 'liquidated' ? '账户已清仓，不再形成待单。' : '历史仍在预热，未形成有效状态。')]];
    if (m.opportunity) {
      const o = m.opportunity, labels = { D: '回撤折让', S: '历史相对低位', F: '恐慌水平', R: '恐慌回落' };
      out.push(['分数定义', o.formula + '；各项归一到0至1。系数是研究前固定的规则权重，三个交付选项在历史比较后选出；分数不是预测胜率。']);
      for (const leg of o.legs || []) {
        if (row.positions?.length && !row.positions.some(p => p.id === leg.id && p.weight > 0)) continue;
        const name = leg.id.replace('us:', ''), p = leg.inputs || {};
        if (!finite(leg.score)) { out.push([name + '缺项', (leg.missingReasons || []).map(r => typeof r === 'string' ? r : r.message).join('；') || '缺完整历史，不能计算分数。']); continue; }
        out.push([name + '分数代入', Object.entries(leg.weights || {}).map(([key, weight]) => n(weight) + ' × ' + n(leg.components?.[key]) + '（' + (labels[key] || key) + '）').join(' + ') + '，合计 × 100 = ' + n(leg.score) + ' 分。']);
        if (finite(p.price) && finite(p.high252)) out.push([name + '回撤折让D', '基准 ' + leg.proxyId.replace('us:', '') + '：1 − ' + n(p.price) + ' ÷ ' + n(p.high252) + ' = ' + n((1 - p.price / p.high252) * 100) + '%；再除以25%，限制在0至1。']);
        if (finite(p.stretch)) out.push([name + '相对低位S', '当前 ' + n(p.price) + ' ÷ MA252 ' + n(p.ma252) + ' = ' + n(p.stretch) + '；此前最多1260个完整比值中（' + n(p.rankGreater) + '个较高 + 0.5 × ' + n(p.rankEqual) + '个相等）÷ ' + n(p.rankCount) + ' = ' + n(leg.components.S) + '。当前值不进入历史样本。']);
        if (leg.weights?.F) out.push([name + '恐慌水平F', '已知VIX=' + n(p.vix) + '；此前最多1260个收盘中，低于它的 ' + n(p.fearBelow) + ' 个 ÷ ' + n(p.fearCount) + ' 个 = ' + n(leg.components.F) + '。来源 ' + (p.vixDay || '—') + '。']);
        if (leg.weights?.R) out.push([name + '恐慌回落R', '63次VIX峰值=' + n(p.vixPeak63) + '；限制[(' + n(p.vixPeak63) + ' − ' + n(p.vix) + ') ÷ (0.4 × ' + n(p.vixPeak63) + ')] × 限制[(' + n(p.vixPeak63) + ' − 20) ÷ 30] = ' + n(leg.components.R) + '，每个限制均为0至1。']);
        const fraction = finite(leg.intensity) ? leg.intensity : 0;
        out.push([name + '实际买入', '阈值 ' + o.threshold + ' 分；本日 ' + n(leg.score) + ' 分。' + (leg.blockedByRisk ? '风险门关闭，本日不买。' : '动用待加仓现金比例 = 限制[(' + n(leg.score) + ' − ' + o.threshold + ' + 10) ÷ ' + (110 - o.threshold) + '] = ' + n(fraction * 100) + '%（低于阈值为0）。') + '可用归属现金 ' + n(leg.availableCash) + '；计划买入 ' + n(leg.buyAmount) + ' ' + (row.currency === 'USD' ? 'USD' : '元') + '，交易费另从该现金支付。']);
      }
      out.push(['资金与时序', '首次先建基础仓，预留股票预算的' + n(o.reserve * 100) + '%；后续实际新增股票资金进入待加仓现金。只用已经存在的现金，前一共同收盘固定金额、下一共同收盘成交；连续高分不会产生额外入金。剩余尾款低于初始本金的0.01%时一并买入。低分不触发卖出。']);
      const v = m.vixDecision;
      if (v && (!row.positions?.length || row.positions.some(p => p.id === 'us:TQQQ' && p.weight > 0))) {
        out.push(['TQQQ风险门判定', 'VIX/VIX3M=' + n(m.vixValue) + ' ÷ ' + n(m.vix3mValue) + ' = ' + n(m.vixRatio) + '。' + (v.previousOn ?
          '退出计数' + (v.armedForExit ? '已启用' : '未启用') + '，R > 1.10连续 ' + n(v.exitCountTested) + '/10次；' + (v.exitTriggered ? '触发退出。' : '未触发退出。') :
          '离场观察 ' + n(v.heldTested) + '次；VIX从离场峰值回落 ' + n(v.peakDropTested * 100) + '%（至少5次且回落30%），或R < 1连续 ' + n(v.calmCountTested) + '/5次；' + (v.recoveryByPeak || v.recoveryByCalm ? '恢复买入资格。' : '继续等待。')) + '本日' + (v.on ? '允许按分数买入' : '暂停TQQQ买入') + '。']);
      }
      if (row.status === 'liquidated') out.push(['清仓账户', '本日仍显示市场分数和来源；账户已清仓，所有待单与新增预算试算均已取消。']);
    } else if (row.method === 'relative_strength_rotation') {
      const p = m.relativeInputs, shares = m.originalShares || [], leaders = m.leaders || [];
      if (p) out.push(['504日相对增长', '(' + n(p.usdEnd) + ' ÷ ' + n(p.usdStart) + ') ÷ (' + n(p.tqqqEnd) + ' ÷ ' + n(p.tqqqStart) + ') = ' + n(p.ratio) + '。价格区间 ' + p.startDay + ' 至 ' + p.endDay + '，美元复权价。']);
      out.push(['阈值与复核', '相对增长 > 1.25 转向USD，< 0.80 转向TQQQ，边界及中间保留该批原方向。' + (m.reviewedToday ? '本日已复核当月批次。' : '本日没有复核；今天的相对增长值只作观察，目标沿用已有批次记忆。')]);
      if (leaders.length === 3 && shares.length === 2) {
        for (let k = 0; k < 2; k++) {
          const parts = leaders.map(leader => leader === null ? shares[k] : leader === k ? 1 : 0);
          out.push([(k ? 'TQQQ' : 'USD') + '分配计算', '(' + parts.map(part => n(part * 100) + '%').join(' + ') + ') ÷ 3 = ' + n(parts.reduce((s, v) => s + v, 0) / 3 * 100) + '%，分母为两只ETF股票预算。']);
        }
      }
      if (Array.isArray(m.phaseReviews)) m.phaseReviews.forEach((review, i) => out.push(['第' + (i + 1) + '批记忆', review ? review.day + '复核；来源 ' + review.sourceDay + '，相对增长 ' + n(review.ratio) + '；保留方向：' + (review.leader === 0 ? 'USD' : review.leader === 1 ? 'TQQQ' : '用户原比例') : '尚未形成方向，使用用户原比例。']));
    } else {
      const v = m.vixDecision;
      out.push(['VIX比值', n(m.vixValue) + ' ÷ ' + n(m.vix3mValue) + ' = ' + n(m.vixRatio) + '；来源 ' + (m.vixDay || '—') + '。']);
      if (v) {
        if (v.previousOn) {
          out.push(['VIX退出条件', 'R > 1.10：' + yes(v.stressed) + '；退出计数' + (v.armedForExit ? '已启用' : '未启用') + '；本次连续 ' + n(v.exitCountTested) + ' / 10 次。' + (v.exitTriggered ? '达到10次，来源日状态从持有切换为退出。' : '未触发退出，沿用持有状态。')]);
          if (!v.previousArmed) out.push(['重新启用计数', 'R < 1 连续 ' + n(v.calmCountTested) + ' / 5 次；' + (v.armedForExit ? '本次已重新启用退出计数。' : '继续等待，不能重复触发退出。')]);
        } else {
          out.push(['VIX恢复条件一', '离场后观察 ' + n(v.heldTested) + ' 次（至少5次）；1 − ' + n(m.vixValue) + ' ÷ ' + n(v.peakTested) + ' = ' + n(v.peakDropTested * 100) + '%（至少30%）；两者同时满足：' + yes(v.recoveryByPeak) + '。']);
          out.push(['VIX恢复条件二', 'R < 1 连续 ' + n(v.calmCountTested) + ' / 5 次：' + yes(v.recoveryByCalm) + '。任一恢复条件满足才转回持有；来源日结果：' + state(v.on) + '。']);
        }
        if (v.lastTransitionDay) out.push(['最近VIX状态切换', v.lastTransitionDay + '（来源收盘日）；当前' + state(v.on) + '。']);
      } else out.push(['VIX完整条件', 'R > 1.10 连续10次才退出；离场至少5次且VIX从峰值下降30%，或R < 1连续5次才恢复。缺本日判定轨迹，请重新模拟。']);
      if (row.method === 'dual_risk_guard') {
        const q = m.qqqDecision;
        if (q) {
          out.push(['QQQ价格条件', 'P=' + n(q.price) + '；MA200=' + n(q.ma) + '（' + q.maFirstDay + '起200次均值）；H252=' + n(q.high) + '（' + q.highFirstDay + '起252次最高值）。']);
          out.push(['QQQ回撤', n(q.price) + ' ÷ ' + n(q.high) + ' − 1 = ' + n((q.price / q.high - 1) * 100) + '%；低于MA200：' + yes(q.belowMA) + '，回撤至少20%：' + yes(q.drawdownAtLeast20) + '。']);
          out.push(['QQQ状态判断', q.previousOn ? '两条件连续 ' + n(q.exitCountTested) + ' / 20 次；' + (q.exitTriggered ? '达到20次，转为退出。' : '未触发退出。') : 'P > MA200：' + yes(q.aboveMA) + '；连续 ' + n(q.entryCountTested) + ' / 3 次；' + (q.reentryTriggered ? '达到3次，恢复持有。' : '继续退出。')]);
        }
        out.push(['双门合并', 'VIX=' + state(m.vixOn) + '，QQQ=' + state(m.qqqOn) + '；两者均持有才允许持有TQQQ，合并结果=' + state(m.vixOn && m.qqqOn) + '。']);
      }
    }
    const orders = row.nextPlan?.orders || [];
    out.push(['账户本日行动', orders.length ? orders.map(o => o.side === 'sell' ? '下一共同收盘卖出' + (o.code || o.id.replace('us:', '')) + '的信号日持仓 ' + n(o.sellFraction * 100) + '%' : '下一共同收盘买入' + (o.code || o.id.replace('us:', '')) + ' ' + n(o.amount) + ' ' + (row.currency === 'USD' ? 'USD' : '元')).join('；') : m.opportunity ? '没有新买卖订单；逐腿核对上方分数阈值、风险门和可用现金。没有待加仓现金，即使高分也不会买入。' : '没有新调仓订单；保持状态不会每天重复买入。']);
    return out;
  }

  function snapshot(result, catalog, createdAt = new Date().toISOString(), dailySelection = null) {
    if (!result || result.error || !result.config || !result.curve?.length) throw new Error('先完成组合模拟，再导出 PDF');
    const ids = new Set([...result.config.positions.map(p => p.id), result.config.benchmarkId].filter(Boolean));
    const rows = result.systematic?.daily || [], row = rows.find(point => point.day === dailySelection?.day) || rows.at(-1);
    const budget = dailySelection?.budget ?? (result.config.monthly > 0 ? result.config.monthly : 10000);
    if (row && (!finite(budget) || budget < 0)) throw new Error('请输入有效新增预算再导出');
    const dailyIndicator = row ? { row, budget, allocation: P.additionAllocation(row, budget),
      reason: dailySelection?.reason || row.missing || row.metadata?.reason || '',
      sourceLabel: dailySelection?.sourceLabel || '', facts: dailySelection?.facts || [], calculation: explainDaily(row) } : null;
    return JSON.parse(JSON.stringify({ result, createdAt, dailyIndicator, assets: catalog.assets.filter(a => ids.has(a.id)), fx: catalog.fx }));
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
    const r = report.result, cfg = r.config, { code, name, unit } = P.currencyInfo(cfg), assets = new Map(report.assets.map(a => [a.id, a]));
    const cashPayout = cfg.dividendPolicy === 'cash', gainTax = r.holdings.some(h => h.taxRates?.gain > 0);
    const taxed = gainTax || r.holdings.some(h => h.taxRates?.dividend > 0);
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
        const items = values.slice(offset, offset + 4).map(([label, value, note, color]) => {
          const lines = wrap(ctx, label, colWidth - 28, 14), notes = note ? wrap(ctx, note, colWidth - 38, 12) : [];
          height = Math.max(height, 84 + lines.length * 20 + notes.length * 18);
          let size = 24; ctx.font = font(size, 700);
          while (ctx.measureText(value).width > colWidth - 38 && size > 10) ctx.font = font(--size, 700);
          return { lines, value, notes, size, color };
        });
        items.forEach((item, i) => {
          const x = MARGIN + i * colWidth;
          rect(x, y, colWidth - 10, height - 10, C.pale);
          item.lines.forEach((label, j) => text(label, x + 14, y + 13 + j * 20, 14, C.muted));
          text(item.value, x + 14, y + 22 + item.lines.length * 20, item.size, item.color || C.green, 700);
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
        line(plot.x, yy, plot.w); text(unit !== '%' ? number(value / 10000) + '万' : number(value) + '%', plot.x - 14, yy - 8, 12, C.muted, 400, 'right');
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
    paragraph([name, cashPayout ? '分红计入账户现金' : '分红自动再投资', cfg.feeBasis === 'net' ? '年费已含' : '扣费前估算',
      taxed ? '按所设税率计税' : '不计税', cfg.tax?.liquidate ? '期末清仓' : '期末保留持仓'].join(' · '));
    paragraph('导出时间 ' + new Date(report.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）', C.muted, 13);

    section('策略与组合');
    const benchmark = assets.get(cfg.benchmarkId);
    const strategy = P.strategyNames(cfg);
    const signalBasis = ({ vix_panic_reentry: 'Cboe VIX/VIX3M · 严格早于决策日', relative_strength_rotation: '实际USD/TQQQ美元复权价 · 三批复核',
      dual_risk_guard: 'Cboe VIX/VIX3M与实际QQQ美元复权价', qqq_bear_confirm: '实际QQQ美元复权价 · 前共同收盘',
      cash_topup: '前共同收盘的实际账户持仓及现金' })[cfg.initialMethod] || '目标组合 · 前共同交易日收盘';
    const years = typeof cfg.years === 'number' ? '近' + cfg.years + '年' : cfg.years === 'common' ? '共同历史' : '自定义区间';
    table(['设置', '参数', '设置', '参数'], [
      ['本金投入方式', cfg.initial > 0 ? strategy.initial : '无初始本金', '持续投入方式', cfg.monthly > 0 ? strategy.contribution : '不追加'],
      ['回测窗口', years, '信号依据', signalBasis],
      ['初始投入 / ' + unit, number(cfg.initial), '基础月预算 / ' + unit, number(cfg.monthly)],
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
    initialRows.push([name + '现金', pct(r.cashWeight), number(cfg.initial * r.cashWeight / 100), number(cfg.monthly * r.cashWeight / 100), '—']);
    table(['标的 / 类型', '目标权重', '初始预算 / ' + unit, '基础月预算 / ' + unit, '首次买入含费 / ' + unit], initialRows, [3.1, 1.1, 1.5, 1.5, 1.8], { numeric: [1, 2, 3, 4] });
    if (cfg.feeBasis === 'gross_estimate') paragraph('有效年费假设：' + r.holdings.map(h => h.name + ' ' + pct(h.feeRate)).join('；'));

    section('模拟概览', '资金年化 XIRR 使用实际投入日期与金额；组合收益剔除追加本金影响。');
    cards([
      ['资金年化 XIRR', pct(r.xirr), r.xirrMissing || '按实际投入时间和金额计算'], ['组合年化收益', pct(r.annualReturn), '现金流中性'], ['组合累计收益', pct(r.totalReturn), '现金流中性'], ['期末税后估值 / ' + unit, number(r.value)],
      ['累计投入 / ' + unit, number(r.contributed)], ['税后盈亏 / ' + unit, number(r.profit)], ['最大回撤', pct(r.mdd)], ['年化波动', pct(r.volatility)]
    ]);
    paragraph('入金 ' + r.deposits + '笔    再平衡 ' + r.rebalances + '次    买卖 ' + r.transactions.length + '笔    交易费合计 ' + number(r.tradeCost) + ' ' + unit + '    期末现金 ' + number(r.cash) + ' ' + unit);
    if (cashPayout) paragraph('累计税后现金分红 ' + number(r.cashDividends) + ' ' + unit + '，已计入账户。');
    if (taxed) paragraph('税费含预留 ' + number(r.taxCost) + ' ' + unit + '    已实现盈利税 ' + number(r.capitalTax) + ' ' + unit + '    分红税 ' + number(r.dividendTax) + ' ' + unit);
    paragraph('当前浮盈预留税 ' + number(r.taxReserve) + ' ' + unit + '；只扣减估值，未实际缴纳，不影响持仓数量。');
    if (r.systematic) {
      const a = accountActivity(r);
      paragraph('实际资金与交易：初始本金 ' + number(a.initial) + ' ' + unit + '；入金 ' + a.deposits + '笔，累计 ' + number(a.contributed) + ' ' + unit + '；规则调仓买入 ' + a.buys + '笔、卖出 ' + a.sells + '笔（不含初次建仓）；追加资金买入 ' + a.contributionBuys + '笔。');
      paragraph('年化收益来自实际模拟账本。持有状态不触发每日买入，新增预算试算不计入年化。', C.ink);
    }
    if (r.initialReserve > .005) paragraph('待投入本金 ' + number(r.initialReserve) + ' ' + unit + '，计入期末现金。');
    if (r.timingChanges) paragraph('200日均线择时切换 ' + r.timingChanges + '次，实际卖出税费已经计入。');
    if ((cfg.initial > 0 && cfg.initialMethod === 'ma200_hold' || cfg.monthly > 0 && ['dca_ma_trend', 'dca_ma_contrarian'].includes(cfg.contributionMethod)) && r.strategy?.insufficientMaDays) paragraph('不足200个共同交易日的均线阶段按常规投入；起始日已有 ' + r.strategy.warmupDays + '个共同交易日的历史。', C.gold);
    if (r.benchmark) paragraph('对照持有回报：年化 ' + pct(r.benchmark.annualReturn) + '，累计 ' + pct(r.benchmark.totalReturn) + '；同区间、同币种、同税率及期末设置，不计用户交易费。');
    if (r.benchmarkError) paragraph('对照数据：' + r.benchmarkError, C.negative);

    if (report.dailyIndicator) {
      const { row, budget, allocation, reason, sourceLabel, facts, calculation } = report.dailyIndicator;
      const opportunity = !!row.metadata?.opportunity;
      section(opportunity ? '每日加仓分数与订单' : '每日策略状态', strategy.initial + ' · 所选决策收盘 ' + row.day);
      cards((row.indicators || []).map(item => { const d = dailyDisplay(item); return [d.label, d.value, d.basis]; }));
      paragraph(reason || (row.status === 'liquidated' ? '该日已清仓，不生成新投入。' : '比例直接来自规则状态。'), row.status === 'missing' ? C.negative : C.ink);
      paragraph(opportunity ? '分数控制实际待加仓现金的买入比例。组合历史收益优势主要来自VIX风险退出，评分因子的独立增益尚未证实。' : '持有状态不触发每日买入；本图未衡量当日加仓是否更划算。跟踪起点 ' + (row.trackingStart || r.start) + '。');
      const source = sourceLabel || ['vixDay', 'qqqDay', 'sourceDay'].filter(key => row.metadata?.[key]).map(key => key + ' ' + row.metadata[key]).join('；');
      paragraph('实际来源收盘：' + (source || '缺源日期'));
      if (facts.length) table(['当日依据', '数值'], facts, [1, 2]);
      if (calculation?.length) table(['本日怎么算', '代入与判断'], calculation, [1, 3]);
      paragraph('按当前策略分配新增资金（试算）：' + number(budget) + ' ' + unit + '；不改变历史回测，不动用账户已有现金。', C.ink);
      if (allocation) {
        table(['预算去向', '成交金额 / ' + unit, '交易费 / ' + unit], [
          ...allocation.orders.map(order => [order.code || order.id, number(order.amount), number(order.fee)]),
          ['策略暂存现金', number(allocation.parkedCash), '—'], ['原配置现金', number(allocation.originalCash), '—'],
          ['总计（含交易费）', number(allocation.total), '已包含 ' + number(allocation.fee)]
        ], [2, 1.5, 1.5], { numeric: [1, 2] });
        if (allocation.status === 'fallback') paragraph(allocation.reason || '预热期间新增预算沿用原配置。', C.gold);
      } else paragraph(row.missing || '该日不生成预算换算。', C.gold);
      const orders = row.nextPlan?.orders || [];
      paragraph('原有账户：' + (row.status === 'liquidated' ? '该日已清仓。' : orders.length ? '以下是该日收盘已形成、下一共同收盘执行的订单。' : '该日没有新的调仓订单。'));
      if (orders.length) table(['动作', '标的', '提前确定的订单'], orders.map(order => [order.side === 'sell' ? '卖出' : '买入', assets.get(order.id)?.code || order.id,
        order.side === 'sell' ? '信号日持仓的 ' + pct(order.sellFraction * 100) : number(order.amount) + ' ' + unit]), [1, 1.5, 2.5]);
      paragraph('卖出显示信号日持仓比例，不把内部归一化复权份额当作券商股数；买单仅使用计划时已有资金。');
      paragraph('完整规则、公式与历史检验：docs/portfolio-entry-research.html#' + (opportunity ? 'opportunity' : row.method), C.green, 13);
    }

    section('区间快照', '近1/2/3/5年分别重新建仓，使用相同组合与策略；组合与对照收益均为现金流中性。');
    const windows = r.snapshots || [];
    table(['指标', ...windows.map(s => '近' + s.years + '年\n' + (s.error ? '无法模拟' : s.start + '\n' + s.end))], [
      ['资金年化 XIRR', ...windows.map(s => s.error ? '—' : s.xirrMissing || pct(s.xirr))],
      ['组合年化收益', ...windows.map(s => s.error ? '—' : pct(s.annualReturn))],
      ['组合累计收益', ...windows.map(s => s.error ? '—' : pct(s.totalReturn))],
      ['对照持有年化', ...windows.map(s => s.error ? '—' : s.benchmark ? pct(s.benchmark.annualReturn) : s.config.benchmarkId ? '缺对照数据' : '未设置')],
      ['对照持有累计', ...windows.map(s => s.error ? '—' : s.benchmark ? pct(s.benchmark.totalReturn) : s.config.benchmarkId ? '缺对照数据' : '未设置')],
      ['期末税后估值 / ' + unit, ...windows.map(s => s.error ? '—' : number(s.value))],
      ['累计投入 / ' + unit, ...windows.map(s => s.error ? '—' : number(s.contributed))],
      ['税后盈亏 / ' + unit, ...windows.map(s => s.error ? '—' : number(s.profit))],
      ['最大回撤', ...windows.map(s => s.error ? '—' : pct(s.mdd))],
      ['年化波动', ...windows.map(s => s.error ? '—' : pct(s.volatility))]
    ], [1.4, ...windows.map(() => 1)], { numeric: windows.map((s, i) => i + 1) });
    windows.forEach(s => { if (s.error) paragraph('近' + s.years + '年：' + s.error, C.negative); else if (s.benchmarkError) paragraph('近' + s.years + '年对照：' + s.benchmarkError, C.negative); });

    section('组合走势', '持仓本金只计仍持有部分的买入本金，不含现金和自动再投的分红。证券仓位按证券市值占证券市值与现金之和计算。');
    const opening = P.accountAllocation(r.curve[0]);
    if (Number.isFinite(opening.securitiesPct)) paragraph('首日收盘：证券市值 ' + number(opening.securitiesValue) + ' ' + unit + '（仓位 ' + pct(opening.securitiesPct) + '），现金 ' + number(opening.cash) + ' ' + unit + '（' + pct(opening.cashPct) + '）。');
    const comparison = r.benchmark?.curve;
    chart('累计收益 / 现金流中性', r.curve.map(p => p.totalReturn), comparison?.map(p => (p.nav - 1) * 100), r.benchmark?.name);
    chart('年化收益 / 首年按至少一年计算', r.curve.map(p => p.annualReturn), comparison?.map(p => p.day === r.start ? 0 : P.annualReturn(p.nav, r.start, p.day)), r.benchmark?.name);
    chart('税后估值与持仓本金 / ' + name, r.curve.map(p => p.value), r.curve.map(p => p.positionPrincipal), '持仓本金（不含现金）', unit);
    chart('组合回撤', r.curve.map(p => p.drawdown));

    section('持仓贡献', name + ' · 实际投入、追加、再平衡、买卖税费及浮盈预留均已计入。');
    structure(r.holdings.map(h => ({ id: h.id, weight: h.actualWeight })));
    const cashRow = r.cash > .005;
    const label = h => h.name + '\n' + h.code;
    const contributions = r.holdings.map(h => [label(h), pct(h.targetWeight), pct(h.actualWeight), number(h.value), { text: number(h.profit), color: h.profit < 0 ? C.negative : C.green }, number(h.transactionCost)]);
    if (cashRow) contributions.push([name + '现金', pct(r.cashWeight), pct(r.cash / r.value * 100), number(r.cash), '0.00', '0.00']);
    table(['标的', '目标权重', '期末权重', '税后估值 / ' + unit, '盈亏贡献 / ' + unit, '交易费 / ' + unit], contributions, [2.5, 1, 1, 1.5, 1.5, 1.3], { numeric: [1, 2, 3, 4, 5] });
    table(['标的', '已实现盈利税 / ' + unit, '分红税 / ' + unit, '浮盈预留税 / ' + unit, '税费含预留 / ' + unit], r.holdings.map(h => [label(h), number(h.capitalTax), number(h.dividendTax), number(h.taxReserve), number(h.taxCost)]), [2.5, 1.5, 1.5, 1.5, 1.5], { numeric: [1, 2, 3, 4] });
    const performance = r.holdings.map(h => { const p = h.performance; return [label(h), pct(p.annualReturn) + '\n' + (p.annualMissing || (p.annualBasis === 'money_weighted_xirr' ? 'XIRR' : '不足一年不外推')), pct(p.totalReturn), pct(p.mdd), pct(p.volatility), p.start + '\n' + p.end]; });
    if (cashRow) performance.push([name + '现金', '0.00%', '0.00%', '0.00%', '0.00%', r.start + '\n' + r.end]);
    table(['标的', '策略年化收益', '累计投入收益', '最大回撤', '年化波动', '实际持仓区间'], performance, [2.5, 1.4, 1.25, 1.2, 1.2, 1.25], { numeric: [1, 2, 3, 4] });
    paragraph('持仓年化按实际买卖、计入现金的税后分红及期末持仓估值计算 XIRR；不足一年不外推。累计投入收益的分母含重复买入资金，与组合净值收益分开。回撤、波动基于持仓过程的现金流中性净值。');

    section('年度表现', '现金流中性 · 每个实际年度窗口的累计收益，首末年可不完整。');
    table(['年度', '实际区间', '累计收益'], r.annual.map(a => [a.year, a.start + ' - ' + a.end, pct(a.return)]), [1, 3, 1.5], { numeric: [2] });

    section('数据与口径');
    if (r.catalogRefresh?.available === false) paragraph(r.catalogRefresh.missing || '未能确认最新行情，本报告使用已保存的历史数据。', C.gold);
    const sourceRows = r.holdings.map(h => {
      const a = assets.get(h.id);
      return [label(h), (h.basis === 'provider_adjusted_close' ? '含分红复权股价' : '净值及已发布每日收益') + '\n' + (h.currency === code ? name : (h.currency === 'USD' ? '美元' : '人民币') + '换算' + name) + (a?.refreshWarning ? '\n' + a.refreshWarning : ''), h.first + '\n' + h.asOf, { text: a?.sourceUrl || '缺来源链接', url: a?.sourceUrl, color: C.green }];
    });
    if (r.usesFx || r.benchmark?.usesFx) sourceRows.push(['美元兑人民币', 'CNY=X 实际日汇率', report.fx.first + '\n' + report.fx.asOf, { text: 'https://finance.yahoo.com/quote/CNY%3DX/history/', url: 'https://finance.yahoo.com/quote/CNY%3DX/history/', color: C.green }]);
    if (benchmark && !r.holdings.some(h => h.id === benchmark.id)) sourceRows.push([benchmark.name + '\n' + benchmark.code + ' · 对照', '同区间持有回报', benchmark.first + '\n' + benchmark.asOf, { text: benchmark.sourceUrl || '缺来源链接', url: benchmark.sourceUrl, color: C.green }]);
    table(['标的', '收益依据', '可用历史', '来源'], sourceRows, [2, 2, 1.4, 3]);
    paragraph('价格或净值已经包含产品持续年费；净收益模拟不重复扣费。境内 ETF 默认使用净值，不计场内溢价；资产币种与模拟币种不同时使用历史汇率。' + (cashPayout ? '分红按除息日计入现金，不模拟实际到账延迟。' : '分红按净额自动再投资。'));
    paragraph('自定义交易费从账户扣除；未含最低佣金、换汇价差及阶梯申赎费。' + (cfg.tax?.liquidate ? '期末卖出所有持仓，扣除实际卖出费及适用税款。' : gainTax ? '期末税后估值已减浮盈预留税；未扣假设卖出的交易费本身。' : '期末保留证券，不生成清仓交易。') + '现金为零息，允许碎股和任意基金份额。');
    if (taxed) paragraph('盈利税按所选币种的移动平均成本计算；美元模式未模拟人民币申报折算差异。未卖出时按max(0，市值－预计卖出费－剩余成本)×税率预留，不代表浮盈已实际纳税；真正卖出时解除相应预留，不重复扣税。买入费计入成本；仅自动再投的净分红增加成本。分红只计一次。未模拟跨笔亏损抵扣、申报延期、抵免结转或A股差别化持有期补税；ADR、REIT及特殊分配的实际税率需单项设置。');
    paragraph('本金投入与持续投入独立选择。分批按6/12/24个月等分；回撤阶梯先买25%，前收盘从窗口起点峰值跌10%/20%/30%时各买25%，36个月后释放剩余本金。待投入本金计入零息现金，不参加再平衡。');
    paragraph('持续投入以月预算为基数。季投、年投在周期首个共同交易日入金该周期预算，末期仅计窗口内月份；回撤倍数为1/1.5/2/3，顺势不高于均线买0.5份、逆势买2份。入金倍数改变实际本金。200日均线择时作用于整个已释放组合。');
    paragraph('所选本金方法信号依据：' + signalBasis + '。三种系统调仓的每日状态、计算步骤与源日期单独列示；卖出数量和买入金额提前确定，下一共同收盘执行。状态未用于评估加仓点的优劣。');
    paragraph('原回撤阶梯、原200日均线及相关持续投入使用按目标权重每日复位的参考组合，只读取前一个共同交易日收盘；参考曲线不包含投资者现金流、交易费和税。均线可用窗口前真实历史，不足200次时按常规投入。');
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
  return { snapshot, layout, paint, assemble, create, dailyDisplay, explainDaily, accountActivity };
});
