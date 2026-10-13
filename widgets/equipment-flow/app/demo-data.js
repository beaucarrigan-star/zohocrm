/* Demo data for Equipment flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers and vendors.
   Rows use the live API shapes. Times are relative to "now". */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now - n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now - n * D).toISOString(); }
    var A = { polk: { id: '9004', name: 'Polk Co. Sheriff' }, boone: { id: '9002', name: 'Boone Co. Sheriff' }, cass: { id: '9003', name: 'Cass County Jail' }, vernon: { id: '9005', name: 'Vernon Co. Sheriff Dept' }, adams: { id: '9001', name: 'Adams Co. Treatment Court' } };
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
    var orders = [
      { id: 'o1', Order_Type: 'Devices', Order_Status: 'Placed', Order_Date: day(21), Method: 'Portal', Items: '4 GPS ankle monitor', Ship_To: '', Reference: 'AU-9001', Case: { id: 'c11', name: 'EM-2070' }, Vendor: V.allied, Account: A.vernon, Source: 'Case' },
      { id: 'o2', Order_Type: 'Devices', Order_Status: 'Placed', Order_Date: day(3), Method: 'Email account manager', Items: '2 GPS ankle monitor', Ship_To: 'Polk Co. Sheriff, 4 Main St, attn Jeremy', Reference: '', Case: { id: 'c5', name: 'EM-2105' }, Vendor: V.scram, Account: A.polk, Source: 'Case' },
      { id: 'o3', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(14), Received_Date: day(2), Received_At: iso(2), Method: 'Emailed form', Items: '10 GPS ankle monitor', Ship_To: '', Received_Qty: 10, Serial_Numbers: 'B1001\nB1002\nB1003\nB1004\nB1005\nB1006\nB1007\nB1008\nB1009\nB1010', Reference: 'BD-77', Case: null, Vendor: V.buddi, Account: null, Source: 'Manual', Stock_Alert: { id: 'al1', name: 'House stock' } },
      { id: 'o4', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(12), Received_Date: day(5), Received_At: iso(5), Method: 'Portal', Items: '2 GPS ankle monitor', Ship_To: 'Vernon Co. Sheriff Dept, 12 Court St', Received_Qty: 2, Serial_Numbers: '', Reference: 'AU-8991', Case: { id: 'c6', name: 'EM-2090' }, Vendor: V.allied, Account: A.vernon, Source: 'Case' },
      { id: 'o5', Order_Type: 'Devices', Order_Status: 'Received', Order_Date: day(9), Received_Date: day(4), Received_At: iso(4), Method: 'Portal', Items: '5 GPS ankle monitor', Ship_To: '', Received_Qty: 4, Serial_Numbers: 'A1\nA2\nA3', Reference: 'AU-8970', Case: null, Vendor: V.allied, Account: null, Source: 'Manual' },
      { id: 'o6', Order_Type: 'Accessories', Order_Status: 'Placed', Order_Date: day(1), Items: '31 Chargers', Reference: 'S-1182', Case: { id: 'c4', name: 'EM-2104' }, Vendor: V.scram, Account: A.boone },
      { id: 'o7', Order_Type: 'Devices', Order_Status: 'Cancelled', Order_Date: day(30), Items: '1 GPS ankle monitor', Reference: 'X', Case: null, Vendor: V.buddi, Account: null }
    ];
    var alerts = [
      { id: 'al1', Name: 'House stock - House stock', Alert_Type: 'House stock', Status: 'Open', Email_Status: 'Not applicable', Device_Family: 'GPS', Spare_Units: 2, Assigned_Units: 16, Threshold: 3, Suggested_Order: 5, Suggested_Return: 0, Last_Seen: day(0), Count_Date: day(0), Account: null },
      { id: 'al2', Name: 'Customer spare floor - Cass County Jail', Alert_Type: 'Customer spare floor', Status: 'Open', Email_Status: 'Sent', Device_Family: 'GPS', Spare_Units: 1, Assigned_Units: 12, Threshold: 3, Suggested_Order: 2, Suggested_Return: 0, Last_Seen: day(0), Account: A.cass },
      { id: 'al3', Name: 'Excess spares - Adams', Alert_Type: 'Excess spares', Status: 'Open', Email_Status: 'Awaiting approval', Device_Family: 'GPS', Spare_Units: 9, Assigned_Units: 10, Threshold: 3, Suggested_Order: 0, Suggested_Return: 4, Last_Seen: day(0), Account: A.adams },
      { id: 'al4', Name: 'Customer spare floor - Boone', Alert_Type: 'Customer spare floor', Status: 'Resolved', Email_Status: 'Sent', Device_Family: 'GPS', Spare_Units: 1, Assigned_Units: 8, Threshold: 3, Suggested_Order: 2, Suggested_Return: 0, Last_Seen: day(6), Account: A.boone }
    ];
    var counts = [];
    [[1, 'GPS', 70, 18], [1, 'RF', 20, 4], [0, 'GPS', 74, 22], [0, 'RF', 20, 3]].forEach(function (r) {
      counts.push({ id: 'k' + counts.length, Count_Date: day(r[0]), Device_Family: r[1], On_Leg: r[2], Spare: r[3], Total_Units: r[2] + r[3], Account: null });
    });
    var returns = [
      { id: 'r1', Name: 'Defective to vendor - Boone', Return_Type: 'Defective to vendor', Return_Status: 'Shipped', Case: { id: 'c3', name: 'EM-2103' }, Account: A.boone, Vendor: V.allied, Device_Family: 'GPS', Quantity: 1, Vendor_RMA_Number: 'AU-55021', Requested_Date: day(18), Shipped_Date: day(12), Created_Time: iso(18) },
      { id: 'r2', Name: 'Excess from customer - Adams', Return_Type: 'Excess from customer', Return_Status: 'Received', Stock_Alert: { id: 'al3', name: 'Excess spares' }, Account: A.adams, Device_Family: 'GPS', Quantity: 4, Requested_Date: day(6), Received_Date: day(1), Created_Time: iso(6) },
      { id: 'r3', Name: 'Defective to vendor - Polk', Return_Type: 'Defective to vendor', Return_Status: 'Requested', Account: A.polk, Vendor: V.scram, Device_Family: 'RF', Quantity: 2, Requested_Date: day(1), Created_Time: iso(1) }
    ];
    return { orders: orders, cases: cases, alerts: alerts, counts: counts, returns: returns };
  }
  window.EquipDemo = { make: make };
})();
