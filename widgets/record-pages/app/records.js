/* records.js: shared engine. Reads window.RECORDS_MODULE, renders list + record view for that module. */
(function () {
  'use strict';
  var R = window.RecModel, MODS = window.RecModules, esc = R.esc;
  var cfg = MODS[window.RECORDS_MODULE];
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
  function fetchRecord(id) {
    if (!live) { var r = demoRows().filter(function (x) { return x.id === id; })[0]; return Promise.resolve(r || null); }
    return coql(R.recordQuery(cfg.entity, cfg.rec.select, id)).then(function (x) { return x.rows[0] || null; });
  }
  function fetchRelated(tab, id) {
    if (!live) return Promise.resolve((((window.RECORDS_DEMO || {})[cfg.key] || {}).related || {})[tab.id] || []);
    return coql(R.relatedQuery(tab, id)).then(function (x) { return x.rows; });
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
    var inner = c.pill ? pillHtml(v) : esc(R.fmt(v, c.t));
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

  /* ---------- list view ---------- */
  function showList() {
    var L = cfg.list;
    root.innerHTML = '<div class="wrap">' + head('JusticePoint CRM', cfg.title, '', '', cfg.create ? '<button class="btn pri" id="new" type="button">New</button>' : '') +
      (live ? '' : '<div class="demo">Demo data: connect inside Zoho CRM to see live records.</div>') +
      '<div class="bar"><input class="search" id="q" type="search" placeholder="' + esc(L.searchHint || 'Search') + '" aria-label="Search" value="' + esc(st.search) + '">' +
      '<div id="pills" role="group" aria-label="Filter" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>' +
      '<div class="count" id="count" aria-live="polite"></div><div id="list"></div></div>';
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
  function drawRecord(r, id, scroll) {
    var C = cfg.rec, pill = C.pill(r), attn = C.attn && C.attn(r);
    var h = '<div class="wrap">' + head(C.kicker(r), C.title(r) || '(no name)', C.sub(r), pill ? '<span class="pill ' + pill[1] + '">' + esc(pill[0]) + '</span>' : '',
      '<button class="btn" id="back" type="button">Back to ' + esc(cfg.title) + '</button><button class="btn pri" id="open" type="button">Open in CRM</button>');
    if (!live) h += '<div class="demo">Demo data: connect inside Zoho CRM to see live records.</div>';
    if (attn) h += '<div class="attn" role="alert">' + esc(attn) + '</div>';
    h += '<div class="kpis">' + C.kpis.map(function (k) { var v = R.fmt(k.v(r), k.t), t = k.tone ? k.tone(r) : ''; return '<div class="kpi ' + (t === 'grey' ? '' : t) + '"><div class="l">' + esc(k.label) + '</div><div class="v">' + (v === '' ? '–' : esc(v)) + '</div></div>'; }).join('') + '</div>';
    h += '<div class="cards">' + C.cards.map(function (c) {
      if (c.text) { var tx = R.plain(r[c.text]); return '<section class="card"><h3>' + esc(c.title) + '</h3><div class="txt">' + (tx ? esc(tx) : '<span style="color:var(--mut)">Nothing recorded</span>') + '</div></section>'; }
      return '<section class="card"><h3>' + esc(c.title) + '</h3><dl>' + c.rows.map(function (x) { var v = R.fmt(r[x[1]], x[2]); return '<dt>' + esc(x[0]) + '</dt><dd>' + (v === '' ? '<span style="color:var(--mut)">–</span>' : esc(v)) + '</dd>'; }).join('') + '</dl></section>';
    }).join('') + '</div>';
    if (C.tabs.length) h += '<div class="tabs" role="tablist" id="tabs">' + C.tabs.map(function (t, i) { return '<button type="button" class="tab" role="tab" data-t="' + esc(t.id) + '" aria-selected="' + (i === 0) + '">' + esc(t.label) + '<span class="cnt" id="cnt-' + esc(t.id) + '">…</span></button>'; }).join('') + '</div><div class="pane" id="pane"></div>';
    root.innerHTML = h + '</div>';
    document.getElementById('back').onclick = backToList;
    document.getElementById('open').onclick = function () { openCrm(cfg.entity, id); };
    window.scrollTo(0, 0);
    if (!C.tabs.length) return;
    var data = {}, cur = C.tabs[0].id;
    function paint() {
      var t = C.tabs.filter(function (x) { return x.id === cur; })[0], rows = data[cur], pane = document.getElementById('pane');
      if (!pane) return;
      if (rows === undefined) { pane.innerHTML = '<div class="empty">Loading…</div>'; return; }
      if (rows === 'err') { pane.innerHTML = '<div class="err">Could not load ' + esc(t.label) + '.</div>'; return; }
      if (!rows.length) { pane.innerHTML = '<div class="empty">No ' + esc(t.label.toLowerCase()) + ' yet.</div>'; return; }
      pane.innerHTML = tableHtml(t.cols, rows, true);
      var tb = pane.querySelector('tbody');
      tb.onclick = function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) openCrm(t.open || t.entity, rows[+tr.getAttribute('data-i')].id); };
      tb.onkeydown = function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-i]')) openCrm(t.open || t.entity, rows[+e.target.getAttribute('data-i')].id); };
    }
    document.getElementById('tabs').onclick = function (e) {
      var b = e.target.closest('[data-t]'); if (!b) return; cur = b.getAttribute('data-t');
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (x) { x.setAttribute('aria-selected', x === b); }); paint();
    };
    C.tabs.forEach(function (t) {
      fetchRelated(t, id).then(function (rows) { data[t.id] = rows; var c = document.getElementById('cnt-' + t.id); if (c) c.textContent = rows.length >= 200 ? '200+' : rows.length; paint(); },
        function () { data[t.id] = 'err'; var c = document.getElementById('cnt-' + t.id); if (c) c.textContent = '!'; paint(); });
    });
    paint();
  }

  /* ---------- start ---------- */
  function start(init) {
    live = !!(init && !init.demo);
    var eid = init && init.EntityId; eid = Array.isArray(eid) ? eid[0] : eid;
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
