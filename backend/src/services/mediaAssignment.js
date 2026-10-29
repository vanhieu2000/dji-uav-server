/** Liên kết ảnh bằng ngữ cảnh gốc, không dùng phiên đăng nhập toàn cục gần nhất. */
async function resolveAssignment(query, options, meta) {
    let session=null;
    if(options.uploadNamespace){
        const rows=await query('SELECT * FROM pilot_sessions WHERE upload_namespace=?',[options.uploadNamespace]);
        session=rows[0]||null;
    }
    if(session&&session.route_verification!=='LEGACY'&&session.route_verification!=null&&meta.captured_at instanceof Date){
        const matches=await query('SELECT ticket_id,route_state,started_at,ended_at FROM ticket_executions WHERE pilot_session_id=? AND ? BETWEEN started_at AND COALESCE(ended_at,NOW(3)) ORDER BY execution_id DESC LIMIT 2',[session.session_id,meta.captured_at]);
        if(matches.length===1&&['VERIFIED','MANUAL_CONFIRMED','MISMATCH','UNKNOWN'].includes(matches[0].route_state))session={...session,ticket_id:matches[0].ticket_id,route_verification:matches[0].route_state,ticket_bound_at:matches[0].started_at,ended_at:matches[0].ended_at};
    }
    if(session&&['MISMATCH','UNKNOWN'].includes(session.route_verification))return {ticketId:null,deviceSn:options.deviceSn||session.aircraft_sn||'UNKNOWN',flightSessionId:null,pilotSessionId:session.session_id,status:'UNRESOLVED'};
    const deviceSn=options.deviceSn||(session&&session.aircraft_sn)||null;
    const captured=meta.captured_at instanceof Date && Number.isFinite(meta.captured_at.getTime()) ? meta.captured_at : null;
    const t=captured?captured.getTime():null;
    // Từ chối gán task mới cho ảnh được chụp ngoài khoảng phiên (ảnh cũ trong queue RC).
    const inSession=session && t!=null && t>=new Date(session.ticket_bound_at||session.started_at).getTime()-(session.ticket_bound_at?0:30000) &&
        (!session.ended_at||t<=new Date(session.ended_at).getTime()+30000);
    let flight=null;
    if(deviceSn && captured){
        const matches=await query(`SELECT flight_session_id,ticket_id,device_sn,pilot_session_id FROM flight_sessions WHERE device_sn=?
            AND ? BETWEEN started_at - INTERVAL 30 SECOND AND COALESCE(ended_at,NOW()) + INTERVAL 30 SECOND
            ${options.ticketId?'AND ticket_id=?':''} ORDER BY flight_session_id LIMIT 2`,
            options.ticketId?[deviceSn,captured,options.ticketId]:[deviceSn,captured]);
        if(matches.length===1)flight=matches[0];
    }
    const ticketId=options.ticketId||(flight&&flight.ticket_id)||(inSession&&session.ticket_id)||null;
    // Nếu nguồn session và flight mâu thuẫn, ưu tiên chuyến theo giờ chụp/serial; không sửa ảnh đã xác nhận bằng tay.
    return { ticketId, deviceSn:deviceSn||'UNKNOWN', flightSessionId:flight?flight.flight_session_id:null,
        pilotSessionId:flight?(flight.pilot_session_id||null):session?session.session_id:null,
        status:options.ticketId?'EXPLICIT':flight?'FLIGHT':ticketId?'SESSION':'UNRESOLVED' };
}
module.exports={resolveAssignment};
