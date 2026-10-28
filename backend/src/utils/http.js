/**
 * Tiện ích cho router Express: bọc async và đổi lỗi thành mã HTTP rõ ràng.
 */
const { DbUnavailableError } = require('../config/db');
const { ValidationError } = require('./validate');

class NotFoundError extends Error {
    constructor(message = 'Không tìm thấy dữ liệu') {
        super(message);
        this.name = 'NotFoundError';
        this.status = 404;
    }
}

// Lỗi MySQL hay gặp -> thông báo dễ hiểu cho người dùng
const MYSQL_ERRORS = {
    ER_DUP_ENTRY: { status: 409, message: 'Mã này đã tồn tại, hãy dùng mã khác' },
    ER_NO_REFERENCED_ROW_2: { status: 400, message: 'Đối tượng cha (khu vực / chuỗi / ngăn lộ...) không tồn tại' },
    ER_ROW_IS_REFERENCED_2: { status: 409, message: 'Không xóa được vì đang có dữ liệu khác liên kết tới' },
    ER_DATA_TOO_LONG: { status: 400, message: 'Có trường dữ liệu dài quá giới hạn' },
    ER_BAD_NULL_ERROR: { status: 400, message: 'Thiếu dữ liệu bắt buộc' },
    WARN_DATA_TRUNCATED: { status: 400, message: 'Giá trị không hợp lệ cho một trường dữ liệu' }
};

// Lỗi không lường trước: chỉ ghi chi tiết vào log máy chủ, không trả nội dung lỗi SQL cho trình duyệt
const GENERIC_500 = 'Lỗi máy chủ. Vui lòng thử lại hoặc báo quản trị viên (chi tiết đã ghi vào log).';

function toHttpError(err) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
        return { status: err.status, message: err.message };
    }
    if (err instanceof DbUnavailableError) {
        return { status: 503, message: err.message };
    }
    if (err && MYSQL_ERRORS[err.code]) {
        return MYSQL_ERRORS[err.code];
    }
    return { status: 500, message: GENERIC_500 };
}

/** Bọc handler async: mọi lỗi được trả về JSON { code, message }. */
function asyncHandler(fn) {
    return async (req, res, next) => {
        try {
            await fn(req, res, next);
        } catch (err) {
            const { status, message } = toHttpError(err);
            if (err instanceof DbUnavailableError) console.warn(`[API] ${req.method} ${req.originalUrl}: CSDL chưa sẵn sàng`);
            else if (status >= 500) console.error(`[API] ${req.method} ${req.originalUrl}:`, err);
            if (!res.headersSent) res.status(status).json({ code: status, message });
        }
    };
}

function ok(res, data, message) {
    const body = { code: 0, data };
    if (message) body.message = message;
    return res.json(body);
}

module.exports = { asyncHandler, ok, toHttpError, NotFoundError };
