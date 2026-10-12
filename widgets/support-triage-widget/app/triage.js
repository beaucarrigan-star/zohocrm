/* Support email triage widget. Uses jpk v1.1.0, TriageModel (pure bucketing) and, when no Zoho SDK, TriageDemo.
   Reads Support_Emails with COQL (paged, counted client-side). Writes only Intake_Result, on a button press.
   12 Oct 2026: reads Created_Time too. Live intake rows have Received_At empty, so TriageModel falls back to it. */
(function () {
  'use strict';
  var M = window.TriageModel, J = window.JPK;
  var MODULE = 'Support_Emails';
  var QUERY = 'select id, Name, Sender_Email, Sender_Name, Recipient_Email, Topic, Direction, Intake_Result, Source, Received_At, ' +
    'Created_Time, Last_Activity_Time, Account, Case, Thread_Link from Support_Emails where Direction = \'In\' order by id asc';
  var RESTORE_TO = 'Left for review';
  var drawerClick = null;
  var state = { demo: false, rows: [], buckets: null, now: Date.now(), tables: {}, tabs: null, nx: null, current: 'untouched' };

  function $(s) { return document.querySelector(s); }
  function when(ms) {
    if (ms == null) return '';
    return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function ageText(f) {
    if (f.ageBD == null) return '';
    return f.ageBD + (f.ageBD === 1 ? ' business day' : ' business days');
  }
  function resultChip(f) {
    var r = f.row.result;
    var tone = r === 'Left for review' ? 'warn' : r === 'Ignored' ? 'neutral' : r === 'Case created' || r === 'Added to existing case' ? 'good' : 'info';
    return J.chip(r || 'Not set', tone);
  }

  /* ---------- data ---------- */
  function load() {
    state.now = Date.now();
    if (state.demo) { state.rows = window.TriageDemo.make(state.now); return Promise.resolve(); }
    return J.crm.coqlAll(QUERY).then(function (rows) { state.rows = rows; });
  }
  function rebucket() {
    state.buckets = M.bucket(state.rows, state.now);
    var b = state.buckets;
    state.tabs.setCount('untouched', b.untouched.length);
    state.tabs.setCount('noaccount', b.noAccount.length);
    state.tabs.setCount('ignored', 0);              /* ignored is a log, not a to-do: no alert badge */
    state.tables.untouched.setRows(b.untouched);
    state.tables.noaccount.setRows(b.noAccount);
    state.tables.ignored.setRows(b.ignored);
    state.nx.update(nextStrip());
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) +
      ' (Central). ' + b.total + ' inbound emails.';
    $('#foot').textContent = b.historical + ' imported history emails (no intake result) and ' + b.outbound +
      ' outbound are not shown. Business days skip weekends; holidays are not skipped.';
  }
  function nextStrip() {
    var b = state.buckets, n = b.untouched.length;
    if (n) return { title: n + (n === 1 ? ' email has' : ' emails have') + ' waited over a business day.', sub: 'Oldest first. Open one to ignore it or jump to the record.',
      progress: null, button: { label: 'Show oldest', onClick: function () { state.tabs.select('untouched'); } } };
    if (b.noAccount.length) return { title: 'Nothing is overdue.', sub: b.noAccount.length + ' emails still have no matching account.',
      progress: null, button: { label: 'Show unmatched', onClick: function () { state.tabs.select('noaccount'); } } };
    return { title: 'Inbox is clear.', sub: 'No overdue or unmatched emails.', progress: 100, button: null };
  }

  /* ---------- row actions ---------- */
  function openRecord(id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI) { J.toast('Demo: would open the record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: MODULE, RecordID: id });
  }
  function setResult(row, value) {
    var done = function () {
      row.Intake_Result = value;
      state.rows.forEach(function (r) { if (r.id === row.id) r.Intake_Result = value; });
      rebucket();
    };
    if (state.demo) { done(); return Promise.resolve(); }
    return ZOHO.CRM.API.updateRecord({ Entity: MODULE, APIData: { id: row.id, Intake_Result: value }, Trigger: [] }).then(function (res) {
      var d = res && res.data && res.data[0];
      if (d && d.code && d.code !== 'SUCCESS') throw new Error(d.message || d.code);
      done();
    });
  }
  function rawFor(id) { for (var i = 0; i < state.rows.length; i++) if (state.rows[i].id === id) return state.rows[i]; return null; }
  function act(id, value, msg, undoValue) {
    var raw = rawFor(id);
    if (!raw) return;
    setResult(raw, value).then(function () {
      J.toast(msg + (undoValue ? ' Use the Ignored tab to undo.' : ''));
      J.drawer.close();
    }, function (e) { J.toast('Could not save: ' + (e && e.message || e)); });
  }

  function detail(f) {
    var r = f.row;
    var dl = [
      ['From', J.esc(r.senderName ? r.senderName + ' <' + r.senderEmail + '>' : r.senderEmail)],
      ['Mailbox', J.esc(r.mailbox)],
      ['Received', J.esc(when(r.receivedMs)) + (f.ageBD != null ? ' <span class="muted">(' + J.esc(ageText(f)) + ')</span>' : '')],
      ['Account', r.accountName ? J.esc(r.accountName) : '<span class="muted">No match</span>'],
      ['Topic', J.esc(r.topic || 'Not set')],
      ['Intake result', J.chip(r.result || 'Not set', r.result === 'Left for review' ? 'warn' : 'neutral')],
      ['Linked case', r.caseName ? J.esc(r.caseName) : '<span class="muted">None</span>']
    ];
    var html = '<dl class="dl">' + dl.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join('') + '</dl>' +
      '<div class="drawer-actions">' +
      '<button type="button" class="btn pri" data-a="open">Open record</button>' +
      (r.threadLink ? '<a class="btn" target="_blank" rel="noopener" href="' + J.esc(r.threadLink) + '">Open in mailbox</a>' : '') +
      (r.result === M.IGNORED
        ? '<button type="button" class="btn" data-a="restore">Put back for review</button>'
        : '<button type="button" class="btn" data-a="ignore">No case needed</button>') +
      '</div><p class="muted sm">No case needed sets Intake Result to Ignored. It does not close a case or create an exclusion rule.</p>';
    J.drawer.open({
      title: r.subject || '(no subject)', html: html,
      onMount: function (body) {
        /* The drawer body is reused between rows: drop the previous row's handler so one click acts on one row. */
        if (drawerClick) body.removeEventListener('click', drawerClick);
        drawerClick = function (e) {
          var b = e.target.closest('button[data-a]'); if (!b) return;
          var a = b.getAttribute('data-a');
          if (a === 'open') openRecord(r.id);
          else if (a === 'ignore') act(r.id, M.IGNORED, 'Marked no case needed.', RESTORE_TO);
          else if (a === 'restore') act(r.id, RESTORE_TO, 'Put back for review.');
        };
        body.addEventListener('click', drawerClick);
      }
    });
  }

  /* ---------- tables ---------- */
  function cols(withAge) {
    var c = [
      { key: 'subject', label: 'Subject', sortable: true, sortValue: function (f) { return f.row.subject; },
        render: function (f) { return '<div class="subj">' + J.esc(f.row.subject || '(no subject)') + '</div><div class="sub2">' + J.esc(f.row.senderEmail) + '</div>'; } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (f) { return f.row.accountName; },
        render: function (f) { return f.row.accountName ? J.esc(f.row.accountName) : '<span class="muted">No match</span>'; } },
      { key: 'rec', label: 'Received', sortable: true, num: true, sortValue: function (f) { return f.row.receivedMs; }, render: function (f) { return J.esc(when(f.row.receivedMs)); } }
    ];
    if (withAge) c.push({ key: 'age', label: 'Waiting', sortable: true, num: true, align: 'right', sortValue: function (f) { return f.ageBD; },
      render: function (f) { return '<span class="age">' + J.esc(ageText(f)) + '</span>'; } });
    c.push({ key: 'res', label: 'Result', sortable: true, sortValue: function (f) { return f.row.result || ''; }, render: resultChip });
    return c;
  }
  function build() {
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    state.tabs = J.tabs({ mount: '#tabs', label: 'Triage lanes', selected: 'untouched', onChange: function (id) { state.current = id; },
      tabs: [{ id: 'untouched', label: 'Untouched >1 business day' }, { id: 'noaccount', label: 'No account' }, { id: 'ignored', label: 'Ignored' }] });
    state.tables.untouched = J.table({ mount: '#t-untouched', columns: cols(true), rows: [], caption: 'Emails untouched over one business day', onRowClick: detail,
      empty: { title: 'Nothing waiting', hint: 'Every inbound email has been handled or is under a business day old.' } });
    state.tables.noaccount = J.table({ mount: '#t-noaccount', columns: cols(false), rows: [], caption: 'Emails with no matching account', onRowClick: detail,
      empty: { title: 'Every email has an account', hint: 'Automated, vendor and internal mail is left out on purpose.' } });
    state.tables.ignored = J.table({ mount: '#t-ignored', columns: cols(false), rows: [], caption: 'Ignored emails', onRowClick: detail,
      empty: { title: 'Nothing ignored yet', hint: 'Ignored emails appear here, so a wrong exclusion is easy to spot.' } });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p><b>Untouched</b>: the mailbox watcher left the email for review, nobody has changed its intake result (moving it to Ignored or creating a case is what touches it), and it is more than one business day old (weekends skipped; a Saturday email starts Monday morning). The clock starts at the time the email arrived in the CRM.</p>' +
      '<p><b>No account</b>: no Account is linked, and the email is one a person may need to act on (left for review, case created, added to a case, voicemail). Automated reports, vendor notices and internal mail are left out.</p>' +
      '<p><b>Ignored</b>: Intake Result is Ignored, from an exclusion rule or No case needed. Put one back if it was a mistake.</p>' +
      '<p>The CRM list views of the same names give the quick version; this page does the exact business-day count.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { rebucket(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read Support Emails: ' + (e && e.message || e);
      state.nx.update({ title: 'Could not load emails.', sub: String(e && e.message || e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
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
