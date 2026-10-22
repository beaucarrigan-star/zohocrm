/* jpk-shell.js v0.1.0 (S24 step 5, 22 Oct 2026): the page frame ("shell") for Beau CS Home, reusable by BD Home and EM Home.
   Spec: S24-LAYOUT-SPEC-APPROVED.md (sections 1 to 5, 7, 8; section 11 decisions win).

   What it does: adds a quick-action row, header counts, a four-step flow strip and a calendar block, then MOVES the page's
   existing sections (by element id only) into three zones: top, main (left) and side (right). It never edits the inside of a
   section: no text, attributes or listeners of an existing section are changed. It reads DOM text and the page's test hooks
   (window.__bd, window.NeedsToday, window.__bdcsUser) and makes no network calls of its own.

   Switch (section 8): JPK_SHELL.enabled (master), then ?shell=0|1 (wins), then localStorage 'jpk-shell-<home>' = 'off'|'on'.
   Off = the script exits before touching the DOM, apart from one footer link to switch back on.

   Globals: window.JPKShell = { config, mount, unmount, calendar, counts, flow, version, lastNav }. Events on window:
   'jpk:mounted', 'jpk:counts'. Storage keys: jpk-shell-*, jpk-flow-<home>-<YYYY-MM-DD>.

   ------------------------------------------------------------------------------------------------------------------------
   CALENDAR DATA INTERFACE (step 6 builds the real one; this file only ships a demo stub)

     window.jpkCalendar.load(range) -> Promise<Array<Event>>

     range = {
       start: Date,      // local midnight of the first day (today 00:00)
       end:   Date,      // local 23:59:59.999 of the last day (today + days - 1)
       days:  Number,    // config calendar.days (7)
       owner: 'me',      // config calendar.owner
       detailCap: Number // config calendar.detailCap (10): how many of today's meetings may get a detail read
     }

     Event = {
       id:        String,          // Zoho Events record id
       title:     String,          // Event_Title
       start:     String | Date,   // ISO 8601 with offset, or a Date
       end:       String | Date,
       allDay:    Boolean,
       venue:     String,          // '' when none
       joinUrl:   String,          // Teams join link, '' when none found
       accountId: String,          // What_Id (Accounts) or ''
       contactId: String,          // Who_Id or ''
       attendees: Array<{ name: String, email: String, contactId: String }>,
       // optional, shown on chips when present:
       accountName: String, contactName: String
     }

     Rejecting the promise means "the read failed" (the calendar shows the failure wording). Resolving [] means "no meetings".
     Optional: window.jpkCalendar.link(event) -> Promise (the link picker, step 6). When absent, "Link to account" is not shown.
     If window.jpkCalendar is already defined when this file runs (step 6 loads first), the stub below is not installed.
     The stub answers with demo events only in preview (no Zoho SDK, or ?preview=1, or ?caldemo=1|empty|err|later|done|slow); in a live
     page without step 6 it rejects, so the calendar never shows made-up meetings.
   ------------------------------------------------------------------------------------------------------------------------ */
(function (root) {
  'use strict';
  var VERSION = '0.1.0';
  var doc = root.document;
  if (!doc) return;

  /* ============================ config ============================ */
  var DEFAULTS = {
    home: 'cs',
    title: 'Beau CS Home',
    enabled: true,
    greeting: '#greeting',
    crmBase: 'https://crm.zoho.com/crm/org882980956/tab/',
    slugs: { Deals: 'Potentials', Contracts: 'CustomModule17' },
    counts: [
      { key: 'meetings', label: 'meetings', from: 'calendar.today', zone: 'calendar' },
      { key: 'needs', label: 'need you', from: 'tiles.sum', zone: '#needs-today' },
      { key: 'due', label: 'due today', from: 'agenda.today', zone: '#agenda-card' },
      { key: 'approve', label: 'to approve', from: 'alerts.approvals', zone: '#z-sm' }
    ],
    actions: [
      { id: 'markRenewed', label: 'Mark renewed', kind: 'view', view: 'renewals60', fallback: { kind: 'tab', module: 'Contracts' }, badge: 'tiles.renewals60', profiles: ['Administrator'], tip: 'Opens CS - Renewals due 60d. Mark each contract renewed on its record.' },
      { id: 'approveCollections', label: 'Approve collections email', kind: 'agendaRecordOrTab', module: 'Collection_Requests', source: 'collections', badge: 'alerts.collections', tip: 'Opens the collection request waiting for approval, or the list when there are several.' },
      { id: 'billingCheck', label: 'Billing check', kind: 'agendaRecordOrCreate', module: 'Billing_Periods', source: 'billing', badge: 'alerts.billing', profiles: ['Administrator'], tip: 'Opens this month\'s billing period, or a new one if it does not exist yet.' },
      { id: 'logLostDevice', label: 'Log lost device', kind: 'href', href: '', hideWhenMissing: true, tip: 'Opens Lost Devices.' },
      { id: 'newMeeting', label: 'New meeting', kind: 'meeting', mode: 'outlook', durationMin: 30, tip: 'Opens a new meeting in Outlook in a new tab.' }
    ],
    zones: {
      top: ['#z-sm'],
      main: ['#needs-today', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel'],
      side: ['jpk:calendar', '#agenda-card', '#z-ref'],
      narrowOrder: ['#z-sm', 'jpk:calendar', '#needs-today', '#agenda-card', '#z-work', '#z-num', '#z-boards', '#dev-panel', '#z-rel', '#z-ref'],
      sideWidth: 'clamp(320px, 30%, 400px)',
      stackPairsBelow: 900,
      narrowBelow: 1101
    },
    calendar: {
      source: 'events', days: 7, owner: 'me', detailCap: 10, link: true, fallback: 'agenda',
      outlookUrl: 'https://outlook.office.com/calendar/view/day',
      help: 'Put a meeting on the Zoho CRM Calendar in Outlook to see it here.'
    },
    flow: [
      { n: 1, label: 'Alerts', count: 'alerts.all', zones: ['#z-sm', '#agenda-card'], tip: 'Stock and collections emails to approve, and overdue items on Today & Upcoming' },
      { n: 2, label: 'Needs you today', count: 'tiles.sum', zones: ['#needs-today'], tip: 'The four tiles' },
      { n: 3, label: 'Meetings and follow-ups', count: 'calendar.open+fu', zones: ['jpk:calendar', '#z-fu'], tip: 'Meetings still ahead today and your follow-ups' },
      { n: 4, label: 'Close out', count: 'cases.mineOpen', zones: ['#z-work'], tip: 'Your open cases. Resolve or close what you finished today.' }
    ],
    seed: { collapse: { 'bd-rel': true } }
  };
  var KNOWN = Object.keys(DEFAULTS);
  var KNOWN_ZONES = Object.keys(DEFAULTS.zones);
  var KNOWN_CAL = Object.keys(DEFAULTS.calendar);

  function warn(msg) { try { root.console && root.console.warn && root.console.warn('[jpk-shell] ' + msg); } catch (e) {} }
  function merge(user) {
    var c = {}, k;
    user = user && typeof user === 'object' ? user : {};
    Object.keys(user).forEach(function (key) { if (KNOWN.indexOf(key) < 0) warn('unknown config key "' + key + '" ignored'); });
    for (k in DEFAULTS) c[k] = Object.prototype.hasOwnProperty.call(user, k) ? user[k] : DEFAULTS[k];
    /* objects merge one level deep so a page can set only what differs */
    c.zones = shallow(DEFAULTS.zones, user.zones, KNOWN_ZONES, 'zones');
    c.calendar = shallow(DEFAULTS.calendar, user.calendar, KNOWN_CAL, 'calendar');
    c.slugs = shallow(DEFAULTS.slugs, user.slugs, null, 'slugs');
    if (!Array.isArray(c.counts)) { warn('counts is not a list; default used'); c.counts = DEFAULTS.counts; }
    if (!Array.isArray(c.actions)) { warn('actions is not a list; default used'); c.actions = DEFAULTS.actions; }
    if (!Array.isArray(c.flow)) { warn('flow is not a list; default used'); c.flow = DEFAULTS.flow; }
    c.home = String(c.home || 'cs').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return c;
  }
  function shallow(def, user, known, name) {
    var o = {}, k;
    for (k in def) o[k] = def[k];
    if (user && typeof user === 'object') for (k in user) { if (known && known.indexOf(k) < 0) warn('unknown ' + name + ' key "' + k + '" ignored'); else o[k] = user[k]; }
    return o;
  }
  var CFG = merge(root.JPK_SHELL);

  /* ============================ small helpers ============================ */
  var $ = function (id) { return doc.getElementById(id); };
  function q(sel) { try { return doc.querySelector(sel); } catch (e) { return null; } }
  function qa(sel, el) { try { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); } catch (e) { return []; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tx(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function mk(tag, cls, attrs) { var n = doc.createElement(tag); if (cls) n.className = cls; if (attrs) for (var a in attrs) n.setAttribute(a, attrs[a]); return n; }
  var store = {
    get: function (k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { root.localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { root.localStorage.removeItem(k); } catch (e) {} },
    keys: function () { try { var out = [], i; for (i = 0; i < root.localStorage.length; i++) out.push(root.localStorage.key(i)); return out; } catch (e) { return []; } }
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = startOfDay(d); x.setDate(x.getDate() + n); return x; }
  function toDate(v) { if (v instanceof Date) return v; var t = Date.parse(v); return isNaN(t) ? null : new Date(t); }
  function hhmm(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function preview() { return /[?&]preview=1/.test(root.location.search) || !root.ZOHO; }
  function param(name) { var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(root.location.search); return m ? decodeURIComponent(m[1]) : null; }
  function reduced() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function scrollTo(el) { if (!el) return; try { el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} } }
  function kick() { try { root.requestAnimationFrame(function () { try { root.dispatchEvent(new Event('resize')); } catch (e) {} }); } catch (e) {} }
  function crmTab(module) { return CFG.crmBase + (CFG.slugs[module] || module); }
  function crmRec(module, id) { return crmTab(module) + '/' + id; }
  function visible(el) { return !!el && !el.hidden && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  /* ============================ the switch (section 8) ============================ */
  var KEY_SWITCH = 'jpk-shell-' + CFG.home;
  function wanted() {
    if (CFG.enabled === false) return false;
    var p = param('shell');
    if (p === '0') return false;
    if (p === '1') return true;
    return store.get(KEY_SWITCH) !== 'off';
  }
  function footerLink(on) {
    var foot = q('#page > footer.foot-note') || q('footer.foot-note');
    if (!foot || foot.querySelector('.jpk-switch')) return;
    var b = mk('button', 'jpk-switch', { type: 'button' });
    b.textContent = on ? 'Switch to the classic layout' : 'Switch to the new layout';
    b.addEventListener('click', function () {
      store.set(KEY_SWITCH, on ? 'off' : 'on');
      /* drop ?shell= so the stored choice applies, then reload */
      var s = root.location.search.replace(/([?&])shell=[01](&|$)/, function (m, a, z) { return z ? a : ''; }).replace(/[?&]$/, '');
      if (s === root.location.search) root.location.reload();
      else root.location.href = root.location.pathname + s + root.location.hash;
    });
    foot.appendChild(doc.createTextNode(' '));
    foot.appendChild(b);
  }

  /* ============================ shared state ============================ */
  var S = {
    mounted: false, page: null, els: {}, moved: [], anchors: [], narrow: null, mq: null,
    user: undefined, userWaited: false,
    cal: { status: 'loading', events: [], error: null, day: null, showWeek: false, collapsed: false },
    counts: {}, flowFuMine: null, flowLastStep: null, timers: [], observers: [], lastCountsSig: '', lastFlowSig: ''
  };
  var JPKShell = root.JPKShell = { config: CFG, version: VERSION, mount: mount, unmount: unmount, lastNav: null, state: S };

  /* ============================ calendar data (stub; see the interface at the top) ============================ */
  function demoEvents() {
    var now = new Date(), t0 = startOfDay(now), at = function (dayOff, h, m, dur) { var s = addDays(t0, dayOff); s.setHours(h, m, 0, 0); return { s: s, e: new Date(s.getTime() + dur * 60000) }; };
    var nextHalf = new Date(now.getTime()); nextHalf.setMinutes(nextHalf.getMinutes() < 30 ? 30 : 60, 0, 0);
    var soon = { s: new Date(nextHalf.getTime() + 25 * 60000 - ((nextHalf - now) % 60000)), e: null };
    soon.s = new Date(now.getTime() + 25 * 60000); soon.s.setSeconds(0, 0); soon.e = new Date(soon.s.getTime() + 30 * 60000);
    var past = { s: new Date(now.getTime() - 3 * 3600000), e: new Date(now.getTime() - 2.5 * 3600000) };
    var later = { s: new Date(now.getTime() + 3 * 3600000), e: new Date(now.getTime() + 4 * 3600000) };
    var ev = function (id, title, w, o) { return Object.assign({ id: id, title: title, start: w.s.toISOString(), end: w.e.toISOString(), allDay: false, venue: '', joinUrl: '', accountId: '', contactId: '', attendees: [] }, o || {}); };
    var list = [
      ev('6715134000010000001', 'Linn County Sheriff: quarterly check-in', past, { venue: 'Microsoft Teams Meeting', accountId: '6715134000000700001', accountName: 'Linn County Sheriff' }),
      ev('6715134000010000002', 'Dane County: GPS spare review', soon, { venue: 'Microsoft Teams Meeting', joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0', accountId: '6715134000000700002', accountName: 'Dane County', contactId: '6715134000000800002', contactName: 'Pat Moreno', attendees: [{ name: 'Pat Moreno', email: 'pmoreno@example.org', contactId: '6715134000000800002' }] }),
      ev('6715134000010000003', 'Collections follow-up with finance', later, { venue: 'Room 2' })
    ];
    var w2 = at(1, 10, 0, 60), w3 = at(3, 14, 0, 30), w4 = at(3, 15, 30, 45);
    list.push(ev('6715134000010000004', 'Polk County renewal call', w2, { venue: 'Microsoft Teams Meeting', joinUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo2%40thread.v2/0' }));
    list.push(ev('6715134000010000005', 'SCRAM vendor sync', w3, {}));
    list.push(ev('6715134000010000006', 'Marathon County onboarding', w4, { accountName: 'Marathon County', accountId: '6715134000000700006' }));
    return list;
  }
  if (!root.jpkCalendar) {
    root.jpkCalendar = {
      stub: true,
      load: function (range) {
        var mode = param('caldemo');
        if (!mode && !preview()) return Promise.reject(new Error('The calendar reader is not installed yet'));
        mode = mode || '1';
        return new Promise(function (ok, no) {
          setTimeout(function () {
            if (mode === 'err') return no(new Error('demo failure'));
            if (mode === 'empty') return ok([]);
            if (mode === 'slow') return;   /* never answers: the loading state */
            var t0 = startOfDay(new Date()), t1 = addDays(t0, 1), now = new Date(), list = demoEvents();
            var isToday = function (e) { var s = toDate(e.start); return s >= t0 && s < t1; };
            if (mode === 'later') list = list.filter(function (e) { return !isToday(e); });                 /* meetings this week, none today */
            if (mode === 'done') list = list.map(function (e) {                                              /* today's meetings all over */
              if (!isToday(e)) return e; var span = now - t0, s = new Date(t0.getTime() + span * 0.2), en = new Date(t0.getTime() + span * 0.4);
              return Object.assign({}, e, { start: s.toISOString(), end: en.toISOString() });
            });
            ok(list.filter(function (e) { var s = toDate(e.start); return s >= range.start && s <= range.end; }));
          }, 250);
        });
      }
    };
  }

  /* ============================ mount / zones (section 1) ============================ */
  function zoneEl(entry) {
    if (entry === 'jpk:calendar') return S.els.cal;
    if (typeof entry !== 'string' || entry.charAt(0) !== '#') { warn('zone entry "' + entry + '" is not an id selector; skipped'); return null; }
    var el = $(entry.slice(1));
    if (!el) warn('zone entry "' + entry + '" matches nothing; skipped');
    return el;
  }
  function remember(el) {
    if (!el || el.__jpkAnchor || el === S.els.cal) return;
    var a = doc.createComment('jpk-shell:' + el.id);
    el.parentNode.insertBefore(a, el);
    el.__jpkAnchor = a; S.anchors.push({ el: el, anchor: a });
  }
  function isNarrow() { return S.mq ? S.mq.matches : root.innerWidth < CFG.zones.narrowBelow; }
  function arrange() {
    var z = CFG.zones, narrow = isNarrow(), act = doc.activeElement, E = S.els;
    S.narrow = narrow;
    var place = function (box, list) { list.forEach(function (entry) { var el = zoneEl(entry); if (!el) return; remember(el); if (box.lastElementChild !== el) box.appendChild(el); }); };
    if (narrow) {
      /* one column; DOM order = visual order, so tab order follows what the eye sees */
      var seen = {};
      var order = (z.narrowOrder || []).concat(z.top, z.main, z.side).filter(function (e) { if (seen[e]) return false; seen[e] = 1; return true; });
      place(E.main, order);
    } else {
      place(E.top, z.top || []); place(E.main, z.main || []); place(E.side, z.side || []);
    }
    doc.documentElement.setAttribute('data-jpk-width', narrow ? 'narrow' : 'wide');
    syncTop();
    if (act && act !== doc.body && act !== doc.activeElement && doc.contains(act)) { try { act.focus({ preventScroll: true }); } catch (e) {} }
    renderCalendar();
    sticky();
    kick();
  }
  function syncTop() {
    var t = S.els.top; if (!t) return;
    t.hidden = !Array.prototype.some.call(t.children, function (c) { return !c.hidden; });
  }
  function sticky() {
    var side = S.els.side; if (!side) return;
    var on = !S.narrow && side.offsetHeight > 0 && side.offsetHeight < root.innerHeight - 16;
    side.classList.toggle('jpk-sticky', on);
  }

  function mount() {
    if (S.mounted) return true;
    var page = S.page = $('page') || q('.page');
    if (!page) { warn('no #page; shell not mounted'); return false; }
    doc.documentElement.setAttribute('data-jpk-shell', 'on');
    doc.documentElement.style.setProperty('--jpk-side-w', CFG.zones.sideWidth);
    var E = S.els;
    E.head = mk('section', 'jpk-head', { 'aria-label': 'Quick actions', id: 'jpk-head' });
    E.qa = mk('div', 'jpk-qa', { role: 'group', 'aria-label': 'Quick actions' });
    E.head.appendChild(E.qa);
    E.flow = mk('nav', 'jpk-flow', { 'aria-label': 'Your day in four steps', id: 'jpk-flow' });
    E.top = mk('div', 'jpk-top jpk-zone hk-edge', { 'data-jpk-zone': 'top' });
    E.cols = mk('div', 'jpk-cols');
    E.main = mk('div', 'jpk-main jpk-zone hk-edge', { 'data-jpk-zone': 'main' });
    E.side = mk('aside', 'jpk-side jpk-zone hk-edge', { 'data-jpk-zone': 'side', 'aria-label': 'Calendar and dated work' });
    E.cols.appendChild(E.main); E.cols.appendChild(E.side);
    E.cal = buildCalendar();

    var bar = page.querySelector(':scope > .quick-actions'), mast = page.querySelector(':scope > .mast');
    var after = bar || mast || null;
    var ins = function (n) { page.insertBefore(n, after ? after.nextSibling : page.firstChild); after = n; };
    ins(E.head); ins(E.flow); ins(E.top); ins(E.cols);

    /* header counts: inside the masthead, under the date line (spec 1.1 / 3) */
    var greet = mast && mast.querySelector('.greet');
    E.counts = mk('p', 'jpk-counts', { 'aria-live': 'polite', id: 'jpk-counts' });
    if (greet) greet.appendChild(E.counts); else ins(E.counts);

    try { S.mq = root.matchMedia('(max-width: ' + (CFG.zones.narrowBelow - 1) + 'px)'); } catch (e) { S.mq = null; }
    if (S.mq) { var onMq = function () { arrange(); refresh(); }; if (S.mq.addEventListener) S.mq.addEventListener('change', onMq); else if (S.mq.addListener) S.mq.addListener(onMq); S.onMq = onMq; }
    root.addEventListener('resize', sticky);
    arrange();
    buildActions();
    buildFlow();
    seedCollapse();
    watch();
    loadCalendar();
    waitUser();
    S.mounted = true;
    refresh();
    footerLink(true);
    try { root.dispatchEvent(new CustomEvent('jpk:mounted', { detail: { home: CFG.home, version: VERSION } })); } catch (e) {}
    return true;
  }

  function unmount() {
    if (!S.mounted) return false;
    S.anchors.slice().reverse().forEach(function (p) { if (p.anchor.parentNode) { p.anchor.parentNode.insertBefore(p.el, p.anchor); p.anchor.parentNode.removeChild(p.anchor); } delete p.el.__jpkAnchor; });
    S.anchors = [];
    ['head', 'flow', 'top', 'cols', 'counts'].forEach(function (k) { var n = S.els[k]; if (n && n.parentNode) n.parentNode.removeChild(n); });
    S.observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); S.observers = [];
    S.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); S.timers = [];
    if (S.mq && S.onMq) { if (S.mq.removeEventListener) S.mq.removeEventListener('change', S.onMq); else if (S.mq.removeListener) S.mq.removeListener(S.onMq); }
    root.removeEventListener('resize', sticky);
    var sw = q('.jpk-switch'); if (sw) { var prev = sw.previousSibling; sw.parentNode.removeChild(sw); if (prev && prev.nodeType === 3 && prev.textContent === ' ') prev.parentNode.removeChild(prev); }
    doc.documentElement.removeAttribute('data-jpk-shell'); doc.documentElement.removeAttribute('data-jpk-width');
    doc.documentElement.style.removeProperty('--jpk-side-w');
    S.mounted = false; S.els = {};
    kick();
    return true;
  }

  /* first visit: Relationships starts collapsed, through the page's own toggle (so its own entry is written); later the browser's choice wins */
  function seedCollapse() {
    var flag = 'jpk-shell-seeded-' + CFG.home, seed = CFG.seed && CFG.seed.collapse;
    if (!seed || store.get(flag)) return;
    var key = (doc.title || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-layout', saved = {};
    try { saved = JSON.parse(store.get(key) || '{}') || {}; } catch (e) { saved = {}; }
    Object.keys(seed).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(saved, k)) return;          /* Beau already chose */
      var tg = q('.hl-tg[data-bdcs="' + k + '"]');
      if (tg && (tg.getAttribute('aria-expanded') === 'true') === !!seed[k]) tg.click();
    });
    store.set(flag, '1');
  }

  /* ============================ data readers (read-only) ============================ */
  function ag() { var b = root.__bd; return b && b.AG && b.AG.data ? b.AG.data : null; }
  function tiles() {
    /* the four "Needs you today" tiles: { key: {n, state} } in HOMES order; state = loading | err | ok */
    var sec = $('needs-today'), out = { list: [], byKey: {} };
    if (!sec || sec.hidden) return null;
    var NT = root.NeedsToday, home = NT && NT.HOMES && NT.HOMES[sec.getAttribute('data-home')];
    var as = qa('.nt-tiles .nt-tile', sec);
    if (!as.length) return null;
    as.forEach(function (a, i) {
      var key = home && home.tiles[i] || ('tile' + i), numEl = a.querySelector('.nt-num'), t = tx(numEl);
      if (NT && NT.viewUrl && home) { /* prefer matching by the list the tile opens */
        home.tiles.forEach(function (k) { var tl = NT.T && NT.T[k]; if (tl && NT.viewUrl(tl.view) === a.getAttribute('href')) key = k; });
      }
      var st = a.classList.contains('err') ? 'err' : a.classList.contains('loading') || !/^\d+$/.test(t) ? 'loading' : 'ok';
      var row = { key: key, n: st === 'ok' ? parseInt(t, 10) : null, state: st };
      out.list.push(row); out.byKey[key] = row;
    });
    return out;
  }
  function tileByView(view) {
    var T = tiles(); if (!T) return null;
    var NT = root.NeedsToday;
    for (var i = 0; i < T.list.length; i++) { var k = T.list[i].key, tl = NT && NT.T && NT.T[k]; if (k === view || (tl && tl.view === view)) return T.list[i]; }
    return null;
  }
  function stockWaiting() { var ul = $('sm-list'); if (!ul) return null; return qa(':scope > li.sm-item', ul).length; }
  function collections() {
    var d = ag(); if (!d) return { state: 'loading' };
    var raw = d.raw && d.raw.collections;
    if (!Array.isArray(raw)) return { state: 'err' };
    var rows = raw.filter(function (r) { return !r.Email_Status || r.Email_Status === 'Awaiting approval'; });
    return { state: 'ok', n: rows.length, rows: rows };
  }
  function billingNow() {
    var d = ag(); if (!d) return { state: 'loading' };
    var raw = d.raw && d.raw.billing;
    if (!Array.isArray(raw)) return { state: 'err' };
    var ym = ymd(new Date()).slice(0, 7);
    var row = raw.filter(function (r) { return periodOf(r.Period || r.Name) === ym; })[0] || null;
    return { state: 'ok', row: row, open: !!row && row.Period_Status !== 'Reconciled' };
  }
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function periodOf(t) {   /* same rule as the agenda's agParsePeriod */
    t = String(t || '').trim().toLowerCase(); var m, i;
    if ((m = t.match(/(\d{4})[-\/](\d{1,2})/))) return m[1] + '-' + pad(+m[2]);
    if ((m = t.match(/(\d{1,2})[-\/](\d{4})/))) return m[2] + '-' + pad(+m[1]);
    for (i = 0; i < 12; i++) if ((m = t.match(new RegExp('\\b' + MONTHS[i] + '[a-z]*\\.?\\s*,?\\s*(\\d{4})')))) return m[1] + '-' + pad(i + 1);
    return null;
  }
  function agendaToday() {
    var d = ag();
    if (d && d.counts && typeof d.counts.today === 'number') return { state: 'ok', n: d.counts.today, errors: d.errors || [] };
    var n = tx(q('#ag-tab-today .n'));
    if (/^\d+$/.test(n)) return { state: 'ok', n: parseInt(n, 10), errors: [] };
    if (d && d.errors && d.errors.length) return { state: 'err', errors: d.errors };
    return { state: 'loading', errors: [] };
  }
  function agendaOverdue() { var d = ag(); if (!d || !Array.isArray(d.items)) return null; return d.items.filter(function (i) { return i.overdue; }).length; }
  function followUps() {
    var mine = q('#fu-scope [data-fuscope="mine"]'), list = $('fu-list');
    if (!list) return S.flowFuMine;
    if (!mine || mine.getAttribute('aria-pressed') === 'true') S.flowFuMine = qa('.row', list).length;
    return S.flowFuMine;
  }
  function myOpenCases() {
    var b = root.__bd, all = b && b.Q && b.Q.all;
    if (Array.isArray(all)) return all.filter(function (r) { return r.__mine && r.Status !== 'Closed' && r.Status !== 'Resolved'; }).length;
    var t = tx($('scope-mine-n'));
    return /^\d+$/.test(t) ? parseInt(t, 10) : null;
  }
  function meetingsLeftToday() {
    if (S.cal.status !== 'ok') return null;
    var now = new Date(), t0 = startOfDay(now), t1 = addDays(now, 1);
    return S.cal.events.filter(function (e) { var s = toDate(e.start), en = toDate(e.end) || s; return s >= t0 && s < t1 && en > now; }).length;
  }

  /* a value: { v: Number|null, dot: Boolean, title: String } ; v null = unknown (shown as —) */
  function value(expr) {
    var parts = String(expr).split('+'), sum = 0, unknown = false, notes = [];
    parts.forEach(function (p) { var r = one(p.trim()); if (r.v == null) unknown = true; else sum += r.v; if (r.title) notes.push(r.title); if (r.dot) notes.dot = true; });
    return { v: unknown ? null : sum, dot: !!notes.dot, title: notes.join(' ') };
  }
  function one(key) {
    var T, r, c;
    switch (key) {
      case 'calendar.today': case 'calendar.open':
        r = meetingsLeftToday();
        return r == null ? { v: null, title: S.cal.status === 'err' ? 'Calendar could not load' : '' } : { v: r };
      case 'tiles.sum':
        T = tiles(); if (!T) return { v: null };
        var bad = T.list.filter(function (x) { return x.state === 'err'; }).length, wait = T.list.some(function (x) { return x.state === 'loading'; });
        if (wait) return { v: null };
        if (bad === T.list.length) return { v: null, title: 'The tiles could not count' };
        var s = 0; T.list.forEach(function (x) { if (x.state === 'ok') s += x.n; });
        return { v: s, dot: bad > 0, title: bad ? bad + (bad === 1 ? ' tile' : ' tiles') + ' could not count' : '' };
      case 'agenda.today':
        r = agendaToday();
        return { v: r.state === 'ok' ? r.n : null, dot: r.state === 'ok' && r.errors.length > 0, title: r.errors.length ? 'Could not read: ' + r.errors.join(', ') + '. The rest is counted.' : '' };
      case 'alerts.approvals':
        var st = stockWaiting(); c = collections();
        if (st == null && c.state !== 'ok') return { v: null };
        var miss = []; if (st == null) miss.push('stock emails'); if (c.state === 'err') miss.push('collections');
        if (c.state === 'loading') return st == null ? { v: null } : { v: null };
        return { v: (st || 0) + (c.state === 'ok' ? c.n : 0), dot: miss.length > 0, title: miss.length ? 'Could not read: ' + miss.join(', ') + '. The rest is counted.' : '' };
      case 'alerts.collections':
        c = collections(); return c.state === 'ok' ? { v: c.n } : { v: null };
      case 'alerts.billing':
        c = billingNow(); return c.state === 'ok' ? { v: c.open ? 1 : 0 } : { v: null };
      case 'alerts.all':
        var a = one('alerts.approvals'), o = agendaOverdue();
        return a.v == null || o == null ? { v: null, title: a.title } : { v: a.v + o, dot: a.dot, title: a.title };
      case 'fu': r = followUps(); return { v: r == null ? null : r };
      case 'cases.mineOpen': r = myOpenCases(); return { v: r };
      case 'boards.selected': return { v: qa('#bwrap input[type=checkbox]:checked').length };
      default:
        if (key.indexOf('tiles.') === 0) { r = tileByView(key.slice(6)); return r && r.state === 'ok' ? { v: r.n } : { v: null }; }
        warn('unknown count "' + key + '"'); return { v: null };
    }
  }

  /* ============================ header counts (section 3) ============================ */
  function countTarget(zone) { return zone === 'calendar' || zone === 'jpk:calendar' ? S.els.cal : zone && zone.charAt(0) === '#' ? $(zone.slice(1)) : null; }
  function renderCounts() {
    var box = S.els.counts; if (!box) return;
    var items = CFG.counts.map(function (c) { var v = value(c.from); return { c: c, v: v }; });
    var sig = JSON.stringify(items.map(function (i) { return [i.v.v, i.v.dot, i.v.title]; }));
    if (sig === S.lastCountsSig) return;
    S.lastCountsSig = sig;
    box.innerHTML = items.map(function (i, n) {
      var shown = i.v.v == null ? '—' : String(i.v.v);
      return (n ? '<span class="jpk-sep" aria-hidden="true"> · </span>' : '') + '<a class="jpk-count' + (i.v.dot ? ' jpk-partial' : '') + '" href="' + esc(i.c.zone && i.c.zone.charAt(0) === '#' ? i.c.zone : '#jpk-cal') + '" data-jpk-count="' + esc(i.c.key) + '"' + (i.v.title ? ' title="' + esc(i.v.title) + '"' : '') + '><b>' + esc(shown) + '</b>' + (i.v.dot ? '<span class="jpk-dot" aria-hidden="true"></span>' : '') + ' ' + esc(i.c.label) + (i.v.title ? '<span class="jpk-sr"> (' + esc(i.v.title) + ')</span>' : '') + '</a>';
    }).join('');
    S.counts = {}; items.forEach(function (i) { S.counts[i.c.key] = i.v.v; });
    JPKShell.counts = S.counts;
    try { root.dispatchEvent(new CustomEvent('jpk:counts', { detail: S.counts })); } catch (e) {}
  }
  function onCountClick(e) {
    var a = e.target.closest && e.target.closest('.jpk-count'); if (!a) return;
    e.preventDefault();
    var c = CFG.counts.filter(function (x) { return x.key === a.getAttribute('data-jpk-count'); })[0];
    var el = c && countTarget(c.zone);
    if (el && el.id === 'z-sm' && el.hidden) el = $('agenda-card');
    goTo(el);
  }
  function goTo(el) {
    if (!el) return;
    if (el.getAttribute('data-collapsed') === 'true') { var tg = el.querySelector('.hl-tg'); if (tg) tg.click(); }
    scrollTo(el);
    var f = el === S.els.cal ? el.querySelector('.jpk-cal-h') : el.querySelector('.hl-tg');
    if (f) { try { f.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ============================ quick actions (section 2) ============================ */
  function profileName() { var u = root.__bdcsUser; return u && u.profile && u.profile.name ? String(u.profile.name) : null; }
  function waitUser() {
    var t0 = Date.now();
    var tick = function () {
      if (root.__bdcsUser !== undefined && (profileName() || root.__bdcsUser === null || Date.now() - t0 > 1500)) { S.userWaited = true; buildActions(); return; }
      if (Date.now() - t0 > 6000) { S.userWaited = true; buildActions(); return; }
      S.timers.push(setTimeout(tick, 200));
    };
    tick();
  }
  function allowed(a) {
    if (!a.profiles) return true;
    var p = profileName();
    return !!p && a.profiles.indexOf(p) >= 0;
  }
  function actionTarget(a) {
    /* -> { href, how: 'top'|'blank'|'create'|'meeting', label } or null when the target is missing */
    var NT = root.NeedsToday, c, rows;
    switch (a.kind) {
      case 'view':
        if (NT && NT.VIEWS && NT.VIEWS[a.view] && NT.viewUrl) return { href: NT.viewUrl(a.view), how: 'top' };
        return a.fallback ? actionTarget(a.fallback) : null;
      case 'tab': return { href: crmTab(a.module), how: 'top' };
      case 'href': return a.href ? { href: a.href, how: a.target === '_blank' ? 'blank' : 'top' } : null;
      case 'create': return { href: crmTab(a.module) + '/create', how: 'create', module: a.module };
      case 'agendaRecordOrTab':
        c = collections();
        if (c.state === 'ok' && c.n === 1 && /^\d+$/.test(String(c.rows[0].id))) return { href: crmRec(a.module, c.rows[0].id), how: 'top' };
        return { href: crmTab(a.module), how: 'top' };
      case 'agendaRecordOrCreate':
        c = billingNow();
        if (c.state === 'ok' && c.row && /^\d+$/.test(String(c.row.id))) return { href: crmRec(a.module, c.row.id), how: 'top' };
        return { href: crmTab(a.module) + '/create', how: 'create', module: a.module };
      case 'meeting': return { href: meetingUrl(a), how: a.mode === 'zoho' ? 'create' : 'meeting', module: 'Events' };
      default: warn('unknown action kind "' + a.kind + '"'); return null;
    }
  }
  function meetingUrl(a) {
    var s = new Date(); s.setSeconds(0, 0); s.setMinutes(s.getMinutes() < 30 ? 30 : 60);
    var e = new Date(s.getTime() + (a.durationMin || 30) * 60000);
    var iso = function (d) { var o = -d.getTimezoneOffset(), sg = o >= 0 ? '+' : '-'; o = Math.abs(o); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00' + sg + pad(Math.floor(o / 60)) + ':' + pad(o % 60); };
    return 'https://outlook.office.com/calendar/deeplink/compose?subject=&startdt=' + encodeURIComponent(iso(s)) + '&enddt=' + encodeURIComponent(iso(e));
  }
  function badgeFor(a) { if (!a.badge) return null; var v = value(a.badge).v; return v ? v : null; }
  function buildActions() {
    var box = S.els.qa; if (!box) return;
    var html = '';
    CFG.actions.forEach(function (a) {
      if (!a || !a.id) return;
      if (!allowed(a)) return;                                   /* profile-gated: hidden until the profile is known */
      var t = actionTarget(a);
      if (!t && a.hideWhenMissing) return;                       /* hidden, not disabled (Log lost device) */
      var b = badgeFor(a);
      html += '<button type="button" class="jpk-qa-btn" data-jpk-action="' + esc(a.id) + '"' + (a.tip ? ' title="' + esc(a.tip) + '"' : '') + '>' + esc(a.label)
        + (b ? '<span class="jpk-badge" aria-label="' + b + ' waiting">' + b + '</span>' : '') + '</button>';
    });
    if (box.__html !== html) { var f = doc.activeElement && box.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-jpk-action') : null; box.innerHTML = html; box.__html = html; if (f) { var nb = box.querySelector('[data-jpk-action="' + f + '"]'); if (nb) nb.focus(); } }
    E_hideHead();
  }
  function E_hideHead() { if (S.els.head) S.els.head.hidden = !S.els.qa.children.length; }
  function navigate(t, a) {
    JPKShell.lastNav = { id: a.id, href: t.href, how: t.how, at: Date.now() };
    if (t.how === 'meeting') return openMeeting(t.href);
    if (preview()) { toast('Would open ' + a.label.toLowerCase() + ': ' + t.href.replace(CFG.crmBase, '') + ' (preview)'); return; }
    if (t.how === 'create') {
      var Z = root.ZOHO, ok = Z && Z.CRM && Z.CRM.UI && Z.CRM.UI.Record && typeof Z.CRM.UI.Record.create === 'function';
      if (ok) { Z.CRM.UI.Record.create({ Entity: t.module }).catch(function () { root.top.location.href = t.href; }); return; }
      root.top.location.href = t.href; return;
    }
    if (t.how === 'blank') { root.open(t.href, '_blank', 'noopener'); return; }
    try { root.top.location.href = t.href; } catch (e) { root.location.href = t.href; }
  }
  function openMeeting(href) {
    var w = null;
    try { w = root.open(href, '_blank'); } catch (e) { w = null; }
    if (w) { try { w.opener = null; } catch (e) {} toast('Put it on the Zoho CRM Calendar in Outlook if you want it to show here.'); }
    else toast('Your browser blocked the new tab. <a href="' + esc(href) + '" target="_blank" rel="noopener">Open the new meeting in Outlook</a>. Put it on the Zoho CRM Calendar in Outlook if you want it to show here.', true);
    JPKShell.lastNav.opened = !!w;
  }
  function onAction(e) {
    var b = e.target.closest && e.target.closest('[data-jpk-action]'); if (!b) return;
    var a = CFG.actions.filter(function (x) { return x.id === b.getAttribute('data-jpk-action'); })[0]; if (!a) return;
    var t = actionTarget(a); if (!t) return;
    navigate(t, a);
  }
  var toastT = 0;
  function toast(msg, html) {
    var t = $('jpk-shell-toast');
    if (!t) { t = mk('div', 'jpk-shell-toast', { id: 'jpk-shell-toast', role: 'status', 'aria-live': 'polite' }); doc.body.appendChild(t); }
    if (html) t.innerHTML = msg; else t.textContent = msg;
    t.hidden = false; clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, html ? 12000 : 5000);
  }

  /* ============================ flow strip (section 4) ============================ */
  function flowKey(d) { return 'jpk-flow-' + CFG.home + '-' + ymd(d || new Date()); }
  function ticks() { try { return JSON.parse(store.get(flowKey()) || '[]') || []; } catch (e) { return []; } }
  function clearOldTicks() { var pre = 'jpk-flow-' + CFG.home + '-', today = flowKey(); store.keys().forEach(function (k) { if (k && k.indexOf(pre) === 0 && k !== today) store.del(k); }); }
  function buildFlow() {
    clearOldTicks();
    var E = S.els;
    E.flow.innerHTML = '<ol class="jpk-steps" aria-live="polite"></ol><p class="jpk-flow-msg" hidden></p>';
    E.flowList = E.flow.querySelector('.jpk-steps'); E.flowMsg = E.flow.querySelector('.jpk-flow-msg');
    E.flowList.innerHTML = CFG.flow.map(function (f) {
      return '<li class="jpk-flow-item" data-jpk-step="' + f.n + '">'
        + '<button type="button" class="jpk-step" data-jpk-step-go="' + f.n + '"' + (f.tip ? ' title="' + esc(f.label + ': ' + f.tip) + '"' : '') + '>'
        + '<span class="jpk-step-n" aria-hidden="true">' + f.n + '</span><span class="jpk-step-l">' + esc(f.label) + '</span>'
        + '<span class="jpk-step-c"></span></button>'
        + '<button type="button" class="jpk-tick" data-jpk-tick="' + f.n + '" aria-pressed="false" aria-label="Mark step ' + f.n + ', ' + esc(f.label) + ', done for today" title="Mark done for today">'
        + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg></button></li>';
    }).join('');
  }
  function renderFlow() {
    var list = S.els.flowList; if (!list) return;
    if (ymd(new Date()) !== S.flowDay) { S.flowDay = ymd(new Date()); clearOldTicks(); }
    var tk = ticks(), cur = null, out = [];
    CFG.flow.forEach(function (f) {
      var v = value(f.count), ticked = tk.indexOf(f.n) >= 0, done = ticked || v.v === 0;
      if (!done && cur == null) cur = f.n;
      out.push({ f: f, v: v, done: done, ticked: ticked });
    });
    var sig = JSON.stringify(out.map(function (o) { return [o.v.v, o.done, o.ticked, o.v.dot]; })) + cur;
    if (sig === S.lastFlowSig) return;
    S.lastFlowSig = sig;
    out.forEach(function (o) {
      var li = list.querySelector('[data-jpk-step="' + o.f.n + '"]'); if (!li) return;
      var btn = li.querySelector('.jpk-step'), c = li.querySelector('.jpk-step-c'), tick = li.querySelector('.jpk-tick');
      var txt = o.done ? 'Done' : o.v.v == null ? '—' : String(o.v.v);
      c.textContent = txt;
      li.classList.toggle('jpk-done', o.done); li.classList.toggle('jpk-unknown', !o.done && o.v.v == null);
      if (cur === o.f.n) { btn.setAttribute('aria-current', 'step'); li.classList.add('jpk-current'); } else { btn.removeAttribute('aria-current'); li.classList.remove('jpk-current'); }
      btn.setAttribute('aria-label', 'Step ' + o.f.n + ', ' + o.f.label + ': ' + (o.done ? 'done' : o.v.v == null ? 'count not known yet' : o.v.v + ' to do') + '. Go there.');
      tick.setAttribute('aria-pressed', String(o.ticked));
    });
    var all = out.every(function (o) { return o.done; });
    S.els.flowMsg.hidden = !all;
    S.els.flowMsg.textContent = all ? 'All four steps clear for today.' : '';
    S.els.flow.classList.toggle('jpk-all-done', all);
  }
  function onFlow(e) {
    var t = e.target.closest && e.target.closest('[data-jpk-tick],[data-jpk-step-go]'); if (!t) return;
    if (t.hasAttribute('data-jpk-tick')) {
      var n = +t.getAttribute('data-jpk-tick'), tk = ticks(), i = tk.indexOf(n);
      if (i >= 0) tk.splice(i, 1); else tk.push(n);
      store.set(flowKey(), JSON.stringify(tk)); S.lastFlowSig = ''; renderFlow(); return;
    }
    var f = CFG.flow.filter(function (x) { return x.n === +t.getAttribute('data-jpk-step-go'); })[0]; if (!f) return;
    var again = S.flowLastStep === f.n; S.flowLastStep = f.n;
    var target = null, zones = f.zones || [];
    if (f.n === 3 && again && zones[1]) target = zoneEl(zones[1]);
    else {
      for (var j = 0; j < zones.length; j++) { var el = zoneEl(zones[j]); if (el && visible(el)) { target = el; break; } }
    }
    if (!target) return;
    if (target.id === 'agenda-card') { var tt = $('ag-tab-today'); if (tt && tt.getAttribute('aria-selected') !== 'true') tt.click(); }
    if (target === S.els.cal && S.narrow) { var up = target.querySelector('.jpk-upnext'); scrollTo(up || target); var h = target.querySelector('.jpk-cal-h'); if (h) h.focus({ preventScroll: true }); return; }
    goTo(target);
  }

  /* ============================ calendar block ============================ */
  function buildCalendar() {
    var c = mk('section', 'jpk-cal card', { id: 'jpk-cal', 'aria-labelledby': 'jpk-cal-h' });
    c.innerHTML = '<div class="head jpk-cal-head"><h2 id="jpk-cal-h" class="jpk-cal-h" tabindex="-1">Calendar</h2>'
      + '<span class="meta jpk-cal-meta"></span>'
      + '<button type="button" class="jpk-tg" aria-expanded="true" aria-controls="jpk-cal-body" title="Hide Calendar" aria-label="Hide Calendar"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6"/></svg></button></div>'
      + '<div class="jpk-cal-body" id="jpk-cal-body">'
      + '<div class="jpk-upnext" aria-live="polite"></div>'
      + '<button type="button" class="jpk-showweek" aria-expanded="false" aria-controls="jpk-cal-more">Show week</button>'
      + '<div class="jpk-cal-more" id="jpk-cal-more">'
      + '<h3 class="jpk-day-h"></h3><ul class="jpk-day-list"></ul>'
      + '<div class="jpk-week" role="group" aria-label="This week"></div>'
      + '<p class="jpk-cal-foot"><a class="jpk-ol" target="_blank" rel="noopener">Open Outlook</a></p>'
      + '</div></div>';
    c.querySelector('.jpk-ol').href = CFG.calendar.outlookUrl;
    S.cal.collapsed = store.get('jpk-shell-' + CFG.home + '-cal') === 'collapsed';
    c.addEventListener('click', onCal);
    return c;
  }
  function loadCalendar() {
    if (CFG.calendar.source === 'none') { S.cal.status = 'ok'; S.cal.events = []; renderCalendar(); return; }
    var now = new Date(), range = { start: startOfDay(now), end: new Date(addDays(now, CFG.calendar.days).getTime() - 1), days: CFG.calendar.days, owner: CFG.calendar.owner, detailCap: CFG.calendar.detailCap };
    S.cal.status = 'loading'; renderCalendar();
    var p;
    try { p = Promise.resolve(root.jpkCalendar && root.jpkCalendar.load ? root.jpkCalendar.load(range) : Promise.reject(new Error('no calendar'))); } catch (e) { p = Promise.reject(e); }
    p.then(function (list) {
      S.cal.events = (Array.isArray(list) ? list : []).filter(function (e) { return e && toDate(e.start); }).sort(function (a, b) { return toDate(a.start) - toDate(b.start); });
      S.cal.status = 'ok';
    }, function (e) { S.cal.status = 'err'; S.cal.error = e; S.cal.events = []; })
      .then(function () { renderCalendar(); refresh(); });
  }
  JPKShell.calendar = { reload: loadCalendar, state: S.cal };
  function eventsOn(day) { var a = startOfDay(day), b = addDays(day, 1); return S.cal.events.filter(function (e) { var s = toDate(e.start); return s >= a && s < b; }); }
  function relTime(s, e, now) {
    if (s <= now && e > now) return 'now';
    var m = Math.round((s - now) / 60000);
    if (m < 60) return 'in ' + Math.max(1, m) + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return 'in ' + h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function agendaFirstToday() {
    var d = ag(); if (!d || !Array.isArray(d.items)) return null;
    return d.items.filter(function (i) { return i.bucket === 'today'; })[0] || null;   /* the card's own sort order */
  }
  function renderCalendar() {
    var c = S.els.cal; if (!c) return;
    var now = new Date(), st = S.cal.status, today = startOfDay(now);
    c.classList.toggle('jpk-collapsed', S.cal.collapsed);
    var tg = c.querySelector('.jpk-tg'); tg.setAttribute('aria-expanded', String(!S.cal.collapsed)); tg.title = (S.cal.collapsed ? 'Show' : 'Hide') + ' Calendar'; tg.setAttribute('aria-label', tg.title);
    c.querySelector('.jpk-cal-body').hidden = S.cal.collapsed;
    var meta = c.querySelector('.jpk-cal-meta');
    var todays = st === 'ok' ? eventsOn(now) : [];
    meta.textContent = st === 'ok' ? (todays.length ? todays.length + (todays.length === 1 ? ' meeting today' : ' meetings today') : '') : st === 'loading' ? 'loading' : '';

    /* up next */
    var up = c.querySelector('.jpk-upnext'), html;
    if (st === 'loading') html = '<p class="jpk-cal-empty">Loading meetings…</p>';
    else {
      var next = st === 'ok' ? todays.filter(function (e) { return !e.allDay && (toDate(e.end) || toDate(e.start)) > now; })[0] : null;
      if (next) html = upNextHtml(next, now);
      else if (st === 'ok' && todays.some(function (e) { return !e.allDay; })) html = '<p class="jpk-cal-empty">No more meetings today.</p>';
      else {
        var fb = CFG.calendar.fallback === 'agenda' ? agendaFirstToday() : null;
        html = fb ? '<div class="jpk-up jpk-up-fb"><p class="jpk-up-k">Next up · from Today &amp; Upcoming</p><p class="jpk-up-t">' + esc(fb.title) + '</p>' + (fb.account ? '<p class="jpk-up-s">' + esc(fb.account) + '</p>' : '')
          + '<div class="jpk-up-acts"><button type="button" class="jpk-btn" data-jpk-agk="' + esc(fb.src + ':' + fb.id) + '">Open</button></div></div>'
          : '<p class="jpk-cal-empty">Nothing scheduled. Your day is open.</p>';
      }
    }
    if (up.__html !== html) { up.innerHTML = html; up.__html = html; }

    /* day list + week strip */
    var more = c.querySelector('.jpk-cal-more'), sw = c.querySelector('.jpk-showweek');
    sw.hidden = !S.narrow;
    more.hidden = S.narrow && !S.cal.showWeek;
    sw.setAttribute('aria-expanded', String(!more.hidden));
    sw.textContent = more.hidden ? 'Show week' : 'Hide week';
    if (!S.cal.day) S.cal.day = ymd(today);
    var sel = new Date(S.cal.day + 'T12:00:00'), isToday = S.cal.day === ymd(today);
    c.querySelector('.jpk-day-h').textContent = isToday ? 'Today' : sel.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    var ul = c.querySelector('.jpk-day-list'), lh;
    if (st === 'loading') lh = '<li class="jpk-cal-empty">Loading…</li>';
    else if (st === 'err') lh = '<li class="jpk-cal-empty jpk-cal-err" role="status">Calendar could not load. Reload the page to try again.</li>';
    else if (!S.cal.events.length) lh = '<li class="jpk-cal-empty">No meetings synced. ' + esc(CFG.calendar.help) + ' <a class="jpk-ol" href="' + esc(CFG.calendar.outlookUrl) + '" target="_blank" rel="noopener">Open Outlook</a></li>';
    else {
      var ev = eventsOn(sel);
      lh = ev.length ? ev.map(function (e) { return rowHtml(e, now); }).join('') : '<li class="jpk-cal-empty">' + (isToday ? 'No meetings today.' : 'Nothing on this day.') + '</li>';
    }
    if (ul.__html !== lh) { ul.innerHTML = lh; ul.__html = lh; }
    var wk = c.querySelector('.jpk-week'), wh = '';
    for (var i = 0; i < CFG.calendar.days; i++) {
      var d = addDays(today, i), k = ymd(d), n = st === 'ok' ? eventsOn(d).length : 0;
      wh += '<button type="button" class="jpk-daychip" data-jpk-day="' + k + '" aria-pressed="' + (k === S.cal.day) + '" aria-label="' + esc(d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ': ' + (st === 'ok' ? n + (n === 1 ? ' meeting' : ' meetings') : 'not loaded')) + '">'
        + '<span class="jpk-dc-w">' + (i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' })) + '</span><span class="jpk-dc-d">' + d.getDate() + '</span>'
        + '<span class="jpk-dc-n" aria-hidden="true">' + (n ? new Array(Math.min(n, 3) + 1).join('<i></i>') : '') + '</span></button>';
    }
    if (wk.__html !== wh) { var f = doc.activeElement && wk.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-jpk-day') : null; wk.innerHTML = wh; wk.__html = wh; if (f) { var nb = wk.querySelector('[data-jpk-day="' + f + '"]'); if (nb) nb.focus(); } }
  }
  function timeRange(e) {
    if (e.allDay) return 'All day';
    var s = toDate(e.start), en = toDate(e.end);
    return hhmm(s) + (en ? ' to ' + hhmm(en) : '');
  }
  function rowHtml(e, now) {
    var en = toDate(e.end) || toDate(e.start), past = !e.allDay && en <= now;
    return '<li class="jpk-ev' + (past ? ' jpk-past' : '') + '"><span class="jpk-ev-time">' + esc(timeRange(e)) + '</span><span class="jpk-ev-t">' + esc(e.title || '(no title)') + (e.venue ? '<span class="jpk-ev-v">' + esc(e.venue) + '</span>' : '') + '</span>'
      + (e.joinUrl && !past ? '<a class="jpk-btn jpk-join" href="' + esc(e.joinUrl) + '" target="_blank" rel="noopener" aria-label="Join ' + esc(e.title) + '">Join</a>' : '') + '</li>';
  }
  function upNextHtml(e, now) {
    var s = toDate(e.start), en = toDate(e.end) || s, rel = relTime(s, en, now);
    var chips = '';
    if (e.accountId) chips += '<a class="jpk-chip" target="_top" href="' + esc(crmRec('Accounts', e.accountId)) + '">' + esc(e.accountName || 'Account') + '</a>';
    if (e.contactId) chips += '<a class="jpk-chip" target="_top" href="' + esc(crmRec('Contacts', e.contactId)) + '">' + esc(e.contactName || 'Contact') + '</a>';
    var canLink = CFG.calendar.link && root.jpkCalendar && typeof root.jpkCalendar.link === 'function';
    if (!chips && canLink) chips = '<button type="button" class="jpk-btn" data-jpk-link="' + esc(e.id) + '">Link to account</button>';
    return '<div class="jpk-up"><p class="jpk-up-k">Up next <span class="jpk-up-rel' + (rel === 'now' ? ' jpk-now' : '') + '">' + esc(rel) + '</span></p>'
      + '<p class="jpk-up-t">' + esc(e.title || '(no title)') + '</p><p class="jpk-up-s">' + esc(timeRange(e)) + (e.venue ? ' · ' + esc(e.venue) : '') + '</p>'
      + (chips ? '<div class="jpk-chips">' + chips + '</div>' : '')
      + '<div class="jpk-up-acts">' + (e.joinUrl ? '<a class="jpk-btn jpk-primary" href="' + esc(e.joinUrl) + '" target="_blank" rel="noopener">Join</a>' : '')
      + '<a class="jpk-btn" target="_top" href="' + esc(crmRec('Events', e.id)) + '">Open in Zoho</a>'
      + '<a class="jpk-btn" target="_blank" rel="noopener" href="' + esc(CFG.calendar.outlookUrl) + '">Open in Outlook</a></div></div>';
  }
  function onCal(e) {
    var t = e.target.closest ? e.target : null; if (!t) return;
    var b;
    if ((b = t.closest('.jpk-tg'))) { S.cal.collapsed = !S.cal.collapsed; store.set('jpk-shell-' + CFG.home + '-cal', S.cal.collapsed ? 'collapsed' : 'open'); renderCalendar(); kick(); return; }
    if ((b = t.closest('.jpk-showweek'))) { S.cal.showWeek = !S.cal.showWeek; renderCalendar(); kick(); return; }
    if ((b = t.closest('[data-jpk-day]'))) { S.cal.day = b.getAttribute('data-jpk-day'); renderCalendar(); return; }
    if ((b = t.closest('[data-jpk-link]'))) { var ev = S.cal.events.filter(function (x) { return String(x.id) === b.getAttribute('data-jpk-link'); })[0]; if (ev) Promise.resolve(root.jpkCalendar.link(ev)).then(loadCalendar, function () {}); return; }
    if ((b = t.closest('[data-jpk-agk]'))) {
      var k = b.getAttribute('data-jpk-agk'), tt = $('ag-tab-today');
      if (tt && tt.getAttribute('aria-selected') !== 'true') tt.click();
      var row = null; qa('#ag-list [data-agk]').forEach(function (r) { if (r.getAttribute('data-agk') === k) row = r; });
      JPKShell.lastNav = { id: 'agendaFallback', key: k, at: Date.now() };
      if (row) row.click(); else goTo($('agenda-card'));
      return;
    }
    if (preview() && (b = t.closest('a[target="_top"]'))) { e.preventDefault(); JPKShell.lastNav = { id: 'calendarLink', href: b.href, how: 'top', at: Date.now() }; toast('Would open ' + b.textContent + ' (preview)'); }
  }

  /* ============================ watching (reads only) ============================ */
  var refreshT = 0;
  function refresh() { if (!S.els.counts) return; renderCounts(); renderFlow(); buildActions(); syncTop(); renderCalendar(); }
  function soon() { clearTimeout(refreshT); refreshT = setTimeout(refresh, 120); }
  function watch() {
    ['needs-today', 'sm-list', 'fu-list', 'ag-list', 'scope-mine-n', 'z-sm', 'bwrap', 'fu-scope'].forEach(function (id) {
      var el = $(id); if (!el) return;
      try { var o = new MutationObserver(soon); o.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'aria-pressed'] }); S.observers.push(o); } catch (e) {}
    });
    /* __bd.AG.data has no event: look every 500 ms for 30 s, then every 5 s (writes only when a figure changes) */
    var t0 = Date.now(), poll = function () { refresh(); S.timers.push(setTimeout(poll, Date.now() - t0 < 30000 ? 500 : 5000)); };
    S.timers.push(setTimeout(poll, 500));
    /* the clock: "in 25 min" and meetings that just ended */
    S.timers.push(setInterval(function () { renderCalendar(); refresh(); }, 30000));
    S.els.counts.addEventListener('click', onCountClick);
    S.els.qa.addEventListener('click', onAction);
    S.els.flow.addEventListener('click', onFlow);
  }

  /* ============================ boot ============================ */
  function boot() {
    if (!wanted()) { footerLink(false); return; }
    mount();
  }
  JPKShell.flow = { render: function () { S.lastFlowSig = ''; renderFlow(); }, key: flowKey };
  JPKShell.counts = {};
  JPKShell._value = value;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : this);
