# 组合模拟 起点检验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 起点检验 tab that reruns the current settings from every monthly start for a fixed holding period and reports the spread of outcomes.

**Architecture:** Three small functions in `assets/portfolio-model.js` find the starts, run one window into a compact row, and summarise the rows; each window is an ordinary `simulate` call. A new view-only module renders the tab. `assets/portfolio.js` loads the evidence once and runs the windows in time slices so the page stays responsive and the run can be stopped.

**Tech Stack:** Plain browser JavaScript (no build step), `node:test`, hand-written CSS and inline SVG.

Spec: `docs/superpowers/specs/2026-11-16-portfolio-start-date-test-design.md`.

## Global Constraints

- Holding period is 1, 3, 5 or 10 years; default 5.
- A start is the first common trading day of a calendar month and is kept only when `addYears(start, N)` is not after the last common day.
- Every window uses the current configuration unchanged apart from `years: 'custom'`, `start`, `end` and `requireFullWindow`.
- The 一次性投入 reference is run only when the principal method is another one; the 对照 return is taken from the same simulation and only when one is set.
- A start that cannot run keeps its reason. Nothing is shifted, replaced or dropped silently.
- Results are counts (`n / N`), never probabilities. The line `相邻起点的区间大部分重叠，不是 N 次独立检验。` is always shown with a result.
- Stopping or changing a setting mid-run discards the partial run and keeps the previous result.
- Every commit that touches `assets/` runs `npm run version-assets`. Before each commit: `npm test` and `npm run check`. Before each push: `git fetch origin && git rebase origin/main`. Never force-push.
- Commit messages are plain English sentences ending with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File Structure

| File | Change |
| --- | --- |
| `assets/portfolio-model.js` | `rollingStarts`, `rollingWindow`, `rollingSummary` |
| `assets/portfolio-rolling.js` | new: `view`, `csv` on `window.ChanghengPortfolioRolling` |
| `assets/portfolio.js` | sixth tab, `loadEvidence` shared with 方案对比, `runRolling`, period and stop actions, stale notice |
| `assets/style.css` | controls, progress, chart |
| `index.html`, `package.json` | script tag before `portfolio.js`; `node --check` entry |
| `tests/portfolio-rolling.test.cjs` (new), `tests/portfolio-pdf.test.cjs` | model, interface |
| `docs/portfolio-method.md` | 起点检验 section |

---

### Task 1: Model functions

**Interfaces:**
- `P.rollingStarts(input, years) → { years, first, last, starts: string[] } | { error }`. The calendar comes from one plain buy-and-hold run over the whole common history (no tax, fee, contributions or strategy), so strategy warm-up or tax-evidence limits cannot hide valid starts.
- `P.rollingWindow(input, start, years) → { start, actualStart, end, annualReturn, totalReturn, mdd, contributed, value, lumpSum: number|null, benchmark: number|null } | { start, error }`.
- `P.rollingSummary(rows) → { count, failed, firstStart, lastStart, annual: { min, q1, median, q3, max }, drawdown: { worst, median }, losses, beatLumpSum: { wins, of }|null, beatBenchmark: { wins, of }|null, worst: Row[], best: Row[] }`; with no successful row every statistic is `null` and the lists are empty.

- [x] **Step 1: Failing tests** — create `tests/portfolio-rolling.test.cjs`:
  1. *starts*: two assets from 2024-01-15 for 800 days, the second without the 1st and 2nd of each month. With one year: 15 starts, the first `2024-01-15`, the second `2024-02-03`, the last `2025-03-03`. With three years: none. With two years: the error `持有期须为1、3、5或10年`. A missing history: the engine's error.
  2. *window*: equals a direct `simulate` of that window field by field; no `curve`; `lumpSum` is `null` for 一次性投入 and the direct 一次性投入 annual return for `tranche_6`; `benchmark` is `null` without a 对照 and the benchmark's annual return with one; a start before the history returns `{ start, error }`.
  3. *summary*: for annual returns `[10, −5, 20, 0, 5]`, drawdowns `[−10, −30, −20, −5, −15]`, references `[8, −5, null, 1, 5]` and one failed row: quartiles −5 / 0 / 5 / 10 / 20, worst drawdown −30 and median −15, one loss, `beatLumpSum` 1 of 4 (ties do not win, missing references leave the denominator), `beatBenchmark` null, worst and best five in order, `count` 5, `failed` 1; all rows failed gives `count` 0 and null statistics.

- [x] **Step 2: Run and confirm they fail** (`rollingStarts is not a function`).

- [x] **Step 3: Implement** the three functions after `simulateScenarios` and export them. Quantiles use linear interpolation at `(n − 1) × p` on the sorted values. A win is a strictly higher annual return among rows where both numbers exist. `worst` is the five lowest annual returns ascending (earlier start breaks ties); `best` the five highest descending.

- [x] **Step 4: Run** `node --test tests/portfolio*.test.cjs` — expected `fail 0`.

- [x] **Step 5: Commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio-model.js tests/portfolio-rolling.test.cjs index.html
git commit -m "Find monthly start dates and summarise a portfolio's outcomes across them"
git fetch origin && git rebase origin/main && git push origin main
```

---

### Task 2: 起点检验 tab

**Interfaces:**
- Consumes: the three functions of Task 1.
- Produces: workspace tab id `rolling`; actions `portfolio-rolling-years`, `portfolio-rolling-stop`, `portfolio-rolling-export`; `Rolling.view(state, H)` with `state = { years, run, progress, error }` and `run = { config, years, rows, summary, benchmark, lumpSum, catalogRefresh }`; `Rolling.csv(run)`.

- [x] **Step 1: Failing interface tests** — in `tests/portfolio-pdf.test.cjs` load `assets/portfolio-rolling.js` in `uiFixture`, add it to the entry-point list, and add:
  1. *the test reruns every monthly start and reports the spread*: 5年 is selected by default; with 1年 and 开始检验 the tab shows 13 starts, the overlap line with that count, the five quartile figures and drawdown figures equal to `P.rollingSummary` of rows built with `P.rollingWindow`, `胜过对照` with its count, a chart line for the setup and for the 对照 and none for 一次性投入, two tables of five rows, and a CSV with a header and 13 lines; choosing 3年 shows the stale notice, and running it reports `共同历史不足 3 年，没有可检验的起点。` while the 1-year result stays.
  2. *a strategy other than 一次性投入 is also compared with it*: with `tranche_6` the tab shows `胜过一次性投入` and a third chart line.
  3. *stopping keeps the previous result*: a run stopped before it finishes leaves no progress line and no result.

- [x] **Step 2: Run and confirm they fail** on the missing tab.

- [x] **Step 3: View module** `assets/portfolio-rolling.js`: the 持有期 selector; while `state.progress` exists `已完成 n / N 个起点` with 停止; with a run: the header line (first and last start, count, holding period, failed count when above 0), the overlap line, a summary grid (最差 / 25%分位 / 中位 / 75%分位 / 最好 年化收益, 最深 and 中位 最大回撤, 亏损起点, 胜过一次性投入 and 胜过对照 when present), an SVG chart of annual return by start with `data-rolling-line="setup"`, `"lumpSum"` and `"benchmark"`, the two five-row tables, and 导出全部起点 CSV. CSV columns: 起点, 实际开始日, 结束日, 模拟状态, 缺项, 年化收益%, 累计收益%, 最大回撤%, 总投入本金, 期末税后估值, 一次性投入年化%, 对照年化%.

- [x] **Step 4: Controller** in `assets/portfolio.js`:
  - `workspaceTabs` gains `['rolling', '起点检验']`; state `rollingYears = 5`, `rollingRun`, `rollingKey`, `rollingError`, `rollingProgress`, `rollingRunId`; `rollingSignature()` is the JSON of the configuration and the period.
  - Move the evidence loading of `runScenarios` into `loadEvidence(configs, code)` and use it from both.
  - `runRolling()`: validate; refresh the catalog; load evidence and the 对照 history; `P.rollingStarts`; then loop the starts calling `P.rollingWindow`, yielding with `setTimeout(0)` whenever a slice has run for more than 40 ms, updating the progress, and returning without a result when the token or the signature changed; finally `P.rollingSummary`.
  - `draftNotice`, `workspaceBar` (开始检验, disabled while any run is active or without holdings) and `workspaceContent` for the tab; `run` dispatches by tab and is refused while a test is running.
  - Actions `rolling-years` (1, 3, 5, 10 only), `rolling-stop` (bumps the token and clears the progress), `rolling-export`.

- [x] **Step 5: Styles** for the controls, the progress line and the chart.

- [x] **Step 6: Run** `node --test tests/portfolio*.test.cjs` — expected `fail 0`.

- [x] **Step 7: Check on the local site** — USD 30 / TQQQ 30 / 现金 40 (CNY, fee 0.10%, 大陆居民假设, 一次性投入, 对照 SPY), 5-year holding. Expected: the page stays responsive while the count advances; the start in 2021-11 shows +14.54% a year and −46.64% drawdown, the 近5年 snapshot figures; no console errors.

- [x] **Step 8: Document** — add `## 起点检验（2026-11-16新增）` to `docs/portfolio-method.md` before `## 方案对比（2026-11-16新增）`: the rule for starts and windows, what is and is not changed in the configuration, the references, the statistics with the quantile rule and the strict-win rule, failed starts, the overlap caveat, and a validation record with measured figures.

- [x] **Step 9: Commit and push**

```bash
npm run version-assets && npm test 2>&1 | tail -8 && npm run check 2>&1 | tail -2
git add assets/portfolio.js assets/portfolio-rolling.js assets/style.css index.html package.json tests/portfolio-pdf.test.cjs docs/portfolio-method.md
git commit -m "Test a portfolio setup from every monthly start date in a new tab"
git fetch origin && git rebase origin/main && git push origin main
```
