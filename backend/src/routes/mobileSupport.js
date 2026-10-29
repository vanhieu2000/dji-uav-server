const express=require('express'),fs=require('fs');
const {query}=require('../config/db'),{asyncHandler,ok}=require('../utils/http'),v=require('../utils/validate'),a=require('../services/authorization');
const router=express.Router(),upload=require('./mediaUpload');
router.post('/tasks/:id/photos',asyncHandler(async(req,res,next)=>{
 a.permission(req.user,'media:write');await a.ticket(req.user,v.parseId(req.params.id,'phiếu'));next();
}),require('../services/storageQuota').middleware,upload.receiveFiles,asyncHandler(async(req,res)=>{
 const files=req.files||[],id=v.parseId(req.params.id,'phiếu'),items=[];
 try{
  if(!files.length)throw new v.ValidationError('Chưa chọn ảnh');
  for(const f of files){
   const fd=fs.openSync(f.path,'r'),head=Buffer.alloc(3);try{fs.readSync(fd,head,0,3,0);}finally{fs.closeSync(fd);}
   if(!/\.jpe?g$/i.test(f.originalname)||!head.equals(Buffer.from([255,216,255]))){items.push({name:f.originalname,status:'failed',error:'Chỉ nhận ảnh JPEG gốc'});continue;}
   const target=upload.moveIn(f),r=await upload.ingestSaved(target.full,target.name,f.originalname,{source:'SD_IMPORT',ticketId:id});
   if(r.media.ticket_id!==id){items.push({name:f.originalname,status:'failed',error:r.status==='duplicate'?'Ảnh trùng đã gắn nhiệm vụ khác; cần quản trị kiểm tra':'Không ghi nhận được ảnh'});continue;}
   items.push({name:f.originalname,status:r.status,media_id:r.media.media_id});
  }
  ok(res,{items});
 }finally{for(const f of files)fs.rmSync(f.path,{force:true});}
}));
router.get('/statistics',asyncHandler(async(req,res)=>{
 a.permission(req.user,'reports:read');
 const days=v.optionalInt(req.query.days,'số ngày',{min:1,max:3660})||30,u=req.user;
 if(u.role!=='ADMIN'&&(!u.unit_id||!u.plant_ids.length))return ok(res,{days,defects:[],areas:[],disconnectors:[]});
 const restriction=u.role==='ADMIN'?'':` AND t.unit_id=? AND t.plant_id IN (${u.plant_ids.map(()=>'?').join(',')})`,params=u.role==='ADMIN'?[]:[u.unit_id,...u.plant_ids];
 const [defects,areas,disconnectors]=await Promise.all([
  query(`SELECT COALESCE(d.defect_code,d.defect_type) AS code,COUNT(*) AS total FROM ai_defect_detections d JOIN inspection_tickets t ON d.ticket_id=t.ticket_id WHERE d.detected_at>=DATE_SUB(NOW(),INTERVAL ? DAY) ${restriction} GROUP BY code ORDER BY total DESC`,[days,...params]),
  query(`SELECT a.area_id,a.area_name,COUNT(*) AS total FROM ai_defect_detections d JOIN inspection_tickets t ON d.ticket_id=t.ticket_id JOIN solar_panels p ON d.panel_id=p.panel_id JOIN solar_strings s ON p.string_id=s.string_id JOIN solar_areas a ON s.area_id=a.area_id WHERE d.detected_at>=DATE_SUB(NOW(),INTERVAL ? DAY) ${restriction} GROUP BY a.area_id ORDER BY total DESC`,[days,...params]),
  query(`SELECT h.asset_type,h.asset_id,MAX(h.max_temp_c) AS max_temp_c,COUNT(*) AS measurements FROM temperature_history h JOIN inspection_tickets t ON h.ticket_id=t.ticket_id WHERE h.valid=1 AND h.asset_type IN ('CONTACT','DISCONNECTOR') AND h.captured_at>=DATE_SUB(NOW(),INTERVAL ? DAY) ${restriction} GROUP BY h.asset_type,h.asset_id`,[days,...params])
 ]);ok(res,{days,defects,areas,disconnectors});
}));
router.get('/tasks/:id/report.:format',asyncHandler(async(req,res)=>{
 a.permission(req.user,'reports:read');const id=v.parseId(req.params.id,'phiếu');await a.ticket(req.user,id);
 const format=v.oneOf(req.params.format,['DOCX','PDF'],'định dạng').toLowerCase();
 const report=await require('../services/taskReport').generate(id,format);
 res.set('Cache-Control','no-store').attachment(`inspection-${id}.${format}`).type(format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(report);
}));
module.exports=router;
