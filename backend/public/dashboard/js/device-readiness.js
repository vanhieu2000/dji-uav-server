/* Explicit target and device-reported camera choices; status is separate from command acceptance. */
(()=>{
 let state=null,inFlight=false;
 const box=document.getElementById('device-readiness'),select=document.getElementById('device-target'),video=document.getElementById('device-video');
 if(!box)return;
 const disclosure=document.getElementById('device-readiness-details');let shortScreen;function fit(){const next=innerHeight<500;if(next!==shortScreen){shortScreen=next;disclosure.open=!next;}}fit();window.addEventListener('resize',fit);
 document.querySelectorAll('[onclick*=manualSendRth]').forEach(b=>{b.disabled=true;b.title='Thực hiện RTH trên Pilot 2; điều khiển chuyển động từ Web chưa được kiểm chứng';});
 async function call(path,body){const r=await fetch('/api/control/'+path,{method:body?'POST':'GET',headers:getAuthHeaders(),...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||d.code!==0)throw Error(d.message||'Không đọc được trạng thái UAV');return d;}
 async function refresh(){
  if(inFlight)return;inFlight=true;
  try{
   const r=await fetch('/api/control/devices',{headers:getAuthHeaders()}),d=await r.json();if(!r.ok||d.code!==0)throw Error(d.message||'Không tải được thiết bị');
   const chosen=gSelectedDroneSn||select.value;select.replaceChildren(new Option('Chọn máy bay',''));
   for(const device of d.data||[])if(device.device_sn)select.add(new Option(device.device_name||device.device_sn,device.device_sn));
   select.value=chosen||'';const sn=select.value;
   if(!sn){state=null;video.replaceChildren(new Option('Chờ capability camera',''));box.querySelector('[data-device-status]').textContent='Chọn UAV đã kết nối để kiểm tra';return;}
   const result=await call('status?device_sn='+encodeURIComponent(sn));if(select.value!==sn||gSelectedDroneSn!==sn)return;state=result.data;
   const current=video.value;video.replaceChildren(new Option('Chọn kênh thiết bị công bố',''));for(const id of state.video_ids)video.add(new Option(id,id));if(state.video_ids.includes(current))video.value=current;
   box.querySelector('[data-device-status]').textContent=`MQTT: ${state.mqtt_connected?'kết nối':'ngắt'} · OSD: ${state.telemetry_fresh?'mới':'chưa có/cũ'} · Quyền: ${state.cloud_control_authorized?'đã cấp':'chưa cấp'} · Storage: ${state.storage.configured?'đã cấu hình, chờ ảnh xác minh':'chưa cấu hình'}`;
  }catch(e){state=null;video.replaceChildren(new Option('Chưa xác minh camera',''));box.querySelector('[data-device-status]').textContent=e.message;}finally{inFlight=false;}
 }
 select.onchange=()=>{const sn=select.value||null;if(window.GIS?.LiveMonitor?.selectDevice)GIS.LiveMonitor.selectDevice(sn);else selectUav(sn);state=null;refresh();};
 box.querySelector('[data-refresh-device]').onclick=refresh;
 for(const action of ['authorize','release'])box.querySelector('[data-device-'+action+']').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const d=await call(action,{device_sn:select.value});toast(d.message);await refresh();}catch(err){toast(err.message);}finally{b.disabled=false;}};
 box.querySelector('[data-device-stop]').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const d=await call('live',{action:'stop',device_sn:select.value,video_id:video.value});toast(d.message);stopFlvLivePlayer();}catch(err){toast(err.message);}finally{b.disabled=false;}};
 window.DeviceReadiness={refresh,videoId:()=>video.value,target:()=>select.value,state:()=>state};
 setInterval(()=>{if(document.getElementById('view-control-manual').classList.contains('active'))refresh();},5000);
})();
