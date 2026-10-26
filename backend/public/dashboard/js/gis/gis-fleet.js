/* =====================================================================
   ĐỘI BAY REALTIME (Giai đoạn C3): mỗi máy bay một biểu tượng trên mọi bản đồ đã gắn,
   ảnh mới về hiện ngay tại vị trí chụp.
     GIS.Fleet.attach(map)          gắn bản đồ (gọi khi tạo bản đồ)
     GIS.Fleet.onOsd(sn, data)      gói OSD từ WebSocket
     GIS.Fleet.onStatus(msg)        device_status (ONLINE / OFFLINE)
     GIS.Fleet.onPhoto(media)       ảnh mới (media_synced)
     GIS.Fleet.list()               danh sách máy bay hiện biết
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const MAX_PHOTOS = 300;
  const LENS_COLOR = { IR: '#f97316', WIDE: '#38bdf8', ZOOM: '#a78bfa' };
  const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];

  const st = { maps: [], drones: new Map(), photos: [], listeners: [] };

  function colorOf(sn) {
    let h = 0;
    for (const c of String(sn)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function icon(d) {
    const off = d.status === 'OFFLINE';
    const color = off ? '#7d8e93' : colorOf(d.device_sn);
    const rot = (Number(d.yaw) || 0) - 90; // mũi tên ➤ hướng Đông, yaw DJI 0° = Bắc
    const rtk = d.rtk_state === 'FIX' ? 'FIX' : d.rtk_state === 'FLOAT' ? 'FLT' : '';
    return L.divIcon({
      className: 'gis-fleet-icon',
      html: `<div class="gis-fleet-drone${off ? ' off' : ''}" style="--c:${color}">
          <span class="gis-fleet-arrow" style="transform:rotate(${rot}deg)">➤</span>
        </div>
        <div class="gis-fleet-label" style="--c:${color}">${esc(String(d.device_sn).slice(-6))}${d.battery != null ? ` · ${esc(d.battery)}%` : ''}${rtk ? ` · ${rtk}` : ''}</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
  }

  function popup(d) {
    const st2 = { OFFLINE: 'Mất kết nối', IN_FLIGHT: 'Đang bay', ONLINE: 'Trực tuyến' }[d.status] || d.status;
    return `<b>${esc(d.device_name || d.device_sn)}</b><br>SN: <code>${esc(d.device_sn)}</code><br>
      Trạng thái: ${esc(st2)}${d.flight_session_id ? ` · chuyến #${esc(d.flight_session_id)}` : ''}<br>
      Cao ${d.rel_alt != null ? esc(Number(d.rel_alt).toFixed(1)) + ' m' : '–'} · ${d.speed != null ? esc(Number(d.speed).toFixed(1)) + ' m/s' : '–'} ·
      pin ${d.battery != null ? esc(d.battery) + ' %' : '–'}<br>
      RTK: ${esc(d.rtk_state || 'không rõ')}${d.gateway_sn ? `<br>Tay điều khiển: <code>${esc(d.gateway_sn)}</code>` : ''}`;
  }

  function hasPos(d) { return d.lat != null && d.lng != null && !(Number(d.lat) === 0 && Number(d.lng) === 0); }

  function render(d) {
    if (!d.markers) d.markers = new Map();
    st.maps.forEach(map => {
      let m = d.markers.get(map);
      if (!hasPos(d)) { if (m) { map.removeLayer(m); d.markers.delete(map); } return; }
      if (!m) {
        m = L.marker([d.lat, d.lng], { icon: icon(d), zIndexOffset: 1000 }).bindPopup(popup(d)).addTo(map);
        d.markers.set(map, m);
      } else {
        m.setLatLng([d.lat, d.lng]);
        m.setIcon(icon(d));
        m.setPopupContent(popup(d));
      }
    });
    st.listeners.forEach(fn => fn(list()));
  }

  function upsert(sn, patch) {
    const d = st.drones.get(sn) || { device_sn: sn };
    Object.assign(d, patch);
    st.drones.set(sn, d);
    render(d);
  }

  function photoMarker(p) {
    return L.circleMarker([p.latitude, p.longitude], { radius: 5, color: '#fff', weight: 1, fillColor: LENS_COLOR[p.lens] || '#7d8e93', fillOpacity: 0.95 })
      .bindPopup(`<b>${esc(p.file_name)}</b><br>${esc(p.device_sn || '')}<br>
        ${p.max_temperature != null ? `Nhiệt max ${esc(p.max_temperature)} °C<br>` : ''}
        <a href="${esc(p.file_url)}" target="_blank" rel="noopener">Mở ảnh</a>`);
  }

  function list() {
    return [...st.drones.values()].map(d => {
      const { markers, ...rest } = d;
      return rest;
    });
  }

  GIS.Fleet = {
    attach(map) {
      if (!map || st.maps.includes(map)) return;
      st.maps.push(map);
      const photoLayer = L.layerGroup().addTo(map);
      map._fleetPhotos = photoLayer;
      st.photos.forEach(p => photoMarker(p).addTo(photoLayer));
      st.drones.forEach(render);
    },
    onOsd(sn, data) {
      upsert(sn, {
        device_name: data.device_name, lat: data.lat, lng: data.lng, rel_alt: data.rel_alt, speed: data.speed, yaw: data.yaw,
        battery: data.battery, gateway_sn: data.gateway_sn, rtk_state: data.rtk_state,
        flight_session_id: data.flight_session_id || null,
        status: data.airborne ? 'IN_FLIGHT' : 'ONLINE'
      });
    },
    onStatus(msg) {
      if (!msg || !msg.device_sn) return;
      upsert(msg.device_sn, { status: msg.status });
    },
    onFlight(msg) {
      if (!msg || !msg.device_sn) return;
      upsert(msg.device_sn, msg.type === 'flight_started'
        ? { status: 'IN_FLIGHT', flight_session_id: msg.flight_session_id }
        : { status: 'ONLINE', flight_session_id: null });
    },
    onPhoto(media) {
      if (!media || media.latitude == null || media.longitude == null) return;
      st.photos.push(media);
      if (st.photos.length > MAX_PHOTOS) st.photos.shift();
      st.maps.forEach(map => {
        if (!map._fleetPhotos) return;
        photoMarker(media).addTo(map._fleetPhotos);
        const layers = map._fleetPhotos.getLayers();
        if (layers.length > MAX_PHOTOS) map._fleetPhotos.removeLayer(layers[0]);
      });
    },
    /** Nạp trạng thái hiện tại khi mở trang (máy bay đã kết nối từ trước). */
    async load() {
      const res = await GIS.api('GET', '/api/fleet').catch(() => null);
      if (res && res.data) res.data.forEach(d => upsert(d.device_sn, d));
    },
    list,
    onChange(fn) { st.listeners.push(fn); }
  };
})();
