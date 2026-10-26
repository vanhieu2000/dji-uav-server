/* F: nhiệm vụ, tổ công tác, phạm vi tài sản và dữ liệu nhiều lượt bay. */
(function(){
  'use strict';
  const GIS=window.GIS,esc=GIS.esc;let root=null,selected=null,current=null,scope=[],crew=[];
  const label={PENDING:'Chờ giao',ASSIGNED:'Đã giao',EXECUTING:'Đang thực hiện',COMPLETED:'Hoàn tất',CANCELLED:'Đã hủy'};
  const scopeOf=d=>({SOLAR_AREA:['AREA',d.area_id],SOLAR_STRING:['STRING',d.string_id],SOLAR_PANEL:['PANEL',d.panel_id],SUBSTATION_BAY:['BAY',d.bay_id],DISCONNECTOR:['DISCONNECTOR',d.disconnector_id],DCL_CONTACT:['CONTACT',d.contact_id]})[d.item_type];
  function drawScope(){root.querySelector('#task-scope').innerHTML=scope.map((s,i)=>`<span class="tag">${esc(s.label||s.type+' #'+s.id)} <button type="button" data-remove="${i}" aria-label="Bỏ khỏi phạm vi">×</button></span>`).join(' ')||'<span class="faint">Chưa chọn tài sản cụ thể</span>';}
  async function list(){const r=await GIS.api('GET','/api/tickets');root.querySelector('#task-list').innerHTML=r.data.map(t=>`<button class="btn sm" data-task="${t.ticket_id}" style="margin:4px">${esc(t.ticket_code)} · ${esc(label[t.status]||t.status)}</button>`).join('')||'<div class="gis-empty">Chưa có phiếu.</div>';}
  function value(k){return root.querySelector(`[name="${k}"]`).value;}
  function set(k,v){root.querySelector(`[name="${k}"]`).value=v??'';}
  function localTime(s){if(!s)return '';const d=new Date(s);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
  function reset(){selected=null;current=null;scope=[];crew=[];root.querySelector('#task-form').reset();drawScope();root.querySelector('#task-detail').innerHTML='';}
  async function open(id,refreshOnly=false){
    const r=await GIS.api('GET',`/api/tickets/${id}`),d=r.data;selected=id;
    if(!refreshOnly){current=d.ticket;
    for(const k of ['ticket_name','inspection_type','target_facility','team_id','capture_profile_id','assigned_device_sn'])set(k,current[k]);
    set('planned_start_at',localTime(current.planned_start_at));set('planned_end_at',localTime(current.planned_end_at));
    root.querySelector('[name="vision_required"]').checked=!!current.vision_required;
    root.querySelector('[name="route_ids"]').querySelectorAll('option').forEach(o=>o.selected=d.routes.some(r=>String(r.route_id)===o.value));
    crew=d.crew.map(x=>x.user_id);scope=d.scope.map(s=>{const a=scopeOf(s);return a?{type:a[0],id:a[1],label:s.label||'Tài sản đã xóa'}:null;}).filter(s=>s&&s.id);drawScope();
    }
    const p=d.progress;
    root.querySelector('#task-detail').innerHTML=`<h3>${esc(current.ticket_code)}</h3><p>Bay: ${p.flight_state==='AIRBORNE'?'Đang bay':'Không có lượt đang mở'} · Ảnh: ${({RECONCILED:'Đã đối soát',RECEIVING:'Chờ đối soát',NOT_STARTED:'Chưa nhận ảnh'})[p.sync_state]} · Vision: ${p.vision_ready?'Đạt điều kiện':'Chưa đủ kết quả'}</p>
      <p>${p.photos.originals} ảnh gốc · ${p.photos.duplicates} lượt tải trùng · ${p.photos.failed_attempts} lỗi tải · ${p.photos.late} ảnh đến muộn · ${p.photos.unassigned_flight} ảnh chưa gắn lượt bay</p>
      <div class="actions">${['ASSIGNED','EXECUTING','COMPLETED','CANCELLED'].map(s=>`<button class="btn sm" data-status="${s}" ${s==='COMPLETED'&&!p.can_complete?'disabled':''}>${label[s]}</button>`).join('')}</div>
      <h4>${p.flights.length} lượt bay của phiếu</h4>${p.flights.map(f=>`<div>Lượt #${f.flight_session_id} · ${esc(f.device_sn)} · ${esc(new Date(f.started_at).toLocaleString('vi-VN'))} · ${esc(f.end_reason||'Đang bay')}</div>`).join('')||'<p>Chưa có chuyến bay.</p>'}
      <form id="task-reconcile"><h4>Đối soát ảnh gốc</h4><label>Số file gốc dự kiến từ thẻ nhớ/nhóm file <input name="expected" type="number" min="1" step="1" value="${p.expected_media_count??''}" required></label><label>Nguồn đối soát <input name="note" placeholder="Manifest / số file trên thẻ nhớ…" required></label><label><input name="checked" type="checkbox" required> Đã đối chiếu ảnh gốc, không tính thumbnail/snapshot</label><button class="btn">Kiểm tra file và hash</button></form>
      <h4>Ảnh trong phiếu</h4><div style="display:flex;flex-wrap:wrap;gap:12px">${d.photos.slice(0,200).map(m=>`<figure style="width:140px;margin:0"><a href="${esc(m.file_url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(m.file_url)}" style="width:140px;height:100px;object-fit:cover" alt="${esc(m.file_name)}"></a><figcaption>${esc(m.lens||m.media_type)} · lượt ${esc(m.flight_session_id||'chưa gắn')}<br>${({EXPLICIT:'Đã xác nhận',FLIGHT:'Theo lượt bay',SESSION:'Theo phiên Pilot',UNRESOLVED:'Chưa xác định'})[m.assignment_status]||'Chưa xác định'}</figcaption></figure>`).join('')}</div>`;
    const eventBox=document.createElement('details');eventBox.innerHTML='<summary>Nhật ký nhận ảnh</summary><div class="task-ingest-events">Đang tải…</div>';root.querySelector('#task-detail').appendChild(eventBox);
    GIS.api('GET',`/api/tickets/${id}/ingest-events`).then(r=>{eventBox.querySelector('div').innerHTML=r.data.map(e=>`<div>${esc(e.original_name)} · ${({created:'Đã nhận',duplicate:'Trùng ảnh',failed:'Lỗi nhận ảnh'})[e.status]||esc(e.status)} · ${esc(e.note||'')}</div>`).join('')||'Chưa có sự kiện upload.';}).catch(()=>{});
    root.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>GIS.run(async()=>{await GIS.api('PATCH',`/api/tickets/${id}/status`,{status:b.dataset.status});await open(id);await list();}));
    root.querySelector('#task-reconcile').onsubmit=e=>{e.preventDefault();const f=e.target;GIS.run(async()=>{await GIS.api('POST',`/api/tickets/${id}/reconcile`,{expected_count:Number(f.expected.value),note:f.note.value,originals_checked:f.checked.checked});await open(id);});};
  }
  let refreshTimer=null;
  GIS.on('runtime',msg=>{ if(!selected||!root||!root.isConnected||root.hidden)return; if(['media_synced','media_ingest','flight_started','flight_ended','vision_result'].includes(msg.type)){ clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>GIS.run(()=>open(selected,true)),500); } });
  GIS.Tasks={open:id=>GIS.run(()=>open(id)),render(el){
    root=el;selected=null;current=null;scope=[];
    root.innerHTML=`<div class="card" style="padding:16px"><h2>Nhiệm vụ kiểm tra</h2><p>Giao phạm vi và hồ sơ chụp; phi công thực hiện trong Pilot 2. Kết thúc bay không tự hoàn tất đối soát ảnh.</p><button class="btn" id="task-new">Tạo phiếu mới</button><div id="task-list"></div>
      <form id="task-form"><div class="grid g-2"><label>Tên phiếu <input name="ticket_name" required maxlength="255"></label><label>Loại kiểm tra <select name="inspection_type"><option value="SOLAR_PANEL">Tấm pin</option><option value="DISCONNECTOR">Dao cách ly</option><option value="OVERALL_SURVEY">Tổng hợp</option></select></label><label>Mô tả phạm vi <input name="target_facility" required maxlength="255"></label><label>Tổ công tác <select name="team_id"><option value="">Chưa giao tổ</option></select></label><label>Hồ sơ chụp <select name="capture_profile_id"><option value="">Chưa chọn</option></select></label><label>UAV <select name="assigned_device_sn"><option value="">Chưa giao UAV</option></select></label><label>Bắt đầu kế hoạch <input name="planned_start_at" type="datetime-local"></label><label>Kết thúc kế hoạch <input name="planned_end_at" type="datetime-local"></label><label>Tuyến bay (chọn nhiều)<select name="route_ids" multiple></select></label><label><input type="checkbox" name="vision_required"> Chỉ hoàn tất khi đủ kết quả Vision</label></div>
      <div class="actions"><input id="task-search" placeholder="Tìm mã khu / chuỗi / tấm / DCL / mối nối"><button type="button" id="task-find" class="btn sm">Tìm tài sản</button><select id="task-found"><option>Chưa tìm</option></select><button type="button" id="task-add" class="btn sm">Thêm vào phạm vi</button></div><div id="task-scope"></div><button class="btn primary" style="margin:12px 0">Lưu phiếu</button></form>
      <details><summary>Tạo tổ công tác</summary><form id="task-team"><input name="name" placeholder="Tên tổ" required><select name="members" multiple></select><button class="btn">Lưu tổ</button></form></details><div id="task-detail"></div><details><summary>Ảnh chưa xác định nhiệm vụ</summary><button type="button" class="btn sm" id="task-inbox-refresh">Tải danh sách</button><div id="task-inbox"></div></details></div>`;
    const fill=async()=>{
      const [teams,profiles,routes,devs,people]=await Promise.all([GIS.api('GET','/api/teams'),GIS.api('GET','/api/capture-profiles'),GIS.api('GET','/api/flight-plans'),GIS.api('GET','/api/devices'),GIS.api('GET','/api/teams/people')]);
      root.querySelector('[name="team_id"]').innerHTML='<option value="">Chưa giao tổ</option>'+teams.data.map(t=>`<option value="${t.team_id}">${esc(t.team_name)}</option>`).join('');
      root.querySelector('[name="capture_profile_id"]').innerHTML='<option value="">Chưa chọn</option>'+profiles.data.map(p=>`<option value="${p.profile_id}">${esc(p.profile_name)}</option>`).join('');
      root.querySelector('[name="route_ids"]').innerHTML=routes.data.map(r=>`<option value="${r.route_id}">${esc(r.route_name)}</option>`).join('');
      root.querySelector('[name="assigned_device_sn"]').innerHTML='<option value="">Chưa giao UAV</option>'+devs.data.filter(d=>d.device_type==='DRONE').map(d=>`<option value="${esc(d.device_sn)}">${esc(d.device_name)} · ${esc(d.device_sn)}</option>`).join('');
      root.querySelector('#task-team [name="members"]').innerHTML=people.data.map(p=>`<option value="${p.user_id}">${esc(p.full_name||p.username)}</option>`).join('');
    };
    root.querySelector('#task-new').onclick=reset;
    root.querySelector('#task-inbox-refresh').onclick=()=>GIS.run(async()=>{
      const r=await GIS.api('GET','/api/tickets/unresolved-media');
      root.querySelector('#task-inbox').innerHTML=r.data.map(m=>`<div>${esc(m.file_name)} · ${esc(m.device_sn)} · ${esc(m.captured_at?new Date(m.captured_at).toLocaleString('vi-VN'):'Chưa rõ giờ chụp')} <button class="btn sm" data-assign="${m.media_id}">Gắn vào phiếu đang mở</button></div>`).join('')||'Không có ảnh chưa gắn.';
    });
    root.querySelector('#task-inbox').onclick=e=>{const b=e.target.closest('[data-assign]');if(!b)return;GIS.run(async()=>{
      if(!selected)throw new Error('Mở phiếu cần nhận ảnh trước');
      if(!confirm('Xác nhận ảnh này thuộc phiếu đang mở? Thao tác được lưu vào nhật ký.'))return;
      await GIS.api('POST',`/api/tickets/${selected}/media/${b.dataset.assign}/assign`,{confirmed:true});await open(selected);b.closest('div').remove();
    });};
    root.querySelector('#task-list').onclick=e=>{const b=e.target.closest('[data-task]');if(b)GIS.run(()=>open(Number(b.dataset.task)));};
    root.querySelector('#task-find').onclick=()=>GIS.run(async()=>{const r=await GIS.api('GET','/api/assets/search?q='+encodeURIComponent(root.querySelector('#task-search').value));root.querySelector('#task-found').innerHTML=r.data.filter(a=>['area','string','panel','bay','disconnector','contact'].includes(a.type)).map(a=>`<option value="${a.type.toUpperCase()}:${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');});
    root.querySelector('#task-add').onclick=()=>{const o=root.querySelector('#task-found').selectedOptions[0];if(!o||!o.value.includes(':'))return;const [type,id]=o.value.split(':');if(!scope.some(s=>s.type===type&&s.id===Number(id)))scope.push({type,id:Number(id),label:o.textContent});drawScope();};
    root.querySelector('#task-scope').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){scope.splice(Number(b.dataset.remove),1);drawScope();}};
    root.querySelector('#task-form').onsubmit=e=>{e.preventDefault();GIS.run(async()=>{
      const body={scope:scope.map(s=>({type:s.type,id:s.id})),ticket_name:value('ticket_name'),inspection_type:value('inspection_type'),target_facility:value('target_facility'),team_id:Number(value('team_id'))||null,capture_profile_id:Number(value('capture_profile_id'))||null,assigned_device_sn:value('assigned_device_sn')||null,
        planned_start_at:value('planned_start_at')?new Date(value('planned_start_at')).toISOString():null,planned_end_at:value('planned_end_at')?new Date(value('planned_end_at')).toISOString():null,
        vision_required:root.querySelector('[name="vision_required"]').checked,route_ids:[...root.querySelector('[name="route_ids"]').selectedOptions].map(o=>Number(o.value))};
      if(current)body.revision=current.revision;
      const r=await GIS.api(selected?'PUT':'POST',selected?`/api/tickets/${selected}`:'/api/tickets',body);await list();await open(r.data.ticket_id);GIS.toast('Đã lưu nhiệm vụ');
    });};
    root.querySelector('#task-team').onsubmit=e=>{e.preventDefault();const f=e.target;GIS.run(async()=>{await GIS.api('POST','/api/teams',{team_name:f.elements.name.value,member_ids:[...f.elements.members.selectedOptions].map(o=>Number(o.value))});await fill();GIS.toast('Đã lưu tổ công tác');});};
    GIS.run(async()=>{await fill();await list();drawScope();});
  }};
})();
