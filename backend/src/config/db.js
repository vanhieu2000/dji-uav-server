const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '123@123a',
    database: process.env.MYSQL_DATABASE || 'dji_uav_management',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

let pool = null;
let isConnected = false;

// Mock In-memory Storage khi MySQL chưa sẵn sàng
const mockDb = {
    plants: [
        { plant_id: 1, plant_code: 'NLMT-LN01', plant_name: 'Nhà Máy Điện Mặt Trời Lộc Ninh 1', capacity_mwp: 50.0, center_lat: 11.831200, center_lng: 106.591300, address: 'Huyện Lộc Ninh, Tỉnh Bình Phước' }
    ],
    substations: [
        { substation_id: 1, plant_id: 1, substation_code: 'TBA-110KV-LN', substation_name: 'Trạm Biến Áp 110kV Lộc Ninh', voltage_level: '110kV', center_lat: 11.832500, center_lng: 106.592500 }
    ],
    substation_bays: [
        { bay_id: 1, substation_id: 1, bay_code: 'NL-171', bay_name: 'Ngăn lộ 171 - Xuất tuyến đường dây 110kV', center_lat: 11.832600, center_lng: 106.592600 },
        { bay_id: 2, substation_id: 1, bay_code: 'NL-172', bay_name: 'Ngăn lộ 172 - Máy biến áp chính T1', center_lat: 11.832400, center_lng: 106.592400 }
    ],
    disconnectors: [
        { dcl_id: 1, bay_id: 1, dcl_code: '171-1', phase: 'A', dcl_name: 'Dao cách ly 171-1 Pha A', latitude: 11.832620, longitude: 106.592610, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 48.2, bay_name: 'Ngăn 171', voltage_level: '110kV' },
        { dcl_id: 2, bay_id: 1, dcl_code: '171-1', phase: 'B', dcl_name: 'Dao cách ly 171-1 Pha B', latitude: 11.832622, longitude: 106.592620, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 49.1, bay_name: 'Ngăn 171', voltage_level: '110kV' },
        { dcl_id: 3, bay_id: 1, dcl_code: '171-1', phase: 'C', dcl_name: 'Dao cách ly 171-1 Pha C', latitude: 11.832624, longitude: 106.592630, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 47.8, bay_name: 'Ngăn 171', voltage_level: '110kV' },
        { dcl_id: 4, bay_id: 1, dcl_code: '171-7', phase: 'A', dcl_name: 'Dao cách ly 171-7 Pha A (Cảnh báo quá nhiệt)', latitude: 11.832650, longitude: 106.592615, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 83.5, bay_name: 'Ngăn 171', voltage_level: '110kV' },
        { dcl_id: 5, bay_id: 1, dcl_code: '171-7', phase: 'B', dcl_name: 'Dao cách ly 171-7 Pha B', latitude: 11.832652, longitude: 106.592625, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 52.4, bay_name: 'Ngăn 171', voltage_level: '110kV' },
        { dcl_id: 6, bay_id: 1, dcl_code: '171-7', phase: 'C', dcl_name: 'Dao cách ly 171-7 Pha C', latitude: 11.832654, longitude: 106.592635, state: 'CLOSED', max_allowed_temp: 70.0, current_temp: 51.0, bay_name: 'Ngăn 171', voltage_level: '110kV' }
    ],
    solar_areas: [
        { area_id: 1, plant_id: 1, area_code: 'INV-01', area_name: 'Khu Vực Dãy Pin Inverter 01', center_lat: 11.830500, center_lng: 106.590500, total_capacity_kwp: 2500.0, panel_count: 672, string_count: 12, abnormal_count: 3 },
        { area_id: 2, plant_id: 1, area_code: 'INV-02', area_name: 'Khu Vực Dãy Pin Inverter 02', center_lat: 11.831500, center_lng: 106.590500, total_capacity_kwp: 2500.0, panel_count: 672, string_count: 12, abnormal_count: 1 }
    ],
    solar_strings: [
        { string_id: 1, area_id: 1, string_code: 'STR-01-01', string_name: 'Chuỗi Pin MPPT 1 - Kênh 1', inverter_channel: 'MPPT1-CH1', panel_count: 24, rated_power_w: 12000.0, area_name: 'Khu Vực Dãy Pin Inverter 01', area_code: 'INV-01' },
        { string_id: 2, area_id: 1, string_code: 'STR-01-02', string_name: 'Chuỗi Pin MPPT 1 - Kênh 2', inverter_channel: 'MPPT1-CH2', panel_count: 24, rated_power_w: 12000.0, area_name: 'Khu Vực Dãy Pin Inverter 01', area_code: 'INV-01' }
    ],
    solar_panels: [
        { panel_id: 1, string_id: 1, panel_serial: 'PANEL-LN-01-001', panel_index: 1, latitude: 11.830510, longitude: 106.590510, status: 'NORMAL', max_temperature: 38.5 },
        { panel_id: 2, string_id: 1, panel_serial: 'PANEL-LN-01-002', panel_index: 2, latitude: 11.830512, longitude: 106.590514, status: 'NORMAL', max_temperature: 39.1 },
        { panel_id: 3, string_id: 1, panel_serial: 'PANEL-LN-01-003', panel_index: 3, latitude: 11.830514, longitude: 106.590518, status: 'WARNING', max_temperature: 72.4 },
        { panel_id: 4, string_id: 1, panel_serial: 'PANEL-LN-01-004', panel_index: 4, latitude: 11.830516, longitude: 106.590522, status: 'NORMAL', max_temperature: 38.9 }
    ],
    uav_devices: [
        { device_sn: '1581F5FJC243K00DNRRT', device_name: 'DJI Mavic 3 Enterprise Thermal', device_model: 'Mavic 3T', device_type: 'DRONE', status: 'ONLINE', last_battery: 95 },
        { device_sn: '5YSZM3K0031EYQ', device_name: 'Tay Cầm Điều Khiển DJI RC Pro', device_model: 'DJI RC', device_type: 'REMOTE_CONTROLLER', status: 'ONLINE', last_battery: 62 }
    ],
    media_files: []
};

function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

async function testConnection() {
    try {
        const conn = await getPool().getConnection();
        isConnected = true;
        conn.release();
        console.log(`[Hệ Thống Dữ Liệu] ✓ Đã kết nối cơ sở dữ liệu giám sát thành công (${dbConfig.database} @ ${dbConfig.host}:${dbConfig.port})`);
        return true;
    } catch (err) {
        isConnected = false;
        console.warn(`[Hệ Thống Dữ Liệu] ⚠ Cơ sở dữ liệu đang ngoại tuyến (${err.code || err.message}).`);
        return false;
    }
}

async function query(sql, params = []) {
    if (isConnected) {
        try {
            const p = getPool();
            const [rows] = await p.execute(sql, params);
            return rows;
        } catch (err) {
            console.warn('[MySQL Query Error, falling back to mock]', err.message);
        }
    }

    // Fallback Mock Query Engine
    const sqlUpper = sql.trim().toUpperCase();
    if (sqlUpper.includes('FROM SOLAR_AREAS')) {
        return mockDb.solar_areas;
    }
    if (sqlUpper.includes('FROM DISCONNECTORS')) {
        return mockDb.disconnectors;
    }
    if (sqlUpper.includes('FROM SOLAR_STRINGS')) {
        return mockDb.solar_strings;
    }
    if (sqlUpper.includes('FROM SOLAR_PANELS')) {
        return mockDb.solar_panels;
    }
    if (sqlUpper.includes('FROM PLANTS')) {
        return mockDb.plants;
    }
    if (sqlUpper.includes('FROM SUBSTATIONS')) {
        return mockDb.substations;
    }
    if (sqlUpper.includes('FROM SUBSTATION_BAYS')) {
        return mockDb.substation_bays;
    }
    if (sqlUpper.includes('FROM UAV_DEVICES')) {
        return mockDb.uav_devices;
    }
    if (sqlUpper.includes('FROM MEDIA_FILES')) {
        return mockDb.media_files || [];
    }
    if (sqlUpper.startsWith('INSERT INTO MEDIA_FILES')) {
        const newMedia = {
            media_id: (mockDb.media_files || []).length + 1,
            ticket_id: params[0] || 1,
            device_sn: params[1] || 'Mavic 3T',
            file_name: params[2] || 'DJI_PHOTO.JPG',
            file_url: params[3] || '',
            file_path_local: params[4] || '',
            media_type: params[5] || 'RGB_PHOTO',
            latitude: params[6] || null,
            longitude: params[7] || null,
            max_temperature: params[8] || null,
            has_hotspot: params[9] || 0,
            captured_at: new Date()
        };
        if (!mockDb.media_files) mockDb.media_files = [];
        mockDb.media_files.unshift(newMedia);
        return { insertId: newMedia.media_id, affectedRows: 1 };
    }
    if (sqlUpper.startsWith('INSERT INTO SOLAR_AREAS')) {
        const newArea = {
            area_id: mockDb.solar_areas.length + 1,
            plant_id: params[0] || 1,
            area_code: params[1] || 'INV-NEW',
            area_name: params[2] || 'Dãy Pin Mới',
            center_lat: parseFloat(params[3]) || 11.8310,
            center_lng: parseFloat(params[4]) || 106.5910,
            total_capacity_kwp: parseFloat(params[5]) || 2000
        };
        mockDb.solar_areas.push(newArea);
        return { insertId: newArea.area_id, affectedRows: 1 };
    }
    if (sqlUpper.startsWith('INSERT INTO DISCONNECTORS')) {
        const newDcl = {
            dcl_id: mockDb.disconnectors.length + 1,
            bay_id: params[0] || 1,
            dcl_code: params[1] || '171-X',
            phase: params[2] || 'A',
            dcl_name: params[3] || 'Dao Cách Ly',
            latitude: parseFloat(params[4]) || 11.8326,
            longitude: parseFloat(params[5]) || 106.5926,
            state: params[6] || 'CLOSED',
            max_allowed_temp: parseFloat(params[7]) || 70.0,
            current_temp: 45.0,
            bay_name: 'Ngăn 171'
        };
        mockDb.disconnectors.push(newDcl);
        return { insertId: newDcl.dcl_id, affectedRows: 1 };
    }
    if (sqlUpper.startsWith('DELETE FROM SOLAR_AREAS')) {
        const id = params[0];
        mockDb.solar_areas = mockDb.solar_areas.filter(a => a.area_id != id && a.area_code != id);
        return { affectedRows: 1 };
    }
    if (sqlUpper.startsWith('DELETE FROM DISCONNECTORS')) {
        const id = params[0];
        mockDb.disconnectors = mockDb.disconnectors.filter(d => d.dcl_id != id && d.dcl_code != id);
        return { affectedRows: 1 };
    }
    if (sqlUpper.startsWith('INSERT INTO UAV_DEVICES')) {
        const existing = mockDb.uav_devices.find(u => u.device_sn === params[0]);
        if (existing) {
            existing.device_name = params[1] || existing.device_name;
            existing.device_model = params[2] || existing.device_model;
            existing.device_type = params[3] || existing.device_type;
        } else {
            mockDb.uav_devices.push({
                device_sn: params[0],
                device_name: params[1],
                device_model: params[2] || 'Mavic 3T',
                device_type: params[3] || 'DRONE',
                status: 'OFFLINE',
                last_battery: 100
            });
        }
        return { affectedRows: 1 };
    }
    if (sqlUpper.startsWith('UPDATE UAV_DEVICES')) {
        const sn = params[3];
        const dev = mockDb.uav_devices.find(u => u.device_sn === sn);
        if (dev) {
            dev.device_name = params[0] || dev.device_name;
            dev.device_model = params[1] || dev.device_model;
            dev.device_type = params[2] || dev.device_type;
        }
        return { affectedRows: 1 };
    }
    if (sqlUpper.startsWith('DELETE FROM UAV_DEVICES')) {
        const sn = params[0];
        mockDb.uav_devices = mockDb.uav_devices.filter(u => u.device_sn != sn);
        return { affectedRows: 1 };
    }

    return [];
}

module.exports = {
    getPool,
    testConnection,
    query,
    isDbConnected: () => isConnected,
    mockDb
};
