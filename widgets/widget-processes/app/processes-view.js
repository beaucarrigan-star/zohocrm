/* processes-view.js: Contract, Billing (Flow, Findings, Months) and Solicitations views for the Processes widget.
   Status views; rows open the native CRM record. Billing months reuse the Records engine (RecModules.billing).
   v3.1 (Oct 14): Administrators can set a finding's Status (the decision) in Billing > Findings, and a solicitation's Status in
   Solicitations, right in the table. Each change saves at once with Undo. Everyone else sees the same tables read-only. */
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
      { q: 'select ' + PSEL + ', Last_Run_Status, Last_Run_At, Last_Run_Message, Reconciled_On, Accounting_Report_At from Billing_Periods where id is not null', fields: {} },
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
  var FSTAT = ['Open', 'Disputed with vendor', 'Resolved - credited', 'Resolved - explained', 'Not an issue'], FOPEN = { 'Open': 1, 'Disputed with vendor': 1 };
  var ADM = null, fstatPl = null;
  function adminCheck(redraw) {
    if (ADM === null) { ADM = false; X.hasRole(['admin']).then(function (a) { ADM = a; if (a) redraw(); }); }
    if (ADM && !fstatPl) { fstatPl = FSTAT; X.picklist('Billing_Findings', 'Status', FSTAT).then(function (v) { if (v && v.length) { fstatPl = v; redraw(); } }); }
  }
  /* a finding's decision: Status, with Is_Open kept in step (Open and Disputed with vendor are open) */
  function decide(root, raw, v) {
    var old = { Status: raw.Status || null, Is_Open: raw.Is_Open }, nu = { Status: v, Is_Open: !!FOPEN[v] };
    if (old.Status === v) return;
    var apply = function (x) { raw.Status = x.Status; raw.Is_Open = x.Is_Open; findingsDraw(root); };
    X.update('Billing_Findings', raw.id, nu).then(function () {
      apply(nu);
      X.toastUndo('Saved: ' + (raw.Subject || 'finding') + ' set to ' + v, function () { X.update('Billing_Findings', raw.id, { Status: old.Status, Is_Open: old.Is_Open == null ? !!FOPEN[old.Status] : old.Is_Open }).then(function () { apply(old); X.toast('Undone'); }, function (e) { X.toast('Could not undo: ' + ((e && e.message) || e)); }); });
    }, function (e) { X.toast('Could not save: ' + ((e && e.message) || e)); findingsDraw(root); });
  }
  function findingsDraw(root) {
    var all = FM.normalizeAll(B.findings), pers = {};
    all.forEach(function (r) { if (r.period) pers[r.period] = 1; });
    B.periods.forEach(function (p) { var k = String(p.Period || '').trim(); if (k) pers[k] = pers[k] || 0; });
    var plist = Object.keys(pers).sort().reverse();
    if (!GS.period || !pers[GS.period]) GS.period = plist[0] || null;
    var rows = all.filter(function (r) { return r.period === GS.period; }), t = FM.totals(rows), mx = FM.matrix(rows);
    var list = FM.detail(rows, { vendor: GS.vendor, category: GS.category, openOnly: GS.openOnly });
    var h = '<div class="wrap">' + X.head('Processes', 'Billing findings', GS.period ? BF.monthLabel(GS.period) : '', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote() + errBox();
    if (!B.loaded) h += '<div class="empty">Loading billing…</div>';
    else if (!plist.length) h += '<div class="empty"><b>No findings read</b></div>';
    else {
      var per0 = B.periods.filter(function (p) { return String(p.Period || '').trim() === GS.period; })[0];
      h += '<div class="bar"><label class="mut">Month <select id="per" class="search" style="max-width:200px">' + plist.map(function (p) { return '<option value="' + p + '"' + (p === GS.period ? ' selected' : '') + '>' + esc(BF.monthLabel(p)) + (pers[p] ? '' : ' (no findings)') + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="pillbtn" id="oo" aria-pressed="' + GS.openOnly + '">Open only</button>' + (GS.vendor || GS.category ? '<button type="button" class="pillbtn" id="clr" aria-pressed="false">Clear: ' + esc(GS.vendor || 'any vendor') + ' / ' + esc(GS.category || 'any type') + '</button>' : '') + '</div>';
      if (!rows.length) h += '<div class="err">No findings are saved for ' + esc(BF.monthLabel(GS.period)) + '.' + (per0 && per0.Last_Run_Message ? ' Last run said: ' + esc(per0.Last_Run_Message) : '') + (per0 && !per0.Upload_Vendor ? ' Upload Vendor is blank on this month.' : '') + '</div>';
      h += '<div class="kpis"><div class="kpi"><div class="l">Findings</div><div class="v">' + t.total + '</div></div><div class="kpi warn"><div class="l">Open</div><div class="v">' + t.open + '</div></div><div class="kpi"><div class="l">At stake</div><div class="v">' + esc(money(t.dollars)) + '</div></div><div class="kpi bad"><div class="l">Overbilled</div><div class="v">' + esc(money(t.overbilledDollars)) + '</div></div></div>';
      h += '<div class="tw"><table><thead><tr><th>Vendor</th>' + mx.categories.map(function (c) { return '<th class="r">' + esc(c) + '</th>'; }).join('') + '<th class="r">Total</th></tr></thead><tbody>' +
        mx.vendors.map(function (v) { return '<tr><td class="main"><a href="#" data-v="' + esc(v.vendor) + '" data-c="" style="color:inherit">' + esc(v.vendor) + '</a></td>' + mx.categories.map(function (c) { var x = v.cells[c]; return '<td class="r">' + (x ? '<a href="#" data-v="' + esc(v.vendor) + '" data-c="' + esc(c) + '" style="color:var(--acc)">' + x.open + '/' + x.total + '</a>' : '') + '</td>'; }).join('') + '<td class="r">' + v.open + '/' + v.total + '</td></tr>'; }).join('') + '</tbody></table></div><p class="mut" style="padding:6px 24px 0;font-size:12px">Cells show open / total. Click one to filter.</p>';
      var fed = ADM ? { pl: { status: fstatPl || FSTAT }, admin: true, title: function (r) { return r.participant || 'finding'; } } : null;
      if (fed && per0 && /Reconciled|Frozen/.test(String(per0.Period_Status || ''))) h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + esc(BF.monthLabel(GS.period)) + ' is ' + esc(per0.Period_Status) + '. Changing a decision here un-reconciles the month; run Reconcile again afterwards.</div>';
      h += list.length ? X.tableHtml([{ k: 'participant', label: 'Subject', main: 1 }, { k: 'vendor', label: 'Vendor' }, { k: 'category', label: 'Type' }, { k: 'checkId', label: 'Check' }, { k: 'severity', label: 'Severity', pill: 1 }, { k: 'status', label: 'Decision', pill: 1, ed: 'pick', opts: FSTAT }, { k: 'dollars', label: 'Dollars', r: 1 }],
        list.slice(0, 300).map(function (r) { return { participant: r.participant, vendor: r.vendor, category: r.category, checkId: r.checkId, severity: r.severity, status: r.status, dollars: r.dollars ? money(r.dollars) : '' }; }), true, fed) +
        (fed ? '<p class="mut edhint">Decision (✎) saves to the finding at once, with Undo, and is read back on the next Reconcile. Administrators only.</p>' : '') : '<div class="empty"><b>No findings match</b></div>';
    }
    root.innerHTML = h + '</div>';
    X.bindSwitch();
    $('rf').onclick = function () { loadBilling(true).then(function () { findingsDraw(root); X.toast('Refreshed'); }); };
    root.onclick = function (e) {
      var t;
      if ((t = e.target.closest('a[data-v]'))) { e.preventDefault(); GS.vendor = t.getAttribute('data-v'); GS.category = t.getAttribute('data-c'); findingsDraw(root); }
      else if (e.target.closest('#oo')) { GS.openOnly = !GS.openOnly; findingsDraw(root); }
      else if (e.target.closest('#clr')) { GS.vendor = ''; GS.category = ''; findingsDraw(root); }
      else if (e.target.closest('.lec')) return;
      else if ((t = e.target.closest('tr[data-i]'))) X.openCrm('Billing_Findings', list[+t.getAttribute('data-i')].id);
    };
    root.onchange = function (e) {
      if (e.target.getAttribute('data-le') !== 'status' || !ADM) return;
      var tr = e.target.closest('tr[data-i]'), f = tr && list[+tr.getAttribute('data-i')]; if (!f) return;
      var raw = B.findings.filter(function (x) { return String(x.id) === String(f.id); })[0]; if (raw && e.target.value) decide(root, raw, e.target.value); else findingsDraw(root);
    };
    adminCheck(function () { findingsDraw(root); });
    var per = $('per'); if (per) per.onchange = function () { GS.period = per.value; GS.vendor = GS.category = ''; findingsDraw(root); };
  }

  function billingView(key, title, draw) {
    return { key: key, title: title, swLabel: key === 'billing_flow' ? 'Flow' : 'Findings', group: 'Billing', entity: key === 'billing_flow' ? 'Billing_Periods' : 'Billing_Findings', custom: true,
      render: function (root, ctx) { X = ctx; draw(root); if (!B.loaded && !B.busy) loadBilling().then(function () { draw(root); }); } };
  }

  /* ---------- lane views: Contract and Solicitations ---------- */
  function laneView(o) {
    var S = { rows: [], loaded: false, busy: false, err: '', lane: o.lanes[0].id, sel: null, canEdit: null, pl: {} }, root;
    function lanesOf() { return o.lanes.map(function (l) { var items = S.rows.filter(l.test); return { id: l.id, label: l.label, count: items.length, items: items, hint: l.hint || '' }; }); }
    function draw() {
      var ls = lanesOf(), lane = ls.filter(function (l) { return l.id === S.lane; })[0] || ls[0];
      var h = '<div class="wrap">' + X.head('Processes', o.title, o.sub, '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
      if (S.err) h += '<div class="err">Could not read ' + esc(o.entity) + ': ' + esc(S.err) + '</div>';
      h += '<div class="kpis">' + o.lanes.map(function (l, i) { var n = ls[i].count; return l.kpi ? '<button type="button" class="kpi ' + (n ? l.kpi : '') + '" data-ln="' + l.id + '" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><div class="l">' + esc(l.label) + '</div><div class="v">' + n + '</div></button>' : ''; }).join('') + '</div>';
      h += lanePills(ls, lane.id, 'ln');
      if (!S.loaded) h += '<div class="empty">Loading…</div>';
      else if (!lane.items.length) h += '<div class="empty"><b>Nothing here</b></div>';
      else {
        var ed = o.edit && S.canEdit ? { pl: S.pl, admin: true, title: function (r) { return X.R.plain(r[o.nameKey]) || o.noun; } } : null;
        var cols = ed ? o.cols.map(function (c) { var x = o.edit.cols[c.k]; if (!x) return c; var y = {}; for (var k in c) y[k] = c[k]; y.ed = x.ed; y.opts = x.opts; return y; }) : o.cols;
        h += X.tableHtml(cols, lane.items.slice(0, 300), true, ed) + (ed ? '<p class="mut edhint">Columns marked ✎ save to Zoho at once, with Undo. ' + esc(o.edit.who) + '.</p>' : '');
      }
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
        else if (e.target.closest('.lec')) return;
        else if ((t = e.target.closest('tr[data-i]'))) { S.sel = +t.getAttribute('data-i'); draw(); var d = $('det'); if (d) d.scrollIntoView({ block: 'nearest' }); }
      };
      root.onchange = function (e) {
        var k = e.target.getAttribute('data-le'), tr = e.target.closest('tr[data-i]'); if (!k || !tr || !S.canEdit) return;
        var row = lane.items[+tr.getAttribute('data-i')], v = e.target.value.trim(), ch = {}; if (!row) return;
        ch[k] = [v || null, v || null];
        X.editRaw(o.entity, row, ch, k.replace(/_/g, ' ').toLowerCase() + (v ? ' set to ' + v : ' cleared') + ' on ' + (X.R.plain(row[o.nameKey]) || o.noun), draw);
      };
      if (o.edit && S.canEdit == null) { S.canEdit = false; X.hasRole(o.edit.roles).then(function (a) { S.canEdit = a; if (!a) return; Object.keys(o.edit.cols).forEach(function (k) { var c = o.edit.cols[k]; if (c.ed === 'pick') { S.pl[k] = c.opts; X.picklist(o.entity, k, c.opts).then(function (v) { if (v && v.length) S.pl[k] = v; draw(); }); } }); draw(); }); }
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
    key: 'p_contract', title: 'Contract ingest', swLabel: 'Pipeline', group: 'Contract', entity: 'Contracts', demo: 'contracts', noun: 'contract', nameKey: 'Name', acct: 'Account',
    sub: 'Where each contract is in ingest, cleanup and reconciliation. Upload new packets under Ingest.',
    select: 'Name, Account, Contract_Status, Ingest_Status, Needs_Cleanup, Reconciliation_Status, Days_to_Final_End, Renewal_Band',
    foot: 'Read only. Reconciliation compares each contract with the billing system. Packets are uploaded under Ingest.',
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
    sub: 'Every solicitation by deadline and bid decision. Start a new one under New.',
    select: 'Name, Issuing_Agency, Status, Proposal_Due, Days_To_Deadline, Bid_Decision, Best_Score, Unmet_Mandatory_Count',
    foot: 'Administrators can change Status in the table. New solicitations are created under New.',
    edit: { roles: ['admin'], who: 'Administrators only', cols: { Status: { ed: 'pick', opts: ['Identified', 'Reviewing', 'Bid Decision Pending', 'Preparing Proposal', 'Submitted', 'Shortlisted / Orals', 'Won', 'Lost', 'No-Bid - Tracking', 'Cancelled by Agency'] } } },
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

  /* ---------- Billing run: create the month, attach the vendor zip, reconcile ---------- */
  /* Reconcile still runs from the button on the Billing Period record. To start it from here, make a standalone function
     (REST API on) that does what that button does, and put its name here. Until then the last step opens the month. */
  var RECONCILE_FN = '';
  var VENDORS = ['Allied', 'SCRAM', 'SuperCom', 'Buddi', 'Drug Testing'];
  var RS = { month: '', vendor: 'Allied', files: [], period: null, step: 1, msg: '', busy: false, status: null };
  function curMonth() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function periodFor(key) { return B.periods.filter(function (p) { return String(p.Period || '').trim() === key; })[0] || null; }
  function sdk() { return window.ZOHO && window.ZOHO.CRM; }
  function runDraw(root) {
    var h = '<div class="wrap">' + X.head('Processes', 'Billing run', 'Create the month, attach the vendor zip, reconcile', '', '') + X.switchHtml() + X.demoNote() + errBox();
    if (!RS.month) RS.month = curMonth();
    var ex = periodFor(RS.month), lbl = BF.monthLabel(RS.month);
    h += '<div class="cards"><section class="card"><h3>1. Month and vendor</h3><dl><dt>Month</dt><dd><input type="month" id="rn-m" class="search" value="' + esc(RS.month) + '"></dd><dt>Vendor</dt><dd><select id="rn-v" class="search">' +
      VENDORS.map(function (v) { return '<option' + (v === RS.vendor ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></dd></dl>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">' + (RS.period ? 'Using ' + esc(RS.period.name) + '.' : ex ? esc(lbl) + ' already exists (' + esc(ex.Period_Status || 'no status') + '). The zip is added to that month. Its upload vendor is ' + esc(ex.Upload_Vendor || 'blank') + '.' : esc(lbl) + ' does not exist yet. It will be created as Open.') + '</p></section>';
    h += '<section class="card"><h3>2. Vendor zip</h3><input type="file" id="rn-f" multiple accept=".zip,.pdf,.csv,.xlsx"><p class="mut" style="margin:10px 0 0;font-size:12px">' +
      (RS.files.length ? RS.files.map(function (f) { return esc(f.name) + ' (' + Math.round(f.size / 1024) + ' KB)'; }).join('<br>') : 'One zip per vendor per month: the invoice plus the daily assigned and spare device files.') + '</p>' +
      '<div class="acts"><button type="button" class="btn pri" id="rn-go"' + (RS.busy || !RS.files.length ? ' disabled' : '') + '>' + (RS.busy ? 'Working…' : 'Create month and attach') + '</button></div></section>';
    h += '<section class="card"><h3>3. Reconcile</h3><p style="margin:0">' + (RS.period ? 'The zip is on ' + esc(RS.period.name) + '.' : 'Do steps 1 and 2 first.') + '</p>' +
      (RS.status ? '<dl style="margin-top:10px"><dt>Run status</dt><dd>' + esc(RS.status.Last_Run_Status || 'None yet') + '</dd><dt>Last run</dt><dd>' + esc(RS.status.Last_Run_At || '') + '</dd><dt>Message</dt><dd>' + esc(RS.status.Last_Run_Message || '') + '</dd></dl>' : '') +
      '<div class="acts"><button type="button" class="btn pri" id="rn-rec"' + (RS.period && !RS.busy ? '' : ' disabled') + '>' + (RECONCILE_FN ? 'Reconcile now' : 'Open month, then press Reconcile') + '</button>' +
      '<button type="button" class="btn" id="rn-st"' + (RS.period ? '' : ' disabled') + '>Check run status</button></div>' +
      (RECONCILE_FN ? '' : '<p class="mut" style="margin:10px 0 0;font-size:12px">Reconcile still runs from the button on the Billing Period record. Once that button is made callable from here this step becomes one click.</p>') + '</section></div>';
    if (RS.msg) h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + esc(RS.msg) + '</div>';
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">Creates one Billing Period record and attaches your files to it. It never edits findings or money.</p></div>';
    root.innerHTML = h; X.bindSwitch();
    $('rn-m').onchange = function (e) { RS.month = e.target.value; RS.period = null; RS.msg = ''; runDraw(root); };
    $('rn-v').onchange = function (e) { RS.vendor = e.target.value; };
    $('rn-f').onchange = function (e) { RS.files = Array.prototype.slice.call(e.target.files); runDraw(root); };
    $('rn-go').onclick = function () { runGo(root); };
    $('rn-st').onclick = function () { runStatus(root); };
    $('rn-rec').onclick = function () { runRec(root); };
  }
  function runGo(root) {
    if (!RS.month || !RS.files.length) return;
    RS.busy = true; RS.msg = ''; runDraw(root);
    var done = function (p, note) { RS.period = p; RS.busy = false; RS.msg = note; runDraw(root); loadBilling(true); };
    var fail = function (e) { RS.busy = false; RS.msg = 'Could not finish: ' + ((e && (e.message || (e.data && e.data[0] && e.data[0].message) || e.code)) || e) + '. Nothing was reconciled.'; runDraw(root); };
    if (!X.isLive()) { return setTimeout(function () { done({ id: 'demo', name: BF.monthLabel(RS.month) }, 'Demo: would create ' + BF.monthLabel(RS.month) + ' and attach ' + RS.files.length + ' file(s).'); }, 300); }
    var ex = periodFor(RS.month);
    var ensure = ex ? Promise.resolve({ id: ex.id, name: ex.Name || BF.monthLabel(RS.month) }) :
      sdk().API.insertRecord({ Entity: 'Billing_Periods', APIData: { Name: BF.monthLabel(RS.month), Period: RS.month, Upload_Vendor: RS.vendor, Period_Status: 'Open' } }).then(function (res) {
        var d = res && res.data && res.data[0]; if (!d || d.code !== 'SUCCESS') throw new Error((d && d.message) || 'Create failed');
        return { id: d.details.id, name: BF.monthLabel(RS.month) };
      });
    ensure.then(function (p) {
      return RS.files.reduce(function (chain, f) {
        return chain.then(function () { return sdk().API.attachFile({ Entity: 'Billing_Periods', RecordID: p.id, File: { Name: f.name, Content: f } }).then(function (r) { var d = r && r.data && r.data[0]; if (d && d.code && d.code !== 'SUCCESS') throw new Error(d.message || d.code); }); });
      }, Promise.resolve()).then(function () { RS.files = []; done(p, (ex ? 'Added the file(s) to ' : 'Created ') + p.name + ' and attached the file(s). Next: reconcile.'); });
    }).catch(fail);
  }
  function runStatus(root) {
    if (!RS.period || !X.isLive()) { RS.msg = X.isLive() ? '' : 'Demo: no run yet.'; runDraw(root); return; }
    X.coql("select Last_Run_Status, Last_Run_At, Last_Run_Message from Billing_Periods where id = '" + RS.period.id + "'").then(function (r) { RS.status = r.rows[0] || null; runDraw(root); }, function (e) { RS.msg = 'Could not read the run: ' + e.message; runDraw(root); });
  }
  function runRec(root) {
    if (!RECONCILE_FN || !X.isLive()) { X.openCrm('Billing_Periods', RS.period.id); return; }
    RS.busy = true; runDraw(root);
    sdk().FUNCTIONS.execute(RECONCILE_FN, { arguments: JSON.stringify({ id: RS.period.id }) }).then(function () { RS.busy = false; RS.msg = 'Reconcile started. Check run status in a minute.'; runDraw(root); },
      function (e) { RS.busy = false; RS.msg = 'Reconcile did not start: ' + ((e && e.message) || e); runDraw(root); });
  }
  RM.billing_run = { key: 'billing_run', title: 'Billing run', swLabel: 'Run', group: 'Billing', entity: 'Billing_Periods', custom: true, render: function (root, ctx) { X = ctx; runDraw(root); if (!B.loaded && !B.busy) loadBilling().then(function () { runDraw(root); }); } };
  RM.billing_flow = billingView('billing_flow', 'Billing flow', flowDraw);
  RM.billing_findings = billingView('billing_findings', 'Billing findings', findingsDraw);
  if (RM.billing) { RM.billing.swLabel = 'Months'; RM.billing.group = 'Billing'; }
})();
