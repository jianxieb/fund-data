"""Refresh the single research entry page from frozen selected results."""
from pathlib import Path
import json
HERE = Path(__file__).resolve().parent
target = HERE.parent.parent / 'portfolio-entry-research.html'
s = target.read_text()
d = json.loads((HERE / 'report-data.json').read_text())
names = ['低位评分·预留10%', '低位评分·预留20%', '低位与恐慌·预留10%']
rows = ''.join(f'<tr><td>{names[i]}</td><td>{r["parameters"]["threshold"]}分</td><td>{r["vsLump"]["10"]["cagrDifferencePP"]:+.3f}</td><td>{r["vsLump"]["15"]["cagrDifferencePP"]:+.3f}</td><td>{r["vsOriginalVix"]["10"]["cagrDifferencePP"]:+.3f}</td><td>{r["scoreOnlyVsLump"]["10"]["cagrDifferencePP"]:+.3f}</td></tr>' for i,r in enumerate(d['selected']))
nav = '<nav><a href="../#portfolio">返回组合模拟</a><a href="research/portfolio-opportunity-20261106/report.pdf">下载加仓评分报告</a><a href="research/portfolio-opportunity-20261106/README.md">全部实验与复算证据</a></nav>'
section = '''<section id="opportunity"><p class="meta">2026年11月6日 · 连续加仓分数与实际模拟买单</p><h1>加仓分数怎么计算<br>资金具体怎么买入</h1>
<p class="lead">每天由QQQ／SOXX及可选的VIX信息计算0–100分，再由同一分数决定动用多少待加仓现金。首笔买法、每日代入和下一笔金额都直接显示在组合模拟里。</p>
<div class="warning"><strong>组合方法胜过同预算一次性投入，但新评分的独立增益尚未证实。</strong>历史优势主要来自既有VIX风险退出；去掉该退出，仅用新评分加仓，三条规则十年平均均略输一次性。分数是可执行的研究规则强度，不是上涨胜率。</div>
<h2>本轮交付的三种选择</h2><div class="scroll"><table><thead><tr><th>方法</th><th>买入门槛</th><th>十年对一次性/pp</th><th>十五年对一次性/pp</th><th>十年对原VIX/pp</th><th>评分单独十年/pp</th></tr></thead><tbody>''' + rows + '''</tbody></table></div>
<p class="note">USD30%／TQQQ30%／现金40%，无新增资金，单侧费0.10%，模拟资本利得税及股息税20%。十年81个起点、十五年21个起点，先配对再按入场年等权；这些窗口高度重叠。真实ETF研究截至2026-11-02，没有实际TQQQ二十年证据。</p>
<h2>具体买法</h2><ol><li><strong>首次：</strong>10%版本先买各自股票预算的90%，20%版本先买80%；其余留在各标的待加仓现金，原配置现金不动。</li><li><strong>每天：</strong>分数低于门槛不买；达到门槛，动用该标的待加仓现金的 <code>(分数−门槛+10)/(110−门槛)</code>，比例限制在0至1，再扣买入费。低分本身不卖出。</li><li><strong>成交：</strong>共同收盘确定金额，下一共同收盘执行；剩余尾款低于期初本金0.01%时一并买入。没有可用现金就不买，连续高分不会自动产生入金。</li><li><strong>TQQQ风险门：</strong>VIX期限结构持续恐慌时退出TQQQ；门恢复后仍按分数分批买。卖出净回款到账后才能再计划使用，原规则详见下方历史方法。</li><li><strong>后续到账资金：</strong>已配置的新增股票资金先进入各腿待加仓现金池，再按同一评分买入。预算试算只展示新钱去向，不回写历史收益。</li></ol>
<p>例如65分、门槛35分、专属现金3000元：动用53.33%，含费支出1600元；费率0.10%时买入1598.40元、费用1.60元。65分既不是65%账户仓位，也不是65%胜率。</p>
<h2>分数公式与来源</h2><p class="formula"><strong>低位：</strong>100×(0.60D+0.40S)<br><strong>低位与恐慌：</strong>100×(0.40D+0.30S+0.15F+0.15R)</p>
<p>D是252次收盘回撤除以25%后限制到0–1；S是当前P/MA252在此前最多1260个完整比值中的反向分位（相等计半）。TQQQ用QQQ，USD用SOXX。F是已知VIX在此前最多1260个收盘中的分位；R是63次VIX峰值回落，结合峰值是否高于20计算的0–1强度。VIX严格早于决策日，当前价格可以在完成收盘后使用。</p>
<p>系数在第一轮网格前固定，三个交付版本在观察结果后选出；没有概率校准。页面默认显示当日原始数值、计数、归一值、加权合计和金额公式，缺历史时留空，不填中性分数。</p>
<h2>全部实验已列入报告</h2><p>本轮54条不同规则：第一轮36条、第二轮18条，另做权重、税费、延迟和去掉单项规则的比较。第一轮全部36条十年均输50/50一次性全投，不能把动用原40%现金的收益冒充择时有效。报告附表逐行列出54条，不隐藏失败；完整216行摘要在<a href="research/portfolio-opportunity-20261106/all-candidates.csv">全候选CSV</a>，逐账户结果与输入在同目录复算包。</p></section>'''
begin = s.index('<nav>')
marker = '<details><summary>此前三种调仓方法、状态用途与历史证据</summary>'
if marker in s:
    end = s.index(marker)
    s = s[:begin] + nav + section + s[end:]
else:
    end = s.index('<p class="meta">', begin)
    s = s[:begin] + nav + section + marker + s[end:]
    s = s.replace('<footer>', '</details><footer>', 1)
s = s.replace('三种新增投入方法<br>与同配置一次性投入比较', '此前三种调仓方法<br>与同配置一次性投入比较')
s = s.replace('用途纠正：现有输出是策略状态，尚未完成加仓时机优劣指标。', '用途纠正：下列旧方法输出为策略状态，不是上方新增的加仓评分。')
s = s.replace('<title>USD与TQQQ长期投入方法对照报告 · 长衡</title>', '<title>每日加仓评分与长期投入方法 · 长衡</title>')
target.write_text(s)
