/* jpk-calendar.js v0.1.0 (S24 step 6, 22 Oct 2026): the calendar data layer and link picker behind the jpk-shell calendar zone.
   Spec: S24-LAYOUT-SPEC-APPROVED.md sections 2, 5, 6, 11 (section 11 wins). Interface: the jpkCalendar.load(range) comment at the top of jpk-shell.js.

   LOAD ORDER: this file must run BEFORE jpk-shell.js (the shell installs its demo stub only when window.jpkCalendar is not defined yet).

   Public API: window.jpkCalendar = {
     load(range)            -> Promise<Event[]>   COQL on Events, Owner = current user, range.start .. range.end (viewer's local days)
     link(event, opener)    -> Promise<{linked}>  opens the link picker (account What_Id and/or contact Who_Id); resolves when it closes
     open(event, opener)    -> Promise            opens the meeting details panel (attendees load lazily, for that meeting only)
     participants(event)    -> Promise<Attendee[]> record API read (getRecord), only for the day on screen, cached, capped per day
     version, state, _model (pure functions, for tests)
   }
   Config: window.jpkCalendarConfig = { writeAllowedIds: ['6715134000009801001'] | '*', timeoutMs, pageSize, maxPages, userWaitMs, detailCap, trigger }
     writeAllowedIds limits which Events records the link picker may write ('*' = all). A blocked write makes no call and says so.

   Network: only through the Zoho widget SDK (ZOHO.CRM.API.coql / getRecord / updateRecord, ZOHO.CRM.CONFIG.getCurrentUser), with the
   page's conventions: a timeout on every call, a small in-flight limit, COQL pages of 200 by limit/offset, 204 = no rows, lookups read
   as ids. No other network path. In preview (no SDK, ?preview=1) or with ?caldemo=1|empty|err|later|done|slow it reads built-in
   demo records through the same parsing code and never writes.
   Privacy: Description is read only to find the join link and is then dropped. The passcode and meeting ID are never kept or shown. */
(function (root) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = root.document;
  if (!doc) return;
  var TEST_EVENT = '6715134000009801001';
  var DEF = {
    writeAllowedIds: [TEST_EVENT], timeoutMs: 15000, pageSize: 200, maxPages: 10, userWaitMs: 20000, detailCap: 10, trigger: ['workflow'],
    crmBase: 'https://crm.zoho.com/crm/org882980956/tab/', outlookUrl: 'https://outlook.office.com/calendar/view/day'
  };
  if (!root.jpkCalendarConfig || typeof root.jpkCalendarConfig !== 'object') root.jpkCalendarConfig = { writeAllowedIds: DEF.writeAllowedIds.slice() };
  function cfg() {
    var u = root.jpkCalendarConfig || {}, o = {}, k, sh = root.JPKShell && root.JPKShell.config;
    for (k in DEF) o[k] = Object.prototype.hasOwnProperty.call(u, k) ? u[k] : DEF[k];
    if (sh && !Object.prototype.hasOwnProperty.call(u, 'crmBase') && sh.crmBase) o.crmBase = sh.crmBase;
    if (sh && sh.calendar && sh.calendar.outlookUrl && !Object.prototype.hasOwnProperty.call(u, 'outlookUrl')) o.outlookUrl = sh.calendar.outlookUrl;
    if (sh && sh.calendar && sh.calendar.detailCap && !Object.prototype.hasOwnProperty.call(u, 'detailCap')) o.detailCap = sh.calendar.detailCap;
    return o;
  }

  /* ============================ small helpers ============================ */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function toDate(v) { if (v instanceof Date) return isNaN(v) ? null : v; if (v == null || v === '') return null; var t = Date.parse(v); return isNaN(t) ? null : new Date(t); }
  /* local wall time with the viewer's offset for that instant, e.g. 2026-10-22T00:00:00-05:00 (COQL datetime literal format) */
  function isoLocal(d) { var o = -d.getTimezoneOffset(), sg = o >= 0 ? '+' : '-'; o = Math.abs(o); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + sg + pad(Math.floor(o / 60)) + ':' + pad(o % 60); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function qcode(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }   /* same rule as the page's qcode */
  function param(name) { var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(root.location.search); return m ? decodeURIComponent(m[1]) : null; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function warn(m) { try { root.console && root.console.warn && root.console.warn('[jpk-calendar] ' + m); } catch (e) {} }
  function hhmm(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function dayLong(d) { return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function lk(v) { return v && typeof v === 'object' ? String(v.id || '') : v ? String(v) : ''; }
  function lkName(v) { return v && typeof v === 'object' && v.name ? String(v.name) : ''; }
  function crmRec(m, id) { return cfg().crmBase + m + '/' + id; }

  /* ---------- Zoho access: same conventions as the page's live.* and JPK.crm (timeout, in-flight limit, 204 = empty) ---------- */
  function withTimeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error((label || 'request') + ' timed out')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function rowsOf(r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; }
  function isNoContent(e) { return !e || e === '' || e.status === 204 || e.code === 'NO_CONTENT'; }
  function zerr(e) {
    if (e instanceof Error) return e;
    var m;
    if (e == null) m = 'Unknown error';
    else if (typeof e === 'string') m = e;
    else if (e.message) m = (e.code ? e.code + ': ' : '') + e.message;
    else if (e.data && e.data[0] && e.data[0].message) m = (e.data[0].code ? e.data[0].code + ': ' : '') + e.data[0].message;
    else if (e.code) m = String(e.code);
    else { try { m = JSON.stringify(e); } catch (x) { m = 'Unknown error'; } }
    var er = new Error(m); er.raw = e; return er;
  }
  var MAX_INFLIGHT = 2, inflight = 0, queue = [];
  function throttle(fn) {
    return new Promise(function (res, rej) {
      var go = function () {
        inflight++;
        var rel = function () { inflight--; if (queue.length && inflight < MAX_INFLIGHT) queue.shift()(); };
        Promise.resolve().then(fn).then(function (v) { rel(); res(v); }, function (e) { rel(); rej(e); });
      };
      if (inflight < MAX_INFLIGHT) go(); else queue.push(go);
    });
  }
  function liveApi() {
    var Z = root.ZOHO, A = Z.CRM.API;
    return {
      demo: false,
      coql: function (q) {
        state.calls.push({ fn: 'coql', q: q });
        return throttle(function () { return withTimeout(A.coql({ select_query: q }), cfg().timeoutMs, 'query'); })
          .then(function (r) { return { rows: rowsOf(r), more: !!(r && r.info && r.info.more_records) }; }, function (e) { if (isNoContent(e)) return { rows: [], more: false }; throw zerr(e); });
      },
      record: function (m, id) {
        state.calls.push({ fn: 'getRecord', id: String(id) });
        return throttle(function () { return withTimeout(A.getRecord({ Entity: m, RecordID: String(id) }), 10000, 'record'); }).then(function (r) { return rowsOf(r)[0] || {}; }, function (e) { throw zerr(e); });
      },
      update: function (data) {
        state.calls.push({ fn: 'updateRecord', data: data });
        return throttle(function () { return withTimeout(A.updateRecord({ Entity: 'Events', APIData: data, Trigger: cfg().trigger }), 20000, 'save'); });
      },
      user: function () { return withTimeout(Z.CRM.CONFIG.getCurrentUser(), 6000, 'user').then(function (r) { return (r && r.users && r.users[0]) || null; }); }
    };
  }
  function demoMode() {
    var m = param('caldemo');
    if (m) return m;
    if (/[?&]preview=1/.test(root.location.search) || !(root.ZOHO && root.ZOHO.CRM && root.ZOHO.CRM.API)) return '1';
    return null;
  }
  function currentApi() { var m = demoMode(); return m ? demoApi(m) : liveApi(); }

  /* ============================ pure model ============================ */
  /* join links: the first link in the text that is a real join link. "Meeting options", dial-in, help and register links are ignored. */
  var JOIN = [
    { p: 'Teams', re: /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s]+/i },
    { p: 'Teams', re: /^https:\/\/teams\.microsoft\.com\/meet\/\d+/i },
    { p: 'Teams', re: /^https:\/\/teams\.live\.com\/meet\/\d+/i },
    { p: 'Zoom', re: /^https:\/\/([a-z0-9-]+\.)?zoom(gov)?\.(us|com)\/(j|w|my)\/[A-Za-z0-9._-]+/i },
    { p: 'Google Meet', re: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[?#/]|$)/i }
  ];
  function unwrap(u) {   /* Outlook Safe Links wrap the real address in ?url= */
    var m = /^https:\/\/[a-z0-9.-]*safelinks\.protection\.outlook\.com\/[^?]*\?(?:[^#]*&)?url=([^&#]+)/i.exec(u);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    return u;
  }
  function joinInfo(text) {
    if (!text) return null;
    var s = String(text).replace(/&amp;/gi, '&'), re = /https?:\/\/[^\s"'<>()\[\]{}|\\^`]+/gi, m;
    while ((m = re.exec(s))) {
      var u = unwrap(m[0].replace(/[.,;:!?*]+$/, ''));
      for (var i = 0; i < JOIN.length; i++) if (JOIN[i].re.test(u)) return { url: u, provider: JOIN[i].p };
    }
    return null;
  }
  function joinUrl(text) { var j = joinInfo(text); return j ? j.url : null; }

  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  var WD_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function ruleText(v) {
    if (!v) return '';
    if (typeof v === 'object') return String(v.RRULE || v.rrule || '');
    var s = String(v).trim();
    if (s.charAt(0) === '{') { try { return ruleText(JSON.parse(s)); } catch (e) { return ''; } }
    return s;
  }
  function parseUntil(v) {
    var m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})(Z)?)?$/.exec(v);
    if (!m) return null;
    if (!m[4]) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
    if (m[7]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  /* RRULE subset: FREQ DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (ordinals in MONTHLY), BYMONTHDAY, BYSETPOS (MONTHLY), COUNT, UNTIL.
     DTSTART is ignored (the record's own start is used), WKST is taken as Monday. Anything else: unsupported (shown once, marked). */
  function parseRule(v) {
    var s = ruleText(v).replace(/^RRULE:/i, '').trim();
    if (!s) return null;
    var r = { raw: s, freq: null, interval: 1, byday: null, bymonthday: null, bysetpos: null, count: null, until: null, unsupported: null };
    var bad = function (why) { if (!r.unsupported) r.unsupported = why; };
    s.split(';').forEach(function (part) {
      var i = part.indexOf('='), k = part.slice(0, i < 0 ? part.length : i).trim().toUpperCase(), val = i < 0 ? '' : part.slice(i + 1).trim().toUpperCase();
      if (!k) return;
      switch (k) {
        case 'FREQ': r.freq = val; break;
        case 'INTERVAL': r.interval = parseInt(val, 10); if (!(r.interval >= 1)) { r.interval = 1; bad('INTERVAL=' + val); } break;
        case 'COUNT': r.count = parseInt(val, 10); if (!(r.count >= 1)) bad('COUNT=' + val); break;
        case 'UNTIL': r.until = parseUntil(val); if (!r.until) bad('UNTIL=' + val); break;
        case 'BYDAY':
          r.byday = val.split(',').map(function (d) { var m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim()); return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2]] } : null; });
          if (r.byday.some(function (x) { return !x; })) bad('BYDAY=' + val);
          break;
        case 'BYMONTHDAY':
          r.bymonthday = val.split(',').map(function (x) { return parseInt(x, 10); });
          if (r.bymonthday.some(function (x) { return !x || Math.abs(x) > 31; })) bad('BYMONTHDAY=' + val);
          break;
        case 'BYSETPOS': r.bysetpos = parseInt(val, 10); if (!r.bysetpos) bad('BYSETPOS=' + val); break;
        case 'DTSTART': case 'WKST': break;
        default: bad(k);
      }
    });
    if (['DAILY', 'WEEKLY', 'MONTHLY'].indexOf(r.freq) < 0) bad('FREQ=' + (r.freq || 'missing'));
    var ord = r.byday && r.byday.some(function (x) { return x && x.n; });
    if (r.freq === 'DAILY' && (ord || r.bymonthday || r.bysetpos)) bad('DAILY with ' + (ord ? 'BYDAY ordinals' : r.bymonthday ? 'BYMONTHDAY' : 'BYSETPOS'));
    if (r.freq === 'WEEKLY' && (ord || r.bymonthday || r.bysetpos)) bad('WEEKLY with ' + (ord ? 'BYDAY ordinals' : r.bymonthday ? 'BYMONTHDAY' : 'BYSETPOS'));
    if (r.freq === 'MONTHLY' && r.byday && r.bymonthday) bad('BYDAY with BYMONTHDAY');
    if (r.count && r.until) bad('COUNT with UNTIL');
    return r;
  }
  function monthDays(r, y, m, base) {
    var last = new Date(y, m + 1, 0).getDate(), days = [];
    if (r.bymonthday) r.bymonthday.forEach(function (d) { var x = d > 0 ? d : last + d + 1; if (x >= 1 && x <= last) days.push(x); });
    else if (r.byday) {
      r.byday.forEach(function (b) {
        var all = [], d;
        for (d = 1; d <= last; d++) if (new Date(y, m, d).getDay() === b.wd) all.push(d);
        if (!b.n) days = days.concat(all);
        else { var x = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (x) days.push(x); }
      });
      days.sort(function (a, b) { return a - b; });
      if (r.bysetpos) { var p = r.bysetpos > 0 ? days[r.bysetpos - 1] : days[days.length + r.bysetpos]; days = p ? [p] : []; }
    } else if (base.getDate() <= last) days.push(base.getDate());
    return days.filter(function (d, i, a) { return a.indexOf(d) === i; });
  }
  /* occurrence starts (local wall time of base kept, so 9:00 stays 9:00 across a daylight-saving change) within [from, to] */
  function expand(r, base, from, to) {
    var out = [], n = 0, guard = 0, H = base.getHours(), Mi = base.getMinutes(), Se = base.getSeconds(), stop = false;
    if (!r || r.unsupported) return null;
    var at = function (y, mo, d) { return new Date(y, mo, d, H, Mi, Se); };
    var push = function (d) {
      if (d < base) return true;
      if (r.until && d > r.until) return false;
      if (d > to) return false;
      n++; if (r.count && n > r.count) return false;
      if (d >= from) out.push(d);
      return true;
    };
    var by = r.byday ? r.byday.map(function (x) { return x.wd; }) : null, k, i;
    if (r.freq === 'DAILY') {
      for (k = 0; guard++ < 20000; k += r.interval) { var d = at(base.getFullYear(), base.getMonth(), base.getDate() + k); if (by && by.indexOf(d.getDay()) < 0) continue; if (!push(d)) break; }
    } else if (r.freq === 'WEEKLY') {
      var mon = addDays(base, -((base.getDay() + 6) % 7)), wds = (by || [base.getDay()]).slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); });
      for (k = 0; !stop && guard++ < 5000; k += r.interval) for (i = 0; i < wds.length; i++) { if (!push(at(mon.getFullYear(), mon.getMonth(), mon.getDate() + k * 7 + (wds[i] + 6) % 7))) { stop = true; break; } }
    } else if (r.freq === 'MONTHLY') {
      for (k = 0; !stop && guard++ < 1200; k += r.interval) {
        var y = base.getFullYear() + Math.floor((base.getMonth() + k) / 12), m = (base.getMonth() + k) % 12, ds = monthDays(r, y, m, base);
        for (i = 0; i < ds.length; i++) if (!push(at(y, m, ds[i]))) { stop = true; break; }
      }
    }
    return out;
  }
  function ruleWords(r) {
    if (!r) return '';
    if (r.unsupported) return 'Repeats. This repeat rule is not supported here, so only the date on the record is shown.';
    var every = r.interval > 1 ? 'Every ' + r.interval + ' ' : 'Every ';
    var s = r.freq === 'DAILY' ? (r.interval > 1 ? every + 'days' : 'Every day') : r.freq === 'WEEKLY' ? (r.interval > 1 ? every + 'weeks' : 'Every week') : (r.interval > 1 ? every + 'months' : 'Every month');
    if (r.byday && r.freq !== 'MONTHLY') s += ' on ' + r.byday.map(function (b) { return WD_NAME[b.wd]; }).join(', ');
    if (r.until) s += ', until ' + r.until.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (r.count) s += ', ' + r.count + ' times';
    return 'Repeats. ' + s + '.';
  }
  function datePart(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function clockOf(s) { var m = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '')); return m ? m[1] + ':' + m[2] + ':' + (m[3] || '00') : null; }   /* clock time in the string's own offset */
  function utcDate(d) { return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function isMidnight(s) { return /T00:00(:00(\.0+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(String(s || '')); }
  function isCancelled(t) { return /^\s*(canceled|cancelled)\s*:/i.test(String(t || '')); }

  /* one COQL row -> one internal record (Description is read for the join link here and not kept) */
  function normalize(r) {
    if (!r || !r.id) return null;
    var allDay = r.All_day === true || r.All_day === 'true', s, e;
    if (allDay) {
      var ed;
      if (clockOf(r.Start_DateTime) === '00:00:00' || !toDate(r.Start_DateTime)) {
        /* local midnight start (Outlook style): the date as written; a midnight end is exclusive */
        s = datePart(r.Start_DateTime); if (!s) return null;
        ed = datePart(r.End_DateTime) || s;
        if (ed > s && isMidnight(r.End_DateTime)) ed = addDays(ed, -1);
      } else {
        /* stored as UTC midnight to 23:59:59 UTC, written in another offset (e.g. 2025-04-20T19:00:00-05:00): the UTC calendar dates */
        s = utcDate(toDate(r.Start_DateTime));
        var ei = toDate(r.End_DateTime);
        ed = ei ? utcDate(ei) : s;
        if (ei && ed > s && ei.getUTCHours() === 0 && ei.getUTCMinutes() === 0 && ei.getUTCSeconds() === 0) ed = addDays(ed, -1);
      }
      if (ed < s) ed = s;
      e = addDays(ed, 1);
    } else {
      s = toDate(r.Start_DateTime); if (!s) return null;
      e = toDate(r.End_DateTime); if (!e || e < s) e = s;
    }
    var j = joinInfo(r.Description) || joinInfo(r.Venue);
    var venue = r.Venue ? String(r.Venue) : '';
    if (/^\s*https?:\/\//i.test(venue)) venue = j ? j.provider + ' meeting' : '';
    var rule = parseRule(r.Recurring_Activity);
    return {
      id: String(r.id), title: String(r.Event_Title || '').trim() || '(no title)', s: s, e: e, allDay: allDay, venue: venue,
      joinUrl: j ? j.url : '', accountId: lk(r.What_Id), accountName: lkName(r.What_Id), contactId: lk(r.Who_Id), contactName: lkName(r.Who_Id),
      ownerId: lk(r.Owner), rule: rule
    };
  }
  function toEvent(x, s, e, extra) {
    var ev = {
      id: x.id, title: x.title, start: isoLocal(s), end: isoLocal(e), allDay: x.allDay, venue: x.venue, joinUrl: x.joinUrl,
      accountId: x.accountId, contactId: x.contactId, attendees: [], accountName: x.accountName, contactName: x.contactName,
      recurring: !!x.rule, recurrence: x.rule ? ruleWords(x.rule) : ''
    };
    if (extra) for (var k in extra) ev[k] = extra[k];
    return ev;
  }
  /* rows (+ recurring rows that started before the range) -> events whose start is inside [range.start, range.end], sorted, de-duplicated */
  function build(rows, range) {
    var out = [], seen = {}, recs = [];
    var key = function (ev) { return ev.title.toLowerCase() + '|' + toDate(ev.start).getTime(); };
    var add = function (ev) { var s = toDate(ev.start), k = key(ev); if (s < range.start || s > range.end || seen[k]) return; seen[k] = 1; out.push(ev); };
    (rows || []).forEach(function (r) {
      var x = normalize(r); if (!x || isCancelled(x.title)) return;
      recs.push(x);
      if (x.allDay) {   /* one piece per day of a multi-day all-day event, so each day lists it */
        for (var d = x.s, i = 0; d < x.e && i < 31; d = addDays(d, 1), i++) add(toEvent(x, d, addDays(d, 1), i ? { continued: true } : null));
      } else add(toEvent(x, x.s, x.e));
    });
    recs.forEach(function (x) {
      if (!x.rule || x.rule.unsupported) return;   /* unsupported: the record itself is shown once, marked recurring */
      var dur = x.e - x.s, starts = expand(x.rule, x.s, range.start, range.end) || [];
      starts.forEach(function (d) { add(toEvent(x, d, x.allDay ? addDays(d, 1) : new Date(d.getTime() + dur), { occurrence: true })); });
    });
    out.sort(function (a, b) { return toDate(a.start) - toDate(b.start) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1); });
    return out;
  }

  /* ============================ state ============================ */
  var state = { calls: [], notes: [], detailReads: [], query: null, events: [], loads: 0, me: null, error: null };
  var partCache = {}, detailDays = {};
  function shellEvents() { var S = root.JPKShell && root.JPKShell.state; return S && S.cal && Array.isArray(S.cal.events) ? S.cal.events : []; }
  function eachById(id, fn) { var seen = []; state.events.concat(shellEvents()).forEach(function (e) { if (e && String(e.id) === String(id) && seen.indexOf(e) < 0) { seen.push(e); fn(e); } }); }
  function rerender() { var C = root.JPKShell && root.JPKShell.calendar; if (C && typeof C.render === 'function') { try { C.render(); } catch (e) { warn('render failed: ' + e.message); } } }
  function visibleDay() { var S = root.JPKShell && root.JPKShell.state; return (S && S.cal && S.cal.day) || ymd(new Date()); }

  /* ============================ load ============================ */
  function whoAmI(api) {
    if (api.demo) return Promise.resolve(api.me);
    var c = cfg(), t0 = Date.now();
    /* the page publishes window.__bdcsUser after its own getCurrentUser; asking a second time early can go unanswered (see bdcs-rel) */
    return new Promise(function (res) {
      (function chk() {
        var u = root.__bdcsUser;
        if (u && u.id) return res(String(u.id));
        if (u === null || Date.now() - t0 > c.userWaitMs) return res(null);
        setTimeout(chk, 300);
      })();
    }).then(function (id) {
      if (id) return id;
      return api.user().then(function (u) { return u && u.id ? String(u.id) : null; }, function () { return null; });
    });
  }
  var COLS = {
    full: 'id, Event_Title, Start_DateTime, End_DateTime, All_day, Venue, Description, What_Id, Who_Id, Owner, Recurring_Activity',
    noRecur: 'id, Event_Title, Start_DateTime, End_DateTime, All_day, Venue, Description, What_Id, Who_Id, Owner',
    minimal: 'id, Event_Title, Start_DateTime, End_DateTime, All_day, Venue, What_Id, Who_Id, Owner'
  };
  function pageAll(api, q) {
    var c = cfg(), out = [];
    var step = function (p) {
      return api.coql(q + ' limit ' + c.pageSize + ' offset ' + (p * c.pageSize)).then(function (r) {
        out = out.concat(r.rows);
        if (r.rows.length && (r.rows.length >= c.pageSize || r.more) && p + 1 < c.maxPages) return step(p + 1);
        return out;
      });
    };
    return step(0);
  }
  function load(range) {
    var now = new Date(), days = (range && range.days) || 7;
    range = { start: range && range.start ? range.start : startOfDay(now), end: range && range.end ? range.end : new Date(addDays(now, days).getTime() - 1), days: days };
    var api = currentApi(), mode = demoMode();
    state.loads++; state.notes = []; state.error = null; state.query = null;
    if (mode === 'slow') return new Promise(function () {});
    var qs = isoLocal(addDays(range.start, -1)), qe = isoLocal(new Date(addDays(range.end, 2).getTime() - 1000));   /* one day either side: all-day records stored in another offset */
    return whoAmI(api).then(function (me) {
      if (!me) throw new Error('Could not tell who you are, so your meetings cannot be found.');
      state.me = me;
      var tries = [];
      ['full', 'noRecur', 'minimal'].forEach(function (k) { [true, false].forEach(function (own) { tries.push({ cols: k, owner: own }); }); });
      var where = function (own) { return own ? "where ((Owner.id = " + me + " and Start_DateTime >= '" + qs + "') and Start_DateTime <= '" + qe + "')" : "where (Start_DateTime >= '" + qs + "' and Start_DateTime <= '" + qe + "')"; };
      var i = 0, last;
      var next = function () {
        if (i >= tries.length) return Promise.reject(last);
        var t = tries[i++];
        return pageAll(api, 'select ' + COLS[t.cols] + ' from Events ' + where(t.owner) + ' order by Start_DateTime asc').then(function (rows) { state.query = t; return rows; }, function (e) {
          last = e;
          if (/timed out/i.test(e && e.message)) throw e;   /* a slow Zoho is not a refused column: stop, show the failure */
          return next();
        });
      };
      return next().then(function (rows) {
        var t = state.query;
        if (!t.owner) { rows = rows.filter(function (r) { return lk(r.Owner) === me; }); state.notes.push('COQL refused the owner filter; meetings were filtered here.'); }
        if (t.cols !== 'full') state.notes.push(t.cols === 'noRecur' ? 'Repeat rules could not be read.' : 'Repeat rules and join links could not be read.');
        if (t.cols !== 'full') return rows;
        /* repeating meetings that started before the range: the occurrences inside it come from their rule */
        var mq = 'select ' + COLS.full + " from Events where ((" + (t.owner ? 'Owner.id = ' + me : 'id is not null') + " and Recurring_Activity is not null) and Start_DateTime < '" + qs + "') order by Start_DateTime desc";
        return api.coql(mq + ' limit ' + cfg().pageSize + ' offset 0').then(function (r) {
          var older = r.rows.filter(function (x) { return t.owner || lk(x.Owner) === me; });
          return older.concat(rows);
        }, function (e) { state.notes.push('Older repeating meetings could not be read (' + (e && e.message) + ').'); return rows; });
      });
    }).then(function (rows) {
      var list = build(rows, range);
      return names(api, list).then(function () { state.events = list; return list; });
    }).catch(function (e) { state.error = e && e.message || String(e); throw zerr(e); });
  }
  /* chip names: one COQL per module for the ids on screen; a failure leaves the generic chip label */
  function names(api, list) {
    var acc = {}, con = {};
    list.forEach(function (e) { if (e.accountId && !e.accountName) acc[e.accountId] = 1; if (e.contactId && !e.contactName) con[e.contactId] = 1; });
    var a = Object.keys(acc).filter(function (x) { return /^\d+$/.test(x); }).slice(0, 50), c = Object.keys(con).filter(function (x) { return /^\d+$/.test(x); }).slice(0, 50);
    var pa = a.length ? api.coql('select id, Account_Name from Accounts where id in (' + a.join(',') + ') limit 50').then(function (r) { return r.rows; }, function () { return null; }) : Promise.resolve([]);
    var pc = c.length ? api.coql('select id, Full_Name from Contacts where id in (' + c.join(',') + ') limit 50').then(function (r) { return r.rows; }, function () { return null; }) : Promise.resolve([]);
    return Promise.all([pa, pc]).then(function (res) {
      var an = {}, cn = {};
      (res[0] || []).forEach(function (r) { an[String(r.id)] = r.Account_Name; });
      (res[1] || []).forEach(function (r) { cn[String(r.id)] = r.Full_Name; });
      list.forEach(function (e) {
        if (e.accountId && !e.accountName) {
          if (an[e.accountId]) e.accountName = an[e.accountId];
          else if (res[0]) { e.whatId = e.accountId; e.accountId = ''; }   /* What_Id points at another module (a deal, a case): not an account chip */
        }
        if (e.contactId && !e.contactName && cn[e.contactId]) e.contactName = cn[e.contactId];
      });
    });
  }

  /* ============================ participants (record API, lazy) ============================ */
  function mapParticipant(p) {
    var type = String(p && p.type || '').toLowerCase(), pid = p && p.participant != null ? String(p.participant && p.participant.id || p.participant) : '';
    return { name: String(p && (p.name || p.Email || p.email) || ''), email: String(p && (p.Email || p.email) || ''), type: type, contactId: type === 'contact' ? pid : '', userId: type === 'user' ? pid : '' };
  }
  function participants(ev) {
    if (!ev || !ev.id) return Promise.reject(new Error('No meeting was given.'));
    var id = String(ev.id);
    if (partCache[id]) return partCache[id];
    var s = toDate(ev.start), day = s ? ymd(s) : '', today = ymd(new Date());
    if (day !== visibleDay() && day !== today) return Promise.reject(new Error('Attendees load only for the day on screen.'));
    var cap = cfg().detailCap, n = detailDays[day] || 0;
    if (n >= cap) return Promise.reject(new Error('Attendees load for up to ' + cap + (cap === 1 ? ' meeting' : ' meetings') + ' a day. Open the meeting in Zoho to see the rest.'));
    detailDays[day] = n + 1; state.detailReads.push(id);
    partCache[id] = currentApi().record('Events', id).then(function (rec) {
      var list = (rec && Array.isArray(rec.Participants) ? rec.Participants : []).map(mapParticipant);
      eachById(id, function (e) { e.attendees = list; });
      return list;
    }, function (e) { delete partCache[id]; detailDays[day] = Math.max(0, (detailDays[day] || 1) - 1); throw zerr(e); });
    return partCache[id];
  }
  /* suggestions: contacts among the attendees first, then those contacts' accounts */
  function suggestions(ev) {
    return participants(ev).then(function (people) {
      var cons = [], seen = {};
      people.forEach(function (p) { if (p.contactId && /^\d+$/.test(p.contactId) && !seen[p.contactId]) { seen[p.contactId] = 1; cons.push(p); } });
      if (!cons.length) return [];
      var api = currentApi();
      return api.coql('select id, Full_Name, Email, Account_Name from Contacts where id in (' + cons.map(function (p) { return p.contactId; }).join(',') + ') limit 50').then(function (r) { return r.rows; }, function () { return []; }).then(function (rows) {
        var byId = {}; rows.forEach(function (r) { byId[String(r.id)] = r; });
        var accIds = []; rows.forEach(function (r) { var a = lk(r.Account_Name); if (a && /^\d+$/.test(a) && accIds.indexOf(a) < 0) accIds.push(a); });
        var pa = accIds.length ? api.coql('select id, Account_Name from Accounts where id in (' + accIds.join(',') + ') limit 50').then(function (r) { return r.rows; }, function () { return []; }) : Promise.resolve([]);
        return pa.then(function (accs) {
          var an = {}; accs.forEach(function (a) { an[String(a.id)] = a.Account_Name; });
          var out = cons.map(function (p) {
            var r = byId[p.contactId] || {}, a = lk(r.Account_Name);
            return { kind: 'contact', id: p.contactId, name: r.Full_Name || p.name || p.email, email: r.Email || p.email, accountId: a, accountName: an[a] || lkName(r.Account_Name) || '' };
          });
          var accOut = [];
          out.forEach(function (c) { if (c.accountId && an[c.accountId] && !accOut.some(function (x) { return x.id === c.accountId; })) accOut.push({ kind: 'account', id: c.accountId, name: an[c.accountId], via: c.name }); });
          return out.concat(accOut);
        });
      });
    });
  }
  function search(term) {
    var t = qcode(String(term || '').trim()), api = currentApi();
    var pa = api.coql("select id, Account_Name from Accounts where Account_Name like '%" + t + "%' order by Account_Name asc limit 8").then(function (r) { return r.rows; });
    var pc = api.coql("select id, Full_Name, Email, Account_Name from Contacts where ((Last_Name like '%" + t + "%' or First_Name like '%" + t + "%') or Email like '%" + t + "%') order by Last_Name asc limit 8").then(function (r) { return r.rows; });
    return Promise.all([pa, pc]).then(function (res) {
      return res[0].map(function (a) { return { kind: 'account', id: String(a.id), name: a.Account_Name }; })
        .concat(res[1].map(function (c) { return { kind: 'contact', id: String(c.id), name: c.Full_Name, email: c.Email || '', accountName: lkName(c.Account_Name) }; }));
    });
  }

  /* ============================ write ============================ */
  function writeAllowed(id) {
    var w = (root.jpkCalendarConfig || {}).writeAllowedIds;
    if (w === undefined) w = DEF.writeAllowedIds;
    if (w === '*') return true;
    return Array.isArray(w) && w.map(String).indexOf(String(id)) >= 0;
  }
  function writeError(x) {   /* Zoho's own words: CODE: message (field) */
    var d0 = x && x.raw ? x.raw : x;
    if (d0 && d0.data && d0.data[0]) d0 = d0.data[0];
    if (d0 instanceof Error) return d0.message;
    var code = String(d0 && d0.code || ''), msg = String(d0 && d0.message || ''), f = d0 && d0.details && d0.details.api_name;
    var s = (code && msg ? code + ': ' + msg : code || msg || (typeof x === 'string' ? x : 'No answer from Zoho')) + (f ? ' (' + f + ')' : '');
    return s;
  }
  /* payload = only what was asked: What_Id (+ $se_module, which Zoho needs with What_Id) and/or Who_Id; id names the record */
  function payload(ev, sel) {
    var d = { id: String(ev.id) };
    if (sel.account) { d.What_Id = { id: String(sel.account.id) }; d.$se_module = 'Accounts'; }
    if (sel.contact) d.Who_Id = { id: String(sel.contact.id) };
    return d;
  }
  function write(ev, sel) {
    if (!writeAllowed(ev.id)) return Promise.reject({ blocked: true });
    var api = currentApi();
    return api.update(payload(ev, sel)).then(function (resp) {
      var row = resp && resp.data && resp.data[0];
      if (!(row && (row.code === 'SUCCESS' || row.status === 'success'))) throw { zoho: writeError(row || resp) };
      eachById(ev.id, function (e) {
        if (sel.account) { e.accountId = String(sel.account.id); e.accountName = sel.account.name || ''; delete e.whatId; }
        if (sel.contact) { e.contactId = String(sel.contact.id); e.contactName = sel.contact.name || ''; }
      });
      rerender();
      return { demo: !!api.demo };
    }, function (e) { if (e && e.zoho) throw e; throw { zoho: writeError(e) }; });
  }

  /* ============================ panel (meeting details and link picker), inline in the calendar ============================ */
  var P = null;
  function whenText(ev) {
    var s = toDate(ev.start), e = toDate(ev.end);
    if (ev.allDay) return dayLong(s) + ', all day';
    return dayLong(s) + ', ' + hhmm(s) + (e && e > s ? ' to ' + hhmm(e) : '');
  }
  function panelEl() {
    var cal = doc.getElementById('jpk-cal'); if (!cal) return null;
    var up = cal.querySelector('.jpk-upnext'), body = cal.querySelector('.jpk-cal-body'), el = doc.getElementById('jpk-cal-panel');
    if (!el) {
      el = doc.createElement('section');
      el.id = 'jpk-cal-panel'; el.className = 'jpk-cal-panel'; el.hidden = true;
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'jpk-pn-h');
      el.addEventListener('click', onPanelClick); el.addEventListener('keydown', onPanelKey); el.addEventListener('input', onPanelInput);
    }
    if (up && up.parentNode) { if (up.nextSibling !== el) up.parentNode.insertBefore(el, up.nextSibling); }
    else if (body && el.parentNode !== body) body.insertBefore(el, body.firstChild);
    if (body && body.hidden) { var tg = cal.querySelector('.jpk-tg'); if (tg) tg.click(); }
    return el;
  }
  function focusIn(sel) { if (!P) return; var n = P.el.querySelector(sel); if (n) { try { n.focus({ preventScroll: true }); } catch (e) {} try { n.scrollIntoView({ block: 'nearest' }); } catch (e2) {} } }
  function openPanel(mode, ev, opener) {
    if (P) closePanel(true);
    var el = panelEl();
    if (!el) return Promise.resolve({ linked: false });
    return new Promise(function (resolve) {
      P = { mode: mode, ev: ev, opener: opener || doc.activeElement, el: el, step: 'choose', sel: { account: null, contact: null }, sug: { state: 'loading', items: [] }, res: { state: 'idle', items: [], term: '' }, resolve: resolve, linked: false, seq: 0 };
      el.hidden = false;
      if (mode === 'detail') renderDetail(); else renderLink();
    });
  }
  function closePanel(silent) {
    if (!P) return;
    var p = P; P = null;
    clearTimeout(p.timer);
    p.el.hidden = true; p.el.innerHTML = '';
    if (!silent) {
      var back = p.opener && doc.contains(p.opener) && p.opener.getClientRects().length ? p.opener : null;
      if (!back) back = doc.querySelector('#jpk-cal .jpk-upnext .jpk-chip') || doc.getElementById('jpk-cal-h');
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    }
    p.resolve({ linked: p.linked });
  }
  function linkedText(ev) {
    var parts = [];
    if (ev.accountId) parts.push('account ' + (ev.accountName || 'in Zoho'));
    if (ev.contactId) parts.push('contact ' + (ev.contactName || 'in Zoho'));
    if (ev.whatId && !ev.accountId) parts.push('a record that is not an account');
    return parts.length ? 'Linked to ' + parts.join(' and ') + '.' : 'Not linked to an account or contact yet.';
  }
  function head(title) { return '<div class="jpk-pn-head"><h3 class="jpk-pn-h" id="jpk-pn-h" tabindex="-1">' + esc(title) + '</h3><button type="button" class="jpk-btn jpk-pn-x" data-pn="close">Close</button></div>'; }

  /* ---- details ---- */
  function renderDetail() {
    var ev = P.ev, now = new Date(), past = !ev.allDay && toDate(ev.end) <= now;
    P.el.innerHTML = head(ev.title || '(no title)')
      + '<p class="jpk-pn-when">' + esc(whenText(ev)) + (ev.venue ? '<span class="jpk-pn-venue">' + esc(ev.venue) + '</span>' : '') + '</p>'
      + (ev.recurrence ? '<p class="jpk-pn-note">' + esc(ev.recurrence) + '</p>' : '')
      + '<h4 class="jpk-pn-sub">Attendees</h4><ul class="jpk-pn-people" id="jpk-pn-att" aria-live="polite"><li class="jpk-pn-muted">Loading attendees…</li></ul>'
      + '<p class="jpk-pn-linked" id="jpk-pn-linked">' + esc(linkedText(ev)) + '</p>'
      + '<div class="jpk-pn-acts">'
      + (ev.joinUrl && !past ? '<a class="jpk-btn jpk-primary" href="' + esc(ev.joinUrl) + '" target="_blank" rel="noopener">Join</a>' : '')
      + '<button type="button" class="jpk-btn" data-pn="tolink">' + (ev.accountId || ev.contactId ? 'Change link' : 'Link to account or contact') + '</button>'
      + '<a class="jpk-btn" target="_top" href="' + esc(crmRec('Events', ev.id)) + '">Open in Zoho</a>'
      + '<a class="jpk-btn" target="_blank" rel="noopener" href="' + esc(cfg().outlookUrl) + '">Open in Outlook</a></div>';
    focusIn('#jpk-pn-h');
    var mine = P;
    participants(ev).then(function (list) {
      if (P !== mine) return;
      var ul = P.el.querySelector('#jpk-pn-att'); if (!ul) return;
      ul.innerHTML = list.length ? list.map(function (a) {
        var who = esc(a.name || a.email) + (a.email && a.name && a.name !== a.email ? ' <span class="jpk-pn-muted">' + esc(a.email) + '</span>' : '');
        return '<li>' + (a.contactId ? '<a target="_top" href="' + esc(crmRec('Contacts', a.contactId)) + '">' + who + '</a> <span class="jpk-pn-tag">Contact</span>' : who + (a.type === 'user' ? ' <span class="jpk-pn-tag">Zoho user</span>' : '')) + '</li>';
      }).join('') : '<li class="jpk-pn-muted">No attendees listed.</li>';
    }, function (e) {
      if (P !== mine) return;
      var ul = P.el.querySelector('#jpk-pn-att'); if (ul) ul.innerHTML = '<li class="jpk-pn-bad">Attendees could not load: ' + esc(e.message) + '</li>';
    });
  }

  /* ---- link picker ---- */
  function pickHtml(it) {
    var on = !!(P.sel[it.kind] && P.sel[it.kind].id === it.id);
    var sub = it.kind === 'contact' ? ['Contact', it.email, it.accountName].filter(Boolean).join(' · ') : 'Account' + (it.via ? ' of ' + it.via : '');
    return '<li><button type="button" class="jpk-pick" data-pick="' + esc(it.kind + ':' + it.id) + '" aria-pressed="' + on + '"><span class="jpk-pick-n">' + esc(it.name || '(no name)') + '</span><span class="jpk-pick-k">' + esc(sub) + '</span></button></li>';
  }
  function renderLink() {
    var ev = P.ev;
    P.step = 'choose';
    P.el.innerHTML = head('Link this meeting')
      + '<p class="jpk-pn-when"><b>' + esc(ev.title) + '</b><span class="jpk-pn-venue">' + esc(whenText(ev)) + '</span></p>'
      + '<p class="jpk-pn-linked">' + esc(linkedText(ev)) + '</p>'
      + '<h4 class="jpk-pn-sub" id="jpk-pick-sug-h">Suggested from the attendees</h4><ul class="jpk-pick-list" id="jpk-pick-sug" aria-labelledby="jpk-pick-sug-h" aria-live="polite"></ul>'
      + '<label class="jpk-pn-sub" for="jpk-pick-q">Search accounts and contacts</label>'
      + '<input type="search" class="jpk-pick-q" id="jpk-pick-q" autocomplete="off" spellcheck="false" placeholder="Name or email">'
      + '<ul class="jpk-pick-list" id="jpk-pick-res" aria-label="Search results" aria-live="polite"></ul>'
      + '<p class="jpk-pick-sel" id="jpk-pick-sel" aria-live="polite"></p>'
      + '<div class="jpk-pn-acts"><button type="button" class="jpk-btn jpk-primary" data-pn="review">Review link</button><button type="button" class="jpk-btn" data-pn="close">Cancel</button></div>';
    paintSug(); paintRes(); paintSel();
    focusIn('#jpk-pn-h');
    if (P.sug.state === 'loading') {
      var mine = P;
      suggestions(ev).then(function (items) { if (P !== mine) return; P.sug = { state: 'ok', items: items }; if (P.step === 'choose') paintSug(); },
        function (e) { if (P !== mine) return; P.sug = { state: 'err', items: [], error: e.message }; if (P.step === 'choose') paintSug(); });
    }
  }
  function paintSug() {
    var ul = P.el.querySelector('#jpk-pick-sug'); if (!ul) return;
    var s = P.sug, h;
    if (s.state === 'loading') h = '<li class="jpk-pn-muted">Loading suggestions…</li>';
    else if (s.state === 'err') h = '<li class="jpk-pn-bad">Attendees could not load: ' + esc(s.error) + ' Search below instead.</li>';
    else if (!s.items.length) h = '<li class="jpk-pn-muted">None of the attendees is a contact in Zoho. Search below.</li>';
    else h = s.items.map(pickHtml).join('');
    keepFocus(ul, h);
  }
  function paintRes() {
    var ul = P.el.querySelector('#jpk-pick-res'); if (!ul) return;
    var r = P.res, h;
    if (r.state === 'idle') h = '';
    else if (r.state === 'short') h = '<li class="jpk-pn-muted">Type at least 2 letters.</li>';
    else if (r.state === 'loading') h = '<li class="jpk-pn-muted">Searching…</li>';
    else if (r.state === 'err') h = '<li class="jpk-pn-bad">Search failed: ' + esc(r.error) + '</li>';
    else {
      var shown = {}; P.sug.items.forEach(function (x) { shown[x.kind + ':' + x.id] = 1; });
      var items = r.items.filter(function (x) { return !shown[x.kind + ':' + x.id]; });
      h = items.length ? items.map(pickHtml).join('') : '<li class="jpk-pn-muted">Nothing found for “' + esc(r.term) + '”.</li>';
    }
    keepFocus(ul, h);
  }
  function keepFocus(ul, h) {
    if (ul.__h === h) return;
    var f = doc.activeElement && ul.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-pick') : null;
    ul.innerHTML = h; ul.__h = h;
    if (f) { var n = ul.querySelector('[data-pick="' + f + '"]'); if (n) n.focus({ preventScroll: true }); }
  }
  function selText() {
    var a = P.sel.account, c = P.sel.contact;
    if (!a && !c) return 'Pick an account, a contact, or one of each.';
    return 'Chosen: ' + [a ? 'account ' + a.name : '', c ? 'contact ' + c.name : ''].filter(Boolean).join(' and ') + '.';
  }
  function paintSel() {
    var p = P.el.querySelector('#jpk-pick-sel'); if (p) p.textContent = selText();
    var b = P.el.querySelector('[data-pn="review"]'); if (b) b.disabled = !P.sel.account && !P.sel.contact;
    Array.prototype.forEach.call(P.el.querySelectorAll('[data-pick]'), function (n) { var k = n.getAttribute('data-pick').split(':'); n.setAttribute('aria-pressed', String(!!(P.sel[k[0]] && P.sel[k[0]].id === k[1]))); });
  }
  function findItem(key) {
    var all = P.sug.items.concat(P.res.items);
    for (var i = 0; i < all.length; i++) if (all[i].kind + ':' + all[i].id === key) return all[i];
    return null;
  }
  function renderConfirm() {
    var ev = P.ev, a = P.sel.account, c = P.sel.contact;
    P.step = 'confirm';
    P.el.innerHTML = head('Check before linking')
      + '<p>Link the meeting <b>' + esc(ev.title) + '</b> on ' + esc(whenText(ev)) + ' to:</p>'
      + '<ul class="jpk-pn-confirm">' + (a ? '<li>Account: <b>' + esc(a.name) + '</b></li>' : '') + (c ? '<li>Contact: <b>' + esc(c.name) + '</b></li>' : '') + '</ul>'
      + '<p class="jpk-pn-note">This changes the meeting record in Zoho CRM' + (ev.recurring ? ' (one record holds every date of a repeating meeting)' : '') + '.'
      + ((a && ev.accountId && ev.accountId !== a.id) || (c && ev.contactId && ev.contactId !== c.id) ? ' It replaces the current link.' : '') + '</p>'
      + '<p class="jpk-pn-msg" id="jpk-pn-msg" role="status"></p>'
      + '<div class="jpk-pn-acts"><button type="button" class="jpk-btn jpk-primary" data-pn="write">Link meeting</button><button type="button" class="jpk-btn" data-pn="back">Back</button><button type="button" class="jpk-btn" data-pn="close">Cancel</button></div>';
    focusIn('#jpk-pn-h');
  }
  function renderResult(kind, text) {
    P.step = kind;
    var ok = kind === 'done';
    P.el.innerHTML = head(ok ? 'Meeting linked' : kind === 'blocked' ? 'Not linked' : 'Link not saved')
      + '<p class="jpk-pn-msg ' + (ok ? 'jpk-pn-good' : 'jpk-pn-bad') + '" id="jpk-pn-msg" role="' + (ok ? 'status' : 'alert') + '">' + esc(text) + '</p>'
      + '<div class="jpk-pn-acts">' + (ok ? '' : '<button type="button" class="jpk-btn" data-pn="back">Back</button>') + '<button type="button" class="jpk-btn' + (ok ? ' jpk-primary' : '') + '" data-pn="close">Close</button></div>';
    focusIn('#jpk-pn-h');
  }
  function doWrite() {
    var mine = P, ev = P.ev, sel = { account: P.sel.account, contact: P.sel.contact };
    var btn = P.el.querySelector('[data-pn="write"]'), msg = P.el.querySelector('#jpk-pn-msg');
    if (!writeAllowed(ev.id)) { renderResult('blocked', 'Linking is limited to the test meeting while this is being checked.'); return; }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Linking…';
    write(ev, sel).then(function (r) {
      if (P !== mine) return;
      P.linked = true;
      var what = [sel.account ? sel.account.name : '', sel.contact ? sel.contact.name : ''].filter(Boolean).join(' and ');
      renderResult('done', 'Linked. This meeting now shows ' + what + '.' + (r.demo ? ' Preview only: nothing was saved in Zoho.' : ''));
    }, function (e) {
      if (P !== mine) return;
      if (e && e.blocked) renderResult('blocked', 'Linking is limited to the test meeting while this is being checked.');
      else renderResult('error', 'Zoho did not save the link. Zoho said: ' + (e && e.zoho || 'no answer') + '.');
    });
  }
  function runSearch() {
    var q = P.el.querySelector('#jpk-pick-q'); if (!q) return;
    var term = q.value.trim(), mine = P, seq = ++P.seq;
    if (!term) { P.res = { state: 'idle', items: [], term: '' }; paintRes(); return; }
    if (term.length < 2) { P.res = { state: 'short', items: [], term: term }; paintRes(); return; }
    P.res = { state: 'loading', items: [], term: term }; paintRes();
    search(term).then(function (items) { if (P !== mine || seq !== P.seq) return; P.res = { state: 'ok', items: items, term: term }; paintRes(); paintSel(); },
      function (e) { if (P !== mine || seq !== P.seq) return; P.res = { state: 'err', items: [], term: term, error: zerr(e).message }; paintRes(); });
  }
  function onPanelInput(e) {
    if (!P || !e.target || e.target.id !== 'jpk-pick-q') return;
    clearTimeout(P.timer); P.timer = setTimeout(runSearch, 300);
  }
  function onPanelKey(e) {
    if (!P) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
    if (e.key === 'Enter' && e.target && e.target.id === 'jpk-pick-q') { e.preventDefault(); clearTimeout(P.timer); runSearch(); }
  }
  function onPanelClick(e) {
    if (!P) return;
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b = t.closest('[data-pick]');
    if (b) {
      var it = findItem(b.getAttribute('data-pick')); if (!it) return;
      P.sel[it.kind] = P.sel[it.kind] && P.sel[it.kind].id === it.id ? null : it;
      paintSel(); return;
    }
    b = t.closest('[data-pn]'); if (!b) return;
    var act = b.getAttribute('data-pn');
    if (act === 'close') closePanel();
    else if (act === 'tolink') { P.mode = 'link'; renderLink(); }
    else if (act === 'review') { if (P.sel.account || P.sel.contact) renderConfirm(); }
    else if (act === 'back') { var term = P.res.term; renderLink(); var q = P.el.querySelector('#jpk-pick-q'); if (q && term) q.value = term; }
    else if (act === 'write') doWrite();
  }

  /* ============================ demo records (preview / ?caldemo=) ============================ */
  function demoApi(mode) {
    var now = new Date(), t0 = startOfDay(now), me = '6715134000000503001';
    var at = function (dayOff, h, m) { var d = addDays(t0, dayOff); d.setHours(h, m, 0, 0); return d; };
    var plus = function (d, min) { return new Date(d.getTime() + min * 60000); };
    var soon = new Date(now.getTime() + 25 * 60000); soon.setSeconds(0, 0);
    var teams = 'Microsoft Teams Need help? <https://aka.ms/JoinTeamsMeeting?omkt=en-US>\nJoin the meeting now <https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22demo%22%7d>\nMeeting ID: 245 813 667 019\nPasscode: dEm0pX\n________________________________\nFor organizers: Meeting options <https://teams.microsoft.com/meetingOptions/?organizerId=demo>';
    var row = function (id, title, s, e, o) { var r = { id: id, Event_Title: title, Start_DateTime: isoLocal(s), End_DateTime: isoLocal(e), All_day: false, Venue: '', Description: '', What_Id: null, Who_Id: null, Owner: { id: me, name: 'Beau Carrigan' }, Recurring_Activity: null }; for (var k in o || {}) r[k] = o[k]; return r; };
    var rows = [
      row('6715134000010000001', 'Linn County Sheriff: quarterly check-in', new Date(now.getTime() - 3 * 3600000), new Date(now.getTime() - 2.5 * 3600000), { Venue: 'Microsoft Teams Meeting', Description: teams, What_Id: { id: '6715134000000700001' } }),
      row(TEST_EVENT, 'TEST – CS Home calendar', soon, plus(soon, 30), { Venue: 'Microsoft Teams Meeting', Description: teams }),
      row('6715134000010000003', 'Collections follow-up with finance', new Date(now.getTime() + 3 * 3600000), new Date(now.getTime() + 4 * 3600000), { Venue: 'Room 2' }),
      row('6715134000010000004', 'Polk County renewal call', at(1, 10, 0), at(1, 11, 0), { Venue: 'Zoom', Description: 'Join Zoom Meeting https://us02web.zoom.us/j/84512345678?pwd=demo1 Meeting ID: 845 1234 5678 Passcode: 559201' }),
      row('6715134000010000005', 'SCRAM vendor sync', at(3, 14, 0), at(3, 14, 30), { Description: 'Join with Google Meet: https://meet.google.com/abc-defg-hij' }),
      row('6715134000010000006', 'Marathon County onboarding', at(3, 15, 30), at(3, 16, 15), { What_Id: { id: '6715134000000700006' } }),
      row('6715134000010000007', 'Out of office: WI Counties conference', at(2, 0, 0), at(2, 23, 59), { All_day: true }),
      row('6715134000010000008', 'Canceled: Old vendor demo', at(1, 13, 0), at(1, 13, 30), {})
    ];
    var master = row('6715134000010000009', 'EM ops stand-up', at(-21, 8, 30), at(-21, 8, 45), { Venue: 'Microsoft Teams Meeting', Recurring_Activity: { RRULE: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;DTSTART=' + ymd(at(-21, 0, 0)) } });
    var isToday = function (r) { var s = toDate(r.Start_DateTime); return s >= t0 && s < addDays(t0, 1); };
    if (mode === 'later') { rows = rows.filter(function (r) { return !isToday(r); }); if (t0.getDay() === 1 || t0.getDay() === 4) master = null; }
    if (mode === 'done') rows = rows.map(function (r) {
      if (!isToday(r)) return r; var span = now - t0, s = new Date(t0.getTime() + span * 0.2), e = new Date(t0.getTime() + span * 0.4);
      var c = {}; for (var k in r) c[k] = r[k]; c.Start_DateTime = isoLocal(s); c.End_DateTime = isoLocal(e); return c;
    });
    if (mode === 'empty') { rows = []; master = null; }
    var accounts = [{ id: '6715134000000700001', Account_Name: 'Linn County Sheriff' }, { id: '6715134000000700002', Account_Name: 'Dane County' }, { id: '6715134000000700006', Account_Name: 'Marathon County' }, { id: '6715134000000700007', Account_Name: 'Polk County' }];
    var contacts = [{ id: '6715134000002592199', Full_Name: 'Pat Moreno', Email: 'pmoreno@example.org', Account_Name: { id: '6715134000000700002' } }, { id: '6715134000002592200', Full_Name: 'Lee Okafor', Email: 'lokafor@example.org', Account_Name: { id: '6715134000000700007' } }];
    var parts = [{ Email: 'beau@example.org', name: 'Beau Carrigan', id: '1', type: 'user', participant: me }, { Email: 'pmoreno@example.org', name: 'Pat Moreno', id: '2', type: 'contact', participant: '6715134000002592199' }, { Email: 'guest@example.com', name: 'guest@example.com', id: '3', type: 'email', participant: 'guest@example.com' }];
    var delay = function (v) { return new Promise(function (res, rej) { setTimeout(function () { if (v instanceof Error) rej(v); else res(v); }, 150); }); };
    var ids = function (q) { var m = /id in \(([^)]*)\)/.exec(q); return m ? m[1].split(',').map(function (x) { return x.trim(); }) : null; };
    var like = function (q) { var m = /like '%([^%]*)%'/.exec(q); return m ? m[1].replace(/''/g, "'").toLowerCase() : null; };
    return {
      demo: true, me: me,
      coql: function (q) {
        state.calls.push({ fn: 'coql', q: q, demo: true });
        if (mode === 'err' && / from Events /.test(q)) return delay(new Error('demo failure'));
        var off = +((/offset (\d+)/.exec(q) || [])[1] || 0), out;
        if (/ from Events /.test(q)) out = /Recurring_Activity is not null/.test(q) ? (master ? [master] : []) : off ? [] : rows;
        else if (/ from Accounts /.test(q)) { var ia = ids(q), la = like(q); out = accounts.filter(function (a) { return ia ? ia.indexOf(a.id) >= 0 : la != null && a.Account_Name.toLowerCase().indexOf(la) >= 0; }); }
        else if (/ from Contacts /.test(q)) { var ic = ids(q), lc = like(q); out = contacts.filter(function (c) { return ic ? ic.indexOf(c.id) >= 0 : lc != null && (c.Full_Name + ' ' + c.Email).toLowerCase().indexOf(lc) >= 0; }); }
        else out = [];
        return delay({ rows: out, more: false });
      },
      record: function (m, id) { state.calls.push({ fn: 'getRecord', id: String(id), demo: true }); return delay({ id: id, Participants: id === TEST_EVENT || id === '6715134000010000001' ? parts : [] }); },
      update: function (data) { state.calls.push({ fn: 'updateRecord', data: data, demo: true }); return delay({ data: [{ code: 'SUCCESS', status: 'success', message: 'preview only', details: { id: data.id } }] }); },
      user: function () { return Promise.resolve({ id: me }); }
    };
  }

  root.jpkCalendar = {
    version: VERSION,
    load: load,
    participants: participants,
    link: function (ev, opener) { return openPanel('link', ev, opener); },
    open: function (ev, opener) { return openPanel('detail', ev, opener); },
    close: function () { closePanel(); },
    state: state,
    _model: { joinUrl: joinUrl, joinInfo: joinInfo, parseRule: parseRule, expand: expand, build: build, normalize: normalize, isoLocal: isoLocal, payload: payload, writeAllowed: writeAllowed, writeError: writeError, ruleWords: ruleWords }
  };
})(typeof window !== 'undefined' ? window : this);
