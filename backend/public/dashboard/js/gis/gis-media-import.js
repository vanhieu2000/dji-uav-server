/* =====================================================================
   NHẬP ẢNH TỪ THẺ NHỚ (Giai đoạn A3): chọn phiếu → chọn thư mục ảnh → tải theo lô.
     GIS.MediaImport.render(rootElement)
   Server đọc vị trí RTK, gimbal, ống kính từ chính ảnh; ghép điểm chụp; bỏ ảnh trùng.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;
  const BATCH = 20; // số ảnh mỗi lần gửi (server nhận tối đa 100)

  const st = { root: null, files: [], results: [], busy: false };
  const LENS = { IR: 'Nhiệt', WIDE: 'Rộng', ZOOM: 'Zoom', UNKNOWN: '?' };
  const QUALITY = { HIGH: ['ok', 'RTK FIX'], LOW: ['warn', 'Không FIX'], UNKNOWN: ['off', 'Không có GPS'] };
  const STATUS = { created: ['ok', 'Mới'], duplicate: ['off', 'Trùng'], failed: ['bad', 'Lỗi'], skipped: ['off', 'Bỏ qua'] };

  async function loadTickets() {
    const res = await GIS.run(() => GIS.api('GET', '/api/tickets'));
    const sel = st.root.querySelector('#gis-mi-ticket');
    const list = res ? res.data : [];
    sel.innerHTML = list.length
      ? list.map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)} (${esc(t.status)})</option>`).join('')
      : '<option value="">Chưa có phiếu nào – tạo phiếu trước</option>';
  }

  async function loadRoutes() {
    const res = await GIS.run(() => GIS.api('GET', '/api/flight-plans'));
    st.root.querySelector('#gis-mi-route').innerHTML = '<option value="">(không chọn)</option>' +
      (res ? res.data : []).map(r => `<option value="${r.route_id}">${esc(r.route_name)}</option>`).join('');
  }

  function onPick(e) {
    for(const id of ['gis-mi-dir','gis-mi-files']){const other=st.root.querySelector('#'+id);if(other!==e.target&&other.files.length){other.value='';other.dispatchEvent(new Event('uav:file-reset'));}}
    st.files = [...e.target.files].filter(f => /\.jpe?g$/i.test(f.name));
    const total = st.files.reduce((s, f) => s + f.size, 0);
    st.root.querySelector('#gis-mi-info').textContent =
      `${st.files.length} ảnh JPG (${(total / 1024 / 1024).toFixed(1)} MB)` + (e.target.files.length > st.files.length ? `, bỏ qua ${e.target.files.length - st.files.length} file khác` : '');
    st.root.querySelector('#gis-mi-start').disabled = !st.files.length;
  }

  function renderResults() {
    const r = st.results;
    const count = k => r.filter(x => x.status === k).length;
    const lowRtk = r.filter(x => x.position_quality && x.position_quality !== 'HIGH').length;
    st.root.querySelector('#gis-mi-result').innerHTML = !r.length ? '' : `
      <div class="gis-imp-summary">
        <span class="tag ok">Mới ${count('created')}</span>
        <span class="tag off">Trùng ${count('duplicate')}</span>
        <span class="tag ${count('failed') ? 'bad' : 'off'}">Lỗi ${count('failed')}</span>
        ${lowRtk ? `<span class="tag warn">${lowRtk} ảnh vị trí kém chính xác (không RTK FIX)</span>` : ''}
      </div>
      <div class="tbl-wrap gis-imp-errors"><table>
        <thead><tr><th>Ảnh</th><th>Kết quả</th><th>Camera</th><th>Vị trí</th><th>Điểm chụp</th></tr></thead>
        <tbody>${r.slice(0, 500).map(x => `<tr>
          <td>${esc(x.name)}</td>
          <td><span class="tag ${STATUS[x.status] ? STATUS[x.status][0] : 'off'}">${STATUS[x.status] ? STATUS[x.status][1] : esc(x.status)}</span>${x.error || x.note ? ` <span class="faint">${esc(x.error || x.note)}</span>` : ''}</td>
          <td>${esc(LENS[x.lens] || '')}</td>
          <td>${x.position_quality ? `<span class="tag ${QUALITY[x.position_quality][0]}">${QUALITY[x.position_quality][1]}</span>` : ''}</td>
          <td>${x.photo_point_id ? `#${esc(x.photo_point_id)}` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  async function start() {
    const ticketId = st.root.querySelector('#gis-mi-ticket').value;
    if (!ticketId) { GIS.toast('Chọn phiếu kiểm tra', 'error'); return; }
    if (!st.files.length || st.busy) return;
    st.busy = true;
    st.root.querySelectorAll('input[type=file],.ui-file-toolbar button,#gis-mi-ticket,#gis-mi-route').forEach(el=>el.disabled=true);
    st.results = [];
    const btn = st.root.querySelector('#gis-mi-start');
    const bar = st.root.querySelector('#gis-mi-progress');
    btn.disabled = true;
    bar.hidden = false;
    bar.max = st.files.length;
    try {
      for (let i = 0; i < st.files.length; i += BATCH) {
        const form = new FormData();
        form.append('ticket_id', ticketId);
        const routeId = st.root.querySelector('#gis-mi-route').value;
        if (routeId) form.append('route_id', routeId);
        st.files.slice(i, i + BATCH).forEach(f => form.append('files', f, f.name));
        btn.textContent = `Đang tải ${Math.min(i + BATCH, st.files.length)}/${st.files.length}...`;
        try {
          const res = await GIS.api('POST', '/api/media/import', form);
          st.results.push(...res.data.items);
        } catch (e) {
          st.files.slice(i, i + BATCH).forEach(f => st.results.push({ name: f.name, status: 'failed', error: e.message }));
        }
        bar.value = Math.min(i + BATCH, st.files.length);
        renderResults();
      }
      GIS.toast(`Xong: ${st.results.filter(x => x.status === 'created').length} ảnh mới`);
    } finally {
      st.busy = false;
      st.root.querySelectorAll('input[type=file],.ui-file-toolbar button,#gis-mi-ticket,#gis-mi-route').forEach(el=>el.disabled=false);
      btn.disabled = false;
      btn.textContent = '⬆️ Nhập ảnh';
      bar.hidden = true;
    }
  }

  GIS.MediaImport = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-import">
            <section class="card">
              <h2>Nhập ảnh từ thẻ nhớ</h2>
              <p class="faint">Dùng khi Wi-Fi hiện trường yếu hoặc Pilot 2 chưa tải hết ảnh. Chọn cả thư mục ảnh trên thẻ nhớ (DCIM).
                Hệ thống tự đọc vị trí RTK, góc gimbal, camera trong từng ảnh; ảnh đã có sẽ bị bỏ qua (không nhận trùng).</p>
              <div class="gis-row gis-imp-controls">
                <div class="field"><label for="gis-mi-ticket">Phiếu kiểm tra *</label><select class="input" id="gis-mi-ticket"></select></div>
                <div class="field"><label for="gis-mi-route">Đường bay đã bay</label><select class="input" id="gis-mi-route"></select></div>
              </div>
              <div class="gis-row gis-imp-controls">
                <div class="field"><label for="gis-mi-dir">Chọn thư mục ảnh</label><input class="input" id="gis-mi-dir" type="file" webkitdirectory multiple></div>
                <div class="field"><label for="gis-mi-files">Hoặc chọn từng ảnh</label><input class="input" id="gis-mi-files" type="file" accept=".jpg,.jpeg" multiple></div>
              </div>
              <div class="gis-row">
                <button class="btn primary" type="button" id="gis-mi-start" disabled>⬆️ Nhập ảnh</button>
                <progress id="gis-mi-progress" value="0" hidden></progress>
                <span class="faint" id="gis-mi-info"></span>
              </div>
              <div id="gis-mi-result"></div>
            </section>
          </div>`;
        root.querySelector('#gis-mi-dir').addEventListener('change', onPick);
        root.querySelector('#gis-mi-files').addEventListener('change', onPick);
        root.querySelector('#gis-mi-start').addEventListener('click', start);
      }
      await Promise.all([loadTickets(), loadRoutes()]);
    }
  };
})();
