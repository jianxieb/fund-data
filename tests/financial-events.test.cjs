const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const F = require('../assets/financial-events-model.js');
const definitions = require('../data/financial-events.json');
const saved = require('../data/financial-events-history.json');

const event = {assetCodes:['A'],marketDate:'2026-02-28',eventDate:'2026-02-28',windowStart:'2026-02-26',windowEnd:null};
const row = {code:'A',currency:'USD',basis:'provider_adjusted_close',historyAsOf:'2026-03-06',series:[
  ['2026-02-26',90],['2026-02-27',100],['2026-03-02',110],['2026-03-03',80],['2026-03-04',100],['2026-03-05',105],['2026-03-06',120]
]};
test('weekend shock uses the preceding close and counts actual sessions without an off-by-one', () => {
  const out = F.outcomes(event,row);
  assert.equal(out.baseDate,'2026-02-27');
  assert.equal(out.results[0].end,'2026-03-02');
  assert.ok(Math.abs(out.results[0].value-10)<1e-9);
  assert.equal(out.results[1].end,'2026-03-06');
  assert.ok(Math.abs(out.results[1].value-20)<1e-9);
  assert.equal(out.results[4].value,null);
  assert.equal(out.results[4].reason,'未到第252个交易日');
});
test('reaction curve is normalized at the pre-event close, chapter curve at the opening close', () => {
  const reaction = F.study(event,[row],'reaction'), chapter = F.study(event,[row]);
  assert.equal(reaction.baseDate,'2026-02-27');
  assert.equal(reaction.rows[0].points.find(p=>p[0]==='2026-02-27')[1],0);
  assert.equal(chapter.baseDate,'2026-02-26');
  assert.equal(chapter.rows[0].points[0][1],0);
  assert.equal(reaction.incomplete,true);
  assert.equal(reaction.rows[0].annual,null);
  assert.ok(Math.abs(reaction.rows[0].mdd - (80/110-1)*100)<1e-9);
  assert.deepEqual(chapter.outcomes,reaction.outcomes);
});
test('missing prior close or a known source gap cannot produce an apparently complete outcome', () => {
  const truncated={...row,series:row.series.slice(2)};
  assert.equal(F.outcomes(event,truncated).results[0].reason,'缺事件前收盘');
  const gapped={...row,missingObservations:[{date:'2026-03-04',reason:'provider_null_or_invalid'}]};
  assert.equal(F.outcomes(event,gapped).results[1].value,null);
  assert.equal(F.study(event,[gapped]).rows[0].mdd,null);
  assert.throws(()=>F.study(event,[truncated]),/前收盘/);
});
test('invalid series, identity and return bases are rejected', () => {
  assert.throws(()=>F.study(event,[{...row,code:'B'}]),/标的不一致/);
  assert.throws(()=>F.study(event,[{...row,basis:'estimated'}]),/口径/);
  assert.throws(()=>F.study(event,[{...row,series:[...row.series,row.series.at(-1)]}]),/重复/);
});
test('drawdown retains a market peak even when another market has no observation on that day', () => {
  const a={...row,series:row.series.map(p=>p[0]==='2026-03-03'?[p[0],200]:p)};
  const b={...row,code:'B',currency:'CNY',basis:'price_index',series:row.series.filter(p=>p[0]!=='2026-03-03')};
  const out=F.study({...event,assetCodes:['A','B']},[a,b]);
  assert.equal(out.rows[0].mdd,-50);
  assert.ok(out.rows[0].points.some(p=>p[0]==='2026-03-03'));
});
test('all published chapters have consistent primary-source references and independently reproducible returns', () => {
  assert.equal(definitions.events.length,15);
  for (const e of definitions.events) {
    assert.ok(e.timeline.length>=2 && e.channels.length>=3 && e.watch.length>=2);
    e.timeline.forEach(t=>t.sources.forEach(s=>assert.match(definitions.sources[s].url,/^https:\/\//)));
    for (const mode of ['chapter','reaction','year']) {
      const study=F.study(e,saved.events[e.id],mode);
      assert.ok(study.start<study.end);
      for (const out of study.outcomes) for(const v of out.results) if(v.value!==null) {
        const raw=saved.events[e.id].find(r=>r.code===out.code).series;
        const start=raw.findIndex(p=>p[0]===v.start),end=start+v.days;
        assert.equal(raw[end][0],v.end);
        assert.ok(Math.abs(v.value-(raw[end][1]/raw[start][1]-1)*100)<1e-10);
      }
    }
  }
});
test('2026 unfinished outcomes and genuine index labels are preserved in the published snapshot', () => {
  const e=definitions.events.find(e=>e.id==='iran2026');
  assert.equal(e.ongoing,true);
  const result=F.study(e,saved.events[e.id],'year');
  if (result.end<'2027-02-01') assert.ok(result.outcomes.every(r=>r.results[4].value===null));
  assert.ok(saved.events.dotcom.every(r=>r.basis==='price_index'));
  assert.equal(saved.events.china2015.find(r=>r.code==='000001.SS').basis,'price_index');
  const crypto=require('node:crypto');
  assert.equal(saved.definitionsSha256,crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../data/financial-events.json'))).digest('hex'));
});
