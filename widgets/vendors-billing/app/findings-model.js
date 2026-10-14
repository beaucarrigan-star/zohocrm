/* Billing Findings: pure logic (no DOM, no Zoho). Works in the browser (window.FindingsModel) and in node (require).
   Field names are the live API names read from Billing_Findings / Billing_Periods on 11 Oct 2026.
   Finding "type" is NOT a picklist: Billing_Findings.Category and Check_ID are text. Types are therefore
   taken from the data, never hard-coded. Only Severity, Money_Type and Status are real picklists. */
(function (root) {
  'use strict';

  /* Picklist order as read from the live field metadata (Severity, Status). */
  var SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  var OPEN_STATUSES = { 'Open': 1, 'Disputed with vendor': 1 };
  var NO_VENDOR = '(no vendor)';

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function text(v, d) { return v == null || v === '' || v === '-None-' ? (d == null ? '' : d) : String(v); }

  /* Turn a COQL row into the shape the widget uses. Participant = Subject (initials + device id), no new field. */
  function normalize(r) {
    var open;
    if (typeof r.Is_Open === 'boolean') open = r.Is_Open;
    else open = !!OPEN_STATUSES[r.Status];
    return {
      id: r.id,
      period: text(r.Period),
      vendor: text(r.Vendor, NO_VENDOR),
      checkId: text(r.Check_ID, '?'),
      category: text(r.Category, 'Uncategorised'),
      severity: text(r.Severity, 'INFO').toUpperCase(),
      moneyType: text(r.Money_Type, 'None'),
      status: text(r.Status, 'Open'),
      open: open,
      dollars: num(r.Dollars),
      participant: text(r.Subject)
    };
  }

  function normalizeAll(rows) { return (rows || []).map(normalize); }

  function normalizePeriod(p) {
    return {
      id: p.id, name: text(p.Name), period: text(p.Period), status: text(p.Period_Status),
      uploadVendor: text(p.Upload_Vendor), total: p.Findings_Total == null ? null : num(p.Findings_Total),
      open: p.Findings_Open == null ? null : num(p.Findings_Open)
    };
  }

  /* Newest period first (Period is 'YYYY-MM', so string order is date order). */
  function sortPeriods(periods) {
    return periods.slice().sort(function (a, b) { return a.period < b.period ? 1 : a.period > b.period ? -1 : 0; });
  }

  function forPeriod(rows, period) {
    return rows.filter(function (r) { return r.period === period; });
  }

  function sevRank(s) { var i = SEVERITY_ORDER.indexOf(s); return i < 0 ? SEVERITY_ORDER.length : i; }

  function totals(rows) {
    var t = { total: 0, open: 0, closed: 0, dollars: 0, overbilledDollars: 0, bySeverity: {}, byMoney: {}, byStatus: {} };
    rows.forEach(function (r) {
      t.total += 1;
      if (r.open) t.open += 1; else t.closed += 1;
      t.dollars += r.dollars;
      if (r.moneyType === 'Overbilled') t.overbilledDollars += r.dollars;
      t.bySeverity[r.severity] = (t.bySeverity[r.severity] || 0) + 1;
      t.byMoney[r.moneyType] = (t.byMoney[r.moneyType] || 0) + 1;
      t.byStatus[r.status] = (t.byStatus[r.status] || 0) + 1;
    });
    t.dollars = Math.round(t.dollars * 100) / 100;
    t.overbilledDollars = Math.round(t.overbilledDollars * 100) / 100;
    return t;
  }

  /* Vendor x Category matrix. Categories are discovered from the rows; ordered by total count desc then name. */
  function matrix(rows) {
    var cats = {}, vendors = {};
    rows.forEach(function (r) {
      cats[r.category] = (cats[r.category] || 0) + 1;
      var v = vendors[r.vendor] || (vendors[r.vendor] = { vendor: r.vendor, total: 0, open: 0, dollars: 0, cells: {} });
      v.total += 1; if (r.open) v.open += 1; v.dollars += r.dollars;
      var c = v.cells[r.category] || (v.cells[r.category] = { total: 0, open: 0 });
      c.total += 1; if (r.open) c.open += 1;
    });
    var categories = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || a.localeCompare(b); });
    var list = Object.keys(vendors).map(function (k) { vendors[k].dollars = Math.round(vendors[k].dollars * 100) / 100; return vendors[k]; })
      .sort(function (a, b) { return b.total - a.total || a.vendor.localeCompare(b.vendor); });
    return { categories: categories, vendors: list, categoryTotals: cats };
  }

  /* Check_ID breakdown inside a category (the drill-down under a type). */
  function checks(rows, category) {
    var m = {};
    rows.forEach(function (r) {
      if (category && r.category !== category) return;
      var c = m[r.checkId] || (m[r.checkId] = { checkId: r.checkId, category: r.category, total: 0, open: 0, severity: r.severity });
      c.total += 1; if (r.open) c.open += 1;
      if (sevRank(r.severity) < sevRank(c.severity)) c.severity = r.severity;
    });
    return Object.keys(m).map(function (k) { return m[k]; })
      .sort(function (a, b) { return sevRank(a.severity) - sevRank(b.severity) || b.total - a.total || a.checkId.localeCompare(b.checkId); });
  }

  /* Detail rows: filter by {vendor, category, checkId, openOnly}; severity first, then dollars desc, then participant. */
  function detail(rows, f) {
    f = f || {};
    return rows.filter(function (r) {
      return (!f.vendor || r.vendor === f.vendor) && (!f.category || r.category === f.category) &&
        (!f.checkId || r.checkId === f.checkId) && (!f.openOnly || r.open);
    }).sort(function (a, b) {
      return sevRank(a.severity) - sevRank(b.severity) || b.dollars - a.dollars || a.participant.localeCompare(b.participant);
    });
  }

  /* Compare the rows we loaded with the counts the pipeline wrote on Billing_Periods. */
  function reconcile(period, rows) {
    var t = totals(rows);
    var out = { ok: true, notes: [], loaded: t.total, loadedOpen: t.open };
    if (period.total != null && period.total !== t.total) { out.ok = false; out.notes.push('Period says ' + period.total + ' findings, loaded ' + t.total + '.'); }
    if (period.open != null && period.open !== t.open) { out.ok = false; out.notes.push('Period says ' + period.open + ' open, loaded ' + t.open + '.'); }
    return out;
  }

  var api = {
    SEVERITY_ORDER: SEVERITY_ORDER, NO_VENDOR: NO_VENDOR,
    normalize: normalize, normalizeAll: normalizeAll, normalizePeriod: normalizePeriod,
    sortPeriods: sortPeriods, forPeriod: forPeriod, totals: totals, matrix: matrix, checks: checks,
    detail: detail, reconcile: reconcile, sevRank: sevRank
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FindingsModel = api;
})(typeof window !== 'undefined' ? window : this);
