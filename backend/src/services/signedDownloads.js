const crypto=require('crypto'),key=require('./authKeys').signingKey();
function hash(path,exp,sid){return crypto.createHmac('sha256',key).update(`download\n${path}\n${exp}\n${sid}`).digest('hex');}
function sign(path,user){const exp=Math.floor(Date.now()/1000)+300;return `${path}?exp=${exp}&sid=${encodeURIComponent(user.session_id)}&sig=${hash(path,exp,user.session_id)}`;}
async function verify(req){
 const {exp,sid,sig}=req.query;
 if(!/^\d{10}$/.test(exp||'')||Number(exp)<Date.now()/1000||Number(exp)>Date.now()/1000+310||typeof sid!=='string'||!/^[a-f0-9-]{36}$/.test(sid)||!/^[a-f0-9]{64}$/.test(sig||''))return false;
 if(!/^\/uploads\/waylines\/[^/]+\.kmz$/.test(req.path))return false;
 const expected=hash(req.path,exp,sid);if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;
 const {query}=require('../config/db');const [u]=await query("SELECT u.*,s.session_id FROM users u JOIN user_sessions s ON s.user_id=u.user_id WHERE s.session_id=? AND s.expires_at>NOW() AND u.status='ACTIVE' AND u.must_change_password=0",[sid]);
 if(!u)return false;
 // User session claims aren't stored as plaintext. Resolve the Pilot task by the session binding.
 const [p]=await query('SELECT * FROM pilot_sessions WHERE auth_session_id=? AND ended_at IS NULL',[sid]);
 if(p){const plants=await query('SELECT plant_id FROM user_plant_scopes WHERE user_id=?',[u.user_id]);await require('./authorization').ticket({...u,plant_ids:plants.map(x=>x.plant_id)},p.ticket_id);
  const [r]=await query('SELECT r.route_id FROM flight_routes r JOIN ticket_routes tr ON r.route_id=tr.route_id WHERE tr.ticket_id=? AND r.kmz_file_name=?',[p.ticket_id,decodeURIComponent(req.path.split('/').pop())]);if(!r)return false;
 }else if(!require('./authorization').allScopes(u))return false;
 req.user=u;return true;
}
module.exports={sign,verify};
