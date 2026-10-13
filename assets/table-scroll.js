(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChanghengTables = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const HEIGHT = 20;
  function dockGeometry(rect, clip, viewportWidth, contentWidth, scrollLeft = 0) {
    const left = Math.max(rect.left, clip.left), right = Math.min(rect.left + viewportWidth, clip.right);
    const top = Math.max(rect.top, clip.top), bottom = Math.min(rect.bottom, clip.bottom);
    const width = right - left, maximum = contentWidth - viewportWidth;
    if (maximum <= 1 || width <= 40 || bottom - top < HEIGHT + 24) return null;
    const thumbWidth = Math.min(width, Math.max(32, width * viewportWidth / contentWidth));
    const value = Math.max(0, Math.min(maximum, scrollLeft));
    return { left, top: bottom - HEIGHT, width, maximum, value, thumbWidth,
      thumbLeft: (width - thumbWidth) * value / maximum };
  }
  const controllers = new Map();
  let observer, resize, frame, serial = 0;
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; controllers.forEach(update); });
  }
  function clipping(element) {
    const box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
        box.left = Math.max(box.left, rect.left); box.right = Math.min(box.right, rect.right);
      }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
        box.top = Math.max(box.top, rect.top); box.bottom = Math.min(box.bottom, rect.bottom);
      }
    }
    const comparison = document.querySelector('.compare-bar');
    if (comparison?.getClientRects().length) {
      const rect = comparison.getBoundingClientRect();
      if (rect.right > box.left && rect.left < box.right) box.bottom = Math.min(box.bottom, rect.top - 4);
    }
    return box;
  }
  function update(c) {
    const { wrap, table, track, thumb } = c;
    const wide = wrap.scrollWidth > wrap.clientWidth + 1;
    wrap.classList.toggle('table-scroll-managed', wide);
    let offset = 0;
    for (const row of table.tHead?.rows || []) {
      for (const cell of row.cells) cell.style.setProperty('--table-head-top', offset + 'px');
      offset += row.getBoundingClientRect().height;
    }
    wrap.style.setProperty('--table-head-size', offset + 'px');
    const rect = wrap.getBoundingClientRect();
    const modal = document.querySelector('dialog[open]'), parentModal = wrap.closest('dialog');
    const visible = wrap.getClientRects().length && (!parentModal || parentModal.open) && (!modal || parentModal === modal);
    const g = visible && dockGeometry(rect, clipping(wrap), wrap.clientWidth, wrap.scrollWidth, wrap.scrollLeft);
    c.geometry = g || null;
    track.hidden = !g;
    if (!g) return;
    track.style.left = g.left + 'px'; track.style.top = g.top + 'px'; track.style.width = g.width + 'px';
    thumb.style.width = g.thumbWidth + 'px'; thumb.style.transform = 'translateX(' + g.thumbLeft + 'px)';
    track.setAttribute('aria-valuemax', Math.round(g.maximum));
    track.setAttribute('aria-valuenow', Math.round(g.value));
    track.setAttribute('aria-valuetext', Math.round(g.value / g.maximum * 100) + '%');
  }
  function attach(wrap, table) {
    const track = document.createElement('div'), thumb = document.createElement('div');
    track.className = 'table-scroll-dock'; track.hidden = true; track.tabIndex = 0;
    track.setAttribute('role', 'scrollbar'); track.setAttribute('aria-orientation', 'horizontal');
    track.setAttribute('aria-valuemin', '0');
    const label = wrap.getAttribute('aria-label') || table.caption?.textContent ||
      wrap.closest('section')?.querySelector('h2')?.textContent || '数据表';
    track.setAttribute('aria-label', label.replace(/，?可横向滚动$/, '') + '横向滚动');
    if (!wrap.id) wrap.id = 'table-viewport-' + ++serial;
    track.setAttribute('aria-controls', wrap.id);
    thumb.className = 'table-scroll-thumb'; track.append(thumb);
    (wrap.closest('dialog') || document.body).append(track);
    const c = { wrap, table, track, thumb, geometry: null, drag: null };
    wrap.addEventListener('scroll', schedule, { passive: true });
    track.addEventListener('pointerdown', event => {
      const g = c.geometry;
      if (!g || event.button !== 0) return;
      event.preventDefault(); track.focus({ preventScroll: true });
      if (event.target !== thumb) {
        wrap.scrollLeft = (event.clientX - g.left - g.thumbWidth / 2) / (g.width - g.thumbWidth) * g.maximum;
      }
      c.drag = { x: event.clientX, value: wrap.scrollLeft };
      track.setPointerCapture(event.pointerId); update(c);
    });
    track.addEventListener('pointermove', event => {
      const g = c.geometry;
      if (!g || !c.drag) return;
      wrap.scrollLeft = c.drag.value + (event.clientX - c.drag.x) * g.maximum / (g.width - g.thumbWidth);
      update(c);
    });
    const stop = () => { c.drag = null; };
    track.addEventListener('pointerup', stop); track.addEventListener('lostpointercapture', stop);
    track.addEventListener('keydown', event => {
      const g = c.geometry;
      if (!g) return;
      const target = { ArrowLeft: g.value - 40, ArrowRight: g.value + 40,
        PageUp: g.value - wrap.clientWidth * .9, PageDown: g.value + wrap.clientWidth * .9,
        Home: 0, End: g.maximum }[event.key];
      if (target === undefined) return;
      event.preventDefault(); event.stopPropagation(); wrap.scrollLeft = target; update(c);
    });
    resize?.observe(wrap); resize?.observe(table);
    controllers.set(wrap, c);
  }
  function sync() {
    if (typeof document === 'undefined') return;
    if (!observer) {
      resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
      observer = new MutationObserver(sync);
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', schedule);
      document.addEventListener('scroll', schedule, { capture: true, passive: true });
      document.addEventListener('toggle', schedule, true);
      document.addEventListener('close', schedule, true);
    }
    controllers.forEach((c, wrap) => {
      if (!wrap.isConnected || !c.table.isConnected) {
        resize?.unobserve(wrap); resize?.unobserve(c.table); c.track.remove();
        wrap.removeEventListener('scroll', schedule); controllers.delete(wrap);
      }
    });
    document.querySelectorAll('.table-wrap').forEach(wrap => {
      const table = wrap.querySelector(':scope > table');
      if (!table) return;
      // Keep lazy loading inside the bounded viewport; the document footer no
      // longer runs away each time a new batch of fund/stock rows is appended.
      if (wrap.nextElementSibling?.matches('.load-footer')) wrap.append(wrap.nextElementSibling);
      if (!controllers.has(wrap)) attach(wrap, table);
    });
    controllers.forEach(update);
  }
  return { dockGeometry, sync };
});
