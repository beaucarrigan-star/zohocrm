/* jpk-s51.js v1.0.0 (S51, 30 Oct 2026): BD Home pipeline tools, modelled on Bolt Today's Salesforce accelerators.
   1. Pipeline board (Boards tab, under the brand boards): open opportunities as stage lanes, one pipeline at a time or all four;
      a card shows account, amount, last touch and the two scores; click opens the record. Five lanes, the rest behind
      "Show all stages (n more)" (S39's five-tile rule). The pipeline picked is kept per browser.
   2. Quadrant (same card, "Quadrant" view): maturity (from the stage's probability) across, engagement (1-5) up, bubble = amount,
      colour = pipeline. Opportunities with no Engagement score sit under the chart as "Not scored yet". Hover or focus names the deal.
   3. Forecast tile (Today > Needs you today): this quarter's open opportunities, Committed / Best case / Pipeline and the weighted
      total, by pipeline. Hidden until at least one open opportunity has an amount and a closing date in the quarter.
   Reads: one COQL on Deals (Stage_Group Early or Working), through ZOHO.CRM.API.coql only. No writes.
   Preview (no Zoho SDK) or ?s51demo=1: built-in sample opportunities, marked as sample. ?s51demo=empty: no open opportunities.
   Maturity bands by probability: Early <= 20, Qualified 21-50, Proposal 51-70, Closing > 70.
   Forecast: Committed = Closing band; Best case = Proposal band with Engagement 4 or 5; Pipeline = the rest. Quarters are calendar quarters.
   Hide, don't delete. Off switch: ?s51=0. */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc || root.JPKS51) return;
  if (/[?&]s51=0\b/.test(root.location.search)) { root.JPKS51 = { version: '1.0.0', off: true }; return; }
  var VERSION = '1.0.0', KEY_PIPE = 'jpk-s51-pipe', KEY_VIEW = 'jpk-s51-view', KEY_ALL = 'jpk-s51-alllanes', CAP = 5;
  var CRM = 'https://crm.zoho.com/crm/org882980956/tab/';
  var html = doc.documentElement;
  var PIPES = ['JusticePoint EM', 'JusticePoint Programs', 'Sirona Programs', 'TDP Pipeline'];
  var SHORT = { 'JusticePoint EM': 'JP EM', 'JusticePoint Programs': 'JP Programs', 'Sirona Programs': 'Sirona', 'TDP Pipeline': 'TDP' };
  /* open stages per pipeline, in order, as Setup maps them (30 Oct 2026) */
  var STAGES = {
    'JusticePoint EM': ['Prospecting', 'Discovery', 'Demo/Pilot Approved', 'Pilot Running', 'RFP/Procurement Event', 'Proposal Submitted', 'Contract Negotiation'],
    'JusticePoint Programs': ['Prospecting', 'Discovery', 'Program Design/Scoping', 'RFP/Procurement Event', 'Budget Proposal', 'Contract Negotiation', 'County/Board Approval'],
    'Sirona Programs': ['Prospecting', 'Discovery', 'Site Visit / Capacity Review', 'RFP/Procurement Event', 'Budget Proposal', 'Contract and Credentialing'],
    'TDP Pipeline': ['Prospecting', 'Discovery', 'Solution Development', 'Proposal Submitted', 'Contract Negotiation']
  };
  var BANDS = ['Early', 'Qualified', 'Proposal', 'Closing'];
  var QUERY = 'select Deal_Name, Account_Name, Account_Name.Account_Name, Pipeline, Stage, Probability, Amount, Total_Opportunity_Revenue, Closing_Date, ' +
    'Engagement, Relationship_Strength, Last_Activity_Time, Modified_Time, Owner from Deals where Stage_Group in (\'Early\',\'Working\')';

  /* ---------- helpers ---------- */
  function $(id) { return doc.getElementById(id); }
  function q(s, r) { try { return (r || doc).querySelector(s); } catch (e) { return null; } }
  function qa(s, r) { try { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); } catch (e) { return []; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mk(tag, cls, attrs) { var n = doc.createElement(tag); if (cls) n.className = cls; if (attrs) for (var a in attrs) n.setAttribute(a, attrs[a]); return n; }
  function flag(el, name, on) { if (!el) return; if (on) { if (!el.hasAttribute(name)) el.setAttribute(name, ''); } else if (el.hasAttribute(name)) el.removeAttribute(name); }
  var store = {
    get: function (k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} }
  };
  function param(n) { var m = new RegExp('[?&]' + n + '=(\\w+)').exec(root.location.search); return m ? m[1] : ''; }
  function money(n) {
    if (n == null || isNaN(n)) return '';
    n = Number(n);
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { if (n == null || isNaN(n)) return ''; return '$' + Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  var DAY = 864e5;
  function daysAgo(iso) { if (!iso) return null; var d = new Date(iso); if (isNaN(d)) return null; return Math.max(0, Math.floor((Date.now() - d) / DAY)); }
  function quarterOf(d) { return { y: d.getFullYear(), q: Math.floor(d.getMonth() / 3) }; }
  function inThisQuarter(ymd) {
    if (!ymd) return false; var d = new Date(ymd + 'T12:00:00'); if (isNaN(d)) return false;
    var a = quarterOf(new Date()), b = quarterOf(d); return a.y === b.y && a.q === b.q;
  }
  function qLabel() { var n = new Date(); return 'Q' + (Math.floor(n.getMonth() / 3) + 1) + ' ' + n.getFullYear(); }

  /* ---------- model ---------- */
  function norm(r) {
    var amt = r.Amount != null && r.Amount !== '' ? Number(r.Amount) : (r.Total_Opportunity_Revenue != null ? Number(r.Total_Opportunity_Revenue) : null);
    if (amt != null && (isNaN(amt) || amt <= 0)) amt = null;
    var acc = r.Account_Name && typeof r.Account_Name === 'object' ? (r.Account_Name.name || r.Account_Name.Account_Name) : r.Account_Name;
    if (!acc && r['Account_Name.Account_Name']) acc = r['Account_Name.Account_Name'];
    var p = r.Probability != null ? Number(r.Probability) : NaN;
    var band = isNaN(p) ? 0 : p <= 20 ? 0 : p <= 50 ? 1 : p <= 70 ? 2 : 3;
    var eng = r.Engagement != null && r.Engagement !== '' ? Number(r.Engagement) : null;
    var rel = r.Relationship_Strength != null && r.Relationship_Strength !== '' ? Number(r.Relationship_Strength) : null;
    return {
      id: String(r.id), name: r.Deal_Name || '(no name)', acc: acc || '', pipe: r.Pipeline || '', stage: r.Stage || '', prob: isNaN(p) ? null : p,
      band: band, amt: amt, close: r.Closing_Date || '', eng: eng, rel: rel, touch: daysAgo(r.Last_Activity_Time || r.Modified_Time),
      url: CRM + 'Potentials/' + r.id
    };
  }
  function category(o) { return o.band === 3 ? 'committed' : (o.band === 2 && o.eng != null && o.eng >= 4) ? 'best' : 'pipeline'; }
  function forecast(list) {
    var out = { committed: 0, best: 0, pipeline: 0, weighted: 0, n: 0, byPipe: {} };
    list.forEach(function (o) {
      if (o.amt == null || !inThisQuarter(o.close)) return;
      var c = category(o); out[c] += o.amt; out.n++;
      out.weighted += o.amt * ((o.prob == null ? 10 : o.prob) / 100);
      var bp = out.byPipe[o.pipe] || (out.byPipe[o.pipe] = { committed: 0, best: 0, pipeline: 0, n: 0 });
      bp[c] += o.amt; bp.n++;
    });
    return out;
  }
  function quadrant(o) { /* for the tooltip: where the deal sits */
    var hi = o.eng != null && o.eng >= 3, late = o.band >= 2;
    return hi && late ? 'Close' : hi ? 'Push' : late ? 'Nurture' : 'Park';
  }

  /* ---------- state ---------- */
  var S = { list: null, err: null, sample: false, pipe: store.get(KEY_PIPE) || 'all', view: store.get(KEY_VIEW) === 'quad' ? 'quad' : 'board', allLanes: store.get(KEY_ALL) === '1', tip: null };
  if (S.pipe !== 'all' && PIPES.indexOf(S.pipe) < 0) S.pipe = 'all';

  /* ---------- read ---------- */
  function hasSdk() { return !!(root.ZOHO && root.ZOHO.CRM && root.ZOHO.CRM.API && root.ZOHO.CRM.API.coql); }
  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]); }
  function coqlAll(qs) {
    var all = [];
    var page = function (p) {
      return withTimeout(root.ZOHO.CRM.API.coql({ select_query: qs + ' limit 200 offset ' + (p * 200) }), 20000).then(function (r) {
        var rows = (r && r.data) || []; all = all.concat(rows);
        return rows.length === 200 && p < 9 ? page(p + 1) : all;
      });
    };
    return page(0);
  }
  function load() {
    var demo = param('s51demo');
    if (demo === 'empty') { S.list = []; S.sample = true; return Promise.resolve(); }
    if (demo || !hasSdk()) { S.list = SAMPLE.map(norm); S.sample = true; return Promise.resolve(); }
    return coqlAll(QUERY).then(function (rows) { S.list = rows.map(norm); S.err = null; }, function (e) {
      var m = String(e && e.message || e || '');
      S.list = []; S.err = /PERMISSION|NOT_ALLOWED|AUTHORI[SZ]|NO_ACCESS/i.test(m) ? 'Your profile cannot read Opportunities.' : 'Could not read the opportunities (' + (m || 'no reply') + '). Reload the page to try again.';
    });
  }

  /* ---------- the card ---------- */
  function card() {
    var c = $('s51-pipe');
    if (c) return c;
    var z = $('z-boards'); if (!z) return null;
    c = mk('section', 'card', { id: 's51-pipe', 'aria-labelledby': 's51-h', hidden: '' });
    c.innerHTML =
      '<div class="s51-hd"><h2 id="s51-h">Pipeline</h2><span class="s51-meta" id="s51-meta"></span>' +
      '<div class="s51-seg" role="group" aria-label="Pipeline" id="s51-pipes"></div>' +
      '<div class="s51-seg s51-views" role="group" aria-label="View" id="s51-views">' +
      '<button type="button" data-s51-view="board" aria-pressed="false">Board</button><button type="button" data-s51-view="quad" aria-pressed="false">Quadrant</button></div></div>' +
      '<div id="s51-body"></div><p class="s51-note" id="s51-note" hidden></p>';
    var pipes = q('#s51-pipes', c);
    [['all', 'All']].concat(PIPES.map(function (p) { return [p, SHORT[p]]; })).forEach(function (x) {
      var b = mk('button', '', { type: 'button', 'data-s51-pipe': x[0], 'aria-pressed': 'false', title: x[0] === 'all' ? 'Every pipeline' : x[0] });
      b.textContent = x[1]; pipes.appendChild(b);
    });
    c.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-s51-pipe')) { S.pipe = t.getAttribute('data-s51-pipe'); store.set(KEY_PIPE, S.pipe); paint(); }
      else if (t.hasAttribute('data-s51-view')) { S.view = t.getAttribute('data-s51-view'); store.set(KEY_VIEW, S.view); paint(); }
      else if (t.id === 's51-morelanes') { S.allLanes = !S.allLanes; store.set(KEY_ALL, S.allLanes ? '1' : '0'); paint(); }
    });
    var board = $('board');
    if (board && board.parentNode === z) z.insertBefore(c, board.nextSibling); else z.appendChild(c);
    return c;
  }
  function visible() {
    if (!S.list) return [];
    return S.pipe === 'all' ? S.list.slice() : S.list.filter(function (o) { return o.pipe === S.pipe; });
  }
  function scoreHtml(o) {
    var dots = function (n, label) {
      if (n == null) return '';
      var h = '<span class="s51-sc" title="' + esc(label + ' ' + n + ' of 5') + '" aria-label="' + esc(label + ' ' + n + ' of 5') + '">' + esc(label[0]) + ' ';
      for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
      return h + '</span>';
    };
    var h = dots(o.eng, 'Engagement') + dots(o.rel, 'Relationship');
    return h || '<span class="s51-sc none">not scored</span>';
  }
  function cardHtml(o) {
    var touch = o.touch == null ? 'no activity logged' : o.touch === 0 ? 'touched today' : 'touched ' + o.touch + 'd ago';
    return '<li><a class="s51-card" href="' + esc(o.url) + '" target="_top" data-s51-p="' + esc(o.pipe) + '" aria-label="' + esc(o.name + (o.acc ? ', ' + o.acc : '') + (o.amt != null ? ', ' + moneyFull(o.amt) : '') + ', ' + o.stage + '. Open the opportunity') + '">' +
      '<b>' + esc(o.name) + '</b>' + (o.acc && o.acc !== o.name ? '<span class="acc">' + esc(o.acc) + '</span>' : '') +
      '<div class="row">' + (o.amt != null ? '<span class="amt">' + esc(money(o.amt)) + '</span>' : '<span>no amount</span>') +
      '<span class="' + (o.touch != null && o.touch > 30 ? 'stale' : '') + '">' + esc(touch) + '</span>' + (S.pipe === 'all' ? '<span>' + esc(SHORT[o.pipe] || o.pipe) + '</span>' : '') + '</div>' +
      '<div class="row">' + scoreHtml(o) + '</div></a></li>';
  }
  function paintBoard(body, list) {
    var pipes = S.pipe === 'all' ? PIPES : [S.pipe];
    var h = '', extra = 0, lanesSeen = 0;
    pipes.forEach(function (p) {
      var mine = list.filter(function (o) { return o.pipe === p; });
      if (S.pipe === 'all' && !mine.length) return;
      var stages = STAGES[p] || [];
      var other = mine.filter(function (o) { return stages.indexOf(o.stage) < 0; }).map(function (o) { return o.stage; });
      var lanes = stages.slice();
      other.forEach(function (s) { if (lanes.indexOf(s) < 0) lanes.push(s); });
      lanes = lanes.filter(function (s, i) { return i < 2 || mine.some(function (o) { return o.stage === s; }) || S.pipe !== 'all'; });
      if (S.pipe === 'all') h += '<h3 class="s51-lane-h" style="margin:10px 2px 6px" data-s51-p="' + esc(p) + '"><span><i class="s51-key-dot" aria-hidden="true"></i>' + esc(p) + '</span><span class="n">' + mine.length + ' open</span></h3>';
      h += '<div class="s51-lanes" role="list" aria-label="' + esc(p + ' stages') + '">';
      lanes.forEach(function (s, i) {
        var inLane = mine.filter(function (o) { return o.stage === s; });
        var sum = inLane.reduce(function (a, o) { return a + (o.amt || 0); }, 0);
        var hide = !S.allLanes && i >= CAP; if (hide) extra++;
        h += '<div class="s51-lane" role="listitem"' + (hide ? ' data-s51-x' : '') + '><div class="s51-lane-h"><span>' + esc(s) + '</span><span class="n">' + inLane.length + '</span></div>' +
          (sum ? '<span class="s51-lane-sum">' + esc(money(sum)) + '</span>' : '') +
          '<ul class="s51-cards">' + inLane.map(cardHtml).join('') + '</ul></div>';
        lanesSeen++;
      });
      h += '</div>';
    });
    if (!lanesSeen) h = '<p class="s51-empty">No open opportunities' + (S.pipe === 'all' ? '' : ' in ' + esc(S.pipe)) + '.</p>';
    h += '<button type="button" class="s51-more" id="s51-morelanes"' + (extra || S.allLanes ? '' : ' hidden') + ' aria-expanded="' + (S.allLanes ? 'true' : 'false') + '">' + (S.allLanes ? 'Show fewer stages' : 'Show all stages (' + extra + ' more)') + '</button>';
    body.innerHTML = h;
  }
  function paintQuad(body, list) {
    var scored = list.filter(function (o) { return o.eng != null; }), unscored = list.filter(function (o) { return o.eng == null; });
    var narrow = (body.clientWidth || root.innerWidth || 1000) < 640;   /* phone: a taller chart, no bubble labels */
    var W = narrow ? 480 : 1000, H = narrow ? 460 : 420, L = narrow ? 40 : 54, R = 16, T = 28, B = 44, pw = W - L - R, ph = H - T - B;
    var cw = pw / 4, rh = ph / 5;
    var maxAmt = scored.reduce(function (m, o) { return Math.max(m, o.amt || 0); }, 0) || 1;
    var seen = {};
    var dots = scored.map(function (o) {
      var kx = o.band, ky = o.eng; var k = kx + ':' + ky; var n = seen[k] = (seen[k] || 0) + 1;
      /* spread deals that share a cell a little, so they do not stack */
      var jx = ((n * 37) % 23 - 11) / 11 * cw * 0.28, jy = ((n * 53) % 19 - 9) / 9 * rh * 0.28;
      var cx = L + cw * (kx + 0.5) + jx, cy = T + ph - rh * (ky - 0.5) + jy;
      var r = 6 + 16 * Math.sqrt((o.amt || 0) / maxAmt);
      var lbl = o.acc && o.acc.length < 22 ? o.acc : o.name;
      return '<a href="' + esc(o.url) + '" target="_top" data-s51-p="' + esc(o.pipe) + '" data-s51-id="' + esc(o.id) + '" aria-label="' + esc(o.name + ', ' + BANDS[o.band] + ', engagement ' + o.eng + (o.amt != null ? ', ' + moneyFull(o.amt) : '') + '. Open the opportunity') + '">' +
        '<circle class="dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '"></circle>' +
        (!narrow && scored.length <= 14 ? '<text class="lbl" x="' + (cx > W - 150 ? cx - r - 3 : cx + r + 3).toFixed(1) + '" y="' + (cy + 4).toFixed(1) + '"' + (cx > W - 150 ? ' text-anchor="end"' : '') + '>' + esc(lbl.length > 18 ? lbl.slice(0, 17) + '…' : lbl) + '</text>' : '') + '</a>';
    }).join('');
    var axes = '';
    for (var i = 0; i <= 4; i++) axes += '<line class="ax" x1="' + (L + cw * i) + '" y1="' + T + '" x2="' + (L + cw * i) + '" y2="' + (T + ph) + '"></line>';
    for (var j = 0; j <= 5; j++) axes += '<line class="ax" x1="' + L + '" y1="' + (T + rh * j) + '" x2="' + (L + pw) + '" y2="' + (T + rh * j) + '"></line>';
    axes += '<line class="ax mid" x1="' + (L + cw * 2) + '" y1="' + T + '" x2="' + (L + cw * 2) + '" y2="' + (T + ph) + '"></line>';
    axes += '<line class="ax mid" x1="' + L + '" y1="' + (T + rh * 3) + '" x2="' + (L + pw) + '" y2="' + (T + rh * 3) + '"></line>';
    var xl = BANDS.map(function (b, i) { return '<text x="' + (L + cw * (i + 0.5)) + '" y="' + (T + ph + 16) + '" text-anchor="middle">' + b + '</text>'; }).join('');
    var yl = ''; for (var e = 1; e <= 5; e++) yl += '<text x="' + (L - 8) + '" y="' + (T + ph - rh * (e - 0.5) + 4) + '" text-anchor="end">' + e + '</text>';
    var ql = '<text class="ql" x="' + (L + 6) + '" y="' + (T + 14) + '">Push</text><text class="ql" x="' + (L + pw - 6) + '" y="' + (T + 14) + '" text-anchor="end">Close</text>' +
      '<text class="ql" x="' + (L + 6) + '" y="' + (T + ph - 6) + '">Park</text><text class="ql" x="' + (L + pw - 6) + '" y="' + (T + ph - 6) + '" text-anchor="end">Nurture</text>';
    var cap = '<text x="' + (L + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Maturity (from the stage)</text>' +
      '<text transform="translate(14 ' + (T + ph / 2) + ') rotate(-90)" text-anchor="middle">Engagement</text>';
    var h = '<div class="s51-quad"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" focusable="false" tabindex="-1" aria-label="Pipeline quadrant: maturity across, engagement up, bubble size is the amount">' + axes + ql + xl + yl + cap + dots + '</svg><div class="s51-quad-tip" id="s51-tip" hidden></div></div>';
    if (!scored.length) h = '<p class="s51-empty">' + (list.length ? 'No open opportunity has an Engagement score yet. Set Engagement and Relationship Strength on each opportunity and they appear here.' : 'No open opportunities' + (S.pipe === 'all' ? '' : ' in ' + esc(S.pipe)) + '.') + '</p>';
    else if (unscored.length) h += '<p class="s51-note" style="margin-top:10px">Not scored yet (' + unscored.length + '): set Engagement on the opportunity to place it.</p><ul class="s51-unscored">' +
      unscored.map(function (o) { return '<li><a href="' + esc(o.url) + '" target="_top">' + esc(o.name) + '</a></li>'; }).join('') + '</ul>';
    h += '<ul class="s51-key" aria-label="Pipeline colours">' + PIPES.filter(function (p) { return S.pipe === 'all' || p === S.pipe; }).map(function (p) { return '<li data-s51-p="' + esc(p) + '"><i aria-hidden="true"></i>' + esc(p) + '</li>'; }).join('') + '</ul>';
    body.innerHTML = h;
    var svg = q('svg', body), tip = $('s51-tip');
    if (!svg || !tip) return;
    function show(a) {
      var o = S.list.filter(function (x) { return x.id === a.getAttribute('data-s51-id'); })[0]; if (!o) return;
      tip.innerHTML = '<b>' + esc(o.name) + '</b>' + (o.acc ? esc(o.acc) + '<br>' : '') + '<span>' + esc(SHORT[o.pipe] || o.pipe) + ' · ' + esc(o.stage) + '</span><br>' +
        (o.amt != null ? esc(moneyFull(o.amt)) + ' · ' : '') + 'engagement ' + o.eng + (o.rel != null ? ' · relationship ' + o.rel : '') + '<br><span>' + quadrant(o) + (o.close ? ' · closes ' + esc(o.close) : '') + '</span>';
      tip.hidden = false;
      var c = q('circle', a), bb = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      var x = (parseFloat(c.getAttribute('cx')) / vb.width) * bb.width, y = (parseFloat(c.getAttribute('cy')) / vb.height) * bb.height;
      tip.style.left = Math.min(x + 12, bb.width - 270) + 'px'; tip.style.top = Math.max(0, y - 10 - tip.offsetHeight) + 'px';
    }
    svg.addEventListener('mouseover', function (e) { var a = e.target.closest && e.target.closest('a[data-s51-id]'); if (a) show(a); });
    svg.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('a[data-s51-id]')) tip.hidden = true; });
    svg.addEventListener('focusin', function (e) { var a = e.target.closest && e.target.closest('a[data-s51-id]'); if (a) show(a); });
    svg.addEventListener('focusout', function () { tip.hidden = true; });
  }
  function paint() {
    var c = card(); if (!c) return;
    c.hidden = false;
    qa('[data-s51-pipe]', c).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s51-pipe') === S.pipe)); });
    qa('[data-s51-view]', c).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s51-view') === S.view)); });
    var body = $('s51-body'), note = $('s51-note'), meta = $('s51-meta');
    if (!S.list) { body.innerHTML = '<p class="s51-empty" role="status">Loading opportunities…</p>'; meta.textContent = ''; note.hidden = true; return; }
    var list = visible();
    var sum = list.reduce(function (a, o) { return a + (o.amt || 0); }, 0);
    meta.textContent = list.length + ' open' + (sum ? ' · ' + money(sum) : '') + (S.sample ? ' · sample (preview)' : '');
    if (S.err) { body.innerHTML = '<p class="s51-empty">' + esc(S.err) + '</p>'; note.hidden = true; return; }
    if (S.view === 'quad') paintQuad(body, list); else paintBoard(body, list);
    var noAmt = list.filter(function (o) { return o.amt == null; }).length, noSc = list.filter(function (o) { return o.eng == null || o.rel == null; }).length;
    var bits = [];
    if (noAmt) bits.push(noAmt + ' with no amount');
    if (noSc) bits.push(noSc + ' not fully scored');
    note.textContent = bits.length ? 'Fill in on the opportunity: ' + bits.join(', ') + '. Scores: Engagement and Relationship Strength, 1 to 5, each with a guide on its info icon.' : '';
    note.hidden = !bits.length;
  }

  /* ---------- forecast tile ---------- */
  function tile() {
    var ul = q('#needs-today .nt-tiles'); if (!ul || !S.list) return;
    var li = q('li[data-s51-tile]', ul);
    var f = forecast(S.list);
    if (!f.n) { if (li) li.hidden = true; return; }
    if (!li) {
      li = mk('li', '', { 'data-s51-tile': 'forecast' });
      li.innerHTML = '<button type="button" class="nt-tile" data-s51-go="pipe"><span class="nt-lbl">Forecast · ' + esc(qLabel()) + '</span><span class="nt-num"></span><span class="nt-chip" hidden></span>' +
        '<dl class="s51-fc"></dl><span class="nt-mean"></span><span class="nt-go">See the pipeline →</span></button>';
      li.querySelector('button').addEventListener('click', function () {
        try { if (root.JPKS38 && root.JPKS38.setTab) root.JPKS38.setTab('boards'); } catch (e) {}
        var c = $('s51-pipe'); if (c) { try { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { c.scrollIntoView(); } }
      });
      ul.appendChild(li);
    }
    li.hidden = false;
    q('.nt-num', li).textContent = money(f.weighted);
    var chip = q('.nt-chip', li); chip.textContent = 'weighted, ' + f.n + ' opportunit' + (f.n === 1 ? 'y' : 'ies'); chip.className = 'nt-chip'; chip.hidden = false;
    q('.s51-fc', li).innerHTML = '<dt>Committed</dt><dd>' + esc(money(f.committed)) + '</dd><dt>Best case</dt><dd>' + esc(money(f.best)) + '</dd><dt>Pipeline</dt><dd>' + esc(money(f.pipeline)) + '</dd>';
    var pipes = Object.keys(f.byPipe).map(function (p) { return (SHORT[p] || p) + ' ' + money(f.byPipe[p].committed + f.byPipe[p].best + f.byPipe[p].pipeline); });
    q('.nt-mean', li).textContent = 'Closing this quarter with an amount. ' + pipes.join(' · ') + (S.sample ? ' (sample)' : '');
    q('button', li).setAttribute('aria-label', 'Forecast ' + qLabel() + ': ' + moneyFull(f.weighted) + ' weighted. Committed ' + moneyFull(f.committed) + ', best case ' + moneyFull(f.best) + ', pipeline ' + moneyFull(f.pipeline) + '. See the pipeline');
    try { if (root.JPKS38 && root.JPKS38.ensure) root.JPKS38.ensure(); } catch (e) {}
  }

  /* ---------- sample opportunities (preview only; synthetic) ---------- */
  var SAMPLE = (function () {
    var y = new Date().getFullYear(), m = new Date().getMonth(), qs = m - m % 3;
    function d(mo, day) { var x = new Date(y, qs + mo, day); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
    function ago(n) { return new Date(Date.now() - n * DAY).toISOString(); }
    return [
      { id: 's1', Deal_Name: 'Brown County EM', Account_Name: { name: 'Brown County Sheriff' }, Pipeline: 'JusticePoint EM', Stage: 'Prospecting', Probability: 10, Amount: 180000, Closing_Date: d(2, 20), Engagement: 2, Relationship_Strength: 2, Last_Activity_Time: ago(41) },
      { id: 's2', Deal_Name: '100 GPS and 50 RB', Account_Name: { name: 'Maine Pretrial Services' }, Pipeline: 'JusticePoint EM', Stage: 'Discovery', Probability: 20, Amount: 420000, Closing_Date: d(5, 1), Engagement: 4, Relationship_Strength: 3, Last_Activity_Time: ago(3) },
      { id: 's3', Deal_Name: 'Waukesha Pilot', Account_Name: { name: 'Waukesha Co Sheriff' }, Pipeline: 'JusticePoint EM', Stage: 'Pilot Running', Probability: 50, Amount: 95000, Closing_Date: d(1, 28), Engagement: 5, Relationship_Strength: 4, Last_Activity_Time: ago(1) },
      { id: 's4', Deal_Name: 'Racine SCRAM expansion', Account_Name: { name: 'Racine County' }, Pipeline: 'JusticePoint EM', Stage: 'Proposal Submitted', Probability: 70, Amount: 240000, Closing_Date: d(2, 5), Engagement: 4, Relationship_Strength: 5, Last_Activity_Time: ago(6) },
      { id: 's5', Deal_Name: 'Kenosha renewal + GPS', Account_Name: { name: 'Kenosha County' }, Pipeline: 'JusticePoint EM', Stage: 'Contract Negotiation', Probability: 85, Amount: 310000, Closing_Date: d(2, 15), Engagement: 3, Relationship_Strength: 5, Last_Activity_Time: ago(2) },
      { id: 's6', Deal_Name: 'Clark County Remote Screening', Account_Name: { name: 'Clark County (IN)' }, Pipeline: 'JusticePoint Programs', Stage: 'Discovery', Probability: 20, Amount: 30000, Closing_Date: d(4, 10), Engagement: 3, Relationship_Strength: 2, Last_Activity_Time: ago(14) },
      { id: 's7', Deal_Name: 'Door County pretrial', Account_Name: { name: 'Door County' }, Pipeline: 'JusticePoint Programs', Stage: 'Program Design/Scoping', Probability: 35, Amount: 150000, Closing_Date: d(2, 28), Engagement: 2, Relationship_Strength: 3, Last_Activity_Time: ago(35) },
      { id: 's8', Deal_Name: 'Michigan community corrections', Account_Name: { name: 'Community Corrections Michigan' }, Pipeline: 'JusticePoint Programs', Stage: 'Budget Proposal', Probability: 70, Amount: 520000, Closing_Date: d(2, 22), Engagement: 5, Relationship_Strength: 3, Last_Activity_Time: ago(4) },
      { id: 's9', Deal_Name: 'Washington Co diversion', Account_Name: { name: 'Washington Co Sheriff' }, Pipeline: 'JusticePoint Programs', Stage: 'County/Board Approval', Probability: 90, Amount: 275000, Closing_Date: d(1, 30), Engagement: 4, Relationship_Strength: 4, Last_Activity_Time: ago(8) },
      { id: 's10', Deal_Name: 'Marquette Co Admin', Account_Name: null, Pipeline: 'JusticePoint Programs', Stage: 'Prospecting', Probability: 10, Amount: null, Closing_Date: d(5, 15), Engagement: null, Relationship_Strength: null, Last_Activity_Time: null },
      { id: 's11', Deal_Name: 'Door HHS', Account_Name: { name: 'Door Co. HHS' }, Pipeline: 'Sirona Programs', Stage: 'Discovery', Probability: 20, Amount: 88000, Closing_Date: d(2, 12), Engagement: 3, Relationship_Strength: 4, Last_Activity_Time: ago(12) },
      { id: 's12', Deal_Name: 'Milwaukee residential beds', Account_Name: { name: 'Milwaukee County BHS' }, Pipeline: 'Sirona Programs', Stage: 'Site Visit / Capacity Review', Probability: 35, Amount: 640000, Closing_Date: d(2, 18), Engagement: 4, Relationship_Strength: 5, Last_Activity_Time: ago(2) },
      { id: 's13', Deal_Name: 'Ozaukee outpatient', Account_Name: { name: 'Ozaukee County HHS' }, Pipeline: 'Sirona Programs', Stage: 'Contract and Credentialing', Probability: 85, Amount: 210000, Closing_Date: d(1, 25), Engagement: 4, Relationship_Strength: 4, Last_Activity_Time: ago(5) },
      { id: 's14', Deal_Name: 'Statewide pretrial training', Account_Name: { name: 'Wisconsin DOJ' }, Pipeline: 'TDP Pipeline', Stage: 'Solution Development', Probability: 40, Amount: 60000, Closing_Date: d(4, 1), Engagement: 1, Relationship_Strength: 2, Last_Activity_Time: ago(52) },
      { id: 's15', Deal_Name: 'Dane County assessment', Account_Name: { name: 'Dane County' }, Pipeline: 'TDP Pipeline', Stage: 'Proposal Submitted', Probability: 70, Amount: 45000, Closing_Date: d(2, 8), Engagement: 2, Relationship_Strength: 3, Last_Activity_Time: ago(19) }
    ];
  })();

  /* ---------- start ---------- */
  var obs = null, lastNarrow = null;
  try { root.addEventListener('resize', function () { var n = (root.innerWidth || 1000) < 640; if (S.view === 'quad' && lastNarrow !== null && n !== lastNarrow) { clearTimeout(root.__s51rz); root.__s51rz = setTimeout(function () { try { paint(); } catch (e) {} }, 150); } lastNarrow = n; }); } catch (e) {}
  function ensure() {
    if (html.getAttribute('data-s51') !== 'on') html.setAttribute('data-s51', 'on');
    try { paint(); } catch (e) {}
    try { tile(); } catch (e) {}
  }
  function start() {
    var z = $('z-boards');
    if (!z) { setTimeout(start, 300); return; }
    ensure();
    load().then(function () { ensure(); });
    try {
      var nt = $('needs-today');
      if (nt) { obs = new MutationObserver(function () { if (q('li[data-s51-tile]', nt)) return; clearTimeout(obs.__t); obs.__t = setTimeout(function () { try { tile(); } catch (e) {} }, 60); }); obs.observe(nt, { childList: true }); }
    } catch (e) {}
  }
  root.JPKS51 = {
    version: VERSION, build: 'S51 BD pipeline tools: board, quadrant, forecast, 30 Oct 2026', ensure: ensure, state: S,
    refresh: function () { S.list = null; S.err = null; ensure(); return load().then(ensure); },
    _model: { norm: norm, forecast: forecast, category: category, quadrant: quadrant, inThisQuarter: inThisQuarter, bands: BANDS, stages: STAGES, sample: SAMPLE }
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(window);
