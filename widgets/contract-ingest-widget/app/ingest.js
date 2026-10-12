/* Contract Ingest widget (Web Tab; also works opened from a Contract record).
   Screen only: it uploads files to the Contract, calls the standalone function contract_ingest_start,
   then reads Contract_Documents / Contracts / Contract_Clauses to show progress. No AI calls, no writes beyond
   the attachment upload. In demo mode (no Zoho SDK) it runs on sample data. */
(function () {
  'use strict';
  var J = window.JPK, esc = J.esc;
  var POLL_MS = 5000, POLL_MAX_MS = 10 * 60 * 1000;
  var DEMO_STEP = 300;

  var S = {
    demo: false,
    contracts: [],            /* {id, name, type, status} */
    cp: 'Vendor',
    sel: '',                  /* contract id */
    local: [],                /* files chosen this session: {name,size,file,started,attId} */
    docs: [],                 /* Contract_Documents rows for the selected contract */
    c: null,                  /* selected contract live fields: {status,on,summary,rates,proposedRates} */
    clauses: null,            /* {n, proposed} */
    phase: 'idle',            /* idle | uploading | reading */
    progress: 0,
    base: null,               /* {status,on} when a read was started */
    err: null,                /* {title, sub} */
    timedOut: false,
    startedAt: null,          /* ISO time the start function was called */
    note: null,               /* worker's finished Note: {text, time} */
    pollT: null, pollStart: 0,
    simT: []
  };

  var els = {
    contract: document.getElementById('contract'), cp: document.getElementById('cp'), note: document.getElementById('cp-note'),
    drop: document.getElementById('drop'), file: document.getElementById('file'), ex: document.getElementById('ex'),
    files: document.getElementById('files'), fnote: document.getElementById('files-note'), found: document.getElementById('found'),
    alt: document.getElementById('alt'), sum: document.getElementById('run-summary'), unch: document.getElementById('demo-unchanged')
  };
  var strip = J.next({ mount: '#nx', title: 'Loading', button: null });
  var stepsBar = J.steps({ mount: '#steps', current: 0, labels: ['Add files', 'Read files', 'Review', 'Hand off'] });
  var tabsApi = J.tabs({
    mount: '#tabs', label: 'Contract ingest sections',
    tabs: [{ id: 'packet', label: 'This packet' }, { id: 'backlog', label: 'Backlog', count: 0 }]
  });
  var blTable = J.table({
    mount: '#bl', caption: 'Contracts waiting to be ingested', filterLabel: 'Counterparty filter',
    columns: [
      { key: 'name', label: 'Contract', sortable: true, render: function (r) { return esc(r.name); } },
      { key: 'type', label: 'Type', sortable: true, render: function (r) { return esc(r.type); } },
      { key: 'status', label: 'Status', sortable: true, render: function (r) { return statusChip(r); } },
      { key: 'act', label: '', align: 'right', render: function (r) { return '<button type="button" class="btn sm" data-ingest="' + esc(r.id) + '" aria-label="Ingest ' + esc(r.name) + '">Ingest</button>'; } }
    ],
    rows: [],
    filters: [
      { key: 'Vendor', label: 'Vendor', test: function (r) { return r.type === 'Vendor'; } },
      { key: 'Customer', label: 'Customer', test: function (r) { return r.type === 'Customer'; } },
      { key: 'all', label: 'All', test: function () { return true; } }
    ],
    empty: { title: 'Nothing left to ingest', hint: 'Every contract in this view has been read.' }
  });

  /* ---------------- helpers ---------------- */
  function lc(s) { return String(s == null ? '' : s).toLowerCase(); }
  function blank(v) { return v == null || v === ''; }
  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function statusChip(r) {
    var s = r.status;
    if (s === 'Failed') return J.chip('Failed', 'bad');
    if (s === 'Backlog') return J.chip('Backlog', 'neutral');
    return J.chip('Not ingested', 'neutral');
  }
  function inBacklog(c) { return c.status === 'Backlog' || c.status === 'Not Ingested' || c.status === 'Failed' || blank(c.status); }
  function contractById(id) { for (var i = 0; i < S.contracts.length; i++) if (S.contracts[i].id === id) return S.contracts[i]; return null; }
  function chipFor(st) {
    var tone = { 'Parsed': 'good', 'No text layer': 'warn', 'Failed': 'bad', 'Reading': 'info', 'Uploading': 'info' }[st] || 'neutral';
    return J.chip(st, tone);
  }
  function shortSha(s) { return s ? String(s).slice(0, 8) : ''; }
  function isOkId(id) { return /^\d+$/.test(String(id)); }

  /* ---------------- derived view ---------------- */
  /* One row per file. Documents on the record are keyed by Sha1 when present, else by File_Name.
     Files chosen this session overlay the record row with the same name, so a re-add never duplicates. */
  function buildRows() {
    var map = {}, order = [];
    S.docs.forEach(function (d) {
      var k = d.Sha1 ? 's:' + d.Sha1 : 'n:' + lc(d.File_Name);
      if (map[k]) return;
      map[k] = { key: k, name: d.File_Name || '(unnamed)', doc: d, local: null };
      order.push(k);
    });
    var byName = {};
    order.forEach(function (k) { var n = lc(map[k].name); if (!byName[n]) byName[n] = k; });
    S.local.forEach(function (f) {
      var n = lc(f.name);
      if (/\.zip$/i.test(f.name) && f.started && S.docs.length) return;    /* the zip is expanded into its files */
      if (byName[n]) { map[byName[n]].local = f; return; }
      var k = 'n:' + n;
      map[k] = { key: k, name: f.name, doc: null, local: f };
      byName[n] = k; order.push(k);
    });
    return order.map(function (k) {
      var r = map[k];
      var pending = r.local && !r.local.started;
      if (pending) r.status = S.phase === 'uploading' ? 'Uploading' : 'Queued';
      else if (r.doc && !blank(r.doc.Parse_Status)) r.status = r.doc.Parse_Status;
      else r.status = 'Waiting';
      return r;
    });
  }
  function view() {
    var rows = buildRows();
    var docs = S.docs;
    var pendingLocal = S.local.filter(function (f) { return !f.started; });
    var startedNoDoc = S.local.some(function (f) {
      if (!f.started || (/\.zip$/i.test(f.name))) return false;
      return !docs.some(function (d) { return lc(d.File_Name) === lc(f.name); });
    });
    var allParsed = docs.length > 0 && docs.every(function (d) { return !blank(d.Parse_Status); }) && !startedNoDoc && pendingLocal.length === 0;
    var ocr = docs.filter(function (d) { return d.Parse_Status === 'No text layer'; }).length;
    var st = S.c && S.c.status;
    var byRule = !!S.sel && !!S.c && (st === 'Needs Review' || st === 'Ingested') &&
      (!S.base || st !== S.base.status || String(S.c.on || '') !== String(S.base.on || '')) && allParsedOrNoLocal(docs, pendingLocal);
    /* an unchanged packet changes no status; the worker still posts a Note when it finishes */
    var byNote = !!S.sel && !!S.note && pendingLocal.length === 0;
    var unchanged = byNote && /already read earlier/i.test(S.note.text);
    return { rows: rows, pendingLocal: pendingLocal, allParsed: allParsed, ocr: ocr, handoff: byRule || byNote, unchanged: unchanged, hasFiles: rows.length > 0 };
  }
  function allParsedOrNoLocal(docs, pending) { return docs.length > 0 && pending.length === 0; }

  /* ---------------- render ---------------- */
  function setStrip(title, sub, button, progress) {
    strip.update({ title: title, sub: sub || '', button: button || null, progress: progress == null ? null : progress });
  }
  function render() {
    var v = view();
    var busy = S.phase !== 'idle';
    /* contract options */
    var list = S.contracts.filter(function (c) { return c.type === S.cp; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    els.contract.innerHTML = '<option value="">Choose a contract</option>' + list.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
    els.contract.value = S.sel && list.some(function (c) { return c.id === S.sel; }) ? S.sel : '';
    els.contract.disabled = busy;
    Array.prototype.forEach.call(els.cp.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-k') === S.cp)); b.disabled = busy;
    });
    els.note.textContent = S.cp === 'Vendor'
      ? 'Vendor contracts look for rate lines, tiers, spare and service terms. Allied, SCRAM, SuperCom and Buddi are the vendors.'
      : 'Customer contracts look for the term, extensions, notice, spare clause and rates. Every non-vendor contract is a customer.';

    /* drop zone */
    els.drop.hidden = !S.sel;
    els.file.disabled = busy;
    els.ex.hidden = !S.demo;
    els.ex.disabled = busy;

    /* steps */
    var cur2 = 0;
    if (S.sel) {
      if (v.handoff) cur2 = 3;
      else if (v.allParsed) cur2 = 2;
      else if (v.hasFiles && (busy || v.pendingLocal.length || S.docs.length)) cur2 = 1;
    }
    stepsBar.set(cur2);

    /* files */
    els.files.innerHTML = v.rows.map(function (r) {
      var meta = [];
      if (r.local && r.local.size != null) meta.push(fmtSize(r.local.size));
      if (r.doc && r.doc.Doc_Type) meta.push(r.doc.Doc_Type);
      if (r.doc && r.doc.Parse_Status === 'No text layer') meta.push('Run OCR on your PC, then re-run');
      return '<li><button type="button" class="frow" data-k="' + esc(r.key) + '"><span class="fn"><b>' + esc(r.name) + '</b>' +
        (meta.length ? '<div class="sm muted">' + esc(meta.join(' · ')) + '</div>' : '') + '</span>' + chipFor(r.status) + '</button></li>';
    }).join('');
    els.fnote.textContent = v.rows.length ? plural(v.rows.length, 'file', 'files') + '. Select a file for details.' : '';

    /* found tiles */
    var showFound = S.sel && (v.allParsed || v.handoff) && S.c;
    els.found.hidden = !showFound;
    if (showFound) {
      var parsed = S.docs.filter(function (d) { return d.Parse_Status === 'Parsed'; }).length;
      var cl = S.clauses;
      els.found.innerHTML =
        tile('Terms', S.c.summary ? 'Written' : 'None yet', 'ingest summary') +
        tile('Rate lines', String(S.c.rates), S.c.proposedRates + ' proposed') +
        tile('Clauses', cl ? String(cl.n) : '—', cl ? cl.proposed + ' proposed' : 'could not read') +
        tile('Documents', parsed + ' of ' + S.docs.length, v.ocr ? v.ocr + ' needs OCR' : 'all readable');
    } else els.found.innerHTML = '';
    els.alt.hidden = !(S.sel && v.ocr && v.handoff);
    els.sum.hidden = !(S.sel && S.note && v.handoff);
    els.sum.textContent = S.note ? 'Run summary: ' + S.note.text.split(/\r?\n/)[0] : '';
    els.unch.parentNode.hidden = !S.demo;

    renderStrip(v, busy);
    tabsApi.setCount('backlog', S.contracts.filter(inBacklog).length);
    blTable.setRows(S.contracts.filter(inBacklog).map(function (c) { return { id: c.id, name: c.name, type: c.type, status: c.status }; })
      .sort(function (a, b) { return (a.type === b.type ? 0 : a.type === 'Vendor' ? -1 : 1) || a.name.localeCompare(b.name); }));
  }
  function tile(label, value, hint) {
    return '<div class="tile"><small>' + esc(label) + '</small><b>' + esc(value) + '</b><i>' + esc(hint) + '</i></div>';
  }
  function renderStrip(v, busy) {
    if (!S.sel) return setStrip('Choose the contract this packet belongs to.', 'Pick Vendor or Customer, then the contract.', { label: 'Choose contract', onClick: function () { els.contract.focus(); } });
    if (busy) {
      var sub = S.phase === 'uploading' ? 'Uploading the files to the contract.' :
        (v.allParsed ? 'Files read. Preparing the review.' : plural(S.docs.filter(function (d) { return !blank(d.Parse_Status); }).length, 'file', 'files') + ' read of ' + Math.max(S.docs.length, S.local.length) + '.');
      return setStrip('Reading the packet.', sub, null, S.progress);
    }
    if (S.err) return setStrip(S.err.title, S.err.sub, { label: 'Try again', onClick: startRead });
    if (S.timedOut) return setStrip('Still waiting after 10 minutes.', 'The read may still be running. Check again, or open the Contract record.', { label: 'Check again', onClick: recheck });
    if (v.pendingLocal.length) return setStrip('Read the files.', plural(v.pendingLocal.length, 'file is', 'files are') + ' ready. Nothing is changed in the CRM until you verify.', { label: 'Read the files', onClick: startRead });
    if (v.unchanged) return setStrip('This packet was read before and hasn\u2019t changed. Nothing new to review.', v.ocr ? plural(v.ocr, 'file still needs', 'files still need') + ' OCR on your PC.' : 'The earlier values are still waiting in the review.', { label: 'Open review', onClick: openReview });
    if (v.ocr) return setStrip(plural(v.ocr, 'file needs', 'files need') + ' OCR on your PC, then re-run.', 'Add the OCR copies and read again. The rest of the packet was read.', { label: 'Add OCR copies', onClick: function () { els.file.click(); } });
    if (v.handoff) return setStrip('Open review.', 'The values are waiting for you. Check each one against its sentence.', { label: 'Open review', onClick: openReview });
    if (v.allParsed) return setStrip('Files read. Preparing the review.', 'The review opens once the contract shows Needs Review.', { label: 'Open review', onClick: openReview });
    if (S.docs.length) return setStrip('Read the files.', plural(S.docs.length, 'file is', 'files are') + ' on the contract and not read yet.', { label: 'Read the files', onClick: startRead });
    return setStrip('Add the packet files.', 'A .zip, or the PDFs and Excel files.', S.demo
      ? { label: 'Use example packet', onClick: addExample }
      : { label: 'Choose files', onClick: function () { els.file.click(); } });
  }

  /* ---------------- contract selection ---------------- */
  function resetPacket() {
    stopPoll(); S.simT.forEach(clearTimeout); S.simT = [];
    S.local = []; S.docs = []; S.c = null; S.clauses = null; S.phase = 'idle'; S.progress = 0; S.base = null; S.err = null; S.timedOut = false; S.startedAt = null; S.note = null;
  }
  function selectContract(id, opts) {
    var c = id ? contractById(id) : null;
    if (id && c) S.cp = c.type;
    resetPacket();
    S.sel = c ? c.id : (id && !c ? id : '');
    render();
    if (S.sel) loadData(S.sel).then(function (d) { if (d) applyData(d); render(); });
    void opts;
  }
  function applyData(d) {
    S.docs = d.docs || []; S.c = d.c; S.clauses = d.clauses;
    if (S.startedAt && d.note) S.note = d.note;
    var c = contractById(S.sel); if (c && d.c && d.c.status !== undefined) c.status = d.c.status;
  }

  /* ---------------- data ---------------- */
  function loadData(id) {
    if (S.demo) return Promise.resolve(demoData(id));
    if (!isOkId(id)) return Promise.resolve(null);
    var want = S.sel;
    function soft(p) { return p.then(function (v) { return v; }, function () { return null; }); }
    return Promise.all([
      window.ZOHO.CRM.API.getRecord({ Entity: 'Contracts', RecordID: id }).then(function (r) { return r && r.data && r.data[0]; }, function () { return null; }),
      soft(J.crm.coqlAll("select id, File_Name, Doc_Type, Text_Layer, Sha1, Parse_Status from Contract_Documents where Contract = '" + id + "'")),
      soft(J.crm.coqlAll("select id, Status from Contract_Clauses where Contract = '" + id + "'")),
      S.startedAt ? soft(window.ZOHO.CRM.API.getRelatedRecords({ Entity: 'Contracts', RecordID: id, RelatedList: 'Notes', page: 1, per_page: 20 })) : Promise.resolve(null)
    ]).then(function (r) {
      if (want !== S.sel) return null;
      var rec = r[0], rates = (rec && rec.Rate_Lines) || [];
      var cl = r[2] ? { n: r[2].length, proposed: r[2].filter(function (k) { return k.Status === 'Proposed'; }).length } : null;
      return {
        note: findNote(r[3]),
        docs: r[1] || [],
        clauses: cl,
        c: {
          status: rec ? (rec.Ingest_Status || '') : '', on: rec ? rec.Ingested_On : null, summary: rec ? rec.Ingest_Summary : '',
          rates: rates.length, proposedRates: rates.filter(function (x) { return x.Line_Status === 'Proposed'; }).length
        }
      };
    });
  }

  /* newest Note created at or after the start time = the worker finished */
  function findNote(res) {
    var rows = (res && res.data) || [], t0 = Date.parse(S.startedAt || '');
    rows = rows.filter(function (n) { return n.Created_Time && Date.parse(n.Created_Time) >= t0; })
      .sort(function (a, b) { return Date.parse(b.Created_Time) - Date.parse(a.Created_Time); });
    if (!rows.length) return null;
    var txt = String(rows[0].Note_Content || rows[0].Note_Title || '');
    return { text: txt, time: rows[0].Created_Time };
  }

  /* ---------------- adding files ---------------- */
  function addFiles(files) {
    var skipped = [];
    Array.prototype.forEach.call(files, function (f) {
      if (!/\.(zip|pdf|xlsx)$/i.test(f.name)) { skipped.push(f.name); return; }
      var n = lc(f.name), hit = null;
      S.local.forEach(function (x) { if (lc(x.name) === n) hit = x; });
      var rec = { name: f.name, size: f.size, file: f, started: false, attId: null };
      if (hit) S.local[S.local.indexOf(hit)] = rec; else S.local.push(rec);
    });
    if (skipped.length) J.toast('Skipped ' + skipped.join(', ') + '. Only .zip, .pdf and .xlsx files are read.');
    S.err = null; S.timedOut = false;
    render();
  }
  els.file.addEventListener('change', function () {
    if (els.file.files && els.file.files.length) addFiles(els.file.files);
    els.file.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); if (S.phase === 'idle') els.drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.remove('over'); });
  });
  els.drop.addEventListener('drop', function (e) {
    if (S.phase === 'idle' && e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  /* ---------------- start the read ---------------- */
  function startRead() {
    if (!S.sel || S.phase !== 'idle') return;
    S.err = null; S.timedOut = false; S.note = null; S.startedAt = new Date().toISOString();
    S.base = { status: S.c && S.c.status, on: S.c && S.c.on };
    if (S.demo) return demoStart();
    var pend = S.local.filter(function (f) { return !f.started; });
    S.phase = 'uploading'; S.progress = 5; render();
    var ids = S.local.filter(function (f) { return f.attId; }).map(function (f) { return f.attId; });
    var done = 0;
    var chain = pend.reduce(function (p, f) {
      return p.then(function () {
        if (f.attId) return;
        return window.ZOHO.CRM.API.attachFile({ Entity: 'Contracts', RecordID: S.sel, File: { Name: f.name, Content: f.file } }).then(function (res) {
          var d = res && res.data && res.data[0];
          if (!d || (d.status && d.status !== 'success')) throw new Error((d && d.message) || 'The file was not accepted');
          f.attId = String(d.details && d.details.id || '');
          ids.push(f.attId); done++;
          S.progress = 5 + Math.round(done / pend.length * 35); render();
        }, function (e) { throw new Error('Could not upload ' + f.name + ': ' + errText(e)); });
      });
    }, Promise.resolve());
    chain.then(function () {
      return J.crm.run('contract_ingest_start', { contractId: String(S.sel), attachmentIds: JSON.stringify(ids.filter(Boolean)) });
    }).then(function (out) {
      if (out && typeof out === 'object' && out.ok === false) throw new Error('The read could not start: ' + (out.error || 'unknown reason'));
      pend.forEach(function (f) { f.started = true; });
      S.phase = 'reading'; S.progress = 40; render();
      startPoll();
    }, function (e) {
      S.phase = 'idle'; S.base = null; S.startedAt = null;
      var m = e && e.message || String(e);
      if (/^Could not upload/.test(m)) S.err = { title: 'A file could not be uploaded.', sub: m + ' Your files are still listed.' };
      else if (/^The read could not start/.test(m)) S.err = { title: 'The read could not start.', sub: m.replace(/^The read could not start: /, '') + ' Your files are still listed.' };
      else if (/not.?found|no such|does not exist|doesn.t exist|invalid|unknown|not available|function/i.test(m)) S.err = { title: 'The start function isn’t installed yet.', sub: 'Your files are still listed. Once contract_ingest_start is installed, press Try again.' };
      else S.err = { title: 'The read could not start.', sub: m + ' Your files are still listed.' };
      render();
    });
  }
  function errText(e) { return J.crm.error(e).message; }

  /* ---------------- polling ---------------- */
  function startPoll() { stopPoll(); S.pollStart = Date.now(); S.pollT = setTimeout(tick, POLL_MS); }
  function stopPoll() { if (S.pollT) clearTimeout(S.pollT); S.pollT = null; }
  function tick() {
    var id = S.sel;
    loadData(id).then(function (d) {
      if (id !== S.sel || S.phase !== 'reading') return;
      if (d) applyData(d);
      var v = view();
      var docsRead = S.docs.filter(function (x) { return !blank(x.Parse_Status); }).length;
      S.progress = 40 + (S.docs.length ? Math.round(docsRead / S.docs.length * 50) : 0);
      if (v.handoff || (v.allParsed && v.ocr)) { finishRead(); return; }
      if (Date.now() - S.pollStart > POLL_MAX_MS) { S.phase = 'idle'; S.timedOut = true; render(); return; }
      render(); S.pollT = setTimeout(tick, POLL_MS);
    }, function () {
      if (id !== S.sel || S.phase !== 'reading') return;
      if (Date.now() - S.pollStart > POLL_MAX_MS) { S.phase = 'idle'; S.timedOut = true; render(); return; }
      S.pollT = setTimeout(tick, POLL_MS);
    });
  }
  function finishRead() { stopPoll(); S.phase = 'idle'; S.progress = 100; render(); J.toast('Read finished'); }
  function recheck() { S.timedOut = false; S.phase = 'reading'; render(); startPoll(); }

  /* ---------------- open review ---------------- */
  function openReview() {
    if (!S.sel) return;
    if (S.demo || !window.ZOHO || !ZOHO.CRM || !ZOHO.CRM.UI) { J.toast('In the CRM this opens the Contract record and its Review Band.'); return; }
    ZOHO.CRM.UI.Record.open({ Entity: 'Contracts', RecordID: S.sel });
  }
  document.getElementById('open-anyway').addEventListener('click', openReview);

  /* ---------------- file drawer ---------------- */
  var HELP = {
    'Parsed': 'Nothing to do. Its values are waiting in the review.',
    'No text layer': 'This is a scan. Run OCR on your PC, save the searchable copy, add it here and read again.',
    'Skipped': 'Nothing to do. The reader found no contract terms in this file.',
    'Failed': 'The reader could not open this file. Add it again and read again. If it fails twice, tell Beau.',
    'Waiting': 'The reader has not reached this file yet. It updates on its own every few seconds.',
    'Queued': 'Added, not sent yet. Press Read the files.',
    'Uploading': 'Sending this file to the contract.'
  };
  els.files.addEventListener('click', function (e) {
    var b = e.target.closest('.frow'); if (!b) return;
    var row = buildRows().filter(function (r) { return r.key === b.getAttribute('data-k'); })[0];
    if (!row) return;
    var d = row.doc || {};
    var html = '<dl class="dl">' +
      '<dt>File</dt><dd>' + esc(row.name) + '</dd>' +
      '<dt>Document type</dt><dd>' + (d.Doc_Type ? esc(d.Doc_Type) : '<span class="muted">Not set yet</span>') + '</dd>' +
      '<dt>Text layer</dt><dd>' + (d.Text_Layer ? esc(d.Text_Layer) : '<span class="muted">Not checked yet</span>') + '</dd>' +
      '<dt>Sha1</dt><dd class="mono">' + (d.Sha1 ? esc(shortSha(d.Sha1)) : '<span class="muted">Not calculated yet</span>') + '</dd>' +
      '<dt>Parse status</dt><dd>' + chipFor(row.status) + '</dd>' +
      (row.local && row.local.size != null ? '<dt>Size</dt><dd>' + esc(fmtSize(row.local.size)) + '</dd>' : '') +
      '</dl><div class="dl-act"><b>What to do</b><div>' + esc(HELP[row.status] || '') + '</div></div>';
    J.drawer.open({ title: row.name, html: html });
  });

  /* ---------------- about ---------------- */
  J.aboutButton({
    button: '#help', title: 'About contract ingest',
    html: '<p>This reads a contract packet with fixed rules. There is no AI. You check every value afterward.</p>' +
      '<ol><li><b>Add files.</b> Choose the contract, then add the packet: a .zip, or the PDFs and Excel files.</li>' +
      '<li><b>Read files.</b> The files go onto the contract and the reader works through them. Each file shows its status here and updates on its own.</li>' +
      '<li><b>Review.</b> The reader proposes rate lines and clauses. Open the contract and confirm or reject each one against its sentence.</li>' +
      '<li><b>Hand off.</b> When the contract shows Needs Review, the packet is ready for you.</li></ol>' +
      '<p><b>Scanned PDFs need OCR on Beau’s PC first.</b> A scan has no text to read and shows No text layer. Run OCR, add the searchable copy and read again. Files already read are not duplicated.</p>'
  });

  /* ---------------- events ---------------- */
  els.cp.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    var k = b.getAttribute('data-k'); if (k === S.cp) return;
    S.cp = k; resetPacket(); S.sel = ''; render();
  });
  els.contract.addEventListener('change', function () { selectContract(els.contract.value); });
  els.ex.addEventListener('click', addExample);
  document.getElementById('bl').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ingest]'); if (!b) return;
    var c = contractById(b.getAttribute('data-ingest')); if (!c) return;
    selectContract(c.id);
    tabsApi.select('packet');
    J.toast('Add the packet for ' + c.name);
    els.contract.focus();
  });

  /* ---------------- demo mode ---------------- */
  var DEMO_CONTRACTS = [
    ['d1', 'Allied Universal EM, standard agreement', 'Vendor', 'Not Ingested'],
    ['d2', 'SCRAM Systems agreement', 'Vendor', 'Backlog'],
    ['d3', 'SuperCom agreement', 'Vendor', 'Failed'],
    ['d4', 'Buddi agreement', 'Vendor', 'Needs Review'],
    ['d5', 'Milwaukee County Pretrial', 'Customer', 'Not Ingested'],
    ['d6', 'Ramsey County Pretrial', 'Customer', 'Backlog'],
    ['d7', 'Hope School', 'Customer', ''],
    ['d8', 'Example County Sheriff', 'Customer', 'Ingested'],
    ['d9', 'Example City Probation', 'Customer', 'Not Ingested']
  ];
  var EXAMPLE = [
    ['Master agreement.pdf', 'Parsed', 'Master agreement', 'Yes', 412000],
    ['Addendum 24, new pricing 401+.pdf', 'Parsed', 'Addendum', 'Yes', 96000],
    ['Rate schedule.xlsx', 'Parsed', 'Rate schedule', 'Yes', 28000],
    ['Signed cover page.pdf', 'No text layer', 'Cover page', 'No', 1850000],
    ['Fax cover.pdf', 'Skipped', 'Other', 'Yes', 14000],
    ['Insurance certificate.pdf', 'Parsed', 'Insurance', 'Yes', 52000]
  ];
  var demoState = {};   /* contract id -> {docs, c} */
  function hash40(s) {
    var h = 5381, out = '';
    for (var i = 0; i < 5; i++) {
      for (var j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j) + i) | 0;
      out += ('00000000' + (h >>> 0).toString(16)).slice(-8);
    }
    return out;
  }
  function demoData(id) {
    var st = demoState[id];
    var c = contractById(id);
    if (!st) st = demoState[id] = { docs: [], c: { status: c ? c.status : '', on: null, summary: '', rates: 0, proposedRates: 0 }, clauses: { n: 0, proposed: 0 } };
    return JSON.parse(JSON.stringify(st));
  }
  function addExample() {
    if (S.phase !== 'idle') return;
    addFiles(EXAMPLE.map(function (r) { return { name: r[0], size: r[4] }; }));
  }
  function demoResult(name) {
    for (var i = 0; i < EXAMPLE.length; i++) if (EXAMPLE[i][0] === name) return EXAMPLE[i];
    var scan = /scan/i.test(name);
    return [name, scan ? 'No text layer' : 'Parsed', /\.xlsx$/i.test(name) ? 'Rate schedule' : 'Other', scan ? 'No' : 'Yes', 0];
  }
  function demoStart() {
    var id = S.sel, st = demoState[id] || (demoState[id] = demoData(id));
    var pend = S.local.filter(function (f) { return !f.started; });
    var unchangedRun = !!els.unch.checked && st.docs.length > 0;
    S.phase = 'uploading'; S.progress = 5; render();
    S.simT.push(setTimeout(function () {
      pend.forEach(function (f) { f.started = true; });
      /* the reader creates one document per file; a re-run reuses the row with the same Sha1 and clears its status */
      pend.forEach(function (f) {
        var r = demoResult(f.name), sha = hash40(f.name), hit = null;
        st.docs.forEach(function (d) { if (d.Sha1 === sha) hit = d; });
        if (hit) { if (!unchangedRun) hit.Parse_Status = null; }
        else st.docs.push({ File_Name: f.name, Doc_Type: r[2], Text_Layer: r[3], Sha1: sha, Parse_Status: null });
      });
      S.docs = JSON.parse(JSON.stringify(st.docs));
      S.phase = 'reading'; S.progress = 40; render();
      var queue = st.docs.filter(function (d) { return blank(d.Parse_Status); });
      queue.forEach(function (d, i) {
        S.simT.push(setTimeout(function () {
          d.Parse_Status = demoResult(d.File_Name)[1];
          S.docs = JSON.parse(JSON.stringify(st.docs));
          S.progress = 40 + Math.round((i + 1) / queue.length * 50); render();
        }, (i + 1) * DEMO_STEP));
      });
      S.simT.push(setTimeout(function () {
        var note = unchangedRun ? { text: 'Already read earlier. The packet has not changed.\nNothing new was proposed.', time: new Date().toISOString() }
          : { text: 'Read ' + st.docs.length + ' files. 4 rate lines and 3 clauses proposed.', time: new Date().toISOString() };
        S.note = note;
        st.c = { status: 'Needs Review', on: new Date().toISOString(), summary: 'Demo summary', rates: 4, proposedRates: 4 };
        st.clauses = { n: 3, proposed: 3 };
        S.c = JSON.parse(JSON.stringify(st.c)); S.clauses = st.clauses;
        var c = contractById(id); if (c) c.status = 'Needs Review';
        finishRead();
      }, (queue.length + 1) * DEMO_STEP));
    }, DEMO_STEP));
  }

  /* ---------------- boot ---------------- */
  function boot(data) {
    S.demo = !!data.demo;
    document.getElementById('demo-flag').hidden = !S.demo;
    var pre = data.EntityId; if (Array.isArray(pre)) pre = pre[0];
    var load = S.demo
      ? Promise.resolve(DEMO_CONTRACTS.map(function (r) { return { id: r[0], name: r[1], type: r[2], status: r[3] }; }))
      : J.crm.coqlAll('select id, Name, Counterparty_Type, Ingest_Status from Contracts where id is not null').then(function (rows) {
        return rows.map(function (r) { return { id: String(r.id), name: r.Name || '(unnamed)', type: r.Counterparty_Type === 'Vendor' ? 'Vendor' : 'Customer', status: r.Ingest_Status || '' }; });
      });
    load.then(function (list) {
      S.contracts = list;
      render();
      if (pre && (!data.Entity || data.Entity === 'Contracts')) selectContract(String(pre));
    }, function (e) {
      setStrip('Could not load the contracts.', errText(e), { label: 'Try again', onClick: function () { boot(data); } });
    });
  }
  render();
  J.crm.init().then(boot);
})();
