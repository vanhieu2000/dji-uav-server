/** Explicit local bootstrap: OPERATOR gets broad business access explicitly requested for this account; never reset an existing account. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
async function ensureOperator(db,env=process.env){
 const username=env.BOOTSTRAP_OPERATOR_USER||'operator';if(!/^[A-Za-z0-9_.-]{3,50}$/.test(username))throw Error('BOOTSTRAP_OPERATOR_USER không hợp lệ');
 const [existing]=await db.query('SELECT user_id,role FROM users WHERE username=?',[username]);
 if(existing){if(existing.role!=='OPERATOR')throw Error('Tên '+username+' đã thuộc vai trò khác; không tự sửa quyền.');return {username,created:false};}
 const file=env.OPERATOR_PASSWORD_FILE?path.resolve(env.OPERATOR_PASSWORD_FILE):path.resolve(__dirname,'../data',username+'-password.txt');
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const password=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(file,password+'\n',{mode:0o600,flag:'wx'});
 try{const result=await db.query("INSERT INTO users (username,password_hash,full_name,role,must_change_password,all_operation_scopes) VALUES (?,?,?,'OPERATOR',1,1)",[username,await bcrypt.hash(password,12),'Vận hành UAV']);return {username,user_id:result.insertId,created:true,passwordFile:file};}catch(e){fs.rmSync(file,{force:true});throw e;}
}
module.exports={ensureOperator};
if(require.main===module){try{process.loadEnvFile(path.resolve(__dirname,'../../.env'));}catch{}require('../src/services/runtimeEnv').load();const db=require('../src/config/db');(async()=>{await require('./setup-local').setupLocal(db.dbConfig);if(!await db.testConnection())throw Error('Không kết nối được MySQL');const r=await ensureOperator(db);console.log(r.created?'Đã tạo '+r.username+'. Mật khẩu ban đầu: '+r.passwordFile:'Tài khoản '+r.username+' đã tồn tại; giữ nguyên mật khẩu/phạm vi.');console.log('Operator tạm có toàn bộ phạm vi nghiệp vụ, không có quyền quản trị tài khoản/cài đặt. Admin có thể thu hẹp trong Quản lý tài khoản. Operator đăng nhập Web đổi mật khẩu trước khi dùng trên RC.');})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.closePool());}
