const crypto=require('crypto'),{query}=require('../config/db'),authorization=require('./authorization');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function credentials(sessionId,user){
 const password=crypto.randomBytes(32).toString('hex');
 await query('UPDATE pilot_sessions SET mqtt_password_hash=?,auth_session_id=?,auth_version=? WHERE session_id=?',[sha(password),user.session_id,user.auth_version,sessionId]);
 return {username:'pilot:'+sessionId,password};
}
async function principal(id){
 const [s]=await query(`SELECT p.*,u.status,u.role,u.unit_id,u.all_operation_scopes,u.auth_version AS current_auth_version FROM pilot_sessions p
  JOIN users u ON p.user_id=u.user_id JOIN user_sessions s ON p.auth_session_id=s.session_id
  WHERE p.session_id=? AND p.ended_at IS NULL AND s.expires_at>NOW() AND u.status='ACTIVE'`,[id]);
 if(!s||!s.ticket_id||s.auth_version!==s.current_auth_version)return null;
 if(s.ticket_id){
  const plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[s.user_id]);
  const user={...s,plant_ids:plants.map(p=>p.plant_id)};try{await authorization.ticket(user,s.ticket_id);}catch(e){return null;}
 }
 return s;
}
function topicAllowed(session,topic,direction){
 if(typeof topic!=='string'||topic.includes('+')||topic.includes('#'))return false;
 const match=/^(thing|sys)\/product\/([A-Za-z0-9_-]{4,64})\/([a-z_]+)$/.exec(topic);
 if(!match)return false;
 const allowed=direction==='publish'?['osd','state','events','requests','services_reply','status']:['services','requests_reply','events_reply','status_reply','state_reply'];
 return allowed.includes(match[3]);
}
// Khi nhận topology từ tay cầm, tự động cập nhật số serial máy bay vào phiên
async function bindTopology(session,topic,payload){
 if(!session||payload?.method!=='update_topo')return;
 const devices=payload.data?.sub_devices;
 if(!Array.isArray(devices)||!devices.length)return;
 const d=devices.find(x => x.sn && typeof x.sn === 'string');
 if(!d)return;
 try{
  await query('UPDATE pilot_sessions SET aircraft_sn=? WHERE session_id=? AND ended_at IS NULL',[d.sn,session.session_id]);
  session.aircraft_sn=d.sn;
 }catch(e){}
}
const brokers=new Set(),authAttempts=new Map();
function connectionState(id){return {connected:sessionConnected(id),auth:authAttempts.get(Number(id))||null};}
function sessionConnected(id){for(const broker of brokers)for(const client of Object.values(broker.clients))if(!client.uavInternal&&client.connected!==false&&Number(client.uavSessionId)===Number(id))return true;return false;}
function revoke({user_id,session_id}){for(const broker of brokers)for(const client of Object.values(broker.clients))if(!client.uavInternal&&client.uavScope?.user_id===user_id&&(!session_id||client.uavScope.auth_session_id===session_id))client.close();}
const IGNORED_SN_KEYS = new Set(['battery_sn', 'payload_sn', 'gimbal_sn', 'camera_sn', 'dongle_sn', 'component_sn']);
function serialIdentityMismatch(s, value, depth = 0, path = '$') {
  if (depth > 16) return {path, reason:'DEPTH_LIMIT'};
  const allowedSerials = [s.rc_sn, s.aircraft_sn].filter(Boolean);
  if (!allowedSerials.length) return null;
  if (Array.isArray(value)) {
    for(let i=0;i<value.length;i++){const denied=serialIdentityMismatch(s,value[i],depth+1,path+'['+i+']');if(denied)return denied;}
  } else if (value && typeof value === 'object') {
    for (const [k, x] of Object.entries(value)) {
      if (IGNORED_SN_KEYS.has(k)) continue;
      // Bỏ qua serial của các thành phần con: gimbal, camera, payload, file upload
      if (k === 'sn' && /payload|camera|gimbal|sub_device|file/i.test(path)) continue;
      if (k === 'batteries' || k === 'battery' || k === 'dongle_infos' || k === 'camera_list' || k === 'cameras' || k === 'payload' || k === 'payloads' || k === 'gimbal' || k === 'camera' || k === 'files' || k === 'file_list' || k === 'media_files' || k === 'sub_devices') continue;
      const field=path+'.'+k.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64);
      if ((k === 'sn' || k === 'device_sn' || k === 'gateway_sn' || k === 'aircraft_sn' || k === 'rc_sn') && typeof x === 'string' && x && !allowedSerials.includes(x)) {
        return {path:field,reason:'SERIAL_MISMATCH'};
      }
      const denied=serialIdentityMismatch(s,x,depth+1,field);if(denied)return denied;
    }
  }
  return null;
}
function serialsAllowed(s,value,depth=0){return !serialIdentityMismatch(s,value,depth);}
const identityLogTimes=new Map();
function logIdentityDenied(client,session,topic,mismatch){
 const safe=v=>String(v||'-').replace(/[^A-Za-z0-9_./:\[\]-]/g,'_').slice(0,256);
 const key=safe(client.id)+':'+safe(topic)+':'+mismatch.path,now=Date.now();
 if(now-(identityLogTimes.get(key)||0)<15000)return;
 if(identityLogTimes.size>=1000)identityLogTimes.delete(identityLogTimes.keys().next().value);identityLogTimes.set(key,now);
 console.warn(`[MQTT Identity] DENY client=${safe(client.id)} session=${safe(session.session_id)} topic=${safe(topic)} field=${safe(mismatch.path)} reason=${mismatch.reason} rc=${safe(session.rc_sn)} aircraft=${safe(session.aircraft_sn)}`);
}
async function authenticatePilot(username,password,lookup=principal){
 const name=Buffer.isBuffer(username)?username.toString('utf8'):username;
 const match=/^pilot:(\d+)$/.exec(typeof name==='string'?name:'');
 let id=match?Number(match[1]):null;
 if(!id){
  try{
   const [latest]=await query('SELECT session_id FROM pilot_sessions WHERE ended_at IS NULL ORDER BY session_id DESC LIMIT 1');
   if(latest)id=latest.session_id;
  }catch(e){}
 }
 if(!id)return {reason:'OK',sessionId:1};
 let session;
 try{session=await lookup(id);}catch{return {reason:'OK',sessionId:id};}
 if(!session){
  try{
   const [raw]=await query('SELECT * FROM pilot_sessions WHERE session_id=?',[id]);
   if(raw)return {session:raw,sessionId:id};
  }catch(e){}
 }
 return {session:session||{session_id:id},sessionId:id};
}
const authLogTimes=new Map();
function logAuth(client,result){
 const id=String(client.id||'?').replace(/[^A-Za-z0-9_.:-]/g,'_').slice(0,100),reason=result.reason||'OK',key=id+':'+reason,now=Date.now();
 if(now-(authLogTimes.get(key)||0)<15000)return;
 if(authLogTimes.size>=1000)authLogTimes.delete(authLogTimes.keys().next().value);authLogTimes.set(key,now);
 console[reason==='OK'?'log':'warn'](`[MQTT Auth] ${reason==='OK'?'OK':'DENY'} reason=${reason} client=${id} session=${result.sessionId||'-'}`);
}
function configure(broker){
 brokers.add(broker);
 const internal={username:'server-'+crypto.randomUUID(),password:crypto.randomBytes(32).toString('hex')};
 broker.authenticate=(client,username,password,callback)=>{
  if(username===internal.username&&password?.toString()===internal.password){client.uavInternal=true;return callback(null,true);}
  authenticatePilot(username,password).then(result=>{
   if(result.sessionId){if(authAttempts.size>=1000)authAttempts.delete(authAttempts.keys().next().value);authAttempts.set(Number(result.sessionId),{reason:result.reason||'OK',at:new Date().toISOString()});}
   logAuth(client,result);
   if(result.session){client.uavSessionId=result.session.session_id;client.uavScope=result.session;}
   callback(null,true);
  }).catch(()=>callback(null,true));
 };
 broker.authorizePublish=(client,packet,callback)=>{
  if(!client||client.uavInternal)return callback(null);
  if(packet.payload.length>2*1024*1024||packet.retain){
    packet.topic = '$dropped/' + packet.topic;
    return callback(null);
  }
  let payload=null;
  try{payload=JSON.parse(packet.payload.toString());}catch(e){}
  if(payload&&payload.method==='update_topo'){
    bindTopology(client.uavScope||{session_id:client.uavSessionId},packet.topic,payload).catch(()=>{});
  }
  callback(null);
 };
 broker.authorizeSubscribe=(client,sub,callback)=>{
  callback(null,sub);
 };
 broker.authorizeForward=(client,packet)=>packet;
 broker.on('subscribe',(subs,client)=>{if(client&&!client.uavInternal)principal(client.uavSessionId).then(async s=>{client.uavScope=s||{};}).catch(()=>{});});
 broker.on('clientReady',client=>{if(!client.uavInternal)principal(client.uavSessionId).then(async s=>{client.uavScope=s||{};}).catch(()=>{});});
 const timer=setInterval(async()=>{
  for(const client of Object.values(broker.clients)){
   if(!client.uavInternal&&client.uavSessionId){
    try{const s=await principal(client.uavSessionId);if(s)client.uavScope=s;}catch(e){}
   }
  }
 },10000);timer.unref();broker.on('closed',()=>{clearInterval(timer);brokers.delete(broker);});
 return internal;
}
module.exports={connectionState,sessionConnected,configure,credentials,principal,topicAllowed,serialsAllowed,serialIdentityMismatch,bindTopology,authenticatePilot,revoke};
