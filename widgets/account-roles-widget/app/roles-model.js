/* Account roles: pure logic (no DOM, no Zoho). Browser: window.RolesModel. Node: require.
   Account_Roles fields (read from the live module 16 Oct 2026): Account (lookup), Role (picklist), Side (County|Internal),
   Contact (lookup), Person (user lookup), Since (date), Last_Contact (date), Role_Notes (text). */
(function (root) {
  'use strict';
  var NONE = { '': 1, '-none-': 1, 'none': 1 };
  function clean(v) { var s = v == null ? '' : String(v).trim(); return NONE[s.toLowerCase()] ? '' : s; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; }

  /* The six roles every account is expected to have, in display order. Descriptions are plain language for the row. */
  var ROLE_DEFS = [
    { role: 'County Contact', side: 'County', desc: 'Day-to-day contact at the county' },
    { role: 'Contract Authority', side: 'County', desc: 'Signs or renews the agreement' },
    { role: 'Billing Contact', side: 'County', desc: 'Receives and pays invoices' },
    { role: 'Customer Stakeholder', side: 'County', desc: 'Senior person who cares about the program' },
    { role: 'Program Relationship Lead', side: 'Internal', desc: 'Owns the relationship for us' },
    { role: 'CRM Owner', side: 'Internal', desc: 'Keeps this account\'s records up to date' }
  ];

  function personOf(rec) {
    var c = rec.Contact, p = rec.Person;
    if (c && (c.name || c.id)) return { name: c.name || 'Unnamed contact', title: 'Contact', kind: 'contact', id: c.id ? String(c.id) : '' };
    if (p && (p.name || p.id)) return { name: p.name || 'Unnamed user', title: 'Team member', kind: 'user', id: p.id ? String(p.id) : '' };
    return null;
  }
  function touchOf(rec) {
    var lc = fmtDate(rec.Last_Contact), sn = fmtDate(rec.Since);
    return lc ? 'Last contact ' + lc : sn ? 'Since ' + sn : 'No contact recorded';
  }
  function sideOf(rec, def) { var s = clean(rec.Side).toLowerCase(); return s === 'internal' ? 'internal' : s === 'county' ? 'county' : def ? def.side.toLowerCase() : 'county'; }

  /* records: Account_Roles rows for one account. Every expected role appears at least once (gap row when nobody is named);
     a role with several people shows each; a role outside the list is kept, never dropped. */
  function buildRows(records, defs) {
    defs = defs || ROLE_DEFS; records = (records || []).filter(Boolean);
    var rows = [], used = {};
    defs.forEach(function (d) {
      var mine = records.filter(function (r) { return clean(r.Role) === d.role; });
      mine.forEach(function (r) { used[r.id] = 1; });
      var named = mine.filter(personOf);
      if (!named.length) { rows.push({ id: 'gap:' + d.role, recordId: mine[0] ? String(mine[0].id) : '', role: d.role, desc: d.desc, side: d.side.toLowerCase() === 'internal' ? 'internal' : 'external', person: null, touch: '', notes: '' }); return; }
      named.forEach(function (r) { rows.push({ id: String(r.id), recordId: String(r.id), role: d.role, desc: d.desc, side: sideOf(r, d) === 'internal' ? 'internal' : 'external', person: personOf(r), touch: touchOf(r), notes: clean(r.Role_Notes) }); });
    });
    records.forEach(function (r) {
      if (used[r.id]) return;
      var role = clean(r.Role) || 'Role not set', p = personOf(r);
      rows.push({ id: String(r.id), recordId: String(r.id), role: role, desc: 'Not one of the usual six roles', side: sideOf(r) === 'internal' ? 'internal' : 'external', person: p, touch: p ? touchOf(r) : '', notes: clean(r.Role_Notes) });
    });
    return rows;
  }
  function summary(rows) {
    var expected = ROLE_DEFS.map(function (d) { return d.role; });
    var gaps = rows.filter(function (r) { return !r.person && expected.indexOf(r.role) > -1; });
    var n = gaps.length;
    return { gaps: n, names: gaps.map(function (g) { return g.role; }), text: n ? n + (n === 1 ? ' role has' : ' roles have') + ' nobody named: ' + gaps.map(function (g) { return g.role; }).join(', ') + '.' : 'Every role has someone named.' };
  }
  /* COQL for one account. id must be digits only; anything else is refused so it can never alter the query. */
  function coql(accountId) {
    var id = String(accountId || '');
    if (!/^\d+$/.test(id)) throw new Error('Account id is not valid');
    return "select id, Role, Side, Contact, Person, Since, Last_Contact, Role_Notes from Account_Roles where Account = '" + id + "'";
  }
  var api = { clean: clean, fmtDate: fmtDate, ROLE_DEFS: ROLE_DEFS, buildRows: buildRows, summary: summary, coql: coql };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RolesModel = api;
})(typeof window !== 'undefined' ? window : this);
