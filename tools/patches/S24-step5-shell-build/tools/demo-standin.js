/* demo-standin.js: stands in for the v5.11 page scripts in demo.html (S24 step 5). NOT shipped in the widget.
   The section markup in demo.html is the v5.11 widget's own, rendered once in ?preview=1 and frozen; this script only
   gives it the bits the shell reads (window.__bd, window.__bdcsUser), the theme switch and the collapse toggles.
   URL flags: ?theme=dark|light  ?asuser=1 (not an Administrator)  ?nouser=1 (user never resolves)  ?agerr=1 (collections read failed)
   ?coll=1 (one collections email waiting)  ?ag=empty (nothing dated today)  ?ag=never (agenda never loads)  ?sm=1 (Stock emails zone open)  ?sm=0 (no stock emails)
   ?ntdemo=1|err|empty (the real needs-today demo switch; 1 is added when absent). */
(function () {
  'use strict';
  var s = location.search, has = function (k, v) { return new RegExp('[?&]' + k + '=' + (v || '[^&]*') + '(&|$)').test(s); };
  if (!has('ntdemo')) { try { history.replaceState(null, '', location.pathname + (s ? s + '&' : '?') + 'ntdemo=1' + location.hash); s = location.search; } catch (e) {} }
  var root = document.documentElement;
  var t = /[?&]theme=(dark|light)/.exec(s); if (t) root.setAttribute('data-theme', t[1]);
  var $ = function (id) { return document.getElementById(id); };
  var tx = function (el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };

  function themeBtn() {
    var dark = root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    var b = $('theme-btn'); if (b) { b.setAttribute('aria-pressed', String(dark)); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
  }
  function applyTheme(c) { if (c === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', c); themeBtn(); }

  document.addEventListener('DOMContentLoaded', function () {
    themeBtn();
    var tb = $('theme-btn'); if (tb) tb.addEventListener('click', function () { applyTheme(tb.getAttribute('aria-pressed') === 'true' ? 'light' : 'dark'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (b) { b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-choice')); }); });

    if (has('sm', '1')) $('z-sm').hidden = false;
    if (has('sm', '0')) $('sm-list').innerHTML = '<li class="sm-empty">No stock emails are waiting for approval.</li>';

    /* collapse toggles: same attributes the kit writes, same per-browser entry */
    var KEY = (document.title || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-layout';
    var IDS = { 'queue-card': 'queue', 'z-fu': 'bd-followups', 'z-rel': 'bd-rel', 'z-num': 'bd-numbers', 'z-boards': 'bd-boards' };
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.hl-tg'); if (!b) return;
      var box = b.closest('[data-collapsed]'); if (!box) return;
      var on = box.getAttribute('data-collapsed') !== 'true', label = (b.getAttribute('aria-label') || '').replace(/^(Show|Hide) /, '');
      box.setAttribute('data-collapsed', on ? 'true' : 'false');
      b.parentNode.classList.toggle('hl-collapsed', on);
      b.setAttribute('aria-expanded', String(!on)); b.title = (on ? 'Show ' : 'Hide ') + label; b.setAttribute('aria-label', b.title);
      var k = b.getAttribute('data-bdcs') || IDS[box.id] || (box.matches('.vendors') ? 'vendors' : 'links');
      var st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (x) {}
      st[k] = on; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (x) {}
    });
    /* agenda tabs and rows: enough for the shell's fallback to click */
    $('agenda-card').addEventListener('click', function (e) {
      var tb2 = e.target.closest('[data-agtab]');
      if (tb2) Array.prototype.forEach.call(document.querySelectorAll('[data-agtab]'), function (x) { x.setAttribute('aria-selected', String(x === tb2)); x.tabIndex = x === tb2 ? 0 : -1; });
      var row = e.target.closest('.ag-row'); if (row) window.__demoOpened = row.getAttribute('data-agk');
    });

    /* the page's hooks, published a moment after load, as the live page does */
    setTimeout(function () {
      if (has('nouser')) return;
      window.__bdcsUser = { id: '6715134000000503001', full_name: 'Beau Carrigan', email: 'beau@example.org', profile: { name: has('asuser', '1') ? 'Standard' : 'Administrator', id: '1' } };
    }, 300);
    var mineN = parseInt(tx($('scope-mine-n')), 10) || 0, all = [];
    for (var i = 0; i < mineN; i++) all.push({ id: 'c' + i, Status: 'New', __mine: true });
    all.push({ id: 'cx', Status: 'New', __mine: false });
    window.__bd = { AG: { data: null }, Q: { all: all } };
    if (has('ag', 'never')) { Array.prototype.forEach.call(document.querySelectorAll('#agenda-card [data-agtab] .n'), function (n) { n.textContent = ''; }); return; }
    setTimeout(function () {
      var empty = has('ag', 'empty'), items = [];
      if (!empty) Array.prototype.forEach.call(document.querySelectorAll('#ag-list [data-agk]'), function (r) {
        var k = r.getAttribute('data-agk').split(':');
        items.push({ src: k[0], id: k.slice(1).join(':'), title: tx(r.querySelector('.t b')), account: tx(r.querySelector('.t .s')), bucket: 'today', overdue: r.classList.contains('sig-over') });
      });
      if (empty) $('ag-list').innerHTML = '<p class="empty fine">Nothing due today. Nice.</p>';
      var nd = new Date(), ym = nd.getFullYear() + '-' + ('0' + (nd.getMonth() + 1)).slice(-2);
      var coll = has('coll', '1') ? [{ id: '6715134000011000001', Name: 'Marathon County, 61-90 days', Email_Status: 'Awaiting approval' }]
        : [{ id: '6715134000011000001', Name: 'Marathon County, 61-90 days', Email_Status: 'Awaiting approval' }, { id: '6715134000011000002', Name: 'Iowa County, 91+ days', Email_Status: 'Awaiting approval' }];
      window.__bd.AG.data = {
        items: items, counts: { today: empty ? 0 : (parseInt(tx(document.querySelector('#ag-tab-today .n')), 10) || items.length), week: 1, weekly: 1, monthly: 1 },
        errors: has('agerr', '1') ? ['Collections'] : [],
        raw: { cases: [], collections: has('agerr', '1') ? null : (empty ? [] : coll), billing: empty ? [] : [{ id: '6715134000012000001', Name: 'Billing ' + ym, Period: ym, Period_Status: 'Draft' }] }
      };
    }, 400);
  });
})();
