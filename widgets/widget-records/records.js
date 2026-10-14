/* records.js: shared engine. Reads window.RECORDS_MODULE, renders list + record view for that module. */
(function () {
  'use strict';
  var R = window.RecModel, MODS = window.RecModules, esc = R.esc;
  var cfg = MODS[window.RECORDS_MODULE];
  var SW = window.RECORDS_SWITCH || null;   /* combined page: list of module keys to switch between */
  var root = document.getElementById('app');
  if (!cfg) { root.innerHTML = '<div class="err">Unknown module: ' + esc(window.RECORDS_MODULE) + '</div>'; return; }

  var live = false;                       /* true once the Zoho SDK answers PageLoad */
  var st = { filter: 'all', search: '', rows: [], offset: 0, more: false, loading: false, token: 0 };
  var PAGE = 100;

  /* ---------- data layer ---------- */
  function coql(q) {
    return new Promise(function (resolve, reject) {
      window.ZOHO.CRM.API.coql({ select_query: q }).then(function (res) {
        resolve({ rows: (res && res.data) || [], more: !!(res && res.info && res.info.more_records) });
      }, function (e) {
        if (!e || e.status === 204 || e.code === 'NO_CONTENT' || e === '') resolve({ rows: [], more: false });
        else reject(new Error((e.message || (e.data && e.data[0] && e.data[0].message) || e.code || 'Query failed')));
      });
    });
  }
  function demoRows() { return ((window.RECORDS_DEMO || {})[cfg.key] || {}).rows || []; }
  function fetchList() {
    var f = cfg.list.filters.filter(function (x) { return x.key === st.filter; })[0];
    if (!live) {
      var s = st.search.toLowerCase(), sf = cfg.list.searchField;
      var rows = demoRows().filter(function (r) { return !s || String(R.plain(r[sf]) || '').toLowerCase().indexOf(s) >= 0; });
      return Promise.resolve({ rows: rows, more: false });
    }
    var c = { select: cfg.list.select, order: cfg.list.order, searchField: cfg.list.searchField, page: PAGE };
    return coql(R.listQuery(cfg.entity, c, { where: f && f.where, search: st.search, offset: st.offset }));
  }
  var REL = window.RecRelations, LAY = window.RecLayouts || {}, GEN = window.RecRelMods || {};
  var SDKOPEN = { Contract_Roles: null, Stage_History: null, CheckLists: null, Contact_Roles: null, Products: 'Products', Cases: 'Cases', Deals: 'Deals', Contact_Name: 'Products' };
  function sdkEntity(list) { if (list in SDKOPEN) return SDKOPEN[list]; return list.replace(/\d+$/, ''); }
  function normRec(r) { if (r && r.Owner && !r['Owner.first_name']) r['Owner.first_name'] = R.plain(r.Owner); return r; }
  function fetchRecord(id) {
    if (!live) { var r = demoRows().filter(function (x) { return x.id === id; })[0]; return Promise.resolve(r || null); }
    var viaCoql = function () { return coql(R.recordQuery(cfg.entity, cfg.rec.select, id)).then(function (x) { return x.rows[0] || null; }); };
    return window.ZOHO.CRM.API.getRecord({ Entity: cfg.entity, RecordID: id }).then(function (res) {
      var d = res && res.data && res.data[0]; return d ? normRec(d) : viaCoql();
    }, viaCoql);
  }
  function sdkRelated(entity, id, list) {
    return window.ZOHO.CRM.API.getRelatedRecords({ Entity: entity, RecordID: id, RelatedList: list, page: 1, per_page: 200 }).then(
      function (res) { return (res && res.data) || []; },
      function (e) { if (!e || e.status === 204 || e === '' || e.code === 'NO_CONTENT') return []; throw new Error((e && (e.message || e.code)) || 'Related list failed'); });
  }
  function safe(p) { return p.then(function (x) { return { ok: 1, v: x }; }, function (e) { return { ok: 0, e: e }; }); }
  var ACTCOLS = [{ k: 'Type', label: 'Type', pill: 1 }, { k: 'Subject', label: 'Subject', main: 1 }, { k: 'When', label: 'When', t: 'date' }, { k: 'Status', label: 'Status' }];
  var NOTECOLS = [{ k: 'Note_Title', label: 'Title', main: 1 }, { k: 'Note_Content', label: 'Note', trunc: 220 }, { k: 'Created_Time', label: 'Added', t: 'date' }];
  var ATTCOLS = [{ k: 'File_Name', label: 'File', main: 1 }, { k: 'Size', label: 'Size', t: 'bytes', r: 1 }, { k: 'Created_Time', label: 'Added', t: 'date' }];
  var EMCOLS = [{ k: 'Dir', label: '', pill: 1 }, { k: 'Subject', label: 'Subject', main: 1 }, { k: 'From', label: 'From' }, { k: 'To', label: 'To' }, { k: 'When', label: 'When', t: 'date' }, { k: 'Att', label: 'Files' }];
  function inferCols(rows) {
    var skip = /^(id|Owner|Created_By|Modified_By|Created_Time|Modified_Time|Tag|Record_Image|Locked__s|\$.*|.*_Id|Last_Activity_Time|Unsubscribed_Mode|Unsubscribed_Time)$/;
    var r0 = rows[0] || {}, keys = Object.keys(r0).filter(function (k) { return !skip.test(k) && r0[k] != null && r0[k] !== '' && typeof r0[k] !== 'boolean' || (k.indexOf('$') !== 0 && typeof r0[k] === 'boolean'); });
    keys = keys.filter(function (k) { return !skip.test(k); });
    keys.sort(function (a, b) { var f = function (k) { return /name|subject|title|stage|role/i.test(k) ? 0 : 1; }; return f(a) - f(b); });
    return keys.slice(0, 5).map(function (k, i) {
      var v = r0[k], c = { k: k, label: R.label(k), main: i === 0 ? 1 : 0 };
      if (typeof v === 'boolean') c.t = 'bool'; else if (typeof v === 'number') c.t = 'num'; else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) c.t = 'date';
      return c;
    });
  }
  function demoRel(item) {
    var d = ((window.RECORDS_DEMO || {})[cfg.key] || {}).related || {}, com = window.RECORDS_COMMON || {};
    var rows = d[item.id] || com[item.kind] || [];
    var cols = item.kind === 'notes' ? NOTECOLS : item.kind === 'attach' ? ATTCOLS : item.kind === 'acts' ? ACTCOLS : item.kind === 'emails' ? EMCOLS : item.cols || inferCols(rows);
    return { cols: cols, rows: rows, open: null };
  }
  /* Loads one related list. Resolves {cols, rows, open(row)->[entity,id]|null} or {note}. */
  function fetchRelated(item, id) {
    if (item.kind === 'widget') return Promise.resolve({ note: item.note });
    if (!live) return Promise.resolve(demoRel(item));
    var E = cfg.entity, rid = R.cleanId(id);
    if (item.kind === 'coql') return coql(R.relatedQuery(item, id)).then(function (x) { return { cols: item.cols, rows: x.rows, open: function (r) { return [item.open || item.entity, r.id]; } }; });
    if (item.kind === 'sdk') return sdkRelated(E, id, item.list).then(function (rows) {
      var en = sdkEntity(item.list); return { cols: inferCols(rows), rows: rows, open: en ? function (r) { return [en, r.id]; } : null };
    });
    if (item.kind === 'notes') return coql("select Note_Title, Note_Content, Created_Time from Notes where Parent_Id = '" + rid + "' order by Created_Time desc limit 200").then(function (x) { return { cols: NOTECOLS, rows: x.rows }; },
      function () { return sdkRelated(E, id, 'Notes').then(function (rows) { return { cols: NOTECOLS, rows: rows }; }); });
    if (item.kind === 'attach') return coql("select File_Name, Size, Created_Time from Attachments where Parent_Id = '" + rid + "' order by Created_Time desc limit 200").then(function (x) { return { cols: ATTCOLS, rows: x.rows }; },
      function () { return sdkRelated(E, id, 'Attachments').then(function (rows) { return { cols: ATTCOLS, rows: rows }; }); });
    if (item.kind === 'emails') return sdkRelated(E, id, 'Emails').then(function (rows) {
      var who = function (p) { return p ? (p.user_name || p.name || p.email || '') : ''; };
      return { cols: EMCOLS, rows: rows.map(function (m) {
        return { id: m.message_id || m.id, Dir: m.sent === false ? 'Received' : 'Sent', Subject: m.subject, From: who(m.from), To: (m.to || []).map(who).join(', '), When: m.sent_time || m.time || m.date, Att: m.attachments && m.attachments.length ? m.attachments.length + ' file(s)' : '' };
      }) };
    });
    if (item.kind === 'acts') {
      var w = item.who || 'What_Id', q = function (sel, ent, ord) { return coql('select ' + sel + ' from ' + ent + ' where ' + w + " = '" + rid + "' order by " + ord + ' limit 100'); };
      return Promise.all([
        safe(q('Subject, Status, Due_Date', 'Tasks', 'Due_Date desc')), safe(q('Event_Title, Start_DateTime', 'Events', 'Start_DateTime desc')), safe(q('Subject, Call_Type, Call_Start_Time', 'Calls', 'Call_Start_Time desc'))
      ]).then(function (rs) {
        if (!rs[0].ok && !rs[1].ok && !rs[2].ok) throw rs[0].e;
        var out = [];
        if (rs[0].ok) rs[0].v.rows.forEach(function (r) { out.push({ id: r.id, Type: 'Task', Subject: r.Subject, When: r.Due_Date, Status: r.Status, _e: 'Tasks' }); });
        if (rs[1].ok) rs[1].v.rows.forEach(function (r) { out.push({ id: r.id, Type: 'Meeting', Subject: r.Event_Title, When: r.Start_DateTime, Status: '', _e: 'Events' }); });
        if (rs[2].ok) rs[2].v.rows.forEach(function (r) { out.push({ id: r.id, Type: 'Call', Subject: r.Subject, When: r.Call_Start_Time, Status: r.Call_Type, _e: 'Calls' }); });
        out.sort(function (a, b) { return String(b.When || '').localeCompare(String(a.When || '')); });
        return { cols: ACTCOLS, rows: out, open: function (r) { return [r._e, r.id]; } };
      });
    }
    return Promise.resolve({ cols: [], rows: [] });
  }
  function openCrm(entity, id) { if (live) window.ZOHO.CRM.UI.Record.open({ Entity: entity, RecordID: id }); else toast('Opens the CRM record when running inside Zoho'); }
  function createCrm() { if (live) window.ZOHO.CRM.UI.Record.create({ Entity: cfg.entity }); else toast('Opens the New form when running inside Zoho'); }

  var toastEl, toastT;
  function toast(m) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.setAttribute('role', 'status'); toastEl.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1A2B2D;border:1px solid #2A3F41;color:#E4EEEE;padding:9px 16px;border-radius:8px;z-index:9'; document.body.appendChild(toastEl); }
    toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------- rendering helpers ---------- */
  function pillHtml(v, tone) { var t = R.plain(v); return t == null || t === '' ? '' : '<span class="pill ' + (tone || R.tone(t)) + '">' + esc(t) + '</span>'; }
  function cell(c, row) {
    var v = row[c.k], cls = [];
    if (c.r) cls.push('r'); if (c.main) cls.push('main');
    var inner = c.pill ? pillHtml(v) : esc(c.trunc ? R.trunc(R.fmt(v, c.t), c.trunc) : R.fmt(v, c.t));
    return '<td class="' + cls.join(' ') + '">' + inner + '</td>';
  }
  function tableHtml(cols, rows, clickable) {
    var h = '<div class="tw"><table><thead><tr>' + cols.map(function (c) { return '<th scope="col"' + (c.r ? ' class="r"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) { h += '<tr data-i="' + i + '"' + (clickable ? ' class="click" tabindex="0"' : '') + '>' + cols.map(function (c) { return cell(c, r); }).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }
  function head(kick, title, sub, pill, buttons) {
    return '<div class="stripe"></div><header class="hdr"><div class="grow"><div class="kick">' + esc(kick) + '</div><h1>' + esc(title) + '</h1>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>' + (pill || '') + (buttons || '') + '</header>';
  }

  function switchHtml() {
    if (!SW) return '';
    var g = null;
    return '<div class="sw" role="tablist" aria-label="Module">' + SW.map(function (k) { var m = MODS[k], pre = ''; if (m.group && m.group !== g) pre = '<span class="swg">' + esc(m.group) + '</span>'; g = m.group || g;
      return pre + '<button type="button" class="swb" role="tab" data-m="' + esc(k) + '" aria-selected="' + (m === cfg) + '">' + esc(m.swLabel || m.title) + '</button>'; }).join('') + '</div>';
  }
  function bindSwitch() {
    var b = root.querySelector('.sw'); if (!b) return;
    b.onclick = function (e) { var x = e.target.closest('[data-m]'); if (!x) return; var k = x.getAttribute('data-m'); if (MODS[k] === cfg) return; cfg = MODS[k]; st.filter = 'all'; st.search = ''; st.token++; showList(); };
  }

  /* ---------- list view ---------- */
  function showList() {
    if (cfg.custom) { cfg.render(root, CTX); return; }
    var L = cfg.list;
    root.innerHTML = '<div class="wrap">' + head('JusticePoint CRM', cfg.title, '', '', cfg.create ? '<button class="btn pri" id="new" type="button">New</button>' : '') +
      switchHtml() + (live ? '' : '<div class="demo">Demo data: connect inside Zoho CRM to see live records.</div>') +
      '<div class="bar"><input class="search" id="q" type="search" placeholder="' + esc(L.searchHint || 'Search') + '" aria-label="Search" value="' + esc(st.search) + '">' +
      '<div id="pills" role="group" aria-label="Filter" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>' +
      '<div class="count" id="count" aria-live="polite"></div><div id="list"></div></div>';
    bindSwitch();
    var nb = document.getElementById('new'); if (nb) nb.onclick = createCrm;
    var t; document.getElementById('q').oninput = function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.search = v.trim(); reload(); }, 300); };
    drawPills(); reload();
  }
  function drawPills() {
    var p = document.getElementById('pills');
    p.innerHTML = cfg.list.filters.map(function (f) { return '<button type="button" class="pillbtn" data-f="' + esc(f.key) + '" aria-pressed="' + (f.key === st.filter) + '">' + esc(f.label) + '</button>'; }).join('');
    p.onclick = function (e) { var b = e.target.closest('[data-f]'); if (b) { st.filter = b.getAttribute('data-f'); drawPills(); reload(); } };
  }
  function reload() { st.rows = []; st.offset = 0; st.more = false; loadMore(true); }
  function loadMore(first) {
    var tok = ++st.token, box = document.getElementById('list'); if (!box) return;
    if (first) box.innerHTML = '<div class="empty">Loading…</div>';
    fetchList().then(function (res) {
      if (tok !== st.token) return;
      st.rows = st.rows.concat(res.rows); st.more = live && res.rows.length >= PAGE; st.offset += res.rows.length;
      drawList();
    }, function (e) { if (tok === st.token) box.innerHTML = '<div class="err">Could not load ' + esc(cfg.title) + ': ' + esc(e.message) + '</div>'; });
  }
  function drawList() {
    var box = document.getElementById('list'); if (!box) return;
    document.getElementById('count').textContent = st.rows.length + (st.more ? '+' : '') + ' ' + cfg.title.toLowerCase();
    if (!st.rows.length) { box.innerHTML = '<div class="empty"><b>Nothing here</b><br>No ' + esc(cfg.title.toLowerCase()) + ' match this search or filter.</div>'; return; }
    box.innerHTML = tableHtml(cfg.list.cols, st.rows, true) + (st.more ? '<button type="button" class="btn more" id="more">Load more</button>' : '');
    var tb = box.querySelector('tbody');
    tb.onclick = function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) showRecord(st.rows[+tr.getAttribute('data-i')].id); };
    tb.onkeydown = function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-i]')) showRecord(st.rows[+e.target.getAttribute('data-i')].id); };
    var m = document.getElementById('more'); if (m) m.onclick = function () { m.disabled = true; loadMore(false); };
  }

  /* ---------- record view ---------- */
  function showRecord(id) {
    var scroll = window.scrollY;
    root.innerHTML = '<div class="wrap"><div class="stripe"></div><div class="empty">Loading…</div></div>';
    fetchRecord(id).then(function (r) {
      if (!r) { root.innerHTML = '<div class="wrap"><div class="err">That record could not be found. <button class="btn" id="back" type="button">Back</button></div></div>'; document.getElementById('back').onclick = backToList; return; }
      drawRecord(r, id, scroll);
    }, function (e) { root.innerHTML = '<div class="wrap"><div class="err">Could not load record: ' + esc(e.message) + ' <button class="btn" id="back" type="button">Back</button></div></div>'; document.getElementById('back').onclick = backToList; });
  }
  function backToList() { showList(); }
  function fieldVal(r, f) {
    var v = r[f[0]];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
    return R.fmt(v, f[2] === 'long' || f[2] === 'multi' || f[2] === 'text' ? null : f[2]);
  }
  function sectionsHtml(r, showEmpty) {
    var secs = LAY[cfg.entity] || [], hidden = 0, out = '';
    secs.forEach(function (s) {
      var rows = '', n = 0;
      s.fields.forEach(function (f) {
        var v = fieldVal(r, f);
        if (v === '') { hidden++; if (!showEmpty) return; }
        n++;
        rows += f[2] === 'long' ? '<div class="lg"><dt>' + esc(f[1]) + '</dt><dd>' + (v === '' ? '<span class="mut">–</span>' : esc(v)) + '</dd></div>' :
          '<dt>' + esc(f[1]) + '</dt><dd>' + (v === '' ? '<span class="mut">–</span>' : esc(v)) + '</dd>';
      });
      if (n) out += '<section class="card"><h3>' + esc(s.title) + '</h3><dl>' + rows + '</dl></section>';
    });
    return { html: out, hidden: hidden, any: secs.length > 0 };
  }
  function drawRecord(r, id, scroll) {
    var C = cfg.rec, pill = C.pill(r), attn = C.attn && C.attn(r), showEmpty = false;
    var h = '<div class="wrap">' + head(C.kicker(r), C.title(r) || '(no name)', C.sub(r), pill ? '<span class="pill ' + pill[1] + '">' + esc(pill[0]) + '</span>' : '',
      '<button class="btn" id="back" type="button">Back to ' + esc(cfg.title) + '</button><button class="btn pri" id="open" type="button">Open in CRM</button>');
    if (!live) h += '<div class="demo">Demo data: connect inside Zoho CRM to see live records.</div>';
    if (attn) h += '<div class="attn" role="alert">' + esc(attn) + '</div>';
    h += '<div class="kpis">' + C.kpis.map(function (k) { var v = R.fmt(k.v(r), k.t), t = k.tone ? k.tone(r) : ''; return '<div class="kpi ' + (t === 'grey' ? '' : t) + '"><div class="l">' + esc(k.label) + '</div><div class="v">' + (v === '' ? '–' : esc(v)) + '</div></div>'; }).join('') + '</div>';
    h += '<div class="fbar"><button type="button" class="pillbtn" id="emp" aria-pressed="false"></button></div><div class="cards" id="secs"></div>';
    var items = REL.forModule(cfg.entity, GEN);
    if (items.length) h += '<div class="tabs" role="tablist" id="tabs">' + items.map(function (t, i) { return '<button type="button" class="tab" role="tab" data-t="' + esc(t.id) + '" aria-selected="' + (i === 0) + '">' + esc(t.label) + '<span class="cnt" id="cnt-' + esc(t.id) + '"></span></button>'; }).join('') + '</div><div class="pane" id="pane"></div>';
    root.innerHTML = h + '</div>';
    document.getElementById('back').onclick = backToList;
    document.getElementById('open').onclick = function () { openCrm(cfg.entity, id); };
    function paintSecs() {
      var s = sectionsHtml(r, showEmpty), b = document.getElementById('emp');
      document.getElementById('secs').innerHTML = s.html || '<div class="empty">No fields to show.</div>';
      b.hidden = !s.any || (!s.hidden && !showEmpty); b.setAttribute('aria-pressed', showEmpty); b.textContent = showEmpty ? 'Hide empty fields' : 'Show ' + s.hidden + ' empty fields';
    }
    document.getElementById('emp').onclick = function () { showEmpty = !showEmpty; paintSecs(); };
    paintSecs(); window.scrollTo(0, 0);
    if (!items.length) return;
    var data = {}, pend = {}, cur = items[0].id;
    function setCnt(t, txt) { var c = document.getElementById('cnt-' + t.id); if (c) c.textContent = txt; }
    function paint() {
      var t = items.filter(function (x) { return x.id === cur; })[0], d = data[cur], pane = document.getElementById('pane');
      if (!pane) return;
      if (d === undefined) { pane.innerHTML = '<div class="empty">Loading…</div>'; return; }
      if (d.err) { pane.innerHTML = '<div class="err">Could not load ' + esc(t.label) + ': ' + esc(d.err) + '. Use Open in CRM to see this list there.</div>'; return; }
      if (d.note) { pane.innerHTML = '<div class="empty"><b>' + esc(t.label) + '</b><br>' + esc(d.note) + '<br><br><button class="btn" type="button" id="wopen">Open in CRM</button></div>'; document.getElementById('wopen').onclick = function () { openCrm(cfg.entity, id); }; return; }
      if (!d.rows.length) { pane.innerHTML = '<div class="empty">No ' + esc(t.label.toLowerCase()) + ' yet.</div>'; return; }
      pane.innerHTML = tableHtml(d.cols, d.rows, !!d.open);
      if (!d.open) return;
      var go = function (tr) { if (!tr) return; var rw = d.rows[+tr.getAttribute('data-i')], o = d.open(rw); if (o && o[1]) openCrm(o[0], o[1]); };
      var tb = pane.querySelector('tbody');
      tb.onclick = function (e) { go(e.target.closest('tr[data-i]')); };
      tb.onkeydown = function (e) { if (e.key === 'Enter') go(e.target.closest('tr[data-i]')); };
    }
    function load(t) {
      if (t.id in data || pend[t.id]) return pend[t.id] || Promise.resolve();
      return pend[t.id] = fetchRelated(t, id).then(function (d) {
        data[t.id] = d; if (!d.note) setCnt(t, d.rows.length >= 200 ? '200+' : d.rows.length);
      }, function (e) { data[t.id] = { err: e.message || 'failed' }; setCnt(t, '!'); }).then(function () { if (cur === t.id) paint(); });
    }
    document.getElementById('tabs').onclick = function (e) {
      var b = e.target.closest('[data-t]'); if (!b) return; cur = b.getAttribute('data-t');
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (x) { x.setAttribute('aria-selected', x === b); });
      paint(); load(items.filter(function (x) { return x.id === cur; })[0]);
    };
    items.slice(0, 6).forEach(load); paint();
  }

  var CTX = { R: R, esc: esc, head: head, tableHtml: tableHtml, pillHtml: pillHtml, openCrm: openCrm, toast: toast, coql: coql, isLive: function () { return live; }, switchHtml: switchHtml, bindSwitch: bindSwitch, demoNote: function () { return live ? '' : '<div class="demo">Demo data: connect inside Zoho CRM to see live records.</div>'; } };

  /* ---------- start ---------- */
  function start(init) {
    live = !!(init && !init.demo);
    var eid = init && init.EntityId; eid = Array.isArray(eid) ? eid[0] : eid;
    if (SW && live && eid) { SW.forEach(function (k) { if (MODS[k].entity === init.Entity) cfg = MODS[k]; }); }
    if (live && eid && init.Entity === cfg.entity) showRecord(String(eid)); else showList();
  }
  var done = false;
  function go(init) { if (done) return; done = true; start(init); }
  if (window.ZOHO && window.ZOHO.embeddedApp) {
    window.ZOHO.embeddedApp.on('PageLoad', function (d) { go(d || {}); });
    window.ZOHO.embeddedApp.init();
    setTimeout(function () { go({ demo: true }); }, 5000);
  } else go({ demo: true });
})();
