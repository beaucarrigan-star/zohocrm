/* Stock and accessories flow: pure logic (no DOM, no Zoho). Works in browser (window.StockFlowModel) and node (require).
   Proactive side: the system raises a signal (stock alert, accessory recommendation), a person decides, and the result should be
   an order, a return request, or a follow-up. This follows each signal to what happened, and lists the ones where nothing did.
   Field names: EM_Stock_Alerts and Accessory_Order_Recommendations per ux/stock-alerts and ux/accessory-shipments (read live 11-12 Oct 2026),
   Vendor_Orders per VENDOR-ORDERS.md, Device_Returns per ux/returns-module/RETURNS-MODULE-SPEC (optional until created). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./triage-model.js'));
  else root.StockFlowModel = factory(root.TriageModel);
})(typeof self !== 'undefined' ? self : this, function (TM) {
  'use strict';

  var DAY = 86400000;
  var APPROVE_LIMIT_BD = 2;      /* business days an alert may wait for approval (Beau, 12 Oct: two) */
  var ORDER_LIMIT_BD = 2;        /* business days an order-prompting alert may sit approved with no order */
  var FOLLOWUP_DAYS = 7;         /* contacted, no order after this many days = chase (same as the Accessory board) */
  var DUE_GRACE_DAYS = 7;        /* 0..7 days past the next due date is Due, more is Overdue (same as the Accessory board) */
  var STILL_SEEN_DAYS = 7;       /* email sent this long ago and the alert was seen again at the latest count */
  var WINDOWS = [{ id: '7', label: 'Last 7 days', days: 7 }, { id: '30', label: 'Last 30 days', days: 30 },
    { id: '90', label: 'Last 90 days', days: 90 }, { id: 'all', label: 'All', days: null }];

  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pickVal(v) { return v && v !== '-None-' ? v : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function bd(ms, now) { return ms == null ? null : TM.businessDaysElapsed(ms, now, {}); }
  function inWindow(ms, now, days) { return days == null || ms == null || ms >= now - days * DAY; }
  function sortOld(a, b) { return (a.ms || 0) - (b.ms || 0); }
  function sortNew(a, b) { return (b.ms || 0) - (a.ms || 0); }

  /* What kind of signal an alert is. Matches on words so a renamed picklist value still lands somewhere. */
  function alertKind(type) {
    var t = String(type || '');
    if (/excess/i.test(t)) return 'excess';
    if (/house/i.test(t)) return 'house';
    if (/spare floor|floor/i.test(t)) return 'customer';
    if (/growth|accessor/i.test(t)) return 'accessory';
    return 'other';
  }
  /* Same rule as stock-model.js laneOf and the sync functions. Change together. */
  function alertLane(status, email) {
    if (status === 'Dismissed') return 'dismissed';
    if (status === 'Resolved' || status === 'Ordered') return 'done';
    if (email === 'Awaiting approval') return 'approve';
    if (email === 'Sent') return 'waiting';
    return 'action';
  }
  function normAlert(r, now) {
    var acct = lk(r.Account), status = pickVal(r.Status) || 'Open', email = pickVal(r.Email_Status);
    var kind = alertKind(r.Alert_Type);
    return {
      id: r.id, name: r.Name || '', type: pickVal(r.Alert_Type), kind: kind, status: status, email: email, lane: alertLane(status, email),
      open: status !== 'Dismissed' && status !== 'Resolved' && status !== 'Ordered',
      family: pickVal(r.Device_Family), spare: num(r.Spare_Units), assigned: num(r.Assigned_Units), threshold: num(r.Threshold),
      order: num(r.Suggested_Order) || 0, ret: num(r.Suggested_Return) || 0, resolution: pickVal(r.Resolution),
      seenMs: toMs(r.Last_Seen), sentMs: toMs(r.Email_Sent_At), createdMs: toMs(r.Created_Time), modifiedMs: toMs(r.Modified_Time),
      accountId: acct.id, accountName: acct.name, ageBD: bd(toMs(r.Created_Time) || toMs(r.Last_Seen), now)
    };
  }
  function normRec(r, now, shipsByAccount) {
    var acct = lk(r.Account), stored = pickVal(r.Status);
    var next = toMs(r.Next_Due_Date), contacted = toMs(r.Last_Contacted_Date), ordered = toMs(r.Last_Order_Placed_Date), recd = toMs(r.Recommendation_Date);
    var handled = stored === 'Contacted' || stored === 'Ordered' || stored === 'No order needed';
    var effective = stored;
    if (!handled) {
      if (next == null) effective = stored || 'Not due';
      else { var past = Math.floor((now - next) / DAY); effective = past < 0 ? 'Not due' : past <= DUE_GRACE_DAYS ? 'Due' : 'Overdue'; }
    }
    var anchor = Math.max(recd == null ? -Infinity : recd, contacted == null ? -Infinity : contacted, ordered == null ? -Infinity : ordered);
    var ships = (shipsByAccount[acct.id] || []).filter(function (s) { return anchor !== -Infinity && s.ms != null && s.ms > anchor; });
    var shippedSince = ships.length > 0;
    var age = contacted != null ? Math.floor((now - contacted) / DAY) : null;
    var bucket;
    if (effective === 'No order needed') bucket = 'ok';
    else if (shippedSince && (handled || effective === 'Due' || effective === 'Overdue')) bucket = 'shipped';
    else if (effective === 'Overdue') bucket = 'overdue';
    else if (effective === 'Due') bucket = 'due';
    else if (effective === 'Contacted') bucket = (ordered == null && (age == null || age > FOLLOWUP_DAYS)) ? 'chase' : 'waiting';
    else if (effective === 'Ordered') bucket = 'ordered';
    else bucket = 'ok';
    return {
      id: r.id, name: r.Name || acct.name, accountId: acct.id, accountName: acct.name || r.Name || '', stored: stored, status: effective, bucket: bucket,
      suggested: r.Suggested_Order == null ? '' : String(r.Suggested_Order), nextMs: next, contactedMs: contacted, orderedMs: ordered, contactedAge: age,
      daysOver: next != null && now > next ? Math.floor((now - next) / DAY) : 0, handledBy: lk(r.Handled_By).name, shipsSince: ships,
      ageBD: bd(next, now), vendorName: lk(r.Order_Vendor).name
    };
  }
  function normOrder(r, now) {
    var acct = lk(r.Account), v = lk(r.Vendor), al = lk(r.Stock_Alert), rc = lk(r.Recommendation), cs = lk(r.Case);
    var status = pickVal(r.Order_Status) || 'Placed', type = pickVal(r.Order_Type) || 'Accessories';
    return { id: r.id, type: type, status: status, alertId: al.id, recId: rc.id, caseId: cs.id, vendorName: v.name, reference: r.Reference ? String(r.Reference).trim() : '',
      orderMs: toMs(r.Order_Date), receivedMs: toMs(r.Received_At) || toMs(r.Received_Date), accountId: acct.id, accountName: acct.name, source: pickVal(r.Source),
      ageBD: status === 'Placed' ? bd(toMs(r.Order_Date), now) : null };
  }
  function normReturn(r, now) {
    var acct = lk(r.Account), al = lk(r.Stock_Alert), cs = lk(r.Case), v = lk(r.Vendor);
    var req = toMs(r.Requested_Date) || toMs(r.Created_Time), status = pickVal(r.Return_Status) || 'Requested';
    return { id: r.id, type: pickVal(r.Return_Type), status: status, open: status !== 'Closed', alertId: al.id, caseId: cs.id, vendorName: v.name,
      family: pickVal(r.Device_Family), qty: num(r.Quantity), rma: r.Vendor_RMA_Number ? String(r.Vendor_RMA_Number).trim() : '', requestedMs: req,
      receivedMs: toMs(r.Received_Date), accountId: acct.id, accountName: acct.name, ageBD: bd(req, now) };
  }
  function normShip(r) {
    var acct = lk(r.Account), rc = lk(r.Recommendation);
    return { id: r.id, ms: toMs(r.Ship_Date), accountId: acct.id, accountName: acct.name || (r.Allied_Customer || ''), recId: rc.id };
  }

  /* ---------- row builders ---------- */
  function askText(a) {
    var fam = a.family || 'device';
    if (a.order > 0) return 'Send ' + a.order + ' ' + fam;
    if (a.ret > 0) return 'Take back ' + a.ret + ' ' + fam;
    return a.type;
  }
  function alertItem(a, state, tone, note) {
    return { kind: 'alert', id: a.id, title: (a.type || 'Alert') + (a.kind !== 'house' && a.accountName ? ' - ' + a.accountName : ''),
      sub: [askText(a), a.spare != null && a.threshold != null ? a.spare + ' spare, floor ' + a.threshold : ''].filter(Boolean).join(' / '),
      accountId: a.accountId, accountName: a.kind === 'house' ? '' : a.accountName, ms: a.createdMs || a.seenMs, age: a.ageBD,
      ageText: a.ageBD == null ? '' : plural(a.ageBD, 'business day'), state: state, tone: tone || 'info', alertId: a.id, note: note || '' };
  }
  function recItem(c, state, tone, note) {
    var age = c.bucket === 'overdue' || c.bucket === 'due' ? c.daysOver : c.contactedAge;
    return { kind: 'rec', id: c.id, title: 'Accessories - ' + c.accountName, sub: [c.suggested ? 'Suggested ' + c.suggested : '', c.vendorName ? 'From ' + c.vendorName : ''].filter(Boolean).join(' / '),
      accountId: c.accountId, accountName: c.accountName, ms: c.bucket === 'overdue' || c.bucket === 'due' ? c.nextMs : (c.contactedMs || c.nextMs), age: age,
      ageText: age == null ? '' : plural(age, 'day'), state: state || c.status, tone: tone || 'info', recId: c.id, note: note || '' };
  }
  function orderItem(o, note) {
    return { kind: 'order', id: o.id, title: (o.vendorName || 'Vendor not set') + ': ' + o.type + (o.reference ? ' ' + o.reference : ''),
      sub: [o.source, o.reference ? '' : 'No reference'].filter(Boolean).join(' / '), accountId: o.accountId, accountName: o.accountName,
      ms: o.status === 'Received' ? o.receivedMs : o.orderMs, age: o.ageBD, ageText: o.ageBD == null ? '' : plural(o.ageBD, 'business day'), state: o.status,
      tone: o.status === 'Received' ? 'good' : 'info', alertId: o.alertId, recId: o.recId, note: note || '' };
  }
  function returnItem(r, flag, note) {
    return { kind: 'return', id: r.id, title: (r.type || 'Return') + (r.family ? ': ' + r.family : '') + (r.qty != null ? ' x' + r.qty : ''),
      sub: [r.vendorName, r.rma ? 'RMA ' + r.rma : ''].filter(Boolean).join(' / '), accountId: r.accountId, accountName: r.accountName, ms: r.requestedMs,
      age: r.ageBD, ageText: r.ageBD == null ? '' : plural(r.ageBD, 'business day'), state: r.status, tone: r.status === 'Closed' ? 'good' : flag ? 'warn' : 'info', alertId: r.alertId, note: note || '' };
  }
  function shipItem(s) {
    return { kind: 'ship', id: s.id, title: 'Accessory shipment', sub: 'No recommendation linked', accountId: s.accountId, accountName: s.accountName, ms: s.ms, age: null, ageText: '',
      state: 'Not linked', tone: 'neutral', note: '' };
  }

  /* ---------- build ---------- */
  /* data = { alerts, recs, orders, returns, ships } raw rows.
     opts = { days, alertLink (Vendor_Orders has Stock_Alert), returnsAvailable, shipLink (Accessory_Shipments has Recommendation) } */
  function build(data, now, opts) {
    opts = opts || {}; data = data || {};
    var days = opts.days === undefined ? 30 : opts.days;
    var alertLink = !!opts.alertLink, returnsAvailable = !!opts.returnsAvailable, shipLink = !!opts.shipLink;
    var ships = (data.ships || []).map(normShip), shipsByAccount = {};
    ships.forEach(function (s) { if (s.accountId) (shipsByAccount[s.accountId] = shipsByAccount[s.accountId] || []).push(s); });
    var alerts = (data.alerts || []).map(function (r) { return normAlert(r, now); });
    var recs = (data.recs || []).map(function (r) { return normRec(r, now, shipsByAccount); });
    var orders = (data.orders || []).map(function (r) { return normOrder(r, now); });
    var returns = (data.returns || []).map(function (r) { return normReturn(r, now); });
    var alertById = {}; alerts.forEach(function (a) { alertById[a.id] = a; });
    var recById = {}; recs.forEach(function (c) { recById[c.id] = c; });
    var ordersByAlert = {}, ordersByRec = {}, returnsByAlert = {}, orderById = {}, returnById = {};
    orders.forEach(function (o) { orderById[o.id] = o; if (o.alertId) (ordersByAlert[o.alertId] = ordersByAlert[o.alertId] || []).push(o); if (o.recId) (ordersByRec[o.recId] = ordersByRec[o.recId] || []).push(o); });
    returns.forEach(function (r) { returnById[r.id] = r; if (r.alertId) (returnsByAlert[r.alertId] = returnsByAlert[r.alertId] || []).push(r); });
    var live = function (list) { return (list || []).filter(function (o) { return o.status !== 'Cancelled'; }); };

    var open = alerts.filter(function (a) { return a.open; });
    var byKind = function (k) { return open.filter(function (a) { return a.kind === k; }); };
    var sigDev = open.filter(function (a) { return a.kind === 'house' || a.kind === 'customer'; });
    var sigAcc = byKind('accessory'), sigExc = byKind('excess');
    var recDue = recs.filter(function (c) { return c.bucket === 'due' || c.bucket === 'overdue'; });
    var recOverdueNoContact = recs.filter(function (c) { return c.bucket === 'overdue' && c.contactedMs == null; });
    var recChase = recs.filter(function (c) { return c.bucket === 'chase'; });
    var recWaiting = recs.filter(function (c) { return c.bucket === 'waiting'; });
    var recOrderedNone = recs.filter(function (c) { return c.status === 'Ordered' && !live(ordersByRec[c.id]).length; });
    var recShipped = recs.filter(function (c) { return c.bucket === 'shipped'; });
    var recOk = recs.filter(function (c) { return c.bucket === 'ok'; });

    var ai = function (list, st, tone, noteFn) { return list.map(function (a) { return alertItem(a, st(a), tone ? tone(a) : 'info', noteFn ? noteFn(a) : ''); }); };
    var stateOf = function (a) { return a.email || a.status; };

    /* decision */
    var approve = open.filter(function (a) { return a.lane === 'approve'; });
    var approveLate = approve.filter(function (a) { return a.ageBD != null && a.ageBD >= APPROVE_LIMIT_BD; });
    var action = open.filter(function (a) { return a.lane === 'action' && !(a.email === 'Rejected' && a.kind === 'excess'); });
    var waiting = open.filter(function (a) { return a.lane === 'waiting'; });
    var noRecip = open.filter(function (a) { return a.email === 'No recipient'; });
    var rejected = open.filter(function (a) { return a.email === 'Rejected' && a.kind !== 'excess'; });
    /* decided 12 Oct: a rejected excess-spares email was rejected on purpose, so it counts as closed */
    var rejExcess = open.filter(function (a) { return a.email === 'Rejected' && a.kind === 'excess'; });
    var stillSeen = waiting.filter(function (a) { return a.sentMs != null && now - a.sentMs >= STILL_SEEN_DAYS * DAY && a.seenMs != null && now - a.seenMs <= 2 * DAY; });

    /* action */
    var deviceOrderAlerts = function (a) { return a.kind === 'house' || a.kind === 'customer'; };
    var excNoReturn = sigExc.filter(function (a) { return a.ret > 0 && a.email !== 'Rejected' && !(returnsByAlert[a.id] || []).length; });
    var doneNoOrder = alertLink ? alerts.filter(function (a) { return a.lane === 'done' && deviceOrderAlerts(a) && a.order > 0 && !live(ordersByAlert[a.id]).length; }) : [];
    var openOrders = live(orders).filter(function (o) { return o.status === 'Placed' && (o.alertId || o.recId); });
    var alertReturns = returns.filter(function (r) { return r.alertId && r.open; });

    /* fulfilment */
    var recvOrders = orders.filter(function (o) { return o.status === 'Received' && (o.alertId || o.recId) && inWindow(o.receivedMs, now, days); });
    var recvReturns = returns.filter(function (r) { return r.alertId && r.status === 'Received'; });
    var unlinkedShips = shipLink ? ships.filter(function (s) { return !s.recId && inWindow(s.ms, now, days); }) : [];

    /* closed */
    var done = alerts.filter(function (a) { return a.lane === 'done' && inWindow(a.modifiedMs || a.seenMs, now, days); });
    var dismissed = alerts.filter(function (a) { return a.lane === 'dismissed' && inWindow(a.modifiedMs || a.seenMs, now, days); });

    var L = {};
    function lane(id, stage, label, items, tone, hint, kind) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind, items: items }; }
    var sortA = function (l) { return l.sort(function (a, b) { return (b.tone === 'warn' || b.tone === 'bad' ? 1 : 0) - (a.tone === 'warn' || a.tone === 'bad' ? 1 : 0) || sortOld(a, b); }); };

    lane('s-dev', 1, 'Device stock alerts', sortA(ai(sigDev, stateOf)), 'neutral', 'house stock and customer spare floor', 'alert');
    lane('s-acc', 1, 'Accessory growth alerts', sortA(ai(sigAcc, stateOf)), 'neutral', '', 'alert');
    lane('s-exc', 1, 'Excess spares alerts', sortA(ai(sigExc, stateOf)), 'neutral', 'customers holding more spares than needed', 'alert');
    lane('s-rec', 1, 'Accessory orders due or overdue', recDue.map(function (c) { return recItem(c, c.status, c.bucket === 'overdue' ? 'warn' : 'info'); }).sort(sortOld), 'neutral',
      recDue.length ? plural(recDue.filter(function (c) { return c.bucket === 'overdue'; }).length, 'overdue') : '', 'rec');

    lane('d-approve', 2, 'Waiting for approval', ai(approve, stateOf, function (a) { return a.ageBD != null && a.ageBD >= APPROVE_LIMIT_BD ? 'warn' : 'info'; }).sort(sortOld), 'warn',
      approveLate.length ? plural(approveLate.length, 'alert') + ' over two business days' : '', 'alert');
    lane('d-action', 2, 'Needs action', ai(action, stateOf).sort(sortOld), 'neutral', 'approved or not emailed, nothing done yet', 'alert');
    lane('d-wait', 2, 'Sent, waiting on customer', ai(waiting, stateOf).sort(sortOld), 'neutral', '', 'alert');
    lane('d-rec', 2, 'Customer contacted about accessories', recWaiting.concat(recChase).map(function (c) { return recItem(c, c.status, c.bucket === 'chase' ? 'warn' : 'info', c.bucket === 'chase' ? 'Contacted ' + c.contactedAge + ' days ago with no order.' : ''); }).sort(sortOld), 'neutral', '', 'rec');
    lane('d-chase', 2, 'Contacted over a week ago, no order', recChase.map(function (c) { return recItem(c, 'Chase', 'warn', 'Contacted ' + c.contactedAge + ' days ago with no order.'); }).sort(sortOld), 'warn', recChase.length ? '' : 'None found', 'rec');
    lane('d-nocontact', 2, 'Overdue, nobody has contacted', recOverdueNoContact.map(function (c) { return recItem(c, 'Overdue', 'warn', 'Overdue ' + plural(c.daysOver, 'day') + ', no contact recorded.'); }).sort(sortOld), 'warn', recOverdueNoContact.length ? '' : 'None found', 'rec');
    lane('d-stillseen', 2, 'Sent over a week ago, still low or high', ai(stillSeen, stateOf, function () { return 'warn'; }, function (a) { return 'Emailed ' + Math.floor((now - a.sentMs) / DAY) + ' days ago; the latest count still raises this.'; }).sort(sortOld), 'warn', stillSeen.length ? '' : 'None found', 'alert');
    lane('d-norecip', 2, 'No recipient on the account', ai(noRecip, stateOf, function () { return 'warn'; }, function () { return 'The account has no stock alert contact, so this cannot be emailed.'; }).sort(sortOld), 'warn', noRecip.length ? '' : 'None found', 'alert');
    lane('d-rejected', 2, 'Email rejected, alert still open', ai(rejected, stateOf, function () { return 'warn'; }, function (a) { return a.ret > 0 ? 'Rejected; ' + a.ret + ' to take back and nobody is chasing it.' : 'Rejected; nothing else has happened.'; }).sort(sortOld), 'warn', rejected.length ? '' : 'None found', 'alert');

    lane('a-orders', 3, 'Orders placed from a signal', openOrders.map(function (o) { return orderItem(o, o.ageBD != null && o.ageBD >= 10 ? 'Placed ' + plural(o.ageBD, 'business day') + ' ago.' : ''); }).sort(sortOld), 'neutral', 'still Placed', 'order');
    lane('a-returns', 3, 'Returns requested from an alert', alertReturns.map(function (r) { return returnItem(r, false); }).sort(sortOld), 'neutral', returnsAvailable ? '' : 'Returns module not set up yet', 'return');
    lane('a-exc-none', 3, 'Excess alerts with no return request', ai(excNoReturn, stateOf, function () { return 'warn'; }, function (a) { return 'Take back ' + a.ret + ' ' + (a.family || 'device') + (a.email === 'Rejected' ? ' (email rejected)' : '') + ': no return recorded.'; }).sort(sortOld), 'warn',
      excNoReturn.length ? (returnsAvailable ? '' : 'every one until the Returns module exists') : 'None found', 'alert');
    lane('a-order-none', 3, 'Approved alerts with no order', ai(doneNoOrder, stateOf, function () { return 'warn'; }, function () { return 'The alert is done but no order is linked to it.'; }).sort(sortOld), 'warn',
      alertLink ? (doneNoOrder.length ? '' : 'None found') : 'order link not available yet', 'alert');
    lane('a-rec-none', 3, 'Marked ordered, no order recorded', recOrderedNone.map(function (c) { return recItem(c, 'Ordered', 'warn', 'The recommendation says ordered but no Vendor Order is linked.'); }).sort(sortOld), 'warn', recOrderedNone.length ? '' : 'None found', 'rec');

    lane('f-recv', 4, 'Orders received', recvOrders.map(function (o) { return orderItem(o); }).sort(sortNew), 'good', 'in this window', 'order');
    lane('f-ret-recv', 4, 'Returns received, not closed', recvReturns.map(function (r) { return returnItem(r, true, 'Received but not closed: record the outcome and the count.'); }).sort(sortNew), 'warn', recvReturns.length ? '' : 'None found', 'return');
    lane('f-ship', 4, 'Shipped since the recommendation', recShipped.map(function (c) { return recItem(c, 'Shipped, confirm', 'good', 'An accessory shipment left after ' + (c.contactedMs ? 'contact' : 'the recommendation') + '.'); }).sort(sortNew), 'good', 'confirm the order was filled', 'rec');
    lane('f-ship-nolink', 4, 'Shipments with no recommendation', unlinkedShips.map(shipItem).sort(sortNew), 'neutral',
      shipLink ? 'backfill list, in this window' : 'Recommendation link not available yet', 'ship');

    lane('z-done', 5, 'Alerts resolved or ordered', ai(done, function (a) { return a.status; }, function () { return 'good'; }).sort(sortNew), 'good', 'in this window', 'alert');
    lane('z-dismissed', 5, 'Alerts dismissed', ai(dismissed, function (a) { return a.status; }, function () { return 'neutral'; }).sort(sortNew), 'neutral', 'in this window', 'alert');
    lane('z-rej-exc', 5, 'Excess alerts rejected on purpose', ai(rejExcess, stateOf, function () { return 'neutral'; }, function (a) { return 'Email rejected on purpose; ' + (a.ret || 0) + ' not being taken back.'; }).sort(sortOld), 'neutral', 'counted as closed', 'alert');
    lane('z-rec-ok', 5, 'Accessories on track', recOk.map(function (c) { return recItem(c, c.status, 'good'); }).sort(sortOld), 'good', 'not due or no order needed', 'rec');

    var stages = [
      { n: 1, title: 'Signal', big: open.length + recDue.length, bigLabel: 'open alerts and accessory orders due', lanes: ['s-dev', 's-acc', 's-exc', 's-rec'] },
      { n: 2, title: 'Decision', big: approve.length + action.length + recChase.length + recOverdueNoContact.length, bigLabel: 'waiting on a person', lanes: ['d-approve', 'd-action', 'd-wait', 'd-rec', 'd-chase', 'd-nocontact', 'd-stillseen', 'd-norecip', 'd-rejected'] },
      { n: 3, title: 'Action', big: openOrders.length + alertReturns.length, bigLabel: 'orders and returns under way', lanes: ['a-orders', 'a-returns', 'a-exc-none', 'a-order-none', 'a-rec-none'] },
      { n: 4, title: 'Fulfilment', big: recvOrders.length + recShipped.length, bigLabel: 'received or shipped in this window', lanes: ['f-recv', 'f-ret-recv', 'f-ship', 'f-ship-nolink'] },
      { n: 5, title: 'Closed', big: done.length + dismissed.length + rejExcess.length, bigLabel: 'alerts closed in this window (plus rejected on purpose)', lanes: ['z-done', 'z-dismissed', 'z-rej-exc', 'z-rec-ok'] }
    ];

    var stuck = [];
    if (excNoReturn.length) stuck.push({ lane: 'a-exc-none', tone: 'bad', text: plural(excNoReturn.length, 'excess spares alert') + ' with devices to take back and no return request' });
    if (approveLate.length) stuck.push({ lane: 'd-approve', tone: 'warn', text: plural(approveLate.length, 'alert') + ' waiting for approval over two business days' });
    if (doneNoOrder.length) stuck.push({ lane: 'a-order-none', tone: 'warn', text: plural(doneNoOrder.length, 'approved alert') + ' with no order' });
    if (recOverdueNoContact.length) stuck.push({ lane: 'd-nocontact', tone: 'warn', text: plural(recOverdueNoContact.length, 'accessory order') + ' overdue with nobody contacted' });
    if (recChase.length) stuck.push({ lane: 'd-chase', tone: 'warn', text: plural(recChase.length, 'customer') + ' contacted over a week ago with no order' });
    if (recOrderedNone.length) stuck.push({ lane: 'a-rec-none', tone: 'warn', text: plural(recOrderedNone.length, 'recommendation') + ' marked ordered with no order recorded' });
    if (stillSeen.length) stuck.push({ lane: 'd-stillseen', tone: 'warn', text: plural(stillSeen.length, 'alert') + ' emailed over a week ago and still raised at the latest count' });
    if (recvReturns.length) stuck.push({ lane: 'f-ret-recv', tone: 'warn', text: plural(recvReturns.length, 'return') + ' received but not closed' });
    if (noRecip.length) stuck.push({ lane: 'd-norecip', tone: 'warn', text: plural(noRecip.length, 'alert') + ' that cannot be emailed (no recipient)' });
    if (rejected.length) stuck.push({ lane: 'd-rejected', tone: 'warn', text: plural(rejected.length, 'alert') + ' with a rejected email and nothing done' });

    return { now: now, days: days, lanes: L, stages: stages, stuck: stuck, alertById: alertById, recById: recById, orderById: orderById, returnById: returnById,
      ordersByAlert: ordersByAlert, ordersByRec: ordersByRec, returnsByAlert: returnsByAlert,
      totals: { alerts: alerts.length, openAlerts: open.length, recs: recs.length, orders: orders.length, returns: returns.length, ships: ships.length } };
  }

  /* The path for one record: signal -> decision -> action -> fulfilment -> account. */
  function trace(model, item) {
    var a = null, c = null, orders = [], rets = [];
    if (item.kind === 'alert') { a = model.alertById[item.id] || null; }
    else if (item.kind === 'rec') { c = model.recById[item.id] || null; }
    else if (item.kind === 'order') { var o = model.orderById[item.id]; if (o) { a = o.alertId ? model.alertById[o.alertId] || null : null; c = o.recId ? model.recById[o.recId] || null : null; orders = [o]; } }
    else if (item.kind === 'return') { var r = model.returnById[item.id]; if (r) { a = r.alertId ? model.alertById[r.alertId] || null : null; rets = [r]; } }
    if (a && !orders.length) orders = model.ordersByAlert[a.id] || [];
    if (c && !orders.length) orders = model.ordersByRec[c.id] || [];
    if (a && !rets.length) rets = model.returnsByAlert[a.id] || [];
    var aid = (a && a.accountId) || (c && c.accountId) || item.accountId || (orders[0] && orders[0].accountId) || null;
    var aname = (a && a.kind !== 'house' && a.accountName) || (c && c.accountName) || item.accountName || (orders[0] && orders[0].accountName) || '';
    return { alert: a, rec: c, orders: orders, returns: rets, account: (aid || aname) ? { id: aid, name: aname } : null };
  }

  return { WINDOWS: WINDOWS, APPROVE_LIMIT_BD: APPROVE_LIMIT_BD, FOLLOWUP_DAYS: FOLLOWUP_DAYS, DUE_GRACE_DAYS: DUE_GRACE_DAYS, STILL_SEEN_DAYS: STILL_SEEN_DAYS,
    alertKind: alertKind, alertLane: alertLane, build: build, trace: trace };
});
