/* Shared form, table and local-file preview primitives for operational modules. */
(()=>{
 const GIS=window.GIS||{},esc=GIS.esc||(s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
 const previews=new Map(),tables=new Map();
 function files(input){
  if(previews.has(input))return;
  const toolbar=document.createElement('div');toolbar.className='ui-file-toolbar';
  const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=input.webkitdirectory?'Chọn thư mục ảnh':'Chọn tệp';button.onclick=()=>input.click();
  const count=document.createElement('span');count.className='muted';count.textContent='Chưa chọn tệp';
  input.classList.add('ui-native-file');input.after(toolbar);toolbar.append(button,count);
  const box=document.createElement('div');box.className='ui-file-preview';box.innerHTML='<p class="gis-empty">Tệp đã chọn và ảnh xem trước sẽ hiển thị tại đây.</p>';toolbar.after(box);
  const state={urls:[],box};previews.set(input,state);
  input.addEventListener('uav:file-reset',()=>{state.urls.forEach(URL.revokeObjectURL);state.urls=[];count.textContent='Chưa chọn tệp';box.innerHTML='<p class="gis-empty">Tệp đã chọn và ảnh xem trước sẽ hiển thị tại đây.</p>';});
  input.addEventListener('change',()=>{
   state.urls.forEach(URL.revokeObjectURL);state.urls=[];
   const selected=[...input.files];count.textContent=selected.length+' tệp · '+(selected.reduce((s,f)=>s+f.size,0)/1048576).toFixed(1)+' MB';
   box.innerHTML='';const images=document.createElement('div');images.className='ui-preview-grid';box.append(images);
   selected.filter(f=>/\.(jpe?g|png|webp)$/i.test(f.name)).slice(0,matchMedia('(max-width:900px)').matches?4:12).forEach(file=>{
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),url=URL.createObjectURL(file);state.urls.push(url);img.src=url;img.alt=file.name;img.loading='lazy';img.decoding='async';img.onerror=()=>{img.remove();figure.prepend(document.createTextNode('Không đọc được ảnh xem trước'));};caption.textContent=file.name;figure.append(img,caption);images.append(figure);
   });
   const list=document.createElement('div');list.className='tbl-wrap';list.innerHTML='<table class="ui-table"><thead><tr><th>Tên tệp</th><th>Dung lượng</th></tr></thead><tbody>'+selected.slice(0,20).map(f=>`<tr><td>${esc(f.name)}</td><td>${(f.size/1024).toFixed(1)} KB</td></tr>`).join('')+'</tbody></table>';box.append(list);
   if(selected.length>20){const p=document.createElement('p');p.textContent='Hiển thị 20/'+selected.length+' tệp; tối đa 12 ảnh xem trước. Tất cả tệp vẫn được giữ để tải lên.';box.append(p);}
  });
 }
 function tableTools(t){
  if(t.hasAttribute('data-no-paging'))return;
  if(t.closest('#task-list,#insight-alerts,#report-issue-table,.ui-file-preview,.leaflet-pane,.leaflet-control'))return;
  let st=tables.get(t);
  const rows=[...t.querySelectorAll('tbody>tr')].filter(r=>r.querySelector('td')&&!r.querySelector('td[colspan]'));
  if(st&&rows.length===st.rows.length&&rows.every((r,i)=>r===st.rows[i]))return;
  if(!st){
   const tools=document.createElement('div');tools.className='ui-filterbar';const label=document.createElement('label');label.textContent='Tìm trong danh sách';const search=document.createElement('input');search.type='search';search.className='input';search.placeholder='Nhập từ khóa…';label.append(search);tools.append(label);
   const footer=document.createElement('div');footer.className='ui-pagination';const count=document.createElement('span'),actions=document.createElement('div'),prev=document.createElement('button'),next=document.createElement('button');prev.type=next.type='button';prev.className=next.className='btn sm';prev.textContent='Trước';next.textContent='Sau';actions.append(prev,next);footer.append(count,actions);t.parentElement.before(tools);t.parentElement.after(footer);
   st={rows:[],page:1,search,tools,footer,count,prev,next};tables.set(t,st);
   st.draw=()=>{const size=t.closest('#gis-fp-routes,#gis-fh-list')?(innerHeight<500?1:innerHeight<650?2:3):(innerHeight<550?3:6),q=search.value.trim().toLocaleLowerCase('vi'),matches=st.rows.filter(r=>!q||r.textContent.toLocaleLowerCase('vi').includes(q)),pages=Math.max(1,Math.ceil(matches.length/size));st.page=Math.min(st.page,pages);const shown=new Set(matches.slice((st.page-1)*size,st.page*size));st.rows.forEach(r=>r.hidden=!shown.has(r));count.textContent=matches.length+' dòng · Trang '+st.page+'/'+pages;prev.disabled=st.page===1;next.disabled=st.page===pages;};search.oninput=()=>{st.page=1;st.draw();};prev.onclick=()=>{st.page--;st.draw();};next.onclick=()=>{st.page++;st.draw();};
  }
  st.rows=rows;st.draw();t.dataset.uiReady='true';
 }
 window.addEventListener('resize',()=>tables.forEach(st=>st.draw()));
 const blocks={'task-list':'Danh sách nhiệm vụ','task-form':'Thông tin & phân công','task-detail':'Tiến độ & dữ liệu nhiệm vụ','task-team':'Tổ công tác','task-scope':'Phạm vi đã chọn','gis-mi-result':'Kết quả nhập ảnh','gis-ds-preview':'Xem trước bộ ảnh xuất','insight-trend':'Biểu đồ & lịch sử nhiệt','insight-dcl-table':'Danh sách DCL đã kiểm tra','insight-alerts':'Danh sách cảnh báo'};
 function normalize(){
  document.querySelectorAll('#view-assets,#view-admin,.rtc-admin').forEach(root=>{
   root.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),select,textarea').forEach(e=>e.classList.add('input'));
   root.querySelectorAll('button').forEach(e=>{if(!e.closest('.leaflet-control')&&!e.classList.contains('gis-caret'))e.classList.add('btn');});
   root.querySelectorAll('input:not([type=checkbox]):not([type=file]):not([type=radio]):not([type=range]),select').forEach(e=>{
    if(e.labels?.length||e.closest('.leaflet-control,.gis-fh-player,.ui-filterbar,.fp-points-scroll'))return;
    const names={'task-found':'Kết quả tìm tài sản','insight-target':'Thiết bị cần xem','insight-ticket':'Phiếu kiểm tra','vision-media':'Ảnh gốc cần xử lý'};
    const text=names[e.id]||e.getAttribute('aria-label')||e.placeholder;
    if(!text)return;const label=document.createElement('label');label.className='field';const span=document.createElement('span');span.textContent=text;e.before(label);label.append(span,e);
   });
   root.querySelectorAll('form').forEach(e=>e.classList.add('ui-form'));
   root.querySelectorAll('.actions,.gis-row').forEach(e=>e.classList.add('ui-toolbar'));
   root.querySelectorAll('input[type=file]').forEach(files);
   Object.entries(blocks).forEach(([id,title])=>{const el=root.querySelector('#'+id);if(!el||el.parentElement.classList.contains('ui-section'))return;const section=document.createElement('section');section.className='ui-section';const h=document.createElement('h3');h.textContent=title;el.before(section);section.append(h,el);});
   root.querySelectorAll('table').forEach(t=>{t.classList.add('ui-table');if(!t.parentElement.matches('.tbl-wrap,.scroll,.ui-table-scroll')){const w=document.createElement('div');w.className='ui-table-scroll';t.before(w);w.append(t);}tableTools(t);});
  });
  const hints={'gis-ds-preview':'Chọn bộ lọc và bấm Xem trước để kiểm tra bộ ảnh trước khi xuất.','insight-trend':'Tìm và chọn thiết bị, sau đó bấm Xem lịch sử.','insight-dcl-table':'Chọn phiếu và bấm Tải danh sách để xem các lần kiểm tra.'};Object.entries(hints).forEach(([id,text])=>{const el=document.getElementById(id);if(el&&!el.childNodes.length){const p=document.createElement('p');p.className='gis-empty';p.textContent=text;el.append(p);}});
  GIS.Compact?.normalize();
  for(const [table,state]of tables)if(!table.isConnected){state.tools.remove();state.footer.remove();tables.delete(table);}
  for(const [input,state]of previews)if(!input.isConnected){state.urls.forEach(URL.revokeObjectURL);previews.delete(input);}
 }
 let pending=false;
 document.addEventListener('DOMContentLoaded',()=>{const root=document.getElementById('view-container')||document.body;new MutationObserver(()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;normalize();});}}).observe(root,{childList:true,subtree:true});normalize();});
})();
