/* Billing Findings widget. Reads only, except two Administrator-only actions: 'Dispute with vendor' sets Status on selected Open findings, and 'Assign' sets Owner on selected findings. Uses the shared JPK kit (jpk v1.1.0) and FindingsModel (pure logic).
   Participant column = Billing_Findings.Subject (initials + device id written by the pipeline). No new field. */
(function () {
  'use strict';
  var M = window.FindingsModel, esc = JPK.esc;
  var FIELDS = 'id, Period, Vendor, Check_ID, Category, Severity, Money_Type, Status, Is_Open, Dollars, Subject';
  var PERIOD_FIELDS = 'id, Name, Period, Period_Status, Upload_Vendor, Findings_Total, Findings_Open';
  var $ = function (s) { return document.querySelector(s); };

  var S = { demo: false, periods: [], cache: {}, period: null, rows: [], filter: {}, matrixTbl: null, detailTbl: null, seq: 0 };

  function money(v) { return '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function showErr(msg) { var e = $('#err'); e.hidden = !msg; e.textContent = msg || ''; }
  var SEV_TONE = { CRITICAL: 'bad', HIGH: 'bad', MEDIUM: 'warn', LOW: 'info', INFO: 'neutral' };

  /* ---------- data ---------- */
  function loadPeriods() {
    if (S.demo) return Promise.resolve(window.FINDINGS_DEMO.periods);
    return JPK.crm.coqlAll('select ' + PERIOD_FIELDS + ' from Billing_Periods where id is not null');
  }
  function loadRows(period) {
    if (S.cache[period]) return Promise.resolve(S.cache[period]);
    var p = S.demo
      ? Promise.resolve(window.FINDINGS_DEMO.rows.filter(function (r) { return r.Period === period; }))
      /* COQL group by / count fails on this org, so pull rows (200 per page) and count in FindingsModel. */
      : JPK.crm.coqlAll("select " + FIELDS + " from Billing_Findings where Period = '" + period.replace(/[^0-9-]/g, '') + "'");
    return p.then(function (rows) { S.cache[period] = M.normalizeAll(rows); return S.cache[period]; });
  }
  function fetchDetail(row) {
    /* Long text fields are read per record (not through COQL). */
    if (S.demo) return Promise.resolve({ Description: 'Demo finding. In Zoho this shows the tool description.', Recommended_Action: 'Demo action.', Decision_Notes: '' });
    return ZOHO.CRM.API.getRecord({ Entity: 'Billing_Findings', RecordID: row.id }).then(function (r) {
      return (r && r.data && r.data[0]) || {};
    });
  }

  /* ---------- render ---------- */
  function renderTiles(rows, t) {
    var tiles = [
      ['Findings', t.total, ''],
      ['Open', t.open, t.closed + ' resolved'],
      ['Overbilled', money(t.overbilledDollars), (t.byMoney.Overbilled || 0) + ' findings'],
      ['Unverified', t.byMoney.Unverified || 0, 'money not yet checked']
    ];
    $('#tiles').innerHTML = tiles.map(function (x) {
      return '<div class="tile"><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b>' + (x[2] ? '<i>' + esc(x[2]) + '</i>' : '') + '</div>';
    }).join('');
    $('#sev-legend').innerHTML = M.SEVERITY_ORDER.filter(function (s) { return t.bySeverity[s]; }).map(function (s) {
      return JPK.chip(s + ' ' + t.bySeverity[s], SEV_TONE[s]);
    }).join(' ');
  }

  function renderRecon(rows) {
    var el = $('#recon'), p = S.period;
    if (!p) { el.hidden = true; return; }
    var r = M.reconcile(p, rows);
    el.hidden = false; el.className = 'next ' + (r.ok ? 'good' : 'bad');
    el.innerHTML = '<div class="nt"><b>' + (r.ok ? 'Counts match the period record' : 'Counts do not match the period record') + '</b><span>' +
      esc(r.ok ? (p.total == null ? 'No run has written counts for this period yet.' : p.total + ' findings, ' + p.open + ' open.') : r.notes.join(' ')) + '</span></div>';
  }

  function cellBtn(v, n, key) {
    if (!n) return '<span class="mx-zero" aria-label="none">0</span>';
    var on = false;
    return '<button type="button" class="mx-btn" data-v="' + esc(v) + '" data-c="' + esc(key) + '" aria-pressed="' + on + '">' + n + '</button>';
  }

  function renderMatrix(rows) {
    var mx = M.matrix(rows);
    if (!rows.length) { S.matrixTbl = null; $('#matrix').innerHTML = '<div class="empty"><b>No findings for this period</b>The monthly check has not been run, or no zip was ingested yet.</div>'; return; }
    var cols = [{ key: 'vendor', label: 'Vendor', sortable: true, render: function (v) { return '<span class="vend">' + esc(v.vendor) + '</span>'; } }];
    mx.categories.forEach(function (c) {
      cols.push({ key: 'c:' + c, label: c, align: 'right', num: true, sortValue: function (v) { return (v.cells[c] || { total: 0 }).total; },
        render: function (v) { var x = v.cells[c]; return x ? cellBtn(v.vendor, x.total, c) : cellBtn(v.vendor, 0, c); } });
    });
    cols.push({ key: 'open', label: 'Open', align: 'right', num: true, sortable: true });
    cols.push({ key: 'total', label: 'Total', align: 'right', num: true, sortable: true });
    S.matrixTbl = JPK.table({ mount: '#matrix', columns: cols, rows: mx.vendors, caption: 'Findings by vendor and type',
      empty: { title: 'No findings', hint: '' } });
    /* Footer line with column totals (the table has no footer slot). */
    var f = document.createElement('div');
    f.className = 'sm muted'; f.style.marginTop = '8px';
    f.innerHTML = mx.categories.map(function (c) {
      return '<button type="button" class="lnk" data-cat="' + esc(c) + '">' + esc(c) + ' ' + mx.categoryTotals[c] + '</button>';
    }).join(' &middot; ');
    $('#matrix').appendChild(f);
  }

  /* ---------- wave B2: Dispute with vendor (Administrator only) ---------- */
  var DISPUTED = 'Disputed with vendor', MAX_BATCH = 100;
  S.canBatch = false; S.profile = '';
  function loadProfile() {
    if (S.demo) {
      var m = /[?&]profile=([^&]+)/.exec(location.search);
      S.profile = m ? decodeURIComponent(m[1]) : 'Administrator'; S.canBatch = JPK.model.canBatch(S.profile);
      return Promise.resolve();
    }
    return ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) {
      var u = r && r.users && r.users[0];
      S.profile = (u && u.profile && u.profile.name) || ''; S.canBatch = JPK.model.canBatch(S.profile);
    }, function () { S.canBatch = false; });
  }
  function boxEl() {
    var b = $('#dispute-box');
    if (!b) { b = document.createElement('div'); b.id = 'dispute-box'; b.className = 'dispute-box'; b.setAttribute('role', 'region'); b.setAttribute('aria-live', 'polite'); b.setAttribute('aria-label', 'Dispute with vendor'); b.hidden = true; $('#detail').parentNode.insertBefore(b, $('#detail')); }
    return b;
  }
  function say(html, focusSel) { var b = boxEl(); b.hidden = !html; b.innerHTML = html || ''; if (focusSel) { var f = b.querySelector(focusSel); if (f) f.focus(); } }
  function askDispute(rows) {
    var open = rows.filter(function (r) { return r.status === 'Open'; }), skip = rows.length - open.length;
    if (!open.length) { say('<p>None of the selected findings are <b>Open</b>, so there is nothing to dispute.</p><div class="row"><button type="button" class="btn sm" id="dp-no">Close</button></div>', '#dp-no'); wireBox(open); return; }
    if (open.length > MAX_BATCH) { say('<p>Select ' + MAX_BATCH + ' findings or fewer at a time. You selected ' + open.length + ' Open findings.</p><div class="row"><button type="button" class="btn sm" id="dp-no">Close</button></div>', '#dp-no'); wireBox(open); return; }
    say('<p><b>Mark ' + open.length + ' finding' + (open.length === 1 ? '' : 's') + ' as "' + DISPUTED + '"?</b> ' +
      (skip ? skip + ' selected finding' + (skip === 1 ? ' is' : 's are') + ' not Open and will be left alone. ' : '') +
      'This changes Status in Zoho on each record. You can change it back on the record.' + (S.demo ? ' <i>Demo mode: nothing is saved.</i>' : '') + '</p>' +
      '<div class="row"><button type="button" class="btn pri sm" id="dp-go">Mark as disputed</button><button type="button" class="btn sm" id="dp-no">Back</button></div>', '#dp-go');
    wireBox(open);
  }
  function wireBox(open) {
    var b = boxEl(), no = b.querySelector('#dp-no'), go = b.querySelector('#dp-go');
    if (no) no.addEventListener('click', function () { say(''); });
    if (go) go.addEventListener('click', function () { runDispute(open); });
  }
  function writeOne(r) {
    if (S.demo) return Promise.resolve(true);
    return ZOHO.CRM.API.updateRecord({ Entity: 'Billing_Findings', APIData: { id: r.id, Status: DISPUTED }, Trigger: [] }).then(function (res) {
      var d = res && res.data && res.data[0];
      return !!(d && String(d.code).toUpperCase() === 'SUCCESS');
    }, function () { return false; });
  }
  function runDispute(open) {
    var go = boxEl().querySelector('#dp-go'); if (go) go.disabled = true;
    say('<p>Saving ' + open.length + ' finding' + (open.length === 1 ? '' : 's') + '...</p>');
    var done = [], failed = [];
    open.reduce(function (p, r) {
      return p.then(function () { return writeOne(r).then(function (okk) { (okk ? done : failed).push(r); }); });
    }, Promise.resolve()).then(function () {
      done.forEach(function (r) { r.status = DISPUTED; });
      if (S.detailTbl) S.detailTbl.clearSelection();
      refresh();
      say('<p><b>' + done.length + ' marked as "' + DISPUTED + '".</b>' + (failed.length ? ' ' + failed.length + ' could not be saved: ' + failed.map(function (r) { return esc(r.participant || r.checkId); }).join(', ') + '. Check the record and try again.' : '') + (S.demo ? ' Demo mode: nothing was saved.' : '') + '</p><div class="row"><button type="button" class="btn sm" id="dp-no">Close</button></div>', '#dp-no');
      wireBox([]);
    });
  }

  /* ---------- wave B3: Assign (Administrator only). Sets Owner on the selected findings, nothing else. ---------- */
  var DEMO_USERS = [{ id: 'u1', name: 'Beau Carrigan' }, { id: 'u2', name: 'Stacey Loosen' }, { id: 'u3', name: 'Brittany Mueller' }];
  function loadUsers() {
    if (S.demo) return Promise.resolve(DEMO_USERS);
    return ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' }).then(function (r) {
      return ((r && r.users) || []).filter(function (u) { return u.id && (u.status == null || /^active$/i.test(u.status)); }).map(function (u) { return { id: String(u.id), name: u.full_name || u.email || 'Unknown user' }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    });
  }
  function askAssign(rows) {
    if (!rows.length) return;
    if (rows.length > MAX_BATCH) { say('<p>Select ' + MAX_BATCH + ' findings or fewer at a time. You selected ' + rows.length + '.</p><div class="row"><button type="button" class="btn sm" id="as-no">Close</button></div>', '#as-no'); wireAssign(rows, []); return; }
    say('<p>Loading people...</p>');
    loadUsers().then(function (users) {
      say('<p><b>Assign ' + rows.length + ' finding' + (rows.length === 1 ? '' : 's') + ' to someone.</b> This changes Owner in Zoho on each record; nothing else.' + (S.demo ? ' <i>Demo mode: nothing is saved.</i>' : '') + '</p>' +
        '<div class="jp-fld"><label for="as-to">Assign to</label><select id="as-to"><option value="">Choose a person</option>' + users.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>'; }).join('') + '</select><span class="msg" id="as-err" role="alert" hidden></span></div>' +
        '<div class="row"><button type="button" class="btn pri sm" id="as-go">Assign</button><button type="button" class="btn sm" id="as-no">Back</button></div>', '#as-to');
      wireAssign(rows, users);
    }, function () { say('<p>Could not load the list of people. Try again.</p><div class="row"><button type="button" class="btn sm" id="as-no">Close</button></div>', '#as-no'); wireAssign(rows, []); });
  }
  function wireAssign(rows, users) {
    var b = boxEl(), no = b.querySelector('#as-no'), go = b.querySelector('#as-go');
    if (no) no.addEventListener('click', function () { say(''); });
    if (go) go.addEventListener('click', function () {
      var sel = b.querySelector('#as-to'), to = sel.value, err = b.querySelector('#as-err');
      if (!to) { err.hidden = false; err.textContent = 'Error: Choose who to assign the findings to.'; sel.setAttribute('aria-invalid', 'true'); sel.focus(); return; }
      runAssign(rows, to, (users.filter(function (u) { return u.id === to; })[0] || {}).name || 'that person');
    });
  }
  function assignOne(r, to) {
    if (S.demo) return Promise.resolve(true);
    return ZOHO.CRM.API.updateRecord({ Entity: 'Billing_Findings', APIData: { id: r.id, Owner: { id: to } }, Trigger: [] }).then(function (res) {
      var d = res && res.data && res.data[0]; return !!(d && String(d.code).toUpperCase() === 'SUCCESS');
    }, function () { return false; });
  }
  function runAssign(rows, to, name) {
    var go = boxEl().querySelector('#as-go'); if (go) go.disabled = true;
    say('<p>Saving ' + rows.length + ' finding' + (rows.length === 1 ? '' : 's') + '...</p>');
    var done = [], failed = [];
    rows.reduce(function (p, r) { return p.then(function () { return assignOne(r, to).then(function (okk) { (okk ? done : failed).push(r); }); }); }, Promise.resolve()).then(function () {
      if (S.detailTbl) S.detailTbl.clearSelection();
      say('<p><b>' + done.length + ' assigned to ' + esc(name) + '.</b>' + (failed.length ? ' ' + failed.length + ' could not be saved: ' + failed.map(function (r) { return esc(r.participant || r.checkId); }).join(', ') + '. Check the record and try again.' : '') + (S.demo ? ' Demo mode: nothing was saved.' : '') + '</p><div class="row"><button type="button" class="btn sm" id="as-no">Close</button></div>', '#as-no');
      wireAssign([], []);
    });
  }

  function renderDetail() {
    var list = M.detail(S.rows, S.filter);
    var cols = [
      { key: 'participant', label: 'Participant', primary: true, sortable: true, render: function (r) { return '<span class="part">' + esc(r.participant || '(none)') + '</span>'; } },
      { key: 'checkId', label: 'Check', sortable: true, render: function (r) { return '<span class="mono">' + esc(r.checkId) + '</span>'; } },
      { key: 'category', label: 'Type', sortable: true },
      { key: 'severity', label: 'Severity', sortable: true, sortValue: function (r) { return M.sevRank(r.severity); }, render: function (r) { return JPK.chip(r.severity, SEV_TONE[r.severity]); } },
      { key: 'moneyType', label: 'Money', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: function (r) { return JPK.chip(r.status, r.open ? 'warn' : 'good'); } },
      { key: 'dollars', label: 'Dollars', align: 'right', num: true, sortable: true, render: function (r) { return r.dollars ? esc(money(r.dollars)) : ''; } }
    ];
    $('#dt-sub').textContent = list.length + ' of ' + S.rows.length;
    if (!S.detailTbl) {
      S.detailTbl = JPK.table({ mount: '#detail', columns: cols, rows: list, caption: 'Billing findings', cards: true, expand: evidenceFor,
        select: S.canBatch ? { allowed: true, rowId: function (r) { return r.id; }, noun: 'finding', sum: function (r) { return r.dollars; }, sumLabel: 'Dollars',
          actions: [{ label: 'Dispute with vendor', onClick: function (rows) { askDispute(rows); } }, { label: 'Assign', onClick: function (rows) { askAssign(rows); } }] } : undefined,
        expandLabel: function (r) { return 'Show evidence for ' + (r.participant || r.checkId); },
        empty: { title: 'Nothing matches', hint: 'Clear the filter or untick Open only.' } });
    } else S.detailTbl.setRows(list);
    var f = S.filter, bits = [];
    if (f.vendor) bits.push('Vendor: ' + f.vendor);
    if (f.category) bits.push('Type: ' + f.category);
    if (f.checkId) bits.push('Check: ' + f.checkId);
    $('#active-filter').innerHTML = bits.length
      ? bits.map(function (b) { return JPK.chip(b, 'info'); }).join(' ') + ' <button type="button" class="lnk" id="clear-f">Clear</button>'
      : '<span class="muted sm">Showing every finding in the period</span>';
    var c = $('#clear-f'); if (c) c.addEventListener('click', function () { S.filter = { openOnly: S.filter.openOnly }; refresh(); });
  }


  /* ---------- wave B: evidence under each row (read-only) ---------- */
  S.detailCache = {};
  function evidenceFor(r) {
    var box = document.createElement('div');
    box.className = 'jp-ev';
    box.innerHTML = '<div><h4>Finding</h4><dl><div><dt>Check</dt><dd>' + esc(r.checkId) + '</dd></div><div><dt>Type</dt><dd>' + esc(r.category) + '</dd></div>' +
      '<div><dt>Money</dt><dd>' + esc(r.moneyType) + '</dd></div><div><dt>Dollars</dt><dd>' + esc(money(r.dollars)) + '</dd></div><div><dt>Status</dt><dd>' + esc(r.status) + '</dd></div></dl></div>' +
      '<div><h4>What the tool found</h4><p class="ev-a muted sm">Loading...</p></div>' +
      '<div><h4>Recommended action</h4><p class="ev-b muted sm">Loading...</p><h4 style="margin-top:10px">Decision notes</h4><p class="ev-c muted sm">Loading...</p></div>';
    var p = S.detailCache[r.id] ? Promise.resolve(S.detailCache[r.id]) : fetchDetail(r).then(function (d) { S.detailCache[r.id] = d; return d; });
    p.then(function (d) {
      function put(sel, v, empty) { var e = box.querySelector(sel); e.textContent = v || empty; e.className = (v ? 'dr-long ' : 'muted sm ') + sel.slice(1); }
      put('.ev-a', d.Description, 'No description recorded.'); put('.ev-b', d.Recommended_Action, 'None recorded.'); put('.ev-c', d.Decision_Notes, 'None recorded.');
    }, function (e) { Array.prototype.forEach.call(box.querySelectorAll('p'), function (x) { x.textContent = 'Could not load: ' + e.message; }); });
    return box;
  }

  function openRow(r) {
    JPK.drawer.open({ title: (r.participant || 'Finding') + ' · ' + r.checkId,
      html: '<dl class="dl"><dt>Type</dt><dd>' + esc(r.category) + '</dd><dt>Severity</dt><dd>' + esc(r.severity) + '</dd><dt>Money</dt><dd>' + esc(r.moneyType) +
        '</dd><dt>Status</dt><dd>' + esc(r.status) + '</dd><dt>Dollars</dt><dd>' + esc(money(r.dollars)) + '</dd></dl><div class="muted sm" id="dr-load">Loading detail...</div><div id="dr-long"></div>',
      onMount: function (body) {
        fetchDetail(r).then(function (d) {
          var el = body.querySelector('#dr-long'); if (!el) return;
          body.querySelector('#dr-load').hidden = true;
          var parts = [['What the tool found', d.Description], ['Recommended action', d.Recommended_Action], ['Decision notes', d.Decision_Notes]];
          el.innerHTML = parts.filter(function (p) { return p[1]; }).map(function (p) {
            return '<div class="eyebrow">' + esc(p[0]) + '</div><p class="dr-long">' + esc(p[1]) + '</p>';
          }).join('') || '<p class="muted sm">No description recorded.</p>';
        }, function (e) { var l = body.querySelector('#dr-load'); if (l) l.textContent = 'Could not load detail: ' + e.message; });
      } });
  }

  function refresh() {
    renderMatrixPressed(); renderDetail();
    $('#open-only').checked = !!S.filter.openOnly;
  }
  function renderMatrixPressed() {
    Array.prototype.forEach.call(document.querySelectorAll('.mx-btn'), function (b) {
      var on = S.filter.vendor === b.getAttribute('data-v') && S.filter.category === b.getAttribute('data-c');
      b.setAttribute('aria-pressed', on);
    });
  }

  function showPeriod(period) {
    var mySeq = ++S.seq;
    showErr('');
    S.period = S.periods.filter(function (p) { return p.period === period; })[0] || null;
    S.filter = {}; S.detailTbl = null; $('#detail').innerHTML = '';
    $('#ctx').textContent = S.period ? S.period.name + ' · ' + (S.period.status || 'no status') + (S.period.uploadVendor ? ' · upload: ' + S.period.uploadVendor : '') : period;
    $('#tiles').innerHTML = '<div class="muted sm">Loading findings...</div>';
    loadRows(period).then(function (rows) {
      if (mySeq !== S.seq) return;            /* a newer period was picked meanwhile */
      S.rows = rows;
      var t = M.totals(rows);
      $('#sum-sub').textContent = period;
      renderTiles(rows, t); renderRecon(rows); renderMatrix(rows); renderDetail();
    }, function (e) { if (mySeq === S.seq) { $('#tiles').innerHTML = ''; showErr('Could not load findings: ' + e.message); } });
  }

  /* ---------- events ---------- */
  $('#matrix').addEventListener('click', function (e) {
    var b = e.target.closest('.mx-btn');
    if (b) {
      var same = S.filter.vendor === b.getAttribute('data-v') && S.filter.category === b.getAttribute('data-c');
      S.filter = same ? { openOnly: S.filter.openOnly } : { vendor: b.getAttribute('data-v'), category: b.getAttribute('data-c'), openOnly: S.filter.openOnly };
      refresh(); return;
    }
    var c = e.target.closest('[data-cat]');
    if (c) { S.filter = { category: c.getAttribute('data-cat'), openOnly: S.filter.openOnly }; refresh(); }
  });
  $('#open-only').addEventListener('change', function (e) { S.filter.openOnly = e.target.checked; refresh(); });
  $('#period').addEventListener('change', function (e) { showPeriod(e.target.value); });
  JPK.aboutButton({ button: '#help', title: 'About billing findings', html:
    '<p>Findings are written by the monthly billing check, one zip per vendor per month. This page only reads them.</p>' +
    '<p><b>Participant</b> is the initials and device ID the check records in each finding.</p>' +
    '<p><b>Type</b> is the check category. Click a count to list those findings, use the arrow at the start of a row to show the description and recommended action under it. Change a finding\'s status on the record itself.</p>' });

  /* ---------- start ---------- */
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (ctx) {
    S.demo = forceDemo || !!(ctx && ctx.demo);
    $('#demo-note').hidden = !S.demo;
    return loadProfile().then(loadPeriods).then(function (raw) {
      S.periods = M.sortPeriods(raw.map(M.normalizePeriod));
      if (!S.periods.length) { $('#ctx').textContent = 'No billing periods yet.'; $('#matrix').innerHTML = '<div class="empty"><b>No billing periods</b></div>'; return; }
      $('#period').innerHTML = S.periods.map(function (p) { return '<option value="' + esc(p.period) + '">' + esc(p.name + ' (' + (p.status || 'no status') + ')') + '</option>'; }).join('');
      /* Opened from a Billing Period record: start on that period. Otherwise newest period that has findings. */
      var start = null;
      if (ctx && ctx.EntityId) { var id = [].concat(ctx.EntityId)[0]; S.periods.forEach(function (p) { if (p.id === id) start = p.period; }); }
      if (!start) { var withData = S.periods.filter(function (p) { return p.total; })[0]; start = (withData || S.periods[0]).period; }
      $('#period').value = start;
      showPeriod(start);
    });
  }).catch(function (e) { $('#ctx').textContent = ''; showErr('Could not load billing periods: ' + e.message + '. These modules are Administrator-only.'); });
})();
