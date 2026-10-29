const fs = require('fs');
const crypto = require('crypto');
const { query, withTransaction } = require('../config/db');
const { ValidationError } = require('../utils/validate');
const { NotFoundError } = require('../utils/http');
const { resultInput, resultHash, legacyType, severity } = require('./visionContract');
const { projectPixel } = require('./imageProjection');
const { sha256File } = require('./mediaIngest');
const MAX_ATTEMPTS = 5;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
function conflict(message) { const e = new ValidationError(message); e.status = 409; return e; }

async function checkInput(media) {
    if (media.source === 'MANUAL' || !media.sha256 || !media.file_path_local) throw new ValidationError('Ảnh chưa có nguồn gốc/hash phù hợp để gửi Vision');
    const stat = fs.statSync(media.file_path_local);
    if (!stat.isFile() || stat.size < 4 || stat.size > MAX_FILE_BYTES) throw new ValidationError('Kích thước file ảnh không hợp lệ');
    const fd = fs.openSync(media.file_path_local, 'r');
    const head = Buffer.alloc(Math.min(stat.size, 512 * 1024)), end = Buffer.alloc(2);
    let dims = null;
    try {
        fs.readSync(fd, head, 0, head.length, 0); fs.readSync(fd, end, 0, 2, stat.size - 2);
        if (head[0] !== 255 || head[1] !== 216 || end[0] !== 255 || end[1] !== 217) throw new ValidationError('File không có cấu trúc JPEG');
        let offset = 2;
        while (offset + 4 <= head.length) {
            if (head[offset] !== 255) break;
            while (head[offset] === 255) offset++;
            const marker = head[offset++];
            if (marker === 0xda || marker === 0xd9) break;
            const length = head.readUInt16BE(offset);
            if (length < 2 || offset + length > head.length) break;
            if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
                dims = { height: head.readUInt16BE(offset+3), width: head.readUInt16BE(offset+5) }; break;
            }
            offset += length;
        }
    } finally { fs.closeSync(fd); }
    if (!dims || !dims.width || !dims.height) throw new ValidationError('Không đọc được kích thước JPEG');
    if (await sha256File(media.file_path_local) !== media.sha256) throw new ValidationError('Hash file không khớp bản đã nhận');
    return { ...dims, bytes: stat.size, verification: 'JPEG_HEADER_AND_SHA256' };
}

async function enqueue(mediaId) {
    const [media] = await query('SELECT * FROM media_files WHERE media_id = ?', [mediaId]);
    if (!media) throw new NotFoundError('Không tìm thấy ảnh');
    if (!media.sha256) throw new ValidationError('Ảnh chưa có SHA256');
    let error = null;
    try { await checkInput(media); } catch (e) { error = e instanceof ValidationError ? e.message : 'Không đọc được file gốc'; }
    const id = crypto.randomUUID();
    await query(`INSERT IGNORE INTO vision_jobs (job_id, media_id, input_sha256, status, last_error) VALUES (?, ?, ?, ?, ?)`,
        [id,mediaId,media.sha256,error?'INVALID':'QUEUED',error]);
    const [job] = await query('SELECT * FROM vision_jobs WHERE media_id = ? AND input_sha256 = ?', [mediaId,media.sha256]);
    return job;
}

async function scan() {
    const rows = await query(`SELECT m.media_id FROM media_files m LEFT JOIN vision_jobs j ON j.media_id = m.media_id AND j.input_sha256 = m.sha256
        WHERE j.job_id IS NULL AND m.sha256 IS NOT NULL AND m.source <> 'MANUAL' ORDER BY m.media_id LIMIT 50`);
    for (const r of rows) await enqueue(r.media_id);
    return rows.length;
}

async function matchAsset(conn, media, projected) {
    // Ưu tiên điểm chụp do đường bay đã định danh. Không tự đoán tấm gần nhất từ GPS máy bay.
    if (!media.photo_point_id) return { mapping_status: projected ? 'PROJECTED_UNRESOLVED' : 'UNRESOLVED' };
    const [rows] = await conn.execute('SELECT asset_type, asset_id FROM photo_points WHERE point_id = ?', [media.photo_point_id]);
    const point = rows[0]; if (!point) return { mapping_status:'UNRESOLVED' };
    const columns = { PANEL:'panel_id', DISCONNECTOR:'disconnector_id', CONTACT:'contact_id' };
    const column = columns[point.asset_type];
    if (!column) return { mapping_status:'UNRESOLVED' };
    // Một ảnh có thể thấy nhiều tài sản: photo_point chỉ là gợi ý, không tự gán mọi bbox vào mục tiêu đó.
    return { mapping_status:'PHOTO_POINT_REVIEW_REQUIRED', suggested_asset_type:point.asset_type, suggested_asset_id:point.asset_id };
}

async function acceptResult(body) {
    const result = resultInput(body), hash = resultHash(result);
    return withTransaction(async conn => {
        const [jobs] = await conn.execute('SELECT * FROM vision_jobs WHERE job_id = ? FOR UPDATE', [result.job_id]);
        const job = jobs[0]; if (!job) throw new NotFoundError('Không tìm thấy job');
        if (job.media_id !== result.media_id || job.input_sha256 !== result.input_sha256) throw conflict('Kết quả không khớp ảnh đầu vào');
        if (job.status === 'INVALID') throw conflict('Ảnh đầu vào chưa hợp lệ');
        if (result.result_version < job.result_version) throw conflict('Phiên bản kết quả cũ');
        if (result.result_version === job.result_version) {
            if (job.result_sha256 === hash) return { job_id:job.job_id, duplicate:true };
            throw conflict('Cùng result_version nhưng nội dung khác');
        }
        const [medias] = await conn.execute('SELECT * FROM media_files WHERE media_id = ?', [job.media_id]);
        const media = medias[0]; if (!media) throw new NotFoundError('Ảnh đã bị xóa');
        // Verify before transaction changes: never accept results for bytes changed after dispatch.
        if (media.sha256 !== job.input_sha256) throw conflict('Hash ảnh đã thay đổi sau khi tạo job');
        const info = await checkInput(media);
        for (const d of result.detections) {
            if (d.image_width !== info.width || d.image_height !== info.height) throw new ValidationError('Kích thước kết quả không khớp ảnh gốc');
            if ((media.lens === 'IR') !== (d.image === 'thermal')) throw new ValidationError('Loại ảnh kết quả không khớp lens đầu vào');
        }
        if (result.status === 'FAILED') {
            await conn.execute(`UPDATE vision_jobs SET status='FAILED',result_version=?,result_sha256=?,model_version=?,result_json=?,last_error=?,lease_until=NULL WHERE job_id=?`,
                [result.result_version,hash,result.model_version,JSON.stringify(result),result.error,job.job_id]);
            return {job_id:job.job_id,duplicate:false,status:'FAILED'}; // giữ kết quả thành công gần nhất
        }
        await require('./temperatureHistory').invalidateJob(conn,job.job_id);
        const [oldPanels] = await conn.execute('SELECT DISTINCT panel_id FROM ai_defect_detections WHERE vision_job_id=? AND panel_id IS NOT NULL', [job.job_id]);
        await conn.execute('DELETE FROM ai_defect_detections WHERE vision_job_id = ?', [job.job_id]);
        for (const p of oldPanels) {
            await conn.execute("UPDATE solar_panels SET status=IF(EXISTS(SELECT 1 FROM ai_defect_detections d WHERE d.panel_id=? AND d.verified_by_human=1),'DEFECT','NORMAL') WHERE panel_id=? AND status='DEFECT'", [p.panel_id,p.panel_id]);
        }
        const [rules] = await conn.execute('SELECT * FROM alert_rules WHERE enabled = 1');
        const calibration = typeof job.projection_json === 'string' ? JSON.parse(job.projection_json) : job.projection_json;
        let count=0;
        for (const d of result.detections) {
            const projected = projectPixel(media,d,calibration), mapping=await matchAsset(conn,media,projected);
            const type=legacyType(d.defect_type);
            const [insert] = await conn.execute(`INSERT INTO ai_defect_detections
                (media_id,ticket_id,defect_type,confidence,bounding_box_json,max_temperature,delta_temperature,
                 vision_job_id,defect_code,model_version,result_version,projected_latitude,projected_longitude,mapping_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [media.media_id,media.ticket_id,type,d.confidence,JSON.stringify(d.bbox),d.max_temp_c,d.delta_t_c,
                job.job_id,d.defect_type,result.model_version,result.result_version,projected?.latitude??null,projected?.longitude??null,mapping.mapping_status]);
            const ruleType = /^DCL_|DISCONNECTOR|CONTACT_DEFECT/.test(d.defect_type) ? 'DISCONNECTOR' : 'PANEL';
            const rule=rules.find(r=>r.asset_type===ruleType) || rules.find(r=>r.asset_type==='OTHER');
            const level=severity(d,rule);
            if (level) await conn.execute(`INSERT INTO defect_alerts (detection_id,ticket_id,alert_level,title,message) VALUES (?,?,?,?,?)`,
                [insert.insertId,media.ticket_id,level,`Vision: ${d.defect_type}`,`Mô hình ${result.model_version}; confidence ${d.confidence}; nhiệt độ ${d.max_temp_c??'chưa đo'} °C; ΔT ${d.delta_t_c??'chưa đo'} °C`]);
            count++;
        }
        const hotspot = result.detections.some(d=>/HOTSPOT|MODULE_HOT|JUNCTION_BOX_HOT|DCL_CONTACT_OVERHEAT|DISCONNECTOR_OVERHEAT/.test(d.defect_type));
        await conn.execute('UPDATE media_files SET has_hotspot = ? WHERE media_id = ?', [hotspot?1:0,media.media_id]);
        await conn.execute(`UPDATE vision_jobs SET status = ?, result_version = ?, result_sha256 = ?, model_version = ?,
            result_json = ?, last_error = ?, lease_until = NULL WHERE job_id = ?`,
            [result.status,result.result_version,hash,result.model_version,JSON.stringify(result),result.error,job.job_id]);
        return { job_id:job.job_id, duplicate:false, detections:count, status:result.status };
    });
}

function inputToken(job, expires, secret) {
    return crypto.createHmac('sha256',secret).update(`${job.job_id}|${job.input_sha256}|${expires}`).digest('hex');
}
function tokenEqual(a,b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && crypto.timingSafeEqual(x,y);
}

/** Lease + conditional updates: callback can finish while POST is still in flight. */
async function dispatchOne({ endpoint, publicBase, secret, apiToken, fetchImpl = fetch, timeoutMs = 30000 }) {
    const job = await withTransaction(async conn => {
        const [rows]=await conn.execute(`SELECT * FROM vision_jobs WHERE status IN ('QUEUED','RETRY_WAIT')
            AND next_attempt_at <= NOW() AND attempts < ? ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS]);
        if (!rows.length) return null;
        await conn.execute("UPDATE vision_jobs SET status='SENDING', attempts=attempts+1, lease_until=DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE job_id=?",[rows[0].job_id]);
        return rows[0];
    });
    if (!job) return false;
    try {
        const [media]=await query('SELECT * FROM media_files WHERE media_id=?',[job.media_id]);
        if (!media || media.sha256 !== job.input_sha256) throw new ValidationError('Hash ảnh đã thay đổi');
        const info=await checkInput(media), expires=Math.floor(Date.now()/1000)+600;
        const base=publicBase.replace(/\/$/,'');
        const payload={contract_version:'2.0',job_id:job.job_id,media_id:job.media_id,input_sha256:job.input_sha256,
            callback_url:`${base}/api/vision/results`,input:{url:`${base}/api/vision/jobs/${job.job_id}/input?expires=${expires}&token=${inputToken(job,expires,secret)}`,
                ...info,lens:media.lens,source:media.source,captured_at:media.captured_at,ticket_id:media.ticket_id,
                rtk_flag:media.rtk_flag,position_quality:media.position_quality,thermal_engine:media.thermal_engine||null}};
        const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':job.job_id,
            ...(apiToken?{Authorization:`Bearer ${apiToken}`}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
        if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
        if (!response.ok) throw new Error('VISION_HTTP_'+response.status);
        await query("UPDATE vision_jobs SET status='DISPATCHED', lease_until=DATE_ADD(NOW(), INTERVAL 10 MINUTE), last_error=NULL WHERE job_id=? AND status='SENDING'",[job.job_id]);
    } catch (err) {
        const attempts=job.attempts+1;
        const delay=Math.min(3600,30*2**(attempts-1));
        const error=err instanceof ValidationError?err.message:(err.name==='TimeoutError'?'VISION_REQUEST_TIMEOUT':'VISION_DELIVERY_FAILED');
        await query(`UPDATE vision_jobs SET status=?, next_attempt_at=DATE_ADD(NOW(), INTERVAL ${delay} SECOND), lease_until=NULL,
            last_error=? WHERE job_id=? AND status='SENDING'`,[attempts>=MAX_ATTEMPTS?'FAILED':'RETRY_WAIT',error,job.job_id]);
    }
    return true;
}
async function recoverLeases() {
    await query(`UPDATE vision_jobs SET status=IF(attempts>=?, 'FAILED','RETRY_WAIT'), last_error='VISION_RESULT_TIMEOUT',
        next_attempt_at=NOW(),lease_until=NULL WHERE status IN ('SENDING','DISPATCHED') AND lease_until < NOW()`,[MAX_ATTEMPTS]);
}
function startWorker(options) {
    let busy=false;
    const tick=async()=>{if(busy)return;busy=true;try{await recoverLeases();await scan();for(let i=0;i<10;i++)if(!await dispatchOne(options))break;}
        catch(e){console.warn('[Vision] Worker chưa sẵn sàng:',e.code||e.name);}finally{busy=false;}};
    tick();const timer=setInterval(tick,10000);timer.unref();return ()=>clearInterval(timer);
}
module.exports={enqueue,scan,checkInput,acceptResult,dispatchOne,recoverLeases,startWorker,inputToken,tokenEqual};
