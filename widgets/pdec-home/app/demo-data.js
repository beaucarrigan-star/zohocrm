/* Sample data for opening the page outside Zoho. Names are made up. */
(function () {
  function d(n) { return new Date(2026, 9, 15 - n).toISOString(); }
  var camps = [
    { id: 'c1', Campaign_Name: 'Sample Pretrial Conference 2026', Conference_Start_Date: '2026-03-10', Status: 'Complete', Speaking_or_Training_Opportunity: true, Total_Event_Cost: 4200 },
    { id: 'c2', Campaign_Name: 'Sample Courts Summit 2026', Conference_Start_Date: '2026-06-02', Status: 'Complete', Speaking_or_Training_Opportunity: false, Total_Event_Cost: 3100 },
    { id: 'c3', Campaign_Name: 'Sample Association Annual 2026', Conference_Start_Date: '2026-11-12', Status: 'Planning', Speaking_or_Training_Opportunity: true, Total_Event_Cost: 2500 }
  ];
  function mem(prefix, n, status) { var a = []; for (var i = 1; i <= n; i++) a.push({ id: prefix + i, name: 'Sample Person ' + prefix.toUpperCase() + i, status: status || 'Attended', account: i % 3 ? 'Sample County ' + (i % 5) : null }); return a; }
  var members = { c1: mem('a', 18), c2: mem('b', 12), c3: [] };
  var deals = [
    { id: 'd1', Deal_Name: 'Sample County 1 pretrial assessment', Stage: 'Closed Won', Contact_Name: { id: 'a1' }, Account_Name: { name: 'Sample County 1' }, Source_Campaign: { id: 'c1' }, Created_Time: d(170), Closing_Date: '2026-07-20', Stage_Modified_Time: d(80), Services_Revenue: 18000, PDEC_Service_Type: ['Technical assistance'], PDEC_Topic: 'Pretrial' },
    { id: 'd2', Deal_Name: 'Sample County 2 staff training', Stage: 'Proposal Submitted', Contact_Name: { id: 'a2' }, Account_Name: { name: 'Sample County 2' }, Source_Campaign: { id: 'c1' }, Created_Time: d(120), Stage_Modified_Time: d(40), PDEC_Service_Type: ['Training'], PDEC_Topic: 'Pretrial' },
    { id: 'd3', Deal_Name: 'Sample County 3 program review', Stage: 'Discovery', Contact_Name: { id: 'a4' }, Source_Campaign: { id: 'c1' }, Created_Time: d(60), Stage_Modified_Time: d(60), PDEC_Service_Type: ['Consulting'], PDEC_Topic: 'Pretrial' },
    { id: 'd4', Deal_Name: 'Sample court training', Stage: 'Meeting (Face to Face or Zoom)', Contact_Name: { id: 'b1' }, Source_Campaign: { id: 'c2' }, Created_Time: d(45), Stage_Modified_Time: d(20), PDEC_Service_Type: ['Training', 'Consulting'], PDEC_Topic: 'Other' }
  ];
  var touches = [
    { contactId: 'a1', date: '2026-03-18' }, { contactId: 'a2', date: '2026-03-25' }, { contactId: 'a4', date: '2026-04-30' }, { contactId: 'a5', date: '2026-04-02' },
    { contactId: 'a6', date: '2026-05-04' }, { contactId: 'b1', date: '2026-06-20' }, { contactId: 'b2', date: '2026-07-01' }
  ];
  var notes = {
    a1: [{ Created_Time: '2026-03-18T15:00:00Z', Note_Title: 'Pretrial TA: wants a scope call', Note_Content: 'Met after the session. Interested in a risk assessment review.' }],
    a2: [{ Created_Time: '2026-03-25T15:00:00Z', Note_Title: 'Pretrial training: staff of 14', Note_Content: 'Budget window in spring.' }]
  };
  window.PdecDemo = { campaigns: camps, members: members, deals: deals, touches: touches, notes: notes };
})();
