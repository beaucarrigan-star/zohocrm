/* modules.js: one config per module. Field API names verified against the live org. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(require('./records-model.js')); else root.RecModules = f(root.RecModel); })(this, function (R) {
  'use strict';
  var OWN = 'Owner.first_name';   /* this org returns the owner's full name under first_name */
  var P = R.plain;
  function dtone(v, w, b) { return R.dayTone(v, w, b); }
  function money(label, k) { return [label, k, 'money']; }

  var M = {};

  M.accounts = {
    key: 'accounts', label: 'Accounts', entity: 'Accounts', title: 'Accounts', create: true,
    list: {
      select: ['Account_Name', 'Account_Type', 'Customer_Health', 'Renewal_Date', 'Days_To_Renewal', 'Open_Cases', 'Days_Since_Touch', 'EM_Total_Units', 'Brand', OWN],
      order: 'Account_Name asc', searchField: 'Account_Name', searchHint: 'Search accounts',
      cols: [{ k: 'Account_Name', label: 'Account', main: 1 }, { k: 'Brand', label: 'Brand' }, { k: 'Account_Type', label: 'Type', ed: 'pick', admin: true, opts: ['Customer', 'Prospect', 'Partner', 'Vendor', 'Other'] }, { k: 'Customer_Health', label: 'Health', pill: 1 },
        { k: 'Renewal_Date', label: 'Renewal', t: 'date' }, { k: 'Open_Cases', label: 'Open cases', t: 'num', r: 1 }, { k: 'Days_Since_Touch', label: 'Days since touch', t: 'num', r: 1 }, { k: 'EM_Total_Units', label: 'EM units', t: 'num', r: 1 }, { k: OWN, label: 'Owner' }],
      filters: [{ key: 'all', label: 'All' }, { key: 'cust', label: 'Customers', where: "Account_Type = 'Customer'" }, { key: 'pros', label: 'Prospects', where: "Account_Type = 'Prospect'" }, { key: 'renew', label: 'Renewing in 90 days', where: 'Days_To_Renewal between 0 and 90' },
        { key: 'cold', label: 'No touch in 60+ days', where: 'Days_Since_Touch > 60' }, { key: 'cases', label: 'Has open cases', where: 'Open_Cases > 0' },
        { key: 'b1', label: 'JusticePoint EM', where: "Brand = 'JusticePoint EM'" }, { key: 'b2', label: 'JusticePoint Programs', where: "Brand = 'JusticePoint Programs'" },
        { key: 'b3', label: 'The Difference Principle', where: "Brand = 'The Difference Principle'" }, { key: 'b4', label: 'Sirona Recovery', where: "Brand = 'Sirona Recovery'" }]
    },
    rec: {
      select: ['Account_Name', 'Owner.first_name', 'Account_Type', 'Phone', 'Website', 'Parent_Account', 'Annual_Revenue', 'Billing_City', 'Billing_State', 'Customer_Health', 'Health_Score', 'Renewal_Date', 'Renewal_Amount', 'Days_To_Renewal', 'Last_Touch', 'Touch_Status', 'Days_Since_Touch', 'Last_Training_Date', 'Open_Cases', 'EM_Total_Units', 'GPS_On_Leg', 'GPS_Spare', 'GPS_Utilization_Pct', 'Device_s_Used', 'ED_CEO', 'Contact_Email', 'Key_Personnel', 'Current_Vendor', 'BD_Attention', 'BD_Attention_Note', 'Former_Customer'],
      quick: [{ k: 'Account_Type', label: 'Account type', t: 'pick', admin: true, opts: ['Customer', 'Prospect', 'Partner', 'Vendor', 'Other'] }, { k: 'Last_Touch', label: 'Last touch', t: 'date' }, { k: 'Owner', label: 'Owner', t: 'user' }],
      title: function (r) { return P(r.Account_Name); },
      kicker: function (r) { return 'Account' + (r.Account_Type ? ' · ' + P(r.Account_Type) : ''); },
      sub: function (r) { return [r.Billing_City, r.Billing_State].filter(Boolean).join(', ') + (r[OWN] ? ' · Owner ' + P(r[OWN]) : ''); },
      pill: function (r) { return r.Former_Customer ? ['Former customer', 'grey'] : r.Customer_Health ? [P(r.Customer_Health), R.tone(r.Customer_Health)] : null; },
      kpis: [
        { label: 'Health score', v: function (r) { return r.Health_Score; }, t: 'num' },
        { label: 'Open cases', v: function (r) { return r.Open_Cases; }, t: 'num', tone: function (r) { return +r.Open_Cases > 0 ? 'warn' : 'good'; } },
        { label: 'Days to renewal', v: function (r) { return r.Days_To_Renewal; }, t: 'num', tone: function (r) { return dtone(r.Days_To_Renewal, 90, 30); } },
        { label: 'Days since touch', v: function (r) { return r.Days_Since_Touch; }, t: 'num', tone: function (r) { return r.Days_Since_Touch == null ? 'grey' : +r.Days_Since_Touch > 60 ? 'bad' : +r.Days_Since_Touch > 30 ? 'warn' : 'good'; } },
        { label: 'EM units', v: function (r) { return r.EM_Total_Units; }, t: 'num' },
        { label: 'GPS utilization', v: function (r) { return r.GPS_Utilization_Pct; }, t: 'pct' }],
      attn: function (r) { return r.BD_Attention ? 'BD attention' + (r.BD_Attention_Note ? ': ' + r.BD_Attention_Note : '') : null; },
      cards: [
        { title: 'Profile', rows: [['Phone', 'Phone'], ['Website', 'Website'], ['Parent account', 'Parent_Account'], ['Annual revenue', 'Annual_Revenue', 'money'], ['Executive director / CEO', 'ED_CEO'], ['Contact email', 'Contact_Email'], ['Key personnel', 'Key_Personnel']] },
        { title: 'Renewal and touch', rows: [['Renewal date', 'Renewal_Date', 'date'], ['Renewal amount', 'Renewal_Amount', 'money'], ['Last touch', 'Last_Touch', 'date'], ['Touch status', 'Touch_Status'], ['Last training', 'Last_Training_Date', 'date'], ['Current vendor', 'Current_Vendor']] },
        { title: 'Equipment', rows: [['EM units', 'EM_Total_Units', 'num'], ['GPS on leg', 'GPS_On_Leg', 'num'], ['GPS spare', 'GPS_Spare', 'num'], ['GPS utilization', 'GPS_Utilization_Pct', 'pct'], ['Devices used', 'Device_s_Used']] }],
      tabs: [
        { id: 'contacts', label: 'Contacts', entity: 'Contacts', lookup: 'Account_Name', select: ['Full_Name', 'Title', 'Email', 'Mobile', 'Last_Activity_Time'], order: 'Full_Name asc', cols: [{ k: 'Full_Name', label: 'Name', main: 1 }, { k: 'Title', label: 'Title' }, { k: 'Email', label: 'Email' }, { k: 'Mobile', label: 'Mobile' }, { k: 'Last_Activity_Time', label: 'Last activity', t: 'date' }] },
        { id: 'deals', label: 'Opportunities', entity: 'Deals', lookup: 'Account_Name', select: ['Deal_Name', 'Stage', 'Closing_Date', 'Total_Opportunity_Revenue', OWN], order: 'Closing_Date desc', cols: [{ k: 'Deal_Name', label: 'Opportunity', main: 1 }, { k: 'Stage', label: 'Stage', pill: 1 }, { k: 'Closing_Date', label: 'Close', t: 'date' }, { k: 'Total_Opportunity_Revenue', label: 'Revenue', t: 'money', r: 1 }, { k: OWN, label: 'Owner' }] },
        { id: 'cases', label: 'Cases', entity: 'Cases', lookup: 'Account_Name', select: ['Case_Number', 'Subject', 'Status', 'Priority', 'Case_Age_days', OWN], order: 'Case_Age_days asc', cols: [{ k: 'Subject', label: 'Subject', main: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Priority', label: 'Priority', pill: 1 }, { k: 'Case_Age_days', label: 'Age (days)', t: 'num', r: 1 }, { k: OWN, label: 'Owner' }] },
        { id: 'contracts', label: 'Contracts', entity: 'Contracts', lookup: 'Account', select: ['Name', 'Contract_Status', 'Contract_End_Date', 'Days_to_Final_End', 'Renewal_Band'], order: 'Contract_End_Date asc', cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Contract_End_Date', label: 'Ends', t: 'date' }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }, { k: 'Renewal_Band', label: 'Band', pill: 1 }] },
        { id: 'onb', label: 'Onboarding', entity: 'Customer_Onboarding', lookup: 'Account', select: ['Name', 'Status', 'Phase', 'Risk', 'Go_live_Target'], order: 'Go_live_Target asc', cols: [{ k: 'Name', label: 'Onboarding', main: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Phase', label: 'Phase' }, { k: 'Risk', label: 'Risk', pill: 1 }, { k: 'Go_live_Target', label: 'Go-live target', t: 'date' }] }]
    }
  };

  M.cases = {
    key: 'cases', label: 'Cases', entity: 'Cases', title: 'Cases', create: true,
    list: {
      select: ['Case_Number', 'Subject', 'Account_Name', 'Status', 'Priority', 'Case_Age_days', 'Queue', OWN],
      order: 'Created_Time desc', searchField: 'Subject', searchHint: 'Search case subjects',
      cols: [{ k: 'Subject', label: 'Subject', main: 1 }, { k: 'Account_Name', label: 'Account' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Priority', label: 'Priority', ed: 'pick', opts: ['High', 'Medium', 'Low'] }, { k: 'Queue', label: 'Queue', ed: 'pick', opts: ['Support', 'Reports', 'Personal'] }, { k: 'Case_Age_days', label: 'Age (days)', t: 'num', r: 1 }, { k: OWN, label: 'Owner' }],
      filters: [{ key: 'all', label: 'All' }, { key: 'open', label: 'Open', where: "Status != 'Closed'" }, { key: 'high', label: 'High priority', where: "Priority = 'High'" }, { key: 'closed', label: 'Closed', where: "Status = 'Closed'" }]
    },
    rec: {
      select: ['Subject', 'Case_Number', 'Account_Name', 'Owner.first_name', 'Status', 'Priority', 'Case_Origin', 'Case_Category', 'Case_Age_days', 'Queue', 'Dispatch_Status', 'Dispatch_Exception', 'Dispatch_Exception_Note', 'Scheduled_Start', 'Scheduled_End', 'Assigned_Installer', 'Job_Type', 'Service_City', 'Service_County', 'DOC_Region', 'Requested_Date', 'Due_By', 'Participant_ID', 'Device_Serial', 'Vendor_Ticket_Number', 'Resolution_Category', 'Reported_By', 'Email', 'Phone', 'Description', 'Internal_Comments', 'Solution'],
      quick: [{ k: 'Priority', label: 'Priority', t: 'pick', opts: ['High', 'Medium', 'Low'] }, { k: 'Queue', label: 'Queue', t: 'pick', opts: ['Support', 'Reports', 'Personal'] }],
      title: function (r) { return P(r.Subject); },
      kicker: function (r) { return 'Case' + (r.Case_Category ? ' · ' + P(r.Case_Category) : ''); },
      sub: function (r) { return [P(r.Account_Name), r[OWN] ? 'Owner ' + P(r[OWN]) : '', r.Case_Origin ? 'via ' + P(r.Case_Origin) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Status ? [P(r.Status), R.tone(r.Status)] : null; },
      kpis: [
        { label: 'Priority', v: function (r) { return r.Priority; }, tone: function (r) { return R.tone(r.Priority); } },
        { label: 'Age (days)', v: function (r) { return r.Case_Age_days; }, t: 'num', tone: function (r) { return r.Case_Age_days == null ? 'grey' : +r.Case_Age_days > 14 ? 'bad' : +r.Case_Age_days > 5 ? 'warn' : 'good'; } },
        { label: 'Queue', v: function (r) { return r.Queue; } },
        { label: 'Dispatch', v: function (r) { return r.Dispatch_Status; }, tone: function (r) { return r.Dispatch_Exception ? 'bad' : R.tone(r.Dispatch_Status); } },
        { label: 'Due by', v: function (r) { return r.Due_By; }, t: 'date' }],
      attn: function (r) { return r.Dispatch_Exception ? 'Dispatch exception: ' + P(r.Dispatch_Exception) + (r.Dispatch_Exception_Note ? ' (' + r.Dispatch_Exception_Note + ')' : '') : null; },
      cards: [
        { title: 'Case', rows: [['Case number', 'Case_Number'], ['Reported by', 'Reported_By'], ['Email', 'Email'], ['Phone', 'Phone'], ['Participant ID', 'Participant_ID'], ['Device serial', 'Device_Serial'], ['Vendor ticket', 'Vendor_Ticket_Number'], ['Resolution', 'Resolution_Category']] },
        { title: 'Dispatch', rows: [['Job type', 'Job_Type'], ['Installer', 'Assigned_Installer'], ['Scheduled start', 'Scheduled_Start', 'date'], ['Scheduled end', 'Scheduled_End', 'date'], ['Requested date', 'Requested_Date', 'date'], ['City', 'Service_City'], ['County', 'Service_County'], ['DOC region', 'DOC_Region']] },
        { title: 'Description', text: 'Description' }, { title: 'Internal comments', text: 'Internal_Comments' }, { title: 'Solution', text: 'Solution' }],
      tabs: []
    }
  };

  M.deals = {
    key: 'deals', label: 'Opportunities', entity: 'Deals', title: 'Opportunities', create: true,
    list: {
      select: ['Deal_Name', 'Account_Name', 'Stage', 'Closing_Date', 'Total_Opportunity_Revenue', 'Next_Step', OWN],
      order: 'Closing_Date asc', searchField: 'Deal_Name', searchHint: 'Search opportunities',
      cols: [{ k: 'Deal_Name', label: 'Opportunity', main: 1 }, { k: 'Account_Name', label: 'Account' }, { k: 'Stage', label: 'Stage', ed: 'pick', opts: ['Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] }, { k: 'Closing_Date', label: 'Close', t: 'date', ed: 'date' }, { k: 'Total_Opportunity_Revenue', label: 'Annual revenue', t: 'money', r: 1 }, { k: 'Next_Step', label: 'Next step', ed: 'text' }, { k: OWN, label: 'Owner' }],
      filters: [{ key: 'all', label: 'All' }, { key: 'open', label: 'Open', where: "Stage not in ('Closed Won','Closed Lost')" }, { key: 'won', label: 'Won', where: "Stage = 'Closed Won'" }, { key: 'lost', label: 'Lost', where: "Stage = 'Closed Lost'" }]
    },
    rec: {
      select: ['Deal_Name', 'Account_Name', 'Contact_Name', 'Owner.first_name', 'Type', 'Stage', 'Stage_Group', 'Closing_Date', 'Next_Step', 'Total_Opportunity_Revenue', 'Total_Allied_Revenue_Annual', 'Total_SCRAM_Revenue_Annual', 'Total_Buddi_Revenue_Annual', 'Total_SuperCom_DV_Revenue_Annual', 'Service_Lines', 'Pipeline', 'Daily_Rate', 'Quantity', 'Vendor_Used', 'Source_Campaign', 'Lost_To', 'Description', 'Opportunity_Notes'],
      quick: [{ k: 'Stage', label: 'Stage', t: 'pick', opts: ['Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] }, { k: 'Next_Step', label: 'Next step', t: 'text' }, { k: 'Closing_Date', label: 'Close date', t: 'date' }, { k: 'Owner', label: 'Owner', t: 'user' }],
      title: function (r) { return P(r.Deal_Name); },
      kicker: function (r) { return 'Opportunity' + (r.Type ? ' · ' + P(r.Type) : ''); },
      sub: function (r) { return [P(r.Account_Name), P(r.Contact_Name), r[OWN] ? 'Owner ' + P(r[OWN]) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Stage ? [P(r.Stage), R.tone(r.Stage)] : null; },
      kpis: [
        { label: 'Annual revenue', v: function (r) { return r.Total_Opportunity_Revenue; }, t: 'money' },
        { label: 'Close date', v: function (r) { return r.Closing_Date; }, t: 'date' },
        { label: 'Daily rate', v: function (r) { return r.Daily_Rate; }, t: 'money' },
        { label: 'Quantity', v: function (r) { return r.Quantity; }, t: 'num' },
        { label: 'Pipeline', v: function (r) { return r.Pipeline; } }],
      cards: [
        { title: 'Deal', rows: [['Stage group', 'Stage_Group'], ['Next step', 'Next_Step'], ['Service lines', 'Service_Lines'], ['Vendor used', 'Vendor_Used'], ['Source campaign', 'Source_Campaign'], ['Lost to', 'Lost_To']] },
        { title: 'Revenue by vendor (annual)', rows: [['Allied', 'Total_Allied_Revenue_Annual', 'money'], ['SCRAM', 'Total_SCRAM_Revenue_Annual', 'money'], ['Buddi', 'Total_Buddi_Revenue_Annual', 'money'], ['SuperCom', 'Total_SuperCom_DV_Revenue_Annual', 'money']] },
        { title: 'Description', text: 'Description' }, { title: 'Notes', text: 'Opportunity_Notes' }],
      tabs: []
    }
  };

  M.contacts = {
    key: 'contacts', label: 'Contacts', entity: 'Contacts', title: 'Contacts', create: true,
    list: {
      select: ['Full_Name', 'Title', 'Account_Name', 'Email', 'Mobile', 'Last_Activity_Time', 'Follow_Up_Status', OWN],
      order: 'Full_Name asc', searchField: 'Full_Name', searchHint: 'Search contacts',
      cols: [{ k: 'Full_Name', label: 'Name', main: 1 }, { k: 'Title', label: 'Title' }, { k: 'Account_Name', label: 'Account' }, { k: 'Email', label: 'Email' }, { k: 'Mobile', label: 'Mobile' }, { k: 'Last_Activity_Time', label: 'Last activity', t: 'date' }, { k: OWN, label: 'Owner' }],
      filters: [{ key: 'all', label: 'All' }, { key: 'fu', label: 'Follow-up set', where: 'Follow_Up_Status is not null' }, { key: 'stock', label: 'Stock alert recipients', where: 'Stock_Alert_Recipient = true' }, { key: 'coll', label: 'Receives collections', where: 'Receives_Collections = true' }]
    },
    rec: {
      select: ['Full_Name', 'Title', 'Account_Name', 'Owner.first_name', 'Email', 'Mobile', 'Office_Phone', 'Department', 'Last_Activity_Time', 'Last_Inbound_Email', 'Follow_Up_Status', 'Follow_Up_Preference', 'Stock_Alert_Recipient', 'Receives_Collections', 'Vendor_Name', 'Vendor_Role', 'Discussion_Topics', 'Device_s_Used', 'Source_Inbox', 'Lead_Source'],
      title: function (r) { return P(r.Full_Name); },
      kicker: function () { return 'Contact'; },
      sub: function (r) { return [r.Title, P(r.Account_Name), r[OWN] ? 'Owner ' + P(r[OWN]) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Follow_Up_Status ? [P(r.Follow_Up_Status), R.tone(r.Follow_Up_Status)] : null; },
      kpis: [
        { label: 'Last activity', v: function (r) { return r.Last_Activity_Time; }, t: 'date' },
        { label: 'Last inbound email', v: function (r) { return r.Last_Inbound_Email; }, t: 'date' },
        { label: 'Stock alerts', v: function (r) { return r.Stock_Alert_Recipient ? 'Yes' : 'No'; } },
        { label: 'Collections', v: function (r) { return r.Receives_Collections ? 'Yes' : 'No'; } }],
      cards: [
        { title: 'Reach', rows: [['Email', 'Email'], ['Mobile', 'Mobile'], ['Office phone', 'Office_Phone'], ['Department', 'Department'], ['Follow-up preference', 'Follow_Up_Preference'], ['Source inbox', 'Source_Inbox'], ['Lead source', 'Lead_Source']] },
        { title: 'Context', rows: [['Vendor', 'Vendor_Name'], ['Vendor role', 'Vendor_Role'], ['Devices used', 'Device_s_Used']] },
        { title: 'Discussion topics', text: 'Discussion_Topics' }],
      tabs: []
    }
  };

  M.contracts = {
    key: 'contracts', label: 'Contracts', entity: 'Contracts', title: 'Contracts', create: true,
    list: {
      select: ['Name', 'Account', 'Contract_Status', 'Contract_Type', 'Contract_End_Date', 'Days_to_Final_End', 'Renewal_Band', 'Renewal_Status'],
      order: 'Contract_End_Date asc', searchField: 'Name', searchHint: 'Search contracts',
      cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Account', label: 'Account' }, { k: 'Contract_Status', label: 'Status', ed: 'pick', admin: true, opts: ['Draft', 'Active', 'Expired', 'Terminated'] }, { k: 'Contract_Type', label: 'Type' }, { k: 'Contract_End_Date', label: 'Ends', t: 'date' }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }, { k: 'Renewal_Band', label: 'Band', pill: 1 }, { k: 'Renewal_Status', label: 'Renewal', ed: 'pick', opts: ['Not started', 'In progress', 'Renewed', 'Lost'] }],
      filters: [{ key: 'all', label: 'All' }, { key: '90', label: 'Ending in 90 days', where: 'Days_to_Final_End between 0 and 90' }, { key: 'notice', label: 'Notice deadline passed', where: 'Notice_Passed = true' }, { key: 'auto', label: 'Auto-renews', where: 'Auto_Renews = true' }]
    },
    rec: {
      select: ['Name', 'Account', 'Vendor', 'Counterparty_Type', 'Contract_Status', 'Contract_Type', 'Contract_Start_Date', 'Contract_End_Date', 'Final_End_Date', 'Days_to_Final_End', 'Renewal_Band', 'Renewal_Status', 'Renewal_Owner', 'Notice_Deadline', 'Notice_Passed', 'Notice_Period_Days', 'Auto_Renews', 'Renewal_Options_Left', 'Amendment_Count', 'Payment_Terms_Days', 'Invoice_Cadence', 'Rate_Basis', 'Escalator_Pct', 'Admin_Rate_Pct', 'Not_To_Exceed', 'Lowest_Margin', 'Average_Margin', 'Margin_Tier', 'Ingest_Status', 'Reconciliation_Status', 'Data_Issues', 'Contract_Notes', 'Renewal_Notes'],
      quick: [{ k: 'Contract_Status', label: 'Contract status', t: 'pick', admin: true, opts: ['Draft', 'Active', 'Expired', 'Terminated'] }, { k: 'Renewal_Status', label: 'Renewal status', t: 'pick', opts: ['Not started', 'In progress', 'Renewed', 'Lost'] }],
      title: function (r) { return P(r.Name); },
      kicker: function (r) { return 'Contract' + (r.Contract_Type ? ' · ' + P(r.Contract_Type) : ''); },
      sub: function (r) { return [P(r.Account) || P(r.Vendor), r.Counterparty_Type ? P(r.Counterparty_Type) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Contract_Status ? [P(r.Contract_Status), R.tone(r.Contract_Status)] : null; },
      kpis: [
        { label: 'Days to final end', v: function (r) { return r.Days_to_Final_End; }, t: 'num', tone: function (r) { return dtone(r.Days_to_Final_End, 90, 30); } },
        { label: 'Final end', v: function (r) { return r.Final_End_Date; }, t: 'date' },
        { label: 'Notice deadline', v: function (r) { return r.Notice_Deadline; }, t: 'date', tone: function (r) { return r.Notice_Passed ? 'bad' : 'grey'; } },
        { label: 'Renewal band', v: function (r) { return r.Renewal_Band; }, tone: function (r) { return R.tone(r.Renewal_Band); } },
        { label: 'Average margin', v: function (r) { return r.Average_Margin; }, t: 'pct' }],
      attn: function (r) { return r.Notice_Passed ? 'Notice deadline has passed' : (r.Data_Issues ? 'Data issues: ' + r.Data_Issues : null); },
      cards: [
        { title: 'Term', rows: [['Start', 'Contract_Start_Date', 'date'], ['End', 'Contract_End_Date', 'date'], ['Auto-renews', 'Auto_Renews', 'bool'], ['Renewal options left', 'Renewal_Options_Left', 'num'], ['Notice period (days)', 'Notice_Period_Days', 'num'], ['Amendments', 'Amendment_Count', 'num'], ['Renewal owner', 'Renewal_Owner'], ['Renewal status', 'Renewal_Status']] },
        { title: 'Billing', rows: [['Payment terms (days)', 'Payment_Terms_Days', 'num'], ['Invoice cadence', 'Invoice_Cadence'], ['Rate basis', 'Rate_Basis'], ['Escalator', 'Escalator_Pct', 'pct'], ['Admin rate', 'Admin_Rate_Pct', 'pct'], ['Not to exceed', 'Not_To_Exceed', 'money'], ['Lowest margin', 'Lowest_Margin', 'pct'], ['Margin tier', 'Margin_Tier']] },
        { title: 'Data quality', rows: [['Ingest status', 'Ingest_Status'], ['Reconciliation', 'Reconciliation_Status']] },
        { title: 'Contract notes', text: 'Contract_Notes' }, { title: 'Renewal notes', text: 'Renewal_Notes' }],
      tabs: [
        { id: 'docs', label: 'Documents', entity: 'Contract_Documents', lookup: 'Contract', select: ['File_Name', 'Doc_Type', 'Parse_Status', 'Pages', 'Effective_Date'], order: 'Effective_Date desc', cols: [{ k: 'File_Name', label: 'File', main: 1 }, { k: 'Doc_Type', label: 'Type' }, { k: 'Parse_Status', label: 'Parse', pill: 1 }, { k: 'Pages', label: 'Pages', t: 'num', r: 1 }, { k: 'Effective_Date', label: 'Effective', t: 'date' }] },
        { id: 'clauses', label: 'Clauses', entity: 'Contract_Clauses', lookup: 'Contract', select: ['Title', 'Clause_Type', 'Status', 'Due_Date', 'Cadence'], order: 'Due_Date asc', cols: [{ k: 'Title', label: 'Clause', main: 1 }, { k: 'Clause_Type', label: 'Type' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Due_Date', label: 'Due', t: 'date' }, { k: 'Cadence', label: 'Cadence' }] }]
    }
  };

  M.onboarding = {
    key: 'onboarding', label: 'Customer Onboarding', entity: 'Customer_Onboarding', title: 'Customer Onboarding', create: true,
    list: {
      select: ['Name', 'Account', 'Status', 'Phase', 'Risk', 'Days_to_Go_live', 'Overdue_Tasks', 'Open_Gate_Tasks'],
      order: 'Go_live_Target asc', searchField: 'Name', searchHint: 'Search onboardings',
      cols: [{ k: 'Name', label: 'Onboarding', main: 1 }, { k: 'Account', label: 'Account' }, { k: 'Status', label: 'Status', ed: 'pick', opts: ['Not started', 'In progress', 'Blocked', 'Complete'] }, { k: 'Phase', label: 'Phase' }, { k: 'Risk', label: 'Risk', ed: 'pick', opts: ['Low', 'Medium', 'High'] }, { k: 'Days_to_Go_live', label: 'Days to go-live', t: 'num', r: 1 }, { k: 'Overdue_Tasks', label: 'Overdue', t: 'num', r: 1 }],
      filters: [{ key: 'all', label: 'All' }, { key: 'overdue', label: 'Has overdue tasks', where: 'Overdue_Tasks > 0' }, { key: 'blocked', label: 'Blocked', where: 'Blocked_Reason is not null' }]
    },
    rec: {
      select: ['Name', 'Account', 'Deal', 'Contract', 'Status', 'Phase', 'Risk', 'Blocked_Reason', 'Days_to_Go_live', 'Go_live_Target', 'Go_live_Actual', 'Kickoff_Date', 'Overdue_Tasks', 'Open_Gate_Tasks', 'Last_Step_Completed_On', 'Expected_GPS', 'Expected_RB', 'Expected_RF', 'Expected_TAD', 'Template_Key', 'Plan_Anchored_Go_live'],
      quick: [{ k: 'Status', label: 'Status', t: 'pick', opts: ['Not started', 'In progress', 'Blocked', 'Complete'] }, { k: 'Risk', label: 'Risk', t: 'pick', opts: ['Low', 'Medium', 'High'] }, { k: 'Go_live_Target', label: 'Go-live target', t: 'date' }, { k: 'Blocked_Reason', label: 'Blocked reason', t: 'text' }],
      title: function (r) { return P(r.Name); },
      kicker: function (r) { return 'Onboarding' + (r.Phase ? ' · ' + P(r.Phase) : ''); },
      sub: function (r) { return [P(r.Account), P(r.Deal)].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Status ? [P(r.Status), R.tone(r.Status)] : null; },
      kpis: [
        { label: 'Days to go-live', v: function (r) { return r.Days_to_Go_live; }, t: 'num', tone: function (r) { return dtone(r.Days_to_Go_live, 21, 7); } },
        { label: 'Overdue tasks', v: function (r) { return r.Overdue_Tasks; }, t: 'num', tone: function (r) { return +r.Overdue_Tasks > 0 ? 'bad' : 'good'; } },
        { label: 'Open gate tasks', v: function (r) { return r.Open_Gate_Tasks; }, t: 'num' },
        { label: 'Risk', v: function (r) { return r.Risk; }, tone: function (r) { return R.tone(r.Risk); } },
        { label: 'Go-live target', v: function (r) { return r.Go_live_Target; }, t: 'date' }],
      attn: function (r) { return r.Blocked_Reason ? 'Blocked: ' + r.Blocked_Reason : null; },
      cards: [
        { title: 'Dates', rows: [['Kickoff', 'Kickoff_Date', 'date'], ['Go-live target', 'Go_live_Target', 'date'], ['Plan-anchored go-live', 'Plan_Anchored_Go_live', 'date'], ['Go-live actual', 'Go_live_Actual', 'date'], ['Last step completed', 'Last_Step_Completed_On', 'date']] },
        { title: 'Scope', rows: [['Contract', 'Contract'], ['Template', 'Template_Key'], ['Expected GPS', 'Expected_GPS', 'num'], ['Expected RB', 'Expected_RB', 'num'], ['Expected RF', 'Expected_RF', 'num'], ['Expected TAD', 'Expected_TAD', 'num']] }],
      tabs: [{ id: 'tasks', label: 'Tasks', entity: 'Tasks', lookup: 'What_Id', select: ['Subject', 'Status', 'Due_Date', 'Onboarding_Phase', OWN], order: 'Due_Date asc', cols: [{ k: 'Subject', label: 'Task', main: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Due_Date', label: 'Due', t: 'date' }, { k: 'Onboarding_Phase', label: 'Phase' }, { k: OWN, label: 'Owner' }] }]
    }
  };

  M.solicitations = {
    key: 'solicitations', label: 'Solicitations', entity: 'Solicitations', title: 'Solicitations', create: true,
    list: {
      select: ['Name', 'Solicitation_Number', 'Issuing_Agency', 'Status', 'Proposal_Due', 'Days_To_Deadline', 'Best_Score', 'Best_Recommendation', 'Unmet_Mandatory_Count'],
      order: 'Proposal_Due asc', searchField: 'Name', searchHint: 'Search solicitations',
      cols: [{ k: 'Name', label: 'Solicitation', main: 1 }, { k: 'Issuing_Agency', label: 'Agency' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Proposal_Due', label: 'Due', t: 'date' }, { k: 'Days_To_Deadline', label: 'Days left', t: 'num', r: 1 }, { k: 'Best_Score', label: 'Best score', t: 'num', r: 1 }, { k: 'Best_Recommendation', label: 'Recommendation', pill: 1 }],
      filters: [{ key: 'all', label: 'All' }, { key: 'due', label: 'Due soon', where: 'Days_To_Deadline between 0 and 30' }, { key: 'ident', label: 'Identified', where: "Status = 'Identified'" }, { key: 'unmet', label: 'Unmet mandatory', where: 'Unmet_Mandatory_Count > 0' }]
    },
    rec: {
      select: ['Name', 'Solicitation_Number', 'Issuing_Agency', 'Status', 'Proposal_Due', 'Days_To_Deadline', 'Next_Milestone', 'Next_Milestone_Date', 'Best_Score', 'Best_Recommendation', 'Best_Scenario', 'Unmet_Mandatory_Count', 'Mandatory_Count', 'Scenario_Count', 'Bid_Decision', 'Stated_Budget', 'Pricing_Model', 'Contract_Term', 'Incumbent', 'Incumbent_Tenure_Years', 'Known_Competitors', 'Evaluation_Criteria', 'Outcome', 'Date_Received', 'Questions_Round_1_Due', 'Questions_Round_2_Due', 'Anticipated_Award', 'Service_Lines', 'Bond_Required', 'Cooperative_Vehicle', 'Resulting_Contract'],
      title: function (r) { return P(r.Name); },
      kicker: function (r) { return 'Solicitation' + (r.Solicitation_Number ? ' · ' + r.Solicitation_Number : ''); },
      sub: function (r) { return [P(r.Issuing_Agency), r.Bid_Decision ? 'Decision: ' + P(r.Bid_Decision) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Status ? [P(r.Status), R.tone(r.Status)] : null; },
      kpis: [
        { label: 'Days to deadline', v: function (r) { return r.Days_To_Deadline; }, t: 'num', tone: function (r) { return dtone(r.Days_To_Deadline, 14, 5); } },
        { label: 'Proposal due', v: function (r) { return r.Proposal_Due; }, t: 'date' },
        { label: 'Best score', v: function (r) { return r.Best_Score; }, t: 'num' },
        { label: 'Unmet mandatory', v: function (r) { return r.Unmet_Mandatory_Count; }, t: 'num', tone: function (r) { return +r.Unmet_Mandatory_Count > 0 ? 'bad' : 'good'; } },
        { label: 'Scenarios', v: function (r) { return r.Scenario_Count; }, t: 'num' }],
      attn: function (r) { return +r.Unmet_Mandatory_Count > 0 ? r.Unmet_Mandatory_Count + ' mandatory requirement(s) unmet' : null; },
      cards: [
        { title: 'Timeline', rows: [['Received', 'Date_Received', 'date'], ['Questions round 1 due', 'Questions_Round_1_Due', 'date'], ['Questions round 2 due', 'Questions_Round_2_Due', 'date'], ['Next milestone', 'Next_Milestone'], ['Next milestone date', 'Next_Milestone_Date', 'date'], ['Anticipated award', 'Anticipated_Award', 'date']] },
        { title: 'Commercial', rows: [['Stated budget', 'Stated_Budget', 'money'], ['Pricing model', 'Pricing_Model'], ['Contract term', 'Contract_Term'], ['Service lines', 'Service_Lines'], ['Bond required', 'Bond_Required', 'bool'], ['Cooperative vehicle', 'Cooperative_Vehicle']] },
        { title: 'Competition', rows: [['Incumbent', 'Incumbent'], ['Incumbent tenure (yrs)', 'Incumbent_Tenure_Years', 'num'], ['Known competitors', 'Known_Competitors'], ['Best scenario', 'Best_Scenario'], ['Outcome', 'Outcome'], ['Resulting contract', 'Resulting_Contract']] },
        { title: 'Evaluation criteria', text: 'Evaluation_Criteria' }],
      tabs: [
        { id: 'scen', label: 'Bid scenarios', entity: 'Bid_Scenarios', lookup: 'Solicitation', select: ['Name', 'Scenario_Type', 'Weighted_Score', 'Recommendation', 'Scenario_Status'], order: 'Weighted_Score desc', cols: [{ k: 'Name', label: 'Scenario', main: 1 }, { k: 'Scenario_Type', label: 'Type' }, { k: 'Weighted_Score', label: 'Weighted score', t: 'num', r: 1 }, { k: 'Recommendation', label: 'Recommendation', pill: 1 }, { k: 'Scenario_Status', label: 'Status', pill: 1 }], open: 'Bid_Scenarios' },
        { id: 'reqs', label: 'Requirements', entity: 'Solicitation_Requirements', lookup: 'Solicitation', select: ['Requirement_Text', 'Mandatory', 'Priority', 'Our_Position'], cols: [{ k: 'Requirement_Text', label: 'Requirement', main: 1 }, { k: 'Mandatory', label: 'Mandatory', t: 'bool' }, { k: 'Priority', label: 'Priority', pill: 1 }, { k: 'Our_Position', label: 'Our position', pill: 1 }] }]
    }
  };

  M.vendors = {
    key: 'vendors', label: 'Vendors', entity: 'Vendors', title: 'Vendors', create: true,
    list: {
      select: ['Vendor_Name', 'Relationship_Status', 'Main_Point_of_Contact', 'EM_Units_Current', 'Last_Vendor_Review', 'Support_Hours', OWN],
      order: 'Vendor_Name asc', searchField: 'Vendor_Name', searchHint: 'Search vendors',
      cols: [{ k: 'Vendor_Name', label: 'Vendor', main: 1 }, { k: 'Relationship_Status', label: 'Relationship', pill: 1 }, { k: 'Main_Point_of_Contact', label: 'Main contact' }, { k: 'EM_Units_Current', label: 'EM units', t: 'num', r: 1 }, { k: 'Last_Vendor_Review', label: 'Last review', t: 'date' }, { k: 'Support_Hours', label: 'Support hours' }, { k: OWN, label: 'Owner' }],
      filters: [{ key: 'all', label: 'All' }]
    },
    rec: {
      select: ['Vendor_Name', 'Relationship_Status', 'Main_Point_of_Contact', 'Owner.first_name', 'EM_Units_Current', 'Last_Vendor_Review', 'Time_since_last_contact_verification', 'Support_Hours', 'Support_Email_RMA', 'After_hours_number', 'Customer_Portal', 'Website', 'Equipment_Used', 'Accessory_Order_Method', 'Accessory_Order_Email', 'Device_Order_Method', 'Device_Order_Email', 'Device_Order_Contact'],
      title: function (r) { return P(r.Vendor_Name); },
      kicker: function () { return 'Vendor'; },
      sub: function (r) { return [r['Main_Point_of_Contact'] ? 'Main contact ' + P(r.Main_Point_of_Contact) : '', r[OWN] ? 'Owner ' + P(r[OWN]) : ''].filter(Boolean).join(' · '); },
      pill: function (r) { return r.Relationship_Status ? [P(r.Relationship_Status), R.tone(r.Relationship_Status)] : null; },
      kpis: [
        { label: 'EM units', v: function (r) { return r.EM_Units_Current; }, t: 'num' },
        { label: 'Last review', v: function (r) { return r.Last_Vendor_Review; }, t: 'date' },
        { label: 'Contact verified', v: function (r) { return r.Time_since_last_contact_verification; } },
        { label: 'Support hours', v: function (r) { return r.Support_Hours; } }],
      cards: [
        { title: 'Support', rows: [['Support hours', 'Support_Hours'], ['RMA email', 'Support_Email_RMA'], ['After-hours number', 'After_hours_number'], ['Customer portal', 'Customer_Portal'], ['Website', 'Website']] },
        { title: 'Ordering', rows: [['Equipment used', 'Equipment_Used'], ['Device order method', 'Device_Order_Method'], ['Device order email', 'Device_Order_Email'], ['Device order contact', 'Device_Order_Contact'], ['Accessory order method', 'Accessory_Order_Method'], ['Accessory order email', 'Accessory_Order_Email']] }],
      tabs: [{ id: 'contracts', label: 'Contracts', entity: 'Contracts', lookup: 'Vendor', select: ['Name', 'Contract_Status', 'Contract_End_Date', 'Days_to_Final_End'], order: 'Contract_End_Date asc', cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Contract_End_Date', label: 'Ends', t: 'date' }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }] }]
    }
  };

  M.billing = {
    key: 'billing', label: 'Billing Periods', entity: 'Billing_Periods', title: 'Billing Periods', create: false,
    list: {
      select: ['Name', 'Period', 'Period_Status', 'Invoiced', 'Verified', 'Overbilled', 'Findings_Open', 'Needs_Decision'],
      order: 'Period desc', searchField: 'Name', searchHint: 'Search periods',
      cols: [{ k: 'Name', label: 'Period', main: 1 }, { k: 'Period_Status', label: 'Status', pill: 1 }, { k: 'Invoiced', label: 'Invoiced', t: 'money', r: 1 }, { k: 'Verified', label: 'Verified', t: 'money', r: 1 }, { k: 'Overbilled', label: 'Overbilled', t: 'money', r: 1 }, { k: 'Findings_Open', label: 'Open findings', t: 'num', r: 1 }, { k: 'Needs_Decision', label: 'Needs decision', t: 'num', r: 1 }],
      filters: [{ key: 'all', label: 'All' }, { key: 'rev', label: 'In review', where: "Period_Status = 'In Review'" }]
    },
    rec: {
      select: ['Name', 'Period', 'Period_Status', 'Invoiced', 'Verified', 'Overbilled', 'Latent_Exposure', 'Recommended_Pay', 'Findings_Total', 'Findings_Open', 'Needs_Decision', 'Unverified', 'Last_Run_At', 'Last_Run_Status', 'Reconciled_By', 'Accounting_Report_Version', 'Period_Summary', 'Recommendation'],
      title: function (r) { return P(r.Name); },
      kicker: function () { return 'Billing period'; },
      sub: function (r) { return r.Reconciled_By ? 'Reconciled by ' + P(r.Reconciled_By) : ''; },
      pill: function (r) { return r.Period_Status ? [P(r.Period_Status), R.tone(r.Period_Status)] : null; },
      kpis: [
        { label: 'Invoiced', v: function (r) { return r.Invoiced; }, t: 'money' },
        { label: 'Verified', v: function (r) { return r.Verified; }, t: 'money', tone: function () { return 'good'; } },
        { label: 'Overbilled', v: function (r) { return r.Overbilled; }, t: 'money', tone: function (r) { return +r.Overbilled > 0 ? 'bad' : 'good'; } },
        { label: 'Latent exposure', v: function (r) { return r.Latent_Exposure; }, t: 'money', tone: function (r) { return +r.Latent_Exposure > 0 ? 'warn' : 'good'; } },
        { label: 'Recommended pay', v: function (r) { return r.Recommended_Pay; }, t: 'money' },
        { label: 'Open findings', v: function (r) { return r.Findings_Open; }, t: 'num', tone: function (r) { return +r.Findings_Open > 0 ? 'warn' : 'good'; } }],
      cards: [
        { title: 'Reconciliation', rows: [['Findings total', 'Findings_Total', 'num'], ['Needs decision', 'Needs_Decision', 'num'], ['Unverified', 'Unverified', 'num'], ['Last run', 'Last_Run_At', 'date'], ['Last run status', 'Last_Run_Status'], ['Accounting report version', 'Accounting_Report_Version']] },
        { title: 'Period summary', text: 'Period_Summary' }, { title: 'Recommendation', text: 'Recommendation' }],
      tabs: [{ id: 'finds', label: 'Open findings', entity: 'Billing_Findings', lookup: 'Billing_Period', where: 'Is_Open = true', select: ['Subject', 'Category', 'Severity', 'Dollars', 'Status', 'Recommended_Action'], order: 'Dollars desc', cols: [{ k: 'Subject', label: 'Finding', main: 1 }, { k: 'Category', label: 'Category' }, { k: 'Severity', label: 'Severity', pill: 1 }, { k: 'Dollars', label: 'Dollars', t: 'money', r: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Recommended_Action', label: 'Recommended' }] }]
    }
  };

  return M;
});
