/* Demo data for the account roles widget (no Zoho). ?account=mixed | full | empty | many ; ?profile=Standard hides the buttons. Synthetic. */
(function (root) {
  'use strict';
  var R = function (id, role, side, who, kind, last, since, notes) { var r = { id: id, Role: role, Side: side, Last_Contact: last || null, Since: since || null, Role_Notes: notes || null, Contact: null, Person: null }; if (kind === 'c') r.Contact = { id: 'c' + id, name: who }; else if (kind === 'u') r.Person = { id: 'u' + id, name: who }; return r; };
  root.ROLES_DEMO = {
    name: 'Marinette County District Attorney Diversion',
    profile: 'Administrator',
    accounts: {
      mixed: [
        R('1', 'County Contact', 'County', 'Elena Brandt', 'c', '2026-10-09', '2024-03-01'),
        R('2', 'Billing Contact', 'County', 'Tom Huynh', 'c', '2026-08-21', '2024-03-01'),
        R('3', 'Program Relationship Lead', 'Internal', 'Priya Nair', 'u', null, '2025-01-15'),
        R('4', 'CRM Owner', 'Internal', 'Beau Carrigan', 'u', null, '2025-01-15'),
        R('5', 'Funding Liaison', 'County', 'Gail Ostrowski', 'c', '2026-09-30', null)
      ],
      full: [
        R('1', 'County Contact', 'County', 'Elena Brandt', 'c', '2026-10-09'), R('2', 'Contract Authority', 'County', 'Judge Ruiz', 'c', '2026-06-02'),
        R('3', 'Billing Contact', 'County', 'Tom Huynh', 'c', '2026-08-21'), R('4', 'Customer Stakeholder', 'County', 'Sheriff Dalton', 'c', '2026-07-11'),
        R('5', 'Program Relationship Lead', 'Internal', 'Priya Nair', 'u', null, '2025-01-15'), R('6', 'CRM Owner', 'Internal', 'Beau Carrigan', 'u', null, '2025-01-15')
      ],
      empty: [],
      many: [
        R('1', 'County Contact', 'County', 'Elena Brandt', 'c', '2026-10-09'), R('2', 'County Contact', 'County', 'Marcus Webb', 'c', '2026-09-01'),
        R('3', 'Contract Authority', 'County', 'Judge Ruiz', 'c', null), R('4', 'Billing Contact', 'County', 'Tom Huynh', 'c', null),
        R('5', 'Customer Stakeholder', 'County', 'Sheriff Dalton', 'c', null), R('6', 'Program Relationship Lead', 'Internal', 'Priya Nair', 'u'), R('7', 'CRM Owner', 'Internal', 'Beau Carrigan', 'u')
      ]
    }
  };
})(typeof window !== 'undefined' ? window : this);
