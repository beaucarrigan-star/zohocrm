/* Lost Devices view. Reads, and for Administrator and EM Support adds, edits and changes status. Counting is all in LostModel; shaping is in LostView; kit parts are JPK (jpk.js v1.2.x).
   Never reads Last_Client. Every live read keeps a WHERE clause. */
(function () {
  'use strict';
  var M = window.LostModel, V = window.LostView, E = window.LostEditModel, esc = JPK.esc;
  var $ = function (s) { return document.querySelector(s); };

  var LOSS_FIELDS = 'id, Name, Customer.id, Customer.Account_Name, Manufacturer.Vendor_Name, Device_Model.Name, Device_Type, Loss_Status, Date_Listed_Lost, Loss_Amount, Vendor_Credited, Amount_Billed, Customer_Paid, Recovered_On';
  var S = { demo: false, all: [], brandMap: {}, brandOk: true, brand: 'all', year: 'all', customer: null, mfr: '', model: '', tabs: null, custTbl: null, devTbl: null, chart: null, profile: '', canWrite: false, canMoney: false, models: [], busy: false, demoSeq: 0 };

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

  function equip(list) { return V.filterEquipment(list, { manufacturer: S.mfr, model: S.model }); }
  function scoped() { return equip(V.filterYear(V.scopeByBrand(S.all, S.brand, S.brandMap), S.year)); }

  function render() {
    var recs = scoped();
    var tl = V.tiles(M.summarize(recs));
    renderSum($('#sum1'), tl.primary); renderSum($('#sum2'), tl.secondary);

    /* trend */
    var tr = V.trend(equip(V.scopeByBrand(S.all, S.brand, S.brandMap)), S.year);
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
          { key: 'status', label: 'Status', sortable: true, render: function (r) {
            if (!S.canWrite) return JPK.chip(r.status, r.open ? 'warn' : r.recovered ? 'good' : 'neutral');
            return '<select class="ld-st" data-id="' + esc(r.id) + '" aria-label="Status for ' + esc(r.serial) + '">' + E.LISTS.statuses.map(function (x) { return '<option' + (x === r.status ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>';
          } },
          { key: 'date', label: 'Listed', sortable: true },
          { key: 'amount', label: 'Loss amount', align: 'right', num: true, sortable: true, sortValue: function (r) { return r.amount; }, render: function (r) { return r.amount == null ? '<span class="badge warn">Amount missing</span>' : moneyCell(r.amount); } },
          { key: 'flags', label: 'Flags', full: true, render: function (r) { return r.duplicate ? '<span class="badge bad ld-flag">Duplicate serial</span>' : ''; } }
        ].concat(S.canWrite ? [{ key: 'edit', label: 'Edit', full: true, render: function (r) { return '<button type="button" class="btn ld-edit" data-id="' + esc(r.id) + '" aria-label="Edit ' + esc(r.serial) + '">Edit</button>'; } }] : []),
        empty: { title: 'No devices', hint: 'Nothing matches this brand, year, customer and filter.' }
      });
    } else S.devTbl.setRows(rows);
  }

  /* ---------- controls ---------- */
  function setupTabs() {
    var counts = V.brandCounts(S.all, S.brandMap);
    var list = V.BRANDS.map(function (b) { return { id: b.key, label: b.label, count: counts[b.key] || 0 }; });
    S.tabs = JPK.tabs({ mount: '#brands', tabs: list, selected: S.brand, label: 'Brand', onChange: function (id) { S.brand = id; S.customer = null; fillEquip(); render(); } });
    $('#brands').style.marginTop = '0';
    var m = counts.none, t = ctxText();
    if (!S.brandOk) t += ' · Brand lookup failed: only All brands is reliable';
    else if (m) t += ' · ' + m + ' record' + (m === 1 ? '' : 's') + ' with no brand show under All brands only';
    $('#ctx').textContent = t;
  }
  function fillYears() {
    var ys = V.yearOptions(S.all), sel = $('#year');
    sel.innerHTML = '<option value="all">All years</option>' + ys.map(function (y) { return '<option value="' + esc(y) + '">' + esc(y) + '</option>'; }).join('');
    if (S.year !== 'all' && ys.indexOf(S.year) === -1 && ys.map(String).indexOf(String(S.year)) === -1) S.year = 'all';
    sel.value = S.year;
  }
  function setupYear() {
    fillYears();
    var sel = $('#year');
    sel.addEventListener('change', function () { S.year = sel.value; S.customer = null; fillEquip(); render(); });
  }
  /* Manufacturer and model menus. Options follow brand and year; model options follow the chosen manufacturer. */
  function fillEquip() {
    var base = V.filterYear(V.scopeByBrand(S.all, S.brand, S.brandMap), S.year);
    function fill(sel, opts, cur, allLabel) {
      sel.innerHTML = '<option value="">' + allLabel + '</option>' + opts.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + ' (' + o.count + ')</option>'; }).join('');
      var ok = !cur || opts.some(function (o) { return o.value === cur; });
      sel.value = ok ? cur : ''; return ok ? cur : '';
    }
    S.mfr = fill($('#f-mfr'), V.facetOptions(base, 'manufacturer'), S.mfr, 'All manufacturers');
    S.model = fill($('#f-model'), V.facetOptions(V.filterEquipment(base, { manufacturer: S.mfr }), 'model'), S.model, 'All models');
  }
  function setupEquip() {
    fillEquip();
    $('#f-mfr').addEventListener('change', function () { S.mfr = $('#f-mfr').value; S.customer = null; fillEquip(); render(); });
    $('#f-model').addEventListener('change', function () { S.model = $('#f-model').value; S.customer = null; render(); });
  }
  function ctxText() {
    var n = S.all.length; return n + ' record' + (n === 1 ? '' : 's');
  }
  function aboutHtml() {
    return '<p>Every device listed as lost, damaged or recovered, from the Device Losses module. ' + (S.canWrite ? 'Use <b>Add lost device</b> to log a new one, the status menu in the table to change a status, and <b>Edit</b> to change other fields. Loss amount fills in from the replacement cost.' : 'This page only reads.') + '</p>' +
    '<p><b>Devices lost</b> counts Lost and Damaged. <b>Gross loss</b> is the loss amount for those, plus recovered devices the vendor has not credited. A recovered device with a vendor credit moves to <b>Recovered value</b>.</p>' +
    '<p><b>Net loss</b> is gross minus what customers have paid. <b>Owed by customers</b> is billed but not yet paid.</p>' +
    '<p>Each loss sits in the month it was listed lost; a later recovery or payment changes that same month.</p>' +
    '<p><b>Amount missing</b> devices are still counted as devices but add $0 until the loss amount is filled in.</p>';
  }
  var about = JPK.aboutButton({ button: '#help', title: 'About lost devices', html: aboutHtml() });

  /* ---------- writes (Administrator and EM Support only) ---------- */
  var WRITE_ENTITY = 'Device_Losses';
  function zerrMsg(res) {
    var d = res && res.data && res.data[0];
    return (d && (d.message || d.code)) || (res && res.message) || 'Zoho did not accept the change.';
  }
  /* Resolves with the record id. The workflow trigger lets Loss Amount and Status Date fill in. */
  function zohoWrite(id, payload) {
    if (S.demo) return Promise.resolve(id || ('demo-' + (++S.demoSeq)));
    var data = Object.assign({}, payload);
    var p = id ? (data.id = id, ZOHO.CRM.API.updateRecord({ Entity: WRITE_ENTITY, APIData: data, Trigger: ['workflow'] }))
               : ZOHO.CRM.API.insertRecord({ Entity: WRITE_ENTITY, APIData: data, Trigger: ['workflow'] });
    return p.then(function (res) {
      var d = res && res.data && res.data[0];
      if (!d || d.code !== 'SUCCESS') throw new Error(zerrMsg(res));
      return id || (d.details && d.details.id);
    });
  }
  function findRec(id) { for (var i = 0; i < S.all.length; i++) if (String(S.all[i].id) === String(id)) return S.all[i]; return null; }
  function putRec(rec) {
    for (var i = 0; i < S.all.length; i++) if (String(S.all[i].id) === String(rec.id)) { S.all[i] = rec; return; }
    S.all.push(rec);
  }
  /* After a write: store the record (re-read live so workflow-filled fields show), fix brands, redraw. */
  function afterWrite(id, payload, names, existing) {
    var local = E.applyLocal(existing || { id: id }, payload, names); local.id = id;
    if (S.demo) { if (!existing && local.Loss_Amount === undefined && payload.Device_Model) { var m = S.models.filter(function (x) { return x.id === payload.Device_Model.id; })[0]; if (m && m.cost != null) local.Loss_Amount = m.cost; } return Promise.resolve(local); }
    return JPK.crm.coql('select ' + LOSS_FIELDS + " from Device_Losses where id = '" + String(id).replace(/[^0-9]/g, '') + "'").then(function (r) { return r.rows[0] || local; }, function () { return local; });
  }
  function refreshAfter(rec) {
    putRec(rec);
    var cid = rec['Customer.id'], need = cid && !(String(cid) in S.brandMap);
    var done = need && !S.demo ? loadBrands([rec]).then(function (m) { Object.keys(m).forEach(function (k) { S.brandMap[k] = m[k]; }); }, function () { S.brandOk = false; }) : Promise.resolve();
    return done.then(function () { fillYears(); setupTabs(); fillEquip(); render(); });
  }
  function doSave(id, payload, names) {
    if (S.busy) return Promise.reject(new Error('Another save is still running.'));
    S.busy = true;
    var existing = id ? findRec(id) : null;
    return zohoWrite(id, payload).then(function (newId) {
      return afterWrite(newId, payload, names, existing).then(function (rec) { return refreshAfter(rec).then(function () { return rec; }); });
    }).then(function (rec) {
      S.busy = false;
      JPK.toast((id ? 'Saved ' : 'Added ') + (rec.Name || '') + (rec.Loss_Amount == null && !S.demo ? '. Loss amount fills in a moment.' : '.'));
      return rec;
    }, function (e) { S.busy = false; throw e; });
  }

  function loadModels() {
    if (S.demo) { S.models = (window.LOST_DEMO.models || []).slice(); return Promise.resolve(); }
    return JPK.crm.coqlAll('select id, Name, Manufacturer.id, Manufacturer.Vendor_Name, Device_Type from Replacement_Costs where id is not null').then(function (rows) {
      var seen = {};
      S.models = rows.filter(function (r) { var k = r.id; if (seen[k]) return false; seen[k] = 1; return true; }).map(function (r) {
        return { id: String(r.id), name: r.Name, deviceType: r.Device_Type || '', manufacturer: r['Manufacturer.id'] ? { id: String(r['Manufacturer.id']), name: r['Manufacturer.Vendor_Name'] || '' } : null };
      });
    }, function () { S.models = []; });
  }
  function knownCustomers() {
    var seen = {}, out = [];
    S.all.forEach(function (r) { var n = M.normalize(r); if (n.customerId && n.customer && !seen[n.customerId]) { seen[n.customerId] = 1; out.push({ id: String(n.customerId), name: n.customer }); } });
    return out;
  }
  function searchCustomers(q) {
    if (S.demo) { var l = q.toLowerCase(); return Promise.resolve(knownCustomers().filter(function (c) { return c.name.toLowerCase().indexOf(l) === 0; })); }
    var safe = q.replace(/['\\%]/g, '');
    if (safe.length < 2) return Promise.resolve([]);
    return JPK.crm.coql("select id, Account_Name from Accounts where Account_Name like '" + safe + "%' limit 20").then(function (r) {
      return r.rows.map(function (a) { return { id: String(a.id), name: a.Account_Name }; });
    });
  }
  function openAdd() {
    if (!S.canWrite) return;
    LostForm.openRecord({ mode: 'add', values: { status: 'Lost' }, models: S.models, customers: knownCustomers(), searchCustomers: searchCustomers,
      records: S.all, canMoney: S.canMoney, onSave: function (payload, names) { return doSave(null, payload, names); } });
  }
  /* Edit loads the full record live, so fields the list does not select (details, last client) are current. */
  function openEdit(id) {
    if (!S.canWrite) return;
    var raw = findRec(id); if (!raw) return;
    var start = S.demo ? Promise.resolve(raw) : ZOHO.CRM.API.getRecord({ Entity: WRITE_ENTITY, RecordID: id }).then(function (res) {
      var d = res && res.data && res.data[0]; if (!d) throw new Error('Could not read the record.'); return d;
    });
    start.then(function (rec) {
      var vals = E.valuesFromRecord(rec);
      if (S.demo && !vals.manufacturer && raw['Manufacturer.Vendor_Name']) { var mm = S.models.filter(function (m) { return m.manufacturer && m.manufacturer.name === raw['Manufacturer.Vendor_Name']; })[0]; if (mm) vals.manufacturer = mm.manufacturer; }
      LostForm.openRecord({ mode: 'edit', title: 'Edit ' + vals.serial, values: vals, models: S.models, customers: knownCustomers(), searchCustomers: searchCustomers,
        records: S.all, excludeId: id, canMoney: S.canMoney, onSave: function (payload, names) { return doSave(id, payload, names); } });
    }).catch(function (e) { JPK.toast('Could not open the record: ' + e.message); });
  }
  function changeStatus(id, to, selectEl) {
    var raw = findRec(id); if (!raw) return;
    var row = V.deviceRows([raw], S.all)[0];
    var reset = function () { renderDevices(); };
    if (to === 'Recovered') {
      LostForm.askRecovered({ row: row, canMoney: S.canMoney, onSave: function (payload) { return doSave(id, payload, {}); } });
      return;   /* the drawer's Cancel leaves the select showing the new value; redraw on close */
    }
    var plan = E.statusPlan(row, to, {});
    if (!plan.ok || plan.noop) { reset(); return; }
    selectEl.disabled = true;
    doSave(id, plan.payload, {}).catch(function (e) { JPK.toast('Not saved: ' + e.message); reset(); });
  }
  function wireWrites() {
    var add = $('#add'); add.hidden = false; add.addEventListener('click', openAdd);
    $('#dev').addEventListener('change', function (e) {
      var s = e.target.closest('select.ld-st'); if (s) changeStatus(s.getAttribute('data-id'), s.value, s);
    });
    $('#dev').addEventListener('click', function (e) {
      var b = e.target.closest('button.ld-edit'); if (b) openEdit(b.getAttribute('data-id'));
    });
    document.addEventListener('click', function (e) { if (e.target.closest('[data-act=cancel], #jpk-dr-x, .jpk-dr .scrim')) setTimeout(function () { if (!JPK.drawer.isOpen()) renderDevices(); }, 0); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setTimeout(function () { if (!JPK.drawer.isOpen()) renderDevices(); }, 0); });
  }
  function getProfile(ctx) {
    var m = /[?&]as=([a-z0-9_-]+)/i.exec(location.search);
    if (S.demo) return Promise.resolve(m ? m[1] : 'Administrator');
    if (!(window.ZOHO && ZOHO.CRM && ZOHO.CRM.CONFIG)) return Promise.resolve('');
    return ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) {
      var u = r && r.users && r.users[0]; return (u && u.profile && u.profile.name) || '';
    }, function () { return ''; });
  }

  /* ---------- theme: Auto follows the device; Light and Dark set data-theme. Remembered per browser when storage allows. ---------- */
  function applyTheme(t) {
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
  }
  (function () {
    var sel = $('#theme'), saved = 'auto';
    try { saved = localStorage.getItem('ld-theme') || 'auto'; } catch (e) { /* storage unavailable: Auto */ }
    if (['auto', 'light', 'dark'].indexOf(saved) === -1) saved = 'auto';
    sel.value = saved; applyTheme(saved);
    sel.addEventListener('change', function () {
      applyTheme(sel.value);
      try { localStorage.setItem('ld-theme', sel.value); } catch (e) { /* ignore */ }
    });
  })();

  /* ---------- start ---------- */
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    return getProfile(ctx).then(function (p) {
      S.profile = p; S.canWrite = E.canWrite(p); S.canMoney = E.canEditMoney(p); if (about && about.setHtml) about.setHtml(aboutHtml());
    }).then(loadLosses).then(function (rows) {
      S.all = rows;
      return loadBrands(rows).then(function (m) { S.brandMap = m; }, function () { S.brandOk = false; });
    }).then(function () {
      setupYear(); setupTabs(); setupEquip(); render();
      if (S.canWrite) { wireWrites(); return loadModels(); }
    });
  }).catch(function (e) {
    $('#ctx').textContent = '';
    showErr('Could not load device losses: ' + e.message + '. The module is Administrator-only until profile access is granted.');
  });
})();
