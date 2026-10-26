const express = require('express');
const router = express.Router();
const { query, sendDbError } = require('../config/db');

// 1. Thống kê tổng quan Dashboard (Overview KPI)
router.get('/overview', async (req, res) => {
    try {
        const [panelCount] = await query('SELECT COUNT(*) as total FROM solar_panels');
        const [dclCount] = await query('SELECT COUNT(*) as total FROM disconnectors');
        const [heat] = await query('SELECT SUM(last_inspected_temp >= max_allowed_temp) AS exceeded, MAX(last_inspected_temp) AS max_temp FROM disconnectors');
        const [ticketCount] = await query('SELECT COUNT(*) as total, SUM(CASE WHEN status="COMPLETED" THEN 1 ELSE 0 END) as completed FROM inspection_tickets');
        const [defectCount] = await query('SELECT COUNT(*) as total FROM ai_defect_detections');
        const [alertCount] = await query('SELECT COUNT(*) as total FROM defect_alerts WHERE status="UNREAD"');
        const [onlineDroneCount] = await query('SELECT COUNT(*) as total FROM uav_devices WHERE status != "OFFLINE"');

        res.json({
            code: 0,
            data: {
                overheated_disconnectors: Number(heat?.exceeded) || 0,
                max_disconnector_temperature: heat?.max_temp ?? null,
                total_panels: panelCount?.total || 0,
                total_disconnectors: dclCount?.total || 0,
                total_tickets: ticketCount?.total || 0,
                completed_tickets: ticketCount?.completed || 0,
                total_defects_found: defectCount?.total || 0,
                unread_alerts: alertCount?.total || 0,
                online_devices: onlineDroneCount?.total || 0
            }
        });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 2. Thống kê phân loại khiếm khuyết (Defect Distribution)
router.get('/defects-by-type', async (req, res) => {
    try {
        const rows = await query(`
            SELECT defect_type, COUNT(*) as count 
            FROM ai_defect_detections 
            GROUP BY defect_type
        `);
        res.json({ code: 0, data: rows });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 3. Lấy dữ liệu báo cáo chi tiết theo phiếu kiểm tra
router.get('/ticket/:id', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const [ticket] = await query(`
            SELECT t.*, u.full_name as inspector_name, r.route_name 
            FROM inspection_tickets t
            LEFT JOIN users u ON t.inspector_id = u.user_id
            LEFT JOIN flight_routes r ON t.assigned_route_id = r.route_id
            WHERE t.ticket_id = ?
        `, [ticketId]);

        if (!ticket) {
            return res.status(404).json({ code: 404, message: 'Không tìm thấy phiếu kiểm tra' });
        }

        const defects = await query(`
            SELECT d.*, m.file_name, m.file_url, m.latitude, m.longitude
            FROM ai_defect_detections d
            JOIN media_files m ON d.media_id = m.media_id
            WHERE d.ticket_id = ?
        `, [ticketId]);

        const totalPhotos = await query('SELECT COUNT(*) as count FROM media_files WHERE ticket_id = ?', [ticketId]);

        res.json({
            code: 0,
            data: {
                ticket_info: ticket,
                total_photos: totalPhotos[0]?.count || 0,
                total_defects: defects.length,
                defect_items: defects,
                generated_at: new Date()
            }
        });
    } catch (err) {
        sendDbError(res, err);
    }
});

module.exports = router;
