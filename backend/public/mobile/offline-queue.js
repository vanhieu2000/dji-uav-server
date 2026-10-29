/* Persistent queue; l'identité du propriétaire est vérifiée avant tout envoi. */
(()=>{
 const open=new Promise((resolve,reject)=>{const r=indexedDB.open('uav-offline-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 async function operation(mode,fn){const db=await open;return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode),r=fn(tx.objectStore('photos'));let result;r.onsuccess=()=>result=r.result;r.onerror=()=>reject(r.error);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
 const queue={
  list:()=>operation('readonly',s=>s.getAll()),
  add:entry=>operation('readwrite',s=>s.add({...entry,id:crypto.randomUUID(),created_at:Date.now(),attempts:0})),
  remove:id=>operation('readwrite',s=>s.delete(id)),
  update:entry=>operation('readwrite',s=>s.put(entry)),
  async sync(user,onProgress=()=>{}){
   if(queue.running)return;queue.running=true;
   const work=async()=>{
   try{for(const item of await queue.list()){
    if(item.owner!==user.user_id)continue;
    const form=new FormData();form.append('files',item.file,item.name);
    try{
     const r=await fetch(`/api/workspace/tasks/${item.ticket_id}/photos`,{method:'POST',body:form});
     const result=await r.json();
     if(r.status===401||r.status===428)throw Error('Cần đăng nhập lại trước khi gửi ảnh');
     if(!r.ok)throw Error(result.message||'Không gửi được ảnh');
     const state=result.data?.items?.[0];if(!state||!['created','duplicate'].includes(state.status))throw Error(state?.error||'Máy chủ chưa xác nhận ảnh');
     await queue.remove(item.id);
    }catch(e){await queue.update({...item,attempts:item.attempts+1,last_error:e.message});onProgress();break;}
    onProgress();
   }}finally{onProgress();}
   };
   try{if(navigator.locks)await navigator.locks.request('uav-photo-sync-'+user.user_id,work);else await work();}finally{queue.running=false;onProgress();}
  }
 };window.PhotoQueue=queue;
})();
