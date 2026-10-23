'use strict';
/*
 * lost-model.js - pure counting logic for the Lost Devices Tracker.
 * No Zoho calls, no DOM, no Date objects (dates are plain YYYY-MM-DD strings,
 * so there is no timezone drift). Works in Node (CommonJS) and in the browser
 * (attaches to window.LostModel).
 *
 * Input: Device_Losses records, either as Zoho REST shape (lookups as
 * {id, name}) or as flattened COQL rows ("Customer.Account_Name",
 * "Manufacturer.Vendor_Name", "Customer.id" ...).
 *
 * Counting rules (from the Lost Devices Tracker plan):
 *  - Devices lost = records with Loss_Status Lost or Damaged.
 *  - Gross loss = Loss_Amount for Lost and Damaged, plus Recovered devices
 *    where Vendor_Credited is not ticked. A recovered device with a vendor
 *    credit drops out of gross and shows as recoveredValue.
 *  - Net loss = gross minus Amount_Billed where Customer_Paid is ticked.
 *    Billed but unpaid shows as owedByCustomers.
 *  - Month = month of Date_Listed_Lost; later recovery or payment adjusts
 *    that same month.
 *  - A record with no Loss_Amount still counts as a device and is flagged
 *    (amountMissing). Missing amounts add 0 to dollar totals.
 *  - Last_Client is never read, so it cannot leak into any output.
 */

var OPEN_STATUSES = { Lost: true, Damaged: true };
var NO_CUSTOMER = '(No customer)';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function truthy(v) {
  return v === true || v === 'true' || v === 'Yes' || v === 'yes' || v === 1 || v === '1';
}

function lookupName(rec, field, nameKey) {
  var v = rec[field];
  if (v && typeof v === 'object') {
    if (v.name != null) return v.name;
    if (v[nameKey] != null) return v[nameKey];
    return null;
  }
  var flat = rec[field + '.' + nameKey];
  if (flat != null) return flat;
  if (typeof v === 'string' && v) return v;
  return null;
}

function lookupId(rec, field) {
  var v = rec[field];
  if (v && typeof v === 'object') return v.id != null ? String(v.id) : null;
  var flat = rec[field + '.id'];
  if (flat != null) return String(flat);
  return null;
}

function monthOf(dateStr) {
  if (typeof dateStr !== 'string') return null;
  var m = /^(\d{4})-(\d{2})-\d{2}/.exec(dateStr);
  return m ? m[1] + '-' + m[2] : null;
}

function normalizeSerial(s) {
  if (s === null || s === undefined) return '';
  return String(s).trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Flatten one Zoho record into the fields the model needs. */
function normalize(rec) {
  var date = rec.Date_Listed_Lost || null;
  return {
    id: rec.id != null ? String(rec.id) : null,
    serial: rec.Name != null ? String(rec.Name) : '',
    serialKey: normalizeSerial(rec.Name),
    customerId: lookupId(rec, 'Customer'),
    customer: lookupName(rec, 'Customer', 'Account_Name'),
    manufacturer: lookupName(rec, 'Manufacturer', 'Vendor_Name'),
    model: lookupName(rec, 'Device_Model', 'Name'),
    deviceType: rec.Device_Type || null,
    status: rec.Loss_Status || null,
    date: date,
    month: monthOf(date),
    amount: num(rec.Loss_Amount),
    vendorCredited: truthy(rec.Vendor_Credited),
    amountBilled: num(rec.Amount_Billed),
    customerPaid: truthy(rec.Customer_Paid)
  };
}

/** Money and count effect of a single normalized record. */
function classify(n) {
  var amt = n.amount === null ? 0 : n.amount;
  var out = {
    deviceLost: 0, recovered: 0, gross: 0, recoveredValue: 0,
    paid: 0, owed: 0, amountMissing: n.amount === null ? 1 : 0, unknownStatus: 0
  };

  if (OPEN_STATUSES[n.status]) {
    out.deviceLost = 1;
    out.gross = amt;
  } else if (n.status === 'Recovered') {
    out.recovered = 1;
    if (n.vendorCredited) out.recoveredValue = amt;
    else out.gross = amt;
  } else {
    out.unknownStatus = 1;
  }

  if (n.amountBilled !== null && n.amountBilled > 0) {
    if (n.customerPaid) out.paid = n.amountBilled;
    else out.owed = n.amountBilled;
  }
  return out;
}

function emptyTotals() {
  return {
    devicesLost: 0, recoveredDevices: 0, grossLoss: 0, netLoss: 0,
    recoveredValue: 0, owedByCustomers: 0, paidByCustomers: 0,
    amountMissing: 0, unknownStatus: 0
  };
}

function addTo(t, c) {
  t.devicesLost += c.deviceLost;
  t.recoveredDevices += c.recovered;
  t.grossLoss += c.gross;
  t.paidByCustomers += c.paid;
  t.recoveredValue += c.recoveredValue;
  t.owedByCustomers += c.owed;
  t.amountMissing += c.amountMissing;
  t.unknownStatus += c.unknownStatus;
}

function finish(t) {
  t.grossLoss = round2(t.grossLoss);
  t.paidByCustomers = round2(t.paidByCustomers);
  t.netLoss = round2(t.grossLoss - t.paidByCustomers);
  t.recoveredValue = round2(t.recoveredValue);
  t.owedByCustomers = round2(t.owedByCustomers);
  return t;
}

function summarize(records) {
  var t = emptyTotals();
  (records || []).forEach(function (r) { addTo(t, classify(normalize(r))); });
  return finish(t);
}

function nextMonth(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return y + '-' + (m < 10 ? '0' + m : String(m));
}

/**
 * Totals per month of Date_Listed_Lost, oldest first, zero-filled between
 * from and to (defaults: first and last month in the data).
 * Records with no date are not in any month; they are counted in the
 * returned array's `undated` property.
 */
function byMonth(records, opts) {
  opts = opts || {};
  var buckets = {};
  var undated = emptyTotals();
  var minM = null, maxM = null;

  (records || []).forEach(function (r) {
    var n = normalize(r);
    var c = classify(n);
    if (!n.month) { addTo(undated, c); return; }
    if (!buckets[n.month]) buckets[n.month] = emptyTotals();
    addTo(buckets[n.month], c);
    if (minM === null || n.month < minM) minM = n.month;
    if (maxM === null || n.month > maxM) maxM = n.month;
  });

  var from = opts.from || minM;
  var to = opts.to || maxM;
  var rows = [];
  if (from && to && from <= to) {
    for (var m = from; m <= to; m = nextMonth(m)) {
      var t = buckets[m] || emptyTotals();
      var row = finish(t);
      row.month = m;
      rows.push(row);
    }
  }
  rows.undated = finish(undated);
  return rows;
}

/**
 * By-customer pivot. Sorted by net loss (high to low), then name.
 * Customers with no lookup are grouped under "(No customer)".
 */
function byCustomer(records) {
  var groups = {};
  (records || []).forEach(function (r) {
    var n = normalize(r);
    var label = n.customer || NO_CUSTOMER;
    var key = n.customerId || ('name:' + label);
    if (!groups[key]) {
      groups[key] = { customerId: n.customerId, customer: label, totals: emptyTotals() };
    }
    addTo(groups[key].totals, classify(n));
  });
  return Object.keys(groups).map(function (k) {
    var g = groups[k];
    var row = finish(g.totals);
    row.customerId = g.customerId;
    row.customer = g.customer;
    return row;
  }).sort(function (a, b) {
    if (b.netLoss !== a.netLoss) return b.netLoss - a.netLoss;
    return a.customer.localeCompare(b.customer);
  });
}

/** Records that still need a Loss_Amount (shown as "Amount missing"). */
function amountMissingRecords(records) {
  return (records || []).map(normalize).filter(function (n) {
    return n.amount === null;
  }).map(function (n) {
    return { id: n.id, serial: n.serial, status: n.status, customer: n.customer, month: n.month };
  });
}

/**
 * Serials that appear on more than one record where at least one is still
 * open (Lost or Damaged). Serial match ignores case and extra whitespace.
 */
function findDuplicateSerials(records) {
  var groups = {};
  (records || []).forEach(function (r) {
    var n = normalize(r);
    if (!n.serialKey) return;
    (groups[n.serialKey] = groups[n.serialKey] || []).push(n);
  });
  return Object.keys(groups).filter(function (k) {
    var g = groups[k];
    return g.length > 1 && g.some(function (n) { return OPEN_STATUSES[n.status]; });
  }).map(function (k) {
    return {
      serial: k,
      records: groups[k].map(function (n) {
        return { id: n.id, status: n.status, date: n.date, customer: n.customer };
      })
    };
  }).sort(function (a, b) { return a.serial.localeCompare(b.serial); });
}

/**
 * Entry-time check: does this serial already have an open loss?
 * Pass excludeId when editing an existing record.
 */
function hasOpenLoss(serial, records, excludeId) {
  var key = normalizeSerial(serial);
  if (!key) return false;
  var skip = excludeId != null ? String(excludeId) : null;
  return (records || []).some(function (r) {
    var n = normalize(r);
    return n.serialKey === key && n.id !== skip && !!OPEN_STATUSES[n.status];
  });
}

/**
 * Brand scope, applied through Customer. Pass the customers that belong to
 * the brand as {ids: [...], names: [...]}. A record is kept if its customer
 * id or name (case-insensitive) is listed. An omitted scope, or an omitted
 * ids/names list, does not filter on that key; an empty list matches nothing.
 */
function scopeToCustomers(records, scope) {
  if (!scope || (scope.ids === undefined && scope.names === undefined)) return (records || []).slice();
  var ids = scope.ids ? scope.ids.map(String) : null;
  var names = scope.names ? scope.names.map(function (s) { return String(s).toLowerCase(); }) : null;
  return (records || []).filter(function (r) {
    var n = normalize(r);
    if (ids && n.customerId && ids.indexOf(n.customerId) !== -1) return true;
    if (names && n.customer && names.indexOf(String(n.customer).toLowerCase()) !== -1) return true;
    return false;
  });
}

var api = {
  OPEN_STATUSES: Object.keys(OPEN_STATUSES),
  NO_CUSTOMER: NO_CUSTOMER,
  normalize: normalize,
  normalizeSerial: normalizeSerial,
  classify: classify,
  summarize: summarize,
  byMonth: byMonth,
  byCustomer: byCustomer,
  amountMissingRecords: amountMissingRecords,
  findDuplicateSerials: findDuplicateSerials,
  hasOpenLoss: hasOpenLoss,
  scopeToCustomers: scopeToCustomers
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.LostModel = api;
