# 2026-09-30 复核与修订

原调研保留在下方，代表2026-09-02的研究记录。此次重新读取5个公开仓库的7份具体skill，完整对照、版本和实现验证见 [本次多方比较](../../research/stock-skill-comparison-2026-09-30.md)。

- 撤回用固定PE、混合EPS预测、重复机构样本生成合理价格的做法；原方案的方向可用，原脚本尚不能直接复现。
- 不以star数、品牌或“社区最强”判断研究可靠性。Anthropic的分步建模有用，其篇幅要求与净债务权重示例不直接移植；其余四类方法分别检查数据来源、行业适配、现金回收、治理及固定评分的局限。
- 已将统一输入、5年/8季、公告截止、股息归属、证据反证与金融行业路由落实到本项目的company-report skill及计算脚本。
- 实际比较为指令及相关源码审阅，不冒充执行过所有外部付费数据链路。源仓库未改动；修改后的版本与最新报告在本项目维护。

---

## 以下为9月2日原始调研（不代表当前评定）

# 第二轮调研：「给定一家公司 → 自动生成全面研报」的开源 skill / 工具

- 需求重述：给定一只股票/一家公司，自动生成深度研究报告（公司概况与主营业务、财务三大报表分析、行业地位与竞争格局、估值、风险、新闻舆情/机构研报汇总），**A 股优先**；不要实时行情/指标查询类工具。
- 核实方式与标准同第一轮：每个候选回到 GitHub 仓库核实（stars / license / 最近提交 / archived），关键能力做**代码级或全文级取证**（本次对官方 SKILL.md 全文、报告模板、.mcp.json、社区 skill 的 SKILL.md 与 data-sources.md 均逐字读取）；无法核实的明确标注。
- 核实时间：2026-09-02（stars / pushed_at 为当日 GitHub API 返回值）。
- 分档：【官方/权威】【社区高星但非官方】【低质量/弃维护】。

---

## ① TL;DR（直接回答）

1. **官方"公司全面报告"skill 存在，而且质量极高**：Anthropic 官方 [anthropics/financial-services](https://github.com/anthropics/financial-services) 的 equity-research 插件里有一个 **`initiating-coverage` skill**（首次覆盖报告）：5 任务工作流 → 产出 **30-50 页、10,000-15,000 词的机构级 DOCX 报告**（JPM/GS/MS 格式：投资摘要与评级、投资论点与风险、Company 101、财务分析与 5 年预测、行业/TAM/竞争格局/Porter 五力、DCF+可比公司+敏感性+足球场估值、目标价、附录）+ 配套 6-tab Excel 三表模型 + 25-35 张图表。另有 `earnings-analysis`（8-12 页季报点评）与 S&P Global 的 `tear-sheet`（1-2 页公司速览）。**这正是你描述的需求**，但它有三个"不直接可用"点：① 强制单任务模式（5 个任务分 5 次执行，不能一键端到端）；② 数据口径默认美股（SEC EDGAR 10-K、FactSet 等 12 个付费商业 MCP 连接器）；③ 最终产物 DOCX 依赖官方 docx/xlsx 文档 skills。
2. **A 股原生成品 skill 没有官方版**；社区最强的是 [lzwme/finance-quant-skills](https://github.com/lzwme/finance-quant-skills) 的 **`equity-researcher` skill**（302★）：双模式（3-5 页 Tear Sheet / ≥25 页 PDF 深度研报、21 个必修模块、六维分析、三任务架构、L1/L2 两级估值），质量接近官方水平，**但其 A 股数据源优先级是 iFind（同花顺付费接口）→ Yahoo Finance → Web 搜索，不是 AKShare**；且整个仓库**无 LICENSE 文件**。ZICXR/A-Stock-Skills 的 `report` skill 只有轻量 4 维个股研报（公司/技术/资金/舆情），达不到"全面报告"。
3. **"深度研究框架"里没有股票专用成品**：GPT Researcher（29.2k★，Apache-2.0，活跃）是通用主题研究，需自己灌金融数据；LangChain 的 open_deep_research（12.7k★，MIT）**已被官方 archived**；nickscamara/open-deep-research（6.3k★）license 为 "Other" 且 2025-05 后停更。**用户提到的 "X-Value（Seeking Alpha 风格公司估值分析）"未能找到任何对应仓库**——同名项目（Miksus/xvalue 是量化数学库、CRIZANTE1/XValue 是 0★ 无关小项目）均不符描述，如实判定"无法核实/可能不存在"。
4. **最接近"开箱即用的公司研报生成器"的非 skill 项目是 AI4Finance-Foundation/FinRobot**（7.9k★，Apache-2.0，2026-08 仍活跃，学术界知名组织）：两条命令（`generate_financial_analysis.py` → `create_equity_report.py`）即可产出多页 HTML/PDF 研报（15+ 图表、8 个专业 agent 分工、DCF/可比估值、示例报告可直接看 NVDA/MSFT/TSLA）；但数据源是 FMP/Finnhub/yfinance/SEC EDGAR（美股优先），**A 股需自行换数据层**。另有 guy-hartstein/company-research-agent（2.3k★，Apache-2.0，活跃，Tavily 系）做公司深度调研（web 数据为主，不含财报三表建模）。
5. **A 股数据落地：AKShare 免费接口已代码级证实覆盖"全面报告"的几乎全部数据维度**（见 ③ 对照表：三表、主营构成、股东户数、机构研报、分红送配、公司概况、盈利预测、PE/PB 估值、个股新闻全部存在）；**缺口**是"同业对比表/机构一致预期"没有一键式免费接口——需用"行业板块成分股 + 各股估值指标"自拼，或换 iFind/TuShare（付费/积分）。
6. **推荐方案**（详见 ④）：自建 SKILL.md = **官方 `initiating-coverage` 的报告结构与模板（可整段复用）+ AKShare 数据脚本层替换 SEC EDGAR/FactSet**；社区 `equity-researcher` 作为中文模板参考。这是"权威成品 + 免费 A 股数据"的最优交集。

---

## ② 各类别明细条目

### (a) SKILL.md 格式的「公司研报生成」skill

**1. anthropics/financial-services 的 equity-research 插件（`initiating-coverage` / `earnings-analysis` / `sector-overview` 等）— 官方/权威 ⭐核心条目**
- 仓库：https://github.com/anthropics/financial-services ｜ 34,630★ ｜ Apache-2.0 ｜ 创建 2026-02-23，push 2026-08-25（活跃）
- 本次逐字读取：`plugins/vertical-plugins/equity-research/skills/initiating-coverage/SKILL.md` 全文、`assets/report-template.md` 全文（完整机构报告模板）、`skills/earnings-analysis/SKILL.md` 全文、`plugins/vertical-plugins/financial-analysis/.mcp.json` 全文、插件目录树。
- **`initiating-coverage`（首次覆盖报告）产出（SKILL.md 明文规定，非声称）**：
  - Task 1 公司研究：6,000-8,000 词文档（公司概况与历史、管理层履历、产品服务、行业概览、5-10 家竞对、TAM、8-12 项风险）；
  - Task 2 财务建模：6-tab Excel（收入模型 20-30 行产品+15-20 行地域、40-50 行利润表、现金流量表、资产负债表、Bull/Base/Bear 情景、DCF 输入），历史 3-5 年 + 预测 5 年；
  - Task 3 估值：DCF+敏感性矩阵、5-10 家可比公司（max/75th/median/25th/min 统计）、先例交易、足球场图、目标价、BUY/HOLD/SELL 与上行空间；
  - Task 4 图表：25-35 张 PNG（300DPI，含 4 张强制图：分产品收入、分地域收入、DCF 敏感性热力图、估值足球场）；
  - Task 5 组装：30-50 页 DOCX（≥10,000 词、12-20 张表、全图表内嵌、可点击超链接引用）。
  - 报告结构（report-template.md）：P1 投资摘要评级框 → P2 目录 → 投资论点与风险 → Company 101 → 增长展望 → 财务分析与预测 → 行业/TAM/五力/竞争格局 → 估值 → 附录披露。
- **"能否一键生成"**：不能。SKILL.md 明确 "single-task mode only"，5 个任务须分 5 次请求、逐项验收。
- **数据连接器怎么换**：12 个官方 MCP 全部集中在 `plugins/vertical-plugins/financial-analysis/.mcp.json`（Daloopa/Morningstar/S&P Global Kensho/FactSet/Moody's/MTNewswires/Aiera/LSEG/PitchBook/Chronograph/Egnyte/Box，均 HTTP 型、需订阅/密钥），官方 README 明确支持 "Swap connectors — point .mcp.json at your data providers"；且 Task 2 明文接受 "Pre-extracted historical financials provided by user"——**即可以喂 AKShare 数据**。
- 配套：`earnings-analysis`（8-12 页/3,000-5,000 词季报点评：beat/miss、更新预测、强制来源引用）；partner 插件 spglobal 的 `tear-sheet`（1-2 页公司速览、4 种受众模板、S&P Capital IQ 数据、docx 输出、含数据完整性 10 条硬规则）。
- 权威性判定：**【官方/权威】**。A 股落地需换数据层（官方支持），报告框架/模板/质量标准可直接复用。
- 出处：仓库 + 上述 5 个文件路径（jsdelivr 镜像已全文读取）。

**2. lzwme/finance-quant-skills 的 `equity-researcher` — 社区高星但非官方（A 股研报 skill 里的最强，但数据源是 iFind）**
- 仓库：https://github.com/lzwme/finance-quant-skills ｜ 302★ ｜ 创建 2026-03-25，push 2026-06-29 ｜ **根目录无 LICENSE 文件**
- 本次逐字读取：`skills/equity-researcher/SKILL.md` 全文、`references/data-sources.md` 全文。
- 实际产出（SKILL.md 明文）：双模式——
  - Tear Sheet（投资速览）：3-5 页 PDF，11 个固定模块（公司概览、核心财务、估值倍数、投资逻辑、风险、催化剂、产业链等），单会话完成；
  - Equity Report（深度研报）：**≥25 页 PDF，21 个必修模块**，2/3 任务架构（Task 1 六维分析研究文档 ≥6,000 词 → Task 2 Excel 三表模型+DCF（L2 才有）→ Task 3 终稿 PDF），含行业分析、产业链图谱、情景分析、敏感性测试、可比公司（L1）/DCF+历史估值带（L2）、Bull/Bear 平衡、来源标注、QA 门禁；配套 matplotlib 图表脚本 + PDF 生成脚本。
- 覆盖 A股/港股/美股；语言自适应（中文请求出中文报告）。
- **关键事实（决定 A 股落地方式）**：其数据源优先级表为 **A股/HK → iFind（同花顺 iFinD 付费接口）→ Yahoo Finance → Web 搜索**，另有天眼查（供应链/股东）、财新；**未使用 AKShare**。也就是说它默认需要付费 iFind 数据源（或自行改 `references/data-sources.md` 换成 akshare 接口）。
- 权威性判定：**【社区高星但非官方】**；结构与质量是社区 A 股研报 skill 的标杆，可直接参考其中文模板与六维分析框架；⚠️ 无许可证、数据源需替换。
- 出处：https://github.com/lzwme/finance-quant-skills/skills/equity-researcher/ 。

**3. ZICXR/A-Stock-Skills 的 `report` skill — 社区低星，只有轻量个股研报，达不到"全面"**
- 仓库：https://github.com/ZICXR/A-Stock-Skills ｜ 23★ ｜ MIT ｜ push 2026-06-25（停更）
- 本次逐字读取 `skills/05-reports/report/SKILL.md`：3 合 1（daily 大盘复盘 / **stock 个股研报** / portfolio），`report stock 000001` 产出 Markdown，个股研报内容 = **公司 / 技术 / 资金 / 舆情 四个维度**——无三大报表分析、无行业竞争格局、无 DCF 估值。依赖 akshare。
- 权威性判定：**【低质量/未证实】**（仅"个股快评"级，与"全面研报"差距大）。
- 出处：https://github.com/ZICXR/A-Stock-Skills/tree/main/skills/05-reports/report 。

**4. aifinlab/FinClaw 的 research-report-draft 系列 — 社区中星，疑似批量生成，质量未验证**
- 仓库：https://github.com/aifinlab/FinClaw ｜ 233★ ｜ Apache-2.0 ｜ push 2026-05-13
- 目录级核实：skills/ 下有数百个 skill（`research-report-draft-analyst`、`research-report-draft-institutional`、`research-report-draft-junior`、`a-share-research-digest`、`akshare-report`、`sentiment-xueqiu`、`ths-skill` 等），命名高度批量化（大量 a-share-* 与银行合规类 skill 混合）。
- 各 skill 的实际报告模板**未逐一读取**（数量过大），标注**未核实**；整体观感是模板农场式生成，可信度需抽样验证后再用。
- 权威性判定：**【社区高星但非官方/未核实质量】**。
- 出处：https://github.com/aifinlab/FinClaw/tree/main/skills 。

**5. Kevin-XXX/company-analyst — 社区低星，但 SKILL.md 质量出人意料地完整（零售投资者向，数据源 yfinance）**
- 仓库：https://github.com/Kevin-XXX/company-analyst ｜ 2★ ｜ 无 license 字段（API 未返回）｜ 创建 2026-05-23，push 2026-05-30
- 本次逐字读取 SKILL.md 全文（v5.4）：`python analyze.py TICKER` 一键拉 yfinance 数据 → 自动算 5 年 PE 百分位、动态 DCF（CAPM/WACC 自适应）、可比公司、混合公允价值（50% DCF Base + 30% Comps + 20% Bear）→ 输出 HTML 报告：9 节结构（Header / 摘要与最新进展 / 公司画像与四大财务信号卡 / 投资论点 / Bull-Bear 情景与 DCF 图表 / 决策卡 / 风险评估仪表 / 六维信号计分卡 / 免责声明）；支持 `--lang zh` 中文报告、`0700.HK` 等代码。
- 局限：yfinance 对 A 股覆盖弱且限流；2★、单作者、无 tests 记录。
- 权威性判定：**【低质量/未证实】**（星级极低），但作为"零售向全面报告"的自建模板参考有价值。
- 出处：https://github.com/Kevin-XXX/company-analyst 。

### (b) 开源「深度研究 / 自动研报」框架

**6. AI4Finance-Foundation/FinRobot — 社区高星（学术组织），最接近"开箱即用公司研报生成器"**
- 仓库：https://github.com/AI4Finance-Foundation/FinRobot ｜ 7,900★ ｜ Apache-2.0 ｜ push 2026-08-23（活跃）｜ 学术论文 ICAIF 2024 + arXiv:2405.14767
- README 全文核实：`finrobot_equity` 管线 = `generate_financial_analysis.py`（FMP 财报拉取 + 3 年预测 + DCF + 同行对比 + 8 个专业 agent 写投资论点/风险/估值综述）→ `create_equity_report.py`（生成**多页 HTML/PDF 研报、15+ 图表**）；官方示例报告可在线查看（NVDA/MSFT/TSLA/META/COP）。另有 FinRobot Desktop（macOS 原生，9-agent + 3 辩论 agent，13 章研究报告输出）。
- 报告能力：✅ 全面（三表、预测、估值、风险、论点）；数据源：FMP/Finnhub/yfinance/SEC EDGAR——**美股优先，A 股无官方适配**（yfinance 可勉强查 A 股但质量差）。
- 权威性判定：**【社区高星但非官方】**（知名学术开源组织，非公司第一方）；A 股需换数据层。
- 出处：https://github.com/AI4Finance-Foundation/FinRobot （README、示例报告链接）。

**7. guy-hartstein/company-research-agent — 社区高星，公司"尽职调研"agent（web 数据，非财报建模）**
- 仓库：https://github.com/guy-hartstein/company-research-agent ｜ 2,257★ ｜ Apache-2.0 ｜ push 2026-08-12（活跃）｜ 托管体验页 companyresearcher.tavily.com（与 Tavily 深度关联）
- README 声称：LangGraph + Tavily 多智能体公司深度调研（Gemini/OpenAI 推理），产出结构化公司研究报告（业务、产品、竞对、资金、信号等）；**不含三大报表建模/DCF**（web 抓取口径）。
- 权威性判定：**【社区高星但非官方】**；适合做"舆情/竞对/商业模式"章节的引擎，不适合独立产出全面财务研报。
- 出处：https://github.com/guy-hartstein/company-research-agent 。

**8. assafelovic/gpt-researcher — 通用深度研究框架（29k★ 事实标准），非股票专用**
- 仓库：https://github.com/assafelovic/gpt-researcher ｜ 29,244★ ｜ Apache-2.0 ｜ push 2026-08-27（活跃）｜ gptr.dev
- README 声称：任意主题的自主深度研究 agent，多 LLM 提供商、生成引用完备的 markdown/PDF 长报告；有 MCP/API 接口，可外接金融数据工具——但**股票研报（三表/DCF/估值）需自建定制报告模板与数据工具**。
- 权威性判定：**【社区高星但非官方】**（单作者但为领域事实标准）；作为"报告生成骨架"可用。
- 出处：https://github.com/assafelovic/gpt-researcher 。

**9. langchain-ai/open_deep_research — 官方但已归档（诚实结论）**
- 仓库：https://github.com/langchain-ai/open_deep_research ｜ 12,680★ ｜ MIT ｜ **archived: true**（API 返回，官方归档）
- 判定：**【官方/权威但弃维护】**；官方建议转向 LangGraph 的 deep research 模板，本项目不建议新项目采用。
- 出处：https://github.com/langchain-ai/open_deep_research 。

**10. nickscamara/open-deep-research — 半弃维护 + 自定义 license**
- 仓库：https://github.com/nickscamara/open-deep-research ｜ 6,281★ ｜ license: Other（NOASSERTION，非标准开源许可证）｜ push 2025-05-07（一年未更）
- 通用 web 深度研究（Firecrawl 数据），非公司研报专用。判定：**【低质量/弃维护】**（对本需求）。
- 出处：https://github.com/nickscamara/open-deep-research 。

**11. X-Value（Seeking Alpha 风格公司估值分析）— 未找到，如实说明**
- 中英文检索 + GitHub 仓库搜索均未找到符合描述的仓库；同名 `Miksus/xvalue` 是抽象量化数学库（非研报）、`CRIZANTE1/XValue` 为 0★ 巴西小项目。
- 判定：**该候选无法核实（大概率名称有误或项目不存在）**；如用户有确切仓库链接可再补查。
- 出处：github.com/Miksus/xvalue ；github.com/CRIZANTE1/XValue（均为不匹配项）。

### (c) A 股数据落地：AKShare 覆盖度核实（代码级）

以下接口均经 GitHub code search 在 [akfamily/akshare](https://github.com/akfamily/akshare)（22,365★，MIT，push 2026-08-28）源码中证实存在（括号为源码文件路径）：

| 报告章节 | 所需数据 | AKShare 接口（已证实） | 状态 |
|---|---|---|---|
| 公司概况 | 基本信息/公司资料 | `stock_profile_cninfo`（akshare/stock/stock_profile_cninfo.py） | ✅ 免费 |
| 主营业务构成 | 主营构成 | `stock_zygc_em`（akshare/stock_fundamental/stock_zygc.py） | ✅ 免费 |
| 财务三表 | 资产负债表 | `stock_balance_sheet_by_report_em`（akshare/stock_feature/stock_three_report_em.py） | ✅ 免费 |
| 财务三表 | 利润表 | `stock_profit_sheet_by_report_em`（同上） | ✅ 免费 |
| 财务三表 | 现金流量表 | `stock_cash_flow_sheet_by_report_em`（同上） | ✅ 免费 |
| 股东结构 | 股东户数变化 | `stock_zh_a_gdhs`（akshare/stock_feature/stock_gdhs.py） | ✅ 免费 |
| 分红送配 | 分红送配明细 | `stock_fhps_detail_em`（akshare/stock_feature/stock_fhps_em.py） | ✅ 免费 |
| 机构研报汇总 | 券商研报列表 | `stock_research_report_em`（akshare/stock_feature/stock_research_report_em.py） | ✅ 免费（列表级） |
| 估值 | PE/PB/股息率等 | `stock_a_indicator_lg`（`__init__.py` 导出 + changelog 证实） | ✅ 免费 |
| 一致预期/预测 | 机构盈利预测 | `stock_profit_forecast_em`（akshare/stock_fundamental/stock_profit_forecast_em.py） | ✅ 免费（东财口径） |
| 新闻舆情 | 个股新闻 | `stock_news_em`（akshare/news/news_stock.py） | ✅ 免费 |
| 行情（估值/图表输入） | 日线历史 | `stock_zh_a_hist`（第一轮已核实） | ✅ 免费 |

**如实列出的缺口**：
- **同业对比表**：无"一键生成同业对比"接口，需自拼（取同板块成分股清单 + 逐股拉 `stock_a_indicator_lg`/三表指标）。
- **机构一致预期（多机构盈利预测汇总）**：`stock_profit_forecast_em` 是东财"盈利预测"页数据（机构预测汇总性质），可满足基本需要；更权威的券商一致预期（iFind/Wind）**无免费开源接口**。
- **研报全文**：`stock_research_report_em` 提供研报**列表**（标题/机构/评级/目标价），研报 PDF 全文通常需跳转东财/慧博（无免费批量全文接口）——社区 skill 用 web 搜索补充。
- **管理层履历/供应链**：无免费结构接口，靠公司年报/招股书/web 搜索（官方 skill 同样依赖 MCP/EDGAR）。
- 上表之外另有一些相关接口（十大股东、质押、减持、审计意见等）**本次未逐一核实**，标注"以 AKShare 官方文档 akshare.akfamily.xyz 为准"。

---

## ③ 对照表：全面公司报告 × 权威数据来源

| 报告章节（官方 report-template.md 结构） | 免费开源首选 | 付费/备选 |
|---|---|---|
| 投资摘要/评级/目标价 | 自算（DCF/可比，输入用 akshare） | iFind / FactSet |
| 公司概况与历史 | `stock_profile_cninfo` + web 搜索 | S&P Capital IQ |
| 主营业务/分产品收入 | `stock_zygc_em` + 年报 | iFind `ifind_get_stock_business_segmentation` |
| 三大报表（3-5 年历史） | `stock_balance_sheet_by_report_em` / `stock_profit_sheet_by_report_em` / `stock_cash_flow_sheet_by_report_em` | iFind / TuShare Pro |
| 财务比率分析 | 用三表自算（ROE/毛利率/现金流等） | iFind `ifind_get_stock_financial_index` |
| 行业/TAM/竞争格局 | web 搜索 + 行业研报摘要 + 板块成分自拼 | 天眼查 / Caixin / iFind |
| 同业对比表 | 板块成分股 + `stock_a_indicator_lg` 自拼 | iFind / FMP（美股） |
| 估值（DCF/可比/情景/足球场） | pandas 自算（模型模板可复用官方 Task 3） | — |
| 风险 | 质押/减持/诉讼 web 搜索 + 公告 `stock_notice_report`（未逐一核实） | iFind |
| 新闻舆情 | `stock_news_em` + agent web 搜索 | MT Newswires/Aiera（官方连接器） |
| 机构研报汇总 | `stock_research_report_em`（列表） | iFind |
| 一致预期 | `stock_profit_forecast_em` | iFind `ifind_get_forecast` |
| 分红送配/股东 | `stock_fhps_detail_em` / `stock_zh_a_gdhs` | iFind |

---

## ④ 推荐组合方案

**方案 A（推荐主路线）：官方报告框架 + AKShare 数据层 = 自建「A 股全面研报」SKILL.md**
1. 框架层：复用 Anthropic 官方 `initiating-coverage` 的 5 任务结构与 `assets/report-template.md`（机构报告模板全文可抄），裁剪为你需要的 7 章（摘要/概况与主营/三表分析/行业与竞争/估值/风险/舆情与研报汇总）；输出格式改为 Markdown/HTML（避免依赖官方 docx skill）或保留 DOCX。
2. 数据层：写一个 `data_fetcher.py` 按 ③ 的接口清单拉 akshare 数据（三表 3-5 年、主营构成、股东、分红、研报列表、盈利预测、PE/PB、新闻），产出中间 JSON/CSV 文件——对应官方 Task 2 的 "Pre-extracted financials" 入口，官方流程明确支持这种喂法。
3. 计算层：pandas 自算财务比率 + 简版 DCF/可比估值（可比组 = 板块成分股）。
4. 舆情层：`stock_news_em` + agent 自带 web 搜索补研报观点。
5. 落地：SKILL.md 放 Claude Code 的 skills 目录即可直接触发（"帮我写一份 XX 公司的全面研报"）。
- 理由：唯一同时满足【权威框架 + 免费 A 股数据 + 无 license 风险（官方 Apache-2.0 + akshare MIT）】的路线；工作量约 1-2 天。

**方案 B（最快体验，社区成品改数据源）**：直接用 lzwme `equity-researcher` skill，把 `references/data-sources.md` 中 iFind 优先改为 akshare（按 ③ 接口映射），先生成 3-5 页 Tear Sheet 验证流程，再上 ≥25 页 Equity Report。⚠️ 该仓库无 LICENSE，仅限个人学习使用；改造工程量中等。

**方案 C（机构级、有条件）**：安装官方 `financial-analysis@claude-for-financial-services` + `equity-research@claude-for-financial-services` 插件，把 `.mcp.json` 的 12 个付费连接器换成自建 A 股 MCP（如第一轮核实的 CharmYue/ashare-mcp，已有财报/公告/研报/资金流 30 个工具）——官方明确支持 swap connectors，是"官方 skill 原样 + A 股数据"的正规玩法，但需要你的 MCP 把财报三表暴露为接近 FactSet/Daloopa 的工具语义。

**方案 D（美股/研究引擎参考）**：FinRobot 的 `finrobot_equity` 管线（两条命令出 HTML/PDF 研报）与 guy-hartstein/company-research-agent（舆情/竞对调研）作为引擎参考实现，不直接用于 A 股。

**不推荐**：GPT Researcher 直接生成财务研报（需大量定制）；langchain open_deep_research（已归档）；nickscamara open-deep-research（弃维护 + 非标准 license）；ZICXR report skill（太浅）；FinClaw（质量未验证）。

---

## ⑤ 来源清单

官方仓库与文件（均已逐字读取或目录核实）：
- https://github.com/anthropics/financial-services （README；Apache-2.0）
- plugins/vertical-plugins/equity-research/skills/initiating-coverage/SKILL.md（全文）
- plugins/vertical-plugins/equity-research/skills/initiating-coverage/assets/report-template.md（全文）
- plugins/vertical-plugins/equity-research/skills/earnings-analysis/SKILL.md（全文）
- plugins/partner-built/spglobal/skills/tear-sheet/SKILL.md（全文）
- plugins/vertical-plugins/financial-analysis/.mcp.json（全文，12 连接器）
- https://github.com/akfamily/akshare （接口均经源码文件证实，见 ③ 括号内路径）

社区仓库：
- https://github.com/lzwme/finance-quant-skills （equity-researcher/SKILL.md 与 references/data-sources.md 全文）
- https://github.com/ZICXR/A-Stock-Skills （skills/05-reports/report/SKILL.md 全文）
- https://github.com/aifinlab/FinClaw （skills 目录，未逐一读内容）
- https://github.com/Kevin-XXX/company-analyst （SKILL.md 全文）
- https://github.com/AI4Finance-Foundation/FinRobot （README 全文；arXiv:2405.14767）
- https://github.com/guy-hartstein/company-research-agent
- https://github.com/assafelovic/gpt-researcher
- https://github.com/langchain-ai/open_deep_research （archived=true）
- https://github.com/nickscamara/open-deep-research （license=Other）
- https://github.com/Miksus/xvalue ；https://github.com/CRIZANTE1/XValue （X-Value 不匹配项）

> 数据口径说明：stars/pushed_at/archived/license 来自 GitHub API（2026-09-02）；SKILL.md 等文件经 jsdelivr CDN 镜像读取仓库原文；"未核实"处已在正文逐条标注。本报告不构成投资建议。
