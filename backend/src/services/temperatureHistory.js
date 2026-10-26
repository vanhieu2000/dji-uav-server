const crypto=require('crypto');
const {severity}=require('./visionContract');
const TABLES={PANEL:['solar_panels','panel_id'],DISCONNECTOR:['disconnectors','disconnector_id'],CONTACT:['dcl_contacts','contact_id']};

/** Ước lượng tuyến tính; không biến thành dự báo chắc chắn hoặc số đo mới. */
function linearTrend(samples,threshold=null){
    const cycles=new Map();
    for(const p of samples){
        if(p.max_temp_c==null||!p.captured_at)continue;
        const value=Number(p.max_temp_c),time=new Date(p.captured_at).getTime();
        if(!Number.isFinite(value)||!Number.isFinite(time))continue;
        const key=p.flight_session_id?`f:${p.flight_session_id}`:p.ticket_id?`t:${p.ticket_id}`:`h:${p.history_id}`;
        const prev=cycles.get(key);
        if(!prev)cycles.set(key,{...p,value,time});else{prev.value=Math.max(prev.value,value);prev.time=Math.max(prev.time,time);}
    }
    const pts=[...cycles.values()].sort((a,b)=>a.time-b.time);
    const base={cycles:pts.length,last_temp_c:pts.length?pts[pts.length-1].value:null,delta_per_cycle_c:pts.length>1?pts[pts.length-1].value-pts[pts.length-2].value:null,
        slope_c_per_day:null,estimated_days_to_threshold:null,estimated:true};
    if(pts.length<2)return base;
    const xs=pts.map(p=>(p.time-pts[0].time)/86400000),ys=pts.map(p=>p.value);
    const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;
    let num=0,den=0;for(let i=0;i<xs.length;i++){num+=(xs[i]-mx)*(ys[i]-my);den+=(xs[i]-mx)**2;}
    if(den<=0)return base;
    const slope=num/den;base.slope_c_per_day=slope;
    if(threshold!=null&&Number.isFinite(Number(threshold))&&slope>0&&base.last_temp_c<Number(threshold))base.estimated_days_to_threshold=(Number(threshold)-base.last_temp_c)/slope;
    return base;
}
async function ruleFor(conn,type,id){
    const [specific]=await conn.execute('SELECT * FROM asset_alert_rules WHERE asset_type=? AND asset_id=?',[type,id]);if(specific.length)return specific[0];
    const [general]=await conn.execute('SELECT * FROM alert_rules WHERE asset_type=?',[type]);if(general.length)return general[0];
    if(type==='CONTACT'){
        const [rows]=await conn.execute('SELECT COALESCE(c.max_allowed_temp,d.max_allowed_temp) AS max_temp_c FROM dcl_contacts c JOIN disconnectors d ON c.disconnector_id=d.disconnector_id WHERE c.contact_id=?',[id]);
        if(rows.length)return {...rows[0],min_confidence:.8,enabled:1};
    }
    if(type==='DISCONNECTOR'){
        const [rows]=await conn.execute('SELECT max_allowed_temp AS max_temp_c FROM disconnectors WHERE disconnector_id=?',[id]);
        if(rows.length)return {...rows[0],min_confidence:.8,enabled:1};
    }
    const [other]=await conn.execute("SELECT * FROM alert_rules WHERE asset_type='OTHER'");return other[0]||null;
}
async function refreshSummary(conn,type,id){
    if(!TABLES[type])return;
    let latest;
    if(type==='DISCONNECTOR'){
        const condition="(h.asset_type='DISCONNECTOR' AND h.asset_id=?) OR (h.asset_type='CONTACT' AND h.asset_id IN (SELECT contact_id FROM dcl_contacts WHERE disconnector_id=?))";
        const [all]=await conn.execute(`SELECT h.* FROM temperature_history h WHERE h.valid=1 AND (${condition}) ORDER BY h.captured_at DESC,h.history_id DESC LIMIT 1`,[id,id]);
        latest=all[0];
        if(latest){
            const field=latest.flight_session_id?'flight_session_id':latest.ticket_id?'ticket_id':'history_id';
            const [rows]=await conn.execute(`SELECT MAX(h.max_temp_c) AS max_temp_c,MAX(h.captured_at) AS captured_at FROM temperature_history h
                WHERE h.valid=1 AND (${condition}) AND h.${field}=?`,[id,id,latest[field]]);latest=rows[0];
        }
    }else{
        const [rows]=await conn.execute('SELECT max_temp_c,captured_at FROM temperature_history WHERE asset_type=? AND asset_id=? AND valid=1 ORDER BY captured_at DESC,history_id DESC LIMIT 1',[type,id]);latest=rows[0];
    }
    const [table,col]=TABLES[type];
    await conn.execute(`UPDATE ${table} SET last_inspected_temp=?,last_inspected_at=COALESCE(?,last_inspected_at) WHERE ${col}=?`,[latest?.max_temp_c??null,latest?.captured_at??null,id]);
    if(type==='CONTACT'){
        const [rows]=await conn.execute('SELECT disconnector_id FROM dcl_contacts WHERE contact_id=?',[id]);if(rows[0])await refreshSummary(conn,'DISCONNECTOR',rows[0].disconnector_id);
    }
}
async function invalidateJob(conn,jobId){
    const [assets]=await conn.execute('SELECT DISTINCT asset_type,asset_id FROM temperature_history WHERE vision_job_id=? AND valid=1',[jobId]);
    await conn.execute('UPDATE temperature_history SET valid=0 WHERE vision_job_id=?',[jobId]);
    for(const a of assets)await refreshSummary(conn,a.asset_type,a.asset_id);
}
async function recordConfirmed(conn,d,type,id){
    const [old]=await conn.execute('SELECT DISTINCT asset_type,asset_id FROM temperature_history WHERE detection_id=? AND valid=1',[d.detection_id]);
    await conn.execute('UPDATE temperature_history SET valid=0 WHERE detection_id=?',[d.detection_id]);
    await conn.execute('DELETE FROM defect_alerts WHERE detection_id=?',[d.detection_id]);
    const [medias]=await conn.execute('SELECT captured_at,flight_session_id FROM media_files WHERE media_id=?',[d.media_id]);const media=medias[0];
    if(d.max_temperature!=null){
        const key=crypto.createHash('sha256').update([d.vision_job_id,d.result_version,d.detection_id,type,id].join('|')).digest('hex');
        await conn.execute(`INSERT INTO temperature_history (history_key,asset_type,asset_id,detection_id,vision_job_id,result_version,model_version,ticket_id,flight_session_id,captured_at,max_temp_c,delta_t_c)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE valid=1`,[key,type,id,d.detection_id,d.vision_job_id,d.result_version,d.model_version,d.ticket_id,media.flight_session_id,media.captured_at,d.max_temperature,d.delta_temperature]);
    }
    for(const a of old)await refreshSummary(conn,a.asset_type,a.asset_id);
    await refreshSummary(conn,type,id);
    const rule=await ruleFor(conn,type,id);
    const level=severity({confidence:d.confidence,max_temp_c:d.max_temperature,delta_t_c:d.delta_temperature},rule);
    if(level)await conn.execute(`INSERT INTO defect_alerts (detection_id,ticket_id,asset_type,asset_id,alert_level,title,message) VALUES (?,?,?,?,?,?,?)`,
        [d.detection_id,d.ticket_id,type,id,level,`Phát hiện trên tài sản đã xác nhận`,`${d.defect_code||d.defect_type}; nhiệt độ ${d.max_temperature??'chưa đo'} °C; ΔT ${d.delta_temperature??'chưa đo'} °C`]);
    const [samples]=await conn.execute('SELECT * FROM temperature_history WHERE asset_type=? AND asset_id=? AND valid=1 ORDER BY captured_at DESC,history_id DESC LIMIT 1000',[type,id]);
    const trend=linearTrend(samples,rule?.max_temp_c);
    if(rule?.enabled&&rule.trend_horizon_days!=null&&trend.estimated_days_to_threshold!=null&&trend.estimated_days_to_threshold<=rule.trend_horizon_days){
        const trendKey=crypto.createHash('sha256').update(`${type}|${id}|${samples[0].history_id}`).digest('hex');
        await conn.execute(`INSERT IGNORE INTO defect_alerts (detection_id,ticket_id,asset_type,asset_id,alert_kind,trend_key,alert_level,title,message)
            VALUES (?,?,?,?,'TREND',?,'WARNING','Xu hướng tăng nhiệt cần kiểm tra',?)`,[d.detection_id,d.ticket_id,type,id,trendKey,
            `Ước lượng từ ${trend.cycles} chu kỳ: tăng ${trend.slope_c_per_day.toFixed(2)} °C/ngày; có thể tới ngưỡng sau ${trend.estimated_days_to_threshold.toFixed(1)} ngày. Chỉ là ước lượng, cần kỹ sư kiểm tra.`]);
    }
    return {level,trend};
}
module.exports={linearTrend,ruleFor,recordConfirmed,invalidateJob,refreshSummary,TABLES};
