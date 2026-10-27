const engines=require('playwright-core'),engineName=process.env.BROWSER_ENGINE||'chromium',engine=engines[engineName],express=require('express'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const app=express();app.use('/m',express.static(path.resolve(__dirname,'../public/mobile')));app.use('/dashboard',express.static(path.resolve(__dirname,'../public/dashboard')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await engine.launch({...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}:{}),headless:true});
 try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:engineName!=='firefox',hasTouch:true,geolocation:{latitude:10,longitude:106},permissions:['geolocation']});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const user={user_id:2,username:'operator-fixture',role:'OPERATOR',unit_id:1,permissions:['tasks:read','tasks:write','assets:read','media:write','reports:read']};let fail=false,uploads=0;
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;let data=[];
  if(p==='/api/auth/me')data=user;
  if(p==='/api/workspace/context')data={user,plants:[{plant_id:1,plant_name:'Fixture',center_lat:10,center_lng:106}]};
  if(p==='/api/workspace/plants/1/assets')data={panels:[{panel_id:1,panel_serial:'P-1',lat:10.001,lng:106.001}],disconnectors:[],contacts:[]};
  if(p==='/api/workspace/tasks')data=[{ticket_id:1,ticket_code:'TEST-1',ticket_name:'Fixture',status:'ASSIGNED'}];
  if(p==='/api/workspace/tasks/1')data={ticket:{ticket_id:1,ticket_name:'Fixture',ticket_code:'TEST-1',target_facility:'P1',status:'ASSIGNED'},photos:[],defects:[]};
  if(p==='/api/workspace/tasks/1/photos'){uploads++;if(fail)return route.abort('internetdisconnected');data={items:[{name:'test.jpg',status:'created'}]};}
  return route.fulfill({json:{code:0,data}});
 });
 await page.goto(base+'/m/');await page.waitForSelector('.leaflet-container');await page.waitForSelector('#account-tools',{state:'attached'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.click('#gps');await page.fill('#search','P-1');await page.click('[data-asset="PANEL:1"]');await page.waitForFunction(()=>document.querySelector('#navigation').textContent.includes('±'));
 await page.click('[data-tab=tasks]');await page.click('[data-task="1"]');await page.waitForSelector('#photos');
 fail=true;await page.setInputFiles('#photos [name=files]',{name:'test.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});await page.click('#photos button');
 await page.waitForFunction(async()=>(await PhotoQueue.list()).some(x=>x.attempts===1));
 await page.reload();await page.waitForSelector('#account-tools',{state:'attached'});await page.waitForFunction(async()=>(await PhotoQueue.list()).some(x=>x.attempts>=2));
 assert.equal((await page.evaluate(()=>PhotoQueue.list())).length,1);
 await page.waitForFunction(()=>!PhotoQueue.running);
 await page.evaluate(()=>PhotoQueue.add({owner:999,ticket_id:999,name:'other-user.jpg',file:new Blob(['private'])}));
 fail=false;await page.click('[data-tab=queue]');await page.click('#sync');await page.waitForFunction(async()=>{const items=await PhotoQueue.list();return items.length===1&&items[0].owner===999;});
 const finalItems=await page.evaluate(async()=>{await new Promise(r=>setTimeout(r,100));return (await PhotoQueue.list()).map(x=>({owner:x.owner,error:x.last_error,attempts:x.attempts}));});assert.deepEqual(finalItems.map(x=>x.owner),[999],JSON.stringify(finalItems));
 for(const [width,height] of [[320,740],[390,844],[768,1024],[844,390],[390,430]]){
  await page.setViewportSize({width,height});
  for(const tab of ['map','tasks','stats','queue']){await page.click('[data-tab='+tab+']');assert.equal(await page.locator('nav [aria-current=page]').getAttribute('data-tab'),tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const r=await page.locator('nav').boundingBox();assert.ok(r.y+r.height<=height+1);}
 }
 if(process.env.MOBILE_SCREENSHOT){await page.setViewportSize({width:390,height:844});await page.click('[data-tab=map]');await page.screenshot({path:process.env.MOBILE_SCREENSHOT});}
 assert.ok(uploads>=3);assert.deepEqual(errors,[]);
 console.log('PASS '+engineName+' mobile 390px: map + GPS/distance, task photos, persisted failed upload retry, owner-isolated queue; no overflow/page errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
