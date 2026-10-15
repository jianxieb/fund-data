(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ChanghengGlobalFinanceModel = model;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const finite = (...xs) => xs.every(Number.isFinite);
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
  return {bondPrice,purchasingPower,fxReturn,mortgage,searchTopics,freshness};
});
