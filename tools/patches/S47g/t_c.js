const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1200],['dark',1200],['light',390]]) {
 const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: s });
 p.on('pageerror', e => errs.push(s+w+': '+e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 const strip = await p.textContent('#nx');
 const tabs = await p.$eval('#tabs', x=>x.textContent);
 await p.$eval('#jpk-tabs-1-t-replied', x=>x.click()); await p.waitForTimeout(300);
 const rows = await p.locator('#tbl tbody tr').allInnerTexts();
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(400);
 await p.screenshot({ path: `c-${s}-${w}-a.png` });
 const reply = await p.textContent('.replytxt');
 await p.click('#r-ord'); await p.waitForTimeout(300);
 const sub = await p.inputValue('#r-sub'); const to = await p.inputValue('#r-to');
 await p.screenshot({ path: `c-${s}-${w}-b.png`, fullPage: true });
 await p.click('#r-send'); const lbl = await p.textContent('#r-send'); await p.click('#r-send'); await p.waitForTimeout(500);
 const res = await p.textContent('#r-res');
 await p.waitForTimeout(1500);
 const tabs2 = await p.$eval('#tabs', x=>x.textContent);
 const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 console.log(s,w,JSON.stringify({strip:strip.slice(0,90),tabs,rows,reply,sub,to,lbl,res,tabs2,sw}));
 // no order path on a fresh load: waiting tab item
 await p.reload(); await p.waitForTimeout(800);
 await p.close(); }
 console.log('errors',errs); await b.close(); })();
