/* Session trình duyệt dùng cookie HttpOnly; không lưu token vào localStorage. */
(()=>{
 localStorage.removeItem('uav_token');
 const style=document.createElement('style');style.textContent='#account-overlay{position:fixed;inset:0;z-index:100000;background:#0d1625;display:grid;place-items:center;color:#eaf2ff}#account-overlay form{width:min(400px,90vw);display:grid;gap:12px}#account-overlay input,#account-overlay button{padding:12px;font:inherit}#account-tools{position:fixed;bottom:8px;right:8px;z-index:9000;background:#182b40;color:white;padding:8px;border-radius:8px}#account-tools button,#account-tools a{margin:4px;color:inherit}';document.head.append(style);
 async function api(path,body){const r=await fetch('/api/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.message||'Không thể thực hiện');return j.data;}
 const overlay=document.createElement('div');overlay.id='account-overlay';document.body.append(overlay);
 function form(mode,user){
  const reset=mode==='reset',change=mode==='change',forgot=mode==='forgot';
  overlay.style.display='grid';overlay.innerHTML=`<form><h2>${reset?'Đặt lại mật khẩu':change?'Đổi mật khẩu':forgot?'Khôi phục mật khẩu':'Đăng nhập UAV'}</h2>${user?'<p class="who"></p>':''}${!reset&&!change&&!forgot?'<label>Tài khoản <input name="username" autocomplete="username" required></label>':''}${forgot?'<label>Email <input name="email" type="email" required></label>':!reset?'<label>Mật khẩu '+(change?'hiện tại':'')+' <input name="password" type="password" autocomplete="current-password" required></label>':''}${reset||change?'<label>Mật khẩu mới (12–72 byte) <input name="new_password" type="password" minlength="12" autocomplete="new-password" required></label>':''}<p role="status"></p><button>${forgot?'Gửi hướng dẫn':'Tiếp tục'}</button><button type="button" class="back">${change?'Đăng xuất':'Quay lại đăng nhập'}</button>${!forgot&&!change&&!reset?'<button type="button" class="forgot">Quên mật khẩu</button>':''}</form>`;
  if(user)overlay.querySelector('.who').textContent=user.full_name||user.username;
  overlay.querySelector('.back').onclick=async()=>{if(change)await api('logout',{});location.hash='';form('login');};
  overlay.querySelector('.forgot')?.addEventListener('click',()=>form('forgot'));
  overlay.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button'),s=f.querySelector('[role=status]');b.disabled=true;try{
   if(forgot){await api('forgot-password',{email:f.email.value});s.textContent='Nếu tài khoản hợp lệ, hướng dẫn sẽ được gửi qua email.';}
   else if(reset){await api('reset-password',{token:resetToken,new_password:f.new_password.value});resetToken=null;form('login');}
   else if(change){await api('change-password',{old_password:f.password.value,new_password:f.new_password.value});form('login');}
   else{const d=await api('login',{username:f.username.value,password:f.password.value});if(d.user.must_change_password)form('change',d.user);else location.reload();}
  }catch(err){s.textContent=err.message;}finally{b.disabled=false;}};
 }
 let resetToken=new URLSearchParams(location.hash.slice(1)).get('reset_token');
 if(resetToken){history.replaceState(null,'',location.pathname);form('reset');return;}
 api('me').then(user=>{window.UAV_USER=user;if(user.must_change_password)return form('change',user);if(user.role!=='ADMIN'&&!location.pathname.startsWith('/m')){location.replace('/m/');return;}overlay.remove();
 const tools=document.createElement('div');tools.id='account-tools';const who=document.createElement('span');who.textContent=user.full_name||user.username;tools.append(who);
 if(user.role==='ADMIN'){const a=document.createElement('a');a.href='/dashboard/accounts.html';a.textContent='Quản trị';tools.append(a);}
 const pass=document.createElement('button');pass.textContent='Đổi mật khẩu';pass.onclick=()=>{document.body.append(overlay);form('change',user);};tools.append(pass);
 const out=document.createElement('button');out.textContent='Đăng xuất';out.onclick=async()=>{await api('logout',{});location.reload();};tools.append(out);document.body.append(tools);
 }).catch(()=>form('login'));
})();
