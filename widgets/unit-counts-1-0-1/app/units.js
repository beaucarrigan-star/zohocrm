/* Daily Unit Counts widget 1.0.0. Read-only: it never writes or copies anything, so the home-page tiles and this
   screen always show the same records.
   Reads: Daily_Unit_Counts (Count_Date, Device_Family, Acquisition, Account, On_Leg, Spare, Day_Leased_On_Leg,
          Day_Leased_On_Leg_Ex_Sheb, Day_Leased_Spare, Day_Leased_Spare_Ex_Sheb), Contracts (Account, Spare_Device_Clause, Spare_Clause_Detail, Contract_Status, Counterparty_Type), Accounts (Account_Name). */
(function () {
  'use strict';
  var J = window.JPK, $ = J.$, $$ = J.$$, crm = J.crm, esc = J.esc;
  var CFG = { fetchDays: 40, staleAfterDays: 2 };
  var S = { days: [], purch: {}, cust: [], range: 30, exSheb: true, thr: 20, filter: 'over', latest: null };

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
  function short(s) { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function num(v) { return v == null ? 0 : +v; }
  function agg(row, fn, f) { return num(row[fn + '(' + f + ')']); }
  function showErr(m) { var e = $('#err'); e.textContent = m || ''; e.hidden = !m; }

  var nx = J.next('#nx');
  var tabs = J.tabs('#tabs', {
    tabs: [{ id: 'fleet', label: 'Fleet' }, { id: 'cust', label: 'Customers' }],
    panes: { fleet: $('#p-fleet'), cust: $('#p-cust') },
    onChange: function (t) { if (t === 'fleet' && S.days.length) drawCharts(); }
  });
  J.menu('#more', { items: [{ label: 'Refresh', onClick: function () { load(); } }] });
  $('#about').appendChild(J.aboutButton(
    'One place for GPS units on leg and spares. The Fleet tab shows the totals and trends; the Customers tab checks each customer against its own contract spare clause.',
    'pick 7, 14 or 30 days, and switch Sheboygan in or out of the fleet totals. Open a customer to see its trend and clause.',
    'Spare % is spares divided by leased units on leg. Purchased devices never count toward spares. The numbers come from the same daily records as the home pages.'));

  /* ---------- load ---------- */
  function load() {
    var start = daysAgo(CFG.fetchDays);
    showErr('');
    return Promise.all([
      crm.coql("select Count_Date, MAX(Day_Leased_On_Leg), MAX(Day_Leased_On_Leg_Ex_Sheb), MAX(Day_Leased_Spare), MAX(Day_Leased_Spare_Ex_Sheb) from Daily_Unit_Counts where Count_Date >= '" + start + "' and Device_Family = 'GPS' group by Count_Date order by Count_Date"),
      crm.coql("select Count_Date, SUM(On_Leg), SUM(Spare) from Daily_Unit_Counts where Count_Date >= '" + start + "' and Device_Family = 'GPS' and Acquisition = 'Purchased' group by Count_Date")
    ]).then(function (r) {
      S.days = r[0].map(function (d) {
        return { date: d.Count_Date, leased: agg(d, 'MAX', 'Day_Leased_On_Leg'), leasedEx: agg(d, 'MAX', 'Day_Leased_On_Leg_Ex_Sheb'), spare: agg(d, 'MAX', 'Day_Leased_Spare'), spareEx: agg(d, 'MAX', 'Day_Leased_Spare_Ex_Sheb') };
      }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      S.purch = {}; r[1].forEach(function (d) { S.purch[d.Count_Date] = { onLeg: agg(d, 'SUM', 'On_Leg'), spare: agg(d, 'SUM', 'Spare') }; });
      S.latest = S.days.length ? S.days[S.days.length - 1].date : null;
      if (!S.latest) { nx.set({ tone: 'warn', title: 'No daily counts in the last ' + CFG.fetchDays + ' days.', sub: 'Check that the Allied SmartView email is arriving.' }); return; }
      drawFleet();
      return loadCustomers();
    }).catch(function (e) { showErr('Could not load the counts. ' + (e && e.message || '')); });
  }

  function loadCustomers() {
    return Promise.all([
      crm.coql("select Account, SUM(On_Leg), SUM(Spare) from Daily_Unit_Counts where Count_Date = '" + S.latest + "' and Device_Family = 'GPS' and Acquisition = 'Leased' group by Account"),
      crm.coql("select id, Account, Name, Spare_Device_Clause, Spare_Clause_Detail, Contract_Status from Contracts where Counterparty_Type = 'Customer' and Spare_Device_Clause is not null limit 2000")
    ]).then(function (r) {
      var rows = r[0].filter(function (x) { return x.Account; });
      var ids = rows.map(function (x) { return x.Account.id; });
      var names = ids.length ? crm.coql('select id, Account_Name from Accounts where id in (' + ids.join(',') + ')') : Promise.resolve([]);
      return names.then(function (acc) {
        var nm = {}; acc.forEach(function (a) { nm[a.id] = a.Account_Name; });
        var byAcct = {}; r[1].forEach(function (c) { if (c.Account) (byAcct[c.Account.id] = byAcct[c.Account.id] || []).push(c); });
        S.cust = rows.map(function (x) {
          var id = x.Account.id, onLeg = agg(x, 'SUM', 'On_Leg'), spare = agg(x, 'SUM', 'Spare');
          var c = pickClause(byAcct[id] || []);
          return Object.assign({ id: id, name: nm[id] || x.Account.name || 'Account ' + id, onLeg: onLeg, spare: spare, pct: onLeg ? spare / onLeg * 100 : null, contract: c }, judge(c, onLeg, spare));
        });
        drawCustomers(); drawNext();
      });
    });
  }

  /* ---------- clause rules ---------- */
  /* One contract per account: not Ended first, then one with a % threshold, then any. */
  function pickClause(list) {
    function score(c) { return (c.Contract_Status === 'Ended' ? 0 : 2) + (/(\d+)%/.test(c.Spare_Device_Clause || '') ? 1 : 0); }
    return list.slice().sort(function (a, b) { return score(b) - score(a); })[0] || null;
  }
  /* Threshold clauses read "spares above N% of active leased units are billed; min 1 device always free".
     Allowance = max(1, N% of leased on leg). Units over = spares above the allowance, rounded up to whole devices. */
  function judge(c, onLeg, spare) {
    if (!c) return { status: 'No contract', tone: '', rank: 4, over: 0, clause: 'No contract on file' };
    var m = (c.Spare_Device_Clause || '').match(/(\d+)%/);
    if (m) {
      var t = +m[1], allow = Math.max(1, t / 100 * onLeg);
      var over = spare > allow ? Math.ceil(spare - allow - 1e-9) : 0;
      return { threshold: t, allow: allow, over: over, clause: t + '% threshold', status: over ? 'Over by ' + over : 'Within', tone: over ? 'bad' : 'good', rank: over ? 0 : 3 };
    }
    if (c.Spare_Device_Clause === 'No spare allowance') return { over: spare, clause: 'No spare allowance', status: spare ? 'No allowance' : 'Within', tone: spare ? 'warn' : 'good', rank: spare ? 1 : 3 };
    if (c.Spare_Device_Clause === 'Unknown') return { over: 0, clause: 'Unknown', status: 'Clause unknown', tone: 'warn', rank: 2 };
    return { over: 0, clause: c.Spare_Device_Clause, status: 'No clause', tone: '', rank: 4 };
  }
  function needsLook(c) { return c.rank <= 1; }

  /* ---------- fleet ---------- */
  function view() { return S.days.slice(-S.range); }
  function drawFleet() {
    var L = S.days[S.days.length - 1], P = S.purch[L.date] || { onLeg: 0, spare: 0 };
    var leased = S.exSheb ? L.leasedEx : L.leased, spare = S.exSheb ? L.spareEx : L.spare;
    $('#facts').innerHTML = '<div class="fact"><small>Latest count</small><span>' + esc(J.fmtDate(L.date)) + '</span></div>' +
      '<div class="fact"><small>Source</small><span>Allied SmartView</span></div>' +
      '<div class="fact"><small>Sheboygan</small><span>' + (S.exSheb ? 'Excluded' : 'Included') + '</span></div>';
    J.tiles('#tiles', [
      { label: 'Leased on leg', value: leased, note: S.exSheb ? 'excluding Sheboygan' : 'including Sheboygan' },
      { label: 'Purchased on leg', value: P.onLeg, note: P.spare + ' purchased spares, not counted' },
      { label: 'Leased spares', value: spare, note: leased ? (spare / leased * 100).toFixed(1) + '% of leased on leg' : '' }
    ]);
    J.$$('#tiles .tile').forEach(function (el, i) { el.id = ['t-leased', 't-purch', 't-spare'][i]; });
    if (!$('#p-fleet').hidden) drawCharts();
  }
  function drawCharts() {
    var v = view(), labels = v.map(function (d) { return short(d.date); });
    var leased = v.map(function (d) { return S.exSheb ? d.leasedEx : d.leased; });
    var purch = v.map(function (d) { return (S.purch[d.date] || { onLeg: 0 }).onLeg; });
    var pct = v.map(function (d) { var on = S.exSheb ? d.leasedEx : d.leased, sp = S.exSheb ? d.spareEx : d.spare; return on ? +(sp / on * 100).toFixed(1) : 0; });
    function pad(a, lo) { var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), p = Math.max(2, Math.round((mx - mn) * 0.2)); return [Math.max(lo, mn - p), mx + p]; }
    var lr = pad(leased, 0), pr = pad(purch, 0);
    J.chart('#ch-leased', { labels: labels, series: [{ name: 'Leased on leg', pts: leased, c: 'var(--s1)' }], ymin: lr[0], ymax: lr[1], t: 3, h: 150, aria: 'Leased GPS on leg, last ' + v.length + ' days' });
    J.chart('#ch-purch', { labels: labels, series: [{ name: 'Purchased on leg', pts: purch, c: 'var(--s2)' }], ymin: 0, ymax: Math.max(pr[1], 5), t: 3, h: 150, aria: 'Purchased GPS on leg, last ' + v.length + ' days' });
    var top = Math.max(50, Math.ceil(Math.max.apply(null, pct.concat([S.thr])) / 10) * 10 + 10);
    J.chart('#ch-pct', { labels: labels, series: [{ name: 'Spare %', pts: pct, c: 'var(--s3)' }], ymin: 0, ymax: top, t: 4, h: 170,
      fy: function (x) { return Math.round(x) + '%'; }, fv: function (x) { return x.toFixed(1) + '%'; }, hline: S.thr, hlabel: 'Line ' + S.thr + '%', aria: 'Leased spare percentage, last ' + v.length + ' days' });
  }

  /* ---------- customers ---------- */
  var ct = J.table('#ct', {
    caption: 'Leased GPS spares by customer against each contract spare clause',
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'onLeg', label: 'On leg', align: 'r', num: true },
      { key: 'spare', label: 'Spares', align: 'r', num: true },
      { key: 'pct', label: 'Spare %', align: 'r', num: true, hideNarrow: true, format: function (v) { return v == null ? '<span class="muted">None on leg</span>' : v.toFixed(0) + '%'; } },
      { key: 'clause', label: 'Clause', hideNarrow: true },
      { key: 'status', label: 'Status', sortValue: function (r) { return r.rank * 10000 - r.over * 10 - r.spare / 1000; }, format: function (v, r) { return J.chip(v, r.tone); } }
    ],
    sort: { key: 'status', dir: 1 },
    empty: { title: 'Every customer is within its spare clause.', text: ' Choose All to see them.' },
    onRow: openCustomer
  });
  function drawCustomers() {
    var n = S.cust.filter(needsLook).length;
    tabs.count('cust', n);
    $('#cust-h').textContent = 'Spares by customer, ' + J.fmtDate(S.latest);
    ct.setRows(S.filter === 'all' ? S.cust : S.cust.filter(needsLook));
  }
  $('#cf').addEventListener('click', function (e) {
    var b = e.target.closest('.pill'); if (!b) return;
    S.filter = b.dataset.f; $$('#cf .pill').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawCustomers();
  });
  function explain(c) {
    if (c.threshold != null) return 'The contract allows spares up to ' + c.threshold + '% of ' + c.onLeg + ' on leg (' + c.allow.toFixed(1).replace(/\.0$/, '') + '), with at least 1 always free. ' +
      (c.over ? c.spare + ' spares is ' + c.over + ' over, so ' + c.over + ' billable unit' + (c.over === 1 ? '' : 's') + '.' : c.spare + ' spares is within that.');
    if (c.status === 'No allowance') return 'The contract allows no spares, so all ' + c.spare + ' count against it.';
    if (c.status === 'Clause unknown') return 'The spare clause has not been confirmed. Check the contract.';
    return 'No spare clause applies to this customer.';
  }
  function openCustomer(c) {
    J.drawer.open({
      title: c.name,
      html: '<dl class="dl"><dt>On leg</dt><dd class="num">' + c.onLeg + '</dd><dt>Spares</dt><dd class="num">' + c.spare + '</dd><dt>Status</dt><dd>' + J.chip(c.status, c.tone) + '</dd>' +
        (c.contract ? '<dt>Contract</dt><dd>' + esc(c.contract.Name) + '</dd>' : '') + '</dl>' +
        '<p class="sm">' + esc(explain(c)) + '</p>' +
        (c.contract && c.contract.Spare_Clause_Detail ? '<div class="q" style="margin-bottom:14px">' + esc(c.contract.Spare_Clause_Detail) + '</div>' : '') +
        '<h4 class="sm muted" style="margin:0 0 6px">On leg and spares, last 30 days</h4><div id="cust-ch"><p class="sm muted">Loading the trend</p></div>',
      actions: [
        { label: 'Open the account', onClick: function () { if (window.ZOHO && ZOHO.CRM.UI && ZOHO.CRM.UI.Record) ZOHO.CRM.UI.Record.open({ Entity: 'Accounts', RecordID: c.id }); } }
      ].concat(c.contract ? [{ label: 'Open the contract', onClick: function () { if (window.ZOHO && ZOHO.CRM.UI && ZOHO.CRM.UI.Record) ZOHO.CRM.UI.Record.open({ Entity: 'Contracts', RecordID: c.contract.id }); } }] : []),
      onMount: function () {
        crm.coql("select Count_Date, SUM(On_Leg), SUM(Spare) from Daily_Unit_Counts where Account = " + c.id + " and Count_Date >= '" + daysAgo(31) + "' and Device_Family = 'GPS' and Acquisition = 'Leased' group by Count_Date order by Count_Date")
          .then(function (r) {
            var host = $('#cust-ch'); if (!host) return;
            if (r.length < 2) { host.innerHTML = '<p class="sm muted">Not enough days to show a trend.</p>'; return; }
            r.sort(function (a, b) { return a.Count_Date < b.Count_Date ? -1 : 1; });
            var on = r.map(function (d) { return agg(d, 'SUM', 'On_Leg'); }), sp = r.map(function (d) { return agg(d, 'SUM', 'Spare'); });
            J.chart(host, { labels: r.map(function (d) { return short(d.Count_Date); }), series: [{ name: 'On leg', pts: on, c: 'var(--s1)' }, { name: 'Spares', pts: sp, c: 'var(--s3)' }],
              ymin: 0, ymax: Math.max.apply(null, on.concat(sp).concat([4])) + 1, t: 3, h: 140, aria: c.name + ' on leg and spares, last 30 days' });
          }, function () { var host = $('#cust-ch'); if (host) host.innerHTML = '<p class="sm muted">The trend could not be loaded.</p>'; });
      }
    });
  }

  /* ---------- next step ---------- */
  function drawNext() {
    var age = Math.round((new Date(daysAgo(0) + 'T12:00:00') - new Date(S.latest + 'T12:00:00')) / 86400000);
    var over = S.cust.filter(needsLook);
    if (age > CFG.staleAfterDays) { nx.set({ tone: 'warn', title: 'No counts since ' + J.fmtDate(S.latest) + '.', sub: 'The Allied SmartView email may not have arrived. Figures below are from that day.' }); return; }
    if (over.length) {
      var units = over.reduce(function (a, c) { return a + c.over; }, 0);
      nx.set({ tone: 'warn', title: over.length + ' customer' + (over.length > 1 ? 's are' : ' is') + ' over the spare clause.', sub: units + ' billable spare unit' + (units === 1 ? '' : 's') + ' in total, by each contract\u2019s own clause.', action: { label: 'See customers', onClick: function () { tabs.select('cust'); } } });
      return;
    }
    nx.set({ tone: 'done', title: 'Every customer is within its spare clause.', sub: 'Counts are current as of ' + J.fmtDate(S.latest) + '.' });
  }

  /* ---------- controls ---------- */
  $('#range').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.range = +b.dataset.d; $$('#range button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawCharts();
  });
  $('#sheb').addEventListener('change', function () { S.exSheb = this.checked; drawFleet(); J.flash($('#t-leased')); J.flash($('#t-spare')); });
  $('#thr').addEventListener('input', function () { S.thr = +this.value; $('#thro').textContent = S.thr + '%'; drawCharts(); });

  crm.init().then(function (page) {
    if (!page) { showErr('Open this screen inside Zoho CRM to load the counts.'); return; }
    return load();
  });
})();
