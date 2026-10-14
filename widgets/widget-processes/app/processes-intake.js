/* Processes: Contract ingest (upload packet, read, follow, open review) and New solicitation (wizard). Dark engine views. */
(function () {
  'use strict';
  var RM = window.RecModules, X;
  function esc(s) { return X.esc(s); }
  function $(id) { return document.getElementById(id); }
  function sdk() { return window.ZOHO && window.ZOHO.CRM; }
  function q1(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function errMsg(e) { return (e && (e.message || (e.data && e.data[0] && e.data[0].message) || e.code)) || String(e); }
  function okRes(r, what) { var d = r && r.data && r.data[0]; if (d && d.code && d.code !== 'SUCCESS') throw new Error(d.message || d.code); return d; }
  function pageAll(base, order) {
    var all = [];
    function page(off) { return X.coql(base + ' order by ' + order + ' limit 200 offset ' + off).then(function (r) { all = all.concat(r.rows); return r.rows.length >= 200 && all.length < 3000 ? page(off + 200) : all; }); }
    return page(0);
  }
  function runFn(name, args) {
    return sdk().FUNCTIONS.execute(name, { arguments: JSON.stringify(args) }).then(function (r) {
      if (!r || r.code !== 'success') throw new Error('The function ' + name + ' is not installed or did not run.');
      var out = r.details && r.details.output; if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) {} }
      return out;
    });
  }
  function kb(f) { return esc(f.name) + ' (' + Math.round(f.size / 1024) + ' KB)'; }

  /* ================= Contract ingest ================= */
  var C = { type: 'Vendor', list: [], loaded: false, busy: false, err: '', sel: '', files: [], run: null, msg: '', timer: null };
  var DEMO_C = [
    { id: 'c1', Name: 'Clark County Human Services', Counterparty_Type: 'Customer', Ingest_Status: 'Needs Review' },
    { id: 'c2', Name: 'Polk Co Sheriff', Counterparty_Type: 'Customer', Ingest_Status: 'Backlog' },
    { id: 'c5', Name: 'SCRAM Systems master agreement', Counterparty_Type: 'Vendor', Ingest_Status: 'Not Ingested' },
    { id: 'c6', Name: 'Allied Universal services', Counterparty_Type: 'Vendor', Ingest_Status: 'Failed' }
  ];
  var BACKLOG = /Backlog|Not Ingested|Failed/;
  function backlogRows() { return C.list.filter(function (r) { var s = r.Ingest_Status; return !s || s === '-None-' || BACKLOG.test(s); }); }
  function ofType() { return C.list.filter(function (r) { return (r.Counterparty_Type || 'Customer') === C.type; }); }
  function loadC(force) {
    if (C.busy || (C.loaded && !force)) return Promise.resolve();
    C.busy = true; C.err = '';
    if (!X.isLive()) { C.list = DEMO_C.slice(); C.loaded = true; C.busy = false; return Promise.resolve(); }
    return pageAll('select id, Name, Counterparty_Type, Ingest_Status from Contracts where id is not null', 'id asc').then(function (r) { C.list = r; C.loaded = true; C.busy = false; },
      function (e) { C.err = errMsg(e); C.loaded = true; C.busy = false; });
  }
  function cDraw(root) {
    var cur = C.list.filter(function (r) { return r.id === C.sel; })[0], bl = backlogRows(), R = C.run;
    var h = '<div class="wrap">' + X.head('Processes', 'Contract ingest', 'Upload a contract packet, let the worker read it, then review', '', '<button class="btn pri" id="ci-rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
    if (C.err) h += '<div class="err">Could not read Contracts: ' + esc(C.err) + '</div>';
    h += '<div class="cards"><section class="card"><h3>1. Contract</h3><div class="acts" style="margin:0 0 10px"><button type="button" class="pillbtn' + '" aria-pressed="' + (C.type === 'Vendor') + '" data-t="Vendor">Vendor</button><button type="button" class="pillbtn' + '" aria-pressed="' + (C.type === 'Customer') + '" data-t="Customer">Customer</button></div>' +
      '<select id="ci-c" class="search" style="width:100%"><option value="">' + (C.loaded ? 'Choose a ' + C.type.toLowerCase() + ' contract…' : 'Loading…') + '</option>' +
      ofType().map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === C.sel ? ' selected' : '') + '>' + esc(r.Name) + (r.Ingest_Status && r.Ingest_Status !== '-None-' ? ' [' + esc(r.Ingest_Status) + ']' : '') + '</option>'; }).join('') + '</select>' +
      '<p class="mut" style="margin:10px 0 0;font-size:12px">' + (cur ? 'Ingest status: ' + esc(cur.Ingest_Status && cur.Ingest_Status !== '-None-' ? cur.Ingest_Status : 'blank') + '.' : 'Pick the contract these files belong to, or use the backlog below.') + '</p></section>';
    h += '<section class="card"><h3>2. Packet</h3><input type="file" id="ci-f" multiple accept=".zip,.pdf,.xlsx"><p class="mut" style="margin:10px 0 0;font-size:12px">' +
      (C.files.length ? C.files.map(kb).join('<br>') : 'A zip, PDFs or spreadsheets: the agreement, amendments and rate sheets.') + '</p>' +
      '<div class="acts"><button type="button" class="btn pri" id="ci-go"' + (!cur || !C.files.length || C.busy ? ' disabled' : '') + '>' + (C.busy ? 'Working…' : 'Attach and read') + '</button></div></section>';
    h += '<section class="card"><h3>3. Follow the read</h3>' + (R ? runHtml(R) : '<p class="mut" style="margin:0">Starts after you attach a packet.</p>') +
      (cur && R && R.done ? '<div class="acts"><button type="button" class="btn pri" id="ci-open">Open review</button></div>' : '') + '</section></div>';
    if (C.msg) h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + esc(C.msg) + '</div>';
    h += '<div class="cards"><section class="card" style="grid-column:1/-1"><h3>Backlog (' + bl.length + ')</h3>' + (!C.loaded ? '<p class="mut">Loading…</p>' : !bl.length ? '<p class="mut" style="margin:0">Nothing waiting.</p>' :
      '<div class="tw"><table><tbody>' + bl.slice(0, 100).map(function (r) { return '<tr><td>' + esc(r.Name) + '</td><td>' + esc(r.Counterparty_Type || '') + '</td><td>' + esc(r.Ingest_Status && r.Ingest_Status !== '-None-' ? r.Ingest_Status : 'blank') + '</td><td style="text-align:right"><button type="button" class="btn" data-bl="' + esc(r.id) + '">Ingest</button></td></tr>'; }).join('') + '</tbody></table></div>') + '</section></div>';
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">The packet is attached to the contract, then the worker on the PC reads it. Scanned pages with no text layer wait for OCR on the PC. Nothing is changed on rates or clauses until you accept them in review.</p></div>';
    root.innerHTML = h; X.bindSwitch();
    $('ci-rf').onclick = function () { loadC(true).then(function () { cDraw(root); }); };
    $('ci-c').onchange = function (e) { C.sel = e.target.value; C.run = null; C.msg = ''; cDraw(root); };
    $('ci-f').onchange = function (e) { C.files = Array.prototype.slice.call(e.target.files); cDraw(root); };
    $('ci-go').onclick = function () { cStart(root); };
    var o = $('ci-open'); if (o) o.onclick = function () { X.openCrm('Contracts', C.sel); };
    root.onclick = function (e) {
      var t = e.target.closest('[data-t]'); if (t) { C.type = t.getAttribute('data-t'); C.sel = ''; cDraw(root); return; }
      t = e.target.closest('[data-bl]'); if (t) { var r = C.list.filter(function (x) { return x.id === t.getAttribute('data-bl'); })[0]; if (r) { C.type = r.Counterparty_Type === 'Vendor' ? 'Vendor' : 'Customer'; C.sel = r.id; C.run = null; C.msg = 'Selected ' + r.Name + '. Add its packet in step 2.'; cDraw(root); window.scrollTo(0, 0); } }
    };
  }
  function runHtml(R) {
    var chips = (R.docs || []).map(function (d) { var st = d.Parse_Status || ''; var tone = /Parsed/i.test(st) ? 'good' : /No text|OCR/i.test(st) ? 'warn' : /Fail/i.test(st) ? 'bad' : 'info'; return '<tr><td>' + esc(d.File_Name || '') + '</td><td>' + esc(d.Doc_Type || '') + '</td><td>' + X.pillHtml(st || 'Waiting') + '</td></tr>'; }).join('');
    return '<dl><dt>Status</dt><dd>' + esc(R.status || 'Waiting for the worker') + '</dd><dt>Documents</dt><dd>' + (R.docs || []).length + '</dd><dt>Clauses</dt><dd>' + (R.clauses || 0) + '</dd><dt>Rate lines</dt><dd>' + (R.rates || 0) + '</dd></dl>' +
      (R.summary ? '<p style="margin:10px 0 0;font-size:13px">' + esc(R.summary) + '</p>' : '') + (R.note ? '<p class="mut" style="margin:10px 0 0;font-size:12px">' + esc(R.note) + '</p>' : '') +
      (chips ? '<div class="tw" style="margin-top:10px"><table><tbody>' + chips + '</tbody></table></div>' : '') + (R.polling ? '<p class="mut" style="margin:10px 0 0;font-size:12px">Checking every 5 seconds…</p>' : '');
  }
  function cStart(root) {
    var cur = C.list.filter(function (r) { return r.id === C.sel; })[0]; if (!cur || !C.files.length) return;
    C.busy = true; C.msg = ''; cDraw(root);
    var fail = function (e) { C.busy = false; C.msg = 'Could not start the read: ' + errMsg(e) + '. Nothing was ingested.'; cDraw(root); };
    if (!X.isLive()) {
      C.busy = false; C.files = []; C.run = { status: 'Reading', docs: [], clauses: 0, rates: 0, polling: true, start: Date.now(), tick: 0 }; cDraw(root); return pollDemo(root);
    }
    var start = new Date(), ids = [];
    C.files.reduce(function (ch, f) { return ch.then(function () { return sdk().API.attachFile({ Entity: 'Contracts', RecordID: cur.id, File: { Name: f.name, Content: f } }).then(function (r) { var d = okRes(r); if (d && d.details && d.details.id) ids.push(d.details.id); }); }); }, Promise.resolve())
      .then(function () { return runFn('contract_ingest_start', { contractId: String(cur.id), attachmentIds: JSON.stringify(ids) }); })
      .then(function (out) {
        if (out && out.ok === false) throw new Error(out.error || 'The worker refused the packet');
        C.busy = false; C.files = []; C.msg = 'Attached ' + ids.length + ' file(s) and started the read.';
        C.run = { status: 'Queued', docs: [], clauses: 0, rates: 0, polling: true, start: start.getTime(), n: 0, before: cur.Ingest_Status }; cDraw(root); poll(root, cur.id);
      }).catch(fail);
  }
  function pollDemo(root) {
    var R = C.run, steps = [['Reading', [{ File_Name: 'Agreement.pdf', Doc_Type: 'Agreement', Parse_Status: 'Parsed' }], 0, 0], ['Reading', [{ File_Name: 'Agreement.pdf', Doc_Type: 'Agreement', Parse_Status: 'Parsed' }, { File_Name: 'Scan-amend1.pdf', Doc_Type: 'Amendment', Parse_Status: 'No text layer' }], 14, 6], ['Needs Review', null, 14, 6]];
    var i = 0; (function tick() { var s = steps[i++]; if (!s) return; R.status = s[0]; if (s[1]) R.docs = s[1]; R.clauses = s[2]; R.rates = s[3]; if (s[0] === 'Needs Review') { R.done = true; R.polling = false; R.summary = 'Demo: 14 clauses and 6 rate lines found. Open the review to accept them.'; } cDraw(root); if (!R.done) setTimeout(tick, 600); })();
  }
  function poll(root, id) {
    clearTimeout(C.timer); var R = C.run; if (!R) return;
    if (Date.now() - R.start > 600000) { R.polling = false; R.note = 'Still waiting after 10 minutes. The worker may be off. Check back or press Refresh later.'; cDraw(root); return; }
    var sd = sdk(), d0 = new Date(R.start).toISOString();
    Promise.all([
      sd.API.getRecord({ Entity: 'Contracts', RecordID: id }).then(function (r) { return r && r.data && r.data[0] || {}; }, function () { return {}; }),
      X.coql("select id, File_Name, Doc_Type, Text_Layer, Sha1, Parse_Status from Contract_Documents where Contract = '" + q1(id) + "'").then(function (r) { return r.rows; }, function () { return []; }),
      X.coql("select id, Status from Contract_Clauses where Contract = '" + q1(id) + "'").then(function (r) { return r.rows; }, function () { return []; }),
      X.coql("select Note_Title, Note_Content, Created_Time from Notes where Parent_Id = '" + q1(id) + "' order by Created_Time desc limit 5").then(function (r) { return r.rows; }, function () { return []; })
    ]).then(function (a) {
      var rec = a[0], st = rec.Ingest_Status && rec.Ingest_Status !== '-None-' ? rec.Ingest_Status : '';
      R.docs = a[1]; R.clauses = a[2].length; R.rates = (rec.Rate_Lines || []).length; R.summary = rec.Ingest_Summary || '';
      var fresh = a[3].filter(function (n) { return n.Created_Time && new Date(n.Created_Time).getTime() >= R.start; })[0];
      if (fresh) R.note = String(fresh.Note_Content || fresh.Note_Title || '').slice(0, 300);
      R.status = st || R.status;
      var changed = st && st !== R.before;
      if (/Needs Review|Ingested/.test(st) && (changed || fresh)) { R.done = true; R.polling = false; loadC(true); }
      else if (/Failed/.test(st) && changed) { R.polling = false; R.note = (R.note ? R.note + ' ' : '') + 'The read failed. Open the contract to see why.'; R.done = true; }
      else if (fresh && /already read/i.test(R.note || '')) { R.polling = false; R.note = 'The worker says this packet was already read earlier, so nothing changed.'; }
      cDraw(root);
      if (R.polling && C.run === R) C.timer = setTimeout(function () { poll(root, id); }, 5000);
    });
  }
  RM.contract_ingest = { key: 'contract_ingest', title: 'Contract ingest', swLabel: 'Ingest', group: 'Contract', entity: 'Contracts', custom: true, render: function (root, ctx) { X = ctx; cDraw(root); if (!C.loaded && !C.busy) loadC().then(function () { cDraw(root); }); } };

  /* ================= New solicitation ================= */
  var TYPES = ['RFP', 'RFI', 'RFQ', 'Sole Source'];
  var LINES = ['Electronic Monitoring', 'GPS Monitoring', 'Alcohol Monitoring', 'Drug Testing', 'Pretrial Services', 'Other'];
  var SS0 = function () { return { step: 1, v: { type: 'RFP', lines: [], parsers: { text: true, ocr: false } }, file: null, acct: null, hits: [], busy: false, msg: '', err: '', done: null }; };
  var SW = SS0();
  function val(k) { var x = SW.v[k]; return x == null ? '' : x; }
  function inp(k, label, type, ph) { return '<label class="mut" style="display:block;font-size:12px;margin:8px 0 2px">' + label + '</label><input class="search" style="width:100%" data-f="' + k + '" type="' + (type || 'text') + '" value="' + esc(val(k)) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
  function wDraw(root) {
    var s = SW.step, v = SW.v;
    var h = '<div class="wrap">' + X.head('Processes', 'New solicitation', 'Step ' + s + ' of 4: ' + ['Basics', 'Dates', 'Scope', 'Packet'][s - 1], '', '') + X.switchHtml() + X.demoNote();
    if (SW.done) {
      h += '<div class="cards"><section class="card"><h3>Created</h3><p style="margin:0">' + esc(SW.done.name) + ' was created' + (SW.done.attached ? ' and the packet was attached' : '') + '.</p><p class="mut" style="margin:10px 0 0;font-size:12px">' + esc(SW.done.note) + '</p><div class="acts"><button type="button" class="btn pri" id="sw-open">Open solicitation</button><button type="button" class="btn" id="sw-new">Start another</button></div></section></div></div>';
      root.innerHTML = h; X.bindSwitch(); $('sw-open').onclick = function () { X.openCrm('Solicitations', SW.done.id); }; $('sw-new').onclick = function () { SW = SS0(); wDraw(root); }; return;
    }
    h += '<div class="cards"><section class="card" style="grid-column:1/-1">';
    if (s === 1) {
      h += '<h3>Basics</h3>' + inp('name', 'Solicitation name *') + '<label class="mut" style="display:block;font-size:12px;margin:8px 0 2px">Type</label><select class="search" data-f="type">' + TYPES.map(function (t) { return '<option' + (t === v.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>' +
        '<label class="mut" style="display:block;font-size:12px;margin:8px 0 2px">Issuing agency (search accounts)</label>' + (SW.acct ? '<div><b>' + esc(SW.acct.name) + '</b> <button type="button" class="btn" id="sw-clr">Change</button></div>' : '<input class="search" style="width:100%" id="sw-as" placeholder="Type 3 letters" value="' + esc(val('acctq')) + '">' + (SW.hits.length ? '<div class="acts" style="flex-wrap:wrap">' + SW.hits.map(function (a, i) { return '<button type="button" class="btn" data-hit="' + i + '">' + esc(a.name) + '</button>'; }).join('') + '</div>' : '')) +
        (SW.acct ? '' : inp('agencyText', 'Or type the agency if it is not an account yet')) + inp('number', 'Solicitation number') + inp('state', 'Governing state', 'text', 'WI') + inp('portal', 'Portal URL', 'url');
    } else if (s === 2) {
      h += '<h3>Dates</h3>' + inp('release', 'Release date', 'date') + inp('q1', 'Questions due', 'date') + inp('due', 'Proposal due *', 'date') + inp('tz', 'Deadline time zone note', 'text', 'e.g. 2:00 PM Central') + inp('award', 'Anticipated award', 'date') + inp('start', 'Anticipated start', 'date');
    } else if (s === 3) {
      h += '<h3>Scope</h3><div class="acts" style="flex-wrap:wrap;margin:0">' + LINES.map(function (l) { return '<button type="button" class="pillbtn' + '" aria-pressed="' + (v.lines.indexOf(l) > -1) + '" data-ln="' + esc(l) + '">' + esc(l) + '</button>'; }).join('') + '</div>' +
        inp('volume', 'Working volume estimate', 'number') + inp('budget', 'Stated budget', 'number') + '<label class="mut" style="display:block;font-size:12px;margin:8px 0 2px">What the agency is asking for</label><textarea class="search" style="width:100%;min-height:70px" data-f="summary">' + esc(val('summary')) + '</textarea>';
    } else {
      h += '<h3>Packet</h3><input type="file" id="sw-f" accept=".pdf,.zip,.docx,.xlsx"><p class="mut" style="margin:10px 0 0;font-size:12px">' + (SW.file ? kb(SW.file) : 'The solicitation document. Up to 20 MB. You can also skip it and attach later on the record.') + '</p>' +
        '<label style="display:block;margin-top:10px"><input type="checkbox" data-p="text"' + (v.parsers.text ? ' checked' : '') + '> Read text</label><label style="display:block"><input type="checkbox" data-p="ocr"' + (v.parsers.ocr ? ' checked' : '') + '> Run OCR on scanned pages</label>' +
        '<dl style="margin-top:12px"><dt>Name</dt><dd>' + esc(val('name')) + '</dd><dt>Type</dt><dd>' + esc(v.type) + '</dd><dt>Agency</dt><dd>' + esc(SW.acct ? SW.acct.name : val('agencyText')) + '</dd><dt>Proposal due</dt><dd>' + esc(val('due')) + '</dd></dl>';
    }
    if (SW.err) h += '<div class="err" style="margin-top:12px">' + esc(SW.err) + '</div>';
    h += '<div class="acts"><button type="button" class="btn" id="sw-back"' + (s === 1 || SW.busy ? ' disabled' : '') + '>Back</button><button type="button" class="btn pri" id="sw-next"' + (SW.busy ? ' disabled' : '') + '>' + (s < 4 ? 'Next' : SW.busy ? 'Working…' : 'Create solicitation') + '</button></div></section></div>';
    if (SW.msg) h += '<div class="attn" style="background:var(--s1);border-color:var(--line);color:var(--ink)">' + esc(SW.msg) + '</div>';
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">Creates one Solicitation (status Identified), a Prime bid scenario, and starts reading the packet. Afterwards open the record and press Seed spec assessments.</p></div>';
    root.innerHTML = h; X.bindSwitch();
    var read = function () { Array.prototype.forEach.call(root.querySelectorAll('[data-f]'), function (el) { SW.v[el.getAttribute('data-f')] = el.value; }); };
    $('sw-back').onclick = function () { read(); SW.err = ''; SW.step--; wDraw(root); };
    $('sw-next').onclick = function () { read(); SW.err = ''; var e = check(s); if (e) { SW.err = e; wDraw(root); return; } if (s < 4) { SW.step++; wDraw(root); } else wCreate(root); };
    var as = $('sw-as'); if (as) as.oninput = function () { SW.v.acctq = as.value; clearTimeout(as._t); as._t = setTimeout(function () { acctSearch(as.value, root); }, 350); };
    var cl = $('sw-clr'); if (cl) cl.onclick = function () { read(); SW.acct = null; wDraw(root); };
    var ff = $('sw-f'); if (ff) ff.onchange = function (e) { var f = e.target.files[0]; if (f && f.size > 20 * 1048576) { SW.err = 'That file is over 20 MB. Attach it on the record instead.'; SW.file = null; } else { SW.err = ''; SW.file = f || null; } wDraw(root); };
    root.onclick = function (e) {
      var t = e.target.closest('[data-hit]'); if (t) { read(); SW.acct = SW.hits[+t.getAttribute('data-hit')]; SW.hits = []; wDraw(root); return; }
      t = e.target.closest('[data-ln]'); if (t) { read(); var l = t.getAttribute('data-ln'), i = v.lines.indexOf(l); if (i > -1) v.lines.splice(i, 1); else v.lines.push(l); wDraw(root); return; }
      t = e.target.closest('[data-p]'); if (t) v.parsers[t.getAttribute('data-p')] = t.checked;
    };
  }
  function check(s) {
    var v = SW.v;
    if (s === 1 && !String(v.name || '').trim()) return 'Give the solicitation a name.';
    if (s === 1 && !SW.acct && !String(v.agencyText || '').trim()) return 'Choose the issuing agency or type it.';
    if (s === 2) { if (!v.due) return 'Proposal due date is required.'; var d = ['release', 'q1', 'due', 'award', 'start'].filter(function (k) { return v[k]; }).map(function (k) { return v[k]; }); for (var i = 1; i < d.length; i++) if (d[i] < d[i - 1]) return 'Dates must run in order: release, questions, proposal due, award, start.'; }
    return '';
  }
  function acctSearch(text, root) {
    text = String(text || '').trim(); if (text.length < 3) { SW.hits = []; return; }
    if (!X.isLive()) { SW.hits = [{ id: 'a1', name: 'Fond Du Lac Co HHS' }, { id: 'a2', name: 'Dane Co Sheriff' }].filter(function (a) { return a.name.toLowerCase().indexOf(text.toLowerCase()) > -1; }); wRedraw(root); return; }
    X.coql("select id, Account_Name from Accounts where Account_Name like '%" + q1(text) + "%' limit 8").then(function (r) { SW.hits = r.rows.map(function (a) { return { id: a.id, name: a.Account_Name }; }); wRedraw(root); }, function () { SW.hits = []; });
  }
  function wRedraw(root) { Array.prototype.forEach.call(root.querySelectorAll('[data-f]'), function (el) { SW.v[el.getAttribute('data-f')] = el.value; }); var a = document.activeElement, keep = a && a.id === 'sw-as' ? a.value : null; wDraw(root); if (keep != null) { var n = $('sw-as'); if (n) { n.focus(); n.setSelectionRange(keep.length, keep.length); } } }
  function wCreate(root) {
    var v = SW.v; SW.busy = true; SW.msg = ''; wDraw(root);
    var fail = function (e) { SW.busy = false; SW.err = 'Could not finish: ' + errMsg(e); SW.msg = SW.created ? 'The solicitation was already created, so do not start over. Open it and attach the packet there.' : ''; if (SW.created) SW.done = { id: SW.created, name: v.name, attached: false, note: 'The packet step failed: ' + errMsg(e) + '. Attach the file on the record.' }; wDraw(root); };
    var parsers = Object.keys(v.parsers).filter(function (k) { return v.parsers[k]; }).join(',');
    if (!X.isLive()) { return setTimeout(function () { SW.busy = false; SW.done = { id: 'demo', name: v.name, attached: !!SW.file, note: 'Demo: would create the solicitation, a Prime scenario, attach the packet and start reading.' }; wDraw(root); }, 400); }
    var api = sdk().API;
    Promise.all([
      v.number ? X.coql("select id, Name from Solicitations where Solicitation_Number = '" + q1(v.number) + "' limit 1").then(function (r) { return r.rows; }, function () { return []; }) : Promise.resolve([]),
      X.coql("select id, Name from Solicitations where Name = '" + q1(v.name) + "' limit 1").then(function (r) { return r.rows; }, function () { return []; })
    ]).then(function (a) {
      var dup = a[0][0] || a[1][0]; if (dup) throw new Error('A solicitation already exists: ' + dup.Name + '. Open it instead of creating a duplicate.');
      var d = { Name: v.name, Solicitation_Type: v.type, Status: 'Identified' };
      if (SW.acct) d.Issuing_Agency = { id: SW.acct.id }; else d.Issuing_Agency_Text = v.agencyText;
      [['Solicitation_Number', 'number'], ['Governing_State', 'state'], ['Portal_URL', 'portal'], ['Release_Date', 'release'], ['Questions_Round_1_Due', 'q1'], ['Proposal_Due', 'due'], ['Deadline_Timezone_Note', 'tz'], ['Anticipated_Award', 'award'], ['Anticipated_Start', 'start'], ['Service_Type_Summary', 'summary']].forEach(function (m) { if (v[m[1]]) d[m[0]] = v[m[1]]; });
      if (v.lines.length) d.Service_Lines = v.lines;
      if (v.volume) d.Working_Volume_Estimate = +v.volume; if (v.budget) d.Stated_Budget = +v.budget;
      return api.insertRecord({ Entity: 'Solicitations', APIData: d, Trigger: ['workflow'] });
    }).then(function (r) {
      var d = okRes(r); SW.created = d.details.id;
      return api.insertRecord({ Entity: 'Bid_Scenarios', APIData: { Name: v.name + ' (Prime)', Solicitation: { id: SW.created }, Role: 'Prime', Status: 'Active', Recommendation: 'Not yet scored' } }).then(function () {}, function () {});
    }).then(function () {
      if (!SW.file) return false;
      return api.attachFile({ Entity: 'Solicitations', RecordID: SW.created, File: { Name: SW.file.name, Content: SW.file } }).then(function (r) { okRes(r); return runFn('sol_wizard_ingest', { solicitationId: String(SW.created), parsers: parsers }); }).then(function (o) { if (o && o.ok === false) throw new Error(o.error || 'The reader did not start'); return true; });
    }).then(function (att) {
      SW.busy = false; SW.done = { id: SW.created, name: v.name, attached: att, note: att ? 'Reading has started. When it finishes, open the record and press Seed spec assessments.' : 'No packet was attached. Add it on the record when you have it.' }; wDraw(root);
    }).catch(fail);
  }
  RM.solicit_new = { key: 'solicit_new', title: 'New solicitation', swLabel: 'New', group: 'Solicitations', entity: 'Solicitations', custom: true, render: function (root, ctx) { X = ctx; wDraw(root); } };
})();
