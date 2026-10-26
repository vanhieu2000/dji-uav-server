/**
 * Nhận ảnh vào hệ thống – dùng chung cho mọi đường vào (Giai đoạn A3):
 *   - DJI Pilot 2 tự tải lên trong lúc bay (S3 giả lập / upload multipart)
 *   - Nhập từ thẻ nhớ qua web
 *   - Quét thư mục ảnh khi khởi động
 * Không gán cứng bất kỳ giá trị nào: vị trí, gimbal, RTK lấy từ XMP trong ảnh;
 * nhiệt độ đọc bằng DJI Thermal SDK; phiếu lấy từ phiên đăng nhập Pilot hoặc người nhập chọn.
 */
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../config/db');
const { readMeta, photoPointFromName } = require('./djiImageMeta');

const MATCH_POINT_RADIUS_M = 2;      // ghép ảnh với điểm chụp gần nhất (cần RTK FIX)
const ACTIVE_SESSION_HOURS = 12;

let thermalParser = null;
function parseThermal(file) {
    // Nạp trễ: thermalParser gọi DJI SDK native, không cần khi chạy test
    if (!thermalParser) thermalParser = require('./thermalParser');
    try { return thermalParser.parseDjiThermalJpeg(file); } catch (e) { return null; }
}

function sha256File(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

/* ---------------- Phiên đăng nhập DJI Pilot 2 ---------------- */

async function startPilotSession({ user, ticketId, rcSn, aircraftSn }) {
    // Một tay điều khiển chỉ có 1 phiên đang mở
    if (rcSn) await query('UPDATE pilot_sessions SET ended_at = NOW() WHERE ended_at IS NULL AND rc_sn = ?', [rcSn]);
    const r = await query(
        'INSERT INTO pilot_sessions (user_id, username, ticket_id, rc_sn, aircraft_sn) VALUES (?, ?, ?, ?, ?)',
        [user && user.user_id ? user.user_id : null, user ? user.username : null, ticketId || null, rcSn || null, aircraftSn || null]
    );
    return r.insertId;
}

/** Phiên đang mở gần nhất (ưu tiên đúng máy bay / tay điều khiển nếu biết). */
async function activeSession(sn) {
    const params = [ACTIVE_SESSION_HOURS];
    let sql = `SELECT * FROM pilot_sessions WHERE ended_at IS NULL AND started_at > NOW() - INTERVAL ? HOUR`;
    if (sn) { sql += ' AND (aircraft_sn = ? OR rc_sn = ?)'; params.push(sn, sn); }
    const rows = await query(`${sql} ORDER BY session_id DESC LIMIT 1`, params);
    if (rows.length || !sn) return rows[0] || null;
    return activeSession(null);
}

/* ---------------- Ghép điểm chụp ---------------- */

async function matchPhotoPoint(fileName, meta) {
    const fromName = photoPointFromName(fileName);
    if (fromName) {
        const rows = await query('SELECT point_id FROM photo_points WHERE point_id = ?', [fromName]);
        if (rows.length) return rows[0].point_id;
    }
    if (meta.position_quality !== 'HIGH') return null; // không đủ chính xác để ghép theo vị trí
    const dLat = MATCH_POINT_RADIUS_M / 111195;
    const dLng = dLat / Math.max(0.1, Math.cos((meta.latitude * Math.PI) / 180));
    const rows = await query(
        `SELECT point_id, latitude, longitude FROM photo_points
         WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?`,
        [meta.latitude - dLat, meta.latitude + dLat, meta.longitude - dLng, meta.longitude + dLng]
    );
    let best = null;
    rows.forEach(r => {
        const dy = (r.latitude - meta.latitude) * 111195;
        const dx = (r.longitude - meta.longitude) * 111195 * Math.cos((meta.latitude * Math.PI) / 180);
        const d = Math.hypot(dx, dy);
        if (d <= MATCH_POINT_RADIUS_M && (!best || d < best.d)) best = { id: r.point_id, d };
    });
    return best ? best.id : null;
}

/* ---------------- Nhận một ảnh ---------------- */

const MEDIA_TYPE = { IR: 'THERMAL_PHOTO', WIDE: 'RGB_PHOTO', ZOOM: 'ZOOM_PHOTO', UNKNOWN: 'RGB_PHOTO' };

/**
 * @param {object} o
 *   localPath    file đã nằm trong thư mục uploads/media
 *   fileName     tên file đã lưu (để tạo URL /uploads/media/<fileName>)
 *   originalName tên gốc (thẻ nhớ / DJI)
 *   source       'CLOUD' | 'SD_IMPORT' | 'MANUAL' | 'DISK_SCAN'
 *   ticketId     phiếu người nhập chọn (ưu tiên hơn phiên Pilot)
 *   routeId, deviceSn, flightId (nếu biết)
 * @returns {Promise<{status: 'created'|'duplicate', media: object}>}
 */
async function ingestFile(o) {
    const stat = fs.statSync(o.localPath);
    const sha = await sha256File(o.localPath);
    const dup = await query('SELECT * FROM media_files WHERE sha256 = ? LIMIT 1', [sha]);
    if (dup.length) return { status: 'duplicate', media: dup[0] };

    const meta = readMeta(o.localPath, o.originalName || o.fileName);
    let thermal = null;
    if (meta.lens === 'IR') thermal = parseThermal(o.localPath);

    const session = o.ticketId ? null : await activeSession(o.deviceSn || null);
    const ticketId = o.ticketId || (session ? session.ticket_id : null);
    const pointId = await matchPhotoPoint(o.originalName || o.fileName, meta);
    const deviceSn = o.deviceSn || (session && session.aircraft_sn) || 'UNKNOWN';

    const row = {
        ticket_id: ticketId,
        device_sn: deviceSn,
        file_name: o.fileName,
        file_url: `/uploads/media/${o.fileName}`,
        file_path_local: o.localPath,
        media_type: MEDIA_TYPE[meta.lens],
        latitude: meta.latitude,
        longitude: meta.longitude,
        altitude: meta.absolute_altitude,
        relative_altitude: meta.relative_altitude,
        gimbal_pitch: meta.gimbal_pitch,
        gimbal_yaw: meta.gimbal_yaw,
        gimbal_roll: meta.gimbal_roll,
        flight_yaw: meta.flight_yaw,
        rtk_flag: meta.rtk_flag,
        rtk_std_m: meta.rtk_std_m,
        position_quality: meta.position_quality,
        lens: meta.lens,
        captured_at: meta.captured_at || stat.mtime,
        max_temperature: thermal ? thermal.maxTemp : null,
        min_temperature: thermal ? thermal.minTemp : null,
        avg_temperature: thermal ? thermal.avgTemp : null,
        thermal_engine: thermal ? thermal.engine : null,
        has_hotspot: 0, // đánh dấu khi có kết quả AI / ngưỡng (Giai đoạn D, G)
        source: o.source || 'CLOUD',
        sha256: sha,
        file_size: stat.size,
        original_name: o.originalName || o.fileName,
        flight_id: o.flightId || null,
        route_id: o.routeId || null,
        photo_point_id: pointId,
        pilot_session_id: session ? session.session_id : null,
        meta_json: JSON.stringify({ ...meta, captured_at: meta.captured_at ? meta.captured_at.toISOString() : null })
    };
    const cols = Object.keys(row);
    const r = await query(
        `INSERT INTO media_files (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => row[c])
    );
    return { status: 'created', media: { media_id: r.insertId, ...row, meta_json: undefined } };
}

/** Upload callback của DJI: gắn mã chuyến bay cho ảnh theo tên file. */
async function attachFlightId(fileName, flightId) {
    if (!fileName || !flightId) return 0;
    const r = await query('UPDATE media_files SET flight_id = ? WHERE (file_name = ? OR original_name = ?) AND flight_id IS NULL', [String(flightId).slice(0, 64), fileName, fileName]);
    return r.affectedRows || 0;
}

module.exports = { ingestFile, startPilotSession, activeSession, attachFlightId, sha256File };
