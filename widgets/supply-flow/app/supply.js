/* Supply flow widget (Equipment + Stock + Accessories). Uses jpk v1.1.0, TriageModel, EquipModel, StockFlowModel, SupplyModel and, when no Zoho SDK, SupplyDemo.
   Read-only: COQL reads of Vendor_Orders, Cases, EM_Stock_Alerts, Accessory_Order_Recommendations, Daily_Unit_Counts, Accessory_Shipments and (optional) Device_Returns.
   Nothing is written. */
(function () {
  'use strict';
  var M = window.SupplyModel, J = window.JPK;
  var ORDER_COMMON = 'id, Order_Type, Order_Status, Order_Date, Received_Date, Received_At, Received_Qty, Method, Source, Reference, Case, Recommendation, Vendor, Account';
  /* Tried in this order. Each step that fails switches off only what it needed and says so in the footer. */
  var ORDER_TRIES = [
    { q: 'select ' + ORDER_COMMON + ', Items, Ship_To, Serial_Numbers, Stock_Alert from Vendor_Orders where id is not null order by id asc', alertLink: true, detail: true },
    { q: 'select ' + ORDER_COMMON + ', Items, Ship_To, Serial_Numbers from Vendor_Orders where id is not null order by id asc', alertLink: false, detail: true },
    { q: 'select ' + ORDER_COMMON + ' from Vendor_Orders where id is not null order by id asc', alertLink: false, detail: false }
  ];
  var CASE_Q = 'select id, Case_Number, Subject, Status, Created_Time, Case_Category, Account_Name from Cases where Case_Category = \'Order Device(s)\' order by id asc';
  var ALERT_Q = 'select id, Name, Alert_Type, Account, Status, Email_Status, Resolution, Suggested_Order, Suggested_Return, Spare_Units, Assigned_Units, Threshold, Device_Family, Email_Sent_At, Last_Seen, Created_Time, Modified_Time from EM_Stock_Alerts where id is not null order by id asc';
  var REC_Q = 'select id, Name, Account, Status, Handled_By, Next_Due_Date, Last_Contacted_Date, Last_Order_Placed_Date, Recommendation_Date, Suggested_Order, Order_Vendor from Accessory_Order_Recommendations where id is not null order by id asc';
  var HISTORY_DAYS = 365;      /* how far back the shipment history is read: enough to see a year of months */
  function shipTries(now) {
    var since = new Date(now - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
    var w = ' from Accessory_Shipments where Is_Accessory = true and Ship_Date >= \'' + since + '\' order by id asc';
    return [{ q: 'select id, Ship_Date, Account, Allied_Customer, Recommendation' + w, shipLink: true }, { q: 'select id, Ship_Date, Account, Allied_Customer' + w, shipLink: false }];
  }
  function countQ(now) {
    var d = new Date(now - 8 * 86400000).toISOString().slice(0, 10);
    return 'select id, Count_Date, Device_Family, On_Leg, Spare, Total_Units from Daily_Unit_Counts where Count_Date >= \'' + d + '\' order by id asc';
  }
  var RETURN_Q = 'select id, Name, Return_Type, Return_Status, Account, Case, Stock_Alert, Vendor, Device_Family, Quantity, Vendor_RMA_Number, Requested_Date, Shipped_Date, Received_Date, Outcome, Created_Time from Device_Returns where id is not null order by id asc';
  var ENTITY = { case: 'Cases', account: 'Accounts', order: 'Vendor_Orders', alert: 'EM_Stock_Alerts', return: 'Device_Returns', rec: 'Accessory_Order_Recommendations', ship: 'Accessory_Shipments' };
  var drawerClick = null;
  var state = { demo: false, orders: [], cases: [], alerts: [], counts: [], returns: [], recs: [], ships: [], notes: [], alertLink: false, shipLink: false, detail: true, returnsAvailable: false,
    now: Date.now(), days: 30, leadBD: M.DEFAULT_LEAD_BD, track: 'all', model: null, lane: null, nx: null, table: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }
  function qs(k) { var m = new RegExp('[?&]' + k + '=1').exec(location.search); return !!m; }

  /* ---------- data ---------- */
  function firstThatWorks(tries, apply) {
    var i = 0, last;
    function next() {
      if (i >= tries.length) return Promise.reject(last);
      var t = tries[i++];
      return J.crm.coqlAll(t.q).then(function (r) { apply(r, t); }, function (e) { last = e; return next(); });
    }
    return next();
  }
  function load() {
    state.now = Date.now(); state.notes = [];
    if (state.demo) {
      var d = window.SupplyDemo.make(state.now, { stale: qs('stale') });
      state.orders = d.orders; state.cases = d.cases; state.alerts = d.alerts; state.counts = d.counts; state.returns = d.returns; state.recs = d.recs; state.ships = d.ships;
      state.alertLink = true; state.shipLink = true; state.detail = true; state.returnsAvailable = true; return Promise.resolve();
    }
    return Promise.all([
      firstThatWorks(ORDER_TRIES, function (r, t) { state.orders = r; state.alertLink = t.alertLink; state.detail = t.detail; }).then(function () {
        if (!state.alertLink) state.notes.push('Vendor Orders has no Stock Alert link yet, so alerts cannot be matched to orders.');
        if (!state.detail) state.notes.push('Items, Ship To and Serial Numbers could not be read, so the serial, quantity and sent-on checks are off.');
      }, function (e) { throw new Error('Vendor Orders: ' + msg(e)); }),
      J.crm.coqlAll(ALERT_Q).then(function (r) { state.alerts = r; }, function (e) { throw new Error('Stock Alerts: ' + msg(e)); }),
      J.crm.coqlAll(REC_Q).then(function (r) { state.recs = r; }, function (e) { state.recs = []; state.notes.push('Accessory recommendations could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(CASE_Q).then(function (r) { state.cases = r; }, function (e) { state.cases = []; state.notes.push('Cases could not be read (' + msg(e) + '), so device requests are not shown.'); }),
      J.crm.coqlAll(countQ(state.now)).then(function (r) { state.counts = r; }, function (e) { state.counts = []; state.notes.push('Daily Unit Counts could not be read (' + msg(e) + ').'); }),
      firstThatWorks(shipTries(state.now), function (r, t) { state.ships = r; state.shipLink = t.shipLink; }).then(function () {
        if (!state.shipLink) state.notes.push('Accessory Shipments has no Recommendation link yet, so unlinked shipments are not listed.');
      }, function (e) { state.ships = []; state.notes.push('Accessory Shipments could not be read (' + msg(e) + '), so the order history cannot be checked.'); }),
      J.crm.coqlAll(RETURN_Q).then(function (r) { state.returns = r; state.returnsAvailable = true; },
        function () { state.returns = []; state.returnsAvailable = false; state.notes.push('The Device Returns module is not set up yet, so returns are not shown and every excess alert reads as having no return.'); })
    ]);
  }

  /* ---------- render ---------- */
  function segButtons(sel, list, cur, attr) {
    $(sel).innerHTML = list.map(function (w) {
      return '<button type="button" data-' + attr + '="' + w.id + '" aria-pressed="' + (w.id === cur) + '">' + J.esc(w.label) + '</button>';
    }).join('');
  }
  function curWin() { return M.WINDOWS.filter(function (w) { return w.days === state.days; })[0].id; }
  function laneButton(l) {
    return '<button type="button" class="lane" data-lane="' + J.esc(l.id) + '" aria-pressed="' + (state.lane === l.id) + '">' +
      '<span class="ln">' + J.esc(l.label) + (l.hint ? '<small>' + J.esc(l.hint) + '</small>' : '') + '</span>' +
      '<span class="lc' + tone(l.tone) + '">' + l.count + '</span></button>';
  }
  function renderFlow() {
    var m = state.model;
    $('#flow').innerHTML = m.stages.map(function (s) {
      return '<li class="stage" data-n="' + s.n + '"><h2><span class="n">' + s.n + '</span>' + J.esc(s.title) + '</h2>' +
        '<div class="big">' + (s.big == null ? '&ndash;' : J.esc(s.big)) + '</div><div class="biglab">' + J.esc(s.bigLabel) + '</div>' +
        s.lanes.map(function (id) { return laneButton(m.lanes[id]); }).join('') + '</li>';
    }).join('');
  }
  function renderStrip() {
    var s = state.model.stuck;
    if (s.length) {
      var more = s.length > 1 ? 'Also: ' + s.slice(1, 3).map(function (x) { return x.text; }).join('; ') + (s.length > 3 ? '; and ' + (s.length - 3) + ' more.' : '.') : 'Click it to see the records.';
      state.nx.update({ title: s[0].text.charAt(0).toUpperCase() + s[0].text.slice(1) + '.', sub: more, progress: null,
        button: { label: 'Show them', onClick: function () { selectLane(s[0].lane, true); } } });
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No late orders, unactioned alerts, missing serials, stale returns or gaps in the accessory history in this view.', progress: 100, button: null });
  }
  function renderHeader() {
    var m = state.model, t = m.totals, h = m.house, hist = m.history;
    var hs = h && h.spare != null ? ' House stock: ' + h.spare + ' spare' + (h.threshold != null ? ' against a floor of ' + h.threshold : '') + '.' : '';
    var hh = hist.count ? ' Accessory history: ' + hist.count + ' shipments, newest ' + new Date(hist.newestMs).toLocaleDateString([], { month: 'short', day: 'numeric' }) + (hist.stale ? ' (old)' : '') + '.' : ' No accessory history loaded.';
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' +
      t.placedDevices + ' device ' + (t.placedDevices === 1 ? 'order' : 'orders') + ' and ' + t.accessoryOrdersPlaced + ' accessory ' + (t.accessoryOrdersPlaced === 1 ? 'order' : 'orders') + ' placed, not received; ' +
      t.openAlerts + ' open ' + (t.openAlerts === 1 ? 'alert' : 'alerts') + '.' + hs + hh;
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Open alerts, placed orders and open returns are always all of them; received, shipped and closed follow the window. Quantity ordered is read from the Items text. Business days skip weekends; holidays are not skipped. ' +
      'The device order limit of ' + state.leadBD + ' business days is a starting guess, not a vendor lead time. Accessory alerts and due dates depend on the imported shipment history (read back ' + (365) + ' days); a history whose newest shipment is over ' + M.HISTORY_STALE_DAYS + ' days old is flagged, and that number is also a guess. ' +
      'Two lanes from the old pages are not repeated here because they list the same records: stock alerts asking for devices, and returns requested from an alert.';
  }

  var KIND = { alert: 'Alert', rec: 'Accessories', order: 'Order', case: 'Case', return: 'Return', ship: 'Shipment', hist: 'Month', 'hist-acct': 'Account', family: 'Device family' };
  function columns(kind) {
    if (kind === 'family') {
      return [
        { key: 'title', label: 'Device family', sortable: true, sortValue: function (i) { return i.title; }, render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>'; } },
        { key: 'on', label: 'On leg', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.onLeg; }, render: function (i) { return String(i.onLeg); } },
        { key: 'sp', label: 'Spare', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.spare; }, render: function (i) { return String(i.spare) + (i.dSpare ? ' (' + (i.dSpare > 0 ? '+' : '') + i.dSpare + ')' : ''); } },
        { key: 'tot', label: 'Total', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.total; }, render: function (i) { return J.chip(i.state, i.tone); } }
      ];
    }
    var c = [
      { key: 'title', label: KIND[kind] || 'Record', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">' + (kind === 'hist' ? 'All accounts' : 'House stock or none') + '</span>'; } },
      { key: 'when', label: kind === 'hist' ? 'Month' : kind === 'rec' ? 'Due or contacted' : kind === 'return' ? 'Requested' : kind === 'hist-acct' ? 'Last shipment' : 'Date', sortable: true, num: true, sortValue: function (i) { return i.ms; },
        render: function (i) { return J.esc(kind === 'hist' ? new Date(i.ms).toLocaleDateString([], { month: 'short', year: 'numeric' }) : when(i.ms)); } },
      { key: 'age', label: 'Age', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.age == null ? -1 : i.age; }, render: function (i) { return '<span class="age">' + J.esc(i.ageText) + '</span>'; } }
    ];
    if (kind === 'order') c.push({ key: 'case', label: 'Case', sortable: true, sortValue: function (i) { return i.caseNumber || ''; }, render: function (i) { return i.caseNumber ? J.esc(i.caseNumber) : '<span class="muted">None</span>'; } });
    c.push({ key: 'state', label: 'Status', sortable: true, sortValue: function (i) { return i.state; }, render: function (i) { return J.chip(i.state, i.tone); } });
    return c;
  }
  var FT = null;
  function shown(l) { var r = FT ? FT.filter(l.items) : l.items; if (FT) FT.note(r.length, l.items.length); return r; }
  function renderLane() {
    var m = state.model, l = m.lanes[state.lane];
    if (!l) { $('#lane-title').textContent = 'Pick a step above'; $('#lane-hint').textContent = ''; $('#lane-table').innerHTML = ''; return; }
    $('#lane-title').textContent = 'Step ' + l.stage + ': ' + l.label + ' (' + l.count + ')';
    $('#lane-hint').textContent = l.hint && (l.count || l.kind === 'hist') ? l.hint : '';
    state.table = J.table({ mount: '#lane-table', columns: columns(l.kind), rows: shown(l), caption: l.label, onRowClick: detail,
      empty: { title: 'Nothing here', hint: l.hint || 'No records in this step for the chosen window.' } });
  }
  function selectLane(id, scroll) {
    state.lane = id; renderFlow(); renderLane();
    if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function recompute() {
    state.model = M.build({ orders: state.orders, cases: state.cases, alerts: state.alerts, counts: state.counts, returns: state.returns, recs: state.recs, ships: state.ships }, state.now,
      { days: state.days, leadBD: state.leadBD, track: state.track, alertLink: state.alertLink, shipLink: state.shipLink, detail: state.detail, returnsAvailable: state.returnsAvailable });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 's-dev';
    segButtons('#win', M.WINDOWS, curWin(), 'w'); segButtons('#track', M.TRACKS, state.track, 't');
    renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- detail drawer: the path for one record ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the ' + kind + ' record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function none(t) { return '<div class="none">' + t + '</div>'; }
  function returnRows(list) {
    return list.map(function (r) {
      return '<div class="it"><b>' + J.esc((r.type || 'Return') + (r.family ? ': ' + r.family : '') + (r.qty != null ? ' x' + r.qty : '')) + '</b>' +
        '<div class="meta">' + J.esc([r.vendorName, r.rma ? 'RMA ' + r.rma : 'No RMA number', r.requestedMs ? 'Requested ' + when(r.requestedMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div>' + J.chip(r.status, r.open ? 'info' : 'good') + btn('open-return', r.id, 'Open return') + '</div></div>';
    }).join('');
  }
  function alertRow(a) {
    return '<div class="it"><b>' + J.esc((a.type || 'Stock alert') + (a.accountName && a.kind !== 'house' && a.type !== 'House stock' ? ' - ' + a.accountName : '')) + '</b><div class="meta">' +
      J.esc([a.family, a.spare != null ? a.spare + ' spare' : '', a.threshold != null ? 'floor ' + a.threshold : '', (a.order || a.suggestedOrder) > 0 ? 'suggests sending ' + (a.order || a.suggestedOrder) : '',
        (a.ret || a.suggestedReturn) > 0 ? 'suggests taking back ' + (a.ret || a.suggestedReturn) : ''].filter(Boolean).join(' · ')) + '</div>' +
      '<div>' + J.chip(a.email || a.emailStatus || a.status, 'info') + btn('open-alert', a.id, 'Open alert') + '</div></div>';
  }
  function accountRow(t) {
    return '<li><div class="lh">Account</div>' + (t.account ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b>' + (t.account.id ? '<div>' + btn('open-account', t.account.id, 'Open account').trim() + '</div>' : '') + '</div>'
      : none('No account: this went to house stock or the record has no customer.')) + '</li>';
  }
  /* devices: need -> order -> received and sent -> returns -> account */
  function eqPath(t) {
    var need = '';
    if (t.case) need += '<div class="it"><b>' + J.esc((t.case.number ? t.case.number + ' ' : '') + t.case.subject) + '</b><div class="meta">' + J.esc([t.case.category, t.case.status].filter(Boolean).join(' / ')) + '</div>' +
      '<div>' + J.chip(t.case.status || 'No status', t.case.open ? 'info' : 'good') + btn('open-case', t.case.id, 'Open case') + '</div></div>';
    if (t.alert) need += alertRow(t.alert);
    if (!need) need = none('No case or stock alert is linked, so nothing says why this was ordered. Fill Case (or Stock Alert) on the order.');
    var orders = !t.orders.length ? ((t.case || t.alert) ? '<div class="it"><b>No order recorded</b><div class="meta">Use Order for this customer on the case, or Mark ordered on the stock alert. The order links back here.</div></div>' : none('No order.'))
      : t.orders.map(function (o) {
        return '<div class="it"><b>' + J.esc((o.vendorName || 'Vendor not set') + ': ' + (o.items || 'devices').replace(/\s*\n\s*/g, '; ')) + '</b>' +
          '<div class="meta">' + J.esc([o.reference ? 'Ref ' + o.reference : 'No reference', o.method, o.orderMs ? 'Ordered ' + when(o.orderMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
          '<div>' + J.chip(o.status, o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info') + btn('open-order', o.id, 'Open order') + '</div></div>';
      }).join('');
    var rec = t.orders.filter(function (o) { return o.status === 'Received'; });
    var recHtml = !rec.length ? none(t.orders.length ? 'Not received yet.' : 'Nothing to receive until an order is recorded.') : rec.map(function (o) {
      var bits = [o.receivedMs ? 'Received ' + when(o.receivedMs) : '', o.receivedQty != null ? o.receivedQty + ' units' : 'quantity not recorded',
        o.serials.length ? o.serials.length + ' serial numbers' : 'no serial numbers', o.house ? 'to house stock' : 'sent to ' + o.shipTo.split('\n')[0]];
      var warn = '';
      if (state.detail && !o.serials.length) warn = '<div class="note-bad">No serial numbers were recorded.</div>';
      else if (state.detail && o.receivedQty != null && o.serials.length !== o.receivedQty) warn = '<div class="note-bad">' + o.serials.length + ' serials for ' + o.receivedQty + ' received.</div>';
      if (t.case && t.case.open) warn += '<div class="note-bad">The case is still open.</div>';
      return '<div class="it"><b>' + J.esc(o.vendorName || 'Order') + '</b><div class="meta">' + J.esc(bits.filter(Boolean).join(' · ')) + '</div>' + warn + '</div>';
    }).join('');
    var rets = !state.returnsAvailable ? none('The Device Returns module is not set up yet.') : !t.returns.length ? none('No return recorded for this case.') : returnRows(t.returns);
    return '<ol class="chain"><li><div class="lh">Need</div>' + need + '</li><li><div class="lh">Ordered</div>' + orders + '</li><li><div class="lh">Received and sent on</div>' + recHtml + '</li><li><div class="lh">Returns</div>' + rets + '</li>' + accountRow(t) + '</ol>';
  }
  /* alerts and accessories: signal -> decision -> action -> fulfilment -> account */
  function stPath(t) {
    var sig = '';
    if (t.alert) sig += alertRow(t.alert);
    if (t.rec) {
      var c = t.rec;
      sig += '<div class="it"><b>Accessories for ' + J.esc(c.accountName) + '</b><div class="meta">' + J.esc([c.suggested ? 'Suggested ' + c.suggested : '', c.nextMs ? 'Next due ' + when(c.nextMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div>' + J.chip(c.status, c.bucket === 'overdue' || c.bucket === 'chase' ? 'warn' : 'info') + btn('open-rec', c.id, 'Open recommendation') + '</div></div>';
    }
    if (!sig) sig = none('No alert or recommendation is linked.');
    var dec = '';
    if (t.alert) {
      var a = t.alert, bits = [a.email ? 'Email: ' + a.email : 'No email status', a.sentMs ? 'sent ' + when(a.sentMs) : '', a.resolution ? 'Resolution: ' + a.resolution : ''].filter(Boolean);
      dec += '<div class="it"><b>' + J.esc({ approve: 'Waiting for approval', action: 'Needs action', waiting: 'Waiting on customer', done: 'Done', dismissed: 'Dismissed' }[a.lane] || a.lane) + '</b><div class="meta">' + J.esc(bits.join(' · ')) + '</div></div>';
    }
    if (t.rec) {
      var r = t.rec, b2 = [r.contactedMs ? 'Contacted ' + when(r.contactedMs) : 'Not contacted', r.handledBy ? 'by ' + r.handledBy : '', r.orderedMs ? 'Ordered ' + when(r.orderedMs) : ''].filter(Boolean);
      dec += '<div class="it"><b>' + J.esc(r.status) + '</b><div class="meta">' + J.esc(b2.join(' · ')) + '</div></div>';
    }
    if (!dec) dec = none('Nothing recorded.');
    var act = '';
    t.orders.forEach(function (o) {
      act += '<div class="it"><b>' + J.esc((o.vendorName || 'Vendor not set') + ': ' + o.type + ' order') + '</b><div class="meta">' + J.esc([o.reference ? 'Ref ' + o.reference : 'No reference', o.orderMs ? 'Ordered ' + when(o.orderMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div>' + J.chip(o.status, o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info') + btn('open-order', o.id, 'Open order') + '</div></div>';
    });
    act += returnRows(t.returns);
    if (!act) {
      var al = t.alert;
      if (al && al.kind === 'excess' && al.ret > 0) act = '<div class="it"><b>No return request recorded</b><div class="meta">' + (state.returnsAvailable ? 'Ask the customer to send ' + al.ret + ' back and record the return.' : 'The Device Returns module is not set up yet.') + '</div></div>';
      else if (al && (al.kind === 'house' || al.kind === 'customer') && al.order > 0) act = '<div class="it"><b>No order recorded</b><div class="meta">' + (state.alertLink ? 'Use Mark ordered on the alert so the order links back here.' : 'Orders cannot be matched to alerts until Vendor Orders has a Stock Alert link.') + '</div></div>';
      else if (t.rec) act = '<div class="it"><b>No order recorded</b><div class="meta">Use Mark ordered on the recommendation.</div></div>';
      else act = none('No order or return is expected for this record.');
    }
    var ful = '';
    t.orders.filter(function (o) { return o.status === 'Received'; }).forEach(function (o) { ful += '<div class="it"><b>Order received</b><div class="meta">' + J.esc(o.receivedMs ? when(o.receivedMs) : '') + '</div></div>'; });
    t.returns.filter(function (r) { return r.status === 'Received' || r.status === 'Closed'; }).forEach(function (r) {
      ful += '<div class="it"><b>Return ' + (r.status === 'Closed' ? 'closed' : 'received') + '</b><div class="meta">' + J.esc(r.receivedMs ? when(r.receivedMs) : '') + '</div>' + (r.status === 'Received' ? '<div class="note-bad">Received but not closed.</div>' : '') + '</div>';
    });
    if (t.rec && t.rec.shipsSince.length) ful += '<div class="it"><b>Accessory shipment left</b><div class="meta">' + J.esc(t.rec.shipsSince.slice(0, 3).map(function (s) { return when(s.ms); }).join(', ')) + '</div></div>';
    if (!ful) ful = none('Nothing received or shipped yet.');
    return '<ol class="chain"><li><div class="lh">Signal</div>' + sig + '</li><li><div class="lh">Decision</div>' + dec + '</li><li><div class="lh">Action</div>' + act + '</li><li><div class="lh">Fulfilment</div>' + ful + '</li>' + accountRow(t) + '</ol>';
  }
  function detail(item) {
    if (item.kind === 'family' || item.kind === 'hist') return;
    if (item.kind === 'ship') { J.drawer.open({ title: item.title, html: '<p>This accessory shipment has no recommendation linked. Linking it (backfill) lets the recommendation see what shipped.</p><div class="drawer-actions"><button type="button" class="btn" data-a="open-ship" data-id="' + J.esc(item.id) + '">Open shipment</button></div>', onMount: wire }); return; }
    if (item.kind === 'hist-acct') {
      J.drawer.open({ title: item.title, html: '<p>' + J.esc(item.sub) + '. There is no Accessory Order Recommendation for this account, so the accessory alert never looks at it. Create a recommendation for the account, or confirm it should not have one.</p>' +
        (item.accountId ? '<div class="drawer-actions"><button type="button" class="btn" data-a="open-account" data-id="' + J.esc(item.accountId) + '">Open account</button></div>' : ''), onMount: wire });
      return;
    }
    var tr = M.trace(state.model, item);
    if (tr.src === 'eq') J.drawer.open({ title: item.title, html: eqPath(tr.t), onMount: wire });
    else if (tr.src === 'st') J.drawer.open({ title: item.title, html: stPath(tr.t), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
      var map = { 'open-alert': 'alert', 'open-rec': 'rec', 'open-order': 'order', 'open-return': 'return', 'open-account': 'account', 'open-ship': 'ship', 'open-case': 'case' };
      if (map[a]) openRecord(map[a], id);
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); },
      add: { mount: '.actions', items: [{ label: 'New Vendor order', entity: 'Vendor_Orders' }, { label: 'New return', entity: 'Device_Returns' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#lead').value = state.leadBD;
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#win').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]'); if (!b) return;
      var w = M.WINDOWS.filter(function (x) { return x.id === b.getAttribute('data-w'); })[0]; if (!w) return;
      state.days = w.days; recompute();
    });
    $('#track').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-t]'); if (!b) return;
      state.track = b.getAttribute('data-t'); state.lane = null; recompute();
    });
    $('#lead').addEventListener('change', function () {
      var v = Math.round(+this.value); if (!isFinite(v) || v < 1) v = M.DEFAULT_LEAD_BD; if (v > 60) v = 60;
      this.value = v; state.leadBD = v; recompute();
    });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows everything that goes out to the field, devices and accessories, from the reason it was needed to the field count and the return. It combines the old Equipment and Stock pages. Nothing here changes a record. The Devices, Accessories and Returns buttons narrow every step to one kind.</p>' +
      '<p><b>1 Signal and need.</b> Open stock alerts by kind, accessory orders due or overdue, and open cases of category Order Device(s). Three lines read back the accessory history (below).</p>' +
      '<p><b>2 Decision.</b> Where each alert is: waiting for approval, needs action, or sent and waiting on the customer; and accessory customers who were contacted. Checks: approvals waiting over two business days, no recipient, rejected emails with the alert still open, alerts emailed over a week ago that the latest count still raises, customers contacted over a week ago with no order, overdue accessory orders nobody contacted.</p>' +
      '<p><b>3 Ordered.</b> Device orders still Placed (with the method, so you know where to chase), over the limit or with no reference; accessory orders still Placed; and the gaps: excess alerts with no return request, approved alerts with no order, recommendations marked ordered with no order.</p>' +
      '<p><b>4 Received and out.</b> Orders received in the window. Checks: no serial numbers, serials that do not match, fewer received than ordered, and orders received while the case is still open. Accessory shipments that left since a recommendation, and shipments not yet linked to one.</p>' +
      '<p><b>5 Field, returns and closed.</b> The latest count by device family, returns open, over the limit or received and not closed, and alerts closed in the window.</p>' +
      '<p><b>Accessory history.</b> Accessory due dates and alerts are worked out from the order history you bring in. <i>Accessory order history loaded</i> shows how many shipments are in it, by month, and how old the newest one is. If the newest is over ' + M.HISTORY_STALE_DAYS + ' days old the alerts are running on old numbers. <i>Ordering accessories, no recommendation</i> lists accounts that appear in the history but have no recommendation, so nothing watches them. <i>Recommendation with no shipment history</i> lists due dates that have nothing behind them.</p>' +
      '<p>Click a step to list its records, then a record to see its path.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load the supply path.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
