/**
 * Quản trị Bản đồ Vệ tinh GIS & Giám sát UAV Realtime (Kombai-Grade Edition)
 */
const MapManager = {
  map: null,
  currentTileLayer: null,
  isOnlineMode: true,
  
  // Layer Groups
  layers: {
    solarAreas: null,
    solarPanels: null,
    substations: null,
    disconnectors: null,
    uav: null,
    flightPath: null
  },

  droneMarker: null,
  flightPathPolyline: null,
  flightCoordinates: [],

  init() {
    if (this.map) return;

    // Tọa độ trung tâm: Nhà máy Điện mặt trời Lộc Ninh 1 (Bình Phước)
    const defaultCenter = [11.831200, 106.591300];
    const defaultZoom = 17;

    this.map = L.map('gis-map', {
      center: defaultCenter,
      zoom: defaultZoom,
      maxZoom: 22,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Khởi tạo các Layer Group
    this.layers.solarAreas = L.layerGroup().addTo(this.map);
    this.layers.solarPanels = L.layerGroup().addTo(this.map);
    this.layers.substations = L.layerGroup().addTo(this.map);
    this.layers.disconnectors = L.layerGroup().addTo(this.map);
    this.layers.flightPath = L.layerGroup().addTo(this.map);
    this.layers.uav = L.layerGroup().addTo(this.map);

    // Nạp Tile bản đồ vệ tinh
    this.applyTileSource(true);

    // Đường bay UAV phát sáng neon cyan
    this.flightPathPolyline = L.polyline([], {
      color: '#00f2fe',
      weight: 3,
      opacity: 0.9,
      dashArray: '8, 8'
    }).addTo(this.layers.flightPath);

    // Nút đóng Smart Inspector
    const closeBtn = document.getElementById('inspector-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        document.getElementById('smart-inspector-card').classList.remove('active');
      });
    }

    // Nạp toàn bộ dữ liệu GIS từ cơ sở dữ liệu MySQL
    this.loadAllGisData();
  },

  applyTileSource(isOnline) {
    this.isOnlineMode = isOnline;
    if (this.currentTileLayer) {
      this.map.removeLayer(this.currentTileLayer);
    }

    if (isOnline) {
      // Vệ tinh Esri World Imagery độ phân giải cao
      this.currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 20,
        attribution: 'Esri High-Res Satellite'
      }).addTo(this.map);
    } else {
      // Tile Offline cục bộ lưu trong server
      this.currentTileLayer = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
        maxZoom: 20,
        errorTileUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="%230f172a"/><text x="50%" y="50%" fill="%2300f2fe" font-size="12" font-family="monospace" text-anchor="middle" dominant-baseline="middle">Offline Tile</text></svg>'
      }).addTo(this.map);
    }
  },

  async loadAllGisData() {
    await Promise.all([
      this.loadSolarAreas(),
      this.loadSolarPanels(),
      this.loadSubstations(),
      this.loadDisconnectors()
    ]);
  },

  // 1. Tải khu vực Inverter pin
  async loadSolarAreas() {
    this.layers.solarAreas.clearLayers();
    const res = await API.solar.getAreas();
    if (res.code === 0 && res.data) {
      res.data.forEach(area => {
        if (area.center_lat && area.center_lng) {
          const circle = L.circle([area.center_lat, area.center_lng], {
            color: '#4facfe',
            fillColor: '#4facfe',
            fillOpacity: 0.12,
            radius: 80,
            weight: 2
          });
          circle.on('click', () => {
            this.showSmartInspector(
              `Khu Vực Inverter: ${area.area_code}`,
              `
                <div class="inspector-stat-row"><span>Tên:</span><b>${area.area_name}</b></div>
                <div class="inspector-stat-row"><span>Mã:</span><b>${area.area_code}</b></div>
                <div class="inspector-stat-row"><span>Công suất:</span><b style="color:var(--neon-green);">${area.total_capacity_kwp || 'N/A'} kWp</b></div>
                <div class="inspector-stat-row"><span>Tọa độ:</span><span>${area.center_lat.toFixed(6)}, ${area.center_lng.toFixed(6)}</span></div>
              `
            );
          });
          this.layers.solarAreas.addLayer(circle);
        }
      });
    }
  },

  // 2. Tải từng tấm pin
  async loadSolarPanels() {
    this.layers.solarPanels.clearLayers();
    const res = await API.solar.getPanels(null, null, 150);
    if (res.code === 0 && res.data) {
      res.data.forEach(panel => {
        if (panel.latitude && panel.longitude) {
          const isWarning = panel.status === 'WARNING';
          const isDefect = panel.status === 'DEFECT';
          const color = isDefect ? '#ff0055' : (isWarning ? '#ffb300' : '#00f5a0');

          const marker = L.circleMarker([panel.latitude, panel.longitude], {
            radius: 5,
            color: color,
            fillColor: color,
            fillOpacity: 0.9,
            weight: 2
          });

          marker.on('click', () => {
            this.showSmartInspector(
              `Tấm Pin: ${panel.panel_serial || 'N/A'}`,
              `
                <div class="inspector-stat-row"><span>Mã Serial:</span><b>${panel.panel_serial || 'N/A'}</b></div>
                <div class="inspector-stat-row"><span>Chuỗi String:</span><b>${panel.string_code || 'N/A'}</b></div>
                <div class="inspector-stat-row"><span>Vị trí chuỗi:</span><b>Số ${panel.panel_index}</b></div>
                <div class="inspector-stat-row"><span>Khu vực:</span><span>${panel.area_name || panel.area_code || 'N/A'}</span></div>
                <div class="inspector-stat-row"><span>Trạng thái:</span><b style="color:${color};">${panel.status}</b></div>
                <div class="inspector-stat-row"><span>Tọa độ GPS:</span><span>${panel.latitude.toFixed(6)}, ${panel.longitude.toFixed(6)}</span></div>
                <button class="btn-primary" style="margin-top:8px; width:100%; justify-content:center;" onclick="alert('Đã gán tấm pin vào nhiệm vụ kiểm tra UAV!')">Tạo Phiếu Kiểm Tra Pin Này</button>
              `
            );
          });

          this.layers.solarPanels.addLayer(marker);
        }
      });
    }
  },

  // 3. Tải trạm biến áp 110kV
  async loadSubstations() {
    this.layers.substations.clearLayers();
    const res = await API.substation.getSubstations();
    if (res.code === 0 && res.data) {
      res.data.forEach(sub => {
        if (sub.center_lat && sub.center_lng) {
          const marker = L.marker([sub.center_lat, sub.center_lng], {
            icon: L.divIcon({
              className: 'custom-substation-icon',
              html: `<div style="background:linear-gradient(135deg, #b5179e, #7209b7); color:#fff; border-radius:8px; padding:4px 8px; font-weight:700; font-size:11px; white-space:nowrap; box-shadow:0 0 12px #b5179e; border:1px solid rgba(255,255,255,0.2);">⚡ ${sub.substation_name}</div>`
            })
          });
          marker.on('click', () => {
            this.showSmartInspector(
              sub.substation_name,
              `
                <div class="inspector-stat-row"><span>Mã trạm:</span><b>${sub.substation_code}</b></div>
                <div class="inspector-stat-row"><span>Cấp điện áp:</span><b style="color:var(--neon-purple);">${sub.voltage_level}</b></div>
                <div class="inspector-stat-row"><span>Tọa độ tâm:</span><span>${sub.center_lat.toFixed(6)}, ${sub.center_lng.toFixed(6)}</span></div>
              `
            );
          });
          this.layers.substations.addLayer(marker);
        }
      });
    }
  },

  // 4. Tải danh mục dao cách ly DCL
  async loadDisconnectors() {
    this.layers.disconnectors.clearLayers();
    const res = await API.substation.getDisconnectors();
    if (res.code === 0 && res.data) {
      res.data.forEach(dcl => {
        if (dcl.latitude && dcl.longitude) {
          const isClosed = dcl.state === 'CLOSED';
          const color = isClosed ? '#00f2fe' : '#ffb300';

          const marker = L.circleMarker([dcl.latitude, dcl.longitude], {
            radius: 7,
            color: color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2
          });

          marker.on('click', () => {
            this.showSmartInspector(
              `Dao Cách Ly: ${dcl.dcl_code}`,
              `
                <div class="inspector-stat-row"><span>Mã DCL:</span><b>${dcl.dcl_code}</b></div>
                <div class="inspector-stat-row"><span>Pha kiểm tra:</span><b style="color:var(--neon-cyan);">Pha ${dcl.phase}</b></div>
                <div class="inspector-stat-row"><span>Ngăn lộ:</span><b>${dcl.bay_name || dcl.bay_code}</b></div>
                <div class="inspector-stat-row"><span>Trạng thái:</span><b style="color:${color};">${isClosed ? 'ĐANG ĐÓNG' : 'ĐANG MỞ'}</b></div>
                <div class="inspector-stat-row"><span>Ngưỡng cho phép:</span><b>${dcl.max_allowed_temp}°C</b></div>
                <div class="inspector-stat-row"><span>Nhiệt độ đo gần nhất:</span><b style="color:${dcl.last_inspected_temp >= dcl.max_allowed_temp ? 'var(--neon-red)' : 'var(--neon-green)'};">${dcl.last_inspected_temp ? dcl.last_inspected_temp + '°C' : 'Chưa có dữ liệu'}</b></div>
                <button class="btn-primary" style="margin-top:8px; width:100%; justify-content:center;" onclick="alert('Đã gán Dao cách ly vào nhiệm vụ kiểm tra phát nhiệt UAV!')">Tạo Phiếu Kiểm Tra DCL</button>
              `
            );
          });

          this.layers.disconnectors.addLayer(marker);
        }
      });
    }
  },

  // Hiển thị Panel Smart Inspector Card
  showSmartInspector(title, contentHtml) {
    const card = document.getElementById('smart-inspector-card');
    const titleEl = document.getElementById('inspector-title');
    const bodyEl = document.getElementById('inspector-content');
    if (card && titleEl && bodyEl) {
      titleEl.innerText = title;
      bodyEl.innerHTML = contentHtml;
      card.classList.add('active');
    }
  },

  // Cập nhật vị trí Drone Mavic 3T realtime từ WebSocket OSD
  updateUavPosition(data) {
    if (!data.lat || !data.lng || (data.lat === 0 && data.lng === 0)) return;

    const latLng = [data.lat, data.lng];

    if (!this.droneMarker) {
      const droneIcon = L.divIcon({
        className: 'drone-uav-marker',
        html: `
          <div style="width:40px; height:40px; border-radius:50%; background:rgba(0,242,254,0.2); border:2px solid var(--neon-cyan); display:flex; align-items:center; justify-content:center; box-shadow:0 0 20px var(--neon-cyan); transform: rotate(${data.yaw || 0}deg); transition: transform 0.2s linear;">
            🛸
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      this.droneMarker = L.marker(latLng, { icon: droneIcon }).addTo(this.layers.uav);
    } else {
      this.droneMarker.setLatLng(latLng);
    }

    // Vẽ vệt bay
    this.flightCoordinates.push(latLng);
    if (this.flightCoordinates.length > 500) this.flightCoordinates.shift();
    this.flightPathPolyline.setLatLngs(this.flightCoordinates);

    // CẬP NHẬT COCKPIT HUD BUỒNG LÁI
    document.getElementById('hud-lat').innerText = data.lat.toFixed(6);
    document.getElementById('hud-lng').innerText = data.lng.toFixed(6);
    document.getElementById('hud-alt').innerText = (data.alt || 0).toFixed(1) + ' m';
    document.getElementById('hud-speed').innerText = (data.speed || 0).toFixed(1) + ' m/s';
    
    // Cập nhật La bàn buồng lái
    const yaw = data.yaw || 0;
    const compass = document.getElementById('hud-compass-ring');
    const yawText = document.getElementById('hud-yaw-deg');
    if (compass) compass.style.transform = `rotate(${yaw}deg)`;
    if (yawText) yawText.innerText = `${yaw.toFixed(1)}° YAW`;

    // Cập nhật Pin và thanh LED năng lượng
    const bat = data.battery !== undefined ? data.battery : 0;
    const batText = document.getElementById('hud-battery');
    const batFill = document.getElementById('hud-battery-fill');
    if (batText) batText.innerText = `${bat}%`;
    if (batFill) {
      batFill.style.width = `${bat}%`;
      if (bat > 50) {
        batFill.style.background = 'linear-gradient(90deg, var(--neon-green), var(--neon-cyan))';
        batFill.style.boxShadow = '0 0 10px var(--neon-green)';
      } else if (bat > 20) {
        batFill.style.background = 'linear-gradient(90deg, var(--neon-amber), var(--neon-cyan))';
        batFill.style.boxShadow = '0 0 10px var(--neon-amber)';
      } else {
        batFill.style.background = 'var(--neon-red)';
        batFill.style.boxShadow = '0 0 12px var(--neon-red)';
      }
    }

    // Cập nhật số lượng vệ tinh GPS
    const satEl = document.getElementById('hud-satellites');
    if (satEl) satEl.innerText = data.satellites !== undefined ? data.satellites : '--';
  },

  // Tìm kiếm vị trí Tấm Pin hoặc Dao Cách Ly
  async searchLocation(query) {
    if (!query) return;
    const q = query.trim().toUpperCase();

    // 1. Thử tìm theo Tấm Pin
    const panelRes = await API.solar.getPanels(null, q, 1);
    if (panelRes.code === 0 && panelRes.data && panelRes.data.length > 0) {
      const p = panelRes.data[0];
      if (p.latitude && p.longitude) {
        this.map.flyTo([p.latitude, p.longitude], 20, { duration: 1.5 });
        this.showSmartInspector(
          `Tìm Thấy: ${p.panel_serial}`,
          `
            <div class="inspector-stat-row"><span>Tấm Pin:</span><b>${p.panel_serial}</b></div>
            <div class="inspector-stat-row"><span>Chuỗi:</span><b>${p.string_code}</b></div>
            <div class="inspector-stat-row"><span>Tọa độ:</span><span>${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}</span></div>
          `
        );
        return true;
      }
    }

    // 2. Thử tìm theo Dao Cách Ly
    const dclRes = await API.substation.getDisconnectors(null, q);
    if (dclRes.code === 0 && dclRes.data && dclRes.data.length > 0) {
      const d = dclRes.data[0];
      if (d.latitude && d.longitude) {
        this.map.flyTo([d.latitude, d.longitude], 20, { duration: 1.5 });
        this.showSmartInspector(
          `Tìm Thấy DCL: ${d.dcl_code}`,
          `
            <div class="inspector-stat-row"><span>Mã DCL:</span><b>${d.dcl_code}</b></div>
            <div class="inspector-stat-row"><span>Pha:</span><b>${d.phase}</b></div>
            <div class="inspector-stat-row"><span>Tọa độ:</span><span>${d.latitude.toFixed(6)}, ${d.longitude.toFixed(6)}</span></div>
          `
        );
        return true;
      }
    }

    alert(`Không tìm thấy đối tượng nào có mã: ${query}`);
    return false;
  }
};
