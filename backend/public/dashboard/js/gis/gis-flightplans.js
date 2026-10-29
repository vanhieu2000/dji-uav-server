/* =====================================================================
   LẬP ĐƯỜNG BAY TƯƠNG TÁC TRỰC QUAN (INTERACTIVE WAYLINE PLANNER - MAVIC 3T)
   - Tách riêng biệt: Tạo trước các đường bay mẫu (Wayline Templates).
   - Click trực tiếp trên bản đồ vệ tinh để thả Waypoint #1, #2, #3...
   - Kéo thả Marker (draggable) để tinh chỉnh tọa độ chính xác.
   - Popup từng điểm: Độ cao (35m), Tốc độ (3m/s), Gimbal Pitch (-90°/0°), Dừng 1s chụp RGB+IR.
   - Ranh giới Geofence và vùng cấm lấy từ dữ liệu nhà máy đã lưu.
   - Đóng gói KMZ chuẩn DJI WPML (Drone 77/1, Payload 67/0/0) nạp vào Pilot 2.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = {
    root: null,
    map: null,
    waypoints: [],       // [{ lat, lng, altitude_m, gimbal_pitch, speed_mps, hover_seconds }]
    markers: [],
    polyline: null,
    geofenceLayer: null,
    previewLayer: null,
    picking: false,
    profiles: [],
    tickets: [],
    routes: []
  };

  let plants=[],maps=[],baseLayer=null,fenceMode=null,fence={boundary:null,exclusions:[]};
  const parseGeometry=g=>typeof g==='string'?JSON.parse(g):g;
  const fmtTime = s => `${Math.floor(s / 60)} phút ${Math.round(s % 60)} giây`;

  // Kiểm tra điểm có nằm trong đa giác Geofence không (Ray-casting algorithm)
  function isInsideGeofence(lat, lng) {
    if(!fence.boundary)return false;
    const hit=ring=>{let ok=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>lat)!==(yj>lat)&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)ok=!ok;}return ok;};
    const contains=g=>hit(g.coordinates[0])&&!g.coordinates.slice(1).some(hit);
    const inside=contains(fence.boundary)&&!fence.exclusions.some(contains);
    return inside;
  }

  // Tính khoảng cách giữa 2 tọa độ (mét - Haversine)
  function calcDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Vẽ lại toàn bộ Waypoints, Polyline và cập nhật bảng tính toán
  function refreshMapWaypoints() {
    // 1. Dọn dẹp markers cũ
    st.markers.forEach(m => st.map.removeLayer(m));
    st.markers = [];
    if (st.polyline) { st.map.removeLayer(st.polyline); st.polyline = null; }

    const latlngs = [];
    let totalDist = 0;
    let hasOutsideGeofence = false;

    // 2. Tạo Marker cho từng điểm
    st.waypoints.forEach((wp, idx) => {
      const pt = [wp.lat, wp.lng];
      latlngs.push(pt);
      if (idx > 0) {
        totalDist += calcDistanceMeters(st.waypoints[idx-1].lat, st.waypoints[idx-1].lng, wp.lat, wp.lng);
      }

      const inFence = isInsideGeofence(wp.lat, wp.lng);
      if (!inFence) hasOutsideGeofence = true;

      // Icon số thứ tự Waypoint
      const markerColor = inFence ? '#0284c7' : '#ef4444';
      const icon = L.divIcon({
        className: 'wp-custom-marker',
        html: `<div style="background:${markerColor};color:#fff;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:bold;font-size:12px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5);cursor:grab">${idx + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker(pt, { icon, draggable: true }).addTo(st.map);

      // Kéo thả marker để tinh chỉnh tọa độ
      marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        wp.lat = Number(newPos.lat.toFixed(7));
        wp.lng = Number(newPos.lng.toFixed(7));
        refreshMapWaypoints();
      });

      // Popup cấu hình chi tiết cho từng điểm
      const popupHtml = `
        <div style="font-family:sans-serif;min-width:210px;font-size:12px;color:#1e293b">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;color:${markerColor}">
            📍 Waypoint #${idx + 1} ${inFence ? '' : '<span style="color:#ef4444;font-size:10px">(Ngoài Geofence)</span>'}
          </div>
          <label>Ảnh lưu<select id="pop-lenses-${idx}"><option value="wide,ir" ${!wp.lenses||wp.lenses==='wide,ir'?'selected':''}>Wide + IR</option><option value="wide" ${wp.lenses==='wide'?'selected':''}>Wide</option><option value="ir" ${wp.lenses==='ir'?'selected':''}>IR</option><option value="zoom" ${wp.lenses==='zoom'?'selected':''}>Zoom</option></select></label>
          <div style="margin-bottom:4px"><b>Tọa độ:</b> ${wp.lat.toFixed(6)}, ${wp.lng.toFixed(6)}</div>
          <div style="margin-bottom:6px">
            <label style="display:block;margin-bottom:2px"><b>Độ cao bay (m):</b></label>
            <input type="number" id="pop-alt-${idx}" class="input" style="width:100%;padding:3px;font-size:11px" value="${wp.altitude_m || 35}" min="5" max="300">
          </div>
          <div style="margin-bottom:6px">
            <label style="display:block;margin-bottom:2px"><b>Góc Gimbal Pitch:</b></label>
            <select id="pop-gimbal-${idx}" class="input" style="width:100%;padding:3px;font-size:11px">
              <option value="-90" ${wp.gimbal_pitch === -90 ? 'selected' : ''}>-90° (Soi thẳng mặt pin)</option>
              <option value="0" ${wp.gimbal_pitch === 0 ? 'selected' : ''}>0° (Soi ngang DCL / Trạm)</option>
              <option value="-45" ${wp.gimbal_pitch === -45 ? 'selected' : ''}>-45° (Góc chéo cận cảnh)</option>
            </select>
          </div>
          <div style="margin-bottom:8px">
            <label style="display:block;margin-bottom:2px"><b>Dừng tại điểm (s):</b></label>
            <input type="number" id="pop-hover-${idx}" class="input" style="width:100%;padding:3px;font-size:11px" value="${wp.hover_seconds !== undefined ? wp.hover_seconds : 1}" min="0" max="60">
          </div>
          <div style="display:flex;justify-content:space-between;gap:6px">
            <button class="btn sm primary" style="flex:1;padding:3px 6px;font-size:11px" onclick="window.GIS_FP_UPDATE_WP(${idx})">Lưu</button>
            <button class="btn sm danger" style="padding:3px 6px;font-size:11px" onclick="window.GIS_FP_DELETE_WP(${idx})">Xóa</button>
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      st.markers.push(marker);
    });

    // 3. Vẽ Polyline nối các Waypoints
    if (latlngs.length > 1) {
      st.polyline = L.polyline(latlngs, {
        color: '#f59e0b',
        weight: 3.5,
        dashArray: '6, 6',
        opacity: 0.9
      }).addTo(st.map);
    }

    // 4. Cập nhật thống kê và danh sách điểm UI
    updateStatsAndList(totalDist, hasOutsideGeofence);
  }

  // Cập nhật thống kê tuyến bay & bảng danh sách
  function updateStatsAndList(distMeters, hasOutsideGeofence) {
    const wpCount = st.waypoints.length;
    const estTimeSec = (distMeters / 3.0) + (wpCount * 2.0); // Tốc độ ~3m/s + thời gian dừng chụp
    const photoCount = wpCount * 2; // Mavic 3T chụp kép Wide RGB + Thermal RJPEG

    const statsBox = st.root.querySelector('#gis-fp-stats');
    if (statsBox) {
      statsBox.innerHTML = `
        <div style="background:rgba(15,23,42,0.85);border:1px solid #334155;border-radius:8px;padding:10px;margin-top:10px;font-size:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;line-height:1.6">
            <div>📍 Số điểm: <b>${wpCount}</b> điểm</div>
            <div>📏 Chiều dài: <b>${Math.round(distMeters)} m</b></div>
            <div>⏱ Thời gian: <b>${fmtTime(estTimeSec)}</b></div>
            <div>📸 Tổng ảnh (RGB+IR): <b>${photoCount} ảnh</b></div>
          </div>
          ${hasOutsideGeofence ? '<div style="margin-top:6px;color:#ef4444;font-weight:600">⚠️ Cảnh báo: Có waypoint ngoài vùng an toàn, trong vùng cấm hoặc chưa có ranh giới.</div>' : '<div style="margin-top:6px;color:#10b981">✓ Các điểm nằm trong vùng đã lưu. Máy chủ sẽ kiểm tra cả đoạn nối khi lưu tuyến.</div>'}
        </div>
      `;
    }

    const listBox = st.root.querySelector('#gis-fp-manual-list');
    if (listBox) {
      if (!wpCount) {
        listBox.innerHTML = '<p class="gis-empty" style="padding:12px;text-align:center">Bấm nút <b>➕ Thêm Waypoint</b> ở trên, rồi click trực tiếp lên bản đồ vệ tinh để thả các điểm bay.</p>';
      } else {
        listBox.innerHTML = `
          <div class="tbl-wrap" style="max-height:180px;overflow-y:auto;border:1px solid #334155;border-radius:6px;margin-top:8px">
            <table class="ui-table" style="font-size:11px;width:100%" data-no-paging>
              <thead><tr><th>#</th><th>Tọa độ</th><th>Độ cao</th><th>Gimbal</th><th>Dừng</th><th></th></tr></thead>
              <tbody>
                ${st.waypoints.map((wp, i) => `
                  <tr>
                    <td><b>${i + 1}</b></td>
                    <td>${wp.lat.toFixed(5)}<br>${wp.lng.toFixed(5)}</td>
                    <td>${wp.altitude_m || 35} m</td>
                    <td>${wp.gimbal_pitch !== undefined ? wp.gimbal_pitch : -90}°</td>
                    <td>${wp.hover_seconds !== undefined ? wp.hover_seconds : 1}s</td>
                    <td style="white-space:nowrap">
                      <button type="button" class="btn sm" onclick="window.GIS_FP_MOVE_WP(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
                      <button type="button" class="btn sm" onclick="window.GIS_FP_MOVE_WP(${i}, 1)" ${i === wpCount - 1 ? 'disabled' : ''}>↓</button>
                      <button type="button" class="btn sm danger" onclick="window.GIS_FP_DELETE_WP(${i})">✕</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    // Nút tạo KMZ chỉ enable khi có ít nhất 2 điểm
    const createBtn = st.root.querySelector('#gis-fp-create');
    if (createBtn) createBtn.disabled = (wpCount < 2);
  }

  // Toàn cục để các nút trong Leaflet Popup và Table gọi được
  window.GIS_FP_UPDATE_WP = function(idx) {
    st.waypoints[idx].lenses=document.getElementById(`pop-lenses-${idx}`)?.value||'wide,ir';
    const altInput = document.getElementById(`pop-alt-${idx}`);
    const gimbalInput = document.getElementById(`pop-gimbal-${idx}`);
    const hoverInput = document.getElementById(`pop-hover-${idx}`);
    if (altInput && st.waypoints[idx]) {
      st.waypoints[idx].altitude_m = Number(altInput.value) || 35;
      st.waypoints[idx].gimbal_pitch = Number(gimbalInput.value);
      st.waypoints[idx].hover_seconds = Number(hoverInput.value) || 1;
      st.map.closePopup();
      refreshMapWaypoints();
      GIS.toast(`Đã cập nhật thông số Waypoint #${idx + 1}`);
    }
  };

  window.GIS_FP_DELETE_WP = function(idx) {
    st.waypoints.splice(idx, 1);
    st.map.closePopup();
    refreshMapWaypoints();
  };

  window.GIS_FP_MOVE_WP = function(idx, dir) {
    const target = idx + dir;
    if (target >= 0 && target < st.waypoints.length) {
      const temp = st.waypoints[idx];
      st.waypoints[idx] = st.waypoints[target];
      st.waypoints[target] = temp;
      refreshMapWaypoints();
    }
  };

  // Khởi tạo bản đồ vệ tinh & lớp Geofence Thác Mơ
  async function initMap() {
    const plant=plants[0],center=plant?.center_lat!=null?[plant.center_lat,plant.center_lng]:[16,108];
    st.map=L.map(st.root.querySelector('#gis-fp-map'),{center,zoom:plant?17:6,maxZoom:22});
    setPlannerMap('satellite');
    st.map.on('pm:create',e=>{if(!fenceMode)return;const g=e.layer.toGeoJSON().geometry;st.map.removeLayer(e.layer);if(fenceMode==='boundary')fence.boundary=g;else fence.exclusions.push(g);fenceMode=null;drawFence();refreshMapWaypoints();});
    // Sự kiện Click trên bản đồ để thêm Waypoint
    st.map.on('click', (e) => {
      if (!st.picking) return;
      if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('.leaflet-control')) return;

      if (st.waypoints.length >= 500) {
        GIS.toast('Tối đa 500 điểm mỗi tuyến bay', 'error');
        return;
      }

      // Mặc định: Độ cao 35m, Gimbal -90° (soi pin), Tốc độ 3m/s, Dừng 1s chụp ảnh
      st.waypoints.push({
        lat: Number(e.latlng.lat.toFixed(7)),
        lng: Number(e.latlng.lng.toFixed(7)),
        altitude_m: 35,
        gimbal_pitch: -90,
        speed_mps: 3,
        hover_seconds: 1
      });

      refreshMapWaypoints();
    });

    GIS.attachMap(st.map, { kind: 'solar', visible: ['areas', 'strings', 'substations', 'disconnectors', 'photo_points'] });
  }

  function drawFence(){if(st.geofenceLayer)st.map.removeLayer(st.geofenceLayer);st.geofenceLayer=L.featureGroup();if(fence.boundary)L.geoJSON(fence.boundary,{style:{color:'#10b981',fillOpacity:.04}}).addTo(st.geofenceLayer);for(const g of fence.exclusions)L.geoJSON(g,{style:{color:'#dc3545',fillOpacity:.15}}).addTo(st.geofenceLayer);st.geofenceLayer.addTo(st.map);}
  async function loadFence(){const id=st.root.querySelector('#gis-fp-plant').value;fence={boundary:null,exclusions:[]};if(id){const d=(await GIS.api('GET','/api/flight-plans/geofence/'+id)).data;fence={boundary:parseGeometry(d.boundary),exclusions:d.exclusions.map(r=>parseGeometry(r.polygon_geojson))};const p=plants.find(p=>p.plant_id===Number(id));if(p?.center_lat!=null)st.map.setView([p.center_lat,p.center_lng],17);}drawFence();refreshMapWaypoints();}
  function setPlannerMap(id){if(baseLayer)st.map.removeLayer(baseLayer);const m=maps.find(m=>String(m.map_id)===id),cfg=typeof BASEMAPS!=='undefined'?BASEMAPS.satellite:null;if(m){baseLayer=L.tileLayer(m.tile_url,{maxZoom:22,maxNativeZoom:m.max_zoom,tms:m.scheme?.toUpperCase()==='TMS'});if(m.bounds)st.map.fitBounds(m.bounds);}else if(cfg)baseLayer=L.tileLayer(cfg.url,{maxZoom:22,maxNativeZoom:cfg.native,attribution:cfg.attr});baseLayer?.addTo(st.map);}
  async function editRoute(id){switchView('flight-plan-edit');const r=(await GIS.api('GET','/api/flight-plans/'+id)).data,plan=r.plan,points=plan?.geojson?.points;if(!points?.length)throw Error('Tuyến cũ chưa có cấu hình từng điểm; tạo bản mới từ file gốc.');st.waypoints=points.map(p=>({...p}));st.root.querySelector('#gis-fp-name').value=r.route_name+' — phiên bản mới';if(r.target_plant_id)st.root.querySelector('#gis-fp-plant').value=r.target_plant_id;await loadFence();refreshMapWaypoints();GIS.toast('Đã nạp mẫu. Lưu sẽ tạo phiên bản mới, không đổi tuyến đã gắn phiếu.');}

  // Tải danh sách đường bay mẫu đã lưu trong Thư viện
  async function loadRoutes() {
    const res = await GIS.run(() => GIS.api('GET', '/api/flight-plans'));
    st.routes = res ? res.data : [];
    const container = st.root.querySelector('#gis-fp-routes');
    if (!container) return;

    if (!st.routes.length) {
      container.innerHTML = '<div class="gis-empty" style="padding:16px;text-align:center">Chưa có đường bay mẫu nào trong thư viện. Bấm "Thêm đường bay mẫu" để mở trang thiết lập.</div>';
      return;
    }

    container.innerHTML = `
      <div class="tbl-wrap">
        <table class="ui-table" style="width:100%;font-size:12px">
          <thead>
            <tr>
              <th>Tên đường bay mẫu</th>
              <th>Kiểu tuyến</th>
              <th>Số ảnh dự kiến</th>
              <th>Thời gian bay</th>
              <th>Ngày tạo</th>
              <th style="text-align:right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            ${st.routes.map(r => `
              <tr data-id="${r.route_id}">
                <td>
                  <b style="color:#0284c7;font-size:12.5px">📍 ${esc(r.route_name)}</b>
                  <div class="faint" style="font-size:10px">${esc(r.target_area || 'Chưa gán khu vực')}</div>
                </td>
                <td><span class="tag info">${r.route_kind === 'POINTS' ? 'Vẽ tay tương tác' : 'Quét lưới'}</span></td>
                <td><b>${esc(r.photo_count ?? 0)}</b> ảnh</td>
                <td>${r.duration_s ? fmtTime(r.duration_s) : '--'}</td>
                <td class="faint" style="font-size:11px">${esc(new Date(r.created_at).toLocaleString('vi-VN'))}</td>
                <td style="text-align:right;white-space:nowrap">
                  <a class="btn sm" href="${esc(r.kmz_url)}" download style="background:#0d6e6e;color:#fff;text-decoration:none;padding:3px 8px">📦 Tải KMZ</a>
                  <button type="button" class="btn sm" data-act="edit">Sửa / phiên bản mới</button><button class="btn sm danger" data-act="del" style="padding:3px 8px">Xóa</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // Tạo và đóng gói file KMZ Mavic 3T WPML lưu vào Thư viện
  async function createKmzRoute() {
    if (st.waypoints.length < 2) {
      GIS.toast('Cần ít nhất 2 Waypoint để tạo đường bay!', 'error');
      return;
    }

    const nameInput = st.root.querySelector('#gis-fp-name');
    const routeName = (nameInput && nameInput.value.trim()) || `Tuyến kiểm tra ${new Date().toLocaleDateString('vi-VN')}`;
    const profileSelect = st.root.querySelector('#gis-fp-profile');
    const profileId = profileSelect ? profileSelect.value : (st.profiles[0] && st.profiles[0].profile_id);

    const payload = {
      plant_id:Number(st.root.querySelector('#gis-fp-plant').value)||null,
      profile_id: profileId||null,
      route_name: routeName,
      points: st.waypoints.map((wp, i) => ({
        lat: wp.lat,
        lng: wp.lng,
        altitude_m: wp.altitude_m || 35,
        gimbal_pitch: wp.gimbal_pitch !== undefined ? wp.gimbal_pitch : -90,
        speed_mps: wp.speed_mps || 3,
        hover_seconds: wp.hover_seconds !== undefined ? wp.hover_seconds : 1,
        lenses:wp.lenses||'wide,ir',
        aircraft_heading: wp.aircraft_heading??null,
        label: `WP_${i + 1}`
      }))
    };

    GIS.toast('Đang đóng gói file KMZ WPML chuẩn Mavic 3T...');
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans', payload));
    if (res) {
      GIS.toast('✓ ' + (res.message || 'Đã lưu đường bay mẫu vào Thư viện thành công!'));
      loadRoutes();switchView("flight-plans");
    }
  }

  GIS.FlightPlans = {
    setEditing(edit){if(!st.root)return;st.root.classList.toggle("planner-editing",edit);setTimeout(()=>st.map?.invalidateSize(),100);},
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `<div class="planner-list-actions actions"><button type="button" class="btn primary" onclick="switchView('flight-plan-edit')">+ Thêm đường bay mẫu</button></div><div class="planner-editor-actions actions"><button type="button" class="btn" onclick="switchView('flight-plans')">← Danh sách đường bay</button></div>
          <div class="gis-fp" style="display:grid;grid-template-columns:360px 1fr;gap:12px;height:calc(100vh - 120px)">
            <!-- BẢNG ĐIỀU KHIỂN LẬP ĐƯỜNG BAY MẪU -->
            <section class="card gis-fp-form" style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding:14px">
              <div>
                <h2 style="font-size:16px;color:#0284c7;margin-bottom:4px">🛰️ Thư Viện Đường Bay Mẫu Mavic 3T</h2>
                <p class="faint" style="font-size:11px;margin:0">Tạo trước các tuyến bay chuẩn cho khu pin và dao cách ly. Sau này chỉ cần chọn tuyến khi lập phiếu.</p>
              </div>

              <div class="field"><label>Nhà máy / vùng an toàn<select class="input" id="gis-fp-plant"></select></label><label>Bản đồ nền<select class="input" id="gis-fp-basemap"></select></label></div>
              <div class="actions"><button type="button" class="btn sm" data-draw-fence="boundary">Vẽ ranh giới</button><button type="button" class="btn sm" data-draw-fence="excluded">Vẽ vùng cấm</button><button type="button" class="btn sm" id="fp-save-fence">Lưu vùng an toàn</button></div>
              <div class="field">
                <label for="gis-fp-name" style="font-size:11.5px;font-weight:600">Tên đường bay mẫu *</label>
                <input class="input" id="gis-fp-name" style="padding:6px;font-size:12px" placeholder="VD: Tuyến quét nhiệt Khu 1.1">
              </div>

              <div class="field">
                <label for="gis-fp-profile" style="font-size:11.5px;font-weight:600">Hồ sơ chụp ảnh</label>
                <select class="input" id="gis-fp-profile" style="padding:6px;font-size:12px"></select>
              </div>

              <!-- HÀNG NÚT CÔNG CỤ THAO TÁC TRÊN BẢN ĐỒ -->
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
                <button class="btn sm" id="gis-fp-pick-btn" type="button" style="background:#0284c7;color:#fff;font-weight:700;flex:1">➕ Thêm Waypoint</button>
                <button class="btn sm" id="gis-fp-undo-btn" type="button" title="Xóa điểm cuối vừa thả">🧹 Xóa cuối</button>
                <button class="btn sm danger" id="gis-fp-clear-btn" type="button" title="Xóa toàn bộ các điểm">🗑️ Xóa hết</button>
              </div>

              <!-- BẢNG THỐNG KÊ TUYẾN BAY -->
              <div id="gis-fp-stats"></div>

              <!-- NÚT TẠO KMZ -->
              <button class="btn primary" type="button" id="gis-fp-create" disabled style="padding:8px;font-weight:700;font-size:13px;margin-top:6px">💾 LƯU ĐƯỜNG BAY MẪU (KMZ)</button>

              <!-- DANH SÁCH CHI TIẾT TỪNG ĐIỂM -->
              <div id="gis-fp-manual-list" style="flex:1"></div>
            </section>

            <!-- BẢN ĐỒ VỆ TINH LEAFLET -->
            <section class="gis-fp-mapbox" style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #1e293b">
              <div id="gis-fp-map" style="width:100%;height:100%"></div>
            </section>
          </div>

          <!-- DANH SÁCH ĐƯỜNG BAY MẪU ĐÃ LƯU TRONG THƯ VIỆN -->
          <section class="card flat gis-fp-list" style="margin-top:12px">
            <h3 class="gis-fp-list-title" style="font-size:15px;margin-bottom:8px">📋 Danh sách Đường bay mẫu trong Thư viện</h3>
            <div id="gis-fp-routes"></div>
          </section>
        `;

        // Bắt sự kiện các nút
        const pickBtn = root.querySelector('#gis-fp-pick-btn');
        pickBtn.addEventListener('click', () => {
          st.picking = !st.picking;
          if (st.picking) {
            pickBtn.innerText = '⏹ Đang chọn điểm (Click bản đồ)';
            pickBtn.style.background = '#e11d48';
            GIS.toast('Chế độ chọn điểm ĐÃ BẬT: Hãy click chuột lên bản đồ để thả Waypoint');
          } else {
            pickBtn.innerText = '➕ Thêm Waypoint';
            pickBtn.style.background = '#0284c7';
          }
        });

        root.querySelector('#gis-fp-undo-btn').addEventListener('click', () => {
          if (st.waypoints.length > 0) {
            st.waypoints.pop();
            refreshMapWaypoints();
            GIS.toast('Đã xóa điểm cuối cùng');
          }
        });

        root.querySelector('#gis-fp-clear-btn').addEventListener('click', () => {
          if (!st.waypoints.length) return;
          if (confirm('Bạn có chắc chắn muốn xóa tất cả các điểm đã chọn không?')) {
            st.waypoints = [];
            refreshMapWaypoints();
          }
        });

        root.querySelector('#gis-fp-create').addEventListener('click', createKmzRoute);

        // Xóa đường bay mẫu
        root.querySelector('#gis-fp-routes').addEventListener('click', async (e) => {
          const row = e.target.closest('tr[data-id]');
          const act = e.target.closest('[data-act]');
          if (!row || !act) return;
          const id = Number(row.dataset.id);
          if(act.dataset.act==='edit'){GIS.run(()=>editRoute(id));return;}
          if (act.dataset.act === 'del') {
            if (!confirm('Bạn có chắc chắn muốn xóa đường bay mẫu này khỏi Thư viện kèm tệp KMZ?')) return;
            const res = await GIS.run(() => GIS.api('DELETE', `/api/flight-plans/${id}`), 'Đã xóa đường bay mẫu');
            if (res) loadRoutes();
          }
        });

        const context=await GIS.api('GET','/api/workspace/context');plants=context.data.plants;maps=(await GIS.api('GET','/api/basemaps')).data;
        root.querySelector('#gis-fp-plant').innerHTML='<option value="">Chọn nhà máy</option>'+plants.map(p=>`<option value="${p.plant_id}">${esc(p.plant_name)}</option>`).join('');if(plants.length===1)root.querySelector('#gis-fp-plant').value=plants[0].plant_id;
        root.querySelector('#gis-fp-basemap').innerHTML='<option value="satellite">Vệ tinh Esri</option>'+maps.map(m=>`<option value="${m.map_id}">${esc(m.map_name)}</option>`).join('');
        await initMap();await loadFence();
        root.querySelector('#gis-fp-plant').onchange=()=>GIS.run(loadFence);root.querySelector('#gis-fp-basemap').onchange=e=>setPlannerMap(e.target.value);
        root.querySelectorAll('[data-draw-fence]').forEach(b=>b.onclick=()=>{if(!st.map.pm)return GIS.toast('Chưa tải công cụ vẽ','error');st.picking=false;fenceMode=b.dataset.drawFence;st.map.pm.enableDraw('Polygon');});
        root.querySelector('#fp-save-fence').onclick=()=>GIS.run(async()=>{const id=root.querySelector('#gis-fp-plant').value;if(!id)throw Error('Chọn nhà máy trước');await GIS.api('PUT','/api/flight-plans/geofence/'+id,fence);GIS.toast('Đã lưu ranh giới và vùng cấm');});
      }

      // Nạp danh sách hồ sơ chụp
      const [profiles] = await Promise.all([
        GIS.run(() => GIS.api('GET', '/api/capture-profiles'))
      ]);

      st.profiles = (profiles ? profiles.data : []).filter(p=>p.route_kind==='POINTS');

      const profileSelect = st.root.querySelector('#gis-fp-profile');
      if (profileSelect) {
        profileSelect.innerHTML = '<option value="">Tùy chỉnh từng waypoint</option>'+st.profiles.map(p =>
          `<option value="${p.profile_id}">${esc(p.profile_name)} (${p.route_kind === 'POINTS' ? 'Dừng chụp điểm' : 'Quét lưới'})</option>`
        ).join('');
      }

      // Đặt tên mặc định nếu chưa có
      const nameInput = st.root.querySelector('#gis-fp-name');
      if (nameInput && !nameInput.value) {
        nameInput.value = `Tuyến quét nhiệt Khu 1.1 (${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')})`;
      }

      refreshMapWaypoints();
      loadRoutes();
      setTimeout(() => st.map && st.map.invalidateSize(), 100);
    }
  };
})();
