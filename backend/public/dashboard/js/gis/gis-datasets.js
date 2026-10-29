/* =====================================================================
   XUẤT BỘ ẢNH CHO AI VISION (Giai đoạn A5): bộ lọc → xem trước → tải ZIP.
     GIS.Datasets.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;
  const st = { root: null };
  let previewRequest=0;

  function params() {
    const q = new URLSearchParams();
    const val = id => st.root.querySelector(id).value;
    if (val('#gis-ds-ticket')) q.set('ticket_id', val('#gis-ds-ticket'));
    if (val('#gis-ds-area')) q.set('area_id', val('#gis-ds-area'));
    const lenses = [...st.root.querySelectorAll('input[name="ds-lens"]:checked')].map(i => i.value);
    if (lenses.length && lenses.length < 3) q.set('lens', lenses.join(','));
    if (st.root.querySelector('#gis-ds-rtk').checked) q.set('quality', 'HIGH');
    if (val('#gis-ds-from')) q.set('from', val('#gis-ds-from'));
    if (val('#gis-ds-to')) q.set('to', val('#gis-ds-to'));
    return q.toString();
  }

  async function preview() {
    if(!st.root.querySelector('input[name="ds-lens"]:checked')){st.root.querySelector('#gis-ds-download').hidden=true;GIS.toast('Chọn ít nhất một camera để xuất ảnh.','error');return;}
    const snapshot=params(),request=++previewRequest;
    const res = await GIS.run(() => GIS.api('GET', `/api/datasets/preview?${snapshot}`));
    if(request!==previewRequest||snapshot!==params())return;
    const box = st.root.querySelector('#gis-ds-preview');
    const dl = st.root.querySelector('#gis-ds-download');
    if (!res) { dl.hidden = true; return; }
    const d = res.data;
    const mb = (d.size_bytes / 1024 / 1024).toFixed(1);
    box.innerHTML = `
      <dl class="kv gis-geo">
        <dt>Số ảnh</dt><dd><b>${esc(d.count)}</b>${d.truncated ? ' (đã cắt ở 50.000 – hãy lọc hẹp hơn)' : ''}</dd>
        <dt>Lượt chụp (cặp nhiệt + thường)</dt><dd>${esc(d.pairs)}</dd>
        <dt>Dung lượng</dt><dd>${esc(mb)} MB</dd>
        <dt>Theo camera</dt><dd>${Object.entries(d.by_lens).map(([k, n]) => `${esc(k)}: ${esc(n)}`).join(' · ') || '--'}</dd>
        <dt>Chất lượng vị trí</dt><dd>${Object.entries(d.by_quality).map(([k, n]) => `${esc(k)}: ${esc(n)}`).join(' · ') || '--'}</dd>
      </dl>`;
    dl.hidden = !d.count;
    dl.href = `/api/datasets/export?${snapshot}`;
  }

  GIS.Datasets = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-import">
            <section class="card">
              <h2>Xuất bộ ảnh cho AI Vision</h2>
              <p class="faint">Tải ảnh gốc kèm thông tin chụp (vị trí RTK, độ cao, góc camera, nhiệt độ, phiếu, tài sản) để đội Vision gán nhãn / huấn luyện.
                File ZIP gồm thư mục ảnh theo camera, <code>manifest.json</code>, <code>manifest.csv</code> và <code>README.txt</code>.</p>
              <div class="gis-row gis-imp-controls">
                <div class="field"><label for="gis-ds-ticket">Phiếu</label><select class="input" id="gis-ds-ticket"></select></div>
                <div class="field"><label for="gis-ds-area">Khu pin</label><select class="input" id="gis-ds-area"></select></div>
                <div class="field"><label for="gis-ds-from">Từ ngày</label><input class="input" type="date" id="gis-ds-from"></div>
                <div class="field"><label for="gis-ds-to">Đến ngày</label><input class="input" type="date" id="gis-ds-to"></div>
              </div>
              <div class="gis-row">
                <label class="gis-check"><input type="checkbox" name="ds-lens" value="IR" checked> Nhiệt</label>
                <label class="gis-check"><input type="checkbox" name="ds-lens" value="WIDE" checked> Rộng</label>
                <label class="gis-check"><input type="checkbox" name="ds-lens" value="ZOOM" checked> Zoom</label>
                <label class="gis-check"><input type="checkbox" id="gis-ds-rtk"> Chỉ ảnh RTK FIX</label>
              </div>
              <div class="gis-row">
                <button class="btn" type="button" id="gis-ds-check">🔍 Xem trước</button>
                <a class="btn primary" id="gis-ds-download" hidden download>⬇️ Tải bộ ảnh (ZIP)</a>
              </div>
              <div id="gis-ds-preview"></div>
            </section>
          </div>`;
        root.querySelector('#gis-ds-check').addEventListener('click', preview);
        root.addEventListener('change', () => { previewRequest++;st.root.querySelector('#gis-ds-download').hidden = true; });
      }
      const [tickets, tree] = await Promise.all([
        GIS.run(() => GIS.api('GET', '/api/tickets')),
        GIS.run(() => GIS.api('GET', '/api/assets/tree'))
      ]);
      st.root.querySelector('#gis-ds-ticket').innerHTML = '<option value="">(tất cả phiếu)</option>' +
        (tickets ? tickets.data : []).map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)}</option>`).join('');
      st.root.querySelector('#gis-ds-area').innerHTML = '<option value="">(tất cả khu)</option>' +
        (tree && tree.data ? tree.data.areas.filter(a => a.has_polygon) : []).map(a => `<option value="${a.area_id}">${esc(a.area_code)}</option>`).join('');
    }
  };
})();
