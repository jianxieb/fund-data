const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../assets/portfolio-score-view.js');

function fixture() {
  const summary = (id, n, median) => ({ id, n, median, positiveRate: 66.67, worstReturn: -12.5, worstDrawdown: -23.4, nonOverlappingN: 3 });
  return {
    status: 'available', end: '2026-10-23', historical: false,
    scoring: {
      version: 'add-score-v1', value: 65, raw: 65,
      band: { id: 'small', label: '小额分批候选', action: '可按原定计划分批观察加仓。' },
      components: [
        { id: 'location', label: '长期位置', points: 25, max: 40, detail: '相对200日均线的历史分位。' },
        { id: 'trend', label: '趋势确认', points: 30, max: 40, detail: '价格在200日均线上方。' },
        { id: 'stability', label: '波动稳定', points: 10, max: 20, detail: '63日波动率处于历史中段。' }
      ],
      gate: { active: false }, change20: { value: 5, day: '2026-09-23', previous: 60 },
      history: [
        { day: '2020-01-02', value: 39, band: 'wait', gateActive: true },
        { day: '2020-01-03', value: 40, band: 'watch', gateActive: false },
        { day: '2026-10-23', value: 65, band: 'small', gateActive: false }
      ],
      evidence: {
        validation: 'descriptive',
        assessment: { status: 'favorable', label: '历史对照暂有支持', detail: '高分组收益较高，仍需后续观察。', high: summary('high', 40, 12), low: summary('low', 38, 9), medianDifference: 3 },
        horizons: [1, 3].map(years => ({ years, baseline: summary('baseline', 78, 10), bands: [summary('wait', 18, 8), summary('watch', 20, 9), summary('small', 40, 12), summary('priority', 0, null)] }))
      }
    }
  };
}
function mainValue(html) {
  return html.match(/class="portfolio-score-value[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>/)?.[1];
}

test('withdrawn rule calculations remain collapsed for audit even when retrospective evidence is favorable', () => {
  const html = V.render(fixture());
  assert.equal(mainValue(html), '65');
  assert.match(html, /截至 2026-10-23 共同收盘 · add-score-v1/);
  assert.match(html, /较20个共同交易日前 \+5 分/);
  assert.match(html, /2026-09-23 · 60 分/);
  assert.equal((html.match(/role="meter"/g) || []).length, 3);
  assert.match(html, /aria-valuemax="40" aria-valuenow="25"/);
  assert.match(html, /aria-valuemax="20" aria-valuenow="10"/);
  assert.match(html, /价格在200日均线上方。/);
  assert.match(html, /已撤回 · 不用于加仓决策/);
  assert.match(html, /<details class="portfolio-score-audit"><summary>已撤回规则的历史记录/);
  assert.match(html, /当前没有通过验证的加仓评分/);
  assert.doesNotMatch(html.split('<details')[0], /65|\/ 100/);
  assert.doesNotMatch(html, /小额分批候选|优先分批候选|暂缓额外加仓|可按原定计划分批观察加仓。/);
  assert.match(html, /旧规则高分组回溯收益较高，仍未经验证/);
});

test('four exact score bands are stable at every integer boundary', () => {
  for (const [value, id] of [[0,'wait'],[39,'wait'],[40,'watch'],[59,'watch'],[60,'small'],[79,'small'],[80,'priority'],[100,'priority']]) {
    const timing = fixture(); timing.scoring.value = value; timing.scoring.band = null;
    const html = V.render(timing);
    assert.equal(mainValue(html), String(value));
    assert.match(html, new RegExp('class="' + id + ' active" aria-current="true"'));
    for (const range of ['0–39', '40–59', '60–79', '80–100']) assert.ok(html.includes('<strong>' + range + '</strong>'));
    assert.equal((html.match(/aria-current="true"/g) || []).length, 1);
  }
});

test('unsupported and insufficient evidence stay visible and suppress actionable score copy', () => {
  for (const status of ['insufficient', 'not_supported', 'mixed']) {
    const timing = fixture(); timing.scoring.evidence.assessment.status = status;
    timing.scoring.evidence.assessment.label = '历史对照尚未支持';
    const html = V.render(timing), beforeDetails = html.split('<details')[0];
    assert.equal(mainValue(html), '65');
    assert.match(beforeDetails, /当前没有通过验证的加仓评分/);
    assert.doesNotMatch(beforeDetails, /65|\/ 100/);
    assert.match(beforeDetails, /不能据此恢复加仓指引/);
    assert.match(beforeDetails, /≥60 分后一年中位收益 <strong>12.00%/);
    assert.match(beforeDetails, /&lt;60 分后一年中位收益 <strong>9.00%/);
    assert.doesNotMatch(html, /可按原定计划分批观察加仓。/);
  }
  const timing = fixture(); delete timing.scoring.evidence.assessment;
  assert.match(V.render(timing), /旧规则缺足够历史样本/);
});

test('a trend gate shows the deduction and the exact reason next to the component total', () => {
  const timing = fixture(); timing.scoring.value = 39; timing.scoring.raw = 65;
  timing.scoring.band = { id: 'wait' };
  timing.scoring.gate = { active: true, cap: 39, deduction: 26, reason: '价格低于200日均线，且长期均线向下。' };
  const html = V.render(timing);
  assert.equal(mainValue(html), '39');
  assert.match(html, /旧规则限分已触发/);
  assert.match(html, /价格低于200日均线，且长期均线向下。/);
  assert.match(html, /原始 65.0 分，限制为 39 分（扣减 26.0 分）/);
});

test('stale and insufficient states show no active score or action and retain clearly dated past scores', () => {
  for (const status of ['stale', 'insufficient', 'error', 'future']) {
    const timing = fixture(); timing.status = status; timing.scoring.value = null;
    timing.scoring.missing = '缺 2026-10-23 之后的有效共同报价';
    const html = V.render(timing);
    assert.equal(mainValue(html), '—');
    assert.match(html, /缺 2026-10-23 之后的有效共同报价/);
    assert.match(html, /过往规则分记录/);
    assert.match(html, /历史记录：2026-10-23 · 65 分/);
    assert.doesNotMatch(html, /role="meter"|aria-current="true"|可按原定计划分批观察加仓。/);
  }
});

test('a custom historical endpoint is explicit and does not reuse current action wording', () => {
  const timing = fixture(); timing.historical = true; timing.end = '2020-01-03';
  timing.scoring.history = timing.scoring.history.slice(0, 2);
  const html = V.render(timing);
  assert.match(html, /历史时点旧规则分/);
  assert.match(html, /截至 2020-01-03 共同收盘/);
  assert.match(html, /仅用于复核原有计算，分数和档位均不代表加仓机会。/);
  assert.doesNotMatch(html, /可按原定计划分批观察加仓。/);
});

test('outcome detail includes every band, same eligible baseline and explicit missing matured groups', () => {
  const html = V.render(fixture());
  assert.equal((html.match(/随后 [13] 年/g) || []).length, 2);
  assert.equal((html.match(/全部可比月份/g) || []).length, 2);
  assert.equal((html.match(/本次所在分组/g) || []).length, 2);
  assert.equal((html.match(/不重叠 3 个/g) || []).length, 10);
  for (const range of ['0–39', '40–59', '60–79', '80–100']) assert.equal((html.match(new RegExp(range + ' 分<', 'g')) || []).length, 2);
  assert.match(html, /80–100 分组缺完整 1 年后续样本。/);
  assert.match(html, /80–100 分组缺完整 3 年后续样本。/);
  assert.match(html, /最差收益/); assert.match(html, /期间最深回撤/);
  assert.match(html, /-12.50%/); assert.match(html, /-23.40%/);
  assert.match(html, /月度持有期存在重叠，历史正收益比例不是未来胜率。/);
});

test('full daily history has accessible slider and date-scaled marker, and leaves long gaps disconnected', () => {
  const timing = fixture(), html = V.render(timing);
  assert.match(html, /id="portfolio-score-day" data-portfolio-score-day type="range" min="0" max="2" step="1" value="2"/);
  assert.match(html, /aria-label="查看旧规则历史"/);
  assert.match(html, /id="portfolio-score-readout" for="portfolio-score-day" aria-live="polite"/);
  assert.match(html, /data-score-first="2020-01-02" data-score-last="2026-10-23"/);
  const path = html.match(/<path d="([^"]+)" class="portfolio-score-path"/)[1];
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.equal((path.match(/L/g) || []).length, 1);
  const first = V.inspect(timing, -3), last = V.inspect(timing, 100);
  assert.equal(first.index, 0); assert.equal(first.x, 44);
  assert.equal(last.index, 2); assert.equal(last.x, 982);
  assert.ok(Math.abs(last.y - 84.6) < 1e-8);
  assert.match(first.text, /2020-01-02 · 39 分 · 0–39 规则分 · 旧规则触发限分 · 已撤回/);
  assert.match(last.text, /2026-10-23 · 65 分 · 60–79 规则分 · 已撤回/);
  assert.equal(V.inspect(timing, 'invalid').index, 2);
});

test('missing payloads and untrusted text never render active numbers or raw markup', () => {
  assert.equal(mainValue(V.render(null)), '—');
  assert.equal(V.inspect({}, 0), null);
  assert.match(V.render({}), /尚无满足评分条件的历史记录/);
  const timing = fixture(); timing.scoring.version = '<script>oops</script>';
  timing.scoring.components[0].detail = '<img src=x onerror=oops>';
  const html = V.render(timing);
  assert.doesNotMatch(html, /<script>|<img|undefined|NaN/);
  assert.match(html, /&lt;script&gt;oops&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=oops&gt;/);
});
