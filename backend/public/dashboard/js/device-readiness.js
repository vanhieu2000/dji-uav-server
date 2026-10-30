/* Explicit target and device-reported camera choices; status is separate from command acceptance. */
(()=>{
 let state=null,inFlight=false,switching=false,choices=[],acceptedAt=0,lastChoice='';
 const box=document.getElementById('device-readiness'),select=document.getElementById('device-target'),video=document.getElementById('device-video');
 if(!box)return;
 const pipVideo=document.getElementById('device-video-pip'),dashboardVideo=document.getElementById('device-video-dashboard');
 const currentChoice=()=>choices.find(x=>x.value===video.value);
 const lensName=t=>({normal:'Nguồn mặc định',wide:'Góc rộng',zoom:'Zoom',thermal:'Camera nhiệt',ir:'Camera nhiệt'}[t]||'Nguồn video');
 let followAttemptId=null;
 function fillCameras(){
  const current=video.value,sources=state?.video_sources||[];choices=[];
  const primary=sources.find(s=>s.video_id.includes('/67-0-0/'));
  if(primary)choices.push({value:'pilot-follow',id:primary.video_id,type:null,label:'Theo tay cầm'});
  for(const source of sources){const types=source.switchable_video_types?.length?source.switchable_video_types:[null];for(const type of types){
   const camera=source.video_id.split('/').slice(0,2).join('/');
   const native=sources.find(s=>s.video_id.startsWith(camera+'/')&&s.video_type===type);
   const id=native?.video_id||source.video_id,value=id+'|'+(type||'');
   if(!choices.some(c=>c.value===value))choices.push({value,id,type,label:source.video_id.includes('/67-0-0/')?lensName(type):'Nguồn phụ · '+id});
  }}
  if(!choices.length)for(const id of state?.video_ids||[])choices.push({value:id+'|',id,type:null,label:id});
  for(const el of [video,pipVideo,dashboardVideo].filter(Boolean)){el.replaceChildren(new Option('Chọn camera',''));for(const c of choices)el.add(new Option(c.label,c.value));el.value=choices.some(c=>c.value===current)?current:(choices.find(c=>c.value==='pilot-follow')||choices[0])?.value||'';}
 }

 const disclosure=document.getElementById('device-readiness-details');let shortScreen;function fit(){const next=innerHeight<500;if(next!==shortScreen){shortScreen=next;disclosure.open=!next;}}fit();window.addEventListener('resize',fit);
 document.querySelectorAll('[onclick*=manualSendRth]').forEach(b=>{b.disabled=true;b.title='Thực hiện RTH trên Pilot 2; điều khiển chuyển động từ Web chưa được kiểm chứng';});
 async function call(path,body){const r=await fetch('/api/control/'+path,{method:body?'POST':'GET',headers:getAuthHeaders(),...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||d.code!==0)throw Error(d.message||'Không đọc được trạng thái UAV');return d;}
 async function refresh(){
  if(inFlight||switching)return;inFlight=true;
  try{
   const r=await fetch('/api/control/devices',{headers:getAuthHeaders()}),d=await r.json();if(!r.ok||d.code!==0)throw Error(d.message||'Không tải được thiết bị');
   const chosen=gSelectedDroneSn||select.value||(d.data?.length===1?d.data[0].device_sn:'');select.replaceChildren(new Option('Chọn máy bay',''));
   for(const device of d.data||[])if(device.device_sn)select.add(new Option(device.device_name||device.device_sn,device.device_sn));
   if(chosen&&![...select.options].some(o=>o.value===chosen))select.add(new Option(chosen+' · chờ xác minh điều khiển',chosen));
   select.value=chosen||'';const sn=select.value;if(sn&&!gSelectedDroneSn){if(window.GIS?.LiveMonitor?.selectDevice)GIS.LiveMonitor.selectDevice(sn);else selectUav(sn);}
   if(!sn){state=null;video.replaceChildren(new Option('Chờ camera',''));box.querySelector('[data-device-status]').textContent='Chọn UAV đã kết nối để kiểm tra';return;}
   const result=await call('status?device_sn='+encodeURIComponent(sn));if(select.value!==sn||gSelectedDroneSn!==sn)return;state=result.data;
   fillCameras();lastChoice=video.value;
   const auth=document.getElementById('pip-auth-status-badge');if(auth)auth.textContent=state.cloud_control_authorized?'Đã cấp quyền':'Chưa cấp quyền';
   const follow=currentChoice();if(video.value==='pilot-follow'&&state.is_live&&state.active_video_id&&follow?.id!==state.active_video_id&&followAttemptId!==follow.id&&typeof window.manualStartLive==='function'){
    followAttemptId=follow.id;switching=true;try{await window.manualStartLive();}finally{switching=false;}
   }
   box.querySelector('[data-device-status]').textContent=`MQTT: ${state.mqtt_connected?'kết nối':'ngắt'} · OSD: ${state.telemetry_fresh?'mới':'chưa có/cũ'} · Quyền: ${state.cloud_control_authorized?'đã cấp':'chưa cấp'} · Storage: ${state.storage.configured?'đã cấu hình, chờ ảnh xác minh':'chưa cấu hình'}`;
  }catch(e){state=null;video.replaceChildren(new Option('Chưa xác minh camera',''));box.querySelector('[data-device-status]').textContent=e.message;}finally{const status=box.querySelector('[data-device-status]');box.querySelector('[data-refresh-device]').title=status.textContent;inFlight=false;}
 }
 async function changeCamera(e){
  if(switching)return;const previous=lastChoice,requested=e.target.value;video.value=requested;if(pipVideo)pipVideo.value=requested;if(dashboardVideo)dashboardVideo.value=requested;
  const choice=currentChoice();if(!choice)return;
  if(!state||(!state.is_live&&Date.now()-acceptedAt>10000)){lastChoice=requested;toast('Đã chọn camera. Bấm Bật live để phát.');return;}
  switching=true;for(const el of [video,pipVideo,dashboardVideo].filter(Boolean))el.disabled=true;
  try{const d=await call('live',{action:'switch',device_sn:select.value,video_id:choice.id,video_type:choice.type||undefined});acceptedAt=Date.now();lastChoice=requested;toast(d.message);if(choice.type)gCurrentCamMode=choice.type;const label=document.querySelector('#cam-pane-wide .cam-pane-label');if(label)label.textContent=lensName(choice.type);}
  catch(err){video.value=previous;if(pipVideo)pipVideo.value=previous;if(dashboardVideo)dashboardVideo.value=previous;toast('Đổi camera thất bại: '+err.message);}
  finally{switching=false;for(const el of [video,pipVideo,dashboardVideo].filter(Boolean))el.disabled=false;}
 }
 video.onchange=changeCamera;if(pipVideo)pipVideo.onchange=changeCamera;if(dashboardVideo)dashboardVideo.onchange=changeCamera;
 select.onchange=()=>{const sn=select.value||null;if(window.GIS?.LiveMonitor?.selectDevice)GIS.LiveMonitor.selectDevice(sn);else selectUav(sn);state=null;refresh();};
 box.querySelector('[data-refresh-device]').onclick=async()=>{await refresh();if(!state)toast(box.querySelector('[data-device-status]').textContent);};
 for(const action of ['authorize','release'])box.querySelector('[data-device-'+action+']').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const d=await call(action,{device_sn:select.value});toast(d.message);await refresh();}catch(err){toast(err.message);}finally{b.disabled=false;}};
 box.querySelector('[data-device-stop]').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const d=await call('live',{action:'stop',device_sn:select.value,video_id:currentChoice()?.id||''});toast(d.message);acceptedAt=0;if(state)state.is_live=false;stopFlvLivePlayer();}catch(err){toast(err.message);}finally{b.disabled=false;}};
 window.DeviceReadiness={refresh,stop:()=>box.querySelector('[data-device-stop]').click(),authorize:()=>box.querySelector('[data-device-authorize]').click(),videoId:()=>currentChoice()?.id||'',videoType:()=>currentChoice()?.type||null,accepted:()=>{acceptedAt=Date.now();},target:()=>select.value,state:()=>state};
 setInterval(()=>{if(document.getElementById('view-control-manual')?.classList.contains('active')||document.getElementById('view-dashboard')?.classList.contains('active'))refresh();},5000);
})();
