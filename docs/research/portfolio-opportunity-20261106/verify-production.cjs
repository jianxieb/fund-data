'use strict';
// Independent production/research ledger audit. Both engines receive the same
// frozen actual ETF/FX history; current-source revisions are reported separately.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../../..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),sha=p=>hash(fs.readFileSync(p));
const read=p=>JSON.parse(fs.readFileSync(p)),one=process.argv.includes('--one'),work=fs.mkdtempSync(path.join(os.tmpdir(),'opportunity-production-audit-'));
const previousFile=path.join(__dirname,'integration-audit.json'),previous=fs.existsSync(previousFile)?read(previousFile):null;
const priorAudits=previous?.status==='fail'?[...(previous.priorAudits||[]),{status:previous.status,counters:previous.counters,errors:previous.errors,productionFiles:previous.productionFiles,elapsedSeconds:previous.elapsedSeconds}]:previous?.priorAudits||[];
const researchArchive=path.join(__dirname,'reproduction.tar.gz');
const oldArchive=path.join(ROOT,'docs/research/portfolio-methods-20261106/reproduction.tar.gz');
cp.execFileSync('rtk',['proxy','tar','-xzf',researchArchive,'-C',work]);
cp.execFileSync('rtk',['proxy','tar','-xzf',oldArchive,'-C',work]);
const RESEARCH=path.join(work,'buy-score-20261106'),FROZEN=path.join(work,'portfolio-methods-20261106/production');
const E=require(path.join(RESEARCH,'engine.cjs')),R=require(path.join(RESEARCH,'research.cjs')),R2=require(path.join(RESEARCH,'round2.cjs'));
const P=require(path.join(ROOT,'assets/portfolio-model.js')),O=require(path.join(ROOT,'assets/portfolio-opportunity.js'));
const productionFiles=['assets/portfolio-model.js','assets/portfolio-systematic.js','assets/portfolio-opportunity.js','assets/model.js'];
const sourceHashes=Object.fromEntries(productionFiles.map(f=>[f,sha(path.join(ROOT,f))]));
function catalogAt(root){const text=fs.readFileSync(path.join(root,'data/portfolio/catalog.js'),'utf8');return JSON.parse(text.slice(text.indexOf('=')+1).trim().replace(/;$/,''));}
const currentCatalog=catalogAt(ROOT),frozenCatalog=catalogAt(FROZEN),files={'us:USD':'data/portfolio/us/USD-b2e099b598f25d1d.json','us:TQQQ':'data/portfolio/us/TQQQ-235126570a4b63be.json','us:QQQ':'data/portfolio/us/QQQ-2d88370080c88a85.json'};
const histories=Object.fromEntries(Object.entries(files).map(([id,file])=>[id,read(path.join(FROZEN,file))]));
const soxx=E.input.proxies['us:SOXX'];histories['us:SOXX']={schemaVersion:1,id:'us:SOXX',currency:'USD',basis:soxx.basis,dividends:'reinvested',first:soxx.series[0][0],asOf:soxx.series.at(-1)[0],series:soxx.series,sourceUrl:soxx.sourceUrl};
const fxFile='data/portfolio/fx/CNY-5f1b9958db2b35db.json',fxHistory=read(path.join(FROZEN,fxFile)),marketContext=read(path.join(FROZEN,'data/portfolio/entry-context.json'));
const catalog={...frozenCatalog,assets:Object.keys(histories).map(id=>({...currentCatalog.assets.find(a=>a.id===id),first:histories[id].first,asOf:histories[id].asOf})),fx:{...frozenCatalog.fx,first:fxHistory.first,asOf:fxHistory.asOf}};
const currentHistories={},sourceRevisions={};for(const id of Object.keys(histories)){
 const current=read(path.join(ROOT,currentCatalog.assets.find(a=>a.id===id).historyUrl)),map=new Map(current.series),frozen=histories[id].series;
 currentHistories[id]=current;const ratios=[];
 let mismatches=0,maxAbsDifference=0,maxRelativeDifference=0;for(const[d,p]of frozen){assert(map.has(d));const diff=Math.abs(map.get(d)-p);if(diff>0)mismatches++;maxAbsDifference=Math.max(maxAbsDifference,diff);maxRelativeDifference=Math.max(maxRelativeDifference,diff/p);ratios.push(map.get(d)/p);}
 const medianScale=E.median(ratios),maxShapeDrift=Math.max(...ratios.map(r=>Math.abs(r/medianScale-1)));
 sourceRevisions[id]={frozenDates:frozen.length,mismatches,maxAbsDifference,maxRelativeDifference,medianScale,maxShapeDrift,currentAsOf:current.asOf,frozenAsOf:histories[id].asOf};
}
for(const[day,prices]of E.input.daily)for(let k=0;k<2;k++)assert.equal(prices[k],P.at(histories[['us:USD','us:TQQQ'][k]].series,day).value*P.at(fxHistory.series,day,7).value);
for(const id of ['us:USD','us:TQQQ'])assert.deepEqual(histories[id].dividendEvidence.fractions,E.taxInput[id].dividendEvidence.fractions);
const contextMap=new Map(marketContext.series.map(r=>[r[0],r]));for(const row of E.input.vix)assert.deepEqual(row,contextMap.get(row[0]));
const qMap=new Map(histories['us:QQQ'].series);for(const row of E.input.proxies['us:QQQ'].series)assert.equal(row[1],qMap.get(row[0]));
const features=O.createFeatures({rawHistories:Object.fromEntries(Object.entries(histories).map(([id,h])=>[id,h.series])),vixContext:marketContext});
let scoresChecked=0,maxScoreError=0;for(const f of R.FEATURES){const actual=features.at(f.day);for(let k=0;k<2;k++)for(const family of ['discount','mixed']){const a=actual.legs[k].scores[family],b=f.scores[k][family];assert.equal(a===null,b===null);if(a!==null){const err=Math.abs(a-b);assert(err<1e-10);maxScoreError=Math.max(maxScoreError,err);scoresChecked++;}}}
const currentFeatures=O.createFeatures({rawHistories:Object.fromEntries(Object.entries(currentHistories).map(([id,h])=>[id,h.series])),vixContext:read(path.join(ROOT,'data/portfolio/entry-context.json'))});
const currentScoreDrift={comparisons:0,differences:0,maxDifference:0,thresholdCrossings:[]};
for(const f of R.FEATURES){const actual=currentFeatures.at(f.day);for(let k=0;k<2;k++)for(const[family,threshold]of [['discount',35],['discount',50],['mixed',35]]){
 const a=actual.legs[k].scores[family],b=f.scores[k][family];assert.equal(a===null,b===null);if(a===null)continue;
 const error=Math.abs(a-b);currentScoreDrift.comparisons++;if(error)currentScoreDrift.differences++;
 if(error>currentScoreDrift.maxDifference){currentScoreDrift.maxDifference=error;currentScoreDrift.maximum={day:f.day,leg:k,family,current:a,frozen:b};}
 if((a>=threshold)!==(b>=threshold))currentScoreDrift.thresholdCrossings.push({day:f.day,leg:k,family,threshold,current:a,frozen:b});
}}
const definitions=[['opportunity_discount_10',{family:'discount',reserve:.1,threshold:35,gate:'vix'}],['opportunity_discount_20',{family:'discount',reserve:.2,threshold:50,gate:'vix'}],['opportunity_mixed_10',{family:'mixed',reserve:.1,threshold:35,gate:'vix'}]];
const counters={accounts:0,fills:0,commonValuations:0,maxValueError:0,maxCommonMddError:0,maxFullCalendarMddDifference:0,maxPaidTaxError:0,maxFillError:0,maxCashError:0};
const rows=[],errors=[],causality=[],start=performance.now();
const near=(a,b,label,tol=1e-7)=>{const d=Math.abs(a-b);assert(d<=tol,`${label}: ${a} != ${b}; diff=${d}`);return d;};
const configFor=(method,w,o)=>({positions:['us:USD','us:TQQQ'].map((id,k)=>({id,weight:100*w[k]})),currency:'CNY',initial:100,monthly:0,rebalance:'none',transactionFee:.1,feeBasis:'net',years:'custom',start:o.start,end:o.end,initialMethod:method,contributionMethod:'dca_month',tax:{usCapitalGains:20,usDividend:20,liquidate:false}});
function simulate(config,h=histories,v=marketContext){const a=P.simulate({catalog,histories:h,fxHistory,marketContext:v,config});assert(!a.error,a.error);return a;}
outer:for(const[method,c]of definitions)for(const weights of [[.3,.3],[.5,.5]]){
 for(const origin of E.input.origins){try{
  const config=configFor(method,weights,origin),actual=simulate(config),expected=E.account(origin,weights.map(w=>w*(1-c.reserve)),R2.factory(c,weights),{trace:true});
  const valueError=near(actual.value,expected.value,'terminal'),paidTaxError=near(actual.capitalTax+actual.dividendTax,expected.paidTax,'paidTax');
  near(actual.annualReturn,expected.annualReturn,'annual');near(actual.tradeCost,expected.fees,'fees');near(actual.taxReserve,expected.reserve,'reserve');const cashError=near(actual.cash,expected.finalCash,'cash');
  const byDay=new Map(actual.curve.map(r=>[r.day,r]));let peak=100,mdd=0;for(const row of expected.curve){const a=byDay.get(row.day);assert(a);near(a.value,row.value,'curve:'+row.day);peak=Math.max(peak,a.value);mdd=Math.min(mdd,100*(a.value/peak-1));counters.commonValuations++;}
  const mddError=near(mdd,expected.mdd,'commonMDD'),key=t=>[t.day,t.signalDay||'',t.id||['us:USD','us:TQQQ'][t.leg],t.side].join('|');
  const at=actual.transactions.slice().sort((a,b)=>key(a).localeCompare(key(b))),bt=expected.trades.slice().sort((a,b)=>key(a).localeCompare(key(b)));assert.equal(at.length,bt.length,'tradeCount');
  for(let i=0;i<at.length;i++){assert.equal(key(at[i]),key(bt[i]),'tradeKey');for(const field of ['amount','fee','tax'])counters.maxFillError=Math.max(counters.maxFillError,near(at[i][field],bt[i][field],field));}
  counters.accounts++;counters.fills+=at.length;counters.maxValueError=Math.max(counters.maxValueError,valueError);counters.maxCashError=Math.max(counters.maxCashError,cashError);counters.maxPaidTaxError=Math.max(counters.maxPaidTaxError,paidTaxError);counters.maxCommonMddError=Math.max(counters.maxCommonMddError,mddError);counters.maxFullCalendarMddDifference=Math.max(counters.maxFullCalendarMddDifference,Math.abs(actual.mdd-expected.mdd));
  rows.push({method,weights,start:origin.start,end:origin.end,years:origin.years,value:actual.value,reference:expected.value,annualReturn:actual.annualReturn,paidTax:actual.capitalTax+actual.dividendTax,fee:actual.tradeCost,taxReserve:actual.taxReserve,fullMDD:actual.mdd,commonMDD:mdd,trades:at.length,valueError});
  if(weights[0]===.3&&origin.start==='2014-01-02'&&origin.years===10){
   for(const cutoff of ['2014-10-10','2020-03-31']){
    const changed=Object.fromEntries(Object.entries(histories).map(([id,h])=>[id,{...h,series:h.series.map(([d,p])=>[d,d>cutoff?p*1.37:p])}]));
    const changedVix={...marketContext,series:marketContext.series.map(([d,a,b])=>[d,d>cutoff?a*2.1:a,d>cutoff?b*.7:b])};
    const mutated=simulate(config,changed,changedVix);
    const a=actual.systematic.daily.filter(r=>r.day<=cutoff),b=mutated.systematic.daily.filter(r=>r.day<=cutoff);assert.deepEqual(b,a,'futureperturbationchangedearlierscores/plans');
    assert.deepEqual(mutated.transactions.filter(t=>t.day<=cutoff),actual.transactions.filter(t=>t.day<=cutoff));
    const truncatedRaw=Object.fromEntries(Object.entries(histories).map(([id,h])=>[id,h.series.filter(r=>r[0]<=cutoff)])),prefix=O.createFeatures({rawHistories:truncatedRaw,vixContext:{...marketContext,series:marketContext.series.filter(r=>r[0]<=cutoff)}});
    assert.deepEqual(prefix.at(cutoff),features.at(cutoff));causality.push({method,cutoff,prefixRows:a.length,status:'pass',features:'historyprefix equals fullhistoryatcutoff',plans:'futureprice/VIXperturbation leaves earlierdailyrowsandtradesidentical'});
   }
  }
 }catch(error){errors.push({method,weights,start:origin.start,end:origin.end,message:error.message,stack:error.stack});console.log(JSON.stringify(errors.at(-1)));break outer;}
 if(one)break outer;
 }
 console.log(JSON.stringify({progress:counters.accounts,method,weights,elapsedSeconds:(performance.now()-start)/1000}));
}
for(const[file,shaBefore]of Object.entries(sourceHashes)){const after=sha(path.join(ROOT,file));if(after!==shaBefore)errors.push({message:'Productionfilechangedduringaudit',file,before:shaBefore,after});}
const result={status:errors.length?'fail':'pass',scope:'Currentproductioncodeversusindependentfrozenresearch; actualUSD/TQQQandFXsame-sourceinputs; SOXXandQQQfeatures, zero newfunding, .1%fees,20%tax,612accountswhenfullrun.',partial:one,researchArchiveSHA256:sha(researchArchive),nativeSourceArchiveSHA256:sha(oldArchive),productionFiles:sourceHashes,sourceRevisions,currentScoreDrift,scoresChecked,maxScoreError,counters,causality,elapsedSeconds:(performance.now()-start)/1000,errors,priorAudits,rows};
fs.writeFileSync(path.join(__dirname,'integration-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,rows:rows.length},null,2));if(errors.length)process.exitCode=1;
