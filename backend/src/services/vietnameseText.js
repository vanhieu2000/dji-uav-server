/* Suggest only lossless reversals of UTF-8 incorrectly decoded as MySQL latin1/CP1252. */
const map=new Map(Object.entries({128:8364,130:8218,131:402,132:8222,133:8230,134:8224,135:8225,136:710,137:8240,138:352,139:8249,140:338,142:381,145:8216,146:8217,147:8220,148:8221,149:8226,150:8211,151:8212,152:732,153:8482,154:353,155:8250,156:339,158:382,159:376}).map(([b,c])=>[c,Number(b)]));
function score(s){return(s.match(/[\u0080-\u009f\ufffd]|[ÃÂÄÆ][\u0080-\u00bf\u2010-\u203f\u20ac\u2122]|á[º»]|â[€™œ]|ðŸ/g)||[]).length;}
function repair(text){
 if(typeof text!=='string'||!score(text))return null;
 let value=text,passes=0;
 for(let i=0;i<4;i++){
  const bytes=[];let valid=true;
  for(const c of value){const point=c.codePointAt(0),byte=point<=255?point:map.get(point);if(byte===undefined){valid=false;break;}bytes.push(byte);}
  if(!valid)break;
  let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));}catch{break;}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(decoded)||score(decoded)>=score(value)||!Buffer.from(decoded).equals(Buffer.from(bytes)))break;
  value=decoded;passes++;
 }
 return value!==text?{before:text,after:value,passes,remaining:score(value)}:null;
}
module.exports={repair,score};
