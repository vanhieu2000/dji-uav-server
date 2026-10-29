#!/usr/bin/env node
/** Authenticated streaming archive: AES-256-GCM + scrypt, no password arguments/env output. */
const fs=require('fs'),crypto=require('crypto'),{pipeline}=require('stream/promises');
async function archive(mode,input,output,keyfile){
 if(!['encrypt','decrypt'].includes(mode))throw Error('encrypt hoặc decrypt');
 const password=fs.readFileSync(keyfile);if(password.length<32)throw Error('Khóa sao lưu cần tối thiểu 32 byte');
 const temporary=output+'.partial-'+crypto.randomUUID();let fd;
 try{
  fd=fs.openSync(temporary,'wx',0o600);
  if(mode==='encrypt'){
   const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.scryptSync(password,salt,32),header=Buffer.concat([Buffer.from('UAVB1'),salt,iv]);fs.writeSync(fd,header);fs.closeSync(fd);fd=null;
   const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
   await pipeline(fs.createReadStream(input),cipher,fs.createWriteStream(temporary,{flags:'a'}));fs.appendFileSync(temporary,cipher.getAuthTag());
  }else{
   const stat=fs.statSync(input);if(stat.size<49)throw Error('Archive quá ngắn');
   const r=fs.openSync(input,'r'),header=Buffer.alloc(33),tag=Buffer.alloc(16);try{fs.readSync(r,header,0,33,0);fs.readSync(r,tag,0,16,stat.size-16);}finally{fs.closeSync(r);}
   if(header.subarray(0,5).toString()!=='UAVB1')throw Error('Sai định dạng backup');
   const key=crypto.scryptSync(password,header.subarray(5,21),32),decipher=crypto.createDecipheriv('aes-256-gcm',key,header.subarray(21,33));decipher.setAAD(header);decipher.setAuthTag(tag);fs.closeSync(fd);fd=null;
   await pipeline(fs.createReadStream(input,{start:33,end:stat.size-17}),decipher,fs.createWriteStream(temporary,{flags:'w',mode:0o600}));
  }
  // Exclusive hard link avoids overwriting an existing destination.
  fs.linkSync(temporary,output);fs.unlinkSync(temporary);
 }catch(e){if(fd!=null)fs.closeSync(fd);fs.rmSync(temporary,{force:true});throw e;}
}
module.exports={archive};
if(require.main===module){const [mode,input,output,keyfile]=process.argv.slice(2);if(!keyfile){console.error('node ops/archive.js encrypt|decrypt INPUT OUTPUT KEY_FILE');process.exitCode=1;}else archive(mode,input,output,keyfile).then(()=>console.log('Archive hoàn tất.')).catch(e=>{console.error('Archive thất bại:',e.message);process.exitCode=1;});}
