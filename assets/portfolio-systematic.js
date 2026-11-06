(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio-opportunity.js'));
  else root.ChanghengPortfolioSystematic = factory(root.ChanghengPortfolioOpportunity);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Opportunity) {
  'use strict';
  const DAY = 86400000, EPS = 1e-10;
  const METHODS = ['vix_panic_reentry', 'relative_strength_rotation', 'dual_risk_guard', ...Object.keys(Opportunity?.definitions || {})];
  const sum = values => values.reduce((a, b) => a + b, 0);
  const gap = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
  const copy = value => JSON.parse(JSON.stringify(value));
  function validDay(day) {
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  }
  function rows(value, label, columns = 2) {
    if (!Array.isArray(value) || !value.length) return [];
    let previous = '';
    return value.map(row => {
      if (!Array.isArray(row) || row.length < columns || !validDay(row[0]) || row[0] <= previous ||
          row.slice(1, columns).some(v => !Number.isFinite(v) || v <= 0)) {
        throw new Error(label + '日期、顺序或正值记录无效');
      }
      previous = row[0]; return row.slice(0, columns);
    });
  }
  function latest(series, day, strict) {
    let lo = 0, hi = series.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].day < day || (!strict && series[mid].day === day)) lo = mid + 1;
      else hi = mid;
    }
    return lo ? series[lo - 1] : null;
  }
  function continuity(previous, day, label, missing) {
    return missing || (previous && gap(day, previous) > 7
      ? label + '在 ' + previous + ' 至 ' + day + ' 缺连续日线，无法确认历史状态' : null);
  }
  function vixStates(series) {
    let on = true, armed = true, exitRun = 0, calmRun = 0, held = 0, peak = 0, missing = null, lastTransitionDay = null;
    return series.map(([day, vix, vix3m], index) => {
      missing = continuity(series[index - 1]?.[0], day, 'VIX/VIX3M', missing);
      const ratio = vix / vix3m;
      const decision = { previousOn: on, previousArmed: armed, ratio, stressed: ratio > 1.1, calm: ratio < 1,
        armedForExit: null, exitCountTested: null, calmCountTested: null, heldTested: null, peakTested: null,
        peakDropTested: null, exitTriggered: false, recoveryByPeak: false, recoveryByCalm: false };
      calmRun = ratio < 1 ? calmRun + 1 : 0;
      decision.calmCountTested = calmRun;
      if (on) {
        if (!armed && calmRun >= 5) armed = true;
        exitRun = armed && ratio > 1.1 ? exitRun + 1 : 0;
        decision.armedForExit = armed; decision.exitCountTested = exitRun;
        decision.exitTriggered = exitRun >= 10;
        if (exitRun >= 10) { on = false; exitRun = calmRun = held = 0; peak = vix; }
      } else {
        held++; peak = Math.max(peak, vix);
        decision.heldTested = held; decision.peakTested = peak; decision.peakDropTested = 1 - vix / peak;
        decision.recoveryByPeak = held >= 5 && vix <= peak * .7;
        decision.recoveryByCalm = calmRun >= 5;
        if (held >= 5 && vix <= peak * .7 || calmRun >= 5) {
          on = true; armed = false; exitRun = calmRun = held = 0;
        }
      }
      if (on !== decision.previousOn) lastTransitionDay = day;
      Object.assign(decision, { on, transition: on !== decision.previousOn ? on ? 'reentry' : 'exit' : on ? 'hold' : 'park', lastTransitionDay });
      return { day, on, ratio, vix, vix3m, peak, held, armed, exitRun, calmRun, missing, decision };
    });
  }
  function qqqStates(series) {
    let on = true, exitRun = 0, entryRun = 0, missing = null, lastTransitionDay = null;
    return series.map(([day, price], index) => {
      missing = continuity(series[index - 1]?.[0], day, 'QQQ', missing);
      if (index < 251) return { day, price, on, ready: false, missing };
      const ma = sum(series.slice(index - 199, index + 1).map(r => r[1])) / 200;
      const high = Math.max(...series.slice(index - 251, index + 1).map(r => r[1]));
      const decision = { previousOn: on, price, ma, high, maFirstDay: series[index - 199][0], highFirstDay: series[index - 251][0],
        belowMA: price < ma, aboveMA: price > ma, drawdownAtLeast20: price / high <= .8,
        exitCountTested: null, entryCountTested: null, exitTriggered: false, reentryTriggered: false };
      if (on) {
        exitRun = price < ma && price / high <= .8 ? exitRun + 1 : 0;
        decision.exitCountTested = exitRun; decision.exitTriggered = exitRun >= 20;
        if (exitRun >= 20) { on = false; exitRun = entryRun = 0; }
      } else {
        entryRun = price > ma ? entryRun + 1 : 0;
        decision.entryCountTested = entryRun; decision.reentryTriggered = entryRun >= 3;
        if (entryRun >= 3) { on = true; exitRun = entryRun = 0; }
      }
      if (on !== decision.previousOn) lastTransitionDay = day;
      Object.assign(decision, { on, transition: on !== decision.previousOn ? on ? 'reentry' : 'exit' : on ? 'hold' : 'park', lastTransitionDay });
      return { day, price, on, ready: true, ma, high, drawdown: price / high - 1, exitRun, entryRun, missing, decision };
    });
  }
  function relativeStates(usd, tqqq) {
    const second = new Map(tqqq), paired = usd.filter(r => second.has(r[0])).map(r => [r[0], r[1], second.get(r[0])]);
    let missing = null;
    return paired.map(([day, a, b], index) => {
      missing = continuity(paired[index - 1]?.[0], day, 'USD/TQQQ共同收盘', missing);
      const prior = index >= 504 ? paired[index - 504] : null;
      const inputs = prior ? { startDay: prior[0], endDay: day, usdStart: prior[1], usdEnd: a, tqqqStart: prior[2], tqqqEnd: b,
        usdGrowth: a / prior[1], tqqqGrowth: b / prior[2], ratio: Math.exp(Math.log(a / prior[1]) - Math.log(b / prior[2])), intervals: 504 } : null;
      return { day, available: index >= 504, observations: index + 1, missing,
        inputs,
        value: index >= 504 ? Math.log(a / paired[index - 504][1]) - Math.log(b / paired[index - 504][2]) : null };
    });
  }
  function observed(series, day, strict, label) {
    const value = latest(series, day, strict);
    if (!value) return { missing: label + '在 ' + day + (strict ? ' 之前' : ' 当日及之前') + ' 缺实际收盘' };
    if (gap(day, value.day) > 7) return { ...value, missing: label + '最近收盘为 ' + value.day + '，距 ' + day + ' 已超过7日' };
    return value;
  }
  function validatedVix(context) {
    if (!context || context.schemaVersion !== 1 || context.status !== 'available') throw new Error('缺可用的官方VIX/VIX3M来源记录');
    const series = rows(context.series, 'VIX/VIX3M', 3);
    if (!series.length || context.first !== series[0][0] || context.asOf !== series[series.length - 1][0]) {
      throw new Error('VIX/VIX3M首末日期与成对日线不一致');
    }
    for (const id of ['VIX', 'VIX3M']) {
      const source = context.sources?.[id], url = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/' + id + '_History.csv';
      if (!source || source.url !== url) throw new Error(id + '缺Cboe官方历史CSV来源身份');
      if (!validDay(source.first) || !validDay(source.asOf) || source.first > context.first || source.asOf < context.asOf) {
        throw new Error(id + '源档日期未覆盖成对日线');
      }
      if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256)) throw new Error(id + '缺有效源档SHA-256');
      if (typeof source.retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(source.retrievedAt) ||
          !validDay(source.retrievedAt.slice(0, 10)) || !Number.isFinite(Date.parse(source.retrievedAt)) ||
          Date.parse(source.retrievedAt) > Date.now() || source.asOf > source.retrievedAt.slice(0, 10)) {
        throw new Error(id + '抓取时间无效或行情日期晚于实际取证日期');
      }
    }
    return series;
  }
  function create({ method, weights, rawHistories = {}, vixContext } = {}) {
    if (!METHODS.includes(method)) throw new Error('系统投入方法无效');
    if (!Array.isArray(weights) || weights.length !== 2 || weights.some(w => !Number.isFinite(w) || w < 0) || sum(weights) > 1 + EPS || sum(weights) <= 0) {
      throw new Error('USD/TQQQ目标权重须为0至1且总和大于0、不超过1');
    }
    weights = weights.slice();
    const W = sum(weights), originalShares = weights.map(w => w / W), rotation = method === 'relative_strength_rotation';
    const opportunity = Opportunity?.definitions[method] || null;
    const needsVix = !rotation && (!opportunity || weights[1] > 0 || opportunity.family !== 'discount');
    const vix = needsVix ? vixStates(validatedVix(vixContext)) : [];
    const opportunityFeatures = opportunity ? Opportunity.createFeatures({ rawHistories, vixContext }) : null;
    const qqq = method === 'dual_risk_guard' ? qqqStates(rows(rawHistories['us:QQQ'], 'QQQ')) : [];
    const relative = rotation ? relativeStates(rows(rawHistories['us:USD'], 'USD'), rows(rawHistories['us:TQQQ'], 'TQQQ')) : [];
    let lastDay = null, strategyStart = null, lastReview = null, lastReviewDay = null, lastReviewAttemptDay = null;
    let finish = false, requestedOn = true, shares = originalShares.slice(), changes = 0;
    const leaders = [null, null, null];
    const phaseReviews = [null, null, null];
    let current = { method, day: null, sourceDay: null, desiredTargets: weights.slice(), parkedWeights: [0, 0],
      targetShares: originalShares.slice(), status: 'pending', missing: null, warmingUp: false, metadata: {} };
    function publish(day, metadata, missing = null, warmingUp = false) {
      const desiredTargets = rotation ? shares.map(w => w * W) : [weights[0], requestedOn ? weights[1] : 0];
      const parkedWeights = [0, rotation || requestedOn ? 0 : weights[1]];
      current = { method, day, sourceDay: metadata.sourceDay || null, desiredTargets, parkedWeights,
        targetShares: desiredTargets.map(w => w / W), status: missing ? 'missing' : warmingUp ? 'warming-up' : 'ready', missing, warmingUp,
        metadata: { ...metadata, targetShares: desiredTargets.map(w => w / W), desiredTargets: desiredTargets.slice(), parkedWeights: parkedWeights.slice(), changes,
          lastReviewDay, lastReviewAttemptDay, strategyStart,
          ...(rotation ? { originalShares: originalShares.slice(), phaseReviews: copy(phaseReviews) } : {}),
          units: rotation ? { relativeRatio: 'gross_return_factor_ratio', relativeLogReturn: 'log_ratio', observations: 'common_closes', targetShares: 'fraction' } :
            { vixValue: 'index_points', vix3mValue: 'index_points', vixRatio: 'ratio', vixPeak: 'index_points', vixPeakDrop: 'fraction',
              vixHeld: 'source_observations', vixExitRun: 'source_observations', vixCalmRun: 'source_observations',
              qqqPrice: 'USD_adjusted_close', qqqMA: 'USD_adjusted_close', qqqHigh: 'USD_adjusted_close', qqqDrawdown: 'fraction',
              qqqMaDistance: 'fraction', qqqExitRun: 'source_observations', qqqEntryRun: 'source_observations' },
          startup: { strategyStart, initialDecision: day === strategyStart, historyReady: !missing && !warmingUp,
            neutralPhases: rotation ? leaders.filter(leader => leader === null).length : null } } };
    }
    function answer(sellFractions, buyAmounts, metadata = {}) {
      return { sellFractions, buyAmounts, desiredTargets: current.desiredTargets.slice(), parkedWeights: current.parkedWeights.slice(),
        metadata: { ...copy(current.metadata), ...metadata }, missing: null, warmingUp: current.warmingUp };
    }
    function unavailable(day, reason, metadata = {}, warmingUp = false) {
      publish(day, metadata, warmingUp ? null : reason, warmingUp);
      if (warmingUp) current.metadata.reason = reason;
      return { sellFractions: [0, 0], buyAmounts: [0, 0], desiredTargets: current.desiredTargets.slice(), parkedWeights: current.parkedWeights.slice(),
        metadata: { ...copy(current.metadata), allocationStateChange: false, reason }, missing: warmingUp ? null : reason, warmingUp };
    }
    function step(ctx) {
      if (!validDay(ctx?.day)) throw new Error('策略决策日期无效');
      if (lastDay && ctx.day < lastDay) throw new Error('策略决策日期不得倒退');
      if (ctx.day === lastDay) return null;
      lastDay = ctx.day;
      if (strategyStart === null) strategyStart = ctx.day;
      if (!Number.isFinite(ctx.fee) || ctx.fee < 0 || !Array.isArray(ctx.marks) || !Array.isArray(ctx.cashByLeg) ||
          ctx.marks.length !== 2 || ctx.cashByLeg.length !== 2 || ctx.marks.some(v => !Number.isFinite(v) || v < -EPS) || ctx.cashByLeg.some(v => !Number.isFinite(v))) {
        throw new Error('策略缺实际两腿市值、已结算现金或费率');
      }
      if (opportunity) {
        const features = opportunityFeatures.at(ctx.day), v = needsVix ? observed(vix, ctx.day, true, 'VIX/VIX3M') : null;
        const gateMissing = weights[1] > 0 ? v?.missing : null;
        const previousOn = requestedOn;
        if (!gateMissing) requestedOn = weights[1] > 0 ? !!v.on : true;
        const exit = previousOn && !requestedOn;
        if (previousOn !== requestedOn) changes++;
        const sellFractions = [0, exit ? 1 : 0], buyAmounts = [0, 0];
        const legs = features.legs.map((leg, k) => {
          const score = leg.scores[opportunity.family], availableCash = Math.max(0, ctx.cashByLeg[k]);
          const blockedByRisk = k === 1 && (!requestedOn || !!gateMissing);
          const intensity = score === null || score < opportunity.threshold || blockedByRisk ? 0 :
            Math.max(0, Math.min(1, (score - opportunity.threshold + 10) / (110 - opportunity.threshold)));
          let budget = weights[k] > 0 ? availableCash * intensity : 0;
          if (budget > 0 && availableCash - budget < Math.max(0, ctx.initial || 0) * .0001) budget = availableCash;
          buyAmounts[k] = budget / (1 + ctx.fee);
          return { id: leg.id, proxyId: leg.proxyId, sourceDay: leg.sourceDay, score,
            inputs: leg.inputs, components: leg.components, weights: Opportunity.coefficients[opportunity.family],
            availableCash, intensity, buyAmount: buyAmounts[k], blockedByRisk, missingReasons: leg.missingReasons[opportunity.family] };
        });
        const missingDetails = legs.filter((leg, k) => weights[k] > 0).flatMap(leg => leg.missingReasons);
        const hardMissing = gateMissing || missingDetails.find(r => r.code.startsWith('missing_') || r.code.startsWith('stale_') || r.code.endsWith('_gap'))?.message || null;
        const warmingUp = !hardMissing && missingDetails.length > 0;
        const metadata = { sourceDay: v?.day || legs.find((leg, k) => weights[k] > 0)?.sourceDay || null,
          vixDay: v?.day || null, vixOn: requestedOn, vixValue: v?.vix ?? null, vix3mValue: v?.vix3m ?? null,
          vixRatio: v?.ratio ?? null, vixDecision: v?.decision || null, phase: requestedOn ? 'score-buying' : 'tqqq-parked',
          allocationStateChange: previousOn !== requestedOn,
          opportunity: { ...opportunity, legs, formula: Opportunity.formulas[opportunity.family],
            execution: 'next_common_close_fixed_cash', tailCashFractionOfInitial: .0001 } };
        publish(ctx.day, metadata, hardMissing, warmingUp);
        if (hardMissing) return { ...answer([0, 0], [0, 0]), missing: hardMissing };
        return answer(sellFractions, buyAmounts, { allocationStateChange: previousOn !== requestedOn });
      }
      if (!rotation) {
        const v = observed(vix, ctx.day, true, 'VIX/VIX3M'), q = method === 'dual_risk_guard' ? observed(qqq, ctx.day, false, 'QQQ') : null;
        const metadata = { sourceDay: v.day || null, vixDay: v.day || null, qqqDay: q?.day || null,
          vixOn: v.on ?? null, qqqOn: q?.on ?? null, vixRatio: v.ratio ?? null, vixPeak: v.peak ?? null,
          vixValue: v.vix ?? null, vix3mValue: v.vix3m ?? null, vixPeakDrop: v.peak > 0 ? 1 - v.vix / v.peak : null,
          vixHeld: v.held ?? null, vixExitRun: v.exitRun ?? null, vixCalmRun: v.calmRun ?? null, vixArmed: v.armed ?? null,
          qqqPrice: q?.price ?? null, qqqMA: q?.ma ?? null, qqqHigh: q?.high ?? null, qqqDrawdown: q?.drawdown ?? null,
          qqqMaDistance: q?.ma > 0 ? q.price / q.ma - 1 : null, qqqExitRun: q?.exitRun ?? null, qqqEntryRun: q?.entryRun ?? null,
          vixDecision: v.decision ?? null, qqqDecision: q?.decision ?? null };
        const missing = v.missing || q?.missing || (q && !q.ready ? 'QQQ在 ' + q.day + ' 缺252个实际收盘预热' : null);
        if (missing) return unavailable(ctx.day, missing, metadata);
        const on = v.on && (!q || q.on), changed = on !== requestedOn;
        requestedOn = on; if (changed) changes++;
        publish(ctx.day, { ...metadata, phase: on ? 'invested' : 'parked', allocationStateChange: changed });
        if (!changed) return null;
        return answer([0, on ? 0 : 1], [0, on ? Math.max(0, ctx.cashByLeg[1]) / (1 + ctx.fee) : 0], { allocationStateChange: true });
      }
      const observation = observed(relative, ctx.day, false, 'USD/TQQQ');
      const metadata = { sourceDay: observation.day || null, phase: (+ctx.day.slice(5, 7) - 1) % 3, leaders: leaders.slice(),
        relativeLogReturn: observation.value ?? null, relativeRatio: observation.value == null ? null : Math.exp(observation.value),
        relativeInputs: observation.inputs ?? null,
        observations: observation.observations || 0, allocationStateChange: false, reviewedToday: false };
      if (observation.missing) return unavailable(ctx.day, observation.missing, metadata);
      if (!observation.available) {
        if (lastReview !== ctx.day.slice(0, 7)) lastReviewAttemptDay = ctx.day;
        lastReview = ctx.day.slice(0, 7);
        return unavailable(ctx.day, 'USD/TQQQ不足505个共同实际收盘，尚不能计算504日相对收益；保持原比例', metadata, true);
      }
      // Only cash settled from these two legs participates; other assets and idle cash are excluded.
      const available = Math.max(0, sum(ctx.cashByLeg)), pool = sum(ctx.marks) + available;
      if (finish) {
        finish = false;
        const gaps = shares.map((w, k) => Math.max(0, w * pool - ctx.marks[k])), total = sum(gaps);
        if (available > EPS && total > 0) {
          publish(ctx.day, { ...metadata, phase: 'cash-completion' });
          return answer([0, 0], gaps.map(g => available / (1 + ctx.fee) * g / total), { allocationStateChange: false });
        }
      }
      const month = ctx.day.slice(0, 7);
      if (month === lastReview) { publish(ctx.day, metadata); return null; }
      lastReview = month;
      lastReviewDay = lastReviewAttemptDay = ctx.day;
      const phase = (+ctx.day.slice(5, 7) - 1) % 3, band = Math.log1p(.25);
      if (observation.value > band) leaders[phase] = 0;
      else if (observation.value < -band) leaders[phase] = 1;
      phaseReviews[phase] = { day: ctx.day, sourceDay: observation.day, ratio: Math.exp(observation.value), leader: leaders[phase] };
      const next = [0, 1].map(k => sum(leaders.map(leader => leader === null ? originalShares[k] : leader === k ? 1 : 0)) / 3);
      const changed = next.some((w, k) => Math.abs(w - shares[k]) >= 1e-12);
      shares = next;
      if (changed) { changes++; finish = true; }
      publish(ctx.day, { ...metadata, phase, leaders: leaders.slice(), reviewedToday: true, allocationStateChange: changed });
      if (!changed) return null;
      const targets = shares.map(w => w * pool), gaps = targets.map((t, k) => Math.max(0, t - ctx.marks[k]));
      const total = sum(gaps), budget = Math.min(available / (1 + ctx.fee), total / (1 + ctx.fee));
      return answer(targets.map((t, k) => ctx.marks[k] > t + EPS ? (ctx.marks[k] - t) / ctx.marks[k] : 0),
        total > EPS ? gaps.map(g => budget * g / total) : [0, 0], { allocationStateChange: true });
    }
    return { step, state: () => copy(current) };
  }
  return { create, opportunityDefinitions: Opportunity?.definitions || {} };
});
