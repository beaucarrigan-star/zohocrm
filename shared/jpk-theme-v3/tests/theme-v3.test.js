/* jpk-theme-v3 test: tokens cascade, legacy components re-skin, brand switcher API, WCAG AA contrast.
   Run: NODE_PATH=$(npm root -g) node tests/theme-v3.test.js */
const path = require('path');
const { chromium } = require('playwright');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } }
function lum(hex) { const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; }
function cr(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function rgbToHex(s) { const m = s.match(/\d+/g); return '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase(); }

(async () => {
  // 1. brand helper in node
  const brand = require('../jpk-brand.js');
  ok(brand.version === '3.0.0', 'jpk-brand 3.0.0 loads in node');
  ok(brand.BRANDS.length === 4 && brand.BRANDS[1].values.length === 2, 'four brands; JusticePoint covers EM and Programs');

  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1240, height: 900 }, colorScheme: scheme });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await p.goto('file://' + path.join(__dirname, '..', 'demo.html'));
    await p.waitForSelector('#brand .sw');
    ok(errs.length === 0, scheme + ': no page errors' + (errs.length ? ' -> ' + errs.join(' | ') : ''));

    const t = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const g = k => cs.getPropertyValue(k).trim();
      const el = s => getComputedStyle(document.querySelector(s));
      return {
        accent: g('--accent'), teal: g('--teal'), surface: g('--surface'), ink: g('--ink'), muted: g('--muted'), onAccent: g('--on-accent'), accentInk: g('--accent-ink'),
        priBg: el('.legacy .btn.pri').backgroundColor, pillOn: el('.legacy .pill[aria-pressed="true"]').backgroundColor,
        chipBg: el('.legacy .chip.good').backgroundColor, chipDot: getComputedStyle(document.querySelector('.legacy .chip.good'), '::before').backgroundColor,
        h1Font: el('.rtitle h3').fontFamily, radius: el('.legacy .card').borderRadius, tabColor: el('.ctabs button[aria-selected="true"]').color,
        bodyBg: getComputedStyle(document.body).backgroundColor
      };
    });
    ok(t.teal === 'var(--accent)' || rgbToHex(t.priBg) === t.accent.toUpperCase(), scheme + ': --teal aliases to --accent, primary button is accent (' + rgbToHex(t.priBg) + ')');
    ok(rgbToHex(t.pillOn) === t.ink.toUpperCase(), scheme + ': selected pill is solid ink');
    ok(t.chipBg === 'rgba(0, 0, 0, 0)' && t.chipDot !== 'rgba(0, 0, 0, 0)', scheme + ': status chip has no fill, dot is colored');
    ok(/Archivo/.test(t.h1Font), scheme + ': record title uses Archivo');
    ok(t.radius === '4px', scheme + ': card radius 4px');
    ok(rgbToHex(t.tabColor) === t.ink.toUpperCase(), scheme + ': selected tab text is ink, not accent');
    ok(rgbToHex(t.bodyBg) !== '#EEF2F2' && rgbToHex(t.bodyBg) !== '#0E1819', scheme + ': body background is v3, not v1 teal-grey');

    // contrast
    const pairs = [['ink', t.ink, t.surface], ['muted', t.muted, t.surface], ['accent-ink', t.accentInk, t.surface], ['on-accent', t.onAccent, t.accent]];
    for (const [n, fg, bg] of pairs) { const r = cr(fg.toUpperCase(), bg.toUpperCase()); ok(r >= 4.5, scheme + ': ' + n + ' on its surface ' + r.toFixed(2) + ':1 (AA 4.5)'); }

    // brand switcher behaviour
    await p.click('#brand .sw');
    ok(await p.isVisible('#brand .swmenu'), scheme + ': switcher opens');
    await p.click('#brand .swmenu [data-key="sr"]');
    ok(await p.isHidden('#brand .swmenu'), scheme + ': switcher closes after pick');
    const after = await p.evaluate(() => ({
      label: document.querySelector('#brand .sw b').textContent, rows: Array.from(document.querySelectorAll('#rows tr')).filter(tr => !tr.hidden).length,
      acc: document.getElementById('c-acc').textContent, hint: document.getElementById('hint').textContent, where: scope.where('Account_Name.Brand')
    }));
    ok(after.label === 'Sirona Recovery' && after.rows === 1 && after.acc === '28', scheme + ': scope filters rows and rail counts');
    ok(after.where === "Account_Name.Brand = 'Sirona Recovery'", scheme + ': where() through lookup -> ' + after.where);
    await p.evaluate(() => scope.set('jp'));
    ok(await p.evaluate(() => scope.where('Brand')) === "Brand in ('JusticePoint EM','JusticePoint Programs')", scheme + ': JusticePoint where() uses IN over two values');
    await p.evaluate(() => scope.set('all'));
    ok(await p.evaluate(() => scope.where('Brand')) === '', scheme + ': all brands -> empty criteria');

    await p.screenshot({ path: path.join(__dirname, 'shot-' + scheme + '.png'), fullPage: true });
    await p.close();
  }
  // phone width: no horizontal overflow
  const m = await b.newPage({ viewport: { width: 400, height: 800 } });
  await m.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await m.goto('file://' + path.join(__dirname, '..', 'demo.html'));
  await m.waitForSelector('#brand .sw');
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 400, 'phone: no horizontal page scroll');
  ok(await m.evaluate(() => getComputedStyle(document.querySelector('.jpk-rail')).flexDirection) === 'row', 'phone: rail becomes a horizontal strip');
  await m.screenshot({ path: path.join(__dirname, 'shot-phone.png'), fullPage: true });
  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
