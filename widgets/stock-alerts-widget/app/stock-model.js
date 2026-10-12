/* Stock Alerts panel - pure logic (no DOM, no Zoho). Loaded by stock.js in the browser and by tests in node.
   Alert_Status is DERIVED from the four legacy fields (Status, Email_Status, Resolution, Action_Needed) so the nightly job and the
   old approval path keep working. The same rules are in deluge/stock_alert_sync.dg: change both together. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANES = {
    approve: 'Needs approval',
    action: 'Needs action',
    waiting: 'Waiting on customer',
    done: 'Done',
    dismissed: 'Dismissed'
  };
  var LANE_ORDER = ['approve', 'action', 'waiting', 'done', 'dismissed'];

  /* The one rule. Order matters. */
  function laneOf(a) {
    var st = a.Status || '', em = a.Email_Status || '';
    if (st === 'Dismissed') return 'dismissed';
    if (st === 'Resolved' || st === 'Ordered') return 'done';
    if (em === 'Awaiting approval') return 'approve';
    if (em === 'Sent') return 'waiting';
    return 'action';
  }
  function laneLabel(k) { return LANES[k] || k; }

  function typeLabel(t) { return t && t !== '-None-' ? t : 'Alert'; }

  function accountName(a) { return a.Account && a.Account.name ? a.Account.name : 'No account'; }

  /* Short, plain sentence of what is being asked for. */
  function ask(a) {
    var fam = a.Device_Family && a.Device_Family !== '-None-' ? a.Device_Family : 'device';
    if (a.Suggested_Order > 0) return 'Send ' + a.Suggested_Order + ' ' + fam;
    if (a.Suggested_Return > 0) return 'Take back ' + a.Suggested_Return + ' ' + fam;
    return '';
  }

  function counts(rows) {
    var c = { approve: 0, action: 0, waiting: 0, done: 0, dismissed: 0 };
    rows.forEach(function (r) { c[laneOf(r)] += 1; });
    return c;
  }

  /* ---- recipients: commas, semicolons or new lines ---- */
  function splitRecipients(raw) {
    return String(raw == null ? '' : raw).replace(/;/g, ',').replace(/\n/g, ',').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function validEmail(e) { return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e); }
  function recipientCheck(raw) {
    var all = splitRecipients(raw), good = [], bad = [];
    all.forEach(function (e) { (validEmail(e) ? good : bad).push(e); });
    return { good: good, bad: bad, ok: good.length > 0 && bad.length === 0 };
  }

  /* ---- draft body: the drafts are simple HTML (<p> paragraphs). Edit them as plain paragraphs when that is lossless. ---- */
  function isSimpleHtml(h) {
    var s = String(h == null ? '' : h).replace(/<\/?p>/gi, '').replace(/<br\s*\/?>/gi, '');
    return s.indexOf('<') < 0;
  }
  function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function htmlToText(h) {
    var s = String(h == null ? '' : h).replace(/\r/g, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<\/?p>/gi, '');
    return unesc(s).trim();
  }
  function textToHtml(t) {
    var paras = String(t == null ? '' : t).replace(/\r/g, '').trim().split(/\n{2,}/);
    return paras.map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  /* The sign-off placeholder is replaced with the approver's name at send time. */
  function previewText(t, who) { return String(t).replace(/\{\{sender\}\}/g, who || 'you'); }

  /* ---- COQL rows -> panel rows ---- */
  var FIELDS = ['id', 'Name', 'Alert_Type', 'Account', 'Status', 'Email_Status', 'Resolution', 'Draft_Subject', 'Recipient_Emails',
    'Detail', 'Suggested_Order', 'Suggested_Return', 'Spare_Units', 'Assigned_Units', 'Threshold', 'Device_Family',
    'Email_Sent_At', 'Last_Seen', 'Send_Log'];
  var QUERY = 'select ' + FIELDS.join(', ') + ' from EM_Stock_Alerts where id is not null';

  function view(a) {
    var lane = laneOf(a);
    return {
      id: String(a.id), raw: a, lane: lane, laneLabel: laneLabel(lane),
      account: accountName(a), type: typeLabel(a.Alert_Type), ask: ask(a),
      subject: a.Draft_Subject || '', to: splitRecipients(a.Recipient_Emails),
      detail: a.Detail || '', seen: a.Last_Seen || '', sentAt: a.Email_Sent_At || '', log: a.Send_Log || ''
    };
  }

  /* ---- batch summary for mass approve ---- */
  function batchSummary(results) {
    var ok = results.filter(function (r) { return r.ok; }).length;
    var failed = results.filter(function (r) { return !r.ok; });
    return { ok: ok, failed: failed.length, text: ok + ' sent' + (failed.length ? ', ' + failed.length + ' not sent' : '') };
  }

  return {
    LANES: LANES, LANE_ORDER: LANE_ORDER, FIELDS: FIELDS, QUERY: QUERY,
    laneOf: laneOf, laneLabel: laneLabel, ask: ask, counts: counts, view: view,
    splitRecipients: splitRecipients, validEmail: validEmail, recipientCheck: recipientCheck,
    isSimpleHtml: isSimpleHtml, htmlToText: htmlToText, textToHtml: textToHtml, previewText: previewText,
    batchSummary: batchSummary
  };
});
