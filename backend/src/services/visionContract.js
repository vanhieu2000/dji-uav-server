const crypto = require('crypto');
const { ValidationError } = require('../utils/validate');
const TYPES = new Set(['HOTSPOT_CELL','HOTSPOT_MULTI_CELL','BYPASS_DIODE','MODULE_HOT','STRING_OFFLINE','PID','JUNCTION_BOX_HOT',
    'CRACKED_GLASS','PHYSICAL_DAMAGE','SOILING','BIRD_DROPPING','SHADING','VEGETATION','DELAMINATION','MISSING_MODULE',
    'DCL_CONTACT_OVERHEAT','DCL_PHASE_IMBALANCE','DCL_NOT_FULLY_CLOSED','INSULATOR_DAMAGE','CORROSION','FOREIGN_OBJECT',
    'HOTSPOT_PANEL','CRACKED_CELL','DIRT_DUST','DISCONNECTOR_OVERHEAT','CONTACT_DEFECT','OTHER']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(message) { throw new ValidationError(message); }
function finite(n) { return typeof n === 'number' && Number.isFinite(n); }
function resultInput(body) {
    if (!body || body.contract_version !== '2.0' || !UUID.test(body.job_id || '')) fail('Cần contract_version 2.0 và job_id UUID');
    if (!Number.isSafeInteger(body.media_id) || body.media_id <= 0 || !/^[a-f0-9]{64}$/.test(body.input_sha256 || '')) fail('media_id hoặc input_sha256 không hợp lệ');
    if (!Number.isSafeInteger(body.result_version) || body.result_version < 1) fail('result_version phải là số nguyên dương');
    if (typeof body.model_version !== 'string' || !body.model_version.trim() || body.model_version.length > 100) fail('Cần model_version');
    if (!['SUCCEEDED', 'FAILED'].includes(body.status)) fail('status phải là SUCCEEDED hoặc FAILED');
    const ds = body.detections;
    if (!Array.isArray(ds) || ds.length > 1000 || (body.status === 'FAILED' && ds.length)) fail('detections không hợp lệ');
    const detections = ds.map(d => {
        if (!d || !TYPES.has(d.defect_type) || !finite(d.confidence) || d.confidence < 0 || d.confidence > 1) fail('Loại lỗi hoặc confidence không hợp lệ');
        if (!['thermal', 'rgb'].includes(d.image)) fail('image phải là thermal hoặc rgb');
        if (!Number.isInteger(d.image_width) || d.image_width < 1 || d.image_width > 50000 || !Number.isInteger(d.image_height) || d.image_height < 1 || d.image_height > 50000) fail('Cần kích thước ảnh gốc');
        if (!Array.isArray(d.bbox) || d.bbox.length !== 4 || !d.bbox.every(finite)) fail('bbox phải là [x,y,w,h] pixel');
        const [x,y,w,h] = d.bbox;
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > d.image_width || y+h > d.image_height) fail('bbox nằm ngoài ảnh');
        const out = { defect_type: d.defect_type, confidence: d.confidence, image: d.image, image_width:d.image_width, image_height:d.image_height, bbox:[x,y,w,h] };
        for (const k of ['max_temp_c','mean_temp_c','ref_temp_c','delta_t_c']) {
            if (d[k] != null && (!finite(d[k]) || Math.abs(d[k]) > 2000)) fail(`${k} không hợp lệ`);
            out[k] = d[k] ?? null;
        }
        if(out.mean_temp_c!=null&&out.max_temp_c!=null&&out.mean_temp_c>out.max_temp_c)fail('Nhiệt trung bình không được lớn hơn nhiệt cực đại');
        if(d.image==='rgb' && ['max_temp_c','mean_temp_c','ref_temp_c','delta_t_c'].some(k=>out[k]!=null)) fail('Ảnh RGB không cung cấp nhiệt radiometric; dùng job ảnh IR gốc hoặc hợp đồng ghép cặp đã xác minh');
        return out;
    });
    return { contract_version:'2.0', job_id:body.job_id, media_id:body.media_id, input_sha256:body.input_sha256,
        result_version:body.result_version, model_version:body.model_version.trim(), status:body.status,
        error: typeof body.error === 'string' ? body.error.slice(0,500) : null, detections };
}
function resultHash(r) { return crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex'); }
function legacyType(code) {
    if (['DCL_CONTACT_OVERHEAT','DCL_PHASE_IMBALANCE','DISCONNECTOR_OVERHEAT'].includes(code)) return 'DISCONNECTOR_OVERHEAT';
    if (/^DCL_|INSULATOR_DAMAGE|CORROSION|FOREIGN_OBJECT/.test(code)) return 'CONTACT_DEFECT';
    if (['HOTSPOT_CELL','HOTSPOT_MULTI_CELL','BYPASS_DIODE','MODULE_HOT','STRING_OFFLINE','PID','JUNCTION_BOX_HOT'].includes(code)) return 'HOTSPOT_PANEL';
    if (['CRACKED_GLASS','CRACKED_CELL','PHYSICAL_DAMAGE'].includes(code)) return 'CRACKED_CELL';
    if (['SOILING','BIRD_DROPPING','SHADING','VEGETATION','DIRT_DUST'].includes(code)) return 'DIRT_DUST';
    return ['HOTSPOT_PANEL','CONTACT_DEFECT','OTHER'].includes(code) ? code : 'OTHER';
}
function severity(d, rule) {
    if (!rule || !rule.enabled || d.confidence < rule.min_confidence) return null;
    const hot = (rule.max_temp_c != null && d.max_temp_c != null && d.max_temp_c >= rule.max_temp_c) ||
        (rule.delta_t_c != null && d.delta_t_c != null && d.delta_t_c >= rule.delta_t_c);
    return hot ? 'CRITICAL' : 'WARNING';
}
module.exports = { resultInput, resultHash, legacyType, severity, UUID, TYPES };
