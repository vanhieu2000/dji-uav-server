/* DJI setup calls return JSON strings; getters can return primitives or wrapped data. */
window.PilotBridge = (() => {
 function value(raw,method) {
  let v=raw;if(typeof v==='string'){try{v=JSON.parse(v);}catch{ return v; }}
  if(v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'code')){if(v.code!==0)throw Error('DJI Bridge '+(method||'response')+' code '+v.code);return v.data;}
  return v;
 }
 function call(name,...args){const bridge=window.djiBridge;if(typeof bridge?.[name]!=='function')throw Error('Pilot 2 không hỗ trợ '+name);return value(bridge[name](...args),name+(name==='platformLoadComponent'||name==='platformUnloadComponent'?' ['+args[0]+']':''));}
 function serial(name){let v;try{v=call(name);}catch{return null;}const sn=typeof v==='string'?v:v?.sn;return typeof sn==='string'&&/^[A-Za-z0-9_-]{4,64}$/.test(sn)?sn:null;}
 function load(name,params){call('platformLoadComponent',name,JSON.stringify(params));}
 function connected(raw){try{const v=value(raw);return v===true||v==='true';}catch{return false;}}
 function freshThing(config){
  const loaded=connected(call('platformIsComponentLoaded','thing'));
  if(loaded){call('thingDisconnect');call('platformUnloadComponent','thing');if(connected(call('platformIsComponentLoaded','thing')))throw Error('Không gỡ được cấu hình MQTT cũ; thoát Cloud Service trên Pilot rồi đăng nhập lại.');}
  const params={host:config.host,username:config.username,password:config.password,connectCallback:'connectCallback'};
  load('thing',params);
  // Optional native config read-back is omitted: it returned615011 on the real RC.

 }
 return {value,call,serial,load,connected,freshThing};
})();
