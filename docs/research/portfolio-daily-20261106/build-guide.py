from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json,hashlib,argparse,re
OUT=Path(__file__).parent
parser=argparse.ArgumentParser(description='Rebuild the daily allocation guide from the frozen research document style and verified examples.')
parser.add_argument('--reference',type=Path,default=OUT.parent/'portfolio-methods-20261106/report.docx')
REF=parser.parse_args().reference
assert hashlib.sha256(REF.read_bytes()).hexdigest()=='a14ca80040130edec172adac9c2c9329c16e3597dd6ef9a1538df6667f5a786a','Frozen style reference changed'
EX=json.loads((OUT/'examples.json').read_text())
NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ns={'w':NS};q=lambda t:'{'+NS+'}'+t
fields=[];table_records=[];plain=[]
def num(value,places=2,signed=False,unit='',source=''):
 text=(('+' if signed and value>0 else '')+f'{value:.{places}f}'+unit)
 fields.append(dict(value=value,rendered=text,source=source));return text
with ZipFile(REF) as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',ns);sect=deepcopy(body.find('w:sectPr',ns));body.clear()
def el(tag,attrs=None,parent=None):
 x=E.Element(q(tag))
 for k,v in (attrs or {}).items():x.set(q(k),str(v))
 if parent is not None:parent.append(x)
 return x
def para(text='',style=None,kind=None,parent=None):
 p=el('p',parent=parent if parent is not None else body);pr=el('pPr',parent=p)
 if style:el('pStyle',{'val':style},pr)
 if kind=='meta':el('spacing',{'after':120},pr)
 if kind=='note':el('spacing',{'after':140,'line':300,'lineRule':'exact'},pr)
 r=el('r',parent=p);rp=el('rPr',parent=r);el('rFonts',{'ascii':'Arial','hAnsi':'Arial','eastAsia':'Arial Unicode MS'},rp)
 if kind in ('meta','note'):
  el('sz',{'val':18 if kind=='meta' else 19},rp);el('color',{'val':'44505B'},rp)
  if kind=='meta':el('b',parent=rp)
 t=el('t',parent=r);t.text=text;t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');plain.append(text)
 return p
def h(text):para(text,'Heading2')
def p(text):para(text)
def note(text):para(text,kind='note')
def page(meta,title,first=False):
 if not first:
  x=el('p',parent=body);pr=el('pPr',parent=x);el('spacing',{'after':0,'before':0,'line':20,'lineRule':'exact'},pr);r=el('r',parent=x);el('br',{'type':'page'},r)
 para('长衡研究  /  2026.11.06  /  '+meta,kind='meta');para(title,'Title' if first else 'Heading1')
def table(headers,rows,widths=None):
 widths=widths or [9524//len(headers)]*len(headers);widths[-1]=9524-sum(widths[:-1])
 tbl=el('tbl',parent=body);tp=el('tblPr',parent=tbl);el('tblW',{'w':9524,'type':'dxa'},tp);el('tblLayout',{'type':'fixed'},tp)
 borders=el('tblBorders',parent=tp)
 for edge in ['top','left','bottom','right','insideH','insideV']:el(edge,{'val':'single','sz':5,'color':'D9D9D9'},borders)
 margin=el('tblCellMar',parent=tp)
 for edge,v in [('top',90),('bottom',90),('left',110),('right',110)]:el(edge,{'w':v,'type':'dxa'},margin)
 grid=el('tblGrid',parent=tbl)
 for width in widths:el('gridCol',{'w':width},grid)
 for rowid,row in enumerate([headers]+rows):
  tr=el('tr',parent=tbl);trpr=el('trPr',parent=tr);el('cantSplit',parent=trpr)
  if rowid==0:el('tblHeader',parent=trpr)
  for i,text in enumerate(row):
   tc=el('tc',parent=tr);tcp=el('tcPr',parent=tc);el('tcW',{'w':widths[i],'type':'dxa'},tcp);el('vAlign',{'val':'center'},tcp)
   el('shd',{'fill':'304F63' if rowid==0 else ('F4F6F7' if rowid%2==0 else 'FFFFFF')},tcp)
   pp=el('p',parent=tc);pr=el('pPr',parent=pp);el('spacing',{'before':0,'after':0,'line':280,'lineRule':'exact'},pr);el('jc',{'val':'right' if i>0 and rowid>0 and re.fullmatch(r'[+\-0-9.,/% ]+',str(text)) else 'left'},pr)
   rr=el('r',parent=pp);rp=el('rPr',parent=rr);el('rFonts',{'ascii':'Arial','hAnsi':'Arial','eastAsia':'Arial Unicode MS'},rp);el('sz',{'val':20},rp)
   if rowid==0:el('b',parent=rp);el('color',{'val':'FFFFFF'},rp)
   tt=el('t',parent=rr);tt.text=str(text);plain.append(str(text))
 table_records.append({'headers':headers,'rows':rows})
 para('',kind='note')
page('使用说明','每日加仓指标使用说明',True)
p('这份说明用于跟随已有组合的三种调仓规则：VIX恐慌恢复、三批相对强弱轮动、双重风险门。页面每天给出比例、判定依据、新增预算去向和旧仓待执行订单。它帮助你把同一条规则持续执行下去。')
h('先看百分比的分母')
table(['所选方法','百分比对应哪笔钱','怎样理解'],[
 ['VIX恐慌恢复调仓','原本分给TQQQ的预算','0%暂存；100%投入对应预算'],
 ['三批相对强弱轮动','USD与TQQQ合计股票预算','两资产比例合计100%；原现金另留'],
 ['双重风险门调仓','原本分给TQQQ的预算','两扇风险门都允许才为100%']], [2900,3200,3424])
p('100%不表示价格最便宜、盈利概率100%，也不表示把整个账户加满。0%只暂停对应的TQQQ预算，USD和其他资产仍按自己的配置处理。轮动比例的变化表示两只ETF之间的资金方向，不能理解为比例越高买点越好。')
h('页面上三件事分别看')
p('“每日加仓指标”显示规则比例和原因；“本次新增预算”只试算新一笔资金的去向，不修改回测本金；“下一共同交易日”显示模拟中已形成的待执行订单。新增预算试算与旧仓待单不可相加成一笔已经发生的买入。')
h('已有账户的每日跟随')
p('首次建仓仍按原配置一次性购买，之后按所选规则管理。用某天0%跳过首次TQQQ购买，会改变历史研究中的策略，不能直接引用原研究收益。初始金额为0但之后有追加的配置也会保留规则状态，供后续资金使用。')
note('本说明不修改已冻结的历史研究报告和收益数据。新增预算输入不下单、不回写历史入金；实际买卖仍须由你按账户情况执行。')

page('方法一','VIX恐慌恢复调仓')
p('来源是Cboe的VIX和VIX3M每日收盘。两者来自标普500期权，分别对应约30天与3个月隐含波动。它们不是QQQ估值或TQQQ价格。计算比值 R=VIX/VIX3M，核对页面显示的源日期、比值和确认计数。')
table(['状态','精确条件','后续动作'],[
 ['允许持有','R>1.10连续10次，且退出计数已启用','转为退出，计划卖出TQQQ'],
 ['退出后','至少再等5次观测，且VIX较退出后峰值回落至少30%','转为允许，计划买回'],
 ['退出后另一恢复条件','R<1连续5次','转为允许，计划买回'],
 ['恢复之后','R<1再连续5次，才重新启用退出计数','防止同一段恐慌反复进出']], [1800,4700,3024])
p('连续条件中断就重新计数；等于1.10不算大于，等于1不算小于。缺失或过期数据不当作条件不满足，而是明确显示缺项。离场后的VIX峰值随新高更新，回落比例为 1−当前VIX/离场后峰值。')
h('从状态到金额')
p('允许持有时，TQQQ对应预算投入比例为100%；退出时为0%。100%且状态未变时，旧仓继续持有，不会每日自动追加一笔。退出卖款扣除交易费和已实现盈利税后，进入TQQQ专属现金；恢复时只用该笔已到账现金，以“现金÷(1+买入费率)”计算回买成交额。USD及原现金配置不参与。')
h('两个容易误读的例子')
p('退出计数已启用、恐慌计数为9/10时，仍为100%，不是90%投入。只有第10次满足条件才切换为0%。离场后峰值为40，已经等待至少5次观测，VIX降至28才达到30%回落条件；“30%回落”与“100%预算投入”是两个不同含义。')
note('VIX只使用严格早于共同收盘决策日的有效配对记录。2020年真实退出案例：3月6日来源形成退出，3月9日决定订单，3月10日才成交。')

page('方法二','三批相对强弱轮动')
p('用实际USD ETF和TQQQ的美元含分红价格，比较504个收益间隔，需要505个共同收盘。增长倍数比 G=(USD当前/504间隔前USD)÷(TQQQ当前/504间隔前TQQQ)。G>1.25时本批转向USD；G<0.80时转向TQQQ；中间区域和两个边界保留本批原方向。')
table(['批次','常规复核月份','占两只ETF股票预算'],[
 ['第一批','1、4、7、10月','1/3'],['第二批','2、5、8、11月','1/3'],['第三批','3、6、9、12月','1/3']], [2200,4000,3324])
p('三个批次只是信号记忆，实际共用一个持仓和税务账户。每批最初使用用户原USD/TQQQ相对比例；有方向后，本批全部偏向一只ETF。三个批次的比例取平均，得到页面两条百分比。没有目标变化时，不每天纠正价格涨跌后的实际仓位。')
h('例如原股票各半')
table(['三个批次记忆','USD股票预算比例','TQQQ股票预算比例'],[
 ['原比例 / 原比例 / 原比例','50%','50%'],
 ['USD / 原比例 / 原比例','66.67%','33.33%'],
 ['USD / TQQQ / 原比例','50%','50%'],
 ['USD / USD / USD','100%','0%']], [4700,2412,2412])
p('若两只ETF合计账户权重60%，上表第二行对应USD40%、TQQQ20%、原现金40%。比例必须使用精确分数计算，66.67%只是页面显示。目标变化时先计划卖出，净回款到账后才形成后续买单；不使用原配置现金预支换仓。')
h('跟踪起点不能每天重置')
p('首个模拟共同日已有505个收盘时，会复核当月所属批次，即使起点在月中；之后每月首个共同日更新一批。若在月中才结束预热，而该月已被检查，则等下月再复核。未形成方向的批次保留原比例；中性区间保留既有记忆。')
note('“延续到最新行情”保留同一个起点并重新回放批次变化。只用今天的G值、或每天重置三个批次，不能重建这条策略。')

page('方法三','双重风险门调仓')
p('这条方法把VIX规则和QQQ深熊规则一起使用。任一风险门要求退出，就暂停TQQQ；只有两扇都允许持有时才恢复。USD、其他资产和原现金继续保持各自预算。')
h('QQQ这扇门如何判断')
p('使用真实QQQ美元含分红收盘价P。MA200是最近200个QQQ收盘均值，H252是最近252个QQQ收盘最高值。持有时，P<MA200且P/H252≤0.80，两个条件同时连续20次才退出；退出后，P>MA200连续3次才恢复。等于均线不算高于或低于，连续条件中断就重新计数。')
table(['VIX允许持有','QQQ允许持有','TQQQ对应预算比例'],[
 ['是','是','100%'],['是','否','0%'],['否','是','0%'],['否','否','0%']], [3000,3000,3524])
h('一扇门恢复还不够')
p('例如VIX已经恢复，但QQQ只连续2次站上200日均线，继续等待。第3次满足时，两个条件同时允许，才形成下一共同收盘的回买计划。若QQQ已恢复而VIX仍退出，也继续持有TQQQ对应现金。')
h('新预算与回买不是同一笔钱')
p('0%时，新预算中原TQQQ份额及其预留买入费暂存；100%时按原TQQQ权重分配新预算。若刚由0%恢复到100%，旧账户另有一笔使用专属现金的回买待单。不能重复把这笔旧现金算作新增本金。')
e=EX['reentry'];p('例：已有专属现金为'+num(e['cash'],2,source='examples.json reentry.cash')+'，买入费率0.10%，回买成交额为'+num(e['amount'],2,source='examples.json reentry.amount')+'，费用'+num(e['fee'],2,source='examples.json reentry.fee')+'。预算和费用合计仍为3,000，成交价只影响买到的份额。')
note('QQQ至少需要252个实际收盘预热。QQQ可使用决策日已经完成的收盘，VIX仍严格早于决策日；页面分别列出两种源日期。')

page('金额计算','新增预算包含手续费')
p('“本次新增预算”输入这一笔资金总额，包含买入费。它不改变历史回测或已形成待单。存在待执行目标时，按该目标试算下一笔新增资金；没有待单时，按最近已经执行的目标分配。')
table(['符号','含义'],[['B','含买入费的新预算'],['W','全部原配置风险资产权重之和，含其他股票 ETF 基金'],['f','单侧交易费率，0.10%写作0.001'],['a_i','该资产有效目标权重，30%写作0.30']], [1700,7824])
p('先算 U=B/(1+f×W)。每资产买入额为U×a_i，买入费为该金额乘f；普通现金为U×(1−W)。TQQQ退出时，它对应的待投资金为U×原TQQQ权重×(1+f)，保留以后买入需要的费用。')
h('10,000预算的三种去向')
p('原配置USD30%、TQQQ30%、现金40%，f=0.10%，U='+num(EX['usable'],8,source='examples.json usable')+'。下表按分显示；内部不使用四舍五入后的比例或金额。')
rows=[]
for case,title in zip(EX['cases'],['风险门允许','风险门退出','轮动2/3与1/3']):
 r=case['result'];rows.append([title]+[num(x,2,source='examples.json '+case['id']) for x in [r['orders'][0]['amount'],r['orders'][1]['amount'],r['fee'],r['parkedCash'],r['originalCash']]])
table(['状态','买USD','买TQQQ','买入费','策略暂存','原配置现金'],rows,[2200,1460,1460,1300,1500,1604])
p('每行精确金额合计为10,000。轮动行使用精确的2/3与1/3；有效账户权重为40%与20%。有其他资产时，其买入预算和费用另计入总额，但不借给这两只ETF。')
note('新增买入预算不预估旧持仓的卖出税。卖出费、已实现盈利税和净回款依赖实际成本与成交，由原持仓订单账本计算。浮盈预留税是估值负债，不是今天可以重复扣除的买入费用。')

page('交易时序','来源收盘到实际成交')
p('同一个日期可能有新行情，但尚未形成这个组合的共同收盘决策。共同日要求所选持仓都有有效真实报价；周末、休市和不同市场日历会延后下一步。页面显示决策日和来源日期，不把当天日期当作已完成成交。')
table(['阶段','已知内容','允许的动作'],[
 ['共同收盘t','价格 持仓 已到账策略现金','锁定卖出份额和买入金额'],
 ['下一共同收盘t+1','待单按实际价格成交','扣卖出税费 净款进入策略现金'],
 ['t+1收盘以后','出售净回款现已到账','形成使用该回款的后续买单'],
 ['再下一共同收盘t+2','执行已固定金额的后续买单','不依据成交日价格重算金额']], [2000,3500,4024])
p('买单只使用计划时已经存在的现金。轮动换仓可能需要上表的两段交易；风险恢复则可直接使用此前已经到账的专属现金。价格变化会改变成交份额和买后比例，计划目标不是成交后的硬上限。')
h('VIX真实历史示例')
table(['动作','来源收盘','决策收盘','成交收盘'],[
 ['退出TQQQ','2020-03-06','2020-03-09','2020-03-10'],
 ['恢复TQQQ','2020-03-30','2020-03-31','2020-04-01']], [2200,2440,2440,2444])
p('VIX只读取严格早于决策日的配对观测，QQQ和ETF相对强弱可以使用决策日已完成的收盘。两种源的日期不必相同。较晚的单一市场观察不自动变成本组合即将执行的订单。')
h('同日还有入金或再平衡时')
p('先处理分红税并执行既有待单，再处理当天实际入金和用户选择的周期再平衡，最后形成下一笔计划。当天新资金不能扩大昨日已锁定订单，再平衡也不能先用掉承诺给待单的现金。')

page('每日使用','延续同一条跟踪')
table(['页面操作','具体作用'],[
 ['选择所用方法并模拟','按这份配置建立账户和逐日状态'],
 ['指标日期或日期滑块','回看已完成共同收盘的比例及原因'],
 ['本次新增预算','只换算选定日期的新一笔资金去向'],
 ['延续到最新行情','保持原起点和配置 只延长结束日期'],
 ['导出每日指标 CSV','保存逐日比例 来源 计数和当前预算试算']], [3000,6524])
p('上一交易日、下一交易日和滑块沿已有共同收盘移动。选择休市日期时，使用此前可用共同日，并以页面实际显示日期为准。历史回看也只读取当时已知信息，不把未来行情补进旧信号。')
h('何时不能延续或给出金额')
table(['情况','页面处理'],[
 ['参数已改动','先重新模拟 不把新草稿接到旧结果'],
 ['原账户期末已清仓','不再延续账户或产生下一笔预算'],
 ['轮动尚不足505收盘','指标未形成 预算明确按原比例试算'],
 ['缺来源 过期 或历史中断','指标留空 停止预算换算 列明具体缺项'],
 ['刷新请求失败','保留上一份有效结果和原日期']], [3000,6524])
p('每日行情任务更新日线，不是盘中行情；是否更新成功以来源日期和页面提示为准。休市未形成新共同收盘时，指标可以连续多天不变。修改权重、起点或规则会产生新路径；把滚动十年的起点每天往前移，不等于延续同一账户。')
h('保存依据  不扩张结论')
p('比例100%只表示规则允许，不能保证未来盈利；轮动可能集中到单只杠杆ETF。新增预算、其他资产和用户再平衡可以运行，但不自动继承原研究主配置的收益优势。旧研究报告、全部失败结果和复算证据仍从“指标说明与历史检验”进入。')
note('本说明对应每日显示和预算功能，不修改研究规则。网页方法详情：docs/portfolio-entry-research.html；公式与执行边界：docs/portfolio-method.md；新功能核验：docs/research/portfolio-daily-20261106/verification.json。')

body.append(sect)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
core=E.fromstring(parts['docProps/core.xml']);dc={'dc':'http://purl.org/dc/elements/1.1/','dcterms':'http://purl.org/dc/terms/'}
for tag in ['title','subject']:
 x=core.find('dc:'+tag,dc)
 if x is not None:x.text='每日加仓指标使用说明'
parts['docProps/core.xml']=E.tostring(core,xml_declaration=True,encoding='UTF-8',standalone=True)
app=E.fromstring(parts['docProps/app.xml']);apns={'a':'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'}
x=app.find('a:Pages',apns)
if x is not None:x.text='7'
parts['docProps/app.xml']=E.tostring(app,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'每日加仓指标使用说明.docx','w',ZIP_DEFLATED)as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'guide-fields.json').write_text(json.dumps(fields,ensure_ascii=False,indent=2)+'\n')
(OUT/'guide-tables.json').write_text(json.dumps(table_records,ensure_ascii=False,indent=2)+'\n')
(OUT/'guide-content.txt').write_text('\n'.join(plain)+'\n')
with ZipFile(REF)as z:changed=[n for n in z.namelist()if z.read(n)!=parts[n]]
assert set(changed)=={'word/document.xml','docProps/core.xml','docProps/app.xml'},changed
print(json.dumps({'pagesPlanned':7,'tables':len(table_records),'numericFields':len(fields),'changedParts':changed}))
