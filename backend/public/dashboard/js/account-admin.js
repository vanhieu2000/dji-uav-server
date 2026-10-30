/* Scoped account management with single clean table, row selection, and detail modal dialog. */
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let users = [], units = [], plants = [], root, selectedUserId = null, loading = false;

  async function api(path, body, method) {
    const r = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const j = await r.json();
    if (!r.ok || j.code !== 0) throw Error(j.message || 'Không xử lý được tài khoản');
    return j;
  }

  function setStatus(msg, isError = false) {
    const el = root?.querySelector('[data-aa-status]');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'aa-global-status' + (msg ? (isError ? ' error' : ' success') : '');
    if (msg && !isError) {
      setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
    }
  }

  function setModalStatus(msg, isError = false) {
    const el = root?.querySelector('[data-aa-modal-status]');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'aa-modal-status' + (msg ? (isError ? ' error' : ' success') : '');
  }

  function getSelectedUser() {
    return users.find(u => u.user_id === selectedUserId) || null;
  }

  function updateActionButtons() {
    const u = getSelectedUser();
    const hasSelection = !!u;
    const btnEdit = root?.querySelector('[data-aa-btn="edit"]');
    const btnDel = root?.querySelector('[data-aa-btn="delete"]');
    const btnPwd = root?.querySelector('[data-aa-btn="password"]');
    if (btnEdit) btnEdit.disabled = !hasSelection;
    if (btnDel) btnDel.disabled = !hasSelection;
    if (btnPwd) btnPwd.disabled = !hasSelection;
  }

  function selectRow(id) {
    selectedUserId = id;
    root?.querySelectorAll('[data-aa-user-row]').forEach(tr => {
      tr.classList.toggle('selected', Number(tr.dataset.userId) === id);
    });
    updateActionButtons();
  }

  function draw() {
    const q = (root?.querySelector('[data-aa-search]')?.value || '').trim().toLocaleLowerCase('vi');
    const role = root?.querySelector('[data-aa-filter-role]')?.value || '';
    const status = root?.querySelector('[data-aa-filter-status]')?.value || '';

    const filtered = users.filter(u => {
      if (role && u.role !== role) return false;
      if (status && u.status !== status) return false;
      if (q) {
        const text = [u.username, u.full_name, u.email, u.unit_name].join(' ').toLocaleLowerCase('vi');
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const tbody = root?.querySelector('[data-aa-users]');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="aa-empty">Không tìm thấy tài khoản phù hợp</td></tr>';
      selectRow(null);
      return;
    }

    tbody.innerHTML = filtered.map((u, idx) => {
      const isSelected = u.user_id === selectedUserId;
      const statusBadge = u.status === 'ACTIVE'
        ? '<span class="aa-badge badge-active">Hoạt động</span>'
        : u.status === 'LOCKED'
          ? '<span class="aa-badge badge-locked">Đã khóa</span>'
          : '<span class="aa-badge badge-inactive">Không dùng</span>';

      const pwdWarning = u.must_change_password ? ' <span class="aa-warn-tag" title="Người dùng phải đổi mật khẩu khi đăng nhập">Cần đổi MK</span>' : '';
      const roleBadge = `<span class="aa-role-tag role-${u.role}">${esc(u.role)}</span>`;

      const plantNames = (u.plant_ids || []).map(pid => plants.find(p => p.plant_id === pid)?.plant_name || pid).filter(Boolean);
      const scopeText = u.all_operation_scopes
        ? '<span class="aa-scope-all">Toàn bộ nghiệp vụ</span>'
        : (plantNames.length ? esc(plantNames.join(', ')) : '<span class="muted">Chưa gán</span>');

      return `
        <tr class="aa-user-row ${isSelected ? 'selected' : ''}" data-aa-user-row data-user-id="${u.user_id}" tabindex="0">
          <td class="num">${idx + 1}</td>
          <td><strong class="aa-user-name">${esc(u.username)}</strong></td>
          <td>${esc(u.full_name)}</td>
          <td>${roleBadge}</td>
          <td>${esc(u.unit_name || '—')}</td>
          <td class="aa-scope-cell">${scopeText}</td>
          <td>${statusBadge}${pwdWarning}</td>
        </tr>
      `;
    }).join('');

    if (selectedUserId && !filtered.some(u => u.user_id === selectedUserId)) {
      selectRow(null);
    } else {
      updateActionButtons();
    }
  }

  function openEditModal(user = null) {
    const dialog = root?.querySelector('#aa-dialog');
    const form = root?.querySelector('#aa-modal-form');
    if (!dialog || !form) return;

    form.reset();
    setModalStatus('');

    const titleEl = root.querySelector('#aa-modal-title');
    if (titleEl) {
      titleEl.textContent = user ? `SỬA TÀI KHOẢN: ${user.username.toUpperCase()}` : 'THÊM TÀI KHOẢN MỚI';
    }

    form.elements.id.value = user?.user_id || '';
    form.elements.username.value = user?.username || '';
    form.elements.username.readOnly = !!user;
    form.elements.full_name.value = user?.full_name || '';
    form.elements.email.value = user?.email || '';
    form.elements.role.value = user?.role || 'OPERATOR';
    form.elements.unit_id.value = user?.unit_id || '';
    form.elements.status.value = user?.status || 'ACTIVE';

    const allScopesBox = form.elements.all_operation_scopes;
    allScopesBox.checked = !!user?.all_operation_scopes;
    allScopesBox.disabled = form.elements.role.value !== 'OPERATOR';

    form.querySelectorAll('[name=plant_ids]').forEach(c => {
      c.checked = !!user?.plant_ids?.includes(Number(c.value));
    });

    const pwdField = form.elements.password;
    pwdField.value = '';
    pwdField.required = !user;
    const pwdHelp = form.querySelector('#aa-pwd-help');
    if (pwdHelp) {
      pwdHelp.textContent = user ? 'Để trống nếu không đổi mật khẩu (12–72 ký tự)' : 'Mật khẩu khởi tạo tài khoản (12–72 ký tự)';
    }

    dialog.showModal();
    if (!user) form.elements.username.focus();
    else form.elements.full_name.focus();
  }

  function closeEditModal() {
    const dialog = root?.querySelector('#aa-dialog');
    if (dialog?.open) dialog.close();
  }

  function openPasswordModal(user) {
    if (!user) return;
    const dialog = root?.querySelector('#aa-pwd-dialog');
    const form = root?.querySelector('#aa-pwd-form');
    if (!dialog || !form) return;

    form.reset();
    form.elements.user_id.value = user.user_id;
    root.querySelector('#aa-pwd-username').textContent = user.username + ' (' + user.full_name + ')';
    const status = root.querySelector('#aa-pwd-status');
    if (status) { status.textContent = ''; status.className = 'aa-modal-status'; }

    dialog.showModal();
    form.elements.password.focus();
  }

  function closePasswordModal() {
    const dialog = root?.querySelector('#aa-pwd-dialog');
    if (dialog?.open) dialog.close();
  }

  async function load() {
    const [rowsRes, unitsRes, ctxRes] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/units'),
      api('/api/workspace/context')
    ]);
    units = unitsRes.data || [];
    plants = ctxRes.data?.plants || [];
    users = (rowsRes.data || []).map(u => ({
      ...u,
      unit_name: units.find(x => x.unit_id === u.unit_id)?.unit_name
    }));

    // Update unit options in modal
    const unitSelect = root?.querySelector('[name=unit_id]');
    if (unitSelect) {
      unitSelect.innerHTML = '<option value="">-- Chưa gán đơn vị --</option>' + units.map(u => `<option value="${u.unit_id}">${esc(u.unit_name)}</option>`).join('');
    }

    // Update plant scopes checkboxes in modal
    const plantsContainer = root?.querySelector('[data-aa-plants]');
    if (plantsContainer) {
      plantsContainer.innerHTML = plants.map(p => `
        <label class="aa-plant-item">
          <input name="plant_ids" type="checkbox" value="${p.plant_id}">
          <span>${esc(p.plant_name)}</span>
        </label>
      `).join('') || '<p class="muted">Chưa có nhà máy nào trong hệ thống.</p>';
    }

    draw();
  }

  async function render() {
    root = document.getElementById('account-admin-root');
    if (!root || loading) return;
    loading = true;

    root.innerHTML = `
      <style>
        /* Tối ưu giao diện riêng cho màn hình Quản lý tài khoản (Account Admin) */
        #account-admin-root .aa-main-table tbody td {
          color: var(--ink, #12262c);
        }

        /* --- CHẾ ĐỘ TỐI (DARK MODE) CHO RIÊNG MÀN HÌNH NÀY --- */
        [data-theme="dark"] #account-admin-root .aa-unified-card,
        [data-theme="dark"] #account-admin-root .aa-top-section,
        [data-theme="dark"] #account-admin-root .aa-table-container,
        :root:not([data-theme="light"]) #account-admin-root .aa-unified-card,
        :root:not([data-theme="light"]) #account-admin-root .aa-top-section,
        :root:not([data-theme="light"]) #account-admin-root .aa-table-container {
          background: var(--surface, #142429) !important;
          border-color: var(--line, #26393f) !important;
        }

        /* Chữ trong bảng rõ nét, màu trắng sáng tương phản cao trên nền tối */
        [data-theme="dark"] #account-admin-root .aa-main-table tbody td,
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table tbody td {
          color: #f1f5f9 !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }

        [data-theme="dark"] #account-admin-root .aa-main-table tbody tr.aa-user-row,
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table tbody tr.aa-user-row {
          background: transparent;
        }

        [data-theme="dark"] #account-admin-root .aa-main-table tbody tr:nth-child(even),
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.025) !important;
        }

        [data-theme="dark"] #account-admin-root .aa-main-table tbody tr:hover,
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table tbody tr:hover {
          background: rgba(56, 189, 248, 0.12) !important;
        }

        [data-theme="dark"] #account-admin-root .aa-main-table tbody tr.selected,
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table tbody tr.selected {
          background: rgba(13, 110, 110, 0.42) !important;
          box-shadow: inset 4px 0 0 #38bdf8 !important;
        }

        /* Tên tài khoản nổi bật với màu Cyan sáng */
        [data-theme="dark"] #account-admin-root .aa-user-name,
        :root:not([data-theme="light"]) #account-admin-root .aa-user-name {
          color: #38bdf8 !important;
          font-weight: 700;
        }

        /* Số thứ tự rõ ràng */
        [data-theme="dark"] #account-admin-root .aa-main-table td.num,
        :root:not([data-theme="light"]) #account-admin-root .aa-main-table td.num {
          color: #cbd5e1 !important;
          font-weight: 600;
        }

        /* Phạm vi nghiệp vụ & ghi chú */
        [data-theme="dark"] #account-admin-root .aa-scope-cell,
        :root:not([data-theme="light"]) #account-admin-root .aa-scope-cell {
          color: #f1f5f9 !important;
        }

        [data-theme="dark"] #account-admin-root .aa-scope-all,
        :root:not([data-theme="light"]) #account-admin-root .aa-scope-all {
          color: #34d399 !important;
          font-weight: 600;
        }

        [data-theme="dark"] #account-admin-root .aa-scope-cell .muted,
        :root:not([data-theme="light"]) #account-admin-root .aa-scope-cell .muted {
          color: #94a3b8 !important;
        }

        /* Tiêu đề & thanh công cụ / bộ lọc */
        [data-theme="dark"] #account-admin-root .aa-title,
        :root:not([data-theme="light"]) #account-admin-root .aa-title {
          color: #ffffff !important;
        }

        [data-theme="dark"] #account-admin-root .aa-filter-group label,
        :root:not([data-theme="light"]) #account-admin-root .aa-filter-group label {
          color: #cbd5e1 !important;
        }

        [data-theme="dark"] #account-admin-root .aa-filter-group select,
        [data-theme="dark"] #account-admin-root .aa-filter-group input,
        :root:not([data-theme="light"]) #account-admin-root .aa-filter-group select,
        :root:not([data-theme="light"]) #account-admin-root .aa-filter-group input {
          background: #1a2d33 !important;
          color: #ffffff !important;
          border-color: #26393f !important;
        }

        /* Nút hành động toolbar trong chế độ tối */
        [data-theme="dark"] #account-admin-root .aa-btn-action.btn-edit,
        :root:not([data-theme="light"]) #account-admin-root .aa-btn-action.btn-edit {
          background: #1a2d33 !important;
          color: #60a5fa !important;
          border-color: #3b82f6 !important;
        }

        [data-theme="dark"] #account-admin-root .aa-btn-action.btn-del,
        :root:not([data-theme="light"]) #account-admin-root .aa-btn-action.btn-del {
          background: #1a2d33 !important;
          color: #f87171 !important;
          border-color: #ef4444 !important;
        }

        [data-theme="dark"] #account-admin-root .aa-btn-action.btn-pwd,
        :root:not([data-theme="light"]) #account-admin-root .aa-btn-action.btn-pwd {
          background: #1a2d33 !important;
          color: #fbbf24 !important;
          border-color: #f59e0b !important;
        }

        /* Thẻ vai trò (Role Tags) trong chế độ tối */
        [data-theme="dark"] #account-admin-root .role-ADMIN,
        :root:not([data-theme="light"]) #account-admin-root .role-ADMIN {
          background: rgba(99, 102, 241, 0.22) !important;
          color: #a5b4fc !important;
          border: 1px solid rgba(99, 102, 241, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .role-OPERATOR,
        :root:not([data-theme="light"]) #account-admin-root .role-OPERATOR {
          background: rgba(20, 184, 166, 0.22) !important;
          color: #5eead4 !important;
          border: 1px solid rgba(20, 184, 166, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .role-ENGINEER,
        :root:not([data-theme="light"]) #account-admin-root .role-ENGINEER {
          background: rgba(249, 115, 22, 0.22) !important;
          color: #fdba74 !important;
          border: 1px solid rgba(249, 115, 22, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .role-VIEWER,
        :root:not([data-theme="light"]) #account-admin-root .role-VIEWER {
          background: rgba(168, 85, 247, 0.22) !important;
          color: #d8b4fe !important;
          border: 1px solid rgba(168, 85, 247, 0.4) !important;
        }

        /* Huy hiệu trạng thái (Status Badges) */
        [data-theme="dark"] #account-admin-root .badge-active,
        :root:not([data-theme="light"]) #account-admin-root .badge-active {
          background: rgba(34, 197, 94, 0.2) !important;
          color: #86efac !important;
          border-color: rgba(34, 197, 94, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .badge-locked,
        :root:not([data-theme="light"]) #account-admin-root .badge-locked {
          background: rgba(239, 68, 68, 0.2) !important;
          color: #fca5a5 !important;
          border-color: rgba(239, 68, 68, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .badge-inactive,
        :root:not([data-theme="light"]) #account-admin-root .badge-inactive {
          background: rgba(148, 163, 184, 0.15) !important;
          color: #cbd5e1 !important;
          border-color: rgba(148, 163, 184, 0.3) !important;
        }

        [data-theme="dark"] #account-admin-root .aa-warn-tag,
        :root:not([data-theme="light"]) #account-admin-root .aa-warn-tag {
          background: rgba(234, 88, 12, 0.25) !important;
          color: #fdba74 !important;
          border: 1px solid rgba(234, 88, 12, 0.4) !important;
        }

        [data-theme="dark"] #account-admin-root .aa-empty,
        :root:not([data-theme="light"]) #account-admin-root .aa-empty {
          color: #94a3b8 !important;
        }

        /* Hỗ trợ popup dialog modal khi ở chế độ tối */
        [data-theme="dark"] #aa-dialog.aa-modal-box,
        :root:not([data-theme="light"]) #aa-dialog.aa-modal-box {
          background: #142429 !important;
          color: #f1f5f9 !important;
          border: 1px solid #26393f !important;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8) !important;
        }

        [data-theme="dark"] #aa-dialog .aa-field-label,
        :root:not([data-theme="light"]) #aa-dialog .aa-field-label {
          color: #e2e8f0 !important;
        }

        [data-theme="dark"] #aa-dialog input.input,
        [data-theme="dark"] #aa-dialog select.input,
        :root:not([data-theme="light"]) #aa-dialog input.input,
        :root:not([data-theme="light"]) #aa-dialog select.input {
          background: #1a2d33 !important;
          color: #ffffff !important;
          border-color: #26393f !important;
        }

        [data-theme="dark"] #aa-dialog .aa-plants-fieldset,
        :root:not([data-theme="light"]) #aa-dialog .aa-plants-fieldset {
          border-color: #26393f !important;
        }

        [data-theme="dark"] #aa-dialog .aa-plants-fieldset legend,
        :root:not([data-theme="light"]) #aa-dialog .aa-plants-fieldset legend {
          color: #94a3b8 !important;
        }

        [data-theme="dark"] #aa-dialog .aa-plant-item,
        :root:not([data-theme="light"]) #aa-dialog .aa-plant-item {
          color: #e2e8f0 !important;
        }

        [data-theme="dark"] #aa-dialog .aa-modal-footer,
        :root:not([data-theme="light"]) #aa-dialog .aa-modal-footer {
          border-top-color: #26393f !important;
        }

        [data-theme="dark"] #aa-dialog .aa-btn-secondary,
        :root:not([data-theme="light"]) #aa-dialog .aa-btn-secondary {
          background: #1a2d33 !important;
          color: #fca5a5 !important;
          border-color: #ef4444 !important;
        }
      </style>
      <div class="aa-container">
        <!-- KHỐI CARD DUY NHẤT LIỀN MẠCH -->
        <div class="card aa-unified-card">
          <!-- PHẦN TRÊN: HEADER, TOOLBAR, TÌM KIẾM & BỘ LỌC -->
          <div class="aa-top-section">
            <div class="aa-header-row">
              <div>
                <h2 class="aa-title">Quản lý tài khoản người dùng</h2>
              </div>
              <a class="btn sm" href="/dashboard/accounts.html" title="Chuyển sang trang quản trị chi tiết">Quản trị nâng cao ↗</a>
            </div>

            <div class="aa-toolbar">
              <button type="button" class="btn aa-btn-action btn-add" data-aa-btn="add">
                <span class="aa-icon">✚</span> Thêm
              </button>
              <button type="button" class="btn aa-btn-action btn-edit" data-aa-btn="edit" disabled>
                <span class="aa-icon">✎</span> Sửa
              </button>
              <button type="button" class="btn aa-btn-action btn-del" data-aa-btn="delete" disabled>
                <span class="aa-icon">✕</span> Xóa
              </button>
              <button type="button" class="btn aa-btn-action btn-pwd" data-aa-btn="password" disabled>
                <span class="aa-icon">🔑</span> Đặt lại mật khẩu
              </button>
            </div>

            <!-- THANH TÌM KIẾM & BỘ LỌC -->
            <div class="aa-filter-bar">
              <div class="aa-filter-group">
                <label>Vai trò</label>
                <select class="input sm" data-aa-filter-role>
                  <option value="">Tất cả vai trò</option>
                  <option value="ADMIN">ADMIN (Quản trị)</option>
                  <option value="OPERATOR">OPERATOR (Vận hành)</option>
                  <option value="ENGINEER">ENGINEER (Kỹ sư)</option>
                  <option value="VIEWER">VIEWER (Giám sát)</option>
                </select>
              </div>
              <div class="aa-filter-group">
                <label>Trạng thái</label>
                <select class="input sm" data-aa-filter-status>
                  <option value="">Tất cả trạng thái</option>
                  <option value="ACTIVE">Hoạt động</option>
                  <option value="LOCKED">Đã khóa</option>
                  <option value="INACTIVE">Không dùng</option>
                </select>
              </div>
              <div class="aa-filter-group search-group">
                <label>Tìm kiếm</label>
                <div class="aa-search-wrap">
                  <input class="input sm" data-aa-search type="search" placeholder="Nhập tài khoản, họ tên, email...">
                  <span class="aa-search-icon">🔍</span>
                </div>
              </div>
            </div>
            <div data-aa-status class="aa-global-status"></div>
          </div>

          <!-- PHẦN DƯỚI: BẢNG CHÍNH LIỀN MẠCH -->
          <div class="aa-table-container">
            <div class="tbl-wrap aa-table-scroll">
              <table class="ui-table aa-main-table" data-no-paging>
                <thead>
                  <tr>
                    <th style="width:45px">STT</th>
                    <th>Tài khoản</th>
                    <th>Họ và tên</th>
                    <th>Vai trò</th>
                    <th>Đơn vị</th>
                    <th>Phạm vi được phép</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody data-aa-users>
                  <tr><td colspan="7" class="aa-empty">Đang tải danh sách tài khoản...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- POPUP DIALOG SỬA / THÊM TÀI KHOẢN -->
        <dialog id="aa-dialog" class="aa-modal-box">
          <div class="aa-modal-header">
            <h3 id="aa-modal-title">SỬA TÀI KHOẢN</h3>
            <button type="button" class="aa-modal-close" data-aa-close aria-label="Đóng">&times;</button>
          </div>
          <form id="aa-modal-form" class="aa-modal-body">
            <input name="id" type="hidden">
            <div class="aa-form-grid">
              <label class="aa-field">
                <span class="aa-field-label">Tài khoản <span class="aa-req">*</span></span>
                <input class="input" name="username" autocomplete="off" required maxlength="50" placeholder="ví dụ: nguyenvana">
              </label>

              <label class="aa-field">
                <span class="aa-field-label">Vai trò <span class="aa-req">*</span></span>
                <select class="input" name="role">
                  <option value="OPERATOR">OPERATOR (Vận hành)</option>
                  <option value="ENGINEER">ENGINEER (Kỹ sư)</option>
                  <option value="VIEWER">VIEWER (Giám sát)</option>
                  <option value="ADMIN">ADMIN (Quản trị)</option>
                </select>
              </label>

              <label class="aa-field">
                <span class="aa-field-label">Họ và tên <span class="aa-req">*</span></span>
                <input class="input" name="full_name" required maxlength="100" placeholder="Nguyễn Văn A">
              </label>

              <label class="aa-field">
                <span class="aa-field-label">Email liên hệ</span>
                <input class="input" name="email" type="email" placeholder="email@congty.vn">
              </label>

              <label class="aa-field">
                <span class="aa-field-label">Đơn vị quản lý</span>
                <select class="input" name="unit_id">
                  <option value="">-- Chưa gán đơn vị --</option>
                </select>
              </label>

              <label class="aa-field">
                <span class="aa-field-label">Trạng thái</span>
                <select class="input" name="status">
                  <option value="ACTIVE">Hoạt động (ACTIVE)</option>
                  <option value="LOCKED">Khóa (LOCKED)</option>
                  <option value="INACTIVE">Vô hiệu (INACTIVE)</option>
                </select>
              </label>

              <div class="aa-field-full">
                <label class="aa-checkbox-label">
                  <input type="checkbox" name="all_operation_scopes">
                  <span><strong>Toàn bộ phạm vi nghiệp vụ</strong> (Chỉ áp dụng cho OPERATOR, xem toàn bộ nhà máy)</span>
                </label>
              </div>

              <div class="aa-field-full">
                <fieldset class="aa-plants-fieldset">
                  <legend>Nhà máy được phép truy cập</legend>
                  <div data-aa-plants class="aa-plants-list"></div>
                </fieldset>
              </div>

              <label class="aa-field-full">
                <span class="aa-field-label">Mật khẩu mới / ban đầu</span>
                <input class="input" name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" placeholder="Tối thiểu 12 ký tự">
                <small id="aa-pwd-help" class="muted">Để trống nếu không đổi mật khẩu</small>
              </label>
            </div>

            <div data-aa-modal-status class="aa-modal-status"></div>

            <div class="aa-modal-footer">
              <button type="button" class="btn aa-btn-secondary" data-aa-close>Đóng</button>
              <button type="submit" class="btn primary aa-btn-primary">Lưu</button>
            </div>
          </form>
        </dialog>

        <!-- POPUP DIALOG ĐẶT LẠI MẬT KHẨU -->
        <dialog id="aa-pwd-dialog" class="aa-modal-box sm">
          <div class="aa-modal-header">
            <h3>ĐẶT LẠI MẬT KHẨU</h3>
            <button type="button" class="aa-modal-close" data-aa-pwd-close aria-label="Đóng">&times;</button>
          </div>
          <form id="aa-pwd-form" class="aa-modal-body">
            <input name="user_id" type="hidden">
            <p style="margin:0 0 12px">Đặt lại mật khẩu cho tài khoản: <strong id="aa-pwd-username"></strong></p>
            <label class="aa-field">
              <span class="aa-field-label">Mật khẩu mới <span class="aa-req">*</span></span>
              <input class="input" name="password" type="password" minlength="12" maxlength="72" required placeholder="Nhập ít nhất 12 ký tự" autocomplete="new-password">
              <small class="muted">Người dùng sẽ bắt buộc phải đổi mật khẩu ở lần đăng nhập tiếp theo.</small>
            </label>
            <div id="aa-pwd-status" class="aa-modal-status"></div>
            <div class="aa-modal-footer">
              <button type="button" class="btn aa-btn-secondary" data-aa-pwd-close>Đóng</button>
              <button type="submit" class="btn primary aa-btn-primary">Cập nhật mật khẩu</button>
            </div>
          </form>
        </dialog>
      </div>
    `;

    try {
      await load();
      // Select first user if exists
      if (users.length) selectRow(users[0].user_id);
    } catch (e) {
      setStatus(e.message, true);
    } finally {
      loading = false;
    }

    // Event listeners
    root.querySelector('[data-aa-search]')?.addEventListener('input', draw);
    root.querySelector('[data-aa-filter-role]')?.addEventListener('change', draw);
    root.querySelector('[data-aa-filter-status]')?.addEventListener('change', draw);

    // Row selection and double click
    const tbody = root.querySelector('[data-aa-users]');
    tbody?.addEventListener('click', e => {
      const tr = e.target.closest('[data-aa-user-row]');
      if (!tr) return;
      selectRow(Number(tr.dataset.userId));
    });

    tbody?.addEventListener('dblclick', e => {
      const tr = e.target.closest('[data-aa-user-row]');
      if (!tr) return;
      const uid = Number(tr.dataset.userId);
      selectRow(uid);
      const u = users.find(x => x.user_id === uid);
      if (u) openEditModal(u);
    });

    tbody?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const tr = e.target.closest('[data-aa-user-row]');
        if (tr) {
          const u = users.find(x => x.user_id === Number(tr.dataset.userId));
          if (u) openEditModal(u);
        }
      }
    });

    // Toolbar buttons
    root.querySelector('[data-aa-btn="add"]')?.addEventListener('click', () => openEditModal(null));
    root.querySelector('[data-aa-btn="edit"]')?.addEventListener('click', () => {
      const u = getSelectedUser();
      if (u) openEditModal(u);
      else setStatus('Vui lòng chọn một tài khoản để sửa', true);
    });

    root.querySelector('[data-aa-btn="delete"]')?.addEventListener('click', async () => {
      const u = getSelectedUser();
      if (!u) return setStatus('Vui lòng chọn một tài khoản để xóa', true);
      if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản "${u.username}" (${u.full_name})?`)) return;

      try {
        const res = await api(`/api/admin/users/${u.user_id}`, null, 'DELETE');
        setStatus(res.message || 'Đã xóa tài khoản');
        await load();
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    root.querySelector('[data-aa-btn="password"]')?.addEventListener('click', () => {
      const u = getSelectedUser();
      if (u) openPasswordModal(u);
      else setStatus('Vui lòng chọn một tài khoản để đặt lại mật khẩu', true);
    });

    // Modal role toggle for all_operation_scopes
    root.querySelector('[name=role]')?.addEventListener('change', e => {
      const c = root.querySelector('[name=all_operation_scopes]');
      if (c) {
        c.disabled = e.target.value !== 'OPERATOR';
        if (c.disabled) c.checked = false;
      }
    });

    // Modal close buttons
    root.querySelectorAll('[data-aa-close]').forEach(b => b.addEventListener('click', closeEditModal));
    root.querySelectorAll('[data-aa-pwd-close]').forEach(b => b.addEventListener('click', closePasswordModal));

    // Close when clicking dialog backdrop
    root.querySelector('#aa-dialog')?.addEventListener('click', e => {
      if (e.target.id === 'aa-dialog') closeEditModal();
    });
    root.querySelector('#aa-pwd-dialog')?.addEventListener('click', e => {
      if (e.target.id === 'aa-pwd-dialog') closePasswordModal();
    });

    // Form submit
    root.querySelector('#aa-modal-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      setModalStatus('');
      btn.disabled = true;

      try {
        const b = {};
        for (const k of ['username', 'full_name', 'email', 'role', 'status']) b[k] = f.elements[k].value;
        b.all_operation_scopes = f.elements.role.value === 'OPERATOR' && f.elements.all_operation_scopes.checked;
        b.unit_id = Number(f.elements.unit_id.value) || null;
        b.plant_ids = [...f.querySelectorAll('[name=plant_ids]:checked')].map(c => Number(c.value));
        const id = f.elements.id.value;
        if (!id) b.password = f.elements.password.value;
        else if (f.elements.password.value) b.password = f.elements.password.value;

        await api('/api/admin/users' + (id ? '/' + id : ''), b, id ? 'PUT' : 'POST');
        closeEditModal();
        setStatus(id ? `Đã cập nhật tài khoản ${b.username}` : `Đã thêm tài khoản mới ${b.username}`);
        await load();
        if (!id) {
          const created = users.find(u => u.username === b.username);
          if (created) selectRow(created.user_id);
        }
      } catch (err) {
        setModalStatus(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    // Password form submit
    root.querySelector('#aa-pwd-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const uid = f.elements.user_id.value;
      const pwd = f.elements.password.value;
      const btn = f.querySelector('button[type=submit]');
      const status = root.querySelector('#aa-pwd-status');
      btn.disabled = true;

      try {
        await api(`/api/admin/users/${uid}/password`, { password: pwd }, 'POST');
        closePasswordModal();
        setStatus('Đã đặt lại mật khẩu thành công. Người dùng phải đổi khi đăng nhập.');
        await load();
      } catch (err) {
        if (status) {
          status.textContent = err.message;
          status.className = 'aa-modal-status error';
        }
      } finally {
        btn.disabled = false;
      }
    });
  }

  window.AccountAdmin = { render };
})();
