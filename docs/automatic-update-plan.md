# 自动更新与发布

长衡的公开站点由仓库中的生成快照构成。`refresh.py` 只计算和检查数据，不提交、不推送；GitHub Actions 在校验通过后负责提交数据并发布同一份站点文件。另一台电脑拉取 `main` 后，可直接看到已发布的生成数据、脚本与运行规则，不依赖维护者本机的 `.tmp-*` 缓存。

## 触发方式

- [数据刷新工作流](../.github/workflows/refresh-data.yml) 在工作日北京时间 22:17（UTC 14:17）运行，也可到仓库 Actions 页面手动运行。`cold_start=true` 忽略 Actions 历史源缓存；`publish=false` 仅验证，不提交或部署。只从 `main` 发布。
- [普通站点发布工作流](../.github/workflows/pages.yml) 在 `main` 的代码或文档推送后检查已提交的站点并部署。数据工作流用 `GITHUB_TOKEN` 提交时不会再次触发普通 `push` 工作流，所以它自己上传并部署刚通过验证的文件。
- GitHub Pages 发布源须为 **GitHub Actions**。两个部署作业共用 `pages-deployment` 并发组；网页只包含 `index.html`、`assets/`、`data/` 和 `docs/`，不上传原始缓存或本机日志。

## 发布门槛与失败处理

数据工作流先安装 Python/Node 运行时并运行单元测试，接着执行七阶段在线刷新。`research_funds` 每日更新已核验扩展基金（按已核验名单）的净值、收益和风险，再由 `screening` 重算候选规则。每一阶段必须返回零；`scripts/check_refresh.py` 还会核对七阶段报告、严格质量错误为零、标的集合不变、基金/指数/股票和策略关键来源日期不倒退。基础基金的分红与拆分页会归档为 `data/fund-actions.json`，记录逐只公开来源、实际抓取日、原始页哈希与已解析动作；旧证据仅用于其抓取日及之前的历史，之后必须有来源每日涨跌幅或新的公开动作证据。

通过后运行 `npm run version-assets` 与 `npm run check`。只有研究数据或来源证据确实变化时才提交 `data/*.js`、`data/*.json` 和随其变化的 `index.html`；未改变时保留原站点。提交使用工作流限定的 `contents: write`，Pages 部署作业单独使用 `pages: write` 与 `id-token: write`。任何步骤失败都不会提交或部署，新旧站点不混用；Actions 会保留 `refresh-report.json`、质量报告、状态文件及逐阶段日志 7 天。查看失败原因应先看本次运行的 `refresh-diagnosis-<run id>` 工件，再按[维护指南](maintenance.md)定位具体来源。

Actions 源缓存只是加速：`.tmp-hist/`、`.tmp-strategy/`、`.tmp-fhsp/`、`.tmp-managers/` 和股票缓存可能被清除。冷启动手动运行不读取旧缓存，但校验成功后仍保存本轮来源，供下次定时运行复用；新 runner 必须能从源站重新获取或用有明确日期的仓库证据安全复算。缓存丢失、源站不稳定或某字段无有效证据时，刷新明确失败，不会把本次尝试时间冒充观察日。GitHub 对缓存有清除规则，定时运行也可能延迟、丢失或因公开仓库长期无活动被停用：[缓存说明](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)、[定时事件规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)。应定期查看仓库 Actions 最近成功运行及页面的实际数据截至日。

## 冷启动验收记录

首次无缓存试跑 [36258819460](https://github.com/jianxieb/fund-data/actions/runs/36258819460) 的测试及其余五阶段通过，基础基金串行请求在第 30 只附近达到 420 秒上限。诊断试跑 [36259598787](https://github.com/jianxieb/fund-data/actions/runs/36259598787) 把上限提高到 900 秒，46 只全部处理完毕，但 159513 的公开资料页两次读取超时，基础基金阶段保守回滚。随后将逐只来源抓取改为三路并发、修正被意外截断的重试次数，并把 46 只分红/拆分页的已解析历史证据与来源日期纳入仓库。

第三次无缓存试跑 [36260439462](https://github.com/jianxieb/fund-data/actions/runs/36260439462) 六阶段全部成功，基础基金阶段用时 175 秒，严格质量错误为 0，标的集合和关键观察日未倒退。各来源**并非同日**：基础基金净值截至 2026-09-23、股票 2026-09-24、策略 2026-09-25；质量报告仍有 5 条限制提示和 4 处待核验，不应解释为全站数据均已审计。实际 Pages 发布另以发布工作流及线上文件为准。

首次真实发布 [36260970037](https://github.com/jianxieb/fund-data/actions/runs/36260970037) 再次无缓存完成六阶段、质量检查、机器人提交与 Pages 部署，数据提交为 `5ab1ea0`。部署后，线上 `index.html`、`data/refresh-report.json`、`data/snapshot.js` 和 `data/fund-actions.json` 的字节内容与仓库这次提交一致。普通代码推送的独立 [Pages 发布运行 36260930209](https://github.com/jianxieb/fund-data/actions/runs/36260930209) 也已通过。

数据按北京时间进入 2026-09-27 后，一次普通推送 [36261399971](https://github.com/jianxieb/fund-data/actions/runs/36261399971) 暴露了质量检查依赖 runner 的 UTC 日期、把经理核验日期误判为未来的问题。质量审计现明确使用北京时间，Pages 作业也设置相同时区；[36261497158](https://github.com/jianxieb/fund-data/actions/runs/36261497158) 已重新通过构建和部署。无发布冷启动 [36261412489](https://github.com/jianxieb/fund-data/actions/runs/36261412489) 成功保存约 2.9 MB 的公开源缓存；随后无发布运行 [36261768657](https://github.com/jianxieb/fund-data/actions/runs/36261768657) 成功恢复并更新该缓存，提交和部署步骤按设置跳过。这两次运行验证了与工作日调度相同的缓存路径。

## 尚未覆盖的更新

日常 `research_funds` 更新 `data/screening-validation.json` 中已完成全历史核验的扩展基金，包含当前全部默认权益候选。**不会每日重新抓取1268条旧池记录的历史净值、费用和规模**；未核验记录保留旧日期。新增基金先用 `verify-samples --apply` 完成首次核验，之后自动进入每日收益刷新。费率和经理仍使用独立证据日期，不能把七阶段成功解释为全站每个字段都更新到当天。有关分批指令和数据来源见[维护指南](maintenance.md)。

## 2026-09-30 更新修复

定时运行 [36618978531](https://github.com/jianxieb/fund-data/actions/runs/36618978531) 因经理资料接口超时返回非零，整批46只基础基金收益被回滚；扩展基金原流程只重算规则，未纳入每日业绩更新。现新增独立的 `research_funds` 阶段。基础基金经理/规模资料/场内报价失败记录为 `metadataWarnings`，保留旧字段及其来源日期，不再回滚已经校验成功的净值收益；净值、收益和基准缺证据仍拒绝发布。归档费率证据的 `checkedAt` 与每日业绩的 `performanceCheckedAt` 分开记录。

GitHub 对 `GITHUB_TOKEN` 提交不触发分支模式 Pages 构建，以及自定义部署的权限要求，见 [Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) 和 [自定义工作流部署](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
