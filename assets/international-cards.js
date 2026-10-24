(function () {
  'use strict';
  const D = window.INTERNATIONAL_CARDS, M = window.ChanghengInternationalCardsModel;
  const esc = window.Changheng.escapeHtml;
  const state = { ...M.defaults };
  let H;
  const feeNames = { opening:'开户／前置费',issuance:'首次开卡费',annual:'年费／会员费',monthly:'账户月费' };
  const feeOptions = [['all','不限'],['free','免费／无额外费用'],['paid','收费'],['waivable','有条件豁免'],['temporary','目前暂免'],['unknown','未核实'],['conflict','费表冲突']];
  const select = (key,label,options) => `<label for="ic-${key}">${label}<select id="ic-${key}" data-ic-filter="${key}">${options.map(([value,text])=>`<option value="${esc(value)}"${state[key] === value ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const link = id => `<a href="${esc(D.sources[id].url)}" target="_blank" rel="noopener noreferrer">${esc(D.sources[id].label)} ↗</a>`;
  function feeCell(f) {
    return `<span class="ic-fee ic-fee-${f.status}">${esc(M.feeText(f))}</span>`;
  }
  function categoryNote() {
    const count = ['region','type','cardType','format','mode','capital'].filter(k=>state[k] !== 'all').length;
    return count ? ' · 已选' + count + '项' : '';
  }
  function filters() {
    const categories = select('region','地区',[['all','全部地区'],...[...new Set(D.rows.map(r=>r.region))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(x=>[x,x])]) + select('type','机构类型',[['all','全部机构'],...Object.entries(M.types)]) + select('cardType','卡片类型',[['all','全部卡种'],...Object.entries(M.cardTypes)]) + select('format','卡片形态',[['all','全部形态'],...Object.entries(M.formats)]) + select('mode','办理方式',[['all','全部方式'],...Object.entries(M.modes)]) + select('capital','资金门槛',[['all','不限'],...Object.entries(M.capitalLabels)]);
    return `<section class="ic-filters" aria-label="银行卡筛选"><div class="ic-filter-top"><label class="ic-search" for="ic-query">搜索产品<input id="ic-query" type="search" data-ic-filter="query" placeholder="银行、卡片、地区或申请条件" value="${esc(state.query)}"></label>${select('sort','排序',[['priority','办理优先级'],['issuance','开卡费：免费优先'],['annual','年费：免费优先'],['monthly','月费：免费优先'],['region','地区']])}<button type="button" class="btn ic-reset" data-ic-reset>重置筛选</button></div><div class="ic-filter-grid ic-fee-filters">${M.feeFields.map(k=>select(k,feeNames[k],feeOptions)).join('')}</div><details class="ic-more-filters"><summary>地区与更多分类<span id="ic-more-count">${categoryNote()}</span></summary><div class="ic-filter-grid">${categories}</div></details></section>`;
  }
  function tabs() {
    const counts = M.statusCounts(D.rows,state);
    return `<div class="ic-status-tabs" role="group" aria-label="申请状态">${Object.entries({all:'全部',...M.statuses}).map(([key,label])=>`<button type="button" id="ic-status-${key}" data-ic-status="${key}" class="${state.status === key ? 'active' : ''}" aria-pressed="${state.status === key}">${label}<span data-ic-count="${key}">${counts[key]}</span></button>`).join('')}</div>`;
  }
  function row(r) {
    const format = r.format.length ? r.format.map(f=>M.formats[f]).join(' / ') : '卡片形态未核实';
    return `<tr data-ic-row="${r.id}"><td><div class="ic-product"><span class="ic-rank" aria-label="优先顺序${r.rank}">${String(r.rank).padStart(2,'0')}</span><div>${r.logo ? `<img class="ic-logo" src="assets/institutions/${r.logo}" alt="" width="28" height="28">` : ''}<strong>${esc(r.name)}</strong><small>${esc(r.region)} · ${esc(M.types[r.type])}</small><small>${esc(format)}${r.cardType !== 'unknown' ? ' · ' + esc(M.cardTypes[r.cardType]) : ''}</small></div></div></td><td class="ic-condition"><span class="ic-status ic-status-${r.status}">${M.statuses[r.status]}</span><p>${esc(r.condition)}</p><small>${esc(M.modes[r.mode])}</small></td><td class="ic-costs"><div><span>开户</span>${feeCell(r.fees.opening)}</div><div><span>开卡</span>${feeCell(r.fees.issuance)}</div></td><td class="ic-costs"><div><span>年费</span>${feeCell(r.fees.annual)}</div><div><span>月费</span>${feeCell(r.fees.monthly)}</div></td><td class="ic-capital"><strong>${esc(r.capital.text)}</strong>${r.capital.status === 'unknown' ? '' : '<small>资金条件，非手续费</small>'}</td><td><button type="button" class="text-link ic-detail-button" data-ic-detail="${r.id}" aria-label="查看${esc(r.name)}的条件、费用与来源">详情 ↗</button></td></tr>`;
  }
  function results() {
    const rows = M.select(D.rows,state);
    const sortNote = M.feeFields.includes(state.sort) ? '按收费状态排序；金额保留原币' : '按明确资格、办理便利与资金成本排序';
    return `<div class="ic-results-head"><p role="status" aria-live="polite">找到 <strong>${rows.length}</strong> 项<span> / ${D.rows.length} 项研究路径</span></p><span>${sortNote}</span><button type="button" class="text-link" data-ic-export${rows.length ? '' : ' disabled'}>导出筛选结果</button></div>${rows.length ? `<div class="table-wrap ic-table-scroll" tabindex="0" role="region" aria-label="国际银行卡比较表"><table class="ic-table"><caption class="ic-visually-hidden">国际银行卡申请资格、费用及资金条件比较</caption><thead><tr><th scope="col">产品 / 优先顺序</th><th scope="col">申请条件</th><th scope="col">一次性费用</th><th scope="col">持续费用</th><th scope="col">资金门槛</th><th scope="col"><span class="ic-visually-hidden">条件与来源</span></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>` : `<div class="ic-empty"><strong>没有同时满足这些条件的产品</strong><p>可放宽地区或费用条件，也可查看“待核实”项目。</p><button type="button" class="btn" data-ic-reset>清除全部筛选</button></div>`}`;
  }
  function update() {
    const target = document.getElementById('ic-results');
    if (!target) return;
    target.innerHTML = results();
    const counts = M.statusCounts(D.rows,state);
    document.querySelectorAll('[data-ic-status]').forEach(button=>{
      button.classList.toggle('active',button.dataset.icStatus === state.status);
      button.setAttribute('aria-pressed',String(button.dataset.icStatus === state.status));
      button.querySelector('[data-ic-count]').textContent = counts[button.dataset.icStatus];
    });
    document.getElementById('ic-more-count').textContent = categoryNote();
    window.ChanghengTables?.sync();
  }
  function detail(id) {
    const r = D.rows.find(x=>x.id === id); if (!r) return;
    H.openModal(H.modalTitle(esc(r.name),`${esc(r.region)} · ${esc(M.types[r.type])} · 核验 ${r.reviewedAt}`) + `<article class="ic-detail"><div class="ic-detail-verdict"><span class="ic-status ic-status-${r.status}">${M.statuses[r.status]}</span><h3>${esc(r.condition)}</h3><p>${esc(r.reason)}</p></div><dl class="ic-detail-fees">${M.feeFields.map(k=>`<div><dt>${feeNames[k]}</dt><dd>${feeCell(r.fees[k])}<small>${esc(r.fees[k].note || '其他交易及可选服务费用不包含在此项内。')}</small></dd></div>`).join('')}</dl><section><h3>资金要求</h3><p>${esc(r.capital.text)}</p>${r.capital.note ? `<p class="muted">${esc(r.capital.note)}</p>` : ''}</section>${r.requirements.length ? `<section><h3>申请材料与前提</h3><ul>${r.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}<section><h3>寄送与启用</h3><p>${esc(r.delivery)}</p></section>${r.notes.length ? `<section><h3>办理前核对</h3><ul>${r.notes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}<section class="ic-sources"><h3>官方依据</h3>${r.sources.map(link).join('')}</section></article>`);
  }
  function view(helpers) {
    H = helpers;
    return H.head('INTERNATIONAL BANK CARDS','国际银行卡',D.scope,`<span class="ic-reviewed">资料核验 ${D.reviewedAt}</span>`) + `${filters()}${tabs()}<section id="ic-results" class="ic-results" aria-label="银行卡筛选结果">${results()}</section><p class="ic-footnote">可申请仍需银行审核；免费筛选仅针对所选费用科目，暂免和有条件豁免单列。</p><details class="ic-method"><summary>优先级与收费口径</summary><ul>${D.methodology.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></details>`;
  }
  document.addEventListener('input',event=>{
    if (event.target.id === 'ic-query') { state.query = event.target.value; update(); }
  });
  document.addEventListener('change',event=>{
    const key = event.target.dataset.icFilter;
    if (key && key !== 'query' && Object.hasOwn(state,key)) { state[key] = event.target.value; update(); }
  });
  document.addEventListener('click',event=>{
    const button = event.target.closest('[data-ic-status],[data-ic-detail],[data-ic-reset],[data-ic-export]');
    if (!button || !H || button.disabled) return;
    if (button.dataset.icDetail) { detail(button.dataset.icDetail); return; }
    if (button.hasAttribute('data-ic-export')) { H.download('长衡-国际银行卡-'+D.reviewedAt+'.csv','\uFEFF'+M.csv(M.select(D.rows,state),D),'text/csv;charset=utf-8'); return; }
    if (button.hasAttribute('data-ic-reset')) {
      Object.assign(state,M.defaults);
      document.querySelectorAll('[data-ic-filter]').forEach(input=>{input.value=state[input.dataset.icFilter];});
      update();
      document.getElementById('ic-query')?.focus();
      return;
    }
    state.status = button.dataset.icStatus; update();
  });
  window.ChanghengInternationalCards = { view };
})();
