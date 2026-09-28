# 杠杆 ETF 收益复核

复核日期：2026-09-28。已发布策略快照截止 2026-09-25，五个起点、288 组标的与投入方式组合。回测逐日使用 **ETF 自身**的 Yahoo Finance `indicators.adjclose` 复权收盘价，不把标的指数收益乘以 2 或 3。ETF 内部费用已影响历史价格；脚本假设券商佣金、交易税费、滑点和现金利息均为零。每日目标杠杆不是跨年固定倍数。

## 与发行人长期业绩交叉核对

用本机保存的复权价，在 2016-08-31 至 2026-08-31 的相同十年区间独立计算 `(终值 / 初值) ^ (365.2425 / 实际天数) - 1`。发行人列为截至 2026-08-31 的 **Market Price 10Y 年化**；Yahoo 列为复权收盘价，发行人使用市价口径，二者不要求逐位相同。

| ETF | 发行人 10Y | 本地 Yahoo 复算 | 差值（百分点） |
| --- | ---: | ---: | ---: |
| [SSO · ProShares](https://www.proshares.com/our-etfs/leveraged-and-inverse/sso) | 23.59% | 23.5952% | +0.0052 |
| [UPRO · ProShares](https://www.proshares.com/our-etfs/leveraged-and-inverse/upro) | 29.07% | 29.0718% | +0.0018 |
| [QLD · ProShares](https://www.proshares.com/our-etfs/leveraged-and-inverse/qld) | 33.21% | 33.2533% | +0.0433 |
| [TQQQ · ProShares](https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq) | 40.46% | 40.4552% | -0.0048 |
| [USD · ProShares](https://www.proshares.com/our-etfs/leveraged-and-inverse/usd) | 53.62% | 53.6255% | +0.0055 |
| [SOXL · Direxion](https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs) | 45.73% | 45.7383% | +0.0083 |

六只最大差值为 0.0433 个百分点。这项交叉核验能排除拆分处理导致的数量级错误，不能代替对每日供应商价格或每笔可成交价格的独立审计。半导体组只是行业归类：[USD](https://www.proshares.com/our-etfs/leveraged-and-inverse/usd) 当前追踪道琼斯美国半导体指数；[SOXX](https://www.ishares.com/us/products/239705/SOX) 与 [SOXL](https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs) 当前均使用 NYSE Semiconductor Index，但两者历史中曾变更基准，详见 [iShares 年报](https://www.ishares.com/us/literature/annual-report/ar-soxx-en.pdf)及 [Direxion 公告](https://www.direxion.com/uploads/Direxion-Changes-Index-for-Semiconductor-ETFs.pdf)。不能把整个历史区间的三只基金当作同一指数的固定 1×/2×/3× 组合。

## 独立重算回测账本

`python3 scripts/audit_strategy.py` 使用本机原始历史缓存，另建现金加 ETF 份额账本，再以二分法求期末资金加权年化；它不调用生产脚本的 `simulate` 或 `xirr`。本次 288/288 组通过：期末金额最大差 $0.004988；XIRR、最差账面盈亏、净值最大回撤与平均仓位最大差均不超过 0.000050 个百分点；低于本金最长、净值最长水下及交易次数完全一致。脚本还检查月投、季投、年投的总预算相等。新电脑先联网运行 `python3 strategy_backtest.py --refresh`，再运行该审计脚本；原始行情缓存不入库。

以 2010-03-11 至 2026-09-25 的 TQQQ 为例，一次性投入 $100,000 的期末金额为约 $30,626,075，年化 41.35%，期间现金流中性净值最大回撤约 -81.7%。高年化与高风险同时来自真实的长期价格路径。2020 起点的 TQQQ 每月定投投入 $81,000、期末约 $316,809、XIRR 40.43%；回撤倍数定投投入 $165,000、期末约 $733,012、XIRR 45.08%。不同投入总额不能只比较期末金额，跨多年折算的 XIRR 也可能把巨大的美元差异压缩为数个百分点。

满仓定投同一只 ETF 时，剔除外部入金影响的单位净值路径相同，因此净值最大回撤、最长水下和平均仓位相同。这不是账户经历相同：表中新增的“最差账面盈亏”是每日账户金额相对当日累计投入本金的最低比例，“低于本金最长”是连续低于累计投入本金的交易日数。两项随着入金节奏变化；若几种方法在最差时点之前的入金安排完全一样，也可能出现相同值。例如两种 200 日均线月投方法在前 200 个交易日尚无均线信号，都按基础金额投入。

发行人对 [TQQQ](https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq) 和 [SOXL](https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs) 都明确说明倍数目标是**单日**，长期收益受逐日复利和波动影响；历史区间、起点和实际成本改变结论。
