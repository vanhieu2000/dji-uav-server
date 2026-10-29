/* =====================================================================
   GIS CORE: gọi API, thông báo, cảnh báo mất CSDL, thông tin nhà máy.
   Dùng chung cho các module gis-*.js (không phụ thuộc framework).
   ===================================================================== */
(function () {
  'use strict';

  const GIS = (window.GIS = window.GIS || {});

  /** Thoát ký tự HTML để chèn chuỗi người dùng vào innerHTML an toàn. */
  GIS.esc = function (value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  };

  GIS.fmt = function (n, digits = 6) {
    return n == null || n === '' || Number.isNaN(Number(n)) ? '--' : Number(n).toFixed(digits);
  };

  GIS.toast = function (msg, kind) {
    if (typeof window.toast === 'function' && !kind) return window.toast(msg);
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' gis-toast-error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 4500 : 2200);
  };

  /**
   * Gọi API JSON. Ném Error(message) khi server trả lỗi, để nơi gọi hiện thông báo.
   * body là FormData thì gửi nguyên (tải file).
   */
  GIS.api = async function (method, url, body, options = {}) {
    const token = localStorage.getItem('uav_token');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs??12000);
    const init = { signal:controller.signal, method, headers: token ? { Authorization: `Bearer ${token}` } : {} };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new Error(e.name==='AbortError'?'Máy chủ phản hồi quá lâu; bạn có thể chuyển tab và thử lại.':'Không kết nối được máy chủ');
    }finally{clearTimeout(timer);}
    let json = null;
    try { json = await res.json(); } catch (e) { /* không phải JSON */ }
    if (!res.ok || !json || json.code !== 0) {
      if (res.status === 503) GIS.setDbBanner(false);
      throw new Error((json && json.message) || `Lỗi máy chủ (${res.status})`);
    }
    return json;
  };

  /** Chạy hàm async, hiện thông báo lỗi nếu có. Trả kết quả hoặc undefined. */
  GIS.run = async function (fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) GIS.toast(okMsg);
      return r;
    } catch (e) {
      GIS.toast(e.message, 'error');
      return undefined;
    }
  };

  /* ---------------- Cảnh báo mất kết nối CSDL ---------------- */

  let bannerEl = null;
  GIS.setDbBanner = function (connected, detail) {
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.className = 'gis-db-banner';
      bannerEl.setAttribute('role', 'alert');
      const main = document.querySelector('.main') || document.body;
      main.insertBefore(bannerEl, main.firstChild);
    }
    if (connected) {
      bannerEl.classList.remove('show');
      return;
    }
    bannerEl.innerHTML = '<b>Mất kết nối cơ sở dữ liệu.</b> Dữ liệu tài sản, phiếu và bản đồ chưa được lưu hoặc tải.' +
      (detail ? ` <span class="gis-db-detail">(${GIS.esc(detail)})</span>` : '') +
      ' Hệ thống tự thử kết nối lại.';
    bannerEl.classList.add('show');
  };

  async function pollHealth() {
    try {
      const res = await fetch('/api/health');
      const json = await res.json();
      const db = json && json.data && json.data.db;
      GIS.setDbBanner(Boolean(db && db.connected), db && db.last_error);
    } catch (e) {
      GIS.setDbBanner(false, 'không gọi được máy chủ');
    }
  }
  GIS.pollHealth = pollHealth;

  /** WebSocket realtime gọi hàm này khi nhận gói { type: 'db_status' }. */
  GIS.onDbStatus = function (status) {
    GIS.setDbBanner(Boolean(status && status.connected), status && status.last_error);
  };

  /* ---------------- Nhà máy hiện tại ---------------- */

  let plantPromise = null;
  /** Nhà máy đầu tiên (tâm bản đồ). Trả null nếu chưa có. */
  GIS.getPlant = function (refresh) {
    if (!plantPromise || refresh) {
      plantPromise = GIS.api('GET', '/api/solar/plants')
        .then(r => r.data[0] || null)
        .catch(() => null);
    }
    return plantPromise;
  };

  /** Danh sách bản đồ nền đã tải lên. */
  GIS.getBaseMaps = function () {
    return GIS.api('GET', '/api/basemaps').then(r => r.data).catch(() => []);
  };

  /** Phát sự kiện nội bộ để các module cập nhật lại khi tài sản thay đổi. */
  GIS.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent('gis:' + name, { detail }));
  };
  GIS.on = function (name, fn) {
    document.addEventListener('gis:' + name, e => fn(e.detail));
  };

  document.addEventListener('DOMContentLoaded', () => {
    pollHealth();
    setInterval(pollHealth, 15000);
  });
})();
