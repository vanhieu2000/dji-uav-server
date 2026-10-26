const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

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
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 2. Tạo phiếu kiểm tra mới
router.post('/', async (req, res) => {
    try {
        const { ticket_name, inspection_type, target_facility, assigned_route_id, assigned_device_sn, inspector_id, notes } = req.body;
        if (!ticket_name || !inspection_type || !target_facility) {
            return res.status(400).json({ code: 400, message: 'Vui lòng điền đủ tiêu đề, loại kiểm tra và khu vực thực hiện' });
        }

        // Tạo mã phiếu tự động
        const prefix = inspection_type === 'SOLAR_PANEL' ? 'PKT-PIN' : (inspection_type === 'DISCONNECTOR' ? 'PKT-DCL' : 'PKT-GEN');
        const timestamp = Date.now().toString().slice(-6);
        const ticket_code = `${prefix}-${new Date().getFullYear()}-${timestamp}`;

        const result = await query(
            `INSERT INTO inspection_tickets 
             (ticket_code, ticket_name, inspection_type, target_facility, assigned_route_id, assigned_device_sn, inspector_id, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
            [ticket_code, ticket_name, inspection_type, target_facility, assigned_route_id || null, assigned_device_sn || null, inspector_id || null, notes || null]
        );

        res.json({
            code: 0,
            message: 'Tạo phiếu kiểm tra thành công',
            data: { ticket_id: result.insertId, ticket_code }
        });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 3. Xem chi tiết phiếu kiểm tra và danh sách ảnh chụp
router.get('/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const tickets = await query('SELECT * FROM inspection_tickets WHERE ticket_id = ?', [ticketId]);
        if (!tickets || tickets.length === 0) {
            return res.status(404).json({ code: 404, message: 'Không tìm thấy phiếu kiểm tra' });
        }

        const ticket = tickets[0];
        // Lấy danh sách ảnh thuộc phiếu này
        const photos = await query('SELECT * FROM media_files WHERE ticket_id = ? ORDER BY captured_at DESC', [ticketId]);
        // Lấy danh sách phát hiện khiếm khuyết AI
        const defects = await query(`
            SELECT d.*, m.file_name, m.file_url 
            FROM ai_defect_detections d
            JOIN media_files m ON d.media_id = m.media_id
            WHERE d.ticket_id = ?
        `, [ticketId]);

        res.json({
            code: 0,
            data: {
                ticket,
                photos,
                defects
            }
        });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
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

        let timeFieldUpdate = '';
        if (status === 'EXECUTING') {
            timeFieldUpdate = ', start_time = IFNULL(start_time, NOW())';
        } else if (status === 'COMPLETED') {
            timeFieldUpdate = ', end_time = NOW()';
        }

        await query(`UPDATE inspection_tickets SET status = ? ${timeFieldUpdate} WHERE ticket_id = ?`, [status, ticketId]);
        res.json({ code: 0, message: 'Cập nhật trạng thái thành công' });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

module.exports = router;
