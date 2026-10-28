/* DJI setup calls return JSON strings; getters can return primitives or wrapped data. */
window.PilotBridge = (() => {
 function value(raw) {
  let v=raw;if(typeof v==='string'){try{v=JSON.parse(v);}catch{ return v; }}
  if(v&&typeof v==='object'&&Object.hasOwn(v,'code')){if(v.code!==0)throw Error('DJI Bridge code '+v.code);return v.data;}
  return v;
 }
 function call(name,...args){const bridge=window.djiBridge;if(typeof bridge?.[name]!=='function')throw Error('Pilot 2 không hỗ trợ '+name);return value(bridge[name](...args));}
 function serial(name){let v;try{v=call(name);}catch{return null;}const sn=typeof v==='string'?v:v?.sn;return typeof sn==='string'&&/^[A-Za-z0-9_-]{4,64}$/.test(sn)?sn:null;}
 function load(name,params){call('platformLoadComponent',name,JSON.stringify(params));}
 function connected(raw){try{const v=value(raw);return v===true||v==='true';}catch{return false;}}
 return {value,call,serial,load,connected};
})();
