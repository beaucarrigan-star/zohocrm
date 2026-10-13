/* Stock and accessories flow widget. Uses jpk v1.1.0, TriageModel (business days), StockFlowModel and, when no Zoho SDK, StockFlowDemo.
   Read-only: COQL reads of EM_Stock_Alerts, Accessory_Order_Recommendations, Vendor_Orders, Accessory_Shipments and (optional) Device_Returns. Nothing is written. */
(function () {
  'use strict';
  var M = window.StockFlowModel, J = window.JPK;
  var ALERT_Q = 'select id, Name, Alert_Type, Account, Status, Email_Status, Resolution, Suggested_Order, Suggested_Return, Spare_Units, Assigned_Units, Threshold, Device_Family, Email_Sent_At, Last_Seen, Created_Time, Modified_Time from EM_Stock_Alerts where id is not null order by id asc';
  var REC_Q = 'select id, Name, Account, Status, Handled_By, Next_Due_Date, Last_Contacted_Date, Last_Order_Placed_Date, Recommendation_Date, Suggested_Order, Order_Vendor from Accessory_Order_Recommendations where id is not null order by id asc';
  var ORDER_BASE = 'id, Order_Type, Order_Status, Order_Date, Received_Date, Received_At, Reference, Source, Case, Recommendation, Vendor, Account';
  var ORDER_TRIES = [
    { q: 'select ' + ORDER_BASE + ', Stock_Alert from Vendor_Orders where id is not null order by id asc', alertLink: true },
    { q: 'select ' + ORDER_BASE + ' from Vendor_Orders where id is not null order by id asc', alertLink: false }
  ];
  function shipTries(now) {
    var since = new Date(now - 180 * 86400000).toISOString().slice(0, 10);
    var w = ' from Accessory_Shipments where Is_Accessory = true and Ship_Date >= \'' + since + '\' order by id asc';
    return [{ q: 'select id, Ship_Date, Account, Allied_Customer, Recommendation' + w, shipLink: true }, { q: 'select id, Ship_Date, Account, Allied_Customer' + w, shipLink: false }];
  }
  var RETURN_Q = 'select id, Name, Return_Type, Return_Status, Account, Case, Stock_Alert, Vendor, Device_Family, Quantity, Vendor_RMA_Number, Requested_Date, Received_Date, Created_Time from Device_Returns where id is not null order by id asc';
  var ENTITY = { alert: 'EM_Stock_Alerts', rec: 'Accessory_Order_Recommendations', order: 'Vendor_Orders', return: 'Device_Returns', account: 'Accounts', ship: 'Accessory_Shipments' };
  var drawerClick = null;
  var state = { demo: false, alerts: [], recs: [], orders: [], returns: [], ships: [], notes: [], alertLink: false, shipLink: false, returnsAvailable: false,
    now: Date.now(), days: 30, model: null, lane: null, nx: null, table: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }

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
      var d = window.StockFlowDemo.make(state.now);
      state.alerts = d.alerts; state.recs = d.recs; state.orders = d.orders; state.returns = d.returns; state.ships = d.ships;
      state.alertLink = true; state.shipLink = true; state.returnsAvailable = true; return Promise.resolve();
    }
    return Promise.all([
      J.crm.coqlAll(ALERT_Q).then(function (r) { state.alerts = r; }, function (e) { throw new Error('Stock Alerts: ' + msg(e)); }),
      J.crm.coqlAll(REC_Q).then(function (r) { state.recs = r; }, function (e) { state.recs = []; state.notes.push('Accessory recommendations could not be read (' + msg(e) + ').'); }),
      firstThatWorks(ORDER_TRIES, function (r, t) { state.orders = r; state.alertLink = t.alertLink; }).then(function () {
        if (!state.alertLink) state.notes.push('Vendor Orders has no Stock Alert link yet, so device orders cannot be matched to alerts.');
      }, function (e) { state.orders = []; state.notes.push('Vendor Orders could not be read (' + msg(e) + '), so orders are not shown.'); }),
      firstThatWorks(shipTries(state.now), function (r, t) { state.ships = r; state.shipLink = t.shipLink; }).then(function () {
        if (!state.shipLink) state.notes.push('Accessory Shipments has no Recommendation link yet, so unlinked shipments are not listed.');
      }, function (e) { state.ships = []; state.notes.push('Accessory Shipments could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(RETURN_Q).then(function (r) { state.returns = r; state.returnsAvailable = true; },
        function () { state.returns = []; state.returnsAvailable = false; state.notes.push('The Device Returns module is not set up yet, so returns are not shown and every excess alert reads as having no return.'); })
    ]);
  }

  /* ---------- render ---------- */
  function winButtons() {
    $('#win').innerHTML = M.WINDOWS.map(function (w) {
      return '<button type="button" data-w="' + w.id + '" aria-pressed="' + (w.days === state.days) + '">' + J.esc(w.label) + '</button>';
    }).join('');
  }
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
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No alerts waiting too long, excess spares without a return request, or accessory customers going unchased.', progress: 100, button: null });
  }
  function renderHeader() {
    var m = state.model, t = m.totals;
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' +
      t.openAlerts + (t.openAlerts === 1 ? ' open stock alert' : ' open stock alerts') + ' and ' + m.lanes['s-rec'].count + ' accessory ' + (m.lanes['s-rec'].count === 1 ? 'order' : 'orders') + ' due or overdue.';
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Open alerts and accessory recommendations are always all of them; received, shipped and closed follow the window. Business days skip weekends; holidays are not skipped. ' +
      'Accessory buckets use the same rules as the Accessory board (due 0 to ' + M.DUE_GRACE_DAYS + ' days past the date, overdue after that, chase after ' + M.FOLLOWUP_DAYS + ' days with no order). EM Reorder Rules is empty, so thresholds are not rule-driven yet.';
  }

  function columns(kind) {
    var label = { alert: 'Alert', rec: 'Accessories', order: 'Order', return: 'Return', ship: 'Shipment' }[kind] || 'Record';
    var c = [
      { key: 'title', label: label, sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">House or none</span>'; } },
      { key: 'when', label: kind === 'rec' ? 'Due or contacted' : 'Date', sortable: true, num: true, sortValue: function (i) { return i.ms; }, render: function (i) { return J.esc(when(i.ms)); } },
      { key: 'age', label: 'Age', sortable: true, num: true, align: 'right', sortValue: function (i) { return i.age == null ? -1 : i.age; }, render: function (i) { return '<span class="age">' + J.esc(i.ageText) + '</span>'; } },
      { key: 'state', label: 'Status', sortable: true, sortValue: function (i) { return i.state; }, render: function (i) { return J.chip(i.state, i.tone); } }
    ];
    return c;
  }
  var FT = null;
  function shown(l) { var r = FT ? FT.filter(l.items) : l.items; if (FT) FT.note(r.length, l.items.length); return r; }
  function renderLane() {
    var m = state.model, l = m.lanes[state.lane];
    if (!l) { $('#lane-title').textContent = 'Pick a step above'; $('#lane-hint').textContent = ''; $('#lane-table').innerHTML = ''; return; }
    $('#lane-title').textContent = 'Step ' + l.stage + ': ' + l.label + ' (' + l.count + ')';
    $('#lane-hint').textContent = l.hint && l.count ? l.hint : '';
    state.table = J.table({ mount: '#lane-table', columns: columns(l.kind), rows: shown(l), caption: l.label, onRowClick: detail,
      empty: { title: 'Nothing here', hint: l.hint || 'No records in this step for the chosen window.' } });
  }
  function selectLane(id, scroll) {
    state.lane = id; renderFlow(); renderLane();
    if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function recompute() {
    state.model = M.build({ alerts: state.alerts, recs: state.recs, orders: state.orders, returns: state.returns, ships: state.ships }, state.now,
      { days: state.days, alertLink: state.alertLink, shipLink: state.shipLink, returnsAvailable: state.returnsAvailable });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 's-dev';
    winButtons(); renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- detail drawer: the path for one record ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the ' + kind + ' record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function signalHtml(t) {
    var h = '';
    if (t.alert) {
      var a = t.alert;
      h += '<div class="it"><b>' + J.esc(a.type || 'Stock alert') + (a.accountName && a.kind !== 'house' ? ' - ' + J.esc(a.accountName) : '') + '</b><div class="meta">' +
        J.esc([a.family, a.spare != null ? a.spare + ' spare' : '', a.threshold != null ? 'floor ' + a.threshold : '', a.order > 0 ? 'suggests sending ' + a.order : '', a.ret > 0 ? 'suggests taking back ' + a.ret : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        '<div>' + J.chip(a.status, a.open ? 'info' : a.status === 'Dismissed' ? 'neutral' : 'good') + btn('open-alert', a.id, 'Open alert') + '</div></div>';
    }
    if (t.rec) {
      var c = t.rec;
      h += '<div class="it"><b>Accessories for ' + J.esc(c.accountName) + '</b><div class="meta">' + J.esc([c.suggested ? 'Suggested ' + c.suggested : '', c.nextMs ? 'Next due ' + when(c.nextMs) : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        '<div>' + J.chip(c.status, c.bucket === 'overdue' || c.bucket === 'chase' ? 'warn' : 'info') + btn('open-rec', c.id, 'Open recommendation') + '</div></div>';
    }
    return h || '<div class="none">No alert or recommendation is linked.</div>';
  }
  function decisionHtml(t) {
    var h = '';
    if (t.alert) {
      var a = t.alert, bits = [a.email ? 'Email: ' + a.email : 'No email status', a.sentMs ? 'sent ' + when(a.sentMs) : '', a.resolution ? 'Resolution: ' + a.resolution : ''].filter(Boolean);
      h += '<div class="it"><b>' + J.esc({ approve: 'Waiting for approval', action: 'Needs action', waiting: 'Waiting on customer', done: 'Done', dismissed: 'Dismissed' }[a.lane] || a.lane) + '</b><div class="meta">' + J.esc(bits.join(' \u00b7 ')) + '</div></div>';
    }
    if (t.rec) {
      var c = t.rec, bits2 = [c.contactedMs ? 'Contacted ' + when(c.contactedMs) : 'Not contacted', c.handledBy ? 'by ' + c.handledBy : '', c.orderedMs ? 'Ordered ' + when(c.orderedMs) : ''].filter(Boolean);
      h += '<div class="it"><b>' + J.esc(c.status) + '</b><div class="meta">' + J.esc(bits2.join(' \u00b7 ')) + '</div></div>';
    }
    return h || '<div class="none">Nothing recorded.</div>';
  }
  function actionHtml(t) {
    var h = '';
    t.orders.forEach(function (o) {
      h += '<div class="it"><b>' + J.esc((o.vendorName || 'Vendor not set') + ': ' + o.type + ' order') + '</b><div class="meta">' + J.esc([o.reference ? 'Ref ' + o.reference : 'No reference', o.orderMs ? 'Ordered ' + when(o.orderMs) : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        '<div>' + J.chip(o.status, o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info') + btn('open-order', o.id, 'Open order') + '</div></div>';
    });
    t.returns.forEach(function (r) {
      h += '<div class="it"><b>' + J.esc((r.type || 'Return') + (r.family ? ': ' + r.family : '') + (r.qty != null ? ' x' + r.qty : '')) + '</b><div class="meta">' + J.esc([r.vendorName, r.rma ? 'RMA ' + r.rma : 'No RMA number', r.requestedMs ? 'Requested ' + when(r.requestedMs) : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        '<div>' + J.chip(r.status, r.open ? 'info' : 'good') + btn('open-return', r.id, 'Open return') + '</div></div>';
    });
    if (h) return h;
    var a = t.alert;
    if (a && a.kind === 'excess' && a.ret > 0) return '<div class="it"><b>No return request recorded</b><div class="meta">' + (state.returnsAvailable ? 'Ask the customer to send ' + a.ret + ' back and record the return.' : 'The Device Returns module is not set up yet.') + '</div></div>';
    if (a && (a.kind === 'house' || a.kind === 'customer') && a.order > 0) return '<div class="it"><b>No order recorded</b><div class="meta">' + (state.alertLink ? 'Use Mark ordered on the alert so the order links back here.' : 'Orders cannot be matched to alerts until Vendor Orders has a Stock Alert link.') + '</div></div>';
    if (t.rec) return '<div class="it"><b>No order recorded</b><div class="meta">Use Mark ordered on the recommendation.</div></div>';
    return '<div class="none">No order or return is expected for this record.</div>';
  }
  function fulfilmentHtml(t) {
    var h = '';
    t.orders.filter(function (o) { return o.status === 'Received'; }).forEach(function (o) { h += '<div class="it"><b>Order received</b><div class="meta">' + J.esc(o.receivedMs ? when(o.receivedMs) : '') + '</div></div>'; });
    t.returns.filter(function (r) { return r.status === 'Received' || r.status === 'Closed'; }).forEach(function (r) {
      h += '<div class="it"><b>Return ' + (r.status === 'Closed' ? 'closed' : 'received') + '</b><div class="meta">' + J.esc(r.receivedMs ? when(r.receivedMs) : '') + '</div>' + (r.status === 'Received' ? '<div class="note-bad">Received but not closed.</div>' : '') + '</div>';
    });
    if (t.rec && t.rec.shipsSince.length) h += '<div class="it"><b>Accessory shipment left</b><div class="meta">' + J.esc(t.rec.shipsSince.slice(0, 3).map(function (s) { return when(s.ms); }).join(', ')) + '</div></div>';
    return h || '<div class="none">Nothing received or shipped yet.</div>';
  }
  function pathHtml(t) {
    return '<ol class="chain"><li><div class="lh">Signal</div>' + signalHtml(t) + '</li><li><div class="lh">Decision</div>' + decisionHtml(t) + '</li>' +
      '<li><div class="lh">Action</div>' + actionHtml(t) + '</li><li><div class="lh">Fulfilment</div>' + fulfilmentHtml(t) + '</li>' +
      '<li><div class="lh">Account</div>' + (t.account ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b>' + (t.account.id ? '<div>' + btn('open-account', t.account.id, 'Open account').trim() + '</div>' : '') + '</div>' : '<div class="none">House stock: no customer account.</div>') + '</li></ol>';
  }
  function detail(item) {
    if (item.kind === 'ship') { J.drawer.open({ title: item.title, html: '<p>This accessory shipment has no recommendation linked. Linking it (backfill) lets the recommendation see what shipped.</p><div class="drawer-actions"><button type="button" class="btn" data-a="open-ship" data-id="' + J.esc(item.id) + '">Open shipment</button></div>', onMount: wire }); return; }
    J.drawer.open({ title: item.title, html: pathHtml(M.trace(state.model, item)), onMount: wire });
  }
  function wire(body) {
    if (drawerClick) body.removeEventListener('click', drawerClick);
    drawerClick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
      var map = { 'open-alert': 'alert', 'open-rec': 'rec', 'open-order': 'order', 'open-return': 'return', 'open-account': 'account', 'open-ship': 'ship' };
      if (map[a]) openRecord(map[a], id);
    };
    body.addEventListener('click', drawerClick);
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Vendor order', entity: 'Vendor_Orders' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#win').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]'); if (!b) return;
      var w = M.WINDOWS.filter(function (x) { return x.id === b.getAttribute('data-w'); })[0]; if (!w) return;
      state.days = w.days; recompute();
    });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows each automatic signal to what was done about it: an order, a return request, or a follow-up with the customer. Nothing here changes a record.</p>' +
      '<p><b>1 Signal.</b> Open stock alerts by kind (device stock, accessory growth, excess spares) and accessory orders that are due or overdue.</p>' +
      '<p><b>2 Decision.</b> Where each alert is: waiting for approval, needs action, or sent and waiting on the customer; and accessory customers who were contacted. Checks: approvals waiting over two business days, no recipient, rejected emails with the alert still open, alerts emailed over a week ago that the latest count still raises, customers contacted over a week ago with no order, overdue accessory orders nobody contacted.</p>' +
      '<p><b>3 Action.</b> Orders and returns under way from a signal. The important checks live here: <i>excess alerts with no return request</i> (devices to take back and nobody chasing), <i>approved alerts with no order</i>, and recommendations marked ordered with no order recorded.</p>' +
      '<p><b>4 Fulfilment.</b> Orders received, returns received but not closed, accessory shipments that left since the recommendation, and shipments not yet linked to a recommendation (the backfill list).</p>' +
      '<p><b>5 Closed.</b> Alerts resolved or dismissed in the window, and accessories on track.</p>' +
      '<p>Click a step to list its records, then a record to see its path.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load the stock path.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
