/* Stock Alerts panel (Web Tab / button). Reads EM_Stock_Alerts with COQL; every change goes through the standalone
   function stock_alert_decide (approve | save | reject), one alert per call. Nothing is sent without a person clicking Approve.
   Outside the CRM (no Zoho SDK) it runs on demo data. */
(function () {
  'use strict';
  var J = window.JPK, M = window.StockModel, R = window.StockReplies, esc = J.esc;
  var S = { demo: false, rows: [], tab: 'approve', sel: {}, who: '', email: '', busy: false, loadErr: null, mail: [], mailErr: null };
  var tblApi = null;

  var strip = J.next({ mount: '#nx', title: 'Loading', button: null });
  var tabsApi = J.tabs({
    mount: '#tabs', label: 'Stock alert sections',
    tabs: [{ id: 'approve', label: 'Needs approval', count: 0 }, { id: 'replied', label: 'Customer replied', count: 0 }, { id: 'action', label: 'Needs action', count: 0 },
      { id: 'waiting', label: 'Waiting on customer', count: 0 }, { id: 'closed', label: 'Closed', count: 0 }, { id: 'months', label: 'By month' }],
    onChange: function (id) { S.tab = id; render(); }
  });
  var el = { bar: document.getElementById('bar'), all: document.getElementById('all'), note: document.getElementById('sel-note'), mass: document.getElementById('mass') };

  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function laneRows(tab) {
    return S.rows.filter(function (v) { return tab === 'closed' ? (v.lane === 'done' || v.lane === 'dismissed') : v.lane === tab; });
  }
  function selectedIds() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); }
  function byId(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === id) return S.rows[i]; return null; }

  /* ---------------- load ---------------- */
  function setRows(raw) {
    S.rows = raw.map(function (a) {
      var v = M.view(a);
      v.replies = a.Email_Sent_At ? R.repliesFor(a, S.mail || []) : [];
      if (v.lane === 'waiting') {
        if (v.replies.length) { v.lane = 'replied'; v.laneLabel = 'Customer replied'; v.repliedAt = v.replies[0].Created_Time || ''; v.replyFrom = v.replies[0].Sender_Name || v.replies[0].Sender_Email || ''; }
      }
      return v;
    });
  }
  /* S47c: inbound mail since the oldest waiting email went out (Support Emails, fed by the emsupport@ mailbox) */
  function loadReplies(raw) {
    if (S.demo) { S.mail = (window.STOCK_DEMO_MAIL || []).slice(); return Promise.resolve(); }
    var sent = raw.filter(function (a) { return !!a.Email_Sent_At; });
    if (!sent.length) { S.mail = []; return Promise.resolve(); }
    return J.crm.coqlAll(R.query(R.sinceDay(sent))).then(function (m) { S.mail = m || []; S.mailErr = null; },
      function (e) { S.mail = []; S.mailErr = J.crm.error(e).message; });
  }
  function load() {
    if (S.demo) { var dr = window.STOCK_DEMO.map(function (r) { return JSON.parse(JSON.stringify(r)); }); return loadReplies(dr).then(function () { setRows(dr); render(); }); }
    return J.crm.coqlAll(M.QUERY).then(function (rows) { S.loadErr = null; return loadReplies(rows).then(function () { setRows(rows); render(); }); },
      function (e) { S.loadErr = J.crm.error(e).message; render(); });
  }

  /* ---------------- render ---------------- */
  function render() {
    var c = M.counts(S.rows.map(function (v) { return v.raw; }));
    tabsApi.setCount('approve', c.approve); tabsApi.setCount('action', c.action);
    var nRep = laneRows('replied').length;
    tabsApi.setCount('replied', nRep);
    tabsApi.setCount('waiting', c.waiting - nRep); tabsApi.setCount('closed', c.done + c.dismissed);
    Object.keys(S.sel).forEach(function (k) { var v = byId(k); if (!v || v.lane !== 'approve') delete S.sel[k]; });
    var rows = laneRows(S.tab), isA = S.tab === 'approve', isM = S.tab === 'months';
    if (S.tab === 'closed') rows = closedRows(rows);
    paintCf();
    el.bar.hidden = !isA || !rows.length;
    var cols = [];
    if (isA) cols.push({ key: 'chk', label: '', render: function (r) { return '<input type="checkbox" data-sel="' + esc(r.id) + '" aria-label="Select ' + esc(r.account) + '"' + (S.sel[r.id] ? ' checked' : '') + '>'; } });
    cols.push({ key: 'account', label: 'Account', sortable: true, render: function (r) { return esc(r.account); } });
    cols.push({ key: 'type', label: 'Alert', sortable: true, render: function (r) { return esc(r.type); } });
    cols.push({ key: 'ask', label: 'The ask', sortable: true, render: function (r) { return esc(r.ask || '-'); } });
    if (isA || S.tab === 'waiting') cols.push({ key: 'subject', label: 'Email subject', render: function (r) { return esc(r.subject); } });
    if (S.tab === 'replied') {
      cols.push({ key: 'replyFrom', label: 'Reply from', sortable: true, render: function (r) { return esc(r.replyFrom); } });
      cols.push({ key: 'repliedAt', label: 'Replied', sortable: true, render: function (r) { return esc(String(r.repliedAt || '').slice(0, 10)); } });
    }
    if (isA) cols.push({ key: 'to', label: 'To', sortable: true, sortValue: function (r) { return r.to.length; }, render: function (r) { return r.to.length ? plural(r.to.length, 'person', 'people') : J.chip('No recipient', 'warn'); } });
    if (S.tab === 'waiting') cols.push({ key: 'sentAt', label: 'Sent', sortable: true, render: function (r) { return esc(String(r.sentAt || '').slice(0, 10)); } });
    if (S.tab === 'closed') {
      cols.push({ key: 'outcomeLabel', label: 'Outcome', sortable: true, render: function (r) { return J.chip(r.outcomeLabel, r.outcomeTone); } });
      cols.push({ key: 'closedOn', label: 'Closed', sortable: true, render: function (r) { return esc(r.closedOn || '-'); } });
      cols.push({ key: 'emailSent', label: 'Customer email', sortable: true, render: function (r) { return r.emailSent ? 'Sent ' + esc(r.emailSent) + (r.replies && r.replies.length ? ' · replied' : '') : '<span class="muted">None</span>'; } });
    }
    if (S.tab === 'action') cols.push({ key: 'detail', label: 'Why', render: function (r) { return esc(r.detail); } });
    var empties = { approve: ['Nothing waiting for approval', 'New drafts appear after the nightly count.'], action: ['Nothing needs action', ''],
      closed: S.cf && (S.cf.q || S.cf.k !== 'all' || S.cf.per !== 'all') ? ['Nothing matches these filters', 'Try All, a longer period or a different search.'] : ['Nothing closed yet', ''],
      replied: ['No customer replies to handle', S.mailErr ? 'Replies could not be read: ' + S.mailErr : 'When a customer answers a stock email, it shows here to mark Ordered or No Order Needed.'],
      waiting: ['Nothing waiting on a customer', ''] };
    tblApi = J.table({
      mount: '#tbl', caption: isM ? 'Stock alerts and customer emails by month' : 'Stock alerts: ' + S.tab, columns: isM ? monthCols() : cols, rows: isM ? monthRows() : rows,
      empty: isM ? { title: 'Nothing to count yet', hint: '' } : { title: empties[S.tab][0], hint: empties[S.tab][1] },
      onRowClick: isM ? null : function (r) { openAlert(r.id); }
    });
    syncBar();
    var n = c.approve;
    if (S.loadErr) strip.update({ title: 'Could not load the alerts.', sub: S.loadErr, button: null });
    else if (n) strip.update({ title: plural(n, 'email needs', 'emails need') + ' your approval.', sub: 'Open one to read or edit it, or tick several and approve them together.', button: null });
    else if (nRep) strip.update({ title: plural(nRep, 'customer has', 'customers have') + ' replied to a stock email.', sub: 'Open a reply to mark it Ordered (a confirmation email goes out) or No Order Needed.', button: null });
    else strip.update({ title: 'No emails are waiting for approval.', sub: c.action ? plural(c.action, 'alert needs', 'alerts need') + ' action.' : 'You are caught up.', button: null });
  }
  function syncBar() {
    var n = selectedIds().length, total = laneRows('approve').length;
    el.mass.disabled = S.busy || n === 0;
    el.mass.textContent = 'Approve selected (' + n + ')';
    el.all.checked = total > 0 && n === total;
    el.note.textContent = n ? plural(n, 'email', 'emails') + ' selected' : '';
  }

  /* ---------------- events ---------------- */
  document.getElementById('tbl').addEventListener('change', function (e) {
    var c = e.target.closest('[data-sel]'); if (!c) return;
    S.sel[c.getAttribute('data-sel')] = c.checked; syncBar();
  });
  el.all.addEventListener('change', function () {
    S.sel = {}; if (el.all.checked) laneRows('approve').forEach(function (v) { S.sel[v.id] = true; });
    Array.prototype.forEach.call(document.querySelectorAll('#tbl [data-sel]'), function (c) { c.checked = !!S.sel[c.getAttribute('data-sel')]; });
    syncBar();
  });
  el.mass.addEventListener('click', openMassConfirm);

  /* ---------------- calling the function ---------------- */
  function decide(id, action, draft) {
    var args = { alertId: String(id), action: action, subject: draft ? draft.subject : '', body: draft ? draft.body : '', recipients: draft ? draft.recipients : '' };
    if (S.demo) return demoDecide(args);
    return J.crm.run('stock_alert_decide', args).then(function (r) {
      if (r && typeof r === 'object' && 'ok' in r) return r;
      return { ok: false, message: 'The function gave an unexpected answer: ' + String(r).slice(0, 200) };
    }, function (e) { return { ok: false, message: J.crm.error(e).message }; });
  }
  function fullRecord(id) {
    if (S.demo) { var v = byId(id); return Promise.resolve(v ? v.raw : null); }
    return ZOHO.CRM.API.getRecord({ Entity: 'EM_Stock_Alerts', RecordID: id }).then(function (r) { return r && r.data && r.data[0]; });
  }

  /* ---------------- one alert (drawer) ---------------- */
  function openAlert(id) {
    var v = byId(id); if (!v) return;
    if (v.lane === 'replied' || v.lane === 'waiting') { replyDrawer(v); return; }
    if (v.lane !== 'approve') { historyDrawer(v); return; }
    J.drawer.open({ title: v.account, html: '<p class="muted">Loading the full draft...</p>' });
    fullRecord(id).then(function (rec) {
      if (!rec) { J.drawer.open({ title: v.account, html: '<p>Could not read this alert.</p>' }); return; }
      draftDrawer(v, rec);
    }, function (e) { J.drawer.open({ title: v.account, html: '<p>Could not read this alert: ' + esc(J.crm.error(e).message) + '</p>' }); });
  }
  function recLink(v) {
    return '<button type="button" class="btn sm" data-open="' + esc(v.id) + '">Open record</button>';
  }
  function openRecord(id) {
    if (S.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI) { J.toast('In the CRM this opens the alert record.'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: 'EM_Stock_Alerts', RecordID: id });
  }
  function openReadOnly(v) {
    var html = '<dl class="dl"><dt>Alert</dt><dd>' + esc(v.type) + '</dd><dt>The ask</dt><dd>' + esc(v.ask || '-') + '</dd>' +
      '<dt>Why</dt><dd>' + esc(v.detail) + '</dd><dt>Status</dt><dd>' + J.chip(v.laneLabel, v.lane === 'done' ? 'good' : 'neutral') + '</dd>' +
      (v.subject ? '<dt>Email subject</dt><dd>' + esc(v.subject) + '</dd>' : '') +
      (v.to.length ? '<dt>To</dt><dd>' + esc(v.to.join(', ')) + '</dd>' : '') +
      (v.sentAt ? '<dt>Sent</dt><dd>' + esc(String(v.sentAt).slice(0, 10)) + '</dd>' : '') +
      (v.log ? '<dt>Log</dt><dd>' + esc(v.log) + '</dd>' : '') + '</dl>' +
      (v.lane === 'action' ? '<p class="sm muted">There is no email to approve. Handle this in the record, then set its Resolution.</p>' : '') +
      '<div class="dact">' + recLink(v) + '</div>';
    J.drawer.open({ title: v.account, html: html, onMount: function (b) { var o = b.querySelector('[data-open]'); if (o) o.addEventListener('click', function () { openRecord(v.id); }); } });
  }

  /* S47: who the To picker offers - the alert's account contacts and the active CRM users (demo: a short made-up list) */
  function pickPeople(rec) {
    if (S.demo) return Promise.resolve(M.splitRecipients(rec.Recipient_Emails).map(function (e) { return { email: e, name: '', group: 'At this customer' }; })
      .concat([{ email: 'demo.contact@county.example', name: 'Demo Contact', group: 'At this customer' }, { email: 'demo.user@justicepoint.example', name: 'Demo User', group: 'JusticePoint' }]));
    var acc = rec && rec.Account && (rec.Account.id || rec.Account);
    return JPKRecip.crmPeople(acc, function (q) { return J.crm.coqlAll(q); });
  }
  function draftDrawer(v, rec) {
    var simple = M.isSimpleHtml(rec.Draft_Body);
    var bodyTxt = simple ? M.htmlToText(rec.Draft_Body) : String(rec.Draft_Body || '');
    var html = '<p class="muted sm">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +
      '<label class="eyebrow" for="d-to">To</label><textarea class="fld" id="d-to" rows="2"></textarea><div class="errtxt" id="d-to-e" hidden></div>' +
      '<label class="eyebrow" for="d-sub">Subject</label><input class="fld" id="d-sub">' +
      '<label class="eyebrow" for="d-body">Message</label><textarea class="fld' + (simple ? '' : ' rawhtml') + '" id="d-body"></textarea>' +
      '<p class="sm muted">' + (simple ? 'Blank line = new paragraph. ' : 'This draft has custom layout, so you are editing the HTML. ') +
      '<code>{{sender}}</code> becomes your name when the email goes out.</p>' +
      '<div class="sendnote" id="d-note"></div><div class="dact" id="d-act">' +
      '<button type="button" class="btn pri" id="d-ok">Approve &amp; send</button>' +
      '<button type="button" class="btn" id="d-save">Save draft</button>' +
      '<button type="button" class="btn" id="d-rej">Reject</button>' + recLink(v) + '</div><div id="d-res" role="status"></div>';
    J.drawer.open({ title: v.account, html: html, onMount: function (b) {
      var to = b.querySelector('#d-to'), sub = b.querySelector('#d-sub'), bod = b.querySelector('#d-body'), note = b.querySelector('#d-note');
      to.value = M.splitRecipients(rec.Recipient_Emails).join(', '); sub.value = rec.Draft_Subject || ''; bod.value = bodyTxt;
      if (window.JPKRecip) JPKRecip.mount(to, { load: function () { return pickPeople(rec); } });   /* S47: multi-select To */
      var armed = null;
      function draft() { return { subject: sub.value.trim(), body: simple ? M.textToHtml(bod.value) : bod.value.trim(), recipients: M.splitRecipients(to.value).join(', ') }; }
      function check() {
        var rc = M.recipientCheck(to.value), e = b.querySelector('#d-to-e');
        e.hidden = rc.ok || !to.value.trim() && false; to.classList.toggle('err', !rc.ok);
        e.hidden = rc.ok; e.textContent = rc.good.length ? 'Not a valid address: ' + rc.bad.join(', ') : 'Add at least one recipient.';
        return rc;
      }
      function paintNote() { note.textContent = 'Sends from ' + (S.who || 'you') + ' to ' + plural(M.recipientCheck(to.value).good.length, 'person', 'people') + '. The email cannot be recalled once sent.'; }
      paintNote(); to.addEventListener('input', function () { armed = null; b.querySelector('#d-ok').textContent = 'Approve & send'; paintNote(); });
      function busy(on) { Array.prototype.forEach.call(b.querySelectorAll('#d-act button'), function (x) { x.disabled = on; }); S.busy = on; }
      function done(r, okText) {
        busy(false);
        b.querySelector('#d-res').innerHTML = '<p class="' + (r.ok ? '' : 'errtxt') + '"><b>' + esc(r.ok ? okText : 'Not done') + '.</b> ' + esc(r.message || '') + '</p>';
        if (r.ok && r.emailStatus !== undefined) { load().then(function () { if (r.emailStatus !== 'Awaiting approval') setTimeout(J.drawer.close, 900); }); }
        else if (r.ok) { load(); }
        else if (r.emailStatus && r.emailStatus !== 'Awaiting approval') { load(); }
      }
      b.querySelector('[data-open]').addEventListener('click', function () { openRecord(v.id); });
      b.querySelector('#d-save').addEventListener('click', function () {
        if (!check().ok) return; busy(true);
        decide(v.id, 'save', draft()).then(function (r) { done(r, 'Draft saved'); });
      });
      b.querySelector('#d-rej').addEventListener('click', function () {
        if (armed !== 'rej') { armed = 'rej'; this.textContent = 'Confirm reject'; return; }
        busy(true); decide(v.id, 'reject', null).then(function (r) { done(r, 'Rejected'); });
      });
      b.querySelector('#d-ok').addEventListener('click', function () {
        if (!check().ok) return;
        if (armed !== 'ok') { armed = 'ok'; this.textContent = 'Confirm: send now'; return; }
        busy(true); decide(v.id, 'approve', draft()).then(function (r) { done(r, 'Sent'); });
      });
    } });
  }

  /* ---------------- mass approve ---------------- */
  function openMassConfirm() {
    var ids = selectedIds(); if (!ids.length || S.busy) return;
    var list = ids.map(byId).filter(Boolean);
    var noRcp = list.filter(function (v) { return !v.to.length; });
    var people = list.reduce(function (n, v) { return n + v.to.length; }, 0);
    var html = '<p><b>You are about to send ' + plural(list.length, 'email', 'emails') + ' to customers</b> (' + plural(people, 'recipient', 'recipients') + ') as ' + esc(S.who || 'you') + '.</p>' +
      '<p class="sm muted">Each email goes out exactly as drafted. Sent emails cannot be recalled. To change a draft first, open it from the list.</p>' +
      (noRcp.length ? '<p class="errtxt">' + plural(noRcp.length, 'selected alert has', 'selected alerts have') + ' no recipient and will not send.</p>' : '') +
      '<ul class="list">' + list.map(function (v) { return '<li>' + esc(v.account) + ' <span class="muted">' + esc(v.ask) + '</span></li>'; }).join('') + '</ul>' +
      '<div class="dact"><button type="button" class="btn pri" id="m-go">Send ' + plural(list.length, 'email', 'emails') + '</button><button type="button" class="btn" id="m-no">Cancel</button></div><div id="m-out" role="status"></div>';
    J.drawer.open({ title: 'Approve ' + plural(list.length, 'email', 'emails'), html: html, onMount: function (b) {
      b.querySelector('#m-no').addEventListener('click', J.drawer.close);
      b.querySelector('#m-go').addEventListener('click', function () { runMass(list, b); });
    } });
  }
  function runMass(list, b) {
    S.busy = true; syncBar();
    Array.prototype.forEach.call(b.querySelectorAll('.dact button'), function (x) { x.disabled = true; });
    var out = b.querySelector('#m-out'), results = [], i = 0;
    function line(v, r) { return '<li>' + J.chip(r.ok ? 'Sent' : 'Not sent', r.ok ? 'good' : 'bad') + ' ' + esc(v.account) + (r.ok ? '' : ' <span class="muted">' + esc(r.message || '') + '</span>') + '</li>'; }
    var lines = [];
    function paint(msg) { out.innerHTML = '<p class="prog">' + esc(msg) + '</p><ul class="list res">' + lines.join('') + '</ul>'; }
    function next() {
      if (i >= list.length) {
        var s = M.batchSummary(results); S.busy = false; S.sel = {};
        paint(s.text + '.'); J.toast(s.text); load(); return;
      }
      var v = list[i]; paint('Sending ' + (i + 1) + ' of ' + list.length + '...');
      decide(v.id, 'approve', null).then(function (r) { results.push(r); lines.push(line(v, r)); i += 1; next(); });
    }
    next();
  }

  /* ---------------- menu + about ---------------- */
  J.menu({ button: '#more', items: [
    { label: 'Refresh list', onClick: function () { load().then(function () { J.toast('Refreshed'); }); } },
    { label: 'Refresh Alert Status field', onClick: function () {
      if (S.demo) { J.toast('Demo: the Alert Status field is refreshed in the CRM.'); return; }
      J.crm.run('stock_alert_sync_all', {}).then(function (r) { J.toast('Alert Status checked' + (r && r.changed != null ? ': ' + r.changed + ' updated' : '')); },
        function (e) { J.toast('Could not refresh: ' + J.crm.error(e).message); });
    } }
  ] });
  J.aboutButton({
    button: '#help', title: 'About stock alerts',
    html: '<p>The nightly count drafts an email when a customer is below its spare floor or holds too many spares. <b>Nothing is sent until a person approves it here.</b></p>' +
      '<ol><li><b>Customer replied.</b> A customer answered a stock email. Read the reply, then press <b>Ordered</b> (you check and send a short order confirmation, and the alert closes as Order placed) or <b>No Order Needed</b> (you check and send a short thank-you that invites them to reply if things change, and the alert closes as Customer declined). Waiting alerts have the same two buttons for answers that came by phone.</li>' +
      '<li><b>History and Reopen.</b> Open any alert to see its history: our email, the customer\'s reply and our Ordered or No Order Needed answer. Closed alerts have a <b>Reopen</b> button (two clicks) that puts them back to work.</li>' +
      '<li><b>Closed.</b> What happened to each alert (Ordered, No order needed, Cleared on its own, Rejected), the day it closed and whether the customer got an email. Newest first, filtered to the last 90 days by default; pick an outcome, change the period or search an account.</li>' +
      '<li><b>By month.</b> Stock alerts raised each month (by the day first raised, split by type), and the Ordered and No Order Needed emails sent each month (by the day they went out; counted from 30 Oct 2026).</li>' +
      '<li><b>Needs approval.</b> Open a draft to read it, edit the recipients, subject or message, then Approve &amp; send (two clicks, so a stray tap cannot send). Or tick several and approve them together; you see the count before anything goes out.</li>' +
      '<li><b>Needs action.</b> No email applies (no recipient, rejected, or house stock). Handle it in the record.</li>' +
      '<li><b>Waiting on customer.</b> The email went out. Close the alert in the record when the customer answers.</li>' +
      '<li><b>Closed.</b> Resolved, ordered or dismissed.</li></ol>' +
      '<p>Rejecting dismisses the alert and sends nothing. Approved emails go from your own name and are logged on the alert.</p>'
  });

  /* ---------------- S47h: Closed list ---------------- */
  S.cf = { k: 'all', per: '90', q: '' };
  var CF = [['all', 'All'], ['ordered', 'Ordered'], ['noorder', 'No order needed'], ['cleared', 'Cleared on its own'], ['rejected', 'Rejected'], ['other', 'Other']];
  function decorate(v) {
    if (v.outcomeLabel) return v;
    var o = window.StockMonths.outcome(v.raw);
    v.outcomeKey = o.key; v.outcomeLabel = o.label; v.outcomeTone = o.tone;
    v.closedOn = window.StockMonths.closedDay(v.raw); v.emailSent = String(v.raw.Email_Sent_At || '').slice(0, 10);
    return v;
  }
  function cutoff() {
    if (S.cf.per === 'all') return '';
    var d = new Date(); d.setDate(d.getDate() - (+S.cf.per));
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function closedBase() {
    var c = cutoff(), q = S.cf.q.trim().toLowerCase();
    return laneRows('closed').map(decorate).filter(function (v) {
      return (!c || (v.closedOn && v.closedOn >= c)) && (!q || v.account.toLowerCase().indexOf(q) >= 0);
    });
  }
  function closedRows() {
    return closedBase().filter(function (v) { return S.cf.k === 'all' || v.outcomeKey === S.cf.k; })
      .sort(function (x, y) { return x.closedOn < y.closedOn ? 1 : x.closedOn > y.closedOn ? -1 : x.account.localeCompare(y.account); });
  }
  function paintCf() {
    var bar = document.getElementById('cf'); if (!bar) return;
    bar.hidden = S.tab !== 'closed'; if (bar.hidden) return;
    if (!bar.firstChild) {
      bar.innerHTML = '<div class="cfchips" role="group" aria-label="Show closed alerts by outcome"></div>' +
        '<label class="cfper">Closed in <select id="cf-per" aria-label="Closed in"><option value="30">the last 30 days</option><option value="90">the last 90 days</option><option value="all">any time</option></select></label>' +
        '<input type="search" id="cf-q" placeholder="Search accounts" aria-label="Search accounts">' +
        '<span class="cfnote" id="cf-note" aria-live="polite"></span>';
      bar.querySelector('#cf-per').value = S.cf.per;
      bar.addEventListener('click', function (e) { var b = e.target.closest('[data-cf]'); if (!b) return; S.cf.k = b.getAttribute('data-cf'); render(); });
      bar.querySelector('#cf-per').addEventListener('change', function () { S.cf.per = this.value; render(); });
      bar.querySelector('#cf-q').addEventListener('input', function () { S.cf.q = this.value; render(); });
    }
    var base = closedBase(), n = {};
    base.forEach(function (v) { n[v.outcomeKey] = (n[v.outcomeKey] || 0) + 1; }); n.all = base.length;
    bar.querySelector('.cfchips').innerHTML = CF.filter(function (c) { return c[0] === 'all' || n[c[0]] || S.cf.k === c[0]; }).map(function (c) {
      return '<button type="button" data-cf="' + c[0] + '" aria-pressed="' + (S.cf.k === c[0]) + '">' + esc(c[1]) + '<span class="n">' + (n[c[0]] || 0) + '</span></button>';
    }).join('');
    var shown = S.cf.k === 'all' ? n.all : (n[S.cf.k] || 0);
    bar.querySelector('#cf-note').textContent = 'Newest first. Open one for its history or to reopen it.' + (laneRows('closed').length > base.length ? ' ' + (laneRows('closed').length - base.length) + ' older or not matching are hidden.' : '');
  }

  /* ---------------- S47f: history and Reopen ---------------- */
  function fmtWhen(s) { return String(s || '').slice(0, 16).replace('T', ' '); }
  function emailCard(o) {
    return '<section class="hx"><div><b>' + esc(o.label) + '</b>' + (o.when ? ' <span class="muted sm">' + esc(o.when) + '</span>' : '') + '</div>' +
      '<dl class="dl hx-dl">' + (o.from ? '<dt>From</dt><dd>' + esc(o.from) + '</dd>' : '') + (o.to ? '<dt>To</dt><dd>' + esc(o.to) + '</dd>' : '') +
      (o.subject ? '<dt>Subject</dt><dd>' + esc(o.subject) + '</dd>' : '') + '</dl>' +
      '<div class="hx-body">' + esc(o.text || '(no text)') + '</div></section>';
  }
  function ourEmail(v) {
    var a = v.raw; if (!a.Email_Sent_At) return '';
    var who = R.senderFromLog(a);
    return emailCard({ label: 'Our email', when: fmtWhen(a.Email_Sent_At), from: who, to: v.to.join(', '), subject: a.Draft_Subject || '',
      text: R.htmlText(M.previewText(a.Draft_Body || '', who || '(the person who approved it)')) });
  }
  function replyCards(v) {
    return (v.replies || []).slice().reverse().map(function (m) {
      return emailCard({ label: 'Customer reply', when: fmtWhen(m.Created_Time), from: m.Sender_Name && m.Sender_Email ? m.Sender_Name + ' <' + m.Sender_Email + '>' : (m.Sender_Email || m.Sender_Name || ''),
        subject: m.Name || '', text: R.cleanBody(m.Body, 4000) });
    }).join('');
  }
  function loadNotes(id) {
    if (S.demo) return Promise.resolve(((window.STOCK_DEMO_NOTES || {})[id] || []).slice());
    if (!window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.API || !ZOHO.CRM.API.getRelatedRecords) return Promise.resolve([]);
    return ZOHO.CRM.API.getRelatedRecords({ Entity: 'EM_Stock_Alerts', RecordID: id, RelatedList: 'Notes' })
      .then(function (r) { return (r && r.data) || []; }, function () { return []; });
  }
  function answerCards(notes) {
    var list = notes.map(R.parseNote).filter(function (n) { return n.kind === 'ordered' || n.kind === 'no_order'; })
      .sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    if (!list.length) return '<p class="sm muted">No Ordered or No Order Needed email has gone out for this alert yet.</p>';
    return list.map(function (n) {
      return emailCard({ label: n.kind === 'ordered' ? 'Our answer: Ordered' : 'Our answer: No order needed', when: fmtWhen(n.at), to: n.to, subject: n.subject, text: n.text });
    }).join('');
  }
  /* Reopen: back to Open with the Resolution cleared. Sent email -> Waiting on customer; rejected draft -> Needs approval; otherwise Needs action. */
  function reopenFields(a) {
    var f = { id: String(a.id), Status: 'Open', Resolution: null, Send_Claim: '' }, em = a.Email_Status || '';
    if (em === 'Sent') f.Alert_Status = 'Waiting on customer';
    else if ((em === 'Rejected' || em === 'Send failed') && a.Draft_Body && a.Recipient_Emails) { f.Email_Status = 'Awaiting approval'; f.Alert_Status = 'Needs approval'; }
    else f.Alert_Status = 'Needs action';
    return f;
  }
  function reopenLane(a) { var s = reopenFields(a).Alert_Status; return s === 'Waiting on customer' ? 'Waiting on customer (or Customer replied, if they answered)' : s; }
  function reopen(v) {
    var a = v.raw, f = reopenFields(a), d = new Date();
    var stamp = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    f.Send_Log = (a.Send_Log ? a.Send_Log + ' | ' : '') + stamp + ': reopened by ' + (S.who || 'a user') + ' on the Stock Alerts page.';
    if (f.Send_Log.length > 1900) f.Send_Log = f.Send_Log.slice(-1900);
    if (S.demo) {
      window.STOCK_DEMO.forEach(function (r) { if (String(r.id) === v.id) Object.keys(f).forEach(function (k) { if (k !== 'id') r[k] = f[k]; }); });
      return Promise.resolve({ ok: true });
    }
    return ZOHO.CRM.API.updateRecord({ Entity: 'EM_Stock_Alerts', APIData: f, Trigger: [] }).then(function (r) {
      var x = r && r.data && r.data[0];
      return x && x.code === 'SUCCESS' ? { ok: true } : { ok: false, message: (x && x.message) || 'The CRM did not accept the change.' };
    }, function (e) { return { ok: false, message: J.crm.error(e).message }; });
  }
  function historyDrawer(v) {
    var a = v.raw, closed = v.lane === 'done' || v.lane === 'dismissed';
    var res = a.Resolution && a.Resolution !== '-None-' ? ' ' + esc(a.Resolution) : '';
    var html = '<p class="muted sm">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +
      '<dl class="dl"><dt>Status</dt><dd>' + J.chip(v.laneLabel, v.lane === 'done' ? 'good' : 'neutral') + res + '</dd>' +
      '<dt>Why</dt><dd>' + esc(v.detail || '-') + '</dd>' +
      (a.First_Raised ? '<dt>First raised</dt><dd>' + esc(a.First_Raised) + '</dd>' : '') +
      (a.Handled_Date ? '<dt>Handled</dt><dd>' + esc(a.Handled_Date) + '</dd>' : '') + '</dl>' +
      '<h3 class="hx-t">History</h3>' +
      (a.Email_Sent_At
        ? ourEmail(v) + (v.replies && v.replies.length ? replyCards(v) : '<p class="sm muted">No customer reply found in the emsupport@ mailbox.</p>') +
          '<div id="h-ans"><p class="sm muted">Loading our answer…</p></div>'
        : '<p class="sm muted">No email went to the customer for this alert.</p>') +
      (v.log ? '<details class="hx-log"><summary>Log</summary><p class="sm">' + esc(v.log) + '</p></details>' : '') +
      (v.lane === 'action' ? '<p class="sm muted">There is no email to approve. Handle this in the record, then set its Resolution.</p>' : '') +
      (closed ? '<p class="sm muted" id="h-re-note" hidden>Reopening sets the alert back to Open and clears its Resolution. It goes to ' + esc(reopenLane(a)) +
        '. Nothing is emailed. If the stock count no longer trips, tonight\'s count closes it again.</p>' : '') +
      '<div class="dact">' + (closed ? '<button type="button" class="btn" id="h-re">Reopen</button>' : '') + recLink(v) + '</div><div id="h-res" role="status"></div>';
    J.drawer.open({ title: v.account, html: html, onMount: function (b) {
      var q = function (s) { return b.querySelector(s); };
      q('[data-open]').addEventListener('click', function () { openRecord(v.id); });
      if (a.Email_Sent_At) loadNotes(v.id).then(function (n) { var el = q('#h-ans'); if (el) el.innerHTML = answerCards(n); });
      var re = q('#h-re'), armed = false;
      if (re) re.addEventListener('click', function () {
        if (!armed) { armed = true; q('#h-re-note').hidden = false; re.textContent = 'Confirm: reopen'; re.classList.add('pri'); return; }
        re.disabled = true;
        reopen(v).then(function (r) {
          q('#h-res').innerHTML = '<p class="' + (r.ok ? '' : 'errtxt') + '"><b>' + (r.ok ? 'Reopened' : 'Not done') + '.</b> ' + esc(r.ok ? 'It is back under ' + reopenLane(a) + '.' : (r.message || '')) + '</p>';
          if (r.ok) load().then(function () { setTimeout(J.drawer.close, 1200); });
          else { re.disabled = false; armed = false; re.textContent = 'Reopen'; re.classList.remove('pri'); }
        });
      });
    } });
  }

  /* ---------------- S47c: customer replied ---------------- */
  function decideAs(id, action, d) {
    var args = { alertId: String(id), action: action, subject: d ? d.subject : '', body: d ? d.body : '', recipients: d ? d.recipients : '',
      senderName: S.who || '', senderEmail: S.email || '' };
    if (S.demo) return demoReply(args);
    return J.crm.run('stock_alert_decide_as', args).then(function (r) {
      if (r && typeof r === 'object' && 'ok' in r) return r;
      return { ok: false, message: 'The function gave an unexpected answer: ' + String(r).slice(0, 200) };
    }, function (e) { return { ok: false, message: J.crm.error(e).message }; });
  }
  function day(s) { return String(s || '').slice(0, 10); }
  /* S47e: By month. Alerts raised (by type), order confirmations and no-order thank-yous sent. */
  function nowYM() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function monthRows() {
    var list = window.StockMonths.monthly(S.rows.map(function (v) { return v.raw; }), nowYM(), 12);
    return list.length > 1 ? list.concat([window.StockMonths.totals(list)]) : list;
  }
  function monthCols() {
    var b = function (n) { return n ? '<b>' + n + '</b>' : '<span class="muted">0</span>'; };
    var parts = function (r) { var x = []; if (r.low) x.push(r.low + ' low'); if (r.excess) x.push(r.excess + ' excess'); if (r.house) x.push(r.house + ' house'); if (r.growth) x.push(r.growth + ' growth'); return x.length ? ' <span class="muted sm">(' + x.join(', ') + ')</span>' : ''; };
    return [
      { key: 'month', label: 'Month', render: function (r) { return r.id === 'total' ? '<b>Total</b>' : esc(r.month); } },
      { key: 'raised', label: 'Stock alerts raised', render: function (r) { return b(r.raised) + parts(r); } },
      { key: 'ordered', label: 'Ordered emails sent', render: function (r) { return b(r.ordered); } },
      { key: 'notOrdered', label: 'No order needed emails sent', render: function (r) { return b(r.notOrdered); } }
    ];
  }
  function replyDrawer(v) {
    var a = v.raw, rp = v.replies && v.replies[0];
    var drafts = { ordered: R.confirmation(a, rp, v.account), no_order: R.noOrderNote(a, rp, v.account) };
    var html = '<p class="muted sm">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +
      (a.Email_Sent_At ? '<details class="hx-our"><summary>Our email to the customer, sent ' + esc(day(a.Email_Sent_At)) + '</summary>' + ourEmail(v) + '</details>' : '') +
      (rp ? '<div class="reply"><div class="eyebrow">Reply from ' + esc(rp.Sender_Name || rp.Sender_Email) + (rp.Sender_Name && rp.Sender_Email ? ' &lt;' + esc(rp.Sender_Email) + '&gt;' : '') +
              (rp.Created_Time ? ' · ' + esc(day(rp.Created_Time)) : '') + '</div><div class="replytxt">' + esc(R.cleanBody(rp.Body) || '(The reply has no text.)') + '</div>' +
              (v.replies.length > 1 ? '<p class="sm muted">' + plural(v.replies.length - 1, 'earlier reply', 'earlier replies') + ' on the same email.</p>' : '') + '</div>'
          : '<p class="sm muted">No reply has come in by email yet. If the customer answered another way, you can still close the alert here.</p>') +
      '<dl class="dl"><dt>Email sent</dt><dd>' + esc(day(a.Email_Sent_At) || '-') + '</dd><dt>Subject</dt><dd>' + esc(v.subject || '-') + '</dd>' +
      (v.to.length ? '<dt>Sent to</dt><dd>' + esc(v.to.join(', ')) + '</dd>' : '') + '</dl>' +
      '<div class="dact" id="r-act"><button type="button" class="btn pri" id="r-ord">Ordered</button>' +
      '<button type="button" class="btn" id="r-no">No Order Needed</button>' + recLink(v) + '</div>' +
      '<div class="rconf" id="r-conf" hidden><h3 id="r-h">Order confirmation</h3>' +
      '<label class="eyebrow" for="r-to">To</label><textarea class="fld" id="r-to" rows="2"></textarea><div class="errtxt" id="r-to-e" hidden></div>' +
      '<label class="eyebrow" for="r-sub">Subject</label><input class="fld" id="r-sub">' +
      '<label class="eyebrow" for="r-body">Message</label><textarea class="fld" id="r-body"></textarea>' +
      '<p class="sm muted">Blank line = new paragraph. <code>{{sender}}</code> becomes your name when the email goes out.</p>' +
      '<div class="sendnote" id="r-note"></div>' +
      '<div class="rprev" id="r-prev" hidden></div>' +
      '<div class="dact"><button type="button" class="btn pri" id="r-send">Send confirmation</button><button type="button" class="btn" id="r-cancel">Cancel</button></div></div>' +
      '<div id="r-res" role="status"></div>';
    J.drawer.open({ title: v.account, html: html, onMount: function (b) {
      var q = function (s) { return b.querySelector(s); };
      var to = q('#r-to'), sub = q('#r-sub'), bod = q('#r-body'), note = q('#r-note'), armed = false, picker = false, mode = null;
      var MODE = {
        ordered: { h: 'Order confirmation', send: 'Review and send', confirm: 'Confirm: send and mark Ordered', ok: 'Ordered',
          note: ', marks the alert Ordered and closes it as Order placed.' },
        no_order: { h: 'Thank-you email (no order needed)', send: 'Review and send', confirm: 'Confirm: send thank-you and close', ok: 'Closed',
          note: ' and closes the alert as Customer declined. No order is placed.' }
      };
      function rc() { return M.recipientCheck(to.value); }
      function paintNote() { if (mode) note.textContent = 'Sends from ' + (S.who || 'you') + ' to ' + plural(rc().good.length, 'person', 'people') + MODE[mode].note; }
      function disarm() { armed = false; q('#r-prev').hidden = true; if (mode) q('#r-send').textContent = MODE[mode].send; }
      function grow() { bod.style.height = 'auto'; bod.style.height = (bod.scrollHeight + 4) + 'px'; }
      /* the email exactly as it will go out: your name in place of {{sender}} */
      function showPreview() {
        var pv = q('#r-prev');
        pv.innerHTML = '<div class="eyebrow">' + esc(mode === 'no_order' ? 'This thank-you will go out when you confirm' : 'This confirmation will go out when you confirm') + '</div>' +
          '<dl class="dl"><dt>From</dt><dd>' + esc(S.who || 'you') + ' (replies go to emsupport@justicepoint.org)</dd>' +
          '<dt>To</dt><dd>' + esc(M.splitRecipients(to.value).join(', ')) + '</dd><dt>Subject</dt><dd>' + esc(sub.value.trim()) + '</dd></dl>' +
          '<div class="prevbody">' + M.textToHtml(M.previewText(bod.value, S.who)) + '</div>';
        pv.hidden = false;
        if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
      }
      function busy(on) { Array.prototype.forEach.call(b.querySelectorAll('button'), function (x) { if (!x.hasAttribute('data-open')) x.disabled = on; }); S.busy = on; }
      function done(r, okText) {
        busy(false); disarm();
        q('#r-res').innerHTML = '<p class="' + (r.ok ? '' : 'errtxt') + '"><b>' + esc(r.ok ? okText : 'Not done') + '.</b> ' + esc(r.message || '') + '</p>';
        if (r.ok) load().then(function () { setTimeout(J.drawer.close, 1200); });
      }
      /* one editor for both answers; the To list carries over, the subject and message switch with the answer */
      function openMode(m) {
        var first = !picker;
        mode = m; var d = drafts[m];
        if (first) to.value = d.to.join(', ');
        sub.value = d.subject; bod.value = d.text;
        q('#r-h').textContent = MODE[m].h; q('#r-conf').hidden = false;
        q('#r-ord').classList.toggle('pri', m === 'ordered'); q('#r-no').classList.toggle('pri', m === 'no_order');
        if (first && window.JPKRecip) { picker = true; JPKRecip.mount(to, { load: function () { return pickPeople(a); } }); }
        disarm(); paintNote(); grow(); sub.focus();
      }
      sub.addEventListener('input', disarm);
      bod.addEventListener('input', function () { disarm(); grow(); });
      to.addEventListener('input', function () { disarm(); paintNote(); });
      q('[data-open]').addEventListener('click', function () { openRecord(v.id); });
      q('#r-ord').addEventListener('click', function () { openMode('ordered'); });
      q('#r-no').addEventListener('click', function () { openMode('no_order'); });
      q('#r-cancel').addEventListener('click', function () { q('#r-conf').hidden = true; mode = null; armed = false; q('#r-ord').classList.add('pri'); q('#r-no').classList.remove('pri'); });
      q('#r-send').addEventListener('click', function () {
        if (!mode) return;
        var c = rc(), e = q('#r-to-e');
        to.classList.toggle('err', !c.ok); e.hidden = c.ok;
        e.textContent = c.good.length ? 'Not a valid address: ' + c.bad.join(', ') : 'Add at least one recipient.';
        if (!c.ok) return;
        if (!sub.value.trim() || !bod.value.trim()) { q('#r-res').innerHTML = '<p class="errtxt">The email needs a subject and a message.</p>'; return; }
        if (!armed) { armed = true; showPreview(); this.textContent = MODE[mode].confirm; return; }
        busy(true); var m = mode;
        decideAs(v.id, m, { subject: sub.value.trim(), body: M.textToHtml(bod.value), recipients: M.splitRecipients(to.value).join(', ') })
          .then(function (r) { done(r, MODE[m].ok); });
      });
    } });
  }
  function demoReply(a) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var rec = null; window.STOCK_DEMO.forEach(function (r) { if (String(r.id) === a.alertId) rec = r; });
        if (!rec) return resolve({ ok: false, message: 'Alert not found.' });
        if (rec.Status !== 'Open' || rec.Email_Status !== 'Sent') return resolve({ ok: false, message: 'Not changed: this alert is not waiting on the customer.' });
        if (a.action === 'no_order') { window.STOCK_DEMO_NOTES = window.STOCK_DEMO_NOTES || {}; (window.STOCK_DEMO_NOTES[a.alertId] = window.STOCK_DEMO_NOTES[a.alertId] || []).push({ Note_Title: 'Thank-you sent (no order needed): ' + a.subject, Note_Content: 'To: ' + a.recipients + '\n\n' + M.previewText(M.htmlToText(a.body), S.who), Created_Time: new Date().toISOString() }); rec.Status = 'Dismissed'; rec.Resolution = 'Customer declined'; rec.Handled_Date = new Date().toISOString().slice(0, 10); rec.Send_Log = (rec.Send_Log || '') + ' | Thank-you sent by ' + S.who + '.'; return resolve({ ok: true, message: 'Closed: no order needed. The thank-you went to ' + M.splitRecipients(a.recipients).length + ' recipient(s).', alertStatus: 'Dismissed' }); }
        window.STOCK_DEMO_NOTES = window.STOCK_DEMO_NOTES || {}; (window.STOCK_DEMO_NOTES[a.alertId] = window.STOCK_DEMO_NOTES[a.alertId] || []).push({ Note_Title: 'Order confirmation sent: ' + a.subject, Note_Content: 'To: ' + a.recipients + '\n\n' + M.previewText(M.htmlToText(a.body), S.who), Created_Time: new Date().toISOString() });
        rec.Status = 'Ordered'; rec.Resolution = 'Order placed'; rec.Handled_Date = new Date().toISOString().slice(0, 10); rec.Send_Log = (rec.Send_Log || '') + ' | order confirmation sent by ' + S.who + '.';
        resolve({ ok: true, message: 'Marked Ordered. The confirmation went to ' + M.splitRecipients(a.recipients).length + ' recipient(s).', alertStatus: 'Done' });
      }, 120);
    });
  }

  /* ---------------- demo function ---------------- */
  function demoDecide(a) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        var rec = null; window.STOCK_DEMO.forEach(function (r) { if (String(r.id) === a.alertId) rec = r; });
        if (!rec) return resolve({ ok: false, message: 'Alert not found.' });
        if (rec.Email_Status !== 'Awaiting approval') return resolve({ ok: false, message: 'Not changed: this alert is no longer awaiting approval (email status is ' + rec.Email_Status + ').', emailStatus: rec.Email_Status });
        if (a.subject) rec.Draft_Subject = a.subject;
        if (a.body) rec.Draft_Body = a.body;
        if (a.recipients) rec.Recipient_Emails = a.recipients;
        if (a.action === 'save') return resolve({ ok: true, message: 'Draft saved.', emailStatus: 'Awaiting approval' });
        if (a.action === 'reject') { rec.Email_Status = 'Rejected'; rec.Status = 'Dismissed'; return resolve({ ok: true, message: 'Rejected. Nothing was sent.', emailStatus: 'Rejected' }); }
        if (/^fail@/.test(rec.Recipient_Emails)) return resolve({ ok: false, message: 'Not sent. Mail server refused the address.', emailStatus: 'Awaiting approval' });
        rec.Email_Status = 'Sent'; rec.Email_Sent_At = '2026-10-12';
        resolve({ ok: true, message: 'Sent from ' + S.who + '.', emailStatus: 'Sent' });
      }, 120);
    });
  }

  /* ---------------- boot ---------------- */
  function boot(data) {
    S.demo = !!data.demo;
    document.getElementById('demo-flag').hidden = !S.demo;
    if (S.demo) { S.who = 'Beau Carrigan (demo)'; return load(); }
    var p = (window.ZOHO && ZOHO.CRM && ZOHO.CRM.CONFIG && ZOHO.CRM.CONFIG.getCurrentUser) ? ZOHO.CRM.CONFIG.getCurrentUser() : Promise.resolve(null);
    return p.then(function (r) { var u = r && r.users && r.users[0]; S.who = u ? u.full_name : ''; S.email = u && u.email ? u.email : ''; }, function () {}).then(load);
  }
  J.crm.init().then(boot);
})();
