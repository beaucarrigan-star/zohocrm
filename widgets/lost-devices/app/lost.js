/* Lost Devices view. Read-only. Counting is all in LostModel; shaping is in LostView; kit parts are JPK (jpk.js v1.2.x).
   Never reads Last_Client. Every live read keeps a WHERE clause. */
(function () {
  'use strict';
  var M = window.LostModel, V = window.LostView, esc = JPK.esc;
  var $ = function (s) { return document.querySelector(s); };

  var LOSS_FIELDS = 'id, Name, Customer.id, Customer.Account_Name, Manufacturer.Vendor_Name, Device_Type, Loss_Status, Date_Listed_Lost, Loss_Amount, Vendor_Credited, Amount_Billed, Customer_Paid, Recovered_On';
  var S = { demo: false, all: [], brandMap: {}, brandOk: true, brand: 'all', year: 'all', customer: null, tabs: null, custTbl: null, devTbl: null, chart: null };

  function showErr(msg) { var e = $('#err'); e.hidden = !msg; e.textContent = msg || ''; }

  /* ---------- data ---------- */
  function loadLosses() {
    if (S.demo) return Promise.resolve(window.LOST_DEMO.records);
    return JPK.crm.coqlAll('select ' + LOSS_FIELDS + ' from Device_Losses where id is not null');
  }
  /* Brand is a formula on Accounts. Look it up for the customers we actually have, 50 ids per query. */
  function loadBrands(records) {
    if (S.demo) { var m = {}; window.LOST_DEMO.accounts.forEach(function (a) { m[a.id] = a.Brand; }); return Promise.resolve(m); }
    var ids = {};
    records.forEach(function (r) { var n = M.normalize(r); if (n.customerId) ids[n.customerId] = true; });
    var list = Object.keys(ids), chunks = [];
    for (var i = 0; i < list.length; i += 50) chunks.push(list.slice(i, i + 50));
    var map = {};
    return chunks.reduce(function (p, ch) {
      return p.then(function () {
        var q = "select id, Brand from Accounts where id in (" + ch.map(function (x) { return "'" + String(x).replace(/[^0-9]/g, '') + "'"; }).join(',') + ')';
        return JPK.crm.coqlAll(q).then(function (rows) { rows.forEach(function (r) { map[String(r.id)] = r.Brand; }); });
      });
    }, Promise.resolve()).then(function () { return map; });
  }

  /* ---------- render ---------- */
  function moneyCell(n) { return esc(V.fmtMoney(n)); }

  function renderSum(el, list) {
    el.innerHTML = list.map(function (t) {
      var v = t.kind === 'money' ? V.fmtMoney(t.value) : String(t.value);
      return '<div><small>' + esc(t.label) + '</small><b>' + esc(v) + '</b>' + (t.sub ? '<i>' + esc(t.sub) + '</i>' : '') + '</div>';
    }).join('');
  }

  function scoped() { return V.filterYear(V.scopeByBrand(S.all, S.brand, S.brandMap), S.year); }

  function render() {
    var recs = scoped();
    var tl = V.tiles(M.summarize(recs));
    renderSum($('#sum1'), tl.primary); renderSum($('#sum2'), tl.secondary);

    /* trend */
    var tr = V.trend(V.scopeByBrand(S.all, S.brand, S.brandMap), S.year);
    var series = [{ name: 'Gross loss', points: tr.gross }, { name: 'Net loss', points: tr.net }];
    if (!tr.gross.length) { $('#trend').innerHTML = '<div class="empty"><b>No dated losses</b>Nothing in this brand and year.</div>'; S.chart = null; }
    else if (S.chart && $('#trend svg')) S.chart.setSeries(series);
    else S.chart = JPK.chart({ mount: '#trend', series: series, height: 200, yMin: 0, yFormat: V.fmtMoneyShort, ariaLabel: 'Gross and net loss by month' });
    var u = tr.undated;
    $('#trend-note').textContent = u && (u.devicesLost || u.recoveredDevices) ? (u.devicesLost + u.recoveredDevices) + ' record' + ((u.devicesLost + u.recoveredDevices) === 1 ? ' has' : 's have') + ' no date listed lost and ' + ((u.devicesLost + u.recoveredDevices) === 1 ? 'is' : 'are') + ' not in a month.' : '';

    /* by customer */
    var crows = M.byCustomer(recs);
    if (!S.custTbl) {
      S.custTbl = JPK.table({
        mount: '#cust', caption: 'Losses by customer', rows: crows,
        columns: [
          { key: 'customer', label: 'Customer', sortable: true, primary: true, render: function (r) { return '<span class="name" style="font-weight:600">' + esc(r.customer) + '</span>'; } },
          { key: 'devicesLost', label: 'Lost', align: 'right', num: true, sortable: true },
          { key: 'grossLoss', label: 'Gross', align: 'right', num: true, sortable: true, render: function (r) { return moneyCell(r.grossLoss); } },
          { key: 'netLoss', label: 'Net', align: 'right', num: true, sortable: true, render: function (r) { return moneyCell(r.netLoss); } },
          { key: 'owedByCustomers', label: 'Owed', align: 'right', num: true, sortable: true, render: function (r) { return moneyCell(r.owedByCustomers); } }
        ],
        onRowClick: function (r) { S.customer = (S.customer && S.customer.key === keyOf(r)) ? null : { key: keyOf(r), name: r.customer }; renderDevices(); },
        empty: { title: 'No customers', hint: 'No losses in this brand and year.' }
      });
    } else S.custTbl.setRows(crows);

    renderDevices();
  }
  function keyOf(r) { return r.customerId || ('name:' + r.customer); }

  function devRowsForView() {
    var recs = scoped();
    var rows = V.deviceRows(recs, S.all);
    if (S.customer) rows = rows.filter(function (r) { return (r.customerId || ('name:' + r.customer)) === S.customer.key; });
    return rows;
  }

  function evidence(r) {
    var box = document.createElement('div'); box.className = 'jp-ev';
    var dl = function (items) { return '<dl>' + items.map(function (x) { return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>'; }).join('') + '</dl>'; };
    box.innerHTML =
      '<div><h4>Device</h4>' + dl([['Serial', r.serial], ['Manufacturer', r.manufacturer || 'Not set'], ['Type', r.deviceType || 'Not set'], ['Listed lost', r.date || 'No date']]) + '</div>' +
      '<div><h4>Loss</h4>' + dl([['Status', r.status], ['Loss amount', r.amount == null ? 'Missing' : V.fmtMoney(r.amount)], ['Vendor credited', r.vendorCredited ? 'Yes' : 'No'], ['Counts toward gross', V.fmtMoney(r.gross)]]) + '</div>' +
      '<div><h4>Customer billing</h4>' + dl([['Billed', r.billed == null ? 'Not billed' : V.fmtMoney(r.billed)], ['Paid', r.billed ? (r.paid ? 'Yes' : 'No') : 'n/a'], ['Owed', V.fmtMoney(r.owed)]]) + '</div>';
    return box;
  }

  function renderDevices() {
    var rows = devRowsForView();
    $('#dev-sub').textContent = rows.length + ' device' + (rows.length === 1 ? '' : 's');
    var ac = $('#active-customer');
    ac.innerHTML = S.customer ? JPK.chip('Customer: ' + S.customer.name, 'info') + ' <button type="button" class="lnk" id="clear-cust">Clear</button>' : '';
    var c = $('#clear-cust'); if (c) c.addEventListener('click', function () { S.customer = null; renderDevices(); });

    if (!S.devTbl) {
      S.devTbl = JPK.table({
        mount: '#dev', caption: 'Devices', rows: rows, cards: true, expand: evidence,
        expandLabel: function (r) { return 'Show details for ' + r.serial; },
        filterLabel: 'Show',
        filters: [
          { key: 'open', label: 'Lost or damaged', test: function (r) { return r.open; } },
          { key: 'recovered', label: 'Recovered', test: function (r) { return r.recovered; } },
          { key: 'missing', label: 'Amount missing', test: function (r) { return r.amountMissing; } },
          { key: 'dup', label: 'Duplicate serial', test: function (r) { return r.duplicate; } }
        ],
        filter: 'all',
        columns: [
          { key: 'serial', label: 'Serial', primary: true, sortable: true, render: function (r) { return '<span class="mono">' + esc(r.serial) + '</span>'; } },
          { key: 'customer', label: 'Customer', sortable: true },
          { key: 'deviceType', label: 'Type', sortable: true },
          { key: 'status', label: 'Status', sortable: true, render: function (r) { return JPK.chip(r.status, r.open ? 'warn' : r.recovered ? 'good' : 'neutral'); } },
          { key: 'date', label: 'Listed', sortable: true },
          { key: 'amount', label: 'Loss amount', align: 'right', num: true, sortable: true, sortValue: function (r) { return r.amount; }, render: function (r) { return r.amount == null ? '<span class="badge warn">Amount missing</span>' : moneyCell(r.amount); } },
          { key: 'flags', label: 'Flags', full: true, render: function (r) { return r.duplicate ? '<span class="badge bad ld-flag">Duplicate serial</span>' : ''; } }
        ],
        empty: { title: 'No devices', hint: 'Nothing matches this brand, year, customer and filter.' }
      });
    } else S.devTbl.setRows(rows);
  }

  /* ---------- controls ---------- */
  function setupTabs() {
    var counts = V.brandCounts(S.all, S.brandMap);
    var list = V.BRANDS.map(function (b) { return { id: b.key, label: b.label, count: counts[b.key] || 0 }; });
    S.tabs = JPK.tabs({ mount: '#brands', tabs: list, selected: S.brand, label: 'Brand', onChange: function (id) { S.brand = id; S.customer = null; render(); } });
    $('#brands').style.marginTop = '0';
    var m = counts.none;
    if (!S.brandOk) $('#ctx').textContent += ' · Brand lookup failed: only All brands is reliable';
    else if (m) $('#ctx').textContent += ' · ' + m + ' record' + (m === 1 ? '' : 's') + ' with no brand show under All brands only';
  }
  function setupYear() {
    var ys = V.yearOptions(S.all), sel = $('#year');
    sel.innerHTML = '<option value="all">All years</option>' + ys.map(function (y) { return '<option value="' + esc(y) + '">' + esc(y) + '</option>'; }).join('');
    sel.value = S.year;
    sel.addEventListener('change', function () { S.year = sel.value; S.customer = null; render(); });
  }
  JPK.aboutButton({ button: '#help', title: 'About lost devices', html:
    '<p>Every device listed as lost, damaged or recovered, from the Device Losses module. This page only reads.</p>' +
    '<p><b>Devices lost</b> counts Lost and Damaged. <b>Gross loss</b> is the loss amount for those, plus recovered devices the vendor has not credited. A recovered device with a vendor credit moves to <b>Recovered value</b>.</p>' +
    '<p><b>Net loss</b> is gross minus what customers have paid. <b>Owed by customers</b> is billed but not yet paid.</p>' +
    '<p>Each loss sits in the month it was listed lost; a later recovery or payment changes that same month.</p>' +
    '<p><b>Amount missing</b> devices are still counted as devices but add $0 until the loss amount is filled in.</p>' });

  /* ---------- start ---------- */
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    return loadLosses().then(function (rows) {
      S.all = rows;
      return loadBrands(rows).then(function (m) { S.brandMap = m; }, function () { S.brandOk = false; });
    }).then(function () {
      $('#ctx').textContent = S.all.length + ' record' + (S.all.length === 1 ? '' : 's');
      setupYear(); setupTabs(); render();
    });
  }).catch(function (e) {
    $('#ctx').textContent = '';
    showErr('Could not load device losses: ' + e.message + '. The module is Administrator-only until profile access is granted.');
  });
})();
