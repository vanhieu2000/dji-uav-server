/**
 * Tạo câu UPDATE chỉ gồm các trường người dùng gửi lên.
 */
const { ValidationError } = require('./validate');
const { NotFoundError } = require('./http');

/**
 * @param {object} body  req.body
 * @param {Record<string, (v: any) => any>} parsers  tên cột -> hàm kiểm tra / chuẩn hóa
 * @returns {Record<string, any>} các cột có trong body, đã chuẩn hóa
 */
function pickFields(body, parsers) {
    const out = {};
    const src = body || {};
    for (const [col, parse] of Object.entries(parsers)) {
        if (Object.prototype.hasOwnProperty.call(src, col)) {
            out[col] = parse(src[col]);
        }
    }
    return out;
}

/**
 * Chạy UPDATE <table> SET ... WHERE <idCol> = ?.
 * Tên bảng / cột chỉ lấy từ code (không từ người dùng).
 */
async function updateById(queryFn, table, idCol, id, fields) {
    const cols = Object.keys(fields);
    if (!cols.length) throw new ValidationError('Không có trường nào để cập nhật');
    const setSql = cols.map(c => `\`${c}\` = ?`).join(', ');
    const result = await queryFn(
        `UPDATE \`${table}\` SET ${setSql} WHERE \`${idCol}\` = ?`,
        [...cols.map(c => fields[c]), id]
    );
    if (!result.affectedRows) throw new NotFoundError();
    return result;
}

async function deleteById(queryFn, table, idCol, id) {
    const result = await queryFn(`DELETE FROM \`${table}\` WHERE \`${idCol}\` = ?`, [id]);
    if (!result.affectedRows) throw new NotFoundError();
    // Dọn điểm chụp ảnh của tài sản vừa xóa và của tài sản con bị xóa dây chuyền
    if (TABLES_WITH_PHOTO_POINTS.has(table)) {
        await require('../services/photoPoints').deleteOrphanPhotoPoints();
    }
    return result;
}

const TABLES_WITH_PHOTO_POINTS = new Set([
    'solar_areas', 'solar_strings', 'solar_panels', 'substations', 'substation_bays', 'disconnectors', 'dcl_contacts'
]);

module.exports = { pickFields, updateById, deleteById };
