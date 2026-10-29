/* Remember a Pilot login using a revocable opaque cookie, never a saved password. */
const crypto=require('crypto'),{query}=require('../config/db');
const NAME='uav_pilot_remember',PATH='/api/pilot',DAYS=30;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function token(req){const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(NAME+'='))?.slice(NAME.length+1);return /^[a-f0-9]{64}$/.test(raw||'')?raw:null;}
function options(req){return {httpOnly:true,sameSite:'strict',secure:req.secure,path:PATH};}
async function user(req){const value=token(req);if(!value)return null;
 const [u]=await query(`SELECT u.* FROM pilot_remember_tokens r JOIN users u ON u.user_id=r.user_id
 WHERE r.token_hash=? AND r.expires_at>NOW() AND u.status='ACTIVE' AND u.must_change_password=0 AND r.auth_version=u.auth_version`,[hash(value)]);
 return u||null;
}
async function forget(req,res){const value=token(req);if(value)await query('DELETE FROM pilot_remember_tokens WHERE token_hash=?',[hash(value)]);res.clearCookie(NAME,options(req));}
async function save(req,res,actor){const value=crypto.randomBytes(32).toString('hex');
 await query('DELETE FROM pilot_remember_tokens WHERE expires_at<=NOW()');
 await query('INSERT INTO pilot_remember_tokens (token_hash,user_id,auth_version,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 30 DAY))',[hash(value),actor.user_id,actor.auth_version]);
 await forget(req,res);res.cookie(NAME,value,{...options(req),maxAge:DAYS*86400000});
}
async function authenticate(req){const u=await user(req);if(!u)return {ok:false,status:401,message:'Đăng nhập đã lưu hết hạn hoặc đã bị thu hồi. Nhập lại mật khẩu.'};
 const auth=require('../routes/auth'),jwt=await auth.issueToken(u);await query('UPDATE users SET last_login=NOW() WHERE user_id=?',[u.user_id]);return {ok:true,token:jwt,user:auth.publicUser(u)};
}
module.exports={user,save,forget,authenticate};
