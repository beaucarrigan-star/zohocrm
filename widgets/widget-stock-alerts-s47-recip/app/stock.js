/* Stock Alerts panel (Web Tab / button). Reads EM_Stock_Alerts with COQL; every change goes through the standalone
   function stock_alert_decide (approve | save | reject), one alert per call. Nothing is sent without a person clicking Approve.
   Outside the CRM (no Zoho SDK) it runs on demo data. */
(function () {
  'use strict';
  var J = window.JPK, M = window.StockModel, esc = J.esc;
  var S = { demo: false, rows: [], tab: 'approve', sel: {}, who: '', busy: false, loadErr: null };
  var tblApi = null;

  var strip = J.next({ mount: '#nx', title: 'Loading', button: null });
  var tabsApi = J.tabs({
    mount: '#tabs', label: 'Stock alert sections',
    tabs: [{ id: 'approve', label: 'Needs approval', count: 0 }, { id: 'action', label: 'Needs action', count: 0 },
      { id: 'waiting', label: 'Waiting on customer', count: 0 }, { id: 'closed', label: 'Closed', count: 0 }],
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
  function setRows(raw) { S.rows = raw.map(M.view); }
  function load() {
    if (S.demo) { setRows(window.STOCK_DEMO.map(function (r) { return JSON.parse(JSON.stringify(r)); })); render(); return Promise.resolve(); }
    return J.crm.coqlAll(M.QUERY).then(function (rows) { S.loadErr = null; setRows(rows); render(); },
      function (e) { S.loadErr = J.crm.error(e).message; render(); });
  }

  /* ---------------- render ---------------- */
  function render() {
    var c = M.counts(S.rows.map(function (v) { return v.raw; }));
    tabsApi.setCount('approve', c.approve); tabsApi.setCount('action', c.action);
    tabsApi.setCount('waiting', c.waiting); tabsApi.setCount('closed', c.done + c.dismissed);
    Object.keys(S.sel).forEach(function (k) { var v = byId(k); if (!v || v.lane !== 'approve') delete S.sel[k]; });
    var rows = laneRows(S.tab), isA = S.tab === 'approve';
    el.bar.hidden = !isA || !rows.length;
    var cols = [];
    if (isA) cols.push({ key: 'chk', label: '', render: function (r) { return '<input type="checkbox" data-sel="' + esc(r.id) + '" aria-label="Select ' + esc(r.account) + '"' + (S.sel[r.id] ? ' checked' : '') + '>'; } });
    cols.push({ key: 'account', label: 'Account', sortable: true, render: function (r) { return esc(r.account); } });
    cols.push({ key: 'type', label: 'Alert', sortable: true, render: function (r) { return esc(r.type); } });
    cols.push({ key: 'ask', label: 'The ask', sortable: true, render: function (r) { return esc(r.ask || '-'); } });
    if (isA || S.tab === 'waiting') cols.push({ key: 'subject', label: 'Email subject', render: function (r) { return esc(r.subject); } });
    if (isA) cols.push({ key: 'to', label: 'To', sortable: true, sortValue: function (r) { return r.to.length; }, render: function (r) { return r.to.length ? plural(r.to.length, 'person', 'people') : J.chip('No recipient', 'warn'); } });
    if (S.tab === 'waiting') cols.push({ key: 'sentAt', label: 'Sent', sortable: true, render: function (r) { return esc(String(r.sentAt || '').slice(0, 10)); } });
    if (S.tab === 'closed') cols.push({ key: 'laneLabel', label: 'Result', sortable: true, render: function (r) { return J.chip(r.laneLabel, r.lane === 'done' ? 'good' : 'neutral'); } });
    if (S.tab === 'action') cols.push({ key: 'detail', label: 'Why', render: function (r) { return esc(r.detail); } });
    var empties = { approve: ['Nothing waiting for approval', 'New drafts appear after the nightly count.'], action: ['Nothing needs action', ''],
      waiting: ['Nothing waiting on a customer', ''], closed: ['Nothing closed yet', ''] };
    tblApi = J.table({
      mount: '#tbl', caption: 'Stock alerts: ' + S.tab, columns: cols, rows: rows,
      empty: { title: empties[S.tab][0], hint: empties[S.tab][1] },
      onRowClick: function (r) { openAlert(r.id); }
    });
    syncBar();
    var n = c.approve;
    if (S.loadErr) strip.update({ title: 'Could not load the alerts.', sub: S.loadErr, button: null });
    else if (n) strip.update({ title: plural(n, 'email needs', 'emails need') + ' your approval.', sub: 'Open one to read or edit it, or tick several and approve them together.', button: null });
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
    if (v.lane !== 'approve') { openReadOnly(v); return; }
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
      '<ol><li><b>Needs approval.</b> Open a draft to read it, edit the recipients, subject or message, then Approve &amp; send (two clicks, so a stray tap cannot send). Or tick several and approve them together; you see the count before anything goes out.</li>' +
      '<li><b>Needs action.</b> No email applies (no recipient, rejected, or house stock). Handle it in the record.</li>' +
      '<li><b>Waiting on customer.</b> The email went out. Close the alert in the record when the customer answers.</li>' +
      '<li><b>Closed.</b> Resolved, ordered or dismissed.</li></ol>' +
      '<p>Rejecting dismisses the alert and sends nothing. Approved emails go from your own name and are logged on the alert.</p>'
  });

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
    return p.then(function (r) { S.who = r && r.users && r.users[0] ? r.users[0].full_name : ''; }, function () {}).then(load);
  }
  J.crm.init().then(boot);
})();
