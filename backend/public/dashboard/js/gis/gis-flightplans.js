/* =====================================================================
   LẬP ĐƯỜNG BAY TƯƠNG TÁC TRỰC QUAN (INTERACTIVE WAYLINE PLANNER - MAVIC 3T)
   - Tách riêng biệt: Tạo trước các đường bay mẫu (Wayline Templates).
   - Click trực tiếp trên bản đồ vệ tinh để thả Waypoint #1, #2, #3...
   - Kéo thả Marker (draggable) để tinh chỉnh tọa độ chính xác.
   - Popup từng điểm: Độ cao (35m), Tốc độ (3m/s), Gimbal Pitch (-90°/0°), Dừng 1s chụp RGB+IR.
   - Ranh giới Geofence Nhà máy điện mặt trời Thác Mơ (51.27 ha) kèm cảnh báo an toàn.
   - Đóng gói KMZ chuẩn DJI WPML (Drone 77/1, Payload 67/0/0) nạp vào Pilot 2.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  // Ranh giới Geofence Nhà máy Thác Mơ (diện tích ~51.27 ha)
  const THAC_MO_GEOFENCE = [
    [11.8575, 106.9965],
    [11.8588, 107.0045],
    [11.8542, 107.0078],
    [11.8485, 107.0052],
    [11.8472, 106.9972]
  ];

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

  const fmtTime = s => `${Math.floor(s / 60)} phút ${Math.round(s % 60)} giây`;

  // Kiểm tra điểm có nằm trong đa giác Geofence không (Ray-casting algorithm)
  function isInsideGeofence(lat, lng) {
    const vs = THAC_MO_GEOFENCE;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > lng) !== (yj > lng)) &&
        (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
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
          ${hasOutsideGeofence ? '<div style="margin-top:6px;color:#ef4444;font-weight:600">⚠️ Cảnh báo: Có Waypoint nằm ngoài phạm vi 51.27 ha Nhà máy Thác Mơ!</div>' : '<div style="margin-top:6px;color:#10b981">✓ Tuyến bay hoàn toàn trong phạm vi an toàn Geofence Thác Mơ.</div>'}
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
    const center = [11.8530, 107.0010]; // Tọa độ trung tâm Thác Mơ
    st.map = L.map(st.root.querySelector('#gis-fp-map'), { center, zoom: 16, maxZoom: 22 });

    // Lớp bản đồ vệ tinh
    const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
    if (sat) {
      L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
    } else {
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        attribution: 'Esri Satellite'
      }).addTo(st.map);
    }

    // Vẽ Ranh giới Geofence Nhà máy Thác Mơ (51.27 ha)
    st.geofenceLayer = L.polygon(THAC_MO_GEOFENCE, {
      color: '#10b981',
      weight: 2,
      dashArray: '5, 8',
      fillColor: '#10b981',
      fillOpacity: 0.08
    }).addTo(st.map);
    st.geofenceLayer.bindTooltip('Ranh giới Geofence Nhà máy Thác Mơ (51.27 ha)', { permanent: false });

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

  // Tải danh sách đường bay mẫu đã lưu trong Thư viện
  async function loadRoutes() {
    const res = await GIS.run(() => GIS.api('GET', '/api/flight-plans'));
    st.routes = res ? res.data : [];
    const container = st.root.querySelector('#gis-fp-routes');
    if (!container) return;

    if (!st.routes.length) {
      container.innerHTML = '<div class="gis-empty" style="padding:16px;text-align:center">Chưa có đường bay mẫu nào trong thư viện. Bấm "➕ Thêm Waypoint" để tạo tuyến mẫu đầu tiên.</div>';
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
                  <div class="faint" style="font-size:10px">${esc(r.target_area || 'Khu vực Thác Mơ')}</div>
                </td>
                <td><span class="tag info">${r.route_kind === 'POINTS' ? 'Vẽ tay tương tác' : 'Quét lưới'}</span></td>
                <td><b>${esc(r.photo_count ?? 0)}</b> ảnh</td>
                <td>${r.duration_s ? fmtTime(r.duration_s) : '--'}</td>
                <td class="faint" style="font-size:11px">${esc(new Date(r.created_at).toLocaleString('vi-VN'))}</td>
                <td style="text-align:right;white-space:nowrap">
                  <a class="btn sm" href="${esc(r.kmz_url)}" download style="background:#0d6e6e;color:#fff;text-decoration:none;padding:3px 8px">📦 Tải KMZ</a>
                  <button class="btn sm danger" data-act="del" style="padding:3px 8px">Xóa</button>
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
    const routeName = (nameInput && nameInput.value.trim()) || `Tuyến Thác Mơ ${new Date().toLocaleDateString('vi-VN')}`;
    const profileSelect = st.root.querySelector('#gis-fp-profile');
    const profileId = profileSelect ? profileSelect.value : (st.profiles[0] && st.profiles[0].profile_id);

    const payload = {
      profile_id: profileId,
      route_name: routeName,
      points: st.waypoints.map((wp, i) => ({
        lat: wp.lat,
        lng: wp.lng,
        altitude_m: wp.altitude_m || 35,
        gimbal_pitch: wp.gimbal_pitch !== undefined ? wp.gimbal_pitch : -90,
        speed_mps: wp.speed_mps || 3,
        hover_seconds: wp.hover_seconds !== undefined ? wp.hover_seconds : 1,
        aircraft_heading: 0,
        label: `WP_${i + 1}`
      }))
    };

    GIS.toast('Đang đóng gói file KMZ WPML chuẩn Mavic 3T...');
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans', payload));
    if (res) {
      GIS.toast('✓ ' + (res.message || 'Đã lưu đường bay mẫu vào Thư viện thành công!'));
      loadRoutes();
    }
  }

  GIS.FlightPlans = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-fp" style="display:grid;grid-template-columns:360px 1fr;gap:12px;height:calc(100vh - 120px)">
            <!-- BẢNG ĐIỀU KHIỂN LẬP ĐƯỜNG BAY MẪU -->
            <section class="card gis-fp-form" style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding:14px">
              <div>
                <h2 style="font-size:16px;color:#0284c7;margin-bottom:4px">🛰️ Thư Viện Đường Bay Mẫu Mavic 3T</h2>
                <p class="faint" style="font-size:11px;margin:0">Tạo trước các tuyến bay chuẩn cho khu pin và dao cách ly. Sau này chỉ cần chọn tuyến khi lập phiếu.</p>
              </div>

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
          if (act.dataset.act === 'del') {
            if (!confirm('Bạn có chắc chắn muốn xóa đường bay mẫu này khỏi Thư viện kèm tệp KMZ?')) return;
            const res = await GIS.run(() => GIS.api('DELETE', `/api/flight-plans/${id}`), 'Đã xóa đường bay mẫu');
            if (res) loadRoutes();
          }
        });

        await initMap();
      }

      // Nạp danh sách hồ sơ chụp
      const [profiles] = await Promise.all([
        GIS.run(() => GIS.api('GET', '/api/capture-profiles'))
      ]);

      st.profiles = (profiles ? profiles.data : []);

      const profileSelect = st.root.querySelector('#gis-fp-profile');
      if (profileSelect) {
        profileSelect.innerHTML = st.profiles.map(p =>
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
