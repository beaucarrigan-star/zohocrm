/* Contracts flow widget. Uses jpk v1.1.0 and ContractsFlowModel; with no Zoho SDK it uses ContractsFlowDemo.
   Read-only: COQL reads of Contracts, Contract_Documents, Contract_Clauses and Rate_Lines. Nothing is written. */
(function () {
  'use strict';
  var M = window.ContractsFlowModel, J = window.JPK;
  var CT_BASE = 'id, Name, Account, Counterparty_Type, Contract_Type, Contract_Status, Ingest_Status, Ingested_On, Last_Verified, Margin_Cost_Check, Reconciliation_Status, Final_End_Date, Renewal_Status, Notice_Deadline, Owner';
  var CT_TRIES = [
    'select ' + CT_BASE + ' from Contracts where id is not null order by id asc',
    'select id, Name, Account, Counterparty_Type, Contract_Status, Ingest_Status, Ingested_On, Last_Verified, Final_End_Date, Renewal_Status, Notice_Deadline from Contracts where id is not null order by id asc'
  ];
  var DOC_TRIES = [{ q: 'select id, Name, Contract, Parse_Status, Created_Time from Contract_Documents where id is not null order by id asc', parse: true },
    { q: 'select id, Name, Contract, Created_Time from Contract_Documents where id is not null order by id asc', parse: false }];
  var CLAUSE_Q = 'select id, Name, Contract, Status, Clause_Type, Created_Time from Contract_Clauses where id is not null order by id asc';
  var LINE_Q = 'select id, Parent_Id, Line_Status, Line_Verified, Superseded_By, Rate_Type, Rate_Device, Source_Ref from Rate_Lines where id is not null order by id asc';
  var drawerClick = null;
  var state = { demo: false, data: { contracts: [], docs: [], clauses: [], lines: [] }, notes: [], parseAvailable: false, now: Date.now(), scope: 'all', limit: M.REVIEW_LIMIT_DAYS, model: null, lane: null, nx: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }
  function firstThatWorks(tries, apply) {
    var i = 0, last;
    function next() {
      if (i >= tries.length) return Promise.reject(last);
      var t = tries[i++], q = typeof t === 'string' ? t : t.q;
      return J.crm.coqlAll(q).then(function (r) { apply(r, t); }, function (e) { last = e; return next(); });
    }
    return next();
  }

  /* ---------- data ---------- */
  function load() {
    state.now = Date.now(); state.notes = [];
    if (state.demo) { state.data = window.ContractsFlowDemo.make(state.now); state.parseAvailable = true; return Promise.resolve(); }
    var d = { contracts: [], docs: [], clauses: [], lines: [] };
    return Promise.all([
      firstThatWorks(CT_TRIES, function (r, t) { d.contracts = r; if (t === CT_TRIES[1]) state.notes.push('Some Contracts fields (contract type, margin check, reconciliation, owner) could not be read, so the margin step is incomplete.'); })
        .catch(function (e) { throw new Error('Contracts: ' + msg(e)); }),
      firstThatWorks(DOC_TRIES, function (r, t) { d.docs = r; state.parseAvailable = t.parse; }).then(function () {
        if (!state.parseAvailable) state.notes.push('Contract Documents has no Parse Status yet, so unparsed files are not listed.');
      }, function (e) { state.notes.push('Contract Documents could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(CLAUSE_Q).then(function (r) { d.clauses = r; }, function (e) { state.notes.push('Contract Clauses could not be read (' + msg(e) + '), so clauses are not counted.'); }),
      J.crm.coqlAll(LINE_Q).then(function (r) { d.lines = r; }, function (e) { state.notes.push('Rate Lines could not be read (' + msg(e) + '), so rate lines are not counted.'); })
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
      var more = s.length > 1 ? 'Also: ' + s.slice(1, 3).map(function (x) { return x.text; }).join('; ') + (s.length > 3 ? '; and ' + (s.length - 3) + ' more.' : '.') : 'Click it to see the contracts.';
      state.nx.update({ title: s[0].text.charAt(0).toUpperCase() + s[0].text.slice(1) + '.', sub: more, progress: null, button: { label: 'Show them', onClick: function () { selectLane(s[0].lane, true); } } });
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No failed ingests, contracts waiting too long for review, or renewals past due.', progress: 100, button: null });
  }
  function renderHeader() {
    var t = state.model.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' + t.live + ' live contracts (' + t.customers + ' customer, ' + t.vendors + ' vendor).';
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. ' + t.ended + ' ended or ending-no-renewal contracts are left out. Renewal and margin steps cover customer contracts only. A rate line or clause is "waiting" when it is still Proposed; hand-entered lines with no source are not counted. ' +
      'Days left use the Final End date, in Central time; bands match the Renewal Band on the contract. A renewal counts as settled when its status is Signed, Renewed or Not renewing.';
  }
  function columns() {
    return [
      { key: 'title', label: 'Contract', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
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
    J.table({ mount: '#lane-table', columns: columns(), rows: shown(l), caption: l.label, onRowClick: detail, empty: { title: 'Nothing here', hint: l.hint || 'No contracts in this step.' } });
  }
  function selectLane(id, scroll) { state.lane = id; renderFlow(); renderLane(); if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  function recompute() {
    state.model = M.build(state.data, state.now, { scope: state.scope, reviewLimit: state.limit, parseAvailable: state.parseAvailable });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 'r-needs';
    scopeButtons(); renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- the path for one contract ---------- */
  function openRecord(entity, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: entity, RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function it(title, meta, extra) { return '<div class="it"><b>' + J.esc(title) + '</b>' + (meta ? '<div class="meta">' + J.esc(meta) + '</div>' : '') + (extra ? '<div>' + extra + '</div>' : '') + '</div>'; }
  function pathHtml(t) {
    var c = t.contract;
    if (!c) return '<ol class="chain"><li><div class="lh">Not linked</div><div class="none">This record is not linked to a contract.</div></li></ol>';
    var failed = c.docs.filter(function (d) { return d.parse === 'Failed'; }).length;
    var packet = c.docs.length ? it(plural(c.docs.length, 'file'), c.docs.slice(0, 3).map(function (d) { return d.name; }).join(', ') + (c.docs.length > 3 ? ' and more' : '') + (failed ? '. ' + failed + ' could not be parsed.' : '')) : '<div class="none">No files added.</div>';
    var read = it(c.ingest, c.ingestedMs ? 'Read ' + when(c.ingestedMs) + (c.ingestAge != null ? ' (' + plural(c.ingestAge, 'day') + ' ago)' : '') : 'Not read yet');
    var review = it(plural(c.pendingLines, 'rate line') + ' and ' + plural(c.pendingClauses, 'clause') + ' waiting', [plural(c.verifiedLines, 'line') + ' verified', plural(c.confirmedClauses, 'clause') + ' confirmed', c.verifiedMs ? 'Last verified ' + when(c.verifiedMs) : 'Never verified'].join(' · '),
      btn('open-contract', c.id, 'Open contract'));
    var margin = c.cp === 'Vendor' ? '<div class="none">Vendor contract: no margin check.</div>' : it(c.margin || 'Check has not run', c.recon ? 'Reconciliation: ' + c.recon : 'No reconciliation result');
    var renew = c.cp === 'Vendor' ? '<div class="none">Vendor contract: not part of the renewal step.</div>' : it(c.days == null ? 'No end date' : c.band + (c.days < 0 ? '' : ', ' + plural(c.days, 'day') + ' left'), [c.renewal ? 'Renewal: ' + c.renewal : 'Renewal status not set', c.endDate ? 'Ends ' + c.endDate : '', c.noticeDays != null ? (c.noticeDays < 0 ? 'Notice date passed' : 'Notice in ' + plural(c.noticeDays, 'day')) : ''].filter(Boolean).join(' · '));
    var acct = t.account ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b>' + (t.account.id ? '<div>' + btn('open-account', t.account.id, 'Open account').trim() + '</div>' : '') + '</div>' : '<div class="none">No account (vendor contract).</div>';
    return '<ol class="chain"><li><div class="lh">Packet in</div>' + packet + '</li><li><div class="lh">Read</div>' + read + '</li><li><div class="lh">Reviewed</div>' + review + '</li>' +
      '<li><div class="lh">Margin checked</div>' + margin + '</li><li><div class="lh">Renewal</div>' + renew + '</li><li><div class="lh">Account</div>' + acct + '</li></ol>';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function detail(item) {
    var t = M.trace(state.model, item);
    var title = item.title;
    if (!t.contract) { J.drawer.open({ title: title, html: '<p>' + J.esc(item.note || 'This record is not linked to a contract.') + '</p><div class="drawer-actions"><button type="button" class="btn" data-a="' + (item.kind === 'doc' ? 'open-doc' : 'open-clause') + '" data-id="' + J.esc(item.id) + '">Open record</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: title, html: pathHtml(t), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
      var map = { 'open-contract': 'Contracts', 'open-account': 'Accounts', 'open-doc': 'Contract_Documents', 'open-clause': 'Contract_Clauses' };
      if (map[a]) openRecord(map[a], id);
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#scope').addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (!b) return; state.scope = b.getAttribute('data-s'); recompute(); });
    $('#lim').addEventListener('change', function (e) { var v = parseInt(e.target.value, 10); if (isFinite(v) && v >= 1) { state.limit = v; recompute(); } else e.target.value = state.limit; });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows each contract from the packet to renewal. Nothing here changes a record.</p>' +
      '<p><b>1 Packet in.</b> Contracts that have files, live contracts with nothing to read, files not linked to any contract, and files that could not be parsed.</p>' +
      '<p><b>2 Read.</b> Where the ingest is: Backlog (with files first, since those can be read now), Not ingested, Failed, Needs review. "Needs review for too long" uses the review limit above (14 days to start; change it to suit).</p>' +
      '<p><b>3 Reviewed.</b> Rate lines and clauses still Proposed, contracts where every item has been decided but the contract still says Needs review, contracts read with nothing found, and contracts marked Ingested that still have items waiting or were never verified.</p>' +
      '<p><b>4 Margin checked.</b> The vendor cost check result on each customer contract, the contracts that were ingested but never checked, and reconciliation results that need a person.</p>' +
      '<p><b>5 Renewal.</b> Customer contracts past the end date and not renewed, ending within 30 days, ending in 31 to 90 days, past the notice date, under way, and without an end date.</p>' +
      '<p>Click a step to list its contracts, then a contract to see its path. Use All, Customers or Vendors to narrow the page. Ended contracts are left out.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load contracts.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
