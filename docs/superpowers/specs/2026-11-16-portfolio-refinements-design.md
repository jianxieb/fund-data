# 组合模拟 refinements after review (2026-11-16)

User review of the finished 组合模拟 improvements raised four points. Each design below was approved in the review dialog.

## 1. XIRR in 区间快照

- **Problem:** 资金年化 XIRR took its own table row, which read as a third headline return beside 组合年化收益 and the 对照.
- **Meaning:** 组合年化收益 is the cash-flow-neutral (time-weighted) return of the setup and is the figure compared with the 对照 and with other strategies. XIRR is the money-weighted return of the actual deposits. With a single deposit they are equal and only one is shown; with later deposits they differ (for example 5 years of 3,000 a month into USD 30 / TQQQ 30 / 现金 40: 组合年化 17.50%, XIRR 29.43%).
- **Change:** remove the XIRR row. In each period whose window has more than one deposit, the 组合年化收益 (or 组合累计收益) cell gets a second line `XIRR <value>`, or `XIRR <reason>` when it is unavailable. Periods with one deposit show no second line. The summary at the top, CSV and PDF are unchanged.

## 2. 追加资金去向

- **Problem:** the label sat on its own line and the two-button track stretched across the column, leaving empty grey space on the right.
- **Change:** the field spans the controls width with the label and the two buttons on one line; the track is as wide as its buttons.

## 3. 各起点的年化收益 chart

- **Problem:** on the 5-year chart the 一次性投入 line appeared to start halfway. For the early starts the strategy's result was identical to 一次性投入, so the near-black dotted line lay exactly on the dark green solid line. The legend samples were solid bars for both lines, and the y axis used unrounded ticks with a negative label (−2.6%) when no value was negative.
- **Change:**
  - 一次性投入 is drawn in blue (`#4a6fb5`, dashed) on top of the setup line, so where they coincide the blue dashes show on the green line.
  - The gap between the setup and 一次性投入 is shaded: green where the setup is higher, red where it is lower; crossings are split at the crossing point.
  - Below the chart: `N 个起点的结果与一次性投入完全相同，两条线重合。` when N > 0 (equal to 1e-9 percentage points).
  - Legend samples are short SVG lines with each line's colour and dash pattern, plus the two shading swatches when 一次性投入 is shown.
  - The y axis uses round steps (1, 2, 2.5, 5, 10, 20, 25, 50 …) that include 0; there is no negative tick unless a value is negative. Year labels mark the x axis.
  - Palette checked with the dataviz validator: the new blue passes the normal-vision and CVD separation checks against the house green and the 对照 colour; the house colours keep their low chroma, with dash patterns as the second cue.

## 4. 起点分布 as visuals

- **Problem:** ten plain numbers.
- **Change:** the card keeps its header, the overlap caveat and the CSV link, and shows:
  - **年化收益分布** histogram: bins on round steps aligned to 0 (so no bin straddles 0), green for gains and red for losses, count above each bar, hover title with the bin range and count. Dashed markers for 25%分位, 中位 and 75%分位 with their values; the worst and best values labelled at the ends of the axis. The headline is the median.
  - **最大回撤** strip: the range from the deepest to the shallowest drawdown, the 25%–75% box and the median marker, with 最深, 中位 and 最浅 labelled. `rollingSummary.drawdown` gains `q1`, `q3` and `best`.
  - **Counts** as tiles with a fill bar: 亏损起点, 胜过一次性投入 (when shown) and 胜过对照 (when set). Counts stay `n / N`; no percentages.
- All figures remain in the markup as text so the tests and screen readers read the same numbers.
