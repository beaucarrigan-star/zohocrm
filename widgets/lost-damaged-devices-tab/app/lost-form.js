/* lost-form.js - drawer forms for adding and editing a device loss. DOM only: no Zoho calls.
   The caller passes onSave(payload, names, values) and it returns a Promise; on rejection the message shows in the form. */
(function () {
  'use strict';
  var E = window.LostEditModel, esc = JPK.esc;

  function opt(list, blank) { return (blank ? [{ value: '', label: blank }] : []).concat(list.map(function (x) { return { value: x, label: x }; })); }
  var YN = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];

  /* o: {mode:'add'|'edit', title, values, models:[{id,name,manufacturer:{id,name}|null,deviceType}], customers:[{id,name}],
         searchCustomers(q)->Promise<[{id,name}]>, records, excludeId, canMoney, onSave} */
  function openRecord(o) {
    var v0 = o.values || {}, add = o.mode === 'add', known = {}, F = {};
    function remember(c) { if (c && c.id && c.name) known[c.name.toLowerCase()] = { id: String(c.id), name: c.name }; }
    (o.customers || []).forEach(remember); remember(v0.customer);

    var node = document.createElement('form'); node.className = 'ld-form'; node.noValidate = true;
    node.innerHTML = '<div class="ld-es"></div><div class="ld-fields"></div><datalist id="ld-cust-list"></datalist>' +
      '<div class="ld-actions"><button type="button" class="btn primary" data-act="save">' + (add ? 'Add device' : 'Save changes') + '</button>' +
      (add ? '<button type="button" class="btn" data-act="again">Add and enter another</button>' : '') +
      '<button type="button" class="btn" data-act="cancel">Cancel</button></div><div class="err ld-saveerr" role="alert" hidden></div>';
    var box = node.querySelector('.ld-fields'), dl = node.querySelector('datalist');
    function fld(key, label, extra) {
      var x = Object.assign({ id: 'ld-' + key, label: label, required: false }, extra || {});
      F[key] = JPK.field(x); box.appendChild(F[key].el); return F[key];
    }
    function refreshList(names) { dl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join(''); }
    refreshList(Object.keys(known).map(function (k) { return known[k].name; }));

    var mfrs = {}; (o.models || []).forEach(function (m) { if (m.manufacturer && m.manufacturer.id) mfrs[m.manufacturer.id] = m.manufacturer; });
    var mfrList = Object.keys(mfrs).map(function (k) { return mfrs[k]; });

    fld('serial', 'Serial number', { required: true, value: v0.serial });
    fld('customer', 'Customer', { required: true, hint: 'Start typing, then pick from the list.', value: v0.customer ? v0.customer.name : '' });
    F.customer.input.setAttribute('list', 'ld-cust-list'); F.customer.input.setAttribute('autocomplete', 'off');
    fld('date', 'Date listed lost', { required: true, type: 'date', value: v0.date || (add ? E.todayStr() : '') });
    fld('status', 'Status', { required: true, type: 'select', options: add ? opt(E.LISTS.newStatuses) : opt(E.LISTS.statuses), value: v0.status || 'Lost' });
    fld('model', 'Device model', { type: 'select', hint: 'Sets the manufacturer and type, and the loss amount is filled from its replacement cost.',
      options: [{ value: '', label: 'Not set' }].concat((o.models || []).map(function (m) { return { value: m.id, label: m.name + (m.manufacturer ? ' (' + m.manufacturer.name + ')' : '') }; })) });
    fld('mfr', 'Manufacturer', { type: 'select', options: [{ value: '', label: 'Not set' }].concat(mfrList.map(function (m) { return { value: m.id, label: m.name }; })) });
    fld('deviceType', 'Device type', { type: 'select', options: opt(E.LISTS.deviceTypes, 'Not set'), value: v0.deviceType || '' });
    fld('reason', 'Reason', { type: 'select', options: opt(E.LISTS.reasons, 'Not set'), value: v0.reason || '' });
    fld('reportedBy', 'Reported by', { value: v0.reportedBy });
    fld('lastClient', 'Last client', { hint: 'Kept on the record only. It does not appear in totals or lists.', value: v0.lastClient });
    fld('details', 'Details', { type: 'textarea', value: v0.details });
    fld('recoveredOn', 'Date recovered', { type: 'date', hint: 'Required when the status is Recovered.', value: v0.recoveredOn });
    if (o.canMoney) {
      fld('amount', 'Loss amount', { inputmode: 'decimal', hint: 'Leave as is to keep the amount from the replacement cost. Changing it overrides that amount.', value: v0.amount });
      fld('vendorCredited', 'Vendor credited', { type: 'select', options: YN, value: v0.vendorCredited ? 'yes' : 'no' });
      fld('billable', 'Billable to customer', { type: 'select', options: YN, value: v0.billable ? 'yes' : 'no' });
      fld('amountBilled', 'Amount billed', { inputmode: 'decimal', value: v0.amountBilled });
      fld('billedOn', 'Billed on', { type: 'date', value: v0.billedOn });
      fld('paid', 'Customer paid', { type: 'select', options: YN, value: v0.paid ? 'yes' : 'no' });
    }
    if (v0.model && v0.model.id) F.model.input.value = v0.model.id;
    if (v0.manufacturer && v0.manufacturer.id) F.mfr.input.value = v0.manufacturer.id;

    function modelById(id) { return (o.models || []).filter(function (m) { return m.id === id; })[0] || null; }
    F.model.input.addEventListener('change', function () {
      var m = modelById(F.model.input.value); if (!m) return;
      if (m.manufacturer) F.mfr.input.value = m.manufacturer.id;
      if (m.deviceType) F.deviceType.input.value = m.deviceType;
    });
    var tmr = null;
    F.customer.input.addEventListener('input', function () {
      var q = F.customer.input.value.trim();
      if (!o.searchCustomers || q.length < 2) return;
      clearTimeout(tmr);
      tmr = setTimeout(function () {
        o.searchCustomers(q).then(function (list) { (list || []).forEach(remember); refreshList(Object.keys(known).map(function (k) { return known[k].name; })); }, function () { /* typing keeps working with the known list */ });
      }, 250);
    });

    var es = JPK.errorSummary({ mount: node.querySelector('.ld-es'), title: 'Fix these before saving' });
    function val(k) { return F[k] ? F[k].input.value : ''; }
    function collect() {
      var typed = val('customer').trim(), cust = known[typed.toLowerCase()] || null;
      var m = modelById(val('model')), mf = mfrs[val('mfr')] || null;
      var status = val('status');
      return {
        serial: val('serial').trim(), customer: cust, customerTyped: typed,
        model: m ? { id: m.id, name: m.name } : null, manufacturer: mf ? { id: mf.id, name: mf.name } : null,
        deviceType: val('deviceType'), date: val('date'), status: status, reportedBy: val('reportedBy').trim(), lastClient: val('lastClient').trim(),
        reason: val('reason'), details: val('details').trim(), angie: v0.angie, recoveredOn: status === 'Recovered' ? val('recoveredOn') : '',
        amount: val('amount'), vendorCredited: val('vendorCredited') === 'yes', billable: val('billable') === 'yes',
        amountBilled: val('amountBilled'), billedOn: val('billedOn'), paid: val('paid') === 'yes'
      };
    }
    var saving = false;
    function setBusy(on, again) {
      node.querySelectorAll('[data-act=save],[data-act=again]').forEach(function (b) { b.disabled = on; });
      var sv = node.querySelector('[data-act=save]'), ag = node.querySelector('[data-act=again]');
      sv.textContent = on && !again ? 'Saving...' : (add ? 'Add device' : 'Save changes');
      if (ag) ag.textContent = on && again ? 'Saving...' : 'Add and enter another';
    }
    function resetForNext() {
      ['serial', 'details', 'lastClient'].forEach(function (k) { F[k].input.value = ''; });
      Object.keys(F).forEach(function (k) { F[k].clear(); });
      es.clear(); F.serial.input.focus();
    }
    function save(again) {
      if (saving) return;
      var v = collect(), ctx = { mode: o.mode, records: o.records, excludeId: o.excludeId, canMoney: o.canMoney };
      var r = E.validate(v, ctx);
      if (!r.ok && !v.customer && v.customerTyped) r.errors.customer = 'Pick "' + v.customerTyped + '" from the list, or check the spelling.';
      Object.keys(F).forEach(function (k) { F[k].clear(); });
      Object.keys(r.errors).forEach(function (k) { if (F[k]) F[k].setError(r.errors[k]); });
      es.set(Object.keys(r.errors).map(function (k) { return { id: 'ld-' + k, message: r.errors[k] }; }), true);
      if (!r.ok) return;
      var built = E.buildPayload(v, v0, ctx);
      if (!add && !built.changed) { JPK.drawer.close(); JPK.toast('No changes to save.'); return; }
      saving = true; setBusy(true, again);
      var errBox = node.querySelector('.ld-saveerr'); errBox.hidden = true;
      Promise.resolve(o.onSave(built.payload, built.names, v)).then(function () {
        if (again) { saving = false; setBusy(false); resetForNext(); } else JPK.drawer.close();
      }, function (e) {
        saving = false; setBusy(false);
        errBox.hidden = false; errBox.textContent = 'Not saved: ' + (e && e.message || e);
      });
    }
    node.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'save') save(false); else if (a === 'again') save(true); else JPK.drawer.close();
    });
    node.addEventListener('submit', function (e) { e.preventDefault(); save(false); });
    JPK.drawer.open({ title: o.title || (add ? 'Add lost or damaged device' : 'Edit device'), node: node, onMount: function () { F.serial.input.focus(); } });
    return { collect: collect, fields: F };
  }

  /* Small drawer asking for the recovery date when a row's status is changed to Recovered. */
  function askRecovered(o) {
    var node = document.createElement('div'); node.className = 'ld-form';
    node.innerHTML = '<p>Mark <b class="mono">' + esc(o.row.serial) + '</b> as recovered.</p><div class="ld-fields"></div>' +
      '<div class="ld-actions"><button type="button" class="btn primary" data-act="ok">Mark recovered</button><button type="button" class="btn" data-act="cancel">Cancel</button></div>' +
      '<div class="err ld-saveerr" role="alert" hidden></div>';
    var box = node.querySelector('.ld-fields');
    var d = JPK.field({ id: 'ld-rec-on', label: 'Date recovered', required: true, type: 'date', value: E.todayStr() }); box.appendChild(d.el);
    var vc = null;
    if (o.canMoney) { vc = JPK.field({ id: 'ld-rec-vc', label: 'Vendor credited', type: 'select', options: YN, hint: 'Yes moves the amount from gross loss to recovered value.', value: o.row.vendorCredited ? 'yes' : 'no' }); box.appendChild(vc.el); }
    var done = false;
    node.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.getAttribute('data-act') === 'cancel') { JPK.drawer.close(); return; }
      if (done) return;
      var plan = E.statusPlan(o.row, 'Recovered', { recoveredOn: d.input.value, vendorCredited: vc && vc.input.value === 'yes' && !o.row.vendorCredited, canMoney: o.canMoney });
      if (!plan.ok) { d.setError(plan.error); d.input.focus(); return; }
      d.clear(); done = true; b.disabled = true; b.textContent = 'Saving...';
      Promise.resolve(o.onSave(plan.payload)).then(function () { JPK.drawer.close(); }, function (er) {
        done = false; b.disabled = false; b.textContent = 'Mark recovered';
        var eb = node.querySelector('.ld-saveerr'); eb.hidden = false; eb.textContent = 'Not saved: ' + (er && er.message || er);
      });
    });
    JPK.drawer.open({ title: 'Mark recovered', node: node, onMount: function () { d.input.focus(); } });
  }

  window.LostForm = { openRecord: openRecord, askRecovered: askRecovered };
})();
