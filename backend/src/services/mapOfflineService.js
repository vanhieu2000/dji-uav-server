/**
 * Quản lý chế độ Bản đồ Online / Offline và tự động đồng bộ Map Tiles
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const TILES_DIR = path.join(__dirname, '..', '..', 'tiles');
let isOnline = true;
let lastCheckTime = null;

// Kiểm tra kết nối Internet thực tế tới máy chủ DNS hoặc OSM
async function checkInternetConnectivity() {
    return new Promise((resolve) => {
        const req = https.get('https://tile.openstreetmap.org/0/0/0.png', { timeout: 3000 }, (res) => {
            res.resume();
            isOnline = (res.statusCode === 200 || res.statusCode === 304);
            lastCheckTime = new Date();
            resolve(isOnline);
        });
        req.on('error', () => {
            isOnline = false;
            lastCheckTime = new Date();
            resolve(false);
        });
        req.on('timeout', () => {
            req.destroy();
            isOnline = false;
            lastCheckTime = new Date();
            resolve(false);
        });
    });
}

// Lấy trạng thái bản đồ hiện tại
function getMapStatus() {
    return {
        scope:'server-osm-probe',
        affects_basemap:false,
        probe_url:'https://tile.openstreetmap.org/0/0/0.png',
        is_online: isOnline,
        mode: isOnline ? 'ONLINE' : 'OFFLINE',
        last_checked: lastCheckTime,
        offline_tile_count: countLocalTiles(TILES_DIR)
    };
}

// Đếm số lượng tile đã tải về cục bộ
function countLocalTiles(dir) {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    function scan(d) {
        const files = fs.readdirSync(d);
        for (const f of files) {
            const full = path.join(d, f);
            if (fs.statSync(full).isDirectory()) scan(full);
            else if (f.endsWith('.png') || f.endsWith('.jpg')) count++;
        }
    }
    try { scan(dir); } catch (e) {}
    return count;
}

// Khởi chạy tiến trình kiểm tra mạng định kỳ mỗi 60 giây
function startMapHealthCheck(broadcastFn) {
    checkInternetConnectivity().then(online => {
        console.log(`[Map Service] Trạng thái bản đồ ban đầu: ${online ? 'ONLINE (Đã có Internet)' : 'Server không truy cập được OSM; không đổi lớp bản đồ trình duyệt'}`);
    });

    setInterval(async () => {
        const prevStatus = isOnline;
        const currentStatus = await checkInternetConnectivity();
        if (prevStatus !== currentStatus) {
            console.log(`[Map Service] 🔄 Thay đổi mạng bản đồ: ${currentStatus ? 'Đã phục hồi ONLINE' : 'Server không truy cập được OSM; không tự đổi lớp nền'}`);
            if (broadcastFn) {
                broadcastFn({
                    type: 'map_mode_changed',
                    data: getMapStatus()
                });
            }
        }
    }, 60000);
}

module.exports = {
    checkInternetConnectivity,
    getMapStatus,
    startMapHealthCheck
};
