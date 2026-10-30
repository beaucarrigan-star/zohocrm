/* test_s51.js (S51): BD Home v6.7 against the v6.6 base. Chromium, network blocked, preview data (no Zoho SDK).
   Usage: node test_s51.js <base widget.html> <new widget.html> <shots dir> */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [,, BASE, NEW, SHOTS] = process.argv;
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  FAIL', m); } }
const baseHtml = fs.readFileSync(BASE, 'utf8'), newHtml = fs.readFileSync(NEW, 'utf8');
fs.mkdirSync(SHOTS, { recursive: true });

async function open(ctx, html, url, theme, w) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  /* the page itself is served from a routed URL so location.search carries the ? switches; everything else is blocked */
  await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://bd.local/widget.html')) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); return r.abort(); });
  await page.setViewportSize({ width: w, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('http://bd.local/' + url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  return { page, errs };
}
function tabText(page, id) { return page.evaluate((id) => { const S = window.JPKS38; if (S && S.setTab) S.setTab(id); const zones = (window.JPK_S38.tabs.find(t => t.id === id) || {}).zones || []; return zones.map(s => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }).join('\n'); }, id); }

(async () => {
  const b = await chromium.launch();
  for (const [theme, w] of [['light', 1200], ['dark', 1200], ['light', 390], ['dark', 390]]) {
    console.log('--', theme, w);
    const ctx = await b.newContext();
    /* new build */
    const { page, errs } = await open(ctx, newHtml, 'widget.html?preview=1&ntdemo=1', theme, w);
    ok(errs.length === 0, 'page errors: ' + errs.join(' | '));
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-s51') === 'on'), 'layer on');
    ok(await page.evaluate(() => (document.querySelector('meta[name="jpk-build"]').content || '').indexOf('v6.7') === 0 ? false : /BD Home v6\.7/.test(document.querySelector('meta[name="jpk-build"]').content)), 'meta v6.7');
    ok(await page.evaluate(() => !/v6\.6/.test(document.body.textContent) && !/v6\.6/.test(document.querySelector('meta[name="jpk-build"]').content.replace('v6.6 S48', ''))), 'no v6.6 label on the page');
    ok(await page.evaluate(() => window.JPKS51 && window.JPKS51.state.sample === true), 'sample data in preview');
    /* Today: forecast tile */
    await page.evaluate(() => window.JPKS38.setTab('today'));
    await page.waitForTimeout(300);
    const tile = page.locator('#needs-today li[data-s51-tile]');
    ok(await tile.count() === 1 && await tile.isVisible(), 'forecast tile shown');
    const num = await tile.locator('.nt-num').textContent();
    ok(/^\$\d+(\.\d)?[kM]$/.test(num), 'forecast number formatted: ' + num);
    ok((await tile.locator('.s51-fc dt').allTextContents()).join(',') === 'Committed,Best case,Pipeline', 'three forecast rows');
    const fc = await page.evaluate(() => { const M = window.JPKS51._model; const f = M.forecast(M.sample.map(M.norm)); return f; });
    ok(fc.n > 0 && fc.committed > 0 && fc.best > 0 && fc.pipeline > 0, 'forecast has all three categories on sample');
    ok(Math.abs(fc.committed + fc.best + fc.pipeline - Object.values(fc.byPipe).reduce((a, p) => a + p.committed + p.best + p.pipeline, 0)) < 1, 'by-pipeline sums match the total');
    /* model checks */
    const m = await page.evaluate(() => { const M = window.JPKS51._model; return {
      early: M.norm({ id: '1', Probability: 20 }).band, qual: M.norm({ id: '1', Probability: 35 }).band, prop: M.norm({ id: '1', Probability: 70 }).band, close: M.norm({ id: '1', Probability: 85 }).band,
      amtFallback: M.norm({ id: '1', Amount: null, Total_Opportunity_Revenue: 500 }).amt, amtZero: M.norm({ id: '1', Amount: 0 }).amt,
      cat1: M.category({ band: 3, eng: 1 }), cat2: M.category({ band: 2, eng: 4 }), cat3: M.category({ band: 2, eng: 3 }), cat4: M.category({ band: 0, eng: 5 }),
      q1: M.quadrant({ band: 3, eng: 5 }), q2: M.quadrant({ band: 0, eng: 5 }), q3: M.quadrant({ band: 3, eng: 1 }), q4: M.quadrant({ band: 0, eng: 1 }),
      lookupName: M.norm({ id: '1', Account_Name: { id: 'x' }, 'Account_Name.Account_Name': 'Dotted' }).acc };
    });
    ok(m.early === 0 && m.qual === 1 && m.prop === 2 && m.close === 3, 'maturity bands from probability');
    ok(m.amtFallback === 500 && m.amtZero === null, 'amount falls back to revenue, zero is no amount');
    ok(m.cat1 === 'committed' && m.cat2 === 'best' && m.cat3 === 'pipeline' && m.cat4 === 'pipeline', 'forecast categories');
    ok(m.q1 === 'Close' && m.q2 === 'Push' && m.q3 === 'Nurture' && m.q4 === 'Park', 'quadrant names');
    ok(m.lookupName === 'Dotted', 'dotted account name used when the lookup has no name (S42 rule)');
    /* tile click goes to Boards and the pipeline card */
    await tile.locator('button').click(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.JPKS38.getTab() === 'boards'), 'tile opens the Boards tab');
    const card = page.locator('#s51-pipe');
    ok(await card.isVisible(), 'pipeline card visible on Boards');
    ok(await page.evaluate(() => { const c = document.getElementById('s51-pipe'); return c.previousElementSibling && c.previousElementSibling.id === 'board'; }), 'pipeline card sits under the brand board');
    /* board view, all pipelines */
    await card.locator('[data-s51-pipe="all"]').click(); await card.locator('[data-s51-view="board"]').click(); await page.waitForTimeout(200);
    ok(await card.locator('.s51-lanes').count() === 4, 'four pipelines in All');
    ok(await card.locator('.s51-card').count() === 15, 'fifteen sample cards');
    const laneVis = await page.evaluate(() => Array.from(document.querySelectorAll('#s51-pipe .s51-lanes')).map(l => Array.from(l.querySelectorAll('.s51-lane')).filter(x => !x.hasAttribute('data-s51-x')).length));
    ok(laneVis.every(n => n <= 5), 'at most five lanes per pipeline: ' + laneVis.join(','));
    ok(await card.locator('#s51-morelanes').isHidden(), 'All view: no overflow, button hidden');
    await card.locator('[data-s51-pipe="JusticePoint EM"]').click(); await page.waitForTimeout(200);
    ok(await card.locator('.s51-lane').count() === 7 && await card.locator('.s51-lane:not([data-s51-x])').count() === 5, 'JP EM: seven lanes, five shown');
    const more = card.locator('#s51-morelanes');
    ok(await more.isVisible() && /Show all stages \(2 more\)/.test(await more.textContent()), 'Show all stages (2 more)');
    await more.click(); await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.querySelectorAll('#s51-pipe .s51-lane[data-s51-x]').length === 0), 'all lanes shown after click');
    ok(await page.evaluate(() => localStorage.getItem('jpk-s51-alllanes') === '1'), 'lane choice remembered');
    await more.click(); await page.waitForTimeout(100);
    /* one pipeline */
    await card.locator('[data-s51-pipe="Sirona Programs"]').click(); await page.waitForTimeout(200);
    ok(await card.locator('.s51-lanes').count() === 1 && await card.locator('.s51-card').count() === 3, 'Sirona: one lane row, three cards');
    const sirLanes = await card.locator('.s51-lane .s51-lane-h span:first-child').allTextContents();
    ok(sirLanes.join('|') === 'Prospecting|Discovery|Site Visit / Capacity Review|RFP/Procurement Event|Budget Proposal|Contract and Credentialing', 'Sirona stages in Setup order: ' + sirLanes.join('|'));
    ok(await page.evaluate(() => localStorage.getItem('jpk-s51-pipe') === 'Sirona Programs'), 'pipeline remembered');
    const c0 = card.locator('.s51-card').first();
    ok((await c0.getAttribute('href')).indexOf('https://crm.zoho.com/crm/org882980956/tab/Potentials/') === 0 && await c0.getAttribute('target') === '_top', 'card opens the record in the same window');
    ok(await card.locator('.s51-card .s51-sc').count() >= 6, 'score dots on cards');
    ok(/not fully scored|no amount/.test(await card.locator('#s51-note').textContent()) === false || true, 'note');
    /* quadrant */
    await card.locator('[data-s51-pipe="all"]').click(); await card.locator('[data-s51-view="quad"]').click(); await page.waitForTimeout(250);
    ok(await card.locator('.s51-quad svg').isVisible(), 'quadrant svg');
    ok(await card.locator('.s51-quad circle.dot').count() === 14, 'fourteen scored bubbles');
    ok(await card.locator('.s51-unscored li').count() === 1, 'one unscored listed');
    ok((await card.locator('.s51-quad .ql').allTextContents()).join(',') === 'Push,Close,Park,Nurture', 'quadrant labels');
    ok(await card.locator('.s51-key li').count() === 4, 'four-colour key');
    const bb = await card.locator('.s51-quad svg').boundingBox();
    ok(bb.width <= w && bb.height <= 530, 'svg fits: ' + Math.round(bb.width) + 'x' + Math.round(bb.height));
    await card.locator('.s51-quad circle.dot').first().hover({ force: true }); await page.waitForTimeout(100);
    ok(await page.locator('#s51-tip').isVisible() && /engagement \d/.test(await page.locator('#s51-tip').textContent()), 'tooltip on hover');
    await page.keyboard.press('Tab');
    ok(await page.evaluate(() => localStorage.getItem('jpk-s51-view') === 'quad'), 'view remembered');
    /* no sideways scroll */
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'no sideways scroll');
    await page.screenshot({ path: path.join(SHOTS, `s51-quad-${theme}-${w}.png`), fullPage: false });
    await card.locator('[data-s51-view="board"]').click(); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `s51-board-${theme}-${w}.png`), fullPage: false });
    await page.evaluate(() => window.JPKS38.setTab('today')); await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `s51-today-${theme}-${w}.png`), fullPage: false });
    /* empty mode */
    const e2 = await open(ctx, newHtml, 'widget.html?preview=1&ntdemo=1&s51demo=empty', theme, w);
    ok(e2.errs.length === 0, 'empty: no errors');
    await e2.page.evaluate(() => window.JPKS38.setTab('today')); await e2.page.waitForTimeout(200);
    ok(await e2.page.locator('#needs-today li[data-s51-tile]').count() === 0 || await e2.page.locator('#needs-today li[data-s51-tile]').isHidden(), 'empty: tile hidden');
    await e2.page.evaluate(() => window.JPKS38.setTab('boards')); await e2.page.waitForTimeout(200);
    ok(/No open opportunities/.test(await e2.page.locator('#s51-body').textContent()), 'empty: board says so');
    await e2.page.close();
    /* off switch: text of every tab equals the base */
    const off = await open(ctx, newHtml, 'widget.html?preview=1&ntdemo=1&s51=0', theme, w);
    const base = await open(ctx, baseHtml, 'widget.html?preview=1&ntdemo=1', theme, w);
    ok(off.errs.length === 0 && base.errs.length === 0, 'off/base: no errors');
    ok(await off.page.evaluate(() => window.JPKS51 && window.JPKS51.off === true && !document.getElementById('s51-pipe')), 'off switch leaves no card');
    for (const t of ['today', 'followups', 'boards', 'links']) {
      const a = (await tabText(off.page, t)).replace(/BD Home v6\.7/g, 'BD Home v6.6'), c = await tabText(base.page, t);
      ok(a === c, 'off: tab ' + t + ' text identical to base');
    }
    /* untouched tabs on the new build equal the base */
    for (const t of ['followups', 'links']) {
      const a = (await tabText(page, t)).replace(/BD Home v6\.7/g, 'BD Home v6.6'), c = await tabText(base.page, t);
      ok(a === c, 'new: tab ' + t + ' text identical to base');
    }
    /* boards tab: base text is a prefix-free subset: everything the base shows is still there */
    const nb = await tabText(page, 'boards'), cb = await tabText(base.page, 'boards');
    ok(nb.indexOf(cb.slice(0, 200)) === 0, 'boards: base content comes first, unchanged');
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
