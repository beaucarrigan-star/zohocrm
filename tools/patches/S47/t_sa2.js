const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
 for (const s of ['light','dark']) { const p = await b.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: s });
 await p.route(/^https?:\/\//, r => r.abort());
 await p.goto('file://' + process.cwd() + '/b/sa/app/stock.html'); await p.waitForTimeout(700);
 await p.locator('#tbl tbody tr').first().click(); await p.waitForTimeout(400);
 await p.locator('.jr-in').click(); await p.waitForTimeout(200);
 await p.screenshot({ path: `sa-open-${s}.png` }); await p.close(); }
 await b.close(); })();
