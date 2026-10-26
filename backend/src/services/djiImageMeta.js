/**
 * Đọc thông tin chụp mà DJI ghi trong ảnh (khối XMP, namespace drone-dji) – Giai đoạn A3.
 * Ảnh M3T (cả ảnh nhiệt R-JPEG và ảnh thường) đều có khối này:
 *   GpsLatitude / GpsLongitude (bản cũ viết sai "GpsLongtitude"), AbsoluteAltitude, RelativeAltitude,
 *   GimbalRoll/Yaw/PitchDegree, FlightRoll/Yaw/PitchDegree, RtkFlag (50 = RTK FIX), RtkStdLon/Lat/Hgt (m),
 *   ImageSource (InfraredCamera / WideCamera / ZoomCamera), xmp:CreateDate.
 * Chỉ đọc phần đầu file (XMP nằm trong APP1, trước dữ liệu ảnh) nên nhanh với ảnh 20 MB.
 */
const fs = require('fs');

const HEAD_BYTES = 512 * 1024;
const RTK_FIX = 50;

/** Đọc giá trị một khóa XMP, dạng thuộc tính  drone-dji:Key="v"  hoặc thẻ  <drone-dji:Key>v</drone-dji:Key>. */
function xmpValue(xmp, key) {
    const attr = new RegExp(`${key}="([^"]*)"`).exec(xmp);
    if (attr) return attr[1];
    const tag = new RegExp(`<${key}>([^<]*)</${key}>`).exec(xmp);
    return tag ? tag[1] : null;
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
}

/** Ống kính từ ImageSource hoặc đuôi tên file DJI (_T nhiệt, _W rộng, _Z zoom, _V video). */
function lensOf(imageSource, fileName) {
    const src = String(imageSource || '').toLowerCase();
    if (src.includes('infrared') || src.includes('thermal')) return 'IR';
    if (src.includes('zoom')) return 'ZOOM';
    if (src.includes('wide') || src.includes('visible')) return 'WIDE';
    const m = /_(T|W|Z|V|S)(?:[_.]|$)/i.exec(String(fileName || ''));
    if (m) return { T: 'IR', W: 'WIDE', Z: 'ZOOM' }[m[1].toUpperCase()] || 'UNKNOWN';
    return 'UNKNOWN';
}

/** Chất lượng vị trí: HIGH khi RTK FIX, LOW khi có GPS nhưng không FIX, UNKNOWN khi không có tọa độ. */
function positionQuality(meta) {
    if (meta.latitude == null || meta.longitude == null) return 'UNKNOWN';
    return meta.rtk_flag === RTK_FIX ? 'HIGH' : 'LOW';
}

/** "2026:10:26 10:15:30" hoặc ISO → Date; null nếu không đọc được. */
function parseDate(s) {
    if (!s) return null;
    const iso = String(s).trim().replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T');
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Tách XMP từ buffer phần đầu file. */
function extractXmp(buf) {
    const s = buf.toString('latin1');
    const start = s.indexOf('<x:xmpmeta');
    if (start < 0) return null;
    const end = s.indexOf('</x:xmpmeta>', start);
    if (end < 0) return null;
    return Buffer.from(s.slice(start, end + 12), 'latin1').toString('utf8');
}

/**
 * Đọc metadata từ buffer hoặc đường dẫn file.
 * @returns {object} các trường đã chuẩn hóa (null khi thiếu) + has_xmp
 */
function readMetaFromBuffer(buf, fileName) {
    const xmp = extractXmp(buf);
    const g = k => (xmp ? xmpValue(xmp, `drone-dji:${k}`) : null);
    const meta = {
        has_xmp: Boolean(xmp),
        latitude: num(g('GpsLatitude')),
        longitude: num(g('GpsLongitude') ?? g('GpsLongtitude')),
        absolute_altitude: num(g('AbsoluteAltitude')),
        relative_altitude: num(g('RelativeAltitude')),
        gimbal_pitch: num(g('GimbalPitchDegree')),
        gimbal_yaw: num(g('GimbalYawDegree')),
        gimbal_roll: num(g('GimbalRollDegree')),
        flight_yaw: num(g('FlightYawDegree')),
        rtk_flag: num(g('RtkFlag')),
        rtk_std_lat: num(g('RtkStdLat')),
        rtk_std_lon: num(g('RtkStdLon')),
        rtk_std_hgt: num(g('RtkStdHgt')),
        image_source: g('ImageSource'),
        captured_at: parseDate(xmp ? (xmpValue(xmp, 'xmp:CreateDate') || xmpValue(xmp, 'exif:DateTimeOriginal')) : null)
    };
    // 0,0 = máy bay chưa có GPS
    if (meta.latitude === 0 && meta.longitude === 0) { meta.latitude = null; meta.longitude = null; }
    meta.lens = lensOf(meta.image_source, fileName);
    meta.position_quality = positionQuality(meta);
    const stds = [meta.rtk_std_lat, meta.rtk_std_lon].filter(v => v != null);
    meta.rtk_std_m = stds.length ? Math.max(...stds) : null;
    return meta;
}

function readMeta(filePath, fileName) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(HEAD_BYTES);
        const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
        return readMetaFromBuffer(buf.subarray(0, n), fileName || filePath);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Hậu tố tên file do đường bay đặt (fileSuffix trong KMZ): "D12_34" = DCL 12, điểm chụp 34.
 * Trả point_id hoặc null.
 */
function photoPointFromName(fileName) {
    // Vị trí hậu tố so với _T/_W/_Z có thể khác nhau tùy firmware → tìm ở bất kỳ đâu trong tên
    const m = /_([CDP])(\d+)_(\d+)(?=[_.])/i.exec(String(fileName || ''));
    return m ? Number(m[3]) : null;
}

module.exports = { readMeta, readMetaFromBuffer, lensOf, photoPointFromName, RTK_FIX };
