// Render the local portfolio viewport, including the sidebar and native scrollbar gutter.
// Requires Chrome and a running local site. Example:
// node scripts/capture_portfolio_layout.mjs --out /tmp/portfolio.png
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: {
  out: { type: 'string' }, viewport: { type: 'string', default: '2540x1309' }, dpr: { type: 'string', default: '2' },
  origin: { type: 'string', default: 'http://127.0.0.1:8765' }, chrome: { type: 'string' }, draft: { type: 'string' },
  results: { type: 'boolean' }, help: { type: 'boolean' }
} });
if (o.help || !o.out) {
  console.log('Usage: node scripts/capture_portfolio_layout.mjs --out FILE.png [--viewport 2540x1309] [--dpr 2] [--origin http://127.0.0.1:8765] [--chrome PATH] [--draft FILE.json] [--results]');
  process.exit(o.help ? 0 : 1);
}
const match = /^(\d+)x(\d+)$/.exec(o.viewport), width = Number(match?.[1]), height = Number(match?.[2]), dpr = Number(o.dpr);
if (!width || !height || !(dpr > 0 && dpr <= 4) || !/\.png$/i.test(o.out)) throw new Error('Expected a positive viewport, DPR up to 4, and .png output');
const url = new URL('/#portfolio', o.origin);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Use a local HTTP server');
const draft = o.draft ? JSON.parse(await readFile(o.draft, 'utf8')) : {
  // Reference screenshot: only these first two rows receive principal. The other four are display-only fixture rows.
  positions: ['USD', 'TQQQ', 'QQQ', 'SPY', 'SOXX', 'VOO'].map((symbol, i) => ({ id: 'us:' + symbol, weight: i < 2 ? 30 : 0 })),
  initial: 100000, monthly: 8000, currency: 'CNY', initialMethod: 'lump_sum', contributionMethod: 'dca_month',
  rebalance: 'none', years: 'common', benchmarkId: '', transactionFee: 0, tax: {}, dividendPolicy: 'reinvest'
};
await fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => { if (!r.ok) throw new Error('Local site returned ' + r.status); });
const profile = await mkdtemp(join(tmpdir(), 'fund-portfolio-preview-'));
const chrome = spawn(o.chrome || process.env.CHROME_BIN || (process.platform === 'darwin' ?
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'),
['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-default-apps',
  '--disable-features=OverlayScrollbar', '--user-data-dir=' + profile, '--remote-debugging-pipe', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const ended = new Promise(done => { chrome.once('close', done); }); let seq = 0, incoming = '';
const pending = new Map();
function failAll(e) { for (const job of pending.values()) job.reject(e); pending.clear(); }
chrome.on('error', failAll);
chrome.on('exit', () => failAll(new Error('Chrome exited during capture')));
chrome.stdio[3].on('error', failAll);
chrome.stdio[4].setEncoding('utf8').on('data', chunk => {
  incoming += chunk;
  for (let end; (end = incoming.indexOf('\0')) !== -1;) {
    const d = JSON.parse(incoming.slice(0, end)); incoming = incoming.slice(end + 1);
    const job = pending.get(d.id); if (!job) continue;
    pending.delete(d.id); if (d.error) job.reject(new Error(d.error.message)); else job.resolve(d.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ method, params, id, sessionId }) + '\0');
  });
}
const timer = setTimeout(() => failAll(new Error('Capture timed out; verify the local site and Chrome executable')), 45000);
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const js = async expression => {
    const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:dpr, mobile:false });
  await page('Page.enable');
  await page('Page.addScriptToEvaluateOnNewDocument', { source:
    'if (location.origin === ' + JSON.stringify(url.origin) + ') localStorage.setItem("changheng.portfolio.v1",' + JSON.stringify(JSON.stringify(draft)) + ')' });
  await page('Page.navigate', { url: url.href });
  const ready = selector => js('new Promise(done => { const ready=()=>document.querySelector(' + JSON.stringify(selector) + ') ? done(true) : requestAnimationFrame(ready);ready(); })');
  await ready('#portfolio-panel-settings #portfolio-initialMethod');
  if (o.results) {
    await js('document.querySelector("[data-action=portfolio-run]").click()');
    await ready('#portfolio-panel-results [data-chart-rail]');
  }
  await js('document.fonts.ready.then(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)))))');
  const geometry = await js(`(()=>{const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r&&[r.x,r.y,r.width,r.height]};
    return { viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,layoutWidth:document.body.getBoundingClientRect().width,
      sidebar:box('.sidebar'),topbar:box('.topbar'),workspace:box('#portfolio-workspace'),firstCard:box('#portfolio-workspace .card') };})()`);
  const { data } = await page('Page.captureScreenshot', { format:'png', fromSurface:true, captureBeyondViewport:false });
  const png = Buffer.from(data, 'base64'), pixelSize = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (pixelSize[0] !== Math.round(width*dpr) || pixelSize[1] !== Math.round(height*dpr)) throw new Error('Unexpected PNG dimensions: ' + pixelSize);
  if (!o.results && !o.draft && width === 2540 && height === 1309 && dpr === 2) {
    // Reference anchors exclude the native window border.
    const anchors = { layoutWidth:[geometry.layoutWidth,2525], sidebarWidth:[geometry.sidebar?.[2],212],
      headerHeight:[geometry.topbar?.[3],72], cardLeft:[geometry.firstCard?.[0],651.5],
      cardTop:[geometry.firstCard?.[1],305.5], cardWidth:[geometry.firstCard?.[2],1434] };
    for (const [name,[actual,expected]] of Object.entries(anchors)) {
      if (!Number.isFinite(actual) || Math.abs(actual-expected) > 1) throw new Error(name + ': expected ' + expected + ' ±1 CSS px, received ' + actual);
    }
  }
  await writeFile(o.out, png);
  console.log(JSON.stringify({ output:resolve(o.out), pixelSize, ...geometry }, null, 2));
} finally {
  clearTimeout(timer); chrome.kill(); await ended;
  await rm(profile, { recursive:true, force:true, maxRetries:3 });
}
