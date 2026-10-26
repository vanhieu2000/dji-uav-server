/**
 * Truy vấn phiếu kiểm tra từ MySQL (nguồn dữ liệu duy nhất cho Web và Pilot 2).
 */
const { query } = require('../config/db');

const ACTIVE_STATUSES = ['PENDING', 'ASSIGNED', 'EXECUTING'];
const DEFAULT_LIVE_CHANNEL = 'm3t_live';

const TICKET_SELECT = `
    SELECT t.ticket_id, t.ticket_code, t.ticket_name, t.inspection_type, t.target_facility,
           t.status, t.assigned_route_id, t.assigned_device_sn, t.livestream_channel,
           r.route_name
    FROM inspection_tickets t
    LEFT JOIN flight_routes r ON t.assigned_route_id = r.route_id
`;

/** Kênh live mặc định của phiếu: "pkt_" + mã phiếu (chỉ chữ, số, _ -), để mỗi phiếu xem luồng riêng. */
function channelForTicket(row) {
    // 'm3t_live' là kênh chung cũ (mọi phiếu dùng chung) → coi như chưa đặt
    if (row.livestream_channel && row.livestream_channel !== DEFAULT_LIVE_CHANNEL) return row.livestream_channel;
    const code = String(row.ticket_code || row.ticket_id || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return code ? `pkt_${code}`.slice(0, 100) : DEFAULT_LIVE_CHANNEL;
}

function normalizeTicket(row) {
    if (!row) return null;
    return {
        ...row,
        livestream_channel: channelForTicket(row)
    };
}

/** Tìm phiếu theo tên kênh live (kênh lưu trong CSDL hoặc kênh mặc định sinh từ mã phiếu). */
async function findTicketByChannel(channel) {
    if (!channel) return null;
    const rows = await query(`${TICKET_SELECT} ORDER BY t.ticket_id DESC LIMIT 1000`);
    return rows.map(normalizeTicket).find(t => t.livestream_channel === channel) || null;
}

/** Phiếu đang chờ hoặc đang thực hiện, mới nhất lên đầu. */
async function listActiveTickets(limit = 50) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const rows = await query(
        `${TICKET_SELECT} WHERE t.status IN (${placeholders}) ORDER BY t.ticket_id DESC LIMIT ${safeLimit}`,
        ACTIVE_STATUSES
    );
    return rows.map(normalizeTicket);
}

async function findTicketById(ticketId) {
    const id = parseInt(ticketId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    const rows = await query(`${TICKET_SELECT} WHERE t.ticket_id = ? LIMIT 1`, [id]);
    return normalizeTicket(rows[0]);
}

module.exports = { listActiveTickets, findTicketById, findTicketByChannel, channelForTicket, ACTIVE_STATUSES, DEFAULT_LIVE_CHANNEL };
