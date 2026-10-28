const {query}=require('../config/db');
const v=require('../utils/validate');
function denied(){const e=new v.ValidationError('Không có quyền với dữ liệu này');e.status=403;return e;}
const businessPermissions=new Set(['tasks:read','tasks:write','assets:read','assets:write','media:write','alerts:write','reports:read']);
function allScopes(user){return user.role==='ADMIN'||(user.role==='OPERATOR'&&Number(user.all_operation_scopes)===1);}
function permission(user,name){if(user.role!=='ADMIN'&&!(allScopes(user)&&businessPermissions.has(name))&&!(user.permissions||[]).includes(name))throw denied();}
function plant(user,id){if(!allScopes(user)&&!user.plant_ids.includes(Number(id)))throw denied();}
async function ticket(user,id){
    const [t]=await query('SELECT * FROM inspection_tickets WHERE ticket_id=?',[id]);
    if(!t)throw denied();
    if(!allScopes(user)){plant(user,t.plant_id);if(!user.unit_id||t.unit_id!==user.unit_id)throw denied();}
    return t;
}
async function media(user,id){
    const [m]=await query('SELECT * FROM media_files WHERE media_id=?',[id]);if(!m)throw denied();await ticket(user,m.ticket_id);return m;
}
module.exports={permission,plant,ticket,media,denied,allScopes};
