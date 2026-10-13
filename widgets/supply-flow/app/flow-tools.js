/* FlowTools v1.0: lane search box and "+ New" menu shared by the flow widgets.
   Read-only rule holds: "+ New" opens Zoho's own create form, the widget never writes a record.
   FlowTools.init({ searchBefore:'#lane-table', add:{ mount:'.actions', items:[{label,entity}] }, onSearch:fn }) */
(function (root) {
  'use strict';
  var doc = root.document;
  var CSS = '.ft-search{display:flex;align-items:center;gap:8px;margin:0 0 10px}.ft-search input{max-width:340px}' +
    '.ft-search .ft-count{font-size:12px;color:var(--muted)}' +
    '.ft-add{position:relative;display:inline-block}.ft-add .ft-menu{position:absolute;right:0;top:100%;margin-top:4px;min-width:190px;z-index:20;background:var(--surface);border:1px solid var(--line);border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.18);padding:4px}' +
    '.ft-add .ft-menu[hidden]{display:none}.ft-add .ft-menu button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--ink);font:inherit;font-size:13px;padding:7px 10px;border-radius:4px;cursor:pointer}' +
    '.ft-add .ft-menu button:hover,.ft-add .ft-menu button:focus{background:var(--surface2)}';
  function el(t, c) { var e = doc.createElement(t); if (c) e.className = c; return e; }
  function text(item) {
    var out = [];
    Object.keys(item || {}).forEach(function (k) { var v = item[k]; if (typeof v === 'string' || typeof v === 'number') out.push(String(v)); });
    return out.join(' ').toLowerCase();
  }
  function match(item, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return true;
    var t = text(item);
    return q.split(/\s+/).every(function (w) { return t.indexOf(w) !== -1; });
  }
  function toast(m) { if (root.JPK && root.JPK.toast) root.JPK.toast(m); }
  function create(entity) {
    var Z = root.ZOHO;
    if (!Z || !Z.CRM || !Z.CRM.UI || !Z.CRM.UI.Record || !Z.CRM.UI.Record.create) { toast('Demo: would open the New ' + entity.replace(/_/g, ' ') + ' form'); return; }
    var p;
    try { p = Z.CRM.UI.Record.create({ Entity: entity }); } catch (e) { toast('Could not open the form: ' + (e && e.message || e)); return; }
    if (p && p.then) p.then(null, function (e) { toast('Could not open the form: ' + (e && e.message || e)); });
  }
  function init(o) {
    o = o || {};
    if (!doc.getElementById('ft-css')) { var s = el('style'); s.id = 'ft-css'; s.textContent = CSS; doc.head.appendChild(s); }
    var api = { q: '', query: function () { return api.q; }, match: function (i) { return match(i, api.q); },
      filter: function (items) { return (items || []).filter(api.match); }, note: function (shown, total) { if (countEl) countEl.textContent = api.q ? shown + ' of ' + total + ' shown' : ''; } };
    var countEl = null;
    if (o.searchBefore) {
      var anchor = doc.querySelector(o.searchBefore);
      if (anchor) {
        var wrap = el('div', 'ft-search'), input = el('input');
        input.type = 'search'; input.id = 'ft-q'; input.placeholder = o.placeholder || 'Search this list'; input.setAttribute('aria-label', 'Search the records in this list');
        countEl = el('span', 'ft-count'); countEl.setAttribute('aria-live', 'polite');
        wrap.appendChild(input); wrap.appendChild(countEl);
        anchor.parentNode.insertBefore(wrap, anchor);
        input.addEventListener('input', function () { api.q = input.value; if (o.onSearch) o.onSearch(api.q); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; api.q = ''; if (o.onSearch) o.onSearch(''); } });
      }
    }
    if (o.add && o.add.items && o.add.items.length) {
      var host = doc.querySelector(o.add.mount || '.actions');
      if (host) {
        var box = el('span', 'ft-add'), b = el('button', 'btn pri'), menu = el('div', 'ft-menu');
        b.type = 'button'; b.textContent = '+ New'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
        menu.hidden = true; menu.setAttribute('role', 'menu');
        o.add.items.forEach(function (it) {
          var m = el('button'); m.type = 'button'; m.setAttribute('role', 'menuitem'); m.textContent = it.label;
          m.addEventListener('click', function () { close(); create(it.entity); });
          menu.appendChild(m);
        });
        function close() { menu.hidden = true; b.setAttribute('aria-expanded', 'false'); }
        b.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; b.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button').focus(); });
        doc.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
        box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); b.focus(); } });
        box.appendChild(b); box.appendChild(menu);
        var first = host.firstElementChild; host.insertBefore(box, first && first.id === 'demo-flag' ? first.nextSibling : first);
      }
    }
    return api;
  }
  root.FlowTools = { init: init, match: match };
})(typeof window !== 'undefined' ? window : this);
