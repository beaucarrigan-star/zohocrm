/* Case strip. Shows owner, team, due, waiting on and next action at the top of a case (CRM UI Pattern Rollout Plan, section 3).
   Reads one case and the active users. Writes only these, each after an explicit click:
     Take case  -> Owner = the signed-in user
     Assign     -> Owner = the person picked
     Hand off   -> Owner = the person picked, plus a Note with the one-line reason
   Demo mode (?demo=1 or outside Zoho) never writes. Zoho profiles still decide who can change an owner. */
(function () {
  'use strict';
  var M = window.StripModel, esc = JPK.esc;
  var $ = function (s) { return document.querySelector(s); };
  var S = { demo: false, rec: null, users: [], me: null, strip: null, busy: false, panel: null };

  function showErr(msg) { var e = $('#err'); e.hidden = !msg; e.textContent = msg || ''; }
  function say(text, bad) { var m = $('#msg'); m.hidden = !text; m.className = 'cs-msg' + (bad ? ' bad' : ''); m.textContent = text || ''; }
  function nameOf(id) { return M.userName(S.users, id); }
  function meName() { return S.me ? (nameOf(S.me) || 'you') : 'you'; }

  /* ---------- data ---------- */
  function loadUsers() {
    if (S.demo) return Promise.resolve(window.STRIP_DEMO.users);
    return ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' }).then(function (r) { return (r && r.users) || []; });
  }
  function loadMe() {
    if (S.demo) return Promise.resolve(window.STRIP_DEMO.me);
    return ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; return u ? String(u.id) : null; });
  }
  function loadCase(id) {
    if (S.demo) {
      var m = /[?&]case=([a-z]+)/.exec(location.search), key = m ? m[1] : 'assigned';
      return Promise.resolve(JSON.parse(JSON.stringify(window.STRIP_DEMO.cases[key] || window.STRIP_DEMO.cases.assigned)));
    }
    return ZOHO.CRM.API.getRecord({ Entity: 'Cases', RecordID: id }).then(function (r) { return (r && r.data && r.data[0]) || null; });
  }
  function write(payload) {
    if (S.demo) return Promise.resolve(true);
    return ZOHO.CRM.API.updateRecord({ Entity: 'Cases', APIData: payload }).then(function (res) {
      var d = res && res.data && res.data[0];
      if (!(d && String(d.code).toUpperCase() === 'SUCCESS')) throw new Error((d && d.message) || 'Zoho did not accept the change');
      return true;
    });
  }
  function addNote(note) {
    if (S.demo) return Promise.resolve(true);
    return ZOHO.CRM.API.addNotes({ Entity: 'Cases', RecordID: S.rec.id, Title: note.Title, Content: note.Content }).then(function (res) {
      var d = res && res.data && res.data[0];
      if (!(d && String(d.code).toUpperCase() === 'SUCCESS')) throw new Error('The note was not saved');
      return true;
    });
  }

  /* ---------- render ---------- */
  function stripData() {
    var r = S.rec;
    return { owner: r.owner, team: r.team, due: r.due, waitingOn: r.waitingOn, next: r.next };
  }
  function renderHeader() {
    var r = S.rec;
    $('#title').textContent = (r.number ? r.number + ' · ' : '') + (r.subject || 'Case');
    $('#ctx').textContent = r.otherOpen ? 'Status "' + r.status + '" is not one of the usual open statuses, so it is shown as Other open.' : '';
    $('#status-chip').innerHTML = JPK.chip(r.otherOpen ? 'Other open' : (r.status || 'No status'), r.open ? (r.otherOpen ? 'warn' : 'info') : 'good');
  }
  function renderStrip() {
    var r = S.rec;
    if (S.strip) S.strip.update(stripData());
    else S.strip = JPK.ownerStrip({ mount: '#strip', data: stripData(), canAct: r.open, onTake: onTake, onAssign: onAssign });
    var n = $('#strip-note'); n.hidden = !r.pausedReason; n.textContent = r.pausedReason || '';
    renderActions();
  }
  function renderActions() {
    var r = S.rec, box = $('#actions');
    /* Unassigned: the strip itself carries Take case and Assign. Assigned and open: offer Hand off. */
    box.hidden = !(r.open && r.owner);
    box.innerHTML = r.open && r.owner ? '<button type="button" class="btn" id="b-handoff">Hand off</button>' : '';
  }
  function closePanel() { var p = $('#panel'); p.hidden = true; p.innerHTML = ''; S.panel = null; }
  function userOptions(excludeId) {
    var opts = [{ value: '', label: 'Choose a person' }];
    S.users.forEach(function (u) { if (String(u.id) !== String(excludeId || '')) opts.push({ value: u.id, label: u.name + (u.profile ? ' (' + u.profile + ')' : '') }); });
    return opts;
  }

  /* ---------- Take / Assign / Hand off ---------- */
  function afterWrite(text) {
    S.busy = false; closePanel();
    var p = S.demo ? Promise.resolve() : loadCase(S.rec.id).then(function (raw) { S.rec = M.normalizeCase(raw, { users: S.users }); });
    return p.then(function () { renderHeader(); renderStrip(); say(text + (S.demo ? ' Demo mode: nothing was saved.' : ''), false); });
  }
  function fail(e) { S.busy = false; var b = $('#panel button.pri'); if (b) b.disabled = false; say('Not saved: ' + (e && e.message || e) + '. Check the case and try again.', true); }

  function onTake() {
    if (S.busy) return; if (!S.me) { say('Could not tell who you are, so the case was not taken.', true); return; }
    S.busy = true; say('Saving...');
    write(M.takePayload(S.rec.id, S.me)).then(function () {
      if (S.demo) S.rec.owner = { id: S.me, name: meName() };
      return afterWrite('You now own this case.');
    }, fail);
  }
  function onAssign() {
    closePanel(); var p = $('#panel'); p.hidden = false; S.panel = 'assign';
    var f = JPK.field({ id: 'as-to', label: 'Assign to', required: true, type: 'select', options: userOptions('') });
    p.innerHTML = '<h2>Assign this case</h2><div id="as-err"></div><div id="as-f"></div><div class="row"><button type="button" class="btn pri" id="as-go">Assign case</button><button type="button" class="btn" id="as-no">Cancel</button></div>';
    var es = JPK.errorSummary({ mount: '#as-err' });
    $('#as-f').appendChild(f.el);
    $('#as-no').addEventListener('click', function () { closePanel(); });
    $('#as-go').addEventListener('click', function () {
      if (S.busy) return;
      var errs = M.validateHandoff({ to: f.value(), reason: 'x' }, { to: 'as-to', reason: 'as-reason' });
      if (errs.length) { f.setError(errs[0].message); es.set(errs, true); return; }
      f.clear(); es.clear(); S.busy = true; this.disabled = true; say('Saving...');
      var to = f.value();
      write(M.assignPayload(S.rec.id, to)).then(function () {
        if (S.demo) S.rec.owner = { id: to, name: nameOf(to) };
        return afterWrite('Case assigned to ' + nameOf(to) + '.');
      }, fail);
    });
    f.input.focus();
  }
  function onHandoff() {
    closePanel(); var p = $('#panel'); p.hidden = false; S.panel = 'handoff';
    var from = S.rec.owner;
    p.innerHTML = '<h2>Hand off this case</h2><p class="muted sm" style="margin:0">Now with ' + esc(from.name) + '. The reason is saved as a Note so the activity shows why it moved.</p><div id="ho-err"></div><div id="ho-f"></div>' +
      '<div class="row"><button type="button" class="btn pri" id="ho-go">Hand off case</button><button type="button" class="btn" id="ho-no">Cancel</button></div>';
    var es = JPK.errorSummary({ mount: '#ho-err' });
    var to = JPK.field({ id: 'ho-to', label: 'Hand off to', required: true, type: 'select', options: userOptions(from.id) });
    var why = JPK.field({ id: 'ho-reason', label: 'Why', required: true, type: 'textarea', hint: 'One line, for example: Customer needs the vendor RMA number.' });
    $('#ho-f').appendChild(to.el); $('#ho-f').appendChild(why.el);
    var cnt = document.createElement('div'); cnt.className = 'count'; cnt.setAttribute('aria-hidden', 'true'); cnt.textContent = '0 of ' + M.MAX_REASON; why.el.appendChild(cnt);
    why.input.addEventListener('input', function () { cnt.textContent = why.value().length + ' of ' + M.MAX_REASON; });
    $('#ho-no').addEventListener('click', function () { closePanel(); });
    $('#ho-go').addEventListener('click', function () {
      if (S.busy) return;
      var errs = M.validateHandoff({ to: to.value(), reason: why.value(), from: from.id });
      to.clear(); why.clear();
      errs.forEach(function (e) { (e.id === 'ho-to' ? to : why).setError(e.message); });
      if (errs.length) { es.set(errs, true); return; }
      es.clear(); S.busy = true; this.disabled = true; say('Saving...');
      var toId = to.value(), note = M.handoffNote({ fromName: from.name, toName: nameOf(toId), reason: why.value(), byName: meName() });
      write(M.assignPayload(S.rec.id, toId)).then(function () {
        return addNote(note).then(function () { return true; }, function () { return 'nonote'; });
      }).then(function (r) {
        if (S.demo) S.rec.owner = { id: toId, name: nameOf(toId) };
        return afterWrite(r === 'nonote' ? 'Case handed to ' + nameOf(toId) + ', but the reason could not be saved as a Note. Add it on the case.' : 'Case handed to ' + nameOf(toId) + '. The reason is saved as a Note.');
      }, fail);
    });
    to.input.focus();
  }
  document.addEventListener('click', function (e) { if (e.target.closest('#b-handoff')) onHandoff(); });

  /* ---------- start ---------- */
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    var id = ctx && ctx.EntityId ? [].concat(ctx.EntityId)[0] : '';
    return Promise.all([loadUsers(), loadMe(), loadCase(id)]).then(function (r) {
      S.users = M.normalizeUsers(r[0]); S.me = r[1];
      if (!r[2]) { showErr('Could not find this case.'); $('#title').textContent = 'Case'; return; }
      S.rec = M.normalizeCase(r[2], { users: S.users });
      renderHeader(); renderStrip();
    });
  }).catch(function (e) { $('#title').textContent = 'Case'; showErr('Could not load the case: ' + (e && e.message || e)); });
})();
