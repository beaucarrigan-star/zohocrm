/* jpk-s48.js v1.0.0 (S48, 30 Oct 2026): easier Date, Starts and Ends on the New meeting form.
   The native date and time inputs stay in the form (hidden) and keep carrying the values, so saving, the voice fill
   (S36/S37) and the end-follows-start rule work as before. Each gets a picker button that opens on a click anywhere on it:
   a small month for the date (with Today and Tomorrow), a 15-minute list for Starts, and for Ends a list that shows the
   length of each choice, plus length chips (15 min to 2 hr). Placed in <head> so its keyboard listener runs before the
   popout's own (Esc and the arrow keys inside a picker belong to the picker). Off switch: ?s48=0. */
(function () {
  'use strict';
  if (/[?&]s48=0\b/.test(location.search)) return;
  var R = document.documentElement;
  R.setAttribute('data-s48', 'on');
  var LENGTHS = [15, 30, 45, 60, 90, 120];
  var ICON = {
    cal: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>',
    clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg>',
    cv: '<svg class="s48-cv" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
    prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
    next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>'
  };
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function mins(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function hm(n) { return pad(Math.floor(n / 60)) + ':' + pad(n % 60); }
  function t12(n) { var h = Math.floor(n / 60), m = n % 60; return (h % 12 || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function len(d) { if (d < 60) return d + ' min'; var h = Math.floor(d / 60), m = d % 60; return m ? (m === 30 ? h + '½ hr' : h + ' hr ' + m + ' min') : h + ' hr'; }
  function dayText(s) { var d = parseDay(s); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Pick a date'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  var VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  /* repaint whenever code (formOpen, the voice fill) sets the value */
  function watch(inp, cb) {
    try {
      Object.defineProperty(inp, 'value', { configurable: true, get: function () { return VALUE.get.call(this); }, set: function (v) { VALUE.set.call(this, v); try { cb(); } catch (e) {} } });
    } catch (e) {}
    inp.addEventListener('input', cb); inp.addEventListener('change', cb);
  }
  function setNative(inp, v) {
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function focusIt(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }

  function pickBtn(icon, label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 's48-pick'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = icon + '<span class="s48-v"></span>' + ICON.cv;
    b.setAttribute('data-s48-label', label);
    return b;
  }
  /* <label class="jpk-mo-fl">Date<input></label> -> <div class="jpk-mo-fl s48-f"><span>Date</span><input hidden><button></div>
     (a label would hand every click to the hidden input) */
  function relabel(inp, label, icon) {
    var lab = inp.closest('label');
    var box = document.createElement('div');
    box.className = (lab ? lab.className : 'jpk-mo-fl') + ' s48-f';
    var sp = document.createElement('span'); sp.textContent = label; sp.id = 's48-l-' + inp.name;
    var b = pickBtn(icon, label); b.setAttribute('aria-labelledby', sp.id + ' ' + (sp.id + '-v'));
    b.querySelector('.s48-v').id = sp.id + '-v';
    box.appendChild(sp);
    if (lab) lab.parentNode.replaceChild(box, lab); else inp.parentNode.insertBefore(box, inp);
    box.appendChild(inp); box.appendChild(b);
    inp.classList.add('s48-native'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    inp.addEventListener('focus', function () { focusIt(b); });     /* formSave focuses the field it complains about */
    return b;
  }

  function enhance(f) {
    if (f.getAttribute('data-s48')) return;
    var d = f.querySelector('input[name="d"]'), s = f.querySelector('input[name="s"]'), e = f.querySelector('input[name="e"]');
    if (!d || !s || !e) return;
    f.setAttribute('data-s48', '1');
    var S = { f: f, d: d, s: s, e: e, open: null, view: null };
    var drow = d.closest('.jpk-mo-frow'), trow = s.closest('.jpk-mo-frow');
    var mv = f.querySelector('select[name="mv"]'), mrow = mv && mv.closest('.jpk-mo-frow');
    if (mrow) mrow.classList.add('s48-one');
    S.bd = relabel(d, 'Date', ICON.cal); S.bs = relabel(s, 'Starts', ICON.clock); S.be = relabel(e, 'Ends', ICON.clock);
    if (drow) drow.classList.add('s48-daterow');

    S.pd = document.createElement('div'); S.pd.className = 's48-panel s48-pdate'; S.pd.hidden = true; S.pd.setAttribute('role', 'dialog'); S.pd.setAttribute('aria-label', 'Pick the date');
    if (drow) drow.appendChild(S.pd); else S.bd.parentNode.appendChild(S.pd);
    S.chips = document.createElement('div'); S.chips.className = 's48-chips'; S.chips.setAttribute('role', 'group'); S.chips.setAttribute('aria-label', 'Meeting length');
    S.pt = document.createElement('div'); S.pt.className = 's48-panel s48-ptime'; S.pt.hidden = true; S.pt.setAttribute('role', 'dialog');
    if (trow) { trow.appendChild(S.chips); trow.appendChild(S.pt); } else { S.be.parentNode.appendChild(S.chips); S.be.parentNode.appendChild(S.pt); }

    S.bd.addEventListener('click', function () { toggle(S, 'd'); });
    S.bs.addEventListener('click', function () { toggle(S, 's'); });
    S.be.addEventListener('click', function () { toggle(S, 'e'); });
    S.pd.addEventListener('click', function (ev) { dateClick(S, ev); });
    S.pt.addEventListener('click', function (ev) { timeClick(S, ev); });
    S.chips.addEventListener('click', function (ev) {
      var c = ev.target.closest && ev.target.closest('[data-s48-len]'); if (!c || c.disabled) return;
      var a = mins(S.s.value); if (a == null) return;
      setNative(S.e, hm(a + (+c.getAttribute('data-s48-len'))));
      if (S.open === 'e') paintTime(S, 'e');
    });
    var paint = function () { paintAll(S); };
    watch(d, paint); watch(s, paint); watch(e, paint);
    f.addEventListener('reset', function () { setTimeout(function () { close(S, false); paintAll(S); }, 0); });
    f.addEventListener('submit', function () { close(S, false); }, true);
    f.s48 = S;
    paintAll(S);
  }

  function paintAll(S) {
    S.bd.querySelector('.s48-v').textContent = dayText(S.d.value);
    var a = mins(S.s.value), b = mins(S.e.value);
    S.bs.querySelector('.s48-v').textContent = a == null ? 'Pick a time' : t12(a);
    S.be.querySelector('.s48-v').textContent = b == null ? 'Pick a time' : t12(b);
    S.be.classList.toggle('s48-bad', a != null && b != null && b <= a);
    var cur = a != null && b != null ? b - a : null;
    S.chips.innerHTML = '<span>Length</span>' + LENGTHS.map(function (n) {
      var off = a == null || a + n > 23 * 60 + 59;
      return '<button type="button" class="s48-chip" data-s48-len="' + n + '" aria-pressed="' + (cur === n) + '"' + (off ? ' disabled' : '') + '>' + len(n) + '</button>';
    }).join('');
    if (S.open === 'd') paintDate(S);
  }

  function toggle(S, which) { if (S.open === which) close(S, true); else openP(S, which); }
  function btnOf(S, w) { return w === 'd' ? S.bd : w === 's' ? S.bs : S.be; }
  function close(S, refocus) {
    var w = S.open; if (!w) return;
    S.open = null; S.pd.hidden = true; S.pt.hidden = true;
    [S.bd, S.bs, S.be].forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (refocus) focusIt(btnOf(S, w));
  }
  function openP(S, w) {
    close(S, false);
    S.open = w; btnOf(S, w).setAttribute('aria-expanded', 'true');
    if (w === 'd') { var d = parseDay(S.d.value) || new Date(); S.view = new Date(d.getFullYear(), d.getMonth(), 1); paintDate(S); S.pd.hidden = false; focusIt(S.pd.querySelector('.s48-day[aria-selected="true"]') || S.pd.querySelector('.s48-day.s48-today') || S.pd.querySelector('.s48-day:not(.s48-out)')); }
    else { paintTime(S, w); S.pt.hidden = false; var sel = S.pt.querySelector('.s48-opt[aria-selected="true"]'); scrollList(S, sel); focusIt(sel || S.pt.querySelector('.s48-opt')); }
  }

  /* ---- date ---- */
  function paintDate(S) {
    var v = S.view, sel = S.d.value, today = ymd(new Date());
    var first = new Date(v.getFullYear(), v.getMonth(), 1), start = addDays(first, -first.getDay()), cells = '';
    for (var i = 0; i < 42; i++) {
      var x = addDays(start, i), k = ymd(x), out = x.getMonth() !== v.getMonth();
      if (i === 35 && out) break;                                   /* five rows when the month fits */
      cells += '<button type="button" class="s48-day' + (out ? ' s48-out' : '') + (k === today ? ' s48-today' : '') + '" data-s48-day="' + k + '" aria-selected="' + (k === sel) + '"'
        + ' tabindex="' + (k === sel ? '0' : '-1') + '" aria-label="' + esc(x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })) + (k === today ? ', today' : '') + '">' + x.getDate() + '</button>';
    }
    var t = new Date(), tm = addDays(t, 1), nm = addDays(t, ((8 - t.getDay()) % 7) || 7);
    S.pd.innerHTML = '<div class="s48-phead"><button type="button" class="s48-dnav" data-s48-dm="-1" aria-label="Previous month">' + ICON.prev + '</button>'
      + '<span class="s48-dmon" aria-live="polite">' + MON[v.getMonth()] + ' ' + v.getFullYear() + '</span>'
      + '<button type="button" class="s48-dnav" data-s48-dm="1" aria-label="Next month">' + ICON.next + '</button></div>'
      + '<div class="s48-dow" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>'
      + '<div class="s48-dgrid">' + cells + '</div>'
      + '<div class="s48-quick"><button type="button" class="s48-chip" data-s48-day="' + ymd(t) + '" aria-pressed="' + (sel === ymd(t)) + '">Today</button>'
      + '<button type="button" class="s48-chip" data-s48-day="' + ymd(tm) + '" aria-pressed="' + (sel === ymd(tm)) + '">Tomorrow</button>'
      + '<button type="button" class="s48-chip" data-s48-day="' + ymd(nm) + '" aria-pressed="' + (sel === ymd(nm)) + '">Next Monday</button></div>';
  }
  function dateClick(S, ev) {
    var t = ev.target.closest ? ev.target : null; if (!t) return;
    var nav = t.closest('[data-s48-dm]');
    if (nav) { S.view = new Date(S.view.getFullYear(), S.view.getMonth() + (+nav.getAttribute('data-s48-dm')), 1); paintDate(S); focusIt(S.pd.querySelector('[data-s48-dm="' + nav.getAttribute('data-s48-dm') + '"]')); return; }
    var day = t.closest('[data-s48-day]');
    if (day) { setNative(S.d, day.getAttribute('data-s48-day')); close(S, true); }
  }
  function dateKey(S, e, t) {
    var k = e.key, day = t.closest && t.closest('.s48-day');
    var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k];
    if (day && step) {
      var d = addDays(parseDay(day.getAttribute('data-s48-day')), step), key = ymd(d);
      if (d.getMonth() !== S.view.getMonth() || !S.pd.querySelector('[data-s48-day="' + key + '"].s48-day')) { S.view = new Date(d.getFullYear(), d.getMonth(), 1); paintDate(S); }
      var nb = S.pd.querySelector('.s48-day[data-s48-day="' + key + '"]:not(.s48-out)') || S.pd.querySelector('.s48-day[data-s48-day="' + key + '"]');
      focusIt(nb); return true;
    }
    if (k === 'PageUp' || k === 'PageDown') { S.view = new Date(S.view.getFullYear(), S.view.getMonth() + (k === 'PageUp' ? -1 : 1), 1); paintDate(S); focusIt(S.pd.querySelector('.s48-day:not(.s48-out)')); return true; }
    return false;
  }

  /* ---- time ---- */
  function paintTime(S, w) {
    var a = mins(S.s.value), cur = mins((w === 's' ? S.s : S.e).value), list = [], i;
    if (w === 's') { for (i = 0; i < 24 * 60; i += 15) list.push(i); }
    else { var from = a == null ? 0 : a + 15; for (i = from; i < 24 * 60; i += 15) list.push(i); if (!list.length && a != null && a < 23 * 60 + 59) list.push(23 * 60 + 59); }
    if (cur != null && list.indexOf(cur) < 0 && (w === 's' || a == null || cur > a)) { list.push(cur); list.sort(function (x, y) { return x - y; }); }
    S.pt.setAttribute('aria-label', w === 's' ? 'Pick the start time' : 'Pick the end time');
    S.pt.setAttribute('data-s48-w', w);
    S.pt.innerHTML = '<div class="s48-phead"><span>' + (w === 's' ? 'Starts' : 'Ends') + '</span><span>' + (w === 'e' && a != null ? 'after ' + t12(a) : '') + '</span></div>'
      + '<div class="s48-tlist" role="listbox" aria-label="' + (w === 's' ? 'Start times' : 'End times') + '">' + list.map(function (n) {
        return '<button type="button" class="s48-opt" role="option" data-s48-t="' + n + '" aria-selected="' + (n === cur) + '" tabindex="' + (n === cur ? '0' : '-1') + '">' + t12(n)
          + (w === 'e' && a != null ? '<i>' + len(n - a) + '</i>' : '') + '</button>';
      }).join('') + (list.length ? '' : '<p class="s48-opt">No later time today</p>') + '</div>';
  }
  function scrollList(S, sel) {
    var box = S.pt.querySelector('.s48-tlist'); if (!box) return;
    var target = sel || box.querySelector('[data-s48-t="' + (8 * 60) + '"]');
    if (target) box.scrollTop = Math.max(0, target.offsetTop - box.offsetTop - 2 * target.offsetHeight);
  }
  function timeClick(S, ev) {
    var o = ev.target.closest && ev.target.closest('[data-s48-t]'); if (!o) return;
    var w = S.pt.getAttribute('data-s48-w'), n = +o.getAttribute('data-s48-t');
    setNative(w === 's' ? S.s : S.e, hm(n));
    close(S, true);
  }
  function timeKey(S, e, t) {
    var k = e.key, o = t.closest && t.closest('.s48-opt'); if (!o) return false;
    var all = Array.prototype.slice.call(S.pt.querySelectorAll('.s48-opt[data-s48-t]')), i = all.indexOf(o);
    var j = k === 'ArrowDown' ? i + 1 : k === 'ArrowUp' ? i - 1 : k === 'PageDown' ? i + 8 : k === 'PageUp' ? i - 8 : k === 'Home' ? 0 : k === 'End' ? all.length - 1 : null;
    if (j == null) return false;
    focusIt(all[Math.max(0, Math.min(all.length - 1, j))]); return true;
  }

  /* keys inside a picker: capture phase on window, registered before the popout's listener */
  window.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var f = t.closest('form[data-s48]'), S = f && f.s48; if (!S) return;
    var inPanel = t.closest('.s48-panel'), onBtn = t.classList && t.classList.contains('s48-pick');
    if (!inPanel && !onBtn) return;
    var stop = function () { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === 'Escape' && S.open) { stop(); close(S, true); return; }
    if (onBtn && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !S.open) { stop(); t.click(); return; }
    if (inPanel && S.open === 'd' && dateKey(S, e, t)) { stop(); return; }
    if (inPanel && S.open !== 'd' && timeKey(S, e, t)) { stop(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.stopImmediatePropagation(); return; }   /* the button's own click does the work */
    if (e.key.length === 1) e.stopImmediatePropagation();                               /* no single-key page shortcuts from inside a picker */
  }, true);
  /* a click outside an open picker closes it */
  document.addEventListener('click', function (e) {
    var fs = document.querySelectorAll('form[data-s48]');
    for (var i = 0; i < fs.length; i++) {
      var S = fs[i].s48; if (!S || !S.open) continue;
      var t = e.target, inside = t && t.closest && (t.closest('.s48-panel') || t.closest('.s48-pick') || t.closest('.s48-chips'));
      if (!inside) close(S, false);
    }
  }, true);

  function scan() { var fs = document.querySelectorAll('form.jpk-mo-form:not([data-s48])'); for (var i = 0; i < fs.length; i++) enhance(fs[i]); }
  function boot() {
    scan();
    try { new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].addedNodes.length) { scan(); return; } }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.jpkS48 = { version: 'jpk-s48 v1.0.0', enhance: enhance };
})();
