const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),net=require('net'),{spawn}=require('child_process');
const h=require('./helpers');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn,ms=15000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await new Promise(r=>setTimeout(r,50));}throw last||Error('Timeout');}
test('server thật + 10 UAV MQTT và camera M3T giả lập, localhost không thiết bị thật)',async t=>{
 if(!await h.mysqlAvailable())return t.skip('MySQL indisponible');await h.resetTestDatabase();const db=require('../src/config/db');await db.testConnection();
 const auth=require('../src/routes/auth'),bcrypt=require('bcryptjs');const [admin]=[await db.query("INSERT INTO users (username,password_hash,full_name,role) VALUES ('runtime-admin',?,'Fixture','ADMIN')",[await bcrypt.hash('runtime-test-password',4)])];
 const [user]=await db.query('SELECT * FROM users WHERE user_id=?',[admin.insertId]);const token=await auth.issueToken(user);
 const httpPort=await port(),mqttPort=await port();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uav-runtime-'));
 const log=fs.openSync(path.join(dir,'server.log'),'w'),child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(httpPort),MQTT_PORT:String(mqttPort),HOST_IP:'127.0.0.1',LIVE_STREAM_ENABLED:'false',MQTT_BROKER_URL:'',VISION_ENABLED:'false',NODE_ENV:'test',STORAGE_MODE:'local',LOCAL_STORAGE_DIR:path.join(dir,'native-storage'),JWT_SECRET:process.env.JWT_SECRET},stdio:['ignore',log,log]});
 const clients=[];let serverExited=false;child.on('exit',()=>serverExited=true);
 t.after(async()=>{for(const c of clients)c.end(true);child.kill('SIGTERM');await until(()=>serverExited).catch(()=>child.kill('SIGKILL'));fs.closeSync(log);await db.closePool();await h.dropTestDatabase();});
 const base='http://127.0.0.1:'+httpPort;
 await until(async()=>{if(serverExited)throw Error('Server exited: '+fs.readFileSync(path.join(dir,'server.log'),'utf8').slice(-2000));const r=await fetch(base+'/api/health');return r.ok;});
 const headers={Authorization:'Bearer '+token};
 assert.equal((await fetch(base+'/api/devices')).status,401);
 for(const endpoint of ['/api/control/photo','/api/control/live','/api/control/authorize'])assert.equal((await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(base+'/storage/api/v1/workspaces/runtime-workspace/sts')).status,401);
 assert.equal((await fetch(base+'/uploads/media/private.jpg')).status,401);
 assert.equal((await fetch(base+'/api/devices',{headers:{Origin:'https://foreign.example'}})).status,403);
 assert.equal((await fetch(base+'/foo/media/unsigned.jpg',{method:'PUT',body:'bad'})).status,404);
 assert.equal((await fetch(base+'/api/mqtt/test-publish',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({topic:'thing/product/FAKE/services'})})).status,410);
 const mqtt=require('mqtt');
 async function connect(options,accept=true){return new Promise((resolve,reject)=>{const c=mqtt.connect('mqtt://127.0.0.1:'+mqttPort,{...options,reconnectPeriod:0,connectTimeout:3000});clients.push(c);const timer=setTimeout(()=>{c.end(true);reject(Error('MQTT timeout'));},4000);c.on('connect',()=>{clearTimeout(timer);accept?resolve(c):reject(Error('Unauthenticated MQTT accepted'));});c.on('error',()=>{clearTimeout(timer);accept?reject(Error('MQTT auth failure')):resolve(null);});});}
 assert.equal(await connect({},false),null);
 const fixture=[];
 for(let n=0;n<10;n++){
  const sn='TESTUAV'+String(n).padStart(4,'0'),rc='TESTRC'+String(n).padStart(4,'0');
  const tid=(await db.query("INSERT INTO inspection_tickets (ticket_code,ticket_name,inspection_type,target_facility) VALUES (?,?,'SOLAR_PANEL','Fixture')",['LOAD-'+n,'Test '+n])).insertId;
  const session=(await db.query('INSERT INTO pilot_sessions (user_id,username,ticket_id,rc_sn,aircraft_sn,upload_namespace) VALUES (?,?,?,?,?,?)',[user.user_id,user.username,tid,rc,sn,crypto.randomUUID()])).insertId;
  const credentials=await require('../src/services/mqttAccess').credentials(session,await auth.userForToken(token));
  fixture.push({sn,tid,session,credentials,client:await connect(credentials)});
 }
 // A Mavic aircraft state packet precedes OSD; its camera SN must not make it a gateway.
 await Promise.all(fixture.map(({sn,client})=>new Promise((resolve,reject)=>client.publish(`thing/product/${sn}/state`,JSON.stringify({timestamp:Date.now(),data:{payloads:[{sn:'CAMERA_COMPONENT',payload_index:'67-0-0'}]}}),{qos:1},e=>e?reject(e):resolve()))));
 // All ten send concurrently; only telemetry fixture packets, no service/control topics.
 await Promise.all(fixture.map(async({sn,client},index)=>{for(let n=0;n<40;n++){await new Promise((resolve,reject)=>client.publish(`thing/product/${sn}/osd`,JSON.stringify({timestamp:Date.now()+n,data:{latitude:10+index/1000,longitude:106+index/1000,height:10,elevation:10,attitude_head:0,capacity_percent:50,velocity_x:2,velocity_y:0}}),{qos:1},e=>e?reject(e):resolve()));await new Promise(r=>setTimeout(r,100));}}));
 await until(async()=>{const rows=await db.query("SELECT device_sn FROM uav_devices WHERE device_sn LIKE 'TESTUAV%'");return rows.length===10;});
 const controls=await fetch(base+'/api/control/devices',{headers});assert.equal(controls.status,200);assert.deepEqual((await controls.json()).data,[]);
 const api=await fetch(base+'/api/monitoring/devices',{headers});assert.equal(api.status,200);const actual=(await api.json()).data.filter(d=>d.device_sn.startsWith('TESTUAV'));assert.equal(actual.length,10);assert.equal(new Set(actual.map(d=>d.device_sn)).size,10);for(const d of actual)assert.notEqual(d.status,'OFFLINE');
 const tracker=await db.query("SELECT device_sn,ticket_id FROM flight_sessions WHERE device_sn LIKE 'TESTUAV%'");assert.equal(tracker.length,10);for(const f of tracker)assert.equal(f.ticket_id,fixture.find(x=>x.sn===f.device_sn).tid);
 const {topicAllowed}=require('../src/services/mqttAccess');assert.equal(topicAllowed({aircraft_sn:fixture[0].sn},`thing/product/${fixture[1].sn}/osd`,'publish'),false);
 const first=fixture[0];const denied=await new Promise(resolve=>first.client.subscribe('thing/product/#',(err,granted)=>resolve(Boolean(err)||granted[0].qos===128)));assert.equal(denied,true);
 // Scoped native API uses exact Pilot session; no fallback to another task/library.
 const pilotToken=await auth.issuePilotToken(user,first.session,'runtime-workspace');const refreshedMqtt=await require('../src/services/mqttAccess').credentials(first.session,await auth.userForToken(pilotToken));
 assert.equal(await connect(first.credentials,false),null);await connect(refreshedMqtt);
 const connection=await fetch(base+'/api/pilot/connection',{headers:{'x-auth-token':pilotToken}});assert.equal(connection.status,200);const connectionState=(await connection.json()).data;assert.equal(connectionState.mqtt_connected,true);assert.equal(connectionState.mqtt_auth.reason,'OK');
 const routes=await fetch(base+'/wayline/api/v1/workspaces/runtime-workspace/waylines',{headers:{'x-auth-token':pilotToken}});assert.equal(routes.status,200);assert.deepEqual((await routes.json()).data.list,[]);
 const badWorkspace=await fetch(base+'/wayline/api/v1/workspaces/OTHER/waylines',{headers:{'x-auth-token':pilotToken}});assert.equal(badWorkspace.status,403);
 const storage=await fetch(base+'/storage/api/v1/workspaces/runtime-workspace/sts',{headers:{'x-auth-token':pilotToken}});assert.equal(storage.status,200);
 const grant=(await storage.json()).data,{S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
 const nativeS3=new S3Client({endpoint:grant.endpoint,region:grant.region,forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',credentials:{accessKeyId:grant.credentials.access_key_id,secretAccessKey:grant.credentials.access_key_secret,sessionToken:grant.credentials.security_token}});
 const objectKey=grant.object_key_prefix+'real-native_W.JPG',jpeg=h.fakeDjiJpeg({lat:10,lng:106,rel:0,date:new Date().toISOString().slice(0,19).replace(/-/g,':').replace('T',' ')});
 await nativeS3.send(new PutObjectCommand({Bucket:grant.bucket,Key:objectKey,Body:jpeg,ContentType:'image/jpeg'}));
 const callback=()=>fetch(base+'/media/api/v1/workspaces/runtime-workspace/upload-callback',{method:'POST',headers:{'x-auth-token':pilotToken,'Content-Type':'application/json'},body:JSON.stringify({name:'real-native_W.JPG',object_key:objectKey})});
 const ingested=await callback();assert.equal(ingested.status,200);const received=(await ingested.json()).data;
 const [photo]=await db.query('SELECT * FROM media_files WHERE media_id=?',[received.media_id]);assert.equal(photo.ticket_id,first.tid);assert.ok(fs.readFileSync(photo.file_path_local).equals(jpeg));assert.equal((await callback()).status,200);

 // Bench simulator on the private random-port localhost broker. No real RC/UAV is connected.
 const learnedRc='BINDRC1234',learnedUav='BINDUAV1234';
 const learnedSession=(await db.query('INSERT INTO pilot_sessions (user_id,username,ticket_id,rc_sn,upload_namespace) VALUES (?,?,?,?,?)',[user.user_id,user.username,first.tid,learnedRc,crypto.randomUUID()])).insertId;
 const learnedCredentials=await require('../src/services/mqttAccess').credentials(learnedSession,await auth.userForToken(token));
 const simulator=await connect(learnedCredentials),methods=[];
 const publish=(topic,packet)=>new Promise((resolve,reject)=>simulator.publish(topic,JSON.stringify(packet),{qos:1},e=>e?reject(e):resolve()));
 await new Promise((resolve,reject)=>simulator.subscribe(`thing/product/${learnedRc}/services`,{qos:1},e=>e?reject(e):resolve()));
 simulator.on('message',(topic,bytes)=>{
  if(topic!==`thing/product/${learnedRc}/services`)return;
  const packet=JSON.parse(bytes);methods.push(packet.method);
  publish(`thing/product/${learnedRc}/services_reply`,{tid:packet.tid,bid:packet.bid,timestamp:Date.now(),method:packet.method,data:{result:0}}).catch(()=>{});
  if(packet.method==='cloud_control_auth_request')publish(`thing/product/${learnedRc}/state`,{timestamp:Date.now(),data:{is_cloud_control_auth:true}}).catch(()=>{});
 });
 await publish(`sys/product/${learnedRc}/status`,{tid:crypto.randomUUID(),bid:crypto.randomUUID(),method:'update_topo',timestamp:Date.now(),data:{sub_devices:[{sn:learnedUav,type:77,sub_type:1}]}});
 await until(async()=>{const [row]=await db.query('SELECT aircraft_sn FROM pilot_sessions WHERE session_id=?',[learnedSession]);return row.aircraft_sn===learnedUav;});
 await publish(`thing/product/${learnedUav}/osd`,{timestamp:Date.now(),data:{latitude:10,longitude:106,height:0,elevation:0,horizontal_speed:0}});
 async function control(path){const r=await fetch(base+'/api/control/'+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({device_sn:learnedUav,mode:'dual'})});return {status:r.status,data:await r.json()};}
 async function readiness(){const r=await fetch(base+'/api/control/status?device_sn='+learnedUav,{headers});return (await r.json()).data;}
 await until(async()=>{try{return (await readiness()).telemetry_fresh;}catch{return false;}});
 assert.equal((await control('photo')).status,403);assert.deepEqual(methods,[]);
 assert.equal((await control('authorize')).status,200);await until(async()=> (await readiness()).cloud_control_authorized);
 const captured=await control('photo');assert.equal(captured.status,200);assert.equal(captured.data.data.image_received,false);
 assert.deepEqual(methods,['cloud_control_auth_request','camera_mode_switch','photo_storage_set','camera_photo_take']);
 await publish(`thing/product/${learnedRc}/state`,{timestamp:Date.now(),data:{is_cloud_control_auth:false}});await until(async()=>!(await readiness()).cloud_control_authorized);
 assert.equal((await control('photo')).status,403);
 const lib=require('../src/services/routeLibrary');fs.mkdirSync(lib.WAYLINE_DIR,{recursive:true});const zip=new(require('adm-zip'))();zip.addFile('wpmz/waylines.wpml',Buffer.from('<kml/>'));const kmz=path.join(lib.WAYLINE_DIR,'fixture-download.kmz');fs.writeFileSync(kmz,zip.toBuffer());
 const route=await lib.addKmz({fileName:'fixture-download.kmz',routeName:'TEST ONLY — do not fly'});await db.query('INSERT INTO ticket_routes (ticket_id,route_id,sort_order) VALUES (?,?,0)',[first.tid,route.route_id]);
 const urlResponse=await fetch(base+'/wayline/api/v1/workspaces/runtime-workspace/waylines/'+route.route_uuid+'/url?format=json',{headers:{'x-auth-token':pilotToken}});assert.equal(urlResponse.status,200);const link=(await urlResponse.json()).data.url;
 const download=await fetch(link);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),fs.readFileSync(kmz));
 const changed=new URL(link);changed.searchParams.set('exp','1000000000');assert.equal((await fetch(changed)).status,401);
 await db.query('DELETE FROM user_sessions WHERE session_id=?',[auth.decodeToken(pilotToken).jti]);assert.equal((await fetch(link)).status,401);

 const authLogs=fs.readFileSync(path.join(dir,'server.log'),'utf8');assert.match(authLogs,/reason=PASSWORD_MISMATCH/);assert.ok(!authLogs.includes(first.credentials.password));assert.ok(!authLogs.includes(refreshedMqtt.password));
 const diagnosticResponse=await fetch(base+'/api/diagnostics/export',{headers});assert.equal(diagnosticResponse.status,200);const diagnosticZip=new(require('adm-zip'))(Buffer.from(await diagnosticResponse.arrayBuffer()));assert.ok(diagnosticZip.getEntry('manifest.json'));const diagnosticText=diagnosticZip.getEntries().filter(e=>e.entryName.endsWith('.jsonl')).map(e=>e.getData().toString()).join('');assert.ok(!diagnosticText.includes(first.credentials.password));assert.ok(!diagnosticText.includes(refreshedMqtt.password));assert.ok(!diagnosticText.includes('runtime-test-password'));assert.ok(diagnosticZip.getEntries().every(e=>!e.entryName.endsWith('.env')));
 // Persistent RC login: cookie is HttpOnly and only a hash is stored; no password reuse in requests.
 async function pilotLogin(body,cookie){return fetch(base+'/api/pilot/login',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
 const remembered=await pilotLogin({username:'runtime-admin',password:'runtime-test-password',ticketId:first.tid,remember:true});assert.equal(remembered.status,200);
 const rememberedHeader=remembered.headers.getSetCookie().find(c=>c.includes('Max-Age=2592000'));assert.match(rememberedHeader,/HttpOnly/);assert.match(rememberedHeader,/SameSite=Strict/);const saved=rememberedHeader.split(';')[0],raw=saved.split('=')[1];
 assert.equal((await fetch(base+'/api/pilot/remember',{headers:{Cookie:saved}}).then(r=>r.json())).data.available,true);
 const [stored]=await db.query('SELECT token_hash FROM pilot_remember_tokens WHERE token_hash=?',[crypto.createHash('sha256').update(raw).digest('hex')]);assert.ok(stored);assert.notEqual(stored.token_hash,raw);
 const resumed=await pilotLogin({use_saved_login:true,ticketId:first.tid,remember:true},saved);assert.equal(resumed.status,200);const renewed=resumed.headers.getSetCookie().find(c=>c.includes('Max-Age=2592000')).split(';')[0];
 assert.equal((await fetch(base+'/api/pilot/remember',{headers:{Cookie:saved}}).then(r=>r.json())).data.available,false);
 assert.equal((await fetch(base+'/api/pilot/remember/forget',{method:'POST',headers:{Cookie:renewed}})).status,200);
 assert.equal((await pilotLogin({use_saved_login:true,ticketId:first.tid,remember:true},renewed)).status,401);
 const againSaved=await pilotLogin({username:'runtime-admin',password:'runtime-test-password',ticketId:first.tid,remember:true}),revokedCookie=againSaved.headers.getSetCookie().find(c=>c.includes('Max-Age=2592000')).split(';')[0];
 await db.query('UPDATE users SET auth_version=auth_version+1 WHERE user_id=?',[user.user_id]);assert.equal((await pilotLogin({use_saved_login:true,ticketId:first.tid,remember:true},revokedCookie)).status,401);

});
