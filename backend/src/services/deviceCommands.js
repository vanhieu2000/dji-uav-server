const {randomUUID}=require('crypto');
const failure=(message,status=409)=>Object.assign(new (require('../utils/validate').ValidationError)(message),{status});
function createCommands({getClient,timeoutMs=12000}){
 const pending=new Map(),busy=new Set();
 function send(gateway,method,data){
  const client=getClient();if(!client?.connected)return Promise.reject(failure('MQTT chưa kết nối',503));
  if(pending.size>=100)return Promise.reject(failure('Quá nhiều lệnh đang chờ',429));
  const packet={tid:randomUUID(),bid:randomUUID(),timestamp:Date.now(),method,data};
  return new Promise((resolve,reject)=>{
   const finish=(err,reply)=>{if(!pending.has(packet.tid))return;clearTimeout(timer);pending.delete(packet.tid);err?reject(err):resolve({tid:packet.tid,bid:packet.bid,method,result:reply.data.result,status:reply.data.status||'accepted'});};
   const timer=setTimeout(()=>finish(failure('Không nhận được phản hồi UAV cho '+method+'; không tự gửi lại lệnh',504)),timeoutMs);
   pending.set(packet.tid,{gateway,packet,finish});
   try{client.publish(`thing/product/${gateway}/services`,JSON.stringify(packet),{qos:1},err=>{if(err)finish(failure('Không gửi được lệnh MQTT',503));});}catch{finish(failure('Không gửi được lệnh MQTT',503));}
  });
 }
 function reply(gateway,payload){
  const p=pending.get(payload?.tid);
  if(!p||p.gateway!==gateway||p.packet.bid!==payload.bid||(payload.method&&payload.method!==p.packet.method))return false;
  const result=payload.data?.result;
  if(!Number.isInteger(result))return false;
  p.finish(result!==0?failure('UAV từ chối '+p.packet.method+' (result='+result+')',422):null,payload);return true;
 }
 async function exclusive(gateway,action){if(busy.has(gateway))throw failure('Thiết bị đang xử lý lệnh khác',409);busy.add(gateway);try{return await action();}finally{busy.delete(gateway);}}
 return {send,reply,exclusive};
}
module.exports={createCommands,failure};
