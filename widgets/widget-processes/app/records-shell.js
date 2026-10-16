/* records-shell.js (jpk-theme v3, 15 Oct 2026): the left rail for Records / Support Process / Processes.
   Renders once into #rail: tri-brand logo, brand scope switcher (JPK.brand), module navigation grouped by
   RECORDS_TAB (or by module .group when RECORDS_GROUPED). records.js calls RecShell.init(...) at start and
   RecShell.setCurrent(key) whenever the module changes. Test hooks: #rail .swb[data-m], #rail [data-g]. */
(function (root) {
  'use strict';
  var ICONS = {
    accounts: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6', contacts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    deals: 'M4 19h16M6 16V9M10 16V5M14 16v-6M18 16v-3', contracts: 'M6 3h9l5 5v13H6zM14 3v6h6M9 13h6M9 17h6',
    onboarding: 'M4 12l5 5L20 6', vendor_pricing: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4', cases: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16',
    triage: 'M3 5h18v14H3zM3 7l9 6 9-6', billing: 'M3 5h18v14H3zM3 10h18M7 15h4', billing_run: 'M5 3l14 9-14 9z', billing_flow: 'M4 6h16M4 12h10M4 18h7',
    billing_findings: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5', p_contract: 'M6 3h9l5 5v13H6zM14 3v6h6', contract_ingest: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    p_solicit: 'M4 4h16v12H4zM8 20h8M12 16v4', guide_contract: 'M5 4h14v16H5zM9 9h6M9 13h6', guide_billing: 'M5 4h14v16H5zM9 9h6M9 13h6', solicit_new: 'M12 5v14M5 12h14', _: 'M4 6h16M4 12h16M4 18h16'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function icon(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (ICONS[k] || ICONS._) + '"/></svg>'; }

  var S = { el: null, mods: null, sw: [], grouped: false, cur: null, onSwitch: null, brand: null };

  function label(m) { return m.swLabel || m.title; }
  function navHtml() {
    var h = '';
    if (S.grouped) {
      var groups = [], seen = {};
      S.sw.forEach(function (k) { var g = S.mods[k].group || 'Other'; if (!seen[g]) { seen[g] = []; groups.push(g); } seen[g].push(k); });
      groups.forEach(function (g) {
        h += '<button type="button" class="grp gbtn" data-g="' + esc(g) + '">' + esc(g) + '</button>';
        seen[g].forEach(function (k) { h += item(k); });
      });
    } else {
      h += '<div class="grp">' + esc(S.tab || 'Modules') + '</div>';
      S.sw.forEach(function (k) { h += item(k); });
    }
    return h;
  }
  function item(k) {
    var m = S.mods[k];
    return '<button type="button" class="nav swb" data-m="' + esc(k) + '" aria-current="' + (k === S.cur ? 'page' : 'false') + '">' + icon(k) + '<span class="nl">' + esc(label(m)) + '</span><span class="cnt" data-cnt="' + esc(k) + '"></span></button>';
  }
  function paintCurrent() {
    if (!S.el) return;
    Array.prototype.forEach.call(S.el.querySelectorAll('.swb[data-m]'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-m') === S.cur ? 'page' : 'false'); });
    if (S.grouped) { var g = S.mods[S.cur] && S.mods[S.cur].group; Array.prototype.forEach.call(S.el.querySelectorAll('[data-g]'), function (b) { b.classList.toggle('on', b.getAttribute('data-g') === g); }); }
    var c = S.el.querySelector('.swb[aria-current="page"]'); if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
  }

  function init(o) {
    S.el = o.el || document.getElementById('rail'); if (!S.el) return null;
    S.mods = o.mods; S.sw = o.sw || Object.keys(o.mods); S.grouped = !!o.grouped; S.tab = o.tab; S.cur = o.current; S.onSwitch = o.onSwitch;
    S.el.innerHTML = '<div class="logo"><img src="jpk-logo.png" alt="The Difference Principle, JusticePoint, Sirona Recovery"></div><div id="brand"></div>' + navHtml() +
      '<div class="me" id="me"></div>';
    if (root.JPK && root.JPK.brand) {
      S.brand = root.JPK.brand({ mount: S.el.querySelector('#brand'), onChange: function (k, b) { if (o.onBrand) o.onBrand(k, b); } });
    } else { S.el.querySelector('#brand').hidden = true; }
    S.el.addEventListener('click', function (e) {
      var g = e.target.closest('[data-g]');
      if (g) { var first = S.sw.filter(function (k) { return S.mods[k].group === g.getAttribute('data-g'); })[0]; if (first && first !== S.cur && S.onSwitch) S.onSwitch(first); return; }
      var b = e.target.closest('.swb[data-m]'); if (!b) return;
      var k = b.getAttribute('data-m'); if (k !== S.cur && S.onSwitch) S.onSwitch(k);
    });
    paintCurrent();
    return api;
  }
  function setCurrent(k) { if (S.mods && S.mods[k]) { S.cur = k; paintCurrent(); } }
  function setUser(name) { var me = S.el && S.el.querySelector('#me'); if (!me) return; if (!name) { me.hidden = true; return; } me.hidden = false; var ini = String(name).split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase(); me.innerHTML = '<span class="av">' + esc(ini) + '</span><span class="nl">' + esc(name) + '</span>'; }
  function setCount(k, n) { var c = S.el && S.el.querySelector('[data-cnt="' + k + '"]'); if (c) c.textContent = n == null || n === '' ? '' : String(n); }
  var api = { init: init, setCurrent: setCurrent, setUser: setUser, setCount: setCount, brand: function () { return S.brand; } };
  root.RecShell = api;
})(window);
