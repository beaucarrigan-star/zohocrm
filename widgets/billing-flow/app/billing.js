/* Billing flow widget. Uses jpk v1.1.0 and BillingFlowModel; with no Zoho SDK it uses BillingFlowDemo.
   Read-only: COQL reads of Billing_Periods and Billing_Findings. Nothing is written. */
(function () {
  'use strict';
  var M = window.BillingFlowModel, J = window.JPK;
  var PE_TRIES = [
    'select id, Name, Period, Period_Status, Upload_Vendor, Invoiced, Verified, On_Hold, Recommended_Pay, Credits_To_Confirm, Latent_Exposure, Overbilled, Unverified, Findings_Total, Findings_Open, Needs_Decision, Last_Run_Status, Last_Run_At, Reconciled_On, Accounting_Report_At from Billing_Periods where id is not null order by id asc',
    'select id, Name, Period, Period_Status, Upload_Vendor, Invoiced, Verified, On_Hold, Recommended_Pay, Findings_Total, Findings_Open, Last_Run_At, Reconciled_On from Billing_Periods where id is not null order by id asc',
    'select id, Name, Period, Period_Status from Billing_Periods where id is not null order by id asc'
  ];
  var FI_TRIES = [
    'select id, Period, Billing_Period, Vendor, Check_ID, Category, Subject, Severity, Dollars, Money_Type, Status, Is_Open, In_Latest_Run, Decision_Notes from Billing_Findings where id is not null order by id asc',
    'select id, Period, Billing_Period, Vendor, Check_ID, Category, Subject, Severity, Dollars, Money_Type, Status, Is_Open from Billing_Findings where id is not null order by id asc'
  ];
  var ENTITY = { period: 'Billing_Periods', finding: 'Billing_Findings' };
  var drawerClick = null;
  var state = { demo: false, data: { periods: [], findings: [] }, notes: [], now: Date.now(), scope: 'all', late: M.DEFAULTS.lateDays, model: null, lane: null, nx: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function firstThatWorks(tries, apply) {
    var i = 0, last;
    function next() {
      if (i >= tries.length) return Promise.reject(last);
      var idx = i++;
      return J.crm.coqlAll(tries[idx]).then(function (r) { apply(r, idx); }, function (e) { last = e; return next(); });
    }
    return next();
  }

  /* ---------- data ---------- */
  function load() {
    state.now = Date.now(); state.notes = [];
    if (state.demo) { state.data = window.BillingFlowDemo.make(state.now); return Promise.resolve(); }
    var d = { periods: [], findings: [], fields: {} };
    return Promise.all([
      firstThatWorks(PE_TRIES, function (r, i) { d.periods = r; d.fields.runAt = i < 2; d.fields.report = i < 1; if (i === 1) state.notes.push('Credits, latent, overbilled, unverified and report fields could not be read, so the money step is limited.'); if (i === 2) state.notes.push('Money and run fields could not be read, so only month and status show.'); })
        .catch(function (e) { throw new Error('Billing Periods: ' + msg(e)); }),
      firstThatWorks(FI_TRIES, function (r, i) { d.findings = r; d.fields.notes = i < 1; d.fields.inLatest = i < 1; if (i === 1) state.notes.push('In latest run and decision notes could not be read.'); })
        .catch(function (e) { d.fields.findings = false; state.notes.push('Billing Findings could not be read (' + msg(e) + '), so the findings and decisions steps are empty.'); })
    ]).then(function () { state.data = d; });
  }

  /* ---------- render ---------- */
  function scopeButtons() {
    $('#scope').innerHTML = M.SCOPES.map(function (s) { return '<button type="button" data-s="' + s.id + '" aria-pressed="' + (s.id === state.scope) + '">' + J.esc(s.label) + '</button>'; }).join('');
  }
  function laneButton(l) {
    return '<button type="button" class="lane" data-lane="' + J.esc(l.id) + '" aria-pressed="' + (state.lane === l.id) + '">' +
      '<span class="ln">' + J.esc(l.label) + (l.hint ? '<small>' + J.esc(l.hint) + '</small>' : '') + '</span><span class="lc' + tone(l.tone) + '">' + l.count + '</span></button>';
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
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No late months, mismatched counts, undecided money findings, disputes or held money.', progress: 100, button: null });
  }
  function renderHeader() {
    var t = state.model.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' + plural(t.months, 'month') + ', ' + plural(t.findings, 'finding') + ' (' + t.open + ' open), ' + M.money(t.invoiced) + ' invoiced, ' + M.money(t.onHold) + ' on hold.';
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Billing Periods and Findings are Administrator-only in Zoho, so others see a footer note instead of data. Open means the finding\'s Is Open flag (Open or Disputed with vendor). ' +
      'A money finding has dollars or a money type (Overbilled, Unverified, Latent). A reconciled month can still have open findings with no money; that is normal. Late means more than the box above after the month ended. Days use Central time.';
  }
  function columns() {
    return [
      { key: 'title', label: 'Record', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Vendor', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">None</span>'; } },
      { key: 'when', label: 'Date', sortable: true, num: true, sortValue: function (i) { return i.ms == null ? Infinity : i.ms; }, render: function (i) { return J.esc(when(i.ms)); } },
      { key: 'amt', label: 'Amount', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.amount == null ? -Infinity : i.amount; }, render: function (i) { return i.amount == null ? '' : J.esc(M.money(i.amount)); } },
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
    state.model = M.build(state.data, state.now, { scope: state.scope, lateDays: state.late });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 'm-open';
    scopeButtons(); renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- the path for one record ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function it(title, meta, extra) { return '<div class="it"><b>' + J.esc(title) + '</b>' + (meta ? '<div class="meta">' + J.esc(meta) + '</div>' : '') + (extra ? '<div>' + extra + '</div>' : '') + '</div>'; }
  function pathHtml(t) {
    var p = t.period;
    if (!p) return '<ol class="chain"><li><div class="lh">Not linked</div><div class="none">This finding\'s Period matches no Billing Period, so there is no path to show.</div></li></ol>';
    var L = p.loaded, mo = M.money;
    var run = p.runMs != null ? 'Check ran ' + when(p.runMs) + (p.runStatus ? ' (' + p.runStatus + ')' : '') : 'Billing check has not run';
    var month = it(p.name || M.monthLabel(p.period), [p.status || 'No status', p.vendor ? 'Upload ' + p.vendor : 'No upload vendor', run].join(' · '), btn('open-period', p.id, 'Open month'));
    var top = p.findings.filter(function (f) { return f.open; }).sort(function (a, b) { return b.dollars - a.dollars; }).slice(0, 5);
    var fs = it(plural(L.total, 'finding') + ', ' + L.open + ' open', [L.high ? plural(L.high, 'critical or high') : '', L.atStake ? mo(L.atStake) + ' at stake' : ''].filter(Boolean).join(' · ')) +
      top.map(function (f) { return it(f.subject || f.checkId || 'Finding', [f.category, f.severity, f.dollars ? mo(f.dollars) : '', f.status].filter(Boolean).join(' · '), btn('open-finding', f.id, 'Open finding')); }).join('') +
      (L.open > top.length ? '<div class="meta">and ' + (L.open - top.length) + ' more open</div>' : '');
    var dec = it(plural(L.needs, 'money finding') + ' awaiting a decision', plural(L.disputed, 'finding') + ' disputed with the vendor' + (p.needs != null ? ' · month says ' + p.needs + ' need a decision' : ''));
    var money = p.invoiced == null ? '<div class="none">No money totals on this month yet.</div>' :
      it('Invoiced ' + mo(p.invoiced), ['Verified ' + mo(p.verified), p.onHold ? 'On hold ' + mo(p.onHold) : '', p.overbilled ? 'Overbilled ' + mo(p.overbilled) : '', p.credits ? 'Credits to confirm ' + mo(p.credits) : '', p.unverified ? 'Unverified ' + mo(p.unverified) : '', p.pay != null ? 'Recommended pay ' + mo(p.pay) : ''].filter(Boolean).join(' · '));
    var mism = p.total != null && L.total > 0 && (p.total !== L.total || (p.open != null && p.open !== L.open));
    var close = it(p.closed ? 'Closed (' + p.status + ')' : (p.lateBy != null && p.lateBy > 0 ? plural(p.lateBy, 'day') + ' late' : p.lateBy != null ? 'Due in ' + plural(-p.lateBy, 'day') : 'Not closed'),
      [mism ? 'Counts differ: month says ' + p.total + '/' + p.open + ', loaded ' + L.total + '/' + L.open : 'Counts match', p.closed ? (p.reportMs != null ? 'Accounting report ' + when(p.reportMs) : 'No accounting report') : ''].join(' · '));
    return '<ol class="chain"><li><div class="lh">Month</div>' + month + '</li><li><div class="lh">Findings</div>' + fs + '</li><li><div class="lh">Decisions</div>' + dec + '</li><li><div class="lh">Money</div>' + money + '</li><li><div class="lh">Close-out</div>' + close + '</li></ol>';
  }
  function detail(item) {
    var t = M.trace(state.model, item);
    if (!t.period) { J.drawer.open({ title: item.title, html: '<p>' + J.esc(item.note || 'This finding is not linked to a billing month.') + '</p><div class="drawer-actions"><button type="button" class="btn" data-a="open-finding" data-id="' + J.esc(item.id) + '">Open finding</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: item.title, html: pathHtml(t), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var map = { 'open-period': 'period', 'open-finding': 'finding' }, a = b.getAttribute('data-a');
      if (map[a]) openRecord(map[a], b.getAttribute('data-id'));
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by month, vendor, participant or status', onSearch: function () { renderLane(); } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#scope').addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (!b) return; state.scope = b.getAttribute('data-s'); recompute(); });
    $('#lim-late').addEventListener('change', function (e) { var v = parseInt(e.target.value, 10); if (isFinite(v) && v >= 0) { state.late = v; recompute(); } else e.target.value = state.late; });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows each vendor billing month from upload to close-out. Nothing here changes a record.</p>' +
      '<p><b>1 Months.</b> Months by status, months where the billing check has not run, and months with no upload vendor.</p>' +
      '<p><b>2 Findings.</b> Open findings, open critical or high ones, open ones the latest run did not raise again, and resolved ones.</p>' +
      '<p><b>3 Decisions.</b> Money findings still waiting for a decision, findings disputed with the vendor, and resolved findings with no decision note.</p>' +
      '<p><b>4 Money.</b> Each month\'s held, overbilled, to-be-credited and unverified amounts, and months where recommended pay is below the invoice.</p>' +
      '<p><b>5 Close-out.</b> Months past due (the limit box), months whose finding counts do not match what was loaded, findings with no month, and reconciled months with no accounting report.</p>' +
      '<p>Click a step to list its records, then a record to see its month\'s path. The Billing Findings tool shows the same findings as a vendor-by-check matrix.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load billing months.', sub: msg(e) + ' Billing data is Administrator-only.', progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
