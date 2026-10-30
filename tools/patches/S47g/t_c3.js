const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const errs=[];
 for (const [s,w] of [['light',1200],['dark',390]]) for (const m of ['r-no','r-ord']) {
 const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: s });
 p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/c/sa/app/stock.html'); await p.waitForTimeout(800);
 await p.$eval('#jpk-tabs-1-t-replied', x=>x.click()); await p.waitForTimeout(200);
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(300);
 await p.click('#'+m); await p.waitForTimeout(300);
 const l0 = await p.textContent('#r-send');
 await p.click('#r-send'); await p.waitForTimeout(300);
 const l1 = await p.textContent('#r-send'); const prev = await p.textContent('#r-prev');
 const fits = await p.$eval('#r-body', x => x.scrollHeight <= x.clientHeight + 2);
 await p.$eval('.jdrawer, [role=dialog], #r-conf', x=>x.scrollIntoView());
 if (s==='light') await p.screenshot({ path: `c3-${m}.png`, fullPage: true });
 // editing after preview disarms
 await p.fill('#r-sub', 'Edited subject'); const l2 = await p.textContent('#r-send'); const hid = await p.$eval('#r-prev', x=>x.hidden);
 await p.click('#r-send'); await p.click('#r-send'); await p.waitForTimeout(500); const res = await p.textContent('#r-res');
 console.log(s,w,m,JSON.stringify({l0,l1,prev:prev.slice(0,400),fits,l2,hid,res}));
 await p.close(); }
 console.log('errors',errs); await b.close(); })();
