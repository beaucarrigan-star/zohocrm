/* Next step v1.2.0 (S64) model tests. Run from the repo root: node widgets/next-step/tests/model.test.js
   Part 1: the five v1.1.0 modules give byte-identical output to the tagged v1.1.0 model (next-step-v1.1.0-s41).
   Part 2: Deals mode, with the five TEST deals as read from Zoho on 2 Nov 2026 and a stale case (Days_in_Stage 206).
   Test values live here only; the shipped page has no Deals sample data. */
'use strict';
var path = require('path'), fs = require('fs'), cp = require('child_process'), vm = require('vm');
var APP = path.join(__dirname, '..', 'app');
var M = require(path.join(APP, 'next-step-model.js'));
var STAGES = require(path.join(APP, 'deal-stages.js'));
var pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '\n   got  ' + JSON.stringify(a) + '\n   want ' + JSON.stringify(b)); }

/* ---------- Part 1: regression against the v1.1.0 tag ---------- */
function fromTag(file) { return cp.execSync('git show next-step-v1.1.0-s41:widgets/next-step/app/' + file, { cwd: path.join(__dirname, '..'), encoding: 'utf8' }); }
var baseSrc = fromTag('next-step-model.js'), baseMod = { exports: {} };
vm.runInNewContext(baseSrc, { module: baseMod });
var B = baseMod.exports;
eq(B.VERSION, '1.1.0', 'base model is v1.1.0');
eq(M.VERSION, '1.2.0', 'new model is v1.2.0');
eq(M.MODULES, B.MODULES, 'MODULES list unchanged (Deals only in MODULES_S13)');
eq(M.MODULES_S13, B.MODULES.concat('Deals'), 'MODULES_S13 adds Deals');

var win = {}; vm.runInNewContext(fromTag('demo-data.js'), { window: win, Object: Object, Date: Date });
var now = new Date();
var rows = win.NS_DEMO.slice();
/* Extra rows beyond the demo list: blanks, odd values, view-only, missing fields */
['Contracts', 'Accounts', 'Cases', 'Billing_Findings', 'Solicitations', 'Leads', undefined].forEach(function (mod) {
  rows.push({ label: 'empty ' + mod, module: mod, rec: {}, contact: null });
  rows.push({ label: 'view-only ' + mod, module: mod, rec: { id: '1', $editable: false, Status: 'Open', Counterparty_Type: 'Customer', Renewal_Status: 'Renewed', Account_Type: 'Customer' }, contact: null });
  rows.push({ label: 'odd ' + mod, module: mod, rec: { id: '2', Status: 'Weird', Renewal_Status: 'Weird', Account_Type: 'Weird', Counterparty_Type: 'Customer', Severity: 'CRITICAL' }, contact: { id: '9', name: 'X' } });
});
rows.forEach(function (d, i) {
  var ctx = { now: now, contact: d.contact };
  eq(M.compute(d.module, JSON.parse(JSON.stringify(d.rec)), ctx), B.compute(d.module, JSON.parse(JSON.stringify(d.rec)), ctx), 'compute same as v1.1.0: ' + d.label);
  ['call', 'edit', 'task'].forEach(function (k) {
    eq(M.formFor(k, d.module, d.rec, { contact: d.contact }), B.formFor(k, d.module, d.rec, { contact: d.contact }), 'formFor ' + k + ' same as v1.1.0: ' + d.label);
  });
});
console.log('Part 1: ' + rows.length + ' rows compared with v1.1.0');

/* ---------- Part 2: Deals ---------- */
var NOW = new Date(2026, 10, 2);
function deal(o) { return Object.assign({ id: '6715134000011022038', Deal_Name: 'TEST', Stage_Group: 'Early', Days_in_Stage: 0, Contact_Name: { id: '6715134000011028080', name: 'TEST Contact (do not use)' }, Next_Step: 'TEST next step (do not use)', Amount: null, Deal_Margin: null, Margin_Status: null, Reason_For_Loss__s: null }, o); }
function run(rec, tasks) { return M.compute('Deals', rec, { now: NOW, contact: null, tasks: tasks || [], stages: STAGES }); }

/* The five TEST deals (COQL read, 2 Nov 2026) */
var TEST = [
  deal({ id: '6715134000011013037', Deal_Name: 'TEST ownership routing (do not use)', Pipeline: 'JusticePoint EM', Stage: 'Prospecting', Amount: 16425, Deal_Margin: 36.7, Margin_Status: 'On target' }),
  deal({ id: '6715134000011022038', Deal_Name: 'TEST 13a Programs (do not use)', Pipeline: 'JusticePoint Programs', Stage: 'Prospecting' }),
  deal({ id: '6715134000011022039', Deal_Name: 'TEST 13a Sirona (do not use)', Pipeline: 'Sirona Programs', Stage: 'Prospecting' }),
  deal({ id: '6715134000011022040', Deal_Name: 'TEST 13a TDP (do not use)', Pipeline: 'TDP Pipeline', Stage: 'Prospecting' }),
  deal({ id: '6715134000011022041', Deal_Name: 'TEST 13a Standard (do not use)', Pipeline: 'Standard Pipeline', Stage: 'Prospecting' })
];
var em = run(TEST[0]).deal;
eq(em.pipeline, 'JusticePoint EM', 'EM: pipeline name');
eq(em.days, 0, 'EM: 0 days in stage'); eq(em.stale, false, 'EM: not stale');
eq(em.path.stages.map(function (s) { return s.name; }), STAGES['JusticePoint EM'], 'EM: path is the EM list');
eq(em.path.stages.map(function (s) { return s.state; }).join(','), 'current,todo,todo,todo,todo,todo,todo,todo', 'EM: Prospecting marked current');
eq(em.gate.label, 'To leave Prospecting:', 'EM: gate label');
eq(em.gate.items, [{ name: 'Contact', ok: true }, { name: 'Amount', ok: true }], 'EM: Contact and Amount ticked');
eq(em.gate.note, { name: 'Next Step', ok: true, hint: 'needed to save here' }, 'EM: Next Step ticked');
eq(em.margin, { pct: '36.7%', status: 'On target', tone: 'ok' }, 'EM: margin 36.7% On target');
eq(em.next, { kind: 'field', text: 'TEST next step (do not use)', due: '', owner: '' }, 'EM: next step from the field (no task)');
eq(run(TEST[0]).tone, 'ok', 'EM: tone ok');
TEST.slice(1).forEach(function (r) {
  var x = run(r), d = x.deal;
  eq(d.path.inList, true, r.Pipeline + ': Prospecting in list');
  eq(d.path.stages.map(function (s) { return s.name; }), STAGES[r.Pipeline], r.Pipeline + ': path is its own list');
  eq(d.gate.items[1], { name: 'Amount', ok: false }, r.Pipeline + ': Amount missing');
  eq(d.gate.items[0].ok, true, r.Pipeline + ': Contact present');
  eq(d.margin, { pct: null, status: 'No lines', tone: 'none' }, r.Pipeline + ': blank margin status reads No lines');
  eq(x.tone, 'warn', r.Pipeline + ': amber because Amount is missing to leave Prospecting');
  eq(x.title, 'TEST next step (do not use)', r.Pipeline + ': title is the Next Step field');
});
eq(STAGES['TDP Pipeline'].length, 7, 'TDP list has 7 stages'); eq(STAGES['Standard Pipeline'].length, 6, 'Standard list has 6 stages');

/* Stale (Days_in_Stage 206) */
var st = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Days_in_Stage: 206, Amount: 264625 }));
eq([st.deal.days, st.deal.stale, st.tone, st.why], [206, true, 'warn', '206 days in stage.'], 'stale: 206 days, amber chip');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Days_in_Stage: 13, Amount: 1 })).deal.stale, false, 'stale: 13 days is not stale');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Days_in_Stage: 14, Amount: 1 })).deal.stale, true, 'stale: 14 days is stale');
var won = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Closed Won', Stage_Group: 'Won', Days_in_Stage: 206, Amount: 30879, Margin_Status: 'On target' }));
eq([won.deal.stale, won.deal.gate, won.tone], [false, null, 'ok'], 'Won at 206 days: no chip, no gate');
var lost = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Closed Lost', Stage_Group: 'Lost or Dead', Days_in_Stage: 33 }));
eq([lost.deal.stale, lost.deal.gate], [false, { label: 'Closed Lost:', items: [{ name: 'Reason For Loss', ok: false }], note: null }], 'Closed Lost: no chip, Reason For Loss missing');
eq(lost.tone, 'warn', 'Closed Lost without a reason: amber rule');
var lostOk = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Closed Lost', Stage_Group: 'Lost or Dead', Reason_For_Loss__s: 'Price' }));
eq([lostOk.deal.gate.items[0].ok, lostOk.tone], [true, 'ok'], 'Closed Lost: Reason For Loss ticked, cobalt rule');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Closed Lost', Stage_Group: 'Lost or Dead', Reason_For_Loss__s: '-None-' })).deal.gate.items[0].ok, false, 'Closed Lost: -None- counts as missing');

/* Past Discovery, open */
var mid = run(deal({ Pipeline: 'JusticePoint Programs', Stage: 'Budget Proposal', Stage_Group: 'Mid', Amount: 5000, Next_Step: null }));
eq(mid.deal.gate, { label: 'Kept past Discovery:', items: [{ name: 'Contact', ok: true }, { name: 'Amount', ok: true }], note: null }, 'past Discovery: Contact and Amount kept, no Next Step line');
eq(mid.deal.path.stages.map(function (s) { return s.state; }).join(','), 'done,done,done,current,todo,todo,todo,todo', 'Programs Budget Proposal: fourth stage current');
eq(run(deal({ Pipeline: 'JusticePoint Programs', Stage: 'Budget Proposal', Stage_Group: 'Mid', Amount: 5000, Contact_Name: null })).deal.gate.items[0].ok, false, 'past Discovery: missing Contact shows');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Amount: 0 })).deal.gate.items[1].ok, true, 'Amount 0 counts as filled (rule checks empty)');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Next_Step: '' })).deal.gate.note.ok, false, 'Discovery: blank Next Step shows missing');

/* Stages not in the pipeline's list */
['Dead', 'Meeting (Face to Face or Zoom)', 'Closed Lost to Competition'].forEach(function (s) {
  var d = run(deal({ Pipeline: 'JusticePoint EM', Stage: s, Stage_Group: s === 'Meeting (Face to Face or Zoom)' ? 'Early' : 'Lost or Dead' })).deal;
  eq([d.path.inList, d.path.stage, d.path.stages.length], [false, s, 0], 'not in list: ' + s);
});
eq(run(deal({ Pipeline: 'Standard Pipeline', Stage: 'Pilot Running', Stage_Group: 'Mid' })).deal.path.inList, false, 'EM-only stage on Standard is not in list');
eq(run(deal({ Pipeline: null, Stage: 'Prospecting' })).deal.path.inList, false, 'no pipeline: stage shown alone');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Dead', Stage_Group: '' })).deal.closed, true, 'blank Stage_Group: Dead still closed');

/* Margin chips */
[['On target', 'ok'], ['Below target', 'warn'], ['Below floor', 'bad'], ['No floor set', 'none'], ['No cost yet', 'none'], ['No lines', 'none'], ['-None-', 'none']].forEach(function (p) {
  var m = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', Margin_Status: p[0], Deal_Margin: 12.345 })).deal.margin;
  eq([m.status, m.tone, m.pct], [p[0] === '-None-' ? 'No lines' : p[0], p[1], '12.3%'], 'margin chip ' + p[0]);
});

/* Next step: earliest open task, then the field, then "Set a next step" */
var tasks = [
  { Subject: 'Later', Due_Date: '2026-11-20', Status: 'Not Started', Owner: { first_name: 'Joe', last_name: 'Steinhaus' } },
  { Subject: 'Done', Due_Date: '2026-10-01', Status: 'Completed', Owner: { first_name: 'Joe', last_name: 'Steinhaus' } },
  { Subject: 'No date', Due_Date: null, Status: 'Deferred', Owner: { first_name: 'Beau Carrigan', last_name: null } },
  { Subject: 'Earliest', Due_Date: '2026-11-04', Status: 'In Progress', Owner: { first_name: 'Beau Carrigan', last_name: null } }
];
var nx = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery' }), tasks);
eq(nx.deal.next, { kind: 'task', text: 'Earliest', due: 'Nov 4, 2026', owner: 'Beau Carrigan' }, 'next: earliest open task with due date and owner');
eq(nx.title, 'Earliest', 'next: title is the task subject');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery' }), [tasks[2]]).deal.next, { kind: 'task', text: 'No date', due: '', owner: 'Beau Carrigan' }, 'next: undated open task still beats the field');
eq(run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery' }), [tasks[1]]).deal.next.kind, 'field', 'next: completed task ignored, field used');
var nn = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Closed Won', Stage_Group: 'Won', Next_Step: null }));
eq([nn.deal.next.kind, nn.title, nn.primary.label, nn.secondary.label], ['none', 'Set a next step', 'Add task', 'Edit deal'], 'next: neither gives Set a next step, Add task first');
eq([nx.primary.label, nx.secondary.label], ['Edit deal', 'Add task'], 'buttons: Edit deal, Add task');
var ro = run(deal({ Pipeline: 'JusticePoint EM', Stage: 'Discovery', $editable: false }));
eq([ro.primary.label, ro.secondary], ['Add task', null], 'view-only deal: edit dropped');
eq(M.formFor('task', 'Deals', TEST[1]), { api: 'create', Entity: 'Tasks', RecordData: { Subject: 'Deal follow-up: TEST 13a Programs (do not use)', What_Id: { id: '6715134000011022038' }, $se_module: 'Deals' } }, 'formFor task on a deal');
eq(M.formFor('edit', 'Deals', TEST[1]), { api: 'edit', Entity: 'Deals', RecordID: '6715134000011022038' }, 'formFor edit on a deal');

/* Live stage lists from the layouts response */
var live = M.stagesFromLayouts(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'deals-layout-pipeline-2026-11-02.json'), 'utf8')));
eq(live, STAGES, 'live layout read gives the same lists as deal-stages.js (2 Nov 2026)');
eq(M.stagesFromLayouts({ data: { layouts: [{ sections: [{ fields: [{ api_name: 'Pipeline', pick_list_values: [{ display_value: 'X', maps: [] }] }] }] }] } }), null, 'layouts with no Stage maps give null (fallback to the map)');
eq(M.stagesFromLayouts(null), null, 'no layouts gives null');

console.log('Part 2 done.\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
