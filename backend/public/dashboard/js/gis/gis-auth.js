/* Session trình duyệt dùng cookie HttpOnly; không lưu token vào localStorage. */
(()=>{
 localStorage.removeItem('uav_token');
 const style=document.createElement('style');style.textContent='#account-overlay{position:fixed;inset:0;z-index:100000;background:#0d1625;display:grid;place-items:center;color:#eaf2ff}#account-overlay form{width:min(400px,90vw);display:grid;gap:12px}#account-overlay input,#account-overlay button{padding:12px;font:inherit}#account-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 0;color:inherit}#account-sidebar #account-tools{display:contents}#account-sidebar .account-secondary{width:100%;display:flex;flex-wrap:wrap;gap:6px}#account-overlay label{display:grid;gap:6px}#account-overlay form{max-height:90dvh;overflow:auto}#account-overlay [role=status]{color:#ffd68a}#account-tools button,#account-tools a{margin:0;color:inherit;font-size:12px}#account-tools button{background:#245473;border:1px solid #6d90a9;border-radius:5px;padding:6px 9px;cursor:pointer;font:inherit}';document.head.append(style);
 async function api(path,body){const r=await fetch('/api/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.message||'Không thể thực hiện');return j.data;}
 const overlay=document.createElement('div');overlay.id='account-overlay';document.body.append(overlay);
 function form(mode,user){
  const reset=mode==='reset',change=mode==='change',forgot=mode==='forgot';
  overlay.style.display='grid';overlay.innerHTML=`<form><h2>${reset?'Đặt lại mật khẩu':change?'Đổi mật khẩu':forgot?'Khôi phục mật khẩu':'Đăng nhập UAV'}</h2>${user?'<p class="who"></p>':''}${!reset&&!change&&!forgot?'<label>Tài khoản <input name="username" autocomplete="username" required></label>':''}${forgot?'<label>Email <input name="email" type="email" required></label>':!reset?'<label>Mật khẩu '+(change?'hiện tại':'')+' <input name="password" type="password" autocomplete="current-password" required></label>':''}${reset||change?'<label>Mật khẩu mới (12–72 byte) <input name="new_password" type="password" minlength="12" autocomplete="new-password" required></label>':''}<p role="status"></p><button>${forgot?'Gửi hướng dẫn':'Tiếp tục'}</button><button type="button" class="back">${change?'Đăng xuất':'Quay lại đăng nhập'}</button>${!forgot&&!change&&!reset?'<button type="button" class="forgot">Quên mật khẩu</button>':''}</form>`;
  if(user)overlay.querySelector('.who').textContent=user.full_name||user.username;
  overlay.querySelector('.back').onclick=async()=>{try{if(change)await api('logout',{});location.hash='';form('login');}catch(err){overlay.querySelector('[role=status]').textContent=err.message;}};
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
 if(document.getElementById('account-name')){document.getElementById('account-name').textContent=user.full_name||user.username;document.getElementById('account-email').textContent=user.email||user.role;document.getElementById('account-avatar').textContent=(user.full_name||user.username||'?').slice(0,2).toUpperCase();}
 const tools=document.createElement('div');tools.id='account-tools';const who=document.createElement('span');who.textContent=user.full_name||user.username;if(!document.getElementById('account-sidebar'))tools.append(who);
 const secondary=document.createElement('div');secondary.className='account-secondary';
 if(user.role==='ADMIN'){const a=document.createElement('a');a.href='/dashboard/accounts.html';a.textContent='Quản trị';secondary.append(a);}
 const pass=document.createElement('button');pass.textContent='Đổi mật khẩu';pass.onclick=()=>{document.body.append(overlay);form('change',user);};secondary.append(pass);
 const out=document.createElement('button');out.className='account-logout';out.title='Đăng xuất';out.setAttribute('aria-label','Đăng xuất');out.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"/></svg><span>Đăng xuất</span>';
 out.onclick=async()=>{out.disabled=true;try{await api('logout',{});location.reload();}catch(err){out.disabled=false;out.title=err.message;const status=document.createElement('p');status.setAttribute('role','alert');status.textContent=err.message;tools.append(status);}};
 tools.append(out,secondary);(document.getElementById('account-sidebar')||document.querySelector('header')||document.body).append(tools);
 }).catch(()=>form('login'));
})();
