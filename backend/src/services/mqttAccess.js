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
 if(!match||![session.rc_sn,session.aircraft_sn].filter(Boolean).includes(match[2]))return false;
 const allowed=direction==='publish'?['osd','state','events','requests','services_reply','status']:['services','requests_reply','events_reply','status_reply','state_reply'];
 return allowed.includes(match[3]);
}
// Only authenticated gateway topology may bind an aircraft; never infer its identity from an arbitrary topic.
async function bindTopology(session,topic,payload){
 if(!session.rc_sn||topic!==`sys/product/${session.rc_sn}/status`||payload?.method!=='update_topo')return;
 const devices=payload.data?.sub_devices;
 if(!Array.isArray(devices)||devices.length!==1)return;
 const d=devices[0];
 if(d.type!==77||d.sub_type!==1||typeof d.sn!=='string'||!/^[A-Za-z0-9_-]{4,64}$/.test(d.sn))return;
 if(session.aircraft_sn&&session.aircraft_sn!==d.sn)throw Error('Aircraft does not match Pilot session');
 await query('UPDATE pilot_sessions SET aircraft_sn=? WHERE session_id=? AND ended_at IS NULL AND (aircraft_sn IS NULL OR aircraft_sn=?)',[d.sn,session.session_id,d.sn]);
 session.aircraft_sn=d.sn;
}
const brokers=new Set();
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
      // Aircraft state reports payload/camera component serials here, not an aircraft identity.
      // Keep device_sn/gateway_sn and all serials outside this exact component field checked.
      if (k === 'sn' && /^\$\.data\.payloads\[\d+\]$/.test(path)) continue;
      if (k === 'batteries' || k === 'battery' || k === 'dongle_infos' || k === 'camera_list' || k === 'cameras' || k === 'payload') continue;
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
 if(!match||!Number.isSafeInteger(Number(match[1])))return {reason:'USERNAME_FORMAT'};
 const id=Number(match[1]);let session;
 try{session=await lookup(id);}catch{return {reason:'SESSION_LOOKUP_FAILED',sessionId:id};}
 if(!session)return {reason:'SESSION_UNAVAILABLE',sessionId:id};
 if(!/^[a-f0-9]{64}$/.test(session.mqtt_password_hash||''))return {reason:'PASSWORD_HASH_MISSING',sessionId:id};
 const actual=sha(password||Buffer.alloc(0));
 if(!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(session.mqtt_password_hash)))return {reason:'PASSWORD_MISMATCH',sessionId:id};
 return {session,sessionId:id};
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
   logAuth(client,result);if(!result.session)return callback(null,false);
   client.uavSessionId=result.session.session_id;client.uavScope=result.session;callback(null,true);
  }).catch(()=>callback(null,false));
 };
 broker.authorizePublish=(client,packet,callback)=>{
  if(!client||client.uavInternal)return callback(null);
  if(packet.payload.length>1024*1024||packet.retain)return callback(Error('Payload/retain denied'));
  const now=Date.now();if(!client.uavRate||now-client.uavRate.at>1000)client.uavRate={at:now,n:0};if(++client.uavRate.n>100)return callback(Error('Rate denied'));
  let payload;try{payload=JSON.parse(packet.payload.toString());}catch(e){return callback(Error('JSON required'));}
  principal(client.uavSessionId).then(async s=>{
    if (!s) return callback(Error('Session unavailable'));
    if (!topicAllowed(s, packet.topic, 'publish')) {
      console.warn(`[MQTT Access] ⚠ Từ chối publish topic=${packet.topic} từ ClientID=${client.id}`);
      return callback(Error('Topic denied'));
    }
    await bindTopology(s,packet.topic,payload);
    const mismatch=serialIdentityMismatch(s,payload);
    if(mismatch){logIdentityDenied(client,s,packet.topic,mismatch);return callback(Error('Payload identity denied'));}
    client.uavScope=s;callback(null);
  }).catch(()=>callback(Error('Session unavailable')));
 };
 broker.authorizeSubscribe=(client,sub,callback)=>{
  if(client.uavInternal)return callback(null,sub);
  principal(client.uavSessionId).then(s=>callback(null,s&&topicAllowed(s,sub.topic,'subscribe')?sub:null)).catch(()=>callback(null,null));
 };
 // Recheck each outbound packet so locked/revoked subscribers cannot keep reading commands.
 broker.authorizeForward=(client,packet)=>client.uavInternal||topicAllowed(client.uavScope||{},packet.topic,'subscribe')?packet:null;
 broker.on('subscribe',(subs,client)=>{if(client&&!client.uavInternal)principal(client.uavSessionId).then(async s=>{client.uavScope=s||{};}).catch(()=>{});});
 broker.on('clientReady',client=>{if(!client.uavInternal)principal(client.uavSessionId).then(async s=>{client.uavScope=s||{};}).catch(()=>{});});
 const timer=setInterval(async()=>{for(const client of Object.values(broker.clients))if(!client.uavInternal){let s=null;try{s=await principal(client.uavSessionId);}catch(e){}if(!s)client.close();else client.uavScope=s;}},10000);timer.unref();broker.on('closed',()=>{clearInterval(timer);brokers.delete(broker);});
 return internal;
}
module.exports={configure,credentials,principal,topicAllowed,serialsAllowed,serialIdentityMismatch,bindTopology,authenticatePilot,revoke};
