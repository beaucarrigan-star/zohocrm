/* processes-rates.js v1.0.1 (S76, 5 Nov 2026; 1.0.1: 'No vendor on rate line' flag + Set vendor, so em_margin_build can price the line; styles injected here): Processes > Rates > Rates to fill. Administrator only.
   Turns the Leadership "Margin by vendor" tile's "N of M units priced" into a list to work down. Same data and the same rules as the
   tile: rates-model.js (shared, byte for byte). Units: Daily Unit Counts (each vendor's latest day). Rates: Rate Lines on Contracts.

   Part A  Vendor costs: one row per vendor pricing record x family (lease, or owned = monitoring-only). Status OK / Missing / Conflict /
           Superseded only. Actions: Set cost; Keep this one (on a conflict).
   Part B  Customer rates: one row per account x family with units on leg, in the order to fix them: No account, No contract,
           Account mismatch, No customer rate, Proposed not Verified, No vendor cost, Priced. Actions: Add rate, Verify, Move to account,
           Open contract / account.

   Every write
   - edits Rate_Lines only, on contracts that already exist (never creates a contract or account);
   - goes through the contract (Rate_Lines is a subform): read the contract fresh, send EVERY existing row (id only when unchanged; a row
     left out is deleted), then read it again and stop with a message if any row is missing;
   - manual lines: Rate_Type set, Line_Status Verified, Line_Verified true, Confidence High, Source_Ref "Rates screen <date> <user>";
     a replaced line is marked Superseded with Superseded_By = the new line's id (never deleted);
   - runs with workflows on, so the contract's "Pricing - EM Margin from contract" rule runs em_margin_build (Ingested contracts), which
     writes the EM Margin rows and rolls the account up; a vendor record write rebuilds every customer on that vendor;
   - shows a confirm box listing exactly what will change before anything is sent. Demo mode (outside Zoho) never writes. */
(function () {
  'use strict';
  var RM = window.RatesModel, X, root;
  var PAGE = 200, CAP = 6000, SAVE_MS = 25000;
  var S = { data: null, out: null, loaded: false, busy: false, err: '', admin: null, user: '', filter: 'todo', q: '', sel: null, selA: null, saving: false, msg: '', tone: '', confirm: null };
  function esc(v) { return X.esc(v); }
  function $(id) { return document.getElementById(id); }
  function money(n) { return n == null ? '' : '$' + Number(n).toFixed(2); }
  function pct(n) { return n == null ? '' : Number(n).toFixed(1) + '%'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }

  /* ---------- reads ---------- */
  function pageAll(base) {
    var all = [];
    function page(off) { return X.coql(base + ' order by id asc limit ' + PAGE + ' offset ' + off).then(function (r) { all = all.concat(r.rows); return r.rows.length >= PAGE && all.length < CAP ? page(off + PAGE) : all; }); }
    return page(0);
  }
  function load(force) {
    if (S.busy || (S.loaded && !force)) return Promise.resolve();
    S.busy = true; S.err = '';
    if (!X.isLive()) { S.data = window.RATES_DEMO; S.user = 'Demo user'; return Promise.resolve(done()); }
    var d8 = new Date(); d8.setDate(d8.getDate() - 8);
    return Promise.all([
      pageAll("select Count_Date, Account, Account.Account_Name, SmartView_Customer, Device_Family, Vendor, Supplied_Through, Hardware_Version, Acquisition, On_Leg from Daily_Unit_Counts where (Count_Date >= '" + ymd(d8) + "' and On_Leg > 0)"),
      pageAll("select id, Parent_Id, Parent_Id.Name, Rate_Type, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Effective_Date, Tier_Min_Units from Rate_Lines where Rate_Type in ('Customer rate','Vendor cost')"),
      pageAll("select id, Name, Account, Account.Account_Name, Vendor, Counterparty_Type, Contract_Status, Final_End_Date, Rate_Basis from Contracts where Counterparty_Type in ('Customer','Vendor')"),
      userName()
    ]).then(function (r) { S.data = { units: r[0], lines: r[1], contracts: r[2] }; S.user = r[3]; done(); },
      function (e) { S.err = (e && e.message) || 'Read failed'; S.loaded = true; S.busy = false; });
  }
  function userName() {
    try { return window.ZOHO.CRM.CONFIG.getCurrentUser().then(function (u) { var x = u && u.users && u.users[0]; return (x && (x.full_name || x.email)) || ''; }, function () { return ''; }); }
    catch (e) { return Promise.resolve(''); }
  }
  function done() { S.out = RM.build({ units: S.data.units, lines: S.data.lines, contracts: S.data.contracts, today: today() }); S.loaded = true; S.busy = false; }

  /* ---------- writes ---------- */
  function sdk() { return window.ZOHO.CRM.API; }
  function timeout(p) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, SAVE_MS); })]); }
  function readRows(cid) {
    return timeout(sdk().getRecord({ Entity: 'Contracts', RecordID: cid })).then(function (r) {
      var rec = r && r.data && r.data[0];
      if (!rec || !Array.isArray(rec.Rate_Lines)) throw new Error('Could not read the contract\'s rate lines, so nothing was changed');
      return rec.Rate_Lines;
    });
  }
  function writeRows(cid, rows) {
    return timeout(sdk().updateRecord({ Entity: 'Contracts', APIData: { id: cid, Rate_Lines: rows }, Trigger: ['workflow'] })).then(function (r) {
      var x = r && r.data && r.data[0]; if (!x) throw new Error('No answer from Zoho');
      if (x.code && x.code !== 'SUCCESS') throw new Error((x.message || x.code) + (x.details && x.details.api_name ? ' (' + x.details.api_name + ')' : ''));
    });
  }
  /* one contract write: changes {rowId: fields}, adds: [] new rows. Every existing row is sent; afterwards every one must still be there. */
  function save(cid, changes, adds) {
    return readRows(cid).then(function (before) {
      var p = RM.fullPayload(before, changes, adds);
      if (!p) throw new Error('A line to change is no longer on the contract. Refresh and try again');
      return writeRows(cid, p).then(function () { return readRows(cid); }).then(function (after) {
        var have = {}; after.forEach(function (l) { have[String(l.id)] = 1; });
        var lost = before.filter(function (l) { return !have[String(l.id)]; }).length;
        if (lost) throw new Error('Zoho dropped ' + lost + ' of ' + before.length + ' rate lines on this contract. Check its Rate Lines now');
        var known = {}; before.forEach(function (l) { known[String(l.id)] = 1; });
        return { before: before, after: after, added: after.filter(function (l) { return !known[String(l.id)]; }) };
      });
    });
  }
  /* add a new line and supersede `olds` with it: two writes (Superseded_By needs the new id) */
  function addAndSupersede(cid, add, olds) {
    var ch = {}; olds.forEach(function (id) { ch[id] = { Line_Status: 'Superseded', Line_Verified: false }; });
    return save(cid, ch, [add]).then(function (x) {
      var made = x.added.filter(function (l) { return l.Rate_Device === add.Rate_Device && l.Rate_Type === add.Rate_Type; }).pop();
      if (!made) throw new Error('The new line was saved but not found afterwards. Check the contract');
      if (!olds.length) return String(made.id);
      var ch2 = {}; olds.forEach(function (id) { ch2[id] = { Superseded_By: String(made.id) }; });
      return save(cid, ch2, []).then(function () { return String(made.id); });
    });
  }
  function ref() { return RM.sourceRef(today(), S.user); }
  function newLine(type, device, amount, eff, vendorId, terms, note) {
    var l = { Rate_Type: type, Rate_Device: device, Rate_Daily_Amount: amount, Line_Status: 'Verified', Line_Verified: true, Confidence: 'High', Effective_Date: eff || today(), Source_Ref: ref() + (note ? ': ' + note : '') };
    if (vendorId) l.Rate_Vendor = { id: vendorId };
    if (terms) l.Rate_Terms = terms;
    return l;
  }
  function cardVendorId(cardId) { var a = S.out.partA.filter(function (x) { return x.cardId === cardId && x.vendorId; })[0]; return a ? a.vendorId : ''; }

  /* ---------- the five actions: each returns { title, lines: [what will change], run: fn -> Promise<message> } ---------- */
  function planAddRate(r, amount, eff, note) {
    var dev = RM.familyDevice(r.family), olds = [r.rateLineId, r.proposedLineId].filter(Boolean);
    var add = newLine('Customer rate', dev, amount, eff, cardVendorId(r.costCardId), r.owned ? 'Purchased units (JP-owned)' : '', note);
    return { title: 'Add rate: ' + r.account + ' · ' + r.family, lines: ['On contract ' + r.contract + ': add a Verified ' + dev + ' customer rate of ' + money(amount) + ', effective ' + add.Effective_Date + (add.Rate_Vendor ? ', vendor ' + r.vendor : '') + '.',
      olds.length ? 'Mark ' + olds.length + ' current ' + dev + ' line' + (olds.length > 1 ? 's' : '') + ' Superseded, with Superseded By = the new line.' : 'No current ' + dev + ' line to supersede.',
      'Every other rate line on the contract is sent unchanged.', 'Source Ref: ' + add.Source_Ref],
      run: function () { return addAndSupersede(r.contractId, add, olds).then(function () { return 'Added ' + money(amount) + ' ' + dev + ' on ' + r.contract; }); } };
  }
  function planVerify(r) {
    var ch = {}; ch[r.proposedLineId] = RM.verifyFields();
    return { title: 'Verify: ' + r.account + ' · ' + r.family, lines: ['On contract ' + r.contract + ': mark the ' + money(r.proposedRate) + ' ' + r.family + ' line Verified (Line Verified on, Superseded By cleared).', 'Every other rate line on the contract is sent unchanged.'],
      run: function () { return save(r.contractId, ch, []).then(function () { return 'Verified ' + money(r.proposedRate) + ' ' + r.family + ' on ' + r.contract; }); } };
  }
  function planSetCost(a, amount, eff, note) {
    var olds = a.lines.map(function (x) { return x.id; });
    var add = newLine('Vendor cost', RM.familyDevice(a.family), amount, eff, a.vendorId, a.owned ? 'Purchased units (monitoring only)' : '', note);
    return { title: 'Set cost: ' + a.card + ' · ' + a.family + (a.owned ? ' (owned)' : ''), lines: ['On ' + a.card + ': add a Verified ' + a.family + ' vendor cost of ' + money(amount) + (a.owned ? ' for purchased units (monitoring only)' : '') + ', effective ' + add.Effective_Date + '.',
      olds.length ? 'Mark ' + olds.length + ' current line' + (olds.length > 1 ? 's' : '') + ' (' + a.lines.map(function (x) { return money(x.amt); }).join(', ') + ') Superseded, with Superseded By = the new line.' : 'No current line to supersede.',
      'This cost is shared: ' + a.units + ' units on leg use it today. Every customer on this vendor is re-margined by the workflow.', 'Every other rate line on the record is sent unchanged.'],
      run: function () { return addAndSupersede(a.cardId, add, olds).then(function () { return 'Set ' + a.family + ' cost ' + money(amount) + ' on ' + a.card; }); } };
  }
  function planKeep(a, keepId) {
    var keep = a.lines.filter(function (x) { return x.id === keepId; })[0], others = a.lines.filter(function (x) { return x.id !== keepId; }), ch = {};
    others.forEach(function (x) { ch[x.id] = RM.supersedeFields(keepId); });
    return { title: 'Keep this one: ' + a.card + ' · ' + a.family, lines: ['Keep the ' + money(keep.amt) + ' line.', 'Mark ' + others.map(function (x) { return money(x.amt); }).join(', ') + ' Superseded, with Superseded By = the kept line.', 'Every other rate line on the record is sent unchanged.'],
      run: function () { return save(a.cardId, ch, []).then(function () { return 'Kept ' + money(keep.amt) + ' for ' + a.family + ' on ' + a.card; }); } };
  }
  function planSetVendor(r) {
    var ch = {}; ch[r.rateLineId] = { Rate_Vendor: { id: r.cardVendorId } };
    return { title: 'Set vendor: ' + r.account + ' · ' + r.family, lines: ['On contract ' + r.contract + ': set Rate Vendor on the ' + money(r.rate) + ' ' + r.family + ' line to ' + r.vendor + ' (from the units on leg; ' + r.costCard + ').',
      'The amount and status do not change. em_margin_build then prices the line, so EM Margin and the Account fields fill in.', 'Every other rate line on the contract is sent unchanged.'],
      run: function () { return save(r.contractId, ch, []).then(function () { return 'Vendor set to ' + r.vendor + ' on ' + r.contract + ' ' + r.family; }); } };
  }
  function planMove(r) {
    var m = r.mismatch, dev = m.device || RM.familyDevice(r.family);
    var add = newLine('Customer rate', dev, m.rate, today(), cardVendorId(r.costCardId), '', 'moved from ' + m.contract);
    return { title: 'Move to account: ' + r.account + ' · ' + r.family, lines: ['On ' + r.contract + ' (' + r.account + '): add a Verified ' + dev + ' customer rate of ' + money(m.rate) + ', copied from ' + m.contract + '.',
      'On ' + m.contract + ' (' + m.account + '): mark that line Superseded, with Superseded By = the new line.', 'Both contracts: every other rate line is sent unchanged.'],
      run: function () {
        return addAndSupersede(r.contractId, add, []).then(function (newId) {
          var ch = {}; ch[m.lineId] = RM.supersedeFields(newId);
          return save(m.contractId, ch, []).then(function () { return 'Moved ' + money(m.rate) + ' ' + dev + ' from ' + m.contract + ' to ' + r.contract; });
        });
      } };
  }
  function ask(plan) { S.confirm = plan; draw(); var b = $('rc-ok'); if (b) b.focus(); }
  function runPlan() {
    var plan = S.confirm; S.confirm = null; if (!plan) return;
    if (!X.isLive()) { S.msg = 'Demo: nothing saved. Inside Zoho this would: ' + plan.lines[0]; S.tone = ''; draw(); return; }
    S.saving = true; S.msg = 'Saving…'; S.tone = ''; draw();
    plan.run().then(function (m) { S.saving = false; S.msg = m + '. EM Margin refreshes through the contract workflow.'; S.tone = 'good'; X.toast('Saved'); return load(true); },
      function (e) { S.saving = false; S.msg = 'Not saved: ' + ((e && e.message) || 'Zoho refused the change'); S.tone = 'bad'; })
      .then(function () { S.sel = null; S.selA = null; draw(); });
  }

  /* ---------- render ---------- */
  var STONE = { 'No account': 'bad', 'No contract': 'bad', 'Account mismatch': 'warn', 'No customer rate': 'warn', 'Proposed, not Verified': 'warn', 'No vendor cost': 'warn', 'Priced': 'good' };
  var ATONE = { 'Conflict': 'bad', 'Missing': 'bad', 'Superseded only': 'warn', 'No pricing record': 'bad', 'OK': 'good' };
  function rowsB() {
    var q = S.q.toLowerCase();
    return S.out.partB.filter(function (r) {
      if (S.filter === 'todo' && r.status === 'Priced' && !r.flags.length) return false;
      if (S.filter === 'novendor') { if (r.flags.indexOf('No vendor on rate line') < 0) return false; }
      else if (S.filter !== 'todo' && S.filter !== 'all' && r.status !== S.filter) return false;
      return !q || (r.account + ' ' + r.smartView + ' ' + r.family + ' ' + r.vendor + ' ' + r.contract).toLowerCase().indexOf(q) >= 0;
    });
  }
  function stripHtml() {
    var t = S.out.totals, p = t.units ? Math.round(t.priced / t.units * 100) : 0;
    var h = '<div class="rt-strip"><div class="rt-big"><b>' + t.priced + ' of ' + t.units + '</b><span>units on leg priced (' + p + '%)</span><div class="rt-bar" role="img" aria-label="' + p + ' percent priced"><i style="width:' + p + '%"></i></div></div>' +
      '<div class="rt-big"><b class="' + RM.tone(t.margin) + '">' + (t.margin == null ? '—' : pct(t.margin)) + '</b><span>blended margin, priced units (floor ' + RM.FLOOR + '%, target ' + RM.TARGET + '%)</span></div>' +
      '<div class="rt-big"><b>' + esc(t.asof || '—') + '</b><span>unit counts as of</span></div></div>';
    h += '<div class="bar rt-pills" role="group" aria-label="Status">' + [['todo', 'To fix', S.out.partB.filter(function (r) { return r.status !== 'Priced' || r.flags.length; }).length]]
      .concat(t.byStatus.map(function (x) { return [x.status, x.status, x.rows]; })).concat([['novendor', 'No vendor on rate line', S.out.partB.filter(function (r) { return r.flags.indexOf('No vendor on rate line') >= 0; }).length], ['all', 'All', S.out.partB.length]]).map(function (f) {
        return '<button type="button" class="pillbtn" data-f="' + esc(f[0]) + '" aria-pressed="' + (S.filter === f[0]) + '">' + esc(f[1]) + ' (' + f[2] + ')</button>'; }).join('') +
      '<input type="search" id="rt-q" class="rt-q" placeholder="Search account, family, vendor" aria-label="Search" value="' + esc(S.q) + '"></div>';
    return h;
  }
  function partAHtml() {
    var h = '<section class="rt-sec" aria-labelledby="rt-a"><h2 id="rt-a">Part A · Vendor costs</h2><p class="mut rt-sub">One row per vendor pricing record and family. Owned = monitoring-only cost for purchased units.</p>';
    h += '<div class="tw"><table><thead><tr><th scope="col">Vendor record</th><th scope="col">Family</th><th scope="col" class="r">Units on leg</th><th scope="col" class="r">Verified cost</th><th scope="col">Status</th></tr></thead><tbody>';
    S.out.partA.forEach(function (a, i) {
      h += '<tr data-a="' + i + '" class="click" tabindex="0"><td>' + esc(a.card || a.vendor + ' (no pricing record)') + '</td><td>' + esc(a.family) + (a.owned ? ' <span class="mut">owned</span>' : '') + '</td><td class="r">' + a.units + '</td><td class="r">' + esc(money(a.cost)) +
        (a.lines.length > 1 ? ' <span class="mut">(' + a.lines.length + ' lines)</span>' : '') + '</td><td>' + X.pillHtml(a.status, ATONE[a.status]) + (a.note ? ' <span class="mut">' + esc(a.note) + '</span>' : '') + '</td></tr>';
      if (S.selA === i) h += '<tr class="rt-det"><td colspan="5">' + detailAHtml(a) + '</td></tr>';
    });
    return h + '</tbody></table></div></section>';
  }
  function detailAHtml(a) {
    var dis = S.saving || !S.admin ? ' disabled' : '', h = '<div class="rt-card" id="rt-detA">';
    if (a.lines.length) h += '<p class="mut">Current lines: ' + a.lines.map(function (x) { return esc(money(x.amt)) + (x.terms ? ' <span class="mut">(' + esc(x.terms) + ')</span>' : '') + (a.status === 'Conflict' ? ' <button type="button" class="btn sm" data-act="keep" data-id="' + esc(x.id) + '"' + dis + '>Keep this one</button>' : ''); }).join(' · ') + '</p>';
    if (a.cardId) h += '<div class="rt-form"><label>New cost / day <input type="number" id="rt-acost" step="0.01" min="0" max="100" value="' + esc(a.cost == null ? '' : a.cost) + '"></label><label>Effective <input type="date" id="rt-aeff" value="' + today() + '"></label><label>Note <input type="text" id="rt-anote" maxlength="120" placeholder="Where the cost comes from"></label><button type="button" class="btn pri" data-act="setcost"' + dis + '>Set cost</button></div>' +
      '<div class="acts"><button type="button" class="btn" data-act="opencard">Open vendor record</button><button type="button" class="btn" data-act="closeA">Close</button></div>';
    else h += '<p>No vendor pricing record exists for ' + esc(a.vendor) + '. Create one in Contracts (Counterparty Type = Vendor, named "' + esc(a.vendor) + ' - vendor pricing"); this screen never creates contracts.</p><div class="acts"><button type="button" class="btn" data-act="closeA">Close</button></div>';
    return h + '</div>';
  }
  function partBHtml() {
    var list = rowsB(), h = '<section class="rt-sec" aria-labelledby="rt-b"><h2 id="rt-b">Part B · Customer rates</h2><p class="mut rt-sub">One row per account and family with units on leg, in the order to fix them. Click a row to work it.</p>';
    if (!list.length) return h + '<div class="empty"><b>Nothing here</b></div></section>';
    h += '<div class="tw"><table><thead><tr><th scope="col">Account</th><th scope="col">Family</th><th scope="col">Vendor (via)</th><th scope="col" class="r">Units</th><th scope="col">Contract</th><th scope="col" class="r">Customer rate</th><th scope="col" class="r">Vendor cost</th><th scope="col" class="r">Est. margin</th><th scope="col">Status</th></tr></thead><tbody>';
    list.forEach(function (r) {
      var i = S.out.partB.indexOf(r);
      h += '<tr data-b="' + i + '" class="click" tabindex="0"><td><b>' + esc(r.account || r.smartView) + '</b>' + (r.account ? '' : ' <span class="mut">(unit name)</span>') + '</td><td>' + esc(r.family) + (r.owned ? ' <span class="mut">owned</span>' : '') + '</td><td>' + esc(r.via) + '</td><td class="r">' + r.units + '</td><td>' + esc(r.contract || '') + '</td>' +
        '<td class="r">' + esc(money(r.rate != null ? r.rate : r.proposedRate)) + (r.rate == null && r.proposedRate != null ? ' <span class="mut">proposed</span>' : '') + '</td><td class="r">' + esc(money(r.cost)) + '</td><td class="r">' + (r.margin == null ? '' : X.pillHtml(pct(r.margin), RM.tone(r.margin))) + '</td><td>' + X.pillHtml(r.status, STONE[r.status]) + r.flags.map(function (f) { return ' ' + X.pillHtml(f, 'warn'); }).join('') + '</td></tr>';
      if (S.sel === i) h += '<tr class="rt-det"><td colspan="9">' + detailBHtml(r) + '</td></tr>';
    });
    return h + '</tbody></table></div></section>';
  }
  function detailBHtml(r) {
    var dis = S.saving || !S.admin ? ' disabled' : '', h = '<div class="rt-card" id="rt-detB">', why = {
      'No account': 'The unit rows for "' + r.smartView + '" have no Account. Link that SmartView name to an account (Daily Unit Counts / the SmartView map); rates cannot be added until it has one.',
      'No contract': r.account + ' has no open customer contract. Create or reopen one in Contracts; this screen never creates contracts.',
      'Account mismatch': r.mismatch ? 'A ' + money(r.mismatch.rate) + ' ' + r.family + ' rate sits on ' + r.mismatch.contract + ' (account ' + r.mismatch.account + '), but the units are on ' + r.account + '.' : '',
      'No customer rate': 'No current ' + r.family + ' customer rate on ' + (r.contract || 'the contract') + '.',
      'Proposed, not Verified': 'A ' + money(r.proposedRate) + ' rate is on ' + r.contract + ' but not verified.',
      'No vendor cost': 'The rate is there; ' + (r.costCard || r.vendor) + ' has no verified ' + r.family + (r.owned ? ' monitoring-only' : '') + ' cost. Fix it in Part A.',
      'Priced': money(r.rate) + ' against ' + money(r.cost) + ' = ' + money(r.rate - r.cost) + ' a day, ' + pct(r.margin) + '.' }[r.status];
    h += '<p>' + esc(why) + '</p>';
    if (r.flags.indexOf('No vendor on rate line') >= 0) h += '<p class="mut">The rate line has no Rate Vendor, so em_margin_build leaves it as an exception (EM Margin and the Account fields stay blank).</p>' + (r.cardVendorId ? '<div class="rt-form"><button type="button" class="btn pri" data-act="setvendor"' + dis + '>Set vendor: ' + esc(r.vendor) + '</button></div>' : '<p class="mut">No vendor record id to set; open the contract.</p>');
    if (r.status === 'Proposed, not Verified') h += '<div class="rt-form"><button type="button" class="btn pri" data-act="verify"' + dis + '>Verify ' + esc(money(r.proposedRate)) + '</button></div>';
    if (r.status === 'Account mismatch') h += r.mismatch.targetContractId ? '<div class="rt-form"><button type="button" class="btn pri" data-act="move"' + dis + '>Move to ' + esc(r.account) + '</button></div>'
      : '<p class="mut">Move to account needs an open contract on ' + esc(r.account) + ' (it has none). Either open one, or relink these unit rows to ' + esc(r.mismatch.account) + ' if that is the right account.</p>';
    if (r.contractId && r.accountId) h += '<div class="rt-form"><label>' + esc(r.family) + ' rate / day <input type="number" id="rt-brate" step="0.01" min="0" max="100" value="' + esc(r.rate != null ? r.rate : r.proposedRate != null ? r.proposedRate : '') + '"></label><label>Effective <input type="date" id="rt-beff" value="' + today() + '"></label><label>Source <input type="text" id="rt-bnote" maxlength="120" placeholder="Contract page, email…"></label><button type="button" class="btn' + (r.status === 'No customer rate' ? ' pri' : '') + '" data-act="add"' + dis + '>Add rate</button></div>';
    h += '<div class="acts">' + (r.contractId ? '<button type="button" class="btn" data-act="opencon">Open contract</button>' : '') + (r.accountId ? '<button type="button" class="btn" data-act="openacct">Open account</button>' : '') + (r.costCardId ? '<button type="button" class="btn" data-act="opencardB">Open vendor record</button>' : '') + '<button type="button" class="btn" data-act="closeB">Close</button></div>';
    return h + '</div>';
  }
  function confirmHtml() {
    var c = S.confirm; if (!c) return '';
    return '<div class="rt-modal" role="dialog" aria-modal="true" aria-labelledby="rc-t"><div class="rt-box"><h3 id="rc-t">' + esc(c.title) + '</h3><p class="mut">This will change exactly this:</p><ul>' + c.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<div class="acts"><button type="button" class="btn pri" id="rc-ok">' + (X.isLive() ? 'Save to Zoho' : 'Preview (demo)') + '</button><button type="button" class="btn" id="rc-no">Cancel</button></div></div></div>';
  }
  function draw() {
    var h = '<div class="wrap rt">' + X.head('Processes', 'Rates to fill', 'Work down the units the Margin by vendor tile cannot price. Same data, same rules as the tile.', '', '<button class="btn pri" id="rf" type="button">Refresh</button>') + X.switchHtml() + X.demoNote();
    if (S.admin === false && X.isLive()) { root.innerHTML = h + '<div class="empty"><b>Administrators only</b></div></div>'; X.bindSwitch(); return; }
    if (S.err) h += '<div class="err">Could not read units, rate lines or contracts: ' + esc(S.err) + '</div>';
    if (!S.loaded || !S.out) h += X.skel ? X.skel() : '<div class="empty">Loading…</div>';
    else h += stripHtml() + (S.msg ? '<p class="rt-msg ' + S.tone + '" role="status">' + esc(S.msg) + '</p>' : '') + partBHtml() + partAHtml() +
      '<p class="mut rt-foot">A unit is priced when its account has a Verified customer rate for the family on an open contract and its vendor has a Verified cost on its vendor pricing record. Base stations are not priced per unit. Every save keeps all of the contract\'s other rate lines.</p>';
    h += confirmHtml() + '</div>';
    root.innerHTML = h; X.bindSwitch();
    $('rf').onclick = function () { S.msg = ''; load(true).then(function () { draw(); X.toast('Refreshed'); }); };
    var q = $('rt-q'); if (q) q.oninput = function () { S.q = q.value; var pos = q.selectionStart; draw(); var q2 = $('rt-q'); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} } };
    var ok = $('rc-ok'), no = $('rc-no'); if (ok) ok.onclick = runPlan; if (no) no.onclick = function () { S.confirm = null; draw(); };
    root.onclick = function (e) {
      var t;
      if (S.confirm) return;
      if ((t = e.target.closest('[data-f]'))) { S.filter = t.getAttribute('data-f'); S.sel = null; draw(); return; }
      if ((t = e.target.closest('[data-act]'))) { act(t.getAttribute('data-act'), t); return; }
      if (e.target.closest('.rt-card')) return;
      if ((t = e.target.closest('tr[data-b]'))) { var i = +t.getAttribute('data-b'); S.sel = S.sel === i ? null : i; S.msg = ''; draw(); return; }
      if ((t = e.target.closest('tr[data-a]'))) { var j = +t.getAttribute('data-a'); S.selA = S.selA === j ? null : j; S.msg = ''; draw(); }
    };
    root.onkeydown = function (e) {
      if (e.key === 'Escape' && S.confirm) { S.confirm = null; draw(); return; }
      var t = e.target.closest && e.target.closest('tr[data-a],tr[data-b]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
    };
  }
  function bad(m) { S.msg = m; S.tone = 'bad'; draw(); }
  function act(a, el) {
    var r = S.sel != null ? S.out.partB[S.sel] : null, pa = S.selA != null ? S.out.partA[S.selA] : null;
    if (a === 'closeB') { S.sel = null; draw(); return; }
    if (a === 'closeA') { S.selA = null; draw(); return; }
    if (a === 'opencon') return X.openCrm('Contracts', r.contractId);
    if (a === 'openacct') return X.openCrm('Accounts', r.accountId);
    if (a === 'opencardB') return X.openCrm('Contracts', r.costCardId);
    if (a === 'opencard') return X.openCrm('Contracts', pa.cardId);
    if (!S.admin || S.saving) return;
    var n;
    if (a === 'verify') ask(planVerify(r));
    else if (a === 'setvendor') ask(planSetVendor(r));
    else if (a === 'move') ask(planMove(r));
    else if (a === 'add') { n = $('rt-brate').value.trim() === '' ? null : +$('rt-brate').value; if (n == null || isNaN(n) || n <= 0 || n > 100) return bad('Enter a daily rate above $0 and up to $100.'); ask(planAddRate(r, n, $('rt-beff').value || today(), $('rt-bnote').value.trim())); }
    else if (a === 'setcost') { n = $('rt-acost').value.trim() === '' ? null : +$('rt-acost').value; if (n == null || isNaN(n) || n < 0 || n > 100) return bad('Enter a daily cost from $0 to $100.'); ask(planSetCost(pa, n, $('rt-aeff').value || today(), $('rt-anote').value.trim())); }
    else if (a === 'keep') ask(planKeep(pa, el.getAttribute('data-id')));
  }

  window.RecModules.p_rates = { key: 'p_rates', title: 'Rates to fill', swLabel: 'Rates to fill', group: 'Rates', entity: 'Rate_Lines', custom: true,
    render: function (r, ctx) {
      root = r; X = ctx; draw();
      if (S.admin == null) { S.admin = !X.isLive(); X.hasRole(['admin']).then(function (ad) { S.admin = !!ad || !X.isLive(); draw(); }); }
      if (!S.loaded && !S.busy) load().then(draw);
    } };
  /* Administrator only: hide the rail entry for everyone else */
  setTimeout(function () {
    var c = window.RecModules.p_rates;
    if (!c || !window.ZOHO || !window.ZOHO.CRM) return;
    try { window.ZOHO.CRM.CONFIG.getCurrentUser().then(function (u) { var p = u && u.users && u.users[0] && u.users[0].profile; if (p && !/Administrator/i.test(p.name || '')) Array.prototype.forEach.call(document.querySelectorAll('[data-m="p_rates"]'), function (b) { b.hidden = true; var li = b.closest('li'); if (li) li.hidden = true; }); }); } catch (e) {}
  }, 1500);
  window.__procRates = { state: function () { return S; }, plans: { addRate: planAddRate, verify: planVerify, setVendor: planSetVendor, setCost: planSetCost, keep: planKeep, move: planMove }, save: save, addAndSupersede: addAndSupersede };
})();
