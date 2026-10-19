'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../app/lost-model.js');

let seq = 0;
function mk(o) {
  seq += 1;
  return Object.assign({
    id: String(seq),
    Name: 'SN' + seq,
    Customer: { id: 'c1', name: 'Dane County' },
    Loss_Status: 'Lost',
    Date_Listed_Lost: '2026-03-10',
    Loss_Amount: 650
  }, o);
}

test('devices lost counts only Lost and Damaged', () => {
  const s = M.summarize([
    mk({ Loss_Status: 'Lost' }),
    mk({ Loss_Status: 'Damaged' }),
    mk({ Loss_Status: 'Recovered' })
  ]);
  assert.equal(s.devicesLost, 2);
  assert.equal(s.recoveredDevices, 1);
});

test('gross: recovered without vendor credit stays in; with credit drops to recoveredValue', () => {
  const s = M.summarize([
    mk({ Loss_Status: 'Lost', Loss_Amount: 650 }),
    mk({ Loss_Status: 'Damaged', Loss_Amount: 850 }),
    mk({ Loss_Status: 'Recovered', Loss_Amount: 400, Vendor_Credited: false }),
    mk({ Loss_Status: 'Recovered', Loss_Amount: 500, Vendor_Credited: true })
  ]);
  assert.equal(s.grossLoss, 1900);
  assert.equal(s.recoveredValue, 500);
  assert.equal(s.devicesLost, 2);
});

test('net subtracts paid billing; billed but unpaid is owed, not netted', () => {
  const s = M.summarize([
    mk({ Loss_Amount: 650, Amount_Billed: 300, Customer_Paid: true }),
    mk({ Loss_Status: 'Damaged', Loss_Amount: 850, Amount_Billed: 200, Customer_Paid: false })
  ]);
  assert.equal(s.grossLoss, 1500);
  assert.equal(s.paidByCustomers, 300);
  assert.equal(s.netLoss, 1200);
  assert.equal(s.owedByCustomers, 200);
});

test('paid billing on a recovered, credited device still reduces net', () => {
  const s = M.summarize([
    mk({ Loss_Status: 'Recovered', Loss_Amount: 500, Vendor_Credited: true, Amount_Billed: 100, Customer_Paid: true })
  ]);
  assert.equal(s.grossLoss, 0);
  assert.equal(s.netLoss, -100);
});

test('missing Loss_Amount still counts as a device and is flagged', () => {
  const recs = [
    mk({ Loss_Amount: 650 }),
    mk({ Loss_Amount: null, Name: 'NOAMT' }),
    mk({ Loss_Amount: '' })
  ];
  const s = M.summarize(recs);
  assert.equal(s.devicesLost, 3);
  assert.equal(s.amountMissing, 2);
  assert.equal(s.grossLoss, 650);
  const missing = M.amountMissingRecords(recs);
  assert.equal(missing.length, 2);
  assert.equal(missing[0].serial, 'NOAMT');
});

test('currency strings and numbers are both accepted', () => {
  const s = M.summarize([mk({ Loss_Amount: '1,250.50' }), mk({ Loss_Amount: 100.25 })]);
  assert.equal(s.grossLoss, 1350.75);
});

test('month comes from Date_Listed_Lost with no timezone shift; recovery does not move it', () => {
  const rows = M.byMonth([
    mk({ Date_Listed_Lost: '2026-03-31', Loss_Status: 'Recovered', Recovered_On: '2026-05-02', Loss_Amount: 400 }),
    mk({ Date_Listed_Lost: '2026-04-01' })
  ]);
  assert.deepEqual(rows.map(r => r.month), ['2026-03', '2026-04']);
  assert.equal(rows[0].grossLoss, 400);
  assert.equal(rows[0].recoveredDevices, 1);
  assert.equal(rows[1].devicesLost, 1);
});

test('byMonth zero-fills gaps and honours from/to across a year boundary', () => {
  const rows = M.byMonth(
    [mk({ Date_Listed_Lost: '2026-01-15' }), mk({ Date_Listed_Lost: '2026-03-02' })],
    { from: '2025-12', to: '2026-03' }
  );
  assert.deepEqual(rows.map(r => r.month), ['2025-12', '2026-01', '2026-02', '2026-03']);
  assert.equal(rows[0].devicesLost, 0);
  assert.equal(rows[2].grossLoss, 0);
  assert.equal(rows[3].devicesLost, 1);
});

test('undated records are kept out of months but reported', () => {
  const rows = M.byMonth([mk({ Date_Listed_Lost: null }), mk({})]);
  assert.equal(rows.length, 1);
  assert.equal(rows.undated.devicesLost, 1);
});

test('byCustomer handles REST lookups and flat COQL keys, sorted by net loss', () => {
  const rows = M.byCustomer([
    mk({ Customer: { id: 'c1', name: 'Dane County' }, Loss_Amount: 650 }),
    mk({ Customer: undefined, 'Customer.id': 'c2', 'Customer.Account_Name': 'Rock County', Loss_Amount: 850 }),
    mk({ Customer: undefined, 'Customer.id': 'c2', 'Customer.Account_Name': 'Rock County', Loss_Amount: 100 }),
    mk({ Customer: null, Loss_Amount: 50 })
  ]);
  assert.deepEqual(rows.map(r => r.customer), ['Rock County', 'Dane County', M.NO_CUSTOMER]);
  assert.equal(rows[0].devicesLost, 2);
  assert.equal(rows[0].netLoss, 950);
});

test('duplicate serials: flagged when an open loss is involved, ignoring case and spacing', () => {
  const recs = [
    mk({ Name: 'abc123', Loss_Status: 'Recovered' }),
    mk({ Name: ' ABC123 ', Loss_Status: 'Lost' }),
    mk({ Name: 'ZZ9', Loss_Status: 'Recovered' }),
    mk({ Name: 'zz9', Loss_Status: 'Recovered' }),
    mk({ Name: 'ONLY1', Loss_Status: 'Lost' })
  ];
  const dups = M.findDuplicateSerials(recs);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].serial, 'ABC123');
  assert.equal(dups[0].records.length, 2);
});

test('hasOpenLoss ignores the record being edited', () => {
  const recs = [mk({ id: 'a', Name: 'X1', Loss_Status: 'Lost' })];
  assert.equal(M.hasOpenLoss('x1', recs), true);
  assert.equal(M.hasOpenLoss('x1', recs, 'a'), false);
  assert.equal(M.hasOpenLoss('', recs), false);
  assert.equal(M.hasOpenLoss('X1', [mk({ id: 'b', Name: 'X1', Loss_Status: 'Recovered' })]), false);
});

test('brand scope filters through Customer by id or name', () => {
  const recs = [
    mk({ Customer: { id: 'c1', name: 'Dane County' } }),
    mk({ Customer: { id: 'c2', name: 'Rock County' } }),
    mk({ Customer: { id: 'c3', name: 'Other Agency' } })
  ];
  assert.equal(M.scopeToCustomers(recs, { ids: ['c1'] }).length, 1);
  assert.equal(M.scopeToCustomers(recs, { names: ['rock county', 'OTHER AGENCY'] }).length, 2);
  assert.equal(M.scopeToCustomers(recs, { ids: [] }).length, 0);
  assert.equal(M.scopeToCustomers(recs).length, 3);
});

test('Last_Client never appears in any output', () => {
  const recs = [mk({ Last_Client: 'Jane Q. Client' }), mk({ Last_Client: 'John Doe', Loss_Status: 'Recovered' })];
  const blob = JSON.stringify([
    M.summarize(recs), M.byMonth(recs), M.byCustomer(recs),
    M.amountMissingRecords(recs), M.findDuplicateSerials(recs), recs.map(M.normalize)
  ]);
  assert.ok(!/Jane|Doe|Last_Client/.test(blob));
});

test('unknown status is counted separately, not as a loss', () => {
  const s = M.summarize([mk({ Loss_Status: null }), mk({})]);
  assert.equal(s.devicesLost, 1);
  assert.equal(s.unknownStatus, 1);
});

test('empty input is safe', () => {
  assert.equal(M.summarize([]).devicesLost, 0);
  assert.equal(M.summarize(undefined).netLoss, 0);
  assert.equal(M.byMonth([]).length, 0);
  assert.deepEqual(M.byCustomer([]), []);
});
