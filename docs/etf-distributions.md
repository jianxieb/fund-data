# 美股ETF：现金分配、DRIP与内地居民税务

入口：指数观察 → 产品的“现金分配”链接，或ETF详情 → “分红、再投与税”。同一详情保留“表现与费用”页签。已收录ETF全部覆盖；不将回测再投假设当成客户已开启券商DRIP。

## 现金记录与刷新

`scripts/build_etf_distributions.py`在组合原始行情刷新后，读取`.tmp-portfolio/dividends/`中的Yahoo现金事件，生成`data/etf-distributions.js`。证券代码、美元币种、交易所时区、首末日覆盖、除息日对应行情、非负金额、拆分与重复日期分别验证。前端支持按年份查看全部已收录记录。

- 日期是**除息日**，来源未提供支付日。不得改名为到账日，亦不推算支付日。
- 金额直接保留供应商记录精度，部分仅三位小数；不由复权收益或分红占比反算，不把供应商取整值说成发行人原始精度。
- Yahoo历史金额可能反映后续拆分。保存拆分日期，标注其前的记录；不再乘除拆分比例，不把调整后的每份金额当成当年的原始到账金额。
- `through`取与已发布组合历史一致的覆盖日，不能换成生成当天。现金记录截止日不代表今日实时公告。
- 无正现金事件与缺数据分开。月度计划不保证每个月有正分配（如TIP），不把空月份补成一笔零元派息。
- 缺原始缓存时保留前次已发布记录；若落后于价格覆盖日，显式标注缺哪一日之后的现金记录。首次无证据则失败，不造零值。
- 定时刷新在初次运行及整合远端后的重跑中均生成此文件；Pages部署前以`--check`验证，无需本地缓存。

```sh
python3 scripts/build_portfolio_data.py --refresh
python3 scripts/build_etf_distributions.py
python3 scripts/build_etf_distributions.py --check
npm run version-assets
```

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

2026-10-16：519项JS、349项Python检查通过，资源摘要及分配数据检查通过。桌面预览验证QQQ现金 / 再投、SGOV的QII年度限定、QQQI的ROC缺口、2025年记录筛选与键盘页签切换；浏览器无错误日志。[QQQ详情截图](evidence/etf-distributions/qqq-cash-drip.jpg)及[三家账户截图](evidence/etf-distributions/broker-comparison.jpg)保存实际本地界面。
