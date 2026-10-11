/* Vendors canvas widget 1.0.0
   Reads: Vendors (Vendor_Name, Description, Relationship_Status, Last_Vendor_Review, After_hours_number, Support_Email_RMA,
          Support_Hours, Customer_Portal, Main_Point_of_Contact, EM_JusticePoint_Vendor), Contacts (Vendor_Name),
          Products (Cost_Lease_Daily, Vendor_Contract_Rate, Contract_Check, Contract_Check_Detail, Tier_Volume, Tier_Volume_Date),
          Rate_Lines (verified tier lines on the vendor's tier contract).
   Writes: Products.Cost_Lease_Daily only, when you correct a cost. The existing cost check decides Match or Mismatch. */
(function () {
  'use strict';
  var J = window.JPK, $ = J.$, $$ = J.$$, crm = J.crm, esc = J.esc;

  var CFG = {
    /* Tier rates come from verified lines on this contract only (Allied standard). Other vendors have no tiers, so the gauge hides. */
    tierContract: { '6715134000002099249': '6715134000006441256' },
    tierProduct: { '6715134000002099249': '1 Piece GPS - Allied' },   // carries Tier_Volume (excludes Sheboygan)
    vendorOrder: ['Allied', 'SCRAM', 'SuperCom', 'Buddi']
  };
  /* Contract_Check values seen in the org, plus a mismatch value the check may write */
  var CHECK = {
    'Matches contract': ['Match', 'good', 0],
    'No cost entered': ['No cost', 'warn', 1],
    'No contract rate': ['No rate', '', 1]
  };
  function check(v) {
    if (CHECK[v]) return CHECK[v];
    if (v && /mismatch|does not match|differs/i.test(v)) return ['Mismatch', 'bad', 1];
    return [v || 'Not checked', '', 1];
  }

  var S = { vendors: [], v: null, contacts: [], products: [], tiers: [], filter: 'need', whatIf: null };

  var nx = J.next('#nx');
  var tb = J.tabs('#tabs', {
    tabs: [{ id: 'call', label: 'Who to call' }, { id: 'cost', label: 'Pricing and costs' }],
    panes: { call: $('#p-call'), cost: $('#p-cost') }
  });
  var more = J.menu('#more', { items: [] });
  $('#about').appendChild(J.aboutButton(
    'When a case or a bid needs a vendor, this screen shows who to call first. Pricing and costs sit on the second tab, with a badge when a device cost needs a look.',
    'copy a number from Who to call, or open Pricing and costs to see the Allied tier and each device cost. Open a device to correct its cost.',
    'Vendors here are the four device suppliers only: Allied, SCRAM, SuperCom and Buddi.'));
  function showErr(m) { var e = $('#err'); e.textContent = m || ''; e.hidden = !m; }

  /* ---------- copy ---------- */
  function copy(txt) {
    function done() { J.toast('Copied ' + txt); }
    function fallback() {
      var t = document.createElement('textarea'); t.value = txt; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { J.toast('Select and copy: ' + txt); }
      t.remove();
    }
    try { navigator.clipboard.writeText(txt).then(done, fallback); } catch (e) { fallback(); }
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });
  function fmtPhone(n) { var d = String(n).replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : String(n); }
  function tel(n) { return 'tel:' + String(n).replace(/[^\d+]/g, ''); }
  function phoneRow(n) {
    return n ? '<div class="phone"><a href="' + tel(n) + '">' + esc(fmtPhone(n)) + '</a><button class="btn sm" data-copy="' + esc(n) + '">Copy</button></div>' : '';
  }

  /* ---------- data ---------- */
  function loadVendors() {
    return crm.coql('select id, Vendor_Name, Description, Relationship_Status, Last_Vendor_Review, After_hours_number, Support_Email_RMA, Support_Hours, Customer_Portal, Main_Point_of_Contact from Vendors where EM_JusticePoint_Vendor = true')
      .then(function (r) {
        function rank(v) { var i = CFG.vendorOrder.findIndex(function (k) { return v.Vendor_Name.indexOf(k) === 0; }); return i < 0 ? 99 : i; }
        S.vendors = r.sort(function (a, b) { return rank(a) - rank(b); });
        $('#vpick').innerHTML = S.vendors.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.Vendor_Name) + '</option>'; }).join('');
      });
  }
  function loadVendor(vid) {
    var v = S.vendors.filter(function (x) { return x.id === vid; })[0];
    if (!v) { showErr('That vendor is not one of the four device suppliers.'); return Promise.resolve(); }
    S.v = v; S.whatIf = null; showErr('');
    $('#vpick').value = vid;
    var tierQ = CFG.tierContract[vid]
      ? crm.coql("select id, Rate_Device, Rate_Daily_Amount, Tier_Min_Units, Tier_Max_Units from Rate_Lines where Parent_Id = " + CFG.tierContract[vid] + " and Line_Status = 'Verified' and Rate_Device = 'GPS' and Tier_Min_Units is not null order by Tier_Min_Units")
      : Promise.resolve([]);
    return Promise.all([
      crm.coql('select id, Full_Name, Title, Mobile, Phone, Email from Contacts where Vendor_Name = ' + vid + ' order by Full_Name'),
      crm.coql('select id, Product_Name, EM_Device_Family, Cost_Lease_Daily, Vendor_Contract_Rate, Contract_Check, Contract_Check_Detail, Contract_Checked_On, Tier_Volume, Tier_Volume_Date, Current_Tier from Products where Vendor_Name = ' + vid + ' and Product_Active = true order by Product_Name'),
      tierQ
    ]).then(function (r) {
      S.contacts = r[0]; S.products = r[1]; S.tiers = dedupeTiers(r[2]);
      draw();
    }, function (e) { showErr('Could not load this vendor. ' + (e && e.message || '')); });
  }
  function dedupeTiers(lines) {
    var seen = {};
    return lines.filter(function (l) { var k = l.Tier_Min_Units + '-' + l.Tier_Max_Units; if (seen[k]) return false; seen[k] = 1; return true; });
  }

  /* ---------- drawing ---------- */
  function issues() { return S.products.filter(function (p) { return (p._preview || check(p.Contract_Check))[2]; }); }
  function draw() {
    var v = S.v;
    $('#vname').textContent = v.Vendor_Name;
    $('#facts').innerHTML = [
      ['Supplies', v.Description], ['Relationship', v.Relationship_Status], ['Last reviewed', v.Last_Vendor_Review ? J.fmtDate(v.Last_Vendor_Review) : '']
    ].filter(function (f) { return f[1]; }).map(function (f) { return '<div class="fact"><small>' + esc(f[0]) + '</small><span>' + esc(f[1]) + '</span></div>'; }).join('');
    more.setItems([
      { label: 'Open the inventory portal', hidden: !v.Customer_Portal, onClick: function () { window.open(v.Customer_Portal, '_blank', 'noopener'); } },
      { label: 'Open the vendor record', onClick: function () { if (window.ZOHO && ZOHO.CRM.UI && ZOHO.CRM.UI.Record) ZOHO.CRM.UI.Record.open({ Entity: 'Vendors', RecordID: v.id }); } },
      { label: 'Refresh', onClick: function () { loadVendor(v.id); } }
    ]);
    drawCall(); drawTier(); drawCatalog(); drawNext();
  }
  function drawNext() {
    var n = issues().length, p = primary();
    tb.count('cost', n);
    if (n) nx.set({ tone: 'warn', title: n + ' device cost' + (n > 1 ? 's need' : ' needs') + ' a look.', sub: issues().map(function (x) { return x.Product_Name + ': ' + plain(x); }).slice(0, 3).join('. ') + '.', action: { label: 'See costs', onClick: function () { tb.select('cost'); } } });
    else nx.set({ tone: 'done', title: 'Every device cost matches the contract.', sub: p ? 'First call: ' + p.Full_Name + (p.Title ? ', ' + p.Title : '') + '.' : '' });
  }
  function plain(x) { var c = (x._preview || check(x.Contract_Check))[0]; return { 'No cost': 'no cost entered', 'No rate': 'no contract rate found', 'Mismatch': 'cost differs from the contract' }[c] || c.toLowerCase(); }
  function primary() {
    var pid = S.v.Main_Point_of_Contact && S.v.Main_Point_of_Contact.id;
    return S.contacts.filter(function (c) { return c.id === pid; })[0] || S.contacts[0] || null;
  }
  function drawCall() {
    var p = primary(), v = S.v;
    $('#primary').innerHTML = '<h2>Call first</h2>' + (p
      ? '<div class="who"><b class="nm">' + esc(p.Full_Name) + '</b><div class="ttl">' + esc(p.Title || 'Main point of contact') + '</div>' +
        phoneRow(p.Mobile || p.Phone) + (p.Email ? '<div class="kv"><a href="mailto:' + esc(p.Email) + '">' + esc(p.Email) + '</a></div>' : '') +
        (!p.Mobile && !p.Phone ? '<p class="sm muted">No phone number on file. Use the after-hours line or email.</p>' : '') + '</div>'
      : '<div class="empty"><b>No contact on file.</b>Add the main point of contact on the vendor record.</div>');
    var rma = v.Support_Email_RMA || '', isMail = /^[^\s@]+@[^\s@]+$/.test(rma);
    $('#support').innerHTML = '<h2>Support</h2>' +
      (v.After_hours_number ? '<div class="kv"><small>After hours</small>' + phoneRow(v.After_hours_number) + '</div>' : '') +
      (v.Support_Hours ? '<div class="kv"><small>Hours</small>' + esc(v.Support_Hours) + '</div>' : '') +
      (rma ? '<div class="kv"><small>Orders and returns</small>' + (isMail ? '<a href="mailto:' + esc(rma) + '">' + esc(rma) + '</a>' : esc(rma)) + '</div>' : '') +
      (v.Customer_Portal ? '<a class="btn" href="' + esc(v.Customer_Portal) + '" target="_blank" rel="noopener">Open the inventory portal</a>' : '');
    var others = S.contacts.filter(function (c) { return !p || c.id !== p.id; });
    $('#people').innerHTML = others.length ? others.map(function (c) {
      var n = c.Mobile || c.Phone;
      return '<li><div style="min-width:0"><b>' + esc(c.Full_Name) + '</b><div class="sm muted">' + esc(c.Title || '') + (c.Email ? (c.Title ? ', ' : '') + '<a href="mailto:' + esc(c.Email) + '">' + esc(c.Email) + '</a>' : '') + '</div></div>' +
        (n ? '<button class="btn sm" data-copy="' + esc(n) + '" aria-label="Copy ' + esc(c.Full_Name) + ' number ' + esc(n) + '">Copy number</button>' : '') + '</li>';
    }).join('') : '<li class="muted">No other contacts on file.</li>';
  }

  /* ---------- tier gauge (Allied only) ---------- */
  function tierFor(units) {
    for (var i = 0; i < S.tiers.length; i++) {
      var t = S.tiers[i];
      if (units >= t.Tier_Min_Units && (t.Tier_Max_Units == null || units <= t.Tier_Max_Units)) return { i: i, t: t };
    }
    return null;
  }
  function drawTier() {
    var box = $('#tier');
    var tp = S.products.filter(function (p) { return p.Product_Name === CFG.tierProduct[S.v.id]; })[0];
    if (!S.tiers.length || !tp || tp.Tier_Volume == null) { box.hidden = true; return; }
    box.hidden = false;
    var real = tp.Tier_Volume, units = S.whatIf == null ? real : S.whatIf;
    var last = S.tiers[S.tiers.length - 1], top = Math.max(last.Tier_Min_Units + 99, Math.ceil(Math.max(real, units) * 1.25 / 50) * 50);
    var cur = tierFor(units), nxt = cur && S.tiers[cur.i + 1];
    var spans = S.tiers.map(function (t) { var hi = t.Tier_Max_Units == null ? top : t.Tier_Max_Units; return { t: t, w: hi - t.Tier_Min_Units + 1 }; });
    var total = spans.reduce(function (a, s) { return a + s.w; }, 0);
    var pinPct = Math.min(99.5, Math.max(0.5, (units - 1) / total * 100));
    box.innerHTML = '<h2>Allied tier <em>' + (S.whatIf == null ? 'as of ' + esc(J.fmtDate(tp.Tier_Volume_Date)) : 'what if') + '</em></h2>' +
      '<div class="tiles">' +
      '<div class="tile" id="t-vol"><small>Tier volume</small><b>' + units + '</b><i>' + (S.whatIf == null ? '1-Piece GPS on leg, excluding Sheboygan' : 'what-if, actual ' + real) + '</i></div>' +
      '<div class="tile" id="t-rate"><small>Rate per unit per day</small><b>' + (cur ? J.money(cur.t.Rate_Daily_Amount) : 'None') + '</b><i>' + (cur ? tierLabel(cur.t) + ' units' : 'outside the tiers') + '</i></div>' +
      '<div class="tile" id="t-next"><small>To the next break</small><b>' + (nxt ? (nxt.Tier_Min_Units - units) : 'Top tier') + '</b><i>' + (nxt ? 'units to ' + J.money(nxt.Rate_Daily_Amount) + ' at ' + nxt.Tier_Min_Units : 'lowest rate already') + '</i></div>' +
      '</div>' +
      '<div class="gauge" role="img" aria-label="Tier position: ' + units + ' units, ' + (cur ? tierLabel(cur.t) + ' tier' : 'no tier') + '">' +
      spans.map(function (s, i) { return '<div style="flex:' + s.w + '" class="' + (cur && cur.i === i ? 'on' : '') + '">' + esc(tierLabel(s.t)) + '<span class="gr"> ' + J.money(s.t.Rate_Daily_Amount) + '</span></div>'; }).join('') +
      '<i class="pin" style="left:' + pinPct + '%"><span>' + units + '</span></i></div>' +
      '<div class="whatif"><label for="wi" class="sm muted">What if the volume were</label><output for="wi" id="wio">' + units + ' units</output>' +
      '<input type="range" id="wi" min="1" max="' + top + '" value="' + units + '" aria-describedby="wio">' +
      '<button class="btn sm" id="wir"' + (S.whatIf == null ? ' disabled' : '') + '>Back to actual</button></div>' +
      (S.whatIf == null ? '' : '<p class="sm muted" style="margin:8px 0 0">What-if only. Nothing is saved.</p>');
    $('#wi').addEventListener('input', function () { var keep = document.activeElement === this; S.whatIf = +this.value === real ? null : +this.value; drawTier(); if (keep) $('#wi').focus(); });
    $('#wir').addEventListener('click', function () { S.whatIf = null; drawTier(); $('#wi').focus(); });
  }
  function tierLabel(t) { return t.Tier_Max_Units == null ? t.Tier_Min_Units + '+' : t.Tier_Min_Units + '–' + t.Tier_Max_Units; }

  /* ---------- catalog ---------- */
  var cat = J.table('#cat', {
    caption: 'Device costs for this vendor',
    columns: [
      { key: 'Product_Name', label: 'Device' },
      { key: 'EM_Device_Family', label: 'Family', hideNarrow: true },
      { key: 'Cost_Lease_Daily', label: 'Our cost', align: 'r', num: true, format: function (v) { return v == null ? '<span class="muted">None</span>' : J.money(v); } },
      { key: 'Vendor_Contract_Rate', label: 'Contract', align: 'r', num: true, format: function (v) { return v == null ? '<span class="muted">None</span>' : J.money(v); } },
      { key: 'Contract_Check', label: 'Check', sortValue: function (r) { return check(r.Contract_Check)[2] ? '0' + check(r.Contract_Check)[0] : '1'; },
        format: function (v, r) { var c = r._preview || check(v); return J.chip(c[0], c[1]); } }
    ],
    sort: { key: 'Contract_Check', dir: 1 },
    empty: { title: 'Every device cost matches the contract.', text: ' Choose All to see them.' },
    onRow: openDevice
  });
  function drawCatalog() {
    cat.setRows(S.filter === 'all' ? S.products : issues());
  }
  $('#cf').addEventListener('click', function (e) {
    var b = e.target.closest('.pill'); if (!b) return;
    S.filter = b.dataset.f; $$('#cf .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawCatalog();
  });

  /* The contract rates a cost may match: Vendor_Contract_Rate, plus every amount listed in Contract_Check_Detail
     (for Allied, a match against any Allied contract passes). Used only for the preview chip after a save. */
  function contractAmounts(p) {
    var out = [];
    if (p.Vendor_Contract_Rate != null) out.push(+p.Vendor_Contract_Rate);
    String(p.Contract_Check_Detail || '').replace(/\$(\d+(?:\.\d+)?)/g, function (_, n) { out.push(+n); });
    return out;
  }
  function previewCheck(p, cost) {
    var amts = contractAmounts(p);
    if (cost == null) return ['No cost', 'warn', 1];
    if (!amts.length) return ['No rate', '', 1];
    return amts.some(function (a) { return Math.abs(a - cost) < 0.005; }) ? ['Match', 'good', 0] : ['Mismatch', 'bad', 1];
  }

  function openDevice(p) {
    var c = p._preview || check(p.Contract_Check);
    var detail = String(p.Contract_Check_Detail || '').split('\n').filter(Boolean);
    J.drawer.open({
      title: p.Product_Name,
      html: '<dl class="dl"><dt>Family</dt><dd>' + esc(p.EM_Device_Family || '') + '</dd>' +
        '<dt>Our cost</dt><dd class="num">' + (p.Cost_Lease_Daily == null ? 'None entered' : J.money(p.Cost_Lease_Daily)) + '</dd>' +
        '<dt>Contract rate</dt><dd class="num">' + (p.Vendor_Contract_Rate == null ? 'None found' : J.money(p.Vendor_Contract_Rate)) + '</dd>' +
        '<dt>Check</dt><dd>' + J.chip(c[0], c[1]) + (p.Contract_Checked_On ? ' <span class="sm muted">checked ' + esc(J.fmtDate(p.Contract_Checked_On)) + '</span>' : '') + '</dd></dl>' +
        (detail.length ? '<div class="q" style="margin-bottom:14px"><b class="sm">Contract lines the check found</b><br>' + detail.map(esc).join('<br>') + '</div>' : '') +
        '<label for="cost-in" class="sm muted" style="display:block;margin-bottom:4px">Correct our cost (per unit per day)</label>' +
        '<input type="number" id="cost-in" step="0.01" min="0" inputmode="decimal" value="' + (p.Cost_Lease_Daily == null ? '' : p.Cost_Lease_Daily) + '" style="width:140px">' +
        '<div class="sm muted" id="cost-why" style="margin-top:6px">Change the number to save it.</div>',
      actions: [{ label: 'Save cost', primary: true, disabled: true, onClick: function (close, body) { save(p, body, close); } }],
      onMount: function (body) {
        var inp = $('#cost-in', body), btn = $('.jpk-dr footer .btn.pri'), why = $('#cost-why', body);
        inp.addEventListener('input', function () {
          var raw = inp.value.trim(), n = raw === '' ? null : Math.round(+raw * 100) / 100;
          var bad = raw !== '' && (isNaN(+raw) || +raw < 0);
          var same = n === (p.Cost_Lease_Daily == null ? null : +p.Cost_Lease_Daily);
          btn.disabled = bad || same || n == null;
          why.textContent = bad ? 'Enter a cost of zero or more, like 3.05.' : n == null ? 'Enter a cost to save.' : same ? 'Change the number to save it.' :
            'Will save ' + J.money(n) + '. Preview: ' + previewCheck(p, n)[0].toLowerCase() + '.';
        });
      }
    });
  }
  function save(p, body, close) {
    var n = Math.round(+$('#cost-in', body).value * 100) / 100, btn = $('.jpk-dr footer .btn.pri');
    btn.disabled = true; btn.textContent = 'Saving';
    crm.update('Products', { id: p.id, Cost_Lease_Daily: n }, ['workflow']).then(function () {
      p.Cost_Lease_Daily = n;
      p._preview = previewCheck(p, n).concat(['preview']);
      close();
      drawCatalog(); drawNext();
      J.toast('Cost saved. The cost check will confirm the match.');
      var row = $$('#cat tbody tr').filter(function (tr) { return tr.textContent.indexOf(p.Product_Name) === 0; })[0];
      J.flash(row);
    }, function (e) {
      btn.disabled = false; btn.textContent = 'Save cost';
      $('#cost-why', body).textContent = 'Not saved: ' + (e && e.message || 'unknown error') + '.';
    });
  }

  /* ---------- boot ---------- */
  $('#vpick').addEventListener('change', function () { loadVendor(this.value); });
  crm.init().then(function (page) {
    if (!page) { showErr('Open this screen inside Zoho CRM to load vendors.'); return; }
    return loadVendors().then(function () {
      var onRecord = crm.entity === 'Vendors' && crm.entityId;
      $('#vpick').hidden = !!onRecord;
      return loadVendor(onRecord ? crm.entityId : (S.vendors[0] && S.vendors[0].id));
    });
  }).catch(function (e) { showErr('Could not load vendors. ' + (e && e.message || '')); });
})();
