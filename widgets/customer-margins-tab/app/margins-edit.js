/* Customer Margins: edit rates (v1.3, S78, 5 Nov 2026). Adds an "Edit rates" form to the line popout.
   What it changes, by the supersede rule (Beau, 4 Nov 2026):
     Customer rate / day  -> on the customer's Contract: the current Verified 'Customer rate' Rate Line for the device is marked
                             Superseded (Superseded_By = the new line) and a new Verified line is added with the new amount and effective date.
     Vendor                -> the new customer line carries the chosen Rate_Vendor (this clears "No vendor on this rate line").
     Vendor cost / day    -> the same supersede on the vendor's pricing contract (Counterparty_Type = Vendor, Vendor = chosen vendor): the Verified
                             'Vendor cost' line for the device is superseded and a new one added. Note: that rate card is shared by every customer
                             on that vendor and device; the form says so.
     EM Margin row        -> updated in place (rate, cost, vendor, margin/day, %, tier, Status Confirmed, exception cleared, a note appended) so the
                             page is right straight away. Account roll-ups (Avg Margin etc.) refresh on the next em_margin_build run.
   Writes use ZOHO.CRM.API.getRecord / updateRecord only.
   v1.3.1 (5 Nov 2026): subform rule corrected. Rows sent by id are updated, a row without an id is added, and a row LEFT OUT IS DELETED
   (v1.3 sent only the changed rows and wiped the rest of Allied's standard vendor pricing card; restored 5 Nov, S76). Every write now reads
   the contract fresh and sends every existing row id (unchanged rows as {id} only), the same rule as billing-lines.js. If the read does not
   return the subform, nothing is written; after each write the row count is checked and a shortfall is reported.
   Demo mode previews and saves nothing. */
(function (root) {
  'use strict';
  var JPK = root.JPK, esc = JPK.esc;
  var VENDOR_CONTRACT_RE = /vendor pricing/i;
  var SAVE_TIMEOUT = 20000;
  var DEVICES = ['GPS', 'Wrist-worn GPS', '2-Piece GPS', 'Remote Breath', 'CAM', 'CAM Landline', 'Hybrid GPS + Alcohol', 'Victim / DV', 'Other'];
  var FAMILY_TO_DEVICE = { 'GPS': 'GPS', 'Remote Breath': 'Remote Breath', 'CAM': 'CAM', 'RF': 'Other', 'Other': 'Other' };

  function num(v) { if (v == null || v === '') return null; var n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; }
  function money(n) { return n == null ? '—' : '$' + Number(n).toFixed(2); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeout(p, ms) { return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, ms); })]); }
  function lid(v) { return v && typeof v === 'object' ? String(v.id || '') : (v == null ? '' : String(v)); }
  function lname(v) { return v && typeof v === 'object' ? String(v.name || '') : ''; }
  function marginOf(rate, cost) { return rate && cost != null ? { day: rate - cost, pct: (rate - cost) / rate * 100 } : null; }
  function tierFor(pct) { return root.MarginsModel ? root.MarginsModel.tierFor(pct) : ''; }

  /* the Rate_Device of this margin row: the row Name is "<contract> - <Rate_Device>", else map the family */
  function deviceOf(r) {
    var n = String(r.name || ''), c = String(r.contractName || '');
    if (c && n.indexOf(c + ' - ') === 0) { var d = n.slice(c.length + 3).trim(); if (d) return d; }
    return FAMILY_TO_DEVICE[r.device] || r.device || 'Other';
  }

  /* ---------- Zoho reads/writes ---------- */
  function api() { var Z = root.ZOHO; return Z && Z.CRM && Z.CRM.API ? Z.CRM.API : null; }
  function getRecord(entity, id) {
    return timeout(api().getRecord({ Entity: entity, RecordID: id }), SAVE_TIMEOUT).then(function (r) {
      var rec = r && r.data && r.data[0]; if (!rec) throw new Error('Could not read ' + entity + ' ' + id); return rec;
    }, function (e) { throw JPK.crm.error(e); });
  }
  function updateRecord(entity, data) {
    return timeout(api().updateRecord({ Entity: entity, APIData: data, Trigger: ['workflow'] }), SAVE_TIMEOUT).then(function (r) {
      var x = r && r.data && r.data[0];
      if (!x) throw new Error('No answer from Zoho for ' + entity);
      if (x.code && x.code !== 'SUCCESS') throw new Error((x.message || x.code) + (x.details && x.details.api_name ? ' (' + x.details.api_name + ')' : ''));
      return x;
    }, function (e) { throw JPK.crm.error(e); });
  }
  var vendorsP = null;
  function vendors() {
    if (vendorsP) return vendorsP;
    vendorsP = JPK.crm.coqlAll('select id, Vendor_Name from Vendors where id is not null').then(function (rows) {
      return rows.map(function (r) { return { id: String(r.id), name: r.Vendor_Name || String(r.id) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    }).catch(function () { vendorsP = null; return []; });
    return vendorsP;
  }
  function vendorContracts(vendorId) {
    return JPK.crm.coqlAll("select id, Name, Contract_Status from Contracts where (Counterparty_Type = 'Vendor' and Vendor = '" + vendorId + "')").catch(function () { return []; });
  }

  /* ---------- the supersede on one contract ---------- */
  /* lines: the contract's Rate_Lines rows. Finds the Verified line of this type and device (prefers one with the current amount). */
  function findLine(lines, type, device, amount) {
    var c = lines.filter(function (l) { return l.Rate_Type === type && l.Rate_Device === device && (l.Line_Status || 'Verified') === 'Verified'; });
    if (!c.length) return null;
    if (amount != null) { var m = c.filter(function (l) { return num(l.Rate_Daily_Amount) === amount; }); if (m.length) return m[m.length - 1]; }
    return c[c.length - 1];
  }
  /* The full Rate_Lines payload for one write: every existing row by id (a row left out is deleted), `changes` merged into the row it
     names, and `add` (a row with no id) appended. Returns null when it is not safe to write. Pure, tested in node. */
  function fullPayload(lines, changes, add) {
    if (!Array.isArray(lines)) return null;
    changes = changes || {};
    var ids = {}; lines.forEach(function (l) { ids[String(l.id)] = 1; });
    if (Object.keys(changes).some(function (k) { return !ids[k]; })) return null;
    var out = lines.map(function (l) { var c = changes[String(l.id)]; return c ? Object.assign({ id: l.id }, c) : { id: l.id }; });
    if (add) out.push(add);
    return out;
  }
  function readLines(contractId) {
    return getRecord('Contracts', contractId).then(function (rec) {
      if (!Array.isArray(rec.Rate_Lines)) throw new Error('Could not read the contract\'s rate lines, so nothing was changed');
      return rec.Rate_Lines;
    });
  }
  /* Marks `old` Superseded, adds the new line, then writes Superseded_By on the old line. Every write sends the whole list. Resolves {oldId, newId}. */
  function supersede(contractId, type, device, oldAmount, newLine) {
    return readLines(contractId).then(function (lines) {
      var old = findLine(lines, type, device, oldAmount), ch = {};
      if (old) ch[String(old.id)] = { Line_Status: 'Superseded' };
      var rows = fullPayload(lines, ch, newLine);
      if (!rows) throw new Error('The contract\'s rate lines changed while saving; nothing was written. Refresh and try again');
      return updateRecord('Contracts', { id: contractId, Rate_Lines: rows }).then(function () { return readLines(contractId); }).then(function (after) {
        var known = {}; lines.forEach(function (l) { known[String(l.id)] = 1; });
        var kept = after.filter(function (l) { return known[String(l.id)]; }).length;
        if (kept < lines.length) throw new Error('Zoho kept ' + kept + ' of ' + lines.length + ' existing rate lines on this contract. Check its Rate Lines now');
        var added = after.filter(function (l) { return !known[String(l.id)] && l.Rate_Type === type && l.Rate_Device === device; });
        var created = added.length ? added[added.length - 1] : null;
        if (!old || !created) return { oldId: old ? String(old.id) : '', newId: created ? String(created.id) : '' };
        var ch2 = {}; ch2[String(old.id)] = { Superseded_By: String(created.id) };
        return updateRecord('Contracts', { id: contractId, Rate_Lines: fullPayload(after, ch2) }).then(function () { return readLines(contractId); }).then(function (fin) {
          if (fin.length < after.length) throw new Error('Zoho kept ' + fin.length + ' of ' + after.length + ' rate lines after marking the old line. Check its Rate Lines now');
          return { oldId: String(old.id), newId: String(created.id) };
        });
      });
    });
  }

  /* ---------- the form ---------- */
  function formHtml(r, device) {
    var fld = function (id, label, inner, hint) { return '<div class="jp-fld"><label for="' + id + '">' + label + '</label>' + inner + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>'; };
    return '<details class="me-wrap" id="me-wrap"><summary class="btn">Edit rates</summary><form class="me-form" id="me-form" autocomplete="off">' +
      '<p class="muted sm">Saving adds new Verified rate lines and marks the current ones Superseded, so history is kept. Device: <b>' + esc(device) + '</b></p>' +
      fld('me-vendor', 'Vendor', '<select id="me-vendor"><option value="">Loading vendors…</option></select>', 'Vendor on the customer rate line. Needed before a margin can be worked out.') +
      fld('me-rate', 'Customer rate / day', '<input type="number" id="me-rate" step="0.01" min="0" value="' + (r.rate == null ? '' : r.rate) + '">', 'Written to the customer contract ' + esc(r.contractName || '')) +
      fld('me-cost', 'Vendor cost / day', '<input type="number" id="me-cost" step="0.01" min="0" value="' + (r.cost == null ? '' : r.cost) + '">', 'Written to the vendor\'s pricing contract. Changes this vendor\'s ' + esc(device) + ' cost for every customer on it.') +
      '<div class="jp-fld" id="me-vc-wrap" hidden><label for="me-vc">Vendor pricing contract</label><select id="me-vc"></select></div>' +
      fld('me-date', 'Effective date', '<input type="date" id="me-date" value="' + today() + '">') +
      fld('me-note', 'Note <span class="opt">(optional)</span>', '<input type="text" id="me-note" maxlength="200" placeholder="Why the rate changed">') +
      '<p class="me-preview" id="me-preview" aria-live="polite"></p>' +
      '<div class="me-acts"><button type="submit" class="btn pri" id="me-save">Save changes</button><button type="button" class="btn" id="me-cancel">Cancel</button></div>' +
      '<p class="me-msg" id="me-msg" role="status" hidden></p></form></details>';
  }
  function mount(body, r, opts) {
    var device = deviceOf(r), $ = function (s) { return body.querySelector(s); };
    var form = $('#me-form'), vSel = $('#me-vendor'), rateI = $('#me-rate'), costI = $('#me-cost'), dateI = $('#me-date'), noteI = $('#me-note'), vcWrap = $('#me-vc-wrap'), vcSel = $('#me-vc');
    var msg = $('#me-msg'), prev = $('#me-preview'), save = $('#me-save'), busy = false, vcRows = [];
    function say(t, tone) { msg.textContent = t || ''; msg.hidden = !t; msg.className = 'me-msg' + (tone ? ' ' + tone : ''); }
    function preview() {
      var m = marginOf(num(rateI.value), num(costI.value));
      prev.innerHTML = m ? 'New margin: <b>' + esc(money(m.day)) + ' / day · ' + esc(m.pct.toFixed(1)) + '%</b> (' + esc(tierFor(m.pct) || '—') + ')' + (r.pct != null ? ' <span class="muted">from ' + esc(Number(r.pct).toFixed(1)) + '%</span>' : '') : '<span class="muted">Enter a rate and a cost to see the margin.</span>';
    }
    function loadVendorContracts(vid) {
      vcWrap.hidden = true; vcRows = [];
      if (!vid || opts.demo) return;
      vendorContracts(vid).then(function (rows) {
        vcRows = rows.filter(function (c) { return VENDOR_CONTRACT_RE.test(c.Name || ''); }).concat(rows.filter(function (c) { return !VENDOR_CONTRACT_RE.test(c.Name || ''); }));
        vcSel.innerHTML = vcRows.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.Name) + '</option>'; }).join('');
        vcWrap.hidden = vcRows.length < 2;
      });
    }
    vendors().then(function (list) {
      vSel.innerHTML = '<option value="">— choose a vendor —</option>' + list.map(function (v) { return '<option value="' + esc(v.id) + '"' + (v.id === r.vendorId ? ' selected' : '') + '>' + esc(v.name) + '</option>'; }).join('');
      if (!list.length && r.vendorName) vSel.innerHTML = '<option value="' + esc(r.vendorId) + '" selected>' + esc(r.vendorName) + '</option>';
      loadVendorContracts(vSel.value);
    });
    vSel.addEventListener('change', function () { loadVendorContracts(vSel.value); });
    rateI.addEventListener('input', preview); costI.addEventListener('input', preview); preview();
    $('#me-cancel').addEventListener('click', function () { $('#me-wrap').open = false; });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); if (busy) return;
      var rate = num(rateI.value), cost = num(costI.value), vid = vSel.value, date = dateI.value || today(), note = noteI.value.trim();
      var rateChanged = rate != null && rate !== r.rate, costChanged = cost != null && cost !== r.cost, vendorChanged = !!vid && vid !== r.vendorId;
      if (!vid) { say('Choose a vendor first.', 'bad'); vSel.focus(); return; }
      if (rate == null) { say('Enter the customer rate per day.', 'bad'); rateI.focus(); return; }
      if (!rateChanged && !costChanged && !vendorChanged) { say('Nothing changed.', ''); return; }
      if (costChanged && !vid) { say('Choose the vendor before changing a vendor cost.', 'bad'); return; }
      var who = opts.user || 'Customer Margins', when = today(), ref = 'Customer Margins edit ' + when + (who ? ' by ' + who : '') + (note ? ': ' + note : '');
      if (opts.demo) { say('Preview only (demo): would supersede the customer rate line' + (costChanged ? ' and the vendor cost line' : '') + ' and update this EM Margin row. Nothing saved.', 'good'); return; }
      busy = true; save.disabled = true; say('Saving…', '');
      var steps = [];
      /* 1. customer rate line (also when only the vendor changed: the new line carries the vendor) */
      if ((rateChanged || vendorChanged) && r.contractId) {
        steps.push(function () {
          return supersede(r.contractId, 'Customer rate', device, r.rate, { Rate_Type: 'Customer rate', Rate_Device: device, Rate_Daily_Amount: rate, Rate_Vendor: { id: vid },
            Line_Status: 'Verified', Line_Verified: true, Confidence: 'High', Effective_Date: date, Source_Ref: ref });
        });
      }
      /* 2. vendor cost line on the vendor's pricing contract */
      if (costChanged) {
        steps.push(function () {
          var cid = vcRows.length ? (vcRows.length > 1 ? vcSel.value : vcRows[0].id) : '';
          if (!cid) throw new Error('This vendor has no pricing contract (Counterparty Type = Vendor). Create one, then set the cost here.');
          return supersede(cid, 'Vendor cost', device, r.cost, { Rate_Type: 'Vendor cost', Rate_Device: device, Rate_Daily_Amount: cost, Rate_Vendor: { id: vid },
            Line_Status: 'Verified', Line_Verified: true, Confidence: 'High', Effective_Date: date, Source_Ref: ref });
        });
      }
      /* 3. this EM Margin row */
      steps.push(function () {
        var m = marginOf(rate, cost), data = { id: r.id, Customer_Rate: rate, Vendor: { id: vid }, Margin_Notes: ((r.notes ? r.notes + '\n' : '') + ref).slice(0, 2000) };
        if (cost != null) data.Vendor_Daily_Rate = cost;
        if (m) { data.Margin_Per_Unit_Day = Math.round(m.day * 100) / 100; data.Modelled_Margin_Pct = Math.round(m.pct * 10) / 10; data.Modelled_Margin_Tier = tierFor(m.pct); data.Status = 'Confirmed'; data.Exception_Reason = null; }
        return updateRecord('EM_Margin', data);
      });
      steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
        busy = false; save.disabled = false;
        say('Saved. Rate lines superseded and this margin row updated. Account averages refresh on the next margin build.', 'good');
        if (typeof opts.onSaved === 'function') opts.onSaved();
      }).catch(function (e) {
        busy = false; save.disabled = false;
        say('Not saved: ' + ((e && e.message) || 'Zoho refused the change') + '. Anything saved before this step stays saved; check the contract\'s Rate Lines.', 'bad');
      });
    });
  }

  root.MarginsEdit = { formHtml: function (r) { return formHtml(r, deviceOf(r)); }, mount: mount, deviceOf: deviceOf, findLine: findLine, marginOf: marginOf, fullPayload: fullPayload };
})(window);
