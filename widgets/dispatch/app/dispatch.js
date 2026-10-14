/* DOC Dispatch canvas. Read-only: no writes to the CRM. Uses the JPK kit and DispatchModel.
   Live: four COQL reads (Coverage paged 200 at a time by JPK.crm.coqlAll). Demo: no SDK, or ?demo=1. */
(function () {
  'use strict';
  var M = window.DispatchModel, esc = JPK.esc;

  var state = { demo: false, date: M.isoDate(new Date()), shiftId: 'all', data: null, cells: [], gaps: [], present: [], loadedAt: null };
  var ui = {};

  /* ---------- demo data (illustrative; not real installers) ---------- */
  function demoData() {
    var now = new Date();
    var cities = [['Antigo','Langlade','6'],['Appleton','Outagamie','4'],['Eau Claire','Eau Claire','5'],['Green Bay','Brown','4'],['Janesville','Rock','1'],['Madison','Dane','1'],['Manitowoc','Manitowoc','7'],['Marinette','Marinette','6'],['Milwaukee','Milwaukee','3'],['Superior','Douglas','5'],['Wausau','Marathon','6'],['Racine','Racine','2']]
      .map(function (c, i) { return { id: 'c' + i, Name: c[0], County: c[1], DOC_Region: c[2], JP_Region: c[2], Active: true }; });
    cities.push({ id: 'cx', Name: 'Closed Office', County: 'Rock', DOC_Region: '1', Active: false });
    var shifts = [
      { id: 's1', Name: 'Day', Start: '08:00', End: '16:30', Days: 'Mon-Fri', Active: true },
      { id: 's2', Name: 'Evening', Start: '16:30', End: '22:00', Days: 'Mon-Fri', Active: true },
      { id: 's3', Name: 'Weekend', Start: '08:00', End: '16:30', Days: 'Sat, Sun', Active: true },
      { id: 's4', Name: 'Saturday only', Start: '08:00', End: '14:00', Days: 'Sat', Active: true }
    ];
    var people = ['Alex', 'Blair', 'Casey', 'Drew', 'Emery', 'Frankie'];
    var n = 0, coverage = [];
    cities.forEach(function (c, ci) {
      if (c.Active === false) return;
      shifts.forEach(function (s, si) {
        var key = ci + '-' + si;
        if (key === '0-0' || key === '0-1' || key === '7-1' || key === '9-0' || si === 3 && ci % 3) return;   /* no rows: uncovered */
        var p = people[(ci + si) % people.length], b = people[(ci + si + 2) % people.length];
        var primaryMissing = key === '1-1' || key === '10-0';                                                  /* backup only */
        var noBackup = key === '3-0' || key === '5-1';                                                         /* thin */
        function row(who, role) { n++; return { id: 'r' + n, City: { id: c.id, name: c.Name }, Shift: { id: s.id, name: s.Name }, Installer: { id: who, name: who }, Role: role, Effective_From: null, Effective_To: null, Coverage_Key: [c.Name, s.Name, role, who].join('|').toLowerCase() }; }
        if (!primaryMissing) coverage.push(row(p, 'Primary'));
        if (!noBackup) coverage.push(row(b, 'Backup'));
      });
    });
    var h = 3600000;
    var presence = [
      { id: 'p1', Installer: { id: 'Alex', name: 'Alex' }, County: 'Marinette', Present_From: new Date(now - h).toISOString(), Present_To: new Date(+now + h).toISOString(), Source: 'Manual', Details: 'On a job in Marinette' },
      { id: 'p2', Installer: { id: 'Casey', name: 'Casey' }, County: 'Langlade', Present_From: new Date(now - 2 * h).toISOString(), Present_To: null, Source: 'Manual', Details: null },
      { id: 'p3', Installer: { id: 'Zoe', name: 'Zoe' }, County: 'Brown', Present_From: new Date(now - h / 2).toISOString(), Present_To: new Date(+now + 3 * h).toISOString(), Source: 'Manual', Details: 'Not on the roster' }
    ];
    return { cities: cities, shifts: shifts, coverage: coverage, presence: presence };
  }

  /* ---------- live data ---------- */
  function load() {
    if (state.demo) return Promise.resolve(demoData());
    var since = new Date(Date.now() - 2 * 86400000).toISOString().replace(/\.\d+Z$/, '+00:00');
    return Promise.all([
      JPK.crm.coqlAll('select id, Name, County, DOC_Region, JP_Region, Active, City_Notes from Dispatch_Cities where id is not null'),
      JPK.crm.coqlAll('select id, Name, Start, End, Days, Active, Shift_Comments from Dispatch_Shifts where id is not null'),
      JPK.crm.coqlAll('select id, City, Shift, Installer, Role, Effective_From, Effective_To, Coverage_Key from Dispatch_Coverage where id is not null'),
      JPK.crm.coqlAll("select id, Installer, County, Present_From, Present_To, Source, Details from Installer_Presence where Present_From >= '" + since + "'")
    ]).then(function (r) { return { cities: r[0], shifts: r[1], coverage: r[2], presence: r[3] }; });
  }

  /* ---------- derive + render ---------- */
  function isToday() { return state.date === M.isoDate(new Date()); }

  function derive() {
    var d = state.data;
    var cov = M.uniqueById(d.coverage);
    state.cov = cov;
    var cells = M.buildMatrix(d.cities, d.shifts, cov, state.date);
    state.cells = state.shiftId === 'all' ? cells : cells.filter(function (c) { return c.shiftId === state.shiftId; });
    state.gaps = M.findGaps(state.cells);
    state.present = isToday() ? M.presentNow(d.presence, new Date()) : [];
    state.help = M.helpForGaps(state.gaps, state.present);
    state.checks = M.dataChecks(d.cities, d.shifts, d.coverage);
  }

  function names(list) {
    if (!list.length) return '<span class="dsp-none">None</span>';
    return '<span class="dsp-names">' + list.map(function (n) { return JPK.chip(n, 'neutral'); }).join('') + '</span>';
  }
  var LABEL = { covered: ['Covered', 'good'], backup_only: ['Backup only', 'warn'], uncovered: ['No one', 'bad'] };
  function statusChip(c) { var l = LABEL[c.status]; return JPK.chip(l[0], l[1]); }
  function cellColumns() {
    return [
      { key: 'city', label: 'City', sortable: true, render: function (r) { return '<b>' + esc(r.city) + '</b>'; } },
      { key: 'county', label: 'County', sortable: true, render: function (r) { return esc(r.county); } },
      { key: 'region', label: 'Region', sortable: true, align: 'center', num: true, render: function (r) { return esc(r.region); } },
      { key: 'shift', label: 'Shift', sortable: true, render: function (r) { return esc(r.shift) + ' <span class="muted sm">' + esc(r.shiftStart + '-' + r.shiftEnd) + '</span>'; } },
      { key: 'status', label: 'Status', sortable: true, render: statusChip },
      { key: 'primary', label: 'Primary', render: function (r) { return names(r.primary); }, sortValue: function (r) { return r.primary.join(', '); } },
      { key: 'backup', label: 'Backup', render: function (r) { return names(r.backup); } }
    ];
  }

  function renderTiles() {
    var s = M.summarize(state.cells);
    var t = [
      ['Covered', s.covered + ' of ' + s.cells, s.pctCovered + '% of city shifts'],
      ['No one', s.uncovered, 'no primary, no backup'],
      ['Backup only', s.backupOnly, 'no primary'],
      ['Single cover', s.thin, 'primary, no backup'],
      ['Installers present', isToday() ? state.present.length : '-', isToday() ? 'right now' : 'shown for today only']
    ];
    ui.tiles.innerHTML = t.map(function (x) { return '<div class="tile"><small>' + esc(x[0]) + '</small><b>' + esc(x[1]) + '</b><i>' + esc(x[2]) + '</i></div>'; }).join('');
    var gaps = state.gaps.length, cities = s.citiesWithGap;
    ui.next.update({
      title: gaps ? gaps + ' city shifts have no primary installer.' : 'Every city shift has a primary installer.',
      sub: gaps ? cities + ' ' + (cities === 1 ? 'city' : 'cities') + ' affected. Next: open the Gaps tab.' : 'Nothing to fix for this day.',
      progress: s.cells ? s.pctCovered : 0,
      button: gaps ? { label: 'Show gaps', onClick: function () { ui.tabs.select('gaps'); } } : null
    });
    ui.tabs.setCount('gaps', gaps);
    ui.tabs.setCount('checks', state.checks.length);
  }

  function renderShiftSeg() {
    var opts = [{ id: 'all', label: 'All shifts' }].concat(state.data.shifts.filter(function (s) { return s.Active !== false && M.shiftRunsOn(s, state.date); }).map(function (s) { return { id: s.id, label: s.Name }; }));
    if (!opts.some(function (o) { return o.id === state.shiftId; })) state.shiftId = 'all';
    ui.seg.innerHTML = opts.map(function (o) { return '<button type="button" data-s="' + esc(o.id) + '" aria-pressed="' + (o.id === state.shiftId) + '">' + esc(o.label) + '</button>'; }).join('');
  }

  function openCell(r) {
    var h = state.help.filter(function (x) { return x.cell.cityId === r.cityId && x.cell.shiftId === r.shiftId; })[0];
    var html = '<dl class="dl">' +
      '<dt>City</dt><dd>' + esc(r.city) + '</dd><dt>County</dt><dd>' + esc(r.county || 'Not set') + '</dd><dt>DOC region</dt><dd>' + esc(r.region || 'Not set') + '</dd>' +
      '<dt>Shift</dt><dd>' + esc(r.shift) + ' (' + esc(r.shiftStart + '-' + r.shiftEnd) + ')</dd><dt>Day</dt><dd>' + esc(state.date) + '</dd>' +
      '<dt>Status</dt><dd>' + statusChip(r) + '</dd><dt>Primary</dt><dd>' + names(r.primary) + '</dd><dt>Backup</dt><dd>' + names(r.backup) + '</dd></dl>';
    if (r.status !== 'covered') {
      html += '<h4>Installers present in ' + esc(r.county || 'this county') + ' now</h4>' +
        (h && h.nearby.length ? '<p>' + names(h.nearby) + '</p><p class="muted sm">From Installer Presence notes. Call them first.</p>'
          : '<p class="muted">' + (isToday() ? 'No one has a presence note for this county right now.' : 'Presence is shown for today only.') + '</p>');
    }
    html += '<p class="muted sm">To change who covers this, edit the rows in Dispatch Coverage (' + r.rowIds.length + ' rows today).</p>';
    JPK.drawer.open({ title: r.city + ' - ' + r.shift, html: html });
  }

  function renderPeople() {
    ui.presNote.textContent = isToday() ? '' : 'today only';
    ui.pres.setRows(M.presenceVsCoverage(state.present, state.cov, state.date).map(function (p) {
      var src = state.present.filter(function (x) { return x.installer === p.installer; })[0] || {};
      return { installer: p.installer, county: p.county, until: src.to, details: src.details, notRostered: p.notRostered };
    }));
    ui.load.setRows(M.installerLoad(state.cells));
  }

  function renderChecks() {
    ui.checks.innerHTML = state.checks.length ? state.checks.map(function (c) {
      return '<li><span><span class="dsp-sev ' + esc(c.severity) + '"></span>' + esc(c.text) + '</span>' + JPK.chip(c.severity === 'bad' ? 'Fix' : 'Check', c.severity) + '</li>';
    }).join('') : '<li><span>No problems found in cities, shifts or coverage.</span>' + JPK.chip('Clean', 'good') + '</li>';
  }

  function fmtTime(s) { if (!s) return 'Open ended'; var d = new Date(s); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

  function render() {
    derive();
    var d = new Date(state.date + 'T12:00:00');
    ui.title.textContent = (isToday() ? 'Coverage today' : 'Coverage on ' + d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }));
    var nowShifts = isToday() ? M.shiftsNow(state.data.shifts, new Date()).map(function (s) { return s.Name; }) : [];
    ui.facts.innerHTML = [
      ['Cities', state.data.cities.filter(function (c) { return c.Active !== false; }).length],
      ['Coverage rows', state.cov.length],
      ['On shift now', nowShifts.length ? nowShifts.join(', ') : (isToday() ? 'No shift running' : '-')],
      ['Loaded', state.loadedAt ? state.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '']
    ].map(function (f) { return '<div class="fact"><small>' + esc(f[0]) + '</small><span>' + esc(f[1]) + '</span></div>'; }).join('');
    renderTiles(); renderShiftSeg();
    ui.today.setRows(state.cells);
    ui.gapsT.setRows(state.help.map(function (h) { var c = h.cell; c.nearby = h.nearby; return c; }));
    renderPeople(); renderChecks();
    ui.foot.textContent = 'Read-only view of Dispatch Cities, Shifts, Coverage and Installer Presence. Edit the data in those modules.';
  }

  /* ---------- boot ---------- */
  function fail(e) {
    var m = (e && e.message) || 'Unknown error';
    ui.today.setRows([]);
    document.getElementById('d-today-t').insertAdjacentHTML('afterbegin', '<p class="err" role="alert">Could not read dispatch data: ' + esc(m) + ' <button type="button" class="lnk" id="d-retry">Try again</button></p>');
    var b = document.getElementById('d-retry'); if (b) b.addEventListener('click', refresh);
  }
  function refresh() {
    var old = document.querySelector('#d-today-t .err'); if (old) old.remove();
    return load().then(function (data) { state.data = data; state.loadedAt = new Date(); render(); }, fail);
  }

  function build() {
    ui.title = document.getElementById('title'); ui.facts = document.getElementById('facts'); ui.tiles = document.getElementById('d-tiles');
    ui.foot = document.getElementById('d-foot'); ui.checks = document.getElementById('d-checks'); ui.seg = document.getElementById('d-shifts');
    ui.presNote = document.getElementById('d-pres-note');
    ui.next = JPK.next({ mount: '#d-next', title: 'Loading coverage...', progress: 0 });
    ui.tabs = JPK.tabs({ mount: '#d-tabs', label: 'Dispatch views', tabs: [{ id: 'today', label: 'Coverage' }, { id: 'gaps', label: 'Gaps' }, { id: 'people', label: 'Installers' }, { id: 'checks', label: 'Data checks' }] });
    var f = [
      { key: 'gaps', label: 'Gaps', test: function (r) { return r.status !== 'covered'; } },
      { key: 'backup_only', label: 'Backup only', test: function (r) { return r.status === 'backup_only'; } },
      { key: 'covered', label: 'Covered', test: function (r) { return r.status === 'covered'; } },
      { key: 'thin', label: 'Single cover', test: function (r) { return r.status === 'covered' && !r.backup.length; } }
    ];
    ui.today = JPK.table({ mount: '#d-today-t', caption: 'Coverage by city and shift', columns: cellColumns(), rows: [], filters: f, filterLabel: 'Show', onRowClick: openCell,
      empty: { title: 'Nothing to show', hint: 'No active city has a shift on this day, or the filter hides everything.' } });
    var gapCols = cellColumns(); gapCols.push({ key: 'nearby', label: 'Present nearby', render: function (r) { return names(r.nearby || []); } });
    ui.gapsT = JPK.table({ mount: '#d-gaps-t', caption: 'Coverage gaps', columns: gapCols, rows: [], onRowClick: openCell,
      empty: { title: 'No gaps', hint: 'Every city shift on this day has a primary installer.' } });
    ui.pres = JPK.table({ mount: '#d-pres-t', caption: 'Installers present now', rows: [],
      columns: [
        { key: 'installer', label: 'Installer', sortable: true, render: function (r) { return '<b>' + esc(r.installer) + '</b>'; } },
        { key: 'county', label: 'County', sortable: true, render: function (r) { return esc(r.county); } },
        { key: 'until', label: 'Until', render: function (r) { return esc(fmtTime(r.until)); } },
        { key: 'notRostered', label: 'Roster', render: function (r) { return r.notRostered ? JPK.chip('Not on roster', 'info') : JPK.chip('On roster', 'good'); } }
      ], empty: { title: 'No one is marked present', hint: 'Add an Installer Presence note to show someone here.' } });
    ui.load = JPK.table({ mount: '#d-load-t', caption: 'Installer load', rows: [],
      columns: [
        { key: 'installer', label: 'Installer', sortable: true, render: function (r) { return esc(r.installer); } },
        { key: 'primary', label: 'Primary', sortable: true, align: 'right', num: true, render: function (r) { return r.primary; } },
        { key: 'backup', label: 'Backup', sortable: true, align: 'right', num: true, render: function (r) { return r.backup; } }
      ], empty: { title: 'No coverage rows', hint: 'Nothing is rostered for this day.' } });

    ui.seg.addEventListener('click', function (e) { var b = e.target.closest('button[data-s]'); if (b) { state.shiftId = b.getAttribute('data-s'); render(); } });
    var dt = document.getElementById('d-date'); dt.value = state.date;
    dt.addEventListener('change', function () { if (dt.value) { state.date = dt.value; render(); } });
    document.getElementById('d-today').addEventListener('click', function () { state.date = M.isoDate(new Date()); dt.value = state.date; render(); });
    document.getElementById('d-refresh').addEventListener('click', function () { refresh().then(function () { JPK.toast('Refreshed'); }); });
    JPK.aboutButton({ button: '#d-help', title: 'About DOC Dispatch', html:
      '<p>Shows who covers which city and shift for a day, where there is a gap, and which installers are present.</p>' +
      '<ul><li><b>Covered</b>: at least one Primary installer.</li><li><b>Backup only</b>: a Backup but no Primary.</li><li><b>No one</b>: no rows at all.</li><li><b>Single cover</b>: a Primary with no Backup.</li></ul>' +
      '<p>Rows with an Effective To in the past, or an Effective From in the future, are ignored. Weekend shifts only count on Saturday and Sunday.</p>' +
      '<p>This page only reads. Change coverage in the Dispatch Coverage module.</p>' });
  }

  build();
  var forceDemo = /[?&]demo=1\b/.test(location.search);
  JPK.crm.init().then(function (d) {
    state.demo = forceDemo || !!(d && d.demo);
    document.getElementById('demo-tag').hidden = !state.demo;
    return refresh();
  });
})();
