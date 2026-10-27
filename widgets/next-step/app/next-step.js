/* Next step widget v1.0.6 (S12). Read-only: the buttons open Zoho's own forms, nothing is written from here. */
(function () {
  'use strict';
  var M = window.NextStepModel, root = document.getElementById('ns'), toastEl = document.getElementById('ns-toast'), tt = null;
  var state = { module: null, rec: null, contact: null, demo: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('on'); }, 3200); }
  function resize() { try { if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Resize) ZOHO.CRM.UI.Resize({ height: String(Math.ceil(document.documentElement.scrollHeight) + 4), width: '100%' }); } catch (e) { /* ignore */ } }

  function render() {
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
      if (entity !== 'Contracts' && entity !== 'Accounts') { root.innerHTML = '<div class="ns-body"><section class="ns-card none"><div class="ns-txt"><p class="ns-title">Next step is not set up for this module</p></div></section></div>'; resize(); return; }
      ZOHO.CRM.API.getRecord({ Entity: entity, RecordID: id }).then(function (res) {
        var rec = res && res.data && res.data[0];
        if (!rec) throw new Error('Record not found');
        state.rec = rec;
        var acct = entity === 'Contracts' ? (rec.Account && rec.Account.id) : rec.id;
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
