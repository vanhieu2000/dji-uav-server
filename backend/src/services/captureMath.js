/**
 * Tính hình học chụp ảnh từ hồ sơ chụp + thông số camera.
 *
 * Thông số DJI Mavic 3T (theo trang thông số DJI; KIỂM LẠI khi bay thử):
 *   - Camera rộng (wide):  1/2" 48MP, 8000×6000, góc nhìn chéo (DFOV) 84°
 *   - Camera zoom (tele):  1/2" 12MP, 4000×3000, DFOV 15°
 *   - Camera nhiệt (ir):   640×512, DFOV 61°
 * Ảnh đặt nằm ngang: cạnh dài ngang đường bay (vệt quét rộng nhất), cạnh ngắn dọc đường bay.
 */

const CAMERAS = {
    M3T: {
        wide: { label: 'Rộng 48MP', widthPx: 8000, heightPx: 6000, dfovDeg: 84 },
        zoom: { label: 'Zoom 12MP', widthPx: 4000, heightPx: 3000, dfovDeg: 15 },
        ir: { label: 'Nhiệt 640×512', widthPx: 640, heightPx: 512, dfovDeg: 61 }
    }
};
const DEFAULT_MODEL = 'M3T';
// Chu kỳ chụp nhanh nhất an toàn (s). M3T chụp nhiệt + rộng khoảng 0,7 s/lần; lấy 1 s để không rớt ảnh.
const MIN_CAPTURE_INTERVAL_S = 1.0;
const LENS_KEYS = ['ir', 'wide', 'zoom'];

const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Góc nhìn ngang / dọc (độ) tính từ góc nhìn chéo và tỉ lệ ảnh. */
function fieldOfView(cam) {
    const diag = Math.hypot(cam.widthPx, cam.heightPx);
    const tHalfD = Math.tan(toRad(cam.dfovDeg / 2));
    return {
        hfovDeg: toDeg(2 * Math.atan((tHalfD * cam.widthPx) / diag)),
        vfovDeg: toDeg(2 * Math.atan((tHalfD * cam.heightPx) / diag))
    };
}

function getCamera(lens, model = DEFAULT_MODEL) {
    const cam = CAMERAS[model] && CAMERAS[model][lens];
    if (!cam) throw new Error(`Không có thông số camera "${lens}" của ${model}`);
    return { ...cam, ...fieldOfView(cam) };
}

/** Vệt chụp trên mặt đất (m) khi nhìn thẳng xuống từ độ cao h. */
function footprint(lens, altitudeM, model) {
    const cam = getCamera(lens, model);
    const w = 2 * altitudeM * Math.tan(toRad(cam.hfovDeg / 2));
    const h = 2 * altitudeM * Math.tan(toRad(cam.vfovDeg / 2));
    return { widthM: w, heightM: h, gsdCm: (w / cam.widthPx) * 100 };
}

/** Độ cao (m) để đạt độ phân giải mặt đất gsdCm với camera lens. */
function altitudeForGsd(lens, gsdCm, model) {
    const cam = getCamera(lens, model);
    return ((gsdCm / 100) * cam.widthPx) / (2 * Math.tan(toRad(cam.hfovDeg / 2)));
}

/**
 * Hình học chụp của một hồ sơ.
 * @param {object} p hồ sơ (các cột của bảng capture_profiles)
 * @returns {object} độ cao, GSD từng camera, vệt chụp, khoảng cách đường bay, khoảng cách chụp, tốc độ tối đa, cảnh báo
 */
function deriveGeometry(p, model = DEFAULT_MODEL) {
    const warnings = [];
    const lenses = String(p.lenses || '').split(',').map(s => s.trim()).filter(Boolean);
    const gsdLens = p.gsd_lens || lenses[0] || 'ir';

    let altitude = p.altitude_m != null ? Number(p.altitude_m) : null;
    if (altitude == null && p.target_gsd_cm != null) altitude = altitudeForGsd(gsdLens, Number(p.target_gsd_cm), model);
    if (altitude == null) altitude = 30; // tuyến điểm không đặt độ cao: dùng độ cao tại từng điểm chụp

    const gsdByLens = {};
    lenses.forEach(l => { gsdByLens[l] = round(footprint(l, altitude, model).gsdCm, 2); });
    const fp = footprint(gsdLens, altitude, model);

    const out = {
        model,
        altitude_m: round(altitude, 1),
        gsd_cm: gsdByLens,
        footprint_m: { across: round(fp.widthM, 1), along: round(fp.heightM, 1) },
        line_spacing_m: null,
        trigger_distance_m: null,
        trigger_interval_s: null,
        max_speed_mps: Number(p.speed_mps),
        warnings
    };

    if (p.route_kind === 'GRID') {
        const side = Number(p.side_overlap_pct) / 100;
        const front = Number(p.front_overlap_pct) / 100;
        out.line_spacing_m = round(fp.widthM * (1 - side), 1);
        let triggerDist = fp.heightM * (1 - front);
        if (p.trigger_mode === 'DISTANCE' && p.trigger_interval != null) triggerDist = Number(p.trigger_interval);
        out.trigger_distance_m = round(triggerDist, 2);

        // Tốc độ phải đủ chậm để kịp chụp ở mỗi khoảng cách chụp
        const speedLimit = triggerDist / MIN_CAPTURE_INTERVAL_S;
        if (p.trigger_mode === 'TIME') {
            const interval = p.trigger_interval != null ? Number(p.trigger_interval) : MIN_CAPTURE_INTERVAL_S;
            out.trigger_interval_s = interval;
            out.max_speed_mps = round(Math.min(Number(p.speed_mps), triggerDist / interval), 2);
        } else {
            out.max_speed_mps = round(Math.min(Number(p.speed_mps), speedLimit), 2);
        }
        if (out.max_speed_mps < Number(p.speed_mps)) {
            warnings.push(`Giảm tốc độ xuống ${out.max_speed_mps} m/s để kịp chụp mỗi ${out.trigger_distance_m} m`);
        }
        if (triggerDist < 1) warnings.push('Khoảng cách chụp dưới 1 m: chuyến bay rất chậm, nên giảm độ chồng ảnh dọc hoặc tăng độ cao');
    }
    if (altitude > 120) warnings.push('Độ cao trên 120 m: kiểm tra giới hạn bay cho phép');
    if (altitude < 8 && p.route_kind === 'GRID') warnings.push('Độ cao dưới 8 m: nguy cơ va chạm, kiểm tra địa hình');
    if (lenses.includes('ir') && gsdByLens.ir > 5) warnings.push(`Ảnh nhiệt ${gsdByLens.ir} cm/điểm ảnh, thô hơn mức 5 cm khuyến nghị để thấy lỗi cấp cell`);
    return out;
}

module.exports = { CAMERAS, LENS_KEYS, MIN_CAPTURE_INTERVAL_S, getCamera, footprint, altitudeForGsd, deriveGeometry };
