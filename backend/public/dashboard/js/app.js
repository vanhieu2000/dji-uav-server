/**
 * Controller chính điều phối ứng dụng Web Quản trị UAV - Solar - Substation
 */
const App = {
  currentView: 'overview',
  ws: null,

  init() {
    this.setupNavigation();
    this.setupWebSocket();
    this.setupSearch();
    this.setupLayerToggles();
    this.setupMapModeToggle();
    this.setupMobileMenu();
    this.loadOverviewData();
    this.loadTickets();
    this.loadAlerts();
    this.setupActionForms();

    // Khởi tạo bản đồ ngầm
    setTimeout(() => {
      MapManager.init();
    }, 200);
  },

  // 1. Điều hướng giữa các Tabs (Views)
  setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = item.getAttribute('data-view');
        if (targetView) this.switchView(targetView);
      });
    });
  },

  switchView(viewName) {
    this.currentView = viewName;

    // Cập nhật class active cho Nav PC & Mobile
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) el.classList.add('active');
      else el.classList.remove('active');
    });

    // Cập nhật Views
    document.querySelectorAll('.app-view').forEach(view => {
      if (view.id === `view-${viewName}`) view.classList.add('active');
      else view.classList.remove('active');
    });

    // Đổi tiêu đề Topbar
    const titles = {
      'overview': 'Tổng Quan Giám Sát',
      'map': 'Bản Đồ Không Gian Vệ Tinh GIS & UAV',
      'tickets': 'Quản Lý Phiếu Kiểm Tra UAV-AI',
      'media': 'Kho Ảnh Kiểm Tra & Kết Quả AI',
      'alerts': 'Trung Tâm Cảnh Báo Khiếm Khuyết',
      'settings': 'Cấu Hình & Khởi Tạo Dữ Liệu'
    };
    document.getElementById('page-title').innerText = titles[viewName] || 'Hệ Thống Quản Trị';

    // Đóng drawer trên mobile nếu đang mở
    document.querySelector('.app-sidebar').classList.remove('open');

    // Nếu vào tab Map thì invalidateSize để Leaflet vẽ đúng kích thước màn hình
    if (viewName === 'map' && MapManager.map) {
      setTimeout(() => {
        MapManager.map.invalidateSize();
      }, 150);
    }
  },

  // 2. Kết nối WebSocket Realtime với Server
  setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WebSocket] ✓ Đã kết nối kênh giám sát Realtime');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // A. Nhận dữ liệu OSD từ Drone Mavic 3T thật
        if (msg.type === 'osd' && msg.data) {
          MapManager.updateUavPosition(msg.data);
          document.getElementById('topbar-drone-status').innerText = 'MAVIC 3T ONLINE';
          document.getElementById('topbar-drone-status').style.color = 'var(--accent-cyan)';
        }

        // B. Nhận sự kiện đồng bộ ảnh mới từ Drone
        if (msg.type === 'media_synced' && msg.data) {
          this.prependMediaCard(msg.data);
          this.showNotification(`Đã nhận ảnh mới từ UAV: ${msg.data.file_name}`);
        }

        // C. Nhận sự kiện thay đổi mạng bản đồ
        if (msg.type === 'map_mode_changed' && msg.data) {
          this.updateMapStatusBadge(msg.data.is_online);
          MapManager.applyTileSource(msg.data.is_online);
        }
      } catch (e) {
        console.error('[WebSocket Parse Error]', e);
      }
    };

    this.ws.onclose = () => {
      console.warn('[WebSocket] Mất kết nối, sẽ tự động kết nối lại sau 3s...');
      setTimeout(() => this.setupWebSocket(), 3000);
    };
  },

  // 3. Tìm kiếm vị trí trên bản đồ
  setupSearch() {
    const btn = document.getElementById('map-search-btn');
    const input = document.getElementById('map-search-input');
    if (btn && input) {
      const doSearch = () => {
        const val = input.value.trim();
        if (val) MapManager.searchLocation(val);
      };
      btn.addEventListener('click', doSearch);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    }
  },

  // 4. Bật / Tắt các lớp bản đồ
  setupLayerToggles() {
    const toggles = {
      'layer-areas': MapManager.layers.solarAreas,
      'layer-panels': MapManager.layers.solarPanels,
      'layer-substations': MapManager.layers.substations,
      'layer-disconnectors': MapManager.layers.disconnectors
    };

    Object.keys(toggles).forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          const layer = toggles[id];
          if (layer && MapManager.map) {
            if (e.target.checked) MapManager.map.addLayer(layer);
            else MapManager.map.removeLayer(layer);
          }
        });
      }
    });
  },

  // 5. Chuyển đổi thủ công Online ⇋ Offline
  setupMapModeToggle() {
    const pill = document.getElementById('map-status-pill');
    if (pill) {
      pill.addEventListener('click', () => {
        const newStatus = !MapManager.isOnlineMode;
        MapManager.applyTileSource(newStatus);
        this.updateMapStatusBadge(newStatus);
      });
    }
  },

  updateMapStatusBadge(isOnline) {
    const pill = document.getElementById('map-status-pill');
    const text = document.getElementById('map-status-text');
    if (pill && text) {
      if (isOnline) {
        pill.className = 'map-status-pill online';
        text.innerText = 'BẢN ĐỒ ONLINE';
      } else {
        pill.className = 'map-status-pill offline';
        text.innerText = 'BẢN ĐỒ OFFLINE';
      }
    }
  },

  // 6. Menu Drawer cho Mobile
  setupMobileMenu() {
    const toggleBtn = document.getElementById('menu-toggle-btn');
    const sidebar = document.querySelector('.app-sidebar');
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
    }
  },

  // 7. Tải dữ liệu KPI Overview
  async loadOverviewData() {
    const res = await API.reports.getOverview();
    if (res.code === 0 && res.data) {
      const d = res.data;
      document.getElementById('kpi-panels').innerText = d.total_panels.toLocaleString();
      document.getElementById('kpi-dcl').innerText = d.total_disconnectors.toLocaleString();
      document.getElementById('kpi-tickets').innerText = `${d.completed_tickets}/${d.total_tickets}`;
      document.getElementById('kpi-defects').innerText = d.total_defects_found;
      document.getElementById('kpi-alerts').innerText = d.unread_alerts;
      document.getElementById('sidebar-alert-badge').innerText = d.unread_alerts;
    }
  },

  // 8. Tải danh sách Phiếu kiểm tra
  async loadTickets() {
    const res = await API.tickets.list();
    const tbody = document.getElementById('tickets-table-body');
    if (tbody && res.code === 0 && res.data) {
      tbody.innerHTML = '';
      res.data.forEach(t => {
        const tr = document.createElement('tr');
        const statusClass = t.status === 'COMPLETED' ? 'completed' : (t.status === 'EXECUTING' ? 'executing' : 'pending');
        tr.innerHTML = `
          <td><b>${t.ticket_code}</b></td>
          <td>${t.ticket_name}</td>
          <td>${t.inspection_type === 'SOLAR_PANEL' ? '☀️ Pin Mặt Trời' : '⚡ Dao Cách Ly'}</td>
          <td>${t.target_facility}</td>
          <td><span class="status-badge ${statusClass}">${t.status}</span></td>
          <td>${t.inspector_name || 'Kỹ sư Vận hành'}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  },

  // 9. Tải danh sách Cảnh báo
  async loadAlerts() {
    const res = await API.ai.getAlerts('ALL');
    const container = document.getElementById('alerts-list-container');
    if (container && res.code === 0 && res.data) {
      container.innerHTML = '';
      res.data.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card-panel';
        div.style.borderLeft = a.alert_level === 'CRITICAL' ? '4px solid var(--accent-red)' : '4px solid var(--accent-yellow)';
        div.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="color:${a.alert_level === 'CRITICAL' ? 'var(--accent-red)' : 'var(--accent-yellow)'}">${a.title}</b>
            <span style="font-size:11px; color:var(--text-dim);">${new Date(a.created_at).toLocaleTimeString()}</span>
          </div>
          <p style="font-size:13px; color:var(--text-muted);">${a.message}</p>
        `;
        container.appendChild(div);
      });
    }
  },

  // 10. Thêm card ảnh vào Kho ảnh
  prependMediaCard(item) {
    const gallery = document.getElementById('media-gallery-grid');
    if (!gallery) return;

    const div = document.createElement('div');
    div.className = 'media-card';
    div.innerHTML = `
      <img src="${item.file_url}" class="media-thumb" alt="${item.file_name}" onerror="this.src='/dashboard/img/placeholder.png';">
      <div class="media-info">
        <div class="media-title">${item.file_name}</div>
        <div style="font-size:11px; color:var(--text-dim);">${item.media_type} - ${new Date().toLocaleTimeString()}</div>
      </div>
    `;
    gallery.prepend(div);
  },

  // 11. Xử lý các Form tương tác (Tạo phiếu, Thêm Tấm pin, Thêm Dao cách ly)
  setupActionForms() {
    // Tạo phiếu mới
    const btnCreateTicket = document.getElementById('btn-create-ticket');
    if (btnCreateTicket) {
      btnCreateTicket.addEventListener('click', async () => {
        const ticketName = prompt('Nhập tiêu đề phiếu kiểm tra mới:');
        if (!ticketName) return;
        const type = prompt('Chọn loại kiểm tra (1: Pin Mặt Trời, 2: Dao Cách Ly):', '1');
        const inspectionType = type === '2' ? 'DISCONNECTOR' : 'SOLAR_PANEL';
        const facility = prompt('Nhập khu vực thực hiện:', 'Dãy pin Inverter 01');

        const res = await API.tickets.create({
          ticket_name: ticketName,
          inspection_type: inspectionType,
          target_facility: facility || 'Khu vực chính'
        });

        if (res.code === 0) {
          alert(`✓ Đã tạo phiếu thành công! Mã phiếu: ${res.data.ticket_code}`);
          this.loadTickets();
          this.loadOverviewData();
        } else {
          alert('Lỗi tạo phiếu: ' + res.message);
        }
      });
    }

    // Thêm tấm pin
    const btnSavePanel = document.getElementById('btn-save-panel');
    if (btnSavePanel) {
      btnSavePanel.addEventListener('click', async () => {
        const serial = document.getElementById('cfg-panel-serial').value.trim();
        const index = document.getElementById('cfg-panel-index').value;
        const lat = parseFloat(document.getElementById('cfg-panel-lat').value);
        const lng = parseFloat(document.getElementById('cfg-panel-lng').value);

        if (!serial || isNaN(lat) || isNaN(lng)) {
          alert('Vui lòng nhập đủ Serial, Vĩ độ và Kinh độ');
          return;
        }

        const res = await API.solar.savePanel({
          string_id: 1,
          panel_serial: serial,
          panel_index: parseInt(index || '1', 10),
          latitude: lat,
          longitude: lng
        });

        if (res.code === 0) {
          alert('✓ Đã lưu tấm pin mới vào hệ thống và bản đồ!');
          MapManager.loadSolarPanels();
          this.loadOverviewData();
        } else {
          alert('Lỗi: ' + res.message);
        }
      });
    }

    // Thêm dao cách ly
    const btnSaveDcl = document.getElementById('btn-save-dcl');
    if (btnSaveDcl) {
      btnSaveDcl.addEventListener('click', async () => {
        const dclCode = document.getElementById('cfg-dcl-code').value.trim();
        const phase = document.getElementById('cfg-dcl-phase').value;
        const lat = parseFloat(document.getElementById('cfg-dcl-lat').value);
        const lng = parseFloat(document.getElementById('cfg-dcl-lng').value);

        if (!dclCode || isNaN(lat) || isNaN(lng)) {
          alert('Vui lòng nhập đủ Mã DCL, Vĩ độ và Kinh độ');
          return;
        }

        const res = await API.substation.saveDisconnector({
          bay_id: 1,
          dcl_code: dclCode,
          phase: phase,
          latitude: lat,
          longitude: lng
        });

        if (res.code === 0) {
          alert('✓ Đã lưu dao cách ly mới vào hệ thống và bản đồ!');
          MapManager.loadDisconnectors();
          this.loadOverviewData();
        } else {
          alert('Lỗi: ' + res.message);
        }
      });
    }
  },

  showNotification(msg) {
    console.log(`[Notification] ${msg}`);
  }
};

// Khởi chạy ứng dụng khi DOM đã sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
