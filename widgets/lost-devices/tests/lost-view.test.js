'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../app/lost-view.js');
const M = require('../app/lost-model.js');
global.window = {}; delete require.cache[require.resolve('../app/demo-data.js')]; require('../app/demo-data.js');
const D = global.window.LOST_DEMO;
const bm = {}; D.accounts.forEach(a => bm[a.id] = a.Brand);

test('brand keys: JusticePoint covers both of its values', () => {
  assert.equal(V.brandKeyOf('JusticePoint EM'), 'jp');
  assert.equal(V.brandKeyOf('JusticePoint Programs'), 'jp');
  assert.equal(V.brandKeyOf('Sirona Recovery'), 'sr');
  assert.equal(V.brandKeyOf('Other'), null);
  assert.equal(V.brandKeyOf(null), null);
});
test('scopeByBrand goes through the customer brand map', () => {
  assert.equal(V.scopeByBrand(D.records, 'all', bm).length, 11);
  assert.equal(V.scopeByBrand(D.records, 'jp', bm).length, 7);
  assert.equal(V.scopeByBrand(D.records, 'sr', bm).length, 2);
  assert.equal(V.scopeByBrand(D.records, 'dp', bm).length, 2);
  assert.equal(V.scopeByBrand(D.records, 'sr', {}).length, 0);
});
test('brandCounts add up and report records with no brand', () => {
  const c = V.brandCounts(D.records, bm);
  assert.deepEqual([c.all, c.jp, c.sr, c.dp, c.none], [11, 7, 2, 2, 0]);
  assert.equal(V.brandCounts(D.records, {}).none, 11);
});
test('years newest first; filterYear keeps only that year', () => {
  assert.deepEqual(V.yearOptions(D.records), ['2026']);
  assert.deepEqual(V.yearOptions([{ Date_Listed_Lost: '2025-12-01' }, { Date_Listed_Lost: '2026-01-01' }, {}]), ['2026', '2025']);
  assert.equal(V.filterYear(D.records, '2025').length, 0);
  assert.equal(V.filterYear(D.records, 'all').length, 11);
});
test('tiles match summarize on the demo set', () => {
  const s = M.summarize(D.records), t = V.tiles(s);
  assert.equal(t.primary[0].value, s.devicesLost);
  assert.equal(t.primary[1].value, s.grossLoss);
  assert.equal(t.primary[2].value, s.netLoss);
  assert.equal(t.primary[3].value, s.owedByCustomers);
  assert.equal(s.devicesLost, 9);
  assert.equal(s.recoveredDevices, 2);
  assert.equal(s.recoveredValue, 1250);
  assert.equal(s.amountMissing, 1);
  assert.equal(s.grossLoss, 650 + 650 + 850 + 1250 + 500 + 1100 + 650 + 400 + 200);
  assert.equal(s.paidByCustomers, 800);
  assert.equal(s.owedByCustomers, 200);
});
test('trend: zero-filled months across the year, gross and net', () => {
  const t = V.trend(D.records, '2026');
  assert.equal(t.rows.length, 12);
  assert.equal(t.gross[0].label, 'Jan 26');
  assert.equal(t.gross[6].y, 0); // July has no losses
  assert.equal(t.net[1].y, 650 - 300); // Feb: damaged AT1-0002, 300 paid
  assert.equal(t.gross.length, t.net.length);
});
test('trend with all years spans first to last month in the data', () => {
  const t = V.trend(D.records, 'all');
  assert.equal(t.rows[0].month, '2026-01');
  assert.equal(t.rows[t.rows.length - 1].month, '2026-10');
});
test('deviceRows flags duplicate serial and missing amount; duplicate seen across scope', () => {
  const rows = V.deviceRows(V.scopeByBrand(D.records, 'dp', bm), D.records);
  assert.equal(rows.length, 2);
  const all = V.deviceRows(D.records, D.records);
  const at1 = all.filter(r => r.serial === 'AT1-0001');
  assert.ok(at1.length === 2 && at1.every(r => r.duplicate));
  assert.equal(all.filter(r => r.amountMissing).length, 1);
  assert.deepEqual(V.flagLabels(all.find(r => r.id === 'd7')), ['Amount missing']);
  // scoped to Sirona only: duplicate check still uses the full set
  const sr = V.deviceRows(V.scopeByBrand(D.records, 'sr', bm), D.records);
  assert.ok(sr.every(r => !r.duplicate));
});
test('Last_Client never reaches any view output', () => {
  const blob = JSON.stringify([V.tiles(M.summarize(D.records)), V.trend(D.records, 'all'), V.deviceRows(D.records, D.records), M.byCustomer(D.records)]);
  assert.ok(!/Demo Client|Last_Client/.test(blob));
});
test('formatters', () => {
  assert.equal(V.fmtMoney(1250.5), '$1,250.5');
  assert.equal(V.fmtMoney(-100), '-$100');
  assert.equal(V.fmtMoneyShort(1500), '$1.5k');
  assert.equal(V.fmtMoneyShort(2000), '$2k');
  assert.equal(V.fmtMoneyShort(650), '$650');
  assert.equal(V.monthLabel('2026-03'), 'Mar 26');
});
test('empty input is safe', () => {
  assert.equal(V.trend([], 'all').rows.length, 0);
  assert.deepEqual(V.deviceRows([], []), []);
  assert.equal(V.scopeByBrand(undefined, 'jp', {}).length, 0);
});
