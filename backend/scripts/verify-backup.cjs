/** Isolated restore drill. Only *_test databases; native mysqldump. */
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const h=require('../test/helpers'),{archive}=require('../../ops/archive');
(async()=>{
 await h.resetTestDatabase();const db=require('../src/config/db');await db.testConnection();
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'uav-restore-drill-')),restoreDb='dji_uav_restore_test';let conn;
 try{
  const media=path.join(temp,'media');fs.mkdirSync(media);const file=path.join(media,'original.jpg'),bytes=fs.readFileSync(path.join(__dirname,'../test/fixtures/vision-input.jpg'));fs.writeFileSync(file,bytes);const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  await db.query("INSERT INTO plants (plant_code,plant_name) VALUES ('BACKUP-TEST','Fixture restore')");
  await db.query("INSERT INTO media_files (device_sn,file_name,file_url,file_path_local,sha256) VALUES ('TESTUAV','original.jpg','/fixture.jpg',?,?)",[file,sha]);
  const password=(process.env.TEST_MYSQL_DUMP_PASSWORD??h.rootConfig().password).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const configFile=path.join(temp,'mysql.cnf');fs.writeFileSync(configFile,'[client]\nhost='+h.rootConfig().host+'\nport='+h.rootConfig().port+'\nuser='+h.rootConfig().user+'\npassword="'+password+'"\n',{mode:0o600});
  const result=spawnSync(process.env.MYSQL_DUMP_BIN||'mysqldump',['--defaults-extra-file='+configFile,'--single-transaction','--no-tablespaces','--set-gtid-purged=OFF',h.TEST_DB],{maxBuffer:64*1024*1024});fs.rmSync(configFile,{force:true});
  if(result.status!==0)throw Error('mysqldump test thất bại: '+String(result.stderr).replaceAll(h.rootConfig().password,'[redacted]').replaceAll(process.env.TEST_MYSQL_DUMP_PASSWORD||'unused-placeholder','[redacted]'));fs.writeFileSync(path.join(temp,'database.sql'),result.stdout);
  const tar=path.join(temp,'snapshot.tar'),key=path.join(temp,'key'),encrypted=path.join(temp,'snapshot.uavbackup');fs.writeFileSync(key,crypto.randomBytes(32),{mode:0o600});
  assert.equal(spawnSync('tar',['-cf',tar,'-C',temp,'database.sql','media']).status,0);await archive('encrypt',tar,encrypted,key);fs.rmSync(file);fs.rmSync(path.join(temp,'database.sql'));fs.rmSync(tar);
  const restored=path.join(temp,'restored.tar');await archive('decrypt',encrypted,restored,key);assert.equal(spawnSync('tar',['-xf',restored,'-C',temp]).status,0);
  conn=await require('mysql2/promise').createConnection({...h.rootConfig(),multipleStatements:true});await conn.query('DROP DATABASE IF EXISTS `'+restoreDb+'`');await conn.query('CREATE DATABASE `'+restoreDb+'`');await conn.changeUser({database:restoreDb});await conn.query(fs.readFileSync(path.join(temp,'database.sql'),'utf8'));
  const [[plant]]=await conn.query('SELECT * FROM plants');assert.equal(plant.plant_code,'BACKUP-TEST');const [[m]]=await conn.query('SELECT * FROM media_files');assert.equal(m.sha256,sha);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(m.file_path_local)).digest('hex'),sha);
  console.log('PASS encrypted snapshot → MySQL restore into separate test DB + original JPEG SHA256; no production DB touched.');
 }finally{if(conn){await conn.query('DROP DATABASE IF EXISTS `'+restoreDb+'`');await conn.end();}await db.closePool();await h.dropTestDatabase();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
