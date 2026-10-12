/* Solicitation intake wizard (claude/ux/solicitation-intake). Zoho CRM widget SDK 1.2.
 * Four steps: basics, dates, scope, packet. On Create:
 *   1. ZOHO.CRM.API.insertRecord Solicitations (Status Identified)
 *   2. optional insertRecord Bid_Scenarios (Prime, Active, Lead_Organization = scorecard)
 *   3. attachFile the packet to the Solicitation
 *   4. FUNCTIONS.execute sol_wizard_ingest(solicitationId, parsers), which calls the existing
 *      solicitation-pipeline ingest helper (same path as the record buttons).
 * Field map: STATUS.md in this folder. No AI, no external calls. */
(function () {
  'use strict';
  var S = { step: 0, account: null, products: [], busy: false, created: null };
  var $ = function (id) { return document.getElementById(id); };
  var LAST = 3;

  function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(text, kind) { var m = $('msg'); m.hidden = !text; m.className = 'msg ' + (kind || 'bad'); m.textContent = text || ''; }
  function checked(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + ' input:checked, ' + sel + ':checked'), function (i) { return i.value; }); }

  // datetime-local "2026-10-20T14:00" -> Zoho "2026-10-20T14:00:00-04:00" using the viewer's offset on that date
  function zdt(v) {
    if (!v) return null;
    var d = new Date(v), off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return v.slice(0, 16) + ':00' + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }
  function dayOf(v) { return v ? v.slice(0, 10) : ''; }

  /* ---------- validation per step ---------- */
  function check(step) {
    if (step === 0) {
      if (!val('Name')) return 'Give the solicitation a title.';
      if (!val('Solicitation_Type')) return 'Pick the type (RFP, RFI, RFQ or Sole Source).';
      if (!S.account && !val('Issuing_Agency_Text')) return 'Pick the funder Account, or type the agency name if it is not in the CRM yet.';
      return '';
    }
    if (step === 1) {
      if (!val('Proposal_Due')) return 'Proposal due is required: it drives Days To Deadline and the alert stages.';
      var r = val('Release_Date'), q = dayOf(val('Questions_Round_1_Due')), p = dayOf(val('Proposal_Due')), aw = val('Anticipated_Award'), st = val('Anticipated_Start');
      if (r && p < r) return 'Proposal due is before the release date.';
      if (q && q > p) return 'Questions are due after the proposal. Check the dates.';
      if (aw && aw < p) return 'Anticipated award is before the proposal is due.';
      if (st && aw && st < aw) return 'Anticipated start is before the award.';
      return '';
    }
    return '';
  }
  function softWarn() {
    var p = dayOf(val('Proposal_Due')), today = new Date().toISOString().slice(0, 10);
    $('dateWarn').textContent = p && p < today ? 'Proposal due is in the past. That is fine for a record you are back-filling.' : '';
  }

  /* ---------- navigation ---------- */
  function show(n) {
    S.step = n;
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (s) { s.hidden = Number(s.dataset.step) !== n; });
    Array.prototype.forEach.call(document.querySelectorAll('#steps li'), function (li) {
      var i = Number(li.dataset.s);
      if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('done', i < n);
    });
    $('back').disabled = n === 0 || S.busy;
    $('next').textContent = n === LAST ? 'Create solicitation' : 'Next';
    if (n === LAST) renderSummary();
    say('');
  }
  function next() {
    if (S.busy) return;
    if (S.created) { ZOHO.CRM.UI.Record.open({ Entity: 'Solicitations', RecordID: S.created }).then(close, close); return; }
    var err = check(S.step);
    if (err) { say(err); return; }
    if (S.step < LAST) { show(S.step + 1); return; }
    create();
  }
  function close() { try { ZOHO.CRM.UI.Popup.closeReload(); } catch (e) { try { ZOHO.CRM.UI.Popup.close(); } catch (e2) {} } }

  /* ---------- account search ---------- */
  var tmr = null;
  function searchAccounts() {
    var q = val('acctSearch');
    clearTimeout(tmr);
    if (q.length < 3) { $('acctResults').innerHTML = ''; return; }
    tmr = setTimeout(function () {
      ZOHO.CRM.API.searchRecord({ Entity: 'Accounts', Type: 'word', Query: q, page: 1, per_page: 8 }).then(function (r) {
        var rows = (r && r.data) || [];
        $('acctResults').innerHTML = rows.length ? rows.map(function (a) {
          return '<li role="option" tabindex="0" data-id="' + esc(a.id) + '" data-name="' + esc(a.Account_Name) + '">' + esc(a.Account_Name) +
            (a.Billing_State || a.State ? ' <span class="muted">' + esc(a.Billing_State || a.State) + '</span>' : '') + '</li>';
        }).join('') : '<li class="muted">No Account matches. Type the agency name below instead.</li>';
      });
    }, 250);
  }
  function pickAccount(li) {
    if (!li || !li.dataset.id) return;
    S.account = { id: li.dataset.id, name: li.dataset.name };
    $('acctResults').innerHTML = '';
    $('acctSearch').value = '';
    $('acctPicked').hidden = false;
    $('acctPicked').innerHTML = 'Account: <b>' + esc(S.account.name) + '</b> <button type="button" class="link" id="acctClear">change</button>';
  }

  /* ---------- devices (active Products) ---------- */
  function loadProducts() {
    ZOHO.CRM.API.coql({ select_query: "select id, Product_Name, Vendor_Name from Products where Product_Active = true order by Product_Name limit 200" }).then(function (r) {
      S.products = (r && r.data) || [];
      $('devices').innerHTML = S.products.length ? S.products.map(function (p) {
        return '<label><input type="checkbox" value="' + esc(p.Product_Name) + '">' + esc(p.Product_Name) + '</label>';
      }).join('') : '<span class="hint">No active products found.</span>';
    }, function () { $('devices').innerHTML = '<span class="hint">Could not read Products. Note devices in the scope summary.</span>'; });
  }

  /* ---------- payloads ---------- */
  function solicitationPayload() {
    var devices = checked('#devices'), summary = val('Service_Type_Summary'), budget = val('Stated_Budget');
    if (devices.length) summary = (summary ? summary + '\n' : '') + 'Devices: ' + devices.join('; ');
    var d = {
      Name: val('Name'),
      Solicitation_Type: val('Solicitation_Type'),
      Status: 'Identified',
      Date_Received: new Date().toISOString().slice(0, 10)
    };
    var put = function (k, v) { if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) d[k] = v; };
    put('Solicitation_Number', val('Solicitation_Number'));
    if (S.account) d.Issuing_Agency = { id: S.account.id };
    put('Issuing_Agency_Text', val('Issuing_Agency_Text') || (S.account ? S.account.name : ''));
    put('Governing_State', val('Governing_State'));
    put('Portal_URL', val('Portal_URL'));
    put('Release_Date', val('Release_Date'));
    put('Questions_Round_1_Due', zdt(val('Questions_Round_1_Due')));
    put('Proposal_Due', zdt(val('Proposal_Due')));
    put('Deadline_Timezone_Note', val('Deadline_Timezone_Note'));
    put('Anticipated_Award', val('Anticipated_Award'));
    put('Anticipated_Start', val('Anticipated_Start'));
    put('Service_Lines', checked('#Service_Lines'));
    put('Working_Volume_Estimate', val('Working_Volume_Estimate'));
    if (budget) { d.Stated_Budget = Number(budget); d.Budget_Disclosed = true; }
    put('Service_Type_Summary', summary);
    put('Extraction_Notes', 'Created with the intake wizard ' + new Date().toISOString().slice(0, 10) + '. Scorecard: ' + val('Lead_Organization') + '.');
    return d;
  }
  function scenarioPayload(solId) {
    var devices = checked('#devices');
    var d = {
      Name: (val('Lead_Organization') + ' Prime - ' + val('Name')).slice(0, 120),
      Solicitation: { id: solId },
      Scenario_Type: 'Prime',
      Lead_Organization: val('Lead_Organization'),
      Scenario_Status: 'Active',
      Recommendation: 'Not yet scored'
    };
    if (devices.length) d.Device_Lineup = devices.join('\n');
    return d;
  }

  function renderSummary() {
    var d = solicitationPayload(), f = $('packet').files[0];
    var rows = [
      ['Title', d.Name], ['Type', d.Solicitation_Type], ['Agency', S.account ? S.account.name + ' (Account)' : d.Issuing_Agency_Text],
      ['Scorecard', val('Lead_Organization')], ['Proposal due', val('Proposal_Due').replace('T', ' ')],
      ['Services', (d.Service_Lines || []).join(', ')], ['Packet', f ? f.name + ' (' + Math.round(f.size / 1024 / 1024 * 10) / 10 + ' MB)' : 'none yet']
    ];
    $('summary').innerHTML = '<h2>About to create</h2><dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1] || '-') + '</dd>'; }).join('') + '</dl>';
  }

  /* ---------- duplicate check ---------- */
  function dupCheck() {
    var num = val('Solicitation_Number'), name = val('Name').replace(/'/g, "\\'");
    var where = num ? "Solicitation_Number = '" + num.replace(/'/g, "\\'") + "'" : "Name = '" + name + "'";
    return ZOHO.CRM.API.coql({ select_query: 'select id, Name from Solicitations where ' + where + ' limit 1' }).then(function (r) {
      return (r && r.data && r.data[0]) || null;
    }, function () { return null; });
  }

  /* ---------- create ---------- */
  function fail(step, e) {
    S.busy = false; $('next').disabled = false; $('back').disabled = false;
    var detail = '';
    try { detail = (e && e.data && e.data[0] && e.data[0].message) || (e && e.message) || JSON.stringify(e); } catch (x) { detail = String(e); }
    say(step + ' failed: ' + detail);
  }
  function okId(r) { var row = r && r.data && r.data[0]; return row && row.code === 'SUCCESS' ? row.details.id : null; }

  function create() {
    var f = $('packet').files[0];
    if (f && f.size > 20 * 1024 * 1024) { say('This file is over the 20 MB Zoho attachment limit. Leave the packet empty, create, and attach from SharePoint later.'); return; }
    S.busy = true; $('next').disabled = true; $('back').disabled = true;
    say('Checking for an existing record', 'info');
    dupCheck().then(function (dup) {
      if (dup && !S.dupOk) {
        S.busy = false; $('next').disabled = false; $('back').disabled = false; S.dupOk = true;
        say('"' + dup.Name + '" already exists with this number or title. Press Create again to make a second one anyway.', 'warn');
        return;
      }
      say('Creating the solicitation', 'info');
      ZOHO.CRM.API.insertRecord({ Entity: 'Solicitations', APIData: solicitationPayload(), Trigger: ['workflow'] }).then(function (r) {
        var solId = okId(r);
        if (!solId) return fail('Create solicitation', r);
        S.created = solId;
        var chain = Promise.resolve();
        var notes = ['Solicitation created.'];
        if ($('makeScenario').checked) {
          chain = chain.then(function () {
            return ZOHO.CRM.API.insertRecord({ Entity: 'Bid_Scenarios', APIData: scenarioPayload(solId), Trigger: ['workflow'] }).then(function (r2) {
              notes.push(okId(r2) ? 'First Bid Scenario created.' : 'Bid Scenario was not created; add it from the record.');
            }, function () { notes.push('Bid Scenario was not created; add it from the record.'); });
          });
        }
        if (f) {
          chain = chain.then(function () {
            say('Uploading ' + f.name, 'info');
            return ZOHO.CRM.API.attachFile({ Entity: 'Solicitations', RecordID: solId, File: { Name: f.name, Content: f } }).then(function () {
              notes.push('Packet attached.');
              var parsers = checked('input[name=parser]');
              if (!parsers.length) { notes.push('No parsers chosen; run ingest from the record when ready.'); return; }
              say('Starting the ingest', 'info');
              return ZOHO.CRM.FUNCTIONS.execute('sol_wizard_ingest', { arguments: JSON.stringify({ solicitationId: String(solId), parsers: parsers.join(',') }) }).then(function (x) {
                var out = x && x.details && (x.details.output || x.details.userMessage);
                notes.push(out ? String(out) : 'Ingest requested. The pipeline posts a Note on the record when it finishes.');
              }, function () { notes.push('Ingest did not start. Press the ingest button on the record.'); });
            }, function () { notes.push('Packet upload failed. Attach it on the record, then press the ingest button.'); });
          });
        }
        chain.then(function () {
          S.busy = false; $('next').disabled = false; $('back').disabled = true;
          $('next').textContent = 'Open the record';
          $('cancel').textContent = 'Close';
          notes.push('When requirements are in, press "Seed spec assessments" on the record.');
          say(notes.join(' '), 'good');
        });
      }, function (e) { fail('Create solicitation', e); });
    });
  }

  /* ---------- wire up ---------- */
  function wire() {
    $('next').addEventListener('click', next);
    $('back').addEventListener('click', function () { if (S.step > 0) show(S.step - 1); });
    $('cancel').addEventListener('click', close);
    $('acctSearch').addEventListener('input', searchAccounts);
    $('acctResults').addEventListener('click', function (e) { pickAccount(e.target.closest('li')); });
    $('acctResults').addEventListener('keydown', function (e) { if (e.key === 'Enter') pickAccount(e.target.closest('li')); });
    $('acctPicked').addEventListener('click', function (e) { if (e.target.id === 'acctClear') { S.account = null; $('acctPicked').hidden = true; $('acctSearch').focus(); } });
    $('Proposal_Due').addEventListener('change', softWarn);
    $('Name').addEventListener('input', function () { S.dupOk = false; });
    $('Solicitation_Number').addEventListener('input', function () { S.dupOk = false; });
  }

  ZOHO.embeddedApp.on('PageLoad', function (ctx) {
    wire();
    loadProducts();
    // Opened from an Account (or a home page passing an Account id): pre-pick it.
    var aid = ctx && (ctx.accountId || (ctx.Entity === 'Accounts' && ctx.EntityId && [].concat(ctx.EntityId)[0]));
    if (aid) {
      ZOHO.CRM.API.getRecord({ Entity: 'Accounts', RecordID: aid }).then(function (r) {
        var a = r && r.data && r.data[0];
        if (a) pickAccount({ dataset: { id: a.id, name: a.Account_Name } });
      });
    }
    try { ZOHO.CRM.UI.Resize({ height: '640', width: '760' }); } catch (e) {}
    show(0);
  });
  ZOHO.embeddedApp.init();
})();
