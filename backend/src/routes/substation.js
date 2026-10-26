const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

// 1. Lấy danh sách trạm biến áp
router.get('/', async (req, res) => {
    try {
        const rows = await query('SELECT * FROM substations ORDER BY substation_id ASC');
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 2. Lấy danh sách ngăn lộ (Bays)
router.get('/bays', async (req, res) => {
    try {
        const { substation_id } = req.query;
        let sql = 'SELECT * FROM substation_bays WHERE 1=1';
        const params = [];
        if (substation_id) {
            sql += ' AND substation_id = ?';
            params.push(substation_id);
        }
        sql += ' ORDER BY bay_id ASC';
        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 3. Tìm kiếm và lấy danh sách Dao cách ly (Disconnectors)
router.get('/disconnectors', async (req, res) => {
    try {
        const { bay_id, q, state } = req.query;
        let sql = `
            SELECT d.*, b.bay_code, b.bay_name, s.substation_name 
            FROM disconnectors d
            JOIN substation_bays b ON d.bay_id = b.bay_id
            JOIN substations s ON b.substation_id = s.substation_id
            WHERE 1=1
        `;
        const params = [];
        if (bay_id) {
            sql += ' AND d.bay_id = ?';
            params.push(bay_id);
        }
        if (state) {
            sql += ' AND d.state = ?';
            params.push(state);
        }
        if (q) {
            sql += ' AND (d.dcl_code LIKE ? OR d.dcl_name LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        }
        sql += ' ORDER BY d.disconnector_id ASC';
        const rows = await query(sql, params);
        res.json({ code: 0, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 4. Thêm / sửa dao cách ly
router.post('/disconnectors', async (req, res) => {
    try {
        const { bay_id, dcl_code, phase = '3PHASE', dcl_name, latitude, longitude, altitude, state = 'CLOSED', max_allowed_temp = 70.0 } = req.body;
        if (!bay_id || !dcl_code) {
            return res.status(400).json({ code: 400, message: 'Vui lòng cung cấp bay_id và mã DCL' });
        }
        const result = await query(
            `INSERT INTO disconnectors (bay_id, dcl_code, phase, dcl_name, latitude, longitude, altitude, state, max_allowed_temp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
                dcl_name = VALUES(dcl_name), 
                latitude = VALUES(latitude), 
                longitude = VALUES(longitude), 
                state = VALUES(state), 
                max_allowed_temp = VALUES(max_allowed_temp)`,
            [bay_id, dcl_code, phase, dcl_name || `${dcl_code} Pha ${phase}`, latitude || null, longitude || null, altitude || null, state, max_allowed_temp]
        );
        res.json({ code: 0, message: 'Lưu thông tin dao cách ly thành công', data: { disconnector_id: result.insertId } });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 5. Cập nhật dao cách ly
router.put('/disconnectors/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { dcl_name, phase, latitude, longitude, max_allowed_temp } = req.body;
        await query(
            `UPDATE disconnectors SET dcl_name = ?, phase = ?, latitude = ?, longitude = ?, max_allowed_temp = ? WHERE dcl_id = ? OR dcl_code = ?`,
            [dcl_name, phase, latitude, longitude, max_allowed_temp, id, id]
        );
        res.json({ code: 0, message: 'Cập nhật dao cách ly thành công' });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

// 6. Xóa dao cách ly
router.delete('/disconnectors/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await query(`DELETE FROM disconnectors WHERE dcl_id = ? OR dcl_code = ?`, [id, id]);
        res.json({ code: 0, message: 'Đã xóa dao cách ly thành công' });
    } catch (err) {
        res.status(500).json({ code: 500, message: err.message });
    }
});

module.exports = router;

