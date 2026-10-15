const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const M = require('../assets/holding-period-model.js');
const P = require('../assets/portfolio-model.js');
const DAY = 86400000, YEAR = 365.2425;
function series(start = '2010-01-01', end = '2026-10-13', value = (i, d, t) => 100 * 1.08 ** ((t - Date.parse(start)) / DAY / YEAR)) {
  const rows = [];
  for (let t = Date.parse(start), i = 0; t <= Date.parse(end); t += DAY) {
    const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    rows.push([d.toISOString().slice(0, 10), value(i++, d, t)]);
  }
  return rows;
}
function evidence(rows, fx = false, name = 'TEST') {
  const id = fx ? 'fx:CNY' : 'stock:' + name, currency = fx ? 'CNY' : 'USD';
  const asset = { id, code: fx ? 'CNY=X' : name, name: fx ? '美元兑人民币' : name, kind: 'stock', market: 'us', currency, status: 'available',
    first: rows[0][0], asOf: rows.at(-1)[0], observations: rows.length, historyUrl: 'data/portfolio/' + (fx ? 'fx' : 'stock') + '/' + name + '.json', sourceUrl: 'https://example.com/' + name };
  const history = { schemaVersion: 1, id, currency, basis: 'provider_adjusted_close', dividends: 'reinvested', first: asset.first, asOf: asset.asOf, series: rows, sourceUrl: asset.sourceUrl };
  asset.sha256 = createHash('sha256').update(JSON.stringify(history)).digest('hex');
  return { asset, history };
}
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
test('only real overseas stock and ETF identities are eligible; malformed histories are rejected', () => {
  const e = evidence(series());
  assert.deepEqual(M.eligibleAssets({ assets: [e.asset, { ...e.asset, kind: 'index' }, { ...e.asset, currency: 'CNY' }] }), [e.asset]);
  for (const change of [{ id: 'stock:OTHER' }, { currency: 'CNY' }, { dividends: 'excluded' }, { basis: 'price_index' }]) {
    assert.throws(() => M.analyze({ ...e, history: { ...e.history, ...change } }));
  }
  assert.throws(() => M.analyze({ ...e, asset: { ...e.asset, asOf: '2026-10-12' } }), /目录与历史日期/);
  assert.throws(() => M.analyze({ ...e, asset: { ...e.asset, kind: 'index' } }), /自身美元历史/);
  assert.throws(() => M.analyze({ ...e, currency: 'HKD' }), /币种/);
  assert.throws(() => M.analyze({ ...e, asOf: '2025-02-30' }), /截至日期/);
});
test('monthly samples use actual month-end and completed calendar anniversaries; latest is separate', () => {
  const e = evidence(series()), study = M.analyze(e);
  for (const p of study.periods) {
    assert.ok(p.samples.length > 0);
    for (const s of p.samples) {
      assert.equal(s.targetEnd, P.addYears(s.start, p.years));
      assert.ok(s.targetEnd <= study.asOf);
      const next = e.history.series[s.startIndex + 1];
      assert.ok(!next || next[0].slice(0, 7) !== s.start.slice(0, 7));
      assert.ok(s.end <= s.targetEnd);
      assert.ok((Date.parse(s.targetEnd) - Date.parse(s.end)) / DAY <= 7);
      near(s.annualReturn, 8);
    }
    assert.ok(!p.samples.some(s => s.start === p.latest.start));
    assert.equal(p.count, p.samples.length);
  }
});
test('leap-day anniversaries clamp to February and select the prior actual close', () => {
  const e = evidence(series('2019-01-01', '2026-10-13'));
  const p = M.analyze(e).periods[0], s = p.samples.find(s => s.start === '2024-02-29');
  assert.equal(s.targetEnd, '2025-02-28');
  assert.equal(s.end, '2025-02-28');
  const weekend = p.samples.find(s => s.start === '2021-01-29');
  assert.equal(weekend.targetEnd, '2022-01-29');
  assert.equal(weekend.end, '2022-01-28');
});
test('future observations cannot change a fixed historical study', () => {
  const early = evidence(series('2010-01-01', '2024-06-28'));
  const later = evidence(series('2010-01-01', '2026-10-13', (i, d, t) => t > Date.parse('2024-06-28') ? 100000 : 100 * 1.08 ** ((t - Date.parse('2010-01-01')) / DAY / YEAR)));
  const a = M.analyze({ ...early, asOf: '2024-06-28' }), b = M.analyze({ ...later, asOf: '2024-06-28' });
  assert.deepEqual(a.periods, b.periods);
});
test('insufficient history leaves long periods empty without replacing them by since-inception returns', () => {
  const e = evidence(series('2025-01-01', '2026-10-13'));
  const study = M.analyze(e);
  assert.ok(study.periods[0].count > 0);
  for (const p of study.periods.slice(1)) {
    assert.equal(p.count, 0); assert.equal(p.median, null); assert.equal(p.lossShare, null); assert.equal(p.latest, null);
    assert.match(p.latestMissing, /自身行情不足/);
  }
});
test('the latest one-year window does not accept an inception later than its anniversary', () => {
  const study = M.analyze(evidence(series('2025-10-14', '2026-10-13')));
  assert.equal(study.periods[0].latest, null);
  assert.equal(study.periods[0].count, 0);
});
test('price gaps exclude affected complete windows and preserve unaffected windows', () => {
  const rows = series().filter(([d]) => d < '2018-05-01' || d > '2018-06-01');
  const p = M.analyze(evidence(rows)).periods[0];
  assert.ok(p.count > 100);
  assert.ok(p.excluded['期间股价有超过14天的历史缺口'] > 0);
  assert.ok(p.samples.every(s => !(s.start < '2018-05-01' && s.end > '2018-06-01')));
});
test('CNY uses actual backward FX endpoint observations and correct multiplication direction', () => {
  const e = evidence(series('2010-01-01', '2026-10-13', () => 100));
  const f = evidence(series('2010-01-01', '2026-10-13', (i) => 8 - i / 10000), true);
  const study = M.analyze({ ...e, fxAsset: f.asset, fxHistory: f.history, currency: 'CNY' });
  for (const p of study.periods) for (const s of p.samples) {
    assert.ok(s.fxStart <= s.start && s.fxEnd <= s.end);
    near(s.totalReturn, (s.endFx / s.startFx - 1) * 100);
    assert.ok(s.totalReturn < 0);
  }
  assert.equal(study.periods[0].lossShare, 100);
  assert.equal(M.analyze(e).periods[0].lossShare, 0);
});
test('FX endpoint gaps only exclude affected samples; missing early FX never supplies future rates', () => {
  const e = evidence(series()), f = evidence(series('2015-01-01', '2026-10-13', () => 7), true);
  const study = M.analyze({ ...e, fxAsset: f.asset, fxHistory: f.history, currency: 'CNY' }), p = study.periods[0];
  assert.ok(p.count > 0 && p.count < M.analyze(e).periods[0].count);
  assert.ok(p.samples.every(s => s.start >= '2015-01-01'));
  assert.ok(p.excluded['缺少端点7天内的美元兑人民币汇率'] > 0);
  const ended = evidence(series('2015-01-01', '2026-09-01', () => 7), true);
  const oldFx = M.analyze({ ...e, fxAsset: ended.asset, fxHistory: ended.history, currency: 'CNY' });
  assert.equal(oldFx.asOf, '2026-10-13');
  assert.equal(oldFx.periods[0].latest, null);
  assert.match(oldFx.periods[0].latestMissing, /缺少端点/);
  assert.ok(oldFx.periods[0].count > 0);
});
test('flat returns have zero loss share, tied current rank 50%, and true zero percentiles', () => {
  const p = M.analyze(evidence(series('2010-01-01', '2026-10-13', () => 100))).periods[0];
  assert.equal(p.lossShare, 0); assert.equal(p.median, 0); assert.equal(p.p10, 0); assert.equal(p.p90, 0); assert.equal(p.latestRank, 50);
  assert.equal(M.quantile([0, 10], .1), 1);
  assert.equal(M.quantile([], .5), null);
});
test('sample paths reconcile to total returns; intermediate missing FX is a gap, not interpolation', () => {
  const e = evidence(series()), fxRows = series('2010-01-01', '2026-10-13', () => 7).filter(([d]) => d < '2017-06-01' || d > '2017-07-01');
  const f = evidence(fxRows, true), study = M.analyze({ ...e, fxAsset: f.asset, fxHistory: f.history, currency: 'CNY' });
  const s = study.periods[0].samples.find(s => s.start === '2017-01-31'), points = M.windowPath(study, s);
  assert.equal(points[0][1], 100); near(points.at(-1)[1], 100 + s.totalReturn);
  assert.ok(points.some(([d, v]) => d >= '2017-06-09' && d <= '2017-07-01' && v === null));
});
test('export has every actual sample at full precision, explicit basis and FX dates', () => {
  const e = evidence(series()), f = evidence(series('2010-01-01', '2026-10-13', () => 7), true);
  const study = M.analyze({ ...e, fxAsset: f.asset, fxHistory: f.history, currency: 'CNY' }), p = study.periods[1], csv = M.toCSV(study, 2);
  const rows = csv.replace(/^\ufeff/, '').split('\r\n').map(line => line.slice(1, -1).split('","'));
  assert.equal(rows.length, p.count + 1);
  for (const row of rows.slice(1)) {
    const ratio = Number(row[10]) / Number(row[9]) * Number(row[14]) / Number(row[13]);
    near(Number(row[15]), (ratio - 1) * 100);
    near(Number(row[16]), (ratio ** (1 / Number(row[8])) - 1) * 100);
    assert.equal(row[18], 'provider_adjusted_close');
    assert.equal(row[20], '未扣');
    assert.equal(row[21], '重叠的历史月末窗口');
  }
});
test('published Berkshire and FX histories produce independently reproducible latest and monthly returns', () => {
  const sandbox = {}; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../data/portfolio/catalog.js'), 'utf8'), sandbox);
  const catalog = sandbox.PORTFOLIO_CATALOG, asset = catalog.assets.find(a => a.id === 'stock:BRK-B');
  const history = JSON.parse(fs.readFileSync(path.join(__dirname, '..', asset.historyUrl))), fxHistory = JSON.parse(fs.readFileSync(path.join(__dirname, '..', catalog.fx.historyUrl)));
  for (const currency of ['USD', 'CNY']) {
    const study = M.analyze({ asset, history, currency, fxAsset: catalog.fx, fxHistory });
    const p = study.periods.find(p => p.years === 2);
    assert.ok(p.count > 150);
    near(p.latest.totalReturn, (p.latest.endPrice / p.latest.startPrice * (currency === 'CNY' ? p.latest.endFx / p.latest.startFx : 1) - 1) * 100);
    assert.ok(p.samples.every(s => s.end <= asset.asOf));
  }
});
async function renderPage({ symbol = 'BRK-B', corrupt = false, missing = false, historyNote = '' } = {}) {
  const e = evidence(series('2019-01-01', '2026-10-13'), false, 'BRK-B');
  e.asset.historyNote = historyNote;
  const catalog = { schemaVersion: 1, assets: [e.asset] }, events = {}, calls = [];
  const context = { symbol, modalTitle: (a, b) => `<h2>${a}</h2><p>${b}</p>`, openModal: html => calls.push(html), download() {}, render() { html = sandbox.window.ChanghengHoldingPeriod.view(context); } };
  let html = '';
  const sandbox = { window: { ChanghengHoldingPeriodModel: M, PORTFOLIO_CATALOG: catalog }, location: { hash: '#holding-period/' + symbol }, crypto: webcrypto, TextEncoder,
    document: { addEventListener: (name, callback) => { events[name] = callback; }, querySelector: () => null },
    fetch: async () => ({ ok: !missing, status: missing ? 404 : 200, text: async () => JSON.stringify(corrupt ? { ...e.history, asOf: '2020-01-01' } : e.history) }) };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/holding-period.js'), 'utf8'), sandbox);
  context.render();
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5));
  return { html, events, calls, context, sandbox };
}
test('page renders a readable curve, periods, sample table and true missing states', async () => {
  const ok = await renderPage();
  assert.ok(ok.html.includes('data-hp-plot'));
  assert.ok(ok.html.includes('最近2年年化'));
  assert.ok(ok.html.includes('历史亏损月份占比不是未来亏损概率'));
  assert.ok(ok.html.includes('自身行情不足10年'));
  assert.ok(!ok.html.includes('NaN') && !ok.html.includes('undefined'));
  const changedStrategy = await renderPage({ historyNote: '较早回报包含旧成长策略' });
  assert.ok(changedStrategy.html.includes('较早回报包含旧成长策略'));
  const unavailable = await renderPage({ symbol: '^GSPC' });
  assert.ok(unavailable.html.includes('不使用其他产品替代'));
  const failed = await renderPage({ missing: true });
  assert.ok(failed.html.includes('历史请求失败（404）'));
  const corrupted = await renderPage({ corrupt: true });
  assert.ok(corrupted.html.includes('校验不一致'));
});
