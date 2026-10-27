/** Initialize only an empty database; existing project databases receive additive migrations only. */
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const {runMigrations}=require('../src/db/migrate');
async function setupLocal(config,{log=console.log}={}){
 const name=config.database;if(typeof name!=='string'||!/^[A-Za-z0-9_]{1,64}$/.test(name))throw Error('MYSQL_DATABASE chỉ gồm chữ, số, dấu gạch dưới (1–64 ký tự)');
 const conn=await mysql.createConnection({host:config.host,port:config.port,user:config.user,password:config.password,charset:'utf8mb4',multipleStatements:true});
 const lockName='uav-setup:'+require('crypto').createHash('sha256').update(name).digest('hex').slice(0,48);
 let initialized=false;
 try{
  // This lock also prevents simultaneous initializations of the same empty database.
  const [[locked]]=await conn.query('SELECT GET_LOCK(?,30) AS acquired',[lockName]);if(locked.acquired!==1)throw Error('Có tiến trình khác đang khởi tạo DB; thử lại sau');
  const [tables]=await conn.execute('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[name]);
  if(!tables.length){
   const schema=fs.readFileSync(path.resolve(__dirname,'../../mysql_init/01_schema.sql'),'utf8').replace(/`dji_uav_management`/g,'`'+name+'`');
   // The source contains DROP statements. They are only allowed after the empty-database check under this lock.
   await conn.query(schema);initialized=true;log('Đã khởi tạo schema rỗng; không nạp dữ liệu mẫu.');
  }else{
   const present=new Set(tables.map(t=>t.name));
   if(!['users','plants','inspection_tickets','media_files'].every(t=>present.has(t)))throw Error('DB đang có bảng nhưng thiếu schema UAV; dừng để tránh ghi đè. Chọn DB rỗng hoặc kiểm tra bản sao lưu.');
   log('DB đã có dữ liệu: giữ nguyên bảng, chỉ chạy migration chưa áp dụng.');
  }
 }finally{try{await conn.query('SELECT RELEASE_LOCK(?)',[lockName]);}catch(e){}await conn.end();}
 const migrations=await runMigrations(config,{log});return {initialized,migrations};
}
module.exports={setupLocal};
if(require.main===module){
 try{process.loadEnvFile(path.resolve(__dirname,'../../.env'));}catch(e){}
 require('../src/services/runtimeEnv').load();
 const {dbConfig}=require('../src/config/db');
 setupLocal(dbConfig).then(r=>console.log(`DB sẵn sàng (${r.migrations.length} migration mới). Tiếp theo: npm run admin:create, rồi npm start.`)).catch(e=>{console.error('Thiết lập DB thất bại:',e.code||e.message);process.exitCode=1;});
}
