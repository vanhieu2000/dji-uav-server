/**
 * Giao tiếp API RESTful với DJI UAV Backend
 */
const API = {
  token: localStorage.getItem('uav_token') || '',

  setToken(t) {
    this.token = t;
    localStorage.setItem('uav_token', t);
  },

  clearToken() {
    this.token = '';
    localStorage.removeItem('uav_token');
  },

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...(options.headers || {})
    };

    try {
      const res = await fetch(endpoint, { ...options, headers });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      return { code: 500, message: err.message };
    }
  },

  // 1. Auth API
  auth: {
    login: (username, password) => API.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    me: () => API.request('/api/auth/me'),
    changePassword: (old_password, new_password) => API.request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password, new_password }) })
  },

  // 2. Solar Farm API (Khu vực pin, Chuỗi, Tấm pin)
  solar: {
    getPlants: () => API.request('/api/solar/plants'),
    getAreas: (plantId, q) => API.request(`/api/solar/areas?${new URLSearchParams({ ...(plantId ? { plant_id: plantId } : {}), ...(q ? { q } : {}) })}`),
    getStrings: (areaId, q) => API.request(`/api/solar/strings?${new URLSearchParams({ ...(areaId ? { area_id: areaId } : {}), ...(q ? { q } : {}) })}`),
    getPanels: (stringId, serial, limit = 200) => API.request(`/api/solar/panels?${new URLSearchParams({ ...(stringId ? { string_id: stringId } : {}), ...(serial ? { serial } : {}), limit })}`),
    saveArea: (data) => API.request('/api/solar/areas', { method: 'POST', body: JSON.stringify(data) }),
    saveString: (data) => API.request('/api/solar/strings', { method: 'POST', body: JSON.stringify(data) }),
    savePanel: (data) => API.request('/api/solar/panels', { method: 'POST', body: JSON.stringify(data) })
  },

  // 3. Trạm Biến Áp & Dao Cách Ly
  substation: {
    getSubstations: () => API.request('/api/substation'),
    getBays: (substationId) => API.request(`/api/substation/bays?${substationId ? 'substation_id=' + substationId : ''}`),
    getDisconnectors: (bayId, q) => API.request(`/api/substation/disconnectors?${new URLSearchParams({ ...(bayId ? { bay_id: bayId } : {}), ...(q ? { q } : {}) })}`),
    saveDisconnector: (data) => API.request('/api/substation/disconnectors', { method: 'POST', body: JSON.stringify(data) })
  },

  // 4. Phiếu Kiểm Tra
  tickets: {
    list: (type, status, q) => API.request(`/api/tickets?${new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) })}`),
    get: (id) => API.request(`/api/tickets/${id}`),
    create: (data) => API.request('/api/tickets', { method: 'POST', body: JSON.stringify(data) }),
    updateStatus: (id, status) => API.request(`/api/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },

  // 5. Cảnh Báo & AI
  ai: {
    getDetections: (ticketId) => API.request(`/api/ai/detections?${ticketId ? 'ticket_id=' + ticketId : ''}`),
    getAlerts: (status) => API.request(`/api/ai/alerts?status=${status || 'UNREAD'}`)
  },

  // 6. Báo Cáo
  reports: {
    getOverview: () => API.request('/api/reports/overview'),
    getDefectsByType: () => API.request('/api/reports/defects-by-type'),
    getTicketReport: (id) => API.request(`/api/reports/ticket/${id}`)
  },

  // 7. Bản đồ Map Status
  map: {
    getStatus: () => API.request('/api/map/status')
  }
};
