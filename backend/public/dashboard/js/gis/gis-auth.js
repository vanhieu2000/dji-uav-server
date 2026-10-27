/* Session trình duyệt dùng cookie HttpOnly; không lưu token vào localStorage. */
(()=>{
 localStorage.removeItem('uav_token');
 async function api(path,body){const r=await fetch('/api/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();if(!r.ok)throw Error(j.message||'Không thể thực hiện');return j.data;}
 const overlay=document.createElement('div');overlay.id='account-overlay';overlay.setAttribute('aria-label','Tài khoản RTC');document.body.append(overlay);
 function form(mode,user){
  const reset=mode==='reset',change=mode==='change',forgot=mode==='forgot';
  const title=reset?'Đặt lại mật khẩu':change?'Đổi mật khẩu':forgot?'Quên mật khẩu?':'Đăng nhập';
  const description=reset?'Tạo mật khẩu mới cho tài khoản của bạn.':change?'Cập nhật mật khẩu để tiếp tục sử dụng hệ thống.':forgot?'Nhập email đã đăng ký để nhận hướng dẫn khôi phục.':'Chào mừng bạn trở lại hệ thống giám sát UAV.';
  overlay.style.display='grid';overlay.innerHTML=`<div class="auth-shell"><section class="auth-intro" aria-label="RTC Giám sát UAV"><img class="auth-logo" src="/dashboard/assets/rtc-logo.png" alt="Logo RTC"><div><p class="auth-eyebrow">RTC · UAV MANAGEMENT</p><h1>Giám sát UAV</h1></div><p>Quản lý kiểm tra điện mặt trời và trạm biến áp trên cùng một hệ thống.</p><ul class="auth-features"><li>Bản đồ và giám sát thiết bị</li><li>Phiếu kiểm tra và ảnh nhiệt</li><li>Báo cáo và theo dõi sự cố</li></ul><footer>Điện mặt trời & Trạm biến áp</footer></section><section class="auth-panel"><form aria-labelledby="auth-title"><div class="auth-heading"><h2 id="auth-title">${title}</h2><p class="auth-description">${description}</p></div>${user?'<p class="who"></p>':''}${!reset&&!change&&!forgot?'<label for="auth-username">Tài khoản<input id="auth-username" name="username" placeholder="Nhập tài khoản của bạn" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>':''}${forgot?'<label for="auth-email">Email<input id="auth-email" name="email" type="email" placeholder="ban@congty.vn" autocomplete="email" required></label>':!reset?'<label for="auth-password">Mật khẩu '+(change?'hiện tại':'')+'<input id="auth-password" name="password" type="password" placeholder="Nhập mật khẩu" autocomplete="current-password" required></label>':''}${reset||change?'<label for="auth-new-password">Mật khẩu mới<input id="auth-new-password" name="new_password" type="password" placeholder="Từ 12 đến 72 byte" minlength="12" autocomplete="new-password" aria-describedby="auth-password-hint" required><small id="auth-password-hint">Dùng từ 12 đến 72 byte cho mật khẩu mới.</small></label>':''}<p role="status" aria-live="polite"></p><button type="submit">${forgot?'Gửi hướng dẫn':change||reset?'Lưu mật khẩu mới':'Đăng nhập'}</button><div class="auth-links">${change||forgot||reset?'<button type="button" class="back">'+(change?'Đăng xuất':'Quay lại đăng nhập')+'</button>':'<button type="button" class="forgot">Quên mật khẩu?</button>'}</div></form><p class="auth-note">RTC · Hệ thống quản lý và giám sát UAV</p></section></div>`;
  if(user)overlay.querySelector('.who').textContent=user.full_name||user.username;
  const back=overlay.querySelector('.back');if(back)back.onclick=async()=>{try{if(change)await api('logout',{});location.hash='';form('login');}catch(err){overlay.querySelector('[role=status]').textContent=err.message;}};
  overlay.querySelector('.forgot')?.addEventListener('click',()=>form('forgot'));
  overlay.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button'),s=f.querySelector('[role=status]');b.disabled=true;try{
   if(forgot){await api('forgot-password',{email:f.email.value});s.classList.add('success');s.textContent='Nếu tài khoản hợp lệ, hướng dẫn sẽ được gửi qua email.';}
   else if(reset){await api('reset-password',{token:resetToken,new_password:f.new_password.value});resetToken=null;form('login');}
   else if(change){await api('change-password',{old_password:f.password.value,new_password:f.new_password.value});form('login');}
   else{const d=await api('login',{username:f.username.value,password:f.password.value});if(d.user.must_change_password)form('change',d.user);else location.reload();}
  }catch(err){s.classList.remove('success');s.textContent=err.message;}finally{b.disabled=false;}};
 }
 let resetToken=new URLSearchParams(location.hash.slice(1)).get('reset_token');
 if(resetToken){history.replaceState(null,'',location.pathname);form('reset');return;}
 api('me').then(user=>{window.UAV_USER=user;if(user.must_change_password)return form('change',user);if(user.role!=='ADMIN'&&!location.pathname.startsWith('/m')){location.replace('/m/');return;}overlay.remove();
 if(document.getElementById('account-name')){document.getElementById('account-name').textContent=user.full_name||user.username;document.getElementById('account-email').textContent=user.email||user.role;document.getElementById('account-avatar').textContent=(user.full_name||user.username||'?').slice(0,2).toUpperCase();}
 const profile=document.getElementById('account-profile');
 if(profile){
  for(const [label,value] of [['Tài khoản',user.username],['Họ tên',user.full_name],['Email',user.email],['Vai trò',user.role]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'Chưa cập nhật';profile.append(dt,dd);}
  document.getElementById('account-admin-link').hidden=user.role!=='ADMIN';
  const f=document.getElementById('account-password-form');f.onsubmit=async e=>{e.preventDefault();const status=document.getElementById('account-password-status'),button=f.querySelector('button');status.textContent='';if(f.new_password.value!==f.confirm_password.value){status.textContent='Mật khẩu nhập lại chưa khớp.';return;}const bytes=new TextEncoder().encode(f.new_password.value).length;if(bytes<12||bytes>72){status.textContent='Mật khẩu mới phải từ 12 đến 72 byte.';return;}button.disabled=true;try{await api('change-password',{old_password:f.old_password.value,new_password:f.new_password.value});location.reload();}catch(err){status.textContent=err.message;button.disabled=false;}};
 }
 const tools=document.createElement('div');tools.id='account-tools';const who=document.createElement('span');who.textContent=user.full_name||user.username;if(!document.getElementById('account-sidebar'))tools.append(who);
 const secondary=document.createElement('div');secondary.className='account-secondary';
 if(!document.getElementById('account-profile')&&user.role==='ADMIN'){const a=document.createElement('a');a.href='/dashboard/accounts.html';a.textContent='Quản trị';secondary.append(a);}
 const pass=document.createElement('button');pass.textContent='Đổi mật khẩu';pass.onclick=()=>{document.body.append(overlay);form('change',user);};secondary.append(pass);
 const out=document.createElement('button');out.className='account-logout';out.title='Đăng xuất';out.setAttribute('aria-label','Đăng xuất');out.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"/></svg><span>Đăng xuất</span>';
 out.onclick=async()=>{out.disabled=true;try{await api('logout',{});location.reload();}catch(err){out.disabled=false;out.title=err.message;const status=document.createElement('p');status.setAttribute('role','alert');status.textContent=err.message;tools.append(status);}};
 tools.append(out);if(!document.getElementById('account-profile'))tools.append(secondary);(document.getElementById('account-sidebar')||document.getElementById('mobile-account-slot')||document.querySelector('header')||document.body).append(tools);
 }).catch(()=>form('login'));
})();
