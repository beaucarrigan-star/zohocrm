/* =============================================================================
   EM Pricing Studio - pricing engine (no DOM, no Zoho). Loaded by widget.html and
   by the Node tests. Every figure the Studio shows comes from price().

   Conventions
   - A month is 365/12 = 30.4167 days. Daily rates x units x DAYS = one month.
   - "Active" units are on leg. Spares are units the customer holds on the shelf.
     Fleet = active + spares. Spares above the free % are billed at each device's $/spare day.
   - Volume tiers (whole volume): a device's active-unit count picks ONE tier, and that
     tier's rates apply to every unit. Blank tier values fall back to the base rate.
     Cost tiers live on the catalog item (costTiers), price tiers on the scenario line.
   - Vendor volume: a vendor bills on JusticePoint's TOTAL units with them, so cost tiers are
     picked by (current units with that vendor + this scenario's active units for that
     vendor's devices). Current units come from sc.vendorVolume[vendorId]: override if set,
     otherwise the value read from the Zoho vendor (zoho). useNext = model the next cheaper tier.
   - Manual vendor price: sc.vendorVolume[vendorId].rates[itemId] replaces the tiered rate
     (lease $/day when leasing, owned svc $/day when JusticePoint owns the fleet).
   - Costs are whatever you enter in the Cost catalog. Free spares % and Spare $/day:
     spares up to that % of active units cost nothing; each spare above costs Spare $/day.
   - The customer model (daily lease, Transparent Pricing, purchase) is separate from how
     JusticePoint gets the devices (lease them, or buy the fleet). A customer purchase
     always means JusticePoint buys the devices and resells them.
   - Break-even (owned devices): months until the device investment, less anything the
     customer pays up front, is recovered by the cash margin those devices earn.
   ============================================================================= */
(function (root) {
  'use strict';

  var DAYS = 365 / 12;
  /* keys are stored on saved scenarios; change labels here, not keys */
  var MODELS = {
    lease:    { key: 'lease',    label: 'Daily lease',         short: 'Lease' },
    saas:     { key: 'saas',     label: 'Transparent Pricing', short: 'Transparent' },
    purchase: { key: 'purchase', label: 'Purchase + service',  short: 'Purchase' }
  };
  var TIERS = [
    { max: 0,        key: 'neg',    label: 'Negative' },
    { max: 20,       key: 'thin',   label: 'Thin' },
    { max: 50,       key: 'normal', label: 'Normal' },
    { max: Infinity, key: 'strong', label: 'Strong' }
  ];
  /* customer price keys each model uses (drives the builder columns and the target solver) */
  var PRICE_KEYS = { lease: ['leaseDaily', 'spareDaily'], saas: ['saasMonthly', 'spareDaily'], purchase: ['purchasePrice', 'serviceDaily'] };

  var n = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var set = function (v) { return v != null && v !== '' && isFinite(Number(v)); };
  /* whole-volume tier: the tier with the highest "from" that qty reaches (null = base rates) */
  function pickTier(tiers, qty) {
    if (!Array.isArray(tiers)) return null;
    var best = null;
    tiers.forEach(function (t) { if (t && set(t.min) && n(t.min) > 0 && qty >= n(t.min) && (!best || n(t.min) > n(best.min))) best = t; });
    return best;
  }
  function nextTier(tiers, qty) {
    if (!Array.isArray(tiers)) return null;
    var best = null;
    tiers.forEach(function (t) { if (t && set(t.min) && n(t.min) > qty && (!best || n(t.min) < n(best.min))) best = t; });
    return best;
  }
  function overlay(base, tier, keys) {
    var o = Object.assign({}, base || {});
    if (tier) keys.forEach(function (k) { if (set(tier[k])) o[k] = n(tier[k]); });
    return o;
  }
  var COST_TIER_KEYS = ['costLeaseDaily', 'spareOverageDaily', 'costPurchase', 'costOwnedDaily'];
  var PRICE_TIER_KEYS = ['leaseDaily', 'spareDaily', 'saasMonthly', 'purchasePrice', 'serviceDaily'];
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
      spareBilling: { overPct: 20 },
      lostRatePct: 0, lostRecoveryPct: 0,
      minimumMonthly: 0,
      proposal: { validDays: 30, preparedBy: '', intro: '', options: ['current'], extraTerms: '', showMonthlyEstimate: true }
    };
  }
  function blankLine(itemId) {
    return { itemId: itemId || null, units: 10, sparePct: 20,
      price: { leaseDaily: 0, spareDaily: 0, saasMonthly: 0, purchasePrice: 0, serviceDaily: 0, lostFee: 0 },
      priceTiers: [],   /* [{ min, leaseDaily, spareDaily, saasMonthly, purchasePrice, serviceDaily }] */
      confirmed: {} };   /* price key -> value you chose to keep when it differs from Zoho */
  }

  /* ---------- one device line, one model ---------- */
  function priceLine(line, item, sc, model, k, srcOverride, ctx) {
    ctx = ctx || {};
    item = item || {};
    k = k == null ? 1 : k;                       /* price multiplier (target solver) */
    var src = model === 'purchase' ? 'buy' : ((srcOverride || sc.vendorSource) === 'buy' ? 'buy' : 'lease');
    var A = Math.max(0, n(line.units));
    var S = A * pct(line.sparePct);
    var F = A + S;
    var costQty = ctx.costQty == null ? A : ctx.costQty;
    var ct = pickTier(item.costTiers, costQty), nt = nextTier(item.costTiers, costQty), pt = pickTier(line.priceTiers, A);
    var modelNext = !!(ctx.forceNext && nt);
    var baseItem = item;
    item = overlay(item, modelNext ? nt : ct, COST_TIER_KEYS);
    var rateKey = src === 'lease' ? 'costLeaseDaily' : 'costOwnedDaily';
    var manual = set(ctx.manual) ? n(ctx.manual) : null;
    if (manual != null) item[rateKey] = manual;
    var p = overlay(line.price, pt, PRICE_TIER_KEYS);
    var out = { itemId: line.itemId, name: item.name || 'Device', active: A, spares: S, fleet: F, source: src,
      costTier: manual != null ? null : (modelNext ? n(nt.min) : (ct ? n(ct.min) : null)), priceTier: pt ? n(pt.min) : null, rates: p,
      vendorId: ctx.vendorId || '', costQty: costQty, modelNext: modelNext && manual == null, manual: manual, rateKey: rateKey, costRate: n(item[rateKey]),
      actualTier: ct ? n(ct.min) : null, actualRate: n(overlay(baseItem, ct, COST_TIER_KEYS)[rateKey]),
      nextCost: nt ? { min: n(nt.min), rate: n(overlay(baseItem, nt, COST_TIER_KEYS)[rateKey]) } : null,
      hasCostTiers: Array.isArray(baseItem.costTiers) && baseItem.costTiers.length > 0,
      rev: { device: 0, spares: 0, lost: 0 }, cost: { device: 0, spares: 0, lost: 0, amort: 0 },
      onceRev: 0, onceCost: 0, capex: 0, missing: [] };

    /* JusticePoint cost */
    if (src === 'lease') {
      if (!(n(item.costLeaseDaily) > 0)) out.missing.push('lease $/day');
      out.cost.device = A * n(item.costLeaseDaily) * DAYS;          
      out.sparesOverAllowance = Math.max(0, S - A * pct(item.spareAllowancePct));
      out.cost.spares = out.sparesOverAllowance * n(item.spareOverageDaily) * DAYS;
    } else {
      if (!(n(item.costPurchase) > 0)) out.missing.push('buy $/unit');
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
    if (model === 'lease') out.rev.device = k * A * n(p.leaseDaily) * DAYS;
    else if (model === 'saas') out.rev.device = k * A * n(p.saasMonthly);
    else { out.rev.device = k * A * n(p.serviceDaily) * DAYS; out.onceRev = k * F * n(p.purchasePrice); }

    if (model !== 'purchase' && n(p.spareDaily) > 0) {
      var billable = Math.max(0, S - A * pct((sc.spareBilling || {}).overPct));
      out.sparesBillable = billable;
      out.rev.spares = billable * n(p.spareDaily) * DAYS;
    }
    out.revMonthly = out.rev.device + out.rev.spares + out.rev.lost;
    out.costMonthly = out.cost.device + out.cost.spares + out.cost.lost + out.cost.amort;
    out.marginMonthly = out.revMonthly - out.costMonthly;
    out.marginPct = out.revMonthly > 0 ? out.marginMonthly / out.revMonthly * 100 : 0;

    if (src === 'buy') {
      var invest = out.capex + out.onceCost, net = invest - out.onceRev;
      var cashM = out.revMonthly - (out.costMonthly - out.cost.amort);   /* depreciation is not cash */
      out.breakEven = { investment: invest, upfront: out.onceRev, netInvestment: net, monthlyCash: cashM,
        perUnitCost: n(item.costPurchase), units: F,
        months: net <= 0 ? 0 : (cashM > 0 ? net / cashM : null),
        lifeMonths: out.lifeMonths || Math.max(1, n(item.usefulLifeMonths) || 36) };
    }
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
    if (!MODELS[model]) model = 'lease';
    var k = opts.k == null ? 1 : opts.k;
    var srcOverride = opts.vendorSource || null;      /* 'buy' = what-if JusticePoint owns the fleet */
    var byId = {};
    (catalog || []).forEach(function (c) { byId[String(c.id)] = c; });

    var vv = sc.vendorVolume || {};
    var vendorOf = function (l) { var it = byId[String(l.itemId)]; return it && it.vendorId ? String(it.vendorId) : ''; };
    var vScen = {}, vOrder = [];
    (sc.lines || []).forEach(function (l) { var v = vendorOf(l); if (!v) return; if (vScen[v] == null) { vScen[v] = 0; vOrder.push(v); } vScen[v] += Math.max(0, n(l.units)); });
    var vEntry = function (v) { return vv[v] || {}; };
    var vCur = function (v) { var x = vEntry(v); return set(x.override) ? Math.max(0, n(x.override)) : Math.max(0, n(x.zoho)); };
    var ctxOf = function (l, force) {
      var v = vendorOf(l); if (!v) return {};
      var e = vEntry(v), man = e.rates ? e.rates[String(l.itemId)] : null;
      return { vendorId: v, costQty: vCur(v) + vScen[v], forceNext: force == null ? !!e.useNext : force, manual: man };
    };
    var lines = (sc.lines || []).map(function (l) { return priceLine(l, byId[String(l.itemId)], sc, model, k, srcOverride, ctxOf(l)); });
    var lineCost = function (x) { return x.costMonthly; };
    var vendors = vOrder.map(function (v) {
      var idx = [], now = 0, next = 0;
      (sc.lines || []).forEach(function (l, i) { if (vendorOf(l) === v) idx.push(i); });
      idx.forEach(function (i) {
        var l = sc.lines[i], it = byId[String(l.itemId)];
        now += lineCost(priceLine(l, it, sc, model, k, srcOverride, ctxOf(l, false)));
        next += lineCost(priceLine(l, it, sc, model, k, srcOverride, ctxOf(l, true)));
      });
      var vl = idx.map(function (i) { return lines[i]; });
      var mins = vl.filter(function (x) { return x.nextCost && x.manual == null; }).map(function (x) { return x.nextCost.min; });
      var total = vCur(v) + vScen[v], nextMin = mins.length ? Math.min.apply(null, mins) : null;
      var e = vEntry(v);
      return { vendorId: v, name: e.name || '', zoho: set(e.zoho) ? n(e.zoho) : null, override: set(e.override) ? n(e.override) : null,
        current: vCur(v), scenarioUnits: vScen[v], total: total, useNext: !!e.useNext,
        hasTiers: vl.some(function (x) { return x.hasCostTiers; }),
        lines: vl.map(function (x) { return { itemId: x.itemId, name: x.name, tierMin: x.actualTier, rate: x.actualRate, next: x.nextCost, modelled: x.modelNext, manual: x.manual, rateKey: x.rateKey, effective: x.costRate }; }),
        nextMin: nextMin, unitsToNext: nextMin == null ? null : Math.max(0, Math.ceil(nextMin - total)),
        monthlyNow: now, monthlyAtNext: next, savingsMonthly: now - next };
    });
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

    var once = {
      rev: sum(lines, function (l) { return l.onceRev; }) + sum(feesO, function (f) { return f.rev; }),
      cost: sum(lines, function (l) { return l.onceCost; }) + sum(feesO, function (f) { return f.cost; }),
      capex: sum(lines, function (l) { return l.capex; })
    };

    /* term: month by month so escalators and the minimum apply correctly */
    var T = Math.max(1, Math.round(n(sc.termMonths) || 12));
    var pe = pct(sc.priceEscalatorPct), ce = pct(sc.costEscalatorPct);
    var termRev = once.rev, termCost = once.cost, cash = once.rev - once.cost - once.capex;
    var cum = [cash], payback = cash >= 0 ? 0 : null, paybackExact = cash >= 0 ? 0 : null;
    for (var m = 1; m <= T; m++) {
      var yr = Math.floor((m - 1) / 12);
      var rm = Math.max(recurring * Math.pow(1 + pe, yr), minimum);
      var cm = (costM - C.amort) * Math.pow(1 + ce, yr);
      termRev += rm; termCost += cm + C.amort;
      var before = cash;
      cash += rm - cm; cum.push(cash);
      if (payback == null && cash >= 0) { payback = m; paybackExact = (m - 1) + (rm - cm > 0 ? -before / (rm - cm) : 1); }
    }
    var residual = 0;
    lines.forEach(function (l) { if (l.capex > 0 && l.lifeMonths) residual += l.capex * Math.max(0, 1 - T / l.lifeMonths); });

    var marginM = revM - costM, termMargin = termRev - termCost, unitDays = active * DAYS;

    /* price multiplier that lands the term margin on target (device prices only) */
    var target = pct(sc.targetMarginPct), solve = null;
    if (!opts.noSolve && target < 1) {
      var base = price(sc, catalog, { model: model, k: 0, noSolve: true, vendorSource: srcOverride });
      var one = price(sc, catalog, { model: model, k: 1, noSolve: true, vendorSource: srcOverride });
      var slope = one.term.revenueExMin - base.term.revenueExMin;
      if (slope > 0) {
        var needRev = one.term.cost / (1 - target);
        var kk = (needRev - base.term.revenueExMin) / slope;
        solve = { k: kk, feasible: kk > 0, neededTermRevenue: needRev };
      } else solve = { k: null, feasible: false, reason: 'Enter prices for this model first.' };
    }

    /* whole-deal break-even on owned devices */
    var beLines = lines.filter(function (l) { return l.breakEven; }), breakEven = null;
    if (beLines.length) {
      var inv = sum(beLines, function (l) { return l.breakEven.investment; });
      var up = sum(beLines, function (l) { return l.breakEven.upfront; });
      var dm = sum(beLines, function (l) { return l.breakEven.monthlyCash; });
      breakEven = { investment: inv, upfront: up, netInvestment: inv - up, deviceMonthlyCash: dm,
        deviceMonths: inv - up <= 0 ? 0 : (dm > 0 ? (inv - up) / dm : null),
        dealMonths: paybackExact, termMonths: T };
    }

    var missing = [];
    lines.forEach(function (l) { l.missing.forEach(function (x) { missing.push(l.name + ': ' + x); }); });

    return {
      model: model, modelLabel: MODELS[model].label, vendorSource: model === 'purchase' ? 'buy' : (srcOverride || sc.vendorSource),
      lines: lines, staffing: staff, fees: fees,
      units: { active: active, fleet: fleet, unitDays: unitDays },
      monthly: { revenue: revM, cost: costM, cashCost: costM - C.amort, margin: marginM, marginPct: revM > 0 ? marginM / revM * 100 : 0, rev: R, costs: C, recurringBeforeMinimum: recurring },
      once: once,
      term: { months: T, revenue: termRev, revenueExMin: termRevExMin(recurring, once, T, pe), cost: termCost, margin: termMargin, marginPct: termRev > 0 ? termMargin / termRev * 100 : 0, residual: residual, cumulativeCash: cum, paybackMonth: payback },
      perUnitDay: unitDays > 0 ? { revenue: revM / unitDays, cost: costM / unitDays, target: target < 1 ? costM / (1 - target) / unitDays : null } : null,
      tier: tierOf(revM > 0 ? marginM / revM * 100 : 0, revM),
      solve: solve, missing: missing, breakEven: breakEven, vendors: vendors
    };
  }
  function termRevExMin(recurring, once, T, pe) {
    var t = once.rev;
    for (var m = 1; m <= T; m++) t += recurring * Math.pow(1 + pe, Math.floor((m - 1) / 12));
    return t;
  }

  function compare(sc, catalog) { return Object.keys(MODELS).map(function (m) { return price(sc, catalog, { model: m }); }); }

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

  function applyMultiplier(sc, model, k) {
    var keys = (PRICE_KEYS[model] || []).filter(function (x) { return x !== 'spareDaily'; });   /* solver scales device prices only */
    var r2 = function (v) { return Math.round(n(v) * k * 100) / 100; };
    sc.lines.forEach(function (l) {
      keys.forEach(function (key) { l.price[key] = r2(l.price[key]); });
      (l.priceTiers || []).forEach(function (t) { keys.forEach(function (key) { if (set(t[key])) t[key] = r2(t[key]); }); });
    });
    return sc;
  }

  var api = { DAYS: DAYS, MODELS: MODELS, TIERS: TIERS, PRICE_KEYS: PRICE_KEYS, tierOf: tierOf, pickTier: pickTier, nextTier: nextTier, COST_TIER_KEYS: COST_TIER_KEYS, PRICE_TIER_KEYS: PRICE_TIER_KEYS, price: price, compare: compare,
    sensitivity: sensitivity, applyMultiplier: applyMultiplier, blankScenario: blankScenario, blankLine: blankLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PricingEngine = api;
})(this);
