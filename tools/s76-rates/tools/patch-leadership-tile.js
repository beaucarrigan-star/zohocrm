/* node tools/patch-leadership-tile.js <leadership widget.html> [--check]
   Switches the Leadership Home "Margin by vendor" tile to rates-model.js (S76 step 2):
   1. inlines rates-model.js byte for byte in <script id="rates-model"> right before <script id="jpk-s77"> (replaced on re-run)
   2. the tile's units / rates / contracts queries also select the lookup names (widget COQL returns lookups as bare ids)
   3. vendors() becomes RatesModel.build(...).tile, so the tile and Processes > Rates use one set of rules.
   Hash-guarded: refuses to patch unless the old vendor block hashes to a known version (v47.10.2), or the file is already patched.
   --check: exit 1 unless the inlined model equals rates-model.js. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const file = process.argv[2], check = process.argv.includes('--check');
const MODEL = fs.readFileSync(path.join(__dirname, '..', 'rates-model.js'), 'utf8');
let html = fs.readFileSync(file, 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const OPEN = '<script id="rates-model">', CLOSE = '</script>\n';
if (check) {
  const i = html.indexOf(OPEN); if (i < 0) { console.error('not patched'); process.exit(1); }
  const body = html.slice(i + OPEN.length, html.indexOf('</script>', i));
  if (body !== '\n' + MODEL) { console.error('inlined model differs from rates-model.js'); process.exit(1); }
  console.log('inline OK', sha(MODEL)); process.exit(0);
}
const A = html.indexOf('  /* vendor margin estimate'), Z = html.indexOf('  function pricing() {');
const KNOWN = { 'v47.10.2': '' };
const already = html.includes(OPEN);
if (A < 0 || Z < 0) { if (!already) { console.error('vendor block not found; refusing'); process.exit(1); } }
const oldBlock = A >= 0 ? html.slice(A, Z) : '';
const h = sha(oldBlock);
if (!already && process.env.EXPECT_HASH && h !== process.env.EXPECT_HASH) { console.error('vendor block hash ' + h + ' is not the expected ' + process.env.EXPECT_HASH + '; refusing'); process.exit(1); }
console.log('vendor block hash', h || '(already patched)');
/* 1. model script */
if (already) { const i = html.indexOf(OPEN), j = html.indexOf(CLOSE, i) + CLOSE.length; html = html.slice(0, i) + html.slice(j); }
const s77 = html.indexOf('<script id="jpk-s77">'); if (s77 < 0) { console.error('jpk-s77 script not found'); process.exit(1); }
html = html.slice(0, s77) + OPEN + '\n' + MODEL + CLOSE + html.slice(s77);
/* 2. queries */
const rep = (from, to) => { if (html.includes(to)) return; if (!html.includes(from)) { console.error('query not found: ' + from.slice(0, 60)); process.exit(1); } html = html.replace(from, to); };
rep('units: "select Count_Date, Account, Device_Family, Vendor, Supplied_Through, Hardware_Version, Acquisition, On_Leg from Daily_Unit_Counts',
    'units: "select Count_Date, Account, Account.Account_Name, SmartView_Customer, Device_Family, Vendor, Supplied_Through, Hardware_Version, Acquisition, On_Leg from Daily_Unit_Counts');
rep('rates: "select id, Parent_Id, Rate_Vendor, Rate_Device, Rate_Type, Rate_Daily_Amount, Rate_Terms from Rate_Lines where Line_Status = \'Verified\' order by id"',
    'rates: "select id, Parent_Id, Parent_Id.Name, Rate_Type, Rate_Device, Rate_Vendor, Rate_Vendor.Vendor_Name, Rate_Daily_Amount, Rate_Terms, Line_Status, Line_Verified, Superseded_By, Effective_Date, Tier_Min_Units from Rate_Lines where Line_Status = \'Verified\' order by id"');
rep('contracts: "select id, Account, Contract_Status, Final_End_Date from Contracts where Counterparty_Type = \'Customer\'"',
    'contracts: "select id, Name, Account, Account.Account_Name, Counterparty_Type, Contract_Status, Final_End_Date, Rate_Basis from Contracts where Counterparty_Type = \'Customer\'"');
/* 3. vendors() */
{
  const NEW = '  /* vendor margin estimate: rates-model.js (S76), the same rules as Processes > Rates. Its notes list the rules. */\n' +
    '  function vendors() {\n' +
    '    if (!D.units || !D.rates || !D.contracts) return (D.units === null || D.rates === null || D.contracts === null) ? null : undefined;\n' +
    '    if (!root.RatesModel) return null;\n' +
    '    /* the tile reads Verified lines only, so a row without Line_Status (the demo rows) is Verified */\n' +
    '    var lines = D.rates.map(function (l) { return l.Line_Status ? l : Object.assign({ Line_Status: \'Verified\' }, l); });\n' +
    '    return root.RatesModel.build({ units: D.units, lines: lines, contracts: D.contracts, today: ymd(new Date()) }).tile;\n' +
    '  }\n';
  const a = html.indexOf('  /* vendor margin estimate'), z = html.indexOf('  function pricing() {');
  if (a < 0 || z < 0) { console.error('vendors block not found'); process.exit(1); }
  html = html.slice(0, a) + NEW + html.slice(z);
}
/* version line */
html = html.replace(/content="Leadership Home v47\.10\.2 \(/, 'content="Leadership Home v47.11.0 (S76, 5 Nov 2026: Margin by vendor uses rates-model.js ' + JSON.parse(JSON.stringify('v' + /VERSION = '([^']+)'/.exec(MODEL)[1])) + ', shared with Processes > Rates; lookup names selected) + v47.10.2 (');
fs.writeFileSync(file, html);
console.log('patched', file, 'model', sha(MODEL));
