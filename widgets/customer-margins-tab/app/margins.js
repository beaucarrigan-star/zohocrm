/* Customer Margins (v1.2, S42 28 Oct 2026: lookup names read as Account.Account_Name etc.; widget COQL returns lookups as id only): read-only web tab. Reads EM_Margin (Row_Type = 'Contract rate') with COQL only; never writes.
   Demo mode (?demo=1, or not inside Zoho): fictional rows and a "Demo data" banner. */
(function () {
  'use strict';
  var M = window.MarginsModel, esc = JPK.esc, $ = function (s) { return document.querySelector(s); };
  var ORG = 'org882980956';
  var ENT = {
    EM_Margin: { tab: 'CustomModule28', label: 'EM Margin record' },
    Contracts: { tab: 'CustomModule17', label: 'contract' },
    Accounts: { tab: 'Accounts', label: 'account' }
  };

  var FULL_FIELDS = 'id, Name, Margin_Key, Row_Type, Status, Exception_Reason, Contract, Account, Vendor, Device_Family, Rate_Description, Customer_Rate, Vendor_Daily_Rate, Margin_Per_Unit_Day, Modelled_Margin_Pct, Modelled_Margin_Tier, Vendor_Cost_Tier, Margin_Notes, Modified_Time, Account.Account_Name, Contract.Name, Vendor.Vendor_Name';
  var SMALL_FIELDS = 'id, Name, Status, Exception_Reason, Contract, Account, Vendor, Device_Family, Customer_Rate, Vendor_Daily_Rate, Margin_Per_Unit_Day, Modelled_Margin_Pct, Modelled_Margin_Tier, Account.Account_Name, Contract.Name, Vendor.Vendor_Name';
  var WHERE = " from EM_Margin where Row_Type = 'Contract rate'";

  var DEMO = false, ALL = [], hideTest = true, tabsApi = null, tMargins = null, tWaiting = null, tCustomers = null, footNote = '';
  var filt = { vendor: '', device: '', tiers: [] };
  var TONE = { Negative: 'bad', Thin: 'warn', Normal: 'neutral', Strong: 'good' };
  var TIER_ORDER = { Negative: 0, Thin: 1, Normal: 2, Strong: 3 };

  /* ---------- formatting ---------- */
  function money(n) { return n == null ? '' : '$' + Number(n).toFixed(2); }
  function pctText(p) { return p == null ? '' : Number(p).toFixed(1) + '%'; }
  function dash(s) { return s ? esc(s) : '<span class="muted">&mdash;</span>'; }
  function tierChip(t) { return t ? '<span class="tierchip">' + JPK.chip(t, TONE[t] || 'neutral') + '</span>' : '<span class="muted">&mdash;</span>'; }
  function when(s) { if (!s) return ''; var d = new Date(s); return isNaN(d) ? s : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

  /* ---------- links (view-only navigation; no writes) ---------- */
  function recUrl(ent, id) { return 'https://crm.zoho.com/crm/' + ORG + '/tab/' + ENT[ent].tab + '/' + encodeURIComponent(id); }
  function link(ent, id, text, cls) {
    if (!id) return '';
    return '<a class="' + (cls || 'lnk') + '" href="' + esc(recUrl(ent, id)) + '" target="_top" rel="noopener" data-open="' + esc(ent) + '" data-id="' + esc(id) + '">' + esc(text) + '</a>';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-open]');
    if (!a) return;
    var ent = a.getAttribute('data-open'), id = a.getAttribute('data-id');
    try {
      var Z = window.ZOHO;
      if (!DEMO && Z && Z.CRM && Z.CRM.UI && Z.CRM.UI.Record && typeof Z.CRM.UI.Record.open === 'function') {
        e.preventDefault();
        var p = Z.CRM.UI.Record.open({ Entity: ent, RecordID: id });
        if (p && p.catch) p.catch(function () { try { window.open(a.href, '_top'); } catch (x) { /* ignore */ } });
      }
    } catch (x) { /* fall through to the plain link */ }
  });

  /* ---------- popout ---------- */
  function dlRow(k, v, cls) { return '<dt>' + esc(k) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</dd>'; }
  function openLine(r) {
    var links = [link('EM_Margin', r.id, 'Open EM Margin record', 'btn sm'), link('Contracts', r.contractId, 'Open contract', 'btn sm'), link('Accounts', r.accountId, 'Open account', 'btn sm')].filter(Boolean).join('');
    var h = '<div class="dl-links">' + links + '</div><dl class="dl">' +
      dlRow('Customer', dash(r.accountName)) + dlRow('Contract', dash(r.contractName)) + dlRow('Vendor', dash(r.vendorName)) + dlRow('Device', dash(r.device)) +
      dlRow('Rate description', dash(r.rateDesc)) +
      dlRow('Customer rate / day', r.rate == null ? dash('') : esc(money(r.rate))) +
      dlRow('Vendor cost / day', r.cost == null ? dash('') : esc(money(r.cost))) +
      dlRow('Margin / day', r.marginDay == null ? dash('') : esc(money(r.marginDay))) +
      dlRow('Margin %', r.pct == null ? dash('') : esc(pctText(r.pct))) +
      dlRow('Margin tier', tierChip(r.tier)) +
      dlRow('Vendor cost tier', dash(r.costTier)) +
      dlRow('Status', dash(r.status)) +
      (r.reason ? dlRow("What's missing", esc(r.reason)) : '') +
      dlRow('Margin notes', dash(r.notes), 'pre') +
      dlRow('Margin key', dash(r.key)) +
      dlRow('Row name', dash(r.name)) +
      dlRow('Last modified', dash(when(r.modified))) +
      '</dl>';
    JPK.drawer.open({ title: (r.accountName || 'EM Margin') + ' · ' + (r.device || 'line'), html: h });
  }
  function openCustomer(c) {
    var h = '<div class="dl-links">' + link('Accounts', c.accountId, 'Open account', 'btn sm') + '</div><dl class="dl">' +
      dlRow('Average margin %', c.avg == null ? dash('') : esc(pctText(c.avg))) +
      dlRow('Lowest margin %', c.lowest == null ? dash('') : esc(pctText(c.lowest))) +
      dlRow('Tier', tierChip(c.tier)) +
      dlRow('Lines with margin', esc(String(c.lines))) +
      dlRow('Lines waiting', esc(String(c.waiting))) + '</dl>' +
      '<p class="muted sm">Same rule as the account margin fields: simple mean of the Confirmed lines, one decimal.</p>';
    JPK.drawer.open({ title: c.name, html: h });
  }

  /* ---------- render ---------- */
  function totalsHtml(t) {
    function tile(label, val, sub, cls) { return '<div class="tile"><small>' + esc(label) + '</small><b class="num ' + (cls || '') + '">' + val + '</b><i>' + esc(sub) + '</i></div>'; }
    return tile('Lines with a margin', String(t.filled), 'verified, filled') +
      tile('Lines waiting', String(t.waiting), 'need vendor or verification', t.waiting ? 'warnv' : '') +
      tile('Below ' + t.target + '% target', String(t.below), 'filled lines under target', t.below ? 'warnv' : '') +
      tile('Average margin %', t.avg == null ? '&mdash;' : esc(t.avg.toFixed(1)) + '%', 'simple average, rate only');
  }
  function fillSelect(sel, list, cur, allLabel) {
    var keep = list.indexOf(cur) >= 0 ? cur : '';
    sel.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === keep ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    return keep;
  }
  function renderTierPills() {
    $('#f-tiers').innerHTML = '<span class="lbl">Tier</span>' + M.TIERS.map(function (t) {
      return '<button type="button" class="pill" data-tier="' + t + '" aria-pressed="' + (filt.tiers.indexOf(t) >= 0) + '">' + t + '</button>';
    }).join('');
  }
  function render() {
    var opts = { hideTest: hideTest };
    var t = M.totals(ALL, opts);
    $('#totals').innerHTML = totalsHtml(t);
    var o = M.filterOptions(ALL, opts);
    filt.vendor = fillSelect($('#f-vendor'), o.vendors, filt.vendor, 'All vendors');
    filt.device = fillSelect($('#f-device'), o.devices, filt.device, 'All devices');
    renderTierPills();
    var lines = M.marginRows(ALL, opts, filt), wait = M.waitingRows(ALL, opts), cust = M.customers(ALL, opts);
    tMargins.setRows(lines); tWaiting.setRows(wait); tCustomers.setRows(cust);
    tabsApi.setCount('margins', t.filled); tabsApi.setCount('waiting', t.waiting); tabsApi.setCount('customers', cust.length);
    var f = $('#foot');
    f.textContent = (footNote ? footNote + ' ' : '') + 'Read-only. Margin % is rate only, no volume weighting. Tiers: Negative below 0%, Thin below 20%, Normal below 50%, Strong 50% and up.' + (hideTest ? ' TEST rows are hidden.' : '');
  }

  function build() {
    var common = { rate: { key: 'rate', label: 'Rate/Day', sortable: true, num: true, align: 'right', render: function (r) { return r.rate == null ? '' : esc(money(r.rate)); } } };
    tMargins = JPK.table({
      mount: '#t-margins', caption: 'Confirmed contract lines, lowest margin first',
      columns: [
        { key: 'accountName', label: 'Customer', sortable: true, render: function (r) { return '<b>' + esc(r.accountName || 'No account') + '</b>'; } },
        { key: 'contractName', label: 'Contract', sortable: true, render: function (r) { return dash(r.contractName); } },
        { key: 'device', label: 'Device', sortable: true, render: function (r) { return dash(r.device); } },
        { key: 'vendorName', label: 'Vendor', sortable: true, render: function (r) { return dash(r.vendorName); } },
        common.rate,
        { key: 'cost', label: 'Cost/Day', sortable: true, num: true, align: 'right', render: function (r) { return r.cost == null ? '' : esc(money(r.cost)); } },
        { key: 'marginDay', label: 'Margin/Day', sortable: true, num: true, align: 'right', render: function (r) { return r.marginDay == null ? '' : esc(money(r.marginDay)); } },
        { key: 'pct', label: 'Margin %', sortable: true, num: true, align: 'right', render: function (r) { return r.pct == null ? '' : '<b>' + esc(pctText(r.pct)) + '</b>'; } },
        { key: 'tier', label: 'Tier', sortable: true, sortValue: function (r) { return r.tier in TIER_ORDER ? TIER_ORDER[r.tier] : null; }, render: function (r) { return tierChip(r.tier); } }
      ],
      empty: { title: 'No lines with a margin', hint: 'Nothing matches these filters, or no contract line has been verified yet.' },
      onRowClick: openLine
    });
    tWaiting = JPK.table({
      mount: '#t-waiting', caption: 'Contract lines waiting for a margin, grouped by reason',
      columns: [
        { key: 'accountName', label: 'Customer', sortable: true, render: function (r) { return '<b>' + esc(r.accountName || 'No account') + '</b>'; } },
        { key: 'contractName', label: 'Contract', sortable: true, render: function (r) { return dash(r.contractName); } },
        { key: 'device', label: 'Device', sortable: true, render: function (r) { return dash(r.device); } },
        { key: 'vendorName', label: 'Vendor', sortable: true, render: function (r) { return dash(r.vendorName); } },
        common.rate,
        { key: 'reason', label: "What's missing", sortable: true, render: function (r) { return dash(r.reason); } },
        { key: 'open', label: '', render: function (r) { return r.contractId ? link('Contracts', r.contractId, 'Open contract', 'btn sm') : ''; } }
      ],
      empty: { title: 'Nothing is waiting', hint: 'Every verified contract line has a margin.' },
      onRowClick: openLine
    });
    tCustomers = JPK.table({
      mount: '#t-customers', caption: 'One row per customer, lowest average margin first',
      columns: [
        { key: 'name', label: 'Customer', sortable: true, render: function (r) { return '<b>' + esc(r.name) + '</b>'; } },
        { key: 'avg', label: 'Avg margin %', sortable: true, num: true, align: 'right', render: function (r) { return r.avg == null ? '<span class="muted">&mdash;</span>' : '<b>' + esc(pctText(r.avg)) + '</b>'; } },
        { key: 'lowest', label: 'Lowest %', sortable: true, num: true, align: 'right', render: function (r) { return r.lowest == null ? '<span class="muted">&mdash;</span>' : esc(pctText(r.lowest)); } },
        { key: 'tier', label: 'Tier', sortable: true, sortValue: function (r) { return r.tier in TIER_ORDER ? TIER_ORDER[r.tier] : null; }, render: function (r) { return tierChip(r.tier); } },
        { key: 'lines', label: 'Lines with margin', sortable: true, num: true, align: 'right' },
        { key: 'waiting', label: 'Lines waiting', sortable: true, num: true, align: 'right' }
      ],
      empty: { title: 'No customers yet', hint: 'Customers appear once a contract line has a margin or is waiting.' },
      onRowClick: openCustomer
    });
    tabsApi = JPK.tabs({
      mount: '#tabs', label: 'Customer Margins views',
      tabs: [{ id: 'margins', label: 'Margins' }, { id: 'waiting', label: 'Waiting' }, { id: 'customers', label: 'Customers' }]
    });
  }

  /* ---------- controls ---------- */
  $('#f-vendor').addEventListener('change', function (e) { filt.vendor = e.target.value; render(); });
  $('#f-device').addEventListener('change', function (e) { filt.device = e.target.value; render(); });
  $('#f-tiers').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tier]'); if (!b) return;
    var t = b.getAttribute('data-tier'), i = filt.tiers.indexOf(t);
    if (i >= 0) filt.tiers.splice(i, 1); else filt.tiers.push(t);
    render();
  });
  $('#hide-test').addEventListener('change', function (e) { hideTest = e.target.checked; render(); });
  $('#refresh').addEventListener('click', function () { load(true); });

  var THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], theme = 'auto';
  try { var sv = localStorage.getItem('em-margins-theme'); if (sv === 'light' || sv === 'dark') theme = sv; } catch (e) { /* storage unavailable */ }
  var qm = /[?&]theme=(light|dark)/.exec(location.search); if (qm) theme = qm[1];
  function applyTheme(save) {
    var r = document.documentElement;
    if (theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', theme);
    var label = theme === 'auto' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';
    $('#theme').textContent = 'Theme: ' + label; $('#theme').setAttribute('aria-label', 'Theme: ' + label);
    if (save) { try { localStorage.setItem('em-margins-theme', theme); } catch (e) { /* storage unavailable */ } }
  }
  JPK.menu({ button: '#theme', items: THEMES.map(function (t) { return { label: t[1], onClick: function () { theme = t[0]; applyTheme(true); } }; }) });
  applyTheme(false);

  /* ---------- data ---------- */
  function showErr(msg) { var b = $('#load-err'); b.hidden = !msg; b.textContent = msg || ''; }
  function ingest(raw) { ALL = (raw || []).map(M.normalize); }
  function load(again) {
    showErr('');
    if (DEMO) { footNote = ''; ingest(window.MARGINS_DEMO); render(); if (again) JPK.toast('Demo data reloaded'); return Promise.resolve(); }
    return JPK.crm.coqlAll('select ' + FULL_FIELDS + WHERE).then(function (rows) {
      footNote = ''; ingest(rows); render(); if (again) JPK.toast('Updated');
    }, function () {
      /* a field may not be readable for this profile: fall back to a smaller select */
      return JPK.crm.coqlAll('select ' + SMALL_FIELDS + WHERE).then(function (rows) {
        footNote = 'Some detail fields could not be read, so the popout shows fewer details.';
        ingest(rows); render();
      });
    }).catch(function (e) {
      ALL = []; render();
      showErr('Could not load EM Margin rows. ' + (e && e.message ? e.message : '') + ' Check that your profile can view EM Margin, Contracts and Accounts.');
    });
  }

  build();
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init({ timeout: 4000 }).then(function (d) {
    DEMO = forceDemo || !!(d && d.demo);
    $('#demo-banner').hidden = !DEMO;
    return load(false);
  });
  window.__margins = { rows: function () { return ALL; }, demo: function () { return DEMO; } };
})();
