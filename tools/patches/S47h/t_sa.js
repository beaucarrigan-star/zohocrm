const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const scheme of ['light','dark']) for (const w of [1200, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.goto('file://' + process.cwd() + '/b/sa/app/stock.html'); await p.waitForTimeout(800);
  // open first draft in Needs approval
  const row = p.locator('#tbl tr, #tbl [data-id], #tbl .row').filter({ hasText: /@|people|person/ }).first();
  const cnt = await p.locator('#tbl button, #tbl a, #tbl tr').count();
  const clickable = p.locator('#tbl [data-open], #tbl tbody tr').first();
  await clickable.click(); await p.waitForTimeout(500);
  const picker = await p.locator('.jr').count();
  const chips0 = await p.locator('.jr-chip').count();
  const to0 = await p.$eval('#d-to', e => e.value);
  await p.locator('.jr-in').click(); await p.waitForTimeout(200);
  const opts = await p.locator('.jr-o').allTextContents();
  await p.locator('.jr-o', { hasText: 'Demo User' }).click();
  await p.locator('.jr-in').fill('someone@new.example'); await p.keyboard.press('Enter');
  const to1 = await p.$eval('#d-to', e => e.value);
  const note = await p.textContent('#d-note');
  await p.locator('.jr-chip button').first().click();
  const to2 = await p.$eval('#d-to', e => e.value);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await p.screenshot({ path: `sa-${scheme}-${w}.png` });
  console.log(scheme, w, { cnt, picker, chips0, to0, opts, to1, note, to2, sideways: sw });
  await p.close(); }
  console.log('errors', errs); await b.close();
})();
