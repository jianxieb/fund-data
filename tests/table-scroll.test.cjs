const test = require('node:test');
const assert = require('node:assert/strict');
const { dockGeometry } = require('../assets/table-scroll.js');
const clip = { left: 0, top: 0, right: 1920, bottom: 1080 };

test('a tall table keeps its scroll control at the visible viewport bottom', () => {
  const dock = dockGeometry({ left: 280, top: 400, bottom: 5000 }, clip, 1400, 2300, 450);
  assert.equal(dock.top, 1060);
  assert.equal(dock.left, 280);
  assert.equal(dock.width, 1400);
  assert.equal(dock.maximum, 900);
  assert.equal(dock.thumbLeft, (1400 - dock.thumbWidth) / 2);
});
test('a shorter table and a scrolled dialog use their own visible bottom', () => {
  const rect = { left: 350, top: 200, bottom: 680 };
  assert.equal(dockGeometry(rect, clip, 1100, 2000).top, 660);
  const dialog = { left: 300, top: 160, right: 1600, bottom: 550 };
  assert.equal(dockGeometry(rect, dialog, 1100, 2000).top, 530);
});
test('controls disappear for hidden, fitting or barely visible tables', () => {
  assert.equal(dockGeometry({ left: 280, top: 1100, bottom: 5000 }, clip, 1400, 2300), null);
  assert.equal(dockGeometry({ left: 280, top: 100, bottom: 400 }, clip, 1400, 1400), null);
  assert.equal(dockGeometry({ left: 280, top: 1060, bottom: 5000 }, clip, 1400, 2300), null);
});
test('scroll positions and thumb proportions follow changed columns and lazy rows', () => {
  const rect = { left: 280, top: -300, bottom: 650 };
  const old = dockGeometry(rect, clip, 1000, 2000, 1000);
  assert.equal(old.thumbLeft, old.width - old.thumbWidth);
  const smaller = dockGeometry(rect, clip, 1000, 1300, 1000);
  assert.equal(smaller.value, 300);
  assert.ok(Math.abs(smaller.thumbLeft - (smaller.width - smaller.thumbWidth)) < 1e-9);
  const growing = dockGeometry(rect, clip, 1000, 2400, -20);
  assert.equal(growing.value, 0);
  assert.equal(growing.thumbLeft, 0);
});
