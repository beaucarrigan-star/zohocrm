/* node tests/rates-model.test.js  (step 2 done-when: Dodge priced; Allied GPS priced; Sawyer flagged as mismatch; no-account rows listed) */
const assert = require('assert'), path = require('path');
const RM = require(path.join(__dirname, '..', 'rates-model.js')), F = require('./fixture-2026-11-04.js');
const out = RM.build(F), B = out.partB, A = out.partA;
const row = (acct, fam) => B.find(r => r.account === acct && r.family === fam);
// Dodge: CAM priced (bracelets only; base station left out), GPS priced on Allied standard
const dc = row('Dodge Co. Sheriff', 'CAM');
assert.strictEqual(dc.status, 'Priced'); assert.strictEqual(dc.units, 8); assert.strictEqual(dc.rate, 7.6); assert.strictEqual(dc.cost, 6.94); assert.strictEqual(dc.margin, 8.7);
const dg = row('Dodge Co. Sheriff', 'GPS'); assert.strictEqual(dg.status, 'Priced'); assert.strictEqual(dg.cost, 2.85); assert.strictEqual(dg.vendor, 'Allied');
// Allied GPS (step 1): Milwaukee 146 at $3.10 vs $2.85
const mw = row('Milwaukee County Pretrial Program', 'GPS'); assert.strictEqual(mw.status, 'Priced'); assert.strictEqual(mw.units, 146); assert.strictEqual(mw.margin, 8.1);
// Sheboygan Sheriff: three rows summed (13 + 2 + 150), Allied Sheboygan card $2.55, no customer rate in the fixture
const sh = row('Sheboygan County Sheriff', 'GPS'); assert.strictEqual(sh.units, 165); assert.strictEqual(sh.cost, 2.55); assert.strictEqual(sh.status, 'No customer rate');
// Ramsey GPS: two hardware versions summed (4 + 28)
assert.strictEqual(row('Ramsey County Pretrial Program', 'GPS').units, 32);
// SCRAM via Allied Remote Breath -> Allied, Allied standard RB $3.50
const rr = row('Ramsey County Pretrial Program', 'Remote Breath'); assert.strictEqual(rr.vendor, 'Allied'); assert.strictEqual(rr.via, 'SCRAM via Allied'); assert.strictEqual(rr.cost, 3.5);
// Sawyer: account mismatch (rates on Sawyer Co HHS), for GPS; its own contract has Ended so no move target
const sg = row('Sawyer Co. Pretrial', 'GPS'); assert.strictEqual(sg.status, 'Account mismatch'); assert.strictEqual(sg.mismatch.account, 'Sawyer Co HHS'); assert.strictEqual(sg.mismatch.rate, 5.75); assert.strictEqual(sg.mismatch.targetContractId, '');
// No-account rows listed with the SmartView name
const na = B.filter(r => r.status === 'No account').map(r => r.smartView).sort();
assert.deepStrictEqual(na, ['Justice Point - Sheboygan ISS', 'Justice Point - Washington County HHS', 'SuperCom | Menominee Co Sheriff Demo (MI)']);
// Rock: CAM owned (only line marked purchased) at $5.17; GPS (SuperCom) has only a Proposed Allied GPS line -> Proposed
const rc = row('Rock County Pretrial Program', 'CAM'); assert.ok(rc.owned); assert.strictEqual(rc.cost, 5.17); assert.strictEqual(rc.margin, 17.3);
assert.strictEqual(row('Rock County Pretrial Program', 'GPS').status, 'Proposed, not Verified');
// old count day ignored
assert.ok(!B.some(r => r.smartView === 'old day'));
// Part A: SuperCom Victim / DV bundle is OK, not Conflict; SuperCom GPS OK at 2.75 ($3.00 is Superseded); no Conflict rows today
const a = (card, fam, owned) => A.find(r => r.card === card && r.family === fam && r.owned === !!owned);
assert.strictEqual(a('SuperCom - vendor pricing', 'Victim / DV').status, 'OK'); assert.strictEqual(a('SuperCom - vendor pricing', 'Victim / DV').cost, 4.25);
assert.strictEqual(a('SuperCom - vendor pricing', 'GPS').cost, 2.75); assert.strictEqual(a('SuperCom - vendor pricing', 'GPS').status, 'OK');
assert.ok(!A.some(r => r.status === 'Conflict'), 'no conflicts: ' + A.filter(r => r.status === 'Conflict').map(r => r.key));
assert.strictEqual(a('Allied - vendor pricing (standard)', 'GPS').units, 9 + 3 + 146 + 43 + 32 + 2 + 4 + 1);
assert.strictEqual(a('Allied - vendor pricing (Sheboygan)', 'GPS').units, 165);
assert.strictEqual(a('SCRAM - vendor pricing', 'CAM', true).units, 18);
// Conflict detection: add a second Verified SuperCom GPS line at a different amount
const F2 = Object.assign({}, F, { lines: F.lines.concat([{ id: '6715134000099999999', Parent_Id: F.C.supercom, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 3.0, Line_Status: 'Verified' }]) });
assert.strictEqual(RM.build(F2).partA.find(r => r.card === 'SuperCom - vendor pricing' && r.family === 'GPS').status, 'Conflict');
// Widget COQL shape: lookups as bare ids, names in dotted columns -> same answer
const DOT = { Account: 'Account.Account_Name', Parent_Id: 'Parent_Id.Name', Rate_Vendor: 'Rate_Vendor.Vendor_Name', Vendor: 'Vendor.Vendor_Name' };
const flat = o => { const x = {}; Object.keys(o).forEach(k => { const v = o[k]; if (v && typeof v === 'object' && v.id) { x[k] = v.id; if (DOT[k]) x[DOT[k]] = v.name; } else x[k] = v; }); return x; };
const out2 = RM.build({ units: F.units.map(flat), lines: F.lines.map(flat), contracts: F.contracts.map(flat), today: F.today });
assert.deepStrictEqual(out2.totals, out.totals); assert.deepStrictEqual(out2.partB.map(r => r.status), out.partB.map(r => r.status));
// totals and tile rows agree
assert.strictEqual(out.tile.rows.reduce((t, r) => t + r.priced, 0), out.totals.priced);
// payload: every row kept
assert.deepStrictEqual(RM.fullPayload([{ id: 1 }, { id: 2 }], { 2: RM.verifyFields() }, { Rate_Type: 'x' }), [{ id: 1 }, { id: 2, Line_Status: 'Verified', Line_Verified: true, Superseded_By: null }, { Rate_Type: 'x' }]);
assert.strictEqual(RM.fullPayload([{ id: 1 }], { 9: {} }), null);
console.log('PASS rates-model', RM.VERSION, '| units', out.totals.units, 'priced', out.totals.priced, 'margin', out.totals.margin + '%');
console.log('Part B by status:', out.totals.byStatus.filter(x => x.rows).map(x => `${x.status} ${x.rows} rows/${x.units} units`).join('; '));
console.log('Part A:', A.map(r => `${r.card || r.vendor} ${r.family}${r.owned ? ' owned' : ''} ${r.status} ${r.cost == null ? '-' : '$' + r.cost} (${r.units})`).join(' | '));
