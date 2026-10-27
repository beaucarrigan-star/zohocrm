/* Demo scenarios: one per rule row. Dates are relative to "today" so the card always reads right. Only used with ?demo=1 or outside Zoho. */
(function (root) {
  function iso(n) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var contact = { id: '9001', name: 'Pat Lee' };
  function C(label, o) { return { label: label, module: 'Contracts', contact: contact, rec: Object.assign({ id: '1001', Name: 'Rock Co Pretrial Program', Counterparty_Type: 'Customer', Renewal_Status: 'Not started', Final_End_Date: iso(44), Blocked: false }, o) }; }
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
    A('Account: no type', { Account_Type: null })
  ];
})(window);
