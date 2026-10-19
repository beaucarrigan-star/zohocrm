'use strict';
/* lost-edit-model.js - pure logic for adding and editing Device Losses from the widget (no DOM, no Zoho).
   Works in node and in the browser (window.LostEditModel).
   Client-side permissions only hide controls; Zoho profiles still decide what can be written. */
(function (root) {
  var M = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./lost-model.js') : root.LostModel;

  var LISTS = {
    statuses: ['Lost', 'Damaged', 'Recovered'],
    newStatuses: ['Lost', 'Damaged'],
    deviceTypes: ['GPS', 'Remote Breath', 'RF', 'Transdermal', 'Beacon', 'Base Unit', 'Charger / Accessory', 'Victim Device', 'Other'],
    reasons: ['Absconded', 'Client reported lost', 'In custody', 'Deceased', 'Damaged', 'Other']
  };
  /* Money and credit fields: Administrator only (permissions plan, 19 Oct). */
  var MONEY_KEYS = ['Loss_Amount', 'Vendor_Credited', 'Billable_To_Customer', 'Amount_Billed', 'Billed_On', 'Customer_Paid'];

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  /* To let another profile write, add its normalized name here (for example 'emoperations'). */
  function canWrite(profile) { var p = norm(profile); return p === 'admin' || p === 'administrator' || p === 'emsupport'; }
  function canEditMoney(profile) { var p = norm(profile); return p === 'admin' || p === 'administrator'; }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }
  function s(v) { return v == null ? '' : String(v).trim(); }
  function moneyNum(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var n = Number(String(v).replace(/[$,\s]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  /* values: {serial, customer:{id,name}|null, model:{id,name}|null, manufacturer:{id,name}|null, deviceType, date, status,
     reportedBy, lastClient, reason, details, angie, recoveredOn, amount, vendorCredited, billable, amountBilled, billedOn, paid} */
  function validate(v, ctx) {
    ctx = ctx || {}; v = v || {};
    var today = ctx.today || todayStr(), e = {};
    if (!s(v.serial)) e.serial = 'Enter the serial number.';
    if (!v.customer || !v.customer.id) e.customer = 'Choose the customer.';
    if (!s(v.date)) e.date = 'Enter the date it was listed lost.';
    else if (!isDate(v.date)) e.date = 'Enter the date as year-month-day, for example 2026-03-14.';
    else if (v.date > today) e.date = 'The date cannot be in the future.';
    if (ctx.mode === 'add') {
      if (LISTS.newStatuses.indexOf(v.status) === -1) e.status = 'Choose Lost or Damaged.';
      if (!e.serial && M.hasOpenLoss(v.serial, ctx.records || [], null)) e.serial = 'This serial already has an open loss. Edit that record instead.';
    } else if (!e.serial && ctx.excludeId != null && v.status !== 'Recovered' && M.hasOpenLoss(v.serial, ctx.records || [], ctx.excludeId)) {
      e.serial = 'Another record with this serial is still lost or damaged.';
    }
    if (v.status === 'Recovered' || s(v.recoveredOn)) {
      if (!s(v.recoveredOn)) { if (v.status === 'Recovered') e.recoveredOn = 'Enter the date it was recovered.'; }
      else if (!isDate(v.recoveredOn)) e.recoveredOn = 'Enter the date as year-month-day.';
      else if (v.recoveredOn > today) e.recoveredOn = 'The date cannot be in the future.';
      else if (isDate(v.date) && v.recoveredOn < v.date) e.recoveredOn = 'Recovered date cannot be before the date listed lost.';
    }
    if (ctx.canMoney) {
      var a = moneyNum(v.amount), b = moneyNum(v.amountBilled);
      if (a !== null && (isNaN(a) || a < 0)) e.amount = 'Enter a dollar amount of 0 or more.';
      if (b !== null && (isNaN(b) || b < 0)) e.amountBilled = 'Enter a dollar amount of 0 or more.';
      if (s(v.billedOn) && !isDate(v.billedOn)) e.billedOn = 'Enter the date as year-month-day.';
    }
    var list = Object.keys(e).map(function (k) { return { id: k, message: e[k] }; });
    return { ok: list.length === 0, errors: e, list: list };
  }

  function lk(o) { return o && o.id ? { id: String(o.id) } : null; }
  var FIELD_MAP = [
    ['serial', 'Name', s], ['date', 'Date_Listed_Lost', s], ['deviceType', 'Device_Type', s], ['reportedBy', 'Reported_By', s],
    ['lastClient', 'Last_Client', s], ['reason', 'Loss_Reason', s], ['details', 'Loss_Details', s], ['recoveredOn', 'Recovered_On', s]
  ];
  var MONEY_MAP = [
    ['amount', 'Loss_Amount', moneyNum], ['vendorCredited', 'Vendor_Credited', Boolean], ['billable', 'Billable_To_Customer', Boolean],
    ['amountBilled', 'Amount_Billed', moneyNum], ['billedOn', 'Billed_On', s], ['paid', 'Customer_Paid', Boolean]
  ];
  var LOOKUPS = [['customer', 'Customer'], ['model', 'Device_Model'], ['manufacturer', 'Manufacturer']];

  /* Payload to send. add: everything filled in. edit: only what differs from `original` (same shape as values).
     Money keys are dropped unless ctx.canMoney, even if present. Never writes Status_Date, Status_Stamp, Cost_Basis. */
  function buildPayload(v, original, ctx) {
    ctx = ctx || {}; original = original || {};
    var add = ctx.mode === 'add', p = {}, names = {};
    function put(key, val, ov) {
      var same = (val === ov) || (val === '' && (ov === '' || ov == null)) || (val === null && (ov === '' || ov == null));
      if (add) { if (val !== '' && val !== null && val !== false) p[key] = val; }
      else if (!same) p[key] = val === '' ? null : val;
    }
    FIELD_MAP.forEach(function (f) { put(f[1], f[2](v[f[0]]), f[2](original[f[0]])); });
    LOOKUPS.forEach(function (l) {
      var a = lk(v[l[0]]), b = lk(original[l[0]]);
      if ((a && a.id) !== (b && b.id) || add) { if (add) { if (a) p[l[1]] = a; } else p[l[1]] = a; }
      if (a && v[l[0]].name) names[l[1]] = v[l[0]].name;
    });
    if (add) p.Loss_Status = v.status;
    var ang = !!v.angie;
    if (add ? ang : ang !== !!original.angie) p.Angie_Notified = ang;
    if (ctx.canMoney) MONEY_MAP.forEach(function (f) {
      var val = f[2](v[f[0]]), ov = f[2](original[f[0]]);
      if (f[2] === Boolean) { if (add ? val : val !== ov) p[f[1]] = val; }
      else put(f[1], val === null ? '' : val, ov === null ? '' : ov);
    });
    MONEY_KEYS.forEach(function (k) { if (!ctx.canMoney) delete p[k]; });
    return { payload: p, names: names, changed: Object.keys(p).length > 0 };
  }

  /* Plan for changing Status in the table. Recovered needs a recovery date; reopening clears it. */
  function statusPlan(row, to, opts) {
    opts = opts || {};
    if (!row || LISTS.statuses.indexOf(to) === -1) return { ok: false, error: 'Unknown status.' };
    if (row.status === to) return { ok: true, noop: true, payload: {} };
    if (to === 'Recovered') {
      var on = s(opts.recoveredOn), today = opts.today || todayStr();
      if (!on) return { ok: false, needsDate: true, error: 'Enter the date it was recovered.' };
      if (!isDate(on)) return { ok: false, needsDate: true, error: 'Enter the date as year-month-day.' };
      if (on > today) return { ok: false, needsDate: true, error: 'The date cannot be in the future.' };
      if (row.date && on < row.date) return { ok: false, needsDate: true, error: 'Recovered date cannot be before the date listed lost (' + row.date + ').' };
      var p = { Loss_Status: 'Recovered', Recovered_On: on };
      if (opts.vendorCredited && opts.canMoney) p.Vendor_Credited = true;
      return { ok: true, payload: p };
    }
    var q = { Loss_Status: to };
    if (row.status === 'Recovered') q.Recovered_On = null;
    return { ok: true, payload: q, reopen: row.status === 'Recovered' };
  }

  /* Apply a payload to a flat COQL-shaped record (demo mode, and optimistic display). */
  function applyLocal(rec, payload, names) {
    var out = Object.assign({}, rec); names = names || {};
    Object.keys(payload || {}).forEach(function (k) {
      var v = payload[k];
      if (v && typeof v === 'object' && v.id !== undefined) {
        out[k + '.id'] = v.id;
        var nameKey = k === 'Customer' ? 'Account_Name' : k === 'Manufacturer' ? 'Vendor_Name' : 'Name';
        out[k + '.' + nameKey] = names[k] || out[k + '.' + nameKey] || null;
        if (k === 'Device_Model') delete out['Device_Model.id'];
      } else if (v === null && (k === 'Customer' || k === 'Manufacturer' || k === 'Device_Model')) {
        delete out[k + '.id']; delete out[k + '.Account_Name']; delete out[k + '.Vendor_Name'];
      } else out[k] = v;
    });
    return out;
  }

  /* Values object from a full Zoho record (REST shape from getRecord, or a flat COQL row). */
  function valuesFromRecord(r) {
    function look(field, nameKey) {
      var o = r[field];
      if (o && typeof o === 'object') return o.id ? { id: String(o.id), name: o.name || o[nameKey] || '' } : null;
      var id = r[field + '.id'];
      return id ? { id: String(id), name: r[field + '.' + nameKey] || '' } : null;
    }
    return {
      serial: s(r.Name), customer: look('Customer', 'Account_Name'), model: look('Device_Model', 'Name'), manufacturer: look('Manufacturer', 'Vendor_Name'),
      deviceType: s(r.Device_Type), date: s(r.Date_Listed_Lost), status: s(r.Loss_Status), reportedBy: s(r.Reported_By), lastClient: s(r.Last_Client),
      reason: s(r.Loss_Reason), details: s(r.Loss_Details), angie: !!r.Angie_Notified, recoveredOn: s(r.Recovered_On),
      amount: r.Loss_Amount == null ? '' : r.Loss_Amount, vendorCredited: !!r.Vendor_Credited, billable: !!r.Billable_To_Customer,
      amountBilled: r.Amount_Billed == null ? '' : r.Amount_Billed, billedOn: s(r.Billed_On), paid: !!r.Customer_Paid
    };
  }

  var api = { LISTS: LISTS, MONEY_KEYS: MONEY_KEYS, canWrite: canWrite, canEditMoney: canEditMoney, todayStr: todayStr, isDate: isDate,
    validate: validate, buildPayload: buildPayload, statusPlan: statusPlan, applyLocal: applyLocal, valuesFromRecord: valuesFromRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LostEditModel = api;
})(typeof window !== 'undefined' ? window : this);
