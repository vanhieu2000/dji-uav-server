/* Compact overview + native detail dialogs. Original nodes keep handlers and form state. */
(()=>{
 const GIS=window.GIS,entries=new WeakMap();let sequence=0;
 function closeAll(){document.querySelectorAll('dialog.compact-dialog[open]').forEach(d=>d.close());}
 function mount(element,title,label='Xem chi tiết'){
  if(!element||entries.has(element)||element.closest('dialog'))return entries.get(element);
  const slot=document.createElement('div');slot.className='compact-launch';
  const text=document.createElement('span');text.textContent=title;const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=label;slot.append(text,button);element.before(slot);element.classList.add('compact-stored');
  const entry={slot,button,element,title};entries.set(element,entry);button.onclick=()=>reveal(element,title);return entry;
 }
 function unmount(element){const e=entries.get(element);if(!e||element.closest('dialog'))return;element.classList.remove('compact-stored');if(e.slot.isConnected)e.slot.replaceWith(element);entries.delete(element);}
 function reveal(element,title){
  if(!element)return;const existing=element.closest('dialog.compact-dialog');if(existing){if(!existing.open){closeAll();existing.showModal();}return;}
  if(!entries.has(element)&&element.closest('.page-view')&&element.tagName!=='DETAILS'&&!element.dataset.compactInline)mount(element,title||'Chi tiết');
  closeAll();const entry=entries.get(element),anchor=document.createComment('detail origin');element.before(anchor);
  const dialog=document.createElement('dialog');dialog.className='compact-dialog';const header=document.createElement('header'),heading=document.createElement('h2'),close=document.createElement('button'),body=document.createElement('div');heading.id='compact-detail-'+(++sequence);heading.textContent=title||entry?.title||'Chi tiết';dialog.setAttribute('aria-labelledby',heading.id);close.type='button';close.className='btn compact-close';close.textContent='Đóng';close.onclick=()=>dialog.close();header.append(heading,close);body.className='compact-dialog-body';header.className='compact-dialog-head';body.append(element);dialog.append(header,body);
  let mapAnchor=null,mapBox=null;if(element.id==='gis-fh-detail'){mapBox=anchor.parentElement.closest('.gis-tab-pane')?.querySelector('.gis-fp-mapbox');if(mapBox){mapAnchor=document.createComment('map origin');mapBox.before(mapAnchor);body.prepend(mapBox);}}
  (anchor.parentElement.closest('#gis-fp-routes,#insights-reports-root,.gis-tab-pane,.settings-pane,.page-view')||document.body).append(dialog);
  dialog.addEventListener('submit',e=>{if(e.target.matches('.ui-filterbar,#gis-fh-filter'))queueMicrotask(()=>dialog.close());});
  dialog.addEventListener('close',()=>{if(element.tagName==='DETAILS')element.open=false;if(mapAnchor?.isConnected)mapAnchor.replaceWith(mapBox);if(anchor.isConnected)anchor.replaceWith(element);dialog.remove();if(entry?.button.isConnected)entry.button.focus({preventScroll:true});requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));},{once:true});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});dialog.showModal();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
 }
 function group(pane,id,nodes,title){if(pane.querySelector('#'+id)||!nodes[0])return;const box=document.createElement('section');box.id=id;box.className='ui-section';nodes[0].before(box);nodes.filter(Boolean).forEach(n=>box.append(n));mount(box,title);}
 function normalize(){
  document.querySelectorAll('.gis-tab-pane').forEach(pane=>{
   for(const [id,title,label]of [['task-form','Thông tin & phân công','Tạo / sửa nhiệm vụ'],['task-detail','Tiến độ nhiệm vụ','Xem tiến độ'],['gis-fp-stats','Thông số đường bay','Xem thông số']]){const e=pane.querySelector('#'+id);if(e){const target=e.parentElement.classList.contains('ui-section')?e.parentElement:e,entry=entries.get(target);if(entry&&id==='task-detail')entry.slot.hidden=!e.childElementCount;if(id!=='task-detail'||e.childElementCount)mount(target,title,label);}}
   if(pane.dataset.pane==='history'&&!pane.dataset.compactHistory){
    const grid=pane.querySelector('.gis-fp'),card=pane.querySelector('.gis-fp-form'),filter=pane.querySelector('#gis-fh-filter');
    if(grid&&card&&filter){pane.dataset.compactHistory='1';pane.prepend(filter);grid.after(card);card.classList.add('compact-history-list');}
   }
   if(innerWidth<650||innerHeight<600){for(const id of ['task-list-filter','insight-list-filter','gis-fh-filter']){const f=pane.querySelector('#'+id);if(f)mount(f,'Tìm kiếm & bộ lọc','Mở bộ lọc');}}
   const search=pane.querySelector('#insight-search');if(search)group(pane,'compact-temperature',[search.closest('.actions'),pane.querySelector('#insight-trend')?.closest('.ui-section'),pane.querySelector('#insight-rule')?.closest('details')],'Tra cứu lịch sử nhiệt');
   const ticket=pane.querySelector('#insight-ticket');if(ticket)group(pane,'compact-dcl',[ticket.closest('.actions'),pane.querySelector('#insight-dcl-table')?.closest('.ui-section')],'DCL đã kiểm tra');
  });
  const dashboard=document.getElementById('view-dashboard'),actions=dashboard?.querySelector('.page-head .actions');
  for(const [selector,title,label]of [['.overview-area-card','Lỗi theo khu vực','Lỗi theo khu vực'],['.overview-issue-card','Sự cố mới nhất','Xem sự cố']]){const card=dashboard?.querySelector(selector);if(card&&!entries.has(card)){const e=mount(card,title,label);e.slot.querySelector('span').remove();actions?.append(e.slot);}}
  for(const [selector,title]of [['.overview-live-card','Giám sát trực tiếp'],['.overview-statistics','Thống kê kiểm tra']]){const card=dashboard?.querySelector(selector);if(card){if(innerWidth<=1100||innerHeight<650)mount(card,title,'Mở view');else unmount(card);}}
  const report=document.getElementById('insights-reports-root'),visuals=report?.querySelector('#report-visuals'),register=report?.querySelector('#report-register');
  if(visuals&&register&&!report.querySelector('.compact-report-tabs')){
   const tabs=document.createElement('div');tabs.className='compact-report-tabs';
   for(const [target,label]of [[visuals,'Tổng hợp'],[register,'Bảng sự cố']]){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.onclick=()=>{visuals.hidden=target!==visuals;register.hidden=target!==register;tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('primary',x===b));};tabs.append(b);}
   visuals.before(tabs);const all=report.querySelector('#insight-period')?.value==='all';tabs.children[all?1:0].click();
  }
  const charts=visuals?.querySelector('.report-charts');if(charts&&!entries.has(charts))mount(charts,'Biểu đồ báo cáo','Xem biểu đồ');
  if(innerHeight<600){const filters=register?.querySelector('#report-filter-form');if(filters)mount(filters,'Lọc sự cố','Mở bộ lọc');}
  document.querySelectorAll('.ui-file-preview').forEach(box=>{if(box.dataset.compactInline)return;box.dataset.compactInline='1';const b=document.createElement('button');b.type='button';b.className='btn compact-file-more';b.textContent='Xem ảnh & danh sách tệp';b.onclick=()=>reveal(box,'Tệp đã chọn');box.after(b);});
  if(!document.querySelector('dialog.compact-dialog[open]')){
   const view=document.querySelector('.page-view.active.view-scrollable');
   if(view&&view.id!=='view-dashboard'&&!view.querySelector('.gis-tab-pane[data-pane=flights]:not([hidden]),.gis-tab-pane[data-pane=history]:not([hidden])')){
    for(let i=0;i<3&&view.scrollHeight>view.clientHeight+3;i++){
     const candidates=[...view.querySelectorAll('.card,.gis-assets-layout,.gis-profiles')].filter(e=>!e.closest('dialog')&&!e.classList.contains('compact-stored')&&e.getBoundingClientRect().height>view.clientHeight*.6).sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height);
     const target=candidates[0];if(!target)break;mount(target,target.querySelector('h2,h3')?.textContent||document.getElementById('topbar-current-title').textContent,'Mở view chi tiết');
    }
   }
  }
  document.querySelectorAll('#view-assets details').forEach(d=>{if(d.dataset.compactBound||d.closest('dialog'))return;d.dataset.compactBound='1';d.addEventListener('toggle',()=>{if(d.open&&!d.closest('dialog')){const title=d.querySelector('summary')?.textContent;reveal(d,title);}});});
 }
 GIS.Compact={mount,reveal,closeAll,normalize};
 document.addEventListener('DOMContentLoaded',()=>{
  const groups=[...document.querySelectorAll('aside .nav-tree')],nav=document.querySelector('aside>.nav');
  function fit(){const active=document.querySelector('.nav-btn.on')?.closest('details');groups.forEach(g=>{g.open=g===active;});if(nav.scrollHeight>nav.clientHeight+2&&active)active.open=false;}
  window.fitCompactNavigation=fit;
  groups.forEach(g=>g.querySelector('summary').onclick=e=>{e.preventDefault();const open=!g.open;groups.forEach(x=>x.open=false);if(!open)return;g.open=true;if(nav.scrollHeight>nav.clientHeight+2){g.open=false;const menu=document.createElement('div');menu.className='compact-menu';g.querySelectorAll('.nav-btn').forEach(link=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=link.textContent;b.onclick=()=>{closeAll();window.switchView(link.dataset.target);};menu.append(b);});document.body.append(menu);reveal(menu,g.querySelector('summary').textContent);const d=menu.closest('dialog');d.addEventListener('close',()=>menu.remove(),{once:true});}});
  requestAnimationFrame(fit);window.addEventListener('resize',()=>{fit();normalize();});
 });
})();
