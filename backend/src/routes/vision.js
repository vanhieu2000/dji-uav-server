const express = require('express');
const fs = require('fs');
const { query, withTransaction } = require('../config/db');
const { authenticateToken } = require('./auth');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');
const jobs = require('../services/visionJobs');
const { UUID } = require('../services/visionContract');
const router = express.Router();
let onResult = () => {};
router.setOnResult = fn => { onResult = fn; };
function admin(req,res,next) {
    authenticateToken(req,res,()=>{
        if(req.user.role!=='ADMIN') return res.status(403).json({code:403,message:'Chỉ quản trị viên được thay đổi cấu hình Vision'});
        next();
    });
}
function machineAuth(req,res,next) {
    const secret=process.env.VISION_WEBHOOK_SECRET;
    if(!secret) return res.status(503).json({code:503,message:'Chưa cấu hình xác thực Vision'});
    if(!jobs.tokenEqual(req.headers.authorization,`Bearer ${secret}`))return res.status(401).json({code:401,message:'Xác thực Vision không hợp lệ'});
    next();
}
function jobId(value){if(!UUID.test(value||''))throw new v.ValidationError('job_id không hợp lệ');return value;}

router.post('/results',machineAuth,asyncHandler(async(req,res)=>{
    const result=await jobs.acceptResult(req.body);
    if(!result.duplicate)onResult({type:'vision_result',data:result});
    ok(res,result);
}));
router.get('/media',asyncHandler(async(req,res)=>{
    ok(res,await query(`SELECT media_id,ticket_id,file_name,lens,sha256,source FROM media_files WHERE sha256 IS NOT NULL AND source <> 'MANUAL' ORDER BY media_id DESC LIMIT 500`));
}));
router.get('/jobs/:id',asyncHandler(async(req,res)=>{
    const [job]=await query('SELECT j.*,m.file_name,m.file_url,m.ticket_id,m.lens FROM vision_jobs j JOIN media_files m ON m.media_id=j.media_id WHERE j.job_id=?',[jobId(req.params.id)]);
    if(!job)throw new NotFoundError('Không tìm thấy job');
    const detections=await query('SELECT * FROM ai_defect_detections WHERE vision_job_id=? ORDER BY detection_id',[job.job_id]);
    ok(res,{...job,detections});
}));
router.post('/detections/:id/asset',admin,asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.id,'kết quả'),assetId=v.parseId(req.body.asset_id,'tài sản');
    const type=req.body.asset_type,version=req.body.result_version;
    const targets={PANEL:['solar_panels','panel_id'],DISCONNECTOR:['disconnectors','disconnector_id'],CONTACT:['dcl_contacts','contact_id']};
    if(!targets[type]||!Number.isInteger(version))throw new v.ValidationError('Loại tài sản hoặc phiên bản không hợp lệ');
    await withTransaction(async conn=>{
        const [rows]=await conn.execute('SELECT * FROM ai_defect_detections WHERE detection_id=? FOR UPDATE',[id]);
        const d=rows[0];if(!d)throw new NotFoundError('Không tìm thấy phát hiện');
        if(d.result_version!==version)throw new v.ValidationError('Kết quả đã thay đổi, tải lại trước khi xác nhận');
        const [table,col]=targets[type];
        const [assets]=await conn.execute(`SELECT ${col} FROM ${table} WHERE ${col}=?`,[assetId]);
        if(!assets.length)throw new NotFoundError('Không tìm thấy tài sản');
        await conn.execute("UPDATE ai_defect_detections SET panel_id=?,disconnector_id=?,contact_id=?,verified_by_human=1,verified_by_user_id=?,mapping_status='HUMAN_CONFIRMED' WHERE detection_id=?",
            [type==='PANEL'?assetId:null,type==='DISCONNECTOR'?assetId:null,type==='CONTACT'?assetId:null,req.user.user_id,id]);
        await conn.execute('INSERT INTO vision_asset_reviews (detection_id,vision_job_id,result_version,user_id,asset_type,asset_id) VALUES (?,?,?,?,?,?)',[id,d.vision_job_id,version,req.user.user_id,type,assetId]);
        await require('../services/temperatureHistory').recordConfirmed(conn,d,type,assetId);
        if(type==='PANEL')await conn.execute("UPDATE solar_panels SET status='DEFECT',last_inspected_at=NOW() WHERE panel_id=?",[assetId]);
        if(d.panel_id && (type!=='PANEL'||d.panel_id!==assetId))await conn.execute("UPDATE solar_panels SET status=IF(EXISTS(SELECT 1 FROM ai_defect_detections WHERE panel_id=? AND verified_by_human=1),'DEFECT','NORMAL') WHERE panel_id=? AND status='DEFECT'",[d.panel_id,d.panel_id]);
    });
    ok(res,{detection_id:id,asset_type:type,asset_id:assetId});
}));
router.get('/jobs',asyncHandler(async(req,res)=>{
    const tid=v.isBlank(req.query.ticket_id)?null:v.parseId(req.query.ticket_id,'phiếu');
    const rows=await query(`SELECT j.job_id,j.media_id,j.status,j.attempts,j.last_error,j.model_version,j.result_version,j.created_at,j.updated_at,
        m.file_name,m.ticket_id FROM vision_jobs j JOIN media_files m ON m.media_id=j.media_id
        ${tid?'WHERE m.ticket_id=?':''} ORDER BY j.created_at DESC LIMIT 500`,tid?[tid]:[]);
    ok(res,rows);
}));
router.post('/jobs',admin,asyncHandler(async(req,res)=>{ok(res,await jobs.enqueue(v.parseId(req.body.media_id,'ảnh')));}));
router.post('/jobs/:id/retry',admin,asyncHandler(async(req,res)=>{
    const id=jobId(req.params.id);
    const [row]=await query('SELECT * FROM vision_jobs WHERE job_id=?',[id]);
    if(!row)throw new NotFoundError('Không tìm thấy job');
    if(!['FAILED','INVALID'].includes(row.status))throw new v.ValidationError('Chỉ thử lại job lỗi');
    const [media]=await query('SELECT * FROM media_files WHERE media_id=?',[row.media_id]);
    await jobs.checkInput(media);
    if(media.sha256!==row.input_sha256)throw new v.ValidationError('Ảnh đã đổi hash, cần tạo job mới');
    await query("UPDATE vision_jobs SET status='QUEUED',attempts=0,next_attempt_at=NOW(),lease_until=NULL,last_error=NULL WHERE job_id=? AND status IN ('FAILED','INVALID')",[id]);
    ok(res,{job_id:id});
}));
router.get('/jobs/:id/input',asyncHandler(async(req,res)=>{
    const secret=process.env.VISION_WEBHOOK_SECRET,id=jobId(req.params.id),expires=Number(req.query.expires);
    if(!secret||!Number.isSafeInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+900){return res.status(401).json({code:401,message:'Link ảnh hết hạn hoặc không hợp lệ'});}
    const [job]=await query('SELECT * FROM vision_jobs WHERE job_id=?',[id]);if(!job)throw new NotFoundError('Không tìm thấy job');
    if(!jobs.tokenEqual(req.query.token,jobs.inputToken(job,expires,secret)))return res.status(401).json({code:401,message:'Link ảnh không hợp lệ'});
    const [media]=await query('SELECT * FROM media_files WHERE media_id=?',[job.media_id]);
    if(!media||media.sha256!==job.input_sha256)throw new NotFoundError('Không còn đúng ảnh đầu vào');
    await jobs.checkInput(media);
    res.set('Cache-Control','no-store').type('image/jpeg');
    const stream=fs.createReadStream(media.file_path_local);stream.on('error',err=>{if(!res.headersSent)res.status(500).end();else res.destroy();});stream.pipe(res);
}));
router.put('/jobs/:id/projection',admin,asyncHandler(async(req,res)=>{
    const id=jobId(req.params.id),c=req.body;
    if(c.confirmed!==true||!['IR','WIDE','ZOOM'].includes(c.lens))throw new v.ValidationError('Cần xác nhận calibration và lens');
    const out={confirmed:true,lens:c.lens};
    for(const [k,min,max] of [['agl_m',0.1,500],['hfov_deg',0.1,159],['vfov_deg',0.1,159],['image_width',1,50000],['image_height',1,50000]]){
        const n=c[k];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new v.ValidationError(`${k} không hợp lệ`);out[k]=n;
    }
    if(!Number.isInteger(out.image_width)||!Number.isInteger(out.image_height))throw new v.ValidationError('Kích thước ảnh phải nguyên');
    const r=await query('UPDATE vision_jobs SET projection_json=? WHERE job_id=? AND result_version=0',[JSON.stringify(out),id]);
    if(!r.affectedRows)throw new v.ValidationError('Job không tồn tại hoặc đã có kết quả; không tự đổi calibration cũ');
    ok(res,{job_id:id,projection:out});
}));
router.get('/rules',asyncHandler(async(req,res)=>{ok(res,await query('SELECT * FROM alert_rules ORDER BY asset_type'));}));
router.put('/rules/:type',admin,asyncHandler(async(req,res)=>{
    const type=req.params.type;
    if(!['PANEL','DISCONNECTOR','CONTACT','OTHER'].includes(type))throw new v.ValidationError('Loại tài sản không hợp lệ');
    const b=req.body;
    const number=(key,min,max,nullable=false)=>{const n=b[key];if(nullable&&n==null)return null;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new v.ValidationError(`${key} không hợp lệ`);return n;};
    const temp=number('max_temp_c',-273,2000,true),delta=number('delta_t_c',0,2000,true),confidence=number('min_confidence',0,1);
    if(typeof b.enabled!=='boolean')throw new v.ValidationError('enabled phải là true/false');
    await query(`INSERT INTO alert_rules (asset_type,max_temp_c,delta_t_c,min_confidence,enabled,trend_horizon_days) VALUES (?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE max_temp_c=VALUES(max_temp_c),delta_t_c=VALUES(delta_t_c),min_confidence=VALUES(min_confidence),enabled=VALUES(enabled),trend_horizon_days=VALUES(trend_horizon_days)`,[type,temp,delta,confidence,b.enabled?1:0,number('trend_horizon_days',0.1,3650,true)]);
    ok(res,{asset_type:type});
}));
module.exports=router;
