/* Demo data for the case strip (no Zoho). Pick a case with ?case=assigned | unassigned | waiting | other | overdue. Synthetic. */
(function (root) {
  'use strict';
  var USERS = [
    { id: 'u1', full_name: 'Beau Carrigan', email: 'bcarrigan@example.org', status: 'active', profile: { name: 'Administrator' } },
    { id: 'u2', full_name: 'Dana Whitfield', email: 'dwhitfield@example.org', status: 'active', profile: { name: 'EM Support' } },
    { id: 'u3', full_name: 'Marcus Oyelaran', email: 'moyelaran@example.org', status: 'active', profile: { name: 'EM Support' } },
    { id: 'u4', full_name: 'Priya Nair', email: 'pnair@example.org', status: 'active', profile: { name: 'BD' } },
    { id: 'u9', full_name: 'Former Employee', email: 'old@example.org', status: 'inactive', profile: { name: 'EM Support' } }
  ];
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + 'T09:00:00-05:00'; }
  function ago(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  function ahead(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  var CASES = {
    assigned: { id: 'c1', Case_Number: 'EM-1081', Subject: 'Strap order did not arrive at Marinette County', Status: 'In Progress', Owner: { id: 'u2' }, Handling_Team: 'EM Support', Waiting_On: 'Nobody', Next_Action: 'Call the county to confirm the ship-to address', Due_By: ahead(1), Created_Time: ago(1) },
    unassigned: { id: 'c2', Case_Number: 'EM-1090', Subject: 'Device offline since Tuesday', Status: 'New', Owner: null, Handling_Team: '-None-', Waiting_On: '-None-', Next_Action: null, Due_By: ahead(1), Created_Time: ago(0) },
    waiting: { id: 'c3', Case_Number: 'EM-1077', Subject: 'Replacement charger back-ordered', Status: 'Waiting on Vendor', Owner: { id: 'u3' }, Handling_Team: 'EM Support', Waiting_On: 'Vendor', Next_Action: 'Ask the vendor for the new ship date', Due_By: null, Created_Time: ago(4) },
    other: { id: 'c4', Case_Number: 'EM-1070', Subject: 'Billing question from county clerk', Status: 'Pending Legal', Owner: { id: 'u4' }, Handling_Team: 'Customer Success', Waiting_On: 'Nobody', Next_Action: 'Send the September statement', Due_By: ahead(2), Created_Time: ago(2) },
    overdue: { id: 'c5', Case_Number: 'EM-1049', Subject: 'Reset participant tablet', Status: 'In Progress', Owner: { id: 'u3' }, Handling_Team: 'EM Support', Waiting_On: 'Nobody', Next_Action: 'Confirm reset worked', Due_By: ago(2), Created_Time: ago(5) }
  };
  root.STRIP_DEMO = { users: USERS, me: 'u1', cases: CASES };
})(typeof window !== 'undefined' ? window : this);
