const express=require('express'),bcrypt=require('bcryptjs');
const {query,withTransaction}=require('../config/db');
const {asyncHandler,ok,NotFoundError}=require('../utils/http');
const {authenticateToken,passwordInput}=require('./auth');
const v=require('../utils/validate');
const router=express.Router();let onChanged=()=>{};router.setOnUserChanged=fn=>{onChanged=fn;};
router.use(authenticateToken,(req,res,next)=>req.user.role==='ADMIN'?next():res.status(403).json({code:403,message:'Chỉ quản trị viên được quản lý tài khoản'}));
const ROLES=['ADMIN','ENGINEER','OPERATOR','VIEWER'],PERMISSIONS=['tasks:read','tasks:write','assets:read','media:write','alerts:write','reports:read'];
const PUBLIC_COLUMNS='user_id,username,full_name,email,phone,role,status,unit_id,must_change_password,last_login';
async function scopes(conn,uid,ids){
    if(!Array.isArray(ids)||ids.length>100)throw new v.ValidationError('Danh sách nhà máy không hợp lệ');
    const unique=[...new Set(ids.map(x=>v.parseId(x,'nhà máy')))];await conn.execute('DELETE FROM user_plant_scopes WHERE user_id=?',[uid]);
    for(const id of unique){const [p]=await conn.execute('SELECT plant_id FROM plants WHERE plant_id=?',[id]);if(!p.length)throw new v.ValidationError('Nhà máy không tồn tại');await conn.execute('INSERT INTO user_plant_scopes (user_id,plant_id) VALUES (?,?)',[uid,id]);}
}
function email(value){const s=v.optionalString(value,'email',100);if(s&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw new v.ValidationError('Email không hợp lệ');return s;}
router.get('/users',asyncHandler(async(req,res)=>{
    const rows=await query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY username`),plants=await query('SELECT * FROM user_plant_scopes');
    ok(res,rows.map(u=>({...u,plant_ids:plants.filter(p=>p.user_id===u.user_id).map(p=>p.plant_id)})));
}));
router.post('/users',asyncHandler(async(req,res)=>{
    const b=req.body,name=v.requiredString(b.username,'tài khoản',50);if(!/^[A-Za-z0-9_.-]{3,50}$/.test(name))throw new v.ValidationError('Tài khoản chỉ gồm chữ, số, dấu chấm/gạch');
    const hash=await bcrypt.hash(passwordInput(b.password),12),role=v.oneOf(b.role,ROLES,'vai trò'),unit=v.isBlank(b.unit_id)?null:v.parseId(b.unit_id,'đơn vị');
    const id=await withTransaction(async conn=>{
        const [r]=await conn.execute("INSERT INTO users (username,password_hash,full_name,email,phone,role,unit_id,must_change_password) VALUES (?,?,?,?,?,?,?,1)",[name,hash,v.requiredString(b.full_name,'họ tên',100),email(b.email),v.optionalString(b.phone,'điện thoại',20),role,unit]);
        await scopes(conn,r.insertId,b.plant_ids||[]);return r.insertId;
    });ok(res,{user_id:id});
}));
router.put('/users/:id',asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.id,'người dùng'),b=req.body;
    await withTransaction(async conn=>{
        const [admins]=await conn.execute("SELECT user_id FROM users WHERE role='ADMIN' AND status='ACTIVE' FOR UPDATE");
        const [rows]=await conn.execute('SELECT * FROM users WHERE user_id=? FOR UPDATE',[id]),u=rows[0];if(!u)throw new NotFoundError('Không tìm thấy người dùng');
        const role=b.role===undefined?u.role:v.oneOf(b.role,ROLES,'vai trò'),status=b.status===undefined?u.status:v.oneOf(b.status,['ACTIVE','LOCKED','INACTIVE'],'trạng thái');
        if(u.role==='ADMIN'&&u.status==='ACTIVE'&&(role!=='ADMIN'||status!=='ACTIVE')&&admins.length<=1)throw new v.ValidationError('Phải giữ ít nhất một quản trị viên đang hoạt động');
        const unit=b.unit_id===undefined?u.unit_id:v.isBlank(b.unit_id)?null:v.parseId(b.unit_id,'đơn vị');
        await conn.execute('UPDATE users SET full_name=?,email=?,phone=?,role=?,status=?,unit_id=?,auth_version=auth_version+1 WHERE user_id=?',
            [b.full_name===undefined?u.full_name:v.requiredString(b.full_name,'họ tên',100),b.email===undefined?u.email:email(b.email),b.phone===undefined?u.phone:v.optionalString(b.phone,'điện thoại',20),role,status,unit,id]);
        if(b.plant_ids!==undefined)await scopes(conn,id,b.plant_ids);
        await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[id]);
    });onChanged(id);ok(res,{user_id:id});
}));
router.post('/users/:id/password',asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.id,'người dùng'),hash=await bcrypt.hash(passwordInput(req.body.password),12);
    await withTransaction(async conn=>{const [r]=await conn.execute('UPDATE users SET password_hash=?,must_change_password=1,auth_version=auth_version+1 WHERE user_id=?',[hash,id]);if(!r.affectedRows)throw new NotFoundError('Không tìm thấy người dùng');await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[id]);});
    onChanged(id);ok(res,{user_id:id,must_change_password:true});
}));
router.get('/units',asyncHandler(async(req,res)=>ok(res,await query('SELECT * FROM units ORDER BY unit_name'))));
router.post('/units',asyncHandler(async(req,res)=>{const r=await query('INSERT INTO units (unit_code,unit_name) VALUES (?,?)',[v.requiredString(req.body.unit_code,'mã đơn vị',50),v.requiredString(req.body.unit_name,'tên đơn vị',150)]);ok(res,{unit_id:r.insertId});}));
router.put('/units/:id',asyncHandler(async(req,res)=>{const r=await query('UPDATE units SET unit_code=?,unit_name=? WHERE unit_id=?',[v.requiredString(req.body.unit_code,'mã đơn vị',50),v.requiredString(req.body.unit_name,'tên đơn vị',150),v.parseId(req.params.id,'đơn vị')]);if(!r.affectedRows)throw new NotFoundError('Không tìm thấy đơn vị');ok(res,{});}));
router.get('/permissions',asyncHandler(async(req,res)=>ok(res,await query('SELECT * FROM role_permissions ORDER BY role,permission'))));
router.put('/permissions/:role',asyncHandler(async(req,res)=>{
    const role=v.oneOf(req.params.role,['ENGINEER','OPERATOR','VIEWER'],'vai trò'),ps=req.body.permissions;
    if(!Array.isArray(ps)||ps.some(p=>!PERMISSIONS.includes(p)))throw new v.ValidationError('Quyền không hợp lệ');
    const ids=await withTransaction(async conn=>{
        await conn.execute('DELETE FROM role_permissions WHERE role=?',[role]);for(const p of [...new Set(ps)])await conn.execute('INSERT INTO role_permissions (role,permission) VALUES (?,?)',[role,p]);
        const [users]=await conn.execute('SELECT user_id FROM users WHERE role=?',[role]);await conn.execute('UPDATE users SET auth_version=auth_version+1 WHERE role=?',[role]);
        for(const u of users)await conn.execute('DELETE FROM user_sessions WHERE user_id=?',[u.user_id]);return users.map(u=>u.user_id);
    });ids.forEach(onChanged);ok(res,{role,permissions:ps});
}));
router.put('/devices/:sn/scope',asyncHandler(async(req,res)=>{
    const sn=v.requiredString(req.params.sn,'serial',64),plant=v.isBlank(req.body.plant_id)?null:v.parseId(req.body.plant_id,'nhà máy'),unit=v.isBlank(req.body.unit_id)?null:v.parseId(req.body.unit_id,'đơn vị');
    const r=await query('UPDATE uav_devices SET plant_id=?,unit_id=? WHERE device_sn=?',[plant,unit,sn]);if(!r.affectedRows)throw new NotFoundError('Không tìm thấy UAV');ok(res,{});
}));
router.get('/catalog',asyncHandler(async(req,res)=>ok(res,await query('SELECT * FROM common_catalog ORDER BY catalog_type,code'))));
router.post('/catalog',asyncHandler(async(req,res)=>{
    const b=req.body;const type=v.requiredString(b.catalog_type,'loại danh mục',50),code=v.requiredString(b.code,'mã',64),label=v.requiredString(b.label,'tên',255);
    if(!/^[A-Za-z0-9_-]+$/.test(type)||!/^[A-Za-z0-9_-]+$/.test(code))throw new v.ValidationError('Mã danh mục không hợp lệ');
    if(typeof b.enabled!=='boolean')throw new v.ValidationError('enabled không hợp lệ');
    await query('INSERT INTO common_catalog (catalog_type,code,label,enabled) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),enabled=VALUES(enabled)',[type,code,label,b.enabled?1:0]);ok(res,{});
}));
const SETTINGS={media_retention_days:[0,36500],max_media_storage_gb:[0,1000000],audit_retention_days:[1,36500]};
router.get('/settings',asyncHandler(async(req,res)=>{const rows=await query('SELECT setting_key,setting_value FROM system_settings');ok(res,rows.filter(x=>SETTINGS[x.setting_key]));}));
router.put('/settings',asyncHandler(async(req,res)=>{
    const entries=Object.entries(req.body);if(!entries.length||entries.some(([k,x])=>!SETTINGS[k]||typeof x!=='number'||!Number.isFinite(x)||x<SETTINGS[k][0]||x>SETTINGS[k][1]))throw new v.ValidationError('Cấu hình lưu trữ không hợp lệ');
    await withTransaction(async conn=>{for(const [k,x]of entries)await conn.execute('INSERT INTO system_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',[k,String(x)]);});ok(res,{});
}));
router.get('/audit',asyncHandler(async(req,res)=>ok(res,await query('SELECT * FROM access_audit ORDER BY audit_id DESC LIMIT 500'))));
router.get('/api-keys',asyncHandler(async(req,res)=>ok(res,await query('SELECT key_id,user_id,label,expires_at,revoked_at,created_at,last_used_at,permissions_json,plant_ids_json FROM api_keys ORDER BY created_at DESC'))));
router.post('/api-keys',asyncHandler(async(req,res)=>{
 const b=req.body,uid=v.parseId(b.user_id,'người dùng'),[u]=await query('SELECT * FROM users WHERE user_id=?',[uid]);
 if(!u||u.status!=='ACTIVE'||u.must_change_password||u.role==='ADMIN')throw new v.ValidationError('API key cần tài khoản dịch vụ không ADMIN, đã đổi mật khẩu và đang hoạt động');
 const ps=b.permissions,ids=b.plant_ids;if(!Array.isArray(ps)||!ps.length||ps.some(p=>!PERMISSIONS.includes(p))||!Array.isArray(ids)||!ids.length)throw new v.ValidationError('Cần quyền và phạm vi nhà máy cụ thể');
 const allowed=await query('SELECT permission FROM role_permissions WHERE role=?',[u.role]),plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[uid]);
 if(ps.some(p=>!allowed.some(x=>x.permission===p))||ids.some(id=>!plants.some(x=>x.plant_id===id)))throw new v.ValidationError('API key không được vượt quyền tài khoản');
 const days=v.optionalInt(b.expires_days,'số ngày',{min:1,max:365})||30,crypto=require('crypto'),token='uavk_'+crypto.randomBytes(32).toString('hex'),id=crypto.randomUUID();
 await query('INSERT INTO api_keys (key_id,user_id,label,key_hash,auth_version,permissions_json,plant_ids_json,expires_at) VALUES (?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL ? DAY))',[id,uid,v.requiredString(b.label,'tên khóa',100),require('../services/apiKeys').sha(token),u.auth_version,JSON.stringify([...new Set(ps)]),JSON.stringify([...new Set(ids)]),days]);
 res.set('Cache-Control','no-store');ok(res,{key_id:id,token,message:'Chỉ hiện khóa một lần; lưu trong kho bí mật của hệ thống tích hợp'});
}));
router.delete('/api-keys/:id',asyncHandler(async(req,res)=>{await query('UPDATE api_keys SET revoked_at=NOW() WHERE key_id=?',[v.requiredString(req.params.id,'mã khóa',36)]);ok(res,{});}));
module.exports=router;
