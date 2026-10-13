/* Relationships flow widget. Uses jpk v1.1.0 and RelFlowModel; with no Zoho SDK it uses RelFlowDemo.
   Read-only: COQL reads of Accounts, Contacts and Deals (Opportunities). Nothing is written. */
(function () {
  'use strict';
  var M = window.RelFlowModel, J = window.JPK;
  var AC_TRIES = [
    'select id, Account_Name, Account_Type, Owner, Touch_Status, Last_Touch, Days_Since_Touch, Health_Tier, Customer_Health, Renewal_Date, Renewal_Amount, Former_Customer, Open_Cases from Accounts where id is not null order by id asc',
    'select id, Account_Name, Account_Type, Owner, Touch_Status, Last_Touch, Health_Tier, Customer_Health, Renewal_Date, Renewal_Amount, Former_Customer from Accounts where id is not null order by id asc',
    'select id, Account_Name, Account_Type, Owner, Renewal_Date from Accounts where id is not null order by id asc'
  ];
  var CO_TRIES = [
    'select id, Full_Name, Title, Email, Account_Name, Stock_Alert_Recipient, Email_Opt_Out, Last_Activity_Time, Owner from Contacts where id is not null order by id asc',
    'select id, Full_Name, Title, Email, Account_Name, Last_Activity_Time, Owner from Contacts where id is not null order by id asc'
  ];
  var DL_TRIES = [
    'select id, Deal_Name, Account_Name, Contact_Name, Stage, Closing_Date, Next_Step, Last_Activity_Time, Amount, Pipeline, Owner from Deals where id is not null order by id asc',
    'select id, Deal_Name, Account_Name, Contact_Name, Stage, Closing_Date, Next_Step, Last_Activity_Time, Owner from Deals where id is not null order by id asc'
  ];
  var drawerClick = null;
  var state = { demo: false, data: { accounts: [], contacts: [], deals: [] }, notes: [], now: Date.now(), scope: 'all', touch: M.DEFAULTS.touchDays, idle: M.DEFAULTS.dealIdleDays, model: null, lane: null, nx: null };

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
    if (state.demo) { state.data = window.RelFlowDemo.make(state.now); return Promise.resolve(); }
    var d = { accounts: [], contacts: [], deals: [] };
    return Promise.all([
      firstThatWorks(AC_TRIES, function (r, i) { d.accounts = r; if (i === 1) state.notes.push('Open Cases could not be read.'); if (i === 2) state.notes.push('Touch, health and renewal amount fields could not be read, so the touch step is limited.'); })
        .catch(function (e) { throw new Error('Accounts: ' + msg(e)); }),
      firstThatWorks(CO_TRIES, function (r, i) { d.contacts = r; if (i === 1) state.notes.push('Stock alert recipient could not be read.'); })
        .catch(function (e) { state.notes.push('Contacts could not be read (' + msg(e) + '), so contact steps are empty.'); }),
      firstThatWorks(DL_TRIES, function (r, i) { d.deals = r; if (i === 1) state.notes.push('Opportunity Amount and Pipeline could not be read.'); })
        .catch(function (e) { state.notes.push('Opportunities could not be read (' + msg(e) + ').'); })
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
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No overdue opportunities, missed renewals, customers without contacts or cold accounts.', progress: 100, button: null });
  }
  function renderHeader() {
    var t = state.model.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' + t.accounts + ' accounts (' + t.customers + ' customers, ' + t.prospects + ' prospects), ' + t.contacts + ' contacts, ' + t.openDeals + ' open opportunities.';
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Customers are accounts of type Customer that are not marked Former customer. The touch step covers customers and prospects. Cold means marked Cold or no touch for longer than the box above. ' +
      'An opportunity is closed when its stage starts with Closed or is Dead Contact. Renewal uses the date on the account; contract-level renewals are in the Contracts flow. Days use Central time.';
  }
  function columns() {
    return [
      { key: 'title', label: 'Record', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.kind === 'account' ? '' : (i.accountName ? J.esc(i.accountName) : '<span class="muted">None</span>'); } },
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
    state.model = M.build(state.data, state.now, { scope: state.scope, touchDays: state.touch, dealIdleDays: state.idle });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 'a-cust';
    scopeButtons(); renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- the path for one record ---------- */
  function openRecord(entity, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: entity, RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function it(title, meta, extra) { return '<div class="it"><b>' + J.esc(title) + '</b>' + (meta ? '<div class="meta">' + J.esc(meta) + '</div>' : '') + (extra ? '<div>' + extra + '</div>' : '') + '</div>'; }
  function pathHtml(t) {
    var a = t.account;
    if (!a) return '<ol class="chain"><li><div class="lh">Not linked</div><div class="none">This record is not linked to an account, so there is no path to show.</div></li></ol>';
    var who = it(a.name, [a.type || 'Type not set', a.former ? 'Former customer' : '', a.ownerName ? 'Owner ' + a.ownerName : ''].filter(Boolean).join(' · '), btn('open-account', a.id, 'Open account'));
    var cs = a.contacts.length ? a.contacts.slice(0, 5).map(function (c) { return it(c.name || 'Unnamed', [c.title, c.email || 'no email', c.alert ? 'stock alerts' : ''].filter(Boolean).join(' · '), btn('open-contact', c.id, 'Open contact')); }).join('') + (a.contacts.length > 5 ? '<div class="meta">and ' + (a.contacts.length - 5) + ' more</div>' : '') : '<div class="none">No contacts linked.</div>';
    var touch = a.type === 'Customer' || a.type === 'Prospect' ? it(a.touch || 'No touch status', [a.touchDays != null ? plural(a.touchDays, 'day') + ' since last touch' : 'No touch logged', a.tier ? 'Health ' + a.tier : '', a.health].filter(Boolean).join(' · ')) : '<div class="none">Touch is tracked for customers and prospects only.</div>';
    var ds = a.deals.length ? a.deals.map(function (d) { return it(d.name || 'Opportunity', [d.stage, d.amount != null ? M.money(d.amount) : '', d.closingDays == null ? 'no close date' : d.closingDays < 0 ? 'close date passed ' + plural(-d.closingDays, 'day') + ' ago' : 'closes in ' + plural(d.closingDays, 'day'), d.nextStep ? 'Next: ' + d.nextStep : 'no next step'].filter(Boolean).join(' · '), btn('open-deal', d.id, 'Open opportunity')); }).join('') : '<div class="none">No opportunities.</div>';
    var ren = a.type === 'Customer' && !a.former ? it(a.renewalDays == null ? 'No renewal date' : a.renewalDays < 0 ? 'Date passed ' + plural(-a.renewalDays, 'day') + ' ago' : 'Renews in ' + plural(a.renewalDays, 'day'), [a.renewalAmount != null ? M.money(a.renewalAmount) : '', a.renewalDays != null && a.renewalDays <= 90 && !a.deals.some(function (d) { return !d.closed; }) ? 'No open opportunity' : ''].filter(Boolean).join(' · ')) : '<div class="none">Renewal is tracked for customers only.</div>';
    return '<ol class="chain"><li><div class="lh">Account</div>' + who + '</li><li><div class="lh">Contacts</div>' + cs + '</li><li><div class="lh">Last touch</div>' + touch + '</li><li><div class="lh">Opportunities</div>' + ds + '</li><li><div class="lh">Renewal</div>' + ren + '</li></ol>';
  }
  function detail(item) {
    var t = M.trace(state.model, item), openA = { contact: 'open-contact', deal: 'open-deal' }[item.kind];
    if (!t.account) { J.drawer.open({ title: item.title, html: '<p>' + J.esc(item.note || 'This record is not linked to an account.') + '</p><div class="drawer-actions"><button type="button" class="btn" data-a="' + openA + '" data-id="' + J.esc(item.id) + '">Open record</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: item.title, html: pathHtml(t), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var map = { 'open-account': 'Accounts', 'open-contact': 'Contacts', 'open-deal': 'Deals' }, a = b.getAttribute('data-a');
      if (map[a]) openRecord(map[a], b.getAttribute('data-id'));
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function limitBox(sel, key) {
    $(sel).addEventListener('change', function (e) { var v = parseInt(e.target.value, 10); if (isFinite(v) && v >= 1) { state[key] = v; recompute(); } else e.target.value = state[key]; });
  }
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Account', entity: 'Accounts' }, { label: 'New Contact', entity: 'Contacts' }, { label: 'New Opportunity', entity: 'Deals' }, { label: 'New Task', entity: 'Tasks' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#scope').addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (!b) return; state.scope = b.getAttribute('data-s'); recompute(); });
    limitBox('#lim-touch', 'touch'); limitBox('#lim-deal', 'idle');
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows each account from who they are to renewal. Nothing here changes a record.</p>' +
      '<p><b>1 Accounts.</b> Customers, prospects, accounts with no type, other types and former customers.</p>' +
      '<p><b>2 Contacts.</b> Customers with no contact, contacts linked to no account, contacts with no email, and customers with no stock alert recipient.</p>' +
      '<p><b>3 Last touch.</b> Accounts touched recently, gone cold (marked Cold or past the first limit box), never touched, and customers marked at risk.</p>' +
      '<p><b>4 Opportunities.</b> Open opportunities past the close date, idle past the second limit box, with no next step, no contact or no account, plus won and lost.</p>' +
      '<p><b>5 Renewal.</b> Customers whose account renewal date has passed, falls within 30 or 90 days, has no date, or has no open opportunity while renewal is close.</p>' +
      '<p>Click a step to list its records, then a record to see the account path. Use All, Customers or Prospects to narrow the page.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load accounts.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
