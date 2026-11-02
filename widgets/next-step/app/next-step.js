/* Next step widget v1.2.0 (S64, 2 Nov 2026: Deals mode, off with ?s13=0). v1.1.0 (S41: Cases, Billing Findings, Solicitations). v1.0.6 (S12). Read-only: the buttons open Zoho's own forms, nothing is written from here. */
(function () {
  'use strict';
  var M = window.NextStepModel, root = document.getElementById('ns'), toastEl = document.getElementById('ns-toast'), tt = null;
  var state = { module: null, rec: null, contact: null, demo: false };
  var S13 = !/[?&]s13=0(&|$)/.test(location.search);   /* ?s13=0: Deals mode off, page behaves as v1.1.0 */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 3200); }
  function resize() { try { if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) ZOHO.CRM.UI.Resize({ height: String(Math.ceil(document.documentElement.scrollHeight) + 4), width: '100%' }); } catch (e) { /* ignore */ } }

  /* ---- Deals mode (S64). Every value shown comes from the record, its tasks and its pipeline; there is no sample data. ---- */
  function mark(x) { return '<span class="nd-' + (x.ok ? 'ok' : 'miss') + '">' + esc(x.name) + ' <span aria-hidden="true">' + (x.ok ? '✓' : '✗') + '</span><span class="vh">' + (x.ok ? ' filled' : ' missing') + '</span></span>'; }
  function renderDeal() {
    var r = M.compute('Deals', state.rec, { now: new Date(), contact: state.contact, tasks: state.tasks, stages: state.stages }), d = r.deal;
    var strip = '<p class="nd-strip"><span class="nd-pipe">' + esc(d.pipeline || 'No pipeline set') + '</span>' +
      (d.days != null ? '<span class="nd-days">' + d.days + ' day' + (d.days === 1 ? '' : 's') + ' in stage</span>' : '') +
      (d.stale ? '<span class="chip warn">stale</span>' : '') + '</p>';
    var path = d.path.inList
      ? '<ol class="nd-path" aria-label="Stages in ' + esc(d.pipeline) + '">' + d.path.stages.map(function (s) {
        return '<li class="' + s.state + '"' + (s.state === 'current' ? ' aria-current="step"' : '') + '><span>' + esc(s.name) + '</span>' + (s.state === 'current' ? '<span class="vh"> (current stage)</span>' : '') + '</li>';
      }).join('') + '</ol>'
      : '<p class="nd-path-off"><strong>' + esc(d.stage || 'No stage set') + '</strong>' + (d.stage ? ' <span>not in this pipeline’s list</span>' : '') + '</p>';
    var gate = d.gate ? '<p class="nd-gate"><span class="nd-gl">' + esc(d.gate.label) + '</span> ' + d.gate.items.map(mark).join(' <span aria-hidden="true">·</span> ') +
      (d.gate.note ? '<br>' + mark(d.gate.note) + ' <span class="nd-hint">(' + esc(d.gate.note.hint) + ')</span>' : '') + '</p>' : '';
    var margin = '<p class="nd-margin">Margin ' + (d.margin.pct != null ? esc(d.margin.pct) : '<span class="nd-hint">not set</span>') + ' <span class="chip ' + d.margin.tone + '">' + esc(d.margin.status) + '</span></p>';
    var n = d.next, nextWhy = n.kind === 'task' ? ['Task', n.due ? 'due ' + n.due : 'no due date', n.owner].filter(Boolean).join(' · ')
      : state.taskErr ? (n.kind === 'field' ? 'From the Next Step field.' : 'No Next Step on the deal.') + ' Tasks could not be read.'
      : n.kind === 'field' ? 'From the Next Step field. No open task.' : 'No open task and no Next Step on the deal.';
    var html = '<section class="ns-card ns-deal ' + esc(r.tone) + '" aria-label="Next step"><div class="ns-txt">' + strip + path + gate + margin +
      '<div class="nd-next"><p class="ns-eye nd-eye">Next step</p><p class="ns-title">' + esc(r.title) + '</p><p class="ns-why">' + esc(nextWhy) + '</p></div></div>' +
      '<div class="ns-act">' + (r.primary ? '<button type="button" class="btn pri" data-k="p">' + esc(r.primary.label) + '</button>' : '') + (r.secondary ? '<button type="button" class="btn" data-k="s">' + esc(r.secondary.label) + '</button>' : '') + '</div><div class="ns-err" hidden></div></section>';
    root.setAttribute('data-stage-source', state.stageSrc || '');
    return { r: r, html: html };
  }
  function paint(o) {
    var sk = root.querySelector('.ns-load'); if (sk) sk.parentNode.removeChild(sk);
    var holder = root.querySelector('.ns-body');
    if (!holder) { holder = document.createElement('div'); holder.className = 'ns-body'; root.appendChild(holder); }
    holder.innerHTML = o.html;
    holder.onclick = function (e) {
      var b = e.target.closest('button[data-k]'); if (!b) return;
      act(b.getAttribute('data-k') === 'p' ? o.r.primary : o.r.secondary, holder.querySelector('.ns-err'));
    };
    setTimeout(resize, 30);
  }
  function loadTasks(dealId) {
    var id = String(dealId).replace(/[^0-9]/g, '');
    return ZOHO.CRM.API.coql({ select_query: "select id, Subject, Due_Date, Status, Owner.first_name, Owner.last_name from Tasks where What_Id = '" + id + "' and Status != 'Completed' order by Due_Date asc limit 50" })
      .then(function (res) {
        return ((res && res.data) || []).map(function (x) { return { Subject: x.Subject, Due_Date: x.Due_Date, Status: x.Status, Owner: { first_name: x['Owner.first_name'], last_name: x['Owner.last_name'] } }; });
      });
  }
  function loadStages() {
    var fallback = function () { state.stageSrc = 'map'; return window.NS_DEAL_STAGES || {}; };
    if (!ZOHO.CRM.META || !ZOHO.CRM.META.getLayouts) return Promise.resolve(fallback());
    return Promise.resolve(ZOHO.CRM.META.getLayouts({ Entity: 'Deals' })).then(function (res) {
      var live = M.stagesFromLayouts(res);
      if (!live) return fallback();
      state.stageSrc = 'live'; return live;
    }, fallback);
  }
  function loadDeal(rec) {
    state.taskErr = false;
    return Promise.all([
      loadTasks(rec.id).then(null, function () { state.taskErr = true; return []; }),
      loadStages()
    ]).then(function (v) { state.tasks = v[0]; state.stages = v[1]; return null; });
  }

  function render() {
    if (state.module === 'Deals') return paint(renderDeal());
    var r = M.compute(state.module, state.rec, { now: new Date(), contact: state.contact });
    var bar = state.demo ? root.querySelector('.demo') : null;
    var html = '';
    if (r.none) {
      html = '<section class="ns-card none" aria-label="Next step"><div class="ns-txt"><p class="ns-eye">Next step</p><p class="ns-title">' + esc(r.title) + '</p></div></section>';
    } else {
      html = '<section class="ns-card ' + esc(r.tone) + '" aria-label="Next step"><div class="ns-txt"><p class="ns-eye">Next step</p><p class="ns-title">' + esc(r.title) + '</p><p class="ns-why">' + esc(r.why) + '</p></div>' +
        '<div class="ns-act">' + (r.primary ? '<button type="button" class="btn pri" data-k="p">' + esc(r.primary.label) + '</button>' : '') + (r.secondary ? '<button type="button" class="btn" data-k="s">' + esc(r.secondary.label) + '</button>' : '') + '</div><div class="ns-err" hidden></div></section>';
    }
    var sk = root.querySelector('.ns-load'); if (sk) sk.parentNode.removeChild(sk);
    var holder = root.querySelector('.ns-body');
    if (!holder) { holder = document.createElement('div'); holder.className = 'ns-body'; root.appendChild(holder); }
    holder.innerHTML = html;
    holder.onclick = function (e) {
      var b = e.target.closest('button[data-k]'); if (!b) return;
      act(b.getAttribute('data-k') === 'p' ? r.primary : r.secondary, holder.querySelector('.ns-err'));
    };
    setTimeout(resize, 30);
  }

  function act(a, errEl) {
    if (!a) return;
    var f = M.formFor(a.kind, state.module, state.rec, { contact: state.contact });
    errEl.hidden = true;
    if (state.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI) {
      toast('Demo: would open Zoho’s ' + (f.api === 'edit' ? 'edit form for this record' : 'new ' + f.Entity.toLowerCase().replace(/s$/, '') + ' form') + ' (nothing is saved)');
      window.__lastForm = f; return;
    }
    var p = f.api === 'edit' ? ZOHO.CRM.UI.Record.edit({ Entity: f.Entity, RecordID: f.RecordID }) : ZOHO.CRM.UI.Record.create({ Entity: f.Entity, RecordData: f.RecordData });
    Promise.resolve(p).catch(function (e) { errEl.hidden = false; errEl.textContent = 'Could not open the form: ' + ((e && (e.message || e.code)) || 'unknown error'); resize(); });
  }

  function loadContact(accountId) {
    if (!accountId || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.API) return Promise.resolve(null);
    return ZOHO.CRM.API.coql({ select_query: "select id, Full_Name from Contacts where Account_Name = '" + String(accountId).replace(/[^0-9]/g, '') + "' order by Modified_Time desc limit 1" })
      .then(function (res) { var x = res && res.data && res.data[0]; return x ? { id: x.id, name: x.Full_Name } : null; }, function () { return null; });
  }

  function startDemo() {
    state.demo = true;
    var bar = document.createElement('div'); bar.className = 'demo';
    bar.innerHTML = '<label>Demo case <select id="ns-pick">' + window.NS_DEMO.map(function (d, i) { return '<option value="' + i + '">' + esc(d.label) + '</option>'; }).join('') + '</select></label><span>Writes are blocked.</span>';
    root.innerHTML = ''; root.appendChild(bar);
    function pick(i) { var d = window.NS_DEMO[i]; state.module = d.module; state.rec = d.rec; state.contact = d.contact; render(); }
    bar.querySelector('select').addEventListener('change', function (e) { pick(+e.target.value); });
    var q = /[?&]case=(\d+)/.exec(location.search); var i0 = q ? +q[1] : 0; bar.querySelector('select').value = String(i0); pick(i0);
    var th = /[?&]theme=(dark|light)/.exec(location.search); if (th) document.documentElement.setAttribute('data-theme', th[1]);
  }

  function startZoho() {
    ZOHO.embeddedApp.on('PageLoad', function (d) {
      var entity = d.Entity, id = Array.isArray(d.EntityId) ? d.EntityId[0] : d.EntityId;
      state.module = entity;
      if (((S13 && M.MODULES_S13) || M.MODULES || ['Contracts', 'Accounts']).indexOf(entity) < 0) { root.innerHTML = '<div class="ns-body"><section class="ns-card none"><div class="ns-txt"><p class="ns-title">Next step is not set up for this module</p></div></section></div>'; resize(); return; }
      ZOHO.CRM.API.getRecord({ Entity: entity, RecordID: id }).then(function (res) {
        var rec = res && res.data && res.data[0];
        if (!rec) throw new Error('Record not found');
        state.rec = rec;
        if (entity === 'Deals') return loadDeal(rec);
        if (entity === 'Cases' && rec.Related_To && rec.Related_To.id) return { id: rec.Related_To.id, name: rec.Related_To.name };
        var acct = entity === 'Contracts' ? (rec.Account && rec.Account.id) : entity === 'Accounts' ? rec.id : entity === 'Cases' ? (rec.Account_Name && rec.Account_Name.id) : null;
        return loadContact(acct);
      }).then(function (c) { state.contact = c; render(); })
        .catch(function (e) { root.innerHTML = '<div class="ns-body"><section class="ns-card bad"><div class="ns-txt"><p class="ns-title">Next step could not load</p><p class="ns-why">' + esc((e && e.message) || 'Unknown error') + '</p></div></section></div>'; resize(); });
    });
    ZOHO.embeddedApp.init();
  }

  /* Demo data only when asked for with ?demo=1. Without Zoho the card says so instead of showing made-up data. */
  if (/[?&]demo=1/.test(location.search)) startDemo();
  else if (typeof window.ZOHO === 'undefined' || !ZOHO.embeddedApp) { root.innerHTML = '<div class="ns-body"><section class="ns-card none"><div class="ns-txt"><p class="ns-eye">Next step</p><p class="ns-title">Shows on a saved record</p><p class="ns-why">Zoho\u2019s script is not available here.</p></div></section></div>'; }
  else startZoho();
})();
