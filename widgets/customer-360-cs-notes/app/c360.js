/* Customer 360 widget. Read-only: COQL lookups only, no writes, no network beyond the Zoho SDK, no AI calls. */
(function () {
  'use strict';
  var M = window.C360, esc = JPK.esc, $ = function (id) { return document.getElementById(id); };
  var state = { demo: false, accountId: null, today: null, tables: {}, nx: null, data: null };

  /* ---------- queries (all read-only; verify list in STATUS.md) ---------- */
  function q(id) {
    id = String(id).replace(/[^0-9]/g, '');       /* Zoho ids are numeric; strips anything else */
    return {
      account: "select id, Account_Name, Owner, Account_Type, Health_Tier, Health_Score, Customer_Health, Touch_Status, Days_Since_Touch, Last_Touch, Renewal_Date, Renewal_Amount, Former_Customer, Phone, Website from Accounts where id = '" + id + "'",
      contracts: "select id, Name, Counterparty_Type, Contract_Type, Contract_Status, Renewal_Band, Days_to_Final_End, Final_End_Date, Contract_End_Date, Renewal_Status, Notice_Deadline, Owner from Contracts where Account = '" + id + "'",
      cases: "select id, Case_Number, Subject, Status, Priority, Created_Time, Case_Age_days, Owner from Cases where Account_Name = '" + id + "'",
      onboarding: "select id, Status, Phase, Risk, Go_live_Target, Go_live_Actual, Blocked_Reason, Overdue_Tasks from Customer_Onboarding where Account = '" + id + "'",
      tasks: "select id, Subject, Status, Due_Date, Gate, Onboarding_Phase, Owner from Tasks where What_Id = '" + id + "' and Onboarding_Phase is not null",
      contacts: "select id, First_Name, Last_Name, Full_Name, Title, Email, Phone, Mobile, Last_Activity_Time, Last_Inbound_Email, Stock_Alert_Recipient, Receives_Collections from Contacts where Account_Name = '" + id + "'",
      /* 13 Oct 2026: notes CS titled "CS: ..." on this account (front-door spec) */
      csnotes: "select id, Note_Title, Note_Content, Created_Time, Created_By.first_name, Created_By.last_name from Notes where (Parent_Id = '" + id + "' and Note_Title like 'CS:%') order by Created_Time desc limit 3"
    };
  }
  function todayStr() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDate(s) {
    var t = M.parseDate(s); if (t == null) return '';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function openRecord(entity, id) {
    if (state.demo || !id || !(window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Record)) { JPK.toast(state.demo ? 'Opens the record in Zoho CRM' : 'Could not open that record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: entity, RecordID: id });
  }

  /* ---------- load ---------- */
  function loadLive(id) {
    var qs = q(id), out = { errors: {} };
    var keys = Object.keys(qs);
    return Promise.all(keys.map(function (k) {
      return JPK.crm.coqlAll(qs[k]).then(function (rows) { out[k] = rows; }, function (e) {
        out[k] = []; out.errors[k] = e && e.message ? e.message : 'Could not load';
      });
    })).then(function () { out.account = (out.account || [])[0] || null; return out; });
  }
  function loadDemo(id) {
    var d = window.C360_DEMO.data[id] || window.C360_DEMO.data['demo-1'];
    return Promise.resolve({ account: d.account, contracts: d.contracts, cases: d.cases, onboarding: d.onboarding, tasks: d.tasks, contacts: d.contacts, csnotes: d.csnotes || [], errors: {} });
  }
  function show(id) {
    state.accountId = id;
    $('body').hidden = true;
    $('acctName').textContent = 'Loading account\u2026';
    (state.demo ? loadDemo(id) : loadLive(id)).then(function (raw) {
      if (!raw.account) { fail('We could not find that account, or you do not have access to it.'); return; }
      state.data = M.build(raw, state.today);
      state.errors = raw.errors;
      render(state.data, raw.errors);
      renderCS(raw.csnotes || [], raw.errors && raw.errors.csnotes);
    }, function (e) { fail(e && e.message || 'Could not load this account.'); });
  }
  /* Latest from CS: newest CS note in full, up to two earlier ones shortened. A 204 (no rows) is not an error. */
  function renderCS(rows, err) {
    var box = $('csNotes'); if (!box) return;
    if (err && !/204|no content|empty/i.test(err)) { box.innerHTML = '<div class="err">CS notes did not load: ' + esc(err) + '</div>'; $('cnCS').textContent = ''; return; }
    if (!rows.length) { box.innerHTML = '<div class="muted">No CS notes on this account yet. CS shares news by adding a note titled \u201cCS: \u2026\u201d to the account.</div>'; return; }
    box.innerHTML = rows.slice(0, 3).map(function (n, i) {
      var t = String(n.Note_Title || '').replace(/^\s*CS\s*:\s*/i, '') || 'CS note';
      var by = [n['Created_By.first_name'], n['Created_By.last_name']].filter(Boolean).join(' ');
      var body = String(n.Note_Content || '').replace(/<[^>]+>/g, ' ').trim(); if (i > 0 && body.length > 160) body = body.slice(0, 159).trim() + '\u2026';
      return '<div class="cs-n' + (i ? '' : ' first') + '"><span class="cs-t">' + esc(t) + '</span><span class="cs-m">' + esc(fmtDate(n.Created_Time) + (by ? ' \u00b7 ' + by : '')) + '</span><div class="cs-b">' + esc(body) + '</div></div>';
    }).join('');
  }
  function fail(msg) {
    $('acctName').textContent = 'Customer 360';
    $('next').innerHTML = '<div class="card err-card" role="alert"><b>Could not load this customer.</b><div class="err">' + esc(msg) + '</div></div>';
  }

  /* ---------- render ---------- */
  function fact(label, html) { return '<div class="fact"><small>' + esc(label) + '</small><span>' + html + '</span></div>'; }
  function healthTone(t) { return t === 'Green' ? 'good' : t === 'Yellow' ? 'warn' : t === 'Red' ? 'bad' : 'neutral'; }
  function custHealthTone(t) { return t === 'Healthy' ? 'good' : t === 'Monitor' ? 'warn' : t === 'At Risk' || t === 'Critical' ? 'bad' : 'neutral'; }

  function render(d, errors) {
    var a = d.account, s = d.summary;
    errors = errors || {};
    document.title = 'Customer 360: ' + a.name;
    $('acctName').textContent = a.name;
    var f = '';
    if (a.type) f += fact('Account type', esc(a.type));
    if (a.owner) f += fact('Account owner', esc(a.owner));
    f += fact('Health', a.healthTier ? JPK.chip(a.healthTier + (a.healthScore != null ? ' (' + a.healthScore + ')' : ''), healthTone(a.healthTier)) : '<span class="muted">Not scored</span>');
    if (a.customerHealth) f += fact('Customer health', JPK.chip(a.customerHealth, custHealthTone(a.customerHealth)));
    f += fact('Last contact', a.touch ? esc(a.touch) + (a.daysSinceTouch != null ? ' <span class="muted sm">(' + esc(a.daysSinceTouch) + ' days)</span>' : '') : '<span class="muted">Unknown</span>');
    $('facts').innerHTML = f;
    $('openAcct').hidden = state.demo;

    /* next strip */
    var btn = s.renewal && s.renewal.id ? { label: 'Open renewal contract', onClick: function () { openRecord('Contracts', s.renewal.id); } } : null;
    var cfg = { mount: '#next', title: s.headline, sub: s.sub, button: btn };
    if (state.nx) state.nx.update(cfg); else state.nx = JPK.next(cfg);

    /* tiles */
    var t = s.tiles, r = s.renewal;
    function tile(label, big, sub, tone, txt) {
      return '<div class="tile ' + (tone || '') + '"><small>' + esc(label) + '</small><b' + (txt ? ' class="txt"' : '') + '>' + esc(big) + '</b><i>' + esc(sub || '') + '</i></div>';
    }
    $('tiles').innerHTML =
      tile('Active contracts', t.liveContracts, 'of ' + t.totalContracts + ' on file', '') +
      tile('Renewal', r ? (r.days != null ? (r.days < 0 ? (-r.days) + ' days past' : r.days + ' days') : 'No date') : 'No renewal date', r ? (r.band ? r.band + ' \u00b7 ' : '') + fmtDate(r.end) : 'No active contract dates', r ? r.tone : '', !r) +
      tile('Open cases', t.openCases, t.highCases ? t.highCases + ' high priority' : 'None high priority', t.highCases ? 'warn' : t.openCases ? '' : 'good') +
      tile('Onboarding', t.onboarding.replace(/^Onboarding:? ?/, '') || t.onboarding, d.onboarding.pct != null ? d.onboarding.done + ' of ' + d.onboarding.total + ' tasks done' : '', d.onboarding.tone === 'neutral' ? '' : d.onboarding.tone, true) +
      tile('Contacts', t.contacts, '', '');

    renderContracts(d, errors);
    renderCases(d, errors);
    renderOnboarding(d, errors);
    renderContacts(d, errors);

    $('signals').innerHTML = s.signals.map(function (g) { return '<li>' + JPK.chip(g.tone === 'bad' ? 'Act' : g.tone === 'warn' ? 'Watch' : 'Note', g.tone) + '<span>' + esc(g.text) + '</span></li>'; }).join('');
    $('cardSignals').hidden = !s.signals.length;
    $('body').hidden = false;
  }
  function secErr(key, errors, label) {
    return errors[key] ? '<div class="err" role="alert">Could not load ' + esc(label) + ': ' + esc(errors[key]) + '</div>' : '';
  }
  function table(key, opts) {
    if (state.tables[key] && state.tables[key].mountEl === document.querySelector(opts.mount)) { state.tables[key].t.setRows(opts.rows); return; }
    var t = JPK.table(opts);
    state.tables[key] = { t: t, mountEl: document.querySelector(opts.mount) };
  }

  function renderContracts(d, errors) {
    $('ctSub').textContent = d.contracts.length ? 'Soonest end first' : '';
    table('ct', {
      mount: '#tblContracts', caption: 'Contracts for this customer', rows: d.contracts,
      empty: { title: 'No contracts for this customer', hint: errors.contracts ? 'Contracts could not be loaded.' : 'Contracts linked to this account will show here.' },
      onRowClick: function (r) { drawerContract(r); },
      filters: [{ key: 'live', label: 'Active', test: function (r) { return r.live; } }, { key: 'ended', label: 'Ended', test: function (r) { return !r.live; } }],
      filterLabel: 'Contract filter',
      columns: [
        { key: 'name', label: 'Contract', sortable: true, render: function (r) { return '<b>' + esc(r.name) + '</b>' + (r.type ? '<span class="cell-sub">' + esc(r.type) + '</span>' : ''); } },
        { key: 'status', label: 'Status', sortable: true, render: function (r) { return esc(r.status || '-'); } },
        { key: 'band', label: 'Renewal band', render: function (r) { return r.band ? JPK.chip(r.band, r.tone) : '<span class="muted">-</span>'; } },
        { key: 'days', label: 'Time to end', sortable: true, align: 'right', render: function (r) { return esc(r.daysText); } },
        { key: 'end', label: 'Final end', sortable: true, render: function (r) { return esc(fmtDate(r.end) || '-'); } },
        { key: 'renewalStatus', label: 'Renewal', render: function (r) { return esc(r.renewalStatus || '-'); } }
      ]
    });
    var f = $('tblContracts').querySelector('.err'); if (f) f.remove();
    if (errors.contracts) $('tblContracts').insertAdjacentHTML('beforeend', secErr('contracts', errors, 'contracts'));
    state.tables.ct.t.setFilter(d.contracts.some(function (c) { return c.live; }) ? 'live' : 'all');
  }
  function drawerContract(r) {
    JPK.drawer.open({
      title: r.name,
      html: '<dl class="dl"><dt>Status</dt><dd>' + esc(r.status || '-') + '</dd><dt>Type</dt><dd>' + esc(r.type || '-') + '</dd>' +
        '<dt>Renewal band</dt><dd>' + (r.band ? JPK.chip(r.band, r.tone) : '-') + '</dd><dt>Time to end</dt><dd>' + esc(r.daysText) + '</dd>' +
        '<dt>Final end</dt><dd>' + esc(fmtDate(r.end) || '-') + '</dd><dt>Notice deadline</dt><dd>' + esc(fmtDate(r.notice) || '-') + '</dd>' +
        '<dt>Renewal</dt><dd>' + esc(r.renewalStatus || '-') + '</dd><dt>Owner</dt><dd>' + esc(r.owner || '-') + '</dd></dl>' +
        '<button type="button" class="btn pri" id="drOpen">Open contract in CRM</button>',
      onMount: function (b) { b.querySelector('#drOpen').addEventListener('click', function () { openRecord('Contracts', r.id); }); }
    });
  }

  function renderCases(d, errors) {
    var c = d.cases;
    $('csSub').textContent = c.closedCount ? c.closedCount + ' closed earlier' : '';
    table('cs', {
      mount: '#tblCases', caption: 'Open cases for this customer', rows: c.open,
      empty: { title: 'No open cases', hint: errors.cases ? 'Cases could not be loaded.' : 'Nothing is waiting on support for this customer.' },
      onRowClick: function (r) { openRecord('Cases', r.id); },
      columns: [
        { key: 'subject', label: 'Case', render: function (r) { return '<b>' + esc(r.subject) + '</b><span class="cell-sub">' + esc(r.number ? '#' + r.number : '') + '</span>'; } },
        { key: 'status', label: 'Status', sortable: true, render: function (r) { return esc(r.status); } },
        { key: 'priority', label: 'Priority', sortable: true, render: function (r) { return r.priority ? JPK.chip(r.priority, r.priority === 'High' ? 'bad' : 'neutral') : '<span class="muted">-</span>'; } },
        { key: 'age', label: 'Age', sortable: true, align: 'right', render: function (r) { return r.age == null ? '-' : esc(r.age + ' d'); } }
      ]
    });
    var f = $('tblCases').querySelector('.err'); if (f) f.remove();
    if (errors.cases) $('tblCases').insertAdjacentHTML('beforeend', secErr('cases', errors, 'cases'));
  }

  function renderOnboarding(d, errors) {
    var o = d.onboarding, el = $('onb');
    $('obSub').textContent = '';
    if (o.state === 'none') {
      el.innerHTML = '<div class="empty"><b>No onboarding on file</b>This customer has no onboarding plan or onboarding tasks yet.</div>' + secErr('onboarding', errors, 'onboarding') + secErr('tasks', errors, 'onboarding tasks');
      return;
    }
    var h = '<div class="row" style="margin-bottom:8px">' + JPK.chip(o.label, o.tone) + (o.risk ? JPK.chip(o.risk, o.risk === 'On Track' ? 'good' : o.risk === 'At Risk' ? 'warn' : 'bad') : '') + '</div>';
    if (o.pct != null) h += '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + o.pct + '" aria-label="Onboarding tasks done"><i style="width:' + o.pct + '%"></i></div><p class="sm muted">' + o.done + ' of ' + o.total + ' tasks done' + (o.overdue ? ' \u00b7 ' + o.overdue + ' overdue' : '') + (o.gates ? ' \u00b7 ' + o.gates + ' key step' + (o.gates === 1 ? '' : 's') + ' still open' : '') + '</p>';
    if (o.record && o.record.goLive) h += '<p class="sm"><span class="muted">' + (o.record.goLiveActual ? 'Went live' : 'Go-live target') + ':</span> <b>' + esc(fmtDate(o.record.goLive)) + '</b></p>';
    if (o.record && o.record.blocked) h += '<p class="q">' + esc(o.record.blocked) + '</p>';
    if (o.next) h += '<p class="sm"><span class="muted">Next task:</span> <b>' + esc(o.next.subject) + '</b>' + (o.next.due ? ' due ' + esc(fmtDate(o.next.due)) : '') + (o.next.overdue ? ' ' + JPK.chip('Overdue', 'bad') : '') + '</p>';
    el.innerHTML = h + secErr('onboarding', errors, 'onboarding') + secErr('tasks', errors, 'onboarding tasks');
  }

  function renderContacts(d, errors) {
    $('cnSub').textContent = '';
    table('cn', {
      mount: '#tblContacts', caption: 'Contacts for this customer', rows: d.contacts,
      empty: { title: 'No contacts for this customer', hint: errors.contacts ? 'Contacts could not be loaded.' : 'Add a contact from the account page.' },
      onRowClick: function (r) { openRecord('Contacts', r.id); },
      columns: [
        { key: 'name', label: 'Name', sortable: true, render: function (r) { return '<b>' + esc(r.name) + '</b>' + (r.title ? '<span class="cell-sub">' + esc(r.title) + '</span>' : ''); } },
        { key: 'email', label: 'Email', render: function (r) { return r.email ? '<a class="lnk" href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a>' : '<span class="muted">-</span>'; } },
        { key: 'phone', label: 'Phone', render: function (r) { return esc(r.phone || '-'); } },
        { key: 'flags', label: 'Gets', render: function (r) { return r.flags.map(function (x) { return JPK.chip(x, 'info'); }).join(' ') || '<span class="muted">-</span>'; } },
        { key: 'lastActivity', label: 'Last activity', sortable: true, render: function (r) { return esc(fmtDate(r.lastActivity) || '-'); } }
      ]
    });
    var f = $('tblContacts').querySelector('.err'); if (f) f.remove();
    if (errors.contacts) $('tblContacts').insertAdjacentHTML('beforeend', secErr('contacts', errors, 'contacts'));
  }

  /* ---------- account finder (web tab, or demo) ---------- */
  function wireFinder() {
    $('finder').hidden = false;
    $('findForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var term = $('findQ').value.replace(/['\\%]/g, ' ').trim();
      if (term.length < 2) { $('findOut').innerHTML = '<p class="sm muted">Type at least two letters.</p>'; return; }
      $('findOut').innerHTML = '<p class="sm muted">Searching\u2026</p>';
      JPK.crm.coqlAll("select id, Account_Name from Accounts where Account_Name like '%" + term + "%'", { maxPages: 1 }).then(function (rows) {
        $('findOut').innerHTML = rows.length ? rows.slice(0, 20).map(function (r) { return '<button type="button" class="btn" data-id="' + esc(r.id) + '">' + esc(r.Account_Name) + '</button>'; }).join('') : '<p class="sm muted">No accounts match.</p>';
      }, function (er) { $('findOut').innerHTML = '<div class="err" role="alert">' + esc(er.message) + '</div>'; });
    });
    $('findOut').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-id]'); if (!b) return;
      $('finder').hidden = true; show(b.getAttribute('data-id'));
    });
  }

  /* ---------- start ---------- */
  function start(init) {
    state.demo = !!init.demo;
    state.today = state.demo ? window.C360_DEMO.today : todayStr();
    JPK.aboutButton({
      button: '#help', title: 'About Customer 360',
      html: '<p>One page for a customer: their contracts and renewal dates, open support cases, onboarding progress and contacts.</p>' +
        '<p>Renewal bands come from the Contracts record and update every day. This page only reads information; it never changes anything in the CRM.</p>' +
        '<p>Active contracts exclude ended ones. The renewal shown is the soonest end date among contracts that are not ended and not marked as non-renewing.</p>'
    });
    $('refresh').addEventListener('click', function () { if (state.accountId) show(state.accountId); });
    $('openAcct').addEventListener('click', function () { openRecord('Accounts', state.accountId); });

    if (state.demo) {
      var sel = $('demoPick');
      sel.innerHTML = window.C360_DEMO.accounts.map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>'; }).join('');
      sel.hidden = false;
      $('demoBadge').hidden = false; $('demoBadge').innerHTML = JPK.chip('Demo data', 'info');
      sel.addEventListener('change', function () { show(sel.value); });
      show(sel.value);
      return;
    }
    var id = init.EntityId;
    if (Array.isArray(id)) id = id[0];
    if (id) { show(id); return; }
    $('acctName').textContent = 'Pick a customer';
    wireFinder();
  }
  JPK.crm.init().then(start);
})();
