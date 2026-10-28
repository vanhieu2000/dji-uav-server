/**
 * Các đường nhận ảnh (Giai đoạn A3) – thay cho 4 handler cũ trong server.js (gán cứng phiếu 1,
 * tọa độ, nhiệt độ; tải nhiều phần bị ghi đè chỉ còn phần cuối).
 *
 *   S3 giả lập cho DJI Pilot 2 (ảnh tự tải lên trong lúc bay):
 *     POST <key>?uploads                    bắt đầu tải nhiều phần → UploadId
 *     PUT  <key>?partNumber=N&uploadId=X    nhận từng phần (lưu riêng)
 *     POST <key>?uploadId=X                 ghép các phần theo thứ tự → nhận ảnh
 *     PUT  <key>                            tải 1 lần → nhận ảnh
 *   Upload dạng form:  POST /media/api/v1/workspaces/:ws/files/upload (+ các đường cũ /api/media/upload ...)
 *   Callback DJI:      POST /media/api/v1/workspaces/:ws/upload-callback  → gắn flight_id
 *   Nhập thẻ nhớ:      POST /api/media/import  (multipart, trường files[], ticket_id bắt buộc, route_id tùy chọn)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { query } = require('../config/db');
const { asyncHandler, ok } = require('../utils/http');
const v = require('../utils/validate');
const ingest = require('../services/mediaIngest');

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', '..', 'uploads', 'media');
const TMP_DIR = path.join(path.dirname(MEDIA_DIR), 'tmp');
const MAX_FILE_BYTES = 200 * 1024 * 1024;

[MEDIA_DIR, TMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const router = express.Router();
let onIngested = () => {};
let onUploadEvent = () => {};
router.setOnUploadEvent = fn => { onUploadEvent = fn; };
/** server.js đăng ký hàm này để phát WebSocket và cập nhật danh sách ảnh trong bộ nhớ. */
router.setOnIngested = fn => { onIngested = fn; };

/** Tên file an toàn trong thư mục media; trùng tên thì thêm dấu thời gian. */
function safeTarget(originalName) {
    let base = path.basename(String(originalName || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!base || base === '.' || base === '..') base = `DJI_${Date.now()}.JPG`;
    if (!path.extname(base)) base += '.JPG';
    let name = base;
    if (fs.existsSync(path.join(MEDIA_DIR, name))) name = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${base}`;
    return { name, full: path.join(MEDIA_DIR, name) };
}

function namespaceOf(value) {
    const m=/(?:^|\/)([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i.exec(value||'');
    return m?m[1]:null;
}
async function recordUpload(result,originalName,extra) {
    let ticket=extra.ticketId||result.media.ticket_id||null;
    if(!ticket && extra.uploadNamespace){const rows=await query('SELECT ticket_id FROM pilot_sessions WHERE upload_namespace=?',[extra.uploadNamespace]);ticket=rows[0]?.ticket_id||null;}
    const [existing]=ticket?await query('SELECT ticket_id FROM inspection_tickets WHERE ticket_id=?',[ticket]):[];
    if(ticket&&!existing)ticket=null;
    const note=result.status==='failed'?'Không xử lý được file; cần kiểm tra ảnh gốc':result.status==='duplicate'&&extra.ticketId&&result.media.ticket_id!==extra.ticketId?'Ảnh đã thuộc phiếu khác, không tự chuyển phiếu':null;
    const r=await query('INSERT INTO media_ingest_events (media_id,ticket_id,original_name,status,note) VALUES (?,?,?,?,?)',
        [result.media.media_id||null,ticket,String(originalName).slice(0,255),result.status,note]);
    onUploadEvent({type:'media_ingest',data:{ingest_id:r.insertId,ticket_id:ticket,status:result.status,media_id:result.media.media_id||null,note}});
}
async function ingestSaved(localPath,fileName,originalName,extra={}) {
    let r;
    try {
        r=await ingest.ingestFile({localPath,fileName,originalName,...extra});
        if(r.status==='duplicate'&&!r.restored)fs.rm(localPath,{force:true},()=>{});
        else onIngested(r.media);
    } catch(err){
        console.error('[Nhận ảnh] Không xử lý được file:',err.code||err.name);
        r={status:'failed',error:'Không xử lý được ảnh gốc',media:{file_name:fileName}};
    }
    await recordUpload(r,originalName,extra);
    return r;
}

/* ---------------- Upload dạng form ---------------- */

const uploadForm = multer({ dest: TMP_DIR, limits: { fileSize: MAX_FILE_BYTES } });

/** Chuyển file từ thư mục tạm vào thư mục media với tên an toàn. */
function moveIn(file) {
    const target = safeTarget(file.originalname);
    fs.renameSync(file.path, target.full);
    return target;
}

router.post([
    '/media/api/v1/workspaces/:workspace_id/files/upload',
    '/manage/api/v1/workspaces/:workspace_id/files/upload',
    '/api/dji/media', '/api/media/upload', '/media/upload'
], require('../services/storageQuota').middleware,uploadForm.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ code: 400, message: 'Không có file' });
    const t = moveIn(req.file);
    const token=require('./auth').decodeToken(req.get('x-auth-token')||(req.get('authorization')||'').replace(/^Bearer\s+/i,''));
    const session=token?.pilot_session_id?(await query('SELECT upload_namespace FROM pilot_sessions WHERE session_id=? AND user_id=?',[token.pilot_session_id,token.user_id]))[0]:null;
    const r = await ingestSaved(t.full,t.name,req.file.originalname,{source:'CLOUD',uploadNamespace:session?.upload_namespace||namespaceOf(req.path)});
    if (r.status === 'failed') return res.status(500).json({ code: 500, message: 'Không xử lý được ảnh' });
    ok(res, { file_id: String(r.media.media_id), file_url: r.media.file_url, duplicate: r.status === 'duplicate' });
}));

/* ---------------- Callback & kiểm tra nhanh của DJI ---------------- */

router.post(['/media/api/v1/workspaces/:workspace_id/upload-callback', '/manage/api/v1/workspaces/:workspace_id/upload-callback'], asyncHandler(async (req, res) => {
    const b = req.body || {};
    if(req.pilotSession){
      if(typeof b.object_key!=='string')return res.status(400).json({code:400,message:'Callback cần object_key chính xác trong namespace phiên'});
      try{const r=await require('../services/objectStorage').receive(req.pilotSession,b.object_key);return ok(res,{media_id:r.media.media_id,status:r.status});}catch(e){return res.status(422).json({code:422,message:'Chưa nhận được ảnh gốc từ S3 trong phạm vi phiên; kiểm tra object key và storage'});}
    }
    const name = b.name || (b.object_key ? path.basename(b.object_key) : null);
    const flightId = b.ext && b.ext.flight_id;
    const n = await ingest.attachFlightId(name, flightId);
    if (n) console.log(`[Nhận ảnh] Gắn chuyến bay ${flightId} cho ${name}`);
    res.json({ code: 0, message: 'success', data: {} });
}));

router.post(['/media/api/v1/workspaces/:workspace_id/fast-upload', '/manage/api/v1/workspaces/:workspace_id/fast-upload'], asyncHandler(async (req, res) => {
    const name = req.body && req.body.name;
    const rows = name ? await query('SELECT media_id FROM media_files WHERE (original_name = ? OR file_name = ?)'+(req.pilotSession?' AND ticket_id=?':'')+' LIMIT 1', req.pilotSession?[name,name,req.pilotSession.ticket_id]:[name,name]) : [];
    if (rows.length) return res.json({ code: 0, message: 'success', data: {} });
    // Chưa có: trả mã khác 0 để Pilot 2 tải file thật (theo DJI Cloud API demo)
    res.json({ code: 513000, message: `${name || 'file'} don't exist.`, data: null });
}));

router.post(['/media/api/v1/workspaces/:workspace_id/files/tiny-fingerprints', '/manage/api/v1/workspaces/:workspace_id/files/tiny-fingerprints'], (req, res) => {
    res.json({ code: 0, message: 'success', data: { tiny_fingerprints: [] } });
});

/* ---------------- Nhập ảnh từ thẻ nhớ ---------------- */

const importUpload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_FILE_BYTES, files: 100 } });

function receiveFiles(req, res, next) {
    importUpload.array('files', 100)(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Có file quá 200 MB' : err.code === 'LIMIT_FILE_COUNT' ? 'Mỗi lần tối đa 100 file' : 'Lỗi nhận file: ' + err.message;
        res.status(400).json({ code: 400, message });
    });
}

router.post('/api/media/import',require('../services/storageQuota').middleware, receiveFiles, asyncHandler(async (req, res) => {
    const files = req.files || [];
    try {
        const ticketId = v.parseId(req.body && req.body.ticket_id, 'phiếu kiểm tra');
        const t = await query('SELECT ticket_id FROM inspection_tickets WHERE ticket_id = ?', [ticketId]);
        if (!t.length) throw new v.ValidationError('Không tìm thấy phiếu kiểm tra');
        const routeId = v.isBlank(req.body.route_id) ? null : v.parseId(req.body.route_id, 'đường bay');
        if (!files.length) throw new v.ValidationError('Chưa chọn ảnh nào');
        const summary = { created: 0, duplicate: 0, failed: 0, skipped: 0, items: [] };
        for (const f of files) {
            if (!/\.(jpe?g)$/i.test(f.originalname)) {
                fs.rm(f.path, { force: true }, () => {});
                summary.skipped += 1;
                summary.items.push({ name: f.originalname, status: 'skipped', note: 'Không phải ảnh JPG' });
                continue;
            }
            const target = moveIn(f);
            const r = await ingestSaved(target.full, target.name, f.originalname, { source: 'SD_IMPORT', ticketId, routeId });
            summary[r.status] += 1;
            summary.items.push({
                name: f.originalname, status: r.status, media_id: r.media.media_id || null, lens: r.media.lens,
                position_quality: r.media.position_quality, photo_point_id: r.media.photo_point_id || null, error: r.error
            });
        }
        ok(res, summary, `Đã nhận ${summary.created} ảnh mới, ${summary.duplicate} ảnh trùng, ${summary.failed} lỗi`);
    } finally {
        files.forEach(f => { if (fs.existsSync(f.path)) fs.rm(f.path, { force: true }, () => {}); });
    }
}));

module.exports = router;
module.exports.MEDIA_DIR = MEDIA_DIR;
// Tái sử dụng bộ nhận ảnh thật cho endpoint đã kiểm tra phạm vi trước khi đọc multipart.
module.exports.receiveFiles=receiveFiles;
module.exports.moveIn=moveIn;
module.exports.ingestSaved=ingestSaved;
