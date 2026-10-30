const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1200],['dark',390]]) {
 const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: s });
 p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 // send one ordered first
 await p.$eval('#jpk-tabs-1-t-replied', x=>x.click()); await p.waitForTimeout(200);
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(300);
 await p.click('#r-ord'); await p.click('#r-send'); await p.click('#r-send'); await p.waitForTimeout(2200);
 await p.$eval('#jpk-tabs-1-t-months', x=>x.click()); await p.waitForTimeout(300);
 const rows = await p.locator('#tbl tbody tr').allInnerTexts(); const head = await p.locator('#tbl thead').innerText();
 const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 await p.screenshot({ path: `m-${s}-${w}.png` });
 console.log(s,w,JSON.stringify({head,rows,sw})); await p.close(); }
 console.log('errors',errs); await b.close(); })();
