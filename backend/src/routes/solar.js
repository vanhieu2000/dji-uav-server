/**
 * API tài sản điện mặt trời: nhà máy -> khu vực -> chuỗi pin -> tấm pin.
 */
const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const { pickFields, updateById, deleteById } = require('../utils/sql');
const v = require('../utils/validate');
const { polygonCenter, interpolatePanels } = require('../utils/geo');
const { deleteOrphanPhotoPoints } = require('../services/photoPoints');

const PANEL_STATUSES = ['NORMAL', 'DEFECT', 'WARNING', 'OFFLINE'];
const MAX_PANELS_PER_REQUEST = 5000;
const MAX_PANELS_PER_STRING = 500;

async function getDefaultPlantId() {
    const rows = await query('SELECT plant_id FROM plants ORDER BY plant_id ASC LIMIT 1');
    if (!rows.length) throw new v.ValidationError('Chưa có nhà máy nào. Hãy tạo nhà máy trước.');
    return rows[0].plant_id;
}

function clampLimit(value, def, max) {
    const n = parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) return def;
    return Math.min(n, max);
}

/* ---------------------------- NHÀ MÁY ---------------------------- */

const plantParsers = {
    plant_code: x => v.requiredString(x, 'mã nhà máy', 50),
    plant_name: x => v.requiredString(x, 'tên nhà máy', 150),
    capacity_mwp: x => v.optionalNumber(x, 'công suất (MWp)', { min: 0 }),
    center_lat: x => v.optionalLat(x),
    center_lng: x => v.optionalLng(x),
    address: x => v.optionalString(x, 'địa chỉ', 255),
    boundary_geojson: x => v.optionalPolygonGeoJson(x, 'ranh giới nhà máy')
};

router.get('/plants', asyncHandler(async (req, res) => {
    ok(res, await query('SELECT * FROM plants ORDER BY plant_id ASC'));
}));

router.post('/plants', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, plantParsers);
    plantParsers.plant_code(f.plant_code);
    plantParsers.plant_name(f.plant_name);
    const cols = Object.keys(f);
    const result = await query(
        `INSERT INTO plants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => f[c])
    );
    ok(res, { plant_id: result.insertId }, 'Đã tạo nhà máy');
}));

router.put('/plants/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã nhà máy');
    await updateById(query, 'plants', 'plant_id', id, pickFields(req.body, plantParsers));
    ok(res, { plant_id: id }, 'Đã cập nhật nhà máy');
}));

/* ---------------------------- KHU VỰC ---------------------------- */

const AREA_SELECT = `
    SELECT a.*,
        (SELECT COUNT(*) FROM solar_strings s WHERE s.area_id = a.area_id) AS string_count,
        (SELECT COUNT(*) FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id
            WHERE s.area_id = a.area_id) AS panel_count,
        (SELECT COUNT(*) FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id
            WHERE s.area_id = a.area_id AND p.status IN ('DEFECT', 'WARNING')) AS abnormal_count
    FROM solar_areas a
`;

const areaParsers = {
    area_code: x => v.requiredString(x, 'mã khu vực', 50),
    area_name: x => v.requiredString(x, 'tên khu vực', 150),
    center_lat: x => v.optionalLat(x),
    center_lng: x => v.optionalLng(x),
    polygon_geojson: x => v.optionalPolygonGeoJson(x, 'ranh giới khu vực'),
    total_capacity_kwp: x => v.optionalNumber(x, 'công suất (kWp)', { min: 0 })
};

/** Khi có đa giác mà chưa có tâm: tự tính tâm từ đa giác. */
function fillAreaCenter(f) {
    if (f.polygon_geojson && (f.center_lat == null || f.center_lng == null)) {
        const c = polygonCenter(f.polygon_geojson);
        if (c) {
            f.center_lat = f.center_lat ?? c.lat;
            f.center_lng = f.center_lng ?? c.lng;
        }
    }
    return f;
}

router.get('/areas', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `${AREA_SELECT} WHERE 1=1`;
    if (req.query.plant_id) {
        sql += ' AND a.plant_id = ?';
        params.push(v.parseId(req.query.plant_id, 'plant_id'));
    }
    if (req.query.q) {
        sql += ' AND (a.area_code LIKE ? OR a.area_name LIKE ?)';
        params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    sql += ' ORDER BY a.area_code ASC';
    ok(res, await query(sql, params));
}));

router.get('/areas/:id', asyncHandler(async (req, res) => {
    const rows = await query(`${AREA_SELECT} WHERE a.area_id = ?`, [v.parseId(req.params.id)]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy khu vực');
    ok(res, rows[0]);
}));

router.post('/areas', asyncHandler(async (req, res) => {
    const f = fillAreaCenter(pickFields(req.body, areaParsers));
    areaParsers.area_code(f.area_code);
    areaParsers.area_name(f.area_name);
    const plantId = req.body.plant_id ? v.parseId(req.body.plant_id, 'plant_id') : await getDefaultPlantId();
    const cols = ['plant_id', ...Object.keys(f)];
    const vals = [plantId, ...Object.keys(f).map(c => f[c])];
    const result = await query(
        `INSERT INTO solar_areas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        vals
    );
    ok(res, { area_id: result.insertId }, 'Đã thêm khu vực pin');
}));

router.put('/areas/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã khu vực');
    const f = fillAreaCenter(pickFields(req.body, areaParsers));
    await updateById(query, 'solar_areas', 'area_id', id, f);
    ok(res, { area_id: id }, 'Đã cập nhật khu vực pin');
}));

router.delete('/areas/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'solar_areas', 'area_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa khu vực pin (kèm chuỗi và tấm pin bên trong)');
}));

/* ---------------------------- CHUỖI PIN ---------------------------- */

const stringParsers = {
    area_id: x => v.parseId(x, 'khu vực'),
    string_code: x => v.requiredString(x, 'mã chuỗi', 50),
    string_name: x => v.optionalString(x, 'tên chuỗi', 100),
    inverter_channel: x => v.optionalString(x, 'kênh inverter', 50),
    panel_count: x => v.optionalInt(x, 'số tấm pin', { min: 0, max: MAX_PANELS_PER_STRING }) ?? 0,
    rated_power_w: x => v.optionalNumber(x, 'công suất (W)', { min: 0 }),
    line_geojson: x => v.optionalLineGeoJson(x)
};

router.get('/strings', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `
        SELECT s.*, a.area_name, a.area_code,
            (SELECT COUNT(*) FROM solar_panels p WHERE p.string_id = s.string_id) AS actual_panel_count
        FROM solar_strings s
        JOIN solar_areas a ON s.area_id = a.area_id
        WHERE 1=1`;
    if (req.query.area_id) {
        sql += ' AND s.area_id = ?';
        params.push(v.parseId(req.query.area_id, 'area_id'));
    }
    if (req.query.q) {
        sql += ' AND (s.string_code LIKE ? OR s.string_name LIKE ?)';
        params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    sql += ' ORDER BY a.area_code ASC, s.string_code ASC';
    ok(res, await query(sql, params));
}));

router.post('/strings', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, stringParsers);
    stringParsers.area_id(f.area_id);
    stringParsers.string_code(f.string_code);
    const cols = Object.keys(f);
    const result = await query(
        `INSERT INTO solar_strings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => f[c])
    );
    ok(res, { string_id: result.insertId }, 'Đã thêm chuỗi pin');
}));

router.put('/strings/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã chuỗi');
    await updateById(query, 'solar_strings', 'string_id', id, pickFields(req.body, stringParsers));
    ok(res, { string_id: id }, 'Đã cập nhật chuỗi pin');
}));

router.delete('/strings/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'solar_strings', 'string_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa chuỗi pin (kèm các tấm pin)');
}));

/**
 * Tự sinh vị trí tấm pin: chia đều từ điểm đầu tới điểm cuối chuỗi.
 * body: { start_lat, start_lng, end_lat, end_lng, count, serial_prefix?, replace? }
 * replace=true (mặc định): xóa tấm pin cũ của chuỗi rồi tạo lại.
 */
router.post('/strings/:id/generate-panels', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã chuỗi');
    const b = req.body || {};
    const start = { lat: v.requiredNumber(b.start_lat, 'vĩ độ điểm đầu', { min: -90, max: 90 }), lng: v.requiredNumber(b.start_lng, 'kinh độ điểm đầu', { min: -180, max: 180 }) };
    const end = { lat: v.requiredNumber(b.end_lat, 'vĩ độ điểm cuối', { min: -90, max: 90 }), lng: v.requiredNumber(b.end_lng, 'kinh độ điểm cuối', { min: -180, max: 180 }) };
    const count = v.requiredInt(b.count, 'số tấm pin', { min: 1, max: MAX_PANELS_PER_STRING });
    const replace = b.replace !== false && b.replace !== 'false';

    const strings = await query(
        'SELECT s.string_code, a.area_code FROM solar_strings s JOIN solar_areas a ON s.area_id = a.area_id WHERE s.string_id = ?',
        [id]
    );
    if (!strings.length) throw new NotFoundError('Không tìm thấy chuỗi pin');
    const prefix = v.optionalString(b.serial_prefix, 'tiền tố mã tấm', 80) || `${strings[0].area_code}-${strings[0].string_code}`;
    const panels = interpolatePanels(start, end, count);
    const line = JSON.stringify({ type: 'LineString', coordinates: [[start.lng, start.lat], [end.lng, end.lat]] });

    await withTransaction(async (conn) => {
        if (replace) {
            await conn.execute('DELETE FROM solar_panels WHERE string_id = ?', [id]);
        }
        // Chèn theo lô để nhanh với chuỗi nhiều tấm
        const values = [];
        const rowsSql = panels.map(p => {
            values.push(id, `${prefix}-${String(p.index).padStart(3, '0')}`, p.index, p.lat, p.lng);
            return '(?, ?, ?, ?, ?)';
        });
        await conn.execute(
            `INSERT INTO solar_panels (string_id, panel_serial, panel_index, latitude, longitude) VALUES ${rowsSql.join(', ')}`,
            values
        );
        await conn.execute('UPDATE solar_strings SET panel_count = ?, line_geojson = ? WHERE string_id = ?', [count, line, id]);
    });
    if (replace) await deleteOrphanPhotoPoints(); // tấm cũ đã bị thay

    ok(res, { string_id: id, created: count }, `Đã tạo ${count} tấm pin`);
}));

/* ---------------------------- TẤM PIN ---------------------------- */

const panelParsers = {
    string_id: x => v.parseId(x, 'chuỗi pin'),
    panel_serial: x => v.optionalString(x, 'mã tấm pin', 100),
    panel_index: x => v.requiredInt(x, 'số thứ tự tấm', { min: 1, max: 100000 }),
    latitude: x => v.optionalLat(x),
    longitude: x => v.optionalLng(x),
    altitude: x => v.optionalNumber(x, 'độ cao'),
    status: x => v.oneOf(x, PANEL_STATUSES, 'trạng thái', 'NORMAL')
};

/**
 * Lọc: string_id, area_id, status, serial, bbox=nam,tây,bắc,đông.
 * Trả thêm "truncated" khi số tấm vượt giới hạn (bản đồ cần phóng to thêm).
 */
router.get('/panels', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.query.limit, 500, MAX_PANELS_PER_REQUEST);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const params = [];
    let sql = `
        SELECT p.*, s.string_code, a.area_id, a.area_code, a.area_name
        FROM solar_panels p
        JOIN solar_strings s ON p.string_id = s.string_id
        JOIN solar_areas a ON s.area_id = a.area_id
        WHERE 1=1`;
    if (req.query.string_id) { sql += ' AND p.string_id = ?'; params.push(v.parseId(req.query.string_id, 'string_id')); }
    if (req.query.area_id) { sql += ' AND s.area_id = ?'; params.push(v.parseId(req.query.area_id, 'area_id')); }
    if (req.query.status) { sql += ' AND p.status = ?'; params.push(v.oneOf(req.query.status, PANEL_STATUSES, 'trạng thái')); }
    if (req.query.serial) { sql += ' AND p.panel_serial LIKE ?'; params.push(`%${req.query.serial}%`); }
    const bbox = v.optionalBbox(req.query.bbox);
    if (bbox) {
        sql += ' AND p.latitude BETWEEN ? AND ? AND p.longitude BETWEEN ? AND ?';
        params.push(bbox.south, bbox.north, bbox.west, bbox.east);
    }
    // Lấy dư 1 dòng để biết có bị cắt bớt không
    sql += ` ORDER BY s.string_code ASC, p.panel_index ASC LIMIT ${limit + 1} OFFSET ${offset}`;
    const rows = await query(sql, params);
    const truncated = rows.length > limit;
    res.json({ code: 0, data: truncated ? rows.slice(0, limit) : rows, truncated });
}));

router.post('/panels', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, panelParsers);
    panelParsers.string_id(f.string_id);
    panelParsers.panel_index(f.panel_index);
    const cols = Object.keys(f);
    const result = await query(
        `INSERT INTO solar_panels (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => f[c])
    );
    ok(res, { panel_id: result.insertId }, 'Đã thêm tấm pin');
}));

router.put('/panels/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã tấm pin');
    await updateById(query, 'solar_panels', 'panel_id', id, pickFields(req.body, panelParsers));
    ok(res, { panel_id: id }, 'Đã cập nhật tấm pin');
}));

router.delete('/panels/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'solar_panels', 'panel_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa tấm pin');
}));

module.exports = router;
module.exports.getDefaultPlantId = getDefaultPlantId;
