/* Pricing flow: pure logic (no DOM, no Zoho). Copy of ux/pricing-flow/app/pricing-flow-model.js (13 Oct 2026, Opus-reviewed margin logic).
   Reads saved records only; never writes. Browser: window.PricingFlowModel; node: require. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PricingFlowModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var DEFAULTS = { rateAgeDays: 90, draftAgeDays: 30, gapPts: 5 };
  var ENDED = ['Ended', 'Ending - No Renewal'];
  var OPEN_SC = ['Draft', 'Proposed', 'Accepted'];
  var MIX_TOLERANCE_PCT = 0.5;
  function pickVal(v) { return v && v !== '-None-' ? String(v) : ''; }
  function lk(v) { return v && typeof v === 'object' ? { id: v.id || null, name: v.name || '' } : { id: null, name: '' }; }
  function num(v) { return v == null || (typeof v === 'string' && v.trim() === '') || isNaN(+v) ? null : +v; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function money(v) { return v == null ? '' : '$' + Math.round(v).toLocaleString('en-US'); }
  function toMs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(v + 'T17:00:00Z') : Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function centralDay(ms) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY;
  }
  function ageDays(ms, now) { return ms == null ? null : centralDay(now) - centralDay(ms); }
  function lineStatus(r) {
    var ls = pickVal(r.Line_Status), sb = String(r.Superseded_By || '');
    if (ls === 'Superseded' || ls === 'Rejected') return ls;
    if (sb) return sb.indexOf('Rejected') === 0 ? 'Rejected' : 'Superseded';
    if (ls === 'Verified' || ls === 'Proposed') return ls;
    return r.Line_Verified === true || r.Line_Verified === 'true' ? 'Verified' : 'Proposed';
  }
  function sortOld(a, b) { return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms); }
  function sortNew(a, b) { return (b.ms == null ? -Infinity : b.ms) - (a.ms == null ? -Infinity : a.ms); }
  function normProduct(r) {
    var v = lk(r.Vendor_Name);
    return { id: r.id, name: r.Product_Name || '', vendor: v.name, active: r.Product_Active !== false, cost: num(r.Cost_Lease_Daily), check: pickVal(r.Contract_Check), device: pickVal(r.Contract_Rate_Device), tier: pickVal(r.Current_Tier) };
  }
  function normRate(r, now) {
    var c = lk(r.Contract), ms = toMs(r.Modified_Time);
    return { id: r.id, agency: r.Agency || r.Name || '', device: r.Device_Type || '', active: num(r.Active_Rate), basis: pickVal(r.Basis), conf: pickVal(r.Confirmation), contractId: c.id, source: r.Source || '', ms: ms, age: ageDays(ms, now) };
  }
  function normScenario(r, now) {
    var a = lk(r.Account), vu = toMs(r.Valid_Until), mod = toMs(r.Modified_Time);
    return { id: r.id, name: r.Name || '', accountId: a.id, accountName: a.name, status: pickVal(r.Scenario_Status) || 'Draft', model: pickVal(r.Pricing_Model), units: num(r.Active_Units),
      rev: num(r.Est_Monthly_Revenue), cost: num(r.Est_Monthly_Cost), margin: num(r.Est_Monthly_Margin), pct: num(r.Est_Margin_Pct), target: num(r.Target_Margin_Pct), tier: pickVal(r.Margin_Tier),
      missing: num(r.Missing_Costs) || 0, validMs: vu, validDays: vu == null ? null : centralDay(vu) - centralDay(now), sentMs: toMs(r.Proposal_Sent), createdMs: toMs(r.Created_Time), modMs: mod, modAge: ageDays(mod, now), rows: [] };
  }
  function normMargin(r) {
    var a = lk(r.Account), sc = lk(r.Pricing_Scenario), type = pickVal(r.Row_Type) || 'Billing actual';
    var rev = num(r.Invoiced_Revenue); if (rev == null) rev = num(r.Expected_Revenue);
    return { id: r.id, name: r.Name || '', type: type, scenarioId: sc.id, scenarioName: sc.name, accountId: a.id, accountName: a.name, family: pickVal(r.Device_Family), lineModel: pickVal(r.Line_Model),
      expected: num(r.Expected_Revenue), rev: rev, modelCost: num(r.Modelled_Cost), actual: num(r.Actual_Cost), modelMargin: num(r.Modelled_Margin), month: r.Billing_Month ? String(r.Billing_Month) : '', status: pickVal(r.Status), ms: toMs(r.Created_Time) };
  }
  function item(kind, o) {
    return { kind: kind, id: o.id, title: o.title, sub: o.sub || '', accountId: o.accountId || null, accountName: o.accountName || '', ms: o.ms == null ? null : o.ms, age: null, ageText: o.ageText || '',
      state: o.state || '', tone: o.tone || 'info', note: o.note || '', scenarioId: o.scenarioId || null, contractId: o.contractId || null, accountKey: o.accountKey || o.accountId || null };
  }
  function build(data, now, opts) {
    opts = opts || {}; data = data || {};
    var rateAge = opts.rateAgeDays == null ? DEFAULTS.rateAgeDays : opts.rateAgeDays;
    var draftAge = opts.draftAgeDays == null ? DEFAULTS.draftAgeDays : opts.draftAgeDays;
    var gapPts = opts.gapPts == null ? DEFAULTS.gapPts : opts.gapPts;
    var marginsAvailable = opts.marginsAvailable !== false;
    var products = (data.products || []).map(normProduct);
    var rates = (data.rates || []).map(function (r) { return normRate(r, now); });
    var scenarios = (data.scenarios || []).map(function (r) { return normScenario(r, now); });
    var margins = (data.margins || []).map(normMargin);
    var scById = {}; scenarios.forEach(function (s) { scById[s.id] = s; });
    var cById = {}, contracts = [];
    (data.contracts || []).forEach(function (r) {
      var a = lk(r.Account), st = pickVal(r.Contract_Status), cp = pickVal(r.Counterparty_Type) || 'Customer';
      var c = { id: r.id, name: r.Name || '', accountId: a.id, accountName: a.name, cp: cp, live: ENDED.indexOf(st) < 0, status: st, verified: 0, proposed: 0, endMs: toMs(r.Final_End_Date) };
      cById[c.id] = c; if (cp !== 'Vendor' && c.live) contracts.push(c);
    });
    (data.lines || []).forEach(function (r) {
      var c = cById[lk(r.Parent_Id).id]; if (!c || pickVal(r.Rate_Type) !== 'Customer rate') return;
      var s = lineStatus(r); if (s === 'Verified') c.verified += 1; else if (s === 'Proposed') c.proposed += 1;
    });
    var orphanRows = [], actualRows = [];
    margins.forEach(function (m) {
      if (m.type === 'Scenario model') { var s = m.scenarioId && scById[m.scenarioId]; if (s) s.rows.push(m); else orphanRows.push(m); }
      else if (m.type === 'Billing actual' || m.type === '') actualRows.push(m);
    });
    scenarios.forEach(function (s) {
      s.rowRev = s.rows.reduce(function (t, m) { return t + (m.expected || 0); }, 0);
      s.rowCost = s.rows.reduce(function (t, m) { return t + (m.modelCost || 0); }, 0);
      var tolR = Math.max(1, Math.abs(s.rev || 0) * MIX_TOLERANCE_PCT / 100), tolC = Math.max(1, Math.abs(s.cost || 0) * MIX_TOLERANCE_PCT / 100);
      s.revDiff = s.rowRev - (s.rev || 0); s.costDiff = s.rowCost - (s.cost || 0);
      s.mismatch = s.rows.length > 0 && (Math.abs(s.revDiff) > tolR || Math.abs(s.costDiff) > tolC);
      s.closed = OPEN_SC.indexOf(s.status) < 0;
    });
    var scByAccount = {}; scenarios.forEach(function (s) { if (s.accountId) (scByAccount[s.accountId] = scByAccount[s.accountId] || []).push(s); });
    var L = {};
    function lane(id, stage, label, items, tone, hint, kind) { L[id] = { id: id, stage: stage, label: label, count: items.length, tone: items.length ? tone : 'neutral', hint: hint || '', kind: kind || 'scenario', items: items }; }
    var none = function (a) { return a.length ? '' : 'None found'; };
    var pItem = function (p, state, tone, note) { return item('product', { id: p.id, title: p.name, sub: [p.vendor, p.cost == null ? 'no cost entered' : '$' + p.cost.toFixed(2) + ' a day'].filter(Boolean).join(' / '), state: state, tone: tone, note: note }); };
    var rItem = function (r, state, tone, note) {
      return item('vrate', { id: r.id, title: r.agency + ': ' + r.device, sub: [r.active == null ? '' : '$' + r.active.toFixed(2) + ' a day', r.basis].filter(Boolean).join(' / '), ms: r.ms, ageText: r.age == null ? '' : plural(r.age, 'day') + ' since edit', state: state, tone: tone, note: note });
    };
    var cItem = function (c, state, tone, note) {
      return item('contract', { id: c.id, title: c.name, sub: plural(c.verified, 'verified rate line') + (c.proposed ? ', ' + c.proposed + ' proposed' : ''), accountId: c.accountId, accountName: c.accountName, ms: c.endMs, state: state, tone: tone, note: note, contractId: c.id });
    };
    var sItem = function (s, state, tone, note) {
      return item('scenario', { id: s.id, title: s.name || 'Scenario', sub: [s.model, s.units != null ? s.units + ' units' : '', s.rev != null ? money(s.rev) + ' a month revenue' : '', s.pct != null ? s.pct.toFixed(1) + '% margin' : ''].filter(Boolean).join(' / '),
        accountId: s.accountId, accountName: s.accountName, ms: s.modMs, ageText: s.modAge == null ? '' : plural(s.modAge, 'day') + ' since edit', state: state || s.status, tone: tone || 'info', note: note, scenarioId: s.id });
    };
    var activeP = products.filter(function (p) { return p.active; });
    var pOk = activeP.filter(function (p) { return p.check === 'Matches contract'; });
    var pNoCost = activeP.filter(function (p) { return p.check === 'No cost entered'; });
    var pNoRate = activeP.filter(function (p) { return p.check === 'No contract rate'; });
    var pOther = activeP.filter(function (p) { return !p.check; });
    var retired = products.length - activeP.length;
    lane('i-prod-ok', 1, 'Products whose cost matches the contract', pOk.map(function (p) { return pItem(p, 'Matches contract', 'good'); }), 'good', retired ? plural(retired, 'retired product') + ' left out' : '', 'product');
    lane('i-prod-nocost', 1, 'Products with no cost entered', pNoCost.map(function (p) { return pItem(p, 'No cost entered', 'warn', 'Margin on this device cannot be trusted until a cost is entered.'); }), 'warn', none(pNoCost), 'product');
    lane('i-prod-norate', 1, 'Products with no contract rate', pNoRate.map(function (p) { return pItem(p, 'No contract rate', 'warn', 'The cost has no vendor contract rate to check it against.'); }), 'warn', none(pNoRate), 'product');
    lane('i-prod-none', 1, 'Products not cost checked', pOther.map(function (p) { return pItem(p, 'Not checked', 'neutral'); }), 'neutral', '', 'product');
    var rOk = rates.filter(function (r) { return r.conf === 'Contract-confirmed'; });
    var rObs = rates.filter(function (r) { return r.conf === 'Observed'; });
    var rNone = rates.filter(function (r) { return !r.conf; });
    var rOld = rates.filter(function (r) { return r.age != null && r.age >= rateAge; });
    lane('i-vr-ok', 1, 'Vendor rates confirmed by contract', rOk.map(function (r) { return rItem(r, 'Contract-confirmed', 'good'); }).sort(sortNew), 'good', '', 'vrate');
    lane('i-vr-obs', 1, 'Vendor rates only observed', rObs.map(function (r) { return rItem(r, 'Observed', 'warn', 'Seen on an invoice or report; confirm against the contract. ' + (r.source || '')); }).sort(sortOld), 'warn', none(rObs), 'vrate');
    lane('i-vr-none', 1, 'Vendor rates with no confirmation', rNone.map(function (r) { return rItem(r, 'Not recorded', 'neutral', r.source); }).sort(sortOld), 'neutral', '', 'vrate');
    lane('i-vr-old', 1, 'Vendor rates not edited in a long time', rOld.map(function (r) { return rItem(r, r.conf || 'Not recorded', 'warn', 'Last edited ' + plural(r.age, 'day') + ' ago.'); }).sort(sortOld), 'warn', rOld.length ? 'over ' + plural(rateAge, 'day') : 'None found', 'vrate');
    var ready = contracts.filter(function (c) { return c.verified > 0; });
    var waitingLines = contracts.filter(function (c) { return c.verified === 0 && c.proposed > 0; });
    lane('i-line-ready', 1, 'Contracts with verified customer rates', ready.map(function (c) { return cItem(c, 'Ready to price', 'good'); }).sort(sortOld), 'good', 'these can be priced', 'contract');
    lane('i-line-wait', 1, 'Contracts whose rates are still Proposed', waitingLines.map(function (c) { return cItem(c, 'Rates not verified', 'neutral', plural(c.proposed, 'customer rate line') + ' to verify in Contract Review.'); }).sort(sortOld), 'neutral', 'finish Contract Review first', 'contract');
    var by = function (st) { return scenarios.filter(function (s) { return s.status === st; }); };
    var openSc = scenarios.filter(function (s) { return !s.closed; });
    var noAcct = openSc.filter(function (s) { return !s.accountId; });
    var empty = openSc.filter(function (s) { return !(s.rev > 0); });
    var missing = openSc.filter(function (s) { return s.missing > 0; });
    var expired = by('Proposed').filter(function (s) { return s.validDays != null && s.validDays < 0; });
    var draftOld = by('Draft').filter(function (s) { return s.modAge != null && s.modAge >= draftAge; });
    lane('s-draft', 2, 'Draft', by('Draft').map(function (s) { return sItem(s); }).sort(sortOld), 'neutral', '', 'scenario');
    lane('s-proposed', 2, 'Proposed', by('Proposed').map(function (s) { return sItem(s, 'Proposed', 'info', s.validDays != null ? (s.validDays < 0 ? 'Offer expired ' + plural(-s.validDays, 'day') + ' ago.' : 'Valid for ' + plural(s.validDays, 'more day') + '.') : ''); }).sort(sortOld), 'neutral', '', 'scenario');
    lane('s-accepted', 2, 'Accepted', by('Accepted').map(function (s) { return sItem(s, 'Accepted', 'good'); }).sort(sortNew), 'good', '', 'scenario');
    lane('s-closed', 2, 'Declined or superseded', scenarios.filter(function (s) { return s.closed; }).map(function (s) { return sItem(s, s.status, 'neutral'); }).sort(sortNew), 'neutral', '', 'scenario');
    lane('s-noacct', 2, 'Open scenarios with no account', noAcct.map(function (s) { return sItem(s, s.status, 'warn', 'No account is linked, so it cannot be matched to a contract or to billing.'); }).sort(sortOld), 'warn', none(noAcct), 'scenario');
    lane('s-empty', 2, 'Open scenarios with no revenue', empty.map(function (s) { return sItem(s, s.status, 'warn', 'Estimated revenue is zero: nothing has been priced in it yet.'); }).sort(sortOld), 'warn', none(empty), 'scenario');
    lane('s-missing', 2, 'Scenarios with missing costs', missing.map(function (s) { return sItem(s, s.status, 'warn', plural(s.missing, 'line') + ' priced without a vendor cost.'); }).sort(sortOld), 'warn', none(missing), 'scenario');
    lane('s-expired', 2, 'Proposals past their valid-until date', expired.map(function (s) { return sItem(s, 'Proposed', 'warn', 'Offer expired ' + plural(-s.validDays, 'day') + ' ago and is still Proposed.'); }).sort(sortOld), 'warn', none(expired), 'scenario');
    lane('s-draft-old', 2, 'Drafts not touched in a while', draftOld.map(function (s) { return sItem(s, 'Draft', 'warn', 'Last edited ' + plural(s.modAge, 'day') + ' ago.'); }).sort(sortOld), 'warn', draftOld.length ? 'over ' + plural(draftAge, 'day') : 'None found', 'scenario');
    var withRows = openSc.filter(function (s) { return s.rows.length > 0; });
    var noRows = openSc.filter(function (s) { return s.rev > 0 && s.rows.length === 0; });
    var mism = openSc.filter(function (s) { return s.mismatch; });
    var thin = openSc.filter(function (s) { return (s.pct != null && s.target != null && s.pct < s.target) || s.tier === 'Negative' || s.tier === 'Thin'; });
    var okRows = withRows.filter(function (s) { return !s.mismatch; });
    lane('m-ok', 3, 'Scenarios whose rows add up', okRows.map(function (s) { return sItem(s, 'Rows add up', 'good', plural(s.rows.length, 'margin row')); }).sort(sortNew), 'good', marginsAvailable ? '' : 'EM Margin could not be read', 'scenario');
    lane('m-norows', 3, 'Priced scenarios with no margin rows', noRows.map(function (s) { return sItem(s, s.status, 'bad', 'Revenue is ' + money(s.rev) + ' a month but no margin rows were saved. The Studio save may have stopped part way.'); }).sort(sortOld), 'bad', none(noRows), 'scenario');
    lane('m-mismatch', 3, 'Margin rows that do not add up', mism.map(function (s) {
      return sItem(s, s.status, 'bad', 'Rows total ' + money(s.rowRev) + ' revenue and ' + money(s.rowCost) + ' cost; the scenario says ' + money(s.rev) + ' and ' + money(s.cost) + '.');
    }).sort(sortOld), 'bad', none(mism), 'scenario');
    lane('m-thin', 3, 'Margin below target, thin or negative', thin.map(function (s) {
      return sItem(s, s.tier || 'Below target', 'warn', s.pct != null && s.target != null && s.pct < s.target ? 'Margin ' + s.pct.toFixed(1) + '% against a target of ' + s.target.toFixed(1) + '%.' : 'Margin tier is ' + s.tier + '.');
    }).sort(sortOld), 'warn', none(thin), 'scenario');
    lane('m-orphan', 3, 'Scenario rows with no scenario', orphanRows.map(function (m) {
      return item('margin', { id: m.id, title: m.name || 'Margin row', sub: [m.family, m.lineModel].filter(Boolean).join(' / '), accountId: m.accountId, accountName: m.accountName, ms: m.ms, state: 'No scenario', tone: 'warn', note: 'The row says it came from the Studio but its scenario is missing.' });
    }).sort(sortOld), 'warn', none(orphanRows), 'margin');
    var modelPct = {};
    ['Proposed', 'Accepted'].forEach(function (st) {
      scenarios.filter(function (s) { return s.status === st; }).sort(function (a, b) { return (a.modMs || 0) - (b.modMs || 0); }).forEach(function (s) {
        var g = {}; s.rows.forEach(function (m) { if (!m.family || m.modelMargin == null || !(m.expected > 0)) return; var k = (m.accountId || s.accountId) + '|' + m.family; (g[k] = g[k] || { rev: 0, mar: 0 }); g[k].rev += m.expected; g[k].mar += m.modelMargin; });
        Object.keys(g).forEach(function (k) { modelPct[k] = { pct: g[k].mar / g[k].rev * 100, scenarioId: s.id, status: st }; });
      });
    });
    var latestMonth = actualRows.reduce(function (m, r) { return r.month > m ? r.month : m; }, '');
    var latestByKey = {};
    actualRows.forEach(function (r) { if (!r.accountId) return; var k = r.accountId + '|' + r.family; if (!latestByKey[k] || r.month > latestByKey[k]) latestByKey[k] = r.month; });
    var actByKey = {};
    actualRows.filter(function (r) { return r.accountId && r.month === latestByKey[r.accountId + '|' + r.family]; }).forEach(function (r) {
      var k = r.accountId + '|' + r.family, g = actByKey[k] = actByKey[k] || { key: k, accountId: r.accountId, accountName: r.accountName, family: r.family, month: r.month, rev: 0, cost: 0, costed: 0, rows: 0 };
      g.rows += 1; if (r.actual != null) { g.rev += r.rev || 0; g.cost += r.actual; g.costed += 1; }
    });
    var groups = Object.keys(actByKey).map(function (k) { return actByKey[k]; });
    var gapItems = [], noModel = [];
    groups.forEach(function (g) {
      if (!(g.rev > 0) || g.costed === 0) return;
      g.pct = (g.rev - g.cost) / g.rev * 100;
      var mp = modelPct[g.key];
      if (!mp) { noModel.push(g); return; }
      g.modelPct = mp.pct; g.scenarioId = mp.scenarioId; g.gap = g.pct - mp.pct;
      if (Math.abs(g.gap) >= gapPts) gapItems.push(g);
    });
    var gItem = function (g, tone, note) {
      return item('margin', { id: g.key, title: (g.accountName || 'Account') + ': ' + (g.family || 'device'), sub: 'Month ' + g.month + (g.pct != null ? ' / actual ' + g.pct.toFixed(1) + '%' : '') + (g.modelPct != null ? ' / modelled ' + g.modelPct.toFixed(1) + '%' : ''),
        accountId: g.accountId, accountName: g.accountName, state: g.gap != null ? (g.gap > 0 ? '+' : '') + g.gap.toFixed(1) + ' pts' : 'No model', tone: tone, note: note, scenarioId: g.scenarioId, accountKey: g.accountId });
    };
    var shortfalls = gapItems.filter(function (g) { return g.gap < 0; });
    var notCosted = actualRows.filter(function (r) { return r.actual == null; });
    var exceptions = actualRows.filter(function (r) { return r.status === 'Exception'; });
    var mItem = function (r, state, tone, note) {
      return item('margin', { id: r.id, title: (r.accountName || 'Account') + ': ' + (r.family || 'device'), sub: [r.month ? 'Month ' + r.month : '', r.rev != null ? money(r.rev) + ' revenue' : '', r.actual != null ? money(r.actual) + ' cost' : ''].filter(Boolean).join(' / '),
        accountId: r.accountId, accountName: r.accountName, ms: r.ms, state: state, tone: tone, note: note });
    };
    lane('a-rows', 4, 'Billing actuals', actualRows.map(function (r) { return mItem(r, r.status || 'Recorded', 'neutral'); }).sort(sortNew), 'neutral', marginsAvailable ? (actualRows.length ? latestMonth ? 'latest month ' + latestMonth : '' : 'no billing run has written actuals yet') : 'EM Margin could not be read', 'margin');
    lane('a-gap', 4, 'Actual margin differs from the model', gapItems.slice().sort(function (a, b) { return a.gap - b.gap; }).map(function (g) { return gItem(g, g.gap < 0 ? 'bad' : 'info', g.gap < 0 ? 'Earning ' + Math.abs(g.gap).toFixed(1) + ' points less than the model said.' : 'Earning ' + g.gap.toFixed(1) + ' points more than the model said.'); }), 'bad',
      gapItems.length ? 'a gap of ' + gapPts + ' points or more' : (actualRows.length ? 'None found' : 'starts when billing actuals exist'), 'margin');
    lane('a-nomodel', 4, 'Billed but never priced', noModel.map(function (g) { return gItem(g, 'warn', 'There are billing actuals for this account and device but no Proposed or Accepted scenario rows to compare with.'); }), 'warn', none(noModel), 'margin');
    lane('a-nocost', 4, 'Billing rows with no actual cost', notCosted.map(function (r) { return mItem(r, r.status || 'No cost', 'warn', 'Actual cost is blank, so the real margin is unknown.'); }).sort(sortNew), 'warn', none(notCosted), 'margin');
    lane('a-exc', 4, 'Billing rows marked Exception', exceptions.map(function (r) { return mItem(r, 'Exception', 'warn'); }).sort(sortNew), 'warn', none(exceptions), 'margin');
    var priced = {}; scenarios.forEach(function (s) { if (s.accountId && s.status !== 'Declined' && s.status !== 'Superseded') priced[s.accountId] = true; });
    var unpriced = ready.filter(function (c) { return !c.accountId || !priced[c.accountId]; });
    var belowAcc = by('Accepted').filter(function (s) { return thin.indexOf(s) >= 0; });
    lane('d-accepted', 5, 'Accepted scenarios', by('Accepted').map(function (s) { return sItem(s, 'Accepted', 'good'); }).sort(sortNew), 'good', '', 'scenario');
    lane('d-awaiting', 5, 'Proposals awaiting an answer', by('Proposed').map(function (s) { return sItem(s, 'Proposed', s.validDays != null && s.validDays < 0 ? 'warn' : 'info'); }).sort(sortOld), 'neutral', '', 'scenario');
    lane('d-unpriced', 5, 'Contracts never priced', unpriced.map(function (c) { return cItem(c, 'No scenario', 'warn', 'Verified customer rates exist, but no scenario is linked to this account.'); }).sort(sortOld), 'warn', none(unpriced), 'contract');
    lane('d-below', 5, 'Accepted but below target', belowAcc.map(function (s) { return sItem(s, 'Accepted', 'warn', s.pct != null && s.target != null ? 'Margin ' + s.pct.toFixed(1) + '% against ' + s.target.toFixed(1) + '%.' : 'Margin tier ' + s.tier + '.'); }), 'warn', none(belowAcc), 'scenario');
    var stages = [
      { n: 1, title: 'Inputs ready', big: ready.length, bigLabel: 'contracts ready to price', lanes: ['i-prod-ok', 'i-prod-nocost', 'i-prod-norate', 'i-prod-none', 'i-vr-ok', 'i-vr-obs', 'i-vr-none', 'i-vr-old', 'i-line-ready', 'i-line-wait'] },
      { n: 2, title: 'Scenarios', big: openSc.length, bigLabel: 'open scenarios', lanes: ['s-draft', 's-proposed', 's-accepted', 's-closed', 's-noacct', 's-empty', 's-missing', 's-expired', 's-draft-old'] },
      { n: 3, title: 'Margin rows', big: withRows.length, bigLabel: 'scenarios with saved margin rows', lanes: ['m-ok', 'm-norows', 'm-mismatch', 'm-thin', 'm-orphan'] },
      { n: 4, title: 'Actuals', big: actualRows.length, bigLabel: 'billing rows written', lanes: ['a-rows', 'a-gap', 'a-nomodel', 'a-nocost', 'a-exc'] },
      { n: 5, title: 'Decision', big: by('Accepted').length + by('Proposed').length, bigLabel: 'accepted or awaiting an answer', lanes: ['d-accepted', 'd-awaiting', 'd-unpriced', 'd-below'] }
    ];
    var stuck = [];
    if (mism.length) stuck.push({ lane: 'm-mismatch', tone: 'bad', text: plural(mism.length, 'scenario') + ' whose margin rows do not add up' });
    if (noRows.length) stuck.push({ lane: 'm-norows', tone: 'bad', text: plural(noRows.length, 'priced scenario') + ' with no margin rows saved' });
    if (shortfalls.length) stuck.push({ lane: 'a-gap', tone: 'bad', text: plural(shortfalls.length, 'account and device') + ' earning ' + gapPts + ' points or more below the model' });
    if (expired.length) stuck.push({ lane: 's-expired', tone: 'warn', text: plural(expired.length, 'proposal') + ' past the valid-until date' });
    if (pNoCost.length) stuck.push({ lane: 'i-prod-nocost', tone: 'warn', text: plural(pNoCost.length, 'active product') + ' with no cost entered' });
    if (rObs.length) stuck.push({ lane: 'i-vr-obs', tone: 'warn', text: plural(rObs.length, 'vendor rate') + ' only observed, not confirmed by contract' });
    if (unpriced.length) stuck.push({ lane: 'd-unpriced', tone: 'warn', text: plural(unpriced.length, 'contract') + ' with verified rates and no scenario' });
    if (noAcct.length) stuck.push({ lane: 's-noacct', tone: 'warn', text: plural(noAcct.length, 'open scenario') + ' with no account' });
    if (empty.length) stuck.push({ lane: 's-empty', tone: 'warn', text: plural(empty.length, 'open scenario') + ' with no revenue priced' });
    if (rOld.length) stuck.push({ lane: 'i-vr-old', tone: 'warn', text: plural(rOld.length, 'vendor rate') + ' not edited in over ' + plural(rateAge, 'day') });
    return { now: now, lanes: L, stages: stages, stuck: stuck, scById: scById, scByAccount: scByAccount, contracts: contracts, actualRows: actualRows, modelPct: modelPct, latestMonth: latestMonth,
      limits: { rateAgeDays: rateAge, draftAgeDays: draftAge, gapPts: gapPts },
      totals: { products: products.length, rates: rates.length, scenarios: scenarios.length, marginRows: margins.length, actuals: actualRows.length, contracts: contracts.length } };
  }
  function trace(model, it) {
    var s = it.scenarioId ? model.scById[it.scenarioId] || null : null;
    var acct = it.accountKey || it.accountId || (s && s.accountId) || null;
    var scs = s ? [s] : (acct ? model.scByAccount[acct] || [] : []);
    var cons = model.contracts.filter(function (c) { return acct && c.accountId === acct; });
    var acts = model.actualRows.filter(function (r) { return acct && r.accountId === acct; });
    return { scenario: s, scenarios: scs, contracts: cons, actuals: acts, account: acct || it.accountName ? { id: acct, name: it.accountName || (s && s.accountName) || '' } : null };
  }
  return { DEFAULTS: DEFAULTS, build: build, trace: trace, lineStatus: lineStatus, money: money };
});
