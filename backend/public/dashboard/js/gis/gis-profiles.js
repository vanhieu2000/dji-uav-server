/* =====================================================================
   HỒ SƠ CHỤP ẢNH (Giai đoạn A1): danh sách + form + tính thử hình học chụp.
     GIS.Profiles.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const PURPOSE_LABELS = {
    MAP_2D: 'Quét bản đồ 2D', SOLAR_THERMAL: 'Quét nhiệt pin', CLOSE_UP: 'Chụp cận lỗi',
    DCL_POINT: 'DCL điểm cố định', TRAINING: 'Dữ liệu huấn luyện', CUSTOM: 'Tùy chỉnh'
  };
  const LENS_LABELS = { ir: 'Nhiệt', wide: 'Rộng', zoom: 'Zoom' };

  // [key, nhãn, kiểu, tùy chọn]; kiểu: text | num | select | lenses | time | check | area
  const FIELDS = [
    ['profile_code', 'Mã hồ sơ *', 'text'],
    ['profile_name', 'Tên hồ sơ *', 'text'],
    ['purpose', 'Mục đích', 'select', Object.entries(PURPOSE_LABELS)],
    ['route_kind', 'Kiểu tuyến', 'select', [['GRID', 'Quét lưới phủ khu'], ['POINTS', 'Dừng chụp tại điểm']]],
    ['lenses', 'Camera chụp *', 'lenses'],
    ['gsd_lens', 'Camera tính độ phân giải', 'select', [['ir', 'Nhiệt'], ['wide', 'Rộng'], ['zoom', 'Zoom']]],
    ['target_gsd_cm', 'Độ phân giải mong muốn (cm/điểm ảnh)', 'num'],
    ['altitude_m', 'Hoặc độ cao cố định (m)', 'num'],
    ['front_overlap_pct', 'Chồng ảnh dọc (%)', 'num'],
    ['side_overlap_pct', 'Chồng ảnh ngang (%)', 'num'],
    ['speed_mps', 'Tốc độ tối đa (m/s)', 'num'],
    ['gimbal_pitch', 'Góc gimbal (°, −90 = nhìn thẳng xuống)', 'num'],
    ['heading_mode', 'Hướng đường bay', 'select', [['ALONG_ROWS', 'Dọc dãy pin'], ['AUTO', 'Theo cạnh dài khu'], ['FIXED', 'Góc cố định']]],
    ['heading_deg', 'Góc hướng cố định (°)', 'num'],
    ['trigger_mode', 'Kiểu chụp', 'select', [['DISTANCE', 'Mỗi N mét'], ['TIME', 'Mỗi N giây'], ['POINT', 'Tại điểm']]],
    ['trigger_interval', 'N mét / giây (trống = tự tính)', 'num'],
    ['zoom_factor', 'Độ zoom (lần)', 'num'],
    ['hover_seconds', 'Dừng tại điểm (s)', 'num'],
    ['photos_per_point', 'Số ảnh mỗi điểm', 'num'],
    ['margin_m', 'Nới ra ngoài ranh giới (m)', 'num'],
    ['min_irradiance_wm2', 'Bức xạ tối thiểu (W/m²)', 'num'],
    ['time_window_start', 'Bay từ giờ', 'time'],
    ['time_window_end', 'Đến giờ', 'time'],
    ['require_rtk', 'Bắt buộc RTK FIX', 'check'],
    ['notes', 'Ghi chú', 'area']
  ];

  const st = { root: null, list: [], sel: null };

  function fieldHtml([key, label, kind, opts], p) {
    const val = p[key] == null ? '' : p[key];
    const id = `gis-pf-${key}`;
    if (kind === 'select') {
      return `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}" name="${key}">
        ${opts.map(([v, t]) => `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
    }
    if (kind === 'lenses') {
      const set = String(val).split(',');
      return `<div class="field"><span class="gis-field-label">${label}</span><div class="gis-row">
        ${Object.entries(LENS_LABELS).map(([k, t]) => `<label class="gis-check"><input type="checkbox" name="lens" value="${k}" ${set.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}
      </div></div>`;
    }
    if (kind === 'check') {
      return `<label class="gis-check"><input type="checkbox" name="${key}" ${val ? 'checked' : ''}> ${label}</label>`;
    }
    if (kind === 'area') {
      return `<div class="field gis-span2"><label for="${id}">${label}</label><textarea class="input gis-textarea" id="${id}" name="${key}" rows="2">${esc(val)}</textarea></div>`;
    }
    const v = kind === 'time' && val ? String(val).slice(0, 5) : val;
    return `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="${key}"
      ${kind === 'time' ? 'type="time"' : 'type="text"'} ${kind === 'num' ? 'inputmode="decimal"' : ''} value="${esc(v)}"></div>`;
  }

  function readForm(form) {
    const out = {};
    FIELDS.forEach(([key, , kind]) => {
      if (kind === 'lenses') {
        out.lenses = [...form.querySelectorAll('input[name="lens"]:checked')].map(i => i.value).join(',');
      } else if (kind === 'check') {
        out[key] = form.querySelector(`[name="${key}"]`).checked;
      } else {
        const el = form.querySelector(`[name="${key}"]`);
        const s = el.value.trim();
        out[key] = s === '' ? null : s;
      }
    });
    return out;
  }

  function geometryHtml(g) {
    if (!g) return '';
    const gsd = Object.entries(g.gsd_cm || {}).map(([l, v]) => `${LENS_LABELS[l] || l}: <b>${esc(v)}</b> cm`).join(' · ');
    return `<dl class="kv gis-geo">
      <dt>Độ cao bay</dt><dd><b>${esc(g.altitude_m)}</b> m</dd>
      <dt>Độ phân giải</dt><dd>${gsd}</dd>
      <dt>Vệt chụp (ngang × dọc)</dt><dd>${esc(g.footprint_m ? g.footprint_m.across : '--')} × ${esc(g.footprint_m ? g.footprint_m.along : '--')} m</dd>
      ${g.line_spacing_m != null ? `<dt>Khoảng cách 2 đường bay</dt><dd><b>${esc(g.line_spacing_m)}</b> m</dd>` : ''}
      ${g.trigger_distance_m != null ? `<dt>Chụp mỗi</dt><dd><b>${esc(g.trigger_distance_m)}</b> m${g.trigger_interval_s ? ` (${esc(g.trigger_interval_s)} s)` : ''}</dd>` : ''}
      <dt>Tốc độ dùng</dt><dd>${esc(g.max_speed_mps)} m/s</dd>
    </dl>
    ${(g.warnings || []).map(w => `<div class="gis-warn">⚠ ${esc(w)}</div>`).join('')}`;
  }

  function renderList() {
    const el = st.root.querySelector('#gis-pf-list');
    if (!el) return;
    el.innerHTML = st.list.map(p => `
      <button type="button" class="gis-pf-item ${st.sel && st.sel.profile_id === p.profile_id ? 'on' : ''}" data-id="${p.profile_id}">
        <b>${esc(p.profile_name)}</b>
        <span class="faint">${esc(PURPOSE_LABELS[p.purpose] || p.purpose)} · ${p.lenses.split(',').map(l => LENS_LABELS[l] || l).join(' + ')}
          ${p.geometry && p.route_kind === 'GRID' ? ` · ${esc(p.geometry.altitude_m)} m` : ''}</span>
        ${p.is_system ? '<span class="gis-chip">mặc định</span>' : ''}
      </button>`).join('') || '<div class="gis-empty">Chưa có hồ sơ</div>';
  }

  function updateActiveItem(profileId) {
    const listEl = st.root.querySelector('#gis-pf-list');
    if (!listEl) return;
    listEl.querySelectorAll('.gis-pf-item').forEach(btn => {
      btn.classList.toggle('on', profileId != null && Number(btn.dataset.id) === Number(profileId));
    });
  }

  function renderForm(p, isNew) {
    st.sel = isNew ? null : p;
    const el = st.root.querySelector('#gis-pf-detail');
    el.innerHTML = `
      <form id="gis-pf-form" class="gis-pf-form" autocomplete="off">
        <div class="gis-pf-grid">${FIELDS.map(f => fieldHtml(f, p)).join('')}</div>
        <div class="gis-row gis-actions">
          <button class="btn primary" type="submit">💾 Lưu</button>
          ${!isNew && !p.is_system ? '<button class="btn danger" type="button" data-act="delete">Xóa</button>' : ''}
          ${!isNew ? '<button class="btn" type="button" data-act="copy">Nhân bản</button>' : ''}
        </div>
      </form>
      <section class="gis-pf-preview"><h3>Kết quả tính</h3><div id="gis-pf-geo">${geometryHtml(p.geometry)}</div></section>`;
    const form = el.querySelector('#gis-pf-form');
    form.addEventListener('submit', e => { e.preventDefault(); save(form, isNew); });
    form.addEventListener('input', debounce(() => preview(form), 350));
    form.addEventListener('change', debounce(() => preview(form), 100));
    updateActiveItem(st.sel ? st.sel.profile_id : null);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  async function preview(form) {
    const box = st.root.querySelector('#gis-pf-geo');
    try {
      const r = await GIS.api('POST', '/api/capture-profiles/preview', readForm(form));
      box.innerHTML = geometryHtml(r.data);
    } catch (e) {
      box.innerHTML = `<div class="gis-warn">${esc(e.message)}</div>`;
    }
  }

  async function save(form, isNew) {
    const body = readForm(form);
    const res = await GIS.run(() => GIS.api(isNew ? 'POST' : 'PUT', isNew ? '/api/capture-profiles' : `/api/capture-profiles/${st.sel.profile_id}`, body));
    if (!res) return;
    GIS.toast(res.message);
    await load();
    renderForm(st.list.find(p => p.profile_id === res.data.profile_id) || res.data, false);
  }

  async function load() {
    const res = await GIS.run(() => GIS.api('GET', '/api/capture-profiles'));
    st.list = res ? res.data : [];
    renderList();
  }

  async function onClick(e) {
    const item = e.target.closest('.gis-pf-item');
    if (item) { renderForm(st.list.find(p => p.profile_id === Number(item.dataset.id)), false); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'new') {
      renderForm({ purpose: 'CUSTOM', route_kind: 'GRID', lenses: 'ir,wide', gsd_lens: 'ir', target_gsd_cm: 5, front_overlap_pct: 70,
        side_overlap_pct: 30, speed_mps: 5, gimbal_pitch: -90, heading_mode: 'ALONG_ROWS', trigger_mode: 'DISTANCE',
        hover_seconds: 0, photos_per_point: 1, margin_m: 5, require_rtk: true }, true);
    }
    if (act.dataset.act === 'copy' && st.sel) {
      renderForm({ ...st.sel, profile_code: `${st.sel.profile_code}_COPY`, profile_name: `${st.sel.profile_name} (bản sao)`, is_system: false }, true);
    }
    if (act.dataset.act === 'delete' && st.sel) {
      if (!window.confirm(`Xóa hồ sơ "${st.sel.profile_name}"?`)) return;
      const res = await GIS.run(() => GIS.api('DELETE', `/api/capture-profiles/${st.sel.profile_id}`), 'Đã xóa hồ sơ chụp');
      if (!res) return;
      st.sel = null;
      st.root.querySelector('#gis-pf-detail').innerHTML = '<div class="gis-empty">Chọn một hồ sơ bên trái.</div>';
      load();
    }
  }

  GIS.Profiles = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-profiles">
            <section class="card flat gis-pf-side">
              <div class="gis-row gis-pf-head"><h2>Hồ sơ chụp</h2><button class="btn sm primary" type="button" data-act="new">+ Tạo hồ sơ</button></div>
              <p class="faint gis-pf-hint">Hồ sơ quyết định máy bay chụp thế nào: camera nào, độ cao, độ chồng ảnh, chụp mỗi bao nhiêu mét hoặc dừng tại điểm.
                Khi lập đường bay, chọn khu / tài sản + hồ sơ, phần mềm tự sinh file KMZ.</p>
              <div id="gis-pf-list" class="gis-pf-list"></div>
            </section>
            <section class="card gis-pf-detail" id="gis-pf-detail"><div class="gis-empty">Chọn một hồ sơ bên trái.</div></section>
          </div>`;
        root.addEventListener('click', onClick);
      }
      await load();
    }
  };
})();
