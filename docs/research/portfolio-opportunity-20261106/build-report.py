"""Build the readable report from frozen numeric results; no model selection here."""
import json
from pathlib import Path
from html import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = Path(__file__).resolve().parent
D = json.loads((HERE / 'report-data.json').read_text())
pdfmetrics.registerFont(TTFont('Chinese', '/System/Library/Fonts/STHeiti Light.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('ChineseBold', '/System/Library/Fonts/STHeiti Medium.ttc', subfontIndex=0))
INK, GREEN, GRAY = '#243d33', '#396a4a', '#68796e'
styles = {k: ParagraphStyle(k, fontName='ChineseBold' if k in ('title', 'h1', 'h2') else 'Chinese',
    fontSize=size, leading=leading, textColor=colors.HexColor(INK), spaceAfter=after,
    wordWrap='CJK') for k, size, leading, after in [('title', 25, 34, 16), ('h1', 17, 25, 12),
    ('h2', 12, 19, 7), ('body', 10.2, 17, 9), ('note', 8.5, 13, 7), ('cell', 9, 14, 0)]}
story = []
names = ['低位评分 · 预留10%', '低位评分 · 预留20%', '低位与恐慌 · 预留10%']
def p(text, style='body'):
    story.append(Paragraph(text, styles[style]))
def pp(v): return f'{v:+.3f}'
def num(v): return f'{v:,.2f}'
def table(headers, rows, widths):
    t = Table([[Paragraph(escape(str(v)), styles['cell']) for v in r] for r in [headers] + rows],
              colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eaf0e2')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8), ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8), ('LINEBELOW', (0, 0), (-1, -1), .4, colors.HexColor('#dce3d6'))]))
    story.extend([t, Spacer(1, 12)])
def page(title):
    story.append(PageBreak()); p(title, 'h1')
def comparison(key):
    return [[names[i], pp(s[key]['10']['cagrDifferencePP']), pp(s[key]['15']['cagrDifferencePP'])] for i,s in enumerate(D['selected'])]

p('每日加仓评分<br/>公式、执行规则与长期对照', 'title')
p('长衡研究报告  |  2026-11-06  |  真实ETF历史截至2026-11-02', 'note')
p('已交付的是能生成真实模拟买单的连续规则分数。它每天按底层ETF的价格折让、历史相对低位以及可选的VIX恐慌信息计算，不再把“允许持仓”写成100分。', 'body')
p('研究结论：三条组合方法在同股票预算下优于一次性投入；优势主要来自既有VIX风险退出。把VIX退出拿掉，只留下新评分加仓，三条规则的十年平均都略输一次性投入。因此不能把组合收益当作“分数已经证明能识别更好的买点”。', 'body')
p('三条交付规则的取舍', 'h2')
rows=[]
for i,s in enumerate(D['selected']):
    a,b=s['vsLump']['10'],s['vsLump']['15']
    rows.append([names[i], str(s['parameters']['threshold']), pp(a['cagrDifferencePP']), pp(b['cagrDifferencePP']), f"{a['wins']}/{a['n']}", f"{a['medianMDD']:.2f}%"])
table(['方法','门槛/分','十年差/pp','十五年差/pp','十年胜/总','十年回撤中位'],rows,[142,48,71,78,68,92])
p('主配置为USD ETF 30%、TQQQ 30%、原现金40%；不新增本金、不周期再平衡。单侧费0.10%，模拟资本利得税及股息税各20%，未实现正收益计提税款准备金，现金零息。每行对照同起点、同本金、同原始股票预算的一次性投入。', 'note')
p('十年81个起点（2010-03至2016-11）；十五年21个起点（2010-03至2011-11），十五年三条均21胜。差值先逐户配对，再按入场年等权；pp是年化收益百分点。窗口高度重叠，不是81或21次独立验证。', 'note')
p('10%低位版在三条中十年结果较好；20%低位版的十五年结果较好；恐慌版用于检验非价格信息，结果并未优于10%低位版。它们是历史探索中的取舍，不是未来最优承诺。')

page('01  分数到底怎么算')
p('TQQQ使用QQQ实际美元复权价格；USD ETF使用SOXX实际美元复权价格。SOXX是行业ETF代理，并不冒充USD的官方基准指数。VIX取严格早于决策日的官方收盘；价格可取当日已完成收盘。所有买单在下一共同收盘成交。')
table(['成分','原始数据与完整计算'],[
 ['D 回撤折让','P为当前价，H252为最近252次收盘最高价。D=clip((1-P/H252)/0.25)。下跌25%及以上封顶为1。'],
 ['S 历史相对低位','先算P/MA252。只与此前最多1260个完整MA252比值比较，S=(较高值数量+0.5×相等数量)/历史数量。至少252个有效历史比值。当前值不进样本。'],
 ['F 恐慌水平','已知VIX与此前最多1260个VIX收盘比较，F=此前严格低于当前VIX的数量/历史数量。至少252个此前收盘。'],
 ['R 恐慌回落','H为最近63次VIX收盘峰值。R=clip((H-VIX)/(0.4H))×clip((H-20)/30)。高峰不超过20时，此项为0。']],[110,389])
p('clip(x)=max(0,min(1,x))，将数值限制在0至1。', 'note')
p('低位评分 = 100 × (0.60D + 0.40S)', 'h2')
p('低位与恐慌评分 = 100 × (0.40D + 0.30S + 0.15F + 0.15R)', 'h2')
p('这些系数是运行第一轮网格之前固定的规则权重，不是回归拟合或概率校准；三个交付选项是在看过本轮54条规则结果之后选出，因此仍有选择偏差。没有把分数解释为上涨概率。')
p('本轮还检验了21/126日已实现波动、VIX期限结构与恐慌恢复的组合。未把PE塞进当前公式：已有发行商历史估值存档不等于连续、当天可得的每日PE序列，本轮没有声称验证了PE混合评分。')
p('缺完整预热时显示“历史不足”，分数为空，不填0或50。缺来源或数据过期时停止新增订单并说明具体缺项；不跨越未核实的数据空洞。')

page('02  具体怎么买、每次用多少钱')
p('第一笔：先建立基础仓', 'h2')
p('配置本金B、股票权重w、预留比例r。两只ETF首次只买各自股票预算的(1-r)，其余r进入该标的专属待加仓现金；原配置现金保留。主配置10万元、预留10%、单侧费0.10%时，U=100000/(1+0.001×0.60×0.90)。')
u=100000/(1+.001*.6*.9)
table(['去向','首笔金额/元'],[['买入USD',num(u*.3*.9)],['买入TQQQ',num(u*.3*.9)],['USD待加仓现金',num(u*.3*.1)],['TQQQ待加仓现金',num(u*.3*.1)],['原配置现金',num(u*.4)],['合计交易费',num(u*.6*.9*.001)]],[300,199])
p('后续每个共同收盘：先核风险门，再按分数花现金', 'h2')
p('分数低于门槛T：不买。达到门槛且风险门允许时，比例f=clip((分数-T+10)/(110-T))。本次含费支出=该腿可用现金×f；成交买入额=含费支出/(1+费率)。若剩余尾款低于期初本金的0.01%，把尾款一并投入。低分本身不触发卖出。')
p('例如65分、门槛35分、可用待加仓现金3000元：f=(65-35+10)/75=53.3333%；支出1600元，单侧费0.10%时成交1598.40元、费用1.60元。65分不是投入总资产的65%，也不是65%胜率。')
p('连续高分时，下一笔只从剩余待加仓现金计算；现金为0就不买，不凭空增加本金。后续实际新增股票资金先进入各腿待加仓现金池，再按同一分数规则执行；原现金和其他资产仍按配置处理。报告主研究不含新增资金，这部分单列为系统执行能力。')
p('卖出资金不能提前花。决策收盘锁定卖出份额、买入金额；下一共同收盘成交，卖出扣费税后的实际回款才进入之后的买入计划。年化收益来自这些真实模拟订单与实际入金，不来自分数曲线本身。')

page('03  风险退出与真实买单示例')
p('VIX风险门只控制TQQQ。VIX/VIX3M&gt;1.10连续10个源观测时退出；离场至少5次观测且VIX较离场后峰值下降30%，或比值&lt;1连续5次时允许再买。恢复后，连续5次比值&lt;1才重新启用退出计数。门关闭时即使分数很高也不买；门恢复后仍按分数分批买入。USD没有这道退出门。')
p('以下为低位10%版本，10万元、2014-01-02至2024-01-02的实际模拟订单。只有一笔外部入金。', 'note')
ex=D['selected'][0]['example']
for t in ex['exampleTrades']:
    p(f"{t['signalDay']} 决策 → {t['fillDay']} 买入TQQQ",'h2')
    p('得分='+ ' + '.join(f"{x['points']:.6f}" for x in t['components'])+f"={t['score']:.6f}分；动用比例{t['buyFraction']*100:.4f}%。")
    table(['可用专属现金','含费支出','实际买入额','交易费'],[[num(t['sleeveCashBefore']),num(t['buySpend']),num(t['actualNotional']),num(t['actualFee'])]],[125,125,125,124])
p(f"本账户共{ex['trades']}笔买卖（含首次两只ETF建仓），期末税后估值{num(ex['finalValue'])}元，组合年化{ex['annualReturn']:.4f}%，最大回撤{ex['mdd']:.2f}%。同一笔本金在退出后可能再次买入，所以累计买入额可以超过期初本金；这不等于新增入金。")
p('分数在历史上是否天天接近100？', 'h2')
table(['公式/标的','有效天数','中位分','最高分','100分天数'],[[('低位' if x['family']=='discount' else '低位与恐慌')+'/'+('USD' if k==0 else 'TQQQ'),leg['n'],f"{leg['median']:.2f}",f"{leg['max']:.2f}",leg['hundredDays']] for x in D['distribution'] for k,leg in enumerate(x['legs'])],[170,80,80,85,84])
p('分数分布为2010-02-11至2026-11-02全共同日。恐慌版最早153日缺252个此前VIX样本，分数为空；预热期间不凭空补值。', 'note')

page('04  收益来自哪里、哪些结果不成立')
p('与原VIX方法比较：新增评分的净改善', 'h2')
table(['方法','十年差/pp','十五年差/pp'],comparison('vsOriginalVix'),[285,107,107])
p('去掉VIX退出，只留评分加仓：与一次性比较', 'h2')
table(['方法','十年差/pp','十五年差/pp'],comparison('scoreOnlyVsLump'),[285,107,107])
p('三条评分单独使用的十年平均均为负。这是“评分因子尚未证明独立有效”的直接证据。恐慌成分加入低位评分也没有改善所选版本的平均成绩；不能只列第一张正收益表。')
p('第一轮36条规则曾尝试动用原40%现金。虽然不少规则胜过60%股票起步的对照，全部36条的十年平均都输给50/50一开始全投的对照。这个差别证明必须控制初始投入比例，不能把多投钱说成更会择时。月度双向目标仓位版本也明显落后，全部保留在完整网格。')
p('执行延迟与成本压力', 'h2')
table(['方法','双费十年/pp','双费十五年/pp','晚一天十年/pp','晚一天十五年/pp'],[[names[i],pp(s['stress']['doubleFee']['10']['cagrDifferencePP']),pp(s['stress']['doubleFee']['15']['cagrDifferencePP']),pp(s['stress']['extraDay']['10']['cagrDifferencePP']),pp(s['stress']['extraDay']['15']['cagrDifferencePP'])]for i,s in enumerate(D['selected'])],[163,84,84,84,84])
p('双费为每侧0.20%。额外延迟一天明显削弱收益；40/20和20/40原始股票权重也已逐户复算。50/50满股票预算下仍先按本方法保留10%或20%作为待加仓现金，再与50/50一次全投配对。不是在较低投入基准上制造优势。', 'note')
p('没有实际TQQQ二十年持有结果；本次也没有用另一基金或上市前合成序列冒充该证据。所有长期窗口共享主要危机，VIX中心规则只有2020年一个主要完整退出事件；这些历史已经被多轮研究使用，没有新的独立样本外验证。')

page('05  完整研究清单与复算入口')
p('本轮54条不同规则：第一轮4类分数×3类执行方式×3门槛=36条；第二轮3类分数×3档预留×2门槛=18条。第二轮另跑两种股票预算，属于配置重复，不把它说成36条新规则。完整CSV含216个摘要行，逐账户结果在复算包。')
p('所有候选、负结果、逐户CAGR、回撤、税费、成交与冻结脚本均随报告提供：', 'body')
for name, desc in [('all-candidates.csv','216行完整候选摘要，包括失败方法与两种预算对照'),('report-data.json','三方法、拆分贡献、权重与延迟压力、真实订单的精确数值'),('reproduction.tar.gz','原始输入、54条规则、全部逐户结果和独立复算入口'),('integration-audit.json','当前生产模块与冻结研究账户的一致性检查')]:
    p(f'{name} - {desc}', 'note')
p('复算：解压reproduction.tar.gz，进入目录，运行 node reproduce.cjs /任意新的空目录。入口先核验冻结输入，再重跑所有网格及对照；不会下载未来数据或覆盖原始结果。', 'body')
p('源身份：QQQ、SOXX、USD、TQQQ实际美元含分红复权历史及人民币汇率；官方Cboe VIX/VIX3M历史CSV。各原始来源、提取参数、日期和文件哈希在复算包中。价格、ETF和波动指数分别保留身份。', 'body')
p('系统使用：组合模拟 → 本金投入方式 → 选对应评分加仓法 → 模拟。首笔买法在设置处默认可见；每日卡片展示分数、各项代入、待加仓现金和下一笔订单。修改权重重新跑；保持同一起点可延续到最新行情。新增预算试算是独立计划，不写回已完成回测的入金和年化。', 'body')
p('可以据此执行和复核一条明确的历史研究规则；不能据此宣称已找到长期稳定优于一次性投入的独立加仓因子。', 'h2')

page('附表A  第一轮全部36条结果')
p('所有数值为年化差（pp）。原60%指USD30/TQQQ30/现金40一次性；全投指USD50/TQQQ50一次性。用原现金类把现金分三分之一、每隔至少21个共同日部署；月调仓按分数决定40%至100%股票目标；退出+用现金另加VIX门。持续高于门槛即可再次部署，不要求重新向上穿越。', 'note')
family_names={'discount':'低位','volatility':'实际波动','fear':'恐慌','mixed':'综合'}
policy_names={'deploy':'用原现金','target':'月调仓','risk_deploy':'退出+用现金'}
table(['分数','执行','门槛','十年/原60%','十年/全投','十五年/全投'],[[family_names[r['family']],policy_names[r['policy']],r['threshold'],pp(r['periods']['10']['base']['cagrDifferencePP']),pp(r['periods']['10']['full']['cagrDifferencePP']),pp(r['periods']['15']['full']['cagrDifferencePP'])]for r in D['firstGrid']],[75,100,44,93,93,94])
page('附表B  第二轮全部18条规则')
p('全部加VIX风险退出；仅动各腿预留及卖出回款，不动原配置现金。两套预算分别与各自一次性投入配对。50/50行是同一规则的配置检验，不新增候选计数。', 'note')
second=[r for r in D['secondGrid'] if r['originalWeights']==[.3,.3]]
full={r['id']:r for r in D['secondGrid'] if r['originalWeights']==[.5,.5]}
table(['分数','预留/门槛','30/30十年','30/30十五年','50/50十年','50/50十五年'],[[family_names[r['family']],f"{r['reserve']*100:.0f}% / {r['threshold']}",pp(r['periods']['10']['cagrDifferencePP']),pp(r['periods']['15']['cagrDifferencePP']),pp(full[r['id']]['periods']['10']['cagrDifferencePP']),pp(full[r['id']]['periods']['15']['cagrDifferencePP'])]for r in second],[75,80,86,86,86,86])

def footer(canvas, doc):
    canvas.setFont('Chinese',8); canvas.setFillColor(colors.HexColor(GRAY))
    canvas.drawString(48,26,'长衡  |  加仓评分研究  |  2026-11-06')
    canvas.drawRightString(547,26,str(doc.page))
SimpleDocTemplate(str(HERE/'report.pdf'), pagesize=(595,842), leftMargin=48,rightMargin=48,
                  topMargin=42,bottomMargin=48,title='每日加仓评分：公式、执行规则与长期对照',author='长衡研究').build(story,onFirstPage=footer,onLaterPages=footer)
print(HERE/'report.pdf')
