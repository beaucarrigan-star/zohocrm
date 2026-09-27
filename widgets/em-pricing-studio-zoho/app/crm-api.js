/* =============================================================================
   EM Pricing Studio - CRM and preview data layer.
   Owns all Zoho SDK calls, COQL, persistence, and browser preview storage.
   The UI consumes the same promise-based interface in preview and CRM modes.

   Volume tiers (Products): stored as JSON in a Multi Line field. The field is found
   from Products field metadata (API name Cost_Tiers, or a field labelled "Cost Tiers"),
   not guessed from a failed query, and it is checked again on every save, so adding the
   field while the Studio is open works without a reload.
   ============================================================================= */
(function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    var PREVIEW = !!options.preview;
    var E = options.engine;
    var CAT = options.catalogFields || {};
    var MODEL_PICK = options.modelPick || {};
    var timeout = options.timeout || function (p) { return Promise.resolve(p); };
    var today = options.today;
    var addDays = options.addDays;
    var num = options.number || function (v) { v = Number(v); return isFinite(v) ? v : 0; };
    var TIERS_WANTED = options.tiersField || 'Cost_Tiers';
    var catalogFieldsMissing = false;
    var LOCAL_KEY = 'em-pricing-scenarios-v1';

    /* tiers field status: state = unknown | ok | missing | readonly | wrongtype | unreadable */
    var tiers = { state: PREVIEW ? 'ok' : 'unknown', apiName: null, reason: '', readVia: null };

    var store = {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    var rowsOf = function (r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; };
    var qs = function (value) { return String(value || '').replace(/'/g, "''"); };
    var round2 = function (v) { return Math.round(num(v) * 100) / 100; };
    var errText = function (e) {
      if (!e) return 'unknown error';
      if (typeof e === 'string') return e;
      if (e.message) return e.message;
      try { var d = e.data && e.data[0] ? e.data[0] : e; return (d.code ? d.code + ': ' : '') + (d.message || JSON.stringify(d)); } catch (x) { return String(e); }
    };
    function writeOk(resp) {
      var row = resp && resp.data && resp.data[0];
      if (row && (row.code === 'SUCCESS' || row.status === 'success')) return row.details || {};
      var message = (row && (row.message + (row.details && row.details.api_name ? ' (' + row.details.api_name + ')' : ''))) || 'CRM refused the change';
      throw new Error(message);
    }

    function parseTiers(v) {
      if (Array.isArray(v)) return v;
      if (!v) return [];
      try { var t = JSON.parse(v); return Array.isArray(t) ? t : []; } catch (e) { return []; }
    }
    function serializeTiers(t) {
      t = (Array.isArray(t) ? t : []).filter(function (x) { return x && num(x.min) > 0; })
        .map(function (x) { return { min: Math.round(num(x.min)), leaseDaily: x.leaseDaily == null || x.leaseDaily === '' ? null : num(x.leaseDaily), buyUnit: x.buyUnit == null || x.buyUnit === '' ? null : num(x.buyUnit) }; })
        .sort(function (a, b) { return a.min - b.min; });
      return t.length ? JSON.stringify(t) : null;
    }
    var hasTiers = function (c) { return !!serializeTiers(c && c.costTiers); };

    var local = {
      list: function () { try { return JSON.parse(store.get(LOCAL_KEY) || '[]') || []; } catch (e) { return []; } },
      put: function (scenario) {
        var all = local.list().filter(function (x) { return x.id !== scenario.id; });
        all.unshift(scenario);
        store.set(LOCAL_KEY, JSON.stringify(all.slice(0, 40)));
      }
    };

    var SAMPLE_CATALOG = [
      { id: 'p-gps520', name: '1 Piece GPS - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'GPS', costLeaseDaily: 2.55, spareAllowancePct: 35, spareOverageDaily: 1.25, costPurchase: null, costOwnedDaily: null, usefulLifeMonths: 36, replacementCost: null, source: 'EXAMPLE - Allied July 2026 invoice rate and spares.csv; confirm against the addendum', example: true, costTiers: [] },
      { id: 'p-cam520', name: 'Continuous Alcohol Monitoring (CAM) - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'CAM', costLeaseDaily: 7.60, spareAllowancePct: 0, spareOverageDaily: 0, costPurchase: null, costOwnedDaily: null, usefulLifeMonths: 36, replacementCost: 1250, source: 'EXAMPLE - Addendum 23 (Sheboygan, landline base); Sheboygan-specific', example: true, costTiers: [] },
      { id: 'p-rb520', name: 'Remote Breath Alcohol - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'Remote Breath', example: true, costTiers: [] },
      { id: 'p-rf520', name: 'Allied RF - 520', vendor: 'Allied Universal Electronic Monitoring', family: 'RF', example: true, costTiers: [] },
      { id: 'p-alcotag', name: 'AlcoTag', vendor: 'Buddi', family: 'CAM', example: true, costTiers: [] },
      { id: 'p-pureone', name: 'PureOne', vendor: 'SuperCom', family: 'GPS', example: true, costTiers: [] }
    ];
    var SAMPLE_ACCOUNTS = [{ id: 'a1', name: 'Sheboygan County Sheriffs Department' }, { id: 'a2', name: 'Columbia County Treatment Court' }, { id: 'a3', name: 'Iowa County Sheriff' }, { id: 'a4', name: 'Rock County' }];
    var SAMPLE_VENDORS = [{ id: 'v1', name: 'Allied Universal Electronic Monitoring' }, { id: 'v2', name: 'Buddi' }, { id: 'v3', name: 'SCRAM Systems' }, { id: 'v4', name: 'SuperCom' }, { id: 'v5', name: 'Track Group' }];

    function sampleScenario() {
      var s = E.blankScenario();
      s.name = 'Example County - Pretrial GPS and CAM (sample)'; s.customerName = 'Example County'; s.program = 'Pretrial Services';
      s.termMonths = 36; s.targetMarginPct = 35; s.priceEscalatorPct = 3;
      var g = E.blankLine('p-gps520'); g.units = 150; g.inactivePct = 8; g.sparePct = 40;
      g.price = { leaseDaily: 4.25, inactiveDaily: 1.00, saasMonthly: 135, purchasePrice: 0, serviceDaily: 0, lostFee: 450 };
      var c = E.blankLine('p-cam520'); c.units = 20; c.inactivePct = 0; c.sparePct = 15;
      c.price = { leaseDaily: 11.50, inactiveDaily: 0, saasMonthly: 350, purchasePrice: 0, serviceDaily: 0, lostFee: 1250 };
      s.lines = [g, c];
      s.staffing = [{ name: 'Monitoring center and case support', costMethod: 'hours', hoursPerParticipant: 0.5, costPerHour: 38, overheadPct: 25, participants: null, priceMethod: 'perDay', priceDaily: 0.75 }];
      s.fees = [{ name: 'Installation', when: 'once', qtyBasis: 'perUnit', qty: 0, price: 25, cost: 8 }, { name: 'Staff training (on site)', when: 'once', qtyBasis: 'fixed', qty: 1, price: 750, cost: 400 }];
      s.spareBilling = { enabled: true, overPct: 35, dailyRate: 1.50 };
      s.lostRatePct = 3; s.lostRecoveryPct = 50; s.minimumMonthly = 15000;
      s.proposal.preparedBy = 'Beau Carrigan';
      return s;
    }

    var api = {
      currentUser: function () {
        if (PREVIEW) return Promise.resolve('Beau Carrigan');
        return timeout(ZOHO.CRM.CONFIG.getCurrentUser(), 6000).then(function (r) { return (r && r.users && r.users[0] && r.users[0].full_name) || ''; }).catch(function () { return ''; });
      },
      keepLocalCopy: function (scenario) {
        var copy = clone(scenario);
        copy.id = copy.id || ('local-' + Date.now());
        local.put(copy);
        return copy.id;
      },
      /* diagnostics: what the Studio knows about the tiers field */
      tiersStatus: function () { return clone(tiers); }
    };

  function loadVendorRates() {
    if (PREVIEW) return Promise.resolve([]);
    var rows = [];
    function page(offset) {
      return timeout(ZOHO.CRM.API.coql({ select_query: 'select id, Name, Agency, Device_Type, Active_Rate, Inactive_Rate, Free_Inactive_Days, Basis, Source, Confirmation, Contract from Vendor_Rates where id is not null order by id asc limit ' + offset + ', 200' })).then(function (r) {
        rows = rows.concat(strictRows(r));
        return r.info && r.info.more_records ? page(offset + 200) : rows;
      });
    }
    return page(0);
  }
  function strictRows(r) {
    if (r && Array.isArray(r.data)) return r.data;
    if (r && r.status === 204) return [];
    throw new Error((r && r.message) || 'Contract records could not be read');
  }
  function loadContracts() {
    if (PREVIEW) return Promise.resolve([]);
    var all = [];
    function page(offset) {
      return timeout(ZOHO.CRM.API.coql({ select_query: "select id from Contracts where Counterparty_Type = 'Vendor' order by id asc limit " + offset + ', 200' })).then(function (r) {
        var rows = strictRows(r); all = all.concat(rows);
        if (r.info && r.info.more_records) return page(offset + 200);
      });
    }
    return page(0).then(function () {
      var out = [], chain = Promise.resolve();
      for (var i = 0; i < all.length; i += 4) (function (batch) {
        chain = chain.then(function () { return Promise.all(batch.map(function (c) {
          return timeout(ZOHO.CRM.API.getRecord({ Entity: 'Contracts', RecordID: c.id })).then(function (r) {
            var c = strictRows(r)[0];
            if (!c || c.$has_more && c.$has_more.Rate_Lines) throw new Error('A contract has incomplete rate lines; review it in CRM');
            return c;
          });
        })).then(function (rows) { out = out.concat(rows); }); });
      })(all.slice(i, i + 4));
      return chain.then(function () { return out; });
    });
  }

    api.contractSources = function () { return Promise.all([loadContracts(), loadVendorRates()]); };

    if (PREVIEW) {
      api.catalog = function () { var saved = store.get('em-pricing-catalog-v1'); return Promise.resolve(saved ? JSON.parse(saved) : clone(SAMPLE_CATALOG)); };
      api.vendors = function () { return Promise.resolve(clone(SAMPLE_VENDORS)); };
      api.saveCatalog = function (rows) {
        var saved = store.get('em-pricing-catalog-v1');
        var all = saved ? JSON.parse(saved) : clone(SAMPLE_CATALOG);
        var byId = {}; rows.forEach(function (row) { byId[String(row.id)] = row; });
        all = all.map(function (item) { return byId[String(item.id)] || item; });
        rows.forEach(function (row) { if (!all.some(function (item) { return String(item.id) === String(row.id); })) all.push(row); });
        store.set('em-pricing-catalog-v1', JSON.stringify(all));
        return Promise.resolve(rows.length);
      };
      api.accounts = function (term) { term = term.toLowerCase(); return Promise.resolve(SAMPLE_ACCOUNTS.filter(function (a) { return a.name.toLowerCase().indexOf(term) >= 0; })); };
      api.listScenarios = function () { var list = local.list(); if (!list.length) { var s = sampleScenario(); s.id = 'local-sample'; local.put(s); list = local.list(); } return Promise.resolve(list.map(function (s) { return { id: s.id, name: s.name }; })); };
      api.loadScenario = function (id) { var s = local.list().filter(function (x) { return x.id === id; })[0]; return s ? Promise.resolve(clone(s)) : Promise.reject(new Error('Not found')); };
      api.saveScenario = function (scenario) { if (!scenario.id) scenario.id = 'local-' + Date.now(); local.put(clone(scenario)); return Promise.resolve(scenario.id); };
      api.markSent = function () { return Promise.resolve(); };
      api.attach = function () { return Promise.reject(new Error('Preview: nothing is attached. In CRM the PDF is attached to the scenario record.')); };
    } else {
      api.coql = function (query) { return timeout(ZOHO.CRM.API.coql({ select_query: query })).then(rowsOf); };

      /* ---- find the tiers field from Products metadata ---- */
      var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
      function resolveTiersField() {
        var want = norm(TIERS_WANTED);
        return timeout(ZOHO.CRM.META.getFields({ Entity: 'Products' }), 10000).then(function (r) {
          var fields = (r && (r.fields || r.data)) || [];
          if (!fields.length) throw new Error('Products field list came back empty');
          var f = fields.filter(function (x) { return norm(x.api_name) === want; })[0]
               || fields.filter(function (x) { return norm(x.field_label) === want; })[0]
               || fields.filter(function (x) { return norm(x.api_name).indexOf(want) === 0 || norm(x.field_label).indexOf(want) === 0; })[0];
          if (!f) {
            tiers = { state: 'missing', apiName: null, reason: 'No field with API name ' + TIERS_WANTED + ' (or label "Cost Tiers") is visible on Products to your profile. Check the field exists and that your profile has Read and Write permission on it.' };
            return tiers;
          }
          var type = String(f.data_type || '').toLowerCase();
          if (type && type !== 'textarea' && type !== 'text') {
            tiers = { state: 'wrongtype', apiName: f.api_name, reason: 'Field ' + f.api_name + ' is type "' + f.data_type + '". It must be Multi Line (textarea).' };
            return tiers;
          }
          if (f.field_read_only || f.read_only) {
            tiers = { state: 'readonly', apiName: f.api_name, reason: 'Field ' + f.api_name + ' is read-only for your profile. Give your profile Read and Write on it.' };
            return tiers;
          }
          tiers = { state: 'ok', apiName: f.api_name, reason: f.api_name !== TIERS_WANTED ? 'Using field ' + f.api_name + ' (label "' + f.field_label + '").' : '' };
          return tiers;
        }).catch(function (e) {
          /* metadata not available: fall back to probing with COQL */
          return api.coql('select id, ' + TIERS_WANTED + ' from Products where id is not null limit 1')
            .then(function () { tiers = { state: 'ok', apiName: TIERS_WANTED, reason: '' }; return tiers; })
            .catch(function (e2) { tiers = { state: 'missing', apiName: null, reason: 'Could not read ' + TIERS_WANTED + ' on Products (' + errText(e2) + '; metadata: ' + errText(e) + ').' }; return tiers; });
        });
      }

      /* read tiers for every active product: COQL first, then the Records API */
      function readTiers(apiName) {
        return api.coql('select id, ' + apiName + ' from Products where Product_Active = true limit 200')
          .then(function (rows) { tiers.readVia = 'coql'; return rows; })
          .catch(function (e) {
            var all = [];
            var page = function (p) {
              return timeout(ZOHO.CRM.API.getAllRecords({ Entity: 'Products', sort_order: 'asc', per_page: 200, page: p })).then(function (r) {
                var rows = rowsOf(r); all = all.concat(rows);
                return r && r.info && r.info.more_records && p < 10 ? page(p + 1) : all;
              });
            };
            return page(1).then(function (rows) { tiers.readVia = 'records'; return rows; }, function (e2) {
              tiers.state = 'unreadable'; tiers.reason = 'Field ' + apiName + ' exists but could not be read (' + errText(e) + ' / ' + errText(e2) + ').';
              return [];
            });
          })
          .then(function (rows) { var map = {}; rows.forEach(function (r) { map[String(r.id)] = parseTiers(r[apiName]); }); return map; });
      }

      api.catalog = function () {
        var base = 'id, Product_Name, Vendor_Name, Product_Active';
        var extra = Object.keys(CAT).map(function (key) { return CAT[key]; }).join(', ');
        var q = function (fields) { return api.coql('select ' + fields + ' from Products where Product_Active = true order by Product_Name asc limit 200'); };
        var rowsP = q(base + ', ' + extra).catch(function () { catalogFieldsMissing = true; return q(base); });
        return Promise.all([rowsP, resolveTiersField()]).then(function (res) {
          var rows = res[0], t = res[1];
          var tiersP = t.state === 'ok' || t.state === 'readonly' ? readTiers(t.apiName) : Promise.resolve({});
          return tiersP.then(function (tmap) {
            return rows.map(function (r) {
              var c = { id: String(r.id), name: r.Product_Name, vendorId: r.Vendor_Name && (r.Vendor_Name.id || r.Vendor_Name), vendor: (r.Vendor_Name && r.Vendor_Name.name) || '' };
              Object.keys(CAT).forEach(function (key) { c[key] = r[CAT[key]] == null ? null : r[CAT[key]]; });
              c.costTiers = tmap[c.id] || [];
              return c;
            });
          });
        });
      };
      api.vendors = function () { return api.coql('select id, Vendor_Name from Vendors where id is not null order by Vendor_Name asc limit 100').then(function (rows) { return rows.map(function (v) { return { id: String(v.id), name: v.Vendor_Name }; }); }).catch(function () { return []; }); };

      api.saveCatalog = function (rows) {
        /* re-check the tiers field on every save, so a field added after load is picked up */
        var ready = tiers.state === 'ok' ? Promise.resolve(tiers) : resolveTiersField();
        return ready.then(function (t) {
          var canTiers = t.state === 'ok';
          var skipped = [];
          var chain = Promise.resolve(0);
          rows.forEach(function (c) {
            chain = chain.then(function (done) {
              var data = {};
              Object.keys(CAT).forEach(function (key) { if (key !== 'updated') data[CAT[key]] = c[key] === '' ? null : c[key]; });
              data[CAT.updated] = today();
              if (canTiers) data[t.apiName] = serializeTiers(c.costTiers);
              else if (hasTiers(c)) skipped.push(c.name || 'new device');
              if (c.isNew) {
                data.Product_Name = c.name; data.Product_Active = true; if (c.vendorId) data.Vendor_Name = { id: c.vendorId };
                return timeout(ZOHO.CRM.API.insertRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function (details) { c.id = String(details.id); c.isNew = false; return done + 1; });
              }
              data.id = c.id;
              return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Products', APIData: data })).then(writeOk).then(function () { return done + 1; });
            });
          });
          return chain.then(function (n) {
            if (skipped.length) throw new Error('Costs saved for ' + n + ' device' + (n === 1 ? '' : 's') + ', but volume tiers were NOT saved for ' + skipped.join(', ') + '. ' + t.reason);
            return n;
          });
        });
      };

      api.accounts = function (term) { return api.coql("select id, Account_Name from Accounts where Account_Name like '%" + qs(term) + "%' limit 10").then(function (rows) { return rows.map(function (a) { return { id: String(a.id), name: a.Account_Name }; }); }); };
      api.listScenarios = function () { return api.coql("select id, Name, Pricing_Model, Est_Margin_Pct, Scenario_Status, Modified_Time from Pricing_Scenarios where Scenario_Status != 'Superseded' order by Modified_Time desc limit 100").then(function (rows) { return rows.map(function (q) { return { id: String(q.id), name: q.Name, model: q.Pricing_Model, margin: q.Est_Margin_Pct }; }); }).catch(function () { return []; }); };
      api.loadScenario = function (id) {
        return timeout(ZOHO.CRM.API.getRecord({ Entity: 'Pricing_Scenarios', RecordID: id })).then(function (response) {
          var q = rowsOf(response)[0] || {}; var wrapped = null;
          try { wrapped = JSON.parse(q.Scenario_JSON || 'null'); } catch (e) {}
          if (!wrapped || !wrapped.scenario) throw new Error('This record has no Pricing Studio scenario on it.');
          var scenario = wrapped.scenario; scenario.id = String(q.id); scenario.name = q.Name || scenario.name;
          if (q.Account && q.Account.id) scenario.account = { id: String(q.Account.id), name: q.Account.name };
          if (q.Opportunity && q.Opportunity.id) scenario.deal = { id: String(q.Opportunity.id), name: q.Opportunity.name };
          return scenario;
        });
      };
      api.saveScenario = function (scenario, result) {
        var opts = (scenario.proposal.options || ['current']).map(function (o) { return o === 'current' ? result.model : o; });
        var data = {
          Name: String(scenario.name || 'Pricing scenario').slice(0, 120),
          Valid_Until: addDays(today(), num(scenario.proposal.validDays) || 30).toISOString().slice(0, 10),
          Pricing_Model: MODEL_PICK[result.model], Vendor_Source: result.vendorSource === 'buy' ? 'JP-owned fleet' : 'Lease',
          Proposal_Options: opts.map(function (m) { return MODEL_PICK[m]; }).join(', ').slice(0, 120),
          Term_Months: result.term.months, Active_Units: Math.round(result.units.active),
          Est_Monthly_Revenue: round2(result.monthly.revenue), Est_Monthly_Cost: round2(result.monthly.cost), Est_Monthly_Margin: round2(result.monthly.margin),
          Est_Margin_Pct: round2(result.monthly.marginPct), Target_Margin_Pct: round2(scenario.targetMarginPct),
          Term_Revenue: round2(result.term.revenue), Term_Margin: round2(result.term.margin),
          Upfront_Cash: round2(result.once.capex + result.once.cost - result.once.rev),
          Rev_Per_Unit_Day: result.perUnitDay ? round2(result.perUnitDay.revenue) : null, Cost_Per_Unit_Day: result.perUnitDay ? round2(result.perUnitDay.cost) : null,
          Margin_Tier: result.tier.label, Missing_Costs: result.missing.length,
          Scenario_JSON: JSON.stringify({ v: 2, saved: new Date().toISOString(), scenario: scenario })
        };
        data.Account = scenario.account && scenario.account.id ? { id: scenario.account.id } : null;
        if (result.missing.length) {
        ['Est_Monthly_Cost', 'Est_Monthly_Margin', 'Est_Margin_Pct', 'Term_Margin', 'Upfront_Cash', 'Cost_Per_Unit_Day'].forEach(function (k) { data[k] = null; });
        data.Margin_Tier = null;
      }
      var isNew = !scenario.id || /^local-/.test(scenario.id); if (isNew) data.Scenario_Status = 'Draft';
        var call = isNew
          ? function () { return ZOHO.CRM.API.insertRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); }
          : function () { data.id = scenario.id; return ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: data, Trigger: [] }); };
        return timeout(call()).then(writeOk).then(function (details) { return String(details.id || scenario.id); });
      };
      api.markSent = function (id) { return timeout(ZOHO.CRM.API.updateRecord({ Entity: 'Pricing_Scenarios', APIData: { id: id, Proposal_Sent: today(), Scenario_Status: 'Proposed' } })).then(writeOk); };
      api.attach = function (id, name, blob) { return timeout(ZOHO.CRM.API.attachFile({ Entity: 'Pricing_Scenarios', RecordID: id, File: { Name: name, Content: blob } }), 30000); };
    }

    Object.defineProperty(api, 'catalogFieldsMissing', { enumerable: true, get: function () { return catalogFieldsMissing; } });
    /* only warn once we actually know; the reason is logged so it shows in the browser console */
    Object.defineProperty(api, 'tiersFieldMissing', { enumerable: true, get: function () {
      var bad = !PREVIEW && tiers.state !== 'ok' && tiers.state !== 'unknown';
      if (bad && root.console) root.console.warn('[Pricing Studio] Volume tiers: ' + tiers.reason);
      return bad;
    } });
    return api;
  }

  root.PricingCRM = { create: create };
})(this);
