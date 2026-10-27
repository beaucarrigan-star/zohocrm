/* Next Step: pure rules (no DOM, no Zoho). Browser: window.NextStepModel. Node: require.
   v1.1.0 (27 Oct 2026, S41 Phase 4c): adds Cases, Billing Findings and Solicitations (RECORD-PAGE-SPEC sections 4 to 6).
   v1 (19 Oct 2026, S12). Rules follow RECORD-PAGE-SPEC-2026-10-19 sections 2 and 3, with Beau's S12 wording for
   Contracts "Not started" (120 days or less). Reads nothing itself: the widget passes in the record and the contact.

   compute(module, rec, ctx) -> { tone, title, why, primary, secondary, none }
     module: 'Contracts' | 'Accounts' | 'Cases' | 'Billing_Findings' | 'Solicitations'
     rec:    the raw Zoho record
     ctx:    { now: Date, contact: { id, name } | null }
   Action objects: { kind: 'call' | 'edit' | 'task', label }. The widget opens Zoho's own form for each; nothing is written here.
   An edit action is dropped when rec.$editable === false (the user cannot edit this record), and the other action moves up.
   tone: 'ok' (cobalt rule), 'warn' (amber rule), 'bad' (red rule). Status colors are never the accent. */
(function (root) {
  'use strict';

  var START_WINDOW = 120;          /* Contracts: renewal work starts at this many days (Beau, S12) */
  var CASE_OPEN_DAYS = 5;          /* Cases: open more than this many days turns the card amber (spec 4, Beau 19 Oct) */

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
  function fmtShort(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function inDays(n) { return n === 0 ? 'today' : n === 1 ? 'in 1 day' : 'in ' + n + ' days'; }
  var RANK = { ok: 0, warn: 1, bad: 2 };
  function worst(a, b) { return RANK[b] > RANK[a] ? b : a; }

  var A = {
    log: { kind: 'call', label: 'Log outreach' },
    touch: { kind: 'call', label: 'Log a touch' },
    editC: { kind: 'edit', label: 'Edit contract' },
    editA: { kind: 'edit', label: 'Edit account' },
    task: { kind: 'task', label: 'Add task' },
    editK: { kind: 'edit', label: 'Edit case' },
    callK: { kind: 'call', label: 'Log a call' },
    editF: { kind: 'edit', label: 'Edit finding' },
    editS: { kind: 'edit', label: 'Edit solicitation' }
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

  /* ---------------- Cases (spec section 4) ---------------- */
  var CASE_STEP = {
    'New': ['ok', 'Pick up and reply within 1 business day.', 'editK', 'callK'],
    'In Progress': ['ok', 'Resolve it, or set Waiting On.', 'editK', 'callK'],
    'Escalated': ['bad', 'Get a decision from the handling team.', 'editK', 'task'],
    'On Hold': ['ok', 'Review why it is on hold.', 'editK', 'task'],
    'Waiting on Customer': ['ok', 'Chase the customer if no reply.', 'callK', 'editK'],
    'Waiting on Vendor': ['ok', 'Chase the vendor.', 'callK', 'editK'],
    'Resolved': ['ok', 'Confirm with the reporter, then close.', 'editK', 'callK'],
    'Closed': ['ok', 'Nothing due. Reopen if it comes back.', 'editK', 'task']
  };
  var WAITING_ON_PAUSES = { 'Customer': 1, 'Vendor': 1, 'Internal': 1 };
  function cases(rec, ctx) {
    var status = clean(rec.Status), t = today(ctx.now);
    if (status === '') return out('warn', 'Set the status.', 'Case status is not set.', A.editK, A.task);
    var s = CASE_STEP[status];
    if (!s) return out('warn', 'Check the case status.', 'Case status "' + status + '" is not one this card knows.', A.editK, A.task);
    var tone = s[0], why = [];
    var open = status !== 'Resolved' && status !== 'Closed';
    if (open) {
      var due = day(rec.Due_By), paused = !!WAITING_ON_PAUSES[clean(rec.Waiting_On)];
      if (due && !paused) {
        var dn = diffDays(due, t);
        if (dn < 0) { why.push('Overdue ' + plural(-dn, 'day') + ' (due ' + fmtShort(due) + ').'); tone = worst(tone, 'bad'); }
        else if (dn === 0) { why.push('Due today.'); tone = worst(tone, 'warn'); }
        else why.push('Due ' + inDays(dn) + ' (' + fmtShort(due) + ').');
      } else if (!due && !paused) why.push('No due date.');
      var age = rec.Case_Age_days;
      if (age == null || age === '') { var c = day(rec.Created_Time); age = c ? diffDays(t, c) : null; }
      if (age != null && age !== '') {
        age = Math.round(+age);
        if (age > CASE_OPEN_DAYS) { why.push('Open ' + plural(age, 'day') + '.'); tone = worst(tone, 'warn'); }
      }
    }
    var acct = clean(rec.Account_Name);
    if (!acct && open) why.push('No account linked.');
    var team = clean(rec.Handling_Team);
    if (status === 'Escalated' && team) why.unshift('Handling team: ' + team + '.');
    if (!why.length) why.push(status === 'Closed' ? 'Case is closed.' : 'Case is ' + status.toLowerCase() + '.');
    return out(tone, s[1], why.join(' '), A[s[2]], A[s[3]]);
  }

  /* ---------------- Billing Findings (spec section 5) ---------------- */
  var SEV = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', INFO: 'info' };
  function findings(rec, ctx) {
    var status = clean(rec.Status), sev = clean(rec.Severity).toUpperCase();
    var money = clean(rec.Money_Type), dollars = rec.Dollars;
    var why = [];
    if (sev) why.push((SEV[sev] ? SEV[sev].charAt(0).toUpperCase() + SEV[sev].slice(1) : sev) + ' severity.');
    if (money && money !== 'None') why.push(money + (dollars != null && dollars !== '' && +dollars !== 0 ? ' $' + (+dollars).toFixed(2) : '') + '.');
    var age = rec.Age_days;
    if (age != null && age !== '' && status === 'Open') why.push('Open ' + plural(Math.round(+age), 'day') + '.');
    if (status === 'Open' && (rec.In_Latest_Run === false || rec.In_Latest_Run === 'false')) why.push('Not in the latest run.');
    var w = why.join(' ');
    if (status === 'Open') return out(sev === 'CRITICAL' || sev === 'HIGH' ? 'bad' : 'warn', 'Decide: dispute with the vendor, explain, or not an issue.', w || 'Finding is open.', A.editF, A.task);
    if (status === 'Disputed with vendor') return out('warn', 'Follow up with the vendor.', w || 'Disputed with the vendor.', A.task, A.editF);
    if (status === 'Resolved - credited') return out('ok', 'Confirm the credit on the next invoice.', w || 'Resolved with a credit.', A.task, A.editF);
    if (status === 'Resolved - explained' || status === 'Not an issue') return out('ok', 'Nothing due.', status + '.', A.editF, A.task);
    if (status === '') return out('warn', 'Set the status.', 'Finding status is not set.', A.editF, A.task);
    return out('warn', 'Check the finding status.', 'Status "' + status + '" is not one this card knows.', A.editF, A.task);
  }

  /* ---------------- Solicitations (spec section 6; blank Status decided 27 Oct: "Set the status") ---------------- */
  var SOL_STEP = {
    'Identified': 'Review the packet.',
    'Reviewing': 'Finish the briefing and take it to the RFP team.',
    'Decision Pending': 'Leadership to decide: bid or no-bid.',
    'Go - In Progress': 'Work the response.',
    'Submitted': 'Wait for the result. Log any questions.',
    'Shortlisted / Orals': 'Prepare for orals.',
    'Won': 'Create or link the resulting contract.',
    'Scoring': 'Scoring is retired: set the status.'
  };
  var SOL_DONE = { 'Lost': 1, 'No-Bid - Tracking': 1, 'Cancelled by Agency': 1, 'Cancelled': 1, 'Withdrawn': 1 };
  function solicitations(rec, ctx) {
    var status = clean(rec.Status), t = today(ctx.now);
    var due = day(rec.Proposal_Due), dn = due ? diffDays(due, t) : null;
    var brief = clean(rec.Briefing_Status);
    var openish = !SOL_DONE[status] && status !== 'Won' && status !== 'Submitted';
    var tone = 'ok', why = [];
    if (due) {
      if (dn < 0) { why.push('Proposal was due ' + fmt(due) + '.'); if (openish) tone = 'bad'; }
      else { why.push('Proposal due ' + inDays(dn) + ' (' + fmt(due) + ').'); if (openish) tone = dn <= 3 ? 'bad' : dn <= 14 ? 'warn' : 'ok'; }
    } else if (openish) why.push('No proposal deadline on file.');
    if (brief && openish) why.push('Briefing: ' + (brief === 'Not started' ? 'not started' : brief === 'Drafted from packet' ? 'drafted, needs RFP team review' : brief.charAt(0).toLowerCase() + brief.slice(1)) + '.');
    if (status === '') return out('warn', 'Set the status.', why.join(' ') || 'Solicitation status is not set.', A.editS, A.task);
    if (SOL_DONE[status]) return out('ok', 'Nothing due. Note why.', status + '.', A.editS, A.task);
    var title = SOL_STEP[status];
    if (!title) return out('warn', 'Check the solicitation status.', 'Status "' + status + '" is not one this card knows.', A.editS, A.task);
    if (status === 'Go - In Progress' && due) title = 'Work the response. Next date: ' + fmt(due) + '.';
    if (status === 'Scoring') tone = worst(tone, 'warn');
    if (status === 'Decision Pending') tone = worst(tone, 'warn');
    return out(tone, title, why.join(' ') || 'Status is ' + status + '.', A.editS, A.task);
  }

  /* Drop edit buttons the user cannot use ($editable false), so view-only profiles see only what works for them. */
  function permit(r, rec) {
    if (!r || r.none || !rec || rec.$editable !== false) return r;
    if (r.secondary && r.secondary.kind === 'edit') r.secondary = null;
    if (r.primary && r.primary.kind === 'edit') { r.primary = r.secondary; r.secondary = null; }
    if (!r.primary) r.primary = A.task;
    return r;
  }

  function compute(module, rec, ctx) {
    rec = rec || {}; ctx = ctx || {};
    var r;
    if (module === 'Contracts') r = contracts(rec, ctx);
    else if (module === 'Accounts') r = accounts(rec, ctx);
    else if (module === 'Cases') r = cases(rec, ctx);
    else if (module === 'Billing_Findings') r = findings(rec, ctx);
    else if (module === 'Solicitations') r = solicitations(rec, ctx);
    else return none('Next step is not set up for this module');
    return permit(r, rec);
  }
  var MODULES = ['Contracts', 'Accounts', 'Cases', 'Billing_Findings', 'Solicitations'];

  /* What Zoho's own form gets pre-filled with. Pure so it can be tested. kind: call | edit | task */
  function recName(module, rec) {
    if (module === 'Contracts' || module === 'Billing_Findings' || module === 'Solicitations') return clean(rec.Name);
    if (module === 'Cases') return clean(rec.Subject);
    return clean(rec.Account_Name);
  }
  var CALL_PREFIX = { Contracts: 'Renewal outreach: ', Cases: 'Case call: ' };
  var TASK_PREFIX = { Contracts: 'Renewal follow-up: ', Cases: 'Case follow-up: ', Billing_Findings: 'Finding follow-up: ', Solicitations: 'Bid follow-up: ' };
  function formFor(kind, module, rec, ctx) {
    ctx = ctx || {};
    var nm = recName(module, rec);
    if (kind === 'edit') return { api: 'edit', Entity: module, RecordID: String(rec.id) };
    var data = {};
    if (kind === 'call') {
      data.Subject = (CALL_PREFIX[module] || 'Touch: ') + nm;
      data.Call_Type = 'Outbound';
      data.What_Id = { id: String(rec.id) };
      data.$se_module = module;
      if (ctx.contact && ctx.contact.id) data.Who_Id = { id: String(ctx.contact.id) };
      return { api: 'create', Entity: 'Calls', RecordData: data };
    }
    data.Subject = (TASK_PREFIX[module] || 'Follow-up: ') + nm;
    data.What_Id = { id: String(rec.id) };
    data.$se_module = module;
    return { api: 'create', Entity: 'Tasks', RecordData: data };
  }

  var api = { compute: compute, formFor: formFor, START_WINDOW: START_WINDOW, CASE_OPEN_DAYS: CASE_OPEN_DAYS, MODULES: MODULES, clean: clean, day: day, VERSION: '1.1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NextStepModel = api;
})(typeof window !== 'undefined' ? window : this);
