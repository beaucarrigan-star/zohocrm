/* margins-model.js v1.0 (5 Nov 2026): pure logic for Processes > Contract > Margins. No DOM, no Zoho. Browser: window.ProcMarginsModel; node: require.
   One row per live customer rate line on a customer contract, priced against the vendor's pricing card.

   Rules (same as vendor_cost_contract_margin.dg and Leadership Home v47.10.1 "Margin by vendor"):
   - Live line: Line_Status not Superseded/Rejected, Superseded_By empty, Effective_Date empty or today or earlier, a daily amount of $100 or less
     (over $100 is a one-time charge and is left out).
   - Vendor: the customer line's Rate_Vendor. With no Rate_Vendor the line is flagged "No vendor" and has no cost.
   - Vendor card: a Counterparty_Type = Vendor contract whose Name contains "vendor pricing" and whose Vendor is that vendor. When a vendor
     has more than one card, a card whose name in brackets appears in the account name wins (Allied (Sheboygan) for Sheboygan), else
     the "(standard)" card, else the first.
   - Vendor cost: a live "Vendor cost" line on that card for the same Rate_Device; the newest id wins. Lines whose Rate_Terms mention
     "purchased" or "monitoring" are monitoring-only costs and price only purchased units; purchased units are never priced at the lease cost.
   - Purchased: the customer line's Rate_Terms mention purchased/owned, or the contract's Rate_Basis is "Purchased units".
   - Margin % = (rate - cost) / rate, rate only (no volume weighting). Target = 30% house default.
   - Tier: Negative below 0, Thin below 20, Normal below 50, Strong 50 and up (the EM Margin tiers). */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ProcMarginsModel = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TARGET = 30, DAILY_MAX = 100;
  var DEAD = /^(Superseded|Rejected)$/;
  function pick(v) { return v && v !== '-None-' ? String(v) : ''; }
  function lid(v) { return v && typeof v === 'object' ? String(v.id || '') : (v == null ? '' : String(v)); }
  function lname(v) { return v && typeof v === 'object' ? String(v.name || '') : ''; }
  function num(v) { return v == null || v === '' || isNaN(+v) ? null : +v; }
  function idCmp(a, b) { var x = String(a.id || ''), y = String(b.id || ''); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0); }
  function status(l) { var s = pick(l.Line_Status), sb = pick(l.Superseded_By); if (DEAD.test(s)) return s; if (sb) return /^Rejected/.test(sb) ? 'Rejected' : 'Superseded'; return s || (l.Line_Verified === true ? 'Verified' : 'Proposed'); }
  function live(l, today) {
    if (DEAD.test(status(l))) return false;
    var e = pick(l.Effective_Date); if (e && today && e > today) return false;
    var a = num(l.Rate_Daily_Amount); return a != null && a <= DAILY_MAX;
  }
  function bought(terms) { return /purchas|owned/i.test(terms || ''); }
  function monitoringOnly(terms) { return /purchas|monitoring/i.test(terms || ''); }
  function tierFor(p) { return p == null ? '' : p < 0 ? 'Negative' : p < 20 ? 'Thin' : p < 50 ? 'Normal' : 'Strong'; }

  /* contracts: Contracts rows (customer and vendor). lines: Rate_Lines rows. Returns { rows, cards } */
  function build(contracts, lines, today, target) {
    target = target == null ? TARGET : target;
    var byId = {}, cards = {}, cardList = [];
    (contracts || []).forEach(function (c) { byId[String(c.id)] = c; });
    (contracts || []).forEach(function (c) {
      if (pick(c.Counterparty_Type) !== 'Vendor' || !/vendor pricing/i.test(c.Name || '')) return;
      var v = lid(c.Vendor); if (!v) return;
      var card = { id: String(c.id), name: c.Name || '', vendorId: v, lease: {}, mon: {} };
      (cards[v] = cards[v] || []).push(card); cardList.push(card);
    });
    var cardById = {}; cardList.forEach(function (k) { cardById[k.id] = k; });
    var sorted = (lines || []).slice().sort(idCmp);
    sorted.forEach(function (l) {
      if (pick(l.Rate_Type) !== 'Vendor cost') return;
      var k = cardById[lid(l.Parent_Id)]; if (!k || !live(l, today)) return;
      var dev = pick(l.Rate_Device); if (!dev) return;
      (monitoringOnly(l.Rate_Terms) ? k.mon : k.lease)[dev] = { amt: num(l.Rate_Daily_Amount), id: String(l.id) }; /* newest id wins */
    });
    function cardFor(vendorId, acctName) {
      var cs = cards[vendorId] || []; if (cs.length < 2) return cs[0] || null;
      var a = String(acctName || '').toLowerCase();
      var named = cs.filter(function (k) { var m = /\(([^)]+)\)/.exec(k.name); return m && m[1].toLowerCase() !== 'standard' && a.indexOf(m[1].toLowerCase()) >= 0; })[0];
      if (named) return named;
      return cs.filter(function (k) { return /\(standard\)/i.test(k.name); })[0] || cs.filter(function (k) { return !/\(/.test(k.name); })[0] || cs[0];
    }
    var rows = [];
    sorted.forEach(function (l) {
      if (pick(l.Rate_Type) !== 'Customer rate' || !live(l, today)) return;
      var c = byId[lid(l.Parent_Id)]; if (!c || pick(c.Counterparty_Type) === 'Vendor' || pick(c.Contract_Status) === 'Ended') return;
      var dev = pick(l.Rate_Device), rate = num(l.Rate_Daily_Amount), vId = lid(l.Rate_Vendor), vName = lname(l.Rate_Vendor) || pick(l['Rate_Vendor.Vendor_Name']);
      var acct = lname(c.Account) || pick(c['Account.Account_Name']), isBought = bought(l.Rate_Terms) || pick(c.Rate_Basis) === 'Purchased units';
      var card = vId ? cardFor(vId, acct) : null, hit = card ? (isBought ? card.mon[dev] : card.lease[dev]) : null;
      var cost = hit ? hit.amt : null, st = status(l), flags = [];
      if (!vId) flags.push('No vendor');
      else if (!card) flags.push('No vendor pricing card');
      else if (cost == null) flags.push(isBought ? 'No monitoring-only cost' : 'No vendor cost');
      if (st !== 'Verified') flags.push('Unverified');
      var pct = rate && cost != null ? (rate - cost) / rate * 100 : null;
      if (pct != null && pct < target) flags.push(pct < 0 ? 'Negative' : 'Below target');
      rows.push({ id: String(l.id), contractId: String(c.id), contract: c.Name || '', accountId: lid(c.Account), account: acct, contractStatus: pick(c.Contract_Status),
        device: dev, vendorId: vId, vendor: vName, rate: rate, cost: cost, costLineId: hit ? hit.id : '', card: card ? card.name : '', cardId: card ? card.id : '',
        bought: isBought, status: st, terms: pick(l.Rate_Terms), effective: pick(l.Effective_Date),
        marginDay: pct == null ? null : Math.round((rate - cost) * 100) / 100, pct: pct == null ? null : Math.round(pct * 10) / 10,
        tier: tierFor(pct), gap: pct == null ? null : Math.round((pct - target) * 10) / 10, flags: flags });
    });
    rows.sort(function (a, b) { return (a.pct == null) - (b.pct == null) || (a.pct || 0) - (b.pct || 0) || a.account.localeCompare(b.account); });
    return { rows: rows, cards: cardList, target: target };
  }

  var LANES = [
    { id: 'below', label: 'Below target', kpi: 'bad', test: function (r) { return r.gap != null && r.gap < 0; } },
    { id: 'nocost', label: 'No vendor or cost', kpi: 'warn', test: function (r) { return r.cost == null; } },
    { id: 'unver', label: 'Unverified rate', kpi: 'warn', test: function (r) { return r.status !== 'Verified'; } },
    { id: 'ok', label: 'At or above target', kpi: 'good', test: function (r) { return r.gap != null && r.gap >= 0; } },
    { id: 'all', label: 'All lines', test: function () { return true; } }];

  /* ---------- writes (pure payload builders; the view sends them) ---------- */
  /* Rate_Lines is a subform: a row left out of an update is DELETED. Every write sends every existing row id. */
  function fullPayload(lines, changes, add) {
    if (!Array.isArray(lines)) return null;
    changes = changes || {};
    var ids = {}; lines.forEach(function (l) { ids[String(l.id)] = 1; });
    if (Object.keys(changes).some(function (k) { return !ids[k]; })) return null;
    var out = lines.map(function (l) { var c = changes[String(l.id)]; return c ? Object.assign({ id: l.id }, c) : { id: l.id }; });
    if (add) out.push(add);
    return out;
  }
  function verifyFields() { return { Line_Status: 'Verified', Line_Verified: true, Superseded_By: null }; }

  return { TARGET: TARGET, LANES: LANES, build: build, status: status, live: live, tierFor: tierFor, fullPayload: fullPayload, verifyFields: verifyFields, bought: bought, monitoringOnly: monitoringOnly };
});
