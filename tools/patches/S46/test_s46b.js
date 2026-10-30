// S46 part 2: Processes v3.2.0 (demo mode). Dates, devices, logo, detail panel.
const { chromium } = require('playwright');
const path = require('path');
const ROOT = __dirname;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const w of [1200, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto('file://' + path.join(ROOT, 'v320', 'app', 'processes.html'));
    await page.waitForTimeout(1200);
    const k = scheme + '@' + w;
    ok(errs.length === 0, `${k}: errors ${JSON.stringify(errs).slice(0, 300)}`);
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), `${k}: sideways page scroll`);
    const logo = await page.evaluate(() => { const i = document.querySelector('.logo img'); return i && i.complete && i.naturalWidth > 0; });
    ok(logo, `${k}: tri-brand logo not rendered`);
    // All contracts lane, then check columns
    await page.click('[data-ln="all"]');
    await page.waitForTimeout(300);
    const heads = await page.evaluate(() => Array.from(document.querySelectorAll('.tw th')).map(e => e.innerText.trim()));
    for (const c of ['Start', 'End (no renewals)', 'After 1 renewal', 'After 2 renewals', 'Days left', 'Devices and pricing']) ok(heads.map(x=>x.toLowerCase()).includes(c.toLowerCase()), `${k}: column ${c} missing: ${heads.join('|')}`);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.tw tbody tr')).map(tr => Array.from(tr.children).map(td => td.innerText.trim())));
    const mar = rows.find(r => r[0].startsWith('Marinette'));
    ok(mar && mar[3] === 'Mar 1, 2024' && mar[4] === 'Dec 31, 2025' && mar[5] === 'Dec 31, 2026' && mar[6] === 'Dec 31, 2027', `${k}: Marinette dates ${JSON.stringify(mar)}`);
    ok(mar && /GPS \$13\.15 · Remote Breath \$12\.30 \(SCRAM\) · CAM \$15\.00 \(SCRAM\)/.test(mar[8]), `${k}: Marinette devices ${mar && mar[8]}`);
    const clark = rows.find(r => r[0].startsWith('Clark'));
    ok(clark && clark[4] === 'Feb 28, 2027' && clark[5] === 'Feb 28, 2028' && clark[6] === 'Feb 28, 2029' && /GPS \$4\.00 \(Allied\)/.test(clark[8]), `${k}: Clark ${JSON.stringify(clark)}`);
    const adams = rows.find(r => r[0].startsWith('Adams'));
    ok(adams && adams[5] === '' && adams[6] === '' && /^CB: GPS \$5\.75/.test(adams[8]), `${k}: Adams (no renewals, Contractbook text) ${JSON.stringify(adams)}`);
    const polk = rows.find(r => r[0].startsWith('Polk'));
    ok(polk && polk[4] === 'Mar 25, 2023' && polk[5] === '' && polk[8] === '', `${k}: Polk ${JSON.stringify(polk)}`);
    // No device pricing lane: Adams (active, no lines) and Clark? Clark has a line. Polk ended -> excluded.
    const lane = await page.evaluate(() => { const b = document.querySelector('[data-ln="nodev"]'); return b && b.innerText; });
    ok(lane && /no device pricing/i.test(lane) && /\b1\b/.test(lane), `${k}: No device pricing lane ${lane}`);
    // Detail panel for Marinette: device table with 4 lines incl. superseded + unreviewed
    const idx = rows.findIndex(r => r[0].startsWith('Marinette'));
    await page.click(`.tw tbody tr[data-i="${idx}"]`);
    await page.waitForTimeout(300);
    const det = await page.evaluate(() => { const d = document.getElementById('det'); return d ? d.innerText : ''; });
    for (const t of ['Start date', 'End date (no renewals)', 'End after 1 renewal', 'End after 2 renewals', 'Final end (all options)', 'Days left to final end', 'Renewals', '2 x 12 mo', 'Terms source', 'Devices and pricing', 'Equipment', 'Manufacturer', 'Rate / day', 'SCRAM Systems', 'Superseded', 'Unreviewed', 'Apr 4, 2024']) ok(det.toLowerCase().includes(t.toLowerCase()), `${k}: detail missing "${t}"`);
    ok(errs.length === 0, `${k}: errors after click ${JSON.stringify(errs).slice(0, 300)}`);
    await page.screenshot({ path: path.join(ROOT, `shot-v3.2.0-${scheme}-${w}.png`), fullPage: w === 390 });
    await ctx.close();
  }
  await browser.close();
  console.log(`S46b test: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
