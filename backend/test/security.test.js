const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const h=require('./helpers');
test('production gate: tài khoản, phiên, phân quyền và phạm vi',async t=>{
 if(!await h.mysqlAvailable())return t.skip('MySQL chưa sẵn sàng');
 await h.resetTestDatabase();const db=require('../src/config/db');await db.testConnection();
 const auth=require('../src/routes/auth'),express=require('express'),app=express();app.use(express.json());
 const gate=require('../src/middleware/accessControl');app.use(gate.audit,gate.accessControl);
 app.use('/api/open/v1',require('../src/routes/openApi'));
 app.use('/api/auth',auth.authRouter);app.use('/api/admin',require('../src/routes/administration'));app.use('/api/workspace',require('../src/routes/workspace'));
 app.get('/api/solar/plants',(q,s)=>s.json({code:0}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await db.closePool();await h.dropTestDatabase();});
 const base='http://127.0.0.1:'+server.address().port;
 async function call(url,token,body,method){const r=await fetch(base+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,json:await r.json(),cookie:r.headers.get('set-cookie')};}
 const bcrypt=require('bcryptjs'),password='test-only-long-password';
 await db.query("INSERT INTO users (username,password_hash,full_name,role) VALUES ('admin-test',?,'Admin','ADMIN')",[await bcrypt.hash(password,4)]);
 let adminToken;
 await t.test('không token bị chặn, không có mật khẩu chung, cookie HttpOnly',async()=>{
  assert.equal((await call('/api/solar/plants')).status,401);
  assert.equal((await call('/api/auth/login',null,{username:'admin-test',password:'admin123'})).status,401);
  const r=await call('/api/auth/login',null,{username:'admin-test',password});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);adminToken=r.json.data.token;
  assert.equal((await call('/api/auth/me',adminToken)).json.data.role,'ADMIN');
 });
 let unit,plant,otherPlant,operator,operatorToken,ownTask,otherTask;
 await t.test('tạo đơn vị/người dùng, ép đổi mật khẩu',async()=>{
  unit=(await call('/api/admin/units',adminToken,{unit_code:'U1',unit_name:'Đơn vị 1'})).json.data.unit_id;
  plant=(await db.query("INSERT INTO plants (plant_code,plant_name) VALUES ('P1','Plant 1')")).insertId;
  otherPlant=(await db.query("INSERT INTO plants (plant_code,plant_name) VALUES ('P2','Plant 2')")).insertId;
  const r=await call('/api/admin/users',adminToken,{username:'operator-test',password,full_name:'Vận hành',role:'OPERATOR',unit_id:unit,plant_ids:[plant]});assert.equal(r.status,200);operator=r.json.data.user_id;
  let login=await call('/api/auth/login',null,{username:'operator-test',password});let token=login.json.data.token;
  assert.equal((await call('/api/workspace/tasks',token)).status,428);
  assert.equal((await call('/api/auth/change-password',token,{old_password:password,new_password:'new-test-only-password'})).status,200);
  assert.equal((await call('/api/auth/me',token)).status,401);
  login=await call('/api/auth/login',null,{username:'operator-test',password:'new-test-only-password'});operatorToken=login.json.data.token;
 });
 await t.test('vận hành không sửa tài sản/đọc legacy hoặc tài khoản; lọc nhà máy và đơn vị',async()=>{
  assert.equal((await call('/api/solar/plants',operatorToken)).status,403);
  assert.equal((await call('/api/admin/users',operatorToken)).status,403);
  const ctx=await call('/api/workspace/context',operatorToken);assert.deepEqual(ctx.json.data.plants.map(x=>x.plant_id),[plant]);
  assert.equal((await call('/api/workspace/plants/'+otherPlant+'/assets',operatorToken)).status,403);
  ownTask=(await call('/api/workspace/tasks',operatorToken,{ticket_name:'Phiếu riêng',inspection_type:'SOLAR_PANEL',target_facility:'P1',plant_id:plant})).json.data.ticket_id;
  assert.ok(ownTask);
  otherTask=(await db.query("INSERT INTO inspection_tickets (ticket_code,ticket_name,inspection_type,target_facility,plant_id,unit_id) VALUES ('OTHER','Khác','SOLAR_PANEL','P2',?,?)",[otherPlant,unit])).insertId;
  assert.equal((await call('/api/workspace/tasks/'+otherTask,operatorToken)).status,403);
  assert.equal((await call('/api/workspace/tasks/'+ownTask,operatorToken)).status,200);
  const ids=(await call('/api/workspace/tasks',operatorToken)).json.data.map(x=>x.ticket_id);assert.deepEqual(ids,[ownTask]);
  assert.equal((await call('/api/workspace/tasks/'+ownTask,operatorToken,{plant_id:otherPlant},'PUT')).status,403);
  await db.query('UPDATE inspection_tickets SET unit_id=NULL WHERE ticket_id=?',[ownTask]);assert.equal((await call('/api/workspace/tasks/'+ownTask,operatorToken)).status,403);
  await db.query('UPDATE inspection_tickets SET unit_id=? WHERE ticket_id=?',[unit,ownTask]);
 });
 await t.test('WebSocket không lộ sự kiện phiếu/UAV khác',async()=>{
  const u=await auth.userForToken(operatorToken),{eventAllowed}=require('../src/services/socketAccess');
  assert.equal(await eventAllowed(u,{type:'media_synced',ticket_id:ownTask}),true);
  assert.equal(await eventAllowed(u,{type:'media_synced',ticket_id:otherTask}),false);
  assert.equal(await eventAllowed(u,{type:'raw_mqtt',ticket_id:ownTask}),false);
 });
 await t.test('điện thoại: tải JPEG đúng phiếu, lặp không tạo thêm; báo cáo Word/PDF thật',async()=>{
  const fs=require('fs'),path=require('path'),bytes=fs.readFileSync(path.join(__dirname,'fixtures/vision-input.jpg'));
  async function upload(id){const f=new FormData();f.append('files',new Blob([bytes],{type:'image/jpeg'}),'manual.jpg');const r=await fetch(base+'/api/workspace/tasks/'+id+'/photos',{method:'POST',headers:{Authorization:'Bearer '+operatorToken},body:f});return {status:r.status,json:await r.json()};}
  assert.equal((await upload(otherTask)).status,403);
  const r=await upload(ownTask);assert.equal(r.status,200);assert.equal(r.json.data.items[0].status,'created');
  assert.equal((await upload(ownTask)).json.data.items[0].status,'duplicate');
  const photo=r.json.data.items[0].media_id;
  assert.equal((await fetch(base+'/api/workspace/media/'+photo,{headers:{Authorization:'Bearer '+operatorToken}})).status,200);
  for(const format of ['pdf','docx']){
   const r=await fetch(base+'/api/workspace/tasks/'+ownTask+'/report.'+format,{headers:{Authorization:'Bearer '+operatorToken}});assert.equal(r.status,200);
   const bytes=Buffer.from(await r.arrayBuffer());
   if(format==='pdf'){assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>10000);}
   else{const zip=new(require('adm-zip'))(bytes),xml=zip.readAsText('word/document.xml');assert.match(xml,/Phiếu riêng/);assert.match(xml,/chưa ký/);assert.ok(zip.getEntries().some(e=>e.entryName.startsWith('word/media/')));}
  }
  assert.equal((await call('/api/workspace/statistics?days=30',operatorToken)).status,200);
  assert.equal((await call('/api/workspace/plants/'+plant+'/assets',operatorToken)).status,200);
 });
 await t.test('API key: phạm vi hẹp, idempotent, optimistic revision, không truy cập legacy',async()=>{
  const issued=await call('/api/admin/api-keys',adminToken,{user_id:operator,label:'Fixture integration',permissions:['tasks:read','tasks:write','reports:read'],plant_ids:[plant],expires_days:1});assert.equal(issued.status,200);const key=issued.json.data.token;
  assert.equal((await call('/api/solar/plants',key)).status,401);
  const payload={ticket_name:'External test',inspection_type:'SOLAR_PANEL',target_facility:'P1',plant_id:plant};
  const first=await call('/api/open/v1/external-tasks/PMIS-TEST',key,payload,'PUT');assert.equal(first.status,200);const tid=first.json.data.ticket_id;
  const replay=await call('/api/open/v1/external-tasks/PMIS-TEST',key,payload,'PUT');assert.equal(replay.json.data.ticket_id,tid);assert.equal(replay.json.data.replayed,true);
  assert.equal((await call('/api/open/v1/external-tasks/PMIS-TEST',key,{...payload,ticket_name:'Changed'},'PUT')).status,409);
  assert.equal((await call('/api/open/v1/external-tasks/PMIS-TEST',key,{...payload,ticket_name:'Changed',revision:0},'PUT')).status,200);
  assert.equal((await call('/api/open/v1/tasks/'+otherTask,key)).status,403);
  const read=await call('/api/open/v1/external-tasks/PMIS-TEST',key);assert.equal(read.json.data.ticket.revision,1);
  await call('/api/admin/api-keys/'+issued.json.data.key_id,adminToken,{},'DELETE');assert.equal((await call('/api/open/v1/tasks',key)).status,401);
 });
 await t.test('khóa/đổi phạm vi thu hồi ngay phiên; không khóa admin cuối',async()=>{
  assert.equal((await call('/api/admin/users/'+operator,adminToken,{status:'LOCKED'},'PUT')).status,200);
  assert.equal((await call('/api/auth/me',operatorToken)).status,401);
  assert.equal((await call('/api/auth/login',null,{username:'operator-test',password:'new-test-only-password'})).status,401);
  const uid=(await call('/api/auth/me',adminToken)).json.data.user_id;
  assert.equal((await call('/api/admin/users/'+uid,adminToken,{status:'LOCKED'},'PUT')).status,400);
 });
 await t.test('khôi phục token một lần, không dùng token thô trong DB; logout',async()=>{
  const token=crypto.randomBytes(32).toString('hex'),sha=crypto.createHash('sha256').update(token).digest('hex');
  const uid=(await call('/api/auth/me',adminToken)).json.data.user_id;
  await db.query('INSERT INTO password_reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 MINUTE))',[sha,uid]);
  const payload={token,new_password:'reset-test-only-password'};
  assert.equal((await call('/api/auth/reset-password',null,payload)).status,200);
  assert.equal((await call('/api/auth/reset-password',null,payload)).status,400);
  assert.equal((await call('/api/auth/me',adminToken)).status,401);
  const login=await call('/api/auth/login',null,{username:'admin-test',password:payload.new_password});const fresh=login.json.data.token;
  assert.equal((await call('/api/auth/logout',fresh,{})).status,200);assert.equal((await call('/api/auth/me',fresh)).status,401);
  await call('/api/solar/plants?token=do-not-log-this');
  await new Promise(r=>setTimeout(r,50));const rows=await db.query('SELECT path FROM access_audit');assert.ok(rows.length);assert.ok(rows.every(x=>!x.path.includes('token=')));
 });
});
