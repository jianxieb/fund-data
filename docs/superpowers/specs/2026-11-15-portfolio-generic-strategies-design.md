# 组合模拟 generic strategy options — design

Date: 2026-11-15. Status: design approved in conversation; second of four planned improvements to 组合模拟
(risk readout ✓ → generic strategies → allocation A/B comparison → rolling start-date test).

## Why

Seven of the ten advanced strategies need TQQQ or the USD ETF. A portfolio of anything else can only choose a
calendar rebalance. Three options that every portfolio simulator is expected to have are missing:

- rebalancing when weights drift, instead of on a date;
- pointing new money at whatever is underweight, which rebalances without selling and so without gains tax;
- interest on idle cash. Cash earns exactly 0% today, which understates any account that holds a large cash
  share for years and tilts every comparison against strategies that wait in cash.

All three default to off. A configuration that does not mention them simulates exactly as before.

## Scope

In scope: three independent options, each with its engine change, settings control, results display, exports,
method documentation and tests.

Out of scope: take-profit rules, withdrawals, valuation-based contributions, relative (percent-of-target) bands,
combining a calendar with a band, historical cash-yield series, tax on interest, any change to existing signals.

## Configuration

| Field | Values | Default | Rejects |
| --- | --- | --- | --- |
| `rebalance` | adds `'band'` to `none / month / quarter / year` | `none` | unknown value |
| `rebalanceBand` | percentage points, `0 < x ≤ 50`; read only when `rebalance` is `band` | UI default 5 | missing or out of range when `band` |
| `contributionAllocation` | `'target'`, `'underweight'` | `'target'` | unknown value |
| `cashRate` | annual percent, `0 ≤ x ≤ 20` | `0` | not a number, out of range |

Older saved or imported configurations lack the three new fields and get the defaults. Exported JSON, CSV and PDF
carry the values actually used.

## 1. Threshold rebalancing (`rebalance: 'band'`)

Rule: at each common close the engine measures drift. If the drift measured at the previous common close was at
least the band, it rebalances at today's common close, at today's prices. This is the engine's existing causality
convention: the decision uses the previous close, the fill uses the current one.

```
权重_i = 持仓市值_i / 可再平衡资产          可再平衡资产 = 账户市值 − 待投入本金
偏离 = max_i | 权重_i − 当前目标_i |
```

- Market value is before the tax reserve, the same basis `rebalance` already trades on.
- `当前目标_i` is exactly the target the existing rebalance would restore that day: the configured weight for
  ordinary methods, 0 for a holding a timing rule has parked, the executed targets of the systematic methods, and
  the preserved stock share of a scoring sleeve. Sharing one target function guarantees drift is 0 immediately
  after a rebalance, so a triggered rebalance cannot re-trigger itself.
- Only holdings are compared. Cash is the residual.
- The first day never rebalances. A calendar key is not consulted in band mode.
- The rebalance itself is the existing one: fees, sale tax, reserves and strategy cash labels are handled as for a
  calendar rebalance. Its trades carry `reason: 'rebalance'` and the previous common close as `signalDay`.
- Known side effect, documented: between a systematic method's sale and its later purchase the account is away from
  its executed target, so a band can fire once in that gap.

## 2. Underweight-directed contributions (`contributionAllocation: 'underweight'`)

Applies to external contributions only, not to releases of unspent initial principal. With `D` deposited today,
`W` the rebalanceable assets including `D`, `r` the fee rate and `C` the free cash before the deposit:

```
缺口_i = max(0, w_i × W − 持仓市值_i)        现金缺口 = max(0, 现金目标 × W − C)
k = D / (Σ缺口_i × (1 + r) + 现金缺口)
买入_i = k × 缺口_i        买入费_i = r × 买入_i        留作现金 = k × 现金缺口
```

- The gaps always sum to at least `D`, so `k ≤ 1` and no holding is bought past its target.
- When everything is already on target the formula gives exactly the existing proportional purchase, including
  its fee handling. The option is a strict generalisation, not a second accounting.
- Nothing is sold. Timing, amount and count of contributions are unchanged; only where the money goes changes.
- Supported with 一次性投入, 6/12/24个月分批 and 回撤阶梯. Every other principal method manages positions or
  labelled cash itself; combining them fails with
  `优先补低配只能与一次性、分批或回撤阶梯投入同时使用`, reported on the principal-method field. The check
  applies only when the monthly budget is above 0.
- In 多策略对比 that message appears on the rows that cannot run, as other incompatibilities already do.

## 3. Cash interest (`cashRate`)

```
利息 = 现金 × ((1 + 年利率)^(日历天数 / 365.2425) − 1)
```

- Accrued at the start of each valuation day for the days since the previous one, on all cash in the account,
  including principal waiting to be released and cash a strategy has parked.
- Interest is return, not a deposit: it raises NAV, profit and XIRR, and never changes contributed capital.
- Strategy cash labels (待投入本金, a timing rule's reserve, a scoring sleeve's cash) are not scaled. Interest is
  free cash. Labels therefore never exceed real cash and existing reconciliation checks still hold.
- The rate is one fixed scenario assumption for the whole window, like the trading fee. The user enters an
  after-tax rate; no tax is computed on interest.
- The signal reference basket keeps zero-interest cash, so no drawdown or moving-average trigger moves when the
  rate changes.
- Reconciliation becomes `Σ持仓盈亏 + 累计现金利息 = 账户盈亏`. The 现金 row of 持仓贡献 shows the interest.

## Interface

模拟设置 › 交易策略:

- 再平衡周期 is renamed 再平衡方式 and gains 偏离阈值. Choosing it shows `偏离阈值 [5] 百分点` and one line:
  `任一持仓占比偏离目标达到阈值，下一共同交易日再平衡。`
- 持续投入 gains `追加资金去向`: 按目标比例 / 优先补低配. The 追加安排 text adds one sentence when the second
  is chosen.

模拟设置 › 回测条件: `现金年利率 [0] %`, after 计价币种.

模拟结果: 持仓贡献 shows 现金利息 in its notes and in the 现金 row when the rate is above 0. 多策略对比 and the
PDF name the band (`偏离5个百分点再平衡`); the PDF settings table lists 追加资金去向 and 现金年利率; the daily CSV
appends 累计现金利息 and the holdings CSV carries it on the cash row.

## Units

| Unit | File |
| --- | --- |
| Validation of the three fields; `allocationState`/`drift`; band trigger; `investUnderweight`; interest accrual; reconciliation | `assets/portfolio-model.js` |
| Settings controls, plan text, results notes, CSV | `assets/portfolio.js` |
| Rebalance label | `assets/portfolio-comparison.js` |
| Settings table and cash row | `assets/portfolio-pdf.js` |
| Control styles | `assets/style.css` |

`rebalance` is refactored so its target computation is shared with `drift`. That refactor changes no output and is
covered by the existing ledger tests.

## Errors

- Out-of-range band or rate, or an unknown allocation: the run fails with the field's message; nothing is clamped.
- Underweight with an unsupported principal method: fails as described, on that field.
- None of the three can make a previously valid configuration fail.

## Testing

Hand-computable fixtures in `tests/portfolio-generic.test.cjs`:

- band: no trade while drift stays under the band; a trade the day after the close that reaches it, at that day's
  prices; exact threshold counts; drift is 0 after the trade; fees and sale tax reconcile; band mode ignores the
  calendar; the first day never rebalances; ordinary calendar modes are unchanged;
- band with a parked timing sleeve does not buy the parked holding back;
- underweight: money goes only to the holding below target; split in proportion to gaps; never past target; equals
  the proportional purchase exactly when on target, with a fee; cash share kept; nothing sold and no capital tax;
  rejected with a timing method and accepted when the monthly budget is 0;
- interest: one year at 3% on idle cash; compounding across uneven day gaps; waiting tranche principal earns it;
  NAV and XIRR rise while contributed capital does not; holdings profit plus interest equals account profit;
  signals identical with and without a rate;
- defaults: a configuration without the new fields gives a ledger deep-equal to today's.

Interface and export cases are added to the existing UI and PDF suites. The independent Python ledger from the
audit is extended with the three rules and compared on real portfolios before each engine commit.

## Delivery

Three engine changes, each committed and pushed with its own controls, documentation and tests: threshold
rebalancing; underweight contributions; cash interest. Asset versions are regenerated in every commit.
