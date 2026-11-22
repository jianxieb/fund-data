/* Interface language: Chinese is the source text and the default; English is a dictionary layer on top.
 * Nothing is rewritten while Chinese is active. In English the page's rendered text is translated in place
 * (text nodes, a few attributes, and sentences that wrap inline markup), so every module keeps producing Chinese.
 * Dictionaries live in assets/i18n/*.js and are keyed by the Chinese text; see docs/i18n.md for the entry syntax.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ChanghengI18n = api;
    api.boot();
  }
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const STORAGE = 'changheng.lang';
  const HTML_LANG = { zh: 'zh-CN', en: 'en' };
  const CJK = /[㐀-䶿一-鿿豈-﫿]/;
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'aria-valuetext', 'aria-description', 'data-tooltip'];
  // Elements that sit inside a sentence. Anything else (div, p, td, li ...) ends a translation unit.
  const INLINE = new Set('A ABBR B BDI BDO CITE CODE DATA DEL DFN EM FONT I INS KBD LABEL MARK NOBR Q S SAMP SMALL SPAN STRONG SUB SUP TIME TSPAN U VAR'.split(' '));
  // Controls and graphics: kept in place inside a sentence as <n/>, translated on their own.
  const OPAQUE = new Set('BR BUTTON CANVAS IMG INPUT METER OUTPUT PROGRESS SELECT SVG TEXTAREA WBR'.split(' '));
  const SKIP = new Set('SCRIPT STYLE NOSCRIPT TEMPLATE TEXTAREA'.split(' '));
  const CACHE_LIMIT = 40000;
  // The longest untranslated word a segmented string may keep and still count as translated (names, codes).
  const NAME_LENGTH = 14;

  /* ---------- Dictionary ---------- */
  const dictionaries = {};
  const store = lang => dictionaries[lang] || (dictionaries[lang] = { lang, exact: new Map(), shape: new Map(), patterns: [], count: 0, cache: new Map() });
  const norm = s => String(s).replace(/[\s ]+/g, ' ').trim();
  // Dates first, then plain numbers. A signed number keeps its sign; digits glued to letters (A500, 2025Q3) are not numbers.
  const TOKEN = /\d{4}-\d{2}-\d{2}|\d{4}\s?年\s?\d{1,2}\s?月\s?\d{1,2}\s?日|\d{4}\s?年\s?\d{1,2}\s?月|\d{1,2}\s?月\s?\d{1,2}\s?日|(?<![A-Za-z0-9])(?:(?<=^|[\s(（[:：,，;；/、~～])[+\-−])?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/g;
  const SLOT_TAG = /(<\/?\d+\/?>)/;
  // The shape of a string: every date or number replaced by {i}, in order. Slot tags <n> are left alone.
  function tokenize(s) {
    const tokens = [];
    const shape = s.split(SLOT_TAG).map(part => SLOT_TAG.test(part) ? part : part.replace(TOKEN, m => '{' + (tokens.push(m) - 1) + '}')).join('');
    return { shape, tokens };
  }
  const ESCAPE = /[.*+?^${}()|[\]\\]/g;
  const PLACEHOLDER = /\{(\*)?(\d+)(?::([a-z0-9]+)|\?([^:{}]*):([^{}]*))?\}|<(\/)?(\d+)(\/)?>/g;
  // An English value becomes a list of parts once, when it is registered.
  function parseValue(value) {
    const parts = [];
    let last = 0, m;
    PLACEHOLDER.lastIndex = 0;
    while ((m = PLACEHOLDER.exec(value))) {
      if (m.index > last) parts.push({ t: 'text', v: value.slice(last, m.index) });
      if (m[7] !== undefined) parts.push({ t: m[6] ? 'close' : m[8] ? 'self' : 'open', n: Number(m[7]) });
      else if (m[1]) parts.push({ t: 'wild', i: Number(m[2]) });
      else if (m[4] !== undefined) parts.push({ t: 'plural', i: Number(m[2]), one: m[4], other: m[5] });
      else parts.push({ t: 'num', i: Number(m[2]), mod: m[3] || '' });
      last = m.index + m[0].length;
    }
    if (last < value.length) parts.push({ t: 'text', v: value.slice(last) });
    return parts;
  }
  const slotted = parts => parts.some(p => p.t === 'open' || p.t === 'close' || p.t === 'self');
  const DATE_ENTRY = { parts: parseValue('{0:date}'), slotted: false };
  function compile(zh, en) {
    const key = norm(zh), parts = parseValue(en);
    const entry = { key, en, parts, plain: parts.every(p => p.t === 'text'), slotted: slotted(parts) };
    if (!/\{(\*|\d+)\}|<\/?\d+\/?>/.test(key)) return { kind: 'exact', key, entry };
    if (!key.includes('{*')) return { kind: 'shape', key, entry };
    // A wildcard {*} stands for any text; {n} inside the pattern stands for the number token the page produced there.
    const order = [], literal = [];
    let source = '', last = 0, m;
    const re = /\{(\*|\d+)\}|<(\/?)(\d+)(\/?)>/g;
    while ((m = re.exec(key))) {
      const text = key.slice(last, m.index);
      source += text.replace(ESCAPE, '\\$&');
      if (text) literal.push(text);
      if (m[1] === '*') { source += '([^<>]+?)'; order.push('*'); }
      else if (m[1] !== undefined) { source += '(\\{\\d+\\})'; order.push(Number(m[1])); }
      else source += m[0].replace(ESCAPE, '\\$&');
      last = m.index + m[0].length;
    }
    const tail = key.slice(last);
    source += tail.replace(ESCAPE, '\\$&');
    if (tail) literal.push(tail);
    const anchor = literal.sort((a, b) => b.length - a.length)[0] || '';
    return { kind: 'pattern', key, entry, regex: new RegExp('^' + source + '$'), order, anchor, weight: literal.join('').length };
  }
  function add(lang, entries) {
    const d = store(lang);
    for (const [zh, en] of Object.entries(entries || {})) {
      const c = compile(zh, en);
      if (c.kind === 'exact') d.exact.set(c.key, c.entry);
      else if (c.kind === 'shape') d.shape.set(c.key, c.entry);
      else {
        const at = d.patterns.findIndex(p => p.key === c.key);
        if (at >= 0) d.patterns.splice(at, 1);
        d.patterns.push(c);
        d.patterns.sort((a, b) => b.weight - a.weight || b.key.length - a.key.length);
      }
      d.count++;
    }
    d.cache.clear();
    // A dictionary that arrives after the first pass still reaches the page.
    if (ready && lang === current && !pending) {
      pending = true;
      Promise.resolve().then(() => { pending = false; if (current === lang) applyAll(); });
    }
  }

  /* ---------- Rendering an English value ---------- */
  const COMPACT = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  const trimNumber = n => String(Number(n.toFixed(2)));
  function compact(n) {
    const abs = Math.abs(n), unit = COMPACT.find(([size]) => abs >= size);
    return unit ? trimNumber(n / unit[0]) + unit[1] : trimNumber(n);
  }
  const numeric = token => Number(String(token).replace(/[,\s+]/g, '').replace('−', '-'));
  function isoDate(token) {
    const n = String(token).match(/\d+/g) || [];
    const pad = v => String(v).padStart(2, '0');
    if (n.length >= 3) return n[0] + '-' + pad(n[1]) + '-' + pad(n[2]);
    if (n.length === 2 && String(token).includes('年')) return n[0] + '-' + pad(n[1]);
    if (n.length === 2) return pad(n[0]) + '-' + pad(n[1]);
    return String(token);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Dates inside a sentence: 6月19日 -> Jun 19, 2015年8月 -> Aug 2015, 2015-08-24 -> Aug 24, 2015. Anything else is left to isoDate.
  function longDate(token) {
    const n = String(token).match(/\d+/g) || [];
    const short = i => MONTHS[Number(i) - 1] && MONTHS[Number(i) - 1].slice(0, 3);
    if (n.length >= 3 && short(n[1])) return short(n[1]) + ' ' + Number(n[2]) + ', ' + n[0];
    if (n.length === 2 && String(token).includes('年') && short(n[1])) return short(n[1]) + ' ' + n[0];
    if (n.length === 2 && short(n[0])) return short(n[0]) + ' ' + Number(n[1]);
    return isoDate(token);
  }
  const MODIFIERS = {
    pad2: v => String(v).padStart(2, '0'),
    date: isoDate,
    long: longDate,
    mon: v => MONTHS[numeric(v) - 1] || String(v),
    ord: v => { const n = numeric(v), last = n % 100; return String(v) + (last >= 11 && last <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')); },
    wan: v => compact(numeric(v) * 1e4),
    yi: v => compact(numeric(v) * 1e8),
    wanyi: v => compact(numeric(v) * 1e12),
    // A bare 年 count is either a calendar year (2025) or a span (5年): years print as they are, spans as 5Y.
    y: v => numeric(v) >= 1000 ? String(v) : String(v) + 'Y',
    abs: v => String(v).replace(/^[+\-−]/, ''),
    plain: v => String(v).replace(/^\+/, '')
  };
  // Text parts only; slot tags are ignored here (units use build()).
  function fill(parts, ctx) {
    let out = '';
    for (const p of parts) {
      if (p.t === 'text') out += p.v;
      else if (p.t === 'num') { const v = ctx.tokens[p.i]; out += v === undefined ? '' : (MODIFIERS[p.mod] || String)(v); }
      else if (p.t === 'wild') out += ctx.wild[p.i] ?? '';
      else if (p.t === 'plural') out += numeric(ctx.tokens[p.i]) === 1 ? p.one : p.other;
    }
    return out;
  }
  const restore = (text, tokens) => text.replace(/\{(\d+)\}/g, (m, i) => tokens[Number(i)] ?? m);

  /* ---------- Lookup ---------- */
  const SEPARATORS = { '，': ', ', ',': ', ', '；': '; ', ';': '; ', '：': ': ', ':': ': ', '、': ', ', '。': '. ', '·': ' · ', '・': ' · ', '/': ' / ', '／': ' / ', '|': ' | ', '｜': ' | ', '→': ' → ', '（': ' (', '(': ' (', '）': ')', ')': ')', '—': ' — ' };
  const SEPARATOR = /[，,；;：:、。·・/／|｜→（(）)—]/;
  // A sort arrow or a share such as 25% after a label is a symbol, not a word.
  const TRAILING_MARK = /\s+([↑↓▲▼]|[+\-−]?\d[\d,]*(?:\.\d+)?%)$/;
  // Lookup of one normalised string, without a segment fallback. Returns { entry, ctx } or null.
  function match(d, text) {
    const exact = d.exact.get(text);
    if (exact) return { entry: exact, ctx: { tokens: [], wild: [] } };
    const { shape, tokens } = tokenize(text);
    const hit = d.shape.get(shape);
    if (hit) return { entry: hit, ctx: { tokens, wild: [] } };
    // A date written in Chinese on its own (2026年9月16日, 2026年9月, 9月16日) becomes an ISO date without needing an entry.
    if (shape === '{0}' && /[年月日]/.test(tokens[0])) return { entry: DATE_ENTRY, ctx: { tokens, wild: [] } };
    for (const p of d.patterns) {
      if (p.anchor && !shape.includes(p.anchor)) continue;
      const m = p.regex.exec(shape);
      if (!m) continue;
      const ctx = { tokens: [], wild: [] };
      let ok = true;
      p.order.forEach((kind, at) => {
        const value = m[at + 1];
        if (kind === '*') ctx.wild.push(value);
        else { const index = Number(value.slice(1, -1)); ctx.tokens[kind] = tokens[index]; if (tokens[index] === undefined) ok = false; }
      });
      if (!ok) continue;
      ctx.wildRaw = ctx.wild.slice();
      ctx.wild = ctx.wild.map(w => translate(restore(w, tokens), { lang: d.lang, depth: 1 }) ?? restore(w, tokens));
      return { entry: p.entry, ctx };
    }
    return null;
  }
  // Break at separators and translate each word; a word with no entry stays Chinese so the gap stays visible.
  function bySegments(d, text, depth) {
    if (depth > 2 || !SEPARATOR.test(text)) return null;
    const pieces = [];
    let word = '';
    const chars = Array.from(text);
    chars.forEach((ch, at) => {
      const inNumber = ',:/'.includes(ch) && /\d/.test(chars[at - 1] || '') && /\d/.test(chars[at + 1] || '');
      if (SEPARATORS[ch] !== undefined && !inNumber) { pieces.push([word, ch]); word = ''; } else word += ch;
    });
    pieces.push([word, '']);
    let out = '', translated = 0, kept = 0;
    for (const [w, sep] of pieces) {
      const core = w.trim();
      if (core) {
        const en = CJK.test(core) ? translate(core, { lang: d.lang, depth: depth + 1, segments: false }) : null;
        if (en != null) { out += en; translated++; }
        else {
          out += core;
          // A word we cannot translate is fine when it looks like a name; a Chinese sentence half in English is not.
          if (CJK.test(core)) { if (core.length > NAME_LENGTH) return null; kept++; }
        }
      }
      out += SEPARATORS[sep] ?? '';
    }
    if (!translated || kept > translated) return null;
    return out.replace(/\(\s+/g, '(').replace(/\s+([,;:.)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }
  function translate(text, options = {}) {
    const lang = options.lang || current;
    const d = dictionaries[lang];
    if (!d) return null;
    d.lang = lang;
    const key = norm(text);
    if (!CJK.test(key)) return null;
    const segments = options.segments !== false;
    const cacheKey = segments ? key : '\u0000' + key;
    if (d.cache.has(cacheKey)) return d.cache.get(cacheKey);
    const hit = match(d, key);
    let result = hit && !hit.entry.slotted ? fill(hit.entry.parts, hit.ctx) : null;
    // A sort arrow or a share after a label is a symbol, not a word: translate the label and keep the mark.
    if (result == null && TRAILING_MARK.test(key)) {
      const base = translate(key.replace(TRAILING_MARK, ''), { lang, depth: (options.depth || 0) + 1, segments });
      if (base != null) result = base + ' ' + TRAILING_MARK.exec(key)[1];
    }
    // Entries joined by " + " or " ＋ " (a combination of strategies, each with its share) translate piece by piece.
    if (result == null && /\s[+＋]\s/.test(key) && (options.depth || 0) < 3) {
      const pieces = key.split(/\s[+＋]\s/), done = pieces.map(p => CJK.test(p) ? translate(p, { lang, depth: (options.depth || 0) + 1, segments }) : p);
      if (done.every(p => p != null) && done.some((p, at) => p !== pieces[at])) result = done.join(' + ');
    }
    // Sentences a page strings together translate one by one, in order; each needs its own entry, full stop included.
    if (result == null && key.indexOf('。') >= 0 && (options.depth || 0) < 3) {
      const sentences = (key.match(/[^。]+。?/g) || []).map(p => p.trim()).filter(Boolean);
      if (sentences.length > 1) {
        const done = sentences.map(p => CJK.test(p) ? translate(p, { lang, depth: (options.depth || 0) + 1, segments: false }) : p);
        if (done.every(p => p != null) && done.some((p, at) => p !== sentences[at])) result = done.join(' ');
      }
    }
    if (result == null && segments) result = bySegments(d, key, options.depth || 0);
    if (d.cache.size > CACHE_LIMIT) d.cache.clear();
    d.cache.set(cacheKey, result);
    return result;
  }

  /* ---------- Language state ---------- */
  let current = 'zh';
  const listeners = [];
  const env = () => ({ document: root.document, location: root.location, history: root.history, storage: safeStorage() });
  function safeStorage() { try { return root.localStorage; } catch (_) { return null; } }
  function readPreference() {
    const { location, storage } = env();
    let fromUrl = null;
    try { fromUrl = new URLSearchParams(location.search).get('lang'); } catch (_) {}
    if (fromUrl === 'en' || fromUrl === 'zh') return { lang: fromUrl, fromUrl: true };
    let saved = null;
    try { saved = storage && storage.getItem(STORAGE); } catch (_) {}
    return { lang: saved === 'en' ? 'en' : 'zh', fromUrl: false };
  }
  const lang = () => current;
  const available = () => Object.keys(dictionaries).filter(l => dictionaries[l].count);
  // For output that never reaches the DOM (PDF canvas, CSV cells): the English text, or the original.
  function text(zh) {
    if (current === 'zh' || typeof zh !== 'string' || !CJK.test(zh)) return zh;
    const lead = /^\s*/.exec(zh)[0], trail = /\s*$/.exec(zh)[0];
    const en = translate(zh);
    return en == null ? zh : lead + en + trail;
  }

  /* ---------- DOM walking ---------- */
  const originals = { text: new WeakMap(), attrs: new WeakMap(), units: new WeakMap() };
  // What this engine last wrote. A different value on screen means the page rewrote the node in place,
  // so its saved original is stale and must follow the new text instead of being restored over it.
  const written = { text: new WeakMap(), attrs: new WeakMap() };
  const tag = el => String(el.tagName || '').toUpperCase();
  const isElement = n => n && n.nodeType === 1;
  const isText = n => n && n.nodeType === 3;
  function inlineContent(el) {
    const name = tag(el);
    if (OPAQUE.has(name)) return true;
    if (!INLINE.has(name)) return false;
    return Array.from(el.childNodes).every(c => !isElement(c) || inlineContent(c));
  }
  function skipped(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP.has(tag(n))) return true;
      if (n.getAttribute && (n.getAttribute('translate') === 'no' || n.hasAttribute('data-i18n-skip'))) return true;
    }
    return false;
  }
  const edge = (node, last) => {
    const t = node && (node.nodeType === 1 || node.nodeType === 3) ? String(node.textContent || '') : '';
    return t ? t[last ? t.length - 1 : 0] : '';
  };
  const NO_SPACE_AFTER = /[\s([{$¥￥€£+\-−–—/"'“‘（【《#@&]/;
  const NO_SPACE_BEFORE = /[\s)\]}%.,;:!?"'”’）】》/，。；：、]/;
  // English needs spaces that Chinese does not: keep a translated node apart from the node beside it.
  function spaced(node, en, lead, trail) {
    let out = en;
    if (!out) return lead + trail;
    const prev = edge(node.previousSibling, true), next = edge(node.nextSibling, false);
    if (!lead && prev && !NO_SPACE_AFTER.test(prev) && !NO_SPACE_BEFORE.test(out[0])) out = ' ' + out;
    if (!trail && next && !NO_SPACE_BEFORE.test(next) && !NO_SPACE_AFTER.test(out[out.length - 1])) out += ' ';
    return lead + out + trail;
  }
  function translateText(node) {
    const value = node.nodeValue;
    if (!CJK.test(value)) return;
    // A short word that means different things on different pages can carry its English: <small data-en="indices">个</small>.
    const owner = node.parentNode, hint = owner && owner.getAttribute && owner.childNodes.length === 1 ? owner.getAttribute('data-en') : null;
    const en = hint != null ? hint : translate(value);
    const rewritten = originals.text.has(node) && written.text.get(node) !== value;
    if (en == null) { if (rewritten) originals.text.delete(node); return; }
    const lead = /^\s*/.exec(value)[0], trail = /\s*$/.exec(value)[0];
    if (!originals.text.has(node) || rewritten) originals.text.set(node, value);
    const out = spaced(node, en, lead, trail);
    written.text.set(node, out);
    node.nodeValue = out;
  }
  function translateAttrs(el) {
    if (!el.getAttribute) return;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value || !CJK.test(value)) continue;
      const en = translate(value);
      let saved = originals.attrs.get(el), last = written.attrs.get(el);
      const rewritten = !!saved && name in saved && !(last && last[name] === value);
      if (en == null) { if (rewritten) delete saved[name]; continue; }
      if (!saved) originals.attrs.set(el, saved = {});
      if (!last) written.attrs.set(el, last = {});
      if (!(name in saved) || rewritten) saved[name] = value;
      last[name] = en;
      el.setAttribute(name, en);
    }
  }
  // A sentence is written as its text with every inline element as <n>…</n> and every control as <n/>.
  function serialize(el, slots, source) {
    let out = '';
    for (const c of Array.from(el.childNodes)) {
      if (isText(c)) out += source && originals.text.has(c) ? originals.text.get(c) : c.nodeValue;
      else if (isElement(c)) {
        const n = slots.length;
        slots.push(c);
        if (OPAQUE.has(tag(c))) out += '<' + n + '/>';
        else out += '<' + n + '>' + serialize(c, slots, source) + '</' + n + '>';
      }
    }
    return out;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); };
  // Every slot must be opened and closed once, in order; checked before anything is moved.
  function arrangement(parts, count) {
    const seen = new Set(), open = [];
    for (const p of parts) {
      if (p.t === 'open') { if (p.n >= count || seen.has(p.n)) return false; seen.add(p.n); open.push(p.n); }
      else if (p.t === 'close') { if (open.pop() !== p.n) return false; }
      else if (p.t === 'self') { if (p.n >= count || seen.has(p.n)) return false; seen.add(p.n); }
    }
    return !open.length && seen.size === count;
  }
  function translateUnit(el) {
    const d = dictionaries[current];
    const slots = [];
    const raw = norm(serialize(el, slots));
    if (!CJK.test(raw) || slots.length > 24) return false;
    const hit = match(d, raw);
    if (!hit || !hit.entry.slotted || !arrangement(hit.entry.parts, slots.length)) return false;
    const doc = el.ownerDocument || root.document;
    const stack = [{ slot: null, nodes: [] }];
    const put = node => stack[stack.length - 1].nodes.push(node);
    for (const p of hit.entry.parts) {
      if (p.t === 'open') stack.push({ slot: slots[p.n], nodes: [] });
      else if (p.t === 'close') {
        const top = stack.pop();
        clear(top.slot);
        top.nodes.forEach(n => top.slot.appendChild(n));
        put(top.slot);
      } else if (p.t === 'self') put(slots[p.n]);
      else {
        const chunk = fill([p], hit.ctx);
        if (chunk) put(doc.createTextNode(chunk));
      }
    }
    if (!originals.units.has(el)) originals.units.set(el, Array.from(el.childNodes, c => c.cloneNode(true)));
    clear(el);
    stack[0].nodes.forEach(n => el.appendChild(n));
    return true;
  }
  function visit(el) {
    if (!isElement(el) || skipped(el)) return;
    translateAttrs(el);
    const kids = Array.from(el.childNodes);
    const hasElement = kids.some(isElement);
    if (hasElement && kids.some(c => isText(c) && CJK.test(c.nodeValue)) && kids.every(c => !isElement(c) || inlineContent(c)) && translateUnit(el)) {
      Array.from(el.childNodes).forEach(c => { if (isElement(c)) visit(c); });
      return;
    }
    for (const c of kids) {
      if (isText(c)) translateText(c);
      else if (isElement(c)) visit(c);
    }
  }
  function unitRoot(node) {
    let el = isElement(node) ? node : node.parentNode;
    while (el && el.parentNode && isElement(el.parentNode) && INLINE.has(tag(el))) el = el.parentNode;
    return el;
  }
  function restoreTree(rootNode) {
    const walk = node => {
      if (isText(node)) {
        if (originals.text.has(node)) { node.nodeValue = originals.text.get(node); written.text.delete(node); }
        return;
      }
      if (!isElement(node)) return;
      const unit = originals.units.get(node);
      if (unit) {
        originals.units.delete(node);
        clear(node);
        unit.forEach(c => node.appendChild(c));
      }
      const attrs = originals.attrs.get(node);
      if (attrs) { for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value); originals.attrs.delete(node); written.attrs.delete(node); }
      Array.from(node.childNodes).forEach(walk);
    };
    walk(rootNode);
  }

  /* ---------- Page ---------- */
  let observer = null, started = false, ready = false, pending = false;
  // Only English needs to watch the page; in Chinese the observer stays disconnected and nothing runs.
  function observe() {
    const { document } = env();
    if (!observer || !document || current !== 'en') return;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // Our own edits must not feed the observer again.
  function quietly(work) {
    if (observer) observer.disconnect();
    try { work(); } finally { observe(); }
  }
  function onMutations(records) {
    if (current === 'zh') return;
    const roots = new Set(), attrs = new Set();
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(n => { const u = unitRoot(n); if (u) roots.add(u); });
      else if (r.type === 'characterData') { const u = unitRoot(r.target); if (u) roots.add(u); }
      else if (r.type === 'attributes') attrs.add(r.target);
    }
    quietly(() => {
      roots.forEach(visit);
      attrs.forEach(el => { if (!skipped(el)) translateAttrs(el); });
    });
  }
  function translateMeta(document, back) {
    const meta = document.querySelector && document.querySelector('meta[name="description"]');
    if (!meta) return;
    const value = meta.getAttribute('content') || '';
    let saved = originals.attrs.get(meta);
    if (back) { if (saved && saved.content != null) meta.setAttribute('content', saved.content); return; }
    const en = translate(value);
    if (en == null) return;
    if (!saved) originals.attrs.set(meta, saved = {});
    if (!('content' in saved)) saved.content = value;
    meta.setAttribute('content', en);
  }
  function applyAll() {
    const { document } = env();
    if (!document) return;
    quietly(() => { visit(document.documentElement); translateMeta(document, false); });
  }
  function reflect() {
    const { document } = env();
    if (!document || !document.documentElement) return;
    document.documentElement.setAttribute('lang', HTML_LANG[current]);
    const buttons = document.querySelectorAll ? Array.from(document.querySelectorAll('[data-lang-set]')) : [];
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute('data-lang-set') === current)));
  }
  function remember(next) {
    const { location, history, storage } = env();
    try { storage && storage.setItem(STORAGE, next); } catch (_) {}
    try {
      const url = new URL(location.href);
      if (next === 'zh') url.searchParams.delete('lang'); else url.searchParams.set('lang', next);
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch (_) {}
  }
  function setLang(next, options = {}) {
    if (next !== 'zh' && next !== 'en') return current;
    const { document } = env();
    const changed = next !== current;
    current = next;
    if (options.persist !== false) remember(next);
    reflect();
    if (document && document.documentElement && (changed || options.force)) {
      if (observer) observer.takeRecords();
      if (next === 'zh') quietly(() => { restoreTree(document.documentElement); translateMeta(document, true); });
      else applyAll();
    }
    if (changed) listeners.slice().forEach(fn => { try { fn(next); } catch (_) {} });
    return current;
  }
  const onChange = fn => { listeners.push(fn); };
  function boot() {
    if (started) return;
    started = true;
    const { document } = env();
    const preferred = readPreference();
    current = preferred.lang;
    if (preferred.fromUrl) { try { const { storage } = env(); storage && storage.setItem(STORAGE, current); } catch (_) {} }
    if (!document) return;
    if (typeof root.MutationObserver === 'function') {
      observer = new root.MutationObserver(onMutations);
      observe();
    }
    reflect();
    document.addEventListener('click', event => {
      const button = event.target && event.target.closest && event.target.closest('[data-lang-set]');
      if (button) setLang(button.getAttribute('data-lang-set'));
    });
    // Deferred dictionary scripts run before DOMContentLoaded, so the first pass waits for it.
    const start = () => { ready = true; reflect(); if (current === 'en') applyAll(); };
    if (document.readyState === 'complete') start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // Audit: what is still Chinese on the page, grouped by sentence shape (numbers abstracted).
  function audit(rootNode) {
    const { document } = env();
    const top = rootNode || (document && document.documentElement);
    const found = new Map();
    const note = (key, kind, example, unit, current) => {
      const item = found.get(kind + '|' + key) || { key, kind, count: 0, example, unit, current };
      item.count++;
      found.set(kind + '|' + key, item);
    };
    // A half-translated text is reported by its original Chinese: that is the key a dictionary entry needs.
    const walk = node => {
      if (isText(node)) {
        if (!CJK.test(node.nodeValue) || skipped(node.parentNode)) return;
        const parent = node.parentNode;
        let unit = null;
        if (parent && Array.from(parent.childNodes).some(isElement) && Array.from(parent.childNodes).every(c => !isElement(c) || inlineContent(c))) {
          const slots = [];
          unit = tokenize(norm(serialize(parent, slots, true))).shape;
        }
        const source = originals.text.has(node) ? originals.text.get(node) : node.nodeValue;
        note(tokenize(norm(source)).shape, 'text', norm(source), unit, norm(node.nodeValue));
        return;
      }
      if (!isElement(node) || skipped(node)) return;
      const saved = originals.attrs.get(node) || {};
      for (const name of ATTRS) {
        const current = node.getAttribute(name);
        if (!current || !CJK.test(current)) continue;
        const value = name in saved ? saved[name] : current;
        note(tokenize(norm(value)).shape, 'attr:' + name, norm(value), null, norm(current));
      }
      Array.from(node.childNodes).forEach(walk);
    };
    if (top) walk(top);
    return Array.from(found.values()).sort((a, b) => b.count - a.count);
  }

  return { add, boot, lang, setLang, onChange, text, translate, tokenize, audit, available, norm, CJK,
    _internals: { compile, parseValue, match, dictionaries, visit, restoreTree, unitRoot, serialize, spaced, setCurrent: v => { current = v; } } };
});
