# 组合模拟 risk readout — design

Date: 2026-11-15. Status: design approved in conversation; first of four planned improvements to 组合模拟
(risk readout → generic strategies → allocation A/B comparison → rolling start-date test). Each gets its own spec.

## Why

An audit of 组合模拟 found the calculations correct: an independent ledger written from `docs/portfolio-method.md`
matched the page on 18 scenarios to about 11 significant digits. The page is thin on *reading* a result, though:

- The summary has four numbers. Volatility sits only in 持仓贡献. There is no risk-adjusted ratio, no drawdown dates,
  no time under water, and nothing about how holdings move together.
- 最大回撤 is measured after the 浮盈预留税, which cushions falls. For USD 30 / TQQQ 30 / 现金 40 over ten years it
  shows −70.98% while the market-value drawdown is −73.07%. Nothing on the page says which one the user is reading.
- 多策略对比 lists ten advanced strategies but not 一次性投入, so the table cannot say whether a strategy beat doing
  nothing, and it has no risk column.

## Scope

In scope:

1. A new result sub-tab **风险** between 区间表现 and 持仓贡献.
2. A market-value NAV in the daily ledger, so drawdown can be shown before the unrealised tax reserve.
3. A **一次性投入（基准）** row and three columns in 多策略对比, including its CSV.
4. The same risk content in the exported PDF report.
5. Method documentation and tests.

Out of scope: the four-number summary (unchanged by earlier decision); the √250 volatility convention (other pages
use 250 or 252, and changing one page would make them disagree); monthly heatmaps, Sortino, risk contribution,
optimisation, any forward projection; the three later improvements.

## Units

| Unit | File | Responsibility |
| --- | --- | --- |
| Risk analysis | `assets/portfolio-model.js` | `riskAnalysis(result)`: pure function of a finished result |
| Market-value NAV | `assets/portfolio-model.js` | new `grossNav` on every `curve` row |
| Holding correlation | `assets/portfolio-model.js` | `holdingCorrelation(result)`: weekly correlation for a live result |
| Baseline run | `assets/portfolio-model.js` | `simulateStrategies` returns `baseline` beside `strategies` |
| 风险 tab | `assets/portfolio.js`, `assets/style.css` | render the four cards |
| Comparison table | `assets/portfolio-comparison.js` | baseline row, three columns, chart line, CSV columns |
| PDF section | `assets/portfolio-pdf.js` | 风险分析 section |

No existing output field changes value. `comparisonMethods` and `strategies` keep their ten rows; the baseline is a
separate property so the 策略状态 tab and existing consumers are untouched.

## Definitions

All series are the run's own daily ledger. "Day counts" are calendar days between two ledger dates.

### Drawdown episodes (`riskAnalysis`)

Input: `curve[i].nav`, the cash-flow-neutral NAV after the tax reserve. The running peak starts at 1 on `result.start`,
the same base the existing 最大回撤 uses, so the initial trading fee counts.

- A day is under water when `nav < peak × (1 − 1e-12)`.
- An episode starts on the first under-water day. Its `peakDay` is the latest day on which NAV reached the running
  peak (`result.start` for the opening base).
- `troughDay` is the earliest day of the lowest NAV inside the episode.
- The episode ends on the first day `nav ≥ peak` (`recoveryDay`, `recovered: true`). If the ledger ends first,
  `recovered: false` and `recoveryDay: null`.
- `depth = (trough / peak − 1) × 100`. `declineDays` = `peakDay → troughDay`. `recoveryDays` = `troughDay →
  recoveryDay`, or `null`. `totalDays` = `peakDay → recoveryDay`, or `peakDay → result.end` when not recovered.

Outputs: `drawdowns` (the five deepest, deepest first, earlier `peakDay` breaks ties), `maxDrawdown` (the deepest,
`null` when there is none), `longestDrawdown` (largest `totalDays`, deeper breaks ties), `currentDrawdown` (the last
row's existing `drawdown`), `episodes` (count). Invariant: `maxDrawdown.depth` equals `result.mdd` within 1e-9.

### Market-value drawdown

The ledger keeps a second unit count for the account's market value (`grossValue`, before the unrealised reserve).
Each external deposit issues units at the market-value NAV just before the deposit, exactly as the existing NAV does
for the after-reserve value. `grossNav = grossValue / grossUnits`. Realised taxes and fees stay deducted because they
left the account; only the unrealised reserve is excluded.

`marketDrawdown` (`depth`, `peakDay`, `troughDay`) uses the same episode rule on `grossNav`. It is reported only when
at least one holding has a gains-tax rate above 0; otherwise `grossNav` equals `nav` and the line would repeat.

### Ratios

`fullYear` is `result.end >= addYears(result.start, 1)`.

- 收益回撤比 = `annualReturn ÷ |mdd|`. Missing reason `不足一年` when not `fullYear`, `未出现回撤` when `mdd` is 0.
- 收益波动比 = `annualReturn ÷ volatility`. Missing reason `不足一年`, or `波动为零`. No risk-free rate is deducted,
  and the label says so instead of calling it a Sharpe ratio.

Both use the existing time-weighted `annualReturn` and the existing `volatility`. A negative return gives a negative
ratio, shown as it is. A shared helper returns both so the 风险 tab and 多策略对比 cannot disagree.

### Relative to principal

Input: `curve[i].value` (after the reserve) and `curve[i].contributed`. Same names and rules as 持有期研究.

- 相对本金最深亏损 = `min(0, min_i(value_i / contributed_i − 1)) × 100`, with its earliest date; `0` and no date when
  the account never fell below contributed capital.
- A day is below principal when `value < contributed × (1 − 1e-12)`. An episode runs from the first such day to the
  first later day that is not below (`recovered: true`), or to `result.end` (`recovered: false`).
- 最长连续低于本金 is the episode with the most calendar days; `endingBelow` is the unrecovered one, if any.

### Holding correlation (`holdingCorrelation`)

- Holdings: those with positive target weight, in result order. Fewer than two returns `null` and the card is hidden.
- Prices: the run's own total-return price in the simulation currency, with the ledger's FX rule. Investor tax,
  trading fees and the cash-dividend ex-price factor are excluded: this measures co-movement of the assets.
- Sampling: the last common trading day of each Monday-to-Sunday week inside `[start, end]`. Weekly, because A-share
  and US closes are not simultaneous and daily figures read too low. A week with no common day is skipped and the
  next return simply spans it for every holding alike.
- Returns: simple return between consecutive samples. Fewer than 26 returns gives
  `{ missing: '共同周收益仅 N 个，少于 26 个' }`.
- Pearson correlation on the common sample. A holding with zero variance yields `null` cells, shown as `—`.
- Output: `ids`, `codes`, `matrix`, `observations`, `first`, `last`.

The prices are reached through the per-result closure the model already keeps for chart indicators, so a JSON copy
of a result has no correlation. The PDF computes it from the live result before copying.

### Baseline in 多策略对比

`simulateStrategies` also runs `initialMethod: 'lump_sum'` with the shared config and returns
`baseline: { id: 'lump_sum', label: '一次性投入', result | error }`. A baseline whose actual start or end differs from
the strategies is reported as an error, like any other row.

## Interface

风险 tab, four cards. Labels are short; formulas live in the method doc.

1. **过程风险** — 年化波动 · 收益回撤比 · 收益波动比（未扣无风险利率） · 最大回撤 with 峰值日 and 低点日, plus
   `市值口径 x%（未减浮盈预留税）` when `marketDrawdown` exists · 最长回撤期 with dates and 已修复 / 期末仍未修复 ·
   当前回撤.
2. **相对本金** — 相对本金最深亏损 with date, or 未跌破本金 · 最长连续低于本金 with dates and status.
3. **前5次回撤** — 峰值日, 低点日, 回撤幅度, 下跌历时, 修复日, 修复历时, 总历时. Unrecovered rows read 尚未修复. With
   no episode the card reads 区间内未出现回撤.
4. **持仓相关性** — matrix by code, cells tinted by value, one caption line: sample count, dates, 周收益, currency.
   Hidden with one holding; shows the missing reason when the sample is short.

多策略对比 table: 策略 | 总投入本金 | 收益 | 较一次性投入 | 盈亏 | 最大回撤 | 年化波动 | 收益回撤比 | 期末资产. The
baseline is the first row and reads 基准 in the difference column. Differences are percentage points on the return
basis currently selected (年化 / 累计). The chart draws the baseline as a dotted neutral line with its own legend
toggle. The CSV keeps existing column positions and appends 年化波动%, 收益回撤比, and the two differences.

PDF: a 风险分析 section after 组合走势 with the same cards, the drawdown table and the correlation matrix.

## Errors and missing values

- Missing ratios show their reason, never 0.
- A failed baseline shows its reason in the baseline row; difference cells show `—`.
- `riskAnalysis` on a result without a curve returns `null`; the tab is not offered.
- Nothing here can fail a simulation that succeeds today.

## Testing

`tests/portfolio-risk.test.cjs`, hand-computable fixtures:

- two episodes, one recovered and one open at the end: dates, day counts, order, longest, current;
- an opening fee creates an episode from the start day;
- `maxDrawdown.depth` equals `mdd` across existing strategy fixtures;
- principal: a contributing account that dips below contributed capital and recovers, and one that ends below;
- ratios: under one year gives the reason, a full year gives the quotient;
- `grossNav` equals `nav` bit for bit without gains tax; is deeper in a fall with a 20% rate; a deposit on a flat day
  leaves it unchanged;
- correlation: identical returns give 1, mirrored give −1, a constant holding gives `null`, 25 returns give the
  reason, a cross-currency holding uses simulation-currency prices;
- baseline equals a direct `lump_sum` run, and `strategies` still has ten rows.

Existing suites gain cases for the tab markup, the comparison row, columns and CSV, and the PDF section.

Verification before each commit: `npm test`, `npm run check`, and a run on the local site. The independent Python
ledger from the audit is extended to recompute the 风险 tab's figures for the USD / TQQQ example.

## Delivery

One independent change per commit, each pushed after fetching remote data refreshes: model and tests with their
method-doc section; 风险 tab; comparison baseline; PDF section. Asset versions in `index.html` are regenerated in
every commit that touches an asset.
