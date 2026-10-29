/* NMS v4 native sign + purpose/resource grant, checked synchronously before any bytes. */
const crypto=require('crypto'),{query}=require('../config/db');
const secret=crypto.randomBytes(32).toString('hex'),grants=new Map(),sessions=new Map();
function mint(path,purpose,user){
 if(!/^\/live\/(?:ticket_\d+|gateway)_[a-f0-9]{16}$/.test(path)||!['play','publish'].includes(purpose)||!user?.session_id)throw Error('Invalid stream grant');
 const now=Date.now();for(const [id,g]of grants)if(g.expires<now)grants.delete(id);if(grants.size>=10000)throw Error('Quá nhiều stream grant');
 const id=crypto.randomBytes(24).toString('hex'),exp=Math.floor(now/1000)+(purpose==='publish'?12*3600:3600);
 grants.set(id,{path,purpose,user_id:user.user_id,session_id:user.session_id,auth_version:user.auth_version,expires:exp*1000});
 const hash=crypto.createHash('md5').update(`${path}-${exp}-${secret}`).digest('hex');return `sign=${exp}-${hash}&grant=${id}`;
}
function allow(session,purpose){
 const g=grants.get(session.streamQuery?.grant);if(!g||g.path!==session.streamPath||g.purpose!==purpose||g.expires<Date.now()){session.streamQuery={...session.streamQuery,sign:'invalid'};return false;}
 sessions.set(session.id,{session,grant:g});return true;
}
function close(session){try{session.close?.();session.socket?.end();}catch(e){}}
function revoke({user_id,session_id}){
 for(const [id,g]of grants)if(g.user_id===user_id&&(!session_id||g.session_id===session_id))grants.delete(id);
 for(const [id,s]of sessions)if(s.grant.user_id===user_id&&(!session_id||s.grant.session_id===session_id)){close(s.session);sessions.delete(id);}
}
async function sweep(){
 for(const [id,s]of sessions){const g=s.grant;let valid=false;
  if(g.expires>Date.now())try{const [u]=await query("SELECT u.auth_version FROM users u JOIN user_sessions s ON s.user_id=u.user_id WHERE s.session_id=? AND u.user_id=? AND u.status='ACTIVE' AND s.expires_at>NOW()",[g.session_id,g.user_id]);valid=u&&u.auth_version===g.auth_version;}catch(e){}
  if(!valid){close(s.session);sessions.delete(id);}
 }
}
setInterval(()=>sweep().catch(()=>{}),30000).unref();
function release(session){sessions.delete(session.id);}
function playback(row,user){if(!row.flv_url)return row;return {...row,flv_url:row.flv_url+'?'+mint(row.streamPath,'play',user)};}
module.exports={secret,mint,allow,revoke,release,playback};
