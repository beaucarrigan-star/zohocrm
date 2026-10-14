/* Support flow widget. Uses jpk v1.1.0, TriageModel, FlowModel and, when no Zoho SDK, FlowDemo.
   Read-only: COQL reads of Support_Emails and Cases. Nothing is written. */
(function () {
  'use strict';
  var M = window.FlowModel, J = window.JPK;
  var EMAIL_Q = 'select id, Name, Sender_Email, Sender_Name, Recipient_Email, Topic, Direction, Intake_Result, Source, Received_At, ' +
    'Created_Time, Last_Activity_Time, Account, Case, Thread_Link from Support_Emails where Direction = \'In\' order by id asc';
  /* COQL needs a WHERE clause: "where id is not null" selects every row. Case_Category, Vendor, Vendor_Ticket_Number, Device_Serial,
     Resolution_Category and Case_Origin were read from the live Cases field list on 12 Oct 2026. */
  var CASE_Q = 'select id, Case_Number, Subject, Status, Priority, Created_Time, Case_Age_days, Owner, Account_Name, Case_Category, Case_Origin, ' +
    'Vendor, Vendor_Ticket_Number, Device_Serial, Resolution_Category from Cases where id is not null order by id asc';
  var ORDER_Q = 'select id, Order_Type, Order_Status, Order_Date, Received_Date, Case, Vendor, Account, Reference from Vendor_Orders where id is not null order by id asc';
  var ENTITY = { email: 'Support_Emails', case: 'Cases', account: 'Accounts', order: 'Vendor_Orders' };
  var drawerClick = null;
  var state = { demo: false, emails: [], cases: [], orders: [], ordersNote: '', now: Date.now(), days: 7, model: null, lane: null, nx: null, table: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) {
    if (ms == null) return '';
    return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }

  /* ---------- data ---------- */
  function load() {
    state.now = Date.now();
    state.ordersNote = '';
    if (state.demo) { var d = window.FlowDemo.make(state.now); state.emails = d.emails; state.cases = d.cases; state.orders = d.orders; return Promise.resolve(); }
    return Promise.all([
      /* Vendor Orders is optional: a profile without access, or a missing field, shows a note instead of breaking the page. */
      J.crm.coqlAll(ORDER_Q).then(function (r) { state.orders = r; }, function (e) { state.orders = []; state.ordersNote = 'Vendor Orders could not be read (' + (e && e.message || e) + '), so order status is not shown.'; }),
      J.crm.coqlAll(EMAIL_Q).then(function (r) { state.emails = r; }, function (e) { throw new Error('Support Emails: ' + (e && e.message || e)); }),
      J.crm.coqlAll(CASE_Q).then(function (r) { state.cases = r; }, function (e) { throw new Error('Cases: ' + (e && e.message || e)); })
    ]);
  }

  /* ---------- render ---------- */
  function winButtons() {
    $('#win').innerHTML = M.WINDOWS.map(function (w) {
      var on = (w.days === state.days);
      return '<button type="button" data-w="' + w.id + '" aria-pressed="' + on + '">' + J.esc(w.label) + '</button>';
    }).join('');
  }
  function laneButton(l) {
    var pressed = state.lane === l.id;
    return '<button type="button" class="lane" data-lane="' + J.esc(l.id) + '" aria-pressed="' + pressed + '">' +
      '<span class="ln">' + J.esc(l.label) + (l.hint ? '<small>' + J.esc(l.hint) + '</small>' : '') + '</span>' +
      '<span class="lc' + tone(l.tone) + '">' + l.count + '</span></button>';
  }
  function renderFlow() {
    var m = state.model;
    $('#flow').innerHTML = m.stages.map(function (s) {
      var lanes = s.lanes.map(function (id) { return m.lanes[id]; })
        .filter(function (l) { return !((l.id === 'e-other' || l.id === 'c-other') && l.count === 0); })
        .map(laneButton).join('');
      return '<li class="stage" data-n="' + s.n + '"><h2><span class="n">' + s.n + '</span>' + J.esc(s.title) + '</h2>' +
        '<div class="big">' + (s.big == null ? '&ndash;' : J.esc(s.big)) + '</div><div class="biglab">' + J.esc(s.bigLabel) + '</div>' + lanes + '</li>';
    }).join('');
  }
  function renderTrend() {
    var rows = M.trend({ emails: state.emails, cases: state.cases }, state.now, 6);
    var max = 1; rows.forEach(function (r) { max = Math.max(max, r.requests, r.cases); });
    function bar(n, cls) { return '<span class="tb ' + cls + '" style="width:' + Math.round(100 * n / max) + '%"></span>'; }
    function delta(cur, prev) { return prev == null ? '' : (cur > prev ? ' ▲' : cur < prev ? ' ▼' : ' –'); }
    $('#trend').innerHTML = '<table class="trend"><thead><tr><th>Month</th><th>Requests in</th><th>Became a case</th><th class="r">Share</th><th>Cases opened</th><th class="r">Order cases</th><th class="r">Returns</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var p = i ? rows[i - 1] : null;
        return '<tr' + (r.current ? ' class="cur"' : '') + '><th scope="row">' + J.esc(r.label) + (r.current ? ' <small>so far</small>' : '') + '</th>' +
          '<td><div class="tbar">' + bar(r.requests, 'a') + '<b>' + r.requests + '</b></div></td>' +
          '<td><div class="tbar">' + bar(r.toCase, 'b') + '<b>' + r.toCase + '</b></div></td>' +
          '<td class="r">' + (r.share == null ? '&ndash;' : r.share + '%') + '</td>' +
          '<td><div class="tbar">' + bar(r.cases, 'c') + '<b>' + r.cases + '</b></div></td>' +
          '<td class="r">' + r.orderCases + '</td><td class="r">' + r.rmaCases + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function renderStrip() {
    var m = state.model, s = m.stuck;
    if (s.length) {
      var more = s.length > 1 ? 'Also: ' + s.slice(1, 3).map(function (x) { return x.text; }).join('; ') + (s.length > 3 ? '; and ' + (s.length - 3) + ' more.' : '.') : 'Click it to see the records.';
      state.nx.update({ title: s[0].text.charAt(0).toUpperCase() + s[0].text.slice(1) + '.', sub: more, progress: null,
        button: { label: 'Show them', onClick: function () { selectLane(s[0].lane, true); } } });
    } else {
      state.nx.update({ title: 'Nothing is stuck.', sub: 'No unlinked cases, unacknowledged cases, old emails or escalations in this view.', progress: 100, button: null });
    }
  }
  function renderHeader() {
    var m = state.model, t = m.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) +
      ' (Central). ' + t.inbound + (t.inbound === 1 ? ' inbound email' : ' inbound emails') + ' in this window; ' + t.openCases + (t.openCases === 1 ? ' open case' : ' open cases') + ' (all dates).';
    $('#foot').textContent = (state.ordersNote ? state.ordersNote + ' ' : '') + 'Read-only. Emails follow the window above; open cases are always all open cases. Not counted: ' + t.historical + ' imported history and ' +
      t.outbound + ' outbound emails. Business days skip weekends; holidays are not skipped. To change an email\'s result use Support Triage; to move cases use the Cases list.';
  }

  function columns(kind, laneId, action) {
    if (kind === 'account') {
      return [
        { key: 'title', label: 'Account', sortable: true, sortValue: function (i) { return i.title; }, render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div>'; } },
        { key: 'open', label: 'Open cases', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.openCount; }, render: function (i) { return String(i.openCount); } },
        { key: 'oldest', label: 'Oldest', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.age; }, render: function (i) { return '<span class="age">' + J.esc(i.ageText) + '</span>'; } },
        { key: 'why', label: 'Why', render: function (i) { return J.esc(i.sub); } }
      ];
    }
    var c = [
      { key: 'title', label: kind === 'case' ? 'Case' : 'Subject', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) {
          return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' +
            (laneId === 'e-break' && i.break ? '<div class="note-bad">' + J.esc(i.break) + '</div>' : '') +
            (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : '');
        } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; },
        render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">No account</span>'; } },
      { key: 'when', label: kind === 'case' ? 'Opened' : 'Received', sortable: true, num: true, sortValue: function (i) { return i.ms; }, render: function (i) { return J.esc(when(i.ms)); } },
      { key: 'age', label: 'Age', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.age; }, render: function (i) { return '<span class="age">' + J.esc(i.ageText) + '</span>'; } }
    ];
    if (kind === 'email') c.push({ key: 'case', label: 'Case', sortable: true, sortValue: function (i) { return i.caseNumber || ''; }, render: function (i) { return i.caseNumber ? J.esc(i.caseNumber) : '<span class="muted">None</span>'; } });
    c.push({ key: 'state', label: action ? 'Order or return' : (kind === 'case' ? 'Status' : 'Result'), sortable: true, sortValue: function (i) { return i.state; }, render: function (i) { return J.chip(i.state, i.tone); } });
    return c;
  }
  var FT = null;
  function shown(l) { var r = FT ? FT.filter(l.items) : l.items; if (FT) FT.note(r.length, l.items.length); return r; }
  function renderLane() {
    var m = state.model, l = m.lanes[state.lane];
    if (!l) { $('#lane-title').textContent = 'Pick a step above'; $('#lane-hint').textContent = ''; $('#lane-table').innerHTML = ''; return; }
    $('#lane-title').textContent = 'Step ' + l.stage + ': ' + l.label + ' (' + l.count + ')';
    $('#lane-hint').textContent = l.hint && l.count ? l.hint : '';
    state.table = J.table({ mount: '#lane-table', columns: columns(l.kind, l.id, l.action), rows: shown(l), caption: l.label, onRowClick: detail,
      empty: { title: 'Nothing here', hint: l.id === 'e-break' ? 'Every email marked as a case has a case linked.' : /^x-(gap|recv)$/.test(l.id) ? 'No cases need follow-up here.' : 'No records in this step for the chosen window.' } });
  }
  function selectLane(id, scroll) {
    state.lane = id;
    renderFlow(); renderLane();
    if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function recompute() {
    state.model = M.build({ emails: state.emails, cases: state.cases, orders: state.orders }, state.now, { days: state.days });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 'e-all';
    winButtons(); renderHeader(); renderTrend(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- detail drawer: the path for one record ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the ' + kind + ' record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function emailBlock(e) {
    var tn = e.result === 'Left for review' ? 'warn' : e.result === 'Ignored' ? 'neutral' : e.result === 'Case created' || e.result === 'Added to existing case' ? 'good' : 'info';
    return '<div class="it"><b>' + J.esc(e.subject || '(no subject)') + '</b><div class="meta">' + J.esc(e.senderEmail) + ' &middot; ' + J.esc(when(e.receivedMs)) + '</div>' +
      '<div>' + J.chip(e.result || 'Not set', tn) + ' <button type="button" class="lnk sm" data-a="open-email" data-id="' + J.esc(e.id) + '">Open email</button></div></div>';
  }
  function caseBlock(c) {
    var tn = c.stage === 'escalated' ? 'bad' : c.unacked || c.stale ? 'warn' : c.open ? 'info' : 'good';
    var flags = [];
    if (c.unacked) flags.push(J.chip('Not acknowledged', 'warn'));
    if (c.stale) flags.push(J.chip('Open over ' + M.STALE_CASE_DAYS + ' days', 'warn'));
    if (c.high) flags.push(J.chip('High priority', 'bad'));
    return '<div class="it"><b>' + J.esc((c.number ? c.number + ' ' : '') + c.subject) + '</b>' +
      '<div class="meta">' + J.esc([c.owner ? 'Owner ' + c.owner : '', c.age != null ? c.age + (c.age === 1 ? ' day' : ' days') + ' old' : ''].filter(Boolean).join(' · ')) + '</div>' +
      '<div>' + J.chip(c.status || 'No status', tn) + ' ' + flags.join(' ') + ' <button type="button" class="lnk sm" data-a="open-case" data-id="' + J.esc(c.id) + '">Open case</button></div></div>';
  }
  /* Orders and returns: what the case asked for, and what has happened to it. */
  function actionHtml(t) {
    var c = t.case;
    if (!c) return '<div class="none">Starts once a case exists.</div>';
    var h = '';
    var asks = c.need === 'equipment' ? 'devices' : c.need === 'accessory' ? 'accessories' : '';
    if (asks) {
      h += '<div class="meta">Case category <b>' + J.esc(c.category) + '</b>: this case calls for ' + asks + ' to be ordered.</div>';
      if (t.orders.length) {
        h += t.orders.map(function (o) {
          var tn = o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info';
          return '<div class="it"><b>' + J.esc(o.type + ' order' + (o.vendorName ? ' from ' + o.vendorName : '')) + '</b>' +
            '<div class="meta">' + J.esc([o.reference ? 'Ref ' + o.reference : '', o.orderMs ? 'Ordered ' + when(o.orderMs) : '', o.receivedMs ? 'Received ' + when(o.receivedMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
            '<div>' + J.chip(o.status, tn) + ' <button type="button" class="lnk sm" data-a="open-order" data-id="' + J.esc(o.id) + '">Open order</button></div></div>';
        }).join('');
        if (c.open && t.orders.every(function (o) { return o.status === 'Received'; })) h += '<div class="note-bad">Order received but the case is still open.</div>';
      } else h += '<div class="it"><b>No order recorded</b><div class="meta">Use Order for this customer on the case. The order links back here.</div></div>';
    }
    if (c.rma || c.need === 'device') {
      var bits = [c.vendorName ? 'Vendor ' + c.vendorName : '', c.vendorTicket ? 'Ticket ' + c.vendorTicket : '', c.serial ? 'Serial ' + c.serial : '', c.resolution ? 'Resolution ' + c.resolution : ''].filter(Boolean);
      h += '<div class="it"><b>' + (c.rma ? 'Return or replacement' : 'Device problem') + '</b><div class="meta">' + (bits.length ? J.esc(bits.join(' · ')) : 'No vendor, ticket or serial recorded on the case.') + '</div>' +
        (c.rma ? '' : '<div class="meta">No vendor ticket yet. If the device goes back to the vendor, record the ticket number on the case.</div>') + '</div>';
    }
    if (!h) h = '<div class="none">' + (c.category ? J.esc(c.category) + ': this case does not call for an order or return.' : 'No case category set, so no order or return is expected.') + '</div>';
    return h;
  }
  function pathHtml(t, item) {
    var h = '<ol class="chain">';
    h += '<li><div class="lh">Email' + (t.emails.length > 1 ? ' (' + t.emails.length + ')' : '') + '</div>' +
      (t.emails.length ? t.emails.map(emailBlock).join('') : '<div class="none">No email is linked to this case. It was created another way (phone, web or by hand).</div>') + '</li>';
    h += '<li><div class="lh">Case</div>' +
      (t.case ? caseBlock(t.case) : '<div class="none">' + (item.break ? J.esc(item.break) : 'No case yet.') + '</div>') + '</li>';
    h += '<li><div class="lh">Orders and returns</div>' + actionHtml(t) + '</li>';
    h += '<li><div class="lh">Account</div>' +
      (t.account ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b>' + (t.account.id ? '<div><button type="button" class="lnk sm" data-a="open-account" data-id="' + J.esc(t.account.id) + '">Open account</button> <span class="muted sm">(Customer 360 is on the account page)</span></div>' : '') + '</div>'
        : '<div class="none">No account is matched, so nobody can see this on Customer 360.</div>') + '</li></ol>';
    return h;
  }
  function accountHtml(item) {
    var a = (state.model.lanes['a-attn'].items.filter(function (x) { return x.id === item.id; })[0]) || item;
    return '<p>' + J.esc(a.sub) + '.</p><ul class="list">' + (a.cases || []).map(function (c) {
      return '<li><span><b>' + J.esc((c.number ? c.number + ' ' : '') + c.subject) + '</b><br><span class="muted sm">' + J.esc(c.owner || '') + '</span></span>' +
        '<span>' + J.chip(c.status || 'No status', c.stage === 'escalated' ? 'bad' : 'info') + '</span></li>';
    }).join('') + '</ul><div class="drawer-actions"><button type="button" class="btn pri" data-a="open-account" data-id="' + J.esc(item.id) + '">Open account</button></div>';
  }
  function detail(item) {
    var html;
    if (item.kind === 'account') html = accountHtml(item);
    else html = pathHtml(M.trace(state.model, item, state.emails), item);
    J.drawer.open({
      title: item.kind === 'account' ? item.title : item.title, html: html,
      onMount: function (body) {
        if (drawerClick) body.removeEventListener('click', drawerClick);   /* drawer body is reused: one handler at a time */
        drawerClick = function (e) {
          var b = e.target.closest('button[data-a]'); if (!b) return;
          var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
          if (a === 'open-email') openRecord('email', id);
          else if (a === 'open-case') openRecord('case', id);
          else if (a === 'open-account') openRecord('account', id);
          else if (a === 'open-order') openRecord('order', id);
        };
        body.addEventListener('click', drawerClick);
      }
    });
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Case', entity: 'Cases' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true);
    });
    $('#win').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]'); if (!b) return;
      var w = M.WINDOWS.filter(function (x) { return x.id === b.getAttribute('data-w'); })[0];
      if (!w) return;
      state.days = w.days; recompute();
    });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows one piece of support work from end to end, using the same records the other tools use. Nothing here changes a record.</p>' +
      '<p><b>1 Emails in.</b> Inbound Support Emails in the chosen window. Imported history and outbound mail are not counted.</p>' +
      '<p><b>2 Triage.</b> What happened to each email: left for review, became or joined a case, ignored, or something else. Automated reports, internal mail and vendor notices are shown but left out of the percentage, which is the share of the remaining requests that became or joined a case. <i>Marked as a case, case not linked</i> is a check: the email says a case exists but no case is linked to it, or the linked case is gone.</p>' +
      '<p><b>3 Cases.</b> Every open case by status. New means not yet acknowledged; it is flagged after two business days. Resolved or closed counts cases created in the chosen window.</p>' +
      '<p><b>4 Orders and returns.</b> What incoming mail asks us to send or take back. It follows the Case Category: <i>Order Device(s)</i> should lead to a device order and <i>Order Supplies</i> to an accessory order, both recorded in Vendor Orders against the case. <i>Returns and replacements</i> are cases with a vendor ticket number or resolved as Device Replaced. <i>Requests still waiting for review</i> are emails about orders or device problems that have no case yet. Two checks: an order case with no order recorded after two business days, and an order that arrived while the case is still open.</p>' +
      '<p><b>5 Accounts.</b> Customers with an escalated or high-priority case, a case not acknowledged after two business days, or a case open over ' + M.STALE_CASE_DAYS + ' days. Also open cases with no account, which Customer 360 cannot show.</p>' +
      '<p><b>Monthly trend.</b> Below the lanes: the last six calendar months (Central), the current one so far. Requests exclude automated, internal and vendor mail. It ignores the window above and uses all loaded emails and cases.</p><p>Click a step to list its records, then a record to see its path: email, case, account.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + (e && e.message || e);
      state.nx.update({ title: 'Could not load the support path.', sub: String(e && e.message || e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }

  J.crm.init().then(function (d) {
    var forced = /[?&]demo=1/.test(location.search);
    state.demo = !!(d && d.demo) || forced;
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
