# 组合模拟 Risk Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 组合模拟 a 风险 result tab, a market-value drawdown, a 一次性投入 baseline in 多策略对比, and the same content in the PDF report.

**Architecture:** Three pure additions to `assets/portfolio-model.js` (`riskAnalysis`, `riskRatios`, `holdingCorrelation`) read the finished daily ledger; one new ledger field (`grossNav`) is the only change inside the simulation loop. The page, the comparison view and the PDF each render those results and compute nothing themselves.

**Tech Stack:** Plain browser JavaScript (UMD modules, no build step), `node:test` for tests, hand-written CSS in `assets/style.css`.

Spec: `docs/superpowers/specs/2026-11-15-portfolio-risk-readout-design.md`.

## Global Constraints

- No existing output field may change value. `comparisonMethods` and `comparison.strategies` keep exactly ten rows.
- The four-number result summary and the `sqrt(250)` volatility convention are not touched.
- Missing values show their reason (`不足一年`, `未出现回撤`, `波动为零`), never 0.
- Interface copy is short Chinese labels; formulas and caveats go in `docs/portfolio-method.md`, not on the page.
- Under-water tolerance is relative `1e-12`; correlation needs at least 26 weekly returns; zero spread is `<= 1e-12`.
- Every commit that touches a file under `assets/` runs `npm run version-assets` so `index.html` hashes match (`npm run check` enforces it).
- One independent change per commit. Before each push: `git fetch origin && git rebase origin/main`. Never force-push.
- Commit messages are plain English sentences and end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Full verification before each commit: `npm test` and `npm run check`.

## File Structure

| File | Change |
| --- | --- |
| `assets/portfolio-model.js` | `grossNav` on curve rows; `riskAnalysis`, `riskRatios`, `holdingCorrelation`; `baseline` from `simulateStrategies` |
| `assets/portfolio.js` | 风险 result tab; baseline legend toggle |
| `assets/portfolio-comparison.js` | baseline row, three columns, chart line, CSV columns |
| `assets/portfolio-pdf.js` | 风险分析 section; `correlation` captured in `snapshot` |
| `assets/style.css` | risk grid, risk tables, comparison baseline row |
| `tests/portfolio-risk.test.cjs` | new: model tests |
| `tests/portfolio-comparison.test.cjs`, `tests/portfolio-pdf.test.cjs` | added cases |
| `docs/portfolio-method.md` | 风险分析 section; comparison and PDF paragraphs; validation record |
| `index.html` | regenerated asset hashes |

---

### Task 1: Risk analysis in the model

**Files:**
- Modify: `assets/portfolio-model.js` (state near line 576, `deposit` near 672, curve push near 917, `chartSources.set` near 969, new functions before `strategyStatus` near 982, exports near 1172)
- Create: `tests/portfolio-risk.test.cjs`
- Modify: `docs/portfolio-method.md` (new section before `## 长 PDF 导出`)

**Interfaces:**
- Produces: `curve[i].grossNav: number`.
- Produces: `P.riskRatios(result) → { fullYear: boolean, drawdown: Ratio, volatility: Ratio }` where `Ratio = { value: number|null, missing: string|null }`.
- Produces: `P.riskAnalysis(result) → null | { fullYear, volatility, returnToDrawdown: Ratio, returnToVolatility: Ratio, maxDrawdown: Episode|null, marketDrawdown: { depth, peakDay, troughDay }|null, longestDrawdown: Episode|null, currentDrawdown: number, drawdowns: Episode[], episodes: number, principal: { deepestLoss, deepestLossDay, longestBelow, endingBelow, episodes } }` where `Episode = { peakDay, troughDay, recoveryDay|null, recovered, depth, declineDays, recoveryDays|null, totalDays }` and a below-principal episode is `{ start, end, recovered, days }`.
- Produces: `P.holdingCorrelation(result) → null | { missing: string } | { ids, codes, matrix: (number|null)[][], observations, first, last }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/portfolio-risk.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/portfolio-model.js');

const day = i => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function history(asset, values, days) {
  return { schemaVersion: 1, id: asset.id, currency: asset.currency, basis: 'provider_adjusted_close', dividends: 'reinvested',
    first: days[0], asOf: days.at(-1), series: values.map((value, i) => [days[i], value]),
    dividendEvidence: { status: 'recorded', first: days[0], through: days.at(-1), fractions: {} } };
}
// Each spec is one asset priced on consecutive calendar days from 2024-01-01, a Monday.
function account(specs, config = {}, fxValues) {
  const days = specs[0].values.map((_, i) => day(i));
  const assets = specs.map((spec, i) => ({ id: 'stock:' + 'ABCD'[i], code: 'ABCD'[i], name: '资产' + 'ABCD'[i], kind: 'stock',
    currency: spec.currency || 'CNY', status: 'available' }));
  const fx = { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' };
  return { catalog: { assets, fx }, histories: Object.fromEntries(assets.map((asset, i) => [asset.id, history(asset, specs[i].values, days)])),
    fxHistory: history(fx, fxValues || days.map(() => 7), days),
    config: { positions: assets.map(asset => ({ id: asset.id, weight: 100 / assets.length })), initial: 1000, monthly: 0, years: 'common',
      rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...config } };
}
const run = (...args) => { const result = P.simulate(account(...args)); assert.equal(result.error, undefined); return result; };

test('drawdown episodes record peak, trough, recovery and an episode still open at the end', () => {
  const r = run([{ values: [100, 110, 99, 104.5, 110, 121, 96.8] }]), risk = P.riskAnalysis(r);
  assert.equal(risk.episodes, 2);
  const [deepest, earlier] = risk.drawdowns;
  assert.deepEqual([deepest.peakDay, deepest.troughDay, deepest.recoveryDay, deepest.recovered], [day(5), day(6), null, false]);
  close(deepest.depth, -20);
  assert.deepEqual([deepest.declineDays, deepest.recoveryDays, deepest.totalDays], [1, null, 1]);
  assert.deepEqual([earlier.peakDay, earlier.troughDay, earlier.recoveryDay, earlier.recovered], [day(1), day(2), day(4), true]);
  close(earlier.depth, -10);
  assert.deepEqual([earlier.declineDays, earlier.recoveryDays, earlier.totalDays], [1, 2, 3]);
  assert.strictEqual(risk.maxDrawdown, deepest);
  assert.strictEqual(risk.longestDrawdown, earlier);
  close(risk.maxDrawdown.depth, r.mdd); close(risk.currentDrawdown, -20);
  assert.equal(risk.marketDrawdown, null);
  assert.deepEqual(risk.returnToDrawdown, { value: null, missing: '不足一年' });
  assert.deepEqual(risk.returnToVolatility, { value: null, missing: '不足一年' });
});

test('an opening trading fee starts an episode on the start day', () => {
  const r = run([{ values: [100, 100, 103] }], { transactionFee: 1 }), risk = P.riskAnalysis(r);
  const [episode] = risk.drawdowns;
  assert.deepEqual([episode.peakDay, episode.troughDay, episode.recoveryDay], [day(0), day(0), day(2)]);
  close(episode.depth, (1 / 1.01 - 1) * 100);
  assert.deepEqual([episode.declineDays, episode.recoveryDays, episode.totalDays], [0, 2, 2]);
  close(risk.principal.deepestLoss, (1 / 1.01 - 1) * 100); assert.equal(risk.principal.deepestLossDay, day(0));
  assert.deepEqual(risk.principal.longestBelow, { start: day(0), end: day(2), recovered: true, days: 2 });
  assert.equal(risk.principal.endingBelow, null);
});

test('the deepest episode equals the ledger maximum drawdown for every ordinary funding method', () => {
  const values = Array.from({ length: 900 }, (_, i) => 100 * Math.exp(i * .0004) * (1 + .2 * Math.sin(i / 37)));
  for (const initialMethod of ['lump_sum', 'tranche_12', 'drawdown_ladder', 'ma200_hold']) {
    const r = run([{ values }], { initialMethod, monthly: 300, contributionMethod: 'dca_drawdown', rebalance: 'quarter', transactionFee: .1,
      tax: { cnStockCapitalGains: 20 } }), risk = P.riskAnalysis(r);
    close(risk.maxDrawdown.depth, r.mdd);
    assert.ok(risk.drawdowns.length <= 5 && risk.drawdowns.length <= risk.episodes, initialMethod);
    assert.ok(risk.drawdowns.every((e, i, all) => !i || all[i - 1].depth <= e.depth), initialMethod);
    assert.ok(risk.longestDrawdown.totalDays >= Math.max(...risk.drawdowns.map(e => e.totalDays)), initialMethod);
    close(risk.currentDrawdown, r.curve.at(-1).drawdown, 1e-12);
  }
});

test('loss against contributed capital differs from the cash-flow-neutral drawdown', () => {
  const price = d => d < '2024-02-01' ? 100 : d < '2024-03-01' ? 50 : 100;
  const values = Array.from({ length: 65 }, (_, i) => price(day(i)));   // 2024-01-01 … 2024-03-05
  const risk = P.riskAnalysis(run([{ values }], { monthly: 1000 }));
  close(risk.principal.deepestLoss, -25); assert.equal(risk.principal.deepestLossDay, '2024-02-01');
  assert.deepEqual(risk.principal.longestBelow, { start: '2024-02-01', end: '2024-03-01', recovered: true, days: 29 });
  assert.equal(risk.principal.endingBelow, null);
  const [episode] = risk.drawdowns;
  close(episode.depth, -50);
  assert.deepEqual([episode.peakDay, episode.troughDay, episode.recoveryDay], ['2024-01-31', '2024-02-01', '2024-03-01']);
  assert.deepEqual([episode.declineDays, episode.recoveryDays, episode.totalDays], [1, 29, 30]);

  const open = P.riskAnalysis(run([{ values: values.map((_, i) => day(i) < '2024-02-01' ? 100 : 50) }], { monthly: 1000 })).principal;
  close(open.deepestLoss, -25); assert.equal(open.deepestLossDay, '2024-02-01');
  assert.deepEqual(open.longestBelow, { start: '2024-02-01', end: '2024-03-05', recovered: false, days: 33 });
  assert.strictEqual(open.endingBelow, open.longestBelow);
});

test('risk ratios need a full year and name what is missing', () => {
  const values = Array.from({ length: 400 }, (_, i) => i < 200 ? 100 + i * .1 : i < 250 ? 119.9 - (i - 199) * .4 : 99.9 + (i - 249) * .2);
  const r = run([{ values }]), risk = P.riskAnalysis(r);
  close(r.mdd, (99.9 / 119.9 - 1) * 100);
  assert.equal(risk.fullYear, true);
  close(risk.returnToDrawdown.value, r.annualReturn / -r.mdd); assert.equal(risk.returnToDrawdown.missing, null);
  close(risk.returnToVolatility.value, r.annualReturn / r.volatility); assert.equal(risk.returnToVolatility.missing, null);
  assert.deepEqual(P.riskRatios(r), { fullYear: true, drawdown: risk.returnToDrawdown, volatility: risk.returnToVolatility });

  const rising = P.riskAnalysis(run([{ values: Array.from({ length: 400 }, (_, i) => 100 + i) }]));
  assert.deepEqual(rising.returnToDrawdown, { value: null, missing: '未出现回撤' });
  assert.ok(rising.returnToVolatility.value > 0);
  assert.equal(rising.maxDrawdown, null); assert.equal(rising.longestDrawdown, null);
  assert.deepEqual(rising.drawdowns, []); assert.equal(rising.currentDrawdown, 0);
  assert.equal(P.riskAnalysis({ error: '缺历史' }), null);
});

test('market-value NAV equals the after-reserve NAV without gains tax and stays neutral to deposits with it', () => {
  const values = Array.from({ length: 400 }, (_, i) => 100 * (1 + .3 * Math.sin(i / 23)) + i * .05);
  const untaxed = run([{ values }], { monthly: 200, rebalance: 'month', transactionFee: .2 });
  assert.ok(untaxed.curve.every(p => p.grossNav === p.nav));
  assert.equal(P.riskAnalysis(untaxed).marketDrawdown, null);

  const taxed = run([{ values: [100, 200, 100] }], { tax: { cnStockCapitalGains: 20 } }), risk = P.riskAnalysis(taxed);
  assert.deepEqual(taxed.curve.map(p => p.nav), [1, 1.8, 1]);
  assert.deepEqual(taxed.curve.map(p => p.grossNav), [1, 2, 1]);
  close(risk.maxDrawdown.depth, (1 / 1.8 - 1) * 100);
  assert.deepEqual(risk.marketDrawdown, { depth: -50, peakDay: day(1), troughDay: day(2) });

  const price = d => d < '2024-02-01' ? 100 : 200;
  const funded = run([{ values: Array.from({ length: 65 }, (_, i) => price(day(i))) }], { monthly: 1000, tax: { cnStockCapitalGains: 20 } });
  const at = d => funded.curve.find(p => p.day === d);
  close(at('2024-02-29').grossNav, 2); close(at('2024-03-01').grossNav, 2);
  close(at('2024-02-29').nav, 1.8); close(at('2024-03-01').nav, 1.8);
  assert.ok(at('2024-03-01').contributed > at('2024-02-29').contributed);
});

const weekly = k => ((k * 37) % 11 - 5) / 100;   // −5% … +5%, one step each Monday
function weeklyPath(weeks, sign = 1, base = 100) {
  const values = []; let price = base;
  for (let k = 0; k < weeks; k++) { price *= 1 + sign * weekly(k); for (let d = 0; d < 7; d++) values.push(price); }
  return values;
}

test('holding correlation uses the last common day of each week and names a short sample', () => {
  const weeks = 30, flat = Array.from({ length: weeks * 7 }, () => 50);
  const r = run([{ values: weeklyPath(weeks) }, { values: weeklyPath(weeks, 1, 20) }, { values: weeklyPath(weeks, -1) }, { values: flat }]);
  const c = P.holdingCorrelation(r);
  assert.deepEqual(c.codes, ['A', 'B', 'C', 'D']); assert.deepEqual(c.ids, r.holdings.map(h => h.id));
  assert.equal(c.observations, weeks - 1); assert.equal(c.first, day(6)); assert.equal(c.last, day(weeks * 7 - 1));
  close(c.matrix[0][1], 1); close(c.matrix[1][0], 1); close(c.matrix[0][2], -1); close(c.matrix[2][1], -1);
  assert.deepEqual([c.matrix[0][0], c.matrix[1][1], c.matrix[2][2]], [1, 1, 1]);
  assert.deepEqual(c.matrix[3], [null, null, null, null]); assert.equal(c.matrix[0][3], null);

  assert.deepEqual(P.holdingCorrelation(run([{ values: weeklyPath(26) }, { values: weeklyPath(26, -1) }])), { missing: '共同周收益仅 25 个，少于 26 个' });
  assert.equal(P.holdingCorrelation(run([{ values: weeklyPath(weeks) }])), null);
  assert.equal(P.holdingCorrelation(JSON.parse(JSON.stringify(r))), null, 'a JSON copy has no live price source');
});

test('a foreign holding is correlated on converted prices, not on its native price', () => {
  const weeks = 30, specs = [{ values: weeklyPath(weeks) }, { values: Array.from({ length: weeks * 7 }, () => 10), currency: 'USD' }];
  const fx = weeklyPath(weeks, 1, 7);
  close(P.holdingCorrelation(run(specs, { currency: 'CNY' }, fx)).matrix[0][1], 1);   // a flat USD price follows the exchange rate in CNY
  const usd = P.holdingCorrelation(run(specs, { currency: 'USD' }, fx));
  assert.equal(usd.matrix[1][1], null);   // and does not move in USD
  assert.equal(usd.matrix[0][1], null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/portfolio-risk.test.cjs`
Expected: all 8 tests FAIL, the first with `P.riskAnalysis is not a function`.

- [ ] **Step 3: Add the market-value NAV to the ledger**

In `assets/portfolio-model.js`, inside `run`:

Change the state line
```js
    let cash = 0, contributed = 0, fundUnits = 0, tradeCost = 0, rebalances = 0, deposits = 0;
```
to
```js
    let cash = 0, contributed = 0, fundUnits = 0, grossUnits = 0, tradeCost = 0, rebalances = 0, deposits = 0;
```

Replace `deposit` with
```js
    function deposit(day, amount, prices) {
      if (!amount) return;
      const before = netValue(prices), nav = fundUnits ? before / fundUnits : 1;
      if (!finite(nav) || nav <= 0) fail('组合净值无效');
      fundUnits += amount / nav;
      // Market value before the unrealised reserve keeps its own units, so a
      // deposit is return-neutral on that series too.
      grossUnits += amount / (grossUnits ? value(prices) / grossUnits : 1);
      cash += amount; contributed += amount; deposits++;
      flows.push([day, -amount]);
    }
```

In the `curve.push({ ... })` call, change
```js
        grossValue: value(prices), taxReserve, paidTax, taxCost: paidTax + taxReserve,
```
to
```js
        grossValue: value(prices), grossNav: value(prices) / grossUnits, taxReserve, paidTax, taxCost: paidTax + taxReserve,
```

- [ ] **Step 4: Keep the run's prices reachable for correlation**

Change the `chartSources.set(result, { days: strategyDays, referenceHistory,` line so the object also carries the price reader:
```js
    chartSources.set(result, { days: strategyDays, referenceHistory, prices: day => pricesAt(day).map(p => p.value),
```
(the rest of that statement is unchanged).

- [ ] **Step 5: Add the risk functions**

Insert immediately before `function strategyStatus(result, day = result?.end) {`:

```js
  // Episodes below a running peak. The opening base counts, so a first-day
  // trading fee starts an episode on the start day, as the ledger's own
  // maximum drawdown already does.
  function drawdownEpisodes(rows, base = 1) {
    const open = [];
    if (!rows.length) return open;
    let peak = base, peakDay = rows[0][0], active = null;
    for (const [day, value] of rows) {
      if (value < peak * (1 - 1e-12)) {
        if (!active) { active = { peakDay, peak, trough: value, troughDay: day, recoveryDay: null }; open.push(active); }
        else if (value < active.trough) { active.trough = value; active.troughDay = day; }
      } else {
        if (active) { active.recoveryDay = day; active = null; }
        peak = Math.max(peak, value); peakDay = day;
      }
    }
    const end = rows.at(-1)[0];
    return open.map(e => {
      const recovered = e.recoveryDay !== null;
      return { peakDay: e.peakDay, troughDay: e.troughDay, recoveryDay: e.recoveryDay, recovered, depth: (e.trough / e.peak - 1) * 100,
        declineDays: gap(e.peakDay, e.troughDay), recoveryDays: recovered ? gap(e.troughDay, e.recoveryDay) : null,
        totalDays: gap(e.peakDay, recovered ? e.recoveryDay : end) };
    });
  }
  // After-reserve account value against contributed capital, as 持有期研究 does.
  function principalRisk(curve) {
    const spells = [];
    let deepestLoss = 0, deepestLossDay = null, active = null;
    for (const p of curve) {
      if (!(p.contributed > 0)) continue;
      const below = p.value < p.contributed * (1 - 1e-12), loss = (p.value / p.contributed - 1) * 100;
      if (below && loss < deepestLoss) { deepestLoss = loss; deepestLossDay = p.day; }
      if (below && !active) { active = { start: p.day, end: null, recovered: false }; spells.push(active); }
      else if (!below && active) { active.end = p.day; active.recovered = true; active = null; }
    }
    for (const spell of spells) { if (spell.end === null) spell.end = curve.at(-1).day; spell.days = gap(spell.start, spell.end); }
    return { deepestLoss, deepestLossDay, longestBelow: spells.reduce((best, e) => !best || e.days > best.days ? e : best, null),
      endingBelow: spells.find(e => !e.recovered) || null, episodes: spells.length };
  }
  function riskRatios(result) {
    const fullYear = result.end >= addYears(result.start, 1);
    const ratio = (denominator, zero) => !fullYear ? { value: null, missing: '不足一年' } :
      !(denominator > 0) ? { value: null, missing: zero } : { value: result.annualReturn / denominator, missing: null };
    return { fullYear, drawdown: ratio(-result.mdd, '未出现回撤'), volatility: ratio(result.volatility, '波动为零') };
  }
  function riskAnalysis(result) {
    if (!result?.curve?.length) return null;
    const episodes = drawdownEpisodes(result.curve.map(p => [p.day, p.nav]));
    const byDepth = episodes.slice().sort((a, b) => a.depth - b.depth || a.peakDay.localeCompare(b.peakDay));
    const longest = episodes.reduce((best, e) => !best || e.totalDays > best.totalDays ||
      e.totalDays === best.totalDays && e.depth < best.depth ? e : best, null);
    const taxed = result.holdings.some(h => h.taxRates?.gain > 0) && result.curve.every(p => finite(p.grossNav));
    const market = taxed ? drawdownEpisodes(result.curve.map(p => [p.day, p.grossNav])).reduce((best, e) => !best || e.depth < best.depth ? e : best, null) : null;
    const ratios = riskRatios(result);
    return { fullYear: ratios.fullYear, volatility: result.volatility, returnToDrawdown: ratios.drawdown, returnToVolatility: ratios.volatility,
      maxDrawdown: byDepth[0] || null, marketDrawdown: market ? { depth: market.depth, peakDay: market.peakDay, troughDay: market.troughDay } : null,
      longestDrawdown: longest, currentDrawdown: result.curve.at(-1).drawdown, drawdowns: byDepth.slice(0, 5), episodes: episodes.length,
      principal: principalRisk(result.curve) };
  }
  // Weekly, because A-share and US closes are not simultaneous and daily
  // figures read too low. Prices are the run's own converted total-return quotes.
  function holdingCorrelation(result) {
    const source = result ? chartSources.get(result) : null;
    if (!source?.prices || result.holdings.length < 2) return null;
    const week = day => time(day) - (new Date(time(day)).getUTCDay() + 6) % 7 * DAY;
    const days = source.days.filter((day, i, all) => i === all.length - 1 || week(all[i + 1]) !== week(day));
    const observations = Math.max(0, days.length - 1);
    if (observations < 26) return { missing: '共同周收益仅 ' + observations + ' 个，少于 26 个' };
    const prices = days.map(source.prices);
    const centred = result.holdings.map((_, k) => {
      const returns = prices.slice(1).map((row, i) => row[k] / prices[i][k] - 1), mean = sum(returns) / returns.length;
      return returns.map(value => value - mean);
    });
    const spread = centred.map(values => Math.sqrt(sum(values.map(v => v * v))));
    const moving = i => spread[i] > 1e-12;
    const matrix = centred.map((a, i) => centred.map((b, j) => !moving(i) || !moving(j) ? null : i === j ? 1 :
      Math.max(-1, Math.min(1, sum(a.map((v, n) => v * b[n])) / (spread[i] * spread[j])))));
    return { ids: result.holdings.map(h => h.id), codes: result.holdings.map(h => h.code), matrix, observations, first: days[0], last: days.at(-1) };
  }
```

Add the three public names to the returned object at the end of the file: change `strategyStatus, comparisonMethods,` to `strategyStatus, riskAnalysis, riskRatios, holdingCorrelation, comparisonMethods,`.

- [ ] **Step 6: Run the new tests and confirm they pass**

Run: `node --test tests/portfolio-risk.test.cjs`
Expected: `pass 8`, `fail 0`.

- [ ] **Step 7: Recompute the readout independently**

Extend the audit ledger at `<scratchpad>/audit/independent.py` (outside the repository) so `simulate` also records `contributed` per day and a separately unitised market-value NAV, then compute episodes, principal figures and weekly correlation with code that shares nothing with the model. Compare against `P.riskAnalysis` and `P.holdingCorrelation` for:

1. USD 30 / TQQQ 30 / 现金 40, CNY, 100,000 lump sum, fee 0.10%, tax 20/20, 10 years.
2. SPY 50 / QQQ 30 / TLT 20, USD, 100,000 + 2,000 monthly, quarterly rebalance, fee 0.10%, tax 20/20, 10 years.
3. 510300 50 / SPY 50, CNY, 3 years, quarterly rebalance, no tax.

Expected: every date identical; every depth, loss, day count and correlation equal within `1e-7` relative. Note the market-value drawdown printed for case 1: it is quoted in the method doc in Step 8.

- [ ] **Step 8: Document the method**

In `docs/portfolio-method.md`, insert this section immediately before `## 长 PDF 导出`, replacing `<市值回撤>` with the figure printed for case 1 in Step 7:

```markdown
## 风险分析（2026-11-15新增）

模拟结果的“风险”子页签只读取本次模拟已经生成的逐日账本，不重新回测，也不改变收益、回撤或波动的既有数值。

### 回撤区间

使用现金流中性、已减浮盈预留税的组合净值，峰值从起始日的 1 开始，因此首笔交易费计入回撤，与摘要的最大回撤同一口径。净值低于此前峰值即进入回撤；峰值日取净值最近一次达到峰值的日期，低点日取区间内最低净值的最早日期，净值回到峰值的首个估值日为修复日。期末仍未回到峰值的区间标为尚未修复，总历时算到模拟结束日。历时均为日历天数。

```
回撤幅度 = 低点净值 / 峰值净值 − 1
下跌历时 = 低点日 − 峰值日
修复历时 = 修复日 − 低点日
总历时 = 修复日（未修复时为结束日）− 峰值日
```

“前5次回撤”按幅度从深到浅排列；最深一次即最大回撤，“最长回撤期”取总历时最长的一次，二者可以不是同一次。

### 市值口径回撤

设有卖出盈利税时，税后净值的回撤被浮盈预留税缓冲：上涨时预留增加，下跌时预留减少。券商账户显示的是未减预留的市值，所以另列市值口径最大回撤。逐日账本为未减预留的账户市值单独维护一套份额，每笔外部入金按入金前的市值净值增发，`grossNav = 未减预留的资产 / 市值份额`；已实际缴纳的卖出盈利税、分红税和交易费仍然计入，只有尚未实现的预留不扣。所有持仓盈利税率为 0 时两条净值逐日相同，界面不重复显示。

例：10 万元一次性买入，USD ETF 30%／TQQQ 30%／现金 40%，人民币计价，单侧费 0.10%，盈利与股息税各 20%，2016-11-11 至 2026-11-13：税后净值最大回撤 −70.98%，市值口径 <市值回撤>。

### 收益与风险之比

```
收益回撤比 = 组合年化收益 / |最大回撤|
收益波动比 = 组合年化收益 / 年化波动
```

两项都使用现金流中性的组合年化收益。模拟不足一个日历周年时不计算，显示“不足一年”；未出现回撤或波动为零时显示对应原因，不以 0 代替。收益波动比没有扣除无风险利率，不称为夏普比率。年化波动沿用相邻估值日净值收益样本标准差乘 `sqrt(250)` 的既有约定。

### 相对本金

与持有期研究使用相同的名称和规则，按税后估值和累计投入本金比较：

```
相对本金最深亏损 = min(0, min(税后估值 / 累计投入本金 − 1))
```

估值低于累计投入本金的首个估值日为一段的开始，回到本金或以上的首个估值日为结束；期末仍低于本金的一段算到模拟结束日并标明未恢复。“最长连续低于本金”取日历天数最多的一段。持续投入的账户里，净值回撤与本金亏损可以相差很大：净值回撤不受入金影响，本金亏损会被低位买入摊薄。

### 持仓相关性

两只及以上正权重持仓时显示。价格使用各标的含分红历史并按所选币种换算（与账本相同的汇率规则），不含投资者税、交易费和现金分红的除息调整，衡量的是资产本身的同涨同跌。

取区间内每个自然周（周一至周日）最后一个共同交易日的价格，计算相邻两次取样之间的简单收益，再求皮尔逊相关系数。采用周收益是因为 A 股与美股收盘不同时，日收益会低估跨市场相关性。某周没有共同交易日时跳过该周，下一段收益对所有持仓同样跨越该周。共同周收益少于 26 个时不计算并说明数量；价格没有波动的持仓显示“—”。相关系数描述这段历史，不代表未来。
```

- [ ] **Step 9: Full verification**

Run: `npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -3`
Expected: `fail 0`; the check ends with `资源版本一致`.

- [ ] **Step 10: Commit and push**

```bash
git add assets/portfolio-model.js tests/portfolio-risk.test.cjs docs/portfolio-method.md index.html
git commit -m "Add drawdown episodes, principal risk and holding correlation to the portfolio model"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 2: 风险 result tab

**Files:**
- Modify: `assets/portfolio.js` (`resultSections` near line 1153; new functions before it)
- Modify: `assets/style.css` (after the `.portfolio-year-grid small` rule near line 927)
- Modify: `tests/portfolio-pdf.test.cjs` (new test after `result tabs keep the run and global tools visible…`; its `sections` map)

**Interfaces:**
- Consumes: `P.riskAnalysis(result)`, `P.holdingCorrelation(result)` from Task 1.
- Produces: result sub-tab id `risk`, label `风险`, headings `过程风险`, `相对本金`, `前5次回撤`, `持仓相关性`.

- [ ] **Step 1: Write the failing tests**

In `tests/portfolio-pdf.test.cjs`, in the test `result tabs keep the run and global tools visible while isolating each section and its export`, change
```js
  const sections = { chart: ['组合走势'], periods: ['区间快照', '年度表现'], holdings: ['持仓贡献'] };
```
to
```js
  const sections = { chart: ['组合走势'], periods: ['区间快照', '年度表现'], risk: ['过程风险', '相对本金', '前5次回撤', '持仓相关性'], holdings: ['持仓贡献'] };
```

Add after that test:
```js
test('risk tab shows the model’s episodes, principal risk and correlation without recomputing them', async () => {
  const runs = [];
  const f = uiFixture(input => {
    Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0, tax: { ...P.taxConfig(), cnStockCapitalGains: 20 } });
    for (const h of Object.values(input.histories)) h.dividendEvidence = { status: 'recorded', first: h.first, through: h.asOf, fractions: {} };
  }, { ...P, simulate(input) { const result = P.simulate(input); runs.push(result); return result; } });
  await f.action('run');
  const html = await f.resultTab('risk'), risk = P.riskAnalysis(runs[0]), c = P.holdingCorrelation(runs[0]);
  assert.ok(risk.maxDrawdown && risk.marketDrawdown && c.matrix, 'fixture must exercise every card');
  for (const label of ['年化波动', '收益回撤比', '收益波动比', '最大回撤', '最长回撤期', '当前回撤', '相对本金最深亏损', '最长连续低于本金']) assert.ok(html.includes('<span>' + label + '</span>'), label);
  assert.ok(html.includes('峰值 ' + risk.maxDrawdown.peakDay + ' · 低点 ' + risk.maxDrawdown.troughDay));
  assert.ok(html.includes('市值口径 ' + String(risk.marketDrawdown.depth) + '（未减浮盈预留税）'));
  assert.ok(html.includes(risk.returnToDrawdown.value.toFixed(2)) && html.includes(risk.returnToVolatility.value.toFixed(2)));
  const table = html.split('<h2>前5次回撤</h2>')[1].split('</section>')[0];
  assert.equal(table.split('<tr><td>').length - 1, risk.drawdowns.length);
  for (const e of risk.drawdowns) assert.ok(table.includes('<td>' + e.peakDay + '</td><td>' + e.troughDay + '</td>'), e.peakDay);
  const matrix = html.split('<h2>持仓相关性</h2>')[1].split('</section>')[0];
  assert.ok(matrix.includes('周收益 ' + c.observations + '个') && matrix.includes(c.first + ' — ' + c.last));
  assert.ok(matrix.includes('>' + c.matrix[0][1].toFixed(2) + '</td>'));
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('risk tab hides correlation for one holding and the market-value line without gains tax', async () => {
  const f = uiFixture(input => {
    Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0, tax: P.taxConfig() });
    input.config.positions[1].weight = 0;
  });
  await f.action('run');
  const html = await f.resultTab('risk');
  assert.ok(html.includes('<h2>过程风险</h2>') && html.includes('<h2>前5次回撤</h2>'));
  assert.doesNotMatch(html, /持仓相关性|市值口径/);
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | grep -E "^not ok|risk tab|No visible result tab" | head`
Expected: the two new tests and the `result tabs keep…` test fail with `No visible result tab: risk`.

- [ ] **Step 3: Render the tab**

In `assets/portfolio.js`, insert immediately before `function resultSections(r) {`:

```js
  const riskViews = new WeakMap();
  function riskOf(r) {
    if (!riskViews.has(r)) riskViews.set(r, { risk: P.riskAnalysis(r), correlation: P.holdingCorrelation(r) });
    return riskViews.get(r);
  }
  function riskCards(r) {
    const { risk, correlation } = riskOf(r);
    if (!risk) return '';
    const days = n => n + '天', span = (from, to) => from + ' — ' + to;
    const ratio = item => item.value === null ? '<span class="muted">' + H.esc(item.missing) + '</span>' : item.value.toFixed(2);
    const cell = (label, value, notes = []) => '<div><span>' + label + '</span><strong class="num">' + value + '</strong>' +
      notes.filter(Boolean).map(note => '<small>' + H.esc(note) + '</small>').join('') + '</div>';
    const max = risk.maxDrawdown, longest = risk.longestDrawdown, principal = risk.principal, below = principal.longestBelow;
    const process = '<div class="portfolio-year-grid portfolio-risk-grid">' +
      cell('年化波动', H.pct(risk.volatility, 2, false)) +
      cell('收益回撤比', ratio(risk.returnToDrawdown), ['年化收益 ÷ 最大回撤']) +
      cell('收益波动比', ratio(risk.returnToVolatility), ['未扣无风险利率']) +
      cell('最大回撤', H.pc(max ? max.depth : 0), max ? ['峰值 ' + max.peakDay + ' · 低点 ' + max.troughDay,
        risk.marketDrawdown ? '市值口径 ' + H.pct(risk.marketDrawdown.depth, 2, false) + '（未减浮盈预留税）' : ''] : ['区间内未出现回撤']) +
      cell('最长回撤期', days(longest ? longest.totalDays : 0), longest ? [span(longest.peakDay, longest.recoveryDay || r.end), longest.recovered ? '已修复' : '期末仍未修复'] : []) +
      cell('当前回撤', H.pc(risk.currentDrawdown), risk.currentDrawdown < 0 ? [] : ['期末处于净值高点']) + '</div>';
    const relative = '<div class="portfolio-year-grid portfolio-risk-grid">' +
      cell('相对本金最深亏损', H.pc(principal.deepestLoss), [principal.deepestLossDay || '未跌破本金']) +
      cell('最长连续低于本金', days(below ? below.days : 0), below ? [span(below.start, below.end), below.recovered ? '已恢复' : '期末仍低于本金'] : ['没有估值低于本金']) + '</div>';
    const rows = risk.drawdowns.map(e => '<tr><td>' + e.peakDay + '</td><td>' + e.troughDay + '</td><td class="num">' + H.pc(e.depth) + '</td><td class="num">' + days(e.declineDays) + '</td><td>' +
      (e.recovered ? e.recoveryDay : '<span class="muted">尚未修复</span>') + '</td><td class="num">' + (e.recovered ? days(e.recoveryDays) : '—') + '</td><td class="num">' + days(e.totalDays) + '</td></tr>').join('');
    const episodes = rows ? '<div class="table-wrap" tabindex="0" role="region" aria-label="前5次回撤"><table class="portfolio-risk-table"><thead><tr><th scope="col">峰值日</th><th scope="col">低点日</th><th scope="col">回撤幅度</th><th scope="col">下跌历时</th><th scope="col">修复日</th><th scope="col">修复历时</th><th scope="col">总历时</th></tr></thead><tbody>' + rows + '</tbody></table></div>' :
      '<p class="portfolio-risk-empty">区间内未出现回撤</p>';
    let matrix = '';
    if (correlation?.missing) matrix = H.card('持仓相关性', '', '<p class="portfolio-risk-empty">' + H.esc(correlation.missing) + '，不计算相关性。</p>');
    else if (correlation) {
      const tint = v => v === null ? '' : ' style="background:rgba(' + (v < 0 ? '173,111,120' : '53,101,74') + ',' + (Math.abs(v) * .28).toFixed(3) + ')"';
      matrix = H.card('持仓相关性', '周收益 ' + correlation.observations + '个 · ' + span(correlation.first, correlation.last) + ' · ' + currency(r.config).name + '计价',
        '<div class="table-wrap" tabindex="0" role="region" aria-label="持仓周收益相关系数"><table class="portfolio-correlation-table"><thead><tr><th scope="col"></th>' +
        correlation.codes.map(code => '<th scope="col">' + H.esc(code) + '</th>').join('') + '</tr></thead><tbody>' +
        correlation.matrix.map((row, i) => '<tr><th scope="row">' + H.esc(correlation.codes[i]) + '</th>' +
          row.map(v => '<td class="num"' + tint(v) + '>' + (v === null ? '—' : v.toFixed(2)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
    }
    return H.card('过程风险', '现金流中性净值 · ' + span(r.start, r.end), process) + H.card('相对本金', '税后估值对比累计投入本金', relative) +
      H.card('前5次回撤', '按幅度从深到浅', episodes) + matrix;
  }
```

In `resultSections`, change the last line
```js
    return sections.concat([['periods', '区间表现', () => snapshots() + yearlyResults(r)], ['holdings', '持仓贡献', () => resultHoldings(r)]]);
```
to
```js
    return sections.concat([['periods', '区间表现', () => snapshots() + yearlyResults(r)], ['risk', '风险', () => riskCards(r)], ['holdings', '持仓贡献', () => resultHoldings(r)]]);
```

- [ ] **Step 4: Style it**

In `assets/style.css`, insert after the line beginning `.portfolio-year-grid small{`:

```css
.portfolio-risk-grid{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:26px}
.portfolio-risk-grid small{font-size:12px;color:var(--muted);line-height:1.5}
.portfolio-risk-grid small+small{margin-top:2px}
.portfolio-risk-table{width:100%;min-width:760px}
.portfolio-risk-table th,.portfolio-risk-table td{font-size:13px}
.portfolio-risk-table th:nth-child(3),.portfolio-risk-table th:nth-child(4),.portfolio-risk-table th:nth-child(6),.portfolio-risk-table th:nth-child(7),.portfolio-risk-table td.num{text-align:right}
.portfolio-correlation-table{width:auto;min-width:340px}
.portfolio-correlation-table th,.portfolio-correlation-table td{font-size:13px;text-align:right;padding:11px 18px}
.portfolio-correlation-table tbody th{text-align:left;font-weight:550}
.portfolio-risk-empty{padding:18px 24px 22px;font-size:13px;color:var(--muted)}
@media(max-width:700px){.portfolio-risk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 6: Check it on the local site**

With the site served at `http://127.0.0.1:8765`, open `#portfolio`, run USD 30 / TQQQ 30 / 现金 40 (CNY, 10 years, fee 0.10%, 大陆居民假设) and open 模拟结果 › 风险. Expected: the six 过程风险 figures, both 相对本金 figures, the five table rows and the 2×2 matrix equal the Step 7 figures of Task 1; no console errors; the grid and tables are aligned at 1600 px and 2540 px wide. Adjust only CSS if the layout is off.

- [ ] **Step 7: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -3
git add assets/portfolio.js assets/style.css tests/portfolio-pdf.test.cjs index.html
git commit -m "Show drawdown episodes, principal risk and holding correlation in a risk result tab"
git fetch origin && git rebase origin/main && git push origin main
```
Expected before committing: `fail 0` and `资源版本一致`.

---

### Task 3: 一次性投入 baseline in 多策略对比

**Files:**
- Modify: `assets/portfolio-model.js` (`simulateStrategies` near line 312)
- Modify: `assets/portfolio-comparison.js` (`strategyName`, `performanceTable`, `plot`, `states`, `summaryCsv`)
- Modify: `assets/portfolio.js` (`compare-toggle` case near line 1329)
- Modify: `assets/style.css` (after the `.portfolio-compare-table thead th:first-child{` rule near line 952)
- Modify: `tests/portfolio-comparison.test.cjs`, `tests/portfolio-pdf.test.cjs`
- Modify: `docs/portfolio-method.md` (section `### 多策略并行比较`)

**Interfaces:**
- Consumes: `P.riskRatios(result)` from Task 1.
- Produces: `simulateStrategies(input).baseline → { id: 'lump_sum', label: '一次性投入', result } | { id, label, error } | null` (null only when shared validation fails).

- [ ] **Step 1: Write the failing tests**

Append to `tests/portfolio-comparison.test.cjs`:
```js
test('the comparison carries a lump-sum baseline beside the ten strategies, never among them', () => {
  const input = fixture(), comparison = P.simulateStrategies(input);
  assert.equal(comparison.strategies.length, 10);
  assert.equal(comparison.baseline.id, 'lump_sum'); assert.equal(comparison.baseline.label, '一次性投入');
  assert.deepEqual(comparison.baseline.result, P.simulate({ ...input, config: { ...input.config, initialMethod: 'lump_sum', benchmarkId: '' } }));
  assert.equal(comparison.baseline.result.start, comparison.start); assert.equal(comparison.baseline.result.end, comparison.end);
  const invalid = P.simulateStrategies({ ...input, config: { ...input.config, initial: -1 } });
  assert.equal(invalid.baseline, null);
  const unfunded = fixture({ positions: [{ id: 'us:TQQQ', weight: 30 }] }); delete unfunded.histories['us:TQQQ'];
  const failed = P.simulateStrategies(unfunded).baseline;
  assert.equal(failed.result, undefined); assert.ok(failed.error);
});
```

In `tests/portfolio-pdf.test.cjs`, in the test `advanced strategy comparison loads all rule evidence and displays independent funded results`, add after the line `assert.doesNotMatch(html, /NaN|undefined|本次对比未完成/);`:
```js
  const base = compared.baseline.result;
  assert.ok(base && compared.baseline.id === 'lump_sum');
  for (const heading of ['较一次性投入', '年化波动', '收益回撤比']) assert.ok(html.includes('<th scope="col">' + heading + '</th>'), heading);
  assert.ok(html.indexOf('portfolio-compare-baseline') < html.indexOf(compared.strategies[0].label), 'the baseline row comes first');
  assert.match(html, /portfolio-compare-baseline[\s\S]*?<td class="num">基准<\/td>/);
  assert.ok(html.includes('一次性投入（基准）'), 'the chart legend names the baseline');
  assert.ok(html.includes('data-comparison-line="lump_sum"'));
  const gap = branch10.result.totalReturn - base.totalReturn;
  assert.ok(html.includes((gap > .005 ? '+' : '') + (Math.abs(gap) < .005 ? 0 : gap).toFixed(2) + ' 个百分点'));
  assert.ok(html.includes('不足一年'), 'a run under one year names the missing ratio');
```
and add after the line `assert.equal(Number(shortRow[9]), branch10.result.totalReturn);`:
```js
  // The configuration JSON column contains `","` itself, so the appended columns are read from the end of each line.
  const lines = exported[1].split(/\r?\n/), tail = line => line.split('","').slice(-4).map(cell => cell.replace(/"$/, ''));
  assert.deepEqual(tail(lines[0]), ['年化波动%', '收益回撤比', '较一次性投入年化差（百分点）', '较一次性投入累计差（百分点）']);
  assert.ok(lines[1].startsWith('"lump_sum","一次性投入（基准）","已完成"'));
  const added = tail(lines.find(line => line.startsWith('"opportunity_discount_10",')));
  assert.equal(Number(added[0]), branch10.result.volatility);
  assert.equal(added[1], '', 'no ratio under one year'); assert.equal(added[2], '', 'no annualized difference under one year');
  assert.equal(Number(added[3]), branch10.result.totalReturn - base.totalReturn);
  await f.action('compare-toggle', { value: 'lump_sum' });
  assert.doesNotMatch(f.ui.view(f.helpers), /data-comparison-line="lump_sum"/);
```

- [ ] **Step 2: Run and confirm they fail**

Run: `node --test tests/portfolio-comparison.test.cjs tests/portfolio-pdf.test.cjs 2>&1 | grep -E "^not ok" | head`
Expected: the new comparison test and `advanced strategy comparison loads all rule evidence…` fail.

- [ ] **Step 3: Run the baseline in the model**

In `assets/portfolio-model.js`, replace the body of `simulateStrategies` from `let start = null, end = null;` to its closing `return` with:

```js
    let start = null, end = null;
    const row = (id, label) => {
      const result = simulate({ ...input, config: { ...config, initialMethod: id, benchmarkId: '' } });
      if (result.error) return { id, label, error: result.error, ...(result.errorField ? { errorField: result.errorField } : {}) };
      if (start !== null && (result.start !== start || result.end !== end)) {
        return { id, label, error: '实际回测区间与其他策略不一致，无法按同一区间比较' };
      }
      start = result.start; end = result.end;
      return { id, label, result };
    };
    const strategies = comparisonMethods.map(([id, label]) => row(id, label));
    // The same account bought once and held: the reference every row is read against.
    const baseline = row('lump_sum', '一次性投入');
    return { config: JSON.parse(JSON.stringify(config)), start, end, strategies, baseline };
```
and in the early validation `return` of the same function add `baseline: null,` after `strategies: [],`.

- [ ] **Step 4: Render the baseline row, columns, chart line and CSV**

In `assets/portfolio-comparison.js`:

Add after the `successful` line:
```js
  const BASELINE_COLOR = '#555b50';
  const baselineOf = comparison => { const row = comparison?.baseline; return row?.result && !row.result.error && row.result.curve?.length ? row : null; };
  const rowsOf = comparison => (comparison.baseline ? [comparison.baseline] : []).concat(comparison.strategies);
```

Replace `strategyName` and `performanceTable` with:
```js
  function colorOf(comparison, item) { return item === comparison.baseline ? BASELINE_COLOR : colorFor(comparison.strategies.indexOf(item)); }
  function strategyName(item, color, H) {
    return '<span class="portfolio-compare-name"><i style="background:' + color + '"></i><strong>' + H.esc(item.label) + '</strong></span>';
  }
  function performanceTable(comparison, H) {
    const { unit } = P.currencyInfo(comparison.config), base = baselineOf(comparison)?.result;
    const rows = rowsOf(comparison).map(item => {
      const r = item.result, isBase = item === comparison.baseline, name = strategyName(item, colorOf(comparison, item), H);
      if (!r || r.error) return '<tr class="portfolio-compare-unavailable"><th scope="row">' + name + '</th><td colspan="8"><span class="portfolio-compare-failure">' + H.esc(item.error || r?.error || '未取得本策略结果') + '</span></td></tr>';
      const value = returnValue(r, H.annual), gainClass = value < 0 ? 'negative' : 'positive', profitClass = r.profit < 0 ? 'negative' : 'positive';
      const gap = base && !isBase ? value - returnValue(base, H.annual) : null, ratio = P.riskRatios(r).drawdown;
      const difference = isBase ? '基准' : !finite(gap) ? '—' : (gap > .005 ? '+' : '') + (Math.abs(gap) < .005 ? 0 : gap).toFixed(2) + ' 个百分点';
      return '<tr' + (isBase ? ' class="portfolio-compare-baseline"' : '') + '><th scope="row">' + name + (r.start !== comparison.start || r.end !== comparison.end ? '<span class="portfolio-compare-period">' + H.esc(r.start) + ' 至 ' + H.esc(r.end) + '</span>' : '') + '</th>' +
        '<td class="num">' + amount(r.contributed, H) + '</td><td class="num ' + gainClass + '">' + percent(value, H) + '</td>' +
        '<td class="num' + (!finite(gap) ? '' : gap > .005 ? ' positive' : gap < -.005 ? ' negative' : '') + '">' + difference + '</td>' +
        '<td class="num ' + profitClass + '">' + signedAmount(r.profit, H) + '</td><td class="num">' + percent(r.mdd, H) + '</td><td class="num">' + percent(r.volatility, H) + '</td>' +
        '<td class="num">' + (ratio.value === null ? '<span class="portfolio-compare-missing">' + H.esc(ratio.missing) + '</span>' : ratio.value.toFixed(2)) + '</td><td class="num">' + amount(r.value, H) + '</td></tr>';
    }).join('');
    return '<section class="card portfolio-compare-table-card" aria-label="各策略模拟结果"><div class="table-wrap" role="region" aria-label="策略收益与风险对比" tabindex="0"><table class="portfolio-compare-table"><thead><tr><th scope="col">策略</th><th scope="col">总投入本金 / ' + unit + '</th><th scope="col">' + returnBasis(comparison, H.annual) + '</th><th scope="col">较一次性投入</th><th scope="col">盈亏 / ' + unit + '</th><th scope="col">最大回撤</th><th scope="col">年化波动</th><th scope="col">收益回撤比</th><th scope="col">期末资产 / ' + unit + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }
```

In `plot`, change
```js
    const items = successful(comparison), metric = ['return', 'drawdown', 'amount'].includes(state.metric) ? state.metric : 'return';
```
to
```js
    const items = (baselineOf(comparison) ? [comparison.baseline] : []).concat(successful(comparison)), metric = ['return', 'drawdown', 'amount'].includes(state.metric) ? state.metric : 'return';
```
replace the `legend` definition with
```js
    const legend = items.map(item => {
      const selected = !hidden.has(item.id), label = item === comparison.baseline ? item.label + '（基准）' : item.label;
      return '<label class="portfolio-compare-legend-item' + (selected ? '' : ' is-hidden') + '"><input id="portfolio-compare-toggle-' + H.esc(item.id) + '" type="checkbox" data-action="portfolio-compare-toggle" data-value="' + H.esc(item.id) + '"' + (selected ? ' checked' : '') + ' aria-label="显示' + H.esc(label) + '曲线"><i style="background:' + colorOf(comparison, item) + '"></i><span>' + H.esc(label) + '</span></label>';
    }).join('');
```
and inside `paths`, replace
```js
        const index = comparison.strategies.indexOf(item); let path = '', connected = false;
```
with
```js
        const isBase = item === comparison.baseline, index = comparison.strategies.indexOf(item); let path = '', connected = false;
```
and the `return '<path …'` line with
```js
        return '<path data-comparison-line="' + H.esc(item.id) + '" d="' + path + '" stroke="' + colorOf(comparison, item) + '" stroke-width="2"' + (isBase ? ' stroke-dasharray="2 5"' : index >= 5 ? ' stroke-dasharray="7 3"' : '') + ' fill="none" stroke-linecap="round"><title>' + H.esc(item.label) + '</title></path>';
```

In `states`, change both `strategyName(item, strategyIndex, H)` calls to `strategyName(item, colorFor(strategyIndex), H)`.

Replace `summaryCsv` with:
```js
  function summaryCsv(comparison) {
    const code = P.currencyInfo(comparison.config).code, base = baselineOf(comparison)?.result;
    const rows = [['策略ID', '策略', '模拟状态', '缺项', '实际开始日', '实际结束日', '计价币种', '总投入本金' + code, '组合年化收益%', '组合累计收益%', '税后盈亏' + code, '最大回撤%', '期末账户资产' + code, '期末现金' + code, '资金年化XIRR%', '资金年化缺项', '配置JSON',
      '年化波动%', '收益回撤比', '较一次性投入年化差（百分点）', '较一次性投入累计差（百分点）']];
    for (const item of rowsOf(comparison)) {
      const r = item.result, isBase = item === comparison.baseline, label = isBase ? item.label + '（基准）' : item.label;
      if (!r || r.error) { rows.push([item.id, label, '未完成', item.error || r?.error || '缺结果', '', '', code, '', '', '', '', '', '', '', '', '', JSON.stringify({ ...comparison.config, initialMethod: item.id }), '', '', '', '']); continue; }
      const fullYear = r.end >= P.addYears(r.start, 1), compared = !!base && !isBase;
      rows.push([item.id, label, '已完成', '', r.start, r.end, code, r.contributed, fullYear ? r.annualReturn : '', r.totalReturn, r.profit, r.mdd, r.value, r.cash, r.xirr, r.xirrMissing, JSON.stringify(r.config),
        r.volatility, P.riskRatios(r).drawdown.value ?? '', compared && fullYear ? r.annualReturn - base.annualReturn : '', compared ? r.totalReturn - base.totalReturn : '']);
    }
    return M.csv(rows);
  }
```

In `assets/portfolio.js`, in the `compare-toggle` case change
```js
        if (!comparison?.strategies.some(item => item.id === val && item.result)) return;
```
to
```js
        if (![comparison?.baseline, ...(comparison?.strategies || [])].some(item => item?.id === val && item.result)) return;
```

In `assets/style.css`, change `.portfolio-compare-table{min-width:840px;font-size:15px}` to `.portfolio-compare-table{min-width:1180px;font-size:15px}` and insert after the `.portfolio-compare-table thead th:first-child{` rule:
```css
.portfolio-compare-table tbody .portfolio-compare-baseline th,.portfolio-compare-baseline td{background:#f8f9f4}
.portfolio-compare-missing{font-size:12px;color:var(--muted)}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test tests/portfolio-comparison.test.cjs tests/portfolio-pdf.test.cjs 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 6: Update the method doc**

In `docs/portfolio-method.md`, section `### 多策略并行比较`:

Replace `一次性投入和固定分批不另列比较行。` with `表格首行另列同配置的一次性投入作为基准；固定分批不另列比较行。`

Replace the sentence beginning `` `simulateStrategies` 逐行调用原模拟引擎，省略逐行重复的基准与区间快照。`` with `` `simulateStrategies` 逐行调用原模拟引擎，省略逐行重复的对照标的与区间快照；同时以相同参数运行一次性投入，结果放在 `baseline`，不计入十行策略。``

Add as a new paragraph after the paragraph that begins `每行都使用完整的初始本金与追加预算`:
```markdown
收益对比表在每行给出“较一次性投入”的收益差（百分点，随年化／累计开关切换）、年化波动和收益回撤比；收益回撤比的定义与缺值规则见“风险分析”。基准行与各策略使用同一组共同设置和实际起止日。基准运行失败时保留原因，差值留空，不用其他策略代替。基准不出现在“策略状态”页签，因为它没有信号和后续订单。导出的对比 CSV 在原有列之后追加年化波动、收益回撤比和两项差值，原列位置不变。
```

- [ ] **Step 7: Check it on the local site**

Open 多策略对比 for USD 30 / TQQQ 30 / 现金 40 and run it. Expected: 一次性投入 is the first row and reads 基准; its 年化收益, 最大回撤 and 期末资产 equal the 模拟结果 summary of a 一次性投入 run (32.70%, −70.98%, 1,694,775 on 2016-11-11 — 2026-11-13); each 较一次性投入 cell equals that row's return minus 32.70; the dotted baseline line can be toggled off and on.

- [ ] **Step 8: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -3
git add assets/portfolio-model.js assets/portfolio-comparison.js assets/portfolio.js assets/style.css tests/portfolio-comparison.test.cjs tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Compare every advanced strategy against a lump-sum baseline with risk columns"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 4: 风险分析 in the PDF report

**Files:**
- Modify: `assets/portfolio-pdf.js` (`snapshot` near line 99; `layout` immediately before `section('持仓贡献', …)` near line 344)
- Modify: `tests/portfolio-pdf.test.cjs`
- Modify: `docs/portfolio-method.md` (`## 长 PDF 导出`; new validation record at the end of `## 验证`'s neighbours)

**Interfaces:**
- Consumes: `P.riskAnalysis(result)`, `P.holdingCorrelation(result)` from Task 1.
- Produces: `report.correlation` on the object returned by `Pdf.snapshot`.

- [ ] **Step 1: Write the failing test**

Add to `tests/portfolio-pdf.test.cjs` after the test `PDF includes actual strategy results, precise fee and weights, all curves and missing windows`:
```js
test('PDF carries the risk section; a stored report without live prices omits correlation instead of inventing it', () => {
  const { input, result } = fixture();
  const report = Pdf.snapshot(result, input.catalog), document = Pdf.layout(report, measure), text = textOf(document);
  const risk = P.riskAnalysis(result), c = P.holdingCorrelation(result);
  assert.deepEqual(report.correlation, JSON.parse(JSON.stringify(c)));
  for (const value of ['风险分析', '年化波动', '收益回撤比', '收益波动比', '最长回撤期', '当前回撤', '相对本金最深亏损', '最长连续低于本金', '峰值日', '修复历时', '持仓相关性：周收益 ' + c.observations + '个']) assert.ok(text.includes(value), value);
  for (const e of risk.drawdowns) { assert.ok(text.includes(e.peakDay), e.peakDay); assert.ok(text.includes(e.troughDay), e.troughDay); }
  assert.ok(text.includes(c.matrix[0][1].toFixed(2)));
  assert.equal(document.ops.filter(op => op.type === 'path').length, 7, 'the risk section adds tables and cards, not charts');
  assert.doesNotMatch(text, /NaN|Infinity|undefined/);
  assert.ok(document.ops.every(op => op.y + op.h <= document.height));
  const stored = textOf(Pdf.layout({ ...report, correlation: null }, measure));
  assert.ok(stored.includes('风险分析')); assert.doesNotMatch(stored, /持仓相关性/);
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | grep -E "^not ok" | head`
Expected: the new test fails on `report.correlation`.

- [ ] **Step 3: Capture correlation and lay out the section**

In `assets/portfolio-pdf.js`, in `snapshot`, change the final `return` to:
```js
    // Correlation needs the live run's prices; the copy below cannot recompute it.
    return JSON.parse(JSON.stringify({ result, createdAt, dailyIndicator, correlation: P.holdingCorrelation(result), assets: catalog.assets.filter(a => ids.has(a.id)), fx: catalog.fx }));
```

In `layout`, insert immediately before `section('持仓贡献',`:
```js
    const risk = P.riskAnalysis(r);
    if (risk) {
      section('风险分析', '回撤与波动按现金流中性净值计算；相对本金按税后估值与累计投入比较。');
      const ratio = item => item.value === null ? item.missing : item.value.toFixed(2);
      const max = risk.maxDrawdown, longest = risk.longestDrawdown, below = risk.principal.longestBelow;
      cards([
        ['年化波动', pct(risk.volatility)], ['收益回撤比', ratio(risk.returnToDrawdown), '年化收益 ÷ 最大回撤'], ['收益波动比', ratio(risk.returnToVolatility), '未扣无风险利率'],
        ['最大回撤', pct(max ? max.depth : 0), max ? max.peakDay + ' — ' + max.troughDay : '区间内未出现回撤', C.negative],
        ['最长回撤期', (longest ? longest.totalDays : 0) + '天', longest ? longest.peakDay + ' — ' + (longest.recoveryDay || r.end) + '\n' + (longest.recovered ? '已修复' : '期末仍未修复') : ''],
        ['当前回撤', pct(risk.currentDrawdown), risk.currentDrawdown < 0 ? '' : '期末处于净值高点'],
        ['相对本金最深亏损', pct(risk.principal.deepestLoss), risk.principal.deepestLossDay || '未跌破本金'],
        ['最长连续低于本金', (below ? below.days : 0) + '天', below ? below.start + ' — ' + below.end + '\n' + (below.recovered ? '已恢复' : '期末仍低于本金') : '没有估值低于本金']
      ]);
      if (risk.marketDrawdown) paragraph('市值口径最大回撤 ' + pct(risk.marketDrawdown.depth) + '（未减浮盈预留税），峰值 ' + risk.marketDrawdown.peakDay + '，低点 ' + risk.marketDrawdown.troughDay + '。');
      if (risk.drawdowns.length) table(['峰值日', '低点日', '回撤幅度', '下跌历时', '修复日', '修复历时', '总历时'],
        risk.drawdowns.map(e => [e.peakDay, e.troughDay, { text: pct(e.depth), color: C.negative }, e.declineDays + '天', e.recovered ? e.recoveryDay : '尚未修复', e.recovered ? e.recoveryDays + '天' : '—', e.totalDays + '天']),
        [1.3, 1.3, 1.1, 1, 1.3, 1, 1], { numeric: [2, 3, 5, 6] });
      const c = report.correlation;
      if (c?.missing) paragraph('持仓相关性：' + c.missing + '，不计算相关性。');
      else if (c?.matrix) {
        paragraph('持仓相关性：周收益 ' + c.observations + '个，' + c.first + ' — ' + c.last + '，' + name + '计价。', C.ink);
        table(['', ...c.codes], c.matrix.map((row, i) => [c.codes[i], ...row.map(v => v === null ? '—' : v.toFixed(2))]), [1.4, ...c.codes.map(() => 1)], { numeric: c.codes.map((_, i) => i + 1) });
      }
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 5: Document the report and record the validation**

In `docs/portfolio-method.md`, in the first paragraph of `## 长 PDF 导出`, change `累计/年化收益、账户资产及回撤四种走势、持仓策略贡献` to `累计/年化收益、账户资产及回撤四种走势、风险分析（过程风险、相对本金、前5次回撤与持仓相关性）、持仓策略贡献`, and append to that paragraph: `持仓相关性在导出时从当次模拟的行情计算并随报告保存；脱离当次行情的报告副本不重新估算。`

Append a new section at the end of the file, filling each `<…>` with the figure measured in this session:
```markdown

## 2026-11-15 风险分析验证

- 独立 Python 账本不共用模型代码，从已发布历史文件重算三组真实组合的回撤区间、市值口径回撤、相对本金指标和周收益相关性：日期全部一致，数值最大相对差 <最大相对差>。
- 模型专项 8 项覆盖已修复与未修复区间、首笔交易费、四种本金方式的最大回撤勾稽、持续投入下本金亏损与净值回撤的差别、不足一年与无回撤的缺值原因、有无盈利税时的市值净值、相关性的周取样、样本不足、单一持仓与跨币种换算。
- 界面、对比表与 PDF 回归覆盖风险页签四张卡片、单一持仓隐藏相关性、基准行与三列、基准曲线开关、CSV 追加列和报告的风险分析章节。完整 JavaScript 测试 <总数> 项通过，资源版本与语法检查通过。
- 本地页面以 USD ETF 30%／TQQQ 30%／现金 40%、人民币、近10年核对：风险页签与独立重算一致，多策略对比的基准行与一次性投入的模拟结果一致。自动测试与本地验证不代表用户验收。
```

- [ ] **Step 6: Export a real report**

On the local site, export the PDF for the USD / TQQQ run. Expected: the 风险分析 section appears after 组合走势 with eight cards, the market-value line, five table rows and the 2×2 matrix; no text overflows a card.

- [ ] **Step 7: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -3
git add assets/portfolio-pdf.js tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Include the risk analysis in the exported portfolio report"
git fetch origin && git rebase origin/main && git push origin main
```
