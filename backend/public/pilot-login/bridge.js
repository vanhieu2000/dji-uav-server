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
 async function freshThing(config){
  const loaded=connected(call('platformIsComponentLoaded','thing'));
  if(loaded){call('thingDisconnect');call('platformUnloadComponent','thing');if(connected(call('platformIsComponentLoaded','thing')))throw Error('Không gỡ được cấu hình MQTT cũ; thoát Cloud Service trên Pilot rồi đăng nhập lại.');}
  const params={host:config.host,username:config.username,password:config.password,connectCallback:'connectCallback'};
  load('thing',params);
  // Module loading may be asynchronous on Pilot. Wait for readiness before explicitly connecting.
  let ready=false;for(let n=0;n<60;n++){if(connected(call('platformIsComponentLoaded','thing'))){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}
  if(!ready)throw Error('Pilot chưa nạp xong module MQTT thing sau 3 giây.');
  let nativeConnected=false;try{nativeConnected=connected(call('thingGetConnectState'));}catch{}
  // A native getter can retain a stale true state; request the current credentials explicitly.
  try{call('thingConnect',params.username,params.password,'connectCallback');return {nativeConnected,connectRequested:true};}
  catch(error){return {nativeConnected,connectRequested:false,connectError:error.message};}
  // Broker confirmation remains mandatory even when native connect reports success.

 }
 return {value,call,serial,load,connected,freshThing};
})();
