/* Demo data for Support flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers.
   Rows use the live API shapes: Support_Emails and Cases as COQL returns them. Times are relative to "now". */
(function () {
  'use strict';
  var H = 3600000, D = 86400000;
  var ACCT = {
    adams: { id: '9001', name: 'Adams Co. Treatment Court' }, boone: { id: '9002', name: 'Boone Co. Sheriff' },
    cass: { id: '9003', name: 'Cass County Jail' }, polk: { id: '9004', name: 'Polk Co. Sheriff' }, vernon: { id: '9005', name: 'Vernon Co. Sheriff Dept' }
  };
  function make(now) {
    function iso(msAgo) { return new Date(now - msAgo).toISOString(); }
    var n = 0;
    function E(subject, sender, result, hoursAgo, acct, caseRef, over) {
      n += 1;
      var r = { id: 'e' + n, Name: subject, Sender_Email: sender, Sender_Name: '', Recipient_Email: 'support@differenceprinciple.org', Topic: '-None-', Direction: 'In',
        Intake_Result: result, Source: 'Mailbox', Received_At: null, Created_Time: iso(hoursAgo * H), Last_Activity_Time: iso(hoursAgo * H),
        Account: acct ? { id: acct.id, name: acct.name } : null, Case: caseRef ? { id: caseRef.id, name: caseRef.name } : null, Thread_Link: '' };
      if (over) for (var k in over) r[k] = over[k];
      return r;
    }
    var emails = [
      E('Strap came off on a participant', 'deputy@adamsco.example', 'Case created', 5 * 24, ACCT.adams, { id: 'c1', name: 'EM-2101' }, { Topic: 'Device Troubleshooting' }),
      E('Re: Strap came off on a participant', 'deputy@adamsco.example', 'Added to existing case', 4 * 24, ACCT.adams, { id: 'c1', name: 'EM-2101' }),
      E('Charger not holding charge', 'jail@cassco.example', 'Case created', 9 * 24, ACCT.cass, { id: 'c2', name: 'EM-2102' }, { Topic: 'Order Supplies' }),
      E('Device offline since Tuesday', 'ops@booneso.example', 'Case created', 3 * 24, ACCT.boone, { id: 'c3', name: 'EM-2103' }, { Topic: 'Device Troubleshooting' }),
      E('Need 4 more chargers', 'ops@booneso.example', 'Case created', 2 * 24, ACCT.boone, { id: 'c4', name: 'EM-2104' }, { Topic: 'Order Supplies' }),
      E('Need 2 devices, installer to meet us', 'clerk@polkco.example', 'Case created', 26 * 24 / 2, ACCT.polk, { id: 'c5', name: 'EM-2105' }, { Topic: 'Order Device(s)' }),
      E('Billing question on last invoice', 'ap@vernonco.example', 'Left for review', 3 * 24 + 2, ACCT.vernon),
      E('Alert notifications stopped', 'pm@adamsco.example', 'Left for review', 30, ACCT.adams),
      E('Hello, who handles monitoring in my county?', 'newperson@unknown.example', 'Left for review', 51, null),
      E('Voicemail from 414 555 0142', 'voicemail@phone.example', 'Voicemail', 20, null),
      E('Out of office: back Monday', 'auto@polkco.example', 'Ignored', 22, ACCT.polk),
      E('Weekly report', 'noreply@vendor.example', 'Ignored', 60, null),
      E('Delivery confirmation', 'noreply@carrier.example', 'Ignored', 36, null),
      E('Participant moved counties', 'clerk@polkco.example', 'Left for review', 2, ACCT.polk),
      E('Marked as case but nothing linked', 'staff@cassco.example', 'Case created', 6 * 24, ACCT.cass, null, { Topic: 'Order Supplies' }),
      E('Need 6 more devices for the new docket', 'ops@booneso.example', 'Left for review', 3, ACCT.boone, null, { Topic: 'Order Device(s)' }),
      E('We ran out of straps', 'intake@adamsco.example', 'Left for review', 6, ACCT.adams, null, { Topic: 'Order Supplies' }),
      E('Daily alerts report', 'noreply@vendor.example', 'Automated report', 10, null, null, { Topic: 'Automated report' }),
      E('Daily alerts report', 'noreply@vendor.example', 'Automated report', 34, null, null, { Topic: 'Automated report' }),
      E('Vendor RMA reminder', 'rma@vendor.example', 'Vendor notice', 60, null, null, { Topic: 'Vendor notice' }),
      E('Inventory check', 'ops@differenceprinciple.example', 'Internal', 40, null, null, { Topic: 'Internal' }),
      E('Re: Old thread about a lost device', 'staff@vernonco.example', 'Added to existing case', 7 * 24, ACCT.vernon, { id: 'c-gone', name: 'EM-1999' }),
      E('Imported history message', 'old@archive.example', null, 200 * 24, ACCT.adams),
      E('Sent: your case was received', 'support@differenceprinciple.org', 'Case created', 4 * 24, ACCT.boone, null, { Direction: 'Out' })
    ];
    function C(id, no, subject, status, priority, daysAgo, acct, owner, x) {
      var r = { id: id, Case_Number: no, Subject: subject, Status: status, Priority: priority, Created_Time: iso(daysAgo * D), Case_Age_days: Math.floor(daysAgo),
        Owner: owner ? { id: 'u1', name: owner } : null, Account_Name: acct ? { id: acct.id, name: acct.name } : null };
      if (x) for (var k in x) r[k] = x[k];
      return r;
    }
    var cases = [
      C('c1', 'EM-2101', 'Strap came off on a participant', 'In Progress', 'High', 5, ACCT.adams, 'Stacey L.', { Case_Category: 'Device Troubleshooting', Vendor: { id: 'v1', name: 'Allied Universal EM' }, Vendor_Ticket_Number: 'AU-55021', Device_Serial: 'GPS-77412' }),
      C('c2', 'EM-2102', 'Charger not holding charge', 'Waiting on Customer', 'Medium', 9, ACCT.cass, 'Brittany M.', { Case_Category: 'Order Supplies' }),
      C('c3', 'EM-2103', 'Device offline since Tuesday', 'Escalated', 'High', 3, ACCT.boone, 'Stacey L.', { Case_Category: 'Device Troubleshooting' }),
      C('c4', 'EM-2104', 'Need 4 more chargers', 'New', 'Medium', 2, ACCT.boone, null, { Case_Category: 'Order Supplies' }),
      C('c5', 'EM-2105', 'Need 2 devices, installer to meet us', 'Acknowledged', 'Medium', 13, ACCT.polk, 'Brittany M.', { Case_Category: 'Order Device(s)' }),
      C('c6', 'EM-2090', 'Loaner device request', 'In Progress', 'Low', 21, ACCT.vernon, 'Stacey L.', { Case_Category: 'Order Device(s)' }),
      C('c7', 'EM-2088', 'Report format question', 'Closed', 'Low', 12, ACCT.adams, 'Brittany M.', { Case_Category: 'Portal or Software' }),
      C('c8', 'EM-2080', 'Lost device replacement', 'Resolved', 'Medium', 17, ACCT.cass, 'Stacey L.', { Case_Category: 'Lost Equipment', Resolution_Category: 'Device Replaced' }),
      C('c9', 'EM-2106', 'Caller left a voicemail, no account found', 'New', 'Medium', 4, null, null, { Case_Category: 'Order Supplies' }),
      C('c10', 'EM-1950', 'Very old closed case', 'Closed', 'Low', 140, ACCT.polk, 'Stacey L.', { Case_Category: 'Other' }),
      C('c11', 'EM-2070', 'Devices ordered last week', 'In Progress', 'Medium', 8, ACCT.vernon, 'Stacey L.', { Case_Category: 'Order Device(s)' })
    ];
    function O(id, type, status, caseId, vendor, ref, daysAgo, recvDaysAgo) {
      return { id: id, Order_Type: type, Order_Status: status, Case: { id: caseId, name: caseId }, Vendor: { id: 'v' + vendor, name: vendor }, Reference: ref,
        Order_Date: iso(daysAgo * D).slice(0, 10), Received_Date: recvDaysAgo != null ? iso(recvDaysAgo * D).slice(0, 10) : null, Account: null };
    }
    var orders = [
      O('o1', 'Accessories', 'Placed', 'c4', 'SCRAM Systems', 'S-1182', 1),
      O('o2', 'Devices', 'Received', 'c6', 'Buddi', 'B-77', 14, 2),
      O('o3', 'Devices', 'Placed', 'c11', 'Allied Universal EM', 'AU-9001', 7)
    ];
    return { emails: emails, cases: cases, orders: orders };
  }
  window.FlowDemo = { make: make };
})();
