/* Demo data for the Relationships flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional accounts. Rows use the live API shapes.
   The demo viewer is user u1 (Beau Carrigan); a few accounts belong to u2 so "Mine" and "Everyone" differ. */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now + n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now + n * D).toISOString(); }
    var ref = function (id, name) { return { id: id, name: name }; };
    var beau = ref('u1', 'Beau Carrigan'), alex = ref('u2', 'Alex Morgan');
    function acc(id, name, o) { return Object.assign({ id: id, Account_Name: name, Account_Type: 'Customer', Owner: beau, Touch_Status: null, Last_Touch: null, Health_Tier: null, Customer_Health: 'Healthy', Former_Customer: false }, o || {}); }
    function con(id, name, a, o) { return Object.assign({ id: id, Full_Name: name, Title: 'Director', Email: name.toLowerCase().replace(/ /g, '.') + '@example.org', Account_Name: a ? ref(a, 'x') : null, Stock_Alert_Recipient: false, Last_Activity_Time: iso(-12), Owner: beau }, o || {}); }
    function deal(id, name, a, o) { return Object.assign({ id: id, Deal_Name: name, Account_Name: a ? ref(a, 'x') : null, Contact_Name: ref('c1', 'Pat Lee'), Stage: 'Discovery', Closing_Date: day(40), Next_Step: 'Send proposal', Last_Activity_Time: iso(-5), Amount: 30000, Pipeline: 'JusticePoint EM', Owner: beau }, o || {}); }
    function ct(id, name, a, end, o) { return Object.assign({ id: id, Name: name, Account: ref(a, 'x'), Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete', Final_End_Date: end, Renewal_Status: 'Not started' }, o || {}); }
    var accounts = [
      acc('a1', 'Riverbend County Pretrial'),
      acc('a2', 'Lakeshore HHS', { Last_Touch: day(-95), Health_Tier: 'Red', Customer_Health: 'At Risk' }),
      acc('a3', 'Northfield Sheriff'),
      acc('a4', 'Cedar Valley Juvenile'),
      acc('a5', 'Pine Ridge Probation'),
      acc('a6', 'Harbor Court', { Account_Type: 'Prospect', Owner: alex }),
      acc('a7', 'Stone County Sheriff', { Account_Type: 'Prospect' }),
      acc('a8', 'Oak Hollow Agency', { Account_Type: null, Owner: alex }),
      acc('a9', 'Conference Group', { Account_Type: 'Association - Conferences' }),
      acc('a10', 'Old Mill County', { Former_Customer: true }),
      acc('a11', 'Bay Metro Corrections', { Owner: alex })
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
      deal('d4', 'Stone County program', 'a7', { Stage: 'Prospecting', Last_Activity_Time: iso(-45), Owner: alex }),
      deal('d5', 'Marquette Admin', null, { Stage: 'Discovery', Owner: alex }),
      deal('d6', 'Cedar Valley add-on', 'a4', { Stage: 'Closed Won', Closing_Date: day(-20) }),
      deal('d7', 'Old Mill return', 'a10', { Stage: 'Closed Lost', Closing_Date: day(-90) })
    ];
    var calls = [
      { id: 'k1', What_Id: null, Who_Id: ref('c1', 'Pat Lee'), Call_Start_Time: iso(-3) },          /* linked by contact only */
      { id: 'k2', What_Id: ref('a4', 'Cedar Valley Juvenile'), Who_Id: ref('c4', 'Lee Wong'), Call_Start_Time: iso(-5) }
    ];
    var meetings = [
      { id: 'm1', What_Id: ref('d2', 'Northfield expansion'), Who_Id: ref('c3', 'Kim Dao'), Start_DateTime: iso(-20) },   /* linked by opportunity */
      { id: 'm2', What_Id: ref('a6', 'Harbor Court'), Who_Id: ref('c5', 'Ana Ruiz'), Start_DateTime: iso(-75) },
      { id: 'm3', What_Id: ref('a5', 'Pine Ridge Probation'), Who_Id: null, Start_DateTime: iso(3) }                    /* future: not a touch */
    ];
    var emails = [
      { id: 'e1', Account: ref('a7', 'Stone County Sheriff'), Direction: 'In', Topic: 'Order Supplies', Received_At: iso(-6) },
      { id: 'e0', Account: ref('a5', 'Pine Ridge Probation'), Direction: 'In', Topic: 'Automated report', Received_At: iso(-1) },   /* automated: not a touch */
      { id: 'e2', Account: ref('a11', 'Bay Metro Corrections'), Direction: 'Out', Topic: 'Other', Received_At: iso(-40) }
    ];
    var contracts = [
      ct('k-a1', 'Riverbend EM services', 'a1', day(25), { Renewal_Status: 'In discussion' }),
      ct('k-a1b', 'Riverbend add-on', 'a1', day(300)),
      ct('k-a2', 'Lakeshore monitoring', 'a2', day(60)),
      ct('k-a3', 'Northfield 2023-2026', 'a3', day(-12)),
      ct('k-a3-old', 'Northfield 2020-2023', 'a3', day(-1100), { Contract_Status: 'Ended', Renewal_Status: 'Not renewing' }),
      ct('k-a4', 'Cedar Valley services', 'a4', day(400)),
      ct('k-a11', 'Bay Metro EM', 'a11', day(18)),
      ct('k-v1', 'Vendor supply agreement', 'a4', day(10), { Counterparty_Type: 'Vendor' })
    ];
    return { accounts: accounts, contacts: contacts, deals: deals, calls: calls, meetings: meetings, emails: emails, contracts: contracts, userId: 'u1' };
  }
  window.RelFlowDemo = { make: make };
})();
