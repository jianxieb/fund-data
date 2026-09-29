# 股票调研 skill 多方对比与修订（2026-09-30）

## 结论

用户仓库的研究目录和A股资料组织有价值，但原数据管线不能按说明直接复现，预测及估值计算也存在实质错误。本项目保留其报告、成长线索和来源版本，重写取数与计算，补充原10份报告；不沿用旧目标价、PEG贵贱判断或自动“买入”评级。

本次读了5个公开仓库的7份具体skill，逐项比较工作流、证据、计算假设及产品适配。比较对象不是全市场穷举，没有按star数或营销评级排序。对方托管终端、付费数据源及全部脚本未做端到端运行；以下明确区分指令审阅与本项目实际计算验证。版本和文件哈希保存在 `company-report/provenance.json`。

## 方法对照

| 对象 | 实际读取与可借鉴点 | 局限或需纠正处 | 本项目采用方式 |
|---|---|---|---|
| 用户 company-report | 读取skill、两个脚本、模板、10份报告、原初筛和两份调研文档；具备A股报告组织、业务/风险/估值框架 | 取数输出raw字段，计算却期待规范化字段；固定年份和PE；券商样本重复；股息直接取两条 | 统一schema，公开逐公司输入和计算结果，旧报告逐条补正 |
| [Anthropic initiating-coverage](https://github.com/anthropics/financial-services/blob/574ed3624aebd0418c7e96cd101262f30210ab26/plugins/vertical-plugins/equity-research/skills/initiating-coverage/SKILL.md) | 分步研究、历史三表、预测与估值依赖关系 | 强制篇幅和多步交付门槛不适合网页；模板完整不等于数据可靠 | 采用先证据后模型，不移植30—50页要求或反复确认 |
| [Anthropic earnings-analysis](https://github.com/anthropics/financial-services/blob/574ed3624aebd0418c7e96cd101262f30210ab26/plugins/vertical-plugins/equity-research/skills/earnings-analysis/SKILL.md) | 财报后更新、旧新预测变化、明确截止时点 | “超预期”需要公告前已有预测，不能拿事后预测作比较 | 日期、变化和来源分开；无事前共识时不写beat/miss |
| [Anthropic dcf-model](https://github.com/anthropics/financial-services/blob/574ed3624aebd0418c7e96cd101262f30210ab26/plugins/vertical-plugins/financial-analysis/skills/dcf-model/SKILL.md) | EBIT税后、折旧、资本开支、营运资金与敏感性建模 | 示例用净债务/EV作资本权重，净现金公司会出现负债负权重；未同步调整经营资产权益风险时不能直接套用 | 采用明确资本成本与EV桥接；不复制示例权重，也不把示例范围当默认值 |
| [lzwme equity-researcher](https://github.com/lzwme/finance-quant-skills/blob/d973f3595fc7e26ca00de347f76425ae289291ad/skills/equity-researcher/SKILL.md) | A/H/美股、证据链、正反论点、简版/完整报告分层 | 25页式交付、外部数据依赖和多次交互不适合本项目；两个转载源不能构成独立核验 | 用原始公告+结构化计算交叉核对；仅借鉴方法，没有复制许可不明的模板 |
| [alirezarezvani stock-analysis](https://github.com/alirezarezvani/claude-skills/blob/19392f7a08264ed00486a251f5b2098321771f94/finance/skills/stock-analysis/SKILL.md) | 文件优先、5年和8季、审计/治理/关联交易、行业路由及可证伪论点 | 完整年度阅读与审阅环节成本高，不能未执行却声称完成；复杂评分不能替代关键事实 | 记录实际覆盖材料，拆分金融/工业模型，已有问题进入当前判断 |
| [Netease stock-analyzer](https://github.com/netease-youdao/LobsterAI/blob/791a352dee3b3d8c6f64edcaf229ce474a68f6c5/SKILLs/stock-analyzer/SKILL.md) | 行情、技术、财务和成长字段组织直观 | skill中固定35/25/25/15权重混合价值、技术、成长、财务；未明确A股扣非、重述和披露时点约束 | 只借鉴报告组织，不用技术得分弥补基本面不达标 |
| [Five-Layer Fundamental Analysis](https://github.com/Alexey-Rivkin/fundamental-analysis-skill/blob/9995efbdde594ebbaf6e40462dfd53e4d70736cf/SKILL.md) | 现金回收、同业比较、缺失值留空、区分预测与实际 | 固定10%资本成本、净利润/(债务+权益)的ROIC近似、PEG阈值和宽泛美股同业不能直接迁移A股 | 保留现金与比较意识；不用固定门槛作估值 verdict，不把近似数写成标准ROIC |

资本权重口径另核对 [NYU Stern 的财务指标定义](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/definitions.html)：本项目采用 E/(D+E)、D/(D+E) 并单列现金。净债务方法有其调整前提，不能只替换权重而保留不匹配的资本成本。

## 原管线问题与具体修复

| 问题 | 影响 | 修复 |
|---|---|---|
| `mainfin_raw`等与计算输入不一致，日线字典却按数组下标读 | 新取数无法接上计算；部分标的崩溃 | 规范schemaVersion=2，两个CLI共用 `company_report.py` |
| 数据仅12期却承诺五年；硬编码2023—2026 | 三年表冒充五年，下年不能滚动 | 40期财务，完整5年+最新累计+8个单季 |
| 所有行业默认同一组PE | 虚构合理区间，连带“透支”“安全边际”“贵/便宜”失去依据 | 撤回旧固定倍数目标和由其推出的结论；无逐公司假设不输出目标价 |
| 跨年EPS相加；无公告截止过滤 | 股本变动或前视数据污染TTM | 先算利润金额，按行情日已知财报复算；报告和市场日期分别列示 |
| 同一券商多篇报告直接平均；缺年份默认2026 | 重复/陈旧预测冒充一致预期 | 同机构/财年留最新，180日时效；缺股本口径不合并，公开目录只作来源线索 |
| 自建EPS配卖方PE算PEG | 口径内部矛盾 | 不再自动混算或输出PEG贵贱判断 |
| 最近两笔股息当完整年度；未来除息提前算 | 股息率、分红率错位 | 实施状态与除权日过滤、财年合计、送转调整；缺现金金额不补0，保留独立送转记录；分红率需同股本口径 |
| capex缺失当0；一律“DCF禁用” | 虚增现金余量，且金融企业被套工业模型 | 空值不补0；明确现金余量不等于FCFF，金融行业单独路由 |
| 同业包含自身、不同日期/业务/PE混合 | 相对估值结论无效 | 具名可比理由、同日同币种同口径，少于3家不称同业中位数 |
| 初筛把扭亏/周期/授权款当成长 | 财务差的票带着“未通过”进入页面 | 初筛保留在审计文档；发布须当前增长+现金+主营证据，主页面只显示实际入选 |

## 成长思路吸收

保留原营收≥20%、归母≥30%的“收入与利润共同增长”，增加扣非≥30%、扣非占比≥80%、连续两个单季、两年正利润/正经营现金流、完整年度ROE及TTM现金检查。原中报净利≥5亿元有大盘偏置，半年ROE≥7%不能跨Q1/H1/Q3比较，故不用其作为通用门槛。

初筛是发现线索，不是入选名单。2026-09-30复核原筛选10家、原报告10家和本项目12家去重后的26家公司；筛选与财务结果见 `growth-review-2026-09-30.json`。原名单补入生益科技、长川科技；工业富联与已有研究重合。长期优质12家、高质成长6家，重合4家（工业富联、宁德时代、中际旭创、沪电股份）。这些数量是本次材料覆盖的结果，不代表全市场只有这些公司。

## 报告修订范围

- 原10份报告保留9月2日日期、追加9月30日更正及新版链接。重算当前财务、股息、金额TTM和估值快照；具名撤回受影响的结论。
- 本次生成21份深入分析：原10家与本项目长期优质12家去重为19家，再加生益科技、长川科技。研究报告库包含历史覆盖公司，不赋予其主名单成员身份。
- 不把自动抓取目录称为阅读过券商全文，不把没有更新的治理、法律事件和完整审计附注标成已复核。每篇列出本次范围与对应证据缺口。
- 行情与筛选刷新不会更改报告研究日期。新业务研究须人工核对原文后更新清单并重新生成。

## 验证与可复现

`python3 company-report/scripts/01_fetch_data.py 601138 --as-of 2026-09-30` → `python3 company-report/scripts/02_compute.py company-report/data/601138/summary.json` → `python3 scripts/build_stock_reports.py`。

回归覆盖负/零基数、不同股本EPS、公告日后数据、资本开支缺失、预测机构重复/过期/未来/未知财年、分红实施及送转、同业身份/日期、WACC负债负值、两类独立筛选和报告链接。输入、方法、源码、网页报告均在同一仓库，不依赖读者访问原私有仓库。
