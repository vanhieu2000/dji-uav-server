/** Preview by default. Run only after a verified backup, in maintenance. */
const fs=require('fs'),path=require('path');
try{process.loadEnvFile(path.resolve(__dirname,'../../.env'));}catch(e){}
require('../src/services/runtimeEnv').load();const db=require('../src/config/db');
(async()=>{
 if(!await db.testConnection())throw Error('Không kết nối được MySQL');
 const apply=process.argv.includes('--apply-after-backup'),[setting]=await db.query("SELECT setting_value FROM system_settings WHERE setting_key='media_retention_days'");const days=Number(setting?.setting_value)||0;
 if(!Number.isInteger(days)||days<=0){console.log('Retention ảnh tắt (0 ngày).');return;}
 const rows=await db.query("SELECT m.media_id,m.file_path_local,m.file_size FROM media_files m JOIN inspection_tickets t ON m.ticket_id=t.ticket_id WHERE t.status IN ('COMPLETED','CANCELLED') AND m.uploaded_at<DATE_SUB(NOW(),INTERVAL ? DAY) AND m.file_path_local IS NOT NULL",[days]);
 console.log(JSON.stringify({mode:apply?'apply':'preview',files:rows.length,bytes:rows.reduce((n,r)=>n+Number(r.file_size||0),0)}));if(!apply)return;
 const root=fs.realpathSync(process.env.MEDIA_DIR||path.resolve(__dirname,'../uploads/media'));
 for(const r of rows){let file;try{file=fs.realpathSync(r.file_path_local);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(file&&!file.startsWith(root+path.sep))throw Error('Đường dẫn ảnh ngoài MEDIA_DIR; dừng tác vụ');
  if(file)fs.unlinkSync(file);await db.query('UPDATE media_files SET file_path_local=NULL WHERE media_id=?',[r.media_id]);
 }
 // Metadata, detections and audit are preserved. Remote S3 has its own verified lifecycle policy.
})().catch(e=>{console.error('Retention thất bại:',e.code||e.message);process.exitCode=1;}).finally(()=>db.closePool());
