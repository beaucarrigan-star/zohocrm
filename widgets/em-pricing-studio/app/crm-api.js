/* =============================================================================
   EM Pricing Studio - Zoho CRM data layer (and a browser-only preview stand-in).
   Every Zoho SDK call lives here. The UI uses the same promise interface in both modes.

   Field safety: before reading or writing, the layer asks Zoho which fields actually exist
   on Products and Pricing_Scenarios. Fields that do not exist are left out of queries and
   saves (one missing field would otherwise make Zoho reject the whole record) and are
   reported by setupReport() so the Studio can list what to create.

   Vendor volume (v85): a vendor's "current units" (which picks its catalog cost tier) is
   Vendors.EM_Units_Current when filled in. When it is blank, the Tier_Volume the CRM writes
   each morning on that vendor's tiered products (Daily Unit Counts, Allied leased 1-Piece GPS
   on leg excl. Sheboygan) is used instead, so scenarios price at the real tier.
   ============================================================================= */
(function (root) {
  'use strict';

  function create(o) {
    o = o || {};
    var PREVIEW = !!o.preview;
    var E = o.engine;
    var CAT = o.catalogFields || {};          /* cost key -> Products API name */
    var PRICE = o.priceFields || {};          /* customer price key -> Products API name */
    var SCEN = o.scenarioFields || [];        /* Pricing_Scenarios API names the Studio writes */
    var VUNITS = o.vendorUnitsField || 'EM_Units_Current';   /* Vendors: current units JusticePoint has with the vendor */
    var VJP = o.vendorFlagField || 'EM_JusticePoint_Vendor'; /* Vendors: checkbox, ticked = a JusticePoint vendor */
    var MODEL_PICK = o.modelPick || {};
    var timeout = o.timeout || function (p) { return Promise.resolve(p); };
    var today = o.today, addDays = o.addDays;
    var num = o.number || function (v) { v = Number(v); return isFinite(v) ? v : 0; };

    var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
    var rowsOf = function (r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; };
    var qs = function (v) { return String(v || '').replace(/'/g, "''"); };
    var round2 = function (v) { return Math.round(num(v) * 100) / 100; };
    /* catalog keys that are not plain numbers */
    var TEXT_KEYS = { updated: 1, family: 1, notes: 1, costTiers: 1 };
    var isNumKey = function (k) { return !TEXT_KEYS[k]; };
    /* Cost_Tiers is a Multi Line field holding JSON: [{"min":51,"costLeaseDaily":2.25}, ...] */
    var parseTiers = function (v) {
      if (Array.isArray(v)) return v;
      if (v == null || v === '') return [];
      try { var a = JSON.parse(v); return Array.isArray(a) ? a.filter(function (t) { return t && typeof t === 'object'; }) : []; } catch (e) { return []; }
    };
    var tierText = function (list) {
      var clean = (list || []).filter(function (t) { return t && num(t.min) > 0; }).map(function (t) {
        var o = { min: Math.round(num(t.min)) };
        Object.keys(t).forEach(function (k) { if (k !== 'min' && t[k] != null && t[k] !== '' && isFinite(Number(t[k]))) o[k] = Number(t[k]); });
        return o;
      }).sort(function (a, b) { return a.min - b.min; });
      return clean.length ? JSON.stringify(clean) : null;
    };
    var store = {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };
    var errText = function (e) {
      if (!e) return 'unknown error';
      if (typeof e === 'string') return e;
      if (e.message) return e.message;
      try { var d = e.data && e.data[0] ? e.data[0] : e; return (d.code ? d.code + ': ' : '') + (d.message || JSON.stringify(d)); } catch (x) { return String(e); }
    };
    function writeOk(resp) {
      var row = resp && resp.data && resp.data[0];
      if (row && (row.code === 'SUCCESS' || row.status === 'success')) return row.details || {};
      throw new Error((row && (row.message + (row.details && row.details.api_name ? ' (' + row.details.api_name + ')' : ''))) || 'Zoho refused the change');
    }

    /* ---------- local scenario storage (preview, and a safety copy when a CRM save fails) ---------- */
    var LOCAL_KEY = 'em-pricing-scenarios-v1';
    var local = {
      list: function () { try { return JSON.parse(store.get(LOCAL_KEY) || '[]') || []; } catch (e) { return []; } },
      put: function (sc) { var all = local.list().filter(function (x) { return x.id !== sc.id; }); all.unshift(sc); store.set(LOCAL_KEY, JSON.stringify(all.slice(0, 40))); }
    };

    var api = {
      keepLocalCopy: function (sc) { var c = clone(sc); c.id = c.id || ('local-' + Date.now()); local.put(c); return c.id; }
    };

    /* =====================================================================
       PREVIEW: a pretend "Zoho" kept in this browser, so matching can be tried
       ===================================================================== */
    if (PREVIEW) {
      var ZKEY = 'em-pricing-preview-zoho-v4';
      var SAMPLE = [
        { id: 'p-gps', name: 'GPS device', vendor: 'Sample vendor A', vendorId: 'v1', family: 'GPS', costs: { costLeaseDaily: 3.25, spareAllowancePct: 25, spareOverageDaily: 1.00, costPurchase: 450, costOwnedDaily: 1.00, usefulLifeMonths: 36, replacementCost: 450 }, costTiers: [{ min: 1501, costLeaseDaily: 3.05 }, { min: 2001, costLeaseDaily: 2.82 }], prices: { leaseDaily: 4.00, spareDaily: 1.50, saasMonthly: 130, purchasePrice: 650, serviceDaily: 2.00, lostFee: 450 } },
        { id: 'p-cam', name: 'Continuous alcohol monitor (CAM)', vendor: 'Sample vendor A', vendorId: 'v1', family: 'CAM', costs: { costLeaseDaily: 7.00, usefulLifeMonths: 36, replacementCost: 1200 }, prices: { leaseDaily: 11.00, saasMonthly: 340, lostFee: 1200 } },
        { id: 'p-rb', name: 'Remote breath device', vendor: 'Sample vendor B', vendorId: 'v2', family: 'Remote Breath', costs: {}, prices: {} },
        { id: 'p-rf', name: 'RF device', vendor: 'Sample vendor B', vendorId: 'v2', family: 'RF', costs: {}, prices: {} }
      ];
      var zload = function () { try { var s = store.get(ZKEY); return s ? JSON.parse(s) : clone(SAMPLE); } catch (e) { return clone(SAMPLE); } };
      var zsave = function (list) { store.set(ZKEY, JSON.stringify(list)); };
      var toItem = function (z) {
        var c = { id: z.id, name: z.name, vendor: z.vendor, vendorId: z.vendorId || '', family: z.family || '', notes: z.notes || '' };
        Object.keys(CAT).forEach(function (k) { if (isNumKey(k)) c[k] = z.costs[k] == null ? null : z.costs[k]; });
        c.costTiers = parseTiers(z.costTiers);
        c.zoho = zohoSnapshot(c); c.zohoPrice = clone(z.prices || {});
        return c;
      };
      api.setupReport = function () { return Promise.resolve({ products: [], prices: [], scenarios: [], vendors: [], metadata: true }); };
      api.currentUser = function () { return Promise.resolve('Beau Carrigan'); };
      api.catalog = function () { return Promise.resolve(zload().map(toItem)); };
      api.vendors = function () { return Promise.resolve([{ id: 'v1', name: 'Sample vendor A', units: 1700, jp: true }, { id: 'v2', name: 'Sample vendor B', units: 300, jp: true }, { id: 'v3', name: 'Office supplies vendor', units: null, jp: false }]); };
      api.saveCatalog = function (rows) {
        var list = zload();
        rows.forEach(function (c) {
          var z = list.filter(function (x) { return x.id === c.id; })[0];
          if (!z) { z = { id: c.isNew ? 'p-' + Date.now() + Math.floor(Math.random() * 1000) : c.id, costs: {}, prices: {} }; list.push(z); c.id = z.id; c.isNew = false; }
          z.name = c.name; z.vendor = c.vendor; z.vendorId = c.vendorId; z.family = c.family; z.notes = c.notes;
          Object.keys(CAT).forEach(function (k) { if (isNumKey(k)) z.costs[k] = c[k] === '' ? null : c[k]; });
          z.costTiers = parseTiers(tierText(c.costTiers));
        });
        zsave(list);
        return Promise.resolve({ count: rows.length, skipped: [] });
      };
      api.accounts = function (term) {
        var all = [{ id: 'a1', name: 'Sheboygan County Sheriffs Department' }, { id: 'a2', name: 'Columbia County Treatment Court' }, { id: 'a3', name: 'Iowa County Sheriff' }, { id: 'a4', name: 'Rock County' }];
        term = term.toLowerCase(); return Promise.resolve(all.filter(function (a) { return a.name.toLowerCase().indexOf(term) >= 0; }));
      };
      api.listScenarios = function () {
        var l = local.list();
        if (!l.length && E) { var s = sampleScenario(); s.id = 'local-sample'; local.put(s); l = local.list(); }
        return Promise.resolve(l.map(function (s) { return { id: s.id, name: s.name }; }));
      };
      api.loadScenario = function (id) { var s = local.list().filter(function (x) { return x.id === id; })[0]; return s ? Promise.resolve(clone(s)) : Promise.reject(new Error('Not found')); };
      api.saveScenario = function (sc) { if (!sc.id) sc.id = 'local-' + Date.now(); local.put(clone(sc)); return Promise.resolve({ id: sc.id, skipped: [] }); };
      api.markSent = function () { return Promise.resolve(); };
      api.attach = function () { return Promise.reject(new Error('Preview: nothing is attached. In Zoho the PDF is attached to the scenario record.')); };
      return finish(api);
    }

    /* =====================================================================
       ZOHO CRM
       ===================================================================== */
    var meta = {};   /* module -> Promise<{ ok, fields: {api_name: field} }> */
    function fieldsOf(module, fresh) {
      if (!fresh && meta[module]) return meta[module];
      meta[module] = timeout(ZOHO.CRM.META.getFields({ Entity: module }), 10000).then(function (r) {
        var list = (r && (r.fields || r.data)) || [];
        if (!list.length) throw new Error('empty');
        var map = {}; list.forEach(function (f) { map[f.api_name] = f; });
        return { ok: true, fields: map };
      }).catch(function () { return { ok: false, fields: {} }; });   /* no metadata: assume fields exist */
      return meta[module];
    }
    var has = function (m, apiName) { return !m.ok || !!m.fields[apiName]; };
    var writable = function (m, apiName) { return !m.ok || (!!m.fields[apiName] && !m.fields[apiName].field_read_only && !m.fields[apiName].read_only); };

    api.coql = function (q) { return timeout(ZOHO.CRM.API.coql({ select_query: q })).then(rowsOf); };
    api.currentUser = function () {
      return timeout(ZOHO.CRM.CONFIG.getCurrentUser(), 6000).then(function (r) { return (r && r.users && r.users[0] && r.users[0].full_name) || ''; }).catch(function () { return ''; });
    };

    /* what is missing in Zoho, for the setup panel */
    api.setupReport = function (fresh) {
      return Promise.all([fieldsOf('Products', fresh), fieldsOf('Pricing_Scenarios', fresh), fieldsOf('Vendors', fresh)]).then(function (res) {
        var P = res[0], S = res[1], V = res[2];
        var miss = function (m, map) { return Object.keys(map).filter(function (k) { return !has(m, map[k]); }).map(function (k) { return { key: k, api: map[k] }; }); };
        var ro = function (m, map) { return Object.keys(map).filter(function (k) { return has(m, map[k]) && !writable(m, map[k]); }).map(function (k) { return { key: k, api: map[k] }; }); };
        return {
          metadata: P.ok,
          products: miss(P, CAT), productsReadOnly: ro(P, CAT),
          prices: miss(P, PRICE), pricesReadOnly: ro(P, PRICE),
          scenarios: S.ok ? SCEN.filter(function (a) { return !S.fields[a]; }).map(function (a) { return { api: a }; }) : [],
          vendors: V.ok ? [VJP, VUNITS].filter(function (a) { return !V.fields[a]; }).map(function (a) { return { api: a }; }) : []
        };
      });
    };

    function readProducts(P) {
      var base = ['id', 'Product_Name', 'Vendor_Name', 'Product_Active'];
      var costCols = Object.keys(CAT).map(function (k) { return CAT[k]; }).filter(function (a) { return has(P, a); });
      var priceCols = Object.keys(PRICE).map(function (k) { return PRICE[k]; }).filter(function (a) { return has(P, a); });
      var cols = base.concat(costCols, priceCols).filter(function (a, i, arr) { return arr.indexOf(a) === i; }).slice(0, 50);
      var q = function (c) { return api.coql('select ' + c.join(', ') + " from Products where Product_Active = true order by Product_Name asc limit 200"); };
      return q(cols).catch(function (e) {
        /* COQL refused (unknown column without metadata, etc.): fall back to the Records API */
        var all = [];
        var page = function (p) {
          return timeout(ZOHO.CRM.API.getAllRecords({ Entity: 'Products', sort_order: 'asc', per_page: 200, page: p })).then(function (r) {
            all = all.concat(rowsOf(r));
            return r && r.info && r.info.more_records && p < 10 ? page(p + 1) : all;
          });
        };
        return page(1).then(function (rows) { return rows.filter(function (r) { return r.Product_Active !== false; }); }, function () { throw new Error('Could not read Products: ' + errText(e)); });
      });
    }

    api.catalog = function (fresh) {
      /* COQL returns lookups as { id } only, so vendor names are resolved from the Vendors module */
      return Promise.all([fieldsOf('Products', fresh), api.vendors(fresh)]).then(function (pre) {
        var P = pre[0], vmap = {};
        pre[1].forEach(function (v) { vmap[v.id] = v.name; });
        return readProducts(P).then(function (rows) {
          return rows.map(function (r) {
            var vid = r.Vendor_Name ? String(r.Vendor_Name.id || r.Vendor_Name) : '';
            var c = { id: String(r.id), name: r.Product_Name || '', vendorId: vid, vendor: (r.Vendor_Name && r.Vendor_Name.name) || vmap[vid] || '' };
            Object.keys(CAT).forEach(function (k) { if (k !== 'updated') c[k] = r[CAT[k]] == null ? null : r[CAT[k]]; });
            c.costTiers = parseTiers(c.costTiers);
            c.zoho = zohoSnapshot(c);
            c.zohoPrice = {};
            Object.keys(PRICE).forEach(function (k) { if (has(P, PRICE[k]) && r[PRICE[k]] != null && r[PRICE[k]] !== '') c.zohoPrice[k] = num(r[PRICE[k]]); });
            return c;
          });
        });
      });
    };

    /* Tier_Volume the CRM writes daily on each vendor's tiered products (products with Cost_Tiers) */
    function tierVolumes() {
      return api.coql('select id, Vendor_Name, Tier_Volume, Cost_Tiers from Products where Product_Active = true limit 200').then(function (rows) {
        var out = {};
        rows.forEach(function (r) {
          var vid = r.Vendor_Name ? String(r.Vendor_Name.id || r.Vendor_Name) : '';
          if (!vid || r.Tier_Volume == null || r.Tier_Volume === '' || !parseTiers(r.Cost_Tiers).length) return;
          out[vid] = Math.max(out[vid] || 0, Number(r.Tier_Volume));
        });
        return out;
      }).catch(function () { return {}; });
    }

    /* every vendor in the Zoho Vendors module (paged, cached for the session) */
    var vendorCache = null;
    api.vendors = function (fresh) {
      if (vendorCache && !fresh) return vendorCache;
      var all = [];
      var page = function (p) {
        return timeout(ZOHO.CRM.API.getAllRecords({ Entity: 'Vendors', sort_by: 'Vendor_Name', sort_order: 'asc', per_page: 200, page: p })).then(function (r) {
          all = all.concat(rowsOf(r));
          return r && r.info && r.info.more_records && p < 25 ? page(p + 1) : all;
        });
      };
      var viaCoql = function () {
        var out = [];
        var next = function (off) {
          var q = function (cols) { return api.coql('select ' + cols + ' from Vendors where id is not null order by Vendor_Name asc limit ' + off + ', 200'); };
          return q('id, Vendor_Name, ' + VUNITS + ', ' + VJP).catch(function () { return q('id, Vendor_Name'); }).then(function (r) {
            out = out.concat(r); return r.length === 200 && off < 4800 ? next(off + 200) : out;
          });
        };
        return next(0);
      };
      vendorCache = Promise.all([page(1).catch(viaCoql), tierVolumes()])
        .then(function (res) {
          var rows = res[0], tv = res[1], seen = {};
          return rows.filter(function (v) { var id = String(v.id); if (!v.id || seen[id]) return false; seen[id] = 1; return true; })
            .map(function (v) {
              var id = String(v.id), u = v[VUNITS], f = v[VJP];
              var units = u == null || u === '' || !isFinite(Number(u)) ? null : Number(u), src = units == null ? '' : 'vendor record';
              if (units == null && tv[id] != null) { units = tv[id]; src = 'Daily Unit Counts'; }
              return { id: id, name: v.Vendor_Name || '(unnamed vendor)', units: units, unitsSource: src,
                jp: f === undefined ? null : (f === true || f === 'true') };   /* null = field not on the record */
            })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
        })
        .catch(function () { vendorCache = null; return []; });
      return vendorCache;
    };

    /* save catalog rows; only fields that exist and are writable are sent */
    api.saveCatalog = function (rows) {
      return fieldsOf('Products', true).then(function (P) {
        var skipped = {};
        var chain = Promise.resolve(0);
        rows.forEach(function (c) {
          chain = chain.then(function (done) {
            var data = { Product_Name: String(c.name || '').trim() };
            if (c.vendorId) data.Vendor_Name = { id: c.vendorId };
            Object.keys(CAT).forEach(function (k) {
              var a = CAT[k]; if (k === 'updated') return;
              var v = k === 'costTiers' ? tierText(c.costTiers) : (c[k] === '' ? null : c[k]);
              if (!writable(P, a)) { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) skipped[a] = true; return; }
              data[a] = v;
            });
            if (CAT.updated && writable(P, CAT.updated)) data[CAT.updated] = today();
            if (c.isNew) {
              data.Product_Active = true;
              return timeout(ZOHO.CRM.API.insertRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function (d) { c.id = String(d.id); c.isNew = false; return done + 1; });
            }
            data.id = c.id;
            return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function () { return done + 1; });
          });
        });
        return chain.then(function (n) { return { count: n, skipped: Object.keys(skipped) }; });
      });
    };

    api.accounts = function (term) {
      return api.coql("select id, Account_Name from Accounts where Account_Name like '%" + qs(term) + "%' limit 10")
        .then(function (r) { return r.map(function (a) { return { id: String(a.id), name: a.Account_Name }; }); });
    };
    api.listScenarios = function () {
      return api.coql("select id, Name, Pricing_Model, Est_Margin_Pct, Scenario_Status, Modified_Time from Pricing_Scenarios where Scenario_Status != 'Superseded' order by Modified_Time desc limit 100")
        .catch(function () { return api.coql('select id, Name, Modified_Time from Pricing_Scenarios where id is not null order by Modified_Time desc limit 100'); })
        .then(function (r) { return r.map(function (q) { return { id: String(q.id), name: q.Name, model: q.Pricing_Model, margin: q.Est_Margin_Pct }; }); })
        .catch(function () { return []; });
    };
    api.loadScenario = function (id) {
      return timeout(ZOHO.CRM.API.getRecord({ Entity: 'Pricing_Scenarios', RecordID: id })).then(function (r) {
        var q = rowsOf(r)[0] || {}, w = null;
        try { w = JSON.parse(q.Scenario_JSON || 'null'); } catch (e) {}
        if (!w || !w.scenario) throw new Error('This record has no Pricing Studio scenario on it.');
        var sc = w.scenario; sc.id = String(q.id); sc.name = q.Name || sc.name;
        if (q.Account && q.Account.id) sc.account = { id: String(q.Account.id), name: q.Account.name };
        if (q.Opportunity && q.Opportunity.id) sc.deal = { id: String(q.Opportunity.id), name: q.Opportunity.name };
        return sc;
      });
    };
    api.saveScenario = function (sc, res) {
      return fieldsOf('Pricing_Scenarios').then(function (S) {
        if (S.ok && !S.fields.Scenario_JSON) throw new Error('Pricing_Scenarios has no Scenario_JSON field (Multi Line, large). Create it so scenarios can be reopened.');
        var opts = (sc.proposal.options || ['current']).map(function (m) { return m === 'current' ? res.model : m; });
        var all = {
          Name: String(sc.name || 'Pricing scenario').slice(0, 120),
          Valid_Until: addDays(today(), num(sc.proposal.validDays) || 30).toISOString().slice(0, 10),
          Pricing_Model: MODEL_PICK[res.model], Vendor_Source: res.vendorSource === 'buy' ? 'JP-owned devices' : 'Lease',
          Proposal_Options: opts.map(function (m) { return MODEL_PICK[m]; }).join(', ').slice(0, 120),
          Term_Months: res.term.months, Active_Units: Math.round(res.units.active),
          Est_Monthly_Revenue: round2(res.monthly.revenue), Est_Monthly_Cost: round2(res.monthly.cost), Est_Monthly_Margin: round2(res.monthly.margin),
          Est_Margin_Pct: round2(res.monthly.marginPct), Target_Margin_Pct: round2(sc.targetMarginPct),
          Term_Revenue: round2(res.term.revenue), Term_Margin: round2(res.term.margin),
          Upfront_Cash: round2(res.once.capex + res.once.cost - res.once.rev),
          Rev_Per_Unit_Day: res.perUnitDay ? round2(res.perUnitDay.revenue) : null, Cost_Per_Unit_Day: res.perUnitDay ? round2(res.perUnitDay.cost) : null,
          Margin_Tier: res.tier.label, Missing_Costs: res.missing.length,
          Account: sc.account && sc.account.id ? { id: sc.account.id } : null,
          Scenario_JSON: JSON.stringify({ v: 3, saved: new Date().toISOString(), scenario: sc })
        };
        var isNew = !sc.id || /^local-/.test(sc.id);
        if (isNew) all.Scenario_Status = 'Draft';
        var data = {}, skipped = [];
        Object.keys(all).forEach(function (a) { if (a === 'Name' || has(S, a)) data[a] = all[a]; else skipped.push(a); });
        var call = isNew
          ? function () { return ZOHO.CRM.API.insertRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); }
          : function () { data.id = sc.id; return ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); };
        /* a picklist value Zoho does not have yet (e.g. "Cost plus admin" before it is added) must not block the save:
           retry once without the picklist fields and report them as skipped */
        return timeout(call()).then(writeOk).catch(function (e) {
          if (!/Pricing_Model|Proposal_Options|INVALID_DATA/i.test(String(e && e.message))) throw e;
          ['Pricing_Model', 'Proposal_Options'].forEach(function (a) { if (a in data) { delete data[a]; skipped.push(a + ' (picklist value not in Zoho)'); } });
          return timeout(call()).then(writeOk);
        }).then(function (d) { return { id: String(d.id || sc.id), skipped: skipped }; });
      });
    };
    api.markSent = function (id) {
      return fieldsOf('Pricing_Scenarios').then(function (S) {
        var data = { id: id };
        if (has(S, 'Proposal_Sent')) data.Proposal_Sent = today();
        if (has(S, 'Scenario_Status')) data.Scenario_Status = 'Proposed';
        return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: data })).then(writeOk);
      });
    };
    api.attach = function (id, name, blob) { return timeout(ZOHO.CRM.API.attachFile({ Entity: 'Pricing_Scenarios', RecordID: id, File: { Name: name, Content: blob } }), 30000); };
    return finish(api);

    /* ---------- shared ---------- */
    function zohoSnapshot(c) { var s = {}; Object.keys(CAT).forEach(function (k) { if (isNumKey(k)) s[k] = c[k] == null || c[k] === '' ? null : num(c[k]); }); return s; }
    function finish(a) { a.snapshot = zohoSnapshot; return a; }
    function sampleScenario() {
      var s = E.blankScenario();
      s.name = 'Example County - Pretrial GPS and CAM (sample)'; s.customerName = 'Example County'; s.program = 'Pretrial Services';
      s.priceEscalatorPct = 3;
      var g = E.blankLine('p-gps'); g.units = 150; g.sparePct = 30;
      g.priceTiers = [{ min: 101, leaseDaily: 4.00 }, { min: 251, leaseDaily: 3.75 }];
      g.price = { leaseDaily: 4.25, spareDaily: 1.50, transparentAddOn: 0.70, purchasePrice: 650, serviceDaily: 2.00, lostFee: 450 };
      var c = E.blankLine('p-cam'); c.units = 20; c.sparePct = 15;
      c.price = { leaseDaily: 11.00, spareDaily: 0, transparentAddOn: 3.50, purchasePrice: 0, serviceDaily: 0, lostFee: 1200 };
      s.lines = [g, c];
      s.staffing = [{ name: 'Monitoring center and case support', costMethod: 'hours', hoursPerParticipant: 0.5, costPerHour: 38, overheadPct: 25, participants: null, priceMethod: 'perDay', priceDaily: 0.75 }];
      s.fees = [{ name: 'Installation', when: 'once', qtyBasis: 'perUnit', qty: 0, price: 25, cost: 8 }];
      s.spareBilling = { overPct: 25 };
      s.lostRatePct = 3; s.lostRecoveryPct = 50;
      s.proposal.preparedBy = 'Beau Carrigan';
      return s;
    }
  }

  root.PricingCRM = { create: create };
})(this);
