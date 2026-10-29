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

router.post('/:id/vision',asyncHandler(async(req,res)=>{
 const id=v.parseId(req.params.id,'chuyến'),a=require('../services/authorization');a.permission(req.user,'tasks:write');const [f]=await query('SELECT ticket_id FROM flight_sessions WHERE flight_session_id=?',[id]);if(!f)throw new NotFoundError('Không có chuyến bay');if(!f.ticket_id)throw Object.assign(new v.ValidationError('Gắn chuyến với phiếu trước khi gửi Vision'),{status:409});await a.ticket(req.user,f.ticket_id);
 if(process.env.VISION_ENABLED!=='true'||!process.env.VISION_ENDPOINT||!process.env.VISION_WEBHOOK_SECRET||!process.env.VISION_PUBLIC_BASE_URL)return res.status(503).json({code:503,message:'Worker Vision chưa được bật hoặc chưa đủ cấu hình; chưa gửi ảnh.'});
 const after=v.optionalInt(req.body.after_media_id,'mốc ảnh',{min:0,max:Number.MAX_SAFE_INTEGER})||0,rows=await query('SELECT media_id FROM media_files WHERE flight_session_id=? AND media_id>? AND sha256 IS NOT NULL ORDER BY media_id LIMIT 51',[id,after]),items=[];
 for(const r of rows.slice(0,50)){const j=await require('../services/visionJobs').enqueue(r.media_id);items.push({media_id:r.media_id,job_id:j.job_id,status:j.status});}ok(res,{items,next_id:items.at(-1)?.media_id||after,has_more:rows.length>50});
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
        `SELECT m.media_id, m.file_name, m.file_url, m.media_type, m.lens, m.latitude AS lat, m.longitude AS lng, m.relative_altitude,
                m.position_quality, m.max_temperature, m.captured_at,j.status AS vision_status,
                EXISTS(SELECT 1 FROM ai_defect_detections d WHERE d.media_id=m.media_id) AS has_defect
         FROM media_files m LEFT JOIN vision_jobs j ON j.media_id=m.media_id AND j.input_sha256=m.sha256 WHERE m.flight_session_id = ? ORDER BY m.captured_at, m.media_id`,
        [id]
    );
    ok(res, { ...flight, track_points_total: track.length, track: thin(track, MAX_TRACK_POINTS), photos });
}));

module.exports = router;
module.exports.thin = thin;
