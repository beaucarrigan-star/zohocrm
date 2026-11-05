/* node tools/patch-cs-home.js <Beau CS Home widget.html> [--check]
   S76 step 6: a "Rates to fill: N" line in Needs you today (Beau CS Home v6.15.2 -> v6.16.0, off with ?s76=0).
   N = Part B rows still to fix in Processes > Rates to fill (status not Priced, or flagged), computed with rates-model.js
   inlined byte for byte, from the same three reads as the Rates screen. Administrators only (as the Rates screen); the line opens
   Admin Processes through the page's own billingCheck action. Nothing is written.
   Hash-guarded: the base must be v6.15.2 (sha256 prefix below) or already patched. --check: the inlined model equals rates-model.js. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const file = process.argv[2], check = process.argv.includes('--check');
const MODEL = fs.readFileSync(path.join(__dirname, '..', 'rates-model.js'), 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const BASE = '9810dcd06f868cb1';   /* Beau CS Home v6.15.2 (S75) app/widget.html */
const OPEN = '<script id="rates-model">', CLOSE = '</script>\n';
let html = fs.readFileSync(file, 'utf8');
if (check) {
  const i = html.indexOf(OPEN); if (i < 0) { console.error('not patched'); process.exit(1); }
  if (html.slice(i + OPEN.length, html.indexOf('</script>', i)) !== '\n' + MODEL) { console.error('inlined model differs from rates-model.js'); process.exit(1); }
  console.log('inline OK', sha(MODEL)); process.exit(0);
}
const patched = html.includes('id="jpk-s76-rates"');
if (!patched && sha(html) !== BASE) { console.error('refusing: widget.html is ' + sha(html) + ', expected ' + BASE + ' (Beau CS Home v6.15.2)'); process.exit(1); }
const rep = (a, b, what) => { if (html.includes(b)) return; if (!html.includes(a)) { console.error('anchor not found: ' + what); process.exit(1); } html = html.replace(a, b); };
/* 1-3: the Needs Today list learns a "rates" row */
rep("    verify: { tag: 'Verify', area: 'Admin Processes' }\n  };",
    "    verify: { tag: 'Verify', area: 'Admin Processes' },\n    rates: { tag: 'Rates', area: 'Admin Processes' }   /* S76: Rates to fill (jpk-s76-rates) */\n  };", 'NT_TYPES');
rep("var SEE_ALL = { stock: '#z-sm', approve: '#agenda-card', renewal: '#needs-today', verify: '#agenda-card', lost: '#needs-today' };",
    "var SEE_ALL = { stock: '#z-sm', approve: '#agenda-card', renewal: '#needs-today', verify: '#agenda-card', lost: '#needs-today', rates: '#needs-today' };", 'SEE_ALL');
rep("    rows.sort(function (a, b) {\n      if (a.date != null && b.date != null) return a.date - b.date || idCmp(a.id, b.id);",
    "    /* 6. S76: Rates to fill (Administrators; set by jpk-s76-rates from rates-model.js, the Rates screen's own count) */\n" +
    "    var rf = root.__jpkRatesToFill;\n" +
    "    if (rf && rf.n > 0) add({ type: 'rates', id: 'rates-to-fill', text: 'Rates to fill: ' + rf.n + (rf.unpriced ? ' (' + rf.unpriced + ' of ' + rf.units + ' units on leg not priced)' : ''), date: null, act: 'Open', go: { kind: 'rec', module: 'Rate_Lines', id: 'rates-to-fill', fallback: 'billingCheck' } });\n" +
    "    rows.sort(function (a, b) {\n      if (a.date != null && b.date != null) return a.date - b.date || idCmp(a.id, b.id);", 'needsModel sort');
/* 3b: the "See all" box (JPKPop needsToday) labels the row like the list does */
rep("lost: 'Lost or damaged', verify: 'Verify' }[r.type] || r.type; }, filter: true },",
    "lost: 'Lost or damaged', verify: 'Verify', rates: 'Rates' }[r.type] || r.type; }, filter: true },", 'popout Type labels');
rep("lost: 'Lost & Damaged Devices', verify: 'Admin Processes' }[r.type] || '';",
    "lost: 'Lost & Damaged Devices', verify: 'Admin Processes', rates: 'Admin Processes' }[r.type] || '';", 'popout Area labels');
/* 4: the model and the loader, before </body> */
const LOADER = `<script id="jpk-s76-rates">
/* jpk-s76-rates.js v1.0.0 (S76, 5 Nov 2026): "Rates to fill: N" for Needs you today. Off with ?s76=0.
   Administrators only. Reads Daily Unit Counts (last 8 days), Rate Lines (customer rate + vendor cost) and Contracts, runs
   RatesModel.build (the Rates screen's model), and publishes { n, unpriced, units } on window.__jpkRatesToFill, then re-renders the list.
   N = Part B rows to fix (not Priced, or flagged), the same as Processes > Rates to fill "To fix". Read-only. Demo: a labelled sample. */
(function (root) {
  'use strict';
  if (/[?&]s76=0\\b/.test(root.location.search)) return;
  function Z() { var z = root.ZOHO; return z && z.CRM && z.CRM.API && z.CRM.CONFIG ? z.CRM : null; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function publish(v) { root.__jpkRatesToFill = v; try { if (root.JPKShell && root.JPKShell.needs) root.JPKShell.needs.render(); } catch (e) { /* the list re-renders on its next refresh */ } }
  function coqlAll(q) {
    var all = [];
    function page(off) {
      return Z().API.coql({ select_query: q + ' order by id asc limit 200 offset ' + off }).then(function (r) {
        var rows = (r && r.data) || []; all = all.concat(rows); return rows.length === 200 && all.length < 6000 ? page(off + 200) : all;
      }, function (e) { if (!e || e.status === 204 || e.code === 'NO_CONTENT' || e === '') return all; throw e; });
    }
    return page(0);
  }
  function isAdmin(u) { var id = ''; try { id = String(root.JPKR && root.JPKR().admin_id || ''); } catch (e) {} return !!(u && ((u.profile && /^administrator$/i.test(u.profile.name || '')) || (id && String(u.id) === id))); }
  function run() {
    if (!root.RatesModel) return;
    var demo = /[?&](demo|ntdemo)=1/.test(root.location.search) || !Z();
    if (demo) { publish({ n: 6, unpriced: 67, units: 244, demo: true }); return; }
    Z().CONFIG.getCurrentUser().then(function (r) {
      var u = r && r.users && r.users[0]; if (!isAdmin(u)) return;
      var d8 = new Date(); d8.setDate(d8.getDate() - 8);
      return Promise.all([
        coqlAll("select Count_Date, Account, Account.Account_Name, SmartView_Customer, Device_Family, Vendor, Supplied_Through, Hardware_Version, Acquisition, On_Leg from Daily_Unit_Counts where (Count_Date >= '" + ymd(d8) + "' and On_Leg > 0)"),
        coqlAll("select id, Parent_Id, Parent_Id.Name, Rate_Type, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Effective_Date, Tier_Min_Units from Rate_Lines where Rate_Type in ('Customer rate','Vendor cost')"),
        coqlAll("select id, Name, Account, Account.Account_Name, Vendor, Counterparty_Type, Contract_Status, Final_End_Date, Rate_Basis from Contracts where Counterparty_Type in ('Customer','Vendor')")
      ]).then(function (x) {
        var out = root.RatesModel.build({ units: x[0], lines: x[1], contracts: x[2], today: ymd(new Date()) });
        var n = out.partB.filter(function (r) { return r.status !== 'Priced' || (r.flags && r.flags.length); }).length;
        publish({ n: n, unpriced: out.totals.unpriced, units: out.totals.units });
      });
    }).catch(function () { /* no line: the home page stays as it was */ });
  }
  /* wait for the page shell (and the SDK init it does) before reading */
  var tries = 0;
  (function wait() {
    if (root.JPKShell && root.JPKShell.needs && (Z() || tries > 20)) { setTimeout(run, 1500); return; }
    if (++tries < 60) setTimeout(wait, 500);
  })();
})(window);
</script>
`;
if (patched) { const i = html.indexOf(OPEN), j = html.indexOf(CLOSE, i) + CLOSE.length; html = html.slice(0, i) + html.slice(j); const a = html.indexOf('<script id="jpk-s76-rates">'), b = html.indexOf(CLOSE, a) + CLOSE.length; html = html.slice(0, a) + html.slice(b); }
const end = html.lastIndexOf('</body>');
html = html.slice(0, end) + OPEN + '\n' + MODEL + CLOSE + LOADER + html.slice(end);
/* 5: build line */
html = html.replace('content="Beau CS Home v6.15.2 (', 'content="Beau CS Home v6.16.1 (S76, 5 Nov 2026: Needs you today shows "Rates to fill: N" for Administrators, from rates-model.js ' + /VERSION = '([^']+)'/.exec(MODEL)[1] + ', off with ?s76=0) + v6.15.2 (');
fs.writeFileSync(file, html);
console.log('patched', file, '| model', sha(MODEL));
