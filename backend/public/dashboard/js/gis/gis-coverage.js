/* =====================================================================
   KIỂM TRA ĐỦ ẢNH (Giai đoạn A4): % phủ khu theo phiếu, vùng thiếu, tạo tuyến bay bù.
     GIS.Coverage.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = { root: null, map: null, layer: null, data: null, profiles: [] };
  const Q_COLOR = { HIGH: '#2f9e74', LOW: '#e59a0c', UNKNOWN: '#7d8e93' };

  async function loadSelects() {
    const [tickets, tree, profiles] = await Promise.all([
      GIS.run(() => GIS.api('GET', '/api/tickets')),
      GIS.run(() => GIS.api('GET', '/api/assets/tree')),
      GIS.run(() => GIS.api('GET', '/api/capture-profiles'))
    ]);
    const tk = tickets ? tickets.data : [];
    st.root.querySelector('#gis-cv-ticket').innerHTML = tk.length
      ? tk.map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)}</option>`).join('')
      : '<option value="">Chưa có phiếu</option>';
    const areas = tree && tree.data ? tree.data.areas.filter(a => a.has_polygon) : [];
    st.root.querySelector('#gis-cv-area').innerHTML = areas.length
      ? areas.map(a => `<option value="${a.area_id}">${esc(a.area_code)} – ${esc(a.area_name)}</option>`).join('')
      : '<option value="">Chưa có khu nào vẽ ranh giới</option>';
    st.profiles = profiles ? profiles.data.filter(p => p.route_kind === 'GRID') : [];
    st.root.querySelector('#gis-cv-profile').innerHTML = st.profiles
      .map(p => `<option value="${p.profile_id}">${esc(p.profile_name)}</option>`).join('');
  }

  function draw(d) {
    if (st.layer) st.map.removeLayer(st.layer);
    const g = L.featureGroup();
    const canvas = L.canvas({ padding: 0.3 });
    d.footprints.forEach(f => L.geoJSON(f, { style: { color: '#38bdf8', weight: 1, fillOpacity: 0.06, opacity: 0.4 }, renderer: canvas }).addTo(g));
    d.gaps.forEach((gap, i) => L.geoJSON(gap.polygon, { style: { color: '#cf2f5e', weight: 2, fillOpacity: 0.25, dashArray: '5 4' } })
      .bindTooltip(`Vùng thiếu #${i + 1}: ${gap.area_m2.toLocaleString('vi-VN')} m²`).addTo(g));
    d.points.forEach(p => L.circleMarker([p.lat, p.lng], { radius: 3, color: Q_COLOR[p.q] || '#7d8e93', fillOpacity: 1, weight: 1, renderer: canvas }).addTo(g));
    g.addTo(st.map);
    st.layer = g;
    if (g.getBounds().isValid()) st.map.fitBounds(g.getBounds(), { padding: [20, 20] });
  }

  function renderStats(d) {
    const tp = d.ticket_photos;
    const exp = d.expected;
    const pctClass = d.coverage_pct >= 98 ? 'ok' : d.coverage_pct >= 85 ? 'warn' : 'bad';
    st.root.querySelector('#gis-cv-stats').innerHTML = `
      <div class="gis-cv-big"><span class="tag ${pctClass}">${esc(d.coverage_pct)}%</span> diện tích khu ${esc(d.area.area_code)} đã có ảnh</div>
      <dl class="kv gis-geo">
        <dt>Diện tích chưa phủ</dt><dd>${esc(d.uncovered_m2.toLocaleString('vi-VN'))} m² · ${esc(d.gap_count)} vùng</dd>
        <dt>Ảnh dùng để tính</dt><dd>${esc(d.photos_used)} ảnh trong khu</dd>
        ${d.photos_skipped_oblique ? `<dt>Bỏ qua (chụp xiên)</dt><dd>${esc(d.photos_skipped_oblique)}</dd>` : ''}
        <dt>Ảnh của phiếu (camera này)</dt><dd>${esc(tp.total)}${exp && exp.photo_count ? ` / dự kiến ${esc(exp.photo_count)} (${esc(exp.route_name)})` : ''}</dd>
        <dt>Chất lượng vị trí</dt><dd><span class="tag ok">RTK FIX ${esc(tp.rtk_fix)}</span> <span class="tag warn">Không FIX ${esc(tp.rtk_low)}</span> <span class="tag off">Không GPS ${esc(tp.no_position)}</span></dd>
      </dl>
      ${d.gap_count ? '' : '<div class="gis-ok-note">✓ Không còn vùng thiếu ảnh.</div>'}`;
    st.root.querySelector('#gis-cv-fill').disabled = !d.gap_count;
  }

  async function check() {
    const ticket = st.root.querySelector('#gis-cv-ticket').value;
    const area = st.root.querySelector('#gis-cv-area').value;
    const lens = st.root.querySelector('#gis-cv-lens').value;
    if (!ticket || !area) { GIS.toast('Chọn phiếu và khu đã vẽ ranh giới', 'error'); return; }
    const res = await GIS.run(() => GIS.api('GET', `/api/coverage?area_id=${area}&ticket_id=${ticket}&lens=${lens}`));
    if (!res) return;
    st.data = res.data;
    draw(res.data);
    renderStats(res.data);
  }

  /** Tạo tuyến bay bù cho tối đa 5 vùng thiếu lớn nhất (mỗi vùng 1 tuyến). */
  async function fill() {
    const d = st.data;
    const profileId = st.root.querySelector('#gis-cv-profile').value;
    if (!d || !d.gap_count || !profileId) return;
    const gaps = d.gaps.slice(0, 5);
    if (!window.confirm(`Tạo ${gaps.length} tuyến bay bù cho ${gaps.length} vùng thiếu lớn nhất?`)) return;
    let made = 0;
    for (let i = 0; i < gaps.length; i += 1) {
      const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans', {
        profile_id: profileId, area_id: d.area.area_id, polygon: gaps[i].polygon,
        route_name: `Bay bù ${d.area.area_code} #${i + 1} (${new Date().toLocaleDateString('vi-VN')})`
      }));
      if (res) made += 1;
    }
    if (made) GIS.toast(`Đã tạo ${made} tuyến bay bù – xem ở tab Lập đường bay`);
  }

  GIS.Coverage = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-fp">
            <section class="card gis-fp-form">
              <h2>Kiểm tra đủ ảnh</h2>
              <p class="faint">Tính phần diện tích khu đã được ảnh phủ (dựa trên vị trí, độ cao, hướng của từng ảnh), chỉ ra vùng còn thiếu và tạo tuyến bay bù.
                Chỉ tính ảnh chụp gần thẳng xuống (gimbal khoảng −90°).</p>
              <div class="field"><label for="gis-cv-ticket">Phiếu kiểm tra</label><select class="input" id="gis-cv-ticket"></select></div>
              <div class="field"><label for="gis-cv-area">Khu pin</label><select class="input" id="gis-cv-area"></select></div>
              <div class="field"><label for="gis-cv-lens">Camera</label><select class="input" id="gis-cv-lens">
                <option value="ir">Nhiệt</option><option value="wide">Rộng</option><option value="zoom">Zoom</option></select></div>
              <button class="btn primary" type="button" id="gis-cv-check">🔍 Kiểm tra</button>
              <div id="gis-cv-stats"></div>
              <div class="field"><label for="gis-cv-profile">Hồ sơ chụp cho tuyến bay bù</label><select class="input" id="gis-cv-profile"></select></div>
              <button class="btn" type="button" id="gis-cv-fill" disabled>🛩️ Tạo tuyến bay bù</button>
            </section>
            <section class="gis-fp-mapbox"><div id="gis-cv-map"></div></section>
          </div>`;
        root.querySelector('#gis-cv-check').addEventListener('click', check);
        root.querySelector('#gis-cv-fill').addEventListener('click', fill);
        const plant = await GIS.getPlant();
        const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [16.0, 108.0];
        st.map = L.map(root.querySelector('#gis-cv-map'), { center, zoom: 17, maxZoom: 22 });
        const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
        if (sat) L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
        GIS.attachMap(st.map, { kind: 'solar', visible: ['areas'] });
      }
      await loadSelects();
      setTimeout(() => st.map.invalidateSize(), 60);
    }
  };
})();
