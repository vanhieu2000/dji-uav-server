/* =====================================================================
   TRANG CÀI ĐẶT TÀI SẢN: cây tài sản + bản đồ chỉnh sửa + form chi tiết.
     GIS.Assets.open(rootElement)
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;
  const esc = GIS.esc;
  const F = () => GIS.AssetForms;

  const state = {
    root: null, map: null, layersCtl: null, editGroup: null,
    tree: null, expanded: new Set(['plant']), filter: '',
    sel: null,          // { type, id, parentId, data, isNew }
    point: null,        // { lat, lng } đang sửa
    polygon: null,      // GeoJSON geometry đang sửa
    gen: { start: null, end: null },
    mode: null,         // 'point' | 'gen-start' | 'gen-end' | 'photo'
    photoPoints: [],
    reqId: 0            // tăng mỗi lần chọn tài sản; bỏ kết quả của lần chọn cũ trả về muộn
  };

  /* ---------------- Khung trang ---------------- */

  function buildLayout(root) {
    root.innerHTML = `
      <div class="gis-assets-layout">
        <section class="gis-tree-panel" aria-label="Cây tài sản">
          <div class="gis-tree-tools">
            <input class="input" id="gis-tree-filter" type="search" placeholder="Lọc theo mã / tên..." aria-label="Lọc cây tài sản">
            <div class="gis-row">
              <button class="btn sm" data-act="new-area">+ Khu vực pin</button>
              <button class="btn sm" data-act="new-substation">+ Trạm</button>
              <button class="btn sm" data-act="reload" title="Tải lại">⟳</button>
            </div>
          </div>
          <div class="gis-tree" id="gis-tree"><div class="gis-empty">Đang tải...</div></div>
        </section>
        <section class="gis-assets-map" aria-label="Bản đồ chỉnh sửa">
          <div id="gis-assets-map"></div>
          <div class="gis-map-mode" id="gis-map-mode" hidden></div>
        </section>
        <section class="gis-detail" id="gis-detail" aria-label="Chi tiết tài sản">
          <div class="gis-empty">Chọn một tài sản trong cây để xem và sửa.</div>
        </section>
      </div>`;

    root.querySelector('#gis-tree-filter').addEventListener('input', e => {
      state.filter = e.target.value.trim().toUpperCase();
      renderTree();
    });
    root.querySelector('.gis-tree-tools').addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'reload') loadTree();
      if (act.dataset.act === 'new-area') startNew('area', state.tree && state.tree.plant.plant_id);
      if (act.dataset.act === 'new-substation') startNew('substation', state.tree && state.tree.plant.plant_id);
    });
    root.querySelector('#gis-tree').addEventListener('click', onTreeClick);
    root.querySelector('#gis-detail').addEventListener('click', onDetailClick);
  }

  async function initMap() {
    const el = state.root.querySelector('#gis-assets-map');
    const plant = await GIS.getPlant();
    const center = plant && plant.center_lat != null ? [plant.center_lat, plant.center_lng] : [16.0, 108.0];
    const map = L.map(el, { center, zoom: 17, maxZoom: 22, zoomControl: true });
    const sat = (typeof BASEMAPS !== 'undefined' && BASEMAPS.satellite) || { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Esri' };
    L.tileLayer(sat.url, { maxZoom: 22, maxNativeZoom: sat.native || 18, attribution: sat.attr }).addTo(map);
    state.map = map;
    state.editGroup = L.featureGroup().addTo(map);
    state.layersCtl = GIS.attachMap(map, { kind: 'solar', visible: ['areas', 'strings', 'panels', 'substations', 'disconnectors', 'contacts', 'photo_points'] });
    map.on('click', onMapClick);
    // Đang chọn điểm trên bản đồ: không mở popup của lớp tài sản bên dưới
    map.on('popupopen', () => { if (state.mode) map.closePopup(); });
    if (map.pm) {
      map.pm.setGlobalOptions({ snappable: true, allowSelfIntersection: false });
      map.on('pm:create', e => {
        state.polygon = e.layer.toGeoJSON().geometry;
        map.removeLayer(e.layer);
        drawEditGeometry();
        updatePolygonState();
        setMode(null);
      });
      // Bấm Esc khi đang vẽ: thoát chế độ vẽ
      map.on('pm:drawend', () => { if (state.mode === 'polygon') setMode(null); });
    }
  }

  /* ---------------- Cây tài sản ---------------- */

  async function loadTree() {
    const treeEl = state.root.querySelector('#gis-tree');
    try {
      state.tree = (await GIS.api('GET', '/api/assets/tree')).data;
    } catch (e) {
      state.tree = null;
      treeEl.innerHTML = /nhà máy/i.test(e.message)
        ? `<div class="gis-empty">Chưa có nhà máy. <button class="btn sm primary" data-new="plant">+ Tạo nhà máy</button></div>`
        : `<div class="gis-empty gis-error">${esc(e.message)}</div>`;
      return;
    }
    renderTree();
  }

  function match(...texts) {
    if (!state.filter) return true;
    return texts.some(t => String(t || '').toUpperCase().includes(state.filter));
  }

  function node(type, id, label, sub, children, extra = '') {
    const key = `${type}:${id}`;
    const hasKids = Boolean(children);
    const open = state.expanded.has(key) || Boolean(state.filter);
    const selected = state.sel && !state.sel.isNew && state.sel.type === type && state.sel.id === id;
    return `<li>
      <div class="gis-node ${selected ? 'on' : ''}" data-type="${type}" data-id="${id}">
        <button class="gis-caret ${hasKids ? '' : 'leaf'}" data-toggle="${key}" aria-label="Mở/đóng">${hasKids ? (open ? '▾' : '▸') : '•'}</button>
        <span class="gis-node-label"><b>${esc(label)}</b> <span class="faint">${esc(sub || '')}</span></span>${extra}
      </div>
      ${hasKids && open ? `<ul>${children}</ul>` : ''}
    </li>`;
  }

  function renderTree() {
    const t = state.tree;
    if (!t) return;
    const areas = t.areas.map(a => {
      const strings = a.strings.filter(s => match(a.area_code, a.area_name, s.string_code, s.string_name))
        .map(s => node('string', s.string_id, s.string_code, `${s.actual_panel_count} tấm`, null,
          s.abnormal_count ? `<span class="tag warn">${s.abnormal_count}</span>` : ''))
        .join('');
      if (!match(a.area_code, a.area_name) && !strings) return '';
      return node('area', a.area_id, a.area_code, a.area_name, strings || ' ', a.has_polygon ? '' : '<span class="tag off" title="Chưa vẽ ranh giới">chưa vẽ</span>');
    }).join('');
    const subs = t.substations.map(s => {
      const bays = s.bays.map(b => {
        const dcls = b.disconnectors.map(d => {
          const contacts = d.contacts.filter(c => match(d.dcl_code, c.contact_code, c.contact_name))
            .map(c => node('contact', c.contact_id, c.contact_code, c.position_desc || c.contact_name)).join('');
          if (!match(b.bay_code, d.dcl_code, d.dcl_name) && !contacts) return '';
          return node('disconnector', d.disconnector_id, `${d.dcl_code} ${d.phase === '3PHASE' ? '' : d.phase}`, d.latitude == null ? 'chưa có tọa độ' : '', contacts || ' ');
        }).join('');
        if (!match(b.bay_code, b.bay_name) && !dcls) return '';
        return node('bay', b.bay_id, b.bay_code, b.bay_name, dcls || ' ');
      }).join('');
      if (!match(s.substation_code, s.substation_name) && !bays) return '';
      return node('substation', s.substation_id, s.substation_code, s.substation_name, bays || ' ');
    }).join('');

    state.root.querySelector('#gis-tree').innerHTML = `<ul class="gis-tree-root">
      ${node('plant', t.plant.plant_id, t.plant.plant_code, t.plant.plant_name, null)}
      <li class="gis-tree-group">Pin mặt trời (${t.areas.length} khu)</li>${areas || '<li class="gis-empty">Chưa có khu vực</li>'}
      <li class="gis-tree-group">Trạm biến áp (${t.substations.length})</li>${subs || '<li class="gis-empty">Chưa có trạm</li>'}
    </ul>`;
  }

  function onTreeClick(e) {
    const newBtn = e.target.closest('[data-new]');
    if (newBtn) { startNew(newBtn.dataset.new, null); return; }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
      renderTree();
      return;
    }
    const n = e.target.closest('.gis-node');
    if (n) select(n.dataset.type, Number(n.dataset.id));
  }

  /** Tìm id cha của một nút trong cây (để biết gọi API danh sách nào). */
  function findParent(type, id) {
    const t = state.tree;
    if (type === 'string') return (t.areas.find(a => a.strings.some(s => s.string_id === id)) || {}).area_id;
    for (const s of t.substations) {
      if (type === 'bay' && s.bays.some(b => b.bay_id === id)) return s.substation_id;
      for (const b of s.bays) {
        if (type === 'disconnector' && b.disconnectors.some(d => d.disconnector_id === id)) return b.bay_id;
        for (const d of b.disconnectors) {
          if (type === 'contact' && d.contacts.some(c => c.contact_id === id)) return d.disconnector_id;
        }
      }
    }
    return null;
  }

  /** Lấy bản ghi đầy đủ (có cả ranh giới GeoJSON) để sửa. */
  async function loadRecord(type, id, parentId) {
    const find = (rows, key) => rows.find(r => r[key] === id);
    switch (type) {
      case 'plant': return find((await GIS.api('GET', '/api/solar/plants')).data, 'plant_id');
      case 'area': return (await GIS.api('GET', `/api/solar/areas/${id}`)).data;
      case 'string': return find((await GIS.api('GET', `/api/solar/strings?area_id=${parentId}`)).data, 'string_id');
      case 'substation': return find((await GIS.api('GET', '/api/substation')).data, 'substation_id');
      case 'bay': return find((await GIS.api('GET', `/api/substation/bays?substation_id=${parentId}`)).data, 'bay_id');
      case 'disconnector': return find((await GIS.api('GET', `/api/substation/disconnectors?bay_id=${parentId}`)).data, 'disconnector_id');
      case 'contact': return find((await GIS.api('GET', `/api/substation/contacts?disconnector_id=${parentId}`)).data, 'contact_id');
      default: return null;
    }
  }

  function parseGeo(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  async function select(type, id) {
    const my = ++state.reqId;
    const parentId = findParent(type, id);
    const data = await GIS.run(() => loadRecord(type, id, parentId));
    if (my !== state.reqId) return; // người dùng đã chọn tài sản khác trong lúc chờ
    if (!data) return;
    state.expanded.add(`${type}:${id}`);
    openRecord({ type, id, parentId, data, isNew: false });
    renderTree();
    if (F().TYPES[type].photoAsset) loadPhotoPoints();
    focusMap();
  }

  function startNew(type, parentId) {
    state.reqId += 1;
    openRecord({ type, id: null, parentId, data: {}, isNew: true });
    renderTree();
  }

  function openRecord(sel) {
    const def = F().TYPES[sel.type];
    state.sel = sel;
    state.point = def.point && sel.data[def.point[0]] != null ? { lat: Number(sel.data[def.point[0]]), lng: Number(sel.data[def.point[1]]) } : null;
    state.polygon = def.polygon ? parseGeo(sel.data[def.polygon]) : null;
    state.gen = { start: null, end: null };
    state.photoPoints = [];
    setMode(null);
    renderDetail();
    drawEditGeometry();
  }

  /* ---------------- Form chi tiết ---------------- */

  function renderDetail() {
    const sel = state.sel;
    const def = F().TYPES[sel.type];
    const childType = F().CHILD_TYPE[sel.type];
    const d = sel.data;
    const pointHtml = def.point ? `
      <fieldset class="gis-fieldset"><legend>Vị trí</legend>
        <div class="gis-grid2">
          <div class="field"><label for="gis-lat">Vĩ độ</label><input class="input" id="gis-lat" inputmode="decimal" value="${state.point ? esc(state.point.lat) : ''}"></div>
          <div class="field"><label for="gis-lng">Kinh độ</label><input class="input" id="gis-lng" inputmode="decimal" value="${state.point ? esc(state.point.lng) : ''}"></div>
        </div>
        <button class="btn sm" type="button" data-act="pick-point">📍 Chọn trên bản đồ</button>
      </fieldset>` : '';
    const polyHtml = def.polygon ? `
      <fieldset class="gis-fieldset"><legend>Ranh giới</legend>
        <div class="faint" id="gis-poly-state"></div>
        <div class="gis-row">
          <button class="btn sm" type="button" data-act="draw-polygon" ${state.map && state.map.pm ? '' : 'disabled title="Chưa tải được công cụ vẽ"'}></button>
          <button class="btn sm danger" type="button" data-act="clear-polygon">Xóa ranh giới</button>
        </div>
      </fieldset>` : '';
    const genHtml = def.generatePanels && !sel.isNew ? `
      <fieldset class="gis-fieldset"><legend>Sinh vị trí tấm pin</legend>
        <p class="faint">Bấm điểm đầu và điểm cuối của chuỗi trên bản đồ, nhập số tấm. Tấm pin cũ của chuỗi sẽ được thay thế.</p>
        <div class="gis-row">
          <button class="btn sm" data-act="gen-start">① Điểm đầu ${state.gen.start ? '✓' : ''}</button>
          <button class="btn sm" data-act="gen-end">② Điểm cuối ${state.gen.end ? '✓' : ''}</button>
        </div>
        <div class="gis-grid2">
          <div class="field"><label for="gis-gen-count">Số tấm</label><input class="input" id="gis-gen-count" inputmode="numeric" value="${esc(d.panel_count || 24)}"></div>
          <div class="field"><label for="gis-gen-prefix">Tiền tố mã tấm</label><input class="input" id="gis-gen-prefix" placeholder="Tự đặt theo mã khu-chuỗi"></div>
        </div>
        <button class="btn sm primary" data-act="gen-run">Sinh tấm pin</button>
        <div class="faint">Hiện có ${Number(d.actual_panel_count) || 0} tấm.</div>
      </fieldset>` : '';
    const photoHtml = def.photoAsset && !sel.isNew ? `
      <fieldset class="gis-fieldset"><legend>Điểm chụp ảnh</legend>
        <div class="gis-grid3">
          <div class="field"><label for="gis-pp-alt">Độ cao (m)</label><input class="input" id="gis-pp-alt" inputmode="decimal" value="${esc(def.defaultAlt)}"></div>
          <div class="field"><label for="gis-pp-pitch">Gimbal (°)</label><input class="input" id="gis-pp-pitch" inputmode="decimal" value="${esc(def.defaultPitch)}"></div>
          <div class="field"><label for="gis-pp-cam">Camera</label><select class="input" id="gis-pp-cam">
            <option value="WIDE_IR">Rộng + nhiệt</option><option value="IR">Nhiệt</option><option value="WIDE">Rộng</option><option value="ZOOM">Zoom</option></select></div>
        </div>
        <button class="btn sm" data-act="add-photo">📷 Thêm điểm chụp (bấm lên bản đồ)</button>
        <div id="gis-photo-list" class="gis-photo-list"><div class="faint">Đang tải...</div></div>
      </fieldset>` : '';

    state.root.querySelector('#gis-detail').innerHTML = `
      <div class="gis-detail-head">
        <div><span class="gis-chip">${def.label}</span>
          <h2>${sel.isNew ? 'Thêm mới' : esc(d[def.fields[0][0]] || '')}</h2></div>
      </div>
      <form id="gis-form" class="gis-form" autocomplete="off">
        ${def.fields.map(f => F().inputHtml(f, d[f[0]])).join('')}
        ${pointHtml}${polyHtml}
        <div class="gis-row gis-actions">
          <button class="btn primary" type="submit">💾 Lưu</button>
          ${!sel.isNew && def.canDelete !== false ? '<button class="btn danger" type="button" data-act="delete">Xóa</button>' : ''}
          ${!sel.isNew && childType ? `<button class="btn" type="button" data-act="add-child">+ ${F().TYPES[childType].label}</button>` : ''}
          ${sel.isNew ? '<button class="btn" type="button" data-act="cancel">Hủy</button>' : ''}
        </div>
      </form>
      ${genHtml}${photoHtml}`;

    const form = state.root.querySelector('#gis-form');
    form.addEventListener('submit', e => { e.preventDefault(); save(); });
    updatePolygonState();
    ['gis-lat', 'gis-lng'].forEach(id => {
      const el = form.querySelector('#' + id);
      if (el) el.addEventListener('change', readPointInputs);
    });
  }

  /** Cập nhật dòng trạng thái ranh giới mà không vẽ lại form (giữ dữ liệu đang nhập). */
  function updatePolygonState() {
    const text = state.root.querySelector('#gis-poly-state');
    if (!text) return;
    text.textContent = state.polygon ? 'Đã có ranh giới (kéo các đỉnh trên bản đồ để sửa). Bấm Lưu để ghi.' : 'Chưa vẽ ranh giới.';
    const draw = state.root.querySelector('[data-act="draw-polygon"]');
    if (draw) draw.textContent = state.polygon ? '✏️ Vẽ lại' : '✏️ Vẽ ranh giới';
    const clear = state.root.querySelector('[data-act="clear-polygon"]');
    if (clear) clear.style.display = state.polygon ? '' : 'none'; // .btn ghi đè thuộc tính hidden
  }

  function readPointInputs() {
    const lat = parseFloat(String(state.root.querySelector('#gis-lat').value).replace(',', '.'));
    const lng = parseFloat(String(state.root.querySelector('#gis-lng').value).replace(',', '.'));
    state.point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    drawEditGeometry();
  }

  function onDetailClick(e) {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    const handlers = {
      'pick-point': () => setMode('point'),
      'draw-polygon': () => { state.map.pm.enableDraw('Polygon'); setMode('polygon'); },
      'clear-polygon': () => { state.polygon = null; drawEditGeometry(); updatePolygonState(); },
      'gen-start': () => setMode('gen-start'),
      'gen-end': () => setMode('gen-end'),
      'gen-run': generatePanels,
      'add-photo': () => setMode('photo'),
      'del-photo': () => deletePhotoPoint(Number(act.dataset.id)),
      delete: remove,
      'add-child': () => startNew(F().CHILD_TYPE[state.sel.type], state.sel.id),
      cancel: () => {
        stopMode();
        state.sel = null;
        state.root.querySelector('#gis-detail').innerHTML = '<div class="gis-empty">Chọn một tài sản trong cây để xem và sửa.</div>';
        drawEditGeometry();
      }
    };
    if (handlers[a]) handlers[a]();
  }

  /* ---------------- Bản đồ: chế độ bấm chọn ---------------- */

  const MODE_TEXT = {
    point: 'Bấm lên bản đồ để đặt vị trí',
    polygon: 'Bấm các đỉnh ranh giới, bấm lại điểm đầu để khép kín',
    'gen-start': 'Bấm vào tấm pin ĐẦU chuỗi',
    'gen-end': 'Bấm vào tấm pin CUỐI chuỗi',
    photo: 'Bấm vị trí máy bay đứng chụp ảnh'
  };

  function setMode(mode) {
    state.mode = mode;
    const el = state.root.querySelector('#gis-map-mode');
    if (!el) return;
    if (!mode) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `${MODE_TEXT[mode]} <button class="btn sm" type="button">Hủy</button>`;
    el.querySelector('button').onclick = stopMode;
  }

  /** Thoát mọi chế độ bấm bản đồ (kể cả đang vẽ đa giác). */
  function stopMode() {
    if (state.map && state.map.pm && state.map.pm.globalDrawModeEnabled && state.map.pm.globalDrawModeEnabled()) {
      state.map.pm.disableDraw();
    }
    setMode(null);
  }

  function onMapClick(e) {
    if (!state.sel || !state.mode) return;
    const p = { lat: Number(e.latlng.lat.toFixed(7)), lng: Number(e.latlng.lng.toFixed(7)) };
    switch (state.mode) {
      case 'point':
        state.point = p;
        state.root.querySelector('#gis-lat').value = p.lat;
        state.root.querySelector('#gis-lng').value = p.lng;
        setMode(null);
        drawEditGeometry();
        break;
      case 'gen-start':
        state.gen.start = p; setMode('gen-end'); drawEditGeometry(); renderGenButtons();
        break;
      case 'gen-end':
        state.gen.end = p; setMode(null); drawEditGeometry(); renderGenButtons();
        break;
      case 'photo':
        addPhotoPoint(p);
        break;
      default:
    }
  }

  function renderGenButtons() {
    const s = state.root.querySelector('[data-act="gen-start"]');
    const en = state.root.querySelector('[data-act="gen-end"]');
    if (s) s.textContent = `① Điểm đầu ${state.gen.start ? '✓' : ''}`;
    if (en) en.textContent = `② Điểm cuối ${state.gen.end ? '✓' : ''}`;
  }

  /** Vẽ hình đang sửa: điểm (kéo được), đa giác (sửa đỉnh), đoạn sinh tấm pin. */
  function drawEditGeometry() {
    const g = state.editGroup;
    if (!g) return;
    g.clearLayers();
    if (!state.sel) return;
    if (state.point) {
      const m = L.marker([state.point.lat, state.point.lng], { draggable: true, zIndexOffset: 2000 }).addTo(g);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        state.point = { lat: Number(ll.lat.toFixed(7)), lng: Number(ll.lng.toFixed(7)) };
        const la = state.root.querySelector('#gis-lat');
        if (la) { la.value = state.point.lat; state.root.querySelector('#gis-lng').value = state.point.lng; }
      });
    }
    if (state.polygon) {
      const poly = L.geoJSON(state.polygon, { style: { color: '#e59a0c', weight: 3, fillOpacity: 0.15, dashArray: '6 4' } });
      poly.eachLayer(layer => {
        layer.addTo(g);
        if (layer.pm) {
          layer.pm.enable({ allowSelfIntersection: false });
          layer.on('pm:edit', () => { state.polygon = layer.toGeoJSON().geometry; });
        }
      });
    }
    const { start, end } = state.gen;
    if (start) L.circleMarker([start.lat, start.lng], { radius: 7, color: '#2f9e74', fillOpacity: 1 }).bindTooltip('Đầu', { permanent: true }).addTo(g);
    if (end) L.circleMarker([end.lat, end.lng], { radius: 7, color: '#cf2f5e', fillOpacity: 1 }).bindTooltip('Cuối', { permanent: true }).addTo(g);
    if (start && end) L.polyline([[start.lat, start.lng], [end.lat, end.lng]], { color: '#38bdf8', dashArray: '4 4' }).addTo(g);
  }

  function focusMap() {
    if (!state.map) return;
    if (state.polygon) {
      const b = L.geoJSON(state.polygon).getBounds();
      if (b.isValid()) { state.map.fitBounds(b, { maxZoom: 20, padding: [30, 30] }); return; }
    }
    if (state.point) state.map.setView([state.point.lat, state.point.lng], Math.max(state.map.getZoom(), 19));
  }

  /* ---------------- Lưu / Xóa ---------------- */

  function apiPath(type, id) {
    const base = F().TYPES[type].api;
    return id ? `${base}/${id}` : base;
  }

  async function save() {
    const sel = state.sel;
    const def = F().TYPES[sel.type];
    const body = F().readForm(state.root.querySelector('#gis-form'), sel.type);
    if (def.point) {
      readPointInputs();
      body[def.point[0]] = state.point ? state.point.lat : null;
      body[def.point[1]] = state.point ? state.point.lng : null;
    }
    if (def.polygon) body[def.polygon] = state.polygon;
    if (sel.isNew && def.parentKey && sel.parentId) body[def.parentKey] = sel.parentId;
    const res = await GIS.run(() => GIS.api(sel.isNew ? 'POST' : 'PUT', apiPath(sel.type, sel.isNew ? null : sel.id), body));
    if (!res) return;
    GIS.toast(res.message || 'Đã lưu');
    const newId = sel.isNew ? res.data[def.idKey] : sel.id;
    await loadTree();
    GIS.emit('assets-changed');
    if (newId) select(sel.type, newId);
  }

  async function remove() {
    const sel = state.sel;
    const def = F().TYPES[sel.type];
    const name = sel.data[def.fields[0][0]];
    if (!window.confirm(`Xóa ${def.label.toLowerCase()} "${name}"? Các tài sản con bên trong cũng bị xóa. Không hoàn tác được.`)) return;
    const res = await GIS.run(() => GIS.api('DELETE', apiPath(sel.type, sel.id)));
    if (!res) return;
    GIS.toast(res.message || 'Đã xóa');
    stopMode();
    state.sel = null;
    state.root.querySelector('#gis-detail').innerHTML = '<div class="gis-empty">Đã xóa. Chọn tài sản khác trong cây.</div>';
    drawEditGeometry();
    await loadTree();
    GIS.emit('assets-changed');
  }

  async function generatePanels() {
    const { start, end } = state.gen;
    if (!start || !end) { GIS.toast('Chọn điểm đầu và điểm cuối trên bản đồ trước', 'error'); return; }
    const count = state.root.querySelector('#gis-gen-count').value;
    const prefix = state.root.querySelector('#gis-gen-prefix').value.trim();
    if (Number(state.sel.data.actual_panel_count) > 0 &&
        !window.confirm(`Chuỗi đang có ${state.sel.data.actual_panel_count} tấm. Thay bằng ${count} tấm mới?`)) return;
    const res = await GIS.run(() => GIS.api('POST', `/api/solar/strings/${state.sel.id}/generate-panels`, {
      start_lat: start.lat, start_lng: start.lng, end_lat: end.lat, end_lng: end.lng, count, serial_prefix: prefix || undefined
    }));
    if (!res) return;
    GIS.toast(res.message);
    await loadTree();
    GIS.emit('assets-changed');
    select('string', state.sel.id);
  }

  /* ---------------- Điểm chụp ảnh ---------------- */

  async function loadPhotoPoints() {
    const sel = state.sel;
    if (!sel || sel.isNew) return;
    const def = F().TYPES[sel.type];
    const res = await GIS.run(() => GIS.api('GET', `/api/assets/photo-points?asset_type=${def.photoAsset}&asset_id=${sel.id}`));
    if (state.sel !== sel) return; // đã chuyển sang tài sản khác
    state.photoPoints = res ? res.data : [];
    const el = state.root.querySelector('#gis-photo-list');
    if (!el) return;
    el.innerHTML = state.photoPoints.length
      ? state.photoPoints.map((p, i) => `<div class="gis-photo-item">
          <span>#${i + 1} · ${esc(p.altitude_m)} m · ${esc(p.gimbal_pitch)}° · ${esc(p.camera_mode)}</span>
          <button class="btn sm danger" data-act="del-photo" data-id="${p.point_id}" aria-label="Xóa điểm chụp">✕</button></div>`).join('')
      : '<div class="faint">Chưa có điểm chụp nào.</div>';
  }

  async function addPhotoPoint(p) {
    const def = F().TYPES[state.sel.type];
    const body = {
      asset_type: def.photoAsset, asset_id: state.sel.id, latitude: p.lat, longitude: p.lng,
      altitude_m: state.root.querySelector('#gis-pp-alt').value,
      gimbal_pitch: state.root.querySelector('#gis-pp-pitch').value,
      camera_mode: state.root.querySelector('#gis-pp-cam').value,
      sort_order: state.photoPoints.length
    };
    const res = await GIS.run(() => GIS.api('POST', '/api/assets/photo-points', body), 'Đã thêm điểm chụp');
    if (!res) return;
    loadPhotoPoints();
    GIS.emit('assets-changed');
  }

  async function deletePhotoPoint(id) {
    const res = await GIS.run(() => GIS.api('DELETE', `/api/assets/photo-points/${id}`), 'Đã xóa điểm chụp');
    if (!res) return;
    loadPhotoPoints();
    GIS.emit('assets-changed');
  }

  /* ---------------- Mở trang ---------------- */

  GIS.Assets = {
    async open(root) {
      if (!state.root) {
        state.root = root;
        buildLayout(root);
        await initMap();
      }
      setTimeout(() => state.map && state.map.invalidateSize(), 60);
      loadTree();
    }
  };
})();
