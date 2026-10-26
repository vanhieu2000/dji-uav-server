/**
 * Hồ sơ chụp ảnh (Giai đoạn A1).
 *   GET    /api/capture-profiles            danh sách (kèm hình học chụp đã tính)
 *   GET    /api/capture-profiles/:id
 *   POST   /api/capture-profiles/preview    tính thử hình học từ thông số chưa lưu
 *   POST   /api/capture-profiles            tạo
 *   PUT    /api/capture-profiles/:id        sửa từng phần
 *   DELETE /api/capture-profiles/:id        xóa (mẫu mặc định không xóa được)
 */
const express = require('express');
const router = express.Router();
const { query } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const { pickFields, updateById, deleteById } = require('../utils/sql');
const v = require('../utils/validate');
const { LENS_KEYS, deriveGeometry } = require('../services/captureMath');

const PURPOSES = ['MAP_2D', 'SOLAR_THERMAL', 'CLOSE_UP', 'DCL_POINT', 'TRAINING', 'CUSTOM'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function parseLenses(x) {
    const list = String(v.requiredString(x, 'camera chụp', 30)).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const bad = list.filter(l => !LENS_KEYS.includes(l));
    if (!list.length || bad.length) throw new v.ValidationError(`Camera chỉ gồm: ${LENS_KEYS.join(', ')}`);
    return [...new Set(list)].join(',');
}

function optionalTime(x, label) {
    if (v.isBlank(x)) return null;
    const s = String(x).trim();
    if (!TIME_RE.test(s)) throw new v.ValidationError(`${label} phải có dạng HH:MM`);
    return s.length === 5 ? `${s}:00` : s;
}

const parsers = {
    profile_code: x => {
        const s = v.requiredString(x, 'mã hồ sơ', 50).toUpperCase();
        if (!/^[A-Z0-9_-]+$/.test(s)) throw new v.ValidationError('Mã hồ sơ chỉ gồm chữ không dấu, số, "-" và "_"');
        return s;
    },
    profile_name: x => v.requiredString(x, 'tên hồ sơ', 150),
    purpose: x => v.oneOf(x, PURPOSES, 'mục đích', 'CUSTOM'),
    route_kind: x => v.oneOf(x, ['GRID', 'POINTS'], 'kiểu tuyến', 'GRID'),
    lenses: parseLenses,
    gsd_lens: x => v.oneOf(x, LENS_KEYS.map(l => l.toUpperCase()), 'camera tính độ phân giải', 'IR').toLowerCase(),
    target_gsd_cm: x => v.optionalNumber(x, 'độ phân giải (cm/điểm ảnh)', { min: 0.2, max: 30 }),
    altitude_m: x => v.optionalNumber(x, 'độ cao (m)', { min: 2, max: 500 }),
    front_overlap_pct: x => v.requiredNumber(x, 'chồng ảnh dọc (%)', { min: 0, max: 95 }),
    side_overlap_pct: x => v.requiredNumber(x, 'chồng ảnh ngang (%)', { min: 0, max: 95 }),
    speed_mps: x => v.requiredNumber(x, 'tốc độ (m/s)', { min: 0.5, max: 15 }),
    gimbal_pitch: x => v.requiredNumber(x, 'góc gimbal', { min: -90, max: 35 }),
    heading_mode: x => v.oneOf(x, ['ALONG_ROWS', 'FIXED', 'AUTO'], 'hướng bay', 'ALONG_ROWS'),
    heading_deg: x => v.optionalNumber(x, 'góc hướng bay', { min: 0, max: 360 }),
    trigger_mode: x => v.oneOf(x, ['DISTANCE', 'TIME', 'POINT'], 'kiểu chụp', 'DISTANCE'),
    trigger_interval: x => v.optionalNumber(x, 'khoảng chụp', { min: 0.2, max: 1000 }),
    zoom_factor: x => v.optionalNumber(x, 'độ zoom', { min: 1, max: 56 }),
    hover_seconds: x => v.optionalInt(x, 'thời gian dừng (s)', { min: 0, max: 120 }) ?? 0,
    photos_per_point: x => v.optionalInt(x, 'số ảnh mỗi điểm', { min: 1, max: 20 }) ?? 1,
    margin_m: x => v.optionalNumber(x, 'nới biên (m)', { min: 0, max: 100 }) ?? 0,
    require_rtk: x => (x === true || x === 1 || x === '1' || x === 'true' ? 1 : 0),
    min_irradiance_wm2: x => v.optionalInt(x, 'bức xạ tối thiểu', { min: 0, max: 1500 }),
    time_window_start: x => optionalTime(x, 'giờ bắt đầu'),
    time_window_end: x => optionalTime(x, 'giờ kết thúc'),
    notes: x => v.optionalString(x, 'ghi chú', 2000)
};

const REQUIRED_ON_CREATE = ['profile_code', 'profile_name', 'lenses', 'front_overlap_pct', 'side_overlap_pct', 'speed_mps', 'gimbal_pitch'];

/** Kiểm tra ràng buộc giữa các trường của một hồ sơ hoàn chỉnh. */
function checkConsistency(p) {
    const lenses = p.lenses.split(',');
    if (!lenses.includes(p.gsd_lens)) throw new v.ValidationError('Camera tính độ phân giải phải nằm trong danh sách camera chụp');
    if (p.route_kind === 'GRID') {
        if (p.trigger_mode === 'POINT') throw new v.ValidationError('Tuyến quét lưới phải chụp theo khoảng cách hoặc thời gian');
        if (p.altitude_m == null && p.target_gsd_cm == null) throw new v.ValidationError('Tuyến quét lưới cần độ cao hoặc độ phân giải mong muốn');
    } else if (p.trigger_mode !== 'POINT') {
        throw new v.ValidationError('Tuyến điểm phải chụp tại điểm (POINT)');
    }
    if (p.heading_mode === 'FIXED' && p.heading_deg == null) throw new v.ValidationError('Hướng bay cố định cần nhập góc hướng');
    if (lenses.includes('zoom') === false && p.zoom_factor != null) throw new v.ValidationError('Chỉ đặt độ zoom khi có camera zoom');
}

function withGeometry(row) {
    let geometry = null;
    try { geometry = deriveGeometry(row); } catch (e) { geometry = { warnings: [e.message] }; }
    return { ...row, is_system: Boolean(row.is_system), require_rtk: Boolean(row.require_rtk), geometry };
}

async function loadProfile(id) {
    const rows = await query('SELECT * FROM capture_profiles WHERE profile_id = ?', [id]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy hồ sơ chụp');
    return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM capture_profiles ORDER BY is_system DESC, profile_name ASC');
    ok(res, rows.map(withGeometry));
}));

router.get('/:id', asyncHandler(async (req, res) => {
    ok(res, withGeometry(await loadProfile(v.parseId(req.params.id))));
}));

/** Tính thử: nhận đủ thông số (chưa lưu), trả hình học chụp. Dùng cho form khi người dùng đang gõ. */
router.post('/preview', asyncHandler(async (req, res) => {
    const p = { ...defaults(), ...pickFields(req.body, parsers) };
    checkConsistency(p);
    ok(res, deriveGeometry(p));
}));

function defaults() {
    return {
        purpose: 'CUSTOM', route_kind: 'GRID', lenses: 'ir,wide', gsd_lens: 'ir', target_gsd_cm: null, altitude_m: null,
        front_overlap_pct: 70, side_overlap_pct: 30, speed_mps: 5, gimbal_pitch: -90, heading_mode: 'ALONG_ROWS',
        heading_deg: null, trigger_mode: 'DISTANCE', trigger_interval: null, zoom_factor: null
    };
}

router.post('/', asyncHandler(async (req, res) => {
    const f = pickFields(req.body, parsers);
    REQUIRED_ON_CREATE.forEach(c => { if (f[c] == null) parsers[c](undefined); });
    checkConsistency({ ...defaults(), ...f });
    const cols = Object.keys(f);
    const result = await query(
        `INSERT INTO capture_profiles (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => f[c])
    );
    ok(res, withGeometry(await loadProfile(result.insertId)), 'Đã tạo hồ sơ chụp');
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã hồ sơ');
    const current = await loadProfile(id);
    const f = pickFields(req.body, parsers);
    if (current.is_system && f.profile_code && f.profile_code !== current.profile_code) {
        throw new v.ValidationError('Không đổi mã của hồ sơ mặc định');
    }
    checkConsistency({ ...current, ...f });
    await updateById(query, 'capture_profiles', 'profile_id', id, f);
    ok(res, withGeometry(await loadProfile(id)), 'Đã cập nhật hồ sơ chụp');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã hồ sơ');
    const current = await loadProfile(id);
    if (current.is_system) throw new v.ValidationError('Hồ sơ mặc định không xóa được (có thể sửa thông số)');
    await deleteById(query, 'capture_profiles', 'profile_id', id);
    ok(res, null, 'Đã xóa hồ sơ chụp');
}));

module.exports = router;
