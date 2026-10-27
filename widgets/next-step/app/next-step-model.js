/* Next Step: pure rules (no DOM, no Zoho). Browser: window.NextStepModel. Node: require.
   v1 (19 Oct 2026, S12). Rules follow RECORD-PAGE-SPEC-2026-10-19 sections 2 and 3, with Beau's S12 wording for
   Contracts "Not started" (120 days or less). Reads nothing itself: the widget passes in the record and the contact.

   compute(module, rec, ctx) -> { tone, title, why, primary, secondary, none }
     module: 'Contracts' | 'Accounts'
     rec:    the raw Zoho record
     ctx:    { now: Date, contact: { id, name } | null }
   Action objects: { kind: 'call' | 'edit' | 'task', label }. The widget opens Zoho's own form for each; nothing is written here.
   tone: 'ok' (cobalt rule), 'warn' (amber rule), 'bad' (red rule). Status colors are never the accent. */
(function (root) {
  'use strict';

  var START_WINDOW = 120;          /* Contracts: renewal work starts at this many days (Beau, S12) */

  function clean(v) {
    var s = v == null ? '' : (typeof v === 'object' ? (v.name || v.display_value || '') : String(v)).trim();
    return /^(-none-|none)$/i.test(s) ? '' : s;
  }
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v == null ? '' : String(v));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function today(now) { var n = now || new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function diffDays(a, b) { return Math.round((a - b) / 86400000); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmt(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function inDays(n) { return n === 0 ? 'today' : n === 1 ? 'in 1 day' : 'in ' + n + ' days'; }

  var A = {
    log: { kind: 'call', label: 'Log outreach' },
    touch: { kind: 'call', label: 'Log a touch' },
    editC: { kind: 'edit', label: 'Edit contract' },
    editA: { kind: 'edit', label: 'Edit account' },
    task: { kind: 'task', label: 'Add task' }
  };
  function out(tone, title, why, primary, secondary) { return { tone: tone, title: title, why: why, primary: primary, secondary: secondary, none: false }; }
  function none(msg) { return { tone: 'ok', title: msg, why: '', primary: null, secondary: null, none: true }; }

  /* ---------------- Contracts ---------------- */
  function contracts(rec, ctx) {
    if (clean(rec.Counterparty_Type) !== 'Customer') return none('Not a customer contract');
    var t = today(ctx.now), end = day(rec.Final_End_Date), n = end ? diffDays(end, t) : null;
    var status = clean(rec.Renewal_Status);
    var since = day(rec.Stage_Entered) || day(rec.Stage_Changed_On);
    var inStage = since ? diffDays(t, since) : null;
    var endTxt = end ? (n < 0 ? 'Ended ' + plural(-n, 'day') + ' ago (' + fmt(end) + ')' : n === 0 ? 'Ends today' : 'Ends in ' + plural(n, 'day') + ' (' + fmt(end) + ')') : 'No end date on file';
    var out_ = null;
    var name = ctx.contact && ctx.contact.name ? ctx.contact.name : '';

    if (status === 'Renewed') out_ = out('ok', 'Nothing due. Check the new end date is entered.', endTxt + '.', A.editC, A.task);
    else if (status === 'Not renewing') out_ = out('ok', 'Confirm the end date and close out.', endTxt + '.', A.editC, A.task);
    else if (status === 'Needs decision') out_ = out('warn', 'Decide: renew or let it end.', endTxt + '.', A.editC, A.log);
    else if (status === 'Outreach') out_ = out('ok', 'Get terms agreed.', (inStage != null ? 'In outreach for ' + plural(inStage, 'day') + '. ' : '') + endTxt + '.', A.log, A.editC);
    else if (status === 'Terms agreed') out_ = out('ok', 'Send for signature.', (inStage != null ? 'Terms agreed ' + plural(inStage, 'day') + ' ago. ' : '') + endTxt + '.', A.editC, A.log);
    else if (status === 'Sent for signature') out_ = out('ok', 'Chase the signature, then mark Renewed.', (inStage != null ? 'Sent ' + plural(inStage, 'day') + ' ago. ' : '') + endTxt + '.', A.editC, A.log);
    else if (status === '') out_ = out('warn', 'Set the renewal status.', endTxt + '.', A.editC, A.log);
    else if (status === 'Not started') {
      if (!end) out_ = out('warn', 'Add the end date.', 'No end date on file, so the days left cannot be counted.', A.editC, A.log);
      else if (n < 0) out_ = out('bad', 'Contract has ended: mark Renewed or Not renewing.', endTxt + '. Renewal never started.', A.editC, A.log);
      else if (n <= START_WINDOW) out_ = out(n <= 90 ? 'bad' : 'warn', name ? 'Contact ' + name + ' to start the renewal.' : 'Contact the customer to start the renewal.', endTxt + '. No outreach logged.', A.log, A.editC);
      else out_ = out('ok', 'No action due yet.', endTxt + '. Renewal work starts at ' + START_WINDOW + ' days.', A.log, A.editC);
    } else out_ = out('warn', 'Check the renewal status.', 'Renewal status "' + status + '" is not one this card knows.', A.editC, A.log);

    if (rec.Blocked === true || rec.Blocked === 'true') {
      var why = clean(rec.Blocked_Reason);
      out_.why = 'Blocked' + (why ? ': ' + why : '') + '. ' + out_.why;
      if (out_.tone === 'ok') out_.tone = 'warn';
    }
    return out_;
  }

  /* ---------------- Accounts ---------------- */
  function accounts(rec, ctx) {
    var type = clean(rec.Account_Type);
    var health = clean(rec.Customer_Health), touch = clean(rec.Touch_Status);
    var ds = rec.Days_Since_Touch;
    var touchWhy = touch ? 'Touch status is ' + (touch === 'No Logged Touch' ? 'no touch logged' : touch.toLowerCase()) + (ds != null && ds !== '' && touch !== 'No Logged Touch' ? ' (' + plural(+ds, 'day') + ' since the last one)' : '') + '.' : 'No touch status yet.';
    if (type === 'Customer') {
      if (health === 'Critical' || health === 'At Risk') {
        var hw = 'Health is ' + (health === 'At Risk' ? 'at risk' : 'critical') + '. ' + touchWhy;
        return out(health === 'Critical' ? 'bad' : 'warn', 'Call the customer this week.', hw, A.touch, A.editA);
      }
      if (touch === 'Cold' || touch === 'No Logged Touch') return out('warn', 'Log a first touch.', touchWhy, A.touch, A.editA);
      return out('ok', 'No action due.', 'Health is ' + (health ? health.toLowerCase() : 'not scored') + '. ' + touchWhy, A.touch, A.editA);
    }
    if (type === 'Prospect') return out('ok', 'Follow up and qualify.', 'Prospect account.', A.touch, A.editA);
    if (type === 'Parent Account') return out('ok', 'Review the child accounts.', 'Parent account.', A.editA, A.touch);
    if (type === 'Association - Conferences') return out('ok', 'Check upcoming event dates.', 'Conference association.', A.editA, A.touch);
    if (type === '') return out('warn', 'Set the account type.', 'Account type is not set, so no other rule can apply.', A.editA, A.touch);
    return out('ok', 'No action due.', 'Account type is ' + type + '.', A.editA, A.touch);
  }

  function compute(module, rec, ctx) {
    rec = rec || {}; ctx = ctx || {};
    if (module === 'Contracts') return contracts(rec, ctx);
    if (module === 'Accounts') return accounts(rec, ctx);
    return none('Next step is not set up for this module');
  }

  /* What Zoho's own form gets pre-filled with. Pure so it can be tested. kind: call | edit | task */
  function formFor(kind, module, rec, ctx) {
    ctx = ctx || {};
    var nm = module === 'Contracts' ? clean(rec.Name) : clean(rec.Account_Name);
    var acct = module === 'Contracts' ? rec.Account : null;
    if (kind === 'edit') return { api: 'edit', Entity: module, RecordID: String(rec.id) };
    var data = {};
    if (kind === 'call') {
      data.Subject = (module === 'Contracts' ? 'Renewal outreach: ' : 'Touch: ') + nm;
      data.Call_Type = 'Outbound';
      data.What_Id = { id: String(rec.id) };
      data.$se_module = module;
      if (ctx.contact && ctx.contact.id) data.Who_Id = { id: String(ctx.contact.id) };
      return { api: 'create', Entity: 'Calls', RecordData: data };
    }
    data.Subject = (module === 'Contracts' ? 'Renewal follow-up: ' : 'Follow-up: ') + nm;
    data.What_Id = { id: String(rec.id) };
    data.$se_module = module;
    return { api: 'create', Entity: 'Tasks', RecordData: data };
  }

  var api = { compute: compute, formFor: formFor, START_WINDOW: START_WINDOW, clean: clean, day: day };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NextStepModel = api;
})(typeof window !== 'undefined' ? window : this);
