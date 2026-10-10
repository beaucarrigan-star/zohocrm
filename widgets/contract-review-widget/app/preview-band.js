/* Sample data for the Contract Review Band: open band.html?preview=band (needs review, mixed counts),
   ?preview=band-clean (verified, everything done) or ?preview=band-new (nothing ingested, no Parse_Status).
   Adds keys to window.PREVIEW_DATA; load it after preview-data.js. Only used when ?preview= is present. */
(function (root) {
  'use strict';
  var D = root.PREVIEW_DATA = root.PREVIEW_DATA || {};
  function rate(id, dev, amt, tmin, tmax, eff, src, o) {
    return Object.assign({ id: id, Rate_Device: dev, Rate_Daily_Amount: amt, Tier_Min_Units: tmin, Tier_Max_Units: tmax, Effective_Date: eff,
      Source_Ref: src, Confidence: 'High', Rate_Terms: '', Rate_Type: 'Customer rate', Line_Verified: false, Superseded_By: null }, o || {});
  }
  function clause(id, title, type, status, o) {
    return Object.assign({ id: id, Name: title, Title: title, Clause_Type: type, Clause_Text: 'The Contractor shall ' + title.toLowerCase() + ' as set out in the agreement.',
      Source_Ref: 'Ramsey County EM Agreement.pdf, p.' + (3 + Number(id.slice(1))), Cadence: '', Due_Date: null, Status: status, Confidence: 'High', Owner: null }, o || {});
  }
  function doc(id, name, status) { var d = { id: id, File_Name: name, Doc_Type: 'Addendum', Sequence: Number(id.slice(1)), Pages: 4, Text_Layer: 'Yes', Effective_Date: '2025-12-03' }; if (status) d.Parse_Status = status; return d; }
  function review(fields, rates) { return JSON.stringify({ v: 1, packet: 'Ramsey County EM Agreement.zip', fields: fields, rates: rates, decisions: { fields: {} } }); }
  var SRC = 'Ramsey County EM Agreement.zip > Ramsey County EM Agreement.pdf, p.2';
  var FIELDS = [
    { f: 'Contract_Start_Date', v: '2025-12-03', w: true, c: 'High', src: SRC, ev: 'This Agreement begins on December 3, 2025 and continues through December 31, 2027.' },
    { f: 'Contract_End_Date', v: '2027-12-31', w: true, c: 'High', src: SRC, ev: 'This Agreement begins on December 3, 2025 and continues through December 31, 2027.' },
    { f: 'Payment_Terms_Days', v: 35, w: true, c: 'Medium', src: SRC, ev: 'The County shall pay each invoice within thirty-five (35) days of receipt.' },
    { f: 'Governing_State', v: 'MN', w: true, c: 'High', src: SRC, ev: 'This Agreement is governed by the laws of the State of Minnesota.' }
  ];
  var RATES = [rate('r1', 'GPS', 3.15, 1, 50, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.7', { Line_Verified: true }),
    rate('r2', 'GPS', 3.10, 51, 300, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.7', { Line_Verified: true }),
    rate('r3', 'GPS', 3.05, 301, 400, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.7'),
    rate('r4', 'GPS', 2.92, 401, 0, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.7', { Superseded_By: 'r5' }),
    rate('r5', 'GPS', 2.82, 401, 0, '2026-02-01', 'Addendum 1.pdf, p.2'),
    rate('r6', 'Remote Breath', 3.92, 0, 0, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.8'),
    rate('r7', 'CAM', 8.53, 0, 0, '2025-12-03', 'Ramsey County EM Agreement.pdf, p.8', { Superseded_By: 'Rejected in review' })];
  var RATEEV = RATES.filter(function (r) { return r.Source_Ref; }).map(function (r) {
    return { k: r.Rate_Device + '|' + r.Tier_Min_Units + '||' + r.Effective_Date, ev: r.Rate_Device + ' monitoring: $' + r.Rate_Daily_Amount.toFixed(2) + ' per participant per day.' };
  });
  var base = { id: 'c1', Contract_Start_Date: '2025-12-03', Contract_End_Date: '2027-12-31', Payment_Terms_Days: 35, Governing_State: 'MN', Name: 'Ramsey County EM Agreement', Counterparty_Type: 'Customer', Ingested_On: '2026-10-02', Ingest_Summary: 'Read 6 documents.\nRates: 7 lines, 1 superseded.\nCONFLICT: none.' };

  D.band = {
    contract: Object.assign({}, base, { Ingest_Status: 'Needs Review', Last_Verified: null, Ingest_Review: review(FIELDS, RATEEV), Rate_Lines: RATES }),
    clauses: [clause('k1', 'Send a monthly utilization report', 'Reporting', 'Confirmed', { Cadence: 'Monthly' }),
      clause('k2', 'Train county staff within 30 days of go-live', 'Training', 'Confirmed'),
      clause('k3', 'Carry $1,000,000 liability insurance', 'Insurance', 'Confirmed'),
      clause('k4', 'Respond to service calls within 4 hours', 'Service level', 'Confirmed'),
      clause('k5', 'Provide an on-site installer for first deployment', 'Install', 'Proposed'),
      clause('k6', 'Retain participant data for seven years', 'Data & privacy', 'Proposed'),
      clause('k7', 'Staff a 24/7 support line', 'Staffing', 'Proposed'),
      clause('k8', 'Waive early termination fees', 'Termination', 'Rejected')],
    docs: [doc('d1', 'Ramsey County EM Agreement.pdf', 'Parsed'), doc('d2', 'Addendum 1.pdf', 'Parsed'), doc('d3', 'Addendum 2.pdf', 'Parsed'),
      doc('d4', 'Insurance certificate.pdf', 'Parsed'), doc('d5', 'Rate schedule.pdf', 'Parsed'), doc('d6', 'Scanned exhibit.pdf', 'Failed')]
  };
  var doneRates = RATES.map(function (r) { return Object.assign({}, r, { Line_Verified: !r.Superseded_By }); });
  D['band-clean'] = {
    contract: Object.assign({}, base, { Ingest_Status: 'Ingested', Last_Verified: '2026-10-06', Ingest_Review: review(FIELDS, RATEEV), Rate_Lines: doneRates }),
    clauses: [clause('k1', 'Send a monthly utilization report', 'Reporting', 'Confirmed'), clause('k2', 'Train county staff within 30 days of go-live', 'Training', 'Confirmed')],
    docs: [doc('d1', 'Ramsey County EM Agreement.pdf', 'Parsed'), doc('d2', 'Addendum 1.pdf', 'Parsed')]
  };
  D['band-new'] = {
    contract: Object.assign({}, base, { Ingest_Status: 'Backlog', Ingest_Summary: '', Ingest_Review: '', Rate_Lines: [] }),
    clauses: [],
    docs: [doc('d1', 'Ramsey County EM Agreement.pdf'), doc('d2', 'Addendum 1.pdf'), doc('d3', 'Addendum 2.pdf')],
    picks: { Ingest_Status: ['Not Ingested', 'Needs Review', 'Ingested', 'Failed', 'Backlog'] }
  };
})(this);
