const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

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
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 2. Webhook/Endpoint dành cho AI Team (Đội Vision) đẩy kết quả phân tích
router.post('/webhook/vision-result', async (req, res) => {
    try {
        const { media_id, ticket_id, detections } = req.body;
        // detections là mảng: [{ defect_type, confidence, bounding_box, max_temperature, delta_temp, crop_image_url }]
        if (!media_id || !Array.isArray(detections)) {
            return res.status(400).json({ code: 400, message: 'Dữ liệu không đúng định dạng. Cần media_id và danh sách detections' });
        }

        const insertedIds = [];
        for (const det of detections) {
            const result = await query(
                `INSERT INTO ai_defect_detections 
                 (media_id, ticket_id, defect_type, confidence, bounding_box_json, max_temperature, delta_temperature, crop_image_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    media_id,
                    ticket_id || null,
                    det.defect_type || 'OTHER',
                    det.confidence || 0.0,
                    det.bounding_box ? JSON.stringify(det.bounding_box) : null,
                    det.max_temperature || null,
                    det.delta_temp || null,
                    det.crop_image_url || null
                ]
            );
            insertedIds.push(result.insertId);

            // Tự động tạo Defect Alert nếu lỗi nghiêm trọng hoặc nhiệt độ vượt ngưỡng
            const isHighTemp = det.max_temperature && det.max_temperature >= 65.0;
            const alertLevel = isHighTemp ? 'CRITICAL' : 'WARNING';
            const alertTitle = `Phát hiện ${det.defect_type === 'HOTSPOT_PANEL' ? 'Điểm Phát Nhiệt Pin' : (det.defect_type === 'DISCONNECTOR_OVERHEAT' ? 'Quá Nhiệt Dao Cách Ly' : 'Khiếm Khuyết Bất Thường')}`;
            const alertMsg = `AI phát hiện lỗi ${det.defect_type} với độ tin cậy ${(det.confidence * 100).toFixed(1)}%. Nhiệt độ ghi nhận: ${det.max_temperature || 'N/A'}°C`;

            await query(
                `INSERT INTO defect_alerts (detection_id, ticket_id, alert_level, title, message)
                 VALUES (?, ?, ?, ?, ?)`,
                [result.insertId, ticket_id || null, alertLevel, alertTitle, alertMsg]
            );
        }

        // Cập nhật trạng thái has_hotspot trong media_files
        await query('UPDATE media_files SET has_hotspot = 1 WHERE media_id = ?', [media_id]);

        res.json({
            code: 0,
            message: `Tiếp nhận thành công ${insertedIds.length} khiếm khuyết từ AI Vision Team`,
            data: { inserted_ids: insertedIds }
        });
    } catch (err) {
        console.error('[AI Bridge Error]', err);
        res.status(500).json({ code: 500, message: err.message });
    }
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
        res.status(500).json({ code: 500, message: err.message });
    }
});

module.exports = router;
