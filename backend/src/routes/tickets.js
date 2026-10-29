const express = require('express');
const router = express.Router();
const { query, sendDbError, withTransaction } = require('../config/db');
const ticketRoutes = require('../services/ticketRoutes');
const tasks = require('../services/inspectionTasks');
const v = require('../utils/validate');
const { asyncHandler, ok } = require('../utils/http');
const { channelForTicket } = require('../services/ticketService');

// 1. Lấy danh sách phiếu kiểm tra
router.get('/', async (req, res) => {
    try {
        const { type, status, q } = req.query;
        let sql = `
            SELECT t.*, r.route_name, u.full_name as inspector_name, d.device_name
            FROM inspection_tickets t
            LEFT JOIN flight_routes r ON t.assigned_route_id = r.route_id
            LEFT JOIN users u ON t.inspector_id = u.user_id
            LEFT JOIN uav_devices d ON t.assigned_device_sn = d.device_sn
            WHERE 1=1
        `;
        const params = [];
        if (type) {
            sql += ' AND t.inspection_type = ?';
            params.push(type);
        }
        if (status) {
            sql += ' AND t.status = ?';
            params.push(status);
        }
        if (q) {
            sql += ' AND (t.ticket_code LIKE ? OR t.ticket_name LIKE ? OR t.target_facility LIKE ?)';
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        if(req.query.date){if(!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date))throw new v.ValidationError('Ngày không hợp lệ');sql+=" AND DATE(TIMESTAMPADD(MINUTE,420-TIMESTAMPDIFF(MINUTE,UTC_TIMESTAMP(),NOW()),COALESCE(t.planned_start_at,t.created_at)))=?";params.push(req.query.date);}
        sql += ' ORDER BY t.ticket_id DESC';
        const rows = await query(sql, params);
        res.json({ code: 0, data: rows.map(r => ({ ...r, livestream_channel: channelForTicket(r) })) });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 2. Tạo phiếu kiểm tra mới
router.post('/', asyncHandler(async (req, res) => { ok(res, await tasks.saveTask(req.body), 'Đã tạo phiếu kiểm tra'); }));
router.put('/:id', asyncHandler(async (req, res) => { ok(res, await tasks.saveTask(req.body,v.parseId(req.params.id,'phiếu')), 'Đã lưu phiếu'); }));
router.get('/:id/progress', asyncHandler(async(req,res)=>ok(res,await tasks.summary(v.parseId(req.params.id,'phiếu')))));
router.post('/:id/reconcile', asyncHandler(async(req,res)=>ok(res,await tasks.reconcile(v.parseId(req.params.id,'phiếu'),req.body))));
router.get('/:id/ingest-events', asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.id,'phiếu');
    ok(res,await query('SELECT * FROM media_ingest_events WHERE ticket_id=? ORDER BY ingest_id DESC LIMIT 500',[id]));
}));

router.get('/unresolved-media',asyncHandler(async(req,res)=>{
    ok(res,await query('SELECT media_id,file_name,file_url,captured_at,device_sn,assignment_status FROM media_files WHERE ticket_id IS NULL ORDER BY media_id DESC LIMIT 500'));
}));
router.post('/:id/media/:mediaId/assign',asyncHandler(async(req,res)=>{
    const id=v.parseId(req.params.id,'phiếu'),mid=v.parseId(req.params.mediaId,'ảnh');
    if(req.body.confirmed!==true)throw new v.ValidationError('Cần xác nhận gán ảnh vào nhiệm vụ');
    const fid=v.isBlank(req.body.flight_session_id)?null:v.parseId(req.body.flight_session_id,'lượt bay');
    await withTransaction(async conn=>{
        const [tickets]=await conn.execute('SELECT ticket_id FROM inspection_tickets WHERE ticket_id=? FOR UPDATE',[id]);
        if(!tickets.length)throw new v.ValidationError('Không tìm thấy phiếu');
        const [medias]=await conn.execute('SELECT * FROM media_files WHERE media_id=? FOR UPDATE',[mid]);
        const m=medias[0];if(!m)throw new v.ValidationError('Không tìm thấy ảnh');
        if(m.ticket_id!=null&&m.ticket_id!==id)throw tasks.conflict('Ảnh đã thuộc phiếu khác; không tự chuyển phiếu');
        let flight=null;
        if(fid){const [flights]=await conn.execute('SELECT * FROM flight_sessions WHERE flight_session_id=? AND ticket_id=?',[fid,id]);flight=flights[0];
            if(!flight)throw new v.ValidationError('Lượt bay không thuộc phiếu');
            if(m.device_sn&&m.device_sn!=='UNKNOWN'&&m.device_sn!==flight.device_sn)throw tasks.conflict('Serial ảnh khác UAV của lượt bay');}
        await conn.execute("UPDATE media_files SET ticket_id=?,flight_session_id=COALESCE(?,flight_session_id),device_sn=IF(device_sn='UNKNOWN',?,device_sn),assignment_status='EXPLICIT' WHERE media_id=?",[id,fid,flight?.device_sn||m.device_sn,mid]);
        await conn.execute('UPDATE inspection_tickets SET reconciled_at=NULL,revision=revision+1 WHERE ticket_id=?',[id]);
        await conn.execute("INSERT INTO ticket_changes (ticket_id,revision,change_type,details_json) SELECT ticket_id,revision,'MEDIA_ASSIGNED',? FROM inspection_tickets WHERE ticket_id=?",[JSON.stringify({media_id:mid,flight_session_id:fid,actor:req.user?.user_id||null}),id]);
    });
    ok(res,{ticket_id:id,media_id:mid});
}));

// Assign operational context on Web; never sends flight/motion commands.
router.post('/:id/execution',asyncHandler(async(req,res)=>{
 const a=require('../services/authorization'),id=v.parseId(req.params.id,'phiếu');a.permission(req.user,'tasks:write');const ticket=await a.ticket(req.user,id);
 const sn=v.requiredString(req.body.device_sn,'UAV',64),rid=v.parseId(req.body.route_id,'tuyến');
 if(req.body.confirmed!==true)throw new v.ValidationError('Xác nhận tuyến đã chọn trên Pilot trước khi gắn phiên');
 const [route]=await query('SELECT r.* FROM flight_routes r JOIN ticket_routes tr ON tr.route_id=r.route_id WHERE tr.ticket_id=? AND r.route_id=?',[id,rid]);
 if(!route)throw new v.ValidationError('Tuyến không thuộc phiếu');
 if(!['PENDING','ASSIGNED','EXECUTING'].includes(ticket.status))throw tasks.conflict('Phiếu đã kết thúc');
 if(ticket.assigned_device_sn&&ticket.assigned_device_sn!==sn)throw tasks.conflict('UAV khác thiết bị được giao');
 const raw=typeof route.plan_json==='string'?JSON.parse(route.plan_json):route.plan_json;
 const points=raw?.plan?.points||raw?.plan?.waypoints||raw?.waypoints||raw?.geojson?.path?.coordinates?.map(p=>({lng:p[0],lat:p[1]}));
 if(!points?.length)throw new v.ValidationError('Tuyến cũ chưa có dữ liệu kiểm tra an toàn; tạo lại tuyến');
 await require('../services/safetyGeofence').validate(query,route.target_plant_id||ticket.plant_id,points);
 const file=require('../services/routeLibrary').kmzPath(route);
 const md5=require('crypto').createHash('md5').update(require('fs').readFileSync(file)).digest('hex');
 if(md5!==route.kmz_md5)throw tasks.conflict('File KMZ đã thay đổi; tạo lại tuyến trước khi giao');
 await withTransaction(async conn=>{
   await conn.execute('SELECT device_sn FROM uav_devices WHERE device_sn=? FOR UPDATE',[sn]);
   const [sessions]=await conn.execute('SELECT * FROM pilot_sessions WHERE aircraft_sn=? AND ended_at IS NULL ORDER BY session_id DESC LIMIT 1 FOR UPDATE',[sn]);
   const session=sessions[0];if(!session)throw tasks.conflict('UAV chưa kết nối qua Pilot');
   if(!a.allScopes(req.user)&&session.user_id!==req.user.user_id)throw a.denied();
   if(ticket.assigned_rc_sn&&ticket.assigned_rc_sn!==session.rc_sn)throw tasks.conflict('RC khác tay cầm được giao');
   const [flights]=await conn.execute('SELECT flight_session_id FROM flight_sessions WHERE device_sn=? AND ended_at IS NULL',[sn]);if(flights.length)throw tasks.conflict('Không thay phân công khi chuyến bay chưa đóng');
   const [active]=await conn.execute('SELECT execution_id FROM ticket_executions WHERE device_sn=? AND ended_at IS NULL',[sn]);if(active.length)throw tasks.conflict('Kết thúc phiên hiện tại trước khi chọn phiếu mới');
   await conn.execute("INSERT INTO ticket_executions (ticket_id,pilot_session_id,device_sn,route_id,route_md5,plan_snapshot,route_state,actor_user_id) VALUES (?,?,?,?,?,?,'MANUAL_CONFIRMED',?)",[id,session.session_id,sn,rid,md5,JSON.stringify(raw),req.user.user_id]);
   await conn.execute("UPDATE pilot_sessions SET ticket_id=?,ticket_bound_at=NOW(3),route_verification='MANUAL_CONFIRMED' WHERE session_id=?",[id,session.session_id]);
   await conn.execute("UPDATE inspection_tickets SET status='EXECUTING',assigned_device_sn=?,start_time=COALESCE(start_time,NOW()) WHERE ticket_id=?",[sn,id]);
 });ok(res,{ticket_id:id,route_state:'MANUAL_CONFIRMED'},'Đã gắn phiên theo xác nhận của người vận hành; không phải xác minh tự động từ Pilot');
}));
router.post('/:id/execution/mismatch',asyncHandler(async(req,res)=>{
 const id=v.parseId(req.params.id,'phiếu'),a=require('../services/authorization');a.permission(req.user,'tasks:write');await a.ticket(req.user,id);
 await withTransaction(async conn=>{await conn.execute("UPDATE pilot_sessions p JOIN ticket_executions e ON e.pilot_session_id=p.session_id SET p.route_verification='MISMATCH',e.route_state='MISMATCH' WHERE e.ticket_id=? AND e.ended_at IS NULL",[id]);});
 ok(res,{route_state:'MISMATCH'},'Đã khóa tự gán ảnh. Ảnh gốc tiếp tục lưu ở kho chưa gán; không gửi lệnh điều khiển UAV.');
}));
router.post('/:id/execution/stop',asyncHandler(async(req,res)=>{
 const id=v.parseId(req.params.id,'phiếu'),a=require('../services/authorization');a.permission(req.user,'tasks:write');await a.ticket(req.user,id);
 await withTransaction(async conn=>{const [es]=await conn.execute('SELECT * FROM ticket_executions WHERE ticket_id=? AND ended_at IS NULL FOR UPDATE',[id]);for(const e of es){const [flights]=await conn.execute('SELECT flight_session_id FROM flight_sessions WHERE device_sn=? AND ended_at IS NULL',[e.device_sn]);if(flights.length)throw tasks.conflict('Chờ hạ cánh và đóng chuyến bay trước khi kết thúc phân công');await conn.execute("UPDATE pilot_sessions SET ticket_id=NULL,ticket_bound_at=NULL,route_verification='UNKNOWN' WHERE session_id=?",[e.pilot_session_id]);}await conn.execute('UPDATE ticket_executions SET ended_at=NOW(3) WHERE ticket_id=? AND ended_at IS NULL',[id]);await conn.execute("UPDATE inspection_tickets SET status='ASSIGNED' WHERE ticket_id=? AND status='EXECUTING'",[id]);});ok(res,{stopped:true});
}));

// 3. Xem chi tiết phiếu kiểm tra và danh sách ảnh chụp
router.get('/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const tickets = await query('SELECT * FROM inspection_tickets WHERE ticket_id = ?', [ticketId]);
        if (!tickets || tickets.length === 0) {
            return res.status(404).json({ code: 404, message: 'Không tìm thấy phiếu kiểm tra' });
        }

        const ticket = { ...tickets[0], livestream_channel: channelForTicket(tickets[0]) };
        // Lấy danh sách ảnh thuộc phiếu này
        const photos = await query('SELECT * FROM media_files WHERE ticket_id = ? ORDER BY captured_at DESC', [ticketId]);
        // Lấy danh sách phát hiện khiếm khuyết AI
        const defects = await query(`
            SELECT d.*, m.file_name, m.file_url 
            FROM ai_defect_detections d
            JOIN media_files m ON d.media_id = m.media_id
            WHERE d.ticket_id = ?
        `, [ticketId]);

        const routes = await ticketRoutes.routesOfTicket(ticket.ticket_id);
        const scope = await query(`SELECT td.*,COALESCE(a.area_name,s.string_name,p.panel_serial,b.bay_name,d.dcl_name,c.contact_name,c.contact_code) AS label
            FROM ticket_details td LEFT JOIN solar_areas a ON td.area_id=a.area_id LEFT JOIN solar_strings s ON td.string_id=s.string_id
            LEFT JOIN solar_panels p ON td.panel_id=p.panel_id LEFT JOIN substation_bays b ON td.bay_id=b.bay_id
            LEFT JOIN disconnectors d ON td.disconnector_id=d.disconnector_id LEFT JOIN dcl_contacts c ON td.contact_id=c.contact_id
            WHERE td.ticket_id=?`,[ticket.ticket_id]);
        const crew = await query('SELECT u.user_id,u.username,u.full_name FROM ticket_members m JOIN users u ON m.user_id=u.user_id WHERE m.ticket_id=?',[ticket.ticket_id]);
        const progress = await tasks.summary(ticket.ticket_id);

        res.json({
            code: 0,
            data: {
                ticket,
                scope, crew, progress,
                routes,
                photos,
                defects
            }
        });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 4. Cập nhật trạng thái phiếu kiểm tra (Bắt đầu, Hoàn thành...)
router.patch('/:id/status', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { status } = req.body;
        if (!['PENDING', 'ASSIGNED', 'EXECUTING', 'COMPLETED', 'CANCELLED'].includes(status)) {
            return res.status(400).json({ code: 400, message: 'Trạng thái không hợp lệ' });
        }

        const progress = await tasks.summary(v.parseId(ticketId,'phiếu'));
        if(status==='COMPLETED' && !progress.can_complete) return res.status(409).json({code:409,message:'Chưa thể hoàn tất: cần đóng chuyến bay, đối soát đủ ảnh gốc và kết quả Vision nếu bắt buộc.',data:progress});
        let timeFieldUpdate = '';
        if (status === 'EXECUTING') {
            timeFieldUpdate = ', start_time = IFNULL(start_time, NOW())';
        } else if (status === 'COMPLETED') {
            timeFieldUpdate = ', end_time = NOW()';
        }

        await query(`UPDATE inspection_tickets SET status = ? ${timeFieldUpdate} WHERE ticket_id = ?`, [status, ticketId]);
        res.json({ code: 0, message: 'Cập nhật trạng thái thành công' });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 5. Đặt danh sách đường bay của phiếu (theo thứ tự): { route_ids: [..] }
router.put('/:id/routes', asyncHandler(async (req,res)=>{
    const id=v.parseId(req.params.id,'phiếu');
    const [ticket]=await query('SELECT revision FROM inspection_tickets WHERE ticket_id=?',[id]);
    if(!ticket)throw new v.ValidationError('Không tìm thấy phiếu');
    await tasks.saveTask({revision:ticket.revision,route_ids:req.body.route_ids},id);
    ok(res,{route_ids:(await ticketRoutes.routesOfTicket(id)).map(r=>r.route_id)});
}));

module.exports = router;
