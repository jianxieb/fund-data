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
async function renderPage({ symbol = 'BRK-B', hash = '#holding-period/' + symbol, corrupt = false, missing = false, historyNote = '', annual = true, fxGap = false, delayedCatalog = false, noBrowser = false } = {}) {
  const e = evidence(series('2019-01-01', '2026-10-13'), false, 'BRK-B');
  e.asset.historyNote = historyNote;
  const q = evidence(series('2019-01-01', '2026-10-13', (i, d, t) => 100 * 1.05 ** ((t - Date.parse('2019-01-01')) / DAY / YEAR)), false, 'QQQ');
  q.asset.kind = 'etf';
  const f = evidence(series('2019-01-01', '2026-10-13', () => 7).filter(([d]) => !fxGap || d < '2025-06-01' || d > '2025-07-01'), true);
  const catalog = { schemaVersion: 1, assets: [e.asset, q.asset], fx: f.asset }, events = {}, calls = [], downloads = [], replacements = [];
  const context = { symbol, annual, setAnnual(value) { context.annual = value; context.render(); }, modalTitle: (a, b) => `<h2>${a}</h2><p>${b}</p>`, openModal: html => calls.push(html), download(...args) { downloads.push(args); }, render() { html = sandbox.window.ChanghengHoldingPeriod.view(context); } };
  let html = '';
  const pageLocation = { hash }, pageHistory = { state: { untouched: true }, replaceState(value, title, url) { replacements.push({ value, title, url }); pageLocation.hash = url; } };
  const sandbox = { window: { ChanghengHoldingPeriodModel: M, ...(delayedCatalog ? {} : { PORTFOLIO_CATALOG: catalog }) }, crypto: webcrypto, TextEncoder, URLSearchParams,
    document: { addEventListener: (name, callback) => { events[name] = callback; }, querySelector: () => null, createElement: () => ({}), head: { append(script) { setTimeout(() => { sandbox.window.PORTFOLIO_CATALOG = catalog; script.onload(); }, 5); } } },
    fetch: async url => ({ ok: !missing, status: missing ? 404 : 200, text: async () => JSON.stringify(url === f.asset.historyUrl ? f.history : url === q.asset.historyUrl ? q.history : corrupt ? { ...e.history, asOf: '2020-01-01' } : e.history) }) };
  if (!noBrowser) { sandbox.location = sandbox.window.location = pageLocation; sandbox.history = sandbox.window.history = pageHistory; }
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/holding-period.js'), 'utf8'), sandbox);
  context.render();
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5));
  return { get html() { return html; }, events, calls, context, sandbox, downloads, replacements };
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
test('annual and total summaries rank actual observations independently, rather than converting a median', () => {
  const sample = (annualReturn, actualYears) => ({ annualReturn, actualYears, totalReturn: (Math.pow(1 + annualReturn / 100, actualYears) - 1) * 100 });
  const a = sample(10, 1.995), b = sample(9.99, 2.005);
  const annual = M.summarize([a, b], a, true), total = M.summarize([a, b], a, false);
  assert.equal(annual.best, a); assert.equal(total.best, b);
  assert.equal(annual.worst, b); assert.equal(total.worst, a);
  near(total.median, (a.totalReturn + b.totalReturn) / 2);
  assert.ok(Math.abs(total.median - ((1 + annual.median / 100) ** 2 - 1) * 100) > .00001);
  assert.equal(annual.latestRank, 75); assert.equal(total.latestRank, 25);
  const e = evidence(series()), study = M.analyze({ ...e, annual: false });
  for (const p of study.periods) {
    near(p.median, M.quantile(p.samples.map(s => s.totalReturn).sort((a, b) => a - b), .5));
    near(p.worst.totalReturn, Math.min(...p.samples.map(s => s.totalReturn)));
  }
});
function riskFixture(values, dates = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08', '2024-01-09']) {
  const prices = values.map((v, i) => [dates[i], v]);
  return { study: { prices, currency: 'USD', fx: null }, sample: { startPrice: values[0], startIndex: 0, endIndex: values.length - 1 } };
}
test('positive terminal wealth can contain both a deep peak drawdown and a separate principal loss', () => {
  const { study, sample } = riskFixture([100, 140, 80, 90, 110, 130, 120]);
  const risk = M.pathRisk(study, sample);
  assert.equal(risk.available, true);
  near(risk.maxDrawdown, (80 / 140 - 1) * 100);
  assert.equal(risk.drawdownPeak, '2024-01-02'); assert.equal(risk.drawdownTrough, '2024-01-03');
  near(risk.minimumReturn, -20); assert.equal(risk.minimumDate, '2024-01-03');
  assert.deepEqual(risk.longestUnderwater, { start: '2024-01-03', end: '2024-01-05', days: 2, observations: 2, recovered: true });
  assert.equal(risk.endingUnderwater, null);
});
test('peak drawdown does not imply principal loss; flat wealth has no fabricated recovery duration', () => {
  for (const values of [[100, 140, 110], [100, 100, 100]]) {
    const { study, sample } = riskFixture(values), risk = M.pathRisk(study, sample);
    assert.equal(risk.minimumReturn, 0); assert.equal(risk.longestUnderwater, null); assert.equal(risk.endingUnderwater, null);
    near(risk.maxDrawdown, values[1] === 140 ? (110 / 140 - 1) * 100 : 0);
  }
});
test('underwater durations use calendar dates and preserve unresolved endpoint episodes', () => {
  const { study, sample } = riskFixture([100, 90, 80, 100, 95, 98, 90]);
  const risk = M.pathRisk(study, sample);
  assert.equal(risk.underwaterEpisodes, 2);
  assert.deepEqual(risk.longestUnderwater, { start: '2024-01-05', end: '2024-01-09', days: 4, observations: 3, recovered: false });
  assert.equal(risk.longestUnderwater, risk.endingUnderwater);
  const oneDay = riskFixture([100, 110, 90]), last = M.pathRisk(oneDay.study, oneDay.sample);
  assert.equal(last.endingUnderwater.days, 0); assert.equal(last.endingUnderwater.observations, 1); assert.equal(last.endingUnderwater.recovered, false);
  const laterShorter = riskFixture([100, 90, 80, 95, 100, 110, 90]), shorter = M.pathRisk(laterShorter.study, laterShorter.sample);
  assert.equal(shorter.longestUnderwater.recovered, true); assert.equal(shorter.endingUnderwater.recovered, false);
  assert.equal(shorter.longestUnderwater.days, 3);
});
test('a single missing intermediate CNY valuation pauses all risk metrics while keeping endpoint returns', () => {
  const e = evidence(series()), f = evidence(series('2010-01-01', '2026-10-13', () => 7).filter(([d]) => d < '2017-06-01' || d > '2017-07-01'), true);
  const study = M.analyze({ ...e, fxAsset: f.asset, fxHistory: f.history, currency: 'CNY' });
  const sample = study.periods[0].samples.find(s => s.start === '2017-01-31'), risk = M.pathRisk(study, sample);
  assert.ok(Number.isFinite(sample.totalReturn)); assert.equal(risk.available, false);
  assert.match(risk.reason, /美元兑人民币汇率/); assert.ok(risk.missingDates.includes('2017-06-08'));
  for (const key of ['maxDrawdown', 'minimumReturn', 'longestUnderwater']) assert.equal(risk[key], undefined);
  const dollar = M.analyze(e), same = dollar.periods[0].samples.find(s => s.start === sample.start);
  assert.equal(M.pathRisk(dollar, same).available, true);
});
test('published Berkshire positive two-year result still exposes its 2008-2009 holding pressure', () => {
  const box = {}; vm.createContext(box); vm.runInContext(fs.readFileSync(path.join(__dirname, '../data/portfolio/catalog.js'), 'utf8'), box);
  const asset = box.PORTFOLIO_CATALOG.assets.find(a => a.id === 'stock:BRK-B'), history = JSON.parse(fs.readFileSync(path.join(__dirname, '..', asset.historyUrl)));
  const study = M.analyze({ asset, history }), sample = study.periods[1].samples.find(s => s.start === '2008-07-31'), risk = M.pathRisk(study, sample);
  assert.ok(sample.totalReturn > 2 && sample.totalReturn < 2.02);
  near(risk.maxDrawdown, -50.53763440860215, 1e-7);
  near(risk.minimumReturn, -39.932098589583894, 1e-7);
  assert.ok(risk.longestUnderwater.days > 365);
  assert.equal(risk.longestUnderwater.recovered, true);
});
test('CSV records selected return basis and risk availability without substituting zero for missing risk', () => {
  const e = evidence(series()), f = evidence(series('2010-01-01', '2026-10-13', () => 7).filter(([d]) => d < '2017-06-01' || d > '2017-07-01'), true);
  for (const annual of [true, false]) {
    const study = M.analyze({ ...e, annual, currency: 'CNY', fxAsset: f.asset, fxHistory: f.history });
    const rows = M.toCSV(study, 1).replace(/^\ufeff/, '').split('\r\n').map(line => line.slice(1, -1).split('","'));
    const headers = rows[0], field = (row, key) => row[headers.indexOf(key)], row = rows.find(row => field(row, '买入收盘日') === '2017-01-31');
    assert.equal(field(row, '当前展示口径'), annual ? '年化' : '累计');
    assert.equal(field(row, '当前展示收益%'), field(row, annual ? '实际天数年化收益%' : '累计收益%'));
    assert.match(field(row, '路径风险状态'), /美元兑人民币汇率/);
    assert.equal(field(row, '最大收盘回撤%'), ''); assert.equal(field(row, '最长低于本金日历天数'), '');
    assert.ok(field(row, '风险缺失日期').includes('2017-06-08'));
  }
});
function click(page, hp, value) { page.events.click({ target: { closest: () => ({ dataset: { hp, value } }) } }); }
test('return-basis controls call shared preference setter and update chart, summary and CSV together', async () => {
  const page = await renderPage();
  click(page, 'basis', 'total');
  assert.equal(page.context.annual, false);
  assert.ok(page.html.includes('最近2年累计') && page.html.includes('历史窗口累计中位') && page.html.includes('累计收益（%）'));
  const actualYears = (Date.parse('2026-10-13') - Date.parse('2024-10-11')) / DAY / YEAR;
  assert.ok(page.html.includes('+' + ((1.08 ** actualYears - 1) * 100).toFixed(2) + '%'));
  click(page, 'csv', '');
  assert.match(page.downloads.at(-1)[0], /累计/);
  assert.ok(page.downloads.at(-1)[1].includes('"累计","'));
  click(page, 'window', '2:latest');
  assert.ok(page.calls.at(-1).includes('最大收盘回撤') && page.calls.at(-1).includes('相对初始金额最深亏损'));
  click(page, 'basis', 'annual');
  assert.equal(page.context.annual, true); assert.ok(page.html.includes('最近2年年化') && page.html.includes('年化收益（%）'));
});
test('window details state the exact missing intermediate FX dates and suppress risk numbers', async () => {
  const page = await renderPage({ fxGap: true }); click(page, 'currency', 'CNY');
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5));
  click(page, 'window', '2:latest');
  const detail = page.calls.at(-1);
  assert.ok(detail.includes('累计收益') && detail.includes('路径风险暂停计算'));
  assert.ok(detail.includes('2025-06-09'));
  assert.ok(!detail.includes('hp-risk-grid'));
});
test('asset, currency and horizon round-trip through a canonical URL without adding history entries', async () => {
  const page = await renderPage();
  assert.equal(page.sandbox.location.hash, '#holding-period?symbol=BRK-B&currency=USD&years=2');
  click(page, 'years', '5'); click(page, 'currency', 'CNY');
  page.events.change({ target: { matches: selector => selector === '[data-hp-select="asset"]', value: 'QQQ' } });
  await new Promise(resolve => setTimeout(resolve, 100));
  const shared = '#holding-period?symbol=QQQ&currency=CNY&years=5';
  assert.equal(page.sandbox.location.hash, shared);
  assert.ok(page.html.includes('QQQ') && page.html.includes('人民币，含汇率变化') && page.html.includes('最近5年年化'));
  assert.equal(page.replacements.length, 4);
  for (const replacement of page.replacements) assert.deepEqual(replacement.value, { untouched: true });
  const restored = await renderPage({ hash: shared });
  assert.equal(restored.html, page.html);
  assert.equal(restored.replacements.length, 0);
  const beforeBasis = page.replacements.length;
  click(page, 'basis', 'total');
  assert.equal(page.sandbox.location.hash, shared);
  assert.equal(page.replacements.length, beforeBasis);
  assert.ok(page.html.includes('最近5年累计'));
  click(page, 'csv', '');
  assert.equal(page.downloads.at(-1)[0], 'QQQ-CNY-5年持有窗口-累计.csv');
});
test('query and legacy path links restore after asynchronous catalog loading, with query symbol taking priority', async () => {
  for (const [hash, currency, years] of [
    ['#holding-period/QQQ', 'USD', 2],
    ['#holding-period?symbol=QQQ', 'USD', 2],
    ['#holding-period/QQQ?currency=CNY&years=3', 'CNY', 3],
    ['#holding-period/BRK-B?symbol=qqq&currency=cny&years=1', 'CNY', 1]
  ]) {
    const page = await renderPage({ hash, delayedCatalog: true });
    assert.equal(page.sandbox.location.hash, `#holding-period?symbol=QQQ&currency=${currency}&years=${years}`);
    assert.ok(page.html.includes(`最近${years}年年化`) && page.html.includes('data-hp-plot'));
    assert.ok(page.html.includes(currency === 'CNY' ? '人民币，含汇率变化' : '美元 · 行情'));
  }
});
test('invalid route parameters use valid defaults without replacing an unavailable security', async () => {
  const invalid = await renderPage({ hash: '#holding-period?symbol=%5EGSPC&currency=HKD&years=99&annual=false' });
  assert.equal(invalid.sandbox.location.hash, '#holding-period?symbol=%5EGSPC&currency=USD&years=2');
  assert.ok(invalid.html.includes('^GSPC 尚未收录') && invalid.html.includes('不使用其他产品替代'));
  assert.ok(!invalid.html.includes('hp-identity'));
  const valid = await renderPage({ hash: '#holding-period?symbol=QQQ&currency=invalid&years=5e0&annual=false' });
  assert.equal(valid.sandbox.location.hash, '#holding-period?symbol=QQQ&currency=USD&years=2');
  assert.ok(valid.html.includes('最近2年年化'));
  valid.sandbox.location.hash = '#holding-period?symbol=BRK-B&currency=CNY&years=3';
  valid.context.render();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(valid.html.includes('最近3年年化') && valid.html.includes('人民币，含汇率变化'));
  const empty = await renderPage({ hash: '#holding-period?symbol=&currency=&years=' });
  assert.equal(empty.sandbox.location.hash, '#holding-period?symbol=BRK-B&currency=USD&years=2');
});
test('standalone rendering and controls do not require browser location or history', async () => {
  const page = await renderPage({ noBrowser: true });
  assert.ok(page.html.includes('最近2年年化'));
  click(page, 'years', '3');
  page.events.change({ target: { matches: () => true, value: 'QQQ' } });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(page.html.includes('最近3年年化') && page.html.includes('QQQ'));
  assert.equal(page.replacements.length, 0);
});
