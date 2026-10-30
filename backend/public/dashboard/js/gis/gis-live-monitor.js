/* C3-C5: đa UAV, HMS, ảnh mới và chọn kênh theo phiếu. Không phát lệnh DJI. */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;
  const devices = new Map(), photos = new Map(), maps = new Map();
  let selected = null, ticketId = '', photoCursor = 0, generation = 0, loading = false, mounted = false;
  let deviceMode='single',defaultDevice=null,configLoaded=false;
  let onSelect = () => {}, streams = [], currentPath = null, trackedUrl=null, pendingPlaybackUntil=0;
  const finite = x => x != null && Number.isFinite(Number(x));
  const position = d => finite(d.lat) && finite(d.lng) && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180 && !(Number(d.lat) === 0 && Number(d.lng) === 0);
  const visible = d => !ticketId || String(d.ticket_id) === ticketId;

  function popup(d) {
    return `<b>${esc(d.device_sn)}</b><br>${esc(d.status || 'ONLINE')} · RTK ${esc(d.rtk_state || 'Chưa rõ')}
      <br>Pin: ${d.battery == null ? '–' : esc(d.battery) + '%'} · ${d.ticket_code ? esc(d.ticket_code) : d.ticket_id ? 'Phiếu #' + esc(d.ticket_id) : 'Chưa gắn phiếu'}`;
  }
  function draw() {
    for (const [map, st] of maps) {
      for (const [sn, marker] of st.devices) {
        const d = devices.get(sn);
        if (!d || !visible(d)) { st.uavs.removeLayer(marker); st.devices.delete(sn); }
      }
      for (const [sn, d] of devices) {
        if (!visible(d) || !position(d)) continue;
        let marker = st.devices.get(sn);
        const offline = d.status === 'OFFLINE';
        if (!marker) {
          marker = L.circleMarker([Number(d.lat), Number(d.lng)], { radius: 9, weight: 3, fillOpacity: 0.8 }).addTo(st.uavs);
          marker.on('click', () => select(sn)); st.devices.set(sn, marker);
        }
        marker.setLatLng([Number(d.lat), Number(d.lng)]).setStyle({ color: sn === selected ? '#0284c7' : offline ? '#94a3b8' : '#16a34a', fillColor: offline ? '#94a3b8' : '#22c55e' });
        marker.bindPopup(popup(d)); marker.bindTooltip(`${esc(sn)}${offline ? ' · OFFLINE' : ''}`);
      }
      st.images.clearLayers();
      for (const p of photos.values()) {
        if (!visible(p) || !position(p)) continue;
        L.circleMarker([Number(p.lat), Number(p.lng)], { radius: 4, color: p.lens === 'IR' ? '#f97316' : '#38bdf8', fillOpacity: 0.85 })
          .bindPopup(`<b>${esc(p.file_name)}</b><br>Phiếu ${esc(p.ticket_id || 'chưa xác định')} · ${esc(p.lens || 'chưa rõ')}
            <br>Định vị: ${esc(p.position_quality || 'UNKNOWN')}<br>${esc(p.captured_at ? new Date(p.captured_at).toLocaleString('vi-VN') : '')}`)
          .addTo(st.images);
      }
    }
  }
  function select(sn) {
    selected = sn || null; onSelect(selected);
    const d = devices.get(selected);
    if (d && position(d)) maps.forEach((st, map) => map.panTo([Number(d.lat), Number(d.lng)]));
    renderDevices(); draw();
  }
  function renderDevices() {
    const box = document.getElementById('uav-live-devices'); if (!box) return;
    const rows = [...devices.values()].filter(visible);
    if(configLoaded && deviceMode==='single' && !selected && rows.length){
      const active = defaultDevice?rows.find(d=>d.device_sn===defaultDevice):(rows.filter(d=>d.status==='ONLINE'||d.status==='IN_FLIGHT').length===1?rows.find(d=>d.status==='ONLINE'||d.status==='IN_FLIGHT'):rows.length===1?rows[0]:null);
      if(active){ selected = active.device_sn; onSelect(selected); }
    }
    const selector=document.getElementById('uav-monitor-target');
    if(selector){selector.innerHTML='<option value="">Chọn UAV để xem thông số</option>'+rows.map(d=>`<option value="${esc(d.device_sn)}">${esc(d.device_sn)} · ${esc(d.status||'Chưa rõ')}</option>`).join('');selector.value=selected||'';}
    box.innerHTML = rows.length ? rows.map(d => `<button class="btn sm ${d.device_sn === selected ? 'primary' : ''}" data-sn="${esc(d.device_sn)}">
      ${esc(d.device_sn)} · ${esc(d.status || 'ONLINE')} · ${d.battery == null ? '–' : esc(d.battery) + '%'}</button>`).join(' ')
      : '<span class="faint">Chưa có UAV kết nối trong phạm vi đã chọn.</span>';
    const current=devices.get(selected)||rows[0],online=current&&visible(current)&&current.status!=='OFFLINE';
    const state=document.getElementById('kpi-drone-st'),badge=document.getElementById('dash-drone-badge');
    if(state){
      state.textContent=online?'ĐÃ KẾT NỐI':current?'NGẮT KẾT NỐI':rows.length?'CHƯA CHỌN UAV':'CHƯA KẾT NỐI';
      state.style.color=online?'#10b981':'var(--ink3)';
    }
    if(badge){badge.className='tag '+(online?'ok':'off');badge.textContent=(current?current.device_sn:'UAV')+' · '+(online?'ONLINE · '+(current.battery==null?'--%':current.battery+'%'):'OFFLINE');badge.title=badge.textContent;}
    const reading=(key,suffix,decimals)=>online&&finite(current[key])?(decimals==null?Number(current[key]):Number(current[key]).toFixed(decimals))+suffix:'—';
    for(const [id,key,suffix,digits] of [['hud-alt-dash','alt',' m',1],['hud-spd-dash','speed',' m/s',1],['hud-bat-dash','battery','%',0],['hud-th-dash','thermal_max',' °C',1]]){const el=document.getElementById(id);if(el)el.textContent=reading(key,suffix,digits);}
    const sub=document.getElementById('kpi-drone-sub');if(sub)sub.textContent=current?`${current.device_sn} · Pin: ${reading('battery','%',0)} · Alt: ${reading('alt',' m',1)}`:'Chọn UAV để xem thông số hiện tại';
    const n = document.getElementById('uav-photo-count');
    if (n) n.textContent = `${photos.size} ảnh nhận được${ticketId ? ' của phiếu đang chọn' : ''}`;
  }
  function stopPlayback() {
    currentPath = null;
    if (typeof window.stopFlvLivePlayer === 'function') window.stopFlvLivePlayer();
  }
  async function refreshStreams(afterStop=false) {
    const selectEl = document.getElementById('uav-live-stream'); if (!selectEl) return;
    const token = generation;
    if (!ticketId&&!selected) {streams=[];return;}
    try {
      const r = await GIS.api('GET', ticketId?`/api/monitoring/live/${ticketId}`:'/api/monitoring/live-current?device_sn='+encodeURIComponent(selected));
      if (token !== generation) return;
      streams = r.data;
      selectEl.innerHTML = '<option value="">Chọn kênh phát</option>' + streams.map(s => `<option value="${esc(s.streamPath)}">${esc(s.device_sn)} · ${s.status === 'STREAMING' ? 'Đang phát' : s.status === 'RECONNECTING' ? 'Đang kết nối lại' : 'Chưa phát'}</option>`).join('');
      if (currentPath && streams.some(s => s.streamPath === currentPath && ['STREAMING','RECONNECTING'].includes(s.status))) selectEl.value = currentPath;
      else if (currentPath&&(afterStop||Date.now()>pendingPlaybackUntil)) stopPlayback();
      const active=streams.find(s=>s.status==='STREAMING'&&(!selected||s.device_sn===selected));
      if(active&&!currentPath){currentPath=active.streamPath;selectEl.value=currentPath;window.startFlvLivePlayer?.(active.streamPath,active.flv_url);}
    } catch (e) { selectEl.innerHTML = '<option value="">Không tải được kênh</option>'; }
  }
  async function refreshHms() {
    try {
      const r = await GIS.api('GET', '/api/monitoring/hms');
      const box = document.getElementById('uav-hms-list'); if (!box) return;
      const items = r.data.filter(x => !x.acknowledged_at && (!ticketId || visible(devices.get(x.device_sn) || {})));
      box.innerHTML = items.length ? items.map(x => `<div class="gis-hms-row"><b>${esc(x.device_sn)}</b> · mã ${esc(x.code)} · mức ${esc(x.level == null ? 'chưa rõ' : x.level)}
        ${x.message ? ' · ' + esc(x.message) : ''} <button class="btn sm" data-ack="${x.event_id}">Đã xem</button></div>`).join('')
        : '<span class="faint">Không có cảnh báo HMS chưa xem.</span>';
    } catch (e) { /* health banner handles connectivity; do not fabricate HMS */ }
  }
  async function catchUp() {
    if (loading) return;
    loading = true;
    const token = generation;
    try {
      const r = await GIS.api('GET', '/api/monitoring/devices');
      if (token !== generation) return;
      r.data.forEach(d => {
        const prev = devices.get(d.device_sn);
        // polling DB is throttled; never replace fresher websocket OSD
        if (!prev || !prev.last_seen || new Date(d.last_seen) >= new Date(prev.last_seen) || (d.status === 'ONLINE' && prev.status === 'OFFLINE')) {
          devices.set(d.device_sn, { ...prev, ...d });
        }
      });
      let more = true, pages = 0;
      while (more && token === generation && pages++ < 10) {
        const qs = new URLSearchParams({ after_id: photoCursor }); if (ticketId) qs.set('ticket_id', ticketId);
        const p = (await GIS.api('GET', `/api/monitoring/photos?${qs}`)).data;
        if (token !== generation) return;
        p.items.forEach(x => photos.set(x.media_id, x)); photoCursor = p.next_id; more = p.has_more;
      }
      renderDevices(); draw(); await Promise.all([refreshHms(), refreshStreams()]);
    } catch (e) { /* retried on next poll/reconnect */ }
    finally {
      for (const d of devices.values()) if (d.last_seen && Date.now() - new Date(d.last_seen).getTime() > 30000) d.status = 'OFFLINE';
      renderDevices(); draw(); loading = false;
    }
  }
  window.openTicketLive=(id,sn)=>{window.switchView('dashboard');GIS.LiveMonitor.openTicket(id,sn);};
  GIS.LiveMonitor = {
    addMap(map) {
      if (maps.has(map)) return;
      const uavs = L.layerGroup().addTo(map), images = L.layerGroup().addTo(map);
      maps.set(map, { uavs, images, devices: new Map() });
      const control = map.uavLayerControl || (map.uavLayerControl = L.control.layers(null, {}, { collapsed: true }).addTo(map));
      control.addOverlay(uavs, 'UAV trực tiếp');
      control.addOverlay(images, 'Ảnh đã nhận');
      draw();
    },
    onEvent(msg) {
      if (msg.type === 'osd' && msg.data && msg.device_sn) {
        const prev = devices.get(msg.device_sn) || {};
        devices.set(msg.device_sn, { ...prev, ...msg.data, device_sn: msg.device_sn });
        // Keep target selection explicit; incoming telemetry must not select a control target.
      } else if (msg.type === 'device_status') {
        const d = devices.get(msg.device_sn); if (d) d.status = msg.status;
      } else if (msg.type === 'media_synced' && msg.data) {
        const p = msg.data; if (visible(p)) photos.set(p.media_id, { ...p, lat: p.latitude, lng: p.longitude });
        // Do not advance cursor from WS: HTTP keyset must still recover missed earlier images.
      } else if (msg.type === 'hms') refreshHms();
      else if (msg.type === 'stream_started' || msg.type === 'stream_stopped') {
        if (!ticketId || String(msg.ticket_id) === ticketId) {
          // Re-read publisher state: a delayed stop event can belong to the previous connection.
          refreshStreams(msg.type==='stream_stopped');
        }
      }
      renderDevices(); draw();
    },
    reconnect: catchUp,
    selected: () => selected,
    selectDevice: select,
    openTicket(id,sn){ticketId=String(id);generation++;select(sn);const el=document.getElementById('uav-live-ticket');if(el)el.value=ticketId;stopPlayback();catchUp();},
    playbackStopped(){currentPath=null;trackedUrl=null;pendingPlaybackUntil=0;},
    trackPlayback(path,url){currentPath=path;trackedUrl=url;pendingPlaybackUntil=Date.now()+15000;},
    streamPath: () => currentPath,
    playbackUrl: () => streams.find(s=>s.streamPath===currentPath)?.flv_url || trackedUrl || null,
    mount(callback) {
      if (mounted) return; mounted = true; onSelect = callback;
      const selector=document.getElementById('uav-monitor-target');if(selector)selector.addEventListener('change',()=>select(selector.value));
      document.getElementById('uav-live-devices').addEventListener('click', e => {
        const b = e.target.closest('[data-sn]'); if (b) select(b.dataset.sn);
      });
      document.getElementById('uav-hms-list').addEventListener('click', e => {
        const b = e.target.closest('[data-ack]'); if (b) GIS.run(async () => { await GIS.api('PATCH', `/api/monitoring/hms/${b.dataset.ack}/ack`); await refreshHms(); });
      });
      document.getElementById('uav-live-ticket').addEventListener('change', e => {
        ticketId = e.target.value; generation++; photos.clear(); photoCursor = 0; stopPlayback(); select(null);
        catchUp(); // in-flight old generation finishes first, next poll retries if needed
      });
      document.getElementById('uav-live-stream').addEventListener('change', e => {
        stopPlayback();
        const s = streams.find(x => x.streamPath === e.target.value);
        if (!s || s.status !== 'STREAMING') { GIS.toast('Kênh chưa có publisher. Bật live trên Pilot 2 trước.'); return; }
        currentPath = s.streamPath;
        if (typeof window.switchView === 'function') window.switchView('dashboard');
        if (typeof window.startFlvLivePlayer === 'function') window.startFlvLivePlayer(currentPath, s.flv_url);
      });
      GIS.api('GET', '/api/tickets').then(r => {
        document.getElementById('uav-live-ticket').innerHTML = '<option value="">Tất cả phiếu</option>' + r.data.map(t => `<option value="${t.ticket_id}">${esc(t.ticket_code)} – ${esc(t.ticket_name)}</option>`).join('');
      }).catch(() => {});
      GIS.api('GET','/api/monitoring/config').then(r=>{deviceMode=r.data?.device_mode==='multi'?'multi':'single';defaultDevice=r.data?.default_device_sn||null;configLoaded=true;}).catch(()=>{}).finally(catchUp);setInterval(catchUp, 5000);
    }
  };
})();
