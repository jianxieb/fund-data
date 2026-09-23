# 无本机缓存的新环境验证

验证日期：2026-09-24。目标是确认公开仓库的已提交快照可以直接浏览和测试，并确认缺少原始缓存时离线更新会如实失败，不破坏可用的公开数据。这里的“新环境”是从本仓库创建的独立检出目录，不继承`.tmp-hist/`、`.tmp-strategy/`、`screens/.cache/`等本机缓存；不是另一台实际电脑的硬件兼容性测试。

验证机使用Python 3.9.6、Node.js 26.5.0。在独立检出目录建立虚拟环境，按`requirements.txt`安装`tzdata 2026.4`，无需npm安装步骤。仓库内已有`data/snapshot.js`和`data/index-history.json`。以下命令均在该目录执行：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -q
node --test tests/model.test.cjs
npm run check
.venv/bin/python data_quality.py --strict
.venv/bin/python refresh.py --offline --timeout 15
```

单元验证通过：Python 86项、Node 15项；前端脚本语法与8个本地资源内容版本一致。严格质量检查返回0个错误、5项警告和3项待核验；它检查当前快照的结构与已记录证据，不表示上游资料已独立审计。

完整离线刷新按预期返回退出码1与`partial`报告：`funds`因原始历史缺失返回3，`strategy`因缺少经校验的SPY历史缓存返回1；`indices`、`stocks`、`screening`及最终`quality`完成。失败日志保留，`data/refresh-report.json`对基金阶段记录`publishedRollback: true`。基金阶段内部曾写出不完整基准；统一入口随即恢复`data/snapshot.js`。刷新前后逐项核对`META`、`BM`、`FUNDS`、`STRATEGY_META`和`STOCKS`，值均一致。成功的其他阶段可独立保留其产物。超时分支同样有回滚单元测试。

质量检查和刷新会改变生成报告或成功阶段的公开数据，准备发布时运行`npm run version-assets`，然后`npm run check`核对`index.html`内CSS/JS引用的内容摘要。重新生成基金或策略历史仍需联网取得对应原始资料；只有提交的快照足以浏览、检索和运行现有回归，不能把离线缺缓存说成已刷新行情。
