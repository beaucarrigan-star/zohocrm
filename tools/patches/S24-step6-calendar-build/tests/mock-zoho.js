/* mock-zoho.js: a stand-in for the Zoho widget SDK used by the S24 step 6 tests. No network. Loaded as a Playwright init script
   AFTER window.__MOCK is set. It answers ZOHO.CRM.API.coql / getRecord / updateRecord and ZOHO.CRM.CONFIG.getCurrentUser, logs every
   call in window.__calls, and applies the Events where clause it is given (Owner.id, Start_DateTime >= / <= literals, limit/offset)
   so the calendar's own query is what decides the rows.
   window.__MOCK = { me, events:[row], masters:[row], accounts:[{id,Account_Name}], contacts:[{id,Full_Name,Email,Account_Name}],
     participants:{eventId:[...]}, eventsFail:false, hang:false, refuse:['Owner.id'|'Recurring_Activity'|...], empty:'resolve'|'reject204',
     write:'ok'|'error'|'reject', delay:ms } */
(function () {
  var M = window.__MOCK || {};
  var calls = window.__calls = [];
  var me = M.me || '6715134000000503001';
  var dly = M.delay == null ? 15 : M.delay;
  var later = function (fn) { return new Promise(function (res, rej) { setTimeout(function () { try { fn(res, rej); } catch (e) { rej(e); } }, dly); }); };
  var ok = function (v) { return later(function (res) { res(v); }); };
  var no = function (v) { return later(function (res, rej) { rej(v); }); };
  var empty = function () { return M.empty === 'reject204' ? no({ status: 204, code: 'NO_CONTENT' }) : ok(undefined); };
  var page = function (rows, q) {
    var lim = +((/limit (\d+)/.exec(q) || [])[1] || 200), off = +((/offset (\d+)/.exec(q) || [])[1] || 0);
    var out = rows.slice(off, off + lim);
    if (!out.length) return empty();
    return ok({ data: JSON.parse(JSON.stringify(out)), info: { count: out.length, more_records: off + lim < rows.length } });
  };
  var lk = function (v) { return v && typeof v === 'object' ? String(v.id) : String(v || ''); };
  function coql(arg) {
    var q = arg && arg.select_query || '';
    calls.push({ fn: 'coql', q: q });
    var mod = (/ from (\w+)/.exec(q) || [])[1];
    if (mod === 'Events') {
      if (M.hang) return new Promise(function () {});
      if (M.eventsFail) return no({ code: 'INTERNAL_ERROR', message: 'mock Events failure', status: 'error' });
      var refused = (M.refuse || []).filter(function (r) { return q.indexOf(r) >= 0; });
      if (refused.length) return no({ code: 'INVALID_QUERY', message: 'invalid column ' + refused[0], status: 'error' });
      var rows;
      if (/Recurring_Activity is not null/.test(q)) {
        var lt = (/Start_DateTime < '([^']+)'/.exec(q) || [])[1];
        rows = (M.masters || []).filter(function (r) { return !lt || Date.parse(r.Start_DateTime) < Date.parse(lt); });
      } else {
        var ge = (/Start_DateTime >= '([^']+)'/.exec(q) || [])[1], le = (/Start_DateTime <= '([^']+)'/.exec(q) || [])[1];
        rows = (M.events || []).filter(function (r) { var s = Date.parse(r.Start_DateTime); return (!ge || s >= Date.parse(ge)) && (!le || s <= Date.parse(le)); });
      }
      var own = (/Owner\.id = (\d+)/.exec(q) || [])[1];
      if (own) rows = rows.filter(function (r) { return lk(r.Owner) === own; });
      rows.sort(function (a, b) { return Date.parse(a.Start_DateTime) - Date.parse(b.Start_DateTime); });
      return page(rows, q);
    }
    var src = mod === 'Accounts' ? (M.accounts || []) : mod === 'Contacts' ? (M.contacts || []) : [];
    var ids = /id in \(([^)]*)\)/.exec(q), lks = [], re = /(\w+) like '%((?:[^']|'')*)%'/g, m;
    while ((m = re.exec(q))) lks.push([m[1], m[2].replace(/''/g, "'").toLowerCase()]);
    var out = src.filter(function (r) {
      if (ids) return ids[1].split(',').map(function (x) { return x.trim(); }).indexOf(String(r.id)) >= 0;
      if (lks.length) return lks.some(function (l) { var f = l[0] === 'Last_Name' || l[0] === 'First_Name' ? r.Full_Name : r[l[0]]; return String(f || '').toLowerCase().indexOf(l[1]) >= 0; });
      return true;
    });
    return page(out, q);
  }
  function getRecord(arg) {
    calls.push({ fn: 'getRecord', arg: arg });
    var ev = (M.events || []).concat(M.masters || []).filter(function (r) { return String(r.id) === String(arg.RecordID); })[0];
    if (!ev) return no({ code: 'INVALID_DATA', message: 'the id given seems to be invalid' });
    var rec = JSON.parse(JSON.stringify(ev)); rec.Participants = (M.participants || {})[ev.id] || [];
    return ok({ data: [rec] });
  }
  function updateRecord(arg) {
    calls.push({ fn: 'updateRecord', arg: JSON.parse(JSON.stringify(arg)) });
    if (M.write === 'error') return ok({ data: [{ code: 'INVALID_DATA', details: { api_name: 'What_Id' }, message: 'the related id given seems to be invalid', status: 'error' }] });
    if (M.write === 'reject') return no({ code: 'NO_PERMISSION', message: 'permission denied', status: 'error' });
    return ok({ data: [{ code: 'SUCCESS', details: { id: arg.APIData.id, Modified_Time: '2026-10-22T10:01:00-05:00' }, message: 'record updated', status: 'success' }] });
  }
  window.ZOHO = {
    embeddedApp: { on: function () {}, init: function () { return Promise.resolve(); } },
    CRM: {
      API: { coql: coql, getRecord: getRecord, updateRecord: updateRecord },
      CONFIG: { getCurrentUser: function () { calls.push({ fn: 'getCurrentUser' }); return ok({ users: [{ id: me, full_name: 'Beau Carrigan', profile: { name: 'Administrator' } }] }); } }
    }
  };
})();
