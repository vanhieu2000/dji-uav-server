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
