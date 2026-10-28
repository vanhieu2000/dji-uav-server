/* Record actions/errors, never form values, passwords or browser storage. */
(()=>{
 let queue=[],sending=false;
 function record(kind,data){if(!window.UAV_USER)return;queue.push({kind,view:document.querySelector('.page-view.active')?.id||document.title,...data});if(queue.length>30)queue.shift();}
 function flush(){if(sending||!queue.length)return;const events=queue.splice(0,10);sending=true;fetch('/api/diagnostics/client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events}),keepalive:true}).catch(()=>{}).finally(()=>sending=false);}
 document.addEventListener('click',e=>{const control=e.target.closest('button,a,summary');if(control)record('action',{action:(control.getAttribute('aria-label')||control.textContent||'').trim().slice(0,120)});},true);
 window.addEventListener('error',e=>record('error',{message:String(e.message).slice(0,500)}));window.addEventListener('unhandledrejection',e=>record('error',{message:String(e.reason?.message||e.reason).slice(0,500)}));
 for(const owner of [window,window.GIS])if(owner&&typeof owner.toast==='function'){const original=owner.toast;owner.toast=function(message,...args){record('notice',{message:String(message).slice(0,500)});return original.call(this,message,...args);};}
 setInterval(flush,1500);window.addEventListener('pagehide',flush);
})();
