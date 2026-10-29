const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawn,spawnSync}=require('child_process');
const h=require('./helpers'),{portNumber,freePort,running}=require('../scripts/start-local');
test('local launcher: validate ports and never reuse an unidentified health endpoint',async()=>{
 assert.equal(portNumber('',8080),8080);assert.equal(portNumber('8081',8080),8081);for(const bad of ['abc','80',70000,1.5])assert.throws(()=>portNumber(bad,8080));
 assert.equal(await running({port:8080,instance:'not-an-id'}),false);
 const net=require('net'),server=net.createServer();await new Promise(r=>server.listen(0,'0.0.0.0',r));const port=server.address().port;
 try{const selected=await freePort(port);assert.ok(selected>port);}finally{await new Promise(r=>server.close(r));}
});
test('LAN: prefer Wi-Fi, reject ambiguous adapters, preserve explicit host and build consistent URLs',()=>{
 const {resolveHost,urls}=require('../src/services/localNetwork');
 const nic=address=>[{family:'IPv4',address,internal:false}];
 const interfaces={'Ethernet':nic('192.168.2.10'),'Wi-Fi':nic('192.168.1.20'),'vEthernet (WSL)':nic('172.20.0.1'),'docker0':nic('172.17.0.1')};
 assert.equal(resolveHost({configured:'auto',interfaces}),'192.168.1.20');assert.equal(resolveHost({configured:'127.0.0.1',interfaces}),'192.168.1.20');
 assert.equal(resolveHost({configured:'192.168.9.2',interfaces}),'192.168.9.2');assert.equal(resolveHost({configured:'auto',mode:'loopback',interfaces}),'127.0.0.1');
 assert.throws(()=>resolveHost({interfaces:{a:nic('10.1.1.2'),b:nic('10.2.1.2')}}),/HOST_IP/);assert.throws(()=>resolveHost({interfaces:{docker0:nic('172.17.0.1'),wifi:nic('169.254.1.2')}}),/IPv4 LAN/);
 assert.deepEqual(urls('192.168.1.20',8081,1884),{dashboard:'http://192.168.1.20:8081/dashboard/',pilot:'http://192.168.1.20:8081/pilot-login/',mqtt:'tcp://192.168.1.20:1884'});
});
test('one-click: initialize in path with spaces, start, reuse without reset, stop cleanly',async t=>{
 if(!await h.mysqlAvailable())return t.skip('MySQL chưa sẵn sàng');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'uav launcher with spaces ')),backend=path.join(root,'backend'),data=path.join(backend,'data'),source=path.resolve(__dirname,'..'),database=h.TEST_DB+'_launcher';
 if(!/^[A-Za-z0-9_]{1,64}$/.test(database)||!database.includes('test'))throw Error('Tên DB test không an toàn');
 const c=await require('mysql2/promise').createConnection(h.rootConfig());let launcher,log,exited=false;
 t.after(async()=>{if(launcher&&!exited){launcher.kill('SIGTERM');for(let n=0;n<100&&!exited;n++)await new Promise(r=>setTimeout(r,50));}if(log!=null)fs.closeSync(log);await c.query('DROP DATABASE IF EXISTS `'+database+'`');await c.end();fs.rmSync(root,{recursive:true,force:true});});
 await c.query('DROP DATABASE IF EXISTS `'+database+'`');fs.mkdirSync(data,{recursive:true});
 for(const folder of ['src','scripts','public'])fs.cpSync(path.join(source,folder),path.join(backend,folder),{recursive:true});
 for(const file of ['server.js','package.json','package-lock.json'])fs.copyFileSync(path.join(source,file),path.join(backend,file));
 fs.cpSync(path.resolve(source,'../mysql_init'),path.join(root,'mysql_init'),{recursive:true});fs.symlinkSync(path.join(source,'node_modules'),path.join(backend,'node_modules'),'junction');
 const config=h.rootConfig(),port=await freePort(19080),mqtt=await freePort(19180,[port]);
 const env={...process.env,MYSQL_HOST:config.host,MYSQL_PORT:String(config.port),MYSQL_USER:config.user,MYSQL_PASSWORD:config.password,MYSQL_DATABASE:database,PORT:String(port),MQTT_PORT:String(mqtt),HOST_IP:'127.0.0.1',LOCAL_NETWORK_MODE:'loopback',BOOTSTRAP_ADMIN_USER:'launcher-admin',BOOTSTRAP_PASSWORD_FILE:path.join(data,'password'),LOCAL_NO_BROWSER:'1',NODE_ENV:'test',LIVE_STREAM_ENABLED:'false',VISION_ENABLED:'false',MQTT_BROKER_URL:''};delete env.MYSQL_PASSWORD_FILE;
 fs.writeFileSync(path.join(root,'.env'),Object.entries(env).filter(([k])=>['MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE','PORT','MQTT_PORT','HOST_IP','BOOTSTRAP_ADMIN_USER'].includes(k)).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n'),{mode:0o600});
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(backend,'package-lock.json'))).digest('hex');fs.writeFileSync(path.join(data,'local-deps.sha256'),hash);
 log=fs.openSync(path.join(data,'test.log'),'w');launcher=spawn(process.execPath,['scripts/start-local.js'],{cwd:backend,env,stdio:['ignore',log,log]});launcher.on('exit',()=>exited=true);
 const stateFile=path.join(data,'local-launcher.json');let state,ready=false;
 for(let n=0;n<300;n++){if(exited)throw Error('Launcher exited: '+fs.readFileSync(path.join(data,'test.log'),'utf8'));try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));ready=await running(state);if(ready)break;}catch(e){}await new Promise(r=>setTimeout(r,50));}
 assert.equal(ready,true);assert.ok(fs.existsSync(path.join(data,'password')));assert.ok(fs.existsSync(path.join(data,'operator-password.txt')));const [[operator]]=await c.query('SELECT role,all_operation_scopes,must_change_password,password_hash FROM `'+database+"`.users WHERE username='operator'");assert.equal(operator.role,'OPERATOR');assert.equal(operator.all_operation_scopes,1);assert.equal(operator.must_change_password,1);
 const [[admin]]=await c.query('SELECT password_hash FROM `'+database+"`.users WHERE username='launcher-admin'");
 await c.query('INSERT INTO `'+database+"`.plants (plant_code,plant_name) VALUES ('KEEP','Giữ nguyên')");
 const again=spawnSync(process.execPath,['scripts/start-local.js'],{cwd:backend,env,encoding:'utf8',timeout:15000});assert.equal(again.status,0,again.stderr);assert.match(again.stdout,/Server đang chạy/);assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).pid,state.pid);
 const [[after]]=await c.query('SELECT password_hash FROM `'+database+"`.users WHERE username='launcher-admin'");assert.equal(after.password_hash,admin.password_hash);const [[count]]=await c.query('SELECT COUNT(*) AS n FROM `'+database+'`.plants');assert.equal(count.n,1);
 fs.appendFileSync(path.join(root,'.env'),'\n# config changed\n');const changed=spawnSync(process.execPath,['scripts/start-local.js'],{cwd:backend,env,encoding:'utf8',timeout:15000});assert.notEqual(changed.status,0);assert.equal(await running(state),true);
 launcher.kill('SIGTERM');for(let n=0;n<100&&!exited;n++)await new Promise(r=>setTimeout(r,50));assert.equal(exited,true);assert.equal(fs.existsSync(stateFile),false);assert.equal(fs.existsSync(path.join(data,'local-launcher.lock')),false);assert.equal(await running(state),false);
 // A full restart also keeps the existing administrator and data (not just a second click).
 exited=false;launcher=spawn(process.execPath,['scripts/start-local.js'],{cwd:backend,env,stdio:['ignore',log,log]});launcher.on('exit',()=>exited=true);ready=false;
 for(let n=0;n<300;n++){if(exited)throw Error('Restart exited: '+fs.readFileSync(path.join(data,'test.log'),'utf8'));try{const next=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(await running(next)){ready=true;break;}}catch(e){}await new Promise(r=>setTimeout(r,50));}
 assert.equal(ready,true);const [[restarted]]=await c.query('SELECT password_hash FROM `'+database+"`.users WHERE username='launcher-admin'");assert.equal(restarted.password_hash,admin.password_hash);const [[sameOperator]]=await c.query('SELECT password_hash FROM `'+database+"`.users WHERE username='operator'");assert.equal(sameOperator.password_hash,operator.password_hash);const [[saved]]=await c.query('SELECT COUNT(*) AS n FROM `'+database+'`.plants');assert.equal(saved.n,1);
});
