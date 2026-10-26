/* Fictional demo rows for EM Margins, in the same shape COQL returns. Shape mirrors live (23 Oct 2026):
   21 Contract rate rows = 8 Confirmed with a margin (6 customer rows + 2 TEST rows) and 13 Exception (waiting).
   No real customer names. */
(function () {
  'use strict';
  var n = 0;
  function r1(x) { return Math.round((x + 1e-9) * 10) / 10; }
  function tierOf(p) { return p < 0 ? 'Negative' : p < 20 ? 'Thin' : p < 50 ? 'Normal' : 'Strong'; }
  function acct(i, name) { return { id: 'A' + i, name: name }; }
  function con(i, name) { return { id: 'C' + i, name: name }; }
  function ven(i, name) { return { id: 'V' + i, name: name }; }
  var VEN = { allied: ven(1, 'Harbor Monitoring'), scram: ven(2, 'Summit Alcohol Systems'), buddi: ven(3, 'Pinewood Trackers') };

  function filled(a, c, dev, v, desc, rate, cost, costTier) {
    n += 1;
    var pct = r1((rate - cost) / rate * 100), m = Math.round((rate - cost) * 100) / 100;
    var notes = 'Rate only, no volume weighting. Vendor cost from the ' + v.name + ' pricing contract (' + costTier + '; highest tier used).' + (pct < 30 ? ' Below the 30% target by ' + r1(30 - pct) + ' pts.' : '') + ' Updated 2026-10-23.';
    return { id: 'M' + n, Name: c.name + ' - ' + desc, Margin_Key: 'CON|' + c.id + '|L' + n, Row_Type: 'Contract rate', Status: 'Confirmed', Exception_Reason: null,
      Contract: c, Account: a, Vendor: v, Device_Family: dev, Rate_Description: desc, Customer_Rate: rate, Vendor_Daily_Rate: cost, Margin_Per_Unit_Day: m,
      Modelled_Margin_Pct: pct, Modelled_Margin_Tier: tierOf(pct), Vendor_Cost_Tier: costTier, Margin_Notes: notes, Modified_Time: '2026-10-23T17:24:00-05:00' };
  }
  function waiting(a, c, dev, desc, rate, reason) {
    n += 1;
    return { id: 'M' + n, Name: c.name + ' - ' + desc, Margin_Key: 'CON|' + c.id + '|L' + n, Row_Type: 'Contract rate', Status: 'Exception', Exception_Reason: reason,
      Contract: c, Account: a, Vendor: null, Device_Family: dev, Rate_Description: desc, Customer_Rate: rate, Vendor_Daily_Rate: null, Margin_Per_Unit_Day: null,
      Modelled_Margin_Pct: null, Modelled_Margin_Tier: null, Vendor_Cost_Tier: null, Margin_Notes: 'Waiting: ' + reason, Modified_Time: '2026-10-23T17:24:00-05:00' };
  }

  var NV = 'No vendor on this rate line', NR = 'Rate line not verified';
  var oak = acct(1, 'Oakridge County Courts'), bay = acct(2, 'Baywater Pretrial Services'), cedar = acct(3, 'Cedar Valley Probation'),
      dunmore = acct(4, 'Dunmore County Human Services'), elm = acct(5, 'Elmhurst Justice Programs'), fern = acct(6, 'Fernwood County Sheriff'),
      glen = acct(7, 'Glenview Community Corrections'), hart = acct(8, 'Hartwell County Pretrial'), iris = acct(9, 'Irisdale Recovery Court'),
      jun = acct(10, 'Juniper County Probation'), tst = acct(99, 'TEST Account (do not use)');
  var cOak = con(1, 'Oakridge Monitoring Agreement'), cBay = con(2, 'Baywater EM Services 2026'), cCedar = con(3, 'Cedar Valley EM Contract'),
      cDun = con(4, 'Dunmore HS Monitoring'), cElm = con(5, 'Elmhurst EM Agreement'), cFern = con(6, 'Fernwood Pretrial Contract'),
      cGlen = con(7, 'Glenview EM Services'), cHart = con(8, 'Hartwell Monitoring Agreement'), cIris = con(9, 'Irisdale Court Contract'),
      cJun = con(10, 'Juniper EM Services'), cTst = con(99, 'TEST Contract (do not use)');

  var rows = [
    filled(oak, cOak, 'GPS', VEN.allied, 'GPS ankle unit', 6.50, 3.56, 'Tier 2 (highest cost used)'),
    filled(bay, cBay, 'GPS', VEN.allied, 'GPS ankle unit', 4.50, 3.15, 'Base rate'),
    filled(cedar, cCedar, 'Other', VEN.buddi, 'Hybrid GPS and breath', 8.95, 6.50, 'Base rate'),
    filled(cedar, cCedar, 'GPS', VEN.allied, 'GPS ankle unit', 5.80, 4.20, 'Base rate'),
    filled(dunmore, cDun, 'Other', VEN.buddi, 'Hybrid GPS and breath', 7.20, 5.51, 'Tier 1'),
    filled(elm, cElm, 'GPS', VEN.allied, 'GPS ankle unit', 4.00, 3.15, 'Base rate'),
    filled(tst, cTst, 'GPS', VEN.allied, 'GPS ankle unit', 4.00, 3.15, 'Base rate'),
    filled(tst, cTst, 'CAM', VEN.scram, 'CAM landline', 7.60, 6.94, 'Base rate'),

    waiting(fern, cFern, 'GPS', 'GPS ankle unit', 5.25, NV),
    waiting(fern, cFern, 'Remote Breath', 'Remote breath unit', 4.75, NV),
    waiting(fern, cFern, 'CAM', 'CAM landline', 7.60, NV),
    waiting(glen, cGlen, 'GPS', 'GPS ankle unit', 4.90, NV),
    waiting(hart, cHart, 'GPS', 'GPS ankle unit', 5.10, NV),
    waiting(hart, cHart, 'CAM', 'CAM landline', 7.40, NV),
    waiting(iris, cIris, 'GPS', 'GPS ankle unit', 4.60, NV),
    waiting(iris, cIris, 'Remote Breath', 'Remote breath unit', 4.95, NV),
    waiting(jun, cJun, 'GPS', 'GPS ankle unit', 5.35, NV),
    waiting(cedar, cCedar, 'Other', 'Hybrid GPS and breath', 8.95, NV),
    waiting(oak, cOak, 'GPS', 'GPS victim unit', 6.10, NV),
    waiting(jun, cJun, 'Remote Breath', 'Remote breath unit', 4.80, NR),
    waiting(hart, cHart, 'Other', 'Wrist-worn GPS', 5.65, NR)
  ];
  /* One Retired row that every view must ignore. */
  var ret = filled(oak, cOak, 'CAM', VEN.scram, 'CAM landline (superseded)', 7.00, 6.50, 'Base rate'); ret.Status = 'Retired'; ret.id = 'MR1';
  rows.push(ret);
  if (typeof window !== 'undefined') window.MARGINS_DEMO = rows;
  if (typeof module !== 'undefined' && module.exports) module.exports = rows;
})();
