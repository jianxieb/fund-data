# 美股ETF：现金分配、DRIP与内地居民税务

入口：指数观察 → 产品的“近12月现金分配率 / 分红详情”，或ETF详情 → “分红、再投与税”。指数表将持续年费与现金分配率拆成两列，各列标题和内容对齐。同一详情保留“表现与费用”页签。已收录ETF全部覆盖；不将回测再投假设当成客户已开启券商DRIP。

详情按“当前分配率 → 近12月收益拆分与分配税影响 → 历年表 → 逐笔记录”排列。分类证据、现金与DRIP操作、三家账户对比保存在下方可展开的规则区，不挤占数值阅读区。

## 现金记录与刷新

`scripts/build_etf_distributions.py`在组合原始行情刷新后，读取`.tmp-portfolio/dividends/`中的Yahoo现金事件，生成`data/etf-distributions.js`。证券代码、美元币种、交易所时区、首末日覆盖、除息日对应行情、非负金额、拆分与重复日期分别验证。前端支持按年份查看全部已收录记录。

- 日期是**除息日**，来源未提供支付日。不得改名为到账日，亦不推算支付日。
- 金额直接保留供应商记录精度，部分仅三位小数；不由复权收益或分红占比反算，不把供应商取整值说成发行人原始精度。
- Yahoo历史金额可能反映后续拆分。保存拆分日期，标注其前的记录；不再乘除拆分比例，不把调整后的每份金额当成当年的原始到账金额。
- `through`取与已发布组合历史一致的覆盖日，不能换成生成当天。现金记录截止日不代表今日实时公告。
- 无正现金事件与缺数据分开。月度计划不保证每个月有正分配（如TIP），不把空月份补成一笔零元派息。
- 缺原始缓存时保留前次已发布记录；若落后于价格覆盖日，显式标注缺哪一日之后的现金记录。首次无证据则失败，不造零值。
- 普通收盘价、每份现金和除息日前一交易日价格使用相同的拆分调整单位。每笔保存`referenceDate`、`referencePrice`、`pricePercent`；另保存`metrics.trailing`和`metrics.annual`，可在无缓存环境中核对公式、现金合计和比例。旧记录若缺普通收盘价，显示具体缺口，不从复权回报反推。
- 定时刷新在初次运行及整合远端后的重跑中均生成此文件；Pages部署前以`--check`验证，无需本地缓存。

```sh
python3 scripts/build_portfolio_data.py --refresh
python3 scripts/build_etf_distributions.py
python3 scripts/build_etf_distributions.py --check
npm run version-assets
```

## 百分比与收益构成

设期初普通收盘价为P0，期末普通收盘价为P1，期间每份现金分配合计为D。价格与现金以美元计、均按相同拆分单位调整。这里模拟持有份数不变、领取现金且不再投；现金按除息日确认应收，不模拟支付延迟和现金利息。

| 页面数值 | 公式 | 分母及含义 |
| --- | --- | --- |
| 单次分配率 | 当次每份现金 / 除息前最近收盘价 × 100% | 当次除息前的市价；不是乘频率得到的年化值 |
| 近12月现金分配率 | 截至日前12个月的每份现金合计 / 截至日收盘价 × 100% | 当前市价；包含来源所列全部现金，可能含ROC，不是SEC收益率、NAV收益率或纯利息率 |
| 价格涨跌 | (P1/P0 − 1) × 100% | 期初本金；普通收盘价不含现金再投 |
| 现金分配回报 | D/P0 × 100% | 与价格涨跌使用同一期初本金 |
| 合计回报 | 价格涨跌 + 现金分配回报 | 税前、现金不再投；不等于指数表的复权再投收益 |
| 现金占同期净收益 | 现金分配回报 / 合计回报 × 100% | 同期税前净收益，不是本金 |
| 分配税使回报减少 | 现金分配回报 × 条件税负 | 单位为**百分点**，不是本金或全部收益的税率 |
| 税款占原净收益 | 分配税使回报减少 / 合计回报 × 100% | 同期税前净收益 |

收益区间的现金事件满足`期初收盘日 < 除息日 <= 期末收盘日`。期初就在除息日收盘时买入，不能获得该笔现金；期末除息应收计入。起止参考交易日最多向前寻找7个自然日，缺端点即列明缺哪段日期；近12月分配率要求至少完整12个月记录，短历史不年化。

年度表从上一年最后交易日收盘到该年末；最新未结束年份是截至日累计值，不年化。源数据第一年若不足整年，显示“历史起点后”，悬停年份可见实际日期。年度每份现金额和现金回报并列，方便核对金额与百分比。

亏损或合计回报不超过0.01%时，不显示现金占收益及税占收益比，避免负占比或接近零分母放大误导。若价格下跌、现金使合计仍为正，占比可以超过100%，不截断。ROC属于现金流，不保证其对应经济利润；例如100跌至90、分配10，合计回报仍为0。

税务情景沿用下方已解释的条件：普通股息美国协定10%、内地抵免后另缴10%；符合QII的情景假设美国0%、内地20%。均为分配金额合计20%的**固定条件演算**，不是任意可选扣税率，也不是逐年实际账户税单。只有分配税计入，未模拟卖出所得税、汇率、费用或纳税时点。其他ETF未收录最终分类时，该条件不会变成其实际分类；QQQI内地ROC分类未确认，不填实际税后回报，仅给“分配金额每多缴1%税，回报减少多少个百分点”的数学敏感度。

截至2026-10-13，QQQ近12月现金3.091美元 / 743美元市价＝0.4160%；同一持有期价格回报23.4199%、现金回报0.5134%，合计23.9333%，现金占净收益2.1453%。20%分配税情景减少0.1027个百分点，占原净收益0.4291%。这些百分比不同，原因是各自回答的问题与分母不同。

方法参考：[Vanguard对价格、现金与总回报的定义](https://investor.vanguard.com/investor-resources-education/portfolio-management/performance-details)、[SEC对基金分配及ROC的说明](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins/fund-distributions-investor-bulletin)。产品持续费用已反映在价格中，未重复减费；未向股息复权价再加现金。

## 分类证据与适用边界（2026-10-16核对）

| 分类 | 本次证据 | 页面如何使用 |
| --- | --- | --- |
| QQQ、SPY普通股息 | 发行人2025年最终ICI表；[已有抽取证据](evidence/buy-location-tax/issuer-distributions-2025.json) | 说明该年所列4笔分类，不外推2026年每笔 |
| QQQI ROC | [正式8937](https://neosfunds.com/wp-content/uploads/NEOS-Nasdaq-100-High-Income-ETF-Form-8937-12.31.25.pdf)第3页，2026-02-27签署 | 2025-12-26支付每份0.64128519美元，其中0.63870371为ROC；不把月度19a估计代替最终分类 |
| SGOV、SHY、IEI、IEF、TLH、TLT、GOVT、TIP的QII | [iShares 2025 NRA QII文件](https://www.ishares.com/us/literature/tax-information/2025-ishares-qualified-interest-income-summary-stamped.pdf)；[抽取记录、页码与SHA256](evidence/etf-distributions/ishares-qii-2025.json) | 各基金所列正金额收入分配QII比例100%；TIP为10笔，其余12笔。支付日保留原义，不与Yahoo除息表混表 |
| 其他ETF | 逐笔现金事件与发行人频率已收录，最终年度税务分类尚未收录 | 标明缺哪只基金的年度分类；仅显示有条件的普通股息示例，不给最新分配编造税后数 |

[IRS Publication 519](https://www.irs.gov/publications/p519)列明合资格利息相关分配的非居民预扣豁免；这不是所有债券ETF、所有年度永久0%的依据，也不是美国居民州税政府债收入比例表。

现金与DRIP使用同一税务条件。普通股息示例：税前1,000美元，已落实中美10%协定及有效抵免，美国先扣100、内地抵免后另缴100；DRIP可用先到账900扣交易费用后再买，仍须另备内地税。QII示例明确假设整笔免美国预扣，内地20%为200。它们不是三家渠道各自的客户扣税保证。ROC内地分类与成本处理未确认，不生成精确最终税款。

依据：[中美协定第9、22条](https://www.irs.gov/pub/irs-trty/china.pdf)、[个人所得税法](https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html)、[境外所得2020年第3号公告](https://www.chinatax.gov.cn/chinatax/n810214/n810641/n2985871/n2985888/n2985983/c5143075/content.html)。按内地税收居民、非美国税务人士解释；国籍、香港开户地点不能替代税收居民判断。

## 三家账户证据

- **IBKR**：[Dividend Election](https://www.ibkrguides.com/brokerportal/dividendelection.htm)确认现金与再投设置、持仓覆盖设置、通常佣金及实体条件；资格与碎股须在账户内核对。官方[预扣税课程员工答复](https://www.interactivebrokers.com/campus/trading-lessons/what-kind-of-income-is-subject-to-withholding/)2025-08-14确认美国ROC重分类退款，2025-11-24以SGOV说明年度分类调整误扣，2026-01-13提示实体与清算链限制。不能承诺所有预扣均可退或退款后自动再次再投。
- **汇丰香港Trade25**：[投资FAQ](https://www.hsbc.com.hk/help/faq/investments/)确认现金公司行动、最高30%和W-8BEN协定申请，按托管指示处理；[条款5.1.8](https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/accounts/personal-integrated/terms-and-conditions-3sep.pdf)不承诺税款追索服务。没有取得这批美股ETF统一DRIP或ROC/QII自动退款承诺；“以股代息”不能代替DRIP证据，不写成所有客户固定30%且法律上永远不能退款。
- **富途香港**：[官方DRIP指引](https://www.futuhk.com/hans/support/topic2_1770)确认综合账户、碎股权限、标的资格、净预扣税后现金再投和非整股订单收费；入口为账户→更多→交易→股息再投。未取得这些ETF自动办理ROC/QII退款的官方承诺。不能把“有DRIP服务”升级为“30只ETF全部可用”。

## 验证

Python测试验证真实现金与价格收益分离、拆分不二次调整、除息与支付日期不混用、错误身份拒绝、零事件和缺行情区分、旧数据保留及QII证据一致性。JS测试验证现金与DRIP税额一致、未确认ROC税不能变0、年份筛选和三家账户的限定条件。新增UI在本地检查；按用户偏好不打开生产页面做核对。

2026-10-16首版：519项JS、349项Python检查通过，资源摘要及分配数据检查通过。桌面预览验证QQQ现金 / 再投、SGOV的QII年度限定、QQQI的ROC缺口、2025年记录筛选与键盘页签切换；浏览器无错误日志。[首版QQQ详情截图](evidence/etf-distributions/qqq-cash-drip.jpg)及[三家账户截图](evidence/etf-distributions/broker-comparison.jpg)保存当时实际本地界面。

2026-10-16百分比改版：522项JS、357项Python检查通过。新增验证覆盖不同分母、亏损与近零收益、现金占比超过100%、首日除息排除、短历史、闰日、拆分不重复调整及分配税的百分点计算；30只ETF的3,081笔记录及收益拆分均通过发布校验。本地检查QQQ的当前/历史比例与2025年筛选、QQQI的ROC缺口、TLT亏损期占比抑制，浏览器无错误日志。[年费与分配率拆列](evidence/etf-distributions/index-distribution-rates.jpg)、[QQQ收益构成与税收影响](evidence/etf-distributions/qqq-distribution-percentages.jpg)记录实际界面；这些验证不代替用户对排版的验收。
