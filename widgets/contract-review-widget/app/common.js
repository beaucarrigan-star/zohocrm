/* Contract ingest widgets - shared data layer and helpers (Phase 4, 27 Sep 2026).
   Every Zoho SDK call lives here; ?preview=<key> swaps in an in-memory stand-in built from the
   worker's own end-to-end test runs (preview-data.js), so the UI can be exercised outside Zoho. */
(function (root) {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var PREVIEW = qs.get('preview');

  /* ---------- helpers ---------- */
  var H = {};
  H.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  H.$ = function (sel, el) { return (el || document).querySelector(sel); };
  H.blank = function (v) { return v == null || v === '' || v === '-None-' || (Array.isArray(v) && !v.length); };
  H.today = function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  H.date = function (s) {
    if (!s) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); if (!m) return String(s);
    return Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1];
  };
  H.days = function (a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); };
  H.money = function (v, dp) { if (H.blank(v)) return ''; var n = Number(v); return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }); };
  H.errText = function (e) {
    if (!e) return 'unknown error'; if (typeof e === 'string') return e; if (e.message) return e.message;
    try { var d = e.data && e.data[0] ? e.data[0] : e; return (d.code ? d.code + ': ' : '') + (d.message || JSON.stringify(d)); } catch (x) { return String(e); }
  };
  /* "packet.zip > Addendum 24.pdf, p.2" -> "Addendum 24.pdf, p.2" */
  H.cite = function (s) { s = String(s || ''); var i = s.indexOf(' > '); return i >= 0 ? s.slice(i + 3) : s; };
  H.toast = function (msg, err) {
    var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 2600);
  };
  H.confirmDialog = function (title, body, okLabel) {
    return new Promise(function (resolve) {
      var s = document.createElement('div'); s.className = 'scrim';
      s.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h3 id="dlgT">' + H.esc(title) + '</h3><p>' + body +
        '</p><div class="acts"><button class="btn" data-a="no">Cancel</button><button class="btn primary" data-a="yes">' + H.esc(okLabel || 'OK') + '</button></div></div>';
      document.body.appendChild(s);
      s.querySelector('[data-a="yes"]').focus();
      s.addEventListener('click', function (e) {
        var a = e.target.getAttribute('data-a'); if (!a && e.target !== s) return;
        s.remove(); resolve(a === 'yes');
      });
      s.addEventListener('keydown', function (e) { if (e.key === 'Escape') { s.remove(); resolve(false); } });
    });
  };
  /* highlight the value inside its source snippet (first match only) */
  H.markIn = function (snippet, value) {
    var s = H.esc(snippet); if (H.blank(value)) return s;
    var cands = [String(value)];
    var n = Number(value);
    if (isFinite(n) && String(value).trim() !== '') cands.push(n.toFixed(2), n.toLocaleString('en-US'));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (m) cands.push(MON[Number(m[2]) - 1], Number(m[2]) + '/' + Number(m[3]) + '/' + m[1]);
    for (var i = 0; i < cands.length; i++) {
      var c = H.esc(cands[i]); if (!c) continue;
      var at = s.indexOf(c); if (at >= 0) return s.slice(0, at) + '<mark>' + c + '</mark>' + s.slice(at + c.length);
    }
    return s;
  };

  /* Contract fields the ingest writes, in reading order, with their editor kind */
  H.FIELDS = [
    ['Contract_Start_Date', 'Start date', 'date'], ['Contract_End_Date', 'End date', 'date'],
    ['Auto_Renews', 'Auto-renews', 'pick'], ['Renewal_Options_Left', 'Renewal options left', 'int'],
    ['Renewal_Option_Length_Mo', 'Renewal option length', 'int', 'months'], ['Notice_Period_Days', 'Renewal notice', 'int', 'days'],
    ['Termination_Convenience_Days', 'Termination for convenience', 'int', 'days'],
    ['Payment_Terms_Days', 'Payment terms', 'int', 'days'], ['Invoice_Cadence', 'Invoice cadence', 'pick'],
    ['Rate_Basis', 'Rate basis', 'pick'], ['Admin_Rate_Pct', 'Admin rate', 'pct'],
    ['Spare_Device_Clause', 'Spare device clause', 'pick'], ['Spare_Clause_Detail', 'Spare clause detail', 'text'],
    ['Not_To_Exceed', 'Not to exceed', 'money'], ['Escalator_Pct', 'Escalator', 'pct'],
    ['Governing_State', 'Governing state', 'pick'], ['Insurance_Limit', 'Insurance limit', 'money'],
    ['Amendment_Count', 'Amendments', 'int'], ['Last_Amendment_Date', 'Last amendment', 'date']
  ];
  /* 9 Oct 2026: vendor vs customer separation. Counterparty_Type picks the review profile: labels that say
     which way the money moves, the hints, and the term fields that are not normally in that kind of contract
     (shown apart, flagged, and left out of "Confirm all" so each gets its own look). */
  H.PROFILES = {
    Vendor: {
      title: 'Vendor contract', who: 'the vendor',
      labels: { Payment_Terms_Days: 'Payment terms (we pay the vendor)', Invoice_Cadence: 'Vendor invoices us',
                Rate_Basis: 'Cost basis', Escalator_Pct: 'Vendor price escalator', Insurance_Limit: 'Vendor insurance limit' },
      unexpected: ['Not_To_Exceed', 'Admin_Rate_Pct'],
      rates: 'Our cost — what JusticePoint pays the vendor per device-day. These feed EM Margin and Vendor_Rates once confirmed.',
      clauses: 'What the vendor must do for us (service levels, training, installs) and what we owe them.'
    },
    Customer: {
      title: 'Customer contract', who: 'the customer',
      labels: { Payment_Terms_Days: 'Payment terms (customer pays us)', Invoice_Cadence: 'We invoice the customer',
                Rate_Basis: 'Billing basis', Escalator_Pct: 'Billing rate escalator', Insurance_Limit: 'Insurance we must carry' },
      unexpected: [],
      rates: 'What JusticePoint bills the customer per device-day (on cost-plus contracts, the vendor cost passed through before the admin rate).',
      clauses: 'Things JusticePoint must do, staff, send or report for the customer.'
    }
  };
  H.profile = function (ct) { return H.PROFILES[ct] || null; };
  H.fieldInfo = function (api, ct) {
    var pr = H.profile(ct), lab = pr && pr.labels[api];
    for (var i = 0; i < H.FIELDS.length; i++) if (H.FIELDS[i][0] === api) return { api: api, label: lab || H.FIELDS[i][1], kind: H.FIELDS[i][2], unit: H.FIELDS[i][3] };
    return { api: api, label: lab || api.replace(/_/g, ' '), kind: 'text' };
  };
  H.unexpected = function (api, ct) { var pr = H.profile(ct); return !!(pr && pr.unexpected.indexOf(api) >= 0); };
  H.fmt = function (info, v) {
    if (H.blank(v)) return '';
    switch (info.kind) {
      case 'date': return H.date(v);
      case 'money': return H.money(v, 0);
      case 'pct': return Number(v) + '%';
      case 'int': return v + (info.unit ? ' ' + info.unit : '');
      default: return String(v);
    }
  };

  /* ---------- review JSON on Contracts.Ingest_Review (see con_worker/review_payload.py) ---------- */
  H.parseReview = function (raw) {
    var d = null; try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : { v: 1, fields: [], rates: [] };
    d.fields = d.fields || []; d.rates = d.rates || [];
    d.decisions = d.decisions || {}; d.decisions.fields = d.decisions.fields || {};
    return d;
  };
  H.rateKey = function (r) {
    var own = /purchased/i.test(r.Rate_Terms || '') ? 'Purchased' : '';
    return (r.Rate_Device || '') + '|' + Math.round(Number(r.Tier_Min_Units) || 0) + '|' + own + '|' + (r.Effective_Date || '');
  };
  H.REJECTED = 'Rejected in review';
  H.rateState = function (r) {
    var sb = String(r.Superseded_By || '');
    if (sb.indexOf('Rejected') === 0) return 'rejected';
    if (sb) return 'superseded';
    if (r.Line_Verified === true || r.Line_Verified === 'true') return 'verified';
    if (!r.Source_Ref) return 'hand';
    return 'pending';
  };

  /* =====================================================================
     DATA LAYER
     ===================================================================== */
  function rowsOf(r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; return []; }
  function writeOk(resp) {
    var row = resp && resp.data && resp.data[0];
    if (row && (row.code === 'SUCCESS' || row.status === 'success')) return row.details || {};
    throw new Error((row && (row.message + (row.details && row.details.api_name ? ' (' + row.details.api_name + ')' : ''))) || 'Zoho refused the change');
  }
  function timeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Zoho did not answer in time')); }, ms || 20000); })]);
  }

  var api = {};
  if (PREVIEW) {
    var DB = JSON.parse(JSON.stringify((root.PREVIEW_DATA || {})[PREVIEW] || {}));
    var c = DB.contract || {};
    c.Account = c.Account || { id: 'a1', name: PREVIEW === 'allied' ? 'Allied Universal Electronic Monitoring' : 'SCRAM Systems' };
    c.Ingest_Status = c.Ingest_Status || 'Needs Review';
    var delay = function (v) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(v))); }, 120); }); };
    api.preview = true;
    api.init = function () { return Promise.resolve({ entity: qs.get('entity') || 'Contracts', id: c.id }); };
    api.contract = function () { return delay(c); };
    api.clauses = function () { return delay(DB.clauses || []); };
    api.documents = function () { return delay(DB.docs || []); };
    api.picklists = function () {
      return Promise.resolve({
        Auto_Renews: ['Yes', 'No', 'Not stated'], Invoice_Cadence: ['Monthly', 'Quarterly', 'Annual', 'Other'],
        Rate_Basis: ['Fixed', 'Cost-plus', 'Tiered', 'Per-unit', 'Other'],
        Spare_Device_Clause: ['20% threshold', '30% threshold', 'Not applicable', 'No spare allowance', 'Unknown'],
        Governing_State: ['WI', 'IA', 'ID', 'MI', 'MN', 'MO', 'OH', 'VA', 'WV', 'WY', 'N/A'],
        Clause_Type: ['Special work', 'Reporting', 'Staffing', 'Training', 'Install', 'Service level', 'Insurance', 'Data & privacy', 'Termination', 'Other']
      });
    };
    api.users = function () { return Promise.resolve([{ id: 'u1', name: 'Beau Carrigan' }, { id: 'u2', name: 'Stacey M.' }]); };
    api.me = function () { return Promise.resolve({ id: 'u1', name: 'Beau Carrigan' }); };
    api.updateContract = function (data) {
      if (data.Rate_Lines) {
        var by = {}; c.Rate_Lines.forEach(function (r) { by[r.id] = r; });
        c.Rate_Lines = data.Rate_Lines.map(function (x) { return Object.assign(by[x.id] || {}, x); });
        delete data.Rate_Lines;
      }
      Object.assign(c, data); return delay({});
    };
    api.updateClause = function (data) {
      var x = (DB.clauses || []).filter(function (k) { return k.id === data.id; })[0];
      if (data.Owner && data.Owner.id) data.Owner.name = data.Owner.id === 'u1' ? 'Beau Carrigan' : 'Stacey M.';
      Object.assign(x, data); return delay({});
    };
    /* Accounts panel stand-in: this contract plus one ended one */
    api.accountContracts = function () {
      var ended = { id: 'c9', Name: c.Name + ' (2021-2023)', Contract_Status: 'Ended', Contract_Start_Date: '2021-01-10', Contract_End_Date: '2023-12-31', Ingest_Status: 'Not Ingested', Counterparty_Type: c.Counterparty_Type };
      return delay([Object.assign({ Contract_Status: 'Active/Complete', Days_To_Expiry: H.days(H.today(), c.Contract_End_Date || H.today()), Alert_Stage: 'OK' }, c), ended]);
    };
    api.accountClauses = function () { return delay(DB.clauses || []); };
    api.close = function () { H.toast('Preview: the popup would close and the record reload.'); };
    api.openRecord = function (m, id) { H.toast('Preview: would open ' + m + ' ' + id); };
    api.resize = function () {};
    api.popupSize = function () {};
  } else {
    var boot = new Promise(function (resolve) {
      ZOHO.embeddedApp.on('PageLoad', function (data) {
        var id = data && data.EntityId; if (Array.isArray(id)) id = id[0];
        resolve({ entity: data && data.Entity, id: id ? String(id) : null });
      });
      ZOHO.embeddedApp.init();
    });
    var coql = function (q) { return timeout(ZOHO.CRM.API.coql({ select_query: q })).then(rowsOf); };
    var recId = null;
    api.init = function () { return boot.then(function (b) { recId = b.id; return b; }); };
    api.contract = function (id) { return timeout(ZOHO.CRM.API.getRecord({ Entity: 'Contracts', RecordID: id || recId })).then(function (r) { return rowsOf(r)[0] || {}; }); };
    api.clauses = function () {
      return coql("select id, Name, Title, Clause_Type, Clause_Text, Source_Ref, Cadence, Due_Date, Status, Confidence, Owner from Contract_Clauses where Contract = '" + recId + "' order by Created_Time asc limit 200");
    };
    api.documents = function () {
      return coql("select id, File_Name, Doc_Type, Sequence, Effective_Date, Pages, Text_Layer, Applies_To_Contracts from Contract_Documents where Contract = '" + recId + "' order by Sequence asc limit 200");
    };
    var picks = null;
    api.picklists = function () {
      if (picks) return picks;
      var grab = function (m) {
        return timeout(ZOHO.CRM.META.getFields({ Entity: m })).then(function (r) {
          var out = {}; ((r && (r.fields || r.data)) || []).forEach(function (f) {
            if (f.pick_list_values && f.pick_list_values.length) out[f.api_name] = f.pick_list_values.map(function (p) { return p.actual_value; }).filter(function (v) { return v !== '-None-'; });
          }); return out;
        }).catch(function () { return {}; });
      };
      picks = Promise.all([grab('Contracts'), grab('Contract_Clauses')]).then(function (a) { return Object.assign({}, a[0], { Clause_Type: a[1].Clause_Type || [] }); });
      return picks;
    };
    api.users = function () {
      return timeout(ZOHO.CRM.API.getAllUsers({ Type: 'ActiveUsers' })).then(function (r) {
        return ((r && r.users) || []).map(function (u) { return { id: String(u.id), name: u.full_name }; });
      }).catch(function () { return []; });
    };
    api.me = function () {
      return timeout(ZOHO.CRM.CONFIG.getCurrentUser(), 8000).then(function (r) { var u = r && r.users && r.users[0]; return { id: u ? String(u.id) : '', name: u ? u.full_name : '' }; }).catch(function () { return { id: '', name: '' }; });
    };
    /* Trigger left at Zoho's default so the Contracts workflow (vendor_cost_contract_margin) runs */
    api.updateContract = function (data) { data.id = recId; return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Contracts', APIData: data })).then(writeOk); };
    api.updateClause = function (data) { return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Contract_Clauses', APIData: data })).then(writeOk); };
    api.accountContracts = function (accountId) {
      return coql("select id, Name, Counterparty_Type, Contract_Status, Contract_Start_Date, Contract_End_Date, Days_To_Expiry, Alert_Stage, Auto_Renews, Notice_Period_Days, Notice_Deadline, Renewal_Options_Left, Rate_Basis, Admin_Rate_Pct, Ingest_Status, Last_Verified from Contracts where Account = '" + accountId + "' order by Contract_End_Date desc limit 25");
    };
    api.accountClauses = function (accountId) {
      return coql("select id, Title, Clause_Type, Cadence, Due_Date, Status, Contract from Contract_Clauses where Account = '" + accountId + "' and Status in ('Confirmed', 'Proposed') order by Due_Date asc limit 200");
    };
    api.close = function () { ZOHO.CRM.UI.Popup.closeReload().catch(function () { ZOHO.CRM.UI.Popup.close(); }); };
    api.openRecord = function (m, id) { ZOHO.CRM.UI.Record.open({ Entity: m, RecordID: id }); };
    api.resize = function (h) { try { ZOHO.CRM.UI.Resize({ height: String(Math.min(Math.max(h, 180), 1400)) }); } catch (e) {} };
    /* button popups open small; ask for a large one (Zoho clamps it to the window) */
    api.popupSize = function () { try { ZOHO.CRM.UI.Resize({ height: '860', width: '1180' }); } catch (e) {} };
  }

  /* surface runtime errors in the widget itself (the Zoho popup hides the console) */
  root.addEventListener('error', function (e) { H.toast('Widget error: ' + (e.message || e), true); });
  root.addEventListener('unhandledrejection', function (e) { H.toast('Widget error: ' + H.errText(e.reason), true); });
  root.CI = { api: api, H: H, PREVIEW: PREVIEW };
})(this);
