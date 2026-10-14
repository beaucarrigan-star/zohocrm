/* processes-view.js: Contract, Billing (Flow, Findings, Months) and Solicitations views for the Processes widget.
   Read-only status views. Rows open the native CRM record. Billing months reuse the Records engine (RecModules.billing). */
(function () {
  'use strict';
  var BF = window.BillingFlowModel, FM = window.FindingsModel, X;
  var PAGE = 200, CAP = 5000;
  function esc(s) { return X.esc(s); }
  function $(id) { return document.getElementById(id); }

  /* ---------- generic paged read with fallbacks ---------- */
  function pageAll(base, order) {
    var all = [];
    function page(off) {
      return X.coql(base + ' order by ' + order + ' limit ' + PAGE + ' offset ' + off).then(function (res) {
        all = all.concat(res.rows);
        if (res.rows.length >= PAGE && all.length < CAP) return page(off + PAGE);
        return all;
      });
    }
    return page(0);
  }
  function firstOk(tries, order) {
    var i = 0, lastErr;
    function next() {
      if (i >= tries.length) return Promise.reject(lastErr);
      var t = tries[i++];
      return pageAll(t.q, order).then(function (rows) { return { rows: rows, fields: t.fields }; }, function (e) { lastErr = e; return next(); });
    }
    return next();
  }
  var PSEL = 'id, Name, Period, Period_Status, Upload_Vendor, Invoiced, Verified, On_Hold, Recommended_Pay, Credits_To_Confirm, Latent_Exposure, Overbilled, Unverified, Findings_Total, Findings_Open, Needs_Decision';
  var FSEL = 'id, Period, Billing_Period, Vendor, Check_ID, Category, Subject, Severity, Dollars, Money_Type, Status, Is_Open';
  var B = { loaded: false, busy: false, err: '', ferr: '', periods: [], findings: [], fields: {} };
  function loadBilling(force) {
    if (B.busy || (B.loaded && !force)) return Promise.resolve();
    B.busy = true; B.err = ''; B.ferr = '';
    if (!X.isLive()) { var d = window.PROC_DEMO; B.periods = d.periods; B.findings = d.findings; B.fields = {}; B.loaded = true; B.busy = false; return Promise.resolve(); }
    var p = firstOk([
      { q: 'select ' + PSEL + ', Last_Run_Status, Last_Run_At, Reconciled_On, Accounting_Report_At from Billing_Periods where id is not null', fields: {} },
      { q: 'select ' + PSEL + ', Last_Run_At from Billing_Periods where id is not null', fields: { report: false } },
      { q: 'select ' + PSEL + ' from Billing_Periods where id is not null', fields: { report: false, runAt: false } }
    ], 'id asc').then(function (r) { B.periods = r.rows; B.fields = r.fields; }, function (e) { B.err = e.message || 'Could not read Billing Periods'; });
    var f = firstOk([
      { q: 'select ' + FSEL + ', In_Latest_Run, Decision_Notes from Billing_Findings where id is not null', fields: {} },
      { q: 'select ' + FSEL + ', In_Latest_Run from Billing_Findings where id is not null', fields: { notes: false } },
      { q: 'select ' + FSEL + ' from Billing_Findings where id is not null', fields: { notes: false, inLatest: false } }
    ], 'id asc').then(function (r) { B.findings = r.rows; Object.keys(r.fields).forEach(function (k) { B.fields[k] = r.fields[k]; }); },
      function (e) { B.ferr = e.message || 'Could not read Billing Findings'; B.fields.findings = false; });
    return Promise.all([p, f]).then(function () { B.loaded = true; B.busy = false; }, function () { B.busy = false; });
  }
  function errBox() {
    return (B.err ? '<div class="err">Could not read Billing Periods: ' + esc(B.err) + '. Billing is Administrator-only today; widen the profile to view it.</div>' : '') +
      (B.ferr ? '<div class="err">Could not read Billing Findings: ' + esc(B.ferr) + '</div>' : '');
  }
  function money(v) { return v == null || v === '' ? '' : BF.money(+v); }
  function lanePills(lanes, cur, attr) {
    return '<div class="bar" role="group" aria-label="Lane">' + lanes.map(function (l) {
      return '<button type="button" class="pillbtn" data-' + attr + '="' + esc(l.id) + '" aria-pressed="' + (cur === l.id) + '">' + esc(l.label) + ' (' + l.count + ')</button>'; }).join('') + '</div>';
  }

  /* ---------- Billing flow ---------- */
  var FS = { scope: 'all', lane: 'm-review', sel: null };
  function flowDraw(root) {
    var h, m = BF.build({ periods: B.periods, findings: B.findings, fields: B.fields }, Date.now(), { scope: FS.scope });
    var lane = m.lanes[FS.lane] || m.lanes['m-open'];
    var stage = m.stages.filter(function (s) { return s.lanes.indexOf(lane.id) >= 0; })[0] || m.stages[0];
    h = '<div class="wrap">' + X.head('Processes', 'Billing flow', 'Month by month: upload, findings, decisions, money, close-out', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote() + errBox();
    if (!B.loaded) h += '<div class="empty">Loading billing…</div>';
    else {
      h += '<div class="bar" role="group" aria-label="Scope">' + BF.SCOPES.map(function (s) { return '<button type="button" class="pillbtn" data-sc="' + s.id + '" aria-pressed="' + (FS.scope === s.id) + '">' + esc(s.label) + '</button>'; }).join('') + '</div>';
      h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + (m.stuck.length ? '<b>Needs attention</b><br>' + m.stuck.map(function (s) { return '<a href="#" class="stk" data-ln="' + s.lane + '" style="color:var(--' + (s.tone === 'bad' ? 'bad' : 'warn') + ')">' + esc(s.text) + '</a>'; }).join('<br>') : 'Nothing stuck. Every billing month is on track.') + '</div>';
      h += '<div class="kpis">' + m.stages.map(function (s) { return '<button type="button" class="kpi' + (s === stage ? ' info' : '') + '" data-st="' + s.n + '" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><div class="l">' + s.n + '. ' + esc(s.title) + '</div><div class="v">' + esc(s.big) + '</div><div class="mut" style="font-size:12px">' + esc(s.bigLabel) + '</div></button>'; }).join('') + '</div>';
      h += lanePills(stage.lanes.map(function (id) { return m.lanes[id]; }), lane.id, 'ln');
      if (lane.hint) h += '<p class="mut" style="padding:8px 24px 0;font-size:12px">' + esc(lane.hint) + '</p>';
      if (!lane.items.length) h += '<div class="empty"><b>Nothing here</b></div>';
      else h += X.tableHtml([{ k: 'title', label: lane.kind === 'finding' ? 'Finding' : 'Month', main: 1 }, { k: 'sub', label: 'Detail' }, { k: 'accountName', label: 'Vendor' }, { k: 'state', label: 'State', pill: 1 }, { k: 'amt', label: 'Amount', r: 1 }, { k: 'ageText', label: 'Timing' }],
        lane.items.slice(0, 300).map(function (i) { return { title: i.title, sub: i.sub, accountName: i.accountName, state: i.state, amt: money(i.amount), ageText: i.ageText }; }), true);
      var cur = FS.sel != null && lane.items[FS.sel];
      if (cur) h += '<div class="cards"><section class="card" id="det"><h3>' + esc(cur.title) + '</h3><dl><dt>Detail</dt><dd>' + esc(cur.sub) + '</dd><dt>Vendor</dt><dd>' + esc(cur.accountName || 'None') + '</dd><dt>Amount</dt><dd>' + esc(money(cur.amount) || 'None') + '</dd></dl>' +
        (cur.note ? '<p class="mut" style="margin:10px 0 0">' + esc(cur.note) + '</p>' : '') +
        '<div class="acts"><button type="button" class="btn pri" data-a="open">Open ' + (cur.kind === 'finding' ? 'finding' : 'month') + ' record</button>' + (cur.kind === 'finding' && cur.periodId ? '<button type="button" class="btn" data-a="month">Open billing month</button>' : '') + '<button type="button" class="btn" data-a="close">Close</button></div></section></div>';
      h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">' + m.totals.months + ' months, ' + m.totals.findings + ' findings read. Reconcile is due ' + m.lateDays + ' days after month end (a guess). Read only: decisions are recorded in the Billing Findings records.</p>';
    }
    root.innerHTML = h + '</div>';
    X.bindSwitch();
    $('rf').onclick = function () { loadBilling(true).then(function () { flowDraw(root); X.toast('Refreshed'); }); };
    root.onclick = function (e) {
      var t;
      if ((t = e.target.closest('[data-sc]'))) { FS.scope = t.getAttribute('data-sc'); FS.sel = null; flowDraw(root); }
      else if ((t = e.target.closest('[data-st]'))) { var s = m.stages[+t.getAttribute('data-st') - 1]; FS.lane = s.lanes[0]; FS.sel = null; flowDraw(root); }
      else if ((t = e.target.closest('[data-ln]'))) { e.preventDefault(); FS.lane = t.getAttribute('data-ln'); FS.sel = null; flowDraw(root); }
      else if ((t = e.target.closest('button[data-a]'))) {
        var a = t.getAttribute('data-a'), c = lane.items[FS.sel];
        if (a === 'open') X.openCrm(c.kind === 'finding' ? 'Billing_Findings' : 'Billing_Periods', c.id); else if (a === 'month') X.openCrm('Billing_Periods', c.periodId); else { FS.sel = null; flowDraw(root); }
      } else if ((t = e.target.closest('tr[data-i]'))) { FS.sel = +t.getAttribute('data-i'); flowDraw(root); var d = $('det'); if (d) d.scrollIntoView({ block: 'nearest' }); }
    };
  }

  /* ---------- Billing findings ---------- */
  var GS = { period: null, vendor: '', category: '', openOnly: true, sel: null };
  function findingsDraw(root) {
    var all = FM.normalizeAll(B.findings), pers = {};
    all.forEach(function (r) { if (r.period) pers[r.period] = 1; });
    var plist = Object.keys(pers).sort().reverse();
    if (!GS.period || !pers[GS.period]) GS.period = plist[0] || null;
    var rows = all.filter(function (r) { return r.period === GS.period; }), t = FM.totals(rows), mx = FM.matrix(rows);
    var list = FM.detail(rows, { vendor: GS.vendor, category: GS.category, openOnly: GS.openOnly });
    var h = '<div class="wrap">' + X.head('Processes', 'Billing findings', GS.period ? BF.monthLabel(GS.period) : '', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote() + errBox();
    if (!B.loaded) h += '<div class="empty">Loading billing…</div>';
    else if (!plist.length) h += '<div class="empty"><b>No findings read</b></div>';
    else {
      h += '<div class="bar"><label class="mut">Month <select id="per" class="search" style="max-width:200px">' + plist.map(function (p) { return '<option value="' + p + '"' + (p === GS.period ? ' selected' : '') + '>' + esc(BF.monthLabel(p)) + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="pillbtn" id="oo" aria-pressed="' + GS.openOnly + '">Open only</button>' + (GS.vendor || GS.category ? '<button type="button" class="pillbtn" id="clr" aria-pressed="false">Clear: ' + esc(GS.vendor || 'any vendor') + ' / ' + esc(GS.category || 'any type') + '</button>' : '') + '</div>';
      h += '<div class="kpis"><div class="kpi"><div class="l">Findings</div><div class="v">' + t.total + '</div></div><div class="kpi warn"><div class="l">Open</div><div class="v">' + t.open + '</div></div><div class="kpi"><div class="l">At stake</div><div class="v">' + esc(money(t.dollars)) + '</div></div><div class="kpi bad"><div class="l">Overbilled</div><div class="v">' + esc(money(t.overbilledDollars)) + '</div></div></div>';
      h += '<div class="tw"><table><thead><tr><th>Vendor</th>' + mx.categories.map(function (c) { return '<th class="r">' + esc(c) + '</th>'; }).join('') + '<th class="r">Total</th></tr></thead><tbody>' +
        mx.vendors.map(function (v) { return '<tr><td class="main"><a href="#" data-v="' + esc(v.vendor) + '" data-c="" style="color:inherit">' + esc(v.vendor) + '</a></td>' + mx.categories.map(function (c) { var x = v.cells[c]; return '<td class="r">' + (x ? '<a href="#" data-v="' + esc(v.vendor) + '" data-c="' + esc(c) + '" style="color:var(--acc)">' + x.open + '/' + x.total + '</a>' : '') + '</td>'; }).join('') + '<td class="r">' + v.open + '/' + v.total + '</td></tr>'; }).join('') + '</tbody></table></div><p class="mut" style="padding:6px 24px 0;font-size:12px">Cells show open / total. Click one to filter.</p>';
      h += list.length ? X.tableHtml([{ k: 'participant', label: 'Subject', main: 1 }, { k: 'vendor', label: 'Vendor' }, { k: 'category', label: 'Type' }, { k: 'checkId', label: 'Check' }, { k: 'severity', label: 'Severity', pill: 1 }, { k: 'status', label: 'Status', pill: 1 }, { k: 'dollars', label: 'Dollars', r: 1 }],
        list.slice(0, 300).map(function (r) { return { participant: r.participant, vendor: r.vendor, category: r.category, checkId: r.checkId, severity: r.severity, status: r.status, dollars: r.dollars ? money(r.dollars) : '' }; }), true) : '<div class="empty"><b>No findings match</b></div>';
    }
    root.innerHTML = h + '</div>';
    X.bindSwitch();
    $('rf').onclick = function () { loadBilling(true).then(function () { findingsDraw(root); X.toast('Refreshed'); }); };
    root.onclick = function (e) {
      var t;
      if ((t = e.target.closest('a[data-v]'))) { e.preventDefault(); GS.vendor = t.getAttribute('data-v'); GS.category = t.getAttribute('data-c'); findingsDraw(root); }
      else if (e.target.closest('#oo')) { GS.openOnly = !GS.openOnly; findingsDraw(root); }
      else if (e.target.closest('#clr')) { GS.vendor = ''; GS.category = ''; findingsDraw(root); }
      else if ((t = e.target.closest('tr[data-i]'))) X.openCrm('Billing_Findings', list[+t.getAttribute('data-i')].id);
    };
    var per = $('per'); if (per) per.onchange = function () { GS.period = per.value; GS.vendor = GS.category = ''; findingsDraw(root); };
  }

  function billingView(key, title, draw) {
    return { key: key, title: title, swLabel: key === 'billing_flow' ? 'Flow' : 'Findings', group: 'Billing', entity: key === 'billing_flow' ? 'Billing_Periods' : 'Billing_Findings', custom: true,
      render: function (root, ctx) { X = ctx; draw(root); if (!B.loaded && !B.busy) loadBilling().then(function () { draw(root); }); } };
  }

  /* ---------- lane views: Contract and Solicitations ---------- */
  function laneView(o) {
    var S = { rows: [], loaded: false, busy: false, err: '', lane: o.lanes[0].id, sel: null }, root;
    function lanesOf() { return o.lanes.map(function (l) { var items = S.rows.filter(l.test); return { id: l.id, label: l.label, count: items.length, items: items, hint: l.hint || '' }; }); }
    function draw() {
      var ls = lanesOf(), lane = ls.filter(function (l) { return l.id === S.lane; })[0] || ls[0];
      var h = '<div class="wrap">' + X.head('Processes', o.title, o.sub, '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
      if (S.err) h += '<div class="err">Could not read ' + esc(o.entity) + ': ' + esc(S.err) + '</div>';
      h += '<div class="kpis">' + o.lanes.map(function (l, i) { var n = ls[i].count; return l.kpi ? '<button type="button" class="kpi ' + (n ? l.kpi : '') + '" data-ln="' + l.id + '" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><div class="l">' + esc(l.label) + '</div><div class="v">' + n + '</div></button>' : ''; }).join('') + '</div>';
      h += lanePills(ls, lane.id, 'ln');
      if (!S.loaded) h += '<div class="empty">Loading…</div>';
      else if (!lane.items.length) h += '<div class="empty"><b>Nothing here</b></div>';
      else h += X.tableHtml(o.cols, lane.items.slice(0, 300), true);
      var cur = S.sel != null && lane.items[S.sel];
      if (cur) h += '<div class="cards"><section class="card" id="det"><h3>' + esc(cur[o.nameKey]) + '</h3><dl>' + o.detail.map(function (d) { return '<dt>' + esc(d[1]) + '</dt><dd>' + esc(X.R.fmt(cur[d[0]], d[2])) + '</dd>'; }).join('') + '</dl><div class="acts"><button type="button" class="btn pri" data-a="open">Open ' + esc(o.noun) + '</button>' +
        (cur[o.acct] && cur[o.acct].id ? '<button type="button" class="btn" data-a="acct">Open account</button>' : '') + '<button type="button" class="btn" data-a="close">Close</button></div></section></div>';
      h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">' + esc(o.foot) + '</p></div>';
      root.innerHTML = h; X.bindSwitch();
      $('rf').onclick = function () { load(true).then(function () { draw(); X.toast('Refreshed'); }); };
      root.onclick = function (e) {
        var t;
        if ((t = e.target.closest('[data-ln]'))) { S.lane = t.getAttribute('data-ln'); S.sel = null; draw(); }
        else if ((t = e.target.closest('button[data-a]'))) { var a = t.getAttribute('data-a'), c = lane.items[S.sel]; if (a === 'open') X.openCrm(o.entity, c.id); else if (a === 'acct') X.openCrm('Accounts', c[o.acct].id); else { S.sel = null; draw(); } }
        else if ((t = e.target.closest('tr[data-i]'))) { S.sel = +t.getAttribute('data-i'); draw(); var d = $('det'); if (d) d.scrollIntoView({ block: 'nearest' }); }
      };
    }
    function load(force) {
      if (S.busy || (S.loaded && !force)) return Promise.resolve();
      S.busy = true; S.err = '';
      if (!X.isLive()) { S.rows = window.PROC_DEMO[o.demo]; S.loaded = true; S.busy = false; return Promise.resolve(); }
      return pageAll('select id, ' + o.select + ' from ' + o.entity + ' where id is not null', 'id asc').then(function (r) { S.rows = r; S.loaded = true; S.busy = false; }, function (e) { S.err = e.message || 'Read failed'; S.loaded = true; S.busy = false; });
    }
    return { key: o.key, title: o.title, swLabel: o.swLabel, group: o.group, entity: o.entity, custom: true, render: function (r, ctx) { root = r; X = ctx; draw(); if (!S.loaded && !S.busy) load().then(draw); } };
  }
  var truthy = function (v) { return v === true || v === 'true'; };
  var s = function (v) { return v && v !== '-None-' ? String(v) : ''; };
  var RM = window.RecModules;
  RM.p_contract = laneView({
    key: 'p_contract', title: 'Contract ingest', swLabel: 'Contract ingest', group: 'Contract', entity: 'Contracts', demo: 'contracts', noun: 'contract', nameKey: 'Name', acct: 'Account',
    sub: 'Where each contract is in ingest, cleanup and reconciliation. Upload new packets in the Contract Ingest tab.',
    select: 'Name, Account, Contract_Status, Ingest_Status, Needs_Cleanup, Reconciliation_Status, Days_to_Final_End, Renewal_Band',
    foot: 'Read only. Reconciliation compares each contract with the billing system. Packets are uploaded in the Contract Ingest tab until that action moves here.',
    lanes: [
      { id: 'review', label: 'Needs review', kpi: 'warn', test: function (r) { return s(r.Ingest_Status) === 'Needs Review'; } },
      { id: 'cleanup', label: 'Needs cleanup', kpi: 'warn', test: function (r) { return truthy(r.Needs_Cleanup); } },
      { id: 'recon', label: 'Reconcile by hand', kpi: 'bad', test: function (r) { return /Check by hand|Rate differs|Absent from CB/.test(s(r.Reconciliation_Status)); } },
      { id: 'backlog', label: 'Backlog (not ingested)', kpi: 'info', test: function (r) { return /Backlog|Not Ingested/.test(s(r.Ingest_Status)); } },
      { id: 'done', label: 'Ingested', kpi: 'good', test: function (r) { return s(r.Ingest_Status) === 'Ingested'; } },
      { id: 'all', label: 'All contracts', test: function () { return true; } }
    ],
    cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Account', label: 'Account' }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Ingest_Status', label: 'Ingest', pill: 1 }, { k: 'Reconciliation_Status', label: 'Reconciliation', pill: 1 }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }],
    detail: [['Account', 'Account'], ['Contract_Status', 'Contract status'], ['Ingest_Status', 'Ingest'], ['Needs_Cleanup', 'Needs cleanup'], ['Reconciliation_Status', 'Reconciliation'], ['Renewal_Band', 'Renewal band'], ['Days_to_Final_End', 'Days left', 'num']]
  });
  RM.p_solicit = laneView({
    key: 'p_solicit', title: 'Solicitations', swLabel: 'Solicitations', group: 'Solicitations', entity: 'Solicitations', demo: 'solicitations', noun: 'solicitation', nameKey: 'Name', acct: 'Issuing_Agency',
    sub: 'Every solicitation by deadline and bid decision. Start a new one in the Solicitation Wizard tab.',
    select: 'Name, Issuing_Agency, Status, Proposal_Due, Days_To_Deadline, Bid_Decision, Best_Score, Unmet_Mandatory_Count',
    foot: 'Read only. New solicitations are created in the Solicitation Wizard tab until that action moves here.',
    lanes: [
      { id: 'soon', label: 'Due within 30 days', kpi: 'bad', test: function (r) { var d = r.Days_To_Deadline; return d != null && d !== '' && +d >= 0 && +d <= 30; } },
      { id: 'nodec', label: 'No bid decision', kpi: 'warn', test: function (r) { return !s(r.Bid_Decision); } },
      { id: 'unmet', label: 'Unmet mandatory', kpi: 'bad', test: function (r) { return +r.Unmet_Mandatory_Count > 0; } },
      { id: 'dec', label: 'Decided', kpi: 'good', test: function (r) { return !!s(r.Bid_Decision); } },
      { id: 'all', label: 'All solicitations', test: function () { return true; } }
    ],
    cols: [{ k: 'Name', label: 'Solicitation', main: 1 }, { k: 'Issuing_Agency', label: 'Agency' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Proposal_Due', label: 'Due', t: 'date' }, { k: 'Days_To_Deadline', label: 'Days', t: 'num', r: 1 }, { k: 'Bid_Decision', label: 'Decision', pill: 1 }, { k: 'Best_Score', label: 'Score', t: 'num', r: 1 }],
    detail: [['Issuing_Agency', 'Agency'], ['Status', 'Status'], ['Proposal_Due', 'Proposal due', 'date'], ['Bid_Decision', 'Bid decision'], ['Best_Score', 'Best score', 'num'], ['Unmet_Mandatory_Count', 'Unmet mandatory', 'num']]
  });
  RM.billing_flow = billingView('billing_flow', 'Billing flow', flowDraw);
  RM.billing_findings = billingView('billing_findings', 'Billing findings', findingsDraw);
  if (RM.billing) { RM.billing.swLabel = 'Months'; RM.billing.group = 'Billing'; }
})();
