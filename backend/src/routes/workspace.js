/** API có phạm vi rõ ràng cho người vận hành/xem; legacy chưa có resolver chỉ ADMIN. */
const express=require('express');
const {query}=require('../config/db');
const {asyncHandler,ok}=require('../utils/http');
const v=require('../utils/validate');
const a=require('../services/authorization');
const router=express.Router();
const PLANT_SQL={
 AREA:'SELECT plant_id FROM solar_areas WHERE area_id=?',
 STRING:'SELECT a.plant_id FROM solar_strings s JOIN solar_areas a ON s.area_id=a.area_id WHERE s.string_id=?',
 PANEL:'SELECT a.plant_id FROM solar_panels p JOIN solar_strings s ON p.string_id=s.string_id JOIN solar_areas a ON s.area_id=a.area_id WHERE p.panel_id=?',
 BAY:'SELECT s.plant_id FROM substation_bays b JOIN substations s ON b.substation_id=s.substation_id WHERE b.bay_id=?',
 DISCONNECTOR:'SELECT s.plant_id FROM disconnectors d JOIN substation_bays b ON d.bay_id=b.bay_id JOIN substations s ON b.substation_id=s.substation_id WHERE d.disconnector_id=?',
 CONTACT:'SELECT s.plant_id FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id=d.disconnector_id JOIN substation_bays b ON d.bay_id=b.bay_id JOIN substations s ON b.substation_id=s.substation_id WHERE c.contact_id=?'
};
async function validateReferences(user,body,plantId){
    a.plant(user,plantId);
    if(body.scope)for(const t of body.scope){const sql=PLANT_SQL[t.type];if(!sql)throw a.denied();const [row]=await query(sql,[v.parseId(t.id,'tài sản')]);if(!row||row.plant_id!==plantId)throw a.denied();}
    if(body.assigned_route_id&&!body.route_ids)body.route_ids=[body.assigned_route_id];
    if(body.route_ids)for(const rid of body.route_ids){const [r]=await query('SELECT COALESCE(r.target_plant_id,a.plant_id) AS plant_id FROM flight_routes r LEFT JOIN solar_areas a ON r.area_id=a.area_id WHERE r.route_id=?',[v.parseId(rid,'tuyến')]);if(!r||r.plant_id!==plantId)throw a.denied();}
    if(body.assigned_device_sn){const [d]=await query('SELECT plant_id,unit_id FROM uav_devices WHERE device_sn=?',[body.assigned_device_sn]);if(!d||d.plant_id!==plantId||(user.role!=='ADMIN'&&d.unit_id!==user.unit_id))throw a.denied();}
    if(body.inspector_id){const [u]=await query('SELECT unit_id FROM users WHERE user_id=?',[v.parseId(body.inspector_id,'người phụ trách')]);if(!u||(user.role!=='ADMIN'&&u.unit_id!==user.unit_id))throw a.denied();}
    if(body.member_ids)for(const uid of body.member_ids){const [u]=await query('SELECT unit_id FROM users WHERE user_id=?',[uid]);if(!u||u.unit_id!==user.unit_id)throw a.denied();}
    if(body.team_id && user.role!=='ADMIN')throw a.denied(); // tổ dùng chung: quản trị giao; tránh kéo người đơn vị khác vào phiếu
}
router.get('/basemaps',asyncHandler(async(req,res)=>{
 a.permission(req.user,'assets:read');const rows=await query('SELECT map_id,map_code,map_name,plant_id,tile_ext,min_zoom,max_zoom,scheme FROM base_maps');
 ok(res,rows.filter(b=>req.user.role==='ADMIN'||req.user.plant_ids.includes(b.plant_id)).map(b=>({...b,tile_url:`/tiles/basemaps/${b.map_code}/{z}/{x}/{y}.${b.tile_ext}`})));
}));
router.get('/context',asyncHandler(async(req,res)=>{
    const u=req.user;
    const plants=u.role==='ADMIN'?await query('SELECT plant_id,plant_code,plant_name,center_lat,center_lng FROM plants'):u.plant_ids.length?await query(`SELECT plant_id,plant_code,plant_name,center_lat,center_lng FROM plants WHERE plant_id IN (${u.plant_ids.map(()=>'?').join(',')})`,u.plant_ids):[];
    ok(res,{user:u,plants});
}));
router.get('/tasks',asyncHandler(async(req,res)=>{
    a.permission(req.user,'tasks:read');
    if(req.user.role!=='ADMIN'&&(!req.user.unit_id||!req.user.plant_ids.length))return ok(res,[]);
    const restricted=req.user.role!=='ADMIN';
    const rows=await query(`SELECT ticket_id,ticket_code,ticket_name,inspection_type,target_facility,status,plant_id,unit_id,revision FROM inspection_tickets
        ${restricted?`WHERE unit_id=? AND plant_id IN (${req.user.plant_ids.map(()=>'?').join(',')})`:''} ORDER BY ticket_id DESC`,restricted?[req.user.unit_id,...req.user.plant_ids]:[]);
    ok(res,rows);
}));
router.get('/devices',asyncHandler(async(req,res)=>{
    a.permission(req.user,'assets:read');
    if(req.user.role!=='ADMIN'&&(!req.user.unit_id||!req.user.plant_ids.length))return ok(res,[]);
    const restricted=req.user.role!=='ADMIN';
    ok(res,await query(`SELECT device_sn,device_name,device_type,status,last_latitude AS lat,last_longitude AS lng,last_seen,plant_id,unit_id FROM uav_devices
        ${restricted?`WHERE unit_id=? AND plant_id IN (${req.user.plant_ids.map(()=>'?').join(',')})`:''}`,restricted?[req.user.unit_id,...req.user.plant_ids]:[]));
}));
router.get('/plants/:id/assets',asyncHandler(async(req,res)=>{
    a.permission(req.user,'assets:read');const id=v.parseId(req.params.id,'nhà máy');a.plant(req.user,id);
    const [areas,panels,dcls,contacts]=await Promise.all([
        query('SELECT area_id,area_code,area_name,center_lat AS lat,center_lng AS lng FROM solar_areas WHERE plant_id=?',[id]),
        query(`SELECT p.panel_id,p.panel_serial,p.latitude AS lat,p.longitude AS lng,p.status FROM solar_panels p JOIN solar_strings s ON p.string_id=s.string_id JOIN solar_areas a ON s.area_id=a.area_id WHERE a.plant_id=? LIMIT 5000`,[id]),
        query(`SELECT d.disconnector_id,d.dcl_code,d.dcl_name,d.latitude AS lat,d.longitude AS lng,d.last_inspected_temp,d.max_allowed_temp FROM disconnectors d JOIN substation_bays b ON d.bay_id=b.bay_id JOIN substations s ON b.substation_id=s.substation_id WHERE s.plant_id=?`,[id]),
        query(`SELECT c.contact_id,c.contact_code,c.latitude AS lat,c.longitude AS lng,c.last_inspected_temp FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id=d.disconnector_id JOIN substation_bays b ON d.bay_id=b.bay_id JOIN substations s ON b.substation_id=s.substation_id WHERE s.plant_id=?`,[id])
    ]);ok(res,{areas,panels,disconnectors:dcls,contacts,panels_limited:panels.length===5000});
}));
router.use(require('./mobileSupport'));
router.use('/tasks',asyncHandler(async(req,res,next)=>{
    a.permission(req.user,req.method==='GET'?'tasks:read':'tasks:write');
    if(req.path==='/' && req.method==='POST'){
        const plantId=v.parseId(req.body.plant_id,'nhà máy');if(req.user.role!=='ADMIN'&&!req.user.unit_id)throw a.denied();
        await validateReferences(req.user,req.body,plantId);req.body.unit_id=req.user.unit_id;return next();
    }
    const match=/^\/(\d+)(?:\/(.*))?$/.exec(req.path);if(!match)throw a.denied();
    const task=await a.ticket(req.user,Number(match[1]));
    if(match[2]&&match[2].startsWith('media/')&&req.user.role!=='ADMIN')throw a.denied();
    if(req.method==='PUT'){
        await validateReferences(req.user,req.body,task.plant_id);
        if(req.body.plant_id!=null&&Number(req.body.plant_id)!==task.plant_id)throw a.denied();
        req.body.unit_id=task.unit_id;req.body.plant_id=task.plant_id;
    }
    next();
}),require('./tickets'));
router.get('/media/:id',asyncHandler(async(req,res)=>{
    a.permission(req.user,'tasks:read');const m=await a.media(req.user,v.parseId(req.params.id,'ảnh'));
    if(!m.file_path_local)throw a.denied();res.set('Cache-Control','no-store').sendFile(require('path').resolve(m.file_path_local));
}));
router.get('/flights/:id',asyncHandler(async(req,res,next)=>{
    const [f]=await query('SELECT ticket_id FROM flight_sessions WHERE flight_session_id=?',[v.parseId(req.params.id,'chuyến')]);if(!f)throw a.denied();await a.ticket(req.user,f.ticket_id);
    req.url='/'+req.params.id;require('./flights')(req,res,next);
}));
router.get('/live/:ticketId',asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.ticketId,'phiếu');await a.ticket(req.user,id);
    const rows=await query('SELECT stream_id,device_sn,channel FROM ticket_live_streams WHERE ticket_id=?',[id]);
    ok(res,rows.map(r=>({...r,ticket_id:id}))); // playback có chữ ký được cấp ở lớp streaming; không lộ endpoint giả
}));
module.exports=router;
module.exports.validateReferences=validateReferences;
