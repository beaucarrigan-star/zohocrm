const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1280],['dark',1280],['light',390]]) { const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: s });
 p.on('pageerror', e => errs.push(s+w+': '+e.message));
 await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/b/cs/app/widget.html?preview=1'); await p.waitForTimeout(2500);
 const nav = await p.locator('#sm-nav').count();
 if (nav) { await p.$eval('#sm-nav', x=>x.click()); await p.waitForTimeout(300); }
 await p.$eval('#sm-list .sm-sum', x=>x.click()); await p.$eval('#z-sm', x=>x.scrollIntoView()); await p.waitForTimeout(400);
 const n = await p.locator('#sm-list .jr').count();
 const to0 = await p.$eval('#sm-list [data-sm="to"]', e=>e.value);
 await p.locator('#sm-list .jr-in').click(); await p.waitForTimeout(300);
 const opts = await p.locator('#sm-list .jr-o').allTextContents();
 await p.locator('#sm-list .jr-o', {hasText:'Demo User'}).click();
 const to1 = await p.$eval('#sm-list [data-sm="to"]', e=>e.value);
 await p.locator('#sm-list .jr-o').first().scrollIntoViewIfNeeded();
 await p.screenshot({ path: `cs-${s}-${w}.png` });
 // approve button label reflects count
 await p.keyboard.press('Escape');
 await p.locator('#sm-list [data-sm="approve"]').click(); const lbl = await p.locator('#sm-list [data-sm="approve"]').textContent();
 const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 console.log(s,w,{nav,n,to0,opts,to1,lbl,sideways:sw}); await p.close(); }
 console.log('errors',errs); await b.close(); })();
