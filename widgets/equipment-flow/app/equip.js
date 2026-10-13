/* Equipment flow widget. Uses jpk v1.1.0, TriageModel (business days), EquipModel and, when no Zoho SDK, EquipDemo.
   Read-only: COQL reads of Vendor_Orders, Cases, EM_Stock_Alerts, Daily_Unit_Counts and (optional) Device_Returns. Nothing is written. */
(function () {
  'use strict';
  var M = window.EquipModel, J = window.JPK;
  var ORDER_COMMON = 'id, Order_Type, Order_Status, Order_Date, Received_Date, Received_At, Received_Qty, Method, Source, Reference, Case, Vendor, Account';
  /* Tried in this order: with the Stock Alert lookup (Equipment flow prerequisite), without it, then without the multi-line fields.
     Each step that fails switches off only what it needed and says so in the footer. */
  var ORDER_TRIES = [
    { q: 'select ' + ORDER_COMMON + ', Items, Ship_To, Serial_Numbers, Stock_Alert from Vendor_Orders where Order_Type = \'Devices\' order by id asc', alertLink: true, detail: true },
    { q: 'select ' + ORDER_COMMON + ', Items, Ship_To, Serial_Numbers from Vendor_Orders where Order_Type = \'Devices\' order by id asc', alertLink: false, detail: true },
    { q: 'select ' + ORDER_COMMON + ' from Vendor_Orders where Order_Type = \'Devices\' order by id asc', alertLink: false, detail: false }
  ];
  var CASE_Q = 'select id, Case_Number, Subject, Status, Created_Time, Case_Category, Account_Name from Cases where Case_Category = \'Order Device(s)\' order by id asc';
  var ALERT_Q = 'select id, Name, Alert_Type, Status, Email_Status, Device_Family, Spare_Units, Assigned_Units, Threshold, Suggested_Order, Suggested_Return, Last_Seen, Count_Date, Account from EM_Stock_Alerts where Status = \'Open\' order by id asc';
  function countQ(now) {
    var d = new Date(now - 8 * 86400000).toISOString().slice(0, 10);
    return 'select id, Count_Date, Device_Family, On_Leg, Spare, Total_Units from Daily_Unit_Counts where Count_Date >= \'' + d + '\' order by id asc';
  }
  var RETURN_Q = 'select id, Name, Return_Type, Return_Status, Account, Case, Stock_Alert, Vendor, Device_Family, Quantity, Vendor_RMA_Number, Requested_Date, Shipped_Date, Received_Date, Outcome, Created_Time from Device_Returns where id is not null order by id asc';
  var ENTITY = { case: 'Cases', account: 'Accounts', order: 'Vendor_Orders', alert: 'EM_Stock_Alerts', return: 'Device_Returns' };
  var drawerClick = null;
  var state = { demo: false, orders: [], cases: [], alerts: [], counts: [], returns: [], notes: [], alertLink: false, detail: true, returnsAvailable: false,
    now: Date.now(), days: 30, leadBD: M.DEFAULT_LEAD_BD, model: null, lane: null, nx: null, table: null };

  function $(s) { return document.querySelector(s); }
  function when(ms) { return ms == null ? '' : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
  function tone(t) { return t && t !== 'neutral' ? ' ' + t : ''; }
  function msg(e) { return (e && e.message) || String(e); }

  /* ---------- data ---------- */
  function loadOrders() {
    var i = 0, last;
    function next() {
      if (i >= ORDER_TRIES.length) return Promise.reject(last);
      var t = ORDER_TRIES[i++];
      return J.crm.coqlAll(t.q).then(function (r) { state.orders = r; state.alertLink = t.alertLink; state.detail = t.detail; }, function (e) { last = e; return next(); });
    }
    return next();
  }
  function load() {
    state.now = Date.now(); state.notes = [];
    if (state.demo) {
      var d = window.EquipDemo.make(state.now);
      state.orders = d.orders; state.cases = d.cases; state.alerts = d.alerts; state.counts = d.counts; state.returns = d.returns;
      state.alertLink = true; state.detail = true; state.returnsAvailable = true; return Promise.resolve();
    }
    return Promise.all([
      loadOrders().then(function () {
        if (!state.alertLink) state.notes.push('Vendor Orders has no Stock Alert link yet, so alerts cannot be matched to orders.');
        if (!state.detail) state.notes.push('Items, Ship To and Serial Numbers could not be read, so the serial, quantity and sent-on checks are off.');
      }, function (e) { throw new Error('Vendor Orders: ' + msg(e)); }),
      J.crm.coqlAll(CASE_Q).then(function (r) { state.cases = r; }, function (e) { state.cases = []; state.notes.push('Cases could not be read (' + msg(e) + '), so device requests are not shown.'); }),
      J.crm.coqlAll(ALERT_Q).then(function (r) { state.alerts = r; }, function (e) { state.alerts = []; state.notes.push('Stock Alerts could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(countQ(state.now)).then(function (r) { state.counts = r; }, function (e) { state.counts = []; state.notes.push('Daily Unit Counts could not be read (' + msg(e) + ').'); }),
      J.crm.coqlAll(RETURN_Q).then(function (r) { state.returns = r; state.returnsAvailable = true; },
        function () { state.returns = []; state.returnsAvailable = false; state.notes.push('The Device Returns module is not set up yet, so returns are not shown.'); })
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
    } else state.nx.update({ title: 'Nothing is stuck.', sub: 'No late orders, unrecorded orders, missing serials or stale returns in this view.', progress: 100, button: null });
  }
  function renderHeader() {
    var m = state.model, h = m.house;
    var hs = h && h.spare != null ? ' House stock: ' + h.spare + ' spare' + (h.threshold != null ? ' against a floor of ' + h.threshold : '') + ' at the ' + (h.countDate || 'latest') + ' count.' : '';
    $('#asof').textContent = 'Read ' + new Date(state.now).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + '. ' +
      m.totals.placed + ' device ' + (m.totals.placed === 1 ? 'order' : 'orders') + ' placed, not received.' + hs;
    $('#foot').textContent = (state.notes.length ? state.notes.join(' ') + ' ' : '') +
      'Read-only. Placed orders and open items are always all of them; received and sent-on follow the window. Quantity ordered is read from the Items text. Receiving does not change stock levels or create dispatch work (known gaps). The order limit of ' + state.leadBD + ' business days is a starting guess, not a vendor lead time.';
  }

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
      { key: 'title', label: kind === 'case' ? 'Case' : kind === 'alert' ? 'Alert' : kind === 'return' ? 'Return' : 'Order', sortable: true, sortValue: function (i) { return i.title; },
        render: function (i) { return '<div class="subj">' + J.esc(i.title) + '</div><div class="sub2">' + J.esc(i.sub) + '</div>' + (i.note ? '<div class="note-bad">' + J.esc(i.note) + '</div>' : ''); } },
      { key: 'acct', label: 'Account', sortable: true, sortValue: function (i) { return i.accountName; }, render: function (i) { return i.accountName ? J.esc(i.accountName) : '<span class="muted">' + (kind === 'order' ? 'House stock or none' : 'None') + '</span>'; } },
      { key: 'when', label: kind === 'order' ? 'Date' : kind === 'return' ? 'Requested' : 'Opened', sortable: true, num: true, sortValue: function (i) { return i.ms; }, render: function (i) { return J.esc(when(i.ms)); } },
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
    $('#lane-hint').textContent = l.hint && l.count ? l.hint : '';
    state.table = J.table({ mount: '#lane-table', columns: columns(l.kind), rows: shown(l), caption: l.label, onRowClick: detail,
      empty: { title: 'Nothing here', hint: l.hint || 'No records in this step for the chosen window.' } });
  }
  function selectLane(id, scroll) {
    state.lane = id; renderFlow(); renderLane();
    if (scroll) { var c = $('.lane-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function recompute() {
    state.model = M.build({ orders: state.orders, cases: state.cases, alerts: state.alerts, counts: state.counts, returns: state.returns }, state.now,
      { days: state.days, leadBD: state.leadBD, alertLink: state.alertLink, detail: state.detail, returnsAvailable: state.returnsAvailable });
    if (!state.model.lanes[state.lane]) state.lane = null;
    if (!state.lane) state.lane = state.model.stuck.length ? state.model.stuck[0].lane : 'o-placed';
    winButtons(); renderHeader(); renderStrip(); renderFlow(); renderLane();
  }

  /* ---------- detail drawer: the path for one record ---------- */
  function openRecord(kind, id) {
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI || !ZOHO.CRM.UI.Record) { J.toast('Demo: would open the ' + kind + ' record'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: ENTITY[kind], RecordID: id });
  }
  function btn(a, id, label) { return ' <button type="button" class="lnk sm" data-a="' + a + '" data-id="' + J.esc(id) + '">' + label + '</button>'; }
  function needHtml(t) {
    var h = '';
    if (t.case) h += '<div class="it"><b>' + J.esc((t.case.number ? t.case.number + ' ' : '') + t.case.subject) + '</b><div class="meta">' + J.esc([t.case.category, t.case.status].filter(Boolean).join(' / ')) + '</div>' +
      '<div>' + J.chip(t.case.status || 'No status', t.case.open ? 'info' : 'good') + btn('open-case', t.case.id, 'Open case') + '</div></div>';
    if (t.alert) {
      var a = t.alert;
      h += '<div class="it"><b>' + J.esc(a.type) + (a.accountName && a.type !== 'House stock' ? ' - ' + J.esc(a.accountName) : '') + '</b><div class="meta">' +
        J.esc([a.family, a.spare != null ? a.spare + ' spare' : '', a.threshold != null ? 'floor ' + a.threshold : '', 'suggests ordering ' + a.suggestedOrder].filter(Boolean).join(' / ')) + '</div>' +
        '<div>' + J.chip(a.emailStatus || a.status, 'info') + btn('open-alert', a.id, 'Open alert') + '</div></div>';
    }
    return h || '<div class="none">No case or stock alert is linked, so nothing says why this was ordered. Fill Case (or Stock Alert) on the order.</div>';
  }
  function ordersHtml(t, item) {
    if (!t.orders.length) {
      var why = t.case || t.alert ? '<b>No order recorded</b><div class="meta">Use Order for this customer on the case, or Mark ordered on the stock alert. The order links back here.</div>' : '';
      return why ? '<div class="it">' + why + '</div>' : '<div class="none">No order.</div>';
    }
    return t.orders.map(function (o) {
      var tn = o.status === 'Received' ? 'good' : o.status === 'Cancelled' ? 'neutral' : 'info';
      return '<div class="it"><b>' + J.esc((o.vendorName || 'Vendor not set') + ': ' + (o.items || 'devices').replace(/\s*\n\s*/g, '; ')) + '</b>' +
        '<div class="meta">' + J.esc([o.reference ? 'Ref ' + o.reference : 'No reference', o.method, o.orderMs ? 'Ordered ' + when(o.orderMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div>' + J.chip(o.status, tn) + btn('open-order', o.id, 'Open order') + '</div></div>';
    }).join('');
  }
  function receivedHtml(t) {
    var rec = t.orders.filter(function (o) { return o.status === 'Received'; });
    if (!rec.length) return '<div class="none">' + (t.orders.length ? 'Not received yet.' : 'Nothing to receive until an order is recorded.') + '</div>';
    return rec.map(function (o) {
      var bits = [o.receivedMs ? 'Received ' + when(o.receivedMs) : '', o.receivedQty != null ? o.receivedQty + ' units' : 'quantity not recorded',
        o.serials.length ? o.serials.length + ' serial numbers' : 'no serial numbers', o.house ? 'to house stock' : 'sent to ' + o.shipTo.split('\n')[0]];
      var warn = '';
      if (state.detail && !o.serials.length) warn = '<div class="note-bad">No serial numbers were recorded.</div>';
      else if (state.detail && o.receivedQty != null && o.serials.length !== o.receivedQty) warn = '<div class="note-bad">' + o.serials.length + ' serials for ' + o.receivedQty + ' received.</div>';
      if (t.case && t.case.open) warn += '<div class="note-bad">The case is still open.</div>';
      return '<div class="it"><b>' + J.esc(o.vendorName || 'Order') + '</b><div class="meta">' + J.esc(bits.filter(Boolean).join(' · ')) + '</div>' + warn + '</div>';
    }).join('');
  }
  function returnsHtml(t) {
    if (!state.returnsAvailable) return '<div class="none">The Device Returns module is not set up yet.</div>';
    if (!t.returns.length) return '<div class="none">No return recorded for this case.</div>';
    return t.returns.map(function (r) {
      return '<div class="it"><b>' + J.esc((r.type || 'Return') + (r.family ? ': ' + r.family : '') + (r.qty != null ? ' x' + r.qty : '')) + '</b>' +
        '<div class="meta">' + J.esc([r.vendorName, r.rma ? 'RMA ' + r.rma : 'No RMA number', r.requestedMs ? 'Requested ' + when(r.requestedMs) : ''].filter(Boolean).join(' · ')) + '</div>' +
        '<div>' + J.chip(r.status, r.open ? 'info' : 'good') + btn('open-return', r.id, 'Open return') + '</div></div>';
    }).join('');
  }
  function pathHtml(t, item) {
    var h = '<ol class="chain">';
    h += '<li><div class="lh">Need</div>' + needHtml(t) + '</li>';
    h += '<li><div class="lh">Ordered</div>' + ordersHtml(t, item) + '</li>';
    h += '<li><div class="lh">Received and sent on</div>' + receivedHtml(t) + '</li>';
    h += '<li><div class="lh">Returns</div>' + returnsHtml(t) + '</li>';
    h += '<li><div class="lh">Account</div>' + (t.account ? '<div class="it"><b>' + J.esc(t.account.name || 'Account') + '</b>' + (t.account.id ? '<div>' + btn('open-account', t.account.id, 'Open account').trim() + '</div>' : '') + '</div>'
      : '<div class="none">No account: this went to house stock or the order has no customer.</div>') + '</li></ol>';
    return h;
  }
  function detail(item) {
    if (item.kind === 'family') return;
    J.drawer.open({ title: item.title, html: pathHtml(M.trace(state.model, item), item), onMount: function (body) {
      if (drawerClick) body.removeEventListener('click', drawerClick);
      drawerClick = function (e) {
        var b = e.target.closest('button[data-a]'); if (!b) return;
        var a = b.getAttribute('data-a'), id = b.getAttribute('data-id');
        if (a === 'open-case') openRecord('case', id); else if (a === 'open-order') openRecord('order', id);
        else if (a === 'open-alert') openRecord('alert', id); else if (a === 'open-return') openRecord('return', id);
        else if (a === 'open-account') openRecord('account', id);
      };
      body.addEventListener('click', drawerClick);
    } });
  }

  /* ---------- wiring ---------- */
  function build() {
    if (window.FlowTools) FT = FlowTools.init({ searchBefore: '#lane-table', placeholder: 'Search this list by name, account or status', onSearch: function () { renderLane(); }, add: { mount: '.actions', items: [{ label: 'New Vendor order', entity: 'Vendor_Orders' }] } });
    state.nx = J.next({ mount: '#nx', title: 'Loading', sub: '' });
    $('#lead').value = state.leadBD;
    $('#flow').addEventListener('click', function (e) { var b = e.target.closest('button[data-lane]'); if (b) selectLane(b.getAttribute('data-lane'), true); });
    $('#win').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-w]'); if (!b) return;
      var w = M.WINDOWS.filter(function (x) { return x.id === b.getAttribute('data-w'); })[0]; if (!w) return;
      state.days = w.days; recompute();
    });
    $('#lead').addEventListener('change', function () {
      var v = Math.round(+this.value); if (!isFinite(v) || v < 1) v = M.DEFAULT_LEAD_BD; if (v > 60) v = 60;
      this.value = v; state.leadBD = v; recompute();
    });
    J.aboutButton({ button: '#help', title: 'How this works', html:
      '<p>This page follows a device from the reason it was needed to the field count. Nothing here changes a record.</p>' +
      '<p><b>1 Need.</b> Open cases of category Order Device(s) (reactive) and open House stock or Customer spare floor alerts that suggest ordering (proactive). Each shows whether an order has been recorded.</p>' +
      '<p><b>2 Ordered.</b> Device orders in Vendor Orders that are still Placed, with the method (portal, emailed form, account manager) so you know where to chase. <i>Placed over the limit</i> uses the order limit at the top; <i>no reference</i> means there is nothing to quote to the vendor.</p>' +
      '<p><b>3 Received.</b> Orders marked received in the window. Checks: no serial numbers, serials that do not match the quantity, and fewer received than the Items text says were ordered.</p>' +
      '<p><b>4 Out to customer.</b> Received orders with a Ship To. <i>Received, case still open</i> finds orders whose case did not close when the order was received.</p>' +
      '<p><b>5 In the field and coming back.</b> The latest Daily Unit Count by device family with the change since the count before, and returns (to the vendor, or excess from a customer) that are open, over the limit, or received but not closed.</p>' +
      '<p>Click a step to list its records, then a record to see its path.</p>' });
    $('#refresh').addEventListener('click', function () { run(true); });
  }
  function run(manual) {
    return load().then(function () { recompute(); if (manual) J.toast('Refreshed'); }, function (e) {
      $('#asof').textContent = 'Could not read ' + msg(e);
      state.nx.update({ title: 'Could not load the equipment path.', sub: msg(e), progress: null, button: { label: 'Try again', onClick: function () { run(true); } } });
    });
  }
  J.crm.init().then(function (d) {
    state.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search);
    $('#demo-flag').hidden = !state.demo;
    build();
    return run(false);
  });
})();
