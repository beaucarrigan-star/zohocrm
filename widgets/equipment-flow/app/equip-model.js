/* Equipment flow: pure logic (no DOM, no Zoho). Works in browser (window.EquipModel) and node (require).
   Follows a device from the need (a case or a stock alert), through the vendor order, receiving and shipping,
   to the field count, plus returns (Device Returns module, optional until it is created).
   Inputs are raw COQL rows. Field names: Vendor_Orders per ux/accessory-shipments/VENDOR-ORDERS.md, Daily_Unit_Counts and
   EM_Stock_Alerts as read live 11-12 Oct 2026, Device_Returns per ux/returns-module/RETURNS-MODULE-SPEC. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./triage-model.js'));
  else root.EquipModel = factory(root.TriageModel);
})(typeof self !== 'undefined' ? self : this, function (TM) {
  'use strict';

  var DAY = 86400000;
  /* Business days a case may wait for its order to be recorded (same as Support flow, decided 12 Oct 2026). */
  var CASE_LIMIT_BD = 2;
  /* Business days a device order may stay Placed, and a return may stay open, before it is flagged.
     No vendor lead times are stored; 10 is a starting guess and the page lets people change it. */
  var DEFAULT_LEAD_BD = 10;
  var WINDOWS = [{ id: '7', label: 'Last 7 days', days: 7 }, { id: '30', label: 'Last 30 days', days: 30 },
    { id: '90', label: 'Last 90 days', days: 90 }, { id: 'all', label: 'All', days: null }];
  var STOCK_TYPES = ['House stock', 'Customer spare floor'];

  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    /* A date with no time is read as noon UTC so it lands on the same calendar day in Central. */
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pickVal(v) { return v && v !== '-None-' ? v : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function bd(ms, now, opts) { return ms == null ? null : TM.businessDaysElapsed(ms, now, opts); }
  function inWindow(ms, now, days) { return days == null || ms == null || ms >= now - days * DAY; }
  function sortOld(a, b) { return (a.ms || 0) - (b.ms || 0); }
  function sortNew(a, b) { return (b.ms || 0) - (a.ms || 0); }

  /* "4 GPS ankle monitor; 2 Chargers" -> 6. Quantity ordered is only in this free text (known gap). */
  function itemsQty(items) {
    var n = 0, found = false;
    String(items || '').split(/;|\n/).forEach(function (seg) { var m = /^\s*(\d+)\s/.exec(seg); if (m) { n += +m[1]; found = true; } });
    return found ? n : null;
  }
  function serialList(s) { return String(s || '').split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); }

  /* ---------- records ---------- */
  function caseOpen(status) { var s = String(status || ''); return s !== 'Closed' && s !== 'Resolved'; }

  function normCase(r, now, opts) {
    var created = toMs(r.Created_Time), acct = lk(r.Account_Name);
    return {
      id: r.id, number: r.Case_Number != null ? String(r.Case_Number) : '', subject: r.Subject || '(no subject)', status: pickVal(r.Status),
      open: caseOpen(r.Status), category: pickVal(r.Case_Category), createdMs: created, ageBD: bd(created, now, opts),
      accountId: acct.id, accountName: acct.name, equipment: r.Case_Category === 'Order Device(s)'
    };
  }
  function normOrder(r, now, opts) {
    var acct = lk(r.Account), cs = lk(r.Case), v = lk(r.Vendor), al = lk(r.Stock_Alert);
    var orderMs = toMs(r.Order_Date), items = r.Items || '', ship = String(r.Ship_To || '').trim();
    var ser = serialList(r.Serial_Numbers);
    var status = pickVal(r.Order_Status) || 'Placed';
    return {
      id: r.id, type: pickVal(r.Order_Type) || 'Accessories', status: status, caseId: cs.id, caseName: cs.name, alertId: al.id,
      vendorId: v.id, vendorName: v.name, method: pickVal(r.Method), items: items, orderedQty: itemsQty(items),
      receivedQty: num(r.Received_Qty), shipTo: ship, house: !ship, serials: ser, reference: r.Reference ? String(r.Reference).trim() : '',
      orderMs: orderMs, receivedMs: toMs(r.Received_At) || toMs(r.Received_Date), source: pickVal(r.Source),
      accountId: acct.id, accountName: acct.name,
      ageBD: status === 'Placed' ? bd(orderMs, now, opts) : null
    };
  }
  function normAlert(r, now) {
    var acct = lk(r.Account);
    return {
      id: r.id, name: r.Name || '', type: pickVal(r.Alert_Type), status: pickVal(r.Status) || 'Open', emailStatus: pickVal(r.Email_Status),
      family: pickVal(r.Device_Family), spare: num(r.Spare_Units), assigned: num(r.Assigned_Units), threshold: num(r.Threshold),
      suggestedOrder: num(r.Suggested_Order) || 0, suggestedReturn: num(r.Suggested_Return) || 0,
      countDate: r.Count_Date || r.Last_Seen || '', lastSeenMs: toMs(r.Last_Seen), accountId: acct.id, accountName: acct.name
    };
  }
  function normReturn(r, now, opts) {
    var acct = lk(r.Account), cs = lk(r.Case), al = lk(r.Stock_Alert), v = lk(r.Vendor);
    var req = toMs(r.Requested_Date) || toMs(r.Created_Time);
    var status = pickVal(r.Return_Status) || 'Requested';
    return {
      id: r.id, name: r.Name || '', type: pickVal(r.Return_Type), status: status, open: status !== 'Closed', caseId: cs.id, alertId: al.id,
      vendorName: v.name, family: pickVal(r.Device_Family), qty: num(r.Quantity), rma: r.Vendor_RMA_Number ? String(r.Vendor_RMA_Number).trim() : '',
      serials: serialList(r.Serial_Numbers), requestedMs: req, shippedMs: toMs(r.Shipped_Date), receivedMs: toMs(r.Received_Date), outcome: pickVal(r.Outcome),
      accountId: acct.id, accountName: acct.name, ageBD: bd(req, now, opts)
    };
  }

  /* Orders still to be explained: stock alert and case links first, then nothing. */
  function orderState(list) {
    var live = (list || []).filter(function (o) { return o.status !== 'Cancelled'; });
    if (!live.length) return (list && list.length) ? 'cancelled' : 'none';
    return live.every(function (o) { return o.status === 'Received'; }) ? 'received' : 'placed';
  }

  /* ---------- row builders ---------- */
  function orderItem(o, caseById, extra) {
    var c = o.caseId ? caseById[o.caseId] : null;
    var tone = o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info';
    var it = {
      kind: 'order', id: o.id, title: (o.vendorName || 'Vendor not set') + ': ' + (o.items || 'devices').replace(/\s*\n\s*/g, '; '),
      sub: [o.reference ? 'Ref ' + o.reference : 'No reference', o.method, o.shipTo ? 'Ship to ' + o.shipTo.split('\n')[0] : 'House stock'].filter(Boolean).join(' / '),
      accountId: o.accountId, accountName: o.accountName, ms: o.status === 'Received' ? o.receivedMs : o.orderMs,
      age: o.ageBD, ageText: o.ageBD == null ? '' : plural(o.ageBD, 'business day'), state: o.status, tone: tone,
      caseId: o.caseId, caseNumber: c ? c.number : '', alertId: o.alertId, note: ''
    };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  }
  function caseItem(c, st) {
    var text, tone;
    if (st === 'none') { text = 'No order recorded'; tone = c.open && c.ageBD != null && c.ageBD >= CASE_LIMIT_BD ? 'warn' : 'info'; }
    else if (st === 'cancelled') { text = 'Order cancelled'; tone = 'warn'; }
    else if (st === 'placed') { text = 'Order placed'; tone = 'info'; }
    else { text = 'Order received'; tone = c.open ? 'warn' : 'good'; }
    return { kind: 'case', id: c.id, title: (c.number ? c.number + ' ' : '') + c.subject, sub: [c.category, c.status].filter(Boolean).join(' / '),
      accountId: c.accountId, accountName: c.accountName, ms: c.createdMs, age: c.ageBD, ageText: c.ageBD == null ? '' : plural(c.ageBD, 'business day'),
      state: text, tone: tone, caseId: c.id, caseNumber: c.number, note: '' };
  }
  function alertItem(a, linked, linkKnown) {
    var text, tone;
    if (linkKnown) { text = linked ? 'Order recorded' : 'No order recorded'; tone = linked ? 'info' : 'warn'; }
    else { text = a.emailStatus || a.status; tone = 'info'; }
    return { kind: 'alert', id: a.id, title: a.type + (a.accountName && a.type !== 'House stock' ? ' - ' + a.accountName : ''),
      sub: [a.family, a.spare != null && a.threshold != null ? a.spare + ' spare, floor ' + a.threshold : '', 'suggests ordering ' + a.suggestedOrder].filter(Boolean).join(' / '),
      accountId: a.accountId, accountName: a.type === 'House stock' ? '' : a.accountName, ms: a.lastSeenMs, age: null, ageText: '', state: text, tone: tone, alertId: a.id, note: '' };
  }
  function returnItem(r, caseById, flag) {
    var c = r.caseId ? caseById[r.caseId] : null;
    var tone = r.status === 'Closed' ? 'good' : flag ? 'warn' : 'info';
    return { kind: 'return', id: r.id, title: (r.type || 'Return') + (r.family ? ': ' + r.family : '') + (r.qty != null ? ' x' + r.qty : ''),
      sub: [r.vendorName, r.rma ? 'RMA ' + r.rma : 'No RMA number'].filter(Boolean).join(' / '), accountId: r.accountId, accountName: r.accountName,
      ms: r.requestedMs, age: r.ageBD, ageText: r.ageBD == null ? '' : plural(r.ageBD, 'business day'), state: r.status, tone: tone,
      caseId: r.caseId, caseNumber: c ? c.number : '', alertId: r.alertId, note: '' };
  }

  /* Latest count per device family, with the change against the count day before it. */
  function fieldCounts(rows) {
    var by = {}, dates = {};
    (rows || []).forEach(function (r) {
      var d = String(r.Count_Date || '').slice(0, 10), f = pickVal(r.Device_Family) || 'Unknown';
      if (!d) return;
      dates[d] = true;
      var k = d + '|' + f; var x = by[k] || (by[k] = { date: d, family: f, onLeg: 0, spare: 0, total: 0 });
      x.onLeg += num(r.On_Leg) || 0; x.spare += num(r.Spare) || 0; x.total += num(r.Total_Units) || 0;
    });
    var ds = Object.keys(dates).sort();
    var last = ds[ds.length - 1], prev = ds.length > 1 ? ds[ds.length - 2] : null;
    var fams = {};
    Object.keys(by).forEach(function (k) { if (by[k].date === last) fams[by[k].family] = true; });
    var out = Object.keys(fams).sort().map(function (f) {
      var a = by[last + '|' + f], b = prev ? by[prev + '|' + f] : null;
      var dT = b ? a.total - b.total : null, dS = b ? a.spare - b.spare : null;
      return { kind: 'family', id: 'fam-' + f, title: f, sub: 'Count of ' + last + (prev ? ', change since ' + prev : ', no earlier count loaded'),
        onLeg: a.onLeg, spare: a.spare, total: a.total, dTotal: dT, dSpare: dS, family: f, date: last, ms: toMs(last), age: null, ageText: '',
        accountName: '', state: a.total + ' units' + (dT == null ? '' : ' (' + (dT > 0 ? '+' : '') + dT + ')'), tone: dT != null && dT < 0 ? 'warn' : 'neutral', note: '' };
    });
    return { date: last || null, previous: prev, families: out };
  }

  /* ---------- build ---------- */
  /* data = { orders, cases, alerts, counts, returns } raw rows. opts = { days, leadBD, alertLink (true when Vendor_Orders has a Stock_Alert lookup), returnsAvailable } */
  function build(data, now, opts) {
    opts = opts || {}; data = data || {};
    var days = opts.days === undefined ? 30 : opts.days;
    var leadBD = opts.leadBD == null ? DEFAULT_LEAD_BD : opts.leadBD;
    var bdOpts = {};
    var cases = (data.cases || []).map(function (r) { return normCase(r, now, bdOpts); });
    var caseById = {}; cases.forEach(function (c) { caseById[c.id] = c; });
    var orders = (data.orders || []).map(function (r) { return normOrder(r, now, bdOpts); }).filter(function (o) { return o.type === 'Devices'; });
    var ordersByCase = {}, ordersByAlert = {};
    orders.forEach(function (o) {
      if (o.caseId) (ordersByCase[o.caseId] = ordersByCase[o.caseId] || []).push(o);
      if (o.alertId) (ordersByAlert[o.alertId] = ordersByAlert[o.alertId] || []).push(o);
    });
    var alerts = (data.alerts || []).map(normAlert);
    var alertById = {}; alerts.forEach(function (a) { alertById[a.id] = a; });
    var returns = (data.returns || []).map(function (r) { return normReturn(r, now, bdOpts); });
    var returnsByCase = {}; returns.forEach(function (r) { if (r.caseId) (returnsByCase[r.caseId] = returnsByCase[r.caseId] || []).push(r); });
    var alertLink = !!opts.alertLink;
    var detail = opts.detail !== false;      /* false when Items, Ship To and Serial Numbers could not be read: those checks are switched off, not guessed */

    /* 1 Need */
    var needCases = cases.filter(function (c) { return c.equipment && c.open; }).map(function (c) { return caseItem(c, orderState(ordersByCase[c.id])); });
    needCases.sort(function (a, b) { return (b.age || 0) - (a.age || 0); });
    var needNoOrder = needCases.filter(function (i) { return i.state === 'No order recorded' && i.tone === 'warn'; });
    var needAlerts = alerts.filter(function (a) { return STOCK_TYPES.indexOf(a.type) >= 0 && a.status === 'Open' && a.suggestedOrder > 0; })
      .map(function (a) { return alertItem(a, !!(ordersByAlert[a.id] || []).length, alertLink); });
    needAlerts.sort(function (a, b) { return (a.tone === 'warn' ? 0 : 1) - (b.tone === 'warn' ? 0 : 1); });
    var alertsNoOrder = alertLink ? needAlerts.filter(function (i) { return i.state === 'No order recorded'; }) : [];
    var house = alerts.filter(function (a) { return a.type === 'House stock'; }).sort(function (a, b) { return String(b.countDate).localeCompare(String(a.countDate)); })[0] || null;

    /* 2 Ordered */
    var placed = orders.filter(function (o) { return o.status === 'Placed'; });
    var lateP = placed.filter(function (o) { return o.ageBD != null && o.ageBD >= leadBD; });
    var noRef = placed.filter(function (o) { return !o.reference; });
    var methodCount = {};
    placed.forEach(function (o) { var m = o.method || 'No method'; methodCount[m] = (methodCount[m] || 0) + 1; });
    var methodHint = Object.keys(methodCount).sort().map(function (m) { return m + ' ' + methodCount[m]; }).join(', ');
    var mk = function (list, noteFn) { return list.map(function (o) { return orderItem(o, caseById, noteFn ? { note: noteFn(o) } : null); }); };
    var placedItems = mk(placed, function (o) { return o.ageBD != null && o.ageBD >= leadBD ? 'Placed ' + plural(o.ageBD, 'business day') + ' ago, over the ' + leadBD + ' day limit.' : ''; }).sort(sortOld);

    /* 3 Received, 4 Out */
    var recv = orders.filter(function (o) { return o.status === 'Received' && inWindow(o.receivedMs, now, days); });
    var recvHouse = detail ? recv.filter(function (o) { return o.house; }) : [];
    var recvOut = detail ? recv.filter(function (o) { return !o.house; }) : [];
    var noSerial = detail ? recv.filter(function (o) { return !o.serials.length; }) : [];
    var mismatch = detail ? recv.filter(function (o) { return o.serials.length && o.receivedQty != null && o.serials.length !== o.receivedQty; }) : [];
    var shortQty = detail ? recv.filter(function (o) { return o.orderedQty != null && o.receivedQty != null && o.receivedQty < o.orderedQty; }) : [];
    var caseOpenRecv = orders.filter(function (o) { return o.status === 'Received' && o.caseId && caseById[o.caseId] && caseById[o.caseId].open; });

    /* 5 Field and returns */
    var counts = fieldCounts(data.counts);
    var openRet = returns.filter(function (r) { return r.open; });
    var staleRet = openRet.filter(function (r) { return r.ageBD != null && r.ageBD >= leadBD; });
    var recvRet = openRet.filter(function (r) { return r.status === 'Received'; });
    var retItems = function (list, flag) { return list.map(function (r) { return returnItem(r, caseById, flag); }).sort(sortOld); };

    var lanes = {
      'n-cases': { id: 'n-cases', stage: 1, label: 'Device requests on open cases', count: needCases.length, tone: needNoOrder.length ? 'warn' : 'neutral',
        hint: needNoOrder.length ? plural(needNoOrder.length, 'case') + ' with no order after two business days' : '', kind: 'case', items: needCases },
      'n-alerts': { id: 'n-alerts', stage: 1, label: 'Stock alerts asking for devices', count: needAlerts.length, tone: alertsNoOrder.length ? 'warn' : 'neutral',
        hint: alertLink ? (alertsNoOrder.length ? plural(alertsNoOrder.length, 'alert') + ' with no order recorded' : '') : 'order link not available yet', kind: 'alert', items: needAlerts },
      'o-placed': { id: 'o-placed', stage: 2, label: 'Placed, not yet received', count: placed.length, tone: 'neutral', hint: methodHint, kind: 'order', items: placedItems },
      'o-late': { id: 'o-late', stage: 2, label: 'Placed over the lead-time limit', count: lateP.length, tone: lateP.length ? 'warn' : 'neutral',
        hint: lateP.length ? 'over ' + leadBD + ' business days' : 'None found', kind: 'order', items: mk(lateP, function (o) { return 'Placed ' + plural(o.ageBD, 'business day') + ' ago.'; }).sort(sortOld) },
      'o-noref': { id: 'o-noref', stage: 2, label: 'Placed with no reference', count: noRef.length, tone: noRef.length ? 'warn' : 'neutral',
        hint: noRef.length ? 'nothing to chase the vendor with' : 'None found', kind: 'order', items: mk(noRef, function () { return 'No portal order number or email reference recorded.'; }).sort(sortOld) },
      'r-house': { id: 'r-house', stage: 3, label: 'Received to house stock', count: recvHouse.length, tone: 'neutral', hint: detail ? 'no Ship To on the order' : 'Ship To could not be read', kind: 'order', items: mk(recvHouse).sort(sortNew) },
      'r-noserial': { id: 'r-noserial', stage: 3, label: 'Received with no serial numbers', count: noSerial.length, tone: noSerial.length ? 'warn' : 'neutral',
        hint: !detail ? 'Serial Numbers could not be read' : noSerial.length ? '' : 'None found', kind: 'order', items: mk(noSerial, function () { return 'No serial numbers were recorded when this was received.'; }).sort(sortNew) },
      'r-mismatch': { id: 'r-mismatch', stage: 3, label: 'Serials do not match the quantity', count: mismatch.length, tone: mismatch.length ? 'warn' : 'neutral',
        hint: !detail ? 'Serial Numbers could not be read' : mismatch.length ? '' : 'None found', kind: 'order', items: mk(mismatch, function (o) { return o.serials.length + ' serials for ' + o.receivedQty + ' received.'; }).sort(sortNew) },
      'r-short': { id: 'r-short', stage: 3, label: 'Received fewer than ordered', count: shortQty.length, tone: shortQty.length ? 'warn' : 'neutral',
        hint: !detail ? 'Items could not be read' : shortQty.length ? 'quantity read from the Items text' : 'None found', kind: 'order', items: mk(shortQty, function (o) { return 'Ordered ' + o.orderedQty + ', received ' + o.receivedQty + '.'; }).sort(sortNew) },
      's-out': { id: 's-out', stage: 4, label: 'Sent on to a customer or installer', count: recvOut.length, tone: 'neutral', hint: detail ? 'Ship To is filled' : 'Ship To could not be read', kind: 'order', items: mk(recvOut).sort(sortNew) },
      's-caseopen': { id: 's-caseopen', stage: 4, label: 'Received, case still open', count: caseOpenRecv.length, tone: caseOpenRecv.length ? 'warn' : 'neutral',
        hint: caseOpenRecv.length ? 'Mark received should resolve the case' : 'None found', kind: 'order',
        items: mk(caseOpenRecv, function () { return 'The order is received but its case is still open.'; }).sort(sortNew) },
      'f-counts': { id: 'f-counts', stage: 5, label: 'In the field by device family', count: counts.families.length, tone: 'neutral',
        hint: counts.date ? 'count of ' + counts.date : 'no counts loaded', kind: 'family', items: counts.families },
      'f-ret-open': { id: 'f-ret-open', stage: 5, label: 'Returns open', count: openRet.length, tone: 'neutral',
        hint: opts.returnsAvailable ? '' : 'Returns module not set up yet', kind: 'return', items: retItems(openRet, false) },
      'f-ret-stale': { id: 'f-ret-stale', stage: 5, label: 'Returns open over the limit', count: staleRet.length, tone: staleRet.length ? 'warn' : 'neutral',
        hint: staleRet.length ? 'over ' + leadBD + ' business days' : 'None found', kind: 'return', items: retItems(staleRet, true) },
      'f-ret-recv': { id: 'f-ret-recv', stage: 5, label: 'Return received, not closed', count: recvRet.length, tone: recvRet.length ? 'warn' : 'neutral',
        hint: recvRet.length ? 'credit or replacement not recorded' : 'None found', kind: 'return', items: retItems(recvRet, true) }
    };

    var fieldTotal = counts.families.reduce(function (s, f) { return s + f.total; }, 0);
    var stages = [
      { n: 1, title: 'Need', big: needCases.length + needAlerts.length, bigLabel: 'open requests and alerts for devices', lanes: ['n-cases', 'n-alerts'] },
      { n: 2, title: 'Ordered', big: placed.length, bigLabel: placed.length === 1 ? 'device order placed, not received' : 'device orders placed, not received', lanes: ['o-placed', 'o-late', 'o-noref'] },
      { n: 3, title: 'Received', big: recv.length, bigLabel: 'device orders received in this window', lanes: ['r-house', 'r-noserial', 'r-mismatch', 'r-short'] },
      { n: 4, title: 'Out to customer', big: recvOut.length, bigLabel: 'received and sent on in this window', lanes: ['s-out', 's-caseopen'] },
      { n: 5, title: 'In the field and coming back', big: counts.date ? fieldTotal : null, bigLabel: counts.date ? 'units in the latest count' : 'no count loaded', lanes: ['f-counts', 'f-ret-open', 'f-ret-stale', 'f-ret-recv'] }
    ];

    var stuck = [];
    if (needNoOrder.length) stuck.push({ lane: 'n-cases', tone: 'warn', text: plural(needNoOrder.length, 'device request') + ' with no order recorded after two business days' });
    if (alertsNoOrder.length) stuck.push({ lane: 'n-alerts', tone: 'warn', text: plural(alertsNoOrder.length, 'stock alert') + ' asking for devices with no order recorded' });
    if (lateP.length) stuck.push({ lane: 'o-late', tone: 'warn', text: plural(lateP.length, 'device order') + ' placed over ' + leadBD + ' business days ago' });
    if (caseOpenRecv.length) stuck.push({ lane: 's-caseopen', tone: 'warn', text: plural(caseOpenRecv.length, 'order') + ' received but the case is still open' });
    if (noSerial.length) stuck.push({ lane: 'r-noserial', tone: 'warn', text: plural(noSerial.length, 'received order') + ' with no serial numbers' });
    if (mismatch.length) stuck.push({ lane: 'r-mismatch', tone: 'warn', text: plural(mismatch.length, 'received order') + ' with serials that do not match the quantity' });
    if (staleRet.length) stuck.push({ lane: 'f-ret-stale', tone: 'warn', text: plural(staleRet.length, 'return') + ' open over ' + leadBD + ' business days' });
    if (recvRet.length) stuck.push({ lane: 'f-ret-recv', tone: 'warn', text: plural(recvRet.length, 'return') + ' received but not closed' });
    if (noRef.length) stuck.push({ lane: 'o-noref', tone: 'warn', text: plural(noRef.length, 'placed order') + ' with no reference' });

    return {
      now: now, days: days, leadBD: leadBD, lanes: lanes, stages: stages, stuck: stuck, house: house, counts: counts,
      totals: { orders: orders.length, placed: placed.length, received: recv.length, needCases: needCases.length, needAlerts: needAlerts.length, returns: returns.length, openReturns: openRet.length },
      caseById: caseById, alertById: alertById, ordersByCase: ordersByCase, ordersByAlert: ordersByAlert, returnsByCase: returnsByCase, orderById: orders.reduce(function (m, o) { m[o.id] = o; return m; }, {})
    };
  }

  /* The path for one record: need -> order -> received and sent -> returns -> account. */
  function trace(model, item) {
    var c = null, a = null, orders = [], rets = [];
    if (item.kind === 'order') {
      var o = model.orderById[item.id]; if (o) orders = [o];
      c = item.caseId ? (model.caseById[item.caseId] || null) : null;
      a = item.alertId ? (model.alertById[item.alertId] || null) : null;
    } else if (item.kind === 'case') {
      c = model.caseById[item.id] || null; orders = model.ordersByCase[item.id] || [];
    } else if (item.kind === 'alert') {
      a = model.alertById[item.id] || null; orders = model.ordersByAlert[item.id] || [];
    } else if (item.kind === 'return') {
      c = item.caseId ? (model.caseById[item.caseId] || null) : null; a = item.alertId ? (model.alertById[item.alertId] || null) : null;
      if (c) orders = model.ordersByCase[c.id] || [];
    }
    if (c) rets = model.returnsByCase[c.id] || [];
    if (item.kind === 'return') rets = rets.filter(function (r) { return true; });
    var aid = (c && c.accountId) || (a && a.accountId) || item.accountId || (orders[0] && orders[0].accountId) || null;
    var aname = (c && c.accountName) || (a && a.type !== 'House stock' && a.accountName) || item.accountName || (orders[0] && orders[0].accountName) || '';
    return { case: c, alert: a, orders: orders, returns: rets, account: (aid || aname) ? { id: aid, name: aname } : null };
  }

  return { WINDOWS: WINDOWS, DEFAULT_LEAD_BD: DEFAULT_LEAD_BD, CASE_LIMIT_BD: CASE_LIMIT_BD, build: build, trace: trace, normOrder: normOrder, normReturn: normReturn,
    itemsQty: itemsQty, serialList: serialList, fieldCounts: fieldCounts, orderState: orderState };
});
