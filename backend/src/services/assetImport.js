/**
 * Nhập danh mục tài sản từ Excel/CSV theo 2 bước:
 *   1. check:  kiểm tra từng dòng, cho biết sẽ THÊM hay CẬP NHẬT, dòng nào lỗi.
 *   2. commit: ghi vào CSDL trong 1 transaction (lỗi giữa chừng thì không ghi gì).
 * Trình duyệt đọc file Excel rồi gửi lên mảng rows (mỗi dòng là object theo tên cột chuẩn).
 * Tài sản được nối với cha bằng MÃ (area_code, string_code, bay_code...) như cách quản lý hiện tại.
 */
const { query, withTransaction } = require('../config/db');
const v = require('../utils/validate');

const MAX_ROWS = 20000;
const PHASES = ['A', 'B', 'C', '3PHASE'];
const DCL_STATES = ['CLOSED', 'OPEN', 'UNKNOWN'];

/** Mô tả cột của từng loại tài sản: dùng cho mẫu Excel và kiểm tra. */
const ENTITY_COLUMNS = {
    areas: ['area_code', 'area_name', 'center_lat', 'center_lng', 'total_capacity_kwp'],
    strings: ['area_code', 'string_code', 'string_name', 'inverter_channel', 'panel_count', 'rated_power_w'],
    panels: ['area_code', 'string_code', 'panel_index', 'panel_serial', 'latitude', 'longitude', 'altitude'],
    bays: ['substation_code', 'bay_code', 'bay_name', 'description', 'center_lat', 'center_lng'],
    disconnectors: ['substation_code', 'bay_code', 'dcl_code', 'phase', 'dcl_name', 'latitude', 'longitude', 'altitude', 'max_allowed_temp', 'state'],
    contacts: ['substation_code', 'bay_code', 'dcl_code', 'phase', 'contact_code', 'contact_name', 'position_desc', 'latitude', 'longitude', 'max_allowed_temp']
};

// Chỉ được ghi vào các bảng tài sản này (lớp bảo vệ thứ hai cho câu SQL dựng động)
const ALLOWED_TABLES = new Set(['solar_areas', 'solar_strings', 'solar_panels', 'substation_bays', 'disconnectors', 'dcl_contacts']);

/**
 * Khóa so khớp mã: bỏ dấu, bỏ khoảng trắng 2 đầu, không phân biệt hoa thường
 * (giống cách so sánh utf8mb4_unicode_ci của MySQL, để "KV-Á" và "KV-A" coi là trùng).
 */
const norm = p => String(p).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'D').trim().toUpperCase();
const k = (...parts) => parts.map(norm).join('|');

/** Đọc danh mục hiện có của nhà máy vào các Map để tra mã nhanh. */
async function loadLookups(plantId) {
    const [areas, strings, panels, subs, bays, dcls, contacts] = await Promise.all([
        query('SELECT area_id, area_code FROM solar_areas WHERE plant_id = ?', [plantId]),
        query('SELECT s.string_id, s.area_id, s.string_code FROM solar_strings s JOIN solar_areas a ON s.area_id = a.area_id WHERE a.plant_id = ?', [plantId]),
        query('SELECT p.panel_id, p.string_id, p.panel_index FROM solar_panels p JOIN solar_strings s ON p.string_id = s.string_id JOIN solar_areas a ON s.area_id = a.area_id WHERE a.plant_id = ?', [plantId]),
        query('SELECT substation_id, substation_code FROM substations WHERE plant_id = ?', [plantId]),
        query('SELECT b.bay_id, b.substation_id, b.bay_code FROM substation_bays b JOIN substations s ON b.substation_id = s.substation_id WHERE s.plant_id = ?', [plantId]),
        query('SELECT d.disconnector_id, d.bay_id, d.dcl_code, d.phase FROM disconnectors d JOIN substation_bays b ON d.bay_id = b.bay_id JOIN substations s ON b.substation_id = s.substation_id WHERE s.plant_id = ?', [plantId]),
        query('SELECT c.contact_id, c.disconnector_id, c.contact_code FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id = d.disconnector_id JOIN substation_bays b ON d.bay_id = b.bay_id JOIN substations s ON b.substation_id = s.substation_id WHERE s.plant_id = ?', [plantId])
    ]);
    return {
        areas: new Map(areas.map(r => [k(r.area_code), r.area_id])),
        strings: new Map(strings.map(r => [k(r.area_id, r.string_code), r.string_id])),
        panels: new Map(panels.map(r => [k(r.string_id, r.panel_index), r.panel_id])),
        substations: new Map(subs.map(r => [k(r.substation_code), r.substation_id])),
        bays: new Map(bays.map(r => [k(r.substation_id, r.bay_code), r.bay_id])),
        dcls: new Map(dcls.map(r => [k(r.bay_id, r.dcl_code, r.phase), r.disconnector_id])),
        contacts: new Map(contacts.map(r => [k(r.disconnector_id, r.contact_code), r.contact_id]))
    };
}

/** Tra mã cha; báo lỗi rõ ràng nếu thiếu. */
function need(map, key, message) {
    const id = map.get(key);
    if (!id) throw new v.ValidationError(message);
    return id;
}

/**
 * Kiểm tra 1 dòng: trả về { key, table, idCol, existingId, fields } hoặc ném ValidationError.
 * fields: cột -> giá trị sẽ ghi (đã bao gồm khóa ngoại tới cha).
 */
const ROW_PARSERS = {
    areas(r, L, plantId) {
        const code = v.requiredString(r.area_code, 'area_code (mã khu vực)', 50);
        return {
            key: k(code), table: 'solar_areas', idCol: 'area_id', existingId: L.areas.get(k(code)),
            fields: {
                plant_id: plantId,
                area_code: code,
                area_name: v.requiredString(r.area_name, 'area_name (tên khu vực)', 150),
                center_lat: v.optionalLat(r.center_lat, 'center_lat'),
                center_lng: v.optionalLng(r.center_lng, 'center_lng'),
                total_capacity_kwp: v.optionalNumber(r.total_capacity_kwp, 'total_capacity_kwp', { min: 0 })
            }
        };
    },
    strings(r, L) {
        const areaCode = v.requiredString(r.area_code, 'area_code', 50);
        const areaId = need(L.areas, k(areaCode), `Khu vực "${areaCode}" chưa có. Nhập khu vực trước.`);
        const code = v.requiredString(r.string_code, 'string_code (mã chuỗi)', 50);
        return {
            key: k(areaId, code), table: 'solar_strings', idCol: 'string_id', existingId: L.strings.get(k(areaId, code)),
            fields: {
                area_id: areaId,
                string_code: code,
                string_name: v.optionalString(r.string_name, 'string_name', 100),
                inverter_channel: v.optionalString(r.inverter_channel, 'inverter_channel', 50),
                panel_count: v.optionalInt(r.panel_count, 'panel_count', { min: 0, max: 500 }),
                rated_power_w: v.optionalNumber(r.rated_power_w, 'rated_power_w', { min: 0 })
            }
        };
    },
    panels(r, L) {
        const areaCode = v.requiredString(r.area_code, 'area_code', 50);
        const areaId = need(L.areas, k(areaCode), `Khu vực "${areaCode}" chưa có.`);
        const stringCode = v.requiredString(r.string_code, 'string_code', 50);
        const stringId = need(L.strings, k(areaId, stringCode), `Chuỗi "${stringCode}" chưa có trong khu "${areaCode}". Nhập chuỗi trước.`);
        const index = v.requiredInt(r.panel_index, 'panel_index (số thứ tự tấm)', { min: 1, max: 100000 });
        return {
            key: k(stringId, index), table: 'solar_panels', idCol: 'panel_id', existingId: L.panels.get(k(stringId, index)),
            fields: {
                string_id: stringId,
                panel_index: index,
                panel_serial: v.optionalString(r.panel_serial, 'panel_serial', 100),
                latitude: v.optionalLat(r.latitude, 'latitude'),
                longitude: v.optionalLng(r.longitude, 'longitude'),
                altitude: v.optionalNumber(r.altitude, 'altitude')
            }
        };
    },
    bays(r, L) {
        const subCode = v.requiredString(r.substation_code, 'substation_code (mã trạm)', 50);
        const subId = need(L.substations, k(subCode), `Trạm "${subCode}" chưa có.`);
        const code = v.requiredString(r.bay_code, 'bay_code (mã ngăn lộ)', 50);
        return {
            key: k(subId, code), table: 'substation_bays', idCol: 'bay_id', existingId: L.bays.get(k(subId, code)),
            fields: {
                substation_id: subId,
                bay_code: code,
                bay_name: v.requiredString(r.bay_name, 'bay_name (tên ngăn lộ)', 150),
                description: v.optionalString(r.description, 'description', 2000),
                center_lat: v.optionalLat(r.center_lat, 'center_lat'),
                center_lng: v.optionalLng(r.center_lng, 'center_lng')
            }
        };
    },
    disconnectors(r, L) {
        const bayId = resolveBay(r, L);
        const code = v.requiredString(r.dcl_code, 'dcl_code (mã dao cách ly)', 50);
        const phase = v.oneOf(r.phase, PHASES, 'phase (pha)', '3PHASE');
        const existingId = L.dcls.get(k(bayId, code, phase));
        const fields = {
            bay_id: bayId,
            dcl_code: code,
            phase,
            // Tên bắt buộc khi thêm mới: tự đặt nếu để trống
            dcl_name: v.optionalString(r.dcl_name, 'dcl_name', 150) ||
                (existingId ? null : `Dao cách ly ${code}${phase === '3PHASE' ? '' : ' Pha ' + phase}`),
            latitude: v.optionalLat(r.latitude, 'latitude'),
            longitude: v.optionalLng(r.longitude, 'longitude'),
            altitude: v.optionalNumber(r.altitude, 'altitude'),
            state: v.oneOf(r.state, DCL_STATES, 'state', null),
            max_allowed_temp: v.optionalNumber(r.max_allowed_temp, 'max_allowed_temp', { min: 0, max: 300 })
        };
        return { key: k(bayId, code, phase), table: 'disconnectors', idCol: 'disconnector_id', existingId, fields };
    },
    contacts(r, L) {
        const bayId = resolveBay(r, L);
        const dclCode = v.requiredString(r.dcl_code, 'dcl_code', 50);
        const phase = v.oneOf(r.phase, PHASES, 'phase (pha)', '3PHASE');
        const dclId = need(L.dcls, k(bayId, dclCode, phase), `Dao cách ly "${dclCode}" pha ${phase} chưa có.`);
        const code = v.requiredString(r.contact_code, 'contact_code (mã mối nối)', 50);
        return {
            key: k(dclId, code), table: 'dcl_contacts', idCol: 'contact_id', existingId: L.contacts.get(k(dclId, code)),
            fields: {
                disconnector_id: dclId,
                contact_code: code,
                contact_name: v.optionalString(r.contact_name, 'contact_name', 150),
                position_desc: v.optionalString(r.position_desc, 'position_desc', 150),
                latitude: v.optionalLat(r.latitude, 'latitude'),
                longitude: v.optionalLng(r.longitude, 'longitude'),
                max_allowed_temp: v.optionalNumber(r.max_allowed_temp, 'max_allowed_temp', { min: 0, max: 300 })
            }
        };
    }
};

function resolveBay(r, L) {
    const subCode = v.requiredString(r.substation_code, 'substation_code', 50);
    const subId = need(L.substations, k(subCode), `Trạm "${subCode}" chưa có.`);
    const bayCode = v.requiredString(r.bay_code, 'bay_code', 50);
    return need(L.bays, k(subId, bayCode), `Ngăn lộ "${bayCode}" chưa có trong trạm "${subCode}".`);
}

function validateRequest(entity, rows) {
    // Object.hasOwn: chặn "constructor", "__proto__"... (tránh lấy hàm có sẵn của Object)
    if (typeof entity !== 'string' || !Object.hasOwn(ROW_PARSERS, entity)) {
        throw new v.ValidationError(`Loại dữ liệu không hỗ trợ. Chọn: ${Object.keys(ROW_PARSERS).join(', ')}`);
    }
    if (!Array.isArray(rows) || !rows.length) throw new v.ValidationError('File không có dòng dữ liệu nào');
    if (rows.length > MAX_ROWS) throw new v.ValidationError(`Mỗi lần nhập tối đa ${MAX_ROWS} dòng`);
}

/** Bước 1: kiểm tra, không ghi gì. */
async function checkImport(entity, rows, plantId) {
    validateRequest(entity, rows);
    const lookups = await loadLookups(plantId);
    const seen = new Map();
    const results = rows.map((raw, i) => {
        const rowNo = Number.isInteger(raw && raw._row) ? raw._row : i + 2; // dòng 1 là tiêu đề
        try {
            const parsed = ROW_PARSERS[entity](raw || {}, lookups, plantId);
            if (seen.has(parsed.key)) {
                throw new v.ValidationError(`Trùng với dòng ${seen.get(parsed.key)} trong file`);
            }
            seen.set(parsed.key, rowNo);
            return { row: rowNo, action: parsed.existingId ? 'update' : 'insert', errors: [], parsed };
        } catch (err) {
            if (!(err instanceof v.ValidationError)) throw err;
            return { row: rowNo, action: 'error', errors: [err.message] };
        }
    });
    const summary = {
        total: results.length,
        insert: results.filter(r => r.action === 'insert').length,
        update: results.filter(r => r.action === 'update').length,
        error: results.filter(r => r.action === 'error').length
    };
    return { summary, results };
}

/** Bước 2: ghi. Mặc định từ chối nếu còn dòng lỗi; skipErrors=true thì bỏ qua dòng lỗi. */
async function commitImport(entity, rows, plantId, { skipErrors = false } = {}) {
    const { summary, results } = await checkImport(entity, rows, plantId);
    if (summary.error && !skipErrors) {
        throw new v.ValidationError(`Còn ${summary.error} dòng lỗi. Sửa file hoặc chọn "Bỏ qua dòng lỗi".`);
    }
    const valid = results.filter(r => r.action !== 'error');
    await withTransaction(async (conn) => {
        for (const r of valid) {
            const { table, idCol, existingId, fields } = r.parsed;
            if (!ALLOWED_TABLES.has(table) || !/^[a-z_]+$/.test(idCol)) throw new Error('Bảng không hợp lệ');
            // Ô trống: khi cập nhật thì giữ giá trị cũ, khi thêm mới thì dùng mặc định của bảng
            const cols = Object.keys(fields).filter(c => fields[c] !== null && /^[a-z_]+$/.test(c));
            try {
                if (existingId) {
                    await conn.execute(
                        `UPDATE \`${table}\` SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE \`${idCol}\` = ?`,
                        [...cols.map(c => fields[c]), existingId]
                    );
                } else {
                    await conn.execute(
                        `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                        cols.map(c => fields[c])
                    );
                }
            } catch (err) {
                // Dữ liệu vừa bị người khác thêm giữa lúc kiểm tra và lúc ghi: báo đúng dòng
                if (err.code === 'ER_DUP_ENTRY') {
                    throw new v.ValidationError(`Dòng ${r.row}: mã đã tồn tại (có thể vừa được thêm). Bấm Kiểm tra lại rồi ghi.`);
                }
                throw err;
            }
        }
    });
    return { ...summary, skipped: summary.error, written: valid.length };
}

/** Bỏ phần "parsed" nội bộ trước khi trả về trình duyệt. */
function toPublicResults(results) {
    return results.map(({ row, action, errors }) => ({ row, action, errors }));
}

module.exports = { checkImport, commitImport, toPublicResults, ENTITY_COLUMNS, MAX_ROWS };
