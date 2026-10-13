/* Relationships flow: pure logic (no DOM, no Zoho). Works in browser (window.RelFlowModel) and node (require).
   v2 (12 Oct 2026, Beau's decisions): the page opens on "Mine"; last touch is computed from the latest call, meeting or
   customer email (or a logged Last_Touch), not from Touch_Status; renewal comes from the customer's contracts, not the
   account; data clean-up lanes are org-wide, owned by one person (Beau) and kept out of the follow-up steps.
   Field names read live: Accounts (Account_Type, Owner, Last_Touch, Health_Tier, Customer_Health, Former_Customer, Open_Cases),
   Contacts (Account_Name, Email, Stock_Alert_Recipient, Last_Activity_Time), Deals (Account_Name, Contact_Name, Stage,
   Closing_Date, Next_Step, Last_Activity_Time, Amount), Calls (What_Id, Who_Id, Call_Start_Time), Events (What_Id, Who_Id,
   Start_DateTime), Support_Emails (Account, Contact, Received_At, Direction, Topic, Intake_Result), Contracts (Account, Name, Counterparty_Type, Contract_Status,
   Final_End_Date, Renewal_Status). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RelFlowModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var DEFAULTS = { touchDays: 60, dealIdleDays: 30, cleanupOwner: 'Beau' };   /* team defaults, set 12 Oct; not adjustable on the page */
  var SCOPES = [{ id: 'mine', label: 'Mine' }, { id: 'all', label: 'Everyone' }, { id: 'Customer', label: 'Customers' }, { id: 'Prospect', label: 'Prospects' }];
  var ENDED = ['Ended'];
  var NOT_RENEWING = ['Not renewing'];
  var SKIP_MAIL = ['Automated report', 'Vendor notice', 'Internal', 'Ignored'];   /* same list as last_touch_email_sync.dg */

  function pickVal(v) { return v && v !== '-None-' ? String(v) : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function num(v) { return v == null || (typeof v === 'string' && v.trim() === '') || isNaN(+v) ? null : +v; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function centralDay(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY;
  }
  function dateDay(v) { if (!v) return null; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null; }
  function dayIso(d) { return d == null ? '' : new Date(d * DAY).toISOString().slice(0, 10); }
  function money(v) { return v == null ? '' : '$' + Math.round(v).toLocaleString('en-US'); }
  var isTrue = function (v) { return v === true || v === 'true'; };

  function normAccount(r) {
    var o = lk(r.Owner), lt = dateDay(r.Last_Touch);
    return { id: r.id, name: r.Account_Name || '', type: pickVal(r.Account_Type), former: isTrue(r.Former_Customer), ownerId: o.id, ownerName: o.name,
      tier: pickVal(r.Health_Tier), health: pickVal(r.Customer_Health), openCases: num(r.Open_Cases) || 0,
      touchMs: lt != null ? lt * DAY + 17 * 3600000 : null, touchKind: lt != null ? 'Logged touch' : '', touchWith: '', touchDays: null,
      contacts: [], deals: [], contracts: [], renewal: null, renewalDays: null, ms: null };
  }
  function normContact(r) {
    var a = lk(r.Account_Name), o = lk(r.Owner), la = toMs(r.Last_Activity_Time);
    var nm = r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '';
    return { id: r.id, name: nm, title: r.Title || '', email: String(r.Email || '').trim(), accountId: a.id, accountName: a.name, ownerId: o.id, ownerName: o.name,
      alert: isTrue(r.Stock_Alert_Recipient), optOut: isTrue(r.Email_Opt_Out), lastMs: la, ms: la };
  }
  function normDeal(r, today) {
    var a = lk(r.Account_Name), c = lk(r.Contact_Name), o = lk(r.Owner), stage = pickVal(r.Stage), cd = dateDay(r.Closing_Date), la = toMs(r.Last_Activity_Time);
    var closed = /^Closed/i.test(stage) || stage === 'Dead Contact';
    return { id: r.id, name: r.Deal_Name || '', accountId: a.id, accountName: a.name, contactId: c.id, contactName: c.name, ownerId: o.id, ownerName: o.name, stage: stage || 'No stage',
      closed: closed, won: stage === 'Closed Won', closingDay: cd, closingDays: cd == null ? null : cd - today, nextStep: String(r.Next_Step || '').trim(),
      lastMs: la, idleDays: la == null ? null : today - centralDay(la), amount: num(r.Amount) != null ? num(r.Amount) : num(r.Total_Opportunity_Revenue),
      pipeline: pickVal(r.Pipeline), ms: cd != null ? cd * DAY + 17 * 3600000 : la };
  }
  /* Customer contracts only. Live = not Ended and not marked as not renewing. */
  function normContract(r, today) {
    var a = lk(r.Account), st = pickVal(r.Contract_Status), rs = pickVal(r.Renewal_Status), end = dateDay(r.Final_End_Date);
    var notRenewing = NOT_RENEWING.indexOf(rs) >= 0 || st === 'Ending - No Renewal';
    return { id: r.id, name: r.Name || 'Contract', accountId: a.id, status: st, renewalStatus: rs, endDay: end, days: end == null ? null : end - today,
      ended: ENDED.indexOf(st) >= 0, notRenewing: notRenewing, live: ENDED.indexOf(st) < 0 && !notRenewing };
  }
  /* Calls, meetings and inbound customer emails, as one list of touches. Future meetings do not count. */
  function touchesFrom(data, now) {
    var out = [];
    (data.calls || []).forEach(function (r) { out.push({ kind: 'Call', what: lk(r.What_Id).id, who: lk(r.Who_Id).id, whoName: lk(r.Who_Id).name, ms: toMs(r.Call_Start_Time) }); });
    (data.meetings || []).forEach(function (r) { out.push({ kind: 'Meeting', what: lk(r.What_Id).id, who: lk(r.Who_Id).id, whoName: lk(r.Who_Id).name, ms: toMs(r.Start_DateTime) }); });
    (data.emails || []).forEach(function (r) {
      if (SKIP_MAIL.indexOf(pickVal(r.Topic)) >= 0 || SKIP_MAIL.indexOf(pickVal(r.Intake_Result)) >= 0) return;   /* not a customer conversation */
      out.push({ kind: r.Direction === 'Out' ? 'Email to customer' : 'Email from customer', what: lk(r.Account).id, who: lk(r.Contact).id, whoName: lk(r.Contact).name, ms: toMs(r.Received_At || r.Created_Time) });
    });
    return out.filter(function (t) { return t.ms != null && t.ms <= now; });
  }

  function build(data, now, opts) {
    data = data || {}; opts = opts || {};
    var scope = opts.scope || 'all', userId = opts.userId || null, touchLimit = DEFAULTS.touchDays, idleLimit = DEFAULTS.dealIdleDays;
    var today = centralDay(now);
    var allAcc = (data.accounts || []).map(normAccount);
    var byAcc = {}; allAcc.forEach(function (a) { byAcc[a.id] = a; });
    var contacts = (data.contacts || []).map(normContact);
    var byCon = {}; contacts.forEach(function (c) { byCon[c.id] = c; });
    var deals = (data.deals || []).map(function (r) { return normDeal(r, today); });
    var byDeal = {}; deals.forEach(function (d) { byDeal[d.id] = d; });
    contacts.forEach(function (c) { if (c.accountId && byAcc[c.accountId]) byAcc[c.accountId].contacts.push(c); });
    deals.forEach(function (d) { if (d.accountId && byAcc[d.accountId]) byAcc[d.accountId].deals.push(d); });
    (data.contracts || []).filter(function (r) { return pickVal(r.Counterparty_Type) !== 'Vendor'; }).map(function (r) { return normContract(r, today); })
      .forEach(function (k) { if (k.accountId && byAcc[k.accountId]) byAcc[k.accountId].contracts.push(k); });

    /* last touch: latest of logged Last_Touch, calls, meetings and customer emails */
    var touches = touchesFrom(data, now);
    touches.forEach(function (t) {
      var aid = t.what && byAcc[t.what] ? t.what : t.what && byDeal[t.what] ? byDeal[t.what].accountId : t.who && byCon[t.who] ? byCon[t.who].accountId : null;
      var a = aid ? byAcc[aid] : null;
      if (a && (a.touchMs == null || t.ms > a.touchMs)) { a.touchMs = t.ms; a.touchKind = t.kind; a.touchWith = t.whoName; }
    });
    /* renewal: soonest end date among live customer contracts */
    allAcc.forEach(function (a) {
      a.touchDays = a.touchMs == null ? null : today - centralDay(a.touchMs);
      a.ms = a.touchMs;
      var best = null;
      a.contracts.forEach(function (k) { if (k.live && k.days != null && (!best || k.days < best.days)) best = k; });
      a.renewal = best; a.renewalDays = best ? best.days : null;
      a.liveContracts = a.contracts.filter(function (k) { return k.live; }).length;
    });

    var mine = function (a) { return !!userId && a.ownerId === userId; };
    var inScope = function (a) { return scope === 'all' ? true : scope === 'mine' ? mine(a) : a.type === scope; };
    var accounts = allAcc.filter(inScope);
    var scopedIds = {}; accounts.forEach(function (a) { scopedIds[a.id] = true; });
    var dl = deals.filter(function (d) {
      if (scope === 'all') return true;
      if (scope === 'mine') return (!!userId && d.ownerId === userId) || !!scopedIds[d.accountId];
      return !!scopedIds[d.accountId];
    });
    var isCust = function (a) { return a.type === 'Customer' && !a.former; };
    var cust = accounts.filter(isCust);
    var worked = accounts.filter(function (a) { return (a.type === 'Customer' || a.type === 'Prospect') && !a.former; });

    var L = {};
    function lane(id, stage, label, items, tone, hint, kind, cleanup) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind || 'account', cleanup: !!cleanup, items: items }; }
    var none = function (a) { return a.length ? '' : 'None found'; };
    var f = function (a, fn) { return a.filter(fn); };
    var byName = function (a, b) { return String(a.title).localeCompare(String(b.title)); };
    var oldFirst = function (a, b) { return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms); };
    function item(kind, o) { return { kind: kind, id: o.id, title: o.title, sub: o.sub || '', accountId: o.accountId || null, accountName: o.accountName || '', ms: o.ms == null ? null : o.ms, ageText: o.ageText || '', state: o.state || '', tone: o.tone || 'neutral', note: o.note || '' }; }
    var acctSub = function (a) { return [a.type || 'Type not set', a.ownerName, a.openCases ? plural(a.openCases, 'open case') : ''].filter(Boolean).join(' / '); };
    var aItem = function (a, state, tone, note, ageText) { return item('account', { id: a.id, title: a.name, sub: acctSub(a), accountId: a.id, accountName: a.name, ms: a.ms, ageText: ageText || '', state: state, tone: tone, note: note }); };
    var cItem = function (c, state, tone, note) { return item('contact', { id: c.id, title: c.name || 'Unnamed contact', sub: [c.title, c.email || 'no email'].filter(Boolean).join(' / '), accountId: c.accountId, accountName: c.accountName, ms: c.lastMs, state: state, tone: tone, note: note }); };
    var dItem = function (d, state, tone, note) {
      return item('deal', { id: d.id, title: d.name || 'Opportunity', sub: [d.stage, d.amount != null ? money(d.amount) : '', d.ownerName].filter(Boolean).join(' / '), accountId: d.accountId, accountName: d.accountName, ms: d.ms,
        ageText: d.closingDays == null ? '' : (d.closingDays < 0 ? plural(-d.closingDays, 'day') + ' past close date' : 'closes in ' + plural(d.closingDays, 'day')), state: state, tone: tone, note: note });
    };
    var A = function (arr, state, tone, note, ageFn) { return arr.map(function (a) { return aItem(a, typeof state === 'function' ? state(a) : state, typeof tone === 'function' ? tone(a) : tone, typeof note === 'function' ? note(a) : note, ageFn ? ageFn(a) : ''); }); };
    var D = function (arr, st, tn, nt) { return arr.map(function (d) { return dItem(d, typeof st === 'function' ? st(d) : st, tn, typeof nt === 'function' ? nt(d) : nt); }); };

    /* 1 accounts */
    var prosp = f(accounts, function (a) { return a.type === 'Prospect' && !a.former; });
    var other = f(accounts, function (a) { return a.type && a.type !== 'Customer' && a.type !== 'Prospect'; });
    var former = f(accounts, function (a) { return a.former; });
    lane('a-cust', 1, 'Customers', A(cust, 'Customer', 'good').sort(byName), 'good', '', 'account');
    lane('a-prosp', 1, 'Prospects', A(prosp, 'Prospect', 'info').sort(byName), 'neutral', '', 'account');
    lane('a-other', 1, 'Other account types', A(other, function (a) { return a.type; }, 'neutral').sort(byName), 'neutral', 'association, parent and similar', 'account');
    lane('a-former', 1, 'Former customers', A(former, 'Former', 'neutral').sort(byName), 'neutral', '', 'account');

    /* 2 last touch */
    var tText = function (a) { return a.touchDays == null ? '' : plural(a.touchDays, 'day') + ' since touch'; };
    var tState = function (a) { return a.touchKind || 'Touched'; };
    var cold = f(worked, function (a) { return a.touchDays != null && a.touchDays > touchLimit; });
    var never = f(worked, function (a) { return a.touchMs == null; });
    var fresh = f(worked, function (a) { return a.touchDays != null && a.touchDays <= touchLimit; });
    var atRisk = f(cust, function (a) { return a.tier === 'Red' || a.health === 'At Risk' || a.health === 'Critical'; });
    lane('t-fresh', 2, 'Touched recently', A(fresh, tState, 'good', null, tText).sort(oldFirst), 'good', 'within ' + plural(touchLimit, 'day'), 'account');
    lane('t-cold', 2, 'Gone cold', A(cold, 'Cold', 'bad', function (a) { return 'Last ' + a.touchKind.toLowerCase() + ' ' + plural(a.touchDays, 'day') + ' ago' + (a.touchWith ? ' (' + a.touchWith + ')' : '') + '.'; }, tText).sort(oldFirst), 'bad', none(cold) || 'no call, meeting or email for over ' + plural(touchLimit, 'day'), 'account');
    lane('t-never', 2, 'No touch on record', A(never, 'No touch', 'warn', 'No call, meeting or customer email linked to this account in the last 12 months, and no logged touch.').sort(byName), 'warn', none(never), 'account');
    lane('t-health', 2, 'Customers at risk', A(atRisk, function (a) { return a.tier || a.health; }, 'bad', function (a) { return 'Health: ' + [a.tier, a.health].filter(Boolean).join(' / ') + '.'; }, tText).sort(byName), 'bad', none(atRisk), 'account');

    /* 3 opportunities */
    var open = f(dl, function (d) { return !d.closed; });
    var overdue = f(open, function (d) { return d.closingDays != null && d.closingDays < 0; });
    var noContact = f(open, function (d) { return !d.contactId; });
    var noNext = f(open, function (d) { return !d.nextStep; });
    var idle = f(open, function (d) { return d.idleDays != null && d.idleDays > idleLimit; });
    var won = f(dl, function (d) { return d.won; }), lost = f(dl, function (d) { return d.closed && !d.won; });
    lane('o-open', 3, 'Open opportunities', D(open, function (d) { return d.stage; }, 'info').sort(oldFirst), 'neutral', '', 'deal');
    lane('o-overdue', 3, 'Close date passed, still open', D(overdue, function (d) { return d.stage; }, 'bad', function (d) { return 'Expected to close ' + plural(-d.closingDays, 'day') + ' ago and is still ' + d.stage + '.'; }).sort(oldFirst), 'bad', none(overdue), 'deal');
    lane('o-idle', 3, 'No activity for too long', D(idle, function (d) { return d.stage; }, 'warn', function (d) { return 'No activity for ' + plural(d.idleDays, 'day') + '.'; }).sort(oldFirst), 'warn', none(idle) || 'over ' + plural(idleLimit, 'day'), 'deal');
    lane('o-nonext', 3, 'No next step', D(noNext, function (d) { return d.stage; }, 'warn', 'Next step is blank.').sort(oldFirst), 'warn', none(noNext), 'deal');
    lane('o-nocontact', 3, 'No contact on the opportunity', D(noContact, function (d) { return d.stage; }, 'warn', 'No contact is linked, so nobody is named to follow up with.').sort(oldFirst), 'warn', none(noContact), 'deal');
    lane('o-won', 3, 'Won', D(won, 'Closed Won', 'good').sort(oldFirst), 'good', '', 'deal');
    lane('o-lost', 3, 'Lost or dead', D(lost, function (d) { return d.stage; }, 'neutral').sort(oldFirst), 'neutral', '', 'deal');

    /* 4 renewal (customers, from contracts) */
    var hasOpen = function (a) { return a.deals.some(function (d) { return !d.closed; }); };
    var withR = f(cust, function (a) { return a.renewal; });
    var rPast = f(withR, function (a) { return a.renewalDays < 0; });
    var r30 = f(withR, function (a) { return a.renewalDays >= 0 && a.renewalDays <= 30; });
    var r90 = f(withR, function (a) { return a.renewalDays > 30 && a.renewalDays <= 90; });
    var rOk = f(withR, function (a) { return a.renewalDays > 90; });
    var soon = f(withR, function (a) { return a.renewalDays >= 0 && a.renewalDays <= 90; });   /* past-end contracts are in r-past */
    var rNotStarted = f(soon, function (a) { return a.renewal.renewalStatus === 'Not started' || !a.renewal.renewalStatus; });
    var rNoOpp = f(withR, function (a) { return a.renewalDays >= 0 && a.renewalDays <= 90 && !hasOpen(a); });
    var rText = function (a) { return a.renewalDays == null ? '' : a.renewalDays < 0 ? 'ended ' + plural(-a.renewalDays, 'day') + ' ago' : 'in ' + plural(a.renewalDays, 'day'); };
    var rs = function (a) { return a.renewal.name + ' / ends ' + dayIso(a.renewal.endDay) + (a.renewal.renewalStatus ? ' / renewal ' + a.renewal.renewalStatus.toLowerCase() : ''); };
    var rItems = function (arr, tone, note) { return A(arr, function (a) { return a.renewal.renewalStatus || 'No renewal status'; }, tone, note, rText).map(function (i) { var a = byAcc[i.id]; i.sub = rs(a); i.ms = a.renewal.endDay * DAY + 17 * 3600000; return i; }).sort(oldFirst); };
    lane('r-past', 4, 'Contract ended, not renewed', rItems(rPast, 'bad', 'This live contract is past its end date. Open it in the Contracts flow.'), 'bad', none(rPast), 'account');
    lane('r-notstarted', 4, 'Renewal not started', rItems(rNotStarted, 'bad', 'Ends within 90 days and the contract\'s renewal status is Not started.'), 'bad', none(rNotStarted), 'account');
    lane('r-30', 4, 'Ends within 30 days', rItems(r30, 'warn', function (a) { return hasOpen(a) ? '' : 'No open opportunity for this renewal.'; }), 'warn', none(r30), 'account');
    lane('r-90', 4, 'Ends in 31 to 90 days', rItems(r90, 'info', function (a) { return hasOpen(a) ? '' : 'No open opportunity for this renewal.'; }), 'neutral', '', 'account');
    lane('r-noopp', 4, 'Renewing soon, no opportunity', rItems(rNoOpp, 'bad', 'Ends within 90 days and has no open opportunity.'), 'bad', none(rNoOpp), 'account');
    lane('r-ok', 4, 'On track', rItems(rOk, 'good'), 'good', 'over 90 days away', 'account');

    /* Clean-up: org-wide data fixes, one owner, never in the follow-up steps or the strip */
    var orgCust = allAcc.filter(isCust);
    var noType = allAcc.filter(function (a) { return !a.type; });
    var custNoContact = orgCust.filter(function (a) { return a.contacts.length === 0; });
    var noAcct = contacts.filter(function (c) { return !c.accountId; });
    var noEmail = contacts.filter(function (c) { return !c.email; });
    var custNoAlert = orgCust.filter(function (a) { return a.contacts.length > 0 && !a.contacts.some(function (c) { return c.alert; }); });
    var dNoAcct = deals.filter(function (d) { return !d.accountId; });
    var noContract = orgCust.filter(function (a) { return !a.renewal; });
    var CL = function (id, label, items, tone, hint, kind) { lane(id, 0, label, items, tone, hint, kind, true); };
    CL('a-notype', 'Account type not set', A(noType, 'No type', 'warn', 'Account type is blank, so this account is in no customer or prospect list.').sort(byName), 'warn', '', 'account');
    CL('c-cust-none', 'Customers with no contact', A(custNoContact, 'No contact', 'bad', 'No contact is linked to this customer.').sort(byName), 'bad', '', 'account');
    CL('c-noacct', 'Contacts with no account', noAcct.map(function (c) { return cItem(c, 'No account', 'warn', 'This contact is not linked to an account, so it shows on no account page or flow.'); }).sort(byName), 'warn', '', 'contact');
    CL('o-noacct', 'Opportunities with no account', D(dNoAcct, function (d) { return d.stage; }, 'warn', 'No account is linked, so it shows on no account page.').sort(oldFirst), 'warn', '', 'deal');
    CL('r-nocontract', 'Customers with no live contract', A(noContract, 'No contract', 'warn', 'No live customer contract with an end date, so the renewal cannot be tracked.').sort(byName), 'warn', 'renewals come from contracts', 'account');
    CL('c-noemail', 'Contacts with no email', noEmail.map(function (c) { return cItem(c, 'No email', 'warn', 'No email address, so alerts and follow-ups cannot reach this person.'); }).sort(byName), 'warn', '', 'contact');
    CL('c-cust-noalert', 'Customers with no stock alert recipient', A(custNoAlert, 'No recipient', 'info', 'None of this customer\'s contacts is marked to receive stock alerts.').sort(byName), 'neutral', 'device customers only', 'account');
    var cleanupIds = ['a-notype', 'c-cust-none', 'c-noacct', 'o-noacct', 'r-nocontract', 'c-noemail', 'c-cust-noalert'];

    var stages = [
      { n: 1, title: 'Accounts', big: accounts.length, bigLabel: 'accounts', lanes: ['a-cust', 'a-prosp', 'a-other', 'a-former'] },
      { n: 2, title: 'Last touch', big: cold.length + never.length, bigLabel: 'need a touch', lanes: ['t-fresh', 't-cold', 't-never', 't-health'] },
      { n: 3, title: 'Opportunities', big: open.length, bigLabel: 'open opportunities', lanes: ['o-open', 'o-overdue', 'o-idle', 'o-nonext', 'o-nocontact', 'o-won', 'o-lost'] },
      { n: 4, title: 'Renewal', big: rPast.length + r30.length + r90.length, bigLabel: 'contracts ending within 90 days', lanes: ['r-past', 'r-notstarted', 'r-30', 'r-90', 'r-noopp', 'r-ok'] }
    ];
    var stuck = [];
    if (overdue.length) stuck.push({ lane: 'o-overdue', tone: 'bad', text: plural(overdue.length, 'opportunity', 'opportunities') + ' still open past the close date' });
    if (rPast.length) stuck.push({ lane: 'r-past', tone: 'bad', text: plural(rPast.length, 'customer contract') + ' past the end date and not renewed' });
    if (rNotStarted.length) stuck.push({ lane: 'r-notstarted', tone: 'bad', text: plural(rNotStarted.length, 'customer') + ' ending within 90 days with renewal not started' });
    if (rNoOpp.length) stuck.push({ lane: 'r-noopp', tone: 'bad', text: plural(rNoOpp.length, 'customer') + ' renewing within 90 days with no opportunity' });
    if (atRisk.length) stuck.push({ lane: 't-health', tone: 'bad', text: plural(atRisk.length, 'customer') + ' marked at risk' });
    if (cold.length) stuck.push({ lane: 't-cold', tone: 'warn', text: plural(cold.length, 'account') + ' with no call, meeting or email in ' + plural(touchLimit, 'day') });
    if (idle.length) stuck.push({ lane: 'o-idle', tone: 'warn', text: plural(idle.length, 'opportunity', 'opportunities') + ' with no activity for over ' + plural(idleLimit, 'day') });
    if (noNext.length) stuck.push({ lane: 'o-nonext', tone: 'warn', text: plural(noNext.length, 'open opportunity', 'open opportunities') + ' with no next step' });

    var cleanupTotal = cleanupIds.reduce(function (s, id) { return s + L[id].count; }, 0);
    return { now: now, scope: scope, touchDays: touchLimit, dealIdleDays: idleLimit, lanes: L, stages: stages, stuck: stuck, byId: byAcc,
      cleanup: { owner: opts.cleanupOwner || DEFAULTS.cleanupOwner, lanes: cleanupIds, total: cleanupTotal },
      totals: { accounts: accounts.length, allAccounts: allAcc.length, mine: userId ? allAcc.filter(mine).length : 0, customers: cust.length, prospects: prosp.length, deals: dl.length, openDeals: open.length, touches: touches.length } };
  }

  /* The path for one record: account -> contacts -> touch -> opportunities -> renewal. */
  function trace(model, it) {
    var a = it.accountId ? model.byId[it.accountId] || null : null;
    return { account: a, kind: it.kind, id: it.id, today: centralDay(model.now) };
  }

  return { DEFAULTS: DEFAULTS, SCOPES: SCOPES, build: build, trace: trace, money: money, dayIso: dayIso };
});
