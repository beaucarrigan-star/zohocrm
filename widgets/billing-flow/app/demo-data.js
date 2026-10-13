/* Demo data for the Billing flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional amounts. Rows use the live API shapes. */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function iso(n) { return new Date(now + n * D).toISOString(); }
    function mk(off) { var d = new Date(now); var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1)); return t.toISOString().slice(0, 7); }
    function nm(k) { return new Date(k + '-01T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
    var SEP = mk(-1), OCT = mk(0), AUG = mk(-2), JUL = mk(-3), JUN = mk(-4), MAY = mk(-5);
    var periods = [
      { id: 'p-sep', Name: nm(SEP), Period: SEP, Period_Status: 'Reconciled', Upload_Vendor: 'Allied', Invoiced: 90387.8, Verified: 90387.8, On_Hold: 0, Recommended_Pay: 90387.8, Credits_To_Confirm: 0, Latent_Exposure: 353.8, Overbilled: 339.6, Unverified: 0, Findings_Total: 6, Findings_Open: 3, Needs_Decision: 0, Last_Run_Status: 'committed', Last_Run_At: iso(-12), Reconciled_On: iso(-12), Accounting_Report_At: iso(-12) },
      { id: 'p-oct', Name: nm(OCT), Period: OCT, Period_Status: 'In Review', Upload_Vendor: 'Allied', Invoiced: 68282.26, Verified: 44955.2, On_Hold: 21329.5, Recommended_Pay: 46952.76, Credits_To_Confirm: 1200, Latent_Exposure: 353.8, Overbilled: 18457.9, Unverified: 2871.6, Findings_Total: 9, Findings_Open: 8, Needs_Decision: 3, Last_Run_Status: 'committed', Last_Run_At: iso(-7) },
      { id: 'p-aug', Name: nm(AUG), Period: AUG, Period_Status: 'Open' },
      { id: 'p-jul', Name: nm(JUL), Period: JUL, Period_Status: 'Needs Attention', Upload_Vendor: null, Invoiced: 51000, Verified: 49000, On_Hold: 0, Recommended_Pay: 51000, Findings_Total: 12, Findings_Open: 4, Last_Run_Status: 'committed', Last_Run_At: iso(-60) },
      { id: 'p-jun', Name: nm(JUN), Period: JUN, Period_Status: 'Frozen', Upload_Vendor: 'SCRAM', Invoiced: 12000, Verified: 12000, Recommended_Pay: 12000, Findings_Total: 0, Findings_Open: 0, Last_Run_At: iso(-100), Reconciled_On: iso(-95) }
    ];
    var n = 0;
    function fin(pid, per, vendor, o) { n += 1; return Object.assign({ id: 'f' + n, Billing_Period: pid ? { id: pid, name: per } : null, Period: per, Vendor: vendor, Check_ID: 'RATE-1', Category: 'Rate & math', Subject: 'J.H. 3457' + n, Severity: 'MEDIUM', Dollars: 0, Money_Type: 'None', Status: 'Open', Is_Open: true, In_Latest_Run: true, Decision_Notes: null }, o || {}); }
    var findings = [
      fin('p-sep', SEP, 'Allied', { Status: 'Resolved - credited', Is_Open: false, Dollars: 339.6, Money_Type: 'Overbilled', Decision_Notes: 'Credit received' }),
      fin('p-sep', SEP, 'Allied', { Category: 'Spare units' }), fin('p-sep', SEP, 'Allied', { Category: 'Duplicate', Dollars: 40, Money_Type: 'Latent' }),
      fin('p-sep', SEP, 'Allied', { Status: 'Not an issue', Is_Open: false, Decision_Notes: 'Known' }), fin('p-sep', SEP, 'Allied', { Status: 'Resolved - explained', Is_Open: false }),
      fin('p-sep', SEP, 'Allied', { Category: 'Tie-out' }),
      fin('p-oct', OCT, 'Allied', { Severity: 'CRITICAL', Dollars: 12000, Money_Type: 'Overbilled', Category: 'Rate & math' }),
      fin('p-oct', OCT, 'Allied', { Severity: 'HIGH', Dollars: 6457.9, Money_Type: 'Overbilled', Category: 'Duplicate' }),
      fin('p-oct', OCT, 'Allied', { Severity: 'HIGH', Dollars: 800, Money_Type: 'Unverified', Status: 'Disputed with vendor' }),
      fin('p-oct', OCT, 'Allied', { Severity: 'LOW', Category: 'Enrollment' }), fin('p-oct', OCT, 'Allied', { Severity: 'INFO', Category: 'Preflight', In_Latest_Run: false }),
      fin('p-oct', OCT, 'Allied', { Dollars: 120, Money_Type: 'Latent' }), fin('p-oct', OCT, 'Allied', { Category: 'Month-over-month' }), fin('p-oct', OCT, 'Allied', { Category: 'Repair' }),
      fin('p-oct', OCT, 'Allied', { Status: 'Resolved - explained', Is_Open: false }),
      fin('p-jul', JUL, 'SCRAM', { Severity: 'HIGH', Dollars: 2000, Money_Type: 'Overbilled' }), fin('p-jul', JUL, 'SCRAM'),
      fin(null, MAY, 'Buddi', { Severity: 'HIGH', Dollars: 300, Money_Type: 'Overbilled' })
    ];
    return { periods: periods, findings: findings };
  }
  window.BillingFlowDemo = { make: make };
})();
