/* knowledge.js v2.0 (30 Oct 2026): the Knowledge web tab. Read only.
   New in v2.0 over v1.0 (S43): Home screen with vendor tiles, Home button and breadcrumbs on every screen,
   Light / Dark / Auto switch, Vendor + Device up front with the other filters in a "More filters" drawer,
   pictures in articles ([img: path | caption] tags in Steps) with click-to-enlarge.
   Data: COQL on Knowledge_Articles (Status = Published). Outside Zoho it shows the demo records.
   Test hooks: #rail [data-mode], #rail [data-vendor], #home, #crumbs, #theme [data-theme], #f-vendor #f-device #f-type #f-topic #f-audience #f-q,
   #more, .card[data-id], .fig img, #lightbox, #copy-reply. */
(function (root) {
  'use strict';
  var D = root.KN_DATA, DEVICES = D.DEVICES, NOTES = D.VENDOR_NOTES || {}, L = D.LISTS;
  var live = false, ALL = [], loadErr = '';
  var S = { screen: 'home', mode: 'browse', q: '', type: '', vendor: '', device: '', topic: '', audience: '', more: false, open: null };
  var MODES = [
    { k: 'browse', t: 'Browse', hint: 'Everything published' },
    { k: 'fix', t: 'Fix a problem', hint: 'Troubleshooting articles' },
    { k: 'learn', t: 'Learn a device', hint: 'Training, in order' },
    { k: 'safe', t: 'Customer-safe replies', hint: 'Words you can send' }
  ];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- theme: Auto follows the computer; Light / Dark are remembered per browser ---------- */
  var THEME_KEY = 'kn-theme';
  function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function setTheme(t) {
    try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) {}
    applyTheme(t);
  }
  function applyTheme(t) {
    var h = document.documentElement;
    if (t === 'light' || t === 'dark') h.setAttribute('data-theme', t); else h.removeAttribute('data-theme');
    var box = $('#theme'); if (box) Array.prototype.forEach.call(box.querySelectorAll('[data-theme]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-theme') === t ? 'true' : 'false'); });
  }
  applyTheme(getTheme());

  /* ---------- data ---------- */
  function norm(r) {
    var a = r.Audience; if (typeof a === 'string') a = a ? a.split(';') : []; if (!Array.isArray(a)) a = [];
    return {
      id: String(r.id), no: r.Article_No || '', title: r.Name || '(untitled)', type: r.Article_Type || '', vendor: r.Vendor || '', device: r.Device || '',
      topic: r.Topic || '', audience: a, symptom: r.Symptom_Trigger || '', steps: r.Steps || '', reply: r.Customer_safe_reply || '',
      safe: r.Customer_safe === true || r.Customer_safe === 'true', path: r.Training_Path || '', step: parseFloat(r.Path_Step) || 0,
      source: r.Source_document || '', version: r.Version || '', reviewed: r.Last_Reviewed || '', due: r.Review_Due || '',
      used: (r.Used_on_cases_30d === null || r.Used_on_cases_30d === undefined) ? '' : r.Used_on_cases_30d
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
  function strip(h) { return String(h || '').replace(/\[img:[^\]]*\]/gi, ' ').replace(/<[^>]*>/g, ' '); }
  function matchMode(a, mode) {
    if (mode === 'fix') return a.type === 'Troubleshooting';
    if (mode === 'learn') return a.type === 'Training';
    if (mode === 'safe') return !!(a.safe && a.reply);
    return true;
  }
  function visible() {
    var q = S.q.trim().toLowerCase();
    return ALL.filter(function (a) {
      if (!matchMode(a, S.mode)) return false;
      if (S.type && a.type !== S.type) return false;
      if (S.vendor && a.vendor !== S.vendor) return false;
      if (S.device && a.device !== S.device) return false;
      if (S.topic && a.topic !== S.topic) return false;
      if (S.audience && a.audience.indexOf(S.audience) < 0) return false;
      if (q) { var hay = (a.no + ' ' + a.title + ' ' + a.symptom + ' ' + a.vendor + ' ' + a.device + ' ' + a.topic + ' ' + a.path + ' ' + strip(a.steps)).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
  }
  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      if (S.mode === 'learn') { return (a.path || '~').localeCompare(b.path || '~') || a.step - b.step || a.title.localeCompare(b.title); }
      return a.vendor.localeCompare(b.vendor) || a.device.localeCompare(b.device) || a.title.localeCompare(b.title);
    });
  }
  function counts() {
    var c = { browse: ALL.length, fix: 0, learn: 0, safe: 0, vendor: {}, device: {} };
    ALL.forEach(function (a) {
      if (a.type === 'Troubleshooting') c.fix++; if (a.type === 'Training') c.learn++; if (a.safe && a.reply) c.safe++;
      if (a.vendor) { c.vendor[a.vendor] = (c.vendor[a.vendor] || 0) + 1; if (a.device) { var k = a.vendor + '|' + a.device; c.device[k] = (c.device[k] || 0) + 1; } }
    });
    return c;
  }

  /* ---------- safe rich text (Steps is rich text from Zoho) + pictures ---------- */
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
    return pictures(doc.body.innerHTML);
  }
  /* [img: vendor/device/file.jpg | Caption] -> a figure. Only plain file paths under img/ are allowed. */
  var IMG_RE = /\[img:\s*([a-z0-9][a-z0-9_\/\-.]*\.(?:png|jpe?g|gif|webp))\s*(?:\|\s*([^\]]*?))?\s*\]/gi;
  function pictures(html) {
    return html.replace(IMG_RE, function (_, path, cap) {
      if (path.indexOf('..') >= 0) return '';
      cap = (cap || '').replace(/&nbsp;/g, ' ').trim();   /* text already HTML-escaped by the parser; quotes are not */
      var alt = cap.replace(/"/g, '&quot;');
      return '<figure class="fig"><button type="button" class="figbtn" aria-label="Enlarge picture"><img src="img/' + path + '" alt="' + alt + '" loading="lazy"></button>' + (cap ? '<figcaption>' + cap + '</figcaption>' : '') + '</figure>';
    });
  }
  function pictureCount(steps) { var m = String(steps || '').match(IMG_RE); return m ? m.length : 0; }

  /* ---------- rail ---------- */
  function paintRail() {
    var c = counts();
    var onHome = S.screen === 'home';
    var h = '<button type="button" class="nav home" id="home" aria-current="' + (onHome ? 'page' : 'false') + '"><span class="ico" aria-hidden="true">&#8962;</span><span class="nl">Home</span></button>' +
      '<div class="grp">Ways in</div>' + MODES.map(function (m) {
        var cur = !onHome && S.screen === 'list' && S.mode === m.k && !S.vendor;
        return '<button type="button" class="nav" data-mode="' + m.k + '" aria-current="' + (cur ? 'page' : 'false') + '"><span class="nl">' + esc(m.t) + '</span><span class="cnt">' + c[m.k] + '</span></button>';
      }).join('') +
      '<div class="grp">Vendors</div>' + L.vendors.map(function (v) {
        var cur = S.screen !== 'home' && S.vendor === v;
        return '<button type="button" class="nav" data-vendor="' + esc(v) + '" aria-current="' + (cur ? 'page' : 'false') + '"><span class="nl">' + esc(v) + '</span><span class="cnt">' + (c.vendor[v] || 0) + '</span></button>';
      }).join('') +
      '<div class="rail-foot"><div class="grp">Theme</div><div class="seg" id="theme" role="group" aria-label="Theme">' +
      ['auto', 'light', 'dark'].map(function (t) { return '<button type="button" data-theme="' + t + '" aria-pressed="false">' + t.charAt(0).toUpperCase() + t.slice(1) + '</button>'; }).join('') + '</div></div>';
    $('#rail').innerHTML = '<div class="kn-brand">Knowledge</div>' + h;
    applyTheme(getTheme());
  }

  /* ---------- breadcrumbs ---------- */
  function crumbs(parts) {
    /* parts: [{t, go}] ; last one is plain text */
    return '<nav class="crumbs" id="crumbs" aria-label="Where you are"><ol>' + parts.map(function (p, i) {
      var last = i === parts.length - 1;
      return '<li>' + (last ? '<span aria-current="page">' + esc(p.t) + '</span>' : '<button type="button" class="crumb" data-go="' + esc(p.go) + '">' + esc(p.t) + '</button>') + '</li>';
    }).join('') + '</ol></nav>';
  }
  function modeName(k) { return MODES.filter(function (m) { return m.k === k; })[0].t; }
  function listCrumbs() {
    var p = [{ t: 'Home', go: 'home' }];
    if (S.mode !== 'browse') p.push({ t: modeName(S.mode), go: 'mode' });
    if (S.vendor) p.push({ t: S.vendor, go: 'vendor' });
    if (S.device) p.push({ t: S.device, go: 'device' });
    if (p.length === 1) p.push({ t: 'Browse', go: 'mode' });
    return p;
  }

  /* ---------- home screen ---------- */
  function paintHome() {
    var c = counts();
    var tiles = L.vendors.map(function (v) {
      var n = c.vendor[v] || 0;
      var devs = (DEVICES[v] || []).map(function (d) {
        var k = c.device[v + '|' + d] || 0;
        return '<button type="button" class="dchip' + (k ? '' : ' none') + '" data-vendor="' + esc(v) + '" data-device="' + esc(d) + '">' + esc(d) + ' <span class="k">' + k + '</span></button>';
      }).join('');
      return '<div class="tile' + (n ? '' : ' empty-tile') + '"><button type="button" class="tile-h" data-vendor="' + esc(v) + '"><span class="tile-t">' + esc(v) + '</span><span class="cnt">' + n + '</span></button>' +
        '<div class="tile-n">' + esc(NOTES[v] || '') + '</div>' + (devs ? '<div class="dchips">' + devs + '</div>' : '') + '</div>';
    }).join('');
    var ways = MODES.map(function (m) {
      return '<button type="button" class="way" data-mode="' + m.k + '"><span class="way-t">' + esc(m.t) + '</span><span class="way-h">' + esc(m.hint) + '</span><span class="cnt">' + c[m.k] + '</span></button>';
    }).join('');
    var used = ALL.filter(function (a) { return +a.used > 0; }).sort(function (a, b) { return +b.used - +a.used; }).slice(0, 4);
    $('#app').innerHTML = '<div class="wrap home">' +
      '<header class="hero"><h1>What do you need help with?</h1><div class="sub">Type a symptom, a device or a word, or pick a vendor below.</div>' +
      '<form class="hs" id="home-search" role="search"><label class="sr" for="f-q">Search</label><input id="f-q" type="search" placeholder="e.g. no GPS point, curfew, strap" autocomplete="off"><button type="submit" class="btn pri">Search</button></form></header>' +
      (loadErr ? '<div class="empty"><b>Could not load articles.</b><br>' + esc(loadErr) + '</div>' : '') +
      (!ALL.length && !loadErr ? '<div class="empty"><b>Nothing is published yet.</b><br>Articles show here once their Status is Published.</div>' : '') +
      '<h2 class="hh">By vendor</h2><div class="tiles">' + tiles + '</div>' +
      '<h2 class="hh">Other ways in</h2><div class="ways">' + ways + '</div>' +
      (used.length ? '<h2 class="hh">Used most on cases, last 30 days</h2><div class="grid">' + used.map(card).join('') + '</div>' : '') +
      (live ? '' : '<div class="count">Demo data, not live.</div>') + '</div>';
    paintRail();
    scrollTop();
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
    var pics = pictureCount(a.steps);
    var chips = [a.type, a.topic].filter(Boolean).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (a.safe ? '<span class="chip ok">Customer-safe</span>' : '') + (pics ? '<span class="chip pic" title="Has pictures">&#9635; ' + pics + '</span>' : '');
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
  function moreCount() { return [S.type, S.topic, S.audience].filter(Boolean).length; }
  function countText(rows) { return rows.length + ' of ' + ALL.length + ' articles' + (live ? '' : ' (demo data, not live)'); }
  function paintList() {
    var m = MODES.filter(function (x) { return x.k === S.mode; })[0];
    var rows = visible();
    var title = S.device ? S.vendor + ' · ' + S.device : (S.vendor || m.t);
    var hint = S.vendor ? (S.mode === 'browse' ? 'Everything published for ' + S.vendor : m.hint) : m.hint;
    var mc = moreCount();
    $('#app').innerHTML = '<div class="wrap">' + crumbs(listCrumbs()) +
      '<header class="top"><div><h1>' + esc(title) + '</h1><div class="sub">' + esc(hint) + '</div></div>' +
      '<label class="sr" for="f-q">Search</label><input id="f-q" type="search" placeholder="Search by symptom, device or word" value="' + esc(S.q) + '"></header>' +
      '<div class="filters" role="group" aria-label="Filters">' +
      '<select id="f-vendor" aria-label="Vendor">' + opts(L.vendors, S.vendor, 'Any vendor') + '</select>' + deviceSelect() +
      '<button type="button" id="more" class="btn" aria-expanded="' + (S.more ? 'true' : 'false') + '" aria-controls="more-box">More filters' + (mc ? ' <span class="cnt on">' + mc + '</span>' : '') + '</button>' +
      ((S.q || S.vendor || S.device || mc) ? '<button type="button" id="f-clear" class="btn">Clear all</button>' : '') + '</div>' +
      '<div class="filters more-box" id="more-box"' + (S.more ? '' : ' hidden') + '>' +
      '<label>Type <select id="f-type" aria-label="Type"' + (S.mode === 'fix' || S.mode === 'learn' ? ' disabled' : '') + '>' + opts(L.types, S.type, 'Any type') + '</select></label>' +
      '<label>Topic <select id="f-topic" aria-label="Topic">' + opts(L.topics, S.topic, 'Any topic') + '</select></label>' +
      '<label>Audience <select id="f-audience" aria-label="Audience">' + opts(L.audiences, S.audience, 'Any audience') + '</select></label></div>' +
      '<div class="count" id="count">' + countText(rows) + '</div>' +
      '<div id="results">' + listHtml(rows) + '</div></div>';
    paintRail();
    scrollTop();
  }
  function paintResultsOnly() { var rows = visible(); $('#count').textContent = countText(rows); $('#results').innerHTML = listHtml(rows); }

  /* ---------- article screen ---------- */
  function byId(id) { return ALL.filter(function (a) { return a.id === id; })[0]; }
  function fmtDate(d) { return d ? esc(d) : 'Not set'; }
  function paintArticle(a, keepScroll) {
    var meta = [a.vendor, a.device].filter(Boolean).join(' · ');
    var loading = live && !a.full ? '<p class="mut" id="art-loading">Loading the full article…</p>' : '';
    var related = ALL.filter(function (x) { return x.id !== a.id && x.vendor === a.vendor && (!a.device || !x.device || x.device === a.device); }).slice(0, 4);
    var pathList = a.path ? sortRows(ALL.filter(function (x) { return x.path === a.path; })).sort(function (p, q) { return p.step - q.step; }) : [];
    var idx = pathList.map(function (x) { return x.id; }).indexOf(a.id);
    var overdue = a.due && a.due < new Date().toISOString().slice(0, 10);
    var cr = [{ t: 'Home', go: 'home' }];
    if (S.mode !== 'browse') cr.push({ t: modeName(S.mode), go: 'mode' });
    if (a.vendor) cr.push({ t: a.vendor, go: 'avendor' });
    if (a.device) cr.push({ t: a.device, go: 'adevice' });
    cr.push({ t: a.title, go: '' });
    var h = '<div class="wrap">' + crumbs(cr) + '<div class="back-row"><button type="button" class="btn back" id="back">&larr; Back to list</button></div>' +
      '<article class="art"><div class="cn">' + esc(a.no) + '</div><h1>' + esc(a.title) + '</h1><div class="meta">' + esc(meta || 'No vendor') + '</div>' +
      '<div class="chips">' + [a.type, a.topic].concat(a.audience).filter(Boolean).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + (a.safe ? '<span class="chip ok">Customer-safe</span>' : '') + '</div>' +
      (a.symptom ? '<section><h2>What it looks like</h2><p>' + esc(a.symptom) + '</p></section>' : '') +
      '<section><h2>' + (a.type === 'Training' ? 'Steps' : 'What to do') + '</h2><div class="steps">' + (a.steps ? clean(a.steps) : '<p class="mut">No steps written yet.</p>') + '</div>' + loading + '</section>' +
      (a.reply ? '<section class="reply"><h2>Customer-safe reply</h2>' + (a.safe ? '' : '<p class="warn">Not marked customer-safe. Check before sending.</p>') + '<blockquote id="reply-text">' + esc(a.reply) + '</blockquote><button type="button" class="btn pri" id="copy-reply">Copy reply</button> <span id="copy-msg" class="mut" role="status"></span></section>' : '') +
      (pathList.length > 1 ? '<section><h2>' + esc(a.path) + '</h2><ol class="pathlist">' + pathList.map(function (x) { return '<li' + (x.id === a.id ? ' class="cur"' : '') + '><button type="button" class="lnk" data-open="' + esc(x.id) + '">' + esc(x.title) + '</button></li>'; }).join('') + '</ol>' +
        '<div class="pn">' + (idx > 0 ? '<button type="button" class="btn" data-open="' + esc(pathList[idx - 1].id) + '">&larr; Previous step</button> ' : '') + (idx >= 0 && idx < pathList.length - 1 ? '<button type="button" class="btn pri" data-open="' + esc(pathList[idx + 1].id) + '">Next step &rarr;</button>' : '') + '</div></section>' : '') +
      '<section class="facts"><h2>About this article</h2><dl><dt>Source</dt><dd>' + esc(a.source || 'Not set') + '</dd><dt>Version</dt><dd>' + esc(a.version || 'Not set') + '</dd><dt>Last reviewed</dt><dd>' + fmtDate(a.reviewed) + '</dd><dt>Review due</dt><dd>' + fmtDate(a.due) + (overdue ? ' <span class="chip bad">Overdue</span>' : '') + '</dd>' + (a.used !== '' ? '<dt>Used on cases (30 days)</dt><dd>' + esc(a.used) + '</dd>' : '') + '</dl>' +
      '<button type="button" class="btn" id="open-crm">Open in Zoho to edit</button></section>' +
      (related.length ? '<section><h2>Related articles</h2><div class="grid">' + related.map(card).join('') + '</div></section>' : '') + '</article>' +
      '<div class="back-row bottom"><button type="button" class="btn" data-go="home">&#8962; Home</button> <button type="button" class="btn back2">&larr; Back to list</button></div></div>';
    $('#app').innerHTML = h; paintRail();
    if (!keepScroll) scrollTop();
  }
  function scrollTop() { var m = $('#app'); if (m.scrollTo) m.scrollTo(0, 0); root.scrollTo && root.scrollTo(0, 0); }

  /* ---------- lightbox ---------- */
  function openLightbox(img) {
    var cap = img.closest('figure') && img.closest('figure').querySelector('figcaption');
    var box = $('#lightbox');
    box.innerHTML = '<div class="lb-in" role="dialog" aria-modal="true" aria-label="Picture"><button type="button" class="lb-x" id="lb-close" aria-label="Close">&times;</button><img src="' + esc(img.getAttribute('src')) + '" alt="' + esc(img.alt) + '">' + (cap ? '<div class="lb-cap">' + esc(cap.textContent) + '</div>' : '') + '</div>';
    box.hidden = false; document.body.classList.add('lb-open'); $('#lb-close').focus();
  }
  function closeLightbox() { var box = $('#lightbox'); if (box.hidden) return; box.hidden = true; box.innerHTML = ''; document.body.classList.remove('lb-open'); }

  /* ---------- navigation ---------- */
  function goHome() { S.screen = 'home'; S.open = null; S.q = ''; paintHome(); }
  function goList() { S.screen = 'list'; S.open = null; paintList(); }
  /* Zoho's bulk query cuts long text fields short, so the full record is fetched the first time an article is opened. */
  function fillArticle(a) {
    if (!live || a.full || !root.ZOHO || !root.ZOHO.CRM) { a.full = true; return Promise.resolve(a); }
    return root.ZOHO.CRM.API.getRecord({ Entity: 'Knowledge_Articles', RecordID: a.id }).then(function (res) {
      var r = res && res.data && res.data[0];
      if (r) { var n = norm(r); a.steps = n.steps; a.reply = n.reply; a.symptom = n.symptom; }
      a.full = true; return a;
    }, function () { a.full = true; return a; });
  }
  function openArticle(id) {
    var a = byId(id); if (!a) return; S.screen = 'article'; S.open = id;
    paintArticle(a);
    if (!a.full) fillArticle(a).then(function () { if (S.open === a.id && S.screen === 'article') paintArticle(a, true); });
  }
  function closeArticle() { goList(); }
  function go(where) {
    var a = S.open ? byId(S.open) : null;
    if (where === 'home') return goHome();
    if (where === 'mode') { S.vendor = S.device = ''; return goList(); }
    if (where === 'vendor') { S.device = ''; return goList(); }
    if (where === 'device') { return goList(); }
    if (where === 'avendor' && a) { S.vendor = a.vendor; S.device = ''; return goList(); }
    if (where === 'adevice' && a) { S.vendor = a.vendor; S.device = a.device; return goList(); }
    goList();
  }

  /* ---------- events ---------- */
  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.closest) return;
      var th = t.closest('#theme [data-theme]'); if (th) { setTheme(th.getAttribute('data-theme')); return; }
      if (t.closest('#home')) { goHome(); return; }
      var g = t.closest('[data-go]'); if (g) { go(g.getAttribute('data-go')); return; }
      var md = t.closest('[data-mode]');
      if (md) { S.mode = md.getAttribute('data-mode'); if (S.mode === 'fix' || S.mode === 'learn') S.type = ''; if (md.closest('#rail') || md.closest('.home')) { S.vendor = S.device = ''; S.q = ''; } goList(); return; }   /* rail and Home start fresh */
      var dv = t.closest('[data-vendor]');
      if (dv) { S.vendor = dv.getAttribute('data-vendor'); S.device = dv.getAttribute('data-device') || ''; if (dv.closest('#rail') || dv.closest('.home')) { S.mode = 'browse'; S.q = ''; } goList(); return; }
      var c = t.closest('.card[data-id]'); if (c) { openArticle(c.getAttribute('data-id')); return; }
      var o = t.closest('[data-open]'); if (o) { openArticle(o.getAttribute('data-open')); return; }
      if (t.closest('#back') || t.closest('.back2')) { closeArticle(); return; }
      if (t.closest('#more')) { S.more = !S.more; var b = $('#more-box'); b.hidden = !S.more; $('#more').setAttribute('aria-expanded', S.more ? 'true' : 'false'); return; }
      if (t.closest('#f-clear')) { S.q = S.type = S.vendor = S.device = S.topic = S.audience = ''; paintList(); return; }
      var fb = t.closest('.figbtn'); if (fb) { openLightbox(fb.querySelector('img')); return; }
      if (t.closest('#lb-close') || (t.id === 'lightbox')) { closeLightbox(); return; }
      if (t.closest('#copy-reply')) {
        copyText($('#reply-text').textContent).then(function (ok) { var m = $('#copy-msg'); if (m) m.textContent = ok ? 'Copied.' : 'Could not copy. Select the text and copy it by hand.'; });
        return;
      }
      if (t.closest('#open-crm')) { if (live) root.ZOHO.CRM.UI.Record.open({ Entity: 'Knowledge_Articles', RecordID: S.open }); else { var m2 = $('#open-crm'); m2.textContent = 'Opens the Zoho record when running inside Zoho'; } }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
    document.addEventListener('submit', function (e) { if (e.target.id === 'home-search') { e.preventDefault(); S.q = $('#f-q').value; S.mode = 'browse'; S.vendor = S.device = ''; goList(); } });
    document.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'f-vendor') { S.vendor = e.target.value; S.device = ''; paintList(); }   /* vendor change clears the device */
      else if (id === 'f-device') { S.device = e.target.value; paintList(); }
      else if (id === 'f-type') { S.type = e.target.value; paintResultsOnly(); }
      else if (id === 'f-topic') { S.topic = e.target.value; paintResultsOnly(); }
      else if (id === 'f-audience') { S.audience = e.target.value; paintResultsOnly(); }
    });
    document.addEventListener('input', function (e) { if (e.target.id === 'f-q' && S.screen === 'list') { S.q = e.target.value; paintResultsOnly(); } });
  }
  function copyText(t) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); return ok; }
    if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }

  /* ---------- start ---------- */
  function start(d) {
    load().then(function () { loadErr = ''; }, function (err) { loadErr = (err && (err.message || err.code)) || 'The Knowledge Articles module did not answer.'; ALL = []; }).then(function () {
      var want = d && (d.jpk_article || d.article); if (!want && /[#&]article=/.test(location.hash)) want = location.hash.split('article=')[1];
      if (want) { var a = ALL.filter(function (x) { return x.id === want || x.no === want; })[0]; if (a) { openArticle(a.id); return; } }
      goHome();
    });
  }
  wire();
  paintRail();
  if (root.ZOHO && root.ZOHO.embeddedApp) {
    var started = false;
    root.ZOHO.embeddedApp.on('PageLoad', function (d) { live = true; started = true; start(d || {}); });
    root.ZOHO.embeddedApp.init();
    setTimeout(function () { if (!started) start({}); }, 2500);   /* not inside Zoho: show demo records */
  } else { start({}); }
  root.KN = { state: S, all: function () { return ALL; }, theme: getTheme, deviceChoices: function () { return Array.prototype.map.call(document.querySelectorAll('#f-device option'), function (o) { return o.textContent; }); } };
})(window);
