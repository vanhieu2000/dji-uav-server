/**
 * Bộ chạy nâng cấp CSDL (migration).
 * - Đọc các file .sql trong src/db/migrations theo thứ tự tên.
 * - Mỗi file chỉ chạy 1 lần, ghi lại trong bảng schema_migrations.
 * - Không xóa dữ liệu có sẵn.
 *
 * Chạy tay: npm run migrate   (tự động chạy khi server kết nối được MySQL)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Lỗi "đã tồn tại": câu lệnh đã được áp dụng ở lần chạy trước bị dừng giữa chừng -> bỏ qua
const ALREADY_APPLIED_CODES = new Set([
    'ER_DUP_FIELDNAME',   // cột đã có
    'ER_DUP_KEYNAME',     // chỉ mục đã có
    'ER_FK_DUP_NAME',     // khóa ngoại đã có
    'ER_TABLE_EXISTS_ERROR'
]);
const LOCK_NAME = 'dji_uav_schema_migrations';
const LOCK_TIMEOUT_S = 60;

/** Tách file SQL thành từng câu lệnh (bỏ dòng chú thích "--"). */
function splitStatements(sql) {
    return sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(/;\s*(?:\r?\n|$)/)
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Tách "ALTER TABLE t ADD ..., ADD ..., ADD ..." thành từng câu ALTER một phần.
 * Dùng khi câu gộp báo "đã tồn tại": chạy lại từng phần để không bỏ sót phần chưa có.
 * Trả null nếu không phải ALTER TABLE nhiều phần.
 */
function splitAlterClauses(stmt) {
    const m = /^\s*ALTER\s+TABLE\s+(`[^`]+`|\w+)\s+([\s\S]+)$/i.exec(stmt);
    if (!m) return null;
    const parts = [];
    let depth = 0;
    let quote = null;
    let cur = '';
    for (const ch of m[2]) {
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
        } else if (ch === '(') {
            depth += 1;
        } else if (ch === ')') {
            depth -= 1;
        } else if (ch === ',' && depth === 0) {
            parts.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.length > 1 ? parts.map(p => `ALTER TABLE ${m[1]} ${p}`) : null;
}

/** Chạy 1 câu; lỗi "đã tồn tại" ở câu ALTER gộp thì chạy lại từng phần. */
async function runStatement(conn, stmt, file, log) {
    try {
        await conn.query(stmt);
        return;
    } catch (err) {
        if (!ALREADY_APPLIED_CODES.has(err.code)) {
            err.message = `${file}: ${err.message}`;
            throw err;
        }
        const pieces = splitAlterClauses(stmt);
        if (!pieces) {
            log(`[Migration]   bỏ qua (đã có): ${stmt.split('\n')[0].slice(0, 80)}`);
            return;
        }
        for (const piece of pieces) {
            try {
                await conn.query(piece);
            } catch (e) {
                if (!ALREADY_APPLIED_CODES.has(e.code)) {
                    e.message = `${file}: ${e.message}`;
                    throw e;
                }
                log(`[Migration]   bỏ qua (đã có): ${piece.slice(0, 100)}`);
            }
        }
    }
}

function listMigrationFiles(dir = MIGRATIONS_DIR) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
}

/**
 * Áp dụng các migration chưa chạy.
 * @param {object} config cấu hình kết nối mysql2 (host, port, user, password, database)
 * @param {{ dir?: string, log?: (msg: string) => void }} [options]
 * @returns {Promise<string[]>} danh sách file vừa áp dụng
 */
async function runMigrations(config, options = {}) {
    const dir = options.dir || MIGRATIONS_DIR;
    const log = options.log || (msg => console.log(msg));
    const conn = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        charset: 'utf8mb4',
        database: config.database
    });
    const applied = [];
    let locked = false;
    try {
        // Khóa: nếu 2 tiến trình server cùng khởi động, chỉ 1 tiến trình chạy migration
        const [[lock]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [LOCK_NAME, LOCK_TIMEOUT_S]);
        if (!lock || lock.ok !== 1) throw new Error('Không lấy được khóa migration (tiến trình khác đang chạy quá lâu)');
        locked = true;
        await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(190) NOT NULL PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        const [rows] = await conn.query('SELECT name FROM schema_migrations');
        const done = new Set(rows.map(r => r.name));

        for (const file of listMigrationFiles(dir)) {
            if (done.has(file)) continue;
            const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
            log(`[Migration] Đang áp dụng ${file}...`);
            // Chạy từng câu: lần trước dừng giữa chừng thì các câu đã xong được bỏ qua
            for (const stmt of splitStatements(sql)) {
                await runStatement(conn, stmt, file, log);
            }
            await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
            applied.push(file);
            log(`[Migration] ✓ ${file}`);
        }
    } finally {
        if (locked) {
            try { await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (e) { /* đóng kết nối cũng nhả khóa */ }
        }
        await conn.end();
    }
    return applied;
}

module.exports = { runMigrations, listMigrationFiles, splitStatements, splitAlterClauses, MIGRATIONS_DIR };

if (require.main === module) {
    try { process.loadEnvFile(path.join(__dirname, '..', '..', '..', '.env')); } catch (e) { /* không có .env */ }
    require('../services/runtimeEnv').load();
    const { dbConfig } = require('../config/db');
    runMigrations(dbConfig)
        .then(list => {
            console.log(list.length ? `Đã áp dụng ${list.length} migration.` : 'CSDL đã ở phiên bản mới nhất.');
            process.exit(0);
        })
        .catch(err => {
            console.error('[Migration] Lỗi:', err.message);
            process.exit(1);
        });
}
