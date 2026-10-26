/**
 * Lập tuyến bay (Giai đoạn A2) – thuần toán, không gọi DB (dễ test).
 *   gridPlan():   tuyến quét lưới kiểu luống cày phủ kín một đa giác.
 *   pointsPlan(): tuyến đi qua các điểm chụp ảnh, sắp thứ tự gần nhất.
 * Tọa độ phẳng cục bộ (mét) quanh tâm khu: đủ chính xác cho vùng vài km.
 */

const EARTH_R = 6371008.8;
const TURN_SECONDS = 6;            // thời gian quay đầu ở cuối mỗi đường bay (ước lượng)
const TAKEOFF_LANDING_SECONDS = 90;
const USABLE_BATTERY_SECONDS = 25 * 60; // M3T bay ~45 phút; lấy 25 phút dùng được để còn dự phòng
const POINT_OVERHEAD_SECONDS = 4;  // xoay gimbal, ổn định trước khi chụp tại điểm
const SECONDS_PER_PHOTO = 2;

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;
const r7 = n => Math.round(n * 1e7) / 1e7;
const r1 = n => Math.round(n * 10) / 10;

function makeProjection(origin) {
    const cosLat = Math.cos(toRad(origin.lat));
    return {
        toXY: ({ lat, lng }) => ({ x: toRad(lng - origin.lng) * EARTH_R * cosLat, y: toRad(lat - origin.lat) * EARTH_R }),
        toLatLng: ({ x, y }) => ({ lat: r7(origin.lat + toDeg(y / EARTH_R)), lng: r7(origin.lng + toDeg(x / (EARTH_R * cosLat))) })
    };
}

/** Vòng ngoài của Polygon / MultiPolygon (lấy đa giác lớn nhất), dạng [{lat,lng}]. */
function outerRing(geojson) {
    let g = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
    if (g && g.type === 'Feature') g = g.geometry;
    if (!g || !Array.isArray(g.coordinates)) throw new Error('Khu chưa có ranh giới đa giác');
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const ring = polys.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
    const pts = ring.map(([lng, lat]) => ({ lat, lng }));
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) pts.pop();
    if (pts.length < 3) throw new Error('Ranh giới khu cần ít nhất 3 đỉnh');
    return pts;
}

function centroid(pts) {
    return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length };
}

/** Hướng (độ, 0 = Bắc, theo chiều kim đồng hồ) của đoạn a→b, quy về 0–180. */
function bearing(a, b) {
    const deg = (toDeg(Math.atan2(b.x - a.x, b.y - a.y)) + 360) % 180;
    return deg;
}

/** Hướng cạnh dài nhất của đa giác (độ). */
function longestEdgeHeading(xy) {
    let best = { len: -1, h: 0 };
    xy.forEach((p, i) => {
        const q = xy[(i + 1) % xy.length];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len > best.len) best = { len, h: bearing(p, q) };
    });
    return best.h;
}

/** Hướng trung bình của các đường chuỗi pin (dãy pin), trọng số theo chiều dài. Trả null nếu không có. */
function rowsHeading(lines, proj) {
    let sx = 0;
    let sy = 0;
    (lines || []).forEach(line => {
        const coords = line && line.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;
        const a = proj.toXY({ lng: coords[0][0], lat: coords[0][1] });
        const b = proj.toXY({ lng: coords[coords.length - 1][0], lat: coords[coords.length - 1][1] });
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (!len) return;
        // Cộng theo góc nhân đôi để hướng 10° và 190° không triệt tiêu nhau
        const ang = toRad(bearing(a, b)) * 2;
        sx += Math.cos(ang) * len;
        sy += Math.sin(ang) * len;
    });
    if (!sx && !sy) return null;
    return ((toDeg(Math.atan2(sy, sx)) / 2) + 180) % 180;
}

/**
 * Tuyến quét lưới.
 * @param {object} o
 *   polygon       GeoJSON ranh giới khu
 *   lineSpacingM  khoảng cách 2 đường bay (m)
 *   triggerDistanceM  chụp mỗi N m (để đếm ảnh)
 *   speedMps      tốc độ bay
 *   marginM       nới ra ngoài ranh giới (m)
 *   headingMode   'ALONG_ROWS' | 'AUTO' | 'FIXED'
 *   headingDeg    dùng khi FIXED
 *   rowLines      [GeoJSON LineString] các chuỗi pin trong khu (cho ALONG_ROWS)
 * @returns {{heading_deg, lines: [{start,end,length_m}], waypoints: [{lat,lng}], stats, warnings}}
 */
function gridPlan(o) {
    const warnings = [];
    if (!(o.lineSpacingM > 0)) throw new Error('Khoảng cách đường bay phải > 0');
    const ring = outerRing(o.polygon);
    const origin = centroid(ring);
    const proj = makeProjection(origin);
    const xy = ring.map(proj.toXY);

    let heading;
    if (o.headingMode === 'FIXED' && o.headingDeg != null) {
        heading = Number(o.headingDeg) % 180;
    } else if (o.headingMode === 'ALONG_ROWS') {
        heading = rowsHeading(o.rowLines, proj);
        if (heading == null) {
            heading = longestEdgeHeading(xy);
            warnings.push('Khu chưa có đường chuỗi pin: lấy hướng theo cạnh dài nhất của ranh giới');
        }
    } else {
        heading = longestEdgeHeading(xy);
    }

    // Xoay để đường bay nằm ngang (trục u dọc đường bay, v vuông góc)
    const th = toRad(heading);
    const rot = p => ({ u: p.x * Math.sin(th) + p.y * Math.cos(th), v: -p.x * Math.cos(th) + p.y * Math.sin(th) });
    const unrot = ({ u, v }) => ({ x: u * Math.sin(th) - v * Math.cos(th), y: u * Math.cos(th) + v * Math.sin(th) });
    const uv = xy.map(rot);
    const minV = Math.min(...uv.map(p => p.v));
    const maxV = Math.max(...uv.map(p => p.v));
    const margin = Math.max(0, Number(o.marginM) || 0);
    const spacing = Number(o.lineSpacingM);

    const span = maxV - minV + 2 * margin;
    // Dung sai 1 mm tránh thêm 1 đường thừa do sai số làm tròn (100,0001 m / 20 m)
    const count = Math.max(1, Math.ceil(span / spacing - 1e-4));
    // Căn giữa các đường bay trong dải cần phủ
    const firstV = minV - margin + (span - (count - 1) * spacing) / 2;
    const eps = 1e-6;

    const lines = [];
    for (let i = 0; i < count; i += 1) {
        const v = firstV + i * spacing;
        const vc = Math.min(Math.max(v, minV + eps), maxV - eps); // đường ngoài khu: lấy bề ngang ở mép gần nhất
        const xs = [];
        uv.forEach((a, k) => {
            const b = uv[(k + 1) % uv.length];
            if ((a.v <= vc && b.v > vc) || (b.v <= vc && a.v > vc)) {
                xs.push(a.u + ((vc - a.v) / (b.v - a.v)) * (b.u - a.u));
            }
        });
        if (xs.length < 2) continue;
        let u0 = Math.min(...xs) - margin;
        let u1 = Math.max(...xs) + margin;
        if (lines.length % 2 === 1) [u0, u1] = [u1, u0]; // luống cày: đường lẻ bay ngược chiều
        const start = proj.toLatLng(unrot({ u: u0, v }));
        const end = proj.toLatLng(unrot({ u: u1, v }));
        lines.push({ start, end, length_m: Math.abs(u1 - u0) });
    }
    if (!lines.length) throw new Error('Không sinh được đường bay cho khu này');

    const lineLen = lines.reduce((s, l) => s + l.length_m, 0);
    const transitLen = (lines.length - 1) * spacing;
    const trig = Number(o.triggerDistanceM) || 0;
    const photos = trig > 0 ? lines.reduce((s, l) => s + Math.floor(l.length_m / trig + 1e-3) + 1, 0) : 0;
    const speed = Number(o.speedMps) || 5;
    const seconds = (lineLen + transitLen) / speed + lines.length * TURN_SECONDS + TAKEOFF_LANDING_SECONDS;
    if (seconds > USABLE_BATTERY_SECONDS) warnings.push(`Cần khoảng ${Math.ceil(seconds / USABLE_BATTERY_SECONDS)} pin: nên chia khu nhỏ hơn hoặc bay nhiều lượt`);

    const waypoints = [];
    lines.forEach(l => { waypoints.push(l.start, l.end); });
    return {
        heading_deg: r1(heading),
        lines: lines.map(l => ({ ...l, length_m: r1(l.length_m) })),
        waypoints,
        stats: {
            line_count: lines.length,
            distance_m: Math.round(lineLen + transitLen),
            photo_count: photos,
            duration_s: Math.round(seconds),
            batteries: Math.max(1, Math.ceil(seconds / USABLE_BATTERY_SECONDS))
        },
        warnings
    };
}

/**
 * Tuyến điểm: đi qua các điểm chụp ảnh, sắp theo điểm gần nhất (bắt đầu từ start hoặc điểm đầu tiên).
 * @param {Array<{lat,lng,altitude_m,gimbal_pitch,...}>} points
 */
function pointsPlan(points, { start = null, speedMps = 4, hoverSeconds = 0, photosPerPoint = 1 } = {}) {
    if (!Array.isArray(points) || !points.length) throw new Error('Chưa có điểm chụp ảnh nào cho các tài sản đã chọn');
    const origin = centroid(points);
    const proj = makeProjection(origin);
    const rest = points.map(p => ({ p, xy: proj.toXY(p) }));
    const ordered = [];
    let cur = start ? proj.toXY(start) : rest[0].xy;
    let dist = 0;
    while (rest.length) {
        let bi = 0;
        let bd = Infinity;
        rest.forEach((r, i) => {
            const d = Math.hypot(r.xy.x - cur.x, r.xy.y - cur.y);
            if (d < bd) { bd = d; bi = i; }
        });
        const [n] = rest.splice(bi, 1);
        if (ordered.length || start) dist += bd;
        ordered.push(n.p);
        cur = n.xy;
    }
    const perPoint = (Number(hoverSeconds) || 0) + POINT_OVERHEAD_SECONDS + (Number(photosPerPoint) || 1) * SECONDS_PER_PHOTO;
    const seconds = dist / (Number(speedMps) || 4) + ordered.length * perPoint + TAKEOFF_LANDING_SECONDS;
    const warnings = [];
    if (seconds > USABLE_BATTERY_SECONDS) warnings.push(`Cần khoảng ${Math.ceil(seconds / USABLE_BATTERY_SECONDS)} pin`);
    return {
        points: ordered,
        stats: {
            point_count: ordered.length,
            distance_m: Math.round(dist),
            photo_count: ordered.length * (Number(photosPerPoint) || 1),
            duration_s: Math.round(seconds),
            batteries: Math.max(1, Math.ceil(seconds / USABLE_BATTERY_SECONDS))
        },
        warnings
    };
}

module.exports = { gridPlan, pointsPlan, outerRing, makeProjection, rowsHeading, longestEdgeHeading };
