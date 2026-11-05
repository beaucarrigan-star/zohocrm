/* jpk-s11d.js v1.0.3 (S66, cohesion plan Phase 11d, mockup board 5, decision N, 2 Nov 2026). Processes tab only.
   Adds "Ownership Settings" at the end of the Processes menu: who owns new Cases, Deals, Deliverables and Compliance Items.
   - Rules table (Ownership Rules), module chips, Active switch, Edit (inline form), + Add rule. Admin edits; others read only.
   - Round-robin members are edited here (RR Members field, read by ownership_owner_from_rule v2).
   - Test a record: pick module, pipeline, case category and account; shows which rule fires and who gets it.
     Computed in the page (resolveOwner's own order), so testing never moves the round-robin pointer.
   - Re-run on existing (Cases, Deals): lists open records whose owner the rules would change, then, after you confirm,
     runs ownership_rerun on them in batches of 25. Records already with one of their round-robin's members are left
     alone; Personal-queue mail and cases sent to Leadership are never touched.
   - Every edit writes one CRM Changes row (decision S). The last change shows at the bottom.
   Live data only; preview (no SDK, ?demo=1) shows labelled sample rules and writes nothing. Off switch: ?s11d=0.
   v1.0.1 (2 Nov, after upload): RR Members read and written through the linking module Ownership_Rules_X_Users (the widget's
   record API doesn't return multi-user fields); blank members fall back to the built-in groups, like the function.
   v1.0.2: first open waits for Zoho to connect the page (records.js PageLoad) before reading; the first live view was blank
   or read only until Refresh (v1.0.3 waits for the signed-in name; v1.0.2 only waited 1.5 s);
   only Ownership Settings is marked current in the menu. */
(function (root) {
  'use strict';
  var VERSION = '1.0.3';
  var RERUN_FN = 'ownership_rerun';
  var LINK = 'Ownership_Rules_X_Users', LINK_RULE = 'userlookup221_23';
  var MODS = ['Cases', 'Deals', 'Deliverables', 'Compliance_Items'];
  var MODLABEL = { Cases: 'Cases', Deals: 'Deals', Deliverables: 'Deliverables', Compliance_Items: 'Compliance Items', Customer_Onboarding: 'Customer Onboarding' };
  var PIPES = ['Any', 'JusticePoint EM', 'JusticePoint Programs', 'Sirona Programs', 'TDP Pipeline'];
  var CATS = ['Any', 'Device Issue', 'Lost Equipment', 'Order Device(s)', 'Supplies and Straps', 'Enrollment or Removal', 'Alerts and Violations', 'Billing Question', 'Training Request', 'Portal or Software', 'Inventory Request', 'Other', 'DOC Service Request'];
  var CATLABEL = { 'Device Issue': 'Device Troubleshooting', 'Supplies and Straps': 'Order Supplies', 'Inventory Request': 'Inventory Reconciliation' };
  var CATMAP = { 'Device Troubleshooting': 'Device Issue', 'Order Supplies': 'Supplies and Straps', 'Inventory Reconciliation': 'Inventory Request' };
  var OTYPES = ['User', 'Round-robin group', 'Account CRM Owner'];
  var GROUPS = ['EM Support', 'Business Development', 'PDEC', 'Leadership'];

  /* ---------------- model (pure; tested in node) ---------------- */
  function any(v) { return v == null || v === '' || v === 'Any' || v === '-None-'; }
  function catValue(c) { return CATMAP[c] || c || ''; }
  function sortRules(rules) {
    return (rules || []).slice().sort(function (a, b) {
      var ma = MODS.indexOf(a.Applies_To), mb = MODS.indexOf(b.Applies_To);
      return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb) || (a.Is_Default ? 1 : 0) - (b.Is_Default ? 1 : 0) || (+a.Priority || 9999) - (+b.Priority || 9999) || (a.Name < b.Name ? -1 : 1);
    });
  }
  /* the built-in groups ownership_owner_from_rule v2 falls back to when a rule's RR Members is blank */
  var BUILTIN = { 'EM Support': ['6715134000001952001', '6715134000001952003'], 'Business Development': ['6715134000001216001'], 'PDEC': ['6715134000003334001'], 'Leadership': ['6715134000000774001', '6715134000000779001', '6715134000000781001'] };
  function members(rule) { var m = (rule.members || []).map(String); if (!m.length && rule.RR_Group && BUILTIN[rule.RR_Group]) m = BUILTIN[rule.RR_Group].slice(); return m.slice().sort(); }
  /* who a rule hands the record to, without moving the pointer: {type, id, ids} */
  function ruleOwner(rule, accountRoles, accountId) {
    var t = rule.Owner_Type;
    if (t === 'User') return rule.ownerUserId ? { type: 'user', id: rule.ownerUserId } : null;
    if (t === 'Account CRM Owner') { var p = accountId && accountRoles ? accountRoles[accountId] : ''; return p ? { type: 'role', id: p } : null; }
    if (t === 'Round-robin group') {
      var m = members(rule); if (!m.length) return null;
      var i = m.indexOf(String(rule.lastAssignedId || ''));
      return { type: 'rr', id: m[i >= 0 ? (i + 1) % m.length : 0], ids: m };
    }
    return null;
  }
  /* resolveOwner's order: Account Roles CRM Owner, then active non-default rules by priority (first full match), then the default */
  function decide(rules, rec, accountRoles) {
    var mod = rec.module, acc = rec.accountId || '', pipe = rec.pipeline || '', cat = catValue(rec.category);
    if (acc && accountRoles && accountRoles[acc]) return { by: 'Account Roles: CRM Owner', owner: { type: 'role', id: accountRoles[acc] }, rule: null };
    var act = (rules || []).filter(function (r) { return r.Applies_To === mod && r.Active; });
    var nd = act.filter(function (r) { return !r.Is_Default; }).sort(function (a, b) { return (+a.Priority || 9999) - (+b.Priority || 9999) || (String(a.id) < String(b.id) ? -1 : 1); });
    for (var i = 0; i < nd.length; i++) {
      var r = nd[i];
      if (!any(r.Pipeline_Entity) && r.Pipeline_Entity !== pipe) continue;
      if (!any(r.Case_Category) && catValue(r.Case_Category) !== cat) continue;
      if (r.matchAccountId && r.matchAccountId !== acc) continue;
      var o = ruleOwner(r, accountRoles, acc); if (o) return { by: r.Name, owner: o, rule: r };
    }
    var d = act.filter(function (r) { return r.Is_Default; })[0];
    if (d) { var od = ruleOwner(d, accountRoles, acc); if (od) return { by: d.Name + ' (default)', owner: od, rule: d }; }
    return null;
  }
  /* does the record's current owner already satisfy the decision? round-robin: any member is fine */
  function needsMove(dec, ownerId) {
    if (!dec) return false;
    if (dec.owner.type === 'rr') return dec.owner.ids.indexOf(String(ownerId || '')) < 0;
    return String(dec.owner.id) !== String(ownerId || '');
  }
  function rerunList(records, rules, accountRoles) {
    return (records || []).filter(function (r) {
      if (r.module === 'Cases' && (r.Queue === 'Personal' || r.Handling_Team === 'Leadership')) return false;
      if (/\(do not use\)/i.test(r.name || '')) return false;
      return needsMove(decide(rules, r, accountRoles), r.ownerId);
    });
  }
  function validate(f, rules) {
    var errs = [];
    if (!String(f.Name || '').trim()) errs.push('Give the rule a name.');
    if (MODS.indexOf(f.Applies_To) < 0 && f.Applies_To !== 'Customer_Onboarding') errs.push('Pick what the rule applies to.');
    if (!(+f.Priority >= 1)) errs.push('Priority must be a whole number of 1 or more (lower runs first).');
    if (f.Owner_Type === 'User' && !f.ownerUserId) errs.push('Pick the owner.');
    if (f.Owner_Type === 'Round-robin group' && !(f.members || []).length) errs.push('Pick at least one round-robin member.');
    if (f.Is_Default && f.Active && (rules || []).some(function (r) { return r.id !== f.id && r.Is_Default && r.Active && r.Applies_To === f.Applies_To; })) errs.push('There is already an active default for ' + (MODLABEL[f.Applies_To] || f.Applies_To) + '.');
    return errs;
  }
  var model = { sortRules: sortRules, ruleOwner: ruleOwner, decide: decide, needsMove: needsMove, rerunList: rerunList, validate: validate, catValue: catValue, VERSION: VERSION };
  if (typeof module !== 'undefined' && module.exports) { module.exports = model; return; }
  if (/[?&]s11d=0\b/.test(root.location.search)) return;

  /* ---------------- page ---------------- */
  var doc = root.document, html = doc.documentElement, KEY = 'jpk-s11d-open';
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function live() { var Z = root.ZOHO; return !/[?&](demo|preview)=1/.test(root.location.search) && !!(Z && Z.CRM && Z.CRM.API); }
  function timeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]); }
  function store(v) { try { root.localStorage.setItem(KEY, v); } catch (e) {} }
  function stored() { try { return root.localStorage.getItem(KEY); } catch (e) { return null; } }
  function errText(e) { if (!e) return 'unknown error'; if (e.message) return e.message; try { var d = e.data && e.data[0]; if (d) return (d.message || d.code) + (d.details && d.details.api_name ? ' (' + d.details.api_name + ')' : ''); } catch (x) {} return e.code || String(e); }
  function coql(q) {
    return timeout(root.ZOHO.CRM.API.coql({ select_query: q }), 20000).then(function (r) { return (r && r.data) || []; },
      function (e) { if (!e || e.status === 204 || e.code === 'NO_CONTENT' || e === '') return []; throw e; });
  }
  function coqlAll(q) {
    var all = [];
    function page(p) { return coql(q + ' limit 200 offset ' + (p * 200)).then(function (rows) { all = all.concat(rows); return rows.length === 200 && p < 9 ? page(p + 1) : all; }); }
    return page(0);
  }
  function lk(v) { return v && typeof v === 'object' ? String(v.id || '') : v ? String(v) : ''; }
  function lkName(v) { return v && typeof v === 'object' ? (v.name || '') : ''; }

  var S = { rules: null, users: [], roles: {}, rolesN: 0, last: null, admin: false, err: null, sample: false, meName: '' };
  var ui = { mod: 'all', edit: null, adding: false, test: null, rerun: null, busy: false, msg: '' };

  function userName(id) { var u = S.users.filter(function (x) { return x.id === String(id); })[0]; return u ? u.name : (id ? 'User ' + id : ''); }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function normRule(r) {
    return { id: String(r.id), Name: r.Name || '', Applies_To: r.Applies_To || '', Pipeline_Entity: r.Pipeline_Entity || 'Any', Case_Category: r.Case_Category || 'Any',
      matchAccountId: lk(r.Match_Account), matchAccountName: lkName(r.Match_Account) || r['Match_Account.Account_Name'] || '',
      Owner_Type: r.Owner_Type || '', ownerUserId: lk(r.Owner_User), RR_Group: r.RR_Group || '', escalateId: lk(r.Escalate_To),
      Priority: r.Priority, Active: !!r.Active, Is_Default: !!r.Is_Default, Last_Run: r.Last_Run || '', Rule_Notes: r.Rule_Notes || '',
      lastAssignedId: lk(r.Last_Assigned), members: (r.RR_Members || []).map(function (m) { return lk(m.RR_Members); }).filter(Boolean) };
  }
  function demo() {
    S.sample = true; S.admin = true; S.meName = 'Sample admin';
    S.users = [{ id: 'u1', name: 'Sample Admin', profile: 'Administrator' }, { id: 'u2', name: 'Support Person A', profile: 'EM Support' }, { id: 'u3', name: 'Support Person B', profile: 'EM Support' }, { id: 'u4', name: 'Sales Person', profile: 'Business Development' }];
    S.roles = {}; S.rolesN = 0;
    S.rules = [
      { id: 'r1', Name: 'Sample: billing cases to admin', Applies_To: 'Cases', Pipeline_Entity: 'Any', Case_Category: 'Billing Question', Owner_Type: 'User', ownerUserId: 'u1', escalateId: 'u1', Priority: 10, Active: true, Is_Default: false, members: [] },
      { id: 'r2', Name: 'Sample: other cases round-robin', Applies_To: 'Cases', Pipeline_Entity: 'Any', Case_Category: 'Any', Owner_Type: 'Round-robin group', RR_Group: 'EM Support', escalateId: 'u1', Priority: 100, Active: true, Is_Default: true, members: ['u2', 'u3'], lastAssignedId: 'u3' },
      { id: 'r3', Name: 'Sample: all deals', Applies_To: 'Deals', Pipeline_Entity: 'Any', Owner_Type: 'User', ownerUserId: 'u4', Priority: 100, Active: true, Is_Default: true, members: [] }
    ];
    S.last = { Summary: 'Sample change (preview)', when: '', who: '' };
    return Promise.resolve();
  }
  function read() {
    if (!live()) return demo();
    S.sample = false;
    var Z = root.ZOHO.CRM;
    var me = timeout(Z.CONFIG.getCurrentUser(), 10000).then(function (r) { var u = r && r.users && r.users[0]; S.meName = u ? (u.full_name || '') : ''; S.admin = !!(u && u.profile && u.profile.name === 'Administrator'); }).catch(function () { S.admin = false; });
    var users = timeout(Z.API.getAllUsers({ Type: 'ActiveUsers' }), 12000).then(function (r) {
      S.users = ((r && r.users) || []).map(function (u) { return { id: String(u.id), name: u.full_name || '', profile: (u.profile && u.profile.name) || '' }; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    }).catch(function () { S.users = []; });
    var rules = coqlAll("select id, Name, Applies_To, Pipeline_Entity, Case_Category, Match_Account, Match_Account.Account_Name, Owner_Type, Owner_User, RR_Group, Escalate_To, Priority, Active, Is_Default, Last_Run, Rule_Notes, Last_Assigned from Ownership_Rules where id is not null order by Priority asc").then(function (rows) {
      var R = rows.map(normRule);
      /* RR Members is a multi-user field; its rows live in the linking module Ownership_Rules_X_Users (rule = userlookup221_23) */
      return coqlAll("select id, " + LINK_RULE + ", RR_Members from " + LINK + " where id is not null").then(function (links) {
        var by = {}; R.forEach(function (r) { by[r.id] = r; r.members = []; r.links = {}; });
        links.forEach(function (x) { var r = by[lk(x[LINK_RULE])], u = lk(x.RR_Members); if (r && u) { r.members.push(u); r.links[u] = String(x.id); } });
        S.rules = R;
      }, function () { S.rules = R; S.membersErr = true; });
    });
    var roles = coqlAll("select id, Account.id, Person, Role_Status from Account_Roles where Role = 'CRM Owner'").then(function (rows) {
      var m = {}, n = 0; rows.forEach(function (r) { if (r.Role_Status === 'Ended') return; var a = String(r['Account.id'] || lk(r.Account)), p = lk(r.Person); if (a && p && !m[a]) { m[a] = p; n++; } }); S.roles = m; S.rolesN = n;
    }).catch(function () { S.roles = {}; S.rolesN = 0; });
    var last = coql("select Name, Summary, Created_Time, Created_By from CRM_Changes where Name like 'Owner%' order by Created_Time desc limit 1").then(function (rows) {
      var r = rows[0]; S.last = r ? { Summary: r.Summary || r.Name, when: r.Created_Time, who: lkName(r.Created_By) } : null;
    }).catch(function () { S.last = null; });
    return Promise.all([me, users, rules, roles, last]);
  }
  function load() {
    loading = true; S.err = null; paint();
    return read().then(function () {}, function (e) { S.err = errText(e); }).then(function () { loading = false; paint(); });
  }

  /* ---------- writes ---------- */
  function apiData(f) {
    var d = { Name: f.Name, Applies_To: f.Applies_To, Pipeline_Entity: f.Pipeline_Entity || 'Any', Case_Category: f.Applies_To === 'Cases' ? (f.Case_Category || 'Any') : null,
      Owner_Type: f.Owner_Type, Owner_User: f.Owner_Type === 'User' && f.ownerUserId ? { id: f.ownerUserId } : null,
      RR_Group: f.Owner_Type === 'Round-robin group' ? (f.RR_Group || null) : null, Escalate_To: f.escalateId ? { id: f.escalateId } : null,
      Priority: +f.Priority, Active: !!f.Active, Is_Default: !!f.Is_Default, Rule_Notes: f.Rule_Notes || '' };
    return d;
  }
  function logChange(summary) {
    if (!live()) return Promise.resolve();
    var row = { Name: 'Ownership rule: ' + summary.slice(0, 90), Change_Date: new Date().toISOString().slice(0, 10), Area: 'Other', Component: 'Ownership Rules', Status: 'Live',
      Who_Notices: ['Nobody (internal)'], Summary: summary + ' (' + (S.meName || 'admin') + ', Processes > Ownership Settings)' };
    return root.ZOHO.CRM.API.insertRecord({ Entity: 'CRM_Changes', APIData: row, Trigger: [] }).catch(function () {});
  }
  function okResp(r) { var d = r && r.data && r.data[0]; if (!d || String(d.code).toUpperCase() !== 'SUCCESS') throw { data: [d || { message: 'No answer' }] }; return d; }
  function save(f) {
    var errs = validate(f, S.rules); if (errs.length) return Promise.reject(new Error(errs.join(' ')));
    if (!live()) { if (f.id) S.rules = S.rules.map(function (r) { return r.id === f.id ? f : r; }); else { f.id = 'n' + Date.now(); S.rules.push(f); } return Promise.resolve(); }
    var Z = root.ZOHO.CRM.API, d = apiData(f);
    if (f.id) { d.id = f.id; return Z.updateRecord({ Entity: 'Ownership_Rules', APIData: d, Trigger: [] }).then(okResp).then(function () { return syncMembers(f.id, f); }).then(function () { return logChange('Edited "' + f.Name + '" (' + MODLABEL[f.Applies_To] + ', priority ' + f.Priority + ', ' + ownerWords(f) + (f.Active ? '' : ', inactive') + ')'); }); }
    return Z.insertRecord({ Entity: 'Ownership_Rules', APIData: d, Trigger: [] }).then(okResp).then(function (res) { return syncMembers(String(res.details && res.details.id || ''), f); }).then(function () { return logChange('Added "' + f.Name + '" (' + MODLABEL[f.Applies_To] + ', priority ' + f.Priority + ', ' + ownerWords(f) + ')'); });
  }
  /* round-robin members: add and remove rows in the linking module (only for round-robin rules; other types keep theirs untouched) */
  function syncMembers(ruleId, f) {
    if (!ruleId || f.Owner_Type !== 'Round-robin group') return Promise.resolve();
    var Z = root.ZOHO.CRM.API, links = f.links || {}, want = f.members || [];
    var add = want.filter(function (u) { return !links[u]; }), del = Object.keys(links).filter(function (u) { return want.indexOf(u) < 0; });
    return Promise.all(add.map(function (u) { var row = { RR_Members: { id: u } }; row[LINK_RULE] = { id: ruleId }; return Z.insertRecord({ Entity: LINK, APIData: row, Trigger: [] }).then(okResp); })
      .concat(del.map(function (u) { return Z.deleteRecord({ Entity: LINK, RecordID: links[u] }); })));
  }
  function setActive(r, on) {
    var f = {}; for (var k in r) f[k] = r[k]; f.Active = on;
    var errs = validate(f, S.rules); if (errs.length) return Promise.reject(new Error(errs.join(' ')));
    if (!live()) { r.Active = on; return Promise.resolve(); }
    return root.ZOHO.CRM.API.updateRecord({ Entity: 'Ownership_Rules', APIData: { id: r.id, Active: on }, Trigger: [] }).then(okResp).then(function () { return logChange((on ? 'Switched on' : 'Switched off') + ' "' + r.Name + '"'); });
  }
  function ownerWords(r) {
    if (r.Owner_Type === 'User') return userName(r.ownerUserId) || 'no owner set';
    if (r.Owner_Type === 'Round-robin group') return 'round-robin: ' + (members(r).map(userName).join(', ') || (r.RR_Group ? r.RR_Group + ' (built-in list)' : 'nobody'));
    if (r.Owner_Type === 'Account CRM Owner') return "the account's CRM Owner";
    return '—';
  }

  /* ---------- test and re-run ---------- */
  function searchAccounts(q) {
    if (!live()) return Promise.resolve([{ id: 'a1', name: 'Sample County Sheriff' }]);
    var s = q.replace(/'/g, "\\'");
    return coql("select id, Account_Name from Accounts where Account_Name like '%" + s + "%' limit 8").then(function (rows) { return rows.map(function (r) { return { id: String(r.id), name: r.Account_Name }; }); });
  }
  var OPENQ = {
    Cases: "select id, Subject, Owner.id, Account_Name.id, Case_Category, Queue, Handling_Team from Cases where Status not in ('Closed','Resolved')",
    Deals: "select id, Deal_Name, Owner.id, Account_Name.id, Pipeline from Deals where Stage_Group in ('Early','Working')"
  };
  function openRecords(mod) {
    if (!live()) return Promise.resolve([{ module: mod, id: 'x1', name: 'Sample record owned by admin', ownerId: 'u1', accountId: '', pipeline: 'JusticePoint EM', category: 'Device Troubleshooting' }]);
    return coqlAll(OPENQ[mod]).then(function (rows) {
      return rows.map(function (r) { return { module: mod, id: String(r.id), name: r.Subject || r.Deal_Name || '', ownerId: String(r['Owner.id'] || lk(r.Owner)), accountId: String(r['Account_Name.id'] || ''),
        pipeline: r.Pipeline && typeof r.Pipeline === 'object' ? r.Pipeline.name : (r.Pipeline || ''), category: r.Case_Category || '', Queue: r.Queue || '', Handling_Team: r.Handling_Team || '' }; });
    });
  }
  function runRerun(mod, ids) {
    var out = { moved: 0, kept: 0, no_rule: 0, failed: 0 }, batches = [];
    for (var i = 0; i < ids.length; i += 25) batches.push(ids.slice(i, i + 25));
    if (!live()) { out.moved = ids.length; return Promise.resolve(out); }
    return batches.reduce(function (p, b) {
      return p.then(function () {
        return timeout(root.ZOHO.CRM.FUNCTIONS.execute(RERUN_FN, { arguments: JSON.stringify({ moduleName: mod, recordIds: b.join(',') }) }), 120000).then(function (res) {
          if (res && res.code && String(res.code).toLowerCase() !== 'success') throw new Error(res.message || res.code);
          var o = String((res && res.details && res.details.output) || '');
          if (/^Refused/.test(o)) throw new Error(o);
          var m; try { m = JSON.parse(o); } catch (e) { throw new Error(o || 'No answer from ' + RERUN_FN + '.'); }
          ['moved', 'kept', 'no_rule', 'failed'].forEach(function (k) { out[k] += +m[k] || 0; });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  /* ---------- paint ---------- */
  function opt(v, cur, label) { return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label == null ? v : label) + '</option>'; }
  function userOpts(cur, blank) { return (blank ? opt('', cur, blank) : '') + S.users.map(function (u) { return opt(u.id, cur, u.name + (u.profile ? ' · ' + u.profile : '')); }).join(''); }
  function formHtml(f, isNew) {
    var cases = f.Applies_To === 'Cases', rr = f.Owner_Type === 'Round-robin group', us = f.Owner_Type === 'User';
    return '<form class="s11d-form" data-s11d-form="' + esc(f.id || 'new') + '" novalidate>' +
      '<div class="s11d-grid">' +
      '<label class="s11d-wide">Rule name<input name="Name" value="' + esc(f.Name) + '" required maxlength="120"></label>' +
      '<label>Applies to<select name="Applies_To"' + (isNew ? '' : ' disabled') + '>' + MODS.map(function (m) { return opt(m, f.Applies_To, MODLABEL[m]); }).join('') + '</select></label>' +
      '<label>Priority <span class="s11d-hint">lower runs first</span><input name="Priority" type="number" min="1" step="1" value="' + esc(f.Priority || '') + '"></label>' +
      '<label>Pipeline / entity<select name="Pipeline_Entity">' + PIPES.map(function (p) { return opt(p, f.Pipeline_Entity || 'Any'); }).join('') + '</select></label>' +
      (cases ? '<label>Case category<select name="Case_Category">' + CATS.map(function (c) { return opt(c, f.Case_Category || 'Any', CATLABEL[c] || c); }).join('') + '</select></label>' : '') +
      '<label>Owner type<select name="Owner_Type">' + OTYPES.map(function (t) { return opt(t, f.Owner_Type); }).join('') + '</select></label>' +
      (us ? '<label>Owner<select name="ownerUserId">' + userOpts(f.ownerUserId, 'Pick a person') + '</select></label>' : '') +
      (rr ? '<fieldset class="s11d-wide s11d-mem"><legend>Round-robin members <span class="s11d-hint">they take turns, in a fixed order</span></legend>' +
        S.users.map(function (u) { return '<label class="s11d-chk"><input type="checkbox" name="members" value="' + esc(u.id) + '"' + ((f.members || []).indexOf(u.id) >= 0 ? ' checked' : '') + '> ' + esc(u.name) + '</label>'; }).join('') +
        '<label class="s11d-grp">Group label<select name="RR_Group">' + opt('', f.RR_Group, '—') + GROUPS.map(function (g) { return opt(g, f.RR_Group); }).join('') + '</select></label></fieldset>' : '') +
      (f.Owner_Type === 'Account CRM Owner' ? '<p class="s11d-wide s11d-note">Goes to the person named as CRM Owner in the account\'s Account Roles. If the account has none, the next rule decides.</p>' : '') +
      '<label>Escalate to<select name="escalateId">' + userOpts(f.escalateId, 'Nobody (Beau by default)') + '</select></label>' +
      (f.matchAccountName ? '<p class="s11d-note">Only for account: <b>' + esc(f.matchAccountName) + '</b> (change the account in the record itself).</p>' : '') +
      '<label class="s11d-chk"><input type="checkbox" name="Active"' + (f.Active ? ' checked' : '') + '> Active</label>' +
      '<label class="s11d-chk"><input type="checkbox" name="Is_Default"' + (f.Is_Default ? ' checked' : '') + '> Default for this module (catches everything the rules above miss)</label>' +
      '<label class="s11d-wide">Why this rule exists<textarea name="Rule_Notes" rows="2" maxlength="1900">' + esc(f.Rule_Notes) + '</textarea></label>' +
      '</div><p class="s11d-err" role="alert" hidden></p><div class="s11d-acts"><button type="submit" class="s11d-btn pri">' + (isNew ? 'Add rule' : 'Save') + '</button><button type="button" class="s11d-btn" data-s11d-cancel>Cancel</button></div></form>';
  }
  function readForm(form, base) {
    var f = {}; for (var k in base) f[k] = base[k];
    var g = function (n) { var el = form.elements[n]; return el ? el.value : undefined; };
    ['Name', 'Applies_To', 'Pipeline_Entity', 'Case_Category', 'Owner_Type', 'ownerUserId', 'RR_Group', 'escalateId', 'Rule_Notes'].forEach(function (n) { var v = g(n); if (v !== undefined) f[n] = v; });
    var p = g('Priority'); if (p !== undefined) f.Priority = p === '' ? '' : Math.round(+p);
    f.Active = !!(form.elements.Active && form.elements.Active.checked); f.Is_Default = !!(form.elements.Is_Default && form.elements.Is_Default.checked);
    if (form.querySelector('[name=members]')) f.members = Array.prototype.filter.call(form.querySelectorAll('[name=members]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    return f;
  }
  function ownerCell(r) {
    if (r.Owner_Type === 'Round-robin group') {
      var m = members(r);
      return '<span class="s11d-rr">Round-robin' + (r.RR_Group ? ': ' + esc(r.RR_Group) : '') + '</span><span class="s11d-sub">' + (m.length ? m.map(function (id) { return esc(userName(id)) + (id === r.lastAssignedId ? ' <i>(last)</i>' : ''); }).join(', ') + ((r.members || []).length ? '' : ' (built-in list)') : 'nobody: pick members') + '</span>';
    }
    if (r.Owner_Type === 'User') return r.ownerUserId ? '<span class="s11d-av" aria-hidden="true">' + esc(initials(userName(r.ownerUserId))) + '</span>' + esc(userName(r.ownerUserId)) : '<span class="s11d-bad">No owner set</span>';
    if (r.Owner_Type === 'Account CRM Owner') return "Account's CRM Owner";
    return '—';
  }
  function paint() {
    var el = $('s11d-pane'); if (!el) return;
    var body = el.querySelector('.s11d-body');
    if (S.err) { body.innerHTML = '<p class="s11d-err" role="alert">Ownership Rules could not be read (' + esc(S.err) + ').</p>'; return; }
    if (!S.rules) { body.innerHTML = '<p class="s11d-none" aria-busy="true">Loading the rules…</p>'; return; }
    var R = sortRules(S.rules).filter(function (r) { return ui.mod === 'all' || r.Applies_To === ui.mod; });
    var ro = !S.admin;
    var chips = '<div class="s11d-chips" role="group" aria-label="Module">' + ['all'].concat(MODS).map(function (m) {
      var n = m === 'all' ? S.rules.length : S.rules.filter(function (r) { return r.Applies_To === m; }).length;
      return '<button type="button" data-s11d-mod="' + m + '" aria-pressed="' + (ui.mod === m) + '">' + esc(m === 'all' ? 'All' : MODLABEL[m]) + ' <span>' + n + '</span></button>';
    }).join('') + '</div>' +
      '<p class="s11d-over">Account overrides (Account Roles, CRM Owner): <b>' + S.rolesN + ' active</b> · always win over the rules below.</p>';
    var rows = R.map(function (r) {
      if (ui.edit === r.id) return '<tr class="s11d-editrow"><td colspan="9">' + formHtml(r, false) + '</td></tr>';
      return '<tr class="' + (r.Active ? '' : 'off') + '"><td class="s11d-num">' + esc(r.Priority) + '</td><td><b>' + esc(MODLABEL[r.Applies_To] || r.Applies_To) + '</b>' + (r.Is_Default ? ' <span class="s11d-tag">default</span>' : '') + '<span class="s11d-sub">' + esc(r.Name) + '</span></td>' +
        '<td>' + esc(any(r.Pipeline_Entity) ? 'Any' : r.Pipeline_Entity) + '</td><td>' + esc(r.Applies_To !== 'Cases' ? '—' : any(r.Case_Category) ? 'Any' : (CATLABEL[r.Case_Category] || r.Case_Category)) + '</td>' +
        '<td>' + esc(r.matchAccountName || 'Any') + '</td><td class="s11d-own">' + ownerCell(r) + '</td><td>' + esc(userName(r.escalateId) || '—') + '</td>' +
        '<td><label class="s11d-sw"><input type="checkbox" data-s11d-active="' + esc(r.id) + '"' + (r.Active ? ' checked' : '') + (ro ? ' disabled' : '') + '><span>' + (r.Active ? 'On' : 'Off') + '</span></label></td>' +
        '<td>' + (ro ? '' : '<button type="button" class="s11d-btn sm" data-s11d-edit="' + esc(r.id) + '" aria-label="Edit ' + esc(r.Name) + '">Edit</button>') + '</td></tr>';
    }).join('');
    var table = '<div class="s11d-tw"><table class="s11d-t"><caption class="s11d-vh">Ownership rules, run top to bottom by priority</caption><thead><tr><th scope="col">Pri.</th><th scope="col">Applies to</th><th scope="col">Pipeline</th><th scope="col">Case category</th><th scope="col">Account</th><th scope="col">Owner</th><th scope="col">Escalate to</th><th scope="col">Active</th><th scope="col"><span class="s11d-vh">Edit</span></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9" class="s11d-none">No rules for this module.</td></tr>') + '</tbody></table></div>';
    var add = ro ? '' : (ui.adding ? '<div class="s11d-addbox">' + formHtml({ Name: '', Applies_To: ui.mod !== 'all' ? ui.mod : 'Cases', Pipeline_Entity: 'Any', Case_Category: 'Any', Owner_Type: 'User', Priority: '', Active: true, Is_Default: false, members: [] }, true) + '</div>' : '');
    /* test */
    var t = ui.test || { module: 'Cases', pipeline: 'Any', category: 'Any', account: null };
    var dec = t.result;
    var test = '<section class="s11d-box" aria-labelledby="s11d-test-h"><h2 id="s11d-test-h">Test a record</h2><p class="s11d-sub">Pick what a new record would look like. Nothing is saved and the round-robin turn does not move.</p>' +
      '<form class="s11d-testf" data-s11d-test novalidate><label>Module<select name="module">' + MODS.map(function (m) { return opt(m, t.module, MODLABEL[m]); }).join('') + '</select></label>' +
      '<label>Pipeline<select name="pipeline">' + PIPES.map(function (p) { return opt(p, t.pipeline); }).join('') + '</select></label>' +
      (t.module === 'Cases' ? '<label>Case category<select name="category">' + CATS.map(function (c) { return opt(CATLABEL[c] || c, t.category, CATLABEL[c] || c); }).join('') + '</select></label>' : '') +
      '<label>Account<input name="acct" list="s11d-acct-list" autocomplete="off" placeholder="Optional: type 3 letters" value="' + esc(t.account ? t.account.name : '') + '"><datalist id="s11d-acct-list"></datalist></label>' +
      '<button type="submit" class="s11d-btn pri">Test</button></form>' +
      (t.ran ? '<p class="s11d-result" role="status">' + (dec ? '<b>' + esc(dec.owner.type === 'rr' ? userName(dec.owner.id) + ' (next in the round-robin: ' + dec.owner.ids.map(userName).join(', ') + ')' : userName(dec.owner.id)) + '</b> · by ' + esc(dec.by) +
        (dec.rule && dec.rule.escalateId ? ' · escalates to ' + esc(userName(dec.rule.escalateId)) + ' after SLA' : '') : 'No rule decides: the record would stay with whoever created it.') + '</p>' : '') + '</section>';
    /* re-run */
    var rr = ui.rerun || { module: 'Cases' };
    var re = '<section class="s11d-box" aria-labelledby="s11d-re-h"><h2 id="s11d-re-h">Re-run on existing</h2><p class="s11d-sub">Finds open records whose owner the rules would change. Round-robin records already with one of their members are left alone; Personal-queue mail and cases sent to Leadership are never touched.</p>' +
      '<div class="s11d-testf"><label>Module<select data-s11d-re-mod><option value="Cases"' + (rr.module === 'Cases' ? ' selected' : '') + '>Cases</option><option value="Deals"' + (rr.module === 'Deals' ? ' selected' : '') + '>Deals</option></select></label>' +
      '<button type="button" class="s11d-btn" data-s11d-re-find' + (ro ? ' disabled' : '') + '>Find records to move</button></div>' +
      (rr.list ? (rr.list.length ? '<p class="s11d-result">' + rr.list.length + ' open ' + esc(MODLABEL[rr.module].toLowerCase()) + ' would change owner (of ' + rr.total + ' open):</p><ul class="s11d-l">' + rr.list.slice(0, 15).map(function (x) {
        var d = decide(S.rules, x, S.roles); return '<li>' + esc(x.name || x.id) + ' <span class="s11d-sub">' + esc(userName(x.ownerId)) + ' → ' + esc(d.owner.type === 'rr' ? 'round-robin (' + d.owner.ids.map(userName).join(', ') + ')' : userName(d.owner.id)) + ' · ' + esc(d.by) + '</span></li>';
      }).join('') + '</ul>' + (rr.list.length > 15 ? '<p class="s11d-sub">+ ' + (rr.list.length - 15) + ' more</p>' : '') +
        (rr.confirm ? '<p class="s11d-warn">Move ' + rr.list.length + ' record' + (rr.list.length === 1 ? '' : 's') + ' now? Each move writes a CRM Changes row.</p><div class="s11d-acts"><button type="button" class="s11d-btn pri" data-s11d-re-go>Yes, move them</button><button type="button" class="s11d-btn" data-s11d-re-cancel>Cancel</button></div>'
          : '<button type="button" class="s11d-btn pri" data-s11d-re-ask>Re-run ' + rr.list.length + '</button>')
        : '<p class="s11d-result">Every open ' + esc(MODLABEL[rr.module].toLowerCase().replace(/s$/, '')) + ' already sits with its rule\'s owner (' + rr.total + ' checked).</p>') : '') +
      (rr.done ? '<p class="s11d-result" role="status">Done: ' + rr.done.moved + ' moved, ' + rr.done.kept + ' already right' + (rr.done.no_rule ? ', ' + rr.done.no_rule + ' with no rule' : '') + (rr.done.failed ? ', ' + rr.done.failed + ' failed (see the function log)' : '') + '.</p>' : '') +
      (rr.err ? '<p class="s11d-err" role="alert">' + esc(rr.err) + '</p>' : '') + '</section>';
    var last = S.last ? '<p class="s11d-last"><b>Last change:</b> ' + esc(S.last.Summary) + (S.last.when ? ' · ' + esc(new Date(S.last.when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : '') + (S.last.who ? ' · ' + esc(S.last.who) : '') + ' · logged to CRM Changes</p>' : '';
    body.innerHTML = (ro ? '<p class="s11d-warn">Read only: only an Administrator can change these rules.</p>' : '') + (ui.msg ? '<p class="s11d-ok" role="status">' + esc(ui.msg) + '</p>' : '') + chips + table + add + '<div class="s11d-two">' + test + re + '</div>' + last +
      '<p class="s11d-foot">Rules run on every new record and when a record\'s account changes. Changing a rule here affects the next record at once; use Re-run for records that already exist.</p>';
    var addBtn = el.querySelector('[data-s11d-add]'); if (addBtn) addBtn.hidden = ro || ui.adding;
    el.querySelector('.s11d-stamp').textContent = S.sample ? 'Sample rules (preview)' : S.rules.length + ' rules';
  }
  function flash(m) { ui.msg = m; paint(); setTimeout(function () { if (ui.msg === m) { ui.msg = ''; paint(); } }, 4000); }
  function onSubmit(e) {
    var form = e.target; if (!form.matches) return;
    if (form.matches('[data-s11d-form]')) {
      e.preventDefault();
      var id = form.getAttribute('data-s11d-form'), base = id === 'new' ? { members: [] } : S.rules.filter(function (r) { return r.id === id; })[0];
      var f = readForm(form, base), errEl = form.querySelector('.s11d-err'), btn = form.querySelector('[type=submit]');
      var errs = validate(f, S.rules); if (errs.length) { errEl.textContent = errs.join(' '); errEl.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      save(f).then(function () { ui.edit = null; ui.adding = false; return live() ? read() : null; }).then(function () { flash('Saved. The next new record uses it.'); }, function (er) { errEl.textContent = 'Not saved: ' + errText(er); errEl.hidden = false; btn.disabled = false; btn.textContent = id === 'new' ? 'Add rule' : 'Save'; });
    } else if (form.matches('[data-s11d-test]')) {
      e.preventDefault();
      var t = { module: form.elements.module.value, pipeline: form.elements.pipeline.value, category: form.elements.category ? form.elements.category.value : '', account: ui.test && ui.test.account && ui.test.account.name === form.elements.acct.value ? ui.test.account : null };
      var typed = form.elements.acct.value.trim();
      var pick = !typed ? Promise.resolve(null) : t.account ? Promise.resolve(t.account) : searchAccounts(typed).then(function (xs) { return xs.filter(function (x) { return x.name === typed; })[0] || xs[0] || null; });
      pick.then(function (a) { t.account = a; t.result = decide(S.rules, { module: t.module, pipeline: t.pipeline === 'Any' ? '' : t.pipeline, category: t.category === 'Any' ? '' : t.category, accountId: a ? a.id : '' }, S.roles); t.ran = true; ui.test = t; paint(); });
    }
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest('button,input[type=checkbox][data-s11d-active]'); if (!b) return;
    if (b.hasAttribute('data-s11d-mod')) { ui.mod = b.getAttribute('data-s11d-mod'); ui.edit = null; paint(); return; }
    if (b.hasAttribute('data-s11d-edit')) { ui.edit = b.getAttribute('data-s11d-edit'); ui.adding = false; paint(); var f = doc.querySelector('[data-s11d-form="' + ui.edit + '"] input'); if (f) f.focus(); return; }
    if (b.hasAttribute('data-s11d-cancel')) { ui.edit = null; ui.adding = false; paint(); return; }
    if (b.hasAttribute('data-s11d-add')) { ui.adding = true; ui.edit = null; paint(); var n = doc.querySelector('[data-s11d-form="new"] input'); if (n) n.focus(); return; }
    if (b.hasAttribute('data-s11d-refresh')) { load(); return; }
    if (b.hasAttribute('data-s11d-active')) {
      var r = S.rules.filter(function (x) { return x.id === b.getAttribute('data-s11d-active'); })[0], on = b.checked;
      setActive(r, on).then(function () { r.Active = on; flash((on ? 'Switched on: ' : 'Switched off: ') + r.Name); }, function (er) { b.checked = !on; flash('Not changed: ' + errText(er)); });
      return;
    }
    var rr = ui.rerun || (ui.rerun = { module: 'Cases' });
    if (b.hasAttribute('data-s11d-re-find')) {
      var sel = doc.querySelector('[data-s11d-re-mod]'); rr.module = sel ? sel.value : 'Cases'; rr.list = null; rr.done = null; rr.err = null; rr.confirm = false;
      b.disabled = true; b.textContent = 'Checking…';
      openRecords(rr.module).then(function (recs) { rr.total = recs.length; rr.list = rerunList(recs, S.rules, S.roles); paint(); }, function (er) { rr.err = 'Could not read open records: ' + errText(er); paint(); });
      return;
    }
    if (b.hasAttribute('data-s11d-re-ask')) { rr.confirm = true; paint(); return; }
    if (b.hasAttribute('data-s11d-re-cancel')) { rr.confirm = false; paint(); return; }
    if (b.hasAttribute('data-s11d-re-go')) {
      b.disabled = true; b.textContent = 'Moving…';
      runRerun(rr.module, rr.list.map(function (x) { return x.id; })).then(function (o) { rr.done = o; rr.list = null; rr.confirm = false; return live() ? read() : null; }, function (er) { rr.err = 'Stopped: ' + errText(er) + '. Records before the error were moved.'; rr.confirm = false; }).then(paint);
    }
  }
  function onInput(e) {
    var el = e.target; if (!el || el.name !== 'acct') return;
    var v = el.value.trim(), dl = $('s11d-acct-list'); if (v.length < 3 || !dl) return;
    searchAccounts(v).then(function (xs) { dl.innerHTML = xs.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join(''); ui.test = ui.test || { module: 'Cases', pipeline: 'Any', category: 'Any' }; ui.acctCache = xs; var hit = xs.filter(function (x) { return x.name === v; })[0]; if (hit) ui.test.account = hit; });
  }
  function onChange(e) {
    var el = e.target, form = el.form;
    if (form && form.matches('[data-s11d-form]') && (el.name === 'Owner_Type' || el.name === 'Applies_To')) {
      var id = form.getAttribute('data-s11d-form'), base = id === 'new' ? { members: [] } : S.rules.filter(function (r) { return r.id === id; })[0];
      var f = readForm(form, base); var holder = form.parentNode; holder.innerHTML = formHtml(f, id === 'new'); var x = holder.querySelector('[name=' + el.name + ']'); if (x) x.focus();
    }
    if (form && form.matches('[data-s11d-test]') && el.name === 'module') { ui.test = { module: el.value, pipeline: form.elements.pipeline.value, category: 'Any', account: ui.test && ui.test.account }; paint(); }
  }

  /* ---------- mode: Ownership Settings vs the records sections ---------- */
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a6 6 0 0 1 12 0M17 8v6M14 11h6"/></svg>';
  function railBtn() {
    var rail = $('rail'); if (!rail) return null;
    var b = rail.querySelector('[data-s11d]'); if (b) return b;
    if (!rail.querySelector('.swb[data-m]')) return null;
    var me = rail.querySelector('#me');
    var g = doc.createElement('div'); g.className = 'grp s11d-grp'; g.textContent = 'Settings';
    b = doc.createElement('button'); b.type = 'button'; b.className = 'nav swb s11d-rail'; b.setAttribute('data-s11d', 'on');
    b.innerHTML = ICON + '<span class="nl">Ownership Settings</span><span class="cnt"></span>';
    rail.insertBefore(g, me); rail.insertBefore(b, me);
    return b;
  }
  function paneEl() {
    var el = $('s11d-pane'); if (el) return el;
    el = doc.createElement('section'); el.id = 's11d-pane'; el.setAttribute('aria-labelledby', 's11d-title');
    el.innerHTML = '<div class="s11d-top"><div><h1 id="s11d-title">Ownership Settings</h1><p class="s11d-lead">Who owns what. Rules run top to bottom by priority on every new record. Edit a row, then Re-run on existing records if you want them to follow.</p></div>' +
      '<div class="s11d-tools"><button type="button" class="s11d-btn pri" data-s11d-add>+ Add rule</button><button type="button" class="s11d-btn" data-s11d-refresh>Refresh</button></div></div><p class="s11d-stamp"></p><div class="s11d-body"></div>';
    el.addEventListener('click', onClick); el.addEventListener('submit', onSubmit); el.addEventListener('input', onInput); el.addEventListener('change', onChange);
    return el;
  }
  function place() {
    var app = $('app'); if (!app) return false;
    var el = paneEl();
    if (el.parentNode !== app) {
      var after = null; Array.prototype.forEach.call(app.children, function (ch) { if (ch.classList.contains('jpk-back') || ch.id === 'jpk-intro') after = ch; });
      app.insertBefore(el, after ? after.nextSibling : app.firstChild);
    }
    if (!el.querySelector('.s11d-body').firstChild) paint();
    if (on) paintRail();
    return true;
  }
  var on = false, booted = false, loading = false;
  /* Zoho answers API calls only after the page's own PageLoad; records.js then writes the signed-in name in the menu footer.
     Wait for that (or 7 s) before the first read, so the user list and the admin check don't time out. */
  function ready() {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function poll() {
        var me = doc.querySelector('#rail #me .nl');
        if ((me && me.textContent.trim()) || Date.now() - t0 > 7000) return res();
        setTimeout(poll, 200);
      })();
    });
  }
  function paintRail() {
    var rail = $('rail'); if (!rail) return;
    var b = rail.querySelector('[data-s11d]'); if (b) b.setAttribute('aria-current', on ? 'page' : 'false');
    if (on) Array.prototype.forEach.call(rail.querySelectorAll('.swb[data-m]'), function (x) { if (x.getAttribute('aria-current') === 'page') { x.setAttribute('aria-current', 'false'); x.setAttribute('data-s11d-was', '1'); } });
    else Array.prototype.forEach.call(rail.querySelectorAll('.swb[data-s11d-was]'), function (x) { x.removeAttribute('data-s11d-was'); });
  }
  function setMode(b) {
    on = !!b; if (on) html.setAttribute('data-s11d', 'on'); else html.removeAttribute('data-s11d');
    paintRail(); store(on ? '1' : '0');
    if (on) { place(); if (!S.rules && !loading) { if (live() && !booted) ready().then(function () { if (!S.rules && !loading) load(); }); else load(); } try { root.scrollTo(0, 0); } catch (e) {} }
    booted = true;
  }
  var tries = 0;
  function start() {
    var b = railBtn(), app = $('app');
    if (!b || !app) { if (tries++ < 80) setTimeout(start, 150); return; }
    b.addEventListener('click', function () { setMode(true); });
    $('rail').addEventListener('click', function (e) {
      var x = e.target.closest && e.target.closest('.swb[data-m],[data-g]'); if (!x || !on) return;
      var was = x.hasAttribute('data-s11d-was'); setMode(false); if (was) x.setAttribute('aria-current', 'page');
    }, true);
    new MutationObserver(function () { if (on) place(); if (!$('rail').querySelector('[data-s11d]')) { var nb = railBtn(); if (nb) { nb.addEventListener('click', function () { setMode(true); }); paintRail(); } } }).observe(app, { childList: true });
    setMode(stored() === '1' || /[?&]s11d=1\b/.test(root.location.search));
    setTimeout(function () { if (on) paintRail(); }, 1200); setTimeout(function () { if (on) paintRail(); }, 3000);
  }
  root.JPK_S11D = { refresh: load, model: model, version: VERSION, mode: function (b) { setMode(b); } };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
  else setTimeout(start, 0);
})(typeof window !== 'undefined' ? window : this);
