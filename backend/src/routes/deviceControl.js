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
  access.permission(req.user,'tasks:write');await access.ticket(req.user,session.ticket_id);
  const fresh=device.last_osd_at&&Date.now()-new Date(device.last_osd_at).getTime()<30000&&device.status!=='OFFLINE';
  return {sn,gateway,device,session,fresh};
 }
 function ready(t,authority=false){
  if(!getClient()?.connected)throw failure('MQTT chưa kết nối',503);
  if(!t.device.last_osd_at||Date.now()-new Date(t.device.last_osd_at).getTime()>=30000||t.device.status==='OFFLINE')throw failure('Chưa nhận telemetry mới trong 30 giây');
  if(authority&&gateways[t.gateway].is_cloud_control_auth!==true)throw failure('Phi công chưa cấp quyền điều khiển trên Pilot 2',403);
 }
 const ok=(res,data,message)=>res.json({code:0,message,data});
 router.get('/devices',asyncHandler(async(req,res)=>{
  const visible=[];
  for(const sn of Object.keys(devices)){
   try{const t=await target(req,sn);visible.push({device_sn:sn,device_name:t.device.device_name||sn,gateway_sn:t.gateway,status:t.fresh?'ONLINE':'OFFLINE'});}catch(e){if(e.status!==403&&e.status!==409)throw e;}
  }
  ok(res,visible);
 }));
 router.get('/status',asyncHandler(async(req,res)=>{const t=await target(req),rows=await monitoring.streams(t.session.ticket_id),publisher=rows.find(r=>r.device_sn===t.sn),live=activeLives.get(t.sn);ok(res,{device_sn:t.sn,gateway_sn:t.gateway,model:t.device.model||null,aircraft_type:t.device.type??null,aircraft_sub_type:t.device.sub_type??null,last_osd_at:t.device.last_osd_at||null,mqtt_connected:!!getClient()?.connected,telemetry_fresh:!!t.fresh,cloud_control_authorized:gateways[t.gateway].is_cloud_control_auth===true,video_ids:videoIds(gateways[t.gateway].live_capacity),video_sources:videoSources(gateways[t.gateway].live_capacity).filter(v=>v.video_id.startsWith(t.sn+'/')),is_live:publisher?.status==='STREAMING'||publisher?.status==='RECONNECTING',active_video_id:live?.video_id||null,active_video_type:live?.video_type||null,storage:require('../services/objectStorage').readiness(),live_enabled:liveEnabled(),live_ready:liveReady()},'Trạng thái đã xác minh');}));
 router.post('/authorize',asyncHandler(async(req,res)=>{const t=await target(req);ready(t);const result=await commands.exclusive(t.gateway,()=>commands.send(t.gateway,'cloud_control_auth_request',{user_id:String(req.user.user_id),user_callsign:req.user.full_name||req.user.username,control_keys:['flight']}));ok(res,{...result,authorized:gateways[t.gateway].is_cloud_control_auth===true},'Pilot đã phản hồi yêu cầu; chỉ điều khiển khi trạng thái cấp quyền được xác nhận.');}));
 router.post('/release',asyncHandler(async(req,res)=>{const t=await target(req);ready(t);const result=await commands.send(t.gateway,'cloud_control_release',{});gateways[t.gateway].is_cloud_control_auth=false;ok(res,result,'Đã trả quyền cho phi công');}));
 router.post('/photo',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t,true);
  // A confirmed M3T session is required for its documented integrated camera index.
  if(t.device.type!==77||t.device.sub_type!==1)throw failure('Chưa xác minh model Mavic 3T qua topology');
  const mode=req.body.mode||'dual',settings={dual:['vision','ir'],wide:['vision'],thermal:['ir']};
  if(!settings[mode])throw failure('Chế độ ảnh không hợp lệ',400);
  const result=await commands.exclusive(t.gateway,async()=>{
   await commands.send(t.gateway,'camera_mode_switch',{payload_index:'67-0-0',camera_mode:0});ready(await target(req),true);
   await commands.send(t.gateway,'photo_storage_set',{payload_index:'67-0-0',photo_storage_settings:settings[mode]});ready(await target(req),true);
   return commands.send(t.gateway,'camera_photo_take',{payload_index:'67-0-0'});
  });ok(res,{...result,image_received:false},'UAV đã chấp nhận lệnh chụp. Chờ ảnh gốc từ Pilot 2; chưa xác nhận đã nhận ảnh.');
 }));
 router.post('/gimbal',asyncHandler(async(req,res)=>{const t=await target(req);ready(t,true);if(t.device.type!==77||t.device.sub_type!==1)throw failure('Chưa xác minh camera M3T');const pitch=Number(req.body.pitch);if(![-90,0].includes(pitch))throw failure('Hiện hỗ trợ hướng xuống -90° hoặc đặt lại 0°',400);const r=await commands.exclusive(t.gateway,()=>commands.send(t.gateway,'gimbal_reset',{payload_index:'67-0-0',reset_mode:pitch===-90?1:0}));ok(res,r,'Pilot đã chấp nhận lệnh gimbal');}));
 router.post('/live',asyncHandler(async(req,res)=>{
  const t=await target(req);ready(t);
  if(!liveEnabled()||!liveReady())throw failure('Media server chưa sẵn sàng; kiểm tra LIVE_STREAM_ENABLED và cổng RTMP/FLV',503);
  const ids=videoIds(gateways[t.gateway].live_capacity).filter(id=>id.startsWith(t.sn+'/'));
  const id=req.body.video_id;
  if(typeof id!=='string'||!ids.includes(id))throw failure('Chọn video_id do thiết bị công bố; không suy đoán tên camera',400);
  if(!['start','stop','switch'].includes(req.body.action))throw failure('Thao tác live không hợp lệ',400);
  const source=videoSources(gateways[t.gateway].live_capacity).find(v=>v.video_id===id),lens=req.body.video_type;
  if(lens!=null&&(!source||!source.switchable_video_types.includes(lens)))throw failure('Thiết bị chưa công bố hỗ trợ loại camera đã chọn',400);
  const stream=await monitoring.ensureStream(t.session.ticket_id,t.sn),quality=Number(req.body.video_quality??2);
  if(!Number.isInteger(quality)||quality<0||quality>4)throw failure('Chất lượng phải từ 0 đến 4',400);
  const url=`${rtmpBase()}${stream.streamPath}?${streamAccess.mint(stream.streamPath,'publish',req.user)}`;
  const result=await commands.exclusive(t.gateway,async()=>{
   const reported=(gateways[t.gateway].live_status||[]).find(v=>v.status===1&&v.video_id?.startsWith(t.sn+'/'));
   const previous=activeLives.get(t.sn)||(reported?{video_id:reported.video_id,video_type:reported.video_type}:null);
   if(req.body.action==='stop'){const result=await commands.send(t.gateway,'live_stop_push',{video_id:previous?.video_id||id});activeLives.delete(t.sn);return result;}
   const rows=await monitoring.streams(t.session.ticket_id),publishing=rows.some(r=>r.device_sn===t.sn&&['STREAMING','RECONNECTING'].includes(r.status));
   if(req.body.action==='switch'&&!previous&&!publishing)throw failure('Chưa có luồng live; bấm Bắt đầu live trước',409);
   let result;
   if(req.body.action==='switch'&&(!previous||previous.video_id===id)&&lens){
    result=await commands.send(t.gateway,'live_lens_change',{video_id:id,video_type:lens});
   }else{
    if(previous&&previous.video_id!==id)await commands.send(t.gateway,'live_stop_push',{video_id:previous.video_id});
    result=await commands.send(t.gateway,'live_start_push',{url_type:1,url,video_id:id,video_quality:quality});
    activeLives.set(t.sn,{video_id:id,video_type:null});
    if(lens)result=await commands.send(t.gateway,'live_lens_change',{video_id:id,video_type:lens});
   }
   activeLives.set(t.sn,{video_id:id,video_type:lens||source?.video_type||null});return result;
  });
  const row=(await monitoring.streams(t.session.ticket_id)).find(r=>r.device_sn===t.sn);
  ok(res,{...result,playback_url:row?streamAccess.playback(row,req.user).flv_url:null,streamPath:stream.streamPath,channel:stream.channel,publisher_confirmed:false,video_id:id,video_type:lens||null},'Pilot đã phản hồi lệnh live. Trạng thái phát được xác nhận riêng khi có publisher.');
 }));
 router.post('/media-sync',(req,res)=>{if(!require('../services/objectStorage').readiness().configured)return res.status(503).json({code:503,message:'Chưa cấu hình kho ảnh. Đặt STORAGE_MODE=local, khởi động lại server rồi đăng nhập lại Pilot 2.',data:{sync_command_sent:false}});return res.json({code:0,message:'Ảnh gốc được tải bằng Media File Upload của Pilot 2. Bật tự tải ảnh gốc hoặc chọn tải thủ công trong thư viện Pilot; không phát lệnh media_files_sync không được xác nhận.',data:{strategy:'pilot-native-upload',sync_command_sent:false}});});
 router.post(['/rth','/fly-to','/flyto'],(req,res)=>res.status(410).json({code:410,message:'Điều khiển chuyển động chưa được kiểm chứng theo DRC trên thiết bị này. Thực hiện trên Pilot 2; không phát lệnh suy đoán.'}));
 return router;
}
module.exports={createRouter};
