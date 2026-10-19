'use strict';
// Playwright smoke test of the widget in demo mode. NODE_PATH=$(npm root -g) node tests/demo.smoke.js
const { chromium } = require('playwright');
const path = require('path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:/, r => r.abort());
  await page.goto('file://' + path.resolve(__dirname, '../app/lost.html') + '?demo=1');
  await page.waitForSelector('#sum1 b');
  const t = s => page.textContent(s);
  const sum1 = await t('#sum1');
  assert.match(sum1, /Devices lost/); assert.match(sum1, /Gross loss/); assert.match(sum1, /Net loss/);
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 11);
  assert.equal(await page.$$eval('#brands [role=tab]', r => r.length), 4);
  await page.click('#brands [data-id=sr]');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 2);
  await page.click('#brands [data-id=all]');
  await page.click('#dev button[data-f=missing]');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 1);
  await page.click('#dev button[data-f=dup]');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 2);
  await page.click('#dev button[data-f=all]');
  await page.click('#cust tbody tr.click >> nth=0');
  assert.match(await t('#active-customer'), /Customer:/);
  await page.click('#clear-cust');
  await page.click('#dev .jp-chev >> nth=0');
  assert.ok(await page.isVisible('#dev tr.jp-detail:not([hidden]) .jp-ev'));
  assert.ok(await page.$('#trend svg'));
  const body = await page.textContent('body');
  assert.ok(!/Demo Client|Last_Client/.test(body), 'Last Client must never render');
  assert.deepEqual(errors, []);

  // equipment filters
  const opts = await page.$$eval('#f-mfr option', o => o.map(x => x.textContent));
  assert.deepEqual(opts, ['All manufacturers', 'Allied Universal Electronic Monitoring (4)', 'Buddi (1)', 'SCRAM Systems (3)', 'SuperCom (3)']);
  await page.selectOption('#f-mfr', 'SuperCom');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 3);
  assert.deepEqual(await page.$$eval('#f-model option', o => o.map(x => x.textContent)), ['All models', 'PureOne GPS (2)', 'No model (1)']);
  await page.selectOption('#f-model', 'PureOne GPS');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 2);
  assert.match(await t('#sum1'), /Devices lost\s*2/);
  await page.selectOption('#f-mfr', '');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 2);   // model filter stays
  await page.selectOption('#f-model', '');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 11);
  await page.selectOption('#f-model', '__none');
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 2);
  await page.selectOption('#f-model', '');
  // a filter that no longer applies after a brand change resets
  await page.selectOption('#f-mfr', 'Buddi');
  await page.click('#brands [data-id=sr]');
  assert.equal(await page.inputValue('#f-mfr'), '');
  await page.click('#brands [data-id=all]');
  // theme switcher
  await page.selectOption('#theme', 'dark');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  await page.selectOption('#theme', 'light');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  await page.selectOption('#theme', 'auto');
  assert.equal(await page.getAttribute('html', 'data-theme'), null);
  // ---- writes (demo mode saves into memory only) ----
  await page.click('#dev button[data-f=all]');
  const lostBefore = await t('#sum1');
  // inline status: Lost -> Damaged on first row keeps count, Recovered asks for a date
  const sel = await page.$('#dev select.ld-st >> nth=0');
  assert.ok(sel, 'status select shown for Administrator');
  // add
  await page.click('#add');
  await page.waitForSelector('.ld-form #ld-serial');
  await page.click('.ld-form [data-act=save]');
  assert.ok(await page.isVisible('.ld-es a'), 'error summary shows for empty form');
  await page.fill('#ld-serial', 'NEW-0001');
  await page.fill('#ld-customer', 'Demo County Sheriff');
  await page.selectOption('#ld-model', 'm1');
  assert.equal(await page.inputValue('#ld-deviceType'), 'GPS');
  await page.click('.ld-form [data-act=save]');
  await page.waitForSelector('.ld-form', { state: 'detached' });
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 12);
  assert.notEqual(await t('#sum1'), lostBefore);
  // add and enter another keeps the drawer open and keeps customer and date
  await page.click('#add');
  await page.fill('#ld-serial', 'NEW-0002'); await page.fill('#ld-customer', 'Demo County Sheriff'); await page.fill('#ld-date', '2026-10-05');
  await page.click('.ld-form [data-act=again]');
  await page.waitForFunction(() => document.querySelector('#ld-serial').value === '');
  assert.equal(await page.inputValue('#ld-customer'), 'Demo County Sheriff');
  assert.equal(await page.inputValue('#ld-date'), '2026-10-05');
  await page.fill('#ld-serial', 'NEW-0003');
  await page.click('.ld-form [data-act=save]');
  await page.waitForSelector('.ld-form', { state: 'detached' });
  assert.equal(await page.$$eval('#dev tbody tr.jp-row', r => r.length), 14);
  // duplicate open serial is refused
  await page.click('#add');
  await page.fill('#ld-serial', 'NEW-0001'); await page.fill('#ld-customer', 'Demo County Sheriff');
  await page.click('.ld-form [data-act=save]');
  assert.match(await t('.ld-es'), /already has an open loss/);
  await page.click('.ld-form [data-act=cancel]');
  // inline status to Recovered needs a date earlier than listed? (today is after listed date)
  await page.selectOption('#dev select.ld-st[data-id="d5"]', 'Recovered');
  await page.waitForSelector('#ld-rec-on');
  await page.fill('#ld-rec-on', '2000-01-01');
  await page.click('.ld-form [data-act=ok]');
  assert.match(await t('.ld-form'), /before the date listed lost/);
  await page.fill('#ld-rec-on', '2026-10-10');
  await page.click('.ld-form [data-act=ok]');
  await page.waitForSelector('.ld-form', { state: 'detached' });
  assert.equal(await page.inputValue('#dev select.ld-st[data-id="d5"]'), 'Recovered');
  // inline Lost -> Damaged
  await page.selectOption('#dev select.ld-st[data-id="d1"]', 'Damaged');
  await page.waitForFunction(() => document.querySelector('#dev select.ld-st[data-id="d1"]').value === 'Damaged');
  // edit
  await page.click('#dev button.ld-edit[data-id="d3"]');
  await page.waitForSelector('#ld-reportedBy');
  assert.ok(await page.$('#ld-amount'), 'Administrator sees money fields');
  await page.fill('#ld-reportedBy', 'Test Officer');
  await page.fill('#ld-amount', '900');
  await page.click('.ld-form [data-act=save]');
  await page.waitForSelector('.ld-form', { state: 'detached' });
  await page.click('#dev .jp-row:has(button.ld-edit[data-id="d3"]) .jp-chev');
  assert.match(await t('#dev'), /\$900/);
  assert.deepEqual(errors, []);
  // read-only profile: no controls
  const ro = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await ro.route(/^https?:/, r => r.abort());
  await ro.goto('file://' + path.resolve(__dirname, '../app/lost.html') + '?demo=1&as=leadership');
  await ro.waitForSelector('#sum1 b');
  assert.equal(await ro.$$eval('#dev select.ld-st, #dev button.ld-edit', r => r.length), 0);
  assert.ok(await ro.isHidden('#add'));
  // EM Support: can edit, no money fields
  const em = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await em.route(/^https?:/, r => r.abort());
  await em.goto('file://' + path.resolve(__dirname, '../app/lost.html') + '?demo=1&as=emsupport');
  await em.waitForSelector('#sum1 b');
  await em.click('#dev button.ld-edit >> nth=0');
  await em.waitForSelector('#ld-reportedBy');
  assert.equal(await em.$('#ld-amount'), null);
  await page.setViewportSize({ width: 390, height: 800 });
  assert.ok(await page.isVisible('#dev'));
  await page.screenshot({ path: process.env.SHOT || '/tmp/lost-demo.png', fullPage: true });
  await browser.close();
  console.log('smoke ok');
})().catch(e => { console.error(e); process.exit(1); });
