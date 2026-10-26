const express=require('express'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),crypto=require('crypto');
const {query,withTransaction,sendDbError}=require('../config/db');
const {asyncHandler,ok}=require('../utils/http');
const v=require('../utils/validate');
const JWT_SECRET=require('../services/authKeys').signingKey();
const OPTIONS={algorithms:['HS256'],audience:'dji-uav',issuer:'dji-uav-server'};
const router=express.Router();let onRevoked=()=>{};
router.setOnRevoked=fn=>{onRevoked=fn;};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const publicUser=u=>({user_id:u.user_id,username:u.username,full_name:u.full_name,role:u.role,email:u.email,phone:u.phone,unit_id:u.unit_id,auth_version:u.auth_version||0,must_change_password:!!u.must_change_password});
function tokenOf(req){
    const get=name=>typeof req.get==='function'?req.get(name):req.headers[name];
    const auth=get('authorization');if(auth)return /^Bearer\s+(.+)$/i.exec(auth)?.[1]||null;
    const native=get('x-auth-token');if(native)return native;
    try{return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('uav_session='))?.slice(12)||null;}catch(e){return null;}
}
function decodeToken(token){try{return jwt.verify(String(token),JWT_SECRET,OPTIONS);}catch(e){return null;}}
async function issueToken(user,claims={}){
    const id=crypto.randomUUID(),payload={...publicUser(user),...claims};
    const token=jwt.sign(payload,JWT_SECRET,{algorithm:'HS256',audience:'dji-uav',issuer:'dji-uav-server',expiresIn:'12h',jwtid:id,subject:String(user.user_id)});
    await query(`INSERT INTO user_sessions (session_id,user_id,device_type,refresh_token,expires_at) VALUES (?,?,'UNKNOWN',?,DATE_ADD(NOW(),INTERVAL 12 HOUR))`,[id,user.user_id,sha(token)]);
    return token;
}
function issuePilotToken(user,sessionId,workspaceId){return issueToken(user,{pilot_session_id:sessionId,workspace_id:workspaceId});}
async function userForToken(token){
    const p=decodeToken(token);if(!p||!Number.isSafeInteger(p.user_id)||p.user_id<1||typeof p.jti!=='string')return null;
    const [u]=await query(`SELECT u.* FROM users u JOIN user_sessions s ON s.user_id=u.user_id
        WHERE u.user_id=? AND s.session_id=? AND s.expires_at>NOW() AND u.status='ACTIVE'`,[p.user_id,p.jti]);
    if(!u||u.auth_version!==(p.auth_version||0))return null;
    const plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[u.user_id]);
    const permissions=await query('SELECT permission FROM role_permissions WHERE role=?',[u.role]);
    return {...publicUser(u),session_id:p.jti,pilot_session_id:p.pilot_session_id||null,workspace_id:p.workspace_id||null,
        plant_ids:plants.map(x=>x.plant_id),permissions:permissions.map(x=>x.permission)};
}
async function authenticateToken(req,res,next){
    if(req.user)return next();
    const token=tokenOf(req);if(!token)return res.status(401).json({code:401,message:'Cần đăng nhập'});
    try{const user=await userForToken(token);if(!user)return res.status(401).json({code:401,message:'Phiên không hợp lệ hoặc đã hết hạn'});req.user=user;next();}
    catch(e){sendDbError(res,e);}
}
const loginBuckets=new Map();
function loginLimit(req,res,next){
    const key=req.ip||'unknown',now=Date.now();let b=loginBuckets.get(key);
    if(!b||now-b.start>15*60000){b={start:now,count:0};loginBuckets.set(key,b);}
    if(loginBuckets.size>10000)for(const [k,x]of loginBuckets)if(now-x.start>15*60000)loginBuckets.delete(k);
    if(++b.count>20)return res.status(429).json({code:429,message:'Thử lại sau 15 phút'});next();
}
async function verifyLogin(username,password){
    if(typeof username!=='string'||!username.trim()||username.length>50||typeof password!=='string'||password.length>128)return {ok:false,status:400,message:'Thông tin đăng nhập không hợp lệ'};
    const [u]=await query('SELECT * FROM users WHERE username=? LIMIT 1',[username.trim()]);
    const hash=u&&/^\$2[aby]\$/.test(u.password_hash)?u.password_hash:'$2b$10$C6UzMDM.H6dfI/f/IKcEe.6g9iGeBMKkmbv7zS7CIB1u3TKl0/E5K';
    let valid=false;try{valid=await bcrypt.compare(password,hash);}catch(e){/* invalid legacy hash never grants access */}
    if(!u||u.status!=='ACTIVE'||!valid)return {ok:false,status:401,message:'Tài khoản hoặc mật khẩu không đúng'};
    const token=await issueToken(u);await query('UPDATE users SET last_login=NOW() WHERE user_id=?',[u.user_id]);
    return {ok:true,token,user:publicUser(u),message:'Đăng nhập thành công'};
}
function cookie(req,res,token){res.cookie('uav_session',token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/',maxAge:12*3600000});}
router.post('/login',loginLimit,asyncHandler(async(req,res)=>{const r=await verifyLogin(req.body.username,req.body.password);if(!r.ok)return res.status(r.status).json({code:r.status,message:r.message});cookie(req,res,r.token);ok(res,{token:r.token,user:r.user});}));
router.get('/me',authenticateToken,asyncHandler(async(req,res)=>ok(res,req.user)));
router.post('/logout',authenticateToken,asyncHandler(async(req,res)=>{await query('DELETE FROM user_sessions WHERE session_id=?',[req.user.session_id]);onRevoked({user_id:req.user.user_id,session_id:req.user.session_id});res.clearCookie('uav_session',{path:'/',httpOnly:true,sameSite:'strict',secure:req.secure});ok(res,{});}));
function passwordInput(value){if(typeof value!=='string'||value.length<12||Buffer.byteLength(value,'utf8')>72)throw new v.ValidationError('Mật khẩu mới cần ít nhất 12 ký tự và tối đa 72 byte');return value;}
router.post('/change-password',authenticateToken,asyncHandler(async(req,res)=>{
    const password=passwordInput(req.body.new_password);const [u]=await query('SELECT * FROM users WHERE user_id=?',[req.user.user_id]);
    if(typeof req.body.old_password!=='string'||!await bcrypt.compare(req.body.old_password,u.password_hash))return res.status(400).json({code:400,message:'Mật khẩu cũ không đúng'});
    const hash=await bcrypt.hash(password,12);
    await withTransaction(async conn=>{await conn.execute('UPDATE users SET password_hash=?,auth_version=auth_version+1,must_change_password=0 WHERE user_id=?',[hash,u.user_id]);await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[u.user_id]);});
    onRevoked({user_id:u.user_id});res.clearCookie('uav_session',{path:'/'});ok(res,{reauthenticate:true},'Đã đổi mật khẩu, đăng nhập lại');
}));
router.post('/forgot-password',loginLimit,asyncHandler(async(req,res)=>{
    if(!process.env.SMTP_HOST||!process.env.PASSWORD_RESET_BASE_URL)return res.status(503).json({code:503,message:'Chưa cấu hình dịch vụ khôi phục mật khẩu; liên hệ quản trị'});
    const email=v.requiredString(req.body.email,'email',255);
    const [u]=await query("SELECT user_id,email FROM users WHERE email=? AND status='ACTIVE'",[email]);
    if(u){
        const token=crypto.randomBytes(32).toString('hex');await query('DELETE FROM password_reset_tokens WHERE user_id=?',[u.user_id]);
        await query('INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 20 MINUTE))',[sha(token),u.user_id]);
        try{await require('../services/passwordMail').sendReset(u.email,token);}catch(e){await query('DELETE FROM password_reset_tokens WHERE token_hash=?',[sha(token)]);console.warn('[Mật khẩu] Không gửi được email khôi phục');}
    }
    ok(res,{},'Nếu tài khoản hợp lệ, hướng dẫn sẽ được gửi qua email');
}));
router.post('/reset-password',loginLimit,asyncHandler(async(req,res)=>{
    if(typeof req.body.token!=='string'||!/^[a-f0-9]{64}$/.test(req.body.token))throw new v.ValidationError('Link khôi phục không hợp lệ');
    const password=passwordInput(req.body.new_password),hash=await bcrypt.hash(password,12);
    const uid=await withTransaction(async conn=>{
        const [rows]=await conn.execute('SELECT * FROM password_reset_tokens WHERE token_hash=? AND expires_at>NOW() AND used_at IS NULL FOR UPDATE',[sha(req.body.token)]);
        const r=rows[0];if(!r)throw new v.ValidationError('Link đã hết hạn hoặc đã dùng');
        const [changed]=await conn.execute("UPDATE users SET password_hash=?,auth_version=auth_version+1,must_change_password=0 WHERE user_id=? AND status='ACTIVE'",[hash,r.user_id]);
        if(!changed.affectedRows)throw new v.ValidationError('Tài khoản không thể khôi phục');
        await conn.execute('UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=?',[sha(req.body.token)]);await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[r.user_id]);return r.user_id;
    });onRevoked({user_id:uid});ok(res,{},'Đã đặt lại mật khẩu');
}));
module.exports={authRouter:router,authenticateToken,verifyLogin,decodeToken,issueToken,issuePilotToken,userForToken,tokenOf,passwordInput,publicUser,loginLimit};
