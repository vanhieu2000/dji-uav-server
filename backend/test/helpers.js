/**
 * Dựng CSDL test riêng (mặc định dji_uav_test) từ mysql_init/01_schema.sql + migrations.
 * KHÔNG đụng tới CSDL thật. Tên CSDL test bắt buộc chứa chữ "test".
 */
const fs = require('fs');
const path = require('path');

try { process.loadEnvFile(path.join(__dirname, '..', '..', '.env')); } catch (e) { /* không có .env */ }

const TEST_DB = process.env.TEST_MYSQL_DATABASE || 'dji_uav_test';
if (!/test/i.test(TEST_DB)) throw new Error('Tên CSDL test phải chứa "test" để tránh xóa nhầm dữ liệu thật');

// Phải đặt trước khi nạp src/config/db.js
process.env.MYSQL_DATABASE = TEST_DB;
process.env.BASEMAP_TILES_DIR = path.join(require('os').tmpdir(), `uav-test-tiles-${process.pid}`);
process.env.WAYLINE_DIR = path.join(require('os').tmpdir(), `uav-test-waylines-${process.pid}`);
process.env.MEDIA_DIR = path.join(require('os').tmpdir(), `uav-test-media-${process.pid}`, 'media');

/** JPEG giả lập có khối XMP drone-dji như ảnh M3T thật (đủ để đọc metadata, không phải ảnh xem được). */
function fakeDjiJpeg({ lat, lng, rtk = 50, rel = 34.8, pitch = -90, yaw = 90, source = 'WideCamera', date = '2026:10:26 10:15:30', extra = '' }) {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreateDate="${date}"
 drone-dji:GpsLatitude="${lat}" drone-dji:GpsLongitude="${lng}" drone-dji:AbsoluteAltitude="+120.5" drone-dji:RelativeAltitude="+${rel}"
 drone-dji:GimbalPitchDegree="${pitch}" drone-dji:GimbalYawDegree="${yaw}" drone-dji:GimbalRollDegree="0.00" drone-dji:FlightYawDegree="${yaw}"
 drone-dji:RtkFlag="${rtk}" drone-dji:RtkStdLon="0.012" drone-dji:RtkStdLat="0.015" drone-dji:RtkStdHgt="0.02" drone-dji:ImageSource="${source}"/></rdf:RDF></x:xmpmeta>${extra}`;
    const body = Buffer.from(xmp, 'utf8');
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from(`noise-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

const mysql = require('mysql2/promise');
const express = require('express');

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'mysql_init', '01_schema.sql');

function rootConfig() {
    return {
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || ''
    };
}

/** true nếu kết nối được MySQL (để bỏ qua test tích hợp khi máy không có MySQL). */
async function mysqlAvailable() {
    try {
        const c = await mysql.createConnection(rootConfig());
        await c.end();
        return true;
    } catch (e) {
        return false;
    }
}

/** Tạo lại CSDL test từ đầu. */
async function resetTestDatabase() {
    let sql = fs.readFileSync(SCHEMA_FILE, 'utf-8').replace(/dji_uav_management/g, TEST_DB);
    if (sql.includes('dji_uav_management')) throw new Error('Không đổi được tên CSDL trong schema');
    const conn = await mysql.createConnection({ ...rootConfig(), multipleStatements: true });
    try {
        await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
        await conn.query(sql);
    } finally {
        await conn.end();
    }
    const { runMigrations } = require('../src/db/migrate');
    await runMigrations({ ...rootConfig(), database: TEST_DB }, { log: () => {} });
}

async function dropTestDatabase() {
    const conn = await mysql.createConnection(rootConfig());
    try {
        await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    } finally {
        await conn.end();
    }
}

/** App Express tối giản gắn các router cần test, chạy trên cổng ngẫu nhiên. */
async function startTestApp() {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(require('../src/routes/mediaUpload'));
    app.use(require('../src/routes/pilotWaylines'));
    app.use('/api/solar', require('../src/routes/solar'));
    app.use('/api/substation', require('../src/routes/substation'));
    app.use('/api/assets', require('../src/routes/assets'));
    app.use('/api/basemaps', require('../src/routes/basemaps'));
    app.use('/api/tickets', require('../src/routes/tickets'));
    app.use('/api/capture-profiles', require('../src/routes/captureProfiles'));
    app.use('/api/flight-plans', require('../src/routes/flightPlans'));
    app.use('/api/coverage', require('../src/routes/coverage'));
    app.use('/api/datasets', require('../src/routes/datasets'));
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    async function api(method, url, body) {
        const init = { method, headers: {} };
        if (body instanceof FormData) {
            init.body = body;
        } else if (body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const res = await fetch(base + url, init);
        const json = await res.json().catch(() => null);
        return { status: res.status, body: json };
    }
    return { server, base, api, close: () => new Promise(r => server.close(r)) };
}

module.exports = { TEST_DB, rootConfig, mysqlAvailable, resetTestDatabase, dropTestDatabase, startTestApp, fakeDjiJpeg };
