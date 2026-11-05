/* node tests/cs-home-check.js - Beau CS Home v6.16.0 in demo mode (python -m http.server 8777 in S76-rates/out, out/cs = the build):
   "Rates to fill: N" appears in Needs you today at 1200/390 px, light/dark, with no new page errors and no sideways scroll; ?s76=0 removes it.
   Outside Zoho the page never gets its agenda data (v6.15.2 shows "Loading your list." too), so the test stands in an empty agenda. */
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'playwright'));
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');
(async () => {
  const b = await chromium.launch({ executablePath: EXE }); let fails = 0;
  for (const [scheme, w, q] of [['light', 1200, ''], ['light', 390, ''], ['dark', 1200, ''], ['dark', 390, ''], ['light', 1200, '&s76=0']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://127.0.0.1:8777/cs/app/widget.html?demo=1' + q); await p.waitForTimeout(8000);
    const r = await p.evaluate(() => { window.__bd = window.__bd || {}; window.__bd.AG = { data: { items: [], errors: [] } }; window.JPKShell.needs.render();
      return { rows: [...document.querySelectorAll('.jpk-nt-row')].map(li => li.innerText.replace(/\s+/g, ' ')), sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }; });
    const own = errs.filter(e => !/Parentwindow reference not found/.test(e));   /* the Zoho SDK outside Zoho; v6.15.2 throws it too */
    const has = r.rows.some(t => /Rates to fill: \d+ \(\d+ of \d+ units on leg not priced\)/.test(t));
    const ok = (q ? !has : has) && !own.length && !r.sideways; if (!ok) fails++;
    await p.screenshot({ path: path.join(__dirname, '..', 'out', 'cs-' + scheme + '-' + w + (q ? '-off' : '') + '.png') });
    console.log(ok ? 'PASS' : 'FAIL', scheme, w, q || '', JSON.stringify(r.rows), '| own errors', own.length, '| sideways', r.sideways); await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' failed' : 'all CS Home checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
