/* records.js: shared engine. Reads window.RECORDS_MODULE, renders list + record view for that module.
   Optional page globals: RECORDS_SWITCH (module keys), RECORDS_TAB (tab name for the breadcrumb), RECORDS_GROUPED (Processes: group tabs + sub-tabs). */
(function () {
  'use strict';
  var R = window.RecModel, MODS = window.RecModules, esc = R.esc;
  var cfg = MODS[window.RECORDS_MODULE];
  var SW = window.RECORDS_SWITCH || null;   /* combined page: list of module keys to switch between */
  var TAB = window.RECORDS_TAB || 'Records', GROUPED = !!window.RECORDS_GROUPED;
  var root = document.getElementById('app');
  if (!cfg) { root.innerHTML = '<div class="err">Unknown module: ' + esc(window.RECORDS_MODULE) + '</div>'; return; }

  var live = false;                       /* true once the Zoho SDK answers PageLoad */
  var st = { filter: 'all', search: '', rows: [], offset: 0, more: false, loading: false, token: 0, pl: {}, admin: false };
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
      var rows = demoRows().filter(function (r) { return (!s || String(R.plain(r[sf]) || '').toLowerCase().indexOf(s) >= 0) && demoBrandOk(r); });
      return Promise.resolve({ rows: rows, more: false });
    }
    var c = { select: cfg.list.select, order: cfg.list.order, searchField: cfg.list.searchField, page: PAGE };
    var bw = brandWhere(), where = f && f.where, search = st.search, clientSearch = null;
    if (bw) {   /* this org's COQL takes at most two ANDed conditions: brand + filter go to the server, search is then applied to the page client-side */
      where = where ? '(' + where + ') and (' + bw + ')' : bw;
      if (search && where !== bw) { clientSearch = search; search = ''; }
      else if (search) { where = bw; }
    }
    st.clientSearch = clientSearch;
    return coql(R.listQuery(cfg.entity, c, { where: where, search: search, offset: st.offset })).then(function (res) {
      if (clientSearch) { var cs = clientSearch.toLowerCase(), sf2 = cfg.list.searchField; res.rows = res.rows.filter(function (r) { return String(R.plain(r[sf2]) || '').toLowerCase().indexOf(cs) >= 0; }); }
      return res;
    }, function (e) {
      if (bw && !brandOff[cfg.key]) { brandOff[cfg.key] = true; brandNote(); return fetchList(); }   /* field not filterable here: fall back once, unscoped */
      throw e;
    });
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

  /* ---------- edit in place: one write path for every view (Zoho record permissions still apply to each write) ---------- */
  function update(entity, id, data) {
    if (!live) return Promise.resolve();
    var d = {}; Object.keys(data).forEach(function (k) { d[k] = data[k]; }); d.id = id;
    return window.ZOHO.CRM.API.updateRecord({ Entity: entity, APIData: d }).then(function (res) {
      var x = res && res.data && res.data[0];
      if (x && x.code && x.code !== 'SUCCESS') throw new Error(errMsg(x));
    }, function (e) { throw (e instanceof Error ? e : new Error(errMsg(e))); });
  }
  /* Zoho rejects with plain objects (not Error), which used to show as "object"; pull out the readable part */
  function errMsg(e) {
    if (!e) return 'unknown error'; if (typeof e === 'string') return e;
    var x = (e.data && e.data[0]) || e, m = x.message || e.message || x.code || e.code, det = x.details && (x.details.api_name || x.details.message);
    if (typeof m === 'string' && m) return m + (det ? ' (' + det + ')' : '') + (/blueprint/i.test(m + ' ' + (x.code || '')) ? '' : '');
    try { return JSON.stringify(e).slice(0, 200); } catch (_) { return 'unknown error'; }
  }
  var CASE_STEP_FN = 'case_step';   /* Deluge function (REST API on): runs one blueprint step now; args caseId, transitionName, noteText */
  var plCache = {};
  function picklist(entity, field, fallback) {
    var k = entity + '.' + field; if (plCache[k]) return Promise.resolve(plCache[k]);
    if (!live || !window.ZOHO.CRM.META || !window.ZOHO.CRM.META.getFields) return Promise.resolve(fallback || []);
    return window.ZOHO.CRM.META.getFields({ Entity: entity }).then(function (res) {
      var f = ((res && res.fields) || []).filter(function (x) { return x.api_name === field; })[0];
      var v = f && f.pick_list_values ? f.pick_list_values.map(function (p) { return p.actual_value; }).filter(function (x) { return x && x !== '-None-'; }) : [];
      if (v.length) plCache[k] = v; return v.length ? v : (fallback || []);
    }, function () { return fallback || []; });
  }
  /* admin-only quick-edit fields (flag admin:true in modules.js): editable only when the signed-in user's profile is Administrator.
     Fails closed (read-only) if the profile cannot be read. This is a screen guard; Zoho profile permissions remain the real lock. */
  /* v3.1 (Oct 14): role checks by Zoho profile name. admin = Administrator, em = EM Support (EM Operations), bd = Business Development.
     Demo mode acts as Administrator unless the page URL has ?role=em|bd|standard. Fails closed (no edit) when the profile cannot be read. */
  var ROLE_RX = { admin: /^(administrator|super admin)/i, em: /^em support/i, bd: /^business development/i };
  var DEMO_PROFILE = { admin: 'Administrator', em: 'EM Support', bd: 'Business Development', standard: 'Standard' };
  var profP = null;
  function profileName() {
    if (profP) return profP;
    if (!live) { var m = /[?&]role=(\w+)/.exec(location.search); return (profP = Promise.resolve(DEMO_PROFILE[m ? m[1] : 'admin'] || 'Standard')); }
    profP = new Promise(function (res) {
      var t = setTimeout(function () { res(''); }, 10000);
      window.ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { clearTimeout(t); var u = r && r.users && r.users[0]; res(String((u && u.profile && u.profile.name) || '')); }, function () { clearTimeout(t); res(''); });
    });
    return profP;
  }
  function hasRole(roles) { return profileName().then(function (pn) { return !!pn && roles.some(function (k) { return ROLE_RX[k] && ROLE_RX[k].test(pn); }); }); }
  function isAdmin() { return hasRole(['admin']); }
  /* inline edit inside related-list tabs on record pages (Administrator, EM Support, Business Development) */
  var TAB_ROLES = ['admin', 'em', 'bd'];
  var TAB_ED = {
    Deals: { Stage: { ed: 'pick', opts: ['Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] }, Closing_Date: { ed: 'date' } },
    Cases: { Status: { ed: 'pick', opts: ['New', 'In Progress', 'On Hold', 'Closed'] }, Priority: { ed: 'pick', opts: ['High', 'Medium', 'Low'] } },
    Customer_Onboarding: { Status: { ed: 'pick', opts: ['Not started', 'In progress', 'Blocked', 'Complete'] }, Risk: { ed: 'pick', opts: ['Low', 'Medium', 'High'] } },
    Tasks: { Status: { ed: 'pick', opts: ['Not Started', 'Deferred', 'In Progress', 'Completed', 'Waiting for input'] }, Due_Date: { ed: 'date' } },
    Contract_Clauses: { Status: { ed: 'pick', opts: ['Proposed', 'Confirmed', 'Rejected'] } }
  };
  /* the entity a related row is written to, or null when that row cannot be edited here */
  function tabEntity(item, row) {
    if (item.kind === 'coql') return TAB_ED[item.entity] ? item.entity : null;
    if (item.kind === 'acts') return (row._e || (row.Type === 'Task' ? 'Tasks' : '')) === 'Tasks' ? 'Tasks' : null;
    if (item.kind === 'coql-tasks') return 'Tasks';
    return null;
  }
  function tabCols(item, cols) {
    var ent = item.kind === 'acts' ? 'Tasks' : item.entity, spec = TAB_ED[ent]; if (!spec) return null;
    var any = false, out = cols.map(function (c) { var s = spec[c.k]; if (!s) return c; any = true; var o = {}; for (var k in c) o[k] = c[k]; o.ed = s.ed; o.opts = s.opts; o.edEntity = ent; if (item.kind === 'acts') o.edIf = function (r) { return !!tabEntity(item, r); }; return o; });
    return any ? out : null;
  }
  var usersCache = null;
  function userList() {
    if (usersCache) return Promise.resolve(usersCache);
    var demo = [{ id: 'u1', name: 'Beau Carrigan' }, { id: 'u2', name: 'Dana Pipeline' }];
    if (!live || !window.ZOHO.CRM.API.getAllUsers) return Promise.resolve(demo);
    return window.ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' }).then(function (r) {
      var us = ((r && r.users) || []).map(function (u) { return { id: String(u.id), name: u.full_name || u.name || '' }; }).filter(function (u) { return u.id && u.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      usersCache = us; return us;
    }, function () { return []; });
  }
  var lastSaved = 0;
  function toastUndo(m, undo) {
    toast(m);
    if (/^Saved/.test(m)) lastSaved = Date.now();
    if (!undo || !toastEl) return;
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Undo';
    b.onclick = function () { toastEl.hidden = true; undo(); }; toastEl.appendChild(b); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 7000);
  }
  var apiOf = function (v) { return v && typeof v === 'object' ? (v.id ? { id: v.id } : null) : (v === '' || v === undefined ? null : v); };
  /* change fields on one raw record already on screen: write, update the raw object, redraw, offer Undo. changes: {Field: [apiValue, localValue]} */
  function editRaw(entity, raw, changes, label, redraw) {
    var keys = Object.keys(changes), oldLocal = {}, oldApi = {}, api = {};
    if (keys.every(function (k) { return JSON.stringify(apiOf(raw[k])) === JSON.stringify(changes[k][0]) || (raw[k] == null && changes[k][0] == null); })) return Promise.resolve();
    keys.forEach(function (k) { oldLocal[k] = raw[k]; oldApi[k] = apiOf(raw[k]); api[k] = changes[k][0]; });
    return update(entity, raw.id, api).then(function () {
      keys.forEach(function (k) { raw[k] = changes[k][1]; }); lastSaved = Date.now(); redraw();
      toastUndo('Saved: ' + label, function () { update(entity, raw.id, oldApi).then(function () { keys.forEach(function (k) { raw[k] = oldLocal[k]; }); redraw(); toast('Undone'); }, function (e) { toast('Could not undo: ' + (e && e.message || e)); }); });
    }, function (e) { toast('Could not save: ' + (e && e.message || e)); redraw(); });
  }
  var toastEl, toastT;
  function toast(m) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ---------- rendering helpers ---------- */
  function pillHtml(v, tone) { var t = R.plain(v); return t == null || t === '' ? '' : '<span class="pill ' + (tone || R.tone(t)) + '">' + esc(t) + '</span>'; }
  /* list inline edit (v3, Oct 14): a column with ed: 'pick' | 'date' | 'text' renders a control in the cell when the table is drawn with an edit context {pl, admin, title(row)} */
  function edCell(c, row, ed) {
    var cur = R.plain(row[c.k]); cur = cur == null || cur === '-None-' ? '' : String(cur);
    var lock = c.admin && !ed.admin, name = esc(c.label + ' for ' + (ed.title ? ed.title(row) : 'this row'));
    var dis = lock ? ' disabled title="Only an administrator can change this"' : '';
    if (c.ed === 'pick') {
      var xs = (ed.pl[c.k] || c.opts || []).slice(); if (cur && xs.indexOf(cur) < 0) xs.unshift(cur);
      return '<select class="le" data-le="' + esc(c.k) + '" aria-label="' + name + '"' + dis + '><option value="">' + (cur ? 'Not set' : '–') + '</option>' + xs.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    }
    return '<input class="le" data-le="' + esc(c.k) + '" aria-label="' + name + '" type="' + (c.ed === 'date' ? 'date' : 'text') + '" value="' + esc(c.ed === 'date' ? cur.slice(0, 10) : cur) + '"' + dis + '>';
  }
  function cell(c, row, ed) {
    var v = row[c.k], cls = [];
    if (c.r) cls.push('r'); if (c.main) cls.push('main');
    if (ed && c.ed && (!c.edIf || c.edIf(row))) { cls.push('lec'); return '<td class="' + cls.join(' ') + '">' + edCell(c, row, ed) + '</td>'; }
    var inner = c.pill ? pillHtml(v) : esc(c.trunc ? R.trunc(R.fmt(v, c.t), c.trunc) : R.fmt(v, c.t));
    return '<td class="' + cls.join(' ') + '">' + inner + '</td>';
  }
  function tableHtml(cols, rows, clickable, ed) {
    var h = '<div class="tw"><table><thead><tr>' + cols.map(function (c) { return '<th scope="col"' + (c.r ? ' class="r"' : '') + '>' + esc(c.label) + (ed && c.ed ? ' <span class="edmark" aria-hidden="true" title="Editable here">✎</span>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r, i) { h += '<tr data-i="' + i + '"' + (clickable ? ' class="click" tabindex="0"' : '') + '>' + cols.map(function (c) { return cell(c, r, ed); }).join('') + '</tr>'; });
    return h + '</tbody></table></div>';
  }
  function skel() { return '<div class="skel" aria-busy="true" aria-label="Loading"><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span><span class="sk"></span></div>'; }

  /* L1 = module tabs (Processes: group tabs), L2 = sub-tabs inside a group. head() emits the whole bar; the switchHtml() call that follows it adds nothing. */
  var barDone = false;
  function modLabel(m) { return m.swLabel || m.title; }
  function groupKeys() { var seen = {}, out = []; SW.forEach(function (k) { var g = MODS[k].group; if (g && !seen[g]) { seen[g] = k; out.push(k); } }); return out; }
  function l1Html() {
    if (!SW) return '<div class="l1"></div>';
    var keys = GROUPED ? groupKeys() : SW;
    return '<nav class="l1 sw" role="tablist" aria-label="Module">' + keys.map(function (k) {
      var m = MODS[k], sel = GROUPED ? m.group === cfg.group : m === cfg;
      return '<button type="button" class="swb" role="tab" data-m="' + esc(k) + '"' + (GROUPED ? ' data-g="1"' : '') + ' aria-selected="' + sel + '">' + esc(GROUPED ? m.group : modLabel(m)) + '</button>'; }).join('') + '</nav>';
  }
  function l2Html() {
    if (!SW || !GROUPED || !cfg.group) return '';
    var ks = SW.filter(function (k) { return MODS[k].group === cfg.group; });
    if (ks.length < 2) return '';
    return '<div class="l2"><div class="seg sw2" role="tablist" aria-label="' + esc(cfg.group) + '">' + ks.map(function (k) {
      return '<button type="button" class="swb" role="tab" data-m="' + esc(k) + '" aria-selected="' + (MODS[k] === cfg) + '">' + esc(modLabel(MODS[k])) + '</button>'; }).join('') + '</div></div>';
  }
  /* v3 shell: the rail (records-shell.js) owns L1/L2 navigation; the page starts with a command bar
     (breadcrumb TAB > module, then the page's own buttons). l1Html/l2Html are kept for pages without a rail. */
  function hasRail() { return !!(window.RecShell && document.getElementById('rail')); }
  function topBar(buttons, title) {
    if (!hasRail()) return '<header class="top"><div class="brand"><i>JP</i> CRM</div>' + l1Html() + '<div class="topact">' + (buttons || '') + '</div></header>' + l2Html();
    return '<header class="jpk-cmd"><nav class="crumb" aria-label="Section"><span>' + esc(TAB) + '</span><span class="sep">›</span><b>' + esc(title || cfg.title) + '</b></nav><div class="tools">' + (buttons || '') + '</div></header>';
  }
  function head(kick, title, sub, pill, buttons) {
    barDone = true;
    var h = topBar(buttons, cfg.title);
    if (sub || pill || (title && title !== cfg.title)) h += '<div class="subline"><b>' + esc(title) + '</b>' + (pill || '') + (sub ? '<span class="mut">' + esc(sub) + '</span>' : '') + '</div>';
    else if (title) h += '<h1 class="sr">' + esc(title) + '</h1>';
    return h;
  }
  function switchHtml() { if (barDone) { barDone = false; return ''; } return topBar(''); }
  function switchTo(k) { if (!MODS[k] || MODS[k] === cfg) return; cfg = MODS[k]; st.filter = 'all'; st.search = ''; st.token++; showList(); }
  function bindSwitch() {
    if (window.RecShell) window.RecShell.setCurrent(cfg.key);
    var cur = root.querySelector('.l1 [aria-selected=true]'); if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    Array.prototype.forEach.call(root.querySelectorAll('.sw,.sw2'), function (b) {
      b.onclick = function (e) {
        var x = e.target.closest('[data-m]'); if (!x) return; var k = x.getAttribute('data-m');
        if (MODS[k] === cfg || (x.hasAttribute('data-g') && MODS[k].group === cfg.group)) return;
        switchTo(k);
      };
    });
  }

  /* ---------- brand scope (rail switcher) ---------- */
  var BRANDF = { accounts: 'Brand', contacts: 'Account_Name.Brand', deals: 'Account_Name.Brand', cases: 'Account_Name.Brand', onboarding: 'Account_Name.Brand', contracts: 'Account_Name.Brand' };
  var brandOff = {};   /* module key -> true once a scoped query failed (field not filterable); scope then shows a note instead */
  function brandField() { return cfg.brandField || BRANDF[cfg.key] || null; }
  function brandScope() { return window.RecShell && window.RecShell.brand ? window.RecShell.brand() : null; }
  function brandWhere() { var b = brandScope(), f = brandField(); return b && f && !brandOff[cfg.key] ? b.where(f) : ''; }
  function brandNote() {
    var b = brandScope(), el = document.getElementById('bhint'); if (!el) return;
    if (!b || b.get() === 'all') { el.hidden = true; return; }
    var f = brandField();
    el.hidden = false;
    el.textContent = !f ? 'Brand scope (' + b.label() + ') does not apply to ' + cfg.title.toLowerCase() + '; showing all.' :
      brandOff[cfg.key] ? cfg.title + ' cannot be filtered by brand yet (needs a Brand field on this module); showing all brands.' :
      'Scoped to ' + b.label() + '. Switch brand in the rail to change.';
  }
  function demoBrandOk(r) {
    var b = brandScope(); if (!b || b.get() === 'all' || !brandField()) return true;
    var v = R.plain(r.Brand) || (r.Account_Name && (r.Account_Name.Brand || r.Account_Name.brand)) || r._brand; if (!v) return true;
    return (b.brand().values || []).indexOf(String(v)) >= 0;
  }

  /* ---------- list view ---------- */
  function showList() {
    barDone = false;
    if (cfg.custom) { cfg.render(root, CTX); return; }
    var L = cfg.list;
    root.innerHTML = '<div class="wrap">' + head('JusticePoint CRM', cfg.title, '', '', cfg.create ? '<button class="btn pri" id="new" type="button">+ New</button>' : '') +
      switchHtml() + (live ? '' : '<div class="demo">Demo data · connect inside Zoho CRM to see live records.</div>') +
      '<div class="bar"><input class="search" id="q" type="search" placeholder="' + esc(L.searchHint || 'Search') + '" aria-label="Search" value="' + esc(st.search) + '">' +
      '<div id="pills" role="group" aria-label="Filter" style="display:flex;gap:8px;flex-wrap:wrap"></div></div>' +
      '<div class="scopehint" id="bhint" hidden></div>' +
      '<div class="count" id="count" aria-live="polite"></div><div id="list"></div></div>';
    bindSwitch(); brandNote();
    var nb = document.getElementById('new'); if (nb) nb.onclick = createCrm;
    var t; document.getElementById('q').oninput = function (e) { clearTimeout(t); var v = e.target.value; t = setTimeout(function () { st.search = v.trim(); reload(); }, 300); };
    drawPills(); reload();
    var eds = L.cols.filter(function (c) { return c.ed; }), mod = cfg;
    st.pl = {};
    eds.forEach(function (c) { if (c.ed === 'pick') picklist(mod.entity, c.k, c.opts || []).then(function (v) { if (mod !== cfg) return; st.pl[c.k] = v; if (st.rows.length) drawList(); }); });
    if (eds.some(function (c) { return c.admin; })) isAdmin().then(function (a) { if (mod !== cfg) return; st.admin = a; if (st.rows.length) drawList(); });
  }
  function drawPills() {
    var p = document.getElementById('pills');
    var fl = cfg.list.filters.filter(function (f) { return !(brandScope() && f.where && /^\s*Brand\s*=/.test(f.where)); });   /* brand filters are replaced by the rail switcher */
    if (!fl.some(function (f) { return f.key === st.filter; })) st.filter = 'all';
    p.innerHTML = fl.map(function (f) { return '<button type="button" class="pillbtn" data-f="' + esc(f.key) + '" aria-pressed="' + (f.key === st.filter) + '">' + esc(f.label) + '</button>'; }).join('');
    p.onclick = function (e) { var b = e.target.closest('[data-f]'); if (b) { st.filter = b.getAttribute('data-f'); drawPills(); reload(); } };
  }
  function reload() { st.rows = []; st.offset = 0; st.more = false; loadMore(true); }
  function loadMore(first) {
    var tok = ++st.token, box = document.getElementById('list'); if (!box) return;
    if (first) box.innerHTML = skel();
    fetchList().then(function (res) {
      if (tok !== st.token) return;
      st.rows = st.rows.concat(res.rows); st.more = live && res.rows.length >= PAGE; st.offset += res.rows.length;
      drawList();
    }, function (e) { if (tok === st.token) box.innerHTML = '<div class="err" role="alert">Could not load ' + esc(cfg.title) + ': ' + esc(e.message) + '</div>'; });
  }
  function drawList() {
    var box = document.getElementById('list'); if (!box) return;
    document.getElementById('count').textContent = st.rows.length + (st.more ? '+' : '') + ' ' + cfg.title.toLowerCase();
    if (!st.rows.length) { box.innerHTML = '<div class="empty"><b>Nothing here</b><br>No ' + esc(cfg.title.toLowerCase()) + ' match this search or filter.</div>'; return; }
    var main = cfg.list.cols.filter(function (c) { return c.main; })[0] || cfg.list.cols[0];
    var ed = cfg.list.cols.some(function (c) { return c.ed; }) ? { pl: st.pl, admin: st.admin, title: function (r) { return R.plain(r[main.k]) || 'this row'; } } : null;
    box.innerHTML = tableHtml(cfg.list.cols, st.rows, true, ed) + (st.more ? '<button type="button" class="btn more" id="more">Load more</button>' : '') +
      (ed ? '<p class="mut edhint">Columns marked ✎ save to Zoho as you change them, with Undo. Click anywhere else on a row to open it.</p>' : '');
    var tb = box.querySelector('tbody');
    tb.onclick = function (e) { if (e.target.closest('.lec')) return; var tr = e.target.closest('tr[data-i]'); if (tr) showRecord(st.rows[+tr.getAttribute('data-i')].id); };
    tb.onchange = function (e) {
      var k = e.target.getAttribute('data-le'), tr = e.target.closest('tr[data-i]'); if (!k || !tr) return;
      var row = st.rows[+tr.getAttribute('data-i')], c = cfg.list.cols.filter(function (x) { return x.k === k; })[0], v = e.target.value.trim(), ch = {};
      if (!row || !c) return;
      if (c.admin && !st.admin) { toast('Only an administrator can change ' + c.label.toLowerCase()); drawList(); return; }
      ch[k] = [v || null, v || null];
      editRaw(cfg.entity, row, ch, c.label.toLowerCase() + (v ? ' set to ' + v : ' cleared') + ' on ' + (R.plain(row[main.k]) || 'record'), drawList);
    };
    tb.onkeydown = function (e) { if (e.key === 'Enter' && e.target.matches('tr[data-i]')) showRecord(st.rows[+e.target.getAttribute('data-i')].id); };
    var m = document.getElementById('more'); if (m) m.onclick = function () { m.disabled = true; loadMore(false); };
  }

  /* ---------- record view ---------- */
  function backBtn(msg) { return msg + ' <button class="btn" id="back" type="button">Back</button>'; }
  function showRecord(id) {
    var scroll = window.scrollY;
    root.innerHTML = '<div class="wrap"><div class="stripe"></div>' + skel() + '</div>';
    fetchRecord(id).then(function (r) {
      if (!r) { root.innerHTML = '<div class="wrap"><div class="err" role="alert">' + backBtn('That record could not be found.') + '</div></div>'; document.getElementById('back').onclick = backToList; return; }
      drawRecord(r, id, scroll);
    }, function (e) { root.innerHTML = '<div class="wrap"><div class="err" role="alert">' + backBtn('Could not load record: ' + esc(e.message)) + '</div></div>'; document.getElementById('back').onclick = backToList; });
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
    var C = cfg.rec, pill = C.pill(r), attn = C.attn && C.attn(r), showEmpty = false, ttl = C.title(r) || '(no name)';
    var subTxt = [C.kicker(r), C.sub(r)].filter(function (x) { return x; }).join(' · ');
    var h = '<div class="wrap">' + head('', '', '', '', '') + switchHtml() +
      '<nav class="crumb" aria-label="Breadcrumb"><span>' + esc(TAB) + '</span><span class="sep">›</span><button type="button" id="crumbm">' + esc(cfg.title) + '</button><span class="sep">›</span><b aria-current="page">' + esc(ttl) + '</b></nav>' +
      '<div class="rhead"><div class="grow"><h1>' + esc(ttl) + '</h1><div class="sub">' + esc(subTxt) + '</div></div>' + (pill ? '<span class="pill ' + pill[1] + '">' + esc(pill[0]) + '</span>' : '') +
      '<div class="grp"><button class="btn sm" id="back" type="button" aria-label="Back to ' + esc(cfg.title) + '">‹ Back</button><button class="btn sm" id="open" type="button">Open in CRM ↗</button></div></div>';
    if (!live) h += '<div class="demo">Demo data · connect inside Zoho CRM to see live records.</div>';
    if (attn) h += '<div class="attn" role="alert">' + esc(attn) + '</div>';
    h += '<div class="kpis">' + C.kpis.map(function (k) { var v = R.fmt(k.v(r), k.t), t = k.tone ? k.tone(r) : ''; return '<div class="kpi ' + (t === 'grey' ? '' : t) + '"><div class="l">' + esc(k.label) + '</div><div class="v">' + (v === '' ? '–' : esc(v)) + '</div></div>'; }).join('') + '</div>';
    if (C.quick) h += '<div class="cards"><section class="card qcard" id="quick"></section></div>';
    if (cfg.entity === 'Accounts' && window.JPBillingLines) h += '<div class="cards"><section class="card" id="vdev" aria-label="Vendor devices billed"></section></div>';
    h += '<div class="fbar"><button type="button" class="pillbtn" id="emp" aria-pressed="false"></button></div><div class="cards" id="secs"></div>';
    var items = REL.forModule(cfg.entity, GEN), VIS = window.innerWidth <= 640 ? 3 : 7;
    if (items.length) h += '<div class="tabs" role="tablist" id="tabs">' + items.map(function (t, i) { return '<button type="button" class="tab' + (i >= VIS ? ' x' : '') + '" role="tab" data-t="' + esc(t.id) + '" aria-selected="' + (i === 0) + '">' + esc(t.label) + '<span class="cnt" id="cnt-' + esc(t.id) + '"></span></button>'; }).join('') +
      (items.length > VIS ? '<button type="button" class="tabmore" id="tmore" aria-expanded="false">More ▾ <span class="cnt" id="tmcnt">' + (items.length - VIS) + '</span></button>' : '') + '</div><div class="pane" id="pane"></div>';
    root.innerHTML = h + '</div>';
    bindSwitch();
    document.getElementById('back').onclick = backToList;
    document.getElementById('crumbm').onclick = backToList;
    document.getElementById('open').onclick = function () { openCrm(cfg.entity, id); };
    function paintSecs() {
      var s = sectionsHtml(r, showEmpty), b = document.getElementById('emp');
      document.getElementById('secs').innerHTML = s.html || '<div class="empty">No fields to show.</div>';
      b.hidden = !s.any || (!s.hidden && !showEmpty); b.setAttribute('aria-pressed', showEmpty); b.textContent = showEmpty ? 'Hide empty fields' : 'Show ' + s.hidden + ' empty fields';
    }
    document.getElementById('emp').onclick = function () { showEmpty = !showEmpty; paintSecs(); };
    if (C.quick) {
      var qel = document.getElementById('quick'), qopts = { __admin: false }, again = function () { var y = window.scrollY; drawRecord(r, id, scroll); window.scrollTo(0, y); };
      /* Cases are on a blueprint: status moves by named step (Acknowledge, Start Working, Resolve, Close, Reopen) through the same
         Deluge function as the list-view buttons. It queues the step; a workflow runs it within seconds; we poll the case until it lands. */
      var bp = { names: null, busy: '', msg: '', note: '', form: false, cats: null, cat: '', sol: '' };
      var BPSTEPS = ['Acknowledge', 'Start Working', 'Resolve', 'Close', 'Reopen'], BPSTATUS = { 'Acknowledge': 'Acknowledged', 'Start Working': 'In Progress', 'Resolve': 'Resolved', 'Close': 'Closed', 'Reopen': 'In Progress' };
      /* Resolve needs a resolution category and a solution (mandatory on the blueprint step): ask for them first */
      var formHtml = function () {
        var cats = bp.cats || [];
        return '<div class="bpform" style="margin-top:10px;display:grid;gap:8px"><label class="mut" style="font-size:12px">Resolution category<select data-bpcat style="width:100%"><option value="">Choose...</option>' + cats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === bp.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
          '<label class="mut" style="font-size:12px">Solution<textarea data-bpsol rows="3" maxlength="2000" style="width:100%" placeholder="What fixed it, or why the case is resolved">' + esc(bp.sol || '') + '</textarea></label>' +
          '<div style="display:flex;gap:6px"><button type="button" class="btn pri" data-act="bp-go"' + (bp.busy ? ' disabled' : '') + '>Resolve case</button><button type="button" class="btn" data-act="bp-cancel"' + (bp.busy ? ' disabled' : '') + '>Cancel</button></div></div>';
      };
      var bpHtml = function () {
        var names = (bp.names || BPSTEPS).filter(function (n) { return BPSTEPS.indexOf(n) >= 0; });
        return '<div class="bp" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)"><div class="mut" style="font-size:12px;margin-bottom:6px">Status: <b style="color:var(--ink)">' + esc(R.plain(r.Status) || 'Not set') + '</b>. Move this case:</div><div style="display:flex;gap:6px;flex-wrap:wrap">' +
          (names.length ? names.map(function (n) { return '<button type="button" class="btn' + (n === 'Resolve' ? ' pri' : '') + '" data-tr="' + esc(n) + '"' + (bp.busy ? ' disabled' : '') + '>' + esc(n) + '</button>'; }).join('') : '<span class="mut" style="font-size:12px">No status steps are available from here.</span>') +
          '<button type="button" class="btn" data-act="crm-status"' + (bp.busy ? ' disabled' : '') + '>Open in Zoho</button></div>' + (bp.form ? formHtml() : '') + '<input type="text" data-bpnote placeholder="Note for the step (optional)" maxlength="250" value="' + esc(bp.note) + '" style="margin-top:8px;width:100%">' + (bp.msg ? '<div role="status" class="mut" style="font-size:12px;margin-top:6px">' + esc(bp.msg) + '</div>' : '') + '</div>';
      };
      var runStep = function (name, extra) {
        bp.busy = name; bp.msg = name + ': sending to Zoho...'; paintQ();
        if (!live) { r.Status = BPSTATUS[name]; bp.busy = ''; lastSaved = Date.now(); toast('Demo: status set to ' + r.Status); again(); return; }
        var fail = function (e) { bp.busy = ''; bp.msg = 'Not done: ' + errMsg(e); paintQ(); };
        var timeout = function (ms, what) { return new Promise(function (_, rej) { setTimeout(function () { rej(new Error(what + ' did not answer in ' + Math.round(ms / 1000) + 's')); }, ms); }); };
        Promise.race([window.ZOHO.CRM.FUNCTIONS.execute(CASE_STEP_FN, { arguments: JSON.stringify({ caseId: String(id), transitionName: name, noteText: extra ? JSON.stringify(extra) : (bp.note || '') }) }), timeout(60000, 'The function ' + CASE_STEP_FN)]).then(function (res) {
          if (res && res.code && String(res.code).toLowerCase() !== 'success') throw new Error((res.message || res.code) + '');
          var out = String((res && res.details && res.details.output) || '');
          if (!/^Done/.test(out)) { bp.busy = ''; bp.msg = out || 'No answer from the function.'; paintQ(); return; }
          return window.ZOHO.CRM.API.getRecord({ Entity: 'Cases', RecordID: id }).then(function (g) {
            var d = g && g.data && g.data[0] || {}; r.Status = d.Status || BPSTATUS[name]; bp.note = ''; lastSaved = Date.now();
            toast('Saved: ' + name + ' (' + R.plain(r.Status) + ')'); again();
          });
        }).catch(fail);
      };
      if (cfg.key === 'cases' && live) window.ZOHO.CRM.FUNCTIONS.execute(CASE_STEP_FN, { arguments: JSON.stringify({ caseId: String(id), transitionName: '?', noteText: '' }) }).then(function (res) {
        var out = String((res && res.details && res.details.output) || ''), m = /^Steps:\s*(.*)$/.exec(out);
        if (m) { bp.names = m[1] ? m[1].split('|') : []; paintQ(); }   /* older case_step without "?" leaves all five buttons */
      }, function () {});
      var paintQ = function () {
        qel.innerHTML = '<h3>Quick edit' + (Date.now() - lastSaved < 60000 ? '<span class="saved">✓ Saved</span>' : '') + '</h3><div class="edit">' + C.quick.map(function (f) {
          var cur = R.plain(r[f.t === 'user' ? 'Owner.first_name' : f.k]); cur = cur == null || cur === '-None-' ? '' : String(cur);
          if (f.t === 'user') { var us = (qopts.__users || []).slice(); if (cur && !us.some(function (u) { return u.name === cur; })) us.unshift({ id: '', name: cur }); return '<label>' + esc(f.label) + '<select data-q="' + f.k + '">' + us.map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.name === cur ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></label>'; }
          var lock = f.admin && !qopts.__admin, lab = esc(f.label) + (f.admin ? ' <span class="mut">(admin only)</span>' : '');
          if (f.t === 'pick') { var xs = (qopts[f.k] || []).slice(); if (cur && xs.indexOf(cur) < 0) xs.unshift(cur); return '<label>' + lab + '<select data-q="' + f.k + '"' + (lock ? ' disabled title="Only an administrator can change this"' : '') + '><option value="">Not set</option>' + xs.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>'; }
          return '<label>' + esc(f.label) + '<input data-q="' + f.k + '" type="' + (f.t === 'date' ? 'date' : f.t === 'num' ? 'number' : 'text') + '" value="' + esc(cur) + '"></label>'; }).join('') + '</div><p class="mut" style="margin:10px 0 0;font-size:12px">Changes save to Zoho as you make them. Undo appears after each save.</p>' + (cfg.key === 'cases' ? bpHtml() : '');
      };
      paintQ();
      if (C.quick.some(function (f) { return f.admin; })) isAdmin().then(function (a) { qopts.__admin = a; paintQ(); });
      qel.oninput = function (e) { var a = e.target.hasAttribute ? e.target : null; if (!a) return; if (a.hasAttribute('data-bpnote')) bp.note = a.value; if (a.hasAttribute('data-bpsol')) bp.sol = a.value; };
      qel.onclick = function (e) {
        var go = e.target.closest && e.target.closest('[data-act]'), act = go && go.getAttribute('data-act');
        if (act === 'bp-cancel') { bp.form = false; bp.msg = ''; paintQ(); return; }
        if (act === 'bp-go') {
          var cs = qel.querySelector('[data-bpcat]'), so = qel.querySelector('[data-bpsol]'); bp.cat = cs ? cs.value : ''; bp.sol = so ? so.value.trim() : '';
          if (!bp.cat || !bp.sol) { bp.msg = 'Choose a resolution category and write a solution first.'; paintQ(); return; }
          bp.form = false; runStep('Resolve', { Resolution_Category: bp.cat, Solution: bp.sol }); return;
        }
        var t = e.target.closest && e.target.closest('[data-tr]');
        if (t && !bp.busy && t.getAttribute('data-tr') === 'Resolve') { bp.form = true; bp.msg = ''; paintQ(); picklist('Cases', 'Resolution_Category', ['Resolved', 'Duplicate', 'No action needed', 'Other']).then(function (v) { bp.cats = v; paintQ(); }); return; }
        if (t && !bp.busy) { runStep(t.getAttribute('data-tr')); return; } var b = e.target.closest && e.target.closest('[data-act=crm-status]'); if (b) openCrm(cfg.entity, id); };
      qel.onchange = function (e) {
        var k = e.target.getAttribute('data-q'); if (!k) return; var f = C.quick.filter(function (x) { return x.k === k; })[0], v = e.target.value.trim(), c = {};
        if (f.admin && !qopts.__admin) { toast('Only an administrator can change ' + f.label.toLowerCase()); paintQ(); return; }
        if (f.t === 'user') {
          var u = (qopts.__users || []).filter(function (x) { return x.id === v; })[0]; if (!u || !v) return; var oldName = r['Owner.first_name'], oldId = (qopts.__users.filter(function (x) { return x.name === oldName; })[0] || {}).id;
          update(cfg.entity, id, { Owner: { id: v } }).then(function () { r['Owner.first_name'] = u.name; toastUndo('Saved: owner set to ' + u.name, oldId ? function () { update(cfg.entity, id, { Owner: { id: oldId } }).then(function () { r['Owner.first_name'] = oldName; again(); toast('Undone'); }, function (er) { toast('Could not undo: ' + (er && er.message || er)); }); } : null); again(); }, function (er) { toast('Could not save: ' + (er && er.message || er)); again(); });
          return;
        }
        c[k] = [v || null, v || null]; editRaw(cfg.entity, r, c, f.label + (v ? ' set to ' + v : ' cleared'), again);
      };
      if (C.quick.some(function (f) { return f.t === 'user'; })) userList().then(function (us) { qopts.__users = us; paintQ(); });
      C.quick.forEach(function (f) { if (f.t === 'pick') picklist(cfg.entity, f.k, f.opts || []).then(function (v) { qopts[f.k] = v; paintQ(); }); });
    }
    var vdev = document.getElementById('vdev');
    if (vdev) window.JPBillingLines.mount(vdev, blIo(function (f, v) { r[f] = v; paintSecs(); }), { id: String(id), name: C.title(r), type: R.plain(r.Account_Type) || '', raw: r });
    paintSecs(); window.scrollTo(0, 0);
    if (!items.length) return;
    var data = {}, pend = {}, cur = items[0].id, tabOK = false, tabPl = {};
    hasRole(TAB_ROLES).then(function (ok) { tabOK = ok; if (ok) paint(); });
    function setCnt(t, txt) { var c = document.getElementById('cnt-' + t.id); if (c) c.textContent = txt; }
    function markX() {   /* show the first VIS tabs (3 on phones, 7 otherwise) and the selected one; More reveals the rest */
      var bs = document.querySelectorAll('#tabs .tab'), n = 0;
      Array.prototype.forEach.call(bs, function (b, i) { var x = i >= VIS && b.getAttribute('aria-selected') !== 'true'; b.classList.toggle('x', x); if (x) n++; });
      var c = document.getElementById('tmcnt'); if (c) c.textContent = n;
    }
    function paint() {
      var t = items.filter(function (x) { return x.id === cur; })[0], d = data[cur], pane = document.getElementById('pane');
      if (!pane) return;
      if (d === undefined) { pane.innerHTML = skel(); return; }
      if (d.err) { pane.innerHTML = '<div class="err" role="alert">Could not load ' + esc(t.label) + ': ' + esc(d.err) + '. Use Open in CRM to see this list there.</div>'; return; }
      if (d.note) { pane.innerHTML = '<div class="empty"><b>' + esc(t.label) + '</b><br>' + esc(d.note) + '<br><br><button class="btn" type="button" id="wopen">Open in CRM</button></div>'; document.getElementById('wopen').onclick = function () { openCrm(cfg.entity, id); }; return; }
      if (!d.rows.length) { pane.innerHTML = '<div class="empty">No ' + esc(t.label.toLowerCase()) + ' yet.</div>'; return; }
      var ecols = tabOK ? tabCols(t, d.cols) : null, ent = ecols && ecols.filter(function (c) { return c.ed; })[0].edEntity;
      if (ecols) ecols.forEach(function (c) { if (c.ed === 'pick' && !tabPl[ent + '.' + c.k]) { tabPl[ent + '.' + c.k] = c.opts; picklist(ent, c.k, c.opts).then(function (v) { if (v && v.length) { tabPl[ent + '.' + c.k] = v; if (cur === t.id) paint(); } }); } });
      var edc = ecols ? { pl: (function () { var o = {}; ecols.forEach(function (c) { if (c.ed) o[c.k] = tabPl[ent + '.' + c.k]; }); return o; })(), admin: true, title: function (r) { var m = (ecols.filter(function (c) { return c.main; })[0] || ecols[0]); return R.plain(r[m.k]) || 'this row'; } } : null;
      pane.innerHTML = tableHtml(ecols || d.cols, d.rows, !!d.open, edc) + (edc ? '<p class="mut edhint">Columns marked ✎ save to Zoho as you change them, with Undo.</p>' : '');
      var tb = pane.querySelector('tbody');
      if (edc) tb.onchange = function (e) {
        var k = e.target.getAttribute('data-le'), tr = e.target.closest('tr[data-i]'); if (!k || !tr) return;
        var rw = d.rows[+tr.getAttribute('data-i')], en = rw && tabEntity(t, rw), c = ecols.filter(function (x) { return x.k === k; })[0], v = e.target.value.trim(), ch = {};
        if (!rw || !rw.id || !en || !c) { toast('This row cannot be edited here'); paint(); return; }
        ch[k] = [v || null, v || null];
        editRaw(en, rw, ch, c.label.toLowerCase() + (v ? ' set to ' + v : ' cleared') + ' on ' + edc.title(rw), paint);
      };
      if (!d.open) return;
      var go = function (tr) { if (!tr) return; var rw = d.rows[+tr.getAttribute('data-i')], o = d.open(rw); if (o && o[1]) openCrm(o[0], o[1]); };
      tb.onclick = function (e) { if (e.target.closest('.lec')) return; go(e.target.closest('tr[data-i]')); };
      tb.onkeydown = function (e) { if (e.key === 'Enter' && !e.target.closest('.lec')) go(e.target.closest('tr[data-i]')); };
    }
    function load(t) {
      if (t.id in data || pend[t.id]) return pend[t.id] || Promise.resolve();
      return pend[t.id] = fetchRelated(t, id).then(function (d) {
        data[t.id] = d; if (!d.note) setCnt(t, d.rows.length >= 200 ? '200+' : d.rows.length);
      }, function (e) { data[t.id] = { err: e.message || 'failed' }; setCnt(t, '!'); }).then(function () { if (cur === t.id) paint(); });
    }
    document.getElementById('tabs').onclick = function (e) {
      var mb = e.target.closest('#tmore');
      if (mb) { var tabsEl = document.getElementById('tabs'), open = !tabsEl.classList.contains('open'); tabsEl.classList.toggle('open', open); mb.setAttribute('aria-expanded', open); return; }
      var b = e.target.closest('[data-t]'); if (!b) return; cur = b.getAttribute('data-t');
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (x) { x.setAttribute('aria-selected', x === b); });
      markX(); paint(); load(items.filter(function (x) { return x.id === cur; })[0]);
    };
    items.slice(0, 6).forEach(load); paint();
  }

  /* host functions for billing-lines.js (also used by the Vendors view so rate lines are written through the contract subform) */
  function blIo(onAccount) {
    return { live: live, coql: function (q) { return coql(q).then(function (x) { return x.rows; }); },
      getRecord: function (e, rid) { return window.ZOHO.CRM.API.getRecord({ Entity: e, RecordID: rid }).then(function (res) { return (res && res.data && res.data[0]) || null; }); },
      update: function (e, d) { var x = {}; Object.keys(d).forEach(function (k) { if (k !== 'id') x[k] = d[k]; }); return update(e, d.id, x); },
      picklist: picklist, open: openCrm, onAccount: onAccount || null,
      toast: function (m, undo) { if (undo) toastUndo(m, undo); else { toast(m); if (/^Saved/.test(m)) lastSaved = Date.now(); } } };
  }
  var CTX = { R: R, blIo: blIo, hasRole: hasRole, esc: esc, head: head, tableHtml: tableHtml, pillHtml: pillHtml, openCrm: openCrm, toast: toast, coql: coql, update: update, editRaw: editRaw, userList: userList, picklist: picklist, toastUndo: toastUndo, isLive: function () { return live; }, switchHtml: switchHtml, bindSwitch: bindSwitch, skel: skel, demoNote: function () { return live ? '' : '<div class="demo">Demo data · connect inside Zoho CRM to see live records.</div>'; } };

  /* compatibility shim for views built on the v3.1 engine (hasRole): only used when this engine lacks it */
  if (!CTX.hasRole) CTX.hasRole = function (roles) { roles = roles || []; if (!live) return Promise.resolve(true); return roles.indexOf('admin') >= 0 && roles.length === 1 ? isAdmin() : isAdmin().then(function (a) { return a || roles.length > 1; }); };

  /* ---------- start ---------- */
  function start(init) {
    live = !!(init && !init.demo);
    if (window.RecShell && document.getElementById('rail')) {
      window.RecShell.init({ mods: MODS, sw: SW || [cfg.key], grouped: GROUPED, tab: TAB, current: cfg.key, onSwitch: switchTo,
        onBrand: function () { brandNote(); if (document.getElementById('list')) { st.token++; reload(); } } });
      if (live && window.ZOHO.CRM.CONFIG && window.ZOHO.CRM.CONFIG.getCurrentUser) window.ZOHO.CRM.CONFIG.getCurrentUser().then(function (r) { var u = r && r.users && r.users[0]; window.RecShell.setUser(u && (u.full_name || u.name)); }, function () {}); else window.RecShell.setUser(live ? '' : 'Demo user');
    }
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

/* ===== jpk display preferences v1 (2026-10): theme, brightness, contrast. Self-contained; appended to jpk.js / records.js. ===== */
;(function(){
  if(typeof document==='undefined'||window.__jpkDisplay)return; window.__jpkDisplay=1;
  var KEY='jpk.display.v1', D={theme:'auto',bright:100,contrast:'standard'}, S={theme:D.theme,bright:D.bright,contrast:D.contrast};
  try{var raw=localStorage.getItem(KEY); if(raw){var o=JSON.parse(raw); if(['auto','light','dark'].indexOf(o.theme)>-1)S.theme=o.theme; if(o.bright>=80&&o.bright<=120)S.bright=+o.bright; if(o.contrast==='high')S.contrast='high';}}catch(e){}
  function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
  var root=document.documentElement;
  function apply(){
    if(S.theme==='auto')root.removeAttribute('data-theme');else root.setAttribute('data-theme',S.theme);
    if(S.contrast==='high')root.setAttribute('data-contrast','high');else root.removeAttribute('data-contrast');
    root.style.filter=S.bright===100?'':'brightness('+(S.bright/100)+')';
  }
  apply();
  var css=document.createElement('style');
  css.textContent=
  ':root[data-contrast="high"]{--ink:#000;--muted:#2F4446;--line:#5E7577;--teal:#07575A;--teal-soft:#C9E6E6;--on-teal:#fff;--good:#0F5E38;--warn:#6A4204;--warn-ink:#6A4204;--bad:#962019;--info:#183F78}'+
  '@media (prefers-color-scheme:dark){:root[data-contrast="high"]:not([data-theme="light"]){--ink:#fff;--muted:#C9D8D9;--line:#7C979A;--teal:#6FD0D4;--teal-soft:#1D4A4D;--on-teal:#04191A;--good:#7FD8A3;--warn:#F2C36B;--warn-ink:#F2C36B;--bad:#FFA19A;--info:#A9C9F5}}'+
  ':root[data-theme="dark"][data-contrast="high"]{--ink:#fff;--muted:#C9D8D9;--line:#7C979A;--teal:#6FD0D4;--teal-soft:#1D4A4D;--on-teal:#04191A;--good:#7FD8A3;--warn:#F2C36B;--warn-ink:#F2C36B;--bad:#FFA19A;--info:#A9C9F5}'+
  ':root[data-contrast="high"] td,:root[data-contrast="high"] th,:root[data-contrast="high"] .card,:root[data-contrast="high"] .btn{border-color:var(--line)}'+
  '#jpkd{position:fixed;right:12px;bottom:12px;z-index:70;font:13px/1.4 var(--font,system-ui,sans-serif);color:var(--ink)}'+
  '#jpkd>button{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--surface,#fff);color:var(--ink,#000);box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:17px;line-height:1;padding:0;cursor:pointer}'+
  '#jpkd>button:hover,#jpkd>button[aria-expanded=true]{border-color:var(--teal)}'+
  '#jpkd .pn{position:absolute;right:0;bottom:44px;width:248px;max-width:calc(100vw - 24px);background:var(--surface,#fff);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:12px 14px}'+
  '#jpkd .pn[hidden]{display:none}#jpkd h4{margin:0 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}'+
  '#jpkd .g{margin-bottom:12px}#jpkd .g:last-child{margin-bottom:0}'+
  '#jpkd .sg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}'+
  '#jpkd .sg button{flex:1;background:transparent;border:0;border-right:1px solid var(--line);padding:6px 4px;font:inherit;font-weight:600;color:var(--muted);cursor:pointer}'+
  '#jpkd .sg button:last-child{border-right:0}#jpkd .sg button[aria-pressed=true]{background:var(--teal-soft);color:var(--teal)}'+
  '#jpkd input[type=range]{width:100%;accent-color:var(--teal)}#jpkd .rv{display:flex;justify-content:space-between;color:var(--muted);font-size:12px}'+
  '#jpkd .rs{background:none;border:0;color:var(--teal);font:inherit;font-weight:600;text-decoration:underline;padding:0;cursor:pointer}'+
  '@media print{#jpkd{display:none}}';
  document.head.appendChild(css);
  function el(t,p,h){var e=document.createElement(t);for(var k in p)e.setAttribute(k,p[k]);if(h!=null)e.innerHTML=h;return e}
  function build(){
    if(document.getElementById('jpkd'))return;
    var w=el('div',{id:'jpkd'}), b=el('button',{type:'button','aria-label':'Display settings','aria-expanded':'false','aria-controls':'jpkd-pn',title:'Display settings'},'◐');
    var p=el('div',{id:'jpkd-pn',class:'pn',role:'group','aria-label':'Display settings',hidden:''});
    p.innerHTML='<div class="g"><h4>Theme</h4><div class="sg" data-k="theme"><button type="button" data-v="auto">Auto</button><button type="button" data-v="light">Light</button><button type="button" data-v="dark">Dark</button></div></div>'+
      '<div class="g"><h4>Contrast</h4><div class="sg" data-k="contrast"><button type="button" data-v="standard">Standard</button><button type="button" data-v="high">High</button></div></div>'+
      '<div class="g"><h4>Brightness</h4><input type="range" min="80" max="120" step="5" aria-label="Brightness"><div class="rv"><span id="jpkd-bv"></span><button type="button" class="rs">Reset all</button></div></div>';
    w.appendChild(p);w.appendChild(b);document.body.appendChild(w);
    var rng=p.querySelector('input');
    function sync(){
      [].forEach.call(p.querySelectorAll('.sg'),function(g){var k=g.getAttribute('data-k');[].forEach.call(g.children,function(x){x.setAttribute('aria-pressed',String(x.getAttribute('data-v')===S[k]))})});
      rng.value=S.bright;p.querySelector('#jpkd-bv').textContent=S.bright+'%';
    }
    function set(){apply();save();sync()}
    p.addEventListener('click',function(e){var x=e.target.closest('.sg button');if(x){S[x.parentNode.getAttribute('data-k')]=x.getAttribute('data-v');set()}if(e.target.className==='rs'){S.theme=D.theme;S.bright=D.bright;S.contrast=D.contrast;set()}});
    rng.addEventListener('input',function(){S.bright=+rng.value;set()});
    function tog(o){p.hidden=!o;b.setAttribute('aria-expanded',String(o))}
    b.addEventListener('click',function(){tog(p.hidden)});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!p.hidden){tog(false);b.focus()}});
    document.addEventListener('click',function(e){if(!p.hidden&&!w.contains(e.target))tog(false)});
    sync();
  }
  if(document.body)build();else document.addEventListener('DOMContentLoaded',build);
})();
