/* triage-view.js: Support email triage as a view inside the combined Support widget.
   Same rules as the standalone Support Triage widget (triage-model.js): lanes Untouched over 1 business day, No account, Ignored.
   Writes only Intake_Result, and only when a button is pressed. */
(function () {
  'use strict';
  var M = window.TriageModel;
  var QUERY = "select id, Name, Sender_Email, Sender_Name, Recipient_Email, Topic, Direction, Intake_Result, Source, Received_At, Created_Time, Last_Activity_Time, Account, Case, Thread_Link from Support_Emails where Direction = 'In' order by id asc";
  var RESTORE = 'Left for review', PAGE = 200, CAP = 5000;
  var LANES = [{ k: 'untouched', label: 'Untouched over 1 business day' }, { k: 'noAccount', label: 'No account' }, { k: 'ignored', label: 'Ignored' }];
  var S = { rows: [], now: 0, lane: 'untouched', sel: null, err: '', loaded: false, busy: false };
  var X, root;

  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function ageText(f) { return f.ageBD == null ? '' : f.ageBD + (f.ageBD === 1 ? ' business day' : ' business days'); }

  function load() {
    S.now = Date.now(); S.busy = true; S.err = '';
    if (!X.isLive()) { S.rows = window.TriageDemo.make(S.now); S.loaded = true; S.busy = false; return Promise.resolve(); }
    var all = [];
    function page(off) {
      return X.coql(QUERY + ' limit ' + PAGE + ' offset ' + off).then(function (res) {
        all = all.concat(res.rows);
        if (res.rows.length >= PAGE && all.length < CAP) return page(off + PAGE);
      });
    }
    return page(0).then(function () { S.rows = all; S.loaded = true; S.busy = false; }, function (e) { S.err = e.message || 'Could not read Support Emails'; S.busy = false; });
  }

  function setResult(row, value) {
    if (!X.isLive()) return Promise.resolve();
    return window.ZOHO.CRM.API.updateRecord({ Entity: 'Support_Emails', APIData: { id: row.id, Intake_Result: value }, Trigger: [] }).then(function (res) {
      var d = res && res.data && res.data[0];
      if (d && d.code && d.code !== 'SUCCESS') throw new Error(d.message || d.code);
    });
  }
  function act(id, value, msg) {
    var raw = S.rows.filter(function (r) { return r.id === id; })[0]; if (!raw) return;
    setResult(raw, value).then(function () { raw.Intake_Result = value; S.sel = null; X.toast(msg); draw(); }, function (e) { X.toast('Could not save: ' + (e && e.message || e)); });
  }

  function flat(f) {
    var r = f.row;
    return { id: r.id, subject: r.subject || '(no subject)', sender: r.senderName ? r.senderName + ' <' + r.senderEmail + '>' : r.senderEmail, account: r.accountName || 'No match', received: when(r.receivedMs), waiting: ageText(f), result: r.result || 'Not set' };
  }
  var COLS = [{ k: 'subject', label: 'Subject', main: 1 }, { k: 'sender', label: 'From' }, { k: 'account', label: 'Account' }, { k: 'received', label: 'Received' }, { k: 'waiting', label: 'Waiting', r: 1 }, { k: 'result', label: 'Result', pill: 1 }];

  function detail(f) {
    var r = f.row, esc = X.esc;
    var dl = [['From', r.senderName ? r.senderName + ' <' + r.senderEmail + '>' : r.senderEmail], ['Mailbox', r.mailbox], ['Received', when(r.receivedMs) + (f.ageBD != null ? ' (' + ageText(f) + ')' : '')],
      ['Account', r.accountName || 'No match'], ['Topic', r.topic || 'Not set'], ['Intake result', r.result || 'Not set'], ['Linked case', r.caseName || 'None']];
    return '<section class="card" id="det"><h3>' + esc(r.subject || '(no subject)') + '</h3><dl>' + dl.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
      '<div class="acts"><button type="button" class="btn pri" data-a="open">Open email record</button>' +
      (r.accountId ? '<button type="button" class="btn" data-a="acct">Open account</button>' : '') +
      (r.caseId ? '<button type="button" class="btn" data-a="case">Open case</button>' : '') +
      (r.threadLink ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(r.threadLink) + '">Open in mailbox</a>' : '') +
      (r.result === M.IGNORED ? '<button type="button" class="btn" data-a="restore">Put back for review</button>' : '<button type="button" class="btn" data-a="ignore">No case needed</button>') +
      '<button type="button" class="btn" data-a="close">Close</button></div>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">No case needed sets Intake Result to Ignored. It does not close a case or create an exclusion rule.</p></section>';
  }

  function draw() {
    var esc = X.esc, b = M.bucket(S.rows, S.now), lane = b[S.lane] || [], i;
    var next = b.untouched.length ? b.untouched.length + (b.untouched.length === 1 ? ' email has' : ' emails have') + ' waited over a business day. Oldest first.' :
      b.noAccount.length ? 'Nothing is overdue. ' + b.noAccount.length + ' emails still have no matching account.' : 'Inbox is clear. No overdue or unmatched emails.';
    var h = '<div class="wrap">' + X.head('Support Process', 'Support triage', '', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
    if (S.err) h += '<div class="err">Could not read Support Emails: ' + esc(S.err) + '</div>';
    h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + esc(S.loaded ? next : 'Loading…') + '</div>';
    h += '<div class="bar" id="lanes" role="group" aria-label="Triage lane">' + LANES.map(function (l) {
      var n = l.k === 'ignored' ? b.ignored.length : b[l.k].length;
      return '<button type="button" class="pillbtn" data-l="' + l.k + '" aria-pressed="' + (S.lane === l.k) + '">' + esc(l.label) + ' (' + n + ')</button>'; }).join('') + '</div>';
    if (!lane.length) h += '<div class="empty"><b>' + (S.lane === 'ignored' ? 'Nothing ignored yet' : S.lane === 'noAccount' ? 'Every email has an account' : 'Nothing waiting') + '</b></div>';
    else h += X.tableHtml(COLS, lane.map(flat), true);
    var cur = S.sel && lane.filter(function (f) { return f.row.id === S.sel; })[0];
    if (cur) h += '<div class="cards">' + detail(cur) + '</div>';
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">Read ' + esc(new Date(S.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + ' (Central). ' + b.total + ' emails. ' + b.historical + ' imported history and ' + b.outbound + ' outbound are not shown. Business days skip weekends; holidays are not skipped.</p></div>';
    root.innerHTML = h;
    X.bindSwitch();
    document.getElementById('rf').onclick = function () { run(true); };
    document.getElementById('lanes').onclick = function (e) { var x = e.target.closest('[data-l]'); if (x) { S.lane = x.getAttribute('data-l'); S.sel = null; draw(); } };
    var tb = root.querySelector('tbody');
    if (tb) { var pick = function (tr) { if (tr) { S.sel = lane[+tr.getAttribute('data-i')].row.id; draw(); var d = document.getElementById('det'); if (d) d.scrollIntoView({ block: 'nearest' }); } };
      tb.onclick = function (e) { pick(e.target.closest('tr[data-i]')); }; tb.onkeydown = function (e) { if (e.key === 'Enter') pick(e.target.closest('tr[data-i]')); }; }
    var det = document.getElementById('det');
    if (det && cur) det.onclick = function (e) {
      var bt = e.target.closest('button[data-a]'); if (!bt) return; var a = bt.getAttribute('data-a'), r = cur.row;
      if (a === 'open') X.openCrm('Support_Emails', r.id); else if (a === 'acct') X.openCrm('Accounts', r.accountId); else if (a === 'case') X.openCrm('Cases', r.caseId);
      else if (a === 'ignore') act(r.id, M.IGNORED, 'Marked no case needed. Use the Ignored lane to undo.');
      else if (a === 'restore') act(r.id, RESTORE, 'Put back for review.'); else if (a === 'close') { S.sel = null; draw(); }
    };
  }
  function run(manual) { return load().then(function () { draw(); if (manual) X.toast('Refreshed'); }); }

  window.RecModules.triage = {
    key: 'triage', title: 'Support triage', entity: 'Support_Emails', custom: true,
    render: function (rootEl, ctx) { root = rootEl; X = ctx; draw(); if (!S.loaded && !S.busy) run(false); else if (S.loaded) draw(); }
  };
})();
