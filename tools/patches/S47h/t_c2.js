const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1200],['dark',390]]) for (const m of ['r-ord','r-no']) {
 const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: s });
 p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 await p.$eval('#jpk-tabs-1-t-replied', x=>x.click()); await p.waitForTimeout(200);
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(300);
 await p.click('#'+m); await p.waitForTimeout(300);
 const h = await p.textContent('#r-h'), sub = await p.inputValue('#r-sub'), body = await p.inputValue('#r-body'), note = await p.textContent('#r-note');
 if (m==='r-no' && s==='light') await p.screenshot({ path: 'c2-no.png', fullPage: true });
 await p.click('#r-send'); const l = await p.textContent('#r-send'); await p.click('#r-send'); await p.waitForTimeout(500);
 const res = await p.textContent('#r-res'); await p.waitForTimeout(1500);
 const tabs = await p.$eval('#tabs', x=>x.textContent); const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
 console.log(s,w,m,JSON.stringify({h,sub,note,l,res,tabs,sw})); if (m==='r-no'&&s==='light') console.log(body);
 await p.close(); }
 console.log('errors',errs); await b.close(); })();
