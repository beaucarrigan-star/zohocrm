/* JusticePoint widget kit: jpk.js v1.1.0. One IIFE, exposes window.JPK. No dependencies, no network, no AI calls.
   Works standalone in a browser; JPK.crm is guarded so the Zoho SDK is optional.
   Changes from kit v1.0.0 (kit.js): JPK.zoho -> JPK.crm (fn -> run; coql added; coqlAll pages over coql),
   JPK.nextStep -> JPK.next, JPK.about -> JPK.aboutButton. No aliases: an old call fails loudly. */
(function () {
  'use strict';

  var doc = document;
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
    var tw = doc.createElement('div'); tw.className = 'tw'; mount.appendChild(tw);
    var emptyEl = doc.createElement('div'); emptyEl.className = 'empty'; emptyEl.hidden = true; mount.appendChild(emptyEl);

    var tbl = doc.createElement('table');
    if (o.caption) { var cap = doc.createElement('caption'); cap.className = 'sr'; cap.textContent = o.caption; tbl.appendChild(cap); }
    var thead = doc.createElement('thead'), tbody = doc.createElement('tbody');
    tbl.appendChild(thead); tbl.appendChild(tbody); tw.appendChild(tbl);

    var tr = doc.createElement('tr');
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
      var v = c.render ? c.render(row) : esc(row[c.key]);
      if (v && v.nodeType) td.appendChild(v); else td.innerHTML = v == null ? '' : String(v);
      return td;
    }
    function render() {
      var list = visibleRows();
      tbody.innerHTML = '';
      list.forEach(function (x) {
        var r = doc.createElement('tr');
        r.setAttribute('data-i', x.i);
        if (o.onRowClick) { r.className = 'click'; r.tabIndex = 0; }
        cols.forEach(function (c) { r.appendChild(cell(c, x.r)); });
        tbody.appendChild(r);
      });
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
    function activate(e, tr) {
      var i = +tr.getAttribute('data-i');
      o.onRowClick(state.rows[i], i, e);
    }
    if (o.onRowClick) {
      tbody.addEventListener('click', function (e) {
        var ctl = e.target.closest('a,button,input,select,textarea');
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
    render();
    return { setRows: setRows, setFilter: setFilter, el: tbl, getFilter: function () { return state.filter; } };
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

  window.JPK = {
    version: '1.1.0',
    esc: esc, uid: uid,
    toast: toast, drawer: drawer, chip: chip, table: table, chart: chart,
    next: next, tabs: tabs, menu: menu, aboutButton: aboutButton, flash: flash, steps: steps, crm: crm
  };
})();
