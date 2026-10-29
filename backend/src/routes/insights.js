const express=require('express');
const {query,withTransaction}=require('../config/db');
const {asyncHandler,ok,NotFoundError}=require('../utils/http');
const {authenticateToken}=require('./auth');
const v=require('../utils/validate');
const {linearTrend,ruleFor,TABLES}=require('../services/temperatureHistory');
const router=express.Router();
let onChanged=()=>{};
router.setOnChanged=fn=>{onChanged=fn;};
function asset(req){const type=req.params.type||req.query.asset_type;if(!TABLES[type])throw new v.ValidationError('Loại tài sản không hợp lệ');return {type,id:v.parseId(req.params.id||req.query.asset_id,'tài sản')};}
router.get('/temperature',asyncHandler(async(req,res)=>{
    const {type,id}=asset(req);
    const samples=await query('SELECT * FROM temperature_history WHERE asset_type=? AND asset_id=? AND valid=1 ORDER BY captured_at DESC,history_id DESC LIMIT 1000',[type,id]);
    const rule=await withTransaction(conn=>ruleFor(conn,type,id));
    ok(res,{samples,rule,trend:linearTrend(samples,rule?.max_temp_c),limited:samples.length===1000});
}));
router.get('/disconnectors',asyncHandler(async(req,res)=>{
    const ticket=v.isBlank(req.query.ticket_id)?null:v.parseId(req.query.ticket_id,'phiếu');
    ok(res,await query(`SELECT d.disconnector_id,d.dcl_code,d.dcl_name,d.phase,d.max_allowed_temp,
        MAX(h.max_temp_c) AS max_temp_c,MAX(h.captured_at) AS inspected_at,COUNT(h.history_id) AS measurements
        FROM disconnectors d JOIN temperature_history h ON (h.asset_type='DISCONNECTOR' AND h.asset_id=d.disconnector_id)
          OR (h.asset_type='CONTACT' AND h.asset_id IN (SELECT contact_id FROM dcl_contacts WHERE disconnector_id=d.disconnector_id))
        WHERE h.valid=1 ${ticket?'AND h.ticket_id=?':''}
        GROUP BY d.disconnector_id ORDER BY d.dcl_code,d.phase`,ticket?[ticket]:[]));
}));
router.get('/rules/:type/:id',asyncHandler(async(req,res)=>{
    const {type,id}=asset(req);const rows=await query('SELECT * FROM asset_alert_rules WHERE asset_type=? AND asset_id=?',[type,id]);ok(res,rows[0]||null);
}));
router.put('/rules/:type/:id',authenticateToken,asyncHandler(async(req,res)=>{
    if(req.user.role!=='ADMIN')return res.status(403).json({code:403,message:'Chỉ quản trị viên được đổi ngưỡng'});
    const {type,id}=asset(req),[table,col]=TABLES[type];
    const [exists]=await query(`SELECT ${col} FROM ${table} WHERE ${col}=?`,[id]);if(!exists)throw new NotFoundError('Không tìm thấy tài sản');
    const b=req.body,n=(key,min,max,nullable=false)=>{if(nullable&&b[key]==null)return null;if(typeof b[key]!=='number'||!Number.isFinite(b[key])||b[key]<min||b[key]>max)throw new v.ValidationError(`${key} không hợp lệ`);return b[key];};
    if(typeof b.enabled!=='boolean')throw new v.ValidationError('enabled không hợp lệ');
    await query(`INSERT INTO asset_alert_rules (asset_type,asset_id,max_temp_c,delta_t_c,min_confidence,enabled,trend_horizon_days) VALUES (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE max_temp_c=VALUES(max_temp_c),delta_t_c=VALUES(delta_t_c),min_confidence=VALUES(min_confidence),enabled=VALUES(enabled),trend_horizon_days=VALUES(trend_horizon_days)`,
        [type,id,n('max_temp_c',-273,2000,true),n('delta_t_c',0,2000,true),n('min_confidence',0,1),b.enabled?1:0,n('trend_horizon_days',0.1,3650,true)]);
    ok(res,{asset_type:type,asset_id:id});
}));
router.delete('/rules/:type/:id',authenticateToken,asyncHandler(async(req,res)=>{
    if(req.user.role!=='ADMIN')return res.status(403).json({code:403,message:'Chỉ quản trị viên được đổi ngưỡng'});
    const {type,id}=asset(req);await query('DELETE FROM asset_alert_rules WHERE asset_type=? AND asset_id=?',[type,id]);ok(res,{inherited:true});
}));
router.get('/alerts',asyncHandler(async(req,res)=>{
    const where=[],params=[];
    if(req.query.status){where.push('a.status=?');params.push(v.oneOf(req.query.status,['UNREAD','ACKNOWLEDGED','RESOLVED','DISMISSED'],'trạng thái'));}
    if(req.query.ticket_id){where.push('a.ticket_id=?');params.push(v.parseId(req.query.ticket_id,'phiếu'));}
    ok(res,await query(`SELECT a.*,d.defect_code,d.model_version,m.file_url FROM defect_alerts a LEFT JOIN ai_defect_detections d ON a.detection_id=d.detection_id
        LEFT JOIN media_files m ON d.media_id=m.media_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY a.alert_id DESC LIMIT 500`,params));
}));
router.patch('/alerts/:id',authenticateToken,asyncHandler(async(req,res)=>{
    if(req.user.role==='VIEWER')return res.status(403).json({code:403,message:'Tài khoản chỉ xem không được xử lý cảnh báo'});
    const id=v.parseId(req.params.id,'cảnh báo'),status=v.oneOf(req.body.status,['UNREAD','ACKNOWLEDGED','RESOLVED','DISMISSED'],'trạng thái');
    await withTransaction(async conn=>{
        const [rows]=await conn.execute('SELECT status FROM defect_alerts WHERE alert_id=? FOR UPDATE',[id]);if(!rows[0])throw new NotFoundError('Không tìm thấy cảnh báo');
        if(rows[0].status===status)return;
        await conn.execute('INSERT INTO alert_changes (alert_id,from_status,to_status,user_id) VALUES (?,?,?,?)',[id,rows[0].status,status,req.user.user_id]);
        await conn.execute('UPDATE defect_alerts SET status=?,handled_by_user_id=?,handled_at=IF(?=\'UNREAD\',NULL,NOW()) WHERE alert_id=?',[status,status==='UNREAD'?null:req.user.user_id,status,id]);
    });onChanged({type:'alert_status',data:{alert_id:id,status}});ok(res,{alert_id:id,status});
}));
router.get('/alerts/:id/history',asyncHandler(async(req,res)=>{ok(res,await query('SELECT * FROM alert_changes WHERE alert_id=? ORDER BY change_id',[v.parseId(req.params.id,'cảnh báo')]));}));
function reportDays(req){
    return req.query.days==='all'?null:(v.optionalInt(req.query.days,'số ngày',{min:1,max:3660})||30);
}
router.get('/alert-report',asyncHandler(async(req,res)=>{
    const days=reportDays(req),page=v.optionalInt(req.query.page,'trang',{min:1,max:100000})||1;
    const pageSize=v.optionalInt(req.query.page_size,'kích thước trang',{min:1,max:100})||20;
    const where=[],params=[];
    if(days){where.push('a.created_at>=DATE_SUB(NOW(),INTERVAL ? DAY)');params.push(days);}
    if(req.query.status){where.push('a.status=?');params.push(v.oneOf(req.query.status,['UNREAD','ACKNOWLEDGED','RESOLVED','DISMISSED'],'trạng thái'));}
    if(req.query.level){where.push('a.alert_level=?');params.push(v.oneOf(req.query.level,['INFO','WARNING','CRITICAL'],'mức cảnh báo'));}
    const q=v.optionalString(req.query.q,'từ khóa',150);
    if(q){where.push('(LOCATE(?,a.title)>0 OR LOCATE(?,a.message)>0 OR LOCATE(?,t.ticket_code)>0)');params.push(q,q,q);}
    const joins='FROM defect_alerts a LEFT JOIN inspection_tickets t ON a.ticket_id=t.ticket_id';
    const clause=where.length?'WHERE '+where.join(' AND '):'';
    const [count]=await query(`SELECT COUNT(*) AS total ${joins} ${clause}`,params);
    const items=await query(`SELECT a.alert_id,a.ticket_id,a.title,a.message,a.alert_level,a.status,a.created_at,t.ticket_code,d.defect_code,d.max_temperature,m.file_url
        ${joins} LEFT JOIN ai_defect_detections d ON a.detection_id=d.detection_id LEFT JOIN media_files m ON d.media_id=m.media_id
        ${clause} ORDER BY a.created_at DESC,a.alert_id DESC LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`,params);
    ok(res,{items,total:Number(count.total),page,page_size:pageSize,days});
}));
router.get('/charts',asyncHandler(async(req,res)=>{
    const days=reportDays(req),since=column=>days?`${column}>=DATE_SUB(NOW(),INTERVAL ${days} DAY)`:'1=1';
    const [tickets,defects,areas,temperatures,statuses,levels]=await Promise.all([
        query(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') AS day,COUNT(*) AS total,SUM(status='COMPLETED') AS completed FROM inspection_tickets WHERE ${since('created_at')} GROUP BY day ORDER BY day`),
        query(`SELECT COALESCE(defect_code,defect_type) AS code,COUNT(*) AS total FROM ai_defect_detections WHERE ${since('detected_at')} GROUP BY code ORDER BY total DESC`),
        query(`SELECT a.area_id,a.area_name,COUNT(DISTINCT d.panel_id) AS total FROM ai_defect_detections d JOIN solar_panels p ON d.panel_id=p.panel_id JOIN solar_strings s ON p.string_id=s.string_id JOIN solar_areas a ON s.area_id=a.area_id
            WHERE ${since('d.detected_at')} GROUP BY a.area_id ORDER BY total DESC`),
        query(`SELECT DATE_FORMAT(captured_at,'%Y-%m-%d') AS day,MAX(max_temp_c) AS max_temp_c FROM temperature_history WHERE valid=1 AND ${since('captured_at')} GROUP BY day ORDER BY day`),
        query(`SELECT status,COUNT(*) AS total FROM inspection_tickets WHERE ${since('created_at')} GROUP BY status`),
        query(`SELECT alert_level AS level,COUNT(*) AS total FROM defect_alerts WHERE ${since('created_at')} GROUP BY alert_level`)
    ]);ok(res,{days,tickets,defects,areas,temperatures,statuses,levels});
}));
module.exports=router;
