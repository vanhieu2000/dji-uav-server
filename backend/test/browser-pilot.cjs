const {chromium}=require('playwright-core'),express=require('express'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const app=express();app.use('/pilot-login',express.static(path.join(__dirname,'../public/pilot-login')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
 try{
  for(const scenario of [{fail:false,saved:false},{fail:true,saved:false},{fail:false,saved:true},{fail:false,saved:false,mediaFailure:true},{fail:false,saved:false,mediaTransient:true}]){
   const {fail,saved,mediaFailure,mediaTransient}=scenario;let brokerConnected=false,loginCount=0;
   const page=await browser.newPage();await page.addInitScript(({fail,mediaFailure,mediaTransient})=>{
    window.fixtureMediaEnabled=false;window.fixtureMediaType=1;window.mediaSetterCalls=0;window.fixtureThingLoaded=true;window.fixtureThingConfig={host:'tcp://old:1883',username:'cached-user'};window.bridgeCalls=[];window.djiBridge=new Proxy({}, {get:(_,name)=>(...args)=>{window.bridgeCalls.push([name,...args]);if(name==='platformVerifyLicense')return JSON.stringify({code:fail?1:0});if(name==='platformIsVerified')return true;if(name==='platformIsComponentLoaded')return window.fixtureThingLoaded;if(name==='platformUnloadComponent'){window.fixtureThingLoaded=false;return JSON.stringify({code:0});}if(name==='platformLoadComponent'&&args[0]==='thing'){window.fixtureThingLoaded=true;window.fixtureThingConfig=JSON.parse(args[1]);}if(name==='apiGetHost')return location.origin;if(name==='apiGetToken')return 'fixture-token';if(name==='thingGetConfigs')return JSON.stringify({code:615011});if(name==='platformGetRemoteControllerSN')return 'RC1234';if(name==='platformGetAircraftSN')return JSON.stringify({code:0,data:'UAV1234'});if(name==='mediaSetAutoUploadPhoto'){window.mediaSetterCalls++;if(mediaFailure||(mediaTransient&&window.mediaSetterCalls<3))return JSON.stringify({code:615012});window.fixtureMediaEnabled=true;}if(name==='mediaSetUploadPhotoType')window.fixtureMediaType=args[0];if(name==='mediaGetAutoUploadPhoto')return window.fixtureMediaEnabled;if(name==='mediaGetUploadPhotoType')return window.fixtureMediaType;if(name==='thingGetConnectState')return false;return JSON.stringify({code:0});}});
   },{fail,mediaFailure,mediaTransient});
   await page.route('**/api/**',r=>{
    const p=new URL(r.request().url()).pathname;
    if(p==='/api/pilot/remember')return r.fulfill({json:{code:0,data:{available:saved||loginCount>0,username:saved||loginCount>0?'fixture':null}}});
    if(p==='/api/pilot/connection')return r.fulfill({json:{code:0,data:{mqtt_connected:brokerConnected,rc_sn:'RC1234',aircraft_sn:'UAV1234',ticket_id:1}}});
    if(p==='/api/pilot/login'){loginCount++;const b=r.request().postDataJSON();assert.equal(b.remember,true);if(saved){assert.equal(b.use_saved_login,true);assert.equal(b.password,undefined);}else assert.equal(b.password,'fixture-password');}
    if(p==='/api/pilot/tickets')return r.fulfill({json:{code:0,data:[{ticket_id:1,ticket_code:'FIXTURE',ticket_name:'Test'}]}});
    if(p==='/api/pilot/identity'){assert.deepEqual(r.request().postDataJSON(),{rc_sn:'RC1234',aircraft_sn:'UAV1234'});assert.equal(r.request().headers()['x-auth-token'],'fixture-token');}
    return r.fulfill({json:{code:0,data:{remembered:true,workspace_name:'Fixture',workspace_id:'e3dea0f5-37f2-4d79-ae58-490af3228069',assigned_ticket:'Fixture',license:{appId:'fixture',appKey:'fixture',appLicense:'fixture'},token:'fixture-token',mqtt:{host:'tcp://fixture:1883',username:'fixture',password:'fixture'}}}});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/pilot-login/');if(saved){await page.waitForFunction(()=>document.getElementById('password').disabled);}else{await page.fill('#username','fixture');await page.fill('#password','fixture-password');}await page.check('#rememberLogin');await page.waitForSelector('#ticketSelect option[value="1"]',{state:'attached'});await page.locator('#loginForm').evaluate(f=>f.requestSubmit());
   if(fail){await page.waitForFunction(()=>document.getElementById('statusBox').textContent.includes('platformVerifyLicense code'));assert.equal(await page.evaluate(()=>bridgeCalls.some(c=>c[0]==='platformLoadComponent')),false);}
   else{
    await page.waitForFunction(()=>bridgeCalls.some(c=>c[0]==='platformLoadComponent'&&c[1]==='mission'));
    const calls=await page.evaluate(()=>bridgeCalls);assert.equal(calls.some(c=>c[0]==='thingGetConfigs'),false);assert.equal(calls.some(c=>c[0]==='mediaSetAutoUploadPhoto'),false);const workspace=calls.findIndex(c=>c[0]==='platformSetWorkspaceId'),thing=calls.findIndex(c=>c[0]==='platformLoadComponent'&&c[1]==='thing'),media=calls.findIndex(c=>c[0]==='platformLoadComponent'&&c[1]==='media');assert.ok(workspace<media&&thing<media);const disconnect=calls.findIndex(c=>c[0]==='thingDisconnect'),unload=calls.findIndex(c=>c[0]==='platformUnloadComponent');assert.ok(disconnect>=0&&disconnect<unload&&unload<thing);assert.ok(calls.some(c=>c[0]==='apiSetToken'&&c[1]==='fixture-token'));
    await page.waitForTimeout(1400);assert.equal(await page.locator('#connectedCard').isVisible(),false);
    await page.evaluate(()=>connectCallback(false));assert.equal(await page.locator('#connectedCard').isVisible(),false);
    await page.locator('#loginForm').evaluate(f=>f.requestSubmit());assert.equal(loginCount,1);
    await page.evaluate(()=>connectCallback(true));assert.equal(await page.locator('#connectedCard').isVisible(),false);
    brokerConnected=true;await page.evaluate(()=>connectCallback(true));await page.waitForSelector('#connectedCard',{state:'visible'});if(mediaFailure){await page.waitForFunction(()=>document.getElementById('pilot-media-status').textContent.includes('615012'));assert.equal(await page.locator('#connectedCard').isVisible(),true);const count=await page.evaluate(()=>bridgeCalls.filter(c=>c[0]==='platformLoadComponent'&&c[1]==='thing').length);await page.click('#retry-media');await page.waitForFunction(()=>!document.getElementById('retry-media').disabled);assert.equal(loginCount,1);assert.equal(await page.evaluate(()=>bridgeCalls.filter(c=>c[0]==='platformLoadComponent'&&c[1]==='thing').length),count);}else await page.waitForFunction(()=>document.getElementById('pilot-media-status').textContent.includes('Pilot xác nhận'));if(mediaTransient)assert.equal(await page.evaluate(()=>mediaSetterCalls),3);
    await page.reload();await page.waitForSelector('#connectedCard',{state:'visible'});assert.equal(loginCount,1);assert.equal(await page.evaluate(()=>bridgeCalls.some(c=>['thingDisconnect','thingGetConfigs'].includes(c[0]))),false);
    brokerConnected=false;
    await page.evaluate(()=>connectCallback(false));assert.equal(await page.locator('#connectedCard').isVisible(),false);assert.equal(await page.locator('#statusBox').getAttribute('class'),'status-box');
    await page.click('#forgetLogin');await page.waitForFunction(()=>!document.getElementById('password').disabled);assert.equal(await page.locator('#password').isDisabled(),false);assert.equal(await page.locator('#rememberLogin').isChecked(),false);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/password/i.test(k))),false);
   }
   await page.close();
  }
  console.log('PASS Pilot handshake: license failure stops initialization, workspace/thing before media, identity bound with token, no timer success, false/true/disconnect callbacks.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
