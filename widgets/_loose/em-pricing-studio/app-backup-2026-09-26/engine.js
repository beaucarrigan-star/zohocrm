/* =============================================================================
   EM Pricing Studio — pricing engine (no DOM, no Zoho). Loaded by widget.html and
   by the Node tests. Every figure the Studio shows comes from price().

   Conventions
   - A month is 365/12 = 30.4167 days. Daily rates x units x DAYS = one month.
   - "Active" units are on leg. Inactive units are assigned but not on leg.
     Spares are units the customer holds on the shelf. Fleet = active + inactive + spares.
   - Vendor spare allowance: the vendor lets you hold spares up to a % of ACTIVE units
     at no charge; every spare above that is charged at the spare overage daily rate.
   - The customer model (daily lease, SaaS, purchase) is separate from how JusticePoint
     sources the devices (lease them from the vendor, or buy the fleet). A customer
     purchase always means JP buys the devices and resells them.
   ============================================================================= */
(function (root) {
  'use strict';

  var DAYS = 365 / 12;
  var MODELS = {
    lease:    { key: 'lease',    label: 'Daily lease',       short: 'Lease' },
    saas:     { key: 'saas',     label: 'SaaS subscription', short: 'SaaS' },
    purchase: { key: 'purchase', label: 'Purchase + service', short: 'Purchase' }
  };
  var TIERS = [
    { max: 0,        key: 'neg',    label: 'Negative' },
    { max: 20,       key: 'thin',   label: 'Thin' },
    { max: 50,       key: 'normal', label: 'Normal' },
    { max: Infinity, key: 'strong', label: 'Strong' }
  ];

  var n = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var pct = function (v) { return n(v) / 100; };
  function tierOf(marginPct, revenue) {
    if (!(revenue > 0)) return { key: 'none', label: 'No revenue' };
    for (var i = 0; i < TIERS.length; i++) if (marginPct < TIERS[i].max) return TIERS[i];
    return TIERS[TIERS.length - 1];
  }

  function blankScenario() {
    return {
      id: null, name: 'New scenario', account: null, customerName: '', program: '',
      model: 'lease', vendorSource: 'lease', termMonths: 36, targetMarginPct: 35,
      priceEscalatorPct: 0, costEscalatorPct: 0,
      lines: [], staffing: [], fees: [],
      spareBilling: { enabled: false, overPct: 20, dailyRate: 0 },
      lostRatePct: 0, lostRecoveryPct: 0,
      minimumMonthly: 0,
      proposal: { validDays: 30, preparedBy: '', intro: '', options: ['current'], extraTerms: '', showMonthlyEstimate: true }
    };
  }
  function blankLine(itemId) {
    return { itemId: itemId || null, units: 10, inactivePct: 0, sparePct: 20,
      price: { leaseDaily: 0, inactiveDaily: 0, saasMonthly: 0, purchasePrice: 0, serviceDaily: 0, lostFee: 0 } };
  }

  /* ---------- one device line, one model ---------- */
  function priceLine(line, item, sc, model, k) {
    item = item || {};
    k = k == null ? 1 : k;                       /* price multiplier (target solver) */
    var src = model === 'purchase' ? 'buy' : (sc.vendorSource === 'buy' ? 'buy' : 'lease');
    var A = Math.max(0, n(line.units));
    var I = A * pct(line.inactivePct);
    var S = A * pct(line.sparePct);
    var F = A + I + S;
    var p = line.price || {};
    var out = { itemId: line.itemId, name: item.name || 'Device', active: A, inactive: I, spares: S, fleet: F, source: src,
      rev: { device: 0, spares: 0, lost: 0 }, cost: { device: 0, spares: 0, lost: 0, amort: 0 },
      onceRev: 0, onceCost: 0, capex: 0, missing: [] };

    /* vendor cost */
    if (src === 'lease') {
      if (!(n(item.costLeaseDaily) > 0)) out.missing.push('vendor lease $/day');
      out.cost.device = A * n(item.costLeaseDaily) * DAYS + I * n(item.costInactiveDaily) * DAYS;
      var allowed = A * pct(item.spareAllowancePct);
      out.sparesOverAllowance = Math.max(0, S - allowed);
      out.cost.spares = out.sparesOverAllowance * n(item.spareOverageDaily) * DAYS;
    } else {
      if (!(n(item.costPurchase) > 0)) out.missing.push('vendor purchase $/unit');
      out.sparesOverAllowance = 0;
      out.cost.device = A * n(item.costOwnedDaily) * DAYS;
      out.capex = F * n(item.costPurchase);
      if (model === 'purchase') { out.onceCost = out.capex; out.capex = 0; }
      else { var life = Math.max(1, n(item.usefulLifeMonths) || 36); out.cost.amort = out.capex / life; out.lifeMonths = life; }
    }

    /* losses: the customer owns purchased devices, so losses there are theirs */
    if (model !== 'purchase') {
      var lostPerMonth = F * pct(sc.lostRatePct) / 12;
      var repl = n(item.replacementCost) || (src === 'buy' ? n(item.costPurchase) : 0);
      out.lostUnits = lostPerMonth;
      out.cost.lost = lostPerMonth * repl;
      out.rev.lost = lostPerMonth * pct(sc.lostRecoveryPct) * n(p.lostFee);
    }

    /* customer revenue */
    if (model === 'lease') {
      out.rev.device = k * (A * n(p.leaseDaily) * DAYS + I * n(p.inactiveDaily) * DAYS);
    } else if (model === 'saas') {
      out.rev.device = k * (A + I) * n(p.saasMonthly);
    } else {
      out.rev.device = k * A * n(p.serviceDaily) * DAYS;
      out.onceRev = k * F * n(p.purchasePrice);
    }
    if (model !== 'purchase' && sc.spareBilling && sc.spareBilling.enabled) {
      var billable = Math.max(0, S - A * pct(sc.spareBilling.overPct));
      out.sparesBillable = billable;
      out.rev.spares = billable * n(sc.spareBilling.dailyRate) * DAYS;
    }
    out.revMonthly = out.rev.device + out.rev.spares + out.rev.lost;
    out.costMonthly = out.cost.device + out.cost.spares + out.cost.lost + out.cost.amort;
    out.marginMonthly = out.revMonthly - out.costMonthly;
    out.marginPct = out.revMonthly > 0 ? out.marginMonthly / out.revMonthly * 100 : 0;
    return out;
  }

  /* ---------- staffing ---------- */
  function priceStaff(s, activeTotal) {
    var P = s.participants == null || s.participants === '' ? activeTotal : Math.max(0, n(s.participants));
    var cost = s.costMethod === 'fte'
      ? n(s.fte) * n(s.fteMonthlyCost)
      : P * n(s.hoursPerParticipant) * n(s.costPerHour) * (1 + pct(s.overheadPct));
    var rev = s.priceMethod === 'monthly' ? n(s.priceMonthly) : P * n(s.priceDaily) * DAYS;
    return { name: s.name || 'Staffing', participants: P, revMonthly: rev, costMonthly: cost, marginMonthly: rev - cost };
  }

  /* ---------- fees ---------- */
  function priceFee(f, fleet) {
    var q = f.qtyBasis === 'perUnit' ? fleet : n(f.qty);
    return { name: f.name || 'Fee', when: f.when === 'monthly' ? 'monthly' : 'once', qty: q, rev: q * n(f.price), cost: q * n(f.cost) };
  }

  /* ---------- whole scenario ---------- */
  function price(sc, catalog, opts) {
    opts = opts || {};
    var model = opts.model || sc.model || 'lease';
    var k = opts.k == null ? 1 : opts.k;
    var byId = {};
    (catalog || []).forEach(function (c) { byId[String(c.id)] = c; });

    var lines = (sc.lines || []).map(function (l) { return priceLine(l, byId[String(l.itemId)], sc, model, k); });
    var sum = function (arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); };
    var active = sum(lines, function (l) { return l.active; });
    var fleet = sum(lines, function (l) { return l.fleet; });
    var staff = (sc.staffing || []).map(function (s) { return priceStaff(s, active); });
    var fees = (sc.fees || []).map(function (f) { return priceFee(f, fleet); });
    var feesM = fees.filter(function (f) { return f.when === 'monthly'; });
    var feesO = fees.filter(function (f) { return f.when === 'once'; });

    var R = {
      device: sum(lines, function (l) { return l.rev.device; }),
      spares: sum(lines, function (l) { return l.rev.spares; }),
      lost: sum(lines, function (l) { return l.rev.lost; }),
      staffing: sum(staff, function (s) { return s.revMonthly; }),
      fees: sum(feesM, function (f) { return f.rev; }),
      minimum: 0
    };
    var C = {
      device: sum(lines, function (l) { return l.cost.device; }),
      spares: sum(lines, function (l) { return l.cost.spares; }),
      lost: sum(lines, function (l) { return l.cost.lost; }),
      amort: sum(lines, function (l) { return l.cost.amort; }),
      staffing: sum(staff, function (s) { return s.costMonthly; }),
      fees: sum(feesM, function (f) { return f.cost; })
    };
    var recurring = R.device + R.spares + R.lost + R.staffing + R.fees;
    var minimum = n(sc.minimumMonthly);
    if (minimum > recurring) R.minimum = minimum - recurring;
    var revM = recurring + R.minimum;
    var costM = C.device + C.spares + C.lost + C.amort + C.staffing + C.fees;
    var cashCostM = costM - C.amort;               /* amortisation is not a cash cost */

    var once = {
      rev: sum(lines, function (l) { return l.onceRev; }) + sum(feesO, function (f) { return f.rev; }),
      cost: sum(lines, function (l) { return l.onceCost; }) + sum(feesO, function (f) { return f.cost; }),
      capex: sum(lines, function (l) { return l.capex; })
    };

    /* term: month-by-month so escalators and the minimum apply correctly */
    var T = Math.max(1, Math.round(n(sc.termMonths) || 12));
    var pe = pct(sc.priceEscalatorPct), ce = pct(sc.costEscalatorPct);
    var termRev = once.rev, termCost = once.cost, cash = once.rev - once.cost - once.capex;
    var cum = [cash], payback = cash >= 0 ? 0 : null;
    for (var m = 1; m <= T; m++) {
      var yr = Math.floor((m - 1) / 12);
      var rm = Math.max(recurring * Math.pow(1 + pe, yr), minimum);
      var cm = (costM - C.amort) * Math.pow(1 + ce, yr);
      termRev += rm; termCost += cm + C.amort;
      cash += rm - cm; cum.push(cash);
      if (payback == null && cash >= 0) payback = m;
    }
    /* owned fleet still has book value at the end of a term shorter than its life */
    var residual = 0;
    lines.forEach(function (l) { if (l.capex > 0 && l.lifeMonths) residual += l.capex * Math.max(0, 1 - T / l.lifeMonths); });

    var marginM = revM - costM;
    var termMargin = termRev - termCost;
    var unitDays = active * DAYS;

    /* price multiplier that lands the term margin on target (device prices only; fees, staffing
       and the minimum are held fixed). Revenue is linear in k, so this is exact apart from the
       minimum, which is ignored here and reported. */
    var target = pct(sc.targetMarginPct), solve = null;
    if (!opts.noSolve && target < 1) {
      var base = price(sc, catalog, { model: model, k: 0, noSolve: true });
      var one = price(sc, catalog, { model: model, k: 1, noSolve: true });
      var slope = one.term.revenueExMin - base.term.revenueExMin;   /* device-price revenue at k = 1 */
      if (slope > 0) {
        var needRev = one.term.cost / (1 - target);
        var kk = (needRev - base.term.revenueExMin) / slope;
        solve = { k: kk, feasible: kk > 0, neededTermRevenue: needRev };
      } else solve = { k: null, feasible: false, reason: 'Enter prices for this model first.' };
    }

    var missing = [];
    lines.forEach(function (l) { l.missing.forEach(function (m) { missing.push(l.name + ': ' + m); }); });

    return {
      model: model, modelLabel: MODELS[model].label, vendorSource: model === 'purchase' ? 'buy' : sc.vendorSource,
      lines: lines, staffing: staff, fees: fees,
      units: { active: active, fleet: fleet, unitDays: unitDays },
      monthly: { revenue: revM, cost: costM, cashCost: cashCostM, margin: marginM, marginPct: revM > 0 ? marginM / revM * 100 : 0, rev: R, costs: C, recurringBeforeMinimum: recurring },
      once: once,
      term: { months: T, revenue: termRev, revenueExMin: termRevExMin(sc, recurring, once, T, pe), cost: termCost, margin: termMargin, marginPct: termRev > 0 ? termMargin / termRev * 100 : 0, residual: residual, cumulativeCash: cum, paybackMonth: payback },
      perUnitDay: unitDays > 0 ? { revenue: revM / unitDays, cost: costM / unitDays, breakEven: costM / unitDays, target: target < 1 ? costM / (1 - target) / unitDays : null } : null,
      tier: tierOf(revM > 0 ? marginM / revM * 100 : 0, revM),
      solve: solve, missing: missing
    };
  }
  function termRevExMin(sc, recurring, once, T, pe) {
    var t = once.rev;
    for (var m = 1; m <= T; m++) t += recurring * Math.pow(1 + pe, Math.floor((m - 1) / 12));
    return t;
  }

  /* the same scenario under every customer model */
  function compare(sc, catalog) {
    return Object.keys(MODELS).map(function (m) { return price(sc, catalog, { model: m }); });
  }

  /* volume sensitivity: margin at a range of volume multipliers */
  function sensitivity(sc, catalog, steps) {
    steps = steps || [0.5, 0.75, 1, 1.25, 1.5];
    return steps.map(function (f) {
      var s = JSON.parse(JSON.stringify(sc));
      s.lines.forEach(function (l) { l.units = n(l.units) * f; });
      s.staffing.forEach(function (st) { if (st.participants != null && st.participants !== '') st.participants = n(st.participants) * f; });
      var r = price(s, catalog, { noSolve: true });
      return { factor: f, active: r.units.active, marginPct: r.monthly.marginPct, margin: r.monthly.margin, revenue: r.monthly.revenue };
    });
  }

  /* multiply this model's device prices by k (used by "Apply target price") */
  function applyMultiplier(sc, model, k) {
    var keys = model === 'lease' ? ['leaseDaily', 'inactiveDaily'] : model === 'saas' ? ['saasMonthly'] : ['purchasePrice', 'serviceDaily'];
    sc.lines.forEach(function (l) { keys.forEach(function (key) { l.price[key] = Math.round(n(l.price[key]) * k * 100) / 100; }); });
    return sc;
  }

  var api = { DAYS: DAYS, MODELS: MODELS, TIERS: TIERS, tierOf: tierOf, price: price, compare: compare, sensitivity: sensitivity,
    applyMultiplier: applyMultiplier, blankScenario: blankScenario, blankLine: blankLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PricingEngine = api;
})(this);
