(function () {
  'use strict';
  const M = window.Changheng, P = window.ChanghengPortfolioModel;
  const colors = ['#35654a', '#a16738', '#627aab', '#936485', '#378d89', '#9b8637', '#a4555c', '#687c46', '#517b91', '#88766a'];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const successful = comparison => (comparison?.strategies || []).filter(item => item.result && !item.result.error && item.result.curve?.length);
  function dates(comparison) {
    const items = successful(comparison);
    if (!items.length) return [];
    const sets = items.slice(1).map(item => new Set(item.result.curve.map(point => point.day)));
    return items[0].result.curve.map(point => point.day).filter(day => sets.every(set => set.has(day)));
  }
  function selectedDay(comparison, day) {
    const days = dates(comparison);
    return day ? days.filter(value => value <= day).at(-1) || days[0] || '' : days.at(-1) || '';
  }
  function amount(value, H, digits = 0) {
    return finite(value) ? H.money(value, value !== 0 && Math.abs(value) < 1 ? 2 : digits) : '—';
  }
  function percent(value, H) { return finite(value) ? H.pct(Math.abs(value) < .005 ? 0 : value, 2, false) : '—'; }
  function signedAmount(value, H) { return finite(value) ? (value > .005 ? '+' : '') + amount(Math.abs(value) < .005 ? 0 : value, H) : '—'; }
  function returnBasis(comparison, annual) {
    if (!annual) return '累计收益';
    if (!comparison.start || !comparison.end) return '年化收益';
    return comparison.end >= P.addYears(comparison.start, 1) ? '年化收益' : '区间收益';
  }
  function returnValue(result, annual) {
    return annual && result.end >= P.addYears(result.start, 1) ? result.annualReturn : result.totalReturn;
  }
  function colorFor(index) { return colors[index % colors.length]; }
  function action(H, label, name, classes, extra = '') { return H.action(label, 'portfolio-compare-' + name, classes || 'btn', extra); }
  function strategyName(item, index, H) {
    return '<span class="portfolio-compare-name"><i style="background:' + colorFor(index) + '"></i><strong>' + H.esc(item.label) + '</strong></span>';
  }
  function performanceTable(comparison, H) {
    const { unit } = P.currencyInfo(comparison.config);
    const rows = comparison.strategies.map((item, index) => {
      const r = item.result;
      if (!r || r.error) return '<tr class="portfolio-compare-unavailable"><th scope="row">' + strategyName(item, index, H) + '</th><td colspan="5"><span class="portfolio-compare-failure">' + H.esc(item.error || r?.error || '未取得本策略结果') + '</span></td></tr>';
      const value = returnValue(r, H.annual), gainClass = value < 0 ? 'negative' : 'positive', profitClass = r.profit < 0 ? 'negative' : 'positive';
      return '<tr><th scope="row">' + strategyName(item, index, H) + (r.start !== comparison.start || r.end !== comparison.end ? '<span class="portfolio-compare-period">' + H.esc(r.start) + ' 至 ' + H.esc(r.end) + '</span>' : '') + '</th>' +
        '<td class="num">' + amount(r.contributed, H) + '</td><td class="num ' + gainClass + '">' + percent(value, H) + '</td>' +
        '<td class="num ' + profitClass + '">' + signedAmount(r.profit, H) + '</td><td class="num">' + percent(r.mdd, H) + '</td><td class="num">' + amount(r.value, H) + '</td></tr>';
    }).join('');
    return '<section class="card portfolio-compare-table-card" aria-label="各策略模拟结果"><div class="table-wrap" role="region" aria-label="策略收益与风险对比" tabindex="0"><table class="portfolio-compare-table"><thead><tr><th scope="col">策略</th><th scope="col">总投入本金 / ' + unit + '</th><th scope="col">' + returnBasis(comparison, H.annual) + '</th><th scope="col">盈亏 / ' + unit + '</th><th scope="col">最大回撤</th><th scope="col">期末资产 / ' + unit + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }
  function plotValue(point, result, metric, annual) {
    if (metric === 'amount') return point.value;
    if (metric === 'drawdown') return point.drawdown;
    return annual ? point.annualReturn : point.totalReturn;
  }
  function plot(comparison, state, H) {
    const items = successful(comparison), metric = ['return', 'drawdown', 'amount'].includes(state.metric) ? state.metric : 'return';
    if (!items.length) return '';
    const hidden = state.hidden || new Set(), visible = items.filter(item => !hidden.has(item.id));
    const basis = returnBasis(comparison, H.annual), annual = H.annual && basis === '年化收益';
    const name = metric === 'amount' ? '账户资产' : metric === 'drawdown' ? '回撤' : basis;
    const legend = items.map(item => {
      const index = comparison.strategies.indexOf(item), selected = !hidden.has(item.id);
      return '<label class="portfolio-compare-legend-item' + (selected ? '' : ' is-hidden') + '"><input id="portfolio-compare-toggle-' + H.esc(item.id) + '" type="checkbox" data-action="portfolio-compare-toggle" data-value="' + H.esc(item.id) + '"' + (selected ? ' checked' : '') + ' aria-label="显示' + H.esc(item.label) + '曲线"><i style="background:' + colorFor(index) + '"></i><span>' + H.esc(item.label) + '</span></label>';
    }).join('');
    const metricControl = '<div class="segmented" role="group" aria-label="策略对比曲线内容">' + [['return', '收益率'], ['drawdown', '回撤'], ['amount', '账户资产']].map(([key, label]) => action(H, label, 'metric', key === metric ? 'active' : '', 'data-value="' + key + '" aria-pressed="' + (key === metric) + '"')).join('') + '</div>';
    let figure = '<p class="portfolio-compare-chart-empty">勾选策略以显示曲线。</p>';
    if (visible.length) {
      const W = 1120, HH = 330, left = 80, right = W - 25, top = 20, bottom = HH - 38;
      const start = Date.parse(comparison.start), end = Date.parse(comparison.end);
      const x = day => left + (Date.parse(day) - start) / Math.max(1, end - start) * (right - left);
      let min = 0, max = 0;
      for (const item of visible) for (const point of item.result.curve) {
        if (point.day < comparison.start || point.day > comparison.end) continue;
        const value = plotValue(point, item.result, metric, annual);
        if (finite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
      const span = max - min || 1, low = min - span * .06, high = max + span * .06;
      const y = value => top + (high - value) / (high - low) * (bottom - top);
      const tick = value => metric === 'amount' ? Math.abs(value) >= 10000 ? H.money(value / 10000, 1) + '万' : H.money(value, 0) : H.money(value, 1) + '%';
      let grid = '';
      for (let i = 0; i <= 4; i++) {
        const value = low + (high - low) * i / 4;
        grid += '<line x1="' + left + '" x2="' + right + '" y1="' + y(value).toFixed(2) + '" y2="' + y(value).toFixed(2) + '" stroke="#e5eadd"/><text x="' + (left - 12) + '" y="' + (y(value) + 4).toFixed(2) + '" text-anchor="end">' + H.esc(tick(value)) + '</text>';
      }
      const middle = new Date(start + (end - start) / 2).toISOString().slice(0, 10);
      [comparison.start, middle, comparison.end].forEach((day, index) => {
        grid += '<text x="' + x(day).toFixed(2) + '" y="' + (HH - 10) + '" text-anchor="' + (index === 0 ? 'start' : index === 2 ? 'end' : 'middle') + '">' + H.esc(day) + '</text>';
      });
      const paths = visible.map(item => {
        const index = comparison.strategies.indexOf(item); let path = '', connected = false;
        for (const point of item.result.curve) {
          if (point.day < comparison.start || point.day > comparison.end) continue;
          const value = plotValue(point, item.result, metric, annual);
          if (!finite(value)) { connected = false; continue; }
          path += (connected ? 'L' : 'M') + x(point.day).toFixed(2) + ',' + y(value).toFixed(2); connected = true;
        }
        return '<path data-comparison-line="' + H.esc(item.id) + '" d="' + path + '" stroke="' + colorFor(index) + '" stroke-width="2"' + (index >= 5 ? ' stroke-dasharray="7 3"' : '') + ' fill="none" stroke-linecap="round"><title>' + H.esc(item.label) + '</title></path>';
      }).join('');
      figure = '<div class="portfolio-compare-plot-scroll"><svg class="portfolio-compare-plot" viewBox="0 0 ' + W + ' ' + HH + '" role="img" aria-label="各策略' + name + '对比曲线">' + grid + paths + '</svg></div>';
    }
    return '<section class="card portfolio-compare-chart"><div class="portfolio-compare-section-head"><h2>' + name + '走势' + (metric === 'amount' ? ' · ' + P.currencyInfo(comparison.config).name : '') + '</h2>' + metricControl + '</div><div class="portfolio-compare-legend" role="group" aria-label="选择显示的策略曲线">' + legend + '</div>' + figure + '</section>';
  }
  function orderLines(status, result, H) {
    const { unit } = P.currencyInfo(result.config);
    if (status.status === 'liquidated') return ['已清仓'];
    const orders = status.nextPlan?.orders || [];
    if (orders.length) return orders.map(order => {
      const code = order.code || result.holdings?.find(holding => holding.id === order.id)?.code || order.id?.replace(/^[^:]+:/, '') || '标的';
      return order.side === 'sell' ? '卖出 ' + code + ' · ' + (finite(order.sellFraction) ? '信号日持仓的 ' + percent(order.sellFraction * 100, H) : '卖出比例待确认') : '买入 ' + code + ' · ' + amount(order.amount, H, 2) + ' ' + unit;
    });
    if (status.nextSignal?.available) {
      const signal = status.nextSignal;
      return [signal.pendingChange ? signal.on ? '恢复 TQQQ 买入' : '退出 TQQQ 仓位' : signal.on ? '继续持有 TQQQ' : '继续保留 TQQQ 对应现金'];
    }
    if (status.nextPlanAvailable) return [status.status === 'missing' ? '信号缺项，暂不生成新计划' : '暂无新调仓订单'];
    return ['未记录该日待执行计划'];
  }
  function sourceLabel(status) {
    const row = status.observation, m = row?.metadata || {}, parts = [];
    if (m.vixDay) parts.push('VIX/VIX3M ' + m.vixDay);
    if (m.qqqDay) parts.push('QQQ ' + m.qqqDay);
    if (m.opportunity) for (const leg of m.opportunity.legs || []) if (leg.sourceDay) parts.push((leg.proxyId || leg.id || '').replace(/^[^:]+:/, '') + ' ' + leg.sourceDay);
    if (row?.method === 'relative_strength_rotation' && m.sourceDay) parts.push('USD/TQQQ ' + m.sourceDay);
    if (!parts.length && status.sourceDay) parts.push(status.sourceDay);
    return parts.join(' · ');
  }
  function statusDetails(status, H) {
    const Pdf = window.ChanghengPortfolioPdf;
    const indicators = (status.indicators || []).map(item => {
      const value = Pdf?.dailyDisplay ? Pdf.dailyDisplay(item) : { label: item.label || item.id, value: finite(item.value) ? String(item.value) : '—', basis: '' };
      return '<div><dt>' + H.esc(value.label) + '</dt><dd>' + H.esc(value.value) + '</dd>' + (value.basis ? '<span>' + H.esc(value.basis) + '</span>' : '') + '</div>';
    }).join('');
    const source = sourceLabel(status), calculation = status.observation && Pdf?.explainDaily ? Pdf.explainDaily(status.observation) : [];
    const facts = [status.signalDay ? ['信号决策日', status.signalDay] : null, source ? ['数据来源日', source] : null, ...calculation].filter(Boolean);
    if (!indicators && !facts.length) return '';
    return '<details class="portfolio-compare-details"><summary>查看指标与判断依据</summary>' + (indicators ? '<dl class="portfolio-compare-indicators">' + indicators + '</dl>' : '') +
      (facts.length ? '<dl class="portfolio-compare-facts">' + facts.map(([label, value]) => '<div><dt>' + H.esc(label) + '</dt><dd>' + H.esc(value) + '</dd></div>').join('') + '</dl>' : '') + '</details>';
  }
  function states(comparison, state, H) {
    const days = dates(comparison), day = selectedDay(comparison, state.day), index = days.indexOf(day), { unit } = P.currencyInfo(comparison.config);
    const controls = days.length ? '<div class="portfolio-compare-date-controls">' + action(H, '上一日', 'prev', 'btn', index <= 0 ? 'disabled' : '') +
      '<label for="portfolio-compare-date">状态日期<input type="date" id="portfolio-compare-date" data-portfolio-field="compare-date" value="' + day + '" min="' + days[0] + '" max="' + days.at(-1) + '"></label>' +
      action(H, '下一日', 'next', 'btn', index === days.length - 1 ? 'disabled' : '') + '</div>' : '';
    const rows = comparison.strategies.map((item, strategyIndex) => {
      const r = item.result;
      if (!r || r.error) return '<tr class="portfolio-compare-unavailable"><th scope="row">' + strategyName(item, strategyIndex, H) + '</th><td colspan="4"><p class="portfolio-compare-failure">' + H.esc(item.error || r?.error || '未取得本策略结果') + '</p></td></tr>';
      const status = P.strategyStatus(r, day), account = status.account || {}, next = orderLines(status, r, H);
      return '<tr data-comparison-status="' + H.esc(item.id) + '"><th scope="row">' + strategyName(item, strategyIndex, H) +
        (account.day && account.day !== day ? '<span class="portfolio-compare-status-date">账户截至 ' + H.esc(account.day) + '</span>' : '') + '</th>' +
        '<td class="portfolio-compare-account num">' + amount(account.securitiesValue, H, 2) + '<span class="portfolio-compare-position-pct">' + percent(account.securitiesPct, H) + '</span></td>' +
        '<td class="portfolio-compare-cash num">' + amount(account.cash, H, 2) + '</td>' +
        '<td class="portfolio-compare-state"><strong class="portfolio-compare-status-label' + (status.status === 'missing' ? ' negative' : '') + '">' + H.esc(status.label || '状态未提供') + '</strong>' +
        (status.observationDay && status.observationDay !== day ? '<span class="portfolio-compare-observation">观察截至 ' + H.esc(status.observationDay) + '</span>' : '') +
        '<p>' + H.esc(status.detail || status.label || '缺少该日状态记录') + '</p>' + statusDetails(status, H) + '</td>' +
        '<td class="portfolio-compare-next"><ul>' + next.map(line => '<li>' + H.esc(line) + '</li>').join('') + '</ul></td></tr>';
    }).join('');
    return '<section class="portfolio-compare-states" aria-label="同日各策略状态"><div class="portfolio-compare-section-head"><h2>各策略状态</h2>' + controls + '</div>' +
      '<div class="card"><div class="table-wrap" role="region" aria-label="同日策略状态对比表" tabindex="0"><table class="portfolio-compare-table portfolio-compare-state-table"><thead><tr><th scope="col">策略</th><th scope="col">证券持仓 / ' + unit + '</th><th scope="col">现金 / ' + unit + '</th><th scope="col">当日状态</th><th scope="col">下一共同交易日</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></section>';
  }
  function view(comparison, state = {}, H) {
    const error = state.error ? '<p class="portfolio-compare-error negative" role="alert">' + H.esc(state.error) + '</p>' : '';
    if (!comparison) return error + '<section class="card portfolio-compare-placeholder"><h2>多策略对比</h2><p>使用当前持仓、本金和回测条件，分别运行高级策略并查看收益与状态。</p><p>点击“开始对比”生成结果。</p></section>';
    const tab = state.tab === 'states' ? 'states' : 'performance', items = successful(comparison), { unit, name } = P.currencyInfo(comparison.config);
    const current = items[0]?.result;
    const holdings = (current?.holdings || []).map(holding => (holding.code || holding.name) + ' ' + percent(holding.targetWeight, H));
    if (current?.cashWeight > 0) holdings.push('现金 ' + percent(current.cashWeight, H));
    const tabs = [['performance', '收益对比'], ['states', '策略状态']].map(([key, label]) => action(H, label, 'tab', 'portfolio-result-tab', 'id="portfolio-compare-tab-' + key + '" data-value="' + key + '" role="tab" aria-selected="' + (tab === key) + '" aria-controls="portfolio-compare-pane-' + key + '" tabindex="' + (tab === key ? '0' : '-1') + '"')).join('');
    const tools = '<div class="portfolio-compare-tools">' + (tab === 'performance' ? H.annualControl || '' : '') + action(H, tab === 'states' ? '导出所选日状态 CSV' : '导出对比结果 CSV', tab === 'states' ? 'export-states' : 'export', 'portfolio-result-link', !items.length ? 'disabled' : '') + '</div>';
    const contribution = P.contributionMethods.find(([id]) => id === comparison.config.contributionMethod)?.[1] || '每月定投';
    const rebalance = { none: '不再平衡', month: '每月再平衡', quarter: '每季再平衡', year: '每年再平衡' }[comparison.config.rebalance] || '不再平衡';
    const header = '<div class="portfolio-compare-context"><p><strong>' + H.esc(comparison.start || '—') + ' 至 ' + H.esc(comparison.end || '—') + '</strong><span>' + name + '计价</span><span>初始本金 ' + amount(comparison.config.initial, H) + ' ' + unit + '</span></p><p>' + (comparison.config.monthly > 0 ? '<span>' + H.esc(contribution) + ' · 基础月预算 ' + amount(comparison.config.monthly, H) + ' ' + unit + '</span>' : '<span>不追加资金</span>') + '<span>' + rebalance + '</span></p>' +
      (holdings.length ? '<p>' + H.esc(holdings.join(' · ')) + '</p>' : '') + '</div>';
    const notice = comparison.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(comparison.catalogRefresh.missing) + '</p>' : '';
    return '<div class="portfolio-comparison">' + error + header + '<div class="portfolio-compare-nav"><div class="portfolio-result-tabs" role="tablist" aria-label="多策略对比分区">' + tabs + '</div>' + tools + '</div>' + notice +
      '<div id="portfolio-compare-pane-' + tab + '" role="tabpanel" aria-labelledby="portfolio-compare-tab-' + tab + '" class="portfolio-compare-content">' + (tab === 'states' ? states(comparison, state, H) : performanceTable(comparison, H) + plot(comparison, state, H)) + '</div></div>';
  }
  function summaryCsv(comparison) {
    const code = P.currencyInfo(comparison.config).code;
    const rows = [['策略ID', '策略', '模拟状态', '缺项', '实际开始日', '实际结束日', '计价币种', '总投入本金' + code, '组合年化收益%', '组合累计收益%', '税后盈亏' + code, '最大回撤%', '期末账户资产' + code, '期末现金' + code, '资金年化XIRR%', '资金年化缺项', '配置JSON']];
    for (const item of comparison.strategies) {
      const r = item.result;
      rows.push(!r || r.error ? [item.id, item.label, '未完成', item.error || r?.error || '缺结果', '', '', code, '', '', '', '', '', '', '', '', '', JSON.stringify({ ...comparison.config, initialMethod: item.id })] :
        [item.id, item.label, '已完成', '', r.start, r.end, code, r.contributed, r.end >= P.addYears(r.start, 1) ? r.annualReturn : '', r.totalReturn, r.profit, r.mdd, r.value, r.cash, r.xirr, r.xirrMissing, JSON.stringify(r.config)]);
    }
    return M.csv(rows);
  }
  function statesCsv(comparison, selected) {
    const day = selectedDay(comparison, selected), code = P.currencyInfo(comparison.config).code;
    const rows = [['所选日期', '策略ID', '策略', '状态日期', '策略观察日', '策略状态', '状态说明', '证券市值' + code, '证券仓位%', '现金' + code, '账户资产' + code, '持仓本金' + code, '信号决策日', '数据来源日', '待单记录可用', '下一共同交易日计划JSON', '下一信号JSON', '指标JSON', '当日观察JSON', '缺项']];
    for (const item of comparison.strategies) {
      const r = item.result;
      if (!r || r.error) { rows.push([day, item.id, item.label, '', '', '未完成', '', '', '', '', '', '', '', '', '', '', '', '', '', item.error || r?.error || '缺结果']); continue; }
      const status = P.strategyStatus(r, day), account = status.account || {};
      rows.push([day, item.id, item.label, status.day, status.observationDay, status.label, status.detail, account.securitiesValue, account.securitiesPct, account.cash, account.value, account.positionPrincipal, status.signalDay, sourceLabel(status), status.nextPlanAvailable === true ? '是' : '否',
        status.nextPlan ? JSON.stringify(status.nextPlan) : '', status.nextSignal ? JSON.stringify(status.nextSignal) : '', JSON.stringify(status.indicators || []), status.observation ? JSON.stringify(status.observation) : '', status.status === 'missing' ? status.detail : '']);
    }
    return M.csv(rows);
  }
  window.ChanghengPortfolioComparison = { view, summaryCsv, statesCsv, dates, selectedDay };
})();
