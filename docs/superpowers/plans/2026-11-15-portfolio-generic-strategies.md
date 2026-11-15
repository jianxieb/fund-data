# 组合模拟 Generic Strategy Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add threshold rebalancing, underweight-directed contributions and interest on idle cash to 组合模拟, all off by default.

**Architecture:** Three independent switches in the existing ledger loop of `assets/portfolio-model.js`. The band reuses `rebalance` through a shared target function; underweight contributions are a second allocation rule beside `invest`; interest is one accrual at the top of each valuation day. The page, the comparison view and the PDF only pass the settings through and label them.

**Tech Stack:** Plain browser JavaScript (UMD modules, no build step), `node:test`, hand-written CSS.

Spec: `docs/superpowers/specs/2026-11-15-portfolio-generic-strategies-design.md`.

**Status:** completed 2026-11-16 in `1ef6e46f` (threshold rebalancing), `b8d1ec99` (underweight contributions) and the cash-interest commit that follows them.

## Global Constraints

- A configuration without `rebalanceBand`, `contributionAllocation` and `cashRate` must produce a ledger deep-equal to today's.
- `rebalance` adds `'band'`; `rebalanceBand` is percentage points with `0 < x ≤ 50`; `contributionAllocation` is `'target'` or `'underweight'`; `cashRate` is annual percent with `0 ≤ x ≤ 20`.
- Nothing is clamped: an invalid value fails the run with its own message.
- Underweight is allowed only with `lump_sum`, `tranche_6`, `tranche_12`, `tranche_24`, `drawdown_ladder`, and is checked only when `monthly > 0`. Its error text is exactly `优先补低配只能与一次性、分批或回撤阶梯投入同时使用` on field `initialMethod`.
- Signals (drawdown, moving average, VIX, QQQ, scores) must not change when any of the three options changes.
- Interface copy is short Chinese labels; formulas go in `docs/portfolio-method.md`.
- Every commit that touches `assets/` runs `npm run version-assets`. Before each commit: `npm test` and `npm run check`. Before each push: `git fetch origin && git rebase origin/main`. Never force-push.
- Commit messages are plain English sentences ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File Structure

| File | Change |
| --- | --- |
| `assets/portfolio-model.js` | validation; `allocationState` and `drift`; band trigger; `investUnderweight`; interest accrual; reconciliation; `sanitizeDraft` |
| `assets/portfolio.js` | defaults; three controls; plan text; results notes; CSV columns |
| `assets/portfolio-comparison.js` | band label in the header |
| `assets/portfolio-pdf.js` | band label, 追加资金去向 and 现金年利率 in the settings table; interest on the cash row |
| `tests/portfolio-generic.test.cjs` | new: model tests for all three options |
| `tests/portfolio-comparison.test.cjs`, `tests/portfolio-pdf.test.cjs` | added cases |
| `docs/portfolio-method.md` | 通用策略选项 section, one subsection per option |
| `index.html` | regenerated hashes |

---

### Task 1: Threshold rebalancing

**Files:**
- Create: `tests/portfolio-generic.test.cjs`
- Modify: `assets/portfolio-model.js` (`validateConfig`, `rebalance`, the common-day block of the ledger loop, `sanitizeDraft`)
- Modify: `assets/portfolio.js` (`defaults`, `settings`), `assets/portfolio-comparison.js` (header), `assets/portfolio-pdf.js` (settings table)
- Modify: `tests/portfolio-comparison.test.cjs`, `tests/portfolio-pdf.test.cjs`, `docs/portfolio-method.md`

**Interfaces:**
- Produces: `config.rebalance === 'band'` with `config.rebalanceBand`; rebalance trades carry `signalDay` in band mode.

- [x] **Step 1: Write the failing tests**

Create `tests/portfolio-generic.test.cjs`:

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
// Each spec is one CNY asset priced on consecutive calendar days starting `offset` days after 2024-01-01.
function account(specs, config = {}, offset = 0) {
  const days = specs[0].values.map((_, i) => day(i + offset));
  const assets = specs.map((spec, i) => ({ id: 'stock:' + 'ABCD'[i], code: 'ABCD'[i], name: '资产' + 'ABCD'[i], kind: 'stock', currency: 'CNY', status: 'available' }));
  return { catalog: { assets, fx: { id: 'fx:CNY', name: '美元兑人民币', currency: 'CNY', status: 'available' } },
    histories: Object.fromEntries(assets.map((asset, i) => [asset.id, history(asset, specs[i].values, days)])),
    config: { positions: assets.map(asset => ({ id: asset.id, weight: 100 / assets.length })), initial: 1000, monthly: 0, years: 'common',
      rebalance: 'none', transactionFee: 0, feeBasis: 'net', ...config } };
}
const run = (...args) => { const result = P.simulate(account(...args)); assert.equal(result.error, undefined); return result; };
const rebalances = r => r.transactions.filter(t => t.reason === 'rebalance');

test('a band rebalances at the close after the one where drift reached it, at that day’s prices', () => {
  const specs = [{ values: [100, 120, 150, 150, 150] }, { values: [100, 100, 100, 100, 100] }];
  const r = run(specs, { rebalance: 'band', rebalanceBand: 10 });
  // Day 2 closes at 750 / 500: weights 60% / 40%, exactly ten points from 50%.
  assert.deepEqual(rebalances(r).map(t => [t.day, t.signalDay, t.id, t.side]), [[day(3), day(2), 'stock:A', 'sell'], [day(3), day(2), 'stock:B', 'buy']]);
  for (const t of rebalances(r)) close(t.amount, 125);
  assert.equal(r.rebalances, 1);
  assert.deepEqual(r.holdings.map(h => Math.round(h.grossValue * 1e6) / 1e6), [625, 625]);
  assert.deepEqual(rebalances(run(specs, { rebalance: 'band', rebalanceBand: 10.01 })), [], 'under the band nothing trades');
});

test('band mode ignores the calendar and calendar modes ignore the band', () => {
  const specs = [{ values: [100, 105, 105, 105] }, { values: [100, 100, 100, 100] }];   // 2024-01-30 … 2024-02-02
  assert.equal(run(specs, { rebalance: 'band', rebalanceBand: 10 }, 29).rebalances, 0);
  const monthly = run(specs, { rebalance: 'month', rebalanceBand: 10 }, 29);
  assert.equal(monthly.rebalances, 1);
  assert.deepEqual([...new Set(rebalances(monthly).map(t => t.day))], ['2024-02-01']);
  assert.ok(rebalances(monthly).every(t => t.signalDay === undefined));
});

test('a triggered band leaves no drift, pays fees and sale tax once, and never fires on the first day', () => {
  const values = Array.from({ length: 300 }, (_, i) => 100 * (1 + .5 * Math.sin(i / 20)) + i * .2);
  const r = run([{ values }, { values: values.map(() => 100) }], { rebalance: 'band', rebalanceBand: 5, transactionFee: .5, tax: { cnStockCapitalGains: 20 } });
  const days = [...new Set(rebalances(r).map(t => t.day))];
  assert.ok(days.length >= 2 && !days.includes(r.start));
  assert.equal(r.rebalances, days.length);
  // A rebalance resets drift to zero, so the next one cannot follow on the very next close.
  const order = r.curve.map(p => p.day);
  assert.ok(days.every((d, i) => !i || order.indexOf(d) - order.indexOf(days[i - 1]) > 1));
  assert.ok(r.capitalTax > 0 && r.tradeCost > 0);
  close(r.holdings.reduce((sum, h) => sum + h.profit, 0), r.profit, 1e-6);
});

test('a band does not buy back what a timing rule has parked', () => {
  const values = Array.from({ length: 420 }, (_, i) => i < 260 ? 100 + i : i < 330 ? 360 - (i - 260) * 3 : 150);
  const r = run([{ values }, { values: values.map(() => 100) }], { initialMethod: 'ma200_hold', rebalance: 'band', rebalanceBand: 5 });
  const out = r.curve.filter(p => p.exposure === 0).map(p => p.day);
  assert.ok(out.length > 20, 'the fixture must spend time out of the market');
  assert.deepEqual(r.transactions.filter(t => t.side === 'buy' && out.includes(t.day)), []);
});

test('band settings are validated and survive import; other modes do not require a band', () => {
  const input = account([{ values: [100, 101, 102] }]);
  for (const rebalanceBand of [0, -1, 50.1, NaN, undefined, '5']) {
    assert.match(P.simulate({ ...input, config: { ...input.config, rebalance: 'band', rebalanceBand } }).error, /偏离阈值须大于0且不超过50个百分点/);
  }
  assert.match(P.simulate({ ...input, config: { ...input.config, rebalance: 'weekly' } }).error, /再平衡方式无效/);
  assert.equal(P.simulate({ ...input, config: { ...input.config, rebalance: 'year' } }).error, undefined);
  const ids = new Set(['stock:A']), draft = { schemaVersion: 1, ...input.config, rebalance: 'band', rebalanceBand: 7.5 };
  assert.equal(P.sanitizeDraft(draft, ids).rebalanceBand, 7.5);
  assert.throws(() => P.sanitizeDraft({ ...draft, rebalanceBand: 0 }, ids), /偏离阈值/);
  assert.equal(P.sanitizeDraft({ ...draft, rebalance: 'year' }, ids).rebalanceBand, undefined);
});
```

Append to `tests/portfolio-comparison.test.cjs`:
```js
test('every advanced strategy runs with a band and none rebuys a parked TQQQ sleeve through it', () => {
  const comparison = P.simulateStrategies(fixture({ rebalance: 'band', rebalanceBand: 5 }));
  for (const row of [comparison.baseline, ...comparison.strategies]) assert.equal(row.error, undefined, row.label + ': ' + row.error);
  const qqq = comparison.strategies.find(row => row.id === 'qqq_bear_confirm').result;
  const parked = new Set(qqq.curve.filter(p => p.qqqOn === false).map(p => p.day));
  assert.ok(parked.size > 5, 'the fixture must park TQQQ');
  assert.deepEqual(qqq.transactions.filter(t => t.id === 'us:TQQQ' && t.side === 'buy' && t.reason === 'rebalance' && parked.has(t.day)), []);
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `node --test tests/portfolio-generic.test.cjs tests/portfolio-comparison.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the five new generic tests and the new comparison test fail (`再平衡周期无效` or missing trades).

- [x] **Step 3: Validate the band**

In `validateConfig` replace
```js
    if (!['none', 'month', 'quarter', 'year'].includes(config.rebalance)) fail('再平衡周期无效');
```
with
```js
    if (!['none', 'month', 'quarter', 'year', 'band'].includes(config.rebalance)) fail('再平衡方式无效');
    if (config.rebalance === 'band' && (!finite(config.rebalanceBand) || config.rebalanceBand <= 0 || config.rebalanceBand > 50)) fail('偏离阈值须大于0且不超过50个百分点');
```
In `sanitizeDraft`, change `rebalance: value.rebalance,` to
```js
rebalance: value.rebalance, ...(value.rebalance === 'band' ? { rebalanceBand: value.rebalanceBand } : {}),
```

- [x] **Step 4: Share the rebalance target and add the trigger**

Change the line `let lastBalance = periodKey(start, config.rebalance), peak = 1, mdd = 0;` to
```js
    let lastBalance = periodKey(start, config.rebalance), peak = 1, mdd = 0;
    const calendarRebalance = ['month', 'quarter', 'year'].includes(config.rebalance);
    const band = config.rebalance === 'band' ? config.rebalanceBand / 100 : null;
    let bandSignal = null;
```

Replace the opening of `rebalance`, from `function rebalance(day, prices, reason, targetExposure = exposure) {` through the closing `};` of its `target` arrow function, with:
```js
    // What a rebalance would restore right now. The drift measure shares it,
    // so a threshold rebalance leaves exactly zero drift behind.
    function allocationState(prices, targetExposure = exposure) {
      const wealth = Math.max(0, value(prices) - initialReserve), previous = units.map((u, i) => u * prices[i]);
      // A periodic rebalance must not recreate a spent opportunity reserve.
      // Preserve each sleeve's current stock/cash split while restoring its
      // configured total weight. This is separate from new-money allocation.
      const keptFractions = opportunity ? pairIndices.map((index, leg) => {
        const marked = index < 0 ? 0 : previous[index], pool = marked + Math.max(0, systematicCash[leg]);
        return pool > EPS ? marked / pool : 1;
      }) : null;
      const target = (s, i) => {
        const leg = pairIndices.indexOf(i);
        return targetExposure * (opportunity && leg >= 0 ? pairWeights[leg] * keptFractions[leg] : targetWeight(s, i));
      };
      return { wealth, previous, keptFractions, target };
    }
    // Largest gap between a holding's market weight and its current target.
    function drift(prices) {
      const { wealth, previous, target } = allocationState(prices);
      return wealth > EPS ? Math.max(...series.map((s, i) => Math.abs(previous[i] / wealth - target(s, i)))) : 0;
    }
    function rebalance(day, prices, reason, targetExposure = exposure, signalDay) {
      const { wealth, previous, keptFractions, target } = allocationState(prices, targetExposure);
```
and in the same function change `trade(day, prices, deltas, deltas.map(delta => Math.abs(delta) * fee), reason);` to `trade(day, prices, deltas, deltas.map(delta => Math.abs(delta) * fee), reason, signalDay);`.

In the ledger loop replace
```js
        if (config.rebalance !== 'none' && day !== start && balance !== lastBalance) {
          rebalance(day, prices, 'rebalance'); lastBalance = balance;
        }
```
with
```js
        if (calendarRebalance && day !== start && balance !== lastBalance) {
          rebalance(day, prices, 'rebalance'); lastBalance = balance;
        }
        // The previous common close decided; this close fills.
        if (bandSignal && day !== start && bandSignal.drift >= band - 1e-12) rebalance(day, prices, 'rebalance', exposure, bandSignal.day);
```
and insert immediately before the line `if (qqqTiming && (riskReserve < -1e-5 || riskReserve > cash + 1e-5)) fail('QQQ风险现金与账户现金未勾稽');`:
```js
      if (band !== null && commonSet.has(day)) bandSignal = { day, drift: drift(prices) };
```

- [x] **Step 5: Run the model tests**

Run: `node --test tests/portfolio-generic.test.cjs tests/portfolio-comparison.test.cjs tests/portfolio*.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: `fail 0`.

- [x] **Step 6: Settings control and labels (test first)**

Add to `tests/portfolio-pdf.test.cjs` after the test `risk tab hides correlation for one holding and the market-value line without gains tax`:
```js
test('threshold rebalancing is chosen in settings, reaches the ledger and is named in the report', async () => {
  const runs = [];
  const f = uiFixture(input => Object.assign(input.config, { monthly: 0, rebalance: 'none' }),
    { ...P, simulate(input) { const result = P.simulate(input); runs.push(result); return result; } });
  let html = f.ui.view(f.helpers);
  assert.ok(html.includes('再平衡方式') && html.includes('data-value="band"'));
  assert.doesNotMatch(html, /data-portfolio-field="rebalanceBand"|再平衡周期/);
  await f.action('select', { field: 'rebalance', value: 'band' });
  html = f.ui.view(f.helpers);
  assert.match(html, /data-portfolio-field="rebalanceBand"[^>]*|id="portfolio-rebalanceBand"/);
  assert.ok(html.includes('任一持仓占比偏离目标达到阈值，下一共同交易日再平衡。'));
  f.ui.handleInput({ id: 'portfolio-rebalanceBand', value: '3', dataset: { portfolioField: 'rebalanceBand' } });
  await f.action('run');
  assert.equal(runs[0].config.rebalance, 'band'); assert.equal(runs[0].config.rebalanceBand, 3);
  assert.ok(runs[0].rebalances > 0, 'the fixture drifts more than three points');
  await f.action('export-pdf');
  assert.ok(textOf(Pdf.layout(f.reports.at(-1), measure)).includes('偏离3个百分点'));
  f.ui.handleInput({ id: 'portfolio-rebalanceBand', value: '', dataset: { portfolioField: 'rebalanceBand' } });
  await f.action('run');
  assert.match(f.ui.view(f.helpers), /偏离阈值须大于0且不超过50个百分点/);
});
```
Run it and confirm it fails on `再平衡方式`.

In `assets/portfolio.js`: add `rebalanceBand: 5,` to `defaults` after `rebalance: 'none',`. In `settings`, replace
```js
      '<div class="portfolio-decision"><div class="portfolio-decision-controls">' + field('再平衡周期', menu('rebalance', '再平衡周期', [['none', '不再平衡'], ['month', '每月'], ['quarter', '每季度'], ['year', '每年']], draft.rebalance)) + '</div></div></section>' +
```
with
```js
      '<div class="portfolio-decision"><div class="portfolio-decision-controls">' + field('再平衡方式', menu('rebalance', '再平衡方式', [['none', '不再平衡'], ['month', '每月'], ['quarter', '每季度'], ['year', '每年'], ['band', '偏离阈值']], draft.rebalance)) +
      (draft.rebalance === 'band' ? number('偏离阈值', 'rebalanceBand', draft.rebalanceBand, 50, 'any', '百分点') : '') + '</div>' +
      (draft.rebalance === 'band' ? '<section class="portfolio-plan-panel" aria-labelledby="portfolio-rebalance-title"><h3 id="portfolio-rebalance-title">再平衡规则</h3><p>任一持仓占比偏离目标达到阈值，下一共同交易日再平衡。</p></section>' : '') + '</div></section>' +
```

In `assets/portfolio-comparison.js` replace the `const rebalance = { none: …` line with
```js
    const rebalance = comparison.config.rebalance === 'band' ? '偏离' + comparison.config.rebalanceBand + '个百分点再平衡' :
      { none: '不再平衡', month: '每月再平衡', quarter: '每季再平衡', year: '每年再平衡' }[comparison.config.rebalance] || '不再平衡';
```

In `assets/portfolio-pdf.js` replace `['再平衡', rebalanceName[cfg.rebalance], '买卖交易费率', settingPct(cfg.transactionFee)],` with
```js
      ['再平衡', cfg.rebalance === 'band' ? '偏离' + cfg.rebalanceBand + '个百分点' : rebalanceName[cfg.rebalance], '买卖交易费率', settingPct(cfg.transactionFee)],
```

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | tail -6` — expected `fail 0`.

- [x] **Step 7: Independent check**

Extend `<scratchpad>/audit/independent.py` with the band rule for ordinary methods (drift of each holding's market weight in `gross − reserve` wealth against its configured weight at the previous common close; rebalance at the next) and compare final value, return, drawdown, fees, taxes and rebalance count with the model for: USD 30 / TQQQ 30 / 现金 40 (CNY, 10 years, fee 0.10%, tax 20/20, band 5); SPY 60 / TLT 40 (USD, 10 years, fee 0.10%, band 3, 2,000 monthly); 510300 50 / SPY 50 (CNY, 5 years, band 10, tranche_12). Expected: relative difference below `1e-7` on every figure and equal counts.

- [x] **Step 8: Document**

Insert before `## 风险分析（2026-11-15新增）` in `docs/portfolio-method.md`:
```markdown
## 通用策略选项（2026-11-15新增）

以下三项适用于任意标的和权重，默认全部关闭；未设置时模拟结果与此前逐项相同。

### 偏离阈值再平衡

“再平衡方式”除按月、季、年外，可选“偏离阈值”并填写阈值（百分点，大于 0 且不超过 50）。每个共同收盘计算一次偏离；前一个共同收盘的偏离达到阈值时，在本共同收盘按当日价格再平衡。判断用前一收盘、成交用本收盘，与其他信号的因果顺序一致。

```
权重_i = 持仓市值_i / 可再平衡资产      可再平衡资产 = 账户市值 − 待投入本金
偏离 = max_i | 权重_i − 当前目标_i |
```

市值未减浮盈预留税，与再平衡成交使用的口径相同。“当前目标”就是当天执行再平衡会恢复到的目标：普通方式为配置权重；择时规则已退出的持仓为 0；系统调仓方法为最近已执行的目标；评分预留保持该标的股票与待加现金的现有比例。偏离与再平衡共用同一目标函数，所以再平衡后偏离恰为 0，不会由自身再次触发。只比较持仓，现金是剩余部分。首日不再平衡；偏离阈值方式不读取日历周期。

再平衡本身沿用原有计算：买卖计费，卖出盈利按所设税率扣税，待投入本金与策略专属现金照旧处理。成交记录标明信号日。系统调仓方法在卖出与回款买入之间会暂时偏离已执行目标，阈值可能在这一间隔触发一次。阈值是回测假设，不构成调仓建议。
```
(Fill nothing in; this subsection has no measured figures.)

- [x] **Step 9: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio-model.js assets/portfolio.js assets/portfolio-comparison.js assets/portfolio-pdf.js tests/portfolio-generic.test.cjs tests/portfolio-comparison.test.cjs tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Rebalance a portfolio when a holding drifts past a threshold"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 2: Underweight-directed contributions

**Files:**
- Modify: `assets/portfolio-model.js` (`validateConfig`, after `invest`, the common-day block, `sanitizeDraft`)
- Modify: `assets/portfolio.js` (`defaults`, `settings`, `contributionPlan`, `handleAction`), `assets/portfolio-pdf.js`
- Modify: `tests/portfolio-generic.test.cjs`, `tests/portfolio-pdf.test.cjs`, `docs/portfolio-method.md`

**Interfaces:**
- Produces: `config.contributionAllocation` (`'target'` default, `'underweight'`).

- [x] **Step 1: Write the failing tests**

Append to `tests/portfolio-generic.test.cjs`:
```js
const month = (before, after) => Array.from({ length: 35 }, (_, i) => day(i) < '2024-02-01' ? before : after);   // 2024-01-01 … 2024-02-04
const contributions = r => r.transactions.filter(t => t.reason === 'contribution');

test('a contribution buys the holdings below target in proportion to their gaps and sells nothing', () => {
  const r = run([{ values: month(100, 200) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  // 1 Feb: A is worth 1000 and B 500; with the new 1000 each target is 1250, so the gaps are 250 and 750.
  assert.deepEqual(contributions(r).map(t => [t.day, t.id, t.side]), [['2024-02-01', 'stock:A', 'buy'], ['2024-02-01', 'stock:B', 'buy']]);
  close(contributions(r)[0].amount, 250); close(contributions(r)[1].amount, 750);
  assert.deepEqual(r.holdings.map(h => Math.round(h.grossValue * 1e6) / 1e6), [1250, 1250]);
  assert.equal(r.transactions.filter(t => t.side === 'sell').length, 0);
  const proportional = run([{ values: month(100, 200) }, { values: month(100, 100) }], { monthly: 1000 });
  assert.deepEqual(contributions(proportional).map(t => t.amount), [500, 500]);
  assert.equal(r.contributed, proportional.contributed); assert.equal(r.deposits, proportional.deposits);
});

test('a holding above target receives nothing and none is bought past its target', () => {
  const r = run([{ values: month(100, 400) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  // A is worth 2000 against a 1750 target; all 1000 goes to B, which ends at 1500, still under 1750.
  assert.deepEqual(contributions(r).map(t => [t.id, Math.round(t.amount * 1e6) / 1e6]), [['stock:B', 1000]]);
});

test('on target, underweight equals the proportional purchase to the cent, with a fee and a cash share', () => {
  const specs = [{ values: month(100, 100) }, { values: month(100, 100) }];
  const config = { positions: [{ id: 'stock:A', weight: 30 }, { id: 'stock:B', weight: 30 }], monthly: 1000, transactionFee: 1 };
  const proportional = run(specs, config), under = run(specs, { ...config, contributionAllocation: 'underweight' });
  assert.equal(contributions(under).length, 2);
  contributions(under).forEach((t, i) => { close(t.amount, contributions(proportional)[i].amount); close(t.fee, contributions(proportional)[i].fee); });
  close(under.cash, proportional.cash); close(under.value, proportional.value);
});

test('underweight contributions realise no gains tax where a calendar rebalance would', () => {
  const specs = [{ values: month(100, 200) }, { values: month(100, 100) }], tax = { cnStockCapitalGains: 20 };
  const under = run(specs, { monthly: 1000, contributionAllocation: 'underweight', tax });
  const calendar = run(specs, { monthly: 1000, rebalance: 'month', tax });
  assert.equal(under.capitalTax, 0); assert.ok(calendar.capitalTax > 0);
});

test('underweight is rejected with position-managing methods, ignored without a budget, and validated', () => {
  const input = account([{ values: month(100, 100) }, { values: month(100, 100) }], { monthly: 1000, contributionAllocation: 'underweight' });
  for (const initialMethod of ['ma200_hold', 'cash_topup']) {
    const r = P.simulate({ ...input, config: { ...input.config, initialMethod } });
    assert.equal(r.error, '优先补低配只能与一次性、分批或回撤阶梯投入同时使用'); assert.equal(r.errorField, 'initialMethod');
  }
  for (const initialMethod of ['lump_sum', 'tranche_6', 'tranche_12', 'tranche_24', 'drawdown_ladder']) {
    assert.equal(P.simulate({ ...input, config: { ...input.config, initialMethod } }).error, undefined, initialMethod);
  }
  assert.equal(P.simulate({ ...input, config: { ...input.config, initialMethod: 'ma200_hold', monthly: 0 } }).error, undefined);
  assert.match(P.simulate({ ...input, config: { ...input.config, contributionAllocation: 'momentum' } }).error, /追加资金去向无效/);
  const ids = new Set(['stock:A', 'stock:B']);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config }, ids).contributionAllocation, 'underweight');
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config, contributionAllocation: undefined }, ids).contributionAllocation, 'target');
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `node --test tests/portfolio-generic.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the five new tests fail; the Task 1 tests still pass.

- [x] **Step 3: Implement**

In `validateConfig`, after the band line, add
```js
    if (!['target', 'underweight'].includes(config.contributionAllocation ?? 'target')) fail('追加资金去向无效');
```
In `sanitizeDraft`, add `contributionAllocation: value.contributionAllocation ?? 'target',` after the `rebalance` entry.

In `run`, after `const strategy = strategyConfig(config), strategyDays = common.filter(day => day >= start && day <= end);` add
```js
    // New money can only be steered where no rule already owns the positions or their cash.
    const underweight = (config.contributionAllocation ?? 'target') === 'underweight' && config.monthly > 0;
    if (underweight && !/^(lump_sum|tranche_(6|12|24)|drawdown_ladder)$/.test(strategy.initialMethod)) failStrategy('优先补低配只能与一次性、分批或回撤阶梯投入同时使用');
```
After the closing brace of `invest`, add
```js
    // The deposit is already in cash. Every position's gap to its target after
    // the deposit is filled in proportion; the gaps always cover the deposit, so
    // nothing is bought past target and nothing is sold. On target this equals invest().
    function investUnderweight(day, amount, prices) {
      if (amount <= EPS) return;
      const wealth = Math.max(0, value(prices) - initialReserve), marks = units.map((u, i) => u * prices[i]);
      const gaps = series.map((s, i) => Math.max(0, s.weight * wealth - marks[i]));
      const cashGap = Math.max(0, cashWeight * wealth - (cash - initialReserve - amount));
      const budget = sum(gaps) * (1 + fee) + cashGap;
      if (budget <= EPS) return invest(day, amount, prices, 'contribution');
      const deltas = gaps.map(g => amount * g / budget);
      trade(day, prices, deltas, deltas.map(delta => delta * fee), 'contribution');
    }
```
In the ledger loop change `invest(day, income, prices, 'contribution');` to
```js
          if (underweight) investUnderweight(day, income, prices); else invest(day, income, prices, 'contribution');
```

- [x] **Step 4: Run the model tests**

Run: `node --test tests/portfolio*.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"` — expected `fail 0`.

- [x] **Step 5: Settings control (test first)**

Add to `tests/portfolio-pdf.test.cjs` after the threshold test:
```js
test('where new money goes is chosen beside the contribution method and explained in one sentence', async () => {
  const runs = [];
  const f = uiFixture(input => Object.assign(input.config, { monthly: 500, rebalance: 'none' }),
    { ...P, simulate(input) { const result = P.simulate(input); runs.push(result); return result; } });
  let html = f.ui.view(f.helpers);
  assert.ok(html.includes('追加资金去向') && html.includes('按目标比例') && html.includes('优先补低配'));
  assert.match(html, /data-action="portfolio-contribution-allocation" data-value="target" aria-pressed="true"/);
  await f.action('contribution-allocation', { value: 'underweight' });
  html = f.ui.view(f.helpers);
  assert.match(html, /data-action="portfolio-contribution-allocation" data-value="underweight" aria-pressed="true"/);
  assert.ok(html.includes('每笔追加按各持仓低于目标的缺口分配，不卖出已有持仓。'));
  await f.action('run');
  assert.equal(runs[0].config.contributionAllocation, 'underweight');
  await f.action('export-pdf');
  assert.ok(textOf(Pdf.layout(f.reports.at(-1), measure)).includes('优先补低配'));
  await f.action('tab', { value: 'settings' });
  await f.action('select', { field: 'initialMethod', value: 'ma200_hold' });
  await f.action('run');
  assert.match(f.ui.view(f.helpers), /优先补低配只能与一次性、分批或回撤阶梯投入同时使用/);
  await f.action('contribution-allocation', { value: 'momentum' });
  assert.match(f.ui.view(f.helpers), /data-value="underweight" aria-pressed="true"/, 'an unknown value is ignored');
});
```
Run it and confirm it fails on `追加资金去向`.

In `assets/portfolio.js`: add `contributionAllocation: 'target',` to `defaults` after `contributionMethod: 'dca_month',`. In `settings`, after `number('每月追加预算', 'monthly', draft.monthly, 1e10, 'any', currency().unit) +` add
```js
      '<div class="portfolio-field"><span id="portfolio-allocation-label">追加资金去向</span><div class="segmented" role="group" aria-labelledby="portfolio-allocation-label">' +
      [['target', '按目标比例'], ['underweight', '优先补低配']].map(([id, label]) => btn(label, 'contribution-allocation', id === draft.contributionAllocation ? 'active' : '',
        'data-value="' + id + '" aria-pressed="' + (id === draft.contributionAllocation) + '"')).join('') + '</div></div>' +
```
In `contributionPlan`, before `return income;` add
```js
    if (monthly > 0 && draft.contributionAllocation === 'underweight') income += ' 每笔追加按各持仓低于目标的缺口分配，不卖出已有持仓。';
```
In `handleAction`, before `case 'settle-hold':` add
```js
      case 'contribution-allocation':
        if (!['target', 'underweight'].includes(val)) return;
        draft.contributionAllocation = val; touch(); break;
```
In `assets/portfolio-pdf.js`, after the settings row that begins `['再平衡',` add a row
```js
      ['追加资金去向', cfg.contributionAllocation === 'underweight' ? '优先补低配' : '按目标比例', '现金年利率', settingPct(cfg.cashRate ?? 0)],
```

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | tail -6` — expected `fail 0`.

- [x] **Step 6: Independent check**

Extend the audit ledger with the underweight rule and compare with the model for: SPY 50 / QQQ 30 / TLT 20 (USD, 10 years, 100,000 + 2,000 monthly, fee 0.10%, tax 20/20); 510300 50 / SPY 30 with 20% cash (CNY, 5 years, 3,000 monthly `dca_drawdown`, `tranche_12`, fee 0.15%); USD 30 / TQQQ 30 / 现金 40 (CNY, 10 years, 1,000 monthly, band 5). Expected: relative difference below `1e-7` on every figure.

- [x] **Step 7: Document**

Append to the `## 通用策略选项（2026-11-15新增）` section:
```markdown

### 追加资金优先补低配

“追加资金去向”选“优先补低配”时，每笔外部追加不再按目标权重平均买入，而是按各持仓低于目标的缺口分配。设当日追加为 `D`，`W` 为含 `D` 的可再平衡资产，`r` 为交易费率，`C` 为追加前已释放账户中的现金：

```
缺口_i = max(0, w_i × W − 持仓市值_i)      现金缺口 = max(0, 现金目标 × W − C)
k = D / (Σ缺口_i × (1 + r) + 现金缺口)
买入_i = k × 缺口_i      买入费_i = r × 买入_i      留作现金 = k × 现金缺口
```

各项缺口之和不小于 `D`，所以 `k ≤ 1`，任何持仓都不会被买过目标。全部持仓恰在目标上时，结果与按目标比例买入逐项相同，包括费用的分摊。不卖出任何持仓，因此不产生卖出盈利税；入金日期、金额与笔数不变，只改变资金去向。分批与回撤阶梯释放的初始本金仍按目标权重买入。

仅与一次性投入、6/12/24个月分批和回撤阶梯同时使用。其余本金方式自行管理仓位或专属现金，同时选择时模拟停止并提示“优先补低配只能与一次性、分批或回撤阶梯投入同时使用”；每月追加预算为 0 时不检查。多策略对比中不适用的行各自显示该原因。
```

- [x] **Step 8: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio-model.js assets/portfolio.js assets/portfolio-pdf.js tests/portfolio-generic.test.cjs tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Direct new contributions to the holdings below target"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 3: Interest on idle cash

**Files:**
- Modify: `assets/portfolio-model.js` (`validateConfig`, ledger loop, curve row, reconciliation, result, `sanitizeDraft`)
- Modify: `assets/portfolio.js` (`defaults`, `settings`, `handleInput`, `handleChange`, `resultHoldings`, CSV exports, method modal), `assets/portfolio-pdf.js`
- Modify: `tests/portfolio-generic.test.cjs`, `tests/portfolio-pdf.test.cjs`, `docs/portfolio-method.md`

**Interfaces:**
- Produces: `config.cashRate`; `result.cashInterest`; `curve[i].cashInterest` (cumulative).

- [x] **Step 1: Write the failing tests**

Append to `tests/portfolio-generic.test.cjs`:
```js
const YEAR = 365.2425, flat = n => Array.from({ length: n }, () => 100);
const half = { positions: [{ id: 'stock:A', weight: 50 }] };

test('idle cash compounds at the annual rate by calendar days, whatever the spacing of valuation days', () => {
  const r = run([{ values: flat(367) }], { ...half, cashRate: 3 });   // 2024-01-01 … 2025-01-01, 366 days
  close(r.cashInterest, 500 * (Math.pow(1.03, 366 / YEAR) - 1));
  close(r.cash, 500 + r.cashInterest); close(r.value, 1000 + r.cashInterest); close(r.profit, r.cashInterest);
  assert.equal(r.contributed, 1000);
  close(r.curve.at(-1).cashInterest, r.cashInterest); assert.equal(r.curve[0].cashInterest, 0);
  const input = account([{ values: flat(367) }], { ...half, cashRate: 3 });
  const sparse = input.histories['stock:A'];
  sparse.series = sparse.series.filter((_, i) => i % 5 === 0 || i === 366);
  close(P.simulate(input).cashInterest, r.cashInterest);
});

test('interest is return, not capital: NAV, XIRR and the cash row rise while contributions and signals stay put', () => {
  const values = Array.from({ length: 400 }, (_, i) => i < 200 ? 100 + i * .2 : i < 260 ? 140 - (i - 200) : 80 + (i - 260) * .3);
  const config = { positions: [{ id: 'stock:A', weight: 60 }], initialMethod: 'drawdown_ladder', monthly: 100, contributionMethod: 'dca_drawdown' };
  const zero = run([{ values }], config), paid = run([{ values }], { ...config, cashRate: 4 });
  assert.equal(paid.contributed, zero.contributed);
  assert.deepEqual(paid.plan, zero.plan, 'no drawdown trigger may move with the cash rate');
  assert.ok(paid.cashInterest > 0 && paid.value > zero.value && paid.xirr > zero.xirr && paid.annualReturn > zero.annualReturn);
  close(paid.holdings.reduce((sum, h) => sum + h.profit, 0) + paid.cashInterest, paid.profit, 1e-6);
  assert.equal(zero.cashInterest, 0);
});

test('principal waiting in a tranche plan earns interest and is still released in the planned amounts', () => {
  const r = run([{ values: flat(200) }], { positions: [{ id: 'stock:A', weight: 100 }], initial: 600, initialMethod: 'tranche_6', cashRate: 5 });
  assert.deepEqual(r.plan.initial.map(p => p.amount), [100, 100, 100, 100, 100, 100]);
  let cash = 600, last = null, expected = 0;
  for (const p of r.curve) {   // the same account written out by hand: accrue, then release 100 on each planned day
    if (last) { const interest = cash * (Math.pow(1.05, (Date.parse(p.day) - Date.parse(last)) / 86400000 / YEAR) - 1); cash += interest; expected += interest; }
    if (r.plan.initial.some(step => step.day === p.day)) cash -= 100;
    last = p.day;
  }
  close(r.cashInterest, expected); close(r.profit, expected); close(r.cash, expected);
});

test('the cash rate is validated, defaults to zero, and an unset configuration reproduces the earlier ledger', () => {
  const input = account([{ values: flat(40) }], half);
  for (const cashRate of [-0.1, 20.1, NaN, '2']) assert.match(P.simulate({ ...input, config: { ...input.config, cashRate } }).error, /现金年利率须在0至20%之间/);
  const plain = P.simulate(input), explicit = P.simulate({ ...input, config: { ...input.config, cashRate: 0, contributionAllocation: 'target' } });
  assert.deepEqual(explicit.curve, plain.curve); assert.deepEqual(explicit.transactions, plain.transactions);
  assert.equal(plain.cashInterest, 0);
  const ids = new Set(['stock:A']);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config }, ids).cashRate, 0);
  assert.equal(P.sanitizeDraft({ schemaVersion: 1, ...input.config, cashRate: 2.5 }, ids).cashRate, 2.5);
  assert.throws(() => P.sanitizeDraft({ schemaVersion: 1, ...input.config, cashRate: 99 }, ids), /现金年利率/);
});
```

- [x] **Step 2: Run and confirm they fail**

Run: `node --test tests/portfolio-generic.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"`
Expected: the four new tests fail; earlier ones pass.

- [x] **Step 3: Implement**

In `validateConfig`, after the allocation line, add
```js
    if (!finite(config.cashRate ?? 0) || (config.cashRate ?? 0) < 0 || (config.cashRate ?? 0) > 20) fail('现金年利率须在0至20%之间');
```
In `sanitizeDraft`, add `cashRate: value.cashRate ?? 0,` after the `contributionAllocation` entry.

In `run`, after the `let bandSignal = null;` line add
```js
    // One scenario rate for the whole window, entered after tax. Strategy cash
    // labels are not scaled: interest is free cash, so labels never exceed real cash.
    const cashGrowth = (config.cashRate ?? 0) / 100;
    let cashInterest = 0, accruedDay = null;
```
At the top of the ledger loop body, immediately after `for (const day of days) {`, add
```js
      if (cashGrowth && accruedDay && cash > 0) {
        const interest = cash * (Math.pow(1 + cashGrowth, gap(accruedDay, day) / YEAR) - 1);
        cash += interest; cashInterest += interest;
      }
      accruedDay = day;
```
In the `curve.push({ … })` call change `cash, initialReserve, exposure,` to `cash, cashInterest, initialReserve, exposure,`.
Change the reconciliation line to
```js
    if (Math.abs(sum(holdings.map(h => h.profit)) + cashInterest - final.profit) > Math.max(1e-4, contributed * 1e-10)) fail('组合持仓盈亏未与账户勾稽');
```
In the `result` object change `cash, cashDividends: sum(cashDividends),` to `cash, cashInterest, cashDividends: sum(cashDividends),`.

- [x] **Step 4: Run the model tests**

Run: `node --test tests/portfolio*.test.cjs 2>&1 | grep -E "^✖|^ℹ (pass|fail)"` — expected `fail 0`.

- [x] **Step 5: Settings, results and exports (test first)**

Add to `tests/portfolio-pdf.test.cjs` after the allocation test:
```js
test('the cash rate is set with the backtest conditions and its interest is shown, exported and reported', async () => {
  const runs = [];
  const f = uiFixture(input => Object.assign(input.config, { monthly: 0, rebalance: 'none', transactionFee: 0 }),
    { ...P, simulate(input) { const result = P.simulate(input); runs.push(result); return result; } });
  assert.match(f.ui.view(f.helpers), /现金年利率[\s\S]*data-portfolio-field="cashRate"/);
  f.ui.handleInput({ id: 'portfolio-cashRate', value: '2.5', dataset: { portfolioField: 'cashRate' } });
  await f.action('run');
  const r = runs[0];
  assert.equal(r.config.cashRate, 2.5); assert.ok(r.cashInterest > 0);
  const html = await f.resultTab('holdings');
  assert.ok(html.includes('现金利息 ' + String(r.cashInterest)), 'the notes name the interest');
  assert.ok(html.includes('<td class="num">' + String(r.cashInterest) + '</td>'), 'the cash row carries it as its contribution');
  await f.action('export-holdings');
  assert.ok(f.downloads.at(-1)[1].split(/\r?\n/).find(line => line.startsWith('"cash:CNY"')).includes('"' + r.cashInterest + '"'));
  await f.action('export-result');
  assert.ok(f.downloads.at(-1)[1].split(/\r?\n/)[0].includes('累计现金利息CNY'));
  assert.ok(f.downloads.at(-1)[1].split(/\r?\n/).at(-1).endsWith('"' + r.cashInterest + '"'));
  await f.action('export-pdf');
  const text = textOf(Pdf.layout(f.reports.at(-1), measure));
  assert.ok(text.includes('现金年利率') && text.includes('2.5%') && text.includes('累计现金利息'));
  f.ui.handleInput({ id: 'portfolio-cashRate', value: '', dataset: { portfolioField: 'cashRate' }, validity: { badInput: false } });
  await f.action('save');
  assert.equal(JSON.parse(f.downloads.at(-1)[1]).cashRate, 0, 'an emptied rate means zero, like the monthly budget');
});
```
Run it and confirm it fails on `现金年利率`.

In `assets/portfolio.js`:
- add `cashRate: 0,` to `defaults` after `transactionFee: 0,`;
- in `settings`, change `field('计价币种', menu('currency', '投入与计价币种', [['CNY', '人民币 CNY'], ['USD', '美元 USD']], draft.currency)) + '</div>' +` to `field('计价币种', menu('currency', '投入与计价币种', [['CNY', '人民币 CNY'], ['USD', '美元 USD']], draft.currency)) + number('现金年利率', 'cashRate', draft.cashRate, 20, 'any', '%') + '</div>' +`;
- in `handleInput`, change `key === 'monthly' && !el.validity.badInput ? 0 : NaN` to `['monthly', 'cashRate'].includes(key) && !el.validity?.badInput ? 0 : NaN`;
- in `handleChange`, change `if (el.dataset.portfolioField === 'monthly' && !el.value.trim() && !el.validity.badInput) el.value = '0';` to `if (['monthly', 'cashRate'].includes(el.dataset.portfolioField) && !el.value.trim() && !el.validity?.badInput) el.value = '0';`;
- in `resultHoldings`, in the cash row change the ninth cell `'</td><td class="num">0.00</td><td class="num">0.00</td><td class="num">0.00</td></tr>'` to `'</td><td class="num">' + H.money(r.cashInterest || 0, 2) + '</td><td class="num">0.00</td><td class="num">0.00</td></tr>'`, and in the notes row add `(r.cashInterest > .005 ? '<span>现金利息 ' + H.money(r.cashInterest, 2) + ' ' + unit + '</span>' : '') +` before `(r.config.dividendPolicy === 'cash' ?`;
- in `exportHoldings`, in the cash row change `result.cash, 0, 0, '', '', '', '零息现金',` to `result.cash, result.cashInterest || 0, 0, '', '', '', result.config.cashRate ? '现金年利率' + result.config.cashRate + '%' : '零息现金',`;
- in `exportResult`, append `amount('累计现金利息')` to the header array and `p.cashInterest` to each row;
- in `method`, change `分批、回撤阶梯的待投入本金持有零息现金，再平衡不提前使用。` to `分批、回撤阶梯的待投入本金留作现金，再平衡不提前使用；现金默认零息，可在回测条件设置现金年利率。`

In `assets/portfolio-pdf.js`, in the holdings contribution table change the cash row `'0.00', '0.00']` to `number(r.cashInterest || 0), '0.00']`, and after the paragraph that begins `'入金 ' + r.deposits + '笔` add
```js
    if (r.cashInterest > .005) paragraph('累计现金利息 ' + number(r.cashInterest) + ' ' + unit + '（现金年利率 ' + settingPct(cfg.cashRate) + '，计入收益，不计入投入本金）。');
```

Run: `node --test tests/portfolio-pdf.test.cjs 2>&1 | tail -6` — expected `fail 0`.

- [x] **Step 6: Independent check**

Extend the audit ledger with the accrual and compare with the model for: USD 30 / TQQQ 30 / 现金 40 (CNY, 10 years, fee 0.10%, tax 20/20, cash 2%, band 5); 510300 50 / SPY 30 with 20% cash (CNY, 5 years, `tranche_12`, 3,000 monthly underweight, cash 1.5%); SPY 100 (USD, 5 years, `ma200_hold`, cash 4%). Expected: relative difference below `1e-7` on every figure, including cumulative interest.

- [x] **Step 7: Document and record the validation**

Append to the `## 通用策略选项（2026-11-15新增）` section, filling each `<…>` with the figure measured in this session:
```markdown

### 现金年利率

“回测条件”可填写现金年利率（0 至 20%，默认 0）。每个估值日开始时，账户内全部现金按距上一估值日的日历天数计息：

```
利息 = 现金 × ((1 + 年利率)^(日历天数 / 365.2425) − 1)
```

计息范围包括未分配现金、分批或阶梯尚未释放的本金，以及择时与评分策略暂存的现金。利息是收益，不是入金：它提高组合净值、账户盈亏和资金年化，不改变累计投入本金。策略的现金归属标记（待投入本金、风险现金、待加现金）不随利息放大，利息属于普通现金，所以标记金额不会超过真实现金。

这是整个区间使用同一利率的回测假设，与买卖交易费率同类，不代表历史上各年的实际存款或货币基金收益；请填写税后利率，模型不另算利息税。信号参考组合仍按零息现金计算，现金利率不改变回撤、均线或其他任何触发条件。持仓盈亏之和加累计现金利息必须等于账户盈亏；“持仓贡献”的现金行显示利息。

### 2026-11-15 验证

- 独立 Python 账本补入三条规则后，与模型在 <组合数> 组真实组合上逐项对照：终值、收益、回撤、波动、交易费、税费、再平衡次数与累计利息的最大相对差 <最大相对差>。
- 模型专项 14 项覆盖阈值边界、前一收盘判断与本收盘成交、再平衡后偏离归零、日历与阈值互不影响、择时退出期间不回买、缺口比例分配、不超过目标、在目标上与原规则逐项相等、不产生卖出税、不适用方式的拒绝、不等间隔估值日的复利、待投入本金计息、利息不改变信号，以及未设置三项时账本与此前逐项相同。
- 完整 JavaScript 测试 <总数> 项、Python 测试 <Python总数> 项通过。本地页面核对三项设置、结果与导出；未查看线上页面。自动测试与本地验证不代表用户验收。
```

- [x] **Step 8: Full verification, commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2 && python3 -m unittest discover -s tests -q 2>&1 | tail -3
git add assets/portfolio-model.js assets/portfolio.js assets/portfolio-pdf.js tests/portfolio-generic.test.cjs tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Let idle cash earn a fixed annual rate in portfolio simulations"
git fetch origin && git rebase origin/main && git push origin main
```
