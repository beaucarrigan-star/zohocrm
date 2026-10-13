/* Support flow: pure logic that joins Support Emails, Cases, Vendor Orders and Accounts into one path (no DOM, no Zoho).
   Works in the browser (window.FlowModel, needs window.TriageModel loaded first) and in node (require).
   Inputs are raw COQL rows with live API names. Nothing here writes anywhere.
   v2 (12 Oct 2026, after reading the live picklists): Case_Category drives the reactive "order or return" step;
   Intake_Result values Automated report / Internal / Vendor notice are kept out of the triage percentage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./triage-model.js'));
  else root.FlowModel = factory(root.TriageModel);
})(typeof self !== 'undefined' ? self : this, function (TM) {
  'use strict';

  var DAY = 86400000;
  var STALE_CASE_DAYS = 14;                       /* same threshold as Customer 360 */
  var CASE_RESULTS = ['Case created', 'Added to existing case'];
  /* Mail nobody needs to act on as a request: shown, but left out of the "became a case" percentage. */
  var SYSTEM_RESULTS = ['Automated report', 'Internal', 'Vendor notice'];
  /* Case_Category / Support_Emails.Topic values (live picklist, 12 Oct 2026) that call for something to be ordered or sent back. */
  var NEED_BY_CATEGORY = {
    'Order Device(s)': 'equipment', 'Order Supplies': 'accessory',
    'Device Troubleshooting': 'device', 'Lost Equipment': 'device'
  };
  var REQUEST_TOPICS = ['Order Device(s)', 'Order Supplies', 'Device Troubleshooting', 'Lost Equipment'];
  /* Business days an email or case may wait before it is flagged (Beau, 12 Oct 2026: two). */
  var LIMIT_BD = 2;
  var WINDOWS = [{ id: '7', label: 'Last 7 days', days: 7 }, { id: '30', label: 'Last 30 days', days: 30 },
    { id: '90', label: 'Last 90 days', days: 90 }, { id: 'all', label: 'All', days: null }];

  function toMs(v) { if (v == null || v === '') return null; if (typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pickVal(v) { return v && v !== '-None-' ? v : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }

  /* ---------- cases ---------- */
  /* Status text to a flow stage. Unknown open statuses land in "other" so nothing disappears. */
  function caseStage(status) {
    var s = String(status || '');
    if (s === 'Closed') return 'closed';
    if (s === 'Resolved') return 'resolved';
    if (s === 'New') return 'new';
    if (s === 'Acknowledged') return 'ack';
    if (/escalat/i.test(s)) return 'escalated';
    if (/wait|hold|pending/i.test(s)) return 'waiting';
    if (/progress/i.test(s)) return 'progress';
    return 'other';
  }
  function normCase(r, now, opts) {
    var created = toMs(r.Created_Time);
    var acct = lk(r.Account_Name);
    var status = pickVal(r.Status);
    var stage = caseStage(status);
    var age = num(r.Case_Age_days);
    if (age == null && created != null) age = Math.max(0, Math.floor((now - created) / DAY));
    var open = stage !== 'closed' && stage !== 'resolved';
    var ageBD = created != null ? TM.businessDaysElapsed(created, now, opts) : null;
    var category = pickVal(r.Case_Category);
    var ticket = r.Vendor_Ticket_Number ? String(r.Vendor_Ticket_Number).trim() : '';
    var resolution = pickVal(r.Resolution_Category);
    return {
      id: r.id, number: r.Case_Number != null ? String(r.Case_Number) : '', subject: r.Subject || '(no subject)',
      status: status, stage: stage, open: open, priority: pickVal(r.Priority), high: r.Priority === 'High',
      createdMs: created, age: age, ageBD: ageBD, owner: lk(r.Owner).name,
      accountId: acct.id, accountName: acct.name,
      category: category, need: NEED_BY_CATEGORY[category] || '', origin: pickVal(r.Case_Origin),
      vendorName: lk(r.Vendor).name, vendorTicket: ticket, serial: r.Device_Serial || '', resolution: resolution,
      /* A return/replacement is under way when a vendor ticket number is recorded or the case was resolved as a device replacement. */
      rma: !!ticket || resolution === 'Device Replaced',
      unacked: stage === 'new' && ageBD != null && ageBD >= LIMIT_BD,
      stale: open && age != null && age > STALE_CASE_DAYS
    };
  }

  /* ---------- vendor orders ---------- */
  function normOrder(r) {
    return {
      id: r.id, type: pickVal(r.Order_Type) || 'Accessories', status: pickVal(r.Order_Status) || 'Placed',
      caseId: lk(r.Case).id, vendorName: lk(r.Vendor).name, reference: r.Reference || '',
      orderMs: toMs(r.Order_Date), receivedMs: toMs(r.Received_Date), accountId: lk(r.Account).id
    };
  }
  /* What has happened to the order(s) a case asked for. */
  function orderState(list) {
    var live = (list || []).filter(function (o) { return o.status !== 'Cancelled'; });
    if (!live.length) return (list && list.length) ? 'cancelled' : 'none';
    return live.every(function (o) { return o.status === 'Received'; }) ? 'received' : 'placed';
  }

  /* ---------- emails ---------- */
  function inWindow(ms, now, days) { return days == null || ms == null || ms >= now - days * DAY; }

  function itemFromEmail(f, caseById) {
    var r = f.row, c = r.caseId ? caseById[r.caseId] : null;
    var tone = r.result === 'Left for review' ? (f.untouched ? 'bad' : 'warn') : r.result === 'Ignored' ? 'neutral' : CASE_RESULTS.indexOf(r.result) >= 0 ? 'good' : 'info';
    return {
      kind: 'email', id: r.id, title: r.subject || '(no subject)', sub: [r.senderEmail, r.topic].filter(Boolean).join(' / '), topic: r.topic, accountId: r.accountId, accountName: r.accountName,
      ms: r.receivedMs, age: f.ageBD, ageText: f.ageBD == null ? '' : plural(f.ageBD, 'business day'),
      state: r.result || 'Not set', tone: tone, caseId: r.caseId, caseNumber: c ? c.number : '', flagged: !!f.untouched
    };
  }
  function itemFromCase(c, extra) {
    var tone = c.stage === 'escalated' ? 'bad' : c.unacked || c.stale ? 'warn' : c.open ? 'info' : 'good';
    var it = {
      kind: 'case', id: c.id, title: (c.number ? c.number + ' ' : '') + c.subject,
      sub: [c.category, c.priority, c.owner].filter(Boolean).join(' / '),
      accountId: c.accountId, accountName: c.accountName, ms: c.createdMs, age: c.age, ageText: c.age == null ? '' : plural(c.age, 'day'),
      state: c.status || 'No status', tone: tone, caseId: c.id, high: c.high, flagged: c.unacked || c.stale || c.high
    };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  }
  /* Case row in the Orders and returns step: the state column says what happened to the order or return, not the case status. */
  function itemFromActionCase(c, st, ordersFor) {
    var list = ordersFor || [];
    var stateText, tone, note = '';
    if (c.need === 'equipment' || c.need === 'accessory') {
      if (st === 'none') { stateText = 'No order recorded'; tone = c.open ? (c.ageBD != null && c.ageBD >= LIMIT_BD ? 'warn' : 'info') : 'neutral'; }
      else if (st === 'cancelled') { stateText = 'Order cancelled'; tone = 'warn'; }
      else if (st === 'placed') { stateText = 'Order placed'; tone = 'info'; }
      else { stateText = 'Order received'; tone = c.open ? 'warn' : 'good'; if (c.open) note = 'Order received but the case is still open.'; }
    } else if (c.rma) {
      stateText = c.vendorTicket ? 'Vendor ticket ' + c.vendorTicket : 'Replaced'; tone = c.open ? 'info' : 'good';
    } else { stateText = 'No vendor ticket'; tone = 'neutral'; }
    var it = itemFromCase(c, { state: stateText, tone: tone, note: note, orderCount: list.length });
    it.flagged = (tone === 'warn');
    return it;
  }

  /* ---------- accounts needing attention ---------- */
  function accountRollup(cases) {
    var by = {};
    cases.filter(function (c) { return c.open && c.accountId; }).forEach(function (c) {
      var a = by[c.accountId] || (by[c.accountId] = { kind: 'account', id: c.accountId, title: c.accountName || 'Account', cases: [], high: 0, unacked: 0, stale: 0, escalated: 0, oldest: 0 });
      a.cases.push(c);
      if (c.high) a.high += 1;
      if (c.unacked) a.unacked += 1;
      if (c.stale) a.stale += 1;
      if (c.stage === 'escalated') a.escalated += 1;
      if (c.age != null && c.age > a.oldest) a.oldest = c.age;
    });
    var out = [];
    Object.keys(by).forEach(function (k) {
      var a = by[k], why = [];
      if (a.escalated) why.push(plural(a.escalated, 'escalated case'));
      if (a.high) why.push(plural(a.high, 'high-priority case'));
      if (a.unacked) why.push(plural(a.unacked, 'case') + ' not acknowledged');
      if (a.stale) why.push(plural(a.stale, 'case') + ' open over ' + STALE_CASE_DAYS + ' days');
      if (!why.length) return;
      a.why = why; a.score = a.escalated * 4 + a.high * 3 + a.unacked * 2 + a.stale;
      a.openCount = a.cases.length; a.sub = why.join('. ');
      a.tone = a.escalated || a.high ? 'bad' : 'warn';
      a.accountId = a.id; a.accountName = a.title; a.ageText = plural(a.oldest, 'day'); a.age = a.oldest;
      a.state = a.openCount + ' open'; a.flagged = true;
      out.push(a);
    });
    out.sort(function (x, y) { return y.score - x.score || y.oldest - x.oldest; });
    return out;
  }

  /* ---------- build ---------- */
  function sortOldest(a, b) { return (a.ms || 0) - (b.ms || 0); }
  function sortCases(a, b) { return (b.high ? 1 : 0) - (a.high ? 1 : 0) || (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age); }

  /* data = { emails: [...], cases: [...], orders: [...] } raw COQL rows. orders may be empty or missing. */
  function build(data, now, opts) {
    opts = opts || {};
    data = data || {};
    var days = opts.days === undefined ? 7 : opts.days;
    opts = Object.assign({ minDays: LIMIT_BD }, opts);
    var cases = (data.cases || []).map(function (r) { return normCase(r, now, opts); });
    var caseById = {}; cases.forEach(function (c) { caseById[c.id] = c; });
    var orders = (data.orders || []).map(normOrder);
    var ordersByCase = {};
    orders.forEach(function (o) { if (o.caseId) (ordersByCase[o.caseId] = ordersByCase[o.caseId] || []).push(o); });

    var inbound = [], historical = 0, outbound = 0;
    (data.emails || []).forEach(function (raw) {
      var f = TM.classify(raw, now, opts);
      if (f.outbound) { outbound += 1; return; }
      if (f.historical) { historical += 1; return; }
      if (inWindow(f.row.receivedMs, now, days)) inbound.push(f);
    });

    var waiting = [], noCase = [], madeCase = [], other = [], system = [], breaks = [], pending = [];
    inbound.forEach(function (f) {
      var r = f.row, it = itemFromEmail(f, caseById);
      if (SYSTEM_RESULTS.indexOf(r.result) >= 0) system.push(it);
      else if (r.result === 'Left for review') {
        waiting.push(it);
        if (REQUEST_TOPICS.indexOf(r.topic) >= 0) pending.push(it);
      } else if (r.result === TM.IGNORED) noCase.push(it);
      else if (CASE_RESULTS.indexOf(r.result) >= 0) {
        madeCase.push(it);
        /* Flow break: the result says a case exists but no case is linked, or the linked case is not in the Cases module. */
        if (!r.caseId) { it.break = 'No case is linked to this email.'; breaks.push(it); }
        else if (!caseById[r.caseId]) { it.break = 'The linked case could not be found in Cases.'; breaks.push(it); }
      } else other.push(it);
    });
    [waiting, noCase, madeCase, other, system, breaks, pending].forEach(function (l) { l.sort(sortOldest); });

    var by = { new: [], ack: [], progress: [], waiting: [], escalated: [], other: [], resolved: [], closed: [] };
    cases.forEach(function (c) { by[c.stage].push(c); });
    var openCases = cases.filter(function (c) { return c.open; });
    var doneInWindow = by.resolved.concat(by.closed).filter(function (c) { return inWindow(c.createdMs, now, days); });
    var itemize = function (list) { return list.slice().sort(sortCases).map(function (c) { return itemFromCase(c); }); };
    var noAcct = openCases.filter(function (c) { return !c.accountId; });
    var accounts = accountRollup(cases);

    /* Orders and returns (reactive): cases that are open, or created in the window. */
    var recent = cases.filter(function (c) { return c.open || inWindow(c.createdMs, now, days); });
    var equip = [], acc = [], rma = [], dev = [], gap = [], recv = [];
    recent.forEach(function (c) {
      var st = orderState(ordersByCase[c.id]);
      var it = itemFromActionCase(c, st, ordersByCase[c.id]);
      if (c.need === 'equipment') equip.push(it);
      if (c.need === 'accessory') acc.push(it);
      if ((c.need === 'equipment' || c.need === 'accessory') && c.open) {
        if (st === 'none' && c.ageBD != null && c.ageBD >= LIMIT_BD) gap.push(it);
        if (st === 'received') recv.push(it);
      }
      if (c.rma) rma.push(it);
      else if (c.need === 'device' && c.open) dev.push(it);
    });
    [equip, acc, rma, dev, gap, recv].forEach(function (l) { l.sort(function (a, b) { return (b.high ? 1 : 0) - (a.high ? 1 : 0) || (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age); }); });
    var actionCount = equip.length + acc.length + rma.length + dev.length;
    var withoutOrder = function (l) { return l.filter(function (i) { return i.state === 'No order recorded'; }).length; };

    var untouched = waiting.filter(function (i) { return i.flagged; }).length;
    var unacked = by.new.filter(function (c) { return c.unacked; }).length;
    var stale = openCases.filter(function (c) { return c.stale; }).length;
    var counted = inbound.length - system.length;                       /* mail someone may need to act on */
    var conv = counted > 0 ? Math.round(100 * madeCase.length / counted) : null;

    var lanes = {
      'e-all': { id: 'e-all', stage: 1, label: 'All inbound emails', count: inbound.length, tone: 'neutral', kind: 'email',
        items: inbound.map(function (f) { return itemFromEmail(f, caseById); }).sort(sortOldest) },
      'e-waiting': { id: 'e-waiting', stage: 2, label: 'Left for review', count: waiting.length, tone: untouched ? 'bad' : (waiting.length ? 'warn' : 'neutral'),
        hint: untouched ? plural(untouched, 'email') + ' over two business days' : '', kind: 'email', items: waiting },
      'e-case': { id: 'e-case', stage: 2, label: 'Became or joined a case', count: madeCase.length, tone: 'good', kind: 'email', items: madeCase.slice().reverse() },
      'e-nocase': { id: 'e-nocase', stage: 2, label: 'No case needed (ignored)', count: noCase.length, tone: 'neutral', kind: 'email', items: noCase.slice().reverse() },
      'e-system': { id: 'e-system', stage: 2, label: 'Automated, internal, vendor', count: system.length, tone: 'neutral', hint: 'not in the percentage', kind: 'email', items: system.slice().reverse() },
      'e-other': { id: 'e-other', stage: 2, label: 'Other results', count: other.length, tone: 'neutral', kind: 'email', items: other },
      'e-break': { id: 'e-break', stage: 2, label: 'Marked as a case, case not linked', count: breaks.length, tone: breaks.length ? 'bad' : 'neutral',
        hint: breaks.length ? '' : 'None found', kind: 'email', items: breaks },
      'c-new': { id: 'c-new', stage: 3, label: 'New, not yet acknowledged', count: by.new.length, tone: unacked ? 'warn' : 'neutral',
        hint: unacked ? plural(unacked, 'case') + ' over two business days' : '', kind: 'case', items: itemize(by.new) },
      'c-ack': { id: 'c-ack', stage: 3, label: 'Acknowledged', count: by.ack.length, tone: 'neutral', kind: 'case', items: itemize(by.ack) },
      'c-progress': { id: 'c-progress', stage: 3, label: 'In progress', count: by.progress.length, tone: 'neutral', kind: 'case', items: itemize(by.progress) },
      'c-waiting': { id: 'c-waiting', stage: 3, label: 'Waiting or on hold', count: by.waiting.length, tone: 'neutral', kind: 'case', items: itemize(by.waiting) },
      'c-escalated': { id: 'c-escalated', stage: 3, label: 'Escalated', count: by.escalated.length, tone: by.escalated.length ? 'bad' : 'neutral', kind: 'case', items: itemize(by.escalated) },
      'c-other': { id: 'c-other', stage: 3, label: 'Other open statuses', count: by.other.length, tone: 'neutral', kind: 'case', items: itemize(by.other) },
      'c-done': { id: 'c-done', stage: 3, label: 'Resolved or closed', count: doneInWindow.length, tone: 'good',
        hint: 'cases created in this window', kind: 'case', items: itemize(doneInWindow) },
      'x-pending': { id: 'x-pending', stage: 4, label: 'Requests still waiting for review', count: pending.length, tone: pending.length ? 'warn' : 'neutral',
        hint: 'emails about orders, lost or faulty devices, no case yet', kind: 'email', items: pending },
      'x-equip': { id: 'x-equip', stage: 4, label: 'Equipment orders', count: equip.length, tone: 'neutral',
        hint: withoutOrder(equip) ? plural(withoutOrder(equip), 'case') + ' with no order recorded' : '', kind: 'case', action: true, items: equip },
      'x-acc': { id: 'x-acc', stage: 4, label: 'Accessory orders', count: acc.length, tone: 'neutral',
        hint: withoutOrder(acc) ? plural(withoutOrder(acc), 'case') + ' with no order recorded' : '', kind: 'case', action: true, items: acc },
      'x-rma': { id: 'x-rma', stage: 4, label: 'Returns and replacements (RMA)', count: rma.length, tone: 'neutral',
        hint: 'vendor ticket recorded, or resolved as device replaced', kind: 'case', action: true, items: rma },
      'x-dev': { id: 'x-dev', stage: 4, label: 'Device problems, no vendor ticket', count: dev.length, tone: dev.length ? 'info' : 'neutral',
        hint: 'open device or lost-equipment cases', kind: 'case', action: true, items: dev },
      'x-gap': { id: 'x-gap', stage: 4, label: 'Order cases with no order recorded', count: gap.length, tone: gap.length ? 'warn' : 'neutral',
        hint: gap.length ? 'open over two business days' : 'None found', kind: 'case', action: true, items: gap },
      'x-recv': { id: 'x-recv', stage: 4, label: 'Order received, case still open', count: recv.length, tone: recv.length ? 'warn' : 'neutral',
        hint: recv.length ? '' : 'None found', kind: 'case', action: true, items: recv },
      'a-attn': { id: 'a-attn', stage: 5, label: 'Accounts to look at', count: accounts.length, tone: accounts.length ? 'warn' : 'neutral', kind: 'account', items: accounts },
      'c-noacct': { id: 'c-noacct', stage: 5, label: 'Open cases with no account', count: noAcct.length, tone: noAcct.length ? 'warn' : 'neutral', kind: 'case', items: itemize(noAcct) }
    };

    var stages = [
      { n: 1, title: 'Emails in', big: inbound.length, bigLabel: inbound.length === 1 ? 'inbound email' : 'inbound emails', lanes: ['e-all'] },
      { n: 2, title: 'Triage', big: conv == null ? null : conv + '%', bigLabel: 'of requests became or joined a case', lanes: ['e-waiting', 'e-case', 'e-nocase', 'e-system', 'e-other', 'e-break'] },
      { n: 3, title: 'Cases', big: openCases.length, bigLabel: openCases.length === 1 ? 'open case' : 'open cases', lanes: ['c-new', 'c-ack', 'c-progress', 'c-waiting', 'c-escalated', 'c-other', 'c-done'] },
      { n: 4, title: 'Orders and returns', big: actionCount, bigLabel: actionCount === 1 ? 'order or return case' : 'order or return cases', lanes: ['x-pending', 'x-equip', 'x-acc', 'x-rma', 'x-dev', 'x-gap', 'x-recv'] },
      { n: 5, title: 'Accounts', big: accounts.length, bigLabel: accounts.length === 1 ? 'account to look at' : 'accounts to look at', lanes: ['a-attn', 'c-noacct'] }
    ];

    /* Where the path is stuck, worst first. Each points at a lane. */
    var stuck = [];
    if (breaks.length) stuck.push({ lane: 'e-break', tone: 'bad', text: plural(breaks.length, 'email') + ' marked as a case but ' + (breaks.length === 1 ? 'has' : 'have') + ' no case linked' });
    if (by.escalated.length) stuck.push({ lane: 'c-escalated', tone: 'bad', text: plural(by.escalated.length, 'case') + ' escalated' });
    if (gap.length) stuck.push({ lane: 'x-gap', tone: 'warn', text: plural(gap.length, 'order case') + ' with no order recorded after two business days' });
    if (recv.length) stuck.push({ lane: 'x-recv', tone: 'warn', text: plural(recv.length, 'case') + ' with the order received but still open' });
    if (pending.length) stuck.push({ lane: 'x-pending', tone: 'warn', text: plural(pending.length, 'order or device request') + ' not yet turned into a case' });
    if (unacked) stuck.push({ lane: 'c-new', tone: 'warn', text: plural(unacked, 'new case') + ' not acknowledged after two business days' });
    if (untouched) stuck.push({ lane: 'e-waiting', tone: 'warn', text: plural(untouched, 'email') + ' left for review over two business days' });
    if (stale) stuck.push({ lane: 'a-attn', tone: 'warn', text: plural(stale, 'open case') + ' older than ' + STALE_CASE_DAYS + ' days' });
    if (noAcct.length) stuck.push({ lane: 'c-noacct', tone: 'warn', text: plural(noAcct.length, 'open case') + ' with no account' });

    return {
      now: now, days: days, lanes: lanes, stages: stages, stuck: stuck,
      totals: { inbound: inbound.length, system: system.length, historical: historical, outbound: outbound, cases: cases.length, openCases: openCases.length,
        untouched: untouched, unacked: unacked, stale: stale, conversion: conv, orders: orders.length, actionCases: actionCount },
      caseById: caseById, ordersByCase: ordersByCase
    };
  }


  /* ---------- monthly trend ---------- */
  var TZ = 'America/Chicago';
  function monthKey(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(new Date(ms));
    var y = '', m = '';
    p.forEach(function (x) { if (x.type === 'year') y = x.value; if (x.type === 'month') m = x.value; });
    return y + '-' + m;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* One row per calendar month (Central), oldest first, ending with the current month (month to date).
     Counts, not rates, except "share": requests (inbound minus automated, internal and vendor mail) that became or joined a case. */
  function trend(data, now, months) {
    months = months || 6;
    var keys = [], cur = new Date(now);
    var y = +monthKey(now).slice(0, 4), m = +monthKey(now).slice(5, 7);
    for (var i = 0; i < months; i++) { keys.unshift(y + '-' + (m < 10 ? '0' : '') + m); m -= 1; if (m === 0) { m = 12; y -= 1; } }
    var rows = {};
    keys.forEach(function (k) {
      rows[k] = { key: k, label: MONTHS[+k.slice(5, 7) - 1] + ' ' + k.slice(0, 4), current: k === keys[keys.length - 1],
        emails: 0, requests: 0, toCase: 0, share: null, cases: 0, orderCases: 0, rmaCases: 0, closed: 0 };
    });
    (data.emails || []).forEach(function (raw) {
      var r = TM.norm(raw);
      if (r.direction === 'Out' || r.result == null || r.receivedMs == null) return;
      var row = rows[monthKey(r.receivedMs)]; if (!row) return;
      row.emails += 1;
      if (SYSTEM_RESULTS.indexOf(r.result) >= 0) return;
      row.requests += 1;
      if (CASE_RESULTS.indexOf(r.result) >= 0) row.toCase += 1;
    });
    (data.cases || []).forEach(function (raw) {
      var c = normCase(raw, now, {});
      if (c.createdMs == null) return;
      var row = rows[monthKey(c.createdMs)]; if (!row) return;
      row.cases += 1;
      if (c.need === 'equipment' || c.need === 'accessory') row.orderCases += 1;
      if (c.rma) row.rmaCases += 1;
      if (!c.open) row.closed += 1;
    });
    return keys.map(function (k) { var r = rows[k]; r.share = r.requests ? Math.round(100 * r.toCase / r.requests) : null; return r; });
  }

  /* The path for one record, for the detail drawer: email -> case -> orders and returns -> account. */
  function trace(model, item, emailRows) {
    var c = null, emails = [], acct = null;
    if (item.kind === 'case') {
      c = model.caseById[item.id] || null;
      (emailRows || []).forEach(function (raw) {
        var r = TM.norm(raw);
        if (r.caseId === item.id) emails.push(r);
      });
      emails.sort(function (a, b) { return (a.receivedMs || 0) - (b.receivedMs || 0); });
    } else if (item.kind === 'email') {
      var raw = (emailRows || []).filter(function (x) { return x.id === item.id; })[0];
      if (raw) emails.push(TM.norm(raw));
      c = item.caseId ? (model.caseById[item.caseId] || null) : null;
    }
    var aid = (c && c.accountId) || item.accountId || (emails[0] && emails[0].accountId) || null;
    var aname = (c && c.accountName) || item.accountName || (emails[0] && emails[0].accountName) || '';
    if (aid || aname) acct = { id: aid, name: aname };
    var orders = c ? (model.ordersByCase[c.id] || []) : [];
    return { emails: emails, case: c, orders: orders, account: acct };
  }

  return { LIMIT_BD: LIMIT_BD, trend: trend, WINDOWS: WINDOWS, STALE_CASE_DAYS: STALE_CASE_DAYS, SYSTEM_RESULTS: SYSTEM_RESULTS, REQUEST_TOPICS: REQUEST_TOPICS, NEED_BY_CATEGORY: NEED_BY_CATEGORY,
    caseStage: caseStage, normCase: normCase, normOrder: normOrder, orderState: orderState, build: build, trace: trace, accountRollup: accountRollup };
});
