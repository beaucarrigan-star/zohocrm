/* knowledge.js v1.0 (S43, 28 Oct 2026): the Knowledge web tab. Read only.
   Data: COQL on Knowledge_Articles (Status = Published). Outside Zoho it shows the demo records.
   Test hooks: #rail [data-mode], #f-vendor #f-device #f-type #f-topic #f-audience #f-q, .card[data-id], #copy-reply. */
(function (root) {
  'use strict';
  var D = root.KN_DATA, DEVICES = D.DEVICES, L = D.LISTS;
  var live = false, ALL = [], loadErr = '';
  var S = { mode: 'browse', q: '', type: '', vendor: '', device: '', topic: '', audience: '', open: null, from: null };
  var MODES = [
    { k: 'browse', t: 'Browse', hint: 'Everything published' },
    { k: 'fix', t: 'Fix a problem', hint: 'Troubleshooting articles' },
    { k: 'learn', t: 'Learn a device', hint: 'Training, in order' },
    { k: 'safe', t: 'Customer-safe replies', hint: 'Words you can send' }
  ];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- data ---------- */
  function norm(r) {
    var a = r.Audience; if (typeof a === 'string') a = a ? a.split(';') : []; if (!Array.isArray(a)) a = [];
    return {
      id: String(r.id), no: r.Article_No || '', title: r.Name || '(untitled)', type: r.Article_Type || '', vendor: r.Vendor || '', device: r.Device || '',
      topic: r.Topic || '', audience: a, symptom: r.Symptom_Trigger || '', steps: r.Steps || '', reply: r.Customer_safe_reply || '',
      safe: r.Customer_safe === true || r.Customer_safe === 'true', path: r.Training_Path || '', step: parseFloat(r.Path_Step) || 0,
      source: r.Source_document || '', version: r.Version || '', reviewed: r.Last_Reviewed || '', due: r.Review_Due || '', used: r.Used_on_cases_30d || ''
    };
  }
  function load() {
    if (!live) { ALL = D.DEMO.map(norm); return Promise.resolve(); }
    var fields = 'id,Name,Article_No,Article_Type,Vendor,Device,Topic,Audience,Symptom_Trigger,Steps,Customer_safe_reply,Customer_safe,Training_Path,Path_Step,Source_document,Version,Last_Reviewed,Review_Due,Used_on_cases_30d';
    var out = [];
    function page(off) {
      var q = 'select ' + fields + " from Knowledge_Articles where Status = 'Published' limit " + off + ', 200';
      return root.ZOHO.CRM.API.coql({ select_query: q }).then(function (res) {
        var rows = (res && res.data) || []; out = out.concat(rows);
        if (res && res.info && res.info.more_records && out.length < 2000) return page(off + 200);
      });
    }
    return page(0).then(function () { ALL = out.map(norm); });
  }

  /* ---------- filtering ---------- */
  function visible() {
    var q = S.q.trim().toLowerCase();
    return ALL.filter(function (a) {
      if (S.mode === 'fix' && a.type !== 'Troubleshooting') return false;
      if (S.mode === 'learn' && a.type !== 'Training') return false;
      if (S.mode === 'safe' && !(a.safe && a.reply)) return false;
      if (S.type && a.type !== S.type) return false;
      if (S.vendor && a.vendor !== S.vendor) return false;
      if (S.device && a.device !== S.device) return false;
      if (S.topic && a.topic !== S.topic) return false;
      if (S.audience && a.audience.indexOf(S.audience) < 0) return false;
      if (q) { var hay = (a.no + ' ' + a.title + ' ' + a.symptom + ' ' + a.vendor + ' ' + a.device + ' ' + a.topic + ' ' + a.path + ' ' + strip(a.steps)).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
  }
  function strip(h) { return String(h || '').replace(/<[^>]*>/g, ' '); }
  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      if (S.mode === 'learn') { return (a.path || '~').localeCompare(b.path || '~') || a.step - b.step || a.title.localeCompare(b.title); }
      return a.vendor.localeCompare(b.vendor) || a.device.localeCompare(b.device) || a.title.localeCompare(b.title);
    });
  }

  /* ---------- safe rich text (Steps is rich text from Zoho) ---------- */
  var OK = { P: 1, BR: 1, OL: 1, UL: 1, LI: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1, SPAN: 1, DIV: 1, H3: 1, H4: 1, CODE: 1 };
  function clean(html) {
    var doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    (function walk(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { n.removeChild(c); return; }
        if (!OK[c.tagName]) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(c.tagName)) { n.removeChild(c); return; } walk(c); while (c.firstChild) n.insertBefore(c.firstChild, c); n.removeChild(c); return; }
        Array.prototype.slice.call(c.attributes).forEach(function (at) {
          if (c.tagName === 'A' && at.name === 'href' && /^https?:\/\//i.test(at.value)) return;
          c.removeAttribute(at.name);
        });
        if (c.tagName === 'A') { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
        walk(c);
      });
    })(doc.body);
    return doc.body.innerHTML;
  }

  /* ---------- rail ---------- */
  function paintRail() {
    var counts = { browse: ALL.length, fix: 0, learn: 0, safe: 0 };
    ALL.forEach(function (a) { if (a.type === 'Troubleshooting') counts.fix++; if (a.type === 'Training') counts.learn++; if (a.safe && a.reply) counts.safe++; });
    $('#rail').innerHTML = '<div class="kn-brand">Knowledge</div><div class="grp">Ways in</div>' + MODES.map(function (m) {
      return '<button type="button" class="nav" data-mode="' + m.k + '" aria-current="' + (S.mode === m.k && !S.open ? 'page' : 'false') + '"><span class="nl">' + esc(m.t) + '</span><span class="cnt">' + counts[m.k] + '</span></button>';
    }).join('');
  }

  /* ---------- list screen ---------- */
  function opts(list, cur, ph) { return '<option value="">' + esc(ph) + '</option>' + list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); }
  function deviceSelect() {
    var list = S.vendor ? (DEVICES[S.vendor] || []) : [];
    var dis = !S.vendor || !list.length;
    var ph = !S.vendor ? 'Pick a vendor first' : (list.length ? 'Any device' : 'No devices for ' + S.vendor);
    return '<select id="f-device"' + (dis ? ' disabled' : '') + ' aria-label="Device">' + opts(list, S.device, ph) + '</select>';
  }
  function card(a) {
    var meta = [a.vendor, a.device].filter(Boolean).join(' · ');
    var chips = [a.type, a.topic].filter(Boolean).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (a.safe ? '<span class="chip ok">Customer-safe</span>' : '');
    var step = a.path ? '<div class="path">' + esc(a.path) + (a.step ? ' · step ' + esc(a.step) : '') + '</div>' : '';
    return '<button type="button" class="card" data-id="' + esc(a.id) + '"><div class="cn">' + esc(a.no) + '</div><h3>' + esc(a.title) + '</h3>' +
      (a.symptom ? '<p>' + esc(a.symptom) + '</p>' : '') + '<div class="meta">' + esc(meta || 'No vendor') + '</div>' + step + '<div class="chips">' + chips + '</div></button>';
  }
  function listHtml(rows) {
    if (loadErr) return '<div class="empty"><b>Could not load articles.</b><br>' + esc(loadErr) + '</div>';
    if (!rows.length) return '<div class="empty"><b>No articles match.</b><br>Clear a filter or try a shorter search.' + (ALL.length ? '' : '<br>Nothing is published yet.') + '</div>';
    if (S.mode === 'learn') {
      var out = '', last = null;
      sortRows(rows).forEach(function (a) {
        var g = a.path || 'Not in a path';
        if (g !== last) { if (last !== null) out += '</div>'; out += '<h2 class="grph">' + esc(g) + '</h2><div class="grid">'; last = g; }
        out += card(a);
      });
      return out + '</div>';
    }
    return '<div class="grid">' + sortRows(rows).map(card).join('') + '</div>';
  }
  function paintList() {
    var m = MODES.filter(function (x) { return x.k === S.mode; })[0];
    var rows = visible();
    $('#app').innerHTML = '<div class="wrap"><header class="top"><div><h1>' + esc(m.t) + '</h1><div class="sub">' + esc(m.hint) + '</div></div>' +
      '<label class="sr" for="f-q">Search</label><input id="f-q" type="search" placeholder="Search by symptom, device or word" value="' + esc(S.q) + '"></header>' +
      '<div class="filters" role="group" aria-label="Filters">' +
      '<select id="f-type" aria-label="Type"' + (S.mode === 'fix' || S.mode === 'learn' ? ' disabled' : '') + '>' + opts(L.types, S.type, 'Any type') + '</select>' +
      '<select id="f-vendor" aria-label="Vendor">' + opts(L.vendors, S.vendor, 'Any vendor') + '</select>' + deviceSelect() +
      '<select id="f-topic" aria-label="Topic">' + opts(L.topics, S.topic, 'Any topic') + '</select>' +
      '<select id="f-audience" aria-label="Audience">' + opts(L.audiences, S.audience, 'Any audience') + '</select>' +
      '<button type="button" id="f-clear" class="btn">Clear</button></div>' +
      '<div class="count" id="count">' + rows.length + ' of ' + ALL.length + ' articles' + (live ? '' : ' (demo data, not live)') + '</div>' +
      '<div id="results">' + listHtml(rows) + '</div></div>';
    paintRail();
  }
  function paintResultsOnly() { var rows = visible(); $('#count').textContent = rows.length + ' of ' + ALL.length + ' articles' + (live ? '' : ' (demo data, not live)'); $('#results').innerHTML = listHtml(rows); }

  /* ---------- article screen ---------- */
  function byId(id) { return ALL.filter(function (a) { return a.id === id; })[0]; }
  function fmtDate(d) { return d ? esc(d) : 'Not set'; }
  function paintArticle(a) {
    var meta = [a.vendor, a.device].filter(Boolean).join(' · ');
    var related = ALL.filter(function (x) { return x.id !== a.id && x.vendor === a.vendor && (!a.device || !x.device || x.device === a.device); }).slice(0, 4);
    var pathList = a.path ? sortRows(ALL.filter(function (x) { return x.path === a.path; })).sort(function (p, q) { return p.step - q.step; }) : [];
    var idx = pathList.map(function (x) { return x.id; }).indexOf(a.id);
    var overdue = a.due && a.due < new Date().toISOString().slice(0, 10);
    var h = '<div class="wrap"><button type="button" class="btn back" id="back">&larr; Back to list</button>' +
      '<article class="art"><div class="cn">' + esc(a.no) + '</div><h1>' + esc(a.title) + '</h1><div class="meta">' + esc(meta || 'No vendor') + '</div>' +
      '<div class="chips">' + [a.type, a.topic].concat(a.audience).filter(Boolean).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (a.safe ? '<span class="chip ok">Customer-safe</span>' : '') + '</div>' +
      (a.symptom ? '<section><h2>What it looks like</h2><p>' + esc(a.symptom) + '</p></section>' : '') +
      '<section><h2>' + (a.type === 'Training' ? 'Steps' : 'What to do') + '</h2><div class="steps">' + (a.steps ? clean(a.steps) : '<p class="mut">No steps written yet.</p>') + '</div></section>' +
      (a.reply ? '<section class="reply"><h2>Customer-safe reply</h2>' + (a.safe ? '' : '<p class="warn">Not marked customer-safe. Check before sending.</p>') + '<blockquote id="reply-text">' + esc(a.reply) + '</blockquote><button type="button" class="btn pri" id="copy-reply">Copy reply</button> <span id="copy-msg" class="mut" role="status"></span></section>' : '') +
      (pathList.length > 1 ? '<section><h2>' + esc(a.path) + '</h2><ol class="pathlist">' + pathList.map(function (x) { return '<li' + (x.id === a.id ? ' class="cur"' : '') + '><button type="button" class="lnk" data-open="' + esc(x.id) + '">' + esc(x.title) + '</button></li>'; }).join('') + '</ol>' +
        '<div class="pn">' + (idx > 0 ? '<button type="button" class="btn" data-open="' + esc(pathList[idx - 1].id) + '">&larr; Previous step</button> ' : '') + (idx >= 0 && idx < pathList.length - 1 ? '<button type="button" class="btn pri" data-open="' + esc(pathList[idx + 1].id) + '">Next step &rarr;</button>' : '') + '</div></section>' : '') +
      '<section class="facts"><h2>About this article</h2><dl><dt>Source</dt><dd>' + esc(a.source || 'Not set') + '</dd><dt>Version</dt><dd>' + esc(a.version || 'Not set') + '</dd><dt>Last reviewed</dt><dd>' + fmtDate(a.reviewed) + '</dd><dt>Review due</dt><dd>' + fmtDate(a.due) + (overdue ? ' <span class="chip bad">Overdue</span>' : '') + '</dd>' + (a.used !== '' ? '<dt>Used on cases (30 days)</dt><dd>' + esc(a.used) + '</dd>' : '') + '</dl>' +
      '<button type="button" class="btn" id="open-crm">Open in Zoho to edit</button></section>' +
      (related.length ? '<section><h2>Related articles</h2><div class="grid">' + related.map(card).join('') + '</div></section>' : '') + '</article></div>';
    $('#app').innerHTML = h; paintRail();
    var m = $('#app'); if (m.scrollTo) m.scrollTo(0, 0); root.scrollTo && root.scrollTo(0, 0);
  }
  function copyText(t) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); return ok; }
    if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  function openArticle(id) { var a = byId(id); if (!a) return; S.open = id; paintArticle(a); }
  function closeArticle() { S.open = null; paintList(); }

  /* ---------- events ---------- */
  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var md = t.closest && t.closest('#rail [data-mode]');
      if (md) { S.mode = md.getAttribute('data-mode'); if (S.mode === 'fix') S.type = ''; if (S.mode === 'learn') S.type = ''; S.open = null; paintList(); return; }
      var c = t.closest && t.closest('.card[data-id]'); if (c) { openArticle(c.getAttribute('data-id')); return; }
      var o = t.closest && t.closest('[data-open]'); if (o) { openArticle(o.getAttribute('data-open')); return; }
      if (t.closest && t.closest('#back')) { closeArticle(); return; }
      if (t.closest && t.closest('#f-clear')) { S.q = S.type = S.vendor = S.device = S.topic = S.audience = ''; paintList(); return; }
      if (t.closest && t.closest('#copy-reply')) {
        copyText($('#reply-text').textContent).then(function (ok) { var m = $('#copy-msg'); if (m) m.textContent = ok ? 'Copied.' : 'Could not copy. Select the text and copy it by hand.'; });
        return;
      }
      if (t.closest && t.closest('#open-crm')) { if (live) root.ZOHO.CRM.UI.Record.open({ Entity: 'Knowledge_Articles', RecordID: S.open }); else { var m2 = $('#open-crm'); m2.textContent = 'Opens the Zoho record when running inside Zoho'; } }
    });
    document.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'f-vendor') { S.vendor = e.target.value; S.device = ''; paintList(); }   /* vendor change clears the device */
      else if (id === 'f-device') { S.device = e.target.value; paintResultsOnly(); }
      else if (id === 'f-type') { S.type = e.target.value; paintResultsOnly(); }
      else if (id === 'f-topic') { S.topic = e.target.value; paintResultsOnly(); }
      else if (id === 'f-audience') { S.audience = e.target.value; paintResultsOnly(); }
    });
    document.addEventListener('input', function (e) { if (e.target.id === 'f-q') { S.q = e.target.value; paintResultsOnly(); } });
  }

  /* ---------- start ---------- */
  function go(d) {
    load().then(function () { loadErr = ''; }, function (err) { loadErr = (err && (err.message || err.code)) || 'The Knowledge Articles module did not answer.'; ALL = []; }).then(function () {
      var want = d && (d.jpk_article || d.article); if (!want && /[#&]article=/.test(location.hash)) want = location.hash.split('article=')[1];
      if (want) { var a = ALL.filter(function (x) { return x.id === want || x.no === want; })[0]; if (a) { openArticle(a.id); return; } }
      paintList();
    });
  }
  wire();
  paintRail();
  if (root.ZOHO && root.ZOHO.embeddedApp) {
    var started = false;
    root.ZOHO.embeddedApp.on('PageLoad', function (d) { live = true; started = true; go(d || {}); });
    root.ZOHO.embeddedApp.init();
    setTimeout(function () { if (!started) go({}); }, 2500);   /* not inside Zoho: show demo records */
  } else { go({}); }
  root.KN = { state: S, all: function () { return ALL; }, deviceChoices: function () { return Array.prototype.map.call(document.querySelectorAll('#f-device option'), function (o) { return o.textContent; }); } };
})(window);
