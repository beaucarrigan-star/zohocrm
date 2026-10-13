/* Demo data for the Stock and accessories flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers and vendors.
   Rows use the live API shapes. Times are relative to "now". */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now - n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now - n * D).toISOString(); }
    var A = { polk: { id: '9004', name: 'Polk Co. Sheriff' }, boone: { id: '9002', name: 'Boone Co. Sheriff' }, cass: { id: '9003', name: 'Cass County Jail' }, vernon: { id: '9005', name: 'Vernon Co. Sheriff Dept' }, adams: { id: '9001', name: 'Adams Co. Treatment Court' }, lee: { id: '9006', name: 'Lee Co. Courts' }, lake: { id: '9007', name: 'Lake Co. Probation' }, cook: { id: '9008', name: 'Cook Co. Sheriff' }, mara: { id: '9009', name: 'Marathon Co. Jail' } };
    var V = { allied: { id: 'v1', name: 'Allied Universal EM' }, buddi: { id: 'v2', name: 'Buddi' }, scram: { id: 'v3', name: 'SCRAM Systems' } };
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
      al('a10', 'Excess spares', A.vernon, 'Open', 'Awaiting approval', 0, 6, { Spare_Units: 12, Assigned_Units: 10 }),
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
    var recs = [
      rec('r1', A.cass, 'Overdue', 20),
      rec('r2', A.polk, 'Overdue', 18, { Last_Contacted_Date: day(10), Status: 'Contacted', Handled_By: { id: 'u1', name: 'Stacey L.' } }),
      rec('r3', A.boone, 'Due', 3),
      rec('r4', A.vernon, 'Ordered', 12, { Last_Contacted_Date: day(8), Last_Order_Placed_Date: day(6) }),
      rec('r5', A.adams, 'Contacted', 9, { Last_Contacted_Date: day(2), Handled_By: { id: 'u1', name: 'Stacey L.' } }),
      rec('r6', A.lee, 'Not due', -20),
      rec('r7', A.lake, 'Overdue', 16, { Last_Contacted_Date: day(5), Status: 'Contacted' }),
      rec('r8', A.cook, 'Ordered', 12, { Last_Contacted_Date: day(8), Last_Order_Placed_Date: day(6) }),
      rec('r9', A.mara, 'Overdue', 10, { Last_Contacted_Date: day(8), Status: 'Contacted' })
    ];
    var orders = [
      { id: 'o1', Order_Type: 'Devices', Order_Status: 'Placed', Order_Date: day(3), Reference: 'AU-9001', Vendor: V.allied, Account: null, Stock_Alert: { id: 'a1', name: 'House stock' }, Source: 'Manual' },
      { id: 'o2', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(14), Received_Date: day(4), Received_At: iso(4), Reference: 'BD-77', Vendor: V.buddi, Account: A.adams, Stock_Alert: { id: 'a10', name: 'x' }, Source: 'Manual' },
      { id: 'o3', Order_Type: 'Accessories', Order_Status: 'Placed', Order_Date: day(6), Reference: 'S-1182', Vendor: V.scram, Account: A.vernon, Recommendation: { id: 'r4', name: 'Vernon' }, Source: 'Recommendation' },
      { id: 'o4', Order_Type: 'Accessories', Order_Status: 'Received', Order_Date: day(20), Received_Date: day(15), Reference: 'S-1100', Vendor: V.scram, Account: A.polk, Recommendation: { id: 'r2', name: 'Polk' }, Source: 'Recommendation' }
    ];
    var returns = [
      { id: 'rt1', Return_Type: 'Excess from customer', Return_Status: 'Received', Stock_Alert: { id: 'a9', name: 'x' }, Account: A.vernon, Device_Family: 'GPS', Quantity: 3, Requested_Date: day(8), Received_Date: day(1), Created_Time: iso(8) }
    ];
    var ships = [
      { id: 's1', Ship_Date: day(1), Account: A.lee, Recommendation: null },
      { id: 's2', Ship_Date: day(2), Account: A.lee, Recommendation: { id: 'r6', name: 'Lee' } },
      { id: 's3', Ship_Date: day(40), Account: A.boone, Recommendation: null },
      { id: 's4', Ship_Date: day(1), Account: A.mara, Recommendation: { id: 'r9', name: 'Marathon' } }
    ];
    return { alerts: alerts, recs: recs, orders: orders, returns: returns, ships: ships };
  }
  window.StockFlowDemo = { make: make };
})();
