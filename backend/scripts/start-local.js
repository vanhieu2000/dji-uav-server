/** One-click local launcher. No passwords in arguments, no account reset, no schema DROP on existing DB. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),net=require('net'),{spawn}=require('child_process');
const {resolveHost,urls}=require('../src/services/localNetwork');
const ROOT=path.resolve(__dirname,'../..'),BACKEND=path.join(ROOT,'backend'),DATA=path.join(BACKEND,'data');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function fingerprint(root=ROOT){const hash=crypto.createHash('sha256');for(const file of ['.env','backend/package-lock.json','backend/server.js','backend/scripts/start-local.js','backend/src/services/localNetwork.js'])hash.update(fs.readFileSync(path.join(root,file)));for(const key of ['MYSQL_PASSWORD','JWT_SECRET','S3_SERVICE_ACCESS_KEY','S3_SERVICE_SECRET_KEY','SMTP_PASSWORD','VISION_WEBHOOK_SECRET','VISION_API_TOKEN','MQTT_PASSWORD'])if(process.env[key+'_FILE'])hash.update(fs.readFileSync(process.env[key+'_FILE']));hash.update(process.env.HOST_IP||'');hash.update(process.env.LOCAL_NETWORK_MODE||'lan');return hash.digest('hex');}
function portNumber(value,fallback){const n=value==null||value===''?fallback:Number(value);if(!Number.isInteger(n)||n<1024||n>65525)throw Error('Cổng local cần là số từ 1024 đến 65525');return n;}
async function available(port){return new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,'0.0.0.0',()=>s.close(()=>resolve(true)));});}
async function freePort(start,excluded=[]){for(let n=start;n<start+10;n++)if(!excluded.includes(n)&&await available(n))return n;throw Error('Không có cổng trống gần '+start+'; kiểm tra PORT/MQTT_PORT trong .env');}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return null;}}
async function running(state){
 if(!state||!/^[a-f0-9-]{36}$/.test(state.instance)||!Number.isInteger(state.port)||state.port<1024||state.port>65535)return false;
 try{const r=await fetch(`http://127.0.0.1:${state.port}/api/health`,{signal:AbortSignal.timeout(1500)});const j=await r.json();return r.ok&&j.data?.local_instance_id===state.instance;}catch(e){return false;}
}
function openBrowser(url){if(process.env.LOCAL_NO_BROWSER==='1')return;const child=process.platform==='win32'?spawn('explorer.exe',[url],{stdio:'ignore',windowsHide:true,detached:true}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore',detached:true});child.on('error',()=>console.log('Mở trình duyệt và truy cập: '+url));child.unref();}
function npmInstall(){return new Promise((resolve,reject)=>{
 const opts={cwd:BACKEND,stdio:'inherit',env:{...process.env,npm_config_cache:process.env.npm_config_cache||path.join(DATA,'npm-cache')}};
 const c=process.platform==='win32'?spawn(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm ci --include=dev --no-audit --no-fund'],opts):spawn('npm',['ci','--include=dev','--no-audit','--no-fund'],opts);
 c.once('error',reject);c.once('exit',code=>code===0?resolve():reject(Error('Cài thư viện thất bại; kiểm tra mạng và npm, rồi bấm chạy lại')));
});}
async function ensureAdmin(db,env=process.env){
 const username=env.BOOTSTRAP_ADMIN_USER||'local-admin';if(!/^[A-Za-z0-9_.-]{3,50}$/.test(username))throw Error('BOOTSTRAP_ADMIN_USER không hợp lệ');
 const [user]=await db.query('SELECT role,status,password_hash FROM users WHERE username=?',[username]);
 if(user){if(!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password_hash||''))throw Error('Tài khoản '+username+' có hash mật khẩu cũ không hợp lệ; chọn BOOTSTRAP_ADMIN_USER khác, không tự đặt lại tài khoản cũ');if(user.role!=='ADMIN'||user.status!=='ACTIVE')throw Error('Tài khoản '+username+' đã tồn tại nhưng không phải ADMIN đang hoạt động; chọn tên khác trong .env');console.log('Tài khoản Web: '+username+' (giữ nguyên mật khẩu đã đặt).');return {username,created:false};}
 const file=env.BOOTSTRAP_PASSWORD_FILE?path.resolve(env.BOOTSTRAP_PASSWORD_FILE):path.join(DATA,username+'-password.txt');
 await new Promise((resolve,reject)=>{const c=spawn(process.execPath,[path.join(__dirname,'create-admin.js')],{cwd:BACKEND,env:{...env,BOOTSTRAP_ADMIN_USER:username,BOOTSTRAP_PASSWORD_FILE:file},stdio:'inherit'});c.once('error',reject);c.once('exit',code=>code===0?resolve():reject(Error('Không tạo được quản trị viên; xem thông báo phía trên')));});
 console.log('Mở file mật khẩu Web: '+file+'; đăng nhập rồi đổi mật khẩu.');return {username,created:true,passwordFile:file};
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Cần cài Node.js 24 LTS rồi bấm lại file CHAY_LOCAL.bat');
 const envFile=path.join(ROOT,'.env');if(!fs.existsSync(envFile))throw Error('Chưa có .env; bấm CHAY_LOCAL.bat để nhập cấu hình lần đầu');
 process.loadEnvFile(envFile);process.env.STORAGE_MODE=process.env.STORAGE_MODE||'local';process.env.LIVE_STREAM_ENABLED=process.env.LIVE_STREAM_ENABLED||'true';require('../src/services/diagnostics').install();if(process.env.NODE_ENV==='production')throw Error('File này chỉ dành cho local; dùng bộ triển khai production riêng');process.env.HOST_IP=resolveHost({configured:process.env.HOST_IP,mode:process.env.LOCAL_NETWORK_MODE||'lan'});fs.mkdirSync(DATA,{recursive:true});const stateFile=path.join(DATA,'local-launcher.json'),lockFile=path.join(DATA,'local-launcher.lock'),signature=fingerprint();
 let state=readJson(stateFile);
 if(await running(state)){if(state.signature!==signature)throw Error('Code/cấu hình đã đổi. Đóng cửa sổ server cũ rồi bấm CHAY_LOCAL.bat lại.');const url=urls(state.host||process.env.HOST_IP,state.port,state.mqtt).dashboard;console.log('Server đang chạy: '+url);openBrowser(url);return;}
 let lock;
 try{lock=fs.openSync(lockFile,'wx',0o600);}catch(e){
  if(e.code!=='EEXIST')throw e;const owner=readJson(lockFile);let alive=false;
  if(Number.isInteger(owner?.pid)&&owner.pid>0)try{process.kill(owner.pid,0);alive=true;}catch(err){alive=err.code==='EPERM';}
  if(!Number.isInteger(owner?.pid)||owner.pid<=0)throw Error('Khóa khởi động chưa hoàn tất. Chờ vài giây rồi bấm lại; nếu cửa sổ cũ đã đóng, xem hướng dẫn xử lý local-launcher.lock');
  if(!alive){fs.rmSync(lockFile,{force:true});return main();}
  console.log('Một cửa sổ khác đang khởi động; chờ server sẵn sàng...');
  for(let n=0;n<120;n++){state=readJson(stateFile);if(await running(state)){if(state.signature!==signature)throw Error('Cấu hình cửa sổ khác không khớp; xem cửa sổ server');openBrowser(urls(state.host||process.env.HOST_IP,state.port,state.mqtt).dashboard);return;}await delay(1000);}
  throw Error('Chưa khởi động xong. Xem lỗi trong cửa sổ chạy đầu tiên; không khởi động thêm server.');
 }
 fs.writeSync(lock,JSON.stringify({pid:process.pid}));fs.closeSync(lock);
 let child,instance,stopped=false;
 const cleanup=()=>{try{if(readJson(lockFile)?.pid===process.pid)fs.rmSync(lockFile,{force:true});if(instance&&readJson(stateFile)?.instance===instance)fs.rmSync(stateFile,{force:true});}catch(e){}};
 const stop=()=>{stopped=true;if(child&&!child.killed)child.kill();else if(!child){cleanup();process.exit(0);}};process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('exit',cleanup);
 try{
  const lockHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(BACKEND,'package-lock.json'))).digest('hex'),stamp=path.join(DATA,'local-deps.sha256');let installed=false;
  try{installed=fs.readFileSync(stamp,'utf8')===lockHash&&['mysql2','express','bcryptjs'].every(name=>fs.existsSync(path.join(BACKEND,'node_modules',name,'package.json')));}catch(e){}
  if(!installed){console.log('[1/4] Cài thư viện theo package-lock...');await npmInstall();fs.writeFileSync(stamp,lockHash);}else console.log('[1/4] Thư viện đã sẵn sàng.');
  require('../src/services/runtimeEnv').load();const db=require('../src/config/db');
  console.log('[2/4] Kiểm tra MySQL, chuẩn bị DB an toàn...');
  try{await require('./setup-local').setupLocal(db.dbConfig);if(!await db.testConnection())throw Error('Không kết nối được MySQL. Kiểm tra dịch vụ MySQL và MYSQL_* trong .env');console.log('[3/4] Kiểm tra tài khoản Web...');await ensureAdmin(db);const operator=await require('./create-operator').ensureOperator(db);if(operator.created)console.log('Đã tạo '+operator.username+' (OPERATOR toàn bộ nghiệp vụ, không quản trị tài khoản/cài đặt). Mật khẩu ban đầu: '+operator.passwordFile+'; admin có thể thu hẹp phạm vi trong Quản lý tài khoản.');}finally{await db.closePool();}
  const requested=portNumber(process.env.PORT,8080),port=await freePort(requested),mqtt=await freePort(portNumber(process.env.MQTT_PORT,1883),[port]);instance=crypto.randomUUID();
  if(port!==requested)console.log('Cổng '+requested+' đang dùng; chuyển Web sang '+port+'.');
  if(process.env.LIVE_STREAM_ENABLED==='true'){
   const requestedRtmp=portNumber(process.env.RTMP_PORT,1935),rtmp=await freePort(requestedRtmp,[port,mqtt]);const requestedMedia=portNumber(process.env.MEDIA_HTTP_PORT,8000),media=await freePort(requestedMedia,[port,mqtt,rtmp]);
   process.env.RTMP_PORT=String(rtmp);process.env.MEDIA_HTTP_PORT=String(media);
   if(rtmp!==requestedRtmp||media!==requestedMedia)console.log('Live dùng RTMP '+rtmp+' / HTTP-FLV '+media+' vì cổng cũ đang dùng. Mở đúng cổng firewall và đăng nhập lại RC.');
  }
  console.log('[4/4] Khởi động server, chờ DB/MQTT sẵn sàng...');
  child=spawn(process.execPath,['server.js'],{cwd:BACKEND,env:{...process.env,PORT:String(port),MQTT_PORT:String(mqtt),LOCAL_LAUNCH_ID:instance},stdio:'inherit'});
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});exit.catch(()=>{});
  state={pid:child.pid,instance,port,mqtt,host:process.env.HOST_IP,signature};fs.writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
  let ready=false;for(let n=0;n<120;n++){if(stopped)return;if(child.exitCode!==null||child.signalCode)throw Error('Server đã dừng; xem lỗi phía trên');if(await running(state)){ready=true;break;}await delay(1000);}
  if(!ready)throw Error('Server chưa sẵn sàng sau 120 giây; xem lỗi DB/khởi tạo phía trên');
  console.log('Thư mục ảnh gốc: '+path.resolve(process.env.MEDIA_DIR||path.join(BACKEND,'uploads/media')));if(process.env.LIVE_STREAM_ENABLED==='true')console.log('Live: RTMP '+process.env.RTMP_PORT+' / HTTP-FLV '+process.env.MEDIA_HTTP_PORT);
  const links=urls(process.env.HOST_IP,port,mqtt);console.log('\nSERVER SAN SANG: '+links.dashboard+'\nPILOT 2: '+links.pilot+'\nMQTT: '+links.mqtt+'\nDùng cùng Wi-Fi/LAN, cho phép các cổng này qua firewall mạng Private. Giữ cửa sổ này mở. Ctrl+C để dừng.\n');openBrowser(links.dashboard);
  const ended=await exit;if(stopped)return;if(ended.code&&ended.code!==0)throw Error('Server dừng với mã '+ended.code);
 }finally{if(child&&!child.killed)child.kill();cleanup();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);process.removeListener('exit',cleanup);}
}
module.exports={main,portNumber,freePort,running,fingerprint,ensureAdmin};
if(require.main===module)main().catch(e=>{console.error('\nKHONG KHOI DONG DUOC: '+(e.code||e.message)+'\nKiểm tra MySQL và .env; xem docs/CHAY_LOCAL.md. Không cần xóa DB hay tạo lại tài khoản.');process.exitCode=1;});
