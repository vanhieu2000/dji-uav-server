/**
 * Liên kết phiếu kiểm tra ↔ đường bay (Giai đoạn B2).
 * Giữ inspection_tickets.assigned_route_id = tuyến đầu tiên của phiếu (tương thích báo cáo cũ).
 */
const { query } = require('../config/db');
const v = require('../utils/validate');
const { NotFoundError } = require('../utils/http');

async function syncAssigned(ticketId) {
    await query(
        `UPDATE inspection_tickets SET assigned_route_id =
            (SELECT route_id FROM ticket_routes WHERE ticket_id = ? ORDER BY sort_order, assigned_at LIMIT 1)
         WHERE ticket_id = ?`,
        [ticketId, ticketId]
    );
}

async function assertExists(ticketId, routeId) {
    const [t] = await query('SELECT ticket_id FROM inspection_tickets WHERE ticket_id = ?', [ticketId]);
    if (!t) throw new NotFoundError('Không tìm thấy phiếu kiểm tra');
    if (routeId != null) {
        const [r] = await query('SELECT route_id FROM flight_routes WHERE route_id = ?', [routeId]);
        if (!r) throw new NotFoundError('Không tìm thấy đường bay');
    }
}

async function addRoute(ticketIdRaw, routeIdRaw) {
    const ticketId = v.parseId(ticketIdRaw, 'phiếu kiểm tra');
    const routeId = v.parseId(routeIdRaw, 'đường bay');
    await assertExists(ticketId, routeId);
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM ticket_routes WHERE ticket_id = ?', [ticketId]);
    await query('INSERT IGNORE INTO ticket_routes (ticket_id, route_id, sort_order) VALUES (?, ?, ?)', [ticketId, routeId, Number(n)]);
    await syncAssigned(ticketId);
}

async function removeRoute(ticketIdRaw, routeIdRaw) {
    const ticketId = v.parseId(ticketIdRaw, 'phiếu kiểm tra');
    const routeId = v.parseId(routeIdRaw, 'đường bay');
    await query('DELETE FROM ticket_routes WHERE ticket_id = ? AND route_id = ?', [ticketId, routeId]);
    await syncAssigned(ticketId);
}

/** Thay toàn bộ danh sách tuyến của phiếu (theo thứ tự gửi lên). */
async function setRoutes(ticketIdRaw, routeIdsRaw) {
    const ticketId = v.parseId(ticketIdRaw, 'phiếu kiểm tra');
    if (!Array.isArray(routeIdsRaw)) throw new v.ValidationError('route_ids phải là danh sách');
    const ids = [...new Set(routeIdsRaw.map(x => v.parseId(x, 'đường bay')))];
    await assertExists(ticketId, null);
    if (ids.length) {
        const rows = await query(`SELECT route_id FROM flight_routes WHERE route_id IN (${ids.map(() => '?').join(', ')})`, ids);
        if (rows.length !== ids.length) throw new v.ValidationError('Có đường bay không tồn tại');
    }
    await query('DELETE FROM ticket_routes WHERE ticket_id = ?', [ticketId]);
    for (let i = 0; i < ids.length; i += 1) {
        await query('INSERT INTO ticket_routes (ticket_id, route_id, sort_order) VALUES (?, ?, ?)', [ticketId, ids[i], i]);
    }
    await syncAssigned(ticketId);
    return ids;
}

/** Các tuyến của phiếu (theo thứ tự). */
async function routesOfTicket(ticketId) {
    return query(
        `SELECT r.route_id, r.route_uuid, r.route_name, r.route_kind, r.kmz_file_name, r.kmz_md5, r.waypoint_count,
                r.altitude_m, r.photo_count, r.duration_s, r.created_at, r.updated_at, tr.sort_order
         FROM ticket_routes tr JOIN flight_routes r ON tr.route_id = r.route_id
         WHERE tr.ticket_id = ? ORDER BY tr.sort_order, tr.assigned_at`,
        [ticketId]
    );
}

/** Gọi khi xóa hẳn một đường bay: các phiếu đang dùng nó chuyển "tuyến đầu tiên" sang tuyến còn lại. */
async function ticketsOfRoute(routeId) {
    return (await query('SELECT ticket_id FROM ticket_routes WHERE route_id = ?', [routeId])).map(r => r.ticket_id);
}

module.exports = { addRoute, removeRoute, setRoutes, routesOfTicket, ticketsOfRoute, syncAssigned };
