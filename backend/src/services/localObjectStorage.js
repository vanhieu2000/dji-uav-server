/** Native local S3-compatible JPEG upload transport. Real SigV4 authentication; no anonymous PUT. */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{pipeline}=require('stream/promises'),{Transform}=require('stream');
const root=()=>path.resolve(process.env.LOCAL_STORAGE_DIR||path.join(__dirname,'../../data/local-storage'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hmac=(k,v)=>crypto.createHmac('sha256',k).update(v).digest();
const encode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const fail=(message,status=403)=>Object.assign(Error(message),{status});
const MAX=200*1024*1024,grants=new Map();
let loadedRoot=null;
function load(){if(loadedRoot===root())return;grants.clear();loadedRoot=root();fs.mkdirSync(root(),{recursive:true,mode:0o700});try{for(const g of JSON.parse(fs.readFileSync(path.join(root(),'grants.json'),'utf8')))if(g.expires>Date.now())grants.set(g.access,g);}catch(e){if(e.code!=='ENOENT')throw e;}}
function save(){const file=path.join(root(),'grants.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...grants.values()]),{mode:0o600});fs.renameSync(tmp,file);}
function prefix(s){if(!/^[a-f0-9-]{36}$/.test(s.upload_namespace||''))throw fail('Invalid namespace');return 'media/'+s.upload_namespace+'/';}
function safeKey(key){return /^media\/[a-f0-9-]{36}\/[A-Za-z0-9_.-]+\.jpe?g$/i.test(key)&&!key.includes('..');}
function objectPath(key){if(!safeKey(key))throw fail('Invalid JPEG object key',400);return path.join(root(),'objects',...key.split('/'));}
function grant(session,endpoint){load();
 const pending=path.join(root(),'parts');if(fs.existsSync(pending))for(const entry of fs.readdirSync(pending,{withFileTypes:true}))if(entry.isDirectory()&&/^[a-f0-9]{32}$/.test(entry.name)){const dir=path.join(pending,entry.name);try{const meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));if(meta.expires<Date.now()-3600000)fs.rmSync(dir,{recursive:true,force:true});}catch{}}
 for(const [k,g]of grants)if(g.expires<=Date.now())grants.delete(k);if(grants.size>=256)throw fail('Too many active upload grants',429);
 const g={access:'UAV'+crypto.randomBytes(12).toString('hex'),secret:crypto.randomBytes(32).toString('hex'),token:crypto.randomBytes(32).toString('hex'),expires:Date.now()+15*60000,sessionId:session.session_id,prefix:prefix(session),bucket:process.env.S3_BUCKET||'dji-media'};grants.set(g.access,g);save();
 return {bucket:g.bucket,endpoint,provider:'minio',region:'us-east-1',object_key_prefix:g.prefix,credentials:{access_key_id:g.access,access_key_secret:g.secret,security_token:g.token,expire:Math.floor(g.expires/1000)}};
}
async function authenticate(req,bucket,key,lookup){
 load();const auth=req.headers.authorization||'',m=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]{64})$/.exec(auth);
 if(!m)throw fail('AWS SigV4 authorization required');const g=grants.get(m[1]);
 if(!g||g.expires<=Date.now()||bucket!==g.bucket||!key.startsWith(g.prefix)||!safeKey(key)||req.headers['x-amz-security-token']!==g.token)throw fail('Upload grant expired or outside session');
 const session=await lookup(g.sessionId);if(!session||prefix(session)!==g.prefix)throw fail('Pilot session revoked');
 const date=req.headers['x-amz-date'];if(typeof date!=='string'||!/^\d{8}T\d{6}Z$/.test(date)||date.slice(0,8)!==m[2])throw fail('Invalid signing date');
 const ms=Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'));if(Math.abs(Date.now()-ms)>15*60000)throw fail('Signing clock skew');
 const names=m[4].split(';');if(!names.includes('host')||!names.includes('x-amz-security-token')||names.some((n,i)=>! /^[a-z0-9-]+$/.test(n)||(i&&n<=names[i-1])))throw fail('Invalid signed headers');
 const url=new URL(req.originalUrl||req.url,'http://localhost'),headers=names.map(n=>{if(req.headers[n]==null)throw fail('Missing signed header');return n+':'+String(req.headers[n]).trim().replace(/\s+/g,' ')+'\n';}).join('');
 const query=[...url.searchParams].map(([k,v])=>[encode(k),encode(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(x=>x.join('=')).join('&');
 const uri=url.pathname.split('/').map(p=>encode(decodeURIComponent(p))).join('/');
 const contentHash=req.headers['x-amz-content-sha256'];if(contentHash!=='UNSIGNED-PAYLOAD'&&!/^[a-f0-9]{64}$/.test(contentHash||''))throw fail('Unsupported streaming payload signature');
 const canonical=[req.method,uri,query,headers,m[4],contentHash].join('\n'),scope=m[2]+'/'+m[3]+'/s3/aws4_request';
 const signing=hmac(hmac(hmac(hmac('AWS4'+g.secret,m[2]),m[3]),'s3'),'aws4_request');const expected=hmac(signing,'AWS4-HMAC-SHA256\n'+date+'\n'+scope+'\n'+hash(canonical)).toString('hex');
 if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(m[5])))throw fail('Signature mismatch');return {g,contentHash,url};
}
async function writeBody(req,file,expected,max=MAX){let size=0;const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');
 const limit=new Transform({transform(b,e,cb){size+=b.length;if(size>max)return cb(fail('Object too large',413));sha.update(b);md5.update(b);cb(null,b);}});
 try{await pipeline(req,limit,fs.createWriteStream(file,{flags:'wx',mode:0o600}));if(expected!=='UNSIGNED-PAYLOAD'&&sha.digest('hex')!==expected)throw fail('Payload hash mismatch');return {size,etag:md5.digest('hex')};}catch(e){fs.rmSync(file,{force:true});throw e;}}
async function bytes(req,expected){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>256*1024)throw fail('XML too large',413);chunks.push(b);}const body=Buffer.concat(chunks);if(expected!=='UNSIGNED-PAYLOAD'&&hash(body)!==expected)throw fail('Payload hash mismatch');return body.toString('utf8');}
function checkJpeg(file){const fd=fs.openSync(file,'r'),b=Buffer.alloc(3);try{fs.readSync(fd,b,0,3,0);}finally{fs.closeSync(fd);}if(!b.equals(Buffer.from([255,216,255])))throw fail('JPEG original required',400);}
const escape=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function xml(res,body){res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>'+body);}
function router({lookup= id=>require('./mqttAccess').principal(id),capacity= n=>require('./storageQuota').capacity(n)}={}){
 const r=require('express').Router();
 r.all('/:bucket/media/*',async(req,res,next)=>{if(req.params.bucket!==(process.env.S3_BUCKET||'dji-media'))return next();let tmp;
  try{
   if(!['PUT','POST','DELETE','HEAD','GET'].includes(req.method))throw fail('Upload-only endpoint',405);
   const bucket=req.params.bucket,key='media/'+req.params[0],{g,contentHash,url}=await authenticate(req,bucket,key,lookup),dest=objectPath(key);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
   const uploadId=url.searchParams.get('uploadId');
   const disk=fs.statfsSync(root());if(Number(disk.bavail)*Number(disk.bsize)<MAX+64*1024*1024)throw fail('Not enough free disk space for original photo',507);
   if(req.method==='HEAD'&&!uploadId){await bytes(req,contentHash);if(!fs.existsSync(dest))throw fail('Object not found',404);const stat=fs.statSync(dest);res.set({'Content-Length':String(stat.size),'Content-Type':'image/jpeg','Last-Modified':stat.mtime.toUTCString()}).status(200).end();return;}
   if(req.method==='GET'&&!uploadId)throw fail('Use authenticated gallery for original downloads',403);
   if(req.method==='PUT'&&!uploadId){await capacity(Number(req.headers['content-length'])||0);tmp=dest+'.'+crypto.randomUUID()+'.tmp';const body=await writeBody(req,tmp,contentHash);checkJpeg(tmp);if(body.size===0)throw fail('Empty object',400);await capacity(body.size);if(fs.existsSync(dest))throw fail('Object already exists',409);fs.renameSync(tmp,dest);tmp=null;res.set('ETag','"'+body.etag+'"').status(200).end();return;}
   if(req.method==='POST'&&url.searchParams.has('uploads')){await bytes(req,contentHash);const partsRoot=path.join(root(),'parts');fs.mkdirSync(partsRoot,{recursive:true,mode:0o700});if(fs.readdirSync(partsRoot).length>=256)throw fail('Too many pending multipart uploads',429);const id=crypto.randomBytes(16).toString('hex'),dir=path.join(partsRoot,id);fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify({key,access:g.access,expires:g.expires}),{mode:0o600});xml(res,`<InitiateMultipartUploadResult><Bucket>${escape(bucket)}</Bucket><Key>${escape(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);return;}
   if(!/^[a-f0-9]{32}$/.test(uploadId||''))throw fail('Unknown upload',404);const dir=path.join(root(),'parts',uploadId),meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));if(meta.key!==key||meta.access!==g.access||meta.expires<=Date.now())throw fail('Multipart outside grant');
   if(req.method==='GET'){await bytes(req,contentHash);const items=fs.readdirSync(dir).filter(n=>/^\d+\.json$/.test(n)).map(n=>({number:Number(n.split('.')[0]),...JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))})).sort((a,b)=>a.number-b.number);xml(res,`<ListPartsResult><Bucket>${escape(bucket)}</Bucket><Key>${escape(key)}</Key><UploadId>${uploadId}</UploadId><IsTruncated>false</IsTruncated>${items.map(p=>`<Part><PartNumber>${p.number}</PartNumber><ETag>"${p.etag}"</ETag><Size>${p.size}</Size></Part>`).join('')}</ListPartsResult>`);return;}
   if(req.method==='DELETE'){await bytes(req,contentHash);fs.rmSync(dir,{recursive:true,force:true});res.status(204).end();return;}
   if(req.method==='PUT'){const n=Number(url.searchParams.get('partNumber'));if(!Number.isInteger(n)||n<1||n>1000)throw fail('Invalid part number',400);await capacity(Number(req.headers['content-length'])||0);tmp=path.join(dir,crypto.randomUUID()+'.tmp');const body=await writeBody(req,tmp,contentHash);fs.renameSync(tmp,path.join(dir,n+'.part'));tmp=null;fs.writeFileSync(path.join(dir,n+'.json'),JSON.stringify(body));res.set('ETag','"'+body.etag+'"').end();return;}
   if(req.method==='POST'){
    const body=await bytes(req,contentHash),parts=[...body.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(p=>{const n=/<PartNumber>(\d+)<\/PartNumber>/.exec(p[1]),tag=/<ETag>(?:&quot;|")?([a-f0-9]{32})(?:&quot;|")?<\/ETag>/.exec(p[1]);if(!n||!tag)throw fail('Invalid part XML',400);return [null,n[1],tag[1]];});if(!parts.length||parts.length>1000)throw fail('Invalid completion XML',400);
    let total=0,previous=0;const tags=[];for(const p of parts){const n=Number(p[1]);if(n<=previous)throw fail('Part order invalid',400);previous=n;const m=JSON.parse(fs.readFileSync(path.join(dir,n+'.json'),'utf8'));if(m.etag!==p[2])throw fail('Part ETag mismatch',400);total+=m.size;tags.push(Buffer.from(m.etag,'hex'));}if(total>MAX)throw fail('Object too large',413);await capacity(total);
    tmp=dest+'.'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);fs.closeSync(fd);
    for(const p of parts)await pipeline(fs.createReadStream(path.join(dir,Number(p[1])+'.part')),fs.createWriteStream(tmp,{flags:'a'}));checkJpeg(tmp);if(fs.existsSync(dest))throw fail('Object already exists',409);fs.renameSync(tmp,dest);tmp=null;fs.rmSync(dir,{recursive:true,force:true});const tag=crypto.createHash('md5').update(Buffer.concat(tags)).digest('hex')+'-'+parts.length;xml(res,`<CompleteMultipartUploadResult><Bucket>${escape(bucket)}</Bucket><Key>${escape(key)}</Key><ETag>"${tag}"</ETag></CompleteMultipartUploadResult>`);return;
   }
   throw fail('Unsupported operation',400);
  }catch(e){if(tmp)fs.rmSync(tmp,{force:true});const status=e.status||500;console.warn('[Local storage]',status,status===500?'Storage operation failed':e.message);res.status(status);xml(res,`<Error><Code>${status===403?'AccessDenied':status===413?'EntityTooLarge':'InvalidRequest'}</Code><Message>${status===500?'Storage operation failed':escape(e.message)}</Message></Error>`);}
 });return r;
}
async function receive(session,key){if(!safeKey(key)||!key.startsWith(prefix(session)))throw fail('Object outside session');const source=objectPath(key),receipt=source+'.receipt.json';
 if(fs.existsSync(receipt)){const saved=JSON.parse(fs.readFileSync(receipt,'utf8'));const [row]=await require('../config/db').query('SELECT * FROM media_files WHERE media_id=? AND ticket_id=?',[saved.media_id,session.ticket_id]);if(row&&row.file_path_local&&fs.existsSync(row.file_path_local))return {status:'duplicate',media:row};}
 checkJpeg(source);
 const media=require('../routes/mediaUpload'),name=crypto.randomUUID()+'_'+path.basename(key),dest=path.join(media.MEDIA_DIR,name);try{await fs.promises.link(source,dest);}catch(e){if(!['EXDEV','EPERM','ENOTSUP'].includes(e.code))throw e;await fs.promises.copyFile(source,dest,fs.constants.COPYFILE_EXCL);}let persisted=false;
 try{const result=await media.ingestSaved(dest,name,path.basename(key),{source:'CLOUD',uploadNamespace:session.upload_namespace});persisted=!!result.media.media_id;if(result.status==='failed'||result.media.ticket_id!==session.ticket_id)throw fail('Original ingest failed',422);fs.writeFileSync(receipt,JSON.stringify({media_id:result.media.media_id}),{mode:0o600});fs.rmSync(source,{force:true});return result;}catch(e){if(!persisted)fs.rmSync(dest,{force:true});throw e;}}
module.exports={grant,router,receive,objectPath,prefix};
