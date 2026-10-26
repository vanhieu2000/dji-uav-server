/* =====================================================================
   GIS LAYERS: gắn các lớp tài sản vào một bản đồ Leaflet có sẵn.
     const ctl = GIS.attachMap(map, { kind: 'solar' | 'substation' | 'manual' });
     ctl.reload();            // tải lại dữ liệu
     ctl.focus(searchItem);   // bay tới và làm nổi tài sản
   Lớp nền vệ tinh vẫn do các nút có sẵn (setBasemap) điều khiển.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;

  const PANEL_MIN_ZOOM = 18;
  const COLORS = { brand: '#0d6e6e', ok: '#2f9e74', sun: '#e59a0c', hot: '#cf2f5e', gray: '#7d8e93', sky: '#38bdf8' };
  const PANEL_COLORS = { NORMAL: COLORS.ok, WARNING: COLORS.sun, DEFECT: COLORS.hot, OFFLINE: COLORS.gray };

  const LAYER_DEFS = {
    areas:         { label: 'Khu vực pin' },
    strings:       { label: 'Chuỗi pin' },
    panels:        { label: `Tấm pin (zoom ≥ ${PANEL_MIN_ZOOM})` },
    substations:   { label: 'Trạm & ngăn lộ', source: ['substations', 'bays'] },
    disconnectors: { label: 'Dao cách ly' },
    contacts:      { label: 'Mối nối DCL' },
    photo_points:  { label: 'Điểm chụp ảnh' },
    anomalies:     { label: 'Bất thường (AI)' }
  };

  const DEFAULT_VISIBLE = {
    solar: ['areas', 'strings', 'panels', 'anomalies'],
    substation: ['substations', 'disconnectors', 'contacts', 'photo_points', 'anomalies'],
    manual: ['areas', 'disconnectors', 'anomalies']
  };

  function dclColor(d) {
    if (d.last_inspected_temp == null) return COLORS.gray;
    if (Number(d.last_inspected_temp) > Number(d.max_allowed_temp)) return COLORS.hot;
    if (Number(d.last_inspected_temp) > Number(d.max_allowed_temp) * 0.9) return COLORS.sun;
    return COLORS.ok;
  }

  function dclPopup(d) {
    const t = d.last_inspected_temp == null ? 'Chưa đo' : `${Number(d.last_inspected_temp).toFixed(1)} °C`;
    return `<div class="gis-pop"><b>${esc(d.dcl_name || d.dcl_code)}</b>
      <div>Ngăn lộ: ${esc(d.bay_code)} · Pha ${esc(d.phase)}</div>
      <div>Nhiệt độ gần nhất: <b style="color:${dclColor(d)}">${esc(t)}</b> / ngưỡng ${esc(d.max_allowed_temp)} °C</div>
      <div class="faint">${GIS.fmt(d.latitude)}, ${GIS.fmt(d.longitude)}</div></div>`;
  }

  const DEFECT_LABELS = {
    HOTSPOT_PANEL: 'Điểm nóng tấm pin', DISCONNECTOR_OVERHEAT: 'Quá nhiệt dao cách ly',
    BYPASS_DIODE: 'Hỏng diode bypass', CELL_CRACK: 'Nứt cell', DIRT_SHADOW: 'Bụi bẩn / che bóng', OTHER: 'Khác'
  };

  function anomalyPopup(a) {
    const img = a.crop_image_url || a.file_url;
    const target = a.contact_code ? `Mối nối ${a.contact_code}` : a.dcl_code ? `DCL ${a.dcl_code} pha ${a.phase}` : a.panel_serial ? `Tấm ${a.panel_serial}` : 'Chưa gắn tài sản (theo tọa độ ảnh)';
    return `<div class="gis-pop"><b style="color:${COLORS.hot}">${esc(DEFECT_LABELS[a.defect_type] || a.defect_type)}</b>
      <div>${esc(target)}</div>
      <div>Nhiệt độ: <b>${a.max_temperature == null ? '--' : esc(Number(a.max_temperature).toFixed(1)) + ' °C'}</b>
        · Tin cậy ${a.confidence == null ? '--' : Math.round(a.confidence * 100) + '%'}</div>
      ${a.ticket_code ? `<div class="faint">Phiếu ${esc(a.ticket_code)}</div>` : ''}
      ${img ? `<a href="${esc(img)}" target="_blank" rel="noopener"><img class="gis-pop-img" src="${esc(img)}" alt="Ảnh bằng chứng" loading="lazy"></a>` : ''}
    </div>`;
  }

  function areaStyle(a) {
    const bad = Number(a.abnormal_count) > 0;
    return { color: bad ? COLORS.sun : COLORS.brand, weight: 2, fillColor: bad ? COLORS.sun : COLORS.brand, fillOpacity: 0.12 };
  }

  const ICONS = {
    photo: L.divIcon({ className: 'gis-icon-photo', html: '📷', iconSize: [20, 20], iconAnchor: [10, 10] }),
    anomaly: L.divIcon({ className: 'gis-icon-anomaly', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    focus: L.divIcon({ className: 'gis-icon-focus', html: '<span></span>', iconSize: [34, 34], iconAnchor: [17, 17] })
  };

  /** Bộ dựng lớp: nhận dữ liệu API, vẽ vào group. */
  const BUILDERS = {
    areas(group, rows) {
      rows.forEach(a => {
        const popup = `<div class="gis-pop"><b>${esc(a.area_name)}</b><div>Mã: ${esc(a.area_code)}</div>
          <div>Bất thường: <b>${Number(a.abnormal_count) || 0}</b> tấm</div>
          ${a.total_capacity_kwp ? `<div>Công suất: ${esc(a.total_capacity_kwp)} kWp</div>` : ''}</div>`;
        let layer;
        if (a.polygon_geojson) {
          layer = L.geoJSON(a.polygon_geojson, { style: () => areaStyle(a) });
        } else if (a.center_lat != null) {
          layer = L.circleMarker([a.center_lat, a.center_lng], { ...areaStyle(a), radius: 10, fillOpacity: 0.35 });
        }
        if (!layer) return;
        layer.bindPopup(popup).bindTooltip(esc(a.area_code), { permanent: true, direction: 'center', className: 'gis-label' });
        layer.addTo(group);
      });
    },
    strings(group, rows) {
      rows.forEach(s => {
        L.geoJSON(s.line_geojson, { style: { color: COLORS.sky, weight: 2, opacity: 0.8 } })
          .bindTooltip(`${esc(s.area_code)} / ${esc(s.string_code)}`)
          .addTo(group);
      });
    },
    panels(group, data, ctx) {
      (data.items || []).forEach(p => {
        L.circleMarker([p.latitude, p.longitude], {
          renderer: ctx.canvas, radius: 3.5, weight: 1, color: '#fff',
          fillColor: PANEL_COLORS[p.status] || COLORS.ok, fillOpacity: 0.95
        }).bindTooltip(`${esc(p.panel_serial || '')} · tấm ${esc(p.panel_index)}`).addTo(group);
      });
      ctx.setHint(data.truncated ? 'Quá nhiều tấm pin trong khung nhìn, phóng to thêm để thấy đủ' : '');
    },
    substations(group, data) {
      (data.substations || []).forEach(s => {
        const label = `<b>${esc(s.substation_name)}</b><br>${esc(s.substation_code)} · ${esc(s.voltage_level)}`;
        if (s.boundary_geojson) {
          L.geoJSON(s.boundary_geojson, { style: { color: COLORS.sun, weight: 2, fillOpacity: 0.06 } }).bindPopup(label).addTo(group);
        } else if (s.center_lat != null) {
          L.circleMarker([s.center_lat, s.center_lng], { radius: 9, color: COLORS.sun, fillColor: COLORS.sun, fillOpacity: 0.3 }).bindPopup(label).addTo(group);
        }
      });
      (data.bays || []).forEach(b => {
        L.circleMarker([b.center_lat, b.center_lng], { radius: 6, color: COLORS.sun, weight: 2, fillOpacity: 0 })
          .bindTooltip(`Ngăn ${esc(b.bay_code)}`, { permanent: true, direction: 'top', className: 'gis-label' })
          .bindPopup(`<b>${esc(b.bay_name)}</b><br>Trạm ${esc(b.substation_code)}`)
          .addTo(group);
      });
    },
    disconnectors(group, rows, ctx) {
      rows.forEach(d => {
        const col = dclColor(d);
        L.circleMarker([d.latitude, d.longitude], { radius: 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: 0.95 })
          .bindPopup(dclPopup(d))
          .bindTooltip(`${esc(d.dcl_code)} ${esc(d.phase)}`)
          .on('click', () => ctx.select({ type: 'disconnector', data: d }))
          .addTo(group);
      });
    },
    contacts(group, rows) {
      rows.forEach(c => {
        L.circleMarker([c.latitude, c.longitude], { radius: 4, color: COLORS.sky, weight: 2, fillColor: '#fff', fillOpacity: 1 })
          .bindPopup(`<b>Mối nối ${esc(c.contact_code)}</b><br>${esc(c.position_desc || c.contact_name || '')}<br>DCL ${esc(c.dcl_code)} pha ${esc(c.phase)}`)
          .addTo(group);
      });
    },
    photo_points(group, rows) {
      rows.forEach(p => {
        L.marker([p.latitude, p.longitude], { icon: ICONS.photo })
          .bindPopup(`<b>${esc(p.point_name || 'Điểm chụp ảnh')}</b><br>Độ cao ${esc(p.altitude_m)} m · gimbal ${esc(p.gimbal_pitch)}°<br>Camera ${esc(p.camera_mode)} · dừng ${esc(p.hover_seconds)} s`)
          .addTo(group);
      });
    },
    anomalies(group, rows, ctx) {
      rows.forEach(a => {
        L.marker([a.lat, a.lng], { icon: ICONS.anomaly, zIndexOffset: 500 }).bindPopup(anomalyPopup(a), { maxWidth: 280 }).addTo(group);
      });
      ctx.anomalies = rows;
    }
  };

  function bboxParam(map) {
    const b = map.getBounds();
    const r = n => n.toFixed(6);
    return `${r(b.getSouth())},${r(b.getWest())},${r(b.getNorth())},${r(b.getEast())}`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------------- Điều khiển tìm kiếm trên bản đồ ---------------- */

  const TYPE_LABELS = { area: 'Khu vực', string: 'Chuỗi', panel: 'Tấm pin', substation: 'Trạm', bay: 'Ngăn lộ', disconnector: 'DCL', contact: 'Mối nối' };

  function createSearchControl(ctl) {
    const SearchControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const box = L.DomUtil.create('div', 'gis-search');
        box.innerHTML = `<input type="search" placeholder="Tìm khu, chuỗi, mã tấm pin, DCL..." aria-label="Tìm tài sản trên bản đồ">
          <div class="gis-search-results" role="listbox"></div>`;
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        const input = box.querySelector('input');
        const list = box.querySelector('.gis-search-results');
        let items = [];
        const render = () => {
          list.innerHTML = items.length
            ? items.map((r, i) => `<button type="button" data-i="${i}" ${r.lat == null ? 'disabled title="Chưa có tọa độ"' : ''}>
                <span class="gis-chip">${TYPE_LABELS[r.type] || r.type}</span>
                <b>${esc(r.code || '')}</b> <span class="faint">${esc(r.name || '')}${r.parent ? ' · ' + esc(r.parent) : ''}</span></button>`).join('')
            : (input.value.trim().length >= 2 ? '<div class="gis-search-empty">Không tìm thấy</div>' : '');
        };
        const search = debounce(async () => {
          const q = input.value.trim();
          if (q.length < 2) { items = []; render(); return; }
          try {
            items = (await GIS.api('GET', `/api/assets/search?q=${encodeURIComponent(q)}&limit=15`)).data;
          } catch (e) {
            items = [];
            list.innerHTML = `<div class="gis-search-empty">${esc(e.message)}</div>`;
            return;
          }
          render();
        }, 250);
        // Chọn xong: bay tới, xóa ô tìm và đóng danh sách
        const pick = (item) => {
          ctl.focus(item);
          items = [];
          input.value = '';
          list.innerHTML = '';
          input.blur();
        };
        input.addEventListener('input', search);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const first = items.find(r => r.lat != null);
            if (first) pick(first);
          }
          if (e.key === 'Escape') { items = []; list.innerHTML = ''; }
        });
        list.addEventListener('click', e => {
          const btn = e.target.closest('button[data-i]');
          if (btn) pick(items[Number(btn.dataset.i)]);
        });
        ctl.searchInput = input;
        return box;
      }
    });
    return new SearchControl();
  }

  /* ---------------- Gắn vào bản đồ ---------------- */

  GIS.attachMap = function (map, options = {}) {
    const kind = options.kind || 'solar';
    const visible = new Set(options.visible || DEFAULT_VISIBLE[kind] || DEFAULT_VISIBLE.solar);
    const groups = {};
    const overlays = {};
    const ctl = {
      map, kind, groups, anomalies: [], baseMapLayers: [],
      canvas: L.canvas({ padding: 0.3 }),
      select: item => { if (typeof options.onSelect === 'function') options.onSelect(item); },
      setHint: text => { hintEl.textContent = text; hintEl.style.display = text ? 'block' : 'none'; }
    };

    Object.entries(LAYER_DEFS).forEach(([key, def]) => {
      groups[key] = L.layerGroup();
      overlays[def.label] = groups[key];
      if (visible.has(key)) groups[key].addTo(map);
    });

    const layerControl = L.control.layers(null, overlays, { position: 'topright', collapsed: true }).addTo(map);
    createSearchControl(ctl).addTo(map);

    const hintEl = L.DomUtil.create('div', 'gis-map-hint', map.getContainer());
    hintEl.style.display = 'none';

    let focusMarker = null;
    ctl.focus = function (item) {
      if (!item || item.lat == null) return;
      const zoom = item.type === 'panel' || item.type === 'contact' || item.type === 'disconnector' ? 20 : 18;
      map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), zoom), { duration: 0.9 });
      if (focusMarker) map.removeLayer(focusMarker);
      focusMarker = L.marker([item.lat, item.lng], { icon: ICONS.focus, interactive: false, zIndexOffset: 1000 }).addTo(map);
      setTimeout(() => { if (focusMarker) { map.removeLayer(focusMarker); focusMarker = null; } }, 6000);
      // Hiện lại lớp chứa tài sản nếu đang ẩn
      const layerOf = { area: 'areas', string: 'strings', panel: 'panels', substation: 'substations', bay: 'substations', disconnector: 'disconnectors', contact: 'contacts' }[item.type];
      if (layerOf && !map.hasLayer(groups[layerOf])) groups[layerOf].addTo(map);
      L.popup({ offset: [0, -10] }).setLatLng([item.lat, item.lng])
        .setContent(`<div class="gis-pop"><b>${esc(item.code || '')}</b><div>${esc(item.name || '')}</div>${item.parent ? `<div class="faint">${esc(item.parent)}</div>` : ''}</div>`)
        .openOn(map);
    };

    async function loadStatic() {
      const layers = ['areas', 'strings', 'substations', 'bays', 'disconnectors', 'contacts', 'photo_points', 'anomalies'];
      let data;
      try {
        data = (await GIS.api('GET', `/api/assets/features?layers=${layers.join(',')}`)).data;
      } catch (e) {
        ctl.setHint('Không tải được dữ liệu bản đồ: ' + e.message);
        return;
      }
      ['areas', 'strings', 'disconnectors', 'contacts', 'photo_points', 'anomalies'].forEach(key => {
        groups[key].clearLayers();
        BUILDERS[key](groups[key], data[key] || [], ctl);
      });
      groups.substations.clearLayers();
      BUILDERS.substations(groups.substations, { substations: data.substations, bays: data.bays }, ctl);
      if (typeof options.onData === 'function') options.onData(data, ctl);
    }

    const loadPanels = debounce(async () => {
      if (!map.hasLayer(groups.panels)) return;
      if (map.getZoom() < PANEL_MIN_ZOOM) {
        groups.panels.clearLayers();
        ctl.setHint('');
        return;
      }
      try {
        const data = (await GIS.api('GET', `/api/assets/features?layers=panels&bbox=${bboxParam(map)}`)).data.panels;
        groups.panels.clearLayers();
        BUILDERS.panels(groups.panels, data, ctl);
      } catch (e) {
        ctl.setHint('Không tải được tấm pin: ' + e.message);
      }
    }, 300);

    async function loadBaseMaps() {
      ctl.baseMapLayers.forEach(l => { layerControl.removeLayer(l); map.removeLayer(l); });
      ctl.baseMapLayers = [];
      const maps = await GIS.getBaseMaps();
      maps.forEach(m => {
        const opts = { minZoom: 0, maxZoom: 22, maxNativeZoom: m.max_zoom || 21, minNativeZoom: m.min_zoom || 0, opacity: m.opacity || 1, tms: m.scheme === 'tms', zIndex: 5 };
        if (m.bounds) opts.bounds = L.latLngBounds(m.bounds);
        const layer = L.tileLayer(m.tile_url, opts);
        layerControl.addOverlay(layer, `🗺️ Ảnh nhà máy: ${esc(m.map_name)}`);
        ctl.baseMapLayers.push(layer);
        if (m.is_active) layer.addTo(map);
      });
    }

    map.on('moveend', loadPanels);
    map.on('overlayadd', e => { if (e.layer === groups.panels) loadPanels(); });

    ctl.reload = function () {
      loadStatic();
      loadPanels();
    };
    ctl.reloadBaseMaps = loadBaseMaps;

    ctl.reload();
    loadBaseMaps();
    GIS.on('assets-changed', () => ctl.reload());
    GIS.on('basemaps-changed', () => loadBaseMaps());
    return ctl;
  };

  /** Đưa bản đồ về tâm nhà máy (nếu đã khai báo tọa độ). */
  GIS.centerOnPlant = async function (map, zoom) {
    const plant = await GIS.getPlant();
    if (plant && plant.center_lat != null && plant.center_lng != null) {
      map.setView([plant.center_lat, plant.center_lng], zoom || map.getZoom());
    }
    return plant;
  };

  GIS.DEFECT_LABELS = DEFECT_LABELS;
})();
