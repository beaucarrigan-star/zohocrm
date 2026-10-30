/* Demo data for the Processes widget when the Zoho SDK is absent. Fictional. */
window.PROC_DEMO = (function () {
  var t = Date.now(), D = 86400000;
  var periods = [
    { id: 'p10', Name: 'October 2026', Period: '2026-10', Period_Status: 'In Review', Upload_Vendor: 'SCRAM Systems', Invoiced: 68282.26, Verified: 44955.2, On_Hold: 18457.9, Recommended_Pay: 49800, Credits_To_Confirm: 1200, Overbilled: 18457.9, Unverified: 4200, Findings_Total: 12, Findings_Open: 9, Needs_Decision: 5, Last_Run_At: new Date(t - 2 * D).toISOString() },
    { id: 'p09', Name: 'September 2026', Period: '2026-09', Period_Status: 'Reconciled', Upload_Vendor: 'SCRAM Systems', Invoiced: 61000, Verified: 61000, On_Hold: 0, Recommended_Pay: 61000, Findings_Total: 6, Findings_Open: 2, Last_Run_At: new Date(t - 20 * D).toISOString(), Reconciled_On: new Date(t - 12 * D).toISOString() },
    { id: 'p08', Name: 'August 2026', Period: '2026-08', Period_Status: 'Open', Upload_Vendor: '', Findings_Total: null }
  ];
  var vend = ['SCRAM Systems', 'SuperCom'], cats = ['Rate mismatch', 'Device not on file', 'Duplicate charge'], sev = ['HIGH', 'MEDIUM', 'LOW', 'INFO'];
  var findings = [];
  for (var i = 0; i < 18; i++) {
    var per = i < 12 ? '2026-10' : '2026-09', pid = i < 12 ? 'p10' : 'p09', st = i % 5 === 0 ? 'Resolved - credited' : i % 7 === 0 ? 'Disputed with vendor' : 'Open';
    findings.push({ id: 'f' + i, Period: per, Billing_Period: { id: pid, name: per }, Vendor: vend[i % 2], Check_ID: 'C' + (1 + i % 4), Category: cats[i % 3], Subject: 'Device ' + (1000 + i) + ' (A.B.)', Severity: sev[i % 4],
      Dollars: i % 3 === 0 ? 0 : 120 + i * 37, Money_Type: i % 3 === 0 ? 'None' : (i % 2 ? 'Overbilled' : 'Unverified'), Status: st, Is_Open: st === 'Open' || st === 'Disputed with vendor', In_Latest_Run: i % 9 !== 0, Decision_Notes: st === 'Resolved - credited' ? 'Vendor credited' : '' });
  }
  var contracts = [
    { id: 'c1', Name: 'Clark County Human Services', Account: { id: '3', name: 'Clark County Human Services' }, Contract_Status: 'Active/Complete', Ingest_Status: 'Needs Review', Needs_Cleanup: true, Reconciliation_Status: 'Check by hand', Days_to_Final_End: 137, Renewal_Band: 'OK' },
    { id: 'c2', Name: 'Polk Co Sheriff', Account: { id: '5', name: 'Polk Co Sheriff' }, Contract_Status: 'Ended', Ingest_Status: 'Backlog', Needs_Cleanup: false, Reconciliation_Status: 'Archive only', Days_to_Final_End: 0, Renewal_Band: 'Overdue' },
    { id: 'c3', Name: 'Adams Co. Treatment Court (TAD)', Account: { id: '1', name: 'Adams Co. Treatment Court' }, Contract_Status: 'Active/Complete', Ingest_Status: 'Ingested', Needs_Cleanup: false, Reconciliation_Status: 'Rate differs', Days_to_Final_End: 79, Renewal_Band: 'Amber' },
    { id: 'c4', Name: 'Marinette County DA Diversion', Account: { id: '4', name: 'Marinette County DA' }, Contract_Status: 'Active/Complete', Ingest_Status: 'Ingested', Needs_Cleanup: false, Reconciliation_Status: 'Agrees', Days_to_Final_End: 300, Renewal_Band: 'OK' }
  ];
  var sols = [
    { id: 's1', Name: 'Fond du Lac Co HHS: EM services', Issuing_Agency: { id: '6', name: 'Fond Du Lac Co HHS' }, Status: 'Identified', Proposal_Due: '2026-11-12', Days_To_Deadline: 29, Bid_Decision: null, Best_Score: 82, Unmet_Mandatory_Count: 1 },
    { id: 's2', Name: 'Dane Co Sheriff: GPS monitoring', Issuing_Agency: { id: '7', name: 'Dane Co Sheriff' }, Status: 'Identified', Proposal_Due: null, Days_To_Deadline: null, Bid_Decision: 'Bid', Best_Score: 74, Unmet_Mandatory_Count: 0 }
  ];
  contracts[0].Contract_Start_Date = '2025-03-01'; contracts[0].Contract_End_Date = '2027-02-28'; contracts[0].Renewal_Options_Left = 2; contracts[0].Renewal_Option_Length_Mo = 12; contracts[0].Final_End_Date = '2029-02-28'; contracts[0].Contractbook_Status = 'Live contract';
  contracts[1].Contract_Start_Date = '2021-03-01'; contracts[1].Original_End_Date = '2023-03-25'; contracts[1].Contract_End_Date = '2023-03-25'; contracts[1].Renewals_Allowed = 0; contracts[1].Contractbook_Status = 'Archive PDF only';
  contracts[2].Contract_Start_Date = '2024-01-01'; contracts[2].Contract_End_Date = '2026-12-31'; contracts[2].Contractbook_Rates = 'GPS $5.75'; contracts[2].Contractbook_Status = 'Live contract';
  contracts[3].Contract_Start_Date = '2024-03-01'; contracts[3].Original_End_Date = '2025-12-31'; contracts[3].End_After_1_Renewal = '2026-12-31'; contracts[3].Renewals_Allowed = 2; contracts[3].Renewal_Option_Length_Mo = 12; contracts[3].Final_End_Date = '2027-12-31'; contracts[3].Contractbook_Status = 'Live contract';
  var rate_lines = [
    { id: 'l1', Parent_Id: { id: 'c1', name: 'Clark County Human Services' }, Rate_Device: 'GPS', Rate_Vendor: { id: 'v1', name: 'Allied Universal Electronic Monitoring' }, 'Rate_Vendor.Vendor_Name': 'Allied Universal Electronic Monitoring', Rate_Daily_Amount: 4, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l2', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'GPS', Rate_Vendor: null, 'Rate_Vendor.Vendor_Name': null, Rate_Daily_Amount: 13.15, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l3', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'Remote Breath', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 12.3, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l4', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'CAM', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 15, Rate_Type: 'Customer rate', Line_Status: 'Superseded', Effective_Date: null },
    { id: 'l5', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'CAM', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 15, Rate_Type: 'Customer rate', Line_Status: null, Effective_Date: '2024-04-04' }
  ];
  return { periods: periods, findings: findings, contracts: contracts, solicitations: sols, rate_lines: rate_lines };
})();
