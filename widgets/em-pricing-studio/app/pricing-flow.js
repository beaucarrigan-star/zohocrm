/* EM Pricing Studio: Pricing flow tab (internal view only). Read-only. Uses PricingFlowModel (saved records only; never redoes the Studio's maths).
   Reads Products, Vendor_Rates, Contracts, Rate_Lines, Pricing_Scenarios and EM_Margin by COQL. In preview (no Zoho) it shows fictional demo rows. */
(function () {
  'use strict';
  var M = window.PricingFlowModel;
  var IN_ZOHO = !!(window.ZOHO && window.ZOHO.embeddedApp && window.ZOHO.CRM) && window.self !== window.top;
  var PREVIEW = !IN_ZOHO || /[?&]preview=1\b/.test(location.search);
  var Q = {
    products: ['select id, Product_Name, Vendor_Name, Product_Active, Cost_Lease_Daily, Contract_Rate_Device, Contract_Check, Current_Tier from Products where id is not null',
      'select id, Product_Name, Vendor_Name, Product_Active, Cost_Lease_Daily from Products where id is not null'],
    rates: ['select id, Name, Agency, Device_Type, Active_Rate, Inactive_Rate, Basis, Confirmation, Contract, Source, Modified_Time from Vendor_Rates where id is not null',
      'select id, Name, Agency, Device_Type, Active_Rate, Basis, Modified_Time from Vendor_Rates where id is not null'],
    contracts: ['select id, Name, Account, Counterparty_Type, Contract_Status, Final_End_Date from Contracts where id is not null'],
    lines: ['select id, Parent_Id, Line_Status, Line_Verified, Superseded_By, Rate_Type from Rate_Lines where id is not null'],
    scenarios: ['select id, Name, Account, Scenario_Status, Pricing_Model, Active_Units, Est_Monthly_Revenue, Est_Monthly_Cost, Est_Monthly_Margin, Est_Margin_Pct, Target_Margin_Pct, Margin_Tier, Missing_Costs, Valid_Until, Proposal_Sent, Created_Time, Modified_Time from Pricing_Scenarios where id is not null',
      'select id, Name, Account, Scenario_Status, Est_Monthly_Revenue, Est_Monthly_Cost, Est_Margin_Pct, Created_Time, Modified_Time from Pricing_Scenarios where id is not null'],
    margins: ['select id, Name, Row_Type, Pricing_Scenario, Account, Device_Family, Line_Model, Expected_Revenue, Invoiced_Revenue, Modelled_Cost, Actual_Cost, Modelled_Margin, Billing_Month, Status, Created_Time from EM_Margin where id is not null']
  };
  var LABEL = { products: 'Products', rates: 'Vendor Rates', contracts: 'Contracts', lines: 'Rate Lines', scenarios: 'Pricing Scenarios', margins: 'EM Margin' };
  var ENTITY = { scenario: 'Pricing_Scenarios', contract: 'Contracts', product: 'Products', vrate: 'Vendor_Rates', margin: 'EM_Margin', account: 'Accounts' };
  var S = { data: null, notes: [], failed: {}, now: Date.now(), limits: { rateAgeDays: 90, draftAgeDays: 30, gapPts: 5 }, lane: null, sel: null, busy: false, loaded: false, model: null };
  var root;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var rowsOf = function (r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  var when = function (ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); };

  function coqlAll(q) {
    var all = [];
    function page(off) {
      return Promise.resolve(window.ZOHO.CRM.API.coql({ select_query: q + ' order by id asc limit ' + off + ', 200' })).then(function (r) {
        var rows = rowsOf(r); all = all.concat(rows);
        if (rows.length >= 200 && all.length < 5000) return page(off + 200);
        return all;
      }, function (e) { if (!e || e.status === 204 || e === '' || e.code === 'NO_CONTENT') return all; throw new Error((e && (e.message || e.code)) || 'Query failed'); });
    }
    return page(0);
  }
  function readOne(key) {
    var tries = Q[key], i = 0, last;
    function next() {
      if (i >= tries.length) return Promise.reject(last);
      var q = tries[i++];
      return coqlAll(q).then(function (r) { if (i > 1) S.notes.push(LABEL[key] + ' was read with fewer fields than usual, so some checks are incomplete.'); return r; }, function (e) { last = e; return next(); });
    }
    return next();
  }
  function demo(now) {
    var D = 86400000, iso = function (d) { return new Date(now + d * D).toISOString(); }, day = function (d) { return iso(d).slice(0, 10); };
    return {
      products: [{ id: 'p1', Product_Name: 'GPS 1-piece', Vendor_Name: { id: 'v1', name: 'Allied' }, Product_Active: true, Cost_Lease_Daily: 2.1, Contract_Check: 'Matches contract' }, { id: 'p2', Product_Name: 'CAM wireless', Vendor_Name: { id: 'v2', name: 'SuperCom' }, Product_Active: true, Cost_Lease_Daily: null, Contract_Check: 'No cost entered' }],
      rates: [{ id: 'r1', Agency: 'Example Co Sheriff', Device_Type: 'GPS', Active_Rate: 4.5, Basis: 'Per day', Confirmation: 'Observed', Modified_Time: iso(-120) }, { id: 'r2', Agency: 'Example Co HHS', Device_Type: 'CAM', Active_Rate: 6, Basis: 'Per day', Confirmation: 'Contract-confirmed', Modified_Time: iso(-10) }],
      contracts: [{ id: 'c1', Name: 'Clark County Human Services', Account: { id: 'a1', name: 'Clark County Human Services' }, Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete', Final_End_Date: day(137) }, { id: 'c2', Name: 'Adams Co Treatment Court', Account: { id: 'a2', name: 'Adams Co Treatment Court' }, Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete', Final_End_Date: day(79) }],
      lines: [{ id: 'l1', Parent_Id: { id: 'c1' }, Line_Status: 'Verified', Rate_Type: 'Customer rate' }, { id: 'l2', Parent_Id: { id: 'c2' }, Line_Status: 'Verified', Rate_Type: 'Customer rate' }],
      scenarios: [{ id: 's1', Name: 'Clark GPS base', Account: { id: 'a1', name: 'Clark County Human Services' }, Scenario_Status: 'Proposed', Pricing_Model: 'Daily lease', Active_Units: 40, Est_Monthly_Revenue: 5400, Est_Monthly_Cost: 2600, Est_Margin_Pct: 51.8, Target_Margin_Pct: 45, Valid_Until: day(-3), Modified_Time: iso(-9) },
        { id: 's2', Name: 'Untitled draft', Scenario_Status: 'Draft', Modified_Time: iso(-40) }],
      margins: [{ id: 'm1', Row_Type: 'Scenario model', Pricing_Scenario: { id: 's1', name: 'Clark GPS base' }, Account: { id: 'a1', name: 'Clark County Human Services' }, Device_Family: 'GPS', Expected_Revenue: 4000, Modelled_Cost: 2000, Modelled_Margin: 2000, Created_Time: iso(-9) }]
    };
  }
  function load() {
    S.now = Date.now(); S.notes = []; S.failed = {}; S.busy = true;
    if (PREVIEW) { S.data = demo(S.now); S.busy = false; S.loaded = true; return Promise.resolve(); }
    var d = {};
    return Promise.all(Object.keys(Q).map(function (k) {
      return readOne(k).then(function (r) { d[k] = r; }, function (e) { d[k] = []; S.failed[k] = true; S.notes.push(LABEL[k] + ' could not be read (' + ((e && e.message) || e) + ')' + (k === 'margins' || k === 'scenarios' ? '; your profile may not include prices.' : '.')); });
    })).then(function () { S.data = d; S.busy = false; S.loaded = true; });
  }
  function recompute() {
    S.model = M.build(S.data, S.now, { rateAgeDays: S.limits.rateAgeDays, draftAgeDays: S.limits.draftAgeDays, gapPts: S.limits.gapPts, marginsAvailable: !S.failed.margins });
    if (!S.model.lanes[S.lane]) S.lane = null;
    if (!S.lane) S.lane = S.model.stuck.length ? S.model.stuck[0].lane : 's-draft';
  }
  function openRecord(kind, id) {
    if (PREVIEW || !id) { toast('Preview: would open the record'); return; }
    window.ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function toast(m) { var t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.className = 'toast'; t.hidden = false; setTimeout(function () { t.hidden = true; }, 3000); }
  function money(v) { return v == null ? '' : M.money(v); }

  function pathHtml(t) {
    var li = function (title, meta, btn) { return '<div class="pf-it"><b>' + esc(title) + '</b>' + (meta ? '<div class="pf-meta">' + esc(meta) + '</div>' : '') + (btn || '') + '</div>'; };
    var ob = function (a, id, label) { return '<button type="button" class="btn" data-a="' + a + '" data-id="' + esc(id) + '">' + label + '</button>'; };
    var none = function (s) { return '<div class="pf-none">' + esc(s) + '</div>'; };
    var inputs = t.contracts.length ? t.contracts.map(function (c) { return li(c.name, plural(c.verified, 'verified customer rate line') + (c.proposed ? ', ' + c.proposed + ' still proposed' : ''), ob('contract', c.id, 'Open contract')); }).join('') : none('No live customer contract found for this account.');
    var sc = t.scenarios.length ? t.scenarios.map(function (s) { return li(s.name + ' (' + s.status + ')', [s.model, s.units != null ? s.units + ' units' : '', s.rev != null ? money(s.rev) + ' revenue' : '', s.cost != null ? money(s.cost) + ' cost' : '', s.pct != null ? s.pct.toFixed(1) + '% margin' : '', s.target != null ? 'target ' + s.target.toFixed(1) + '%' : '', s.validDays != null ? (s.validDays < 0 ? 'expired ' + plural(-s.validDays, 'day') + ' ago' : 'valid ' + plural(s.validDays, 'more day')) : ''].filter(Boolean).join(' · '), ob('scenario', s.id, 'Open scenario')); }).join('') : none('No scenario for this account.');
    var rows = t.scenarios.filter(function (s) { return s.rows.length; }).map(function (s) { return li(plural(s.rows.length, 'margin row') + ' for ' + s.name, 'Rows total ' + money(s.rowRev) + ' revenue and ' + money(s.rowCost) + ' cost' + (s.mismatch ? '. The scenario says ' + money(s.rev) + ' and ' + money(s.cost) + ': they do not add up.' : '. They add up to the scenario.')); }).join('') || none('No margin rows saved.');
    var acts = t.actuals.length ? t.actuals.slice(0, 6).map(function (r) { return li((r.family || 'Device') + (r.month ? ', ' + r.month : ''), [r.rev != null ? money(r.rev) + ' revenue' : '', r.actual != null ? money(r.actual) + ' cost' : 'no actual cost', r.status].filter(Boolean).join(' · ')); }).join('') : none('No billing actuals for this account yet.');
    var acc = t.scenarios.filter(function (s) { return s.status === 'Accepted'; }).length, prop = t.scenarios.filter(function (s) { return s.status === 'Proposed'; }).length;
    var dec = acc ? li('Accepted') : prop ? li('Awaiting an answer') : t.scenarios.length ? li('No accepted or proposed scenario', t.scenarios.map(function (s) { return s.status; }).join(', ')) : (t.contracts.some(function (c) { return c.verified > 0; }) ? li('Never priced', 'Verified customer rates exist but no scenario is linked.') : none('Nothing to decide yet.'));
    var ac = t.account && t.account.id ? li(t.account.name || 'Account', '', ob('account', t.account.id, 'Open account')) : none('No account linked.');
    return '<ol class="pf-chain"><li><div class="pf-lh">Inputs ready</div>' + inputs + '</li><li><div class="pf-lh">Scenario</div>' + sc + '</li><li><div class="pf-lh">Margin rows</div>' + rows + '</li><li><div class="pf-lh">Actuals</div>' + acts + '</li><li><div class="pf-lh">Decision</div>' + dec + '</li><li><div class="pf-lh">Account</div>' + ac + '</li></ol>';
  }
  function detailHtml(it) {
    var head = '<div class="head"><h2>' + esc(it.title) + '</h2><button type="button" class="btn ghost-b" data-a="close">Close</button></div><div class="body">';
    if (it.kind === 'product' || it.kind === 'vrate' || (it.kind === 'margin' && !it.accountKey))
      return head + '<p>' + esc(it.sub) + '</p>' + (it.note ? '<p class="pf-note">' + esc(it.note) + '</p>' : '') + '<button type="button" class="btn primary" data-a="' + it.kind + '" data-id="' + esc(it.id) + '">Open record</button></div>';
    return head + pathHtml(M.trace(S.model, it)) + '</div>';
  }

  function draw() {
    if (!root) return;
    var h = '<div class="pf-wrap">';
    if (!S.loaded) { root.innerHTML = '<div class="card"><div class="body">Loading pricing flow…</div></div>'; return; }
    var m = S.model, lane = m.lanes[S.lane], t = m.totals;
    var s0 = m.stuck[0];
    h += '<div class="card pf-next"><div class="body"><div><b>' + (s0 ? esc(s0.text.charAt(0).toUpperCase() + s0.text.slice(1)) + '.' : 'Nothing is stuck.') + '</b><div class="pf-meta">' +
      (s0 ? (m.stuck.length > 1 ? 'Also: ' + esc(m.stuck.slice(1, 3).map(function (x) { return x.text; }).join('; ')) + (m.stuck.length > 3 ? '; and ' + (m.stuck.length - 3) + ' more.' : '.') : 'Click it to see the records.') : 'Scenarios add up, nothing is priced without costs, and no billing is far from the model.') + '</div></div>' +
      '<span style="display:flex;gap:8px">' + (s0 ? '<button type="button" class="btn primary" data-lane="' + s0.lane + '">Show them</button>' : '') + '<button type="button" class="btn" id="pf-rf">Refresh</button></span></div></div>';
    h += '<div class="card pf-lims"><div class="body">' + [['pf-lim-rate', 'rateAgeDays', 'Old vendor rate (days)'], ['pf-lim-draft', 'draftAgeDays', 'Old draft (days)'], ['pf-lim-gap', 'gapPts', 'Margin gap (points)']].map(function (x) {
      return '<label class="pf-lim">' + x[2] + ' <input type="number" min="1" id="' + x[0] + '" value="' + S.limits[x[1]] + '" data-k="' + x[1] + '"></label>'; }).join('') + '<span class="pf-meta">Read ' + esc(new Date(S.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + '. ' + plural(t.scenarios, 'scenario') + ', ' + plural(t.marginRows, 'margin row') + ', ' + plural(t.contracts, 'live customer contract') + '.</span></div></div>';
    h += '<ol class="pf-flow">' + m.stages.map(function (s) {
      return '<li class="card pf-stage"><div class="head"><h2><span class="pf-n">' + s.n + '</span>' + esc(s.title) + '</h2></div><div class="body"><div class="pf-big">' + esc(s.big) + '</div><div class="pf-meta">' + esc(s.bigLabel) + '</div>' +
        s.lanes.map(function (id) { var l = m.lanes[id]; return '<button type="button" class="pf-lane" data-lane="' + id + '" aria-pressed="' + (S.lane === id) + '"><span>' + esc(l.label) + (l.hint ? '<small>' + esc(l.hint) + '</small>' : '') + '</span><span class="pf-c ' + (l.tone || '') + '">' + l.count + '</span></button>'; }).join('') + '</div></li>'; }).join('') + '</ol>';
    h += '<div class="card"><div class="head"><h2>' + (lane ? 'Step ' + lane.stage + ': ' + esc(lane.label) + ' (' + lane.count + ')' : 'Pick a step above') + '</h2><span class="meta">' + (lane && lane.hint && lane.count ? esc(lane.hint) : '') + '</span></div>';
    if (lane && lane.items.length) {
      h += '<div class="scroll-x"><table class="pf-tbl"><thead><tr><th>Record</th><th>Account</th><th>Date</th><th>Time</th><th>Status</th></tr></thead><tbody>' +
        lane.items.slice(0, 300).map(function (i, n) { return '<tr data-i="' + n + '" tabindex="0"><td><b>' + esc(i.title) + '</b><div class="pf-meta">' + esc(i.sub) + '</div>' + (i.note ? '<div class="pf-note">' + esc(i.note) + '</div>' : '') + '</td><td>' + (i.accountName ? esc(i.accountName) : '<span class="pf-meta">None</span>') + '</td><td>' + esc(when(i.ms)) + '</td><td>' + esc(i.ageText) + '</td><td><span class="pf-chip ' + esc(i.tone) + '">' + esc(i.state) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    } else h += '<div class="body"><b>Nothing here</b><div class="pf-meta">' + esc((lane && lane.hint) || 'No records in this step.') + '</div></div>';
    h += '</div>';
    var cur = S.sel != null && lane && lane.items[S.sel];
    if (cur) h += '<div class="card" id="pf-det">' + detailHtml(cur) + '</div>';
    h += '<p class="fine" style="margin:4px 0 0">' + esc((S.notes.length ? S.notes.join(' ') + ' ' : '') + 'Read-only. This tab reads what the Studio and billing runs saved; it does not redo their maths. Margin rows add up when revenue and cost are within 0.5% (or $1) of the scenario totals. The actual-versus-model gap uses the latest billing month, the same account and device family, and the latest Accepted scenario (else Proposed). A contract is ready to price when it has a Verified customer-rate line.') + '</p></div>';
    root.innerHTML = h;
  }
  function onClick(e) {
    var t;
    if ((t = e.target.closest('[data-lane]'))) { S.lane = t.getAttribute('data-lane'); S.sel = null; draw(); var c = root.querySelector('.pf-tbl'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' }); return; }
    if (e.target.closest('#pf-rf')) { run(true); return; }
    if ((t = e.target.closest('button[data-a]'))) { var a = t.getAttribute('data-a'); if (a === 'close') { S.sel = null; draw(); } else openRecord(a, t.getAttribute('data-id')); return; }
    if ((t = e.target.closest('tr[data-i]'))) { S.sel = +t.getAttribute('data-i'); draw(); var d = document.getElementById('pf-det'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' }); }
  }
  function onChange(e) {
    var i = e.target.closest && e.target.closest('input[data-k]'); if (!i) return;
    var v = parseInt(i.value, 10); if (isFinite(v) && v >= 1) { S.limits[i.getAttribute('data-k')] = v; recompute(); draw(); } else i.value = S.limits[i.getAttribute('data-k')];
  }
  function run(manual) {
    return load().then(function () { recompute(); draw(); if (manual) toast('Refreshed'); }, function (e) { S.loaded = true; S.busy = false; root.innerHTML = '<div class="card"><div class="body">Could not read pricing: ' + esc((e && e.message) || e) + '</div></div>'; });
  }
  window.PricingFlowView = {
    show: function () {
      if (!root) { root = document.getElementById('flow-root'); root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var tr = e.target.closest && e.target.closest('tr[data-i]'); if (tr) onClick(e); } }); }
      if (!S.loaded && !S.busy) { draw(); run(false); } else if (S.loaded) draw();
    }
  };
})();
