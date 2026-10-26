/* =====================================================================
   LẬP ĐƯỜNG BAY (Giai đoạn A2): chọn khu / tài sản + hồ sơ chụp → xem trước → tạo KMZ.
     GIS.FlightPlans.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = { root: null, map: null, previewLayer: null, profiles: [], tree: null, lastPreview: null, routes: [] };

  const fmtTime = s => `${Math.floor(s / 60)} phút ${s % 60} giây`;

  function profileOptions(kind) {
    return st.profiles.filter(p => p.route_kind === kind)
      .map(p => `<option value="${p.profile_id}">${esc(p.profile_name)}${p.geometry && kind === 'GRID' ? ` (${esc(p.geometry.altitude_m)} m)` : ''}</option>`).join('');
  }

  function targetList() {
    const t = st.tree;
    if (!t || !t.substations.length) return '<div class="faint">Chưa có trạm / ngăn lộ.</div>';
    return t.substations.map(s => s.bays.map(b => `
      <label class="gis-check gis-tgt"><input type="checkbox" data-type="BAY" value="${b.bay_id}"> <b>Ngăn ${esc(b.bay_code)}</b> <span class="faint">(cả ${b.disconnectors.length} DCL)</span></label>
      ${b.disconnectors.map(d => `<label class="gis-check gis-tgt gis-tgt-sub"><input type="checkbox" data-type="DISCONNECTOR" value="${d.disconnector_id}"> DCL ${esc(d.dcl_code)} ${esc(d.phase === '3PHASE' ? '' : d.phase)}</label>`).join('')}
    `).join('')).join('');
  }

  function renderForm() {
    const kind = st.root.querySelector('[name="fp-kind"]:checked').value;
    const box = st.root.querySelector('#gis-fp-target');
    if (kind === 'GRID') {
      const areas = st.tree ? st.tree.areas : [];
      const ready = areas.filter(a => a.has_polygon);
      box.innerHTML = `<div class="field"><label for="gis-fp-area">Khu pin</label><select class="input" id="gis-fp-area">
        ${ready.length ? '' : '<option value="">-- Chưa có khu nào vẽ ranh giới --</option>'}
        ${areas.map(a => `<option value="${a.area_id}" ${a.has_polygon ? '' : 'disabled'} ${a === ready[0] ? 'selected' : ''}>${esc(a.area_code)} – ${esc(a.area_name)}${a.has_polygon ? '' : ' (chưa vẽ ranh giới)'}</option>`).join('')}
      </select></div>
      ${ready.length ? '' : '<div class="gis-warn">Tuyến quét lưới cần ranh giới khu. Vào tab <b>Cây tài sản & bản đồ</b> → chọn khu → <b>Vẽ ranh giới</b> → Lưu.</div>'}`;
    } else {
      box.innerHTML = `<div class="field"><span class="gis-field-label">Tài sản (dùng các điểm chụp ảnh đã khai báo)</span><div class="gis-tgt-list">${targetList()}</div></div>`;
    }
    st.root.querySelector('#gis-fp-profile').innerHTML = profileOptions(kind) || '<option value="">Chưa có hồ sơ kiểu này</option>';
  }

  function readBody() {
    const kind = st.root.querySelector('[name="fp-kind"]:checked').value;
    const body = { profile_id: st.root.querySelector('#gis-fp-profile').value, route_name: st.root.querySelector('#gis-fp-name').value.trim() };
    if (kind === 'GRID') body.area_id = (st.root.querySelector('#gis-fp-area') || {}).value;
    else body.targets = [...st.root.querySelectorAll('.gis-tgt input:checked')].map(i => ({ asset_type: i.dataset.type, asset_id: Number(i.value) }));
    return body;
  }

  function drawPlan(plan) {
    if (st.previewLayer) st.map.removeLayer(st.previewLayer);
    const g = L.featureGroup();
    const coords = plan.geojson.path.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(coords, { color: '#e59a0c', weight: 3 }).addTo(g);
    if (coords.length) {
      L.circleMarker(coords[0], { radius: 7, color: '#2f9e74', fillOpacity: 1 }).bindTooltip('Bắt đầu').addTo(g);
      L.circleMarker(coords[coords.length - 1], { radius: 7, color: '#cf2f5e', fillOpacity: 1 }).bindTooltip('Kết thúc').addTo(g);
    }
    plan.geojson.points.forEach((p, i) => {
      L.circleMarker([p.lat, p.lng], { radius: 5, color: '#38bdf8', fillOpacity: 1 })
        .bindTooltip(`#${i + 1} ${esc(p.label)} · ${esc(p.altitude_m)} m`).addTo(g);
    });
    g.addTo(st.map);
    st.previewLayer = g;
    if (g.getBounds().isValid()) st.map.fitBounds(g.getBounds(), { padding: [30, 30], maxZoom: 20 });
  }

  function renderStats(plan) {
    const s = plan.stats;
    const geo = plan.geometry || {};
    st.root.querySelector('#gis-fp-stats').innerHTML = `
      <dl class="kv gis-geo">
        ${plan.kind === 'GRID' ? `<dt>Độ cao</dt><dd><b>${esc(geo.altitude_m)}</b> m</dd>
          <dt>Độ phân giải</dt><dd>${Object.entries(geo.gsd_cm || {}).map(([l, v]) => `${esc(l)} ${esc(v)} cm`).join(' · ')}</dd>
          <dt>Hướng bay</dt><dd>${esc(plan.heading_deg)}°</dd>
          <dt>Số đường bay</dt><dd>${esc(s.line_count)} (cách ${esc(geo.line_spacing_m)} m)</dd>
          <dt>Chụp mỗi</dt><dd>${esc(geo.trigger_distance_m)} m</dd>` : `<dt>Số điểm chụp</dt><dd>${esc(s.point_count)}</dd>`}
        <dt>Quãng đường</dt><dd>${esc(s.distance_m)} m</dd>
        <dt>Số ảnh (mỗi camera)</dt><dd><b>${esc(s.photo_count)}</b></dd>
        <dt>Thời gian bay</dt><dd>${fmtTime(s.duration_s)}</dd>
        <dt>Số pin</dt><dd>${esc(s.batteries)}</dd>
      </dl>
      ${(plan.warnings || []).map(w => `<div class="gis-warn">⚠ ${esc(w)}</div>`).join('')}`;
  }

  /** Kiểm tra ngay trên trình duyệt để báo lỗi dễ hiểu trước khi gọi server. */
  function checkBody(body) {
    if (!body.profile_id) return 'Chưa có hồ sơ chụp phù hợp. Tạo ở tab Hồ sơ chụp.';
    if ('area_id' in body && !body.area_id) return 'Chọn khu pin đã vẽ ranh giới';
    if (body.targets && !body.targets.length) return 'Tick chọn ít nhất 1 ngăn lộ hoặc dao cách ly';
    return null;
  }

  async function preview() {
    const body = readBody();
    const problem = checkBody(body);
    if (problem) { GIS.toast(problem, 'error'); return; }
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans/preview', body));
    if (!res) return;
    st.lastPreview = res.data;
    drawPlan(res.data);
    renderStats(res.data);
    st.root.querySelector('#gis-fp-create').disabled = false;
  }

  async function create() {
    const body = readBody();
    const problem = checkBody(body) || (!body.route_name ? 'Nhập tên đường bay' : null);
    if (problem) { GIS.toast(problem, 'error'); return; }
    const res = await GIS.run(() => GIS.api('POST', '/api/flight-plans', body));
    if (!res) return;
    GIS.toast(res.message);
    loadRoutes();
  }

  async function loadRoutes() {
    const res = await GIS.run(() => GIS.api('GET', '/api/flight-plans'));
    st.routes = res ? res.data : [];
    st.root.querySelector('#gis-fp-routes').innerHTML = st.routes.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Tên</th><th>Kiểu</th><th>Hồ sơ</th><th>Ảnh</th><th>Thời gian</th><th></th></tr></thead>
      <tbody>${st.routes.map(r => `<tr data-id="${r.route_id}">
        <td><b>${esc(r.route_name)}</b><div class="faint">${esc(r.target_area || '')} · ${esc(new Date(r.created_at).toLocaleString('vi-VN'))}</div></td>
        <td>${r.route_kind === 'GRID' ? 'Quét lưới' : r.route_kind === 'POINTS' ? 'Điểm' : 'Vẽ tay'}</td>
        <td>${esc(r.profile_name || '')}</td>
        <td class="num">${esc(r.photo_count ?? '')}</td>
        <td class="num">${r.duration_s ? fmtTime(r.duration_s) : ''}</td>
        <td class="gis-row"><button class="btn sm" data-act="show">Xem</button><a class="btn sm" href="${esc(r.kmz_url)}" download>KMZ</a><button class="btn sm danger" data-act="del">Xóa</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="gis-empty">Chưa có đường bay nào.</div>';
  }

  async function onRoutesClick(e) {
    const row = e.target.closest('tr[data-id]');
    const act = e.target.closest('[data-act]');
    if (!row || !act) return;
    const id = Number(row.dataset.id);
    if (act.dataset.act === 'show') {
      const res = await GIS.run(() => GIS.api('GET', `/api/flight-plans/${id}`));
      if (res && res.data.plan) { drawPlan(res.data.plan); renderStats(res.data.plan); }
    }
    if (act.dataset.act === 'del') {
      if (!window.confirm('Xóa đường bay này (kèm file KMZ)?')) return;
      const res = await GIS.run(() => GIS.api('DELETE', `/api/flight-plans/${id}`), 'Đã xóa đường bay');
      if (res) loadRoutes();
    }
  }

  async function initMap() {
    const plant = await GIS.getPlant();
    const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [11.8312, 106.5913];
    st.map = L.map(st.root.querySelector('#gis-fp-map'), { center, zoom: 17, maxZoom: 22 });
    const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
    if (sat) L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
    GIS.attachMap(st.map, { kind: 'solar', visible: ['areas', 'strings', 'substations', 'disconnectors', 'photo_points'] });
  }

  GIS.FlightPlans = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-fp">
            <section class="card gis-fp-form">
              <h2>Lập đường bay</h2>
              <p class="faint">Chọn khu hoặc tài sản và hồ sơ chụp. Phần mềm tự tính đường bay và lệnh chụp, tạo file KMZ.
                File xuất hiện trong thư viện đường bay của DJI Pilot 2 (hoặc tải về nạp tay).</p>
              <div class="gis-row">
                <label class="gis-check"><input type="radio" name="fp-kind" value="GRID" checked> Quét lưới khu pin</label>
                <label class="gis-check"><input type="radio" name="fp-kind" value="POINTS"> Chụp tại điểm (DCL, cận lỗi)</label>
              </div>
              <div id="gis-fp-target"></div>
              <div class="field"><label for="gis-fp-profile">Hồ sơ chụp</label><select class="input" id="gis-fp-profile"></select></div>
              <div class="field"><label for="gis-fp-name">Tên đường bay</label><input class="input" id="gis-fp-name" placeholder="VD: Quét nhiệt INV-01 tháng 11"></div>
              <div class="gis-row">
                <button class="btn" type="button" id="gis-fp-preview">🔍 Xem trước</button>
                <button class="btn primary" type="button" id="gis-fp-create" disabled>💾 Tạo đường bay (KMZ)</button>
              </div>
              <div id="gis-fp-stats"></div>
            </section>
            <section class="gis-fp-mapbox"><div id="gis-fp-map"></div></section>
          </div>
          <section class="card flat gis-fp-list"><h3 class="gis-fp-list-title">Đường bay đã tạo</h3><div id="gis-fp-routes"></div></section>`;
        root.querySelectorAll('[name="fp-kind"]').forEach(r => r.addEventListener('change', () => {
          renderForm();
          st.root.querySelector('#gis-fp-create').disabled = true;
        }));
        root.querySelector('#gis-fp-preview').addEventListener('click', preview);
        root.querySelector('#gis-fp-create').addEventListener('click', create);
        root.querySelector('#gis-fp-routes').addEventListener('click', onRoutesClick);
        root.querySelector('#gis-fp-target').addEventListener('change', () => { st.root.querySelector('#gis-fp-create').disabled = true; });
        root.querySelector('#gis-fp-profile').addEventListener('change', () => { st.root.querySelector('#gis-fp-create').disabled = true; });
        await initMap();
      }
      const [profiles, tree] = await Promise.all([
        GIS.run(() => GIS.api('GET', '/api/capture-profiles')),
        GIS.run(() => GIS.api('GET', '/api/assets/tree'))
      ]);
      st.profiles = profiles ? profiles.data : [];
      st.tree = tree ? tree.data : null;
      renderForm();
      loadRoutes();
      setTimeout(() => st.map.invalidateSize(), 60);
    }
  };
})();
