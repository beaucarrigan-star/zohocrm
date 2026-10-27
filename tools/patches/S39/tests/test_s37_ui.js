// S37 UI test (preview). Run: node test_s37_ui.js <widget.html> <label> <shotdir>
// (copied from ux/home-tiles/tests/test_s37_ui.js; S39 adds one step to open(): on the S38 frame, New meeting sits in the More menu)
const { chromium } = require('playwright');
const file = process.argv[2], label = process.argv[3], shots = process.argv[4];
let pass = 0, fail = 0;
function check(n, ok, x) { if (ok) { pass++; console.log('PASS ' + label + ': ' + n); } else { fail++; console.log('FAIL ' + label + ': ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } }
const FAKE = `(function(){ var mode=(new URLSearchParams(location.search)).get('sr')||'ok';
  function R(){} R.prototype.start=function(){var s=this; setTimeout(function(){
    if(mode==='blocked'){s.onerror&&s.onerror({error:'not-allowed'}); return;}
    var r=[{transcript:'teams meeting with Riley on October 30th 2026 at 10 for an hour about onboarding'}]; r.isFinal=true;
    s.onresult&&s.onresult({results:[r]}); s.onend&&s.onend(); },50);};
  R.prototype.stop=function(){}; window.SpeechRecognition=R; window.webkitSpeechRecognition=R; })();`;
async function open(page) {
  for (const sel of ['text=+ Add meeting', '[data-jpk-pop="calMonthNew"]', 'button:has-text("New meeting")', 'more']) {
    if (sel === 'more') {
      if (!(await page.locator('#s38-more-btn').count())) continue;
      try { await page.click('#s38-more-btn', { timeout: 3000 }); await page.click('#s38-more-list button[data-s38-label="New meeting"]', { timeout: 3000 }); } catch (e) { continue; }
    } else {
      const el = page.locator(sel).first(); if (await el.count()) { try { await el.click({ timeout: 3000 }); } catch (e) { continue; } }
    }
    try { await page.waitForSelector('form .jpk-vq', { timeout: 3000, state: 'visible' }); return true; } catch (e) {}
  }
  return false;
}
const v = (page, n) => page.locator('form [name="' + n + '"]').first().inputValue();
const chips = page => page.locator('form .jpk-mo-ivc .jpk-mo-rn').allTextContents();
(async () => {
  const b = await chromium.launch();
  async function run(q, w, scheme, fn) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e))); await page.addInitScript(FAKE);
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await page.goto('file://' + file + '?preview=1' + (q ? '&' + q : '')); await page.waitForTimeout(2500);
    const ok = await open(page); await fn(page, ok); await ctx.close(); return errs;
  }
  let e = await run('', 1280, 'light', async (page, ok) => {
    check('form opens with the bar', ok);
    check('one bar only', await page.locator('form .jpk-vq').count() === 1);
    check('S36 mics still there', await page.locator('form .jpk-mic').count() === 2);
    const q = page.locator('form .jpk-vq-in');
    await q.fill('Teams meeting with Riley at 3 PM on Friday October 30th 2026 for 30 minutes about pricing');
    await q.press('Enter'); await page.waitForTimeout(2500);
    check('form not submitted by Enter', await page.locator('form .jpk-vq').isVisible());
    check('title', await v(page, 't') === 'Pricing – with Riley', await v(page, 't'));
    check('date', await v(page, 'd') === '2026-10-30', await v(page, 'd'));
    check('start', await v(page, 's') === '15:00', await v(page, 's'));
    check('end', await v(page, 'e') === '15:30', await v(page, 'e'));
    check('meeting type Online', await v(page, 'mv') === 'Online', await v(page, 'mv'));
    check('Teams note shows', /Teams meeting and link/.test(await page.locator('form').first().textContent()));
    check('Riley invited as teammate', JSON.stringify(await chips(page)) === JSON.stringify(['Riley Stone']), await chips(page));
    const msg = await page.locator('form .jpk-vq-msg').textContent();
    check('status lists what was filled', /Filled:/.test(msg) && /invited Riley Stone/.test(msg) && /Add meeting/.test(msg), msg);
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s37-1280-light.png' });
    await q.fill('call with Pat and Zed tomorrow at 9 in the morning'); await q.press('Enter'); await page.waitForTimeout(2500);
    check('contact Pat added', (await chips(page)).includes('Pat Moreno'), await chips(page));
    const m2 = await page.locator('form .jpk-vq-msg').textContent();
    check('unknown person named in status', /No match for .Zed/.test(m2), m2);
    check('start 9:00', await v(page, 's') === '09:00');
    check('end keeps 30 min length', await v(page, 'e') === '09:30', await v(page, 'e'));
    await q.fill('meeting with Sam'); await page.locator('form .jpk-vq-go').click(); await page.waitForTimeout(2000);
    const m3 = await page.locator('form .jpk-vq-msg').textContent();
    check('missing date/time named', /Couldn.t tell the date or time/.test(m3), m3);
  });
  check('no page errors (typed)', e.length === 0, e.slice(0, 3));
  e = await run('sr=ok', 1280, 'dark', async (page) => {
    await page.locator('form .jpk-vq-mic').click(); await page.waitForTimeout(2500);
    check('voice fills title', await v(page, 't') === 'Onboarding – with Riley', await v(page, 't'));
    check('voice fills date and times', await v(page, 'd') === '2026-10-30' && await v(page, 's') === '10:00' && await v(page, 'e') === '11:00');
    check('voice sets Online', await v(page, 'mv') === 'Online');
    check('heard text shown in box', /onboarding/.test(await page.locator('form .jpk-vq-in').inputValue()));
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s37-1280-dark.png' });
  });
  check('no page errors (voice)', e.length === 0, e.slice(0, 3));
  e = await run('sr=blocked', 390, 'light', async (page) => {
    await page.locator('form .jpk-vq-mic').click(); await page.waitForTimeout(400);
    check('blocked mic points to typing', /blocked/.test(await page.locator('form .jpk-vq-msg').textContent()));
    check('no sideways scroll at 390', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s37-390.png' });
  });
  check('no page errors (blocked)', e.length === 0, e.slice(0, 3));
  e = await run('s37=0', 1280, 'light', async (page) => { check('?s37=0 hides the bar', await page.locator('.jpk-vq').count() === 0); });
  check('no page errors (off)', e.length === 0, e.slice(0, 3));
  await b.close(); console.log(label + ': ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
