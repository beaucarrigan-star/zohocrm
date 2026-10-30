"""S47c (30 Oct 2026): customer replies on the Stock Alerts tab, with Ordered / No Order Needed.
Base: the S47 build (widget-stock-alerts-s47-recip.zip): stock.html 2baf3516a7398c9f, stock.js f4c2c49264b8431c.
Refuses any other base. Usage: python3 patch_s47c_replies.py SA_DIR stock-replies.js
"""
import sys, hashlib, pathlib

h = lambda b: hashlib.sha256(b).hexdigest()[:16]
def die(m): sys.exit('REFUSED: ' + m)
def sub(text, old, new, label):
    n = text.count(old)
    if n != 1: die(f'{label}: expected 1 match, found {n}')
    return text.replace(old, new)

sa, rep = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for p, want in {sa / 'app/stock.html': '2baf3516a7398c9f', sa / 'app/stock.js': 'f4c2c49264b8431c'}.items():
    got = h(p.read_bytes())
    if got != want: die(f'{p} is {got}, expected {want}')
(sa / 'app/stock-replies.js').write_text(rep.read_text(encoding='utf-8'), encoding='utf-8')

# ---------- stock.html ----------
p = sa / 'app/stock.html'; t = p.read_text(encoding='utf-8')
t = sub(t, 'content="Stock Alerts tab (S47: To picker jpk-recip v1.0.0, 30 Oct 2026)"',
        'content="Stock Alerts tab (S47c: customer replies, Ordered / No Order Needed, 30 Oct 2026)"', 'html build')
t = sub(t, '<script src="stock-model.js"></script>', '<script src="stock-model.js"></script>\n<script src="stock-replies.js"></script>', 'html script')
t = sub(t, 'data-what="Approve or reject the low-stock and excess-stock emails to customers, and see what is waiting, sent or closed."',
        'data-what="Approve or reject the low-stock and excess-stock emails to customers, see who has replied, mark replies Ordered or No Order Needed, and see what is waiting, sent or closed."', 'html intro')
p.write_text(t, encoding='utf-8')

# ---------- stock.css ----------
p = sa / 'app/stock.css'; t = p.read_text(encoding='utf-8')
t += ('\n/* S47c: customer reply */\n'
      '.reply{border-left:3px solid var(--accent,#1f6f7a);padding:8px 12px;margin:8px 0 12px;border-radius:4px;background:color-mix(in srgb,currentColor 4%,transparent)}\n'
      '.replytxt{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px;line-height:1.45}\n'
      '.rconf{border-top:1px solid var(--line);margin-top:14px;padding-top:12px}\n'
      '.rconf[hidden]{display:none}\n'
      '.rconf h3{margin:0 0 8px;font-size:15px}\n'
      '.rprev{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:8px 0 10px}\n'
      '.rprev[hidden]{display:none}\n'
      '.rprev .dl{margin:6px 0 8px}\n'
      '.prevbody{border-top:1px solid var(--line);padding-top:8px;line-height:1.45}\n'
      '.prevbody p{margin:0 0 10px}\n'
      '#r-body{min-height:160px;overflow:hidden}\n')
p.write_text(t, encoding='utf-8')

# ---------- stock-js ----------
p = sa / 'app/stock.js'; t = p.read_text(encoding='utf-8')
t = sub(t, "var J = window.JPK, M = window.StockModel, esc = J.esc;",
        "var J = window.JPK, M = window.StockModel, R = window.StockReplies, esc = J.esc;", 'js R')
t = sub(t, "var S = { demo: false, rows: [], tab: 'approve', sel: {}, who: '', busy: false, loadErr: null };",
        "var S = { demo: false, rows: [], tab: 'approve', sel: {}, who: '', email: '', busy: false, loadErr: null, mail: [], mailErr: null };", 'js S')
t = sub(t, "tabs: [{ id: 'approve', label: 'Needs approval', count: 0 }, { id: 'action', label: 'Needs action', count: 0 },",
        "tabs: [{ id: 'approve', label: 'Needs approval', count: 0 }, { id: 'replied', label: 'Customer replied', count: 0 }, { id: 'action', label: 'Needs action', count: 0 },", 'js tabs')
# load replies with the alerts; a reply moves a Waiting alert into Customer replied
t = sub(t, "  function setRows(raw) { S.rows = raw.map(M.view); }",
        "  function setRows(raw) {\n"
        "    S.rows = raw.map(function (a) {\n"
        "      var v = M.view(a);\n"
        "      if (v.lane === 'waiting') {\n"
        "        v.replies = R.repliesFor(a, S.mail || []);\n"
        "        if (v.replies.length) { v.lane = 'replied'; v.laneLabel = 'Customer replied'; v.repliedAt = v.replies[0].Created_Time || ''; v.replyFrom = v.replies[0].Sender_Name || v.replies[0].Sender_Email || ''; }\n"
        "      }\n"
        "      return v;\n"
        "    });\n"
        "  }\n"
        "  /* S47c: inbound mail since the oldest waiting email went out (Support Emails, fed by the emsupport@ mailbox) */\n"
        "  function loadReplies(raw) {\n"
        "    if (S.demo) { S.mail = (window.STOCK_DEMO_MAIL || []).slice(); return Promise.resolve(); }\n"
        "    var waiting = raw.filter(function (a) { return M.laneOf(a) === 'waiting'; });\n"
        "    if (!waiting.length) { S.mail = []; return Promise.resolve(); }\n"
        "    return J.crm.coqlAll(R.query(R.sinceDay(waiting))).then(function (m) { S.mail = m || []; S.mailErr = null; },\n"
        "      function (e) { S.mail = []; S.mailErr = J.crm.error(e).message; });\n"
        "  }", 'js setRows')
t = sub(t, "    if (S.demo) { setRows(window.STOCK_DEMO.map(function (r) { return JSON.parse(JSON.stringify(r)); })); render(); return Promise.resolve(); }\n"
           "    return J.crm.coqlAll(M.QUERY).then(function (rows) { S.loadErr = null; setRows(rows); render(); },",
        "    if (S.demo) { var dr = window.STOCK_DEMO.map(function (r) { return JSON.parse(JSON.stringify(r)); }); return loadReplies(dr).then(function () { setRows(dr); render(); }); }\n"
        "    return J.crm.coqlAll(M.QUERY).then(function (rows) { S.loadErr = null; return loadReplies(rows).then(function () { setRows(rows); render(); }); },", 'js load')
t = sub(t, "    tabsApi.setCount('waiting', c.waiting); tabsApi.setCount('closed', c.done + c.dismissed);",
        "    var nRep = laneRows('replied').length;\n"
        "    tabsApi.setCount('replied', nRep);\n"
        "    tabsApi.setCount('waiting', c.waiting - nRep); tabsApi.setCount('closed', c.done + c.dismissed);", 'js counts')
t = sub(t, "    if (isA || S.tab === 'waiting') cols.push({ key: 'subject', label: 'Email subject', render: function (r) { return esc(r.subject); } });",
        "    if (isA || S.tab === 'waiting') cols.push({ key: 'subject', label: 'Email subject', render: function (r) { return esc(r.subject); } });\n"
        "    if (S.tab === 'replied') {\n"
        "      cols.push({ key: 'replyFrom', label: 'Reply from', sortable: true, render: function (r) { return esc(r.replyFrom); } });\n"
        "      cols.push({ key: 'repliedAt', label: 'Replied', sortable: true, render: function (r) { return esc(String(r.repliedAt || '').slice(0, 10)); } });\n"
        "    }", 'js cols')
t = sub(t, "    var empties = { approve: ['Nothing waiting for approval', 'New drafts appear after the nightly count.'], action: ['Nothing needs action', ''],",
        "    var empties = { approve: ['Nothing waiting for approval', 'New drafts appear after the nightly count.'], action: ['Nothing needs action', ''],\n"
        "      replied: ['No customer replies to handle', S.mailErr ? 'Replies could not be read: ' + S.mailErr : 'When a customer answers a stock email, it shows here to mark Ordered or No Order Needed.'],", 'js empties')
t = sub(t, "    else strip.update({ title: 'No emails are waiting for approval.',",
        "    else if (nRep) strip.update({ title: plural(nRep, 'customer has', 'customers have') + ' replied to a stock email.', sub: 'Open a reply to mark it Ordered (a confirmation email goes out) or No Order Needed.', button: null });\n"
        "    else strip.update({ title: 'No emails are waiting for approval.',", 'js strip')
t = sub(t, "    if (v.lane !== 'approve') { openReadOnly(v); return; }",
        "    if (v.lane === 'replied' || v.lane === 'waiting') { replyDrawer(v); return; }\n"
        "    if (v.lane !== 'approve') { openReadOnly(v); return; }", 'js open')
t = sub(t, "      '<ol><li><b>Needs approval.</b>",
        "      '<ol><li><b>Customer replied.</b> A customer answered a stock email. Read the reply, then press <b>Ordered</b> (you check and send a short order confirmation, and the alert closes as Order placed) or <b>No Order Needed</b> (you check and send a short thank-you that invites them to reply if things change, and the alert closes as Customer declined). Waiting alerts have the same two buttons for answers that came by phone.</li>' +\n"
        "      '<li><b>Needs approval.</b>", 'js help')
# boot: keep the user's email for Reply-To / the user lookup
t = sub(t, "return p.then(function (r) { S.who = r && r.users && r.users[0] ? r.users[0].full_name : ''; }, function () {}).then(load);",
        "return p.then(function (r) { var u = r && r.users && r.users[0]; S.who = u ? u.full_name : ''; S.email = u && u.email ? u.email : ''; }, function () {}).then(load);", 'js boot')
# the drawer and the calls
drawer = r"""
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
  function replyDrawer(v) {
    var a = v.raw, rp = v.replies && v.replies[0];
    var drafts = { ordered: R.confirmation(a, rp, v.account), no_order: R.noOrderNote(a, rp, v.account) };
    var html = '<p class="muted sm">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +
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
        if (a.action === 'no_order') { rec.Status = 'Dismissed'; rec.Resolution = 'Customer declined'; rec.Handled_Date = new Date().toISOString().slice(0, 10); rec.Send_Log = (rec.Send_Log || '') + ' | Thank-you sent by ' + S.who + '.'; return resolve({ ok: true, message: 'Closed: no order needed. The thank-you went to ' + M.splitRecipients(a.recipients).length + ' recipient(s).', alertStatus: 'Dismissed' }); }
        rec.Status = 'Ordered'; rec.Resolution = 'Order placed'; rec.Handled_Date = new Date().toISOString().slice(0, 10); rec.Send_Log = (rec.Send_Log || '') + ' | order confirmation sent by ' + S.who + '.';
        resolve({ ok: true, message: 'Marked Ordered. The confirmation went to ' + M.splitRecipients(a.recipients).length + ' recipient(s).', alertStatus: 'Done' });
      }, 120);
    });
  }

  /* ---------------- demo function ---------------- */"""
t = sub(t, "\n  /* ---------------- demo function ---------------- */", drawer, 'js drawer')
p.write_text(t, encoding='utf-8')

# ---------- demo data: one reply to the Cook Co email ----------
p = sa / 'app/demo-data.js'; t = p.read_text(encoding='utf-8')
t += ('\nwindow.STOCK_DEMO_MAIL = [{ id: "m1", Name: "RE: Spare GPS units for Cook Co Sheriff - recommend sending 2", Direction: "In",\n'
      '  Sender_Email: "a@cook.example", Sender_Name: "Alex Rivera", Created_Time: "2026-10-13T09:12:00-05:00", Account: { id: "ad8" },\n'
      '  Body: "Hi,\\n\\n2 more devices would be great.\\n\\nBest regards,\\nAlex Rivera\\n\\nCONFIDENTIALITY NOTICE: This Email is covered by...\\n\\nFrom: Beau Carrigan\\nSent: Friday, October 9, 2026\\nSubject: Spare GPS units..." }];\n')
p.write_text(t, encoding='utf-8')
print('patched')

# ---------- S47e: By month ----------
mo = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else pathlib.Path(__file__).with_name('stock-months.js')
(sa / 'app/stock-months.js').write_text(mo.read_text(encoding='utf-8'), encoding='utf-8')
p = sa / 'app/stock.html'; t = p.read_text(encoding='utf-8')
t = sub(t, '<script src="stock-replies.js"></script>', '<script src="stock-replies.js"></script>\n<script src="stock-months.js"></script>', 'html months')
p.write_text(t, encoding='utf-8')
p = sa / 'app/stock-model.js'; t = p.read_text(encoding='utf-8')
t = sub(t, "'Email_Sent_At', 'Last_Seen', 'Send_Log'];", "'Email_Sent_At', 'Last_Seen', 'Send_Log', 'Resolution', 'First_Raised', 'Handled_Date', 'Created_Time'];", 'model fields')
t = t.replace("'Status', 'Email_Status', 'Resolution', 'Draft_Subject'", "'Status', 'Email_Status', 'Draft_Subject'")   # Resolution now listed once, at the end
p.write_text(t, encoding='utf-8')
p = sa / 'app/stock.js'; t = p.read_text(encoding='utf-8')
t = sub(t, "{ id: 'waiting', label: 'Waiting on customer', count: 0 }, { id: 'closed', label: 'Closed', count: 0 }]",
        "{ id: 'waiting', label: 'Waiting on customer', count: 0 }, { id: 'closed', label: 'Closed', count: 0 }, { id: 'months', label: 'By month' }]", 'js months tab')
t = sub(t, "    var rows = laneRows(S.tab), isA = S.tab === 'approve';",
        "    var rows = laneRows(S.tab), isA = S.tab === 'approve', isM = S.tab === 'months';", 'js isM')
t = sub(t, "      mount: '#tbl', caption: 'Stock alerts: ' + S.tab, columns: cols, rows: rows,\n"
           "      empty: { title: empties[S.tab][0], hint: empties[S.tab][1] },\n"
           "      onRowClick: function (r) { openAlert(r.id); }",
        "      mount: '#tbl', caption: isM ? 'Stock alerts and customer emails by month' : 'Stock alerts: ' + S.tab, columns: isM ? monthCols() : cols, rows: isM ? monthRows() : rows,\n"
        "      empty: isM ? { title: 'Nothing to count yet', hint: '' } : { title: empties[S.tab][0], hint: empties[S.tab][1] },\n"
        "      onRowClick: isM ? null : function (r) { openAlert(r.id); }", 'js table')
t = sub(t, "  function day(s) { return String(s || '').slice(0, 10); }",
        "  function day(s) { return String(s || '').slice(0, 10); }\n"
        "  /* S47e: By month. Alerts raised (by type), order confirmations and no-order thank-yous sent. */\n"
        "  function nowYM() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }\n"
        "  function monthRows() {\n"
        "    var list = window.StockMonths.monthly(S.rows.map(function (v) { return v.raw; }), nowYM(), 12);\n"
        "    return list.length > 1 ? list.concat([window.StockMonths.totals(list)]) : list;\n"
        "  }\n"
        "  function monthCols() {\n"
        "    var b = function (n) { return n ? '<b>' + n + '</b>' : '<span class=\"muted\">0</span>'; };\n"
        "    var parts = function (r) { var x = []; if (r.low) x.push(r.low + ' low'); if (r.excess) x.push(r.excess + ' excess'); if (r.house) x.push(r.house + ' house'); if (r.growth) x.push(r.growth + ' growth'); return x.length ? ' <span class=\"muted sm\">(' + x.join(', ') + ')</span>' : ''; };\n"
        "    return [\n"
        "      { key: 'month', label: 'Month', render: function (r) { return r.id === 'total' ? '<b>Total</b>' : esc(r.month); } },\n"
        "      { key: 'raised', label: 'Stock alerts raised', render: function (r) { return b(r.raised) + parts(r); } },\n"
        "      { key: 'ordered', label: 'Ordered emails sent', render: function (r) { return b(r.ordered); } },\n"
        "      { key: 'notOrdered', label: 'No order needed emails sent', render: function (r) { return b(r.notOrdered); } }\n"
        "    ];\n"
        "  }", 'js month fns')
t = sub(t, "      '<li><b>Needs approval.</b>",
        "      '<li><b>By month.</b> Stock alerts raised each month (by the day first raised, split by type), and the Ordered and No Order Needed emails sent each month (by the day they went out; counted from 30 Oct 2026).</li>' +\n"
        "      '<li><b>Needs approval.</b>", 'js help months')
p.write_text(t, encoding='utf-8')
p = sa / 'app/demo-data.js'; t = p.read_text(encoding='utf-8')
t += ("\n/* S47e demo: first-raised days so By month has something to show */\n"
      "window.STOCK_DEMO.forEach(function (r, i) { if (!r.First_Raised) r.First_Raised = i % 4 === 0 ? '2026-09-1' + (i % 9) : (r.Last_Seen || '2026-10-12'); });\n")
p.write_text(t, encoding='utf-8')
print('S47e patched')

# ---------- S47f: history of each alert (our email, customer reply, our answer) and Reopen ----------
p = sa / 'app/stock-model.js'; t = p.read_text(encoding='utf-8')
t = sub(t, "'First_Raised', 'Handled_Date', 'Created_Time'];", "'First_Raised', 'Handled_Date', 'Created_Time', 'Handled_By', 'Draft_Body'];", 'model fields 2')
p.write_text(t, encoding='utf-8')
p = sa / 'app/stock.css'; t = p.read_text(encoding='utf-8')
t += ('\n/* S47f: history */\n'
      '.hx{border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:8px 0}\n'
      '.hx-dl{margin:4px 0 8px}\n'
      '.hx-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;border-top:1px solid var(--line);padding-top:8px}\n'
      '.hx-t{font-size:15px;margin:16px 0 4px}\n'
      '.hx-log,.hx-our{margin:8px 0}\n'
      '.hx-log summary,.hx-our summary{cursor:pointer;font-size:13px;color:var(--muted)}\n')
p.write_text(t, encoding='utf-8')
p = sa / 'app/stock.js'; t = p.read_text(encoding='utf-8')
# replies are looked up for every alert that had an email, so closed alerts keep their history
t = sub(t, "    var waiting = raw.filter(function (a) { return M.laneOf(a) === 'waiting'; });\n"
           "    if (!waiting.length) { S.mail = []; return Promise.resolve(); }\n"
           "    return J.crm.coqlAll(R.query(R.sinceDay(waiting))).then(",
        "    var sent = raw.filter(function (a) { return !!a.Email_Sent_At; });\n"
        "    if (!sent.length) { S.mail = []; return Promise.resolve(); }\n"
        "    return J.crm.coqlAll(R.query(R.sinceDay(sent))).then(", 'js loadReplies all')
t = sub(t, "      if (v.lane === 'waiting') {\n        v.replies = R.repliesFor(a, S.mail || []);\n        if (v.replies.length) {",
        "      v.replies = a.Email_Sent_At ? R.repliesFor(a, S.mail || []) : [];\n      if (v.lane === 'waiting') {\n        if (v.replies.length) {", 'js setRows all')
t = sub(t, "    if (v.lane !== 'approve') { openReadOnly(v); return; }", "    if (v.lane !== 'approve') { historyDrawer(v); return; }", 'js open history')
t = sub(t, "    var html = '<p class=\"muted sm\">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +\n      (rp ?",
        "    var html = '<p class=\"muted sm\">' + esc(v.type) + (v.ask ? ' | ' + esc(v.ask) : '') + '</p>' +\n"
        "      (a.Email_Sent_At ? '<details class=\"hx-our\"><summary>Our email to the customer, sent ' + esc(day(a.Email_Sent_At)) + '</summary>' + ourEmail(v) + '</details>' : '') +\n"
        "      (rp ?", 'js reply our email')
hist = r"""
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
"""
t = sub(t, "\n  /* ---------------- S47c: customer replied ---------------- */", hist + "\n  /* ---------------- S47c: customer replied ---------------- */", 'js history fns')
# demo: keep a note of the answer so the history shows it
t = sub(t, "rec.Status = 'Ordered'; rec.Resolution = 'Order placed';",
        "window.STOCK_DEMO_NOTES = window.STOCK_DEMO_NOTES || {}; (window.STOCK_DEMO_NOTES[a.alertId] = window.STOCK_DEMO_NOTES[a.alertId] || []).push({ Note_Title: 'Order confirmation sent: ' + a.subject, Note_Content: 'To: ' + a.recipients + '\\n\\n' + M.previewText(M.htmlToText(a.body), S.who), Created_Time: new Date().toISOString() });\n        rec.Status = 'Ordered'; rec.Resolution = 'Order placed';", 'js demo note ord')
t = sub(t, "if (a.action === 'no_order') { rec.Status = 'Dismissed';",
        "if (a.action === 'no_order') { window.STOCK_DEMO_NOTES = window.STOCK_DEMO_NOTES || {}; (window.STOCK_DEMO_NOTES[a.alertId] = window.STOCK_DEMO_NOTES[a.alertId] || []).push({ Note_Title: 'Thank-you sent (no order needed): ' + a.subject, Note_Content: 'To: ' + a.recipients + '\\n\\n' + M.previewText(M.htmlToText(a.body), S.who), Created_Time: new Date().toISOString() }); rec.Status = 'Dismissed';", 'js demo note no')
t = sub(t, "      '<li><b>By month.</b>",
        "      '<li><b>History and Reopen.</b> Open any alert to see its history: our email, the customer\\'s reply and our Ordered or No Order Needed answer. Closed alerts have a <b>Reopen</b> button (two clicks) that puts them back to work.</li>' +\n"
        "      '<li><b>By month.</b>", 'js help history')
p.write_text(t, encoding='utf-8')
p = sa / 'app/demo-data.js'; t = p.read_text(encoding='utf-8')
t += ("\n/* S47f demo: the Cook Co email went out on 9 Oct */\n"
      "window.STOCK_DEMO.forEach(function (r) { if (r.id === 'd8') { r.Email_Sent_At = '2026-10-09T10:05:00-05:00'; r.Send_Log = 'Sent 2026-10-09 10:05 from beau@example (replies to emsupport@justicepoint.org) as Beau Carrigan to a@cook.example. Approved on the home page.';\n"
      "  r.Draft_Body = '<p>Hello,</p><p>Our count for Oct 8, 2026 shows Cook Co Sheriff with 1 spare GPS unit(s) against 16 active.</p><p>For a program with 16 active, we like to hold 3 spare GPS unit(s). Below that level, a new enrollment could end up waiting on hardware.</p><p>We recommend sending 2 additional GPS unit(s). Reply to confirm and we will ship them out. Please also let us know if other accessories are needed.</p><p>Thank you,<br>{{sender}}</p>'; } });\n")
p.write_text(t, encoding='utf-8')
print('S47f patched')

# ---------- S47g: account name (COQL returns the Account lookup as an id only, so the old Name fallback gave "GPS") ----------
p = sa / 'app/stock-model.js'; t = p.read_text(encoding='utf-8')
t = sub(t, "'Created_Time', 'Handled_By', 'Draft_Body'];", "'Created_Time', 'Handled_By', 'Draft_Body', 'Account.Account_Name', 'SmartView_Customer'];", 'model fields 3')
t = sub(t, "    if (a['Account.name']) return a['Account.name'];\n    var m = /^[^-]+ - [^-]+ - (.+)$/.exec(a.Name || '');\n    return m ? m[1] : 'No account';",
        "    if (a['Account.Account_Name']) return a['Account.Account_Name'];\n"
        "    if (a['Account.name']) return a['Account.name'];\n"
        "    /* S47g: no account name: use the SmartView customer without the vendor or 'Justice Point - ' prefix, never the device family */\n"
        "    var sv = String(a.SmartView_Customer || '').replace(/^[^|]*\\|\\s*/, '').replace(/^Justice Point - /, '').trim();\n"
        "    if (sv) return sv;\n"
        "    var nm = String(a.Name || '').replace(/^(Customer spare floor|Excess spares|House stock|Program growth) - /, '').replace(/ - (GPS|CAM|RF|Remote Breath|Accessory|All)$/, '').replace(/^[^|]*\\|\\s*/, '').replace(/^Justice Point - /, '').trim();\n"
        "    return nm || 'No account';", 'model accountName')
p.write_text(t, encoding='utf-8')
print('S47g patched')
