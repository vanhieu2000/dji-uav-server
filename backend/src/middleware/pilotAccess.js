const {query}=require('../config/db'),a=require('../services/authorization');
async function pilotAccess(req){
 const p=req.path;
 if(!req.user?.pilot_session_id)return false;
 const [s]=await query('SELECT * FROM pilot_sessions WHERE session_id=? AND user_id=? AND ended_at IS NULL AND started_at>DATE_SUB(NOW(),INTERVAL 12 HOUR)',[req.user.pilot_session_id,req.user.user_id]);
 if(!s)throw a.denied();await a.ticket(req.user,s.ticket_id);
 const match=/^\/(wayline|manage|storage|media)\/api\/v1\/workspaces\/([^/]+)\/(.+)$/.exec(p);
 if((p==='/api/pilot/identity'&&req.method==='POST')||(p==='/api/pilot/connection'&&req.method==='GET')){req.pilotSession=s;return true;}
 if(match){
  if(match[2]!==req.user.workspace_id)throw a.denied();
  const suffix=match[3],read=req.method==='GET';
  if(read&&/^waylines(?:\/[^/]+(?:\/(url|download))?)?$/.test(suffix)){
   a.permission(req.user,'tasks:read');
   const rid=suffix.split('/')[1];if(rid&&rid!=='duplicate-names'){
    const r=await require('../services/routeLibrary').findRoute(rid);if(!r)throw a.denied();
    const [assigned]=await query('SELECT route_id FROM ticket_routes WHERE ticket_id=? AND route_id=?',[s.ticket_id,r.route_id]);if(!assigned)throw a.denied();
   }req.pilotSession=s;return true;
  }
  if((read&&suffix==='files')||(['GET','POST'].includes(req.method)&&['sts','storage-configs'].includes(suffix))||(req.method==='POST'&&['files/upload','upload-callback','fast-upload','files/tiny-fingerprints'].includes(suffix))){
   a.permission(req.user,read&&suffix==='files'?'tasks:read':'media:write');req.pilotSession=s;return true;
  }
 }
 if(req.method==='GET'&&/^\/uploads\/media\/[A-Za-z0-9_.-]+\.jpe?g$/i.test(p)){
  a.permission(req.user,'tasks:read');const [m]=await query('SELECT ticket_id FROM media_files WHERE file_name=?',[p.split('/').pop()]);
  if(!m||m.ticket_id!==s.ticket_id)throw a.denied();req.pilotSession=s;return true;
 }
 if(req.method==='GET'&&/^\/uploads\/waylines\/[^/]+\.kmz$/.test(p)){
  const name=decodeURIComponent(p.split('/').pop()),[r]=await query('SELECT r.route_id FROM flight_routes r JOIN ticket_routes tr ON tr.route_id=r.route_id WHERE tr.ticket_id=? AND r.kmz_file_name=?',[s.ticket_id,name]);if(!r)throw a.denied();req.pilotSession=s;return true;
 }
 return false;
}
module.exports={pilotAccess};
