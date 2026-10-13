/* Relationships flow widget v2. Uses jpk v1.1.0 and RelFlowModel; with no Zoho SDK it uses RelFlowDemo.
   Read-only: COQL reads of Accounts, Contacts, Deals (Opportunities), Calls, Events (Meetings), Support Emails and Contracts. Nothing is written. */
(function () {
  'use strict';
  var M = window.RelFlowModel, J = window.JPK;
  var YEAR_AGO = function () { return new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) + 'T00:00:00+00:00'; };
  var AC_TRIES = [
    'select id, Account_Name, Account_Type, Owner, Last_Touch, Health_Tier, Customer_Health, Former_Customer, Open_Cases from Accounts where id is not null order by id asc',
    'select id, Account_Name, Account_Type, Owner, Last_Touch, Health_Tier, Customer_Health, Former_Customer from Accounts where id is not null order by id asc',
    'select id, Account_Name, Account_Type, Owner from Accounts where id is not null order by id asc'
  ];
  var CO_TRIES = [
    'select id, Full_Name, Title, Email, Account_Name, Stock_Alert_Recipient, Email_Opt_Out, Last_Activity_Time, Owner from Contacts where id is not null order by id asc',
    'select id, Full_Name, Title, Email, Account_Name, Last_Activity_Time, Owner from Contacts where id is not null order by id asc'
  ];
  var DL_TRIES = [
    'select id, Deal_Name, Account_Name, Contact_Name, Stage, Closing_Date, Next_Step, Last_Activity_Time, Amount, Pipeline, Owner from Deals where id is not null order by id asc',
    'select id, Deal_Name, Account_Name, Contact_Name, Stage, Closing_Date, Next_Step, Last_Activity_Time, Owner from Deals where id is not null order by id asc'
  ];
  var CT_Q = "select id, Name, Account, Counterparty_Type, Contract_Status, Final_End_Date, Renewal_Status from Contracts where Counterparty_Type = 'Customer' order by id asc";
  function touchQs() {
    var since = YEAR_AGO();
    return {
      calls: "select id, What_Id, Who_Id, Call_Start_Time from Calls where Call_Start_Time >= '" + since + "' order by id asc",
      meetings: "select id, What_Id, Who_Id, Start_DateTime from Events where Start_DateTime >= '" + since + "' order by id asc",
      emails: "select id, Account, Contact, Received_At, Direction, Topic, Intake_Result from Support_Emails where (Received_At >= '" + since + "' and Account is not null) order by id asc"
    };
  }
  var TOUCH_LABEL = { calls: 'Calls', meetings: 'Meetings', emails: 'Support emails' };
  var drawerClick = null;
  var state = { demo: false, data: { accounts: [], contacts: [], deals: [] }, notes: [], now: Date.now(), scope: 'mine', userId: null, model: null, lane: null, nx: null, fellBack: false };

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
  function currentUser() {
    try {
      if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.CONFIG && ZOHO.CRM.CONFIG.getCurrentUser) {
        return ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; return u ? String(u.id) : null; }, function () { return null; });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(null);
  }

  /* ---------- data ---------- */
  function load() {
    state.now = Date.now(); state.notes = [];
    if (state.demo) { state.data = window.RelFlowDemo.make(state.now); state.userId = state.data.userId; return Promise.resolve(); }
    var d = { accounts: [], contacts: [], deals: [], calls: [], meetings: [], emails: [], contracts: [] }, tq = touchQs();
    return Promise.all([
      currentUser().then(function (id) { state.userId = id; if (!id) state.notes.push('Could not tell who you are, so Mine is not available.'); }),
      firstThatWorks(AC_TRIES, function (r, i) { d.accounts = r; if (i === 1) state.notes.push('Open Cases could not be read.'); if (i === 2) state.notes.push('Health and logged touch fields could not be read.'); })
        .catch(function (e) { throw new Error('Accounts: ' + msg(e)); }),
      firstThatWorks(CO_TRIES, function (r, i) { d.contacts = r; if (i === 1) state.notes.push('Stock alert recipient could not be read.'); })
        .catch(function (e) { state.notes.push('Contacts could not be read (' + msg(e) + ').'); }),
      firstThatWorks(DL_TRIES, function (r, i) { d.deals = r; if (i === 1) state.notes.push('Opportunity Amount could not be read.'); })
        .catch(function (e) { state.notes.push('Opportunities could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(CT_Q).then(function (r) { d.contracts = r; }, function (e) { state.notes.push('Contracts could not be read (' + msg(e) + '), so the renewal step is empty.'); })
    ].concat(Object.keys(tq).map(function (k) {
      return J.crm.coqlAll(tq[k]).then(function (r) { d[k] = r; }, function (e) { state.notes.push(TOUCH_LABEL[k] + ' could not be read (' + msg(e) + '), so last touch may be older than it really is.'); });
    }))).then(function () { state.data = d; });
  }

  /* ---------- render ---------- */
  function scopeButtons() {
    $('#scope').innerHTML = M.SCOPES.map(function (s) {
      var off = s.id === 'mine' && !state.userId;
      return '<button type="button" data-s="' + s.id + '" aria-pressed="' + (s.id === state.scope) + '"' + (off ? ' disabled title="Could not tell who you are"' : '') + '>' + J.esc(s.label) + '</button>';
    }).join('');
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
    var c = m.cleanup, box = $('#cleanup'), open = box.open;
    box.innerHTML = '<summary><span class="cu-t">Clean-up list</span><span class="cu-s">' + J.esc(plural(c.total, 'record')) + ' to fix across everyone\'s accounts. Owner: ' + J.esc(c.owner) + '. Not part of anyone\'s daily follow-up.</span></summary>' +
      '<div class="cu-lanes">' + c.lanes.map(function (id) { return laneButton(m.lanes[id]); }).join('') + '</div>';
    box.open = open || (m.lanes[state.lane] && m.lanes[state.lane].cleanup) || false;
  }
  function renderStrip() {
    var s = state.model.stuck, who = state.scope === 'mine' ? 'your accounts' : 'these accounts';
    if (s.length) {
      var more = s.length > 1 ? 'Also: ' + s.slice(1, 3).map(function (x) { return x.text; }).join('; ') + (s.length > 3 ? '; and ' + (s.length - 3) + ' more.' : '.') : 'Click it to see the records.';
      state.nx.update({ title: s[0].text.charAt(0).toUpperCase() + s[0].text.slice(1) + '.', sub: more, progress: null, button: { label: 'Show them', onClick: function () { selectLane(s[0].lane, true); } } });
    } else state.nx.update({ title: 'Nothing to follow up on ' + who + '.', sub: 'No overdue opportunities, contracts ending unrenewed, at-risk customers or cold accounts.', progress: 100, button: null });
  }
  function renderHeader() {
    var t = state.model.totals, sc = M.SCOPES.filter(function (s) { return s.id === state.scope; })[0];
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. Showing ' + sc.label.toLowerCase() + ': ' + plural(t.accounts, 'account') + ' (' + t.customers + ' customers, ' + t.prospects + ' prospects), ' + plural(t.openDeals, 'open opportunity', 'open opportunities') + '.';
    $('#foot').textContent = (state.fellBack ? 'You own no accounts yet, so the page opened on Everyone. ' : '') + (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Last touch is the latest call, meeting or customer email in the last 12 months linked to the account, its contacts or its opportunities (or the Last Touch date on the account). Support mailbox emails count both ways; automated, vendor and internal mail does not. ' +
      'Cold means no touch for ' + plural(M.DEFAULTS.touchDays, 'day') + '; an opportunity is idle after ' + plural(M.DEFAULTS.dealIdleDays, 'day') + ' with no activity. Renewal is the soonest end date among the customer\'s live contracts. ' +
      'The clean-up list covers everyone\'s records whichever view you pick. Days use Central time.';
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
    $('#lane-title').textContent = (l.cleanup ? 'Clean-up: ' : 'Step ' + l.stage + ': ') + l.label + ' (' + l.count + ')';
    $('#lane-hint').textContent = l.hint && l.count ? l.hint : '';
    J.table({ mount: '#lane-table', columns: columns(), rows: shown(l), caption: l.label, onRowClick: detail, empty: { title: 'Nothing here', hint: l.hint || 'No records in this list.' } });
  }
  function selectLane(id, scroll) { state.lane = id; renderFlow(); renderLane(); if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  function recompute() {
    state.model = M.build(state.data, state.now, { scope: state.scope, userId: state.userId });
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
    var who = it(a.name, [a.type || 'Type not set', a.former ? 'Former customer' : '', a.ownerName ? 'Owner ' + a.ownerName : ''].filter(Boolean).join(' · '), btn('open-account', a.id, 'Open account and Customer 360'));
    var cs = a.contacts.length ? a.contacts.slice(0, 5).map(function (c) { return it(c.name || 'Unnamed', [c.title, c.email || 'no email', c.alert ? 'stock alerts' : ''].filter(Boolean).join(' · '), btn('open-contact', c.id, 'Open contact')); }).join('') + (a.contacts.length > 5 ? '<div class="meta">and ' + (a.contacts.length - 5) + ' more</div>' : '') : '<div class="none">No contacts linked.</div>';
    var touch = a.touchMs != null ? it(a.touchKind + (a.touchWith ? ' with ' + a.touchWith : ''), [when(a.touchMs), plural(a.touchDays, 'day') + ' ago', a.tier ? 'Health ' + a.tier : '', a.health].filter(Boolean).join(' · ')) : '<div class="none">No call, meeting or customer email in the last 12 months.</div>';
    var ds = a.deals.length ? a.deals.map(function (d) { return it(d.name || 'Opportunity', [d.stage, d.amount != null ? M.money(d.amount) : '', d.closingDays == null ? 'no close date' : d.closingDays < 0 ? 'close date passed ' + plural(-d.closingDays, 'day') + ' ago' : 'closes in ' + plural(d.closingDays, 'day'), d.nextStep ? 'Next: ' + d.nextStep : 'no next step'].filter(Boolean).join(' · '), btn('open-deal', d.id, 'Open opportunity')); }).join('') : '<div class="none">No opportunities.</div>';
    var r = a.renewal, ren;
    if (a.type !== 'Customer' || a.former) ren = '<div class="none">Renewal is tracked for current customers only.</div>';
    else if (!r) ren = '<div class="none">No live customer contract with an end date' + (a.contracts.length ? ' (' + plural(a.contracts.length, 'contract') + ' on file, all ended or not renewing)' : '') + '.</div>';
    else ren = it(r.name, [r.days < 0 ? 'Ended ' + plural(-r.days, 'day') + ' ago' : 'Ends ' + M.dayIso(r.endDay) + ', in ' + plural(r.days, 'day'), 'Renewal ' + (r.renewalStatus || 'status not set'), r.days >= 0 && r.days <= 90 && !a.deals.some(function (d) { return !d.closed; }) ? 'No open opportunity' : ''].filter(Boolean).join(' · '), btn('open-contract', r.id, 'Open contract'));
    return '<ol class="chain"><li><div class="lh">Account</div>' + who + '</li><li><div class="lh">Contacts</div>' + cs + '</li><li><div class="lh">Last touch</div>' + touch + '</li><li><div class="lh">Opportunities</div>' + ds + '</li><li><div class="lh">Renewal (from contracts)</div>' + ren + '</li></ol>';
  }
  function detail(item) {
    var t = M.trace(state.model, item), openA = { contact: 'open-contact', deal: 'open-deal' }[item.kind];
    if (!t.account) { J.drawer.open({ title: item.title, html: '<p>' + J.esc(item.note || 'This record is not linked to an account.') + '</p><div class="drawer-actions"><button type="button" class="btn" data-a="' + openA + '" data-id="' + J.esc(item.id) + '">Open record to fix it</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: item.title, html: pathHtml(t), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var map = { 'open-account': 'Accounts', 'open-contact': 'Contacts', 'open-deal': 'Deals', 'open-contract': 'Contracts' }, a = b.getAttribute('data-a');
      if (map[a]) openRecord(map[a], b.getAttribute('data-id'));
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Account', entity: 'Accounts' }, { label: 'New Contact', entity: 'Contacts' }, { label: 'New Opportunity', entity: 'Deals' }, { label: 'New Task', entity: 'Tasks' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('.wrap').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#scope').addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (!b || b.disabled) return; state.scope = b.getAttribute('data-s'); state.fellBack = false; state.lane = null; recompute(); });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>Start here each day. The bar at the top names the most urgent follow-up on your accounts; click <b>Show them</b>. Nothing on this page changes a record.</p>' +
      '<p><b>Mine</b> shows accounts you own and opportunities you own. <b>Everyone</b>, <b>Customers</b> and <b>Prospects</b> widen or narrow the view.</p>' +
      '<p><b>1 Accounts.</b> Customers, prospects, other types and former customers.</p>' +
      '<p><b>2 Last touch.</b> The latest call, meeting or customer email linked to the account, its contacts or its opportunities. Cold means nothing for ' + plural(M.DEFAULTS.touchDays, 'day') + '. Log a call or meeting in Zoho and the account clears on the next refresh.</p>' +
      '<p><b>3 Opportunities.</b> Past the close date, idle for over ' + plural(M.DEFAULTS.dealIdleDays, 'day') + ', no next step or no contact, plus won and lost.</p>' +
      '<p><b>4 Renewal.</b> From the customer\'s contracts: the soonest end date among live contracts, and whether its renewal has started.</p>' +
      '<p><b>Clean-up list.</b> Missing account types, contacts with no account or email, customers with no contact or no live contract. It covers everyone\'s records and is owned by ' + J.esc(M.DEFAULTS.cleanupOwner) + ', so it stays out of daily follow-up.</p>' +
      '<p>Click a record to see its path, then <b>Open account and Customer 360</b> to see the whole customer.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () {
      if (!state.userId && state.scope === 'mine') state.scope = 'all';
      if (!manual && state.scope === 'mine') {
        var probe = M.build(state.data, state.now, { scope: 'mine', userId: state.userId });
        if (!probe.totals.mine) { state.scope = 'all'; state.fellBack = true; }
      }
      recompute(); if (manual) J.toast('Refreshed');
    }, function (e) {
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
