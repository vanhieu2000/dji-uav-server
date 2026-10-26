/* =====================================================================
   Mô tả form của từng loại tài sản và cách gọi API tương ứng.
   Dùng bởi gis-assets.js.
   ===================================================================== */
(function () {
  'use strict';
  const GIS = window.GIS;

  const PHASE_OPTIONS = [['3PHASE', '3 pha'], ['A', 'Pha A'], ['B', 'Pha B'], ['C', 'Pha C']];
  const STATE_OPTIONS = [['CLOSED', 'Đóng'], ['OPEN', 'Mở'], ['UNKNOWN', 'Không rõ']];

  /**
   * fields: [key, nhãn, kiểu, tùy chọn]
   *   kiểu: text | number | textarea | select
   * point: [cột vĩ độ, cột kinh độ]  (chọn trên bản đồ)
   * polygon: cột GeoJSON đa giác      (vẽ trên bản đồ)
   */
  const TYPES = {
    plant: {
      label: 'Nhà máy', idKey: 'plant_id', api: '/api/solar/plants', canDelete: false,
      fields: [['plant_code', 'Mã nhà máy *', 'text'], ['plant_name', 'Tên nhà máy *', 'text'], ['capacity_mwp', 'Công suất (MWp)', 'number'], ['address', 'Địa chỉ', 'text']],
      point: ['center_lat', 'center_lng'], polygon: 'boundary_geojson'
    },
    area: {
      label: 'Khu vực pin', idKey: 'area_id', api: '/api/solar/areas', parentKey: 'plant_id',
      fields: [['area_code', 'Mã khu vực *', 'text'], ['area_name', 'Tên khu vực *', 'text'], ['total_capacity_kwp', 'Công suất (kWp)', 'number']],
      point: ['center_lat', 'center_lng'], polygon: 'polygon_geojson', photoAsset: 'SOLAR_AREA', defaultPitch: -90, defaultAlt: 40
    },
    string: {
      label: 'Chuỗi pin', idKey: 'string_id', api: '/api/solar/strings', parentKey: 'area_id',
      fields: [['string_code', 'Mã chuỗi *', 'text'], ['string_name', 'Tên chuỗi', 'text'], ['inverter_channel', 'Kênh inverter (MPPT)', 'text'],
        ['panel_count', 'Số tấm theo thiết kế', 'number'], ['rated_power_w', 'Công suất định mức (W)', 'number']],
      photoAsset: 'SOLAR_STRING', defaultPitch: -90, defaultAlt: 25, generatePanels: true
    },
    substation: {
      label: 'Trạm biến áp', idKey: 'substation_id', api: '/api/substation', parentKey: 'plant_id',
      fields: [['substation_code', 'Mã trạm *', 'text'], ['substation_name', 'Tên trạm *', 'text'], ['voltage_level', 'Cấp điện áp', 'text']],
      point: ['center_lat', 'center_lng'], polygon: 'boundary_geojson'
    },
    bay: {
      label: 'Ngăn lộ', idKey: 'bay_id', api: '/api/substation/bays', parentKey: 'substation_id',
      fields: [['bay_code', 'Mã ngăn lộ *', 'text'], ['bay_name', 'Tên ngăn lộ *', 'text'], ['description', 'Mô tả', 'textarea']],
      point: ['center_lat', 'center_lng'], photoAsset: 'BAY', defaultPitch: -30, defaultAlt: 20
    },
    disconnector: {
      label: 'Dao cách ly', idKey: 'disconnector_id', api: '/api/substation/disconnectors', parentKey: 'bay_id',
      fields: [['dcl_code', 'Mã DCL *', 'text'], ['phase', 'Pha', 'select', PHASE_OPTIONS], ['dcl_name', 'Tên dao cách ly', 'text'],
        ['max_allowed_temp', 'Ngưỡng nhiệt cho phép (°C)', 'number'], ['state', 'Trạng thái', 'select', STATE_OPTIONS], ['altitude', 'Độ cao (m)', 'number']],
      point: ['latitude', 'longitude'], photoAsset: 'DISCONNECTOR', defaultPitch: -20, defaultAlt: 15
    },
    contact: {
      label: 'Mối nối', idKey: 'contact_id', api: '/api/substation/contacts', parentKey: 'disconnector_id',
      fields: [['contact_code', 'Mã mối nối *', 'text'], ['contact_name', 'Tên mối nối', 'text'], ['position_desc', 'Vị trí (đầu cực, lưỡi dao...)', 'text'],
        ['max_allowed_temp', 'Ngưỡng riêng (°C), trống = theo DCL', 'number'], ['sort_order', 'Thứ tự', 'number']],
      point: ['latitude', 'longitude'], photoAsset: 'DCL_CONTACT', defaultPitch: -20, defaultAlt: 12
    }
  };

  /** Loại con có thể thêm từ một nút cây. */
  const CHILD_TYPE = { plant: null, area: 'string', substation: 'bay', bay: 'disconnector', disconnector: 'contact' };

  function inputHtml([key, label, kind, opts], value) {
    const id = `gis-f-${key}`;
    const v = value == null ? '' : value;
    if (kind === 'select') {
      return `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}" name="${key}">
        ${opts.map(([val, text]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
    }
    if (kind === 'textarea') {
      return `<div class="field"><label for="${id}">${label}</label><textarea class="input gis-textarea" id="${id}" name="${key}" rows="2">${GIS.esc(v)}</textarea></div>`;
    }
    // Số dùng type="text" + inputmode để gõ được dấu phẩy thập phân (server tự đổi)
    return `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="${key}" type="text"
      ${kind === 'number' ? 'inputmode="decimal"' : ''} value="${GIS.esc(v)}"></div>`;
  }

  /** Đọc giá trị form -> object gửi API (ô trống gửi null để xóa giá trị). */
  function readForm(root, type) {
    const out = {};
    TYPES[type].fields.forEach(([key]) => {
      const el = root.querySelector(`[name="${key}"]`);
      if (!el) return;
      const val = el.value.trim();
      out[key] = val === '' ? null : val;
    });
    return out;
  }

  GIS.AssetForms = { TYPES, CHILD_TYPE, inputHtml, readForm };
})();
