/* Demo data for the Contracts flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers. Rows use the live API shapes. Times are relative to "now". */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now + n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now + n * D).toISOString(); }
    function acct(id, name) { return { id: 'a' + id, name: name }; }
    function ct(id, name, over) {
      return Object.assign({ id: id, Name: name, Account: acct(id, name), Counterparty_Type: 'Customer', Contract_Type: 'Full Contract', Contract_Status: 'Active/Complete', Ingest_Status: 'Backlog', Renewal_Status: 'Not started',
        Final_End_Date: day(400), Notice_Deadline: day(300), Margin_Cost_Check: 'Costs match contracts', Reconciliation_Status: 'Agrees', Owner: { name: 'Beau Carrigan' } }, over || {});
    }
    var contracts = [
      ct('c1', 'Riverbend County Pretrial'),
      ct('c2', 'Lakeshore HHS', { Final_End_Date: day(20) }),
      ct('c3', 'Northfield Sheriff', { Ingest_Status: 'Needs Review', Ingested_On: iso(-20), Margin_Cost_Check: null }),
      ct('c4', 'Cedar Valley Juvenile', { Ingest_Status: 'Needs Review', Ingested_On: iso(-3) }),
      ct('c5', 'Pine Ridge Probation', { Ingest_Status: 'Needs Review', Ingested_On: iso(-5) }),
      ct('c6', 'Harbor Court', { Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: null }),
      ct('c7', 'Stone County Sheriff', { Ingest_Status: 'Ingested', Ingested_On: iso(-9) }),
      ct('c8', 'Mill Creek Pretrial', { Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: 'Cost differs', Reconciliation_Status: 'Rate differs' }),
      ct('c9', 'Eastgate Municipal', { Ingest_Status: 'Failed', Ingested_On: iso(-2) }),
      ct('c10', 'Polk Co Sheriff', { Final_End_Date: day(-30), Margin_Cost_Check: 'Missing vendor cost' }),
      ct('c11', 'Vernon Co Sheriff Dept', { Final_End_Date: day(60), Notice_Deadline: day(-5) }),
      ct('c12', 'Van Buren County', { Final_End_Date: day(200), Renewal_Status: 'In discussion' }),
      ct('c13', 'Bayview Drug Court', { Final_End_Date: null }),
      ct('c14', 'Old Mill Probation (ended)', { Contract_Status: 'Ended', Final_End_Date: day(-100) }),
      ct('c15', 'Allied - vendor pricing', { Counterparty_Type: 'Vendor', Account: null, Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: null, Final_End_Date: day(500), Renewal_Status: null }),
      ct('c16', 'Summit County Pretrial', { Final_End_Date: day(10), Renewal_Status: 'Amendment sent' })
    ];
    function doc(id, c, name, over) { return Object.assign({ id: id, Name: name, Contract: c ? { id: c, name: '' } : null, Parse_Status: null, Created_Time: iso(-30) }, over || {}); }
    var docs = [doc('d1', 'c1', 'Riverbend Agreement.pdf'), doc('d2', 'c1', 'Riverbend Addendum 1.pdf'), doc('d3', 'c3', 'Northfield scan.pdf', { Parse_Status: 'Failed' }), doc('d4', 'c9', 'Eastgate Agreement.pdf'), doc('d9', null, 'Unsorted rate sheet.pdf')];
    function cl(id, c, status) { return { id: id, Name: 'Clause ' + id, Contract: c ? { id: c, name: '' } : null, Status: status, Clause_Type: 'Reporting', Created_Time: iso(-20) }; }
    var clauses = [cl('k1', 'c3', 'Proposed'), cl('k2', 'c4', 'Confirmed'), cl('k3', null, 'Proposed'), cl('k4', 'c6', 'Confirmed')];
    function ln(id, c, status, over) { return Object.assign({ id: id, Parent_Id: { id: c, name: '' }, Line_Status: status, Line_Verified: status === 'Verified', Superseded_By: null, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Source_Ref: 'p.7' }, over || {}); }
    var lines = [ln('l1', 'c3', 'Proposed'), ln('l2', 'c3', 'Proposed'), ln('l3', 'c3', 'Verified'), ln('l4', 'c4', 'Verified'), ln('l5', 'c4', 'Verified'), ln('l6', 'c6', 'Proposed'),
      ln('l7', 'c6', 'Proposed', { Source_Ref: '' }), ln('l8', 'c7', 'Verified'), ln('l9', 'c8', 'Verified')];
    return { contracts: contracts, docs: docs, clauses: clauses, lines: lines };
  }
  window.ContractsFlowDemo = { make: make };
})();
