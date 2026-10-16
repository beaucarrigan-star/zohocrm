/* JusticePoint widget kit: jpk.js v1.2.0. One IIFE, exposes window.JPK. No dependencies, no network, no AI calls.
   Works standalone in a browser; JPK.crm is guarded so the Zoho SDK is optional.
   Changes from kit v1.0.0 (kit.js): JPK.zoho -> JPK.crm (fn -> run; coql added; coqlAll pages over coql),
   JPK.nextStep -> JPK.next, JPK.about -> JPK.aboutButton. No aliases: an old call fails loudly.
   Changes in v1.2.0 (wave A patterns, all default off; load jpk-patterns-v3.css after jpk-theme-v3.css):
   JPK.table gains options select, expand, cards; new JPK.workList, ownerStrip, roleList, taskList, checkAnswers, field,
   errorSummary; pure logic is exposed as JPK.model so it can be tested without a browser. Nothing here writes to Zoho:
   every action is a callback the widget supplies. */
(function () {
  'use strict';

  /* In node (model tests) there is no DOM: a stub keeps the module-level listeners harmless. */
  var doc = typeof document !== 'undefined' ? document : { addEventListener: function () {}, querySelector: function () { return null; } };
  var uidN = 0;
  function uid(p) { uidN += 1; return (p || 'jpk') + '-' + uidN; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(target) {
    if (!target) return null;
    return typeof target === 'string' ? doc.querySelector(target) : target;
  }
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function toNode(x) {
    if (x && x.nodeType) return x;
    var t = doc.createElement('template');
    t.innerHTML = String(x == null ? '' : x);
    return t.content;
  }
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function focusables(root) {
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter(function (n) {
      return !n.hidden && n.offsetParent !== null || n === doc.activeElement;
    });
  }

  /* ---------------- toast ---------------- */
  var toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.id = 'jpk-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = String(msg);
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2800);
  }

  /* ---------------- drawer ---------------- */
  var dr = null, lastFocus = null;
  function buildDrawer() {
    var root = doc.createElement('div');
    root.className = 'jpk-dr';
    root.hidden = true;
    root.innerHTML = '<div class="scrim"></div>' +
      '<aside role="dialog" aria-modal="true" aria-labelledby="jpk-dr-t" tabindex="-1">' +
      '<header><h3 id="jpk-dr-t"></h3><button type="button" class="iconbtn" id="jpk-dr-x" aria-label="Close">&times;</button></header>' +
      '<div class="jpk-dr-b"></div></aside>';
    doc.body.appendChild(root);
    dr = {
      root: root,
      aside: root.querySelector('aside'),
      title: root.querySelector('#jpk-dr-t'),
      body: root.querySelector('.jpk-dr-b'),
      x: root.querySelector('#jpk-dr-x')
    };
    dr.x.addEventListener('click', closeDrawer);
    root.querySelector('.scrim').addEventListener('click', closeDrawer);
    doc.addEventListener('keydown', function (e) {
      if (!dr || dr.root.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
      if (e.key === 'Tab') {
        var f = focusables(dr.aside);
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1], a = doc.activeElement;
        if (!dr.aside.contains(a)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
      }
    });
    doc.addEventListener('focusin', function (e) {
      if (dr && !dr.root.hidden && !dr.aside.contains(e.target)) dr.x.focus();
    });
  }
  function openDrawer(o) {
    o = o || {};
    if (!dr) buildDrawer();
    if (dr.root.hidden) lastFocus = doc.activeElement;
    dr.title.textContent = o.title || '';
    dr.body.innerHTML = '';
    if (o.node) dr.body.appendChild(o.node);
    else dr.body.appendChild(toNode(o.html));
    dr.root.hidden = false;
    dr.aside.scrollTop = 0;
    dr.x.focus();
    if (typeof o.onMount === 'function') o.onMount(dr.body);
    return dr.body;
  }
  function closeDrawer() {
    if (!dr || dr.root.hidden) return;
    dr.root.hidden = true;
    dr.body.innerHTML = '';
    var f = lastFocus; lastFocus = null;
    if (f && f.focus && doc.contains(f)) { try { f.focus(); } catch (e) { /* ignore */ } }
  }
  var drawer = { open: openDrawer, close: closeDrawer, isOpen: function () { return !!dr && !dr.root.hidden; } };

  /* ---------------- chip ---------------- */
  var TONES = { good: 1, warn: 1, bad: 1, info: 1, neutral: 1 };
  function chip(text, tone) {
    var t = TONES[tone] && tone !== 'neutral' ? ' ' + tone : '';
    return '<span class="chip' + t + '">' + esc(text) + '</span>';
  }
  chip.el = function (text, tone) {
    var t = doc.createElement('template');
    t.innerHTML = chip(text, tone);
    return t.content.firstChild;
  };

  /* ---------------- flash ---------------- */
  function flash(node) {
    node = el(node);
    if (!node || reduced()) return;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  /* ---------------- table ---------------- */
  function table(o) {
    var mount = el(o.mount);
    var cols = o.columns || [];
    var filters = (o.filters || []).slice();
    var hasAll = filters.some(function (f) { return f.key === 'all'; });
    if (filters.length && !hasAll) filters.unshift({ key: 'all', label: 'All', test: function () { return true; } });
    var state = { rows: (o.rows || []).slice(), sortKey: null, dir: 1, filter: o.filter || (filters.length ? filters[0].key : null) };
    var empty = o.empty || { title: 'Nothing here', hint: '' };
    /* v1.2.0 options, all off unless asked for. select.allowed must be true (the widget passes the Admin check). */
    var sel = o.select && o.select.allowed ? o.select : null;
    var exp = typeof o.expand === 'function' ? o.expand : null;
    var picked = {}, opened = {}, lastList = [];
    function keyOf(r, i) { return sel && sel.rowId ? String(sel.rowId(r)) : String(i); }
    function narrow() { try { return !!(window.matchMedia && window.matchMedia('(max-width:700px)').matches); } catch (e) { return false; } }

    mount.innerHTML = '';
    var pills = null;
    if (filters.length) {
      pills = doc.createElement('div');
      pills.className = 'row';
      pills.style.marginBottom = '10px';
      pills.setAttribute('role', 'group');
      pills.setAttribute('aria-label', o.filterLabel || 'Filter');
      mount.appendChild(pills);
      pills.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-f]');
        if (b) setFilter(b.getAttribute('data-f'));
      });
    }
    var bar = null;
    if (sel) {
      bar = doc.createElement('div'); bar.className = 'jp-batch'; bar.hidden = true;
      bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Actions for selected rows');
      bar.innerHTML = '<b class="jp-count" aria-live="polite"></b><span class="jp-sum"></span><span class="jp-acts"></span><button type="button" class="btn sm jp-cancel">Cancel</button>';
      mount.appendChild(bar);
      var acts = bar.querySelector('.jp-acts');
      (sel.actions || []).forEach(function (a, ai) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = a.label; b.setAttribute('data-act', ai);
        acts.appendChild(b);
      });
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.classList.contains('jp-cancel')) { clearSel(); return; }
        var ai = b.getAttribute('data-act');
        if (ai != null && sel.actions[+ai] && typeof sel.actions[+ai].onClick === 'function') sel.actions[+ai].onClick(selectedRows(), api);
      });
    }
    var tw = doc.createElement('div'); tw.className = 'tw'; mount.appendChild(tw);
    var emptyEl = doc.createElement('div'); emptyEl.className = 'empty'; emptyEl.hidden = true; mount.appendChild(emptyEl);

    var tbl = doc.createElement('table');
    if (o.cards) tbl.className = 'jp-cards';
    if (o.caption) { var cap = doc.createElement('caption'); cap.className = 'sr'; cap.textContent = o.caption; tbl.appendChild(cap); }
    var thead = doc.createElement('thead'), tbody = doc.createElement('tbody');
    tbl.appendChild(thead); tbl.appendChild(tbody); tw.appendChild(tbl);

    var tr = doc.createElement('tr');
    if (sel) {
      var thc = doc.createElement('th'); thc.className = 'jp-cb'; thc.scope = 'col';
      thc.innerHTML = '<label class="jp-ck"><input type="checkbox" class="ck jp-all" aria-label="Select all rows"><span class="jp-allt" aria-hidden="true">Select all</span></label>';
      tr.appendChild(thc);
    }
    if (exp) {
      var thx = doc.createElement('th'); thx.className = 'jp-cx'; thx.scope = 'col';
      thx.innerHTML = '<span class="sr">Details</span>';
      tr.appendChild(thx);
    }
    cols.forEach(function (c) {
      var th = doc.createElement('th');
      th.scope = 'col';
      var cls = [];
      if (c.align === 'right') cls.push('r'); else if (c.align === 'center') cls.push('c');
      if (c.sortable) { cls.push('sort'); th.setAttribute('aria-sort', 'none'); }
      th.className = cls.join(' ');
      th.setAttribute('data-k', c.key);
      if (c.sortable) {
        var b = doc.createElement('button'); b.type = 'button'; b.textContent = c.label; th.appendChild(b);
      } else th.textContent = c.label;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    thead.addEventListener('change', function (e) {
      if (!e.target.classList.contains('jp-all')) return;
      lastList.forEach(function (x) { if (e.target.checked) picked[keyOf(x.r, x.i)] = true; else delete picked[keyOf(x.r, x.i)]; });
      render();
    });
    thead.addEventListener('click', function (e) {
      var th = e.target.closest('th.sort');
      if (!th) return;
      var k = th.getAttribute('data-k');
      state.dir = state.sortKey === k ? -state.dir : 1;
      state.sortKey = k;
      render();
      var again = thead.querySelector('th[data-k="' + k + '"] button');
      if (again) again.focus();
    });

    function colFor(k) { for (var i = 0; i < cols.length; i++) if (cols[i].key === k) return cols[i]; return null; }
    function val(c, row) { return c.sortValue ? c.sortValue(row) : row[c.key]; }
    function visibleRows() {
      var f = null;
      for (var i = 0; i < filters.length; i++) if (filters[i].key === state.filter) f = filters[i];
      var list = state.rows.map(function (r, i) { return { r: r, i: i }; });
      if (f && f.test) list = list.filter(function (x) { return f.test(x.r); });
      if (state.sortKey) {
        var c = colFor(state.sortKey), d = state.dir;
        list.sort(function (a, b) {
          var x = val(c, a.r), y = val(c, b.r);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          if (typeof x === 'number' && typeof y === 'number') return d * (x - y);
          return d * String(x).localeCompare(String(y), undefined, { numeric: true });
        });
      }
      return list;
    }
    function cell(c, row) {
      var td = doc.createElement('td');
      var cls = [];
      if (c.align === 'right') cls.push('r'); else if (c.align === 'center') cls.push('c');
      if (c.num) cls.push('num');
      td.className = cls.join(' ');
      if (o.cards) { td.setAttribute('data-label', c.label); if (c.primary) td.className += ' jp-pri'; if (c.full) td.className += ' jp-full'; }
      var v = c.render ? c.render(row) : esc(row[c.key]);
      if (v && v.nodeType) td.appendChild(v); else td.innerHTML = v == null ? '' : String(v);
      return td;
    }
    function render() {
      var list = visibleRows();
      tbody.innerHTML = '';
      lastList = list;
      var keep = {};
      state.rows.forEach(function (r, i) { keep[keyOf(r, i)] = true; });
      Object.keys(picked).forEach(function (k) { if (!keep[k]) delete picked[k]; });
      list.forEach(function (x) {
        var r = doc.createElement('tr'), key = keyOf(x.r, x.i);
        r.setAttribute('data-i', x.i);
        var rc = [];
        if (o.onRowClick) { rc.push('click'); r.tabIndex = 0; }
        if (sel || exp) rc.push('jp-row');
        r.className = rc.join(' ');
        if (sel) {
          r.setAttribute('aria-selected', picked[key] ? 'true' : 'false');
          var tdc = doc.createElement('td'); tdc.className = 'jp-cb';
          tdc.innerHTML = '<label class="jp-ck"><input type="checkbox" class="ck rk"' + (picked[key] ? ' checked' : '') + ' aria-label="' + esc(sel.label ? sel.label(x.r) : 'Select row') + '"></label>';
          r.appendChild(tdc);
        }
        if (exp) {
          var tdx = doc.createElement('td'); tdx.className = 'jp-cx';
          var did = uid('jpk-detail');
          tdx.innerHTML = '<button type="button" class="jp-chev" aria-expanded="' + (!!opened[key]) + '" aria-controls="' + did + '" aria-label="' + esc(o.expandLabel ? o.expandLabel(x.r) : 'Show details') + '"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
          r.appendChild(tdx);
          r.setAttribute('data-detail', did);
        }
        cols.forEach(function (c) { r.appendChild(cell(c, x.r)); });
        tbody.appendChild(r);
        if (exp) {
          var dr2 = doc.createElement('tr'); dr2.className = 'jp-detail'; dr2.id = r.getAttribute('data-detail'); dr2.hidden = !opened[key];
          var dtd = doc.createElement('td'); dtd.colSpan = cols.length + (sel ? 1 : 0) + 1;
          dr2.appendChild(dtd); tbody.appendChild(dr2);
          if (opened[key]) fillDetail(dr2, x.r);
        }
      });
      refreshSel();
      var none = list.length === 0;
      tw.hidden = none; emptyEl.hidden = !none;
      emptyEl.innerHTML = '<b>' + esc(empty.title || 'Nothing here') + '</b>' + (empty.hint ? esc(empty.hint) : '');
      Array.prototype.forEach.call(thead.querySelectorAll('th.sort'), function (th) {
        var k = th.getAttribute('data-k');
        th.setAttribute('aria-sort', k === state.sortKey ? (state.dir > 0 ? 'ascending' : 'descending') : 'none');
      });
      if (pills) {
        pills.innerHTML = filters.map(function (f) {
          return '<button type="button" class="pill" data-f="' + esc(f.key) + '" aria-pressed="' + (f.key === state.filter) + '">' + esc(f.label) + '</button>';
        }).join('');
      }
    }
    function fillDetail(dr2, row) {
      var td = dr2.firstChild;
      if (td.firstChild) return;
      var v = exp(row);
      if (v && v.nodeType) td.appendChild(v); else td.innerHTML = v == null ? '' : String(v);
    }
    function setOpen(trEl, on) {
      var i = +trEl.getAttribute('data-i'), key = keyOf(state.rows[i], i);
      var dr2 = doc.getElementById(trEl.getAttribute('data-detail')), b = trEl.querySelector('.jp-chev');
      if (on) opened[key] = true; else delete opened[key];
      if (b) b.setAttribute('aria-expanded', String(!!on));
      if (dr2) { if (on) fillDetail(dr2, state.rows[i]); dr2.hidden = !on; }
    }
    function selectedRows() {
      var out = [];
      state.rows.forEach(function (r, i) { if (picked[keyOf(r, i)]) out.push(r); });
      return out;
    }
    function refreshSel() {
      if (!sel) return;
      var rows = selectedRows(), m = model.selectionSummary(rows, sel.sum, sel.noun, sel.format);
      bar.hidden = rows.length === 0;
      bar.querySelector('.jp-count').textContent = rows.length ? m.text : '';
      bar.querySelector('.jp-sum').textContent = rows.length && sel.sum ? (sel.sumLabel ? sel.sumLabel + ' ' : '') + m.sumText : '';
      if (sel.toolbar) { var tb = el(sel.toolbar); if (tb) tb.hidden = rows.length > 0; }
      var all = thead.querySelector('.jp-all');
      if (all) {
        var n = lastList.filter(function (x) { return picked[keyOf(x.r, x.i)]; }).length;
        all.checked = lastList.length > 0 && n === lastList.length;
        all.indeterminate = n > 0 && n < lastList.length;
      }
    }
    function clearSel() { picked = {}; render(); }
    if (sel || exp) {
      tbody.addEventListener('change', function (e) {
        if (!e.target.classList.contains('rk')) return;
        var t = e.target.closest('tr[data-i]'), i = +t.getAttribute('data-i'), key = keyOf(state.rows[i], i);
        if (e.target.checked) picked[key] = true; else delete picked[key];
        t.setAttribute('aria-selected', e.target.checked ? 'true' : 'false');
        refreshSel();
      });
      tbody.addEventListener('click', function (e) {
        var ch = e.target.closest('.jp-chev');
        var t = e.target.closest('tr.jp-row');
        if (ch && t) { setOpen(t, ch.getAttribute('aria-expanded') !== 'true'); return; }
        /* whole row opens on a phone */
        if (exp && t && narrow() && !e.target.closest('a,button,input,select,textarea,label')) setOpen(t, !opened[keyOf(state.rows[+t.getAttribute('data-i')], +t.getAttribute('data-i'))]);
      });
    }
    function activate(e, tr) {
      var i = +tr.getAttribute('data-i');
      o.onRowClick(state.rows[i], i, e);
    }
    if (o.onRowClick) {
      tbody.addEventListener('click', function (e) {
        var ctl = e.target.closest('a,button,input,select,textarea,label.jp-ck');
        if (ctl && !ctl.hasAttribute('data-row')) return;
        var t = e.target.closest('tr[data-i]'); if (t) activate(e, t);
      });
      tbody.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        var t = e.target.closest('tr[data-i]');
        if (!t || e.target !== t) return;
        e.preventDefault(); activate(e, t);
      });
    }
    function setRows(rows) { state.rows = (rows || []).slice(); render(); }
    function setFilter(k) { state.filter = k; render(); }
    var api = {
      setRows: setRows, setFilter: setFilter, el: tbl, getFilter: function () { return state.filter; },
      getSelected: selectedRows, clearSelection: clearSel,
      expand: function (i, on) { var t = tbody.querySelector('tr.jp-row[data-i="' + i + '"]'); if (t) setOpen(t, on !== false); },
      isOpen: function (i) { return !!opened[keyOf(state.rows[i], i)]; }
    };
    render();
    return api;
  }

  /* ---------------- chart ---------------- */
  function niceNum(r) {
    var e = Math.floor(Math.log(r) / Math.LN10), f = r / Math.pow(10, e);
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return n * Math.pow(10, e);
  }
  function chart(o) {
    var mount = el(o.mount);
    mount.classList.add('chartwrap');
    var series = (o.series || []).slice();
    var thr = o.threshold ? { value: o.threshold.value, label: o.threshold.label || '' } : null;
    var yFormat = o.yFormat || function (v) { return String(Math.round(v * 10) / 10); };
    var H = o.height || 180;
    var COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
    var cur = null, W = 0, geo = null, ro = null;
    var ids = { live: uid('jpk-live') };

    function ptsOf(s) { return (s && s.points) || []; }
    function base() { return ptsOf(series[0]); }
    function labelOf(p) { return p.label != null ? p.label : String(p.x); }

    function draw() {
      var hadFocus = mount.querySelector('svg') && doc.activeElement === mount.querySelector('svg');
      W = Math.floor(mount.clientWidth);
      if (!W) return;
      W = Math.max(240, W);
      var pts0 = base(), n = pts0.length;
      var all = [];
      series.forEach(function (s) { ptsOf(s).forEach(function (p) { if (p.y != null && isFinite(p.y)) all.push(p.y); }); });
      if (thr && isFinite(thr.value)) all.push(thr.value);
      if (!all.length) { mount.innerHTML = '<div class="empty"><b>No data</b></div>'; return; }
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      if (o.yMin != null) lo = o.yMin; else if (lo >= 0 && lo < hi * 0.4) lo = 0; else lo -= (hi - lo) * 0.08;
      if (o.yMax != null) hi = o.yMax;
      if (hi <= lo) hi = lo + 1;
      var step = niceNum((hi - lo) / 4);
      var ymin = o.yMin != null ? lo : Math.floor(lo / step) * step;
      var ymax = o.yMax != null ? hi : Math.ceil(hi / step) * step;
      var ticks = []; for (var tv = ymin; tv <= ymax + step / 1000; tv += step) ticks.push(tv);
      var maxLab = ticks.reduce(function (m, v) { return Math.max(m, String(yFormat(v)).length); }, 1);
      var L = Math.min(80, Math.max(34, maxLab * 6 + 12)), R = 12, T = 14, B = 24;
      var linear = n > 1 && pts0.every(function (p, i) { return typeof p.x === 'number' && isFinite(p.x) && (i === 0 || p.x > pts0[i - 1].x); });
      var x0 = linear ? pts0[0].x : 0, x1 = linear ? pts0[n - 1].x : Math.max(1, n - 1);
      function X(p, i) { if (n < 2) return L + (W - L - R) / 2; return L + (W - L - R) * ((linear ? p.x : i) - x0) / (x1 - x0); }
      function Y(v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); }
      geo = { L: L, R: R, T: T, B: B, X: X, Y: Y, n: n };

      var out = '';
      ticks.forEach(function (v) {
        var y = Y(v);
        out += '<line class="grid-l" x1="' + L + '" x2="' + (W - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/><text x="' + (L - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + esc(yFormat(v)) + '</text>';
      });
      if (n) {
        var tk = n === 1 ? [0] : [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
        tk = tk.filter(function (v, i, a) { return a.indexOf(v) === i; });
        tk.forEach(function (i, j) {
          var anchor = j === 0 ? 'start' : (j === tk.length - 1 && tk.length > 1) ? 'end' : 'middle';
          out += '<text x="' + X(pts0[i], i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + anchor + '">' + esc(labelOf(pts0[i])) + '</text>';
        });
      }
      series.forEach(function (s, si) {
        var col = s.color || COLORS[si % COLORS.length], p = ptsOf(s);
        var segs = [], run = [];
        p.forEach(function (q, i) { if (q.y == null || !isFinite(q.y)) { if (run.length) segs.push(run); run = []; } else run.push([X(q, i), Y(q.y)]); });
        if (run.length) segs.push(run);
        segs.forEach(function (sg) {
          var d = sg.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' ');
          if (sg.length > 1) out += '<path d="' + d + ' L' + sg[sg.length - 1][0].toFixed(1) + ' ' + Y(ymin).toFixed(1) + ' L' + sg[0][0].toFixed(1) + ' ' + Y(ymin).toFixed(1) + ' Z" fill="' + col + '" opacity=".09"/>';
          out += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
          var last = sg[sg.length - 1];
          out += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4" fill="' + col + '"/>';
        });
      });
      if (thr && isFinite(thr.value)) {
        var hy = Y(thr.value);
        out += '<line class="thr" x1="' + L + '" x2="' + (W - R) + '" y1="' + hy.toFixed(1) + '" y2="' + hy.toFixed(1) + '"/>' +
          '<text class="thr-l" x="' + (W - R) + '" y="' + (hy - 4).toFixed(1) + '" text-anchor="end">' + esc(thr.label || '') + '</text>';
      }
      var name = o.ariaLabel || ('Line chart of ' + series.map(function (s) { return s.name; }).join(', '));
      mount.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" tabindex="0" aria-label="' + esc(name + '. Use left and right arrow keys to read values.') + '" aria-describedby="' + ids.live + '">' + out +
        '<line class="cross" y1="' + T + '" y2="' + (H - B) + '" x1="0" x2="0" style="display:none"/>' +
        '<rect class="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '" fill="transparent" style="touch-action:pan-y"/></svg>' +
        '<div class="tip" hidden></div><div class="sr" id="' + ids.live + '" aria-live="polite"></div>' +
        (series.length > 1 ? '<div class="legend">' + series.map(function (s, si) { return '<span><i style="background:' + (s.color || COLORS[si % COLORS.length]) + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '');
      wire();
      if (cur != null && cur < n) show(cur, false);
      if (hadFocus) { var sv = mount.querySelector('svg'); if (sv) sv.focus(); }
    }

    var svg, hit, cr, tip, live;
    function wire() {
      svg = mount.querySelector('svg'); hit = mount.querySelector('.hit'); cr = mount.querySelector('.cross');
      tip = mount.querySelector('.tip'); live = mount.querySelector('.sr');
      hit.addEventListener('pointermove', function (e) { show(idxAt(e.clientX), false); });
      hit.addEventListener('pointerdown', function (e) { show(idxAt(e.clientX), false); });
      hit.addEventListener('pointerleave', function () { if (doc.activeElement !== svg) hide(); });
      svg.addEventListener('focus', function () { if (cur == null || cur >= geo.n) cur = geo.n - 1; show(cur, true); });
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', function (e) {
        var n = geo.n; if (!n) return;
        var i = cur == null ? n - 1 : cur;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = n - 1;
        else if (e.key === 'Escape') { hide(); return; }
        else return;
        e.preventDefault(); show(i, true);
      });
    }
    function idxAt(clientX) {
      var r = hit.getBoundingClientRect(), n = geo.n, pts0 = base();
      var px = clientX - r.left + geo.L, best = 0, bd = Infinity;
      for (var i = 0; i < n; i++) { var d = Math.abs(geo.X(pts0[i], i) - px); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function pointFor(s, idx) {
      var p0 = base()[idx], ps = ptsOf(s);
      if (ps[idx] && ps[idx].x === p0.x) return ps[idx];
      var best = null, bd = Infinity;
      ps.forEach(function (q) { var d = Math.abs((+q.x) - (+p0.x)); if (d < bd) { bd = d; best = q; } });
      return best;
    }
    function show(idx, announce) {
      if (!geo || !geo.n || !cr) return;
      cur = idx;
      var p0 = base()[idx], px = geo.X(p0, idx);
      cr.setAttribute('x1', px); cr.setAttribute('x2', px); cr.style.display = '';
      var parts = series.map(function (s) {
        var p = pointFor(s, idx);
        return esc(s.name) + ' ' + (p && p.y != null ? esc(yFormat(p.y)) : 'no data');
      });
      tip.innerHTML = '<b>' + esc(labelOf(p0)) + '</b> ' + parts.join(' &middot; ');
      tip.hidden = false;
      var tw = tip.offsetWidth, wd = mount.clientWidth;
      tip.style.left = Math.max(0, Math.min(wd - tw, px - tw / 2)) + 'px';
      if (announce) live.textContent = tip.textContent;
    }
    function hide() { if (cr) cr.style.display = 'none'; if (tip) tip.hidden = true; }

    draw();
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { if (Math.floor(mount.clientWidth) !== W) draw(); }); ro.observe(mount); }
    else window.addEventListener('resize', draw);

    return {
      setThreshold: function (v, label) {
        if (thr) { thr.value = +v; if (label != null) thr.label = label; }
        else thr = { value: +v, label: label || '' };
        draw();
      },
      setSeries: function (s) { series = (s || []).slice(); cur = null; draw(); },
      redraw: draw,
      destroy: function () { if (ro) ro.disconnect(); else window.removeEventListener('resize', draw); mount.innerHTML = ''; }
    };
  }

  /* ---------------- next (was nextStep) ---------------- */
  function next(o) {
    var mount = el(o.mount);
    var cfg = o;
    mount.classList.add('next');
    function render() {
      var b = cfg.button;
      var html = '<div class="nt"><b>' + esc(cfg.title) + '</b>' + (cfg.sub ? '<span>' + esc(cfg.sub) + '</span>' : '');
      if (cfg.progress != null) {
        var pct = Math.max(0, Math.min(100, +cfg.progress));
        html += '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="Progress"><i style="width:' + pct + '%"></i></div>';
      }
      html += '</div>';
      if (b) {
        var why = b.disabled && b.why ? uid('jpk-why') : '';
        html += '<div class="nx-act"><button type="button" class="btn pri" data-nx' + (b.disabled ? ' disabled' : '') + (why ? ' aria-describedby="' + why + '"' : '') + '>' + esc(b.label) + '</button>' +
          (why ? '<span class="why-off" id="' + why + '">' + esc(b.why) + '</span>' : '') + '</div>';
      }
      mount.innerHTML = html;
      var btn = mount.querySelector('[data-nx]');
      if (btn && b && typeof b.onClick === 'function') btn.addEventListener('click', function () { if (!b.disabled) b.onClick(); });
    }
    render();
    return { update: function (patch) { for (var k in patch) cfg[k] = patch[k]; render(); } };
  }

  /* ---------------- tabs ---------------- */
  function tabs(o) {
    var mount = el(o.mount), list = (o.tabs || []).map(function (t) { return { id: t.id, label: t.label, count: t.count || 0 }; });
    var base = uid('jpk-tabs'), sel = o.selected || (list[0] && list[0].id);
    mount.classList.add('ctabs');
    mount.setAttribute('role', 'tablist');
    if (o.label) mount.setAttribute('aria-label', o.label);
    function tabId(id) { return base + '-t-' + id; }
    function panelId(id) { return base + '-p-' + id; }
    function panelFor(id) {
      var p = o.panels && o.panels[id];
      if (p) return el(p);
      var scope = mount.parentNode || doc;
      return scope.querySelector('[data-pane="' + id + '"]');
    }
    function render() {
      mount.innerHTML = list.map(function (t) {
        var on = t.id === sel;
        return '<button type="button" role="tab" id="' + tabId(t.id) + '" data-id="' + esc(t.id) + '" aria-selected="' + on + '" aria-controls="' + panelId(t.id) + '" tabindex="' + (on ? 0 : -1) + '">' +
          esc(t.label) + '<span class="cnt" data-cnt' + (t.count > 0 ? '' : ' hidden') + '>' + (t.count > 0 ? t.count : '') + '</span></button>';
      }).join('');
      list.forEach(function (t) {
        var p = panelFor(t.id); if (!p) return;
        p.id = panelId(t.id); p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', tabId(t.id));
        p.classList.toggle('on', t.id === sel); p.hidden = t.id !== sel;
      });
    }
    function select(id, focus, silent) {
      if (!list.some(function (t) { return t.id === id; })) return;
      var changed = id !== sel; sel = id; render();
      if (focus) mount.querySelector('[role=tab][aria-selected=true]').focus();
      if (changed && !silent && o.onChange) o.onChange(id);
    }
    mount.addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (b) select(b.getAttribute('data-id'), false); });
    mount.addEventListener('keydown', function (e) {
      var b = e.target.closest('[role=tab]'); if (!b) return;
      var i = list.map(function (t) { return t.id; }).indexOf(b.getAttribute('data-id')), n = list.length, j = i;
      if (e.key === 'ArrowRight') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      else return;
      e.preventDefault(); select(list[j].id, true);
    });
    render();
    return {
      select: function (id) { select(id, false); },
      selected: function () { return sel; },
      setCount: function (id, n) {
        list.forEach(function (t) { if (t.id === id) t.count = +n || 0; });
        var b = mount.querySelector('[data-id="' + id + '"] .cnt');
        if (b) { b.textContent = n > 0 ? n : ''; b.hidden = !(n > 0); }
      }
    };
  }

  /* ---------------- menu ---------------- */
  var openMenus = [];
  doc.addEventListener('click', function (e) {
    openMenus.slice().forEach(function (m) { if (!m.wrap.contains(e.target)) m.close(false); });
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') openMenus.slice().forEach(function (m) { m.close(true); });
  });
  function menu(o) {
    var btn = el(o.button), items = (o.items || []).slice();
    var wrap = btn.parentNode;
    if (!wrap.classList.contains('menu')) {
      wrap = doc.createElement('div'); wrap.className = 'menu';
      btn.parentNode.insertBefore(wrap, btn); wrap.appendChild(btn);
    }
    var ul = doc.createElement('ul'); ul.hidden = true; ul.setAttribute('role', 'menu');
    var lid = uid('jpk-menu'); ul.id = lid;
    wrap.appendChild(ul);
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', lid);
    var api = { wrap: wrap, close: close, open: open };

    function shown() { return items.filter(function (it) { return !(typeof it.hidden === 'function' ? it.hidden() : it.hidden); }); }
    function build() {
      ul.innerHTML = '';
      shown().forEach(function (it) {
        var li = doc.createElement('li'); li.setAttribute('role', 'none');
        var b = doc.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.tabIndex = -1; b.textContent = it.label;
        b.addEventListener('click', function () {
          close(true);
          if (typeof it.onClick === 'function') it.onClick();
        });
        li.appendChild(b); ul.appendChild(li);
      });
    }
    function btns() { return Array.prototype.slice.call(ul.querySelectorAll('button')); }
    function open() {
      openMenus.slice().forEach(function (m) { if (m !== api) m.close(false); });
      build();
      if (!ul.children.length) return;
      ul.hidden = false; btn.setAttribute('aria-expanded', 'true');
      if (openMenus.indexOf(api) < 0) openMenus.push(api);
      btns()[0].focus();
    }
    function close(refocus) {
      if (ul.hidden) return;
      ul.hidden = true; btn.setAttribute('aria-expanded', 'false');
      var i = openMenus.indexOf(api); if (i >= 0) openMenus.splice(i, 1);
      if (refocus) btn.focus();
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (ul.hidden) open(); else close(false); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (ul.hidden) open(); }
    });
    ul.addEventListener('keydown', function (e) {
      var b = btns(), i = b.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); b[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); b[b.length - 1].focus(); }
      else if (e.key === 'Tab') close(false);
    });
    api.setItems = function (it) { items = (it || []).slice(); if (!ul.hidden) build(); };
    return api;
  }

  /* ---------------- aboutButton (was about) ---------------- */
  /* Wires a button to open the drawer with help text. Returns {setHtml} so a widget can update the text later. */
  function aboutButton(o) {
    var btn = el(o.button), cfg = { title: o.title || 'About this widget', html: o.html || '' };
    if (!btn) return { setHtml: function () {} };
    if (!btn.getAttribute('aria-label') && !btn.textContent.trim()) btn.setAttribute('aria-label', cfg.title);
    btn.addEventListener('click', function () { openDrawer({ title: cfg.title, html: cfg.html }); });
    return { setHtml: function (h) { cfg.html = h || ''; } };
  }

  /* ---------------- steps ---------------- */
  var DEFAULT_STEPS = ['Add files', 'Read files', 'Review', 'Hand off'];
  function steps(o) {
    var mount = el(o.mount), labels = o.labels || DEFAULT_STEPS, cur = o.current || 0;
    mount.classList.add('steps');
    mount.setAttribute('role', 'list');
    function render() {
      mount.innerHTML = labels.map(function (l, i) {
        var st = i < cur ? 'done' : i === cur ? 'cur' : '';
        return '<div class="step ' + st + '" role="listitem"' + (st === 'cur' ? ' aria-current="step"' : '') + '>' + esc(l) +
          (st === 'done' ? '<span class="sr"> (done)</span>' : st === 'cur' ? '<span class="sr"> (current step)</span>' : '') + '</div>';
      }).join('');
    }
    render();
    return { set: function (c) { cur = c; render(); }, get: function () { return cur; } };
  }

  /* ---------------- crm (was zoho) ---------------- */
  var initP = null;
  function hasZoho() { return typeof window.ZOHO !== 'undefined' && window.ZOHO && window.ZOHO.embeddedApp; }
  function hasApi(part) { return hasZoho() && window.ZOHO.CRM && window.ZOHO.CRM[part]; }
  function demoErr() { return new Error('Zoho SDK not available (demo mode)'); }
  function zerr(e) {
    var m = '';
    if (e == null) m = 'Unknown error';
    else if (typeof e === 'string') m = e;
    else if (e.message) m = e.message;
    else if (e.data && e.data[0] && e.data[0].message) m = e.data[0].message;
    else if (e.details && e.details.output) m = String(e.details.output);
    else if (e.code) m = String(e.code);
    else { try { m = JSON.stringify(e); } catch (x) { m = 'Unknown error'; } }
    var er = new Error(m); er.raw = e; return er;
  }
  function isNoContent(e) { return !e || e.status === 204 || e.code === 'NO_CONTENT' || e === ''; }
  function stripLimit(q) {
    return String(q).replace(/\s+limit\s+\d+(\s*(,|offset)\s*\d+)?\s*;?\s*$/i, '').replace(/;\s*$/, '');
  }

  var crm = {
    available: function () { return !!hasZoho(); },
    /* Resolves with the PageLoad data, or {demo:true} outside Zoho / on timeout. Safe to call more than once. */
    init: function (opts) {
      if (initP) return initP;
      var timeout = (opts && opts.timeout) || 5000;
      initP = new Promise(function (resolve) {
        if (!hasZoho()) { resolve({ demo: true }); return; }
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; resolve({ demo: true, timeout: true }); } }, timeout);
        try {
          window.ZOHO.embeddedApp.on('PageLoad', function (data) {
            if (done) return; done = true; clearTimeout(t); resolve(data || {});
          });
          window.ZOHO.embeddedApp.init();
        } catch (e) { if (!done) { done = true; clearTimeout(t); resolve({ demo: true, error: String(e && e.message || e) }); } }
      });
      return initP;
    },
    /* One COQL call, query sent as given. Resolves {rows, more}. An empty result (204) is {rows:[], more:false}. */
    coql: function (query) {
      if (!hasApi('API')) return Promise.reject(demoErr());
      return window.ZOHO.CRM.API.coql({ select_query: String(query) }).then(function (res) {
        var rows = (res && res.data) || [];
        return { rows: rows, more: !!(res && res.info && res.info.more_records) };
      }, function (e) {
        if (isNoContent(e)) return { rows: [], more: false };
        throw zerr(e);
      });
    },
    /* Paging helper over coql: pass the query WITHOUT a limit; pages of 200 are appended.
       Count client-side (COQL count / group by do not work on this org). opts.maxPages default 50 (10,000 rows). */
    coqlAll: function (query, opts) {
      var PAGE = 200, maxPages = (opts && opts.maxPages) || 50, q = stripLimit(query), all = [];
      function page(p) {
        return crm.coql(q + ' limit ' + PAGE + ' offset ' + (p * PAGE)).then(function (r) {
          all = all.concat(r.rows);
          if (r.rows.length && (r.rows.length >= PAGE || r.more) && p + 1 < maxPages) return page(p + 1);
          return all;
        });
      }
      return page(0);
    },
    /* Run a standalone function (REST API enabled). Args go as JSON; output is JSON-parsed when it looks like JSON. */
    run: function (name, args) {
      if (!hasApi('FUNCTIONS')) return Promise.reject(demoErr());
      return window.ZOHO.CRM.FUNCTIONS.execute(name, { arguments: JSON.stringify(args || {}) }).then(function (r) {
        if (r && r.code && r.code !== 'success') throw zerr(r.message || r.details || r.code);
        var out = r && r.details ? r.details.output : r;
        if (typeof out === 'string') { try { return JSON.parse(out); } catch (e) { return out; } }
        return out;
      }, function (e) { throw zerr(e); });
    },
    error: zerr
  };

  /* =====================================================================
     Wave A patterns (v1.2.0). Pure logic first (JPK.model, testable in node), then the DOM parts.
     Nothing below writes to Zoho. Actions are callbacks the widget supplies.
     ===================================================================== */
  var model = (function () {
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function day(v) {
      if (v == null || v === '') return null;
      if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    function diff(a, b) { return Math.round((a - b) / 86400000); }
    function fmtDay(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
    function money(n, o) {
      n = +n || 0; o = o || {};
      var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (n < 0 ? '-' : (o.sign && n > 0 ? '+' : '')) + '$' + s;
    }
    function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

    /* ---- permissions (client-side only: they hide controls, Zoho still enforces its own profiles) ---- */
    function canBatch(profile) { var p = norm(profile); return p === 'admin' || p === 'administrator'; }
    /* Decision 16 Oct: Admin only for now. To widen later, add 'emops' and 'bd' here (the plan's original group). */
    function canEditRoles(profile) { var p = norm(profile); return p === 'admin' || p === 'administrator'; }

    /* ---- case due date (decision 16 Oct): due 1 business day after it opened, unless the case is waiting on a vendor or an answer ---- */
    function addBusinessDays(from, n) {
      var d = day(from); if (!d) return null;
      var step = n < 0 ? -1 : 1, left = Math.abs(n);
      while (left > 0) { d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step); var w = d.getDay(); if (w !== 0 && w !== 6) left--; }
      return d;
    }
    var PAUSED = { vendor: 1, customer: 1, internal: 1 };
    /* c: {opened, waitingOn:'Customer'|'Vendor'|'Internal'|'Nobody'|''}. Waiting cases have no due date (clock paused). Holidays are not modelled. */
    function caseDue(c) {
      c = c || {};
      if (PAUSED[norm(c.waitingOn)]) return { due: null, paused: true, reason: 'Waiting on ' + String(c.waitingOn).toLowerCase() };
      var d = addBusinessDays(c.opened, 1);
      return { due: d, dueText: d ? d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) : '', paused: false, reason: '' };
    }

    /* ---- selection ---- */
    function selectionSummary(rows, sumFn, noun, fmt) {
      var n = rows.length, nn = noun || 'line', sum = 0;
      if (typeof sumFn === 'function') rows.forEach(function (r) { sum += +sumFn(r) || 0; });
      return { count: n, sum: sum, text: n + ' ' + nn + (n === 1 ? '' : 's') + ' selected', sumText: (fmt || money)(sum) };
    }

    /* ---- work list ---- */
    var GROUPS = [['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'This week'], ['later', 'Later'], ['nodate', 'No due date'], ['waiting', 'Waiting on someone else']];
    function bucket(item, now) {
      if (item.waiting) return 'waiting';
      var d = day(item.due), t = day(now);
      if (!d) return 'nodate';
      var n = diff(d, t);
      return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 7 ? 'week' : 'later';
    }
    function dueLabel(item, now) {
      var d = day(item.due), t = day(now);
      if (item.waiting) return item.askedOn ? 'Asked ' + fmtDay(day(item.askedOn) || t) : '';
      if (!d) return '';
      var n = diff(d, t);
      return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(d);
    }
    /* opts.unassigned: items nobody owns yet. Off by default (decision pending), so no group appears unless passed. */
    function groupWork(items, now, opts) {
      opts = opts || {};
      var by = {};
      (items || []).forEach(function (it) { var k = bucket(it, now); (by[k] = by[k] || []).push(it); });
      var out = GROUPS.map(function (g) {
        var list = (by[g[0]] || []).slice().sort(function (a, b) {
          var x = day(a.due), y = day(b.due);
          if (x && y && x - y) return x - y;
          if (x && !y) return -1; if (!x && y) return 1;
          return String(a.title).localeCompare(String(b.title));
        });
        return { key: g[0], label: g[1], items: list };
      }).filter(function (g) { return g.items.length; });
      if (opts.unassigned && opts.unassigned.length) out.push({ key: 'unassigned', label: 'Unassigned on my team', items: opts.unassigned.slice() });
      return out;
    }

    /* ---- case strip ---- */
    var CLOSED = { closed: 1, resolved: 1 }, KNOWN_OPEN = { new: 1, acknowledged: 1, inprogress: 1, escalated: 1, onhold: 1, open: 1 };
    /* Acknowledged is not live yet: match by name, anything unknown is "Other open", never dropped. */
    function caseBucket(status) {
      var k = norm(status);
      if (CLOSED[k]) return { open: false, label: String(status) };
      if (KNOWN_OPEN[k]) return { open: true, label: String(status) };
      return { open: true, label: 'Other open', raw: status };
    }
    function ownerState(c, now) {
      c = c || {};
      var assigned = !!(c.owner && (c.owner.name || c.owner.id));
      var d = day(c.due), t = day(now), st = 'none', text = '';
      if (d) { var n = diff(d, t); st = n < 0 ? 'overdue' : n <= 1 ? 'soon' : 'ok'; text = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : (n < 0 ? 'Overdue ' : '') + fmtDay(d); }
      return { assigned: assigned, dueState: st, dueText: text };
    }
    function initials(name) {
      var p = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!p.length) return '?';
      return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
    }

    /* ---- roles ---- */
    function side(r) { var s = norm(r.side); return s === 'internal' || s === 'int' ? 'internal' : 'external'; }
    function groupRoles(roles) {
      var g = { external: [], internal: [] };
      (roles || []).forEach(function (r) { g[side(r)].push(r); });
      return [
        { side: 'external', label: 'At the county', tag: 'External', rows: g.external, gaps: g.external.filter(function (r) { return !r.person; }).length },
        { side: 'internal', label: 'At JusticePoint, Sirona or The Difference Principle', tag: 'Internal', rows: g.internal, gaps: g.internal.filter(function (r) { return !r.person; }).length }
      ].filter(function (x) { return x.rows.length; });
    }

    /* ---- task list ---- */
    function ranges(nums) {
      if (nums.length === 1) return 'Step ' + nums[0] + ' must be complete first';
      var consecutive = nums.length > 2 && nums.every(function (v, i) { return i === 0 || v === nums[i - 1] + 1; });
      return 'Steps ' + (consecutive ? nums[0] + ' to ' + nums[nums.length - 1] : nums.slice(0, -1).join(', ') + ' and ' + nums[nums.length - 1]) + ' must be complete first';
    }
    /* step: {id,label,done,started,needs:[ids] | 'all-before'} */
    function taskStatuses(steps) {
      var byId = {}; steps.forEach(function (s, i) { byId[s.id] = { s: s, n: i + 1 }; });
      var out = steps.map(function (s, i) {
        var needs = s.needs === 'all-before' ? steps.slice(0, i).map(function (x) { return x.id; }) : (s.needs || []);
        var open = needs.filter(function (id) { return byId[id] && !byId[id].s.done; });
        var status = s.done ? 'Completed' : open.length ? 'Cannot start yet' : s.started ? 'In progress' : 'Not started';
        return { id: s.id, n: i + 1, label: s.label, status: status, tone: status === 'Completed' ? 'good' : status === 'In progress' ? 'info' : 'neutral',
          locked: status === 'Cannot start yet', reason: open.length ? ranges(open.map(function (id) { return byId[id].n; })) : '' };
      });
      var done = out.filter(function (x) { return x.status === 'Completed'; }).length;
      return { steps: out, done: done, total: out.length, text: done + ' of ' + out.length + ' steps complete' };
    }

    /* ---- check answers ---- */
    function checkRows(rows) {
      var out = (rows || []).map(function (r) {
        var missing = r.missing != null ? !!r.missing : (r.value == null || String(r.value).trim() === '');
        return { id: r.id, label: r.label, value: missing ? (r.missingText || 'Not provided') : r.value, missing: missing, action: missing ? 'Add' : (r.changeText || 'Change') };
      });
      var miss = out.filter(function (r) { return r.missing; }).length;
      return { rows: out, missing: miss, ready: miss === 0, text: miss ? miss + (miss === 1 ? ' answer is' : ' answers are') + ' missing' : 'All answers are complete' };
    }

    /* ---- field / error summary ---- */
    function fieldState(f) { return f.error ? 'error' : f.ok ? 'ok' : 'default'; }
    function errorList(fields) {
      return (fields || []).filter(function (f) { return f && f.error; }).map(function (f) { return { id: f.id, message: f.error }; });
    }

    return { day: day, fmtDay: fmtDay, money: money, canBatch: canBatch, canEditRoles: canEditRoles, addBusinessDays: addBusinessDays, caseDue: caseDue, selectionSummary: selectionSummary,
      groupWork: groupWork, dueLabel: dueLabel, caseBucket: caseBucket, ownerState: ownerState, initials: initials, groupRoles: groupRoles,
      taskStatuses: taskStatuses, checkRows: checkRows, fieldState: fieldState, errorList: errorList };
  })();

  /* ---------------- workList ---------------- */
  function workList(o) {
    var mount = el(o.mount), items = (o.items || []).slice(), now = o.now || new Date(), openId = null, uopts = { unassigned: o.unassigned };
    mount.classList.add('jp-wl');
    var title = o.title || 'Your work today';
    mount.innerHTML = '<div class="jp-wl-list"><div class="jp-wl-hd"><h3></h3><p></p></div><div class="jp-wl-items"></div></div><div class="jp-wl-focus" tabindex="-1" aria-live="polite"></div>';
    var listEl = mount.querySelector('.jp-wl-items'), focusEl = mount.querySelector('.jp-wl-focus');
    mount.querySelector('h3').textContent = title; mount.querySelector('.jp-wl-hd p').textContent = o.subtitle || '';
    function all() { return Array.prototype.slice.call(listEl.querySelectorAll('.jp-wi')); }
    function find(id) { for (var i = 0; i < items.length; i++) if (String(items[i].id) === String(id)) return items[i]; return null; }
    function renderList() {
      var groups = model.groupWork(items, now, uopts), html = '';
      groups.forEach(function (g) {
        html += '<div class="jp-wl-g" role="group" aria-label="' + esc(g.label) + '"><div class="jp-wl-gh"><span>' + esc(g.label) + '</span><span class="cnt">' + g.items.length + '</span></div>';
        g.items.forEach(function (it) {
          var due = model.dueLabel(it, now), soon = !it.waiting && (g.key === 'today' || g.key === 'overdue');
          html += '<button type="button" class="jp-wi" data-id="' + esc(it.id) + '" tabindex="-1"' + (String(it.id) === String(openId) ? ' aria-current="true"' : '') + '><span class="dot ' + esc(it.tone || '') + '" aria-hidden="true"></span>' +
            '<span class="tx"><b>' + esc(it.title) + '</b><small>' + esc(it.sub || '') + '</small></span><em' + (soon ? ' class="soon"' : '') + '>' + esc(due) + '</em></button>';
        });
        html += '</div>';
      });
      listEl.innerHTML = html || '<div class="empty"><b>Nothing assigned to you</b>New work shows here as it is assigned.</div>';
      var bs = all(), cur = listEl.querySelector('[aria-current="true"]') || bs[0];
      if (cur) cur.tabIndex = 0;
    }
    function renderFocus() {
      var it = find(openId);
      if (!it) { focusEl.innerHTML = '<div class="empty"><b>Pick an item</b>Its next step shows here.</div>'; return; }
      if (typeof o.renderFocus === 'function') {
        var v = o.renderFocus(it); focusEl.innerHTML = ''; if (v && v.nodeType) focusEl.appendChild(v); else focusEl.innerHTML = v == null ? '' : String(v); return;
      }
      var h = '<h3>' + esc(it.title) + '</h3>';
      if (it.facts && it.facts.length) h += '<div class="jp-facts">' + it.facts.map(function (f) { return '<div><small>' + esc(f.k) + '</small><b>' + esc(f.v) + '</b></div>'; }).join('') + '</div>';
      if (it.next) {
        h += '<div class="jp-nextbox"><small>Next step</small><p>' + esc(it.next.text) + '</p>' + (it.next.button ? '<button type="button" class="btn pri" data-nx>' + esc(it.next.button) + '</button>' : '') + '</div>';
      }
      if (it.why || it.last) h += '<dl class="jp-why">' + (it.why ? '<div><dt>Why this is here</dt><dd>' + esc(it.why) + '</dd></div>' : '') + (it.last ? '<div><dt>Last activity</dt><dd>' + esc(it.last) + '</dd></div>' : '') + '</dl>';
      focusEl.innerHTML = h;
      var nb = focusEl.querySelector('[data-nx]');
      if (nb && typeof it.next.onClick === 'function') nb.addEventListener('click', function () { it.next.onClick(it); });
    }
    function open(id, userInitiated) {
      openId = id; renderList(); renderFocus();
      if (userInitiated) {
        var b = listEl.querySelector('[aria-current="true"]'); if (b) b.focus();
        try { if (window.matchMedia('(max-width:820px)').matches && focusEl.scrollIntoView) focusEl.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      }
      if (typeof o.onOpen === 'function') o.onOpen(find(id));
    }
    listEl.addEventListener('click', function (e) { var b = e.target.closest('.jp-wi'); if (b) open(b.getAttribute('data-id'), true); });
    listEl.addEventListener('keydown', function (e) {
      var b = e.target.closest('.jp-wi'); if (!b) return;
      var bs = all(), i = bs.indexOf(b), j = i;
      if (e.key === 'ArrowDown') j = Math.min(bs.length - 1, i + 1);
      else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = bs.length - 1;
      else return;
      e.preventDefault();
      bs.forEach(function (x) { x.tabIndex = -1; });
      bs[j].tabIndex = 0; bs[j].focus();
    });
    renderList(); renderFocus();
    if (o.openFirst !== false && items.length) {
      var g = model.groupWork(items, now, uopts); if (g.length) open(g[0].items[0].id, false);
    }
    return {
      setItems: function (it) { items = (it || []).slice(); if (openId != null && !find(openId)) openId = null; renderList(); renderFocus(); },
      open: function (id) { open(id, true); }, getOpen: function () { return openId; }, el: mount
    };
  }

  /* ---------------- ownerStrip ---------------- */
  function ownerStrip(o) {
    var mount = el(o.mount), d = o.data || {}, now = o.now || new Date();
    mount.classList.add('jp-os');
    function render() {
      var st = model.ownerState(d, now), who = '';
      if (st.assigned) {
        who = '<div class="v"><span class="av" aria-hidden="true">' + esc(model.initials(d.owner.name)) + '</span><span class="t">' + esc(d.owner.name || 'Unknown user') + '</span></div>';
      } else {
        who = '<div class="v"><span class="un">Unassigned</span></div>' + (o.canAct !== false ? '<span class="jp-os-act"><button type="button" class="btn sm pri" data-act="take">Take case</button><button type="button" class="btn sm" data-act="assign">Assign</button></span>' : '');
      }
      var nx = d.next ? '<div class="v"><span class="t">' + esc(d.next.text) + '</span></div>' + (d.next.button ? '<span class="jp-os-act"><button type="button" class="btn sm pri" data-act="next">' + esc(d.next.button) + '</button></span>' : '') : '<div class="v"><span class="un">Not set</span></div>';
      mount.innerHTML =
        '<div><small>Owner</small>' + who + '</div>' +
        '<div><small>Team</small><div class="v"><span class="t">' + esc(d.team || 'Not set') + '</span></div></div>' +
        '<div><small>Due</small><div class="v' + (st.dueState === 'overdue' || st.dueState === 'soon' ? ' warn' : '') + '"><span class="t">' + esc(st.dueText || 'Not set') + '</span></div></div>' +
        '<div><small>Waiting on</small><div class="v"><span class="t">' + esc(d.waitingOn || 'Nobody') + '</span></div></div>' +
        '<div class="next"><small>Next action</small>' + nx + '</div>';
    }
    mount.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'take' && o.onTake) o.onTake(d); else if (a === 'assign' && o.onAssign) o.onAssign(d); else if (a === 'next' && d.next && d.next.onClick) d.next.onClick(d);
    });
    render();
    return { update: function (patch) { for (var k in patch) d[k] = patch[k]; render(); }, el: mount };
  }

  /* ---------------- roleList ---------------- */
  function roleList(o) {
    var mount = el(o.mount), roles = (o.roles || []).slice(), canEdit = !!o.canEdit;
    mount.classList.add('jp-rl');
    function render() {
      var h = '';
      model.groupRoles(roles).forEach(function (g) {
        h += '<div class="jp-rl-g"><span>' + esc(g.label) + '</span><span class="tag ' + (g.side === 'external' ? 'ext' : 'int') + '">' + esc(g.tag) + '</span></div><ul class="jp-rl-rows">';
        g.rows.forEach(function (r) {
          var gap = !r.person, id = esc(r.id || r.role);
          h += '<li class="jp-rr' + (gap ? ' gap' : '') + '"><div class="role"><b>' + esc(r.role) + '</b><span>' + esc(r.desc || '') + '</span></div>' +
            '<div class="who">' + (gap ? 'Not set' : '<span class="av" aria-hidden="true">' + esc(model.initials(r.person.name)) + '</span><div><b>' + esc(r.person.name) + '</b><small>' + esc(r.person.title || '') + '</small></div>') + '</div>' +
            '<div class="touch">' + esc(gap ? 'Nobody named' : (r.touch || '')) + '</div>' +
            '<div class="act">' + (canEdit ? '<button type="button" class="btn sm" data-role="' + id + '" data-kind="' + (gap ? 'add' : 'edit') + '" aria-label="' + (gap ? 'Add ' : 'Change ') + esc(r.role) + '">' + (gap ? 'Add' : 'Change') + '</button>' : '') + '</div></li>';
        });
        h += '</ul>';
      });
      mount.innerHTML = h || '<div class="empty"><b>No roles yet</b></div>';
    }
    mount.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-role]'); if (!b) return;
      var id = b.getAttribute('data-role'), r = roles.filter(function (x) { return String(x.id || x.role) === id; })[0];
      var fn = b.getAttribute('data-kind') === 'add' ? o.onAdd : o.onEdit;
      if (r && typeof fn === 'function') fn(r);
    });
    render();
    return { setRoles: function (r) { roles = (r || []).slice(); render(); }, el: mount };
  }

  /* ---------------- taskList ---------------- */
  function taskList(o) {
    var mount = el(o.mount), steps = (o.steps || []).slice();
    mount.classList.add('jp-tl');
    function render() {
      var m = model.taskStatuses(steps), h = '<p class="jp-prog"><b>' + m.done + ' of ' + m.total + '</b> steps complete</p><ol class="jp-tl-list">';
      m.steps.forEach(function (s) {
        var why = s.locked ? uid('jpk-tlw') : '';
        h += '<li><span class="n" aria-hidden="true">' + s.n + '</span><span class="tx"><button type="button" class="jp-tlb' + (s.locked ? ' dis' : '') + '" data-id="' + esc(s.id) + '"' + (s.locked ? ' aria-disabled="true" aria-describedby="' + why + '"' : '') + '>' + esc(s.label) + '</button>' +
          (s.locked ? '<small id="' + why + '">' + esc(s.reason) + '</small>' : '') + '</span>' + chip(s.status, s.tone) + '</li>';
      });
      mount.innerHTML = h + '</ol>';
    }
    mount.addEventListener('click', function (e) {
      var b = e.target.closest('.jp-tlb'); if (!b || b.getAttribute('aria-disabled') === 'true') return;
      var id = b.getAttribute('data-id'); if (o.onOpen) o.onOpen(steps.filter(function (s) { return String(s.id) === id; })[0]);
    });
    render();
    return { setSteps: function (s) { steps = (s || []).slice(); render(); }, statuses: function () { return model.taskStatuses(steps); }, el: mount };
  }

  /* ---------------- checkAnswers ---------------- */
  function checkAnswers(o) {
    var mount = el(o.mount), rows = (o.rows || []).slice();
    mount.classList.add('jp-cya');
    function render() {
      var m = model.checkRows(rows);
      mount.innerHTML = '<dl>' + m.rows.map(function (r) {
        return '<div><dt>' + esc(r.label) + '</dt><dd class="v' + (r.missing ? ' miss' : '') + '">' + esc(r.value) + '</dd><dd><button type="button" class="jp-lnkb" data-id="' + esc(r.id) + '" aria-label="' + esc(r.action + ' ' + r.label.toLowerCase()) + '">' + esc(r.action) + '</button></dd></div>';
      }).join('') + '</dl><p class="jp-cya-sum' + (m.ready ? '' : ' bad') + '" role="status">' + esc(m.text) + '</p>';
    }
    mount.addEventListener('click', function (e) {
      var b = e.target.closest('.jp-lnkb'); if (!b || !o.onChange) return;
      var id = b.getAttribute('data-id'); o.onChange(rows.filter(function (r) { return String(r.id) === id; })[0]);
    });
    render();
    return { setRows: function (r) { rows = (r || []).slice(); render(); }, check: function () { return model.checkRows(rows); }, el: mount };
  }

  /* ---------------- field ---------------- */
  function field(o) {
    var id = o.id || uid('jpk-f'), hid = id + '-h', mid = id + '-m';
    var wrap = doc.createElement('div'); wrap.className = 'jp-fld';
    var tag = o.type === 'select' ? 'select' : o.type === 'textarea' ? 'textarea' : 'input';
    var h = '<label for="' + id + '">' + esc(o.label) + (o.required ? '' : ' <span class="opt">(optional)</span>') + '</label>';
    if (o.hint) h += '<span class="hint" id="' + hid + '">' + esc(o.hint) + '</span>';
    h += '<span class="msg" id="' + mid + '" hidden></span>';
    if (tag === 'select') h += '<select id="' + id + '">' + (o.options || []).map(function (op) { var v = typeof op === 'object' ? op.value : op, l = typeof op === 'object' ? op.label : op; return '<option value="' + esc(v) + '">' + esc(l) + '</option>'; }).join('') + '</select>';
    else if (tag === 'textarea') h += '<textarea id="' + id + '" rows="3"></textarea>';
    else h += '<input id="' + id + '" type="' + esc(o.type || 'text') + '"' + (o.inputmode ? ' inputmode="' + esc(o.inputmode) + '"' : '') + '>';
    h += '<span class="okmsg" hidden></span>';
    wrap.innerHTML = h;
    var input = wrap.querySelector('#' + id), msg = wrap.querySelector('.msg'), ok = wrap.querySelector('.okmsg');
    if (o.value != null) input.value = o.value;
    var st = { id: id, error: '', ok: '' };
    function describe() {
      var ids = []; if (o.hint) ids.push(hid); if (st.error) ids.push(mid);
      if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
    }
    function apply() {
      wrap.classList.toggle('err', !!st.error); wrap.classList.toggle('ok', !st.error && !!st.ok);
      msg.hidden = !st.error; msg.textContent = st.error ? 'Error: ' + st.error : '';
      ok.hidden = !(st.ok && !st.error); ok.textContent = st.ok || '';
      if (st.error) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      describe();
    }
    var api = {
      id: id, el: wrap, input: input,
      setError: function (m) { st.error = m || ''; st.ok = ''; apply(); return api; },
      setOk: function (m) { st.ok = m || 'Looks good'; st.error = ''; apply(); return api; },
      clear: function () { st.error = ''; st.ok = ''; apply(); return api; },
      get error() { return st.error; },
      value: function () { return input.value; }
    };
    if (o.error) api.setError(o.error); else if (o.ok) api.setOk(o.ok); else apply();
    if (o.mount) el(o.mount).appendChild(wrap);
    return api;
  }

  /* ---------------- errorSummary ---------------- */
  function errorSummary(o) {
    o = o || {};
    var mount = el(o.mount), errs = (o.errors || []).slice();
    mount.classList.add('jp-es');
    function render() {
      mount.hidden = !errs.length;
      mount.innerHTML = errs.length ? '<b id="' + uid('jpk-es') + '">' + esc(o.title || 'There is a problem') + '</b>' + errs.map(function (e) { return '<a href="#' + esc(e.id) + '" data-for="' + esc(e.id) + '">' + esc(e.message) + '</a>'; }).join('') : '';
      mount.setAttribute('role', 'alert'); mount.tabIndex = -1;
    }
    mount.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-for]'); if (!a) return;
      e.preventDefault();
      var f = doc.getElementById(a.getAttribute('data-for'));
      if (f) { if (f.scrollIntoView) f.scrollIntoView({ block: 'center' }); f.focus(); }
    });
    render();
    return {
      set: function (list, focus) { errs = (list || []).slice(); render(); if (focus && errs.length) mount.focus(); },
      fromFields: function (fields, focus) { this.set(model.errorList(fields), focus); },
      clear: function () { errs = []; render(); }, count: function () { return errs.length; }, el: mount
    };
  }

  var api = {
    version: '1.2.0',
    esc: esc, uid: uid,
    toast: toast, drawer: drawer, chip: chip, table: table, chart: chart,
    next: next, tabs: tabs, menu: menu, aboutButton: aboutButton, flash: flash, steps: steps, crm: crm,
    workList: workList, ownerStrip: ownerStrip, roleList: roleList, taskList: taskList, checkAnswers: checkAnswers,
    field: field, errorSummary: errorSummary, model: model
  };
  if (typeof window !== 'undefined') window.JPK = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
