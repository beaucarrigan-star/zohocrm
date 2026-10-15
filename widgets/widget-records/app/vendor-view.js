/* vendor-view.js: Vendors view inside the Records widget. Edit in place: vendor on a rate line, line status, device, amount, and vendor details; each change saves to Zoho at once with Undo.
   v2.1 (Oct 14): Administrators can add a vendor cost line (saved Proposed on the vendor's contract, Undo removes it).
   v2 (Oct 14): rate lines are written through their contract (Rate_Lines is a subform), and a status change writes Line_Status, Line_Verified and Superseded_By together, like Contract Review.
   Vendor information, vendor cost from contract Rate Lines (Contract Ingest), and the accounts billed with their customer rate,
   tied by contract: customer Rate Lines that name this vendor (Rate_Vendor), matched to its verified vendor cost for the same device. */
(function () {
  'use strict';
  var VM = window.VendorModel, PAGE = 200, CAP = 5000;
  var VQ = ['Vendor_Name, Relationship_Status, EM_JusticePoint_Vendor, Main_Point_of_Contact, Support_Hours, Support_Email_RMA, After_hours_number, Customer_Portal, Website, Equipment_Used, Device_Order_Method, Device_Order_Email, Device_Order_Contact, Accessory_Order_Method, Accessory_Order_Email, EM_Units_Current, Last_Vendor_Review',
    'Vendor_Name, Relationship_Status, EM_JusticePoint_Vendor, Main_Point_of_Contact, Support_Hours, Support_Email_RMA, After_hours_number, Customer_Portal, Website, Last_Vendor_Review', 'Vendor_Name, Relationship_Status, EM_JusticePoint_Vendor'];
  var S = { data: null, model: null, mode: 'vendor', vid: null, emOnly: true, costStatus: 'Verified', q: '', err: '', notes: [], loaded: false, busy: false, at: 0, sel: null, editV: false, pl: {}, admin: null, addCost: false };
  var X, root;

  function pages(q) { var all = []; function go(off) { return X.coql(q + ' limit ' + PAGE + ' offset ' + off).then(function (r) { all = all.concat(r.rows); if (r.rows.length >= PAGE && all.length < CAP) return go(off + PAGE); return all; }); } return go(0); }
  function vendorsRead(i) { return pages('select id, ' + VQ[i] + ' from Vendors where id is not null order by id asc').catch(function (e) { if (i + 1 < VQ.length) return vendorsRead(i + 1); throw e; }); }
  function load() {
    S.busy = true; S.err = ''; S.notes = [];
    if (!X.isLive()) { S.data = window.VendorDemo.make(); return Promise.resolve().then(finish); }
    var d = { vendors: [], contracts: [], rateLines: [] };
    return vendorsRead(0).then(function (r) { d.vendors = r; })
      .then(function () { return pages('select id, Name, Vendor, Account, Contract_Status, Counterparty_Type from Contracts where id is not null order by id asc').then(function (r) { d.contracts = r; }, function (e) { S.notes.push('Contracts could not be read (' + e.message + '), so rates cannot be tied to accounts.'); }); })
      .then(function () { return pages('select id, Parent_Id, Rate_Vendor, Rate_Type, Rate_Device, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Tier_Min_Units, Tier_Max_Units, Effective_Date from Rate_Lines where id is not null order by id asc').then(function (r) { d.rateLines = r; }, function (e) { S.notes.push('Rate Lines could not be read (' + e.message + ').'); }); })
      .then(function () { S.data = d; finish(); }, function (e) { S.err = e.message || 'Could not read Vendors'; S.busy = false; });
  }
  function finish() { S.model = VM.build(S.data); if (!S.vid || !S.model.vById[S.vid]) { var f = S.model.vendors.filter(function (v) { return v.em; })[0] || S.model.vendors[0]; S.vid = f ? f.id : null; } S.loaded = true; S.busy = false; S.at = Date.now(); }

  var STATUSES = ['Proposed', 'Verified', 'Superseded', 'Rejected'];
  var DEVICES = ['GPS', 'Wrist-worn GPS', '2-Piece GPS', 'Remote Breath', 'CAM', 'CAM Landline', 'Hybrid GPS + Alcohol', 'Victim / DV', 'Other'];
  var apiOf = function (v) { return v && typeof v === 'object' ? (v.id ? { id: v.id } : null) : (v === '' || v === undefined ? null : v); };
  /* save one or more fields on a raw record, update the screen, offer Undo. changes: {Field: [apiValue, localValue]} */
  /* Rate_Lines is a subform on Contracts: write it through the contract (billing-lines.js reads the contract fresh and sends every row id back) */
  function writeOne(entity, raw, api) {
    if (entity !== 'Rate_Lines') return X.update(entity, raw.id, api);
    var p = raw.Parent_Id, cid = p && typeof p === 'object' ? p.id : p;
    if (!cid) return Promise.reject(new Error('this line has no contract'));
    return window.JPBillingLines.writeLine(X.blIo(), String(cid), String(raw.id), api);
  }
  function save(entity, list, id, changes, label) {
    var raw = list.filter(function (r) { return String(r.id) === String(id); })[0]; if (!raw) return;
    var oldLocal = {}, oldApi = {}, api = {}, keys = Object.keys(changes);
    if (keys.every(function (k) { return JSON.stringify(apiOf(raw[k])) === JSON.stringify(changes[k][0]) || (raw[k] == null && changes[k][0] == null); })) return;
    keys.forEach(function (k) { oldLocal[k] = raw[k]; oldApi[k] = apiOf(raw[k]); api[k] = changes[k][0]; });
    writeOne(entity, raw, api).then(function () {
      keys.forEach(function (k) { raw[k] = changes[k][1]; }); S.model = VM.build(S.data); draw();
      X.toastUndo('Saved: ' + label, function () {
        writeOne(entity, raw, oldApi).then(function () { keys.forEach(function (k) { raw[k] = oldLocal[k]; }); S.model = VM.build(S.data); draw(); X.toast('Undone'); }, function (e) { X.toast('Could not undo: ' + (e && e.message || e)); });
      });
    }, function (e) { X.toast('Could not save: ' + (e && e.message || e)); draw(); });
  }
  function opts(list, cur) { var xs = list.slice(); if (cur && xs.indexOf(cur) < 0) xs.unshift(cur); return xs.map(function (o) { return '<option value="' + X.esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + X.esc(o) + '</option>'; }).join(''); }
  function lineEditor() {
    if (!S.sel) return '';
    var raw = S.data.rateLines.filter(function (r) { return String(r.id) === String(S.sel.id); })[0]; if (!raw) return '';
    var esc = X.esc, isBill = S.sel.k === 'bill', vid = raw.Rate_Vendor && raw.Rate_Vendor.id ? String(raw.Rate_Vendor.id) : '';
    var dev = raw.Rate_Device && raw.Rate_Device !== '-None-' ? raw.Rate_Device : '', st = raw.Line_Status && raw.Line_Status !== '-None-' ? raw.Line_Status : '';
    var ml = S.model.rows.filter(function (r) { return r.id === String(raw.id); })[0] || {};
    var title = isBill ? (ml.accountName || 'Customer rate line') + ' · ' + (dev || 'device not set') : 'Vendor cost · ' + (dev || 'device not set');
    var vsel = isBill ? '<label>Vendor<select data-f="vendor"><option value="">Not set</option>' + S.model.vendors.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === vid ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select></label>' : '';
    return '<div class="cards"><section class="card" id="led"><h3>Edit rate line: ' + esc(title) + '</h3><div class="edit">' + vsel +
      '<label>Device<select data-f="device"><option value="">Not set</option>' + opts(S.pl.device || DEVICES, dev) + '</select></label>' +
      '<label>Amount per day<input data-f="amount" type="number" step="0.01" min="0" value="' + esc(raw.Rate_Daily_Amount == null ? '' : raw.Rate_Daily_Amount) + '"></label>' +
      '<label>Status<select data-f="status">' + opts(S.pl.status || STATUSES, st) + '</select></label></div>' +
      '<div class="acts"><button type="button" class="btn" data-a="oc">Open contract</button><button type="button" class="btn" data-a="close">Close</button></div>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">Each change saves to Zoho as you make it, with Undo. Only Verified lines feed margin.</p></section></div>';
  }
  function bindLineEditor() {
    var led = document.getElementById('led'); if (!led) return;
    var id = S.sel.id, raw = S.data.rateLines.filter(function (r) { return String(r.id) === String(id); })[0];
    led.onchange = function (e) {
      var f = e.target.getAttribute('data-f'), v = e.target.value;
      if (f === 'vendor') { var vv = S.model.vById[v]; save('Rate_Lines', S.data.rateLines, id, { Rate_Vendor: [v ? { id: v } : null, v ? { id: v, name: vv ? vv.name : '' } : null] }, 'vendor' + (vv ? ' set to ' + vv.name : ' cleared')); }
      else if (f === 'device') save('Rate_Lines', S.data.rateLines, id, { Rate_Device: [v || null, v || null] }, 'device ' + (v || 'cleared'));
      else if (f === 'status') { var sf = window.JPBillingLines.statusFields(v), ch = {}; Object.keys(sf).forEach(function (k) { ch[k] = [sf[k], sf[k]]; }); save('Rate_Lines', S.data.rateLines, id, ch, 'status ' + v); }
      else if (f === 'amount') { var n = v.trim() === '' ? null : +v; if (n != null && (isNaN(n) || n < 0)) { X.toast('Enter an amount of 0 or more'); draw(); return; } save('Rate_Lines', S.data.rateLines, id, { Rate_Daily_Amount: [n, n] }, 'amount ' + (n == null ? 'cleared' : VM.money(n))); }
    };
    led.onclick = function (e) { var b = e.target.closest('[data-a]'); if (!b) return; if (b.getAttribute('data-a') === 'close') { S.sel = null; draw(); } else if (raw) { var p = raw.Parent_Id; X.openCrm('Contracts', p && p.id ? p.id : p); } };
  }
  /* ---------- add a vendor cost line (Administrators) ---------- */
  function vendorContracts(v) { return v.contracts.filter(function (k) { return k.type !== 'Customer'; }); }
  function addCostForm(v) {
    var esc = X.esc, ks = vendorContracts(v);
    if (!ks.length) return '<div class="cards"><section class="card"><h3>Add a vendor cost line</h3><p class="mut" style="margin:0">' + esc(v.name) + ' has no vendor contract on file, so there is nowhere to put the line. Add the contract under Processes > Contract first.</p><div class="acts"><button type="button" class="btn" data-a="ccancel">Close</button></div></section></div>';
    return '<div class="cards"><section class="card" id="cadd"><h3>Add a vendor cost line: ' + esc(v.name) + '</h3><form class="edit" id="caddf">' +
      (ks.length > 1 ? '<label>Contract<select name="k">' + ks.map(function (k) { return '<option value="' + esc(k.id) + '">' + esc(k.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label>Device<select name="dev" required><option value="">Pick one</option>' + opts(S.pl.device || DEVICES, '') + '</select></label>' +
      '<label>Cost per day<input name="amt" type="number" step="0.01" min="0" required></label>' +
      '<label>Volume from (units)<input name="tmin" type="number" step="1" min="0"></label><label>Volume to (units)<input name="tmax" type="number" step="1" min="0"></label>' +
      '<label>Effective date<input name="eff" type="date"></label><label>Terms (optional)<input name="terms" type="text" maxlength="255"></label></form>' +
      '<div class="acts"><button type="button" class="btn pri" data-a="csave">Add line</button><button type="button" class="btn" data-a="ccancel">Cancel</button></div>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">Saved as Proposed on ' + (ks.length > 1 ? 'the contract you pick' : esc(ks[0].name)) + '. Verify it (here or in Contract Review) before it counts for margin. Leave volume blank when the cost applies to every volume.</p></section></div>';
  }
  function bindAddCost(v) {
    var box = document.getElementById('cadd') || null, BL = window.JPBillingLines;
    root.querySelectorAll('[data-a=ccancel]').forEach(function (b) { b.onclick = function () { S.addCost = false; draw(); }; });
    if (!box) return;
    box.querySelector('[data-a=csave]').onclick = function (ev) {
      var f = document.getElementById('caddf'), g = function (n) { return f.elements[n] ? f.elements[n].value.trim() : ''; }, nm = function (n) { return g(n) === '' ? null : +g(n); };
      var cid = g('k') || vendorContracts(v)[0].id, dev = g('dev'), amt = nm('amt'), a = nm('tmin'), b = nm('tmax');
      if (!dev) { X.toast('Pick a device'); return; }
      if (amt == null || isNaN(amt) || amt < 0) { X.toast('Enter a cost per day of 0 or more'); return; }
      if ((a != null && (isNaN(a) || a < 0)) || (b != null && (isNaN(b) || b < 0)) || (a != null && b != null && b < a)) { X.toast('Check the volume range'); return; }
      var fields = Object.assign({ Rate_Type: 'Vendor cost', Rate_Device: dev, Rate_Daily_Amount: amt, Tier_Min_Units: a, Tier_Max_Units: b, Effective_Date: g('eff') || null, Rate_Terms: g('terms') || null, Rate_Vendor: { id: v.id } }, BL.statusFields('Proposed'));
      ev.target.disabled = true;
      BL.writeLine(X.blIo(), cid, null, fields).then(function (newId) {
        var k = vendorContracts(v).filter(function (x) { return x.id === cid; })[0], row = Object.assign({ id: newId || ('pending' + Date.now()) }, fields, { Parent_Id: { id: cid, name: k ? k.name : '' }, Rate_Vendor: { id: v.id, name: v.name } });
        S.data.rateLines.push(row); S.model = VM.build(S.data); S.addCost = false; S.costStatus = 'all'; draw();
        X.toastUndo('Saved: ' + dev + ' cost ' + VM.money(amt) + ' a day added (Proposed)', newId ? function () { BL.removeLine(X.blIo(), cid, newId).then(function () { S.data.rateLines = S.data.rateLines.filter(function (x) { return x !== row; }); S.model = VM.build(S.data); draw(); X.toast('Undone'); }, function (e) { X.toast('Could not undo: ' + ((e && e.message) || e)); }); } : null);
      }, function (e) { ev.target.disabled = false; X.toast('Could not add: ' + ((e && e.message) || e)); });
    };
  }
  var VFIELDS = [['Relationship_Status', 'Relationship', 'pick'], ['Support_Hours', 'Support hours'], ['Support_Email_RMA', 'RMA email'], ['After_hours_number', 'After-hours number'], ['Customer_Portal', 'Customer portal link'], ['Last_Vendor_Review', 'Last review', 'date']];
  function vendorEditor(v) {
    var esc = X.esc, r = v.raw;
    return '<section class="card" id="ved"><h3>Edit ' + esc(v.name) + '</h3><div class="edit">' + VFIELDS.map(function (f) {
      var cur = r[f[0]] == null || r[f[0]] === '-None-' ? '' : r[f[0]];
      if (f[2] === 'pick' && S.pl.rel) return '<label>' + esc(f[1]) + '<select data-vf="' + f[0] + '"><option value="">Not set</option>' + opts(S.pl.rel, cur) + '</select></label>';
      return '<label>' + esc(f[1]) + '<input data-vf="' + f[0] + '" type="' + (f[2] === 'date' ? 'date' : 'text') + '" value="' + esc(cur) + '"></label>'; }).join('') + '</div>' +
      '<div class="acts"><button type="button" class="btn" data-a="vdone">Done</button><button type="button" class="btn" data-a="openv">Open vendor record</button></div>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">Saves as you go, with Undo. Contacts and ordering details are edited on the vendor record.</p></section>';
  }
  function bindVendorEditor() {
    var ved = document.getElementById('ved'); if (!ved) return;
    ved.onchange = function (e) { var f = e.target.getAttribute('data-vf'); if (!f) return; var v = e.target.value.trim(); save('Vendors', S.data.vendors, S.vid, (function () { var o = {}; o[f] = [v || null, v || null]; return o; })(), VFIELDS.filter(function (x) { return x[0] === f; })[0][1] + (v ? ' updated' : ' cleared')); };
    ved.onclick = function (e) { var b = e.target.closest('[data-a]'); if (!b) return; if (b.getAttribute('data-a') === 'vdone') { S.editV = false; draw(); } else X.openCrm('Vendors', S.vid); };
  }
  var costTxt = function (c) { return !c ? '' : c.min === c.max ? VM.money(c.min) : VM.money(c.min) + ' to ' + VM.money(c.max); };
  function billedRow(r, withVendor) {
    return { id: r.id, account: r.accountName, device: r.device, tier: r.tier || '', rate: r.rate == null ? '' : VM.money(r.rate), cost: costTxt(r.cost), margin: r.margin == null ? '' : (r.margin < 0 ? '-' : '') + VM.money(Math.abs(r.margin)), vendor: withVendor ? (r.vendorName || 'Not set') : undefined,
      status: r.status, check: r.flags.filter(function (f) { return f !== 'Not yet verified'; }).join('. ') };
  }
  function infoCard(v) {
    var esc = X.esc, r = v.raw, link = function (u) { return u ? '<a target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(u) + '</a>' : ''; };
    var pn = function (x) { return x && typeof x === 'object' ? x.name : x; };
    var rows = [['Relationship', r.Relationship_Status], ['Main contact', pn(r.Main_Point_of_Contact)], ['Support hours', r.Support_Hours], ['RMA email', r.Support_Email_RMA], ['After-hours number', r.After_hours_number], ['Customer portal', link(r.Customer_Portal), 1],
      ['Device orders', [r.Device_Order_Method, r.Device_Order_Email, pn(r.Device_Order_Contact)].filter(Boolean).join(' · ')], ['Accessory orders', [r.Accessory_Order_Method, r.Accessory_Order_Email].filter(Boolean).join(' · ')], ['Units in service', r.EM_Units_Current], ['Last review', r.Last_Vendor_Review]]
      .filter(function (x) { return x[1] != null && x[1] !== '' && x[1] !== '-None-'; });
    return '<section class="card"><h3>' + esc(v.name) + '</h3><dl>' + (rows.length ? rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + (x[2] ? x[1] : esc(x[1])) + '</dd>'; }).join('') : '<dt>Details</dt><dd>None on file</dd>') + '</dl>' +
      '<div class="acts"><button type="button" class="btn pri" data-a="editv">Edit details</button><button type="button" class="btn" data-a="openv">Open vendor record</button></div></section>';
  }
  var COST_COLS = [{ k: 'contract', label: 'Contract', main: 1 }, { k: 'device', label: 'Device' }, { k: 'tier', label: 'Volume' }, { k: 'cost', label: 'Cost per day', r: 1, num: 1 }, { k: 'status', label: 'Status', badge: 1 }, { k: 'terms', label: 'From the contract' }];
  var BILL_COLS = function (withVendor) { return [{ k: 'account', label: 'Account', main: 1 }].concat(withVendor ? [{ k: 'vendor', label: 'Vendor' }] : [], [{ k: 'device', label: 'Device' }, { k: 'tier', label: 'Volume' }, { k: 'rate', label: 'Customer rate / day', r: 1, num: 1 }, { k: 'cost', label: 'Vendor cost / day', r: 1, num: 1 }, { k: 'margin', label: 'Margin / day', r: 1, num: 1 }, { k: 'status', label: 'Status', badge: 1 }, { k: 'check', label: 'Check' }]); };

  function vendorSum(cur, cl) {
    var m = cur.billed.filter(function (r) { return r.margin != null; }), below = m.filter(function (r) { return r.margin < 0; }).length;
    var avg = m.length ? m.reduce(function (a, r) { return a + r.margin; }, 0) / m.length : null;
    var cell = function (l, v, cls) { return '<div><small>' + l + '</small><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>'; };
    return '<div class="sum">' + cell('Cost lines shown', cl.length) + cell('Accounts billed', cur.billed.length) +
      cell('Avg margin / day', avg == null ? 'n/a' : (avg < 0 ? '-' : '') + VM.money(Math.abs(avg)), avg != null && avg < 0 ? 'var pos' : '') +
      cell('Sold below cost', '<span class="badge ' + (below ? 'bad' : 'good') + '">' + below + '</span>') + '</div>';
  }
  function gapStrip(g) {
    var bits = [];
    if (g.noVendor) bits.push(g.noVendor + ' customer rate' + (g.noVendor === 1 ? ' names' : 's name') + ' no vendor');
    if (g.noCost) bits.push(g.noCost + ' with no verified vendor cost for the device');
    if (g.notDaily) bits.push(g.notDaily + (g.notDaily === 1 ? ' looks' : ' look') + ' like not a per-day amount');
    if (g.negative) bits.push(g.negative + (g.negative === 1 ? ' sells' : ' sell') + ' below cost');
    if (g.proposed) bits.push(g.proposed + ' still Proposed');
    return bits.length ? '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">Across all vendors: ' + X.esc(bits.join('; ')) + '. Fix these on the contract\'s Rate Lines (Contract Review) so billing can use them.</div>' : '';
  }

  function draw() {
    var esc = X.esc, m = S.model, h = '<div class="wrap">' + X.head('Records', 'Vendors', '', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
    if (S.err) h += '<div class="err">Could not read: ' + esc(S.err) + '</div>';
    if (!S.loaded) { root.innerHTML = h + '<div class="empty"><b>' + (S.err ? 'Nothing to show' : 'Loading…') + '</b></div></div>'; X.bindSwitch(); var r0 = document.getElementById('rf'); if (r0) r0.onclick = function () { run(true); }; return; }
    S.notes.forEach(function (n) { h += '<div class="err">' + esc(n) + '</div>'; });
    h += gapStrip(m.gaps);
    h += '<div class="bar" id="modes" role="group" aria-label="View"><button type="button" class="pillbtn" data-md="vendor" aria-pressed="' + (S.mode === 'vendor') + '">By vendor</button><button type="button" class="pillbtn" data-md="account" aria-pressed="' + (S.mode === 'account') + '">By account (billing)</button></div>';
    var cur = m.vById[S.vid], bound, costBound = [];
    if (S.mode === 'vendor') {
      var vs = m.vendors.filter(function (v) { return !S.emOnly || v.em || v.id === S.vid; });
      h += '<div class="bar" id="vlist" role="group" aria-label="Vendor">' + vs.map(function (v) { return '<button type="button" class="pillbtn" data-v="' + esc(v.id) + '" aria-pressed="' + (v.id === S.vid) + '">' + esc(v.name) + ' (' + v.billed.length + ')</button>'; }).join('') +
        '<button type="button" class="pillbtn" id="em" aria-pressed="' + S.emOnly + '">EM vendors only</button></div>';
      if (cur) {
        h += '<div class="cards">' + (S.editV ? vendorEditor(cur) : infoCard(cur)) + '</div>';
        var cl = cur.costLines.filter(function (l) { return S.costStatus === 'all' || l.status === S.costStatus; });
        h += vendorSum(cur, cl);
        h += '<h3 style="padding:14px 24px 0;margin:0">Vendor cost from contracts</h3><div class="bar" id="cs" role="group" aria-label="Line status">' + ['Verified', 'Proposed', 'all'].map(function (s) { return '<button type="button" class="pillbtn" data-cs="' + s + '" aria-pressed="' + (S.costStatus === s) + '">' + (s === 'all' ? 'All lines' : s) + '</button>'; }).join('') + '</div>';
        if (S.admin) h += S.addCost ? addCostForm(cur) : '<div class="bar"><button type="button" class="pillbtn" id="caddb">+ Add a vendor cost line</button></div>';
        h += cl.length ? X.tableHtml(COST_COLS, cl.map(function (l) { return { contract: l.contractName, device: l.device, tier: VM.tierText(l), cost: l.amount == null ? '' : VM.money(l.amount), status: l.status, terms: l.terms }; }), true) : '<div class="empty"><b>No ' + (S.costStatus === 'all' ? '' : S.costStatus.toLowerCase() + ' ') + 'cost lines for this vendor</b>Contract Ingest adds them from the vendor contract; Contract Review verifies them.</div>';
        h += '<h3 style="padding:14px 24px 0;margin:0">Accounts billed with this vendor\'s devices (' + cur.billed.length + ')</h3>';
        h += cur.billed.length ? X.tableHtml(BILL_COLS(false), cur.billed.map(function (r) { return billedRow(r, false); }), true) : '<div class="empty"><b>No customer rate lines name this vendor</b>Set Rate Vendor on the customer\'s Rate Lines (Contract Review) to tie them.</div>';
        bound = cur.billed; costBound = cl;
      }
    } else {
      var q = S.q.trim().toLowerCase(), rows = m.rows.filter(function (r) { return !q || (r.accountName + ' ' + r.vendorName + ' ' + r.device).toLowerCase().indexOf(q) >= 0; });
      h += '<div class="bar"><input class="search" id="aq" type="search" placeholder="Search account, vendor or device" value="' + esc(S.q) + '" aria-label="Search"></div>';
      h += rows.length ? X.tableHtml(BILL_COLS(true), rows.map(function (r) { return billedRow(r, true); }), true) : '<div class="empty"><b>No customer rate lines match</b></div>';
      bound = rows;
    }
    h += lineEditor();
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">Pricing comes from Rate Lines on contracts (Contract Ingest, verified in Contract Review). Only Verified vendor cost is used for margin; with volume tiers the margin uses the highest cost, the cautious case. Amounts are per day as stored; an amount over $' + VM.DAILY_MAX + ' is flagged and given no margin. A customer rate with no Rate Vendor is never guessed. Superseded and rejected customer lines are left out. Read ' + esc(new Date(S.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '.</p></div>';
    root.innerHTML = h; X.bindSwitch();
    document.getElementById('rf').onclick = function () { run(true); };
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.onclick = fn; };
    on('modes', function (e) { var b = e.target.closest('[data-md]'); if (b) { S.mode = b.getAttribute('data-md'); draw(); } });
    on('vlist', function (e) { var b = e.target.closest('[data-v]'); if (b) { S.vid = b.getAttribute('data-v'); draw(); } else if (e.target.closest('#em')) { S.emOnly = !S.emOnly; draw(); } });
    on('cs', function (e) { var b = e.target.closest('[data-cs]'); if (b) { S.costStatus = b.getAttribute('data-cs'); draw(); } });
    var aq = document.getElementById('aq'); if (aq) aq.oninput = function () { S.q = aq.value; var p = aq.selectionStart; draw(); var n = document.getElementById('aq'); n.focus(); try { n.setSelectionRange(p, p); } catch (x) {} };
    var tbs = root.querySelectorAll('tbody'), billTb = S.mode === 'vendor' || S.mode === 'account' ? tbs[tbs.length - 1] : null;
    var pickRow = function (kind, list) { return function (tr) { if (!tr) return; var r = list[+tr.getAttribute('data-i')]; if (!r) return; S.sel = { k: kind, id: r.id }; draw(); var d = document.getElementById('led'); if (d) d.scrollIntoView({ block: 'nearest' }); }; };
    var wire = function (tb, fn) { if (!tb) return; tb.onclick = function (e) { fn(e.target.closest('tr[data-i]')); }; tb.onkeydown = function (e) { if (e.key === 'Enter') fn(e.target.closest('tr[data-i]')); }; };
    if (S.mode === 'vendor' && costBound.length) wire(tbs[0], pickRow('cost', costBound));
    if (billTb && bound && bound.length && !(S.mode === 'vendor' && !cur.billed.length)) wire(billTb, pickRow('bill', bound));
    if (S.sel) { var all = root.querySelectorAll('tbody tr[data-i]'); /* highlight the selected row */ Array.prototype.forEach.call(all, function (tr) { var tb = tr.parentNode, list = (tb === tbs[0] && S.mode === 'vendor' && costBound.length) ? costBound : bound; var r = list && list[+tr.getAttribute('data-i')]; if (r && String(r.id) === String(S.sel.id)) tr.classList.add('sel'); }); }
    bindLineEditor(); bindVendorEditor();
    if (cur && S.addCost) bindAddCost(cur);
    var cb = document.getElementById('caddb'); if (cb) cb.onclick = function () { S.addCost = true; S.sel = null; draw(); var c = document.getElementById('cadd'); if (c) c.scrollIntoView({ block: 'nearest' }); };
    var oa = root.querySelector('[data-a="openv"]'); if (oa) oa.onclick = function () { X.openCrm('Vendors', S.vid); };
    var ea = root.querySelector('[data-a="editv"]'); if (ea) ea.onclick = function () { S.editV = true; draw(); };
  }
  function run(manual) { return load().then(function () { draw(); if (manual) X.toast('Refreshed'); }); }
  window.RecModules.vendor_pricing = { key: 'vendor_pricing', title: 'Vendors', swLabel: 'Vendors', group: 'Vendors', entity: 'Vendors', custom: true,
    render: function (rootEl, ctx) { root = rootEl; X = ctx; if (S.admin === null) { S.admin = false; ctx.hasRole(['admin']).then(function (a) { S.admin = a; if (a && S.loaded) draw(); }); } ctx.picklist('Rate_Lines', 'Rate_Device', DEVICES).then(function (v) { S.pl.device = v; }); ctx.picklist('Rate_Lines', 'Line_Status', STATUSES).then(function (v) { S.pl.status = v; }); ctx.picklist('Vendors', 'Relationship_Status', null).then(function (v) { S.pl.rel = v && v.length ? v : null; });  draw(); if (!S.loaded && !S.busy) run(false); } };
})();
