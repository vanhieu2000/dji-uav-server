/**
 * Lịch sử chuyến bay (Giai đoạn C2).
 *   GET /api/flights?device_sn=&ticket_id=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=
 *   GET /api/flights/:id   → thông tin chuyến + vết bay (telemetry) + ảnh chụp trong chuyến
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_TRACK_POINTS = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, label) {
    if (v.isBlank(value)) return null;
    if (!DATE_RE.test(String(value))) throw new v.ValidationError(`${label} phải có dạng YYYY-MM-DD`);
    return String(value);
}

/** Giảm số điểm vết bay nhưng giữ điểm đầu, điểm cuối. */
function thin(rows, max) {
    if (rows.length <= max) return rows;
    const step = rows.length / max;
    const out = [];
    for (let i = 0; i < max - 1; i += 1) out.push(rows[Math.floor(i * step)]);
    out.push(rows[rows.length - 1]);
    return out;
}

const FLIGHT_COLUMNS = `f.flight_session_id, f.device_sn, f.ticket_id, f.pilot_session_id, f.started_at, f.ended_at, f.end_reason,
    f.start_lat, f.start_lng, f.duration_s, f.distance_m, f.max_relative_height, f.battery_start, f.battery_end, f.rtk_fix_ratio,
    t.ticket_code, t.ticket_name, p.username AS pilot_username,
    (SELECT COUNT(*) FROM media_files m WHERE m.flight_session_id = f.flight_session_id) AS photo_count`;
const FLIGHT_JOINS = `FROM flight_sessions f
    LEFT JOIN inspection_tickets t ON t.ticket_id = f.ticket_id
    LEFT JOIN pilot_sessions p ON p.session_id = f.pilot_session_id`;

router.get('/', asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    const sn = v.optionalString(req.query.device_sn, 'Mã máy bay', 64);
    if (sn) { where.push('f.device_sn = ?'); params.push(sn); }
    if (!v.isBlank(req.query.ticket_id)) { where.push('f.ticket_id = ?'); params.push(v.parseId(req.query.ticket_id, 'phiếu kiểm tra')); }
    const from = parseDate(req.query.from, 'Từ ngày');
    const to = parseDate(req.query.to, 'Đến ngày');
    if (from) { where.push('f.started_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('f.started_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
    const limit = v.optionalInt(req.query.limit, 'Số dòng', { min: 1, max: MAX_LIMIT }) || DEFAULT_LIMIT;

    const rows = await query(
        `SELECT ${FLIGHT_COLUMNS} ${FLIGHT_JOINS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.started_at DESC LIMIT ${limit}`,
        params
    );
    ok(res, rows.map(r => ({ ...r, photo_count: Number(r.photo_count) || 0 })));
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'chuyến bay');
    const rows = await query(`SELECT ${FLIGHT_COLUMNS} ${FLIGHT_JOINS} WHERE f.flight_session_id = ?`, [id]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy chuyến bay');
    const flight = { ...rows[0], photo_count: Number(rows[0].photo_count) || 0 };

    const track = await query(
        `SELECT latitude AS lat, longitude AS lng, relative_height AS h, horizontal_speed AS v, battery_percent AS battery,
                yaw, rtk_fixed, recorded_at AS t
         FROM telemetry_logs WHERE flight_session_id = ? ORDER BY recorded_at, log_id`,
        [id]
    );
    const photos = await query(
        `SELECT media_id, file_name, file_url, media_type, lens, latitude AS lat, longitude AS lng, relative_altitude,
                position_quality, max_temperature, captured_at
         FROM media_files WHERE flight_session_id = ? ORDER BY captured_at, media_id`,
        [id]
    );
    ok(res, { ...flight, track_points_total: track.length, track: thin(track, MAX_TRACK_POINTS), photos });
}));

module.exports = router;
module.exports.thin = thin;
