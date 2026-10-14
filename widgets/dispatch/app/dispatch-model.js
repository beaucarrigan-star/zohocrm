/* DOC Dispatch: pure logic. No DOM, no Zoho calls. UMD: browser global DispatchModel, or require() in node.
   Row shapes are the COQL shapes of the live modules (read 11 Oct 2026):
   city     {id, Name, County, DOC_Region, JP_Region, Active, City_Notes}
   shift    {id, Name, Start 'HH:MM', End 'HH:MM', Days 'Mon-Fri' | 'Sat, Sun' | 'Sat', Active, Shift_Comments}
   coverage {id, City:{id,name}, Shift:{id,name}, Installer:{id,name}, Role 'Primary'|'Backup', Effective_From, Effective_To, Coverage_Key}
   presence {id, Installer:{id,name}, County, Present_From, Present_To (datetimes), Source, Details}
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DispatchModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var STATUS = { COVERED: 'covered', BACKUP_ONLY: 'backup_only', UNCOVERED: 'uncovered', OFF: 'off' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* local calendar date as YYYY-MM-DD (not UTC) */
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISODate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function refId(x) { return x && typeof x === 'object' ? x.id : (x || null); }
  function refName(x) { return x && typeof x === 'object' ? x.name : ''; }

  /* "Mon-Fri", "Sat, Sun", "Sat", "Mon, Wed-Fri", "Daily" -> array of weekday indexes (0 = Sun). Unknown text -> null. */
  function parseDays(text) {
    var t = norm(text);
    if (!t) return null;
    if (t === 'daily' || t === 'every day' || t === '7 days') return [0, 1, 2, 3, 4, 5, 6];
    var out = [];
    var parts = t.split(/[,;&\/]+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = p.match(/^([a-z]{3})[a-z]*\s*(?:-|to)\s*([a-z]{3})[a-z]*$/);
      if (m) {
        var a = DAY.map(norm).indexOf(m[1]), b = DAY.map(norm).indexOf(m[2]);
        if (a < 0 || b < 0) return null;
        for (var k = a; ; k = (k + 1) % 7) { if (out.indexOf(k) < 0) out.push(k); if (k === b) break; }
      } else {
        var s = DAY.map(norm).indexOf(p.slice(0, 3));
        if (s < 0) return null;
        if (out.indexOf(s) < 0) out.push(s);
      }
    }
    return out.length ? out.sort(function (x, y) { return x - y; }) : null;
  }

  function parseClock(t) {
    var m = String(t == null ? '' : t).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    return h > 24 || mi > 59 ? null : h * 60 + mi;
  }

  /* Does the shift run on this date? Unparseable Days counts as running (so a typo never hides a gap) and is reported by dataChecks. */
  function shiftRunsOn(shift, dateStr) {
    var days = parseDays(shift.Days);
    if (!days) return true;
    return days.indexOf(parseISODate(dateStr).getDay()) >= 0;
  }

  /* Shifts whose clock window contains `now` on a day they run. Window end is exclusive. Overnight windows (End < Start) wrap. */
  function shiftsNow(shifts, now) {
    var date = isoDate(now), mins = now.getHours() * 60 + now.getMinutes();
    return shifts.filter(function (s) {
      if (s.Active === false || !shiftRunsOn(s, date)) return false;
      var a = parseClock(s.Start), b = parseClock(s.End);
      if (a == null || b == null) return false;
      return a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
    });
  }

  /* Blank Effective_From / Effective_To = open ended. Dates are inclusive. */
  function rowEffective(row, dateStr) {
    var f = row.Effective_From ? String(row.Effective_From).slice(0, 10) : null;
    var t = row.Effective_To ? String(row.Effective_To).slice(0, 10) : null;
    if (f && dateStr < f) return false;
    if (t && dateStr > t) return false;
    return true;
  }

  function sortNames(a, b) { return a.localeCompare(b, undefined, { numeric: true }); }

  /* The coverage matrix for one date: one cell per active city x active shift that runs that day.
     Cell: {cityId, city, county, region, shiftId, shift, status, primary:[names], backup:[names], rowIds:[]}.
     Status: covered = at least one primary; backup_only = backups but no primary; uncovered = neither. */
  function buildMatrix(cities, shifts, coverage, dateStr) {
    var activeCities = cities.filter(function (c) { return c.Active !== false; });
    var activeShifts = shifts.filter(function (s) { return s.Active !== false && shiftRunsOn(s, dateStr); });
    var by = {};
    coverage.forEach(function (r) {
      if (!rowEffective(r, dateStr)) return;
      var k = refId(r.City) + '|' + refId(r.Shift);
      (by[k] = by[k] || []).push(r);
    });
    var cells = [];
    activeCities.forEach(function (c) {
      activeShifts.forEach(function (s) {
        var rows = by[c.id + '|' + s.id] || [];
        var seenP = {}, seenB = {}, primary = [], backup = [], ids = [];
        rows.forEach(function (r) {
          var n = refName(r.Installer) || 'Unknown installer', role = norm(r.Role);
          ids.push(r.id);
          if (role === 'primary') { if (!seenP[n]) { seenP[n] = 1; primary.push(n); } }
          else if (role === 'backup') { if (!seenB[n]) { seenB[n] = 1; backup.push(n); } }
        });
        primary.sort(sortNames); backup.sort(sortNames);
        cells.push({
          cityId: c.id, city: c.Name, county: c.County || '', region: c.DOC_Region || '',
          shiftId: s.id, shift: s.Name, shiftStart: s.Start, shiftEnd: s.End,
          status: primary.length ? STATUS.COVERED : backup.length ? STATUS.BACKUP_ONLY : STATUS.UNCOVERED,
          primary: primary, backup: backup, rowIds: ids
        });
      });
    });
    cells.sort(function (a, b) { return sortNames(a.city, b.city) || sortNames(a.shift, b.shift); });
    return cells;
  }

  /* Gaps = cells with no primary. Sorted worst first (uncovered before backup_only), then by city. */
  function findGaps(cells) {
    return cells.filter(function (c) { return c.status !== STATUS.COVERED; }).sort(function (a, b) {
      var w = function (x) { return x.status === STATUS.UNCOVERED ? 0 : 1; };
      return w(a) - w(b) || sortNames(a.city, b.city) || sortNames(a.shift, b.shift);
    });
  }

  /* Covered, but only one deep: a primary and no backup. Informational, not a gap. */
  function findThin(cells) {
    return cells.filter(function (c) { return c.status === STATUS.COVERED && c.backup.length === 0; });
  }

  function summarize(cells) {
    var s = { cells: cells.length, covered: 0, backupOnly: 0, uncovered: 0, thin: 0, citiesWithGap: 0, pctCovered: 0 };
    var gapCities = {};
    cells.forEach(function (c) {
      if (c.status === STATUS.COVERED) { s.covered++; if (!c.backup.length) s.thin++; }
      else { if (c.status === STATUS.BACKUP_ONLY) s.backupOnly++; else s.uncovered++; gapCities[c.cityId] = 1; }
    });
    s.citiesWithGap = Object.keys(gapCities).length;
    s.pctCovered = cells.length ? Math.round(1000 * s.covered / cells.length) / 10 : 0;
    return s;
  }

  /* Who is present at `now`. A note with no Present_To is open ended (still there). Returns one entry per installer (latest note wins). */
  function presentNow(presence, now) {
    var t = now.getTime(), latest = {};
    presence.forEach(function (p) {
      var f = Date.parse(p.Present_From), e = p.Present_To ? Date.parse(p.Present_To) : Infinity;
      if (isNaN(f) || isNaN(e) || t < f || t > e) return;
      var id = refId(p.Installer) || refName(p.Installer);
      if (!latest[id] || Date.parse(latest[id].Present_From) < f) latest[id] = p;
    });
    return Object.keys(latest).map(function (id) {
      var p = latest[id];
      return { installerId: refId(p.Installer), installer: refName(p.Installer) || 'Unknown installer', county: p.County || '', from: p.Present_From, to: p.Present_To || null, source: p.Source || '', details: p.Details || '', noteId: p.id };
    }).sort(function (a, b) { return sortNames(a.installer, b.installer); });
  }

  /* For each gap, installers who are present in that city's county right now (a phone call away). Matching is by county name, case-insensitive. */
  function helpForGaps(gaps, present) {
    var byCounty = {};
    present.forEach(function (p) { (byCounty[norm(p.county)] = byCounty[norm(p.county)] || []).push(p); });
    return gaps.map(function (g) {
      var near = byCounty[norm(g.county)] || [];
      return { cell: g, nearby: near.map(function (p) { return p.installer; }) };
    });
  }

  /* Present installers split into: covering something today vs present but not on any coverage row. */
  function presenceVsCoverage(present, coverage, dateStr) {
    var covering = {};
    coverage.forEach(function (r) { if (rowEffective(r, dateStr)) covering[refId(r.Installer)] = (covering[refId(r.Installer)] || 0) + 1; });
    return present.map(function (p) {
      return { installer: p.installer, county: p.county, rows: covering[p.installerId] || 0, notRostered: !covering[p.installerId] };
    });
  }

  /* Installer load: how many city x shift slots each installer is primary / backup on for the date. */
  function installerLoad(cells) {
    var m = {};
    cells.forEach(function (c) {
      c.primary.forEach(function (n) { (m[n] = m[n] || { installer: n, primary: 0, backup: 0 }).primary++; });
      c.backup.forEach(function (n) { (m[n] = m[n] || { installer: n, primary: 0, backup: 0 }).backup++; });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.primary - a.primary || sortNames(a.installer, b.installer); });
  }

  /* Problems in the data itself. Each: {kind, severity 'warn'|'bad', text, ids}. */
  function dataChecks(cities, shifts, coverage) {
    var out = [];
    var cityIds = {}, shiftIds = {}, i;
    cities.forEach(function (c) { cityIds[c.id] = c; });
    shifts.forEach(function (s) { shiftIds[s.id] = s; });

    var orphan = [], inactive = [], noRole = [], noInst = [], dupIds = [], seen = {}, keys = {}, dupKeys = [];
    coverage.forEach(function (r) {
      if (seen[r.id]) dupIds.push(r.id); seen[r.id] = 1;
      var c = cityIds[refId(r.City)], s = shiftIds[refId(r.Shift)];
      if (!c || !s) orphan.push(r.id);
      else if (c.Active === false || s.Active === false) inactive.push(r.id);
      var role = norm(r.Role);
      if (role !== 'primary' && role !== 'backup') noRole.push(r.id);
      if (!refId(r.Installer)) noInst.push(r.id);
      var k = norm(r.Coverage_Key) || [refId(r.City), refId(r.Shift), role, refId(r.Installer)].join('|');
      if (keys[k]) dupKeys.push(r.id); else keys[k] = 1;
    });
    if (dupIds.length) out.push({ kind: 'dup_ids', severity: 'bad', text: dupIds.length + ' coverage rows were read twice (paging overlap). Counts above ignore the repeats.', ids: dupIds });
    if (orphan.length) out.push({ kind: 'orphan', severity: 'bad', text: orphan.length + ' coverage rows point at a city or shift that is missing.', ids: orphan });
    if (inactive.length) out.push({ kind: 'inactive', severity: 'warn', text: inactive.length + ' coverage rows point at an inactive city or shift. They are ignored on the canvas.', ids: inactive });
    if (noRole.length) out.push({ kind: 'role', severity: 'bad', text: noRole.length + ' coverage rows have a Role other than Primary or Backup, so they count for nothing.', ids: noRole });
    if (noInst.length) out.push({ kind: 'installer', severity: 'bad', text: noInst.length + ' coverage rows have no installer.', ids: noInst });
    if (dupKeys.length) out.push({ kind: 'dup_key', severity: 'warn', text: dupKeys.length + ' coverage rows repeat an existing Coverage Key (same city, shift, role and installer).', ids: dupKeys });
    var badDays = shifts.filter(function (s) { return !parseDays(s.Days); }).map(function (s) { return s.id; });
    if (badDays.length) out.push({ kind: 'days', severity: 'warn', text: badDays.length + ' shifts have Days the widget cannot read (use Mon-Fri, Sat, Sun). They are treated as running every day.', ids: badDays });
    var badTimes = shifts.filter(function (s) { return parseClock(s.Start) == null || parseClock(s.End) == null; }).map(function (s) { return s.id; });
    if (badTimes.length) out.push({ kind: 'times', severity: 'warn', text: badTimes.length + ' shifts have a Start or End that is not HH:MM.', ids: badTimes });
    var noCounty = cities.filter(function (c) { return c.Active !== false && !c.County; }).map(function (c) { return c.id; });
    if (noCounty.length) out.push({ kind: 'county', severity: 'warn', text: noCounty.length + ' active cities have no County, so presence notes cannot match them.', ids: noCounty });
    return out;
  }

  /* Drop repeated ids (COQL paging without an order can repeat rows). */
  function uniqueById(rows) {
    var s = {}, o = [];
    rows.forEach(function (r) { if (r && r.id && !s[r.id]) { s[r.id] = 1; o.push(r); } });
    return o;
  }

  return {
    STATUS: STATUS, parseDays: parseDays, parseClock: parseClock, shiftRunsOn: shiftRunsOn, shiftsNow: shiftsNow,
    rowEffective: rowEffective, buildMatrix: buildMatrix, findGaps: findGaps, findThin: findThin, summarize: summarize,
    presentNow: presentNow, helpForGaps: helpForGaps, presenceVsCoverage: presenceVsCoverage, installerLoad: installerLoad,
    dataChecks: dataChecks, uniqueById: uniqueById, isoDate: isoDate
  };
});
