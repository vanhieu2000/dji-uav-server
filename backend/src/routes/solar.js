const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

// 1. Lấy danh sách các nhà máy điện mặt trời
router.get('/plants', async (req, res) => {
    try {
        const rows = await query('SELECT * FROM plants ORDER BY plant_id ASC');
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 2. Lấy danh sách khu vực pin (Inverter Zones) kèm thông tin chuỗi
router.get('/areas', async (req, res) => {
    try {
        const { plant_id, q } = req.query;
        let sql = 'SELECT * FROM solar_areas WHERE 1=1';
        const params = [];
        if (plant_id) {
            sql += ' AND plant_id = ?';
            params.push(plant_id);
        }
        if (q) {
            sql += ' AND (area_code LIKE ? OR area_name LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        }
        sql += ' ORDER BY area_id ASC';
        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 3. Lấy danh sách chuỗi pin (Strings) theo khu vực
router.get('/strings', async (req, res) => {
    try {
        const { area_id, q } = req.query;
        let sql = `
            SELECT s.*, a.area_name, a.area_code 
            FROM solar_strings s 
            JOIN solar_areas a ON s.area_id = a.area_id 
            WHERE 1=1
        `;
        const params = [];
        if (area_id) {
            sql += ' AND s.area_id = ?';
            params.push(area_id);
        }
        if (q) {
            sql += ' AND (s.string_code LIKE ? OR s.string_name LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        }
        sql += ' ORDER BY s.string_id ASC';
        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 4. Tìm kiếm và lấy danh sách tấm pin (Panels)
router.get('/panels', async (req, res) => {
    try {
        const { string_id, status, serial, limit = 500, offset = 0 } = req.query;
        let sql = `
            SELECT p.*, s.string_code, a.area_code, a.area_name 
            FROM solar_panels p
            JOIN solar_strings s ON p.string_id = s.string_id
            JOIN solar_areas a ON s.area_id = a.area_id
            WHERE 1=1
        `;
        const params = [];
        if (string_id) {
            sql += ' AND p.string_id = ?';
            params.push(string_id);
        }
        if (status) {
            sql += ' AND p.status = ?';
            params.push(status);
        }
        if (serial) {
            sql += ' AND p.panel_serial LIKE ?';
            params.push(`%${serial}%`);
        }
        sql += ' ORDER BY p.panel_id ASC LIMIT ? OFFSET ?';
        params.push(parseInt(limit, 10), parseInt(offset, 10));

        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 5. Thêm/sửa khu vực pin (Cho giao diện cài đặt)
router.post('/areas', async (req, res) => {
    try {
        const { plant_id = 1, area_code, area_name, center_lat, center_lng, total_capacity_kwp } = req.body;
        if (!area_code || !area_name) {
            return res.status(400).json({ code: 400, message: 'Vui lòng điền mã và tên khu vực' });
        }
        const result = await query(
            `INSERT INTO solar_areas (plant_id, area_code, area_name, center_lat, center_lng, total_capacity_kwp)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE area_name = VALUES(area_name), center_lat = VALUES(center_lat), center_lng = VALUES(center_lng), total_capacity_kwp = VALUES(total_capacity_kwp)`,
            [plant_id, area_code, area_name, center_lat || null, center_lng || null, total_capacity_kwp || null]
        );
        res.json({ code: 0, message: 'Lưu khu vực pin thành công', data: { area_id: result.insertId } });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 6. Thêm/sửa chuỗi pin
router.post('/strings', async (req, res) => {
    try {
        const { area_id, string_code, string_name, inverter_channel, panel_count = 24, rated_power_w } = req.body;
        if (!area_id || !string_code) {
            return res.status(400).json({ code: 400, message: 'Vui lòng cung cấp area_id và mã chuỗi' });
        }
        const result = await query(
            `INSERT INTO solar_strings (area_id, string_code, string_name, inverter_channel, panel_count, rated_power_w)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE string_name = VALUES(string_name), inverter_channel = VALUES(inverter_channel), panel_count = VALUES(panel_count), rated_power_w = VALUES(rated_power_w)`,
            [area_id, string_code, string_name || null, inverter_channel || null, panel_count, rated_power_w || null]
        );
        res.json({ code: 0, message: 'Lưu chuỗi pin thành công', data: { string_id: result.insertId } });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 7. Thêm/sửa tấm pin
router.post('/panels', async (req, res) => {
    try {
        const { string_id, panel_serial, panel_index, latitude, longitude, altitude } = req.body;
        if (!string_id || panel_index === undefined) {
            return res.status(400).json({ code: 400, message: 'Vui lòng cung cấp string_id và số thứ tự tấm pin' });
        }
        const result = await query(
            `INSERT INTO solar_panels (string_id, panel_serial, panel_index, latitude, longitude, altitude)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [string_id, panel_serial || null, panel_index, latitude || null, longitude || null, altitude || null]
        );
        res.json({ code: 0, message: 'Thêm tấm pin thành công', data: { panel_id: result.insertId } });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 8. Cập nhật khu vực pin
router.put('/areas/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { area_name, center_lat, center_lng, total_capacity_kwp } = req.body;
        await query(
            `UPDATE solar_areas SET area_name = ?, center_lat = ?, center_lng = ?, total_capacity_kwp = ? WHERE area_id = ? OR area_code = ?`,
            [area_name, center_lat, center_lng, total_capacity_kwp, id, id]
        );
        res.json({ code: 0, message: 'Cập nhật khu vực pin thành công' });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 9. Xóa khu vực pin
router.delete('/areas/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await query(`DELETE FROM solar_areas WHERE area_id = ? OR area_code = ?`, [id, id]);
        res.json({ code: 0, message: 'Đã xóa khu vực pin thành công' });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

module.exports = router;

