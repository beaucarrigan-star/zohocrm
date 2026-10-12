/* Line_Status for Rate_Lines (10 Oct 2026, UX item 13).
   Load after common.js and before review.js / band.js / terms.js.
   Rate_Lines.Line_Status (Proposed / Verified / Superseded / Rejected) is now the review state.
   Line_Verified and Superseded_By stay populated for compatibility (vendor_cost_contract_margin v5,
   pricing-studio-contract-check.js and con_worker all still read them), so every write here sets all three.
   Reading: Line_Status wins when set; a blank Line_Status falls back to the old sentinel
   (Superseded_By "Rejected in review" = Rejected, any other value = Superseded, Line_Verified = Verified).
   A non-empty Superseded_By on a Proposed/Verified line also counts as superseded, because con_worker
   still marks supersession only through Superseded_By until it writes Line_Status itself. */
(function (root) {
  'use strict';
  var CI = root.CI, H = CI.H, api = CI.api;

  H.LINE_STATUSES = ['Proposed', 'Verified', 'Superseded', 'Rejected'];
  H.SUPERSEDED_IN_REVIEW = 'Superseded in review';   /* Superseded_By is a 24-char text field */

  H.lineStatus = function (r) {
    var ls = r.Line_Status && r.Line_Status !== '-None-' ? String(r.Line_Status) : '';
    var sb = String(r.Superseded_By || '');
    if (ls === 'Superseded' || ls === 'Rejected') return ls;
    if (sb) return sb.indexOf('Rejected') === 0 ? 'Rejected' : 'Superseded';
    if (ls === 'Verified' || ls === 'Proposed') return ls;
    return r.Line_Verified === true || r.Line_Verified === 'true' ? 'Verified' : 'Proposed';
  };
  /* legacy state names, still used by band.js and terms.js */
  H.rateState = function (r) {
    var s = H.lineStatus(r);
    if (s === 'Rejected') return 'rejected';
    if (s === 'Superseded') return 'superseded';
    if (s === 'Verified') return 'verified';
    return r.Source_Ref ? 'pending' : 'hand';
  };
  H.isCurrentLine = function (r, today) {
    var s = H.lineStatus(r);
    if (s === 'Superseded' || s === 'Rejected') return false;
    return !r.Effective_Date || String(r.Effective_Date) <= (today || H.today());
  };
  /* the three fields every status change writes */
  H.statusFields = function (status, supersededBy) {
    switch (status) {
      case 'Verified': return { Line_Status: 'Verified', Line_Verified: true, Superseded_By: null };
      case 'Superseded': return { Line_Status: 'Superseded', Line_Verified: false, Superseded_By: supersededBy || H.SUPERSEDED_IN_REVIEW };
      case 'Rejected': return { Line_Status: 'Rejected', Line_Verified: false, Superseded_By: H.REJECTED };
      default: return { Line_Status: 'Proposed', Line_Verified: false, Superseded_By: null };
    }
  };
  H.isVendorCost = function (r) { return r.Rate_Type === 'Vendor cost'; };
  H.oneTime = function (r) { return Number(r.Rate_Daily_Amount) > 100; };   /* same rule as margin v5 */
  H.tiered = function (r) { return Number(r.Tier_Min_Units) > 0 || Number(r.Tier_Max_Units) > 0; };

  /* ---------- Products for the vendor contract-vs-Products cost check ---------- */
  api.vendorProducts = function (vendorId) {
    if (!vendorId) return Promise.resolve([]);
    if (api.preview) {
      var d = (root.PREVIEW_DATA || {})[CI.PREVIEW] || {};
      return Promise.resolve(JSON.parse(JSON.stringify(d.products || [])));
    }
    var q = "select id, Product_Name, Contract_Rate_Device, Cost_Lease_Daily, Tier_Volume, Current_Tier, Contract_Check, Product_Active from Products where Vendor_Name = '" + vendorId + "' limit 200";
    return Promise.race([ZOHO.CRM.API.coql({ select_query: q }), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, 20000); })])
      .then(function (r) { return ((r && r.data) || []).filter(function (p) { return p.Product_Active !== false; }); });
  };

  /* small styles for the status filter and cost check, kept here so styles.css stays as it is */
  var css = '.lsbar{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}' +
    '.lsbar .f{border:1px solid var(--line-strong);background:var(--surface);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;cursor:pointer;color:var(--ink-2)}' +
    '.lsbar .f[aria-pressed="true"]{background:var(--focus);border-color:var(--focus);color:#fff}' +
    '.lsbar .f .c{margin-left:4px;opacity:.8}' +
    '.costchk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted);font-weight:400;margin-left:8px}' +
    '.terms-card{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin:0 0 14px}' +
    '.terms-card .tc{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:8px 12px}' +
    '.terms-card .tc .k{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}' +
    '.terms-card .tc .v{font-weight:600;margin-top:2px}' +
    'table.t tr.cur td{background:var(--teal-tint)}' +
    '.devhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0 6px;font-size:14px}';
  try { var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); } catch (e) {}
})(this);
