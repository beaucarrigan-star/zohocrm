/* Verified vendor contract rates. No free-text parsing or product-name guessing. */
(function (root) {
  'use strict';
  var id = function (v) { return String(v && v.id || v || ''); };
  var day = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : ''; };
  var number = function (v) { return (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && isFinite(Number(v)) && Number(v) >= 0; };
  function isVendorContract(c) { return !!c && c.Counterparty_Type === 'Vendor' && !!id(c.Vendor); }
  function reason(c, asOf, rowConfirmed) {
    if (!isVendorContract(c)) return 'Not a vendor agreement';
    if (c.Contract_Status !== 'Active/Complete' && c.Contract_Status !== 'Ending - No Renewal') return 'Contract is not active';
    if (!rowConfirmed && (['SharePoint vendor doc', 'Contractbook Article 4'].indexOf(c.Rate_Source) < 0 || !day(c.Last_Verified) || c.Last_Verified > asOf)) return 'Contract rates are not verified';
    if (!day(c.Contract_Start_Date)) return 'Effective date is missing';
    if (c.Contract_Start_Date > asOf) return 'Not yet effective';
    if (c.Contract_End_Date && (!day(c.Contract_End_Date) || c.Contract_End_Date < asOf)) return 'Contract has expired or has an invalid end date';
    return '';
  }
  function fingerprint(c, r) {
    return JSON.stringify([c.id, r.id, id(c.Vendor), id(c.Account), c.Contract_Start_Date, c.Contract_End_Date,
      c.Rate_Source, c.Last_Verified, c.Contract_Status, c.Rate_Notes, c.Contract_Notes,
      r.Rate_Device, r.Rate_Terms, r.Rate_Daily_Amount, r.Tier_Min_Units, r.Tier_Max_Units, id(r.Rate_Vendor),
      r.Confirmation, r.Source, r.Agency, r.Basis, r.Inactive_Rate, r.Free_Inactive_Days]);
  }
  function flatten(contracts, vendorRates) {
    contracts = (contracts || []).filter(isVendorContract);
    var out = [];
    (contracts || []).forEach(function (c) {
      (c.Rate_Lines || []).forEach(function (r) {
        if (r.Rate_Type === 'Vendor cost') out.push({ key: id(c.id) + ':' + id(r.id), contract: c, row: r, basis: 'leased', fingerprint: fingerprint(c, r) });
      });
    });
    (vendorRates || []).forEach(function (v) {
      var c = (contracts || []).filter(function (c) { return id(c.id) === id(v.Contract); })[0];
      if (!c) return;
      var r = Object.assign({}, v, { Rate_Device: v.Device_Type, Rate_Daily_Amount: v.Active_Rate,
        Rate_Terms: [v.Agency, v.Source].filter(Boolean).join(' · ') });
      out.push({ key: 'vendor:' + id(v.id), contract: c, row: r, basis: v.Basis, vendorRate: true, fingerprint: fingerprint(c, r) });
    });
    return out;
  }
  function eligible(rate, product, sc, basis) {
    var c = rate.contract, r = rate.row, asOf = sc.costAsOf;
    if (!day(asOf)) return 'Select a cost effective date';
    if (rate.basis !== (basis || 'leased')) return 'Rate basis does not match device sourcing';
    if (rate.vendorRate && (r.Confirmation !== 'Contract-confirmed' || !String(r.Source || '').trim())) return 'Vendor rate is not contract-confirmed with a source';
    var why = reason(c, asOf, rate.vendorRate); if (why) return why;
    if (rate.vendorRate && r.Agency && !id(sc.account)) return 'Choose the customer account before using an agency-specific rate';
    if (!product || !id(product.vendorId) || id(product.vendorId) !== id(c.Vendor)) return 'Vendor does not match the device';
    if (r.Rate_Vendor && id(r.Rate_Vendor) !== id(c.Vendor)) return 'Rate vendor conflicts with its contract';
    if (id(c.Account) && id(c.Account) !== id(sc.account)) return 'Rate is restricted to a different customer';
    if (!id(r.id) || !number(r.Rate_Daily_Amount)) return 'Daily rate is missing or invalid';
    if ((r.Tier_Min_Units != null && !number(r.Tier_Min_Units)) || (r.Tier_Max_Units != null && !number(r.Tier_Max_Units)) ||
        (r.Tier_Min_Units != null && r.Tier_Max_Units != null && Number(r.Tier_Min_Units) > Number(r.Tier_Max_Units))) return 'Volume tier is invalid';
    return '';
  }
  function resolve(line, product, sc, rates, basis) {
    if (basis === 'purchased') line = { contractRateKey: line.ownedContractRateKey, contractRateAccepted: line.ownedContractRateAccepted, contractTierUnits: line.ownedContractTierUnits, inactivePct: line.inactivePct };
    var rate = (rates || []).filter(function (r) { return r.key === line.contractRateKey; })[0];
    if (!rate) return { error: 'Select a verified vendor contract rate' };
    var why = eligible(rate, product, sc, basis); if (why) return { error: why };
    if (line.contractRateAccepted !== rate.fingerprint) return { error: 'Review and confirm the current contract terms' };
    var r = rate.row;
    if (r.Tier_Min_Units != null || r.Tier_Max_Units != null) {
      var volume = line.contractTierUnits;
      if (!number(volume) || !Number.isInteger(Number(volume))) return { error: 'Enter the qualifying daily volume for this contract tier' };
      if ((r.Tier_Min_Units != null && Number(volume) < Number(r.Tier_Min_Units)) || (r.Tier_Max_Units != null && Number(volume) > Number(r.Tier_Max_Units))) return { error: 'Qualifying volume is outside the selected contract tier' };
    }
    var inactive = 0;
    if (rate.vendorRate && Number(line.inactivePct) > 0) {
      if (!number(r.Inactive_Rate)) return { error: 'Verified inactive daily rate is missing' };
      inactive = Number(r.Inactive_Rate);
      if (inactive > 0 && (!number(r.Free_Inactive_Days) || Number(r.Free_Inactive_Days) > 0)) return { error: 'Inactive grace days require a device-day schedule; this scenario cannot price them' };
    }
    return { amount: Number(r.Rate_Daily_Amount), inactiveAmount: inactive, rate: rate };
  }
  var api = { reason: reason, flatten: flatten, eligible: eligible, resolve: resolve, id: id, isVendorContract: isVendorContract };
  root.ContractRates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
