# 组合模拟 起点检验 — design

Date: 2026-11-16. Status: design approved in conversation; last of four planned improvements to 组合模拟
(risk readout ✓ → generic strategies ✓ → 方案对比 ✓ → start-date test).

## Why

A simulation result depends heavily on when it starts. The page shows one window and four snapshots that all end on
the same day, so a user cannot tell whether a result is typical or an accident of the start date. The project's own
strategy research answers this with every monthly start over the available history; the page should offer the same
check for whatever the user has configured.

## Scope

In scope: a sixth workspace tab 起点检验 that reruns the current settings from every monthly start date for a chosen
holding period and reports the spread of outcomes, with a chart, the five worst and five best starts, and a CSV of
all starts.

Out of scope: forward projections or probabilities, Monte Carlo, start dates other than monthly, comparing saved
方案 in this tab, PDF output, running in a worker thread.

## Rule

- Holding period `N`: 1, 3, 5 or 10 years. Default 5.
- Calendar: the common trading days of the positively weighted holdings (and FX when needed) over their whole
  common history, found with the engine itself so the rule cannot drift from the ledger.
- A start is the first common trading day of a calendar month. It is kept when `addYears(start, N)` is not after the
  last common day, so every window is a full `N` years.
- Each start is one ordinary simulation with `years: 'custom'`, that start, end `addYears(start, N)`, and
  `requireFullWindow`. Everything else is the current configuration unchanged: holdings, amounts, principal and
  contribution methods, rebalancing, fees, cash rate, dividends, tax and end-of-period handling.
- When the principal method is not 一次性投入, the same window is also run with 一次性投入 as the reference.
- When a 对照 asset is set, its holding return over the same window comes from that same simulation.
- A start that cannot run (for example a strategy without enough warm-up history that early) keeps its reason and is
  counted separately. It is not replaced, shifted or dropped silently.

## Results

Per start: requested start, actual start and end, annualised and cumulative return (cash-flow neutral), maximum
drawdown, contributed capital, final value, and the annualised return of the 一次性投入 reference and of the 对照
asset when present.

Summary over the starts that ran:

```
年化收益：最差、25% 分位、中位、75% 分位、最好      分位数按排序后线性插值
最大回撤：最深、中位
亏损起点：累计收益 < 0 的个数
胜过一次性投入：年化收益严格更高的个数 / 两者都有结果的个数
胜过对照：年化收益严格更高的个数 / 两者都有结果的个数
```

The tab states the first and last start, the count, and one line that changes how the numbers should be read:
`相邻起点的区间大部分重叠，不是 N 次独立检验。` Counts are shown as `n / N`, never as a probability.

## Interface

Workspace tabs: … | 多策略对比 | 方案对比 | 起点检验. The primary button reads 开始检验.

1. 持有期 selector (1年 / 3年 / 5年 / 10年).
2. While running: `已完成 n / N 个起点` and 停止. Work is done in slices so the page stays responsive; stopping, or
   changing a setting, discards the partial run and keeps the previous result.
3. Summary grid, then a chart of annualised return by start month with one line each for the setup, the 一次性投入
   reference and the 对照 asset when present.
4. 最差5个起点 and 最好5个起点 tables (start, end, annualised return, drawdown, final value).
5. 导出全部起点 CSV, including the reason for each start that could not run.

When settings or the holding period changed after the last run, the tab keeps that result and says so. When no
start has a full period the tab says `共同历史不足 N 年，没有可检验的起点。`

## Units

| Unit | File | Responsibility |
| --- | --- | --- |
| `rollingStarts`, `rollingWindow`, `rollingSummary` | `assets/portfolio-model.js` | calendar, one window, statistics |
| Tab markup, chart, CSV | `assets/portfolio-rolling.js` (new) | view only |
| Controller | `assets/portfolio.js` | loading, sliced loop with progress and stop, stale notice |
| Styles | `assets/style.css` | selector, progress, chart |
| Wiring | `index.html`, `package.json` | script tag and syntax check |

`rollingWindow` returns a compact row and does not keep the daily ledger, so hundreds of starts stay small.

## Errors

- The calendar run failing (no common history, missing history file) is reported as the tab's error.
- A failed catalog refresh uses saved histories and says so.
- An interrupted run leaves the previous result untouched.

## Testing

- `rollingStarts`: first common day of each month; the last kept start leaves a full period; none when history is
  shorter than `N`; a month whose first calendar days are not trading days starts on its first common day.
- `rollingWindow`: equals a direct `simulate` of that window; carries the 一次性投入 reference only for other
  methods and the 对照 return only when one is set; an unrunnable start returns its reason.
- `rollingSummary`: quantiles on a hand-made list, losses, strict wins, ties and missing references excluded from
  the denominator, worst and best five in order, failed starts counted apart.
- Interface: period selection, run, summary, chart lines, worst and best tables, CSV, stale notice, the
  short-history message, and that stopping keeps the previous result.

Verification on the local site with USD 30 / TQQQ 30 / 现金 40 (CNY, 5-year holding): the row whose start is
2021-11 must equal the 近5年 snapshot already shown on the page.

## Delivery

Two commits, each pushed: the three model functions with tests; the tab with its module, documentation and tests.
