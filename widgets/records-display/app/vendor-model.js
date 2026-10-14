/* vendor-model.js: pure logic for the Vendors view (no DOM, no Zoho). Browser: window.VendorModel; node: require.
   Ties vendor cost to customer rates through contract Rate Lines (Rate_Lines.Parent_Id is the contract; Rate_Type is "Vendor cost" or
   "Customer rate"; Rate_Vendor says which vendor supplies a customer line). A customer line with no Rate_Vendor cannot be tied and is
   listed as a gap, never guessed. Rates are per day; a customer amount over DAILY_MAX is flagged as probably not a daily rate. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.VendorModel = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAILY_MAX = 100, LIVE = { Verified: 1, Proposed: 1 };
  var pick = function (v) { return v && v !== '-None-' ? String(v) : ''; };
  var lk = function (v) { return v && typeof v === 'object' ? { id: v.id ? String(v.id) : null, name: v.name || '' } : { id: null, name: '' }; };
  var num = function (v) { return v == null || (typeof v === 'string' && v.trim() === '') || isNaN(+v) ? null : +v; };
  var money = function (v) { return v == null ? '' : '$' + (Math.round(v * 100) / 100).toFixed(2); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };

  function tierText(l) { return l.tierMin == null && l.tierMax == null ? '' : (l.tierMin != null ? l.tierMin : 1) + (l.tierMax != null ? '-' + l.tierMax : '+') + ' units'; }

  function build(data) {
    var vendors = (data.vendors || []).map(function (r) {
      return { id: String(r.id), name: r.Vendor_Name || '', status: pick(r.Relationship_Status), em: r.EM_JusticePoint_Vendor === true || r.EM_JusticePoint_Vendor === 'true', raw: r, costLines: [], billed: [], contracts: [] };
    });
    var vById = {}; vendors.forEach(function (v) { vById[v.id] = v; });
    var contracts = {};
    (data.contracts || []).forEach(function (r) {
      var v = lk(r.Vendor), a = lk(r.Account);
      contracts[String(r.id)] = { id: String(r.id), name: r.Name || 'Contract', vendorId: v.id, accountId: a.id, accountName: a.name, status: pick(r.Contract_Status), type: pick(r.Counterparty_Type) };
    });
    var lines = (data.rateLines || []).map(function (r) {
      var p = lk(r.Parent_Id), rv = lk(r.Rate_Vendor), c = contracts[p.id] || null;
      var type = pick(r.Rate_Type);
      var vendorId = rv.id || (type === 'Vendor cost' && c ? c.vendorId : null);
      return { id: String(r.id), contractId: p.id, contractName: (c && c.name) || p.name || '', accountId: c ? c.accountId : null, accountName: c ? c.accountName : '', type: type, vendorId: vendorId, device: pick(r.Rate_Device) || 'Not set',
        amount: num(r.Rate_Daily_Amount), terms: pick(r.Rate_Terms), status: pick(r.Line_Status) || 'Not set', tierMin: num(r.Tier_Min_Units), tierMax: num(r.Tier_Max_Units), effective: r.Effective_Date || '' };
    });
    var cost = lines.filter(function (l) { return l.type === 'Vendor cost'; });
    var cust = lines.filter(function (l) { return l.type === 'Customer rate'; });
    cost.forEach(function (l) { if (l.vendorId && vById[l.vendorId]) vById[l.vendorId].costLines.push(l); });
    Object.keys(contracts).forEach(function (k) { var c = contracts[k]; if (c.vendorId && vById[c.vendorId]) vById[c.vendorId].contracts.push(c); });

    /* cost for a vendor and device: verified lines only (Proposed is shown but never used for margin) */
    function costFor(vendorId, device) {
      var xs = cost.filter(function (l) { return l.vendorId === vendorId && l.device === device && l.status === 'Verified' && l.amount != null; });
      if (!xs.length) return null;
      var vals = xs.map(function (l) { return l.amount; });
      return { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), n: xs.length };
    }
    var rows = cust.filter(function (l) { return LIVE[l.status]; }).map(function (l) {
      var c = l.vendorId ? costFor(l.vendorId, l.device) : null, flags = [];
      if (!l.vendorId) flags.push('No vendor set on this rate line');
      else if (!c) flags.push('No verified vendor cost for ' + l.device);
      if (l.amount != null && l.amount > DAILY_MAX) flags.push('Not a daily rate? Check units');
      if (l.status === 'Proposed') flags.push('Not yet verified');
      var margin = c && l.amount != null && l.amount <= DAILY_MAX ? r2(l.amount - c.max) : null;
      return { id: l.id, contractId: l.contractId, contractName: l.contractName, accountId: l.accountId, accountName: l.accountName || 'No account', vendorId: l.vendorId, vendorName: l.vendorId && vById[l.vendorId] ? vById[l.vendorId].name : '',
        device: l.device, tier: tierText(l), rate: l.amount, cost: c, margin: margin, negative: margin != null && margin < 0, status: l.status, terms: l.terms, flags: flags };
    });
    rows.forEach(function (r) { if (r.vendorId && vById[r.vendorId]) vById[r.vendorId].billed.push(r); });
    var byAcct = function (a, b) { return String(a.accountName).localeCompare(String(b.accountName)) || String(a.device).localeCompare(String(b.device)); };
    rows.sort(byAcct); vendors.forEach(function (v) { v.billed.sort(byAcct); v.costLines.sort(function (a, b) { return String(a.device).localeCompare(String(b.device)) || (a.tierMin || 0) - (b.tierMin || 0); }); });
    vendors.sort(function (a, b) { return (b.em ? 1 : 0) - (a.em ? 1 : 0) || a.name.localeCompare(b.name); });
    var gaps = { noVendor: rows.filter(function (r) { return !r.vendorId; }).length, noCost: rows.filter(function (r) { return r.vendorId && !r.cost; }).length, notDaily: rows.filter(function (r) { return r.rate != null && r.rate > DAILY_MAX; }).length,
      proposed: rows.filter(function (r) { return r.status === 'Proposed'; }).length, negative: rows.filter(function (r) { return r.negative; }).length };
    return { vendors: vendors, rows: rows, gaps: gaps, vById: vById };
  }
  return { build: build, money: money, tierText: tierText, DAILY_MAX: DAILY_MAX };
});
