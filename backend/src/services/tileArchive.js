/**
 * Giải nén gói ô ảnh bản đồ (ZIP chứa thư mục {z}/{x}/{y}.png) theo luồng,
 * không nạp cả file vào RAM. Đường dẫn ghi ra được dựng lại từ số z/x/y,
 * nên tên file độc hại trong ZIP (../../) không thể ghi ra ngoài thư mục đích.
 */
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { tileRangeBounds } = require('../utils/geo');

const TILE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
// Cho phép có thư mục bọc ngoài, VD: "ThacMo_tiles/18/215000/123000.png"
const TILE_PATH_RE = /(?:^|\/)(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.(png|jpe?g|webp)$/i;
const MAX_ZOOM = 24;
const MAX_TILE_BYTES = 5 * 1024 * 1024;
// Chặn file ZIP "bom nén" làm đầy ổ đĩa
const MAX_TILES = 3000000;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024 * 1024; // 40 GB sau giải nén

class TileStats {
    constructor() {
        this.count = 0;
        this.bytes = 0;
        this.extCount = {};
        this.zoom = {}; // z -> {minX, maxX, minY, maxY}
    }

    add(z, x, y, ext, size) {
        this.count += 1;
        this.bytes += size;
        this.extCount[ext] = (this.extCount[ext] || 0) + 1;
        const r = this.zoom[z] || (this.zoom[z] = { minX: x, maxX: x, minY: y, maxY: y });
        r.minX = Math.min(r.minX, x); r.maxX = Math.max(r.maxX, x);
        r.minY = Math.min(r.minY, y); r.maxY = Math.max(r.maxY, y);
    }

    /** Thông tin tổng hợp: mức zoom, vùng bao (tính ở mức zoom sâu nhất), đuôi file chính. */
    summary(scheme = 'xyz') {
        const zooms = Object.keys(this.zoom).map(Number).sort((a, b) => a - b);
        if (!zooms.length) return null;
        const maxZ = zooms[zooms.length - 1];
        const r = this.zoom[maxZ];
        const ext = Object.entries(this.extCount).sort((a, b) => b[1] - a[1])[0][0];
        return {
            tile_count: this.count,
            size_bytes: this.bytes,
            min_zoom: zooms[0],
            max_zoom: maxZ,
            tile_ext: ext,
            bounds: tileRangeBounds(maxZ, r.minX, r.maxX, r.minY, r.maxY, scheme)
        };
    }
}

function normalizeExt(ext) {
    const e = ext.toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
}

/** Phân tích đường dẫn trong ZIP; trả null nếu không phải ô ảnh hợp lệ. */
function parseTilePath(entryName) {
    const m = TILE_PATH_RE.exec(entryName.replace(/\\/g, '/'));
    if (!m) return null;
    const z = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const max = 2 ** z;
    if (z > MAX_ZOOM || x >= max || y >= max) return null;
    return { z, x, y, ext: normalizeExt(m[4]) };
}

function openZip(file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => (err ? reject(err) : resolve(zip)));
    });
}

/**
 * Giải nén ZIP vào destDir. Bỏ qua file không phải ô ảnh.
 * @returns {Promise<TileStats>}
 */
async function extractTileZip(zipPath, destDir, limits = {}) {
    const maxTiles = limits.maxTiles || MAX_TILES;
    const maxBytes = limits.maxBytes || MAX_TOTAL_BYTES;
    const zip = await openZip(zipPath);
    const stats = new TileStats();
    const madeDirs = new Set();

    await new Promise((resolve, reject) => {
        const fail = (err) => { zip.close(); reject(err); };
        zip.on('error', fail);
        zip.on('end', resolve);
        zip.on('entry', (entry) => {
            const tile = entry.fileName.endsWith('/') ? null : parseTilePath(entry.fileName);
            if (!tile || entry.uncompressedSize > MAX_TILE_BYTES) {
                zip.readEntry();
                return;
            }
            if (stats.count + 1 > maxTiles || stats.bytes + entry.uncompressedSize > maxBytes) {
                fail(new Error(`Gói ô ảnh vượt giới hạn (${maxTiles} ô hoặc ${Math.round(maxBytes / 1024 ** 3)} GB)`));
                return;
            }
            const dir = path.join(destDir, String(tile.z), String(tile.x));
            if (!madeDirs.has(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                madeDirs.add(dir);
            }
            const outFile = path.join(dir, `${tile.y}.${tile.ext}`);
            zip.openReadStream(entry, (err, stream) => {
                if (err) return fail(err);
                const out = fs.createWriteStream(outFile);
                stream.on('error', fail);
                out.on('error', fail);
                out.on('finish', () => {
                    stats.add(tile.z, tile.x, tile.y, tile.ext, entry.uncompressedSize);
                    zip.readEntry();
                });
                stream.pipe(out);
            });
        });
        zip.readEntry();
    });
    return stats;
}

/** Quét thư mục ô ảnh có sẵn trên server (chép tay vào backend/tiles/basemaps/<mã>). */
function scanTileDir(dir) {
    const stats = new TileStats();
    if (!fs.existsSync(dir)) return stats;
    for (const zName of fs.readdirSync(dir)) {
        if (!/^\d{1,2}$/.test(zName)) continue;
        const z = Number(zName);
        const zDir = path.join(dir, zName);
        if (!fs.statSync(zDir).isDirectory()) continue;
        for (const xName of fs.readdirSync(zDir)) {
            if (!/^\d{1,8}$/.test(xName)) continue;
            const xDir = path.join(zDir, xName);
            if (!fs.statSync(xDir).isDirectory()) continue;
            for (const f of fs.readdirSync(xDir)) {
                const tile = parseTilePath(`${z}/${xName}/${f}`);
                if (!tile) continue;
                stats.add(tile.z, tile.x, tile.y, tile.ext, fs.statSync(path.join(xDir, f)).size);
            }
        }
    }
    return stats;
}

module.exports = { extractTileZip, scanTileDir, parseTilePath, TileStats, TILE_EXTS };
