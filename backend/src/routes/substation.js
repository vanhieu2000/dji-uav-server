/**
 * API tài sản trạm biến áp: trạm -> ngăn lộ -> dao cách ly -> mối nối.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok } = require('../utils/http');
const { pickFields, updateById, deleteById } = require('../utils/sql');
const v = require('../utils/validate');
const { getDefaultPlantId } = require('./solar');

const PHASES = ['A', 'B', 'C', '3PHASE'];
const DCL_STATES = ['CLOSED', 'OPEN', 'UNKNOWN'];

async function insertRow(table, fields) {
    const cols = Object.keys(fields);
    return query(
        `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => fields[c])
    );
}

/* ---------------------------- TRẠM BIẾN ÁP ---------------------------- */

const substationParsers = {
    substation_code: x => v.requiredString(x, 'mã trạm', 50),
    substation_name: x => v.requiredString(x, 'tên trạm', 150),
    voltage_level: x => v.optionalString(x, 'cấp điện áp', 50) || '110kV',
    center_lat: x => v.optionalLat(x),
    center_lng: x => v.optionalLng(x),
    boundary_geojson: x => v.optionalPolygonGeoJson(x, 'ranh giới trạm')
};

router.get('/', asyncHandler(async (req, res) => {
    ok(res, await query('SELECT * FROM substations ORDER BY substation_code ASC'));
}));

router.post('/', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, substationParsers);
    substationParsers.substation_code(f.substation_code);
    substationParsers.substation_name(f.substation_name);
    f.plant_id = req.body.plant_id ? v.parseId(req.body.plant_id, 'plant_id') : await getDefaultPlantId();
    const result = await insertRow('substations', f);
    ok(res, { substation_id: result.insertId }, 'Đã thêm trạm biến áp');
}));

router.put('/:id(\\d+)', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã trạm');
    await updateById(query, 'substations', 'substation_id', id, pickFields(req.body, substationParsers));
    ok(res, { substation_id: id }, 'Đã cập nhật trạm biến áp');
}));

router.delete('/:id(\\d+)', asyncHandler(async (req, res) => {
    await deleteById(query, 'substations', 'substation_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa trạm (kèm ngăn lộ, dao cách ly bên trong)');
}));

/* ---------------------------- NGĂN LỘ ---------------------------- */

const bayParsers = {
    substation_id: x => v.parseId(x, 'trạm biến áp'),
    bay_code: x => v.requiredString(x, 'mã ngăn lộ', 50),
    bay_name: x => v.requiredString(x, 'tên ngăn lộ', 150),
    description: x => v.optionalString(x, 'mô tả', 2000),
    center_lat: x => v.optionalLat(x),
    center_lng: x => v.optionalLng(x)
};

router.get('/bays', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `
        SELECT b.*, s.substation_code, s.substation_name,
            (SELECT COUNT(*) FROM disconnectors d WHERE d.bay_id = b.bay_id) AS disconnector_count
        FROM substation_bays b
        JOIN substations s ON b.substation_id = s.substation_id
        WHERE 1=1`;
    if (req.query.substation_id) {
        sql += ' AND b.substation_id = ?';
        params.push(v.parseId(req.query.substation_id, 'substation_id'));
    }
    sql += ' ORDER BY b.bay_code ASC';
    ok(res, await query(sql, params));
}));

router.post('/bays', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, bayParsers);
    bayParsers.substation_id(f.substation_id);
    bayParsers.bay_code(f.bay_code);
    bayParsers.bay_name(f.bay_name);
    const result = await insertRow('substation_bays', f);
    ok(res, { bay_id: result.insertId }, 'Đã thêm ngăn lộ');
}));

router.put('/bays/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã ngăn lộ');
    await updateById(query, 'substation_bays', 'bay_id', id, pickFields(req.body, bayParsers));
    ok(res, { bay_id: id }, 'Đã cập nhật ngăn lộ');
}));

router.delete('/bays/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'substation_bays', 'bay_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa ngăn lộ (kèm dao cách ly bên trong)');
}));

/* ---------------------------- DAO CÁCH LY ---------------------------- */

const dclParsers = {
    bay_id: x => v.parseId(x, 'ngăn lộ'),
    dcl_code: x => v.requiredString(x, 'mã dao cách ly', 50),
    phase: x => v.oneOf(x, PHASES, 'pha', '3PHASE'),
    dcl_name: x => v.optionalString(x, 'tên dao cách ly', 150),
    latitude: x => v.optionalLat(x),
    longitude: x => v.optionalLng(x),
    altitude: x => v.optionalNumber(x, 'độ cao'),
    state: x => v.oneOf(x, DCL_STATES, 'trạng thái', 'CLOSED'),
    max_allowed_temp: x => v.optionalNumber(x, 'ngưỡng nhiệt (°C)', { min: 0, max: 300 })
};

router.get('/disconnectors', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `
        SELECT d.*, b.bay_code, b.bay_name, s.substation_id, s.substation_name,
            (SELECT COUNT(*) FROM dcl_contacts c WHERE c.disconnector_id = d.disconnector_id) AS contact_count
        FROM disconnectors d
        JOIN substation_bays b ON d.bay_id = b.bay_id
        JOIN substations s ON b.substation_id = s.substation_id
        WHERE 1=1`;
    if (req.query.bay_id) { sql += ' AND d.bay_id = ?'; params.push(v.parseId(req.query.bay_id, 'bay_id')); }
    if (req.query.state) { sql += ' AND d.state = ?'; params.push(v.oneOf(req.query.state, DCL_STATES, 'trạng thái')); }
    if (req.query.q) {
        sql += ' AND (d.dcl_code LIKE ? OR d.dcl_name LIKE ?)';
        params.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }
    sql += ' ORDER BY b.bay_code ASC, d.dcl_code ASC, d.phase ASC';
    ok(res, await query(sql, params));
}));

router.post('/disconnectors', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, dclParsers);
    dclParsers.bay_id(f.bay_id);
    dclParsers.dcl_code(f.dcl_code);
    f.phase = f.phase || '3PHASE';
    f.dcl_name = f.dcl_name || `Dao cách ly ${f.dcl_code}${f.phase === '3PHASE' ? '' : ' Pha ' + f.phase}`;
    if (f.max_allowed_temp == null) delete f.max_allowed_temp; // dùng mặc định 70°C của bảng
    const result = await insertRow('disconnectors', f);
    ok(res, { disconnector_id: result.insertId }, 'Đã thêm dao cách ly');
}));

router.put('/disconnectors/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã dao cách ly');
    const f = pickFields(req.body, dclParsers);
    // Ô ngưỡng nhiệt để trống: giữ ngưỡng cũ (cột này bắt buộc có giá trị)
    if (Object.prototype.hasOwnProperty.call(f, 'max_allowed_temp') && f.max_allowed_temp == null) {
        delete f.max_allowed_temp;
    }
    await updateById(query, 'disconnectors', 'disconnector_id', id, f);
    ok(res, { disconnector_id: id }, 'Đã cập nhật dao cách ly');
}));

router.delete('/disconnectors/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'disconnectors', 'disconnector_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa dao cách ly');
}));

/* ---------------------------- MỐI NỐI DAO CÁCH LY ---------------------------- */

const contactParsers = {
    disconnector_id: x => v.parseId(x, 'dao cách ly'),
    contact_code: x => v.requiredString(x, 'mã mối nối', 50),
    contact_name: x => v.optionalString(x, 'tên mối nối', 150),
    position_desc: x => v.optionalString(x, 'vị trí mối nối', 150),
    latitude: x => v.optionalLat(x),
    longitude: x => v.optionalLng(x),
    altitude: x => v.optionalNumber(x, 'độ cao'),
    max_allowed_temp: x => v.optionalNumber(x, 'ngưỡng nhiệt (°C)', { min: 0, max: 300 }),
    sort_order: x => v.optionalInt(x, 'thứ tự', { min: 0, max: 10000 }) ?? 0,
    notes: x => v.optionalString(x, 'ghi chú', 2000)
};

router.get('/contacts', asyncHandler(async (req, res) => {
    const params = [];
    let sql = `
        SELECT c.*, d.dcl_code, d.phase, d.dcl_name, d.max_allowed_temp AS dcl_max_allowed_temp
        FROM dcl_contacts c
        JOIN disconnectors d ON c.disconnector_id = d.disconnector_id
        WHERE 1=1`;
    if (req.query.disconnector_id) {
        sql += ' AND c.disconnector_id = ?';
        params.push(v.parseId(req.query.disconnector_id, 'disconnector_id'));
    }
    sql += ' ORDER BY c.disconnector_id ASC, c.sort_order ASC, c.contact_code ASC';
    ok(res, await query(sql, params));
}));

router.post('/contacts', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, contactParsers);
    contactParsers.disconnector_id(f.disconnector_id);
    contactParsers.contact_code(f.contact_code);
    const result = await insertRow('dcl_contacts', f);
    ok(res, { contact_id: result.insertId }, 'Đã thêm mối nối');
}));

router.put('/contacts/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã mối nối');
    await updateById(query, 'dcl_contacts', 'contact_id', id, pickFields(req.body, contactParsers));
    ok(res, { contact_id: id }, 'Đã cập nhật mối nối');
}));

router.delete('/contacts/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'dcl_contacts', 'contact_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa mối nối');
}));

module.exports = router;
