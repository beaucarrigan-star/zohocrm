/* JusticePoint widget kit (jpk) v1.1.0
   No dependencies. Works without the Zoho SDK (for local tests); JPK.crm uses it when present.
   Every part takes a host element and returns a small handle. Nothing here calls an AI or LLM. */
(function (root) {
  'use strict';
  var VERSION = '1.1.0';
  var doc = root.document;

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, d) {
    if (n == null || isNaN(n)) return '';
    d = d == null ? 2 : d;
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtDate(v) {
    if (!v) return '';
    var d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function el(html) { var t = doc.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function host(h) { return typeof h === 'string' ? $(h) : h; }
  var uid = 0; function id(p) { uid += 1; return (p || 'jpk') + '-' + uid; }
  function focusables(r) {
    return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', r)
      .filter(function (e) { return e.offsetParent !== null || e === doc.activeElement; });
  }
  function flash(e) { if (!e) return; e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); }

  /* ---------- toast ---------- */
  var toastEl, toastTimer;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = el('<div class="jpk-toast" role="status" aria-live="polite"></div>');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 2800);
  }

  /* ---------- drawer ---------- */
  var dr, drLast, drOnClose;
  function ensureDrawer() {
    if (dr) return dr;
    var tid = id('drt');
    dr = el('<div class="jpk-dr" hidden><div class="scrim"></div>' +
      '<aside role="dialog" aria-modal="true" aria-labelledby="' + tid + '">' +
      '<header><h3 id="' + tid + '"></h3><button class="iconbtn" data-close aria-label="Close">&times;</button></header>' +
      '<div class="dr-b"></div><footer hidden></footer></aside></div>');
    doc.body.appendChild(dr);
    $('.scrim', dr).addEventListener('click', closeDrawer);
    $('[data-close]', dr).addEventListener('click', closeDrawer);
    dr.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables($('aside', dr)); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return dr;
  }
  /* opts: {title, html | node, actions:[{label, primary, onClick(close), disabled}], onMount(body), onClose()} */
  function openDrawer(opts) {
    ensureDrawer();
    var body = $('.dr-b', dr), foot = $('footer', dr);
    $('h3', dr).textContent = opts.title || '';
    body.innerHTML = '';
    if (opts.node) body.appendChild(opts.node); else body.innerHTML = opts.html || '';
    foot.innerHTML = '';
    foot.hidden = !(opts.actions && opts.actions.length);
    (opts.actions || []).forEach(function (a) {
      var b = el('<button class="btn' + (a.primary ? ' pri' : '') + '">' + esc(a.label) + '</button>');
      b.disabled = !!a.disabled;
      b.addEventListener('click', function () { a.onClick && a.onClick(closeDrawer, body); });
      foot.appendChild(b);
    });
    drOnClose = opts.onClose || null;
    if (dr.hidden) drLast = doc.activeElement;
    dr.hidden = false;
    $('aside', dr).scrollTop = 0;
    $('[data-close]', dr).focus();
    if (opts.onMount) opts.onMount(body);
    return { body: body, close: closeDrawer };
  }
  function closeDrawer() {
    if (!dr || dr.hidden) return;
    dr.hidden = true;
    var cb = drOnClose; drOnClose = null;
    if (cb) cb();
    if (drLast && drLast.focus && doc.contains(drLast)) { try { drLast.focus(); } catch (e) { /* ignore */ } }
  }
  function drawerOpen() { return !!dr && !dr.hidden; }

  /* ---------- About drawer ---------- */
  /* about(what, tryIt?) — what the screen is for, and one line on how to use it */
  function about(what, tryIt, extra) {
    return openDrawer({
      title: 'About this screen',
      html: '<p>' + esc(what) + '</p>' + (tryIt ? '<p class="sm muted"><b>How to use it:</b> ' + esc(tryIt) + '</p>' : '') +
        (extra ? '<p class="sm muted">' + esc(extra) + '</p>' : '')
    });
  }
  function aboutButton(what, tryIt, extra) {
    var b = el('<button class="iconbtn" aria-label="About this screen">?</button>');
    b.addEventListener('click', function () { about(what, tryIt, extra); });
    return b;
  }

  /* ---------- chips ---------- */
  var TONES = { good: 1, warn: 1, bad: 1, info: 1 };
  function chip(text, tone, small) {
    return '<span class="chip' + (TONES[tone] ? ' ' + tone : '') + (small ? ' sm' : '') + '">' + esc(text) + '</span>';
  }
  /* File status from Contract_Documents.Parse_Status (values confirmed in the org: Parsed, No text layer, Skipped, Failed). */
  var PARSE = {
    'Parsed': ['Read', 'good'],
    'No text layer': ['Needs OCR', 'warn'],
    'Skipped': ['Skipped', ''],
    'Failed': ['Failed', 'bad'],
    'Reading': ['Reading', 'info'],
    'Waiting': ['Waiting', '']
  };
  function parseChip(status) {
    var p = PARSE[status] || PARSE.Waiting;
    return chip(p[0], p[1]);
  }
  /* Contracts.Ingest_Status values seen in the org: Backlog, Not Ingested, Needs Review, Ingested */
  var INGEST = { 'Backlog': ['Backlog', ''], 'Not Ingested': ['Not read yet', 'warn'], 'Needs Review': ['Needs review', 'info'], 'Ingested': ['Verified', 'good'] };
  function ingestChip(status) { var p = INGEST[status] || [status || 'Unknown', '']; return chip(p[0], p[1]); }

  /* ---------- sortable table ---------- */
  /* cfg: {columns:[{key,label,align:'r',num:bool,sortable:true,hideNarrow:bool (hidden under 640px; keep the row drawer as the way in),format(v,row)->html}], rows, sort:{key,dir},
           rowKey(row), onRow(row,tr), empty:{title,text}, caption} */
  function compare(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;            // blanks always last
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  }
  function table(h, cfg) {
    h = host(h);
    var state = { rows: cfg.rows || [], sort: cfg.sort || null };
    var tw = el('<div class="tw"><table>' + (cfg.caption ? '<caption class="sr">' + esc(cfg.caption) + '</caption>' : '') + '<thead><tr></tr></thead><tbody></tbody></table></div>');
    var tr = $('thead tr', tw), tb = $('tbody', tw);
    cfg.columns.forEach(function (c) {
      var cls = (c.align === 'r' ? 'r ' : '') + (c.sortable === false ? '' : 'sort') + (c.hideNarrow ? ' hide-s' : '');
      var th = el('<th class="' + cls + '" scope="col" data-k="' + esc(c.key) + '"></th>');
      if (c.sortable === false) th.textContent = c.label || '';
      else th.innerHTML = '<button type="button">' + esc(c.label) + '</button>';
      tr.appendChild(th);
    });
    h.innerHTML = ''; h.appendChild(tw);
    tr.addEventListener('click', function (e) {
      var th = e.target.closest('th.sort'); if (!th) return;
      var k = th.dataset.k;
      state.sort = { key: k, dir: state.sort && state.sort.key === k ? -state.sort.dir : 1 };
      render();
      var b = $('th[data-k="' + k + '"] button', tw); if (b) b.focus();
    });
    function activate(e) {
      var row = e.target.closest('tr[data-i]'); if (!row || !cfg.onRow) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target !== row && e.target.closest('button,a,input,select,label')) return; // inner controls handle themselves
      if (e.type === 'keydown') e.preventDefault();
      cfg.onRow(state.view[+row.dataset.i], row);
    }
    tb.addEventListener('click', activate);
    tb.addEventListener('keydown', activate);
    function render() {
      var v = state.rows.slice();
      if (state.sort) {
        var k = state.sort.key, d = state.sort.dir;
        var col = cfg.columns.filter(function (c) { return c.key === k; })[0] || {};
        var get = col.sortValue || function (r) { return r[k]; };
        v.sort(function (a, b) { var x = get(a), y = get(b); if (x == null || y == null) return compare(x, y); return d * compare(x, y); });
      }
      state.view = v;
      $$('th', tr).forEach(function (th) {
        if (!th.classList.contains('sort')) return;
        th.setAttribute('aria-sort', state.sort && th.dataset.k === state.sort.key ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      });
      if (!v.length) {
        var em = cfg.empty || { title: 'Nothing here yet', text: '' };
        tb.innerHTML = '<tr><td colspan="' + cfg.columns.length + '"><div class="empty"><b>' + esc(em.title) + '</b>' + esc(em.text || '') + '</div></td></tr>';
        return;
      }
      tb.innerHTML = v.map(function (r, i) {
        return '<tr data-i="' + i + '"' + (cfg.onRow ? ' class="click" tabindex="0"' : '') + '>' + cfg.columns.map(function (c) {
          var val = c.format ? c.format(r[c.key], r) : esc(r[c.key]);
          return '<td class="' + (c.align === 'r' ? 'r ' : '') + (c.num ? 'num ' : '') + (c.hideNarrow ? 'hide-s' : '') + '">' + val + '</td>';
        }).join('') + '</tr>';
      }).join('');
    }
    render();
    return {
      setRows: function (rows) { state.rows = rows || []; render(); },
      setSort: function (key, dir) { state.sort = key ? { key: key, dir: dir || 1 } : null; render(); },
      rows: function () { return state.view.slice(); },
      el: tw
    };
  }

  /* ---------- hover chart ---------- */
  /* cfg: {labels[], series:[{name,pts[],c}], ymin, ymax, fy(v), fv(v), t ticks, h, hline, hlabel, aria} */
  function chart(h, cfg) {
    h = host(h); h.classList.add('chartwrap');
    var W = Math.max(320, Math.min(900, h.clientWidth || 600)), H = cfg.h || 160, L = 42, R = 12, T = 12, B = 24, n = cfg.labels.length;
    var fy = cfg.fy || function (v) { return Math.round(v); }, fv = cfg.fv || function (v) { return v; };
    var all = []; cfg.series.forEach(function (s) { all = all.concat(s.pts.filter(function (v) { return v != null; })); });
    var ymin = cfg.ymin != null ? cfg.ymin : Math.min.apply(null, all.concat([0]));
    var ymax = cfg.ymax != null ? cfg.ymax : Math.max.apply(null, all.concat([ymin + 1]));
    if (ymax === ymin) ymax = ymin + 1;
    function X(i) { return L + (W - L - R) * i / Math.max(1, n - 1); }
    function Y(v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); }
    var o = '', k, TK = cfg.t || 3;
    for (k = 0; k <= TK; k++) {
      var v = ymin + (ymax - ymin) * k / TK, y = Y(v);
      o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)"/><text x="' + (L - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(fy(v)) + '</text>';
    }
    var tk = n < 4 ? cfg.labels.map(function (_, i) { return i; }) : [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
    tk.forEach(function (i, j) {
      o += '<text x="' + X(i) + '" y="' + (H - 7) + '" text-anchor="' + (j === 0 ? 'start' : j === tk.length - 1 ? 'end' : 'middle') + '">' + esc(cfg.labels[i]) + '</text>';
    });
    if (cfg.hline != null) {
      var hy = Y(cfg.hline);
      o += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + hy + '" y2="' + hy + '" stroke="var(--bad)" stroke-dasharray="4 3" stroke-width="1.5"/>' +
        (cfg.hlabel ? '<text x="' + (W - R) + '" y="' + (hy - 4) + '" text-anchor="end" style="fill:var(--bad)">' + esc(cfg.hlabel) + '</text>' : '');
    }
    cfg.series.forEach(function (s) {
      var d = s.pts.map(function (val, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(val).toFixed(1); }).join(' ');
      o += '<path d="' + d + ' L' + X(n - 1) + ' ' + Y(ymin) + ' L' + X(0) + ' ' + Y(ymin) + ' Z" fill="' + s.c + '" opacity=".09"/>' +
        '<path d="' + d + '" fill="none" stroke="' + s.c + '" stroke-width="2"/><circle cx="' + X(n - 1) + '" cy="' + Y(s.pts[n - 1]) + '" r="4" fill="' + s.c + '"/>';
    });
    h.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" tabindex="0" aria-label="' + esc(cfg.aria || 'Chart') + '. Use left and right arrow keys to read values.">' + o +
      '<line class="cross" y1="' + T + '" y2="' + (H - B) + '" x1="0" x2="0" style="display:none"/>' +
      '<rect class="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent" style="touch-action:pan-y"/></svg>' +
      '<div class="tip" hidden></div><div class="sr" aria-live="polite"></div>' +
      (cfg.series.length > 1 ? '<div class="legend">' + cfg.series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '');
    var svg = $('svg', h), hit = $('.hit', h), cr = $('.cross', h), tip = $('.tip', h), live = $('.sr', h), cur = n - 1;
    function show(idx) {
      cur = idx;
      cr.setAttribute('x1', X(idx)); cr.setAttribute('x2', X(idx)); cr.style.display = '';
      var txt = cfg.series.map(function (s) { return esc(s.name) + ' ' + esc(fv(s.pts[idx])); }).join(', ');
      tip.innerHTML = '<b>' + esc(cfg.labels[idx]) + '</b> ' + txt; tip.hidden = false;
      live.textContent = cfg.labels[idx] + ': ' + tip.textContent.replace(cfg.labels[idx], '').trim();
      var px = (X(idx) / W) * svg.getBoundingClientRect().width, tw = tip.offsetWidth, wd = h.offsetWidth;
      tip.style.left = Math.max(0, Math.min(wd - tw, px - tw / 2)) + 'px';
    }
    function hide() { cr.style.display = 'none'; tip.hidden = true; }
    function move(ev) {
      var r = hit.getBoundingClientRect();
      show(Math.max(0, Math.min(n - 1, Math.round((ev.clientX - r.left) / r.width * (n - 1)))));
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, cur - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(n - 1, cur + 1)); }
      else if (e.key === 'Home') { e.preventDefault(); show(0); }
      else if (e.key === 'End') { e.preventDefault(); show(n - 1); }
      else if (e.key === 'Escape') hide();
    });
    svg.addEventListener('focus', function () { show(cur); });
    svg.addEventListener('blur', hide);
    return { show: show, hide: hide };
  }

  /* ---------- next-step strip ---------- */
  /* set({title, sub, action:{label,onClick}, progress:0-100, tone:'warn'|'bad'|'done'}) — one next action, always */
  function next(h) {
    h = host(h); h.classList.add('next'); h.setAttribute('role', 'region'); h.setAttribute('aria-label', 'Next step');
    var api = {
      set: function (o) {
        h.className = 'next' + (o.tone ? ' ' + o.tone : '');
        h.innerHTML = '<div class="nt"><b>' + esc(o.title) + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') +
          (o.progress != null ? '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(o.progress) + '"><i style="width:' + Math.max(0, Math.min(100, o.progress)) + '%"></i></div>' : '') +
          '</div>';
        if (o.action) {
          var b = el('<button class="btn pri">' + esc(o.action.label) + '</button>');
          b.disabled = !!o.action.disabled;
          b.addEventListener('click', o.action.onClick);
          h.appendChild(b);
        }
      }
    };
    return api;
  }

  /* ---------- tabs with count badges ---------- */
  /* tabs(host, {tabs:[{id,label,count}], active, panes:{id: element}, onChange(id)}) */
  function tabs(h, cfg) {
    h = host(h); h.classList.add('ctabs'); h.setAttribute('role', 'tablist');
    var cur = cfg.active || cfg.tabs[0].id, base = id('tab');
    h.innerHTML = cfg.tabs.map(function (t) {
      return '<button role="tab" id="' + base + '-' + t.id + '" data-t="' + esc(t.id) + '" aria-selected="false" tabindex="-1">' + esc(t.label) +
        '<span class="cnt" data-cnt="' + esc(t.id) + '">' + (t.count > 0 ? t.count : '') + '</span></button>';
    }).join('');
    cfg.tabs.forEach(function (t) {
      var p = cfg.panes && cfg.panes[t.id];
      if (p) { p.classList.add('pane'); p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', base + '-' + t.id); }
    });
    function select(tid, focus) {
      cur = tid;
      $$('[role=tab]', h).forEach(function (b) {
        var on = b.dataset.t === tid;
        b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      if (cfg.panes) Object.keys(cfg.panes).forEach(function (k) { cfg.panes[k].hidden = k !== tid; });
      if (cfg.onChange) cfg.onChange(tid);
    }
    h.addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (b) select(b.dataset.t); });
    h.addEventListener('keydown', function (e) {
      var ids = cfg.tabs.map(function (t) { return t.id; }), i = ids.indexOf(cur);
      if (e.key === 'ArrowRight') { e.preventDefault(); select(ids[(i + 1) % ids.length], true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); select(ids[(i - 1 + ids.length) % ids.length], true); }
    });
    select(cur);
    return {
      select: select,
      current: function () { return cur; },
      count: function (tid, n) { var c = $('[data-cnt="' + tid + '"]', h); if (c) c.textContent = n > 0 ? n : ''; }
    };
  }

  /* ---------- More menu ---------- */
  var openMenus = [];
  function closeMenus(except) {
    openMenus.forEach(function (m) { if (m !== except) m.close(); });
  }
  /* menu(host, {label:'More', items:[{label,onClick,hidden,disabled}]}) */
  function menu(h, cfg) {
    h = host(h); h.classList.add('menu');
    var mid = id('menu');
    h.innerHTML = '<button class="btn" aria-haspopup="true" aria-expanded="false" aria-controls="' + mid + '">' + esc(cfg.label || 'More') + '</button><ul id="' + mid + '" role="menu" hidden></ul>';
    var btn = $('button', h), ul = $('ul', h), items = cfg.items || [];
    function draw() {
      ul.innerHTML = '';
      items.forEach(function (it, i) {
        if (it.hidden) return;
        var li = el('<li role="none"><button role="menuitem" tabindex="-1">' + esc(it.label) + '</button></li>');
        var b = $('button', li); b.disabled = !!it.disabled;
        b.addEventListener('click', function () { api.close(); btn.focus(); it.onClick && it.onClick(); });
        ul.appendChild(li);
      });
    }
    var api = {
      open: function () { closeMenus(api); draw(); ul.hidden = false; btn.setAttribute('aria-expanded', 'true'); var f = $('button:not([disabled])', ul); if (f) f.focus(); },
      close: function () { ul.hidden = true; btn.setAttribute('aria-expanded', 'false'); },
      setItems: function (list) { items = list; if (!ul.hidden) draw(); }
    };
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (ul.hidden) api.open(); else api.close(); });
    ul.addEventListener('keydown', function (e) {
      var f = $$('button:not([disabled])', ul), i = f.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); f[(i + 1) % f.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); f[(i - 1 + f.length) % f.length].focus(); }
      if (e.key === 'Escape') { e.stopPropagation(); api.close(); btn.focus(); }
      if (e.key === 'Tab') api.close();
    });
    openMenus.push(api);
    return api;
  }
  doc.addEventListener('click', function (e) { if (!e.target.closest('.menu')) closeMenus(); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenus(); if (drawerOpen()) closeDrawer(); } });

  /* ---------- four-stage progress ---------- */
  /* steps(host, ['Add files','Read files','Review','Hand off']) -> {set(index, failed?)} */
  function steps(h, labels) {
    h = host(h); h.classList.add('steps'); h.setAttribute('role', 'list');
    h.innerHTML = labels.map(function (l) { return '<div class="step" role="listitem">' + esc(l) + '</div>'; }).join('');
    return {
      set: function (idx, failed) {
        $$('.step', h).forEach(function (s, i) {
          s.className = 'step' + (i < idx ? ' done' : i === idx ? (failed ? ' fail' : ' cur') : '');
          if (i === idx) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
        });
      }
    };
  }

  /* ---------- found tiles ---------- */
  function tiles(h, items) {
    h = host(h); h.classList.add('tiles');
    h.innerHTML = items.map(function (t) {
      return '<div class="tile"><small>' + esc(t.label) + '</small><b>' + esc(t.value) + '</b>' + (t.note ? '<i>' + esc(t.note) + '</i>' : '') + '</div>';
    }).join('');
  }

  /* ---------- drop zone ---------- */
  /* dropzone(host, {title, hint, accept:'.zip,.pdf,.xlsx', multiple:true, onFiles(FileList[]), extra: html}) */
  function dropzone(h, cfg) {
    h = host(h); h.classList.add('drop');
    var fid = id('file');
    h.innerHTML = '<b>' + esc(cfg.title || 'Drop the files here') + '</b><div class="sm">' + esc(cfg.hint || '') + '</div>' +
      '<div class="row"><label class="btn" for="' + fid + '">Choose files</label><input class="sr" type="file" id="' + fid + '"' +
      (cfg.multiple === false ? '' : ' multiple') + ' accept="' + esc(cfg.accept || '.zip,.pdf,.xlsx,.docx,.csv,.txt') + '">' + (cfg.extra || '') + '</div>';
    var input = $('input', h);
    function take(list) {
      var files = Array.prototype.slice.call(list || []);
      var okExt = (cfg.accept || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
      var bad = okExt.length ? files.filter(function (f) { return !okExt.some(function (x) { return f.name.toLowerCase().slice(-x.length) === x; }); }) : [];
      var good = files.filter(function (f) { return bad.indexOf(f) < 0; });
      if (bad.length) toast(bad.length + ' file' + (bad.length > 1 ? 's' : '') + ' skipped: only ' + okExt.join(', ') + ' can be read.');
      if (good.length && cfg.onFiles) cfg.onFiles(good);
    }
    input.addEventListener('change', function () { take(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { h.addEventListener(t, function (e) { e.preventDefault(); h.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { h.addEventListener(t, function (e) { e.preventDefault(); h.classList.remove('over'); }); });
    h.addEventListener('drop', function (e) { take(e.dataTransfer && e.dataTransfer.files); });
    return { input: input };
  }

  /* ---------- file list ---------- */
  /* fileList(host) -> set([{name, status (Parse_Status or Reading/Waiting), detail, action:{label,onClick}}]) */
  function fileList(h) {
    h = host(h); h.classList.add('list', 'files'); h.setAttribute('aria-live', 'polite');
    return {
      set: function (files) {
        h.innerHTML = '';
        files.forEach(function (f) {
          var li = el('<li><div class="fn"><b>' + esc(f.name) + '</b>' + (f.detail ? '<span>' + esc(f.detail) + '</span>' : '') + '</div>' + parseChip(f.status) + '</li>');
          if (f.action) {
            var b = el('<button class="btn sm">' + esc(f.action.label) + '</button>');
            b.addEventListener('click', f.action.onClick); li.appendChild(b);
          }
          h.appendChild(li);
        });
      }
    };
  }

  /* ---------- Zoho CRM wrapper ---------- */
  /* Only real API names are passed in by each widget; this layer never invents fields.
     Function calls go to standalone functions (button functions cannot be called from a widget). */
  var crm = {
    ready: false, entity: null, entityId: null,
    available: function () { return typeof root.ZOHO !== 'undefined' && root.ZOHO.embeddedApp; },
    init: function () {
      return new Promise(function (resolve) {
        if (!crm.available()) { resolve(null); return; }
        root.ZOHO.embeddedApp.on('PageLoad', function (data) {
          crm.ready = true;
          crm.entity = data && data.Entity;
          crm.entityId = data && (Array.isArray(data.EntityId) ? data.EntityId[0] : data.EntityId);
          resolve(data);
        });
        root.ZOHO.embeddedApp.init();
      });
    },
    coql: function (q) {
      return root.ZOHO.CRM.API.coql({ select_query: q }).then(function (r) { return (r && r.data) || []; });
    },
    getRecord: function (entity, rid) {
      return root.ZOHO.CRM.API.getRecord({ Entity: entity, RecordID: rid }).then(function (r) { return r && r.data && r.data[0]; });
    },
    /* triggers: [] by default (no workflows). Pass ['workflow'] where an existing workflow must recalculate, e.g. the cost check. */
    update: function (entity, data, triggers) {
      return root.ZOHO.CRM.API.updateRecord({ Entity: entity, APIData: data, Trigger: triggers || [] }).then(function (r) {
        var d = r && r.data && r.data[0];
        if (!d || d.code !== 'SUCCESS') throw new Error((d && d.message) || 'Update failed');
        return d;
      });
    },
    attachments: function (entity, rid) {
      return root.ZOHO.CRM.API.getRelatedRecords({ Entity: entity, RecordID: rid, RelatedList: 'Attachments' }).then(function (r) { return (r && r.data) || []; });
    },
    attach: function (entity, rid, file) {
      return root.ZOHO.CRM.API.attachFile({ Entity: entity, RecordID: rid, File: { Name: file.name, Content: file } });
    },
    run: function (fnName, args) {
      return root.ZOHO.CRM.FUNCTIONS.execute(fnName, { arguments: JSON.stringify(args || {}) }).then(function (r) {
        var out = r && r.details && r.details.output;
        try { return JSON.parse(out); } catch (e) { return out; }
      });
    },
    resize: function (height, width) {
      if (crm.available() && root.ZOHO.CRM.UI && root.ZOHO.CRM.UI.Resize) return root.ZOHO.CRM.UI.Resize({ height: String(height), width: String(width || 1000) });
    },
    /* poll(fn, {every:ms, until(result)->bool, max:ms}) — for watching Ingest_Status / Parse_Status after a pipeline call */
    poll: function (fn, o) {
      o = o || {}; var every = o.every || 4000, max = o.max || 10 * 60 * 1000, t0 = Date.now();
      return new Promise(function (resolve, reject) {
        (function tick() {
          Promise.resolve(fn()).then(function (r) {
            if (o.onTick) o.onTick(r);
            if (!o.until || o.until(r)) return resolve(r);
            if (Date.now() - t0 > max) return reject(new Error('Still running after ' + Math.round(max / 60000) + ' minutes'));
            setTimeout(tick, every);
          }, reject);
        })();
      });
    }
  };

  root.JPK = {
    version: VERSION,
    $: $, $$: $$, esc: esc, money: money, fmtDate: fmtDate, el: el, flash: flash,
    toast: toast,
    drawer: { open: openDrawer, close: closeDrawer, isOpen: drawerOpen },
    about: about, aboutButton: aboutButton,
    chip: chip, parseChip: parseChip, ingestChip: ingestChip,
    table: table, chart: chart, next: next, tabs: tabs, menu: menu,
    steps: steps, tiles: tiles, dropzone: dropzone, fileList: fileList,
    crm: crm
  };
})(window);
