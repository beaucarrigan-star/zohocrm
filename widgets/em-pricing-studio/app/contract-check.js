/* =============================================================================
   EM Pricing Studio — vendor contract check (add-on, 26 Sep 2026; v85 28 Sep 2026)
   Compares each device's Lease $/day in the Cost catalog with the "Vendor cost"
   Rate Lines on that vendor's Contracts (Counterparty Type = Vendor, not Ended).
   Exact to the cent; a match against ANY of the vendor's contracts passes.
   A CAM product is checked against both CAM (wireless) and CAM Landline lines.
   Only CURRENT lines count (same rule as vendor_cost_contract_margin v3/v4):
   Superseded_By empty and Effective_Date empty or not in the future.
   - Cost catalog: adds a "Vendor contract" column (live badge + the Rate Lines
     device the product is checked against, which saves straight to Products).
   - Scenario tab: device cost hints get a warning when the cost differs.
   - After a catalog save, nudges the CRM workflow so Products > Contract Check
     and the Contract margin fields recompute.
   - Volume tiers: ALLIED ONLY. The tier volume (Products > Tier Volume) is Allied's leased
     1-Piece GPS on leg, so Tier Min/Max on another vendor's lines (e.g. SuperCom's
     "414-908 units") is shown as a plain contract rate, never tiered by Allied's count.
     The CRM sets the Allied tier daily and writes its rate to Lease $/day, so that input is
     read-only in the catalog. The Scenario tab shows whether a scenario's units move the tier.
   Runs beside studio.js without touching its code: it reads the rendered DOM.
   Needs on Products: Contract_Rate_Device, Tier_Volume, Tier_Volume_Date; and the Rate_Lines
   module. If any are missing the catalog note says the rates could not be read and nothing else changes.
   ============================================================================= */
(function () {
  'use strict';
  /* same test as studio.js: Zoho mode only when the SDK is loaded and CRM frames us */
  var IN_ZOHO = !!(window.ZOHO && window.ZOHO.embeddedApp && window.ZOHO.CRM) && window.self !== window.top;
  var PREVIEW = !IN_ZOHO || /[?&]preview=1\b/.test(location.search);
  var DEVICES = ['GPS', 'Wrist-worn GPS', '2-Piece GPS', 'Remote Breath', 'CAM', 'CAM Landline', 'Hybrid GPS + Alcohol', 'Victim / DV', 'RF', 'Other'];
  /* vendors whose Rate Line tiers follow the Daily Unit Counts tier volume (Allied; preview ids too) */
  var TIER_VENDORS = { '6715134000002099249': 1, 'v-allied': 1, 'v1': 1 };
  var st = { byName: {}, byId: {}, rates: {}, ready: false, err: null };
  var DAYS = 365 / 12;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var cents = function (v) { return Math.round(Number(v) * 100); };
  var rate = function (v) { return '$' + Number(v).toFixed(2); };
  var rowsOf = function (r) { if (!r) return []; if (Array.isArray(r)) return r; if (Array.isArray(r.data)) return r.data; if (r.data && Array.isArray(r.data.data)) return r.data.data; return []; };
  var idOf = function (x) { return x == null ? '' : String(typeof x === 'object' ? (x.id || '') : x); };
  var today = function () { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  var shortSrc = function (s) { return String(s || '').replace(/ Universal Electronic Monitoring/, '').replace(/ - vendor pricing/, ''); };
  /* one candidate per vendor|device; the same rate and tier from a re-ingested document is listed once */
  function addRate(v, d, amt, src, mn, mx) {
    var tiered = !!TIER_VENDORS[v] && mn != null, k = v + '|' + d, list = st.rates[k] = st.rates[k] || [];
    var o = { amt: Number(amt), src: src, min: tiered ? Number(mn) : null, max: tiered && mx != null ? Number(mx) : null };
    if (list.some(function (x) { return cents(x.amt) === cents(o.amt) && x.min === o.min && x.max === o.max; })) return;
    list.push(o);
  }

  /* ---------- data ---------- */
  function coql(q) { return ZOHO.CRM.API.coql({ select_query: q }).then(rowsOf); }
  function load() {
    if (PREVIEW) {
      var A = 'v-allied', S = 'v-scram', B = 'v-buddi', C = 'v-supercom';
      st.byName = {}; st.byId = {}; st.rates = {};
      [['1 Piece GPS - Allied', A, 'GPS'], ['2 Piece GPS - Allied', A, '2-Piece GPS'], ['RF - Allied', A, 'RF'], ['SCRAM Remote Breath - Allied', A, 'Remote Breath'], ['Wrist worn GPS - Allied', A, 'Wrist-worn GPS'], ['GPS + Transdermal Hybrid - Allied', A, 'Hybrid GPS + Alcohol'], ['SCRAM CAM - Allied', A, 'CAM'], ['SCRAM CAM - SCRAM Systems', S, 'CAM'], ['SCRAM Remote Breath - SCRAM Systems', S, 'Remote Breath'], ['GPS + Transdermal Hybrid - Buddi', B, 'Hybrid GPS + Alcohol'], ['1 Piece GPS - SuperCom', C, 'GPS'], ['1 Piece GPS w/DV - SuperCom', C, 'Victim / DV'],
        /* the preview catalog's own sample devices */
        ['GPS device', 'v1', 'GPS'], ['Continuous alcohol monitor (CAM)', 'v1', 'CAM'], ['Remote breath device', 'v2', 'Remote Breath'], ['RF device', 'v2', 'RF']].forEach(function (p, i) {
        var o = { id: 'pv' + i, name: p[0], vendorId: p[1], device: p[2] }; st.byName[p[0]] = o; st.byId[o.id] = o;
      });
      addRate(A, 'GPS', 3.15, 'Allied (standard) · 1-Piece GPS, 1-50/day', 1, 50); addRate(A, 'GPS', 3.10, 'Allied (standard) · 1-Piece GPS, 51-300/day', 51, 300); addRate(A, 'GPS', 3.05, 'Allied (standard) · 1-Piece GPS, 301-400/day', 301, 400); addRate(A, 'GPS', 2.82, 'Allied (standard) · 1-Piece GPS, 401+/day (Add. 24)', 401, null);
      st.byName['1 Piece GPS - Allied'].tierVol = 340; st.byName['1 Piece GPS - Allied'].tierDate = '2026-09-24';
      addRate(A, 'Remote Breath', 3.50, 'Allied (standard) · Allied RB'); addRate(A, 'CAM', 8.53, 'Allied (standard) · Allied CAM wireless');
      addRate(S, 'CAM', 6.94, 'SCRAM · SCRAM CAM wireless'); addRate(S, 'Remote Breath', 3.82, 'SCRAM · SCRAM RB');
      addRate(B, 'Hybrid GPS + Alcohol', 6.50, 'Buddi · AlcoTag w/GPS'); addRate(C, 'GPS', 2.75, 'SuperCom · PureOne GPS'); addRate(C, 'GPS', 3.00, 'SuperCom · GPS, 414-908 units', 414, 908); addRate(C, 'Victim / DV', 4.25, 'SuperCom · Domestic Violence');
      addRate('v1', 'GPS', 3.25, 'Sample vendor A · GPS, 1-1500/day', 1, 1500); addRate('v1', 'GPS', 3.05, 'Sample vendor A · GPS, 1501-2000/day', 1501, 2000); addRate('v1', 'GPS', 2.82, 'Sample vendor A · GPS, 2001+/day', 2001, null);
      st.byName['GPS device'].tierVol = 1700; st.byName['GPS device'].tierDate = today();
      addRate('v1', 'CAM', 7.00, 'Sample vendor A · CAM wireless'); addRate('v2', 'Remote Breath', 3.82, 'Sample vendor B · RB');
      st.ready = true; return Promise.resolve();
    }
    return Promise.all([
      coql('select id, Product_Name, Vendor_Name, Contract_Rate_Device, Cost_Lease_Daily, Tier_Volume, Tier_Volume_Date from Products where Product_Active = true limit 200'),
      coql("select id, Name, Vendor, Account, Contract_Status from Contracts where Counterparty_Type = 'Vendor' limit 200"),
      coql("select id, Parent_Id, Rate_Vendor, Rate_Device, Rate_Daily_Amount, Rate_Terms, Tier_Min_Units, Tier_Max_Units, Superseded_By, Effective_Date from Rate_Lines where Rate_Type = 'Vendor cost' limit 2000")
    ]).then(function (res) {
      st.byName = {}; st.byId = {}; st.rates = {};
      res[0].forEach(function (p) {
        var vid = idOf(p.Vendor_Name);
        var o = { id: String(p.id), name: p.Product_Name, vendorId: vid, device: p.Contract_Rate_Device || '', cost: p.Cost_Lease_Daily,
          tierVol: TIER_VENDORS[vid] ? p.Tier_Volume : null, tierDate: p.Tier_Volume_Date };
        st.byName[o.name] = o; st.byId[o.id] = o;
      });
      var cons = {}; res[1].forEach(function (c) { cons[String(c.id)] = c; });
      var now = today();
      res[2].forEach(function (ln) {
        var c = cons[idOf(ln.Parent_Id)]; if (!c || c.Contract_Status === 'Ended') return;
        if (idOf(c.Account)) return; /* customer-specific vendor pricing (e.g. Sheboygan): not part of the catalog check */
        if (ln.Rate_Daily_Amount == null || !ln.Rate_Device) return;
        if (ln.Superseded_By) return;                                    /* replaced by a later document, or rejected in review */
        if (ln.Effective_Date && String(ln.Effective_Date).slice(0, 10) > now) return;   /* not in force yet */
        var v = idOf(ln.Rate_Vendor) || idOf(c.Vendor);
        addRate(v, ln.Rate_Device, ln.Rate_Daily_Amount, shortSrc(c.Name) + (ln.Rate_Terms ? ' · ' + ln.Rate_Terms : ''), ln.Tier_Min_Units, ln.Tier_Max_Units);
      });
      st.ready = true;
    }).catch(function (e) { st.err = (e && e.message) || 'could not read vendor contracts'; st.ready = true; });
  }

  /* ---------- the check ---------- */
  function check(prod, cost) {
    if (!prod) return { key: 'none', label: 'Not in CRM yet', tip: '' };
    if (!prod.device) return { key: 'none', label: 'Pick a device', tip: 'Choose which Rate Lines device on the vendor contract this product is checked against.' };
    var cands = candsOf(prod);
    var tip = cands.map(function (c) { return c.src + ': ' + rate(c.amt); }).join('\n');
    if (!cands.length) return { key: 'none', label: 'No contract rate', tip: 'No current Vendor cost Rate Line for ' + prod.device + ' on this vendor’s Contracts.' };
    var tiers = tiersOf(cands);
    if (tiers.length && prod.tierVol != null) {
      var cur = tierFor(tiers, prod.tierVol);
      if (cur) {
        var ttip = tip + '\nToday: ' + prod.tierVol + ' active devices' + (prod.tierDate ? ' (' + prod.tierDate + ')' : '') + ' → ' + tierName(cur) + '. The CRM sets this cost from the tier every morning, so Lease $/day is read-only here.';
        if (cost == null || cost === '' || isNaN(Number(cost)) || cents(cost) === cents(cur.amt)) return { key: 'strong', label: '✓ Tier ' + tierName(cur) + ' · ' + rate(cur.amt), tip: ttip, match: cur, tier: cur, sub: prod.tierVol + ' active devices' };
        return { key: 'thin', label: '≠ Tier rate ' + rate(cur.amt), tip: ttip + '\nEntered: ' + rate(cost), differs: true, tier: cur, sub: prod.tierVol + ' devices → ' + tierName(cur) };
      }
    }
    var list = cands.map(function (c) { return rate(c.amt); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(' / ');
    if (cost == null || cost === '' || isNaN(Number(cost))) return { key: 'none', label: 'Contract ' + list, tip: tip, rates: cands };
    var hit = cands.filter(function (c) { return cents(c.amt) === cents(cost); })[0];
    if (hit) return { key: 'strong', label: '✓ Matches ' + rate(hit.amt), tip: tip, match: hit };
    return { key: 'thin', label: '≠ Contract ' + list, tip: tip + '\nEntered: ' + rate(cost), differs: true };
  }

  function tiersOf(cands) { return cands.filter(function (c) { return c.min != null; }).sort(function (a, b) { return a.min - b.min; }); }
  function tierFor(tiers, n) { return tiers.filter(function (t) { return n >= t.min && (t.max == null || n <= t.max); })[0] || null; }
  function tierName(t) { return t.max == null ? t.min + '+' : t.min + '–' + t.max; }
  function candsOf(prod) { return (st.rates[prod.vendorId + '|' + prod.device] || []).concat(prod.device === 'CAM' ? (st.rates[prod.vendorId + '|CAM Landline'] || []) : []); }

  /* ---------- cost catalog ---------- */
  var busy = false;
  function rowName(tr) { var b = tr.querySelector('td b'); if (b) return b.textContent; var i = tr.querySelector('input[data-cat="name"]'); return i ? i.value : ''; }
  function badgeHtml(c) { return '<span class="chip ' + c.key + '" title="' + esc(c.tip) + '">' + esc(c.label) + '</span>' + (c.sub ? '<div class="vc-sub">' + esc(c.sub) + '</div>' : ''); }
  function decorateCatalog() {
    var tbl = $('cat-table') && $('cat-table').querySelector('table.cat'); if (!tbl || busy) return;
    busy = true;
    try {
      var head = tbl.querySelector('thead tr');
      if (head && !head.querySelector('th.vc')) {
        var ths = head.querySelectorAll('th'), leaseTh = ths[3];
        var th = document.createElement('th'); th.className = 'vc'; th.title = 'Lease $/day compared with the current Vendor cost Rate Lines on this vendor’s Contracts. Exact match to the cent against any of the vendor’s contracts.';
        th.textContent = 'Vendor contract'; if (leaseTh) leaseTh.after(th); else head.appendChild(th);
      }
      Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr[data-ci]'), function (tr) {
        var lease = tr.querySelector('input[data-cat="costLeaseDaily"]'); if (!lease) return;
        var td = tr.querySelector('td.vc');
        var prod = st.byName[rowName(tr)];
        if (!td) {
          td = document.createElement('td'); td.className = 'vc';
          lease.closest('td').after(td);
        }
        var c = check(prod, lease.value);
        /* tiered (Allied) cost is owned by the CRM: typing here would be overwritten next morning */
        lease.readOnly = !!c.tier;
        lease.title = c.tier ? 'Set by the CRM each morning from the Allied tier (' + tierName(c.tier) + ')' : '';
        var sel = prod ? '<select class="vc-dev" aria-label="Contract rate device" title="Rate Lines device on the vendor contract">' + '<option value="">Device…</option>' + DEVICES.map(function (d) { return '<option' + (d === prod.device ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>' : '';
        td.innerHTML = '<div class="vc-b">' + badgeHtml(c) + '</div>' + sel;
        td.setAttribute('data-prod', prod ? prod.id : '');
      });
      var note = $('cat-note');
      if (note && !note.querySelector('.vc-note')) {
        var sp = document.createElement('span'); sp.className = 'vc-note';
        sp.innerHTML = ' <b>Vendor contract</b> checks Lease $/day against the vendor’s current Contract Rate Lines (exact match; hover a badge for the rates and contracts). Allied 1-Piece GPS cost follows the daily tier and is locked here.' + (st.err ? ' <span style="color:var(--bad)">Contract rates could not be read: ' + esc(st.err) + '</span>' : '');
        note.appendChild(sp);
      }
    } finally { busy = false; }
  }
  function onCatInput(ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('vc-dev') && ev.type === 'change') { saveDevice(t); return; }
    if (t.getAttribute && t.getAttribute('data-cat') === 'costLeaseDaily') {
      var tr = t.closest('tr'), td = tr && tr.querySelector('td.vc'), prod = st.byName[rowName(tr)];
      if (td) { var b = td.querySelector('.vc-b'); if (b) b.innerHTML = badgeHtml(check(prod, t.value)); }
      if (prod) prod.cost = t.value === '' ? null : Number(t.value);
    }
  }
  function saveDevice(sel) {
    var td = sel.closest('td'), prod = st.byId[td.getAttribute('data-prod')]; if (!prod) return;
    var prev = prod.device; prod.device = sel.value;
    var tr = td.closest('tr'), lease = tr.querySelector('input[data-cat="costLeaseDaily"]');
    td.querySelector('.vc-b').innerHTML = badgeHtml(check(prod, lease && lease.value));
    if (PREVIEW) return;
    ZOHO.CRM.API.updateRecord({ Entity: 'Products', APIData: { id: prod.id, Contract_Rate_Device: sel.value || null }, Trigger: ['workflow'] })
      .then(function (r) { var row = r && r.data && r.data[0]; if (!row || row.code !== 'SUCCESS') throw new Error((row && row.message) || 'CRM refused the change'); })
      .catch(function (e) { prod.device = prev; sel.value = prev || ''; td.querySelector('.vc-b').innerHTML = badgeHtml(check(prod, lease && lease.value)); alertToast('Device not saved · ' + e.message); });
  }
  function alertToast(msg) { var t = $('toast'); if (!t) return; t.textContent = msg; t.className = 'toast bad'; t.hidden = false; setTimeout(function () { t.hidden = true; }, 7000); }

  /* After a catalog save, poke one saved product with Trigger:workflow so the CRM
     recalculates Contract Check on Products and the margin fields on Contracts. */
  function watchSave() {
    var btn = $('cat-save'); if (!btn) return;
    btn.addEventListener('click', function () {
      if (PREVIEW) return;
      var names = Array.prototype.map.call(document.querySelectorAll('#cat-table tr.changed'), rowName);
      var ids = names.map(function (n) { return st.byName[n] && st.byName[n].id; }).filter(Boolean);
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        var done = btn.textContent.indexOf('Saving') < 0 && !document.querySelector('#cat-table tr.changed');
        if (done || tries > 60) {
          clearInterval(poll);
          if (!done) return;
          var id = ids[0];
          var go = id ? Promise.resolve(id) : load().then(function () { var n = Object.keys(st.byName)[0]; return n && st.byName[n].id; });
          go.then(function (pid) { if (pid) return ZOHO.CRM.API.updateRecord({ Entity: 'Products', APIData: { id: pid, Cost_Updated: today() }, Trigger: ['workflow'] }); })
            .then(function () { return load(); }).then(decorateCatalog).catch(function () {});
        }
      }, 500);
    }, true);
  }

  /* ---------- scenario tab: cost hint warning ---------- */
  var busyB = false;
  function decorateBuilder() {
    var b = $('builder'); if (!b || busyB) return;
    busyB = true;
    try {
      Array.prototype.forEach.call(b.querySelectorAll('select[data-bind$=".itemId"]'), function (sel) {
        var i = (sel.getAttribute('data-bind').match(/lines\.(\d+)\./) || [])[1], hint = $('line-hint-' + i); if (!hint) return;
        var name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text.split(' · ')[0] : '';
        var prod = st.byId[sel.value] || st.byName[name], old = hint.querySelector('.vc-w');
        /* the hint reads "Vendor · Cost $3.05/day · …" (or just "Cost $3.05/day"); take the figure after "Cost $" */
        var m = hint.textContent.match(/(?:^|· )Cost \$([\d.,]+)/);
        var c = prod && m ? check(prod, Number(m[1].replace(/,/g, ''))) : null;
        /* a tiered cost that differs only because the scenario's own units move the tier is expected, not a mismatch */
        var want = c && c.differs && !c.tier;
        if (want && !old) { var w = document.createElement('span'); w.className = 'vc-w'; w.title = c.tip; w.textContent = ' · ⚠ vendor contract ' + c.label.replace(/^≠ (Contract|Tier rate) /, ''); hint.appendChild(w); }
        else if (!want && old) old.remove();
        /* tier impact of this scenario's units */
        var tmsg = prod && m ? tierImpact(prod, i) : null, oldT = hint.querySelector('.vc-t');
        var ttext = tmsg ? tmsg.text : '';
        if (oldT && oldT.getAttribute('data-t') !== ttext) { oldT.remove(); oldT = null; }
        if (tmsg && !oldT) { var tt = document.createElement('div'); tt.className = 'vc-t' + (tmsg.good ? ' good' : ''); tt.setAttribute('data-t', ttext); tt.title = tmsg.tip; tt.textContent = ttext; hint.appendChild(tt); }
      });
    } finally { busyB = false; }
  }

  function pressed(act) { var b = document.querySelector('#builder [data-act="' + act + '"][aria-pressed="true"]'); return b ? b.getAttribute('data-v') : ''; }
  function tierImpact(prod, i) {
    var tiers = tiersOf(candsOf(prod)); if (!tiers.length || prod.tierVol == null) return null;
    var model = pressed('model'), source = pressed('source');
    if (model === 'purchase' || source === 'buy') return null; /* JP-owned units are not leased, so they do not count toward the lease tier */
    var inp = $('builder').querySelector('input[data-bind="lines.' + i + '.' + (model === 'transparent' ? 'commitUnits' : 'units') + '"]');
    var add = inp ? Number(inp.value || (inp.placeholder || 0)) : 0; if (!(add > 0)) return null;
    var now = prod.tierVol, after = now + Math.round(add), cur = tierFor(tiers, now), nxt = tierFor(tiers, after);
    if (!cur || !nxt) return null;
    var fmt = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
    if (cents(nxt.amt) !== cents(cur.amt)) {
      var per = (cur.amt - nxt.amt) * now * DAYS, own = (cur.amt - nxt.amt) * after * DAYS;
      return { good: nxt.amt < cur.amt, text: 'Tier: ' + now + ' today + ' + Math.round(add) + ' here = ' + after + ' devices moves Allied from ' + tierName(cur) + ' (' + rate(cur.amt) + ') to ' + tierName(nxt) + ' (' + rate(nxt.amt) + '): about ' + fmt(own) + '/mo lower vendor cost across the fleet, ' + fmt(per) + ' of it on the existing ' + now + ' units.', tip: 'The vendor bills every active device at the tier for that day’s count. Estimate assumes today’s volume plus this scenario’s units, every day. The margin in this scenario already uses the tier it reaches.' };
    }
    var up = tiers.filter(function (t) { return t.min > (cur.max == null ? Infinity : cur.max); })[0];
    return { good: false, text: 'Tier: ' + now + ' today + ' + Math.round(add) + ' here = ' + after + ' devices stays in ' + tierName(cur) + ' (' + rate(cur.amt) + ')' + (up ? '; ' + (up.min - after) + ' more to reach ' + tierName(up) + ' at ' + rate(up.amt) + '.' : '.'), tip: 'The vendor bills every active device at the tier for that day’s count.' };
  }

  /* ---------- wiring ---------- */
  function start() {
    var css = document.createElement('style');
    css.textContent = '.vc-sub{font-size:11px;color:var(--muted);margin-top:2px}.vc-t{margin-top:3px;color:var(--ink-2)}.vc-t.good{color:var(--good)}.cat td.vc{min-width:150px}.cat td.vc .vc-b{margin-bottom:4px}.cat td.vc select.vc-dev{min-width:0;width:140px;min-height:26px;font-size:12px;padding:3px 6px}.vc-w{color:var(--warn);font-weight:600}.vc-note{color:var(--muted)}.cat input[readonly]{background:var(--surface-2);color:var(--ink-2);cursor:not-allowed}';
    document.head.appendChild(css);
    var cat = $('cat-table'), bld = $('builder');
    if (cat) {
      new MutationObserver(function () { if (!busy) decorateCatalog(); }).observe(cat, { childList: true });
      cat.addEventListener('input', onCatInput); cat.addEventListener('change', onCatInput);
    }
    if (bld) new MutationObserver(function () { if (!busyB) decorateBuilder(); }).observe(bld, { childList: true, subtree: true, characterData: true });
    watchSave();
    /* studio.js initialises the Zoho SDK; wait for it, and retry if the SDK was not ready yet */
    var tryLoad = function (n) {
      load().then(function () {
        if (st.err && n < 4) { st.err = null; st.ready = false; setTimeout(function () { tryLoad(n + 1); }, 1500); return; }
        decorateCatalog(); decorateBuilder();
      });
    };
    setTimeout(function () { tryLoad(1); }, PREVIEW ? 0 : 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
