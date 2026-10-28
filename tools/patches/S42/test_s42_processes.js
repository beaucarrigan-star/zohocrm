const {chromium}=require('playwright');const path=require('path');
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:fail++; if(!c)console.log('FAIL',m);};
const STUB="window.ZOHO={embeddedApp:{on:function(e,cb){window.__pl=cb},init:function(){setTimeout(function(){window.__pl(window.__INIT||{demo:true})},50)}},CRM:{CONFIG:{}}};";
async function open(ctx,dir,init){const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(String(e)));
 await p.route('**/*',r=>{const u=r.request().url(); if(u.startsWith('file:'))return r.continue(); if(u.includes('ZohoEmbededAppSDK'))return r.fulfill({contentType:'text/javascript',body:STUB}); return r.abort();});
 if(init) await p.addInitScript(i=>{window.__INIT=i},init);
 await p.goto('file://'+path.resolve(dir+'/app/processes.html'));await p.waitForTimeout(1200);p.errs=errs;return p;}
const cur=p=>p.evaluate(()=>{const a=document.querySelector('#rail [aria-current="page"]');return a&&a.dataset.m});
const mainText=p=>p.evaluate(()=>{const m=document.getElementById('app').cloneNode(true);m.querySelectorAll('.jpk-intro,[data-jpk-intro],#jpk-intro').forEach(x=>x.remove());return m.innerText.replace(/\s+/g,' ').trim();});
(async()=>{const b=await chromium.launch();
for(const scheme of ['light','dark'])for(const w of [1200,390]){const tag=scheme+' '+w;
 const ctx=await b.newContext({viewport:{width:w,height:900},colorScheme:scheme});
 const base=await open(ctx,'base'),neu=await open(ctx,'new');
 ok(!base.errs.length&&!neu.errs.length,tag+' page errors '+base.errs+neu.errs);
 ok(await cur(neu)==='p_contract',tag+' default section');
 const bt=await mainText(base), nt=await mainText(neu);
 const intro=await neu.evaluate(()=>document.body.innerText.includes('The monthly and as-needed admin jobs Beau runs'));
 ok(intro,tag+' guide line shown');
 ok(nt.replace(/The monthly and as-needed.*?Solicitations\b/,'')===bt||nt.includes(bt),tag+' default page text = base'+'\n B:'+bt.slice(0,200)+'\n N:'+nt.slice(0,200));
 const sw=await neu.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);ok(sw,tag+' no sideways scroll');
 for(const k of ['billing_findings','p_solicit','billing','contract_ingest']){
   const p=await open(ctx,'new',{demo:true,jpk_section:k});ok(await cur(p)===k,tag+' opens on '+k+' got '+await cur(p));ok(!p.errs.length,tag+' '+k+' errors '+p.errs);
   // same view as base after switching by click
   const bp=await open(ctx,'base');await bp.click('#rail [data-m="'+k+'"]').catch(()=>{});await bp.waitForTimeout(600);
   const a=await mainText(p),c=await mainText(bp); ok(a.includes(c)||a===c,tag+' '+k+' text = base clicked'+'\n B:'+c.slice(0,150)+'\n N:'+a.slice(0,150));
   await p.close();await bp.close();}
 // widgetparams string form, and Message wrapper
 let p=await open(ctx,'new',{demo:true,Message:JSON.stringify({jpk_section:'p_solicit'})});ok(await cur(p)==='p_solicit',tag+' Message string form');await p.close();
 // bad key falls back to last used; record/entity id ignores section
 await ctx.clearCookies();
 p=await open(ctx,'new',{demo:true,jpk_section:'cases'});ok(await cur(p)!=='cases',tag+' bad key ignored');await p.close();
 // remembers last section
 p=await open(ctx,'new');await p.evaluate(()=>localStorage.removeItem('jpk-records-last:Processes'));await p.click('#rail [data-m="billing"]');await p.waitForTimeout(400);await p.close();
 p=await open(ctx,'new');ok(await cur(p)==='billing',tag+' remembers last section');await p.evaluate(()=>localStorage.removeItem('jpk-records-last:Processes'));
 if(w===1200||w===390)await p.screenshot({path:'out/processes-v3.1.2-'+scheme+'-'+w+'.png'});await p.close();
 // ?s35 style: build label
 const meta=await neu.evaluate(()=>document.querySelector('meta[name=jpk-build]').content);ok(/v3\.1\.2/.test(meta),tag+' version meta');
 await ctx.close();}
console.log('pass',pass,'fail',fail);await b.close();})();
