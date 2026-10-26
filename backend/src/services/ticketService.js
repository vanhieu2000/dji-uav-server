/**
 * Truy vấn phiếu kiểm tra từ MySQL (nguồn dữ liệu duy nhất cho Web và Pilot 2).
 */
const { query } = require('../config/db');

const ACTIVE_STATUSES = ['PENDING', 'ASSIGNED', 'EXECUTING'];

const TICKET_SELECT = `
    SELECT t.ticket_id, t.ticket_code, t.ticket_name, t.inspection_type, t.target_facility,
           t.status, t.assigned_route_id, t.assigned_device_sn, t.livestream_channel,
           r.route_name
    FROM inspection_tickets t
    LEFT JOIN flight_routes r ON t.assigned_route_id = r.route_id
`;

function normalizeTicket(row) {
    if (!row) return null;
    return {
        ...row,
        livestream_channel: `ticket_${row.ticket_id}`
    };
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

module.exports = { listActiveTickets, findTicketById, ACTIVE_STATUSES };
