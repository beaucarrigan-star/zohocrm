/* Demo data for Processes > Margins (fictional; used only outside Zoho). */
(function () {
  var D = window.PROC_DEMO = window.PROC_DEMO || {};
  var V = { allied: { id: 'v1', name: 'Allied Universal Electronic Monitoring' }, scram: { id: 'v2', name: 'SCRAM Systems' }, sc: { id: 'v3', name: 'SuperCom' } };
  var K = function (id, name, acct, extra) { return Object.assign({ id: id, Name: name, Account: { id: 'a' + id, name: acct }, Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete' }, extra || {}); };
  var C = function (id, name, v) { return { id: id, Name: name, Vendor: v, Counterparty_Type: 'Vendor', Contract_Status: 'Active/Complete' }; };
  D.margins = {
    vendors: [V.allied, V.scram, V.sc].map(function (v) { return { id: v.id, name: v.name }; }),
    contracts: [C('vc1', 'Allied - vendor pricing (standard)', V.allied), C('vc2', 'Allied - vendor pricing (Elsewhere)', V.allied), C('vc3', 'SCRAM - vendor pricing', V.scram), C('vc4', 'SuperCom - vendor pricing', V.sc),
      K('k1', 'Sample County A', 'Sample County A Pretrial'), K('k2', 'Sample County B', 'Sample County B Sheriff'), K('k3', 'Sample County C', 'Sample County C HHS', { Rate_Basis: 'Purchased units' }), K('k4', 'Sample County D', 'Sample County D Courts')],
    lines: [
      { id: '101', Parent_Id: { id: 'vc1' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 2.85, Line_Status: 'Verified' },
      { id: '102', Parent_Id: { id: 'vc1' }, Rate_Type: 'Vendor cost', Rate_Device: 'Remote Breath', Rate_Daily_Amount: 3.5, Line_Status: 'Verified' },
      { id: '103', Parent_Id: { id: 'vc3' }, Rate_Type: 'Vendor cost', Rate_Device: 'CAM', Rate_Daily_Amount: 6.94, Line_Status: 'Verified', Rate_Terms: 'SCRAM CAM wireless' },
      { id: '104', Parent_Id: { id: 'vc3' }, Rate_Type: 'Vendor cost', Rate_Device: 'CAM', Rate_Daily_Amount: 5.17, Line_Status: 'Verified', Rate_Terms: 'SCRAM CAM wireless, purchased units (monitoring only)' },
      { id: '105', Parent_Id: { id: 'vc4' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 3, Line_Status: 'Verified' },
      { id: '201', Parent_Id: { id: 'k1' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 5.75, Rate_Vendor: V.allied, Line_Status: 'Verified' },
      { id: '202', Parent_Id: { id: 'k1' }, Rate_Type: 'Customer rate', Rate_Device: 'Remote Breath', Rate_Daily_Amount: 4.25, Rate_Vendor: V.allied, Line_Status: 'Proposed' },
      { id: '203', Parent_Id: { id: 'k2' }, Rate_Type: 'Customer rate', Rate_Device: 'CAM', Rate_Daily_Amount: 7.6, Line_Status: 'Verified' },
      { id: '204', Parent_Id: { id: 'k3' }, Rate_Type: 'Customer rate', Rate_Device: 'CAM', Rate_Daily_Amount: 6.25, Rate_Vendor: V.scram, Line_Status: 'Verified' },
      { id: '205', Parent_Id: { id: 'k4' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 3.6, Rate_Vendor: V.sc, Line_Status: 'Verified' },
      { id: '206', Parent_Id: { id: 'k4' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 3.25, Rate_Vendor: V.sc, Line_Status: 'Superseded', Superseded_By: '205' }]
  };
})();
