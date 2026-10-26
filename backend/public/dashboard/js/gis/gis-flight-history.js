/* =====================================================================
   LỊCH SỬ CHUYẾN BAY (Giai đoạn C2): danh sách chuyến, xem lại vết bay, ảnh trong chuyến.
     GIS.FlightHistory.render(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const st = { root: null, map: null, layer: null, marker: null, flight: null, timer: null, reqId: 0 };
  const LENS_COLOR = { IR: '#f97316', WIDE: '#38bdf8', ZOOM: '#a78bfa' };
  const REASON = { LANDED: 'Hạ cánh', LOST_LINK: 'Mất tín hiệu', SERVER_RESTART: 'Server khởi động lại' };
  const PLAY_STEP_MS = 100;

  const dt = s => (s ? new Date(s).toLocaleString('vi-VN') : '–');
  function dur(sec) {
    if (sec == null) return '–';
    const m = Math.floor(sec / 60);
    return m ? `${m} ph ${sec % 60} s` : `${sec} s`;
  }

  async function loadTickets() {
    const res = await GIS.run(() => GIS.api('GET', '/api/tickets'));
    const tk = res ? res.data : [];
    st.root.querySelector('#gis-fh-ticket').innerHTML = '<option value="">Tất cả phiếu</option>' +
      tk.map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)}</option>`).join('');
  }

  async function loadList() {
    const f = st.root;
    const qs = new URLSearchParams();
    const add = (k, id) => { const val = f.querySelector(id).value.trim(); if (val) qs.set(k, val); };
    add('device_sn', '#gis-fh-sn'); add('ticket_id', '#gis-fh-ticket'); add('from', '#gis-fh-from'); add('to', '#gis-fh-to');
    const res = await GIS.run(() => GIS.api('GET', `/api/flights?${qs}`));
    const rows = res ? res.data : [];
    f.querySelector('#gis-fh-list').innerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Bắt đầu</th><th>Máy bay</th><th>Phiếu</th><th class="num">Thời gian</th><th class="num">Ảnh</th><th>Kết thúc</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.flight_session_id}" class="gis-fh-row">
        <td>${esc(dt(r.started_at))}</td>
        <td><code>${esc(r.device_sn)}</code></td>
        <td>${r.ticket_code ? esc(r.ticket_code) : '<span class="faint">–</span>'}</td>
        <td class="num">${r.ended_at ? esc(dur(r.duration_s)) : '<span class="tag ok">Đang bay</span>'}</td>
        <td class="num">${esc(r.photo_count)}</td>
        <td>${r.end_reason ? `<span class="tag ${r.end_reason === 'LANDED' ? 'ok' : 'warn'}">${esc(REASON[r.end_reason] || r.end_reason)}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="gis-empty">Chưa có chuyến bay nào. Chuyến bay được ghi tự động khi máy bay cất cánh trong lúc kết nối với server.</div>';
  }

  function stopPlay() {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    const btn = st.root.querySelector('#gis-fh-play');
    if (btn) btn.textContent = '▶ Phát lại';
  }

  function showPoint(i) {
    const tr = st.flight.track;
    const p = tr[i];
    if (!p) return;
    st.marker.setLatLng([p.lat, p.lng]);
    st.root.querySelector('#gis-fh-slider').value = i;
    st.root.querySelector('#gis-fh-now').innerHTML = `
      <b>${esc(new Date(p.t).toLocaleTimeString('vi-VN'))}</b> · cao ${esc(Number(p.h).toFixed(1))} m ·
      ${esc(Number(p.v).toFixed(1))} m/s · pin ${p.battery != null ? esc(p.battery) + ' %' : '–'} ·
      ${p.rtk_fixed === 1 ? '<span class="tag ok">RTK FIX</span>' : p.rtk_fixed === 0 ? '<span class="tag warn">Không FIX</span>' : ''}`;
  }

  function togglePlay() {
    if (st.timer) { stopPlay(); return; }
    const slider = st.root.querySelector('#gis-fh-slider');
    let i = Number(slider.value);
    if (i >= st.flight.track.length - 1) i = 0;
    st.root.querySelector('#gis-fh-play').textContent = '⏸ Dừng';
    st.timer = setInterval(() => {
      const speed = Number(st.root.querySelector('#gis-fh-speed').value) || 1;
      i = Math.min(i + speed, st.flight.track.length - 1);
      showPoint(i);
      if (i >= st.flight.track.length - 1) stopPlay();
    }, PLAY_STEP_MS);
  }

  function drawFlight(f) {
    stopPlay();
    if (st.layer) st.map.removeLayer(st.layer);
    const g = L.featureGroup();
    const tr = f.track;
    // Vẽ vết bay theo từng đoạn: xanh khi RTK FIX, cam khi không FIX
    let seg = [];
    let segFix = null;
    const flush = () => {
      if (seg.length > 1) L.polyline(seg, { color: segFix ? '#2f9e74' : '#e59a0c', weight: 3, opacity: 0.9 }).addTo(g);
    };
    tr.forEach(p => {
      const fix = p.rtk_fixed === 1;
      if (segFix !== null && fix !== segFix) { flush(); seg = [seg[seg.length - 1]]; }
      segFix = fix;
      seg.push([p.lat, p.lng]);
    });
    flush();
    if (tr.length) {
      L.circleMarker([tr[0].lat, tr[0].lng], { radius: 7, color: '#fff', fillColor: '#2f9e74', fillOpacity: 1, weight: 2 }).bindTooltip('Cất cánh').addTo(g);
      L.circleMarker([tr[tr.length - 1].lat, tr[tr.length - 1].lng], { radius: 7, color: '#fff', fillColor: '#cf2f5e', fillOpacity: 1, weight: 2 }).bindTooltip('Điểm cuối').addTo(g);
    }
    f.photos.filter(p => p.lat != null).forEach(p => {
      L.circleMarker([p.lat, p.lng], { radius: 4, color: LENS_COLOR[p.lens] || '#7d8e93', fillOpacity: 0.9, weight: 1 })
        .bindPopup(`<b>${esc(p.file_name)}</b><br>${esc(dt(p.captured_at))}<br>
          ${p.max_temperature != null ? `Nhiệt max ${esc(p.max_temperature)} °C<br>` : ''}
          <a href="${esc(p.file_url)}" target="_blank" rel="noopener">Mở ảnh</a>`).addTo(g);
    });
    st.marker = L.circleMarker(tr.length ? [tr[0].lat, tr[0].lng] : [0, 0], { radius: 8, color: '#fff', fillColor: '#2563eb', fillOpacity: 1, weight: 3 }).addTo(g);
    g.addTo(st.map);
    st.layer = g;
    if (g.getBounds().isValid()) st.map.fitBounds(g.getBounds(), { padding: [30, 30] });
  }

  function renderDetail(f) {
    const box = st.root.querySelector('#gis-fh-detail');
    const lensCount = f.photos.reduce((acc, p) => { acc[p.lens || 'Khác'] = (acc[p.lens || 'Khác'] || 0) + 1; return acc; }, {});
    box.hidden = false;
    box.innerHTML = `
      <h3>Chuyến #${esc(f.flight_session_id)} · <code>${esc(f.device_sn)}</code></h3>
      <dl class="kv gis-geo">
        <dt>Thời gian</dt><dd>${esc(dt(f.started_at))} → ${f.ended_at ? esc(dt(f.ended_at)) : 'đang bay'} (${esc(dur(f.duration_s))})</dd>
        <dt>Phiếu</dt><dd>${f.ticket_code ? `${esc(f.ticket_code)} – ${esc(f.ticket_name)}` : 'Không gắn phiếu'}</dd>
        ${f.pilot_username ? `<dt>Phi công</dt><dd>${esc(f.pilot_username)}</dd>` : ''}
        <dt>Quãng đường</dt><dd>${f.distance_m != null ? esc(Math.round(f.distance_m).toLocaleString('vi-VN')) + ' m' : '–'} · cao nhất ${f.max_relative_height != null ? esc(f.max_relative_height) + ' m' : '–'}</dd>
        <dt>Pin</dt><dd>${f.battery_start ?? '–'} % → ${f.battery_end ?? '–'} %</dd>
        <dt>RTK FIX</dt><dd>${f.rtk_fix_ratio != null ? esc(Math.round(f.rtk_fix_ratio * 100)) + ' % thời gian bay' : '–'}</dd>
        <dt>Ảnh</dt><dd>${esc(f.photo_count)} ${Object.entries(lensCount).map(([k, n]) => `<span class="tag" style="border-color:${LENS_COLOR[k] || '#7d8e93'}">${esc(k)} ${n}</span>`).join(' ')}</dd>
      </dl>
      ${f.track.length > 1 ? `
        <div class="gis-row gis-fh-player">
          <button class="btn sm primary" type="button" id="gis-fh-play">▶ Phát lại</button>
          <select class="input" id="gis-fh-speed" aria-label="Tốc độ phát"><option value="1">1×</option><option value="5" selected>5×</option><option value="20">20×</option></select>
          <input type="range" id="gis-fh-slider" min="0" max="${f.track.length - 1}" value="0" aria-label="Thời điểm">
        </div>
        <div id="gis-fh-now" class="faint"></div>
        ${f.track_points_total > f.track.length ? `<p class="faint">Hiển thị ${f.track.length}/${f.track_points_total} điểm vết bay.</p>` : ''}`
        : '<p class="faint">Chuyến này chưa có dữ liệu vết bay.</p>'}`;
    if (f.track.length > 1) {
      box.querySelector('#gis-fh-play').addEventListener('click', togglePlay);
      box.querySelector('#gis-fh-slider').addEventListener('input', e => { stopPlay(); showPoint(Number(e.target.value)); });
      showPoint(0);
    }
  }

  async function openFlight(id) {
    const req = ++st.reqId;
    const res = await GIS.run(() => GIS.api('GET', `/api/flights/${id}`));
    if (!res || req !== st.reqId) return;
    st.flight = res.data;
    st.root.querySelectorAll('.gis-fh-row').forEach(r => r.classList.toggle('on', Number(r.dataset.id) === id));
    drawFlight(res.data);
    renderDetail(res.data);
  }

  GIS.FlightHistory = {
    async render(root) {
      if (!st.root) {
        st.root = root;
        root.innerHTML = `
          <div class="gis-fp">
            <section class="card gis-fp-form">
              <h2>Lịch sử chuyến bay</h2>
              <p class="faint">Mỗi lần máy bay cất cánh khi đang nối với server sẽ tạo một chuyến bay: vết bay (1 điểm/giây), phiếu, pin, RTK và ảnh chụp trong chuyến.</p>
              <form id="gis-fh-filter" class="gis-fh-filter">
                <div class="field"><label for="gis-fh-sn">Mã máy bay (SN)</label><input class="input" id="gis-fh-sn" placeholder="Tất cả"></div>
                <div class="field"><label for="gis-fh-ticket">Phiếu</label><select class="input" id="gis-fh-ticket"></select></div>
                <div class="gis-row">
                  <div class="field"><label for="gis-fh-from">Từ ngày</label><input class="input" id="gis-fh-from" type="date"></div>
                  <div class="field"><label for="gis-fh-to">Đến ngày</label><input class="input" id="gis-fh-to" type="date"></div>
                </div>
                <button class="btn primary" type="submit">🔍 Lọc</button>
              </form>
              <div id="gis-fh-list"></div>
              <div id="gis-fh-detail" class="gis-fh-detail" hidden></div>
            </section>
            <section class="gis-fp-mapbox"><div id="gis-fh-map"></div></section>
          </div>`;
        root.querySelector('#gis-fh-filter').addEventListener('submit', e => { e.preventDefault(); loadList(); });
        root.querySelector('#gis-fh-list').addEventListener('click', e => {
          const row = e.target.closest('tr[data-id]');
          if (row) openFlight(Number(row.dataset.id));
        });
        const plant = await GIS.getPlant();
        const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [11.8312, 106.5913];
        st.map = L.map(root.querySelector('#gis-fh-map'), { center, zoom: 17, maxZoom: 22 });
        const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite);
        if (sat) L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(st.map);
        GIS.attachMap(st.map, { kind: 'solar', visible: ['areas'] });
        await loadTickets();
      }
      await loadList();
      setTimeout(() => st.map.invalidateSize(), 60);
    },
    /** Gọi từ WebSocket khi có chuyến bay mới bắt đầu / kết thúc. */
    refresh() { if (st.root && !st.root.hidden) loadList(); }
  };
})();
