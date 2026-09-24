# 自动更新实施方案（2026-09-24）

## 现状与本次实跑

仓库已有跨平台的 `python3 refresh.py`，负责基金、国内指数、股票、基金筛选、投入策略及最后的严格质量检查，并逐阶段限时、回滚失败阶段。它不会定时启动，也不会提交或推送。仓库目前没有 `.github/workflows/`。GitHub Pages 现在从 `main` 分支根目录发布，因此只有手动推送后的页面快照会更新。

2026-09-24 手工在线运行 `python3 refresh.py --timeout 300` 时，首轮发现 Yahoo 汇率日线附带当日未结束的盘中报价，基金阶段因此拒绝并回滚；国证接口本次只返回到 2026-03-27，早于已保存的 2026-09-21。修复后重跑，六阶段均成功，严格质量检查为 0 错误。国证两条指数继续使用已保存的 9 月 21 日日线，并显式标记来源倒退；基金净值截至 9 月 22 日、策略截至 9 月 23 日。一次调度成功不代表每个源都更新到了同一日期。

## 推荐实现

1. 在 GitHub Actions 加一个可以手动触发的更新工作流，先用新检出环境跑通一次在线更新。安装 Python 3.9+、Node.js 18+，执行 `refresh.py`、Python/JS 测试、`data_quality.py --strict`、`npm run version-assets` 和 `npm run check`。仅当刷新六阶段全部成功、质量错误为零、测试通过且数据日期没有倒退时才进入发布步骤。失败时保留现有站点，上传报告和日志供定位。
2. 冷启动必须成立：`.tmp-hist/`、`.tmp-strategy/` 等原始缓存不入库。Actions 缓存可以加速，但不能作为唯一数据来源；缓存丢失时应从源站重新获取、重新计算，失败就明确停止发布。GitHub 官方说明 Actions 缓存可能因未访问或容量被清除：[依赖缓存说明](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)。首次手动运行应专门检验无缓存路径及源站限流，必要时再设计带哈希的持久原始输入备份。
3. 冷启动与失败回退验证通过后，设为工作日北京时间 22:17 左右运行，并保留手动触发。该时间中国市场已收盘、前一美国交易日通常也已结束；QDII 净值仍按实际来源日显示。定时事件可能延迟或丢失，避免整点，并监控最近一次成功运行时间；GitHub 对无活动的公开仓库还可能停用定时工作流：[定时工作流规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)。
4. 只提交生成的数据文件、刷新报告和随数据变化的 `index.html` 资源版本。发布前重新检查代码集合、记录数量和关键日期；无有效变化时不提交。生成数据提交到 `main`，保证另一台电脑拉取后看到与站点一致的快照。工作流使用最小必要权限，不暴露个人访问令牌，也不在外部源失败时将“本次尝试时间”冒充观察日。
5. 将 Pages 发布源从当前的分支模式改为 GitHub Actions，让**同一次已验证的工作流**上传并部署站点。GitHub 官方明确指出：使用 `GITHUB_TOKEN` 的工作流提交即使推到 Pages 来源分支，也不会触发该分支模式的 Pages 构建；自定义 Pages 部署需要 `pages: write` 和 `id-token: write`：[Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[自定义部署](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。仓库当前的默认工作流权限是只读，实施时需要在具体作业内声明写入权限并通过手动运行验证。

## 覆盖边界

当前 `refresh.py` 的 `screening` 阶段只对扩展基金池重新应用筛选规则，**不会重新抓取 1268 条扩展基金的历史净值、费用和规模**。因此把现有脚本放入定时器不能宣称“全站数据每日更新”。第二阶段应增加按代码分批的扩展基金刷新：先对 24 只默认候选核验近期净值和申购状态，再按研究优先级逐批扩展；每条保留来源、份额类别、观察日、原始摘要和失败状态。全量重建与经理/费率等慢速来源宜单独安排，不挤进每日例行工作流。完成前，页面继续展示这部分数据的旧日期与待核验标记。

上线验收至少包括：无缓存新检出能完成在线计算；人工触发能生成与本地同口径的结果；源站失败时不部署错误数据；源返回较旧日线时不倒退；机器人数据提交与同次 Pages 部署后的站点内容一致。首次上线前先完成这些验证，再开启定时触发。
