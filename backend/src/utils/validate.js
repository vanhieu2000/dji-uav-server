/**
 * Kiểm tra dữ liệu đầu vào của API. Mỗi hàm trả về giá trị đã chuẩn hóa
 * hoặc ném ValidationError (router chuyển thành HTTP 400).
 */

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400;
    }
}

function isBlank(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Chuỗi bắt buộc, cắt khoảng trắng, giới hạn độ dài. */
function requiredString(value, label, maxLen = 150) {
    if (isBlank(value)) throw new ValidationError(`Thiếu ${label}`);
    const s = String(value).trim();
    if (s.length > maxLen) throw new ValidationError(`${label} dài quá ${maxLen} ký tự`);
    return s;
}

/** Chuỗi không bắt buộc: trả null nếu trống. */
function optionalString(value, label, maxLen = 255) {
    if (isBlank(value)) return null;
    const s = String(value).trim();
    if (s.length > maxLen) throw new ValidationError(`${label} dài quá ${maxLen} ký tự`);
    return s;
}

/** Số không bắt buộc, có kiểm tra khoảng. Chấp nhận dấu phẩy thập phân (1,5). */
function optionalNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
    if (isBlank(value)) return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
    if (!Number.isFinite(n)) throw new ValidationError(`${label} phải là số`);
    if (n < min || n > max) throw new ValidationError(`${label} phải trong khoảng ${min} – ${max}`);
    return n;
}

function requiredNumber(value, label, range) {
    const n = optionalNumber(value, label, range);
    if (n === null) throw new ValidationError(`Thiếu ${label}`);
    return n;
}

function optionalInt(value, label, range) {
    const n = optionalNumber(value, label, range);
    if (n === null) return null;
    if (!Number.isInteger(n)) throw new ValidationError(`${label} phải là số nguyên`);
    return n;
}

function requiredInt(value, label, range) {
    const n = optionalInt(value, label, range);
    if (n === null) throw new ValidationError(`Thiếu ${label}`);
    return n;
}

/** ID trên URL: số nguyên dương. */
function parseId(value, label = 'ID') {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${label} không hợp lệ`);
    return n;
}

const optionalLat = (v, label = 'Vĩ độ') => optionalNumber(v, label, { min: -90, max: 90 });
const optionalLng = (v, label = 'Kinh độ') => optionalNumber(v, label, { min: -180, max: 180 });

function oneOf(value, allowed, label, fallback) {
    if (isBlank(value)) {
        if (fallback !== undefined) return fallback;
        throw new ValidationError(`Thiếu ${label}`);
    }
    const s = String(value).trim().toUpperCase();
    if (!allowed.includes(s)) throw new ValidationError(`${label} phải là một trong: ${allowed.join(', ')}`);
    return s;
}

function isLngLat(p) {
    return Array.isArray(p) && p.length >= 2 &&
        Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
        p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90;
}

/**
 * GeoJSON đa giác (Polygon hoặc MultiPolygon, hoặc Feature chứa chúng).
 * Trả về chuỗi JSON của geometry, hoặc null nếu trống.
 */
function optionalPolygonGeoJson(value, label = 'Ranh giới') {
    if (isBlank(value)) return null;
    let g = value;
    if (typeof g === 'string') {
        try { g = JSON.parse(g); } catch (e) { throw new ValidationError(`${label} không phải JSON hợp lệ`); }
    }
    if (g && g.type === 'Feature') g = g.geometry;
    if (!g || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates)) {
        throw new ValidationError(`${label} phải là GeoJSON Polygon hoặc MultiPolygon`);
    }
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polygons) {
        if (!Array.isArray(poly) || !poly.length) throw new ValidationError(`${label} rỗng`);
        for (const ring of poly) {
            if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isLngLat)) {
                throw new ValidationError(`${label}: mỗi vòng cần ít nhất 4 điểm [kinh độ, vĩ độ] hợp lệ`);
            }
        }
    }
    return JSON.stringify({ type: g.type, coordinates: g.coordinates });
}

/** GeoJSON LineString (đường của chuỗi pin). */
function optionalLineGeoJson(value, label = 'Đường chuỗi pin') {
    if (isBlank(value)) return null;
    let g = value;
    if (typeof g === 'string') {
        try { g = JSON.parse(g); } catch (e) { throw new ValidationError(`${label} không phải JSON hợp lệ`); }
    }
    if (g && g.type === 'Feature') g = g.geometry;
    if (!g || g.type !== 'LineString' || !Array.isArray(g.coordinates) || g.coordinates.length < 2 || !g.coordinates.every(isLngLat)) {
        throw new ValidationError(`${label} phải là GeoJSON LineString có ít nhất 2 điểm`);
    }
    return JSON.stringify({ type: 'LineString', coordinates: g.coordinates });
}

/** Khung nhìn bản đồ "nam,tây,bắc,đông". Trả null nếu không gửi. */
function optionalBbox(value) {
    if (isBlank(value)) return null;
    const parts = String(value).split(',').map(s => Number(s.trim()));
    if (parts.length !== 4 || !parts.every(Number.isFinite)) {
        throw new ValidationError('bbox phải có dạng: nam,tây,bắc,đông');
    }
    const [south, west, north, east] = parts;
    if (south > north || west > east || south < -90 || north > 90 || west < -180 || east > 180) {
        throw new ValidationError('bbox không hợp lệ');
    }
    return { south, west, north, east };
}

module.exports = {
    ValidationError,
    isBlank,
    requiredString,
    optionalString,
    optionalNumber,
    requiredNumber,
    optionalInt,
    requiredInt,
    parseId,
    optionalLat,
    optionalLng,
    oneOf,
    optionalPolygonGeoJson,
    optionalLineGeoJson,
    optionalBbox
};
