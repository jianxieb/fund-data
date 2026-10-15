(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ChanghengGlobalFinanceModel = model;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const finite = (...xs) => xs.every(Number.isFinite);
  const labFields = {bond:['yield'],inflation:['inflation','years'],fx:['asset','fx'],mortgage:['mortgageRate','mortgageYears']};
  const ranges = {yield:[0,10,.25,5],inflation:[0,10,.5,3],years:[1,30,1,10],asset:[-40,40,1,10],fx:[-20,20,1,-8],mortgageRate:[0,8,.25,5],mortgageYears:[5,40,5,30]};
  function viewFromHash(hash, data, scenarios) {
    const [route, query] = String(hash || '').split('?');
    if (route !== '#global-finance' || !query) return null;
    const p = new URLSearchParams(query);
    const panel = ['map','policy','library','lab'].includes(p.get('panel')) ? p.get('panel') : 'map';
    const view = {panel};
    if (panel === 'map') view.scenario = scenarios.some(s=>s.id===p.get('scenario')) ? p.get('scenario') : scenarios[0].id;
    if (panel === 'library') {
      view.topic = data.topics.some(t=>t.id===p.get('topic')) ? p.get('topic') : 'dollar';
      view.category = data.categories.some(c=>c.id===p.get('category')) ? p.get('category') : 'all';
      view.query = (p.get('q') || '').slice(0,200);
    }
    if (panel === 'lab') {
      view.lab = Object.hasOwn(labFields,p.get('lab')) ? p.get('lab') : 'bond';
      for (const key of labFields[view.lab]) {
        const [min,max,step,fallback] = ranges[key], value = Number(p.get(key));
        view[key] = p.has(key) && Number.isFinite(value) && value>=min && value<=max && Math.abs((value-min)/step-Math.round((value-min)/step))<1e-8 ? value : fallback;
      }
    }
    return view;
  }
  function viewHash(view) {
    const p = new URLSearchParams({panel:view.panel});
    if (view.panel === 'map') p.set('scenario',view.scenario);
    if (view.panel === 'library') {
      p.set('topic',view.topic);
      if (view.category && view.category!=='all') p.set('category',view.category);
      if (view.query) p.set('q',view.query.slice(0,200));
    }
    if (view.panel === 'lab') {
      p.set('lab',view.lab);
      for (const key of labFields[view.lab] || []) p.set(key,String(view[key]));
    }
    return '#global-finance?' + p;
  }
  function researchLink(topic) {
    const item = {
      valuation:['pe','标普500价格与TTM PE'],
      realrate:['real10y','实际国债收益率与标普500价格'],
      policy:['yield10y','10年国债收益率与标普500价格'],
      hikes:['real10y','实际国债收益率与标普500价格'],
      cuts:['yield10y','10年国债收益率与标普500价格'],
      bond:['yield10y','10年国债收益率与标普500价格'],
      duration:['yield10y','10年国债收益率与标普500价格'],
      curve:['curve10_2','10年—2年期限利差与标普500价格'],
      tips:['real10y','实际国债收益率与标普500价格'],
      liquidity:['nfci','金融条件指数与标普500价格'],
      vix:['vix','VIX与标普500价格']
    }[topic];
    return item ? {href:'#market-history?market=spx&metric='+item[0]+'&years=20',label:item[1]} : null;
  }
  function bondPrice({face=100,coupon=4,yieldRate=5,years=10,frequency=2}={}) {
    if (!finite(face,coupon,yieldRate,years,frequency)||face<=0||coupon<0||yieldRate<=-100*frequency||years<=0||!Number.isInteger(years*frequency)||!Number.isInteger(frequency)||frequency<1) return null;
    const n=years*frequency,y=yieldRate/100/frequency,payment=face*coupon/100/frequency;
    return Array.from({length:n},(_,i)=>payment/((1+y)**(i+1))).reduce((a,b)=>a+b,0)+face/(1+y)**n;
  }
  function purchasingPower({amount=100000,inflation=3,years=10}={}) {
    if(!finite(amount,inflation,years)||amount<0||inflation<=-100||years<0)return null;
    return amount/(1+inflation/100)**years;
  }
  function fxReturn(asset,fx) {
    if(!finite(asset,fx)||asset< -100||fx<=-100)return null;
    return ((1+asset/100)*(1+fx/100)-1)*100;
  }
  function mortgage({principal=1000000,rate=3,years=30}={}) {
    if(!finite(principal,rate,years)||principal<=0||rate<0||years<=0||!Number.isInteger(years*12))return null;
    const n=years*12,r=rate/1200;
    const monthly=r===0?principal/n:principal*r/(1-(1+r)**-n);
    return {monthly,total:monthly*n,interest:monthly*n-principal};
  }
  const normalize = text => String(text??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  function searchTopics(topics,query='',category='all') {
    const q=normalize(query);
    return topics.filter(t=>(category==='all'||t.category===category)&&(!q||normalize([t.name,t.en,t.definition,t.pitfall,...t.chain,...t.watch].join(' ')).includes(q)));
  }
  function freshness(checkedAt,today=new Date().toISOString().slice(0,10),limit=14) {
    const days=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(checkedAt+'T00:00:00Z'))/86400000);
    return {days:Number.isFinite(days)?days:null,stale:!Number.isFinite(days)||days>limit,future:days<0};
  }
  return {viewFromHash,viewHash,researchLink,bondPrice,purchasingPower,fxReturn,mortgage,searchTopics,freshness};
});
