(function () {
  'use strict';
  // 策略寻优: the tab's markup and CSV. Every rule alone and in blends is scored by the model from every start.
  const M = window.Changheng, P = window.ChanghengPortfolioModel;
  const PERIODS = [1, 3, 5, 10], TOP = 20;
  const CRITERIA = [['median', '中位年化'], ['worst', '最差年化'], ['ratio', '收益回撤比'], ['wins', '胜过一次性投入']];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const cache = new WeakMap();
  function label(candidate) {
    const names = Object.fromEntries(P.initialMethods);
    return candidate.legs.map(leg => names[leg.id] + (candidate.legs.length > 1 ? ' ' + Math.round(leg.weight * 100) + '%' : '')).join(' + ');
  }
  // Starts on the same side of the target mix's 200-day line as the latest close.
  function similarStarts(run) {
    if (!finite(run.todayDeviation)) return [];
    const below = run.todayDeviation < 0;
    return run.starts.filter(start => finite(run.deviationBefore[start]) && (below ? run.deviationBefore[start] < 0 : run.deviationBefore[start] >= 0));
  }
  function analysis(run, scope, criterion) {
    let saved = cache.get(run);
    if (!saved) cache.set(run, saved = new Map());
    const key = scope + '|' + criterion;
    if (!saved.has(key)) {
      const similar = scope === 'similar' ? new Set(similarStarts(run)) : null;
      const summaries = P.searchSummary(run.evaluated, run.candidates, similar ? { include: start => similar.has(start) } : {});
      saved.set(key, { summaries, ...P.searchPick(summaries, criterion) });
    }
    return saved.get(key);
  }
  function deployed(run, candidate) {
    const shares = candidate.legs.map(leg => run.today[leg.id]);
    return shares.every(finite) ? candidate.legs.reduce((total, leg, i) => total + leg.weight * shares[i], 0) : null;
  }
  function deployedText(run, candidate, H) {
    const share = deployed(run, candidate);
    if (share === null) return '—';
    return H.pct(share, 0, false) + (run.target > 0 ? '<small>目标的 ' + H.pct(Math.min(100, 100 * share / run.target), 0, false) + '</small>' : '');
  }
  const beat = s => s.beat ? s.beat.wins + ' / ' + s.beat.of : '基准';
  function controls(state, H) {
    const progress = state.progress;
    return '<div class="portfolio-rolling-controls"><span id="portfolio-search-label">持有期</span><div class="segmented" role="group" aria-labelledby="portfolio-search-label">' +
      PERIODS.map(years => H.action(years + '年', 'portfolio-rolling-years', years === state.years ? 'active' : '', 'data-value="' + years + '" aria-pressed="' + (years === state.years) + '"' + (progress ? ' disabled' : ''))).join('') + '</div>' +
      (progress ? '<span id="portfolio-search-progress" class="portfolio-rolling-progress" role="status">' + (progress.total ? '已完成 ' + progress.done + ' / ' + progress.total + ' 次模拟' : '正在读取行情…') + '</span>' +
        H.action('停止', 'portfolio-search-stop', 'btn') : '') + '</div>';
  }
  function choice(H, labelText, action, options, current) {
    return '<div class="portfolio-search-choice"><span>' + labelText + '</span><div class="segmented" role="group" aria-label="' + labelText + '">' +
      options.map(([value, name, disabled]) => H.action(name, action, value === current ? 'active' : '', 'data-value="' + value + '" aria-pressed="' + (value === current) + '"' + (disabled ? ' disabled' : ''))).join('') + '</div></div>';
  }
  function pickPanel(run, a, H) {
    const pick = a.robust, top = a.ranked[0], s = pick.all, r = a.ranks[pick.id];
    const fact = (name, value, wide) => '<div' + (wide ? ' class="portfolio-search-wide"' : '') + '><dt>' + name + '</dt><dd class="num">' + value + '</dd></div>';
    return '<section class="portfolio-search-pick"><span class="portfolio-search-pick-label">前后两半都靠前</span><strong>' + H.esc(label(pick)) + '</strong><dl>' +
      fact('中位年化', H.pc(s.median)) + fact('最差年化', H.pc(s.worst)) + fact('中位最大回撤', H.pct(s.mddMedian, 2, false)) + fact('胜过一次性投入', beat(s)) +
      fact('名次', '全部第 ' + r.all + ' · 前半第 ' + r.early + ' · 后半第 ' + r.late, true) + fact('最近收盘已投入资金', deployedText(run, pick, H)) + '</dl>' +
      (top && top.id !== pick.id ? '<p>全部起点排第一的是 ' + H.esc(label(top)) + '（中位年化 ' + H.pct(top.all.median, 2) + '），但前半第 ' + a.ranks[top.id].early + '、后半第 ' + a.ranks[top.id].late + '。</p>' : '') + '</section>';
  }
  function table(run, a, H) {
    const lump = a.ranked.find(s => s.id === 'lump_sum'), rows = a.ranked.slice(0, TOP).concat(lump && a.ranks.lump_sum.all > TOP ? [lump] : []);
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="策略寻优排名"><table class="portfolio-compare-table portfolio-search-table"><thead><tr><th scope="col">名次</th><th scope="col">方案</th><th scope="col">中位年化</th><th scope="col">最差年化</th>' +
      '<th scope="col">中位最大回撤</th><th scope="col">收益回撤比</th><th scope="col">胜过一次性投入</th><th scope="col">前半 / 后半</th><th scope="col">最近收盘已投入</th></tr></thead><tbody>' +
      rows.map(s => {
        const r = a.ranks[s.id], x = s.all;
        return '<tr' + (s.id === a.robust.id ? ' class="portfolio-search-chosen"' : s.id === 'lump_sum' ? ' class="portfolio-compare-baseline"' : '') + '><td class="num">' + r.all + '</td><th scope="row">' + H.esc(label(s)) + '</th>' +
          '<td class="num">' + H.pc(x.median) + '</td><td class="num">' + H.pc(x.worst) + '</td><td class="num">' + H.pct(x.mddMedian, 2, false) + '</td><td class="num">' + (finite(x.ratio) ? x.ratio.toFixed(2) : '—') + '</td>' +
          '<td class="num">' + beat(x) + '</td><td class="num">' + r.early + ' / ' + r.late + '</td><td class="num">' + deployedText(run, s, H) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function results(state, H) {
    const run = state.run;
    if (!run) return '';
    const criterion = CRITERIA.some(([key]) => key === state.criterion) ? state.criterion : 'median';
    const similar = similarStarts(run), scope = state.scope === 'similar' && similar.length ? 'similar' : 'all';
    const a = analysis(run, scope, criterion);
    if (!a.robust) return '<p class="portfolio-warning">没有方案在这些起点上得到结果。' + H.esc(unavailable(run)) + '</p>';
    const side = run.todayDeviation < 0 ? '下方' : '上方';
    const trend = finite(run.todayDeviation) ? '<span class="portfolio-search-trend">目标组合最近收盘' + (run.todayDeviation < 0 ? '低于' : '高于') + '200日均线 ' + H.pct(Math.abs(run.todayDeviation), 1, false) + '</span>' : '';
    const tools = '<div class="portfolio-search-tools">' + choice(H, '排序依据', 'portfolio-search-criterion', CRITERIA, criterion) +
      choice(H, '起点', 'portfolio-search-scope', [['all', '全部起点 ' + run.starts.length], ['similar', '与今天同在均线' + side + ' ' + similar.length, !similar.length]], scope) + trend + '</div>';
    const missing = unavailable(run);
    return (run.catalogRefresh?.available === false ? '<p class="portfolio-warning">' + H.esc(run.catalogRefresh.missing) + '</p>' : '') +
      H.card('寻优结果', a.ranked.length + ' 个方案 · 起点 ' + run.starts[0] + ' — ' + run.starts.at(-1) + ' · ' + (scope === 'similar' ? similar.length : run.starts.length) + ' 个起点 · 各持有 ' + run.years + ' 年',
        '<p class="portfolio-warning portfolio-rolling-caveat">方案越多，越容易挑中碰巧领先的组合；名次来自 ' + run.starts[0].slice(0, 4) + ' 年以来的历史，不是预测。</p>' + tools + pickPanel(run, a, H) + table(run, a, H) +
          (missing ? '<p class="portfolio-search-missing">' + H.esc(missing) + '</p>' : ''),
        H.action('导出全部方案 CSV', 'portfolio-search-export', 'portfolio-result-link'));
  }
  function unavailable(run) {
    const names = Object.fromEntries(P.initialMethods), failed = Object.entries(run.ruleErrors || {});
    return failed.length ? '以下规则在这些起点都无法模拟，含它们的方案不参与排名：' + failed.map(([id, error]) => names[id] + '（' + error + '）').join('；') : '';
  }
  function view(state, H) {
    return '<div class="portfolio-comparison portfolio-rolling portfolio-search">' + (state.error ? '<p class="portfolio-compare-error negative" role="alert">' + H.esc(state.error) + '</p>' : '') +
      controls(state, H) + results(state, H) + '</div>';
  }
  function csv(run, state = {}) {
    const criterion = CRITERIA.some(([key]) => key === state.criterion) ? state.criterion : 'median';
    const similar = similarStarts(run), scope = state.scope === 'similar' && similar.length ? 'similar' : 'all';
    const a = analysis(run, scope, criterion), scopeName = scope === 'similar' ? '与今天同在200日均线同侧的起点' : '全部起点';
    const rows = [['方案ID', '方案', '起点范围', '排序依据', '成功起点', '失败起点', '中位年化%', '最差年化%', '中位最大回撤%', '最深最大回撤%', '收益回撤比', '胜过一次性投入起点数', '可比起点数',
      '名次', '前半名次', '后半名次', '前半中位年化%', '后半中位年化%', '最近收盘已投入资金%']];
    const criterionName = CRITERIA.find(([key]) => key === criterion)[1], ranked = new Set(a.ranked.map(s => s.id));
    for (const s of a.ranked.concat(a.summaries.filter(x => !ranked.has(x.id)))) {
      const x = s.all, r = a.ranks[s.id] || {};
      rows.push([s.id, label(s), scopeName, criterionName, x.count, x.failed, x.median ?? '', x.worst ?? '', x.mddMedian ?? '', x.mddWorst ?? '', x.ratio ?? '', x.beat?.wins ?? '', x.beat?.of ?? '',
        r.all ?? '', r.early ?? '', r.late ?? '', s.early.median ?? '', s.late.median ?? '', deployed(run, s) ?? '']);
    }
    return M.csv(rows);
  }
  window.ChanghengPortfolioSearch = { view, csv, label };
})();
