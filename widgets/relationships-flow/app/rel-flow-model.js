/* Relationships flow: pure logic (no DOM, no Zoho). Works in browser (window.RelFlowModel) and node (require).
   Follows each account from who it is, through its contacts, the last touch, its opportunities, to renewal.
   Field names read live 13 Oct 2026: Accounts (Account_Type Customer / Prospect / blank, Touch_Status Cold / No Logged Touch / Fresh, Last_Touch, Days_Since_Touch,
   Health_Tier Red / Yellow, Customer_Health, Renewal_Date, Renewal_Amount, Former_Customer), Contacts (Account_Name, Email, Stock_Alert_Recipient, Last_Activity_Time),
   Deals = Opportunities (Account_Name, Contact_Name, Stage, Closing_Date, Next_Step, Last_Activity_Time, Amount). Owner names can come back blank, so the id is kept. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RelFlowModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var DEFAULTS = { touchDays: 60, dealIdleDays: 30 };   /* both are guesses; adjustable on the page */
  var SCOPES = [{ id: 'all', label: 'All accounts' }, { id: 'Customer', label: 'Customers' }, { id: 'Prospect', label: 'Prospects' }];

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
  function money(v) { return v == null ? '' : '$' + Math.round(v).toLocaleString('en-US'); }
  var isTrue = function (v) { return v === true || v === 'true'; };

  function normAccount(r, today) {
    var o = lk(r.Owner), lt = dateDay(r.Last_Touch), ren = dateDay(r.Renewal_Date), ds = num(r.Days_Since_Touch);
    return { id: r.id, name: r.Account_Name || '', type: pickVal(r.Account_Type), former: isTrue(r.Former_Customer), ownerId: o.id, ownerName: o.name,
      touch: pickVal(r.Touch_Status), touchDays: lt != null ? today - lt : ds, lastTouchDay: lt, tier: pickVal(r.Health_Tier), health: pickVal(r.Customer_Health),
      renewalDay: ren, renewalDays: ren == null ? null : ren - today, renewalAmount: num(r.Renewal_Amount), openCases: num(r.Open_Cases) || 0,
      contacts: [], deals: [], ms: lt != null ? lt * DAY + 17 * 3600000 : null };
  }
  function normContact(r, now) {
    var a = lk(r.Account_Name), o = lk(r.Owner), la = toMs(r.Last_Activity_Time);
    var nm = r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '';
    return { id: r.id, name: nm, title: r.Title || '', email: String(r.Email || '').trim(), accountId: a.id, accountName: a.name, ownerName: o.name,
      alert: isTrue(r.Stock_Alert_Recipient), optOut: isTrue(r.Email_Opt_Out), lastMs: la, ms: la };
  }
  function normDeal(r, today, now) {
    var a = lk(r.Account_Name), c = lk(r.Contact_Name), o = lk(r.Owner), stage = pickVal(r.Stage), cd = dateDay(r.Closing_Date), la = toMs(r.Last_Activity_Time);
    var closed = /^Closed/i.test(stage) || stage === 'Dead Contact';
    return { id: r.id, name: r.Deal_Name || '', accountId: a.id, accountName: a.name, contactId: c.id, contactName: c.name, ownerName: o.name, stage: stage || 'No stage',
      closed: closed, won: stage === 'Closed Won', closingDay: cd, closingDays: cd == null ? null : cd - today, nextStep: String(r.Next_Step || '').trim(),
      lastMs: la, idleDays: la == null ? null : today - centralDay(la), amount: num(r.Amount) != null ? num(r.Amount) : num(r.Total_Opportunity_Revenue),
      pipeline: pickVal(r.Pipeline), ms: cd != null ? cd * DAY + 17 * 3600000 : la };
  }

  function build(data, now, opts) {
    data = data || {}; opts = opts || {};
    var scope = opts.scope || 'all', touchLimit = opts.touchDays != null ? opts.touchDays : DEFAULTS.touchDays, idleLimit = opts.dealIdleDays != null ? opts.dealIdleDays : DEFAULTS.dealIdleDays;
    var today = centralDay(now);
    var allAcc = (data.accounts || []).map(function (r) { return normAccount(r, today); });
    var byAcc = {}; allAcc.forEach(function (a) { byAcc[a.id] = a; });
    var contacts = (data.contacts || []).map(function (r) { return normContact(r, now); });
    var deals = (data.deals || []).map(function (r) { return normDeal(r, today, now); });
    contacts.forEach(function (c) { if (c.accountId && byAcc[c.accountId]) byAcc[c.accountId].contacts.push(c); });
    deals.forEach(function (d) { if (d.accountId && byAcc[d.accountId]) byAcc[d.accountId].deals.push(d); });

    var inScope = function (a) { return scope === 'all' || a.type === scope; };
    var accounts = allAcc.filter(inScope);
    var scopedIds = {}; accounts.forEach(function (a) { scopedIds[a.id] = true; });
    var cont = contacts.filter(function (c) { return !c.accountId || scope === 'all' || scopedIds[c.accountId]; });
    var dl = deals.filter(function (d) { return !d.accountId || scope === 'all' || scopedIds[d.accountId]; });
    var isCust = function (a) { return a.type === 'Customer' && !a.former; };
    var cust = accounts.filter(isCust);
    var worked = accounts.filter(function (a) { return (a.type === 'Customer' || a.type === 'Prospect') && !a.former; });

    var L = {};
    function lane(id, stage, label, items, tone, hint, kind) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind || 'account', items: items }; }
    var none = function (a) { return a.length ? '' : 'None found'; };
    var f = function (a, fn) { return a.filter(fn); };
    var byName = function (a, b) { return String(a.title).localeCompare(String(b.title)); };
    var oldFirst = function (a, b) { return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms); };
    function item(kind, o) { return { kind: kind, id: o.id, title: o.title, sub: o.sub || '', accountId: o.accountId || null, accountName: o.accountName || '', ms: o.ms == null ? null : o.ms, ageText: o.ageText || '', state: o.state || '', tone: o.tone || 'neutral', note: o.note || '' }; }
    var acctSub = function (a) { return [a.type || 'Type not set', a.ownerName, a.openCases ? plural(a.openCases, 'open case') : ''].filter(Boolean).join(' / '); };
    var aItem = function (a, state, tone, note, ageText) { return item('account', { id: a.id, title: a.name, sub: acctSub(a), accountId: a.id, accountName: a.name, ms: a.ms, ageText: ageText || '', state: state, tone: tone, note: note }); };
    var cItem = function (c, state, tone, note) { return item('contact', { id: c.id, title: c.name || 'Unnamed contact', sub: [c.title, c.email || 'no email'].filter(Boolean).join(' / '), accountId: c.accountId, accountName: c.accountName, ms: c.lastMs, state: state, tone: tone, note: note }); };
    var dItem = function (d, state, tone, note) {
      return item('deal', { id: d.id, title: d.name || 'Opportunity', sub: [d.stage, d.amount != null ? money(d.amount) : '', d.pipeline].filter(Boolean).join(' / '), accountId: d.accountId, accountName: d.accountName, ms: d.ms,
        ageText: d.closingDays == null ? '' : (d.closingDays < 0 ? plural(-d.closingDays, 'day') + ' past close date' : 'closes in ' + plural(d.closingDays, 'day')), state: state, tone: tone, note: note });
    };
    var A = function (arr, state, tone, note, ageFn) { return arr.map(function (a) { return aItem(a, typeof state === 'function' ? state(a) : state, typeof tone === 'function' ? tone(a) : tone, typeof note === 'function' ? note(a) : note, ageFn ? ageFn(a) : ''); }); };

    /* 1 who */
    var prosp = f(accounts, function (a) { return a.type === 'Prospect' && !a.former; });
    var noType = f(accounts, function (a) { return !a.type; });
    var other = f(accounts, function (a) { return a.type && a.type !== 'Customer' && a.type !== 'Prospect'; });
    var former = f(accounts, function (a) { return a.former; });
    lane('a-cust', 1, 'Customers', A(cust, 'Customer', 'good').sort(byName), 'good', '', 'account');
    lane('a-prosp', 1, 'Prospects', A(prosp, 'Prospect', 'info').sort(byName), 'neutral', '', 'account');
    lane('a-notype', 1, 'Account type not set', A(noType, 'No type', 'warn', 'Account type is blank, so this account is in no customer or prospect list.').sort(byName), 'warn', none(noType), 'account');
    lane('a-other', 1, 'Other account types', A(other, function (a) { return a.type; }, 'neutral').sort(byName), 'neutral', 'association, parent and similar', 'account');
    lane('a-former', 1, 'Former customers', A(former, 'Former', 'neutral').sort(byName), 'neutral', '', 'account');

    /* 2 contacts */
    var custNoContact = f(cust, function (a) { return a.contacts.length === 0; });
    var custNoAlert = f(cust, function (a) { return a.contacts.length > 0 && !a.contacts.some(function (c) { return c.alert; }); });
    var noAcct = f(cont, function (c) { return !c.accountId; });
    var noEmail = f(cont, function (c) { return !c.email; });
    var okAcc = f(worked, function (a) { return a.contacts.some(function (c) { return c.email; }); });
    lane('c-ok', 2, 'Accounts with a contact and an email', A(okAcc, function (a) { return plural(a.contacts.length, 'contact'); }, 'good').sort(byName), 'good', '', 'account');
    lane('c-cust-none', 2, 'Customers with no contact', A(custNoContact, 'No contact', 'bad', 'No contact is linked to this customer, so nobody can be emailed or called from the CRM.').sort(byName), 'bad', none(custNoContact), 'account');
    lane('c-noacct', 2, 'Contacts with no account', cont.filter(function (c) { return !c.accountId; }).map(function (c) { return cItem(c, 'No account', 'warn', 'This contact is not linked to an account, so it shows on no account page or flow.'); }).sort(byName), 'warn', none(noAcct), 'contact');
    lane('c-noemail', 2, 'Contacts with no email', noEmail.map(function (c) { return cItem(c, 'No email', 'warn', 'No email address, so alerts and follow-ups cannot reach this person.'); }).sort(byName), 'warn', none(noEmail), 'contact');
    lane('c-cust-noalert', 2, 'Customers with no stock alert recipient', A(custNoAlert, 'No recipient', 'info', 'None of this customer\'s contacts is marked to receive stock alerts.').sort(byName), 'neutral', 'only matters for device customers', 'account');

    /* 3 touch */
    var cold = f(worked, function (a) { return a.touch === 'Cold' || (a.touchDays != null && a.touchDays > touchLimit); });
    var never = f(worked, function (a) { return a.lastTouchDay == null && a.touchDays == null && cold.indexOf(a) < 0; });
    var fresh = f(worked, function (a) { return cold.indexOf(a) < 0 && never.indexOf(a) < 0; });
    var atRisk = f(cust, function (a) { return a.tier === 'Red' || a.health === 'At Risk' || a.health === 'Critical'; });
    var dText = function (a) { return a.touchDays == null ? '' : plural(a.touchDays, 'day') + ' since touch'; };
    lane('t-fresh', 3, 'Touched recently', A(fresh, function (a) { return a.touch || 'Touched'; }, 'good', null, dText).sort(oldFirst), 'good', 'within ' + plural(touchLimit, 'day'), 'account');
    lane('t-cold', 3, 'Gone cold', A(cold, 'Cold', 'bad', function (a) { return a.touchDays != null ? 'Last touch ' + plural(a.touchDays, 'day') + ' ago.' : 'Marked Cold.'; }, dText).sort(oldFirst), 'bad', none(cold), 'account');
    lane('t-never', 3, 'No touch logged', A(never, 'No touch', 'warn', 'No touch has ever been logged on this account.').sort(byName), 'warn', none(never), 'account');
    lane('t-health', 3, 'Customers at risk', A(atRisk, function (a) { return a.tier || a.health; }, 'bad', function (a) { return 'Health: ' + [a.tier, a.health].filter(Boolean).join(' / ') + '.'; }, dText).sort(byName), 'bad', none(atRisk), 'account');

    /* 4 opportunities */
    var open = f(dl, function (d) { return !d.closed; });
    var overdue = f(open, function (d) { return d.closingDays != null && d.closingDays < 0; });
    var dNoAcct = f(dl, function (d) { return !d.accountId; });
    var noContact = f(open, function (d) { return !d.contactId; });
    var noNext = f(open, function (d) { return !d.nextStep; });
    var idle = f(open, function (d) { return d.idleDays != null && d.idleDays > idleLimit; });
    var won = f(dl, function (d) { return d.won; }), lost = f(dl, function (d) { return d.closed && !d.won; });
    var D = function (arr, st, tn, nt) { return arr.map(function (d) { return dItem(d, typeof st === 'function' ? st(d) : st, tn, typeof nt === 'function' ? nt(d) : nt); }); };
    lane('o-open', 4, 'Open opportunities', D(open, function (d) { return d.stage; }, 'info').sort(oldFirst), 'neutral', '', 'deal');
    lane('o-overdue', 4, 'Close date passed, still open', D(overdue, function (d) { return d.stage; }, 'bad', function (d) { return 'Expected to close ' + plural(-d.closingDays, 'day') + ' ago and is still ' + d.stage + '.'; }).sort(oldFirst), 'bad', none(overdue), 'deal');
    lane('o-idle', 4, 'No activity for too long', D(idle, function (d) { return d.stage; }, 'warn', function (d) { return 'No activity for ' + plural(d.idleDays, 'day') + '.'; }).sort(oldFirst), 'warn', none(idle) || 'over ' + plural(idleLimit, 'day'), 'deal');
    lane('o-nonext', 4, 'No next step', D(noNext, function (d) { return d.stage; }, 'warn', 'Next step is blank.').sort(oldFirst), 'warn', none(noNext), 'deal');
    lane('o-nocontact', 4, 'No contact on the opportunity', D(noContact, function (d) { return d.stage; }, 'warn', 'No contact is linked, so nobody is named to follow up with.').sort(oldFirst), 'warn', none(noContact), 'deal');
    lane('o-noacct', 4, 'Opportunity with no account', D(dNoAcct, function (d) { return d.stage; }, 'warn', 'No account is linked, so it shows on no account page.').sort(oldFirst), 'warn', none(dNoAcct), 'deal');
    lane('o-won', 4, 'Won', D(won, 'Closed Won', 'good').sort(oldFirst), 'good', '', 'deal');
    lane('o-lost', 4, 'Lost or dead', D(lost, function (d) { return d.stage; }, 'neutral').sort(oldFirst), 'neutral', '', 'deal');

    /* 5 renewal (customers) */
    var hasOpen = function (a) { return a.deals.some(function (d) { return !d.closed; }); };
    var rPast = f(cust, function (a) { return a.renewalDays != null && a.renewalDays < 0; });
    var r30 = f(cust, function (a) { return a.renewalDays != null && a.renewalDays >= 0 && a.renewalDays <= 30; });
    var r90 = f(cust, function (a) { return a.renewalDays != null && a.renewalDays > 30 && a.renewalDays <= 90; });
    var rNone = f(cust, function (a) { return a.renewalDays == null; });
    var rOk = f(cust, function (a) { return a.renewalDays != null && a.renewalDays > 90; });
    var rNoOpp = f(cust, function (a) { return a.renewalDays != null && a.renewalDays >= 0 && a.renewalDays <= 90 && !hasOpen(a); });
    var rText = function (a) { return a.renewalDays == null ? '' : a.renewalDays < 0 ? plural(-a.renewalDays, 'day') + ' ago' : 'in ' + plural(a.renewalDays, 'day'); };
    var rSub = function (a) { return a.renewalAmount != null ? money(a.renewalAmount) : ''; };
    var rs = function (a) { return (a.renewalDay != null ? new Date(a.renewalDay * DAY).toISOString().slice(0, 10) : '') + (rSub(a) ? ' / ' + rSub(a) : ''); };
    lane('r-past', 5, 'Renewal date passed', A(rPast, function (a) { return 'Due ' + rs(a); }, 'bad', 'The renewal date on this account has passed. Check the contract in the Contracts flow.', rText).sort(oldFirst), 'bad', none(rPast), 'account');
    lane('r-30', 5, 'Renews within 30 days', A(r30, function (a) { return rs(a); }, 'warn', function (a) { return hasOpen(a) ? '' : 'No open opportunity for this renewal.'; }, rText).sort(oldFirst), 'warn', none(r30), 'account');
    lane('r-90', 5, 'Renews in 31 to 90 days', A(r90, function (a) { return rs(a); }, 'info', function (a) { return hasOpen(a) ? '' : 'No open opportunity for this renewal.'; }, rText).sort(oldFirst), 'neutral', '', 'account');
    lane('r-noopp', 5, 'Renewing soon, no opportunity', A(rNoOpp, function (a) { return rs(a); }, 'bad', 'Renews within 90 days and has no open opportunity.', rText).sort(oldFirst), 'bad', none(rNoOpp), 'account');
    lane('r-nodate', 5, 'No renewal date', A(rNone, 'No date', 'warn', 'No renewal date on the account, so renewals cannot be tracked here.').sort(byName), 'warn', none(rNone), 'account');
    lane('r-ok', 5, 'On track', A(rOk, function (a) { return rs(a); }, 'good', null, rText).sort(oldFirst), 'good', 'over 90 days away', 'account');

    ['r-past', 'r-30', 'r-90', 'r-noopp', 'r-nodate', 'r-ok'].forEach(function (id) {   /* the date column on renewal lanes is the renewal date, not the touch date */
      L[id].items.forEach(function (i) { var ac = byAcc[i.id]; i.ms = ac && ac.renewalDay != null ? ac.renewalDay * DAY + 17 * 3600000 : null; });
      L[id].items.sort(id === 'r-nodate' ? byName : oldFirst);
    });
    var stages = [
      { n: 1, title: 'Accounts', big: accounts.length, bigLabel: 'accounts', lanes: ['a-cust', 'a-prosp', 'a-notype', 'a-other', 'a-former'] },
      { n: 2, title: 'Contacts', big: custNoContact.length + noAcct.length, bigLabel: 'contact gaps to fix', lanes: ['c-ok', 'c-cust-none', 'c-noacct', 'c-noemail', 'c-cust-noalert'] },
      { n: 3, title: 'Last touch', big: cold.length + never.length, bigLabel: 'need a touch', lanes: ['t-fresh', 't-cold', 't-never', 't-health'] },
      { n: 4, title: 'Opportunities', big: open.length, bigLabel: 'open opportunities', lanes: ['o-open', 'o-overdue', 'o-idle', 'o-nonext', 'o-nocontact', 'o-noacct', 'o-won', 'o-lost'] },
      { n: 5, title: 'Renewal', big: rPast.length + r30.length + r90.length, bigLabel: 'renew within 90 days', lanes: ['r-past', 'r-30', 'r-90', 'r-noopp', 'r-nodate', 'r-ok'] }
    ];
    var stuck = [];
    if (overdue.length) stuck.push({ lane: 'o-overdue', tone: 'bad', text: plural(overdue.length, 'opportunity', 'opportunities') + ' still open past the close date' });
    if (rPast.length) stuck.push({ lane: 'r-past', tone: 'bad', text: plural(rPast.length, 'customer') + ' with a renewal date that has passed' });
    if (rNoOpp.length) stuck.push({ lane: 'r-noopp', tone: 'bad', text: plural(rNoOpp.length, 'customer') + ' renewing within 90 days with no opportunity' });
    if (custNoContact.length) stuck.push({ lane: 'c-cust-none', tone: 'bad', text: plural(custNoContact.length, 'customer') + ' with no contact' });
    if (atRisk.length) stuck.push({ lane: 't-health', tone: 'bad', text: plural(atRisk.length, 'customer') + ' marked at risk' });
    if (cold.length) stuck.push({ lane: 't-cold', tone: 'warn', text: plural(cold.length, 'account') + ' gone cold' });
    if (idle.length) stuck.push({ lane: 'o-idle', tone: 'warn', text: plural(idle.length, 'opportunity', 'opportunities') + ' with no activity for over ' + plural(idleLimit, 'day') });
    if (dNoAcct.length) stuck.push({ lane: 'o-noacct', tone: 'warn', text: plural(dNoAcct.length, 'opportunity', 'opportunities') + ' with no account' });
    if (noAcct.length) stuck.push({ lane: 'c-noacct', tone: 'warn', text: plural(noAcct.length, 'contact') + ' with no account' });

    return { now: now, scope: scope, touchDays: touchLimit, dealIdleDays: idleLimit, lanes: L, stages: stages, stuck: stuck, byId: byAcc,
      totals: { accounts: accounts.length, allAccounts: allAcc.length, customers: cust.length, prospects: prosp.length, contacts: cont.length, deals: dl.length, openDeals: open.length } };
  }

  /* The path for one record: account -> contacts -> touch -> opportunities -> renewal. */
  function trace(model, it) {
    var a = it.accountId ? model.byId[it.accountId] || null : null;
    return { account: a, kind: it.kind, id: it.id, today: centralDay(model.now) };
  }

  return { DEFAULTS: DEFAULTS, SCOPES: SCOPES, build: build, trace: trace, money: money };
});
