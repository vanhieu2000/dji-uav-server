/** Fail closed: API chưa có resolver phạm vi chỉ ADMIN dùng; không lọc quyền bằng UI. */
const {authenticateToken}=require('../routes/auth');
const {query}=require('../config/db');
const PUBLIC_AUTH=new Set(['/api/auth/login','/api/auth/forgot-password','/api/auth/reset-password','/api/pilot/login']);
function protectedPath(p){return /^\/(api|wayline|manage|storage|media|dji-media|uploads|tiles)(\/|$)/.test(p);}
function accessControl(req,res,next){
    if(!protectedPath(req.path)||PUBLIC_AUTH.has(req.path)||req.path==='/api/health'||req.path==='/api/vision/results'||/^\/api\/vision\/jobs\/[a-f0-9-]+\/input$/.test(req.path))return next();
    if(req.method==='GET'&&req.query.sig)return require('../services/signedDownloads').verify(req).then(valid=>valid?next():res.status(401).json({code:401,message:'Link tải không hợp lệ hoặc đã hết hạn'})).catch(()=>res.status(403).json({code:403,message:'Không có quyền tải'}));
    if(req.path.startsWith('/api/open/v1/'))return require('../services/apiKeys').authenticateApiKey(req,res,next);
    authenticateToken(req,res,async()=>{
      try{
        const safeAccount=/^\/api\/auth\/(me|logout|change-password)$/.test(req.path);
        if(req.user.must_change_password&&!safeAccount)return res.status(428).json({code:428,message:'Cần đổi mật khẩu trước khi tiếp tục'});
        if(await require('./pilotAccess').pilotAccess(req))return next();
        if(req.method==='GET'&&/^\/tiles\/basemaps\/[^/]+\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)$/.test(req.path)){const code=req.path.split('/')[3];const [map]=await query('SELECT plant_id FROM base_maps WHERE map_code=?',[code]);if(map){require('../services/authorization').permission(req.user,'assets:read');require('../services/authorization').plant(req.user,map.plant_id);return next();}}
        if(req.user.role==='ADMIN'||safeAccount||req.path.startsWith('/api/workspace/'))return next();
        // Pilot chỉ được đọc/ghi luồng có session resolver; không mở toàn bộ API legacy.
        if(['/api/pilot/tickets','/api/pilot/log'].includes(req.path))return next();
        return res.status(403).json({code:403,message:'Tài khoản không có quyền hoặc API chưa hỗ trợ phạm vi dữ liệu này'});
      }catch(e){const out=require('../utils/http').toHttpError(e);return res.status(out.status).json({code:out.status,message:out.message});}
    });
}
function audit(req,res,next){
    if(!protectedPath(req.path))return next();
    const path=req.path;
    res.on('finish',()=>{
        if(path==='/api/health')return;
        // Không lưu query, Authorization, body, cookie hoặc token link ảnh.
        query('INSERT INTO access_audit (user_id,method,path,status_code) VALUES (?,?,?,?)',
            [req.user?.user_id||null,req.method,path.slice(0,512),res.statusCode]).catch(()=>{});
    });next();
}
module.exports={accessControl,audit,protectedPath};
