/* Contract Review Band (related-list widget on Contracts), 10 Oct 2026.
   One row: ingest status, rate lines verified, clauses confirmed, documents parsed, last verified, Open review.
   Open review expands the full review (review.js, band mode) inline and resizes the widget; Close collapses it
   and re-reads the counts. Reads live, no rollup fields. */
(function () {
  'use strict';
  var api = CI.api, H = CI.H, esc = H.esc;
  var band = document.getElementById('band'), rv = document.getElementById('rv');
  var S = { open: false, c: null, clauses: null, docs: null, picks: {}, errs: {} };
  var OPEN_H = 900;

  /* review.js reads this when it loads; these are its only hooks into the page */
  CI.BAND = {
    close: close,
    onChange: function (r) { S.c = r.c; S.clauses = r.clauses; paint(); }   /* live counts while the review is open */
  };

  function fit() {
    setTimeout(function () {
      api.resizeBand(S.open ? OPEN_H : Math.min(Math.max(band.offsetHeight + 2, 100), 320));
    }, 30);
  }
  function soft(p, key) { return p.then(function (v) { delete S.errs[key]; return v; }, function (e) { S.errs[key] = H.errText(e); return null; }); }

  /* ---------------- load ---------------- */
  function load() {
    return api.init().then(function (b) {
      if (b.entity && b.entity !== 'Contracts') throw new Error('This widget belongs on a Contract record.');
      return api.contract(b.id);
    }).then(function (c) {
      S.c = c;
      return Promise.all([soft(api.clauses(), 'clauses'), soft(api.bandDocuments(), 'docs'), soft(api.picklists(), 'picks')]);
    }).then(function (r) {
      S.clauses = r[0]; S.docs = r[1]; S.picks = r[2] || {};
    });
  }
  function first() {
    load().then(paint).catch(function (e) {
      band.innerHTML = '<div class="empty">Could not load the review status: ' + esc(H.errText(e)) + '</div>'; fit();
    });
  }
  first();

  /* ---------------- counts ---------------- */
  /* current rate lines: the same rule as the Contract Terms panel (terms.js currentLines) */
  function currentLines(rows) {
    var best = {};
    (rows || []).forEach(function (r) {
      var st = H.rateState(r); if (st === 'superseded' || st === 'rejected') return;
      var k = H.rateKey(r).split('|').slice(0, 3).join('|');
      if (!best[k] || String(r.Effective_Date || '') > String(best[k].Effective_Date || '')) best[k] = r;
    });
    return Object.keys(best).map(function (k) { return best[k]; });
  }
  function counts() {
    var cur = currentLines(S.c.Rate_Lines);
    var rates = { x: cur.filter(function (r) { return H.rateState(r) === 'verified'; }).length, y: cur.length };
    var cl = S.clauses, clauses = null;
    if (cl) clauses = {
      y: cl.filter(function (k) { return k.Status !== 'Rejected'; }).length,
      x: cl.filter(function (k) { return k.Status === 'Confirmed'; }).length,
      p: cl.filter(function (k) { return k.Status === 'Proposed'; }).length
    };
    var dc = S.docs, docs = null;
    if (dc) docs = {
      y: dc.length,
      x: dc.filter(function (d) { return d.Parse_Status === 'Parsed'; }).length,
      known: dc.some(function (d) { return !H.blank(d.Parse_Status); })
    };
    return { rates: rates, clauses: clauses, docs: docs };
  }

  /* ---------------- render ---------------- */
  /* chip wording matches the Contract Terms panel; a blank status reads "Backlog" only once that picklist value exists */
  function ingestChip(s) {
    if (s === 'Ingested') return '<span class="chip good">Verified</span>';
    if (s === 'Needs Review') return '<span class="chip new">Needs review</span>';
    if (s === 'Failed') return '<span class="chip bad">Ingest failed</span>';
    if (s === 'Backlog' || (H.blank(s) && (S.picks.Ingest_Status || []).indexOf('Backlog') >= 0)) return '<span class="chip muted">Backlog</span>';
    return '<span class="chip muted">Not ingested</span>';
  }
  function tile(label, x, y, hint, opts) {
    opts = opts || {};
    var done = y > 0 && x === y, pct = y ? Math.round(x * 100 / y) : 0;
    return '<div class="tile' + (done ? ' done' : '') + '"><div class="tl">' + esc(label) + '</div>' +
      '<div class="tv num">' + x + '<small>/' + y + '</small></div>' +
      '<div class="tbar" aria-hidden="true"><i style="width:' + pct + '%"></i></div><div class="th">' + hint + '</div></div>';
  }
  function plain(label, body, hint) {
    return '<div class="tile"><div class="tl">' + esc(label) + '</div>' + body + '<div class="tbar" aria-hidden="true"></div><div class="th">' + (hint || '') + '</div></div>';
  }
  function paint() {
    var c = S.c, n = counts();
    var rateTile = n.rates.y ? tile('Rate lines verified', n.rates.x, n.rates.y, n.rates.x === n.rates.y ? 'All current lines verified' : (n.rates.y - n.rates.x) + ' to verify')
      : plain('Rate lines verified', '<div class="tv muted">No rate lines yet</div>');
    var clauseTile = !n.clauses ? plain('Clauses confirmed', '<div class="tv muted">Could not read clauses</div>', esc(S.errs.clauses || ''))
      : n.clauses.y ? tile('Clauses confirmed', n.clauses.x, n.clauses.y, n.clauses.p ? '<span class="chip new">' + n.clauses.p + ' proposed</span>' : 'None waiting')
      : plain('Clauses confirmed', '<div class="tv muted">No clauses yet</div>');
    var docTile = !n.docs ? plain('Documents parsed', '<div class="tv muted">Could not read documents</div>', esc(S.errs.docs || ''))
      : !n.docs.y ? plain('Documents parsed', '<div class="tv muted">No documents yet</div>')
      : n.docs.known ? tile('Documents parsed', n.docs.x, n.docs.y, n.docs.x === n.docs.y ? 'All parsed' : (n.docs.y - n.docs.x) + ' not parsed')
      : plain('Documents parsed', '<div class="tv muted">' + n.docs.y + ' file' + (n.docs.y === 1 ? '' : 's') + ', status not recorded yet</div>');
    var lv = c.Last_Verified ? '<div class="tv date num">' + esc(H.date(c.Last_Verified)) + '</div>' : '<div class="tv muted">Not verified yet</div>';
    var verTile = plain('Last verified', lv);
    band.innerHTML = '<div class="band"><div class="band-id"><div class="k">Ingest status</div>' + ingestChip(c.Ingest_Status) + '</div>' +
      '<div class="band-tiles">' + rateTile + clauseTile + docTile + verTile + '</div>' +
      '<div class="band-act"><button class="btn primary" id="toggle" aria-expanded="' + S.open + '" aria-controls="rv">' + (S.open ? 'Close review' : 'Open review') + '</button></div></div>';
    fit();
  }

  /* ---------------- open / close ---------------- */
  function ensureReview() {
    return new Promise(function (resolve, reject) {
      if (CI.Review) return resolve();
      var s = document.createElement('script'); s.src = 'review.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('Could not load the review screen (review.js).')); };
      document.body.appendChild(s);
    });
  }
  function open() {
    S.open = true; rv.hidden = false; paint();
    ensureReview().then(function () { CI.Review.start(); }).catch(function (e) {
      document.getElementById('app').innerHTML = '<main><div class="empty">' + esc(H.errText(e)) + '</div></main>';
    });
  }
  function close() {
    S.open = false; rv.hidden = true; paint();
    load().then(paint).catch(function () {});
  }
  band.addEventListener('click', function (e) {
    if (e.target.closest('#toggle')) { if (S.open) close(); else open(); }
  });
})();
