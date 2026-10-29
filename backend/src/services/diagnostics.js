/* Local diagnostic journal. Bounded, rotated, redacted; raw credentials/files are never persisted. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const DIR=process.env.UAV_LOG_DIR||path.resolve(__dirname,'../../data/logs');
const SECRET=/password|passwd|secret|token|license|appkey|authorization|cookie|credential|signature|^sig$|^sign$|grant|access.?key/i;
function clean(value,depth=0){
 if(depth>8)return '[depth limit]';if(value==null||typeof value==='number'||typeof value==='boolean')return value;
 if(value instanceof Date)return Number.isNaN(value.getTime())?null:value.toISOString();
 if(Buffer.isBuffer(value))return {binary_bytes:value.length};
 if(value instanceof Error)return {name:value.name,message:clean(value.message),stack:clean(value.stack)};
 if(typeof value==='string')return value.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT redacted]').replace(/(?:Bearer\s+)[A-Za-z0-9_.-]+/gi,'Bearer [redacted]').replace(/([?&](?:sign|grant|sig|token|X-Amz-[\w-]+)=)[^\s&"']+/gi,'$1[redacted]').replace(/((?:password|passwd|secret|appkey|token)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]').slice(0,4000);
 if(Array.isArray(value))return value.slice(0,30).map(v=>clean(v,depth+1)).concat(value.length>30?[{remaining:value.length-30}]:[]);
 if(typeof value==='object'){const out={};for(const [key,val]of Object.entries(value).slice(0,60)){out[key]=SECRET.test(key)?'[redacted]':/base64|image_data|snapshot_data/i.test(key)?'[image omitted]':clean(val,depth+1);}return out;}
 return String(value).slice(0,200);
}
let chain=Promise.resolve(),pending=0,dropped=0,installed=false,sequence=0,currentDay='',currentFile,bytes=0;
const MAX_BYTES=5*1024*1024,KEEP_FILES=14;
function rotate(){const day=new Date().toISOString().slice(0,10);fs.mkdirSync(DIR,{recursive:true,mode:0o700});if(day!==currentDay||bytes>=MAX_BYTES){if(day!==currentDay)sequence=0;else sequence++;currentDay=day;do{currentFile=path.join(DIR,`uav-${day}-${process.pid}-${sequence}.jsonl`);bytes=fs.existsSync(currentFile)?fs.statSync(currentFile).size:0;if(bytes>=MAX_BYTES)sequence++;}while(bytes>=MAX_BYTES);
 const files=fs.readdirSync(DIR).filter(f=>/^uav-\d{4}-\d{2}-\d{2}-(?:\d+-)?\d+\.jsonl$/.test(f)).map(name=>({name,mtime:fs.statSync(path.join(DIR,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);for(const f of files.slice(KEEP_FILES-1))if(path.join(DIR,f.name)!==currentFile)fs.rmSync(path.join(DIR,f.name),{force:true});}}
function write(kind,data){if(pending>=1500){dropped++;return;}const entry={time:new Date().toISOString(),pid:process.pid,kind,data:clean(data),...(dropped?{dropped_since_last:dropped}:{})};dropped=0;let line=JSON.stringify(entry);if(Buffer.byteLength(line)>32768)line=JSON.stringify({time:entry.time,pid:entry.pid,kind,truncated:true,data:line.slice(0,20000)});line+='\n';pending++;chain=chain.then(async()=>{rotate();await fs.promises.appendFile(currentFile,line,{mode:0o600});bytes+=Buffer.byteLength(line);}).catch(()=>{/* Logging must not take down live telemetry. */}).finally(()=>pending--);}
function install(){if(installed)return;installed=true;for(const level of ['log','warn','error']){const original=console[level].bind(console);console[level]=(...args)=>{const safe=args.map(v=>clean(v));write('console.'+level,safe);original(...safe);};}process.on('uncaughtExceptionMonitor',e=>write('uncaught_exception',e));write('startup',{node:process.version,platform:process.platform,log_dir:DIR});}
function http(req,res,next){const start=Date.now(),id=res.getHeader('X-Request-ID')||crypto.randomUUID();let response;
 const json=res.json;res.json=function(body){response=clean(body);return json.call(this,body);};
 res.on('finish',()=>write('http',{request_id:id,method:req.method,path:req.path,query:clean(req.query),status:res.statusCode,response_bytes:res.getHeader('Content-Length')||null,duration_ms:Date.now()-start,user_id:req.user?.user_id,request:clean(req.body),response}));next();
}
const sampled=new Map();
function mqtt(topic,payload){if(topic.endsWith('/osd')){const now=Date.now();if(now-(sampled.get(topic)||0)<1000)return;if(sampled.size>1000)sampled.delete(sampled.keys().next().value);sampled.set(topic,now);}write('mqtt',{topic,payload,osd_sample_interval_ms:topic.endsWith('/osd')?1000:undefined});}
async function bundle(){await chain;rotate();const AdmZip=require('adm-zip'),zip=new AdmZip();let size=0;
 const files=fs.readdirSync(DIR).filter(f=>/^uav-\d{4}-\d{2}-\d{2}-(?:\d+-)?\d+\.jsonl$/.test(f)).map(name=>({name,mtime:fs.statSync(path.join(DIR,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
 for(const f of files){const data=fs.readFileSync(path.join(DIR,f.name));if(size+data.length>20*1024*1024)break;zip.addFile('logs/'+f.name,data);size+=data.length;}
 let commit=null,working_tree_changed=null,package_commit=null;
 const project=path.resolve(__dirname,'../../..');
 try{const release=JSON.parse(fs.readFileSync(path.join(project,'release-info.json'),'utf8'));if(/^[a-f0-9]{40}$/.test(release.commit||''))package_commit=release.commit;}catch{}
 try{const exec=require('child_process').execFileSync;commit=exec('git',['rev-parse','HEAD'],{cwd:project,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:1000}).trim();working_tree_changed=!!exec('git',['status','--porcelain','--untracked-files=no'],{cwd:project,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:1000}).trim();}catch{}
 if(!commit)commit=package_commit;
 zip.addFile('manifest.json',Buffer.from(JSON.stringify({created_at:new Date().toISOString(),commit,package_commit,working_tree_changed,node:process.version,platform:process.platform,redacted:true,osd_sample_interval_ms:1000,max_export_uncompressed_bytes:20*1024*1024,notes:'No .env, passwords, images or license files. Logs may contain operational locations and IDs; review before sharing.'},null,2)));
 return zip.toBuffer();
}
module.exports={clean,write,install,http,mqtt,bundle,flush:()=>chain};
