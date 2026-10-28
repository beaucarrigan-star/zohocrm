/* suggested-model.js v1.0 (S44): matching rules, no Zoho calls. Used by suggested.js and the offline test. */
(function (root) {
  'use strict';
  /* Cases Vendor is a lookup to the Vendors list; map its name to the article Vendor picklist. */
  var VENDOR_WORDS = [['scram', 'SCRAM'], ['supercom', 'SuperCom'], ['buddi', 'Buddi'], ['allied', 'Allied Universal'], ['sentinel', 'Sentinel']];
  function mapVendor(name) { var n = String(name || '').toLowerCase(); for (var i = 0; i < VENDOR_WORDS.length; i++) if (n.indexOf(VENDOR_WORDS[i][0]) >= 0) return VENDOR_WORDS[i][1]; return ''; }
  /* Case Category -> article Topics (and a preferred Type). */
  var CAT = {
    'Device Troubleshooting': { type: 'Troubleshooting', topics: ['Installation', 'Events and Violations'] },
    'Enrollment or Removal': { topics: ['Enrollment', 'Removal', 'Installation'] },
    'Alerts and Violations': { topics: ['Events and Violations', 'Zones and Schedules'] },
    'Billing Question': { topics: ['Billing and Returns'] },
    'Training Request': { type: 'Training', topics: [] },
    'Portal or Software': { topics: ['Users and Permissions', 'Reports'] },
    'Lost Equipment': { topics: ['Billing and Returns'] }
  };
  var STOP = 'the a an and or of to in on for with at is it this that was not no from by be are as has have had can cant cannot case please need needs'.split(' ');
  function words(s) { return String(s || '').toLowerCase().replace(/<[^>]*>/g, ' ').split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
  function score(a, c) {
    var s = 0, why = [];
    if (c.vendor && a.vendor === c.vendor) { s += 5; why.push('same vendor'); } else if (c.vendor && a.vendor && a.vendor !== c.vendor) { return { s: 0, why: [] }; }
    var cat = CAT[c.category] || null;
    if (cat) { if (cat.type && a.type === cat.type) { s += 2; why.push(a.type.toLowerCase()); } if (cat.topics.indexOf(a.topic) >= 0) { s += 2; why.push('topic ' + a.topic); } }
    var cw = words(c.subject + ' ' + (c.description || '')), seen = {}, hit = 0;
    var hay = ' ' + words(a.title + ' ' + a.symptom + ' ' + a.device + ' ' + a.steps).join(' ') + ' ';
    cw.forEach(function (w) { if (!seen[w] && hay.indexOf(' ' + w + ' ') >= 0) { seen[w] = 1; hit++; } });
    if (hit) { s += Math.min(hit, 4); why.push(hit + ' matching word' + (hit > 1 ? 's' : '')); }
    return { s: s, why: why };
  }
  function suggest(articles, c, n) {
    return articles.map(function (a) { var r = score(a, c); return { a: a, s: r.s, why: r.why }; })
      .filter(function (x) { return x.s > 0 && (!c.vendor || x.a.vendor === c.vendor); })
      .sort(function (x, y) { return y.s - x.s || (x.a.title < y.a.title ? -1 : 1); }).slice(0, n || 3);
  }
  root.SAModel = { mapVendor: mapVendor, suggest: suggest, score: score, words: words };
})(typeof window !== 'undefined' ? window : module.exports);
