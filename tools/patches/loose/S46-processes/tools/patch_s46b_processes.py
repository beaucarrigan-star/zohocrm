"""S46 part 2 (30 Oct 2026): Processes v3.2.0 = v3.1.3 + contract dates, per-device lines and the tri-brand logo.
Hash-guarded: refuses any base whose hashes differ from v3.1.3 (93a14795d8f4d64a)."""
import hashlib, io, sys, zipfile
BASE, LOGO, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
def h(b): return hashlib.sha256(b).hexdigest()[:16]
raw = open(BASE, 'rb').read(); assert h(raw) == '93a14795d8f4d64a', 'base zip ' + h(raw)
logo = open(LOGO, 'rb').read(); assert len(logo) == 54033 and h(logo) == h(logo), 'logo size %d' % len(logo)
zin = zipfile.ZipFile(io.BytesIO(raw)); files = {i.filename: zin.read(i.filename) for i in zin.infolist()}
GUARD = {'app/processes.html': '02b304ab3d4fe148', 'app/processes-view.js': '032f5842a505e70e', 'app/processes-demo.js': None}
for k, v in GUARD.items():
    if v: assert h(files[k]) == v, '%s %s' % (k, h(files[k]))
assert 'app/jpk-logo.png' not in files
def rep(name, pairs):
    t = files[name].decode('utf-8')
    for a, b in pairs:
        assert t.count(a) == 1, '%s: expected one "%s"' % (name, a[:70])
        t = t.replace(a, b)
    files[name] = t.encode('utf-8')

# ---- processes-view.js: laneView gains derive / child lines / detail extra; p_contract uses them ----
rep('app/processes-view.js', [
# (1) load(): apply derive and load child lines in demo and live
("      if (!X.isLive()) { S.rows = window.PROC_DEMO[o.demo]; S.loaded = true; S.busy = false; return Promise.resolve(); }\n      return pageAll('select id, ' + o.select + ' from ' + o.entity + ' where id is not null', 'id asc').then(function (r) { S.rows = r; S.loaded = true; S.busy = false; }, function (e) { S.err = e.message || 'Read failed'; S.loaded = true; S.busy = false; });",
 "      function finish(rows) { S.rows = rows; if (o.derive) rows.forEach(o.derive); S.loaded = true; S.busy = false; if (o.lines) return loadLines(o, rows).then(function () { if (o.derive) rows.forEach(o.derive); }); }\n      if (!X.isLive()) { return Promise.resolve(finish(window.PROC_DEMO[o.demo])); }\n      return pageAll('select id, ' + o.select + ' from ' + o.entity + ' where id is not null', 'id asc').then(finish, function (e) { S.err = e.message || 'Read failed'; S.loaded = true; S.busy = false; });"),
# (2) draw(): detail panel gets o.detailExtra after the dl
("'</dd>'; }).join('') + '</dl><div class=\"ac",
 "'</dd>'; }).join('') + '</dl>' + (o.detailExtra ? o.detailExtra(cur) : '') + '<div class=\"ac"),
# (3) helpers before the Contract view
("  var truthy = function (v) { return v === true || v === 'true'; };\n  var s = function (v) { return v && v !== '-None-' ? String(v) : ''; };\n  var RM = window.RecModules;\n  RM.p_contract = laneView({",
 r"""  var truthy = function (v) { return v === true || v === 'true'; };
  var s = function (v) { return v && v !== '-None-' ? String(v) : ''; };
  /* S46: child rows (Rate Lines) for the Contract pipeline, fetched in chunks after the contracts load. r._lines = [] when none. */
  function loadLines(o, rows) {
    rows.forEach(function (r) { r._lines = []; });
    var byId = {}; rows.forEach(function (r) { byId[String(r.id)] = r; });
    function put(ls) { ls.forEach(function (l) { var p = l[o.lines.parent], r = p && byId[String(p.id || p)]; if (r) r._lines.push(l); }); }
    if (!X.isLive()) { put(window.PROC_DEMO[o.lines.demo] || []); return Promise.resolve(); }
    var ids = rows.map(function (r) { return String(r.id); }), chunks = []; while (ids.length) chunks.push(ids.splice(0, 40));
    var q = chunks.reduce(function (p, c) { return p.then(function () {
      return X.coql('select ' + o.lines.select + ' from ' + o.lines.entity + ' where ' + o.lines.parent + " in ('" + c.join("','") + "') order by id asc limit 200").then(function (res) { put(res.rows || res || []); }, function () { /* lines are optional: the row still shows */ });
    }); }, Promise.resolve());
    return q;
  }
  function addMonths(iso, m) { var d = X.R.parseDate(iso); if (!d || !m) return ''; var x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate())); return x.toISOString().slice(0, 10); }
  var LINE_DEAD = /Superseded|Rejected/;
  function vendShort(l) { var n = X.R.plain(l['Rate_Vendor.Vendor_Name']) || X.R.plain(l.Rate_Vendor) || ''; return String(n).split(/[\s(]/)[0]; }
  function money2(n) { return n == null || n === '' || isNaN(+n) ? '' : '$' + (+n).toFixed(2); }
  function contractDerive(r) {
    var end0 = r.Original_End_Date || r.Contract_End_Date || '', len = +r.Renewal_Option_Length_Mo || 0;
    var allowed = r.Renewals_Allowed != null && r.Renewals_Allowed !== '' ? +r.Renewals_Allowed : (r.Renewal_Options_Left != null && r.Renewal_Options_Left !== '' ? +r.Renewal_Options_Left : 0);
    r._end0 = end0;
    r._end1 = r.End_After_1_Renewal || (allowed >= 1 && len ? addMonths(end0, len) : '');
    r._end2 = allowed >= 2 ? (len ? addMonths(end0, 2 * len) : (allowed === 2 ? (r.Final_End_Date || '') : '')) : '';
    r._renew = allowed ? allowed + (len ? ' x ' + len + ' mo' : '') : 'None';
    var ls = (r._lines || []).filter(function (l) { return !LINE_DEAD.test(s(l.Line_Status)); }), seen = {}, parts = [];
    ls.sort(function (a, b) { return (s(b.Line_Status) === 'Verified') - (s(a.Line_Status) === 'Verified'); });
    ls.forEach(function (l) { var d = s(l.Rate_Device) || 'Device'; if (seen[d]) return; seen[d] = 1; var v = vendShort(l); parts.push(d + ' ' + money2(l.Rate_Daily_Amount) + (v ? ' (' + v + ')' : '')); });
    r._dev = parts.length ? parts.join(' · ') : (r.Contractbook_Rates ? 'CB: ' + String(r.Contractbook_Rates) : '');
    r._nodev = parts.length ? '' : 'none';
  }
  function contractLinesHtml(r) {
    var ls = r._lines || [];
    var h = '<h4 style="margin:12px 0 6px;font-size:13px">Devices and pricing</h4>';
    if (!ls.length) return h + '<p class="mut" style="margin:0">No rate lines on this contract.' + (r.Contractbook_Rates ? ' Contractbook rates: ' + esc(String(r.Contractbook_Rates)) : '') + '</p>';
    h += '<div class="tw" style="border-radius:var(--r-sm);border:1px solid var(--line)"><table><thead><tr><th scope="col">Equipment</th><th scope="col">Manufacturer</th><th scope="col" class="r">Rate / day</th><th scope="col">Type</th><th scope="col">Line status</th><th scope="col">Effective</th></tr></thead><tbody>';
    ls.forEach(function (l) { h += '<tr><td>' + esc(s(l.Rate_Device)) + '</td><td>' + esc(X.R.plain(l['Rate_Vendor.Vendor_Name']) || X.R.plain(l.Rate_Vendor) || '') + '</td><td class="r">' + esc(money2(l.Rate_Daily_Amount)) + '</td><td>' + esc(s(l.Rate_Type)) + '</td><td>' + X.pillHtml(s(l.Line_Status) || 'Unreviewed') + '</td><td>' + esc(X.R.fmt(l.Effective_Date, 'date')) + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }
  var RM = window.RecModules;
  RM.p_contract = laneView({"""),
# (4) p_contract: select, lines, derive, cols, detail
("    select: 'Name, Account, Contract_Status, Ingest_Status, Needs_Cleanup, Reconciliation_Status, Days_to_Final_End, Renewal_Band',",
 "    select: 'Name, Account, Contract_Status, Ingest_Status, Needs_Cleanup, Reconciliation_Status, Days_to_Final_End, Renewal_Band, Contract_Start_Date, Original_End_Date, Contract_End_Date, End_After_1_Renewal, Final_End_Date, Renewals_Allowed, Renewal_Options_Left, Renewal_Option_Length_Mo, Contractbook_Rates, Contractbook_Status',\n    lines: { entity: 'Rate_Lines', parent: 'Parent_Id', demo: 'rate_lines', select: 'id, Parent_Id, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name, Rate_Daily_Amount, Rate_Type, Line_Status, Effective_Date' },\n    derive: contractDerive, detailExtra: contractLinesHtml,"),
("      { id: 'done', label: 'Ingested', kpi: 'good', test: function (r) { return s(r.Ingest_Status) === 'Ingested'; } },\n      { id: 'all', label: 'All contracts', test: function () { return true; } }",
 "      { id: 'done', label: 'Ingested', kpi: 'good', test: function (r) { return s(r.Ingest_Status) === 'Ingested'; } },\n      { id: 'nodev', label: 'No device pricing', kpi: 'warn', test: function (r) { return !!r._nodev && s(r.Contract_Status) !== 'Ended'; } },\n      { id: 'all', label: 'All contracts', test: function () { return true; } }"),
("    cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Account', label: 'Account' }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Ingest_Status', label: 'Ingest', pill: 1 }, { k: 'Reconciliation_Status', label: 'Reconciliation', pill: 1 }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }],",
 "    cols: [{ k: 'Name', label: 'Contract', main: 1 }, { k: 'Account', label: 'Account' }, { k: 'Contract_Status', label: 'Status', pill: 1 }, { k: 'Contract_Start_Date', label: 'Start', t: 'date' }, { k: '_end0', label: 'End (no renewals)', t: 'date' }, { k: '_end1', label: 'After 1 renewal', t: 'date' }, { k: '_end2', label: 'After 2 renewals', t: 'date' }, { k: 'Days_to_Final_End', label: 'Days left', t: 'num', r: 1 }, { k: '_dev', label: 'Devices and pricing', trunc: 90 }],"),
("    detail: [['Account', 'Account'], ['Contract_Status', 'Contract status'], ['Ingest_Status', 'Ingest'], ['Needs_Cleanup', 'Needs cleanup'], ['Reconciliation_Status', 'Reconciliation'], ['Renewal_Band', 'Renewal band'], ['Days_to_Final_End', 'Days left', 'num']]",
 "    detail: [['Account', 'Account'], ['Contract_Status', 'Contract status'], ['Contract_Start_Date', 'Start date', 'date'], ['_end0', 'End date (no renewals)', 'date'], ['_end1', 'End after 1 renewal', 'date'], ['_end2', 'End after 2 renewals', 'date'], ['Final_End_Date', 'Final end (all options)', 'date'], ['Days_to_Final_End', 'Days left to final end', 'num'], ['_renew', 'Renewals'], ['Ingest_Status', 'Terms source'], ['Contractbook_Status', 'Contractbook'], ['Needs_Cleanup', 'Needs cleanup'], ['Reconciliation_Status', 'Reconciliation'], ['Renewal_Band', 'Renewal band']]"),
])

# ---- demo data ----
rep('app/processes-demo.js', [
("  return { periods: periods, findings: findings, contracts: contracts, solicitations: sols };",
 """  contracts[0].Contract_Start_Date = '2025-03-01'; contracts[0].Contract_End_Date = '2027-02-28'; contracts[0].Renewal_Options_Left = 2; contracts[0].Renewal_Option_Length_Mo = 12; contracts[0].Final_End_Date = '2029-02-28'; contracts[0].Contractbook_Status = 'Live contract';
  contracts[1].Contract_Start_Date = '2021-03-01'; contracts[1].Original_End_Date = '2023-03-25'; contracts[1].Contract_End_Date = '2023-03-25'; contracts[1].Renewals_Allowed = 0; contracts[1].Contractbook_Status = 'Archive PDF only';
  contracts[2].Contract_Start_Date = '2024-01-01'; contracts[2].Contract_End_Date = '2026-12-31'; contracts[2].Contractbook_Rates = 'GPS $5.75'; contracts[2].Contractbook_Status = 'Live contract';
  contracts[3].Contract_Start_Date = '2024-03-01'; contracts[3].Original_End_Date = '2025-12-31'; contracts[3].End_After_1_Renewal = '2026-12-31'; contracts[3].Renewals_Allowed = 2; contracts[3].Renewal_Option_Length_Mo = 12; contracts[3].Final_End_Date = '2027-12-31'; contracts[3].Contractbook_Status = 'Live contract';
  var rate_lines = [
    { id: 'l1', Parent_Id: { id: 'c1', name: 'Clark County Human Services' }, Rate_Device: 'GPS', Rate_Vendor: { id: 'v1', name: 'Allied Universal Electronic Monitoring' }, 'Rate_Vendor.Vendor_Name': 'Allied Universal Electronic Monitoring', Rate_Daily_Amount: 4, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l2', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'GPS', Rate_Vendor: null, 'Rate_Vendor.Vendor_Name': null, Rate_Daily_Amount: 13.15, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l3', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'Remote Breath', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 12.3, Rate_Type: 'Customer rate', Line_Status: 'Verified', Effective_Date: null },
    { id: 'l4', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'CAM', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 15, Rate_Type: 'Customer rate', Line_Status: 'Superseded', Effective_Date: null },
    { id: 'l5', Parent_Id: { id: 'c4', name: 'Marinette County DA Diversion' }, Rate_Device: 'CAM', Rate_Vendor: { id: 'v2', name: 'SCRAM Systems' }, 'Rate_Vendor.Vendor_Name': 'SCRAM Systems', Rate_Daily_Amount: 15, Rate_Type: 'Customer rate', Line_Status: null, Effective_Date: '2024-04-04' }
  ];
  return { periods: periods, findings: findings, contracts: contracts, solicitations: sols, rate_lines: rate_lines };"""),
])

# ---- page meta ----
rep('app/processes.html', [
('content="Processes tab v3.1.3 (v3.1.2 minus Contract > Ingest; contracts come from Contractbook, S46 30 Oct 2026)"',
 'content="Processes tab v3.2.0 (v3.1.3 + contract dates, devices and pricing per contract, tri-brand logo restored, S46 30 Oct 2026)"'),
])
files['app/jpk-logo.png'] = logo
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist(): zout.writestr(i.filename, files[i.filename])
    zout.writestr('app/jpk-logo.png', logo)
print('wrote', OUT, h(open(OUT, 'rb').read()))
for k in ['app/processes.html', 'app/processes-view.js', 'app/processes-demo.js', 'app/jpk-logo.png']: print(k, h(files[k]))
