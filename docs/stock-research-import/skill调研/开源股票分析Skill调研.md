# 2026-09-30 复核与修订

原调研保留在下方，代表2026-09-02的研究记录。此次重新读取5个公开仓库的7份具体skill，完整对照、版本和实现验证见 [本次多方比较](../../research/stock-skill-comparison-2026-09-30.md)。

- 撤回用固定PE、混合EPS预测、重复机构样本生成合理价格的做法；原方案的方向可用，原脚本尚不能直接复现。
- 不以star数、品牌或“社区最强”判断研究可靠性。Anthropic的分步建模有用，其篇幅要求与净债务权重示例不直接移植；其余四类方法分别检查数据来源、行业适配、现金回收、治理及固定评分的局限。
- 已将统一输入、5年/8季、公告截止、股息归属、证据反证与金融行业路由落实到本项目的company-report skill及计算脚本。
- 实际比较为指令及相关源码审阅，不冒充执行过所有外部付费数据链路。源仓库未改动；修改后的版本与最新报告在本项目维护。

---

## 以下为9月2日原始调研（不代表当前评定）

# 开源股票分析 Skill / 工具调研报告（个股 + 行业/概念板块）

- 调研目标：找"可用于分析个股或板块（行业/概念）的开源 agent skill / 工具"，重点核实权威性（第一方/官方仓库）。
- 核实方式：每个候选都回到其 GitHub 仓库页/官方站点逐项核实（stars、license、最近提交、是否 archived、README 实际声称的能力）；部分能力做了代码级取证（GitHub code search 确认接口/指标是否真实存在）。
- 核实时间：2026-09-02（stars / pushed_at 以 GitHub API 当天返回值与 PyPI 页面为准）。
- 判定分档：**【官方/权威】** = 第一方或官方组织仓库；**【社区高星但非官方】** = 第三方但维护活跃、社区认可；**【低质量/弃维护】** = 低星、停更或能力未证实。

---

## ① TL;DR 结论摘要

1. **"权威的 A 股板块/KDJ 分析 skill"目前不存在成品**：Anthropic 官方技能库 [anthropics/skills](https://github.com/anthropics/skills)（19 个 skill）**完全没有金融/股票类 skill**（已逐个列出核实）；Anthropic 官方的 [anthropics/financial-services](https://github.com/anthropics/financial-services)（34.6k stars，Apache-2.0，2026-08-25 仍在提交）**是唯一官方金融类 Agent Skills 仓库**，但定位是机构投研（IB/卖方研究/PE/财富管理，数据连接器为 LSEG、S&P Capital IQ、FactSet、Morningstar 等），**不覆盖 A 股、板块资金流、KDJ 技术面**。
2. 因此 **(a) 类"可直接拿来用的权威 skill"品类是空的**——凡声称"A股分析 skills"的仓库（ZICXR/A-Stock-Skills、lzwme/finance-quant-skills、aifinlab/FinClaw 等）全部是 2026 年新起的**社区项目**，stars 在 23–302 之间，无一来自官方组织，且多数**无许可证声明或未经真实使用验证**。结论不是"挑一个用"，而是"自建 SKILL.md 包装 + 权威数据积木"。
3. **数据层"积木"里最权威、最匹配需求的是 [AKShare](https://github.com/akfamily/akshare)**（官方组织 akfamily，22.4k stars，MIT，2026-08-28 仍日更）：代码级确认其**同时覆盖**个股日线行情、行业板块（`stock_board_industry_name_em`）、概念板块（`stock_board_concept_name_em`）、板块资金流（`stock_sector_fund_flow_rank`）、个股资金流（`stock_individual_fund_flow_rank`）。**KDJ 需要自己算**（AKShare 只给原始行情，全生态没有权威库内置 A 股 KDJ）。
4. **A 股 MCP server 全部是社区低星新项目**：之前提到的 [CharmYue/ashare-mcp](https://github.com/CharmYue/ashare-mcp)（7 stars，MIT，stdio+Streamable HTTP，30 tools，含板块资金流，但无内置 KDJ）和 [27dream/mcp-eastmoney](https://github.com/27dream/mcp-eastmoney)（7 stars，MIT，5 tools，板块资金流现成，KDJ 明确列为"计划中"未实现）工程质量和文档都不错，但 stars 极低、均为单次/短期提交，**属"社区新项目"而非"权威"**。官方级的 MCP 只有 [OpenBB 官方 MCP server](https://github.com/OpenBB-finance/OpenBB/tree/develop/openbb_platform/extensions/mcp_server)（AGPL-3.0），但它面向美股/国际市场，**没有东财式 A 股板块资金流**。
5. **东方财富、同花顺均无官方开源 SDK**（如实结论）：东财只有付费的 Choice 量化接口（官方页面 quantapi.eastmoney.com，闭源）；同花顺 iFinD 只有付费终端接口。GitHub 上所有"东财 SDK"（efinance 4k stars、easyquotation 等）和"同花顺 SDK"均为第三方逆向封装——**社区高星但非官方，且接口随时可能失效**。
6. **其他官方权威积木**：Microsoft Qlib（48.2k stars，MIT，活跃）是 AI 量化**研究/回测**平台，不是行情监控，A 股数据需自行接入；TuShare（15.4k stars，BSD-3，官方 org）SDK 仓库 2024-03 后停更但 Pro 数据服务仍在运营，**板块资金流接口 moneyflow_ind_dc 需要积分权限**；baostock（BSD，PyPI 0.9.3 发布于 2026-07-10 仍在发版）免费但只有历史行情/财务，**无实时、无板块资金流**；富途 [FutunnOpen/py-futu-api](https://github.com/FutunnOpen/py-futu-api)（官方，Apache-2.0，1.3k stars）是唯一同时官方、活跃且代码级证实有**板块列表 + 资金流向**接口的 SDK，但需要 FutuOpenD 网关和富途账户。

---

## ② 各类别明细

### (a) Agent Skills（SKILL.md 格式，Claude Code 等可直接加载）

**1. anthropics/financial-services（Claude for Financial Services）— 官方/权威，但能力不对口**
- 仓库：https://github.com/anthropics/financial-services ｜ 34,630 stars ｜ Apache-2.0 ｜ 创建 2026-02-23，最近 push 2026-08-25（活跃，未 archived）
- README 实际声称（已全文读取核实）："Reference agents, skills, and data connectors for… investment banking, equity research, private equity, wealth management"。含 10 个命名 Agent（Pitch Agent、Market Researcher、Earnings Reviewer、Model Builder、GL Reconciler、KYC Screener 等）+ 垂直插件（financial-analysis 核心：comps/DCF/LBO/3-statement；equity-research：`/earnings` `/initiate` `/sector` `/screen` 等；investment-banking / private-equity / wealth-management 等）+ LSEG、S&P Global 合作插件。仓库内共 117 个 SKILL.md（代码搜索计数）。
- 个股能力：有（机构基本面口径：可比公司、DCF、财报更新、盈利点评，数据来自 LSEG/S&P/FactSet 等 12 个商业 MCP 连接器）。
- 板块能力：有"行业/主题概览"（`sector-overview` `/sector`、"Market Researcher"做行业格局+竞对），但**是美股/全球机构数据**；无东财式板块涨幅/资金流/热度。
- KDJ 等技术指标：**无**（全仓库为基本面投研 skill）。
- 权威性判定：**【官方/权威】**（Anthropic 第一方）。对你的 A 股技术面需求**不匹配**，但它是"官方 skill 长什么样"的规范范本，且官方明确支持 `Swap connectors — point .mcp.json at your data providers`，即**可以把它的框架思路套到东财 MCP 上**。
- 出处：仓库页；README（cdn.jsdelivr.net/gh/anthropics/financial-services@main/README.md）；skillsauth.com/skills/anthropics/equity-research。

**2. anthropics/skills（官方技能库）— 官方/权威，金融类为空**
- 仓库：https://github.com/anthropics/skills ｜ Apache-2.0（Anthropic 官方）
- 实际内容（已列出全部 19 个目录核实）：academy-guide、algorithmic-art、brand-guidelines、canvas-design、claude-api、discernment-nudge、doc-coauthoring、docx、frontend-design、internal-comms、mcp-builder、pdf、pptx、skill-creator、slack-gif-creator、theme-factory、web-artifacts-builder、webapp-testing、xlsx —— **无任何金融/股票/板块类 skill**。
- 权威性判定：**【官方/权威】**；结论是"该品类在官方库中为空"，其 `template/` 与 `skill-creator` 是你自建 SKILL.md 时的官方规范参考。
- 出处：https://github.com/anthropics/skills（仓库目录列表）。

**3. lzwme/finance-quant-skills — 社区高星但非官方（A股 skill 集合里相对最值得参考）**
- 仓库：https://github.com/lzwme/finance-quant-skills ｜ 302 stars ｜ 创建 2026-03-25，最近 push 2026-06-29 ｜ **根目录无 LICENSE 文件（API 返回无 license 字段，已列目录核实）**
- 内容（已列目录核实）：13 个 skill：akshare、baostock、tushare、backtrader、equity-researcher、joinquant-docs、jqdatasdk、miniqmt、pywencai、qmt-docs、rqalpha、tdxquant、akquant。其中 `skills/akshare/SKILL.md` 已全文读取：结构规范（frontmatter/任务目标/脚本映射/示例/注意事项），把 AKShare 当数据工具库文档化并配可执行脚本。
- 个股能力：有（K线/行情/财务脚本映射）。板块/KDJ：skill 本身不内置"板块资金流/KDJ"成品流程，需 agent 按 AKShare 接口自行组合。
- 权威性判定：**【社区高星但非官方】**（同类最高星）；⚠️ **无许可证声明**（法律上默认保留版权），只宜作为"怎么写 SKILL.md"的参考或复制其思路，不宜直接商用再分发。
- 出处：https://github.com/lzwme/finance-quant-skills 及其 skills/akshare/SKILL.md。

**4. ZICXR/A-Stock-Skills — 社区低星新项目（能力宣称与你的需求恰好吻合，但未经验证）**
- 仓库：https://github.com/ZICXR/A-Stock-Skills ｜ 23 stars ｜ MIT ｜ 创建 2026-06-20，最近 push 2026-06-25（5 天冲刺后停更；29 个 skill 已归档到 archive-v1 分支，主线留 10 个）
- README 声称（已全文读取）：10 个核心 skill，含 **stock-technical-analysis（"MACD 金叉、KDJ 死叉、站上 20 日均线"）**、screener（全市场条件筛选）、watchlist-monitor（自选股监控+告警）、report（今日复盘/个股研报）、trade-journal（AI 推荐复盘）等；多源 fallback（ifzq gtimg → sina → 东财 → akshare）；不接券商账号。
- 个股能力：声称覆盖（行情/K线/技术面/筛选/研报）。板块能力：**未见专门的"板块资金流/板块热度"skill**（有 market-analysis 层但主线 10 个核心里没有板块资金流工具）。KDJ：声称支持（含 KDJ 死叉判断），**但我未运行验证，无 tests、无 issue 记录，stars 极低**。
- 权威性判定：**【低质量/未证实】**（社区新项目：2 个月龄、23 stars、无测试、已停更）。可 clone 学习其 SKILL.md+main.py 组织方式，不建议作为生产依赖。
- 出处：https://github.com/ZICXR/A-Stock-Skills（README）。

**5. aifinlab/FinClaw — 社区中星、金融技能集合（含同花顺/ifind 数据 skill）**
- 仓库：https://github.com/aifinlab/FinClaw ｜ 233 stars ｜ Apache-2.0 ｜ 创建 2026-03-17，最近 push 2026-05-13
- 内容：金融智能体技能集合，代码搜索确认含 `skills/ths-skill`（同花顺数据 skill）、ifind-data 相关 skill 等；**各 skill 具体能力未逐条核实**。
- 权威性判定：**【社区高星但非官方】**；可作为补充参考，重点看它的 ths-skill 怎么写同花顺数据源。
- 出处：https://github.com/aifinlab/FinClaw ；skills/ths-skill/SKILL.md。

> 该类小结：**权威成品缺失**。官方只有"机构美股投研"skill（financial-services），A 股技术面/板块类全靠社区新项目；最务实的路线是自建（见 ③）。

### (b) 金融数据 / 股票分析 MCP server

**6. CharmYue/ashare-mcp — 社区低星，但 A 股 MCP 里工程化程度最高（含板块资金流）**
- 仓库：https://github.com/CharmYue/ashare-mcp ｜ 7 stars ｜ MIT ｜ 创建 2026-06-02，push 2026-06-02（基本是一次性交付，之后未再提交）
- 协议：**stdio + Streamable HTTP 双传输**（README 明确；fastmcp 3.x 实现）。
- README 声称（已全文读取）：30 个 tool：实时行情、日/分钟K线、个股资料、**资金流向（个股/大盘/板块资金流排名/主力资金流排名）**、龙虎榜、融资融券、沪深港通、筹码分布、财报/业绩预告/公告/研报、涨停池等；主源 akshare，K线/财报失败自动降级 baostock，可选 tushare；SQLite 分级缓存；并诚实标注"主力/大单资金流是东财按成交金额分桶的软指标""北向资金已停用"。
- 个股能力：✅（行情/K线/资金流/财报/龙虎榜）。板块能力：✅ 板块资金流排名（`get_sector_fund_flow_rank`，代码 `src/ashare_mcp/tools/fundflow.py` 可见）。KDJ：**无内置计算**（代码搜索 kdj 为 0 命中），需客户端自算。
- 权威性判定：**【社区高星但非官方→实际应为"社区新项目"】**：7 stars、单次提交，但文档/降级/缓存/错误处理明显用心，README 的数据可靠性边界表值得一读。⚠️ 快速开始文档以 macOS（brew/launchd）为例，Windows 需自行用 uv 适配。
- 出处：https://github.com/CharmYue/ashare-mcp（README 全文）。

**7. 27dream/mcp-eastmoney — 社区低星，"板块资金流"现成，KDJ 明确未实现**
- 仓库：https://github.com/27dream/mcp-eastmoney ｜ 7 stars ｜ MIT ｜ 创建 2026-06-13，push 2026-06-19
- 协议：stdio（`uvx mcp-eastmoney` 一键，Claude Desktop/Cursor 配置文档齐全）。
- README 声称（已全文读取）：5 个 tool：`get_stock_quote`（实时行情）、`search_stock`、`main_fund_rank`（主力资金排名）、`sector_fund_flow`（**行业/概念板块资金流向+领涨股**）、`get_kline`（日/周/月K线，前复权）；数据源为东财公开**延时**接口 push2delay（README 自称约 15 分钟延迟），免 key。
- 个股能力：✅（行情/K线/主力资金）。板块能力：✅ 行业+概念板块资金流（正是你要的）。KDJ：**未实现**——README 路线图明确写着"技术指标计算（MA/MACD/KDJ）"为待办。
- 权威性判定：**【社区新项目】**（7 stars、低龄）；对"板块资金流"需求是上手最快的 MCP，但数据延时 + 无 KDJ + 东财逆向接口随时可能失效，需自行兜底。
- 出处：https://github.com/27dream/mcp-eastmoney（README 全文）。

**8. OpenBB MCP Server（OpenBB-finance/OpenBB 官方扩展）— 官方/权威，但 A 股能力有限**
- 仓库：https://github.com/OpenBB-finance/OpenBB（MCP 扩展位于 `openbb_platform/extensions/mcp_server`）｜ 72,586 stars ｜ **AGPL-3.0**（LICENSE 已全文读取："All files in this repository are licensed under the GNU Affero General Public License v3.0"）｜ 最近 push 2026-07-30（活跃）
- 协议：默认 **streamable-http**，支持 `--transport stdio/sse`（README 已读）。
- 能力：把 OpenBB Platform 的 REST 全品类变成 MCP tools（equity/crypto/economy/news/fixedincome/derivatives/etf/currency/commodity/index/regulators），带 per-session 工具发现、内置 skill 资源（`skill://<name>/SKILL.md`）。
- 个股能力：✅（美股/国际市场行情、基本面、估值、新闻）。板块能力：有行业/板块类数据（以美股/国际 provider 为准），**东财式 A 股板块资金流未发现**（A 股覆盖能力**未逐条核实**）。KDJ：无。
- 权威性判定：**【官方/权威】**（OpenBB 第一方）；注意 AGPL 传染性（若你把修改版对外提供服务需开源，纯自用无碍），且其数据以付费 API key 驱动，A 股不是主场。
- 出处：https://github.com/OpenBB-finance/OpenBB 及 `openbb_platform/extensions/mcp_server/README.md`、`LICENSE`。

**9. HuggingAGI/mcp-baostock-server — 社区中星，仅历史行情，无板块/资金流**
- 仓库：https://github.com/HuggingAGI/mcp-baostock-server ｜ 118 stars ｜ 创建 2025-04-08，push 2026-03-22 ｜ **根目录无 LICENSE 文件（已列目录核实）**
- 能力：把 baostock 包装成 Python MCP（历史K线、财务等）；baostock 本身无实时行情、无板块资金流。
- 权威性判定：**【社区高星但非官方】**（MCP 品类里 stars 较高的 A 股服务器，但底层数据源就缺板块/资金流能力）。
- 出处：https://github.com/HuggingAGI/mcp-baostock-server。

### (c) 权威开源量化库 / 数据源（"积木"）

**10. AKShare（akfamily/akshare）— 官方/权威，唯一全命中"个股+行业/概念板块+资金流"的免费库 ⭐**
- 仓库：https://github.com/akfamily/akshare ｜ 22,365 stars ｜ MIT ｜ 最近 push 2026-08-28（极活跃，日更级）｜ 官方文档站 https://akshare.akfamily.xyz
- 代码级核实（GitHub code search）：行业板块行情 `akshare/stock/stock_board_industry_em.py`（`stock_board_industry_name_em`）；概念板块 `akshare/stock/stock_board_concept_em.py`（`stock_board_concept_name_em`）；板块资金流 + 个股资金流 `akshare/stock/stock_fund_em.py`（`stock_sector_fund_flow_rank`、`stock_individual_fund_flow_rank`）。
- 个股能力：✅（日/分钟K线 `stock_zh_a_hist`、实时快照、资金流、龙虎榜、财务等）。板块能力：✅ 行业/概念板块行情、涨幅榜、资金流排名。KDJ：**库本身只提供原始 OHLCV，不内置指标**——用 pandas 十几行自算（KDJ=RSV 的 9/3/3 平滑）。
- 权威性判定：**【官方/权威】**。免费、无需 key、数据源以东方财富等公开接口为主（接口本身属逆向，AKShare 官方文档如此标注；上游接口变动由官方高频维护）。
- 出处：https://github.com/akfamily/akshare 及上述源码文件路径。

**11. Microsoft Qlib — 官方/权威，定位错配（研究/回测平台）**
- 仓库：https://github.com/microsoft/qlib ｜ 48,193 stars ｜ MIT ｜ 最近 push 2026-07-23（活跃）
- README 声称：AI-oriented Quant investment platform（ML/RL 因子研究、回测、模型库）。数据需自行接入/下载，无实时行情推送，无板块资金流/热度概念；A 股数据支持方式**未逐条核实**（以官方文档为准）。
- 权威性判定：**【官方/权威】**；适合未来做因子回测，不适合当前"行情监控+KDJ+板块"小项目。
- 出处：https://github.com/microsoft/qlib（README）；https://qlib.readthedocs.io。

**12. TuShare（waditu/tushare）— 官方/权威 SDK，但仓库停更 + 积分门槛**
- 仓库：https://github.com/waditu/tushare ｜ 15,380 stars ｜ BSD-3-Clause ｜ 最近 push 2024-03-13（SDK 仓库 2 年+ 未更新；数据服务 tushare.pro 仍在运营）
- 代码级核实：个股资金流 `moneyflow` 接口在 `tushare/stock/reference.py`；板块资金流为 Pro 服务端接口 `moneyflow_ind_dc`（官方文档：https://tushare.pro/document/2?doc_id=344 "东财概念及行业板块资金流向"），**需注册 token 且按积分解锁**（具体积分要求以官网为准，第三方经验称 moneyflow 约 2000 积分）。
- 个股能力：✅（行情/财务/资金流等，积分制）。板块能力：✅ 有接口但**积分门槛**。KDJ：无内置。
- 权威性判定：**【官方/权威】**（waditu 为 TuShare 官方 org），但仓库停更、免费额度受限，适合当备源。
- 出处：https://github.com/waditu/tushare ；https://tushare.pro/document/2?doc_id=344。

**13. baostock — 官方项目，但 GitHub 停更、能力只覆盖历史数据**
- 官方站点：http://www.baostock.com ｜ PyPI 包 `baostock` 0.9.3（**2026-07-10 发布**；2026 年内连发 0.9.1/0.9.2/0.9.3，仍在维护）｜ BSD License（PyPI 页面核实）
- GitHub 现状：**无活跃官方仓库**（`baostock/baostock` 不存在；作者早期仓库 developerdong/baostock 仅 4 stars、2020-04 停更），主分发渠道是 PyPI + 自有数据服务器。
- 能力（PyPI README 核实）：免费 A 股历史日/周/月K线（复权、PE/PB 等指标）、季频/年频财务、行业分类等；**无实时行情、无板块资金流、无板块涨幅**。
- 权威性判定：**【官方/权威】**（第一方数据服务），但能力面窄，适合做历史数据兜底，不适合板块分析。
- 出处：https://pypi.org/project/baostock/ ；http://www.baostock.com。

### (d) 官方数据源 SDK / 权威第三方封装

**14. FutunnOpen/py-futu-api（富途 OpenAPI Python SDK）— 官方/权威，唯一"官方+活跃+有板块+有资金流"的行情 SDK**
- 仓库：https://github.com/FutunnOpen/py-futu-api ｜ 1,312 stars ｜ Apache-2.0 ｜ 最近 push 2026-04-01（活跃）｜ 富途官方开源组织 FutunnOpen
- 代码级核实：`futu/quote/open_quote_context.py` 存在 `get_capital_flow`（资金流向）与 `get_plate_list`（板块列表，含板块涨跌）；覆盖 A/港/美股行情。
- 个股能力：✅（实时行情、K线、资金流）。板块能力：✅ 板块列表/资金流（具体字段以官方文档 openapi.futunnopen.com 为准，**未逐字段核实**）。KDJ：无内置，需自算。
- 前提：需安装 FutuOpenD 网关 + 富途账号（可免费开）。权威性判定：**【官方/权威】**。
- 出处：https://github.com/FutunnOpen/py-futu-api 及 futu/quote/open_quote_context.py。

**15. RomelTorres/alpha_vantage（Alpha Vantage Python 封装）— 官方认可、社区高星；但无 A 股且板块接口已废弃**
- 仓库：https://github.com/RomelTorres/alpha_vantage ｜ 4,902 stars ｜ MIT ｜ 最近 push 2026-07-26（活跃）
- 身份证据：README（已全文读取）以 Alpha Vantage 团队身份发布（联系人为官方 Twitter/邮箱），被 Alpha Vantage 生态广泛引用；判定为**官方认可的 Python 封装**（若需 100% 官方背书，以 alphavantage.co 文档页为准，本报告未逐页核对该站）。
- 能力：美股/外汇/加密实时与历史数据 + 技术指标接口（SMA/MACD/RSI/STOCH/BBANDS 等，3.0.0 起扩展）；**3.0.0 明确将 sector performance（板块表现）废弃**；KDJ 不在其指标集（可用 STOCH 近似，但非 KDJ）；**无 A 股数据**。
- 权威性判定：**【官方/权威（官方认可封装）】**；对你（A股+板块+KDJ）不适用，仅作美股备选。
- 出处：https://github.com/RomelTorres/alpha_vantage（README）。

**16. 东方财富 / 同花顺官方开源 SDK —— 均不存在（如实说明）**
- 东方财富：官方仅提供**付费 Choice 量化接口**（官方下载页 https://quantapi.eastmoney.com/download/ ，闭源、需 Choice 账号）；GitHub 上所有"东财 SDK"均为第三方逆向封装，代表：[Micro-sheep/efinance](https://github.com/Micro-sheep/efinance)（3,973 stars，MIT，push 2026-07-17 活跃，**社区高星但非官方**；代码搜索证实**无内置 KDJ**）、shidenggui/easyquotation 等。
- 同花顺：iFinD 为付费终端（有官方 Python 接口但**非开源**、需 license）；GitHub 上的 ifind-data、vnpy_ifind、THSTrader 等均为第三方/非官方封装。
- 权威性判定：**【官方开源 SDK：无】**——这是该品类的事实结论，勿信任何"东财官方开源 SDK"说法。
- 出处：https://quantapi.eastmoney.com/download/ ；https://github.com/Micro-sheep/efinance ；https://github.com/vnpy/vnpy_ifind（README，第三方 iFinD 适配）。

---

## ③ 推荐组合方案（Windows / Python / 东财数据 / KDJ / 板块分析）

**方案 A（推荐主路线）：AKShare 数据层 + pandas 自算 KDJ + 自建 SKILL.md**
- 数据层：`pip install akshare`（无需 key）。
  - 个股日线 → `ak.stock_zh_a_hist()`（日线 OHLCV，前复权）；
  - 行业板块 → `ak.stock_board_industry_name_em()`；概念板块 → `ak.stock_board_concept_name_em()`；
  - 板块资金流 → `ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")`；个股资金流 → `ak.stock_individual_fund_flow_rank()`。
- KDJ：用 pandas 实现 RSV→K→D→J（9/3/3 平滑，十几行代码），不要指望任何库内置 A 股 KDJ。
- Skill 层：参考 [anthropics/skills](https://github.com/anthropics/skills) 的 `template/`（官方格式规范）与 [lzwme/finance-quant-skills](https://github.com/lzwme/finance-quant-skills) 的 `skills/akshare/SKILL.md`（中文写法范本），写一个 `stock-analysis/SKILL.md`（frontmatter + 板块资金流/KDJ 流程 + 可执行脚本），放到 Claude Code 的 skills 目录即可直接用。
- 理由：唯一"权威积木"组合；无 license 风险（AKShare MIT）；不依赖低星社区 MCP；Windows 上纯 pip 即可。

**方案 B（想直接给 Claude Code 接 MCP，快速起步）**
- 用 [27dream/mcp-eastmoney](https://github.com/27dream/mcp-eastmoney)（stdio，`uvx mcp-eastmoney`）先把"个股行情+板块资金流"给 agent 用；KDJ 在 skill 里用 pandas 算（该 MCP 的 `get_kline` 提供原始 K 线）。
- 或选 [CharmYue/ashare-mcp](https://github.com/CharmYue/ashare-mcp)（30 tools、akshare 降级链、板块资金流排名、SQLite 缓存），质量更高但文档偏 macOS。
- 理由：板块资金流零成本可用；风险点是两者均为 7 stars 社区新项目、东财逆向接口可能失效——**务必在 skill 层做"接口失效→akshare 直连兜底"**。

**方案 C（机构级参考，不照搬）**
- [anthropics/financial-services](https://github.com/anthropics/financial-services) 的 `market-researcher`（行业/主题研究）、`equity-research` 插件，官方支持把自己的数据连接器换进 `.mcp.json`——即"官方 skill 框架 + 你的东财 MCP 数据"是官方明确支持的玩法；但需注意其 skill 全是基本面口径，技术面流程仍要自己写。

**不推荐作为本项目主源**：OpenBB（AGPL + A 股弱）、Qlib（重、研究向）、TuShare（积分门槛）、baostock（无板块/无实时）、Alpha Vantage（无 A 股、板块接口已废弃）、futu-api（需富途网关/账号，可作为"有官方背书"的备选数据源）。

---

## ④ 来源清单（均可直接打开核实）

官方仓库 / 官方站点：
- https://github.com/anthropics/skills （官方技能库，金融类为空）
- https://github.com/anthropics/financial-services （官方金融 Agent Skills；README 全文）
- https://github.com/akfamily/akshare （官方数据库；源码文件 stock_board_industry_em.py / stock_board_concept_em.py / stock_fund_em.py）
- https://github.com/microsoft/qlib ；https://qlib.readthedocs.io
- https://github.com/waditu/tushare ；https://tushare.pro/document/2?doc_id=344 （板块资金流 moneyflow_ind_dc 官方文档）
- https://pypi.org/project/baostock/ ；http://www.baostock.com （baostock 官方分发与站点）
- https://github.com/FutunnOpen/py-futu-api （富途官方 SDK；futu/quote/open_quote_context.py 含 get_capital_flow/get_plate_list）
- https://github.com/OpenBB-finance/OpenBB （LICENSE=AGPL-3.0；openbb_platform/extensions/mcp_server/README.md）
- https://quantapi.eastmoney.com/download/ （东财 Choice 量化接口官方下载页，闭源）
- https://github.com/RomelTorres/alpha_vantage （Alpha Vantage Python 封装 README）

社区仓库（均已逐一核实元数据，判定见正文）：
- https://github.com/lzwme/finance-quant-skills （302★，无 LICENSE；skills/akshare/SKILL.md）
- https://github.com/ZICXR/A-Stock-Skills （23★，MIT；README 声称 KDJ/技术面）
- https://github.com/aifinlab/FinClaw （233★，Apache-2.0；skills/ths-skill）
- https://github.com/CharmYue/ashare-mcp （7★，MIT；stdio+Streamable HTTP；30 tools；README 全文）
- https://github.com/27dream/mcp-eastmoney （7★，MIT；stdio；5 tools；README 全文）
- https://github.com/HuggingAGI/mcp-baostock-server （118★，无 LICENSE 文件）
- https://github.com/Micro-sheep/efinance （3,973★，MIT；无内置 KDJ）
- https://github.com/vnpy/vnpy_ifind （第三方 iFinD 适配）

> 数据口径说明：stars/pushed_at/license/archived 均来自 GitHub 官方搜索/目录 API 于 2026-09-02 的返回；README 内容经 jsdelivr CDN 镜像读取；"未核实"之处已在正文逐条标注。本报告不构成投资建议。
