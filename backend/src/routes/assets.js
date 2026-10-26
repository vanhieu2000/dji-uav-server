/**
 * API tổng hợp tài sản cho bản đồ:
 *   GET  /api/assets/search      tìm chung mọi loại tài sản theo mã / tên
 *   GET  /api/assets/tree        cây nhà máy -> khu -> chuỗi, trạm -> ngăn lộ -> DCL -> mối nối
 *   GET  /api/assets/features    dữ liệu các lớp bản đồ
 *   CRUD /api/assets/photo-points  điểm chụp ảnh gắn với tài sản
 *   POST /api/assets/import/check | /commit   nhập Excel 2 bước
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const { pickFields, updateById, deleteById } = require('../utils/sql');
const v = require('../utils/validate');
const { polygonCenter } = require('../utils/geo');
const { getDefaultPlantId } = require('./solar');
const assetImport = require('../services/assetImport');
const { ASSET_TABLES } = require('../services/photoPoints');

const SEARCH_LIMIT_MAX = 50;
const FEATURE_PANEL_LIMIT = 5000;
const FEATURE_ANOMALY_LIMIT = 1000;
const ALL_LAYERS = ['areas', 'strings', 'panels', 'substations', 'bays', 'disconnectors', 'contacts', 'photo_points', 'anomalies'];

/* ---------------------------- TÌM KIẾM ---------------------------- */

function centerOf(row, latCol, lngCol, geoCol) {
    if (row[latCol] != null && row[lngCol] != null) return { lat: Number(row[latCol]), lng: Number(row[lngCol]) };
    return geoCol && row[geoCol] ? polygonCenter(row[geoCol]) : null;
}

router.get('/search', asyncHandler(async (req, res) => {
    const q = v.requiredString(req.query.q, 'từ khóa tìm kiếm', 100);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), SEARCH_LIMIT_MAX);
    // Thoát %, _ và \ để người dùng gõ ký tự này được tìm đúng nghĩa đen
    const like = `%${q.replace(/[\\%_]/g, ch => '\\' + ch)}%`;
    const per = limit; // mỗi loại lấy tối đa limit, sau đó gộp và cắt

    const [areas, strings, panels, subs, bays, dcls, contacts] = await Promise.all([
        query(`SELECT area_id, area_code, area_name, center_lat, center_lng, polygon_geojson FROM solar_areas
               WHERE area_code LIKE ? OR area_name LIKE ? ORDER BY area_code LIMIT ${per}`, [like, like]),
        query(`SELECT s.string_id, s.string_code, s.string_name, a.area_code, a.center_lat, a.center_lng,
                      (SELECT AVG(p.latitude) FROM solar_panels p WHERE p.string_id = s.string_id) AS p_lat,
                      (SELECT AVG(p.longitude) FROM solar_panels p WHERE p.string_id = s.string_id) AS p_lng
               FROM solar_strings s JOIN solar_areas a ON s.area_id = a.area_id
               WHERE s.string_code LIKE ? OR s.string_name LIKE ? ORDER BY s.string_code LIMIT ${per}`, [like, like]),
        query(`SELECT p.panel_id, p.panel_serial, p.panel_index, p.latitude, p.longitude, p.status, s.string_code, a.area_code
               FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id JOIN solar_areas a ON s.area_id = a.area_id
               WHERE p.panel_serial LIKE ? ORDER BY p.panel_serial LIMIT ${per}`, [like]),
        query(`SELECT substation_id, substation_code, substation_name, center_lat, center_lng, boundary_geojson FROM substations
               WHERE substation_code LIKE ? OR substation_name LIKE ? LIMIT ${per}`, [like, like]),
        query(`SELECT b.bay_id, b.bay_code, b.bay_name, b.center_lat, b.center_lng, s.substation_code
               FROM substation_bays b JOIN substations s ON b.substation_id = s.substation_id
               WHERE b.bay_code LIKE ? OR b.bay_name LIKE ? ORDER BY b.bay_code LIMIT ${per}`, [like, like]),
        query(`SELECT d.disconnector_id, d.dcl_code, d.dcl_name, d.phase, d.latitude, d.longitude, b.bay_code
               FROM disconnectors d JOIN substation_bays b ON d.bay_id = b.bay_id
               WHERE d.dcl_code LIKE ? OR d.dcl_name LIKE ? ORDER BY d.dcl_code, d.phase LIMIT ${per}`, [like, like]),
        query(`SELECT c.contact_id, c.contact_code, c.contact_name, c.latitude, c.longitude, d.dcl_code, d.phase
               FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id = d.disconnector_id
               WHERE c.contact_code LIKE ? OR c.contact_name LIKE ? ORDER BY c.contact_code LIMIT ${per}`, [like, like])
    ]);

    const results = [
        ...areas.map(r => ({ type: 'area', id: r.area_id, code: r.area_code, name: r.area_name, parent: null, ...centerOf(r, 'center_lat', 'center_lng', 'polygon_geojson') })),
        ...strings.map(r => ({ type: 'string', id: r.string_id, code: r.string_code, name: r.string_name, parent: r.area_code, ...(centerOf(r, 'p_lat', 'p_lng') || centerOf(r, 'center_lat', 'center_lng')) })),
        ...panels.map(r => ({ type: 'panel', id: r.panel_id, code: r.panel_serial, name: `Tấm số ${r.panel_index}`, parent: `${r.area_code} / ${r.string_code}`, status: r.status, ...centerOf(r, 'latitude', 'longitude') })),
        ...subs.map(r => ({ type: 'substation', id: r.substation_id, code: r.substation_code, name: r.substation_name, parent: null, ...centerOf(r, 'center_lat', 'center_lng', 'boundary_geojson') })),
        ...bays.map(r => ({ type: 'bay', id: r.bay_id, code: r.bay_code, name: r.bay_name, parent: r.substation_code, ...centerOf(r, 'center_lat', 'center_lng') })),
        ...dcls.map(r => ({ type: 'disconnector', id: r.disconnector_id, code: r.dcl_code, name: r.dcl_name, parent: r.bay_code, phase: r.phase, ...centerOf(r, 'latitude', 'longitude') })),
        ...contacts.map(r => ({ type: 'contact', id: r.contact_id, code: r.contact_code, name: r.contact_name, parent: `${r.dcl_code} pha ${r.phase}`, ...centerOf(r, 'latitude', 'longitude') }))
    ];

    // Ưu tiên khớp chính xác mã, rồi khớp đầu mã
    const qUp = q.toUpperCase();
    const score = r => {
        const code = String(r.code || '').toUpperCase();
        if (code === qUp) return 0;
        if (code.startsWith(qUp)) return 1;
        return 2;
    };
    results.sort((a, b) => score(a) - score(b));
    ok(res, results.slice(0, limit).map(r => ({ ...r, lat: r.lat ?? null, lng: r.lng ?? null })));
}));

/* ---------------------------- CÂY TÀI SẢN ---------------------------- */

router.get('/tree', asyncHandler(async (req, res) => {
    const plantId = req.query.plant_id ? v.parseId(req.query.plant_id, 'plant_id') : await getDefaultPlantId();
    const [plants, areas, strings, subs, bays, dcls, contacts] = await Promise.all([
        query('SELECT * FROM plants WHERE plant_id = ?', [plantId]),
        query(`SELECT a.area_id, a.area_code, a.area_name, a.center_lat, a.center_lng, a.total_capacity_kwp,
                      (a.polygon_geojson IS NOT NULL) AS has_polygon
               FROM solar_areas a WHERE a.plant_id = ? ORDER BY a.area_code`, [plantId]),
        query(`SELECT s.string_id, s.area_id, s.string_code, s.string_name, s.inverter_channel, s.panel_count,
                      COUNT(p.panel_id) AS actual_panel_count,
                      SUM(p.status IN ('DEFECT', 'WARNING')) AS abnormal_count
               FROM solar_strings s
               JOIN solar_areas a ON s.area_id = a.area_id
               LEFT JOIN solar_panels p ON p.string_id = s.string_id
               WHERE a.plant_id = ?
               GROUP BY s.string_id ORDER BY s.string_code`, [plantId]),
        query('SELECT substation_id, substation_code, substation_name, voltage_level, center_lat, center_lng FROM substations WHERE plant_id = ? ORDER BY substation_code', [plantId]),
        query(`SELECT b.bay_id, b.substation_id, b.bay_code, b.bay_name, b.center_lat, b.center_lng
               FROM substation_bays b JOIN substations s ON b.substation_id = s.substation_id
               WHERE s.plant_id = ? ORDER BY b.bay_code`, [plantId]),
        query(`SELECT d.disconnector_id, d.bay_id, d.dcl_code, d.phase, d.dcl_name, d.latitude, d.longitude,
                      d.max_allowed_temp, d.last_inspected_temp, d.state
               FROM disconnectors d JOIN substation_bays b ON d.bay_id = b.bay_id JOIN substations s ON b.substation_id = s.substation_id
               WHERE s.plant_id = ? ORDER BY d.dcl_code, d.phase`, [plantId]),
        query(`SELECT c.contact_id, c.disconnector_id, c.contact_code, c.contact_name, c.position_desc, c.latitude, c.longitude
               FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id = d.disconnector_id
               JOIN substation_bays b ON d.bay_id = b.bay_id JOIN substations s ON b.substation_id = s.substation_id
               WHERE s.plant_id = ? ORDER BY c.sort_order, c.contact_code`, [plantId])
    ]);
    if (!plants.length) throw new NotFoundError('Không tìm thấy nhà máy');

    const groupBy = (rows, key) => rows.reduce((m, r) => {
        (m[r[key]] = m[r[key]] || []).push(r);
        return m;
    }, {});
    const stringsByArea = groupBy(strings, 'area_id');
    const baysBySub = groupBy(bays, 'substation_id');
    const dclsByBay = groupBy(dcls, 'bay_id');
    const contactsByDcl = groupBy(contacts, 'disconnector_id');

    ok(res, {
        plant: plants[0],
        areas: areas.map(a => ({
            ...a,
            has_polygon: Boolean(a.has_polygon),
            strings: (stringsByArea[a.area_id] || []).map(s => ({
                ...s,
                actual_panel_count: Number(s.actual_panel_count) || 0,
                abnormal_count: Number(s.abnormal_count) || 0
            }))
        })),
        substations: subs.map(s => ({
            ...s,
            bays: (baysBySub[s.substation_id] || []).map(b => ({
                ...b,
                disconnectors: (dclsByBay[b.bay_id] || []).map(d => ({
                    ...d,
                    contacts: contactsByDcl[d.disconnector_id] || []
                }))
            }))
        }))
    });
}));

/* ---------------------------- LỚP BẢN ĐỒ ---------------------------- */

/** Đọc GeoJSON đã lưu; dữ liệu cũ hỏng thì bỏ qua thay vì làm lỗi cả API. */
function safeJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

function bboxClause(bbox, latCol, lngCol, params) {
    if (!bbox) return '';
    params.push(bbox.south, bbox.north, bbox.west, bbox.east);
    return ` AND ${latCol} BETWEEN ? AND ? AND ${lngCol} BETWEEN ? AND ?`;
}

const LAYER_LOADERS = {
    async areas() {
        const rows = await query(`SELECT a.area_id, a.area_code, a.area_name, a.center_lat, a.center_lng, a.polygon_geojson, a.total_capacity_kwp,
                (SELECT COUNT(*) FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id
                    WHERE s.area_id = a.area_id AND p.status IN ('DEFECT', 'WARNING')) AS abnormal_count
            FROM solar_areas a ORDER BY a.area_code`);
        return rows.map(r => ({ ...r, polygon_geojson: safeJson(r.polygon_geojson) }));
    },
    async strings() {
        const rows = await query(`SELECT s.string_id, s.string_code, s.line_geojson, a.area_code
            FROM solar_strings s JOIN solar_areas a ON s.area_id = a.area_id WHERE s.line_geojson IS NOT NULL`);
        return rows.map(r => ({ ...r, line_geojson: safeJson(r.line_geojson) })).filter(r => r.line_geojson);
    },
    async panels(bbox) {
        if (!bbox) return { items: [], truncated: false, need_bbox: true };
        const params = [];
        const sql = `SELECT p.panel_id, p.panel_serial, p.panel_index, p.latitude, p.longitude, p.status, s.string_code, a.area_code
            FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id JOIN solar_areas a ON s.area_id = a.area_id
            WHERE p.latitude IS NOT NULL${bboxClause(bbox, 'p.latitude', 'p.longitude', params)}
            LIMIT ${FEATURE_PANEL_LIMIT + 1}`;
        const rows = await query(sql, params);
        return { items: rows.slice(0, FEATURE_PANEL_LIMIT), truncated: rows.length > FEATURE_PANEL_LIMIT };
    },
    async substations() {
        const rows = await query('SELECT substation_id, substation_code, substation_name, voltage_level, center_lat, center_lng, boundary_geojson FROM substations');
        return rows.map(r => ({ ...r, boundary_geojson: safeJson(r.boundary_geojson) }));
    },
    bays() {
        return query(`SELECT b.bay_id, b.bay_code, b.bay_name, b.center_lat, b.center_lng, s.substation_code
            FROM substation_bays b JOIN substations s ON b.substation_id = s.substation_id WHERE b.center_lat IS NOT NULL`);
    },
    disconnectors() {
        return query(`SELECT d.disconnector_id, d.dcl_code, d.phase, d.dcl_name, d.latitude, d.longitude, d.state,
                d.max_allowed_temp, d.last_inspected_temp, d.last_inspected_at, b.bay_code
            FROM disconnectors d JOIN substation_bays b ON d.bay_id = b.bay_id WHERE d.latitude IS NOT NULL`);
    },
    contacts() {
        return query(`SELECT c.contact_id, c.contact_code, c.contact_name, c.position_desc, c.latitude, c.longitude, d.dcl_code, d.phase
            FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id = d.disconnector_id WHERE c.latitude IS NOT NULL`);
    },
    photo_points(bbox) {
        const params = [];
        return query(`SELECT * FROM photo_points WHERE 1=1${bboxClause(bbox, 'latitude', 'longitude', params)} ORDER BY asset_type, asset_id, sort_order LIMIT ${FEATURE_PANEL_LIMIT}`, params);
    },
    /** Kết quả AI: lấy tọa độ theo tài sản đã gắn, nếu chưa gắn thì lấy tọa độ ảnh. */
    async anomalies(bbox, opts) {
        const params = [];
        let where = '';
        if (opts.ticketId) { where += ' AND d.ticket_id = ?'; params.push(opts.ticketId); }
        const rows = await query(`
            SELECT d.detection_id, d.defect_type, d.confidence, d.max_temperature, d.delta_temperature, d.detected_at,
                   d.crop_image_url, d.panel_id, d.disconnector_id, d.contact_id,
                   m.file_url, m.media_type, t.ticket_code,
                   p.panel_serial, dc.dcl_code, dc.phase, c.contact_code,
                   COALESCE(c.latitude, dc.latitude, p.latitude, m.latitude) AS lat,
                   COALESCE(c.longitude, dc.longitude, p.longitude, m.longitude) AS lng
            FROM ai_defect_detections d
            JOIN media_files m ON d.media_id = m.media_id
            LEFT JOIN inspection_tickets t ON d.ticket_id = t.ticket_id
            LEFT JOIN solar_panels p ON d.panel_id = p.panel_id
            LEFT JOIN disconnectors dc ON d.disconnector_id = dc.disconnector_id
            LEFT JOIN dcl_contacts c ON d.contact_id = c.contact_id
            WHERE 1=1${where}
            HAVING lat IS NOT NULL AND lng IS NOT NULL${bbox ? ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?' : ''}
            ORDER BY d.detection_id DESC LIMIT ${FEATURE_ANOMALY_LIMIT}`, bbox ? [...params, bbox.south, bbox.north, bbox.west, bbox.east] : params);
        return rows;
    }
};

/**
 * ?layers=areas,panels,...  (mặc định: tất cả)
 * ?bbox=nam,tây,bắc,đông    (bắt buộc với lớp panels)
 * ?ticket_id=               (lọc lớp anomalies theo phiếu)
 */
router.get('/features', asyncHandler(async (req, res) => {
    const requested = req.query.layers ? String(req.query.layers).split(',').map(s => s.trim()).filter(Boolean) : ALL_LAYERS;
    const unknown = requested.filter(l => !Object.hasOwn(LAYER_LOADERS, l));
    if (unknown.length) throw new v.ValidationError(`Lớp không hỗ trợ: ${unknown.join(', ')}`);
    const bbox = v.optionalBbox(req.query.bbox);
    const opts = { ticketId: req.query.ticket_id ? v.parseId(req.query.ticket_id, 'ticket_id') : null };
    const entries = await Promise.all(requested.map(async l => [l, await LAYER_LOADERS[l](bbox, opts)]));
    ok(res, Object.fromEntries(entries));
}));

/* ---------------------------- ĐIỂM CHỤP ẢNH ---------------------------- */

const CAMERA_MODES = ['WIDE', 'ZOOM', 'IR', 'WIDE_IR'];

const photoPointParsers = {
    asset_type: x => v.oneOf(x, Object.keys(ASSET_TABLES), 'loại tài sản'),
    asset_id: x => v.parseId(x, 'tài sản'),
    point_name: x => v.optionalString(x, 'tên điểm', 150),
    latitude: x => v.requiredNumber(x, 'vĩ độ', { min: -90, max: 90 }),
    longitude: x => v.requiredNumber(x, 'kinh độ', { min: -180, max: 180 }),
    altitude_m: x => v.requiredNumber(x, 'độ cao bay (m)', { min: 2, max: 500 }),
    gimbal_pitch: x => v.requiredNumber(x, 'góc gimbal', { min: -90, max: 35 }),
    gimbal_yaw: x => v.optionalNumber(x, 'hướng gimbal', { min: -180, max: 360 }),
    aircraft_heading: x => v.optionalNumber(x, 'hướng máy bay', { min: -180, max: 360 }),
    camera_mode: x => v.oneOf(x, CAMERA_MODES, 'chế độ camera', 'WIDE_IR'),
    zoom_factor: x => v.optionalNumber(x, 'độ zoom', { min: 1, max: 200 }),
    hover_seconds: x => v.optionalInt(x, 'thời gian dừng (s)', { min: 0, max: 120 }) ?? 2,
    sort_order: x => v.optionalInt(x, 'thứ tự', { min: 0, max: 100000 }) ?? 0,
    notes: x => v.optionalString(x, 'ghi chú', 2000)
};

async function assertAssetExists(type, id) {
    const [table, col] = ASSET_TABLES[type];
    const rows = await query(`SELECT 1 FROM \`${table}\` WHERE \`${col}\` = ? LIMIT 1`, [id]);
    if (!rows.length) throw new v.ValidationError('Tài sản gắn với điểm chụp không tồn tại');
}

router.get('/photo-points', asyncHandler(async (req, res) => {
    const params = [];
    let sql = 'SELECT * FROM photo_points WHERE 1=1';
    if (req.query.asset_type) { sql += ' AND asset_type = ?'; params.push(v.oneOf(req.query.asset_type, Object.keys(ASSET_TABLES), 'loại tài sản')); }
    if (req.query.asset_id) { sql += ' AND asset_id = ?'; params.push(v.parseId(req.query.asset_id, 'asset_id')); }
    sql += ' ORDER BY asset_type, asset_id, sort_order, point_id';
    ok(res, await query(sql, params));
}));

router.post('/photo-points', asyncHandler(async (req, res) => {
    const body = { gimbal_pitch: -90, altitude_m: 30, ...req.body };
    const f = pickFields(body, photoPointParsers);
    for (const col of ['asset_type', 'asset_id', 'latitude', 'longitude']) photoPointParsers[col](f[col]);
    await assertAssetExists(f.asset_type, f.asset_id);
    const cols = Object.keys(f);
    const result = await query(
        `INSERT INTO photo_points (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => f[c])
    );
    ok(res, { point_id: result.insertId }, 'Đã thêm điểm chụp ảnh');
}));

router.put('/photo-points/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã điểm chụp');
    const f = pickFields(req.body, photoPointParsers);
    if (f.asset_type || f.asset_id) {
        const current = await query('SELECT asset_type, asset_id FROM photo_points WHERE point_id = ?', [id]);
        if (!current.length) throw new NotFoundError('Không tìm thấy điểm chụp');
        await assertAssetExists(f.asset_type || current[0].asset_type, f.asset_id || current[0].asset_id);
    }
    await updateById(query, 'photo_points', 'point_id', id, f);
    ok(res, { point_id: id }, 'Đã cập nhật điểm chụp ảnh');
}));

router.delete('/photo-points/:id', asyncHandler(async (req, res) => {
    await deleteById(query, 'photo_points', 'point_id', v.parseId(req.params.id));
    ok(res, null, 'Đã xóa điểm chụp ảnh');
}));

/* ---------------------------- NHẬP EXCEL ---------------------------- */

router.get('/import/columns', (req, res) => {
    ok(res, { columns: assetImport.ENTITY_COLUMNS, max_rows: assetImport.MAX_ROWS });
});

async function importPlantId(body) {
    return body && body.plant_id ? v.parseId(body.plant_id, 'plant_id') : getDefaultPlantId();
}

router.post('/import/check', asyncHandler(async (req, res) => {
    const { entity, rows } = req.body || {};
    const { summary, results } = await assetImport.checkImport(entity, rows, await importPlantId(req.body));
    ok(res, { summary, rows: assetImport.toPublicResults(results) });
}));

router.post('/import/commit', asyncHandler(async (req, res) => {
    const { entity, rows, skip_errors: skipErrors } = req.body || {};
    const result = await assetImport.commitImport(entity, rows, await importPlantId(req.body), { skipErrors: skipErrors === true });
    ok(res, result, `Đã ghi ${result.written} dòng${result.skipped ? `, bỏ qua ${result.skipped} dòng lỗi` : ''}`);
}));

module.exports = router;
