const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1200],['dark',390]]) {
 const p = await b.newPage({ viewport: { width: w, height: 1100 }, colorScheme: s });
 p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 await p.$eval('#jpk-tabs-1-t-replied', x=>x.click()); await p.waitForTimeout(200);
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(300);
 const our = await p.locator('.hx-our summary').textContent();
 await p.click('#r-ord'); await p.click('#r-send'); await p.click('#r-send'); await p.waitForTimeout(2300);
 await p.$eval('#jpk-tabs-1-t-closed', x=>x.click()); await p.waitForTimeout(200);
 await p.locator('#tbl tbody tr', {hasText:'Cook Co'}).first().click(); await p.waitForTimeout(500);
 const cards = await p.locator('.hx b').allTextContents();
 const ans = await p.locator('#h-ans').innerText();
 if (s==='light') { await p.$eval('#h-re', x=>x.scrollIntoView()); await p.screenshot({ path: 'h-closed.png', fullPage:true }); }
 await p.click('#h-re'); const l = await p.textContent('#h-re'); const note = await p.textContent('#h-re-note');
 await p.click('#h-re'); await p.waitForTimeout(400); const res = await p.textContent('#h-res'); await p.waitForTimeout(1500);
 const tabs = await p.$eval('#tabs', x=>x.textContent);
 // a closed alert without email (Cleared) history
 await p.$eval('#jpk-tabs-1-t-closed', x=>x.click()); await p.waitForTimeout(200);
 const n = await p.locator('#tbl tbody tr').count(); if (n) { await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(300); }
 const h2 = n ? await p.locator('.drawer, [role=dialog]').last().innerText().catch(()=>'' ) : '';
 const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 console.log(s,w,JSON.stringify({our,cards,ans:ans.slice(0,160),l,note,res,tabs,closedLeft:n,h2:h2.slice(0,200),sw}));
 await p.close(); }
 console.log('errors',errs); await b.close(); })();
