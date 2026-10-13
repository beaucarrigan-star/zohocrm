/* Supply flow: pure logic (no DOM, no Zoho). Works in browser (window.SupplyModel) and node (require).
   Merges the Equipment flow and the Stock and accessories flow into one path, and adds the accessory-history checks.
   It does not re-implement either: it calls EquipModel.build and StockFlowModel.build on the same data and joins their lanes,
   so a rule changed in one model changes here too. Lanes that would show the same records twice are dropped (see DROPPED).
   data = { orders (all types), cases, alerts, counts, returns, recs, ships } raw COQL rows.
   opts = { days, leadBD, track ('all'|'devices'|'accessories'|'returns'), alertLink, shipLink, detail, returnsAvailable } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./triage-model.js'), require('./equip-model.js'), require('./stock-flow-model.js'));
  else root.SupplyModel = factory(root.TriageModel, root.EquipModel, root.StockFlowModel);
})(typeof self !== 'undefined' ? self : this, function (TM, EQ, ST) {
  'use strict';

  var DAY = 86400000;
  /* The accessory alerts are computed from the imported order history. If the newest shipment in it is older than this,
     the alerts are working from stale numbers. A starting guess, not a rule; the page says so. */
  var HISTORY_STALE_DAYS = 14;
  var HISTORY_MONTHS = 12;
  var TRACKS = [{ id: 'all', label: 'All' }, { id: 'devices', label: 'Devices' }, { id: 'accessories', label: 'Accessories' }, { id: 'returns', label: 'Returns' }];
  /* Lanes in the two source models that this page does not show, and why. */
  var DROPPED = {
    'n-alerts': 'same alerts as Device stock alerts',
    'a-returns': 'returns are shown once, in the field and returns step',
    'f-ret-recv': 'stock copy: the equipment copy lists every open return that has been received',
    'a-orders': 'device orders are in Placed, not received; accessory orders get their own lane'
  };

  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* What a record is about, for the Track filter. */
  function trackOf(item, stModel) {
    switch (item.kind) {
      case 'case': case 'family': return 'devices';
      case 'return': return 'returns';
      case 'rec': case 'ship': case 'hist': case 'hist-acct': return 'accessories';
      case 'alert': {
        var a = stModel.alertById[item.id];
        if (!a) return 'devices';
        return a.kind === 'excess' ? 'returns' : a.kind === 'accessory' ? 'accessories' : 'devices';
      }
      case 'order': {
        if (item.src === 'eq') return 'devices';
        var o = stModel.orderById[item.id];
        return o && o.type !== 'Devices' ? 'accessories' : 'devices';
      }
      default: return 'devices';
    }
  }

  /* ---------- accessory history ---------- */
  /* The accessory alerts and due dates come from the imported shipment history. This reads that history back:
     how much is there, how new, which accounts are in it without a recommendation and which recommendations have none behind them. */
  function history(ships, recs, now) {
    var rows = (ships || []).map(function (r) { var a = lk(r.Account); return { ms: toMs(r.Ship_Date), accountId: a.id, accountName: a.name || r.Allied_Customer || '' }; })
      .filter(function (s) { return s.ms != null; });
    var newest = rows.reduce(function (m, s) { return s.ms > m ? s.ms : m; }, 0) || null;
    var oldest = rows.reduce(function (m, s) { return m == null || s.ms < m ? s.ms : m; }, null);
    var ageDays = newest == null ? null : Math.max(0, Math.floor((now - newest) / DAY));
    var stale = newest == null || ageDays > HISTORY_STALE_DAYS;
    var byAcct = {}, byMonth = {};
    rows.forEach(function (s) {
      var k = s.accountId || ('n:' + s.accountName);
      var x = byAcct[k] || (byAcct[k] = { accountId: s.accountId, accountName: s.accountName, n: 0, lastMs: 0 });
      x.n++; if (s.ms > x.lastMs) x.lastMs = s.ms;
      var m = ymd(s.ms).slice(0, 7), y = byMonth[m] || (byMonth[m] = { key: m, n: 0, accts: {} });
      y.n++; y.accts[k] = true;
    });
    var recAccts = {};
    (recs || []).forEach(function (r) { var a = lk(r.Account); if (a.id) recAccts[a.id] = true; });
    var noRec = Object.keys(byAcct).map(function (k) { return byAcct[k]; }).filter(function (x) { return x.accountId && !recAccts[x.accountId]; })
      .sort(function (a, b) { return b.lastMs - a.lastMs; });
    var shipAccts = {}; rows.forEach(function (s) { if (s.accountId) shipAccts[s.accountId] = true; });
    var noShip = (recs || []).map(function (r) { return { id: r.id, accountId: lk(r.Account).id }; }).filter(function (r) { return r.accountId && !shipAccts[r.accountId]; });
    var months = Object.keys(byMonth).sort().reverse().slice(0, HISTORY_MONTHS);
    return { count: rows.length, newestMs: newest, oldestMs: oldest, ageDays: ageDays, stale: stale, noRec: noRec, noShipRecIds: noShip.map(function (r) { return r.id; }),
      months: months.map(function (k) { return byMonth[k]; }), accounts: Object.keys(byAcct).length };
  }
  function monthItem(m, stale, first) {
    var y = +m.key.slice(0, 4), mo = +m.key.slice(5, 7);
    var n = Object.keys(m.accts).length;
    return { kind: 'hist', id: 'h-' + m.key, src: 'h', title: MONTHS[mo - 1] + ' ' + y, sub: n + (n === 1 ? ' account' : ' accounts'), accountId: null, accountName: '',
      ms: Date.UTC(y, mo - 1, 15), age: null, ageText: '', state: plural(m.n, 'shipment'), tone: first && stale ? 'warn' : 'neutral',
      note: first && stale ? 'This is the newest month loaded. Newer shipments have not been imported.' : '' };
  }
  function acctItem(x, now) {
    var days = Math.floor((now - x.lastMs) / DAY);
    return { kind: 'hist-acct', id: 'ha-' + (x.accountId || x.accountName), src: 'h', title: x.accountName || 'Account', sub: plural(x.n, 'shipment') + ' in the history, last ' + ymd(x.lastMs),
      accountId: x.accountId, accountName: x.accountName, ms: x.lastMs, age: days, ageText: plural(days, 'day'), state: 'No recommendation', tone: 'warn',
      note: 'This account orders accessories but has no recommendation, so no alert can be raised for it.' };
  }

  /* ---------- build ---------- */
  function build(data, now, opts) {
    opts = opts || {}; data = data || {};
    var track = opts.track || 'all';
    var eq = EQ.build({ orders: data.orders, cases: data.cases, alerts: data.alerts, counts: data.counts, returns: data.returns }, now,
      { days: opts.days, leadBD: opts.leadBD, alertLink: opts.alertLink, detail: opts.detail, returnsAvailable: opts.returnsAvailable });
    var st = ST.build({ alerts: data.alerts, recs: data.recs, orders: data.orders, returns: data.returns, ships: data.ships }, now,
      { days: opts.days, alertLink: opts.alertLink, shipLink: opts.shipLink, returnsAvailable: opts.returnsAvailable });
    var hist = history(data.ships, data.recs, now);

    var L = {};
    function take(model, src, id, stage, over) {
      var l = model.lanes[id]; if (!l) return;
      var copy = {}; for (var k in l) copy[k] = l[k];
      copy.stage = stage; copy.items = l.items.slice();
      if (over) for (var o in over) copy[o] = over[o];
      copy.items.forEach(function (i) { i.src = src; });
      L[id] = copy;
    }
    function own(id, stage, label, items, tone, hint, kind) {
      L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind, items: items };
    }
    var EQN = ['n-cases', 'o-placed', 'o-late', 'o-noref', 'r-house', 'r-noserial', 'r-mismatch', 'r-short', 's-out', 's-caseopen', 'f-counts', 'f-ret-open', 'f-ret-stale', 'f-ret-recv'];
    var eqStage = { 'n-cases': 1, 'o-placed': 3, 'o-late': 3, 'o-noref': 3, 'r-house': 4, 'r-noserial': 4, 'r-mismatch': 4, 'r-short': 4, 's-out': 4, 's-caseopen': 4, 'f-counts': 5, 'f-ret-open': 5, 'f-ret-stale': 5, 'f-ret-recv': 5 };
    var STN = ['s-dev', 's-acc', 's-exc', 's-rec', 'd-approve', 'd-action', 'd-wait', 'd-rec', 'd-chase', 'd-nocontact', 'd-stillseen', 'd-norecip', 'd-rejected', 'a-exc-none', 'a-order-none', 'a-rec-none', 'f-ship', 'f-ship-nolink', 'z-done', 'z-dismissed', 'z-rej-exc', 'z-rec-ok'];
    var stStage = { 's-dev': 1, 's-acc': 1, 's-exc': 1, 's-rec': 1, 'a-exc-none': 3, 'a-order-none': 3, 'a-rec-none': 3, 'f-ship': 4, 'f-ship-nolink': 4, 'z-done': 5, 'z-dismissed': 5, 'z-rej-exc': 5, 'z-rec-ok': 5 };
    EQN.forEach(function (id) { take(eq, 'eq', id, eqStage[id]); });
    STN.forEach(function (id) { take(st, 'st', id, stStage[id] || 2); });
    L['o-placed'].label = 'Device orders placed, not received';
    L['o-late'].label = 'Device orders over the lead-time limit';

    /* accessory orders: the stock model's order lanes, accessories only */
    var notDev = function (i) { var o = st.orderById[i.id]; return o && o.type !== 'Devices'; };
    var accPlaced = st.lanes['a-orders'].items.filter(notDev), accRecv = st.lanes['f-recv'].items.filter(notDev);
    accPlaced.forEach(function (i) { i.src = 'st'; }); accRecv.forEach(function (i) { i.src = 'st'; });
    own('x-orders', 3, 'Accessory orders placed, not received', accPlaced, 'neutral', 'from a recommendation or alert', 'order');
    own('x-recv', 4, 'Accessory orders received', accRecv, 'good', 'in this window', 'order');

    /* accessory history */
    var hItems = hist.months.map(function (m, i) { return monthItem(m, hist.stale, i === 0); });
    var hHint = hist.count === 0 ? 'No shipments loaded: accessory due dates and alerts have nothing to work from'
      : 'newest ' + ymd(hist.newestMs) + ', ' + plural(hist.ageDays, 'day') + ' old' + (hist.stale ? ', older than ' + HISTORY_STALE_DAYS + ' days' : '');
    own('h-fresh', 1, 'Accessory order history loaded', hItems, hist.stale ? 'warn' : 'good', hHint, 'hist');
    L['h-fresh'].count = hist.count; L['h-fresh'].tone = hist.stale ? 'warn' : 'good';
    own('h-norec', 1, 'Ordering accessories, no recommendation', hist.noRec.map(function (x) { return acctItem(x, now); }), 'warn',
      hist.noRec.length ? 'in the history but nothing watches them' : 'None found', 'hist-acct');
    var noShipItems = hist.noShipRecIds.map(function (id) {
      var c = st.recById[id]; if (!c) return null;
      return { kind: 'rec', id: c.id, src: 'st', title: 'Accessories - ' + c.accountName, sub: [c.status, c.suggested ? 'Suggested ' + c.suggested : ''].filter(Boolean).join(' / '),
        accountId: c.accountId, accountName: c.accountName, ms: c.nextMs, age: null, ageText: '', state: c.status, tone: 'warn', recId: c.id,
        note: 'No shipment for this account in the loaded history, so the due date has nothing behind it.' };
    }).filter(Boolean);
    own('h-noship', 1, 'Recommendation with no shipment history', noShipItems, 'warn', noShipItems.length ? 'due dates with nothing behind them' : 'None found', 'rec');

    /* Track filter: keep the lane, drop the records that are about something else, recount. */
    var laneList = Object.keys(L);
    if (track !== 'all') {
      laneList.forEach(function (id) {
        var l = L[id];
        if (l.kind === 'hist') return;           /* the history is about accessories; its months are not records to filter */
        l.items = l.items.filter(function (i) { return trackOf(i, st) === track; });
        l.count = l.items.length; if (!l.count) l.tone = 'neutral';
      });
      if (track !== 'accessories') { L['h-fresh'].count = 0; L['h-fresh'].items = []; L['h-fresh'].tone = 'neutral'; }
    }
    var c = function (ids) { return ids.reduce(function (n, id) { return n + (L[id] ? L[id].count : 0); }, 0); };
    var S = [
      { n: 1, title: 'Signal and need', lanes: ['s-dev', 's-acc', 's-exc', 's-rec', 'n-cases', 'h-fresh', 'h-norec', 'h-noship'], bigIds: ['s-dev', 's-acc', 's-exc', 's-rec', 'n-cases'], bigLabel: 'open alerts, requests and accessory orders due' },
      { n: 2, title: 'Decision', lanes: ['d-approve', 'd-action', 'd-wait', 'd-rec', 'd-chase', 'd-nocontact', 'd-stillseen', 'd-norecip', 'd-rejected'], bigIds: ['d-approve', 'd-action', 'd-chase', 'd-nocontact'], bigLabel: 'waiting on a person' },
      { n: 3, title: 'Ordered', lanes: ['o-placed', 'o-late', 'o-noref', 'x-orders', 'a-exc-none', 'a-order-none', 'a-rec-none'], bigIds: ['o-placed', 'x-orders'], bigLabel: 'orders placed, not received' },
      { n: 4, title: 'Received and out', lanes: ['r-house', 'r-noserial', 'r-mismatch', 'r-short', 'x-recv', 's-out', 's-caseopen', 'f-ship', 'f-ship-nolink'], bigIds: ['r-house', 's-out', 'x-recv', 'f-ship'], bigLabel: 'received or shipped in this window' },
      { n: 5, title: 'Field, returns and closed', lanes: ['f-counts', 'f-ret-open', 'f-ret-stale', 'f-ret-recv', 'z-done', 'z-dismissed', 'z-rej-exc', 'z-rec-ok'], bigIds: ['f-ret-open'], bigLabel: 'returns open' }
    ];
    var stages = S.map(function (s) {
      var big = c(s.bigIds);
      return { n: s.n, title: s.title, big: big, bigLabel: s.bigLabel, lanes: s.lanes };
    });
    laneList.forEach(function (id) { var n = 0; stages.forEach(function (s) { if (s.lanes.indexOf(id) >= 0) n = s.n; }); L[id].stage = n || L[id].stage; });

    /* stuck: both models' lists, minus dropped lanes, deduped by lane */
    var stuck = [], seen = {};
    eq.stuck.concat(st.stuck).forEach(function (s) {
      if (DROPPED[s.lane] || seen[s.lane] || !L[s.lane]) return;
      seen[s.lane] = true; stuck.push({ lane: s.lane, tone: s.tone, text: s.text });
    });
    if (hist.stale) stuck.unshift({ lane: 'h-fresh', tone: 'warn', text: hist.count === 0 ? 'no accessory order history is loaded, so accessory alerts cannot run' : 'the accessory order history is ' + plural(hist.ageDays, 'day') + ' old, so accessory alerts are working from old numbers' });
    if (hist.noRec.length) stuck.push({ lane: 'h-norec', tone: 'warn', text: plural(hist.noRec.length, 'account') + ' ordering accessories with no recommendation' });
    if (hist.noShipRecIds.length) stuck.push({ lane: 'h-noship', tone: 'warn', text: plural(hist.noShipRecIds.length, 'recommendation') + ' with no shipment history behind it' });
    if (track !== 'all') {
      stuck = stuck.filter(function (s) { return L[s.lane].count > 0; }).map(function (s) {
        var l = L[s.lane]; return { lane: s.lane, tone: s.tone, text: l.kind === 'hist' ? s.text : plural(l.count, 'item') + ' in “' + l.label + '”' };
      });
    }

    return { now: now, days: eq.days, leadBD: eq.leadBD, track: track, lanes: L, stages: stages, stuck: stuck, house: eq.house, counts: eq.counts, history: hist, eq: eq, st: st,
      totals: { placedDevices: eq.totals.placed, openAlerts: st.totals.openAlerts, recsDue: st.lanes['s-rec'].count, accessoryOrdersPlaced: accPlaced.length, openReturns: eq.totals.openReturns } };
  }

  /* The path for one record. Records from the equipment lanes trace with EquipModel, stock lanes with StockFlowModel. */
  function trace(model, item) {
    if (item.src === 'eq') return { src: 'eq', t: EQ.trace(model.eq, item) };
    if (item.src === 'st') return { src: 'st', t: ST.trace(model.st, item) };
    return { src: 'h', t: null };
  }

  return { WINDOWS: ST.WINDOWS, TRACKS: TRACKS, DEFAULT_LEAD_BD: EQ.DEFAULT_LEAD_BD, HISTORY_STALE_DAYS: HISTORY_STALE_DAYS, DROPPED: DROPPED,
    history: history, trackOf: trackOf, build: build, trace: trace };
});
