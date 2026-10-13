/* Demo data for the Supply flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers and vendors.
   Rows use the live API shapes. Times are relative to "now". Add &stale=1 to see the accessory history as 30 days old. */
(function () {
  'use strict';
  var D = 86400000;
  function make(now, opts) {
    opts = opts || {};
    function day(n) { return new Date(now - n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now - n * D).toISOString(); }
    var A = { polk: { id: '9004', name: 'Polk Co. Sheriff' }, boone: { id: '9002', name: 'Boone Co. Sheriff' }, cass: { id: '9003', name: 'Cass County Jail' }, vernon: { id: '9005', name: 'Vernon Co. Sheriff Dept' },
      adams: { id: '9001', name: 'Adams Co. Treatment Court' }, lee: { id: '9006', name: 'Lee Co. Courts' }, lake: { id: '9007', name: 'Lake Co. Probation' }, cook: { id: '9008', name: 'Cook Co. Sheriff' },
      mara: { id: '9009', name: 'Marathon Co. Jail' }, pike: { id: '9010', name: 'Pike Co. Jail' } };
    var V = { allied: { id: 'v1', name: 'Allied Universal EM' }, buddi: { id: 'v2', name: 'Buddi' }, scram: { id: 'v3', name: 'SCRAM Systems' } };

    var cases = [
      { id: 'c5', Case_Number: 'EM-2105', Subject: 'Need 2 devices, installer to meet us', Status: 'Acknowledged', Created_Time: iso(13), Case_Category: 'Order Device(s)', Account_Name: A.polk },
      { id: 'c6', Case_Number: 'EM-2090', Subject: 'Loaner device request', Status: 'In Progress', Created_Time: iso(21), Case_Category: 'Order Device(s)', Account_Name: A.vernon },
      { id: 'c11', Case_Number: 'EM-2070', Subject: 'Devices ordered last week', Status: 'In Progress', Created_Time: iso(8), Case_Category: 'Order Device(s)', Account_Name: A.vernon },
      { id: 'c12', Case_Number: 'EM-2110', Subject: '6 devices for the new docket', Status: 'New', Created_Time: iso(0.2), Case_Category: 'Order Device(s)', Account_Name: A.boone },
      { id: 'c13', Case_Number: 'EM-2111', Subject: 'Four more GPS units', Status: 'Acknowledged', Created_Time: iso(6), Case_Category: 'Order Device(s)', Account_Name: A.cass },
      { id: 'c4', Case_Number: 'EM-2104', Subject: 'Need 4 more chargers', Status: 'New', Created_Time: iso(2), Case_Category: 'Order Supplies', Account_Name: A.boone },
      { id: 'c3', Case_Number: 'EM-2103', Subject: 'Device offline since Tuesday', Status: 'Escalated', Created_Time: iso(3), Case_Category: 'Device Troubleshooting', Account_Name: A.boone }
    ];
    function al(id, type, acct, status, email, order, ret, over) {
      var r = { id: id, Name: type + (acct ? ' - ' + acct.name : ''), Alert_Type: type, Account: acct, Status: status, Email_Status: email, Suggested_Order: order, Suggested_Return: ret, Device_Family: 'GPS',
        Spare_Units: 2, Assigned_Units: 16, Threshold: 3, Last_Seen: day(0), Created_Time: iso(3), Modified_Time: iso(3), Email_Sent_At: null, Resolution: '' };
      if (over) for (var k in over) r[k] = over[k];
      return r;
    }
    var alerts = [
      al('a1', 'House stock', null, 'Open', 'Not applicable', 5, 0, { Created_Time: iso(6) }),
      al('a2', 'Customer spare floor', A.cass, 'Open', 'Awaiting approval', 2, 0, { Created_Time: iso(6) }),
      al('a3', 'Customer spare floor', A.polk, 'Open', 'Awaiting approval', 1, 0, { Created_Time: iso(0.1) }),
      al('a4', 'Customer spare floor', A.boone, 'Open', 'Sent', 2, 0, { Email_Sent_At: iso(12), Created_Time: iso(20) }),
      al('a5', 'Customer spare floor', A.lee, 'Open', 'No recipient', 1, 0),
      al('a6', 'Program growth', A.vernon, 'Open', 'Awaiting approval', 40, 0, { Device_Family: 'Accessories' }),
      al('a7', 'Excess spares', A.adams, 'Open', 'Rejected', 0, 14, { Spare_Units: 20, Assigned_Units: 10 }),
      al('a8', 'Excess spares', A.lake, 'Open', 'Awaiting approval', 0, 4, { Spare_Units: 9, Assigned_Units: 10 }),
      al('a9', 'Excess spares', A.vernon, 'Open', 'Sent', 0, 3, { Spare_Units: 8, Assigned_Units: 10, Email_Sent_At: iso(4) }),
      al('a10', 'Customer spare floor', A.adams, 'Resolved', 'Sent', 2, 0, { Modified_Time: iso(5) }),
      al('a11', 'Customer spare floor', A.lake, 'Ordered', 'Sent', 1, 0, { Modified_Time: iso(9) }),
      al('a12', 'Customer spare floor', A.polk, 'Dismissed', 'Rejected', 1, 0, { Modified_Time: iso(7) })
    ];
    function rec(id, acct, status, nextAgo, over) {
      var r = { id: id, Name: acct.name, Account: acct, Status: status, Next_Due_Date: day(nextAgo), Suggested_Order: '31 Chargers; 8 Tools', Recommendation_Date: day(nextAgo + 14) };
      if (over) for (var k in over) r[k] = over[k];
      return r;
    }
    var stacey = { id: 'u1', name: 'Stacey L.' };
    var recs = [
      rec('r1', A.cass, 'Overdue', 20), rec('r2', A.polk, 'Contacted', 18, { Last_Contacted_Date: day(10), Handled_By: stacey }), rec('r3', A.boone, 'Due', 3),
      rec('r4', A.vernon, 'Ordered', 12, { Last_Contacted_Date: day(8), Last_Order_Placed_Date: day(6) }), rec('r5', A.adams, 'Contacted', 9, { Last_Contacted_Date: day(2), Handled_By: stacey }),
      rec('r6', A.lee, 'Not due', -20), rec('r7', A.lake, 'Contacted', 16, { Last_Contacted_Date: day(5) }),
      rec('r8', A.cook, 'Ordered', 12, { Last_Contacted_Date: day(8), Last_Order_Placed_Date: day(6) }), rec('r9', A.mara, 'Contacted', 10, { Last_Contacted_Date: day(8) })
    ];
    var orders = [
      { id: 'o1', Order_Type: 'Devices', Order_Status: 'Placed', Order_Date: day(21), Method: 'Portal', Items: '4 GPS ankle monitor', Ship_To: '', Reference: 'AU-9001', Case: { id: 'c11', name: 'EM-2070' }, Vendor: V.allied, Account: A.vernon, Source: 'Case' },
      { id: 'o2', Order_Type: 'Devices', Order_Status: 'Placed', Order_Date: day(3), Method: 'Email account manager', Items: '2 GPS ankle monitor', Ship_To: 'Polk Co. Sheriff, 4 Main St, attn Jeremy', Reference: '', Case: { id: 'c5', name: 'EM-2105' }, Vendor: V.scram, Account: A.polk, Source: 'Case' },
      { id: 'o3', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(14), Received_Date: day(2), Received_At: iso(2), Method: 'Emailed form', Items: '10 GPS ankle monitor', Ship_To: '', Received_Qty: 10,
        Serial_Numbers: 'B1001\nB1002\nB1003\nB1004\nB1005\nB1006\nB1007\nB1008\nB1009\nB1010', Reference: 'BD-77', Case: null, Vendor: V.buddi, Account: null, Source: 'Manual', Stock_Alert: { id: 'a10', name: 'Customer spare floor' } },
      { id: 'o4', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(12), Received_Date: day(5), Received_At: iso(5), Method: 'Portal', Items: '2 GPS ankle monitor', Ship_To: 'Vernon Co. Sheriff Dept, 12 Court St', Received_Qty: 2, Serial_Numbers: '', Reference: 'AU-8991', Case: { id: 'c6', name: 'EM-2090' }, Vendor: V.allied, Account: A.vernon, Source: 'Case' },
      { id: 'o5', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(9), Received_Date: day(4), Received_At: iso(4), Method: 'Portal', Items: '5 GPS ankle monitor', Ship_To: '', Received_Qty: 4, Serial_Numbers: 'A1\nA2\nA3', Reference: 'AU-8970', Case: null, Vendor: V.allied, Account: null, Source: 'Manual' },
      { id: 'o6', Order_Type: 'Accessories', Order_Status: 'Placed', Order_Date: day(6), Reference: 'S-1182', Case: { id: 'c4', name: 'EM-2104' }, Vendor: V.scram, Account: A.vernon, Recommendation: { id: 'r4', name: 'Vernon' }, Source: 'Recommendation' },
      { id: 'o7', Order_Type: 'Devices', Order_Status: 'Cancelled', Order_Date: day(30), Items: '1 GPS ankle monitor', Reference: 'X', Case: null, Vendor: V.buddi, Account: null },
      { id: 'o8', Order_Type: 'Accessories', Order_Status: 'Received', Order_Date: day(20), Received_Date: day(15), Received_At: iso(15), Reference: 'S-1100', Vendor: V.scram, Account: A.polk, Recommendation: { id: 'r2', name: 'Polk' }, Source: 'Recommendation' }
    ];
    var counts = [];
    [[1, 'GPS', 70, 18], [1, 'RF', 20, 4], [0, 'GPS', 74, 22], [0, 'RF', 20, 3]].forEach(function (r) {
      counts.push({ id: 'k' + counts.length, Count_Date: day(r[0]), Device_Family: r[1], On_Leg: r[2], Spare: r[3], Total_Units: r[2] + r[3], Account: null });
    });
    var returns = [
      { id: 'rt1', Name: 'Defective to vendor - Boone', Return_Type: 'Defective to vendor', Return_Status: 'Shipped', Case: { id: 'c3', name: 'EM-2103' }, Account: A.boone, Vendor: V.allied, Device_Family: 'GPS', Quantity: 1, Vendor_RMA_Number: 'AU-55021', Requested_Date: day(18), Shipped_Date: day(12), Created_Time: iso(18) },
      { id: 'rt2', Name: 'Excess from customer - Vernon', Return_Type: 'Excess from customer', Return_Status: 'Received', Stock_Alert: { id: 'a9', name: 'Excess spares' }, Account: A.vernon, Device_Family: 'GPS', Quantity: 3, Requested_Date: day(8), Received_Date: day(1), Created_Time: iso(8) },
      { id: 'rt3', Name: 'Defective to vendor - Polk', Return_Type: 'Defective to vendor', Return_Status: 'Requested', Account: A.polk, Vendor: V.scram, Device_Family: 'RF', Quantity: 2, Requested_Date: day(1), Created_Time: iso(1) }
    ];
    /* Accessory shipment history (the import). Newest is 1 day old, or 30 with stale=1. */
    var lag = opts.stale ? 30 : 0, ships = [], n = 0;
    function ship(acct, ago, rc) { ships.push({ id: 's' + (++n), Ship_Date: day(ago + lag), Account: acct, Recommendation: rc || null }); }
    [A.cass, A.polk, A.boone, A.vernon, A.adams, A.lake, A.mara].forEach(function (a, i) { for (var m = 0; m < 6; m++) ship(a, 3 + i + m * 30); });
    ship(A.lee, 1, { id: 'r6', name: 'Lee' }); ship(A.lee, 2); ship(A.mara, 1, { id: 'r9', name: 'Marathon' });
    ship(A.pike, 20); ship(A.pike, 80); ship(A.pike, 140);    /* Pike orders accessories, no recommendation */
    /* Cook has a recommendation and no shipment in the history */
    return { orders: orders, cases: cases, alerts: alerts, counts: counts, returns: returns, recs: recs, ships: ships };
  }
  window.SupplyDemo = { make: make };
})();
