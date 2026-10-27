const engines=require('playwright-core'),engineName=process.env.BROWSER_ENGINE||'chromium',express=require('express'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const app=express();app.use('/dashboard',express.static(path.resolve(__dirname,'../public/dashboard')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await engines[engineName].launch({...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}:{}),headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],commands=[],reportQueries=[];let loggedIn=true,rules=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.WebSocket=class{constructor(){setTimeout(()=>this.onopen?.(),10)}send(){}close(){}};});
  const charts={tickets:[{day:'2026-10-24',total:7,completed:3},{day:'2026-10-25',total:4,completed:1},{day:'2026-10-26',total:6,completed:6}],statuses:[{status:'COMPLETED',total:10},{status:'EXECUTING',total:7}],defects:[{code:'HOTSPOT_PANEL',total:8}],areas:[{area_name:'Khu A',total:6}],temperatures:[{day:'2026-10-25',max_temp_c:72},{day:'2026-10-26',max_temp_c:78}],levels:[{level:'CRITICAL',total:30},{level:'WARNING',total:15}]};
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());if(u.origin!==base)return r.fulfill({status:200,body:''});if(!u.pathname.startsWith('/api/'))return r.continue();
   if(r.request().method()!=='GET')commands.push(u.pathname);let data=[];
   if(u.pathname==='/api/vision/rules')data=rules;
   if(u.pathname==='/api/vision/rules/PANEL'){assert.equal(r.request().method(),'PUT');const rule=r.request().postDataJSON();assert.deepEqual(rule,{max_temp_c:75,delta_t_c:null,min_confidence:0.95,trend_horizon_days:null,enabled:true});rules=[{asset_type:'PANEL',...rule}];}
   if(u.pathname==='/api/auth/me'&&!loggedIn)return r.fulfill({status:401,json:{code:401,message:'Đăng nhập lại'}});
   if(u.pathname==='/api/auth/change-password'){assert.deepEqual(r.request().postDataJSON(),{old_password:'old-password',new_password:'new-password-123'});loggedIn=false;}
   if(u.pathname==='/api/auth/me')data={username:'fixture',full_name:'RTC Fixture',role:'ADMIN',email:'fixture@example.com'};
   if(u.pathname==='/api/health')data={db:{connected:true}};
   if(u.pathname==='/api/workspace/context')data={plants:[]};
   if(u.pathname==='/api/insights/charts')data=charts;
   if(u.pathname==='/api/insights/alert-report'){
    reportQueries.push(u.searchParams.toString());const pageNum=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('page_size')||20),filtered=!!u.searchParams.get('q'),count=filtered?1:45;
    data={items:Array.from({length:Math.max(0,Math.min(size,count-(pageNum-1)*size))},(_,i)=>({alert_id:1000-(pageNum-1)*size-i,title:i?'Sự cố nhiệt '+i:'<img src=x onerror="window.fixtureXSS=1">',message:'Chi tiết lỗi kiểm tra',alert_level:i%2?'WARNING':'CRITICAL',status:'UNREAD',created_at:'2026-10-26T10:00:00Z',ticket_code:'PKT-001'})),total:count,page:pageNum,page_size:size};
   }
   if(u.pathname==='/api/monitoring/photos')data={items:[],next_id:0,has_more:false};
   if(u.pathname==='/api/monitoring/live/1')data=[{streamPath:'/live/ticket_1_0123456789abcdef',status:'STREAMING',device_sn:'UAV-A',flv_url:base+'/fake.flv'}];
   if(u.pathname==='/api/reports/overview')data={completed_tickets:10,total_tickets:17,faulty_panels:6,overheated_disconnectors:2,max_disconnector_temperature:78};
   if(u.pathname==='/api/tickets')data=[{ticket_id:1,ticket_code:'PKT-001',ticket_name:'Fixture',inspection_type:'SOLAR_PANEL'}];
   if(u.pathname==='/api/assets/tree')data={plant:{plant_id:1,plant_code:'TEST',plant_name:'Fixture'},areas:[],substations:[]};
   if(u.pathname==='/api/assets/features')data={};
   return r.fulfill({json:{code:0,data}});
  });
  await page.goto(base+'/dashboard/');await page.waitForSelector('#dashboard-bar-chart svg');await page.waitForSelector('.overview-issue');assert.equal(await page.locator('.overview-issue').count(),5);assert.equal(await page.locator('.overview-issue img').count(),0);assert.equal(await page.evaluate(()=>window.fixtureXSS),undefined);
  if(process.env.WORKSPACE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.WORKSPACE_SCREENSHOT_DIR,'overview-fixture.png')});
  assert.equal(await page.locator('#account-sidebar .account-secondary').count(),0);assert.equal(await page.locator('#account-sidebar a[href="/dashboard/accounts.html"]').count(),0);
  for(const width of [1440,1024,768,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(300);
   const b=await page.evaluate(()=>{const s=document.getElementById('dashboard-live-stage'),c=s.closest('.card'),r=s.getBoundingClientRect(),cr=c.getBoundingClientRect();return {width:r.width,height:r.height,contained:r.right<=cr.right&&r.left>=cr.left,overflow:document.querySelector('#view-dashboard').scrollWidth>document.querySelector('#view-dashboard').clientWidth};});
   assert.ok(b.contained&&b.width>200&&b.height<370,JSON.stringify({width,b}));assert.equal(b.overflow,false);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.selectOption('#uav-live-ticket','1');await page.waitForSelector('#uav-live-stream option[value="/live/ticket_1_0123456789abcdef"]',{state:'attached'});
  await page.evaluate(()=>{window.fixturePlayback=[];window.startFlvLivePlayer=(...a)=>window.fixturePlayback.push(a);});
  await page.selectOption('#uav-live-stream','/live/ticket_1_0123456789abcdef');assert.equal(await page.locator('.page-view.active').getAttribute('id'),'view-dashboard');assert.equal(await page.locator('#dashboard-live-stage #manual-live-video').count(),1);assert.equal((await page.evaluate(()=>window.fixturePlayback)).length,1);await page.evaluate(()=>switchView('control-manual'));assert.equal(await page.locator('#manual-live-pip #manual-live-video').count(),1);
  await page.evaluate(()=>switchView('dashboard'));await page.click('#overview-all-issues');await page.waitForFunction(()=>document.getElementById('insight-period')?.value==='all');await page.waitForSelector('[data-report-alert]');assert.equal(await page.locator('#insight-period').inputValue(),'all');assert.equal(await page.locator('[data-report-alert]').count(),20);assert.ok(await page.locator('.report-charts svg').count()>=5);if(process.env.WORKSPACE_SCREENSHOT_DIR){await page.locator('#view-reports').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(process.env.WORKSPACE_SCREENSHOT_DIR,'reports-fixture.png')});}const first=await page.locator('[data-report-alert]').first().getAttribute('data-report-alert');await page.click('#report-next');await page.waitForFunction(id=>document.querySelector('[data-report-alert]')?.dataset.reportAlert!==id,first);assert.equal(await page.locator('[data-report-alert]').first().getAttribute('data-report-alert'),'980');
  await page.fill('#report-filter-form [name=q]','hotspot');await page.click('#report-filter-form [type=submit]');await page.waitForFunction(()=>document.querySelectorAll('[data-report-alert]').length===1);assert.ok(reportQueries.some(q=>q.includes('q=hotspot')&&q.includes('page=1')));assert.equal(await page.locator('#report-next').isDisabled(),true);
  for(const route of ['flight-plans','flight-history','missions','media-import','photo-coverage','vision','vision-datasets','alerts','assets']){await page.evaluate(v=>switchView(v),route);await page.waitForTimeout(180);assert.equal(await page.locator('.page-view.active').getAttribute('id'),'view-assets');assert.equal(await page.locator('.gis-page-tabs').count(),0);assert.ok(await page.locator(`.nav-btn[data-target="${route}"]`).evaluate(e=>e.closest('details').open));}
  await page.evaluate(()=>switchView('admin'));for(const tab of ['profiles','import','basemaps','system']){await page.click(`[data-settings="${tab}"]`);await page.waitForTimeout(180);assert.equal(await page.locator('#settings-system-pane').isVisible(),tab==='system');}
  const panelRule=page.locator('#settings-alert-rules [data-rule=PANEL]');await panelRule.locator('[name=max_temp_c]').fill('75');await panelRule.locator('[name=min_confidence]').fill('0.95');await panelRule.locator('[name=enabled]').check();await panelRule.locator('button').click();await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('Đã lưu ngưỡng'));await page.click('#settings-alert-rules [data-reload-rules]');await page.waitForFunction(()=>document.querySelector('#settings-alert-rules [data-rule=PANEL] [name=max_temp_c]')?.value==='75');
  await page.evaluate(()=>switchView('account'));await page.waitForSelector('#account-profile dd');assert.ok((await page.locator('#account-profile').innerText()).includes('fixture@example.com'));await page.fill('#account-password-form [name=old_password]','old-password');await page.fill('#account-password-form [name=new_password]','new-password-123');await page.fill('#account-password-form [name=confirm_password]','different-password');await page.click('#account-password-form button');assert.match(await page.locator('#account-password-status').innerText(),/chưa khớp/);assert.deepEqual(commands,['/api/vision/rules/PANEL']);
  await page.fill('#account-password-form [name=confirm_password]','new-password-123');await page.click('#account-password-form button');await page.waitForSelector('#account-overlay [name=username]');assert.deepEqual(commands,['/api/vision/rules/PANEL','/api/auth/change-password']);loggedIn=true;
  await page.goto(base+'/dashboard/?relogin=1#flight-history');await page.waitForFunction(()=>document.querySelector('.nav-btn.on')?.dataset.target==='flight-history');assert.match(await page.locator('#module-page-title').innerText(),/Lịch sử/);assert.deepEqual(errors,[]);
  for(const [width,height] of [[320,740],[390,844],[768,1024],[1024,768],[844,390],[390,430]]){
   await page.setViewportSize({width,height});
   for(const route of ['dashboard','reports','account','admin','missions','assets','flight-plans','flight-history','media-import','photo-coverage','vision','vision-datasets','alerts','map-solar','map-substation','control-manual']){
    await page.evaluate(v=>switchView(v),route);await page.waitForTimeout(100);
    const b=await page.evaluate(()=>{const p=document.querySelector('.page-view.active');return {overflow:p.scrollWidth-p.clientWidth,height:p.clientHeight};});
    assert.ok(b.overflow<=2&&b.height>100,JSON.stringify({width,height,route,b}));
   }
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#btn-toggle-sidebar').click();assert.equal(await page.locator('#btn-toggle-sidebar').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('aside').isVisible(),false);await page.locator('#btn-toggle-sidebar').click();await page.mouse.click(380,120);assert.equal(await page.locator('aside').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS workspace: bounded live at 4 widths, one video follows view, 5 latest incidents, real SVG charts, paginated/filtered table, escaped titles, tree routes/deep link, settings groups and account validation.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
