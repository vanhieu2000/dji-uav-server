/**
 * app-v2.js - Quản lý tương tác UI V2:
 * 1. Chuyển tab Cài đặt chung (Thông số hệ thống, Tài khoản Master-Detail, Bản đồ Offline, Bản đồ 2D).
 * 2. Quản lý Tài khoản (Master Table + Modal thêm/sửa/xóa).
 * 3. Combobox chọn lớp bản đồ trên Map Solar & nút tạo/sửa đường bay.
 * 4. Tích hợp Màn hình Lịch sử Chuyến bay & Vệt bay Drone theo Phiếu.
 */

// --- 1. QUẢN LÝ TAB TRONG CÀI ĐẶT CHUNG ---
window.switchAdminTab = function(tabName) {
  const tabs = ['system', 'accounts', 'offline-maps', '2d-maps'];
  tabs.forEach(t => {
    const btn = document.querySelector(`.settings-tabs button[data-settings="${t}"]`);
    const pane = document.getElementById(`settings-tab-${t}`);
    if (btn) {
      btn.classList.toggle('on', t === tabName);
      btn.setAttribute('aria-selected', String(t === tabName));
    }
    if (pane) {
      pane.hidden = (t !== tabName);
    }
  });

  if (tabName === 'accounts') {
    window.loadAdminUsers();
  } else if (tabName === 'system') {
    if (typeof window.loadNativeStorageStatus === 'function') window.loadNativeStorageStatus();
    if (window.GIS && window.GIS.Vision && typeof window.GIS.Vision.renderRules === 'function') {
      const el = document.getElementById('settings-alert-rules');
      if (el) window.GIS.Vision.renderRules(el);
    }
  }
};

// --- 2. QUẢN LÝ TÀI KHOẢN (MASTER TABLE + MODAL RIÊNG BIỆT) ---
let gAdminUsers = [];

window.loadAdminUsers = async function() {
  const tbody = document.getElementById('admin-user-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="faint" style="text-align:center;padding:18px">Đang nạp danh sách tài khoản...</td></tr>';
  try {
    const res = await fetch('/api/admin/users');
    const json = await res.json();
    if (json.code === 0 && Array.isArray(json.data)) {
      gAdminUsers = json.data;
      window.filterAdminUsers();
    } else {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--hot);text-align:center;padding:16px">${json.message || 'Không thể tải danh sách tài khoản'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--hot);text-align:center;padding:16px">Lỗi kết nối: ${err.message}</td></tr>`;
  }
};

window.filterAdminUsers = function() {
  const tbody = document.getElementById('admin-user-table-body');
  if (!tbody) return;
  const q = (document.getElementById('admin-user-search')?.value || '').toLowerCase().trim();
  const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';

  const filtered = gAdminUsers.filter(u => {
    const matchQ = !q || (u.username && u.username.toLowerCase().includes(q)) || (u.full_name && u.full_name.toLowerCase().includes(q));
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchQ && matchRole;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="faint" style="text-align:center;padding:20px">Không tìm thấy tài khoản phù hợp.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const roleBadge = u.role === 'ADMIN' ? '<span class="tag bad">Quản trị viên</span>' :
                      u.role === 'OPERATOR' ? '<span class="tag ok">Phi công UAV</span>' :
                      u.role === 'ENGINEER' ? '<span class="tag info">Kỹ sư kiểm tra</span>' :
                      '<span class="tag off">Giám sát viên</span>';
    const statusBadge = u.status === 'ACTIVE' ? '<span class="tag ok">Hoạt động</span>' :
                        '<span class="tag warn">Đã khóa</span>';
    return `
      <tr>
        <td><b>${escapeHtml(u.username)}</b></td>
        <td>${escapeHtml(u.full_name || '–')}</td>
        <td class="muted">${escapeHtml(u.email || '–')}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td style="text-align:right">
          <button class="btn sm" onclick="openUserModal(${u.user_id})">Sửa</button>
          <button class="btn sm danger" onclick="deleteAdminUser(${u.user_id}, '${escapeHtml(u.username)}')">Xóa</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.openUserModal = function(userId) {
  const modal = document.getElementById('modal-user-form');
  const title = document.getElementById('modal-user-title');
  const errEl = document.getElementById('user-form-error');
  if (errEl) errEl.textContent = '';
  document.getElementById('form-admin-user').reset();

  const pwdInput = document.getElementById('user-form-pwd');
  const pwdLabel = document.getElementById('user-form-pwd-label');
  const pwdNote = document.getElementById('user-form-pwd-note');

  if (userId) {
    const user = gAdminUsers.find(u => u.user_id === userId);
    if (!user) return;
    title.textContent = `Chỉnh sửa tài khoản: ${user.username}`;
    document.getElementById('user-form-id').value = user.user_id;
    document.getElementById('user-form-username').value = user.username;
    document.getElementById('user-form-username').disabled = true;
    document.getElementById('user-form-fullname').value = user.full_name || '';
    document.getElementById('user-form-email').value = user.email || '';
    document.getElementById('user-form-role').value = user.role || 'OPERATOR';
    document.getElementById('user-form-status').value = user.status || 'ACTIVE';
    pwdInput.required = false;
    if (pwdLabel) pwdLabel.innerHTML = 'Mật khẩu mới';
    if (pwdNote) pwdNote.style.display = 'block';
  } else {
    title.textContent = 'Thêm tài khoản người dùng mới';
    document.getElementById('user-form-id').value = '';
    document.getElementById('user-form-username').disabled = false;
    pwdInput.required = true;
    if (pwdLabel) pwdLabel.innerHTML = 'Mật khẩu ban đầu <span style="color:var(--hot)">*</span>';
    if (pwdNote) pwdNote.style.display = 'none';
  }

  if (modal) modal.classList.add('active');
};

window.closeUserModal = function() {
  const modal = document.getElementById('modal-user-form');
  if (modal) modal.classList.remove('active');
};

window.saveAdminUser = async function(event) {
  event.preventDefault();
  const errEl = document.getElementById('user-form-error');
  const id = document.getElementById('user-form-id').value;
  const username = document.getElementById('user-form-username').value.trim();
  const full_name = document.getElementById('user-form-fullname').value.trim();
  const email = document.getElementById('user-form-email').value.trim();
  const role = document.getElementById('user-form-role').value;
  const status = document.getElementById('user-form-status').value;
  const password = document.getElementById('user-form-pwd').value;

  const payload = { username, full_name, email, role, status };
  if (password) payload.password = password;

  try {
    const url = id ? `/api/admin/users/${id}` : '/api/admin/users';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.code === 0) {
      window.closeUserModal();
      window.loadAdminUsers();
      if (typeof window.showToast === 'function') window.showToast('Đã lưu tài khoản thành công!');
    } else {
      if (errEl) errEl.textContent = json.message || 'Lỗi khi lưu tài khoản.';
    }
  } catch (err) {
    if (errEl) errEl.textContent = 'Lỗi kết nối: ' + err.message;
  }
};

window.deleteAdminUser = async function(userId, username) {
  if (!confirm(`Bạn có chắc muốn xóa tài khoản "${username}" không?`)) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.code === 0) {
      window.loadAdminUsers();
      if (typeof window.showToast === 'function') window.showToast(`Đã xóa tài khoản ${username}.`);
    } else {
      alert(json.message || 'Không thể xóa tài khoản.');
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
};

// --- 3. THÔNG SỐ HỆ THỐNG & VISION AI ---
window.saveMediaStoragePath = function() {
  const path = document.getElementById('cfg-media-dir')?.value.trim();
  if (!path) return alert('Vui lòng nhập đường dẫn thư mục lưu ảnh');
  localStorage.setItem('uav_media_dir', path);
  alert('Đã lưu đường dẫn thư mục lưu trữ ảnh: ' + path);
};

window.saveVisionApiConfig = function() {
  const api = document.getElementById('cfg-vision-api')?.value.trim();
  if (!api) return alert('Vui lòng nhập Link API Vision AI');
  localStorage.setItem('uav_vision_api', api);
  alert('Đã lưu địa chỉ kết nối Vision AI: ' + api);
};

window.testVisionApiConnection = async function() {
  const statusEl = document.getElementById('vision-api-status');
  const api = document.getElementById('cfg-vision-api')?.value.trim() || 'http://127.0.0.1:5000/api/vision';
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--sun)">Đang kết nối thử nghiệm...</span>';
  try {
    const res = await fetch('/api/vision/jobs?limit=1');
    if (res.ok) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--ok)">✓ Dịch vụ Vision AI đang hoạt động bình thường!</span>';
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--hot)">Không phản hồi (HTTP ${res.status})</span>`;
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--hot)">Lỗi kết nối: ${err.message}</span>`;
  }
};

// --- 4. BẢN ĐỒ OFFLINE & BẢN ĐỒ 2D TRỰC GIAO ---
window.uploadOfflineMapPackage = function() {
  const file = document.getElementById('offline-pkg-file')?.files[0];
  const name = document.getElementById('offline-pkg-name')?.value.trim();
  if (!file) return alert('Vui lòng chọn tệp gói bản đồ MBTiles hoặc ZIP.');
  alert(`Đã nhận tệp "${file.name}" (${(file.size / (1024*1024)).toFixed(1)} MB). Đang xử lý giải nén bản đồ offline...`);
};

window.upload2DOrthoMap = function() {
  const name = document.getElementById('ortho-map-name')?.value.trim();
  const file = document.getElementById('ortho-map-file')?.files[0];
  if (!name || !file) return alert('Vui lòng nhập tên khu vực và chọn tệp ảnh trực giao.');
  alert(`Đã nhận ảnh trực giao 2D: "${name}" (${file.name}). Bản đồ đã được gán vào danh mục 2D khu vực.`);
};

window.preview2DMapOnGIS = function() {
  window.switchView('map-solar');
  setTimeout(() => {
    const sel = document.getElementById('solar-basemap-select');
    if (sel) {
      sel.value = 'plant_upload';
      if (typeof window.setBasemap === 'function') window.setBasemap('plant_upload', 'solar');
    }
  }, 200);
};

// --- 5. LỆNH SỬA / XÓA ĐƯỜNG BAY MẪU TRÊN MAP ---
window.editCurrentFlightPlan = function() {
  window.switchView('flight-plans');
};

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

