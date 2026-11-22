const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../assets/i18n.js');

const dir = path.join(__dirname, '..', 'assets', 'i18n');
const files = fs.readdirSync(dir).filter(name => /^en-.*\.js$/.test(name)).sort();
const dictionaries = files.map(name => ({ name, entries: require(path.join(dir, name)) }));
const PLACEHOLDER = /\{(\*|\d+)\}|<(\/?)(\d+)(\/?)>/g;
const keyParts = key => {
  const numbers = [], wild = [], tags = [];
  for (const m of key.matchAll(PLACEHOLDER)) {
    if (m[1] === '*') wild.push('*');
    else if (m[1] !== undefined) numbers.push(Number(m[1]));
    else tags.push((m[2] ? '/' : '') + m[3] + (m[4] ? '/' : ''));
  }
  return { numbers, wild, tags };
};
const tagKey = tags => tags.map(t => t.replace('/', '')).sort().join(',');

test('there is at least the core English dictionary', () => {
  assert.ok(files.includes('en-core.js'));
});

for (const { name, entries } of dictionaries) {
  test(name + ': keys are Chinese, normalised and well formed', () => {
    for (const key of Object.keys(entries)) {
      assert.equal(I.norm(key), key, 'key has stray whitespace: ' + JSON.stringify(key));
      assert.ok(I.CJK.test(key), 'key has no Chinese so it can never match: ' + JSON.stringify(key));
      const { numbers, wild } = keyParts(key);
      if (!wild.length) assert.deepEqual(numbers, numbers.map((_, i) => i), 'numbers must be {0},{1},… in order: ' + key);
      else assert.equal(new Set(numbers).size, numbers.length, 'repeated number slot: ' + key);
      const stripped = key.replace(PLACEHOLDER, '');
      assert.ok(!/[{}]/.test(stripped), 'unbalanced brace: ' + key);
    }
  });

  test(name + ': every English value keeps the numbers, captures and elements its key has', () => {
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(typeof value, 'string', 'value must be text: ' + key);
      assert.equal(value, value.trim(), 'value has stray whitespace: ' + JSON.stringify(value));
      assert.ok(!I.CJK.test(value), 'value still contains Chinese: ' + key + ' → ' + value);
      assert.ok(!/<\/?[a-zA-Z]/.test(value), 'values are plain text, not HTML: ' + key);
      const k = keyParts(key);
      const parts = I._internals.parseValue(value);
      const usedNumbers = new Set(parts.filter(p => p.t === 'num' || p.t === 'plural').map(p => p.i));
      const usedWild = new Set(parts.filter(p => p.t === 'wild').map(p => p.i));
      k.numbers.forEach(n => assert.ok(usedNumbers.has(n), 'value drops {' + n + '}: ' + key + ' → ' + value));
      usedNumbers.forEach(n => assert.ok(k.numbers.includes(n), 'value uses unknown {' + n + '}: ' + key));
      k.wild.forEach((_, i) => assert.ok(usedWild.has(i), 'value drops capture {*' + i + '}: ' + key + ' → ' + value));
      usedWild.forEach(i => assert.ok(i < k.wild.length, 'value uses unknown capture {*' + i + '}: ' + key));
      const vt = parts.filter(p => ['open', 'close', 'self'].includes(p.t)).map(p => (p.t === 'close' ? '/' : '') + p.n + (p.t === 'self' ? '/' : ''));
      assert.equal(tagKey(vt), tagKey(k.tags), 'value and key must use the same elements: ' + key + ' → ' + value);
    }
  });

  test(name + ': every entry compiles', () => {
    for (const [key, value] of Object.entries(entries)) assert.doesNotThrow(() => I._internals.compile(key, value), key);
  });
}

test('no Chinese text is defined twice across dictionary files', () => {
  const seen = new Map();
  const clashes = [];
  for (const { name, entries } of dictionaries) {
    for (const key of Object.keys(entries)) {
      if (seen.has(key)) clashes.push(key + ' (' + seen.get(key) + ' and ' + name + ')');
      else seen.set(key, name);
    }
  }
  assert.deepEqual(clashes, []);
});
