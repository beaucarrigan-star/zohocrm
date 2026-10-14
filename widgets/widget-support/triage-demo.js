/* Demo rows for triage when the Zoho SDK is absent. Same shape as COQL rows. Fictional senders and accounts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TriageDemo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function make(nowMs) {
    var H = 3600000, n = 0;
    function row(o) {
      n += 1;
      var at = new Date(nowMs - o.h * H).toISOString();
      return {
        id: 'demo' + n, Name: o.s, Sender_Email: o.e, Sender_Name: o.n || '', Recipient_Email: 'emsupport@example.org',
        Topic: o.t || 'Other', Direction: 'In', Intake_Result: o.r === undefined ? 'Left for review' : o.r,
        Received_At: o.live ? null : at, Created_Time: at, Last_Activity_Time: at,
        Account: o.a ? { id: 'acc' + o.a, name: o.a } : null, Case: o.c ? { id: 'case' + n, name: o.c } : null, Thread_Link: '', Source: null
      };
    }
    return [
      row({ s: 'Monitor will not charge', e: 'ops@example-county.test', n: 'Pat Ops', a: 'Example Co Sheriff', h: 80, t: 'Device issue', live: true }),
      row({ s: 'Need straps for new clients', e: 'intake@example-court.test', a: 'Example Treatment Court', h: 52, t: 'Supplies & straps', live: true }),
      row({ s: 'Invoice question', e: 'billing@example-hhs.test', a: 'Example Co HHS', h: 30, t: 'Billing questions' }),
      row({ s: 'Quick question', e: 'someone@unknown-domain.test', n: 'Someone', h: 100, t: 'Other / General', live: true }),
      row({ s: 'Call me back', e: 'jo@another-unknown.test', h: 6, t: 'Voicemail', r: 'Voicemail' }),
      row({ s: 'New case from unknown sender', e: 'new@mystery.test', h: 40, r: 'Case created', c: 'Mystery sender' }),
      row({ s: 'Daily alerts report', e: 'noreply@vendor.test', h: 28, r: 'Automated report' }),
      row({ s: 'Webinar invite', e: 'marketing@promo.test', h: 70, r: 'Ignored' }),
      row({ s: 'Newsletter', e: 'news@promo.test', h: 120, r: 'Ignored' }),
      row({ s: 'Imported: GPS fee (history)', e: 'old@example-county.test', a: 'Example Co Sheriff', h: 3000, r: null }),
      { id: 'demoout', Name: 'Our reply', Sender_Email: 'emsupport@example.org', Direction: 'Out', Intake_Result: null, Received_At: new Date(nowMs - 10 * H).toISOString(), Account: { id: 'accX', name: 'Example Co HHS' }, Case: null }
    ];
  }
  return { make: make };
});
