/* records-model.js: pure helpers (no DOM). UMD so node tests can require it. */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.RecModel = f(); })(this, function () {
  'use strict';
  function plain(v) {            /* lookups come back as {name,id}; Owner alias comes back as a string */
    if (v == null) return null;
    if (Array.isArray(v)) return v.map(plain).filter(function (x) { return x != null && x !== ''; }).join(', ');
    if (typeof v === 'object') return v.name != null ? v.name : (v.full_name || null);
    return v;
  }
  function lookupId(v) { return v && typeof v === 'object' ? (v.id || null) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parseDate(s) { if (!s) return null; var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(s) { var d = parseDate(s); return d ? MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() : ''; }
  function fmtMoney(n) { if (n == null || n === '' || isNaN(+n)) return ''; var v = Math.round(+n); return (v < 0 ? '-$' : '$') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtNum(n) { if (n == null || n === '' || isNaN(+n)) return ''; return String(+n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtPct(n) { if (n == null || n === '' || isNaN(+n)) return ''; return (Math.round(+n * 10) / 10) + '%'; }
  function fmt(v, t) {
    v = plain(v);
    if (v == null || v === '') return '';
    if (t === 'date') return fmtDate(v);
    if (t === 'money') return fmtMoney(v);
    if (t === 'num') return fmtNum(v);
    if (t === 'pct') return fmtPct(v);
    if (t === 'bool') return v === true || v === 'true' ? 'Yes' : 'No';
    if (t === 'datetime') return fmtDate(v);
    if (t === 'bytes') { var n = +v; return isNaN(n) ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    return String(v);
  }
  function trunc(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function label(f) { return String(f).replace(/_/g, ' ').replace(/\bs\b/g, "'s").trim(); }
  function qstr(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/%/g, ''); }
  function cleanId(id) { return String(id || '').replace(/[^0-9]/g, ''); }
  function fieldName(f) { return typeof f === 'string' ? f : f.f; }
  /* Build the list query. cfg = module list config; opts = {search, filter(where string), offset}. */
  function listQuery(entity, cfg, opts) {
    opts = opts || {};
    var where = [];  /* this org's COQL rejects more than two ANDed conditions */
    if (opts.where) where.push(opts.where);
    if (opts.search && cfg.searchField) where.push(cfg.searchField + " like '%" + qstr(opts.search) + "%'");
    if (!where.length) where.push('id is not null');
    var q = 'select ' + cfg.select.join(', ') + ' from ' + entity + ' where ' + where.join(' and ');
    if (cfg.order) q += ' order by ' + cfg.order;
    return q + ' limit ' + (cfg.page || 100) + ' offset ' + (opts.offset || 0);
  }
  function recordQuery(entity, fields, id) {
    return 'select ' + fields.join(', ') + ' from ' + entity + " where id = '" + cleanId(id) + "'";
  }
  function relatedQuery(tab, id) {
    return 'select ' + tab.select.join(', ') + ' from ' + tab.entity + ' where ' + tab.lookup + " = '" + cleanId(id) + "'" +
      (tab.where ? ' and ' + tab.where : '') + (tab.order ? ' order by ' + tab.order : '') + ' limit 200';
  }
  /* tone rules */
  function dayTone(n, warnAt, badAt) { if (n == null || n === '') return 'grey'; n = +n; return n <= badAt ? 'bad' : n <= warnAt ? 'warn' : 'good'; }
  var WORDS = {
    good: /^(active|won|closed won|complete|completed|live|good|resolved|closed|reconciled|ok|healthy|verified|go-live|active partner|awarded|approved|done|yes)/i,
    bad: /(overdue|lost|blocked|expired|critical|high|red|at risk|terminated|urgent|failed|declined|no bid|cancel)/i,
    warn: /(pending|review|open|waiting|renew|amber|watch|medium|new|in progress|draft|identified|due|escalat|hold|expiring|needs)/i,
    info: /(discovery|qualif|proposal|negotiat|scheduled|kickoff|submitted|low|prospect|bidding)/i
  };
  function tone(s) {
    s = plain(s); if (s == null || s === '') return 'grey';
    s = String(s);
    if (WORDS.bad.test(s)) return 'bad';
    if (WORDS.good.test(s)) return 'good';
    if (WORDS.warn.test(s)) return 'warn';
    if (WORDS.info.test(s)) return 'info';
    return 'grey';
  }
  return { plain: plain, lookupId: lookupId, esc: esc, parseDate: parseDate, fmtDate: fmtDate, fmtMoney: fmtMoney, fmtNum: fmtNum, fmtPct: fmtPct, fmt: fmt, label: label, trunc: trunc, qstr: qstr, cleanId: cleanId, fieldName: fieldName, listQuery: listQuery, recordQuery: recordQuery, relatedQuery: relatedQuery, dayTone: dayTone, tone: tone };
});
