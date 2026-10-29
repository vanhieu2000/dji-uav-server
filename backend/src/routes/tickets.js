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
