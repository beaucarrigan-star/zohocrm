/* =============================================================================
   EM Pricing Studio - Zoho CRM web-tab widget and proposal builder.
   Pricing maths lives in engine.js; every Zoho call lives in crm-api.js.
   Inside Zoho CRM the Studio reads Products + Vendors and saves Pricing_Scenarios.
   Opened outside Zoho (or with ?preview=1) it runs on sample data kept in this browser.

   Zoho matching
   - Cost catalog: each cost you type is compared with the value on the Products record in
     Zoho. Match = "Zoho confirms". Different = Zoho's value is shown with Use Zoho / Keep mine.
     Kept values are written to Zoho when you press Save changes.
   - Scenario prices: each customer price is compared with the matching price field on the
     Products record (PRICE_FIELDS below). Use Zoho / Keep for this proposal / Save to Zoho.
   Customise: edit the CONFIG block. Field API names must match Zoho exactly.
   Preview (?preview=1, or opened outside Zoho) uses sample data kept in this browser only.
   ============================================================================= */
(function () {
  'use strict';
  var E = window.PricingEngine;
  /* Zoho mode when the SDK is loaded and we are framed by CRM; ?preview=1 forces sample data */
  var IN_ZOHO = !!(window.ZOHO && window.ZOHO.embeddedApp && window.ZOHO.CRM) && window.self !== window.top;
  var PREVIEW = !IN_ZOHO || /[?&]preview=1\b/.test(location.search);

  /* ============================ CONFIG ============================ */
  var BRAND = { company: 'JusticePoint', product: 'EM Pricing Studio', docLine: 'Electronic Monitoring', proposalPrefix: 'JP' };

  /* JusticePoint cost fields on Products (catalog key -> API name) */
  var CAT = {
    family: 'EM_Device_Family', costLeaseDaily: 'Cost_Lease_Daily', spareAllowancePct: 'Spare_Allowance_Pct',
    spareOverageDaily: 'Spare_Overage_Daily', costPurchase: 'Cost_Purchase_Unit', costOwnedDaily: 'Cost_Owned_Daily',
    usefulLifeMonths: 'Useful_Life_Months', replacementCost: 'Replacement_Cost', notes: 'Cost_Source', updated: 'Cost_Updated',
    costTiers: 'Cost_Tiers'   /* Multi Line: volume tiers stored as JSON */
  };
  /* catalog columns: t = money | pct | int ; type = Zoho field type to create if missing */
  var CAT_COLS = [
    { k: 'costLeaseDaily', h: 'Lease $/day', t: 'money', type: 'Currency', tip: 'Your cost per active leased unit per day' },
    { k: 'spareAllowancePct', h: 'Free spares %', t: 'pct', type: 'Percent', tip: 'Spares that cost nothing, as a % of active units' },
    { k: 'spareOverageDaily', h: 'Spare $/day', t: 'money', type: 'Currency', tip: 'Your cost per spare above the free %, per day' },
    { k: 'costPurchase', h: 'Buy $/unit', t: 'money', type: 'Currency', tip: 'Your cost to buy one unit outright' },
    { k: 'costOwnedDaily', h: 'Owned svc $/day', t: 'money', type: 'Currency', tip: 'Monitoring / airtime per active owned unit per day' },
    { k: 'usefulLifeMonths', h: 'Life (mo)', t: 'int', type: 'Number', tip: 'Months an owned unit is depreciated over' },
    { k: 'replacementCost', h: 'Replace $', t: 'money', type: 'Currency', tip: 'What a lost, stolen or damaged unit costs you' }
  ];
  var CAT_OTHER = { family: { h: 'Family', type: 'Picklist' }, notes: { h: 'Notes', type: 'Multi Line' }, updated: { h: 'Cost updated', type: 'Date' }, costTiers: { h: 'Volume tiers', type: 'Multi Line' } };
  /* tier editor columns: whole-volume tiers, blank = use the base rate */
  var COST_TIER_COLS = [
    { k: 'costLeaseDaily', h: 'Lease $/day' }, { k: 'spareOverageDaily', h: 'Spare $/day' },
    { k: 'costPurchase', h: 'Buy $/unit' }, { k: 'costOwnedDaily', h: 'Owned svc $/day' }
  ];

  /* customer price fields on Products that scenario prices are checked against */
  var PRICE_FIELDS = {
    leaseDaily: 'Price_Lease_Daily', spareDaily: 'Price_Spare_Daily', saasMonthly: 'Price_Transparent_Monthly',
    purchasePrice: 'Unit_Price', serviceDaily: 'Price_Service_Daily', lostFee: 'Price_Lost_Fee'
  };
  var PRICE_LABEL = { leaseDaily: '$/active day', spareDaily: '$/spare day', saasMonthly: '$/unit/month', purchasePrice: 'Unit price', serviceDaily: 'Service $/day', lostFee: 'Lost fee' };

  var SCENARIO_FIELDS = ['Valid_Until', 'Pricing_Model', 'Vendor_Source', 'Proposal_Options', 'Term_Months', 'Active_Units', 'Est_Monthly_Revenue',
    'Est_Monthly_Cost', 'Est_Monthly_Margin', 'Est_Margin_Pct', 'Target_Margin_Pct', 'Term_Revenue', 'Term_Margin', 'Upfront_Cash',
    'Rev_Per_Unit_Day', 'Cost_Per_Unit_Day', 'Margin_Tier', 'Missing_Costs', 'Account', 'Scenario_JSON', 'Scenario_Status', 'Proposal_Sent'];

  /* Vendors: number field = units JusticePoint currently has with that vendor (sets the cost tier) */
  var VENDOR_UNITS_FIELD = 'EM_Units_Current';
  /* Vendors: checkbox, ticked = a JusticePoint vendor (only these are offered in the Studio) */
  var VENDOR_FLAG_FIELD = 'EM_JusticePoint_Vendor';

  var FAMILIES = ['GPS', 'CAM', 'Remote Breath', 'RF', 'Victim / DV', 'Accessory', 'Service', 'Other'];
  var MODEL_PICK = { lease: 'Daily lease', saas: 'Transparent Pricing', purchase: 'Purchase' };   /* Pricing_Model picklist values */
  /* ========================== END CONFIG ========================== */

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var blank = function (v) { return v == null || v === ''; };
  var money = function (v, dp) { dp = dp == null ? 0 : dp; v = num(v); var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); return (v < 0 ? '−$' : '$') + s; };
  var rate = function (v) { return money(v, 2); };
  var pctf = function (v, dp) { return num(v).toFixed(dp == null ? 1 : dp) + '%'; };
  var int = function (v) { return Math.round(num(v)).toLocaleString('en-US'); };
  var one = function (v) { v = num(v); return (Math.round(v * 10) / 10).toLocaleString('en-US'); };
  var fmtT = function (t, v) { return t === 'pct' ? one(v) + '%' : t === 'int' ? int(v) : rate(v); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var today = function () { var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  var addDays = function (iso, d) { var x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return x; };
  var longDate = function (d) { return (d instanceof Date ? d : new Date(d + 'T12:00:00')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var toastT = null;
  function toast(msg, bad, ms) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 4500); }
  var timeout = function (p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, ms || 15000); Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); };
  var resize = function () {}; /* web tabs fill the CRM content area; no resize needed */
  var round2 = function (v) { return Math.round(num(v) * 100) / 100; };

  /* ---------- data layer ---------- */
  var api = window.PricingCRM.create({
    preview: PREVIEW, engine: E, catalogFields: CAT, priceFields: PRICE_FIELDS, scenarioFields: SCENARIO_FIELDS,
    modelPick: MODEL_PICK, vendorUnitsField: VENDOR_UNITS_FIELD, vendorFlagField: VENDOR_FLAG_FIELD, timeout: timeout, today: today, addDays: addDays, number: num
  });

  /* ---------- state ---------- */
  var state = { internal: true, openTiers: {}, catalog: [], vendors: [], vendorFilter: '', scenario: null, saved: [], dirty: false, tab: 'scenario', catDirty: {}, user: null,
    setup: { products: [], prices: [], scenarios: [], vendors: [], productsReadOnly: [], pricesReadOnly: [] } };
  var itemById = function (id) { return state.catalog.filter(function (c) { return String(c.id) === String(id); })[0]; };
  var calc = function (opts) { return E.price(state.scenario, state.catalog, opts); };
  var priceFieldReady = function (key) { return !!PRICE_FIELDS[key] && !state.setup.prices.some(function (m) { return m.key === key; }); };
  function setDirty(d) { state.dirty = d; var s = $('save-status'); s.textContent = d ? 'Unsaved changes' : (state.scenario && state.scenario.id ? 'Saved' : ''); s.className = 'status' + (d ? ' dirty' : ''); }

  /* ---------- Zoho comparison ---------- */
  /* status of a value against Zoho: empty | new | match | diff | kept | cleared */
  function zStatus(zohoVal, mine, kept) {
    var zb = blank(zohoVal), mb = blank(mine);
    if (zb && mb) return 'empty';
    if (zb) return 'new';
    if (mb) return 'cleared';
    if (Math.abs(num(mine) - num(zohoVal)) < 0.005) return 'match';
    return !blank(kept) && Math.abs(num(kept) - num(mine)) < 0.005 ? 'kept' : 'diff';
  }
  function zBadge() { return ''; }
  /* catalog cell */
  function catState(c, k) { return zStatus(c.isNew ? null : (c.zoho || {})[k], c[k], (c.ack || {})[k]); }
  function catBadgeHtml(c, i, k, t) { return zBadge('cat', i, k, catState(c, k), (c.zoho || {})[k], t); }
  /* only touch the DOM when the badge really changes: re-drawing it on the input's change event
     (fired as you click a badge button) would swap the button out mid-click and lose the click */
  function setHtml(el, html) { if (el && el.innerHTML !== html) el.innerHTML = html; }
  function updCatBadge(i, k) { var c = state.catalog[i], col = colOf(k); if (c) setHtml($('zc-c-' + i + '-' + k), catBadgeHtml(c, i, k, col ? col.t : 'money')); }
  var colOf = function (k) { return CAT_COLS.filter(function (x) { return x.k === k; })[0]; };
  /* scenario price cell */
  function lineZoho(l, k) { var it = itemById(l.itemId); return it && it.zohoPrice ? it.zohoPrice[k] : null; }
  function lineState() { return 'empty'; }
  function lineBadgeHtml(l, i, k) { return zBadge('line', i, k, lineState(l, k), lineZoho(l, k), 'money'); }
  function updLineBadge(i, k) { var l = state.scenario.lines[i]; if (l) setHtml($('zc-l-' + i + '-' + k), lineBadgeHtml(l, i, k)); }
  function scenarioKeys(m) { return E.PRICE_KEYS[m].concat(m !== 'purchase' ? ['lostFee'] : []); }
  function unresolvedLines() { return []; }
  function unresolvedCat() { return []; }

  /* ---------- path binding ---------- */
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function setPath(obj, path, val) { var ks = path.split('.'), o = obj; for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }
  function inp(path, type, attrs) {
    attrs = attrs || {};
    var v = getPath(state.scenario, path);
    var cls = type === 'money' || type === 'tmoney' ? 'money' : type === 'pct' ? 'pctw' : '';
    var t = type === 'text' ? 'text' : 'number';
    var step = attrs.step || (type === 'money' || type === 'tmoney' ? '0.01' : type === 'int' ? '1' : 'any');
    var el = '<input type="' + t + '" data-bind="' + path + '" data-kind="' + type + '"' + (t === 'number' ? ' inputmode="decimal" step="' + step + '" min="0"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (attrs.ph ? ' placeholder="' + esc(attrs.ph) + '"' : '') + (attrs.label ? ' aria-label="' + esc(attrs.label) + '"' : '') + '>';
    return cls ? '<span class="' + cls + '">' + el + '</span>' : el;
  }
  function field(label, html, hint, wide, cls) { return '<label class="f' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') + '"><span>' + esc(label) + (hint ? ' <span class="hint">· ' + esc(hint) + '</span>' : '') + '</span>' + html + '</label>'; }

  /* ---------- builder ---------- */
  /* ---------- what vendors charge JusticePoint ---------- */
  function scenarioVendors() {
    var out = [];
    state.scenario.lines.forEach(function (l) { var it = itemById(l.itemId); if (it && it.vendorId && out.indexOf(String(it.vendorId)) < 0) out.push(String(it.vendorId)); });
    return out;
  }
  function vendorDevices(vid) {
    var seen = {}, out = [];
    state.scenario.lines.forEach(function (l) { var it = itemById(l.itemId); if (it && String(it.vendorId) === vid && !seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    return out;
  }
  function syncVendorVolume() {
    var s = state.scenario; if (!s.vendorVolume) s.vendorVolume = {};
    scenarioVendors().forEach(function (vid) {
      var v = state.vendors.filter(function (x) { return x.id === vid; })[0];
      var e = s.vendorVolume[vid] || (s.vendorVolume[vid] = { override: null, useNext: false, rates: {} });
      if (!e.rates) e.rates = {};
      e.zoho = v && v.units != null ? num(v.units) : null;
      e.name = v ? v.name : (vendorDevices(vid)[0] || {}).vendor || '';
    });
  }
  /* ---------- pro-forma P&L (internal) with expandable vendor tier details ---------- */
  function vendorPanel(buy) {
    var vids = scenarioVendors(), s = state.scenario;
    var h = '<div class="card pf"><div class="head"><h2><span class="int">Pro-forma P&amp;L</span><span class="ext">Revenue summary</span></h2><span class="meta" id="pf-meta"></span></div>';
    h += '<div class="scroll-x" id="pf-body"></div><div id="vv-lock" class="int"></div>';
    if (vids.length) {
      h += '<div class="body pf-vendors int"><h3 class="pf-h">Vendor cost detail</h3>';
      vids.forEach(function (vid) {
        var e = s.vendorVolume[vid] || {};
        h += '<details class="vd" data-vd="' + esc(vid) + '"' + (state.openTiers['v' + vid] ? ' open' : '') + '><summary><span class="vd-name">' + esc(e.name || 'Vendor') + '</span><span class="vd-sum" id="vd-sum-' + esc(vid) + '"></span></summary><div class="vd-body">';
        h += '<div class="vd-vol"><label class="f"><span>Current units with ' + esc(e.name || 'vendor') + ' <span class="hint">· Zoho: ' + (e.zoho == null ? 'not set' : int(e.zoho)) + '</span></span>' + inp('vendorVolume.' + vid + '.override', 'vol', { step: '1', ph: e.zoho == null ? '0' : String(e.zoho), label: 'Current units override' }) + '</label>';
        h += '<div class="vd-calc" id="vd-calc-' + esc(vid) + '"></div>';
        h += '<label class="check"><input type="checkbox" data-bind="vendorVolume.' + vid + '.useNext" data-kind="bool"' + (e.useNext ? ' checked' : '') + '> Model the next tier</label></div>';
        h += '<table class="tbl vd-tbl"><thead><tr><th>Device</th><th class="r">Catalog tier</th><th class="r">Next tier</th><th class="r">Vendor quote <span class="hint">· ' + (buy ? 'svc' : 'lease') + ' $/day</span></th></tr></thead><tbody>';
        vendorDevices(vid).forEach(function (it) {
          var key = esc(vid + '-' + it.id);
          h += '<tr><td>' + esc(it.name || 'Device') + '</td><td class="r" id="vd-r-' + key + '"></td><td class="r" id="vd-n-' + key + '"></td><td class="w-md">' + inp('vendorVolume.' + vid + '.rates.' + it.id, 'vol', { step: '0.01', ph: 'catalog', label: 'Vendor quote for ' + (it.name || 'device') }) + '</td></tr>';
        });
        h += '</tbody></table><p class="fine">Tiers use total units with the vendor. A vendor quote overrides the catalog for this scenario only.</p></div></details>';
      });
      h += '</div>';
    }
    return h + '</div>';
  }
  function tierTxt(min) { return min ? int(min) + '+' : 'base'; }
  function renderProForma(r) {
    var body = $('pf-body'); if (!body) return;
    var M = r.monthly, R = M.rev, C = M.costs, rev = M.revenue;
    var pc = function (v) { return rev > 0 ? pctf(v / rev * 100) : '—'; };
    var row = function (label, v, cls, sub) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (sub ? '<div class="pf-sub">' + sub + '</div>' : '') + '</td><td class="r num">' + money(v) + '</td><td class="r num">' + money(v * 12) + '</td><td class="r num">' + pc(v) + '</td></tr>'; };
    var opt = function (label, v, sub) { return Math.abs(v) > 0.005 ? row(label, v, '', sub) : ''; };
    var h = '<table class="pft"><thead><tr><th></th><th class="r">Monthly</th><th class="r">Annual</th><th class="r">% of rev</th></tr></thead><tbody>';
    h += '<tr class="sec"><td colspan="4">Revenue</td></tr>';
    h += opt('Equipment and monitoring', R.device) + opt('Spare equipment', R.spares) + opt('Loss recovery fees', R.lost) + opt('Staff services', R.staffing) + opt('Recurring fees', R.fees) + opt('Minimum billing adjustment', R.minimum);
    h += row('Total revenue', rev, 'tot') + '</tbody>';
    h += '<tbody class="int"><tr class="sec"><td colspan="4">Cost of revenue</td></tr>';
    var byV = {}, orderV = [], other = 0;
    r.lines.forEach(function (l) { var c = l.cost.device + l.cost.spares; if (l.vendorId) { if (byV[l.vendorId] == null) { byV[l.vendorId] = 0; orderV.push(l.vendorId); } byV[l.vendorId] += c; } else other += c; });
    orderV.forEach(function (vid) {
      var v = (r.vendors || []).filter(function (x) { return x.vendorId === vid; })[0] || {};
      var sub = (v.lines || []).map(function (l) { return esc(l.name) + ' ' + rate(l.effective) + '/day' + (l.manual != null ? ' · quote' : l.modelled ? ' · next tier' : ''); }).join(' · ');
      h += row(esc(v.name || 'Vendor') + ' · equipment and airtime', byV[vid], '', (v.total != null ? int(v.total) + ' units · ' : '') + sub);
    });
    h += opt('Other equipment', other) + opt('Lost and damaged equipment', C.lost) + opt('Device depreciation', C.amort) + opt('Staff services', C.staffing) + opt('Recurring fees', C.fees);
    h += row('Total cost of revenue', M.cost, 'tot');
    h += row('Gross profit', M.margin, 'gp' + (M.margin < 0 ? ' neg' : ''));
    h += '</tbody></table>';
    var O = r.once, T = r.term;
    h += '<div class="pf-foot int"><div><span>One-time</span><b>' + money(O.rev) + '</b> revenue · <b>' + money(O.cost + O.capex) + '</b> cost' + (O.capex > 0 ? ' incl. device purchase' : '') + '</div>';
    h += '<div><span>Term · ' + T.months + ' mo</span><b>' + money(T.revenue) + '</b> revenue · <b>' + money(T.margin) + '</b> gross profit · <b>' + pctf(T.marginPct) + '</b></div></div>';
    body.innerHTML = h;
    var meta = $('pf-meta'); if (meta) meta.textContent = r.modelLabel + ' · year one · ' + int(r.units.active) + ' active units' + (state.internal ? ' · internal only' : '');
  }
  function renderVendorResults(r) {
    renderProForma(r);
    (r.vendors || []).forEach(function (v) {
      var sum = $('vd-sum-' + v.vendorId); if (!sum) return;
      var tip = v.lines.some(function (l) { return l.manual != null; }) ? 'vendor quote applied' : !v.hasTiers ? 'no catalog tiers' : v.nextMin == null ? 'top tier' : int(v.unitsToNext) + ' units to next tier · saves ' + money(v.savingsMonthly) + '/mo';
      sum.textContent = int(v.total) + ' units · ' + tip + (v.useNext ? ' · modelling next tier' : '');
      var calc = $('vd-calc-' + v.vendorId);
      if (calc) calc.innerHTML = int(v.current) + (v.override != null ? ' (override)' : '') + ' current + ' + int(v.scenarioUnits) + ' this scenario = <b>' + int(v.total) + '</b> units';
      v.lines.forEach(function (l) {
        var key = v.vendorId + '-' + l.itemId, R = $('vd-r-' + key), N = $('vd-n-' + key);
        if (R) R.innerHTML = '<b>' + rate(l.rate) + '</b> <span class="fine" style="margin:0">' + tierTxt(l.tierMin) + '</span>';
        if (N) N.innerHTML = l.next ? rate(l.next.rate) + ' <span class="fine" style="margin:0">' + int(l.next.min) + '+</span>' : '<span class="fine" style="margin:0">—</span>';
      });
    });
    var lk = $('vv-lock'); if (!lk) return;
    var pa = state.scenario.pricedAt, meta = $('pf-meta');
    if (!pa || !pa.vendors) { lk.innerHTML = ''; if (meta && state.internal) meta.textContent += ' · costs lock on save'; return; }
    var changes = [];
    pa.vendors.forEach(function (sv) {
      var cur = (r.vendors || []).filter(function (x) { return x.vendorId === sv.vendorId; })[0];
      sv.lines.forEach(function (sl) {
        var cl = cur && cur.lines.filter(function (x) { return String(x.itemId) === String(sl.itemId); })[0];
        if (!cl) changes.push(esc(sl.name) + ' removed');
        else if (Math.abs(cl.effective - sl.effective) > 0.004) changes.push(esc(sl.name) + ' ' + rate(sl.effective) + ' → ' + rate(cl.effective));
      });
      if (cur && cur.total !== sv.total) changes.push(esc(sv.name) + ' ' + int(sv.total) + ' → ' + int(cur.total) + ' units');
    });
    if (meta && state.internal) meta.textContent += ' · costs locked ' + longDate(pa.date);
    lk.innerHTML = changes.length ? '<div class="alert pf-alert">Vendor costs changed since they were locked: ' + changes.join(' · ') + '. Save to re-lock.</div>' : '';
  }
  function costSnapshot(r) {
    return { date: today(), vendors: (r.vendors || []).map(function (v) {
      return { vendorId: v.vendorId, name: v.name, current: v.current, scenarioUnits: v.scenarioUnits, total: v.total, useNext: v.useNext,
        lines: v.lines.map(function (l) { return { itemId: l.itemId, name: l.name, tierMin: l.tierMin, rate: l.rate, manual: l.manual, modelled: !!(l.modelled && l.next), effective: l.effective }; }) };
    }) };
  }

  function renderBuilder() {
    var s = state.scenario, m = s.model, buy = m === 'purchase' || s.vendorSource === 'buy';
    syncVendorVolume();
    var h = '';
    h += '<div class="card"><div class="head"><h2>Customer and structure</h2><span class="meta">' + (s.account ? 'Customer: ' + esc(s.account.name) : 'Not linked to an account yet') + '</span></div><div class="body"><div class="fgrid">';
    h += field('Scenario name', inp('name', 'text'), null, true);
    h += '<label class="f wide"><span>Customer account</span><span style="position:relative;display:block"><input type="search" id="acct-q" placeholder="' + (PREVIEW ? 'Search sample customers…' : 'Search Zoho accounts…') + '" value="' + esc(s.account ? s.account.name : '') + '" autocomplete="off"><span id="acct-res" class="acct-res" hidden></span></span></label>';
    h += field('Name on proposal', inp('customerName', 'text', { ph: s.account ? s.account.name : 'e.g. Rock County' }));
    h += field('Program', inp('program', 'text', { ph: 'e.g. Pretrial Services' }));
    h += field('Term', inp('termMonths', 'int'), 'months');
    h += field('Target margin', inp('targetMarginPct', 'pct'), null, false, 'int');
    h += field('Price escalator', inp('priceEscalatorPct', 'pct'), 'per year');
    h += field('Cost escalator', inp('costEscalatorPct', 'pct'), 'per year', false, 'int');
    h += '</div><div style="display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:14px;align-items:center">';
    h += '<div><div class="fine" style="margin:0 0 5px">Customer pricing model</div><span class="seg" role="group" aria-label="Pricing model">' + Object.keys(E.MODELS).map(function (k) { return '<button type="button" data-act="model" data-v="' + k + '" aria-pressed="' + (m === k) + '">' + esc(E.MODELS[k].label) + '</button>'; }).join('') + '</span></div>';
    h += '<div class="int"><div class="fine" style="margin:0 0 5px">How ' + esc(BRAND.company) + ' gets the devices</div><span class="seg" role="group" aria-label="Device sourcing"><button type="button" data-act="source" data-v="lease" aria-pressed="' + !buy + '"' + (m === 'purchase' ? ' disabled' : '') + '>Lease</button><button type="button" data-act="source" data-v="buy" aria-pressed="' + buy + '"' + (m === 'purchase' ? ' disabled' : '') + '>Purchase</button></span></div>';
    h += '</div><p class="fine int">' + modelNote(m, buy) + '</p><p class="fine ext">' + esc(optionBlurb(m)) + '</p></div></div>';

    /* devices */
    var keys = scenarioKeys(m);
    h += '<div class="card"><div class="head"><h2>Devices and prices</h2><span style="display:flex;gap:8px;align-items:center"><span class="meta">volumes are average daily units · prices are stored in this scenario</span><button class="btn sm" type="button" data-act="add-line">+ Add device</button></span></div><div class="body scroll-x">';
    if (!s.lines.length) h += '<p class="empty">No devices yet. Add one to start pricing.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Device</th><th class="r">Active</th><th class="r" title="Spares on the shelf, as a % of active">Spares %</th>' + keys.map(function (k) { return '<th class="r">' + esc(PRICE_LABEL[k]) + '</th>'; }).join('') + '<th class="r int">Margin</th><th></th></tr></thead><tbody>';
      s.lines.forEach(function (l, i) {
        if (!l.confirmed) l.confirmed = {};
        var it = itemById(l.itemId);
        h += '<tr data-line="' + i + '"><td style="min-width:210px"><select data-bind="lines.' + i + '.itemId" data-kind="text" aria-label="Device">' + catalogOptions(l.itemId) + '</select><div class="fine int" id="line-hint-' + i + '">' + esc(costHint(it, buy)) + '</div></td>';
        h += '<td class="w-sm">' + inp('lines.' + i + '.units', 'num', { label: 'Active units', step: '1' }) + '</td>';
        h += '<td class="w-sm">' + inp('lines.' + i + '.sparePct', 'pct', { label: 'Spares %' }) + '</td>';
        keys.forEach(function (k) { h += '<td class="w-md pcell">' + inp('lines.' + i + '.price.' + k, 'money', { label: PRICE_LABEL[k] }) + '<div class="zslot" id="zc-l-' + i + '-' + k + '">' + lineBadgeHtml(l, i, k) + '</div></td>'; });
        var nt = (l.priceTiers || []).length, open = !!state.openTiers['l' + i];
        h += '<td class="r int" id="line-m-' + i + '"></td><td style="white-space:nowrap"><button class="btn sm" type="button" data-act="tog-ptier" data-i="' + i + '" aria-expanded="' + open + '" title="Volume price tiers">Tiers' + (nt ? ' (' + nt + ')' : '') + '</button> <button class="btn ghost sm" type="button" data-act="del-line" data-i="' + i + '" aria-label="Remove device">✕</button></td></tr>';
        if (open) h += '<tr class="tier-row"><td colspan="' + (5 + keys.length) + '">' + priceTierEditor(l, i, keys) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';

    h += vendorPanel(buy);

    /* spares, losses, minimums */
    h += '<div class="card"><div class="head"><h2>Spares, losses and minimums</h2></div><div class="body">';
    h += '<div class="fgrid">';
    h += field('Spares included free', inp('spareBilling.overPct', 'pct'), '% of active');
    h += field('Annual loss rate', inp('lostRatePct', 'pct'), '% of devices per year', false, 'int');
    h += field('Loss fees recovered', inp('lostRecoveryPct', 'pct'), '% actually collected', false, 'int');
    h += field('Minimum monthly billing', inp('minimumMonthly', 'money'));
    h += '</div><p class="fine">Spares above the free % are billed at each device’s <b>$/spare day</b> (Devices table; leave it at 0 to not charge). <span class="int">Your spare cost comes from the Cost catalog: spares above each device’s free % cost its Spare $/day. Losses do not apply to purchased equipment, which the customer owns.</span></p></div></div>';

    /* staffing */
    h += '<div class="card"><div class="head"><h2>' + esc(BRAND.company) + ' staffing services</h2><button class="btn sm" type="button" data-act="add-staff">+ Add service</button></div><div class="body scroll-x">';
    if (!s.staffing.length) h += '<p class="empty">No staffed services. Add monitoring-center or case-management work priced per participant or per month.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Service</th><th class="r">Participants</th><th class="int">Cost basis</th><th class="r int">Cost inputs</th><th>Price basis</th><th class="r">Price</th><th class="r int">Margin</th><th></th></tr></thead><tbody>';
      s.staffing.forEach(function (st, i) {
        var p = 'staffing.' + i + '.';
        h += '<tr><td style="min-width:180px">' + inp(p + 'name', 'text', { label: 'Service name' }) + '</td>';
        h += '<td class="w-sm">' + inp(p + 'participants', 'num', { ph: 'all', label: 'Participants (blank = all active units)', step: '1' }) + '</td>';
        h += '<td class="int"><select data-bind="' + p + 'costMethod" data-kind="text" data-rerender="1"><option value="hours"' + (st.costMethod !== 'fte' ? ' selected' : '') + '>Hours per participant</option><option value="fte"' + (st.costMethod === 'fte' ? ' selected' : '') + '>Dedicated FTEs</option></select></td>';
        h += '<td class="int" style="min-width:230px"><div style="display:flex;gap:6px">' + (st.costMethod === 'fte'
          ? inp(p + 'fte', 'num', { label: 'FTEs', ph: 'FTEs' }) + inp(p + 'fteMonthlyCost', 'money', { label: 'Loaded cost per FTE per month', ph: 'per FTE / mo' })
          : inp(p + 'hoursPerParticipant', 'num', { label: 'Hours per participant per month', ph: 'hrs / mo' }) + inp(p + 'costPerHour', 'money', { label: 'Cost per hour', ph: 'per hr' }) + inp(p + 'overheadPct', 'pct', { label: 'Overhead %', ph: 'ovhd' })) + '</div></td>';
        h += '<td><select data-bind="' + p + 'priceMethod" data-kind="text" data-rerender="1"><option value="perDay"' + (st.priceMethod !== 'monthly' ? ' selected' : '') + '>Per participant per day</option><option value="monthly"' + (st.priceMethod === 'monthly' ? ' selected' : '') + '>Flat monthly</option></select></td>';
        h += '<td class="w-md">' + (st.priceMethod === 'monthly' ? inp(p + 'priceMonthly', 'money', { label: 'Monthly price' }) : inp(p + 'priceDaily', 'money', { label: 'Price per participant per day' })) + '</td>';
        h += '<td class="r int" id="staff-m-' + i + '"></td><td><button class="btn ghost sm" type="button" data-act="del-staff" data-i="' + i + '" aria-label="Remove service">✕</button></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';

    /* fees */
    h += '<div class="card"><div class="head"><h2>One-time and service fees</h2><button class="btn sm" type="button" data-act="add-fee">+ Add fee</button></div><div class="body scroll-x">';
    if (!s.fees.length) h += '<p class="empty">No fees. Add installation, training, shipping or other charges.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Fee</th><th>When</th><th>Quantity</th><th class="r">Price each</th><th class="r int">Your cost each</th><th class="r">Total</th><th></th></tr></thead><tbody>';
      s.fees.forEach(function (f, i) {
        var p = 'fees.' + i + '.';
        h += '<tr><td style="min-width:180px">' + inp(p + 'name', 'text', { label: 'Fee name' }) + '</td>';
        h += '<td><select data-bind="' + p + 'when" data-kind="text"><option value="once"' + (f.when !== 'monthly' ? ' selected' : '') + '>One-time</option><option value="monthly"' + (f.when === 'monthly' ? ' selected' : '') + '>Monthly</option></select></td>';
        h += '<td style="min-width:190px"><div style="display:flex;gap:6px"><select data-bind="' + p + 'qtyBasis" data-kind="text" data-rerender="1"><option value="fixed"' + (f.qtyBasis !== 'perUnit' ? ' selected' : '') + '>Fixed</option><option value="perUnit"' + (f.qtyBasis === 'perUnit' ? ' selected' : '') + '>Per device</option></select>' + (f.qtyBasis === 'perUnit' ? '' : inp(p + 'qty', 'num', { label: 'Quantity', step: '1' })) + '</div></td>';
        h += '<td class="w-md">' + inp(p + 'price', 'money', { label: 'Price each' }) + '</td><td class="w-md int">' + inp(p + 'cost', 'money', { label: 'Cost each' }) + '</td>';
        h += '<td class="r" id="fee-t-' + i + '"></td><td><button class="btn ghost sm" type="button" data-act="del-fee" data-i="' + i + '" aria-label="Remove fee">✕</button></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';
    $('builder').innerHTML = h;
  }

  /* ---------- volume tiers (whole volume) ---------- */
  var tierSort = function (list) { return (list || []).slice().sort(function (a, b) { return num(a.min) - num(b.min); }); };
  /* "1–50", "51–100", "101+" labels from the sorted tier starts */
  function bandLabels(tiers) {
    var t = tierSort(tiers).filter(function (x) { return num(x.min) > 1; }), out = [];
    var starts = [1].concat(t.map(function (x) { return Math.round(num(x.min)); }));
    starts.forEach(function (st, j) { var nx = starts[j + 1]; out.push(nx ? int(st) + '–' + int(nx - 1) : int(st) + '+'); });
    return out;
  }
  function priceTierEditor(l, i, keys) {
    var tiers = l.priceTiers || [], cols = keys.filter(function (k) { return k !== 'lostFee'; });
    var h = '<div class="tiers"><div class="tiers-head"><b>Volume price tiers</b><span class="fine" style="margin:0">Whole volume: the device’s active units pick one tier and that rate applies to every unit. Blank = base price. Below the first tier the base price applies.</span></div>';
    h += '<table class="tbl tier-tbl"><thead><tr><th class="r">From active units</th>' + cols.map(function (k) { return '<th class="r">' + esc(PRICE_LABEL[k]) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';
    h += '<tr class="base"><td class="r fine" style="margin:0">1 (base)</td>' + cols.map(function (k) { return '<td class="r num">' + rate(l.price[k]) + '</td>'; }).join('') + '<td></td></tr>';
    tiers.forEach(function (t, j) {
      var p = 'lines.' + i + '.priceTiers.' + j + '.';
      h += '<tr><td class="w-sm">' + inp(p + 'min', 'tier', { label: 'Tier starts at active units', step: '1', ph: 'e.g. 51' }) + '</td>' + cols.map(function (k) { return '<td class="w-md">' + inp(p + k, 'tmoney', { label: PRICE_LABEL[k] + ' for this tier', ph: num(l.price[k]).toFixed(2) }) + '</td>'; }).join('') + '<td><button class="btn ghost sm" type="button" data-act="del-ptier" data-i="' + i + '" data-j="' + j + '" aria-label="Remove tier">✕</button></td></tr>';
    });
    h += '</tbody></table><div style="display:flex;gap:10px;align-items:center;margin-top:6px"><button class="btn sm" type="button" data-act="add-ptier" data-i="' + i + '">+ Add tier</button><span class="fine" style="margin:0" id="ptier-now-' + i + '"></span></div></div>';
    return h;
  }
  function costTierEditor(c, i) {
    var tiers = c.costTiers || [];
    var h = '<div class="tiers"><div class="tiers-head"><b>Volume cost tiers · ' + esc(c.name || 'device') + '</b><span class="fine" style="margin:0">Whole volume: a scenario’s active units for this device pick one tier. Blank = base cost. Saved to <code>' + esc(CAT.costTiers) + '</code> on the product.</span></div>';
    h += '<table class="tbl tier-tbl"><thead><tr><th class="r">From active units</th>' + COST_TIER_COLS.map(function (x) { return '<th class="r">' + esc(x.h) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';
    h += '<tr class="base"><td class="r fine" style="margin:0">1 (base)</td>' + COST_TIER_COLS.map(function (x) { return '<td class="r num">' + (blank(c[x.k]) ? '—' : rate(c[x.k])) + '</td>'; }).join('') + '<td></td></tr>';
    tiers.forEach(function (t, j) {
      var cell = function (k, ph, step) { return '<input type="number" min="0" inputmode="decimal" step="' + (step || 'any') + '" data-ctier="' + j + '" data-k="' + k + '" value="' + esc(blank(t[k]) ? '' : t[k]) + '" placeholder="' + esc(ph) + '">'; };
      h += '<tr><td class="w-sm">' + cell('min', 'e.g. 51', '1') + '</td>' + COST_TIER_COLS.map(function (x) { return '<td class="w-md"><span class="money">' + cell(x.k, blank(c[x.k]) ? '' : num(c[x.k]).toFixed(2)) + '</span></td>'; }).join('') + '<td><button class="btn ghost sm" type="button" data-cact="del-ctier" data-j="' + j + '" aria-label="Remove tier">✕</button></td></tr>';
    });
    h += '</tbody></table><button class="btn sm" type="button" data-cact="add-ctier" style="margin-top:6px">+ Add tier</button></div>';
    return h;
  }
  function tierNote(r) {
    var bits = [];
    if (r.priceTier) bits.push('price tier ' + int(r.priceTier) + '+');
    if (r.costTier) bits.push('cost tier ' + int(r.costTier) + '+');
    return bits.join(' · ');
  }

  function modelNote(m, buy) {
    if (m === 'lease') return 'Customer pays per active unit per day, plus a spare rate for spares above the free %. ' + (buy ? BRAND.company + ' owns the devices: purchase cost is spread over each device’s life, plus owned monitoring cost.' : 'Lease cost, spare cost and losses come from the Cost catalog.');
    if (m === 'saas') return 'Transparent Pricing: one all-in monthly price per active unit, covering device, monitoring and support, with no add-on charges. ' + (buy ? BRAND.company + ' owns the devices.' : BRAND.company + ' leases the devices.');
    return 'Customer buys the equipment up front and pays a monitoring service fee per active unit per day. ' + BRAND.company + ' buys the units, so Buy $/unit and Owned svc $/day must be in the Cost catalog.';
  }
  /* devices grouped by their Zoho vendor */
  /* vendors offered in the Studio: ticked EM_JusticePoint_Vendor; fallback until any are ticked */
  function jpVendorInfo() {
    var ticked = state.vendors.filter(function (v) { return v.jp === true; });
    if (ticked.length) return { list: ticked, mode: 'ticked' };
    var used = {}; state.catalog.forEach(function (c) { if (c.vendorId) used[c.vendorId] = 1; });
    return { list: state.vendors.filter(function (v) { return used[v.id] || num(v.units) > 0; }), mode: 'fallback' };
  }
  function isJp(vid) { return jpVendorInfo().list.some(function (v) { return v.id === vid; }); }
  function vendorName(c) { if (c.vendor) return c.vendor; var v = state.vendors.filter(function (x) { return x.id === c.vendorId; })[0]; return v ? v.name : ''; }
  function catalogOptions(sel) {
    var has = false, groups = {}, order = [];
    state.catalog.filter(function (c) { return !c.isNew; }).forEach(function (c) {
      var g = vendorName(c) || 'No vendor';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      if (String(c.id) === String(sel)) has = true;
      groups[g].push('<option value="' + esc(c.id) + '"' + (String(c.id) === String(sel) ? ' selected' : '') + '>' + (state.internal ? esc(c.name || 'Unnamed device') + (c.family ? ' · ' + esc(c.family) : '') : esc(GENERIC[c.family] || 'Monitoring equipment')) + '</option>');
    });
    order.sort(function (a, b) { return a === 'No vendor' ? 1 : b === 'No vendor' ? -1 : a.localeCompare(b); });
    return (has ? '' : '<option value="" selected>Choose a device…</option>') + order.map(function (g) { return state.internal ? '<optgroup label="' + esc(g) + '">' + groups[g].join('') + '</optgroup>' : groups[g].join(''); }).join('');
  }
  function costHint(it, buy, lr) {
    if (!it) return '';
    var eff = it;
    if (lr && lr.costTier) { eff = Object.assign({}, it); var ct = (it.costTiers || []).filter(function (t) { return num(t.min) === lr.costTier; })[0]; E.COST_TIER_KEYS.forEach(function (k) { if (ct && !blank(ct[k])) eff[k] = num(ct[k]); }); }
    if (lr && lr.rateKey) { if (eff === it) eff = Object.assign({}, it); eff[lr.rateKey] = lr.costRate; }
    var vn = vendorName(it); return (vn ? vn + ' · ' : '') + costHintBody(eff, buy) + (lr && lr.manual != null ? ' (vendor price)' : '');
  }
  function costHintBody(it, buy) {
    if (buy) return num(it.costPurchase) ? 'Buy ' + rate(it.costPurchase) + ' · owned svc ' + rate(it.costOwnedDaily || 0) + '/day · ' + (it.usefulLifeMonths || 36) + ' mo life' : 'No Buy $/unit in the Cost catalog';
    if (!num(it.costLeaseDaily)) return 'No Lease $/day in the Cost catalog';
    return 'Cost ' + rate(it.costLeaseDaily) + '/day' + (num(it.spareAllowancePct) ? ' · spares free to ' + one(it.spareAllowancePct) + '%' + (num(it.spareOverageDaily) ? ', then ' + rate(it.spareOverageDaily) + '/day' : '') : (num(it.spareOverageDaily) ? ' · spares ' + rate(it.spareOverageDaily) + '/day' : ''));
  }

  /* ---------- results ---------- */
  function renderResults() {
    var r = calc(), s = state.scenario;
    r.lines.forEach(function (l, i) {
      var el = $('line-m-' + i); if (el) el.innerHTML = l.revMonthly > 0 || l.costMonthly > 0 ? '<span class="chip ' + E.tierOf(l.marginPct, l.revMonthly).key + '" title="' + esc(money(l.marginMonthly) + ' a month on ' + money(l.revMonthly) + ' revenue') + '">' + (l.revMonthly > 0 ? pctf(l.marginPct, 0) : 'no price') + '</span>' : '';
      var hint = $('line-hint-' + i), tn = tierNote(l);
      if (hint) hint.textContent = costHint(itemById(s.lines[i].itemId), r.vendorSource === 'buy', l) + (tn ? ' · ' + tn : '');
      var now = $('ptier-now-' + i); if (now) now.textContent = int(l.active) + ' active units → ' + (l.priceTier ? 'tier ' + int(l.priceTier) + '+ applies' : 'base price applies');
    });
    r.staffing.forEach(function (st, i) { var el = $('staff-m-' + i); if (el) el.innerHTML = '<span class="num">' + money(st.marginMonthly) + '</span><div class="fine" style="margin:0">' + int(st.participants) + ' participants</div>'; });
    r.fees.forEach(function (f, i) { var el = $('fee-t-' + i); if (el) el.innerHTML = '<span class="num">' + money(f.rev) + '</span><div class="fine" style="margin:0">' + (f.when === 'monthly' ? 'a month' : 'once') + ' · qty ' + one(f.qty) + '</div>'; });

    var M = r.monthly, T = r.term, O = r.once;
    var h = '<div class="kpis">';
    h += '<div class="kpi big"><div class="k">Monthly gross margin · ' + esc(r.modelLabel) + '</div><div class="v num' + (M.margin < 0 ? ' neg' : '') + '">' + money(M.margin) + ' <span class="chip ' + r.tier.key + '" style="vertical-align:5px">' + (M.revenue > 0 ? pctf(M.marginPct) + ' · ' : '') + esc(r.tier.label) + '</span></div><div class="c">year one, at ' + int(r.units.active) + ' active units</div></div>';
    h += '<div class="kpi"><div class="k">Monthly revenue</div><div class="v num">' + money(M.revenue) + '</div>' + (M.rev.minimum > 0 ? '<div class="c">incl. ' + money(M.rev.minimum) + ' minimum top-up</div>' : '') + '</div>';
    h += '<div class="kpi"><div class="k">Monthly cost</div><div class="v num">' + money(M.cost) + '</div>' + (M.costs.amort > 0 ? '<div class="c">incl. ' + money(M.costs.amort) + ' device depreciation</div>' : '') + '</div>';
    h += '<div class="kpi"><div class="k">Term margin · ' + T.months + ' mo</div><div class="v num' + (T.margin < 0 ? ' neg' : '') + '">' + money(T.margin) + '</div><div class="c">' + pctf(T.marginPct) + ' of ' + money(T.revenue) + '</div></div>';
    h += '<div class="kpi"><div class="k">Cash payback</div><div class="v num">' + (T.paybackMonth == null ? 'Never' : T.paybackMonth === 0 ? 'Day one' : 'Month ' + T.paybackMonth) + '</div><div class="c">' + (O.capex + O.cost > 0 ? money(O.capex + O.cost) + ' out up front' : 'nothing out up front') + '</div></div>';
    h += '</div>';

    var un = unresolvedLines();
    if (un.length) h += '<div class="sect"><div class="alert"><b>' + un.length + ' price' + (un.length === 1 ? '' : 's') + ' differ from Zoho.</b> Choose Use Zoho, Keep or Save to Zoho under each highlighted price.</div></div>';
    if (r.missing.length) h += '<div class="sect"><div class="alert"><b>Missing costs</b> — margin is overstated until these are in the Cost catalog:<ul>' + r.missing.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';

    renderVendorResults(r);
    h += breakEvenSection(r);

    h += '<div class="sect"><h3>Target ' + pctf(s.targetMarginPct, 0) + ' term margin</h3><div class="target">';
    if (r.solve && r.solve.k != null) {
      var d = (r.solve.k - 1) * 100;
      if (!r.solve.feasible) h += '<span>Fees, staffing and spare charges already exceed the target on their own; device prices could be zero.</span>';
      else if (Math.abs(d) < 0.5) h += '<span>Current device prices land on target.</span>';
      else h += '<span>' + (d > 0 ? 'Raise' : 'You could lower') + ' this model’s device prices by <b>' + pctf(Math.abs(d)) + '</b> ' + (d > 0 ? 'to reach' : 'and still reach') + ' the target.</span><span><button class="btn sm primary" type="button" data-act="apply-target">Apply ' + (d > 0 ? '+' : '−') + pctf(Math.abs(d)) + ' to device prices</button></span>';
      if (num(s.minimumMonthly) > 0) h += '<span class="fine" style="margin:0">The monthly minimum is held fixed in this calculation.</span>';
    } else h += '<span>' + esc((r.solve && r.solve.reason) || 'Add a device with a price to calculate.') + '</span>';
    h += '</div></div>';

    if (r.perUnitDay) h += '<div class="sect"><h3>Per active unit per day</h3><dl class="facts"><dt>Revenue</dt><dd>' + rate(r.perUnitDay.revenue) + '</dd><dt>Cost (break-even)</dt><dd>' + rate(r.perUnitDay.cost) + '</dd>' + (r.perUnitDay.target != null ? '<dt>Needed for ' + pctf(s.targetMarginPct, 0) + ' margin</dt><dd>' + rate(r.perUnitDay.target) + '</dd>' : '') + '</dl></div>';

    var revParts = [['Devices', M.rev.device], ['Spare charges', M.rev.spares], ['Loss fees', M.rev.lost], ['Staffing', M.rev.staffing], ['Monthly fees', M.rev.fees], ['Minimum top-up', M.rev.minimum]];
    var costParts = [['Devices', M.costs.device], ['Spares', M.costs.spares], ['Lost units', M.costs.lost], ['Device depreciation', M.costs.amort], ['Staffing', M.costs.staffing], ['Monthly fees', M.costs.fees]];
    var max = Math.max.apply(null, revParts.concat(costParts).map(function (p) { return p[1]; }).concat([1]));
    var bars = function (parts, c) { return parts.filter(function (p) { return p[1] > 0.005; }).map(function (p) { return '<div class="barrow"><span class="l">' + esc(p[0]) + '</span><span class="t"><i' + (c ? ' class="c"' : '') + ' style="width:' + (p[1] / max * 100).toFixed(1) + '%"></i></span><span class="a">' + money(p[1]) + '</span></div>'; }).join('') || '<div class="fine">—</div>'; };
    h += '<div class="sect"><h3>Where the month goes</h3><div class="bars">' + bars(revParts, false) + '</div><div class="bars" style="margin-top:10px">' + bars(costParts, true) + '</div></div>';
    h += '<div class="sect"><h3>Up front and over the term</h3><dl class="facts"><dt>One-time revenue</dt><dd>' + money(O.rev) + '</dd><dt>One-time cost</dt><dd>' + money(O.cost) + '</dd>';
    if (O.capex > 0) h += '<dt>Device purchase</dt><dd>' + money(O.capex) + '</dd>';
    h += '<span class="sep"></span><dt>Total devices</dt><dd>' + one(r.units.fleet) + '</dd><dt>Term revenue</dt><dd>' + money(T.revenue) + '</dd><dt>Term cost</dt><dd>' + money(T.cost) + '</dd>';
    if (T.residual > 0) h += '<dt>Device book value at end</dt><dd>' + money(T.residual) + '</dd>';
    h += '</dl></div>';
    $('results').innerHTML = h;
    if (state.tab === 'compare') renderCompare();
    if (state.tab === 'proposal') renderDoc();
    resize();
  }

  /* ---------- break-even on purchased devices ---------- */
  var monthsTxt = function (m) { if (m == null) return 'Never'; if (m <= 0) return 'Day one'; return (m < 10 ? one(m) : int(m)) + ' mo'; };
  function breakEvenSection(r) {
    var be = r.breakEven, whatIf = false, lines = r.lines;
    if (!be && r.model !== 'purchase') { var w = calc({ model: r.model, vendorSource: 'buy', noSolve: true }); be = w.breakEven; lines = w.lines; whatIf = true; }
    if (!be) return '';
    var noBuy = lines.some(function (l) { return l.breakEven && !(l.breakEven.perUnitCost > 0); });
    var dm = be.deviceMonths, late = dm == null || dm > be.termMonths;
    var h = '<div class="sect"><h3>Device break-even' + (whatIf ? ' · if ' + esc(BRAND.company) + ' bought the devices' : '') + '</h3>';
    if (noBuy) h += '<div class="alert" style="margin-bottom:8px">Enter a Buy $/unit in the Cost catalog for every device to see a reliable break-even.</div>';
    h += '<dl class="facts"><dt>Device investment</dt><dd>' + money(be.investment) + '</dd>';
    if (be.upfront > 0) h += '<dt>Customer pays up front</dt><dd>' + money(be.upfront) + '</dd>';
    h += '<dt>Device cash margin / mo</dt><dd>' + money(be.deviceMonthlyCash) + '</dd><span class="sep"></span>';
    h += '<dt><b>Devices break even</b></dt><dd><b' + (late ? ' style="color:var(--bad)"' : '') + '>' + monthsTxt(dm) + '</b></dd>';
    h += '<dt>Whole deal breaks even</dt><dd>' + monthsTxt(be.dealMonths) + '</dd><dt>Term</dt><dd>' + int(be.termMonths) + ' mo</dd></dl>';
    var rows = lines.filter(function (l) { return l.breakEven; });
    if (rows.length) {
      h += '<table class="tbl" style="margin-top:8px"><thead><tr><th>Device</th><th class="r">Units</th><th class="r">Invest</th><th class="r">Break-even</th><th class="r">Life</th></tr></thead><tbody>';
      rows.forEach(function (l) { var b = l.breakEven, bad = b.months == null || b.months > b.lifeMonths; h += '<tr><td>' + esc(l.name) + '</td><td class="r">' + one(b.units) + '</td><td class="r">' + money(b.investment) + '</td><td class="r"' + (bad ? ' style="color:var(--bad);font-weight:700"' : '') + '>' + monthsTxt(b.months) + '</td><td class="r">' + int(b.lifeMonths) + ' mo</td></tr>'; });
      h += '</tbody></table>';
    }
    h += '<p class="fine">' + (whatIf ? 'Sourcing is set to Lease, so this is a what-if using Buy $/unit and Owned svc $/day from the Cost catalog. ' : '') + '“Devices” recovers the device purchase cost from device, spare and loss-fee margin only; “whole deal” adds fees, staffing, the minimum and escalators. Red = no payback within the term or the device’s life.</p></div>';
    return h;
  }

  /* ---------- compare ---------- */
  var MODEL_COLORS = { lease: 'var(--s1)', saas: 'var(--s2)', purchase: 'var(--s3)' };
  function renderCompare() {
    var s = state.scenario, all = E.compare(s, state.catalog);
    var noPrice = function (r) { return r.lines.length && r.monthly.rev.device === 0 && r.once.rev === 0; };
    $('cmp-meta').textContent = int(all[0].units.active) + ' active units · ' + s.termMonths + '-month term · prices from each model’s columns';
    var rows = [
      ['Monthly revenue', function (r) { return money(r.monthly.revenue); }, function (r) { return r.monthly.revenue; }],
      ['Monthly cost', function (r) { return money(r.monthly.cost); }, function (r) { return -r.monthly.cost; }],
      ['Monthly margin', function (r) { return money(r.monthly.margin); }, function (r) { return r.monthly.margin; }],
      ['Margin %', function (r) { return r.monthly.revenue > 0 ? pctf(r.monthly.marginPct) + ' <span class="chip ' + r.tier.key + '">' + r.tier.label + '</span>' : '—'; }, function (r) { return r.monthly.marginPct; }],
      ['Term revenue', function (r) { return money(r.term.revenue); }, function (r) { return r.term.revenue; }],
      ['Term margin', function (r) { return money(r.term.margin); }, function (r) { return r.term.margin; }],
      ['Term margin %', function (r) { return r.term.revenue > 0 ? pctf(r.term.marginPct) : '—'; }, function (r) { return r.term.marginPct; }],
      ['Cash out up front', function (r) { return money(r.once.capex + r.once.cost); }, function (r) { return -(r.once.capex + r.once.cost); }],
      ['Customer pays up front', function (r) { return money(r.once.rev); }, null],
      ['Cash payback', function (r) { return r.term.paybackMonth == null ? 'Never' : r.term.paybackMonth === 0 ? 'Day one' : 'Month ' + r.term.paybackMonth; }, function (r) { return r.term.paybackMonth == null ? -1e9 : -r.term.paybackMonth; }],
      ['Device break-even', function (r) { return r.breakEven ? monthsTxt(r.breakEven.deviceMonths) : '<span class="fine" style="margin:0">leased devices</span>'; }, function (r) { return r.breakEven ? (r.breakEven.deviceMonths == null ? -1e9 : -r.breakEven.deviceMonths) : -Infinity; }],
      ['Revenue per active unit-day', function (r) { return r.perUnitDay ? rate(r.perUnitDay.revenue) : '—'; }, null],
      ['Cost per active unit-day', function (r) { return r.perUnitDay ? rate(r.perUnitDay.cost) : '—'; }, null],
      ['Missing costs', function (r) { return r.missing.length ? '<span class="chip thin">' + r.missing.length + '</span>' : 'none'; }, null]
    ];
    var h = '<table class="cmp"><thead><tr><th></th>' + all.map(function (r) { return '<th><span class="sw" style="background:' + MODEL_COLORS[r.model] + '"></span>' + esc(r.modelLabel) + (r.model === s.model ? ' · current' : '') + (noPrice(r) ? '<div class="fine" style="margin:2px 0 0;font-weight:500">no prices entered</div>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) {
      var vals = row[2] ? all.map(function (r) { return noPrice(r) ? -Infinity : row[2](r); }) : null, best = vals ? Math.max.apply(null, vals) : null;
      h += '<tr' + (row[0] === 'Term margin' ? ' class="hl"' : '') + '><td>' + esc(row[0]) + '</td>' + all.map(function (r, i) { return '<td class="' + (vals && vals[i] === best && isFinite(best) && all.length > 1 ? 'best' : '') + '">' + row[1](r) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table><p class="fine" style="padding:0 12px 12px">Bold marks the strongest model on each row. Each model’s prices are entered in its own columns on the Scenario tab. <button class="btn sm" type="button" data-act="goto-scenario">Edit prices</button></p>';
    $('cmp-table').innerHTML = h;
    renderChart(all);
    var sens = E.sensitivity(s, state.catalog);
    $('sens').innerHTML = '<table class="cmp"><thead><tr><th>Volume</th><th>Active units</th><th>Monthly revenue</th><th>Monthly margin</th><th>Margin %</th></tr></thead><tbody>' + sens.map(function (x) { var t = E.tierOf(x.marginPct, x.revenue); return '<tr' + (x.factor === 1 ? ' class="hl"' : '') + '><td>' + (x.factor === 1 ? 'As modelled' : (x.factor > 1 ? '+' : '−') + Math.round(Math.abs(x.factor - 1) * 100) + '%') + '</td><td>' + int(x.active) + '</td><td>' + money(x.revenue) + '</td><td>' + money(x.margin) + '</td><td>' + (x.revenue > 0 ? pctf(x.marginPct) + ' <span class="chip ' + t.key + '">' + t.label + '</span>' : '—') + '</td></tr>'; }).join('') + '</tbody></table><p class="fine" style="padding:0 12px 12px">Fixed fees, flat staffing and the monthly minimum do not scale, so thin scenarios fall fastest when volume drops.</p>';
    $('sens-meta').textContent = E.MODELS[s.model].label + ' · all device volumes scaled together';
    resize();
  }
  function renderChart(all) {
    var W = 900, H = 260, L = 70, R = 16, TP = 14, B = 30;
    var T = all[0].term.cumulativeCash.length - 1;
    var vals = []; all.forEach(function (r) { vals = vals.concat(r.term.cumulativeCash); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (hi === lo) hi = lo + 1;
    var nice = function (v) { var m = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))); return Math.ceil(v / m) * m; };
    hi = hi > 0 ? nice(hi) : 0; lo = lo < 0 ? -nice(-lo) : 0;
    var x = function (m) { return L + (W - L - R) * m / Math.max(1, T); }, y = function (v) { return TP + (H - TP - B) * (hi - v) / (hi - lo); };
    var g = '';
    for (var i = 0; i <= 4; i++) { var v = lo + (hi - lo) * i / 4, yy = y(v); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + esc(shortMoney(v)) + '</text>'; }
    g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--line-strong)" stroke-width="1.5"/>';
    for (var mm = 0; mm <= T; mm += (T > 24 ? 12 : 6)) g += '<text x="' + x(mm).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + (mm === 0 ? 'Start' : 'Mo ' + mm) + '</text>';
    all.forEach(function (r) {
      var d = r.term.cumulativeCash.map(function (v, m) { return (m ? 'L' : 'M') + x(m).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
      g += '<path d="' + d + '" fill="none" stroke="' + MODEL_COLORS[r.model] + '" stroke-width="' + (r.model === state.scenario.model ? 2.5 : 2) + '" stroke-linejoin="round" stroke-linecap="round"/>';
      g += '<circle cx="' + x(T).toFixed(1) + '" cy="' + y(r.term.cumulativeCash[T]).toFixed(1) + '" r="3.5" fill="' + MODEL_COLORS[r.model] + '"/>';
    });
    g += '<line id="cx" x1="0" x2="0" y1="' + TP + '" y2="' + (H - B) + '" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/><rect id="chit" x="' + L + '" y="' + TP + '" width="' + (W - L - R) + '" height="' + (H - TP - B) + '" fill="transparent"/>';
    $('cmp-chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Cumulative cash margin by month for each pricing model">' + g + '</svg>';
    $('cmp-legend').innerHTML = all.map(function (r) { return '<span><i style="background:' + MODEL_COLORS[r.model] + '"></i>' + esc(r.modelLabel) + ' · ends at ' + money(r.term.cumulativeCash[T]) + '</span>'; }).join('');
    var svg = $('cmp-chart').querySelector('svg'), hit = $('chit'), cx = $('cx'), tip = $('tip');
    hit.addEventListener('mousemove', function (ev) {
      var b = svg.getBoundingClientRect(), px = (ev.clientX - b.left) / b.width * W, m = Math.max(0, Math.min(T, Math.round((px - L) / (W - L - R) * T)));
      cx.setAttribute('x1', x(m)); cx.setAttribute('x2', x(m)); cx.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + (m === 0 ? 'Start' : 'Month ' + m) + '</b><br>' + all.map(function (r) { return esc(r.modelLabel) + ': ' + money(r.term.cumulativeCash[m]); }).join('<br>');
      tip.hidden = false; tip.style.left = Math.min(window.innerWidth - 220, ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px';
    });
    hit.addEventListener('mouseleave', function () { cx.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }
  var shortMoney = function (v) { var a = Math.abs(v), s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a); return (v < 0 ? '−$' : '$') + s; };

  /* ---------- Zoho field setup panel ---------- */
  function renderSetup() {
    var su = state.setup, rows = [];
    var catLabel = function (k) { var c = colOf(k); return c ? { h: c.h, type: c.type } : (CAT_OTHER[k] || { h: k, type: 'Single Line' }); };
    su.products.forEach(function (m) { var l = catLabel(m.key); rows.push(['Products', l.h + ' (your cost)', m.api, l.type]); });
    su.prices.forEach(function (m) { rows.push(['Products', PRICE_LABEL[m.key] + ' (customer price)', m.api, 'Currency']); });
    (su.vendors || []).forEach(function (m) { rows.push(['Vendors', m.api === VENDOR_FLAG_FIELD ? 'JusticePoint vendor (tick to show in the Studio)' : 'Current units with this vendor (sets the cost tier)', m.api, m.api === VENDOR_FLAG_FIELD ? 'Checkbox' : 'Number']); });
    su.scenarios.forEach(function (m) { rows.push(['Pricing_Scenarios', m.api.replace(/_/g, ' '), m.api, m.api === 'Scenario_JSON' ? 'Multi Line (large)' : m.api === 'Account' ? 'Lookup (Accounts)' : /Status|Model|Source|Tier/.test(m.api) ? 'Picklist' : /Until|Sent/.test(m.api) ? 'Date' : /Name|Options/.test(m.api) ? 'Single Line' : 'Number / Currency']); });
    var ro = (su.productsReadOnly || []).concat(su.pricesReadOnly || []);
    var el = $('cat-setup');
    if (!rows.length && !ro.length) { el.hidden = true; el.innerHTML = ''; return; }
    var h = '<details' + (su.products.length ? ' open' : '') + '><summary><b>' + rows.length + ' Zoho field' + (rows.length === 1 ? '' : 's') + ' missing' + (ro.length ? ', ' + ro.length + ' read-only' : '') + '</b> · values for these fields can be typed but will not save until the field exists</summary>';
    if (rows.length) h += '<table class="tbl" style="margin-top:8px"><thead><tr><th>Module</th><th>What it holds</th><th>API name (exact)</th><th>Field type</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td><code>' + esc(r[2]) + '</code></td><td>' + esc(r[3]) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (ro.length) h += '<p class="fine">Read-only for your profile (give your profile Read and Write in Setup → Modules and Fields → Products → field → Set Permission): ' + ro.map(function (m) { return '<code>' + esc(m.api) + '</code>'; }).join(', ') + '</p>';
    h += '<p class="fine">Create them in Setup → Modules and Fields, then press <b>Refresh from Zoho</b>.</p></details>';
    el.innerHTML = h; el.hidden = false;
  }

  /* ---------- cost catalog ---------- */
  function renderCatalog() {
    $('cat-note').innerHTML = PREVIEW
      ? 'Your costs for each device. <b>Preview:</b> “Zoho” here is sample data stored in this browser, so you can try matching. In Zoho CRM this table reads and writes the Products records.'
      : 'Your costs for each device, read from and saved to its Products record in Zoho. Vendors come from the Zoho Vendors module; choosing a vendor here sets the Vendor lookup on the product.';
    renderSetup();
    renderVendorBar();
    var vf = state.vendorFilter;
    var h = '<table class="tbl cat"><thead><tr><th>Device</th><th>Vendor</th><th>Family</th>' + CAT_COLS.map(function (c) { return '<th class="r" title="' + esc(c.tip) + '">' + esc(c.h) + '</th>'; }).join('') + '<th>Notes</th><th>Tiers</th></tr></thead><tbody>';
    var shown = 0;
    state.catalog.forEach(function (c, i) {
      if (!c.ack) c.ack = {};
      if (vf && !c.isNew && (vf === '_none' ? !!c.vendorId : vf === '_off' ? (!c.vendorId || isJp(c.vendorId)) : c.vendorId !== vf)) return;
      shown++;
      var jpl = jpVendorInfo().list, vendorKnown = jpl.some(function (v) { return v.id === c.vendorId; });
      var offList = c.vendorId && !vendorKnown;   /* linked to a vendor that is not a JusticePoint vendor */
      h += '<tr data-ci="' + i + '"' + (state.catDirty[c.id] ? ' class="changed"' : '') + '>';
      h += '<td><input type="text" data-cat="name" value="' + esc(c.name) + '" placeholder="Device name" aria-label="Device name"></td>';
      h += '<td><select data-cat="vendorId" aria-label="Vendor"><option value="">Vendor…</option>' + (offList ? '<option value="' + esc(c.vendorId) + '" selected>' + esc(vendorName(c) || 'Linked vendor') + ' (not a JusticePoint vendor)</option>' : '') + jpl.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === c.vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' + (offList ? '<div class="zc diff">Not a JusticePoint vendor</div>' : '') + '</td>';
      h += '<td><select data-cat="family" aria-label="Family"><option value="">—</option>' + FAMILIES.concat(c.family && FAMILIES.indexOf(c.family) < 0 ? [c.family] : []).map(function (f) { return '<option' + (f === c.family ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></td>';
      CAT_COLS.forEach(function (col) {
        h += '<td class="r pcell"><span class="' + (col.t === 'money' ? 'money' : col.t === 'pct' ? 'pctw' : '') + '"><input type="number" min="0" inputmode="decimal" step="' + (col.t === 'int' ? '1' : 'any') + '" data-cat="' + col.k + '" value="' + esc(blank(c[col.k]) ? '' : c[col.k]) + '" aria-label="' + esc((c.name || 'Device') + ' ' + col.h) + '"></span><div class="zslot" id="zc-c-' + i + '-' + col.k + '">' + catBadgeHtml(c, i, col.k, col.t) + '</div></td>';
      });
      h += '<td><input type="text" class="src" data-cat="notes" value="' + esc(c.notes || '') + '" placeholder="Optional" aria-label="Notes"></td>';
      var nct = (c.costTiers || []).length, copen = !!state.openTiers['c' + c.id];
      h += '<td><button class="btn sm" type="button" data-cact="tog-ctier" aria-expanded="' + copen + '">Tiers' + (nct ? ' (' + nct + ')' : '') + '</button></td></tr>';
      if (copen) h += '<tr class="tier-row" data-ci="' + i + '"><td colspan="' + (5 + CAT_COLS.length) + '">' + costTierEditor(c, i) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (!state.catalog.length) h = '<p class="empty">No active products in Zoho. Add a device.</p>';
    else if (!shown) h = '<p class="empty">No products are linked to this vendor in Zoho yet. Use + Add device to create one for it.</p>';
    $('cat-table').innerHTML = h;
    $('cat-save').disabled = !Object.keys(state.catDirty).length;
    resize();
  }
  function renderVendorBar() {
    var el = $('cat-vendors'); if (!el) return;
    var info = jpVendorInfo(), jpl = info.list, jpIds = {}; jpl.forEach(function (v) { jpIds[v.id] = 1; });
    var count = {}, none = 0, off = 0;
    state.catalog.forEach(function (c) { if (c.isNew) return; if (!c.vendorId) { none++; return; } count[c.vendorId] = (count[c.vendorId] || 0) + 1; if (!jpIds[c.vendorId]) off++; });
    var vf = state.vendorFilter;
    var sel = '<select id="cat-vendor" aria-label="Filter by vendor" style="width:auto;min-width:220px"><option value="">All JusticePoint vendors (' + jpl.length + ')</option>' +
      jpl.map(function (v) { return '<option value="' + esc(v.id) + '"' + (vf === v.id ? ' selected' : '') + '>' + esc(v.name) + ' · ' + (count[v.id] || 0) + ' product' + ((count[v.id] || 0) === 1 ? '' : 's') + '</option>'; }).join('') +
      (off ? '<option value="_off"' + (vf === '_off' ? ' selected' : '') + '>Other vendors · ' + off + '</option>' : '') +
      (none ? '<option value="_none"' + (vf === '_none' ? ' selected' : '') + '>No vendor · ' + none + '</option>' : '') + '</select>';
    var note = info.mode === 'ticked'
      ? jpl.length + ' JusticePoint vendor' + (jpl.length === 1 ? '' : 's') + ' (ticked <code>' + esc(VENDOR_FLAG_FIELD) + '</code> in Zoho)'
      : '<b>No vendors are ticked as JusticePoint vendors yet</b>, so vendors with products or current units are shown. Tick <code>' + esc(VENDOR_FLAG_FIELD) + '</code> on each JusticePoint vendor in Zoho, then Refresh from Zoho.';
    el.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 10px">' + sel +
      '<span class="fine" style="margin:0">' + note + (off ? ' · <b>' + off + ' product' + (off === 1 ? '' : 's') + ' linked to other vendors</b>' : '') + (none ? ' · <b>' + none + ' without a vendor</b>' : '') + '</span></div>';
  }
  function onCatInput(ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-ctier') != null) {
      var row = t.closest('[data-ci]'), ci = state.catalog[Number(row.getAttribute('data-ci'))]; if (!ci) return;
      var tj = (ci.costTiers || [])[Number(t.getAttribute('data-ctier'))]; if (!tj) return;
      tj[t.getAttribute('data-k')] = t.value === '' ? null : Number(t.value);
      state.catDirty[ci.id] = true; $('cat-save').disabled = false; renderResults(); return;
    }
    var key = t.getAttribute && t.getAttribute('data-cat'); if (!key) return;
    var tr = t.closest('[data-ci]'), i = Number(tr.getAttribute('data-ci')), c = state.catalog[i]; if (!c) return;
    var col = colOf(key);
    if (col) c[key] = t.value === '' ? null : Number(t.value);
    else if (key === 'vendorId') { c.vendorId = t.value; c.vendor = (state.vendors.filter(function (v) { return v.id === t.value; })[0] || {}).name || ''; }
    else c[key] = t.value;
    state.catDirty[c.id] = true; tr.classList.add('changed'); $('cat-save').disabled = false;
    if (col) updCatBadge(i, key);
    renderResults();
  }
  function onCatAct(ev) {
    var b = ev.target.closest && ev.target.closest('[data-cact]'); if (!b) return;
    var row = b.closest('[data-ci]'), c = state.catalog[Number(row.getAttribute('data-ci'))]; if (!c) return;
    var a = b.getAttribute('data-cact');
    if (!Array.isArray(c.costTiers)) c.costTiers = [];
    if (a === 'tog-ctier') { state.openTiers['c' + c.id] = !state.openTiers['c' + c.id]; renderCatalog(); return; }
    if (a === 'add-ctier') { var last = tierSort(c.costTiers).pop(); c.costTiers.push({ min: last ? Math.round(num(last.min)) + 50 : 51 }); }
    else if (a === 'del-ctier') c.costTiers.splice(Number(b.getAttribute('data-j')), 1);
    state.catDirty[c.id] = true; renderCatalog(); renderResults();
  }
  function catInputEl(i, k) { return $('cat-table').querySelector('tr[data-ci="' + i + '"] [data-cat="' + k + '"]'); }
  function saveCatalog() {
    var rows = state.catalog.filter(function (c) { return state.catDirty[c.id]; });
    if (rows.some(function (c) { return !String(c.name || '').trim(); })) { toast('Every device needs a name.', true); return; }
    var un = unresolvedCat(rows);
    if (un.length) {
      toast(un.length + ' value' + (un.length === 1 ? '' : 's') + ' differ from Zoho. Choose Use Zoho or Keep mine on each before saving.', true, 7000);
      var i = state.catalog.indexOf(un[0].c), el = catInputEl(i, un[0].k); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
      return;
    }
    $('cat-save').disabled = true; $('cat-save').textContent = 'Saving…';
    var oldIds = rows.map(function (c) { return c.id; });
    api.saveCatalog(rows).then(function (res) {
      rows.forEach(function (c, i) {
        if (oldIds[i] !== c.id) state.scenario.lines.forEach(function (l) { if (String(l.itemId) === String(oldIds[i])) l.itemId = c.id; });
        c.zoho = api.snapshot(c); c.ack = {};
        res.skipped.forEach(function (a) { var k = Object.keys(CAT).filter(function (x) { return CAT[x] === a; })[0]; if (k && c.zoho) c.zoho[k] = null; });
        if (!c.zohoPrice) c.zohoPrice = {};
      });
      state.catDirty = {}; $('cat-save').textContent = 'Save changes'; renderCatalog(); renderBuilder(); renderResults();
      if (res.skipped.length) toast('Saved ' + res.count + ' device' + (res.count === 1 ? '' : 's') + '. Not saved because the field is missing or read-only in Zoho: ' + res.skipped.join(', ') + '. See the list above the table.', true, 12000);
      else toast('Saved ' + res.count + ' device' + (res.count === 1 ? '' : 's') + (PREVIEW ? ' (preview: stored in this browser).' : ' to Zoho Products.'));
    }).catch(function (e) { $('cat-save').disabled = false; $('cat-save').textContent = 'Save changes'; toast('Not saved · ' + e.message, true, 10000); });
  }
  function refreshFromZoho(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Reloading…'; }
    return Promise.all([api.catalog(true), api.setupReport(true), api.vendors(true)]).then(function (res) {
      var fresh = res[0]; state.setup = res[1]; state.vendors = res[2];
      fresh.forEach(function (f) {
        var c = itemById(f.id);
        if (!c) { state.catalog.push(f); return; }
        c.zoho = f.zoho; c.zohoPrice = f.zohoPrice;
        if (!state.catDirty[c.id]) Object.keys(f).forEach(function (k) { if (k !== 'ack') c[k] = f[k]; });
      });
      renderCatalog(); renderBuilder(); renderResults();
      toast('Reloaded ' + state.catalog.filter(function (c) { return !c.isNew; }).length + ' products and ' + state.vendors.length + ' vendors' + (PREVIEW ? ' (preview).' : ' from Zoho.'));
    }).catch(function (e) { toast('Could not reload from Zoho · ' + e.message, true, 8000); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = 'Refresh from Zoho'; } });
  }

  /* ---------- Use Zoho / Keep / Save to Zoho ---------- */
  function onZoho(ev) {
    var b = ev.target.closest && ev.target.closest('[data-z]'); if (!b || b.disabled) return;
    var act = b.getAttribute('data-z'), scope = b.getAttribute('data-scope'), i = Number(b.getAttribute('data-i')), k = b.getAttribute('data-k');
    if (scope === 'cat') {
      var c = state.catalog[i]; if (!c) return;
      if (act === 'use') { c[k] = c.zoho[k]; delete c.ack[k]; var el = catInputEl(i, k); if (el) el.value = blank(c[k]) ? '' : c[k]; }
      else if (act === 'keep') c.ack[k] = c[k];
      state.catDirty[c.id] = true; $('cat-save').disabled = false;
      updCatBadge(i, k); renderResults(); return;
    }
    var l = state.scenario.lines[i]; if (!l) return;
    if (!l.confirmed) l.confirmed = {};
    if (act === 'use') {
      l.price[k] = num(lineZoho(l, k)); delete l.confirmed[k];
      var inpEl = $('builder').querySelector('[data-bind="lines.' + i + '.price.' + k + '"]'); if (inpEl) inpEl.value = l.price[k];
    } else if (act === 'keep') l.confirmed[k] = l.price[k];
    else if (act === 'push') {
      var it = itemById(l.itemId), val = num(l.price[k]);
      b.disabled = true; b.textContent = 'Saving…';
      api.savePrice(l.itemId, k, val).then(function () {
        it.zohoPrice = it.zohoPrice || {}; it.zohoPrice[k] = val;
        state.scenario.lines.forEach(function (x, j) { if (String(x.itemId) === String(l.itemId)) updLineBadge(j, k); });
        renderResults(); toast(PRICE_LABEL[k] + ' for ' + (it.name || 'this device') + ' is now ' + rate(val) + ' in Zoho.');
      }).catch(function (e) { toast(e.message, true, 9000); updLineBadge(i, k); });
      return;
    }
    setDirty(true); updLineBadge(i, k); renderResults();
  }

  /* ---------- proposal ---------- */
  function propOptions() {
    var p = state.scenario.proposal, list = (p.options || ['current']).map(function (o) { return o === 'current' ? state.scenario.model : o; });
    var seen = {}; return list.filter(function (m) { if (seen[m] || !E.MODELS[m]) return false; seen[m] = 1; return true; });
  }
  function renderPropControls() {
    var s = state.scenario, p = s.proposal, opts = propOptions();
    var h = '<div class="head"><h2>Proposal</h2><span class="meta">customer-facing · no costs, margins or vendors</span></div><div class="body stack" style="gap:12px">';
    h += '<div><div class="fine" style="margin:0 0 6px">Pricing options to present</div>' + Object.keys(E.MODELS).map(function (k) { return '<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" data-popt="' + k + '"' + (opts.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(E.MODELS[k].label) + (k === s.model ? ' (current)' : '') + '</label>'; }).join('') + '</div>';
    h += field('Prepared by', inp('proposal.preparedBy', 'text', { ph: state.user || 'Your name' }));
    h += field('Valid for', inp('proposal.validDays', 'int'), 'days');
    h += '<label class="f"><span>Opening paragraph <span class="hint">· blank uses the default</span></span><textarea data-bind="proposal.intro" data-kind="text" rows="4" placeholder="' + esc(defaultIntro()) + '">' + esc(p.intro || '') + '</textarea></label>';
    h += '<label class="f"><span>Extra terms <span class="hint">· one per line</span></span><textarea data-bind="proposal.extraTerms" data-kind="text" rows="3">' + esc(p.extraTerms || '') + '</textarea></label>';
    h += '<label class="check"><input type="checkbox" data-bind="proposal.genericNames" data-kind="bool"' + (p.genericNames !== false ? ' checked' : '') + '> Describe devices generically (hide manufacturer and model)</label>';
    h += '<label class="check"><input type="checkbox" data-bind="proposal.showSchedule" data-kind="bool"' + (p.showSchedule ? ' checked' : '') + '> Show the full volume rate schedule</label>';
    h += '<label class="check"><input type="checkbox" data-bind="proposal.showMonthlyEstimate" data-kind="bool"' + (p.showMonthlyEstimate !== false ? ' checked' : '') + '> Show estimated monthly and term totals</label>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn primary" type="button" data-act="pdf">Download PDF</button><button class="btn" type="button" data-act="print">Print</button><button class="btn" type="button" data-act="attach">' + (PREVIEW ? 'Attach to scenario' : 'Attach to scenario in Zoho') + '</button></div>';
    var missing = opts.map(function (m) { return E.price(s, state.catalog, { model: m }); }).filter(function (r) { return r.lines.length && r.monthly.rev.device === 0 && r.once.rev === 0; });
    if (missing.length) h += '<div class="alert">No device prices entered for ' + missing.map(function (r) { return esc(r.modelLabel); }).join(', ') + '. Enter them on the Scenario tab with that model selected.</div>';
    var un = unresolvedLines(); if (un.length) h += '<div class="alert">' + un.length + ' price' + (un.length === 1 ? '' : 's') + ' still differ from Zoho. Confirm them on the Scenario tab before sending.</div>';
    h += '<div id="leak"></div><p class="fine" style="margin:0">Only customer prices and contract terms appear. By default only the rate for the proposed volume is shown, so lower volume tiers stay private.</p></div>';
    $('prop-controls').innerHTML = h;
  }
  /* customer-facing device descriptions: hide manufacturer and model names */
  var GENERIC = { 'GPS': 'GPS location monitoring', 'CAM': 'Continuous alcohol monitoring', 'Remote Breath': 'Remote breath alcohol testing', 'RF': 'Radio-frequency home monitoring', 'Victim / DV': 'Victim notification monitoring', 'Accessory': 'Monitoring accessory', 'Service': 'Monitoring service', 'Other': 'Monitoring equipment' };
  function propDeviceNames() {
    var s = state.scenario, generic = s.proposal.genericNames !== false, base = [], cnt = {}, seen = {};
    s.lines.forEach(function (l) { var it = itemById(l.itemId) || {}; var nm = generic ? (GENERIC[it.family] || 'Monitoring equipment') : (it.name || 'Monitoring equipment'); base.push(nm); cnt[nm] = (cnt[nm] || 0) + 1; });
    return base.map(function (nm) { if (cnt[nm] < 2) return nm; seen[nm] = (seen[nm] || 0) + 1; return nm + ' · Type ' + 'ABCDEFGH'.charAt(seen[nm] - 1); });
  }
  /* words that must never appear in the customer document */
  function leakCheck() {
    var doc = $('doc'); if (!doc) return [];
    var text = doc.textContent.toLowerCase(), hits = [], words = [];
    state.vendors.forEach(function (v) { if (v.name && v.name.length > 2) words.push(v.name); });
    state.scenario.lines.forEach(function (l) { var it = itemById(l.itemId); if (it && it.vendor) words.push(it.vendor); if (it && state.scenario.proposal.genericNames !== false && it.name) words.push(it.name); });
    ['margin', 'markup', 'our cost', 'vendor', 'break-even', 'wholesale'].forEach(function (w) { words.push(w); });
    words.forEach(function (w) { if (text.indexOf(String(w).toLowerCase()) >= 0 && hits.indexOf(w) < 0) hits.push(w); });
    return hits;
  }
  function custName() { var s = state.scenario; return s.customerName || (s.account && s.account.name) || 'Customer'; }
  function defaultIntro() { var s = state.scenario; return BRAND.company + ' is pleased to present pricing for electronic monitoring services' + (s.program ? ' for the ' + s.program + ' program' : '') + ' at ' + custName() + '. This proposal covers equipment, 24/7 monitoring and support' + (s.staffing.length ? ', and the ' + BRAND.company + ' staff services described below' : '') + '.'; }
  function propNumber() { var s = state.scenario, tail = (String(s.id || '').replace(/\D/g, '') || '0000').slice(-4); while (tail.length < 4) tail = '0' + tail; return BRAND.proposalPrefix + '-' + today().replace(/-/g, '') + '-' + tail; }
  var UNIT_TEXT = { leaseDaily: 'per active unit per day', spareDaily: 'per spare unit per day, above the included spares', saasMonthly: 'all-in, per active unit per month', purchasePrice: 'per unit, one-time purchase', serviceDaily: 'monitoring service per active unit per day' };
  function rateRows(model, r) {
    var s = state.scenario, rows = [], names = propDeviceNames(), full = !!s.proposal.showSchedule;
    s.lines.forEach(function (l, i) {
      var nm = names[i], any = false, lr = r && r.lines[i];
      var tiers = tierSort(l.priceTiers).filter(function (t) { return num(t.min) > 1; }), bands = bandLabels(tiers);
      E.PRICE_KEYS[model].forEach(function (k) {
        var tiered = tiers.some(function (t) { return !blank(t[k]); });
        if (!tiered || !full) {
          var v = lr && lr.rates ? num(lr.rates[k]) : num(l.price[k]);   /* rate at the proposed volume only */
          if (v > 0) { any = true; rows.push([nm, UNIT_TEXT[k], rate(v)]); }
          return;
        }
        var cur = num(l.price[k]);
        [null].concat(tiers).forEach(function (t, j) { if (t && !blank(t[k])) cur = num(t[k]); if (cur > 0) { any = true; rows.push([nm + ' · ' + bands[j] + ' active units', UNIT_TEXT[k], rate(cur)]); } });
      });
      if (!any) rows.push([nm, UNIT_TEXT[E.PRICE_KEYS[model][0]], 'To be confirmed']);
    });
    return rows;
  }
  function optionBlurb(m) { return { lease: 'A daily rate for each unit in active use, billed monthly in arrears. Units not in use are not billed.', saas: 'A single all-inclusive monthly rate per active unit covering equipment, 24/7 monitoring and support.', purchase: 'A one-time equipment purchase, with monitoring service billed at a daily rate per active unit.' }[m]; }
  function terms(opts) {
    var s = state.scenario, p = s.proposal, t = [];
    t.push('Term of ' + s.termMonths + ' months from the start of service.');
    if (opts.indexOf('lease') >= 0) t.push('Daily lease: billed monthly for each day a unit is active; units not in use are not billed.');
    if (opts.indexOf('saas') >= 0) t.push('Transparent Pricing: billed monthly in advance at one all-in rate for each active unit.');
    var anyTier = s.lines.some(function (l) { return (l.priceTiers || []).length; });
    if (anyTier && s.proposal.showSchedule) t.push('Volume pricing: the average number of active units of each device type in the billing month determines the rate, which applies to all units of that type.');
    else if (anyTier) t.push('Rates are based on the program volume shown in this proposal and may be reviewed if average monthly volume changes materially.');
    if (opts.indexOf('purchase') >= 0) t.push('Purchase: equipment is invoiced on delivery and becomes the customer’s property; monitoring service is billed monthly per active unit.');
    var spareOn = s.lines.some(function (l) { return num(l.price.spareDaily) > 0 || (l.priceTiers || []).some(function (t) { return num(t.spareDaily) > 0; }); });
    if (spareOn && opts.some(function (m) { return m !== 'purchase'; })) t.push('Spare equipment up to ' + one(s.spareBilling.overPct) + '% of active units is included at no charge; spares above that level are billed at the spare rate shown.');
    var lf = s.lines.filter(function (l) { return num(l.price.lostFee) > 0; });
    if (lf.length && opts.some(function (m) { return m !== 'purchase'; })) t.push('Equipment that is lost, stolen or damaged beyond repair is charged at ' + lf.map(function (l) { return money(l.price.lostFee) + ' per ' + propDeviceNames()[s.lines.indexOf(l)] + ' unit'; }).join(', ') + '.');
    if (num(s.minimumMonthly) > 0) t.push('A minimum monthly charge of ' + money(s.minimumMonthly) + ' applies' + (opts.indexOf('purchase') >= 0 && opts.length > 1 ? ' to recurring charges' : '') + '.');
    if (num(s.priceEscalatorPct) > 0) t.push('Rates adjust by ' + one(s.priceEscalatorPct) + '% on each anniversary of the start of service.');
    t.push('Estimated amounts use the volumes shown in this proposal; invoices reflect actual usage.');
    t.push('This pricing is valid until ' + longDate(addDays(today(), num(p.validDays) || 30)) + '.');
    String(p.extraTerms || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) { t.push(x); });
    return t;
  }
  function renderDoc() {
    var s = state.scenario, p = s.proposal, opts = propOptions();
    var res = opts.map(function (m) { return E.price(s, state.catalog, { model: m }); });
    var letters = 'ABC', multi = opts.length > 1, issued = today(), valid = addDays(issued, num(p.validDays) || 30);
    var foot = function (n) { return '<div class="pf"><span>' + esc(BRAND.company + ' · ' + BRAND.docLine + ' · ' + propNumber()) + '</span><span>Confidential pricing prepared for ' + esc(custName()) + ' · page ' + n + '</span></div>'; };
    var lh = '<div class="lh"><div class="wm"><span class="mk"></span><div><b>' + esc(BRAND.company) + '</b><small>' + esc(BRAND.docLine) + '</small></div></div><div class="ref">Proposal ' + esc(propNumber()) + '<br>Issued ' + esc(longDate(issued)) + '<br>Valid until ' + esc(longDate(valid)) + '</div></div>';
    var sec = 0, H2 = function (t) { sec++; return '<h2><span class="n">' + sec + '</span>' + esc(t) + '</h2>'; };
    var blocks = [], h = '', cut = function () { if (h) blocks.push(h); h = ''; };
    h += '<h1>' + esc(BRAND.docLine) + '<br>Pricing Proposal</h1><p class="sub">Prepared for ' + esc(custName()) + (s.program ? ' · ' + esc(s.program) : '') + '</p>';
    h += '<div class="meta"><div><span>Estimated program volume</span><b>' + int(res[0] ? res[0].units.active : 0) + ' active units</b></div><div><span>Proposed term</span><b>' + esc(s.termMonths) + ' months</b></div><div><span>' + (multi ? 'Options' : 'Pricing model') + '</span><b>' + (multi ? opts.length + ' to choose from' : esc(E.MODELS[opts[0]].label)) + '</b></div></div>';
    cut();
    h += H2('Executive summary') + '<p>' + esc(p.intro || defaultIntro()) + '</p>';
    if (multi) {
      h += '<p>' + opts.length + ' pricing structures are offered so that ' + esc(custName()) + ' can choose the one that fits its budget and procurement rules. Each option covers the same equipment and service levels.</p>';
      h += '<div class="optcards">' + res.map(function (r, i) { var lead = r.model === 'purchase' ? money(r.once.rev) + ' equipment' : money(r.monthly.revenue) + '/mo'; return '<div class="oc"><div class="t">Option ' + letters[i] + ' · ' + esc(r.modelLabel) + '</div><div class="v">' + (p.showMonthlyEstimate !== false ? esc(lead) : '&nbsp;') + '</div><div class="d">' + esc(optionBlurb(r.model)) + '</div></div>'; }).join('') + '</div>';
    }
    res.forEach(function (r, i) {
      cut();
      h += H2((multi ? 'Option ' + letters[i] + ': ' : 'Investment: ') + r.modelLabel) + '<p class="note">' + esc(optionBlurb(r.model)) + '</p>';
      h += '<table><thead><tr><th>Equipment / service</th><th>Billing unit</th><th class="r">Rate</th></tr></thead><tbody>' + rateRows(r.model, r).map(function (row) { return '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td><td class="r">' + row[2] + '</td></tr>'; }).join('');
      s.staffing.forEach(function (st) { h += '<tr><td>' + esc(st.name || BRAND.company + ' staff services') + '</td><td>' + (st.priceMethod === 'monthly' ? 'per month' : 'per participant per day') + '</td><td class="r">' + (st.priceMethod === 'monthly' ? money(st.priceMonthly, 2) : rate(st.priceDaily)) + '</td></tr>'; });
      s.fees.filter(function (f) { return f.when === 'monthly'; }).forEach(function (f) { h += '<tr><td>' + esc(f.name) + '</td><td>per month' + (f.qtyBasis === 'perUnit' ? ', per unit' : '') + '</td><td class="r">' + money(f.price, 2) + '</td></tr>'; });
      h += '</tbody></table>';
      if (p.showMonthlyEstimate !== false) {
        cut();
        h += '<table><tbody><tr><td>Estimated monthly investment at ' + int(r.units.active) + ' active units</td><td class="r">' + money(r.monthly.revenue) + '</td></tr>';
        if (r.once.rev > 0) h += '<tr><td>One-time charges' + (r.model === 'purchase' ? ', including equipment purchase' : '') + '</td><td class="r">' + money(r.once.rev) + '</td></tr>';
        h += '<tr class="tot"><td>Estimated total over ' + esc(s.termMonths) + ' months' + (num(s.priceEscalatorPct) > 0 ? ', including annual adjustments' : '') + '</td><td class="r">' + money(r.term.revenue) + '</td></tr></tbody></table>';
      }
    });
    var onceFees = s.fees.filter(function (f) { return f.when !== 'monthly'; });
    if (onceFees.length) { cut(); h += H2('One-time charges') + '<table><thead><tr><th>Item</th><th>Basis</th><th class="r">Rate</th></tr></thead><tbody>' + onceFees.map(function (f) { return '<tr><td>' + esc(f.name) + '</td><td>' + (f.qtyBasis === 'perUnit' ? 'per unit deployed' : (num(f.qty) === 1 ? 'one-time' : 'each, ' + one(f.qty) + ' included')) + '</td><td class="r">' + money(f.price, 2) + '</td></tr>'; }).join('') + '</tbody></table>'; }
    cut();
    h += H2('Terms and conditions') + '<ul class="terms">' + terms(opts).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    h += H2('Acceptance') + '<p>To accept, sign below' + (multi ? ', mark the option selected,' : '') + ' and return this proposal to ' + esc(p.preparedBy || 'your ' + BRAND.company + ' representative') + '.</p>';
    if (multi) h += '<p>' + opts.map(function (m, i) { return '☐ Option ' + letters[i] + ': ' + esc(E.MODELS[m].label); }).join(' &nbsp;&nbsp; ') + '</p>';
    h += '<div class="sign"><div>Authorized signature, ' + esc(custName()) + '</div><div>Date</div><div>Printed name and title</div><div>' + esc(BRAND.company) + (p.preparedBy ? ' · ' + esc(p.preparedBy) : '') + '</div></div>';
    cut();
    paginate(blocks, lh, foot);
    var lk = $('leak');
    if (lk) { var hits = leakCheck(); lk.innerHTML = hits.length ? '<div class="alert"><b>Review before sending.</b> The proposal mentions: ' + hits.map(esc).join(', ') + '. Rename that item, or turn on generic device descriptions.</div>' : '<div class="target"><span>✓ No costs, margins, vendor or model names in the proposal.</span></div>'; }
  }
  function paginate(blocks, lh, foot) {
    var doc = $('doc'), prevZoom = doc.style.zoom; doc.style.zoom = '1'; doc.innerHTML = '';
    var pages = [], cur = null;
    var newPage = function () { var pg = document.createElement('div'); pg.className = 'page ppage'; pg.innerHTML = '<div class="band"></div>' + lh + '<div class="pb"></div>'; doc.appendChild(pg); cur = pg.querySelector('.pb'); pages.push(pg); };
    newPage();
    blocks.forEach(function (b) {
      var w = document.createElement('div'); w.className = 'blk'; w.innerHTML = b; cur.appendChild(w);
      if (cur.scrollHeight > cur.clientHeight + 1 && cur.childNodes.length > 1) { cur.removeChild(w); newPage(); cur.appendChild(w); }
    });
    pages.forEach(function (pg, i) { pg.insertAdjacentHTML('beforeend', foot((i + 1) + ' of ' + pages.length)); });
    doc.style.zoom = prevZoom;
  }
  var pdfLib = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (pdfLib) return pdfLib;
    var tryLoad = function (src) { return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = src; sc.onload = function () { window.html2pdf ? res(window.html2pdf) : rej(new Error('PDF library did not load')); }; sc.onerror = function () { rej(new Error('PDF library did not load')); }; document.head.appendChild(sc); }); };
    pdfLib = tryLoad('html2pdf.bundle.min.js');   /* shipped inside the widget ZIP (external CDNs are blocked by the widget CSP) */
    pdfLib.catch(function () { pdfLib = null; });
    return pdfLib;
  }
  function unexp() { Array.prototype.forEach.call(document.querySelectorAll('.ppage.exp'), function (x) { x.classList.remove('exp'); }); }
  function pdfName() { return (BRAND.company + ' pricing proposal - ' + custName() + ' - ' + today()).replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'; }
  function makePdf() {
    renderDoc();
    var doc = $('doc'), prevZoom = doc.style.zoom; doc.style.zoom = '1'; Array.prototype.forEach.call(doc.querySelectorAll('.ppage'), function (x) { x.classList.add('exp'); });
    return loadPdfLib().then(function (h2p) {
      var pages = Array.prototype.slice.call(doc.querySelectorAll('.page'));
      var opt = { margin: 0, filename: pdfName(), image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }, pagebreak: { mode: [] } };
      var worker = h2p().set(opt).from(pages[0]).toPdf();
      pages.slice(1).forEach(function (pg) { worker = worker.get('pdf').then(function (pdf) { pdf.addPage(); }).from(pg).toContainer().toCanvas().toPdf(); });
      return { w: worker };   /* the worker is thenable, so it must not be returned bare */
    }).then(function (o) { doc.style.zoom = prevZoom; return o; }, function (e) { doc.style.zoom = prevZoom; unexp(); throw e; });
  }
  function downloadPdf(btn) {
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Building PDF…';
    makePdf().then(function (o) { return o.w.save(); }).then(function (x) { unexp(); return x; }, function (e) { unexp(); throw e; }).then(function () { toast('Proposal downloaded.'); })
      .catch(function (e) { toast(e.message + ' · use Print and choose Save as PDF instead.', true, 8000); }).then(function () { btn.disabled = false; btn.textContent = t; });
  }
  function attachPdf(btn) {
    var s = state.scenario;
    if (!PREVIEW && (!s.id || /^local-/.test(s.id))) { toast('Save the scenario first.', true); return; }
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Attaching…';
    makePdf().then(function (o) { return o.w.outputPdf('blob'); }).then(function (x) { unexp(); return x; }, function (e) { unexp(); throw e; })
      .then(function (blob) { return api.attach(s.id, pdfName(), blob); })
      .then(function () { return api.markSent(s.id).catch(function () {}); }).then(function () { toast('PDF attached to the scenario in Zoho and marked Proposed.'); })
      .catch(function (e) { toast(e.message, true, 8000); }).then(function () { btn.disabled = false; btn.textContent = t; });
  }

  /* ---------- scenarios ---------- */
  function renderPicker() {
    var sel = $('scen-pick'), cur = state.scenario && state.scenario.id;
    sel.innerHTML = '<option value="">' + (cur ? 'Open a saved scenario…' : 'Unsaved scenario') + '</option>' + state.saved.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + (x.model ? ' · ' + esc(x.model) : '') + (x.margin != null ? ' · ' + pctf(x.margin, 0) : '') + '</option>'; }).join('');
  }
  function refreshSaved() { return api.listScenarios().then(function (l) { state.saved = l; renderPicker(); }); }
  function openScenario(sc) {
    var b = E.blankScenario();
    Object.keys(b).forEach(function (k) { if (sc[k] == null) sc[k] = b[k]; });
    sc.proposal = Object.assign(E.blankScenario().proposal, sc.proposal || {});
    sc.spareBilling = Object.assign(E.blankScenario().spareBilling, sc.spareBilling || {});
    var oldSpare = sc.spareBilling && sc.spareBilling.enabled !== false && num(sc.spareBilling.dailyRate) > 0 ? num(sc.spareBilling.dailyRate) : 0;
    sc.lines.forEach(function (l) {
      l.price = Object.assign(E.blankLine().price, l.price || {});
      /* older scenarios: Inactive % and $/inactive day are gone; the flat spare rate moves onto each device */
      delete l.inactivePct; delete l.price.inactiveDaily;
      if (!num(l.price.spareDaily) && oldSpare) l.price.spareDaily = oldSpare;
      if (!Array.isArray(l.priceTiers)) l.priceTiers = [];
      if (!l.confirmed) l.confirmed = {};
    });
    delete sc.spareBilling.enabled; delete sc.spareBilling.dailyRate;
    state.openTiers = {};
    state.scenario = sc; setDirty(false); renderAll(); renderPicker();
  }
  function confirmDiscard() { return !state.dirty || window.confirm('Discard unsaved changes to this scenario?'); }
  function firstItemId() { var c = state.catalog.filter(function (x) { return !x.isNew; })[0]; return c ? c.id : null; }
  function newScenario() {
    if (!confirmDiscard()) return;
    var s = E.blankScenario(); s.proposal.preparedBy = state.user || '';
    if (firstItemId()) s.lines.push(E.blankLine(firstItemId()));
    openScenario(s); toast('New scenario. Pick devices and enter prices.');
  }
  function duplicate() { var s = clone(state.scenario); s.id = null; s.pricedAt = null; s.name = (s.name || 'Scenario') + ' (copy)'; state.scenario = s; setDirty(true); renderAll(); renderPicker(); toast('Copy made. Save to keep it.'); }
  function save() {
    var btn = $('btn-save'); btn.disabled = true; btn.textContent = 'Saving…';
    var res = calc(), un = unresolvedLines().length;
    state.scenario.pricedAt = costSnapshot(res);   /* lock what each vendor charges at the time of this run */
    api.saveScenario(state.scenario, res).then(function (out) {
      state.scenario.id = out.id; setDirty(false); renderResults();
      return refreshSaved().then(function () {
        var msg = PREVIEW ? 'Saved in this browser (preview).' : 'Saved to Pricing Scenarios in Zoho.';
        if (out.skipped.length) msg += ' Fields missing in Zoho were skipped: ' + out.skipped.join(', ') + '.';
        if (un) msg += ' ' + un + ' price' + (un === 1 ? '' : 's') + ' still differ from Zoho.';
        toast(msg, !!(out.skipped.length || un), out.skipped.length || un ? 10000 : 4500);
      });
    }).catch(function (e) {
      if (!PREVIEW) api.keepLocalCopy(state.scenario);
      toast('Not saved to Zoho · ' + e.message + (PREVIEW ? '' : ' · a copy was kept in this browser.'), true, 10000);
    }).then(function () { btn.disabled = false; btn.textContent = 'Save scenario'; if (state.tab === 'proposal') renderPropControls(); });
  }

  /* ---------- events ---------- */
  function onBind(ev) {
    var t = ev.target, path = t.getAttribute && t.getAttribute('data-bind'); if (!path) return;
    var kind = t.getAttribute('data-kind'), v;
    if (kind === 'bool') v = !!t.checked;
    else if (kind === 'text') v = t.value;
    else v = t.value === '' ? (/participants$|\.priceTiers\.|\.override$|\.rates\./.test(path) ? null : 0) : Number(t.value);
    setPath(state.scenario, path, v);
    setDirty(true);
    if (t.getAttribute('data-rerender') || /itemId$/.test(path)) { if (ev.type === 'change') { renderBuilder(); renderResults(); } return; }
    var pm = /^lines\.(\d+)\.price\.(\w+)$/.exec(path); if (pm) updLineBadge(Number(pm[1]), pm[2]);
    renderResults();
    if (state.tab === 'proposal' && /^proposal\./.test(path)) renderDoc();
  }
  function onAct(ev) {
    var b = ev.target.closest && ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-act'), s = state.scenario, i = Number(b.getAttribute('data-i'));
    if (a === 'model') s.model = b.getAttribute('data-v');
    else if (a === 'source') s.vendorSource = b.getAttribute('data-v');
    else if (a === 'add-line') { var used = {}; s.lines.forEach(function (l) { used[l.itemId] = 1; }); var saved = state.catalog.filter(function (c) { return !c.isNew; }); var next = saved.filter(function (c) { return !used[c.id]; })[0] || saved[0]; s.lines.push(E.blankLine(next ? next.id : null)); }
    else if (a === 'del-line') { s.lines.splice(i, 1); state.openTiers = {}; }
    else if (a === 'tog-ptier') { state.openTiers['l' + i] = !state.openTiers['l' + i]; renderBuilder(); renderResults(); return; }
    else if (a === 'add-ptier') {
      var ln = s.lines[i]; if (!ln.priceTiers) ln.priceTiers = [];
      var last = tierSort(ln.priceTiers).pop(), start = last ? Math.round(num(last.min)) + 50 : Math.max(2, Math.round(num(ln.units)) + 1);
      ln.priceTiers.push({ min: start }); state.openTiers['l' + i] = true;
    }
    else if (a === 'del-ptier') s.lines[i].priceTiers.splice(Number(b.getAttribute('data-j')), 1);
    else if (a === 'add-staff') s.staffing.push({ name: 'Case management', costMethod: 'hours', hoursPerParticipant: 1, costPerHour: 35, overheadPct: 20, participants: null, priceMethod: 'perDay', priceDaily: 1 });
    else if (a === 'del-staff') s.staffing.splice(i, 1);
    else if (a === 'add-fee') s.fees.push({ name: 'Installation', when: 'once', qtyBasis: 'perUnit', qty: 1, price: 0, cost: 0 });
    else if (a === 'del-fee') s.fees.splice(i, 1);
    else if (a === 'apply-target') { var r = calc(); if (r.solve && r.solve.k > 0) { E.applyMultiplier(s, s.model, r.solve.k); toast('Device prices adjusted to the target margin. Review the adjusted prices.'); } }
    else if (a === 'goto-scenario') { showTab('scenario'); return; }
    else if (a === 'pdf') { downloadPdf(b); return; }
    else if (a === 'print') { renderDoc(); window.print(); return; }
    else if (a === 'attach') { attachPdf(b); return; }
    else return;
    setDirty(true); renderBuilder(); renderResults();
    if (state.tab === 'proposal') renderPropControls();
  }
  var acctT = null;
  function onAcct(ev) {
    var t = ev.target; if (t.id !== 'acct-q') return;
    var box = $('acct-res'), term = t.value.trim();
    clearTimeout(acctT);
    if (term.length < 2) { box.hidden = true; if (!term && state.scenario.account) { state.scenario.account = null; setDirty(true); } return; }
    acctT = setTimeout(function () {
      api.accounts(term).then(function (list) {
        box.hidden = false;
        box.innerHTML = list.length ? list.map(function (a) { return '<button type="button" data-acct="' + esc(a.id) + '">' + esc(a.name) + '</button>'; }).join('') : '<span class="fine" style="padding:8px">No account matches.</span>';
      }).catch(function () { box.hidden = true; });
    }, 250);
  }
  function onAcctPick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-acct]'); if (!b) return;
    state.scenario.account = { id: b.getAttribute('data-acct'), name: b.textContent };
    if (!state.scenario.customerName) state.scenario.customerName = b.textContent;
    setDirty(true); renderBuilder(); renderResults();
  }
  function showTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    ['scenario', 'compare', 'catalog', 'proposal'].forEach(function (k) { $('tab-' + k).hidden = k !== tab; });
    if (tab === 'compare') renderCompare();
    if (tab === 'catalog') renderCatalog();
    if (tab === 'proposal') { renderPropControls(); renderDoc(); }
    store.set('em-pricing-tab', tab);
    resize();
  }
  function renderAll() { renderBuilder(); renderResults(); if (state.tab === 'catalog') renderCatalog(); if (state.tab === 'proposal') { renderPropControls(); renderDoc(); } }
  function wire() {
    ['builder', 'prop-controls'].forEach(function (id) { var el = $(id); el.addEventListener('input', onBind); el.addEventListener('change', onBind); el.addEventListener('click', onAct); });
    $('builder').addEventListener('click', onZoho);
    $('builder').addEventListener('toggle', function (ev) { var d = ev.target; if (d && d.getAttribute && d.getAttribute('data-vd')) state.openTiers['v' + d.getAttribute('data-vd')] = d.open; }, true);
    $('cat-table').addEventListener('click', onZoho);
    $('results').addEventListener('click', onAct);
    $('cmp-table').addEventListener('click', onAct);
    $('builder').addEventListener('input', onAcct);
    $('builder').addEventListener('click', onAcctPick);
    $('prop-controls').addEventListener('change', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-popt'); if (!k) return;
      var cur = propOptions().filter(function (m) { return m !== k; }); if (ev.target.checked) cur.push(k);
      if (!cur.length) { ev.target.checked = true; toast('Keep at least one option.', true); return; }
      var order = Object.keys(E.MODELS); cur.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      state.scenario.proposal.options = cur; setDirty(true); renderPropControls(); renderDoc();
    });
    $('cat-table').addEventListener('input', onCatInput);
    $('cat-table').addEventListener('change', onCatInput);
    $('cat-table').addEventListener('click', onCatAct);
    $('cat-save').addEventListener('click', saveCatalog);
    $('cat-vendors').addEventListener('change', function (ev) { if (ev.target.id !== 'cat-vendor') return; state.vendorFilter = ev.target.value; renderCatalog(); });
    $('cat-refresh').addEventListener('click', function () { refreshFromZoho($('cat-refresh')); });
    $('cat-add').addEventListener('click', function () {
      var vf = state.vendorFilter && state.vendorFilter.charAt(0) !== '_' ? state.vendorFilter : '';
      var vv = state.vendors.filter(function (v) { return v.id === vf; })[0];
      var c = { id: 'new-' + Date.now(), isNew: true, name: '', vendor: vv ? vv.name : '', vendorId: vf, family: '', notes: '', usefulLifeMonths: 36, costTiers: [], zoho: {}, zohoPrice: {}, ack: {} };
      state.catalog.push(c); state.catDirty[c.id] = true; renderCatalog();
      var ins = $('cat-table').querySelectorAll('input[data-cat="name"]'); if (ins.length) ins[ins.length - 1].focus();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('btn-new').addEventListener('click', newScenario);
    $('btn-copy').addEventListener('click', duplicate);
    $('btn-save').addEventListener('click', save);
    $('scen-pick').addEventListener('change', function (ev) {
      var id = ev.target.value; if (!id) return;
      if (!confirmDiscard()) { renderPicker(); return; }
      api.loadScenario(id).then(openScenario).catch(function (e) { toast(e.message, true); renderPicker(); });
    });
    window.addEventListener('beforeunload', function (ev) { if (state.dirty || Object.keys(state.catDirty).length) { ev.preventDefault(); ev.returnValue = ''; } });
  }
  /* internal-only toggle: hides vendor names, costs, margins and the cost tabs (e.g. when screen-sharing) */
  function applyInternal(on) {
    state.internal = !!on; store.set('em-pricing-internal', on ? '1' : '0');
    document.body.classList.toggle('hide-internal', !on);
    var b = $('btn-internal'); if (b) { b.setAttribute('aria-pressed', String(!!on)); b.textContent = on ? 'Internal details: On' : 'Internal details: Off'; }
    if (!on && (state.tab === 'compare' || state.tab === 'catalog')) showTab('scenario');
    if (state.scenario) { renderBuilder(); renderResults(); }
  }
  function start() {
    $('brand-company').textContent = BRAND.company; $('brand-product').textContent = BRAND.product; document.title = BRAND.product;
    wire();
    $('btn-internal').addEventListener('click', function () { applyInternal(!state.internal); });
    applyInternal(store.get('em-pricing-internal') !== '0');
    $('source').innerHTML = PREVIEW ? '<span class="sample">Preview mode</span> · sample data saved in this browser only' : 'Live from Zoho CRM · Products, Vendors and Pricing Scenarios';
    Promise.all([api.catalog(), api.vendors(), api.currentUser(), api.listScenarios(), api.setupReport().catch(function () { return state.setup; })]).then(function (res) {
      state.catalog = res[0]; state.vendors = res[1]; state.user = res[2]; state.saved = res[3]; state.setup = res[4];
      var first = state.saved[0];
      return (first ? api.loadScenario(first.id).catch(function () { return null; }) : Promise.resolve(null)).then(function (sc) {
        if (!sc) { sc = E.blankScenario(); sc.proposal.preparedBy = state.user || ''; if (firstItemId()) sc.lines.push(E.blankLine(firstItemId())); }
        openScenario(sc);
        var t = store.get('em-pricing-tab'); if (t && t !== 'scenario') showTab(t);
        if (!PREVIEW && (state.setup.products.length || state.setup.prices.length || state.setup.scenarios.length || (state.setup.vendors || []).length)) toast('Some Zoho fields the Studio uses are missing. See the list on the Cost catalog tab.', true, 7000);
        if (!PREVIEW && !state.vendors.length) toast('No vendors came back from Zoho. Check that your profile can read the Vendors module.', true, 9000);
      });
    }).catch(function (e) {
      toast('Could not load local data · ' + e.message, true, 10000);
      state.scenario = E.blankScenario(); renderAll();
    });
  }
  /* Zoho requires embeddedApp.init() before any ZOHO.CRM call */
  var started = false;
  function boot() { if (started) return; started = true; start(); }
  function ready() {
    if (PREVIEW) { boot(); return; }
    ZOHO.embeddedApp.on('PageLoad', function () { boot(); });
    Promise.resolve(ZOHO.embeddedApp.init()).then(boot, function (e) { toast('Zoho SDK did not initialise · ' + ((e && e.message) || e), true, 10000); });
    setTimeout(boot, 5000);   /* safety net if neither event arrives */
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
