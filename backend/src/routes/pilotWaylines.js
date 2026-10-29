/**
 * Thư viện đường bay cho DJI Pilot 2 (Cloud API – Wayline management), đọc từ MySQL (Giai đoạn B3).
 *   GET  /wayline/api/v1/workspaces/:ws/waylines              danh sách (tuyến của phiếu đang bay)
 *   GET  /wayline/api/v1/workspaces/:ws/waylines/:id          chi tiết
 *   GET  /wayline/api/v1/workspaces/:ws/waylines/:id/url      chuyển hướng 302 tới file KMZ (?format=json → {url, md5})
 *   GET  /wayline/api/v1/workspaces/:ws/waylines/:id/download tải KMZ
 *   (cùng các đường /manage/api/v1/... cũ)
 * Phiếu đang bay lấy từ phiên đăng nhập Pilot (token x-auth-token → người dùng → phiên mới nhất).
 * Phiếu chưa gán tuyến nào: trả cả thư viện để không chặn phi công.
 * Mã tuyến = route_uuid cố định; không có thì 404 (không đoán "tuyến đầu tiên").
 */
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler } = require('../utils/http');
const routeLibrary = require('../services/routeLibrary');
const ticketRoutes = require('../services/ticketRoutes');
const { decodeToken } = require('./auth');

const DRONE_MODEL_KEY = '0-77-1';     // Mavic 3 Enterprise (M3T)
const PAYLOAD_MODEL_KEYS = ['1-67-0']; // camera M3T
const BASES = ['/wayline/api/v1/workspaces/:workspace_id/waylines', '/manage/api/v1/workspaces/:workspace_id/waylines'];
const paths = suffix => BASES.map(b => b + suffix);

/** Phiên Pilot của người gửi request (theo token), không có thì phiên mới nhất còn mở. */
async function sessionOf(req) {
    if(req.pilotSession)return req.pilotSession;
    const user = decodeToken(req.get('x-auth-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    const base = 'SELECT * FROM pilot_sessions WHERE ended_at IS NULL AND started_at > NOW() - INTERVAL 12 HOUR';
    if(user && user.pilot_session_id){
        const rows=await query('SELECT * FROM pilot_sessions WHERE session_id=? AND user_id=? AND ended_at IS NULL',[user.pilot_session_id,user.user_id]);
        return rows[0]||null;
    }
    if (user && user.user_id) {
        const rows = await query(`${base} AND user_id = ? ORDER BY session_id DESC LIMIT 1`, [user.user_id]);
        if (rows.length) return rows[0];
    }
    const rows = await query(`${base} ORDER BY session_id DESC LIMIT 1`);
    return rows[0] || null;
}

function toWayline(r) {
    const t = new Date(r.updated_at || r.created_at || Date.now()).getTime();
    return {
        id: r.route_uuid,
        name: r.route_name,
        drone_model_key: DRONE_MODEL_KEY,
        payload_model_keys: PAYLOAD_MODEL_KEYS,
        template_types: [0],
        update_time: t,
        create_time: new Date(r.created_at || Date.now()).getTime(),
        user_name: 'dji-uav-server',
        favorited: false
    };
}

const notFound = res => res.status(404).json({ code: 404, message: 'Không tìm thấy đường bay' });

router.get(paths(''), asyncHandler(async (req, res) => {
    const session = await sessionOf(req);
    let rows = session && session.ticket_id ? await ticketRoutes.routesOfTicket(session.ticket_id) : [];
    const scope = rows.length ? `phiếu ${session.ticket_id}` : 'cả thư viện';
    if (!rows.length && (!req.pilotSession || (session?.ticket_id==null&&require('../services/authorization').allScopes(req.user)))) {
        rows = await query('SELECT route_id, route_uuid, route_name, created_at, updated_at FROM flight_routes WHERE route_uuid IS NOT NULL ORDER BY route_id DESC LIMIT 500');
    }
    const key = String(req.query.key || '').trim().toLowerCase();
    if (key) rows = rows.filter(r => r.route_name.toLowerCase().includes(key));
    const pageSize = Math.min(Math.max(parseInt(req.query.page_size, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const list = rows.slice((page - 1) * pageSize, page * pageSize).map(toWayline);
    console.log(`[Wayline] Pilot 2 lấy ${list.length} tuyến (${scope})`);
    res.json({
        code: 0, message: 'success',
        data: { list, pagination: { page, page_size: pageSize, total: rows.length, total_page: Math.max(1, Math.ceil(rows.length / pageSize)) } }
    });
}));

router.get(paths('/duplicate-names'), (req, res) => res.json({ code: 0, message: 'success', data: [] }));

router.get(paths('/:wayline_id'), asyncHandler(async (req, res) => {
    const r = await routeLibrary.findRoute(req.params.wayline_id);
    if (!r || !r.route_uuid) return notFound(res);
    res.json({ code: 0, message: 'success', data: toWayline(r) });
}));

router.get(paths('/:wayline_id/url'), asyncHandler(async (req, res) => {
    const r = await routeLibrary.findRoute(req.params.wayline_id);
    if (!r || !fs.existsSync(routeLibrary.kmzPath(r))) return notFound(res);
    // URL tĩnh kết thúc bằng .kmz để trình tải của Pilot 2 nhận đúng loại file
    const filePath='/uploads/waylines/'+encodeURIComponent(r.kmz_file_name);
    const signed=req.user?require('../services/signedDownloads').sign(filePath,req.user):filePath;
    const url = `${req.protocol}://${req.get('host')}${signed}`;
    if (req.query.format === 'json') {
        return res.json({ code: 0, message: 'success', data: { url, md5: r.kmz_md5 || routeLibrary.md5File(routeLibrary.kmzPath(r)) } });
    }
    res.redirect(302, url);
}));

router.get(paths('/:wayline_id/download'), asyncHandler(async (req, res) => {
    const r = await routeLibrary.findRoute(req.params.wayline_id);
    if (!r) return notFound(res);
    const file = routeLibrary.kmzPath(r);
    if (!fs.existsSync(file)) return notFound(res);
    res.set({ 'Content-Type': 'application/vnd.google-earth.kmz' });
    res.download(file, r.kmz_file_name);
}));

router.post('/wayline/api/v1/workspaces/:workspace_id/upload-callback', (req, res) => {
    res.json({ code: 0, message: 'success' });
});

module.exports = router;
module.exports.sessionOf = sessionOf;
