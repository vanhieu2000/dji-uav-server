const express=require('express');
const {query,withTransaction}=require('../config/db');
const {asyncHandler,ok,NotFoundError}=require('../utils/http');
const v=require('../utils/validate');
const router=express.Router();
router.get('/people',asyncHandler(async(req,res)=>{ok(res,await query("SELECT user_id,username,full_name,role FROM users WHERE status='ACTIVE' ORDER BY full_name"));}));
router.get('/',asyncHandler(async(req,res)=>{
    const teams=await query('SELECT * FROM inspection_teams ORDER BY team_name');
    const members=await query('SELECT tm.team_id,u.user_id,u.full_name FROM inspection_team_members tm JOIN users u ON tm.user_id=u.user_id');
    ok(res,teams.map(t=>({...t,members:members.filter(m=>m.team_id===t.team_id)})));
}));
async function save(body,id){
    const name=v.requiredString(body.team_name,'tên tổ',150),members=body.member_ids;
    if(!Array.isArray(members)||members.length>100)throw new v.ValidationError('Danh sách tổ tối đa 100 người');
    return withTransaction(async conn=>{
        if(id){const [rows]=await conn.execute('SELECT team_id FROM inspection_teams WHERE team_id=? FOR UPDATE',[id]);if(!rows.length)throw new NotFoundError('Không tìm thấy tổ');await conn.execute('UPDATE inspection_teams SET team_name=? WHERE team_id=?',[name,id]);}
        else{const [r]=await conn.execute('INSERT INTO inspection_teams (team_name) VALUES (?)',[name]);id=r.insertId;}
        await conn.execute('DELETE FROM inspection_team_members WHERE team_id=?',[id]);
        for(const uid of [...new Set(members.map(x=>v.parseId(x,'thành viên')))]){
            const [users]=await conn.execute("SELECT user_id FROM users WHERE user_id=? AND status='ACTIVE'",[uid]);
            if(!users.length)throw new v.ValidationError('Thành viên không tồn tại hoặc đã khóa');
            await conn.execute('INSERT INTO inspection_team_members (team_id,user_id) VALUES (?,?)',[id,uid]);
        }return {team_id:id};
    });
}
router.post('/',asyncHandler(async(req,res)=>ok(res,await save(req.body))));
router.put('/:id',asyncHandler(async(req,res)=>ok(res,await save(req.body,v.parseId(req.params.id,'tổ')))));
module.exports=router;
