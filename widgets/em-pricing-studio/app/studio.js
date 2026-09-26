/* =============================================================================
   EM Pricing Studio — UI, CRM data layer and proposal. Pricing maths lives in engine.js.

   CRM storage
   - Vendor costs: custom fields on Products (one record per device). Edited on the Cost catalog tab.
   - Scenarios: the Pricing_Scenarios module. Summary numbers go in fields so views, reports and the
     Billing and Margin agent can read them; the full scenario goes in Scenario_JSON so the Studio can
     reopen it. (Quotes was not used: no profile in this org has access to it.)
   - Proposal PDFs are attached to the scenario record, which is then marked Proposed.
   Preview (?preview=1, or opened outside Zoho) uses sample data and this browser's storage only.
   ============================================================================= */
(function () {
  'use strict';
  var E = window.PricingEngine;
  var ORG = 'org882980956';
  var TAB = 'https://crm.zoho.com/crm/' + ORG + '/tab/';
  var PREVIEW = (typeof ZOHO === 'undefined') || /[?&]preview=1/.test(location.search);

  /* ---------- CRM field map ---------- */
  var CAT = {  /* catalog key -> Products API name */
    family: 'EM_Device_Family', costLeaseDaily: 'Cost_Lease_Daily', costInactiveDaily: 'Cost_Inactive_Daily',
    spareAllowancePct: 'Spare_Allowance_Pct', spareOverageDaily: 'Spare_Overage_Daily', costPurchase: 'Cost_Purchase_Unit',
    costOwnedDaily: 'Cost_Owned_Daily', usefulLifeMonths: 'Useful_Life_Months', replacementCost: 'Replacement_Cost',
    source: 'Cost_Source', updated: 'Cost_Updated'
  };
  var CAT_COLS = [
    { k: 'costLeaseDaily', h: 'Lease $/day', t: 'money', tip: 'What the vendor charges per active (on-leg) leased unit per day' },
    { k: 'costInactiveDaily', h: 'Inactive $/day', t: 'money', tip: 'Vendor charge per assigned-but-inactive leased unit per day' },
    { k: 'spareAllowancePct', h: 'Free spares %', t: 'pct', tip: 'Spares the vendor includes at no charge, as a % of active units' },
    { k: 'spareOverageDaily', h: 'Spare over $/day', t: 'money', tip: 'Vendor charge per spare above the free allowance, per day' },
    { k: 'costPurchase', h: 'Buy $/unit', t: 'money', tip: 'Vendor price to buy one unit outright' },
    { k: 'costOwnedDaily', h: 'Owned svc $/day', t: 'money', tip: 'Vendor monitoring / airtime per active owned unit per day' },
    { k: 'usefulLifeMonths', h: 'Life (mo)', t: 'int', tip: 'Months an owned unit is depreciated over' },
    { k: 'replacementCost', h: 'Replace $', t: 'money', tip: 'What a lost, stolen or damaged unit costs JusticePoint' }
  ];
  var FAMILIES = ['GPS', 'CAM', 'Remote Breath', 'RF', 'Victim / DV', 'Accessory', 'Service', 'Other'];
  var MODEL_PICK = { lease: 'Daily lease', saas: 'SaaS subscription', purchase: 'Purchase' };
  var MODEL_FROM_PICK = { 'Daily lease': 'lease', 'SaaS subscription': 'saas', 'Purchase': 'purchase' };

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var num = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var money = function (v, dp) { dp = dp == null ? 0 : dp; v = num(v); var s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); return (v < 0 ? '−$' : '$') + s; };
  var rate = function (v) { return money(v, 2); };
  var pctf = function (v, dp) { return (num(v)).toFixed(dp == null ? 1 : dp) + '%'; };
  var int = function (v) { return Math.round(num(v)).toLocaleString('en-US'); };
  var one = function (v) { v = num(v); return (Math.round(v * 10) / 10).toLocaleString('en-US'); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var today = function () { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  var addDays = function (iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d; };
  var longDate = function (d) { return (d instanceof Date ? d : new Date(d + 'T12:00:00')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); };
  var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var toastT = null;
  function toast(msg, bad, ms) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 4000); }
  var rowsOf = function (r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; };
  var timeout = function (p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error('CRM did not answer in time')); }, ms || 15000); Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); };
  var writeOk = function (resp) { var row = resp && resp.data && resp.data[0]; if (row && (row.code === 'SUCCESS' || row.status === 'success')) return row.details || {}; var m = (row && (row.message + (row.details && row.details.api_name ? ' (' + row.details.api_name + ')' : ''))) || 'CRM refused the change'; throw new Error(m); };
  var qs = function (s) { return String(s || '').replace(/'/g, "''"); };
  var resize = function () { if (PREVIEW) return; try { ZOHO.CRM.UI.Resize({ height: (document.documentElement.scrollHeight + 10) + 'px' }); } catch (e) {} };

  /* ---------- sample data (preview only) ---------- */
  var SAMPLE_CATALOG = [
    { id: 'p-gps520', name: '1 Piece GPS - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'GPS', costLeaseDaily: 2.55, costInactiveDaily: 0, spareAllowancePct: 35, spareOverageDaily: 1.25, costPurchase: null, costOwnedDaily: null, usefulLifeMonths: 36, replacementCost: null, source: 'EXAMPLE — Allied July 2026 invoice rate and spares.csv; confirm against the addendum', example: true },
    { id: 'p-cam520', name: 'Continuous Alcohol Monitoring (CAM) - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'CAM', costLeaseDaily: 7.60, costInactiveDaily: 0, spareAllowancePct: 0, spareOverageDaily: 0, costPurchase: null, costOwnedDaily: null, usefulLifeMonths: 36, replacementCost: 1250, source: 'EXAMPLE — Addendum 23 (Sheboygan, landline base); Sheboygan-specific', example: true },
    { id: 'p-rb520', name: 'Remote Breath Alcohol - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'Remote Breath', example: true },
    { id: 'p-rf520', name: 'Allied RF - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'RF', example: true },
    { id: 'p-alcotag', name: 'AlcoTag', vendor: 'Buddi', family: 'CAM', example: true },
    { id: 'p-pureone', name: 'PureOne', vendor: 'SuperCom', family: 'GPS', example: true }
  ];
  function sampleScenario() {
    var s = E.blankScenario();
    s.name = 'Example County — Pretrial GPS and CAM (sample)'; s.customerName = 'Example County'; s.program = 'Pretrial Services';
    s.termMonths = 36; s.targetMarginPct = 35; s.priceEscalatorPct = 3;
    var g = E.blankLine('p-gps520'); g.units = 150; g.inactivePct = 8; g.sparePct = 40;
    g.price = { leaseDaily: 4.25, inactiveDaily: 1.00, saasMonthly: 135, purchasePrice: 0, serviceDaily: 0, lostFee: 450 };
    var c = E.blankLine('p-cam520'); c.units = 20; c.inactivePct = 0; c.sparePct = 15;
    c.price = { leaseDaily: 11.50, inactiveDaily: 0, saasMonthly: 350, purchasePrice: 0, serviceDaily: 0, lostFee: 1250 };
    s.lines = [g, c];
    s.staffing = [{ name: 'Monitoring center and case support', costMethod: 'hours', hoursPerParticipant: 0.5, costPerHour: 38, overheadPct: 25, participants: null, priceMethod: 'perDay', priceDaily: 0.75 }];
    s.fees = [{ name: 'Installation', when: 'once', qtyBasis: 'perUnit', qty: 0, price: 25, cost: 8 }, { name: 'Staff training (on site)', when: 'once', qtyBasis: 'fixed', qty: 1, price: 750, cost: 400 }];
    s.spareBilling = { enabled: true, overPct: 35, dailyRate: 1.50 };
    s.lostRatePct = 3; s.lostRecoveryPct = 50; s.minimumMonthly = 15000;
    s.proposal.preparedBy = 'Beau Carrigan';
    return s;
  }
  var SAMPLE_ACCOUNTS = [{ id: 'a1', name: 'Sheboygan County Sheriffs Department' }, { id: 'a2', name: 'Columbia County Treatment Court' }, { id: 'a3', name: 'Iowa County Sheriff' }, { id: 'a4', name: 'Rock County' }];
  var SAMPLE_VENDORS = [{ id: 'v1', name: 'Allied Universal Electronic Monitoring' }, { id: 'v2', name: 'Buddi' }, { id: 'v3', name: 'SCRAM Systems' }, { id: 'v4', name: 'SuperCom' }, { id: 'v5', name: 'Track Group' }];

  /* ---------- data layer ---------- */
  var LOCAL_KEY = 'em-pricing-scenarios-v1';
  var local = {
    list: function () { try { return JSON.parse(store.get(LOCAL_KEY) || '[]') || []; } catch (e) { return []; } },
    put: function (sc) { var all = local.list().filter(function (x) { return x.id !== sc.id; }); all.unshift(sc); store.set(LOCAL_KEY, JSON.stringify(all.slice(0, 40))); }
  };
  var catalogFieldsMissing = false;
  var api = PREVIEW ? {
    catalog: function () { var saved = store.get('em-pricing-catalog-v1'); return Promise.resolve(saved ? JSON.parse(saved) : clone(SAMPLE_CATALOG)); },
    vendors: function () { return Promise.resolve(SAMPLE_VENDORS); },
    saveCatalog: function (rows) { var all = state.catalog.map(function (c) { return c; }); store.set('em-pricing-catalog-v1', JSON.stringify(all)); return Promise.resolve(rows.length); },
    accounts: function (term) { term = term.toLowerCase(); return Promise.resolve(SAMPLE_ACCOUNTS.filter(function (a) { return a.name.toLowerCase().indexOf(term) >= 0; })); },
    listScenarios: function () {
      var l = local.list();
      if (!l.length) { var s = sampleScenario(); s.id = 'local-sample'; local.put(s); l = local.list(); }
      return Promise.resolve(l.map(function (s) { return { id: s.id, name: s.name }; }));
    },
    loadScenario: function (id) { var s = local.list().filter(function (x) { return x.id === id; })[0]; return s ? Promise.resolve(clone(s)) : Promise.reject(new Error('Not found')); },
    saveScenario: function (sc) { if (!sc.id) sc.id = 'local-' + Date.now(); local.put(clone(sc)); return Promise.resolve(sc.id); },
    attach: function () { return Promise.reject(new Error('Preview: nothing is attached. In CRM the PDF is attached to the scenario’s quote.')); }
  } : {
    coql: function (q) { return timeout(ZOHO.CRM.API.coql({ select_query: q })).then(rowsOf); },
    catalog: function () {
      var base = 'id, Product_Name, Vendor_Name, Product_Active';
      var extra = Object.keys(CAT).map(function (k) { return CAT[k]; }).join(', ');
      return api.coql('select ' + base + ', ' + extra + ' from Products where Product_Active = true order by Product_Name asc limit 200')
        .catch(function () { catalogFieldsMissing = true; return api.coql('select ' + base + ' from Products where Product_Active = true order by Product_Name asc limit 200'); })
        .then(function (rows) {
          return rows.map(function (r) {
            var c = { id: String(r.id), name: r.Product_Name, vendorId: r.Vendor_Name && (r.Vendor_Name.id || r.Vendor_Name), vendor: (r.Vendor_Name && r.Vendor_Name.name) || '' };
            Object.keys(CAT).forEach(function (k) { c[k] = r[CAT[k]] == null ? null : r[CAT[k]]; });
            return c;
          });
        });
    },
    vendors: function () { return api.coql('select id, Vendor_Name from Vendors where id is not null order by Vendor_Name asc limit 100').then(function (r) { return r.map(function (v) { return { id: String(v.id), name: v.Vendor_Name }; }); }).catch(function () { return []; }); },
    saveCatalog: function (rows) {
      var chain = Promise.resolve(0);
      rows.forEach(function (c) {
        chain = chain.then(function (done) {
          var data = {}; Object.keys(CAT).forEach(function (k) { if (k !== 'updated') data[CAT[k]] = c[k] === '' ? null : c[k]; });
          data[CAT.updated] = today();
          if (c.isNew) {
            data.Product_Name = c.name; data.Product_Active = true; if (c.vendorId) data.Vendor_Name = { id: c.vendorId };
            return timeout(ZOHO.CRM.API.insertRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function (d) { c.id = String(d.id); c.isNew = false; return done + 1; });
          }
          data.id = c.id;
          return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function () { return done + 1; });
        });
      });
      return chain;
    },
    accounts: function (term) { return api.coql("select id, Account_Name from Accounts where Account_Name like '%" + qs(term) + "%' limit 10").then(function (r) { return r.map(function (a) { return { id: String(a.id), name: a.Account_Name }; }); }); },
    listScenarios: function () {
      return api.coql("select id, Name, Pricing_Model, Est_Margin_Pct, Scenario_Status, Modified_Time from Pricing_Scenarios where Scenario_Status != 'Superseded' order by Modified_Time desc limit 100")
        .then(function (r) { return r.map(function (q) { return { id: String(q.id), name: q.Name, model: q.Pricing_Model, margin: q.Est_Margin_Pct }; }); })
        .catch(function () { return []; });
    },
    loadScenario: function (id) {
      return timeout(ZOHO.CRM.API.getRecord({ Entity: 'Pricing_Scenarios', RecordID: id })).then(function (r) {
        var q = rowsOf(r)[0] || {}; var sc = null;
        try { sc = JSON.parse(q.Scenario_JSON || 'null'); } catch (e) { sc = null; }
        if (!sc || !sc.scenario) throw new Error('This record has no Pricing Studio scenario on it.');
        sc = sc.scenario; sc.id = String(q.id); sc.name = q.Name || sc.name;
        if (q.Account && q.Account.id) sc.account = { id: String(q.Account.id), name: q.Account.name };
        if (q.Opportunity && q.Opportunity.id) sc.deal = { id: String(q.Opportunity.id), name: q.Opportunity.name };
        return sc;
      });
    },
    saveScenario: function (sc, res) {
      var opts = (sc.proposal.options || ['current']).map(function (o) { return o === 'current' ? res.model : o; });
      var data = {
        Name: String(sc.name || 'Pricing scenario').slice(0, 120),
        Valid_Until: addDays(today(), num(sc.proposal.validDays) || 30).toISOString().slice(0, 10),
        Pricing_Model: MODEL_PICK[res.model], Vendor_Source: res.vendorSource === 'buy' ? 'JP-owned fleet' : 'Lease',
        Proposal_Options: opts.map(function (m) { return MODEL_PICK[m]; }).join(', ').slice(0, 120),
        Term_Months: res.term.months, Active_Units: Math.round(res.units.active),
        Est_Monthly_Revenue: round2(res.monthly.revenue), Est_Monthly_Cost: round2(res.monthly.cost), Est_Monthly_Margin: round2(res.monthly.margin),
        Est_Margin_Pct: round2(res.monthly.marginPct), Target_Margin_Pct: round2(sc.targetMarginPct),
        Term_Revenue: round2(res.term.revenue), Term_Margin: round2(res.term.margin),
        Upfront_Cash: round2(res.once.capex + res.once.cost - res.once.rev),
        Rev_Per_Unit_Day: res.perUnitDay ? round2(res.perUnitDay.revenue) : null, Cost_Per_Unit_Day: res.perUnitDay ? round2(res.perUnitDay.cost) : null,
        Margin_Tier: res.tier.label, Missing_Costs: res.missing.length,
        Scenario_JSON: JSON.stringify({ v: 1, saved: new Date().toISOString(), scenario: sc })
      };
      data.Account = sc.account && sc.account.id ? { id: sc.account.id } : null;
      var isNew = !sc.id || /^local-/.test(sc.id);
      if (isNew) data.Scenario_Status = 'Draft';
      var call = isNew
        ? function () { return ZOHO.CRM.API.insertRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); }
        : function () { data.id = sc.id; return ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); };
      return timeout(call()).then(writeOk).then(function (d) { return String(d.id || sc.id); });
    },
    markSent: function (id) { return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: { id: id, Proposal_Sent: today(), Scenario_Status: 'Proposed' } })).then(writeOk); },
    attach: function (id, name, blob) { return timeout(ZOHO.CRM.API.attachFile({ Entity: 'Pricing_Scenarios', RecordID: id, File: { Name: name, Content: blob } }), 30000); }
  };
  var round2 = function (v) { return Math.round(num(v) * 100) / 100; };

  /* ---------- state ---------- */
  var state = { catalog: [], vendors: [], scenario: null, saved: [], dirty: false, tab: 'scenario', catDirty: {}, user: null };
  var itemById = function (id) { return state.catalog.filter(function (c) { return String(c.id) === String(id); })[0]; };
  var calc = function (opts) { return E.price(state.scenario, state.catalog, opts); };
  function setDirty(d) { state.dirty = d; var s = $('save-status'); s.textContent = d ? 'Unsaved changes' : (state.scenario && state.scenario.id ? 'Saved' : ''); s.className = 'status' + (d ? ' dirty' : ''); }

  /* ---------- path binding ---------- */
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); }
  function setPath(obj, path, val) { var ks = path.split('.'), o = obj; for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; }
  function inp(path, type, attrs) {
    attrs = attrs || {};
    var v = getPath(state.scenario, path);
    var cls = type === 'money' ? 'money' : type === 'pct' ? 'pctw' : '';
    var t = type === 'text' ? 'text' : 'number';
    var step = attrs.step || (type === 'money' ? '0.01' : type === 'int' ? '1' : 'any');
    var el = '<input type="' + t + '" data-bind="' + path + '" data-kind="' + type + '"' + (t === 'number' ? ' inputmode="decimal" step="' + step + '" min="0"' : '') + ' value="' + esc(v == null ? '' : v) + '"' + (attrs.ph ? ' placeholder="' + esc(attrs.ph) + '"' : '') + (attrs.label ? ' aria-label="' + esc(attrs.label) + '"' : '') + (attrs.cls ? ' class="' + attrs.cls + '"' : '') + '>';
    return cls ? '<span class="' + cls + '">' + el + '</span>' : el;
  }
  function field(label, html, hint, wide) { return '<label class="f' + (wide ? ' wide' : '') + '"><span>' + esc(label) + (hint ? ' <span class="hint">· ' + esc(hint) + '</span>' : '') + '</span>' + html + '</label>'; }

  /* ---------- builder ---------- */
  function renderBuilder() {
    var s = state.scenario, m = s.model, buy = m === 'purchase' || s.vendorSource === 'buy';
    var h = '';
    /* customer & structure */
    h += '<div class="card"><div class="head"><h2>Customer and structure</h2><span class="meta">' + (s.account ? 'Linked to ' + esc(s.account.name) : 'Not linked to an account yet') + '</span></div><div class="body"><div class="fgrid">';
    h += field('Scenario name', inp('name', 'text'), null, true);
    h += '<label class="f wide"><span>Customer account</span><span style="position:relative;display:block"><input type="search" id="acct-q" placeholder="Search accounts…" value="' + esc(s.account ? s.account.name : '') + '" autocomplete="off"><span id="acct-res" class="acct-res" hidden></span></span></label>';
    h += field('Name on proposal', inp('customerName', 'text', { ph: s.account ? s.account.name : 'e.g. Rock County' }));
    h += field('Program', inp('program', 'text', { ph: 'e.g. Pretrial Services' }));
    h += field('Term', inp('termMonths', 'int'), 'months');
    h += field('Target margin', inp('targetMarginPct', 'pct'));
    h += field('Price escalator', inp('priceEscalatorPct', 'pct'), 'per year');
    h += field('Vendor cost escalator', inp('costEscalatorPct', 'pct'), 'per year');
    h += '</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:12px 24px;margin-top:14px;align-items:center">';
    h += '<div><div class="fine" style="margin:0 0 5px">Customer pricing model</div><span class="seg" role="group" aria-label="Pricing model">' + Object.keys(E.MODELS).map(function (k) { return '<button type="button" data-act="model" data-v="' + k + '" aria-pressed="' + (m === k) + '">' + esc(E.MODELS[k].label) + '</button>'; }).join('') + '</span></div>';
    h += '<div><div class="fine" style="margin:0 0 5px">How JusticePoint gets the devices</div><span class="seg" role="group" aria-label="Device sourcing"><button type="button" data-act="source" data-v="lease" aria-pressed="' + !buy + '"' + (m === 'purchase' ? ' disabled' : '') + '>Lease</button><button type="button" data-act="source" data-v="buy" aria-pressed="' + buy + '"' + (m === 'purchase' ? ' disabled' : '') + '>Purchase</button></span></div>';
    h += '</div><p class="fine">' + modelNote(m, buy) + '</p></div></div>';

    /* devices */
    var cols = priceCols(m);
    h += '<div class="card"><div class="head"><h2>Devices</h2><span style="display:flex;gap:8px;align-items:center"><span class="meta">volumes are average daily units</span><button class="btn sm" type="button" data-act="add-line">+ Add device</button></span></div><div class="body scroll-x">';
    if (!s.lines.length) h += '<p class="empty">No devices yet. Add one to start pricing.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Device</th><th class="r">Active</th><th class="r">Spares %</th>' + cols.map(function (c) { return '<th class="r" title="' + esc(c.tip) + '">' + esc(c.h) + '</th>'; }).join('') + (m !== 'purchase' ? '<th class="r" title="Charged to the customer for each lost, stolen or damaged unit">Lost fee</th>' : '') + '<th class="r">Margin</th><th></th></tr></thead><tbody>';
      s.lines.forEach(function (l, i) {
        var it = itemById(l.itemId);
        h += '<tr data-line="' + i + '"><td style="min-width:210px"><select data-bind="lines.' + i + '.itemId" data-kind="text" aria-label="Device">' + catalogOptions(l.itemId) + '</select><div class="fine" id="line-hint-' + i + '">' + esc(costHint(it, buy)) + '</div></td>';
        h += '<td class="w-sm">' + inp('lines.' + i + '.units', 'num', { label: 'Active units', step: '1' }) + '</td>';
        h += '<td class="w-sm">' + inp('lines.' + i + '.inactivePct', 'pct', { label: 'Inactive %' }) + '</td>';
        h += '<td class="w-sm">' + inp('lines.' + i + '.sparePct', 'pct', { label: 'Spares %' }) + '</td>';
        cols.forEach(function (c) { h += '<td class="w-md">' + inp('lines.' + i + '.price.' + c.k, 'money', { label: c.h }) + '</td>'; });
        if (m !== 'purchase') h += '<td class="w-md">' + inp('lines.' + i + '.price.lostFee', 'money', { label: 'Lost fee' }) + '</td>';
        h += '<td class="r" id="line-m-' + i + '"></td><td><button class="btn ghost sm" type="button" data-act="del-line" data-i="' + i + '" aria-label="Remove device">✕</button></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';

    /* spares, inactive, losses */
    h += '<div class="card"><div class="head"><h2>Spares, losses and minimums</h2></div><div class="body">';
    h += '<label class="check"><input type="checkbox" data-bind="spareBilling.enabled" data-kind="bool"' + (s.spareBilling.enabled ? ' checked' : '') + (m === 'purchase' ? ' disabled' : '') + '> Charge the customer for spares above a set percentage</label>';
    h += '<div class="fgrid" style="margin-top:10px">';
    h += field('Spares included free', inp('spareBilling.overPct', 'pct'), '% of active');
    h += field('Customer spare rate', inp('spareBilling.dailyRate', 'money'), 'per spare per day');
    h += field('Annual loss rate', inp('lostRatePct', 'pct'), '% of fleet per year');
    h += field('Loss fees recovered', inp('lostRecoveryPct', 'pct'), '% actually collected');
    h += field('Minimum monthly billing', inp('minimumMonthly', 'money'));
    h += '</div><p class="fine">Vendor spare charges come from the catalog: spares above each device’s free allowance cost its spare overage rate. Losses do not apply to purchased equipment, which the customer owns.</p></div></div>';

    /* staffing */
    h += '<div class="card"><div class="head"><h2>JusticePoint staffing services</h2><button class="btn sm" type="button" data-act="add-staff">+ Add service</button></div><div class="body scroll-x">';
    if (!s.staffing.length) h += '<p class="empty">No staffed services. Add monitoring-center or case-management work priced per participant or per month.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Service</th><th class="r">Participants</th><th>Cost basis</th><th class="r">Cost inputs</th><th>Price basis</th><th class="r">Price</th><th class="r">Margin</th><th></th></tr></thead><tbody>';
      s.staffing.forEach(function (st, i) {
        var p = 'staffing.' + i + '.';
        h += '<tr><td style="min-width:180px">' + inp(p + 'name', 'text', { label: 'Service name' }) + '</td>';
        h += '<td class="w-sm">' + inp(p + 'participants', 'num', { ph: 'all', label: 'Participants (blank = all active units)', step: '1' }) + '</td>';
        h += '<td><select data-bind="' + p + 'costMethod" data-kind="text" data-rerender="1"><option value="hours"' + (st.costMethod !== 'fte' ? ' selected' : '') + '>Hours per participant</option><option value="fte"' + (st.costMethod === 'fte' ? ' selected' : '') + '>Dedicated FTEs</option></select></td>';
        h += '<td style="min-width:230px"><div style="display:flex;gap:6px">' + (st.costMethod === 'fte'
          ? inp(p + 'fte', 'num', { label: 'FTEs', ph: 'FTEs' }) + inp(p + 'fteMonthlyCost', 'money', { label: 'Loaded cost per FTE per month', ph: 'per FTE / mo' })
          : inp(p + 'hoursPerParticipant', 'num', { label: 'Hours per participant per month', ph: 'hrs / mo' }) + inp(p + 'costPerHour', 'money', { label: 'Cost per hour', ph: 'per hr' }) + inp(p + 'overheadPct', 'pct', { label: 'Overhead %', ph: 'ovhd' })) + '</div></td>';
        h += '<td><select data-bind="' + p + 'priceMethod" data-kind="text" data-rerender="1"><option value="perDay"' + (st.priceMethod !== 'monthly' ? ' selected' : '') + '>Per participant per day</option><option value="monthly"' + (st.priceMethod === 'monthly' ? ' selected' : '') + '>Flat monthly</option></select></td>';
        h += '<td class="w-md">' + (st.priceMethod === 'monthly' ? inp(p + 'priceMonthly', 'money', { label: 'Monthly price' }) : inp(p + 'priceDaily', 'money', { label: 'Price per participant per day' })) + '</td>';
        h += '<td class="r" id="staff-m-' + i + '"></td><td><button class="btn ghost sm" type="button" data-act="del-staff" data-i="' + i + '" aria-label="Remove service">✕</button></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';

    /* fees */
    h += '<div class="card"><div class="head"><h2>One-time and service fees</h2><button class="btn sm" type="button" data-act="add-fee">+ Add fee</button></div><div class="body scroll-x">';
    if (!s.fees.length) h += '<p class="empty">No fees. Add installation, training, shipping or other charges.</p>';
    else {
      h += '<table class="tbl"><thead><tr><th>Fee</th><th>When</th><th>Quantity</th><th class="r">Price each</th><th class="r">Our cost each</th><th class="r">Total</th><th></th></tr></thead><tbody>';
      s.fees.forEach(function (f, i) {
        var p = 'fees.' + i + '.';
        h += '<tr><td style="min-width:180px">' + inp(p + 'name', 'text', { label: 'Fee name' }) + '</td>';
        h += '<td><select data-bind="' + p + 'when" data-kind="text"><option value="once"' + (f.when !== 'monthly' ? ' selected' : '') + '>One-time</option><option value="monthly"' + (f.when === 'monthly' ? ' selected' : '') + '>Monthly</option></select></td>';
        h += '<td style="min-width:190px"><div style="display:flex;gap:6px"><select data-bind="' + p + 'qtyBasis" data-kind="text" data-rerender="1"><option value="fixed"' + (f.qtyBasis !== 'perUnit' ? ' selected' : '') + '>Fixed</option><option value="perUnit"' + (f.qtyBasis === 'perUnit' ? ' selected' : '') + '>Per fleet unit</option></select>' + (f.qtyBasis === 'perUnit' ? '' : inp(p + 'qty', 'num', { label: 'Quantity', step: '1' })) + '</div></td>';
        h += '<td class="w-md">' + inp(p + 'price', 'money', { label: 'Price each' }) + '</td><td class="w-md">' + inp(p + 'cost', 'money', { label: 'Cost each' }) + '</td>';
        h += '<td class="r" id="fee-t-' + i + '"></td><td><button class="btn ghost sm" type="button" data-act="del-fee" data-i="' + i + '" aria-label="Remove fee">✕</button></td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div></div>';
    $('builder').innerHTML = h;
  }
  function modelNote(m, buy) {
    if (m === 'lease') return 'Customer pays per active unit per day (and optionally per inactive unit). ' + (buy ? 'JusticePoint owns the fleet: purchase cost is spread over each device’s life, plus owned monitoring fees.' : 'Vendor lease cost, spare overage and losses come from the catalog.');
    if (m === 'saas') return 'Customer pays a flat monthly subscription per assigned unit (active plus inactive), covering device, monitoring and support. ' + (buy ? 'JusticePoint owns the fleet.' : 'JusticePoint leases from the vendor.');
    return 'Customer buys the equipment up front and pays a monitoring service fee per active unit per day. JusticePoint buys the units from the vendor, so buy cost and owned monitoring fees must be in the catalog.';
  }
  function priceCols(m) {
    if (m === 'lease') return [{ k: 'leaseDaily', h: '$/active day', tip: 'Price per active unit per day' }, { k: 'inactiveDaily', h: '$/inactive day', tip: 'Price per inactive unit per day (0 = not billed)' }];
    if (m === 'saas') return [{ k: 'saasMonthly', h: '$/unit/month', tip: 'Subscription per assigned unit per month' }];
    return [{ k: 'purchasePrice', h: 'Unit price', tip: 'Equipment sale price per unit' }, { k: 'serviceDaily', h: 'Service $/day', tip: 'Monitoring service per active unit per day' }];
  }
  function catalogOptions(sel) {
    var has = false;
    var o = state.catalog.map(function (c) { if (String(c.id) === String(sel)) has = true; return '<option value="' + esc(c.id) + '"' + (String(c.id) === String(sel) ? ' selected' : '') + '>' + esc(c.name) + (c.vendor ? ' — ' + esc(shortVendor(c.vendor)) : '') + '</option>'; }).join('');
    return (has ? '' : '<option value="" selected>Choose a device…</option>') + o;
  }
  var shortVendor = function (v) { return String(v || '').replace(/ Universal Electronic Monitoring/, '').replace(/ Systems$/, ''); };
  function costHint(it, buy) {
    if (!it) return '';
    if (buy) return it.costPurchase ? 'Buy ' + rate(it.costPurchase) + ' · owned svc ' + rate(it.costOwnedDaily || 0) + '/day · ' + (it.usefulLifeMonths || 36) + ' mo life' : 'No vendor buy cost in the catalog';
    if (!num(it.costLeaseDaily)) return 'No vendor lease cost in the catalog';
    return 'Cost ' + rate(it.costLeaseDaily) + '/day' + (num(it.spareAllowancePct) ? ' · spares free to ' + one(it.spareAllowancePct) + '%' + (num(it.spareOverageDaily) ? ', then ' + rate(it.spareOverageDaily) + '/day' : '') : (num(it.spareOverageDaily) ? ' · spares ' + rate(it.spareOverageDaily) + '/day' : ''));
  }

  /* ---------- results ---------- */
  function renderResults() {
    var r = calc(), s = state.scenario;
    /* per-line margins in the builder */
    r.lines.forEach(function (l, i) { var el = $('line-m-' + i); if (el) el.innerHTML = l.revMonthly > 0 || l.costMonthly > 0 ? '<span class="chip ' + E.tierOf(l.marginPct, l.revMonthly).key + '" title="' + esc(money(l.marginMonthly) + ' a month on ' + money(l.revMonthly) + ' revenue') + '">' + (l.revMonthly > 0 ? pctf(l.marginPct, 0) : 'no price') + '</span>' : ''; var hint = $('line-hint-' + i); if (hint) hint.textContent = costHint(itemById(s.lines[i].itemId), r.vendorSource === 'buy'); });
    r.staffing.forEach(function (st, i) { var el = $('staff-m-' + i); if (el) el.innerHTML = '<span class="num">' + money(st.marginMonthly) + '</span><div class="fine" style="margin:0">' + int(st.participants) + ' participants</div>'; });
    r.fees.forEach(function (f, i) { var el = $('fee-t-' + i); if (el) el.innerHTML = '<span class="num">' + money(f.rev) + '</span><div class="fine" style="margin:0">' + (f.when === 'monthly' ? 'a month' : 'once') + ' · qty ' + one(f.qty) + '</div>'; });

    var M = r.monthly, T = r.term, O = r.once;
    var h = '<div class="kpis">';
    h += '<div class="kpi big"><div class="k">Monthly gross margin · ' + esc(r.modelLabel) + '</div><div class="v num' + (M.margin < 0 ? ' neg' : '') + '">' + money(M.margin) + ' <span class="chip ' + r.tier.key + '" style="vertical-align:5px">' + (M.revenue > 0 ? pctf(M.marginPct) + ' · ' : '') + esc(r.tier.label) + '</span></div><div class="c">year one, at ' + int(r.units.active) + ' active units</div></div>';
    h += '<div class="kpi"><div class="k">Monthly revenue</div><div class="v num">' + money(M.revenue) + '</div>' + (M.rev.minimum > 0 ? '<div class="c">incl. ' + money(M.rev.minimum) + ' minimum top-up</div>' : '') + '</div>';
    h += '<div class="kpi"><div class="k">Monthly cost</div><div class="v num">' + money(M.cost) + '</div>' + (M.costs.amort > 0 ? '<div class="c">incl. ' + money(M.costs.amort) + ' fleet depreciation</div>' : '') + '</div>';
    h += '<div class="kpi"><div class="k">Term margin · ' + T.months + ' mo</div><div class="v num' + (T.margin < 0 ? ' neg' : '') + '">' + money(T.margin) + '</div><div class="c">' + pctf(T.marginPct) + ' of ' + money(T.revenue) + '</div></div>';
    h += '<div class="kpi"><div class="k">Cash payback</div><div class="v num">' + (T.paybackMonth == null ? 'Never' : T.paybackMonth === 0 ? 'Day one' : 'Month ' + T.paybackMonth) + '</div><div class="c">' + (O.capex + O.cost > 0 ? money(O.capex + O.cost) + ' out up front' : 'nothing out up front') + '</div></div>';
    h += '</div>';

    if (r.missing.length) h += '<div class="sect"><div class="alert"><b>Missing vendor costs</b> — margin is overstated until these are in the catalog:<ul>' + r.missing.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';

    /* target */
    h += '<div class="sect"><h3>Target ' + pctf(s.targetMarginPct, 0) + ' term margin</h3><div class="target">';
    if (r.solve && r.solve.k != null) {
      var k = r.solve.k, d = (k - 1) * 100;
      if (!r.solve.feasible) h += '<span>Fees, staffing and spare charges already exceed the target on their own; device prices could be zero.</span>';
      else if (Math.abs(d) < 0.5) h += '<span>Current device prices land on target.</span>';
      else h += '<span>' + (d > 0 ? 'Raise' : 'You could lower') + ' this model’s device prices by <b>' + pctf(Math.abs(d)) + '</b> ' + (d > 0 ? 'to reach' : 'and still reach') + ' the target.</span><span><button class="btn sm primary" type="button" data-act="apply-target">Apply ' + (d > 0 ? '+' : '−') + pctf(Math.abs(d)) + ' to device prices</button></span>';
      if (num(s.minimumMonthly) > 0) h += '<span class="fine" style="margin:0">The monthly minimum is held fixed in this calculation.</span>';
    } else h += '<span>' + esc((r.solve && r.solve.reason) || 'Add a device with a price to calculate.') + '</span>';
    h += '</div></div>';

    /* per unit-day */
    if (r.perUnitDay) {
      h += '<div class="sect"><h3>Per active unit per day</h3><dl class="facts"><dt>Revenue</dt><dd>' + rate(r.perUnitDay.revenue) + '</dd><dt>Cost (break-even)</dt><dd>' + rate(r.perUnitDay.cost) + '</dd>' + (r.perUnitDay.target != null ? '<dt>Needed for ' + pctf(s.targetMarginPct, 0) + ' margin</dt><dd>' + rate(r.perUnitDay.target) + '</dd>' : '') + '</dl><p class="fine">All revenue and cost, spread over every active unit-day, so models can be compared on one basis.</p></div>';
    }
    /* breakdown */
    var revParts = [['Devices', M.rev.device], ['Spare charges', M.rev.spares], ['Loss fees', M.rev.lost], ['Staffing', M.rev.staffing], ['Monthly fees', M.rev.fees], ['Minimum top-up', M.rev.minimum]];
    var costParts = [['Vendor devices', M.costs.device], ['Spare overage', M.costs.spares], ['Lost units', M.costs.lost], ['Fleet depreciation', M.costs.amort], ['Staffing', M.costs.staffing], ['Monthly fees', M.costs.fees]];
    var max = Math.max.apply(null, revParts.concat(costParts).map(function (p) { return p[1]; }).concat([1]));
    var bars = function (parts, c) { return parts.filter(function (p) { return p[1] > 0.005; }).map(function (p) { return '<div class="barrow"><span class="l">' + esc(p[0]) + '</span><span class="t"><i' + (c ? ' class="c"' : '') + ' style="width:' + (p[1] / max * 100).toFixed(1) + '%"></i></span><span class="a">' + money(p[1]) + '</span></div>'; }).join('') || '<div class="fine">—</div>'; };
    h += '<div class="sect"><h3>Where the month goes</h3><div class="bars">' + bars(revParts, false) + '</div><div class="bars" style="margin-top:10px">' + bars(costParts, true) + '</div></div>';
    h += '<div class="sect"><h3>Up front and over the term</h3><dl class="facts">';
    h += '<dt>One-time revenue</dt><dd>' + money(O.rev) + '</dd><dt>One-time cost</dt><dd>' + money(O.cost) + '</dd>';
    if (O.capex > 0) h += '<dt>Fleet purchase</dt><dd>' + money(O.capex) + '</dd>';
    h += '<span class="sep"></span><dt>Fleet units</dt><dd>' + one(r.units.fleet) + '</dd><dt>Term revenue</dt><dd>' + money(T.revenue) + '</dd><dt>Term cost</dt><dd>' + money(T.cost) + '</dd>';
    if (T.residual > 0) h += '<dt>Fleet book value at end</dt><dd>' + money(T.residual) + '</dd>';
    h += '</dl></div>';
    $('results').innerHTML = h;
    if (state.tab === 'compare') renderCompare();
    if (state.tab === 'proposal') renderDoc();
    resize();
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
      ['Revenue per active unit-day', function (r) { return r.perUnitDay ? rate(r.perUnitDay.revenue) : '—'; }, null],
      ['Cost per active unit-day', function (r) { return r.perUnitDay ? rate(r.perUnitDay.cost) : '—'; }, null],
      ['Missing vendor costs', function (r) { return r.missing.length ? '<span class="chip thin">' + r.missing.length + '</span>' : 'none'; }, null]
    ];
    var h = '<table class="cmp"><thead><tr><th></th>' + all.map(function (r) { return '<th><span class="sw" style="background:' + MODEL_COLORS[r.model] + '"></span>' + esc(r.modelLabel) + (r.model === s.model ? ' · current' : '') + (noPrice(r) ? '<div class="fine" style="margin:2px 0 0;font-weight:500">no prices entered</div>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) {
      var vals = row[2] ? all.map(function (r) { return noPrice(r) ? -Infinity : row[2](r); }) : null, best = vals ? Math.max.apply(null, vals) : null;
      h += '<tr' + (row[0] === 'Term margin' ? ' class="hl"' : '') + '><td>' + esc(row[0]) + '</td>' + all.map(function (r, i) { return '<td class="' + (vals && vals[i] === best && isFinite(best) && all.length > 1 ? 'best' : '') + '">' + row[1](r) + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody></table><p class="fine" style="padding:0 12px 12px">Bold marks the strongest model on each row. Prices for each model are entered in its own columns on the Scenario tab: switch the model there to edit them. <button class="btn sm" type="button" data-act="goto-scenario">Edit prices</button></p>';
    $('cmp-table').innerHTML = h;
    renderChart(all);
    /* sensitivity */
    var sens = E.sensitivity(s, state.catalog);
    $('sens').innerHTML = '<table class="cmp"><thead><tr><th>Volume</th><th>Active units</th><th>Monthly revenue</th><th>Monthly margin</th><th>Margin %</th></tr></thead><tbody>' + sens.map(function (x) { var t = E.tierOf(x.marginPct, x.revenue); return '<tr' + (x.factor === 1 ? ' class="hl"' : '') + '><td>' + (x.factor === 1 ? 'As modelled' : (x.factor > 1 ? '+' : '−') + Math.round(Math.abs(x.factor - 1) * 100) + '%') + '</td><td>' + int(x.active) + '</td><td>' + money(x.revenue) + '</td><td>' + money(x.margin) + '</td><td>' + (x.revenue > 0 ? pctf(x.marginPct) + ' <span class="chip ' + t.key + '">' + t.label + '</span>' : '—') + '</td></tr>'; }).join('') + '</tbody></table><p class="fine" style="padding:0 12px 12px">Shows how much of the margin depends on volume. Fixed fees, flat staffing and the monthly minimum do not scale, so thin scenarios fall fastest when volume drops.</p>';
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
      var last = r.term.cumulativeCash[T];
      g += '<circle cx="' + x(T).toFixed(1) + '" cy="' + y(last).toFixed(1) + '" r="3.5" fill="' + MODEL_COLORS[r.model] + '"/>';
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

  /* ---------- catalog ---------- */
  function renderCatalog() {
    var note = $('cat-note');
    if (PREVIEW) note.innerHTML = 'What each vendor charges JusticePoint. <b>Preview:</b> the rows marked Example carry figures from project notes so the demo works; they are not confirmed rates. In CRM this table reads and writes the Products records.';
    else if (catalogFieldsMissing) note.innerHTML = '<span class="alert" style="display:block">The cost fields are not on Products yet, so costs cannot be read or saved. Beau: create the fields listed in the Pricing Studio build notes.</span>';
    var h = '<table class="tbl cat"><thead><tr><th>Device</th><th>Vendor</th><th>Family</th>' + CAT_COLS.map(function (c) { return '<th class="r" title="' + esc(c.tip) + '">' + esc(c.h) + '</th>'; }).join('') + '<th>Source / notes</th></tr></thead><tbody>';
    state.catalog.forEach(function (c, i) {
      h += '<tr data-ci="' + i + '"' + (state.catDirty[c.id] ? ' class="changed"' : '') + '><td>' + (c.isNew ? '<input type="text" data-cat="name" value="' + esc(c.name) + '" placeholder="Device name">' : '<b>' + esc(c.name) + '</b>' + (c.example ? ' <span class="chip ex">Example</span>' : '')) + '</td>';
      h += '<td>' + (c.isNew ? '<select data-cat="vendorId"><option value="">Vendor…</option>' + state.vendors.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === c.vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select>' : esc(shortVendor(c.vendor))) + '</td>';
      h += '<td><select data-cat="family"><option value="">—</option>' + FAMILIES.map(function (f) { return '<option' + (f === c.family ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join('') + '</select></td>';
      CAT_COLS.forEach(function (col) { h += '<td class="r"><span class="' + (col.t === 'money' ? 'money' : col.t === 'pct' ? 'pctw' : '') + '"><input type="number" min="0" step="' + (col.t === 'int' ? '1' : '0.01') + '" data-cat="' + col.k + '" value="' + esc(c[col.k] == null ? '' : c[col.k]) + '" aria-label="' + esc(c.name + ' ' + col.h) + '"></span></td>'; });
      h += '<td><input type="text" class="src" data-cat="source" value="' + esc(c.source || '') + '" placeholder="Addendum, invoice, quote…"></td></tr>';
    });
    h += '</tbody></table>';
    if (!state.catalog.length) h = '<p class="empty">No active products. Add a device.</p>';
    $('cat-table').innerHTML = h;
    $('cat-save').disabled = !Object.keys(state.catDirty).length;
    resize();
  }
  function onCatInput(ev) {
    var t = ev.target, key = t.getAttribute('data-cat'); if (!key) return;
    var tr = t.closest('tr'), c = state.catalog[Number(tr.getAttribute('data-ci'))]; if (!c) return;
    var col = CAT_COLS.filter(function (x) { return x.k === key; })[0];
    c[key] = col ? (t.value === '' ? null : Number(t.value)) : t.value;
    if (key === 'vendorId') c.vendor = (state.vendors.filter(function (v) { return v.id === t.value; })[0] || {}).name || '';
    c.example = false;
    state.catDirty[c.id] = true; tr.classList.add('changed'); $('cat-save').disabled = false;
    renderResults();
  }
  function saveCatalog() {
    var rows = state.catalog.filter(function (c) { return state.catDirty[c.id]; });
    var bad = rows.filter(function (c) { return c.isNew && !String(c.name || '').trim(); });
    if (bad.length) { toast('Give the new device a name first.', true); return; }
    $('cat-save').disabled = true; $('cat-save').textContent = 'Saving…';
    var oldIds = rows.map(function (c) { return c.id; });
    api.saveCatalog(rows).then(function (n) {
      /* re-point scenario lines at the ids CRM assigned to new products */
      rows.forEach(function (c, i) { if (oldIds[i] !== c.id) state.scenario.lines.forEach(function (l) { if (String(l.itemId) === String(oldIds[i])) l.itemId = c.id; }); });
      state.catDirty = {}; $('cat-save').textContent = 'Save changes'; renderCatalog(); renderBuilder(); renderResults();
      toast('Saved ' + n + ' device' + (n === 1 ? '' : 's') + (PREVIEW ? ' in this browser (preview).' : ' to Products.'));
    }).catch(function (e) { $('cat-save').disabled = false; $('cat-save').textContent = 'Save changes'; toast('Not saved · ' + e.message, true, 8000); });
  }

  /* ---------- proposal ---------- */
  function propOptions() {
    var p = state.scenario.proposal, list = (p.options || ['current']).map(function (o) { return o === 'current' ? state.scenario.model : o; });
    var seen = {}; return list.filter(function (m) { if (seen[m] || !E.MODELS[m]) return false; seen[m] = 1; return true; });
  }
  function renderPropControls() {
    var s = state.scenario, p = s.proposal, opts = propOptions();
    var h = '<div class="head"><h2>Proposal</h2><span class="meta">customer-facing: no costs or margins</span></div><div class="body stack" style="gap:12px">';
    h += '<div><div class="fine" style="margin:0 0 6px">Pricing options to present</div>' + Object.keys(E.MODELS).map(function (k) { return '<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" data-popt="' + k + '"' + (opts.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(E.MODELS[k].label) + (k === s.model ? ' (current)' : '') + '</label>'; }).join('') + '</div>';
    h += field('Prepared by', inp('proposal.preparedBy', 'text', { ph: state.user || 'Your name' }));
    h += field('Valid for', inp('proposal.validDays', 'int'), 'days');
    h += '<label class="f"><span>Opening paragraph <span class="hint">· blank uses the default</span></span><textarea data-bind="proposal.intro" data-kind="text" rows="4" placeholder="' + esc(defaultIntro()) + '">' + esc(p.intro || '') + '</textarea></label>';
    h += '<label class="check"><input type="checkbox" data-bind="proposal.showMonthlyEstimate" data-kind="bool"' + (p.showMonthlyEstimate !== false ? ' checked' : '') + '> Show estimated monthly investment at the modelled volume</label>';
    h += '<label class="f"><span>Additional terms <span class="hint">· one per line</span></span><textarea data-bind="proposal.extraTerms" data-kind="text" rows="4" placeholder="e.g. Pricing assumes shipping to a single county location.">' + esc(p.extraTerms || '') + '</textarea></label>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn primary" type="button" data-act="pdf">Download PDF</button><button class="btn" type="button" data-act="print">Print</button><button class="btn" type="button" data-act="attach"' + (PREVIEW ? '' : (s.id && !/^local-/.test(s.id) ? '' : ' disabled title="Save the scenario first"')) + '>Attach PDF to the scenario record</button></div>';
    var missing = opts.map(function (m) { return E.price(s, state.catalog, { model: m }); }).filter(function (r) { return r.lines.length && r.monthly.rev.device === 0 && r.once.rev === 0; });
    if (missing.length) h += '<div class="alert">No device prices entered for ' + missing.map(function (r) { return esc(r.modelLabel); }).join(', ') + '. Enter them on the Scenario tab with that model selected.</div>';
    h += '<p class="fine" style="margin:0">The proposal uses the prices on the Scenario tab. Change a price there and it updates here.</p></div>';
    $('prop-controls').innerHTML = h;
  }
  function custName() { var s = state.scenario; return s.customerName || (s.account && s.account.name) || 'Customer'; }
  function defaultIntro() {
    var s = state.scenario;
    return 'JusticePoint is pleased to present pricing for electronic monitoring services' + (s.program ? ' for the ' + s.program + ' program' : '') + ' at ' + custName() + '. This proposal covers equipment, 24/7 monitoring and support' + (s.staffing.length ? ', and the JusticePoint staff services described below' : '') + '.';
  }
  function propNumber() { var s = state.scenario; var base = today().replace(/-/g, ''); var tail = (String(s.id || '').replace(/\D/g, '') || '0000').slice(-4).padStart(4, '0'); return 'JP-' + base + '-' + tail; }
  function unitText(model, key) {
    return { leaseDaily: 'per active unit per day', inactiveDaily: 'per inactive unit per day', saasMonthly: 'per subscribed unit per month', purchasePrice: 'per unit, one-time purchase', serviceDaily: 'monitoring service per active unit per day' }[key];
  }
  function rateRows(model) {
    var s = state.scenario, rows = [];
    s.lines.forEach(function (l) {
      var it = itemById(l.itemId) || {}, nm = it.name || 'Monitoring device';
      var any = false;
      priceCols(model).forEach(function (c) { var v = num(l.price[c.k]); if (v > 0) { any = true; rows.push([nm, unitText(model, c.k), rate(v)]); } });
      if (!any) rows.push([nm, unitText(model, priceCols(model)[0].k), 'To be confirmed']);
    });
    if (model !== 'purchase' && s.spareBilling.enabled && num(s.spareBilling.dailyRate) > 0) rows.push(['Additional spare equipment', 'per spare unit per day above ' + one(s.spareBilling.overPct) + '% of active units', rate(s.spareBilling.dailyRate)]);
    return rows;
  }
  function renderDoc() {
    var s = state.scenario, p = s.proposal, opts = propOptions();
    var res = opts.map(function (m) { return E.price(s, state.catalog, { model: m }); });
    var letters = 'ABC', multi = opts.length > 1;
    var issued = today(), valid = addDays(issued, num(p.validDays) || 30);
    var foot = function (n) { return '<div class="pf"><span>JusticePoint · Electronic Monitoring · ' + esc(propNumber()) + '</span><span>Confidential pricing prepared for ' + esc(custName()) + ' · page ' + n + '</span></div>'; };
    var lh = '<div class="lh"><div class="wm"><span class="mk"></span><div><b>JusticePoint</b><small>Electronic Monitoring</small></div></div><div class="ref">Proposal ' + esc(propNumber()) + '<br>Issued ' + esc(longDate(issued)) + '<br>Valid until ' + esc(longDate(valid)) + '</div></div>';
    var sec = 0, H2 = function (t) { sec++; return '<h2><span class="n">' + sec + '</span>' + esc(t) + '</h2>'; };

    var blocks = [], h = '';
    var cut = function () { if (h) blocks.push(h); h = ''; };
    h += '<h1>Electronic Monitoring<br>Pricing Proposal</h1><p class="sub">Prepared for ' + esc(custName()) + (s.program ? ' · ' + esc(s.program) : '') + '</p>';
    h += '<div class="meta"><div><span>Program volume</span><b>' + int(res[0] ? res[0].units.active : 0) + ' active units</b></div><div><span>Proposed term</span><b>' + esc(s.termMonths) + ' months</b></div><div><span>' + (multi ? 'Options' : 'Pricing model') + '</span><b>' + (multi ? opts.length + ' to choose from' : esc(E.MODELS[opts[0]].label)) + '</b></div></div>';
    cut();
    h += H2('Overview') + '<p>' + esc(p.intro || defaultIntro()) + '</p>';
    if (multi) {
      h += '<p>' + opts.length + ' pricing structures are offered so that ' + esc(custName()) + ' can choose the one that fits its budget and procurement rules. Each option covers the same equipment and service levels.</p>';
      h += '<div class="optcards">' + res.map(function (r, i) {
        var lead = r.model === 'purchase' ? money(r.once.rev) + ' equipment' : money(r.monthly.revenue) + '/mo';
        return '<div class="oc"><div class="t">Option ' + letters[i] + ' · ' + esc(r.modelLabel) + '</div><div class="v">' + (p.showMonthlyEstimate !== false ? esc(lead) : '&nbsp;') + '</div><div class="d">' + esc(optionBlurb(r.model)) + '</div></div>';
      }).join('') + '</div>';
    }
    res.forEach(function (r, i) {
      cut();
      h += H2((multi ? 'Option ' + letters[i] + ': ' : 'Pricing: ') + r.modelLabel);
      h += '<p class="note">' + esc(optionBlurb(r.model)) + '</p>';
      h += '<table><thead><tr><th>Equipment / service</th><th>Billing unit</th><th class="r">Rate</th></tr></thead><tbody>' + rateRows(r.model).map(function (row) { return '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td><td class="r">' + row[2] + '</td></tr>'; }).join('');
      s.staffing.forEach(function (st) { h += '<tr><td>' + esc(st.name || 'JusticePoint staff services') + '</td><td>' + (st.priceMethod === 'monthly' ? 'per month' : 'per participant per day') + '</td><td class="r">' + (st.priceMethod === 'monthly' ? money(st.priceMonthly, 2) : rate(st.priceDaily)) + '</td></tr>'; });
      s.fees.filter(function (f) { return f.when === 'monthly'; }).forEach(function (f) { h += '<tr><td>' + esc(f.name) + '</td><td>per month' + (f.qtyBasis === 'perUnit' ? ', per unit' : '') + '</td><td class="r">' + money(f.price, 2) + '</td></tr>'; });
      h += '</tbody></table>';
      if (p.showMonthlyEstimate !== false) {
        cut();
        h += '<table><tbody><tr><td>Estimated monthly investment at ' + int(r.units.active) + ' active units' + (r.monthly.rev.minimum > 0 ? ' (monthly minimum applies)' : '') + '</td><td class="r">' + money(r.monthly.revenue) + '</td></tr>';
        if (r.once.rev > 0) h += '<tr><td>One-time charges' + (r.model === 'purchase' ? ', including equipment purchase' : '') + '</td><td class="r">' + money(r.once.rev) + '</td></tr>';
        h += '<tr class="tot"><td>Estimated total over ' + esc(s.termMonths) + ' months' + (num(s.priceEscalatorPct) > 0 ? ', including annual adjustments' : '') + '</td><td class="r">' + money(r.term.revenue) + '</td></tr></tbody></table>';
      }
    });
    var onceFees = s.fees.filter(function (f) { return f.when !== 'monthly'; });
    if (onceFees.length) {
      cut();
      h += H2('One-time charges') + '<table><thead><tr><th>Item</th><th>Basis</th><th class="r">Rate</th></tr></thead><tbody>' + onceFees.map(function (f) { return '<tr><td>' + esc(f.name) + '</td><td>' + (f.qtyBasis === 'perUnit' ? 'per unit deployed' : (num(f.qty) === 1 ? 'one-time' : 'each, ' + one(f.qty) + ' included')) + '</td><td class="r">' + money(f.price, 2) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    cut();
    h += H2('Terms') + '<ul class="terms">' + terms(opts).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    h += H2('Acceptance') + '<p>To accept, sign below' + (multi ? ', mark the option selected,' : '') + ' and return this proposal to ' + esc(p.preparedBy || 'your JusticePoint representative') + '.</p>';
    if (multi) h += '<p>' + opts.map(function (m, i) { return '☐ Option ' + letters[i] + ': ' + esc(E.MODELS[m].label); }).join(' &nbsp;&nbsp; ') + '</p>';
    h += '<div class="sign"><div>Authorized signature, ' + esc(custName()) + '</div><div>Date</div><div>Printed name and title</div><div>JusticePoint' + (p.preparedBy ? ' · ' + esc(p.preparedBy) : '') + '</div></div>';
    cut();
    paginate(blocks, lh, foot);
  }
  /* Lay the blocks onto letter pages: a block that would overflow the page body starts a new page. */
  function paginate(blocks, lh, foot) {
    var doc = $('doc'), prevZoom = doc.style.zoom; doc.style.zoom = '1'; doc.innerHTML = '';
    var pages = [], cur = null;
    var newPage = function () { var pg = document.createElement('div'); pg.className = 'page ppage'; pg.innerHTML = '<div class="band"></div>' + lh + '<div class="pb"></div>'; doc.appendChild(pg); cur = pg.querySelector('.pb'); pages.push(pg); };
    newPage();
    blocks.forEach(function (b) {
      if (b === '<!--newpage-->') { if (cur.childNodes.length) newPage(); return; }
      var w = document.createElement('div'); w.className = 'blk'; w.innerHTML = b; cur.appendChild(w);
      if (cur.scrollHeight > cur.clientHeight + 1 && cur.childNodes.length > 1) { cur.removeChild(w); newPage(); cur.appendChild(w); }
    });
    pages.forEach(function (pg, i) { pg.insertAdjacentHTML('beforeend', foot(i + 1).replace('page ' + (i + 1), 'page ' + (i + 1) + ' of ' + pages.length)); });
    doc.style.zoom = prevZoom;
  }
  function optionBlurb(m) {
    return { lease: 'Pay only for equipment in use: a daily rate per active unit, billed monthly in arrears.', saas: 'One predictable monthly subscription per unit, covering equipment, monitoring and support.', purchase: 'Own the equipment outright with a one-time purchase, plus a daily monitoring service fee per active unit.' }[m];
  }
  function terms(opts) {
    var s = state.scenario, p = s.proposal, t = [];
    t.push('Term of ' + s.termMonths + ' months from the start of service.');
    if (opts.indexOf('lease') >= 0) t.push('Daily lease: billed monthly for each day a unit is active' + (s.lines.some(function (l) { return num(l.price.inactiveDaily) > 0; }) ? '; units assigned but inactive are billed at the inactive rate shown.' : '; units not in use are not billed.'));
    if (opts.indexOf('saas') >= 0) t.push('Subscription: billed monthly in advance for each unit assigned to the program, active or inactive.');
    if (opts.indexOf('purchase') >= 0) t.push('Purchase: equipment is invoiced on delivery and becomes the customer’s property; monitoring service is billed monthly per active unit.');
    if (s.spareBilling.enabled && opts.some(function (m) { return m !== 'purchase'; })) t.push('Spare equipment up to ' + one(s.spareBilling.overPct) + '% of active units is included at no charge' + (num(s.spareBilling.dailyRate) > 0 ? '; spares above that level are billed at ' + rate(s.spareBilling.dailyRate) + ' per unit per day.' : '.'));
    var fees = s.lines.filter(function (l) { return num(l.price.lostFee) > 0; });
    if (fees.length && opts.some(function (m) { return m !== 'purchase'; })) t.push('Equipment that is lost, stolen or damaged beyond repair is charged at ' + fees.map(function (l) { return money(l.price.lostFee, 0) + ' per ' + ((itemById(l.itemId) || {}).name || 'unit'); }).join(', ') + '.');
    if (num(s.minimumMonthly) > 0) t.push('A minimum monthly charge of ' + money(s.minimumMonthly) + ' applies' + (opts.indexOf('purchase') >= 0 && opts.length > 1 ? ' to recurring charges' : '') + '.');
    if (num(s.priceEscalatorPct) > 0) t.push('Rates adjust by ' + one(s.priceEscalatorPct) + '% on each anniversary of the start of service.');
    t.push('Estimated amounts use the volumes shown in this proposal; invoices reflect actual usage.');
    t.push('This pricing is valid until ' + longDate(addDays(today(), num(p.validDays) || 30)) + '.');
    String(p.extraTerms || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) { t.push(x); });
    return t;
  }
  var pdfLib = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve(window.html2pdf);
    if (pdfLib) return pdfLib;
    var tryLoad = function (src) { return new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = src; sc.onload = function () { window.html2pdf ? res(window.html2pdf) : rej(new Error('PDF library did not load')); }; sc.onerror = function () { rej(new Error('PDF library did not load')); }; document.head.appendChild(sc); }); };
    pdfLib = tryLoad('html2pdf.bundle.min.js').catch(function () { return tryLoad('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js'); });
    pdfLib.catch(function () { pdfLib = null; });
    return pdfLib;
  }
  function unexp() { Array.prototype.forEach.call(document.querySelectorAll('.ppage.exp'), function (x) { x.classList.remove('exp'); }); }
  function pdfName() { return ('JusticePoint pricing proposal - ' + custName() + ' - ' + today()).replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'; }
  function makePdf() {
    renderDoc();
    var doc = $('doc'), prevZoom = doc.style.zoom; doc.style.zoom = '1'; Array.prototype.forEach.call(doc.querySelectorAll('.ppage'), function (x) { x.classList.add('exp'); });
    return loadPdfLib().then(function (h2p) {
      var pages = Array.prototype.slice.call(doc.querySelectorAll('.page'));
      var opt = { margin: 0, filename: pdfName(), image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }, pagebreak: { mode: [] } };
      /* one canvas per page, so each sheet maps to exactly one PDF page */
      var worker = h2p().set(opt).from(pages[0]).toPdf();
      pages.slice(1).forEach(function (pg) { worker = worker.get('pdf').then(function (pdf) { pdf.addPage(); }).from(pg).toContainer().toCanvas().toPdf(); });
      return { w: worker };  /* the worker is itself thenable, so it must not be returned bare */
    }).then(function (o) { doc.style.zoom = prevZoom; return o; }, function (e) { doc.style.zoom = prevZoom; unexp(); throw e; });
  }
  function downloadPdf(btn) {
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Building PDF…';
    makePdf().then(function (o) { return o.w.save(); }).then(function (x) { unexp(); return x; }, function (e) { unexp(); throw e; }).then(function () { toast('Proposal downloaded.'); }).catch(function (e) { toast(e.message + ' · use Print and choose Save as PDF instead.', true, 8000); }).then(function () { btn.disabled = false; btn.textContent = t; });
  }
  function attachPdf(btn) {
    var s = state.scenario;
    if (!PREVIEW && (!s.id || /^local-/.test(s.id))) { toast('Save the scenario first; the PDF is attached to its record.', true); return; }
    btn.disabled = true; var t = btn.textContent; btn.textContent = 'Attaching…';
    makePdf().then(function (o) { return o.w.outputPdf('blob'); }).then(function (x) { unexp(); return x; }, function (e) { unexp(); throw e; }).then(function (blob) { return api.attach(s.id, pdfName(), blob); })
      .then(function () { return api.markSent(s.id).catch(function () {}); }).then(function () { toast('PDF attached to the scenario in CRM; status set to Proposed.'); })
      .catch(function (e) { toast(e.message, true, 8000); }).then(function () { btn.disabled = false; btn.textContent = t; });
  }

  /* ---------- scenarios ---------- */
  function renderPicker() {
    var sel = $('scen-pick'), cur = state.scenario && state.scenario.id;
    var h = '<option value="">' + (cur ? 'Open a saved scenario…' : 'Unsaved scenario') + '</option>';
    h += state.saved.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + (x.model ? ' · ' + esc(x.model) : '') + (x.margin != null ? ' · ' + pctf(x.margin, 0) : '') + '</option>'; }).join('');
    sel.innerHTML = h;
  }
  function refreshSaved() { return api.listScenarios().then(function (l) { state.saved = l; renderPicker(); }); }
  function openScenario(sc) {
    var b = E.blankScenario();
    Object.keys(b).forEach(function (k) { if (sc[k] == null) sc[k] = b[k]; });
    sc.proposal = Object.assign(E.blankScenario().proposal, sc.proposal || {});
    sc.spareBilling = Object.assign(E.blankScenario().spareBilling, sc.spareBilling || {});
    state.scenario = sc; setDirty(false); renderAll(); renderPicker();
  }
  function confirmDiscard() { return !state.dirty || window.confirm('Discard unsaved changes to this scenario?'); }
  function newScenario() {
    if (!confirmDiscard()) return;
    var s = E.blankScenario(); s.proposal.preparedBy = state.user || '';
    if (state.catalog[0]) s.lines.push(E.blankLine(state.catalog[0].id));
    openScenario(s); toast('New scenario. Pick devices and set prices.');
  }
  function duplicate() {
    var s = clone(state.scenario); s.id = null; s.name = (s.name || 'Scenario') + ' (copy)';
    state.scenario = s; setDirty(true); renderAll(); renderPicker(); toast('Copy made. Save to keep it.');
  }
  function save() {
    var btn = $('btn-save'); btn.disabled = true; btn.textContent = 'Saving…';
    var res = calc();
    api.saveScenario(state.scenario, res).then(function (id) {
      state.scenario.id = id; setDirty(false); return refreshSaved().then(function () { toast(PREVIEW ? 'Saved in this browser (preview).' : 'Saved to Pricing Scenarios. Summary numbers are on the record.'); });
    }).catch(function (e) {
      if (!PREVIEW) { var copy = clone(state.scenario); copy.id = copy.id || ('local-' + Date.now()); local.put(copy); }
      toast('Not saved to CRM · ' + e.message + (PREVIEW ? '' : ' · a copy was kept in this browser.'), true, 10000);
    }).then(function () { btn.disabled = false; btn.textContent = 'Save scenario'; renderPropControls(); });
  }

  /* ---------- events ---------- */
  function onBind(ev) {
    var t = ev.target, path = t.getAttribute && t.getAttribute('data-bind'); if (!path) return;
    var kind = t.getAttribute('data-kind'), v;
    if (kind === 'bool') v = !!t.checked;
    else if (kind === 'text') v = t.value;
    else v = t.value === '' ? (/participants$/.test(path) ? null : 0) : Number(t.value);
    setPath(state.scenario, path, v);
    setDirty(true);
    if (t.getAttribute('data-rerender') || /itemId$/.test(path)) { if (ev.type === 'change') { renderBuilder(); renderResults(); } return; }
    renderResults();
    if (state.tab === 'proposal' && /^proposal\./.test(path)) renderDoc();
  }
  function onAct(ev) {
    var b = ev.target.closest && ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-act'), s = state.scenario, i = Number(b.getAttribute('data-i'));
    if (a === 'model') { s.model = b.getAttribute('data-v'); }
    else if (a === 'source') { s.vendorSource = b.getAttribute('data-v'); }
    else if (a === 'add-line') { var used = {}; s.lines.forEach(function (l) { used[l.itemId] = 1; }); var next = state.catalog.filter(function (c) { return !used[c.id]; })[0] || state.catalog[0]; s.lines.push(E.blankLine(next ? next.id : null)); }
    else if (a === 'del-line') s.lines.splice(i, 1);
    else if (a === 'add-staff') s.staffing.push({ name: 'Case management', costMethod: 'hours', hoursPerParticipant: 1, costPerHour: 35, overheadPct: 20, participants: null, priceMethod: 'perDay', priceDaily: 1 });
    else if (a === 'del-staff') s.staffing.splice(i, 1);
    else if (a === 'add-fee') s.fees.push({ name: 'Installation', when: 'once', qtyBasis: 'perUnit', qty: 1, price: 0, cost: 0 });
    else if (a === 'del-fee') s.fees.splice(i, 1);
    else if (a === 'apply-target') { var r = calc(); if (r.solve && r.solve.k > 0) { E.applyMultiplier(s, s.model, r.solve.k); toast('Device prices adjusted to the target margin. Rounding to cents can leave it a hair off.'); } }
    else if (a === 'goto-scenario') { showTab('scenario'); return; }
    else if (a === 'pdf') { downloadPdf(b); return; }
    else if (a === 'print') { renderDoc(); window.print(); return; }
    else if (a === 'attach') { attachPdf(b); return; }
    else return;
    setDirty(true); renderBuilder(); renderResults();
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
    $('results').addEventListener('click', onAct);
    $('cmp-table').addEventListener('click', onAct);
    $('builder').addEventListener('input', onAcct);
    $('builder').addEventListener('click', onAcctPick);
    $('prop-controls').addEventListener('change', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-popt'); if (!k) return;
      var cur = propOptions(), on = ev.target.checked;
      cur = cur.filter(function (m) { return m !== k; }); if (on) cur.push(k);
      if (!cur.length) { ev.target.checked = true; toast('Keep at least one option.', true); return; }
      var order = Object.keys(E.MODELS); cur.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      state.scenario.proposal.options = cur; setDirty(true); renderPropControls(); renderDoc();
    });
    $('cat-table').addEventListener('input', onCatInput);
    $('cat-table').addEventListener('change', onCatInput);
    $('cat-save').addEventListener('click', saveCatalog);
    $('cat-add').addEventListener('click', function () { var c = { id: 'new-' + Date.now(), isNew: true, name: '', vendor: '', vendorId: '', family: '', usefulLifeMonths: 36 }; state.catalog.push(c); state.catDirty[c.id] = true; renderCatalog(); var ins = $('cat-table').querySelectorAll('input[data-cat="name"]'); if (ins.length) ins[ins.length - 1].focus(); });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
    $('btn-new').addEventListener('click', newScenario);
    $('btn-copy').addEventListener('click', duplicate);
    $('btn-save').addEventListener('click', save);
    $('scen-pick').addEventListener('change', function (ev) {
      var id = ev.target.value; if (!id) return;
      if (!confirmDiscard()) { renderPicker(); return; }
      api.loadScenario(id).then(openScenario).catch(function (e) { toast(e.message, true); renderPicker(); });
    });
    window.addEventListener('beforeunload', function (ev) { if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  }

  function start() {
    wire();
    if (PREVIEW) { $('source').innerHTML = '<span class="sample">Preview with sample data</span> · saves stay in this browser'; }
    var userP = PREVIEW ? Promise.resolve('Beau Carrigan') : timeout(ZOHO.CRM.CONFIG.getCurrentUser(), 6000).then(function (r) { return (r && r.users && r.users[0] && r.users[0].full_name) || ''; }).catch(function () { return ''; });
    Promise.all([api.catalog(), api.vendors(), userP, api.listScenarios()]).then(function (res) {
      state.catalog = res[0]; state.vendors = res[1]; state.user = res[2]; state.saved = res[3];
      var first = state.saved[0];
      var go = first ? api.loadScenario(first.id).catch(function () { return null; }) : Promise.resolve(null);
      return go.then(function (sc) {
        if (!sc) { sc = E.blankScenario(); sc.proposal.preparedBy = state.user || ''; if (state.catalog[0]) sc.lines.push(E.blankLine(state.catalog[0].id)); }
        openScenario(sc);
        var t = store.get('em-pricing-tab'); if (t && t !== 'scenario') showTab(t);
      });
    }).catch(function (e) {
      toast('Could not load from CRM · ' + e.message, true, 10000);
      state.scenario = E.blankScenario(); renderAll();
    });
  }
  if (PREVIEW) start();
  else {
    var booted = false;
    ZOHO.embeddedApp.on('PageLoad', function () { if (!booted) { booted = true; start(); } });
    ZOHO.embeddedApp.init();
    setTimeout(function () { if (!booted) { booted = true; start(); } }, 2500);
  }
})();
