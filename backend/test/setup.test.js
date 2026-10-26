const test=require('node:test'),assert=require('node:assert/strict'),mysql=require('mysql2/promise'),h=require('./helpers');
test('local setup: init empty DB, preserve existing data, refuse unrelated DB',async t=>{
 if(!await h.mysqlAvailable())return t.skip('MySQL chưa sẵn sàng');
 const name=h.TEST_DB+'_setup',partial=name+'_partial';
 if(!/^[A-Za-z0-9_]{1,64}$/.test(partial)||!name.includes('test'))throw Error('Tên DB test không an toàn');
 const root=await mysql.createConnection(h.rootConfig());
 t.after(async()=>{await root.query('DROP DATABASE IF EXISTS `'+name+'`');await root.query('DROP DATABASE IF EXISTS `'+partial+'`');await root.end();});
 await root.query('DROP DATABASE IF EXISTS `'+name+'`');await root.query('DROP DATABASE IF EXISTS `'+partial+'`');
 const {setupLocal}=require('../scripts/setup-local'),config={...h.rootConfig(),database:name};
 const first=await setupLocal(config,{log:()=>{}});assert.equal(first.initialized,true);assert.ok(first.migrations.length>=13);
 await root.query('INSERT INTO `'+name+"`.plants (plant_code,plant_name) VALUES ('KEEP','Giữ dữ liệu')");
 const second=await setupLocal(config,{log:()=>{}});assert.equal(second.initialized,false);assert.deepEqual(second.migrations,[]);
 const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uav-setup-cli-')),passwordFile=path.join(dir,'password');
 try{
  const env={...process.env,MYSQL_HOST:config.host,MYSQL_PORT:String(config.port),MYSQL_USER:config.user,MYSQL_PASSWORD:config.password,MYSQL_DATABASE:name,BOOTSTRAP_ADMIN_USER:'setup-fixture-admin',BOOTSTRAP_PASSWORD_FILE:passwordFile};delete env.MYSQL_PASSWORD_FILE;
  const create=()=>spawnSync(process.execPath,['scripts/create-admin.js'],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8'});
  const cli=create();assert.equal(cli.status,0,cli.stderr);const secret=fs.readFileSync(passwordFile,'utf8');assert.ok(secret.trim().length>=24);assert.ok(!cli.stdout.includes(secret.trim()));
  const [[u]]=await root.query('SELECT role,must_change_password,password_hash FROM `'+name+"`.users WHERE username='setup-fixture-admin'");assert.equal(u.role,'ADMIN');assert.equal(u.must_change_password,1);assert.match(u.password_hash,/^\$2[aby]\$/);
  assert.notEqual(create().status,0);assert.equal(fs.readFileSync(passwordFile,'utf8'),secret);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 const [[p]]=await root.query('SELECT plant_code FROM `'+name+'`.plants');assert.equal(p.plant_code,'KEEP');
 await root.query('CREATE DATABASE `'+partial+'`');await root.query('CREATE TABLE `'+partial+'`.unrelated (id INT)');
 await assert.rejects(setupLocal({...config,database:partial},{log:()=>{}}),/DB đang có bảng/);
 const [rows]=await root.query('SHOW TABLES FROM `'+partial+'`');assert.equal(rows.length,1);
});
