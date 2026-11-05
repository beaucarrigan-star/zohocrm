/* Demo data for Processes > Rates to fill (fictional; used only outside Zoho). Covers every Part A and Part B status. */
(function () {
  var A = function (id, name) { return { id: id, name: name }; };
  var ac = { a: A('a1', 'Sample County Sheriff'), b: A('a2', 'Sample County Pretrial'), c: A('a3', 'Example Co HHS'), d: A('a4', 'Example Co. Pretrial'), e: A('a5', 'Demo Treatment Court'), f: A('a6', 'Demo City Probation'), g: A('a7', 'Test Valley Juvenile') };
  var D = '2026-11-04';
  var u = function (acc, sv, fam, hv, on, v, via, acq) { return { Count_Date: D, Account: acc, SmartView_Customer: sv, Device_Family: fam, Hardware_Version: hv, On_Leg: on, Vendor: v || null, Supplied_Through: via || null, Acquisition: acq || 'Leased' }; };
  var units = [
    u(ac.a, 'Justice Point - Sample Sheriff', 'GPS', 'AT1 LTE V', 42), u(ac.a, 'Justice Point - Sample Sheriff', 'GPS', 'AT1 LTE A', 6), u(ac.a, 'SCRAM | Sample Sheriff', 'CAM', 'Base Station', 9, 'SCRAM', 'Direct'), u(ac.a, 'SCRAM | Sample Sheriff', 'CAM', 'CAM Bracelet', 9, 'SCRAM', 'Direct'),
    u(ac.b, 'Justice Point - Sample Pretrial', 'GPS', 'AT1 LTE V', 120), u(ac.b, 'SCRAM | Sample Pretrial', 'Remote Breath', 'Remote Breath Pro', 30, 'SCRAM', 'Allied'),
    u(ac.d, 'Justice Point - Example Pretrial', 'GPS', 'AT1 LTE V', 3),
    u(ac.e, 'Justice Point - Demo Treatment Ct', 'GPS', 'AT1 LTE V', 11), u(ac.f, 'SuperCom | Demo City', 'GPS', 'PureOne', 14, 'SuperCom', 'Direct'),
    u(ac.g, 'SCRAM | Test Valley', 'CAM', 'CAM Bracelet', 5, 'SCRAM', 'Direct'), u(null, 'Justice Point - Unknown Agency', 'GPS', 'AT1 LTE V', 4)];
  var V = { allied: A('v1', 'Allied Universal Electronic Monitoring'), scram: A('v2', 'SCRAM Systems'), sc: A('v3', 'SuperCom') };
  var K = function (id, name, acc, st) { return { id: id, Name: name, Account: acc, Counterparty_Type: 'Customer', Contract_Status: st || 'Active/Complete', Final_End_Date: '2027-12-31' }; };
  var card = function (id, name, v) { return { id: id, Name: name, Vendor: v, Counterparty_Type: 'Vendor', Contract_Status: 'Active/Complete' }; };
  var contracts = [card('c1', 'Allied - vendor pricing (standard)', V.allied), card('c2', 'SCRAM - vendor pricing', V.scram), card('c3', 'SuperCom - vendor pricing', V.sc),
    K('k1', 'Sample County Sheriff 2025', ac.a), K('k2', 'Sample County Pretrial', ac.b), K('k3', 'Example Co HHS', ac.c), K('k4', 'Example Co. Sheriff (old)', ac.d, 'Ended'), K('k6', 'Demo City Probation', ac.f), K('k7', 'Test Valley Juvenile', ac.g)];
  var n = 0, L = function (p, type, dev, amt, st, x) { n++; var o = { id: 'l' + (100 + n), Parent_Id: p, Rate_Type: type, Rate_Device: dev, Rate_Daily_Amount: amt, Line_Status: st, Superseded_By: null }; for (var k in x || {}) o[k] = x[k]; return o; };
  var P = function (id, name) { return { id: id, name: name }; }, VC = 'Vendor cost', CR = 'Customer rate';
  var c1 = P('c1', 'Allied - vendor pricing (standard)'), c2 = P('c2', 'SCRAM - vendor pricing'), c3 = P('c3', 'SuperCom - vendor pricing');
  var lines = [L(c1, VC, 'GPS', 2.85, 'Verified'), L(c1, VC, 'Remote Breath', 3.5, 'Superseded', { Superseded_By: 'x' }), L(c2, VC, 'CAM', 6.94, 'Verified'),
    L(c3, VC, 'GPS', 2.75, 'Verified'), L(c3, VC, 'GPS', 3.0, 'Verified'),
    L(P('k1', 'Sample County Sheriff 2025'), CR, 'GPS', 4.5, 'Verified', { Rate_Vendor: V.allied }), L(P('k1', 'Sample County Sheriff 2025'), CR, 'CAM', 7.25, 'Verified', { Rate_Vendor: V.scram }),
    L(P('k2', 'Sample County Pretrial'), CR, 'GPS', 3.2, 'Verified', { Rate_Vendor: V.allied }), L(P('k2', 'Sample County Pretrial'), CR, 'Remote Breath', 5.5, 'Verified', { Rate_Vendor: V.allied }),
    L(P('k3', 'Example Co HHS'), CR, 'GPS', 5.75, 'Verified', { Rate_Vendor: V.allied }), L(P('k6', 'Demo City Probation'), CR, 'GPS', 4.0, 'Proposed', { Rate_Vendor: V.sc })];
  window.RATES_DEMO = { units: units, lines: lines, contracts: contracts };
})();
