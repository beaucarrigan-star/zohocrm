/* Demo data for the Pricing flow (used only when the Zoho SDK is absent, or ?demo=1). Fictional customers. Rows use the live API shapes. Times are relative to "now". */
(function () {
  'use strict';
  var D = 86400000;
  function make(now) {
    function day(n) { return new Date(now + n * D).toISOString().slice(0, 10); }
    function iso(n) { return new Date(now + n * D).toISOString(); }
    function acct(id, name) { return { id: 'a' + id, name: name }; }
    function sc(id, a, name, status, o) {
      return Object.assign({ id: id, Name: name, Account: a ? a : null, Scenario_Status: status, Pricing_Model: 'Daily lease', Active_Units: 100, Est_Monthly_Revenue: 10000, Est_Monthly_Cost: 7000,
        Est_Margin_Pct: 30, Target_Margin_Pct: 25, Margin_Tier: 'Normal', Missing_Costs: 0, Created_Time: iso(-50), Modified_Time: iso(-2) }, o || {});
    }
    var A = { rb: acct(1, 'Riverbend County Pretrial'), lk: acct(2, 'Lakeshore HHS'), nf: acct(3, 'Northfield Sheriff'), ce: acct(4, 'Cedar Valley Juvenile'), pr: acct(5, 'Pine Ridge Probation'), hb: acct(6, 'Harbor Court'), sc: acct(7, 'Stone County Sheriff'), mc: acct(9, 'Mill Creek Pretrial') };
    var scenarios = [
      sc('s1', A.rb, 'Riverbend renewal', 'Accepted'),
      sc('s2', A.lk, 'Lakeshore new program', 'Proposed', { Est_Monthly_Revenue: 5000, Est_Monthly_Cost: 4000, Est_Margin_Pct: 20, Valid_Until: day(-3) }),
      sc('s3', null, 'New scenario', 'Draft', { Est_Monthly_Revenue: 0, Est_Monthly_Cost: 0, Est_Margin_Pct: null, Modified_Time: iso(-40) }),
      sc('s4', A.nf, 'Northfield expansion', 'Proposed', { Est_Monthly_Revenue: 3000, Est_Monthly_Cost: 2000, Valid_Until: day(10) }),
      sc('s5', A.ce, 'Cedar Valley', 'Declined', { Est_Monthly_Revenue: 1000 }),
      sc('s6', A.pr, 'Pine Ridge probation', 'Accepted', { Est_Monthly_Revenue: 4000, Est_Monthly_Cost: 3000, Est_Margin_Pct: 25, Margin_Tier: 'Thin', Missing_Costs: 2 })
    ];
    function row(id, scid, a, fam, exp, cost, mar) { return { id: id, Name: 'row ' + id, Row_Type: 'Scenario model', Pricing_Scenario: scid ? { id: scid, name: '' } : null, Account: a, Device_Family: fam, Expected_Revenue: exp, Modelled_Cost: cost, Modelled_Margin: mar, Created_Time: iso(-2) }; }
    function act(id, a, fam, rev, cost, month, o) { return Object.assign({ id: id, Name: 'actual ' + id, Row_Type: 'Billing actual', Account: a, Device_Family: fam, Invoiced_Revenue: rev, Actual_Cost: cost, Billing_Month: month, Created_Time: iso(-1) }, o || {}); }
    var margins = [row('m1', 's1', A.rb, 'GPS', 10000, 7000, 3000), row('m2', 's2', A.lk, 'GPS', 4000, 3000, 1000), row('m3', 's6', A.pr, 'GPS', 4000, 3000, 1000), row('m4', null, A.pr, 'CAM', 100, 80, 20),
      act('b1', A.rb, 'GPS', 10000, 8500, '2026-09'), act('b2', A.pr, 'GPS', 4000, 2900, '2026-09'), act('b3', A.mc, 'CAM', 2000, 1000, '2026-09'), act('b4', A.rb, 'RF', 500, null, '2026-09', { Status: 'Exception' }), act('b5', A.rb, 'GPS', 9000, 9000, '2026-08')];
    function prod(id, n, v, cost, check, active) { return { id: id, Product_Name: n, Vendor_Name: { id: 'v', name: v }, Product_Active: active !== false, Cost_Lease_Daily: cost, Contract_Check: check }; }
    var products = [prod('p1', '1 Piece GPS - Allied', 'Allied', 3.05, 'Matches contract'), prod('p2', 'RF - Allied', 'Allied', null, 'No cost entered'), prod('p3', 'Wrist worn GPS - Allied', 'Allied', 3.75, 'No contract rate'),
      prod('p4', 'Hybrid - Buddi', 'Buddi', 6.5, null), prod('p5', '1 Piece GPS - Allied (490, retired)', 'Allied', null, null, false)];
    var rates = [{ id: 'r1', Agency: 'Sheboygan Sheriff', Device_Type: '1 Piece GPS', Active_Rate: 2.55, Basis: 'special', Confirmation: 'Contract-confirmed', Modified_Time: iso(-5) },
      { id: 'r2', Agency: 'Iowa County', Device_Type: 'PureOne', Active_Rate: 3, Basis: 'leased', Confirmation: 'Observed', Modified_Time: iso(-120), Source: 'Observed on May report' },
      { id: 'r3', Agency: 'Sheboygan Default', Device_Type: 'Remote Breath', Active_Rate: 3.5, Basis: 'special', Confirmation: null, Modified_Time: iso(-10) }];
    function ct(id, n, a, st) { return { id: id, Name: n, Account: a, Counterparty_Type: 'Customer', Contract_Status: st || 'Active/Complete', Final_End_Date: day(300) }; }
    var contracts = [ct('k1', 'Riverbend Pretrial Monitoring', A.rb), ct('k2', 'Harbor Court', A.hb), ct('k3', 'Stone County Sheriff', A.sc), ct('k4', 'Old Mill (ended)', acct(8, 'Old Mill'), 'Ended'),
      { id: 'k5', Name: 'Allied - vendor pricing', Account: null, Counterparty_Type: 'Vendor', Contract_Status: null }];
    function ln(id, c, status, type) { return { id: id, Parent_Id: { id: c, name: '' }, Line_Status: status, Line_Verified: status === 'Verified', Rate_Type: type || 'Customer rate', Source_Ref: 'p.1' }; }
    var lines = [ln('l1', 'k1', 'Verified'), ln('l2', 'k2', 'Verified'), ln('l3', 'k2', 'Proposed'), ln('l4', 'k3', 'Proposed'), ln('l5', 'k4', 'Verified'), ln('l6', 'k5', 'Verified', 'Vendor cost')];
    return { products: products, rates: rates, contracts: contracts, lines: lines, scenarios: scenarios, margins: margins };
  }
  window.PricingFlowDemo = { make: make };
})();
