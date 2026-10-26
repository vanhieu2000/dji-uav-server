/**
 * Điểm chụp ảnh gắn với tài sản theo cặp (asset_type, asset_id), không có khóa ngoại.
 * Sau khi xóa tài sản (kể cả xóa dây chuyền khu -> chuỗi -> tấm), gọi hàm này để dọn điểm mồ côi.
 */
const { query } = require('../config/db');

const ASSET_TABLES = {
    SOLAR_AREA: ['solar_areas', 'area_id'],
    SOLAR_STRING: ['solar_strings', 'string_id'],
    SOLAR_PANEL: ['solar_panels', 'panel_id'],
    BAY: ['substation_bays', 'bay_id'],
    DISCONNECTOR: ['disconnectors', 'disconnector_id'],
    DCL_CONTACT: ['dcl_contacts', 'contact_id']
};

/** Xóa điểm chụp có tài sản không còn tồn tại. Trả về số dòng đã xóa. */
async function deleteOrphanPhotoPoints() {
    let removed = 0;
    for (const [type, [table, col]] of Object.entries(ASSET_TABLES)) {
        const r = await query(
            `DELETE pp FROM photo_points pp LEFT JOIN \`${table}\` t ON t.\`${col}\` = pp.asset_id
             WHERE pp.asset_type = ? AND t.\`${col}\` IS NULL`,
            [type]
        );
        removed += r.affectedRows || 0;
    }
    return removed;
}

module.exports = { ASSET_TABLES, deleteOrphanPhotoPoints };
