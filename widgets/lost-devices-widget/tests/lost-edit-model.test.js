'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../app/lost-edit-model.js');
const TODAY = '2026-10-19';
const base = { serial: 'AT1-9', customer: { id: '1', name: 'Milwaukee' }, date: '2026-10-01', status: 'Lost' };

test('profiles', () => {
  assert.ok(E.canWrite('Administrator') && E.canWrite('EM Support'));
  assert.ok(!E.canWrite('Leadership') && !E.canWrite('BD+CS') && !E.canWrite(''));
  assert.ok(E.canEditMoney('Administrator') && !E.canEditMoney('EM Support'));
});
test('add requires serial, customer, date, Lost/Damaged', () => {
  const r = E.validate({}, { mode: 'add', today: TODAY });
  assert.deepEqual(Object.keys(r.errors).sort(), ['customer', 'date', 'serial', 'status']);
  assert.ok(E.validate(base, { mode: 'add', today: TODAY }).ok);
  assert.ok(E.validate({ ...base, status: 'Recovered' }, { mode: 'add', today: TODAY }).errors.status);
});
test('date checks', () => {
  assert.ok(E.validate({ ...base, date: '2026-10-20' }, { mode: 'add', today: TODAY }).errors.date);
  assert.ok(E.validate({ ...base, date: '2026-02-30' }, { mode: 'add', today: TODAY }).errors.date);
});
test('duplicate open serial blocks add, not edit of itself', () => {
  const recs = [{ id: 'x', Name: 'AT1-9', Loss_Status: 'Lost' }];
  assert.ok(E.validate(base, { mode: 'add', today: TODAY, records: recs }).errors.serial);
  assert.ok(E.validate(base, { mode: 'edit', today: TODAY, records: recs, excludeId: 'x' }).ok);
  assert.ok(E.validate(base, { mode: 'edit', today: TODAY, records: recs, excludeId: 'y' }).errors.serial);
});
test('recovered needs date, not before lost date', () => {
  const v = { ...base, status: 'Recovered' };
  assert.ok(E.validate(v, { mode: 'edit', today: TODAY }).errors.recoveredOn);
  assert.ok(E.validate({ ...v, recoveredOn: '2026-09-01' }, { mode: 'edit', today: TODAY }).errors.recoveredOn);
  assert.ok(E.validate({ ...v, recoveredOn: '2026-10-05' }, { mode: 'edit', today: TODAY }).ok);
});
test('money validated only for money editors', () => {
  const v = { ...base, amount: '-5' };
  assert.ok(E.validate(v, { mode: 'edit', today: TODAY, canMoney: true }).errors.amount);
  assert.ok(E.validate(v, { mode: 'edit', today: TODAY, canMoney: false }).ok);
});
test('add payload', () => {
  const r = E.buildPayload({ ...base, model: { id: 'm', name: 'AT1' }, manufacturer: { id: 'v', name: 'Allied' }, deviceType: 'GPS', reportedBy: ' Jo ', lastClient: '', amount: '999', paid: true }, null, { mode: 'add' });
  assert.deepEqual(r.payload, { Name: 'AT1-9', Date_Listed_Lost: '2026-10-01', Device_Type: 'GPS', Reported_By: 'Jo', Customer: { id: '1' }, Device_Model: { id: 'm' }, Manufacturer: { id: 'v' }, Loss_Status: 'Lost' });
  assert.equal(r.names.Customer, 'Milwaukee');
});
test('add payload keeps money for Administrator', () => {
  const r = E.buildPayload({ ...base, amount: '$1,250', paid: true, amountBilled: '100' }, null, { mode: 'add', canMoney: true });
  assert.equal(r.payload.Loss_Amount, 1250); assert.equal(r.payload.Customer_Paid, true); assert.equal(r.payload.Amount_Billed, 100);
});
test('edit payload has only changes, never function-owned fields', () => {
  const orig = { ...base, reportedBy: 'A', amount: 650 };
  const r = E.buildPayload({ ...orig, reportedBy: 'B', amount: 700, details: '' }, orig, { mode: 'edit' });
  assert.deepEqual(r.payload, { Reported_By: 'B' });          // amount ignored without canMoney
  const r2 = E.buildPayload({ ...orig, amount: 700 }, orig, { mode: 'edit', canMoney: true });
  assert.deepEqual(r2.payload, { Loss_Amount: 700 });
  const none = E.buildPayload(orig, orig, { mode: 'edit' });
  assert.equal(none.changed, false);
  ['Cost_Basis', 'Status_Stamp', 'Status_Date', 'Angie_Notified_On'].forEach(k => assert.ok(!(k in r.payload)));
});
test('edit clears a field to null and changes a lookup', () => {
  const orig = { ...base, reportedBy: 'A' };
  const r = E.buildPayload({ ...orig, reportedBy: '', customer: { id: '2', name: 'Racine' } }, orig, { mode: 'edit' });
  assert.deepEqual(r.payload, { Reported_By: null, Customer: { id: '2' } });
});
test('status plan', () => {
  const row = { status: 'Lost', date: '2026-10-01' };
  assert.deepEqual(E.statusPlan(row, 'Damaged').payload, { Loss_Status: 'Damaged' });
  assert.ok(E.statusPlan(row, 'Lost').noop);
  assert.ok(E.statusPlan(row, 'Recovered', {}).needsDate);
  assert.ok(E.statusPlan(row, 'Recovered', { recoveredOn: '2026-09-01' }).needsDate);
  assert.deepEqual(E.statusPlan(row, 'Recovered', { recoveredOn: '2026-10-05', today: TODAY }).payload, { Loss_Status: 'Recovered', Recovered_On: '2026-10-05' });
  assert.equal(E.statusPlan(row, 'Recovered', { recoveredOn: '2026-10-05', vendorCredited: true, canMoney: false, today: TODAY }).payload.Vendor_Credited, undefined);
  assert.equal(E.statusPlan(row, 'Recovered', { recoveredOn: '2026-10-05', vendorCredited: true, canMoney: true, today: TODAY }).payload.Vendor_Credited, true);
  assert.deepEqual(E.statusPlan({ status: 'Recovered', date: '2026-10-01' }, 'Lost').payload, { Loss_Status: 'Lost', Recovered_On: null });
});
test('applyLocal and valuesFromRecord', () => {
  const rec = E.applyLocal({ id: 'd', Name: 'A', 'Customer.id': '1', 'Customer.Account_Name': 'X' }, { Customer: { id: '2' }, Loss_Status: 'Lost' }, { Customer: 'Y' });
  assert.equal(rec['Customer.id'], '2'); assert.equal(rec['Customer.Account_Name'], 'Y'); assert.equal(rec.Loss_Status, 'Lost');
  const v = E.valuesFromRecord({ Name: 'S', Customer: { id: '9', name: 'Z' }, Loss_Status: 'Lost', Date_Listed_Lost: '2026-01-01', Last_Client: 'Q' });
  assert.equal(v.customer.name, 'Z'); assert.equal(v.lastClient, 'Q'); assert.equal(v.amount, '');
});
