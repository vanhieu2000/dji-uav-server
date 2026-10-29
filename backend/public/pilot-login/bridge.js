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
  const params={host:config.host,username:config.username,password:config.password,connectCallback:'connectCallback'};
  load('thing',params);
 }
 async function enableOriginalPhotos(isCurrent=()=>true){
  let lastError='Pilot chưa xác nhận cấu hình media';
  for(let attempt=0;attempt<8;attempt++){
   await new Promise(resolve=>setTimeout(resolve,350));if(!isCurrent())return {cancelled:true};
   try{
    if(!connected(call('platformIsComponentLoaded','media'))){load('media',{autoUploadPhoto:true,autoUploadPhotoType:0,autoUploadVideo:false});lastError='Module media chưa sẵn sàng';continue;}
    let auto=null,type=null;
    try{auto=connected(call('mediaGetAutoUploadPhoto'));type=Number(call('mediaGetUploadPhotoType'));}catch{}
    if(auto===true&&type===0)return {verified:true};
    if(auto!==true)call('mediaSetAutoUploadPhoto',true);
    if(type!==0)call('mediaSetUploadPhotoType',0);
    try{if(connected(call('mediaGetAutoUploadPhoto'))&&Number(call('mediaGetUploadPhotoType'))===0)return {verified:true};}catch{}
    lastError='Pilot đã nhận yêu cầu nhưng chưa xác nhận tự tải ảnh gốc';
   }catch(error){lastError=error.message;}
  }
  return {verified:false,message:lastError};
 }
 return {value,call,serial,load,connected,freshThing,enableOriginalPhotos};
})();
