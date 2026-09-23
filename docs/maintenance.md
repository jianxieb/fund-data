# 数据更新与维护指南

本指南面向后续维护者。计算定义与产品边界见[产品决策](product-decisions.md)，当前核验覆盖见[公开研究验收](public-research-revision.md)。脚本在仓库根目录运行；前端直接读取已生成的公开快照。

## 首次取得仓库

需要Python 3.9+和Node.js 18+。前端不需要安装npm依赖或构建。

```sh
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests -q
node --test tests/model.test.cjs
npm run check
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 http://127.0.0.1:8765 。Windows命令中的`python3`可换成`python`。Python依赖中的`tzdata`用于提供IANA时区库，不能把外汇源的当地交易日直接按UTC日期截取。

克隆后即可浏览快照和运行单元测试。基金、股票和策略的完整原始缓存不入库，因此第一次运行完整离线刷新可能因缺缓存失败；应先联网刷新对应数据。国内指数原始日线已保存在`data/index-history.json`。

已提交的`data/snapshot.js`含默认2010起点的`STRATEGY_RESULTS`、`STRATEGY_CURVES`和其余四个起点的`STRATEGY_WINDOWS`，所以新电脑即使没有历史缓存，也能直接查看1993/1999/2001/2010/2020五组结果与交互曲线。要**重新计算**，应联网运行`python3 strategy_backtest.py --refresh`取得ETF完整历史，再执行`python3 data_quality.py --strict`；只有本机已保存所有ETF的完整早期行情时才使用`python3 strategy_backtest.py --offline`。曲线使用同一回测区间的资金流中性单位净值，首日为100；保留首日、每周最后一个真实交易日和末日，不插值。网页悬浮点显示该交易日所有可见标的的单位净值。汇总结果的XIRR仍为资金加权口径，两者不能互换。

起点年份是回测下限，实际开始日取该年之后所有可用标的的首个共同交易日；未上市的ETF不参与该窗口。当前快照分别从1993-01-29（SPY）、1999-03-10（SPY/QQQ）、2001-07-13（SPY/QQQ/SOXX）、2010-03-11（九只）、2020-01-02（九只）开始，均截至2026-09-21，共288组实验。前三只ETF的发行资料可核对：[SPY](https://www.ssga.com/us/en/institutional/etfs/state-street-spdr-sp-500-etf-trust-spy)、[QQQ](https://www.invesco.com/qqq-etf/en/home.html)、[SOXX](https://www.ishares.com/us/products/239705/SOX)。快照里的最早日期是行情源首个有效复权收盘观察日，可能晚于基金成立日。质量检查会检查每组窗口和曲线的结构、一致性；不会把第三方复权行情视为已独立审计。

## 日常刷新

```sh
python3 refresh.py
python3 refresh.py --datasets funds,indices --timeout 300
python3 refresh.py --offline
```

第一条刷新全部六个阶段，每阶段默认限时180秒；第二条只更新选定数据集，最后仍自动检查质量；第三条严格使用本机缓存，不联网。首次下载历史较慢时可适当增大超时。

Windows入口调用相同流程：

```powershell
.\daily_update.ps1
.\daily_update.ps1 -Datasets funds,indices -Timeout 300
.\daily_update.ps1 -Offline
```

| 阶段 | 实际负责什么 |
| --- | --- |
| `funds` / `update.py` | 基础基金集的净值、收益、风险、经理、费用/交易资料，以及海外指数和ETF参照 |
| `indices` / `indices.py` | 国内指数自身日线、完整窗口回报和风险 |
| `stocks` / `stock_screen.py` | 观察样本行情、复权回报、风险和已实施分红 |
| `screening` / `screens/fund_screen.py policy` | 对已有扩展快照重新应用权益研究规则，不代表重新下载全部扩展基金净值 |
| `strategy` / `strategy_backtest.py` | 下载或读取明确复权的ETF行情，按五个可用起点重新计算投入实验与每周实际交易日采样的曲线 |
| `quality` / `data_quality.py --strict` | 检查格式、日期、缺失、核验状态与策略曲线对齐，生成质量报告 |

统一入口顺序执行，带并发锁；各脚本独立运行时也应依次完成，避免同时修改共享快照。刷新不提交Git、不推送、不创建系统定时任务。已有定时任务如果调用`daily_update.ps1`，会使用新数据流程，但不会再自动发布。

## 扩展研究池的核验与重建

仅重新筛选：

```sh
python3 screens/fund_screen.py policy
```

补充当前权益候选的历史收益、风险与费用证据，并回写成功记录：

```sh
python3 screens/fund_screen.py verify-samples --codes shortlist --apply
python3 data_quality.py --strict
```

也可将`shortlist`替换为逗号分隔的基金代码，分批处理其余待核验记录。去掉`--apply`会生成核验证据而不回写业绩。成功写回后会重新生成候选规则；未成功的记录不会变成“已核验”。这个步骤不保证同时刷新净值、规模和申购状态，各字段仍使用自身日期。

单独重新核对经理资料：

```sh
python3 update.py --managers-only --refresh-managers
python3 screens/fund_screen.py managers --codes all --workers 2 --refresh
python3 screens/fund_screen.py policy
python3 data_quality.py --strict
```

第一条负责基础基金集，第二条负责扩展研究池。经理缓存有效期7天；失败保留旧记录与原观察日，不借用团队组合变更日作为个人上任日期。

需要从全市场重新发现和丰富产品时，按阶段运行，便于检查中间结果与恢复：

```sh
python3 screens/fund_screen.py universe
python3 screens/fund_screen.py prefilter
python3 screens/fund_screen.py enrich --workers 2 --refresh
python3 screens/fund_screen.py metrics --workers 2 --refresh
python3 screens/fund_screen.py report
python3 screens/fund_screen.py html --refresh
python3 screens/fund_screen.py managers --codes all --workers 2 --refresh
python3 screens/fund_screen.py policy
python3 screens/fund_screen.py verify-samples --codes shortlist --apply
python3 data_quality.py --strict
```

全量发现可能产生数千只记录，网络量远大于日常刷新。`html`是保留的命令名，现在只更新`data/snapshot.js`中的扩展研究池，不生成或覆盖网页界面。`report`的Markdown报告与CSV用于研究追溯，网页当前筛选规则以`data/screening.js`为准。全量重建后的当前候选需要重新核验；已有源日期和核验状态不能因为重新筛选而更新。

## 查看结果与定位失败

| 文件 | 用途 |
| --- | --- |
| `data/refresh-report.json` | 最近一次统一刷新执行了哪些阶段、退出码、耗时及是否部分失败 |
| `data/update-status.json` | 各数据集最近执行、缓存/失败状态与最近在线尝试 |
| `data/quality.json` | 当前内容错误、使用限制和待核验项目 |
| `.tmp-snap/refresh-<dataset>.log` | 对应阶段完整本地日志 |
| `data/verification-*.json`、`data/*-validation.json` | 来源、区间、原始摘要、重算与代表项核验记录 |

命令成功不等于全部数据都新鲜或经过独立审计。质量检查的严格模式以错误决定失败；仍可能存在限制提示和待核验记录。数据源失败或超时返回非零码，已成功的其他阶段可以保留。

先查看失败阶段日志，再单独重试对应`--datasets`。不要通过改页面日期、删质量标记或填零消除失败。出现刷新锁时，先确认没有正在运行的刷新进程，才能清理遗留的`.tmp-snap/refresh.lock`。

本地原始缓存和日志位于`.tmp-hist/`、`.tmp-fhsp/`、`.tmp-managers/`、`.tmp-screen/`、`.tmp-strategy/`、`.tmp-snap/`、`screens/.cache/`及`screens/data/`。需要重演同一批来源时应自行保留这些缓存；它们通常不提交到Git。缓存是输入证据，重新下载时上游历史可能发生修订。

## 修改方法或发布新快照

| 需要修改 | 入口 |
| --- | --- |
| 页面布局、交互、列显示 | `assets/app.js`、`assets/style.css` |
| 前端日期、窗口、年化、空值与导出处理 | `assets/model.js` |
| 权益资格、分类、排序与名额约束 | `screens/fund_screen.py`，修改后生成`policy`，并核对前端筛选一致性 |
| 复权、公司行为、基础基金和海外参照 | `update.py` |
| 国内指数身份和原始日线 | `indices.py` |
| 股票与策略计算 | `stock_screen.py`、`strategy_backtest.py` |
| 质量检查、执行状态、统一调度 | `data_quality.py`、`data_status.py`、`refresh.py` |

收益、风险、净值、经理、规模和费用日期必须独立维护。价格指数不能冒充含分红回报，ETF不能冒充指数全收益，缺少完整窗口时保留空值。新增字段同步检查详情、对比、CSV和方法说明；新增来源记录身份、币种、复权定义及原始观察日期。

发布前运行单元测试、语法检查和质量检查，在浏览器检查实际变更，再审阅Git差异。提交脚本、文档及相互对应的数据产物；不要提交原始大缓存、个人资料或凭据。修改前端静态资源时更新`index.html`中的资源版本，使已有浏览器重新加载。

提交与推送由维护者显式执行。GitHub是否自动部署取决于仓库自身的Pages或其他部署设置，更新脚本不处理部署，也不把推送完成当成网站部署成功。
