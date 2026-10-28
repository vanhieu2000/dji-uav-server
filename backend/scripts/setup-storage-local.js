/** Local-only MinIO bootstrap. No database mutation, no credentials in command arguments/output. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'../..'),DATA=path.join(ROOT,'backend/data');
const {S3Client,HeadBucketCommand,CreateBucketCommand,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const {STSClient,AssumeRoleCommand}=require('@aws-sdk/client-sts');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function run(args){const r=spawnSync('docker',args,{cwd:ROOT,stdio:['ignore','pipe','pipe'],timeout:180000,windowsHide:true});if(r.error||r.status!==0)throw Error('Docker chua san sang hoac khong tai/chay duoc MinIO. Mo Docker Desktop, kiem tra mang va cong 9000/9001, roi thu lai.');}
function replaceSettings(text,settings){for(const [key,value]of Object.entries(settings)){const line=key+'='+JSON.stringify(value),pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,()=>line):text.trimEnd()+'\n'+line+'\n';}return text;}
async function main(){
 const envFile=path.join(ROOT,'.env');if(!fs.existsSync(envFile))throw Error('Chay CHAY_WIFI.bat lan dau de tao .env truoc.');
 process.loadEnvFile(envFile);if(process.env.NODE_ENV==='production')throw Error('Chi dung cho local, khong thay cau hinh production.');
 const ip=require('../src/services/localNetwork').resolveHost({configured:process.env.HOST_IP,mode:'lan'});
 const publicEndpoint='http://'+ip+':9000';
 if(process.env.S3_STS_ENDPOINT&&process.env.S3_STS_ENDPOINT!==publicEndpoint)throw Error('Da co storage khac. Giu nguyen cau hinh hien co; khong tu ghi de.');
 run(['info','--format','{{.ServerVersion}}']);run(['compose','version']);fs.mkdirSync(DATA,{recursive:true});
 const secretFile=path.join(DATA,'minio-local.json'),composeEnv=path.join(DATA,'minio-local.env');let secret;
 if(fs.existsSync(secretFile))secret=JSON.parse(fs.readFileSync(secretFile,'utf8'));
 else{secret={user:'uav'+crypto.randomBytes(10).toString('hex'),password:crypto.randomBytes(32).toString('hex')};fs.writeFileSync(secretFile,JSON.stringify(secret),{mode:0o600,flag:'wx'});}
 if(!/^[a-z0-9]{23}$/.test(secret.user)||! /^[a-f0-9]{64}$/.test(secret.password))throw Error('File khoa MinIO local khong hop le; khong tao lai khoa tren volume cu.');
 fs.writeFileSync(composeEnv,'UAV_MINIO_USER='+secret.user+'\nUAV_MINIO_PASSWORD='+secret.password+'\nUAV_STORAGE_IP='+ip+'\n',{mode:0o600});
 console.log('Dang khoi dong kho anh local, giu nguyen du lieu volume da co...');
 run(['compose','--project-name','dji-uav-local-storage','--env-file',composeEnv,'-f',path.join(ROOT,'docker-compose.storage-local.yml'),'up','-d']);
 const config={endpoint:publicEndpoint,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:secret.user,secretAccessKey:secret.password}},s3=new S3Client(config),Bucket=process.env.S3_BUCKET||'dji-media';
 let ready=false;for(let i=0;i<30;i++){try{try{await s3.send(new HeadBucketCommand({Bucket}));}catch(e){if(e.$metadata?.httpStatusCode!==404)throw e;await s3.send(new CreateBucketCommand({Bucket}));}ready=true;break;}catch{await sleep(1000);}}
 if(!ready)throw Error('MinIO chua san sang. Chua thay doi .env; kiem tra Docker va firewall.');
 // Verify the same STS + scoped PUT used by Pilot, then read the original object back.
 const prefix='media/'+crypto.randomUUID()+'/',Key=prefix+'storage-check.jpg';let objectWritten=false;
 try{
  const grant=await new STSClient(config).send(new AssumeRoleCommand({RoleArn:'arn:aws:iam::000000000000:role/pilot-upload',RoleSessionName:'local-storage-check',DurationSeconds:900,Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:PutObject'],Resource:`arn:aws:s3:::${Bucket}/${prefix}*`}]})}));
  const c=grant.Credentials;if(!c?.SessionToken)throw Error('STS khong cap token');
  const limited=new S3Client({...config,credentials:{accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken}}),body=Buffer.from([255,216,255,217]);
  await limited.send(new PutObjectCommand({Bucket,Key,Body:body,ContentType:'image/jpeg'}));objectWritten=true;
  const read=await s3.send(new GetObjectCommand({Bucket,Key}));if(!Buffer.from(await read.Body.transformToByteArray()).equals(body))throw Error('Doc lai object khong khop');
 }finally{if(objectWritten)await s3.send(new DeleteObjectCommand({Bucket,Key}));}
 const accessFile=path.join(DATA,'s3-local-access-key'),keyFile=path.join(DATA,'s3-local-secret-key');fs.writeFileSync(accessFile,secret.user,{mode:0o600});fs.writeFileSync(keyFile,secret.password,{mode:0o600});
 const original=fs.readFileSync(envFile,'utf8');fs.writeFileSync(path.join(DATA,'env-before-storage-'+Date.now()+'.bak'),original,{mode:0o600,flag:'wx'});
 const settings={S3_STS_ENDPOINT:publicEndpoint,S3_PUBLIC_ENDPOINT:publicEndpoint,S3_SERVICE_ACCESS_KEY_FILE:accessFile.replace(/\\/g,'/'),S3_SERVICE_SECRET_KEY_FILE:keyFile.replace(/\\/g,'/'),S3_BUCKET:Bucket,S3_REGION:'us-east-1'};
 const temporary=envFile+'.storage-tmp';fs.writeFileSync(temporary,replaceSettings(original,settings),{mode:0o600});fs.renameSync(temporary,envFile);
 console.log('DA KIEM TRA: MinIO + STS + tai/doc object thanh cong. Chua phai nghiem thu anh DJI.');
 console.log('Cho phep TCP 9000 trong firewall mang Private. RC can truy cap '+publicEndpoint);
 console.log('Dong server cu, chay CHAY_WIFI.bat; thoat Cloud Service tren RC va dang nhap lai. Bat tu tai anh goc, chup 1 anh va kiem tra anh trong phieu.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={replaceSettings};
