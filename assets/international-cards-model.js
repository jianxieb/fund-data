(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ChanghengInternationalCardsModel = model;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const defaults = { query:'',status:'all',region:'all',type:'all',cardType:'all',format:'all',mode:'all',opening:'all',issuance:'all',annual:'all',monthly:'all',capital:'all',sort:'priority' };
  const statuses = { priority:'优先办理',conditional:'补充条件',unverified:'待核实',ineligible:'当前不符' };
  const types = { bank:'银行',broker:'券商配套卡',payment:'支付／金融科技', 'credit-union':'信用社' };
  const modes = { remote:'可远程申请',witness:'转介／境内见证',onsite:'需赴境外办理或启用',unknown:'办理方式待核实' };
  const cardTypes = { debit:'借记／扣账卡','secured-credit':'担保信用卡',charge:'签账卡',unknown:'卡种待核实' };
  const formats = { physical:'实体卡',virtual:'虚拟卡' };
  const feeLabels = { free:'免费',included:'无额外费用',paid:'收费',waivable:'有条件豁免',temporary:'目前暂免',unknown:'未核实',conflict:'费表冲突' };
  const feeOrder = { free:0,included:0,waivable:1,temporary:2,paid:3,conflict:4,unknown:5 };
  const feeFields = ['opening','issuance','annual','monthly'];
  const capitalLabels = { none:'无最低资金',required:'有资金门槛',alternative:'资金或收入择一',conditional:'资金条件另计',unknown:'资金要求未核实' };
  function feeMatches(fee, value) {
    if (!value || value === 'all') return true;
    return value === 'free' ? ['free','included'].includes(fee.status) : fee.status === value;
  }
  function select(rows, filters = {}) {
    const f = { ...defaults,...filters }, words = f.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const result = rows.filter(r => {
      const searchable = [r.name,r.institution,r.region,r.network,r.condition,r.reason,types[r.type],...(r.requirements || [])].join(' ').toLocaleLowerCase();
      return words.every(w=>searchable.includes(w)) &&
        ['status','region','type','cardType','mode'].every(k=>f[k] === 'all' || r[k] === f[k]) &&
        (f.format === 'all' || r.format.includes(f.format)) &&
        (f.capital === 'all' || r.capital.status === f.capital) &&
        feeFields.every(k=>feeMatches(r.fees[k],f[k]));
    });
    return result.sort((a,b)=>{
      if (feeFields.includes(f.sort)) return feeOrder[a.fees[f.sort].status] - feeOrder[b.fees[f.sort].status] || a.rank-b.rank;
      if (f.sort === 'region') return a.region.localeCompare(b.region,'zh-CN') || a.rank-b.rank;
      return a.rank-b.rank;
    });
  }
  function statusCounts(rows, filters) {
    const counts = { all:0,priority:0,conditional:0,unverified:0,ineligible:0 };
    select(rows,{...filters,status:'all'}).forEach(r=>{counts.all++;counts[r.status]++;});
    return counts;
  }
  function feeText(f) {
    if (f.status === 'free') return '免费';
    return f.text + (f.status === 'waivable' ? ' · 可豁免' : '');
  }
  function validate(data) {
    const seen = new Set();
    data.rows.forEach(r=>{
      if (seen.has(r.id)) throw new Error('重复产品：' + r.id);
      seen.add(r.id);
      if (!statuses[r.status] || !types[r.type] || !cardTypes[r.cardType] || !modes[r.mode] || !capitalLabels[r.capital.status]) throw new Error('无效分类：' + r.id);
      if (!r.condition || !r.reason || !r.sources.length || !/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedAt)) throw new Error('缺少判断依据：' + r.id);
      r.sources.forEach(s=>{ if (!/^https:\/\//.test(data.sources[s]?.url || '')) throw new Error('缺少官方来源：' + r.id); });
      r.format.forEach(f=>{ if (!formats[f]) throw new Error('无效卡片形态：' + r.id); });
      feeFields.forEach(k=>{
        const f = r.fees[k];
        if (!feeLabels[f.status] || !f.text) throw new Error('缺少费用状态：' + r.id + '/' + k);
        if (['unknown','conflict'].includes(f.status) && f.amount !== null) throw new Error('未知收费不得填数值：' + r.id);
        if (f.status === 'free' && f.amount !== 0) throw new Error('免费费用金额不一致：' + r.id);
        if (['paid','waivable','temporary'].includes(f.status) && !(f.amount > 0 && f.currency)) throw new Error('收费缺少金额币种：' + r.id);
      });
    });
    return true;
  }
  function csv(rows, data) {
    const columns = ['优先顺序','产品','地区','机构类型','卡片类型','申请状态','关键条件','办理方式','卡片形态','开户／前置费','开户费说明','开卡费','开卡费说明','年费／会员费','年费说明','账户月费','月费说明','资金门槛','资金说明','核验日期','官方来源'];
    const values = rows.map(r=>[r.rank,r.name,r.region,types[r.type],cardTypes[r.cardType],statuses[r.status],r.condition,modes[r.mode],r.format.map(x=>formats[x]).join('／'),...feeFields.flatMap(k=>[feeText(r.fees[k]),r.fees[k].note]),r.capital.text,r.capital.note || '',r.reviewedAt,r.sources.map(s=>data.sources[s].url).join(' | ')]);
    return [columns,...values].map(row=>row.map(v=>'"'+String(v ?? '').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  }
  return { defaults,statuses,types,cardTypes,modes,formats,feeLabels,capitalLabels,feeFields,select,statusCounts,feeMatches,feeText,validate,csv };
});
