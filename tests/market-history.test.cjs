const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../assets/market-history-model.js');

async function renderReport(data) {
  let finish;
  const ready = new Promise(resolve => { finish = resolve; });
  const sandbox = {
    window: {ChanghengMarketHistoryModel:M}, location:{hash:'#market-history'},
    document: {addEventListener() {}, querySelector() { return {dataset:{src:'report.json'}}; }},
    fetch: async () => ({ok:true, json:async () => data})
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/market-history.js'), 'utf8'), sandbox);
  const ctx = {render:finish};
  sandbox.window.ChanghengMarketHistory.view(ctx);
  await ready;
  return sandbox.window.ChanghengMarketHistory.view(ctx);
}

test('historical rank handles ties, endpoints and empty data without a false zero', () => {
  assert.equal(M.percentile([1, 2, 2, 3], 2), 50);
  assert.equal(M.percentile([1, 2, 3], 3), 100 * 2.5 / 3);
  assert.equal(M.percentile([1, 1, 1], 1), 50);
  assert.equal(M.percentile([], 5), null);
  assert.equal(M.percentile([1], NaN), null);
  assert.equal(M.quantile([1, 2, 3, 4], .25), 1.75);
});
test('windows use a fixed report date, exclude future samples and preserve leap-day boundaries', () => {
  assert.equal(M.windowStart('2024-02-29', 5), '2019-02-28');
  const metric = { frequency: 'quarterly', points: [['2019-02-27', 1], ['2019-02-28', 10], ['2023-09-30', 20], ['2025-01-01', 1000]] };
  const s = M.summarize(metric, '2024-02-29', 5);
  assert.equal(s.count, 2);
  assert.equal(s.percentile, 75);
  assert.deepEqual(s.last, ['2023-09-30', 20]);
  assert.equal(s.stale, true);
  assert.equal(s.gaps.length, 1);
  assert.equal(M.summarize(metric, '2010-01-01', 5), null);
});
test('display sampling retains crisis extrema and never bridges a missing quarter', () => {
  const points = Array.from({length: 1000}, (_, i) => [new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), i === 501 ? 10000 : i === 502 ? -10000 : i]);
  const sample = M.downsample(points, 80);
  assert.ok(sample.length <= 80);
  assert.deepEqual(sample[0], points[0]);
  assert.deepEqual(sample.at(-1), points.at(-1));
  assert.ok(sample.some(p => p[1] === 10000));
  assert.ok(sample.some(p => p[1] === -10000));
  assert.equal(M.segments([['2025-06-30', 4], ['2025-09-30', 5], ['2026-10-13', 6]], 'quarterly').length, 2);
});
test('histograms count all observations including repeated maximum and constant series', () => {
  const h = M.histogram([['a', -1], ['b', 0], ['c', 1], ['d', 1]], 2);
  assert.deepEqual(h.counts, [1, 3]);
  const equal = M.histogram([['a', 5], ['b', 5]], 20);
  assert.equal(equal.counts.reduce((a, b) => a + b), 2);
  assert.ok(equal.max > equal.min);
});
test('the curated report keeps index identity and excludes unverified fundamental values', () => {
  const data = JSON.parse(fs.readFileSync(require.resolve('../data/market-history.json'), 'utf8'));
  assert.deepEqual(data.markets.map(m => m.id), ['spx', 'ndx']);
  assert.equal(data.publicationPolicy, 'research-evidence-v2');
  for (const market of [...data.markets, data.context]) {
    assert.equal(market.metrics.length, market.id==='macro'?4:5);
    assert.deepEqual(market.snapshots, []);
    for (const metric of market.metrics) {
      assert.ok(M.eligibleMetric(market.id, metric));
      const s = M.summarize(metric, data.asOf, 20);
      assert.ok(s.count >= 60, `${market.id} ${metric.id}`);
      assert.ok(s.percentile >= 0 && s.percentile <= 100);
      const explicitlyShort = metric.id==='pe' || (market.id === 'ndx' && metric.id === 'vxn');
      assert.equal(s.lateStart, explicitlyShort, `${market.id} ${metric.id}: historical coverage changed`);
      if (s.lateStart) assert.ok(s.coverageYears < 20);
    }
  }
  const spx = data.markets[0], ndx = data.markets[1];
  assert.ok(spx.metrics.some(m => m.id === 'vix'));
  assert.ok(ndx.metrics.some(m => m.id === 'vxn'));
  assert.ok(!ndx.metrics.some(m => m.id === 'vix'));
  assert.equal(ndx.metrics.find(m => m.id === 'vxn').source, 'vxn');
  assert.ok(![...spx.metrics, ...ndx.metrics].some(m => ['forward_pe', 'margin'].includes(m.id)));
  assert.ok([spx,ndx].every(m=>m.metrics.find(x=>x.id==='pe').valuationBasis==='aggregate_ttm'));
});
test('the client rejects estimate flags, source substitutions and unreviewed PE series', () => {
  const good = {id:'vix', source:'vix', evidence:'published'};
  assert.ok(M.eligibleMetric('spx', good));
  assert.equal(M.eligibleMetric('ndx', good), false);
  for (const bad of [{estimated:true}, {estimatedDates:['2026-01-01']}, {caution:'unverified'}, {source:'repost'}, {evidence:'calculated'}]) {
    assert.equal(M.eligibleMetric('spx', {...good, ...bad}), false);
  }
  assert.equal(M.eligibleMetric('spx', {id:'forward_pe', source:'sp-forward', evidence:'published'}), false);
  assert.equal(M.eligibleMetric('macro', {id:'real10y', evidence:'published'}), false);
  assert.ok(M.eligibleMetric('ndx', {id:'rv21', source:'yahoo-ndx', evidence:'calculated'}));
});
test('the report separates provider PE from official risk series and keeps macro data separate', async () => {
  const data = JSON.parse(fs.readFileSync(require.resolve('../data/market-history.json'), 'utf8'));
  const html = await renderReport(data);
  assert.equal((html.match(/data-metric=/g) || []).length, 10);
  assert.ok(!html.includes('data-metric="macro:'));
  assert.ok(!html.includes('mh-snapshots'));
  assert.ok(html.includes('PE公开历史始于2016年10月'));
});
test('overdue observations cannot remain visible as current values and ranks', async () => {
  const data = JSON.parse(fs.readFileSync(require.resolve('../data/market-history.json'), 'utf8'));
  const advanced = new Date(data.asOf + 'T00:00:00Z');
  advanced.setUTCDate(advanced.getUTCDate() + 31);
  data.asOf = advanced.toISOString().slice(0, 10);
  const html = await renderReport(data);
  assert.equal((html.match(/当前读数待更新/g) || []).length, 10);
  assert.ok(!html.includes('class="mh-rank"'));
  assert.ok(!html.includes('class="mh-reading"'));
});
test('CSV exports the selected original-frequency observations with their window and source', () => {
  const metric = { id: 'pe', source: 'source"name', unit: '倍', frequency: 'monthly', points: [['2025-01-01', 20], ['2025-02-01', 21]] };
  const s = M.summarize(metric, '2025-02-01', 5), csv = M.csv({symbol:'SPX'}, metric, s);
  assert.ok(csv.startsWith('\uFEFF"index"'));
  assert.ok(csv.includes('"source""name"'));
  assert.equal(csv.trim().split('\r\n').length, 3);
  assert.ok(csv.includes('"2020-02-01","2025-02-01"'));
});


function studyFixture() {
  const points = [];
  for (let d = new Date('2019-01-01T00:00:00Z'); points.length < 1000; d.setUTCDate(d.getUTCDate()+1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    points.push([d.toISOString().slice(0,10),100+points.length*.1]);
  }
  return {id:'spx',symbol:'SPX',prices:{symbol:'^GSPC',source:'yahoo-spx',basis:'price_index',currency:'USD',points},
    metrics:[{id:'vix',label:'VIX',unit:'点',source:'vix',evidence:'published',points:points.map(([d])=>[d,18])},
      {id:'ma200',label:'MA200',unit:'%',source:'yahoo-spx',evidence:'calculated',points:points.map(([d])=>[d,5])}]};
}
test('scenario outcomes enter on the next close and distinguish ending loss from intra-window drawdown', () => {
  const points = [50,100,150,75,120].map((v,i)=>[`2025-01-0${i+1}`,v]);
  const outcome = M.forwardOutcome(points,0,3);
  assert.equal(outcome.entryDate,'2025-01-02');
  assert.equal(outcome.exitDate,'2025-01-05');
  assert.ok(Math.abs(outcome.returnPct-20)<1e-12);
  assert.equal(outcome.drawdownPct,-50);
  assert.equal(M.forwardOutcome(points,0,4),null);
  const gapped = points.map(p=>[...p]); gapped[3][0]='2025-02-03';
  assert.equal(M.forwardOutcome(gapped,0,3),null);
  const stats = M.outcomeStats([{returnPct:-10,drawdownPct:-20},{returnPct:0,drawdownPct:-10},{returnPct:20,drawdownPct:0}]);
  assert.equal(stats.median,0);
  assert.equal(stats.lossRate,100/3);
  assert.equal(stats.medianDrawdown,-10);
  assert.equal(stats.q25Drawdown,-15);
  assert.equal(M.outcomeStats([]),null);
});
test('descriptive bands use fixed half-open boundaries rather than future-ranked thresholds', () => {
  assert.deepEqual(M.stateBand('vix',20),{lo:20,hi:30});
  assert.equal(M.inBand(20,M.stateBand('vix',19)),false);
  assert.equal(M.inBand(15,M.stateBand('vix',19)),true);
  assert.deepEqual(M.stateBand('ma200',10),{lo:10,hi:Infinity});
  assert.equal(M.stateBand('nfci',1),null);
  assert.equal(M.stateBand('vix',NaN),null);
});
test('each scenario group excludes overlapping holding windows including shared endpoints', () => {
  const events = [{entryIndex:1,exitIndex:5},{entryIndex:5,exitIndex:9},{entryIndex:6,exitIndex:10},{entryIndex:11,exitIndex:15}];
  assert.deepEqual(M.nonOverlapping(events),[events[0],events[2],events[3]]);
});
test('scenario analysis uses exact month-end indicator dates, matured outcomes and no future data', () => {
  const market=studyFixture(), asOf=market.prices.points.at(-1)[0];
  // An observation on the previous day must not fill the missing month-end reading.
  market.metrics[0].points=market.metrics[0].points.filter(([d])=>d!=='2019-01-31');
  const a=M.study(market,asOf,5);
  const nextDates=new Map(market.prices.points.slice(0,-1).map((p,i)=>[p[0],market.prices.points[i+1][0]]));
  for(const r of a.results){
    assert.deepEqual(r.matched,r.baseline);
    assert.ok(r.excludedIncomplete>0);
    let end=-1;
    for(const e of r.matchedEvents){
      assert.notEqual(e.signalDate,'2019-01-31');
      assert.notEqual(e.signalDate.slice(0,7),nextDates.get(e.signalDate).slice(0,7));
      assert.ok(e.entryIndex>end); end=e.exitIndex;
      assert.ok(e.exitDate<=asOf);
      assert.equal(e.entryDate,nextDates.get(e.signalDate));
      assert.equal(e.exitIndex-e.entryIndex,r.sessions);
    }
  }
  market.prices.points.push(['2030-01-01',10000]);
  market.metrics.forEach(m=>m.points.push(['2030-01-01',999]));
  assert.deepEqual(M.study(market,asOf,5),a);
  const csv=M.studyCSV(market,a,126);
  assert.ok(csv.includes('"price_return_pct","max_drawdown_pct"'));
  assert.ok(csv.includes('"similar"'));
  assert.ok(csv.includes('"all_periods"'));
  assert.equal(csv.trim().split('\r\n').length,1+a.results[2].matched.count+a.results[2].baseline.count);
});
test('scenario analysis refuses ETF substitutions, stale conditions, unsupported macro signals and false zero samples', () => {
  const market=studyFixture(), asOf=market.prices.points.at(-1)[0];
  for(const change of [{symbol:'SPY'},{source:'yahoo-ndx'},{basis:'etf_price'},{currency:'CNY'}]) {
    assert.ok(M.study({...market,prices:{...market.prices,...change}},asOf,5).error);
  }
  assert.ok(M.study(market,'2030-01-01',5).error);
  assert.ok(M.study(market,asOf,5,'nfci').error);
  market.metrics[0].points.at(-1)[1]=40;
  const a=M.study(market,asOf,5);
  assert.ok(a.results.every(r=>r.matched===null && r.matchedEvents.length===0));
});
test('research leads with direct input/outcome pairs and keeps standalone histories collapsed', async () => {
  const data=JSON.parse(fs.readFileSync(require.resolve('../data/market-history.json'),'utf8'));
  const html=await renderReport(data);
  assert.equal((html.match(/data-relation="/g)||[]).length,4);
  assert.equal((html.match(/class="mh-scatter"/g)||[]).length,4);
  assert.ok(!html.includes('mh-linked-plot'));
  assert.equal((html.match(/class="mh-indicators"/g)||[]).length,2);
  assert.ok(!/<details[^>]+ open/.test(html));
  assert.ok(html.indexOf('class="mh-scatter"')<html.indexOf('data-metric='));
  assert.ok(html.includes('不重叠窗口'));
  assert.ok(html.includes('非预测准确率'));
  assert.ok(!html.includes('undefined') && !html.includes('NaN'));
  const missing=structuredClone(data); delete missing.markets[0].prices;
  const missingHTML=await renderReport(missing);
  assert.ok(missingHTML.includes('缺少同一指数的美元价格历史'));
});

function researchFixture() {
  const market=studyFixture();
  market.metrics.push({id:'pe',label:'Aggregate PE',unit:'x',source:'jiucai-spx',evidence:'provider',valuationBasis:'aggregate_ttm',vintage:'latest_available',limitations:'No point-in-time constituent statements',points:market.prices.points.map(([d],i)=>[d,20+(i%100)/10])});
  return market;
}
test('monthly research aligns exact dates and calendar horizons without using immature results', () => {
  const m=researchFixture(),asOf=m.prices.points.at(-1)[0],a=M.relationship(m,asOf,5,{months:12,annual:false});
  assert.ok(a.events.length>20);
  assert.ok(a.events.every(e=>e.exitDate.slice(0,7)===M.monthOffset(e.date.slice(0,7),12)));
  for(const e of a.events){
    assert.equal(e.entryDate,e.date);
    assert.ok(Math.abs(e.outcome-(e.exitPrice/e.entryPrice-1)*100)<1e-10);
    const years=(Date.parse(e.exitDate)-Date.parse(e.entryDate))/86400000/365.2425;
    assert.ok(Math.abs(e.annualizedPct-((e.exitPrice/e.entryPrice)**(1/years)-1)*100)<1e-10);
    assert.ok(e.exitDate.slice(0,7)<asOf.slice(0,7));
  }
  const removed=a.events[0].date;
  m.metrics.find(x=>x.id==='pe').points=m.metrics.find(x=>x.id==='pe').points.filter(([d])=>d!==removed);
  assert.ok(!M.relationship(m,asOf,5).events.some(e=>e.date===removed));
  const before=M.relationship(m,asOf,5);
  m.prices.points.push(['2040-01-01',1000000]);
  m.metrics.forEach(x=>x.points.push(['2040-01-01',1000]));
  assert.deepEqual(M.relationship(m,asOf,5),before);
});
test('relationship risk uses subsequent log-return sample variance and tracks intervening drawdowns', () => {
  const prices=[100,110,99,108.9].map((p,i)=>[`2024-01-0${i+1}`,p]);
  const o=M.pathOutcome(prices,0,3),logs=[Math.log(1.1),Math.log(.9),Math.log(1.1)],mean=logs.reduce((a,b)=>a+b)/3;
  assert.ok(Math.abs(o.realizedVol-Math.sqrt(logs.reduce((s,r)=>s+(r-mean)**2,0)/2*252)*100)<1e-10);
  assert.ok(Math.abs(o.drawdownPct+10)<1e-10);
  assert.equal(M.pathOutcome(prices,0,4),null);
  const gap=structuredClone(prices);gap[2][0]='2024-02-01';gap[3][0]='2024-02-02';
  assert.equal(M.pathOutcome(gap,0,3),null);
  const m=researchFixture(),a=M.relationship(m,m.prices.points.at(-1)[0],5,{kind:'risk'});
  assert.ok(a.events.every(e=>e.exitIndex-e.entryIndex===21 && e.outcome===e.realizedVol));
});
test('disjoint research windows do not share daily returns, while sparse bands remain missing', () => {
  const m=researchFixture(),asOf=m.prices.points.at(-1)[0],a=M.relationship(m,asOf,5,{sampling:'disjoint'});
  assert.ok(a.events.length<10);
  assert.ok(a.events.slice(1).every((e,i)=>e.entryIndex>=a.events[i].exitIndex));
  assert.equal(a.events.length,a.disjointCount);
  m.metrics.find(x=>x.id==='pe').points.at(-1)[1]=100;
  const b=M.relationship(m,asOf,5);
  assert.equal(b.matchedStats,null);
  assert.equal(b.bands[b.currentBand].count,undefined);
  assert.equal(M.relationship(m,asOf,5,{months:60}).events.length,0);
  assert.equal(M.relationship(m,asOf,5,{months:60}).fit,null);
});
test('regression reports descriptive fit only and does not manufacture a value for constant data', () => {
  const fit=M.regression([1,2,3,4].map(x=>({value:x,outcome:2*x+1})));
  assert.equal(fit.slope,2);assert.equal(fit.intercept,1);assert.equal(fit.r2,1);
  assert.equal(M.regression([1,1,1].map(x=>({value:x,outcome:x}))),null);
  assert.equal(M.regression([{value:1,outcome:2},{value:2,outcome:3}]),null);
});
test('PE identity, stale observations and unsupported return periods are rejected', () => {
  const m=researchFixture(),asOf=m.prices.points.at(-1)[0];
  for(const change of [{valuationBasis:'etf_pe'},{source:'jiucai-ndx'},{evidence:'published'},{vintage:'unknown'},{limitations:''}]){
    const c=structuredClone(m);Object.assign(c.metrics.find(x=>x.id==='pe'),change);
    assert.ok(M.relationship(c,asOf,5).error);
  }
  assert.ok(M.relationship(m,asOf,5,{months:1}).error);
  assert.ok(M.relationship(m,'2040-01-01',5).error);
  const c=structuredClone(m);c.prices.symbol='QQQ';assert.ok(M.relationship(c,asOf,5).error);
});
test('relationship CSV reproduces every plotted pair and its calculation basis', () => {
  const m=researchFixture(),a=M.relationship(m,m.prices.points.at(-1)[0],5),csv=M.relationshipCSV(m,a);
  assert.equal(csv.trim().split('\r\n').length,a.events.length+1);
  assert.ok(csv.includes('"aggregate_ttm","latest_available","monthly"'));
  assert.ok(csv.includes('"'+a.events[0].entryPrice+'","'+a.events[0].exitPrice+'"'));
  assert.ok(csv.includes('"price_index","USD","yahoo-spx"'));
});
