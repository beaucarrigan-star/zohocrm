/* demo-data.js: fake rows used only when the Zoho SDK is absent (browser preview and tests). */
window.RECORDS_DEMO = {
  accounts: { rows: [
    { id: '1', Account_Name: 'Adams Co. Treatment Court', Account_Type: 'Customer', Customer_Health: 'Healthy', Renewal_Date: '2026-12-31', Days_To_Renewal: 79, Open_Cases: 2, Days_Since_Touch: 12, EM_Total_Units: 48, 'Owner.first_name': 'Beau Carrigan', Phone: '608-555-0142', Billing_City: 'Friendship', Billing_State: 'Wisconsin', Health_Score: 82, Renewal_Amount: 61200, Touch_Status: 'Recent touch', Last_Touch: '2026-10-02', GPS_On_Leg: 30, GPS_Spare: 6, GPS_Utilization_Pct: 83.3, Current_Vendor: 'SCRAM Systems', BD_Attention: true, BD_Attention_Note: 'Director retiring in Q1' },
    { id: '2', Account_Name: 'Belmont Co Juvenile Ct', Account_Type: 'Customer', Customer_Health: 'Critical', Renewal_Date: '2026-11-30', Days_To_Renewal: 47, Open_Cases: 5, Days_Since_Touch: 74, EM_Total_Units: 12, 'Owner.first_name': 'Beau Carrigan' },
    { id: '3', Account_Name: 'Clark County Human Services', Account_Type: 'Prospect', Customer_Health: 'Watch', Renewal_Date: '2027-02-28', Days_To_Renewal: 137, Open_Cases: 0, Days_Since_Touch: 31, EM_Total_Units: 0, 'Owner.first_name': 'Dana Pipeline' }],
    related: { contacts: [{ Full_Name: 'Sara Wynne', Title: 'Program Director', Email: 'swynne@example.org', Mobile: '608-555-0111', Last_Activity_Time: '2026-10-09' }],
      deals: [{ id: 'rd1', Deal_Name: '24 GPS renewal', Stage: 'Negotiation', Closing_Date: '2026-12-15', Total_Opportunity_Revenue: 61200, 'Owner.first_name': 'Beau Carrigan' }],
      cases: [{ id: 'rc1', Subject: 'Unit 4417 not charging', Status: 'New', Priority: 'High', Case_Age_days: 3, 'Owner.first_name': 'Beau Carrigan' }, { id: 'rc2', Subject: 'Strap replacement', Status: 'Closed', Priority: 'Low', Case_Age_days: 9, 'Owner.first_name': 'Beau Carrigan' }],
      contracts: [{ Name: 'Adams Co. Treatment Court (TAD)', Contract_Status: 'Active/Complete', Contract_End_Date: '2026-12-31', Days_to_Final_End: 79, Renewal_Band: 'Amber' }], onb: [] } },
  cases: { rows: [
    { id: '1', Subject: 'Unit 4417 not charging', Account_Name: { name: 'Adams Co. Treatment Court', id: '1' }, Status: 'New', Priority: 'High', Case_Age_days: 3, Queue: 'Support', 'Owner.first_name': 'Beau Carrigan', Case_Category: 'Hardware', Case_Origin: 'Email', Dispatch_Status: 'Unscheduled', Dispatch_Exception: 'No installer in region', Reported_By: 'Sara Wynne', Description: 'Participant reports the strap unit will not hold a charge after two days.' },
    { id: '2', Subject: 'Report not received', Account_Name: { name: 'Belmont Co Juvenile Ct', id: '2' }, Status: 'In Progress', Priority: 'Medium', Case_Age_days: 11, Queue: 'Reports', 'Owner.first_name': 'Dana Pipeline' },
    { id: '3', Subject: 'Strap replacement', Account_Name: { name: 'Adams Co. Treatment Court', id: '1' }, Status: 'Closed', Priority: 'Low', Case_Age_days: 9, Queue: 'Support', 'Owner.first_name': 'Beau Carrigan' }], related: {} },
  deals: { rows: [
    { id: '1', Deal_Name: '24 GPS renewal', Account_Name: { name: 'Adams Co. Treatment Court', id: '1' }, Stage: 'Negotiation', Closing_Date: '2026-12-15', Total_Opportunity_Revenue: 61200, Next_Step: 'Send revised quote', 'Owner.first_name': 'Beau Carrigan', Type: 'Renewal', Quantity: 24, Daily_Rate: 4.5, Pipeline: 'Standard', Total_SCRAM_Revenue_Annual: 61200 },
    { id: '2', Deal_Name: 'Clark County Remote Screening', Account_Name: { name: 'Clark County Remote Screening', id: '9' }, Stage: 'Discovery', Closing_Date: '2026-12-31', Total_Opportunity_Revenue: 30000, Next_Step: 'Meeting early October', 'Owner.first_name': 'Beau Carrigan' },
    { id: '3', Deal_Name: '18 GPS', Account_Name: { name: 'Southwest Iowa Juvenile', id: '8' }, Stage: 'Closed Won', Closing_Date: '2025-07-01', Total_Opportunity_Revenue: 30879, 'Owner.first_name': 'Beau Carrigan' }], related: {} },
  contacts: { rows: [
    { id: '1', Full_Name: 'Sara Wynne', Title: 'Program Director', Account_Name: { name: 'Adams Co. Treatment Court', id: '1' }, Email: 'swynne@example.org', Mobile: '608-555-0111', Last_Activity_Time: '2026-10-09', Follow_Up_Status: 'Waiting on reply', 'Owner.first_name': 'Beau Carrigan', Stock_Alert_Recipient: true, Discussion_Topics: 'Renewal pricing, spare units' },
    { id: '2', Full_Name: 'Stephanie Timblin', Title: 'Diversion Coordinator', Account_Name: { name: 'Marinette County DA Diversion', id: '4' }, Email: 'stimblin@example.gov', Last_Activity_Time: '2026-09-20', 'Owner.first_name': 'Beau Carrigan' }], related: {} },
  contracts: { rows: [
    { id: '1', Name: 'Clark County Human Services', Account: { name: 'Clark County Human Services', id: '3' }, Contract_Status: 'Active/Complete', Contract_Type: 'Full Contract', Contract_End_Date: '2027-02-28', Days_to_Final_End: 137, Renewal_Band: 'OK', Renewal_Status: 'Not started', Final_End_Date: '2027-02-28', Notice_Deadline: '2026-11-30', Auto_Renews: true, Payment_Terms_Days: 30, Average_Margin: 24.5 },
    { id: '2', Name: 'Polk Co Sheriff', Account: { name: 'Polk Co Sheriff', id: '5' }, Contract_Status: 'Expired', Contract_End_Date: '2023-03-18', Days_to_Final_End: 0, Renewal_Band: 'Overdue', Renewal_Status: 'Not started', Notice_Passed: true }],
    related: { docs: [{ File_Name: 'Clark_MSA_2024.pdf', Doc_Type: 'Master agreement', Parse_Status: 'Complete', Pages: 22, Effective_Date: '2024-03-01' }], clauses: [{ Title: 'Annual rate escalator', Clause_Type: 'Pricing', Status: 'Active', Due_Date: '2026-12-01', Cadence: 'Annual' }] } },
  onboarding: { rows: [
    { id: '1', Name: 'Clark County Human Services onboarding', Account: { name: 'Clark County Human Services', id: '3' }, Status: 'In progress', Phase: 'Equipment', Risk: 'Medium', Days_to_Go_live: 18, Overdue_Tasks: 2, Open_Gate_Tasks: 3, Go_live_Target: '2026-11-01', Blocked_Reason: 'Waiting on signed order form' }], related: { tasks: [{ Subject: 'Ship starter kit', Status: 'Not Started', Due_Date: '2026-10-20', Onboarding_Phase: 'Equipment', 'Owner.first_name': 'Dana Pipeline' }] } },
  solicitations: { rows: [
    { id: '1', Name: 'Fond du Lac Co HHS: EM services (anticipated)', Issuing_Agency: { name: 'Fond Du Lac Co HHS', id: '6' }, Status: 'Identified', Proposal_Due: '2026-11-12', Days_To_Deadline: 29, Best_Score: 82, Best_Recommendation: 'Bid', Unmet_Mandatory_Count: 1, Scenario_Count: 3, Incumbent: 'SCRAM Systems' }],
    related: { scen: [{ Name: 'Base GPS bundle', Scenario_Type: 'Base', Weighted_Score: 82, Recommendation: 'Bid', Scenario_Status: 'Active' }], reqs: [{ Requirement_Text: '24/7 support line', Mandatory: true, Priority: 'High', Our_Position: 'Meets' }] } },
  vendors: { rows: [
    { id: '1', Vendor_Name: 'SCRAM Systems', Relationship_Status: 'Active partner', Main_Point_of_Contact: { name: 'Heather Duquaine', id: '7' }, EM_Units_Current: 420, Last_Vendor_Review: '2026-08-14', Support_Hours: '24/7', 'Owner.first_name': 'Beau Carrigan', Support_Email_RMA: 'rma@example.com' },
    { id: '2', Vendor_Name: 'SuperCom', Relationship_Status: 'Active partner', Main_Point_of_Contact: { name: 'SuperCom Support', id: '8' }, 'Owner.first_name': 'Beau Carrigan' }], related: { contracts: [{ Name: 'SCRAM master supply', Contract_Status: 'Active/Complete', Contract_End_Date: '2027-06-30', Days_to_Final_End: 259 }] } },
  billing: { rows: [
    { id: '1', Name: 'October 2026', Period: '2026-10', Period_Status: 'In Review', Invoiced: 68282.26, Verified: 44955.2, Overbilled: 18457.9, Latent_Exposure: 4200, Recommended_Pay: 49800, Findings_Open: 216, Findings_Total: 240, Needs_Decision: 79, Unverified: 12, Period_Summary: 'Overbilling concentrated in two vendor lines.' },
    { id: '2', Name: 'September 2026', Period: '2026-09', Period_Status: 'Reconciled', Invoiced: 90387.8, Verified: 88026.2, Overbilled: 339.6, Findings_Open: 185, Needs_Decision: 0 }],
    related: { findings: [{ Subject: 'Justice Point - Marinette County Sheriff', Category: 'Enrollment', Severity: 'MEDIUM', Dollars: 0, Status: 'Open', Recommended_Action: 'Ask the vendor for a device activity report.' }] } }
};

/* generic demo rows for the system-backed related lists (notes, activities, emails, attachments) */
window.RECORDS_COMMON = {
  notes: [
    { Note_Title: 'Renewal call recap', Note_Content: 'Spoke with the director about the renewal. They want a quote for 10 additional units and a refreshed training session before January.', Created_Time: '2026-10-02T14:10:00-05:00' },
    { Note_Title: '', Note_Content: 'Invoice question resolved; credit applied to the September statement.', Created_Time: '2026-09-18T09:30:00-05:00' }
  ],
  attach: [
    { File_Name: 'Signed_MSA.pdf', Size: 482113, Created_Time: '2026-07-01T10:00:00-05:00' },
    { File_Name: 'Rate_sheet_2026.xlsx', Size: 38211, Created_Time: '2026-08-12T10:00:00-05:00' }
  ],
  acts: [
    { id: 'a1', Type: 'Task', Subject: 'Send renewal quote', When: '2026-10-20', Status: 'Not Started' },
    { id: 'a2', Type: 'Call', Subject: 'Check-in call', When: '2026-10-02T13:00:00-05:00', Status: 'Outbound' },
    { id: 'a3', Type: 'Meeting', Subject: 'Quarterly review', When: '2026-09-15T15:00:00-05:00', Status: '' }
  ],
  emails: [
    { id: 'e1', Dir: 'Sent', Subject: 'Re: Renewal quote request', From: 'Beau Carrigan', To: 'swynne@example.org', When: '2026-10-03T08:15:00-05:00', Att: '1 file(s)' },
    { id: 'e2', Dir: 'Received', Subject: 'Renewal quote request', From: 'Sara Wynne', To: 'support@justicepoint.org', When: '2026-10-02T16:40:00-05:00', Att: '' }
  ]
};
