// S48 calendar test (preview data, network blocked). Run: node test_s48.js <widget.html> <label> <shotdir> [voice]
const { chromium } = require('playwright');
const [file, label, shots, voice] = process.argv.slice(2);
let pass = 0, fail = 0, nowSeen = 0;
function check(n, ok, x) { if (ok) { pass++; } else { fail++; console.log('FAIL ' + label + ': ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); } }
const pad = n => (n < 10 ? '0' : '') + n;
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
async function openForm(page) {
  await page.evaluate(() => { const a = document.querySelector('.jpk-cal-add'); if (a) a.click(); });
  try { await page.waitForSelector('form.jpk-mo-form:not([hidden])', { timeout: 4000 }); return true; } catch (e) {}
  await page.evaluate(() => { const m = document.querySelector('.jpk-mo-open'); if (m) m.click(); }); await page.waitForTimeout(800);
  await page.evaluate(() => { const n = document.querySelector('[data-jpk-mx="new"]'); if (n) n.click(); });
  try { await page.waitForSelector('form.jpk-mo-form:not([hidden])', { timeout: 4000 }); return true; } catch (e) { return false; }
}
const v = (page, n) => page.evaluate(n => document.querySelector('form.jpk-mo-form [name="' + n + '"]').value, n);
const btxt = (page, n) => page.evaluate(n => { const i = document.querySelector('form.jpk-mo-form [name="' + n + '"]'); return i.parentNode.querySelector('.s48-pick .s48-v').textContent; }, n);
(async () => {
  const b = await chromium.launch();
  async function run(q, w, scheme, fn) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await page.goto('file://' + file + '?preview=1' + (q ? '&' + q : '')); await page.waitForTimeout(2500);
    await fn(page); check('no page errors (' + w + ' ' + scheme + (q ? ' ' + q : '') + ')', errs.length === 0, errs); await ctx.close();
  }
  for (const [w, scheme] of [[1040, 'light'], [1280, 'dark'], [390, 'light']]) {
    await run('', w, scheme, async page => {
      await page.evaluate(() => { const c = document.querySelector('[aria-controls="jpk-cal-body"]'); const bd = document.querySelector('.jpk-cal-body'); if (c && bd && bd.hidden) c.click(); }); await page.waitForTimeout(600);
      await page.evaluate(() => { const x = document.querySelector('.jpk-showweek'); if (x && x.getAttribute('aria-expanded') !== 'true') x.click(); }); await page.waitForTimeout(600);
      // day range popover: picking Start and End keeps it open, Save applies
      if (await page.locator('.s32-gear').first().isVisible().catch(() => false)) {
        await page.locator('.s32-gear').first().click();
        await page.locator('#s32-hs').click(); await page.waitForTimeout(200);
        check('range popover stays open on Start click', await page.locator('.s32-pop').count() === 1);
        await page.locator('#s32-hs').selectOption('8'); await page.locator('#s32-he').click(); await page.locator('#s32-he').selectOption('17'); await page.waitForTimeout(200);
        check('range popover stays open on End click', await page.locator('.s32-pop').count() === 1);
        await page.locator('.s32-pop [data-s32="save"]').click(); await page.waitForTimeout(400);
        check('range saved 8 AM to 5 PM', /8 AM to 5 PM/.test(await page.locator('.s32-gear').first().textContent()), await page.locator('.s32-gear').first().textContent());
        await page.locator('.s32-gear').first().click(); await page.locator('.s32-pop [data-s32="reset"]').click(); await page.waitForTimeout(300);
        check('reset back to 7 AM to 6 PM', /7 AM to 6 PM/.test(await page.locator('.s32-gear').first().textContent()));
      } else check('range button visible', false);
      const tl = await page.evaluate(() => { const sc = document.querySelector('.s32-scroll'); if (!sc) return null; const r = sc.getBoundingClientRect();
        const labs = [...sc.querySelectorAll('.s32-hr span, .s32-now b')].filter(x => x.getClientRects().length);
        return { n: labs.length, now: !!sc.querySelector('.s32-now b'), bad: labs.filter(x => { const q = x.getBoundingClientRect(); return q.left < r.left - 0.5 || x.scrollWidth > x.clientWidth + 1; }).map(x => x.textContent) }; });
      if (tl) { check('timeline labels found', tl.n > 0, tl); check('no timeline time cut off', tl.bad.length === 0, tl.bad); }
      if (tl && tl.now) nowSeen++;
      const ok = await openForm(page); check('form opens ' + w, ok); if (!ok) return;
      check('three pickers', await page.locator('form .s48-pick').count() === 3);
      check('native inputs hidden', await page.evaluate(() => ['d', 's', 'e'].every(n => { const r = document.querySelector('form.jpk-mo-form [name="' + n + '"]').getBoundingClientRect(); return r.width <= 1 && r.height <= 1; })));
      check('date button shows the day', /\d{4}/.test(await btxt(page, 'd')), await btxt(page, 'd'));
      // nothing cut off in the form: every picker shows its whole value
      check('picker values not cut', await page.evaluate(() => [...document.querySelectorAll('form .s48-pick .s48-v')].every(x => x.scrollWidth <= x.clientWidth + 1)),
        await page.evaluate(() => [...document.querySelectorAll('form .s48-pick .s48-v')].map(x => [x.textContent, x.scrollWidth, x.clientWidth])));
      check('meeting type not cut', await page.evaluate(() => { const s = document.querySelector('form [name="mv"]'); return s.getBoundingClientRect().width >= 160; }));
      // Starts: click anywhere on the box
      const sb = page.locator('form .s48-pick').nth(1); const bx = await sb.boundingBox();
      await page.mouse.click(bx.x + bx.width - 30, bx.y + bx.height / 2);
      check('start list opens', await page.locator('form .s48-ptime:not([hidden])').count() === 1);
      if (w === 1040) await page.screenshot({ path: shots + '/' + label + '-start-list.png' });
      await page.locator('form .s48-opt[data-s48-t="840"]').click();
      check('start 2:00 PM', await v(page, 's') === '14:00', await v(page, 's'));
      check('end follows (30 min)', await v(page, 'e') === '14:30', await v(page, 'e'));
      check('list closed after pick', await page.locator('form .s48-ptime:not([hidden])').count() === 0);
      check('button reads 2:00 PM', await btxt(page, 's') === '2:00 PM', await btxt(page, 's'));
      check('30 min chip pressed', await page.locator('form .s48-chip[data-s48-len="30"][aria-pressed="true"]').count() === 1);
      await page.locator('form .s48-chip[data-s48-len="60"]').click();
      check('1 hr chip sets end 3:00 PM', await v(page, 'e') === '15:00', await v(page, 'e'));
      check('1 hr chip pressed', await page.locator('form .s48-chip[data-s48-len="60"][aria-pressed="true"]').count() === 1);
      // Ends list starts after the start and shows lengths
      await page.locator('form .s48-pick').nth(2).click();
      const first = await page.locator('form .s48-ptime .s48-opt').first().textContent();
      check('end list starts 15 min after start', /^2:15 PM/.test(first) && /15 min/.test(first), first);
      if (w === 1040) await page.screenshot({ path: shots + '/' + label + '-end-list.png' });
      await page.locator('form .s48-opt[data-s48-t="960"]').click();
      check('end 4:00 PM', await v(page, 'e') === '16:00', await v(page, 'e'));
      check('2 hr chip pressed', await page.locator('form .s48-chip[data-s48-len="120"][aria-pressed="true"]').count() === 1);
      // moving the start keeps the 2 hr length (the page's own rule)
      await page.locator('form .s48-pick').nth(1).click(); await page.locator('form .s48-opt[data-s48-t="600"]').click();
      check('start 10 keeps 2 hr: end 12:00', await v(page, 'e') === '12:00', await v(page, 'e'));
      // Date
      await page.locator('form .s48-pick').nth(0).click();
      check('date panel opens', await page.locator('form .s48-pdate:not([hidden])').count() === 1);
      if (w === 1040) await page.screenshot({ path: shots + '/' + label + '-date.png' });
      const tm = new Date(); tm.setDate(tm.getDate() + 1);
      await page.locator('form .s48-pdate .s48-chip:has-text("Tomorrow")').click();
      check('Tomorrow sets the date', await v(page, 'd') === ymd(tm), await v(page, 'd'));
      await page.locator('form .s48-pick').nth(0).click();
      await page.locator('form .s48-dnav[data-s48-dm="1"]').click();
      const nm = new Date(tm.getFullYear(), tm.getMonth() + 1, 15);
      await page.locator('form .s48-day[data-s48-day="' + ymd(nm) + '"]').click();
      check('next month, the 15th', await v(page, 'd') === ymd(nm), await v(page, 'd'));
      // keyboard: Esc closes only the picker, then the form
      await page.locator('form .s48-pick').nth(1).focus(); await page.keyboard.press('ArrowDown');
      check('ArrowDown opens the list', await page.locator('form .s48-ptime:not([hidden])').count() === 1);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      check('arrow + Enter picks 10:15', await v(page, 's') === '10:15', await v(page, 's'));
      check('focus back on Starts', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('s48-pick')));
      await page.locator('form .s48-pick').nth(0).click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      const nm1 = new Date(nm.getFullYear(), nm.getMonth(), 16);
      check('date arrows + Enter', await v(page, 'd') === ymd(nm1), await v(page, 'd'));
      await page.locator('form .s48-pick').nth(2).click(); await page.keyboard.press('Escape');
      check('Esc closes the list', await page.locator('form .s48-ptime:not([hidden])').count() === 0);
      check('form still open after one Esc', await page.locator('form.jpk-mo-form:not([hidden])').count() === 1);
      // a click outside closes an open picker
      await page.locator('form .s48-pick').nth(1).click(); await page.locator('form [name="t"]').click();
      check('click outside closes', await page.locator('form .s48-ptime:not([hidden])').count() === 0);
      // All day hides the times, chips and list
      await page.locator('form [name="ad"]').check();
      check('all day hides Starts/Ends', !(await page.locator('form .s48-chips').isVisible()) && !(await page.locator('form .s48-pick').nth(1).isVisible()));
      await page.locator('form [name="ad"]').uncheck();
      // save: no title -> error; with title it saves (preview writes nothing)
      await page.locator('form button[type="submit"]').click();
      check('no title -> error', /title/i.test(await page.locator('form .jpk-mo-ferr').textContent()));
      await page.locator('form [name="t"]').fill('S48 TEST');
      await page.locator('form button[type="submit"]').click(); await page.waitForTimeout(1200);
      check('saves and closes the form', await page.locator('form.jpk-mo-form:not([hidden])').count() === 0);
      check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      // month pills: time on its own line, never cut, weekends too
      if (w >= 641) {
        await page.evaluate(() => { const t = document.querySelector('[data-jpk-mx="today"]'); if (t && !t.disabled) t.click(); }); await page.waitForTimeout(600);
        const r = await page.evaluate(() => [...document.querySelectorAll('.jpk-mo-ev .jpk-mo-et')].map(t => ({ disp: getComputedStyle(t).display, cut: t.scrollWidth > t.clientWidth + 1, wk: !!t.closest('.jpk-mo-wk'), txt: t.textContent })));
        check('month has pills', r.length > 0);
        check('every time on its own line', r.every(x => x.disp === 'block'), r.filter(x => x.disp !== 'block'));
        check('no time cut', r.every(x => !x.cut), r.filter(x => x.cut));
        check('weekend pills show the time', r.filter(x => x.wk).length > 0);
        await page.screenshot({ path: shots + '/' + label + '-month-' + w + '-' + scheme + '.png' });
      }
    });
  }
  if (voice) await run('', 1280, 'light', async page => {
    await openForm(page);
    const q = page.locator('form .jpk-vq-in');
    await q.fill('Teams meeting with Riley at 3 PM on Friday October 30th 2026 for 30 minutes about pricing'); await q.press('Enter'); await page.waitForTimeout(2500);
    check('voice fill: start value', await v(page, 's') === '15:00', await v(page, 's'));
    check('voice fill: Starts button repaints', await btxt(page, 's') === '3:00 PM', await btxt(page, 's'));
    check('voice fill: Ends button repaints', await btxt(page, 'e') === '3:30 PM', await btxt(page, 'e'));
    check('voice fill: Date button repaints', /Oct 30, 2026/.test(await btxt(page, 'd')), await btxt(page, 'd'));
  });
  await run('s48=0', 1040, 'light', async page => {
    await openForm(page);
    check('?s48=0: no pickers', await page.locator('form .s48-pick').count() === 0);
    check('?s48=0: native time inputs visible', await page.locator('form [name="s"]').isVisible());
  });
  if (!process.env.NO_NOW) check('the now line was on screen at least once', nowSeen > 0);
  await b.close();
  console.log(label + ': ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
