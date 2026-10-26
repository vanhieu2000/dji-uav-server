const express = require('express');
const router = express.Router();
const { query, sendDbError } = require('../config/db');

// 1. Lấy danh sách kết quả AI phát hiện lỗi
router.get('/detections', async (req, res) => {
    try {
        const { type, ticket_id, min_confidence } = req.query;
        let sql = `
            SELECT d.*, m.file_name, m.file_url, m.latitude, m.longitude, t.ticket_code
            FROM ai_defect_detections d
            JOIN media_files m ON d.media_id = m.media_id
            LEFT JOIN inspection_tickets t ON d.ticket_id = t.ticket_id
            WHERE 1=1
        `;
        const params = [];
        if (type) {
            sql += ' AND d.defect_type = ?';
            params.push(type);
        }
        if (ticket_id) {
            sql += ' AND d.ticket_id = ?';
            params.push(ticket_id);
        }
        if (min_confidence) {
            sql += ' AND d.confidence >= ?';
            params.push(parseFloat(min_confidence));
        }
        sql += ' ORDER BY d.detection_id DESC LIMIT 100';

        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        sendDbError(res, err);
    }
});

// 2. Webhook/Endpoint dành cho AI Team (Đội Vision) đẩy kết quả phân tích
router.post('/webhook/vision-result', (req, res) => {
    res.status(410).json({ code: 410, message: 'Webhook v1 đã thay bằng POST /api/vision/results (contract 2.0, xác thực, job_id và result_version).' });
});

// 3. Lấy danh sách cảnh báo (Defect Alerts)
router.get('/alerts', async (req, res) => {
    try {
        const { status = 'UNREAD', level } = req.query;
        let sql = `
            SELECT a.*, d.defect_type, d.confidence, d.max_temperature, m.file_url 
            FROM defect_alerts a
            JOIN ai_defect_detections d ON a.detection_id = d.detection_id
            JOIN media_files m ON d.media_id = m.media_id
            WHERE 1=1
        `;
        const params = [];
        if (status && status !== 'ALL') {
            sql += ' AND a.status = ?';
            params.push(status);
        }
        if (level) {
            sql += ' AND a.alert_level = ?';
            params.push(level);
        }
        sql += ' ORDER BY a.alert_id DESC LIMIT 50';

        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        sendDbError(res, err);
    }
});

module.exports = router;
