/* node --test tests/contracts-flow-model.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../app/contracts-flow-model.js');

const NOW = Date.parse('2026-10-14T18:00:00Z');          /* Wednesday 1pm Central */
const D = 86400000;
const day = (n) => new Date(NOW + n * D).toISOString().slice(0, 10);   /* n days from today (negative = past) */
const iso = (n) => new Date(NOW + n * D).toISOString();
const acct = (id) => ({ id: 'a' + id, name: 'Acct ' + id });

function ct(id, over) {
  return Object.assign({ id, Name: 'Contract ' + id, Account: acct(id), Counterparty_Type: 'Customer', Contract_Type: 'Full Contract', Contract_Status: 'Active/Complete',
    Ingest_Status: 'Backlog', Renewal_Status: 'Not started', Final_End_Date: day(400), Notice_Deadline: day(300), Margin_Cost_Check: 'Costs match contracts', Reconciliation_Status: 'Agrees' }, over || {});
}
const doc = (id, c, over) => Object.assign({ id, Name: 'file-' + id + '.pdf', Contract: c ? { id: c, name: 'Contract ' + c } : null, Parse_Status: null, Created_Time: iso(-30) }, over || {});
const clause = (id, c, status) => ({ id, Name: 'Clause ' + id, Contract: c ? { id: c, name: 'Contract ' + c } : null, Status: status, Clause_Type: 'Reporting', Created_Time: iso(-20) });
const line = (id, c, status, over) => Object.assign({ id, Parent_Id: { id: c, name: 'Contract ' + c }, Line_Status: status, Line_Verified: status === 'Verified', Superseded_By: null, Rate_Type: 'Customer rate', Rate_Device: 'GPS', Source_Ref: 'p.7' }, over || {});

const contracts = [
  ct('c1'),                                                                                            /* backlog, has files */
  ct('c2', { Final_End_Date: day(20) }),                                                              /* backlog, no files, ends in 20, not started */
  ct('c3', { Ingest_Status: 'Needs Review', Ingested_On: iso(-20), Margin_Cost_Check: null }),         /* review too long, lines and clause waiting */
  ct('c4', { Ingest_Status: 'Needs Review', Ingested_On: iso(-3) }),                                  /* every item decided */
  ct('c5', { Ingest_Status: 'Needs Review', Ingested_On: iso(-5) }),                                  /* nothing found */
  ct('c6', { Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: null }),
  ct('c7', { Ingest_Status: 'Ingested', Ingested_On: iso(-9) }),                                       /* never verified */
  ct('c8', { Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: 'Cost differs', Reconciliation_Status: 'Rate differs' }),
  ct('c9', { Ingest_Status: 'Failed', Ingested_On: iso(-2) }),
  ct('c10', { Final_End_Date: day(-30), Margin_Cost_Check: 'Missing vendor cost' }),                    /* past the end, not renewed */
  ct('c11', { Final_End_Date: day(60), Notice_Deadline: day(-5) }),                                    /* 31 to 90, notice passed */
  ct('c12', { Final_End_Date: day(200), Renewal_Status: 'Outreach' }),
  ct('c13', { Final_End_Date: null }),
  ct('c14', { Contract_Status: 'Ended', Final_End_Date: day(-100) }),                                   /* ended: out of the flow */
  ct('c15', { Counterparty_Type: 'Vendor', Account: null, Ingest_Status: 'Ingested', Ingested_On: iso(-9), Last_Verified: day(-8), Margin_Cost_Check: null, Final_End_Date: day(-1), Renewal_Status: null }),
  ct('c16', { Final_End_Date: day(10), Renewal_Status: 'Terms agreed' }),
  ct('c17', { Final_End_Date: day(-5), Renewal_Status: 'Not renewing' }),
  ct('c18', { Final_End_Date: day(-3), Renewal_Status: 'Renewed' }),                                   /* settled */
  ct('c19', { Final_End_Date: day(15), Renewal_Status: 'Sent for signature' }),                       /* still open: signature not back */
  ct('c20', { Final_End_Date: day(25), Renewal_Status: 'Needs decision' })                            /* still open: waiting on a decision */
];
const docs = [doc('d1', 'c1'), doc('d2', 'c1'), doc('d3', 'c3', { Parse_Status: 'Failed' }), doc('d4', 'c9'), doc('d9', null)];
const clauses = [clause('k1', 'c3', 'Proposed'), clause('k2', 'c4', 'Confirmed'), clause('k3', null, 'Proposed'), clause('k4', 'c6', 'Confirmed')];
const lines = [
  line('l1', 'c3', 'Proposed'), line('l2', 'c3', 'Proposed'), line('l3', 'c3', 'Verified'),
  line('l4', 'c4', 'Verified'), line('l5', 'c4', 'Verified'),
  line('l6', 'c6', 'Proposed'), line('l7', 'c6', 'Proposed', { Source_Ref: '' }),             /* hand-entered, not waiting for review */
  line('l8', 'c7', 'Verified'), line('l9', 'c8', 'Verified')
];
const m = C.build({ contracts, docs, clauses, lines }, NOW, { parseAvailable: true });
const ids = (lane, model) => (model || m).lanes[lane].items.map((i) => i.id).sort();

test('line status and band rules match the Contract Review widget and the Renewal Band formula', () => {
  assert.equal(C.lineStatus({ Line_Status: 'Verified' }), 'Verified');
  assert.equal(C.lineStatus({ Line_Status: null, Superseded_By: 'Rejected in review' }), 'Rejected');
  assert.equal(C.lineStatus({ Line_Status: 'Proposed', Superseded_By: 'abc' }), 'Superseded');
  assert.equal(C.lineStatus({ Line_Status: null, Line_Verified: true }), 'Verified');
  assert.equal(C.lineStatus({}), 'Proposed');
  assert.deepEqual([-1, 0, 15, 16, 30, 45, 90, 91].map(C.bandOf), ['Expired', '≤15 days', '≤15 days', '≤30 days', '≤30 days', '≤60 days', '≤90 days', 'OK']);
  assert.equal(C.bandOf(null), '');
});

test('settled renewal statuses are Renewed and Not renewing only', () => {
  assert.deepEqual(C.SETTLED, ['Renewed', 'Not renewing']);
});

test('ended contracts are left out and counted; vendor contracts stay in steps 1 to 4', () => {
  assert.equal(m.totals.ended, 1);
  assert.equal(m.totals.live, 19);
  assert.equal(m.totals.vendors, 1);
  assert.ok(!Object.values(m.lanes).some((l) => l.items.some((i) => i.id === 'c14')));
});

test('packet in: files, nothing to read, files with no contract, failed parse', () => {
  assert.deepEqual(ids('p-files'), ['c1', 'c3', 'c9']);
  assert.ok(ids('p-nofiles').includes('c2') && !ids('p-nofiles').includes('c1'));
  assert.deepEqual(ids('p-orphan'), ['d9']);
  assert.deepEqual(ids('p-parse'), ['d3']);
  const no = C.build({ contracts, docs, clauses, lines }, NOW, { parseAvailable: false });
  assert.match(no.lanes['p-parse'].hint, /not on Contract Documents/);
});

test('read: backlog with files first, failed, needs review, too long', () => {
  assert.deepEqual(ids('r-backlog-files'), ['c1']);
  assert.ok(ids('r-backlog').includes('c1') && ids('r-backlog').includes('c2') && !ids('r-backlog').includes('c3'));
  assert.deepEqual(ids('r-failed'), ['c9']);
  assert.deepEqual(ids('r-needs'), ['c3', 'c4', 'c5']);
  assert.deepEqual(ids('r-needs-old'), ['c3']);
  const wide = C.build({ contracts, docs, clauses, lines }, NOW, { reviewLimit: 30 });
  assert.equal(wide.lanes['r-needs-old'].count, 0);
  const tight = C.build({ contracts, docs, clauses, lines }, NOW, { reviewLimit: 3 });
  assert.deepEqual(ids('r-needs-old', tight), ['c3', 'c4', 'c5']);
});

test('reviewed: pending lines and clauses, ready, nothing found, ingested with items waiting, never verified', () => {
  assert.deepEqual(ids('v-lines'), ['c3', 'c6']);                    /* c6 hand-entered line is not counted */
  assert.equal(m.lanes['v-lines'].items.find((i) => i.id === 'c3').note, '2 rate lines to verify.');
  assert.deepEqual(ids('v-clauses'), ['c3']);
  assert.deepEqual(ids('v-ready'), ['c4']);
  assert.deepEqual(ids('v-nothing'), ['c5']);
  assert.deepEqual(ids('v-ing-pending'), ['c6']);
  assert.deepEqual(ids('v-ing-noverify'), ['c7']);
  assert.deepEqual(ids('v-done'), ['c15', 'c8']);
  assert.deepEqual(ids('v-orphan'), ['k3']);
});

test('margin checked: customer contracts only; ingested with no result is flagged', () => {
  assert.deepEqual(ids('m-diff'), ['c8']);
  assert.deepEqual(ids('m-missing'), ['c10']);
  assert.ok(ids('m-none').includes('c3') && ids('m-none').includes('c6') && !ids('m-none').includes('c15'));
  assert.deepEqual(ids('m-ing-none'), ['c6']);                       /* vendor c15 is ingested with no result but is not in this step */
  assert.deepEqual(ids('m-rate'), ['c8']);
});

test('renewal: expired, 30 days, 90 days, notice passed, under way, no date, on track; settled and vendor excluded', () => {
  assert.deepEqual(ids('n-expired'), ['c10']);                        /* c17 Not renewing and c18 Renewed are settled */
  assert.deepEqual(ids('n-30'), ['c16', 'c19', 'c2', 'c20']);         /* Sent for signature and Needs decision are still open */
  assert.deepEqual(ids('n-90'), ['c11']);
  assert.deepEqual(ids('n-notice'), ['c11']);
  assert.deepEqual(ids('n-talks'), ['c12', 'c16', 'c19', 'c20']);
  assert.deepEqual(ids('n-nodate'), ['c13']);
  assert.ok(ids('n-ok').includes('c12') && ids('n-ok').includes('c17') && ids('n-ok').includes('c18') && !ids('n-ok').includes('c15'));
  assert.ok(!Object.keys(m.lanes).filter((k) => k[0] === 'n').some((k) => ids(k).includes('c15')));
  assert.equal(m.lanes['n-30'].items.find((i) => i.id === 'c2').tone, 'bad');
  assert.equal(m.lanes['n-30'].items.find((i) => i.id === 'c16').tone, 'warn');
});

test('stuck strip is ordered: failed, expired, ending soon not started, then the warnings', () => {
  const lanes = m.stuck.map((s) => s.lane);
  assert.deepEqual(lanes.slice(0, 3), ['r-failed', 'n-expired', 'n-30']);
  ['r-needs-old', 'v-ing-pending', 'v-nothing', 'm-ing-none', 'p-orphan', 'v-orphan', 'n-notice'].forEach((l) => assert.ok(lanes.includes(l), l));
});

test('scope: customers only drops vendor contracts and the orphan lanes; vendors only keeps just them', () => {
  const cu = C.build({ contracts, docs, clauses, lines }, NOW, { scope: 'Customer' });
  assert.equal(cu.totals.vendors, 0);
  assert.ok(!ids('v-done', cu).includes('c15'));
  const ve = C.build({ contracts, docs, clauses, lines }, NOW, { scope: 'Vendor' });
  assert.deepEqual(ids('v-done', ve), ['c15']);
  assert.equal(ve.lanes['p-orphan'].count, 0);
  assert.equal(ve.lanes['n-expired'].count, 0);
});

test('trace returns the contract with its files, clauses and lines, and the account', () => {
  const t = C.trace(m, m.lanes['v-lines'].items[0]);
  assert.equal(t.contract.id, 'c3');
  assert.equal(t.contract.docs.length, 1);
  assert.equal(t.contract.pendingLines, 2);
  assert.equal(t.account.id, 'ac3');
  assert.equal(C.trace(m, { kind: 'doc', contractId: null }).contract, null);
});

test('days are counted in Central time and end-of-day dates do not drift', () => {
  const late = Date.parse('2026-10-15T03:30:00Z');                 /* still Wednesday 14 Oct in Central */
  const x = C.build({ contracts: [ct('z1', { Final_End_Date: '2026-10-14' })] }, late, {});
  assert.equal(x.byId.z1.days, 0);
  assert.match(x.lanes['n-30'].items[0].ageText, /ends today/);
});

test('empty data does not break the build', () => {
  const e = C.build({}, NOW, {});
  assert.equal(e.stuck.length, 0);
  assert.equal(e.stages.length, 5);
});
