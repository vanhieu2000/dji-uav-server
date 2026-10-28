const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createCommands}=require('../src/services/deviceCommands');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('commands: QoS1, exact gateway/tid/bid, rejection and timeout',async()=>{
 let packet,topic,options;const c=createCommands({getClient:()=>({connected:true,publish:(t,b,o,cb)=>{topic=t;packet=JSON.parse(b);options=o;cb();}}),timeoutMs:60});
 const p=c.send('RC1234','camera_photo_take',{});assert.equal(topic,'thing/product/RC1234/services');assert.equal(options.qos,1);
 const reply={...packet,data:{result:0}};
 assert.equal(c.reply('OTHER',reply),false);assert.equal(c.reply('RC1234',{...reply,bid:'wrong'}),false);
 assert.equal(c.reply('RC1234',reply),true);assert.equal((await p).result,0);
 const rejected=c.send('RC1234','camera_mode_switch',{});c.reply('RC1234',{...packet,data:{result:514001}});await assert.rejects(rejected,e=>e.status===422);
 await assert.rejects(c.send('RC1234','camera_photo_take',{}),e=>e.status===504);
 await assert.rejects(createCommands({getClient:()=>null}).send('RC1234','x',{}),e=>e.status===503);
});
test('commands: overlapping sequences cannot interleave',async()=>{
 const c=createCommands({getClient:()=>null});const p=c.exclusive('RC1',()=>delay(20));await assert.rejects(c.exclusive('RC1',()=>null),e=>e.status===409);await p;
});
test('control HTTP: no fallback target, authorization, ordered photo ACKs, revoked authority, real live capability',async t=>{
 const calls=[],devices={UAV1234:{type:77,sub_type:1,last_seen:new Date(),last_osd_at:new Date(),status:'ONLINE'}},gateways={RC1234:{is_cloud_control_auth:false,live_capacity:{device_list:[{sn:'UAV1234',camera_list:[{camera_index:'67-0-0',video_list:[{video_index:'real-index'}]}]}]}}};
 let failMethod=null,client=true,revoke=false;
 const commands={exclusive:async(g,fn)=>fn(),send:async(g,m,d)=>{calls.push({g,m,d});if(revoke&&m==='camera_mode_switch')gateways[g].is_cloud_control_auth=false;if(m===failMethod)throw Object.assign(new (require('../src/utils/validate').ValidationError)('Device rejected'),{status:422});return {result:0,status:'accepted'};}};
 const app=express();app.use(express.json(),(req,res,next)=>{req.user={user_id:1,role:'ADMIN',username:'fixture'};next();});
 app.use('/api/control',require('../src/routes/deviceControl').createRouter({commands,devices,gateways,gatewayOfAircraft:{UAV1234:'RC1234'},activeSession:async()=>({rc_sn:'RC1234',aircraft_sn:'UAV1234',ticket_id:1}),monitoring:{ensureStream:async()=>({streamPath:'/live/ticket_1_0123456789abcdef',channel:'ticket_1_0123456789abcdef'}),streams:async()=>[]},streamAccess:{mint:()=> 'fixture-grant'},getClient:()=>({connected:client}),liveEnabled:()=>true,liveReady:()=>true,rtmpBase:()=> 'rtmp://fixture:1935',access:{permission(){},async ticket(){}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 async function post(path,body={device_sn:'UAV1234'}){const r=await fetch(base+'/api/control/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 assert.equal((await post('photo',{})).status,400);assert.equal((await post('photo')).status,403);assert.equal(calls.length,0);
 gateways.RC1234.is_cloud_control_auth=true;assert.equal((await post('photo',{device_sn:'UAV1234',mode:'dual'})).status,200);
 assert.deepEqual(calls.map(c=>c.m),['camera_mode_switch','photo_storage_set','camera_photo_take']);assert.deepEqual(calls[1].d.photo_storage_settings,['vision','ir']);assert.ok(calls.every(c=>c.g==='RC1234'));calls.length=0;
 failMethod='camera_mode_switch';assert.equal((await post('photo')).status,422);assert.deepEqual(calls.map(c=>c.m),['camera_mode_switch']);calls.length=0;failMethod=null;
 revoke=true;assert.equal((await post('photo')).status,403);assert.equal(calls.length,1);revoke=false;calls.length=0;gateways.RC1234.is_cloud_control_auth=true;
 client=false;assert.equal((await post('photo')).status,503);client=true;
 assert.equal((await post('live',{device_sn:'UAV1234',action:'start',video_id:'UAV1234/67-0-0/wide-0'})).status,400);
 assert.equal((await post('live',{device_sn:'UAV1234',action:'start',video_id:'UAV1234/67-0-0/real-index'})).status,200);assert.match(calls.at(-1).d.url,/fixture-grant/);
 assert.equal((await post('rth')).status,410);const n=calls.length;assert.equal((await post('media-sync')).body.data.sync_command_sent,false);assert.equal(calls.length,n);
});
test('MQTT: unknown serials cannot learn from arbitrary topics or wildcard subscriptions',()=>{
 const {topicAllowed,serialsAllowed}=require('../src/services/mqttAccess');
 const unknown={session_id:1,rc_sn:null,aircraft_sn:null};assert.equal(topicAllowed(unknown,'sys/product/RC1234/status','publish'),false);assert.equal(unknown.aircraft_sn,null);
 const s={rc_sn:'RC1234',aircraft_sn:'UAV1234'};assert.equal(topicAllowed(s,'thing/product/UAV1234/osd','publish'),true);assert.equal(topicAllowed(s,'thing/product/OTHER/osd','publish'),false);assert.equal(topicAllowed(s,'thing/product/+/osd','subscribe'),false);
 assert.equal(serialsAllowed(s,{device_sn:'OTHER'}),false);assert.equal(serialsAllowed(s,{battery:{sn:'BAT1234'}}),true);
});
test('Bridge: plain and wrapped getters, setup error, false callback never accepted',()=>{
 const vm=require('vm'),fs=require('fs');const box={window:{}};vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../public/pilot-login/bridge.js'),'utf8'),box);vm.runInNewContext('Object.hasOwn=undefined',box);const p=box.window.PilotBridge;
 assert.equal(p.value('RC1234'),'RC1234');assert.equal(p.value('{"code":0,"data":true}'),true);assert.equal(p.connected(false),false);assert.equal(p.connected('{"code":1}'),false);assert.equal(p.connected('{"code":0,"data":true}'),true);assert.throws(()=>p.value('{"code":5}'));
 box.window.djiBridge={platformLoadComponent:()=>JSON.stringify({code:615012})};assert.throws(()=>p.load('thing',{password:'never-log-this'}),/platformLoadComponent \[thing\] code 615012/);
 box.window.djiBridge={platformGetRemoteControllerSN:()=> 'RC1234'};assert.equal(p.serial('platformGetRemoteControllerSN'),'RC1234');
});
test('MQTT CONNECT diagnostics distinguish cached credentials without accepting invalid sessions',async()=>{
 const crypto=require('crypto'),{authenticatePilot}=require('../src/services/mqttAccess'),password='test-only-fresh-password';
 const session={session_id:42,mqtt_password_hash:crypto.createHash('sha256').update(password).digest('hex')};
 assert.equal((await authenticatePilot('admin',password,async()=>session)).reason,'USERNAME_FORMAT');
 assert.equal((await authenticatePilot('pilot:42',password,async()=>null)).reason,'SESSION_UNAVAILABLE');
 assert.equal((await authenticatePilot('pilot:42','old-password',async()=>session)).reason,'PASSWORD_MISMATCH');
 assert.equal((await authenticatePilot(Buffer.from('pilot:42'),Buffer.from(password),async()=>session)).session,session);
 assert.equal((await authenticatePilot('pilot:42',password,async()=>{throw Error('DB fixture');})).reason,'SESSION_LOOKUP_FAILED');
});
test('Bridge reconnect replaces loaded MQTT module and rejects retained username',()=>{
 const vm=require('vm'),fs=require('fs'),calls=[];let loaded=true,active={host:'tcp://old:1883',username:'old'};
 const bridge={platformIsComponentLoaded:()=>loaded,thingDisconnect:()=>{calls.push('disconnect');return '{"code":0}';},platformUnloadComponent:()=>{calls.push('unload');loaded=false;return '{"code":0}';},platformLoadComponent:(name,raw)=>{calls.push('load');loaded=true;active=JSON.parse(raw);return '{"code":0}';},thingGetConfigs:()=>JSON.stringify(active)};
 const box={window:{djiBridge:bridge}};vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../public/pilot-login/bridge.js'),'utf8'),box);
 box.window.PilotBridge.freshThing({host:'tcp://new:1884',username:'pilot:42',password:'test-password'});
 assert.deepEqual(calls,['disconnect','unload','load']);assert.equal(active.username,'pilot:42');assert.equal(active.host,'tcp://new:1884');
 bridge.platformLoadComponent=()=>{active={host:'tcp://new:1884',username:'old'};loaded=true;return '{"code":0}';};
 assert.throws(()=>box.window.PilotBridge.freshThing({host:'tcp://new:1884',username:'pilot:43',password:'test-next'}),/MQTT cũ/);
});

test('MQTT identity diagnostics locate the rejected field without exposing payload values',()=>{
 const {serialIdentityMismatch,serialsAllowed}=require('../src/services/mqttAccess');const s={rc_sn:'RC1234',aircraft_sn:'UAV1234'};
 assert.deepEqual(serialIdentityMismatch(s,{data:{sub_devices:[{sn:'OTHER'}]}}),{path:'$.data.sub_devices[0].sn',reason:'SERIAL_MISMATCH'});
 assert.equal(serialsAllowed(s,{data:{device_sn:'UAV1234',battery:{sn:'BAT1234'}}}),true);
 assert.equal(serialsAllowed(s,{data:{gateway_sn:'OTHER'}}),false);
});

test('Mavic 3T state: payload component SN differs from aircraft without bypassing device identity',()=>{
 const {serialsAllowed,serialIdentityMismatch,topicAllowed}=require('../src/services/mqttAccess');
 const s={rc_sn:'5YSZM3K0031EYQ',aircraft_sn:'1581F5FJC243K00DNRRT'};
 const state={method:'update',data:{payloads:[{sn:'CAMERA_COMPONENT_123',payload_index:'67-0-0'},{sn:'SECOND_COMPONENT',payload_index:'68-0-0'}]}};
 assert.equal(topicAllowed(s,'thing/product/'+s.aircraft_sn+'/state','publish'),true);
 assert.equal(serialsAllowed(s,state),true);
 assert.equal(serialsAllowed(s,{data:{payloads:[{sn:'CAMERA',device_sn:'OTHER'}]}}),false);
 assert.equal(serialsAllowed(s,{data:{payloads:[{sn:'CAMERA',nested:{sn:'OTHER'}}]}}),false);
 assert.equal(serialsAllowed(s,{data:{sub_devices:[{sn:'OTHER'}]}}),false);
 assert.equal(serialsAllowed(s,{data:{sn:'OTHER'}}),false);
 assert.equal(serialsAllowed(s,{payloads:[{sn:'OTHER'}]}),false);
 assert.equal(topicAllowed(s,'thing/product/OTHER/state','publish'),false);
 assert.equal(serialIdentityMismatch(s,state),null);
});

test('Aircraft OSD remains aircraft even after state/gateway cache contamination',()=>{
 const {isGatewayOsd}=require('../src/services/telemetryIdentity');
 assert.equal(isGatewayOsd('UAV1234',{attitude_head:-100,battery:{capacity_percent:43}},{UAV1234:{}},{UAV1234:{source_state_timestamp:123}}),false);
 assert.equal(isGatewayOsd('UAV1234',{battery:{capacity_percent:43}},{UAV1234:{}},{UAV1234:{}}),false);
 assert.equal(isGatewayOsd('UAV1234',{attitude_head:0},{},{UAV1234:{}}),false);
 assert.equal(isGatewayOsd('RC1234',{app_version:'14.0',capacity_percent:72},{},{RC1234:{}}),true);
});

test('Control device listing preserves the original Express request for token revalidation',async t=>{
 const app=express();let original,validated=0;
 app.use((req,res,next)=>{req.user={user_id:1,role:'ADMIN'};original=req;next();});
 app.use('/api/control',require('../src/routes/deviceControl').createRouter({devices:{UAV1234:{status:'ONLINE',last_osd_at:new Date()}},gateways:{RC1234:{}},gatewayOfAircraft:{UAV1234:'RC1234'},activeSession:async()=>({rc_sn:'RC1234',aircraft_sn:'UAV1234',ticket_id:1}),access:{permission(){},async ticket(){}},revalidate:async req=>{assert.equal(req,original);assert.equal(req.get('authorization'),'Bearer fixture');validated++;return req.user;}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/control/devices',{headers:{Authorization:'Bearer fixture'}});
 assert.equal(res.status,200);assert.equal((await res.json()).data[0].device_sn,'UAV1234');assert.equal(validated,1);
});
