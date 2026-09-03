# 标普500 与 纳斯达克 基金清单（fund-data）

数据截至 **2026-08-31**（QDII T+1 公布），生成于 2026-09-02 盘中。

## 内容

- [`index.html`](index.html)：交互式清单（单文件）——三张表（标普500 ×10、纳斯达克场外 ×19、纳指 ETF ×14），支持表头排序、代码/名称过滤、天天基金链接直达；内置 ECharts 对比图（收益柱状 / 收益曲线 / 费用 / 风险收益 / 规模）、数据总览、CSV 导出、打印。
- [`标普500与纳斯达克基金清单.md`](标普500与纳斯达克基金清单.md)：Markdown 版清单。

## 本地 / 离线使用（网络受限电脑推荐）

1. 下载本仓库（GitHub 页面 **Code → Download ZIP**，或直接把 `index.html` 保存下来）；
2. 下载 ECharts 图表库 `echarts.min.js`（约 1MB，任一国内镜像均可）：
   - https://registry.npmmirror.com/echarts/5.5.1/files/dist/echarts.min.js
   - https://cdn.bootcdn.net/ajax/libs/echarts/5.5.1/echarts.min.js
   - https://cdn.staticfile.net/echarts/5.5.1/echarts.min.js
   - https://lib.baomitu.com/echarts/5.5.1/echarts.min.js
3. 把 `echarts.min.js` 和 HTML 放在**同一个文件夹**里，双击打开 HTML 即可——页面优先加载本地图表库，完全离线可用；若未找到本地文件会自动回退到 jsDelivr / unpkg / BootCDN / staticfile 四个在线源。
4. 图表库加载失败也不影响表格、排序、过滤、CSV 导出与打印。

## 口径

- 只保留 A 类人民币份额：C/D/E/I 与美元现汇/现钞份额剔除。
- 区间涨幅按累计净值（含分红再投资）计算；国泰纳斯达克100（160213）因 2025 年四次大额分红按红利再投资口径重算。
- 数据来源：天天基金/东方财富公开接口（fundmobapi.eastmoney.com、fundf10.eastmoney.com）。

> 仅供研究参考，不构成投资建议。
