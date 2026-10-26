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
const { resolveAssignment } = require('./mediaAssignment');
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
        'INSERT INTO pilot_sessions (user_id, username, ticket_id, rc_sn, aircraft_sn, upload_namespace) VALUES (?, ?, ?, ?, ?, ?)',
        [user && user.user_id ? user.user_id : null, user ? user.username : null, ticketId || null, rcSn || null, aircraftSn || null, crypto.randomUUID()]
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
    return null;
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
const ingestChains=new Map();
async function ingestFile(o) {
    const stat=fs.statSync(o.localPath),sha=await sha256File(o.localPath);
    const work=(ingestChains.get(sha)||Promise.resolve()).then(()=>ingestUnique(o,sha,stat));
    const tail=work.then(()=>{},()=>{});ingestChains.set(sha,tail);
    try{return await work;}finally{if(ingestChains.get(sha)===tail)ingestChains.delete(sha);}
}
async function ingestUnique(o,sha,stat){
    const dup=await query('SELECT * FROM media_files WHERE sha256 = ? LIMIT 1',[sha]);
    if(dup.length){
        const m=dup[0];
        if(!m.file_path_local||!fs.existsSync(m.file_path_local)){
            await query('UPDATE media_files SET file_path_local=?,file_name=?,file_url=?,file_size=? WHERE media_id=?',[o.localPath,o.fileName,'/uploads/media/'+o.fileName,stat.size,m.media_id]);
            if(m.ticket_id)await query('UPDATE inspection_tickets SET reconciled_at=NULL WHERE ticket_id=?',[m.ticket_id]);
            return {status:'duplicate',restored:true,media:{...m,file_path_local:o.localPath,file_name:o.fileName,file_url:'/uploads/media/'+o.fileName,file_size:stat.size}};
        }
        return {status:'duplicate',media:m};
    }

    const meta = readMeta(o.localPath, o.originalName || o.fileName);
    let thermal = null;
    if (meta.lens === 'IR') thermal = parseThermal(o.localPath);

    const assignment = await resolveAssignment(query, o, meta);
    const ticketId = assignment.ticketId;
    const pointId = await matchPhotoPoint(o.originalName || o.fileName, meta);
    const deviceSn = assignment.deviceSn;

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
        pilot_session_id: assignment.pilotSessionId,
        flight_session_id: assignment.flightSessionId,
        assignment_status: assignment.status,
        meta_json: JSON.stringify({ ...meta, captured_at: meta.captured_at ? meta.captured_at.toISOString() : null })
    };
    const cols = Object.keys(row);
    const r = await query(
        `INSERT INTO media_files (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => row[c])
    );
    if (ticketId) await query('UPDATE inspection_tickets SET reconciled_at=NULL WHERE ticket_id=?',[ticketId]);
    return { status: 'created', media: { media_id: r.insertId, ...row, meta_json: undefined } };
}

/**
 * Làm sạch ảnh nhận bằng code cũ (trước Giai đoạn A3), nhận biết qua sha256 trống.
 * Code cũ gán cứng tọa độ / nhiệt độ / camera. Còn file: đọc lại giá trị thật từ file.
 * Mất file: xóa tọa độ và nhiệt độ giả (để trống). Phiếu cũ giữ nguyên (không biết phiếu đúng).
 * @returns {Promise<{fixed: number, missing: number}>}
 */
async function backfillLegacy() {
    const rows = await query('SELECT media_id, file_name, file_path_local, media_type FROM media_files WHERE sha256 IS NULL');
    let fixed = 0;
    let missing = 0;
    const LENS_FROM_TYPE = { THERMAL_PHOTO: 'IR', RGB_PHOTO: 'WIDE', ZOOM_PHOTO: 'ZOOM' };
    for (const r of rows) {
        const file = r.file_path_local;
        if (!file || !fs.existsSync(file)) {
            await query(
                `UPDATE media_files SET latitude = NULL, longitude = NULL, altitude = NULL, max_temperature = NULL, has_hotspot = 0,
                    lens = ?, position_quality = 'UNKNOWN', meta_json = ? WHERE media_id = ?`,
                [LENS_FROM_TYPE[r.media_type] || 'UNKNOWN', JSON.stringify({ legacy_missing_file: true }), r.media_id]
            );
            missing += 1;
            continue;
        }
        const meta = readMeta(file, r.file_name);
        const thermal = meta.lens === 'IR' ? parseThermal(file) : null;
        const stat = fs.statSync(file);
        await query(
            `UPDATE media_files SET latitude = ?, longitude = ?, altitude = ?, relative_altitude = ?, gimbal_pitch = ?, gimbal_yaw = ?,
                gimbal_roll = ?, flight_yaw = ?, rtk_flag = ?, rtk_std_m = ?, position_quality = ?, lens = ?, media_type = ?,
                max_temperature = ?, min_temperature = ?, avg_temperature = ?, thermal_engine = ?, has_hotspot = 0,
                sha256 = ?, file_size = ?, original_name = COALESCE(original_name, file_name), meta_json = ?
             WHERE media_id = ?`,
            [meta.latitude, meta.longitude, meta.absolute_altitude, meta.relative_altitude, meta.gimbal_pitch, meta.gimbal_yaw,
                meta.gimbal_roll, meta.flight_yaw, meta.rtk_flag, meta.rtk_std_m, meta.position_quality, meta.lens, MEDIA_TYPE[meta.lens],
                thermal ? thermal.maxTemp : null, thermal ? thermal.minTemp : null, thermal ? thermal.avgTemp : null, thermal ? thermal.engine : null,
                await sha256File(file), stat.size, JSON.stringify({ ...meta, captured_at: meta.captured_at ? meta.captured_at.toISOString() : null, legacy_backfill: true }),
                r.media_id]
        );
        fixed += 1;
    }
    return { fixed, missing };
}

/** Upload callback của DJI: gắn mã chuyến bay cho ảnh theo tên file. */
async function attachFlightId(fileName, flightId) {
    if (!fileName || !flightId) return 0;
    const r = await query('UPDATE media_files SET flight_id = ? WHERE (file_name = ? OR original_name = ?) AND flight_id IS NULL', [String(flightId).slice(0, 64), fileName, fileName]);
    return r.affectedRows || 0;
}

module.exports = { ingestFile, startPilotSession, activeSession, attachFlightId, sha256File, backfillLegacy };
