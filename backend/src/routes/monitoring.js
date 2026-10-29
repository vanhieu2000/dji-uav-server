const express = require('express');
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const v = require('../utils/validate');

function createRouter({ monitoring, getLiveDevices }) {
    const router = express.Router();
    router.get('/config',(req,res)=>ok(res,{device_mode:process.env.UAV_DEVICE_MODE==='multi'?'multi':'single',default_device_sn:process.env.UAV_DEFAULT_SN||null}));
    router.get('/devices', asyncHandler(async (req, res) => {
        const ticket = v.isBlank(req.query.ticket_id) ? null : v.parseId(req.query.ticket_id, 'phiếu kiểm tra');
        const rows = await query(`SELECT d.device_sn, d.device_name, d.gateway_sn, d.last_latitude AS lat,
            d.last_longitude AS lng, d.last_altitude AS alt, d.last_relative_height AS rel_alt, d.last_yaw AS yaw,
            d.last_battery AS battery, d.rtk_state, d.last_seen,
            d.status,
            f.flight_session_id, f.ticket_id, t.ticket_code
            FROM uav_devices d LEFT JOIN flight_sessions f ON f.flight_session_id =
                (SELECT MAX(f2.flight_session_id) FROM flight_sessions f2 WHERE f2.device_sn = d.device_sn AND f2.ended_at IS NULL)
            LEFT JOIN inspection_tickets t ON t.ticket_id = f.ticket_id
            WHERE d.device_type = 'DRONE' ${ticket ? 'AND f.ticket_id = ?' : ''} ORDER BY d.device_sn`, ticket ? [ticket] : []);
        const live = (typeof getLiveDevices === 'function' ? getLiveDevices() : null) || {};
        const now = Date.now();
        const merged = rows.map(r => {
            const dev = live[r.device_sn];
            const liveSeen = dev?.last_seen ? new Date(dev.last_seen).getTime() : 0;
            const dbSeen = r.last_seen ? new Date(r.last_seen).getTime() : 0;
            const latestSeen = Math.max(liveSeen, dbSeen);
            const isOnline = (now - latestSeen < 35000) && (dev?.status !== 'OFFLINE');
            return {
                ...r,
                battery: dev?.battery != null ? dev.battery : r.battery,
                lat: dev?.lat != null ? dev.lat : r.lat,
                lng: dev?.lng != null ? dev.lng : r.lng,
                alt: dev?.alt != null ? dev.alt : r.alt,
                rel_alt: dev?.rel_alt != null ? dev.rel_alt : r.rel_alt,
                last_seen: latestSeen ? new Date(latestSeen) : r.last_seen,
                status: isOnline ? 'ONLINE' : 'OFFLINE'
            };
        });
        for (const [sn, d] of Object.entries(live)) {
            if (!merged.find(r => r.device_sn === sn)) {
                const liveSeen = d?.last_seen ? new Date(d.last_seen).getTime() : 0;
                const isOnline = (now - liveSeen < 35000) && (d.status !== 'OFFLINE');
                merged.push({
                    device_sn: sn,
                    device_name: d.device_name || `DJI Mavic 3T (${sn})`,
                    gateway_sn: d.gateway_sn || null,
                    lat: d.lat || null,
                    lng: d.lng || null,
                    alt: d.alt || null,
                    rel_alt: d.rel_alt || null,
                    battery: d.battery != null ? d.battery : null,
                    last_seen: d.last_seen || new Date(),
                    status: isOnline ? 'ONLINE' : 'OFFLINE'
                });
            }
        }
        ok(res, merged);
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
        const rows=await monitoring.streams(id);
        ok(res,req.user?rows.map(r=>require('../services/streamAccess').playback(r,req.user)):rows);
    }));
    return router;
}
module.exports = { createRouter };
