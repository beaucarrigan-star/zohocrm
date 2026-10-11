/* Customer Onboarding widget 1.0.0
   Reads: Customer_Onboarding (Name, Account, Status, Phase, Risk, Template_Key, Onboarding_Type, Kickoff_Date, Go_live_Target,
          Go_live_Actual, Plan_Anchored_Go_live, Days_to_Go_live, Blocked_Reason, Template_Applied),
          Tasks (Subject, Due_Date, Status, Owner, Onboarding_Phase, Gate, Onboarding_Anchor, Description, Next_Steps, What_Id).
   Writes: Task Status and Due_Date; onboarding Phase, Status, Go_live_Target and Plan_Anchored_Go_live.
   Every write passes the workflow trigger, then re-reads, so an existing workflow that already did the job leaves nothing to redo. */
(function () {
  'use strict';
  var J = window.JPK, $ = J.$, $$ = J.$$, crm = J.crm, esc = J.esc;
  var PHASES = ['Kickoff', 'Setup', 'Training', 'Go-live', 'Stabilize'];
  var CLOSED = { 'Completed': 1, 'Cancelled': 1 };
  var S = { list: [], o: null, tasks: [], tab: null, busy: false };

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
  function open(t) { return !CLOSED[t.Status]; }
  function overdue(t) { return open(t) && t.Due_Date && t.Due_Date < today(); }
  function inPhase(p) { return S.tasks.filter(function (t) { return t.Onboarding_Phase === p; }); }
  function showErr(m) { var e = $('#err'); e.textContent = m || ''; e.hidden = !m; }

  var nx = J.next('#nx');
  var st = J.steps('#steps', PHASES);
  var more = J.menu('#more', { items: [] });
  $('#about').appendChild(J.aboutButton(
    'An onboarding is a checklist with a calendar. The steps show where it stands, the tabs show one phase at a time, and the strip above always names the next action.',
    'tick a task when it is done and the phase moves on once its last task closes. Open a task to change its date. Use More to shift the go-live date or mark the onboarding complete.',
    'Gate tasks must be closed before the phase can move on. Shifting go-live moves only tasks anchored to go-live.'));
  var tabs = null;

  /* ---------- data ---------- */
  var OFIELDS = 'id, Name, Account, Status, Phase, Risk, Template_Key, Onboarding_Type, Kickoff_Date, Go_live_Target, Go_live_Actual, Plan_Anchored_Go_live, Days_to_Go_live, Blocked_Reason, Template_Applied';
  function loadList() {
    return crm.coql('select ' + OFIELDS + ' from Customer_Onboarding where Name is not null order by Go_live_Target limit 200').then(function (r) {
      S.list = r.filter(function (o) { return o.Status !== 'Completed' && o.Status !== 'Cancelled'; });
      $('#opick').innerHTML = S.list.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(label(o)) + '</option>'; }).join('');
    });
  }
  function label(o) { return (o.Account && o.Account.name ? o.Account.name : 'Onboarding ' + o.Name); }
  function load(oid) {
    return Promise.all([
      crm.coql('select ' + OFIELDS + ' from Customer_Onboarding where id = ' + oid),
      crm.coql('select id, Subject, Due_Date, Status, Owner, Onboarding_Phase, Gate, Onboarding_Anchor, Description, Next_Steps from Tasks where What_Id = ' + oid + ' order by Due_Date limit 200')
    ]).then(function (r) {
      S.o = r[0][0] || null; S.tasks = r[1];
      if (!S.o) { showErr('This onboarding could not be found.'); return; }
      showErr(''); draw();
    }, function (e) { showErr('Could not load the onboarding. ' + (e && e.message || '')); });
  }

  /* ---------- drawing ---------- */
  function curPhase() { return S.o.Phase === 'Complete' ? null : (PHASES.indexOf(S.o.Phase) >= 0 ? S.o.Phase : PHASES[0]); }
  function draw() {
    var o = S.o;
    $('#title').textContent = label(o);
    $('#opick').value = o.id;
    var dtg = o.Go_live_Target ? daysBetween(today(), o.Go_live_Target) : null;
    $('#facts').innerHTML = [
      ['Template', [o.Template_Key, o.Onboarding_Type].filter(Boolean).join(', ')],
      ['Kickoff', o.Kickoff_Date ? J.fmtDate(o.Kickoff_Date) : ''],
      ['Go-live target', o.Go_live_Target ? J.fmtDate(o.Go_live_Target) : 'Not set'],
      ['Days to go-live', o.Status === 'Completed' ? 'Live' : dtg == null ? '' : dtg < 0 ? Math.abs(dtg) + ' past' : String(dtg)]
    ].filter(function (f) { return f[1]; }).map(function (f) { return '<div class="fact"><small>' + esc(f[0]) + '</small><span class="' + (f[0] === 'Days to go-live' ? 'num' : '') + '">' + esc(f[1]) + '</span></div>'; }).join('');
    var rk = { 'On Track': 'good', 'At Risk': 'warn', 'Stalled': 'bad' };
    $('#risk').innerHTML = o.Status === 'Completed' ? J.chip('Complete', 'good') : o.Risk ? J.chip(o.Risk, rk[o.Risk]) : '';

    var cp = curPhase();
    st.set(cp ? PHASES.indexOf(cp) : PHASES.length);

    var openGates = S.tasks.filter(function (t) { return t.Gate && open(t); });
    more.setItems([
      { label: 'Shift go-live', disabled: o.Status === 'Completed', onClick: shiftDrawer },
      { label: openGates.length ? 'Mark complete (' + openGates.length + ' gate task' + (openGates.length > 1 ? 's' : '') + ' open)' : 'Mark complete', disabled: !!openGates.length || o.Status === 'Completed', onClick: completeDrawer },
      { label: 'Open the onboarding record', onClick: function () { if (window.ZOHO && ZOHO.CRM.UI && ZOHO.CRM.UI.Record) ZOHO.CRM.UI.Record.open({ Entity: 'Customer_Onboarding', RecordID: o.id }); } },
      { label: 'Refresh', onClick: function () { load(o.id); } }
    ]);

    var panes = {};
    $('#panes').innerHTML = '';
    PHASES.forEach(function (p) { var d = document.createElement('section'); d.id = 'p-' + p.replace(/\W/g, ''); $('#panes').appendChild(d); panes[p] = d; drawPhase(p, d); });
    if (!S.tab || PHASES.indexOf(S.tab) < 0) S.tab = cp || PHASES[PHASES.length - 1];
    var oldTabs = $('#tabs'), freshTabs = oldTabs.cloneNode(false); freshTabs.className = ''; oldTabs.replaceWith(freshTabs);  // drop old listeners
    tabs = J.tabs('#tabs', {
      tabs: PHASES.map(function (p, i) {
        var finished = (cp ? i < PHASES.indexOf(cp) : true) && inPhase(p).every(function (t) { return !open(t); });
        return { id: p, label: p + (finished ? ' \u2713' : ''), count: inPhase(p).filter(overdue).length };
      }),
      panes: panes, active: S.tab, onChange: function (t) { S.tab = t; }
    });
    drawNext(openGates);
  }

  function drawPhase(p, host) {
    var list = inPhase(p), done = list.filter(function (t) { return !open(t); }).length;
    if (!list.length) {
      host.innerHTML = '<div class="card"><div class="empty"><b>No tasks in ' + esc(p) + '.</b>' + (S.o.Template_Applied ? 'Nothing to do in this phase.' : 'Apply the template on the onboarding record to create the tasks.') + '</div></div>';
      return;
    }
    var pct = Math.round(done / list.length * 100);
    host.innerHTML = '<div class="card"><div class="ph-top"><b>' + done + ' of ' + list.length + ' done</b>' +
      '<div class="bar" role="progressbar" aria-label="' + esc(p) + ' progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><i style="width:' + pct + '%"></i></div></div>' +
      '<ul class="tasks">' + list.map(function (t) {
        var chips = [];
        if (t.Gate) chips.push(J.chip('Gate', 'info', true));
        if (t.Onboarding_Anchor) chips.push(J.chip(t.Onboarding_Anchor === 'Go-live' ? 'From go-live' : 'From kickoff', '', true));
        if (overdue(t)) chips.push(J.chip('Overdue', 'bad', true));
        if (t.Status === 'Cancelled') chips.push(J.chip('Cancelled', '', true));
        return '<li class="' + (open(t) ? '' : 'done') + '" data-t="' + esc(t.id) + '">' +
          '<input type="checkbox" aria-label="' + esc((open(t) ? 'Mark done: ' : 'Reopen: ') + t.Subject) + '"' + (t.Status === 'Completed' ? ' checked' : '') + (t.Status === 'Cancelled' || S.o.Status === 'Completed' ? ' disabled' : '') + '>' +
          '<button class="t" type="button"><b>' + esc(t.Subject) + '</b><span>' + (t.Due_Date ? 'Due ' + esc(J.fmtDate(t.Due_Date)) : 'No due date') + (t.Owner && t.Owner.name ? ', ' + esc(t.Owner.name) : '') + '</span></button>' +
          '<span class="chips">' + chips.join('') + '</span></li>';
      }).join('') + '</ul></div>';
  }

  function drawNext(openGates) {
    var o = S.o, cp = curPhase();
    if (o.Status === 'Completed') { nx.set({ tone: 'done', title: 'This onboarding is complete.', sub: o.Go_live_Actual ? 'Went live ' + J.fmtDate(o.Go_live_Actual) + '.' : '' }); return; }
    if (!S.tasks.length) { nx.set({ title: 'Apply the template to create the tasks.', sub: 'Use Apply Template on the onboarding record. The phases fill in from there.' }); return; }
    var od = S.tasks.filter(overdue);
    if (od.length) {
      nx.set({ tone: 'warn', title: od.length + ' task' + (od.length > 1 ? 's are' : ' is') + ' overdue.', sub: od.slice(0, 2).map(function (t) { return t.Subject; }).join(', ') + (od.length > 2 ? ' and more' : '') + '.', action: { label: 'Open ' + (od.length > 1 ? 'the first' : 'it'), onClick: function () { openTask(od[0]); } } });
      return;
    }
    var gate = cp && inPhase(cp).filter(function (t) { return t.Gate && open(t); })[0];
    if (gate) { nx.set({ title: 'Finish ' + gate.Subject + ' to move past ' + cp + '.', sub: gate.Due_Date ? 'Gate task, due ' + J.fmtDate(gate.Due_Date) + '.' : 'Gate task.', action: { label: 'Mark done', onClick: function () { setDone(gate, true); } } }); return; }
    var nextT = cp && inPhase(cp).filter(open)[0];
    if (nextT) { nx.set({ title: 'Next: ' + nextT.Subject + '.', sub: nextT.Due_Date ? 'Due ' + J.fmtDate(nextT.Due_Date) + '.' : '', action: { label: 'Mark done', onClick: function () { setDone(nextT, true); } } }); return; }
    if (!openGates.length) nx.set({ title: 'Every task is closed.', sub: 'Mark the onboarding complete when the customer is stable.', action: { label: 'Mark complete', onClick: completeDrawer } });
  }

  /* ---------- task actions ---------- */
  $('#panes').addEventListener('change', function (e) {
    var cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    var t = byId(cb.closest('li').dataset.t); setDone(t, cb.checked);
  });
  $('#panes').addEventListener('click', function (e) { var b = e.target.closest('.t'); if (b) openTask(byId(b.closest('li').dataset.t)); });
  function byId(id) { return S.tasks.filter(function (t) { return t.id === id; })[0]; }

  function setDone(t, done) {
    if (S.busy) return; S.busy = true;
    var phaseBefore = S.o.Phase;
    crm.update('Tasks', { id: t.id, Status: done ? 'Completed' : 'Not Started' }, ['workflow'])
      .then(function () { return load(S.o.id); })
      .then(function () { return done ? maybeAdvance(phaseBefore) : null; })
      .then(function (advanced) {
        J.toast(done ? (advanced ? 'Done. Moved to ' + advanced + '.' : 'Marked done') : 'Reopened');
        J.flash($('li[data-t="' + t.id + '"]'));
      }, function (e) { showErr('Not saved: ' + (e && e.message || 'unknown error') + '.'); return load(S.o.id); })
      .then(function () { S.busy = false; }, function () { S.busy = false; });
  }
  /* Move the onboarding to the next phase once every task in its current phase is closed.
     Runs after a re-read, so if an existing workflow already advanced it, nothing happens here. */
  function maybeAdvance(phaseBefore) {
    var o = S.o, cp = curPhase();
    if (!cp || o.Phase !== phaseBefore || o.Status === 'Completed') return null;
    var list = inPhase(cp);
    if (!list.length || list.some(open)) return null;
    var i = PHASES.indexOf(cp); if (i < 0 || i === PHASES.length - 1) return null;
    var nextP = PHASES[i + 1];
    var data = { id: o.id, Phase: nextP };
    if (o.Status === 'Not started') data.Status = 'In progress';
    return crm.update('Customer_Onboarding', data, ['workflow']).then(function () { S.tab = nextP; return load(o.id); }).then(function () { return nextP; });
  }

  function openTask(t) {
    var od = overdue(t);
    J.drawer.open({
      title: t.Subject,
      html: '<dl class="dl"><dt>Phase</dt><dd>' + esc(t.Onboarding_Phase || '') + '</dd>' +
        '<dt>Status</dt><dd>' + esc(t.Status === 'Waiting on someone else' ? 'Waiting for input' : t.Status) + (od ? ' ' + J.chip('Overdue', 'bad', true) : '') + '</dd>' +
        '<dt>Owner</dt><dd>' + esc(t.Owner && t.Owner.name || '') + '</dd>' +
        '<dt>Dated from</dt><dd>' + esc(t.Onboarding_Anchor || 'Not anchored') + '</dd>' +
        (t.Gate ? '<dt>Gate</dt><dd>The phase cannot move on until this closes.</dd>' : '') + '</dl>' +
        (t.Description ? '<p class="sm">' + esc(t.Description) + '</p>' : '') +
        (t.Next_Steps ? '<div class="q" style="margin-bottom:12px">' + esc(t.Next_Steps) + '</div>' : '') +
        '<label class="sm muted" for="due-in" style="display:block;margin-bottom:4px">Due date</label>' +
        '<div class="row"><input type="date" id="due-in" value="' + esc(t.Due_Date || '') + '" style="width:auto"><button class="btn sm" id="due-save" disabled>Save date</button></div>' +
        '<div class="sm muted" id="due-why" style="margin-top:6px">Change the date to save it.</div>',
      actions: t.Status === 'Cancelled' || S.o.Status === 'Completed' ? [] : [{ label: open(t) ? 'Mark done' : 'Reopen', primary: open(t), onClick: function (close) { close(); setDone(t, open(t)); } }],
      onMount: function (b) {
        var inp = $('#due-in', b), btn = $('#due-save', b), why = $('#due-why', b);
        inp.addEventListener('input', function () { btn.disabled = !inp.value || inp.value === t.Due_Date; why.textContent = btn.disabled ? 'Change the date to save it.' : 'Will move it to ' + J.fmtDate(inp.value) + '.'; });
        btn.addEventListener('click', function () {
          btn.disabled = true;
          crm.update('Tasks', { id: t.id, Due_Date: inp.value }, ['workflow']).then(function () { J.drawer.close(); J.toast('Date saved'); return load(S.o.id); },
            function (e) { why.textContent = 'Not saved: ' + (e && e.message || 'unknown error') + '.'; btn.disabled = false; });
        });
      }
    });
  }

  /* ---------- Shift go-live ---------- */
  /* Documented rule (field tooltips): Shift Dates moves open Go-live-anchored tasks by the difference between the new
     Go-live Target and Plan Anchored Go-live; Kickoff-anchored tasks keep their dates. Plan Anchored Go-live is then set
     to the new target, so pressing the record's own Shift Dates afterwards finds a zero difference and moves nothing. */
  function shiftDrawer() {
    var o = S.o, base = o.Plan_Anchored_Go_live || o.Go_live_Target;
    var movable = S.tasks.filter(function (t) { return open(t) && t.Onboarding_Anchor === 'Go-live' && t.Due_Date; });
    J.drawer.open({
      title: 'Shift go-live',
      html: '<p class="sm">Current go-live target: <b>' + (o.Go_live_Target ? esc(J.fmtDate(o.Go_live_Target)) : 'not set') + '</b>.</p>' +
        '<label class="sm muted" for="gl-in" style="display:block;margin-bottom:4px">New go-live target</label>' +
        '<input type="date" id="gl-in" value="' + esc(o.Go_live_Target || '') + '" style="width:auto">' +
        '<div class="row" style="margin-top:8px"><button class="btn sm" data-d="7">+7 days</button><button class="btn sm" data-d="14">+14 days</button></div>' +
        '<p class="sm muted" id="gl-why" style="margin-top:10px">Pick a new date.</p>',
      actions: [{ label: 'Shift go-live', primary: true, disabled: true, onClick: function (close, b) { doShift($('#gl-in', b).value, base, movable, close); } }],
      onMount: function (b) {
        var inp = $('#gl-in', b), btn = $('.jpk-dr footer .btn.pri'), why = $('#gl-why', b);
        function upd() {
          var v = inp.value, d = v && base ? daysBetween(base, v) : null;
          btn.disabled = !v || v === o.Go_live_Target || !base;
          why.textContent = !base ? 'Set a go-live target on the record first.' : btn.disabled ? 'Pick a new date.' :
            movable.length + ' open task' + (movable.length === 1 ? '' : 's') + ' dated from go-live will move ' + Math.abs(d) + ' day' + (Math.abs(d) === 1 ? '' : 's') + (d < 0 ? ' earlier' : ' later') + '. Kickoff tasks keep their dates.';
        }
        inp.addEventListener('input', upd);
        $$('[data-d]', b).forEach(function (x) { x.addEventListener('click', function () { inp.value = addDays(o.Go_live_Target || today(), +x.dataset.d); upd(); }); });
      }
    });
  }
  function doShift(newDate, base, movable, close) {
    var d = daysBetween(base, newDate), oid = S.o.id;
    var btn = $('.jpk-dr footer .btn.pri'); btn.disabled = true; btn.textContent = 'Shifting';
    var chain = Promise.resolve();
    movable.forEach(function (t) { chain = chain.then(function () { return crm.update('Tasks', { id: t.id, Due_Date: addDays(t.Due_Date, d) }, ['workflow']); }); });
    chain.then(function () { return crm.update('Customer_Onboarding', { id: oid, Go_live_Target: newDate, Plan_Anchored_Go_live: newDate }, ['workflow']); })
      .then(function () { close(); J.toast('Go-live moved to ' + J.fmtDate(newDate) + '. ' + movable.length + ' task' + (movable.length === 1 ? '' : 's') + ' shifted.'); return load(oid); },
        function (e) { btn.textContent = 'Shift go-live'; btn.disabled = false; $('#gl-why').textContent = 'Stopped partway: ' + (e && e.message || 'unknown error') + '. Refresh to see which tasks moved.'; });
  }

  /* ---------- Mark complete ---------- */
  function completeDrawer() {
    var gates = S.tasks.filter(function (t) { return t.Gate && open(t); });
    if (gates.length) { J.toast(gates.length + ' gate task' + (gates.length > 1 ? 's' : '') + ' still open.'); return; }
    var toCancel = S.tasks.filter(function (t) { return open(t) && !t.Gate; });
    J.drawer.open({
      title: 'Mark complete',
      html: '<p>The onboarding moves to Complete.</p>' + (toCancel.length
        ? '<p class="sm">' + toCancel.length + ' open task' + (toCancel.length > 1 ? 's' : '') + ' will be cancelled:</p><ul class="sm">' + toCancel.map(function (t) { return '<li>' + esc(t.Subject) + '</li>'; }).join('') + '</ul>'
        : '<p class="sm muted">No open tasks to cancel.</p>') + '<p class="sm muted">Gate tasks are already closed and stay on the list.</p>',
      actions: [{ label: 'Mark complete', primary: true, onClick: function (close) { doComplete(close); } }]
    });
  }
  function doComplete(close) {
    var oid = S.o.id, btn = $('.jpk-dr footer .btn.pri'); btn.disabled = true; btn.textContent = 'Completing';
    crm.update('Customer_Onboarding', { id: oid, Status: 'Completed', Phase: 'Complete' }, ['workflow'])
      .then(function () { return load(oid); })
      .then(function () {   // cancel what an existing workflow did not already cancel
        var left = S.tasks.filter(function (t) { return open(t) && !t.Gate; }), chain = Promise.resolve();
        left.forEach(function (t) { chain = chain.then(function () { return crm.update('Tasks', { id: t.id, Status: 'Cancelled' }, ['workflow']); }); });
        return chain.then(function () { return left.length; });
      })
      .then(function () { close(); J.toast('Onboarding complete'); return load(oid); },
        function (e) { btn.disabled = false; btn.textContent = 'Mark complete'; showErr('Not completed: ' + (e && e.message || 'unknown error') + '.'); });
  }

  /* ---------- boot ---------- */
  $('#opick').addEventListener('change', function () { S.tab = null; load(this.value); });
  crm.init().then(function (page) {
    if (!page) { showErr('Open this screen inside Zoho CRM to load onboardings.'); return; }
    var onRecord = crm.entity === 'Customer_Onboarding' && crm.entityId;
    if (onRecord) return load(crm.entityId);
    return loadList().then(function () {
      if (!S.list.length) {
        $('#title').textContent = 'No open onboardings';
        nx.set({ title: 'No onboarding is in progress.', sub: 'Create one from a won deal, or open an onboarding record to see it here.' });
        return;
      }
      $('#opick').hidden = false;
      return load(S.list[0].id);
    });
  }).catch(function (e) { showErr('Could not load onboardings. ' + (e && e.message || '')); });
})();
