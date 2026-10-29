/** Position of camera versus planned UAV position; never a claim about the ground asset. */
function distance(a,b){const r=Math.PI/180,R=6371008.8,dlat=(a.lat-b.lat)*r,dlng=(a.lng-b.lng)*r,x=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;return 2*R*Math.asin(Math.sqrt(Math.min(1,x)));}
function assess(meta,point){if(!point||meta.rtk_flag!==50||![meta.latitude,meta.longitude,point.lat,point.lng].every(Number.isFinite))return {waypoint_check:'UNKNOWN',waypoint_error_m:null};const d=distance({lat:meta.latitude,lng:meta.longitude},point);return {waypoint_error_m:d,waypoint_check:d<=1.5?'PASS':'OFFSET'};}
async function inspect(query,options,meta,assignment){const unknown={planned_waypoint_index:null,waypoint_error_m:null,waypoint_check:'UNKNOWN'};
 if(!assignment.ticketId||!meta.captured_at||!assignment.deviceSn)return unknown;
 const rows=await query(`SELECT e.route_id,e.plan_snapshot AS plan_json FROM ticket_executions e WHERE e.ticket_id=? AND e.device_sn=? AND e.route_state IN ('MANUAL_CONFIRMED','VERIFIED') AND ? BETWEEN e.started_at AND COALESCE(e.ended_at,NOW(3)) ORDER BY e.execution_id DESC LIMIT 2`,[assignment.ticketId,assignment.deviceSn,meta.captured_at]);
 if(rows.length!==1)return unknown;
 const m=/(?:^|[_-])MAP_(\d+)(?:[_.-]|$)/i.exec(options.originalName||options.fileName||'');if(!m)return unknown;
 const i=Number(m[1])-1,plan=typeof rows[0].plan_json==='string'?JSON.parse(rows[0].plan_json):rows[0].plan_json,points=plan?.geojson?.points||plan?.plan?.points||plan?.waypoints;
 if(!points?.[i])return unknown;return {planned_waypoint_index:i,...assess(meta,points[i])};
}
module.exports={distance,assess,inspect};
