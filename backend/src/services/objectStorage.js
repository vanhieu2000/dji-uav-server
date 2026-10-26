const {STSClient,AssumeRoleCommand}=require('@aws-sdk/client-sts');
const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
const {pipeline}=require('stream/promises'),fs=require('fs'),crypto=require('crypto'),path=require('path');
function config(){
 if(!process.env.S3_STS_ENDPOINT||!process.env.S3_PUBLIC_ENDPOINT||!process.env.S3_SERVICE_ACCESS_KEY||!process.env.S3_SERVICE_SECRET_KEY)throw Object.assign(Error('Chưa cấu hình S3/MinIO STS thật; dùng nhập ảnh gốc trên Web'),{status:503});
 const publicUrl=new URL(process.env.S3_PUBLIC_ENDPOINT);if(publicUrl.protocol!=='https:'&&process.env.NODE_ENV==='production')throw Error('S3 public endpoint cần HTTPS');
 return {endpoint:process.env.S3_STS_ENDPOINT,region:process.env.S3_REGION||'us-east-1',credentials:{accessKeyId:process.env.S3_SERVICE_ACCESS_KEY,secretAccessKey:process.env.S3_SERVICE_SECRET_KEY}};
}
function prefix(session){if(!/^[a-f0-9-]{36}$/.test(session?.upload_namespace||''))throw Error('Thiếu namespace phiên Pilot');return `media/${session.upload_namespace}/`;}
async function grant(session){
 await require('./storageQuota').capacity();
 const c=config(),bucket=process.env.S3_BUCKET||'dji-media',p=prefix(session);
 const Policy=JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:PutObject','s3:AbortMultipartUpload','s3:ListMultipartUploadParts'],Resource:`arn:aws:s3:::${bucket}/${p}*`}]});
 const result=await new STSClient(c).send(new AssumeRoleCommand({RoleArn:'arn:aws:iam::000000000000:role/pilot-upload',RoleSessionName:'pilot-'+session.session_id,DurationSeconds:900,Policy}));
 const s=result.Credentials;if(!s?.AccessKeyId||!s.SecretAccessKey||!s.SessionToken)throw Error('STS không trả credentials hợp lệ');
 return {bucket,endpoint:process.env.S3_PUBLIC_ENDPOINT,provider:'minio',object_key_prefix:p,region:c.region,credentials:{access_key_id:s.AccessKeyId,access_key_secret:s.SecretAccessKey,security_token:s.SessionToken,expire:Math.floor(new Date(s.Expiration).getTime()/1000)}};
}
async function receive(session,key){
 if(typeof key!=='string'||!key.startsWith(prefix(session))||key.includes('..')||key.length>1024||!/^media\/[a-f0-9-]{36}\/[A-Za-z0-9_.-]+\.jpe?g$/i.test(key))throw Error('Object key ngoài phạm vi hoặc không phải JPEG');
 const c=config(),object=await new S3Client({...c,forcePathStyle:true}).send(new GetObjectCommand({Bucket:process.env.S3_BUCKET||'dji-media',Key:key}));
 if(!object.ContentLength||object.ContentLength>200*1024*1024){object.Body.destroy();throw Error('Ảnh S3 vượt giới hạn hoặc rỗng');}
 const dir=require('../routes/mediaUpload').MEDIA_DIR,fileName=crypto.randomUUID()+'_'+path.basename(key),localPath=path.join(dir,fileName);let bytes=0;
 const {Transform}=require('stream');const limit=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;cb(bytes>200*1024*1024?Error('Ảnh vượt giới hạn'):null,chunk);}});
 try{
  await pipeline(object.Body,limit,fs.createWriteStream(localPath,{flags:'wx'}));
  const fd=fs.openSync(localPath,'r'),head=Buffer.alloc(3);try{fs.readSync(fd,head,0,3,0);}finally{fs.closeSync(fd);}if(!head.equals(Buffer.from([255,216,255])))throw Error('Object không phải JPEG');
  const r=await require('../routes/mediaUpload').ingestSaved(localPath,fileName,path.basename(key),{source:'CLOUD',uploadNamespace:session.upload_namespace});
  if(r.status==='failed'||r.media.ticket_id!==session.ticket_id)throw Error('Chưa ghi nhận được ảnh trong phiếu');return r;
 }catch(e){fs.rmSync(localPath,{force:true});throw e;}
}
module.exports={grant,receive,prefix};
