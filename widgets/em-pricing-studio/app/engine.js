/* =============================================================================
   EM Pricing Studio - pricing engine (no DOM, no Zoho). Loaded by widget.html and
   by the Node tests. Every figure the Studio shows comes from price().

   Conventions
   - A month is 365/12 = 30.4167 days. Daily rates x units x DAYS = one month.
   - "Active" units are on leg. Spares are units the customer holds on the shelf.
     Fleet = active + spares. Spares above the free % are billed at each device's $/spare day
     (daily lease only).
   - Volume tiers (whole volume): a device's active-unit count picks ONE tier, and that
     tier's rates apply to every unit. Blank tier values fall back to the base rate.
     Cost tiers live on the catalog item (costTiers), price tiers on the scenario line.
   - Vendor volume: a vendor bills on JusticePoint's TOTAL units with them, so cost tiers are
     picked by (current units with that vendor + this scenario's active units for that
     vendor's devices). Current units come from sc.vendorVolume[vendorId]: override if set,
     otherwise the value read from the Zoho vendor (zoho). useNext = model the next cheaper tier.
   - Manual vendor price: sc.vendorVolume[vendorId].rates[itemId] replaces the tiered rate
     (lease $/day when leasing, owned svc $/day when JusticePoint purchases from the manufacturer).
   - Costs are whatever you enter in the Cost catalog. Free spares % and Spare $/day:
     spares up to that % of active units cost nothing; each spare above costs Spare $/day.
   - The customer model (daily lease, Transparent pricing, purchase) is separate from how
     JusticePoint gets the devices (lease from the manufacturer, or purchase from the
     manufacturer). A customer purchase always means JusticePoint buys the devices and resells them.
   - Transparent pricing: the customer commits to a number of units and pays one flat daily
     rate for every committed unit on every day of the month, used or not. No spare charges.
     The commitment can step up at set months (line.commitSteps = [{ month, units }]).
     v89: the rate is built from cost: the vendor daily rate (lease $/day at the month-1 tier, or
     owned svc $/day when purchased from the manufacturer; a vendor quote wins) + one add-on $/day
     per device (line.price.transparentAddOn). The total is the customer's $/committed unit/day and
     is what the proposal shows. The rate does not carry spares: JusticePoint's spares are not
     priced into it, but the manufacturer's spare charges stay in JusticePoint's cost.
     Older saves hold a full rate in price.transparentDaily; tpConvert() turns it into an add-on.
     JusticePoint's vendor cost treats every committed unit as on leg, plus the spares % it holds.
   - The term is priced month by month, so step increases, escalators and fleet purchases
     for added units land in the month they happen. The headline "monthly" figures are month 1.
   - Cost + admin (costplus, v88): devices are billed at exactly what the vendor charges JusticePoint per active unit
     per day (current tier; owned svc + depreciation when JP owns the fleet), spares above the catalog's free % at their
     cost, and staffing budget lines at cost. The admin rate (adminRatePct) is then applied ONCE, to the whole budget:
     devices + spares + staffing + recurring fees (R.admin), and to one-time fees. Loss-recovery fees are outside it.
     Device pass-through (and its admin) escalates with the cost escalator; the target solver returns the admin rate
     that lands the term margin (solve.adminPct).
   - Staffing priceMethod 'budget' (v86): a fixed monthly line = the service's cost x (1 + markupPct), blank markup =
     the scenario admin rate. It sits in the budget as its own line instead of being recouped through unit rates.
   - Break-even (owned devices): months until the device investment, less anything the
     customer pays up front, is recovered by the cash margin those devices earn.
   ============================================================================= */
(function (root) {
  'use strict';

  var DAYS = 365 / 12;
  /* keys are stored on saved scenarios; change labels here, not keys */
  var MODELS = {
    lease:       { key: 'lease',       label: 'Daily lease',         short: 'Lease' },
    transparent: { key: 'transparent', label: 'Transparent pricing', short: 'Transparent' },
    purchase:    { key: 'purchase',    label: 'Purchase + service',  short: 'Purchase' },
    costplus:    { key: 'costplus',    label: 'Cost + admin',        short: 'Cost-plus' }
  };
  var TIERS = [
    { max: 0,        key: 'neg',    label: 'Negative' },
    { max: 20,       key: 'thin',   label: 'Thin' },
    { max: 50,       key: 'normal', label: 'Normal' },
    { max: Infinity, key: 'strong', label: 'Strong' }
  ];
  /* customer price keys each model uses (drives the builder columns and the target solver) */
  var PRICE_KEYS = { lease: ['leaseDaily', 'spareDaily'], transparent: ['transparentAddOn'], purchase: ['purchasePrice', 'serviceDaily'], costplus: [] };   /* cost-plus rates come from the cost; transparent = vendor rate + add-on */

  var n = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
  var set = function (v) { return v != null && v !== '' && isFinite(Number(v)); };
  var r2 = function (v) { return Math.round(n(v) * 100) / 100; };
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
  var PRICE_TIER_KEYS = ['leaseDaily', 'spareDaily', 'transparentAddOn', 'transparentDaily', 'purchasePrice', 'serviceDaily'];   /* transparentDaily: older saves only */
  var pct = function (v) { return n(v) / 100; };
  var sum = function (arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); };

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
      adminRatePct: 12,    /* Cost + admin model, and the default markup on staffing budget lines */
      lines: [], staffing: [], fees: [],
      spareBilling: { overPct: 20 },
      lostRatePct: 0, lostRecoveryPct: 0,
      minimumMonthly: 0,   /* no longer editable in the Studio; kept so older saved scenarios still price the same */
      proposal: { validDays: 30, preparedBy: '', intro: '', options: ['current'], extraTerms: '', showMonthlyEstimate: true }
    };
  }
  function blankLine(itemId) {
    return { itemId: itemId || null, units: 10, sparePct: 20,
      commitUnits: null,   /* Transparent: units the customer commits to from month 1 (blank = the active count) */
      commitSteps: [],     /* Transparent: [{ month, units }] the commitment becomes `units` from that month */
      price: { leaseDaily: 0, spareDaily: 0, transparentAddOn: 0, purchasePrice: 0, serviceDaily: 0, lostFee: 0 },
      priceTiers: [] };    /* [{ min, leaseDaily, spareDaily, transparentAddOn, purchasePrice, serviceDaily }] */
  }
  /* older saves: the SaaS model (saasMonthly, $/unit/month) became Transparent pricing (transparentDaily, $/unit/day);
     inactive units and the Use Zoho / Keep matching were removed. A full transparentDaily rate with no add-on is
     kept as is here (it still prices the same) and is turned into an add-on by tpConvert() once costs are loaded. */
  function migrate(sc) {
    if (!sc) return sc;
    var m2d = function (o) { if (o && o.transparentDaily == null && set(o.saasMonthly)) o.transparentDaily = Math.round(n(o.saasMonthly) / DAYS * 100) / 100; if (o) delete o.saasMonthly; };
    if (sc.model === 'saas') sc.model = 'transparent';
    if (sc.adminRatePct === undefined) sc.adminRatePct = 12;
    if (sc.proposal && Array.isArray(sc.proposal.options)) sc.proposal.options = sc.proposal.options.map(function (o) { return o === 'saas' ? 'transparent' : o; });
    (sc.lines || []).forEach(function (l) {
      l.price = l.price || {};
      m2d(l.price);
      if (!set(l.price.transparentAddOn) && !(n(l.price.transparentDaily) > 0)) { l.price.transparentAddOn = 0; delete l.price.transparentDaily; }
      delete l.price.inactiveDaily; delete l.inactivePct; delete l.confirmed;
      if (!Array.isArray(l.priceTiers)) l.priceTiers = [];
      l.priceTiers.forEach(m2d);
      if (!Array.isArray(l.commitSteps)) l.commitSteps = [];
      if (l.commitUnits === undefined) l.commitUnits = null;
    });
    return sc;
  }
  /* a line still carrying an older full transparent rate (no add-on yet) */
  var tpLegacy = function (l) { return !!l && !!l.price && !set(l.price.transparentAddOn) && n(l.price.transparentDaily) > 0; };

  /* committed units in month m (1-based): the starting commitment, then the latest step at or before m */
  function committedAt(line, m) {
    var u = set(line.commitUnits) ? n(line.commitUnits) : n(line.units);
    (line.commitSteps || []).slice().sort(function (a, b) { return n(a.month) - n(b.month); }).forEach(function (s) {
      if (s && n(s.month) >= 1 && n(s.month) <= m && set(s.units)) u = n(s.units);
    });
    return Math.max(0, u);
  }
  /* the months (within T) at which any line's commitment changes, in order */
  function stepMonths(sc, T) {
    var out = {};
    (sc.lines || []).forEach(function (l) { (l.commitSteps || []).forEach(function (s) { var m = Math.round(n(s.month)); if (s && set(s.units) && m >= 2 && m <= T) out[m] = 1; }); });
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------- one device line, one model, one month's volume ---------- */
  function priceLine(line, item, sc, model, k, srcOverride, ctx, units) {
    ctx = ctx || {};
    item = item || {};
    k = k == null ? 1 : k;                       /* price multiplier (target solver) */
    var src = model === 'purchase' ? 'buy' : ((srcOverride || sc.vendorSource) === 'buy' ? 'buy' : 'lease');
    var A = Math.max(0, units == null ? n(line.units) : n(units));
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
      onceRev: 0, onceCost: 0, capex: 0, buyUnit: 0, missing: [] };

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
      out.buyUnit = n(item.costPurchase);
      out.capex = F * out.buyUnit;
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
    else if (model === 'transparent') {
      /* vendor daily rate (fixed at the month-1 tier by price()) + the add-on; every committed unit, every day */
      out.tpBase = set(ctx.tpBase) ? n(ctx.tpBase) : out.costRate;
      if (tpLegacy(line)) { out.tpLegacy = true; out.tpAddOn = n(p.transparentDaily) - out.tpBase; out.tpRate = n(p.transparentDaily); out.rev.device = k * A * out.tpRate * DAYS; }
      else { out.tpAddOn = n(p.transparentAddOn); out.tpRate = out.tpBase + out.tpAddOn; out.rev.device = A * (out.tpBase + k * out.tpAddOn) * DAYS; }
      out.rates = Object.assign({}, p, { transparentDaily: out.tpRate });
    }
    else if (model === 'costplus') {
      /* billed at what the vendor charges (current tier, depreciation on owned units); the admin rate goes on the whole budget in price() */
      out.rev.device = k * (out.cost.device + out.cost.amort);
      out.rev.spares = k * out.cost.spares;
      out.cpRate = A > 0 ? (out.cost.device + out.cost.amort) / A / DAYS : n(item[rateKey]);
      out.cpSpareRate = src === 'lease' ? n(item.spareOverageDaily) : 0;
      out.sparesBillable = out.sparesOverAllowance;
      out.cpPass = out.rev.device + out.rev.spares;
    }
    else { out.rev.device = k * A * n(p.serviceDaily) * DAYS; out.onceRev = k * F * n(p.purchasePrice); }

    /* spare charges apply to the daily lease only (Transparent is all-in; purchased units are the customer's) */
    if (model === 'lease' && n(p.spareDaily) > 0) {
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
  function priceStaff(s, activeTotal, adminPct, model) {
    var P = s.participants == null || s.participants === '' ? activeTotal : Math.max(0, n(s.participants));
    var cost = s.costMethod === 'fte'
      ? n(s.fte) * n(s.fteMonthlyCost)
      : P * n(s.hoursPerParticipant) * n(s.costPerHour) * (1 + pct(s.overheadPct));
    /* budget: its own monthly line in the customer's budget, priced from its cost plus a markup (blank = the scenario admin rate) */
    /* under Cost + admin a budget line is at cost: the admin rate is applied once, to the whole budget */
    var markup = s.priceMethod === 'budget' ? (model === 'costplus' ? 0 : set(s.markupPct) ? n(s.markupPct) : n(adminPct)) : null;
    var rev = s.priceMethod === 'budget' ? cost * (1 + markup / 100) : s.priceMethod === 'monthly' ? n(s.priceMonthly) : P * n(s.priceDaily) * DAYS;
    return { name: s.name || 'Staffing', participants: P, revMonthly: rev, costMonthly: cost, marginMonthly: rev - cost, budget: s.priceMethod === 'budget', markupPct: markup, fte: s.costMethod === 'fte' ? n(s.fte) : null };
  }

  /* ---------- fees ---------- */
  function priceFee(f, fleet) {
    var q = f.qtyBasis === 'perUnit' ? fleet : n(f.qty);
    return { name: f.name || 'Fee', when: f.when === 'monthly' ? 'monthly' : 'once', qty: q, rev: q * n(f.price), cost: q * n(f.cost), perUnit: f.qtyBasis === 'perUnit' };
  }

  /* ---------- whole scenario ---------- */
  function price(sc, catalog, opts) {
    opts = opts || {};
    migrate(sc);
    var model = opts.model || sc.model || 'lease';
    if (!MODELS[model]) model = 'lease';
    var k = opts.k == null ? 1 : opts.k;
    var srcOverride = opts.vendorSource || null;      /* 'buy' = what-if JusticePoint purchases from the manufacturer */
    var transparent = model === 'transparent';
    var byId = {};
    (catalog || []).forEach(function (c) { byId[String(c.id)] = c; });
    var T = Math.max(1, Math.round(n(sc.termMonths) || 12));
    var pe = pct(sc.priceEscalatorPct), ce = pct(sc.costEscalatorPct);
    var minimum = n(sc.minimumMonthly);

    var vv = sc.vendorVolume || {};
    var vendorOf = function (l) { var it = byId[String(l.itemId)]; return it && it.vendorId ? String(it.vendorId) : ''; };
    var vEntry = function (v) { return vv[v] || {}; };
    var vCur = function (v) { var x = vEntry(v); return set(x.override) ? Math.max(0, n(x.override)) : Math.max(0, n(x.zoho)); };
    var unitsAt = function (l, m) { return transparent ? committedAt(l, m) : Math.max(0, n(l.units)); };
    var tpBase = null;   /* Transparent: each line's vendor daily rate at month 1; the customer rate holds it for the term */

    /* everything that depends on the month's volumes: lines, vendors, staffing, monthly fees and the monthly totals */
    function snapshot(m) {
      var L = sc.lines || [], U = L.map(function (l) { return unitsAt(l, m); });
      var vScen = {}, vOrder = [];
      L.forEach(function (l, i) { var v = vendorOf(l); if (!v) return; if (vScen[v] == null) { vScen[v] = 0; vOrder.push(v); } vScen[v] += U[i]; });
      var ctxOf = function (l, force, i) {
        var v = vendorOf(l), c = {};
        if (v) { var e = vEntry(v), man = e.rates ? e.rates[String(l.itemId)] : null; c = { vendorId: v, costQty: vCur(v) + vScen[v], forceNext: force == null ? !!e.useNext : force, manual: man }; }
        if (tpBase && i != null) c.tpBase = tpBase[i];
        return c;
      };
      var lines = L.map(function (l, i) { return priceLine(l, byId[String(l.itemId)], sc, model, k, srcOverride, ctxOf(l, null, i), U[i]); });
      var vendors = vOrder.map(function (v) {
        var idx = [], now = 0, next = 0;
        L.forEach(function (l, i) { if (vendorOf(l) === v) idx.push(i); });
        idx.forEach(function (i) {
          var l = L[i], it = byId[String(l.itemId)];
          now += priceLine(l, it, sc, model, k, srcOverride, ctxOf(l, false, i), U[i]).costMonthly;
          next += priceLine(l, it, sc, model, k, srcOverride, ctxOf(l, true, i), U[i]).costMonthly;
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
      var active = sum(lines, function (l) { return l.active; });
      var fleet = sum(lines, function (l) { return l.fleet; });
      var staff = (sc.staffing || []).map(function (s) { return priceStaff(s, active, sc.adminRatePct, model); });
      var fees = (sc.fees || []).map(function (f) { return priceFee(f, fleet); });
      var feesM = fees.filter(function (f) { return f.when === 'monthly'; });
      var R = {
        device: sum(lines, function (l) { return l.rev.device; }),
        spares: sum(lines, function (l) { return l.rev.spares; }),
        lost: sum(lines, function (l) { return l.rev.lost; }),
        staffing: sum(staff, function (s) { return s.revMonthly; }),
        fees: sum(feesM, function (f) { return f.rev; }),
        minimum: 0,
        cp: 0, admin: 0
      };
      if (model === 'costplus') {
        var ar = pct(sc.adminRatePct);
        R.admin = (R.device + R.spares + R.staffing + R.fees) * ar;            /* admin rate on the whole budget */
        R.cp = sum(lines, function (l) { return l.cpPass || 0; }) * (1 + ar);  /* device pass-through + its admin: escalates with cost */
      }
      var C = {
        device: sum(lines, function (l) { return l.cost.device; }),
        spares: sum(lines, function (l) { return l.cost.spares; }),
        lost: sum(lines, function (l) { return l.cost.lost; }),
        amort: sum(lines, function (l) { return l.cost.amort; }),
        staffing: sum(staff, function (s) { return s.costMonthly; }),
        fees: sum(feesM, function (f) { return f.cost; })
      };
      var recurring = R.device + R.spares + R.lost + R.staffing + R.fees + R.admin;
      if (minimum > recurring) R.minimum = minimum - recurring;
      var costM = C.device + C.spares + C.lost + C.amort + C.staffing + C.fees;
      return { key: U.join(','), units: U, lines: lines, vendors: vendors, active: active, fleet: fleet, staff: staff, fees: fees,
        R: R, C: C, recurring: recurring, revM: recurring + R.minimum, costM: costM, cashCost: costM - C.amort };
    }

    /* Transparent: fix each line's vendor daily rate at month 1, so a step that moves the cost tier changes cost, not the customer rate */
    if (transparent) tpBase = snapshot(1).lines.map(function (l) { return l.costRate; });
    /* month 1 is the headline; later snapshots only when a commitment step changes the volumes */
    var first = snapshot(1), steps = transparent ? stepMonths(sc, T) : [], snaps = { 1: first };
    steps.forEach(function (m) { snaps[m] = snapshot(m); });
    var snapAt = function (m) { var at = 1; steps.forEach(function (s) { if (s <= m) at = s; }); return snaps[at]; };

    var feesO = first.fees.filter(function (f) { return f.when === 'once'; });
    var onceAdmin = model === 'costplus' ? sum(feesO, function (f) { return f.rev; }) * pct(sc.adminRatePct) : 0;   /* admin on one-time charges too */
    var once = {
      admin: onceAdmin,
      rev: sum(first.lines, function (l) { return l.onceRev; }) + sum(feesO, function (f) { return f.rev; }) + onceAdmin,
      cost: sum(first.lines, function (l) { return l.onceCost; }) + sum(feesO, function (f) { return f.cost; }),
      capex: sum(first.lines, function (l) { return l.capex; })
    };
    /* owned fleet: each purchase is a tranche depreciated from the month it is bought */
    var tranches = [];
    first.lines.forEach(function (l) { if (l.capex > 0) tranches.push({ start: 1, amount: l.capex, life: l.lifeMonths || 36 }); });
    var amortAt = function (m) { return sum(tranches, function (t) { return m >= t.start && m < t.start + t.life ? t.amount / t.life : 0; }); };

    /* term: month by month so steps, escalators and the minimum apply correctly */
    var termRev = once.rev, termRevEx = once.rev, termCost = once.cost, cash = once.rev - once.cost - once.capex;
    var cum = [cash], payback = cash >= 0 ? 0 : null, paybackExact = cash >= 0 ? 0 : null, months = [], schedule = [{ month: 1, active: first.active, fleet: first.fleet }];
    var prev = first;
    for (var m = 1; m <= T; m++) {
      var cur = snapAt(m), addRev = 0, addCost = 0, addCapex = 0;
      if (cur !== prev) {
        /* commitment increase: per-unit one-time fees and a fleet purchase for the added units, in this month */
        cur.lines.forEach(function (l, i) {
          var added = l.fleet - prev.lines[i].fleet;
          if (added > 0) {
            if (l.buyUnit > 0 && l.capex > 0) { var amt = added * l.buyUnit; tranches.push({ start: m, amount: amt, life: l.lifeMonths || 36 }); addCapex += amt; }
            (sc.fees || []).forEach(function (f) { if (f.when !== 'monthly' && f.qtyBasis === 'perUnit') { addRev += added * n(f.price); addCost += added * n(f.cost); } });
          }
        });
        schedule.push({ month: m, active: cur.active, fleet: cur.fleet });
      }
      var yr = Math.floor((m - 1) / 12);
      var recEsc = (cur.recurring - cur.R.cp) * Math.pow(1 + pe, yr) + cur.R.cp * Math.pow(1 + ce, yr);
      var rm = Math.max(recEsc, minimum);
      var cm = cur.cashCost * Math.pow(1 + ce, yr);
      var am = amortAt(m);
      termRev += rm + addRev; termRevEx += recEsc + addRev; termCost += cm + am + addCost;
      var before = cash;
      cash += rm + addRev - cm - addCost - addCapex; cum.push(cash);
      if (payback == null && cash >= 0) { payback = m; var d = cash - before; paybackExact = (m - 1) + (d > 0 ? -before / d : 1); }
      months.push({ month: m, active: cur.active, fleet: cur.fleet, revenue: rm + addRev, cost: cm + am + addCost, margin: rm + addRev - cm - am - addCost, recurringRev: rm, recurringMargin: rm - cm - am, addedFees: addRev, capex: addCapex });
      prev = cur;
    }
    var residual = sum(tranches, function (t) { var held = Math.min(t.life, T - t.start + 1); return t.amount * Math.max(0, 1 - held / t.life); });

    var lines = first.lines, R = first.R, C = first.C, revM = first.revM, costM = first.costM;
    var marginM = revM - costM, termMargin = termRev - termCost, unitDays = first.active * DAYS;
    var last = months[months.length - 1];

    /* price multiplier that lands the term margin on target (device prices only; Transparent: the add-ons) */
    var target = pct(sc.targetMarginPct), solve = null;
    if (!opts.noSolve && target < 1 && model === 'costplus') {
      /* cost-plus: find the admin rate that lands the term margin on target (it also moves staffing budget lines
         that follow the admin rate, so solve it directly rather than by a price multiplier) */
      var at = function (x) { var c = JSON.parse(JSON.stringify(sc)); c.adminRatePct = x; return price(c, catalog, { model: model, noSolve: true, vendorSource: srcOverride }); };
      var goal = n(sc.targetMarginPct), lo = -50, hi = 400, a0 = n(sc.adminRatePct);
      var base0 = at(a0);
      if (!(base0.term.cost > 0) || base0.term.revenue - at(lo).term.revenue === 0) solve = { k: null, feasible: false, reason: 'Enter costs in the Cost catalog first: cost-plus rates are built from them.' };
      else if (at(hi).term.marginPct < goal) solve = { k: null, feasible: false, reason: 'No admin rate up to 400% reaches the target.' };
      else {
        for (var it = 0; it < 50; it++) { var mid = (lo + hi) / 2; if (at(mid).term.marginPct < goal) lo = mid; else hi = mid; }
        solve = { k: (1 + hi / 100) / (1 + a0 / 100), feasible: hi > 0, adminPct: Math.round(hi * 100) / 100 };
      }
    } else if (!opts.noSolve && target < 1) {
      var base = price(sc, catalog, { model: model, k: 0, noSolve: true, vendorSource: srcOverride });
      var one = price(sc, catalog, { model: model, k: 1, noSolve: true, vendorSource: srcOverride });
      var slope = one.term.revenueExMin - base.term.revenueExMin;
      if (slope > 0) {
        var needRev = one.term.cost / (1 - target);
        var kk = (needRev - base.term.revenueExMin) / slope;
        solve = { k: kk, feasible: kk > 0, neededTermRevenue: needRev };
      } else solve = { k: null, feasible: false, reason: transparent ? 'Enter an add-on $/day for each device first.' : 'Enter prices for this model first.' };
    }

    /* whole-deal break-even on owned devices: shown for the Purchase + service model only */
    if (model !== 'purchase') lines.forEach(function (l) { delete l.breakEven; });
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
      lines: lines, staffing: first.staff, fees: first.fees,
      units: { active: first.active, fleet: first.fleet, unitDays: unitDays, endActive: last ? last.active : first.active, endFleet: last ? last.fleet : first.fleet, steps: schedule.length > 1, schedule: schedule },
      monthly: { revenue: revM, cost: costM, cashCost: costM - C.amort, margin: marginM, marginPct: revM > 0 ? marginM / revM * 100 : 0, rev: R, costs: C, recurringBeforeMinimum: first.recurring },
      months: months, lastMonth: last,
      once: once,
      term: { months: T, revenue: termRev, revenueExMin: termRevEx, cost: termCost, margin: termMargin, marginPct: termRev > 0 ? termMargin / termRev * 100 : 0, residual: residual, capexTotal: sum(tranches, function (t) { return t.amount; }), cumulativeCash: cum, paybackMonth: payback },
      perUnitDay: unitDays > 0 ? { revenue: revM / unitDays, cost: costM / unitDays, target: target < 1 ? costM / (1 - target) / unitDays : null } : null,
      tier: tierOf(revM > 0 ? marginM / revM * 100 : 0, revM),
      solve: solve, missing: missing, breakEven: breakEven, vendors: first.vendors
    };
  }

  /* older saves: turn a full Transparent rate into an add-on over today's vendor daily rate (same total).
     Needs the catalog, so the Studio calls it when a scenario is opened. Returns how many lines changed. */
  function tpConvert(sc, catalog) {
    migrate(sc);
    var idx = [];
    (sc.lines || []).forEach(function (l, i) { if (tpLegacy(l) || (l.priceTiers || []).some(function (t) { return set(t.transparentDaily) && !set(t.transparentAddOn); })) idx.push(i); });
    if (!idx.length) return 0;
    var r = price(sc, catalog, { model: 'transparent', noSolve: true });
    idx.forEach(function (i) {
      var l = sc.lines[i], b = r.lines[i] ? r.lines[i].tpBase : 0;
      if (tpLegacy(l)) l.price.transparentAddOn = r2(n(l.price.transparentDaily) - b);
      delete l.price.transparentDaily;
      (l.priceTiers || []).forEach(function (t) { if (set(t.transparentDaily) && !set(t.transparentAddOn)) t.transparentAddOn = r2(n(t.transparentDaily) - b); delete t.transparentDaily; });
    });
    return idx.length;
  }

  function compare(sc, catalog) { return Object.keys(MODELS).map(function (m) { return price(sc, catalog, { model: m }); }); }

  /* volume sensitivity: commitments and steps scale with the active units */
  function sensitivity(sc, catalog, steps) {
    steps = steps || [0.5, 0.75, 1, 1.25, 1.5];
    return steps.map(function (f) {
      var s = JSON.parse(JSON.stringify(migrate(sc)));
      (s.lines || []).forEach(function (l) {
        l.units = n(l.units) * f;
        if (set(l.commitUnits)) l.commitUnits = n(l.commitUnits) * f;
        (l.commitSteps || []).forEach(function (st) { if (set(st.units)) st.units = n(st.units) * f; });
      });
      (s.staffing || []).forEach(function (st) { if (st.participants != null && st.participants !== '') st.participants = n(st.participants) * f; });
      var r = price(s, catalog, { noSolve: true });
      return { factor: f, active: r.units.active, marginPct: r.monthly.marginPct, margin: r.monthly.margin, revenue: r.monthly.revenue };
    });
  }

  function applyMultiplier(sc, model, k) {
    /* cost-plus: the solver's multiplier scales cost x (1 + admin), so it lands as a new admin rate */
    if (model === 'costplus') { sc.adminRatePct = Math.round(((1 + pct(sc.adminRatePct)) * k - 1) * 10000) / 100; return sc; }   /* k from the admin-rate solve */
    var keys = (PRICE_KEYS[model] || []).filter(function (x) { return x !== 'spareDaily'; });   /* solver scales device prices only (Transparent: add-ons) */
    var mul = function (v) { return Math.round(n(v) * k * 100) / 100; };
    sc.lines.forEach(function (l) {
      keys.forEach(function (key) { if (set(l.price[key])) l.price[key] = mul(l.price[key]); });
      (l.priceTiers || []).forEach(function (t) { keys.forEach(function (key) { if (set(t[key])) t[key] = mul(t[key]); }); });
    });
    return sc;
  }

  var api = { DAYS: DAYS, MODELS: MODELS, TIERS: TIERS, PRICE_KEYS: PRICE_KEYS, tierOf: tierOf, pickTier: pickTier, nextTier: nextTier, COST_TIER_KEYS: COST_TIER_KEYS, PRICE_TIER_KEYS: PRICE_TIER_KEYS, price: price, compare: compare,
    sensitivity: sensitivity, applyMultiplier: applyMultiplier, blankScenario: blankScenario, blankLine: blankLine, migrate: migrate, committedAt: committedAt, tpConvert: tpConvert };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PricingEngine = api;
})(this);
