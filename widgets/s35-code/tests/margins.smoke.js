'use strict';
/* EM Margins smoke test. Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=$(npm root -g) node tests/margins.smoke.js
   S35: the intro check reads INTRO_TEXT (env), so the same test runs on the 24 Oct wording and the guide wording. */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { chromium } = require('playwright');
const M = require('../app/margins-model.js');
const DEMO = require('../app/demo-data.js');

const PAGE = 'file://' + path.join(__dirname, '..', 'app', 'margins.html');
const SHOTS = path.join(__dirname, '..', 'shots');
const INTRO_TEXT = process.env.INTRO_TEXT || 'Margin on every verified customer contract line';
fs.mkdirSync(SHOTS, { recursive: true });
let n = 0;
const ok = (m) => { n += 1; console.log('ok ' + n + ' - ' + m); };

/* Fake Zoho SDK. Only coql / getRecord / Record.open are allowed; any other CRM call is logged as a write. */
function fakeZoho(rows, failFirstFull) {
  return `(() => {
    const calls = [], handlers = {}; window.__calls = calls; const ROWS = ${JSON.stringify(rows)};
    const mk = (p) => new Proxy(function () {}, { get: (t, k) => mk(p.concat(String(k))), apply: (t, th, a) => { calls.push({ path: p.join('.'), args: a }); return Promise.resolve({}); } });
    const API = new Proxy({}, { get: (t, k) => {
      if (k === 'coql') return (q) => { calls.push({ path: 'CRM.API.coql', args: [q] });
        if (${failFirstFull ? 'true' : 'false'} && /Margin_Notes/.test(q.select_query)) return Promise.reject({ message: 'FIELD_NOT_PERMITTED' });
        return Promise.resolve({ data: /offset 0\\b/.test(q.select_query) ? ROWS : [], info: { more_records: false } }); };
      if (k === 'getRecord') return (a) => { calls.push({ path: 'CRM.API.getRecord', args: [a] }); return Promise.resolve({ data: [] }); };
      return mk(['CRM', 'API', String(k)]); } });
    const UI = new Proxy({}, { get: (t, k) => k === 'Record' ? new Proxy({}, { get: (t2, k2) => k2 === 'open' ? (a) => { calls.push({ path: 'CRM.UI.Record.open', args: [a] }); return Promise.resolve(); } : mk(['CRM', 'UI', 'Record', String(k2)]) }) : mk(['CRM', 'UI', String(k)]) });
    window.ZOHO = { embeddedApp: { on: (e, cb) => { handlers[e] = cb; }, init: () => setTimeout(() => handlers.PageLoad && handlers.PageLoad({ Entity: 'x' }), 10) },
      CRM: new Proxy({}, { get: (t, k) => k === 'API' ? API : k === 'UI' ? UI : mk(['CRM', String(k)]) }) };
  })();`;
}
const ALLOWED = ['CRM.API.coql', 'CRM.API.getRecord', 'CRM.UI.Record.open'];
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);
const txt = (page, sel) => page.locator(sel).innerText();

(async () => {
  const browser = await chromium.launch();
  const errsAll = [];
  const newPage = async (opts, init) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errsAll.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.googleapis|zwidgets|net::ERR|Failed to load resource/i.test(m.text())) errsAll.push(m.text()); });
    await page.route(/zwidgets|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    if (init) await page.addInitScript(init);
    return page;
  };

  /* ---------- demo mode ---------- */
  const expect = M.totals(DEMO.map(M.normalize), { hideTest: true });
  const expectAll = M.totals(DEMO.map(M.normalize), { hideTest: false });
  let page = await newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await page.goto(PAGE + '?demo=1'); await page.waitForSelector('#totals .tile');
  assert.ok(await page.locator('#demo-banner').isVisible()); ok('demo banner shows');
  assert.strictEqual(await page.title(), 'EM Margins'); ok('page loads with title');
  assert.ok(await page.locator('#jpk-intro').isVisible()); assert.ok((await txt(page, '#jpk-intro')).includes(INTRO_TEXT)); ok('intro strip shows the agreed text');
  const tiles = (await page.locator('#totals .tile').allInnerTexts()).map((s) => s.toLowerCase());
  assert.strictEqual(tiles.length, 4);
  assert.ok(tiles[0].includes('lines with a margin') && tiles[0].includes(String(expect.filled)));
  assert.ok(tiles[1].includes('lines waiting') && tiles[1].includes(String(expect.waiting)));
  assert.ok(tiles[2].includes('below 30% target') && tiles[2].includes(String(expect.below)));
  assert.ok(tiles[3].includes('average margin %') && tiles[3].includes(expect.avg.toFixed(1) + '%'));
  ok('totals with TEST hidden: ' + expect.filled + ' filled, ' + expect.waiting + ' waiting, ' + expect.below + ' below target, avg ' + expect.avg);
  assert.strictEqual(await page.locator('#hide-test').isChecked(), true); ok('Hide TEST is on by default');
  const tabText = await page.locator('#tabs [role=tab]').allInnerTexts();
  assert.deepStrictEqual(tabText.map((t) => t.replace(/\s+/g, '').trim()), ['Margins' + expect.filled, 'Waiting' + expect.waiting, 'Customers' + M.customers(DEMO.map(M.normalize), { hideTest: true }).length]); ok('tab counts: ' + tabText.join(' | ').replace(/\n/g, ' '));

  /* Margins tab */
  let rows = await page.locator('#t-margins tbody tr').count(); assert.strictEqual(rows, expect.filled); ok('Margins tab lists Confirmed rows');
  const pcts = (await page.locator('#t-margins tbody tr td:nth-child(8)').allInnerTexts()).map((s) => parseFloat(s));
  assert.deepStrictEqual(pcts, pcts.slice().sort((a, b) => a - b)); ok('Margins sorted by Margin % ascending: ' + pcts.join(', '));
  assert.ok((await txt(page, '#t-margins')).includes('Oakridge County Courts') === true); assert.ok(!(await txt(page, '#t-margins')).includes('superseded')); ok('Retired row not shown');
  assert.ok(!(await txt(page, '#t-margins')).includes('TEST Account')); ok('TEST hidden');
  await page.uncheck('#hide-test');
  assert.strictEqual(await page.locator('#t-margins tbody tr').count(), expectAll.filled); assert.ok((await txt(page, '#t-margins')).includes('TEST Account')); assert.ok((await txt(page, '#totals')).includes(String(expectAll.filled)));
  assert.ok((await txt(page, '#t-margins')).includes('Thin')); ok('Hide TEST off shows TEST rows (8.7% Thin), totals update');
  await page.check('#hide-test');
  /* filters */
  const vendors = await page.locator('#f-vendor option').allInnerTexts(); assert.ok(vendors.length >= 3);
  await page.selectOption('#f-vendor', 'Pinewood Trackers');
  assert.strictEqual(await page.locator('#t-margins tbody tr').count(), 2); ok('vendor filter');
  await page.selectOption('#f-vendor', '');
  await page.selectOption('#f-device', 'GPS');
  const devs = await page.locator('#t-margins tbody tr td:nth-child(3)').allInnerTexts(); assert.ok(devs.length && devs.every((d) => d === 'GPS')); ok('device filter');
  await page.selectOption('#f-device', '');
  await page.click('#f-tiers [data-tier="Strong"]'); assert.strictEqual(await page.locator('#t-margins tbody tr').count(), 0); assert.ok((await txt(page, '#t-margins')).includes('No lines with a margin'));
  await page.click('#f-tiers [data-tier="Strong"]'); await page.click('#f-tiers [data-tier="Normal"]'); assert.strictEqual(await page.locator('#t-margins tbody tr').count(), expect.filled); await page.click('#f-tiers [data-tier="Normal"]'); ok('tier chips filter');
  const chipStyle = await page.evaluate(() => { const c = document.querySelector('#t-margins .tierchip .chip'); const s = getComputedStyle(c); return { bg: s.backgroundColor, color: s.color }; });
  assert.ok(chipStyle.bg !== 'rgba(0, 0, 0, 0)' && chipStyle.color !== chipStyle.bg); ok('tier chips set both text and background');
  /* popout */
  await page.click('#t-margins tbody tr:first-child td:first-child');
  await page.waitForSelector('.jpk-dr:not([hidden])');
  const dr = await txt(page, '.jpk-dr aside');
  for (const s of ['Open EM Margin record', 'Open contract', 'Open account', 'Margin notes', 'Vendor cost tier', 'Rate description', 'Margin key']) assert.ok(dr.includes(s), 'popout has ' + s);
  ok('row click opens a read-only popout with the three links and all fields');
  await page.screenshot({ path: path.join(SHOTS, '1440-popout-light.png') });
  await page.keyboard.press('Escape'); assert.ok(await page.locator('.jpk-dr').isHidden()); ok('popout closes');
  /* Waiting */
  await page.click('#tabs [data-id=waiting]');
  rows = await page.locator('#t-waiting tbody tr').count(); assert.strictEqual(rows, expect.waiting);
  const reasons = await page.locator('#t-waiting tbody tr td:nth-child(6)').allInnerTexts();
  assert.deepStrictEqual(reasons, reasons.slice().sort((a, b) => a.localeCompare(b))); assert.ok(reasons.includes('No vendor on this rate line') && reasons.includes('Rate line not verified'));
  assert.strictEqual(await page.locator('#t-waiting a[data-open=Contracts]').count(), expect.waiting); ok('Waiting tab: ' + rows + ' rows grouped by reason, each with Open contract');
  await page.click('#t-waiting tbody tr:first-child td:first-child'); await page.waitForSelector('.jpk-dr:not([hidden])'); assert.ok((await txt(page, '.jpk-dr aside')).includes("What's missing")); await page.keyboard.press('Escape'); ok('Waiting row popout');
  /* Customers */
  await page.click('#tabs [data-id=customers]');
  const exp = M.customers(DEMO.map(M.normalize), { hideTest: true });
  const custNames = await page.locator('#t-customers tbody tr td:nth-child(1)').allInnerTexts(); assert.deepStrictEqual(custNames, exp.map((c) => c.name));
  const avgs = await page.locator('#t-customers tbody tr td:nth-child(2)').allInnerTexts();
  assert.deepStrictEqual(avgs.map((a) => (a.includes('—') ? null : parseFloat(a))), exp.map((c) => c.avg)); assert.strictEqual(avgs[avgs.length - 1].trim(), '—'); ok('Customers tab: roll-up matches the model, no-margin accounts last');
  await page.click('#t-customers tbody tr:first-child td:first-child'); await page.waitForSelector('.jpk-dr:not([hidden])'); await page.keyboard.press('Escape'); ok('Customer popout');
  /* theme menu */
  await page.click('#theme'); await page.click('.menu [role=menuitem]:has-text("Dark")');
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark'); await page.click('#theme'); await page.click('.menu [role=menuitem]:has-text("Auto")');
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null); ok('theme menu Auto / Light / Dark');
  await page.click('#tabs [data-id=margins]');
  assert.ok(await noScroll(page)); ok('no horizontal scroll at 1440');
  await page.screenshot({ path: path.join(SHOTS, '1440-light.png'), fullPage: true });
  await page.close();

  /* 1280 */
  page = await newPage({ viewport: { width: 1280, height: 900 } }); await page.goto(PAGE + '?demo=1'); await page.waitForSelector('#t-margins tbody tr'); assert.ok(await noScroll(page)); ok('no horizontal scroll at 1280'); await page.close();

  /* dark 1440 */
  page = await newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' }); await page.goto(PAGE + '?demo=1'); await page.waitForSelector('#t-margins tbody tr');
  await page.screenshot({ path: path.join(SHOTS, '1440-dark.png'), fullPage: true });
  await page.uncheck('#hide-test'); const darkChip = await page.evaluate(() => { const c = [...document.querySelectorAll('#t-margins .tierchip .chip')].find((x) => /Thin/.test(x.textContent)); const s = getComputedStyle(c); return [s.color, s.backgroundColor]; });
  assert.notStrictEqual(darkChip[0], darkChip[1]); await page.check('#hide-test'); ok('dark mode renders (chips keep text and background)'); await page.close();

  /* phone */
  for (const scheme of ['light', 'dark']) {
    page = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(PAGE + '?demo=1'); await page.waitForSelector('#t-margins tbody tr');
    assert.ok(await noScroll(page), 'page scrolls sideways at 390 ' + scheme);
    for (const t of ['margins', 'waiting', 'customers']) { await page.click('#tabs [data-id=' + t + ']'); assert.ok(await noScroll(page), 'overflow on ' + t + ' at 390 ' + scheme); }
    await page.click('#tabs [data-id=margins]');
    await page.screenshot({ path: path.join(SHOTS, scheme === 'light' ? '390.png' : '390-dark.png'), fullPage: true });
    await page.click('#t-margins tbody tr:first-child td:nth-child(2)'); await page.waitForSelector('.jpk-dr:not([hidden])'); assert.ok(await noScroll(page));
    if (scheme === 'light') await page.screenshot({ path: path.join(SHOTS, '390-popout.png') });
    await page.close();
  }
  ok('no horizontal scroll at 390 (light and dark, all tabs, popout)');

  /* ---------- live path with a fake Zoho SDK: only read calls ---------- */
  const raw = DEMO;
  page = await newPage({ viewport: { width: 1440, height: 1000 } }, fakeZoho(raw, false));
  await page.goto(PAGE); await page.waitForSelector('#t-margins tbody tr');
  assert.ok(await page.locator('#demo-banner').isHidden()); ok('inside Zoho: no demo banner');
  assert.strictEqual(await page.locator('#t-margins tbody tr').count(), expect.filled);
  await page.click('#refresh'); await page.waitForTimeout(100);
  await page.click('#t-margins tbody tr:first-child td:first-child'); await page.click('.jpk-dr a[data-open=Contracts]');
  await page.keyboard.press('Escape');
  await page.click('#tabs [data-id=waiting]'); await page.click('#t-waiting a[data-open=Contracts] >> nth=0');
  await page.click('#tabs [data-id=customers]'); await page.click('#t-customers tbody tr:first-child td:first-child'); await page.click('.jpk-dr a[data-open=Accounts]');
  const calls = await page.evaluate(() => window.__calls);
  const bad = calls.filter((c) => !ALLOWED.includes(c.path)); assert.deepStrictEqual(bad, [], 'unexpected non-read calls: ' + JSON.stringify(bad));
  const coql = calls.filter((c) => c.path === 'CRM.API.coql'); assert.ok(coql.length >= 2);
  assert.ok(coql.every((c) => /^select /.test(c.args[0].select_query) && / where Row_Type = 'Contract rate'/.test(c.args[0].select_query)), 'every query has a WHERE and is a select');
  assert.ok(coql.every((c) => !/count\(|group by/i.test(c.args[0].select_query))); ok('only read calls: ' + [...new Set(calls.map((c) => c.path))].join(', '));
  const opens = calls.filter((c) => c.path === 'CRM.UI.Record.open').map((c) => c.args[0]);
  assert.ok(opens.some((o) => o.Entity === 'Contracts' && o.RecordID) && opens.some((o) => o.Entity === 'Accounts')); ok('links use ZOHO.CRM.UI.Record.open({Entity, RecordID})');
  await page.close();

  /* field read fails: fall back to the smaller select and say so in the footer */
  page = await newPage({ viewport: { width: 1440, height: 1000 } }, fakeZoho(raw, true));
  await page.goto(PAGE); await page.waitForSelector('#t-margins tbody tr');
  assert.ok((await txt(page, '#foot')).includes('Some detail fields could not be read')); const qs = (await page.evaluate(() => window.__calls)).filter((c) => c.path === 'CRM.API.coql').map((c) => c.args[0].select_query);
  assert.ok(qs.length >= 2 && !/Margin_Notes/.test(qs[qs.length - 1])); ok('fallback to a smaller select with a footer note');
  await page.close();

  /* outside Zoho without ?demo=1 also shows demo */
  page = await newPage({ viewport: { width: 1440, height: 900 } }); await page.goto(PAGE); await page.waitForSelector('#t-margins tbody tr'); assert.ok(await page.locator('#demo-banner').isVisible()); ok('outside Zoho shows demo data'); await page.close();

  assert.deepStrictEqual(errsAll, [], 'console errors: ' + errsAll.join(' | ')); ok('no console or page errors');
  await browser.close();
  console.log('\n' + n + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
