/**
 * Bản đồ nền của nhà máy (ảnh chụp phân giải cao đã cắt thành ô ảnh XYZ/TMS).
 *   GET    /api/basemaps            danh sách
 *   POST   /api/basemaps/upload     tải file ZIP ô ảnh lên (multipart: file, map_name, map_code?, scheme?, plant_id?)
 *   POST   /api/basemaps/scan       đăng ký thư mục ô ảnh đã chép sẵn vào backend/tiles/basemaps/<map_code>
 *   PUT    /api/basemaps/:id        đổi tên, độ mờ, đặt làm mặc định
 *   DELETE /api/basemaps/:id        xóa (kèm thư mục ô ảnh)
 * Ô ảnh được phục vụ tại /tiles/basemaps/<map_code>/{z}/{x}/{y}.<ext>
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { query, withTransaction } = require('../config/db');
const { asyncHandler, ok, NotFoundError } = require('../utils/http');
const { pickFields } = require('../utils/sql');
const v = require('../utils/validate');
const { extractTileZip, scanTileDir } = require('../services/tileArchive');

const TILES_ROOT = process.env.BASEMAP_TILES_DIR || path.join(__dirname, '..', '..', 'tiles', 'basemaps');
const TMP_DIR = path.join(__dirname, '..', '..', 'uploads', 'tmp');
const MAX_ZIP_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
const MAP_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;

fs.mkdirSync(TMP_DIR, { recursive: true });
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_ZIP_BYTES, files: 1 } });

/** Tạo mã thư mục an toàn từ tên bản đồ (bỏ dấu tiếng Việt). */
function slugify(name) {
    return String(name || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 50);
}

function parseMapCode(value, fallbackName) {
    const code = v.isBlank(value) ? `${slugify(fallbackName) || 'basemap'}-${Date.now().toString(36)}` : String(value).trim().toLowerCase();
    if (!MAP_CODE_RE.test(code)) throw new v.ValidationError('Mã bản đồ chỉ gồm chữ thường, số, "-" hoặc "_" (2–63 ký tự)');
    return code;
}

function tileUrl(row) {
    return `/tiles/basemaps/${row.map_code}/{z}/{x}/{y}.${row.tile_ext}`;
}

function toPublic(row) {
    return {
        ...row,
        is_active: Boolean(row.is_active),
        bounds: row.bounds_json ? JSON.parse(row.bounds_json) : null,
        tile_url: tileUrl(row)
    };
}

function removeDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

async function saveBaseMap({ mapCode, mapName, scheme, plantId, stats }) {
    const s = stats.summary(scheme);
    if (!s) throw new v.ValidationError('Không tìm thấy ô ảnh nào. Cấu trúc cần có dạng {z}/{x}/{y}.png');
    // Chỉ cho phép duy nhất 1 bản đồ tải lên hoạt động: bản đồ mới tải lên sẽ làm mặc định
    await query('UPDATE base_maps SET is_active = 0');
    const result = await query(
        `INSERT INTO base_maps (plant_id, map_code, map_name, scheme, tile_ext, min_zoom, max_zoom, bounds_json, tile_count, size_bytes, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [plantId, mapCode, mapName, scheme, s.tile_ext, s.min_zoom, s.max_zoom, JSON.stringify(s.bounds), s.tile_count, s.size_bytes]
    );
    const rows = await query('SELECT * FROM base_maps WHERE map_id = ?', [result.insertId]);
    return toPublic(rows[0]);
}

function readMeta(body) {
    const mapName = v.requiredString(body.map_name, 'tên bản đồ', 150);
    return {
        mapName,
        mapCode: parseMapCode(body.map_code, mapName),
        scheme: v.oneOf(body.scheme, ['XYZ', 'TMS'], 'kiểu ô ảnh', 'XYZ').toLowerCase(),
        plantId: v.isBlank(body.plant_id) ? null : v.parseId(body.plant_id, 'plant_id')
    };
}

router.get('/', asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM base_maps ORDER BY is_active DESC, created_at DESC');
    ok(res, rows.map(toPublic));
}));

/** Nhận file; lỗi của multer (file quá lớn...) trả JSON thay vì trang lỗi HTML. */
function receiveZip(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'File quá lớn (tối đa 8 GB)' : 'Lỗi nhận file: ' + err.message;
        res.status(400).json({ code: 400, message });
    });
}

router.post('/upload', receiveZip, asyncHandler(async (req, res) => {
    const tmpFile = req.file && req.file.path;
    let createdDir = null;
    try {
        if (!req.file) throw new v.ValidationError('Chưa chọn file ZIP');
        if (!/\.zip$/i.test(req.file.originalname)) throw new v.ValidationError('Chỉ nhận file .zip chứa thư mục ô ảnh {z}/{x}/{y}');
        const meta = readMeta(req.body || {});
        const destDir = path.join(TILES_ROOT, meta.mapCode);
        fs.mkdirSync(TILES_ROOT, { recursive: true });
        try {
            // Tạo thư mục không đệ quy: 2 lần tải cùng mã thì lần sau báo lỗi ngay, không xóa nhầm của nhau
            fs.mkdirSync(destDir);
        } catch (e) {
            if (e.code === 'EEXIST') throw new v.ValidationError(`Thư mục bản đồ "${meta.mapCode}" đã tồn tại, hãy đặt mã khác`);
            throw e;
        }
        createdDir = destDir;
        let stats;
        try {
            stats = await extractTileZip(tmpFile, destDir);
        } catch (zipErr) {
            throw new v.ValidationError('File ZIP bị hỏng hoặc không đọc được: ' + zipErr.message);
        }
        const map = await saveBaseMap({ ...meta, stats });
        createdDir = null; // thành công: giữ thư mục
        ok(res, map, `Đã nhập ${map.tile_count} ô ảnh (zoom ${map.min_zoom}–${map.max_zoom})`);
    } finally {
        if (createdDir) removeDir(createdDir);
        if (tmpFile) fs.rm(tmpFile, { force: true }, () => {});
    }
}));

router.post('/scan', asyncHandler(async (req, res) => {
    const body = req.body || {};
    const mapName = v.requiredString(body.map_name || body.map_code, 'tên bản đồ', 150);
    const mapCode = parseMapCode(v.requiredString(body.map_code, 'mã bản đồ (tên thư mục)', 63), mapName);
    const dir = path.join(TILES_ROOT, mapCode);
    if (!fs.existsSync(dir)) throw new v.ValidationError(`Không thấy thư mục backend/tiles/basemaps/${mapCode}`);
    const scheme = v.oneOf(body.scheme, ['XYZ', 'TMS'], 'kiểu ô ảnh', 'XYZ').toLowerCase();
    const plantId = v.isBlank(body.plant_id) ? null : v.parseId(body.plant_id, 'plant_id');
    const map = await saveBaseMap({ mapCode, mapName, scheme, plantId, stats: scanTileDir(dir) });
    ok(res, map, `Đã đăng ký ${map.tile_count} ô ảnh`);
}));

// Không cho đổi kiểu XYZ/TMS sau khi tải lên: vùng bao đã tính theo kiểu lúc tải (muốn đổi thì xóa và tải lại)
const updateParsers = {
    map_name: x => v.requiredString(x, 'tên bản đồ', 150),
    opacity: x => v.requiredNumber(x, 'độ mờ', { min: 0.1, max: 1 })
};

function parseBool(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    throw new v.ValidationError('is_active phải là true hoặc false');
}

router.put('/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã bản đồ');
    const f = pickFields(req.body, updateParsers);
    const setActive = req.body && Object.prototype.hasOwnProperty.call(req.body, 'is_active') ? parseBool(req.body.is_active) : null;
    await withTransaction(async (conn) => {
        const [rows] = await conn.execute('SELECT map_id, plant_id FROM base_maps WHERE map_id = ?', [id]);
        if (!rows.length) throw new NotFoundError('Không tìm thấy bản đồ nền');
        // Chỉ cho phép duy nhất 1 bản đồ nền tải lên được kích hoạt
        if (setActive === true) await conn.execute('UPDATE base_maps SET is_active = 0');
        if (setActive !== null) f.is_active = setActive ? 1 : 0;
        const cols = Object.keys(f);
        if (!cols.length) throw new v.ValidationError('Không có trường nào để cập nhật');
        await conn.execute(`UPDATE base_maps SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE map_id = ?`, [...cols.map(c => f[c]), id]);
    });
    const rows = await query('SELECT * FROM base_maps WHERE map_id = ?', [id]);
    ok(res, toPublic(rows[0]), 'Đã cập nhật bản đồ nền');
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const id = v.parseId(req.params.id, 'mã bản đồ');
    const rows = await query('SELECT map_code FROM base_maps WHERE map_id = ?', [id]);
    if (!rows.length) throw new NotFoundError('Không tìm thấy bản đồ nền');
    await query('DELETE FROM base_maps WHERE map_id = ?', [id]);
    // map_code đã được kiểm tra khi tạo, nên đường dẫn luôn nằm trong TILES_ROOT
    if (MAP_CODE_RE.test(rows[0].map_code)) removeDir(path.join(TILES_ROOT, rows[0].map_code));
    ok(res, null, 'Đã xóa bản đồ nền');
}));

module.exports = router;
module.exports.slugify = slugify;
module.exports.TILES_ROOT = TILES_ROOT;
