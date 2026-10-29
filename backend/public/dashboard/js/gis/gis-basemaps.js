/* =====================================================================
   BẢN ĐỒ NỀN NHÀ MÁY: tải ZIP ô ảnh, xem trước, đặt mặc định, xóa.
     GIS.BaseMaps.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = { root: null, map: null, preview: null, list: [] };

  function sizeText(bytes) {
    const n = Number(bytes) || 0;
    if (n > 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB';
    if (n > 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
    return Math.round(n / 1024) + ' KB';
  }

  /** Tải lên bằng XHR để hiện tiến độ (fetch chưa báo tiến độ upload). */
  function uploadWithProgress(form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/basemaps/upload');
      xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let json = null;
        try { json = JSON.parse(xhr.responseText); } catch (e) { /* không phải JSON */ }
        if (xhr.status === 200 && json && json.code === 0) resolve(json);
        else reject(new Error((json && json.message) || `Lỗi tải lên (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Mất kết nối khi tải lên'));
      xhr.send(form);
    });
  }

  async function loadList() {
    st.list = await GIS.getBaseMaps();
    const el = st.root.querySelector('#gis-bm-list');
    el.innerHTML = st.list.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Tên</th><th>Zoom</th><th>Số ô ảnh</th><th>Dung lượng</th><th>Độ mờ</th><th>Mặc định</th><th></th></tr></thead>
      <tbody>${st.list.map(m => `<tr data-id="${m.map_id}">
        <td><b>${esc(m.map_name)}</b><div class="faint">${esc(m.map_code)} · ${esc(m.scheme.toUpperCase())}</div></td>
        <td class="num">${m.min_zoom}–${m.max_zoom}</td>
        <td class="num">${Number(m.tile_count).toLocaleString('vi-VN')}</td>
        <td class="num">${sizeText(m.size_bytes)}</td>
        <td><input class="input gis-bm-opacity" type="range" min="0.1" max="1" step="0.1" value="${m.opacity}" aria-label="Độ mờ"></td>
        <td><input type="radio" name="gis-bm-active" ${m.is_active ? 'checked' : ''} aria-label="Đặt làm mặc định"></td>
        <td class="gis-row"><button class="btn sm" data-act="preview">Xem</button><button class="btn sm danger" data-act="delete">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="gis-empty">Chưa có bản đồ nền nào. Tải file ZIP ô ảnh lên ở trên.</div>';
  }

  function preview(m) {
    st.root.querySelector('#gis-bm-preview').hidden = false;
    if (!st.map) {
      st.map = L.map(st.root.querySelector('#gis-bm-map'), { zoom: 16, center: [16.0, 108.0] });
      const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
      if (sat) L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
    }
    if (st.preview) st.map.removeLayer(st.preview);
    const opts = { maxZoom: 22, maxNativeZoom: m.max_zoom, minNativeZoom: m.min_zoom, tms: m.scheme === 'tms', opacity: m.opacity };
    if (m.bounds) opts.bounds = L.latLngBounds(m.bounds);
    st.preview = L.tileLayer(m.tile_url, opts).addTo(st.map);
    if (m.bounds) st.map.fitBounds(m.bounds);
    setTimeout(() => st.map.invalidateSize(), 50);
  }

  async function onListClick(e) {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const m = st.list.find(x => x.map_id === Number(row.dataset.id));
    const act = e.target.closest('[data-act]');
    if (e.target.name === 'gis-bm-active') {
      const res = await GIS.run(() => GIS.api('PUT', `/api/basemaps/${m.map_id}`, { is_active: true }), 'Đã đặt làm bản đồ nền mặc định');
      if (res) {
        GIS.emit('basemaps-changed');
        if (window.fetchActivePlantBasemap) window.fetchActivePlantBasemap().then(()=>{ if(window.setBasemap) window.setBasemap('plant_upload'); });
        loadList();
      }
      return;
    }
    if (!act) return;
    if (act.dataset.act === 'preview') preview(m);
    if (act.dataset.act === 'delete') {
      if (!window.confirm(`Xóa bản đồ nền "${m.map_name}" và toàn bộ ${m.tile_count} ô ảnh trên máy chủ?`)) return;
      const res = await GIS.run(() => GIS.api('DELETE', `/api/basemaps/${m.map_id}`), 'Đã xóa bản đồ nền');
      if (res) { GIS.emit('basemaps-changed'); loadList(); }
    }
  }

  async function onOpacity(e) {
    if (!e.target.classList.contains('gis-bm-opacity')) return;
    const id = Number(e.target.closest('tr').dataset.id);
    const res = await GIS.run(() => GIS.api('PUT', `/api/basemaps/${id}`, { opacity: e.target.value }));
    if (res) GIS.emit('basemaps-changed');
  }

  async function onUpload(e) {
    e.preventDefault();
    const formEl = e.target;
    const file = formEl.querySelector('#gis-bm-file').files[0];
    if (!file) { GIS.toast('Chọn file ZIP', 'error'); return; }
    const form = new FormData();
    form.append('map_name', formEl.querySelector('#gis-bm-name').value);
    form.append('scheme', formEl.querySelector('#gis-bm-scheme').value);
    form.append('file', file);
    const bar = formEl.querySelector('#gis-bm-progress');
    const btn = formEl.querySelector('button[type="submit"]');
    btn.disabled = true;
    bar.hidden = false;
    try {
      const res = await uploadWithProgress(form, p => {
        bar.value = p;
        btn.textContent = p < 1 ? `Đang tải ${Math.round(p * 100)}%...` : 'Đang giải nén...';
      });
      GIS.toast(res.message);
      formEl.reset();
      GIS.emit('basemaps-changed');
      if (window.fetchActivePlantBasemap) window.fetchActivePlantBasemap().then(()=>{ if(window.setBasemap) window.setBasemap('plant_upload'); });
      await loadList();
      preview(res.data);
    } catch (err) {
      GIS.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⬆️ Tải lên';
      bar.hidden = true;
    }
  }

  async function onScan(e) {
    e.preventDefault();
    const f = e.target;
    const res = await GIS.run(() => GIS.api('POST', '/api/basemaps/scan', {
      map_code: f.querySelector('#gis-bm-scan-code').value,
      map_name: f.querySelector('#gis-bm-scan-name').value,
      scheme: f.querySelector('#gis-bm-scan-scheme').value
    }));
    if (!res) return;
    GIS.toast(res.message);
    f.reset();
    GIS.emit('basemaps-changed');
    if (window.fetchActivePlantBasemap) window.fetchActivePlantBasemap().then(()=>{ if(window.setBasemap) window.setBasemap('plant_upload'); });
    loadList();
  }

  GIS.BaseMaps = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-basemaps">
            <section class="card">
              <h2>Bản đồ nền nhà máy</h2>
              <p class="faint">Xuất ảnh bay của nhà máy thành <b>ô ảnh XYZ/TMS</b> (DJI Terra, Pix4D, QGIS "Generate XYZ tiles"...),
                nén thư mục thành file .zip có cấu trúc <code>{z}/{x}/{y}.png</code> rồi tải lên. File lớn (vài GB) nên chép thẳng vào
                <code>backend/tiles/basemaps/&lt;mã&gt;</code> trên máy chủ và dùng mục "Đăng ký thư mục có sẵn".</p>
              <form id="gis-bm-upload" class="gis-row gis-bm-form">
                <div class="field"><label for="gis-bm-name">Tên bản đồ *</label><input class="input" id="gis-bm-name" required placeholder="VD: Ảnh bay Thác Mơ 10/2026"></div>
                <div class="field"><label for="gis-bm-scheme">Kiểu ô ảnh</label><select class="input" id="gis-bm-scheme"><option value="XYZ">XYZ (Google/OSM)</option><option value="TMS">TMS (trục Y ngược)</option></select></div>
                <div class="field"><label for="gis-bm-file">File ZIP *</label><input class="input" id="gis-bm-file" type="file" accept=".zip" required></div>
                <button class="btn primary" type="submit">⬆️ Tải lên</button>
                <progress id="gis-bm-progress" max="1" value="0" hidden></progress>
              </form>
              <details class="gis-details"><summary>Quy trình tạo bản đồ nền từ ảnh bay (quét 2D)</summary>
                <ol class="gis-steps">
                  <li><b>Vẽ ranh giới</b> nhà máy (hoặc khu) ở tab <i>Cây tài sản &amp; bản đồ</i>.</li>
                  <li><b>Lập đường bay</b> với hồ sơ <i>Quét bản đồ 2D</i> (camera rộng, chồng ảnh 80/70 %), chọn "Toàn nhà máy" hoặc khu, gán vào một phiếu.</li>
                  <li><b>Bay</b> khi trời sáng đều, ít bóng, RTK FIX. Ảnh tự về server hoặc nhập ở tab <i>Nhập ảnh thẻ nhớ</i>.</li>
                  <li><b>Lấy ảnh</b> ở tab <i>Xuất ảnh cho Vision</i>: lọc theo phiếu, chỉ camera Rộng → tải ZIP.</li>
                  <li><b>Ghép ảnh</b> bằng DJI Terra (Tái tạo 2D → xuất GeoTIFF) hoặc phần mềm tương đương (Pix4D, WebODM).</li>
                  <li><b>Cắt ô ảnh</b>: QGIS → Processing → <i>Generate XYZ tiles (Directory)</i>, zoom khoảng 16–22, PNG/JPG → nén thư mục thành ZIP.</li>
                  <li><b>Tải lên</b> ở mục trên, bấm <i>Xem</i> để kiểm tra, đặt làm bản đồ nền mặc định.</li>
                </ol>
                <p class="faint">Lưu ý: module RTK cho M3T cho vị trí ảnh chính xác cm, nhưng M3T không phải dòng đo đạc (như M3E) – bản đồ đủ dùng làm nền và vẽ tài sản; nếu cần bản đồ chuẩn đo đạc, hỏi đại lý DJI hoặc dùng điểm khống chế mặt đất (GCP).</p>
              </details>
              <details class="gis-details"><summary>Đăng ký thư mục có sẵn trên máy chủ</summary>
                <form id="gis-bm-scan" class="gis-row gis-bm-form">
                  <div class="field"><label for="gis-bm-scan-code">Tên thư mục *</label><input class="input" id="gis-bm-scan-code" required placeholder="thac-mo-2026"></div>
                  <div class="field"><label for="gis-bm-scan-name">Tên hiển thị</label><input class="input" id="gis-bm-scan-name"></div>
                  <div class="field"><label for="gis-bm-scan-scheme">Kiểu ô ảnh</label><select class="input" id="gis-bm-scan-scheme"><option>XYZ</option><option>TMS</option></select></div>
                  <button class="btn" type="submit">Đăng ký</button>
                </form>
              </details>
            </section>
            <section class="card flat" id="gis-bm-list"></section>
            <section class="card flat gis-bm-preview" id="gis-bm-preview" hidden><div id="gis-bm-map"></div></section>
          </div>`;
        root.querySelector('#gis-bm-upload').addEventListener('submit', onUpload);
        root.querySelector('#gis-bm-scan').addEventListener('submit', onScan);
        root.querySelector('#gis-bm-list').addEventListener('click', onListClick);
        root.querySelector('#gis-bm-list').addEventListener('change', onOpacity);
      }
      await loadList();
      if (st.map) setTimeout(() => st.map.invalidateSize(), 50);
    }
  };
})();
