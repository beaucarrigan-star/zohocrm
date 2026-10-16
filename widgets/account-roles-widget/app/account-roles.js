/* Account roles. Reads Account_Roles for one account and shows them with JPK.roleList.
   Writes nothing itself: Add and Change (Administrator only, JPK.model.canEditRoles) open Zoho's own form, so Zoho's
   layout rules and profile permissions still apply. Demo mode (?demo=1 or outside Zoho) opens nothing. */
(function () {
  'use strict';
  var M = window.RolesModel, $ = function (s) { return document.querySelector(s); };
  var S = { demo: false, accountId: '', rows: [], profile: '', list: null };

  function showErr(t) { var e = $('#err'); e.hidden = !t; e.textContent = t || ''; }
  function say(t, bad) { var m = $('#msg'); m.hidden = !t; m.className = 'ar-msg' + (bad ? ' bad' : ''); m.textContent = t || ''; }
  function param(k) { var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }

  function loadProfile() {
    if (S.demo) return Promise.resolve(param('profile') || window.ROLES_DEMO.profile);
    return ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; return (u && u.profile && u.profile.name) || ''; });
  }
  function loadRecords() {
    if (S.demo) { var k = param('account') || 'mixed'; return Promise.resolve(JSON.parse(JSON.stringify(window.ROLES_DEMO.accounts[k] || window.ROLES_DEMO.accounts.mixed))); }
    return JPK.crm.coqlAll(M.coql(S.accountId)).then(function (rows) { return rows; });
  }
  function render() {
    var canEdit = JPK.model.canEditRoles(S.profile);
    var sum = M.summary(S.rows); var s = $('#sum');
    s.textContent = sum.text; s.className = 'ar-sum' + (sum.gaps ? ' gap' : '');
    $('#readonly').hidden = canEdit;
    var opts = { roles: S.rows, canEdit: canEdit, onAdd: onAdd, onEdit: onEdit };
    if (S.list) S.list.setRoles(S.rows); else S.list = JPK.roleList(Object.assign({ mount: '#roles' }, opts));
  }
  function refresh() {
    return loadRecords().then(function (recs) { S.rows = M.buildRows(recs); render(); });
  }
  /* Zoho shows its own form. When it closes we read the list again. */
  function openForm(kind, row) {
    if (S.demo) { say('Demo mode: Zoho\'s form for ' + (kind === 'add' ? 'adding ' : 'changing ') + row.role + ' would open here. Nothing was saved.'); return; }
    say('');
    var p = kind === 'add' && !row.recordId
      ? ZOHO.CRM.UI.Record.create({ Entity: 'Account_Roles', Target: '_blank' })
      : ZOHO.CRM.UI.Record.open({ Entity: 'Account_Roles', RecordID: row.recordId, Target: '_blank' });
    Promise.resolve(p).then(function () { return refresh(); }, function (e) { say('Could not open the form: ' + (e && e.message || e) + '. Open Account Roles from the Accounts page instead.', true); });
  }
  function onAdd(r) { openForm('add', r); }
  function onEdit(r) { openForm('edit', r); }

  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    S.accountId = ctx && ctx.EntityId ? String([].concat(ctx.EntityId)[0]) : '';
    if (S.demo) $('#title').textContent = 'Account roles · ' + window.ROLES_DEMO.name;
    return loadProfile().then(function (p) { S.profile = p; return refresh(); });
  }).catch(function (e) { showErr('Could not load the roles: ' + (e && e.message || e)); });
})();
