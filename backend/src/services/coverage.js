/**
 * Kiểm tra độ phủ ảnh của một khu (Giai đoạn A4) – thuần toán, không gọi DB.
 *  - Vệt ảnh trên mặt đất: ảnh chụp gần thẳng xuống (gimbal ≈ −90°), kích thước theo độ cao
 *    so với điểm cất cánh + góc nhìn camera, xoay theo hướng gimbal / máy bay.
 *  - Chia khu thành ô lưới (mặc định 2 m), ô nằm trong vệt của ít nhất 1 ảnh = đã phủ.
 *  - Ô chưa phủ gom thành vùng thiếu (thành phần liên thông) → hình chữ nhật để bay bù.
 * Giả định mặt đất phẳng ngang điểm cất cánh (đúng với nhà máy điện mặt trời).
 */
const { footprint } = require('./captureMath');
const { outerRing, makeProjection } = require('./flightPlanner');

const NADIR_TOLERANCE_DEG = 15;
const MAX_CELLS = 400000;
const MIN_GAP_CELLS = 4;
const MAX_GAPS = 20;

function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/** 4 góc vệt ảnh (tọa độ phẳng) – cạnh dọc ảnh theo hướng yawDeg. */
function footprintCorners(center, widthM, heightM, yawDeg) {
    const t = (yawDeg * Math.PI) / 180;
    const fwd = { x: Math.sin(t), y: Math.cos(t) };   // hướng "trên" của ảnh
    const right = { x: Math.cos(t), y: -Math.sin(t) };
    const hw = widthM / 2;
    const hh = heightM / 2;
    return [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]].map(([a, b]) => ({
        x: center.x + right.x * a + fwd.x * b,
        y: center.y + right.y * a + fwd.y * b
    }));
}

/**
 * @param {object} o
 *   polygon  GeoJSON ranh giới khu
 *   photos   [{latitude, longitude, relative_altitude, gimbal_pitch, gimbal_yaw, flight_yaw, position_quality}]
 *   lens     'ir' | 'wide' | 'zoom' – camera dùng để tính vệt
 *   cellM    kích thước ô (m)
 */
function computeCoverage({ polygon, photos, lens = 'ir', cellM = 2 }) {
    const ring = outerRing(polygon);
    const origin = { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length };
    const proj = makeProjection(origin);
    const polyXY = ring.map(proj.toXY);
    const minX = Math.min(...polyXY.map(p => p.x));
    const maxX = Math.max(...polyXY.map(p => p.x));
    const minY = Math.min(...polyXY.map(p => p.y));
    const maxY = Math.max(...polyXY.map(p => p.y));

    let cell = cellM;
    while (((maxX - minX) / cell) * ((maxY - minY) / cell) > MAX_CELLS) cell *= 1.5;
    const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
    const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
    const inside = new Uint8Array(nx * ny);
    const covered = new Uint8Array(nx * ny);
    let total = 0;
    for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
            if (pointInPolygon({ x: minX + (i + 0.5) * cell, y: minY + (j + 0.5) * cell }, polyXY)) {
                inside[j * nx + i] = 1;
                total += 1;
            }
        }
    }

    const footprints = [];
    let used = 0;
    let skippedOblique = 0;
    let skippedNoPos = 0;
    photos.forEach(ph => {
        if (ph.latitude == null || ph.longitude == null || !(ph.relative_altitude > 1)) { skippedNoPos += 1; return; }
        if (ph.gimbal_pitch != null && Math.abs(Number(ph.gimbal_pitch) + 90) > NADIR_TOLERANCE_DEG) { skippedOblique += 1; return; }
        const fp = footprint(lens, Number(ph.relative_altitude));
        const yaw = ph.gimbal_yaw != null ? Number(ph.gimbal_yaw) : (ph.flight_yaw != null ? Number(ph.flight_yaw) : 0);
        const corners = footprintCorners(proj.toXY({ lat: ph.latitude, lng: ph.longitude }), fp.widthM, fp.heightM, yaw);
        used += 1;
        footprints.push(corners);
        // Chỉ duyệt ô trong khung bao của vệt ảnh
        const fxs = corners.map(c => c.x);
        const fys = corners.map(c => c.y);
        const i0 = Math.max(0, Math.floor((Math.min(...fxs) - minX) / cell));
        const i1 = Math.min(nx - 1, Math.floor((Math.max(...fxs) - minX) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(...fys) - minY) / cell));
        const j1 = Math.min(ny - 1, Math.floor((Math.max(...fys) - minY) / cell));
        for (let j = j0; j <= j1; j += 1) {
            for (let i = i0; i <= i1; i += 1) {
                const k = j * nx + i;
                if (!inside[k] || covered[k]) continue;
                if (pointInPolygon({ x: minX + (i + 0.5) * cell, y: minY + (j + 0.5) * cell }, corners)) covered[k] = 1;
            }
        }
    });

    let coveredCount = 0;
    for (let k = 0; k < covered.length; k += 1) coveredCount += covered[k];

    // Vùng thiếu: thành phần liên thông (4 hướng) của ô trong khu chưa phủ
    const seen = new Uint8Array(nx * ny);
    const gaps = [];
    for (let k = 0; k < inside.length; k += 1) {
        if (!inside[k] || covered[k] || seen[k]) continue;
        const stack = [k];
        seen[k] = 1;
        let count = 0;
        let bi0 = Infinity; let bi1 = -1; let bj0 = Infinity; let bj1 = -1;
        while (stack.length) {
            const c = stack.pop();
            count += 1;
            const i = c % nx;
            const j = (c - i) / nx;
            bi0 = Math.min(bi0, i); bi1 = Math.max(bi1, i); bj0 = Math.min(bj0, j); bj1 = Math.max(bj1, j);
            [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].forEach(([a, b]) => {
                if (a < 0 || b < 0 || a >= nx || b >= ny) return;
                const n = b * nx + a;
                if (inside[n] && !covered[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
            });
        }
        if (count < MIN_GAP_CELLS) continue;
        const toLL = (i, j) => { const p = proj.toLatLng({ x: minX + i * cell, y: minY + j * cell }); return [p.lng, p.lat]; };
        const rect = [toLL(bi0, bj0), toLL(bi1 + 1, bj0), toLL(bi1 + 1, bj1 + 1), toLL(bi0, bj1 + 1), toLL(bi0, bj0)];
        gaps.push({ area_m2: Math.round(count * cell * cell), polygon: { type: 'Polygon', coordinates: [rect] } });
    }
    gaps.sort((a, b) => b.area_m2 - a.area_m2);

    return {
        cell_m: Math.round(cell * 100) / 100,
        coverage_pct: total ? Math.round((coveredCount / total) * 1000) / 10 : 0,
        area_m2: Math.round(total * cell * cell),
        uncovered_m2: Math.round((total - coveredCount) * cell * cell),
        photos_used: used,
        photos_skipped_oblique: skippedOblique,
        photos_skipped_no_position: skippedNoPos,
        gaps: gaps.slice(0, MAX_GAPS),
        gap_count: gaps.length,
        footprints: footprints.map(c => ({ type: 'Polygon', coordinates: [[...c, c[0]].map(p => { const ll = proj.toLatLng(p); return [ll.lng, ll.lat]; })] }))
    };
}

module.exports = { computeCoverage, footprintCorners, pointInPolygon };
