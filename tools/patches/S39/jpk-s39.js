/* jpk-s39.js v1.0.0 (S39, 27 Oct 2026): BD Home boards follow CS Home's S33 item 6.
   1. Board numbers: at most five tiles show on a board; any more sit behind "Show all numbers (n more)" in the Boards band
      (the choice is kept per person in this browser, as on CS). No BD board has more than five today, so the button stays hidden
      until one does. The EM customer health bar counts as one tile, as on CS.
   2. One health chip per board row: when a row has a reason chip (Cold, No Logged Touch, Fresh...), the colour word is hidden
      on screen (screen readers still read it); the dot stays. Same markup and rule as CS (jpk-s33 health()).
   No data reads, no writes. Hide, don't delete. Off switch: ?s39=0 (also restores the old Follow-ups renewal window). */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc || root.JPKS39) return;
  if (/[?&]s39=0\b/.test(root.location.search)) { root.JPKS39 = { version: '1.0.0', off: true }; return; }
  var VERSION = '1.0.0', MORE_KEY = 'jpk-s39-morenums', CAP = 5;
  var html = doc.documentElement;
  function $(id) { return doc.getElementById(id); }
  function q(s, r) { try { return (r || doc).querySelector(s); } catch (e) { return null; } }
  function qa(s, r) { try { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); } catch (e) { return []; } }
  function flag(el, name, on) { if (!el) return; if (on) { if (!el.hasAttribute(name)) el.setAttribute(name, ''); } else if (el.hasAttribute(name)) el.removeAttribute(name); }
  var store = {
    get: function (k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- 1. five tiles, then "Show all numbers" ---------- */
  function tiles() {
    var nums = $('nums'); if (!nums) return [];
    return qa(':scope > .kpi', nums).filter(function (t) {
      if (t.hasAttribute('data-s39-x')) return true;                 /* hidden by this layer: still a tile */
      return getComputedStyle(t).display !== 'none';                 /* hidden by another layer (S38's 90-day tile): not counted */
    });
  }
  function cap() {
    var list = tiles(), extra = 0;
    list.forEach(function (t, i) { var x = i >= CAP; flag(t, 'data-s39-x', x); if (x) extra++; });
    moreBtn(extra);
  }
  function moreBtn(extra) {
    var band = q('#z-boards > .band'); if (!band) return;
    var b = $('s39-more');
    if (!b) {
      b = doc.createElement('button'); b.type = 'button'; b.id = 's39-more'; b.className = 's39-more'; b.setAttribute('aria-controls', 'nums');
      b.addEventListener('click', function () { setMore(!html.hasAttribute('data-s39-more')); });
      band.appendChild(b);
    }
    var on = html.hasAttribute('data-s39-more');
    var t = on ? 'Show fewer numbers' : 'Show all numbers (' + extra + ' more)';
    if (b.textContent !== t) b.textContent = t;
    b.setAttribute('aria-expanded', String(on));
    b.hidden = !extra;
  }
  function setMore(on) { flag(html, 'data-s39-more', on); store.set(MORE_KEY, on ? '1' : '0'); cap(); }

  /* ---------- 2. one health chip per row ---------- */
  function health() {
    qa('#board tbody td[title*="ustomer health"]').forEach(function (td) {
      if (!td.__s39) {
        Array.prototype.slice.call(td.childNodes).forEach(function (n) {
          if (n.nodeType === 3 && n.textContent.trim()) { var s = doc.createElement('span'); s.className = 's39-hw'; td.insertBefore(s, n); s.appendChild(n); }
        });
        td.__s39 = 1;
      }
      var hasR = !!q('.tchip, .s28-pill, .pill, .chip', td);
      if (td.classList.contains('s39-hasr') !== hasR) td.classList.toggle('s39-hasr', hasR);
    });
  }

  function ensure() {
    if (html.getAttribute('data-s39') !== 'on') html.setAttribute('data-s39', 'on');
    try { cap(); } catch (e) {}
    try { health(); } catch (e) {}
  }
  var obs = null;
  function start() {
    var z = $('z-boards');
    if (!z) { setTimeout(start, 300); return; }
    if (store.get(MORE_KEY) === '1') flag(html, 'data-s39-more', true);
    ensure();
    try {
      obs = new MutationObserver(function () { clearTimeout(obs.__t); obs.__t = setTimeout(ensure, 40); });
      obs.observe(z, { childList: true, subtree: true });
    } catch (e) { setInterval(ensure, 700); }
  }
  root.JPKS39 = { version: VERSION, build: 'S39 BD boards: five tiles and one health chip, 27 Oct 2026', ensure: ensure, setMore: setMore, cap: CAP };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
