/* processes-margins.js v1.0.1 (5 Nov 2026: widget COQL returns lookups as ids, so Account.Account_Name and Rate_Vendor.Vendor_Name are selected for the names) + v1.0 (5 Nov 2026): Processes > Contract > Margins. Where customer margins are worked (Beau, 5 Nov 2026).
   One row per live customer rate line, priced against the vendor's pricing card (rules in margins-model.js). Lanes: below target,
   no vendor or cost, unverified rate, at or above target. Click a row for the line's detail.

   Administrators can work the line in the detail card:
     Verify            the line's Line_Status -> Verified (Line_Verified true, Superseded_By cleared), same three fields Contract Review writes.
     Set vendor        Rate_Vendor on the line, in place (fixes "No vendor"; the rate itself is unchanged).
     Change rate       supersede: a new Verified line with the new amount and effective date, the old line marked Superseded with Superseded_By =
                       the new line's id. History is kept.
   Every write goes through the contract (Rate_Lines is a subform): read the contract fresh, send EVERY existing row id (a row left out is
   deleted), then read again and stop with a message if any row is missing. Workflows run, so the contract margin check recomputes.
   Vendor costs are not edited here: the vendor card is shared by every customer, so "Open vendor card" opens it in CRM.
   Everyone else sees the view read-only. Demo mode (outside Zoho) previews and saves nothing. */
(function () {
  'use strict';
  var MM = window.ProcMarginsModel, X, root;
  var PAGE = 200, CAP = 5000, SAVE_MS = 20000;
  var S = { contracts: [], lines: [], vendors: [], built: null, loaded: false, busy: false, err: '', lane: 'below', sel: null, admin: null, saving: false, msg: '', msgTone: '' };
  function esc(s) { return X.esc(s); }
  function $(id) { return document.getElementById(id); }
  function money(n) { return n == null ? '' : '$' + Number(n).toFixed(2); }
  function pct(n) { return n == null ? '' : Number(n).toFixed(1) + '%'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function tone(r) { return r.pct == null ? '' : r.pct < 0 ? 'bad' : r.gap < 0 ? 'warn' : 'good'; }

  /* ---------- reads ---------- */
  function pageAll(base) {
    var all = [];
    function page(off) { return X.coql(base + ' order by id asc limit ' + PAGE + ' offset ' + off).then(function (res) { all = all.concat(res.rows); return res.rows.length >= PAGE && all.length < CAP ? page(off + PAGE) : all; }); }
    return page(0);
  }
  function load(force) {
    if (S.busy || (S.loaded && !force)) return Promise.resolve();
    S.busy = true; S.err = '';
    if (!X.isLive()) { var d = window.PROC_DEMO.margins; S.contracts = d.contracts; S.lines = d.lines; S.vendors = d.vendors; return Promise.resolve(done()); }
    return Promise.all([
      pageAll("select id, Name, Account, Account.Account_Name, Vendor, Counterparty_Type, Contract_Status, Rate_Basis from Contracts where Counterparty_Type in ('Customer','Vendor')"),
      pageAll("select id, Parent_Id, Rate_Type, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Effective_Date from Rate_Lines where Rate_Type in ('Customer rate','Vendor cost')"),
      pageAll('select id, Vendor_Name from Vendors where id is not null').catch(function () { return []; })
    ]).then(function (r) { S.contracts = r[0]; S.lines = r[1]; S.vendors = r[2].map(function (v) { return { id: String(v.id), name: v.Vendor_Name || String(v.id) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); done(); },
      function (e) { S.err = (e && e.message) || 'Read failed'; S.loaded = true; S.busy = false; });
  }
  function done() { S.built = MM.build(S.contracts, S.lines, today()); S.loaded = true; S.busy = false; }

  /* ---------- writes: always the full Rate_Lines list ---------- */
  function sdk() { return window.ZOHO.CRM.API; }
  function timeout(p) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, SAVE_MS); })]); }
  function readLines(cid) {
    return timeout(sdk().getRecord({ Entity: 'Contracts', RecordID: cid })).then(function (r) {
      var rec = r && r.data && r.data[0];
      if (!rec || !Array.isArray(rec.Rate_Lines)) throw new Error('Could not read the contract\'s rate lines, so nothing was changed');
      return rec.Rate_Lines;
    });
  }
  function writeLines(cid, rows) {
    return timeout(sdk().updateRecord({ Entity: 'Contracts', APIData: { id: cid, Rate_Lines: rows }, Trigger: ['workflow'] })).then(function (r) {
      var x = r && r.data && r.data[0]; if (!x) throw new Error('No answer from Zoho');
      if (x.code && x.code !== 'SUCCESS') throw new Error((x.message || x.code) + (x.details && x.details.api_name ? ' (' + x.details.api_name + ')' : ''));
    });
  }
  /* one write: changes {rowId: fields}, add: a new row or null. Checks every existing row survived. Resolves with the rows after. */
  function save(cid, changes, add) {
    return readLines(cid).then(function (before) {
      var p = MM.fullPayload(before, changes, add);
      if (!p) throw new Error('That line is no longer on the contract. Refresh and try again');
      return writeLines(cid, p).then(function () { return readLines(cid); }).then(function (after) {
        var have = {}; after.forEach(function (l) { have[String(l.id)] = 1; });
        var lost = before.filter(function (l) { return !have[String(l.id)]; }).length;
        if (lost) throw new Error('Zoho dropped ' + lost + ' of ' + before.length + ' rate lines on this contract. Check its Rate Lines now');
        return { before: before, after: after };
      });
    });
  }
  function verify(r) { var ch = {}; ch[r.id] = MM.verifyFields(); return save(r.contractId, ch, null).then(function () { return 'Verified ' + r.device + ' on ' + r.contract; }); }
  function setVendor(r, vid) { var ch = {}; ch[r.id] = { Rate_Vendor: { id: vid } }; return save(r.contractId, ch, null).then(function () { return 'Vendor set on ' + r.device + ' for ' + r.contract; }); }
  function changeRate(r, amount, eff, note) {
    var ref = 'Processes > Margins ' + today() + (note ? ': ' + note : '');
    var add = { Rate_Type: 'Customer rate', Rate_Device: r.device, Rate_Daily_Amount: amount, Rate_Terms: r.terms || null, Line_Status: 'Verified', Line_Verified: true, Confidence: 'High', Effective_Date: eff, Source_Ref: ref };
    if (r.vendorId) add.Rate_Vendor = { id: r.vendorId };
    var ch = {}; ch[r.id] = { Line_Status: 'Superseded', Line_Verified: false };
    return save(r.contractId, ch, add).then(function (x) {
      var known = {}; x.before.forEach(function (l) { known[String(l.id)] = 1; });
      var made = x.after.filter(function (l) { return !known[String(l.id)] && l.Rate_Device === r.device; }).pop();
      if (!made) return 'New rate saved, but the new line was not found to link the old one. Check the contract';
      var ch2 = {}; ch2[r.id] = { Superseded_By: String(made.id) };
      return save(r.contractId, ch2, null).then(function () { return r.device + ' rate on ' + r.contract + ' is now ' + money(amount) + ' (old line superseded)'; });
    });
  }
  function run(p) {
    S.saving = true; S.msg = 'Saving…'; S.msgTone = ''; draw();
    p.then(function (m) { S.saving = false; S.msg = m; S.msgTone = 'good'; X.toast('Saved'); return load(true); },
      function (e) { S.saving = false; S.msg = 'Not saved: ' + ((e && e.message) || 'Zoho refused the change'); S.msgTone = 'bad'; })
      .then(function () { S.sel = null; draw(); });
  }

  /* ---------- render ---------- */
  function lanes() { var rows = S.built ? S.built.rows : []; return MM.LANES.map(function (l) { var items = rows.filter(l.test); return { id: l.id, label: l.label, kpi: l.kpi, items: items, count: items.length }; }); }
  function flagsHtml(r) { return r.flags.map(function (f) { return X.pillHtml(f, /Negative|No vendor|No monitoring/.test(f) ? 'bad' : 'warn'); }).join(' '); }
  function tableHtml(items) {
    var h = '<div class="tw"><table><thead><tr><th scope="col">Customer</th><th scope="col">Contract</th><th scope="col">Device</th><th scope="col">Vendor</th><th scope="col" class="r">Rate / day</th><th scope="col" class="r">Cost / day</th><th scope="col" class="r">Margin / day</th><th scope="col" class="r">Margin %</th><th scope="col" class="r">Gap to ' + S.built.target + '%</th><th scope="col">Flags</th></tr></thead><tbody>';
    items.slice(0, 400).forEach(function (r, i) {
      h += '<tr data-i="' + i + '" class="click" tabindex="0"><td><b>' + esc(r.account || 'No account') + '</b></td><td>' + esc(r.contract) + '</td><td>' + esc(r.device) + (r.bought ? ' <span class="mut">(owned)</span>' : '') + '</td><td>' + esc(r.vendor || '') + '</td>' +
        '<td class="r">' + esc(money(r.rate)) + '</td><td class="r">' + esc(money(r.cost)) + '</td><td class="r">' + esc(money(r.marginDay)) + '</td><td class="r">' + (r.pct == null ? '' : X.pillHtml(pct(r.pct), tone(r))) + '</td>' +
        '<td class="r">' + esc(r.gap == null ? '' : (r.gap > 0 ? '+' : '') + r.gap.toFixed(1)) + '</td><td>' + flagsHtml(r) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function detailHtml(r) {
    var dl = [['Customer', r.account], ['Contract', r.contract + (r.contractStatus ? ' (' + r.contractStatus + ')' : '')], ['Device', r.device + (r.bought ? ', purchased units' : '')], ['Vendor', r.vendor || 'None'],
      ['Customer rate / day', money(r.rate)], ['Vendor cost / day', r.cost == null ? 'None' : money(r.cost) + (r.card ? ' from ' + r.card : '')], ['Margin', r.pct == null ? 'Unknown' : money(r.marginDay) + ' / day, ' + pct(r.pct) + ' (' + r.tier + ')'],
      ['Line status', r.status], ['Effective', r.effective || 'Not set'], ['Terms', r.terms || '']];
    var h = '<div class="cards"><section class="card" id="det"><h3>' + esc(r.account + ' · ' + r.device) + '</h3><dl>' + dl.map(function (d) { return '<dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd>'; }).join('') + '</dl>';
    if (S.admin) {
      var dis = S.saving ? ' disabled' : '';
      h += '<h4 style="margin:14px 0 6px;font-size:13px">Work this line</h4><div class="mform">';
      if (r.status !== 'Verified') h += '<div class="mrow"><button type="button" class="btn pri" data-a="verify"' + dis + '>Verify this rate</button><span class="mut">Marks it Verified, the same as Contract Review.</span></div>';
      h += '<div class="mrow"><label>Vendor <select id="m-vendor"><option value="">Choose a vendor</option>' + S.vendors.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === r.vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('') + '</select></label><button type="button" class="btn" data-a="vendor"' + dis + '>Set vendor</button></div>';
      h += '<div class="mrow"><label>New rate / day <input type="number" id="m-rate" step="0.01" min="0" max="100" value="' + esc(r.rate == null ? '' : r.rate) + '"></label><label>Effective <input type="date" id="m-eff" value="' + today() + '"></label><label>Note <input type="text" id="m-note" maxlength="150" placeholder="Why it changed"></label><button type="button" class="btn" data-a="rate"' + dis + '>Change rate</button></div>';
      h += '<p class="mut" style="margin:6px 0 0;font-size:12px">Change rate keeps history: a new Verified line is added and this one is marked Superseded. Vendor costs are shared by every customer on that vendor, so they are changed on the vendor card.</p></div>';
    }
    if (S.msg) h += '<p class="mmsg ' + S.msgTone + '" role="status">' + esc(S.msg) + '</p>';
    h += '<div class="acts"><button type="button" class="btn" data-a="contract">Open contract</button>' + (r.cardId ? '<button type="button" class="btn" data-a="card">Open vendor card</button>' : '') + (r.accountId ? '<button type="button" class="btn" data-a="acct">Open account</button>' : '') + '<button type="button" class="btn" data-a="close">Close</button></div></section></div>';
    return h;
  }
  function draw() {
    var ls = lanes(), lane = ls.filter(function (l) { return l.id === S.lane; })[0] || ls[0];
    var h = '<div class="wrap">' + X.head('Processes', 'Margins', 'Customer rate against vendor cost for every live customer rate line. Target ' + MM.TARGET + '%. Rate only, no volume weighting.', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
    if (S.err) h += '<div class="err">Could not read contracts or rate lines: ' + esc(S.err) + '</div>';
    h += '<div class="kpis">' + ls.map(function (l) { return l.kpi ? '<button type="button" class="kpi ' + (l.count ? l.kpi : '') + '" data-ln="' + l.id + '" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><div class="l">' + esc(l.label) + '</div><div class="v">' + l.count + '</div></button>' : ''; }).join('') + '</div>';
    h += '<div class="bar" role="group" aria-label="Lane">' + ls.map(function (l) { return '<button type="button" class="pillbtn" data-ln="' + l.id + '" aria-pressed="' + (l.id === lane.id) + '">' + esc(l.label) + ' (' + l.count + ')</button>'; }).join('') + '</div>';
    if (!S.loaded) h += X.skel ? X.skel() : '<div class="empty">Loading…</div>';
    else if (!lane.items.length) h += '<div class="empty"><b>Nothing here</b></div>';
    else h += tableHtml(lane.items);
    var cur = S.sel != null && lane.items[S.sel];
    if (cur) h += detailHtml(cur);
    else if (S.msg && !S.saving) h += '<p class="mmsg ' + S.msgTone + '" role="status" style="padding:0 24px">' + esc(S.msg) + '</p>';
    h += '<p class="mut" style="padding:12px 24px 0;font-size:12px">' + (S.admin ? 'Administrators can verify, set the vendor and change the rate on a line; every save keeps all of the contract\'s other rate lines.' : 'Read-only. Administrators work the lines here.') + ' Purchased units are priced against the vendor\'s monitoring-only cost.</p></div>';
    root.innerHTML = h; X.bindSwitch();
    $('rf').onclick = function () { S.msg = ''; load(true).then(function () { draw(); X.toast('Refreshed'); }); };
    root.onclick = function (e) {
      var t;
      if ((t = e.target.closest('[data-ln]'))) { S.lane = t.getAttribute('data-ln'); S.sel = null; S.msg = ''; draw(); return; }
      if ((t = e.target.closest('button[data-a]'))) { act(t.getAttribute('data-a'), cur); return; }
      if (e.target.closest('#det')) return;
      if ((t = e.target.closest('tr[data-i]'))) { S.sel = +t.getAttribute('data-i'); S.msg = ''; draw(); var d = $('det'); if (d) d.scrollIntoView({ block: 'nearest' }); }
    };
    root.onkeydown = function (e) { var t = e.target.closest && e.target.closest('tr[data-i]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } };
  }
  function act(a, r) {
    if (!r) return;
    if (a === 'close') { S.sel = null; S.msg = ''; draw(); return; }
    if (a === 'contract') return X.openCrm('Contracts', r.contractId);
    if (a === 'card') return X.openCrm('Contracts', r.cardId);
    if (a === 'acct') return X.openCrm('Accounts', r.accountId);
    if (!S.admin || S.saving) return;
    if (!X.isLive()) { S.msg = 'Demo: nothing saved. Inside Zoho this would ' + (a === 'verify' ? 'verify the line' : a === 'vendor' ? 'set the vendor' : 'supersede the line with the new rate') + ', sending every rate line on the contract.'; S.msgTone = ''; draw(); return; }
    if (a === 'verify') run(verify(r));
    else if (a === 'vendor') { var v = $('m-vendor').value; if (!v) { S.msg = 'Choose a vendor first.'; S.msgTone = 'bad'; draw(); return; } run(setVendor(r, v)); }
    else if (a === 'rate') {
      var n = $('m-rate').value.trim() === '' ? null : +$('m-rate').value, eff = $('m-eff').value || today(), note = $('m-note').value.trim();
      if (n == null || isNaN(n) || n < 0 || n > 100) { S.msg = 'Enter a daily rate from 0 to 100.'; S.msgTone = 'bad'; draw(); return; }
      if (n === r.rate) { S.msg = 'That is the current rate.'; S.msgTone = ''; draw(); return; }
      run(changeRate(r, n, eff, note));
    }
  }

  window.RecModules.p_margins = { key: 'p_margins', title: 'Margins', swLabel: 'Margins', group: 'Contract', entity: 'Rate_Lines', custom: true,
    render: function (r, ctx) {
      root = r; X = ctx; draw();
      if (S.admin == null) { S.admin = false; X.hasRole(['admin']).then(function (a) { S.admin = !!a || !X.isLive(); draw(); }); }
      if (!S.loaded && !S.busy) load().then(draw);
    } };
  window.__procMargins = { state: function () { return S; }, ops: { save: save, verify: verify, setVendor: setVendor, changeRate: changeRate } };
})();
