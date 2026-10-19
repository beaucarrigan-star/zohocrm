/* Placeholder demo data for ?demo=1. Made up: serials, customers and amounts are not real.
   The full demo set is a later step. Last_Client is deliberately present on some rows to prove it never renders. */
window.LOST_DEMO = {
  accounts: [
    { id: 'a1', Brand: 'JusticePoint EM' },
    { id: 'a2', Brand: 'JusticePoint Programs' },
    { id: 'a3', Brand: 'Sirona Recovery' },
    { id: 'a4', Brand: 'The Difference Principle' }
  ],
  records: [
    { id: 'd1', Name: 'AT1-0001', 'Customer.id': 'a1', 'Customer.Account_Name': 'Demo County Sheriff', 'Manufacturer.Vendor_Name': 'Allied Universal Electronic Monitoring', Device_Type: 'GPS', Loss_Status: 'Lost', Date_Listed_Lost: '2026-01-14', Loss_Amount: 650, Last_Client: 'Demo Client A' },
    { id: 'd2', Name: 'AT1-0002', 'Customer.id': 'a1', 'Customer.Account_Name': 'Demo County Sheriff', 'Manufacturer.Vendor_Name': 'Allied Universal Electronic Monitoring', Device_Type: 'GPS', Loss_Status: 'Damaged', Date_Listed_Lost: '2026-02-03', Loss_Amount: 650, Amount_Billed: 300, Customer_Paid: true, Last_Client: 'Demo Client B' },
    { id: 'd3', Name: 'SR-5510', 'Customer.id': 'a1', 'Customer.Account_Name': 'Demo County Sheriff', 'Manufacturer.Vendor_Name': 'Allied Universal Electronic Monitoring', Device_Type: 'Remote Breath', Loss_Status: 'Lost', Date_Listed_Lost: '2026-03-09', Loss_Amount: 850, Amount_Billed: 200, Customer_Paid: false },
    { id: 'd4', Name: 'CAM-8841', 'Customer.id': 'a2', 'Customer.Account_Name': 'Demo Circuit Court Programs', 'Manufacturer.Vendor_Name': 'SCRAM Systems', Device_Type: 'Transdermal', Loss_Status: 'Recovered', Date_Listed_Lost: '2026-03-21', Loss_Amount: 1250, Vendor_Credited: true, Recovered_On: '2026-04-10' },
    { id: 'd5', Name: 'CAM-8842', 'Customer.id': 'a2', 'Customer.Account_Name': 'Demo Circuit Court Programs', 'Manufacturer.Vendor_Name': 'SCRAM Systems', Device_Type: 'Transdermal', Loss_Status: 'Lost', Date_Listed_Lost: '2026-04-02', Loss_Amount: 1250 },
    { id: 'd6', Name: 'PUREONE-77', 'Customer.id': 'a3', 'Customer.Account_Name': 'Demo Recovery Court', 'Manufacturer.Vendor_Name': 'SuperCom', Device_Type: 'GPS', Loss_Status: 'Lost', Date_Listed_Lost: '2026-05-18', Loss_Amount: 500, Amount_Billed: 500, Customer_Paid: true },
    { id: 'd7', Name: 'PUREONE-78', 'Customer.id': 'a3', 'Customer.Account_Name': 'Demo Recovery Court', 'Manufacturer.Vendor_Name': 'SuperCom', Device_Type: 'GPS', Loss_Status: 'Lost', Date_Listed_Lost: '2026-05-19' },
    { id: 'd8', Name: 'ALCOTAG-31', 'Customer.id': 'a4', 'Customer.Account_Name': 'Demo Pretrial Services', 'Manufacturer.Vendor_Name': 'Buddi', Device_Type: 'Transdermal', Loss_Status: 'Damaged', Date_Listed_Lost: '2026-06-11', Loss_Amount: 1100 },
    { id: 'd9', Name: 'AT1-0001', 'Customer.id': 'a1', 'Customer.Account_Name': 'Demo County Sheriff', 'Manufacturer.Vendor_Name': 'Allied Universal Electronic Monitoring', Device_Type: 'GPS', Loss_Status: 'Lost', Date_Listed_Lost: '2026-08-05', Loss_Amount: 650 },
    { id: 'd10', Name: 'BASE-402', 'Customer.id': 'a2', 'Customer.Account_Name': 'Demo Circuit Court Programs', 'Manufacturer.Vendor_Name': 'SCRAM Systems', Device_Type: 'Base Unit', Loss_Status: 'Recovered', Date_Listed_Lost: '2026-09-02', Loss_Amount: 400, Vendor_Credited: false, Recovered_On: '2026-09-20' },
    { id: 'd11', Name: 'VD-2001', 'Customer.id': 'a4', 'Customer.Account_Name': 'Demo Pretrial Services', 'Manufacturer.Vendor_Name': 'SuperCom', Device_Type: 'Victim Device', Loss_Status: 'Lost', Date_Listed_Lost: '2026-10-07', Loss_Amount: 200 }
  ]
};
