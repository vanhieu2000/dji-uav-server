/* =====================================================================
   NHẬP EXCEL 2 BƯỚC: đọc file trên trình duyệt (SheetJS) -> kiểm tra -> ghi.
     GIS.Import.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const ENTITIES = {
    areas: { label: 'Khu vực pin', hint: 'Mỗi dòng một khu vực (inverter / block).' },
    strings: { label: 'Chuỗi pin', hint: 'Cần có khu vực trước. Nối với khu bằng area_code.' },
    panels: { label: 'Tấm pin', hint: 'Cần có chuỗi trước. Khóa: area_code + string_code + panel_index.' },
    bays: { label: 'Ngăn lộ', hint: 'Cần có trạm trước (tạo trong Cây tài sản). Nối bằng substation_code.' },
    disconnectors: { label: 'Dao cách ly', hint: 'Khóa: substation_code + bay_code + dcl_code + phase (A/B/C/3PHASE).' },
    contacts: { label: 'Mối nối DCL', hint: 'Khóa: dao cách ly (như trên) + contact_code.' }
  };

  // Tên cột tiếng Việt thường gặp -> tên cột chuẩn
  const ALIASES = {
    'mã khu vực': 'area_code', 'ma khu vuc': 'area_code', 'tên khu vực': 'area_name',
    'mã chuỗi': 'string_code', 'ma chuoi': 'string_code', 'tên chuỗi': 'string_name',
    'stt': 'panel_index', 'số thứ tự': 'panel_index', 'mã tấm': 'panel_serial', 'serial': 'panel_serial',
    'vĩ độ': 'latitude', 'vi do': 'latitude', 'lat': 'latitude', 'kinh độ': 'longitude', 'kinh do': 'longitude', 'lng': 'longitude', 'lon': 'longitude',
    'mã trạm': 'substation_code', 'mã ngăn lộ': 'bay_code', 'tên ngăn lộ': 'bay_name',
    'mã dcl': 'dcl_code', 'mã dao cách ly': 'dcl_code', 'pha': 'phase', 'ngưỡng nhiệt': 'max_allowed_temp',
    'mã mối nối': 'contact_code', 'vị trí': 'position_desc'
  };

  let columns = null;
  const st = { rows: null, fileName: '', checked: false };

  function normHeader(h) {
    const k = String(h || '').trim().toLowerCase();
    return ALIASES[k] || k.replace(/\s+/g, '_');
  }

  async function loadColumns() {
    if (!columns) columns = (await GIS.api('GET', '/api/assets/import/columns')).data.columns;
    return columns;
  }

  function entity(root) {
    return root.querySelector('#gis-imp-entity').value;
  }

  function renderColumns(root) {
    const ent = entity(root);
    const cols = columns ? columns[ent] : [];
    root.querySelector('#gis-imp-cols').innerHTML =
      `<p class="faint">${esc(ENTITIES[ent].hint)}</p><div class="gis-col-list">${cols.map(c => `<code>${esc(c)}</code>`).join(' ')}</div>`;
  }

  function downloadTemplate(root) {
    if (!window.XLSX) { GIS.toast('Chưa tải được thư viện Excel', 'error'); return; }
    const ent = entity(root);
    const ws = XLSX.utils.aoa_to_sheet([columns[ent]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, ent);
    XLSX.writeFile(wb, `mau_nhap_${ent}.xlsx`);
  }

  async function readFile(file) {
    if (!window.XLSX) throw new Error('Chưa tải được thư viện Excel');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    return raw.map((r, i) => {
      const out = { _row: i + 2 };
      Object.entries(r).forEach(([h, val]) => { out[normHeader(h)] = typeof val === 'string' ? val.trim() : val; });
      return out;
    }).filter(r => Object.keys(r).some(k => k !== '_row' && r[k] !== ''));
  }

  function renderResult(root, data, committed) {
    const s = data.summary || data;
    const errors = (data.rows || []).filter(r => r.action === 'error');
    root.querySelector('#gis-imp-result').innerHTML = `
      <div class="gis-imp-summary">
        <span class="tag info">Tổng ${s.total}</span>
        <span class="tag ok">Thêm mới ${s.insert}</span>
        <span class="tag warn">Cập nhật ${s.update}</span>
        <span class="tag ${s.error ? 'bad' : 'off'}">Lỗi ${s.error}</span>
        ${committed ? `<b>✓ Đã ghi ${data.written} dòng.</b>` : ''}
      </div>
      ${errors.length ? `<div class="tbl-wrap gis-imp-errors"><table><thead><tr><th>Dòng</th><th>Lỗi</th></tr></thead><tbody>
        ${errors.slice(0, 300).map(r => `<tr><td class="num">${r.row}</td><td>${esc(r.errors.join('; '))}</td></tr>`).join('')}
        </tbody></table>${errors.length > 300 ? `<p class="faint">... và ${errors.length - 300} dòng lỗi khác</p>` : ''}</div>` : ''}`;
  }

  async function check(root) {
    if (!st.rows) { GIS.toast('Chọn file trước', 'error'); return; }
    const res = await GIS.run(() => GIS.api('POST', '/api/assets/import/check', { entity: entity(root), rows: st.rows }));
    if (!res) return;
    st.checked = true;
    renderResult(root, res.data, false);
    const commit = root.querySelector('#gis-imp-commit');
    commit.disabled = res.data.summary.insert + res.data.summary.update === 0;
  }

  async function commit(root) {
    const skip = root.querySelector('#gis-imp-skip').checked;
    const res = await GIS.run(() => GIS.api('POST', '/api/assets/import/commit', { entity: entity(root), rows: st.rows, skip_errors: skip }));
    if (!res) return;
    GIS.toast(res.message);
    renderResult(root, res.data, true);
    root.querySelector('#gis-imp-commit').disabled = true;
    GIS.emit('assets-changed');
  }

  GIS.Import = {
    async render(root) {
      if (root.dataset.ready) return;
      root.dataset.ready = '1';
      root.innerHTML = `
        <div class="gis-import">
          <section class="card">
            <h2>Nhập danh mục tài sản từ Excel</h2>
            <p class="faint">Bước 1: chọn loại và tải file mẫu. Bước 2: chọn file, bấm <b>Kiểm tra</b>. Bước 3: xem lỗi rồi bấm <b>Ghi vào hệ thống</b>.
              Ô để trống khi cập nhật sẽ giữ nguyên giá trị cũ.</p>
            <div class="gis-row gis-imp-controls">
              <div class="field"><label for="gis-imp-entity">Loại dữ liệu</label>
                <select class="input" id="gis-imp-entity">${Object.entries(ENTITIES).map(([k, e]) => `<option value="${k}">${e.label}</option>`).join('')}</select></div>
              <button class="btn" type="button" id="gis-imp-template">⬇️ Tải file mẫu</button>
              <div class="field"><label for="gis-imp-file">File Excel / CSV</label>
                <input class="input" id="gis-imp-file" type="file" accept=".xlsx,.xls,.csv"></div>
            </div>
            <div id="gis-imp-cols"></div>
            <div class="gis-row">
              <button class="btn" type="button" id="gis-imp-check">🔍 Kiểm tra</button>
              <label class="gis-check"><input type="checkbox" id="gis-imp-skip"> Bỏ qua dòng lỗi</label>
              <button class="btn primary" type="button" id="gis-imp-commit" disabled>💾 Ghi vào hệ thống</button>
              <span class="faint" id="gis-imp-file-info"></span>
            </div>
            <div id="gis-imp-result"></div>
          </section>
        </div>`;
      try {
        await loadColumns();
      } catch (e) {
        root.querySelector('#gis-imp-cols').innerHTML = `<p class="gis-error">${esc(e.message)}</p>`;
      }
      renderColumns(root);
      const reset = () => { st.checked = false; root.querySelector('#gis-imp-commit').disabled = true; root.querySelector('#gis-imp-result').innerHTML = ''; };
      root.querySelector('#gis-imp-entity').addEventListener('change', () => { renderColumns(root); reset(); });
      root.querySelector('#gis-imp-template').addEventListener('click', () => downloadTemplate(root));
      root.querySelector('#gis-imp-file').addEventListener('change', async e => {
        reset();
        const file = e.target.files[0];
        st.rows = null;
        if (!file) return;
        try {
          st.rows = await readFile(file);
          root.querySelector('#gis-imp-file-info').textContent = `${file.name}: ${st.rows.length} dòng dữ liệu`;
        } catch (err) {
          GIS.toast('Không đọc được file: ' + err.message, 'error');
        }
      });
      root.querySelector('#gis-imp-check').addEventListener('click', () => check(root));
      root.querySelector('#gis-imp-commit').addEventListener('click', () => commit(root));
    }
  };
})();
