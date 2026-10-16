/* Briefing steps. Five steps from a solicitation packet to a bid decision and an owner, then a check of the answers.
   Reads one Solicitation, its attachments and the active users. Writes only these, each after an explicit click:
     Upload the packet        -> attachFile, then the existing sol_wizard_ingest function (same call the New Solicitation wizard makes; not changed)
     Confirm agency and dates -> Issuing_Agency_Text (only when no Account is linked), Proposal_Due, Release_Date, Questions_Round_1_Due, Anticipated_Award, Anticipated_Start
     Review the briefing      -> Briefing_Status = Reviewed by RFP team
     Record the decision      -> Bid_Decision, Decision_Rationale, Decision_Conditions, Decision_Date, Decision_By
     Assign a bid owner       -> Owner
     Submit                   -> Briefing_Status = Briefed to leadership, Briefed_On
   No AI. Demo mode (?demo=1 or outside Zoho) never writes. Zoho profiles still decide who can change what. */
(function () {
  'use strict';
  var M = window.BriefModel, esc = JPK.esc, $ = function (s) { return document.querySelector(s); };
  var S = { demo: false, raw: null, rec: null, users: [], me: null, attachments: null, tl: null, cya: null, busy: false, panel: null, submitEs: null };
  var CYA_STEP = { agency: 'dates', due: 'dates', review: 'review', decision: 'decision', rationale: 'decision', owner: 'owner' };

  function showErr(t) { var e = $('#err'); e.hidden = !t; e.textContent = t || ''; }
  function say(t, bad) { var m = $('#msg'); m.hidden = !t; m.className = 'bs-msg' + (bad ? ' bad' : ''); m.textContent = t || ''; }
  function param(k) { var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.search); return m ? decodeURIComponent(m[1]) : ''; }
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function offsetMin() { return -new Date().getTimezoneOffset(); }
  function userName(id) { var f = S.users.filter(function (u) { return u.id === String(id); })[0]; return f ? f.name : ''; }
  function ok(res) { var d = res && res.data && res.data[0]; if (!(d && String(d.code).toUpperCase() === 'SUCCESS')) throw new Error((d && d.message) || 'Zoho did not accept the change'); return true; }

  /* ---------- data ---------- */
  function loadUsers() { return S.demo ? Promise.resolve(window.BRIEF_DEMO.users) : ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' }).then(function (r) { return (r && r.users) || []; }); }
  function loadMe() { return S.demo ? Promise.resolve(window.BRIEF_DEMO.me) : ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; return u ? String(u.id) : null; }); }
  function loadSol(id) {
    if (S.demo) { var k = param('sol') || 'new'; S.demoKey = window.BRIEF_DEMO.sols[k] ? k : 'new'; return Promise.resolve(JSON.parse(JSON.stringify(window.BRIEF_DEMO.sols[S.demoKey]))); }
    return ZOHO.CRM.API.getRecord({ Entity: 'Solicitations', RecordID: id }).then(function (r) { return (r && r.data && r.data[0]) || null; });
  }
  function loadAttachments(id) {
    if (S.demo) return Promise.resolve(S.attachments != null ? S.attachments : window.BRIEF_DEMO.attachments[S.demoKey]);
    return ZOHO.CRM.API.getRelatedRecords({ Entity: 'Solicitations', RecordID: id, RelatedList: 'Attachments', page: 1, per_page: 1 }).then(function (r) { return (r && r.data && r.data.length) || 0; }, function () { return null; });
  }
  function write(payload) {
    if (S.demo) {
      Object.keys(payload).forEach(function (k) { if (k === 'id') return; var v = payload[k]; S.raw[k] = v && typeof v === 'object' && v.id ? { id: v.id, name: userName(v.id) } : v; });
      return Promise.resolve(true);
    }
    return ZOHO.CRM.API.updateRecord({ Entity: 'Solicitations', APIData: payload }).then(ok);
  }

  /* ---------- render ---------- */
  function normalize() { S.rec = M.normalize(S.raw, { attachments: S.attachments, users: S.users }); }
  function refresh() {
    var id = S.raw.id;
    var p = S.demo ? Promise.resolve() : loadSol(id).then(function (raw) { S.raw = raw; }).then(function () { return loadAttachments(id); }).then(function (n) { S.attachments = n; });
    return p.then(function () { normalize(); render(); });
  }
  function render() {
    var r = S.rec;
    $('#title').textContent = r.name || 'Solicitation';
    $('#ctx').textContent = [r.number, r.agency].filter(Boolean).join(' · ');
    $('#status-chip').innerHTML = JPK.chip(r.briefing, r.rank >= 3 ? 'good' : r.rank >= 1 ? 'info' : 'neutral');
    var steps = M.steps(r);
    if (S.tl) S.tl.setSteps(steps); else S.tl = JPK.taskList({ mount: '#steps', steps: steps, onOpen: function (s) { openPanel(s.id); } });
    var rows = M.answers(r);
    if (S.cya) S.cya.setRows(rows); else S.cya = JPK.checkAnswers({ mount: '#cya', rows: rows, onChange: function (row) { var st = CYA_STEP[row.id]; if (st) openPanel(st); } });
    [].forEach.call(document.querySelectorAll('#cya .jp-lnkb'), function (b) { b.id = 'cya-' + b.getAttribute('data-id'); });
    var done = r.rank >= 3;
    $('#b-submit').hidden = done;
    $('#submit-note').textContent = done ? 'Submitted for leadership briefing' + (r.briefedOn ? ' on ' + M.fmtDay(r.briefedOn) : '') + '.' : 'Submitting sets Briefing Status to Briefed to leadership. It does not change the bid decision.';
  }

  /* ---------- panels ---------- */
  function closePanel() { var p = $('#panel'); p.hidden = true; p.innerHTML = ''; S.panel = null; }
  function lockedReason(id) { var m = JPK.model.taskStatuses(M.steps(S.rec)).steps.filter(function (x) { return x.id === id; })[0]; return m && m.locked ? m.reason : ''; }
  function shell(title, intro) {
    closePanel(); var p = $('#panel'); p.hidden = false;
    p.innerHTML = '<h2>' + esc(title) + '</h2>' + (intro ? '<p class="muted sm" style="margin:0">' + intro + '</p>' : '') + '<div id="p-err"></div><div id="p-body"></div><div class="row" id="p-btns"></div>';
    return { es: JPK.errorSummary({ mount: '#p-err' }), body: $('#p-body'), btns: $('#p-btns') };
  }
  function buttons(box, goLabel, onGo) {
    box.btns.innerHTML = '<button type="button" class="btn pri" id="p-go">' + esc(goLabel) + '</button><button type="button" class="btn" id="p-no">Cancel</button>';
    $('#p-no').addEventListener('click', closePanel);
    $('#p-go').addEventListener('click', function () { if (!S.busy) onGo(this); });
  }
  /* fields: {id: fieldObject}. Marks each bad field and fills the summary. */
  function showErrors(errs, fields, es) {
    Object.keys(fields).forEach(function (k) { fields[k].clear(); });
    errs.forEach(function (e) { var f = fields[e.id]; if (f) f.setError(e.message); });
    if (errs.length) { es.set(errs, true); return true; } es.clear(); return false;
  }
  function fail(e) { S.busy = false; var b = $('#p-go'); if (b) b.disabled = false; say('Not saved: ' + (e && e.message || e) + '. Check the solicitation and try again.', true); }
  function saved(text) { S.busy = false; closePanel(); return refresh().then(function () { say(text + (S.demo ? ' Demo mode: nothing was saved.' : ''), false); }); }
  function begin(btn) { S.busy = true; if (btn) btn.disabled = true; say('Saving...'); }

  function openPanel(id) {
    var why = lockedReason(id); if (why) { say(why + '.', true); return; }
    say(''); ({ packet: panelPacket, dates: panelDates, review: panelReview, decision: panelDecision, owner: panelOwner })[id]();
  }

  function panelPacket() {
    var b = shell('Upload the packet', 'The packet is attached to this solicitation, then the existing reader runs on it. It fills requirements and drafts the briefing. It never overwrites a field that already has text.');
    var f = JPK.field({ id: 'bd-file', label: 'Packet file', required: true, type: 'file', hint: 'A .zip, or a single PDF, Word or Excel file. Under 20 MB.' });
    f.input.setAttribute('accept', '.zip,.pdf,.docx,.xlsx,.xls,.csv,.txt');
    b.body.appendChild(f.el);
    var fs = document.createElement('fieldset'); fs.innerHTML = '<legend>Readers to run</legend>' + M.PARSERS.map(function (p) { return '<label class="bs-chk"><input type="checkbox" name="parser" value="' + esc(p.value) + '"' + (p.on ? ' checked' : '') + '> ' + esc(p.label) + '</label>'; }).join('');
    b.body.appendChild(fs);
    buttons(b, 'Upload and read packet', function (btn) {
      var file = f.input.files && f.input.files[0], errs = M.validatePacket(file ? { name: file.name, size: file.size } : null);
      if (showErrors(errs, { 'bd-file': f }, b.es)) return;
      var parsers = [].map.call(document.querySelectorAll('input[name=parser]:checked'), function (i) { return i.value; });
      begin(btn);
      if (S.demo) { S.attachments = 1; if (S.raw.Briefing_Status === 'Not started' || !S.raw.Briefing_Status) S.raw.Briefing_Status = 'Drafted from packet'; saved('Packet "' + file.name + '" would be attached and read.'); return; }
      ZOHO.CRM.API.attachFile({ Entity: 'Solicitations', RecordID: S.rec.id, File: { Name: file.name, Content: file } }).then(function (res) {
        if (res && res.data && res.data[0] && String(res.data[0].code).toUpperCase() !== 'SUCCESS') throw new Error('The packet was not attached');
        if (!parsers.length) return 'noparsers';
        return ZOHO.CRM.FUNCTIONS.execute('sol_wizard_ingest', { arguments: JSON.stringify({ solicitationId: String(S.rec.id), parsers: parsers.join(',') }) }).then(function () { return 'started'; }, function () { return 'noingest'; });
      }).then(function (r) {
        return saved(r === 'started' ? 'Packet attached. Reading has started; the briefing status changes to Drafted from packet when it finishes. Reload in a minute.' : r === 'noparsers' ? 'Packet attached. No readers were chosen, so nothing has been read yet.' : 'Packet attached, but the reader did not start. Press Ingest Requirements on the record.');
      }, fail);
    });
    f.input.focus();
  }

  function panelDates() {
    var r = S.rec, b = shell('Confirm agency and dates', 'These are the dates the alerts count down from. Check them against the packet.');
    var F = {}, add = function (k, o) { F[k] = JPK.field(o); b.body.appendChild(F[k].el); return F[k]; };
    if (!r.agencyIsLookup) add('bd-agency', { id: 'bd-agency', label: 'Agency name', required: true, hint: 'For example Marinette County. Link an Account on the record when one exists.', value: r.agency });
    else { var p = document.createElement('p'); p.className = 'muted sm'; p.style.margin = '0'; p.textContent = 'Agency: ' + r.agency + ' (linked Account; change it on the record).'; b.body.appendChild(p); }
    add('bd-release', { id: 'bd-release', label: 'Release date', type: 'date', value: r.release });
    add('bd-q1', { id: 'bd-q1', label: 'Questions due', type: 'datetime-local', value: r.q1 });
    add('bd-due', { id: 'bd-due', label: 'Proposal due', required: true, type: 'datetime-local', value: r.due, hint: 'Date and time, in your time zone.' });
    add('bd-award', { id: 'bd-award', label: 'Anticipated award', type: 'date', value: r.award });
    add('bd-start', { id: 'bd-start', label: 'Anticipated start', type: 'date', value: r.start });
    buttons(b, 'Save agency and dates', function (btn) {
      var v = { needAgency: !r.agencyIsLookup, agency: F['bd-agency'] ? F['bd-agency'].value() : '', release: F['bd-release'].value(), q1: F['bd-q1'].value(), due: F['bd-due'].value(), award: F['bd-award'].value(), start: F['bd-start'].value() };
      if (showErrors(M.validateDates(v), F, b.es)) return;
      begin(btn);
      write(M.datesPayload(r.id, v, offsetMin())).then(function () { return saved('Agency and dates saved.'); }, fail);
    });
    (F['bd-agency'] || F['bd-release']).input.focus();
  }

  function panelReview() {
    var r = S.rec, b = shell('Review the drafted briefing', 'Read what the packet reader drafted and fix anything on the record. Marking it reviewed does not change the text.');
    var parts = [['Scope of work', r.draft.scope], ['Submission requirements', r.draft.submission], ['Evaluation criteria', r.draft.evaluation], ['Key requirements', r.draft.key]];
    var d = document.createElement('div'); d.className = 'bs-draft';
    d.innerHTML = parts.map(function (p) { return '<div><h3>' + esc(p[0]) + '</h3>' + (p[1] ? '<p>' + esc(p[1]) + '</p>' : '<p class="empty">Nothing drafted yet.</p>') + '</div>'; }).join('');
    b.body.appendChild(d);
    if (r.rank >= 2) { var n = document.createElement('p'); n.className = 'muted sm'; n.textContent = 'Already marked ' + r.briefing.toLowerCase() + '.'; b.body.appendChild(n); b.btns.innerHTML = '<button type="button" class="btn" id="p-no">Close</button>'; $('#p-no').addEventListener('click', closePanel); return; }
    buttons(b, 'Mark as reviewed', function (btn) { begin(btn); write(M.reviewedPayload(r.id)).then(function () { return saved('Briefing marked as reviewed by the RFP team.'); }, fail); });
  }

  function panelDecision() {
    var r = S.rec, b = shell('Record the bid decision and rationale', 'This saves who decided and today\'s date with the decision.');
    var F = {};
    F['bd-decision'] = JPK.field({ id: 'bd-decision', label: 'Bid decision', required: true, type: 'select', options: [{ value: '', label: 'Choose a decision' }].concat(M.DECISIONS.map(function (d) { return { value: d, label: d }; })), value: r.decided ? r.decision : '' });
    F['bd-rationale'] = JPK.field({ id: 'bd-rationale', label: 'Why', required: true, type: 'textarea', hint: 'For example: Fits our GPS lineup and the county renews in 2027.', value: r.rationale });
    F['bd-conditions'] = JPK.field({ id: 'bd-conditions', label: 'Conditions', type: 'textarea', hint: 'Anything that must be true for this decision to hold.', value: r.conditions });
    Object.keys(F).forEach(function (k) { b.body.appendChild(F[k].el); });
    buttons(b, 'Save decision', function (btn) {
      var v = { decision: F['bd-decision'].value(), rationale: F['bd-rationale'].value(), conditions: F['bd-conditions'].value() };
      if (showErrors(M.validateDecision(v), F, b.es)) return;
      begin(btn);
      write(M.decisionPayload(r.id, v, S.me, today())).then(function () { return saved('Decision saved.'); }, fail);
    });
    F['bd-decision'].input.focus();
  }

  function panelOwner() {
    var r = S.rec, b = shell('Assign a bid owner', r.ownerKnown ? '' : 'There is no separate bid owner field yet, so this changes the owner of the solicitation record.');
    var opts = [{ value: '', label: 'Choose a person' }].concat(S.users.map(function (u) { return { value: u.id, label: u.name + (u.profile ? ' (' + u.profile + ')' : '') }; }));
    var F = { 'bd-owner': JPK.field({ id: 'bd-owner', label: 'Bid owner', required: true, type: 'select', options: opts, value: r.owner && r.owner.id ? r.owner.id : '' }) };
    b.body.appendChild(F['bd-owner'].el);
    buttons(b, 'Assign bid owner', function (btn) {
      var to = F['bd-owner'].value();
      if (showErrors(M.validateOwner({ to: to }), F, b.es)) return;
      begin(btn);
      write(M.ownerPayload(r.id, to)).then(function () { return saved('Bid owner is now ' + userName(to) + '.'); }, fail);
    });
    F['bd-owner'].input.focus();
  }

  /* ---------- submit ---------- */
  $('#b-submit').addEventListener('click', function () {
    if (S.busy) return;
    var rows = JPK.model.checkRows(M.answers(S.rec)).rows, errs = M.submitErrors(rows);
    if (!S.submitEs) S.submitEs = JPK.errorSummary({ mount: '#submit-err', title: 'Complete these answers first' });
    if (errs.length) { S.submitEs.set(errs, true); return; }
    S.submitEs.clear(); begin(this);
    var btn = this;
    write(M.briefedPayload(S.rec.id, today())).then(function () { btn.disabled = false; return saved('Submitted. Briefing Status is now Briefed to leadership.'); }, function (e) { btn.disabled = false; fail(e); });
  });

  /* ---------- start ---------- */
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    var id = ctx && ctx.EntityId ? [].concat(ctx.EntityId)[0] : '';
    return Promise.all([loadUsers(), loadMe(), loadSol(id)]).then(function (r) {
      S.users = M.normalizeUsers(r[0]); S.me = r[1];
      if (!r[2]) { showErr('Could not find this solicitation.'); $('#title').textContent = 'Solicitation'; return; }
      S.raw = r[2];
      return loadAttachments(S.raw.id).then(function (n) { S.attachments = n; normalize(); render(); });
    });
  }).catch(function (e) { $('#title').textContent = 'Solicitation'; showErr('Could not load the solicitation: ' + (e && e.message || e)); });
})();
