/* vendor-demo.js: sample data for the Vendors view (demo mode only). Shapes match the live COQL rows. */
window.VendorDemo = { make: function () {
  var V = function (id, n, em, x) { return Object.assign({ id: id, Vendor_Name: n, EM_JusticePoint_Vendor: em, Relationship_Status: 'Active partner' }, x || {}); };
  return {
    vendors: [V('v1', 'Allied Universal Electronic Monitoring', true, { Main_Point_of_Contact: { name: 'Allied Support', id: '1' }, Support_Hours: '24/7', Support_Email_RMA: 'rma@allied.example', After_hours_number: '800-555-0101', Customer_Portal: 'https://portal.allied.example', Device_Order_Method: 'Email', Device_Order_Email: 'orders@allied.example', Last_Vendor_Review: '2026-09-30', EM_Units_Current: 420 }),
      V('v2', 'Buddi', true, { Main_Point_of_Contact: { name: 'Buddi Support', id: '2' }, Support_Hours: '8-6 CT', Last_Vendor_Review: '2026-09-30' }),
      V('v3', 'SuperCom', true, { Support_Hours: '24/7', Last_Vendor_Review: '2026-09-30' }), V('v4', 'SCRAM Systems', true, { Last_Vendor_Review: '2026-09-30' }), V('v5', 'Acme Straps', false, { Relationship_Status: 'Evaluating' })],
    contracts: [{ id: 'k1', Name: 'Allied - vendor pricing (standard)', Vendor: { id: 'v1', name: 'Allied' }, Counterparty_Type: 'Vendor', Contract_Status: 'Active/Complete' }, { id: 'k2', Name: 'Buddi - vendor pricing', Vendor: { id: 'v2', name: 'Buddi' }, Counterparty_Type: 'Vendor' },
      { id: 'k3', Name: 'SuperCom - vendor pricing', Vendor: { id: 'v3', name: 'SuperCom' }, Counterparty_Type: 'Vendor' },
      { id: 'c1', Name: 'Adams Co Pretrial - w/ Installs', Account: { id: 'a1', name: 'Adams Co. Pretrial' }, Counterparty_Type: 'Customer' }, { id: 'c2', Name: 'Burnett Co. HHS', Account: { id: 'a2', name: 'Burnett County HHS' }, Counterparty_Type: 'Customer' },
      { id: 'c3', Name: 'Polk Co Sheriff', Account: { id: 'a3', name: 'Polk County Sheriff' }, Counterparty_Type: 'Customer' }, { id: 'c4', Name: 'Havenwood Academy', Account: { id: 'a4', name: 'Havenwood Academy' }, Counterparty_Type: 'Customer' }],
    rateLines: [
      { id: 'r1', Parent_Id: { id: 'k1' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 3.15, Line_Status: 'Verified', Tier_Min_Units: 1, Tier_Max_Units: 50, Rate_Terms: '1-Piece GPS, 1-50 units/day (Addendum 13)' },
      { id: 'r2', Parent_Id: { id: 'k1' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 2.82, Line_Status: 'Verified', Tier_Min_Units: 401, Rate_Terms: '401+ units/day (Addendum 24)' },
      { id: 'r3', Parent_Id: { id: 'k1' }, Rate_Type: 'Vendor cost', Rate_Device: 'Remote Breath', Rate_Daily_Amount: 3.5, Line_Status: 'Verified', Rate_Terms: 'Allied RB' },
      { id: 'r4', Parent_Id: { id: 'k1' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 1.05, Line_Status: 'Superseded', Tier_Min_Units: 401, Effective_Date: '2022-06-01', Rate_Terms: 'Addendum 13, superseded' },
      { id: 'r5', Parent_Id: { id: 'k2' }, Rate_Type: 'Vendor cost', Rate_Device: 'Hybrid GPS + Alcohol', Rate_Daily_Amount: 6.5, Line_Status: 'Verified', Rate_Terms: 'AlcoTag w/GPS' },
      { id: 'r6', Parent_Id: { id: 'k3' }, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 3, Line_Status: 'Verified', Tier_Min_Units: 414, Tier_Max_Units: 908, Rate_Terms: 'GPS, 414-908 units' },
      { id: 'r7', Parent_Id: { id: 'c1' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 13.15, Line_Status: 'Verified', Rate_Vendor: { id: 'v1', name: 'Allied' } },
      { id: 'r8', Parent_Id: { id: 'c1' }, Rate_Type: 'Customer rate', Rate_Device: 'Remote Breath', Rate_Daily_Amount: 12.3, Line_Status: 'Verified', Rate_Vendor: { id: 'v1', name: 'Allied' } },
      { id: 'r9', Parent_Id: { id: 'c2' }, Rate_Type: 'Customer rate', Rate_Device: 'Hybrid GPS + Alcohol', Rate_Daily_Amount: 1100, Line_Status: 'Superseded', Rate_Vendor: { id: 'v2', name: 'Buddi' } },
      { id: 'r10', Parent_Id: { id: 'c2' }, Rate_Type: 'Customer rate', Rate_Device: 'Hybrid GPS + Alcohol', Rate_Daily_Amount: 9, Line_Status: 'Verified', Rate_Vendor: { id: 'v2', name: 'Buddi' } },
      { id: 'r11', Parent_Id: { id: 'c3' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 5.65, Line_Status: 'Proposed' },
      { id: 'r12', Parent_Id: { id: 'c4' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 2.9, Line_Status: 'Verified', Rate_Vendor: { id: 'v3', name: 'SuperCom' } },
      { id: 'r13', Parent_Id: { id: 'c3' }, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 800, Line_Status: 'Verified', Rate_Vendor: { id: 'v1', name: 'Allied' } }]
  };
} };
