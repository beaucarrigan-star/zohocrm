/* Stock Alerts: customer replies (S47c, 30 Oct 2026). Pure logic, no DOM and no Zoho, so node tests can load it.
   A reply to a stock alert email reaches emsupport@ and lands in Support Emails (Name = the subject, Direction = In).
   It belongs to an alert when its subject, without Re:/Fwd: prefixes, equals the alert's Draft_Subject, or when the sender
   was a recipient of the alert email, the account matches, it arrived after the alert email went out and its subject
   mentions spares or accessories. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockReplies = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FIELDS = ['id', 'Name', 'Sender_Email', 'Sender_Name', 'Body', 'Created_Time', 'Account', 'Case', 'Direction'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* COQL for inbound mail since a given day (YYYY-MM-DD). */
  function query(sinceDay) {
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(sinceDay || '')) ? sinceDay : '2026-01-01';
    return 'select ' + FIELDS.join(', ') + " from Support_Emails where ((Direction = 'In' and Created_Time >= '" + d + "T00:00:00+00:00') and (Name like '%pare%' or Name like '%ccessor%'))";
  }
  /* The earliest Email_Sent_At among the alerts waiting on a customer, as YYYY-MM-DD, or '' when none. */
  function sinceDay(alerts) {
    var min = '';
    (alerts || []).forEach(function (a) { var s = String(a.Email_Sent_At || '').slice(0, 10); if (s && (!min || s < min)) min = s; });
    return min;
  }
  function normSubject(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim(), prev;
    do { prev = t; t = t.replace(/^(re|fw|fwd|aw|sv|antw)\s*(\[\d+\])?\s*:\s*/i, ''); } while (t !== prev);
    return t.toLowerCase();
  }
  function lc(s) { return String(s || '').trim().toLowerCase(); }
  function idOf(x) { return x && typeof x === 'object' ? String(x.id || '') : String(x || ''); }
  function splitList(raw) { return String(raw || '').split(/[,;\n]+/).map(lc).filter(Boolean); }
  function time(s) { var t = Date.parse(s || ''); return isNaN(t) ? 0 : t; }

  /* Replies for one alert, newest first. */
  function repliesFor(alert, mail) {
    var subj = normSubject(alert.Draft_Subject), sent = time(alert.Email_Sent_At) - 5 * 60000;
    var to = splitList(alert.Recipient_Emails), acct = idOf(alert.Account);
    return (mail || []).filter(function (m) {
      if (m.Direction && m.Direction !== 'In') return false;
      var at = time(m.Created_Time);
      if (sent > 0 && at && at < sent) return false;
      if (subj && normSubject(m.Name) === subj) return true;
      return !!(acct && idOf(m.Account) === acct && to.indexOf(lc(m.Sender_Email)) >= 0 && sent > 0 && /spare|accessor/i.test(m.Name || ''));
    }).sort(function (a, b) { return time(b.Created_Time) - time(a.Created_Time); });
  }

  /* The reply without the quoted original underneath it. */
  function cleanBody(text, max) {
    var t = String(text || '').replace(/\r/g, '');
    if (/<[a-z][\s\S]*>/i.test(t)) {                    // HTML body: keep the line breaks, drop the tags
      t = t.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
    var cut = t.search(/\n\s*(From:\s|-{2,}\s*Original Message|On .{4,120} wrote:|_{8,}|Sent from my |CONFIDENTIALITY NOTICE)/i);
    if (cut > 0) t = t.slice(0, cut);
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    max = max || 1500;
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + ' …' : t;
  }

  function firstName(name, email) {
    var n = String(name || '').replace(/["']/g, '').trim();
    if (/,/.test(n)) n = n.split(',')[1].trim();        // "Last, First"
    n = n.split(/\s+/)[0] || '';
    if (!n || /@/.test(n) || n.length < 2) return '';
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  /* Order confirmation draft. alert: the EM_Stock_Alerts row; reply: the newest reply or null; account: display name. */
  function confirmation(alert, reply, account) {
    var fam = alert.Device_Family && alert.Device_Family !== '-None-' ? alert.Device_Family : '';
    var n = +alert.Suggested_Order || 0;
    var acct = account || 'your program';
    var what = alert.Alert_Type === 'Program growth' || n <= 0
      ? 'the ' + (fam && fam !== 'Accessory' ? fam + ' ' : '') + 'equipment you requested'
      : n + ' spare ' + (fam ? fam + ' ' : '') + (n === 1 ? 'unit' : 'units');
    var fn = reply ? firstName(reply.Sender_Name, reply.Sender_Email) : '';
    var subject = 'Order confirmed: ' + (n > 0 && alert.Alert_Type !== 'Program growth' ? what : 'equipment') + ' for ' + acct;
    var text = (fn ? 'Hello ' + fn + ',' : 'Hello,') + '\n\n' +
      'Thank you for getting back to us. This email confirms that we have placed an order for ' + what + ' for ' + acct + '.\n\n' +
      'If anything changes on your end, simply reply to this email.\n\n' +
      'We appreciate your partnership and the work your team does every day.\n\n' +
      'Thank you,\n{{sender}}';
    var to = [];
    if (reply && reply.Sender_Email) to.push(String(reply.Sender_Email).trim());
    splitList(alert.Recipient_Emails).forEach(function (e) { if (to.map(lc).indexOf(e) < 0) to.push(e); });
    return { subject: subject.slice(0, 250), text: text, to: to };
  }

  /* Thank-you draft when no order is needed. Same recipients as the confirmation. */
  function noOrderNote(alert, reply, account) {
    var fam = alert.Device_Family && alert.Device_Family !== '-None-' && alert.Device_Family !== 'Accessory' ? alert.Device_Family + ' ' : '';
    var acct = account || 'your program';
    var growth = alert.Alert_Type === 'Program growth';
    var fn = reply ? firstName(reply.Sender_Name, reply.Sender_Email) : '';
    var subject = 'Thank you for your reply: ' + (growth ? 'equipment' : 'spare ' + fam + 'units') + ' for ' + acct;
    var text = (fn ? 'Hello ' + fn + ',' : 'Hello,') + '\n\n' +
      'Thank you for getting back to us. We have noted that ' + acct + ' does not need ' +
      (growth ? 'any additional equipment' : 'additional spare ' + fam + 'units') + ' at this time, so we will not place an order.\n\n' +
      'If things change, simply reply to this email and we will take care of it.\n\n' +
      'We appreciate your partnership and the work your team does every day.\n\n' +
      'Thank you,\n{{sender}}';
    var c = confirmation(alert, reply, account);
    return { subject: subject.replace(/\s+/g, ' ').slice(0, 250), text: text, to: c.to };
  }

  /* ---- S47f: the history of one alert ---- */
  /* HTML email body as plain text with its paragraphs kept (nothing cut). */
  function htmlText(h) {
    var t = String(h || '').replace(/\r/g, '');
    t = t.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<(br)\b[^>]*>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* Who approved the first email, from the Send Log ("... as Beau Carrigan to ...") or the Handled By lookup. */
  function senderFromLog(alert) {
    var m = /\bas ([^.|]+?) to /.exec(String(alert.Send_Log || ''));
    if (m) return m[1].trim();
    var h = alert.Handled_By;
    return h && typeof h === 'object' && h.name ? h.name : '';
  }
  /* A Note on the alert, as one email in the history.
     "Order confirmation sent: <subject>" / "Thank-you sent (no order needed): <subject>" (stock_alert_decide_as),
     "Email sent: <subject>" (em_stock_alert_send). Content: "To: a, b" then a blank line (or " | ") then the body. */
  function parseNote(n) {
    var title = String(n.Note_Title || ''), c = String(n.Note_Content || '').replace(/\r/g, '');
    var kind = /^order confirmation sent/i.test(title) ? 'ordered' : /^thank-you sent/i.test(title) ? 'no_order' : /^email sent/i.test(title) ? 'sent' : 'other';
    var subject = title.replace(/^[^:]*:\s*/, '');
    var to = '', text = c;
    var m = /^To:\s*([^\n|]*?)\s*(?:\n\s*\n|\s\|\s)([\s\S]*)$/.exec(c);
    if (m) { to = m[1]; text = m[2]; }
    return { kind: kind, subject: subject, to: to, text: text.replace(/\s{3,}/g, '\n\n').trim(), at: n.Created_Time || '' };
  }

  return { FIELDS: FIELDS, query: query, sinceDay: sinceDay, normSubject: normSubject, repliesFor: repliesFor,
    cleanBody: cleanBody, firstName: firstName, confirmation: confirmation, noOrderNote: noOrderNote,
    htmlText: htmlText, senderFromLog: senderFromLog, parseNote: parseNote };
});
