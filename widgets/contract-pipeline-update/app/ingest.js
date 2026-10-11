/* Contract Ingest widget 1.0.0
   Reads: Contracts (Name, Counterparty_Type, Ingest_Status, Ingested_On, Packet_Hash, Ingest_Review),
          Contract_Documents (File_Name, Parse_Status, Text_Layer, Pages, Sequence, Doc_Type, Contract), Notes (Note_Title).
   Writes: one attachment on the Contract (the packet .zip). Everything else is written by the existing
           contract-pipeline worker, started through the standalone function below. Nothing is verified here. */
(function () {
  'use strict';
  var J = window.JPK, $ = J.$, $$ = J.$$, crm = J.crm, esc = J.esc;

  var CFG = {
    startFunction: 'contract_ingest_start',  // standalone wrapper around the existing contract_pipeline_call
    noteTitle: 'Contract ingest',             // title of the Note the worker posts when a run finishes (seen in the org)
    pollEvery: window.__jpkPollEvery || 4000,
    maxWait: 15 * 60 * 1000
  };

  var S = {
    contracts: [], cp: 'Vendor', cur: null, docs: [], file: null,
    state: 'pick', t0: null, before: null, filter: 'Vendor'
  };

  /* ---------- shell ---------- */
  var nx = J.next('#nx');
  var st = J.steps('#steps', ['Add files', 'Read files', 'Review', 'Hand off']);
  var fl = J.fileList('#files');
  var tb = J.tabs('#tabs', {
    tabs: [{ id: 'packet', label: 'This packet' }, { id: 'backlog', label: 'Backlog' }],
    panes: { packet: $('#p-packet'), backlog: $('#p-backlog') }
  });
  J.menu('#more', {
    items: [
      { label: 'Add a new packet', onClick: function () { if (!S.cur) return J.toast('Pick a contract first.'); if (S.state !== 'reading') { S.file = null; setState('empty'); } } },
      { label: 'Read this packet again', onClick: function () { if (!S.cur) return J.toast('Pick a contract first.'); start(false); } },
      { label: 'Open the contract record', onClick: function () { if (S.cur) openRecord(S.cur.id); else J.toast('Pick a contract first.'); } },
      { label: 'Refresh', onClick: function () { loadContracts().then(function () { if (S.cur) selectContract(S.cur.id); }); } }
    ]
  });
  $('#about').appendChild(J.aboutButton(
    'Ingest turns a contract packet into values you can review. Pick the contract, add the packet, and the tool reads it with rules only, no AI. Nothing becomes final until you verify it.',
    'choose Vendor or Customer, pick the contract, add the packet as one .zip, then press Read files. When it finishes, Open review takes you to the contract. The Backlog tab lists what is still to read, vendors first.',
    'Scanned PDFs need OCR on your PC first. Reading the same packet again does not create duplicates.'));

  J.dropzone('#drop', {
    title: 'Drop the packet here',
    hint: 'One .zip of the packet: PDF, Word, Excel, text or CSV inside. Scanned PDFs need OCR on your PC first.',
    accept: '.zip', multiple: false,
    onFiles: function (list) { S.file = list[0]; setState('added'); }
  });

  function showErr(msg) { var e = $('#err'); e.textContent = msg || ''; e.hidden = !msg; }

  /* ---------- data ---------- */
  function loadContracts() {
    var out = [], page = 0;
    function more() {
      return crm.coql('select id, Name, Counterparty_Type, Ingest_Status, Ingested_On, Packet_Hash from Contracts where Name is not null order by Name limit ' + (page * 200) + ', 200')
        .then(function (rows) { out = out.concat(rows); page += 1; if (rows.length === 200 && page < 10) return more(); });
    }
    return more().then(function () { S.contracts = out; fillContracts(); drawBacklog(); });
  }
  function loadDocs(cid) {
    return crm.coql('select id, File_Name, Parse_Status, Text_Layer, Pages, Sequence, Doc_Type from Contract_Documents where Contract = ' + cid + ' order by Sequence limit 200');
  }
  function loadContract(cid) {
    return crm.coql('select id, Name, Counterparty_Type, Ingest_Status, Ingested_On, Packet_Hash, Ingest_Review from Contracts where id = ' + cid)
      .then(function (r) { return r[0]; });
  }
  function latestNote(cid) {
    return crm.coql("select id, Note_Title, Created_Time from Notes where Parent_Id = " + cid + " and Note_Title = '" + CFG.noteTitle + "' order by Created_Time desc limit 1")
      .then(function (r) { return r[0] || null; });
  }

  /* File status: Parse_Status when the worker has written it; until then, fall back to Text_Layer. */
  function fileStatus(d) {
    if (d.Parse_Status) return d.Parse_Status;
    if (d.Text_Layer === 'No') return 'No text layer';
    if (d.Text_Layer === 'Yes') return 'Parsed';
    return 'Waiting';
  }
  function docRows(docs, reading) {
    return docs.map(function (d) {
      var s = reading && !d.Parse_Status && !d.Text_Layer ? 'Reading' : fileStatus(d);
      var bits = [d.Doc_Type, d.Pages ? d.Pages + ' pages' : ''].filter(Boolean).join(', ');
      return {
        name: d.File_Name || 'Unnamed file', status: s,
        detail: s === 'No text layer' ? 'No text layer. Run OCR on your PC, then read again.' : s === 'Failed' ? 'Could not be read. Check the file opens, then read again.' : bits,
        action: s === 'No text layer' ? { label: 'How to fix', onClick: ocrHelp } : null
      };
    });
  }
  function review(c) {
    try { return c && c.Ingest_Review ? JSON.parse(c.Ingest_Review) : null; } catch (e) { return null; }
  }

  /* ---------- contract picker ---------- */
  function fillContracts() {
    var list = S.contracts.filter(function (c) { return c.Counterparty_Type === S.cp; });
    $('#contract').innerHTML = '<option value="">Choose a ' + S.cp.toLowerCase() + ' contract</option>' +
      list.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.Name) + '</option>'; }).join('');
    if (S.cur && S.cur.Counterparty_Type === S.cp) $('#contract').value = S.cur.id;
  }
  $('#cp').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.disabled) return;
    S.cp = b.dataset.k; markCp(); S.cur = null; S.docs = []; S.file = null; fillContracts(); setState('pick');
  });
  function markCp() { $$('#cp button').forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.k === S.cp)); }); }
  $('#contract').addEventListener('change', function () {
    if (!this.value) { S.cur = null; setState('pick'); return; }
    selectContract(this.value);
  });
  function selectContract(cid) {
    showErr('');
    return Promise.all([loadContract(cid), loadDocs(cid)]).then(function (r) {
      S.cur = r[0]; S.docs = r[1]; S.file = null;
      if (!S.cur) { setState('pick'); return; }
      S.cp = S.cur.Counterparty_Type === 'Vendor' ? 'Vendor' : 'Customer'; markCp(); fillContracts();
      $('#contract').value = S.cur.id;
      setState(S.cur.Ingest_Status === 'Needs Review' ? 'ready' : 'empty');
    }, fail('Could not load that contract.'));
  }

  /* ---------- states ---------- */
  function lock(on) { $$('#cp button').forEach(function (b) { b.disabled = on; }); $('#contract').disabled = on; }
  function setState(s) {
    S.state = s;
    var c = S.cur;
    $('#last').textContent = c ? (c.Ingested_On ? 'Last read ' + J.fmtDate(c.Ingested_On) + '. ' : 'Not read yet. ') + 'Status: ' + statusWord(c.Ingest_Status) + '.' : '';
    $('#drop').hidden = s !== 'empty';
    $('#found').hidden = s !== 'ready';
    lock(s === 'reading');

    if (s === 'pick') {
      st.set(0); fl.set([]);
      nx.set({ title: 'Pick the contract, then add its packet.', sub: 'Vendor contracts come first: Allied, SCRAM, SuperCom and Buddi.' });
      return;
    }
    if (s === 'empty') {
      st.set(0); fl.set(docRows(S.docs));
      nx.set(S.docs.length
        ? { title: 'Add the packet to read it again.', sub: 'Files already read are not read twice. Or use More to read the attached packet again.' }
        : { title: 'Add the packet for ' + c.Name + '.', sub: 'One .zip with everything in it.' });
      return;
    }
    if (s === 'added') {
      st.set(0);
      fl.set([{ name: S.file.name, status: 'Waiting', detail: Math.max(1, Math.round(S.file.size / 1024)) + ' KB, attached to the contract when you start' }]);
      nx.set({ title: 'Ready to read ' + S.file.name + '.', sub: 'Reading uses rules only. Nothing is saved as final until you verify.', action: { label: 'Read files', onClick: function () { start(true); } } });
      return;
    }
    if (s === 'reading') {
      st.set(1);
      nx.set({ title: 'Reading the packet', sub: 'Started ' + new Date(S.t0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '. You can leave this screen; reading continues.', progress: S.docs.length ? 50 : 10 });
      return;
    }
    if (s === 'ready') {
      st.set(2);
      var rv = review(c) || {}, docs = S.docs;
      var ocr = docs.filter(function (d) { return fileStatus(d) === 'No text layer'; }).length;
      var failed = docs.filter(function (d) { return fileStatus(d) === 'Failed'; }).length;
      var read = docs.filter(function (d) { return fileStatus(d) === 'Parsed'; }).length;
      var fields = rv.fields || [], rates = rv.rates || [], clauses = rv.clauses || [];
      fl.set(docRows(docs));
      J.tiles('#found', [
        { label: 'Files read', value: read, note: 'of ' + docs.length },
        { label: 'Terms found', value: fields.length, note: 'waiting for you' },
        { label: 'Rate lines', value: rates.length, note: rates.length ? 'unverified' : 'none in this packet' },
        { label: 'Clauses', value: clauses.length, note: 'proposed only' }
      ]);
      var same = S.before && S.before.Packet_Hash && S.before.Packet_Hash === c.Packet_Hash && S.before.Ingested_On === c.Ingested_On;
      var go = { label: 'Open review', onClick: handOff };
      if (same) nx.set({ tone: 'done', title: 'Already read earlier. Nothing changed.', sub: 'The packet matches the last read, so no rows were added.', action: c.Ingest_Status === 'Needs Review' ? go : null });
      else if (ocr || failed) nx.set({ tone: 'warn', title: (ocr + failed) + ' file' + (ocr + failed > 1 ? 's' : '') + ' could not be read.', sub: 'You can review the rest now, fix ' + (ocr + failed > 1 ? 'those files' : 'that file') + ' and read again later.', action: go });
      else if (c.Ingest_Status === 'Ingested') nx.set({ tone: 'done', title: 'This contract is verified.', sub: 'Add a new packet only if the contract has changed.' });
      else nx.set({ title: 'Ready for your review.', sub: 'Every value waits for you to confirm it.', action: go });
      S.before = null;
    }
  }
  function statusWord(s) { return { 'Backlog': 'in the backlog', 'Not Ingested': 'not read yet', 'Needs Review': 'needs review', 'Ingested': 'verified' }[s] || (s || 'unknown'); }

  /* ---------- run ---------- */
  function start(withUpload) {
    if (!S.cur || S.state === 'reading') return;
    showErr('');
    var cid = S.cur.id;
    S.before = { Packet_Hash: S.cur.Packet_Hash, Ingested_On: S.cur.Ingested_On };
    S.t0 = Date.now();
    setState('reading');
    fl.set(withUpload && S.file ? [{ name: S.file.name, status: 'Reading', detail: 'Attaching to the contract' }] : docRows(S.docs, true));
    var up = withUpload && S.file ? crm.attach('Contracts', cid, S.file) : Promise.resolve();
    up.then(function () {
      return latestNote(cid);
    }).then(function (prev) {
      var prevId = prev && prev.id;
      return crm.run(CFG.startFunction, { contract_id: cid }).then(function (out) {
        if (out && out.ok === false) throw new Error(out.message || 'The pipeline did not start.');
        return crm.poll(function () {
          return Promise.all([latestNote(cid), loadDocs(cid)]);
        }, {
          every: CFG.pollEvery, max: CFG.maxWait,
          onTick: function (r) { S.docs = r[1]; if (S.docs.length) fl.set(docRows(S.docs, true)); },
          until: function (r) { return r[0] && r[0].id !== prevId; }
        });
      });
    }).then(function () {
      return Promise.all([loadContract(cid), loadDocs(cid)]);
    }).then(function (r) {
      S.cur = r[0]; S.docs = r[1]; S.file = null;
      var row = S.contracts.filter(function (c) { return c.id === cid; })[0];
      if (row) { row.Ingest_Status = S.cur.Ingest_Status; row.Ingested_On = S.cur.Ingested_On; row.Packet_Hash = S.cur.Packet_Hash; }
      drawBacklog();
      setState('ready');
      J.toast('Packet read');
    }).catch(function (e) {
      S.before = null;
      setState(S.file ? 'added' : 'empty');
      var m = String(e && e.message || e || '');
      if (/function|not found|INVALID_DATA|does not exist/i.test(m)) showErr('The start function (' + CFG.startFunction + ') is not set up yet. Use the Ingest Contract Packet button on the contract for now.');
      else if (/Still running/.test(m)) showErr('Reading is taking longer than usual. It keeps going in the background; use Refresh in More to check again.');
      else showErr('Reading did not start: ' + (m || 'unknown error') + '.');
    });
  }
  function handOff() {
    st.set(3);
    nx.set({ tone: 'done', title: 'Review is open on the contract.', sub: 'Confirm, edit or reject each value there, then Verify.', action: { label: 'Back to Backlog', onClick: function () { tb.select('backlog'); } } });
    openRecord(S.cur.id);
  }
  function openRecord(cid) {
    if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Record) ZOHO.CRM.UI.Record.open({ Entity: 'Contracts', RecordID: cid });
  }
  function ocrHelp() {
    J.drawer.open({
      title: 'This file needs OCR',
      html: '<p>The file is a scan, so it has no text the rules can read.</p><ol class="sm"><li>Open it on your PC and run OCR.</li><li>Put it back in the packet with the same name and zip it again.</li><li>Add the new .zip and press Read files. Values you already verified are not touched.</li></ol>'
    });
  }
  function fail(msg) { return function (e) { showErr(msg + ' ' + (e && e.message ? e.message : '')); }; }

  /* ---------- backlog ---------- */
  var bt = J.table('#bl', {
    caption: 'Contracts still to read',
    columns: [
      { key: 'Name', label: 'Contract' },
      { key: 'Counterparty_Type', label: 'Type', hideNarrow: true, sortValue: function (r) { return (r.Counterparty_Type === 'Vendor' ? '0 ' : '1 ') + r.Name; } },
      { key: 'Ingest_Status', label: 'Status', format: function (v) { return J.ingestChip(v); } },
      { key: 'Ingested_On', label: 'Last read', hideNarrow: true, format: function (v) { return v ? esc(J.fmtDate(v)) : '<span class="muted">Never</span>'; } },
      { key: 'go', label: '', sortable: false, hideNarrow: true, format: function (v, r) { return r.Ingest_Status === 'Ingested' ? '' : '<button class="btn sm" data-pick="' + esc(r.id) + '">' + (r.Ingest_Status === 'Needs Review' ? 'Open' : 'Read packet') + '</button>'; } }
    ],
    sort: { key: 'Counterparty_Type', dir: 1 },
    empty: { title: 'Nothing left to read.', text: ' Every contract of this type is verified.' },
    onRow: function (r) {
      J.drawer.open({
        title: r.Name,
        html: '<dl class="dl"><dt>Type</dt><dd>' + esc(r.Counterparty_Type || '') + '</dd><dt>Status</dt><dd>' + J.ingestChip(r.Ingest_Status) + '</dd><dt>Last read</dt><dd>' + (r.Ingested_On ? esc(J.fmtDate(r.Ingested_On)) : 'Never') + '</dd></dl>',
        actions: r.Ingest_Status === 'Ingested' ? [{ label: 'Open the contract', onClick: function (close) { close(); openRecord(r.id); } }]
          : [{ label: r.Ingest_Status === 'Needs Review' ? 'Open' : 'Read packet', primary: true, onClick: function (close) { close(); pick(r.id); } }]
      });
    }
  });
  function drawBacklog() {
    bt.setRows(S.contracts.filter(function (c) {
      if (S.filter === 'all') return true;
      return c.Counterparty_Type === S.filter && c.Ingest_Status !== 'Ingested';
    }));
    tb.count('backlog', S.contracts.filter(function (c) { return c.Ingest_Status === 'Backlog' || c.Ingest_Status === 'Not Ingested'; }).length);
  }
  $('#bf').addEventListener('click', function (e) {
    var b = e.target.closest('.pill'); if (!b) return;
    S.filter = b.dataset.f; $$('#bf .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawBacklog();
  });
  $('#bl').addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (b) pick(b.dataset.pick); });
  function pick(cid) { tb.select('packet'); selectContract(cid); }

  /* ---------- boot ---------- */
  setState('pick');
  crm.init().then(function (page) {
    if (!page) { showErr('Open this screen inside Zoho CRM to load contracts.'); return; }
    return loadContracts().then(function () {
      if (crm.entity === 'Contracts' && crm.entityId) return selectContract(crm.entityId);
    });
  }).catch(fail('Could not load contracts.'));
})();
