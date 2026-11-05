/* node tests/demo-check.js  (step 3 done-when) - Playwright, demo mode (no Zoho):
   Processes > Rates to fill in light and dark at 1200 and 390 px: 0 page errors, no sideways scroll, Part A and Part B render,
   a demo "write" changes nothing and sends no network request to Zoho. Also the Leadership tile (?demo=1) renders from rates-model.
   Needs: python -m http.server 8777 in S76-rates/out (demo/ = unzipped Processes v3.5.0, lead/ = Leadership v47.11.0). */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'playwright'));
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');
const BASE = 'http://127.0.0.1:8777';
(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  let fails = 0; const shots = [];
  for (const scheme of ['light', 'dark']) for (const width of [1200, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage(); const errors = [], zoho = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/zoho(apis)?\.com/.test(r.url()) && !/zwidgets/.test(r.url())) zoho.push(r.url()); });
    await page.goto(BASE + '/demo/app/processes.html', { waitUntil: 'load' });
    await page.waitForSelector('[data-m="p_rates"]', { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const b = document.querySelector('[data-m="p_rates"]'); if (b) b.click(); });
    await page.waitForSelector('.rt h2#rt-b', { timeout: 8000 });
    const info = await page.evaluate(() => ({
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      strip: (document.querySelector('.rt-big b') || {}).textContent, partB: document.querySelectorAll('tr[data-b]').length, partA: document.querySelectorAll('tr[data-a]').length,
      statuses: [...document.querySelectorAll('tr[data-b] td:last-child')].map(td => td.textContent.trim()) }));
    // all rows, then open a "No customer rate" row... use the first row that offers Add rate
    await page.click('[data-f="all"]');
    const idx = await page.evaluate(() => { const rows = [...document.querySelectorAll('tr[data-b]')]; const r = rows.find(tr => /Priced/.test(tr.textContent)); return r ? r.getAttribute('data-b') : null; });
    let demoMsg = '';
    if (idx != null) {
      await page.click('tr[data-b="' + idx + '"]');
      await page.fill('#rt-brate', '9.99'); await page.click('[data-act="add"]');
      await page.waitForSelector('.rt-modal'); await page.click('#rc-ok');
      demoMsg = await page.textContent('.rt-msg');
    }
    const shot = path.join(__dirname, '..', 'out', `rates-${scheme}-${width}.png`); await page.screenshot({ path: shot, fullPage: false }); shots.push(shot);
    const ok = !errors.length && !info.sideways && info.partB > 0 && info.partA > 0 && /^Demo: nothing saved/.test(demoMsg) && !zoho.length;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} Rates ${scheme} ${width}px | errors ${errors.length}${errors.length ? ' ' + errors.join(' / ') : ''} | sideways ${info.sideways} | strip "${info.strip}" | Part B ${info.partB} rows, Part A ${info.partA} | demo save: "${(demoMsg || '').slice(0, 60)}" | zoho requests ${zoho.length}`);
    await ctx.close();
  }
  // Leadership tile in demo mode
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } }); const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/lead/app/widget.html?demo=1', { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const t = await page.evaluate(() => { const rm = !!window.RatesModel; const cards = [...document.querySelectorAll('.s77-stats')].map(x => x.innerText.replace(/\s+/g, ' ')); return { rm, version: rm && window.RatesModel.VERSION, cards }; });
    const ok = !errors.length && t.rm && t.cards.some(c => /units on leg priced both sides/.test(c));
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} Leadership tile demo | RatesModel ${t.version} | ${t.cards.join(' || ').slice(0, 160)} | errors ${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' / ') : ''}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? fails + ' check(s) failed' : 'all demo checks passed', '| screenshots in out/');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
