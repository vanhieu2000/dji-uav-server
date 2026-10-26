const crypto=require('crypto'),{query}=require('../config/db');
const sha=t=>crypto.createHash('sha256').update(t).digest('hex'),parse=x=>typeof x==='string'?JSON.parse(x):x;
async function authenticateApiKey(req,res,next){
 const match=/^Bearer (uavk_[a-f0-9]{64})$/.exec(req.get('authorization')||'');
 if(!match)return res.status(401).json({code:401,message:'Cần API key Bearer'});
 try{
  const [k]=await query("SELECT k.*,u.role,u.username,u.full_name,u.unit_id,u.status,u.must_change_password,u.auth_version AS current_auth_version FROM api_keys k JOIN users u ON k.user_id=u.user_id WHERE key_hash=? AND revoked_at IS NULL AND expires_at>NOW()",[sha(match[1])]);
  if(!k||k.auth_version!==k.current_auth_version||k.status!=='ACTIVE'||k.must_change_password||k.role==='ADMIN')return res.status(401).json({code:401,message:'API key không hợp lệ hoặc tài khoản đã bị thu hồi'});
  const plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[k.user_id]),permissions=await query('SELECT permission FROM role_permissions WHERE role=?',[k.role]);
  req.user={user_id:k.user_id,username:k.username,full_name:k.full_name,unit_id:k.unit_id,role:k.role,plant_ids:plants.map(x=>x.plant_id).filter(x=>parse(k.plant_ids_json).includes(x)),permissions:permissions.map(x=>x.permission).filter(x=>parse(k.permissions_json).includes(x))};req.apiKey=k;
  if(!limit(k.key_id))return res.status(429).json({code:429,message:'Giới hạn 120 yêu cầu/phút/API key'});
  await query('UPDATE api_keys SET last_used_at=NOW() WHERE key_id=?',[k.key_id]);next();
 }catch(e){require('../config/db').sendDbError(res,e);}
}
const buckets=new Map();function limit(id){const now=Date.now();let b=buckets.get(id);if(!b||now-b.time>=60000){b={time:now,count:0};buckets.set(id,b);}if(buckets.size>10000)for(const [id,b]of buckets)if(now-b.time>60000)buckets.delete(id);return ++b.count<=120;}
module.exports={authenticateApiKey,sha};
