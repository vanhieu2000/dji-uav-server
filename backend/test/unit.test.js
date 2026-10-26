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
