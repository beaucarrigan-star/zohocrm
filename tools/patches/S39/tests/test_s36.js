// S36 smoke test: mic button in the New meeting form. Run: node test_s36.js <widget.html> <label> <shotdir>
// (copied from ux/home-tiles/tests/test_s36.js; S39 adds one step to openForm: on the S38 frame, New meeting sits in the More menu)
const { chromium } = require('playwright');
const file = process.argv[2], label = process.argv[3] || 'home', shots = process.argv[4];
let pass = 0, fail = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('PASS ' + label + ': ' + name); } else { fail++; console.log('FAIL ' + label + ': ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } }

const FAKE = `
  (function () {
    var mode = (new URLSearchParams(location.search)).get('sr') || 'ok';
    window.__srStarts = 0;
    if (mode === 'none') { try { delete window.webkitSpeechRecognition; } catch (e) {} window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined; return; }
    function R() { this.lang = ''; this.continuous = false; this.interimResults = false; }
    function res(list) { var out = list.map(function (x) { var r = [{ transcript: x[0] }]; r.isFinal = x[1]; return r; }); return { results: out }; }
    R.prototype.start = function () {
      var self = this; window.__srStarts++; window.__srLast = self;
      setTimeout(function () {
        if (mode === 'blocked') { self.onerror && self.onerror({ error: 'not-allowed' }); self.onend && self.onend(); return; }
        if (mode === 'notes') {
          self.onresult && self.onresult(res([['talked about renewal', true]]));
          self.onresult && self.onresult(res([['talked about renewal', true], ['and pricing', false]]));
          self.onresult && self.onresult(res([['talked about renewal', true], ['and pricing', true]]));
          return;
        }
        self.onresult && self.onresult(res([['renewal call', false]]));
        self.onresult && self.onresult(res([['renewal call with polk county.', true]]));
        self.onend && self.onend();
      }, 50);
    };
    R.prototype.stop = function () { var self = this; setTimeout(function () { self.onend && self.onend(); }, 10); };
    R.prototype.abort = R.prototype.stop;
    window.webkitSpeechRecognition = R; window.SpeechRecognition = R;
  })();`;

async function openForm(page) {
  const tries = ['text=+ Add meeting', '[data-jpk-pop="calMonthNew"]', 'button:has-text("New meeting")', 'more'];
  for (const sel of tries) {
    if (sel === 'more') {
      if (!(await page.locator('#s38-more-btn').count())) continue;
      try { await page.click('#s38-more-btn', { timeout: 3000 }); await page.click('#s38-more-list button[data-s38-label="New meeting"]', { timeout: 3000 }); } catch (e) { continue; }
    } else {
      const el = page.locator(sel).first();
      if (await el.count()) { try { await el.click({ timeout: 3000 }); } catch (e) { continue; } }
    }
    try { await page.waitForSelector('form input[name="t"]', { timeout: 3000, state: 'visible' }); return true; } catch (e) {}
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  async function run(query, width, scheme, fn) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await page.addInitScript(FAKE);
    await page.goto('file://' + file + '?preview=1' + (query ? '&' + query : ''));
    await page.waitForTimeout(2500);
    const opened = await openForm(page);
    await fn(page, opened);
    await ctx.close();
    return errs;
  }

  let errs = await run('sr=ok', 1280, 'light', async (page, opened) => {
    check('form opens', opened);
    check('two mic buttons (title, notes)', await page.locator('form .jpk-mic').count() === 2, await page.locator('form .jpk-mic').count());
    check('JPKS36 loaded', await page.evaluate(() => !!(window.JPKS36 && window.JPKS36.version === '1.0.0')));
    const t = page.locator('form input[name="t"]');
    await page.locator('form input[name="t"] ~ .jpk-mic').click();
    await page.waitForTimeout(400);
    check('title filled and tidied', (await t.inputValue()) === 'Renewal call with polk county', await t.inputValue());
    check('form still open after mic click', await page.locator('form input[name="t"]').isVisible());
    check('mic back to off', (await page.locator('form input[name="t"] ~ .jpk-mic').getAttribute('aria-pressed')) === 'false');
    check('status says got it', /Got it/.test(await page.locator('form .jpk-mic-msg').first().textContent()));
    check('nothing saved (preview, no insert)', await page.evaluate(() => !document.querySelector('.jpk-mo-ferr') || !/did not save/i.test(document.querySelector('.jpk-mo-ferr').textContent)));
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s36-1280-light.png' });
  });
  check('no page errors (ok)', errs.length === 0, errs.slice(0, 3));

  errs = await run('sr=notes', 1280, 'dark', async (page) => {
    const n = page.locator('form textarea[name="n"]');
    await n.fill('Agenda:');
    const mic = page.locator('form textarea[name="n"] ~ .jpk-mic');
    await mic.click(); await page.waitForTimeout(300);
    check('notes mic on while listening', (await mic.getAttribute('aria-pressed')) === 'true');
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s36-1280-dark-listening.png' });
    await mic.click(); await page.waitForTimeout(200);
    check('notes appended after existing text', (await n.inputValue()) === 'Agenda: talked about renewal and pricing', await n.inputValue());
    check('notes mic off after second click', (await mic.getAttribute('aria-pressed')) === 'false');
  });
  check('no page errors (notes)', errs.length === 0, errs.slice(0, 3));

  errs = await run('sr=blocked', 390, 'light', async (page) => {
    await page.locator('form input[name="t"] ~ .jpk-mic').click(); await page.waitForTimeout(300);
    const m = await page.locator('form .jpk-mic-msg').first().textContent();
    check('blocked mic explains and points to Windows key + H', /blocked/.test(m) && /Windows key \+ H/.test(m), m);
    check('no sideways scroll at 390', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (shots) await page.screenshot({ path: shots + '/' + label + '-s36-390-blocked.png' });
  });
  check('no page errors (blocked)', errs.length === 0, errs.slice(0, 3));

  errs = await run('sr=none', 1280, 'light', async (page) => {
    await page.locator('form input[name="t"] ~ .jpk-mic').click(); await page.waitForTimeout(200);
    const m = await page.locator('form .jpk-mic-msg').first().textContent();
    check('no speech support explains', /isn.t available/.test(m), m);
  });
  check('no page errors (none)', errs.length === 0, errs.slice(0, 3));

  errs = await run('s36=0', 1280, 'light', async (page) => {
    check('?s36=0 shows no mic', await page.locator('.jpk-mic').count() === 0);
  });
  check('no page errors (off)', errs.length === 0, errs.slice(0, 3));

  await browser.close();
  console.log(label + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
