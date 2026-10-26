const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');

function createRouter({ monitoring }) {
    const router = express.Router();
    router.get('/devices', asyncHandler(async (req, res) => {
        const ticket = v.isBlank(req.query.ticket_id) ? null : v.parseId(req.query.ticket_id, 'phiếu kiểm tra');
        const rows = await query(`SELECT d.device_sn, d.device_name, d.gateway_sn, d.last_latitude AS lat,
            d.last_longitude AS lng, d.last_altitude AS alt, d.last_relative_height AS rel_alt, d.last_yaw AS yaw,
            d.last_battery AS battery, d.rtk_state, d.last_seen,
            CASE WHEN d.last_seen < NOW() - INTERVAL 30 SECOND THEN 'OFFLINE' ELSE d.status END AS status,
            f.flight_session_id, f.ticket_id, t.ticket_code
            FROM uav_devices d LEFT JOIN flight_sessions f ON f.flight_session_id =
                (SELECT MAX(f2.flight_session_id) FROM flight_sessions f2 WHERE f2.device_sn = d.device_sn AND f2.ended_at IS NULL)
            LEFT JOIN inspection_tickets t ON t.ticket_id = f.ticket_id
            WHERE d.device_type = 'DRONE' ${ticket ? 'AND f.ticket_id = ?' : ''} ORDER BY d.device_sn`, ticket ? [ticket] : []);
        ok(res, rows);
    }));
    router.get('/photos', asyncHandler(async (req, res) => {
        const after = v.isBlank(req.query.after_id) ? 0 : v.optionalInt(req.query.after_id, 'mốc ảnh', { min: 0, max: Number.MAX_SAFE_INTEGER });
        const ticket = v.isBlank(req.query.ticket_id) ? null : v.parseId(req.query.ticket_id, 'phiếu kiểm tra');
        const rows = await query(`SELECT media_id, ticket_id, device_sn, file_name, file_url, lens, captured_at, uploaded_at,
            latitude AS lat, longitude AS lng, position_quality FROM media_files WHERE media_id > ?
            ${ticket ? 'AND ticket_id = ?' : ''} ORDER BY media_id LIMIT 500`, ticket ? [after, ticket] : [after]);
        ok(res, { items: rows, next_id: rows.length ? rows[rows.length - 1].media_id : after, has_more: rows.length === 500 });
    }));
    router.get('/hms', asyncHandler(async (req, res) => {
        const sn = v.optionalString(req.query.device_sn, 'mã thiết bị', 64);
        const rows = await query(`SELECT * FROM uav_hms_events ${sn ? 'WHERE device_sn = ?' : ''} ORDER BY event_id DESC LIMIT 200`, sn ? [sn] : []);
        ok(res, rows);
    }));
    router.patch('/hms/:id/ack', asyncHandler(async (req, res) => {
        const id = v.parseId(req.params.id, 'cảnh báo');
        const [row] = await query('SELECT event_id FROM uav_hms_events WHERE event_id = ?', [id]);
        if (!row) throw new NotFoundError('Không tìm thấy cảnh báo HMS');
        await query('UPDATE uav_hms_events SET acknowledged_at = COALESCE(acknowledged_at, NOW()) WHERE event_id = ?', [id]);
        ok(res, { event_id: id });
    }));
    router.get('/live/:ticketId', asyncHandler(async (req, res) => {
        const id = v.parseId(req.params.ticketId, 'phiếu kiểm tra');
        const [ticket] = await query('SELECT ticket_id FROM inspection_tickets WHERE ticket_id = ?', [id]);
        if (!ticket) throw new NotFoundError('Không tìm thấy phiếu kiểm tra');
        ok(res, await monitoring.streams(id));
    }));
    return router;
}
module.exports = { createRouter };
