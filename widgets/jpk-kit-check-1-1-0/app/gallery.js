/* Kit check page. Example data only; nothing here reads or writes the CRM. */
(function () {
  'use strict';
  var J = window.JPK, $ = J.$, $$ = J.$$;
  var FAST = /[?&]fast\b/.test(location.search);
  var D = FAST ? 20 : 650;

  $('#ver').textContent = J.version;
  var dark = matchMedia('(prefers-color-scheme: dark)');
  function th() { $('#theme').textContent = document.documentElement.dataset.theme || (dark.matches ? 'Dark (device)' : 'Light (device)'); }
  th(); dark.addEventListener && dark.addEventListener('change', th);

  J.crm.init().then(function (d) { $('#env').textContent = d ? 'Zoho CRM' : 'Browser preview'; });

  /* example data */
  var CONTRACTS = [
    { n: 'Allied – vendor pricing (standard)', t: 'Vendor', s: 'Ingested' },
    { n: 'Allied – vendor pricing (Sheboygan)', t: 'Vendor', s: 'Ingested' },
    { n: 'SCRAM – vendor pricing', t: 'Vendor', s: 'Ingested' },
    { n: 'SuperCom – vendor pricing', t: 'Vendor', s: 'Needs Review' },
    { n: 'Buddi – vendor pricing', t: 'Vendor', s: 'Backlog' },
    { n: 'Example County Pretrial', t: 'Customer', s: 'Backlog' },
    { n: 'Example County Sheriff', t: 'Customer', s: 'Not Ingested' },
    { n: 'Example HHS Juvenile', t: 'Customer', s: 'Needs Review' }
  ];
  var PACKET = [
    { name: 'Master agreement.pdf', pages: 14, end: 'Parsed' },
    { name: 'Addendum 5 – Remote Breath.pdf', pages: 3, end: 'Parsed' },
    { name: 'Addendum 13 – Tiered pricing.pdf', pages: 4, end: 'Parsed' },
    { name: 'Addendum 19 – Spare level.pdf', pages: 2, end: 'Parsed' },
    { name: 'Addendum 21 – Two-piece.pdf', pages: 2, end: 'Parsed' },
    { name: 'Addendum 24 – 401+ and upper spares (scan).pdf', pages: 3, end: 'No text layer' },
    { name: 'Rate sheet 2026.xlsx', pages: null, end: 'Parsed' }
  ];

  /* header: More menu and About */
  var more = J.menu('#more', {
    items: [
      { label: 'Read this packet again', onClick: function () { if (state === 'ready') run(true); else J.toast('Add files first.'); } },
      { label: 'Switch light and dark', onClick: function () {
        var r = document.documentElement, now = r.dataset.theme || (dark.matches ? 'dark' : 'light');
        r.dataset.theme = now === 'dark' ? 'light' : 'dark'; th(); drawChart();
      } },
      { label: 'Clear and start over', onClick: reset }
    ]
  });
  $('#about').appendChild(J.aboutButton(
    'This page shows every shared part the new canvases and ingests are built from, so each one can be checked at phone width and in dark mode before a real screen uses it.',
    'pick a contract, choose files or use the example packet, then follow the strip at the top. Sort the Backlog columns and open a row.',
    'All data on this page is example data.'));

  /* tabs */
  var tb = J.tabs('#tabs', {
    tabs: [{ id: 'packet', label: 'This packet' }, { id: 'backlog', label: 'Backlog' }, { id: 'parts', label: 'Other parts' }],
    panes: { packet: $('#p-packet'), backlog: $('#p-backlog'), parts: $('#p-parts') },
    onChange: function (t) { if (t === 'parts') drawChart(); }
  });

  /* counterparty + contract select */
  var cp = 'Vendor';
  function fillContracts() {
    $('#contract').innerHTML = CONTRACTS.filter(function (c) { return c.t === cp; })
      .map(function (c) { return '<option>' + J.esc(c.n) + '</option>'; }).join('');
  }
  $('#cp').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    cp = b.dataset.k; $$('#cp button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); fillContracts();
  });
  fillContracts();

  /* ingest flow */
  var nx = J.next('#nx');
  var st = J.steps('#steps', ['Add files', 'Read files', 'Review', 'Hand off']);
  var fl = J.fileList('#files');
  var files = [], state = 'empty';
  J.dropzone('#drop', {
    title: 'Drop the packet here',
    hint: 'A .zip, or the PDFs and Excel files. Scanned PDFs need OCR on your PC first.',
    accept: '.zip,.pdf,.xlsx,.docx',
    extra: '<button class="btn" id="ex">Use example packet</button>',
    onFiles: function (list) {
      files = list.map(function (f) { return { name: f.name, pages: null, end: /scan/i.test(f.name) ? 'No text layer' : 'Parsed' }; });
      added();
    }
  });
  $('#ex').addEventListener('click', function () { files = PACKET.map(function (f) { return Object.assign({}, f); }); added(); });

  function lock(on) { $$('#cp button').forEach(function (b) { b.disabled = on; }); $('#contract').disabled = on; }
  function show(statusFor) {
    fl.set(files.map(function (f, i) {
      var s = statusFor(f, i);
      return {
        name: f.name, status: s,
        detail: s === 'No text layer' ? 'No text layer. Run OCR on your PC, then read again.' : (f.pages ? f.pages + ' pages' : (/\.xlsx$/i.test(f.name) ? 'Rate sheet' : '')),
        action: s === 'No text layer' ? { label: 'How to fix', onClick: ocrHelp } : null
      };
    }));
  }
  function ocrHelp() {
    J.drawer.open({
      title: 'This file needs OCR',
      html: '<p>The file is a scan, so it has no text the rules can read.</p><ol class="sm"><li>Open it on your PC and run OCR.</li><li>Save it with the same name.</li><li>Add it again and choose Read this packet again. Files already read are not read twice.</li></ol>'
    });
  }
  function added() {
    state = 'added'; $('#drop').hidden = true; $('#found').hidden = true;
    st.set(0);
    show(function () { return 'Waiting'; });
    nx.set({ title: files.length + ' files ready for ' + $('#contract').value + '.', sub: 'Reading uses rules only. Nothing is saved until you verify.', action: { label: 'Read files', onClick: function () { run(false); } } });
  }
  function run(again) {
    state = 'reading'; lock(true); st.set(1);
    var done = 0;
    show(function () { return 'Reading'; });
    nx.set({ title: 'Reading ' + files.length + ' files', sub: again ? 'Only new or changed files are read again.' : 'You can leave this screen; reading continues.', progress: 0 });
    (function step() {
      if (done >= files.length) return finish();
      done += 1;
      show(function (f, i) { return i < done ? f.end : 'Reading'; });
      nx.set({ title: 'Reading ' + files.length + ' files', sub: done + ' of ' + files.length + ' read.', progress: done / files.length * 100 });
      setTimeout(step, D);
    })();
  }
  function finish() {
    state = 'ready'; lock(false);
    var bad = files.filter(function (f) { return f.end === 'No text layer'; }).length;
    st.set(2);
    J.tiles('#found', [
      { label: 'Files read', value: files.length - bad, note: 'of ' + files.length },
      { label: 'Terms found', value: 9, note: 'dates, notice, state' },
      { label: 'Rate lines', value: 14, note: 'all unverified' },
      { label: 'Clauses', value: 3, note: 'proposed only' }
    ]);
    $('#found').hidden = false;
    nx.set(bad
      ? { tone: 'warn', title: bad + ' file needs OCR before review.', sub: 'You can review the rest now and add the fixed file later.', action: { label: 'Open review', onClick: openReview } }
      : { title: 'Ready for your review.', sub: 'Every value waits for you to confirm it.', action: { label: 'Open review', onClick: openReview } });
    J.toast('Packet read');
  }
  function openReview() {
    st.set(3);
    nx.set({ tone: 'done', title: 'Handed off to the Review Band.', sub: 'On a real contract this opens the Review Band at the top of the record.', action: { label: 'Back to Backlog', onClick: function () { tb.select('backlog'); } } });
    J.toast('Opened review (example)');
  }
  function reset() {
    files = []; state = 'empty'; lock(false); $('#drop').hidden = false; $('#found').hidden = true; fl.set([]); st.set(0);
    nx.set({ title: 'Pick the contract, then add its packet.', sub: 'Vendor contracts come first: Allied, SCRAM, SuperCom and Buddi.' });
  }
  reset();

  /* backlog table */
  var filt = 'Vendor';
  var t = J.table('#bl', {
    caption: 'Contracts still to read',
    columns: [
      { key: 'n', label: 'Contract' },
      { key: 't', label: 'Type', hideNarrow: true },
      { key: 's', label: 'Status', format: function (v) { return J.ingestChip(v); } },
      { key: 'go', label: '', sortable: false, hideNarrow: true, format: function (v, r) { return r.s === 'Ingested' ? '' : '<button class="btn sm" data-pick="' + J.esc(r.n) + '">Read packet</button>'; } }
    ],
    sort: { key: 'n', dir: 1 },
    empty: { title: 'Nothing left to read.', text: ' Every contract of this type is verified.' },
    onRow: function (r) {
      J.drawer.open({
        title: r.n,
        html: '<dl class="dl"><dt>Type</dt><dd>' + J.esc(r.t) + '</dd><dt>Status</dt><dd>' + J.ingestChip(r.s) + '</dd></dl><p class="sm muted">Example record.</p>',
        actions: r.s === 'Ingested' ? [] : [{ label: 'Read packet', primary: true, onClick: function (close) { close(); pick(r.n); } }]
      });
    }
  });
  function drawBacklog() {
    var rows = CONTRACTS.filter(function (c) { return filt === 'all' || c.t === filt; });
    t.setRows(rows);
    tb.count('backlog', CONTRACTS.filter(function (c) { return c.s !== 'Ingested'; }).length);
  }
  $('#bf').addEventListener('click', function (e) {
    var b = e.target.closest('.pill'); if (!b) return;
    filt = b.dataset.f; $$('#bf .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawBacklog();
  });
  $('#bl').addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (b) pick(b.dataset.pick); });
  function pick(name) {
    var c = CONTRACTS.filter(function (x) { return x.n === name; })[0];
    cp = c.t; $$('#cp button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.k === cp)); });
    fillContracts(); $('#contract').value = name; reset(); tb.select('packet');
    J.toast(name + ' selected');
  }
  drawBacklog();

  /* other parts */
  $('#chips').innerHTML = [J.chip('Neutral'), J.chip('Verified', 'good'), J.chip('Needs OCR', 'warn'), J.chip('Failed', 'bad'), J.chip('Reading', 'info'), J.chip('Small', 'good', true)].join('');
  $('#t1').addEventListener('click', function () { J.toast('Saved'); });
  var labs = [], pts = [];
  for (var i = 0; i < 30; i++) { var d = new Date(2026, 8, 11 + i); labs.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); pts.push(+(5.8 + Math.sin(i / 3) * 1.4 + i * 0.05).toFixed(1)); }
  function drawChart() {
    if ($('#p-parts').hidden) return;
    J.chart('#ch', { labels: labs, series: [{ name: 'Spare %', pts: pts, c: 'var(--s2)' }], ymin: 0, ymax: 20, t: 4, fy: function (v) { return Math.round(v) + '%'; }, fv: function (v) { return v.toFixed(1) + '%'; }, hline: 15, hlabel: 'Threshold 15%', aria: 'Example spare percentage, 30 days', h: 180 });
  }
})();
