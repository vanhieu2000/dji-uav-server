/* Navigation groups expose full modules; small configuration stays under Settings. */
(()=>{
 const GIS=window.GIS;
 window.UAV_MODULES={
  'flight-plans':{tab:'flights',title:'Lập đường bay',description:'Thiết kế tuyến kiểm tra, xem trước và xuất tuyến bay.'},
  'flight-history':{tab:'history',title:'Lịch sử chuyến bay',description:'Tra cứu chuyến bay và phát lại hành trình đã ghi nhận.'},
  'missions':{tab:'tasks',title:'Phiếu kiểm tra & Lịch bay',description:'Tạo nhiệm vụ, phân công tổ kiểm tra và theo dõi ảnh theo phiếu.'},
  'vision':{tab:'vision',title:'Xử lý Vision',description:'Theo dõi xử lý ảnh và xác nhận kết quả phát hiện lỗi.'},
  'media-import':{tab:'media',title:'Nhập ảnh thẻ nhớ',description:'Đưa ảnh kiểm tra từ thẻ nhớ vào đúng phiếu.'},
  'photo-coverage':{tab:'coverage',title:'Kiểm tra đủ ảnh',description:'Đối chiếu ảnh đã nhận với các đối tượng cần kiểm tra.'},
  'vision-datasets':{tab:'datasets',title:'Xuất ảnh cho Vision',description:'Chuẩn bị và xuất tập ảnh cho quá trình phân tích.'},
  'alerts':{tab:'insights',title:'Cảnh báo & lịch sử nhiệt',description:'Tiếp nhận sự cố, theo dõi nhiệt độ và cấu hình ngưỡng riêng cho thiết bị.'}
 };
 let videoHome=null;
 window.placeLiveVideo=view=>{
  const video=document.getElementById('manual-live-video');if(!video)return;
  if(!videoHome) videoHome=video.parentElement;
  const target=view==='dashboard'?document.getElementById('dashboard-live-stage'):videoHome;
  if(video.parentElement!==target){const playing=!video.paused&&!video.ended;target.append(video);if(playing)video.play().catch(()=>{});}
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const shell=document.getElementById('app'),menu=document.getElementById('btn-toggle-sidebar');
  document.querySelector('aside').id='app-sidebar';menu.setAttribute('aria-controls','app-sidebar');
  const syncMenu=()=>menu.setAttribute('aria-expanded',String(matchMedia('(max-width:900px)').matches?shell.classList.contains('sidebar-mobile-open'):!shell.classList.contains('sidebar-collapsed')));
  new MutationObserver(syncMenu).observe(shell,{attributes:true,attributeFilter:['class']});syncMenu();
  shell.addEventListener('click',e=>{if(e.target===shell)shell.classList.remove('sidebar-mobile-open');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shell.classList.contains('sidebar-mobile-open')){shell.classList.remove('sidebar-mobile-open');menu.focus();}});
  const primary=document.querySelector('.overview-primary'),secondary=document.querySelector('.overview-secondary');
  const [live,stats]=[...primary.children],[issues,area]=[...secondary.children];
  const left=document.createElement('div'),right=document.createElement('div');left.className=right.className='overview-column';
  issues.classList.add('overview-issue-card');area.classList.add('overview-area-card');
  primary.replaceChildren(left,right);left.append(live,area);right.append(stats,issues);secondary.remove();
  const daily=document.createElement('section');daily.className='card daily-tickets-card';daily.style.cssText='padding:14px;margin-bottom:14px';daily.innerHTML='<div class="actions"><h3>Phiếu kiểm tra trong ngày</h3><button type="button" class="btn sm" id="daily-refresh">Làm mới</button><button type="button" class="btn sm" id="daily-all">Tất cả phiếu</button></div><div class="tbl-wrap" id="daily-tickets">Đang tải…</div>';primary.before(daily);
  async function dailyTickets(){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());try{const r=await GIS.api('GET','/api/tickets?date='+date);daily.querySelector('#daily-tickets').innerHTML='<table class="ui-table"><thead><tr><th>Phiếu</th><th>UAV</th><th>Trạng thái</th><th></th></tr></thead><tbody>'+r.data.map(t=>`<tr><td>${GIS.esc(t.ticket_name)}</td><td>${GIS.esc(t.assigned_device_sn||'Chưa giao')}</td><td>${GIS.esc(({PENDING:'Chờ giao',ASSIGNED:'Đã giao',EXECUTING:'Đang thực hiện',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy'})[t.status]||t.status)}</td><td>${t.status==='EXECUTING'?`<button class="btn sm" style="color:#dc3545" data-live="${t.ticket_id}" data-sn="${GIS.esc(t.assigned_device_sn||'')}">🔴 Xem Live</button>`:''}</td></tr>`).join('')+'</tbody></table>';if(!r.data.length)daily.querySelector('#daily-tickets').textContent='Chưa có phiếu trong ngày.';}catch(e){daily.querySelector('#daily-tickets').textContent=e.message;}}
  daily.querySelector('#daily-refresh').onclick=dailyTickets;daily.querySelector('#daily-all').onclick=()=>window.switchView('missions');daily.addEventListener('click',e=>{const b=e.target.closest('[data-live]');if(b)window.openTicketLive?.(Number(b.dataset.live),b.dataset.sn);});dailyTickets();setInterval(()=>{if(document.getElementById('view-dashboard')?.classList.contains('active'))dailyTickets();},15000);
  const root=document.getElementById('settings-module-root');
  root.innerHTML=['profiles','import','basemaps'].map(tab=>`<div class="settings-pane" data-settings-pane="${tab}" hidden></div>`).join('');
  document.querySelectorAll('[data-settings]').forEach(button=>button.onclick=()=>{
   const tab=button.dataset.settings;
   document.querySelectorAll('[data-settings]').forEach(b=>{b.classList.toggle('on',b===button);b.setAttribute('aria-selected',String(b===button));});
   document.getElementById('settings-system-pane').hidden=tab!=='system';root.hidden=tab==='system';
   root.querySelectorAll('[data-settings-pane]').forEach(p=>p.hidden=p.dataset.settingsPane!==tab);
   const pane=root.querySelector(`[data-settings-pane="${tab}"]`);
   if(pane&&!pane.dataset.ready){pane.dataset.ready='1';if(tab==='profiles')GIS.Profiles.render(pane);if(tab==='import')GIS.Import.render(pane);if(tab==='basemaps')GIS.BaseMaps.render(pane);}
  });
  document.getElementById('dashboard-period').onchange=()=>GIS.Insights.overview();
  window.addEventListener('hashchange',()=>{const route=location.hash.slice(1);if(route&&route!==window.lastWorkspaceRoute){window.lastWorkspaceRoute=route;const active=document.querySelector('.nav-btn.on')?.dataset.target;if(route!==active&&window.switchView)window.switchView(route);}});
 });
})();
