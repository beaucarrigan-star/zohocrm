/* Customer 360: pure data shaping (no DOM, no network). Works in the browser (window.C360) and in node (require).
   Inputs are raw COQL rows using live API names; output is plain objects the page renders. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.C360 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CASE_DONE = ['Closed', 'Resolved'];
  var TASK_DONE = ['Completed', 'Cancelled', 'Deferred'];
  var PHASES = ['Kickoff', 'Setup', 'Training', 'Go-live', 'Stabilize'];
  var STALE_CASE_DAYS = 14;          /* an open case older than this is flagged */
  var COLD_TOUCH = ['Cold', 'No Logged Touch'];

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  function daysFrom(dateStr, today) {            /* whole days from today to dateStr (negative = past) */
    var d = parseDate(dateStr), t = parseDate(today);
    if (d == null || t == null) return null;
    return Math.round((d - t) / 86400000);
  }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  function lookupId(v) { return v && typeof v === 'object' ? v.id : v; }
  function lookupName(v) { return v && typeof v === 'object' ? (v.name || '') : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* Renewal Band is a live formula on Contracts: Expired, "<=30 days", "<=90 days", OK (others tolerated). */
  function bandTone(band) {
    if (!band) return 'neutral';
    var b = String(band);
    if (b === 'Expired' || /30/.test(b)) return 'bad';
    if (b === 'OK') return 'good';
    return 'warn';
  }

  function daysText(days, live) {
    if (days == null) return 'No end date';
    if (days < 0) return plural(-days, 'day') + (live ? ' past end' : ' ago');
    if (days === 0) return 'Ends today';
    return plural(days, 'day') + ' left';
  }

  /* ---------- contracts ---------- */
  function shapeContracts(rows, today) {
    var out = (rows || []).filter(function (r) { return r.Counterparty_Type !== 'Vendor'; }).map(function (r) {
      var end = r.Final_End_Date || r.Contract_End_Date || null;
      var days = num(r.Days_to_Final_End);
      if (days == null) days = daysFrom(end, today);
      var ended = r.Contract_Status === 'Ended';
      var notRenewing = r.Contract_Status === 'Ending - No Renewal' || r.Renewal_Status === 'Not renewing';
      var live = !ended && !(r.Contract_Status === 'Ending - No Renewal' && days != null && days < 0);   /* wound down once past its end */
      var band = r.Renewal_Band || null;
      return {
        id: r.id, name: r.Name || 'Untitled contract', status: r.Contract_Status || '', type: r.Contract_Type || '',
        band: band, tone: ended ? 'neutral' : bandTone(band), end: end, days: days, daysText: daysText(days, live && !ended),
        renewalStatus: r.Renewal_Status || '', notice: r.Notice_Deadline || null,
        owner: lookupName(r.Owner) || '', live: live, ended: ended, notRenewing: notRenewing
      };
    });
    out.sort(function (a, b) {
      if (a.ended !== b.ended) return a.ended ? 1 : -1;
      var x = a.days == null ? 1e9 : a.days, y = b.days == null ? 1e9 : b.days;
      return x - y;
    });
    return out;
  }
  /* The renewal the customer team should watch: soonest end among contracts that are not ended and not marked non-renewing. */
  function nextRenewal(contracts) {
    var best = null;
    contracts.forEach(function (c) {
      if (c.ended || c.notRenewing || c.days == null) return;
      if (!best || c.days < best.days) best = c;
    });
    return best;
  }

  /* ---------- cases ---------- */
  function shapeCases(rows, today) {
    var all = (rows || []).map(function (r) {
      var open = CASE_DONE.indexOf(r.Status) < 0;
      var created = r.Created_Time ? String(r.Created_Time).slice(0, 10) : null;
      var age = num(r.Case_Age_days);
      if (age == null) { var d = daysFrom(created, today); age = d == null ? null : -d; }
      return {
        id: r.id, number: r.Case_Number != null ? String(r.Case_Number) : '', subject: r.Subject || '(no subject)',
        status: r.Status || '', priority: r.Priority && r.Priority !== '-None-' ? r.Priority : '', created: created, age: age,
        owner: lookupName(r.Owner) || '', open: open
      };
    });
    var open = all.filter(function (c) { return c.open; });
    open.sort(function (a, b) {
      var pa = a.priority === 'High' ? 0 : 1, pb = b.priority === 'High' ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (b.age == null ? -1 : b.age) - (a.age == null ? -1 : a.age);
    });
    var oldest = open.reduce(function (m, c) { return c.age != null && c.age > m ? c.age : m; }, 0);
    return {
      open: open, closedCount: all.length - open.length, total: all.length,
      highCount: open.filter(function (c) { return c.priority === 'High'; }).length, oldestAge: open.length ? oldest : null
    };
  }

  /* ---------- onboarding ----------
     Customer_Onboarding records are the plan; Tasks with an Onboarding Phase are the steps. Either can be missing. */
  function shapeOnboarding(records, tasks, today) {
    var rec = (records || [])[0] || null;
    var list = (tasks || []).map(function (t) {
      var done = t.Status === 'Completed';
      var closed = TASK_DONE.indexOf(t.Status) >= 0;
      var d = t.Due_Date || null;
      var dd = daysFrom(d, today);
      return {
        id: t.id, subject: t.Subject || '', status: t.Status || '', phase: t.Onboarding_Phase || '', due: d,
        gate: t.Gate === true, done: done, closed: closed, overdue: !closed && dd != null && dd < 0,
        owner: lookupName(t.Owner) || ''
      };
    });
    var counted = list.filter(function (t) { return t.status !== 'Cancelled'; });
    var done = counted.filter(function (t) { return t.done; }).length;
    var openTasks = list.filter(function (t) { return !t.closed; });
    var overdue = openTasks.filter(function (t) { return t.overdue; }).length;
    var gates = openTasks.filter(function (t) { return t.gate; }).length;
    var phase = null;
    for (var i = 0; i < PHASES.length && !phase; i++) {
      if (openTasks.some(function (t) { return t.phase === PHASES[i]; })) phase = PHASES[i];
    }
    if (!phase && rec && rec.Phase && rec.Phase !== '-None-') phase = rec.Phase;
    var next = openTasks.filter(function (t) { return t.due; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; })[0] || null;
    if (!rec && !list.length) {
      return { state: 'none', label: 'No onboarding on file', tone: 'neutral', total: 0, done: 0, overdue: 0, gates: 0, phase: null, tasks: [], record: null, next: null, pct: null };
    }
    var recStatus = rec && rec.Status && rec.Status !== '-None-' ? rec.Status : '';
    var risk = rec && rec.Risk && rec.Risk !== '-None-' ? rec.Risk : '';
    var complete = (recStatus === 'Completed') || (!rec && counted.length > 0 && openTasks.length === 0);
    var state = complete ? 'complete' : (recStatus === 'On hold' ? 'hold' : recStatus === 'Cancelled' ? 'cancelled' : 'active');
    var tone = state === 'complete' ? 'good' : state === 'hold' || risk === 'Stalled' || overdue > 0 ? 'bad' : risk === 'At Risk' ? 'warn' : 'info';
    if (state === 'cancelled') tone = 'neutral';
    var label = state === 'complete' ? 'Onboarding complete'
      : state === 'hold' ? 'Onboarding on hold'
      : state === 'cancelled' ? 'Onboarding cancelled'
      : (phase ? 'Onboarding: ' + phase : 'Onboarding in progress');
    var goLive = rec ? (rec.Go_live_Actual || rec.Go_live_Target || null) : null;
    return {
      state: state, label: label, tone: tone, risk: risk, total: counted.length, done: done, overdue: overdue, gates: gates, phase: phase,
      tasks: list, record: rec ? { id: rec.id, status: recStatus, risk: risk, goLive: goLive, goLiveActual: !!(rec && rec.Go_live_Actual), blocked: rec.Blocked_Reason || '' } : null,
      next: next, pct: counted.length ? Math.round(100 * done / counted.length) : null
    };
  }

  /* ---------- contacts ---------- */
  function shapeContacts(rows) {
    var out = (rows || []).map(function (r) {
      var flags = [];
      if (r.Stock_Alert_Recipient === true) flags.push('Stock alerts');
      if (r.Receives_Collections === true) flags.push('Collections');
      var last = r.Last_Activity_Time ? String(r.Last_Activity_Time).slice(0, 10) : null;
      return {
        id: r.id, name: r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '(no name)', title: r.Title || '',
        email: r.Email || '', phone: r.Phone || r.Mobile || '', flags: flags, lastActivity: last,
        lastEmail: r.Last_Inbound_Email ? String(r.Last_Inbound_Email).slice(0, 10) : null
      };
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  /* ---------- account header ---------- */
  function shapeAccount(r) {
    r = r || {};
    function pick(v) { return v && v !== '-None-' ? v : ''; }
    return {
      id: r.id, name: r.Account_Name || 'Account', owner: lookupName(r.Owner), type: pick(r.Account_Type),
      healthTier: pick(r.Health_Tier), healthScore: num(r.Health_Score), customerHealth: pick(r.Customer_Health),
      touch: pick(r.Touch_Status), daysSinceTouch: num(r.Days_Since_Touch), lastTouch: r.Last_Touch || null,
      renewalDate: r.Renewal_Date || null, renewalAmount: num(r.Renewal_Amount), former: r.Former_Customer === true,
      phone: r.Phone || '', website: r.Website || ''
    };
  }

  /* ---------- health / renewal summary ---------- */
  var RANK = { bad: 0, warn: 1, info: 2, good: 3 };
  function summarize(d, today) {
    var acct = d.account, contracts = d.contracts || [], cases = d.cases, onb = d.onboarding;
    var signals = [];
    function add(tone, text) { signals.push({ tone: tone, text: text }); }

    if (acct.former) add('bad', 'Marked as a former customer');
    if (acct.healthTier === 'Red') add('bad', 'Health is Red' + (acct.healthScore != null ? ' (score ' + acct.healthScore + ')' : ''));
    else if (acct.healthTier === 'Yellow') add('warn', 'Health is Yellow' + (acct.healthScore != null ? ' (score ' + acct.healthScore + ')' : ''));
    if (acct.customerHealth === 'Critical') add('bad', 'Customer health is Critical');
    else if (acct.customerHealth === 'At Risk') add('warn', 'Customer health is At Risk');

    var next = nextRenewal(contracts);
    if (next) {
      if (next.days < 0) add('bad', next.name + ' ended ' + plural(-next.days, 'day') + ' ago and is still not renewed');
      else if (next.days <= 30) add('bad', next.name + ' ends in ' + plural(next.days, 'day'));
      else if (next.days <= 90) add('warn', next.name + ' ends in ' + plural(next.days, 'day'));
      if (next.days <= 90 && next.renewalStatus === 'Not started') add('warn', 'Renewal has not been started');
    }
    contracts.filter(function (c) { return c.live && c.notRenewing; }).forEach(function (c) {
      add('bad', c.name + ' is ending with no renewal');
    });

    if (cases.highCount) add('warn', plural(cases.highCount, 'high-priority open case'));
    if (cases.oldestAge != null && cases.oldestAge > STALE_CASE_DAYS) add('warn', 'Oldest open case is ' + plural(cases.oldestAge, 'day') + ' old');

    if (acct.touch && COLD_TOUCH.indexOf(acct.touch) >= 0) {
      add('warn', acct.touch === 'No Logged Touch' ? 'No logged contact with this customer' : 'No contact in ' + (acct.daysSinceTouch != null ? plural(acct.daysSinceTouch, 'day') : 'a long time'));
    }
    if (onb.state === 'active') {
      if (onb.overdue) add('bad', plural(onb.overdue, 'overdue onboarding task'));
      if (onb.risk === 'Stalled') add('bad', 'Onboarding is stalled');
      else if (onb.risk === 'At Risk') add('warn', 'Onboarding is at risk');
    } else if (onb.state === 'hold') add('warn', 'Onboarding is on hold');

    signals.sort(function (a, b) { return RANK[a.tone] - RANK[b.tone]; });
    var level = signals.some(function (s) { return s.tone === 'bad'; }) ? 'bad' : signals.some(function (s) { return s.tone === 'warn'; }) ? 'warn' : 'good';
    var headline = level === 'bad' ? 'Needs attention' : level === 'warn' ? 'Keep an eye on this customer' : 'On track';
    var liveCount = contracts.filter(function (c) { return c.live; }).length;

    var renewal = next ? { name: next.name, id: next.id, days: next.days, band: next.band, tone: next.tone, end: next.end, status: next.renewalStatus, text: daysText(next.days, true) }
      : (acct.renewalDate ? { name: 'Account renewal date', id: null, days: daysFrom(acct.renewalDate, today), band: null, tone: 'neutral', end: acct.renewalDate, status: '', text: daysText(daysFrom(acct.renewalDate, today), true) } : null);

    return {
      level: level, headline: headline, signals: signals,
      sub: signals.slice(0, 3).map(function (s) { return s.text; }).join('. ') || 'No renewal, case or onboarding concerns found.',
      renewal: renewal,
      tiles: {
        liveContracts: liveCount, totalContracts: contracts.length,
        openCases: cases.open.length, highCases: cases.highCount,
        onboarding: onb.label, contacts: (d.contacts || []).length
      }
    };
  }

  function build(raw, today) {
    var account = shapeAccount(raw.account);
    var contracts = shapeContracts(raw.contracts, today);
    var cases = shapeCases(raw.cases, today);
    var onboarding = shapeOnboarding(raw.onboarding, raw.tasks, today);
    var contacts = shapeContacts(raw.contacts);
    var data = { account: account, contracts: contracts, cases: cases, onboarding: onboarding, contacts: contacts };
    data.summary = summarize(data, today);
    return data;
  }

  return {
    parseDate: parseDate, daysFrom: daysFrom, bandTone: bandTone, daysText: daysText,
    shapeContracts: shapeContracts, nextRenewal: nextRenewal, shapeCases: shapeCases, shapeOnboarding: shapeOnboarding,
    shapeContacts: shapeContacts, shapeAccount: shapeAccount, summarize: summarize, build: build,
    PHASES: PHASES, STALE_CASE_DAYS: STALE_CASE_DAYS
  };
});
