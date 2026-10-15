(function () {
  'use strict';
  const D=window.GLOBAL_FINANCE_DATA,M=window.ChanghengGlobalFinanceModel,S=window.GLOBAL_FINANCE_SCENARIOS;
  const state={panel:'map',scenario:'hike',category:'all',query:'',topic:'dollar',lab:'bond',yield:5,inflation:3,years:10,asset:10,fx:-8,mortgageRate:5,mortgageYears:30};
  const panels=[['map','传导地图'],['policy','政策现场'],['library','知识库'],['lab','计算实验']];
  const labs=[['bond','利率与债券'],['inflation','通胀与购买力'],['fx','海外投资与汇率'],['mortgage','利率与房贷']];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(v,n=2)=>Number(v).toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n});
  const signed=(v,n=2)=>(v>0?'+':'')+fmt(v,n);
  const btn=(label,action,value,cls='',attrs='')=>`<button type="button" class="${cls}" data-gf="${action}" data-value="${esc(value)}" ${attrs}>${esc(label)}</button>`;
  let ctx;
  function refs(ids) {
    return `<div class="gf-refs">${[...new Set(ids)].map(id=>{const s=D.sources[id];return `<a href="${esc(s[1])}" target="_blank" rel="noopener noreferrer">${esc(s[0])} ↗</a>`;}).join('')}</div>`;
  }
  function topicLink(id,label) {const topic=D.topics.find(t=>t.id===id);return btn(label||topic.name,'topic',id,'gf-text-button');}
  function nav(items,current,action,label) {
    return `<div class="gf-tabs" role="group" aria-label="${label}">${items.map(([id,name])=>btn(name,action,id,current===id?'is-active':'',`aria-pressed="${current===id}"`)).join('')}</div>`;
  }
  function node(s,small=false) {
    return `<button type="button" class="gf-node ${small?'gf-node-small':''}" data-gf="topic" data-value="${s.topic}" aria-label="了解${esc(s.title)}"><strong>${esc(s.title)}</strong><span>${esc(s.text)}</span><span class="gf-node-more" aria-hidden="true">了解机制 ↗</span></button>`;
  }
  const arrow='<span class="gf-arrow" aria-hidden="true"></span>';
  function mapView() {
    const s=S.find(x=>x.id===state.scenario);
    const directions={up:['↑','偏支持'],down:['↓','偏承压'],mixed:['⇄','取决于条件']};
    return `<div class="gf-map-layout"><aside class="gf-scenario-menu" aria-label="选择传导情景"><h2>从一件事开始</h2>${S.map(x=>btn(x.name,'scenario',x.id,state.scenario===x.id?'is-active':'',`aria-pressed="${state.scenario===x.id}"`)).join('')}<p>换一个起点，观察整条链如何改变。</p></aside><div class="gf-map-body"><section class="gf-transmission" aria-labelledby="gf-map-title"><div class="gf-section-heading"><span class="gf-caption">机制示意 · 方向有条件</span><h2 id="gf-map-title">${esc(s.title)}</h2><p>${esc(s.premise)}</p></div><div class="gf-main-chain">${s.steps.map(n=>node(n)).join(arrow)}</div><div class="gf-branches">${s.branches.map((b,i)=>`<section><h3><span>${i+1}</span>${esc(b.title)}</h3><div class="gf-branch-chain">${b.nodes.map(n=>node(n,true)).join(arrow)}</div></section>`).join('')}</div><p class="gf-timing">传导节奏：${esc(s.timing)}</p></section><section class="gf-impact-section"><h2>落到资产，会发生什么？</h2><p class="gf-section-note">以下是上述假设下的机制判断，不是统计胜率，也不是买卖信号。</p><div class="gf-table-scroll"><table class="gf-impact-table"><thead><tr><th scope="col">资产或变量</th><th scope="col">方向倾向</th><th scope="col">传导原因</th><th scope="col">什么会改变结果</th></tr></thead><tbody>${s.impacts.map(i=>`<tr><th scope="row">${esc(i.asset)}</th><td><span class="gf-direction gf-${i.direction}"><b>${directions[i.direction][0]}</b>${directions[i.direction][1]}</span></td><td>${esc(i.reason)}</td><td>${esc(i.condition)}</td></tr>`).join('')}</tbody></table></div>${refs(s.refs)}</section></div></div>`;
  }
  function policyView() {
    const fresh=M.freshness(D.checkedAt,undefined,D.reviewAfterDays);
    return `<section class="gf-policy"><header class="gf-section-heading"><h2>同一个世界，不同的政策约束</h2><p>已核对至 ${D.checkedAt}。下表是有日期的政策快照，各地利率工具口径不同。</p></header>${fresh.stale||fresh.future?`<p class="gf-review-alert" role="status">${fresh.future?'核对日期晚于当前设备日期，请检查设备时间。':`距核对日已${fresh.days}天，新的央行决议尚未复核。请通过下方原文查看最新决定。`}</p>`:''}<div class="gf-table-scroll"><table class="gf-policy-table"><thead><tr><th scope="col">经济体 / 央行</th><th scope="col">政策口径与已核对值</th><th scope="col">本次决定</th><th scope="col">发布日期 / 来源</th></tr></thead><tbody>${D.policies.map(p=>`<tr><th scope="row"><strong>${p.name}</strong><small>${p.bank}</small></th><td><strong class="gf-policy-value">${p.value}</strong><small>${p.label}</small></td><td><b>${p.direction}</b><p>${p.note}</p></td><td><time datetime="${p.date}">${p.date}</time>${refs(p.refs)}</td></tr>`).join('')}</tbody></table></div><div class="gf-policy-read"><h3>为什么这一轮看起来在“全球联动”？</h3><p>共同的能源与通胀冲击，可以让多家央行都选择收紧；美元融资和跨境资金还会把影响传到其他国家。欧洲央行9月10日的决定早于美联储9月16日的决定，不能把每次加息都理解为跟随美联储。</p><p>香港的联系汇率带来明确的制度传导；中国则根据国内需求、物价与金融条件选择政策，同时承担利差、汇率和资本流动的外部约束。</p>${refs(['ecb2026','fed2026','cn2026'])}</div><section class="gf-currency-links"><h2>美元、港币、人民币：三个关键连接</h2><div class="gf-currency-row"><div class="gf-currency-name">美元 <small>美国政策与全球融资</small></div><p>美联储改变短端美元利率，市场再定价未来利率、美元融资与风险资产。</p>${topicLink('dollar','美元为什么影响全球 ↗')}</div><div class="gf-currency-row"><div class="gf-currency-name">港币 <small>联系汇率与本地流动性</small></div><div><p>基本利率取“美联储目标区间下限＋50基点”与规定的HIBOR移动平均值中的较高者。资金流动和银行资金供求决定市场利率的实际表现。</p><div class="gf-rate-comparison"><span>2026-10-14 基本利率 <b>4.25%</b></span><span>同日 1个月HIBOR <b>2.75%</b></span></div><p class="gf-section-note">基本利率、拆息、P息和个人房贷报价是不同层次。</p></div>${topicLink('hkd','查看港币传导 ↗')}</div><div class="gf-currency-row"><div class="gf-currency-name">人民币 <small>国内目标与外部平衡</small></div><p>有管理浮动汇率和资本项目管理提供一定自主空间；宽松能否带来增长，要看实际贷款、居民消费、财政支出与企业订单。利差不单独决定汇率。</p>${topicLink('cny','理解人民币政策空间 ↗')}</div>${refs(['hk2026','hkDaily','lers','china','trilemma'])}</section><section class="gf-policy-questions"><h2>读政策新闻，接着看这三件事</h2><div><article><h3>市场原来预期什么？</h3><p>公布加息不一定让利率继续涨。实际决定比市场预期更松，价格也可能向反方向走。</p></article><article><h3>改变的是哪一个利率？</h3><p>政策利率、10年国债收益率、银行贷款利率不可互换。不同期限、信用与合同决定不同传导。</p></article><article><h3>现金流有没有跟上？</h3><p>先看融资条件，再看贷款需求、订单和盈利。只有价格变化，不能证明实体经济已经改善。</p></article></div></section></section>`;
  }
  function topicDetail(t) {
    if(!t)return `<div class="gf-empty"><h2>没有匹配的知识条目</h2><p>试试“美元”“房贷”“PE”“通胀”或英文缩写，也可以清除筛选。</p>${btn('清除筛选','clear','','gf-primary')}</div>`;
    return `<article class="gf-topic-detail" aria-labelledby="gf-topic-title"><header><span class="gf-caption">${esc(D.categories.find(c=>c.id===t.category).name)} · ${esc(t.en)}</span><h2 id="gf-topic-title">${esc(t.name)}</h2><p class="gf-definition">${esc(t.definition)}</p></header><section><h3>看懂这条关系</h3><ol class="gf-topic-chain">${t.chain.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></section><section class="gf-example"><h3>放进一个例子里</h3><p>${esc(t.example)}</p></section><section class="gf-pitfall"><h3>容易误解的地方</h3><p>${esc(t.pitfall)}</p></section><section><h3>观察什么来验证</h3><ul class="gf-watch">${t.watch.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section><section class="gf-related"><h3>连接到其他知识</h3>${t.related.map(id=>topicLink(id)).join('')}</section><details class="gf-topic-sources"><summary>来源与延伸阅读</summary>${refs(t.refs)}<p>定义依据来源整理；传导判断为条件分析，数字例子除标注日期者外均为教学假设。</p></details></article>`;
  }
  function libraryView() {
    const found=M.searchTopics(D.topics,state.query,state.category);
    let t=found.find(x=>x.id===state.topic)||found[0];
    if(t)state.topic=t.id;
    return `<section class="gf-library"><div class="gf-library-tools"><label class="gf-search-label">搜索知识<input type="search" id="gf-search" data-gf-input="search" placeholder="试试：美元、黄金、房贷、PE、CNY…" value="${esc(state.query)}" autocomplete="off"></label><label>知识领域<select id="gf-category" data-gf-input="category"><option value="all">全部领域 · ${D.topics.length}个主题</option>${D.categories.map(c=>`<option value="${c.id}" ${state.category===c.id?'selected':''}>${c.name}</option>`).join('')}</select></label></div><div class="gf-library-layout"><aside class="gf-topic-index" aria-label="知识目录"><p class="gf-result-count" role="status">${found.length} 个主题</p>${D.categories.map(c=>{const group=found.filter(t=>t.category===c.id);return group.length?`<section><h3>${c.name}</h3>${group.map(x=>btn(x.name,'select-topic',x.id,t?.id===x.id?'is-active':'',`aria-pressed="${t?.id===x.id}"`)).join('')}</section>`:'';}).join('')}</aside><div id="gf-topic-content">${topicDetail(t)}</div></div></section>`;
  }
  function slider(key,label,value,min,max,step,unit) {
    return `<label class="gf-slider" for="gf-${key}"><span>${label}<output id="gf-output-${key}" for="gf-${key}">${fmt(value,Number.isInteger(step)?0:2)}${unit}</output></span><input id="gf-${key}" data-gf-range="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><span class="gf-slider-limits"><small>${min}${unit}</small><small>${max}${unit}</small></span></label>`;
  }
  function lineChart(series,{xMin,xMax,yMin,yMax,xLabel,yLabel,title,marker=null,yTicks=4}) {
    const w=820,h=350,l=64,r=24,top=25,b=288;
    const x=v=>l+(v-xMin)/(xMax-xMin)*(w-l-r),y=v=>b-(v-yMin)/(yMax-yMin)*(b-top);
    const rows=Array.from({length:yTicks+1},(_,i)=>{const v=yMin+(yMax-yMin)*i/yTicks;return `<line x1="${l}" x2="${w-r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l-12}" y="${y(v)+4}" text-anchor="end">${fmt(v,0)}</text>`;}).join('');
    const ticks=Array.from({length:5},(_,i)=>{const v=xMin+(xMax-xMin)*i/4;return `<text x="${x(v)}" y="${b+24}" text-anchor="middle">${fmt(v,Number.isInteger(v)?0:1)}</text>`;}).join('');
    return `<div class="gf-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><g class="gf-grid">${rows}${ticks}<text x="${l}" y="14">${esc(yLabel)}</text><text x="${w/2}" y="${h-8}" text-anchor="middle">${esc(xLabel)}</text></g>${series.map(s=>`<path fill="none" stroke="${s.color}" stroke-width="3" ${s.dash?'stroke-dasharray="6 5"':''} d="${s.points.map(([a,b],i)=>(i?'L':'M')+x(a).toFixed(2)+' '+y(b).toFixed(2)).join(' ')}"/>`).join('')}${marker===null?'':`<line class="gf-marker" x1="${x(marker)}" x2="${x(marker)}" y1="${top}" y2="${b}"/>${series.map(s=>{const p=s.points.find(p=>Math.abs(p[0]-marker)<.001);return p?`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="5" fill="${s.color}" stroke="white" stroke-width="2"/>`:'';}).join('')}`}</svg><div class="gf-chart-legend">${series.map(s=>`<span><i style="--series:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div></div>`;
  }
  function bondResult() {
    const series=[{years:2,color:'#35654a'},{years:10,color:'#456d93'},{years:30,color:'#a27735'}].map(s=>({...s,name:`剩余${s.years}年`,points:Array.from({length:41},(_,i)=>[i/4,M.bondPrice({yieldRate:i/4,years:s.years})])}));
    const price=M.bondPrice({yieldRate:state.yield});
    return `<div class="gf-lab-reading" aria-live="polite"><span>10年债券 · 每100面值的价格</span><strong>${fmt(price)}</strong><p>收益率从4%变为${fmt(state.yield)}%，价格变化 <b>${signed(price-100)}%</b></p></div>${lineChart(series,{xMin:0,xMax:10,yMin:0,yMax:250,yTicks:5,xLabel:'市场到期收益率（%）',yLabel:'债券价格 / 面值100',title:'同样的收益率变化，30年债券比2年债券的价格更敏感。三条曲线为相同4%票息的理论重估价格。',marker:state.yield})}<div class="gf-numeric-strip">${series.map(s=>`<div><span>${s.years}年债券</span><strong>${fmt(M.bondPrice({yieldRate:state.yield,years:s.years}))}</strong><small>相对面值 ${signed(M.bondPrice({yieldRate:state.yield,years:s.years})-100)}%</small></div>`).join('')}</div><p class="gf-lab-takeaway">期限越长，现金流越靠后，同一次收益率变化通常带来更大的价格波动。这里计算的是瞬时重估，不含之后收到的票息。</p>`;
  }
  function inflationResult() {
    const real=M.purchasingPower({inflation:state.inflation,years:state.years}),basket=100*(1+state.inflation/100)**state.years;
    const series=[{name:'不计利息的名义现金',color:'#a4ac9e',dash:true,points:Array.from({length:state.years+1},(_,i)=>[i,100000])},{name:'按今天物价衡量的购买力',color:'#35654a',points:Array.from({length:state.years+1},(_,i)=>[i,M.purchasingPower({inflation:state.inflation,years:i})])}];
    return `<div class="gf-lab-reading" aria-live="polite"><span>${state.years}年后，10万元现金相当于今天</span><strong>${fmt(real,0)} <small>元</small></strong><p>购买力变化 <b>${signed((real/100000-1)*100)}%</b>；原来100元的篮子届时约需${fmt(basket)}元。</p></div>${lineChart(series,{xMin:0,xMax:state.years,yMin:0,yMax:100000,xLabel:'经过年数',yLabel:'按今天物价衡量 / 元',title:'不计利息的10万元现金，在固定通胀假设下的购买力变化'})}<p class="gf-lab-takeaway">名义金额不变，不代表购买力不变。若资产产生收益，应先计入收益，再按同一期间的物价变化折算。</p>`;
  }
  function fxResult() {
    const initial=100000,assetGain=initial*state.asset/100,afterAsset=initial+assetGain,fxGain=afterAsset*state.fx/100,final=afterAsset+fxGain;
    const items=[{name:'初始本金',start:0,end:initial,label:fmt(initial,0),type:'total'},{name:'美元资产收益',start:initial,end:afterAsset,label:signed(assetGain,0),type:assetGain>=0?'up':'down'},{name:'汇率折算影响',start:afterAsset,end:final,label:signed(fxGain,0),type:fxGain>=0?'up':'down'},{name:'最终人民币价值',start:0,end:final,label:fmt(final,0),type:'total'}];
    const high=Math.ceil(Math.max(initial,afterAsset,final)*1.2/20000)*20000,x=i=>90+i*180,y=v=>285-v/high*250;
    const chart=`<svg viewBox="0 0 820 350" role="img" aria-label="人民币价值分解：本金${initial}元，资产收益${fmt(assetGain)}元，汇率影响${fmt(fxGain)}元，最终${fmt(final)}元。"><g class="gf-grid">${Array.from({length:5},(_,i)=>{const v=high*i/4;return `<line x1="60" x2="790" y1="${y(v)}" y2="${y(v)}"/><text x="48" y="${y(v)+4}" text-anchor="end">${fmt(v/10000,1)}</text>`;}).join('')}<text x="60" y="16">人民币价值 / 万元</text></g>${items.map((v,i)=>`<rect class="gf-waterfall-${v.type}" x="${x(i)}" y="${y(Math.max(v.start,v.end))}" width="100" height="${Math.max(2,Math.abs(y(v.start)-y(v.end)))}" rx="3"/><text class="gf-chart-value" x="${x(i)+50}" y="${y(Math.max(v.start,v.end))-10}" text-anchor="middle">${v.label}</text><text class="gf-chart-label" x="${x(i)+50}" y="315" text-anchor="middle">${v.name}</text>${i<3?`<line class="gf-marker" x1="${x(i)+100}" x2="${x(i+1)}" y1="${y(v.end)}" y2="${y(v.end)}"/>`:''}`).join('')}</svg>`;
    return `<div class="gf-lab-reading" aria-live="polite"><span>人民币口径累计回报</span><strong>${signed(M.fxReturn(state.asset,state.fx))}%</strong><p>美元资产回报 ${signed(state.asset)}%；USD/CNY变化 ${signed(state.fx)}%。</p></div><div class="gf-chart">${chart}</div><p class="gf-formula">(1 + ${fmt(state.asset/100)}) × (1 + ${fmt(state.fx/100)}) − 1 = ${signed(M.fxReturn(state.asset,state.fx))}%</p><p class="gf-lab-takeaway">这里的汇率变化指USD/CNY：负值表示美元相对人民币贬值。汇率作用于资产涨跌后的全部价值，所以不能简单相加。</p>`;
  }
  function mortgageResult() {
    const before=M.mortgage({rate:3,years:state.mortgageYears}),after=M.mortgage({rate:state.mortgageRate,years:state.mortgageYears});
    const cap=Math.ceil(Math.max(before.monthly,after.monthly)/1000)*1000;
    return `<div class="gf-lab-reading" aria-live="polite"><span>100万元本金 · ${state.mortgageYears}年等额本息月供</span><strong>${fmt(after.monthly)} <small>元</small></strong><p>相对年利率3%的月供，每月 ${signed(after.monthly-before.monthly)} 元。</p></div><div class="gf-mortgage-bars">${[[3,before],[state.mortgageRate,after]].map(([rate,v],i)=>`<div><span>${i?'调整后':'比较基准'} · 年利率${fmt(rate)}%</span><div><i style="width:${v.monthly/cap*100}%"></i></div><strong>${fmt(v.monthly)}元/月</strong></div>`).join('')}</div><div class="gf-numeric-strip"><div><span>利息合计</span><strong>${fmt(after.interest,0)}元</strong></div><div><span>本息合计</span><strong>${fmt(after.total,0)}元</strong></div><div><span>相比基准多付利息</span><strong>${signed(after.interest-before.interest,0)}元</strong></div></div><p class="gf-lab-takeaway">这是两笔本金、期限相同的新贷款比较。存量房贷要按剩余本金、剩余期限、重定价日和合同重新计算，不能直接套用差额。</p>`;
  }
  function labOutput() {return ({bond:bondResult,inflation:inflationResult,fx:fxResult,mortgage:mortgageResult})[state.lab]();}
  function labView() {
    const config={
      bond:{title:'收益率上升1个百分点，债券会跌多少？',note:'固定票息4%，面值100，每半年付息，在付息日重估；不含违约、赎回、税费。收益率是名义年化、半年复利。',controls:slider('yield','市场到期收益率',state.yield,0,10,.25,'%'),formula:'P = Σ[每期票息 ÷ (1 + y/2)^期数] + 面值 ÷ (1 + y/2)^总期数',refs:['bonds','duration']},
      inflation:{title:'同样10万元，未来还能买到多少？',note:'假设通胀率每年保持不变，现金不产生利息。演示购买力变化，非未来通胀预测。',controls:slider('inflation','每年通胀率',state.inflation,0,10,.5,'%')+slider('years','持有年数',state.years,1,30,1,'年'),formula:'今日购买力 = 名义金额 ÷ (1 + 年通胀率)^年数',refs:['inflation']},
      fx:{title:'美股赚了10%，人民币回报也有10%吗？',note:'以10万元人民币等值本金为例，未做汇率对冲，忽略交易、换汇及税费。资产收益假设包含分配再投资。',controls:slider('asset','美元资产累计回报',state.asset,-40,40,1,'%')+slider('fx','美元兑人民币变化（USD/CNY）',state.fx,-20,20,1,'%'),formula:'人民币回报 = (1 + 美元资产回报) × (1 + USD/CNY变化) − 1',refs:['dollar','allocation']},
      mortgage:{title:'利率改变，月供和总利息怎样变？',note:'100万元本金、等额本息、按月还款，全期利率不变；年利率按12个月折算，不含费用、税收或提前还款。',controls:slider('mortgageRate','贷款年利率',state.mortgageRate,0,8,.25,'%')+slider('mortgageYears','贷款年限',state.mortgageYears,5,40,5,'年'),formula:'月供 = 本金 × 月利率 ÷ [1 − (1 + 月利率)^(−月数)]；零利率时为本金 ÷ 月数',refs:['housing']}
    }[state.lab];
    return `<section class="gf-lab"><div class="gf-section-heading"><h2>动手改变一个条件，看结果如何变化</h2><p>所有数值都是可复算的教学示例，不是行情或收益预测。</p></div>${nav(labs,state.lab,'lab','选择计算实验')}<div class="gf-lab-layout"><aside><h3>${config.title}</h3><div class="gf-lab-controls">${config.controls}</div><p>${config.note}</p><details class="gf-calculation"><summary>计算方法</summary><p>${config.formula}</p>${refs(config.refs)}</details></aside><div class="gf-lab-result" id="gf-lab-result">${labOutput()}</div></div></section>`;
  }
  function view(context) {
    ctx=context;
    if(!D||!M||!S)return '<section class="gf-empty"><h1>全球金融</h1><p>知识内容加载失败，请刷新重试。</p></section>';
    return `<div id="global-finance-root"><header class="gf-page-head"><div><h1>全球金融</h1><p>从美元利率到黄金、房贷与企业利润，看懂金融世界的连接。</p></div><span>${D.categories.length}个领域 · ${D.topics.length}个主题</span></header>${nav(panels,state.panel,'panel','全球金融内容')}<div class="gf-panel" id="gf-panel">${({map:mapView,policy:policyView,library:libraryView,lab:labView})[state.panel]()}</div><footer class="gf-page-footer"><span>机制图解释条件与方向；计算实验采用明确假设。</span><details><summary>资料与更新说明</summary><p>政策快照核对日：${D.checkedAt}。超过${D.reviewAfterDays}天会提示重新核对，不会把旧决定自动当成实时政策。知识条目及情景附有原始来源；机构研究代表作者分析，新华社条目为对人民银行例会的报道。</p><p>当前政策核对与长期知识分别维护，教学示例没有混用成历史数据。</p></details></footer></div>`;
  }
  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-gf]');
    if(!control||!control.closest('#global-finance-root')||!ctx)return;
    const action=control.dataset.gf,value=control.dataset.value;
    if(action==='panel'&&panels.some(p=>p[0]===value))state.panel=value;
    else if(action==='scenario'&&S.some(s=>s.id===value))state.scenario=value;
    else if(action==='topic'&&D.topics.some(t=>t.id===value)){state.panel='library';state.topic=value;state.category='all';state.query='';}
    else if(action==='select-topic'&&D.topics.some(t=>t.id===value))state.topic=value;
    else if(action==='lab'&&labs.some(l=>l[0]===value))state.lab=value;
    else if(action==='clear'){state.query='';state.category='all';}
    else return;
    const scroll=document.querySelector('.gf-topic-index')?.scrollTop||0;
    ctx.render();
    if(action==='select-topic'){const index=document.querySelector('.gf-topic-index');if(index)index.scrollTop=scroll;}
    if(action==='topic'){const heading=document.querySelector('#gf-topic-title');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});heading?.closest('article')?.scrollIntoView({block:'nearest',behavior:'instant'});}
    if(action==='clear')document.querySelector('#gf-search')?.focus({preventScroll:true});
  });
  document.addEventListener('input',event=>{
    const el=event.target;if(!el.closest?.('#global-finance-root')||!ctx)return;
    if(el.dataset.gfInput==='search'){state.query=el.value;ctx.render();return;}
    const key=el.dataset.gfRange;
    if(!['yield','inflation','years','asset','fx','mortgageRate','mortgageYears'].includes(key))return;
    const value=Number(el.value);if(!Number.isFinite(value))return;
    state[key]=Math.max(Number(el.min),Math.min(Number(el.max),value));
    const unit=['years','mortgageYears'].includes(key)?'年':'%';
    document.querySelector('#gf-output-'+key).textContent=fmt(state[key],Number.isInteger(Number(el.step))?0:2)+unit;
    document.querySelector('#gf-lab-result').innerHTML=labOutput();
  });
  document.addEventListener('change',event=>{
    if(event.target.dataset.gfInput!=='category'||!ctx)return;
    const category=event.target.value;if(category!=='all'&&!D.categories.some(c=>c.id===category))return;
    state.category=category;ctx.render();
  });
  window.ChanghengGlobalFinance={view};
})();
