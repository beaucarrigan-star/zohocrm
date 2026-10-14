/* billing-lines.js v1 (14 Oct 2026): "Vendor devices billed" for one account, edited in place.
   Used by Records > Accounts (record page) and by BD + CS Home > Relationships (account Edit panel). Browser: window.JPBillingLines; node: require.

   What it shows and edits
   - Customer rate lines on the account's customer contracts (Rate_Lines subform on Contracts): device, vendor (Rate_Vendor), rate per day, status.
     Add a device line (saved as Proposed, so Contract Review still verifies it).
   - On the account: Devices used (Device_s_Used, multi-select) and, for anyone not a Customer, Current vendor (the competitor, Current_Vendor).

   How a rate line is written
   Rate_Lines is a subform, so it cannot be updated on its own. Each save reads the contract fresh, then writes the contract back with every
   existing row id (rows sent with only an id are left as they are; a row left out would be deleted) plus the one change. If the fresh read
   does not return the subform, or the row is no longer there, nothing is written. A status change also writes Line_Verified and
   Superseded_By, the same three fields Contract Review writes. Every save offers Undo.

   io (supplied by the host page): { live, coql(q)->Promise<rows>, getRecord(entity,id)->Promise<record>, update(entity, data incl. id)->Promise,
     picklist(entity, field, fallback)->Promise<values>, toast(text, undoFn|null, bad), open(entity, id), onAccount(field, value) optional } */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.JPBillingLines = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEVICES = ['GPS', 'Wrist-worn GPS', '2-Piece GPS', 'Remote Breath', 'CAM', 'CAM Landline', 'Hybrid GPS + Alcohol', 'Victim / DV', 'Other'];
  var STATUSES = ['Proposed', 'Verified', 'Superseded', 'Rejected'];
  var USED = ['Allied GPS', 'Allied RB', 'Allied RF', 'Allied CAM', 'Buddi Alcotag'];
  var DAILY_MAX = 100;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var pick = function (v) { return v && v !== '-None-' ? String(v) : ''; };
  var lkId = function (v) { return v && typeof v === 'object' && v.id ? String(v.id) : (v && typeof v !== 'object' ? String(v) : ''); };
  var lkName = function (v) { return v && typeof v === 'object' ? (v.name || '') : ''; };
  var num = function (v) { return v == null || (typeof v === 'string' && v.trim() === '') || isNaN(+v) ? null : +v; };
  var money = function (v) { return v == null ? '' : '$' + (Math.round(v * 100) / 100).toFixed(2); };
  var q1 = function (s) { return "'" + String(s).replace(/'/g, "\\'") + "'"; };

  /* ---------- pure helpers (tested in node) ---------- */
  /* the three fields every status change writes (same as Contract Review line-status.js) */
  function statusFields(s) {
    if (s === 'Verified') return { Line_Status: 'Verified', Line_Verified: true, Superseded_By: null };
    if (s === 'Superseded') return { Line_Status: 'Superseded', Line_Verified: false, Superseded_By: 'Superseded in review' };
    if (s === 'Rejected') return { Line_Status: 'Rejected', Line_Verified: false, Superseded_By: 'Rejected in review' };
    return { Line_Status: 'Proposed', Line_Verified: false, Superseded_By: null };
  }
  function lineStatus(r) {
    var ls = pick(r.Line_Status), sb = String(r.Superseded_By || '');
    if (ls === 'Superseded' || ls === 'Rejected') return ls;
    if (sb) return sb.indexOf('Rejected') === 0 ? 'Rejected' : 'Superseded';
    if (ls) return ls;
    return r.Line_Verified === true || r.Line_Verified === 'true' ? 'Verified' : 'Proposed';
  }
  var isOld = function (r) { var s = lineStatus(r); return s === 'Superseded' || s === 'Rejected'; };
  function tierText(r) { var a = num(r.Tier_Min_Units), b = num(r.Tier_Max_Units); return a == null && b == null ? '' : (a != null ? a : 1) + (b != null ? '-' + b : '+') + ' units'; }
  function flags(r) {
    var f = [], a = num(r.Rate_Daily_Amount);
    if (!lkId(r.Rate_Vendor)) f.push('No vendor');
    if (!pick(r.Rate_Device)) f.push('No device');
    if (a == null) f.push('No rate');
    else if (a > DAILY_MAX) f.push('Over $' + DAILY_MAX + ': not a daily rate?');
    return f;
  }
  /* the subform payload for one change. rows = the contract's Rate_Lines as just read. Returns null when it is not safe to write. */
  function subformPayload(rows, lineId, fields) {
    if (!Array.isArray(rows)) return null;
    if (lineId && !rows.some(function (r) { return String(r.id) === String(lineId); })) return null;
    var out = rows.map(function (r) { return String(r.id) === String(lineId) ? Object.assign({ id: r.id }, fields) : { id: r.id }; });
    if (!lineId) out.push(Object.assign({}, fields));
    return out;
  }
  /* the account's customer contracts and their customer rate lines */
  function shape(contracts, lines) {
    var cs = (contracts || []).filter(function (c) { return pick(c.Counterparty_Type) !== 'Vendor'; }).map(function (c) { return { id: String(c.id), name: c.Name || 'Contract', status: pick(c.Contract_Status) }; });
    var ids = {}; cs.forEach(function (c) { ids[c.id] = c; });
    var ls = (lines || []).filter(function (r) { return ids[lkId(r.Parent_Id)] && pick(r.Rate_Type) !== 'Vendor cost'; });
    ls.sort(function (a, b) { return String(pick(a.Rate_Device)).localeCompare(String(pick(b.Rate_Device))) || (num(a.Tier_Min_Units) || 0) - (num(b.Tier_Min_Units) || 0); });
    return { contracts: cs, lines: ls };
  }

  /* ---------- writes ---------- */
  function readRows(io, contractId) {
    return io.getRecord('Contracts', contractId).then(function (c) { return c && Array.isArray(c.Rate_Lines) ? c.Rate_Lines : null; });
  }
  /* change (or add, when lineId is null) one rate line on a contract. Resolves with the id of the row written. */
  function writeLine(io, contractId, lineId, fields) {
    if (!io.live) return Promise.resolve(lineId || 'new' + Date.now());
    return readRows(io, contractId).then(function (rows) {
      var p = subformPayload(rows, lineId, fields);
      if (!p) throw new Error(rows ? 'that line is no longer on the contract; refresh and try again' : 'could not read the contract\'s rate lines, so nothing was changed');
      var before = {}; rows.forEach(function (r) { before[String(r.id)] = 1; });
      return io.update('Contracts', { id: contractId, Rate_Lines: p }).then(function () {
        if (lineId) return lineId;
        return readRows(io, contractId).then(function (after) { var n = (after || []).filter(function (r) { return !before[String(r.id)]; })[0]; return n ? String(n.id) : null; });
      });
    });
  }
  /* remove a row this screen just added (Undo of Add). Only ever called with the id it created. */
  function removeLine(io, contractId, lineId) {
    if (!io.live) return Promise.resolve();
    return readRows(io, contractId).then(function (rows) {
      if (!rows || !rows.some(function (r) { return String(r.id) === String(lineId); })) throw new Error('the new line was not found');
      return io.update('Contracts', { id: contractId, Rate_Lines: rows.filter(function (r) { return String(r.id) !== String(lineId); }).map(function (r) { return { id: r.id }; }) });
    });
  }

  /* ---------- demo data (no Zoho) ---------- */
  function demo(acc) {
    var V = [{ id: 'v1', Vendor_Name: 'Allied Universal Electronic Monitoring', EM_JusticePoint_Vendor: true }, { id: 'v2', Vendor_Name: 'Buddi', EM_JusticePoint_Vendor: true }, { id: 'v3', Vendor_Name: 'SuperCom', EM_JusticePoint_Vendor: true }, { id: 'v4', Vendor_Name: 'SCRAM Systems', EM_JusticePoint_Vendor: true }];
    if (acc.type !== 'Customer') return { vendors: V, contracts: [], lines: [] };
    var k = 'dk' + acc.id, P = { id: k, name: acc.name + ' EM services' };
    return { vendors: V, contracts: [{ id: k, Name: P.name, Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete' }],
      lines: [{ id: 'dl1' + acc.id, Parent_Id: P, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 6.25, Line_Status: 'Proposed', Rate_Vendor: { id: 'v1', name: V[0].Vendor_Name }, Rate_Terms: 'GPS Rate (Allied)' },
        { id: 'dl2' + acc.id, Parent_Id: P, Rate_Type: 'Customer rate', Rate_Device: 'Remote Breath', Rate_Daily_Amount: 7, Line_Status: 'Proposed', Rate_Vendor: { id: 'v1', name: V[0].Vendor_Name }, Rate_Terms: 'RB Rate (Attenti)' },
        { id: 'dl3' + acc.id, Parent_Id: P, Rate_Type: 'Customer rate', Rate_Device: 'Hybrid GPS + Alcohol', Rate_Daily_Amount: 9, Line_Status: 'Verified', Line_Verified: true },
        { id: 'dl4' + acc.id, Parent_Id: P, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Rate_Daily_Amount: 5.9, Line_Status: 'Superseded', Superseded_By: 'Superseded in review', Rate_Vendor: { id: 'v1', name: V[0].Vendor_Name } }] };
  }

  /* ---------- one panel per account ---------- */
  var cache = {}, cssDone = false;
  function css() {
    if (cssDone || typeof document === 'undefined') return; cssDone = true;
    var s = document.createElement('style'); s.id = 'jp-bl-css';
    s.textContent = '.bl{--bl-s2:var(--surface-2,var(--surface2,#F6F9F9));--bl-bad:var(--bad,#B02F28);--bl-r:var(--radius-sm,6px)}' +
      '.bl h3{margin:0 0 4px}.bl .bl-sub{color:var(--muted);font-size:12px;margin:0 0 10px}' +
      '.bl .bl-acc{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin:0 0 12px}' +
      '.bl .bl-acc>label,.bl .bl-add label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted);font-weight:600;min-width:160px;flex:1 1 160px}' +
      '.bl fieldset{border:1px solid var(--line);border-radius:var(--bl-r);padding:6px 10px;margin:0;flex:2 1 260px;min-width:0}' +
      '.bl legend{font-size:12px;color:var(--muted);font-weight:600;padding:0 4px}' +
      '.bl .bl-chk{display:inline-flex;gap:5px;align-items:center;margin:2px 12px 2px 0;font-size:13px;color:var(--ink);font-weight:400}' +
      '.bl select,.bl input[type=number],.bl input[type=text]{background:var(--bl-s2);border:1px solid var(--line);color:var(--ink);border-radius:var(--bl-r);padding:5px 7px;font:inherit;font-size:13px;min-width:0;max-width:100%}' +
      '.bl .bl-tw{border:1px solid var(--line);border-radius:var(--bl-r);overflow-x:auto;margin:0 0 8px}' +
      '.bl table{width:100%;border-collapse:collapse;font-size:13px}.bl th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}' +
      '.bl td{padding:5px 8px;border-top:1px solid var(--line);vertical-align:middle}.bl tr:first-child td{border-top:0}' +
      '.bl td.r,.bl th.r{text-align:right}.bl input[type=number]{width:92px;text-align:right}.bl td select{width:100%;min-width:120px}' +
      '.bl tr.old td{opacity:.6}.bl .bl-flag{color:var(--bl-bad);font-size:12px}.bl .bl-terms{color:var(--muted);font-size:12px}' +
      '.bl .bl-k{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:10px 0 6px;font-weight:600}.bl .bl-k small{color:var(--muted);font-weight:400}' +
      '.bl .bl-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 0}' +
      '.bl .bl-btn{background:none;border:1px solid var(--line);color:var(--ink);border-radius:var(--bl-r);padding:4px 10px;font:inherit;font-size:13px;cursor:pointer}' +
      '.bl .bl-btn.pri{background:var(--teal,#0D6A6D);border-color:var(--teal,#0D6A6D);color:var(--on-teal,#fff)}.bl .bl-btn:disabled{opacity:.5;cursor:default}' +
      '.bl .bl-link{background:none;border:0;padding:0;color:var(--teal,#0D6A6D);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px}' +
      '.bl .bl-add{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:10px;border:1px dashed var(--line);border-radius:var(--bl-r);margin:6px 0 0}' +
      '.bl .bl-empty{color:var(--muted);font-size:13px;padding:8px 0}.bl .bl-err{color:var(--bl-bad);font-size:13px;padding:6px 0}' +
      '.bl :focus-visible{outline:2px solid var(--focus,var(--info,#22559B));outline-offset:1px}';
    document.head.appendChild(s);
  }

  function Panel(io, acc) {
    this.io = io; this.acc = acc; this.el = null;
    this.S = { loaded: false, busy: false, err: '', notes: [], vendors: [], contracts: [], lines: [], comps: null, used: null, devPl: DEVICES, statusPl: STATUSES, showOld: false, adding: false, accRaw: {} };
  }
  Panel.prototype.load = function () {
    var S = this.S, io = this.io, acc = this.acc, self = this;
    S.busy = true; S.err = ''; S.notes = [];
    if (!io.live) {
      var d = demo(acc), sh = shape(d.contracts, d.lines);
      S.vendors = d.vendors.map(function (v) { return { id: String(v.id), name: v.Vendor_Name, em: !!v.EM_JusticePoint_Vendor }; });
      S.contracts = sh.contracts; S.lines = sh.lines; S.accRaw = { Device_s_Used: (acc.raw && acc.raw.Device_s_Used) || (acc.type === 'Customer' ? ['Allied GPS', 'Allied RB'] : []), Current_Vendor: acc.raw && acc.raw.Current_Vendor || null };
      S.comps = [{ id: 'c1', name: 'Sentinel Offender Services (Omnilink)' }, { id: 'c2', name: 'Track Group' }, { id: 'c3', name: 'SCRAM Systems (AMS)' }]; S.used = USED;
      S.loaded = true; S.busy = false; return Promise.resolve();
    }
    var soft = function (p, note) { return p.catch(function (e) { S.notes.push(note + ' (' + ((e && e.message) || e) + ')'); return null; }); };
    var vendors = io.coql('select id, Vendor_Name, EM_JusticePoint_Vendor from Vendors where id is not null limit 200').catch(function () { return io.coql('select id, Vendor_Name from Vendors where id is not null limit 200'); });
    var cons = io.coql('select id, Name, Counterparty_Type, Contract_Status from Contracts where Account = ' + q1(acc.id) + ' limit 200');
    var accQ = soft(io.coql('select id, Account_Type, Device_s_Used, Current_Vendor from Accounts where id = ' + q1(acc.id) + ' limit 1'), 'Devices used could not be read');
    return Promise.all([soft(vendors, 'Vendors could not be read'), cons, accQ]).then(function (r) {
      S.vendors = (r[0] || []).map(function (v) { return { id: String(v.id), name: v.Vendor_Name || '', em: v.EM_JusticePoint_Vendor === true || v.EM_JusticePoint_Vendor === 'true' }; })
        .sort(function (a, b) { return (b.em ? 1 : 0) - (a.em ? 1 : 0) || a.name.localeCompare(b.name); });
      S.accRaw = (r[2] && r[2][0]) || {};
      if (S.accRaw.Account_Type) acc.type = pick(S.accRaw.Account_Type);
      var cs = shape(r[1], []).contracts;
      if (!cs.length) return [];
      return io.coql('select id, Parent_Id, Rate_Vendor, Rate_Type, Rate_Device, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Tier_Min_Units, Tier_Max_Units, Effective_Date from Rate_Lines where Parent_Id in (' + cs.map(function (c) { return q1(c.id); }).join(', ') + ') limit 200')
        .then(function (ls) { var sh = shape(r[1], ls); S.contracts = sh.contracts; S.lines = sh.lines; });
    }).then(function () {
      var more = [io.picklist('Rate_Lines', 'Rate_Device', DEVICES).then(function (v) { if (v && v.length) S.devPl = v; }), io.picklist('Rate_Lines', 'Line_Status', STATUSES).then(function (v) { if (v && v.length) S.statusPl = v; }),
        io.picklist('Accounts', 'Device_s_Used', USED).then(function (v) { S.used = v && v.length ? v : USED; })];
      if (acc.type !== 'Customer') more.push(soft(io.coql('select id, Name from Competitor_Profiles where id is not null limit 200'), 'Competitors could not be read').then(function (c) { S.comps = (c || []).map(function (x) { return { id: String(x.id), name: x.Name || '' }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }); }));
      return Promise.all(more.map(function (p) { return p.catch(function () {}); }));
    }).then(function () { S.loaded = true; S.busy = false; }, function (e) { S.err = (e && e.message) || String(e); S.busy = false; S.loaded = true; });
  };
  Panel.prototype.mount = function (el) {
    css(); this.el = el; var self = this;
    el.classList.add('bl');
    if (!this.S.loaded && !this.S.busy) { this.draw(); this.load().then(function () { self.draw(); }); }
    else this.draw();
    el.onchange = function (e) { self.onChange(e); };
    el.onclick = function (e) { self.onClick(e); };
  };
  Panel.prototype.draw = function () {
    var el = this.el; if (!el) return;
    var S = this.S, acc = this.acc, h = '<h3>Vendor devices billed</h3>';
    if (!S.loaded) { el.innerHTML = h + '<div class="bl-empty">Loading rate lines…</div>'; return; }
    h += '<p class="bl-sub">' + (acc.type === 'Customer' ? 'Which vendor\'s device each customer rate bills, from the rate lines on this account\'s contracts.' : 'For a ' + esc((acc.type || 'prospect').toLowerCase()) + ': what they use today. Billed lines appear once there is a customer contract.') + ' Changes save to Zoho as you make them, with Undo.</p>';
    if (S.err) h += '<div class="bl-err">Could not read: ' + esc(S.err) + '</div>';
    S.notes.forEach(function (n) { h += '<div class="bl-err">' + esc(n) + '</div>'; });
    /* account fields */
    var used = Array.isArray(S.accRaw.Device_s_Used) ? S.accRaw.Device_s_Used : [], ul = (S.used || USED).slice(); used.forEach(function (u) { if (ul.indexOf(u) < 0) ul.push(u); });
    h += '<div class="bl-acc"><fieldset><legend>Devices used</legend>' + ul.map(function (u) { return '<label class="bl-chk"><input type="checkbox" data-used="' + esc(u) + '"' + (used.indexOf(u) >= 0 ? ' checked' : '') + '>' + esc(u) + '</label>'; }).join('') + '</fieldset>';
    if (acc.type !== 'Customer') {
      var cv = lkId(S.accRaw.Current_Vendor), cn = lkName(S.accRaw.Current_Vendor), cl = (S.comps || []).slice(); if (cv && !cl.some(function (c) { return c.id === cv; })) cl.unshift({ id: cv, name: cn || 'Current' });
      h += S.comps ? '<label>Current vendor (competitor)<select data-acc="Current_Vendor"><option value="">Not set</option>' + cl.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === cv ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' : '';
    }
    h += '</div>';
    /* rate lines */
    var self = this, old = S.lines.filter(isOld).length, shown = S.lines.filter(function (r) { return S.showOld || !isOld(r); });
    if (!S.contracts.length) h += '<div class="bl-empty">No customer contract on this account yet, so nothing is billed.' + (acc.type === 'Customer' ? ' Add the contract (Processes > Contract) and its rate lines appear here.' : '') + '</div>';
    else {
      S.contracts.forEach(function (c) {
        var mine = shown.filter(function (r) { return lkId(r.Parent_Id) === c.id; });
        h += '<div class="bl-k">' + esc(c.name) + (c.status ? ' <small>' + esc(c.status) + '</small>' : '') + ' <button type="button" class="bl-link" data-open="' + esc(c.id) + '">Open contract</button></div>';
        var tiers = mine.some(function (r) { return !!tierText(r); });
        h += mine.length ? '<div class="bl-tw"><table><thead><tr><th scope="col">Device</th><th scope="col">Vendor</th><th scope="col" class="r">Rate / day</th>' + (tiers ? '<th scope="col">Volume</th>' : '') + '<th scope="col">Status</th><th scope="col">Check</th></tr></thead><tbody>' + mine.map(function (r) { return self.row(r, tiers); }).join('') + '</tbody></table></div>'
          : '<div class="bl-empty">No ' + (S.showOld ? '' : 'current ') + 'customer rate lines on this contract.</div>';
      });
      h += '<div class="bl-bar">' + (S.adding ? '' : '<button type="button" class="bl-btn" data-act="add">+ Add a device line</button>') +
        (old ? '<button type="button" class="bl-btn" data-act="old" aria-pressed="' + S.showOld + '">' + (S.showOld ? 'Hide' : 'Show') + ' superseded and rejected (' + old + ')</button>' : '') + '</div>';
      if (S.adding) h += this.addForm();
    }
    el.innerHTML = h;
    if (S.adding) this.bindAdd();
  };
  Panel.prototype.vendorOpts = function (cur, curName) {
    var vs = this.S.vendors.slice(); if (cur && !vs.some(function (v) { return v.id === cur; })) vs.unshift({ id: cur, name: curName || 'Current vendor' });
    return '<option value="">Not set</option>' + vs.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === cur ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
  };
  Panel.prototype.opts = function (list, cur, blank) { var xs = list.slice(); if (cur && xs.indexOf(cur) < 0) xs.unshift(cur); return (blank ? '<option value="">Not set</option>' : '') + xs.map(function (o) { return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join(''); };
  Panel.prototype.row = function (r, tiers) {
    var id = esc(r.id), dev = pick(r.Rate_Device), st = lineStatus(r), fl = flags(r), a = num(r.Rate_Daily_Amount), lbl = esc(dev || 'line');
    return '<tr class="' + (isOld(r) ? 'old' : '') + '" data-line="' + id + '">' +
      '<td><select data-f="Rate_Device" aria-label="Device for ' + lbl + '">' + this.opts(this.S.devPl, dev, true) + '</select></td>' +
      '<td><select data-f="Rate_Vendor" aria-label="Vendor for ' + lbl + '">' + this.vendorOpts(lkId(r.Rate_Vendor), lkName(r.Rate_Vendor)) + '</select></td>' +
      '<td class="r"><input type="number" step="0.01" min="0" data-f="Rate_Daily_Amount" aria-label="Rate per day for ' + lbl + '" value="' + (a == null ? '' : esc(a.toFixed(2))) + '"></td>' +
      (tiers ? '<td>' + esc(tierText(r)) + '</td>' : '') +
      '<td><select data-f="Line_Status" aria-label="Status for ' + lbl + '">' + this.opts(this.S.statusPl, st, false) + '</select></td>' +
      '<td>' + (fl.length ? '<span class="bl-flag">' + esc(fl.join('. ')) + '</span>' : '') + (r.Rate_Terms ? '<div class="bl-terms">' + esc(r.Rate_Terms) + '</div>' : '') + '</td></tr>';
  };
  Panel.prototype.addForm = function () {
    var S = this.S;
    return '<form class="bl-add" data-form="add">' + (S.contracts.length > 1 ? '<label>Contract<select name="k">' + S.contracts.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label>Device<select name="dev" required>' + this.opts(S.devPl, '', true) + '</select></label><label>Vendor<select name="ven">' + this.vendorOpts('', '') + '</select></label>' +
      '<label>Rate / day<input type="number" name="amt" step="0.01" min="0"></label>' +
      '<button type="submit" class="bl-btn pri">Add line</button><button type="button" class="bl-btn" data-act="cancel">Cancel</button>' +
      '<div class="bl-sub" style="flex-basis:100%;margin:0">Added as Proposed. Contract Review verifies it before it counts for margin.</div></form>';
  };
  Panel.prototype.raw = function (id) { return this.S.lines.filter(function (r) { return String(r.id) === String(id); })[0]; };
  Panel.prototype.saveLine = function (r, fields, local, label) {
    var self = this, io = this.io, cid = lkId(r.Parent_Id), oldLocal = {}, oldApi = {};
    Object.keys(local).forEach(function (k) { oldLocal[k] = r[k] === undefined ? null : r[k]; });
    Object.keys(fields).forEach(function (k) { var v = r[k]; oldApi[k] = v && typeof v === 'object' ? (v.id ? { id: v.id } : null) : (v === undefined || v === '' || v === '-None-' ? null : v); });
    if (fields.Line_Status) { var prev = statusFields(lineStatus(r)); Object.keys(prev).forEach(function (k) { oldApi[k] = prev[k]; oldLocal[k] = r[k] === undefined ? null : r[k]; }); }
    var apply = function (vals) { Object.keys(vals).forEach(function (k) { r[k] = vals[k]; }); self.draw(); };
    return writeLine(io, cid, r.id, fields).then(function () {
      apply(local);
      io.toast('Saved: ' + label, function () { writeLine(io, cid, r.id, oldApi).then(function () { apply(oldLocal); io.toast('Undone', null); }, function (e) { io.toast('Could not undo: ' + ((e && e.message) || e), null, true); }); });
    }, function (e) { io.toast('Could not save: ' + ((e && e.message) || e), null, true); self.draw(); });
  };
  Panel.prototype.saveAcc = function (field, apiVal, localVal, label) {
    var self = this, io = this.io, A = this.S.accRaw, oldLocal = A[field] === undefined ? null : A[field];
    var oldApi = oldLocal && typeof oldLocal === 'object' && !Array.isArray(oldLocal) ? (oldLocal.id ? { id: oldLocal.id } : null) : oldLocal;
    var write = function (v) { if (!io.live) return Promise.resolve(); var d = { id: self.acc.id }; d[field] = v; return io.update('Accounts', d); };
    var apply = function (v) { A[field] = v; if (io.onAccount) io.onAccount(field, v); self.draw(); };
    return write(apiVal).then(function () {
      apply(localVal);
      io.toast('Saved: ' + label, function () { write(oldApi).then(function () { apply(oldLocal); io.toast('Undone', null); }, function (e) { io.toast('Could not undo: ' + ((e && e.message) || e), null, true); }); });
    }, function (e) { io.toast('Could not save: ' + ((e && e.message) || e), null, true); self.draw(); });
  };
  Panel.prototype.onChange = function (e) {
    var t = e.target, S = this.S;
    if (t.hasAttribute('data-used')) {
      var cur = Array.isArray(S.accRaw.Device_s_Used) ? S.accRaw.Device_s_Used.slice() : [], u = t.getAttribute('data-used');
      var next = t.checked ? cur.concat(cur.indexOf(u) < 0 ? [u] : []) : cur.filter(function (x) { return x !== u; });
      this.saveAcc('Device_s_Used', next, next, 'devices used ' + (t.checked ? '+ ' : '- ') + u); return;
    }
    if (t.getAttribute('data-acc') === 'Current_Vendor') {
      var v = t.value, c = (S.comps || []).filter(function (x) { return x.id === v; })[0];
      this.saveAcc('Current_Vendor', v ? { id: v } : null, v ? { id: v, name: c ? c.name : '' } : null, 'current vendor ' + (c ? 'set to ' + c.name : 'cleared')); return;
    }
    var f = t.getAttribute('data-f'), tr = t.closest('tr[data-line]'); if (!f || !tr) return;
    var r = this.raw(tr.getAttribute('data-line')); if (!r) return;
    var val = t.value, dev = pick(r.Rate_Device) || 'line';
    if (f === 'Rate_Vendor') { var vv = this.S.vendors.filter(function (x) { return x.id === val; })[0]; this.saveLine(r, { Rate_Vendor: val ? { id: val } : null }, { Rate_Vendor: val ? { id: val, name: vv ? vv.name : '' } : null }, dev + ' vendor ' + (vv ? 'set to ' + vv.name : 'cleared')); }
    else if (f === 'Rate_Device') this.saveLine(r, { Rate_Device: val || null }, { Rate_Device: val || null }, 'device ' + (val || 'cleared'));
    else if (f === 'Line_Status') { var sf = statusFields(val); this.saveLine(r, sf, sf, dev + ' status ' + val); }
    else if (f === 'Rate_Daily_Amount') {
      var n = val.trim() === '' ? null : +val;
      if (n != null && (isNaN(n) || n < 0)) { this.io.toast('Enter a rate of 0 or more', null, true); this.draw(); return; }
      this.saveLine(r, { Rate_Daily_Amount: n }, { Rate_Daily_Amount: n }, dev + ' rate ' + (n == null ? 'cleared' : money(n) + ' a day'));
    }
  };
  Panel.prototype.onClick = function (e) {
    var b = e.target.closest('[data-act],[data-open]'), self = this, S = this.S, io = this.io; if (!b) return;
    if (b.hasAttribute('data-open')) { io.open('Contracts', b.getAttribute('data-open')); return; }
    var a = b.getAttribute('data-act');
    if (a === 'add') { S.adding = true; this.draw(); var f0 = this.el.querySelector('[data-form=add] select'); if (f0) f0.focus(); }
    else if (a === 'cancel') { S.adding = false; this.draw(); }
    else if (a === 'old') { S.showOld = !S.showOld; this.draw(); }
  };
  Panel.prototype.bindAdd = function () {
    var self = this, S = this.S, io = this.io, form = this.el.querySelector('[data-form=add]'); if (!form) return;
    form.onsubmit = function (e) {
      e.preventDefault();
      var g = function (n) { return form.elements[n] ? form.elements[n].value : ''; }, cid = g('k') || S.contracts[0].id, dev = g('dev'), ven = g('ven'), amt = g('amt').trim() === '' ? null : +g('amt');
      if (!dev) { io.toast('Pick a device', null, true); return; }
      if (amt != null && (isNaN(amt) || amt < 0)) { io.toast('Enter a rate of 0 or more', null, true); return; }
      var fields = Object.assign({ Rate_Type: 'Customer rate', Rate_Device: dev, Rate_Daily_Amount: amt, Rate_Vendor: ven ? { id: ven } : null }, statusFields('Proposed'));
      var btn = form.querySelector('[type=submit]'); btn.disabled = true;
      writeLine(io, cid, null, fields).then(function (newId) {
        var vv = S.vendors.filter(function (x) { return x.id === ven; })[0], c = S.contracts.filter(function (x) { return x.id === cid; })[0];
        var row = Object.assign({ id: newId || ('pending' + Date.now()) }, fields, { Parent_Id: { id: cid, name: c ? c.name : '' }, Rate_Vendor: ven ? { id: ven, name: vv ? vv.name : '' } : null });
        S.lines.push(row); S.adding = false; self.draw();
        io.toast('Saved: ' + dev + ' line added' + (vv ? ' (' + vv.name + ')' : ''), newId ? function () { removeLine(io, cid, newId).then(function () { S.lines = S.lines.filter(function (x) { return x !== row; }); self.draw(); io.toast('Undone', null); }, function (er) { io.toast('Could not undo: ' + ((er && er.message) || er), null, true); }); } : null);
      }, function (er) { btn.disabled = false; io.toast('Could not add: ' + ((er && er.message) || er), null, true); });
    };
  };
  /* one panel per account, kept so a redraw of the host page does not read again */
  function mount(el, io, acc) {
    var key = String(acc.id), p = cache[key];
    if (!p || p.io.live !== io.live) { p = cache[key] = new Panel(io, acc); } else { p.io = io; if (acc.type) p.acc.type = acc.type; }
    p.mount(el); return p;
  }
  function forget(id) { delete cache[String(id)]; }

  return { mount: mount, forget: forget, writeLine: writeLine, removeLine: removeLine, statusFields: statusFields, lineStatus: lineStatus, subformPayload: subformPayload, shape: shape, flags: flags, tierText: tierText, DEVICES: DEVICES, STATUSES: STATUSES };
});
