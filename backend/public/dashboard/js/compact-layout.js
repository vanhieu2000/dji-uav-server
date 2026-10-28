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
  // Standard controls remain inline. Dialogs are opened only by explicit detail actions.
  document.querySelectorAll('.gis-tab-pane[data-pane="history"]').forEach(pane=>{
   if(pane.dataset.compactHistory)return;
   const grid=pane.querySelector('.gis-fp'),card=pane.querySelector('.gis-fp-form'),filter=pane.querySelector('#gis-fh-filter');
   if(grid&&card&&filter){pane.dataset.compactHistory='1';pane.prepend(filter);grid.after(card);card.classList.add('compact-history-list');}
  });
 }
 GIS.Compact={mount,reveal,closeAll,normalize};
 document.addEventListener('DOMContentLoaded',()=>{
  const positionControls=bar=>{const height=bar.getBoundingClientRect().height;if(height>0)(bar.closest('.mapbox')||bar.closest('.page-view'))?.style.setProperty('--map-controls-top',(bar.offsetTop+height+8)+'px');};
  const observer=new ResizeObserver(entries=>entries.forEach(({target})=>positionControls(target)));
  document.querySelectorAll('.map-osd-topbar').forEach(bar=>{observer.observe(bar);positionControls(bar);});
  window.fitCompactNavigation=()=>document.querySelector('aside .nav-btn.on')?.scrollIntoView({block:'nearest',inline:'nearest'});
 });
})();
