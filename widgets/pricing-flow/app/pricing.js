/* Pricing flow widget. Uses jpk v1.1.0 and PricingFlowModel; with no Zoho SDK it uses PricingFlowDemo.
   Read-only: COQL reads of Products, Vendor_Rates, Contracts, Rate_Lines, Pricing_Scenarios and EM_Margin. Nothing is written. */
(function () {
  'use strict';
  var M = window.PricingFlowModel, J = window.JPK;
  var Q = {
    products: ['select id, Product_Name, Vendor_Name, Product_Active, Cost_Lease_Daily, Contract_Rate_Device, Contract_Check, Current_Tier from Products where id is not null order by id asc',
      'select id, Product_Name, Vendor_Name, Product_Active, Cost_Lease_Daily from Products where id is not null order by id asc'],
    rates: ['select id, Name, Agency, Device_Type, Active_Rate, Inactive_Rate, Basis, Confirmation, Contract, Source, Modified_Time from Vendor_Rates where id is not null order by id asc',
      'select id, Name, Agency, Device_Type, Active_Rate, Basis, Modified_Time from Vendor_Rates where id is not null order by id asc'],
    contracts: ['select id, Name, Account, Counterparty_Type, Contract_Status, Final_End_Date from Contracts where id is not null order by id asc'],
    lines: ['select id, Parent_Id, Line_Status, Line_Verified, Superseded_By, Rate_Type from Rate_Lines where id is not null order by id asc'],
    scenarios: ['select id, Name, Account, Scenario_Status, Pricing_Model, Active_Units, Est_Monthly_Revenue, Est_Monthly_Cost, Est_Monthly_Margin, Est_Margin_Pct, Target_Margin_Pct, Margin_Tier, Missing_Costs, Valid_Until, Proposal_Sent, Created_Time, Modified_Time from Pricing_Scenarios where id is not null order by id asc',
      'select id, Name, Account, Scenario_Status, Est_Monthly_Revenue, Est_Monthly_Cost, Est_Margin_Pct, Created_Time, Modified_Time from Pricing_Scenarios where id is not null order by id asc'],
    margins: ['select id, Name, Row_Type, Pricing_Scenario, Account, Device_Family, Line_Model, Expected_Revenue, Invoiced_Revenue, Modelled_Cost, Actual_Cost, Modelled_Margin, Billing_Month, Status, Created_Time from EM_Margin where id is not null order by id asc']
  };
  var LABEL = { products: 'Products', rates: 'Vendor Rates', contracts: 'Contracts', lines: 'Rate Lines', scenarios: 'Pricing Scenarios', margins: 'EM Margin' };
  var ENTITY = { scenario: 'Pricing_Scenarios', contract: 'Contracts', product: 'Products', vrate: 'Vendor_Rates', margin: 'EM_Margin', account: 'Accounts' };
  var drawerClick = null;
  var state = { demo: false, data: {}, notes: [], failed: {}, now: Date.now(), limits: { rateAgeDays: 90, draftAgeDays: 30, gapPts: 5 }, model: null, lane: null, nx: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* ---------- data ---------- */
  function readOne(key) {
    var tries = Q[key], i = 0, last;
    function next() {
      if (i >= tries.length) return Promise.reject(last);
      var q = tries[i++];
      return J.crm.coqlAll(q).then(function (r) { if (i > 1) state.notes.push(LABEL[key] + ' was read with fewer fields than usual, so some checks are incomplete.'); return r; }, function (e) { last = e; return next(); });
    }
    return next();
  }
  function load() {
    state.now = Date.now(); state.notes = []; state.failed = {};
    if (state.demo) { state.data = window.PricingFlowDemo.make(state.now); return Promise.resolve(); }
    var d = {};
    return Promise.all(Object.keys(Q).map(function (k) {
      return readOne(k).then(function (r) { d[k] = r; }, function (e) { d[k] = []; state.failed[k] = true; state.notes.push(LABEL[k] + ' could not be read (' + msg(e) + ')' + (k === 'margins' || k === 'scenarios' ? '; your profile may not include prices.' : '.')); });
    })).then(function () { state.data = d; });
  }

  /* ---------- render ---------- */
  function laneButton(l) {
    return '<button type="button" class="lane" data-lane="' + J.esc(l.id) + '" aria-pressed="' + (state.lane === l.id) + '"><span class="ln">' + J.esc(l.label) + (l.hint ? '<small>' + J.esc(l.hint) + '</small>' : '') + '</span><span class="lc' + tone(l.tone) + '">' + l.count + '</span></button>';
  }
  function renderFlow() {
    var m = state.model;
    $('#flow').innerHTML = m.stages.map(function (s) {
      return '<li class="stage" data-n="' + s.n + '"><h2><span class="n">' + s.n + '</span>' + J.esc(s.title) + '</h2><div class="big">' + J.esc(s.big) + '</div><div class="biglab">' + J.esc(s.bigLabel) + '</div>' +
        s.lanes.map(function (id) { return laneButton(m.lanes[id]); }).join('') + '</li>';
    }).join('');
  }
  function renderStrip() {
    var s = state.model.stuck;
    if (s.length) {
      var more = s.length > 1 ? 'Also: ' + s.slice(1, 3).map(function (x) { return x.text; }).join('; ') + (s.length > 3 ? '; and ' + (s.length - 3) + ' more.' : '.') : 'Click it to see the records.';
      state.nx.update({ title: s[0].text.charAt(0).toUpperCase() + s[0].text.slice(1) + '.', sub: more, progress: null, button: { label: 'Show them', onClick: function () { selectLane(s[0].lane, true); } } });
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'Scenarios add up, nothing is priced without costs, and no billing is far from the model.', progress: 100, button: null });
  }
  function renderHeader() {
    var t = state.model.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' + plural(t.scenarios, 'scenario') + ', ' + plural(t.marginRows, 'margin row') + ', ' + plural(t.contracts, 'live customer contract') + '.';
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. This page reads what the Pricing Studio and billing runs saved; it does not redo their maths. Margin rows "add up" when their revenue and cost are within 0.5% (or $1) of the scenario totals. ' +
      'The actual-versus-model gap uses the latest billing month, matches the same account and device family, and compares against the latest Accepted scenario (else Proposed). Actual margin is invoiced revenue (else expected) minus actual cost. ' +
      'A contract is "ready to price" when it has a Verified customer-rate line. Bid scenarios are not part of this page yet.';
  }
  function columns() {
    return [
      { key: 'title', label: 'Record', sortable: true, sortValue: function (i) { return i.title; }, render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">None</span>'; } },
      { key: 'when', label: 'Date', sortable: true, num: true, sortValue: function (i) { return i.ms == null ? Infinity : i.ms; }, render: function (i) { return J.esc(when(i.ms)); } },
      { key: 'age', label: 'Time', sortable: false, align: 'right', render: function (i) { return '<span class="age">' + J.esc(i.ageText) + '</span>'; } },
      { key: 'state', label: 'Status', sortable: true, sortValue: function (i) { return i.state; }, render: function (i) { return J.chip(i.state, i.tone); } }
    ];
  }
  var FT = null;
  function shown(l) { var r = FT ? FT.filter(l.items) : l.items; if (FT) FT.note(r.length, l.items.length); return r; }
  function renderLane() {
    var l = state.model.lanes[state.lane];
    if (!l) { $('#lane-title').textContent = 'Pick a step above'; $('#lane-hint').textContent = ''; $('#lane-table').innerHTML = ''; return; }
    $('#lane-title').textContent = 'Step ' + l.stage + ': ' + l.label + ' (' + l.count + ')';
    $('#lane-hint').textContent = l.hint && l.count ? l.hint : '';
    J.table({ mount: '#lane-table', columns: columns(), rows: shown(l), caption: l.label, onRowClick: detail, empty: { title: 'Nothing here', hint: l.hint || 'No records in this step.' } });
  }
  function selectLane(id, scroll) { state.lane = id; renderFlow(); renderLane(); if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  function recompute() {
    state.model = M.build(state.data, state.now, { rateAgeDays: state.limits.rateAgeDays, draftAgeDays: state.limits.draftAgeDays, gapPts: state.limits.gapPts, marginsAvailable: !state.failed.margins });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 's-draft';
    renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- drawer ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function it(title, meta, extra) { return '<div class="it"><b>' + J.esc(title) + '</b>' + (meta ? '<div class="meta">' + J.esc(meta) + '</div>' : '') + (extra ? '<div>' + extra + '</div>' : '') + '</div>'; }
  function money(v) { return v == null ? '' : M.money(v); }
  function pathHtml(t) {
    var inputs = t.contracts.length ? t.contracts.map(function (c) { return it(c.name, plural(c.verified, 'verified customer rate line') + (c.proposed ? ', ' + c.proposed + ' still proposed' : ''), btn('open-contract', c.id, 'Open contract')); }).join('') : '<div class="none">No live customer contract found for this account.</div>';
    var sc = t.scenarios.length ? t.scenarios.map(function (s) {
      return it(s.name + ' (' + s.status + ')', [s.model, s.units != null ? s.units + ' units' : '', s.rev != null ? money(s.rev) + ' revenue' : '', s.cost != null ? money(s.cost) + ' cost' : '', s.pct != null ? s.pct.toFixed(1) + '% margin' : '', s.target != null ? 'target ' + s.target.toFixed(1) + '%' : '',
        s.validDays != null ? (s.validDays < 0 ? 'expired ' + plural(-s.validDays, 'day') + ' ago' : 'valid ' + plural(s.validDays, 'more day')) : ''].filter(Boolean).join(' · '), btn('open-scenario', s.id, 'Open scenario'));
    }).join('') : '<div class="none">No scenario for this account.</div>';
    var rows = t.scenarios.filter(function (s) { return s.rows.length; }).map(function (s) {
      return it(plural(s.rows.length, 'margin row') + ' for ' + s.name, 'Rows total ' + money(s.rowRev) + ' revenue and ' + money(s.rowCost) + ' cost' + (s.mismatch ? '. The scenario says ' + money(s.rev) + ' and ' + money(s.cost) + ': they do not add up.' : '. They add up to the scenario.'));
    }).join('') || '<div class="none">No margin rows saved.</div>';
    var acts = t.actuals.length ? t.actuals.slice(0, 6).map(function (r) {
      return it((r.family || 'Device') + (r.month ? ', ' + r.month : ''), [r.rev != null ? money(r.rev) + ' revenue' : '', r.actual != null ? money(r.actual) + ' cost' : 'no actual cost', r.status].filter(Boolean).join(' · '));
    }).join('') : '<div class="none">No billing actuals for this account yet.</div>';
    var accepted = t.scenarios.filter(function (s) { return s.status === 'Accepted'; }).length, proposed = t.scenarios.filter(function (s) { return s.status === 'Proposed'; }).length;
    var decision = accepted ? it('Accepted', '') : proposed ? it('Awaiting an answer', '') : t.scenarios.length ? it('No accepted or proposed scenario', t.scenarios.map(function (s) { return s.status; }).join(', ')) : (t.contracts.some(function (c) { return c.verified > 0; }) ? it('Never priced', 'Verified customer rates exist but no scenario is linked.') : '<div class="none">Nothing to decide yet.</div>');
    var acct = t.account && t.account.id ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b><div>' + btn('open-account', t.account.id, 'Open account').trim() + '</div></div>' : '<div class="none">No account linked.</div>';
    return '<ol class="chain"><li><div class="lh">Inputs ready</div>' + inputs + '</li><li><div class="lh">Scenario</div>' + sc + '</li><li><div class="lh">Margin rows</div>' + rows + '</li>' +
      '<li><div class="lh">Actuals</div>' + acts + '</li><li><div class="lh">Decision</div>' + decision + '</li><li><div class="lh">Account</div>' + acct + '</li></ol>';
  }
  function detail(item) {
    var title = item.title;
    if (item.kind === 'product' || item.kind === 'vrate') {
      J.drawer.open({ title: title, html: '<p>' + J.esc(item.sub) + '</p>' + (item.note ? '<p class="note-bad">' + J.esc(item.note) + '</p>' : '') +
        '<div class="drawer-actions"><button type="button" class="btn" data-a="open-' + item.kind + '" data-id="' + J.esc(item.id) + '">Open record</button></div>', onMount: wire }); return;
    }
    if (item.kind === 'margin' && !item.accountKey) { J.drawer.open({ title: title, html: '<p>' + J.esc(item.note || item.sub) + '</p><div class="drawer-actions"><button type="button" class="btn" data-a="open-margin" data-id="' + J.esc(item.id) + '">Open record</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: title, html: pathHtml(M.trace(state.model, item)), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
      var map = { 'open-contract': 'contract', 'open-scenario': 'scenario', 'open-account': 'account', 'open-product': 'product', 'open-vrate': 'vrate', 'open-margin': 'margin' };
      if (map[a]) openRecord(map[a], id);
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function limitInput(sel, key) {
    $(sel).addEventListener('change', function (e) { var v = parseInt(e.target.value, 10); if (isFinite(v) && v >= 1) { state.limits[key] = v; recompute(); } else e.target.value = state.limits[key]; });
  }
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Pricing scenario', entity: 'Pricing_Scenarios' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    limitInput('#lim-rate', 'rateAgeDays'); limitInput('#lim-draft', 'draftAgeDays'); limitInput('#lim-gap', 'gapPts');
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows pricing from its inputs to the decision. It only reads what the Pricing Studio, Contract Review and billing runs have saved. Nothing here changes a record.</p>' +
      '<p><b>1 Inputs ready.</b> Products whose vendor cost matches the contract (or has no cost or no contract rate), vendor rates confirmed by contract or only observed, and customer contracts with verified rate lines, which are the ones that can be priced.</p>' +
      '<p><b>2 Scenarios.</b> Pricing scenarios by status, with checks: no account, no revenue, missing costs, proposals past their valid-until date, drafts nobody has touched.</p>' +
      '<p><b>3 Margin rows.</b> The rows the Studio saves for each scenario. Checks: priced scenarios with no rows, rows that do not add up to the scenario, margin below target, rows whose scenario is missing.</p>' +
      '<p><b>4 Actuals.</b> Billing actuals from the latest billing month, compared with the modelled margin for the same account and device. The gap limit sets how many points of difference counts. This stays empty until billing runs write actuals.</p>' +
      '<p><b>5 Decision.</b> Accepted scenarios, proposals awaiting an answer, accepted ones below target, and contracts with verified rates that have never been priced.</p>' +
      '<p>The three boxes at the top set what counts as an old rate, an old draft, and a margin gap.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load pricing.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
