/* Demo data for the Relationships flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional accounts. Rows use the live API shapes. */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now + n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now + n * D).toISOString(); }
    var ref = function (id, name) { return { id: id, name: name }; };
    var owner = ref('u1', 'Beau Carrigan');
    function acc(id, name, o) { return Object.assign({ id: id, Account_Name: name, Account_Type: 'Customer', Owner: owner, Touch_Status: 'Fresh', Last_Touch: day(-10), Renewal_Date: day(200), Renewal_Amount: 24000, Health_Tier: null, Customer_Health: 'Healthy', Former_Customer: false }, o || {}); }
    function con(id, name, a, o) { return Object.assign({ id: id, Full_Name: name, Title: 'Director', Email: name.toLowerCase().replace(/ /g, '.') + '@example.org', Account_Name: a ? ref(a, 'x') : null, Stock_Alert_Recipient: false, Last_Activity_Time: iso(-12), Owner: owner }, o || {}); }
    function deal(id, name, a, o) { return Object.assign({ id: id, Deal_Name: name, Account_Name: a ? ref(a, 'x') : null, Contact_Name: ref('c1', 'Pat Lee'), Stage: 'Discovery', Closing_Date: day(40), Next_Step: 'Send proposal', Last_Activity_Time: iso(-5), Amount: 30000, Pipeline: 'JusticePoint EM', Owner: owner }, o || {}); }
    var accounts = [
      acc('a1', 'Riverbend County Pretrial', { Renewal_Date: day(25) }),
      acc('a2', 'Lakeshore HHS', { Touch_Status: 'Cold', Last_Touch: day(-95), Renewal_Date: day(60), Health_Tier: 'Red', Customer_Health: 'At Risk' }),
      acc('a3', 'Northfield Sheriff', { Renewal_Date: day(-12) }),
      acc('a4', 'Cedar Valley Juvenile'),
      acc('a5', 'Pine Ridge Probation', { Touch_Status: null, Last_Touch: null, Renewal_Date: null }),
      acc('a6', 'Harbor Court', { Account_Type: 'Prospect', Last_Touch: day(-75), Touch_Status: 'Cold', Renewal_Date: null, Renewal_Amount: null }),
      acc('a7', 'Stone County Sheriff', { Account_Type: 'Prospect', Touch_Status: 'Fresh', Last_Touch: day(-6), Renewal_Date: null, Renewal_Amount: null }),
      acc('a8', 'Oak Hollow Agency', { Account_Type: null, Touch_Status: null, Last_Touch: null, Renewal_Date: null, Renewal_Amount: null }),
      acc('a9', 'Conference Group', { Account_Type: 'Association - Conferences', Renewal_Date: null }),
      acc('a10', 'Old Mill County', { Former_Customer: true, Renewal_Date: null }),
      acc('a11', 'Bay Metro Corrections', { Renewal_Date: day(18), Renewal_Amount: 61000 })
    ];
    var contacts = [
      con('c1', 'Pat Lee', 'a1', { Stock_Alert_Recipient: true }), con('c2', 'Sam Ortiz', 'a2'), con('c3', 'Kim Dao', 'a3', { Stock_Alert_Recipient: true }),
      con('c4', 'Lee Wong', 'a4', { Email: '' }), con('c5', 'Ana Ruiz', 'a6'), con('c6', 'Jo Park', 'a7'), con('c7', 'Rae Cole', 'a11', { Stock_Alert_Recipient: true }),
      con('c8', 'Dee Hart', null), con('c9', 'Max Poe', null, { Email: '' }), con('c10', 'Ian Fox', 'a9')
    ];
    var deals = [
      deal('d1', 'Riverbend renewal', 'a1', { Stage: 'Negotiation/Review', Closing_Date: day(20) }),
      deal('d2', 'Northfield expansion', 'a3', { Stage: 'Proposal/Price Quote', Closing_Date: day(-30), Last_Activity_Time: iso(-50) }),
      deal('d3', 'Harbor Court pilot', 'a6', { Stage: 'Discovery', Next_Step: '', Contact_Name: null }),
      deal('d4', 'Stone County program', 'a7', { Stage: 'Prospecting', Last_Activity_Time: iso(-45) }),
      deal('d5', 'Marquette Admin', null, { Stage: 'Discovery' }),
      deal('d6', 'Cedar Valley add-on', 'a4', { Stage: 'Closed Won', Closing_Date: day(-20) }),
      deal('d7', 'Old Mill return', 'a10', { Stage: 'Closed Lost', Closing_Date: day(-90) })
    ];
    return { accounts: accounts, contacts: contacts, deals: deals };
  }
  window.RelFlowDemo = { make: make };
})();
