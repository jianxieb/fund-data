#!/usr/bin/env node
'use strict';
// Offline replay. All reads are relative to this package; archived absolute paths
// identify frozen records only. The original algorithms and SHA assertions are preserved.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const crypto = require('crypto'), assert = require('assert/strict');
const here = __dirname, argv = process.argv.slice(2);
if (!argv.includes('--out') || argv.some((x,i) => x.startsWith('--') && !['--out','--full-grid','--extract'].includes(x))) {
  console.error('Usage: node reproduce.cjs --out /new/output/directory [--full-grid] [--extract]'); process.exit(2);
}
const outArg = argv[argv.indexOf('--out') + 1];
assert(outArg && !outArg.startsWith('--'), '--out requires a directory');
const out = path.resolve(outArg);
assert(out !== here && !out.startsWith(here + path.sep), 'Output must be outside this frozen package');
assert(!fs.existsSync(out) || fs.readdirSync(out).length === 0, 'Output directory must be new or empty');
fs.mkdirSync(out, {recursive:true});
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(here,'manifest.json')));
const packed = fs.readFileSync(path.join(here,'evidence.json.gz'));
assert.equal(hash(packed), manifest.archiveSHA256, 'Archive checksum');
const E = JSON.parse(zlib.gunzipSync(packed));
for (const [n,bytes] of Object.entries(E.files)) assert.equal(hash(bytes), E.sha256[n], n);
assert.equal(hash(fs.readFileSync(path.join(here,'buy-method-results.csv'))), E.sha256['grid-results.csv']);
const generated = new Map(), checked = [];
const key = n => path.basename(String(n)) === '买入方法完整结果.csv' ? 'grid-results.csv' : path.basename(String(n));
function get(n) { const k=key(n); assert(k in E.files || generated.has(k), 'Unarchived read denied: '+n); return generated.get(k) ?? E.files[k]; }
function save(n,data) {
  const k=key(n); assert(!generated.has(k), 'Duplicate output: '+k);
  assert(!fs.existsSync(path.join(out,k)), 'Will not overwrite: '+k);
  const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  generated.set(k,str); fs.writeFileSync(path.join(out,k),str,{flag:'wx'});
}
// A bounded read-only archive filesystem is used so old provenance paths cannot
// cause a fresh quote download or a read from the original computer's /tmp.
const archiveFS = {
  readFileSync(n,encoding) { const s=get(n); return encoding ? s : Buffer.from(s); },
  writeFileSync:save,
  existsSync(n) { return generated.has(key(n)); }
};
function execute(name,args=[]) {
  const module={exports:{}};
  const localRequire=n=>{
    if(n==='fs')return archiveFS;
    assert(['path','crypto','assert/strict'].includes(n),'External dependency denied: '+n);
    return require(n);
  };
  localRequire.main=module;
  const code=E.files[name]; assert(code,'Script absent: '+name);
  new Function('require','__dirname','__filename','module','process','console',code)(
    localRequire,E.originalDirectory,path.join(E.originalDirectory,name),module,
    {argv:['node',name,...args]}, {log(){}}
  );
  return module.exports;
}
function same(name) {
  assert(generated.has(name),'Output missing: '+name);
  assert.equal(hash(generated.get(name)),E.sha256[name],'Frozen bytes differ: '+name);
  checked.push(name);
}
const j=n=>JSON.parse(get(n));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const byYearMean=rr=>{
 const yy={};for(const r of rr)(yy[r.start.slice(0,4)]??=[]).push(r.delta);
 return mean(Object.values(yy).map(mean));
};
const only35=rr=>rr.filter(r=>r.years===10 && r.start>='2014' && r.start<'2017');
function pair(a,b) {
 const mm=new Map(b.map(r=>[r.start,r]));
 const rr=a.map(r=>{const c=mm.get(r.start);assert(c&&c.end===r.end);return{start:r.start,delta:r.annualReturn-c.annualReturn};});
 assert.equal(rr.length,35);return{n:rr.length,yearEqualCAGRpp:byYearMean(rr),
  wins:rr.filter(r=>r.delta>1e-9).length,ties:rr.filter(r=>Math.abs(r.delta)<=1e-9).length,
  losses:rr.filter(r=>r.delta< -1e-9).length,
  byYear:Object.fromEntries(['2014','2015','2016'].map(y=>[y,mean(rr.filter(r=>r.start.startsWith(y)).map(r=>r.delta))]))};
}
// Independently value each frozen system trade ledger from the bundled daily prices.
// This verifies all six baseline terminal returns; it does not reselect their trade dates.
const baselineReplay=[];
for(const [file,priceRows,ids] of [
 ['system-baselines.json',j('holdouts.json').daily,['us:USD','us:TQQQ']],
 ['external-baselines.json',j('external-daily.json').rows,['research:SMPIX','research:UOPIX']]
]) {
 const px=new Map(priceRows);let maxValueError=0,maxCAGRError=0;
 for(const r of j(file).rows) {
  const shares=[0,0];let cash=100;
  for(const t of r.transactions) {
   const n=ids.indexOf(t.id),sign=t.side==='buy'?1:-1;
   assert(n>=0 && ['buy','sell'].includes(t.side) && px.has(t.day));
   cash-=sign*t.amount+t.fee+t.tax;shares[n]+=sign*t.amount/px.get(t.day)[n];
  }
  const v=cash+shares.reduce((s,q,i)=>s+q*px.get(r.end)[i],0);
  const days=(Date.parse(r.end)-Date.parse(r.start))/864e5;
  const a=100*((v/100)**(365.2425/days)-1);
  maxValueError=Math.max(maxValueError,Math.abs(v-r.value));
  maxCAGRError=Math.max(maxCAGRError,Math.abs(a-r.annualReturn));
 }
 assert(maxValueError<1e-7 && maxCAGRError<1e-9,file+' baseline valuation changed');
 baselineReplay.push({file,n:j(file).rows.length,maxValueError,maxCAGRError});
}
// Check that the fixed acceleration control still depends only on the original
// 28 development starting signals, not later outcomes or follow-up months.
const features=j('features.json').rows, acc=j('matched-acceleration.json');
const initial=j('nonlinear-protocol.json').developmentDates;
for(const c of j('nonlinear-selection.json').selected.map(r=>r.c)) {
 const rows=initial.map(d=>features.find(r=>r.entry===d)).filter(r=>r[c.a]!=null&&r[c.x]!=null);
 const g=rows.reduce((s,r)=>s+(1-r[c.a])*Math.max(0,2*r[c.x]-1),0)/rows.reduce((s,r)=>s+1-r[c.a],0);
 assert(Math.abs(g-acc.coefficients[c.id].g0)<1e-14,'g0 mismatch: '+c.id);
}
if(argv.includes('--full-grid')) {
 console.log('Replaying 2,568 formulas x 2 adapters and all 324 nonlinear development rules...');
 execute('buy-method-study.cjs',['develop']);
 same('buy-method-selection.json'); same('buy-method-development-ranking.json');
 execute('export-methods.cjs'); same('grid-results.csv');
 execute('nonlinear-study.cjs',['self-test']);
 execute('nonlinear-study.cjs',['develop']);
 same('nonlinear-development.json'); same('nonlinear-selection.json');
 execute('nonlinear-study.cjs',['evaluate']); same('nonlinear-results.json');
}
console.log('Replaying frozen final methods on actual ETF and separate mutual-fund daily prices...');
execute('qualifying-study.cjs',['target']); same('qualifying-target-results.json');
execute('qualifying-study.cjs',['external']); same('qualifying-external-results.json');
const T=j('qualifying-target-results.json'), B=j('system-baselines.json');
const D21=only35(T.results.find(r=>r.c.family==='realized_volatility').controls.ownD);
const comparison35=T.results.map(r=>{
 const rr=only35(r.rows);assert.equal(rr.length,35);
 assert(rr.every(r=>r.initialAvailable&&r.availableMonths===12));
 return{family:r.c.family,id:r.c.id,n:35,
  vs12:pair(rr,only35(B.rows.filter(r=>r.method==='tranche_12'))),
  vsD21:pair(rr,D21),vsOwnD:pair(rr,only35(r.controls.ownD)),
  vsMatchedAcceleration:pair(rr,only35(r.controls.matchedAcceleration)),
  vsLump:pair(rr,only35(B.rows.filter(r=>r.method==='lump_sum')))};
});
save('comparison-35.json',JSON.stringify({period:'2014-2016 entries, true own 10-year maturity',
 metric:'Annualized percentage-point difference, average within entry year then equal average across three years; ties within 1e-9 pp',
 warning:'Three-family inclusion and new ensemble used these outcomes; reused-data description, not untouched validation. The ensemble ownD is (D_mix+2D_21)/3, not D_21.',comparison35},null,2)+'\n');
if(argv.includes('--extract')) {
 const dir=path.join(out,'frozen');fs.mkdirSync(dir);
 for(const[n,s]of Object.entries(E.files))fs.writeFileSync(path.join(dir,n),s,{flag:'wx'});
}
save('reproduction-check.json',JSON.stringify({archiveSHA256:manifest.archiveSHA256,fullGrid:argv.includes('--full-grid'),
 exactFrozenOutputs:checked,g0IndependentCheck:true,baselineReplay,comparisonOrigins:35,
 inputBoundary:'Frozen monthly factor snapshots and production baseline ledgers; no external downloads or factor-source regeneration.',
 outputDirectory:out},null,2)+'\n');
console.log(JSON.stringify({ok:true,out,exactFrozenOutputs:checked,comparison35},null,2));
