'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'app', 'margins-model.js'));

function raw(o) {
  return Object.assign({ id: String(Math.random()), Name: 'x', Row_Type: 'Contract rate', Status: 'Confirmed', Account: { id: 'A1', name: 'Acme' },
    Contract: { id: 'C1', name: 'Acme Contract' }, Vendor: { id: 'V1', name: 'VendorOne' }, Device_Family: 'GPS', Customer_Rate: 4, Vendor_Daily_Rate: 3, Modelled_Margin_Pct: 25 }, o);
}
const n = (o) => M.normalize(raw(o));

test('tier boundaries: 0 is Thin, 20 is Normal, 50 is Strong', () => {
  assert.strictEqual(M.tierFor(-0.1), 'Negative');
  assert.strictEqual(M.tierFor(0), 'Thin');
  assert.strictEqual(M.tierFor(19.9), 'Thin');
  assert.strictEqual(M.tierFor(20), 'Normal');
  assert.strictEqual(M.tierFor(49.9), 'Normal');
  assert.strictEqual(M.tierFor(50), 'Strong');
  assert.strictEqual(M.tierFor(null), '');
});

test('normalize reads lookups, numbers and falls back to a computed tier', () => {
  const r = n({ Modelled_Margin_Pct: '21.3', Modelled_Margin_Tier: null });
  assert.strictEqual(r.pct, 21.3);
  assert.strictEqual(r.tier, 'Normal');
  assert.strictEqual(r.accountName, 'Acme');
  assert.strictEqual(r.vendorId, 'V1');
  const w = n({ Status: 'Exception', Modelled_Margin_Pct: null, Vendor: null, Account: null });
  assert.strictEqual(w.pct, null);
  assert.strictEqual(w.vendorName, '');
  assert.strictEqual(w.accountId, '');
});

test('totals: filled, waiting, below target, average with one decimal', () => {
  const rows = [n({ Modelled_Margin_Pct: 45.2 }), n({ Modelled_Margin_Pct: 30 }), n({ Modelled_Margin_Pct: 27.4 }), n({ Modelled_Margin_Pct: 8.7 }),
    n({ Status: 'Exception', Modelled_Margin_Pct: null }), n({ Status: 'Exception', Modelled_Margin_Pct: null })];
  const t = M.totals(rows);
  assert.strictEqual(t.filled, 4);
  assert.strictEqual(t.waiting, 2);
  assert.strictEqual(t.below, 2);          // 27.4 and 8.7; exactly 30 is not below
  assert.strictEqual(t.avg, 27.8);         // (45.2+30+27.4+8.7)/4 = 27.825
});

test('average rounding: half rounds up and uses one decimal', () => {
  assert.strictEqual(M.totals([n({ Modelled_Margin_Pct: 21.3 }), n({ Modelled_Margin_Pct: 21.4 })]).avg, 21.4); // 21.35 -> 21.4
  assert.strictEqual(M.totals([n({ Modelled_Margin_Pct: 10 }), n({ Modelled_Margin_Pct: 10.1 }), n({ Modelled_Margin_Pct: 10.1 })]).avg, 10.1); // 10.0667
  assert.strictEqual(M.totals([]).avg, null);
});

test('Retired rows are ignored everywhere', () => {
  const rows = [n({ Modelled_Margin_Pct: 40 }), n({ Status: 'Retired', Modelled_Margin_Pct: 5 }), n({ Status: 'Retired', Modelled_Margin_Pct: null })];
  assert.strictEqual(M.totals(rows).filled, 1);
  assert.strictEqual(M.totals(rows).avg, 40);
  assert.strictEqual(M.marginRows(rows, {}, {}).length, 1);
  assert.strictEqual(M.waitingRows(rows, {}).length, 0);
  assert.strictEqual(M.customers(rows, {})[0].lines, 1);
});

test('only Contract rate rows count', () => {
  const rows = [n({ Modelled_Margin_Pct: 40 }), n({ Row_Type: 'Scenario model', Modelled_Margin_Pct: 5 })];
  assert.strictEqual(M.totals(rows).filled, 1);
});

test('TEST rows are hidden by default option and shown when it is off', () => {
  const rows = [n({ Modelled_Margin_Pct: 40 }),
    n({ Account: { id: 'AT', name: 'TEST Account (do not use)' }, Contract: { id: 'CT', name: 'TEST Contract (do not use)' }, Modelled_Margin_Pct: 8.7 }),
    n({ Status: 'Exception', Modelled_Margin_Pct: null, Account: { id: 'AT', name: 'TEST Account (do not use)' }, Contract: { id: 'CT', name: 'TEST Contract (do not use)' } })];
  assert.strictEqual(M.totals(rows, { hideTest: true }).filled, 1);
  assert.strictEqual(M.totals(rows, { hideTest: true }).waiting, 0);
  assert.strictEqual(M.totals(rows, { hideTest: false }).filled, 2);
  assert.strictEqual(M.customers(rows, { hideTest: true }).length, 1);
  assert.strictEqual(M.customers(rows, { hideTest: false }).length, 2);
  assert.strictEqual(M.marginRows(rows, { hideTest: true }, {}).length, 1);
});

test('margin rows sort lowest first and filters work', () => {
  const rows = [n({ Modelled_Margin_Pct: 45, Modelled_Margin_Tier: 'Normal' }), n({ Modelled_Margin_Pct: 8.7, Modelled_Margin_Tier: 'Thin', Vendor: { id: 'V2', name: 'VendorTwo' }, Device_Family: 'CAM' }),
    n({ Modelled_Margin_Pct: 52, Modelled_Margin_Tier: 'Strong' })];
  assert.deepStrictEqual(M.marginRows(rows, {}, {}).map(r => r.pct), [8.7, 45, 52]);
  assert.strictEqual(M.marginRows(rows, {}, { vendor: 'VendorTwo' }).length, 1);
  assert.strictEqual(M.marginRows(rows, {}, { device: 'GPS' }).length, 2);
  assert.deepStrictEqual(M.marginRows(rows, {}, { tiers: ['Thin', 'Strong'] }).map(r => r.pct), [8.7, 52]);
  assert.deepStrictEqual(M.filterOptions(rows, {}).vendors, ['VendorOne', 'VendorTwo']);
});

test('waiting rows sort by reason then customer', () => {
  const rows = [n({ Status: 'Exception', Exception_Reason: 'Rate line not verified', Account: { id: 'A1', name: 'Zed' } }),
    n({ Status: 'Exception', Exception_Reason: 'No vendor on this rate line', Account: { id: 'A2', name: 'Beta' } }),
    n({ Status: 'Exception', Exception_Reason: 'No vendor on this rate line', Account: { id: 'A3', name: 'Alpha' } })];
  assert.deepStrictEqual(M.waitingRows(rows, {}).map(r => r.accountName), ['Alpha', 'Beta', 'Zed']);
});

test('customer roll-up: mean of Confirmed lines, lowest, tier from the average, waiting counted, sorted lowest first, none last', () => {
  const A = { id: 'A1', name: 'Alpha' }, B = { id: 'A2', name: 'Beta' }, C = { id: 'A3', name: 'Gamma' }, D = { id: 'A4', name: 'Delta' };
  const rows = [
    n({ Account: A, Modelled_Margin_Pct: 10 }), n({ Account: A, Modelled_Margin_Pct: 31 }), n({ Account: A, Status: 'Exception', Modelled_Margin_Pct: null }),
    n({ Account: B, Modelled_Margin_Pct: 55 }),
    n({ Account: C, Status: 'Exception', Modelled_Margin_Pct: null }), n({ Account: C, Status: 'Exception', Modelled_Margin_Pct: null }),
    n({ Account: D, Modelled_Margin_Pct: -3.5 }), n({ Account: D, Status: 'Retired', Modelled_Margin_Pct: 90 })];
  const c = M.customers(rows, {});
  assert.deepStrictEqual(c.map(x => x.name), ['Delta', 'Alpha', 'Beta', 'Gamma']);
  const a = c.find(x => x.name === 'Alpha');
  assert.strictEqual(a.avg, 20.5);        // (10 + 31) / 2
  assert.strictEqual(a.lowest, 10);
  assert.strictEqual(a.tier, 'Normal');   // 20.5 is not below 20
  assert.strictEqual(a.lines, 2);
  assert.strictEqual(a.waiting, 1);
  assert.strictEqual(c[0].tier, 'Negative');
  const g = c.find(x => x.name === 'Gamma');
  assert.strictEqual(g.avg, null);
  assert.strictEqual(g.lowest, null);
  assert.strictEqual(g.tier, '');
  assert.strictEqual(g.waiting, 2);
});

test('customer tier boundaries use the average: 0 Thin, 20 Normal, 50 Strong', () => {
  const mk = (id, p) => n({ Account: { id, name: id }, Modelled_Margin_Pct: p });
  const c = M.customers([mk('a', 0), mk('b', 20), mk('c', 50), mk('d', 19.94), mk('e', -0.04), mk('f', 19.96)], {});
  const t = Object.fromEntries(c.map(x => [x.name, x.tier]));
  assert.deepStrictEqual(t, { a: 'Thin', b: 'Normal', c: 'Strong', d: 'Thin', e: 'Thin', f: 'Normal' }); // tier uses the one-decimal average: 19.94 -> 19.9, 19.96 -> 20.0, -0.04 -> 0.0
});

test('demo data mirrors the live shape', () => {
  const demo = require(path.join(__dirname, '..', 'app', 'demo-data.js')).map(M.normalize);
  const all = M.totals(demo, { hideTest: false });
  assert.strictEqual(all.filled, 8);
  assert.strictEqual(all.waiting, 13);
  assert.ok(demo.some(r => r.pct === 8.7 && r.tier === 'Thin'));
  assert.strictEqual(M.totals(demo, { hideTest: true }).filled, 6);
});
