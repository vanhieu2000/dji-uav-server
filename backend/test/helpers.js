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
    app.use('/api/solar', require('../src/routes/solar'));
    app.use('/api/substation', require('../src/routes/substation'));
    app.use('/api/assets', require('../src/routes/assets'));
    app.use('/api/basemaps', require('../src/routes/basemaps'));
    app.use('/api/tickets', require('../src/routes/tickets'));
    app.use('/api/capture-profiles', require('../src/routes/captureProfiles'));
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

module.exports = { TEST_DB, rootConfig, mysqlAvailable, resetTestDatabase, dropTestDatabase, startTestApp };
