const engines=require('playwright-core'),engineName=process.env.BROWSER_ENGINE||'chromium',engine=engines[engineName];const fs=require('fs'),assert=require('assert/strict');
const path=require('path');const req=require('module').createRequire(path.resolve(__dirname,'../package.json'));
(async()=>{
 const app=req('express')();app.use(req('express').static(path.resolve(__dirname,'../public/dashboard')));
 app.use('/dashboard',req('express').static(path.resolve(__dirname,'../public/dashboard')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await engine.launch({...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}:{}),headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const commands=[],externalLibraries=[];let deviceMode='multi';
 await page.addInitScript(()=>{window.WebSocket=class {constructor(){setTimeout(()=>this.onopen&&this.onopen(),10)} send(){} close(){}};});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.host!==new URL(base).host){if(['script','stylesheet','font'].includes(route.request().resourceType()))externalLibraries.push(u.hostname);if(u.pathname.endsWith('leaflet.js'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(req.resolve('leaflet/dist/leaflet.js'))});if(u.pathname.endsWith('leaflet.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync(req.resolve('leaflet/dist/leaflet.css'))});return route.fulfill({status:200,body:''});}
  if(u.pathname.startsWith('/api/')){
   if(route.request().method()!=='GET'&&u.pathname!=='/api/diagnostics/client')commands.push(u.pathname);
   let data=[];
   if(u.pathname==='/api/workspace/context')data={plants:[]};
   if(u.pathname==='/api/auth/me')data={user_id:1,role:'ADMIN',username:'fixture-admin'};
   if(u.pathname==='/api/insights/charts')data={tickets:[],defects:[],areas:[],temperatures:[],statuses:[],levels:[]};
   if(u.pathname==='/api/insights/alert-report')data={items:[],total:0,page:1,page_size:20};
   if(u.pathname==='/api/health')data={db:{connected:true}};
   if(u.pathname==='/api/tickets')data=[{ticket_id:1,ticket_code:'TEST-1',ticket_name:'Phiếu thử'}];
   if(u.pathname==='/api/monitoring/config')data={device_mode:deviceMode};
   if(u.pathname==='/api/monitoring/photos')data={items:[],next_id:0,has_more:false};
   if(u.pathname==='/api/monitoring/devices')data=[{device_sn:'UAV-A',lat:10,lng:106,battery:0,status:'ONLINE',last_seen:new Date().toISOString()},{device_sn:'UAV-B',lat:10.001,lng:106.001,battery:50,status:'ONLINE',last_seen:new Date().toISOString()}];
   if(u.pathname==='/api/monitoring/devices'&&deviceMode==='single')data=data.slice(0,1);
   if(u.pathname==='/api/assets/tree')data={plant:{plant_id:1,plant_code:'TEST',plant_name:'Fixture'},areas:[],substations:[]};
   if(u.pathname==='/api/assets/features')data={};
   if(u.pathname==='/api/reports/overview')data={completed_tickets:0,total_tickets:1,total_defects_found:0,overheated_disconnectors:0,max_disconnector_temperature:null};
   return route.fulfill({json:{code:0,data}});
  }return route.continue();
 });
 try{
  await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#uav-live-devices [data-sn]').length===2);
  assert.equal(await page.evaluate(()=>GIS.LiveMonitor.selected()),null);
  await page.selectOption('#uav-monitor-target','UAV-A');assert.equal(await page.evaluate(()=>GIS.LiveMonitor.selected()),'UAV-A');
  await page.selectOption('#uav-monitor-target','');assert.equal(await page.evaluate(()=>GIS.LiveMonitor.selected()),null);
  await page.evaluate(()=>switchView('map-solar'));
  await page.waitForFunction(()=>document.querySelectorAll('#real-gis-map .leaflet-interactive').length>=2);
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'osd',device_sn:'UAV-A',data:{device_sn:'UAV-A',lat:10.002,lng:106.002,battery:0,status:'ONLINE',ticket_id:1,last_seen:new Date().toISOString()}}));
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'media_synced',data:{media_id:999,ticket_id:1,latitude:10.002,longitude:106.002,file_name:'fixture.jpg',lens:'IR'}}));
  await page.waitForFunction(()=>document.getElementById('uav-photo-count').textContent.includes('1 ảnh'));
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'device_status',device_sn:'UAV-B',status:'OFFLINE'}));
  assert.match(await page.locator('#uav-live-devices').innerText(),/UAV-B · OFFLINE/);
  assert.match(await page.locator('#uav-live-devices').innerText(),/UAV-A · ONLINE · 0%/);
  assert.equal(await page.locator('#account-sidebar #account-tools').count(),1);
  assert.equal(await page.locator('.thermal-hud-meter').count(),0);
  for(const width of [1440,1024,768,390]){
   await page.setViewportSize({width,height:900});
   for(const view of ['map-solar','map-substation']){
    await page.evaluate(v=>switchView(v),view);await page.waitForTimeout(350);
    const b=await page.evaluate(()=>{const v=document.querySelector('.page-view.active'),m=v.querySelector('.mapbox').getBoundingClientRect(),o=v.querySelector('.map-osd-topbar').getBoundingClientRect(),t=v.querySelector('.map-left-toolbar').getBoundingClientRect();return {mw:m.width,mh:m.height,mx:m.x,mr:m.right,mb:m.bottom,ox:o.x,or:o.right,ob:o.bottom,ty:t.y,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.ok(b.mw>200&&b.mh>300,JSON.stringify({width,view,b}));
    assert.ok(b.ox>=b.mx&&b.or<=b.mr+1&&b.ob<=b.mb,JSON.stringify({width,view,b}));
    assert.ok(b.ty>=b.ob,JSON.stringify({width,view,b}));assert.equal(b.overflow,false);
   }
   if(width<900){await page.locator('#btn-toggle-sidebar').click();assert.ok(await page.locator('#account-sidebar .account-logout').isVisible());await page.locator('aside [data-target="map-solar"]').click();assert.equal(await page.locator('aside').isVisible(),false);}
  }
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>switchView('map-solar'));
  await page.locator('#btn-toggle-sidebar').click();assert.ok(await page.locator('#account-sidebar .account-logout').isVisible());await page.locator('#btn-toggle-sidebar').click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#real-gis-map .leaflet-control-layers').count(),1);
  if(process.env.BROWSER_SCREENSHOT) await page.screenshot({path:process.env.BROWSER_SCREENSHOT,fullPage:false});
  await page.evaluate(()=>{triggerPhoto();flyAndCapturePoint(10,106);flyDroneToPoint(10,106);startSimulatedMissionFlight();toggleSimulated3Cams();GIS.Tasks.render(document.getElementById('gis-assets-root'));});
  await page.waitForSelector('#task-form',{state:'attached'});
  await page.evaluate(()=>GIS.Insights.reports());
  await page.waitForSelector('#insights-reports-root .gis-empty',{state:'attached'});
  for(const view of ['dashboard','tickets-solar','tickets-dcl','control-manual','uav','reports','assets','admin']){await page.evaluate(v=>switchView(v),view);await page.waitForTimeout(150);assert.equal(await page.locator('.page-view.active').count(),1);}
  assert.deepEqual(commands,[]);assert.deepEqual(errors,[]);assert.deepEqual(externalLibraries,[]);assert.ok(await page.evaluate(()=>!!(window.L?.PM&&window.flvjs&&window.XLSX?.utils)));
  await page.evaluate(()=>switchView('map-solar'));await page.waitForFunction(()=>!!gBaseLayerSolar);
  assert.match(await page.evaluate(()=>gBaseLayerSolar._url),/mt1\.google\.com/);
  await page.evaluate(()=>{for(let i=0;i<4;i++)gBaseLayerSolar.fire('tileerror');});await page.waitForTimeout(200);
  assert.match(await page.evaluate(()=>gBaseLayerSolar._url),/mt1\.google\.com/);assert.match(await page.locator('#topbar-net-status').innerText(),/Lỗi|lỗi/);
  await page.evaluate(()=>setBasemap('offline','solar'));assert.equal(await page.evaluate(()=>gBaseLayerSolar._url),'/tiles/{z}/{x}/{y}.png');assert.equal(await page.evaluate(()=>localStorage.getItem('uav-basemap-solar')),'offline');
  await page.evaluate(()=>setBasemap('google_hybrid','solar'));assert.equal(await page.evaluate(()=>savedBasemap('solar')),'google_hybrid');
  await page.goto(base+'/accounts.html');await page.waitForSelector('#permission-checks input');assert.equal(await page.locator('#permission-checks input').count(),6);assert.equal(await page.locator('#message').innerText(),'');assert.deepEqual(errors,[]);
  deviceMode='single';await page.goto(base);await page.waitForFunction(()=>GIS.LiveMonitor.selected()==='UAV-A');assert.equal(await page.evaluate(()=>gSelectedDroneSn),'UAV-A');
  const playerConfig=await page.evaluate(()=>{
    let config;window.flvjs={isSupported:()=>true,Events:{ERROR:'error'},createPlayer:(source,options)=>{config=options;return {attachMediaElement(){},load(){},on(){},destroy(){}};}};
    const video=document.getElementById('manual-live-video');video.play=()=>Promise.resolve();Object.defineProperty(video,'paused',{get:()=>false,configurable:true});Object.defineProperty(video,'buffered',{get:()=>({length:1,start:()=>0,end:()=>5}),configurable:true});
    startFlvLivePlayer('/live/fixture','http://fixture.example/live.flv');return config;
  });assert.equal(playerConfig.enableStashBuffer,false);assert.equal(playerConfig.lazyLoad,false);
  await page.waitForFunction(()=>document.getElementById('manual-live-video').currentTime>4.5);await page.evaluate(()=>stopFlvLivePlayer());assert.equal(await page.evaluate(()=>gLiveEdgeTimer),null);assert.deepEqual(errors,[]);assert.deepEqual(commands,[]);
  console.log('PASS '+engineName+': dashboard boots, two UAV markers, zero battery, offline event, realtime photo; task UI mounts, legacy simulation sends no commands; online map default and tile errors preserve provider; explicit offline choice; no page errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
