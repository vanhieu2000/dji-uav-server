/**
 * Thư viện đường bay trong MySQL (Giai đoạn B) – nguồn duy nhất cho dashboard và DJI Pilot 2.
 * Thay cho memoryStore.routes + quét thư mục mỗi lần gọi (mã tuyến tính từ tên file,
 * không tìm thấy thì trả "tuyến đầu tiên" – dễ nạp nhầm tuyến).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');

const WAYLINE_DIR = process.env.WAYLINE_DIR || path.join(__dirname, '..', '..', 'uploads', 'waylines');

function md5File(file) {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

/** Tên hiển thị từ tên file KMZ cũ: DJI_Mission_1700000000_Quet_A.kmz → "Quet A". */
function nameFromFile(fileName) {
    return path.basename(fileName, '.kmz').replace(/^DJI_Mission_\d+_/, '').replace(/_/g, ' ').trim() || fileName;
}

/**
 * Đưa file KMZ có trong thư mục nhưng chưa có trong DB vào thư viện (kiểu MANUAL).
 * @returns {Promise<number>} số tuyến vừa thêm
 */
async function importDiskKmz() {
    if (!fs.existsSync(WAYLINE_DIR)) return 0;
    const files = fs.readdirSync(WAYLINE_DIR).filter(f => /\.kmz$/i.test(f));
    if (!files.length) return 0;
    const known = new Set((await query('SELECT kmz_file_name FROM flight_routes')).map(r => r.kmz_file_name));
    let added = 0;
    for (const f of files) {
        if (known.has(f)) continue;
        const full = path.join(WAYLINE_DIR, f);
        await query(
            `INSERT INTO flight_routes (route_name, route_type, kmz_file_name, kmz_file_path, route_uuid, route_kind, kmz_md5, description)
             VALUES (?, 'CUSTOM', ?, ?, UUID(), 'MANUAL', ?, 'Nhập từ thư mục uploads/waylines')`,
            [nameFromFile(f), f, full, md5File(full)]
        );
        added += 1;
    }
    return added;
}

/** Thêm 1 file KMZ (tải lên / vẽ tay) vào thư viện. File phải nằm sẵn trong WAYLINE_DIR. */
async function addKmz({ fileName, routeName, kind = 'MANUAL', waypointCount = null, altitude = null, description = null }) {
    const full = path.join(WAYLINE_DIR, path.basename(fileName));
    const r = await query(
        `INSERT INTO flight_routes (route_name, route_type, kmz_file_name, kmz_file_path, waypoint_count, route_uuid, route_kind, kmz_md5, altitude_m, description)
         VALUES (?, 'CUSTOM', ?, ?, ?, UUID(), ?, ?, ?, ?)`,
        [routeName, path.basename(fileName), full, waypointCount, kind, md5File(full), altitude, description]
    );
    const rows = await query('SELECT * FROM flight_routes WHERE route_id = ?', [r.insertId]);
    return rows[0];
}

/** Tìm tuyến theo mã cố định (route_uuid, dùng cho Pilot 2) hoặc số route_id. Không đoán "tuyến đầu tiên". */
async function findRoute(idOrUuid) {
    const s = String(idOrUuid || '').trim();
    if (!s) return null;
    const rows = /^\d+$/.test(s)
        ? await query('SELECT * FROM flight_routes WHERE route_id = ?', [Number(s)])
        : await query('SELECT * FROM flight_routes WHERE route_uuid = ?', [s]);
    return rows[0] || null;
}

function kmzPath(route) {
    return path.join(WAYLINE_DIR, path.basename(route.kmz_file_name));
}

const UNSAFE_PREFIX = '⚠ ';
const UNSAFE_NOTE = '⚠ Độ cao trong file tính theo mực nước biển (EGM96/WGS84), không phải so với điểm cất cánh – tạo lại tuyến trước khi bay.';

/** Kiểu độ cao trong file KMZ: 'relativeToStartPoint' | 'EGM96' | 'WGS84' | ... | null nếu không đọc được. */
function kmzHeightMode(file) {
    try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(file);
        const entry = zip.getEntries().find(e => /waylines\.wpml$/i.test(e.entryName));
        if (!entry) return null;
        const m = /<wpml:executeHeightMode>([^<]+)<\/wpml:executeHeightMode>/.exec(entry.getData().toString('utf8'));
        return m ? m[1].trim() : null;
    } catch (e) {
        return null;
    }
}

/**
 * Gắn nhãn cảnh báo cho tuyến có độ cao theo mực nước biển (tuyến do code cũ sinh ra: EGM96 30 m).
 * Chỉ kiểm tra tuyến vẽ tay / nhập từ thư mục (tuyến sinh từ hồ sơ chụp luôn dùng relativeToStartPoint).
 * @returns {Promise<number>} số tuyến vừa gắn nhãn
 */
async function flagUnsafeHeight() {
    const rows = await query("SELECT route_id, route_name, kmz_file_name FROM flight_routes WHERE route_kind = 'MANUAL'");
    let flagged = 0;
    for (const r of rows) {
        if (r.route_name.startsWith(UNSAFE_PREFIX)) continue;
        const file = path.join(WAYLINE_DIR, path.basename(r.kmz_file_name));
        if (!fs.existsSync(file)) continue;
        const mode = kmzHeightMode(file);
        if (mode && mode !== 'relativeToStartPoint') {
            await query('UPDATE flight_routes SET route_name = ?, description = ? WHERE route_id = ?',
                [(UNSAFE_PREFIX + r.route_name).slice(0, 150), `${UNSAFE_NOTE} (executeHeightMode=${mode})`, r.route_id]);
            flagged += 1;
        }
    }
    return flagged;
}

module.exports = { WAYLINE_DIR, importDiskKmz, addKmz, findRoute, kmzPath, md5File, nameFromFile, kmzHeightMode, flagUnsafeHeight };
