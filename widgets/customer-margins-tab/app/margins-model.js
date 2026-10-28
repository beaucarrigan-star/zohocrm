/* EM Margins: pure maths and filters. No DOM, no Zoho. Works in the browser (window.MarginsModel) and in node (require).
   Rules mirror the em_margin_build automation: Margin % is (rate - cost) / rate, tiers Negative < 0, Thin < 20, Normal < 50, else Strong.
   Retired rows are ignored everywhere. The account roll-up is the same rule as the account margin fields:
   Avg Margin % = simple mean of Modelled_Margin_Pct over the account's Confirmed rows, one decimal. */
(function (root) {
  'use strict';

  var TARGET = 30;
  var TIERS = ['Negative', 'Thin', 'Normal', 'Strong'];

  function num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  /* COQL returns a lookup as {id, name}; tolerate a plain string or id too. */
  function look(v) {
    if (v == null || v === '') return { id: '', name: '' };
    if (typeof v === 'object') return { id: v.id != null ? String(v.id) : '', name: v.name != null ? String(v.name) : (v.Name != null ? String(v.Name) : '') };
    return { id: '', name: String(v) };
  }
  function str(v) { return v == null ? '' : String(v); }
  function round1(x) { return Math.round((x + 1e-9) * 10) / 10; }

  /* Tier from a Margin % number. Boundaries: 0 is Thin, 20 is Normal, 50 is Strong. */
  function tierFor(pct) {
    if (pct == null || !isFinite(pct)) return '';
    if (pct < 0) return 'Negative';
    if (pct < 20) return 'Thin';
    if (pct < 50) return 'Normal';
    return 'Strong';
  }

  function normalize(r) {
    r = r || {};
    var acc = look(r.Account), con = look(r.Contract), ven = look(r.Vendor);
    /* S42: widget COQL returns lookups as {id} only; names come from the dotted fields. */
    if (!acc.name && r['Account.Account_Name'] != null) acc.name = String(r['Account.Account_Name']);
    if (!con.name && r['Contract.Name'] != null) con.name = String(r['Contract.Name']);
    if (!ven.name && r['Vendor.Vendor_Name'] != null) ven.name = String(r['Vendor.Vendor_Name']);
    var pct = num(r.Modelled_Margin_Pct);
    return {
      id: str(r.id),
      name: str(r.Name),
      key: str(r.Margin_Key),
      rowType: str(r.Row_Type),
      status: str(r.Status),
      reason: str(r.Exception_Reason),
      accountId: acc.id, accountName: acc.name,
      contractId: con.id, contractName: con.name,
      vendorId: ven.id, vendorName: ven.name,
      device: str(r.Device_Family),
      rateDesc: str(r.Rate_Description),
      rate: num(r.Customer_Rate),
      cost: num(r.Vendor_Daily_Rate),
      marginDay: num(r.Margin_Per_Unit_Day),
      pct: pct,
      tier: str(r.Modelled_Margin_Tier) || (pct == null ? '' : tierFor(pct)),
      costTier: str(r.Vendor_Cost_Tier),
      notes: str(r.Margin_Notes),
      modified: str(r.Modified_Time)
    };
  }

  function isTest(r) {
    return /\bdo not use\b/i.test(r.accountName + ' ' + r.contractName) || /^\s*test\b/i.test(r.accountName) || /^\s*test\b/i.test(r.contractName);
  }
  function isRetired(r) { return String(r.status).toLowerCase() === 'retired'; }
  function isConfirmed(r) { return String(r.status).toLowerCase() === 'confirmed'; }
  function isWaiting(r) { return String(r.status).toLowerCase() === 'exception'; }
  function isFilled(r) { return isConfirmed(r) && r.pct != null; }

  /* The working set: Contract rate rows only, never Retired, TEST rows dropped when hideTest. */
  function scope(rows, opts) {
    opts = opts || {};
    return (rows || []).filter(function (r) {
      if (isRetired(r)) return false;
      if (r.rowType && String(r.rowType).toLowerCase() !== 'contract rate') return false;
      if (opts.hideTest && isTest(r)) return false;
      return true;
    });
  }

  function totals(rows, opts) {
    var s = scope(rows, opts), filled = s.filter(isFilled), waiting = s.filter(isWaiting);
    var sum = 0; filled.forEach(function (r) { sum += r.pct; });
    return {
      filled: filled.length,
      waiting: waiting.length,
      below: filled.filter(function (r) { return r.pct < TARGET; }).length,
      avg: filled.length ? round1(sum / filled.length) : null,
      target: TARGET
    };
  }

  function uniq(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  /* f: {vendor, device, tiers: [..]} empty or missing means no filter. Default order is Margin % ascending. */
  function marginRows(rows, opts, f) {
    f = f || {};
    var tiers = f.tiers && f.tiers.length ? f.tiers : null;
    return scope(rows, opts).filter(isConfirmed).filter(function (r) {
      if (f.vendor && r.vendorName !== f.vendor) return false;
      if (f.device && r.device !== f.device) return false;
      if (tiers && tiers.indexOf(r.tier) < 0) return false;
      return true;
    }).sort(function (a, b) {
      if (a.pct == null && b.pct == null) return 0;
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return a.pct - b.pct;
    });
  }
  function filterOptions(rows, opts) {
    var c = scope(rows, opts).filter(isConfirmed);
    return { vendors: uniq(c.map(function (r) { return r.vendorName; })), devices: uniq(c.map(function (r) { return r.device; })) };
  }

  /* Waiting rows, grouped by reason then customer. */
  function waitingRows(rows, opts) {
    return scope(rows, opts).filter(isWaiting).sort(function (a, b) {
      return (a.reason || '').localeCompare(b.reason || '') || (a.accountName || '').localeCompare(b.accountName || '') || (a.contractName || '').localeCompare(b.contractName || '');
    });
  }

  /* One row per account from the same rows: avg of Confirmed Modelled_Margin_Pct (1 decimal), lowest, tier from the average. */
  function customers(rows, opts) {
    var by = {}, order = [];
    scope(rows, opts).forEach(function (r) {
      if (!isConfirmed(r) && !isWaiting(r)) return;
      var k = r.accountId || r.accountName || '(none)';
      if (!by[k]) { by[k] = { accountId: r.accountId, name: r.accountName || 'No account', pcts: [], waiting: 0 }; order.push(k); }
      if (isFilled(r)) by[k].pcts.push(r.pct);
      else if (isWaiting(r)) by[k].waiting += 1;
    });
    var out = order.map(function (k) {
      var g = by[k], n = g.pcts.length, sum = 0, low = null;
      g.pcts.forEach(function (p) { sum += p; if (low == null || p < low) low = p; });
      var avg = n ? round1(sum / n) : null;
      return { accountId: g.accountId, name: g.name, lines: n, waiting: g.waiting, avg: avg, lowest: low, tier: avg == null ? '' : tierFor(avg) };
    });
    out.sort(function (a, b) {
      if (a.avg == null && b.avg == null) return a.name.localeCompare(b.name);
      if (a.avg == null) return 1;
      if (b.avg == null) return -1;
      return a.avg - b.avg || a.name.localeCompare(b.name);
    });
    return out;
  }

  var api = { TARGET: TARGET, TIERS: TIERS, num: num, normalize: normalize, tierFor: tierFor, isTest: isTest, scope: scope, totals: totals,
    marginRows: marginRows, filterOptions: filterOptions, waitingRows: waitingRows, customers: customers, round1: round1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarginsModel = api;
})(typeof window !== 'undefined' ? window : this);
