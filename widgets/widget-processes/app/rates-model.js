/* rates-model.js v1.0.1 (S76, 5 Nov 2026; 1.0.1: Part B rows carry rateVendorId and flags, e.g. 'No vendor on rate line') - ONE pricing model for the Leadership "Margin by vendor" tile and Processes > Rates.
   Pure: no DOM, no Zoho. Browser: window.RatesModel; node: require. The tile inlines this file byte for byte (check: tests/check-inline.js).

   build({ units, lines, contracts, today }) -> { partA, partB, totals, tile }
     units      Daily_Unit_Counts rows: Count_Date, Account, Account.Account_Name, SmartView_Customer, Device_Family, Vendor,
                Supplied_Through, Hardware_Version, Acquisition, On_Leg
     lines      Rate_Lines rows (any status): id, Parent_Id, Parent_Id.Name, Rate_Type, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name,
                Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Effective_Date, Tier_Min_Units
     contracts  Contracts rows: id, Name, Account, Account.Account_Name, Vendor, Counterparty_Type, Contract_Status, Final_End_Date, Rate_Basis
     Lookups may arrive as {id, name} objects (REST) or bare ids (widget COQL); names then come from the dotted columns.

   RULES (step 0, read from Leadership Home v47.10 and written into the S76 plan; changes from v47.10 marked *)
   Units
     - Count day: each unit VENDOR's latest Count_Date in the rows given (vendor, not vendor x family).
     - Vendor: Vendor = SCRAM and Supplied_Through = Allied -> Allied; else Vendor; empty Vendor with Hardware_Version starting
       AT1 / RTC / 1-Piece Beacon / Beacon -> Allied; anything else has no vendor and is left out of the counts.
     - Family: Hardware_Version "Base Station*" -> left out (bundled with the bracelet); PureProtect or Device_Family "Victim / DV"
       -> Victim / DV; Device_Family GPS / Remote Breath / CAM -> itself; anything else left out.
     - Double rows: rows for the same account, family and day are SUMMED. On 4 Nov every such pair is two hardware versions
       (Ramsey and Vernon GPS: AT1 LTE A + AT1 LTE V) or bracelet + base station (base station left out), not a double import.
     - Owned: Acquisition says Purchased/Owned, or the account's only customer rate for the family is marked purchased/owned.
   Vendor cost (Part A)
     - Vendor card: a contract named "<Allied|SCRAM|SuperCom|Buddi|Sentinel> ... vendor pricing". Allied units on an account named
       "Sheboygan County Sheriff" use the "(Sheboygan)" card first, then the standard one.
     - Current line: Verified (Line_Status, or Line_Verified when no status), Superseded_By empty, *Effective_Date empty or not after today.
     - Lines whose Rate_Terms mention "purchased" or "monitoring" are monitoring-only costs: used only for owned units, and an owned unit
       is never priced at the lease cost.
     - Rate Device -> family is exact: GPS, Remote Breath, CAM, Victim / DV. (CAM Landline, Wrist-worn GPS, 2-Piece GPS are not used.)
     - *More than one current line for a card and device: the newest id is used, and Part A shows Conflict, unless the lines are tiers
       (Tier_Min_Units set) or a bundle (a term says "bundle:", "part of the ... bundle" or "component"), which is OK and uses the highest amount.
   Customer rate (Part B)
     - The account's contracts: Counterparty_Type not Vendor, Contract_Status not Ended. The active contract is the one with status
       Active/Complete, else the latest Final_End_Date.
     - Current Verified "Customer rate" line with Rate_Device = family; GPS falls back to "Hybrid GPS + Alcohol". When the account has
       several contracts, a line on an Active/Complete contract wins. *Lines over $100/day are one-time charges and are left out.
     - Priced: a current customer rate above $0 AND a vendor cost. Margin = (rate - cost) / rate, weighted by units on leg.
   Flag (Part B): 'No vendor on rate line' when the verified customer line has no Rate Vendor. The screen and tile still price it
     (vendor from the units), but em_margin_build does not, so EM Margin and the Account fields stay blank until it is set.
   Status (Part B), in the order Beau fixes them
     No account > No contract > Account mismatch > No customer rate > Proposed, not Verified > No vendor cost > Priced
     - Account mismatch: no rate of this family for the account (Verified or Proposed) but another account with the same first word
       (the county) holds one and has no units of that family on leg itself, e.g. Sawyer Co. Pretrial units vs Sawyer Co HHS rates. Checked before "No contract", because the fix is
       the same whether or not the account has its own contract. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.RatesModel = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '1.0.1', DAILY_MAX = 100, FLOOR = 20, TARGET = 30;
  var FAMS = ['GPS', 'Remote Breath', 'CAM', 'Victim / DV'];
  var CARD_RE = /^(Allied|SCRAM|SuperCom|Buddi|Sentinel)\b.*vendor pricing/i;
  var STATUS = ['No account', 'No contract', 'Account mismatch', 'No customer rate', 'Proposed, not Verified', 'No vendor cost', 'Priced'];

  function s(v) { return v == null || v === '-None-' ? '' : String(v); }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  /* a lookup as {id, name}, whatever shape it arrived in; dotted = the "X.Name" column value */
  function ref(v, dotted) {
    if (v && typeof v === 'object') return { id: s(v.id), name: s(v.name) || s(dotted) };
    return { id: s(v), name: s(dotted) };
  }
  function idCmp(a, b) { var x = s(a.id), y = s(b.id); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0); }
  function round(n, d) { var p = Math.pow(10, d || 2); return Math.round(n * p) / p; }
  function county(name) { var w = s(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return w[0] || ''; }

  function lineStatus(l) {
    var st = s(l.Line_Status), sb = s(l.Superseded_By);
    if (st === 'Superseded' || st === 'Rejected') return st;
    if (sb) return /^Rejected/.test(sb) ? 'Rejected' : 'Superseded';
    if (st) return st;
    return l.Line_Verified === true || l.Line_Verified === 'true' ? 'Verified' : 'Proposed';
  }
  function effectiveOk(l, today) { var e = s(l.Effective_Date); return !e || !today || e <= today; }
  function monitoringOnly(t) { return /purchas|monitoring/i.test(s(t)); }
  function bought(t) { return /purchas|owned/i.test(s(t)); }

  /* ---------- the unit rules ---------- */
  function famOf(u) {
    var hv = s(u.Hardware_Version), f = s(u.Device_Family);
    if (/^Base Station/i.test(hv)) return '';
    if (/PureProtect/i.test(hv) || f === 'Victim / DV') return 'Victim / DV';
    return f === 'GPS' || f === 'Remote Breath' || f === 'CAM' ? f : '';
  }
  function vendorOf(u) {
    var v = s(u.Vendor);
    if (v === 'SCRAM' && s(u.Supplied_Through) === 'Allied') return 'Allied';
    if (v) return v;
    return /^(AT1|RTC|1-Piece Beacon|Beacon)/i.test(s(u.Hardware_Version)) ? 'Allied' : '';
  }
  function viaOf(u) { var v = s(u.Vendor), st = s(u.Supplied_Through); return v === 'SCRAM' && st === 'Allied' ? 'SCRAM via Allied' : vendorOf(u); }

  function build(inp) {
    var today = inp.today || '', units = inp.units || [], lines = (inp.lines || []).slice().sort(idCmp), contracts = inp.contracts || [];
    /* contracts */
    var con = {}, cards = {}, byAcct = {}, acctName = {};
    contracts.forEach(function (c) {
      var a = ref(c.Account, c['Account.Account_Name']), v = ref(c.Vendor, c['Vendor.Vendor_Name']);
      var o = { id: s(c.id), name: s(c.Name), acct: a.id, acctName: a.name, vendorId: v.id, type: s(c.Counterparty_Type), status: s(c.Contract_Status), end: s(c.Final_End_Date), basis: s(c.Rate_Basis) };
      con[o.id] = o; if (a.id && a.name) acctName[a.id] = a.name;
      var m = CARD_RE.exec(o.name); if (m) cards[o.id] = { id: o.id, name: o.name, vendor: m[1], vendorId: o.vendorId, sheb: /sheboygan/i.test(o.name), lines: {} };
      if (o.type !== 'Vendor' && !m && a.id && o.status !== 'Ended') (byAcct[a.id] = byAcct[a.id] || []).push(o);
    });
    function activeOf(aid) {
      var cs = (byAcct[aid] || []).slice(); if (!cs.length) return null;
      cs.sort(function (x, y) { return (y.status === 'Active/Complete') - (x.status === 'Active/Complete') || (y.end || '0').localeCompare(x.end || '0'); });
      return cs[0];
    }
    /* lines: vendor cost per card, customer rates per account */
    var cust = {}; /* acct|device -> { verified: [..], proposed: [..] } */
    lines.forEach(function (l) {
      var p = ref(l.Parent_Id, l['Parent_Id.Name']), type = s(l.Rate_Type), dev = s(l.Rate_Device), st = lineStatus(l), amt = num(l.Rate_Daily_Amount);
      var card = cards[p.id] || (!con[p.id] && CARD_RE.test(p.name) ? (cards[p.id] = { id: p.id, name: p.name, vendor: CARD_RE.exec(p.name)[1], vendorId: '', sheb: /sheboygan/i.test(p.name), lines: {} }) : null);
      var vend = ref(l.Rate_Vendor, l['Rate_Vendor.Vendor_Name']);
      var x = { id: s(l.id), contractId: p.id, device: dev, amt: amt, status: st, terms: s(l.Rate_Terms), tier: num(l.Tier_Min_Units) != null, effOk: effectiveOk(l, today), vendorId: vend.id, vendorName: vend.name };
      if (type === 'Vendor cost' && card) { (card.lines[dev] = card.lines[dev] || []).push(x); return; }
      if (type !== 'Customer rate') return;
      var c = con[p.id]; if (!c || c.type === 'Vendor' || c.status === 'Ended' || !c.acct) return;
      if (st !== 'Verified' && st !== 'Proposed') return;
      if (!x.effOk || amt == null || amt > DAILY_MAX) return;
      x.active = c.status === 'Active/Complete'; x.contractName = c.name; x.bought = bought(x.terms) || c.basis === 'Purchased units';
      var k = c.acct + '|' + dev, b = cust[k] || (cust[k] = { verified: [], proposed: [] });
      (st === 'Verified' ? b.verified : b.proposed).push(x);
    });
    /* the cost a card gives for a device: { amt, line, state, lines } */
    function cardCost(card, dev, owned) {
      var all = (card && card.lines[dev]) || [];
      var cur = all.filter(function (x) { return x.status === 'Verified' && x.effOk && x.amt != null && monitoringOnly(x.terms) === !!owned; });
      if (!cur.length) return { amt: null, line: null, state: all.some(function (x) { return monitoringOnly(x.terms) === !!owned; }) ? 'Superseded only' : 'Missing', lines: [] };
      if (cur.length === 1) return { amt: cur[0].amt, line: cur[0], state: 'OK', lines: cur };
      var distinct = cur.filter(function (x, i) { return cur.findIndex(function (y) { return y.amt === x.amt; }) === i; }).length;
      var bundle = cur.some(function (x) { return x.tier || /bundle:|part of the [^)]*bundle|component/i.test(x.terms); });
      if (bundle) { var hi = cur.slice().sort(function (a, b) { return b.amt - a.amt; })[0]; return { amt: hi.amt, line: hi, state: 'OK', lines: cur, note: 'tiers or bundle' }; }
      var newest = cur[cur.length - 1];
      return { amt: newest.amt, line: newest, state: distinct > 1 ? 'Conflict' : 'OK', lines: cur };
    }
    function cardsFor(vendor, aname) {
      var cs = Object.keys(cards).map(function (k) { return cards[k]; }).filter(function (k) { return k.vendor.toLowerCase() === s(vendor).toLowerCase(); });
      var sheb = vendor === 'Allied' && /sheboygan county sheriff/i.test(s(aname));
      return cs.sort(function (a, b) { return sheb ? b.sheb - a.sheb : a.sheb - b.sheb; });
    }
    function costFor(vendor, dev, owned, aname) {
      var cs = cardsFor(vendor, aname);
      for (var i = 0; i < cs.length; i++) { if (sheb(cs[i], vendor, aname)) { var r = cardCost(cs[i], dev, owned); if (r.amt != null) return { amt: r.amt, card: cs[i], line: r.line }; } }
      return { amt: null, card: cs[0] || null, line: null };
    }
    function sheb(card, vendor, aname) { return !card.sheb || (vendor === 'Allied' && /sheboygan county sheriff/i.test(s(aname))); }
    function pickRate(list) {
      if (!list || !list.length) return null;
      var act = list.filter(function (x) { return x.active; }); return (act.length ? act : list)[(act.length ? act : list).length - 1];
    }
    function rateFor(aid, fam, owned) {
      var g = cust[aid + '|' + fam] || (fam === 'GPS' ? cust[aid + '|Hybrid GPS + Alcohol'] : null) || { verified: [], proposed: [] };
      var vb = g.verified.filter(function (x) { return x.bought; }), vl = g.verified.filter(function (x) { return !x.bought; });
      var v = owned ? (pickRate(vb) || pickRate(vl)) : (pickRate(vl) || pickRate(vb));
      return { verified: v, proposed: pickRate(g.proposed), group: g };
    }
    function ownedOf(u, aid, fam) {
      if (/purchas|owned/i.test(s(u.Acquisition))) return true;
      var g = cust[aid + '|' + fam]; if (!g || !g.verified.length) return false;
      return g.verified.every(function (x) { return x.bought; });
    }
    /* ---------- units ---------- */
    var latest = {};
    units.forEach(function (u) { var v = vendorOf(u); if (v && (!latest[v] || s(u.Count_Date) > latest[v])) latest[v] = s(u.Count_Date); });
    var groups = {}, order = [], asof = '';
    units.forEach(function (u) {
      var v = vendorOf(u), fam = famOf(u), on = num(u.On_Leg) || 0;
      if (!v || !fam || s(u.Count_Date) !== latest[v] || on <= 0) return;
      if (s(u.Count_Date) > asof) asof = s(u.Count_Date);
      var a = ref(u.Account, u['Account.Account_Name']), owned = a.id ? ownedOf(u, a.id, fam) : /purchas|owned/i.test(s(u.Acquisition));
      var key = (a.id || 'sv:' + s(u.SmartView_Customer)) + '|' + fam + '|' + v + '|' + (owned ? 1 : 0);
      var g = groups[key];
      if (!g) { g = groups[key] = { key: key, accountId: a.id, account: a.name || acctName[a.id] || '', smartView: s(u.SmartView_Customer), family: fam, vendor: v, via: viaOf(u), owned: owned, units: 0, rows: 0 }; order.push(key); }
      g.units += on; g.rows++;
    });
    /* ---------- Part B ---------- */
    var acctsByCounty = {}; Object.keys(cust).forEach(function (k) { var aid = k.split('|')[0], nm = acctName[aid]; if (nm) (acctsByCounty[county(nm)] = acctsByCounty[county(nm)] || {})[aid] = 1; });
    var hasUnits = {}; order.forEach(function (k) { var g = groups[k]; if (g.accountId) hasUnits[g.accountId + '|' + g.family] = 1; });
    var partB = order.map(function (k) {
      var g = groups[k], r = { key: g.key, accountId: g.accountId, account: g.account, smartView: g.smartView, family: g.family, vendor: g.vendor, via: g.via, owned: g.owned, units: g.units,
        contractId: '', contract: '', rate: null, rateLineId: '', proposedLineId: '', proposedRate: null, cost: null, costCardId: '', costCard: '', costLineId: '', margin: null, marginDay: null, status: '', note: '', mismatch: null, rateVendorId: '', cardVendorId: '', flags: [] };
      var c = g.accountId ? activeOf(g.accountId) : null; if (c) { r.contractId = c.id; r.contract = c.name; }
      var cf = costFor(g.vendor, g.family, g.owned, g.account); r.cost = cf.amt; if (cf.card) { r.costCardId = cf.card.id; r.costCard = cf.card.name; } if (cf.line) r.costLineId = cf.line.id;
      var rt = g.accountId ? rateFor(g.accountId, g.family, g.owned) : { verified: null, proposed: null, group: { verified: [], proposed: [] } };
      if (cf.card) r.cardVendorId = cf.card.vendorId || '';
      if (rt.verified) { r.rate = rt.verified.amt; r.rateLineId = rt.verified.id; r.rateVendorId = rt.verified.vendorId; if (!r.contractId) { r.contractId = rt.verified.contractId; r.contract = rt.verified.contractName; } }
      if (rt.proposed) { r.proposedLineId = rt.proposed.id; r.proposedRate = rt.proposed.amt; }
      var hasOwn = !!(rt.group.verified.length || rt.group.proposed.length);
      if (!g.accountId) r.status = 'No account';
      else {
        if (!hasOwn) {
          var sib = Object.keys((acctsByCounty[county(g.account)] || {})).filter(function (aid) { return aid !== g.accountId && !hasUnits[aid + '|' + g.family] && (cust[aid + '|' + g.family] || (g.family === 'GPS' && cust[aid + '|Hybrid GPS + Alcohol'])); })[0];
          if (sib) {
            var sg = cust[sib + '|' + g.family] || cust[sib + '|Hybrid GPS + Alcohol'], sl = pickRate(sg.verified) || pickRate(sg.proposed);
            r.mismatch = { accountId: sib, account: acctName[sib] || '', contractId: sl.contractId, contract: sl.contractName, lineId: sl.id, rate: sl.amt, device: sl.device, targetContractId: c ? c.id : '' };
            r.status = 'Account mismatch';
          }
        }
        if (!r.status && !c) r.status = 'No contract';
        else if (!r.status && !rt.verified && rt.proposed) r.status = 'Proposed, not Verified';
        else if (!r.status && !rt.verified) r.status = 'No customer rate';
        else if (!r.status && (r.cost == null)) r.status = 'No vendor cost';
        else if (!r.status && !r.rate) r.status = 'No customer rate';
        else if (!r.status) r.status = 'Priced';
      }
      if (r.status === 'Priced') { r.marginDay = round(r.rate - r.cost); r.margin = round((r.rate - r.cost) / r.rate * 100, 1); }
      /* em_margin_build never guesses a vendor: a verified line without Rate Vendor stays an EM Margin exception */
      if (r.rateLineId && !r.rateVendorId) r.flags.push('No vendor on rate line');
      r.rank = STATUS.indexOf(r.status);
      return r;
    });
    partB.sort(function (a, b) { return a.rank - b.rank || b.units - a.units || a.account.localeCompare(b.account); });
    /* ---------- Part A: vendor x family, for every family with units on leg plus every card line ---------- */
    /* one row per card x family x (lease | owned): its units are the Part B units that card prices (or would price) */
    var aRows = {}, partA = [];
    function aRow(cd, vendor, fam, owned) {
      var k = (cd ? cd.id : 'none:' + vendor) + '|' + fam + '|' + (owned ? 1 : 0);
      if (!aRows[k]) {
        var cc = cd ? cardCost(cd, fam, owned) : { amt: null, line: null, state: 'No pricing record', lines: [] };
        aRows[k] = { key: k, vendor: cd ? cd.vendor : vendor, family: fam, owned: !!owned, cardId: cd ? cd.id : '', card: cd ? cd.name : '', vendorId: cd ? cd.vendorId : '', units: 0,
          cost: cc.amt, lineId: cc.line ? cc.line.id : '', status: cc.state, note: cc.note || '', lines: cc.lines.map(function (x) { return { id: x.id, amt: x.amt, terms: x.terms }; }) };
      }
      return aRows[k];
    }
    partB.forEach(function (r) { var cd = r.costCardId ? cards[r.costCardId] : null; aRow(cd, r.vendor, r.family, r.owned).units += r.units; });
    Object.keys(cards).forEach(function (id) { var cd = cards[id]; Object.keys(cd.lines).forEach(function (dev) {
      if (FAMS.indexOf(dev) < 0) return;
      [false, true].forEach(function (o) { if (cd.lines[dev].some(function (x) { return monitoringOnly(x.terms) === o && x.status === 'Verified'; })) aRow(cd, cd.vendor, dev, o); });
    }); });
    Object.keys(aRows).forEach(function (k) { partA.push(aRows[k]); });
    var AR = { 'Conflict': 0, 'Missing': 1, 'Superseded only': 2, 'No pricing record': 3, 'OK': 4 };
    partA.sort(function (a, b) { return AR[a.status] - AR[b.status] || b.units - a.units || a.vendor.localeCompare(b.vendor); });
    /* ---------- totals and the tile's vendor rows ---------- */
    var tot = { units: 0, priced: 0, rev: 0, cost: 0 }, vrows = {}, vorder = [];
    partB.forEach(function (r) {
      tot.units += r.units;
      var k = r.vendor + ' · ' + r.family + (r.owned ? ' (owned)' : ''), g = vrows[k] || (vrows[k] = { label: k, on: 0, priced: 0, rev: 0, cst: 0 }); if (vorder.indexOf(k) < 0) vorder.push(k);
      g.on += r.units; if (r.status !== 'Priced') return;
      tot.priced += r.units; tot.rev += r.units * r.rate; tot.cost += r.units * r.cost; g.priced += r.units; g.rev += r.units * r.rate; g.cst += r.units * r.cost;
    });
    var tileRows = vorder.map(function (k) { var g = vrows[k]; return { label: k, on: g.on, priced: g.priced, rate: g.priced ? g.rev / g.priced : null, cost: g.priced ? g.cst / g.priced : null, margin: g.rev ? (g.rev - g.cst) / g.rev * 100 : null }; })
      .sort(function (a, b) { return b.on - a.on; });
    var totals = { units: tot.units, priced: tot.priced, unpriced: tot.units - tot.priced, margin: tot.rev ? round((tot.rev - tot.cost) / tot.rev * 100, 1) : null, asof: asof,
      byStatus: STATUS.map(function (st) { var rs = partB.filter(function (r) { return r.status === st; }); return { status: st, rows: rs.length, units: rs.reduce(function (t, r) { return t + r.units; }, 0) }; }) };
    return { version: VERSION, partA: partA, partB: partB, totals: totals, tile: { rows: tileRows, total: totals.margin, unpriced: totals.unpriced, units: totals.units, asof: asof } };
  }

  /* ---------- write payloads (pure). Rate_Lines is a subform: a row left out of an update is DELETED, so every write sends every row. ---------- */
  function fullPayload(rows, changes, add) {
    if (!Array.isArray(rows)) return null;
    changes = changes || {};
    var ids = {}; rows.forEach(function (r) { ids[s(r.id)] = 1; });
    if (Object.keys(changes).some(function (k) { return !ids[k]; })) return null;
    var out = rows.map(function (r) { var c = changes[s(r.id)]; return c ? Object.assign({ id: r.id }, c) : { id: r.id }; });
    (Array.isArray(add) ? add : add ? [add] : []).forEach(function (a) { out.push(a); });
    return out;
  }
  function verifyFields() { return { Line_Status: 'Verified', Line_Verified: true, Superseded_By: null }; }
  function supersedeFields(byId) { return { Line_Status: 'Superseded', Line_Verified: false, Superseded_By: byId ? s(byId) : 'Superseded in review' }; }
  function familyDevice(f) { return FAMS.indexOf(f) >= 0 ? f : 'Other'; }
  function sourceRef(date, user) { return 'Rates screen ' + date + (user ? ' ' + user : ''); }
  function tone(m) { return m == null ? '' : m < 0 ? 'bad' : m < FLOOR ? 'bad' : m < TARGET ? 'warn' : 'good'; }

  return { VERSION: VERSION, FLOOR: FLOOR, TARGET: TARGET, FAMS: FAMS, STATUS: STATUS, build: build, famOf: famOf, vendorOf: vendorOf, lineStatus: lineStatus,
    fullPayload: fullPayload, verifyFields: verifyFields, supersedeFields: supersedeFields, familyDevice: familyDevice, sourceRef: sourceRef, tone: tone, monitoringOnly: monitoringOnly };
});
