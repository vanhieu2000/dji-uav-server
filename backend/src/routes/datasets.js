/**
 * Xuất bộ ảnh cho đội AI Vision (Giai đoạn A5).
 *   GET /api/datasets/preview?...   đếm ảnh, dung lượng, theo camera / chất lượng vị trí
 *   GET /api/datasets/export?...    tải ZIP (nén theo luồng, không nạp cả bộ vào RAM)
 * Bộ lọc: ticket_id, area_id (theo ranh giới khu), lens=IR,WIDE,ZOOM, quality=HIGH (chỉ RTK FIX),
 *         from=YYYY-MM-DD, to=YYYY-MM-DD, source=CLOUD|SD_IMPORT|..., limit (≤ 50.000)
 * Cấu trúc ZIP:
 *   images/<IR|WIDE|ZOOM>/<tên file>   ảnh gốc (không nén lại)
 *   manifest.json, manifest.csv        thông tin chụp từng ảnh (+ pair_key ghép ảnh nhiệt ↔ thường)
 *   README.txt                         giải thích các trường
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const yazl = require('yazl');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');
const { outerRing } = require('../services/flightPlanner');
const { pointInPolygon } = require('../services/coverage');

const MAX_EXPORT = 50000;
const LENSES = ['IR', 'WIDE', 'ZOOM', 'UNKNOWN'];
const SOURCES = ['CLOUD', 'SD_IMPORT', 'MANUAL', 'DISK_SCAN'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COLUMNS = [
    'file', 'pair_key', 'media_id', 'lens', 'captured_at', 'latitude', 'longitude', 'relative_altitude', 'absolute_altitude',
    'gimbal_pitch', 'gimbal_yaw', 'gimbal_roll', 'flight_yaw', 'rtk_flag', 'rtk_std_m', 'position_quality',
    'max_temperature', 'min_temperature', 'avg_temperature', 'thermal_engine',
    'ticket_code', 'inspection_type', 'route_id', 'flight_id', 'photo_point_id', 'asset_type', 'asset_id',
    'device_sn', 'source', 'original_name', 'sha256'
];

async function buildQuery(q) {
    const where = ['1=1'];
    const params = [];
    if (q.ticket_id) { where.push('m.ticket_id = ?'); params.push(v.parseId(q.ticket_id, 'phiếu')); }
    if (q.lens) {
        const lenses = String(q.lens).toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
        if (!lenses.length || lenses.some(l => !LENSES.includes(l))) throw new v.ValidationError(`Camera chỉ gồm: ${LENSES.join(', ')}`);
        where.push(`m.lens IN (${lenses.map(() => '?').join(', ')})`);
        params.push(...lenses);
    }
    if (q.quality) { where.push('m.position_quality = ?'); params.push(v.oneOf(q.quality, ['HIGH', 'LOW', 'UNKNOWN'], 'chất lượng vị trí')); }
    if (q.source) { where.push('m.source = ?'); params.push(v.oneOf(q.source, SOURCES, 'nguồn ảnh')); }
    for (const [key, op] of [['from', '>='], ['to', '<']]) {
        if (!q[key]) continue;
        if (!DATE_RE.test(String(q[key]))) throw new v.ValidationError(`${key} phải có dạng YYYY-MM-DD`);
        // "to" tính hết ngày đó
        where.push(`m.captured_at ${op} ${key === 'to' ? 'DATE_ADD(?, INTERVAL 1 DAY)' : '?'}`);
        params.push(q[key]);
    }
    let polygon = null;
    if (q.area_id) {
        const rows = await query('SELECT area_code, polygon_geojson FROM solar_areas WHERE area_id = ?', [v.parseId(q.area_id, 'khu')]);
        if (!rows.length) throw new NotFoundError('Không tìm thấy khu pin');
        if (!rows[0].polygon_geojson) throw new v.ValidationError(`Khu ${rows[0].area_code} chưa vẽ ranh giới`);
        polygon = outerRing(rows[0].polygon_geojson);
        where.push('m.latitude BETWEEN ? AND ? AND m.longitude BETWEEN ? AND ?');
        params.push(Math.min(...polygon.map(p => p.lat)), Math.max(...polygon.map(p => p.lat)),
            Math.min(...polygon.map(p => p.lng)), Math.max(...polygon.map(p => p.lng)));
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || MAX_EXPORT, 1), MAX_EXPORT);
    const sql = `
        SELECT m.*, t.ticket_code, t.inspection_type, pp.asset_type, pp.asset_id
        FROM media_files m
        LEFT JOIN inspection_tickets t ON m.ticket_id = t.ticket_id
        LEFT JOIN photo_points pp ON m.photo_point_id = pp.point_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.captured_at, m.media_id
        LIMIT ${limit + 1}`;
    return { sql, params, polygon, limit };
}

/** Lọc chính xác theo đa giác (SQL chỉ lọc theo khung bao). */
async function selectMedia(q) {
    const { sql, params, polygon, limit } = await buildQuery(q);
    let rows = await query(sql, params);
    const truncated = rows.length > limit;
    rows = rows.slice(0, limit);
    if (polygon) {
        const pts = polygon.map(p => ({ x: p.lng, y: p.lat }));
        rows = rows.filter(r => pointInPolygon({ x: r.longitude, y: r.latitude }, pts));
    }
    return { rows, truncated };
}

/** Khóa ghép ảnh chụp cùng lượt: DJI_20261026101530_0001_T.JPG → DJI_20261026101530_0001 */
function pairKey(name) {
    const base = path.basename(String(name || '')).replace(/\.[^.]+$/, '');
    const m = /^(DJI_\d{14}_\d{4})/.exec(base);
    return m ? m[1] : base.replace(/_(T|W|Z|V)(?=_|$)/i, '');
}

function toManifestRow(r) {
    const file = `images/${r.lens}/${r.media_id}_${path.basename(r.original_name || r.file_name)}`;
    const meta = (() => { try { return JSON.parse(r.meta_json || '{}'); } catch (e) { return {}; } })();
    return {
        file, pair_key: pairKey(r.original_name || r.file_name), media_id: r.media_id, lens: r.lens,
        captured_at: r.captured_at ? new Date(r.captured_at).toISOString() : null,
        latitude: r.latitude, longitude: r.longitude, relative_altitude: r.relative_altitude,
        absolute_altitude: r.altitude ?? meta.absolute_altitude ?? null,
        gimbal_pitch: r.gimbal_pitch, gimbal_yaw: r.gimbal_yaw, gimbal_roll: r.gimbal_roll, flight_yaw: r.flight_yaw,
        rtk_flag: r.rtk_flag, rtk_std_m: r.rtk_std_m, position_quality: r.position_quality,
        max_temperature: r.max_temperature, min_temperature: r.min_temperature, avg_temperature: r.avg_temperature,
        thermal_engine: r.thermal_engine, ticket_code: r.ticket_code, inspection_type: r.inspection_type,
        route_id: r.route_id, flight_id: r.flight_id, photo_point_id: r.photo_point_id,
        asset_type: r.asset_type, asset_id: r.asset_id, device_sn: r.device_sn, source: r.source,
        original_name: r.original_name, sha256: r.sha256
    };
}

function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const README = `BỘ ẢNH KIỂM TRA UAV – dji-uav-server
=====================================
images/IR      ảnh nhiệt R-JPEG gốc 640x512 (có dữ liệu nhiệt độ, đọc bằng DJI Thermal SDK)
images/WIDE    ảnh camera rộng gốc
images/ZOOM    ảnh camera zoom gốc
manifest.json / manifest.csv – mỗi dòng 1 ảnh:
  pair_key          ảnh nhiệt và ảnh thường chụp cùng lượt có cùng pair_key
  latitude/longitude tọa độ máy bay lúc chụp (WGS84)
  relative_altitude độ cao so với điểm cất cánh (m)
  gimbal_pitch/yaw  góc camera (độ; pitch -90 = nhìn thẳng xuống)
  flight_yaw        hướng mũi máy bay (độ, 0 = Bắc)
  rtk_flag          50 = RTK FIX (vị trí chính xác cm); position_quality HIGH/LOW/UNKNOWN
  max/min/avg_temperature  nhiệt độ ảnh nhiệt (°C), thermal_engine = bộ đọc đã dùng
  ticket_code, inspection_type  phiếu kiểm tra (SOLAR_PANEL / DISCONNECTOR)
  photo_point_id, asset_type, asset_id  ảnh chụp tại điểm cố định của tài sản nào (DCL, mối nối...)
  sha256            mã băm file (chống trùng)
Kết quả phát hiện lỗi trả về server theo đặc tả tích hợp AI Vision (khung pixel trên đúng file ảnh).
`;

router.get('/preview', asyncHandler(async (req, res) => {
    const { rows, truncated } = await selectMedia(req.query);
    const by = key => rows.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
    ok(res, {
        count: rows.length,
        truncated,
        size_bytes: rows.reduce((s, r) => s + (Number(r.file_size) || 0), 0),
        by_lens: by('lens'),
        by_quality: by('position_quality'),
        pairs: new Set(rows.map(r => pairKey(r.original_name || r.file_name))).size
    });
}));

router.get('/export', asyncHandler(async (req, res) => {
    const { rows, truncated } = await selectMedia(req.query);
    if (!rows.length) throw new v.ValidationError('Không có ảnh nào khớp bộ lọc');
    const zip = new yazl.ZipFile();
    const manifest = [];
    const missing = [];
    rows.forEach(r => {
        const file = r.file_path_local;
        if (!file || !fs.existsSync(file)) { missing.push({ media_id: r.media_id, file_name: r.file_name }); return; }
        const m = toManifestRow(r);
        manifest.push(m);
        zip.addFile(file, m.file, { compress: false }); // JPEG đã nén sẵn
    });
    const exportedAt = new Date().toISOString();
    const filters = Object.fromEntries(Object.entries(req.query).filter(([k]) => ['ticket_id', 'area_id', 'lens', 'quality', 'from', 'to', 'source', 'limit'].includes(k)));
    zip.addBuffer(Buffer.from(JSON.stringify({ exported_at: exportedAt, filters, count: manifest.length, truncated, missing, images: manifest }, null, 2)), 'manifest.json');
    zip.addBuffer(Buffer.from('﻿' + [COLUMNS.join(','), ...manifest.map(m => COLUMNS.map(c => csvCell(m[c])).join(','))].join('\r\n')), 'manifest.csv');
    zip.addBuffer(Buffer.from(README), 'README.txt');
    zip.end();
    const name = `dataset_${req.query.ticket_id ? `phieu${req.query.ticket_id}_` : ''}${exportedAt.slice(0, 10)}.zip`;
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
    zip.outputStream.on('error', err => { console.error('[Xuất bộ ảnh]', err.message); res.destroy(err); });
    zip.outputStream.pipe(res);
}));

module.exports = router;
module.exports.pairKey = pairKey;
