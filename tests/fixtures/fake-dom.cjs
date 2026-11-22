// A very small DOM: just what the interface-language layer touches (text and element nodes, attributes, a mutation observer).
class Node {
  constructor(type) { this.nodeType = type; this.parentNode = null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
}
class Text extends Node {
  constructor(value) { super(3); this.nodeValue = value; }
  get textContent() { return this.nodeValue; }
  cloneNode() { return new Text(this.nodeValue); }
}
class Element extends Node {
  constructor(tag, doc) { super(1); this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = new Map(); this.ownerDocument = doc; }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); node.parentNode = this; this.childNodes.push(node); return node; }
  removeChild(node) { const at = this.childNodes.indexOf(node); if (at >= 0) this.childNodes.splice(at, 1); node.parentNode = null; return node; }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  hasAttribute(name) { return this.attrs.has(name); }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
  cloneNode(deep) {
    const copy = new Element(this.tagName, this.ownerDocument);
    this.attrs.forEach((v, k) => copy.attrs.set(k, v));
    if (deep) this.childNodes.forEach(c => copy.appendChild(c.cloneNode(true)));
    return copy;
  }
  closest(selector) {
    const name = /\[(data-[a-z-]+)\]/.exec(selector)?.[1];
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (name && n.hasAttribute(name)) return n;
    return null;
  }
  // A tiny selector subset: meta[name="description"] and [data-lang-set].
  find(test, out = []) { if (test(this)) out.push(this); this.childNodes.forEach(c => c.nodeType === 1 && c.find(test, out)); return out; }
}
function createDocument() {
  const doc = { readyState: 'complete', listeners: {} };
  doc.documentElement = new Element('html', doc);
  doc.head = doc.documentElement.appendChild(new Element('head', doc));
  doc.body = doc.documentElement.appendChild(new Element('body', doc));
  doc.createTextNode = value => new Text(value);
  doc.createElement = tag => new Element(tag, doc);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] = doc.listeners[type] || []).push(fn); };
  doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
  doc.querySelectorAll = selector => {
    if (selector === 'meta[name="description"]') return doc.documentElement.find(e => e.tagName === 'META' && e.getAttribute('name') === 'description');
    const name = /^\[(data-[a-z-]+)\]$/.exec(selector)?.[1];
    return name ? doc.documentElement.find(e => e.hasAttribute(name)) : [];
  };
  return doc;
}
// h('p', { title: 'x' }, 'text', h('b', {}, '12'))
function h(doc, tag, attrs = {}, ...children) {
  const el = doc.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  children.forEach(c => el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c));
  return el;
}
class FakeObserver {
  constructor(callback) { this.callback = callback; this.active = false; FakeObserver.last = this; }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
  takeRecords() { return []; }
}
const html = node => node.nodeType === 3 ? node.nodeValue
  : '<' + node.tagName.toLowerCase() + [...node.attrs].map(([k, v]) => ' ' + k + '="' + v + '"').join('') + '>' + node.childNodes.map(html).join('') + '</' + node.tagName.toLowerCase() + '>';
module.exports = { createDocument, h, html, Text, Element, FakeObserver };
