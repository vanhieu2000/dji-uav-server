/** Bootstrap explicite: aucune modification d'un compte existant. Secret écrit hors git. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
try{process.loadEnvFile(path.resolve(__dirname,'../../.env'));}catch(e){}
require('../src/services/runtimeEnv').load();
const db=require('../src/config/db');
(async()=>{
 const username=process.env.BOOTSTRAP_ADMIN_USER||'admin';
 if(!/^[A-Za-z0-9_.-]{3,50}$/.test(username))throw Error('BOOTSTRAP_ADMIN_USER không hợp lệ');
 const [exists]=await db.query('SELECT user_id FROM users WHERE username=?',[username]);
 if(exists)throw Error('Tài khoản đã tồn tại; dùng chức năng quản trị để đổi mật khẩu');
 const password=crypto.randomBytes(24).toString('base64url');
 const dir=path.resolve(__dirname,'../data');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'bootstrap-password');fs.writeFileSync(file,password+'\n',{mode:0o600,flag:'wx'});
 try{await db.query("INSERT INTO users (username,password_hash,full_name,role,must_change_password) VALUES (?,?,?,'ADMIN',1)",[username,await bcrypt.hash(password,12),'Quản trị viên']);}
 catch(e){fs.unlinkSync(file);throw e;}
 console.log('Đã tạo quản trị viên. Mật khẩu một lần ở backend/data/bootstrap-password (0600); đổi sau đăng nhập và xóa file.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.closePool());
