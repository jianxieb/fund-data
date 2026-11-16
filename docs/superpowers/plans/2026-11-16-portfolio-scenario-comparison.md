# 组合模拟 方案对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save the current settings as named 方案 and compare the saved ones side by side in a fifth 方案对比 tab.

**Architecture:** One new engine function, `simulateScenarios`, runs each saved configuration through the existing `simulate` with a shared window and currency. A new view-only module, `assets/portfolio-scenarios.js`, owns storage, summaries, the tab markup and the CSV, and reuses the existing comparison chart. `assets/portfolio.js` stays the controller.

**Tech Stack:** Plain browser JavaScript (UMD and IIFE modules, no build step), `node:test`, hand-written CSS.

Spec: `docs/superpowers/specs/2026-11-16-portfolio-scenario-comparison-design.md`.

## Global Constraints

- Storage key `changheng.portfolio.scenarios.v1`; at most 8 方案; names 1–20 characters after trimming, unique.
- A comparison overrides only `years`, `start`, `end`, `currency` and clears `benchmarkId`. Nothing else of a 方案 changes.
- Rows are never aligned, shortened, summed or ranked. A row with different actual dates shows them; the line `各方案实际区间不同，收益不能直接比较。` appears when any differ.
- 载入 and 删除 act only after a confirmation dialog.
- The unsaved working draft never appears as a row.
- Existing 多策略对比 markup, actions and tests must not change: the chart is reused through an options argument whose defaults reproduce today's output.
- Every commit that touches `assets/` runs `npm run version-assets`. Before each commit: `npm test` and `npm run check`. Before each push: `git fetch origin && git rebase origin/main`. Never force-push.
- Commit messages are plain English sentences ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File Structure

| File | Change |
| --- | --- |
| `assets/portfolio-model.js` | `simulateScenarios` |
| `assets/portfolio-scenarios.js` | new: `load`, `store`, `nextName`, `nameError`, `summary`, `windowLabel`, `view`, `csv`, `LIMIT` on `window.ChanghengPortfolioScenarios` |
| `assets/portfolio-comparison.js` | `plot(comparison, state, H, options)` with `options.prefix` (default `compare`) and `options.noun` (default `策略`); `plot` and `colorFor` exported |
| `assets/portfolio.js` | fifth tab, `runScenarios`, save / load / delete with confirmation, stale notice |
| `assets/style.css` | scenario list |
| `index.html`, `package.json` | script tag before `portfolio.js`; `node --check` entry |
| `tests/portfolio-comparison.test.cjs`, `tests/portfolio-scenarios.test.cjs` (new), `tests/portfolio-pdf.test.cjs` | model, storage, interface |
| `docs/portfolio-method.md` | 方案对比 section |

---

### Task 1: Scenario run and storage module

**Interfaces:**
- Produces: `P.simulateScenarios(input, scenarios) → { config: { years, start, end, currency }, start, end, scenarios: [{ id, label, result } | { id, label, error }] }`, where `scenarios` is `[{ id, name, config }]` and `input.config` supplies the shared window and currency.
- Produces: `Scenarios.load() → Scenario[]`; `Scenarios.store(list) → boolean`; `Scenarios.nextName(list) → string`; `Scenarios.nameError(list, name) → string` (empty when acceptable); `Scenarios.summary(config, assets) → { holdings, rules }`; `Scenarios.windowLabel(config) → string`; `Scenarios.csv(run) → string`; `Scenarios.view(state, H) → string`.

- [x] **Step 1: Failing model test** — append to `tests/portfolio-comparison.test.cjs`:

```js
test('saved scenarios run as independent accounts on the shared window and currency', () => {
  const input = fixture(), before = JSON.stringify(input);
  const scenarios = [
    { id: 'a', name: '方案A', config: { ...input.config, rebalance: 'none', currency: 'CNY', years: 5, benchmarkId: 'us:QQQ' } },
    { id: 'b', name: '方案B', config: { ...input.config, positions: [{ id: 'us:USD', weight: 60 }], rebalance: 'band', rebalanceBand: 5 } },
    { id: 'c', name: '失效', config: { ...input.config, positions: [{ id: 'us:GONE', weight: 50 }] } }
  ];
  const run = P.simulateScenarios(input, scenarios);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(run.config, { years: 'custom', start: input.config.start, end: input.config.end, currency: 'USD' });
  for (const [i, s] of scenarios.slice(0, 2).entries()) {
    assert.deepEqual(run.scenarios[i].result, P.simulate({ ...input, config: { ...s.config, ...run.config, benchmarkId: '' } }));
    assert.equal(run.scenarios[i].label, s.name); assert.equal(run.scenarios[i].id, s.id);
  }
  assert.equal(run.scenarios[0].result.currency, 'USD'); assert.equal(run.scenarios[0].result.benchmark, null);
  assert.notEqual(run.scenarios[0].result.value, run.scenarios[1].result.value);
  assert.match(run.scenarios[2].error, /未收录/); assert.equal(run.scenarios[2].result, undefined);
  assert.equal(run.start, input.config.start); assert.equal(run.end, input.config.end);
  assert.deepEqual(P.simulateScenarios(input, []), { config: run.config, start: null, end: null, scenarios: [] });
});
```

- [x] **Step 2: Failing storage test** — create `tests/portfolio-scenarios.test.cjs` covering: round trip through a fake `localStorage`; a stored non-array, malformed entries and a throwing `getItem` give `[]` or drop the bad entries; `store` returns `false` when `setItem` throws; `nextName` skips used names and is empty when A–H are taken; `nameError` for empty, 21-character, duplicate and ninth 方案; `summary` for a two-holding configuration with cash, monthly budget and a 5-point band; `windowLabel` for a number of years, `common` and `custom`; `csv` has one line per row with the failure reason for a row that could not run.

- [x] **Step 3: Run both and confirm they fail** (`simulateScenarios is not a function`, module file missing).

- [x] **Step 4: Implement `simulateScenarios`** in `assets/portfolio-model.js` after `simulateStrategies`, and export it:

```js
  // Saved setups compared on one window and currency. Each keeps its own account;
  // nothing is aligned, summed or ranked.
  function simulateScenarios(input, scenarios) {
    const shared = { years: input.config.years, start: input.config.start, end: input.config.end, currency: currencyInfo(input.config).code };
    const rows = scenarios.map(({ id, name, config }) => {
      const result = simulate({ ...input, config: { ...config, ...shared, benchmarkId: '' } });
      return result.error ? { id, label: name, error: result.error } : { id, label: name, result };
    });
    const ran = rows.filter(row => row.result).map(row => row.result);
    return { config: JSON.parse(JSON.stringify(shared)), start: ran.map(r => r.start).sort()[0] || null, end: ran.map(r => r.end).sort().at(-1) || null, scenarios: rows };
  }
```

- [x] **Step 5: Implement `assets/portfolio-scenarios.js`** with the interface above. `load` keeps only entries that are objects with a string `id`, a string `name` and a `config.positions` array, at most 8. `summary.holdings` joins `代码 权重%` for positive weights and appends `现金 x%` when the weights total under 100; `summary.rules` joins the principal method, the contribution method when `monthly > 0`, and the rebalance label (`不再平衡`, `每月再平衡`, `每季再平衡`, `每年再平衡`, `偏离N个百分点再平衡`). `view` renders the 已保存方案 card (name field `id="portfolio-scenario-name"` with `data-portfolio-field="scenario-name"`, actions `portfolio-scenario-save`, `portfolio-scenario-load`, `portfolio-scenario-delete`), then, when `state.run` exists, the shared-window header, the warning line when dates differ, the table (方案 | 总投入本金 | 收益 | 盈亏 | 最大回撤 | 年化波动 | 收益回撤比 | 交易费 | 税费含预留 | 期末资产), and `ChanghengPortfolioComparison.plot({ ...run, strategies: run.scenarios, baseline: null }, state.view, H, { prefix: 'scenario', noun: '方案' })`.

- [x] **Step 6: Generalise the chart** in `assets/portfolio-comparison.js`: `plot(comparison, state, H, options = {})` reads `prefix = options.prefix || 'compare'` and `noun = options.noun || '策略'`, uses them for the checkbox id and `data-action` (`portfolio-<prefix>-toggle`), the metric action (`portfolio-<prefix>-metric`) and the four labels that say 策略; export `plot` and `colorFor`.

- [x] **Step 7: Wire the file** — `index.html`: `<script defer src="assets/portfolio-scenarios.js"></script>` immediately before the `portfolio.js` tag; `package.json` `check`: add `node --check assets/portfolio-scenarios.js &&` before `node --check assets/portfolio.js`.

- [x] **Step 8: Run** `node --test tests/portfolio*.test.cjs` — expected `fail 0`, including every existing 多策略对比 test unchanged.

- [x] **Step 9: Commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio-model.js assets/portfolio-scenarios.js assets/portfolio-comparison.js index.html package.json tests/portfolio-comparison.test.cjs tests/portfolio-scenarios.test.cjs
git commit -m "Run saved portfolio scenarios on a shared window and currency"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 2: 方案对比 tab

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: workspace tab id `scenarios`; actions `portfolio-scenario-save`, `-load`, `-delete`, `-load-confirm`, `-delete-confirm`, `-metric`, `-toggle`, `-export`.

- [x] **Step 1: Failing interface tests** — in `tests/portfolio-pdf.test.cjs`, load `assets/portfolio-scenarios.js` in `uiFixture` before `portfolio.js`, then add two tests:

1. *scenarios are saved, listed, compared, loaded and deleted*: empty state and offered name `方案A`; 开始对比 disabled with nothing saved; saving twice (second named `每年再平衡` after switching rebalancing) lists both with their summaries and `2 / 8`; a duplicate name is refused with a toast; 开始对比 shows both rows whose figures equal direct `P.simulate` runs, the shared window, one chart line per 方案 and no warning line; metric and legend toggles work; the CSV has a header and two rows; `scenario-load` opens a confirmation naming the 方案 and `scenario-load-confirm` restores its rebalancing in the exported configuration; changing the window shows the stale notice; `scenario-delete-confirm` leaves `1 / 8`.
2. *a 方案 with a younger asset shows its own dates and the warning*: with one history shortened and the window set to 共同历史, the later-starting row carries its dates and the line `各方案实际区间不同，收益不能直接比较。` appears.

- [x] **Step 2: Run and confirm they fail** on the missing tab.

- [x] **Step 3: Controller** in `assets/portfolio.js`:
  - `workspaceTabs` gains `['scenarios', '方案对比']`.
  - State: `scenarios` (from `Scenarios.load()`, `[]` when the module is absent), `scenarioName`, `scenarioRun`, `scenarioKey`, `scenarioError`, `scenarioRunId`, `scenarioView = { metric: 'return', hidden: new Set() }`; `scenarioSignature()` is the JSON of the list with the draft's `years`, `start`, `end`, `currency`.
  - `draftNotice` returns `方案或区间已改动，当前显示上次对比结果。` on this tab when a run exists and the signature differs.
  - `workspaceBar`: on this tab the primary button is 开始对比, disabled while running or with no saved 方案.
  - `workspaceContent` returns `Scenarios.view({ scenarios, name, run, view, error, assets, canSave }, H)`.
  - `runScenarios()`: refresh the catalog; load the histories of every positively weighted holding in any 方案, the QQQ / SOXX proxies and VIX context that any 方案's method needs, and FX when any holding's currency differs from the shared one, each with `Promise.allSettled` so one 方案's missing evidence cannot stop the others; then `P.simulateScenarios`. Reuses the `comparing` flag, keeps the previous result on failure, and discards a result whose signature changed while it ran.
  - `handleInput` intercepts `data-portfolio-field="scenario-name"` before the generic field handling.
  - `handleAction`: `run` dispatches by tab; `scenario-save` validates the name with `nameError` and the settings with `P.validateConfig`, appends `{ id, name, config }`, stores it and clears the name; `scenario-load` / `scenario-delete` open a confirmation whose confirm button is the `-confirm` action; `scenario-load-confirm` replaces the draft exactly as a configuration import does; `scenario-delete-confirm` removes the entry; `scenario-metric`, `scenario-toggle`, `scenario-export`.

- [x] **Step 4: Styles** in `assets/style.css` for `.portfolio-scenarios`, `.portfolio-scenario-list`, `.portfolio-scenario`, `.portfolio-scenario-actions`, `.portfolio-scenario-save`, `.portfolio-scenario-empty`.

- [x] **Step 5: Run** `node --test tests/portfolio*.test.cjs` — expected `fail 0`.

- [x] **Step 6: Check on the local site** — save three 方案 of USD 30 / TQQQ 30 / 现金 40 (CNY, 10 years, fee 0.10%, 大陆居民假设): no rebalancing, a 5-point band, yearly. Expected rows: 32.70% / −70.98% and 26.23% / −48.60% for the first two, matching the single runs recorded in the method doc; list, table and chart aligned at 1600 px; no console errors; reload keeps the list.

- [x] **Step 7: Document** — add `## 方案对比（2026-11-16新增）` to `docs/portfolio-method.md` before `## 风险分析（2026-11-15新增）`: what a 方案 stores and where; the 8-entry limit and naming; that 载入 and 删除 confirm; which three settings a comparison shares and that amounts keep their numbers across currencies; that rows are independent and never aligned, with the different-dates rule and its warning line; the columns; and a short validation record with the measured test totals.

- [x] **Step 8: Commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio.js assets/style.css tests/portfolio-pdf.test.cjs docs/portfolio-method.md index.html
git commit -m "Compare saved portfolio scenarios side by side in a new tab"
git fetch origin && git rebase origin/main && git push origin main
```
