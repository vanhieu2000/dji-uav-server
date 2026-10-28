/** Prepare native PC photo storage; no external storage process. */
const fs=require('fs'),path=require('path');const ROOT=path.resolve(__dirname,'../..');
function replaceSettings(text,settings){for(const [key,value]of Object.entries(settings)){const line=key+'='+JSON.stringify(value),pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,()=>line):text.trimEnd()+'\n'+line+'\n';}return text;}
function main(){const file=path.join(ROOT,'.env');if(!fs.existsSync(file))throw Error('Chạy CHAY_WIFI.bat lần đầu để tạo .env trước.');process.loadEnvFile(file);if(process.env.NODE_ENV==='production')throw Error('Chỉ dùng thiết lập local.');
 const dir=path.resolve(process.env.MEDIA_DIR||path.join(ROOT,'backend/uploads/media'));fs.mkdirSync(dir,{recursive:true});fs.accessSync(dir,fs.constants.W_OK);const data=path.join(ROOT,'backend/data');fs.mkdirSync(data,{recursive:true});
 const original=fs.readFileSync(file,'utf8');fs.writeFileSync(path.join(data,'env-before-native-storage-'+Date.now()+'.bak'),original,{mode:0o600,flag:'wx'});const temporary=file+'.storage-tmp';
 fs.writeFileSync(temporary,replaceSettings(original,{STORAGE_MODE:'local',MEDIA_DIR:dir.replace(/\\/g,'/'),LIVE_STREAM_ENABLED:'true'}),{mode:0o600});fs.renameSync(temporary,file);
 console.log('Thư mục ảnh gốc: '+dir);console.log('Đã bật upload ảnh native và live. Dừng server cũ, chạy CHAY_WIFI.bat rồi đăng nhập lại Cloud Service trên RC.');console.log('Đây là chuẩn bị cấu hình, chưa xác nhận nhận ảnh từ thiết bị.');}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={replaceSettings};
