// S46 test: Processes v3.1.3 (demo mode, no Zoho SDK) vs v3.1.2.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = __dirname;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; } else { fail++; console.log('FAIL', msg); } }

async function run(build, label) {
  const browser = await chromium.launch();
  const results = {};
  for (const scheme of ['light', 'dark']) {
    for (const w of [1200, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
      await page.goto('file://' + path.join(ROOT, build, 'app', 'processes.html'));
      await page.waitForTimeout(1200);
      const text = await page.evaluate(() => document.body.innerText);
      const sw = await page.evaluate(() => window.RECORDS_SWITCH);
      const scrollX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const meta = await page.evaluate(() => (document.querySelector('meta[name=jpk-build]') || {}).content);
      // the section switcher labels
      const labels = await page.evaluate(() => Array.from(document.querySelectorAll('button,a,[role=tab]')).map(e => e.innerText.trim()).filter(Boolean));
      const key = scheme + '@' + w;
      results[key] = { errs, text, sw, scrollX, meta, labels };
      ok(errs.length === 0, `${label} ${key}: page errors ${JSON.stringify(errs).slice(0, 300)}`);
      ok(!scrollX, `${label} ${key}: sideways scroll`);
      await page.screenshot({ path: path.join(ROOT, `shot-${label}-${scheme}-${w}.png`), fullPage: false });
      await ctx.close();
    }
  }
  await browser.close();
  return results;
}

(async () => {
  const oldR = await run('old', 'v3.1.2');
  const newR = await run('new', 'v3.1.3');
  for (const k of Object.keys(newR)) {
    const n = newR[k], o = oldR[k];
    ok(n.sw.indexOf('contract_ingest') === -1, `${k}: contract_ingest still in RECORDS_SWITCH`);
    ok(n.sw.length === o.sw.length - 1, `${k}: switch length ${n.sw.length} vs old ${o.sw.length}`);
    ok(/v3\.1\.3/.test(n.meta), `${k}: jpk-build meta ${n.meta}`);
    ok(n.labels.indexOf('Ingest') === -1, `${k}: an "Ingest" control is still on the page: ${n.labels.join('|').slice(0, 300)}`);
    ok(n.labels.indexOf('Pipeline') >= 0 || /Pipeline/.test(n.text), `${k}: Pipeline sub-tab missing`);
    ok(/Days left/.test(n.text) === /Days left/.test(o.text), `${k}: Days left presence differs from v3.1.2`);
    ok(!/Upload new packets|Packets are uploaded/.test(n.text), `${k}: old ingest wording still present`);
    ok(/Terms come from Contractbook/.test(n.text), `${k}: new sub text missing`);
    // Everything else on the page reads the same apart from the known wording changes
    const norm = s => s.replace(/\s+/g, ' ').trim();
    const oldN = norm(o.text).split('Contract ingest').join('Contracts')
      .replace('Where each contract is in ingest, cleanup and reconciliation. Upload new packets under Ingest.', 'Where each contract is in review, cleanup and reconciliation. Terms come from Contractbook.')
      .replace('Read only. Reconciliation compares each contract with the billing system. Packets are uploaded under Ingest.', 'Read only. Reconciliation compares each contract with the billing system.')
      .replace('contract ingest and review', 'contract pipeline and review')
      .replace('Pipeline Ingest BILLING', 'Pipeline BILLING').replace('Pipeline Ingest Run', 'Pipeline Run');
    const newN = norm(n.text);
    ok(oldN === newN || oldN.replace(/ +/g, ' ') === newN.replace(/ +/g, ' '), `${k}: page text differs beyond the planned edits`);
    if (oldN !== newN) {
      // show the first difference for the log
      let i = 0; while (i < oldN.length && oldN[i] === newN[i]) i++;
      console.log(`  diff at ${i}: old "...${oldN.slice(Math.max(0, i - 40), i + 60)}" new "...${newN.slice(Math.max(0, i - 40), i + 60)}"`);
    }
  }
  // Open-on-a-section still works for a kept section and ignores the removed one
  const browser = await chromium.launch();
  for (const sec of ['billing_findings', 'contract_ingest']) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript((s) => { window.localStorage.clear(); window.localStorage.setItem('jpk.processes.section', s); }, sec);
    await page.goto('file://' + path.join(ROOT, 'new', 'app', 'processes.html'));
    await page.waitForTimeout(1200);
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    const text = await page.evaluate(() => document.body.innerText);
    ok(errs.length === 0, `remembered ${sec}: errors`);
    ok(text.length > 200, `remembered ${sec}: page rendered`);
    await ctx.close();
  }
  await browser.close();
  console.log(`S46 test: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
