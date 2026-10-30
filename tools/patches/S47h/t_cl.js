const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['dark',1400],['light',390]]) {
 const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: s });
 p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 await p.$eval('#jpk-tabs-1-t-closed', x=>x.click()); await p.waitForTimeout(300);
 const chips = await p.locator('.cfchips').innerText(); const rows = await p.locator('#tbl tbody tr').allInnerTexts(); const note = await p.textContent('#cf-note');
 await p.selectOption('#cf-per','all'); await p.waitForTimeout(200);
 const chipsAll = await p.locator('.cfchips').innerText(); const rowsAll = await p.locator('#tbl tbody tr').count();
 await p.screenshot({ path: `cl-${s}-${w}.png` });
 await p.click('.cfchips [data-cf=cleared]').catch(()=>{}); await p.waitForTimeout(200); const rowsC = await p.locator('#tbl tbody tr').allInnerTexts();
 await p.fill('#cf-q','zzz'); await p.waitForTimeout(200); const empty = await p.locator('#tbl').innerText();
 await p.fill('#cf-q',''); await p.$eval('#jpk-tabs-1-t-approve', x=>x.click()); await p.waitForTimeout(200); const hid = await p.$eval('#cf', x=>x.hidden);
 const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 console.log(s,w,JSON.stringify({chips,rows,note,chipsAll,rowsAll,rowsC,empty:empty.slice(0,80),hid,sw})); await p.close(); }
 console.log('errors',errs); await b.close(); })();
