/**
 * Test thuần (không cần MySQL): tính toán bản đồ, kiểm tra dữ liệu, giải nén ô ảnh.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const geo = require('../src/utils/geo');
const v = require('../src/utils/validate');
const { extractTileZip, scanTileDir, parseTilePath } = require('../src/services/tileArchive');

test('interpolatePanels chia đều từ đầu tới cuối chuỗi', () => {
    const pts = geo.interpolatePanels({ lat: 10, lng: 106 }, { lat: 10, lng: 106.0003 }, 4);
    assert.equal(pts.length, 4);
    assert.deepEqual(pts[0], { index: 1, lat: 10, lng: 106 });
    assert.deepEqual(pts[3], { index: 4, lat: 10, lng: 106.0003 });
    assert.equal(pts[1].lng, 106.0001);
    assert.equal(geo.interpolatePanels({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, 1)[0].lat, 1);
});

test('tileRangeBounds: ô 0/0/0 phủ toàn cầu, TMS đảo trục Y', () => {
    const [[s, w], [n, e]] = geo.tileRangeBounds(0, 0, 0, 0, 0);
    assert.equal(w, -180);
    assert.equal(e, 180);
    assert.ok(n > 85 && s < -85);
    // z=1: ô y=0 (XYZ) là nửa bắc; cùng ô đó trong TMS là y=1
    const xyz = geo.tileRangeBounds(1, 0, 0, 0, 0, 'xyz');
    const tms = geo.tileRangeBounds(1, 0, 0, 1, 1, 'tms');
    assert.deepEqual(xyz, tms);
    assert.equal(xyz[0][0], 0); // cạnh nam ở xích đạo
});

test('polygonCenter bỏ điểm khép vòng', () => {
    const c = geo.polygonCenter({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] });
    assert.deepEqual(c, { lat: 1, lng: 1 });
    assert.equal(geo.polygonCenter('not json'), null);
});

test('validate: số, toạ độ, đa giác, bbox', () => {
    assert.equal(v.optionalNumber('1,5', 'x'), 1.5);
    assert.equal(v.optionalNumber('', 'x'), null);
    assert.throws(() => v.optionalLat(91), v.ValidationError);
    assert.throws(() => v.requiredString('  ', 'mã'), /Thiếu mã/);
    assert.throws(() => v.optionalPolygonGeoJson({ type: 'Point', coordinates: [1, 2] }), v.ValidationError);
    const poly = v.optionalPolygonGeoJson({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[106, 11], [106.1, 11], [106.1, 11.1], [106, 11]]] } });
    assert.equal(JSON.parse(poly).type, 'Polygon');
    assert.deepEqual(v.optionalBbox('10,100,11,101'), { south: 10, west: 100, north: 11, east: 101 });
    assert.throws(() => v.optionalBbox('11,100,10,101'), v.ValidationError);
    assert.equal(v.oneOf(undefined, ['A'], 'pha', null), null);
});

test('captureMath: GSD ↔ độ cao, vệt chụp, khoảng cách đường bay & chụp', () => {
    const cm = require('../src/services/captureMath');
    const ir = cm.getCamera('ir');
    assert.ok(Math.abs(ir.hfovDeg - 49.4) < 0.3, `HFOV nhiệt ${ir.hfovDeg}`);
    // 5 cm/điểm ảnh nhiệt ≈ 35 m (khớp bảng Raptor Maps: 5,5 cm ở ~41 m)
    const h = cm.altitudeForGsd('ir', 5);
    assert.ok(h > 33 && h < 37, `độ cao ${h}`);
    assert.ok(Math.abs(cm.footprint('ir', h).gsdCm - 5) < 1e-9);
    const g = cm.deriveGeometry({
        route_kind: 'GRID', lenses: 'ir,wide', gsd_lens: 'ir', target_gsd_cm: 5,
        front_overlap_pct: 70, side_overlap_pct: 30, speed_mps: 15, trigger_mode: 'DISTANCE'
    });
    assert.ok(g.gsd_cm.wide < 1, 'ảnh rộng phải mịn hơn nhiều');
    assert.equal(g.line_spacing_m, Math.round(g.footprint_m.across * 0.7 * 10) / 10);
    assert.ok(Math.abs(g.trigger_distance_m - g.footprint_m.along * 0.3) < 0.02);
    assert.ok(g.max_speed_mps <= g.trigger_distance_m / cm.MIN_CAPTURE_INTERVAL_S + 1e-9, 'giảm tốc để kịp chụp');
    assert.ok(g.warnings.some(w => /Giảm tốc độ/.test(w)));
    const coarse = cm.deriveGeometry({ route_kind: 'GRID', lenses: 'ir', gsd_lens: 'ir', altitude_m: 80, front_overlap_pct: 70, side_overlap_pct: 30, speed_mps: 5, trigger_mode: 'DISTANCE' });
    assert.ok(coarse.warnings.some(w => /thô hơn mức 5 cm/.test(w)));
});

test('flightPlanner: lưới luống cày phủ kín, hướng dọc dãy pin, đếm ảnh', () => {
    const fp = require('../src/services/flightPlanner');
    // Hình chữ nhật ~ 200 m (Đông–Tây) × 100 m (Bắc–Nam) ở vĩ độ 11.85
    const dLat = 100 / 111195;
    const dLng = 200 / (111195 * Math.cos(11.85 * Math.PI / 180));
    const poly = { type: 'Polygon', coordinates: [[[107, 11.85], [107 + dLng, 11.85], [107 + dLng, 11.85 + dLat], [107, 11.85 + dLat], [107, 11.85]]] };
    // Dãy pin chạy Đông–Tây (90°) → đường bay Đông–Tây, xếp theo hướng Bắc–Nam
    const rows = [{ type: 'LineString', coordinates: [[107, 11.8505], [107 + dLng, 11.8505]] }];
    const p = fp.gridPlan({ polygon: poly, lineSpacingM: 20, triggerDistanceM: 10, speedMps: 5, marginM: 0, headingMode: 'ALONG_ROWS', rowLines: rows });
    assert.ok(Math.abs(p.heading_deg - 90) < 0.5, `hướng ${p.heading_deg}`);
    assert.equal(p.stats.line_count, 5); // 100 m / 20 m
    p.lines.forEach(l => assert.ok(Math.abs(l.length_m - 200) < 1, `dài ${l.length_m}`));
    assert.equal(p.stats.photo_count, 5 * 21);
    // Luống cày: đường 1 Tây→Đông, đường 2 Đông→Tây
    assert.ok(p.lines[0].end.lng > p.lines[0].start.lng);
    assert.ok(p.lines[1].end.lng < p.lines[1].start.lng);
    // Nới biên 10 m: thêm đường và dài thêm 20 m
    const m = fp.gridPlan({ polygon: poly, lineSpacingM: 20, triggerDistanceM: 10, speedMps: 5, marginM: 10, headingMode: 'FIXED', headingDeg: 90 });
    assert.equal(m.stats.line_count, 6);
    assert.ok(Math.abs(m.lines[0].length_m - 220) < 1);
    // Không có dãy pin: lấy cạnh dài nhất + cảnh báo
    const a = fp.gridPlan({ polygon: poly, lineSpacingM: 20, triggerDistanceM: 10, speedMps: 5, headingMode: 'ALONG_ROWS', rowLines: [] });
    assert.ok(Math.abs(a.heading_deg - 90) < 0.5);
    assert.ok(a.warnings.length === 1);
    assert.throws(() => fp.gridPlan({ polygon: { type: 'Point', coordinates: [1, 2] }, lineSpacingM: 20 }));
});

test('flightPlanner: tuyến điểm sắp theo điểm gần nhất', () => {
    const fp = require('../src/services/flightPlanner');
    const pts = [{ lat: 11.85, lng: 107 }, { lat: 11.8510, lng: 107 }, { lat: 11.8501, lng: 107 }];
    const r = fp.pointsPlan(pts, { speedMps: 4, hoverSeconds: 2, photosPerPoint: 2 });
    assert.deepEqual(r.points.map(p => p.lat), [11.85, 11.8501, 11.851]);
    assert.ok(Math.abs(r.stats.distance_m - 111) < 2);
    assert.equal(r.stats.photo_count, 6);
});

test('wpmlBuilder: KMZ độ cao so với điểm cất cánh, chụp theo khoảng cách trên từng đường bay', () => {
    const { buildGridKmz, buildPointsKmz } = require('../src/services/wpmlBuilder');
    const AdmZipLocal = require('adm-zip');
    const plan = { waypoints: [{ lat: 11.85, lng: 107 }, { lat: 11.85, lng: 107.002 }, { lat: 11.8502, lng: 107.002 }, { lat: 11.8502, lng: 107 }] };
    const k = buildGridKmz({ name: 'Khu <A>', plan, geometry: { altitude_m: 34.8, max_speed_mps: 5, trigger_distance_m: 7.68 }, profile: { lenses: 'ir,wide', gimbal_pitch: -90, trigger_mode: 'DISTANCE' } });
    const zip = new AdmZipLocal(k.buffer);
    assert.deepEqual(zip.getEntries().map(e => e.entryName).sort(), ['wpmz/template.kml', 'wpmz/waylines.wpml']);
    const w = k.waylines;
    assert.match(w, /<wpml:executeHeightMode>relativeToStartPoint<\/wpml:executeHeightMode>/);
    assert.match(k.template, /<wpml:heightMode>relativeToStartPoint<\/wpml:heightMode>/);
    assert.doesNotMatch(w + k.template, /EGM96/);
    assert.equal((w.match(/<wpml:actionTriggerType>multipleDistance</g) || []).length, 2); // 2 đường bay
    assert.match(w, /<wpml:actionTriggerParam>7.68<\/wpml:actionTriggerParam>/);
    assert.match(w, /<wpml:payloadLensIndex>ir,wide<\/wpml:payloadLensIndex>/);
    assert.match(w, /<wpml:actionGroupStartIndex>2<\/wpml:actionGroupStartIndex>\s*<wpml:actionGroupEndIndex>3</);
    assert.match(w, /Khu &lt;A&gt;/);

    const pk = buildPointsKmz({
        name: 'DCL', speed: 4,
        profile: { lenses: 'ir,zoom', zoom_factor: 5, hover_seconds: 3, photos_per_point: 2 },
        points: [{ lat: 11.85, lng: 107, altitude_m: 12, gimbal_pitch: -20, aircraft_heading: 270, label: 'D4_1' },
            { lat: 11.8501, lng: 107, altitude_m: 12, gimbal_pitch: -20, label: 'D4_2' }]
    });
    assert.match(pk.waylines, /<wpml:focalLength>120<\/wpml:focalLength>/); // 24 mm × 5
    assert.match(pk.waylines, /<wpml:hoverTime>3<\/wpml:hoverTime>/);
    assert.equal((pk.waylines.match(/<wpml:actionActuatorFunc>takePhoto</g) || []).length, 4);
    assert.match(pk.waylines, /<wpml:waypointHeadingAngle>-90<\/wpml:waypointHeadingAngle>/);
    assert.throws(() => buildPointsKmz({ name: 'x', speed: 4, profile: { lenses: 'ir' }, points: [{ lat: 1, lng: 1, altitude_m: 10, gimbal_pitch: 0 }] }));
});

test('djiImageMeta: đọc XMP M3T (RTK, gimbal, ống kính, giờ chụp), hậu tố điểm chụp', () => {
    const h = require('./helpers');
    const m = require('../src/services/djiImageMeta');
    const meta = m.readMetaFromBuffer(h.fakeDjiJpeg({ lat: 11.85, lng: 107.001, source: 'InfraredCamera' }), 'DJI_20261026101530_0001_T.JPG');
    assert.equal(meta.latitude, 11.85);
    assert.equal(meta.longitude, 107.001);
    assert.equal(meta.relative_altitude, 34.8);
    assert.equal(meta.gimbal_pitch, -90);
    assert.equal(meta.rtk_flag, 50);
    assert.equal(meta.position_quality, 'HIGH');
    assert.equal(meta.rtk_std_m, 0.015);
    assert.equal(meta.lens, 'IR');
    assert.equal(meta.captured_at.getFullYear(), 2026);
    // RTK chưa FIX → LOW; bản firmware cũ viết sai GpsLongtitude
    const old = m.readMetaFromBuffer(Buffer.from('<x:xmpmeta drone-dji:GpsLatitude="11.8" drone-dji:GpsLongtitude="107" drone-dji:RtkFlag="16"></x:xmpmeta>'), 'DJI_0002_W.JPG');
    assert.equal(old.longitude, 107);
    assert.equal(old.position_quality, 'LOW');
    assert.equal(old.lens, 'WIDE');
    assert.equal(m.readMetaFromBuffer(Buffer.from('no xmp'), 'x.jpg').position_quality, 'UNKNOWN');
    assert.equal(m.lensOf(null, 'DJI_20261026_0003_Z_D12_34.JPG'), 'ZOOM');
    assert.equal(m.photoPointFromName('DJI_20261026_0003_T_D12_34.JPG'), 34);
    assert.equal(m.photoPointFromName('DJI_20261026_0003_D12_34_2_T.JPG'), 34);
    assert.equal(m.photoPointFromName('DJI_20261026_0003_T.JPG'), null);
});

test('coverage: % phủ, vùng thiếu, bỏ ảnh chụp xiên / không có vị trí', () => {
    const { computeCoverage } = require('../src/services/coverage');
    const cm = require('../src/services/captureMath');
    // Khu 200 m (Đông–Tây) × 40 m, ở vĩ độ 11.85
    const mLat = 1 / 111195;
    const mLng = 1 / (111195 * Math.cos(11.85 * Math.PI / 180));
    const poly = { type: 'Polygon', coordinates: [[[107, 11.85], [107 + 200 * mLng, 11.85], [107 + 200 * mLng, 11.85 + 40 * mLat], [107, 11.85 + 40 * mLat], [107, 11.85]]] };
    const alt = cm.altitudeForGsd('ir', 5); // vệt ~32 × 25,6 m
    // Phủ nửa Tây: ảnh mỗi 10 m dọc trục giữa, từ x = 0 đến 100 m, máy bay hướng Đông (90°): cạnh dài ảnh theo Bắc–Nam
    const photos = [];
    for (let x = 0; x <= 100; x += 10) {
        photos.push({ latitude: 11.85 + 20 * mLat, longitude: 107 + x * mLng, relative_altitude: alt, gimbal_pitch: -90, gimbal_yaw: 90 });
    }
    photos.push({ latitude: 11.85, longitude: 107.0015, relative_altitude: alt, gimbal_pitch: -30, gimbal_yaw: 90 }); // xiên
    photos.push({ latitude: null, longitude: null, relative_altitude: alt });
    const c = computeCoverage({ polygon: poly, photos, lens: 'ir', cellM: 2 });
    assert.equal(c.photos_used, 11);
    assert.equal(c.photos_skipped_oblique, 1);
    assert.equal(c.photos_skipped_no_position, 1);
    // Vệt dọc trục Đông–Tây dài 25,6 m → phủ tới x ≈ 112,8 m / 200 m ≈ 56 %; bề ngang 32 m < 40 m nên hụt 2 dải mép
    assert.ok(c.coverage_pct > 40 && c.coverage_pct < 60, `phủ ${c.coverage_pct}%`);
    assert.ok(c.gap_count >= 1);
    const big = c.gaps[0];
    const xs = big.polygon.coordinates[0].map(p => (p[0] - 107) / mLng);
    assert.ok(Math.max(...xs) > 195, 'vùng thiếu lớn nhất ở nửa Đông');
    const none = computeCoverage({ polygon: poly, photos: [], lens: 'ir' });
    assert.equal(none.coverage_pct, 0);
    assert.equal(none.gap_count, 1);
});

test('wpmlBuilder: tuyến vẽ tay – chụp tại điểm hoặc mỗi N mét, độ cao so với điểm cất cánh', () => {
    const { buildManualKmz } = require('../src/services/wpmlBuilder');
    const wps = [{ lat: 11.85, lng: 107 }, { lat: 11.851, lng: 107, alt: 40, gimbalPitch: -45 }, { lat: 11.852, lng: 107 }];
    const atPoints = buildManualKmz({ name: 'Vẽ tay', waypoints: wps, altitude: 30, speed: 4 });
    assert.equal((atPoints.waylines.match(/<wpml:actionActuatorFunc>takePhoto</g) || []).length, 3);
    assert.match(atPoints.waylines, /<wpml:executeHeight>40<\/wpml:executeHeight>/);
    assert.match(atPoints.waylines, /<wpml:gimbalPitchRotateAngle>-45</);
    assert.match(atPoints.waylines, /relativeToStartPoint/);
    const interval = buildManualKmz({ name: 'Vẽ tay 2', waypoints: wps, altitude: 30, speed: 4, triggerDistance: 6 });
    assert.match(interval.waylines, /<wpml:actionGroupStartIndex>0<\/wpml:actionGroupStartIndex>\s*<wpml:actionGroupEndIndex>2</);
    assert.match(interval.waylines, /<wpml:actionTriggerParam>6</);
});

test('parseTilePath chỉ nhận đường dẫn ô ảnh hợp lệ', () => {
    assert.deepEqual(parseTilePath('tiles/18/215000/123000.PNG'), { z: 18, x: 215000, y: 123000, ext: 'png' });
    assert.deepEqual(parseTilePath('3/1/2.jpeg'), { z: 3, x: 1, y: 2, ext: 'jpg' });
    assert.equal(parseTilePath('3/8/2.png'), null); // x vượt 2^3
    assert.equal(parseTilePath('readme.txt'), null);
    assert.equal(parseTilePath('../../etc/passwd'), null);
});

test('extractTileZip: giải nén ô ảnh, bỏ qua file lạ, không ghi ra ngoài thư mục đích', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uav-zip-'));
    try {
        const zip = new AdmZip();
        zip.addFile('ortho/2/1/1.png', Buffer.from('a'));
        zip.addFile('ortho/2/2/1.png', Buffer.from('bb'));
        zip.addFile('ortho/3/4/3.png', Buffer.from('ccc'));
        zip.addFile('ortho/readme.txt', Buffer.from('ignore'));
        zip.addFile('../../evil.png', Buffer.from('x'));
        const zipFile = path.join(tmp, 'tiles.zip');
        zip.writeZip(zipFile);

        const dest = path.join(tmp, 'out');
        const stats = await extractTileZip(zipFile, dest);
        assert.equal(stats.count, 3);
        assert.ok(fs.existsSync(path.join(dest, '2', '1', '1.png')));
        assert.ok(fs.existsSync(path.join(dest, '3', '4', '3.png')));
        assert.ok(!fs.existsSync(path.join(tmp, 'evil.png')));
        assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'evil.png')));

        const s = stats.summary('xyz');
        assert.equal(s.min_zoom, 2);
        assert.equal(s.max_zoom, 3);
        assert.equal(s.tile_ext, 'png');
        assert.equal(s.tile_count, 3);

        // Quét lại thư mục cho cùng kết quả
        assert.equal(scanTileDir(dest).count, 3);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

/* ---------------- Theo dõi chuyến bay (C1) ---------------- */
const { createTracker, rtkState } = require('../src/services/flightTracker');

function fakeTracker() {
    let t = 1_700_000_000_000;
    const calls = [];
    const events = [];
    let nextId = 100;
    const query = async (sql, params) => {
        calls.push({ sql, params });
        if (/^\s*INSERT INTO flight_sessions/.test(sql)) return { insertId: nextId++ };
        return { affectedRows: 0 };
    };
    const tracker = createTracker({ query, now: () => t, onEvent: e => events.push(e), findSession: async () => ({ session_id: 7, ticket_id: 3 }) });
    return { tracker, calls, events, tick: ms => { t += ms; } };
}
const osd = (h, v = 0, extra = {}) => ({ lat: 11.8, lng: 106.59 + h * 1e-6, alt: 50 + h, rel_alt: h, speed: v, battery: 90, is_fixed: 2, ...extra });

test('rtkState đổi mã is_fixed DJI sang FIX/FLOAT/NONE', () => {
    assert.equal(rtkState(2), 'FIX');
    assert.equal(rtkState(1), 'FLOAT');
    assert.equal(rtkState(0), 'NONE');
    assert.equal(rtkState(undefined), null);
});

test('flightTracker: cất cánh mở chuyến gắn phiếu, hạ cánh 10 s thì đóng', async () => {
    const { tracker, calls, events, tick } = fakeTracker();
    await tracker.onOsd('SN1', osd(0));
    assert.equal(calls.filter(c => /INSERT INTO flight_sessions/.test(c.sql)).length, 0);
    tick(1000); const r = await tracker.onOsd('SN1', osd(5, 3));
    assert.equal(r.airborne, true);
    assert.equal(r.flight_session_id, 100);
    const ins = calls.find(c => /INSERT INTO flight_sessions/.test(c.sql));
    assert.equal(ins.params[1], 3); // ticket_id từ phiên Pilot
    for (let i = 0; i < 12; i++) { tick(1000); await tracker.onOsd('SN1', osd(0.2, 0)); }
    const up = calls.find(c => /UPDATE flight_sessions SET ended_at/.test(c.sql));
    assert.ok(up, 'phải đóng chuyến');
    assert.equal(up.params[1], 'LANDED');
    assert.deepEqual(events.map(e => e.type).filter(t => t.startsWith('flight')), ['flight_started', 'flight_ended']);
});

test('flightTracker: telemetry tối đa 1 lần/giây, có flight_session_id khi bay', async () => {
    const { tracker, calls, tick } = fakeTracker();
    for (let i = 0; i < 10; i++) { tick(200); await tracker.onOsd('SN1', osd(10, 5)); } // 5 Hz trong 2 s
    const logs = calls.filter(c => /INSERT INTO telemetry_logs/.test(c.sql));
    assert.equal(logs.length, 2);
    assert.equal(logs[0].params[2], 100);
    assert.equal(logs[0].params[13], 1); // rtk_fixed
});

test('flightTracker: gói OSD đến dồn dập chỉ mở 1 chuyến', async () => {
    const { tracker, calls } = fakeTracker();
    await Promise.all([tracker.onOsd('SN1', osd(5, 3)), tracker.onOsd('SN1', osd(6, 3)), tracker.onOsd('SN1', osd(7, 3))]);
    assert.equal(calls.filter(c => /INSERT INTO flight_sessions/.test(c.sql)).length, 1);
});

test('flightTracker: mất tín hiệu 30 s → OFFLINE và đóng chuyến LOST_LINK', async () => {
    const { tracker, calls, events, tick } = fakeTracker();
    await tracker.onOsd('SN1', osd(20, 5));
    tick(10000); await tracker.sweep();
    assert.equal(tracker.isOnline('SN1'), true);
    tick(25000); await tracker.sweep();
    assert.equal(tracker.isOnline('SN1'), false);
    assert.equal(calls.find(c => /UPDATE flight_sessions SET ended_at/.test(c.sql)).params[1], 'LOST_LINK');
    assert.ok(calls.some(c => /SET status = 'OFFLINE'/.test(c.sql)));
    assert.ok(events.some(e => e.type === 'device_offline'));
});

test('flights.thin giữ điểm đầu, cuối và giới hạn số điểm', () => {
    const { thin } = require('../src/routes/flights');
    const rows = Array.from({ length: 10001 }, (_, i) => i);
    const out = thin(rows, 5000);
    assert.equal(out.length, 5000);
    assert.equal(out[0], 0);
    assert.equal(out[out.length - 1], 10000);
    assert.deepEqual(thin([1, 2], 5000), [1, 2]);
});
