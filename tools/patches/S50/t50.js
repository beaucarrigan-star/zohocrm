const { chromium } = require('playwright');
const P={accessories:'ship.html',stock:'stock.html',processes:'processes.html',records:'records.html',support:'support.html',worktoday:'work-today.html',lost:'lost.html'};
(async () => { const b = await chromium.launch(); const res=[];
 for (const [k,f] of Object.entries(P)) for (const [s,w] of [['light',1280],['dark',390]]) {
  const p = await b.newPage({ viewport: { width: w, height: 800 }, colorScheme: s }); const errs=[];
  p.on('pageerror', e => errs.push(e.message)); await p.route(/^https?:\/\//, r => r.abort());
  await p.goto('file://' + process.cwd() + '/out/'+k+'/app/'+f); await p.waitForTimeout(1500);
  const info = await p.evaluate(()=>{const n=document.querySelector('.jpk-back');if(!n)return null;const r=n.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),first:n.parentNode.firstChild===n,parent:n.parentNode.tagName+'.'+n.parentNode.className+'#'+n.parentNode.id,vis:!!n.offsetParent}});
  const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await p.screenshot({ path: `s-${k}-${s}-${w}.png`, clip:{x:0,y:0,width:w,height:260} });
  // base comparison of errors
  res.push(k+' '+s+w+' '+JSON.stringify(info)+' sw '+sw+' errs '+errs.length+(errs[0]?' '+errs[0].slice(0,80):''));
  await p.close(); }
 console.log(res.join('\n')); await b.close(); })();
