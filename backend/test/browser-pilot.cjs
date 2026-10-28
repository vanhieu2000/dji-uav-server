const {chromium}=require('playwright-core'),express=require('express'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const app=express();app.use('/pilot-login',express.static(path.join(__dirname,'../public/pilot-login')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
 try{
  for(const fail of [false,true]){
   const page=await browser.newPage();await page.addInitScript(({fail})=>{
    window.bridgeCalls=[];window.djiBridge=new Proxy({}, {get:(_,name)=>(...args)=>{window.bridgeCalls.push([name,...args]);if(name==='platformVerifyLicense')return JSON.stringify({code:fail?1:0});if(name==='platformIsVerified')return true;if(name==='platformGetRemoteControllerSN')return 'RC1234';if(name==='platformGetAircraftSN')return JSON.stringify({code:0,data:'UAV1234'});if(name==='mediaGetAutoUploadPhoto')return true;if(name==='mediaGetUploadPhotoType')return 0;if(name==='thingGetConnectState')return false;return JSON.stringify({code:0});}});
   },{fail});
   await page.route('**/api/**',r=>{
    const p=new URL(r.request().url()).pathname;
    if(p==='/api/pilot/tickets')return r.fulfill({json:{code:0,data:[{ticket_id:1,ticket_code:'FIXTURE',ticket_name:'Test'}]}});
    if(p==='/api/pilot/identity'){assert.deepEqual(r.request().postDataJSON(),{rc_sn:'RC1234',aircraft_sn:'UAV1234'});assert.equal(r.request().headers()['x-auth-token'],'fixture-token');}
    return r.fulfill({json:{code:0,data:{workspace_name:'Fixture',workspace_id:'e3dea0f5-37f2-4d79-ae58-490af3228069',assigned_ticket:'Fixture',license:{appId:'fixture',appKey:'fixture',appLicense:'fixture'},token:'fixture-token',mqtt:{host:'tcp://fixture:1883',username:'fixture',password:'fixture'}}}});
   });
   await page.goto('http://127.0.0.1:'+server.address().port+'/pilot-login/');await page.fill('#username','fixture');await page.fill('#password','fixture-password');await page.waitForSelector('#ticketSelect option[value="1"]',{state:'attached'});await page.locator('#loginForm').evaluate(f=>f.requestSubmit());
   if(fail){await page.waitForFunction(()=>document.getElementById('statusBox').textContent.includes('DJI Bridge code'));assert.equal(await page.evaluate(()=>bridgeCalls.some(c=>c[0]==='platformLoadComponent')),false);}
   else{
    await page.waitForFunction(()=>bridgeCalls.some(c=>c[0]==='platformLoadComponent'&&c[1]==='mission'));
    const calls=await page.evaluate(()=>bridgeCalls),workspace=calls.findIndex(c=>c[0]==='platformSetWorkspaceId'),thing=calls.findIndex(c=>c[0]==='platformLoadComponent'&&c[1]==='thing'),media=calls.findIndex(c=>c[0]==='platformLoadComponent'&&c[1]==='media');assert.ok(workspace<media&&thing<media);
    await page.waitForTimeout(1400);assert.equal(await page.locator('#connectedCard').isVisible(),false);
    await page.evaluate(()=>connectCallback(false));assert.equal(await page.locator('#connectedCard').isVisible(),false);
    await page.evaluate(()=>connectCallback(true));assert.equal(await page.locator('#connectedCard').isVisible(),true);
    await page.evaluate(()=>connectCallback(false));assert.equal(await page.locator('#connectedCard').isVisible(),false);
   }
   await page.close();
  }
  console.log('PASS Pilot handshake: license failure stops initialization, workspace/thing before media, identity bound with token, no timer success, false/true/disconnect callbacks.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
