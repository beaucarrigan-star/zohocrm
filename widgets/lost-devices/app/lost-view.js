'use strict';
/* lost-view.js - pure view logic for the Lost Devices widget (no DOM, no Zoho).
   All counting is delegated to LostModel. Works in node and in the browser (window.LostView).
   Brand scope is applied through the customer's brand (Accounts.Brand), looked up once per page load,
   so no COQL criteria on a formula field through a lookup is needed. */
(function (root) {
  var M = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./lost-model.js') : root.LostModel;

  var BRANDS = [
    { key: 'all', label: 'All brands', values: null },
    { key: 'jp', label: 'JusticePoint', values: ['JusticePoint EM', 'JusticePoint Programs'] },
    { key: 'sr', label: 'Sirona Recovery', values: ['Sirona Recovery'] },
    { key: 'dp', label: 'The Difference Principle', values: ['The Difference Principle'] }
  ];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function brandKeyOf(value) {
    if (!value) return null;
    for (var i = 1; i < BRANDS.length; i++) if (BRANDS[i].values.indexOf(value) !== -1) return BRANDS[i].key;
    return null;
  }

  function scopeByBrand(records, brandKey, brandMap) {
    records = records || [];
    if (!brandKey || brandKey === 'all') return records.slice();
    brandMap = brandMap || {};
    return records.filter(function (r) {
      var n = M.normalize(r);
      return !!n.customerId && brandKeyOf(brandMap[n.customerId]) === brandKey;
    });
  }

  function brandCounts(records, brandMap) {
    var c = { all: (records || []).length, jp: 0, sr: 0, dp: 0, none: 0 };
    (records || []).forEach(function (r) {
      var n = M.normalize(r);
      var k = n.customerId ? brandKeyOf((brandMap || {})[n.customerId]) : null;
      if (k) c[k] += 1; else c.none += 1;
    });
    return c;
  }

  function yearOf(r) { var m = M.normalize(r).month; return m ? m.slice(0, 4) : null; }

  /* Newest first. */
  function yearOptions(records) {
    var seen = {};
    (records || []).forEach(function (r) { var y = yearOf(r); if (y) seen[y] = true; });
    return Object.keys(seen).sort().reverse();
  }

  /* year 'all' keeps everything (including undated); a year keeps only records dated in it. */
  function filterYear(records, year) {
    if (!year || year === 'all') return (records || []).slice();
    return (records || []).filter(function (r) { return yearOf(r) === String(year); });
  }

  function monthLabel(ym) { return MON[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4); }

  /* Monthly trend: gross and net by month of Date_Listed_Lost. Last_Client is never involved. */
  function trend(records, year) {
    var opts = (year && year !== 'all') ? { from: year + '-01', to: year + '-12' } : {};
    var rows = M.byMonth(filterYear(records, year), opts);
    var gross = [], net = [];
    rows.forEach(function (r, i) {
      var label = monthLabel(r.month);
      gross.push({ x: i, label: label, y: r.grossLoss });
      net.push({ x: i, label: label, y: r.netLoss });
    });
    return { rows: rows, gross: gross, net: net, undated: rows.undated };
  }

  /* Tile groups from a summarize() result. */
  function tiles(s) {
    return {
      primary: [
        { key: 'devicesLost', label: 'Devices lost', value: s.devicesLost, kind: 'count', sub: s.recoveredDevices + ' recovered' },
        { key: 'grossLoss', label: 'Gross loss', value: s.grossLoss, kind: 'money', sub: 'Lost, damaged, and recovered without a vendor credit' },
        { key: 'netLoss', label: 'Net loss', value: s.netLoss, kind: 'money', sub: 'After customer payments' },
        { key: 'owed', label: 'Owed by customers', value: s.owedByCustomers, kind: 'money', sub: 'Billed, not yet paid' }
      ],
      secondary: [
        { key: 'recoveredValue', label: 'Recovered value', value: s.recoveredValue, kind: 'money', sub: 'Recovered with a vendor credit' },
        { key: 'paid', label: 'Paid by customers', value: s.paidByCustomers, kind: 'money', sub: '' },
        { key: 'amountMissing', label: 'Amount missing', value: s.amountMissing, kind: 'count', sub: s.amountMissing ? 'Counted as devices, $0 in totals' : '' },
        { key: 'unknownStatus', label: 'No status', value: s.unknownStatus, kind: 'count', sub: s.unknownStatus ? 'Not counted as lost' : '' }
      ]
    };
  }

  function fmtMoney(n) {
    n = Number(n) || 0;
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + '$' + s;
  }
  function fmtMoneyShort(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(Math.abs(n) % 1000 ? 1 : 0).replace(/\.0$/, '') + 'k';
    return fmtMoney(n);
  }

  /* One row per device for the table. `scoped` is what is shown; `all` is used for the duplicate check so a
     duplicate serial is flagged even when the other record sits in another brand or year. */
  function deviceRows(scoped, all) {
    var dups = {};
    M.findDuplicateSerials(all || scoped).forEach(function (d) { dups[d.serial] = true; });
    return (scoped || []).map(function (r) {
      var n = M.normalize(r), c = M.classify(n);
      return {
        id: n.id, serial: n.serial, customerId: n.customerId, customer: n.customer || M.NO_CUSTOMER,
        manufacturer: n.manufacturer || '', deviceType: n.deviceType || '', status: n.status || 'No status',
        date: n.date || '', month: n.month, amount: n.amount,
        amountMissing: c.amountMissing === 1, duplicate: !!dups[n.serialKey],
        open: c.deviceLost === 1, recovered: c.recovered === 1, vendorCredited: n.vendorCredited,
        billed: n.amountBilled, paid: n.customerPaid, owed: c.owed, paidAmt: c.paid, gross: c.gross, recoveredValue: c.recoveredValue
      };
    });
  }

  function flagLabels(row) {
    var f = [];
    if (row.amountMissing) f.push('Amount missing');
    if (row.duplicate) f.push('Duplicate serial');
    return f;
  }

  var api = {
    BRANDS: BRANDS, brandKeyOf: brandKeyOf, scopeByBrand: scopeByBrand, brandCounts: brandCounts,
    yearOptions: yearOptions, filterYear: filterYear, monthLabel: monthLabel, trend: trend, tiles: tiles,
    deviceRows: deviceRows, flagLabels: flagLabels, fmtMoney: fmtMoney, fmtMoneyShort: fmtMoneyShort
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LostView = api;
})(typeof window !== 'undefined' ? window : this);
