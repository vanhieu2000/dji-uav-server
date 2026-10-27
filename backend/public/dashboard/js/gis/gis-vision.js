/* D: theo dõi job và duyệt kết quả; không huấn luyện hay giả lập kết quả Vision. */
(function(){
  'use strict';
  const GIS=window.GIS,esc=GIS.esc;
  let root=null,request=0;
  const LABEL={QUEUED:'Chờ gửi',SENDING:'Đang gửi',DISPATCHED:'Chờ kết quả',RETRY_WAIT:'Chờ thử lại',SUCCEEDED:'Đã xử lý',FAILED:'Lỗi',INVALID:'Ảnh chưa hợp lệ'};
  async function refresh(){
    const token=++request,r=await GIS.run(()=>GIS.api('GET','/api/vision/jobs'));
    if(!r||token!==request||!root)return;
    root.querySelector('#vision-jobs').innerHTML=r.data.length?`<div class="tbl-wrap"><table><thead><tr><th>Ảnh</th><th>Phiếu</th><th>Trạng thái</th><th>Lần gửi</th><th>Mô hình</th><th></th></tr></thead><tbody>${r.data.map(j=>`<tr><td>${esc(j.file_name)}</td><td>${esc(j.ticket_id||'Chưa gắn')}</td><td>${esc(LABEL[j.status]||j.status)}${j.last_error?'<br><small>'+esc(j.last_error)+'</small>':''}</td><td>${j.attempts}</td><td>${esc(j.model_version||'Chưa có')}</td><td><button class="btn sm" data-job="${esc(j.job_id)}">Xem</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="gis-empty">Chưa có job. Chọn ảnh gốc hoặc bật worker sau khi cấu hình dịch vụ Vision.</div>';
  }
  async function details(id){
    const r=await GIS.run(()=>GIS.api('GET',`/api/vision/jobs/${id}`));if(!r)return;
    const j=r.data,box=root.querySelector('#vision-detail');
    let body=j.result_json; if(typeof body==='string')try{body=JSON.parse(body);}catch(e){body=null;}
    const first=body&&body.detections&&body.detections[0];
    box.innerHTML=`<h3>${esc(j.file_name)} – ${esc(LABEL[j.status]||j.status)}</h3><p>Mô hình ${esc(j.model_version||'chưa có')} · phiên bản kết quả ${j.result_version}</p>
      ${first?`<div style="position:relative;max-width:640px;aspect-ratio:${first.image_width}/${first.image_height}"><img src="${esc(j.file_url)}" alt="Ảnh đầu vào" style="width:100%;height:100%;object-fit:contain"><svg viewBox="0 0 ${first.image_width} ${first.image_height}" style="position:absolute;inset:0;width:100%;height:100%">${body.detections.map(d=>`<rect x="${d.bbox[0]}" y="${d.bbox[1]}" width="${d.bbox[2]}" height="${d.bbox[3]}" fill="none" stroke="red" stroke-width="${Math.max(1,first.image_width/500)}"/>`).join('')}</svg></div>`:''}
      <p class="faint">Tọa độ chiếu chỉ là ước tính khi có AGL/FOV đã hiệu chuẩn. Không tự gán mọi lỗi vào tài sản gần vị trí máy bay.</p>
      ${j.detections.map(d=>`<div class="card" style="padding:12px;margin:8px 0"><b>${esc(d.defect_code||d.defect_type)}</b> · ${(d.confidence*100).toFixed(1)}% · ${d.max_temperature==null?'Chưa đo nhiệt':esc(d.max_temperature)+' °C'}
        <div>${esc(d.mapping_status||'Chưa gắn tài sản')}${d.projected_latitude==null?'':' · '+GIS.fmt(d.projected_latitude)+', '+GIS.fmt(d.projected_longitude)}</div>
        <form data-detection="${d.detection_id}" data-version="${d.result_version}"><label>Tìm tài sản theo mã <input name="q" required placeholder="Mã tấm pin / DCL / mối nối"></label><button class="btn sm" type="button" data-search="${d.detection_id}">Tìm</button><select name="target" required><option value="">Chưa chọn tài sản</option></select><button class="btn sm" type="submit">Xác nhận tài sản</button></form></div>`).join('')||'<p>Chưa có khiếm khuyết từ Vision.</p>'}`;
    box.querySelectorAll('[data-search]').forEach(b=>b.addEventListener('click',()=>GIS.run(async()=>{
      const f=b.closest('form'),q=f.elements.q.value;
      const r=await GIS.api('GET','/api/assets/search?q='+encodeURIComponent(q));
      f.elements.target.innerHTML=r.data.filter(a=>['panel','disconnector','contact'].includes(a.type)).map(a=>`<option value="${a.type.toUpperCase()}:${a.id}">${esc(a.code)} · ${esc(a.name)} · ${esc(a.parent||'')}</option>`).join('')||'<option value="">Không tìm thấy</option>';
    })));
    box.querySelectorAll('form').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();GIS.run(async()=>{
      const [type,asset]=f.elements.target.value.split(':');
      await GIS.api('POST',`/api/vision/detections/${f.dataset.detection}/asset`,{asset_type:type,asset_id:Number(asset),result_version:Number(f.dataset.version)});
      GIS.toast('Đã xác nhận tài sản');details(id);GIS.emit('assets-changed');
    });}));
  }
  async function loadRules(target=root){
    const r=await GIS.run(()=>GIS.api('GET','/api/vision/rules'));if(!r){target.querySelector('[data-vision-rules]').textContent='Không tải được ngưỡng cảnh báo. Vui lòng thử làm mới.';return;}
    const labels={PANEL:'Tấm pin',DISCONNECTOR:'Dao cách ly',CONTACT:'Mối nối',OTHER:'Khác'};
    target.querySelector('[data-vision-rules]').innerHTML=Object.entries(labels).map(([type,label])=>{
      const rule=r.data.find(x=>x.asset_type===type)||{};
      return `<form data-rule="${type}" class="actions" style="margin:8px 0;flex-wrap:wrap"><b>${label}</b><label>Nhiệt độ °C <input type="number" step="any" name="max_temp_c" value="${rule.max_temp_c??''}" placeholder="Không dùng"></label><label>ΔT °C <input type="number" step="any" name="delta_t_c" value="${rule.delta_t_c??''}" placeholder="Không dùng"></label><label>Tin cậy tối thiểu <input type="number" min="0" max="1" step="0.01" name="min_confidence" value="${rule.min_confidence??0.8}" required></label><label>Cảnh báo sớm trong số ngày <input type="number" name="trend_horizon_days" min="0.1" step="any" value="${rule.trend_horizon_days??''}"></label><label><input type="checkbox" name="enabled" ${rule.enabled?'checked':''}> Bật</label><button class="btn sm">Lưu</button></form>`;
    }).join('');
    target.querySelectorAll('[data-rule]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();GIS.run(async()=>{
      const n=k=>f.elements[k].value===''?null:Number(f.elements[k].value);
      await GIS.api('PUT','/api/vision/rules/'+f.dataset.rule,{max_temp_c:n('max_temp_c'),delta_t_c:n('delta_t_c'),min_confidence:n('min_confidence'),trend_horizon_days:n('trend_horizon_days'),enabled:f.elements.enabled.checked});
      GIS.toast('Đã lưu ngưỡng cảnh báo');
    });}));
  }
  GIS.Vision={renderRules(el){
    el.innerHTML='<div class="card-head"><h2>Ngưỡng cảnh báo chung</h2><div class="r"><button class="btn sm" type="button" data-reload-rules>Làm mới</button></div></div><p class="muted">Áp dụng cho các đối tượng chưa có ngưỡng riêng. Bật quy tắc để sử dụng; lưu từng nhóm độc lập.</p><div data-vision-rules>Đang tải…</div>';
    el.querySelector('[data-reload-rules]').onclick=()=>loadRules(el);return loadRules(el);
  },render(el){
    root=el;
    root.innerHTML=`<div class="card" style="padding:16px"><h2>Xử lý ảnh với Vision</h2><p>Job lưu bền vững; gửi lại không sinh lỗi trùng. Dịch vụ và mô hình do đội Vision cung cấp.</p><div class="actions"><select id="vision-media"><option value="">Chọn ảnh gốc</option></select><button class="btn primary" id="vision-enqueue">Đưa vào hàng đợi</button><button class="btn" id="vision-refresh">Làm mới</button></div><div id="vision-jobs"></div><div id="vision-detail"></div><details><summary>Ngưỡng cảnh báo (cần đăng nhập quản trị)</summary><p>Chưa có quy tắc bật thì không tự dùng ngưỡng nhiệt mặc định. WARNING: phát hiện đạt confidence; CRITICAL: vượt ngưỡng nhiệt/ΔT đã cấu hình.</p><div data-vision-rules></div></details></div>`;
    root.querySelector('#vision-refresh').onclick=refresh;
    root.querySelector('#vision-enqueue').onclick=()=>GIS.run(async()=>{const id=Number(root.querySelector('#vision-media').value);if(!id)throw new Error('Chọn ảnh trước');await GIS.api('POST','/api/vision/jobs',{media_id:id});await refresh();});
    root.querySelector('#vision-jobs').onclick=e=>{const b=e.target.closest('[data-job]');if(b)details(b.dataset.job);};
    GIS.run(async()=>{const r=await GIS.api('GET','/api/vision/media');root.querySelector('#vision-media').innerHTML='<option value="">Chọn ảnh gốc</option>'+r.data.map(m=>`<option value="${m.media_id}">${esc(m.file_name)} · ${esc(m.lens)}</option>`).join('');});
    refresh();loadRules();
  },refresh};
})();
