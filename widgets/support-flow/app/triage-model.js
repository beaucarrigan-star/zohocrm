/* Support Emails triage: pure bucketing logic (no DOM, no Zoho). Works in browser (window.TriageModel) and node (require).
   Field names are the live Support_Emails API names (read 11 Oct 2026).
   12 Oct 2026: live intake rows have Received_At empty (only imported history has it) and Last_Activity_Time is set on
   every row, so the aging clock falls back to Created_Time and "untouched" no longer looks at activity. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TriageModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Chicago';
  var DAY = 86400000;
  var UNTOUCHED_RESULT = 'Left for review';
  /* Intake_Result values that mean "a person may still need to look at this". */
  var NEEDS_ACCOUNT_RESULTS = ['Left for review', 'Case created', 'Added to existing case', 'Voicemail'];
  var IGNORED = 'Ignored';

  /* Wall-clock milliseconds in tz, expressed as if UTC. Business-day arithmetic runs on these
     so DST shifts never move a due time. */
  var fmtCache = {};
  function wallMs(ms, tz) {
    tz = tz || TZ;
    var f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  }
  function ymd(w) { return new Date(w).toISOString().slice(0, 10); }
  function isBusinessDay(w, holidays) {
    var d = new Date(w).getUTCDay();
    if (d === 0 || d === 6) return false;
    return !(holidays && holidays.indexOf(ymd(w)) >= 0);
  }
  /* A mail received on a non-business day starts its clock at 00:00 of the next business day. */
  function startOf(w, holidays) {
    if (isBusinessDay(w, holidays)) return w;
    var d = Math.floor(w / DAY) * DAY;
    do { d += DAY; } while (!isBusinessDay(d, holidays));
    return d;
  }
  function addBusinessDay(w, holidays) {
    var n = w;
    do { n += DAY; } while (!isBusinessDay(n, holidays));
    return n;
  }
  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  /* Whole business days elapsed since received, strictly: a mail is 1 day old only once now is PAST
     received + 1 business day (same time of day). opts: {tz, holidays:['YYYY-MM-DD']} */
  function businessDaysElapsed(receivedAt, nowAt, opts) {
    opts = opts || {};
    var r = toMs(receivedAt), n = toMs(nowAt);
    if (r == null || n == null) return null;
    var wn = wallMs(n, opts.tz), cur = startOf(wallMs(r, opts.tz), opts.holidays), count = 0;
    if (wn < cur) return 0;
    for (;;) {
      var next = addBusinessDay(cur, opts.holidays);
      if (next < wn) { count += 1; cur = next; } else break;
      if (count > 400) break;
    }
    return count;
  }
  /* Due moment as wall-clock ISO text (for display/tests). */
  function dueWall(receivedAt, opts) {
    opts = opts || {};
    var r = toMs(receivedAt);
    if (r == null) return null;
    var w = wallMs(r, opts.tz), s = startOf(w, opts.holidays);
    var base = s === w ? w : s;
    return new Date(addBusinessDay(base, opts.holidays)).toISOString().slice(0, 19);
  }

  function norm(r) {
    var acct = r.Account && r.Account.id ? r.Account.id : (typeof r.Account === 'string' && r.Account ? r.Account : null);
    var received = toMs(r.Received_At);
    return {
      id: r.id,
      subject: r.Name || '',
      senderEmail: r.Sender_Email || '',
      senderName: r.Sender_Name || '',
      mailbox: r.Recipient_Email || '',
      topic: r.Topic && r.Topic !== '-None-' ? r.Topic : '',
      direction: r.Direction && r.Direction !== '-None-' ? r.Direction : 'In',
      result: r.Intake_Result && r.Intake_Result !== '-None-' ? r.Intake_Result : null,
      source: r.Source && r.Source !== '-None-' ? r.Source : null,
      accountId: acct,
      accountName: r.Account && r.Account.name ? r.Account.name : '',
      caseId: r.Case && r.Case.id ? r.Case.id : null,
      caseName: r.Case && r.Case.name ? r.Case.name : '',
      /* Received_At is empty on live intake rows; Created_Time is when the row was written, minutes after arrival. */
      receivedMs: received != null ? received : toMs(r.Created_Time),
      lastActivityMs: toMs(r.Last_Activity_Time),
      threadLink: r.Thread_Link || ''
    };
  }

  /* Classify one row. Returns flags; a row can be in more than one lane (untouched AND no account).
     Untouched = still Left for review (moving it to Ignored or Case created is what touches it) and over minDays business days old.
     Last_Activity_Time is not used: Zoho sets it on every row. */
  function classify(raw, nowAt, opts) {
    opts = opts || {};
    var minDays = opts.minDays == null ? 1 : opts.minDays;
    var r = norm(raw), f = { row: r, outbound: false, historical: false, ignored: false, untouched: false, noAccount: false, ageBD: null };
    if (r.direction === 'Out') { f.outbound = true; return f; }
    if (r.result === IGNORED) { f.ignored = true; return f; }
    if (r.result == null) { f.historical = true; return f; }     /* live intake always sets a result; null = imported history */
    f.ageBD = businessDaysElapsed(r.receivedMs, nowAt, opts);
    if (r.result === UNTOUCHED_RESULT && f.ageBD != null && f.ageBD >= minDays) f.untouched = true;
    if (!r.accountId && NEEDS_ACCOUNT_RESULTS.indexOf(r.result) >= 0) f.noAccount = true;
    return f;
  }

  function byOldest(a, b) { return (a.row.receivedMs || 0) - (b.row.receivedMs || 0); }
  function byNewest(a, b) { return (b.row.receivedMs || 0) - (a.row.receivedMs || 0); }

  function bucket(rows, nowAt, opts) {
    var out = { untouched: [], noAccount: [], ignored: [], historical: 0, outbound: 0, total: 0, other: 0 };
    (rows || []).forEach(function (raw) {
      var f = classify(raw, nowAt, opts);
      out.total += 1;
      if (f.outbound) { out.outbound += 1; return; }
      if (f.ignored) { out.ignored.push(f); return; }
      if (f.historical) { out.historical += 1; return; }
      var placed = false;
      if (f.untouched) { out.untouched.push(f); placed = true; }
      if (f.noAccount) { out.noAccount.push(f); placed = true; }
      if (!placed) out.other += 1;
    });
    out.untouched.sort(byOldest);
    out.noAccount.sort(byNewest);
    out.ignored.sort(byNewest);
    return out;
  }

  return {
    TZ: TZ, UNTOUCHED_RESULT: UNTOUCHED_RESULT, NEEDS_ACCOUNT_RESULTS: NEEDS_ACCOUNT_RESULTS, IGNORED: IGNORED,
    wallMs: wallMs, isBusinessDay: isBusinessDay, businessDaysElapsed: businessDaysElapsed, dueWall: dueWall,
    classify: classify, bucket: bucket, norm: norm
  };
});
