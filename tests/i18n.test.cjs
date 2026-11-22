const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocument, h, html, FakeObserver } = require('./fixtures/fake-dom.cjs');

const GLOBALS = ['document', 'MutationObserver', 'localStorage', 'location', 'history'];
function define(name, value) { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
function load({ search = '', stored = null } = {}) {
  const doc = createDocument();
  const storage = { data: stored ? { 'changheng.lang': stored } : {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const replaced = [];
  define('document', doc);
  define('MutationObserver', FakeObserver);
  define('localStorage', storage);
  define('location', { search, href: 'https://example.test/app/' + search + '#funds', hash: '#funds', pathname: '/app/' });
  define('history', { state: null, replaceState: (_, __, url) => replaced.push(url) });
  const path = require.resolve('../assets/i18n.js');
  delete require.cache[path];
  const I = require(path);
  I.boot();
  return { I, doc, storage, replaced, observer: FakeObserver.last };
}
test.afterEach(() => GLOBALS.forEach(name => { delete globalThis[name]; }));
const en = (I, text) => I.translate(text, { lang: 'en' });

test('dates and numbers become ordered slots; digits glued to letters do not', () => {
  const { I } = load();
  assert.deepEqual(I.tokenize('已展示 20 / 100'), { shape: '已展示 {0} / {1}', tokens: ['20', '100'] });
  assert.deepEqual(I.tokenize('截至2026年9月16日 +12.5%'), { shape: '截至{0} {1}%', tokens: ['2026年9月16日', '+12.5'] });
  assert.deepEqual(I.tokenize('2020-2025年'), { shape: '{0}-{1}年', tokens: ['2020', '2025'] });
  assert.deepEqual(I.tokenize('1,234.56亿元'), { shape: '{0}亿元', tokens: ['1,234.56'] });
  assert.deepEqual(I.tokenize('A500 2025Q3 ETF联接C 3x'), { shape: 'A500 2025Q3 ETF联接C 3x', tokens: [] });
  assert.deepEqual(I.tokenize('2026-11-20'), { shape: '{0}', tokens: ['2026-11-20'] });
  assert.deepEqual(I.tokenize('共 <0>12</0> 只'), { shape: '共 <0>{0}</0> 只', tokens: ['12'] });
});

test('entries match exactly, by number shape, and by wildcard with the captured text translated too', () => {
  const { I } = load();
  I.add('en', {
    '研究总览': 'Research overview', '标普500': 'S&P 500',
    '已展示 {0} / {1}': 'Showing {0} / {1}',
    '共 {0} 个交易日': '{0} trading {0?day:days}',
    '规模 {0}亿元': 'AUM CNY {0:yi}', '管理规模 {0}万元': 'AUM CNY {0:wan}',
    '{0}年期': '{0}-year',
    '查看{*}研究': 'View {*0} research', '{*}近 {0} 年收益': '{*0}: {0}-year return'
  });
  assert.equal(en(I, '研究总览'), 'Research overview');
  assert.equal(en(I, '  研究总览\n'), 'Research overview');
  assert.equal(en(I, '已展示 20 / 100'), 'Showing 20 / 100');
  assert.equal(en(I, '共 1 个交易日'), '1 trading day');
  assert.equal(en(I, '共 252 个交易日'), '252 trading days');
  assert.equal(en(I, '规模 12.3亿元'), 'AUM CNY 1.23B');
  assert.equal(en(I, '管理规模 5000万元'), 'AUM CNY 50M');
  assert.equal(en(I, '2026年9月6日'), '2026-09-06');
  assert.equal(en(I, '2026年9月'), '2026-09');
  assert.equal(en(I, '10年期'), '10-year');
  assert.equal(en(I, '查看标普500研究'), 'View S&P 500 research');
  assert.equal(en(I, '查看某某基金研究'), 'View 某某基金 research');
  assert.equal(en(I, '标普500近 3 年收益'), 'S&P 500: 3-year return');
  assert.equal(en(I, '没有这条'), null);
  assert.equal(I.text('研究总览'), '研究总览', 'Chinese stays while the page is Chinese');
});

test('prose date modifiers print month names', () => {
  const { I } = load();
  I.add('en', {
    '取{0}会议': 'At the {0:long} meeting', '自{0}起': 'Since {0:long}', '在{0}月': 'In {0:mon}',
    '截至{0}': 'As of {0:long}', '早于{0}': 'Before {0:date}'
  });
  assert.equal(en(I, '取6月19日会议'), 'At the Jun 19 meeting');
  assert.equal(en(I, '自2015年8月起'), 'Since Aug 2015');
  assert.equal(en(I, '截至2026年10月7日'), 'As of Oct 7, 2026');
  assert.equal(en(I, '截至2008-09-15'), 'As of Sep 15, 2008');
  assert.equal(en(I, '在6月'), 'In June');
  assert.equal(en(I, '早于6月19日'), 'Before 06-19');
  assert.equal(en(I, '取13月5日会议'), 'At the 13-05 meeting', 'an impossible month falls back to the numeric form');
  I.add('en', { '于{0}日发布': 'Published on the {0:ord}' });
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 101, 111].map(n => en(I, '于' + n + '日发布')), ['Published on the 1st', 'Published on the 2nd', 'Published on the 3rd', 'Published on the 4th', 'Published on the 11th', 'Published on the 12th', 'Published on the 13th', 'Published on the 21st', 'Published on the 22nd', 'Published on the 23rd', 'Published on the 24th', 'Published on the 101st', 'Published on the 111th']);
});

test('the most specific wildcard wins and slot entries are ignored by plain text lookup', () => {
  const { I } = load();
  I.add('en', { '{*}基金': 'Fund {*0}', '债券{*}基金': 'Bond fund {*0}', '共 <0>{0}</0> 只': 'Total <0>{0}</0>' });
  assert.equal(en(I, '债券增强基金'), 'Bond fund 增强');
  assert.equal(en(I, '指数基金'), 'Fund 指数');
  assert.equal(en(I, '共 <0>12</0> 只'), null);
});

test('strings with separators translate word by word, but only when it reads as English', () => {
  const { I } = load();
  I.add('en', { '净值': 'NAV', '元': 'CNY', '类型': 'Type', '场外': 'OTC', '收益': 'Return', '{0}元': '{0} CNY' });
  assert.equal(en(I, '净值（元）'), 'NAV (CNY)');
  assert.equal(en(I, '类型：场外'), 'Type: OTC');
  assert.equal(en(I, '收益 · 场外'), 'Return · OTC');
  assert.equal(en(I, '类型：1,234元'), 'Type: 1,234 CNY', 'a thousands comma is not a separator');
  assert.equal(en(I, '场外 · 易方达蓝筹'), 'OTC · 易方达蓝筹', 'a short unknown word is kept as a name');
  assert.equal(en(I, '面向中国个人投资者的全球投资研究工作台，场外'), null, 'a long untranslated sentence is left alone');
  assert.equal(en(I, '未知，未知'), null);
});

test('a year count prints as a calendar year or a span, and a sort arrow stays beside its translated label', () => {
  const { I } = load();
  I.add('en', { '{0}年': '{0:y}', '收益': 'Return', '近{0}年累计': '{0}-year cumulative', '名称 ↓': 'Name, newest first' });
  assert.equal(en(I, '2025年'), '2025');
  assert.equal(en(I, '5年'), '5Y');
  assert.equal(en(I, '收益 ↓'), 'Return ↓');
  assert.equal(en(I, '近3年累计 ↑'), '3-year cumulative ↑');
  assert.equal(en(I, '名称 ↓'), 'Name, newest first', 'an entry for the arrowed text wins');
  assert.equal(en(I, '未知 ↓'), null, 'an arrow does not make an unknown label translatable');
  assert.equal(en(I, '收益↓'), null, 'only an arrow set apart from the label counts');
});

test('a share after a translated label keeps its number', () => {
  const { I } = load();
  I.add('en', { '收益': 'Return', '标普{0}': 'S&P {0}' });
  assert.equal(en(I, '收益 25%'), 'Return 25%');
  assert.equal(en(I, '收益 12.5%'), 'Return 12.5%');
  assert.equal(en(I, '收益 -3%'), 'Return -3%');
  assert.equal(en(I, '标普500 40%'), 'S&P 500 40%');
  assert.equal(en(I, '未知 25%'), null, 'a share does not make an unknown label translatable');
  assert.equal(en(I, '收益25%'), null, 'only a share set apart from the label counts');
});

test('text() follows the active language for output that never reaches the DOM', () => {
  const { I } = load();
  I.add('en', { '收益': 'Return' });
  assert.equal(I.text('收益'), '收益');
  I.setLang('en');
  assert.equal(I.text('收益'), 'Return');
  assert.equal(I.text(' 收益 '), ' Return ');
  assert.equal(I.text('Total'), 'Total');
  assert.equal(I.text(null), null);
});

test('language comes from the address, then the saved choice, and Chinese is the default', () => {
  assert.equal(load().I.lang(), 'zh');
  assert.equal(load({ stored: 'en' }).I.lang(), 'en');
  assert.equal(load({ stored: 'fr' }).I.lang(), 'zh');
  assert.equal(load({ search: '?lang=en', stored: 'zh' }).I.lang(), 'en');
  assert.equal(load({ search: '?lang=zh', stored: 'en' }).I.lang(), 'zh');
  assert.equal(load({ search: '?lang=xx' }).I.lang(), 'zh');
});

test('switching saves the choice and keeps the address in step; Chinese leaves the address clean', () => {
  const { I, storage, replaced, doc } = load();
  I.setLang('en');
  assert.equal(storage.data['changheng.lang'], 'en');
  assert.equal(replaced.at(-1), '/app/?lang=en#funds');
  assert.equal(doc.documentElement.getAttribute('lang'), 'en');
  I.setLang('zh');
  assert.equal(storage.data['changheng.lang'], 'zh');
  assert.equal(replaced.at(-1), '/app/#funds');
  assert.equal(doc.documentElement.getAttribute('lang'), 'zh-CN');
  assert.equal(I.setLang('fr'), 'zh', 'an unknown language is ignored');
});

test('English translates text and attributes in place and Chinese restores them exactly', () => {
  const { I, doc } = load();
  I.add('en', { '收益': 'Return', '搜索基金': 'Search funds', '关于': 'About' });
  const label = h(doc, 'label', { 'aria-label': '搜索基金' }, '收益');
  const input = h(doc, 'input', { placeholder: '搜索基金', title: 'keep me' });
  const note = h(doc, 'span', { translate: 'no' }, '收益');
  doc.body.appendChild(h(doc, 'div', {}, label, input, note, h(doc, 'p', {}, '关于')));
  const before = html(doc.body);
  I.setLang('en');
  assert.equal(label.getAttribute('aria-label'), 'Search funds');
  assert.equal(label.childNodes[0].nodeValue, 'Return');
  assert.equal(input.getAttribute('placeholder'), 'Search funds');
  assert.equal(input.getAttribute('title'), 'keep me');
  assert.equal(note.childNodes[0].nodeValue, '收益', 'translate="no" is left alone');
  assert.match(html(doc.body), /About/);
  I.setLang('zh');
  assert.equal(html(doc.body), before);
});

test('a sentence around inline markup is translated as one unit and keeps the original elements', () => {
  const { I, doc } = load();
  I.add('en', { '共 <0>{0}</0> 只基金，<1>{1}</1> 只可买': 'Of <0>{0}</0> funds, <1>{1}</1> can be bought', '共 <0>{0}</0> 只': 'Total <0>{0}</0>' });
  const total = h(doc, 'b', {}, '12'), open = h(doc, 'em', { class: 'open' }, '5');
  const p = h(doc, 'p', {}, '共 ', total, ' 只基金，', open, ' 只可买');
  doc.body.appendChild(p);
  const before = html(p);
  I.setLang('en');
  assert.equal(html(p), '<p>Of <b>12</b> funds, <em class="open">5</em> can be bought</p>');
  assert.equal(p.childNodes.find(c => c.tagName === 'B'), total, 'the element itself is reused');
  I.setLang('zh');
  assert.equal(html(p), before);
});

test('a unit entry can reorder elements and keep a control in place', () => {
  const { I, doc } = load();
  I.add('en', { '至少 <0/> 次，共 <1>{0}</1> 笔': 'Of <1>{0}</1> trades, at least <0/>' });
  const input = h(doc, 'input', { type: 'number' }), count = h(doc, 'strong', {}, '8');
  const label = h(doc, 'label', {}, '至少 ', input, ' 次，共 ', count, ' 笔');
  doc.body.appendChild(label);
  I.setLang('en');
  assert.equal(html(label), '<label>Of <strong>8</strong> trades, at least <input type="number"></input></label>');
  assert.equal(label.childNodes.at(-1), input);
});

test('an entry that does not use every element is refused rather than dropping content', () => {
  const { I, doc } = load();
  I.add('en', { '共 <0>{0}</0> 只 <1>新</1>': 'Total <0>{0}</0>' });
  const p = h(doc, 'p', {}, '共 ', h(doc, 'b', {}, '3'), ' 只 ', h(doc, 'i', {}, '新'));
  doc.body.appendChild(p);
  I.setLang('en');
  assert.equal(html(p), '<p>共 <b>3</b> 只 <i>新</i></p>');
});

test('parts without a sentence entry are translated one by one, with the spaces English needs', () => {
  const { I, doc } = load();
  I.add('en', { '标签': 'Label', '说明': 'Details', '只': 'funds' });
  const p = h(doc, 'p', {}, h(doc, 'b', {}, '标签：'), '说明');
  const q = h(doc, 'p', {}, h(doc, 'b', {}, '12'), '只');
  doc.body.appendChild(p); doc.body.appendChild(q);
  I.setLang('en');
  assert.equal(html(p), '<p><b>Label:</b> Details</p>');
  assert.equal(html(q), '<p><b>12</b> funds</p>');
});

test('a value the page rewrites in place is restored as its newest Chinese, never the first one translated', () => {
  const { I, doc, observer } = load();
  I.add('en', { '转入买股账户': 'Into the stock account', '换成美元': 'Convert to USD', '第一行': 'First line', '第二行': 'Second line' });
  const button = h(doc, 'button', { 'aria-label': '转入买股账户' }, '第一行');
  doc.body.appendChild(button);
  const text = button.childNodes[0];
  I.setLang('en');
  assert.equal(button.getAttribute('aria-label'), 'Into the stock account');
  // The page changes both in place to another known value.
  button.setAttribute('aria-label', '换成美元');
  observer.callback([{ type: 'attributes', target: button, attributeName: 'aria-label' }]);
  text.nodeValue = '第二行';
  observer.callback([{ type: 'characterData', target: text }]);
  assert.equal(button.getAttribute('aria-label'), 'Convert to USD');
  assert.equal(text.nodeValue, 'Second line');
  I.setLang('zh');
  assert.equal(button.getAttribute('aria-label'), '换成美元');
  assert.equal(text.nodeValue, '第二行');
  // And to a value no entry covers: it stays as the page wrote it, in both languages.
  I.setLang('en');
  button.setAttribute('aria-label', '转入别处');
  observer.callback([{ type: 'attributes', target: button, attributeName: 'aria-label' }]);
  text.nodeValue = '第三行';
  observer.callback([{ type: 'characterData', target: text }]);
  assert.equal(button.getAttribute('aria-label'), '转入别处');
  assert.equal(I.audit(doc.body).find(i => i.kind === 'attr:aria-label').key, '转入别处', 'the audit names the text on screen, not an older one');
  I.setLang('zh');
  assert.equal(button.getAttribute('aria-label'), '转入别处');
  assert.equal(text.nodeValue, '第三行');
});

test('content added after switching is translated through the observer; Chinese mode does nothing', () => {
  const { I, doc, observer } = load();
  I.add('en', { '收益': 'Return', '收益说明': 'Return notes' });
  I.setLang('en');
  const row = h(doc, 'div', {}, h(doc, 'span', {}, '收益'));
  doc.body.appendChild(row);
  observer.callback([{ type: 'childList', addedNodes: [row], target: doc.body }]);
  assert.equal(html(row), '<div><span>Return</span></div>');
  const cell = h(doc, 'td', { title: '收益' }, '');
  doc.body.appendChild(cell);
  observer.callback([{ type: 'attributes', target: cell, attributeName: 'title' }]);
  assert.equal(cell.getAttribute('title'), 'Return');
  const text = doc.createTextNode('收益说明');
  const note = h(doc, 'p', {});
  note.appendChild(text);
  doc.body.appendChild(note);
  observer.callback([{ type: 'characterData', target: text }]);
  assert.equal(text.nodeValue, 'Return notes');
  assert.equal(observer.active, true, 'observing resumes after our own edits');
  I.setLang('zh');
  const fresh = h(doc, 'div', {}, '收益');
  observer.callback([{ type: 'childList', addedNodes: [fresh], target: doc.body }]);
  assert.equal(html(fresh), '<div>收益</div>');
});

test('the page description and title follow the language', () => {
  const { I, doc } = load();
  I.add('en', { '长衡': 'Changheng', '中文说明': 'English description' });
  const meta = h(doc, 'meta', { name: 'description', content: '中文说明' });
  doc.head.appendChild(meta);
  const title = h(doc, 'title', {}, '长衡');
  doc.head.appendChild(title);
  I.setLang('en');
  assert.equal(meta.getAttribute('content'), 'English description');
  assert.equal(title.childNodes[0].nodeValue, 'Changheng');
  I.setLang('zh');
  assert.equal(meta.getAttribute('content'), '中文说明');
  assert.equal(title.childNodes[0].nodeValue, '长衡');
});

test('a dictionary that loads after the first pass still reaches the page', async () => {
  const { I, doc } = load({ stored: 'en' });
  doc.listeners.DOMContentLoaded?.forEach(fn => fn());
  const p = h(doc, 'p', {}, '晚到的词条');
  doc.body.appendChild(p);
  I.add('en', { '晚到的词条': 'A late entry' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(html(p), '<p>A late entry</p>');
});

test('the audit lists what is still Chinese, with numbers abstracted', () => {
  const { I, doc } = load();
  I.add('en', { '收益': 'Return' });
  doc.body.appendChild(h(doc, 'div', {}, h(doc, 'p', { title: '提示 3' }, '收益'), h(doc, 'p', {}, '缺口 12 项'), h(doc, 'p', {}, '缺口 7 项')));
  I.setLang('en');
  const items = I.audit(doc.body);
  const gap = items.find(i => i.key === '缺口 {0} 项');
  assert.equal(gap.count, 2);
  assert.equal(gap.kind, 'text');
  assert.ok(items.some(i => i.kind === 'attr:title' && i.key === '提示 {0}'));
  assert.ok(!items.some(i => i.key === '收益'));
});

test('the audit names a half-translated text by its original Chinese, and also gives what is on screen now', () => {
  const { I, doc } = load();
  I.add('en', { '标普{0}': 'S&P {0}' });
  const line = h(doc, 'p', {}, 'SSO · 标普500 · 每日2倍做多');
  const tip = h(doc, 'p', { title: '标普500 · 每日2倍做多' }, 'x');
  doc.body.appendChild(h(doc, 'div', {}, line, tip));
  I.setLang('en');
  assert.equal(line.firstChild.nodeValue, 'SSO · S&P 500 · 每日2倍做多');
  const items = I.audit(doc.body);
  const text = items.find(i => i.kind === 'text');
  assert.equal(text.key, 'SSO · 标普{0} · 每日{1}倍做多');
  assert.equal(text.example, 'SSO · 标普500 · 每日2倍做多');
  assert.equal(text.current, 'SSO · S&P 500 · 每日2倍做多');
  const attr = items.find(i => i.kind === 'attr:title');
  assert.equal(attr.key, '标普{0} · 每日{1}倍做多');
  assert.equal(attr.current, 'S&P 500 · 每日2倍做多');
});

test('an element can carry its own English when a short word is ambiguous between pages', () => {
  const { I, doc } = load();
  I.add('en', { '个': 'windows' });
  const plain = h(doc, 'small', {}, '个'), hinted = h(doc, 'small', { 'data-en': 'indices' }, '个');
  doc.body.appendChild(plain);
  doc.body.appendChild(hinted);
  I.setLang('en');
  assert.equal(plain.childNodes[0].nodeValue, 'windows');
  assert.equal(hinted.childNodes[0].nodeValue, 'indices');
  I.setLang('zh');
  assert.equal(hinted.childNodes[0].nodeValue, '个');
});
