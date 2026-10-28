/* ship-logic.js: pure logic for the Accessory board (no DOM, no Zoho). UMD: browser global ShipLogic, Node module.
   Real API names (read from the live org 11 Oct 2026):
   Accessory_Order_Recommendations: Account (lookup), Cadence, Interval_Days, Last_Accessory_Ship_Date, Days_Since_Last,
     Next_Due_Date, Status, Suggested_Order, Last_Shipment_Summary, Shipments_90_Days, Recommendation_Date, Note,
     Last_Contacted_Date, Last_Order_Placed_Date, Handled_By.
   Accessory_Shipments: Account (lookup), Ship_Date, Order_Number, Packing_Slip, Tracking_Number, Is_Accessory,
     Straps, Pin_Trays, Tamper_Plugs, Chargers, Tools, Devices, Quantity, Allied_Customer, Item, Item_Group.
   There is NO direct lookup between the two modules: they join through Account. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShipLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    DUE_GRACE_DAYS: 7,      /* Due = 0..7 days past Next_Due_Date, Overdue = more. Inferred from live rows; see STATUS open question 1. */
    FOLLOWUP_DAYS: 7,       /* Contacted with no order after this many days = chase */
    DEFAULT_INTERVAL: { 'Every other week': 14, 'Monthly': 30 },
    HANDLED: { 'Contacted': 1, 'Ordered': 1, 'No order needed': 1 },
    ITEMS: [['Straps', 'Straps'], ['Pin_Trays', 'Pin Trays'], ['Tamper_Plugs', 'Tamper Plugs'], ['Chargers', 'Chargers'], ['Tools', 'Tools'], ['Devices', 'Devices']]
  };

  /* 'YYYY-MM-DD' (or ISO datetime) -> whole day number (UTC, so no timezone drift). null if blank/bad. */
  function toDay(s) {
    if (s == null || s === '') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  function fromDay(n) {
    if (n == null) return null;
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function num(v) { var n = +v; return v == null || v === '' || !isFinite(n) ? 0 : n; }
  function idOf(x) { return x && typeof x === 'object' ? (x.id != null ? String(x.id) : null) : (x == null || x === '' ? null : String(x)); }

  /* A shipment counts as an accessory shipment when Is_Accessory is true. Device-only rows (Is_Accessory false) are ignored. */
  function isAccessory(s) {
    if (!s) return false;
    if (s.Is_Accessory === false) return false;
    return accessoryUnits(s) > 0 || s.Is_Accessory === true;
  }
  /* Units by type. Quantity on the record equals the sum of the five accessory columns (Devices excluded), checked on live rows. */
  function breakdown(s) {
    var out = [];
    CFG.ITEMS.forEach(function (it) {
      if (it[0] === 'Devices') return;
      var n = num(s[it[0]]);
      if (n > 0) out.push({ key: it[0], label: it[1], n: n });
    });
    return out;
  }
  function accessoryUnits(s) {
    var b = breakdown(s), t = 0;
    b.forEach(function (x) { t += x.n; });
    return t || num(s.Quantity);
  }
  function describeShipment(s) {
    var parts = breakdown(s).map(function (x) { return x.n + ' ' + x.label; });
    if (!parts.length && num(s.Quantity) > 0) parts.push(num(s.Quantity) + ' ' + (s.Item || s.Item_Group || 'accessories'));
    return parts.join(', ') || 'no accessory units';
  }

  /* Group accessory shipments by Account id, newest first. */
  function indexShipments(shipments) {
    var by = {}, unmatched = [];
    (shipments || []).forEach(function (s) {
      if (!isAccessory(s)) return;
      var id = idOf(s.Account);
      if (!id) { unmatched.push(s); return; }
      (by[id] = by[id] || []).push(s);
    });
    Object.keys(by).forEach(function (k) {
      by[k].sort(function (a, b) { return (toDay(b.Ship_Date) || 0) - (toDay(a.Ship_Date) || 0); });
    });
    return { byAccount: by, unmatched: unmatched };
  }

  function intervalOf(rec) {
    var i = num(rec.Interval_Days);
    return i > 0 ? i : (CFG.DEFAULT_INTERVAL[rec.Cadence] || 30);
  }

  /* Derived status from the live shipment list (fresher than the nightly stored Status). */
  function derivedStatus(nextDueDay, todayDay) {
    if (nextDueDay == null) return 'Not due';
    var late = todayDay - nextDueDay;
    if (late < 0) return 'Not due';
    return late <= CFG.DUE_GRACE_DAYS ? 'Due' : 'Overdue';
  }

  /* Full read of one recommendation. ships = that account's accessory shipments (newest first). today = 'YYYY-MM-DD'. */
  function assess(rec, ships, today) {
    ships = ships || [];
    var t = toDay(today);
    var storedLast = toDay(rec.Last_Accessory_Ship_Date);
    var liveLast = ships.length ? toDay(ships[0].Ship_Date) : null;
    var lastDay = liveLast != null && (storedLast == null || liveLast > storedLast) ? liveLast : storedLast;
    var interval = intervalOf(rec);
    var nextDay = lastDay != null ? lastDay + interval : toDay(rec.Next_Due_Date);
    var storedStatus = rec.Status && rec.Status !== '-None-' ? rec.Status : null;
    var handled = !!(storedStatus && CFG.HANDLED[storedStatus]);
    var derived = derivedStatus(nextDay, t);
    var effective = handled ? storedStatus : derived;
    var daysOver = nextDay != null && t > nextDay ? t - nextDay : 0;
    var daysSince = lastDay != null ? t - lastDay : null;

    var recDay = toDay(rec.Recommendation_Date);
    var contactedDay = toDay(rec.Last_Contacted_Date);
    var orderedDay = toDay(rec.Last_Order_Placed_Date);
    /* anchor: the latest of recommendation / contact / order; a shipment after it answers the recommendation */
    var anchor = Math.max(recDay == null ? -Infinity : recDay, contactedDay == null ? -Infinity : contactedDay, orderedDay == null ? -Infinity : orderedDay);
    var since = anchor === -Infinity ? [] : ships.filter(function (s) { var d = toDay(s.Ship_Date); return d != null && d > anchor; });
    var shippedSince = since.length > 0;

    var bucket;
    if (effective === 'No order needed') bucket = 'ok';
    else if (shippedSince && (handled || storedStatus === 'Overdue' || storedStatus === 'Due' || effective === 'Overdue' || effective === 'Due')) bucket = 'shipped';
    else if (effective === 'Overdue') bucket = 'overdue';
    else if (effective === 'Due') bucket = 'due';
    else if (effective === 'Contacted') {
      var age = contactedDay != null ? t - contactedDay : null;
      bucket = (orderedDay == null && (age == null || age > CFG.FOLLOWUP_DAYS)) ? 'chase' : 'waiting';
    } else if (effective === 'Ordered') bucket = 'waiting';
    else bucket = 'ok';

    return {
      id: idOf(rec.id), accountId: idOf(rec.Account), accountName: (rec.Account && rec.Account.name) || rec.Name || '',
      storedStatus: storedStatus, derivedStatus: derived, status: effective, bucket: bucket,
      stale: !handled && storedStatus != null && storedStatus !== derived,
      lastShipDate: fromDay(lastDay), daysSince: daysSince, nextDueDate: fromDay(nextDay), daysOverdue: daysOver,
      interval: interval, shippedSince: shippedSince, shippedSinceList: since,
      shipments90: ships.filter(function (s) { var d = toDay(s.Ship_Date); return d != null && t - d <= 90; }).length,
      lastSummary: ships.length ? fromDay(toDay(ships[0].Ship_Date)) + ': ' + describeShipment(ships[0]) : (rec.Last_Shipment_Summary || ''),
      contactedAgo: contactedDay != null ? t - contactedDay : null
    };
  }

  /* Buckets that need a person today. 'waiting' and 'ok' do not. */
  var NEEDS_ME = { overdue: 1, due: 1, chase: 1, shipped: 1 };
  var RANK = { overdue: 0, chase: 1, due: 2, shipped: 3, waiting: 4, ok: 5 };
  function needsMe(a, me) {
    if (!NEEDS_ME[a.bucket]) return false;
    if (!me) return true;
    return !a.handledById || a.handledById === me;   /* unassigned work shows for everyone */
  }
  function sortWork(list) {
    return list.slice().sort(function (x, y) {
      if (RANK[x.bucket] !== RANK[y.bucket]) return RANK[x.bucket] - RANK[y.bucket];
      return (y.daysOverdue || 0) - (x.daysOverdue || 0);
    });
  }
  /* Count client-side (COQL group by count fails on this org). */
  function countBuckets(list) {
    var c = { overdue: 0, due: 0, chase: 0, shipped: 0, waiting: 0, ok: 0, needs: 0, total: list.length };
    list.forEach(function (a) { c[a.bucket] += 1; if (NEEDS_ME[a.bucket]) c.needs += 1; });
    return c;
  }
  /* Build board rows from the two raw lists. */
  function build(recs, shipments, today) {
    var idx = indexShipments(shipments);
    var rows = (recs || []).map(function (r) {
      var a = assess(r, idx.byAccount[idOf(r.Account)] || [], today);
      a.rec = r;
      a.handledById = idOf(r.Handled_By);
      a.handledByName = r.Handled_By && r.Handled_By.name ? r.Handled_By.name : '';
      a.suggested = r.Suggested_Order || '';
      a.units = r.Program_Units == null ? null : +r.Program_Units;
      a.cadence = r.Cadence || '';
      a.note = r.Note || '';
      a.ships = idx.byAccount[idOf(r.Account)] || [];
      a.vendorId = idOf(r.Order_Vendor);
      a.orderRef = r.Order_Reference || '';
      return a;
    });
    return { rows: sortWork(rows), unmatched: idx.unmatched, counts: countBuckets(rows) };
  }

  /* ---------- ordering (added 11 Oct 2026) ----------
     Vendors (Vendors module) carry how they take accessory orders:
       Accessory_Order_Method  picklist: Portal | Emailed form   (new field)
       Customer_Portal         existing field, the portal link for Portal vendors
       Accessory_Order_Email   new field, where the emailed form goes
       Accessory_Order_Template  new text field, the template name or file to attach
     The board never logs in to a portal and never sends email. Staff do both; the board only prepares and records. */
  var METHOD = { 'portal': 'portal', 'emailed form': 'form', 'email': 'form', 'email account manager': 'email' };
  function safeUrl(u) {
    var t = String(u == null ? '' : u).trim();
    if (!t) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = 'https://' + t;
    return /^https?:\/\/[^\s]+$/i.test(t) ? t : '';
  }
  function safeEmail(e) {
    var t = String(e == null ? '' : e).trim();
    return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(t) ? t : '';
  }
  /* Devices: Vendors also carry Device_Order_Method (Same as accessories | Portal | Emailed form | Email account manager; blank = same),
     Device_Order_Email (the form address or the account manager), Device_Order_Contact (account manager name), Device_Order_Template. */
  function normVendor(v) {
    if (!v) return null;
    var m = METHOD[String(v.Accessory_Order_Method || '').trim().toLowerCase()] || 'unset';
    var dm = METHOD[String(v.Device_Order_Method || '').trim().toLowerCase()] || 'same';
    return { id: idOf(v.id), name: v.Vendor_Name || v.name || '', method: m, portalUrl: safeUrl(v.Customer_Portal),
      email: safeEmail(v.Accessory_Order_Email), template: v.Accessory_Order_Template || '',
      deviceMethod: dm, deviceEmail: safeEmail(v.Device_Order_Email), deviceTemplate: v.Device_Order_Template || '',
      deviceContact: v.Device_Order_Contact || '' };
  }
  function normVendors(list) {
    return (list || []).map(normVendor).filter(Boolean).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  /* The ordering method for one order type. Accessories use the Accessory_* fields; Devices use the Device_* fields unless the
     vendor says "same as accessories" (blank also means same). */
  function methodFor(vendor, type) {
    if (type !== 'Devices' || vendor.deviceMethod === 'same') return { method: vendor.method, email: vendor.email, template: vendor.template, contact: '' };
    return { method: vendor.deviceMethod, email: vendor.deviceEmail, template: vendor.deviceTemplate, contact: vendor.deviceContact };
  }
  /* Active Products as a device-model list for one vendor. Product names end " - <Vendor>" (e.g. "1 Piece GPS - Allied"); retired
     products are Product_Active = false. A product matches when its suffix is the start of the vendor name, either way round. */
  function deviceModels(products, vendor) {
    var v = vendor ? String(vendor.name || '').toLowerCase() : '';
    var out = [];
    (products || []).forEach(function (p) {
      if (!p || p.Product_Active === false || !p.Product_Name) return;
      var nm = String(p.Product_Name), i = nm.lastIndexOf(' - '), suf = i >= 0 ? nm.slice(i + 3).toLowerCase() : '';
      var model = i >= 0 ? nm.slice(0, i) : nm;
      if (!v || (suf && (v.indexOf(suf) === 0 || suf.indexOf(v) === 0))) out.push(model);
    });
    return out.filter(function (m, k) { return out.indexOf(m) === k; }).sort();
  }
  /* The Buddi and SuperCom order forms (Word files supplied 11 Oct 2026) list their own lines, so for those vendors the item
     choices are the form's lines, not the generic accessory list. Line names are copied from the forms. */
  var FORMS = [
    { key: 'buddi', test: /buddi/i, form: 'Buddi US Order Form - blank.docx', groups: [
      { name: 'Main equipment', lines: ['Smart Tag', 'Smart Tag OBC - Wireless', 'Smart Tag OBC - Tethered', 'Smart Tag OBC Dock', 'AlcoTag', 'AlcoTag On Body Charger', 'AlcoTag Charger dock', 'Smart Beacon', 'SureTag', 'SureTag Charger', 'RF Beacon', 'Buddi Mini', 'Buddi Mini ID', 'Buddi Mini Charging Cord (Mini/ID)', 'Buddi Victim Clip', 'Buddi Victim Clip Charger', 'TRAC Mobile Breathalyzer'] },
      { name: 'Straps by size', lines: ['Strap 7.5"', 'Strap 8"', 'Strap 8.5"', 'Strap 9"', 'Strap 9.5"', 'Strap 10"', 'Strap 10.5"', 'Strap 11"', 'Strap 11.5"', 'Strap 12"', 'Strap 12.5"', 'Strap 13"', 'Strap 14"', 'Strap 15"', 'Strap 16"', 'Strap 17"', 'Strap 18"'] },
      { name: 'Accessories', lines: ['Release Tool - AlcoTag', 'Release Tool - Smart Tag', 'Release Tool - SureTag', 'Docking Station - Smart Tag', 'Docking Station - AlcoTag', 'Docking Station - Charging Cable'] },
      { name: 'Strap components', lines: ['Tamper Locking Plates (AlcoTag & Smart Tag)', 'Tamper Locking Plates (SureTag)', 'Ankle Measurer'] } ] },
    { key: 'supercom', test: /supercom/i, form: 'SuperCom Equipment Order.docx', groups: [
      { name: 'Equipment requested', lines: ['PureOne Unit Kit (1 PureOne, 1 Wall Charger, Two Strap/Clip Kits)', 'PureOne (Device only)', 'PureOne Wall Charger', 'PureOne Mobile Charger', 'Strap Kit (1 strap, 1 set of clips)', 'PureOne Installation Kit', 'PureBeacon', 'PureShield', 'PureOne Charging Cord (only)', 'Guillotine Strap Cutters'] } ] }
  ];
  function formCatalog(vendor) {
    if (!vendor) return null;
    for (var i = 0; i < FORMS.length; i++) if (FORMS[i].test.test(String(vendor.name || ''))) return FORMS[i];
    return null;
  }
  /* true when this vendor takes this order type on its Word form (so the form's lines apply) */
  function usesForm(vendor, type) {
    var cat = formCatalog(vendor);
    if (!cat) return null;
    var m = methodFor(vendor, type);
    return m.method === 'form' ? cat : null;
  }
  /* ---------- house stock position (added 11 Oct 2026) ----------
     The stock count is a snapshot taken at 7am (Count_Date on the House stock alert), not live. Receiving a device order does NOT write
     a count; this only works out what has arrived since the snapshot so the number on screen is not stale:
       received since the count = device orders marked received after Count_Date 07:00 (org time) with no Ship To (so they came to house stock)
       on order = device orders still Placed with no Ship To
     Once the next 7am count runs, those orders are older than the new cutoff and drop out by themselves. */
  var COUNT_HOUR = 7, COUNT_TZ = 'America/Chicago';
  function tzOffsetMin(utcMs, tz) {   /* minutes the zone is ahead of UTC at that instant */
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)), o = {};
    parts.forEach(function (p) { o[p.type] = +p.value; });
    return (Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(utcMs / 1000) * 1000) / 60000;
  }
  function countCutoffMs(countDate, hour, tz) {   /* instant of "countDate at hour:00" in tz */
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(countDate || '')); if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], hour == null ? COUNT_HOUR : hour, 0, 0);
    return guess - tzOffsetMin(guess, tz || COUNT_TZ) * 60000;
  }
  function orderUnits(o) {
    if (o.Received_Qty != null && o.Received_Qty !== '' && isFinite(+o.Received_Qty) && o.Order_Status === 'Received') return Math.max(0, Math.floor(+o.Received_Qty));
    var n = 0; String(o.Items || '').split(/;\s*/).forEach(function (seg) { var m = /^(\d+)\s/.exec(seg.trim()); if (m) n += +m[1]; });
    return n;
  }
  function stockPosition(alerts, orders) {
    var house = (alerts || []).filter(function (a) { return a && a.Alert_Type === 'House stock'; })
      .sort(function (a, b) { return String(b.Count_Date || '').localeCompare(String(a.Count_Date || '')); })[0];
    if (!house) return null;
    var cut = countCutoffMs(house.Count_Date), recv = 0, onOrder = 0, recvN = 0, ordN = 0;
    (orders || []).forEach(function (o) {
      if (!o || o.Order_Type !== 'Devices' || o.Order_Status === 'Cancelled' || (o.Ship_To && String(o.Ship_To).trim())) return;
      if (o.Order_Status === 'Received') {
        var t = Date.parse(o.Received_At || '');
        var after = isFinite(t) ? t > cut : (o.Received_Date && String(o.Received_Date) > String(house.Count_Date));   /* no time recorded: date after the count day */
        if (after) { recv += orderUnits(o); recvN += 1; }
      } else { onOrder += orderUnits(o); ordN += 1; }
    });
    var spare = +house.Spare_Units || 0, target = +house.Threshold || 0;
    return { countDate: house.Count_Date, spare: spare, target: target, suggested: +house.Suggested_Order || 0, receivedSince: recv, receivedOrders: recvN,
      onOrder: onOrder, onOrderOrders: ordN, withReceived: spare + recv, ifOnOrderArrives: spare + recv + onOrder,
      covered: target > 0 && spare + recv >= target, coveredIfArrives: target > 0 && spare + recv + onOrder >= target };
  }
  /* "31 Chargers; 8 Devices. Straps, Tamper Plugs - please ask customer for quantities"
     -> items [{qty:31,name:'Chargers'},{qty:8,name:'Devices'}], askItems ['Straps','Tamper Plugs'] */
  function orderLines(suggested) {
    var out = { items: [], askItems: [] };
    String(suggested || '').split(/[;.]\s*/).forEach(function (seg) {
      seg = seg.trim();
      if (!seg) return;
      var m = /^(\d+)\s+(.+)$/.exec(seg);
      if (m) { out.items.push({ qty: +m[1], name: m[2].trim() }); return; }
      var names = seg.replace(/\s+-\s+.*$/, '').split(/,\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
      names.forEach(function (n) { out.askItems.push(n); });
    });
    return out;
  }
  function linesText(lines) {
    var rows = lines.items.map(function (i) { return i.qty + ' x ' + i.name; });
    lines.askItems.forEach(function (n) { rows.push(n + ' (quantity to confirm with the customer)'); });
    return rows.join('\n');
  }
  function orderPlan(a, vendor, today, type, shipTo) {
    type = type === 'Devices' ? 'Devices' : 'Accessories';
    var noun = type === 'Devices' ? 'device' : 'accessory';
    var lines = orderLines(a.suggested), text = linesText(lines);
    if (shipTo && String(shipTo).trim()) text += (text ? '\n' : '') + 'Ship to: ' + String(shipTo).trim().replace(/\s*\n\s*/g, ', ');
    var plan = { type: type, vendorId: vendor ? vendor.id : null, vendorName: vendor ? vendor.name : '', kind: 'choose', ready: false, problem: '',
      lines: lines, copyText: text, portalUrl: '', email: '', contact: '', subject: '', body: '', mailto: '', template: '' };
    if (!vendor) { plan.problem = 'Choose the vendor this customer orders from.'; return plan; }
    var m = methodFor(vendor, type);
    if (m.method === 'unset') { plan.kind = 'unset'; plan.problem = vendor.name + ' has no ' + noun + ' ordering method yet. Set it on the Vendor record.'; return plan; }
    if (!lines.items.length && !lines.askItems.length) { plan.kind = m.method; plan.problem = 'This recommendation has no suggested order to send.'; return plan; }
    if (m.method === 'portal') {
      plan.kind = 'portal'; plan.portalUrl = vendor.portalUrl;
      if (!vendor.portalUrl) plan.problem = vendor.name + ' has no portal link. Add it to Customer Portal on the Vendor record.';
      plan.ready = !plan.problem;
      return plan;
    }
    plan.kind = 'form'; plan.email = m.email; plan.contact = m.contact; plan.template = m.method === 'email' ? '' : m.template; plan.formless = m.method === 'email';
    plan.subject = (type === 'Devices' ? 'Device' : 'Accessory') + ' order for ' + a.accountName + ' (' + (today || '') + ')';
    plan.body = 'Hello' + (m.contact ? ' ' + m.contact : '') + ',\n\nPlease process this ' + noun + ' order for ' + a.accountName + ':\n\n' + text + '\n\n' +
      (plan.template ? 'The completed order form is attached.\n\n' : '') + 'Thank you.';
    if (!m.email) plan.problem = vendor.name + ' has no ' + noun + ' order contact. Add ' + (type === 'Devices' && vendor.deviceMethod !== 'same' ? 'Device Order Email' : 'Accessory Order Email') + ' on the Vendor record.';
    plan.ready = !plan.problem;
    plan.mailto = plan.email ? 'mailto:' + encodeURIComponent(plan.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(plan.subject) + '&body=' + encodeURIComponent(plan.body) : '';
    return plan;
  }
  /* Payload for the accessory_order function (13 string arguments).
     action: 'vendor' (remember the vendor on the recommendation), 'ordered' (record an order), 'received' (mark an order received, orderId required).
     source: 'Recommendation' | 'Case' | 'Manual'. recId only for source Recommendation; caseId only for source Case. */
  function orderPayload(o) {
    o = o || {};
    var act = o.action === 'ordered' || o.action === 'received' ? o.action : 'vendor';
    var src = o.source === 'Recommendation' || o.source === 'Case' ? o.source : (o.recId ? 'Recommendation' : (o.caseId ? 'Case' : 'Manual'));
    return { recId: o.recId ? String(o.recId) : '', vendorId: o.vendorId ? String(o.vendorId) : '', action: act,
      reference: o.reference ? String(o.reference).trim() : '', items: o.items ? String(o.items).trim() : '',
      accountId: o.accountId ? String(o.accountId) : '', caseId: o.caseId ? String(o.caseId) : '', source: src, orderId: o.orderId ? String(o.orderId) : '',
      receivedQty: o.receivedQty != null && isFinite(+o.receivedQty) && +o.receivedQty >= 0 ? String(Math.floor(+o.receivedQty)) : '', serials: o.serials ? String(o.serials).trim().slice(0, 2000) : '',
      orderType: o.orderType === 'Devices' ? 'Devices' : 'Accessories', shipTo: o.shipTo ? String(o.shipTo).trim().slice(0, 300) : '' };
  }
  /* Item rows typed on the reactive Order area: [{qty, item, other}] -> "31 Chargers; 8 Tools". Rows with no quantity are dropped. */
  var ITEM_CHOICES = ['Straps', 'Pin Trays', 'Tamper Plugs', 'Chargers', 'Tools'];
  function cleanRows(rows) {
    return (rows || []).map(function (r) {
      var q = Math.floor(+r.qty), name = String(r.item === '__other' ? (r.other || '') : (r.item || '')).trim();
      return { qty: q, name: name };
    }).filter(function (r) { return isFinite(r.qty) && r.qty > 0 && r.qty < 100000 && r.name && !/[;]/.test(r.name); });
  }
  function rowsToSuggested(rows) { return cleanRows(rows).map(function (r) { return r.qty + ' ' + r.name; }).join('; '); }
  function canOrder(a) { return a.status !== 'Ordered' && a.status !== 'No order needed'; }

  /* Payload for the Mark contacted function. */
  function markPayload(recId, note) { return { recId: String(recId), note: note ? String(note) : '' }; }

  return { CFG: CFG, toDay: toDay, fromDay: fromDay, idOf: idOf, isAccessory: isAccessory, breakdown: breakdown,
    accessoryUnits: accessoryUnits, describeShipment: describeShipment, indexShipments: indexShipments,
    intervalOf: intervalOf, derivedStatus: derivedStatus, assess: assess, needsMe: needsMe, sortWork: sortWork,
    countBuckets: countBuckets, build: build, markPayload: markPayload,
    safeUrl: safeUrl, safeEmail: safeEmail, normVendor: normVendor, normVendors: normVendors, orderLines: orderLines,
    deviceModels: deviceModels, stockPosition: stockPosition, countCutoffMs: countCutoffMs, formCatalog: formCatalog, usesForm: usesForm, FORMS: FORMS, linesText: linesText, orderPlan: orderPlan, orderPayload: orderPayload, canOrder: canOrder,
    ITEM_CHOICES: ITEM_CHOICES, cleanRows: cleanRows, rowsToSuggested: rowsToSuggested };
});
