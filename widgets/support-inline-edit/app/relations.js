/* relations.js: the related lists shown under each module's record page, mirroring the CRM layout's related lists.
   kinds: coql (query a child module by its lookup to the parent), notes, attach, acts (tasks+meetings+calls), emails,
          sdk (generic related-records API, used for multi-select lookups and system lists), widget (custom CRM widget; cannot be embedded). */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.RecRelations = f(); })(this, function () {
  'use strict';
  var OWN = 'Owner.first_name';
  var STD = {   /* hand-tuned columns for the core modules */
    Contacts: { select: ['Full_Name', 'Title', 'Email', 'Mobile', 'Last_Activity_Time'], order: 'Full_Name asc', cols: [{ k: 'Full_Name', label: 'Name', main: 1 }, { k: 'Title', label: 'Title' }, { k: 'Email', label: 'Email' }, { k: 'Mobile', label: 'Mobile' }, { k: 'Last_Activity_Time', label: 'Last activity', t: 'date' }] },
    Deals: { select: ['Deal_Name', 'Stage', 'Closing_Date', 'Total_Opportunity_Revenue', OWN], order: 'Closing_Date desc', cols: [{ k: 'Deal_Name', label: 'Opportunity', main: 1 }, { k: 'Stage', label: 'Stage', pill: 1 }, { k: 'Closing_Date', label: 'Close', t: 'date' }, { k: 'Total_Opportunity_Revenue', label: 'Revenue', t: 'money', r: 1 }, { k: OWN, label: 'Owner' }] },
    Cases: { select: ['Subject', 'Status', 'Priority', 'Case_Age_days', OWN], order: 'Created_Time desc', cols: [{ k: 'Subject', label: 'Subject', main: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Priority', label: 'Priority', pill: 1 }, { k: 'Case_Age_days', label: 'Age (days)', t: 'num', r: 1 }, { k: OWN, label: 'Owner' }] },
    Contracts: { select: ['Name', 'Contract_Status', 'Contract_End_Date', 'Days_to_Final_End', 'Renewal_Band'], order: 'Contract_End_Date asc', cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Contract_End_Date', label: 'Ends', t: 'date' }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }, { k: 'Renewal_Band', label: 'Band', pill: 1 }] },
    Customer_Onboarding: { select: ['Name', 'Status', 'Phase', 'Risk', 'Go_live_Target'], order: 'Go_live_Target asc', cols: [{ k: 'Name', label: 'Onboarding', main: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Phase', label: 'Phase' }, { k: 'Risk', label: 'Risk', pill: 1 }, { k: 'Go_live_Target', label: 'Go-live target', t: 'date' }] },
    Solicitations: { select: ['Name', 'Issuing_Agency', 'Status', 'Proposal_Due', 'Best_Score'], order: 'Proposal_Due desc', cols: [{ k: 'Name', label: 'Solicitation', main: 1 }, { k: 'Issuing_Agency', label: 'Agency' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Proposal_Due', label: 'Due', t: 'date' }, { k: 'Best_Score', label: 'Best score', t: 'num', r: 1 }] },
    Accounts: { select: ['Account_Name', 'Account_Type', 'Customer_Health', 'Renewal_Date'], order: 'Account_Name asc', cols: [{ k: 'Account_Name', label: 'Account', main: 1 }, { k: 'Account_Type', label: 'Type' }, { k: 'Customer_Health', label: 'Health', pill: 1 }, { k: 'Renewal_Date', label: 'Renewal', t: 'date' }] },
    Vendors: { select: ['Vendor_Name', 'Relationship_Status', 'Main_Point_of_Contact', 'Support_Hours'], order: 'Vendor_Name asc', cols: [{ k: 'Vendor_Name', label: 'Vendor', main: 1 }, { k: 'Relationship_Status', label: 'Relationship', pill: 1 }, { k: 'Main_Point_of_Contact', label: 'Main contact' }, { k: 'Support_Hours', label: 'Support hours' }] },
    Contract_Documents: { select: ['File_Name', 'Doc_Type', 'Parse_Status', 'Pages', 'Effective_Date'], order: 'Effective_Date desc', cols: [{ k: 'File_Name', label: 'File', main: 1 }, { k: 'Doc_Type', label: 'Type' }, { k: 'Parse_Status', label: 'Parse', pill: 1 }, { k: 'Pages', label: 'Pages', t: 'num', r: 1 }, { k: 'Effective_Date', label: 'Effective', t: 'date' }] },
    Contract_Clauses: { select: ['Title', 'Clause_Type', 'Status', 'Due_Date', 'Cadence'], order: 'Due_Date asc', cols: [{ k: 'Title', label: 'Clause', main: 1 }, { k: 'Clause_Type', label: 'Type' }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Due_Date', label: 'Due', t: 'date' }, { k: 'Cadence', label: 'Cadence' }] },
    Bid_Scenarios: { select: ['Name', 'Scenario_Type', 'Weighted_Score', 'Recommendation', 'Scenario_Status'], order: 'Weighted_Score desc', cols: [{ k: 'Name', label: 'Scenario', main: 1 }, { k: 'Scenario_Type', label: 'Type' }, { k: 'Weighted_Score', label: 'Weighted score', t: 'num', r: 1 }, { k: 'Recommendation', label: 'Recommendation', pill: 1 }, { k: 'Scenario_Status', label: 'Status', pill: 1 }] },
    Solicitation_Requirements: { select: ['Requirement_Text', 'Mandatory', 'Priority', 'Our_Position'], order: 'Created_Time desc', cols: [{ k: 'Requirement_Text', label: 'Requirement', main: 1 }, { k: 'Mandatory', label: 'Mandatory', t: 'bool' }, { k: 'Priority', label: 'Priority', pill: 1 }, { k: 'Our_Position', label: 'Our position', pill: 1 }] },
    Billing_Findings: { select: ['Subject', 'Category', 'Severity', 'Dollars', 'Status', 'Recommended_Action'], order: 'Dollars desc', cols: [{ k: 'Subject', label: 'Finding', main: 1 }, { k: 'Category', label: 'Category' }, { k: 'Severity', label: 'Severity', pill: 1 }, { k: 'Dollars', label: 'Dollars', t: 'money', r: 1 }, { k: 'Status', label: 'Status', pill: 1 }, { k: 'Recommended_Action', label: 'Recommended' }] },
    Support_Emails: null
  };
  /* c(): child module related by a lookup field. */
  function c(id, label, entity, lookup, extra) { var o = { kind: 'coql', id: id, label: label, entity: entity, lookup: lookup }; for (var k in (extra || {})) o[k] = extra[k]; return o; }
  function sdk(id, label, list) { return { kind: 'sdk', id: id, label: label, list: list }; }
  var NOTES = { kind: 'notes', id: 'notes', label: 'Notes' }, ATT = { kind: 'attach', id: 'att', label: 'Attachments' }, EM = { kind: 'emails', id: 'emails', label: 'Emails' };
  function ACT(who) { return { kind: 'acts', id: 'acts', label: 'Activities', who: who || 'What_Id' }; }
  function W(label, note) { return { kind: 'widget', id: 'w-' + label.toLowerCase().replace(/\W+/g, ''), label: label, note: note }; }

  var REL = {
    Accounts: [NOTES, c('contacts', 'Contacts', 'Contacts', 'Account_Name'), c('contracts', 'Contracts', 'Contracts', 'Account'), sdk('alsocov', 'Also covers this account', 'Contracts16'),
      c('cases', 'Cases', 'Cases', 'Account_Name'), c('deals', 'Opportunities', 'Deals', 'Account_Name'), EM, c('supem', 'Support emails', 'Support_Emails', 'Account'),
      c('onb', 'Customer onboarding', 'Customer_Onboarding', 'Account'), ATT, c('members', 'Member accounts', 'Accounts', 'Parent_Account'), sdk('vendors', 'Vendors', 'Vendors14'), ACT(),
      W('Accessory orders', 'A custom CRM widget; it opens inside the CRM record page.'), c('confleads', 'Contacts (organization/agency)', 'Contacts', 'Organization_Agency'),
      c('duc', 'Daily unit counts', 'Daily_Unit_Counts', 'Account'), c('stock', 'EM stock alerts', 'EM_Stock_Alerts', 'Account'), c('sol', 'Solicitations', 'Solicitations', 'Issuing_Agency'),
      c('margin', 'EM margin', 'EM_Margin', 'Account'), c('comp', 'Competitor profiles', 'Competitor_Profiles', 'Account'), c('reorder', 'EM reorder rules', 'EM_Reorder_Rules', 'Account'),
      c('pricing', 'Pricing scenarios', 'Pricing_Scenarios', 'Account'), c('clauses', 'Contract clauses', 'Contract_Clauses', 'Account'), c('collect', 'Collection requests', 'Collection_Requests', 'Account'),
      c('ship', 'Accessory shipments', 'Accessory_Shipments', 'Account'), c('recs', 'Accessory recs', 'Accessory_Order_Recommendations', 'Account'),
      c('saa', 'Stock and accessory actions', 'Stock_Accessory_Actions', 'Account'), c('vorders', 'Vendor orders', 'Vendor_Orders', 'Account'), c('returns', 'Device returns', 'Device_Returns', 'Account'),
      c('deliv', 'Deliverables', 'Deliverables', 'Account'), c('compl', 'Compliance items', 'Compliance_Items', 'Account')],
    Deals: [NOTES, ATT, sdk('stagehist', 'Stage history', 'Stage_History'), ACT(), sdk('products', 'Products', 'Products'), sdk('roles', 'Contact roles', 'Contact_Roles'), sdk('cases', 'Cases', 'Cases'), EM,
      c('onb', 'Onboarding', 'Customer_Onboarding', 'Deal'), c('sol', 'Solicitations', 'Solicitations', 'Deal'), c('pricing', 'Pricing scenarios', 'Pricing_Scenarios', 'Opportunity')],
    Cases: [NOTES, c('supem', 'Support emails', 'Support_Emails', 'Case'), ATT, ACT(), EM, W('Zoho TeamInbox', 'Third-party CRM widget; open the record in CRM to use it.'),
      c('solutions', 'Solutions', 'Solutions', 'Source_Case'), c('vorders', 'Vendor orders', 'Vendor_Orders', 'Case'), c('returns', 'Device returns', 'Device_Returns', 'Case')],
    Contacts: [NOTES, ATT, ACT('Who_Id'), sdk('deals', 'Opportunities', 'Deals'), EM, c('onb', 'Customer onboarding', 'Customer_Onboarding', 'Customer_name'), c('cases', 'Cases', 'Cases', 'Related_To'),
      W('Zoho TeamInbox', 'Third-party CRM widget; open the record in CRM to use it.'), sdk('prod', 'Products', 'Contact_Name'), c('vendors', 'Vendors (support point of contact)', 'Vendors', 'Main_Point_of_Contact'),
      c('supem', 'Support emails', 'Support_Emails', 'Contact'), c('collect', 'Collection requests', 'Collection_Requests', 'Contact'), c('docreq', 'DOC requests', 'Cases', 'Requesting_Agent'),
      c('jobs', 'Installer jobs', 'Cases', 'Assigned_Installer'), c('cover', 'Installer coverage', 'Dispatch_Coverage', 'Installer'), c('presence', 'Installer presence', 'Installer_Presence', 'Installer')],
    Contracts: [NOTES, ATT, EM, ACT(), sdk('checklists', 'Checklists', 'CheckLists'), c('sol', 'Solicitations (resulting contract)', 'Solicitations', 'Resulting_Contract'), c('margin', 'EM margin', 'EM_Margin', 'Contract'),
      c('rates', 'Vendor rates', 'Vendor_Rates', 'Contract'), c('resol', 'Re-solicitations (incumbent)', 'Solicitations', 'Incumbent_Contract'), c('docs', 'Contract documents', 'Contract_Documents', 'Contract'),
      c('clauses', 'Contract clauses', 'Contract_Clauses', 'Contract'), c('onb', 'Onboardings', 'Customer_Onboarding', 'Contract'), sdk('accts', 'Accounts covered', 'Accounts6'),
      W('Contract band', 'A custom CRM widget; it opens inside the CRM record page.'), c('deliv', 'Deliverables', 'Deliverables', 'Contract'), c('compl', 'Compliance items', 'Compliance_Items', 'Contract'),
      c('metrics', 'Program metrics', 'Program_Metrics', 'Contract')],
    Customer_Onboarding: [NOTES, ATT, EM, ACT(), sdk('checklists', 'Checklists', 'CheckLists'), W('Zoho Survey', 'Surveys are managed in CRM; open the record in CRM to use them.')],
    Solicitations: [NOTES, ATT, EM, ACT(), sdk('checklists', 'Checklists', 'CheckLists'), c('scen', 'Bid scenarios', 'Bid_Scenarios', 'Solicitation'), c('scores', 'All scores', 'Scenario_Scores', 'Solicitation'),
      c('reqs', 'Requirements', 'Solicitation_Requirements', 'Solicitation'), c('spec', 'Spec assessments', 'Spec_Assessments', 'Solicitation'), sdk('comp', 'Competitor profiles', 'Competitor_Profiles18')],
    Vendors: [NOTES, ATT, sdk('products', 'Products', 'Products'), c('contacts', 'Contacts', 'Contacts', 'Vendor_Name'), ACT(), EM, c('issues', 'Issue resolution', 'Issue_Resolution', 'Vendor'),
      c('cases', 'Cases', 'Cases', 'Vendor'), c('contracts', 'Contracts', 'Contracts', 'Vendor'), c('spec', 'Spec assessments', 'Spec_Assessments', 'Vendor'),
      c('recs', 'Order recommendations', 'Accessory_Order_Recommendations', 'Order_Vendor'), c('vorders', 'Vendor orders', 'Vendor_Orders', 'Vendor'), c('returns', 'Device returns', 'Device_Returns', 'Vendor'),
      c('margin', 'EM margin', 'EM_Margin', 'Vendor'), c('comp', 'Competitor profiles', 'Competitor_Profiles', 'Vendor'), sdk('accts', 'Accounts', 'Accounts4'), sdk('scenv', 'Bid scenarios', 'Bid_Scenarios15')],
    Billing_Periods: [NOTES, ATT, EM, ACT(), c('runs', 'Billing runs', 'Billing_Runs', 'Billing_Period'), c('findings', 'Findings', 'Billing_Findings', 'Billing_Period'), sdk('checklists', 'Checklists', 'CheckLists')]
  };
  /* Where a coql relation is a plain core module, reuse the hand-tuned columns; otherwise the generated ones (relmods.js). */
  function resolve(r, gen) {
    if (r.kind !== 'coql') return r;
    var spec = STD[r.entity] || (gen || {})[r.entity];
    var o = {}; for (var k in r) o[k] = r[k];
    if (spec) { o.select = spec.select; o.cols = spec.cols; o.order = o.order || spec.order; }
    return o;
  }
  function forModule(entity, gen) { return (REL[entity] || []).map(function (r) { return resolve(r, gen); }); }
  return { REL: REL, STD: STD, forModule: forModule, resolve: resolve };
});
