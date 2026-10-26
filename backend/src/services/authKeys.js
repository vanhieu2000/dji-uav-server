const fs=require('fs'),path=require('path'),crypto=require('crypto');
function signingKey(){
    if(process.env.JWT_SECRET){if(Buffer.byteLength(process.env.JWT_SECRET)<32)throw new Error('JWT_SECRET cần ít nhất 32 byte');return process.env.JWT_SECRET;}
    const dir=path.join(__dirname,'../../data');fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'jwt-signing-key');
    try{fs.writeFileSync(file,crypto.randomBytes(48).toString('hex'),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    const key=fs.readFileSync(file,'utf8').trim();if(Buffer.byteLength(key)<32)throw new Error('Khóa JWT local không hợp lệ');return key;
}
module.exports={signingKey};
