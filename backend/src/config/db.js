const mysql = require('mysql2/promise');

// Cấu hình lấy từ biến môi trường (.env hoặc docker-compose). Không ghi cứng mật khẩu.
const dbConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'dji_uav_management',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: false
};

const RECONNECT_INTERVAL_MS = 10000;
// Mã lỗi cho thấy mất kết nối (khác lỗi cú pháp SQL)
const CONNECTION_ERROR_CODES = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH',
    'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR'
]);

let pool = null;
let isConnected = false;
let lastError = null;
let reconnectTimer = null;
const statusListeners = new Set();

/** Lỗi trả về khi CSDL không sẵn sàng. Router chuyển thành HTTP 503. */
class DbUnavailableError extends Error {
    constructor(message = 'Mất kết nối cơ sở dữ liệu. Vui lòng kiểm tra MySQL.') {
        super(message);
        this.name = 'DbUnavailableError';
        this.code = 'DB_UNAVAILABLE';
        this.status = 503;
    }
}

function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

function setConnected(value, err) {
    const changed = isConnected !== value;
    isConnected = value;
    lastError = err ? (err.code || err.message) : null;
    if (changed) {
        statusListeners.forEach(fn => {
            try { fn(getStatus()); } catch (e) { /* listener lỗi không ảnh hưởng DB */ }
        });
    }
    if (!value) scheduleReconnect();
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setInterval(async () => {
        const ok = await testConnection();
        if (ok && reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    }, RECONNECT_INTERVAL_MS);
    if (reconnectTimer.unref) reconnectTimer.unref();
}

async function testConnection() {
    try {
        const conn = await getPool().getConnection();
        conn.release();
        if (!isConnected) {
            console.log(`[CSDL] ✓ Đã kết nối ${dbConfig.database} @ ${dbConfig.host}:${dbConfig.port}`);
        }
        setConnected(true);
        return true;
    } catch (err) {
        if (isConnected || !lastError) {
            console.warn(`[CSDL] ⚠ Không kết nối được MySQL (${err.code || err.message}). Tự thử lại mỗi ${RECONNECT_INTERVAL_MS / 1000}s.`);
        }
        setConnected(false, err);
        return false;
    }
}

/**
 * Chạy câu lệnh SQL có tham số.
 * Ném DbUnavailableError khi mất kết nối, ném lỗi gốc khi SQL sai.
 */
async function query(sql, params = []) {
    if (!isConnected) {
        throw new DbUnavailableError();
    }
    try {
        const [rows] = await getPool().execute(sql, params);
        return rows;
    } catch (err) {
        if (CONNECTION_ERROR_CODES.has(err.code) || err.fatal) {
            setConnected(false, err);
            throw new DbUnavailableError();
        }
        throw err;
    }
}

/** Chạy nhiều câu lệnh trong một transaction. fn nhận (conn) và dùng conn.execute. */
async function withTransaction(fn) {
    if (!isConnected) throw new DbUnavailableError();
    let conn;
    try {
        conn = await getPool().getConnection();
    } catch (err) {
        setConnected(false, err);
        throw new DbUnavailableError();
    }
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try { await conn.rollback(); } catch (e) { /* bỏ qua lỗi rollback */ }
        throw err;
    } finally {
        conn.release();
    }
}

function getStatus() {
    return {
        connected: isConnected,
        database: dbConfig.database,
        host: `${dbConfig.host}:${dbConfig.port}`,
        last_error: lastError
    };
}

function onStatusChange(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

/** Middleware lỗi chung: DbUnavailableError -> 503, còn lại -> 500. */
function sendDbError(res, err) {
    if (err instanceof DbUnavailableError) {
        return res.status(503).json({ code: 503, message: err.message });
    }
    // Chi tiết lỗi SQL chỉ ghi log, không trả cho trình duyệt
    console.error('[API Error]', err);
    return res.status(500).json({ code: 500, message: 'Lỗi máy chủ. Chi tiết đã ghi vào log.' });
}

async function closePool() {
    if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    }
    if (pool) {
        const p = pool;
        pool = null;
        isConnected = false;
        await p.end();
    }
}

module.exports = {
    dbConfig,
    getPool,
    testConnection,
    query,
    withTransaction,
    getStatus,
    onStatusChange,
    sendDbError,
    closePool,
    DbUnavailableError,
    isDbConnected: () => isConnected
};
