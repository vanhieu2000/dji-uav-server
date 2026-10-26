const crypto=require('crypto'),{query}=require('../config/db'),authorization=require('./authorization');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function credentials(sessionId,user){
 const password=crypto.randomBytes(32).toString('hex');
 await query('UPDATE pilot_sessions SET mqtt_password_hash=?,auth_session_id=?,auth_version=? WHERE session_id=?',[sha(password),user.session_id,user.auth_version,sessionId]);
 return {username:'pilot:'+sessionId,password};
}
async function principal(id){
 const [s]=await query(`SELECT p.*,u.status,u.role,u.unit_id,u.auth_version AS current_auth_version FROM pilot_sessions p
  JOIN users u ON p.user_id=u.user_id JOIN user_sessions s ON p.auth_session_id=s.session_id
  WHERE p.session_id=? AND p.ended_at IS NULL AND s.expires_at>NOW() AND u.status='ACTIVE'`,[id]);
 if(!s||s.auth_version!==s.current_auth_version||(!s.rc_sn&&!s.aircraft_sn))return null;
 const plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[s.user_id]);
 const user={...s,plant_ids:plants.map(p=>p.plant_id)};try{await authorization.ticket(user,s.ticket_id);}catch(e){return null;}return s;
}
function topicAllowed(session,topic,direction){
 if(typeof topic!=='string'||topic.includes('+')||topic.includes('#'))return false;
 const match=/^(thing|sys)\/product\/([A-Za-z0-9_-]{4,64})\/([a-z_]+)$/.exec(topic);if(!match||![session.rc_sn,session.aircraft_sn].filter(Boolean).includes(match[2]))return false;
 const allowed=direction==='publish'?['osd','state','events','requests','services_reply','status','status_reply']:['services','requests_reply','events_reply','status_reply'];return allowed.includes(match[3]);
}
const brokers=new Set();
function revoke({user_id,session_id}){for(const broker of brokers)for(const client of Object.values(broker.clients))if(!client.uavInternal&&client.uavScope?.user_id===user_id&&(!session_id||client.uavScope.auth_session_id===session_id))client.close();}
function serialsAllowed(s,value,depth=0){if(depth>16)return false;if(Array.isArray(value))return value.every(x=>serialsAllowed(s,x,depth+1));if(value&&typeof value==='object')for(const [k,x]of Object.entries(value)){if((k==='sn'||k.endsWith('_sn'))&&typeof x==='string'&&x&&![s.rc_sn,s.aircraft_sn].includes(x))return false;if(!serialsAllowed(s,x,depth+1))return false;}return true;}
function configure(broker){
 brokers.add(broker);
 const internal={username:'server-'+crypto.randomUUID(),password:crypto.randomBytes(32).toString('hex')};
 broker.authenticate=(client,username,password,callback)=>{
  if(username===internal.username&&password?.toString()===internal.password){client.uavInternal=true;return callback(null,true);}
  const match=/^pilot:(\d+)$/.exec(username||'');if(!match)return callback(null,false);
  principal(Number(match[1])).then(s=>{const actual=sha(password||Buffer.alloc(0));if(!s||!s.mqtt_password_hash||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(s.mqtt_password_hash)))return callback(null,false);client.uavSessionId=s.session_id;client.uavScope=s;callback(null,true);}).catch(()=>callback(null,false));
 };
 broker.authorizePublish=(client,packet,callback)=>{
  if(!client||client.uavInternal)return callback(null);
  if(packet.payload.length>1024*1024||packet.retain)return callback(Error('Payload/retain denied'));
  const now=Date.now();if(!client.uavRate||now-client.uavRate.at>1000)client.uavRate={at:now,n:0};if(++client.uavRate.n>100)return callback(Error('Rate denied'));
  let payload;try{payload=JSON.parse(packet.payload.toString());}catch(e){return callback(Error('JSON required'));}
  principal(client.uavSessionId).then(s=>callback(s&&serialsAllowed(s,payload)&&topicAllowed(s,packet.topic,'publish')?null:Error('Topic/payload denied'))).catch(()=>callback(Error('Session unavailable')));
 };
 broker.authorizeSubscribe=(client,sub,callback)=>{
  if(client.uavInternal)return callback(null,sub);
  principal(client.uavSessionId).then(s=>callback(null,s&&topicAllowed(s,sub.topic,'subscribe')?sub:null)).catch(()=>callback(null,null));
 };
 // Recheck each outbound packet so locked/revoked subscribers cannot keep reading commands.
 broker.authorizeForward=(client,packet)=>client.uavInternal||topicAllowed(client.uavScope||{},packet.topic,'subscribe')?packet:null;
 broker.on('subscribe',(subs,client)=>{if(client&&!client.uavInternal)principal(client.uavSessionId).then(s=>{client.uavScope=s||{};}).catch(()=>{});});
 broker.on('clientReady',client=>{if(!client.uavInternal)principal(client.uavSessionId).then(s=>{client.uavScope=s||{};}).catch(()=>{});});
 const timer=setInterval(async()=>{for(const client of Object.values(broker.clients))if(!client.uavInternal){let s=null;try{s=await principal(client.uavSessionId);}catch(e){}if(!s)client.close();else client.uavScope=s;}},10000);timer.unref();broker.on('closed',()=>{clearInterval(timer);brokers.delete(broker);});
 return internal;
}
module.exports={configure,credentials,principal,topicAllowed,serialsAllowed,revoke};
