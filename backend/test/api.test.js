/**
 * Test tích hợp API tài sản & bản đồ trên CSDL test riêng (dji_uav_test).
 * Bỏ qua nếu máy không có MySQL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const h = require('./helpers');

test('API tài sản & bản đồ', async (t) => {
    if (!(await h.mysqlAvailable())) {
        t.skip('Không kết nối được MySQL, bỏ qua test tích hợp');
        return;
    }
    await h.resetTestDatabase();
    const db = require('../src/config/db');
    assert.equal(await db.testConnection(), true);
    const app = await h.startTestApp();
    const { api } = app;

    t.after(async () => {
        await app.close();
        await db.closePool();
        await h.dropTestDatabase();
        fs.rmSync(process.env.BASEMAP_TILES_DIR, { recursive: true, force: true });
    });

    let plantId, areaId, stringId, subId, bayId, dclId;

    await t.test('migration chạy lại không lỗi (mỗi file 1 lần)', async () => {
        const { runMigrations } = require('../src/db/migrate');
        const again = await runMigrations({ ...h.rootConfig(), database: h.TEST_DB }, { log: () => {} });
        assert.deepEqual(again, []);
    });

    await t.test('chưa có nhà máy: tạo khu vực báo lỗi rõ ràng', async () => {
        const r = await api('POST', '/api/solar/areas', { area_code: 'A1', area_name: 'Khu A1' });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /Chưa có nhà máy/);
    });

    await t.test('nhà máy: tạo và sửa tâm bản đồ', async () => {
        const r = await api('POST', '/api/solar/plants', { plant_code: 'TM01', plant_name: 'Thác Mơ', center_lat: 11.85, center_lng: 107.0 });
        assert.equal(r.status, 200);
        plantId = r.body.data.plant_id;
        const u = await api('PUT', `/api/solar/plants/${plantId}`, { center_lat: 11.86 });
        assert.equal(u.status, 200);
        const list = await api('GET', '/api/solar/plants');
        assert.equal(list.body.data[0].center_lat, 11.86);
    });

    await t.test('khu vực: đa giác tự tính tâm, trùng mã trả 409, sửa từng phần', async () => {
        const polygon = { type: 'Polygon', coordinates: [[[107.0, 11.85], [107.002, 11.85], [107.002, 11.852], [107.0, 11.852], [107.0, 11.85]]] };
        const r = await api('POST', '/api/solar/areas', { area_code: 'INV-01', area_name: 'Inverter 01', polygon_geojson: polygon });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        areaId = r.body.data.area_id;
        const got = await api('GET', `/api/solar/areas/${areaId}`);
        assert.ok(Math.abs(got.body.data.center_lat - 11.851) < 1e-6);
        const dup = await api('POST', '/api/solar/areas', { area_code: 'INV-01', area_name: 'Trùng' });
        assert.equal(dup.status, 409);
        const bad = await api('POST', '/api/solar/areas', { area_code: 'X', area_name: 'X', polygon_geojson: { type: 'Polygon', coordinates: [[[1, 2]]] } });
        assert.equal(bad.status, 400);
        const upd = await api('PUT', `/api/solar/areas/${areaId}`, { total_capacity_kwp: 2500 });
        assert.equal(upd.status, 200);
        const missing = await api('PUT', '/api/solar/areas/99999', { area_name: 'x' });
        assert.equal(missing.status, 404);
    });

    await t.test('chuỗi pin + tự sinh tấm pin + lọc theo khung nhìn', async () => {
        const s = await api('POST', '/api/solar/strings', { area_id: areaId, string_code: 'STR-01' });
        assert.equal(s.status, 200);
        stringId = s.body.data.string_id;
        const g = await api('POST', `/api/solar/strings/${stringId}/generate-panels`, {
            start_lat: 11.8505, start_lng: 107.0005, end_lat: 11.8505, end_lng: 107.0015, count: 24
        });
        assert.equal(g.status, 200, JSON.stringify(g.body));
        assert.equal(g.body.data.created, 24);
        // Sinh lại: thay thế, không nhân đôi
        await api('POST', `/api/solar/strings/${stringId}/generate-panels`, {
            start_lat: 11.8505, start_lng: 107.0005, end_lat: 11.8505, end_lng: 107.0015, count: 24
        });
        const all = await api('GET', `/api/solar/panels?string_id=${stringId}&limit=100`);
        assert.equal(all.body.data.length, 24);
        assert.equal(all.body.data[0].panel_serial, 'INV-01-STR-01-001');
        const inBox = await api('GET', '/api/solar/panels?bbox=11.85,107.0004,11.851,107.0010&limit=3');
        assert.equal(inBox.body.data.length, 3);
        assert.equal(inBox.body.truncated, true);
        const strings = await api('GET', `/api/solar/strings?area_id=${areaId}`);
        assert.equal(strings.body.data[0].actual_panel_count, 24);
        assert.ok(strings.body.data[0].line_geojson);
    });

    await t.test('trạm, ngăn lộ, dao cách ly: sửa / xóa theo disconnector_id', async () => {
        const s = await api('POST', '/api/substation', { substation_code: 'TBA-110', substation_name: 'TBA 110kV', center_lat: 11.853, center_lng: 107.003 });
        assert.equal(s.status, 200, JSON.stringify(s.body));
        subId = s.body.data.substation_id;
        const b = await api('POST', '/api/substation/bays', { substation_id: subId, bay_code: '171', bay_name: 'Ngăn 171' });
        bayId = b.body.data.bay_id;
        const d = await api('POST', '/api/substation/disconnectors', { bay_id: bayId, dcl_code: '171-7', phase: 'A', latitude: 11.8531, longitude: 107.0031 });
        assert.equal(d.status, 200);
        dclId = d.body.data.disconnector_id;
        const dB = await api('POST', '/api/substation/disconnectors', { bay_id: bayId, dcl_code: '171-7', phase: 'B' });
        const u = await api('PUT', `/api/substation/disconnectors/${dclId}`, { max_allowed_temp: 75 });
        assert.equal(u.status, 200, JSON.stringify(u.body));
        const list = await api('GET', `/api/substation/disconnectors?bay_id=${bayId}`);
        assert.equal(list.body.data.find(x => x.disconnector_id === dclId).max_allowed_temp, 75);
        assert.equal(list.body.data.find(x => x.phase === 'A').dcl_name, 'Dao cách ly 171-7 Pha A');
        // Xóa pha B không ảnh hưởng pha A (trước đây xóa theo mã sẽ xóa cả 3 pha)
        const del = await api('DELETE', `/api/substation/disconnectors/${dB.body.data.disconnector_id}`);
        assert.equal(del.status, 200);
        const after = await api('GET', `/api/substation/disconnectors?bay_id=${bayId}`);
        assert.equal(after.body.data.length, 1);
        const badId = await api('DELETE', '/api/substation/disconnectors/171-7');
        assert.equal(badId.status, 400);
    });

    await t.test('mối nối dao cách ly', async () => {
        const c = await api('POST', '/api/substation/contacts', { disconnector_id: dclId, contact_code: '171-7A-01', position_desc: 'Đầu cực phía thanh cái', latitude: 11.85311, longitude: 107.00311 });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        const list = await api('GET', `/api/substation/contacts?disconnector_id=${dclId}`);
        assert.equal(list.body.data.length, 1);
        const bad = await api('POST', '/api/substation/contacts', { disconnector_id: 99999, contact_code: 'X' });
        assert.equal(bad.status, 400);
    });

    await t.test('điểm chụp ảnh gắn tài sản', async () => {
        const p = await api('POST', '/api/assets/photo-points', { asset_type: 'DISCONNECTOR', asset_id: dclId, latitude: 11.8532, longitude: 107.0032, altitude_m: 15, gimbal_pitch: -20 });
        assert.equal(p.status, 200, JSON.stringify(p.body));
        const bad = await api('POST', '/api/assets/photo-points', { asset_type: 'DISCONNECTOR', asset_id: 99999, latitude: 1, longitude: 1 });
        assert.equal(bad.status, 400);
        const list = await api('GET', `/api/assets/photo-points?asset_type=DISCONNECTOR&asset_id=${dclId}`);
        assert.equal(list.body.data[0].hover_seconds, 2);
        assert.equal(list.body.data[0].camera_mode, 'WIDE_IR');
    });

    await t.test('tìm kiếm chung: khớp mã chính xác lên đầu, có tọa độ', async () => {
        const r = await api('GET', '/api/assets/search?q=171-7');
        assert.equal(r.status, 200);
        assert.equal(r.body.data[0].type, 'disconnector');
        assert.ok(r.body.data[0].lat);
        const panel = await api('GET', '/api/assets/search?q=STR-01-012');
        assert.equal(panel.body.data[0].type, 'panel');
        assert.equal(panel.body.data[0].code, 'INV-01-STR-01-012');
        const empty = await api('GET', '/api/assets/search?q=');
        assert.equal(empty.status, 400);
    });

    await t.test('cây tài sản và lớp bản đồ', async () => {
        const tree = await api('GET', '/api/assets/tree');
        assert.equal(tree.status, 200, JSON.stringify(tree.body));
        assert.equal(tree.body.data.areas[0].strings[0].actual_panel_count, 24);
        assert.equal(tree.body.data.substations[0].bays[0].disconnectors[0].contacts.length, 1);
        const f = await api('GET', '/api/assets/features?layers=areas,panels,disconnectors,contacts,photo_points,anomalies');
        assert.equal(f.status, 200, JSON.stringify(f.body));
        assert.equal(f.body.data.areas[0].polygon_geojson.type, 'Polygon');
        assert.equal(f.body.data.panels.need_bbox, true);
        const withBox = await api('GET', '/api/assets/features?layers=panels&bbox=11.85,107,11.851,107.002');
        assert.equal(withBox.body.data.panels.items.length, 24);
        const unknown = await api('GET', '/api/assets/features?layers=xyz');
        assert.equal(unknown.status, 400);

        // Lớp bất thường: lấy tọa độ theo DCL đã gắn, lọc theo khung nhìn ngay trong SQL
        const m = await db.query("INSERT INTO media_files (device_sn, file_name, file_url, latitude, longitude) VALUES ('SN', 'a.jpg', '/u/a.jpg', 1, 1)");
        await db.query("INSERT INTO ai_defect_detections (media_id, defect_type, confidence, max_temperature, disconnector_id) VALUES (?, 'DISCONNECTOR_OVERHEAT', 0.9, 88, ?)", [m.insertId, dclId]);
        const an = await api('GET', '/api/assets/features?layers=anomalies&bbox=11.85,107,11.86,107.01');
        assert.equal(an.status, 200, JSON.stringify(an.body));
        assert.equal(an.body.data.anomalies.length, 1);
        assert.equal(an.body.data.anomalies[0].lat, 11.8531); // tọa độ DCL, không phải tọa độ ảnh (1,1)
        const outside = await api('GET', '/api/assets/features?layers=anomalies&bbox=0,0,0.5,0.5');
        assert.equal(outside.body.data.anomalies.length, 0);
    });

    await t.test('nhập Excel: kiểm tra trước, ghi sau, báo dòng lỗi', async () => {
        const rows = [
            { _row: 2, area_code: 'INV-01', string_code: 'STR-02', panel_count: 2 },
            { _row: 3, area_code: 'INV-01', string_code: 'STR-01', string_name: 'Đổi tên' },
            { _row: 4, area_code: 'KHONG-CO', string_code: 'STR-09' },
            { _row: 5, area_code: 'INV-01', string_code: 'STR-02' }
        ];
        const c = await api('POST', '/api/assets/import/check', { entity: 'strings', rows });
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.deepEqual(c.body.data.summary, { total: 4, insert: 1, update: 1, error: 2 });
        assert.match(c.body.data.rows[2].errors[0], /KHONG-CO/);
        assert.match(c.body.data.rows[3].errors[0], /Trùng với dòng 2/);
        const refused = await api('POST', '/api/assets/import/commit', { entity: 'strings', rows });
        assert.equal(refused.status, 400);
        const commit = await api('POST', '/api/assets/import/commit', { entity: 'strings', rows, skip_errors: true });
        assert.equal(commit.status, 200, JSON.stringify(commit.body));
        assert.equal(commit.body.data.written, 2);
        const list = await api('GET', `/api/solar/strings?area_id=${areaId}`);
        assert.equal(list.body.data.length, 2);
        assert.equal(list.body.data.find(s => s.string_code === 'STR-01').string_name, 'Đổi tên');
        // Ô trống không ghi đè: STR-01 vẫn giữ đường line_geojson
        assert.ok(list.body.data.find(s => s.string_code === 'STR-01').line_geojson);

        const dcl = await api('POST', '/api/assets/import/commit', {
            entity: 'disconnectors',
            rows: [{ substation_code: 'TBA-110', bay_code: '171', dcl_code: '171-1', phase: 'c', latitude: '11,8533', longitude: '107,0033' }]
        });
        assert.equal(dcl.status, 200, JSON.stringify(dcl.body));
        const found = await api('GET', '/api/assets/search?q=171-1');
        assert.equal(found.body.data[0].phase, 'C');
        assert.equal(found.body.data[0].lat, 11.8533);
        const wrong = await api('POST', '/api/assets/import/check', { entity: 'users', rows: [{}] });
        assert.equal(wrong.status, 400);
        // Chặn tấn công qua thuộc tính có sẵn của Object (trước đây ghi được vào bảng bất kỳ)
        for (const entity of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            const evil = await api('POST', '/api/assets/import/commit', {
                entity, rows: [{ table: 'users', idCol: 'user_id', existingId: 1, fields: { role: 'X' } }]
            });
            assert.equal(evil.status, 400, entity);
        }
        const layerEvil = await api('GET', '/api/assets/features?layers=constructor');
        assert.equal(layerEvil.status, 400);
        // Mã khác nhau chỉ ở dấu tiếng Việt được coi là trùng (giống MySQL)
        const accent = await api('POST', '/api/assets/import/check', { entity: 'strings', rows: [{ area_code: 'INV-01', string_code: 'STR-0Ì' }, { area_code: 'INV-01', string_code: 'STR-0I' }] });
        assert.equal(accent.body.data.summary.error, 1);
    });

    await t.test('bản đồ nền: tải ZIP, đặt mặc định, xóa', async () => {
        const zip = new AdmZip();
        zip.addFile('ThacMo/17/104700/61500.png', Buffer.from('png1'));
        zip.addFile('ThacMo/18/209400/123000.png', Buffer.from('png2'));
        zip.addFile('ThacMo/18/209401/123001.png', Buffer.from('png3'));
        const form = new FormData();
        form.append('map_name', 'Ảnh bay Thác Mơ 2026');
        form.append('file', new Blob([zip.toBuffer()]), 'thacmo.zip');
        const up = await api('POST', '/api/basemaps/upload', form);
        assert.equal(up.status, 200, JSON.stringify(up.body));
        const map = up.body.data;
        assert.match(map.map_code, /^anh-bay-thac-mo-2026-/);
        assert.equal(map.tile_count, 3);
        assert.equal(map.min_zoom, 17);
        assert.equal(map.max_zoom, 18);
        assert.match(map.tile_url, /\/tiles\/basemaps\/.+\/\{z\}\/\{x\}\/\{y\}\.png$/);
        assert.ok(fs.existsSync(path.join(process.env.BASEMAP_TILES_DIR, map.map_code, '18', '209401', '123001.png')));

        const notZip = new FormData();
        notZip.append('map_name', 'x');
        notZip.append('file', new Blob(['abc']), 'x.txt');
        assert.equal((await api('POST', '/api/basemaps/upload', notZip)).status, 400);

        const broken = new FormData();
        broken.append('map_name', 'hỏng');
        broken.append('file', new Blob(['not a zip']), 'broken.zip');
        const br = await api('POST', '/api/basemaps/upload', broken);
        assert.equal(br.status, 400);
        assert.match(br.body.message, /ZIP/);

        const act = await api('PUT', `/api/basemaps/${map.map_id}`, { is_active: true, opacity: 0.8 });
        assert.equal(act.status, 200, JSON.stringify(act.body));
        assert.equal(act.body.data.is_active, true);
        const del = await api('DELETE', `/api/basemaps/${map.map_id}`);
        assert.equal(del.status, 200);
        assert.ok(!fs.existsSync(path.join(process.env.BASEMAP_TILES_DIR, map.map_code)));
    });

    await t.test('xóa tài sản thì dọn điểm chụp ảnh mồ côi (kể cả xóa dây chuyền)', async () => {
        const c = await api('POST', '/api/substation/contacts', { disconnector_id: dclId, contact_code: 'TMP-01' });
        await api('POST', '/api/assets/photo-points', { asset_type: 'DCL_CONTACT', asset_id: c.body.data.contact_id, latitude: 11.85, longitude: 107 });
        const before = (await api('GET', '/api/assets/photo-points')).body.data.length;
        // Xóa cả DCL: mối nối bị xóa dây chuyền, điểm chụp của DCL và mối nối đều phải mất
        const del = await api('DELETE', `/api/substation/disconnectors/${dclId}`);
        assert.equal(del.status, 200);
        const after = (await api('GET', '/api/assets/photo-points')).body.data;
        assert.equal(after.length, before - 2);
        assert.ok(after.every(p => !['DISCONNECTOR', 'DCL_CONTACT'].includes(p.asset_type)));
    });

    await t.test('migration tách câu lệnh, bỏ qua câu đã áp dụng', async () => {
        const { splitStatements } = require('../src/db/migrate');
        assert.equal(splitStatements('-- chú thích; có chấm phẩy\nCREATE TABLE a (x INT);\nALTER TABLE a ADD COLUMN y INT;\n').length, 2);
        // Giả lập lần chạy trước dừng giữa chừng: xóa dấu đã chạy 001 rồi chạy lại
        const mysql = require('mysql2/promise');
        const c = await mysql.createConnection({ ...h.rootConfig(), database: h.TEST_DB });
        await c.query('DELETE FROM schema_migrations');
        // DB "đã có một phần": thiếu 1 cột của câu ALTER gộp → chạy lại phải bổ sung đúng cột đó
        await c.query('ALTER TABLE media_files DROP COLUMN original_name');
        await c.end();
        const { runMigrations, listMigrationFiles } = require('../src/db/migrate');
        // Mọi file chạy lại được trên DB đã có sẵn bảng/cột (không lỗi, không nhân đôi dữ liệu mẫu)
        assert.deepEqual(await runMigrations({ ...h.rootConfig(), database: h.TEST_DB }, { log: () => {} }), listMigrationFiles());
        assert.equal((await api('GET', '/api/capture-profiles')).body.data.length, 5);
        const cols = await db.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = 'media_files' AND column_name = 'original_name'", [h.TEST_DB]);
        assert.equal(cols.length, 1, 'cột bị thiếu phải được bổ sung');
        const { splitAlterClauses } = require('../src/db/migrate');
        assert.deepEqual(splitAlterClauses("ALTER TABLE `t` ADD COLUMN `a` ENUM('x','y') DEFAULT 'x', ADD INDEX `i` (`a`, `b`)"),
            ["ALTER TABLE `t` ADD COLUMN `a` ENUM('x','y') DEFAULT 'x'", 'ALTER TABLE `t` ADD INDEX `i` (`a`, `b`)']);
    });

    await t.test('phiếu đang chờ cho Pilot 2 lấy từ CSDL', async () => {
        await api('POST', '/api/tickets', { ticket_name: 'Kiểm tra khu INV-01', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' });
        const { listActiveTickets, findTicketById } = require('../src/services/ticketService');
        const list = await listActiveTickets();
        assert.equal(list.length, 1);
        assert.equal(list[0].livestream_channel, 'm3t_live');
        assert.equal((await findTicketById(list[0].ticket_id)).ticket_name, 'Kiểm tra khu INV-01');
        assert.equal(await findTicketById('abc'), null);
    });

    await t.test('hồ sơ chụp: 5 mẫu mặc định, tính hình học, tạo/sửa/xóa, ràng buộc', async () => {
        const list = await api('GET', '/api/capture-profiles');
        assert.equal(list.status, 200, JSON.stringify(list.body));
        const codes = list.body.data.map(p => p.profile_code).sort();
        assert.deepEqual(codes, ['CLOSE_UP', 'DCL_POINT', 'MAP_2D', 'SOLAR_THERMAL', 'TRAINING_RGB']);
        const thermal = list.body.data.find(p => p.profile_code === 'SOLAR_THERMAL');
        assert.ok(thermal.geometry.altitude_m > 30 && thermal.geometry.altitude_m < 40);
        assert.equal(thermal.time_window_start, '10:00:00');
        // Mẫu mặc định: sửa được, không xóa được, không đổi mã
        assert.equal((await api('PUT', `/api/capture-profiles/${thermal.profile_id}`, { target_gsd_cm: 4 })).status, 200);
        assert.equal((await api('DELETE', `/api/capture-profiles/${thermal.profile_id}`)).status, 400);
        assert.equal((await api('PUT', `/api/capture-profiles/${thermal.profile_id}`, { profile_code: 'X' })).status, 400);

        const body = {
            profile_code: 'pin-gan', profile_name: 'Quét nhiệt thấp', route_kind: 'GRID', lenses: 'IR, wide, ir',
            gsd_lens: 'ir', target_gsd_cm: '3,0', front_overlap_pct: 75, side_overlap_pct: 35, speed_mps: 4, gimbal_pitch: -90,
            time_window_start: '09:30'
        };
        const created = await api('POST', '/api/capture-profiles', body);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.equal(created.body.data.profile_code, 'PIN-GAN');
        assert.equal(created.body.data.lenses, 'ir,wide');
        assert.equal(created.body.data.time_window_start, '09:30:00');
        assert.ok(created.body.data.geometry.altitude_m < 25);
        assert.equal((await api('POST', '/api/capture-profiles', body)).status, 409);

        const bad = [
            { ...body, profile_code: 'B1', lenses: 'ir,thermal' },
            { ...body, profile_code: 'B2', gsd_lens: 'zoom' },
            { ...body, profile_code: 'B3', trigger_mode: 'POINT' },
            { ...body, profile_code: 'B4', target_gsd_cm: null },
            { ...body, profile_code: 'B5', route_kind: 'POINTS' },
            { ...body, profile_code: 'B6', heading_mode: 'FIXED' },
            { ...body, profile_code: 'B7', time_window_start: '25:00' }
        ];
        for (const b of bad) assert.equal((await api('POST', '/api/capture-profiles', b)).status, 400, b.profile_code);

        const pv = await api('POST', '/api/capture-profiles/preview', { route_kind: 'GRID', lenses: 'wide', gsd_lens: 'wide', altitude_m: 60, front_overlap_pct: 80, side_overlap_pct: 70 });
        assert.equal(pv.status, 200, JSON.stringify(pv.body));
        assert.ok(pv.body.data.line_spacing_m > 0 && pv.body.data.trigger_distance_m > 0);

        assert.equal((await api('DELETE', `/api/capture-profiles/${created.body.data.profile_id}`)).status, 200);
    });

    await t.test('lập đường bay: quét lưới khu pin + tuyến điểm DCL → KMZ', async () => {
        const profiles = (await api('GET', '/api/capture-profiles')).body.data;
        const grid = profiles.find(p => p.profile_code === 'SOLAR_THERMAL');
        const pts = profiles.find(p => p.profile_code === 'DCL_POINT');

        // Khu chưa có ranh giới → báo rõ
        const noPoly = await api('POST', '/api/solar/areas', { area_code: 'NOPOLY', area_name: 'Chưa vẽ' });
        const e1 = await api('POST', '/api/flight-plans/preview', { profile_id: grid.profile_id, area_id: noPoly.body.data.area_id });
        assert.equal(e1.status, 400);
        assert.match(e1.body.message, /chưa vẽ ranh giới/);

        const pv = await api('POST', '/api/flight-plans/preview', { profile_id: grid.profile_id, area_id: areaId });
        assert.equal(pv.status, 200, JSON.stringify(pv.body));
        assert.equal(pv.body.data.kind, 'GRID');
        assert.ok(pv.body.data.stats.line_count >= 1 && pv.body.data.stats.photo_count > 0);
        assert.ok(pv.body.data.geojson.path.coordinates.length >= 2);

        const created = await api('POST', '/api/flight-plans', { profile_id: grid.profile_id, area_id: areaId, route_name: 'Quét nhiệt INV-01' });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const route = created.body.data;
        assert.equal(route.route_kind, 'GRID');
        assert.ok(route.route_uuid && route.kmz_md5);
        assert.match(route.kmz_file_name, /^DJI_Mission_\d+_Quet_nhiet_INV_01\.kmz$/);
        const fileRes = await fetch(`${app.base}${route.kmz_url}`);
        assert.equal(fileRes.status, 200);
        const zip = new AdmZip(Buffer.from(await fileRes.arrayBuffer()));
        assert.match(zip.readAsText('wpmz/waylines.wpml'), /multipleDistance/);

        // Tuyến điểm: thêm 2 điểm chụp cho 1 ngăn lộ (lấy cả DCL bên trong)
        const bay2 = await api('POST', '/api/substation/bays', { substation_id: subId, bay_code: '172', bay_name: 'Ngăn 172' });
        const d1 = await api('POST', '/api/substation/disconnectors', { bay_id: bay2.body.data.bay_id, dcl_code: '172-1', phase: 'A' });
        for (const lat of [11.8541, 11.8542]) {
            const pp = await api('POST', '/api/assets/photo-points', { asset_type: 'DISCONNECTOR', asset_id: d1.body.data.disconnector_id, latitude: lat, longitude: 107.004, altitude_m: 12, gimbal_pitch: -20 });
            assert.equal(pp.status, 200, JSON.stringify(pp.body));
        }
        const e2 = await api('POST', '/api/flight-plans/preview', { profile_id: pts.profile_id, targets: [] });
        assert.equal(e2.status, 400);
        const ptRoute = await api('POST', '/api/flight-plans', { profile_id: pts.profile_id, targets: [{ asset_type: 'BAY', asset_id: bay2.body.data.bay_id }], route_name: 'DCL ngăn 172' });
        assert.equal(ptRoute.status, 200, JSON.stringify(ptRoute.body));
        assert.equal(ptRoute.body.data.route_kind, 'POINTS');
        assert.equal(ptRoute.body.data.plan.stats.point_count, 2);

        const list = await api('GET', '/api/flight-plans');
        assert.equal(list.body.data.length, 2);
        assert.equal((await api('DELETE', `/api/flight-plans/${route.route_id}`)).status, 200);
        assert.equal((await fetch(`${app.base}${route.kmz_url}`)).status, 404);
    });

    await t.test('nhận ảnh: S3 nhiều phần, metadata thật, phiên Pilot, điểm chụp, trùng, thẻ nhớ, callback', async () => {
        const ingest = require('../src/services/mediaIngest');
        const ticket = await api('POST', '/api/tickets', { ticket_name: 'Bay thử nhận ảnh', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' });
        const ticketId = ticket.body.data.ticket_id;
        await ingest.startPilotSession({ user: { user_id: null, username: 'pilot' }, ticketId, rcSn: 'RC123456', aircraftSn: 'AC987654' });

        // Tải nhiều phần: 3 phần gửi lệch thứ tự phải ghép đúng
        const img = h.fakeDjiJpeg({ lat: 11.8505, lng: 107.0007, source: 'WideCamera' });
        const cut = [0, 100, 250, img.length];
        const key = '/dji-media/media/DJI_20261026101530_0001_W.JPG';
        const init = await fetch(`${app.base}${key}?uploads`, { method: 'POST' });
        const uploadId = /<UploadId>([a-f0-9]+)<\/UploadId>/.exec(await init.text())[1];
        for (const i of [2, 0, 1]) {
            const r = await fetch(`${app.base}${key}?partNumber=${i + 1}&uploadId=${uploadId}`, { method: 'PUT', body: img.subarray(cut[i], cut[i + 1]) });
            assert.equal(r.status, 200);
        }
        const done = await fetch(`${app.base}${key}?uploadId=${uploadId}`, { method: 'POST' });
        assert.equal(done.status, 200);
        const rows = await db.query("SELECT * FROM media_files WHERE original_name = 'DJI_20261026101530_0001_W.JPG'");
        assert.equal(rows.length, 1);
        const m = rows[0];
        assert.equal(fs.readFileSync(m.file_path_local).equals(img), true, 'file ghép phải giống hệt file gốc');
        assert.equal(m.ticket_id, ticketId);          // từ phiên Pilot, không còn gán cứng phiếu 1
        assert.equal(m.device_sn, 'AC987654');
        assert.equal(m.latitude, 11.8505);
        assert.equal(m.lens, 'WIDE');
        assert.equal(m.position_quality, 'HIGH');
        assert.equal(m.max_temperature, null);         // ảnh thường không có nhiệt độ giả
        assert.equal(m.source, 'CLOUD');

        // Gửi lại đúng ảnh đó (PUT 1 lần) → nhận là trùng, không thêm dòng
        await fetch(`${app.base}/dji-media/media/copy.JPG`, { method: 'PUT', body: img });
        assert.equal((await db.query('SELECT COUNT(*) n FROM media_files WHERE sha256 = ?', [m.sha256]))[0].n, 1);

        // Callback DJI gắn mã chuyến bay
        await api('POST', '/media/api/v1/workspaces/ws/upload-callback', { name: 'DJI_20261026101530_0001_W.JPG', ext: { flight_id: 'flight-abc' } });
        assert.equal((await db.query('SELECT flight_id FROM media_files WHERE media_id = ?', [m.media_id]))[0].flight_id, 'flight-abc');
        // fast-upload: đã có → 0, chưa có → 513000
        assert.equal((await api('POST', '/media/api/v1/workspaces/ws/fast-upload', { name: 'DJI_20261026101530_0001_W.JPG' })).body.code, 0);
        assert.equal((await api('POST', '/media/api/v1/workspaces/ws/fast-upload', { name: 'NEW.JPG' })).body.code, 513000);

        // Nhập thẻ nhớ: ghép điểm chụp theo hậu tố tên file và theo vị trí (RTK FIX, ≤ 2 m)
        const pt = await api('POST', '/api/assets/photo-points', { asset_type: 'SOLAR_AREA', asset_id: areaId, latitude: 11.851, longitude: 107.001, altitude_m: 30 });
        const pointId = pt.body.data.point_id;
        const form = new FormData();
        form.append('ticket_id', String(ticketId));
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.86, lng: 107.01, source: 'InfraredCamera' })]), `DJI_20261026_0002_T_P${areaId}_${pointId}.JPG`);
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.851005, lng: 107.001005 })]), 'DJI_20261026_0003_W.JPG');
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.851005, lng: 107.001005, rtk: 16 })]), 'DJI_20261026_0004_W.JPG');
        form.append('files', new Blob([img]), 'DJI_dup_W.JPG');
        form.append('files', new Blob(['x']), 'notes.txt');
        const imp = await api('POST', '/api/media/import', form);
        assert.equal(imp.status, 200, JSON.stringify(imp.body));
        const s = imp.body.data;
        assert.equal(s.created, 3);
        assert.equal(s.duplicate, 1);
        assert.equal(s.skipped, 1);
        const byName = Object.fromEntries(s.items.map(i => [i.name, i]));
        assert.equal(byName[`DJI_20261026_0002_T_P${areaId}_${pointId}.JPG`].photo_point_id, pointId);
        assert.equal(byName[`DJI_20261026_0002_T_P${areaId}_${pointId}.JPG`].lens, 'IR');
        assert.equal(byName['DJI_20261026_0003_W.JPG'].photo_point_id, pointId);   // cách ~0,7 m, RTK FIX
        assert.equal(byName['DJI_20261026_0004_W.JPG'].photo_point_id, null);      // RTK chưa FIX → không ghép theo vị trí
        assert.equal(byName['DJI_20261026_0004_W.JPG'].position_quality, 'LOW');
        const sdRows = await db.query("SELECT source, ticket_id FROM media_files WHERE source = 'SD_IMPORT'");
        assert.ok(sdRows.every(r => r.ticket_id === ticketId));

        const noTicket = new FormData();
        noTicket.append('files', new Blob([h.fakeDjiJpeg({ lat: 1, lng: 1 })]), 'a.JPG');
        assert.equal((await api('POST', '/api/media/import', noTicket)).status, 400);
        // Tên file độc hại không ghi ra ngoài thư mục media
        await fetch(`${app.base}/dji-media/media/..%2F..%2Fevil.JPG`, { method: 'PUT', body: h.fakeDjiJpeg({ lat: 2, lng: 2 }) });
        assert.ok(!fs.existsSync(path.join(path.dirname(process.env.MEDIA_DIR), 'evil.JPG')));
    });

    await t.test('kiểm tra đủ ảnh + tuyến bay bù cho vùng thiếu', async () => {
        const ticket = await api('POST', '/api/tickets', { ticket_name: 'Kiểm tra phủ', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' });
        const ticketId = ticket.body.data.ticket_id;
        // 2 ảnh nhiệt ở góc Tây Nam khu INV-01 (khu ~218 × 222 m)
        for (const [lat, lng] of [[11.8502, 107.0002], [11.8504, 107.0002]]) {
            await db.query(
                `INSERT INTO media_files (ticket_id, device_sn, file_name, file_url, lens, media_type, latitude, longitude, relative_altitude, gimbal_pitch, gimbal_yaw, position_quality)
                 VALUES (?, 'AC', ?, '/u', 'IR', 'THERMAL_PHOTO', ?, ?, 34.8, -90, 90, 'HIGH')`,
                [ticketId, `cov_${lat}.JPG`, lat, lng]
            );
        }
        const c = await api('GET', `/api/coverage?area_id=${areaId}&ticket_id=${ticketId}&lens=ir`);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        const d = c.body.data;
        assert.equal(d.photos_used, 2);
        assert.ok(d.coverage_pct > 0 && d.coverage_pct < 20, `phủ ${d.coverage_pct}%`);
        assert.ok(d.gap_count >= 1);
        assert.equal(d.ticket_photos.total, 2);
        assert.equal(d.points.length, 2);

        // Tuyến bay bù chỉ cho vùng thiếu lớn nhất
        const grid = (await api('GET', '/api/capture-profiles')).body.data.find(p => p.profile_code === 'SOLAR_THERMAL');
        const fill = await api('POST', '/api/flight-plans/preview', { profile_id: grid.profile_id, area_id: areaId, polygon: d.gaps[0].polygon });
        assert.equal(fill.status, 200, JSON.stringify(fill.body));
        assert.ok(fill.body.data.stats.photo_count > 0);
        const bad = await api('POST', '/api/flight-plans/preview', { profile_id: grid.profile_id, area_id: areaId, polygon: { type: 'Point', coordinates: [1, 1] } });
        assert.equal(bad.status, 400);
        assert.equal((await api('GET', `/api/coverage?area_id=${areaId}`)).status, 400); // thiếu phiếu
    });

    await t.test('xuất bộ ảnh cho Vision: lọc, ZIP ảnh gốc + manifest ghép cặp', async () => {
        const ticket = await api('POST', '/api/tickets', { ticket_name: 'Bộ ảnh Vision', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' });
        const ticketId = ticket.body.data.ticket_id;
        // 1 cặp nhiệt + thường (cùng lượt chụp) nằm trong khu INV-01, RTK FIX; 1 ảnh RTK kém
        const form = new FormData();
        form.append('ticket_id', String(ticketId));
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.8510, lng: 107.0010, source: 'InfraredCamera' })]), 'DJI_20261026101530_0007_T.JPG');
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.8510, lng: 107.0010, source: 'WideCamera' })]), 'DJI_20261026101530_0007_W.JPG');
        form.append('files', new Blob([h.fakeDjiJpeg({ lat: 11.8511, lng: 107.0011, rtk: 16 })]), 'DJI_20261026101531_0008_W.JPG');
        assert.equal((await api('POST', '/api/media/import', form)).body.data.created, 3);

        const pv = await api('GET', `/api/datasets/preview?ticket_id=${ticketId}&area_id=${areaId}`);
        assert.equal(pv.status, 200, JSON.stringify(pv.body));
        assert.equal(pv.body.data.count, 3);
        assert.equal(pv.body.data.pairs, 2);
        assert.deepEqual(pv.body.data.by_lens, { IR: 1, WIDE: 2 });
        const fix = await api('GET', `/api/datasets/preview?ticket_id=${ticketId}&quality=HIGH`);
        assert.equal(fix.body.data.count, 2);
        assert.equal((await api('GET', `/api/datasets/preview?ticket_id=${ticketId}&lens=THERMAL`)).status, 400);
        assert.equal((await api('GET', `/api/datasets/preview?ticket_id=${ticketId}&from=26-10-2026`)).status, 400);

        const res = await fetch(`${app.base}/api/datasets/export?ticket_id=${ticketId}&quality=HIGH`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-disposition'), /dataset_phieu\d+_/);
        const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
        const names = zip.getEntries().map(e => e.entryName).sort();
        assert.ok(names.includes('manifest.json') && names.includes('manifest.csv') && names.includes('README.txt'));
        assert.equal(names.filter(n => n.startsWith('images/IR/')).length, 1);
        assert.equal(names.filter(n => n.startsWith('images/WIDE/')).length, 1);
        const man = JSON.parse(zip.readAsText('manifest.json'));
        assert.equal(man.count, 2);
        assert.equal(new Set(man.images.map(i => i.pair_key)).size, 1, 'ảnh nhiệt và ảnh thường cùng lượt có cùng pair_key');
        assert.equal(man.images[0].position_quality, 'HIGH');
        assert.equal(man.images[0].ticket_code, ticket.body.data.ticket_code);
        const csv = zip.readAsText('manifest.csv');
        assert.equal(csv.trim().split('\r\n').length, 3);
        // File ảnh trong ZIP giống hệt ảnh gốc
        const irEntry = zip.getEntries().find(e => e.entryName.startsWith('images/IR/'));
        const irRow = (await db.query("SELECT file_path_local FROM media_files WHERE original_name = 'DJI_20261026101530_0007_T.JPG'"))[0];
        assert.ok(irEntry.getData().equals(fs.readFileSync(irRow.file_path_local)));
        assert.equal((await api('GET', '/api/datasets/export?ticket_id=999999')).status, 400);
    });

    await t.test('làm sạch ảnh cũ: đọc lại giá trị thật từ file, xóa giá trị giả khi mất file', async () => {
        const ingest = require('../src/services/mediaIngest');
        const file = path.join(process.env.MEDIA_DIR, 'legacy_DJI_0099_T.JPG');
        fs.writeFileSync(file, h.fakeDjiJpeg({ lat: 11.8520, lng: 107.0020, source: 'InfraredCamera' }));
        // Dòng do code cũ tạo: tọa độ Lộc Ninh và 68,5 °C viết sẵn, không có sha256
        const a = await db.query(`INSERT INTO media_files (ticket_id, device_sn, file_name, file_url, file_path_local, media_type, latitude, longitude, max_temperature, has_hotspot)
            VALUES (NULL, 'Mavic 3T', 'legacy_DJI_0099_T.JPG', '/u', ?, 'THERMAL_PHOTO', 11.8312, 106.5913, 68.5, 1)`, [file]);
        const b = await db.query(`INSERT INTO media_files (ticket_id, device_sn, file_name, file_url, file_path_local, media_type, latitude, longitude, max_temperature, has_hotspot)
            VALUES (NULL, 'Mavic 3T', 'gone.JPG', '/u', '/khong/con/gone.JPG', 'RGB_PHOTO', 11.8312, 106.5913, 36.5, 0)`);
        const r = await ingest.backfillLegacy();
        assert.ok(r.fixed >= 1 && r.missing >= 1);
        const [ra] = await db.query('SELECT * FROM media_files WHERE media_id = ?', [a.insertId]);
        assert.equal(ra.latitude, 11.852);
        assert.equal(ra.lens, 'IR');
        assert.equal(ra.position_quality, 'HIGH');
        assert.equal(ra.has_hotspot, 0);
        assert.ok(ra.sha256);
        assert.notEqual(ra.max_temperature, 68.5); // ảnh giả lập không có dữ liệu nhiệt → không còn 68,5 viết sẵn
        const [rb] = await db.query('SELECT * FROM media_files WHERE media_id = ?', [b.insertId]);
        assert.equal(rb.latitude, null);
        assert.equal(rb.max_temperature, null);
        assert.equal(rb.lens, 'WIDE');
        // Chạy lại không đụng gì nữa
        const again = await ingest.backfillLegacy();
        assert.equal(again.fixed, 0);
    });

    await t.test('thư viện đường bay: nhập KMZ cũ từ thư mục, tìm theo mã cố định, không đoán tuyến', async () => {
        const lib = require('../src/services/routeLibrary');
        fs.mkdirSync(lib.WAYLINE_DIR, { recursive: true });
        fs.writeFileSync(path.join(lib.WAYLINE_DIR, 'DJI_Mission_1700000000_Tuyen_cu_A.kmz'), new AdmZip().toBuffer());
        assert.equal(await lib.importDiskKmz(), 1);
        assert.equal(await lib.importDiskKmz(), 0); // chạy lại không nhân đôi
        const [row] = await db.query("SELECT * FROM flight_routes WHERE kmz_file_name = 'DJI_Mission_1700000000_Tuyen_cu_A.kmz'");
        assert.equal(row.route_name, 'Tuyen cu A');
        assert.equal(row.route_kind, 'MANUAL');
        assert.match(row.route_uuid, /^[0-9a-f-]{36}$/);
        assert.equal((await lib.findRoute(row.route_uuid)).route_id, row.route_id);
        assert.equal((await lib.findRoute(String(row.route_id))).route_uuid, row.route_uuid);
        assert.equal(await lib.findRoute('khong-ton-tai'), null);
        assert.equal(await lib.findRoute(''), null);

        // KMZ cũ có độ cao theo mực nước biển (EGM96) → gắn nhãn cảnh báo; KMZ đúng (relativeToStartPoint) giữ nguyên
        const { buildManualKmz } = require('../src/services/wpmlBuilder');
        const good = buildManualKmz({ name: 'ok', waypoints: [{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1 }], altitude: 30, speed: 4 });
        const oldZip = new AdmZip();
        oldZip.addFile('wpmz/waylines.wpml', Buffer.from('<kml><wpml:executeHeightMode>EGM96</wpml:executeHeightMode></kml>'));
        fs.writeFileSync(path.join(lib.WAYLINE_DIR, 'DJI_Mission_1_Cu_EGM96.kmz'), oldZip.toBuffer());
        fs.writeFileSync(path.join(lib.WAYLINE_DIR, 'DJI_Mission_2_Moi_dung.kmz'), good.buffer);
        assert.equal(await lib.importDiskKmz(), 2);
        assert.equal(lib.kmzHeightMode(path.join(lib.WAYLINE_DIR, 'DJI_Mission_2_Moi_dung.kmz')), 'relativeToStartPoint');
        assert.equal(await lib.flagUnsafeHeight(), 1);
        assert.equal(await lib.flagUnsafeHeight(), 0); // không gắn nhãn 2 lần
        const [bad] = await db.query("SELECT route_name, description FROM flight_routes WHERE kmz_file_name = 'DJI_Mission_1_Cu_EGM96.kmz'");
        assert.match(bad.route_name, /^⚠ /);
        assert.match(bad.description, /mực nước biển/);
        const [ok2] = await db.query("SELECT route_name FROM flight_routes WHERE kmz_file_name = 'DJI_Mission_2_Moi_dung.kmz'");
        assert.equal(ok2.route_name, 'Moi dung');
    });

    await t.test('gán đường bay vào phiếu: nhiều tuyến / phiếu, đồng bộ assigned_route_id', async () => {
        const tk = (await api('POST', '/api/tickets', { ticket_name: 'Phiếu có tuyến', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' })).body.data;
        const grid = (await api('GET', '/api/capture-profiles')).body.data.find(p => p.profile_code === 'SOLAR_THERMAL');
        const r1 = (await api('POST', '/api/flight-plans', { profile_id: grid.profile_id, area_id: areaId, route_name: 'Tuyến chính', ticket_id: tk.ticket_id })).body.data;
        const r2 = (await api('POST', '/api/flight-plans', { profile_id: grid.profile_id, area_id: areaId, route_name: 'Tuyến bù' })).body.data;
        assert.equal((await api('POST', `/api/flight-plans/${r2.route_id}/tickets`, { ticket_id: tk.ticket_id })).status, 200);
        let detail = (await api('GET', `/api/tickets/${tk.ticket_id}`)).body.data;
        assert.deepEqual(detail.routes.map(r => r.route_name), ['Tuyến chính', 'Tuyến bù']);
        assert.equal(detail.ticket.assigned_route_id, r1.route_id);
        const list = (await api('GET', '/api/flight-plans')).body.data;
        assert.deepEqual(list.find(r => r.route_id === r1.route_id).tickets, [{ ticket_id: tk.ticket_id, ticket_code: tk.ticket_code }]);
        // Đổi thứ tự, bỏ tuyến
        assert.equal((await api('PUT', `/api/tickets/${tk.ticket_id}/routes`, { route_ids: [r2.route_id, r1.route_id] })).status, 200);
        detail = (await api('GET', `/api/tickets/${tk.ticket_id}`)).body.data;
        assert.equal(detail.ticket.assigned_route_id, r2.route_id);
        assert.equal((await api('DELETE', `/api/flight-plans/${r2.route_id}/tickets/${tk.ticket_id}`)).status, 200);
        detail = (await api('GET', `/api/tickets/${tk.ticket_id}`)).body.data;
        assert.equal(detail.routes.length, 1);
        assert.equal(detail.ticket.assigned_route_id, r1.route_id);
        assert.equal((await api('PUT', `/api/tickets/${tk.ticket_id}/routes`, { route_ids: [999999] })).status, 400);
        assert.equal((await api('POST', `/api/flight-plans/${r1.route_id}/tickets`, { ticket_id: 999999 })).status, 404);
        // Phiếu có 2 tuyến, xóa tuyến đầu → "tuyến đầu tiên" chuyển sang tuyến còn lại
        await api('POST', `/api/flight-plans/${r2.route_id}/tickets`, { ticket_id: tk.ticket_id });
        await api('DELETE', `/api/flight-plans/${r1.route_id}`);
        detail = (await api('GET', `/api/tickets/${tk.ticket_id}`)).body.data;
        assert.equal(detail.ticket.assigned_route_id, r2.route_id);
        // Xóa tuyến còn lại → phiếu không còn tuyến
        await api('DELETE', `/api/flight-plans/${r2.route_id}`);
        detail = (await api('GET', `/api/tickets/${tk.ticket_id}`)).body.data;
        assert.equal(detail.routes.length, 0);
        assert.equal(detail.ticket.assigned_route_id, null);
    });

    await t.test('Pilot 2: thư viện đường bay chỉ gồm tuyến của phiếu đang bay', async () => {
        const ingest = require('../src/services/mediaIngest');
        const grid = (await api('GET', '/api/capture-profiles')).body.data.find(p => p.profile_code === 'SOLAR_THERMAL');
        const tkA = (await api('POST', '/api/tickets', { ticket_name: 'Pilot A', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' })).body.data;
        const tkB = (await api('POST', '/api/tickets', { ticket_name: 'Pilot B', inspection_type: 'SOLAR_PANEL', target_facility: 'INV-01' })).body.data;
        const rA = (await api('POST', '/api/flight-plans', { profile_id: grid.profile_id, area_id: areaId, route_name: 'Tuyến của A', ticket_id: tkA.ticket_id })).body.data;
        await api('POST', '/api/flight-plans', { profile_id: grid.profile_id, area_id: areaId, route_name: 'Tuyến khác' });
        const base = '/wayline/api/v1/workspaces/ws1/waylines';

        await ingest.startPilotSession({ user: null, ticketId: tkA.ticket_id, rcSn: 'RCPILOT1' });
        let list = (await api('GET', base)).body.data;
        assert.deepEqual(list.list.map(w => w.name), ['Tuyến của A']);
        assert.equal(list.list[0].id, rA.route_uuid);
        assert.equal(list.list[0].drone_model_key, '0-77-1');

        // Phiếu chưa gán tuyến: thấy cả thư viện
        await ingest.startPilotSession({ user: null, ticketId: tkB.ticket_id, rcSn: 'RCPILOT1' });
        list = (await api('GET', base)).body.data;
        assert.ok(list.list.length >= 2);
        assert.equal((await api('GET', `${base}?key=khác`)).body.data.list.length, 1);

        const detail = await api('GET', `${base}/${rA.route_uuid}`);
        assert.equal(detail.body.data.name, 'Tuyến của A');
        const url = await api('GET', `${base}/${rA.route_uuid}/url?format=json`);
        assert.match(url.body.data.url, /\/uploads\/waylines\/DJI_Mission_.+\.kmz$/);
        assert.equal(url.body.data.md5, rA.kmz_md5);
        const redirect = await fetch(`${app.base}${base}/${rA.route_uuid}/url`, { redirect: 'manual' });
        assert.equal(redirect.status, 302);
        const dl = await fetch(`${app.base}${base}/${rA.route_uuid}/download`);
        assert.equal(dl.status, 200);
        assert.equal((await api('GET', `${base}/khong-co-tuyen-nay`)).status, 404);
        assert.equal((await api('GET', `${base}/khong-co-tuyen-nay/url?format=json`)).status, 404);
        assert.equal((await api('GET', `/manage/api/v1/workspaces/ws1/waylines/duplicate-names`)).body.code, 0);
    });

    await t.test('mất CSDL: API trả 503, không trả dữ liệu mẫu', async () => {
        await db.closePool();
        const r = await api('GET', '/api/solar/areas');
        assert.equal(r.status, 503);
        const tickets = await api('GET', '/api/tickets');
        assert.equal(tickets.status, 503);
        assert.equal(db.getStatus().connected, false);
    });
});
