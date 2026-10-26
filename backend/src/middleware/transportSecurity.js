const {randomUUID}=require('crypto');
function securityHeaders(req,res,next){res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin','Permissions-Policy':'geolocation=(self), camera=(), microphone=()','X-Request-ID':randomUUID()});if(req.secure)res.set('Strict-Transport-Security','max-age=31536000');if(/^\/(api|storage|manage|media|wayline)(\/|$)/.test(req.path))res.set('Cache-Control','no-store');next();}
function originPolicy(req,res,next){
 const origin=req.get('origin');if(!origin)return next();
 const allowed=new Set((process.env.CORS_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
 const own=req.protocol+'://'+req.get('host');
 if(origin!==own&&!allowed.has(origin))return res.status(403).json({code:403,message:'Origin không được phép'});
 res.vary('Origin');res.set({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Auth-Token','Access-Control-Allow-Methods':'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'});
 if(req.method==='OPTIONS')return res.sendStatus(204);next();
}
const rates=new Map();function rateLimit(req,res,next){
 if(!req.path.startsWith('/api/'))return next();const id=req.ip||'unknown',now=Date.now();let r=rates.get(id);if(!r||now-r.at>=60000){r={at:now,n:0};rates.set(id,r);}if(rates.size>10000)for(const [k,v]of rates)if(now-v.at>60000)rates.delete(k);
 if(++r.n>1200)return res.status(429).json({code:429,message:'Quá nhiều yêu cầu; thử lại sau một phút'});next();
}
function redact(value,depth=0){if(typeof value==='string'&&/[?&](sign|grant|sig|token|X-Amz-[A-Za-z-]+)=/i.test(value))return '[signed URL redacted]';if(depth>12)return '[depth limit]';if(Array.isArray(value))return value.map(v=>redact(v,depth+1));if(value&&typeof value==='object'){const out={};for(const [k,v]of Object.entries(value))out[k]=/password|secret|credential|token|license|appkey|authorization|rtmpurl/i.test(k)?'[redacted]':redact(v,depth+1);return out;}return value;}
module.exports={securityHeaders,originPolicy,rateLimit,redact};
