/* Audit first. Apply is explicit, transaction-protected and backed up outside Git. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {repair,score}=require('../src/services/vietnameseText');
const fields=/^(full_name|plant_name|address|area_name|string_name|panel_name|substation_name|bay_name|dcl_name|contact_name|position_desc|device_name|route_name|ticket_name|target_facility|description|notes|title|message|team_name|profile_name|unit_name|label|map_name)$/;
async function audit(conn,database){
 const [cols]=await conn.execute("SELECT TABLE_NAME AS tbl,COLUMN_NAME AS col FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND DATA_TYPE IN ('varchar','text','mediumtext','longtext','char')",[database]);
 const [keys]=await conn.execute("SELECT TABLE_NAME AS tbl,COLUMN_NAME AS col FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND CONSTRAINT_NAME='PRIMARY'",[database]);
 const pk=new Map();for(const k of keys){if(!pk.has(k.tbl))pk.set(k.tbl,[]);pk.get(k.tbl).push(k.col);}
 const changes=[],unresolved=[];let scanned=0;const quote=s=>'`'+s.replace(/`/g,'``')+'`';
 for(const {tbl,col}of cols){const key=pk.get(tbl)||[];if(!fields.test(col)||key.length!==1||/audit|log|history|migration/.test(tbl))continue;
  const [rows]=await conn.query(`SELECT ${quote(key[0])} AS id,${quote(col)} AS value FROM ${quote(tbl)} WHERE ${quote(col)} IS NOT NULL`);
  for(const r of rows){scanned++;if(typeof r.value!=='string'||!score(r.value))continue;const suggestion=repair(r.value),item={table:tbl,key:key[0],id:r.id,column:col};if(suggestion&&suggestion.remaining===0)changes.push({...item,...suggestion});else unresolved.push({...item,value:r.value});}
 }
 return {database,scanned,changes,unresolved};
}
async function apply(conn,report,backupFile){
 if(!report.changes.length)return 0;
 fs.mkdirSync(path.dirname(backupFile),{recursive:true,mode:0o700});fs.writeFileSync(backupFile,JSON.stringify({created_at:new Date().toISOString(),...report},null,2)+'\n',{flag:'wx',mode:0o600});
 await conn.beginTransaction();try{for(const c of report.changes){if(!/^[a-zA-Z0-9_]+$/.test(c.table+c.column+c.key))throw Error('Tên cột không hợp lệ');const [r]=await conn.execute(`UPDATE \`${c.table}\` SET \`${c.column}\`=? WHERE \`${c.key}\`=? AND BINARY \`${c.column}\`=BINARY ?`,[c.after,c.id,c.before]);if(r.affectedRows!==1)throw Error('Dữ liệu thay đổi trong khi sửa; đã hủy giao dịch');}await conn.commit();return report.changes.length;}catch(e){await conn.rollback();throw e;}
}
module.exports={audit,apply};
if(require.main===module){try{process.loadEnvFile(path.resolve(__dirname,'../../.env'));}catch{}require('../src/services/runtimeEnv').load();(async()=>{const mysql=require('mysql2/promise'),{dbConfig}=require('../src/config/db');const conn=await mysql.createConnection({...dbConfig,charset:'utf8mb4'});try{const report=await audit(conn,dbConfig.database),backup=path.resolve(__dirname,'../data','vietnamese-backup-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex')+'.json');const applied=process.argv.includes('--apply')?await apply(conn,report,backup):0;console.log(JSON.stringify({...report,applied,...(applied?{backup_file:backup}:{})},null,2));}finally{await conn.end();}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1});}
