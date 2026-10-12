/* ship.js: Accessory board. Recommendations and their linked shipments together.
   Needs jpk.css/jpk.js (JPK v1.1.0), ship-logic.js, demo-data.js. Read-only against the CRM; the only write is the optional
   Mark contacted call, which stays off until CONFIG.markFn names a standalone function. */
(function () {
  'use strict';
  var L = window.ShipLogic, esc = JPK.esc;
  var CONFIG = {
    orderFn: 'accessory_order',           /* standalone wrapper for accessory_order.dg (SETUP-CHECKLIST ordering steps). Empty = Mark ordered stays off. */
    markFn: 'accessory_mark_contacted',            /* set to the standalone wrapper name once Beau creates it (see SETUP-CHECKLIST step 9). Empty = button stays off. */
    lookbackDays: 180,     /* shipments older than this are not loaded */
    recFields: 'id, Name, Account, Program_Units, Cadence, Interval_Days, Last_Accessory_Ship_Date, Days_Since_Last, Next_Due_Date, Status, Suggested_Order, Last_Shipment_Summary, Shipments_90_Days, Recommendation_Date, Note, Last_Contacted_Date, Last_Order_Placed_Date, Handled_By',
    orderRecFields: ', Order_Vendor, Order_Reference',
    vendorQuery: 'select id, Vendor_Name, Accessory_Order_Method, Customer_Portal, Accessory_Order_Email, Accessory_Order_Template from Vendors where EM_JusticePoint_Vendor = true',
    shipFields: 'id, Name, Account, Allied_Customer, Ship_Date, Order_Number, Packing_Slip, Tracking_Number, Is_Accessory, Quantity, Straps, Pin_Trays, Tamper_Plugs, Chargers, Tools, Devices'
  };
  var S = { vendors: [], orderSetup: true, demo: false, today: '', me: null, recs: [], ships: [], board: null, table: null, nx: null, busy: false, warn: '' };

  function $(id) { return document.getElementById(id); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function cutoff() { return L.fromDay(L.toDay(S.today) - CONFIG.lookbackDays); }
  function showErr(msg) { var e = $('err'); e.hidden = !msg; e.textContent = msg || ''; }

  /* ---------- data ---------- */
  function loadDemo() {
    var D = window.SHIP_DEMO;
    S.demo = true; S.today = D.today; S.me = D.me;
    S.recs = JSON.parse(JSON.stringify(D.recs)); S.ships = JSON.parse(JSON.stringify(D.ships));
    S.vendors = L.normVendors(D.vendors); S.orderSetup = true;
    return Promise.resolve();
  }
  function loadLive() {
    S.today = todayStr();
    var me = null;
    try {
      if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.CONFIG && ZOHO.CRM.CONFIG.getCurrentUser) {
        me = ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; S.me = u ? { id: String(u.id), name: u.full_name } : null; }, function () { S.me = null; });
      }
    } catch (e) { me = null; }
    /* Order_Vendor / Order_Reference and the Vendors ordering fields exist only after setup. Without them the board still works; ordering shows a setup note. */
    var recQ = function (extra) { return 'select ' + CONFIG.recFields + extra + ' from Accessory_Order_Recommendations where id is not null'; };
    var p1 = JPK.crm.coqlAll(recQ(CONFIG.orderRecFields)).then(function (r) { S.orderSetup = true; return r; }, function () {
      S.orderSetup = false; return JPK.crm.coqlAll(recQ(''));
    });
    var p2 = JPK.crm.coqlAll('select ' + CONFIG.shipFields + " from Accessory_Shipments where Is_Accessory = true and Ship_Date >= '" + cutoff() + "'");
    var p3 = JPK.crm.coqlAll(CONFIG.vendorQuery).then(function (r) { return r; }, function () { S.orderSetup = false; return []; });
    return Promise.all([p1, p2, p3, me]).then(function (r) { S.recs = r[0]; S.ships = r[1]; S.vendors = L.normVendors(r[2]); });
  }
  function rebuild() {
    S.board = L.build(S.recs, S.ships, S.today);
    render();
  }
  function load() {
    showErr('');
    S.busy = true;
    var go = S.demo ? loadDemo() : loadLive();
    go.then(function () { S.busy = false; rebuild(); }, function (e) {
      S.busy = false; showErr('Could not load accessory data: ' + (e && e.message || e));
      $('asof').textContent = 'Load failed';
    });
  }

  /* ---------- render ---------- */
  var BUCKET = {
    overdue: ['Overdue', 'bad'], due: ['Due', 'warn'], chase: ['Chase', 'warn'], shipped: ['Shipped, confirm', 'info'],
    waiting: ['Waiting', 'neutral'], ok: ['OK', 'good']
  };
  function statusChip(a) { var b = BUCKET[a.bucket]; return JPK.chip(b[0], b[1]) + (a.stale ? ' <span class="muted sm" title="Stored status (' + esc(a.storedStatus) + ') is out of date; shown from live shipments">updated</span>' : ''); }
  function waitText(a) {
    if (a.bucket === 'overdue' || a.bucket === 'due') return a.daysOverdue + ' day' + (a.daysOverdue === 1 ? '' : 's') + ' past due';
    if (a.bucket === 'chase') return 'Contacted ' + a.contactedAgo + ' days ago, no order';
    if (a.bucket === 'shipped') return 'Shipped ' + a.shippedSinceList[0].Ship_Date;
    if (a.bucket === 'waiting') return a.status === 'Ordered' ? 'Order placed' : 'Contacted ' + a.contactedAgo + ' days ago';
    return a.nextDueDate ? 'Next due ' + a.nextDueDate : '';
  }
  function renderTiles(c) {
    var items = [
      ['Overdue', c.overdue, 'hot', 'past their due date'], ['Due', c.due, 'warn', 'due this week'],
      ['Chase', c.chase, 'warn', 'contacted, no order yet'], ['Shipped, confirm', c.shipped, '', 'shipped since flagged'],
      ['Waiting', c.waiting, '', 'contacted or ordered'], ['OK', c.ok, 'good', 'not due']
    ];
    $('tiles').innerHTML = items.map(function (i) {
      return '<div class="tile ' + i[2] + '"><small>' + esc(i[0]) + '</small><b>' + i[1] + '</b><i>' + esc(i[3]) + '</i></div>';
    }).join('');
    $('tiles-sub').textContent = c.total + ' customers';
  }
  function render() {
    var b = S.board, c = b.counts;
    $('asof').textContent = 'As of ' + S.today + '. ' + S.ships.length + ' shipments read from the last ' + CONFIG.lookbackDays + ' days.';
    $('demo-flag').hidden = !S.demo;
    renderTiles(c);
    var worst = b.rows.filter(function (a) { return a.bucket === 'overdue'; })[0];
    if (!S.nx) S.nx = JPK.next({ mount: '#next', title: '', button: null });
    S.nx.update({
      title: c.needs ? c.needs + ' customer' + (c.needs === 1 ? '' : 's') + ' need an order conversation.' : 'Nothing needs you right now.',
      sub: worst ? 'Longest wait: ' + worst.accountName + ', ' + worst.daysOverdue + ' days past due.' : (c.waiting ? c.waiting + ' waiting on a customer or a shipment.' : ''),
      progress: c.total ? Math.round(100 * (c.total - c.needs) / c.total) : 100,
      button: c.needs ? { label: 'Show my work', onClick: function () { S.table.setFilter('mine'); } } : null
    });
    var meId = S.me && S.me.id;
    var cols = [
      { key: 'accountName', label: 'Customer', sortable: true, render: function (a) { return '<span class="cell-main">' + esc(a.accountName) + '</span><span class="cell-sub">' + esc(a.cadence) + (a.units != null ? ', ' + a.units + ' units' : '') + '</span>'; } },
      { key: 'bucket', label: 'Status', sortable: true, sortValue: function (a) { return ['overdue', 'chase', 'due', 'shipped', 'waiting', 'ok'].indexOf(a.bucket); }, render: statusChip },
      { key: 'daysOverdue', label: 'Wait', sortable: true, num: true, sortValue: function (a) { return a.daysOverdue; }, render: function (a) { return esc(waitText(a)); } },
      { key: 'lastShipDate', label: 'Last shipped', sortable: true, render: function (a) { return a.lastShipDate ? esc(a.lastShipDate) + '<span class="cell-sub">' + a.daysSince + ' days ago</span>' : '<span class="muted">None</span>'; } },
      { key: 'suggested', label: 'Recommended', render: function (a) { return '<span class="suggest">' + esc(a.suggested) + '</span>'; } },
      { key: 'vendorName', label: 'Vendor', sortable: true, sortValue: function (a) { return vendorName(a.vendorId) || null; }, render: function (a) { var n = vendorName(a.vendorId); return n ? esc(n) : '<span class="muted">Choose</span>'; } },
      { key: 'handledByName', label: 'Handled by', sortable: true, render: function (a) { return a.handledByName ? esc(a.handledByName) : '<span class="muted">Unassigned</span>'; } }
    ];
    var filters = [
      { key: 'mine', label: 'Needs me (' + b.rows.filter(function (a) { return L.needsMe(a, meId); }).length + ')', test: function (a) { return L.needsMe(a, meId); } },
      { key: 'overdue', label: 'Overdue (' + c.overdue + ')', test: function (a) { return a.bucket === 'overdue'; } },
      { key: 'waiting', label: 'Waiting (' + (c.waiting + c.chase) + ')', test: function (a) { return a.bucket === 'waiting' || a.bucket === 'chase'; } },
      { key: 'all', label: 'All (' + c.total + ')', test: function () { return true; } }
    ];
    var keep = S.table ? S.table.getFilter() : 'mine';
    S.table = JPK.table({ mount: '#list', caption: 'Accessory recommendations with shipment status', columns: cols, rows: b.rows, filters: filters, filterLabel: 'Show',
      empty: { title: 'Nothing here', hint: 'No customers in this view.' }, onRowClick: openRow });
    S.table.setFilter(keep);
    var n = b.unmatched.length;
    $('foot').textContent = n ? n + ' accessory shipment' + (n === 1 ? ' has' : 's have') + ' no Account, so they cannot be matched to a customer. Fix the Account on those shipments.' : '';
  }

  function vendorById(id) { for (var i = 0; i < S.vendors.length; i++) if (S.vendors[i].id === String(id)) return S.vendors[i]; return null; }
  function vendorName(id) { var v = id ? vendorById(id) : null; return v ? v.name : ''; }

  /* ---------- drawer: recommended vs shipped ---------- */
  function openRow(a) {
    var rec = a.rec;
    var html = '<div class="row" style="margin-bottom:10px">' + statusChip(a) + '<span class="muted sm">' + esc(waitText(a)) + '</span></div>' +
      '<div class="dr-h">What was recommended</div><div class="q">' + esc(a.suggested || 'No suggested order.') + '</div>' +
      '<dl class="dl" style="margin-top:10px"><dt>Cadence</dt><dd>' + esc(a.cadence || 'Not set') + ' (every ' + a.interval + ' days)</dd>' +
      '<dt>Recommended on</dt><dd>' + esc(rec.Recommendation_Date || 'Not set') + '</dd>' +
      '<dt>Next due</dt><dd>' + esc(a.nextDueDate || 'Not set') + '</dd>' +
      '<dt>Last contacted</dt><dd>' + esc(rec.Last_Contacted_Date || 'Not yet') + '</dd>' +
      '<dt>Last order placed</dt><dd>' + esc(rec.Last_Order_Placed_Date || 'Not yet') + '</dd></dl>' +
      '<div class="dr-h">What shipped (' + a.ships.length + ' in ' + CONFIG.lookbackDays + ' days)</div>' + shipHtml(a) +
      '<div class="dr-h">Order</div><div id="dr-order" class="order"></div>' +
      '<div class="dr-actions" id="dr-act"></div><div class="err" id="dr-err" role="alert" hidden></div>' +
      (a.note ? '<div class="dr-h">Note</div><div class="q">' + esc(a.note) + '</div>' : '');
    JPK.drawer.open({ title: a.accountName, html: html, onMount: function (body) { mountOrder(a, body); mountActions(a, body); } });
  }
  function shipHtml(a) {
    if (!a.ships.length) return '<p class="muted">No accessory shipments in the window.</p>';
    var since = {};
    a.shippedSinceList.forEach(function (s) { since[s.id] = 1; });
    return '<ul class="ship-list">' + a.ships.slice(0, 8).map(function (s) {
      return '<li class="' + (since[s.id] ? 'new' : '') + '"><b>' + esc(s.Ship_Date) + '</b> ' + esc(L.describeShipment(s)) + (since[s.id] ? ' ' + JPK.chip('after the recommendation', 'info') : '') +
        '<span class="cell-sub">' + [s.Order_Number ? 'Order ' + s.Order_Number : '', s.Tracking_Number ? 'Tracking ' + s.Tracking_Number : ''].filter(Boolean).map(esc).join(', ') + '</span></li>';
    }).join('') + '</ul>';
  }

  /* ---------- ordering ---------- */
  function copyText(text, done) {
    var ok = function () { JPK.toast(done || 'Copied'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text, ok); }); return; }
    } catch (e) { /* fall through */ }
    fallbackCopy(text, ok);
  }
  function fallbackCopy(text, ok) {
    var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { JPK.toast('Select the text and copy it by hand'); }
    document.body.removeChild(t);
  }
  function orderCall(a, vendorId, action, reference) {
    if (S.demo) {
      a.rec.Order_Vendor = vendorId ? { id: vendorId, name: vendorName(vendorId) } : null;
      a.vendorId = vendorId || null;
      if (action === 'ordered') { a.rec.Status = 'Ordered'; a.rec.Last_Order_Placed_Date = S.today; a.rec.Order_Reference = reference || null; if (S.me && !a.rec.Handled_By) a.rec.Handled_By = S.me; }
      return Promise.resolve();
    }
    return JPK.crm.run(CONFIG.orderFn, L.orderPayload({ recId: a.id, vendorId: vendorId, action: action, reference: reference, items: a.suggested, accountId: a.accountId, source: 'Recommendation' })).then(function (out) {
      if (out && typeof out === 'object' && out.ok === false) throw new Error(out.message || 'The function refused');
      S.warn = (out && out.warning) ? out.message : '';
      a.rec.Order_Vendor = vendorId ? { id: vendorId, name: vendorName(vendorId) } : null; a.vendorId = vendorId || null;
      if (action === 'ordered') { a.rec.Status = 'Ordered'; a.rec.Last_Order_Placed_Date = S.today; a.rec.Order_Reference = reference || null; }
    });
  }
  function mountOrder(a, body) {
    var box = body.querySelector('#dr-order');
    if (!L.canOrder(a)) { box.innerHTML = '<p class="muted">' + (a.status === 'Ordered' ? 'An order was placed' + (a.rec.Last_Order_Placed_Date ? ' on ' + esc(a.rec.Last_Order_Placed_Date) : '') + (a.orderRef ? ' (' + esc(a.orderRef) + ')' : '') + '.' : 'No order needed.') + '</p>'; return; }
    if (!S.orderSetup) { box.innerHTML = '<p class="muted">Ordering is not set up yet. The vendor fields are added in the setup checklist (ordering steps).</p>'; return; }
    var enabled = S.demo || !!CONFIG.orderFn, vendorId = a.vendorId || '';
    function draw() {
      var plan = L.orderPlan(a, vendorId ? vendorById(vendorId) : null, S.today);
      var opts = '<option value="">Choose a vendor</option>' + S.vendors.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
      var h = '<label class="sm muted" for="ord-v">Vendor</label><select id="ord-v" aria-label="Vendor to order from">' + opts + '</select>';
      if (plan.kind === 'choose') h += '<p class="muted sm">' + esc(plan.problem) + ' Your choice is remembered for this customer.</p>';
      else if (plan.problem) h += '<p class="err">' + esc(plan.problem) + '</p>';
      if (plan.kind === 'portal' && plan.ready) {
        h += '<div class="q" style="margin:10px 0">' + esc(plan.copyText).replace(/\n/g, '<br>') + '</div>' +
          '<div class="row"><a class="btn pri" id="ord-open" href="' + esc(plan.portalUrl) + '" target="_blank" rel="noopener noreferrer">Open ' + esc(plan.vendorName) + ' portal</a>' +
          '<button type="button" class="btn" id="ord-copy">Copy order lines</button></div>' +
          '<p class="muted sm">Place the order in the portal, then record it here.</p>' +
          '<label class="sm muted" for="ord-ref">Portal order number (optional)</label><input type="text" id="ord-ref" maxlength="80">' +
          '<div class="row" style="margin-top:8px"><button type="button" class="btn pri" id="ord-done"' + (enabled ? '' : ' disabled') + '>Mark ordered</button>' + (enabled ? '' : '<span class="muted sm">Not connected yet.</span>') + '</div>';
      } else if (plan.kind === 'form' && plan.ready) {
        h += '<dl class="dl" style="margin-top:10px"><dt>To</dt><dd>' + esc(plan.email) + '</dd><dt>Subject</dt><dd>' + esc(plan.subject) + '</dd>' +
          '<dt>Attach</dt><dd>' + (plan.template ? esc(plan.template) : '<span class="muted">No template on the vendor record yet</span>') + '</dd></dl>' +
          '<div class="q" style="margin-bottom:10px">' + esc(plan.body).replace(/\n/g, '<br>') + '</div>' +
          '<div class="row"><a class="btn pri" id="ord-open" href="' + esc(plan.mailto) + '">Open email draft</a><button type="button" class="btn" id="ord-copy">Copy email text</button></div>' +
          '<p class="muted sm">You review and send the email. The board never sends it.</p>' +
          '<div class="row" style="margin-top:8px"><button type="button" class="btn pri" id="ord-done"' + (enabled ? '' : ' disabled') + '>Mark order sent</button>' + (enabled ? '' : '<span class="muted sm">Not connected yet.</span>') + '</div>';
      }
      h += '<div class="err" id="ord-err" role="alert" hidden></div>';
      box.innerHTML = h;
      var sel = box.querySelector('#ord-v');
      sel.addEventListener('change', function () {
        vendorId = sel.value; draw();
        if (vendorId && enabled) orderCall(a, vendorId, 'vendor', '').then(function () { JPK.toast('Remembered ' + vendorName(vendorId) + ' for ' + a.accountName); rebuildQuiet(); }, function (e) { showOrderErr('Vendor not saved: ' + (e && e.message || e)); });
      });
      var cp = box.querySelector('#ord-copy');
      if (cp) cp.addEventListener('click', function () { copyText(plan.kind === 'form' ? 'To: ' + plan.email + '\nSubject: ' + plan.subject + '\n\n' + plan.body : plan.copyText, 'Copied'); });
      var dn = box.querySelector('#ord-done');
      if (dn) dn.addEventListener('click', function () {
        var ref = box.querySelector('#ord-ref'); dn.disabled = true; var label = dn.textContent; dn.textContent = 'Saving...';
        orderCall(a, vendorId, 'ordered', ref ? ref.value : '').then(function () {
          JPK.drawer.close(); JPK.toast(S.warn || ('Order recorded: ' + a.accountName)); S.warn = ''; rebuild();
        }, function (e) { dn.disabled = false; dn.textContent = label; showOrderErr('Not saved: ' + (e && e.message || e)); });
      });
    }
    function showOrderErr(m) { var er = box.querySelector('#ord-err'); if (er) { er.hidden = false; er.textContent = m; } }
    draw();
  }
  function rebuildQuiet() { S.board = L.build(S.recs, S.ships, S.today); }

  function mountActions(a, body) {
    var box = body.querySelector('#dr-act'), canMark = a.status !== 'Contacted' && a.status !== 'Ordered' && a.status !== 'No order needed';
    var enabled = S.demo || !!CONFIG.markFn;
    box.innerHTML = '<button type="button" class="btn pri" id="mk"' + (canMark && enabled ? '' : ' disabled') + '>Mark contacted</button>' +
      '<button type="button" class="btn" id="op">Open record</button>' +
      (!canMark ? '<span class="muted sm">Already ' + esc(a.status.toLowerCase()) + '.</span>' : (!enabled ? '<span class="muted sm">Not connected yet. Use the button on the record.</span>' : ''));
    var mk = body.querySelector('#mk'), op = body.querySelector('#op');
    op.addEventListener('click', function () {
      try { ZOHO.CRM.UI.Record.open({ Entity: 'Accessory_Order_Recommendations', RecordID: a.id }); } catch (e) { JPK.toast(S.demo ? 'Demo: would open the record' : 'Could not open the record'); }
    });
    mk.addEventListener('click', function () {
      mk.disabled = true; mk.textContent = 'Saving...';
      markContacted(a).then(function () {
        JPK.drawer.close(); JPK.toast(S.warn || ('Marked contacted: ' + a.accountName)); S.warn = '';
        rebuild();
      }, function (e) {
        mk.disabled = false; mk.textContent = 'Mark contacted';
        var er = body.querySelector('#dr-err'); er.hidden = false; er.textContent = 'Not saved: ' + (e && e.message || e);
      });
    });
  }
  function markContacted(a) {
    if (S.demo) {
      a.rec.Status = 'Contacted'; a.rec.Last_Contacted_Date = S.today;
      if (S.me) a.rec.Handled_By = S.me;
      return Promise.resolve();
    }
    return JPK.crm.run(CONFIG.markFn, L.markPayload(a.id, '')).then(function (out) {
      if (out && typeof out === 'object' && out.ok === false) throw new Error(out.message || 'The function refused');
      S.warn = (out && out.warning) ? out.message : '';
      var r = a.rec; r.Status = 'Contacted'; r.Last_Contacted_Date = S.today; if (S.me) r.Handled_By = S.me;
    });
  }

  /* ---------- boot ---------- */
  JPK.aboutButton({ button: '#help', title: 'About the Accessory board', html:
    '<p>One list for accessory orders. Each row is a customer with a recommendation. Click it to see what was recommended and what actually shipped.</p>' +
    '<p><b>Overdue</b>: past the next due date by more than a week. <b>Due</b>: up to a week past. <b>Chase</b>: contacted over a week ago with no order. <b>Shipped, confirm</b>: an accessory shipment left after the recommendation, so the item may be done. <b>Waiting</b>: contacted recently or ordered.</p>' +
    '<p><b>Ordering</b>: open a row, choose the vendor, and use the Order panel. Portal vendors open their portal with your order lines ready to copy. Emailed-form vendors get a draft email you review and send. Mark ordered records it. Nothing is ever sent or submitted for you.</p><p>Shipments are matched to a recommendation by Account. Device-only shipments are not counted. Nothing here changes the CRM except Mark contacted.</p>' });
  $('refresh').addEventListener('click', load);
  JPK.crm.init().then(function (d) {
    var forceDemo = /[?&]demo=1/.test(location.search);
    S.demo = !!(d && d.demo) || forceDemo || !JPK.crm.available();
    load();
  });
})();
