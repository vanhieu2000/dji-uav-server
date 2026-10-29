const express=require('express'),{query}=require('../config/db'),{asyncHandler,ok}=require('../utils/http'),v=require('../utils/validate'),a=require('../services/authorization'),tasks=require('../services/inspectionTasks');
const router=express.Router();
router.put('/external-tasks/:externalId',asyncHandler(async(req,res)=>{
 a.permission(req.user,'tasks:write');const externalId=v.requiredString(req.params.externalId,'mã phiếu ngoài',128),source='api-user-'+req.user.user_id;
 const body={};for(const key of ['ticket_name','inspection_type','target_facility','plant_id','revision','scope','planned_start_at','planned_end_at','vision_required','notes'])if(req.body[key]!==undefined)body[key]=req.body[key];
 const plant=v.parseId(body.plant_id,'nhà máy');if(!req.user.unit_id)throw a.denied();await require('./workspace').validateReferences(req.user,body,plant);body.unit_id=req.user.unit_id;
 const [existing]=await query('SELECT ticket_id,plant_id FROM inspection_tickets WHERE external_source=? AND external_id=?',[source,externalId]);
 if(existing){await a.ticket(req.user,existing.ticket_id);if(existing.plant_id!==plant)throw a.denied();}
 ok(res,await tasks.saveTask(body,null,{source,id:externalId}));
}));
router.get('/external-tasks/:externalId',asyncHandler(async(req,res)=>{
 a.permission(req.user,'tasks:read');const [row]=await query('SELECT ticket_id FROM inspection_tickets WHERE external_source=? AND external_id=?',['api-user-'+req.user.user_id,v.requiredString(req.params.externalId,'mã ngoài',128)]);if(!row)throw a.denied();const t=await a.ticket(req.user,row.ticket_id);ok(res,{ticket:t,progress:await tasks.summary(t.ticket_id)});
}));
// Read endpoints use exactly the same resource resolvers as the authenticated workbench.
router.use((req,res,next)=>{
 if(req.method!=='GET'||!/^\/(tasks(?:\/\d+(?:\/report\.(?:pdf|docx))?)?|statistics|context)$/.test(req.path))return res.status(404).json({code:404,message:'Endpoint không được công bố'});
 require('./workspace')(req,res,next);
});
module.exports=router;
