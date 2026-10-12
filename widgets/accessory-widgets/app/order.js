/* order.js: reactive ordering. Opens from an Account (related-list widget) or a Case (button widget) and prepares an order
   with the vendor's own method: portal link or emailed-form draft. People place the order or send the email; this page only
   prepares and records it in Vendor_Orders (see ../accessory_order.dg). Needs jpk.css/jpk.js (JPK v1.1.0), ship-logic.js, order-demo.js. */
(function () {
  'use strict';
  var L = window.ShipLogic, esc = JPK.esc;
  var CONFIG = {
    orderFn: 'accessory_order',   /* API name of the standalone accessory_order function (SETUP-CHECKLIST F). Empty = recording stays off. */
    vendorQuery: 'select id, Vendor_Name, Accessory_Order_Method, Customer_Portal, Accessory_Order_Email, Accessory_Order_Template, Device_Order_Method, Device_Order_Email, Device_Order_Contact, Device_Order_Template from Vendors where EM_JusticePoint_Vendor = true',
    stockQuery: "select Alert_Type, Count_Date, Spare_Units, Threshold, Suggested_Order, Status from EM_Stock_Alerts where Alert_Type = 'House stock'",
    recentDeviceQuery: function (since) { return "select Order_Type, Order_Status, Items, Received_Qty, Received_Date, Received_At, Ship_To from Vendor_Orders where Order_Type = 'Devices' and Order_Date >= '" + since + "'"; },
    productQuery: 'select Product_Name, Product_Active from Products where Product_Active = true',
    orderFields: 'id, Name, Vendor, Order_Type, Items, Received_Qty, Serial_Numbers, Order_Status, Order_Date, Received_Date, Reference, Source, Case'
  };
  var S = { demo: false, today: '', entity: 'Accounts', id: '', account: null, caseRec: null, vendors: [], products: [], recv: null, stock: null, alerts: [], recentDev: [], accountVendorIds: [],
    vendorId: '', catKey: '', type: 'Accessories', shipTo: '', rows: [{ qty: '', item: '', other: '' }], orders: [], setup: true, hist: null };

  function $(id) { return document.getElementById(id); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function showErr(m) { var e = $('err'); e.hidden = !m; e.textContent = m || ''; }
  function vendorById(id) { for (var i = 0; i < S.vendors.length; i++) if (S.vendors[i].id === String(id)) return S.vendors[i]; return null; }
  function enabled() { return S.demo || !!CONFIG.orderFn; }
  function idsOf(v) {   /* multi-select lookup values come back as [{id,name}] or [{Vendors:{id,name}}]; be defensive */
    return (Array.isArray(v) ? v : []).map(function (x) { return L.idOf(x && x.Vendors ? x.Vendors : x); }).filter(Boolean);
  }

  /* ---------- load ---------- */
  function loadDemo() {
    var D = window.ORDER_DEMO, q = location.search;
    S.demo = true; S.today = D.today;
    S.entity = /[?&]entity=Cases/.test(q) ? 'Cases' : 'Accounts';
    S.account = { id: D.account.id, name: D.account.name }; S.accountVendorIds = D.account.vendorIds.slice();
    S.caseRec = S.entity === 'Cases' ? JSON.parse(JSON.stringify(D.case)) : null;
    S.vendors = L.normVendors(D.vendors); S.products = D.products || []; S.alerts = D.stockAlerts || []; S.recentDev = D.recentDevices || []; S.orders = JSON.parse(JSON.stringify(D.orders)); S.setup = true;
    return Promise.resolve();
  }
  function loadLive(ctx) {
    S.today = todayStr();
    S.entity = ctx.Entity; S.id = Array.isArray(ctx.EntityId) ? ctx.EntityId[0] : ctx.EntityId;
    var rec = ZOHO.CRM.API.getRecord({ Entity: S.entity, RecordID: S.id }).then(function (r) { return (r && r.data && r.data[0]) || {}; });
    return rec.then(function (r) {
      if (S.entity === 'Cases') {
        var a = r.Account_Name || {};
        S.account = { id: L.idOf(a), name: a.name || '' };
        S.caseRec = { id: String(r.id), caseId: r.Case_ID || '', subject: r.Subject || '', vendorId: L.idOf(r.Vendor) };
        S.accountVendorIds = [];
        if (S.account.id) return ZOHO.CRM.API.getRecord({ Entity: 'Accounts', RecordID: S.account.id }).then(function (x) { var ar = (x && x.data && x.data[0]) || {}; S.accountVendorIds = idsOf(ar.Vendors); });
      } else {
        S.account = { id: String(r.id), name: r.Account_Name || '' };
        S.accountVendorIds = idsOf(r.Vendors);
      }
    }).then(function () {
      var pv = JPK.crm.coqlAll(CONFIG.vendorQuery).then(function (v) { return v; }, function () { S.setup = false; return []; });
      var po = S.account && S.account.id ? JPK.crm.coqlAll('select ' + CONFIG.orderFields + " from Vendor_Orders where Account = '" + S.account.id + "'").then(function (o) { return o; }, function () { S.setup = false; return []; }) : Promise.resolve([]);
      var pp = JPK.crm.coqlAll(CONFIG.productQuery).then(function (v) { return v; }, function () { return []; });
      var d30 = new Date(Date.now() - 45 * 86400000), since = d30.getFullYear() + '-' + ('0' + (d30.getMonth() + 1)).slice(-2) + '-' + ('0' + d30.getDate()).slice(-2);
      var ps = JPK.crm.coqlAll(CONFIG.stockQuery).then(function (v) { return v; }, function () { return []; });
      var pr = JPK.crm.coqlAll(CONFIG.recentDeviceQuery(since)).then(function (v) { return v; }, function () { return []; });
      return Promise.all([pv, po, pp, ps, pr]).then(function (x) { S.vendors = L.normVendors(x[0]); S.orders = x[1]; S.products = x[2]; S.alerts = x[3]; S.recentDev = x[4]; });
    });
  }
  function load(ctx) {
    showErr('');
    var go = S.demo ? loadDemo() : loadLive(ctx || S.ctx);
    go.then(function () {
      var pool = pickable();
      if (!S.vendorId) {
        var pre = S.caseRec && S.caseRec.vendorId && vendorById(S.caseRec.vendorId) ? S.caseRec.vendorId : (S.accountVendorIds.length === 1 && vendorById(S.accountVendorIds[0]) ? S.accountVendorIds[0] : '');
        S.vendorId = pre && pool.some(function (v) { return v.id === pre; }) ? pre : '';
      }
      render();
    }, function (e) { showErr('Could not load: ' + (e && e.message || e)); $('who').textContent = 'Could not load'; });
  }
  /* vendors to offer: the account's own vendors when it has them, otherwise every JusticePoint EM vendor */
  function pickable() {
    var own = S.vendors.filter(function (v) { return S.accountVendorIds.indexOf(v.id) >= 0; });
    return own.length ? own : S.vendors;
  }

  /* ---------- render ---------- */
  function render() {
    $('demo-flag').hidden = !S.demo;
    $('who').textContent = 'Order for ' + (S.account && S.account.name || 'this customer');
    $('ctx').innerHTML = S.caseRec ? 'From case ' + esc(S.caseRec.caseId) + (S.caseRec.subject ? ': ' + esc(S.caseRec.subject) : '') : 'From the account record';
    $('setup-note').hidden = S.setup; $('form').hidden = !S.setup;
    var pool = pickable(), sel = $('o-vendor');
    sel.innerHTML = '<option value="">Choose a vendor</option>' + pool.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === S.vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
    renderRows(); renderPlan(); renderHist(); renderStock();
  }
  /* House stock strip (device orders only). The count is the 7am snapshot; nothing here writes to it. */
  function renderStock() {
    var box = $('stock'), p = S.type === 'Devices' ? L.stockPosition(S.alerts, S.recentDev.concat(S.orders)) : null;
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="dr-h">House stock</div><p class="sm">At the 7am count on <b>' + esc(p.countDate) + '</b>: <b>' + p.spare + '</b> spare' + (p.target ? ' (target ' + p.target + ')' : '') + '. ' +
      'Received since the count: <b>' + p.receivedSince + '</b>' + (p.receivedSince ? ', so about <b>' + p.withReceived + '</b> now' : '') + '. Still on order: <b>' + p.onOrder + '</b>' + (p.onOrder ? ' (<b>' + p.ifOnOrderArrives + '</b> if it all arrives)' : '') + '.</p>' +
      (p.target ? '<p class="muted sm">' + (p.covered ? 'Receipts since the count already cover the target.' : p.coveredIfArrives ? 'Covers the target once the open orders arrive.' : 'Still below target even if the open orders arrive.') + '</p>' : '') +
      '<p class="muted sm">Counts only device orders with no Ship To. The next 7am count replaces this estimate.</p>';
  }
  /* The Ship To box shows for device orders and for the Word-form vendors (their forms ask for the delivery address). */
  function syncShip() {
    var v = S.vendorId ? vendorById(S.vendorId) : null;
    $('ship-wrap').hidden = !(S.type === 'Devices' || L.usesForm(v, S.type));
  }
  function renderRows() {
    syncShip();
    var cat = L.usesForm(S.vendorId ? vendorById(S.vendorId) : null, S.type);
    $('rows').innerHTML = S.rows.map(function (r, i) {
      if (cat) {   /* Buddi / SuperCom: choose from the lines of their Word form */
        var copts = '<option value="">Choose a line on the ' + esc(cat.key === 'buddi' ? 'Buddi' : 'SuperCom') + ' form</option>' + cat.groups.map(function (g) {
          return '<optgroup label="' + esc(g.name) + '">' + g.lines.map(function (n) { return '<option' + (r.item === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</optgroup>';
        }).join('') + '<option value="__other"' + (r.item === '__other' ? ' selected' : '') + '>Other</option>';
        return '<div class="item-row" data-i="' + i + '"><input type="number" min="1" max="99999" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity" data-f="qty" value="' + esc(r.qty) + '">' +
          '<select aria-label="Form line" data-f="item">' + copts + '</select>' +
          (S.rows.length > 1 ? '<button type="button" class="btn sm rm" data-rm="' + i + '" aria-label="Remove this item">Remove</button>' : '<span></span>') +
          (r.item === '__other' ? '<input type="text" class="other" maxlength="60" placeholder="What is it?" aria-label="Item name" data-f="other" value="' + esc(r.other) + '">' : '') + '</div>';
      }
      if (S.type === 'Devices') {
        var models = L.deviceModels(S.products, S.vendorId ? vendorById(S.vendorId) : null);
        var dopts = '<option value="">Choose model</option>' + models.map(function (n) { return '<option' + (r.item === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '<option value="__other"' + (r.item === '__other' || !models.length ? ' selected' : '') + '>Other</option>';
        var other = r.item === '__other' || !models.length;
        return '<div class="item-row" data-i="' + i + '"><input type="number" min="1" max="99999" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity" data-f="qty" value="' + esc(r.qty) + '">' +
          (models.length ? '<select aria-label="Device model" data-f="item">' + dopts + '</select>' : '<span></span>') +
          (S.rows.length > 1 ? '<button type="button" class="btn sm rm" data-rm="' + i + '" aria-label="Remove this item">Remove</button>' : '<span></span>') +
          (other ? '<input type="text" class="other" maxlength="60" placeholder="Device model" aria-label="Device model name" data-f="other" value="' + esc(r.other) + '">' : '') + '</div>';
      }
      var opts = '<option value="">Choose item</option>' + L.ITEM_CHOICES.map(function (n) { return '<option' + (r.item === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '<option value="__other"' + (r.item === '__other' ? ' selected' : '') + '>Other</option>';
      return '<div class="item-row" data-i="' + i + '"><input type="number" min="1" max="99999" step="1" inputmode="numeric" placeholder="Qty" aria-label="Quantity" data-f="qty" value="' + esc(r.qty) + '">' +
        '<select aria-label="Item" data-f="item">' + opts + '</select>' +
        (S.rows.length > 1 ? '<button type="button" class="btn sm rm" data-rm="' + i + '" aria-label="Remove this item">Remove</button>' : '<span></span>') +
        (r.item === '__other' ? '<input type="text" class="other" maxlength="60" placeholder="What is it?" aria-label="Item name" data-f="other" value="' + esc(r.other) + '">' : '') + '</div>';
    }).join('');
  }
  /* With no model list loaded, a device row has only the typed name; treat that as "other" before cleaning. */
  function devRows() {
    return S.rows.map(function (r) { return !r.item && S.type === 'Devices' && r.other ? { qty: r.qty, item: '__other', other: r.other } : r; });
  }
  function plan() {
    return L.orderPlan({ accountName: S.account ? S.account.name : '', suggested: L.rowsToSuggested(devRows()) }, S.vendorId ? vendorById(S.vendorId) : null, S.today, S.type, S.shipTo);
  }
  function renderPlan() {
    var p = plan(), box = $('plan'), has = !!L.rowsToSuggested(devRows()), h = '';
    if (!S.vendorId) h = '<p class="muted sm">Choose the vendor this customer orders from.</p>';
    else if (!has) h = '<p class="muted sm">Add at least one item with a quantity.</p>';
    else if (p.problem) h = '<p class="err">' + esc(p.problem) + '</p>';
    else if (p.kind === 'portal') {
      h = '<div class="q" style="margin:4px 0 10px">' + esc(p.copyText).replace(/\n/g, '<br>') + '</div>' +
        '<div class="row"><a class="btn pri" href="' + esc(p.portalUrl) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(p.vendorName) + ' portal</a><button type="button" class="btn" data-copy="lines">Copy order lines</button></div>' +
        '<p class="muted sm">Place the order in the portal, then record it here.</p>' +
        '<label class="sm muted" for="o-ref">Portal order number (optional)</label><input type="text" id="o-ref" maxlength="80">';
    } else if (p.kind === 'form') {
      h = '<dl class="dl"><dt>To</dt><dd>' + esc(p.email) + '</dd><dt>Subject</dt><dd>' + esc(p.subject) + '</dd>'+ (p.formless ? '' : '<dt>Attach</dt><dd>' + (p.template ? esc(p.template) : '<span class="muted">No template on the vendor record yet</span>') + '</dd>') + '</dl>' +
        '<div class="q" style="margin-bottom:10px">' + esc(p.body).replace(/\n/g, '<br>') + '</div>' +
        '<div class="row"><a class="btn pri" href="' + esc(p.mailto) + '">Open email draft</a><button type="button" class="btn" data-copy="email">Copy email text</button></div>' +
        '<p class="muted sm">You review and send the email. This page never sends it.</p>' +
        '<label class="sm muted" for="o-ref">Reference (optional)</label><input type="text" id="o-ref" maxlength="80">';
    }
    if (p.ready && has) h += '<div class="row" style="margin-top:10px"><button type="button" class="btn pri" id="o-done"' + (enabled() ? '' : ' disabled') + '>' + (p.kind === 'form' ? 'Mark order sent' : 'Mark ordered') + '</button>' + (enabled() ? '' : '<span class="muted sm">Not connected yet.</span>') + '</div>';
    h += '<div class="err" id="o-err" role="alert" hidden></div>';
    box.innerHTML = h;
  }
  function renderHist() {
    var rows = S.orders.slice().sort(function (a, b) { return String(b.Order_Date || '').localeCompare(String(a.Order_Date || '')); });
    $('hist-sub').textContent = rows.length ? rows.length + ' on file' : '';
    if (!S.hist) {
      S.hist = JPK.table({ mount: '#hist', caption: 'Vendor orders for this customer', rows: rows, empty: { title: 'No orders yet', hint: 'Orders recorded here and on the Accessory board show up in this list.' },
        columns: [
          { key: 'Order_Date', label: 'Ordered', sortable: true, render: function (o) { return esc(o.Order_Date || ''); } },
          { key: 'vendor', label: 'Vendor', render: function (o) { return esc(o.Vendor && o.Vendor.name || ''); } },
          { key: 'Items', label: 'Items', render: function (o) { return '<span class="hist-item">' + esc(o.Items || '') + '</span>' + (o.Order_Type === 'Devices' ? '<span class="cell-sub">Devices</span>' : '') + (o.Reference ? '<span class="cell-sub">Ref ' + esc(o.Reference) + '</span>' : '') + (o.Case && o.Case.name ? '<span class="cell-sub">Case ' + esc(o.Case.name) + '</span>' : ''); } },
          { key: 'Order_Status', label: 'Status', render: function (o) { return o.Order_Status === 'Received' ? JPK.chip('Received ' + (o.Received_Date || '') + (o.Received_Qty ? ' (' + o.Received_Qty + ')' : ''), 'good') : o.Order_Status === 'Cancelled' ? JPK.chip('Cancelled', 'neutral') : JPK.chip('Placed', 'info') + ' <button type="button" class="btn sm" data-recv="' + esc(o.id) + '"' + (enabled() ? '' : ' disabled') + '>Mark received</button>'; } }
        ] });
    } else S.hist.setRows(rows);
  }

  /* ---------- actions ---------- */
  function copyText(text) {
    var ok = function () { JPK.toast('Copied'); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, function () { fb(text, ok); }); return; } } catch (e) { /* fall through */ }
    fb(text, ok);
  }
  function fb(text, ok) {
    var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { JPK.toast('Select the text and copy it by hand'); }
    document.body.removeChild(t);
  }
  function call(payload) {
    if (S.demo) {
      if (payload.action === 'ordered') {
        var v = vendorById(payload.vendorId);
        S.orders.push({ id: 'n' + (S.orders.length + 1), Name: S.account.name, Vendor: { id: payload.vendorId, name: v ? v.name : '' }, Order_Type: payload.orderType, Items: payload.items, Order_Status: 'Placed', Order_Date: S.today, Received_Date: null, Reference: payload.reference, Source: payload.source, Case: S.caseRec ? { id: S.caseRec.id, name: S.caseRec.caseId } : null });
      } else if (payload.action === 'received') {
        S.orders.forEach(function (o) { if (o.id === payload.orderId) { o.Order_Status = 'Received'; o.Received_Date = S.today; if (payload.receivedQty) o.Received_Qty = payload.receivedQty; if (payload.serials) o.Serial_Numbers = payload.serials; } });
      }
      return Promise.resolve();
    }
    return JPK.crm.run(CONFIG.orderFn, payload).then(function (out) {
      if (out && typeof out === 'object' && out.ok === false) throw new Error(out.message || 'The function refused');
      return out;
    });
  }
  function markOrdered(btn) {
    var p = plan(); if (!p.ready) return;
    var ref = $('o-ref') ? $('o-ref').value : '', label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving...';
    var payload = L.orderPayload({ action: 'ordered', vendorId: S.vendorId, reference: ref, items: L.rowsToSuggested(devRows()), orderType: S.type, shipTo: !$('ship-wrap').hidden ? S.shipTo : '', accountId: S.account.id, caseId: S.caseRec ? S.caseRec.id : '', source: S.caseRec ? 'Case' : 'Manual' });
    call(payload).then(function (out) {
      JPK.toast(out && out.warning ? out.message : 'Order recorded'); S.rows = [{ qty: '', item: '', other: '' }]; S.shipTo = ''; $('o-ship').value = '';
      if (S.demo) { render(); return; }
      load();
    }, function (e) { btn.disabled = false; btn.textContent = label; var er = $('o-err'); er.hidden = false; er.textContent = 'Not saved: ' + (e && e.message || e); });
  }

  /* Receiving a device order asks how many arrived and their serial numbers (both optional) before closing it. */
  function openRecv(ord) {
    var n = 0; String(ord.Items || '').split(/;\s*/).forEach(function (seg) { var m = /^(\d+)\s/.exec(seg.trim()); if (m) n += +m[1]; });
    S.recv = ord; var box = $('recv'); box.hidden = false;
    box.innerHTML = '<h3>Receive devices: ' + esc(ord.Items || '') + '</h3>' +
      '<label class="sm muted" for="r-qty">How many arrived</label><input type="number" id="r-qty" min="0" max="99999" step="1" value="' + (n || '') + '">' +
      '<label class="sm muted" for="r-ser">Serial numbers (optional, one per line)</label><textarea id="r-ser" rows="4" maxlength="2000"></textarea>' +
      '<div class="row" style="margin-top:10px"><button type="button" class="btn pri" id="r-go">Mark received</button><button type="button" class="btn" id="r-x">Cancel</button></div>' +
      '<p class="muted sm">Recorded on the order. Stock levels are not changed.</p><div class="err" id="r-err" role="alert" hidden></div>';
    box.scrollIntoView({ block: 'nearest' });
  }
  /* ---------- wiring ---------- */
  $('recv').addEventListener('click', function (e) {
    if (e.target.closest('#r-x')) { $('recv').hidden = true; S.recv = null; return; }
    var go = e.target.closest('#r-go'); if (!go || !S.recv) return;
    go.disabled = true;
    call(L.orderPayload({ action: 'received', orderId: S.recv.id, receivedQty: $('r-qty').value, serials: $('r-ser').value })).then(function () {
      JPK.toast('Marked received');
      if (S.demo) { S.recv.Received_Qty = $('r-qty').value; S.recv.Serial_Numbers = $('r-ser').value; }
      $('recv').hidden = true; S.recv = null;
      if (S.demo) renderHist(); else load();
    }, function (er) { go.disabled = false; var x = $('r-err'); x.hidden = false; x.textContent = 'Not saved: ' + (er && er.message || er); });
  });
  $('o-vendor').addEventListener('change', function () { S.vendorId = this.value; var nv = S.vendorId ? vendorById(S.vendorId) : null, nk = L.usesForm(nv, S.type); if (S.type === 'Devices' || nk || S.catKey) { S.rows = [{ qty: '', item: '', other: '' }]; } S.catKey = nk ? nk.key : ''; renderRows(); renderPlan(); });
  $('o-type').addEventListener('change', function () { S.type = this.value; S.rows = [{ qty: '', item: '', other: '' }]; renderRows(); renderPlan(); renderStock(); });
  $('o-ship').addEventListener('input', function () { S.shipTo = this.value; renderPlan(); });
  $('add-row').addEventListener('click', function () { S.rows.push({ qty: '', item: '', other: '' }); renderRows(); });
  $('rows').addEventListener('input', function (e) {
    var row = e.target.closest('.item-row'); if (!row) return;
    var f = e.target.getAttribute('data-f'), i = +row.getAttribute('data-i');
    if (f === 'qty' || f === 'other') { S.rows[i][f] = e.target.value; renderPlan(); }
  });
  $('rows').addEventListener('change', function (e) {
    var row = e.target.closest('.item-row'); if (!row || e.target.getAttribute('data-f') !== 'item') return;
    S.rows[+row.getAttribute('data-i')].item = e.target.value; renderRows(); renderPlan();
  });
  $('rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]'); if (!b) return;
    S.rows.splice(+b.getAttribute('data-rm'), 1); renderRows(); renderPlan();
  });
  $('plan').addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]'), d = e.target.closest('#o-done'), p;
    if (c) { p = plan(); copyText(c.getAttribute('data-copy') === 'email' ? 'To: ' + p.email + '\nSubject: ' + p.subject + '\n\n' + p.body : p.copyText); }
    if (d) markOrdered(d);
  });
  $('hist').addEventListener('click', function (e) {
    var b = e.target.closest('[data-recv]'); if (!b) return;
    var ord = S.orders.filter(function (o) { return String(o.id) === b.getAttribute('data-recv'); })[0];
    if (ord && ord.Order_Type === 'Devices') { openRecv(ord); return; }
    b.disabled = true;
    call(L.orderPayload({ action: 'received', orderId: b.getAttribute('data-recv') })).then(function () { JPK.toast('Marked received'); if (S.demo) renderHist(); else load(); },
      function (er) { b.disabled = false; showErr('Not saved: ' + (er && er.message || er)); });
  });
  $('refresh').addEventListener('click', function () { load(); });
  JPK.aboutButton({ button: '#help', title: 'About the Order area', html:
    '<p>Prepares an accessory or device order the way this customer\'s vendor takes it, and records it.</p>' +
    '<p><b>Portal vendors</b> (Allied, SCRAM): open the portal, place the order, then Mark ordered. <b>Emailed-form vendors</b> (Buddi, SuperCom): open the draft email, attach the vendor\'s order form, send it yourself, then Mark order sent. A vendor can take devices differently from accessories (for example SCRAM: accessories by portal, devices by email to the account manager); the Order type box picks which.</p>' +
    '<p>Nothing is submitted or sent for you. The vendors offered come from the account\'s Vendors field; if it is empty, every JusticePoint EM vendor is offered.</p>' });
  JPK.crm.init().then(function (d) {
    S.demo = !!(d && d.demo) || /[?&]demo=1/.test(location.search) || !JPK.crm.available();
    S.ctx = d;
    load(d);
  });
})();
