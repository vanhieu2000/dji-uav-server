const crypto = require('crypto');
const fs = require('fs');
const { query, withTransaction } = require('../config/db');
const v = require('../utils/validate');
const { NotFoundError } = require('../utils/http');
const { sha256File } = require('./mediaIngest');
const SCOPES={
    AREA:['solar_areas','area_id','SOLAR_AREA'], STRING:['solar_strings','string_id','SOLAR_STRING'], PANEL:['solar_panels','panel_id','SOLAR_PANEL'],
    BAY:['substation_bays','bay_id','SUBSTATION_BAY'], DISCONNECTOR:['disconnectors','disconnector_id','DISCONNECTOR'], CONTACT:['dcl_contacts','contact_id','DCL_CONTACT']
};
function conflict(message){const e=new v.ValidationError(message);e.status=409;return e;}
function date(value,label){
    if(value==null||value==='')return null;
    if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(new Date(value).getTime()))throw new v.ValidationError(`${label} cần ngày giờ ISO kèm múi giờ`);
    return new Date(value);
}
async function exists(conn,table,col,id,label){
    if(id==null)return;
    const [rows]=await conn.execute(`SELECT ${col} FROM ${table} WHERE ${col}=?`,[id]);
    if(!rows.length)throw new v.ValidationError(`Không tìm thấy ${label}`);
}
async function saveTask(body,id=null,external=null){
    return withTransaction(async conn=>{
        let externalSha=null;
        if(external){
            externalSha=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const [rows]=await conn.execute('SELECT ticket_id,ticket_code,revision,external_request_sha FROM inspection_tickets WHERE external_source=? AND external_id=? FOR UPDATE',[external.source,external.id]);
            if(rows[0]){if(rows[0].external_request_sha===externalSha)return {ticket_id:rows[0].ticket_id,ticket_code:rows[0].ticket_code,revision:rows[0].revision,replayed:true};id=rows[0].ticket_id;}
        }
        let current=null;
        if(id){const [rows]=await conn.execute('SELECT * FROM inspection_tickets WHERE ticket_id=? FOR UPDATE',[id]);current=rows[0];if(!current)throw new NotFoundError('Không tìm thấy phiếu');
            if(body.revision!==current.revision)throw conflict('Phiếu đã thay đổi, tải lại trước khi lưu');
            if(['COMPLETED','CANCELLED'].includes(current.status))throw conflict('Không sửa phiếu đã kết thúc');}
        const b={...current,...body};
        const name=v.requiredString(b.ticket_name,'tên phiếu',255),type=v.oneOf(b.inspection_type,['SOLAR_PANEL','DISCONNECTOR','OVERALL_SURVEY'],'loại kiểm tra');
        const facility=v.requiredString(b.target_facility,'phạm vi mô tả',255);
        const profile=v.isBlank(b.capture_profile_id)?null:v.parseId(b.capture_profile_id,'hồ sơ chụp');
        const team=v.isBlank(b.team_id)?null:v.parseId(b.team_id,'tổ công tác');
        const inspector=v.isBlank(b.inspector_id)?null:v.parseId(b.inspector_id,'người phụ trách');
        const start=body.planned_start_at===undefined?(current?.planned_start_at||null):date(body.planned_start_at,'Bắt đầu kế hoạch');
        const end=body.planned_end_at===undefined?(current?.planned_end_at||null):date(body.planned_end_at,'Kết thúc kế hoạch');
        if(start&&end&&end<start)throw new v.ValidationError('Kết thúc kế hoạch phải sau bắt đầu');
        if(b.vision_required!=null&&![true,false,0,1].includes(b.vision_required))throw new v.ValidationError('vision_required không hợp lệ');
        await exists(conn,'capture_profiles','profile_id',profile,'hồ sơ chụp');await exists(conn,'inspection_teams','team_id',team,'tổ công tác');await exists(conn,'users','user_id',inspector,'người phụ trách');
        const device=v.optionalString(b.assigned_device_sn,'mã UAV',64);
        await exists(conn,'uav_devices','device_sn',device,'UAV được giao');
        const plantId=v.isBlank(b.plant_id)?null:v.parseId(b.plant_id,'nhà máy');
        const unitId=v.isBlank(b.unit_id)?null:v.parseId(b.unit_id,'đơn vị');
        await exists(conn,'plants','plant_id',plantId,'nhà máy');await exists(conn,'units','unit_id',unitId,'đơn vị');
        const notes=v.optionalString(b.notes,'ghi chú',5000);
        let revision=current?current.revision+1:0;
        if(!id){
            const code=`PKT-${type==='DISCONNECTOR'?'DCL':'PIN'}-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
            const [r]=await conn.execute(`INSERT INTO inspection_tickets (ticket_code,ticket_name,inspection_type,target_facility,assigned_device_sn,inspector_id,notes,team_id,capture_profile_id,planned_start_at,planned_end_at,vision_required)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[code,name,type,facility,device,inspector,notes,team,profile,start,end,b.vision_required?1:0]);id=r.insertId;
        }else await conn.execute(`UPDATE inspection_tickets SET ticket_name=?,inspection_type=?,target_facility=?,assigned_device_sn=?,inspector_id=?,notes=?,team_id=?,capture_profile_id=?,planned_start_at=?,planned_end_at=?,vision_required=?,revision=?,reconciled_at=NULL WHERE ticket_id=?`,
            [name,type,facility,device,inspector,notes,team,profile,start,end,b.vision_required?1:0,revision,id]);
        await conn.execute('UPDATE inspection_tickets SET plant_id=?,unit_id=? WHERE ticket_id=?',[plantId,unitId,id]);
        if(body.scope!==undefined){
            if(!Array.isArray(body.scope)||body.scope.length>5000)throw new v.ValidationError('Phạm vi tối đa 5000 mục');
            const seen=new Set();await conn.execute('DELETE FROM ticket_details WHERE ticket_id=?',[id]);
            for(const target of body.scope){
                const mapping=SCOPES[target.type];if(!mapping)throw new v.ValidationError('Loại tài sản không hợp lệ');
                if(type==='SOLAR_PANEL'&&!['AREA','STRING','PANEL'].includes(target.type))throw new v.ValidationError('Phiếu pin chỉ chọn khu/chuỗi/tấm pin');
                if(type==='DISCONNECTOR'&&!['BAY','DISCONNECTOR','CONTACT'].includes(target.type))throw new v.ValidationError('Phiếu DCL chỉ chọn ngăn lộ/DCL/mối nối');
                const tid=v.parseId(target.id,'tài sản');const key=target.type+':'+tid;if(seen.has(key))continue;seen.add(key);
                const [table,col,itemType]=mapping;await exists(conn,table,col,tid,'tài sản trong phạm vi');
                await conn.execute(`INSERT INTO ticket_details (ticket_id,item_type,${col}) VALUES (?,?,?)`,[id,itemType,tid]);
            }
        }
        if(body.member_ids!==undefined||body.team_id!==undefined||!current){
            let members=body.member_ids||[];if(!Array.isArray(members)||members.length>100)throw new v.ValidationError('Tối đa 100 người trong tổ');
            members=members.map(x=>v.parseId(x,'người thực hiện'));
            if(team){const [rows]=await conn.execute('SELECT user_id FROM inspection_team_members WHERE team_id=?',[team]);members.push(...rows.map(x=>x.user_id));}
            if(inspector)members.push(inspector);members=[...new Set(members)];
            await conn.execute('DELETE FROM ticket_members WHERE ticket_id=?',[id]);
            for(const uid of members){await exists(conn,'users','user_id',uid,'thành viên');await conn.execute('INSERT INTO ticket_members (ticket_id,user_id) VALUES (?,?)',[id,uid]);}
        }
        if(body.route_ids!==undefined||body.assigned_route_id!==undefined){
            const ids=body.route_ids||[body.assigned_route_id];if(!Array.isArray(ids)||ids.length>100)throw new v.ValidationError('Danh sách tuyến không hợp lệ');
            const routes=[...new Set(ids.filter(x=>x!=null&&x!=='').map(x=>v.parseId(x,'đường bay')))];
            await conn.execute('DELETE FROM ticket_routes WHERE ticket_id=?',[id]);
            for(let i=0;i<routes.length;i++){await exists(conn,'flight_routes','route_id',routes[i],'đường bay');await conn.execute('INSERT INTO ticket_routes (ticket_id,route_id,sort_order) VALUES (?,?,?)',[id,routes[i],i]);}
            await conn.execute('UPDATE inspection_tickets SET assigned_route_id=? WHERE ticket_id=?',[routes[0]||null,id]);
        }
        await conn.execute('INSERT INTO ticket_changes (ticket_id,revision,change_type,details_json) VALUES (?,?,?,?)',[id,revision,current?'UPDATED':'CREATED',JSON.stringify({scope:body.scope??null,team_id:team,member_ids:body.member_ids??null})]);
        if(external)await conn.execute('UPDATE inspection_tickets SET external_source=?,external_id=?,external_request_sha=? WHERE ticket_id=?',[external.source,external.id,externalSha,id]);
        const [rows]=await conn.execute('SELECT ticket_id,ticket_code,revision FROM inspection_tickets WHERE ticket_id=?',[id]);return rows[0];
    });
}
async function summary(id){
    const [t]=await query('SELECT * FROM inspection_tickets WHERE ticket_id=?',[id]);if(!t)throw new NotFoundError('Không tìm thấy phiếu');
    const [counts]=await query(`SELECT COUNT(*) AS total,SUM(sha256 IS NOT NULL AND source <> 'MANUAL') AS originals,
        SUM(flight_session_id IS NULL) AS unassigned_flight,SUM(uploaded_at>DATE_ADD(captured_at,INTERVAL 30 MINUTE)) AS late
        FROM media_files WHERE ticket_id=?`,[id]);
    const flights=await query('SELECT f.flight_session_id,f.device_sn,f.started_at,f.ended_at,f.end_reason,(SELECT COUNT(*) FROM media_files m WHERE m.flight_session_id=f.flight_session_id) AS photo_count FROM flight_sessions f WHERE f.ticket_id=? ORDER BY f.started_at',[id]);
    const [events]=await query("SELECT SUM(status='duplicate') AS duplicates,SUM(status='failed') AS failed FROM media_ingest_events WHERE ticket_id=?",[id]);
    const vision=await query(`SELECT COALESCE(j.status,'NOT_QUEUED') AS status,COUNT(*) AS total FROM media_files m
        LEFT JOIN vision_jobs j ON j.media_id=m.media_id AND j.input_sha256=m.sha256 WHERE m.ticket_id=? GROUP BY COALESCE(j.status,'NOT_QUEUED')`,[id]);
    const receiving=flights.some(f=>!f.ended_at);
    const ready=!!t.reconciled_at && t.expected_media_count!=null && Number(counts.originals)===t.expected_media_count && !receiving;
    const visionReady=!t.vision_required||vision.every(x=>x.status==='SUCCEEDED');
    return {ticket_id:id,photos:{total:Number(counts.total)||0,originals:Number(counts.originals)||0,unassigned_flight:Number(counts.unassigned_flight)||0,late:Number(counts.late)||0,
        duplicates:Number(events.duplicates)||0,failed_attempts:Number(events.failed)||0},flights,vision,
        flight_state:receiving?'AIRBORNE':'NO_OPEN_FLIGHT',sync_state:ready?'RECONCILED':Number(counts.total)?'RECEIVING':'NOT_STARTED',
        vision_ready:visionReady,can_complete:ready&&visionReady,expected_media_count:t.expected_media_count,reconciled_at:t.reconciled_at};
}
async function reconcile(id,body){
    const expected=v.optionalInt(body.expected_count,'số ảnh dự kiến',{min:0,max:1000000});
    if(expected==null||body.originals_checked!==true)throw new v.ValidationError('Cần số ảnh dự kiến và xác nhận đã đối chiếu ảnh gốc');
    const note=v.requiredString(body.note,'nguồn đối soát (thẻ nhớ/nhóm file)',1000);
    const [t]=await query('SELECT ticket_id FROM inspection_tickets WHERE ticket_id=?',[id]);if(!t)throw new NotFoundError('Không tìm thấy phiếu');
    await query('UPDATE inspection_tickets SET reconciled_at=NULL WHERE ticket_id=?',[id]);
    const files=await query("SELECT file_path_local,sha256 FROM media_files WHERE ticket_id=? AND sha256 IS NOT NULL AND source <> 'MANUAL'",[id]);
    if(files.length!==expected)throw conflict(`Đã nhận ${files.length} ảnh gốc, khác số dự kiến ${expected}`);
    for(const f of files){if(!f.file_path_local||!fs.existsSync(f.file_path_local)||await sha256File(f.file_path_local)!==f.sha256)throw conflict('Có file thiếu hoặc hash không khớp');}
    await query('UPDATE inspection_tickets SET expected_media_count=?,reconciled_at=NOW(),reconciliation_note=?,revision=revision+1 WHERE ticket_id=?',[expected,note,id]);
    return summary(id);
}
module.exports={saveTask,summary,reconcile,SCOPES,conflict};
