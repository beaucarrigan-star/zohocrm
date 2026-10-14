/* demo-data.js: standalone demo (no Zoho). Shapes match the live COQL rows read 11 Oct 2026; accounts and dates trimmed from real rows. */
window.SHIP_DEMO = (function () {
  function A(id, name) { return { id: id, name: name }; }
  var sher = A('6715134000000666097', 'Sheboygan County Sheriff'), mke = A('6715134000000666077', 'Milwaukee County Pretrial Program'),
      mara = A('6715134000000666071', 'Marathon Co. Sheriff Dept'), polk = A('6715134000000666086', 'Polk Co Sheriff'),
      wash = A('6715134000000666107', 'Washington Co Sheriff'), vern = A('6715134000000666103', 'Vernon Co Sheriff Dept'),
      wood = A('6715134000000666109', 'Wood Co HHS'), race = A('6715134000000666091', 'Racine County Pretrial Program');
  function R(id, acct, o) { return Object.assign({ id: id, Name: acct.name, Account: acct, Recommendation_Date: '2026-10-08', Handled_By: null, Note: null, Last_Contacted_Date: null, Last_Order_Placed_Date: null, Order_Vendor: null, Order_Reference: null }, o); }
  function S(id, acct, date, o) { return Object.assign({ id: id, Name: acct.name + ' ' + date, Account: acct, Ship_Date: date, Is_Accessory: true, Order_Number: '25' + id, Packing_Slip: '25' + id, Tracking_Number: '8721' + id + '0000' }, o); }
  return {
    today: '2026-10-11',
    vendors: [
      { id: 'v1', Vendor_Name: 'Allied Universal Electronic Monitoring', Accessory_Order_Method: 'Portal', Customer_Portal: 'https://portal.example.com/allied/orders', Accessory_Order_Email: null, Accessory_Order_Template: null },
      { id: 'v2', Vendor_Name: 'SCRAM Systems', Accessory_Order_Method: 'Portal', Customer_Portal: 'https://portal.example.com/scram/orders', Accessory_Order_Email: null, Accessory_Order_Template: null },
      { id: 'v3', Vendor_Name: 'Buddi', Accessory_Order_Method: 'Emailed form', Customer_Portal: null, Accessory_Order_Email: 'orders@buddi.example.com', Accessory_Order_Template: 'Buddi order form.docx' },
      { id: 'v4', Vendor_Name: 'SuperCom', Accessory_Order_Method: 'Emailed form', Customer_Portal: null, Accessory_Order_Email: 'orders@supercom.example.com', Accessory_Order_Template: 'SuperCom order form.docx' }
    ],
    me: { id: 'u1', name: 'Beau Carrigan' },
    recs: [
      R('r1', sher, { Order_Vendor: { id: 'v1', name: 'Allied Universal Electronic Monitoring' }, Program_Units: 164, Cadence: 'Every other week', Interval_Days: 14, Last_Accessory_Ship_Date: '2026-08-03', Status: 'Overdue', Suggested_Order: '31 Chargers; 8 Devices. Straps, Tamper Plugs - please ask customer for quantities', Last_Shipment_Summary: '2026-08-03: 100 Straps, 100 Tamper Plugs, 200 Chargers' }),
      R('r2', mke, { Order_Vendor: { id: 'v3', name: 'Buddi' }, Program_Units: 143, Cadence: 'Every other week', Interval_Days: 14, Last_Accessory_Ship_Date: '2026-09-23', Status: 'Due', Suggested_Order: '32 Chargers; 6 Devices. Straps, Pin Trays, Tamper Plugs - please ask customer for quantities' }),
      R('r3', mara, { Program_Units: 12, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-03-05', Status: 'Overdue', Suggested_Order: '1 Devices' }),
      R('r4', polk, { Program_Units: 7, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-07-24', Status: 'Contacted', Suggested_Order: '1 Devices. Straps, Tamper Plugs - please ask customer for quantities', Last_Contacted_Date: '2026-10-02', Handled_By: { id: 'u1', name: 'Beau Carrigan' } }),
      R('r5', wash, { Program_Units: 16, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-09-25', Status: 'Not due', Suggested_Order: '4 Devices' }),
      R('r6', vern, { Program_Units: 20, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-09-04', Status: 'Ordered', Last_Contacted_Date: '2026-10-05', Last_Order_Placed_Date: '2026-10-06', Suggested_Order: '6 Chargers' }),
      R('r7', wood, { Order_Vendor: { id: 'v2', name: 'SCRAM Systems' }, Program_Units: 9, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-07-10', Status: 'Overdue', Suggested_Order: '3 Chargers' }),
      R('r8', race, { Program_Units: 45, Cadence: 'Monthly', Interval_Days: 30, Last_Accessory_Ship_Date: '2026-09-23', Status: 'Not due', Suggested_Order: '15 Chargers; 5 Devices' })
    ],
    ships: [
      S('1', sher, '2026-08-03', { Straps: 100, Tamper_Plugs: 100, Chargers: 200, Quantity: 400 }),
      S('2', sher, '2026-06-18', { Chargers: 50, Quantity: 50 }),
      S('3', mke, '2026-09-23', { Straps: 40, Chargers: 10, Quantity: 50 }),
      S('4', mke, '2026-09-09', { Chargers: 20, Quantity: 20 }),
      S('5', mke, '2026-09-24', { Devices: 2, Quantity: 0, Is_Accessory: false }),
      S('6', mara, '2026-03-05', { Chargers: 20, Quantity: 20 }),
      S('7', mara, '2026-10-09', { Chargers: 10, Quantity: 10 }),
      S('8', polk, '2026-07-24', { Straps: 40, Tamper_Plugs: 40, Quantity: 80 }),
      S('9', wash, '2026-09-25', { Pin_Trays: 100, Tamper_Plugs: 100, Quantity: 200 }),
      S('10', vern, '2026-09-04', { Chargers: 6, Quantity: 6 }),
      S('11', wood, '2026-07-10', { Chargers: 4, Quantity: 4 }),
      S('12', race, '2026-09-23', { Chargers: 8, Quantity: 8 }),
      { Name: 'Justice Point 2026-07-06 #249602', Account: null, Allied_Customer: 'Justice Point', Ship_Date: '2026-07-06', Is_Accessory: true, Quantity: 10, Chargers: 10 }
    ]
  };
})();
