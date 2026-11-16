# 组合模拟 方案对比 — design

Date: 2026-11-16. Status: design approved in conversation; third of four planned improvements to 组合模拟
(risk readout ✓ → generic strategies ✓ → allocation comparison → rolling start-date test).

## Why

多策略对比 varies the principal strategy for one allocation. Nothing lets a user put two allocations, or two
rebalancing rules, next to each other: they must run one, remember the numbers, edit the weights and run again.
The 2026-10-16 project review listed this as the next feature (组合方案对照) and asked that it live inside 组合模拟
instead of a second backtest page.

## Scope

In scope: saving the current settings as a named 方案, a fifth workspace tab 方案对比 that lists the saved 方案,
runs them together and shows one table, one overlaid chart and a CSV export.

Out of scope: an automatic row for unsaved settings (declined), import/export of the 方案 list (each 方案 can be
loaded and exported with the existing 导出配置), sharing 方案 between browsers, optimisation or ranking, PDF.

## What a 方案 is

A 方案 is a frozen copy of the full simulation configuration at the moment it is saved: holdings and weights,
initial and monthly amounts, principal and contribution methods, rebalancing, fee, cash rate, dividend handling
and tax. It has a name and an id.

- Stored in this browser under `changheng.portfolio.scenarios.v1`, separate from the working draft. At most 8.
- A name is 1–20 characters after trimming and unique among saved 方案. The field offers the first unused name of
  `方案A` … `方案H`.
- Saving requires the current settings to pass the same validation as 导出配置.
- 载入 replaces the working draft with the 方案 after a confirmation, because unsaved edits are lost.
  删除 removes it after a confirmation. Neither changes any other 方案.
- A stored entry that is not an object with a string id, a string name and a `positions` array is ignored on load.
  If storage cannot be written the page says so and keeps the list in memory.

## What is shared in a comparison

Every 方案 keeps its own account. The comparison overrides only three things, taken from the current settings when
开始对比 is pressed: the backtest window (`years`, `start`, `end`), the currency, and `benchmarkId` (cleared).
Amounts keep their numbers when the currency differs from the one a 方案 was saved in, the same rule the currency
switch already follows. The tab states the shared window and currency above the table.

`simulateScenarios(input, scenarios)` runs each 方案 through the existing engine and returns
`{ config: { years, start, end, currency }, start, end, scenarios: [{ id, label, result } | { id, label, error }] }`,
where `start` / `end` are the earliest start and latest end among the rows that ran.

Rows are independent scenarios. They are never summed, ranked or merged.

## Different dates

方案 with different holdings can have different common histories and market calendars, so their actual start or
end can differ by a few days, or a 方案 can lack the requested history altogether.

- A 方案 that cannot run shows its reason in its row, as 多策略对比 does. The others still run.
- A row whose actual dates differ from the first successful row shows its own dates under its name.
- When any dates differ, one line above the table says `各方案实际区间不同，收益不能直接比较。`
- No row is silently shortened, shifted or aligned.

## Interface

Workspace tabs: 模拟设置 | 我的组合 | 模拟结果 | 多策略对比 | 方案对比. On the new tab the primary button reads
开始对比 and is disabled with no saved 方案.

1. **已保存方案** — a name field and 保存当前设置为方案; then one row per 方案 with its name, a one-line summary
   (holdings with weights and cash, principal method, contribution when the budget is above 0, rebalancing) and
   载入 / 删除. Empty state: `还没有保存方案。在模拟设置和我的组合中配置好后，在这里保存。`
2. **对比结果** — header with the shared window and currency; table:
   方案 | 总投入本金 | 收益 | 盈亏 | 最大回撤 | 年化波动 | 收益回撤比 | 交易费 | 税费含预留 | 期末资产.
   收益 follows the page's 年化 / 累计 switch; 收益回撤比 uses the shared risk-ratio helper.
3. **走势** — the existing comparison chart with 收益率 / 回撤 / 账户资产 and a legend toggle per 方案.
4. 导出对比结果 CSV with the same columns plus actual dates, cash, XIRR and each 方案's configuration JSON.

When the saved list, the window or the currency has changed since the last run, the tab keeps the last result and
says so, as the other tabs do.

## Units

| Unit | File | Responsibility |
| --- | --- | --- |
| Scenario run | `assets/portfolio-model.js` | `simulateScenarios` |
| Storage, summary text, tab markup, CSV | `assets/portfolio-scenarios.js` (new) | no simulation, no global state beyond storage |
| Chart reuse | `assets/portfolio-comparison.js` | `plot` accepts the action prefix and noun; exported |
| Controller | `assets/portfolio.js` | tab, run, save / load / delete, confirmations |
| Styles | `assets/style.css` | list rows |
| Wiring | `index.html`, `package.json` | script tag and syntax check |

## Errors

- Saving invalid settings, a duplicate or empty name, or a ninth 方案: a toast with the reason; nothing is saved.
- A failed catalog refresh uses saved histories and says so, as elsewhere.
- A failed run keeps the previous comparison and reports the failure.

## Testing

- Model: each row equals a direct `simulate` of that 方案 with the shared window, currency and no benchmark; a failing
  方案 does not stop the others; `start` / `end` span the successful rows; input is not mutated.
- Storage: round trip; malformed entries ignored; names offered and validated; limit of 8.
- Interface: save, list and summary; load after confirmation replaces the draft; delete; run shows rows, the chart
  and the shared window; a 方案 with a younger asset shows its own dates and the warning line; stale notice; CSV.

Verification on the local site with three 方案 of the USD / TQQQ example (no rebalance, 5-point band, yearly), whose
figures must equal the single runs already recorded in the method doc.

## Delivery

Two commits, each pushed: the model function with the storage module and their tests; the tab, controller,
documentation and interface tests.
