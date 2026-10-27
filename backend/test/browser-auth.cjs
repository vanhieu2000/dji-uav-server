const engines=require('playwright-core'),engineName=process.env.BROWSER_ENGINE||'chromium',engine=engines[engineName],express=require('express'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const app=express();app.use('/dashboard',express.static(path.resolve(__dirname,'../public/dashboard')));app.use('/m',express.static(path.resolve(__dirname,'../public/mobile')));app.use('/pilot-login',express.static(path.resolve(__dirname,'../public/pilot-login')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await engine.launch({...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']} : {}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'dark'});let signed=false,forceChange=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async r=>{
   const p=new URL(r.request().url()).pathname;let data=[];
   if(p==='/api/auth/me')return r.fulfill({status:signed?200:401,json:signed?{code:0,data:{username:'fixture',full_name:'Người dùng RTC',role:'ADMIN',must_change_password:forceChange}}:{message:'Chưa đăng nhập'}});
   if(p==='/api/auth/login'){const b=r.request().postDataJSON();if(b.password!=='fixture-password')return r.fulfill({status:401,json:{message:'Tài khoản hoặc mật khẩu không đúng'}});signed=true;data={user:{username:'fixture',role:'ADMIN',must_change_password:forceChange}};}
   if(p==='/api/auth/logout'||p==='/api/auth/reset-password'||p==='/api/auth/change-password'){signed=false;forceChange=false;}
   if(p==='/api/workspace/context')data={plants:[]};
   if(p==='/api/insights/charts')data={tickets:[],defects:[],areas:[],temperatures:[]};
   if(p==='/api/monitoring/photos')data={items:[],next_id:0,has_more:false};
   if(p==='/api/reports/overview')data={};
   return r.fulfill({json:{code:0,data}});
  });
  await page.route('https://**',r=>r.abort());
  for(const width of [1440,768,390,320]){
   await page.emulateMedia({colorScheme:width===1440?'light':'dark'});await page.setViewportSize({width,height:844});await page.goto(base+'/dashboard/');await page.waitForSelector('#auth-username');
   assert.equal(await page.locator('#account-overlay .auth-logo').evaluate(i=>i.complete&&i.naturalWidth>0),true);
   const layout=await page.evaluate(()=>{const p=document.querySelector('#account-overlay'),f=p.querySelector('form').getBoundingClientRect(),i=p.querySelector('input').getBoundingClientRect();return {overflow:p.scrollWidth>p.clientWidth,inside:f.left>=0&&f.right<=innerWidth,input:i.width,bg:getComputedStyle(p).backgroundColor,fg:getComputedStyle(p.querySelector('input')).color};});
   assert.equal(layout.overflow,false);assert.equal(layout.inside,true);assert.ok(layout.input>200);assert.equal(layout.bg,'rgb(237, 245, 243)');assert.equal(layout.fg,'rgb(21, 59, 61)');
   if(process.env.AUTH_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.AUTH_SCREENSHOT_DIR,`rtc-login-${width}.png`)});
  }
  await page.locator('[name=username]').fill('fixture');await page.locator('[name=password]').fill('wrong');await page.locator('#account-overlay [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#account-overlay [role=status]').textContent.includes('không đúng'));
  await page.locator('#account-overlay .forgot').click();await page.locator('[name=email]').fill('fixture@example.com');await page.locator('#account-overlay [type=submit]').click();await page.waitForSelector('#account-overlay .success');await page.locator('#account-overlay .back').click();
  forceChange=true;await page.locator('[name=username]').fill('fixture');await page.locator('[name=password]').fill('fixture-password');await page.locator('#account-overlay [type=submit]').click();await page.waitForSelector('[name=new_password]');await page.locator('[name=password]').fill('fixture-password');await page.locator('[name=new_password]').fill('new-fixture-password');await page.locator('#account-overlay [type=submit]').click();await page.waitForSelector('[name=username]');
  await page.locator('[name=username]').fill('fixture');await page.locator('[name=password]').fill('fixture-password');await page.locator('#account-overlay [type=submit]').click();await page.waitForSelector('#account-tools',{state:'attached'});await page.setViewportSize({width:1440,height:900});await page.locator('#account-tools .account-logout').click();await page.waitForSelector('[name=username]');
  await page.goto(base+'/dashboard/?reset=1#reset_token=fixture');await page.waitForSelector('[name=new_password]');await page.locator('[name=new_password]').fill('reset-fixture-password');await page.locator('#account-overlay [type=submit]').click();await page.waitForSelector('[name=username]');
  for(const url of ['/dashboard/accounts.html','/m/','/pilot-login/']){
   await page.goto(base+url);if(url!=='/pilot-login/'){await page.waitForSelector('#auth-username');assert.equal(await page.locator('#account-overlay .auth-intro').evaluate(e=>getComputedStyle(e).marginTop),'0px');}
   if(process.env.AUTH_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.AUTH_SCREENSHOT_DIR,'rtc-'+url.split('/').filter(Boolean).join('-')+'.png')});
   assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/dashboard/assets/rtc-logo.ico');assert.ok(await page.locator('img[src="/dashboard/assets/rtc-logo.png"]').first().evaluate(i=>i.complete&&i.naturalWidth>0));
  }
  assert.deepEqual(errors,[]);console.log('PASS RTC authentication: light/dark OS, 1440/768/390/320px, logo assets, errors, forgot/reset/change password, login/logout, shared identity on all pages.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
