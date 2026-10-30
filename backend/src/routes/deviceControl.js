const express=require('express'),{asyncHandler}=require('../utils/http'),authorization=require('../services/authorization');
const {failure}=require('../services/deviceCommands'),{videoIds,videoSources}=require('../services/liveCapabilities');
function createRouter({commands,devices,gateways,gatewayOfAircraft,activeSession,monitoring,streamAccess,getClient,liveEnabled,rtmpBase,liveReady,access=authorization,revalidate=async req=>req.user}){
 const router=express.Router(),activeLives=new Map();
 async function target(req,deviceSn){
  const actor=await revalidate(req);if(!actor||actor.must_change_password)throw failure('Phiên Web đã hết hạn hoặc cần đổi mật khẩu',401);req.user=actor;
  const sn=deviceSn||req.body?.device_sn||req.query.device_sn;
  if(typeof sn!=='string'||!/^[A-Za-z0-9_-]{4,64}$/.test(sn))throw failure('Chọn rõ máy bay cần thao tác',400);
  const device=devices[sn],gateway=gatewayOfAircraft[sn];
  if(!device||!gateway||!gateways[gateway])throw failure('Chưa xác nhận topology UAV/tay điều khiển');
  const session=await activeSession(sn);
  if(!session||session.rc_sn!==gateway||session.aircraft_sn!==sn)throw failure('Thiết bị chưa gắn đúng phiên Pilot');
  if(req.user.pilot_session_id&&req.user.pilot_session_id!==session.session_id)throw failure('Token Pilot không thuộc phiên thiết bị này',403);
  access.permission(req.user,'tasks:write');if(session.ticket_id)await access.ticket(req.user,session.ticket_id);else if(!access.allScopes(req.user))throw failure('Phiên Gateway chưa gán phạm vi; cần operator hoặc admin',403);
  const fresh=device.last_osd_at&&Date.now()-new Date(device.last_osd_at).getTime()<30000&&device.status!=='OFFLINE';
  return {sn,gateway,device,session,fresh};
 }
 function ready(t,authority=false){
  if(!getClient()?.connected)throw failure('MQTT chưa kết nối',503);
  if(!t.device.last_osd_at||Date.now()-new Date(t.device.last_osd_at).getTime()>=30000||t.device.status==='OFFLINE')throw failure('Chưa nhận telemetry mới trong 30 giây');
  const isAuth = gateways[t.gateway]?.is_cloud_control_auth===true || t.device?.is_cloud_control_auth===true;
  if(authority&&!isAuth)throw failure('Phi công chưa cấp quyền điều khiển trên Pilot 2',403);
 }
 const ok=(res,data,message)=>res.json({code:0,message,data});
 router.get('/devices',asyncHandler(async(req,res)=>{
  const visible=[];
  for(const sn of Object.keys(devices)){
   try{const t=await target(req,sn);visible.push({device_sn:sn,device_name:t.device.device_name||sn,gateway_sn:t.gateway,status:t.fresh?'ONLINE':'OFFLINE'});}catch(e){if(e.status!==403&&e.status!==409)throw e;}
  }
  ok(res,visible);
 }));
 router.get('/status',asyncHandler(async(req,res)=>{
  const t=await target(req),rows=await monitoring.streams(t.session.ticket_id),publisher=rows.find(r=>r.device_sn===t.sn),live=activeLives.get(t.sn);
  const isAuth = gateways[t.gateway]?.is_cloud_control_auth===true || t.device?.is_cloud_control_auth===true;
  ok(res,{
   device_sn:t.sn,
   gateway_sn:t.gateway,
   model:t.device.model||null,
   aircraft_type:t.device.type??null,
   aircraft_sub_type:t.device.sub_type??null,
   last_osd_at:t.device.last_osd_at||null,
   mqtt_connected:!!getClient()?.connected,
   telemetry_fresh:!!t.fresh,
   cloud_control_authorized:isAuth,
   video_ids:videoIds(gateways[t.gateway].live_capacity),
   video_sources:videoSources(gateways[t.gateway].live_capacity).filter(v=>v.video_id.startsWith(t.sn+'/')),
   is_live:publisher?.status==='STREAMING'||publisher?.status==='RECONNECTING',
   active_video_id:live?.video_id||null,
   active_video_type:live?.video_type||null,
   storage:require('../services/objectStorage').readiness(),
   live_enabled:liveEnabled(),
   live_ready:liveReady()
  },'Trạng thái đã xác minh');
 }));
 router.post('/authorize',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t);
  const result=await commands.exclusive(t.gateway,()=>commands.send(t.gateway,'cloud_control_auth_request',{
   user_id:String(req.user.user_id),
   user_callsign:req.user.full_name||req.user.username,
   control_keys:['flight','payload']
  }));
  gateways[t.gateway].is_cloud_control_auth=true;
  if (devices[t.sn]) devices[t.sn].is_cloud_control_auth=true;
  ok(res,{...result,authorized:true},'Đã gửi yêu cầu cấp quyền điều khiển tới Pilot 2.');
 }));
 router.post('/release',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t);
  let result = null;
  // Gửi drc_mode_exit để tắt chế độ điều khiển Cloud trên màn hình Pilot 2 RC
  try { result = await commands.send(t.gateway,'drc_mode_exit',{}); } catch(e){}
  // Đồng thời gửi cloud_control_release để giải phóng token
  try { const r2 = await commands.send(t.gateway,'cloud_control_release',{}); result = result || r2; } catch(e){}
  gateways[t.gateway].is_cloud_control_auth=false;
  if (devices[t.sn]) devices[t.sn].is_cloud_control_auth=false;
  ok(res,result||{},'Đã trả quyền cho phi công');
 }));
 router.post('/photo',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t,false);
  if(t.device.type!==77||t.device.sub_type!==1)throw failure('Chưa xác minh model Mavic 3T qua topology');
  const mode=req.body.mode||'dual',settings={dual:['vision','ir'],wide:['vision'],thermal:['ir']};
  if(!settings[mode])throw failure('Chế độ ảnh không hợp lệ',400);
  const result=await commands.exclusive(t.gateway,async()=>{
   // 1. Tự động chiếm quyền camera 67-0-0 nếu chưa có
   try { await commands.send(t.gateway,'payload_authority_grab',{payload_index:'67-0-0'}); } catch(e){}
   // 2. Chuyển chế độ chụp ảnh và đặt cấu hình lưu ảnh
   await commands.send(t.gateway,'camera_mode_switch',{payload_index:'67-0-0',camera_mode:0});
   await commands.send(t.gateway,'photo_storage_set',{payload_index:'67-0-0',photo_storage_settings:settings[mode]});
   // 3. Ra lệnh chụp ảnh
   return commands.send(t.gateway,'camera_photo_take',{payload_index:'67-0-0'});
  });
  ok(res,{...result,image_received:false},'UAV đã chấp nhận lệnh chụp. Đang đồng bộ ảnh thật về máy tính.');
 }));
 router.post('/gimbal',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t,false);
  if(t.device.type!==77||t.device.sub_type!==1)throw failure('Chưa xác minh camera M3T');
  const pitch=Number(req.body.pitch);
  if(![-90,0].includes(pitch))throw failure('Hiện hỗ trợ hướng xuống -90° hoặc đặt lại 0°',400);
  const r=await commands.exclusive(t.gateway,async()=>{
   try { await commands.send(t.gateway,'payload_authority_grab',{payload_index:'67-0-0'}); } catch(e){}
   return commands.send(t.gateway,'gimbal_reset',{payload_index:'67-0-0',reset_mode:pitch===-90?1:0});
  });
  ok(res,r,'Pilot đã chấp nhận lệnh gimbal');
 }));
 router.post('/live',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t,false);
  if(!liveEnabled()||!liveReady())throw failure('Media server chưa sẵn sàng; kiểm tra LIVE_STREAM_ENABLED và cổng RTMP/FLV',503);

  let id=req.body.video_id || '';
  if(!['start','stop','switch'].includes(req.body.action))throw failure('Thao tác live không hợp lệ',400);

  // Pilot defines video_index in live_capacity. Keep its published ID intact.
  let lens=req.body.video_type||null;
  if(id&&!id.startsWith(t.sn+'/'))throw failure('Nguồn video không thuộc UAV đã chọn',400);
  if(lens&&!['normal','wide','zoom','thermal','ir'].includes(lens))throw failure('Loại camera không hợp lệ',400);
  const published=videoIds(gateways[t.gateway].live_capacity).filter(v=>v.startsWith(t.sn+'/'));
  const pushVideoId=id||activeLives.get(t.sn)?.video_id||(published.length===1?published[0]:`${t.sn}/67-0-0/normal-0`);

  // Starting the default stream does not pin a lens; explicit switching may select normal/default.
  if(lens==='ir')lens='thermal';
  if(lens==='normal'&&req.body.action!=='switch')lens=null;
  const stream=await monitoring.ensureStream(t.session.ticket_id,t.sn),quality=Number(req.body.video_quality??process.env.LIVE_VIDEO_QUALITY??4);
  if(!Number.isInteger(quality)||quality<0||quality>4)throw failure('Chất lượng live phải từ 0 đến 4',400);
  const url=`${rtmpBase()}${stream.streamPath}?${streamAccess.mint(stream.streamPath,'publish',req.user)}`;

  let result = null,lensChangeError=null;
  try {
   result=await commands.exclusive(t.gateway,async()=>{
    const reported=(gateways[t.gateway].live_status||[]).find(v=>v.status===1&&v.video_id?.startsWith(t.sn+'/'));
    const previous=activeLives.get(t.sn)||(reported?{video_id:reported.video_id,video_type:reported.video_type}:null);
    if(req.body.action==='stop'){
      const resStop=await commands.send(t.gateway,'live_stop_push',{video_id:previous?.video_id||pushVideoId});
      activeLives.delete(t.sn);
      return resStop;
    }

    let resAction;
    const nativeLens=videoSources(gateways[t.gateway].live_capacity).find(v=>v.video_id===pushVideoId)?.video_type;
    if(req.body.action==='switch' && lens&&(!previous||previous.video_id===pushVideoId)&&(nativeLens!==lens||lens==='normal')){
      const lensParam = lens === 'ir' ? 'thermal' : lens;
      resAction = await commands.send(t.gateway,'live_lens_change',{video_id:pushVideoId,video_type:lensParam});
    } else {
      if(previous && (previous.video_id!==pushVideoId||(!lens&&previous.video_type&&previous.video_type!=='normal'))){
        await commands.send(t.gateway,'live_stop_push',{video_id:previous.video_id});
        activeLives.delete(t.sn);
      }
      resAction = await commands.send(t.gateway,'live_start_push',{url_type:1,url,video_id:pushVideoId,video_quality:quality});
      activeLives.set(t.sn,{video_id:pushVideoId,video_type:null});
      if(lens&&nativeLens!==lens){
        const lensParam = lens === 'ir' ? 'thermal' : lens;
        try{ await commands.send(t.gateway,'live_lens_change',{video_id:pushVideoId,video_type:lensParam}); }catch(e){lensChangeError=e.message;}
      }
    }
    activeLives.set(t.sn,{video_id:pushVideoId,video_type:lensChangeError?null:(lens||'normal')});
    return resAction;
   });
  } catch(err) {
    // A rejected command is not proof that a publisher exists. Preserve the real DJI error.
    throw err;
  }

  const row=(await monitoring.streams(t.session.ticket_id)).find(r=>r.device_sn===t.sn);
  ok(res,{
    ...(result||{}),
    playback_url:row?streamAccess.playback(row,req.user).flv_url:null,
    streamPath:stream.streamPath,
    channel:stream.channel,
    publisher_confirmed:row?.status==='STREAMING'||row?.status==='RECONNECTING',
    video_id:pushVideoId,
    video_type:lensChangeError?null:(lens||null),
    camera_switch_error:lensChangeError
  },req.body.action==='stop'?'Pilot đã chấp nhận lệnh dừng live.':'Pilot đã chấp nhận yêu cầu live; chờ xác nhận video từ media server.');
 }));
 router.post('/media-sync',(req,res)=>{if(!require('../services/objectStorage').readiness().configured)return res.status(503).json({code:503,message:'Chưa cấu hình kho ảnh. Đặt STORAGE_MODE=local, khởi động lại server rồi đăng nhập lại Pilot 2.',data:{sync_command_sent:false}});return res.json({code:0,message:'Ảnh gốc được tải bằng Media File Upload của Pilot 2. Bật tự tải ảnh gốc hoặc chọn tải thủ công trong thư viện Pilot; không phát lệnh media_files_sync không được xác nhận.',data:{strategy:'pilot-native-upload',sync_command_sent:false}});});
 router.post(['/rth','/fly-to','/flyto'],(req,res)=>res.status(410).json({code:410,message:'Điều khiển chuyển động chưa được kiểm chứng theo DRC trên thiết bị này. Thực hiện trên Pilot 2; không phát lệnh suy đoán.'}));
 return router;
}
module.exports={createRouter};
