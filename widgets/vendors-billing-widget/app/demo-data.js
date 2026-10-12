/* Demo data for standalone preview (no Zoho). Counts mirror the live periods read on 11 Oct 2026:
   Sep 2026 = 290 findings, 185 open; Oct 2026 = 216, all open; Aug 2026 = created by hand, no findings.
   Row content is synthetic (fake initials and device ids); categories are the ones seen live. Deterministic, no randomness. */
(function (root) {
  'use strict';
  var PERIODS = [
    { id: '6715134000007398001', Name: 'September 2026', Period: '2026-09', Period_Status: 'Reconciled', Upload_Vendor: 'Allied', Findings_Total: 290, Findings_Open: 185 },
    { id: '6715134000007726001', Name: 'October 2026', Period: '2026-10', Period_Status: 'In Review', Upload_Vendor: 'Allied', Findings_Total: 216, Findings_Open: 216 },
    { id: '6715134000008149039', Name: 'August 2026', Period: '2026-08', Period_Status: 'Open', Upload_Vendor: null, Findings_Total: null, Findings_Open: null }
  ];
  var KINDS = [
    ['Duplicate', 'D14', 'INFO', 'None', 0], ['Enrollment', 'E11', 'MEDIUM', 'None', 0], ['Rate & math', 'R15', 'MEDIUM', 'None', 0],
    ['Tie-out', 'T21', 'INFO', 'None', 0], ['Tie-out', 'T18', 'HIGH', 'None', 0], ['Duplicate', 'D08', 'CRITICAL', 'Overbilled', 73.2],
    ['Spare units', 'S07', 'MEDIUM', 'Unverified', 0], ['Repair', 'RP02', 'MEDIUM', 'Unverified', 0], ['Month-over-month', 'M02', 'MEDIUM', 'None', 0]
  ];
  var INITIALS = ['J.H.', 'J.D.', 'W.G.', 'D.W.', 'C.B.', 'M.N.', 'R.T.', 'S.K.'];
  function build(period, total, open, startId) {
    var rows = [];
    for (var i = 0; i < total; i++) {
      var k = KINDS[(i * 7 + (i % 5)) % KINDS.length];
      var trend = k[0] === 'Month-over-month';
      rows.push({
        id: String(startId + i), Period: period, Vendor: trend ? '(trend)' : 'Allied',
        Check_ID: k[1], Category: k[0], Severity: k[2], Money_Type: k[3], Status: i < open ? 'Open' : 'Resolved - explained',
        Is_Open: i < open, Dollars: k[4], Subject: trend ? 'R-' + (84000 + i) : INITIALS[i % INITIALS.length] + ' · ' + (34500000 + i * 17)
      });
    }
    return rows;
  }
  /* Sep: the first 185 rows are open (in the demo the order is arbitrary). */
  var ROWS = build('2026-09', 290, 185, 1000).concat(build('2026-10', 216, 216, 5000));
  root.FINDINGS_DEMO = { periods: PERIODS, rows: ROWS };
})(window);
