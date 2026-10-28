/* order-demo.js: standalone demo for the Order area. ?demo=1&entity=Cases (default Accounts). Shapes mirror live rows read 11 Oct 2026. */
window.ORDER_DEMO = (function () {
  return {
    today: '2026-10-11',
    vendors: [
      { id: 'v1', Vendor_Name: 'Allied Universal Electronic Monitoring', Accessory_Order_Method: 'Portal', Customer_Portal: 'https://smartview.ptm.com/' },
      { id: 'v2', Vendor_Name: 'SCRAM Systems', Accessory_Order_Method: 'Portal', Customer_Portal: 'https://accounts.scramnetwork.com/', Device_Order_Method: 'Email account manager', Device_Order_Email: 'dana.am@scram.example.com', Device_Order_Contact: 'Dana' },
      { id: 'v3', Vendor_Name: 'Buddi', Accessory_Order_Method: 'Emailed form', Accessory_Order_Email: 'orders@buddi.example.com', Accessory_Order_Template: 'Buddi US Order Form - blank.docx' },
      { id: 'v4', Vendor_Name: 'SuperCom', Accessory_Order_Method: 'Emailed form', Accessory_Order_Email: 'orders@supercom.example.com', Accessory_Order_Template: 'SuperCom Equipment Order.docx' }
    ],
    products: [
      { Product_Name: '1 Piece GPS - Allied', Product_Active: true }, { Product_Name: '2 Piece GPS - Allied', Product_Active: true },
      { Product_Name: 'SCRAM CAM - SCRAM Systems', Product_Active: true }, { Product_Name: 'SCRAM Remote Breath - SCRAM Systems', Product_Active: true },
      { Product_Name: 'GPS + Transdermal Hybrid - Buddi', Product_Active: true }, { Product_Name: '1 Piece GPS - SuperCom', Product_Active: true }
    ],
    stockAlerts: [{ Alert_Type: 'House stock', Count_Date: '2026-10-09', Spare_Units: 5, Threshold: 10, Suggested_Order: 5, Status: 'Open' }],
    recentDevices: [
      { Order_Type: 'Devices', Order_Status: 'Received', Received_Date: '2026-10-09', Received_At: '2026-10-09T10:20:00-05:00', Received_Qty: 3, Items: '4 GPS' },
      { Order_Type: 'Devices', Order_Status: 'Placed', Items: '6 1 Piece GPS' }
    ],
    account: { id: 'a1', name: 'Oneida County', vendorIds: ['v3', 'v2'] },
    case: { id: 'c1', caseId: 'EM-1081', subject: 'Need 20 more chargers and 5 straps', vendorId: null },
    orders: [
      { id: 'o1', Name: 'Oneida County - Buddi - 2026-08-14', Vendor: { id: 'v3', name: 'Buddi' }, Items: '20 Chargers; 10 Straps', Order_Status: 'Received', Order_Date: '2026-08-14', Received_Date: '2026-08-21', Reference: '', Source: 'Recommendation', Case: null },
      { id: 'o2', Name: 'Oneida County - Buddi - 2026-09-30', Vendor: { id: 'v3', name: 'Buddi' }, Order_Type: 'Devices', Items: '4 GPS ankle monitors', Order_Status: 'Placed', Order_Date: '2026-09-30', Received_Date: null, Reference: 'B-2291', Source: 'Case', Case: { id: 'c0', name: 'EM-1060' } }
    ]
  };
})();
