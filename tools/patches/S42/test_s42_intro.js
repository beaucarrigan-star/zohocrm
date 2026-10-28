const {chromium}=require('playwright');const path=require('path');
const W=[['live/stock-alerts','n42/widget-stock-alerts-s42-intro','stock.html'],['live/accessories','n42/widget-accessories-s42-intro','ship.html'],['live/order-area','n42/widget-order-area-s42-intro','order.html'],['live/your-work-today','n42/widget-your-work-today-s42-intro','work-today.html'],
['roll/account-roles-widget-v3-waveE','n42/account-roles-widget-v3-waveE-s42-intro','account-roles.html'],['roll/billing-findings-widget-v3-waveB3','n42/billing-findings-widget-v3-waveB3-s42-intro','findings.html'],['roll/briefing-steps-widget-v3-waveF','n42/briefing-steps-widget-v3-waveF-s42-intro','briefing-steps.html'],['roll/case-strip-widget-v3-waveD','n42/case-strip-widget-v3-waveD-s42-intro','case-strip.html']];
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:fail++;if(!c)console.log('FAIL',m)};
const STUB="window.ZOHO={embeddedApp:{on:function(e,cb){window.__pl=cb},init:function(){setTimeout(function(){window.__pl({demo:true})},50);return Promise.resolve()}},CRM:{CONFIG:{},API:{},UI:{}}};";
async function open(ctx,dir,idx){const p=await ctx.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(String(e).slice(0,120)));
 await p.route('**/*',r=>{const u=r.request().url();if(u.startsWith('file:'))return r.continue();if(u.includes('ZohoEmbededAppSDK'))return r.fulfill({contentType:'text/javascript',body:STUB});return r.abort();});
 await p.goto('file://'+path.resolve(dir+'/app/'+idx));await p.waitForTimeout(1500);return p;}
const txt=p=>p.evaluate(()=>{const b=document.body.cloneNode(true);b.querySelectorAll('#jpk-intro,#jpk-intro-about,#jpk-intro-css,script,style').forEach(x=>x.remove());return b.innerText.replace(/\s+/g,' ').replace(/\d{1,2}:\d{2}( ?[AP]M)?/g,'T').trim()});
(async()=>{const b=await chromium.launch();
for(const [bd,nd,idx] of W)for(const sc of ['light','dark'])for(const w of [1200,390]){const tag=nd.split('/')[1].replace('-s42-intro','')+' '+sc+' '+w;
 const ctx=await b.newContext({viewport:{width:w,height:900},colorScheme:sc});
 const bp=await open(ctx,bd,idx),np=await open(ctx,nd,idx);
 const newErrs=np.errs.filter(e=>!bp.errs.includes(e));ok(!newErrs.length,tag+' new page errors '+newErrs);
 const what=await np.evaluate(()=>{const s=[...document.scripts].find(s=>/jpk-intro\.js/.test(s.src));return s&&s.getAttribute('data-what')});
 ok(what&&await np.evaluate(w=>{const e=document.getElementById('jpk-intro');return !!e&&!e.hidden&&e.innerText.includes(w)},what),tag+' strip shows its words');
 ok(await np.evaluate(()=>!!document.querySelector('meta[name=jpk-build]')),tag+' version meta');
 const bt=await txt(bp),nt=await txt(np);ok(bt===nt,tag+' page text same as base\n B '+bt.slice(0,160)+'\n N '+nt.slice(0,160));
 const ov=async p=>p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);ok(!(await ov(np))||(await ov(bp)),tag+' no new sideways scroll');
 await np.click('#jpk-intro button');await np.reload();await np.waitForTimeout(1200);
 ok(await np.evaluate(()=>{const e=document.getElementById('jpk-intro'),a=document.getElementById('jpk-intro-about');return e&&e.hidden&&a&&!a.hidden}),tag+' hide remembered, About link shown');
 await np.click('#jpk-intro-about');ok(await np.evaluate(()=>!document.getElementById('jpk-intro').hidden),tag+' About brings it back');
 if(w===390)await np.screenshot({path:'out/'+tag.replace(/ /g,'-')+'.png',fullPage:false});
 await ctx.close();}
console.log('pass',pass,'fail',fail);await b.close();})();
