/* Contract Review widget (button popup on Contracts). Phase 4, 27 Sep 2026.
   A person Confirms / Edits / Rejects every value the ingest wrote, then presses Verify.
     Terms   -> Contracts fields; decisions kept in Contracts.Ingest_Review so a rerun never undoes them
     Rates   -> Rate_Lines subform: Confirm/Edit set Line_Verified; Reject sets Superseded_By = "Rejected in review"
                (never deleted, and the worker's key match keeps it from being re-inserted)
     Clauses -> Contract_Clauses.Status Proposed -> Confirmed / Rejected
     Verify  -> Ingest_Status = Ingested, Last_Verified = today (fires the Contracts workflow)
   Band mode (10 Oct 2026): band.js sets CI.BAND before loading this file and calls CI.Review.start() each time the
   review is opened inline on the Contracts page. In band mode there is no popup: no popupSize, and Close / the
   button after Verify call CI.BAND.close() instead of Popup.closeReload. Every band change is guarded by BAND. */
(function () {
  'use strict';
  var api = CI.api, H = CI.H, esc = H.esc;
  var BAND = CI.BAND || null;
  var S = { tab: 'terms', edit: null, busy: false, open: {} };
  var app = document.getElementById('app'), bar = document.getElementById('bar');

  /* ---------------- load ---------------- */
  function start() {
    S = { tab: 'terms', edit: null, busy: false, open: {} };
    if (BAND) {
      bar.innerHTML = '<div class="kicker">Contract review</div><h1>Loading…</h1>';
      app.innerHTML = '<div class="loading">Reading the contract, its rate lines and proposed clauses…</div>';
    }
    api.init().then(function (b) {
      if (!BAND) api.popupSize();
      if (b.entity && b.entity !== 'Contracts') throw new Error('This widget belongs on a Contract record.');
      return Promise.all([api.contract(b.id), api.clauses(), api.documents(), api.picklists(), api.users(), api.me()]);
    }).then(function (r) {
      S.c = r[0]; S.clauses = r[1]; S.docs = r[2]; S.picks = r[3]; S.users = r[4]; S.me = r[5];
      S.review = H.parseReview(S.c.Ingest_Review);
      S.tab = firstTabWithWork();
      render();
    }).catch(function (e) {
      bar.querySelector('h1').textContent = 'Contract review';
      app.innerHTML = '<main><div class="empty">Could not load this contract: ' + esc(H.errText(e)) + '</div></main>';
    });
  }
  if (BAND) CI.Review = { start: start }; else start();

  function reloadContract() { return api.contract().then(function (c) { S.c = c; S.review = H.parseReview(c.Ingest_Review); }); }
  function reloadClauses() { return api.clauses().then(function (x) { S.clauses = x; }); }

  /* ---------------- model ---------------- */
  function termRows() {
    var seen = {}, out = [];
    S.review.fields.forEach(function (f) { seen[f.f] = f; });
    Object.keys(seen).forEach(function (k) {
      var f = seen[k], info = H.fieldInfo(k, S.c.Counterparty_Type), d = S.review.decisions.fields[k];
      var info_only = H.blank(f.v);
      var state = d ? d.s : (info_only ? 'info' : 'pending');
      out.push({ f: f, info: info, crm: S.c[k], d: d, state: state, odd: H.unexpected(k, S.c.Counterparty_Type), order: H.FIELDS.findIndex(function (x) { return x[0] === k; }) });
    });
    return out.sort(function (a, b) { return (a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order); });
  }
  function rateRows() {
    var snip = {}; S.review.rates.forEach(function (r) { snip[r.k] = r; });
    return (S.c.Rate_Lines || []).map(function (r) { return { r: r, state: H.rateState(r), snip: snip[H.rateKey(r)] }; });
  }
  function pending() {
    var t = termRows().filter(function (x) { return x.state === 'pending'; }).length;
    var r = rateRows().filter(function (x) { return x.state === 'pending'; }).length;
    var c = S.clauses.filter(function (x) { return x.Status === 'Proposed'; }).length;
    return { terms: t, rates: r, clauses: c, all: t + r + c };
  }
  function totals() {
    var t = termRows().filter(function (x) { return x.state !== 'info'; }).length;
    var r = rateRows().filter(function (x) { return x.state !== 'hand'; }).length;
    return t + r + S.clauses.length;
  }
  function firstTabWithWork() {
    var p = pending();
    if (p.terms) return 'terms'; if (p.rates) return 'rates'; if (p.clauses) return 'clauses';
    return S.c.Ingest_Status === 'Failed' ? 'notes' : 'terms';
  }
  function verified() { return S.c.Ingest_Status === 'Ingested'; }
  function stamp() { return { by: S.me.name || '', at: H.today() }; }

  /* ---------------- render ---------------- */
  function statusChip(s) {
    var cls = { 'Needs Review': 'new', 'Ingested': 'good', 'Failed': 'bad' }[s] || 'muted';
    return '<span class="chip ' + cls + '">' + esc(s === 'Ingested' ? 'Verified' : (s || 'Not ingested')) + '</span>';
  }
  function render() {
    var c = S.c, p = pending(), tot = totals(), done = Math.max(0, tot - p.all);
    bar.innerHTML = '<div class="kicker">Review · ' + esc((H.profile(c.Counterparty_Type) || {}).title || 'Contract type not set') + '</div>' +
      '<h1>' + esc(c.Name || 'Contract') + '</h1><div class="meta">' +
      (c.Vendor && c.Vendor.name ? '<span>Vendor <b>' + esc(c.Vendor.name) + '</b></span>' : '') +
      (c.Account && c.Account.name ? '<span>' + (c.Counterparty_Type === 'Vendor' ? 'Program' : 'Account') + ' <b>' + esc(c.Account.name) + '</b></span>' : '') +
      (S.review.packet ? '<span>Packet <b>' + esc(S.review.packet) + '</b></span>' : '') +
      (c.Ingested_On ? '<span>Read <b>' + esc(H.date(c.Ingested_On)) + '</b></span>' : '') +
      (c.Last_Verified ? '<span>Last verified <b>' + esc(H.date(c.Last_Verified)) + '</b></span>' : '') +
      '</div><div class="right">' + statusChip(c.Ingest_Status) + '</div>';

    if (!S.review.fields.length && !(c.Rate_Lines || []).some(function (r) { return r.Source_Ref; }) && !S.clauses.length) {
      app.innerHTML = '<main><div class="empty"><b>Nothing to review yet.</b><br>' +
        (c.Ingest_Status === 'Failed' ? 'The last ingest failed — see the Contract ingest note on this record.' :
          'Attach the contract packet (.zip) to this Contract and press <b>Ingest Contract Packet</b>. When the read finishes, open this review again.') +
        (c.Ingest_Summary ? '<pre class="notes" style="text-align:left;margin-top:16px">' + esc(c.Ingest_Summary) + '</pre>' : '') + '</div></main>';
      return;
    }

    var pct = tot ? Math.round(done * 100 / tot) : 100;
    var pr = H.profile(c.Counterparty_Type);
    var canVerify = !verified() && p.all === 0 && !S.busy && !!pr;
    var why = verified() ? 'Already verified' : !pr ? 'Set Counterparty_Type (Vendor or Customer) first' : (p.all ? p.all + ' item' + (p.all === 1 ? '' : 's') + ' still to review' : '');
    var html = (pr ? '' : '<div class="flag" role="alert" style="margin:0;padding:10px 20px">Counterparty_Type is blank, so this review can\'t tell a vendor contract from a customer one. Set it to <b>Vendor</b> (Allied, SCRAM, SuperCom, Buddi) or <b>Customer</b> (everyone else) on the record, then reopen this review.</div>') +
      '<div class="strip"><div class="progress"><div class="lbl">' + done + ' of ' + tot + ' reviewed</div>' +
      '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div class="fill" style="width:' + pct + '%"></div></div></div>' +
      '<div class="counts"><span>Terms <b>' + p.terms + '</b></span><span>Rates <b>' + p.rates + '</b></span><span>Clauses <b>' + p.clauses + '</b></span></div>' +
      (verified() ? '<button class="btn" data-act="reopen">Reopen review</button>' : '') +
      '<button class="btn primary" data-act="verify"' + (canVerify ? '' : ' disabled title="' + esc(why) + '"') + '>Verify contract</button></div>';

    var tabs = [['terms', 'Terms', p.terms], ['rates', 'Rates', p.rates], ['clauses', 'Clauses', p.clauses], ['docs', 'Documents', null], ['notes', 'Ingest notes', null]];
    html += '<nav class="tabs" role="tablist">' + tabs.map(function (t) {
      return '<button class="tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] +
        (t[2] == null ? '' : '<span class="n' + (t[2] ? '' : ' zero') + '">' + t[2] + '</span>') + '</button>';
    }).join('') + '</nav><main>';
    html += ({ terms: renderTerms, rates: renderRates, clauses: renderClauses, docs: renderDocs, notes: renderNotes })[S.tab]();
    app.innerHTML = html + '</main>';
    var ed = app.querySelector('.edit input, .edit select, .edit textarea'); if (ed) ed.focus();
  }

  function decidedText(d) {
    var w = { confirmed: 'Confirmed', edited: 'Edited', rejected: 'Rejected' }[d.s] || d.s;
    return w + (d.by ? ' by ' + esc(d.by.split(' ')[0]) : '') + (d.at ? ' · ' + esc(H.date(d.at)) : '');
  }
  function conf(c) { return c ? '<span class="chip ' + ({ High: 'good', Medium: 'warn', Low: 'bad' }[c] || 'muted') + '">' + esc(c) + '</span>' : ''; }
  function quote(id, text, value) {
    if (!text) return '';
    return '<div class="quote' + (S.open[id] ? ' open' : '') + '" tabindex="0" data-quote="' + esc(id) + '" title="Show the whole passage"><span class="q">' + H.markIn(text, value) + '</span></div>';
  }

  /* ---- Terms ---- */
  function renderTerms() {
    var rows = termRows();
    var pend = rows.filter(function (x) { return x.state === 'pending' && x.f.w && !x.odd; }).length;
    var pr = H.profile(S.c.Counterparty_Type);
    var h = '<div class="sec-head"><h2>' + (pr ? esc(pr.title) + ' terms' : 'Contract terms') + '</h2><span class="hint">Values the ingest wrote to this Contract, each with the sentence it came from. Confirm, correct or reject each one.</span>' +
      (pend && pr && !verified() ? '<button class="btn sm" data-act="terms-all">Confirm all ' + pend + ' written</button>' : '') + '</div>';
    if (!rows.length) return h + '<div class="empty">The ingest found no term fields in this packet.</div>';
    var usual = rows.filter(function (x) { return !x.odd; }), odd = rows.filter(function (x) { return x.odd; });
    h += '<div class="rows">' + usual.map(termRow).join('') + '</div>';
    if (odd.length) h += '<div class="sec-head" style="margin-top:20px"><h2>Not usual in a ' + esc(pr.title.toLowerCase()) + '</h2>' +
      '<span class="hint">The ingest found these, but this kind of contract doesn\'t normally carry them. Check each source sentence — it may belong to a different agreement in the packet. Not included in Confirm all.</span></div>' +
      '<div class="rows">' + odd.map(termRow).join('') + '</div>';
    return h;
  }
  function termRow(x) {
    var f = x.f, info = x.info, key = 't:' + f.f, editing = S.edit === key;
    var cls = x.state === 'pending' ? '' : x.state === 'rejected' ? ' rej' : x.state === 'info' ? ' info' : ' done';
    var val, flag = '';
    var picks = S.picks[f.f], notInPick = info.kind === 'pick' && picks && picks.length && f.v != null && picks.indexOf(f.v) < 0;
    if (x.state === 'info') {
      val = '<span class="none">' + esc(f.rule || 'noted, no value') + '</span>';
    } else if (x.state === 'rejected') {
      val = '<span class="none">Cleared</span> <span class="was">packet said ' + esc(H.fmt(info, f.v)) + '</span>';
    } else if (f.w || H.blank(f.v)) {
      val = H.blank(x.crm) ? '<span class="none">empty</span>' : esc(H.fmt(info, x.crm));
      if (x.d && x.d.s === 'edited' && String(x.d.v) !== String(f.v)) val += '<span class="was">packet said ' + esc(H.fmt(info, f.v)) + '</span>';
    } else {
      val = esc(H.fmt(info, f.v)) + '<span class="was">' + (H.blank(x.crm) ? 'not written' : 'CRM has ' + esc(H.fmt(info, x.crm))) + '</span>';
      flag = notInPick ? '“' + esc(f.v) + '” is not a ' + esc(info.label) + ' picklist value — add it in Setup › Fields, then Apply.' :
        (H.blank(x.crm) ? 'Found in the packet but not written (' + esc(f.c === 'Low' ? 'low confidence' : 'see Ingest notes') + ').' : 'The packet disagrees with the value already on the record; the ingest left it alone.');
    }
    var acts = '';
    if (verified()) acts = x.d ? '<div class="state">' + decidedText(x.d) + '</div>' : '';
    else if (editing) acts = '';
    else if (x.state === 'pending' && (f.w || H.blank(f.v))) acts = btn('ok', 't-confirm', key, 'Confirm') + btn('', 't-edit', key, 'Edit') + btn('no', 't-reject', key, 'Reject');
    else if (x.state === 'pending') acts = btn('ok', 't-apply', key, 'Apply', notInPick) + btn('', 't-edit', key, 'Edit') + btn('', 't-keep', key, H.blank(x.crm) ? 'Leave empty' : 'Keep CRM value');
    else if (x.d) acts = '<div class="state">' + decidedText(x.d) + '<br><button class="btn link sm" data-act="t-undo" data-k="' + esc(key) + '">Undo</button></div>';
    var body = '<div class="val num">' + val + '</div>' +
      (editing ? termEditor(x) : '') +
      '<div class="cite">' + conf(f.c) + '<span>' + esc(H.cite(f.src)) + '</span>' + (f.rule ? '<span>· ' + esc(f.rule) + '</span>' : '') + '</div>' +
      quote(key, f.ev, f.v) + (flag ? '<div class="flag">' + flag + '</div>' : '');
    return '<div class="row' + cls + '"><div class="lab">' + esc(info.label) + '<small>' + esc(f.f) + '</small></div><div>' + body + '</div><div class="acts">' + acts + '</div></div>';
  }
  function btn(cls, act, key, label, disabled) {
    return '<button class="btn sm ' + cls + '" data-act="' + act + '" data-k="' + esc(key) + '"' + (disabled || S.busy ? ' disabled' : '') + '>' + label + '</button>';
  }
  function inputFor(info, v, name) {
    name = name || 'v';
    if (info.kind === 'pick') {
      var opts = (S.picks[info.api] || []).slice(); if (v && opts.indexOf(v) < 0) opts.unshift(v);
      return '<select name="' + name + '"><option value="">— empty —</option>' + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    }
    if (info.kind === 'date') return '<input type="date" name="' + name + '" value="' + esc(v || '') + '">';
    if (info.kind === 'text') return '<input type="text" name="' + name + '" value="' + esc(v || '') + '" style="flex:1;min-width:260px" maxlength="2000">';
    return '<input type="number" name="' + name + '" step="' + (info.kind === 'int' ? '1' : '0.01') + '" value="' + esc(v == null ? '' : v) + '">' + (info.unit ? ' <span>' + info.unit + '</span>' : info.kind === 'pct' ? ' %' : '');
  }
  function termEditor(x) {
    var v = !H.blank(x.crm) ? x.crm : x.f.v;
    return '<form class="edit" data-form="t" data-k="t:' + esc(x.f.f) + '">' + inputFor(x.info, v) +
      '<button class="btn sm primary" type="submit">Save</button><button class="btn sm" type="button" data-act="cancel">Cancel</button></form>';
  }
  function coerce(info, raw) {
    if (raw == null || raw === '') return null;
    if (info.kind === 'int') return Math.round(Number(raw));
    if (info.kind === 'pct' || info.kind === 'money') return Number(raw);
    return String(raw);
  }

  /* ---- Rates ---- */
  function renderRates() {
    var rows = rateRows();
    var pend = rows.filter(function (x) { return x.state === 'pending'; }).length;
    var h = '<div class="sec-head"><h2>Rate lines</h2><span class="hint">' + esc((H.profile(S.c.Counterparty_Type) || {}).rates || '') + ' Every line on this Contract. Ingested lines need a Confirm (sets Line verified) or a Reject (kept, marked rejected, never deleted). Hand-entered lines are shown for context.</span>' +
      (pend && !verified() ? '<button class="btn sm" data-act="r-all">Confirm all ' + pend + '</button>' : '') + '</div>';
    if (!rows.length) return h + '<div class="empty">No rate lines on this Contract.</div>';
    var groups = {};
    rows.forEach(function (x) { (groups[x.r.Rate_Device || 'Other'] = groups[x.r.Rate_Device || 'Other'] || []).push(x); });
    var byId = {}; rows.forEach(function (x) { byId[x.r.id] = x.r; });
    h += '<table class="t rt"><thead><tr><th>Tier</th><th class="r">$ / day</th><th>Effective</th><th>Source</th><th>Conf.</th><th>State</th><th class="r"></th></tr></thead><tbody>';
    Object.keys(groups).sort().forEach(function (g) {
      h += '<tr class="grp"><td colspan="7">' + esc(g) + '</td></tr>';
      groups[g].sort(function (a, b) { return (Number(a.r.Tier_Min_Units) || 0) - (Number(b.r.Tier_Min_Units) || 0) || String(a.r.Effective_Date || '').localeCompare(String(b.r.Effective_Date || '')); })
        .forEach(function (x) { h += rateRow(x, byId); });
    });
    return h + '</tbody></table>';
  }
  function tierText(r) {
    var a = Number(r.Tier_Min_Units) || 0, b = Number(r.Tier_Max_Units) || 0;
    if (!a && !b) return 'All units'; return b ? a + '–' + b : a + '+';
  }
  function rateRow(x, byId) {
    var r = x.r, key = 'r:' + r.id, st = x.state, editing = S.edit === key;
    var dim = st === 'superseded' || st === 'rejected';
    var state = { pending: '<span class="chip new">To review</span>', verified: '<span class="chip good">Verified</span>', hand: '<span class="chip muted">Hand-entered</span>',
      rejected: '<span class="chip muted">Rejected</span>', superseded: '<span class="chip muted">Superseded</span>' }[st];
    if (st === 'superseded' && byId[r.Superseded_By]) { var n = byId[r.Superseded_By]; state += ' <small>by ' + H.money(n.Rate_Daily_Amount) + ' eff ' + esc(H.date(n.Effective_Date)) + '</small>'; }
    var acts = '';
    if (!verified() && !editing) {
      if (st === 'pending') acts = btn('ok', 'r-confirm', key, 'Confirm') + btn('', 'r-edit', key, 'Edit') + btn('no', 'r-reject', key, 'Reject');
      else if (st === 'hand') acts = btn('', 'r-confirm', key, 'Verify');
      else if (st === 'verified' || st === 'rejected') acts = '<button class="btn link sm" data-act="r-undo" data-k="' + esc(key) + '">Undo</button>';
    }
    var h = '<tr class="' + (dim ? 'dim' : '') + '"><td>' + esc(tierText(r)) + '</td><td class="r num"><span class="amt">' + H.money(r.Rate_Daily_Amount) + '</span></td><td class="num">' + esc(H.date(r.Effective_Date)) +
      '</td><td>' + esc(H.cite(r.Source_Ref)) + (r.Rate_Terms ? '<br><small style="color:var(--muted)">' + esc(r.Rate_Terms) + '</small>' : '') +
      (x.snip && x.snip.ev ? quote(key, x.snip.ev, r.Rate_Daily_Amount) : '') + '</td><td>' + conf(r.Confidence) + '</td><td>' + state + '</td><td class="r"><div class="acts">' + acts + '</div></td></tr>';
    if (editing) {
      h += '<tr><td colspan="7"><form class="edit" data-form="r" data-k="' + esc(key) + '"><div class="grid">' +
        '<label>$ / day<input type="number" step="0.01" name="amt" value="' + esc(r.Rate_Daily_Amount) + '" required></label>' +
        '<label>Tier min<input type="number" step="1" name="tmin" value="' + esc(r.Tier_Min_Units == null ? '' : r.Tier_Min_Units) + '"></label>' +
        '<label>Tier max<input type="number" step="1" name="tmax" value="' + esc(r.Tier_Max_Units == null ? '' : r.Tier_Max_Units) + '"></label>' +
        '<label>Effective<input type="date" name="eff" value="' + esc(r.Effective_Date || '') + '"></label></div>' +
        '<button class="btn sm primary" type="submit">Save and verify</button><button class="btn sm" type="button" data-act="cancel">Cancel</button></form></td></tr>';
    }
    return h;
  }

  /* ---- Clauses ---- */
  function renderClauses() {
    var list = S.clauses.slice().sort(function (a, b) { return (a.Status === 'Proposed' ? 0 : 1) - (b.Status === 'Proposed' ? 0 : 1); });
    var pend = list.filter(function (k) { return k.Status === 'Proposed'; }).length;
    var h = '<div class="sec-head"><h2>Obligations and special work</h2><span class="hint">' + esc((H.profile(S.c.Counterparty_Type) || {}).clauses || 'Things JusticePoint must do, staff, send or hold the other party to.') + ' Confirmed clauses show on the Account and in “Ops - Confirmed obligations”.</span>' +
      (pend > 1 && !verified() ? '<button class="btn sm" data-act="c-all">Confirm all ' + pend + '</button>' : '') + '</div>';
    if (!list.length) return h + '<div class="empty">The ingest proposed no clauses for this packet.</div>';
    return h + '<div class="rows">' + list.map(clauseRow).join('') + '</div>';
  }
  function clauseRow(k) {
    var key = 'c:' + k.id, editing = S.edit === key;
    var cls = k.Status === 'Proposed' ? '' : k.Status === 'Rejected' ? ' rej' : ' done';
    var meta = [k.Cadence, k.Due_Date ? 'due ' + H.date(k.Due_Date) : '', k.Owner && k.Owner.name ? 'owner ' + k.Owner.name : ''].filter(Boolean).join(' · ');
    var acts = '';
    if (!verified() && !editing) {
      if (k.Status === 'Proposed') acts = btn('ok', 'c-confirm', key, 'Confirm') + btn('', 'c-edit', key, 'Edit') + btn('no', 'c-reject', key, 'Reject');
      else acts = '<div class="state">' + esc(k.Status) + '<br><button class="btn link sm" data-act="c-undo" data-k="' + esc(key) + '">Undo</button></div>';
    } else if (verified()) acts = '<div class="state">' + esc(k.Status) + '</div>';
    var body = editing ? clauseEditor(k) :
      '<div class="val" style="font-size:14px">' + esc(k.Title || k.Name) + '</div>' +
      '<div class="cite">' + conf(k.Confidence) + '<span>' + esc(H.cite(k.Source_Ref)) + '</span>' + (meta ? '<span>· ' + esc(meta) + '</span>' : '') + '</div>' +
      quote(key, k.Clause_Text);
    return '<div class="row' + cls + '"><div class="lab"><span class="chip teal">' + esc(k.Clause_Type || 'Other') + '</span></div><div>' + body + '</div><div class="acts">' + acts + '</div></div>';
  }
  function clauseEditor(k) {
    var types = S.picks.Clause_Type || [];
    return '<form class="edit" data-form="c" data-k="c:' + esc(k.id) + '"><div class="grid">' +
      '<label style="grid-column:1/-1">Title<input type="text" name="title" maxlength="255" value="' + esc(k.Title || '') + '" required></label>' +
      '<label>Type<select name="type">' + types.map(function (t) { return '<option' + (t === k.Clause_Type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      '<label>Cadence<input type="text" name="cadence" maxlength="255" value="' + esc(k.Cadence || '') + '" placeholder="e.g. Monthly"></label>' +
      '<label>Due date<input type="date" name="due" value="' + esc(k.Due_Date || '') + '"></label>' +
      '<label>Owner<select name="owner"><option value="">— unchanged —</option>' + S.users.map(function (u) { return '<option value="' + esc(u.id) + '"' + (k.Owner && String(k.Owner.id) === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select></label>' +
      '<label style="grid-column:1/-1">Clause text<textarea name="text">' + esc(k.Clause_Text || '') + '</textarea></label></div>' +
      '<button class="btn sm primary" type="submit">Save and confirm</button><button class="btn sm" type="button" data-act="cancel">Cancel</button></form>';
  }

  /* ---- Documents / notes ---- */
  function renderDocs() {
    var h = '<div class="sec-head"><h2>Documents in the packet</h2><span class="hint">In the order the ingest applied them — a later document wins for the same device and tier.</span></div>';
    if (!S.docs.length) return h + '<div class="empty">No Contract Documents rows yet.</div>';
    return h + '<table class="t"><thead><tr><th>#</th><th>File</th><th>Type</th><th>Effective</th><th class="r">Pages</th><th>Text layer</th><th>Applies to</th></tr></thead><tbody>' +
      S.docs.map(function (d) {
        return '<tr><td class="num">' + esc(d.Sequence || '') + '</td><td>' + esc(d.File_Name) + '</td><td>' + esc(d.Doc_Type || '') + '</td><td class="num">' + esc(H.date(d.Effective_Date)) +
          '</td><td class="r num">' + esc(d.Pages || '') + '</td><td>' + (d.Text_Layer === 'No' ? '<span class="chip bad">No — OCR and re-upload</span>' : '<span class="chip good">Yes</span>') +
          '</td><td>' + esc(d.Applies_To_Contracts || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function renderNotes() {
    var t = S.c.Ingest_Summary || '';
    var h = '<div class="sec-head"><h2>Ingest notes</h2><span class="hint">The head of the last read. The full text is in this record’s Notes (“Contract ingest”). Conflicts and values that were not written are highlighted.</span></div>';
    if (!t) return h + '<div class="empty">No ingest summary on this record.</div>';
    return h + '<pre class="notes">' + t.split('\n').map(function (l) {
      return /CONFLICT|not written|Not written|Differs|no text layer|Rejected in review|could not/i.test(l) ? '<span class="hl">' + esc(l) + '</span>' : esc(l);
    }).join('\n') + '</pre>';
  }

  /* ---------------- actions ---------------- */
  function run(label, p) {
    S.busy = true; render();
    return p.then(function () { S.busy = false; S.edit = null; render(); if (BAND && BAND.onChange) BAND.onChange(S); if (label) H.toast(label); })
      .catch(function (e) { S.busy = false; render(); H.toast('Not saved: ' + H.errText(e), true); });
  }
  function saveDecision(fld, dec, fieldValue, setField) {
    var rv = H.parseReview(S.c.Ingest_Review);
    if (dec) rv.decisions.fields[fld] = Object.assign({ s: dec.s, v: dec.v }, stamp()); else delete rv.decisions.fields[fld];
    var data = { Ingest_Review: JSON.stringify(rv) };
    if (setField) data[fld] = fieldValue;
    return api.updateContract(data).then(reloadContract);
  }
  function termByKey(k) { var f = k.slice(2); return termRows().filter(function (x) { return x.f.f === f; })[0]; }
  function rateUpdate(changes) {   /* changes: {rowId: {...}}; every existing row id is sent back, or Zoho deletes it */
    var rows = (S.c.Rate_Lines || []).map(function (r) { return Object.assign({ id: r.id }, changes[r.id] || {}); });
    return api.updateContract({ Rate_Lines: rows }).then(reloadContract);
  }

  app.addEventListener('click', function (e) {
    var q = e.target.closest('[data-quote]');
    if (q && !e.target.closest('button')) { S.open[q.getAttribute('data-quote')] = !S.open[q.getAttribute('data-quote')]; q.classList.toggle('open'); return; }
    var tab = e.target.closest('[data-tab]');
    if (tab) { S.tab = tab.getAttribute('data-tab'); S.edit = null; render(); return; }
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    var act = b.getAttribute('data-act'), k = b.getAttribute('data-k');
    var x, id;
    switch (act) {
      case 'cancel': S.edit = null; render(); break;
      case 't-edit': case 'r-edit': case 'c-edit': S.edit = k; render(); break;
      case 't-confirm': x = termByKey(k); run('Confirmed', saveDecision(x.f.f, { s: 'confirmed', v: x.crm })); break;
      case 't-keep': x = termByKey(k); run('Kept as is', saveDecision(x.f.f, { s: 'confirmed', v: x.crm })); break;
      case 't-apply': x = termByKey(k); run('Written to the Contract', saveDecision(x.f.f, { s: 'edited', v: x.f.v }, x.f.v, true)); break;
      case 't-reject': x = termByKey(k); run('Rejected — field cleared', saveDecision(x.f.f, { s: 'rejected', v: null }, null, true)); break;
      case 't-undo': x = termByKey(k); run('Back to review', saveDecision(x.f.f, null)); break;
      case 'terms-all':
        var todo = termRows().filter(function (t) { return t.state === 'pending' && t.f.w && !t.odd; });
        H.confirmDialog('Confirm ' + todo.length + ' term values?', 'Each value stays exactly as it is on the Contract and is marked confirmed. Unwritten findings still need a decision.', 'Confirm all').then(function (ok) {
          if (!ok) return;
          var rv = H.parseReview(S.c.Ingest_Review);
          todo.forEach(function (t) { rv.decisions.fields[t.f.f] = Object.assign({ s: 'confirmed', v: t.crm }, stamp()); });
          run(todo.length + ' confirmed', api.updateContract({ Ingest_Review: JSON.stringify(rv) }).then(reloadContract));
        });
        break;
      case 'r-confirm': id = k.slice(2); run('Line verified', rateUpdate(obj(id, { Line_Verified: true }))); break;
      case 'r-reject': id = k.slice(2); run('Line rejected (kept, not current)', rateUpdate(obj(id, { Superseded_By: H.REJECTED, Line_Verified: false }))); break;
      case 'r-undo': id = k.slice(2); x = rateRows().filter(function (r) { return r.r.id === id; })[0];
        run('Back to review', rateUpdate(obj(id, x.state === 'rejected' ? { Superseded_By: null } : { Line_Verified: false }))); break;
      case 'r-all':
        var rs = rateRows().filter(function (r) { return r.state === 'pending'; });
        H.confirmDialog('Verify ' + rs.length + ' rate lines?', 'Sets Line verified on each ingested line as it stands. A later ingest will never change a verified line.', 'Verify all').then(function (ok) {
          if (!ok) return; var ch = {}; rs.forEach(function (r) { ch[r.r.id] = { Line_Verified: true }; }); run(rs.length + ' lines verified', rateUpdate(ch));
        });
        break;
      case 'c-confirm': run('Clause confirmed', api.updateClause({ id: k.slice(2), Status: 'Confirmed' }).then(reloadClauses)); break;
      case 'c-reject': run('Clause rejected — it will not be proposed again', api.updateClause({ id: k.slice(2), Status: 'Rejected' }).then(reloadClauses)); break;
      case 'c-undo': run('Back to proposed', api.updateClause({ id: k.slice(2), Status: 'Proposed' }).then(reloadClauses)); break;
      case 'c-all':
        var cs = S.clauses.filter(function (c) { return c.Status === 'Proposed'; });
        H.confirmDialog('Confirm ' + cs.length + ' clauses as written?', 'Better to read each one — this confirms them all with their current title, type and text.', 'Confirm all').then(function (ok) {
          if (!ok) return;
          run(cs.length + ' clauses confirmed', cs.reduce(function (p, c) { return p.then(function () { return api.updateClause({ id: c.id, Status: 'Confirmed' }); }); }, Promise.resolve()).then(reloadClauses));
        });
        break;
      case 'verify':
        H.confirmDialog('Verify this contract?', 'Sets Ingest status to <b>Ingested</b> and Last verified to today. From now on a re-ingest only fills fields that are still empty and lists any differences in the note. The Contracts workflow recomputes margin.', 'Verify').then(function (ok) {
          if (!ok) return;
          run('Contract verified', api.updateContract({ Ingest_Status: 'Ingested', Last_Verified: H.today() }).then(reloadContract)).then(function () {
            app.querySelector('.strip').insertAdjacentHTML('beforeend', '<button class="btn" data-act="close">' + (BAND ? 'Close review' : 'Close and reload record') + '</button>');
          });
        });
        break;
      case 'reopen':
        H.confirmDialog('Reopen the review?', 'Sets Ingest status back to Needs Review. Nothing you confirmed is undone.', 'Reopen').then(function (ok) {
          if (ok) run('Review reopened', api.updateContract({ Ingest_Status: 'Needs Review' }).then(reloadContract));
        });
        break;
      case 'close': if (BAND) BAND.close(); else api.close(); break;
    }
  });
  function obj(k, v) { var o = {}; o[k] = v; return o; }

  app.addEventListener('keydown', function (e) {
    var q = e.target.closest && e.target.closest('[data-quote]');
    if (q && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); q.click(); }
    if (e.key === 'Escape' && S.edit) { S.edit = null; render(); }
  });

  app.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, kind = f.getAttribute('data-form'), k = f.getAttribute('data-k'), v = function (n) { return f.elements[n] ? f.elements[n].value : ''; };
    if (kind === 't') {
      var x = termByKey(k), val = coerce(x.info, v('v'));
      run('Saved', saveDecision(x.f.f, { s: 'edited', v: val }, val, true));
    } else if (kind === 'r') {
      var num = function (n) { return v(n) === '' ? null : Number(v(n)); };
      run('Line saved and verified', rateUpdate(obj(k.slice(2), { Rate_Daily_Amount: num('amt'), Tier_Min_Units: num('tmin'), Tier_Max_Units: num('tmax'), Effective_Date: v('eff') || null, Line_Verified: true })));
    } else if (kind === 'c') {
      var data = { id: k.slice(2), Title: v('title'), Name: v('title').slice(0, 120), Clause_Type: v('type'), Cadence: v('cadence'), Due_Date: v('due') || null, Clause_Text: v('text'), Status: 'Confirmed' };
      if (v('owner')) data.Owner = { id: v('owner') };
      run('Clause saved and confirmed', api.updateClause(data).then(reloadClauses));
    }
  });
})();
