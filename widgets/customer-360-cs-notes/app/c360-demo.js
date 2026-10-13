/* Demo data for standalone mode. Fictional accounts; shapes match the live COQL rows. Not used inside Zoho. */
window.C360_DEMO = (function () {
  var TODAY = '2026-10-11';
  function acct(id, name, o) { o.id = id; o.Account_Name = name; return o; }
  var accounts = [
    { id: 'demo-1', name: 'Riverbend County Pretrial (at risk)' },
    { id: 'demo-2', name: 'Lakeshore HHS (healthy)' },
    { id: 'demo-3', name: 'Northfield Sheriff (new, onboarding)' }
  ];
  var data = {
    'demo-1': {
      csnotes: [
        { id: 'n1', Note_Title: 'CS: renewal risk', Note_Content: 'Director says the board wants to rebid EM next spring. Visit before the budget meeting on the 28th.', Created_Time: '2026-10-10T09:00:00-05:00', 'Created_By.first_name': 'Beau Carrigan' },
        { id: 'n2', Note_Title: 'CS: service', Note_Content: 'Two strap tamper cases this month; vendor swap in progress. They noticed and were happy with the follow-up.', Created_Time: '2026-09-29T09:00:00-05:00', 'Created_By.first_name': 'Beau Carrigan' }
      ],
      account: acct('demo-1', 'Riverbend County Pretrial', { Owner: { name: 'Beau Carrigan' }, Account_Type: 'Customer', Health_Tier: 'Red', Health_Score: 30, Customer_Health: 'At Risk', Touch_Status: 'Cold', Days_Since_Touch: 297, Renewal_Date: '2026-12-31', Phone: '555-0101' }),
      contracts: [
        { id: 'c1', Name: 'Riverbend Pretrial Monitoring', Counterparty_Type: 'Customer', Contract_Type: 'Full Contract', Contract_Status: 'Active/Complete', Renewal_Band: '≤90 days', Days_to_Final_End: 81, Final_End_Date: '2026-12-31', Renewal_Status: 'Not started', Owner: { name: 'Beau Carrigan' } },
        { id: 'c2', Name: 'Riverbend Juvenile Addendum', Counterparty_Type: 'Customer', Contract_Type: 'Amendment', Contract_Status: 'Ended', Renewal_Band: 'Expired', Days_to_Final_End: -284, Final_End_Date: '2025-12-31', Renewal_Status: 'Not renewing' }
      ],
      cases: [
        { id: 'k1', Case_Number: 1042, Subject: 'Strap tamper alerts not clearing', Status: 'In Progress', Priority: 'High', Created_Time: '2026-09-18T10:00:00-05:00', Case_Age_days: 23, Owner: { name: 'Support' } },
        { id: 'k2', Case_Number: 1051, Subject: 'Invoice question for September', Status: 'Waiting on Customer', Priority: 'Medium', Created_Time: '2026-10-05T10:00:00-05:00', Case_Age_days: 6 },
        { id: 'k3', Case_Number: 990, Subject: 'Replace charger', Status: 'Closed', Priority: 'Low', Created_Time: '2026-07-01T10:00:00-05:00', Case_Age_days: 40 }
      ],
      onboarding: [], tasks: [],
      contacts: [
        { id: 'p1', Full_Name: 'Dana Whitfield', Title: 'Program Director', Email: 'dana@example.org', Phone: '555-0110', Last_Activity_Time: '2025-12-20T09:00:00-06:00', Stock_Alert_Recipient: true },
        { id: 'p2', Full_Name: 'Marcus Lee', Title: 'Billing Clerk', Email: 'marcus@example.org', Receives_Collections: true, Last_Activity_Time: '2026-02-02T09:00:00-06:00' }
      ]
    },
    'demo-2': {
      account: acct('demo-2', 'Lakeshore HHS', { Owner: { name: 'Beau Carrigan' }, Account_Type: 'Customer', Health_Tier: 'Green', Health_Score: 90, Customer_Health: 'Healthy', Touch_Status: 'Fresh', Days_Since_Touch: 12, Renewal_Date: '2029-06-30' }),
      contracts: [
        { id: 'c3', Name: 'Lakeshore HHS Services', Counterparty_Type: 'Customer', Contract_Type: 'Full Contract', Contract_Status: 'Active/Complete', Renewal_Band: 'OK', Days_to_Final_End: 993, Final_End_Date: '2029-06-30', Renewal_Status: 'Not started' }
      ],
      cases: [], onboarding: [], tasks: [],
      contacts: [{ id: 'p3', Full_Name: 'Priya Raman', Title: 'Manager', Email: 'priya@example.org', Phone: '555-0140', Last_Activity_Time: '2026-09-29T09:00:00-05:00' }]
    },
    'demo-3': {
      account: acct('demo-3', 'Northfield Sheriff', { Owner: { name: 'Beau Carrigan' }, Account_Type: 'Customer', Health_Tier: 'Yellow', Health_Score: 60, Touch_Status: 'Warming', Days_Since_Touch: 20 }),
      contracts: [
        { id: 'c4', Name: 'Northfield Sheriff New Program', Counterparty_Type: 'Customer', Contract_Type: 'Full Contract', Contract_Status: 'Sent for Signature', Renewal_Band: 'OK', Days_to_Final_End: 1085, Final_End_Date: '2029-09-30', Renewal_Status: 'Not started' }
      ],
      cases: [{ id: 'k4', Case_Number: 1060, Subject: 'Question about kickoff date', Status: 'New', Priority: '-None-', Created_Time: '2026-10-09T10:00:00-05:00', Case_Age_days: 2 }],
      onboarding: [{ id: 'o1', Status: 'In progress', Phase: 'Setup', Risk: 'On Track', Go_live_Target: '2026-11-15' }],
      tasks: [
        { id: 't1', Subject: 'Kickoff call', Status: 'Completed', Due_Date: '2026-10-01', Onboarding_Phase: 'Kickoff', Gate: true },
        { id: 't2', Subject: 'Confirm device counts', Status: 'In Progress', Due_Date: '2026-10-08', Onboarding_Phase: 'Setup', Gate: true },
        { id: 't3', Subject: 'Ship starter kit', Status: 'Not Started', Due_Date: '2026-10-20', Onboarding_Phase: 'Setup', Gate: false },
        { id: 't4', Subject: 'Train officers', Status: 'Not Started', Due_Date: '2026-11-01', Onboarding_Phase: 'Training', Gate: true }
      ],
      contacts: [{ id: 'p4', Full_Name: 'Tom Alvarez', Title: 'Chief Deputy', Email: 'tom@example.org', Phone: '555-0150' }]
    }
  };
  return { today: TODAY, accounts: accounts, data: data };
})();
