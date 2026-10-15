/* jpk-brand.js (15 Oct 2026): brand scope switcher for jpk-theme-v3.
   Standalone; adds JPK.brand without changing jpk.js v1.1.0.
   Load after jpk.js. Markup it renders uses .sw / .swmenu / .smark / .cnt from jpk-theme-v3.css.

   var scope = JPK.brand({
     mount: document.getElementById('brand'),      // the rail slot
     onChange: function (key, brand) { reload(); }, // called after the user picks (not on init)
     storageKey: 'jpk-brand'                        // localStorage key; set null to not persist
   });
   scope.get()                 // 'all' | 'jp' | 'sr' | 'dp'
   scope.set('sr', {silent})   // programmatic change; fires onChange unless silent
   scope.setCounts({all:142, jp:96, sr:28, dp:18})
   scope.where('Brand')        // COQL criteria for the current scope on a Brand field, or '' for all
   scope.where('Account_Name.Brand')  // same, through a lookup (Contacts, Deals, Cases)
   scope.label()               // 'Sirona Recovery'

   The Brand field on Accounts is a formula with four values; the JusticePoint scope covers two of them.
*/
(function (root) {
  'use strict';
  var BRANDS = [
    { key: 'all', label: 'All brands', mark: 'All', values: null },
    { key: 'jp', label: 'JusticePoint', mark: 'JP', values: ['JusticePoint EM', 'JusticePoint Programs'] },
    { key: 'sr', label: 'Sirona Recovery', mark: 'SR', values: ['Sirona Recovery'] },
    { key: 'dp', label: 'The Difference Principle', mark: 'DP', values: ['The Difference Principle'] }
  ];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(v) { return "'" + String(v).replace(/'/g, "\\'") + "'"; }
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>';

  function brand(opts) {
    opts = opts || {};
    var mount = opts.mount; if (!mount) throw new Error('JPK.brand: mount required');
    var brands = opts.brands || BRANDS;
    var storageKey = opts.storageKey === undefined ? 'jpk-brand' : opts.storageKey;
    var counts = opts.counts || {};
    var cur = opts.value || null;
    if (!cur && storageKey) { try { cur = localStorage.getItem(storageKey); } catch (e) { cur = null; } }
    if (!brands.some(function (b) { return b.key === cur; })) cur = brands[0].key;

    var uid = 'jpkb' + Math.random().toString(36).slice(2, 7);
    mount.innerHTML =
      '<button type="button" class="sw" id="' + uid + '-b" aria-haspopup="menu" aria-expanded="false" aria-controls="' + uid + '-m">' +
        '<span class="smark"></span><span class="t"><small>Brand</small><b></b></span>' + CHEV + '</button>' +
      '<div class="swmenu" id="' + uid + '-m" role="menu" hidden><div class="ttl">Switch brand</div>' +
        brands.map(function (b) {
          return '<button type="button" role="menuitemradio" data-key="' + esc(b.key) + '" aria-checked="false"><span class="smark">' + esc(b.mark) + '</span>' + esc(b.label) + '<span class="cnt"></span></button>';
        }).join('') + '</div>';
    var btn = mount.querySelector('.sw'), menu = mount.querySelector('.swmenu');

    function find(k) { for (var i = 0; i < brands.length; i++) if (brands[i].key === k) return brands[i]; return brands[0]; }
    function paint() {
      var b = find(cur);
      btn.querySelector('.smark').textContent = b.mark;
      btn.querySelector('b').textContent = b.label;
      menu.querySelectorAll('[data-key]').forEach(function (el) {
        el.setAttribute('aria-checked', String(el.dataset.key === cur));
        var c = counts[el.dataset.key]; el.querySelector('.cnt').textContent = (c == null ? '' : String(c));
      });
    }
    function open(on) { menu.hidden = !on; btn.setAttribute('aria-expanded', String(!!on)); if (on) { var a = menu.querySelector('[aria-checked="true"]'); if (a) a.focus(); } }
    function set(k, o) {
      o = o || {};
      if (!find(k) || k === cur && !o.force) { open(false); return; }
      cur = find(k).key; paint(); open(false);
      if (storageKey) { try { localStorage.setItem(storageKey, cur); } catch (e) { /* storage unavailable */ } }
      if (!o.silent && typeof opts.onChange === 'function') opts.onChange(cur, find(cur));
    }
    btn.addEventListener('click', function () { open(menu.hidden); });
    menu.addEventListener('click', function (e) { var el = e.target.closest('[data-key]'); if (el) set(el.dataset.key); });
    menu.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('[data-key]'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Escape') { open(false); btn.focus(); }
    });
    document.addEventListener('click', function (e) { if (!mount.contains(e.target)) open(false); });
    paint();

    return {
      get: function () { return cur; },
      set: set,
      label: function () { return find(cur).label; },
      brand: function () { return find(cur); },
      setCounts: function (c) { counts = Object.assign({}, counts, c || {}); paint(); },
      where: function (field) {
        var b = find(cur); if (!b.values) return '';
        field = field || 'Brand';
        return b.values.length === 1 ? field + ' = ' + q(b.values[0]) : field + ' in (' + b.values.map(q).join(',') + ')';
      },
      brands: brands
    };
  }
  brand.BRANDS = BRANDS;
  brand.version = '3.0.0';
  root.JPK = root.JPK || {};
  root.JPK.brand = brand;
  if (typeof module === 'object' && module.exports) module.exports = brand;
})(typeof window !== 'undefined' ? window : this);
