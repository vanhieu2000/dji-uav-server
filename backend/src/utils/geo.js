/**
 * Hàm tính toán bản đồ dùng chung (thuần JS, dễ test).
 */

/** Tâm (trung bình các đỉnh vòng ngoài) của Polygon / MultiPolygon GeoJSON. */
function polygonCenter(geojson) {
    let g = geojson;
    if (typeof g === 'string') {
        try { g = JSON.parse(g); } catch (e) { return null; }
    }
    if (!g || !Array.isArray(g.coordinates)) return null;
    const rings = g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [g.coordinates[0]];
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        // Bỏ điểm cuối nếu trùng điểm đầu (vòng khép kín)
        const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
            ? ring.slice(0, -1) : ring;
        for (const [lng, lat] of pts) {
            sumLat += lat;
            sumLng += lng;
            n += 1;
        }
    }
    return n ? { lat: sumLat / n, lng: sumLng / n } : null;
}

/**
 * Chia đều vị trí các tấm pin trên đoạn thẳng từ điểm đầu tới điểm cuối của chuỗi.
 * count = 1: đặt tại điểm đầu.
 * @returns {{index: number, lat: number, lng: number}[]}
 */
function interpolatePanels(start, end, count) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const t = count === 1 ? 0 : i / (count - 1);
        out.push({
            index: i + 1,
            lat: round7(start.lat + (end.lat - start.lat) * t),
            lng: round7(start.lng + (end.lng - start.lng) * t)
        });
    }
    return out;
}

function round7(n) {
    return Math.round(n * 1e7) / 1e7;
}

/** Khoảng cách (m) giữa 2 điểm theo công thức haversine. */
function distanceMeters(a, b) {
    const R = 6371008.8;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** Kinh độ cạnh trái của ô ảnh x tại mức zoom z (chuẩn XYZ / Web Mercator). */
function tileXToLng(x, z) {
    return (x / 2 ** z) * 360 - 180;
}

/** Vĩ độ cạnh trên của ô ảnh y tại mức zoom z (chuẩn XYZ). */
function tileYToLat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Khung bao [[nam, tây], [bắc, đông]] của một dải ô ảnh tại mức zoom z.
 * scheme 'tms': trục y đếm từ dưới lên, cần đổi sang XYZ trước.
 */
function tileRangeBounds(z, minX, maxX, minY, maxY, scheme = 'xyz') {
    let topY = minY;
    let bottomY = maxY;
    if (scheme === 'tms') {
        const flip = y => 2 ** z - 1 - y;
        topY = flip(maxY);
        bottomY = flip(minY);
    }
    const north = tileYToLat(topY, z);
    const south = tileYToLat(bottomY + 1, z);
    const west = tileXToLng(minX, z);
    const east = tileXToLng(maxX + 1, z);
    return [[round7(south), round7(west)], [round7(north), round7(east)]];
}

module.exports = {
    polygonCenter,
    interpolatePanels,
    distanceMeters,
    tileXToLng,
    tileYToLat,
    tileRangeBounds
};
