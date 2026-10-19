/* Contracts flow: pure logic (no DOM, no Zoho). Works in browser (window.ContractsFlowModel) and node (require).
   Follows each contract from the packet being added, through ingest (read), review (rate lines and clauses verified), the vendor-cost margin check,
   to renewal. Lists the contracts where a step was skipped or is overdue.
   Field names read live 12 Oct 2026: Contracts (Ingest_Status Backlog / Not Ingested / Needs Review / Ingested / Failed, Margin_Cost_Check
   Costs match contracts / Cost differs / Missing vendor cost / blank, Reconciliation_Status, Renewal_Status, Notice_Deadline, Final_End_Date),
   Contract_Documents (Contract, Parse_Status), Contract_Clauses (Contract, Status Proposed / Confirmed / Rejected), Rate_Lines (Parent_Id = Contract, Line_Status).
   Renewal_Status values (renamed 18 Oct 2026): Not started / Outreach / Terms agreed / Sent for signature / Needs decision / Renewed / Not renewing.
   The line-status rule is the same as contract-review-widget/app/line-status.js H.lineStatus. Change together. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ContractsFlowModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var REVIEW_LIMIT_DAYS = 14;     /* days a contract may sit in Needs Review before it counts as stuck (not yet decided by Beau: adjustable on the page) */
  var ENDED = ['Ended', 'Ending - No Renewal'];
  var SETTLED = ['Renewed', 'Not renewing'];   /* Renewal_Status values that mean nothing more to chase ("Sent for signature" is still open: the signature has not come back) */
  var UNDER_WAY = ['Outreach', 'Terms agreed', 'Sent for signature', 'Needs decision'];   /* renewal started, not finished */
  var SCOPES = [{ id: 'all', label: 'All contracts' }, { id: 'Customer', label: 'Customers' }, { id: 'Vendor', label: 'Vendors' }];

  function pickVal(v) { return v && v !== '-None-' ? String(v) : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  /* calendar date in Central, as a UTC day number */
  function centralDay(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY;
  }
  function dateDay(v) { if (!v) return null; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null; }
  function ageDays(ms, now) { return ms == null ? null : centralDay(now) - centralDay(ms); }

  /* same rule as line-status.js */
  function lineStatus(r) {
    var ls = pickVal(r.Line_Status), sb = String(r.Superseded_By || '');
    if (ls === 'Superseded' || ls === 'Rejected') return ls;
    if (sb) return sb.indexOf('Rejected') === 0 ? 'Rejected' : 'Superseded';
    if (ls === 'Verified' || ls === 'Proposed') return ls;
    return r.Line_Verified === true || r.Line_Verified === 'true' ? 'Verified' : 'Proposed';
  }
  function bandOf(days) {
    if (days == null) return '';
    if (days < 0) return 'Expired';
    if (days <= 15) return '≤15 days';
    if (days <= 30) return '≤30 days';
    if (days <= 60) return '≤60 days';
    if (days <= 90) return '≤90 days';
    return 'OK';
  }

  function normContract(r, now) {
    var acct = lk(r.Account), status = pickVal(r.Contract_Status), today = centralDay(now);
    var end = dateDay(r.Final_End_Date), notice = dateDay(r.Notice_Deadline);
    var days = end == null ? null : end - today;
    return {
      id: r.id, name: r.Name || '', accountId: acct.id, accountName: acct.name, cp: pickVal(r.Counterparty_Type) || 'Customer', type: pickVal(r.Contract_Type),
      status: status, live: ENDED.indexOf(status) < 0, ingest: pickVal(r.Ingest_Status) || 'Backlog', ingestedMs: toMs(r.Ingested_On), verifiedMs: toMs(r.Last_Verified),
      margin: pickVal(r.Margin_Cost_Check), recon: pickVal(r.Reconciliation_Status), renewal: pickVal(r.Renewal_Status), endDate: r.Final_End_Date || null, endMs: toMs(r.Final_End_Date),
      days: days, band: bandOf(days), noticeDays: notice == null ? null : notice - today, owner: lk(r.Owner).name,
      docs: [], clauses: [], lines: []
    };
  }

  function cItem(c, state, tone, note, ms, ageText) {
    return { kind: 'contract', id: c.id, title: c.name || '(unnamed contract)', sub: [c.cp === 'Vendor' ? 'Vendor contract' : c.type, c.status].filter(Boolean).join(' / '),
      accountId: c.accountId, accountName: c.accountName || (c.cp === 'Vendor' ? 'Vendor' : ''), ms: ms == null ? c.endMs : ms, age: null, ageText: ageText || '',
      state: state, tone: tone || 'info', note: note || '', contractId: c.id };
  }
  function daysText(c) {
    if (c.days == null) return 'No end date';
    return c.days < 0 ? 'ended ' + plural(-c.days, 'day') + ' ago' : c.days === 0 ? 'ends today' : plural(c.days, 'day') + ' left';
  }
  function sortEnd(a, b) { return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms); }
  function sortOld(a, b) { return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms); }

  /* data = { contracts, docs, clauses, lines } raw rows.
     opts = { scope: 'all'|'Customer'|'Vendor', reviewLimit (days), parseAvailable } */
  function build(data, now, opts) {
    opts = opts || {}; data = data || {};
    var scope = opts.scope || 'all';
    var limit = opts.reviewLimit == null ? REVIEW_LIMIT_DAYS : opts.reviewLimit;
    var all = (data.contracts || []).map(function (r) { return normContract(r, now); });
    var endedCount = all.filter(function (c) { return !c.live; }).length;
    var byId = {}; all.forEach(function (c) { byId[c.id] = c; });

    var orphanDocs = [], orphanClauses = [];
    (data.docs || []).forEach(function (r) {
      var d = { id: r.id, name: r.Name || '', contractId: lk(r.Contract).id, parse: pickVal(r.Parse_Status), ms: toMs(r.Created_Time) };
      var c = d.contractId && byId[d.contractId]; if (c) c.docs.push(d); else orphanDocs.push(d);
    });
    (data.clauses || []).forEach(function (r) {
      var k = { id: r.id, name: r.Name || '', contractId: lk(r.Contract).id, status: pickVal(r.Status) || 'Proposed', type: pickVal(r.Clause_Type), ms: toMs(r.Created_Time) };
      var c = k.contractId && byId[k.contractId]; if (c) c.clauses.push(k); else if (!k.contractId) orphanClauses.push(k);
    });
    (data.lines || []).forEach(function (r) {
      var parent = lk(r.Parent_Id), c = parent.id && byId[parent.id]; if (!c) return;
      var st = lineStatus(r);
      c.lines.push({ id: r.id, status: st, device: pickVal(r.Rate_Device), type: pickVal(r.Rate_Type), hand: !r.Source_Ref });
    });
    all.forEach(function (c) {
      c.pendingLines = c.lines.filter(function (l) { return l.status === 'Proposed' && !l.hand; }).length;
      c.verifiedLines = c.lines.filter(function (l) { return l.status === 'Verified'; }).length;
      c.pendingClauses = c.clauses.filter(function (k) { return k.status === 'Proposed'; }).length;
      c.confirmedClauses = c.clauses.filter(function (k) { return k.status === 'Confirmed'; }).length;
      c.ingestAge = ageDays(c.ingestedMs, now);
    });

    var list = all.filter(function (c) { return c.live && (scope === 'all' || c.cp === scope); });
    var cust = list.filter(function (c) { return c.cp !== 'Vendor'; });
    var f = function (arr, fn) { return arr.filter(fn); };
    var it = function (arr, state, tone, noteFn, msFn, ageFn) {
      return arr.map(function (c) { return cItem(c, typeof state === 'function' ? state(c) : state, typeof tone === 'function' ? tone(c) : tone, noteFn ? noteFn(c) : '', msFn ? msFn(c) : null, ageFn ? ageFn(c) : ''); });
    };
    var L = {};
    function lane(id, stage, label, items, tone, hint, kind) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind || 'contract', items: items }; }
    var none = function (a) { return a.length ? '' : 'None found'; };

    /* ---- 1 packet in ---- */
    var withFiles = f(list, function (c) { return c.docs.length > 0; });
    var noFiles = f(list, function (c) { return !c.docs.length && (c.ingest === 'Backlog' || c.ingest === 'Not Ingested'); });
    var docsScoped = scope === 'all' ? orphanDocs : [];
    var parseBad = [];
    list.forEach(function (c) { c.docs.forEach(function (d) { if (d.parse === 'Failed') parseBad.push({ d: d, c: c }); }); });
    var docItem = function (d, c, note, tone) {
      return { kind: 'doc', id: d.id, title: d.name || 'Document', sub: c ? c.name : 'No contract linked', accountId: c ? c.accountId : null, accountName: c ? c.accountName : '', ms: d.ms,
        age: null, ageText: '', state: d.parse || 'Not recorded', tone: tone || 'warn', note: note || '', contractId: c ? c.id : null };
    };
    lane('p-files', 1, 'Contracts with files', it(withFiles, function (c) { return plural(c.docs.length, 'file'); }, 'neutral', null, function (c) { return c.endMs; }, daysText).sort(sortEnd), 'neutral', 'a packet has been added', 'contract');
    lane('p-nofiles', 1, 'Not read and no files', it(noFiles, function (c) { return c.ingest; }, 'neutral', function () { return 'Nothing to read until a packet is added.'; }, null, daysText).sort(sortEnd), 'neutral', 'add a packet to start the path', 'contract');
    lane('p-orphan', 1, 'Files with no contract', docsScoped.map(function (d) { return docItem(d, null, 'The file is not linked to a contract.'); }).sort(sortOld), 'warn', none(docsScoped), 'doc');
    lane('p-parse', 1, 'Files that could not be parsed', parseBad.map(function (x) { return docItem(x.d, x.c, 'Parse status is Failed.', 'bad'); }), 'bad',
      opts.parseAvailable === false ? 'Parse status is not on Contract Documents yet' : none(parseBad), 'doc');

    /* ---- 2 read ---- */
    var backlog = f(list, function (c) { return c.ingest === 'Backlog'; });
    var backlogFiles = f(backlog, function (c) { return c.docs.length > 0; });
    var notIng = f(list, function (c) { return c.ingest === 'Not Ingested'; });
    var failed = f(list, function (c) { return c.ingest === 'Failed' || c.ingest === 'Ingest failed'; });
    var needs = f(list, function (c) { return c.ingest === 'Needs Review'; });
    var needsOld = f(needs, function (c) { return c.ingestAge != null && c.ingestAge >= limit; });
    var ingested = f(list, function (c) { return c.ingest === 'Ingested'; });
    var ageOf = function (c) { return c.ingestAge == null ? '' : plural(c.ingestAge, 'day') + ' since read'; };
    lane('r-backlog-files', 2, 'Backlog with files, ready to read', it(backlogFiles, 'Backlog', 'info', function (c) { return plural(c.docs.length, 'file') + ' waiting to be read.'; }, null, daysText).sort(sortEnd), 'info', none(backlogFiles), 'contract');
    lane('r-backlog', 2, 'Backlog (not read yet)', it(backlog, 'Backlog', 'neutral', null, null, daysText).sort(sortEnd), 'neutral', 'soonest end date first', 'contract');
    lane('r-not', 2, 'Not ingested', it(notIng, 'Not ingested', 'neutral', null, null, daysText).sort(sortEnd), 'neutral', '', 'contract');
    lane('r-failed', 2, 'Ingest failed', it(failed, 'Ingest failed', 'bad', function () { return 'The read did not finish. Try the ingest again.'; }, function (c) { return c.ingestedMs; }, ageOf), 'bad', none(failed), 'contract');
    lane('r-needs', 2, 'Needs review', it(needs, 'Needs review', function (c) { return c.ingestAge != null && c.ingestAge >= limit ? 'warn' : 'info'; }, null, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'neutral', '', 'contract');
    lane('r-needs-old', 2, 'Needs review for too long', it(needsOld, 'Needs review', 'warn', function (c) { return 'Read ' + plural(c.ingestAge, 'day') + ' ago and still waiting for a person.'; }, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'warn',
      needsOld.length ? 'over ' + plural(limit, 'day') : 'None found', 'contract');

    /* ---- 3 reviewed ---- */
    var withPending = f(list, function (c) { return c.pendingLines > 0 || c.pendingClauses > 0; });
    var pendLines = f(list, function (c) { return c.pendingLines > 0; });
    var pendClauses = f(list, function (c) { return c.pendingClauses > 0; });
    var ready = f(needs, function (c) { return c.pendingLines === 0 && c.pendingClauses === 0 && (c.lines.length || c.clauses.length); });
    var nothing = f(needs, function (c) { return !c.lines.length && !c.clauses.length; });
    var ingPending = f(ingested, function (c) { return c.pendingLines > 0 || c.pendingClauses > 0; });
    var ingNoVerify = f(ingested, function (c) { return c.verifiedMs == null; });
    var done = f(ingested, function (c) { return c.pendingLines === 0 && c.pendingClauses === 0 && c.verifiedMs != null; });
    var pendNote = function (c) { return [c.pendingLines ? plural(c.pendingLines, 'rate line') : '', c.pendingClauses ? plural(c.pendingClauses, 'clause') : ''].filter(Boolean).join(' and ') + ' waiting for Verify or Reject.'; };
    lane('v-lines', 3, 'Rate lines waiting', it(pendLines, function (c) { return c.ingest; }, 'info', function (c) { return plural(c.pendingLines, 'rate line') + ' to verify.'; }, null, daysText).sort(sortEnd), 'neutral', 'ingested lines still Proposed', 'contract');
    lane('v-clauses', 3, 'Clauses waiting', it(pendClauses, function (c) { return c.ingest; }, 'info', function (c) { return plural(c.pendingClauses, 'clause') + ' to confirm.'; }, null, daysText).sort(sortEnd), 'neutral', '', 'contract');
    lane('v-ready', 3, 'Reviewed, ready to mark done', it(ready, 'Needs review', 'good', function (c) { return 'Every line and clause has been decided, but the contract still says Needs review.'; }, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'good', none(ready), 'contract');
    lane('v-nothing', 3, 'Read, but nothing found', it(nothing, 'Needs review', 'warn', function () { return 'Needs review, yet no rate lines or clauses were produced.'; }, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'warn', none(nothing), 'contract');
    lane('v-ing-pending', 3, 'Marked ingested, items still waiting', it(ingPending, 'Ingested', 'warn', pendNote, function (c) { return c.verifiedMs; }, ageOf).sort(sortOld), 'warn', none(ingPending), 'contract');
    lane('v-ing-noverify', 3, 'Marked ingested, never verified', it(ingNoVerify, 'Ingested', 'warn', function () { return 'No verified date is recorded.'; }, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'warn', none(ingNoVerify), 'contract');
    lane('v-done', 3, 'Reviewed and verified', it(done, 'Verified', 'good', null, function (c) { return c.verifiedMs; }).sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); }), 'good', '', 'contract');
    var orphanK = scope === 'all' ? orphanClauses : [];
    lane('v-orphan', 3, 'Clauses with no contract', orphanK.map(function (k) {
      return { kind: 'clause', id: k.id, title: k.name || 'Clause', sub: [k.type, k.status].filter(Boolean).join(' / '), accountId: null, accountName: '', ms: k.ms, age: null, ageText: '', state: k.status, tone: 'warn', note: 'The clause is not linked to a contract.', contractId: null };
    }).sort(sortOld), 'warn', none(orphanK), 'clause');

    /* ---- 4 margin checked (customer contracts: the check compares vendor cost with the contract rate) ---- */
    var mt = function (v) { return f(cust, function (c) { return c.margin === v; }); };
    var mMatch = mt('Costs match contracts'), mDiff = mt('Cost differs'), mMissing = mt('Missing vendor cost');
    var mNone = f(cust, function (c) { return !c.margin; });
    var ingNoMargin = f(ingested.filter(function (c) { return c.cp !== 'Vendor'; }), function (c) { return !c.margin; });
    var rDiff = f(cust, function (c) { return c.recon === 'Rate differs'; }), rHand = f(cust, function (c) { return c.recon === 'Check by hand'; });
    lane('m-match', 4, 'Costs match contracts', it(mMatch, 'Costs match', 'good', null, null, daysText).sort(sortEnd), 'good', '', 'contract');
    lane('m-diff', 4, 'Cost differs from the contract', it(mDiff, 'Cost differs', 'warn', function () { return 'The vendor cost check found a difference.'; }, null, daysText).sort(sortEnd), 'warn', none(mDiff), 'contract');
    lane('m-missing', 4, 'Missing vendor cost', it(mMissing, 'Missing cost', 'warn', function () { return 'No vendor cost to compare, so margin cannot be trusted.'; }, null, daysText).sort(sortEnd), 'warn', none(mMissing), 'contract');
    lane('m-none', 4, 'Check not run', it(mNone, 'Not run', 'neutral', null, null, daysText).sort(sortEnd), 'neutral', 'no result on the contract', 'contract');
    lane('m-ing-none', 4, 'Ingested but never margin checked', it(ingNoMargin, 'Ingested', 'warn', function () { return 'Read and ingested, but the vendor cost check left no result.'; }, function (c) { return c.ingestedMs; }, ageOf).sort(sortOld), 'warn', none(ingNoMargin), 'contract');
    lane('m-rate', 4, 'Rate differs from the paper copy', it(rDiff, 'Rate differs', 'warn', function () { return 'Reconciliation says the rate differs.'; }, null, daysText).sort(sortEnd), 'warn', none(rDiff), 'contract');
    lane('m-hand', 4, 'Reconciliation: check by hand', it(rHand, 'Check by hand', 'neutral', null, null, daysText).sort(sortEnd), 'neutral', '', 'contract');

    /* ---- 5 renewal (customer contracts only) ---- */
    var open = f(cust, function (c) { return SETTLED.indexOf(c.renewal) < 0; });
    var expired = f(open, function (c) { return c.days != null && c.days < 0; });
    var in30 = f(open, function (c) { return c.days != null && c.days >= 0 && c.days <= 30; });
    var in90 = f(open, function (c) { return c.days != null && c.days > 30 && c.days <= 90; });
    var noDate = f(cust, function (c) { return c.days == null; });
    var noticePast = f(open, function (c) { return c.days != null && c.days >= 0 && c.noticeDays != null && c.noticeDays < 0 && c.renewal === 'Not started'; });
    var inTalks = f(open, function (c) { return UNDER_WAY.indexOf(c.renewal) >= 0; });
    var okRen = f(cust, function (c) { return SETTLED.indexOf(c.renewal) >= 0 || (c.days != null && c.days > 90); });
    var rt = function (c) { return c.renewal || 'No status'; };
    lane('n-expired', 5, 'Past the end date, not renewed', it(expired, rt, 'bad', function (c) { return 'Ended ' + plural(-c.days, 'day') + ' ago and the contract is still live with renewal ' + (c.renewal ? c.renewal.toLowerCase() : 'not recorded') + '.'; }, null, daysText).sort(sortEnd), 'bad', none(expired), 'contract');
    lane('n-30', 5, 'Ends within 30 days', it(in30, rt, function (c) { return c.renewal === 'Not started' ? 'bad' : 'warn'; }, function (c) { return c.renewal === 'Not started' ? 'Renewal has not started.' : ''; }, null, daysText).sort(sortEnd), 'warn', none(in30), 'contract');
    lane('n-90', 5, 'Ends in 31 to 90 days', it(in90, rt, function (c) { return c.renewal === 'Not started' ? 'info' : 'neutral'; }, null, null, daysText).sort(sortEnd), 'neutral', '', 'contract');
    lane('n-notice', 5, 'Notice date passed, renewal not started', it(noticePast, rt, 'warn', function (c) { return 'Notice deadline passed ' + plural(-c.noticeDays, 'day') + ' ago.'; }, null, daysText).sort(sortEnd), 'warn', none(noticePast), 'contract');
    lane('n-talks', 5, 'Renewal under way', it(inTalks, rt, 'info', null, null, daysText).sort(sortEnd), 'neutral', 'outreach, terms agreed, sent for signature or needs decision', 'contract');
    lane('n-nodate', 5, 'No end date', it(noDate, rt, 'warn', function () { return 'Final end date is blank, so no renewal date can be tracked.'; }, null, daysText), 'warn', none(noDate), 'contract');
    lane('n-ok', 5, 'On track', it(okRen, rt, 'good', null, null, daysText).sort(sortEnd), 'good', 'over 90 days or settled', 'contract');

    var stages = [
      { n: 1, title: 'Packet in', big: withFiles.length, bigLabel: 'contracts with files added', lanes: ['p-files', 'p-nofiles', 'p-orphan', 'p-parse'] },
      { n: 2, title: 'Read', big: needs.length + failed.length + backlogFiles.length, bigLabel: 'need a read or a person', lanes: ['r-backlog-files', 'r-backlog', 'r-not', 'r-failed', 'r-needs', 'r-needs-old'] },
      { n: 3, title: 'Reviewed', big: withPending.length, bigLabel: 'contracts with lines or clauses waiting', lanes: ['v-lines', 'v-clauses', 'v-ready', 'v-nothing', 'v-ing-pending', 'v-ing-noverify', 'v-done', 'v-orphan'] },
      { n: 4, title: 'Margin checked', big: mDiff.length + mMissing.length, bigLabel: 'with a cost problem', lanes: ['m-match', 'm-diff', 'm-missing', 'm-none', 'm-ing-none', 'm-rate', 'm-hand'] },
      { n: 5, title: 'Renewal', big: expired.length + in30.length + in90.length, bigLabel: 'ended or ending within 90 days', lanes: ['n-expired', 'n-30', 'n-90', 'n-notice', 'n-talks', 'n-nodate', 'n-ok'] }
    ];

    var stuck = [];
    var in30Start = in30.filter(function (c) { return c.renewal === 'Not started'; });
    if (failed.length) stuck.push({ lane: 'r-failed', tone: 'bad', text: plural(failed.length, 'contract') + ' where the ingest failed' });
    if (expired.length) stuck.push({ lane: 'n-expired', tone: 'bad', text: plural(expired.length, 'live contract') + ' past the end date and not renewed' });
    if (in30Start.length) stuck.push({ lane: 'n-30', tone: 'bad', text: plural(in30Start.length, 'contract') + ' ending within 30 days with renewal not started' });
    if (needsOld.length) stuck.push({ lane: 'r-needs-old', tone: 'warn', text: plural(needsOld.length, 'contract') + ' in Needs review for over ' + plural(limit, 'day') });
    if (ingPending.length) stuck.push({ lane: 'v-ing-pending', tone: 'warn', text: plural(ingPending.length, 'contract') + ' marked ingested with lines or clauses still waiting' });
    if (nothing.length) stuck.push({ lane: 'v-nothing', tone: 'warn', text: plural(nothing.length, 'contract') + ' read with nothing found' });
    if (ingNoMargin.length) stuck.push({ lane: 'm-ing-none', tone: 'warn', text: plural(ingNoMargin.length, 'ingested contract') + ' never margin checked' });
    if (docsScoped.length) stuck.push({ lane: 'p-orphan', tone: 'warn', text: plural(docsScoped.length, 'file') + ' with no contract' });
    if (orphanK.length) stuck.push({ lane: 'v-orphan', tone: 'warn', text: plural(orphanK.length, 'clause') + ' with no contract' });
    if (noticePast.length) stuck.push({ lane: 'n-notice', tone: 'warn', text: plural(noticePast.length, 'contract') + ' past the notice date with renewal not started' });

    return { now: now, scope: scope, reviewLimit: limit, lanes: L, stages: stages, stuck: stuck, byId: byId,
      totals: { contracts: all.length, live: list.length, ended: endedCount, customers: cust.length, vendors: list.length - cust.length, files: (data.docs || []).length, clauses: (data.clauses || []).length, lines: (data.lines || []).length } };
  }

  /* The path for one contract: packet -> read -> review -> margin -> renewal -> account. */
  function trace(model, item) {
    var c = item.contractId ? model.byId[item.contractId] || null : null;
    return { contract: c, account: c && (c.accountId || c.accountName) ? { id: c.accountId, name: c.accountName } : null };
  }

  return { SCOPES: SCOPES, REVIEW_LIMIT_DAYS: REVIEW_LIMIT_DAYS, SETTLED: SETTLED, lineStatus: lineStatus, bandOf: bandOf, build: build, trace: trace };
});
