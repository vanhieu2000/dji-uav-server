const {chromium}=require('playwright-core');const fs=require('fs'),assert=require('assert/strict');
const path=require('path');const req=require('module').createRequire(path.resolve(__dirname,'../package.json'));
(async()=>{
 const app=req('express')();app.use(req('express').static(path.resolve(__dirname,'../public/dashboard')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const commands=[];
 await page.addInitScript(()=>{window.WebSocket=class {constructor(){setTimeout(()=>this.onopen&&this.onopen(),10)} send(){} close(){}};});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
  if(u.host!==new URL(base).host){if(u.pathname.endsWith('leaflet.js'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(req.resolve('leaflet/dist/leaflet.js'))});if(u.pathname.endsWith('leaflet.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync(req.resolve('leaflet/dist/leaflet.css'))});return route.fulfill({status:200,body:''});}
  if(u.pathname.startsWith('/api/')){
   if(route.request().method()!=='GET')commands.push(u.pathname);
   let data=[];
   if(u.pathname==='/api/health')data={db:{connected:true}};
   if(u.pathname==='/api/tickets')data=[{ticket_id:1,ticket_code:'TEST-1',ticket_name:'Phiếu thử'}];
   if(u.pathname==='/api/monitoring/photos')data={items:[],next_id:0,has_more:false};
   if(u.pathname==='/api/monitoring/devices')data=[{device_sn:'UAV-A',lat:10,lng:106,battery:0,status:'ONLINE',last_seen:new Date().toISOString()},{device_sn:'UAV-B',lat:10.001,lng:106.001,battery:50,status:'ONLINE',last_seen:new Date().toISOString()}];
   if(u.pathname==='/api/assets/features')data={};
   if(u.pathname==='/api/reports/overview')data={completed_tickets:0,total_tickets:1,total_defects_found:0,overheated_disconnectors:0,max_disconnector_temperature:null};
   return route.fulfill({json:{code:0,data}});
  }return route.continue();
 });
 try{
  await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#uav-live-devices [data-sn]').length===2);
  await page.evaluate(()=>switchView('map-solar'));
  await page.waitForFunction(()=>document.querySelectorAll('#real-gis-map .leaflet-interactive').length>=2);
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'osd',device_sn:'UAV-A',data:{device_sn:'UAV-A',lat:10.002,lng:106.002,battery:0,status:'ONLINE',ticket_id:1,last_seen:new Date().toISOString()}}));
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'media_synced',data:{media_id:999,ticket_id:1,latitude:10.002,longitude:106.002,file_name:'fixture.jpg',lens:'IR'}}));
  await page.waitForFunction(()=>document.getElementById('uav-photo-count').textContent.includes('1 ảnh'));
  await page.evaluate(()=>GIS.LiveMonitor.onEvent({type:'device_status',device_sn:'UAV-B',status:'OFFLINE'}));
  assert.match(await page.locator('#uav-live-devices').innerText(),/UAV-B · OFFLINE/);
  assert.match(await page.locator('#uav-live-devices').innerText(),/UAV-A · ONLINE · 0%/);
  if(process.env.BROWSER_SCREENSHOT) await page.screenshot({path:process.env.BROWSER_SCREENSHOT,fullPage:false});
  assert.deepEqual(commands,[]);assert.deepEqual(errors,[]);
  console.log('PASS Chromium: dashboard boots, two UAV markers, zero battery, offline event, realtime photo; no commands or page errors');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
