/* Demo scenarios: one per rule row. Dates are relative to "today" so the card always reads right. Only used with ?demo=1 or outside Zoho. */
(function (root) {
  function iso(n) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var contact = { id: '9001', name: 'Pat Lee' };
  function C(label, o) { return { label: label, module: 'Contracts', contact: contact, rec: Object.assign({ id: '1001', Name: 'Rock Co Pretrial Program', Counterparty_Type: 'Customer', Renewal_Status: 'Not started', Final_End_Date: iso(44), Blocked: false }, o) }; }
  function K(label, o) { return { label: label, module: 'Cases', contact: contact, rec: Object.assign({ id: '3001', Subject: 'Strap broken', Status: 'New', Case_Age_days: 1, Due_By: iso(1) + 'T08:00:00-05:00', Account_Name: { id: '2001', name: 'Rock County' }, Handling_Team: 'EM Support' }, o) }; }
  function F(label, o) { return { label: label, module: 'Billing_Findings', contact: null, rec: Object.assign({ id: '4001', Name: 'Allied D14 duplicate', Status: 'Open', Severity: 'MEDIUM', Money_Type: 'None', Age_days: 3, In_Latest_Run: true }, o) }; }
  function S(label, o) { return { label: label, module: 'Solicitations', contact: null, rec: Object.assign({ id: '5001', Name: 'Dane Co EM RFP', Status: 'Reviewing', Briefing_Status: 'Drafted from packet', Proposal_Due: iso(20) }, o) }; }
  function A(label, o) { return { label: label, module: 'Accounts', contact: contact, rec: Object.assign({ id: '2001', Account_Name: 'Rock County', Account_Type: 'Customer', Customer_Health: 'Healthy', Touch_Status: 'Warm' }, o) }; }
  root.NS_DEMO = [
    C('Contract: Not started, 44 days', {}),
    C('Contract: Not started, 100 days', { Final_End_Date: iso(100) }),
    C('Contract: Not started, 121 days', { Final_End_Date: iso(121) }),
    C('Contract: Not started, ended', { Final_End_Date: iso(-3) }),
    C('Contract: Outreach', { Renewal_Status: 'Outreach', Stage_Entered: iso(-10) }),
    C('Contract: Terms agreed', { Renewal_Status: 'Terms agreed', Stage_Entered: iso(-4) }),
    C('Contract: Sent for signature', { Renewal_Status: 'Sent for signature', Stage_Entered: iso(-6) }),
    C('Contract: Needs decision', { Renewal_Status: 'Needs decision' }),
    C('Contract: Renewed', { Renewal_Status: 'Renewed' }),
    C('Contract: Not renewing', { Renewal_Status: 'Not renewing' }),
    C('Contract: Blocked', { Blocked: true, Blocked_Reason: 'Waiting on county counsel' }),
    C('Contract: vendor (no card)', { Counterparty_Type: 'Vendor' }),
    A('Account: Customer critical', { Customer_Health: 'Critical', Touch_Status: 'Cold', Days_Since_Touch: 62 }),
    A('Account: Customer at risk', { Customer_Health: 'At Risk', Touch_Status: 'Cold', Days_Since_Touch: 1 }),
    A('Account: Customer cold', { Touch_Status: 'Cold', Days_Since_Touch: 75 }),
    A('Account: Customer fine', { Days_Since_Touch: 8 }),
    A('Account: Prospect', { Account_Type: 'Prospect' }),
    A('Account: no type', { Account_Type: null }),
    K('Case: New, due tomorrow', {}),
    K('Case: New, overdue 7 days, open 8', { Due_By: iso(-7) + 'T08:56:40-05:00', Case_Age_days: 8 }),
    K('Case: In Progress, open 6 days', { Status: 'In Progress', Case_Age_days: 6, Due_By: iso(2) }),
    K('Case: Escalated', { Status: 'Escalated' }),
    K('Case: On Hold', { Status: 'On Hold' }),
    K('Case: Waiting on Customer', { Status: 'Waiting on Customer', Waiting_On: 'Customer' }),
    K('Case: Waiting on Vendor', { Status: 'Waiting on Vendor', Waiting_On: 'Vendor' }),
    K('Case: Resolved', { Status: 'Resolved' }),
    K('Case: Closed', { Status: 'Closed', Case_Age_days: 30 }),
    K('Case: no account', { Account_Name: null }),
    F('Finding: Open, medium', {}),
    F('Finding: Open, high, overbilled', { Severity: 'HIGH', Money_Type: 'Overbilled', Dollars: 125 }),
    F('Finding: Open, not in latest run', { In_Latest_Run: false, Age_days: 6 }),
    F('Finding: Disputed with vendor', { Status: 'Disputed with vendor' }),
    F('Finding: Resolved - credited', { Status: 'Resolved - credited' }),
    F('Finding: Resolved - explained', { Status: 'Resolved - explained' }),
    F('Finding: view only (Leadership)', { $editable: false }),
    S('Solicitation: no status', { Status: null }),
    S('Solicitation: Identified', { Status: 'Identified' }),
    S('Solicitation: Reviewing, due 20 days', {}),
    S('Solicitation: Reviewing, due 3 days', { Proposal_Due: iso(3) }),
    S('Solicitation: Decision Pending, due 10 days', { Status: 'Decision Pending', Proposal_Due: iso(10) }),
    S('Solicitation: Go - In Progress', { Status: 'Go - In Progress' }),
    S('Solicitation: Submitted', { Status: 'Submitted' }),
    S('Solicitation: Shortlisted / Orals', { Status: 'Shortlisted / Orals' }),
    S('Solicitation: Won', { Status: 'Won' }),
    S('Solicitation: Lost', { Status: 'Lost' }),
    S('Solicitation: Scoring (retired)', { Status: 'Scoring' }),
    S('Solicitation: no deadline, briefing not started', { Proposal_Due: null, Briefing_Status: 'Not started' })
  ];
})(window);
