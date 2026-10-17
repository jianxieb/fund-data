(function () {
  'use strict';
  const M = window.Changheng, C = window.ChanghengReturnComparisonModel, R = window.ChanghengResearchHistory, G = window.ChanghengResearchCharts;
  const key = 'changheng.return-comparison.v1', names = { index:'指数', etf:'ETF', fund:'场外基金', stock:'个股' };
  let H, catalog, result, error = '', pending = false, token = 0, computed = '', picker = true, page = 1, cursor = -1;
  let state = { ids:['us:SPY','us:QQQ','us:TLT'], years:5, start:'', end:'', currency:'native', chart:'line', query:'', kind:'all', market:'all', category:'all', collection:'all', assetClass:'all', region:'all', strategy:'all', direction:'all', minHistory:'all', availability:'all', sort:'default' };
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved && Array.isArray(saved.ids)) state = { ...state, ...saved, ids:[...new Set(saved.ids.filter(id => typeof id === 'string'))].slice(0, 8) }; } catch (_) {}
  // Do not inherit invisible filters from the old picker.
  state.kind='all'; state.market='all'; state.category='all';
  const esc = M.escapeHtml, percent = v => M.finite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—';
  const button = (label, act, value = '', cls = '', extra = '') => `<button type="button" class="${cls}" data-rc="${act}" data-value="${esc(value)}" ${extra}>${label}</button>`;
  const asset = id => catalog?.assets.find(a => a.id === id);
  const basis = a => a.kind === 'index' ? '指数价格 · 不含分红' : a.market === 'cn' && ['fund','etf'].includes(a.kind) ? '净值 · 含分红再投' : '复权价格 · 含分红再投';
  const signature = () => JSON.stringify([state.ids, state.years, state.start, state.end, state.currency]);
  function save() { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {} }
  function redraw() { const position=document.querySelector('.rc-library-list')?.scrollTop||0; H?.render(); const list=document.querySelector('.rc-library-list'); if(list)list.scrollTop=position; }
  function refresh() { save(); redraw(); }
  async function calculate() {
    if (!catalog || computed === signature()) return;
    const id = ++token, sig = signature(); computed = sig; pending = true; error = ''; result = null;
    try {
      const assets = state.ids.map(asset);
      if (assets.some(a => !a)) throw new Error('有标的已移出当前数据目录，请重新选择');
      const histories = Object.fromEntries(await Promise.all(assets.map(async a => [a.id, await R.history(a)])));
      const fx = state.currency !== 'native' && assets.some(a => a.currency !== state.currency) ? await R.history(catalog.fx) : null;
      const r = C.compare({ assets, histories, fx, ...state });
      if (id === token) { result = r; cursor = r.dates.length - 1; }
    } catch (e) { if (id === token) error = e.message; }
    finally { if (id === token) { pending = false; redraw(); } }
  }
  function select(label, field, options, value) {
    return `<label class="rc-field"><span>${label}</span><select data-rc-field="${field}" aria-label="${label}">${options.map(([id, name]) => `<option value="${esc(id)}"${String(value) === String(id) ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  }
  function library() {
    const rows = C.filterAssets(catalog.assets, state), selected = new Set(state.ids), size = 12;
    page = Math.min(page, Math.max(1,Math.ceil(rows.length/size)));
    const options = (field,label) => {
      const available=C.filterAssets(catalog.assets,{...state,[field]:'all',query:''});
      const values=[...new Set(available.map(a=>a[field]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
      if(state[field]!=='all'&&!values.includes(state[field]))values.unshift(state[field]);
      return select(label,field,[['all','全部'],...values.map(v=>[v,v+' · '+available.filter(a=>a[field]===v).length])],state[field]);
    };
    const preview=a=>{const p=a.performance?.annual?.[1];return p?.value!=null?percent(p.value)+`<small>${p.start} → ${p.end}</small>`:'—';};
    return `<section class="rc-library card" aria-label="选择对比标的"><div class="rc-library-head"><div><h2>完整标的库</h2><span class="rc-library-count">全部已收录证券都可查找，包括未进入精选名单的公司。</span></div>${button('收起标的库','picker','','text-link')}</div>
      <div class="rc-collection-tabs" role="tablist" aria-label="标的类型">${C.collections.map(([id,name])=>button(`${name}<span>${id==='all'?catalog.assets.length:catalog.assets.filter(a=>a.product===id).length}</span>`,'collection',id,state.collection===id?'active':'',`role="tab" aria-selected="${state.collection===id}"`)).join('')}</div>
      <div class="rc-search-row"><input type="search" data-rc-field="query" id="rc-query" aria-label="搜索对比标的" placeholder="名称、代码、基金经理、行业，例如：黄金 / 中证500 增强 / MSFT" value="${esc(state.query)}">${button('重置筛选','reset-filters','','text-link')}</div>
      <div class="rc-library-filters">${options('assetClass','资产方向')}${options('region','上市 / 投资市场')}${options('strategy','投资策略')}${options('direction',state.collection.endsWith('stock')?'行业':'指数 / 基金类别')}${select('历史长度','minHistory',[['all','不限'],[1,'至少1年'],[3,'至少3年'],[5,'至少5年'],[10,'至少10年'],[20,'至少20年']],state.minHistory)}${select('数据状态','availability',[['all','全部'],['available','日线可用'],['missing','缺少日线']],state.availability)}</div>
      <div class="rc-library-result-head"><span class="rc-library-count">找到 <strong>${rows.length}</strong> 个 · 已选 <strong>${state.ids.length} / 8</strong></span>${select('排列','sort',[['default','目录顺序'],['name','名称'],['code','代码'],['history','历史从长到短'],['return1','近1年收益从高到低'],['return5','近5年年化从高到低']],state.sort)}</div>
      <div class="rc-library-list table-wrap"><table class="research-table rc-pick-table"><thead><tr><th>选择 / 标的</th><th>类别与方向</th><th>近1年收益</th><th>日线覆盖 / 收益口径</th></tr></thead><tbody>${rows.slice((page-1)*size,page*size).map(a=>`<tr class="${selected.has(a.id)?'is-selected':''}"><td><label class="rc-pick"><input type="checkbox" data-rc-asset="${esc(a.id)}" aria-label="选择${esc(a.name)}" ${selected.has(a.id)?'checked':''} ${a.status!=='available'||!selected.has(a.id)&&selected.size>=8?'disabled':''}><span><strong>${esc(a.name)}</strong><small>${esc(a.code)} · ${names[a.kind]}${a.manager?' · '+esc(a.manager):''}</small></span></label></td><td>${esc(a.direction)}<small>${esc(a.region)} · ${esc(a.strategy)}</small></td><td>${preview(a)}</td><td>${a.status==='available'?`${a.first} → ${a.asOf}<small>${esc(basis(a))} · ${a.currency}</small>`:esc(a.missing)}</td></tr>`).join('')}</tbody></table>${rows.length?'':'<p class="empty">没有匹配的标的。可重置筛选后按名称或代码查询。</p>'}</div>
      <div class="rc-pagination"><span>${rows.length?(page-1)*size+1:0}–${Math.min(page*size,rows.length)} / ${rows.length}</span>${button('上一页','page',String(page-1),'btn sm',page===1?'disabled':'')}<span>第 ${page} / ${Math.max(1,Math.ceil(rows.length/size))} 页</span>${button('下一页','page',String(page+1),'btn sm',page*size>=rows.length?'disabled':'')}</div></section>`;
  }
  function legend() {
    return `<div class="rc-legend">${result.rows.map((r,i)=>`<div class="rc-legend-item"><i style="background:${G.colors[i]}"></i><div><strong>${esc(r.code)}</strong><span>${esc(r.name)}</span><small>${esc(basis(r))} · ${state.currency==='native'?r.currency:state.currency}</small></div><div class="rc-legend-numbers"><b data-rc-value="${i}">${percent(r.total)}</b>${H.annual?`<small>区间年化 <strong>${r.annual===null?'不足1年':percent(r.annual)}</strong></small>`:''}</div></div>`).join('')}</div>`;
  }
  function calendar() {
    return `<div class="table-wrap"><table class="research-table rc-calendar"><thead><tr><th>年度 / 实际区间</th>${result.rows.map(r=>`<th>${esc(r.code)}</th>`).join('')}</tr></thead><tbody>${[...result.calendar].reverse().map(y=>`<tr><td>${y.year}${y.partial?' · 非完整年度':''}<span class="sub">${y.start} → ${y.end}</span></td>${y.returns.map(v=>`<td class="${v>=0?'rc-positive':'rc-negative'}">${percent(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function summary() {
    return `<section class="card rc-summary"><div class="table-caption"><h2>同区间表现</h2><span>${result.start} → ${result.end}</span>${button('导出每日收益','export','','text-link')}</div><div class="table-wrap"><table class="research-table"><thead><tr><th>标的</th><th>累计收益</th>${H.annual?'<th>年化收益</th>':''}<th>最大回撤</th><th>历史覆盖</th><th>收益口径 / 来源</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td><strong>${esc(r.code)}</strong><span class="sub">${esc(r.name)}</span></td><td>${percent(r.total)}</td>${H.annual?`<td>${r.annual===null?'不足1年':percent(r.annual)}</td>`:''}<td>${percent(r.mdd)}${r.riskMissing?`<span class="sub">${esc(r.riskMissing)}</span>`:''}</td><td>${r.first}<span class="sub">截至 ${r.asOf}</span></td><td>${esc(basis(r))}<span class="sub">${r.currency}资产 · <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始来源 ↗</a></span></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function output() {
    if (pending) return '<div class="card empty" role="status">正在读取所选标的的已发布日线…</div>';
    if (error) return `<div class="card empty" role="alert">${esc(error)} ${button('重新加载','retry','','text-link')}</div>`;
    if (!result) return '<div class="card empty">从标的库选择资产，即可叠加比较。</div>';
    const chartTabs = [['line','收益曲线'],['bars','回报柱状图'],['calendar','逐年收益表'],['drawdown','回撤曲线']];
    return `${result.shortened?`<p class="notice">共同历史从 ${result.start} 开始，未覆盖所选区间的全部历史。所有标的使用这个共同起点。</p>`:''}${result.endShortened?`<p class="notice">共同可用数据截至 ${result.end}，早于所选结束日期。</p>`:''}${result.gaps.length?`<p class="basis-note">${result.gaps.map(esc).join('；')}</p>`:''}<section class="card rc-result"><div class="rc-chart-head"><div><h2>${state.chart==='drawdown'?'从区间内高点回落多少':state.chart==='calendar'?'每一年，收益来自哪里':'把每笔投资放在同一起点'}</h2><p>${result.start} → ${result.end} · ${state.currency==='native'?'各自原币':state.currency==='CNY'?'统一人民币':'统一美元'} · 税前，未计个人交易费</p></div><div class="segmented" aria-label="对比图表">${chartTabs.map(([v,n])=>button(n,'chart',v,state.chart===v?'active':'',`aria-pressed="${state.chart===v}"`)).join('')}</div></div>${legend()}${state.chart==='calendar'?calendar():state.chart==='bars'?G.bars(result.rows,H.annual):G.line(result.rows,{key:state.chart==='drawdown'?'drawdowns':'points',title:state.chart==='drawdown'?'最大回撤路径':'同起点累计收益',cursor:result.dates[cursor]})}${['line','drawdown'].includes(state.chart)?`<div class="rc-date-scrubber"><span>查看日期</span><input type="range" min="0" max="${result.dates.length-1}" value="${cursor}" id="rc-cursor" aria-label="查看某日收益"><output id="rc-cursor-date">${result.dates[cursor]}</output></div><p class="rc-axis-note">纵轴：${state.chart==='drawdown'?'从区间内历史高点回撤':'累计收益率，起点为0%'}${H.annual?' · 图例另列整个区间的年化收益':''}</p>`:state.chart==='bars'?`<p class="rc-axis-note">横轴：${H.annual?'年化':'累计'}收益率；与上方日期区间一致。</p>`:'<p class="rc-axis-note">逐年表始终展示累计收益；首尾年度不足一整年时标出实际区间。</p>'}</section>${summary()}`;
  }
  function view(helpers) {
    H = helpers;
    if (!catalog) {
      if (!pending && !error) { pending = true; R.catalog().then(c => { catalog=c; pending=false; refresh(); }).catch(e=>{error=e.message;pending=false;H.render();}); }
      return H.head('RETURN EXPLORER','收益对比','指数、基金、个股，放在同一个时间区间。') + `<div id="return-comparison-root" class="card empty">${esc(error||'正在加载标的库…')}${error?button('重新加载','retry','','text-link'):''}</div>`;
    }
    if (computed !== signature()) calculate();
    const presets = [['equity','美股宽基',['us:SPY','us:QQQ']],['balanced','股票与美债',['us:SPY','us:QQQ','us:TLT','us:SGOV']],['index','中美价格指数',['index:^GSPC','index:^NDX','index:000300']],['companies','美股公司',['stock:BRK-B','stock:MSFT','stock:AAPL','us:SPY']]];
    return H.head('RETURN EXPLORER','收益对比','同一起止日，看收益积累、年度差异与途中回撤。') + `<div id="return-comparison-root"><section class="card rc-selection"><div class="rc-selection-head"><div><h2>对比哪些资产</h2><span>${catalog.assets.filter(a=>a.status==='available').length.toLocaleString()} 个可用标的 · 每次最多8个</span></div>${picker?'':button('＋ 添加 / 筛选标的','picker','','btn primary')}</div><div class="rc-selected">${state.ids.map((id,i)=>`<span class="rc-selected-chip"><i style="background:${G.colors[i]}"></i>${esc(asset(id)?.name||id)}${button('×','remove',id,'',`aria-label="移除${esc(asset(id)?.name||id)}"`)}</span>`).join('')}${state.ids.length?button('清空','clear','','text-link small'):''}</div><div class="rc-presets"><span>快速开始</span>${presets.map(([id,name,ids])=>button(name,'preset',ids.join('|'),'filter-chip')).join('')}</div></section>${picker?library():''}<section class="rc-controls"><div class="segmented" aria-label="对比区间">${[[1,'近1年'],[2,'近2年'],[3,'近3年'],[5,'近5年'],[10,'近10年'],[20,'近20年'],['common','共同历史'],['custom','自选日期']].map(([id,name])=>button(name,'years',id,String(state.years)===String(id)?'active':'',`aria-pressed="${String(state.years)===String(id)}"`)).join('')}</div><div class="rc-settings">${select('显示币种','currency',[['native','各自原币'],['CNY','人民币'],['USD','美元']],state.currency)}<div><span class="rc-control-label">年化收益</span>${H.annualControl()}</div></div>${state.years==='custom'?`<div class="rc-custom-dates"><label>开始日<input type="date" data-rc-field="start" value="${esc(state.start)}"></label><label>结束日<input type="date" data-rc-field="end" value="${esc(state.end)}"></label></div>`:''}</section>${output()}<details class="rc-method"><summary>收益口径与日期对齐</summary><p>曲线为累计收益，使用每个标的自身的已发布日线，在所有标的都有观测的日期取共同起止点。境内ETF按净值，价格指数不含分红，股票及海外ETF使用供应商含分红复权价格。已计入基金持续年费，个人税费另算；不能再次把分红加到复权回报上。</p><p>年化使用实际天数÷365.2425，不足约一年不外推。跨币种只使用同一当地日历日期的真实汇率，不补造缺失行情；不同市场收盘时刻并不相同。回撤按各自日线计算，缺汇率或存在长缺口时不发布回撤。指数只用正式发布后的点位，历史回算不混入实盘区间。</p><p>当前存续标的的历史含幸存者偏差，过去领先不构成未来收益保证。</p><a href="https://github.com/jianxieb/fund-data/blob/main/docs/return-comparison-method.md" target="_blank" rel="noopener noreferrer">完整计算方法 ↗</a></details></div>`;
  }
  document.addEventListener('click', e => {
    const el=e.target.closest('[data-rc]'); if(!el||!H) return;
    const act=el.dataset.rc,v=el.dataset.value;
    if(act==='picker') picker=!picker;
    else if(act==='remove') state.ids=state.ids.filter(id=>id!==v);
    else if(act==='clear') state.ids=[];
    else if(act==='preset') state.ids=v.split('|').filter(id=>asset(id));
    else if(act==='years') { state.years=/^\d+$/.test(v)?+v:v; if(v==='custom'&&!state.start){state.start=result?.start||'2021-01-01';state.end=result?.end||'2026-01-01';} }
    else if(act==='chart') state.chart=v;
    else if(act==='page') page=Number(v);
    else if(act==='collection'){state.collection=v;state.direction='all';page=1;}
    else if(act==='reset-filters'){for(const f of ['collection','assetClass','region','strategy','direction','minHistory','availability'])state[f]='all';state.query='';state.sort='default';page=1;}
    else if(act==='retry') { computed=''; error=''; }
    else if(act==='export'&&result){ H.download('长衡-收益对比-'+result.end+'.csv',M.csv([['日期',...result.rows.map(r=>r.code+' '+basis(r)+' 累计收益% ('+(state.currency==='native'?r.currency:state.currency)+')')],...result.dates.map((d,i)=>[d,...result.rows.map(r=>r.points[i][1])])]),'text/csv;charset=utf-8'); return; }
    else return;
    refresh();
  });
  document.addEventListener('change', e => {
    const el=e.target;if(!el.closest?.('#return-comparison-root'))return;
    if(el.dataset.rcAsset){ const id=el.dataset.rcAsset; if(el.checked&&state.ids.length<8) state.ids.push(id);else state.ids=state.ids.filter(v=>v!==id); }
    else if(el.dataset.rcField&&el.dataset.rcField!=='query'){state[el.dataset.rcField]=el.value;page=1;}
    else return;
    refresh();
  });
  document.addEventListener('input', e => {
    const el=e.target;
    if(el.id==='rc-query'){state.query=el.value;page=1;refresh();}
    if(el.id!=='rc-cursor'||!result)return;
    cursor=Number(el.value); const d=result.dates[cursor];document.querySelector('#rc-cursor-date').textContent=d;
    result.rows.forEach((r,i)=>{const v=(state.chart==='drawdown'?r.drawdowns:r.points)[cursor]?.[1];document.querySelector('[data-rc-value="'+i+'"]').textContent=percent(v);});
    const x=72+(Date.parse(d)-Date.parse(result.start))/(Date.parse(result.end)-Date.parse(result.start))*1018;
    const line=document.querySelector('[data-rc-cursor]');line?.setAttribute('x1',x);line?.setAttribute('x2',x);
  });
  window.ChanghengReturnComparison={view};
})();
