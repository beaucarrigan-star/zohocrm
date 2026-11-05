/* node tests/rates-writes.test.js  (step 4) - every Rates write against a fake Zoho that behaves like the live one:
   rows sent by id are updated, rows without an id are added, rows LEFT OUT ARE DELETED. Checks row counts before/after,
   Superseded By links, Verified fields, Source Ref, and that workflows are triggered (em_margin_build runs from the contract rule). */
const assert = require('assert'), fs = require('fs'), path = require('path');
const RM = require('../rates-model.js'), F = require('./fixture-2026-11-04.js');
let nextId = 9000, calls = [];
const db = {};
const keyOf = l => l.Parent_Id.id;
F.contracts.forEach(c => { db[c.id] = { id: c.id, Rate_Lines: [] }; });
F.lines.forEach(l => { (db[keyOf(l)] = db[keyOf(l)] || { id: keyOf(l), Rate_Lines: [] }).Rate_Lines.push(JSON.parse(JSON.stringify(l))); });
const clone = o => JSON.parse(JSON.stringify(o));
const API = { getRecord: ({ RecordID }) => Promise.resolve({ data: [clone(db[RecordID])] }),
  updateRecord: ({ APIData, Trigger }) => { calls.push({ id: APIData.id, n: APIData.Rate_Lines.length, Trigger }); const rec = db[APIData.id], by = {}; rec.Rate_Lines.forEach(l => by[l.id] = l);
    rec.Rate_Lines = APIData.Rate_Lines.map(r => r.id ? Object.assign(by[r.id], r) : Object.assign({ id: 'N' + (nextId++) }, r)); return Promise.resolve({ data: [{ code: 'SUCCESS' }] }); } };
global.window = { ZOHO: { CRM: { API, CONFIG: { getCurrentUser: () => Promise.resolve({ users: [{ full_name: 'Test User', profile: { name: 'Administrator' } }] }) } } }, RecModules: {}, RatesModel: RM };
global.document = { querySelectorAll: () => [] }; global.setTimeout = (f) => 0;
new Function('window', 'document', 'setTimeout', fs.readFileSync(path.join(__dirname, '..', 'app', 'processes-rates.js'), 'utf8'))(window, document, () => 0);
const R = window.__procRates, S = R.state();
const rebuild = () => { const lines = []; Object.keys(db).forEach(k => db[k].Rate_Lines.forEach(l => lines.push(Object.assign({ Parent_Id: { id: k, name: (F.contracts.find(c => c.id === k) || {}).Name } }, l, { Parent_Id: { id: k, name: (F.contracts.find(c => c.id === k) || {}).Name } })))); S.out = RM.build({ units: F.units, lines, contracts: F.contracts, today: F.today }); };
const rowB = (a, f) => S.out.partB.find(r => r.account === a && r.family === f), rowA = (c, f, o) => S.out.partA.find(r => r.card === c && r.family === f && r.owned === !!o);
const count = id => db[id].Rate_Lines.length;
(async () => {
  S.user = 'Test User'; rebuild();
  // 1. Add rate (Milwaukee GPS $3.10 -> $3.25): +1 row, old Superseded with Superseded By = new, new Verified with Source Ref
  let r = rowB('Milwaukee County Pretrial Program', 'GPS'), cid = r.contractId, n0 = count(cid);
  await R.plans.addRate(r, 3.25, '2026-11-05', 'TEST').run();
  let L = db[cid].Rate_Lines, nw = L.find(l => String(l.id).startsWith('N')), old = L.find(l => l.id === '6715134000010136001');
  assert.strictEqual(L.length, n0 + 1); assert.strictEqual(old.Line_Status, 'Superseded'); assert.strictEqual(old.Superseded_By, nw.id);
  assert.strictEqual(nw.Line_Status, 'Verified'); assert.strictEqual(nw.Line_Verified, true); assert.strictEqual(nw.Rate_Type, 'Customer rate'); assert.strictEqual(nw.Rate_Device, 'GPS');
  assert.ok(/^Rates screen 2026-11-05 Test User: TEST$/.test(nw.Source_Ref), nw.Source_Ref); assert.deepStrictEqual(nw.Rate_Vendor, { id: '6715134000002099249' });
  rebuild(); assert.strictEqual(rowB('Milwaukee County Pretrial Program', 'GPS').rate, 3.25);
  // 2. Verify (Rock GPS proposed $4.00): count unchanged, Verified
  r = rowB('Rock County Pretrial Program', 'GPS'); cid = r.contractId; n0 = count(cid);
  await R.plans.verify(r).run(); assert.strictEqual(count(cid), n0); assert.strictEqual(db[cid].Rate_Lines.find(l => l.id === '6715134000007991024').Line_Status, 'Verified');
  // 3. Set cost (SCRAM CAM lease $6.94 -> $7.00): +1, old superseded, monitoring-only $5.17 line untouched
  rebuild(); let a = rowA('SCRAM - vendor pricing', 'CAM'); cid = a.cardId; n0 = count(cid);
  await R.plans.setCost(a, 7.0, '2026-11-05', '').run();
  L = db[cid].Rate_Lines; assert.strictEqual(L.length, n0 + 1); assert.strictEqual(L.find(l => l.id === '6715134000006441254').Line_Status, 'Superseded');
  assert.strictEqual(L.find(l => l.id === '6715134000011406054').Line_Status, 'Verified', 'monitoring-only line untouched');
  rebuild(); assert.strictEqual(rowA('SCRAM - vendor pricing', 'CAM').cost, 7.0); assert.strictEqual(rowA('SCRAM - vendor pricing', 'CAM', true).cost, 5.17);
  // 4. Keep this one (force a SuperCom GPS conflict, keep $2.75)
  db['6715134000006441249'].Rate_Lines.push({ id: '6715134000099999999', Parent_Id: F.C.supercom, Rate_Type: 'Vendor cost', Rate_Device: 'GPS', Rate_Daily_Amount: 3.0, Line_Status: 'Verified', Superseded_By: null });
  rebuild(); a = rowA('SuperCom - vendor pricing', 'GPS'); assert.strictEqual(a.status, 'Conflict'); cid = a.cardId; n0 = count(cid);
  await R.plans.keep(a, '6715134000006441250').run();
  L = db[cid].Rate_Lines; assert.strictEqual(L.length, n0); const lost = L.find(l => l.id === '6715134000099999999'); assert.strictEqual(lost.Line_Status, 'Superseded'); assert.strictEqual(lost.Superseded_By, '6715134000006441250');
  rebuild(); assert.strictEqual(rowA('SuperCom - vendor pricing', 'GPS').status, 'OK');
  // 5. Move to account: give Sawyer Co. Pretrial an open contract, then move Sawyer Co HHS's $5.75 GPS line onto it
  F.contracts.push({ id: 'KSP', Name: 'Sawyer Co. Pretrial 2026', Account: F.AC.sawyerP, Counterparty_Type: 'Customer', Contract_Status: 'Active/Complete' }); db.KSP = { id: 'KSP', Rate_Lines: [{ id: 'X1', Rate_Type: 'Customer rate', Rate_Device: 'CAM', Rate_Daily_Amount: 7, Line_Status: 'Proposed' }] };
  rebuild(); r = rowB('Sawyer Co. Pretrial', 'GPS'); assert.strictEqual(r.status, 'Account mismatch'); assert.strictEqual(r.mismatch.targetContractId, 'KSP');
  const src = r.mismatch.contractId, ns = count(src);
  await R.plans.move(r).run();
  assert.strictEqual(count('KSP'), 2); assert.strictEqual(count(src), ns);
  const moved = db.KSP.Rate_Lines.find(l => String(l.id).startsWith('N')), srcLine = db[src].Rate_Lines.find(l => l.id === '6715134000007991034');
  assert.strictEqual(moved.Rate_Daily_Amount, 5.75); assert.strictEqual(srcLine.Line_Status, 'Superseded'); assert.strictEqual(srcLine.Superseded_By, moved.id);
  rebuild(); assert.strictEqual(rowB('Sawyer Co. Pretrial', 'GPS').status, 'Priced');
  // every write triggered workflows (em_margin_build) and sent the whole list
  assert.ok(calls.every(c => c.Trigger && c.Trigger[0] === 'workflow'));
  // a stale id writes nothing
  const before = calls.length; await R.save('6715134000005360002', { GONE: {} }, []).then(() => assert.fail('should refuse'), e => assert.ok(/no longer on the contract/.test(e.message))); assert.strictEqual(calls.length, before);
  console.log('PASS rates writes: add, verify, set cost, keep this one, move to account |', calls.length, 'contract writes, all full-list, all with workflows');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
