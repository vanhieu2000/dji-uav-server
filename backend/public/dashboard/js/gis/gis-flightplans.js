/* =====================================================================
   LẬP ĐƯỜNG BAY (Giai đoạn A2): chọn khu / tài sản + hồ sơ chụp → xem trước → tạo KMZ.
     GIS.FlightPlans.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = { root: null, map: null, previewLayer: null, profiles: [], tree: null, lastPreview: null, routes: [], tickets: [], manualPoints: [], manualSource: true, picking: false, manualLayer: null };

  const fmtTime = s => `${Math.floor(s / 60)} phút ${s % 60} giây`;

  function profileOptions(kind) {
    return st.profiles.filter(p => p.route_kind === kind)
      .map(p => `<option value="${p.profile_id}">${esc(p.profile_name)}${p.geometry && kind === 'GRID' ? ` (${esc(p.geometry.altitude_m)} m)` : ''}</option>`).join('');
  }

  function targetList() {
    const t = st.tree;
    if (!t || !t.substations.length) return '<div class="faint">Chưa có trạm / ngăn lộ.</div>';
    return t.substations.map(s => s.bays.map(b => `
      <label class="gis-check gis-tgt"><input type="checkbox" data-type="BAY" value="${b.bay_id}"> <b>Ngăn ${esc(b.bay_code)}</b> <span class="faint">(cả ${b.disconnectors.length} DCL)</span></label>
      ${b.disconnectors.map(d => `<label class="gis-check gis-tgt gis-tgt-sub"><input type="checkbox" data-type="DISCONNECTOR" value="${d.disconnector_id}"> DCL ${esc(d.dcl_code)} ${esc(d.phase === '3PHASE' ? '' : d.phase)}</label>`).join('')}
    `).join('')).join('');
  }

  function invalidate(){st.lastPreview=null;st.root.querySelector('#gis-fp-create').disabled=true;if(st.previewLayer){st.map.removeLayer(st.previewLayer);st.previewLayer=null;}}
  function editPoint(i){
    const p=st.manualPoints[i],dialog=document.createElement('dialog');dialog.className='card';dialog.style.cssText='max-width:520px;width:calc(100% - 24px);margin:auto;padding:20px';
    const values={altitude_m:p.altitude_m??Number(st.root.querySelector('#gis-fp-alt')?.value||30),speed_mps:p.speed_mps??3,gimbal_pitch:p.gimbal_pitch??-90,hover_seconds:p.hover_seconds??1,lat:p.lat,lng:p.lng};
    dialog.innerHTML=`<form><h3>Waypoint ${i+1}</h3><div class="gis-grid3">${Object.entries(values).map(([k,v])=>`<label>${({altitude_m:'Cao so điểm cất cánh (m)',speed_mps:'Tốc độ (m/s)',gimbal_pitch:'Gimbal (°)',hover_seconds:'Dừng (s)',lat:'Vĩ độ',lng:'Kinh độ'})[k]}<input class="input" type="number" step="any" name="${k}" value="${v}" required></label>`).join('')}</div><label>Ảnh lưu<select class="input" name="lenses"><option value="wide,ir">Wide + IR</option><option value="wide">Wide</option><option value="ir">IR</option><option value="zoom">Zoom</option></select></label><div class="actions"><button class="btn primary">Lưu điểm</button><button type="button" class="btn" id="wp-cancel">Hủy</button></div></form>`;
    document.body.append(dialog);dialog.querySelector('[name=lenses]').value=p.lenses||'wide,ir';dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('#wp-cancel').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const f=e.target;for(const k of Object.keys(values)){const n=Number(f.elements[k].value);if(!Number.isFinite(n))return;p[k]=n;}p.lenses=f.elements.lenses.value;invalidate();drawManual();dialog.close();};dialog.showModal();
  }
  function pointSafe(p){
    const ring=(r)=>{let ok=false;for(let i=0,j=r.length-1;i<r.length;j=i++){if((r[i][1]>p.lat)!==(r[j][1]>p.lat)&&p.lng<(r[j][0]-r[i][0])*(p.lat-r[i][1])/(r[j][1]-r[i][1])+r[i][0])ok=!ok;}return ok;};
    const inside=g=>g&&ring(g.coordinates[0])&&!g.coordinates.slice(1).some(ring);
    return !!fenceData.boundary&&inside(fenceData.boundary)&&!fenceData.exclusions.some(inside);
  }
  function drawManual(){
    if(st.manualLayer)st.map.removeLayer(st.manualLayer);st.manualLayer=L.featureGroup();
    st.manualPoints.forEach((p,i)=>L.marker([p.lat,p.lng],{draggable:true,icon:L.divIcon({className:'waypoint-pin',html:`<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:${pointSafe(p)?'#087f5b':'#dc3545'};color:white;border:2px solid white">${i+1}</span>`,iconSize:[26,26],iconAnchor:[13,13]})}).bindTooltip('Điểm '+(i+1),{permanent:true}).on('click',()=>editPoint(i)).on('dragend',e=>{const point=e.target.getLatLng();p.lat=point.lat;p.lng=point.lng;invalidate();drawManual();}).addTo(st.manualLayer));
    if(st.manualPoints.length>1)L.polyline(st.manualPoints.map(p=>[p.lat,p.lng]),{color:'#0d6e6e',dashArray:'5 5'}).addTo(st.manualLayer);
    if(st.root.querySelector('[name=fp-kind]:checked')?.value==='POINTS'&&st.manualSource)st.manualLayer.addTo(st.map);
    const box=st.root.querySelector('#gis-fp-manual-list');if(box)box.innerHTML=st.manualPoints.length?'<div class="tbl-wrap"><table class="ui-table"><thead><tr><th>Điểm / tọa độ</th><th>Cao / tốc độ / dừng</th><th></th></tr></thead><tbody>'+st.manualPoints.map((p,i)=>`<tr><td><button type="button" class="btn sm" data-fp-edit="${i}">#${i+1}</button> ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</td><td>${p.altitude_m??30}m · ${p.speed_mps??3}m/s · ${p.hover_seconds??1}s</td><td><button type="button" class="btn sm" data-fp-move="${i}" data-direction="-1" ${i===0?'disabled':''}>↑</button><button type="button" class="btn sm" data-fp-move="${i}" data-direction="1" ${i===st.manualPoints.length-1?'disabled':''}>↓</button><button type="button" class="btn sm" data-fp-delete="${i}">Xóa</button></td></tr>`).join('')+'</tbody></table></div>':'<p class="gis-empty">Bật chọn điểm, bấm bản đồ để thêm; bấm marker để chỉnh thông số riêng.</p>';
  }
  let fenceLayer=null,fenceMode=null,fenceData={boundary:null,exclusions:[]};
  function drawFence(){if(fenceLayer)st.map.removeLayer(fenceLayer);fenceLayer=L.featureGroup();if(fenceData.boundary)L.geoJSON(fenceData.boundary,{style:{color:'#0c9470',fillOpacity:.04}}).addTo(fenceLayer);for(const p of fenceData.exclusions)L.geoJSON(p,{style:{color:'#dc3545',fillOpacity:.18}}).addTo(fenceLayer);fenceLayer.addTo(st.map);drawManual();}
  async function loadFence(){if(!st.tree?.plant?.plant_id)return;const r=await GIS.api('GET','/api/flight-plans/geofence/'+st.tree.plant.plant_id);const parse=g=>typeof g==='string'?JSON.parse(g):g;fenceData={boundary:parse(r.data.boundary),exclusions:r.data.exclusions.map(e=>parse(e.polygon_geojson))};drawFence();}
  function renderForm() {
    const kind = st.root.querySelector('[name="fp-kind"]:checked').value;
    const box = st.root.querySelector('#gis-fp-target');
    if (kind === 'GRID') {
      const areas = st.tree ? st.tree.areas : [];
      const plant = st.tree ? st.tree.plant : null;
      const plantReady = Boolean(plant && plant.boundary_geojson);
      const ready = areas.filter(a => a.has_polygon);
      box.innerHTML = `<div class="field"><label for="gis-fp-area">Khu pin</label><select class="input" id="gis-fp-area">
        ${ready.length || plantReady ? '' : '<option value="">-- Chưa có khu nào vẽ ranh giới --</option>'}
        ${plantReady ? `<option value="plant:${plant.plant_id}">Toàn nhà máy ${esc(plant.plant_code)} (theo ranh giới nhà máy – dùng cho quét bản đồ 2D)</option>` : ''}
        ${areas.map(a => `<option value="${a.area_id}" ${a.has_polygon ? '' : 'disabled'} ${a === ready[0] ? 'selected' : ''}>${esc(a.area_code)} – ${esc(a.area_name)}${a.has_polygon ? '' : ' (chưa vẽ ranh giới)'}</option>`).join('')}
      </select></div>
      ${ready.length || plantReady ? '' : '<div class="gis-warn">Tuyến quét lưới cần ranh giới khu hoặc nhà máy. Vào <b>Nhà máy & thiết bị kiểm tra</b> → chọn khu → <b>Vẽ ranh giới</b> → Lưu.</div>'}`;
    } else {
      box.innerHTML = `<div class="gis-row"><label class="gis-check"><input type="radio" name="fp-source" value="manual" ${st.manualSource?'checked':''}> Chọn trực tiếp trên bản đồ</label><label class="gis-check"><input type="radio" name="fp-source" value="assets" ${!st.manualSource?'checked':''}> Điểm tài sản có sẵn</label></div>`+(st.manualSource?`<div class="gis-row"><button class="btn" id="gis-fp-pick" type="button" aria-pressed="${st.picking}">${st.picking?'Dừng chọn điểm':'Chọn điểm trên bản đồ'}</button><button class="btn" id="gis-fp-clear" type="button">Xóa các điểm</button></div><div class="gis-grid3"><label>Độ cao (m)<input class="input" id="gis-fp-alt" type="number" min="2" max="500" value="30"></label><label>Gimbal (°)<input class="input" id="gis-fp-pitch" type="number" min="-90" max="35" value="-90"></label><label>Dừng (s)<input class="input" id="gis-fp-hover" type="number" min="0" max="120" value="1"></label></div><p class="faint">Bấm từng marker để chỉnh tốc độ, lens, độ cao và dừng riêng. Độ cao so với điểm cất cánh. Mỗi điểm: tới vị trí → chỉnh camera → dừng → chụp → điểm tiếp theo; tốc độ và lens lấy từ hồ sơ chụp.</p><div id="gis-fp-manual-list"></div>`:`<div class="field"><span class="gis-field-label">Chọn ngăn lộ / DCL có điểm chụp đã khai báo</span><div class="gis-tgt-list">${targetList()}</div></div>`);
    }
    drawManual();
    st.root.querySelector('#gis-fp-profile').innerHTML = profileOptions(kind) || '<option value="">Tùy chỉnh từng waypoint</option>';
  }

  function readBody() {
    const kind = st.root.querySelector('[name="fp-kind"]:checked').value;
    const body = { plant_id:st.tree?.plant?.plant_id, profile_id: st.root.querySelector('#gis-fp-profile').value, route_name: st.root.querySelector('#gis-fp-name').value.trim() };
    const tk = st.root.querySelector('#gis-fp-ticket').value;
    if (tk) body.ticket_id = tk;
    if (kind === 'GRID') {
      const val = (st.root.querySelector('#gis-fp-area') || {}).value || '';
      if (val.startsWith('plant:')) body.plant_id = val.slice(6);
      else body.area_id = val;
    }
    else if(st.manualSource)body.points=st.manualPoints.map(p=>({...p,altitude_m:p.altitude_m??Number(st.root.querySelector('#gis-fp-alt').value),gimbal_pitch:p.gimbal_pitch??Number(st.root.querySelector('#gis-fp-pitch').value),hover_seconds:p.hover_seconds??Number(st.root.querySelector('#gis-fp-hover').value)}));
    else body.targets = [...st.root.querySelectorAll('.gis-tgt input:checked')].map(i => ({ asset_type: i.dataset.type, asset_id: Number(i.value) }));
    return body;
  }

  function drawPlan(plan) {
    if (st.previewLayer) st.map.removeLayer(st.previewLayer);
    const g = L.featureGroup();
    const coords = plan.geojson.path.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(coords, { color: '#e59a0c', weight: 3 }).addTo(g);
    if (coords.length) {
      L.circleMarker(coords[0], { radius: 7, color: '#2f9e74', fillOpacity: 1 }).bindTooltip('Bắt đầu').addTo(g);
      L.circleMarker(coords[coords.length - 1], { radius: 7, color: '#cf2f5e', fillOpacity: 1 }).bindTooltip('Kết thúc').addTo(g);
    }
    plan.geojson.points.forEach((p, i) => {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#38bdf8', fillOpacity: 1 })
        .bindTooltip(`#${i + 1} ${esc(p.label)} · ${esc(p.altitude_m)} m`).addTo(g);
    });
    g.addTo(st.map);
    st.previewLayer = g;
    if (g.getBounds().isValid()) st.map.fitBounds(g.getBounds(), { padding: [30, 30], maxZoom: 20 });
  }

  function renderStats(plan) {
    const info=st.root.querySelector('#gis-fp-info');if(info)info.disabled=false;
    const s = plan.stats;
    const geo = plan.geometry || {};
    st.root.querySelector('#gis-fp-stats').innerHTML = `
      <dl class="kv gis-geo">
        ${plan.kind === 'GRID' ? `<dt>Độ cao</dt><dd><b>${esc(geo.altitude_m)}</b> m</dd>
          <dt>Độ phân giải</dt><dd>${Object.entries(geo.gsd_cm || {}).map(([l, v]) => `${esc(l)} ${esc(v)} cm`).join(' · ')}</dd>
          <dt>Hướng bay</dt><dd>${esc(plan.heading_deg)}°</dd>
          <dt>Số đường bay</dt><dd>${esc(s.line_count)} (cách ${esc(geo.line_spacing_m)} m)</dd>
          <dt>Chụp mỗi</dt><dd>${esc(geo.trigger_distance_m)} m</dd>` : `<dt>Số điểm chụp</dt><dd>${esc(s.point_count)}</dd>`}
        <dt>Quãng đường</dt><dd>${esc(s.distance_m)} m</dd>
        <dt>Số ảnh (mỗi camera)</dt><dd><b>${esc(s.photo_count)}</b></dd>
        <dt>Thời gian bay</dt><dd>${fmtTime(s.duration_s)}</dd>
        <dt>Số pin</dt><dd>${esc(s.batteries)}</dd>
      </dl>
      ${(plan.warnings || []).map(w => `<div class="gis-warn">⚠ ${esc(w)}</div>`).join('')}`;
  }

  /** Kiểm tra ngay trên trình duyệt để báo lỗi dễ hiểu trước khi gọi server. */
  function checkBody(body) {
    if (!body.profile_id) return 'Chưa có hồ sơ chụp phù hợp. Tạo ở tab Hồ sơ chụp.';
    if ('area_id' in body && !body.area_id) return 'Chọn khu pin đã vẽ ranh giới';
    if(body.points&&body.points.length<2)return 'Bật Chọn điểm trên bản đồ và bấm ít nhất 2 vị trí, rồi Xem trước.';
    if (body.targets && !body.targets.length) return 'Tick chọn ít nhất 1 ngăn lộ hoặc dao cách ly';
    return null;
  }

  async function preview() {
    const body = readBody();
    const problem = checkBody(body);
    if (problem) { st.root.querySelector('.gis-fp-form').scrollIntoView({block:'nearest'});GIS.toast(problem, 'error'); return; }
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans/preview', body));
    if (!res) return;
    st.lastPreview = res.data;
    drawPlan(res.data);
    renderStats(res.data);
    st.root.querySelector('#gis-fp-create').disabled = false;
  }

  async function create() {
    const body = readBody();
    const problem = checkBody(body) || (!body.route_name ? 'Nhập tên đường bay' : null);
    if (problem) { st.root.querySelector('.gis-fp-form').scrollIntoView({block:'nearest'});GIS.toast(problem, 'error'); return; }
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans', body));
    if (!res) return;
    GIS.toast(res.message);
    loadRoutes();
  }

  async function loadRoutes() {
    const res = await GIS.run(() => GIS.api('GET', '/api/flight-plans'));
    st.routes = res ? res.data : [];
    st.root.style.setProperty('--fp-list-height',st.routes.length?(Math.min(3,st.routes.length)*50+170)+'px':'110px');
    st.root.querySelector('#gis-fp-routes').innerHTML = st.routes.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Tên</th><th class="fp-metric">Kiểu</th><th class="fp-secondary">Hồ sơ</th><th class="fp-metric">Ảnh</th><th class="fp-metric">Thời gian</th><th class="fp-secondary">Phiếu</th><th></th></tr></thead>
      <tbody>${st.routes.map(r => `<tr data-id="${r.route_id}">
        <td><b title="${esc(r.route_name)}">${esc(r.route_name)}</b><div class="faint">${esc(r.target_area || '')} · ${esc(new Date(r.created_at).toLocaleString('vi-VN'))}</div></td>
        <td class="fp-metric">${r.route_kind === 'GRID' ? 'Quét lưới' : r.route_kind === 'POINTS' ? 'Điểm' : 'Vẽ tay'}</td>
        <td class="fp-secondary">${esc(r.profile_name || '')}</td>
        <td class="num fp-metric">${esc(r.photo_count ?? '')}</td>
        <td class="num fp-metric">${r.duration_s ? fmtTime(r.duration_s) : ''}</td>
        <td class="fp-secondary"><div class="gis-row gis-tk-chips">${(r.tickets || []).map(t => `<span class="gis-chip gis-tk-chip">${esc(t.ticket_code)} <button type="button" data-act="untk" data-tk="${t.ticket_id}" aria-label="Bỏ gán phiếu">×</button></span>`).join('')}
          <select class="input gis-tk-add" aria-label="Gán vào phiếu"><option value="">+ gán phiếu</option>${st.tickets.filter(t => !(r.tickets || []).some(x => x.ticket_id === t.ticket_id)).map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)}</option>`).join('')}</select></div></td>
        <td class="gis-row"><button class="btn sm" data-act="show">Xem</button><button class="btn sm" type="button" data-act="details">Chi tiết</button><a class="btn sm fp-secondary-action" href="${esc(r.kmz_url)}" download>KMZ</a><button class="btn sm danger fp-secondary-action" data-act="del">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="gis-empty">Chưa có đường bay nào.</div>';
  }

  async function onRoutesClick(e) {
    const row = e.target.closest('tr[data-id]');
    const act = e.target.closest('[data-act]');
    if (!row || !act) return;
    const id = Number(row.dataset.id);
    if(act.dataset.act==='details'){
      const detail=document.createElement('div');detail.className='fp-record-detail';detail.dataset.compactInline='1';const table=document.createElement('table');table.dataset.noPaging='1';const body=document.createElement('tbody');
      ['Đường bay','Kiểu','Hồ sơ chụp','Số ảnh','Thời gian','Gán vào phiếu','Thao tác'].forEach((label,i)=>{const tr=document.createElement('tr');tr.dataset.id=String(id);const th=document.createElement('th'),td=document.createElement('td');th.textContent=label;const cloned=row.cells[i].cloneNode(true);while(cloned.firstChild)td.append(cloned.firstChild);td.querySelector('[data-act=details]')?.remove();tr.append(th,td);body.append(tr);});table.append(body);detail.append(table);st.root.querySelector('#gis-fp-routes').append(detail);GIS.Compact.reveal(detail,'Chi tiết đường bay');detail.closest('dialog').addEventListener('close',()=>detail.remove(),{once:true});return;
    }
    if (act.dataset.act === 'show') {
      const res = await GIS.run(() => GIS.api('GET', `/api/flight-plans/${id}`));
      if (res && res.data.plan) { drawPlan(res.data.plan); renderStats(res.data.plan); }
    }
    if (act.dataset.act === 'untk') {
      const res = await GIS.run(() => GIS.api('DELETE', `/api/flight-plans/${id}/tickets/${act.dataset.tk}`), 'Đã bỏ gán phiếu');
      if (res) loadRoutes();
      return;
    }
    if (act.dataset.act === 'del') {
      if (!window.confirm('Xóa đường bay này (kèm file KMZ)?')) return;
      const res = await GIS.run(() => GIS.api('DELETE', `/api/flight-plans/${id}`), 'Đã xóa đường bay');
      if (res) loadRoutes();
    }
  }

  async function initMap() {
    const plant = await GIS.getPlant();
    const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [16.0, 108.0];
    st.map = L.map(st.root.querySelector('#gis-fp-map'), { center, zoom: 17, maxZoom: 22 });
    const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
    if (sat) L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
    st.map.on('click',e=>{if(!st.picking||!st.manualSource||st.root.querySelector('[name=fp-kind]:checked')?.value!=='POINTS'||e.originalEvent?.target?.closest('.leaflet-control'))return;if(st.manualPoints.length>=500){GIS.toast('Tối đa 500 điểm mỗi tuyến','error');return;}st.manualPoints.push({lat:e.latlng.lat,lng:e.latlng.lng});invalidate();drawManual();});
    st.map.on('pm:create',e=>{if(!fenceMode)return;const g=e.layer.toGeoJSON().geometry;st.map.removeLayer(e.layer);if(fenceMode==='boundary')fenceData.boundary=g;else fenceData.exclusions.push(g);fenceMode=null;st.picking=false;drawFence();invalidate();});
    loadFence().catch(e=>GIS.toast(e.message,'error'));
    st.root.querySelectorAll('[data-fence]').forEach(b=>b.onclick=()=>{st.picking=false;fenceMode=b.dataset.fence;if(!st.map.pm)return GIS.toast('Chưa tải công cụ vẽ','error');st.map.pm.enableDraw('Polygon');});
    st.root.querySelector('#fp-fence-save').onclick=()=>GIS.run(async()=>{await GIS.api('PUT','/api/flight-plans/geofence/'+st.tree.plant.plant_id,fenceData);GIS.toast('Đã lưu vùng an toàn');});
    GIS.attachMap(st.map, { kind: 'solar', visible: ['areas', 'strings', 'substations', 'disconnectors', 'photo_points'] });
  }

  GIS.FlightPlans = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-fp">
            <section class="card gis-fp-form">
              <h3>Waypoint Mavic 3T</h3>
              <p class="faint">Chọn khu hoặc tài sản và hồ sơ chụp. Phần mềm tự tính đường bay và lệnh chụp, tạo file KMZ.
                File xuất hiện trong thư viện đường bay của DJI Pilot 2 (hoặc tải về nạp tay).</p>
              <div class="gis-row">
                <label class="gis-check"><input type="radio" name="fp-kind" value="GRID"> Quét lưới khu pin</label>
                <label class="gis-check"><input type="radio" name="fp-kind" value="POINTS" checked> Chụp tại điểm (DCL, cận lỗi)</label>
              </div>
              <div class="actions"><button type="button" class="btn sm" data-fence="boundary">Vẽ ranh giới</button><button type="button" class="btn sm" data-fence="excluded">Vẽ vùng cấm</button><button type="button" class="btn sm" id="fp-fence-save">Lưu vùng an toàn</button></div><p class="faint">Dùng ranh giới đo thực tế; phần mềm không tự suy diện tích 51,27 ha.</p><div id="gis-fp-target"></div>
              <div class="field"><label for="gis-fp-profile">Hồ sơ chụp</label><select class="input" id="gis-fp-profile"></select></div>
              <div class="field"><label for="gis-fp-ticket">Gán vào phiếu (tùy chọn)</label><select class="input" id="gis-fp-ticket"></select></div>
              <div class="field"><label for="gis-fp-name">Tên đường bay</label><input class="input" id="gis-fp-name" placeholder="VD: Quét nhiệt INV-01 tháng 11"></div>
              <div class="gis-row">
                <button class="btn" type="button" id="gis-fp-preview">🔍 Xem trước</button>
                <button class="btn primary" type="button" id="gis-fp-create" disabled>💾 Tạo đường bay (KMZ)</button>
              </div>
              <div id="gis-fp-stats"></div>
            </section>
            <section class="gis-fp-mapbox"><div id="gis-fp-map"></div></section>
          </div>
          <section class="card flat gis-fp-list"><h3 class="gis-fp-list-title">Đường bay đã tạo</h3><div id="gis-fp-routes"></div></section>`;
        root.querySelectorAll('[name="fp-kind"]').forEach(r => r.addEventListener('change', () => {
          renderForm();
          st.root.querySelector('#gis-fp-create').disabled = true;
        }));
        root.querySelector('#gis-fp-preview').addEventListener('click', preview);
        root.querySelector('#gis-fp-create').addEventListener('click', create);
        root.querySelector('#gis-fp-routes').addEventListener('click', onRoutesClick);
        root.querySelector('#gis-fp-routes').addEventListener('change', async e => {
          const sel = e.target.closest('.gis-tk-add');
          if (!sel || !sel.value) return;
          const id = Number(sel.closest('tr').dataset.id);
          const res = await GIS.run(() => GIS.api('POST', `/api/flight-plans/${id}/tickets`, { ticket_id: sel.value }), 'Đã gán đường bay vào phiếu');
          if (res) loadRoutes();
        });
        root.querySelector('#gis-fp-target').addEventListener('change',e=>{invalidate();if(e.target.name==='fp-source'){st.manualSource=e.target.value==='manual';st.picking=false;renderForm();}});
        root.querySelector('#gis-fp-target').addEventListener('input',invalidate);
        root.querySelector('#gis-fp-target').addEventListener('click',e=>{if(e.target.dataset.fpEdit!==undefined)editPoint(Number(e.target.dataset.fpEdit));if(e.target.id==='gis-fp-pick'){st.picking=!st.picking;e.target.setAttribute('aria-pressed',String(st.picking));e.target.textContent=st.picking?'Dừng chọn điểm':'Chọn điểm trên bản đồ';}if(e.target.id==='gis-fp-clear'){st.manualPoints=[];invalidate();drawManual();}if(e.target.dataset.fpDelete!==undefined){st.manualPoints.splice(Number(e.target.dataset.fpDelete),1);invalidate();drawManual();}if(e.target.dataset.fpMove!==undefined){const i=Number(e.target.dataset.fpMove),j=i+Number(e.target.dataset.direction);if(j>=0&&j<st.manualPoints.length){[st.manualPoints[i],st.manualPoints[j]]=[st.manualPoints[j],st.manualPoints[i]];invalidate();drawManual();}}});
        root.querySelector('#gis-fp-profile').addEventListener('change', () => { st.root.querySelector('#gis-fp-create').disabled = true; });
        await initMap();
      }
      const [profiles, tree, tickets] = await Promise.all([
        GIS.run(() => GIS.api('GET', '/api/capture-profiles')),
        GIS.run(() => GIS.api('GET', '/api/assets/tree')),
        GIS.run(() => GIS.api('GET', '/api/tickets'))
      ]);
      st.tickets = (tickets ? tickets.data : []).filter(t => ['PENDING', 'ASSIGNED', 'EXECUTING'].includes(t.status));
      st.root.querySelector('#gis-fp-ticket').innerHTML = '<option value="">(không gán)</option>' +
        st.tickets.map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)}</option>`).join('');
      st.profiles = profiles ? profiles.data : [];
      st.tree = tree ? tree.data : null;
      if(!st.root.querySelector('#gis-fp-target').childElementCount)renderForm();else{const select=st.root.querySelector('#gis-fp-profile'),selected=select.value,kind=st.root.querySelector('[name=fp-kind]:checked').value;select.innerHTML=profileOptions(kind)||'<option value="">Tùy chỉnh từng waypoint</option>';if([...select.options].some(o=>o.value===selected))select.value=selected;}
      loadRoutes();
      setTimeout(() => st.map.invalidateSize(), 60);
    }
  };
})();
