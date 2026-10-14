/* Billing flow: pure logic (no DOM, no Zoho). Copy of the billing-flow model. Browser: window.BillingFlowModel; node: require.
   Follows each billing month: upload -> findings -> decisions -> money -> close-out. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BillingFlowModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var DEFAULTS = { lateDays: 15 };
  var SCOPES = [{ id: 'all', label: 'All months' }, { id: 'open', label: 'Months not reconciled' }];
  var CLOSED_PERIOD = { 'Reconciled': 1, 'Frozen': 1 };
  var REVIEW_PERIOD = { 'In Review': 1, 'Needs Attention': 1 };
  var RESOLVED = { 'Resolved - credited': 1, 'Resolved - explained': 1, 'Not an issue': 1 };
  var SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  function pickVal(v) { return v && v !== '-None-' ? String(v) : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function num(v) { return v == null || (typeof v === 'string' && v.trim() === '') || isNaN(+v) ? null : +v; }
  function n0(v) { var x = num(v); return x == null ? 0 : x; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function toMs(v) { if (v == null || v === '') return null; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function centralDay(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY;
  }
  function money(v) { if (v == null) return ''; var r = Math.round(Math.round(v * 100) / 100); return (r < 0 ? '-' : '') + '$' + Math.abs(r).toLocaleString('en-US'); }
  var isTrue = function (v) { return v === true || v === 'true'; };
  function monthStartDay(p) { var m = /^(\d{4})-(\d{2})$/.exec(String(p || '')); return m ? Date.UTC(+m[1], +m[2] - 1, 1) / DAY : null; }
  function monthEndDay(p) { var m = /^(\d{4})-(\d{2})$/.exec(String(p || '')); return m ? Date.UTC(+m[1], +m[2], 1) / DAY - 1 : null; }
  function monthLabel(p) { var d = monthStartDay(p); return d == null ? String(p || '') : new Date(d * DAY).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
  function normPeriod(r) {
    return { id: r.id, name: r.Name || '', period: String(r.Period || '').trim(), status: pickVal(r.Period_Status), vendor: pickVal(r.Upload_Vendor),
      invoiced: num(r.Invoiced), verified: num(r.Verified), onHold: num(r.On_Hold), pay: num(r.Recommended_Pay), credits: num(r.Credits_To_Confirm),
      latent: num(r.Latent_Exposure), overbilled: num(r.Overbilled), unverified: num(r.Unverified),
      total: num(r.Findings_Total), open: num(r.Findings_Open), needs: num(r.Needs_Decision),
      runStatus: String(r.Last_Run_Status || ''), runMs: toMs(r.Last_Run_At), reconciledMs: toMs(r.Reconciled_On), reportMs: toMs(r.Accounting_Report_At) };
  }
  function normFinding(r) {
    var bp = lk(r.Billing_Period), status = pickVal(r.Status) || 'Open';
    var open = typeof r.Is_Open === 'boolean' ? r.Is_Open : (status === 'Open' || status === 'Disputed with vendor');
    return { id: r.id, period: String(r.Period || '').trim(), periodId: bp.id, vendor: String(r.Vendor || '').trim(), checkId: String(r.Check_ID || ''), category: String(r.Category || ''),
      subject: String(r.Subject || ''), severity: (pickVal(r.Severity) || 'INFO').toUpperCase(), dollars: n0(r.Dollars), moneyType: pickVal(r.Money_Type) || 'None', status: status,
      open: open, inLatest: r.In_Latest_Run == null ? true : isTrue(r.In_Latest_Run), notes: String(r.Decision_Notes || '').trim() };
  }
  var hasMoney = function (f) { return f.dollars > 0 || f.moneyType === 'Overbilled' || f.moneyType === 'Unverified'; };
  var sevRank = function (s) { var i = SEV.indexOf(s); return i < 0 ? SEV.length : i; };

  function build(data, now, opts) {
    data = data || {}; opts = opts || {};
    var scope = opts.scope || 'all', lateLimit = opts.lateDays != null ? opts.lateDays : DEFAULTS.lateDays;
    var today = centralDay(now);
    var fl = { runAt: true, report: true, notes: true, inLatest: true, findings: true };
    Object.keys(data.fields || {}).forEach(function (k) { fl[k] = data.fields[k] !== false; });
    var allP = (data.periods || []).map(normPeriod), allF = (data.findings || []).map(normFinding);
    allP.sort(function (a, b) { return a.period < b.period ? 1 : a.period > b.period ? -1 : 0; });
    var byId = {}, byKey = {};
    allP.forEach(function (p) { byId[p.id] = p; if (p.period) (byKey[p.period] = byKey[p.period] || []).push(p); });
    var periodOf = function (f) { return (f.periodId && byId[f.periodId]) || (byKey[f.period] && byKey[f.period][0]) || null; };
    allP.forEach(function (p) { p.findings = []; });
    var orphans = [];
    allF.forEach(function (f) { var p = periodOf(f); if (p) p.findings.push(f); else orphans.push(f); });
    allP.forEach(function (p) {
      var fs = p.findings;
      p.loaded = { total: fs.length, open: fs.filter(function (f) { return f.open; }).length,
        needs: fs.filter(function (f) { return f.open && f.status === 'Open' && hasMoney(f); }).length,
        disputed: fs.filter(function (f) { return f.open && f.status === 'Disputed with vendor'; }).length,
        high: fs.filter(function (f) { return f.open && (f.severity === 'CRITICAL' || f.severity === 'HIGH'); }).length,
        openMoney: fs.filter(function (f) { return f.open && hasMoney(f); }).length,
        atStake: Math.round(fs.filter(function (f) { return f.open; }).reduce(function (s, f) { return s + f.dollars; }, 0) * 100) / 100 };
      p.closed = !!CLOSED_PERIOD[p.status];
      var end = monthEndDay(p.period);
      p.lateBy = end == null || p.closed ? null : today - (end + lateLimit);
    });
    var periods = allP.filter(function (p) { return scope === 'all' || !p.closed; });
    var pset = {}; periods.forEach(function (p) { pset[p.id] = true; });
    var findings = allF.filter(function (f) { var p = periodOf(f); return scope === 'all' || (p ? pset[p.id] : true); });

    var L = {};
    function lane(id, stage, label, items, tone, hint, kind) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind || 'period', items: items }; }
    var none = function (a) { return a.length ? '' : 'None found'; };
    var f = function (a, fn) { return a.filter(fn); };
    function item(kind, o) { return { kind: kind, id: o.id, periodId: o.periodId || null, title: o.title, sub: o.sub || '', accountName: o.vendor || '', ms: o.ms == null ? null : o.ms, amount: o.amount == null ? null : o.amount,
      ageText: o.ageText || '', state: o.state || '', tone: o.tone || 'neutral', note: o.note || '', sev: o.sev || '' }; }
    var pItem = function (p, state, tone, note, amount, ageText) {
      return item('period', { id: p.id, periodId: p.id, title: p.name || monthLabel(p.period), sub: [p.status || 'No status', p.total != null ? plural(p.total, 'finding') : 'no findings written'].join(' / '), vendor: p.vendor,
        ms: p.runMs != null ? p.runMs : (monthStartDay(p.period) != null ? monthStartDay(p.period) * DAY + 17 * 3600000 : null), amount: amount, ageText: ageText || '', state: state, tone: tone, note: note });
    };
    var fItem = function (x, state, tone, note) {
      var p = periodOf(x), md = monthStartDay(x.period);
      return item('finding', { id: x.id, periodId: p ? p.id : null, title: x.subject || x.checkId || 'Finding', sub: [x.category, x.checkId, x.severity, x.moneyType !== 'None' ? x.moneyType : ''].filter(Boolean).join(' / '), vendor: x.vendor,
        ms: md != null ? md * DAY + 17 * 3600000 : null, amount: x.dollars || null, state: state, tone: tone, note: note, sev: x.severity });
    };
    var P = function (arr, st, tn, nt, amt, age) { return arr.map(function (p) { return pItem(p, typeof st === 'function' ? st(p) : st, typeof tn === 'function' ? tn(p) : tn, typeof nt === 'function' ? nt(p) : nt, amt ? amt(p) : null, age ? age(p) : ''); }); };
    var F = function (arr, st, tn, nt) { return arr.map(function (x) { return fItem(x, typeof st === 'function' ? st(x) : st, typeof tn === 'function' ? tn(x) : tn, typeof nt === 'function' ? nt(x) : nt); }); };
    var bySevMoney = function (a, b) { return sevRank(a.sev) - sevRank(b.sev) || (b.amount || 0) - (a.amount || 0); };

    var mOpen = f(periods, function (p) { return p.status === 'Open' || p.status === 'Reconciling' || !p.status; });
    var mReview = f(periods, function (p) { return !!REVIEW_PERIOD[p.status]; });
    var mDone = f(periods, function (p) { return p.closed; });
    var mNoRun = !fl.runAt ? [] : f(periods, function (p) { return p.runMs == null && !p.closed; });
    var mNoVendor = f(periods, function (p) { return !p.vendor && (p.total != null || (fl.runAt && p.runMs != null)); });
    var dText = function (p) { return p.lateBy == null ? '' : p.lateBy > 0 ? plural(p.lateBy, 'day') + ' late' : p.lateBy === 0 ? 'due today' : 'due in ' + plural(-p.lateBy, 'day'); };
    lane('m-open', 1, 'Open or reconciling', P(mOpen, function (p) { return p.status || 'No status'; }, 'info', null, function (p) { return p.invoiced; }, dText), 'neutral', '', 'period');
    lane('m-review', 1, 'In review or needs attention', P(mReview, function (p) { return p.status; }, 'warn', null, function (p) { return p.invoiced; }, dText), 'warn', '', 'period');
    lane('m-done', 1, 'Reconciled or frozen', P(mDone, function (p) { return p.status; }, 'good', null, function (p) { return p.invoiced; }), 'good', '', 'period');
    lane('m-norun', 1, 'No billing check run yet', P(mNoRun, function (p) { return p.status || 'No status'; }, 'bad', 'The vendor billing check has not run for this month, so there is nothing to review. Upload the vendor zip for ingest.', null, dText), 'bad', none(mNoRun), 'period');
    lane('m-novendor', 1, 'Month with no upload vendor', P(mNoVendor, 'No vendor', 'warn', 'Upload vendor is blank although the month has findings or a run.'), 'warn', none(mNoVendor), 'period');

    var open = f(findings, function (x) { return x.open; });
    var high = f(open, function (x) { return x.severity === 'CRITICAL' || x.severity === 'HIGH'; });
    var stale = !fl.inLatest ? [] : f(open, function (x) { return !x.inLatest; });
    var closedF = f(findings, function (x) { return !x.open; });
    var sevState = function (x) { return x.severity; };
    lane('f-open', 2, 'Open findings', F(open, sevState, 'info').sort(bySevMoney), 'neutral', '', 'finding');
    lane('f-high', 2, 'Open, critical or high', F(high, sevState, 'bad', function (x) { return x.dollars ? 'At stake: ' + money(x.dollars) + '.' : ''; }).sort(bySevMoney), 'bad', none(high), 'finding');
    lane('f-stale', 2, 'Open but not in the latest run', F(stale, 'Not in latest run', 'warn', 'The latest billing check did not raise this finding again. It may be out of date; resolve it or confirm it still applies.').sort(bySevMoney), 'warn', none(stale), 'finding');
    lane('f-closed', 2, 'Resolved', F(closedF, function (x) { return x.status; }, 'good').sort(bySevMoney), 'good', '', 'finding');

    var needs = f(open, function (x) { return x.status === 'Open' && hasMoney(x); });
    var disputed = f(findings, function (x) { return x.open && x.status === 'Disputed with vendor'; });
    var noNotes = !fl.notes ? [] : f(findings, function (x) { return !!RESOLVED[x.status] && !x.notes; });
    lane('d-needs', 3, 'Money findings awaiting a decision', F(needs, function (x) { return x.moneyType !== 'None' ? x.moneyType : 'Money'; }, 'bad', function (x) { return 'Open with ' + (x.dollars ? money(x.dollars) : 'a money type') + ' and no decision yet.'; }).sort(bySevMoney), 'bad', none(needs), 'finding');
    lane('d-disputed', 3, 'Disputed with the vendor', F(disputed, 'Disputed', 'warn', 'Waiting on the vendor. Follow up or record the outcome.').sort(bySevMoney), 'warn', none(disputed), 'finding');
    lane('d-nonotes', 3, 'Resolved with no decision note', F(noNotes, function (x) { return x.status; }, 'warn', 'Resolved but Decision notes is blank, so the reason is not recorded.').sort(bySevMoney), 'warn', none(noNotes), 'finding');
    lane('d-resolved', 3, 'Decided', F(f(findings, function (x) { return !!RESOLVED[x.status]; }), function (x) { return x.status; }, 'good').sort(bySevMoney), 'good', '', 'finding');

    var withMoney = f(periods, function (p) { return p.invoiced != null; });
    var pHold = f(withMoney, function (p) { return (p.onHold || 0) > 0; });
    var pCredit = f(withMoney, function (p) { return (p.credits || 0) > 0; });
    var pOver = f(withMoney, function (p) { return (p.overbilled || 0) > 0; });
    var pUnver = f(withMoney, function (p) { return (p.unverified || 0) > 0; });
    var pLess = f(withMoney, function (p) { return p.pay != null && p.pay < p.invoiced - 0.5; });
    var pFull = f(withMoney, function (p) { return p.invoiced > 0 && p.verified != null && p.verified >= p.invoiced - 0.5; });
    lane('p-hold', 4, 'Money on hold', P(pHold, 'On hold', 'bad', function (p) { return money(p.onHold) + ' held back from the ' + money(p.invoiced) + ' invoiced.'; }, function (p) { return p.onHold; }), 'bad', none(pHold), 'period');
    lane('p-over', 4, 'Overbilled', P(pOver, 'Overbilled', 'bad', function (p) { return money(p.overbilled) + ' billed above what the check can support.'; }, function (p) { return p.overbilled; }), 'bad', none(pOver), 'period');
    lane('p-credit', 4, 'Credits to confirm', P(pCredit, 'Credit to confirm', 'warn', function (p) { return money(p.credits) + ' of credits expected from the vendor.'; }, function (p) { return p.credits; }), 'warn', none(pCredit), 'period');
    lane('p-unver', 4, 'Unverified amount', P(pUnver, 'Unverified', 'warn', function (p) { return money(p.unverified) + ' could not be checked against a rate or device file.'; }, function (p) { return p.unverified; }), 'warn', none(pUnver), 'period');
    lane('p-less', 4, 'Recommended pay below invoice', P(pLess, 'Pay less', 'info', function (p) { return 'Invoiced ' + money(p.invoiced) + ', recommended pay ' + money(p.pay) + ' (' + money(p.invoiced - p.pay) + ' less).'; }, function (p) { return p.pay; }), 'neutral', '', 'period');
    lane('p-full', 4, 'Verified in full', P(pFull, 'Verified', 'good', null, function (p) { return p.verified; }), 'good', '', 'period');

    var late = f(periods, function (p) { return p.lateBy != null && p.lateBy > 0; });
    var mismatch = f(periods, function (p) { return p.total != null && p.findings.length > 0 && (p.total !== p.loaded.total || (p.open != null && p.open !== p.loaded.open)); });
    var noReport = !fl.report ? [] : f(periods, function (p) { return p.closed && p.reportMs == null; });
    var reopenMoney = f(periods, function (p) { return p.closed && p.loaded.openMoney > 0; });
    lane('c-late', 5, 'Past due, not reconciled', P(late, function (p) { return p.status || 'No status'; }, 'bad', function (p) { return 'Month ended ' + plural(p.lateBy + lateLimit, 'day') + ' ago and is still ' + (p.status || 'unset') + '.'; }, function (p) { return p.invoiced; }, dText), 'bad', none(late) || 'over ' + plural(lateLimit, 'day') + ' after month end', 'period');
    lane('c-mismatch', 5, 'Counts do not match the findings', P(mismatch, 'Counts differ', 'bad', function (p) { return 'Month says ' + p.total + ' findings' + (p.open != null ? ' and ' + p.open + ' open' : '') + '; ' + p.loaded.total + ' and ' + p.loaded.open + ' open were loaded.'; }), 'bad', none(mismatch), 'period');
    lane('c-orphan', 5, 'Findings with no month', F(orphans, 'No month', 'bad', 'This finding\'s Period matches no Billing Period record.').sort(bySevMoney), 'bad', none(orphans), 'finding');
    lane('c-noreport', 5, 'Reconciled, no accounting report', P(noReport, 'No report', 'warn', 'The month is reconciled but no accounting report has been produced.'), 'warn', none(noReport), 'period');
    lane('c-reopen', 5, 'Reconciled with open money findings', P(reopenMoney, function (p) { return p.status; }, 'info', function (p) { return plural(p.loaded.openMoney, 'open finding') + ' still carry money. Fine if accounting cleared them; check if not.'; }), 'neutral', 'information, not a fault', 'period');
    lane('c-done', 5, 'Closed', P(mDone, function (p) { return p.status; }, 'good', null, function (p) { return p.pay; }), 'good', '', 'period');

    var fixSet = {}; late.concat(mismatch).forEach(function (p) { fixSet[p.id] = true; });
    var fixMonths = Object.keys(fixSet).length;
    var stages = [
      { n: 1, title: 'Months', big: periods.length, bigLabel: 'billing months', lanes: ['m-open', 'm-review', 'm-done', 'm-norun', 'm-novendor'] },
      { n: 2, title: 'Findings', big: open.length, bigLabel: 'open findings', lanes: ['f-open', 'f-high', 'f-stale', 'f-closed'] },
      { n: 3, title: 'Decisions', big: needs.length + disputed.length, bigLabel: 'need a decision or follow-up', lanes: ['d-needs', 'd-disputed', 'd-nonotes', 'd-resolved'] },
      { n: 4, title: 'Money', big: money(withMoney.reduce(function (s, p) { return s + (p.onHold || 0); }, 0)), bigLabel: 'on hold', lanes: ['p-hold', 'p-over', 'p-credit', 'p-unver', 'p-less', 'p-full'] },
      { n: 5, title: 'Close-out', big: fixMonths, bigLabel: 'months to fix' + (orphans.length ? ', ' + plural(orphans.length, 'stray finding') : ''), lanes: ['c-late', 'c-mismatch', 'c-orphan', 'c-noreport', 'c-reopen', 'c-done'] }
    ];
    var unread = function (id, why) { L[id].hint = why; };
    if (!fl.runAt) unread('m-norun', 'Last run date was not read');
    if (!fl.inLatest) unread('f-stale', 'In latest run was not read');
    if (!fl.notes) unread('d-nonotes', 'Decision notes were not read');
    if (!fl.report) unread('c-noreport', 'Accounting report date was not read');
    if (!fl.findings) ['f-open', 'f-high', 'f-stale', 'f-closed', 'd-needs', 'd-disputed', 'd-nonotes', 'd-resolved', 'c-orphan', 'c-mismatch'].forEach(function (id) { unread(id, 'Billing Findings could not be read'); });
    var stuck = [];
    if (late.length) stuck.push({ lane: 'c-late', tone: 'bad', text: plural(late.length, 'billing month') + ' past due and not reconciled' });
    if (mNoRun.length) stuck.push({ lane: 'm-norun', tone: 'bad', text: plural(mNoRun.length, 'billing month') + ' with no billing check run' });
    if (mismatch.length) stuck.push({ lane: 'c-mismatch', tone: 'bad', text: plural(mismatch.length, 'billing month') + ' whose finding counts do not match' });
    if (orphans.length) stuck.push({ lane: 'c-orphan', tone: 'bad', text: plural(orphans.length, 'finding') + ' with no billing month' });
    if (needs.length) stuck.push({ lane: 'd-needs', tone: 'bad', text: plural(needs.length, 'money finding') + ' awaiting a decision' });
    if (disputed.length) stuck.push({ lane: 'd-disputed', tone: 'warn', text: plural(disputed.length, 'finding') + ' disputed with the vendor' });
    if (pHold.length) stuck.push({ lane: 'p-hold', tone: 'warn', text: money(pHold.reduce(function (s, p) { return s + p.onHold; }, 0)) + ' on hold across ' + plural(pHold.length, 'month') });
    if (stale.length) stuck.push({ lane: 'f-stale', tone: 'warn', text: plural(stale.length, 'open finding') + ' not in the latest run' });
    if (noNotes.length) stuck.push({ lane: 'd-nonotes', tone: 'warn', text: plural(noNotes.length, 'resolved finding') + ' with no decision note' });
    return { now: now, scope: scope, lateDays: lateLimit, lanes: L, stages: stages, stuck: stuck, byId: byId,
      totals: { months: periods.length, allMonths: allP.length, findings: findings.length, open: open.length, needs: needs.length, onHold: Math.round(withMoney.reduce(function (s, p) { return s + (p.onHold || 0); }, 0) * 100) / 100,
        invoiced: Math.round(withMoney.reduce(function (s, p) { return s + (p.invoiced || 0); }, 0) * 100) / 100 } };
  }
  return { DEFAULTS: DEFAULTS, SCOPES: SCOPES, build: build, money: money, monthLabel: monthLabel };
});
