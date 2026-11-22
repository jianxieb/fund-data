const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../assets/i18n.js');

const dir = path.join(__dirname, '..', 'assets', 'i18n');
for (const name of fs.readdirSync(dir).filter(f => /^en-.*\.js$/.test(f))) I.add('en', require(path.join(dir, name)));
const en = text => I.translate(text, { lang: 'en' });
// What the page hands to exports in English: the dictionary's answer, or the Chinese it was given.
const say = text => en(text) ?? text;

test('download file names keep their dates and turn English words', () => {
  assert.equal(say('长衡-组合逐日走势-2019-09-17_2026-11-20.csv'), 'changheng-portfolio-daily-2019-09-17_2026-11-20.csv');
  assert.equal(say('长衡-组合模拟-2019-09-17_2026-11-20.pdf'), 'changheng-portfolio-simulation-2019-09-17_2026-11-20.pdf');
  assert.equal(say('长衡-起点检验-持有5年-2026-11-10.csv'), 'changheng-start-date-check-hold-5y-2026-11-10.csv');
  assert.equal(say('长衡-起点检验-持有5年-未完成.csv'), 'changheng-start-date-check-hold-5y-unfinished.csv');
  assert.equal(say('长衡-组合配置.json'), 'changheng-portfolio-config.json');
  assert.equal(say('SPX-USD-5年持有窗口-累计.csv'), 'SPX-USD-5-year-holding-windows-cumulative.csv');
});

test('CSV headers that carry a currency code translate with it', () => {
  assert.equal(say('税后估值CNY'), 'After-tax value (CNY)');
  assert.equal(say('总投入本金USD'), 'Total principal invested (USD)');
  assert.equal(say('持仓本金（不含现金）CNY'), 'Principal held (excl. cash) (CNY)');
  assert.equal(say('日期'), 'Date');
});

test('the shared CSV encoder translates Chinese cells in English and leaves names, numbers and Chinese mode alone', () => {
  const model = require('../assets/model.js');
  const rows = [['日期', '税后估值CNY', '名称'], ['2026-01-02', 100, '通信ETF国泰'], ['', null, '已完成']];
  const before = globalThis.window;
  try {
    globalThis.window = { ChanghengI18n: { text: say } };
    const english = model.csv(rows).split('\r\n');
    assert.equal(english[0], '﻿"Date","After-tax value (CNY)","Name"');
    assert.equal(english[1], '"2026-01-02","100","通信ETF国泰"');
    assert.equal(english[2], '"","","Finished"');
    globalThis.window = { ChanghengI18n: { text: s => s } };
    assert.equal(model.csv(rows).split('\r\n')[0], '﻿"日期","税后估值CNY","名称"');
  } finally { if (before === undefined) delete globalThis.window; else globalThis.window = before; }
});

test('the portfolio PDF sentences translate one by one, with the settings spliced in', () => {
  assert.equal(say('所选本金方法信号依据：目标组合 · 前共同交易日收盘。'), 'Signal basis of the chosen principal method: Target portfolio · previous common trading day\'s close.');
  assert.equal(say('入金 87笔 再平衡 7次 买卖 282笔 交易费合计 0.00 元 期末现金 0.00 元'), '87 deposits · 7 rebalances · 282 trades · total trading fees CNY 0.00 · closing cash CNY 0.00');
  assert.equal(say('近1年'), 'Last 1 year');
});
