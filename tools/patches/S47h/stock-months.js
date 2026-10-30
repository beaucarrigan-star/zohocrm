/* Stock Alerts: monthly counts (S47e, 30 Oct 2026). Pure logic so node tests can load it.
   Stock alerts raised   = alerts by the month of First Raised (Created Time when First Raised is empty), by type.
   Order confirmations   = alerts closed with Ordered whose Send Log records "order confirmation sent", by Handled Date month.
   No-order thank-yous   = alerts closed with No Order Needed whose Send Log records "Thank-you sent", by Handled Date month.
   The two email counts start on 30 Oct 2026, when the buttons were added. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockMonths = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TYPES = { 'Customer spare floor': 'low', 'Excess spares': 'excess', 'House stock': 'house', 'Program growth': 'growth' };

  function ym(s) { var m = /^(\d{4})-(\d{2})/.exec(String(s || '')); return m ? m[1] + '-' + m[2] : ''; }
  function label(k) { var p = k.split('-'); return NAMES[+p[1] - 1] + ' ' + p[0]; }
  function blank(k) { return { id: 'm' + k, key: k, month: label(k), raised: 0, low: 0, excess: 0, house: 0, growth: 0, ordered: 0, notOrdered: 0 }; }

  function isOrderedEmail(a) { return a.Resolution === 'Order placed' && /order confirmation sent/i.test(a.Send_Log || ''); }
  function isNoOrderEmail(a) { return a.Resolution === 'Customer declined' && /thank-you sent/i.test(a.Send_Log || ''); }

  /* rows: EM_Stock_Alerts records. now: 'YYYY-MM' for the current month (always shown). months: how many to show (default 12). */
  function monthly(rows, now, months) {
    var by = {};
    function get(k) { return by[k] || (by[k] = blank(k)); }
    (rows || []).forEach(function (a) {
      var k = ym(a.First_Raised) || ym(a.Created_Time);
      if (k) { var m = get(k); m.raised += 1; var t = TYPES[a.Alert_Type]; if (t) m[t] += 1; }
      var h = ym(a.Handled_Date) || ym(a.Email_Sent_At);
      if (h && isOrderedEmail(a)) get(h).ordered += 1;
      if (h && isNoOrderEmail(a)) get(h).notOrdered += 1;
    });
    if (now) get(now);
    return Object.keys(by).sort().reverse().slice(0, months || 12).map(function (k) { return by[k]; });
  }
  function totals(list) {
    var t = blank('0000-01'); t.id = 'total'; t.month = 'Total';
    list.forEach(function (m) { ['raised', 'low', 'excess', 'house', 'growth', 'ordered', 'notOrdered'].forEach(function (f) { t[f] += m[f]; }); });
    return t;
  }
  /* S47h: what actually happened to a closed alert, in plain words. key is used by the Closed filters. */
  function outcome(a) {
    var res = a.Resolution && a.Resolution !== '-None-' ? a.Resolution : '', em = a.Email_Status || '', st = a.Status || '';
    if (res === 'Order placed' || (st === 'Ordered' && !res)) return { key: 'ordered', label: isOrderedEmail(a) ? 'Ordered, confirmation sent' : 'Ordered', tone: 'good' };
    if (res === 'Customer declined') return { key: 'noorder', label: isNoOrderEmail(a) ? 'No order needed, thank-you sent' : 'Customer declined', tone: 'info' };
    if (em === 'Rejected') return { key: 'rejected', label: 'Rejected, nothing sent', tone: 'neutral' };
    if (res === 'Cleared on its own' || (st === 'Resolved' && !res)) return { key: 'cleared', label: 'Cleared on its own', tone: 'good' };
    if (res) return { key: 'other', label: res, tone: 'neutral' };
    return { key: 'other', label: st === 'Dismissed' ? 'Dismissed' : (st || 'Closed'), tone: 'neutral' };
  }
  /* The day it closed: Handled Date, else the last day the stock count still saw it. */
  function closedDay(a) { return String(a.Handled_Date || a.Last_Seen || a.Count_Date || '').slice(0, 10); }

  return { monthly: monthly, totals: totals, outcome: outcome, closedDay: closedDay, ym: ym, label: label, isOrderedEmail: isOrderedEmail, isNoOrderEmail: isNoOrderEmail };
});
