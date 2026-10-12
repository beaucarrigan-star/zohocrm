/* Sample data for preview mode only (?preview=allied for a vendor contract; ?preview=band etc. live in preview-band.js).
   Live widgets never read this. */
(function (root) {
  'use strict';
  var D = root.PREVIEW_DATA = root.PREVIEW_DATA || {};
  function rate(id, dev, amt, tmin, tmax, eff, src, o) {
    return Object.assign({ id: id, Rate_Device: dev, Rate_Daily_Amount: amt, Tier_Min_Units: tmin, Tier_Max_Units: tmax, Effective_Date: eff,
      Source_Ref: src, Confidence: 'High', Rate_Terms: '', Rate_Type: 'Vendor cost', Line_Verified: false, Line_Status: 'Proposed', Superseded_By: null }, o || {});
  }
  var SRC = 'Allied Master Agreement.zip > Allied Master Agreement.pdf, p.9';
  var rates = [
    rate('a1', 'GPS', 3.10, 1, 100, '2024-01-01', 'Allied Master Agreement.pdf, p.9', { Line_Verified: true, Line_Status: 'Verified' }),
    rate('a2', 'GPS', 2.82, 101, 300, '2024-01-01', 'Allied Master Agreement.pdf, p.9'),
    rate('a3', 'GPS', 2.60, 301, 0, '2024-01-01', 'Allied Master Agreement.pdf, p.9'),
    rate('a4', 'GPS', 3.40, 1, 100, '2022-01-01', 'Addendum 3.pdf, p.2', { Superseded_By: 'a1', Line_Status: 'Superseded' }),
    rate('a5', 'RF Home Unit', 1.05, 0, 0, '2022-01-01', 'Allied Master Agreement.pdf, p.10', { Line_Status: 'Verified', Line_Verified: true }),
    rate('a6', 'RF Home Unit', 850, 0, 0, '2024-01-01', 'Allied Master Agreement.pdf, p.10', { Superseded_By: 'Rejected in review', Line_Status: 'Rejected' })
  ];
  D.allied = {
    contract: {
      id: 'c-allied', Name: 'Allied - vendor pricing (standard)', Counterparty_Type: 'Vendor', Vendor: { id: 'v1', name: 'Allied Universal Electronic Monitoring' },
      Ingest_Status: 'Needs Review', Ingested_On: '2026-10-09', Rate_Lines: rates,
      Ingest_Review: JSON.stringify({ v: 1, packet: 'Allied Master Agreement.zip', fields: [
        { f: 'Contract_Start_Date', v: '2024-01-01', w: true, c: 'High', src: SRC, ev: 'This Agreement begins on January 1, 2024.' }
      ], rates: [{ k: 'GPS|101||2024-01-01', ev: 'Tier 2: 101 to 300 units, $2.82 per unit per day.' }], decisions: { fields: {} } })
    },
    clauses: [], docs: [],
    products: [
      { id: 'p1', Product_Name: 'GPS Ankle Unit', Contract_Rate_Device: 'GPS', Cost_Lease_Daily: 2.9, Tier_Volume: 150, Current_Tier: '101-300', Product_Active: true },
      { id: 'p2', Product_Name: 'RF Home Unit', Contract_Rate_Device: 'RF Home Unit', Cost_Lease_Daily: 1.05, Tier_Volume: null, Product_Active: true }
    ]
  };
  function crate(id, dev, amt, tmin, tmax, eff, o) { return rate(id, dev, amt, tmin, tmax, eff, 'Ramsey County EM Agreement.pdf, p.7', Object.assign({ Rate_Type: 'Customer rate' }, o || {})); }
  D.cust = {
    contract: {
      id: 'c-cust', Name: 'Ramsey County EM Agreement', Counterparty_Type: 'Customer', Ingest_Status: 'Needs Review', Ingested_On: '2026-10-09',
      Rate_Basis: 'Tiered', Admin_Rate_Pct: 8, Payment_Terms_Days: 35, Invoice_Cadence: 'Monthly',
      Rate_Lines: [crate('b1', 'GPS', 3.15, 1, 50, '2025-12-03', { Line_Status: 'Verified', Line_Verified: true }), crate('b2', 'GPS', 3.05, 51, 0, '2025-12-03'),
        crate('b3', 'GPS', 2.92, 51, 0, '2025-06-01', { Superseded_By: 'b2', Line_Status: 'Superseded' }), crate('b4', 'CAM', 8.53, 0, 0, '2025-12-03', { Superseded_By: 'Rejected in review', Line_Status: 'Rejected' })],
      Ingest_Review: JSON.stringify({ v: 1, packet: 'Ramsey.zip', fields: [], rates: [], decisions: { fields: {} } })
    },
    clauses: [{ id: 'k1', Name: 'Monthly report', Title: 'Monthly report', Clause_Type: 'Reporting', Clause_Text: 'Send a monthly report.', Source_Ref: 'Ramsey.pdf, p.4', Status: 'Confirmed', Confidence: 'High' }],
    docs: [], products: []
  };
})(this);
