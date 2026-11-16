(function () {
  'use strict';
  // Saved 方案: storage, summaries and the comparison tab's markup. No simulation happens here.
  const M = window.Changheng, P = window.ChanghengPortfolioModel;
  const KEY = 'changheng.portfolio.scenarios.v1', LIMIT = 8;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const usable = item => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' &&
    !!item.config && typeof item.config === 'object' && Array.isArray(item.config.positions);
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(usable).slice(0, LIMIT) : [];
    } catch (_) { return []; }
  }
  function store(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
  }
  function nextName(list) {
    const used = new Set(list.map(item => item.name));
    return Array.from('ABCDEFGH', letter => '方案' + letter).find(name => !used.has(name)) || '';
  }
  function nameError(list, name) {
    const text = String(name ?? '').trim();
    if (list.length >= LIMIT) return '最多保存 ' + LIMIT + ' 个方案，请先删除不用的方案';
    if (!text) return '请填写方案名称';
    if (Array.from(text).length > 20) return '方案名称不超过 20 个字';
    if (list.some(item => item.name === text)) return '已有同名方案，请换一个名称';
    return '';
  }
  const trim = value => Number(value.toFixed(2));
  const rebalanceLabel = config => config.rebalance === 'band' ? '偏离' + config.rebalanceBand + '个百分点再平衡' :
    ({ month: '每月再平衡', quarter: '每季再平衡', year: '每年再平衡' })[config.rebalance] || '不再平衡';
  function summary(config, assets) {
    const codes = new Map((assets || []).map(asset => [asset.id, asset.code]));
    const held = config.positions.filter(position => finite(position.weight) && position.weight > 0);
    const total = held.reduce((sum, position) => sum + position.weight, 0);
    const holdings = held.map(position => (codes.get(position.id) || position.id) + ' ' + trim(position.weight) + '%');
    if (total < 100 - 1e-8) holdings.push('现金 ' + trim(100 - total) + '%');
    let methods;
    try {
      const names = P.strategyNames(config);
      methods = config.monthly > 0 ? [names.initial, names.contribution] : [names.initial];
    } catch (_) { methods = ['投入方式已失效']; }
    return { holdings: holdings.join(' · '), rules: methods.concat(rebalanceLabel(config)).join(' · ') };
  }
  function windowLabel(config) {
    return config.years === 'common' ? '共同历史' : config.years === 'custom' ? config.start + ' 至 ' + config.end : '近' + config.years + '年';
  }
  const fullYear = result => result.end >= P.addYears(result.start, 1);
  const shown = (result, annual) => annual && fullYear(result) ? result.annualReturn : result.totalReturn;
  function list(state, H) {
    const full = state.scenarios.length >= LIMIT;
    const rows = state.scenarios.map(item => {
      const text = summary(item.config, state.assets), value = 'data-value="' + H.esc(item.id) + '" aria-haspopup="dialog"';
      return '<li class="portfolio-scenario"><div><strong>' + H.esc(item.name) + '</strong><span>' + H.esc(text.holdings) + '</span><small>' + H.esc(text.rules) + '</small></div>' +
        '<div class="portfolio-scenario-actions">' + H.action('载入', 'portfolio-scenario-load', 'text-link', value + ' aria-label="载入' + H.esc(item.name) + '"') +
        H.action('删除', 'portfolio-scenario-delete', 'text-link', value + ' aria-label="删除' + H.esc(item.name) + '"') + '</div></li>';
    }).join('');
    return H.card('已保存方案', state.scenarios.length + ' / ' + LIMIT,
      rows ? '<ul class="portfolio-scenario-list">' + rows + '</ul>' : '<p class="portfolio-scenario-empty">还没有保存方案。在模拟设置和我的组合中配置好后，在这里保存。</p>',
      '<div class="portfolio-scenario-save"><input type="text" id="portfolio-scenario-name" data-portfolio-field="scenario-name" maxlength="20" aria-label="方案名称" placeholder="方案名称" value="' +
      H.esc(state.name) + '"' + (full ? ' disabled' : '') + '>' + H.action('保存当前设置为方案', 'portfolio-scenario-save', 'btn', full || !state.canSave ? 'disabled' : '') + '</div>');
  }
  function table(run, H) {
    const { unit } = P.currencyInfo(run.config), first = run.scenarios.find(row => row.result)?.result;
    const basis = !H.annual ? '累计收益' : first && fullYear(first) ? '年化收益' : '区间收益';
    const percent = value => finite(value) ? H.pct(Math.abs(value) < .005 ? 0 : value, 2, false) : '—';
    const amount = value => finite(value) ? H.money(value, value !== 0 && Math.abs(value) < 1 ? 2 : 0) : '—';
    const rows = run.scenarios.map((row, index) => {
      const r = row.result, name = '<span class="portfolio-compare-name"><i style="background:' + window.ChanghengPortfolioComparison.colorFor(index) + '"></i><strong>' + H.esc(row.label) + '</strong></span>';
      if (!r) return '<tr class="portfolio-compare-unavailable"><th scope="row">' + name + '</th><td colspan="9"><span class="portfolio-compare-failure">' + H.esc(row.error || '未取得本方案结果') + '</span></td></tr>';
      const value = shown(r, H.annual), ratio = P.riskRatios(r).drawdown, own = r.start !== first.start || r.end !== first.end;
      return '<tr><th scope="row">' + name + (own ? '<span class="portfolio-compare-period">' + H.esc(r.start) + ' 至 ' + H.esc(r.end) + '</span>' : '') + '</th>' +
        '<td class="num">' + amount(r.contributed) + '</td><td class="num ' + (value < 0 ? 'negative' : 'positive') + '">' + percent(value) + '</td>' +
        '<td class="num ' + (r.profit < 0 ? 'negative' : 'positive') + '">' + (r.profit > .005 ? '+' : '') + amount(Math.abs(r.profit) < .005 ? 0 : r.profit) + '</td>' +
        '<td class="num">' + percent(r.mdd) + '</td><td class="num">' + percent(r.volatility) + '</td>' +
        '<td class="num">' + (ratio.value === null ? '<span class="portfolio-compare-missing">' + H.esc(ratio.missing) + '</span>' : ratio.value.toFixed(2)) + '</td>' +
        '<td class="num">' + amount(r.tradeCost) + '</td><td class="num">' + amount(r.taxCost) + '</td><td class="num">' + amount(r.value) + '</td></tr>';
    }).join('');
    return '<section class="card portfolio-compare-table-card" aria-label="各方案模拟结果"><div class="table-wrap" role="region" aria-label="方案收益、风险与成本对比" tabindex="0"><table class="portfolio-compare-table"><thead><tr><th scope="col">方案</th><th scope="col">总投入本金 / ' + unit +
      '</th><th scope="col">' + basis + '</th><th scope="col">盈亏 / ' + unit + '</th><th scope="col">最大回撤</th><th scope="col">年化波动</th><th scope="col">收益回撤比</th><th scope="col">交易费 / ' + unit +
      '</th><th scope="col">税费含预留 / ' + unit + '</th><th scope="col">期末资产 / ' + unit + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }
  function results(state, H) {
    const run = state.run;
    if (!run) return '';
    const { name } = P.currencyInfo(run.config), ran = run.scenarios.filter(row => row.result).map(row => row.result);
    const differs = ran.some(r => r.start !== ran[0].start || r.end !== ran[0].end);
    return '<div class="portfolio-compare-context"><p><strong>' + H.esc(windowLabel(run.config)) + '</strong><span>' + name + '计价</span>' +
      (run.start ? '<span>' + H.esc(run.start) + ' 至 ' + H.esc(run.end) + '</span>' : '') + '</p></div>' +
      '<div class="portfolio-compare-nav"><span class="portfolio-scenario-shared">区间与币种取当前设置</span><div class="portfolio-compare-tools">' + (H.annualControl || '') +
      H.action('导出对比结果 CSV', 'portfolio-scenario-export', 'portfolio-result-link', ran.length ? '' : 'disabled') + '</div></div>' +
      (run.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(run.catalogRefresh.missing) + '</p>' : '') +
      (differs ? '<p class="portfolio-warning">各方案实际区间不同，收益不能直接比较。</p>' : '') + table(run, H) +
      window.ChanghengPortfolioComparison.plot({ ...run, strategies: run.scenarios, baseline: null }, state.view, H, { prefix: 'scenario', noun: '方案' });
  }
  function view(state, H) {
    return '<div class="portfolio-comparison portfolio-scenarios">' + (state.error ? '<p class="portfolio-compare-error negative" role="alert">' + H.esc(state.error) + '</p>' : '') +
      list(state, H) + results(state, H) + '</div>';
  }
  function csv(run) {
    const code = P.currencyInfo(run.config).code;
    const rows = [['方案', '模拟状态', '缺项', '实际开始日', '实际结束日', '计价币种', '总投入本金' + code, '组合年化收益%', '组合累计收益%', '税后盈亏' + code, '最大回撤%', '年化波动%', '收益回撤比',
      '交易费' + code, '税费含预留' + code, '期末账户资产' + code, '期末现金' + code, '资金年化XIRR%', '资金年化缺项', '配置JSON']];
    for (const row of run.scenarios) {
      const r = row.result;
      rows.push(!r ? [row.label, '未完成', row.error || '缺结果', '', '', code, '', '', '', '', '', '', '', '', '', '', '', '', '', ''] :
        [row.label, '已完成', '', r.start, r.end, code, r.contributed, fullYear(r) ? r.annualReturn : '', r.totalReturn, r.profit, r.mdd, r.volatility, P.riskRatios(r).drawdown.value ?? '',
          r.tradeCost, r.taxCost, r.value, r.cash, r.xirr, r.xirrMissing, JSON.stringify(r.config)]);
    }
    return M.csv(rows);
  }
  window.ChanghengPortfolioScenarios = { load, store, nextName, nameError, summary, windowLabel, view, csv, LIMIT };
})();
