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
    st.root.style.setProperty('--fh-list-height',rows.length?(Math.min(3,rows.length)*50+170)+'px':'110px');
    f.querySelector('#gis-fh-list').innerHTML = rows.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Bắt đầu</th><th>Máy bay</th><th>Phiếu</th><th class="num">Thời gian</th><th class="num">Ảnh</th><th>Kết thúc</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.flight_session_id}" class="gis-fh-row">
        <td>${esc(dt(r.started_at))}</td>
        <td class="fh-device" title="${esc(r.device_sn)}"><code>${esc(r.device_sn)}</code></td>
        <td>${r.ticket_code ? esc(r.ticket_code) : '<span class="faint">–</span>'}</td>
        <td class="num">${r.ended_at ? esc(dur(r.duration_s)) : '<span class="tag ok">Đang bay</span>'}</td>
        <td class="num">${esc(r.photo_count)}</td>
        <td>${r.end_reason ? `<span class="tag ${r.end_reason === 'LANDED' ? 'ok' : 'warn'}">${esc(REASON[r.end_reason] || r.end_reason)}</span>` : ''}</td>
        <td><button type="button" class="btn sm">Chi tiết</button></td>
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

    // Phân loại ảnh thường vs ảnh sự cố AI
    const faultPhotos = f.photos.filter(p => Number(p.has_defect)===1);
    const normalPhotos = f.photos.filter(p => !faultPhotos.includes(p));

    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:10px">
        <h3>Chuyến #${esc(f.flight_session_id)} · <code>${esc(f.device_sn)}</code></h3>
        <button class="btn sm primary" type="button" onclick="queueFlightVision(${f.flight_session_id}).catch(e=>GIS.toast(e.message,'error'))">🤖 Gửi Vision AI</button>
      </div>
      <dl class="kv gis-geo">
        <dt>Thời gian</dt><dd>${esc(dt(f.started_at))} → ${f.ended_at ? esc(dt(f.ended_at)) : 'đang bay'} (${esc(dur(f.duration_s))})</dd>
        <dt>Phiếu kiểm tra</dt><dd>${f.ticket_code ? `<b>${esc(f.ticket_code)}</b> – ${esc(f.ticket_name)}` : 'Không gắn phiếu'}</dd>
        ${f.pilot_username ? `<dt>Phi công</dt><dd>${esc(f.pilot_username)}</dd>` : ''}
        <dt>Quãng đường</dt><dd>${f.distance_m != null ? esc(Math.round(f.distance_m).toLocaleString('vi-VN')) + ' m' : '–'} · cao nhất ${f.max_relative_height != null ? esc(f.max_relative_height) + ' m' : '–'}</dd>
        <dt>Pin</dt><dd>${f.battery_start ?? '–'} % → ${f.battery_end ?? '–'} %</dd>
        <dt>RTK FIX</dt><dd>${f.rtk_fix_ratio != null ? esc(Math.round(f.rtk_fix_ratio * 100)) + ' % thời gian bay' : '–'}</dd>
        <dt>Tổng số ảnh</dt><dd>${esc(f.photo_count)} ${Object.entries(lensCount).map(([k, n]) => `<span class="tag" style="border-color:${LENS_COLOR[k] || '#7d8e93'}">${esc(k)} ${n}</span>`).join(' ')}</dd>
      </dl>

      ${f.track.length > 1 ? `
        <div class="gis-row gis-fh-player" style="margin-top:12px;margin-bottom:8px">
          <button class="btn sm primary" type="button" id="gis-fh-play">▶ Phát lại</button>
          <select class="input" id="gis-fh-speed" aria-label="Tốc độ phát"><option value="1">1×</option><option value="5" selected>5×</option><option value="20">20×</option></select>
          <input type="range" id="gis-fh-slider" min="0" max="${f.track.length - 1}" value="0" aria-label="Thời điểm">
        </div>
        <div id="gis-fh-now" class="faint" style="font-size:11px;margin-bottom:12px"></div>`
        : '<p class="faint">Chuyến này chưa có dữ liệu vết bay.</p>'}

      <!-- KHO ẢNH CHUYẾN BAY THEO PHIẾU (PHÂN LOẠI ẢNH THƯỜNG VS ẢNH SỰ CỐ AI) -->
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px">
        <h4 style="margin-bottom:8px;font-size:13px">Bộ sưu tập ảnh chụp (${f.photos.length} ảnh)</h4>
        
        ${faultPhotos.length > 0 ? `
          <div style="margin-bottom:12px">
            <b style="color:var(--hot);font-size:12px;display:flex;align-items:center;gap:4px">⚠️ Ảnh có phát hiện lỗi (${faultPhotos.length})</b>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin-top:6px">
              ${faultPhotos.map(p => `
                <div style="border:1.5px solid var(--hot);border-radius:6px;overflow:hidden;background:#000;text-align:center;position:relative">
                  <a href="${esc(p.file_url)}" target="_blank" rel="noopener">
                    <img src="${esc(p.file_url)}" style="width:100%;height:75px;object-fit:cover;display:block" onerror="this.onerror=null;this.src='/dashboard/assets/no-img.svg'">
                  </a>
                  <div style="font-size:10px;color:#fff;background:rgba(207,47,94,0.85);padding:2px">
                    ${p.max_temperature != null ? `${esc(p.max_temperature)} °C` : 'IR Thermal'}
                  </div>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <div>
          <b style="font-size:12px;color:var(--ink2)">📸 Ảnh chưa có phát hiện lỗi (gồm ảnh chưa phân tích) (${normalPhotos.length})</b>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px;margin-top:6px;max-height:220px;overflow-y:auto">
            ${normalPhotos.map(p => `
              <div style="border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#000;position:relative">
                <a href="${esc(p.file_url)}" target="_blank" rel="noopener">
                  <img src="${esc(p.file_url)}" style="width:100%;height:65px;object-fit:cover;display:block" onerror="this.onerror=null;this.src='/dashboard/assets/no-img.svg'">
                </a>
                <div style="font-size:9.5px;color:#cbd5e1;padding:2px 4px;background:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${esc(p.file_name || 'Ảnh UAV')} · ${esc(p.lens||'UNKNOWN')} · ${p.vision_status==='SUCCEEDED'?'AI chưa phát hiện lỗi':'Chưa có kết quả AI'}
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    `;

    if (f.track.length > 1) {
      box.querySelector('#gis-fh-play').addEventListener('click', togglePlay);
      box.querySelector('#gis-fh-slider').addEventListener('input', e => { stopPlay(); showPoint(Number(e.target.value)); });
      showPoint(0);
    }
  }

  async function openFlight(id, details = false) {
    const req = ++st.reqId;
    const res = await GIS.run(() => GIS.api('GET', `/api/flights/${id}`));
    if (!res || req !== st.reqId) return;
    st.flight = res.data;
    st.root.querySelectorAll('.gis-fh-row').forEach(r => r.classList.toggle('on', Number(r.dataset.id) === id));
    drawFlight(res.data);
    renderDetail(res.data);
    if(details){const detail=st.root.querySelector('#gis-fh-detail');GIS.Compact?.reveal(detail,'Chi tiết chuyến bay');detail.closest('dialog')?.addEventListener('close',()=>{detail.hidden=true;},{once:true});}
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
          if (row) openFlight(Number(row.dataset.id),Boolean(e.target.closest('button')));
        });
        const plant = await GIS.getPlant();
        const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [16.0, 108.0];
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
