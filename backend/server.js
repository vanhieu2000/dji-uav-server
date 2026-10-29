/**
 * ===================================================================
 * DJI CLOUD API SERVER FOR MAVIC 3T - ALL-IN-ONE SYSTEM
 * Hệ thống giám sát UAV & Kiểm tra Pin Mặt Trời / Dao Cách Ly
 * ===================================================================
 */

const path = require('path');

// Nạp cấu hình máy local; giữ nguyên biến môi trường đã được thiết lập.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (e) {
  // Không có file .env: dùng biến môi trường của hệ thống
}

require('./src/services/runtimeEnv').load();
const diagnostics=require('./src/services/diagnostics');diagnostics.install();
const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const mqtt = require('mqtt');
const aedes = require('aedes');
const net = require('net');
const os = require('os');
const NodeMediaServer = require('node-media-server');
const AdmZip = require('adm-zip');

// Database và các module định tuyến chuẩn hóa
const { testConnection, query, isDbConnected, getStatus: getDbStatus, onStatusChange: onDbStatusChange, dbConfig, sendDbError } = require('./src/config/db');
const { runMigrations } = require('./src/db/migrate');
const { authRouter, verifyLogin, issuePilotToken, userForToken, tokenOf, loginLimit } = require('./src/routes/auth');
const assetsRouter = require('./src/routes/assets');
const basemapsRouter = require('./src/routes/basemaps');
const { listActiveTickets, findTicketById } = require('./src/services/ticketService');
const mediaIngest = require('./src/services/mediaIngest');
const { createTracker } = require('./src/services/flightTracker');
const { createMonitoring } = require('./src/services/liveMonitoring');
const mediaUploadRouter = require('./src/routes/mediaUpload');
const routeLibrary = require('./src/services/routeLibrary');
const wpmlBuilder = require('./src/services/wpmlBuilder');
const solarRouter = require('./src/routes/solar');
const substationRouter = require('./src/routes/substation');
const ticketsRouter = require('./src/routes/tickets');
const aiRouter = require('./src/routes/ai_bridge');
const reportsRouter = require('./src/routes/reports');
const { startMapHealthCheck, getMapStatus } = require('./src/services/mapOfflineService');
const { parseDjiThermalJpeg, getPixelTemperature } = require('./src/services/thermalParser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({server,path:'/ws',verifyClient:(info,done)=>{
  const req=info.req,origin=req.headers.origin;
  try{if(origin&&new URL(origin).host!==req.headers.host)return done(false,403);}catch(e){return done(false,403);}
  userForToken(tokenOf(req)).then(user=>{if(!user||user.must_change_password)return done(false,401);req.user=user;done(true);}).catch(()=>done(false,503));
}});
wss.on('connection',(socket,req)=>{socket.user=req.user;socket.authToken=tokenOf(req);});
authRouter.setOnRevoked(({user_id,session_id})=>{require('./src/services/streamAccess').revoke({user_id,session_id});require('./src/services/mqttAccess').revoke({user_id,session_id});for(const c of wss.clients)if(c.user?.user_id===user_id&&(!session_id||c.user.session_id===session_id))c.close(1008,'Phiên đã thu hồi');});

// Nạp cấu hình hệ thống động từ config.json
const CONFIG_PATH = path.join(__dirname, 'config.json');
let systemConfig = {
  host_ip: process.env.HOST_IP || 'auto',
  port: 8080,
  mqtt_port: 1883,
  rtmp_port: 1935,
  workspace_name: 'Dự Án Điện Mặt Trời & TBA 110kV',
  workspace_id: 'e3dea0f5-37f2-4d79-ae58-490af3228069',
  // Khóa DJI không ghi cứng: lấy từ biến môi trường hoặc config.json (không đưa lên git)
  dji_license: {
    appId: process.env.DJI_APP_ID || '',
    appKey: process.env.DJI_APP_KEY || '',
    appLicense: process.env.DJI_APP_LICENSE || ''
  },
  flight_settings: {
    rth_height: 50,
    gimbal_pitch_solar: -90,
    gimbal_pitch_dcl: 0
  },
  map_settings: {
    source: 'online',
    offline_url: '/offline-tiles/{z}/{x}/{y}.png'
  }
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    systemConfig = { ...systemConfig, ...JSON.parse(raw) };
  }
} catch (e) {
  console.error('[Config] Lỗi đọc config.json:', e.message);
}

// Biến môi trường DJI_* (nếu có) được ưu tiên hơn config.json
systemConfig.dji_license = {
  ...(systemConfig.dji_license || {}),
  ...(process.env.DJI_APP_ID ? { appId: process.env.DJI_APP_ID } : {}),
  ...(process.env.DJI_APP_KEY ? { appKey: process.env.DJI_APP_KEY } : {}),
  ...(process.env.DJI_APP_LICENSE ? { appLicense: process.env.DJI_APP_LICENSE } : {})
};
if (!systemConfig.dji_license.appKey || !systemConfig.dji_license.appLicense) {
  console.warn('[Config] Chưa cấu hình khóa DJI (DJI_APP_ID / DJI_APP_KEY / DJI_APP_LICENSE hoặc config.json).');
}

// Explicit host for production; auto resolves an actual LAN interface, never an invented IP.
const PORT = Number(process.env.PORT || systemConfig.port || 8080);
const MQTT_PORT = Number(process.env.MQTT_PORT || systemConfig.mqtt_port || 1883);
const configuredHost=process.env.HOST_IP||systemConfig.host_ip||'auto';
const HOST_IP=configuredHost==='auto'?require('./src/services/localNetwork').resolveHost({configured:'auto'}):configuredHost;

app.use(require('./src/middleware/transportSecurity').securityHeaders);
app.use(diagnostics.http);
app.use(require('./src/middleware/transportSecurity').originPolicy);
app.use(require('./src/middleware/transportSecurity').rateLimit);
const isNativeStorage = (process.env.STORAGE_MODE || '').replace(/['"]/g, '').trim() === 'local' || !process.env.S3_STS_ENDPOINT;
if(isNativeStorage){require('./src/services/objectStorage').setLocalEndpoint(`http://${HOST_IP}:${PORT}`);app.use(require('./src/services/localObjectStorage').router());}
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.use(require('./src/middleware/accessControl').audit);
app.use(require('./src/middleware/accessControl').accessControl);
app.use('/api/open/v1',require('./src/routes/openApi'));
app.get('/openapi.json',(req,res)=>res.sendFile(path.join(__dirname,'public','openapi.json')));
app.use('/api/workspace',require('./src/routes/workspace'));
const administrationRouter=require('./src/routes/administration');
administrationRouter.setOnUserChanged(id=>{require('./src/services/streamAccess').revoke({user_id:id});require('./src/services/mqttAccess').revoke({user_id:id});for(const c of wss.clients)if(c.user?.user_id===id)c.close(1008,'Quyền tài khoản đã thay đổi');});
app.use('/api/admin',administrationRouter);

// Chặn favicon.ico ngay lập tức tránh nghẽn server
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Middleware ghi log chi tiết mọi HTTP request từ Pilot 2 (bỏ qua static files & favicon)
app.use((req, res, next) => {
  if (!req.url.startsWith('/dashboard') && !req.url.startsWith('/pilot-login') && !req.url.startsWith('/uploads') && !req.url.includes('favicon.ico') && !req.url.endsWith('.png') && !req.url.endsWith('.js') && !req.url.endsWith('.css')) {
    console.log(`[Pilot 2 HTTP] ${req.method} ${req.path}`);
  }
  next();
});

app.use(mediaUploadRouter);
mediaUploadRouter.setOnIngested((media) => {
  memoryStore.mediaFiles.unshift(media);
  console.log(`[Ảnh Đồng Bộ] ✓ Đã nhận và nạp ảnh từ DJI Pilot 2: ${media.file_name}`);
  broadcastWebSocket({ type: 'media_synced', data: media });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Đăng ký các API Routers phục vụ Hệ Thống Quản Trị
app.use('/api/auth', authRouter);
app.use('/api/solar', solarRouter);
app.use('/api/substation', substationRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/teams', require('./src/routes/teams'));
app.use('/api/ai', aiRouter);
const visionRouter = require('./src/routes/vision');
visionRouter.setOnResult(broadcastWebSocket);
app.use('/api/vision', visionRouter);
app.use('/api/reports', reportsRouter);
const insightsRouter=require('./src/routes/insights');
insightsRouter.setOnChanged(broadcastWebSocket);
app.use('/api/insights',insightsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/basemaps', basemapsRouter);
app.use('/api/capture-profiles', require('./src/routes/captureProfiles'));
app.use('/api/flight-plans', require('./src/routes/flightPlans'));
app.use('/api/coverage', require('./src/routes/coverage'));
app.use('/api/flights', require('./src/routes/flights'));
app.use('/api/datasets', require('./src/routes/datasets'));

// Tình trạng hệ thống: dashboard dùng để hiện cảnh báo mất CSDL
app.get('/api/health', (req, res) => {
  res.status(isDbConnected()&&dbInitDone?200:503).json({
    code: isDbConnected()&&dbInitDone?0:503,
    data: {
      db: req.user?.role==='ADMIN'?getDbStatus():{connected:isDbConnected()},
      mqtt: { connected: Boolean(mqttClient && mqttClient.connected) },
      ...(process.env.LOCAL_LAUNCH_ID&&process.env.NODE_ENV!=='production'?{local_instance_id:process.env.LOCAL_LAUNCH_ID}:{}),
      uptime_s: Math.round(process.uptime())
    }
  });
});

// Trạng thái bản đồ Online / Offline
app.get('/api/map/status', (req, res) => {
  res.json({ code: 0, data: getMapStatus() });
});

app.post('/api/diagnostics/client',(req,res)=>{
 const rows=Array.isArray(req.body?.events)?req.body.events.slice(0,10):[];
 for(const event of rows){const record={user_id:req.user.user_id};for(const key of ['kind','view','action','message'])if(typeof event[key]==='string')record[key]=event[key].slice(0,500);diagnostics.write('browser',record);}
 res.json({code:0,data:{received:rows.length}});
});
app.get('/api/diagnostics/export',async(req,res)=>{
 if(req.user.role!=='ADMIN')return res.status(403).json({code:403,message:'Chỉ admin được xuất log toàn hệ thống'});
 try{const bytes=await diagnostics.bundle();res.set({'Content-Type':'application/zip','Content-Disposition':'attachment; filename="uav-diagnostics-'+new Date().toISOString().slice(0,10)+'.zip"','Cache-Control':'no-store'});res.send(bytes);}catch{res.status(503).json({code:503,message:'Không xuất được log trên máy chủ'});}
});

// Lấy danh sách gói tin MQTT thô và xóa nhật ký cho Live Debug Console
app.get('/api/mqtt/logs', (req, res) => {
  res.json({ code: 0, logs: memoryStore.rawMqttLogs || [] });
});
app.delete('/api/mqtt/logs', (req, res) => {
  memoryStore.rawMqttLogs = [];
  res.json({ code: 0, message: 'Đã xóa nhật ký console MQTT' });
});

// Thư mục static cho Pilot 2 và Dashboard
app.use('/pilot-login', express.static(path.join(__dirname, 'public', 'pilot-login')));
app.use('/m',express.static(path.join(__dirname,'public','mobile')));
app.use('/dashboard', express.static(path.join(__dirname, 'public', 'dashboard')));
// Bản đồ nền nhà máy (thư mục có thể đổi bằng BASEMAP_TILES_DIR)
app.use('/tiles/basemaps', express.static(basemapsRouter.TILES_ROOT, { fallthrough: true }));
app.use('/tiles', express.static(path.join(__dirname, 'tiles')));

// Bộ sinh ô lưới bản đồ kỹ thuật ngoại tuyến tự động (Dynamic Tactical Grid Tile Engine)
// Không bao giờ để bản đồ bị 404 hay đen màn hình khi thiết bị chạy ngoại tuyến trong Wi-Fi nội bộ
app.get('/tiles/:z/:x/:y.png', (req, res) => {
  const { z, x, y } = req.params;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#0d1527"/>
    <defs>
      <pattern id="smallGrid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(56, 189, 248, 0.08)" stroke-width="0.8"/>
      </pattern>
      <pattern id="grid" width="128" height="128" patternUnits="userSpaceOnUse">
        <rect width="128" height="128" fill="url(#smallGrid)"/>
        <path d="M 128 0 L 0 0 0 128" fill="none" stroke="rgba(56, 189, 248, 0.22)" stroke-width="1.2"/>
      </pattern>
    </defs>
    <rect width="256" height="256" fill="url(#grid)" />
    <!-- Tọa độ và thước tâm đo đạc -->
    <circle cx="128" cy="128" r="3" fill="rgba(0, 242, 254, 0.5)"/>
    <line x1="118" y1="128" x2="138" y2="128" stroke="rgba(0, 242, 254, 0.4)" stroke-width="1"/>
    <line x1="128" y1="118" x2="128" y2="138" stroke="rgba(0, 242, 254, 0.4)" stroke-width="1"/>
    <rect x="1" y="1" width="254" height="254" fill="none" stroke="rgba(56, 189, 248, 0.16)" stroke-width="1" stroke-dasharray="4 4"/>
    <text x="8" y="246" fill="rgba(148, 163, 184, 0.5)" font-family="Consolas, monospace" font-size="9.5" font-weight="bold">Z:${z} [${x}, ${y}]</text>
  </svg>`;
  res.set({
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*'
  });
  res.send(svg);
});

app.use('/uploads/waylines',express.static(routeLibrary.WAYLINE_DIR));
app.use('/uploads/media',express.static(mediaUploadRouter.MEDIA_DIR));
app.use('/uploads', (req, res, next) => {
  if (req.path.endsWith('.kmz')) {
    res.set('Content-Type', 'application/vnd.google-earth.kmz');
    res.set('Content-Disposition', `attachment; filename="${path.basename(req.path)}"`);
    res.set('Accept-Ranges', 'bytes');
  }
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Cấu hình Multer lưu file đường bay và ảnh
const waylineStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', 'waylines');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const uploadWayline = multer({ storage: waylineStorage });

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = mediaUploadRouter.MEDIA_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = 'DJI_' + Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const uploadMedia = multer({ storage: mediaStorage });

// ===================================================================
// DỮ LIỆU HỆ THỐNG - KHÔNG SỬ DỤNG DỮ LIỆU TỌA ĐỘ ẢO
// Chờ 100% thiết bị thực kết nối
// ===================================================================
const memoryStore = {
  // KHÔNG CÓ TỌA ĐỘ ẢO: Chờ thiết bị thật phát dữ liệu OSD
  devices: {},
  // Trạng thái tay cầm điều khiển Pilot 2 thật
  gateways: {},
  // Phiếu kiểm tra: KHÔNG giữ trong bộ nhớ, luôn đọc từ MySQL (ticketService)
  // Đường bay: thư viện trong MySQL (src/services/routeLibrary.js), không giữ trong bộ nhớ
  // Kho ảnh chụp thật được đồng bộ về
  mediaFiles: [],
  // Nhật ký gói tin thô để soi console trên Web
  rawMqttLogs: []
};

const monitoring = createMonitoring({ query, onEvent: broadcastWebSocket, playbackBase: process.env.MEDIA_HTTP_BASE_URL || `http://${HOST_IP}:${process.env.MEDIA_HTTP_PORT||8000}` });
app.use('/api/monitoring', require('./src/routes/monitoring').createRouter({ monitoring, getLiveDevices: () => memoryStore.devices }));

// ===================================================================
// KHỞI ĐỘNG MQTT BROKER & CLIENT
// ===================================================================
let mqttClient = null;

function setupMqtt() {
  const externalMqttUrl = process.env.MQTT_BROKER_URL;

  if (externalMqttUrl) {
    console.log('[MQTT] Đang kết nối broker ngoài (cấu hình ACL tại broker)');
    if(!process.env.MQTT_USERNAME||!process.env.MQTT_PASSWORD)throw new Error('Broker ngoài cần MQTT_USERNAME/MQTT_PASSWORD và ACL tương ứng');
    mqttClient = mqtt.connect(externalMqttUrl,{username:process.env.MQTT_USERNAME,password:process.env.MQTT_PASSWORD});
    registerMqttEvents(mqttClient);
  } else {
    // Tự động khởi động Embedded Aedes Broker trên Wi-Fi
    console.log(`[MQTT] Đang khởi tạo Embedded MQTT Broker trên port ${MQTT_PORT}...`);
    const broker = aedes({maxClientsIdLength:128,concurrency:100});
    const internal=require('./src/services/mqttAccess').configure(broker);
    const tcpServer = net.createServer(broker.handle);
    tcpServer.on('connection',socket=>console.log('[MQTT TCP] Nhận kết nối từ '+socket.remoteAddress+' (chưa đồng nghĩa xác thực thành công)'));

    tcpServer.listen(MQTT_PORT, '0.0.0.0', () => {
      console.log(`[MQTT] ✓ Embedded MQTT Broker đang lắng nghe trên 0.0.0.0:${MQTT_PORT}`);
      mqttClient = mqtt.connect(`mqtt://127.0.0.1:${MQTT_PORT}`,internal);
      registerMqttEvents(mqttClient);
    });

    broker.on('client', (client) => {
      console.log(`[MQTT Broker] Remote/UAV vừa kết nối: ClientID = ${client.id}`);
      broadcastWebSocket({
        type: 'client_connected',
        clientId: client.id,
        timestamp: new Date().toLocaleTimeString()
      });
    });

    broker.on('clientDisconnect', (client) => {
      console.log(`[MQTT Broker] Remote/UAV ngắt kết nối: ClientID = ${client.id}`);
    });

    broker.on('clientError', (client, err) => {
      console.warn(`[MQTT Broker] Client lỗi (${client?.id}):`, err?.message || err);
    });

    broker.on('connectionError', (client, err) => {
      console.warn(`[MQTT Broker] Connection lỗi (${client?.id}):`, err?.message || err);
    });
  }
}

// ===================================================================
// KHỞI ĐỘNG RTMP SERVER (1935) & HTTP-FLV STREAMING CHO WEB (8000)
// ===================================================================
let nmsServer = null;

function setupRtmpServer() {
  if(process.env.LIVE_STREAM_ENABLED!=='true'){console.log('[Live] Tắt cho tới khi cấu hình transport/ACL');return;}
  const streamAccess=require('./src/services/streamAccess');
  const rtmpPort = Number(process.env.RTMP_PORT || systemConfig.rtmp_port || 1935);
  const nmsConfig = {
    store: { path: process.env.LIVE_STATE_DIR || path.join(__dirname, 'data', 'live-state') },
    auth: { play:true,publish:true,secret:streamAccess.secret },
    webadmin: { enable: false },
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: Number(process.env.MEDIA_HTTP_PORT || 8000),
      allow_origin: '*',
      mediaroot: path.join(__dirname, 'uploads/media')
    },
    logType: 1
  };

  try {
    nmsServer = new NodeMediaServer(nmsConfig);

    nmsServer.on('prePublish',session=>streamAccess.allow(session,'publish'));
    nmsServer.on('prePlay',session=>streamAccess.allow(session,'play'));
    nmsServer.on('donePlay',session=>streamAccess.release(session));
    nmsServer.on('postPublish', async (session, streamPath) => {
      const sp = typeof session === 'string' ? session : (streamPath || session?.streamPath || session?.publishStreamPath || '');
      console.log(`[RTMP Server] ✓ Nhận luồng video từ thiết bị: ${sp}`);
      const channel = String(sp).split('/').pop();
      const streamInfo = {
        type: 'stream_started',
        stream_path: sp,
        channel,
        started_at: new Date().toISOString()
      };
      broadcastWebSocket(streamInfo);
      monitoring.publisherEvent('start', session, sp).catch(() => {});
    });

    nmsServer.on('donePublish', (session, streamPath) => {
      const sp = typeof session === 'string' ? session : (streamPath || session?.streamPath || session?.publishStreamPath || '');
      console.log(`[RTMP Server] Luồng video đã kết thúc: ${sp}`);
      broadcastWebSocket({ type: 'stream_stopped', stream_path: sp, streamPath: sp });
      monitoring.publisherEvent('stop', session, sp).catch(() => {});
      if(session&&typeof session==='object')streamAccess.release(session);
    });

    nmsServer.run();
    console.log(`[RTMP Server] ✓ RTMP Server đã mở cổng tcp://0.0.0.0:${rtmpPort}`);
    console.log(`[RTMP Server] ✓ HTTP-FLV cho Web: http://${HOST_IP}:8000/live/<kênh>.flv`);
  } catch (err) {
    nmsServer=null;console.error('[RTMP Server] Lỗi khởi động:', err.message);
  }
}

// Theo dõi chuyến bay: cất/hạ cánh, telemetry ≤ 1 lần/giây, OFFLINE sau 30 s (src/services/flightTracker.js)
const flightTracker = createTracker({
  query,
  findSession: sn => mediaIngest.activeSession(sn).catch(() => null),
  onEvent: ev => {
    if (ev.type === 'device_offline' && memoryStore.devices[ev.device_sn]) memoryStore.devices[ev.device_sn].status = 'OFFLINE';
    if (ev.type === 'flight_started' || ev.type === 'flight_ended') {
      console.log(`[Chuyến bay] ${ev.type === 'flight_started' ? 'Cất cánh' : 'Kết thúc (' + ev.reason + ')'} – ${ev.device_sn} #${ev.flight_session_id}`);
    }
    broadcastWebSocket({ ...ev, type: ev.type === 'device_online' || ev.type === 'device_offline' ? 'device_status' : ev.type, status: ev.type === 'device_offline' ? 'OFFLINE' : (ev.type === 'device_online' ? 'ONLINE' : undefined) });
  }
});
const gatewayOfAircraft = {}; // SN máy bay -> SN tay điều khiển (từ gói topo)
const FLIGHT_SWEEP_MS = 3000;
const MEDIA_ATTACH_MS = 60000;
setInterval(() => {
  if (isDbConnected()) {
    flightTracker.sweep().catch(err => console.warn('[Chuyến bay] sweep:', err.message));
  }
  // Watchdog kiểm tra cả memoryStore để kịp thời báo OFFLINE tới WebSocket
  const now = Date.now();
  for (const [sn, dev] of Object.entries(memoryStore.devices)) {
    if (dev.status !== 'OFFLINE' && dev.last_seen && (now - new Date(dev.last_seen).getTime() > 30000)) {
      dev.status = 'OFFLINE';
      if (isDbConnected()) {
        query("UPDATE uav_devices SET status = 'OFFLINE' WHERE device_sn = ?", [sn]).catch(() => {});
      }
      broadcastWebSocket({
        type: 'device_status',
        device_sn: sn,
        status: 'OFFLINE'
      });
      console.log(`[Watchdog] Drone ${sn} không gửi tin quá 30s -> Đã chuyển OFFLINE`);
    }
  }
  for (const [sn, gw] of Object.entries(memoryStore.gateways)) {
    if (gw.status !== 'OFFLINE' && gw.last_seen && (now - new Date(gw.last_seen).getTime() > 30000)) {
      gw.status = 'OFFLINE';gw.is_cloud_control_auth=false;
      broadcastWebSocket({
        type: 'rc_status',
        gateway_sn: sn,
        status: 'OFFLINE'
      });
      console.log(`[Watchdog] Tay Cầm RC ${sn} không gửi tin quá 30s -> Đã chuyển OFFLINE`);
    }
  }
}, FLIGHT_SWEEP_MS).unref();
setInterval(() => {
  if (isDbConnected() && dbInitDone) flightTracker.attachMedia().catch(err => console.warn('[Chuyến bay] gắn ảnh:', err.message));
}, MEDIA_ATTACH_MS).unref();

// saveMediaToDb (cũ, gán cứng phiếu 1 và tự tạo cảnh báo 65 °C) đã thay bằng src/services/mediaIngest.js

// Khởi tạo và đồng bộ kho ảnh từ Database và thư mục đĩa cục bộ
async function initMediaLibraryFromDbAndDisk() {
  const uploadDir = mediaUploadRouter.MEDIA_DIR;
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // 1. Nạp toàn bộ ảnh từ bảng media_files trong Database
  try {
    const rows = await query('SELECT * FROM media_files ORDER BY captured_at DESC, media_id DESC');
    if (rows && rows.length) {
      memoryStore.mediaFiles = rows.map(r => ({
        ...r,
        file_path_local: r.file_path_local || path.join(uploadDir, r.file_name)
      }));
      console.log(`[Hệ Thống Dữ Liệu] ✓ Đã nạp ${rows.length} ảnh kiểm tra từ Database.`);
    }
  } catch (err) {
    console.warn('[DB Media Init]', err.message);
  }

  // 2. File ảnh có trên ổ đĩa nhưng chưa có trong DB: nhận vào bằng service chung
  //    (đọc vị trí / RTK / nhiệt độ thật trong ảnh; không gán phiếu, tọa độ hay nhiệt độ giả)
  try {
    const known = new Set(memoryStore.mediaFiles.map(m => m.file_name));
    const diskFiles = fs.readdirSync(uploadDir).filter(f => /\.(jpe?g)$/i.test(f) && !known.has(f));
    for (const f of diskFiles) {
      const r = await mediaIngest.ingestFile({ localPath: path.join(uploadDir, f), fileName: f, originalName: f, source: 'DISK_SCAN' });
      if (r.status === 'created') memoryStore.mediaFiles.push(r.media);
    }
    if (diskFiles.length) console.log(`[Ảnh] Đã quét ${diskFiles.length} file ảnh chưa có trong CSDL.`);
  } catch (err) {
    console.warn('[Disk Media Scan]', err.message);
  }
}

function registerMqttEvents(client) {
  client.on('connect', () => {
    console.log('[MQTT Client] ✓ Đã kết nối MQTT Broker thành công');
    // Lắng nghe toàn diện tất cả topic của DJI Cloud API bằng Wildcard
    const topics = [
      'thing/product/#',              // Toàn bộ OSD, State, Services, Requests, Events của UAV & RC
      'sys/product/#'                 // Toàn bộ Status, Topo Handshake của Gateway RC
    ];
    topics.forEach(t => client.subscribe(t));
    console.log('[MQTT Client] ✓ Đã subscribe Wildcard DJI Cloud API topics:', topics.join(', '));
  });

  client.on('message', (topic, payload) => {
    try {
      const payloadStr = payload.toString();
      let data = {};
      try { data = JSON.parse(payloadStr); } catch (e) { data = { raw: payloadStr }; }

      // 1. Lưu và phát gói tin thô để Web soi trực tiếp (Live Packet Inspector)
      const logItem = {
        topic: topic,
        data: require('./src/middleware/transportSecurity').redact(data),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now()
      };
      memoryStore.rawMqttLogs.unshift(logItem);
      if (memoryStore.rawMqttLogs.length > 100) memoryStore.rawMqttLogs.pop();

      broadcastWebSocket({
        type: 'raw_mqtt',
        log: logItem
      });

      diagnostics.mqtt(topic,data);
      // 2. Phân loại và xử lý từng topic thực tế
      handleDjiMqttMessage(topic, data).catch(e=>console.warn('[MQTT] Không xử lý được gói tin:',e.code||e.name));
    } catch (e) {
      console.error(`[MQTT] Lỗi xử lý topic ${topic}:`, e.message);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT Client Error]:', err.message);
  });
}

const deviceCommands=require('./src/services/deviceCommands').createCommands({getClient:()=>mqttClient});
const stateTimestamps=new Map();
async function handleDjiMqttMessage(topic, json) {
  const parts = topic.split('/');
  const sn = parts[2];

  // 1. Xử lý OSD (Dữ liệu bay thực tế từ Mavic 3T hoặc Tay Cầm RC)
  if (topic.endsWith('/osd')) {
    const d = json.data || json;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    const previous = memoryStore.devices[sn];
    if (Number.isSafeInteger(json.timestamp) && previous && previous.source_timestamp != null && json.timestamp < previous.source_timestamp) return;
    
    // Phân biệt chính xác giữa Tay Cầm RC (Gateway) và Máy Bay Mavic 3T (UAV)
    const isRcGateway = require('./src/services/telemetryIdentity').isGatewayOsd(sn,d,memoryStore.devices,memoryStore.gateways);

    if (isRcGateway) {
      // ĐÂY LÀ TAY CẦM RC (PILOT 2 GATEWAY)
      const rcInfo = {
        gateway_sn: sn,
        battery: d.capacity_percent !== undefined ? d.capacity_percent : null,
        app_version: d.app_version || '',
        wireless_link: d.wireless_link || {},
        status: 'ONLINE',
        last_seen: new Date()
      };
      memoryStore.gateways[sn] = { ...(memoryStore.gateways[sn] || {}), ...rcInfo };

      // Chỉ phát sự kiện riêng cho RC, KHÔNG ghi đè lên Telemetry máy bay
      broadcastWebSocket({
        type: 'rc_osd',
        gateway_sn: sn,
        data: rcInfo
      });
      return;
    }

    // ĐÂY LÀ MÁY BAY MAVIC 3T THẬT (UAV AIRCRAFT)
    const dev = memoryStore.devices[sn] || {
      device_sn: sn,
      device_name: `DJI Mavic 3T (${sn})`,
      model: 'Mavic 3T',
      first_seen: new Date()
    };

    if (d.latitude !== undefined) dev.lat = d.latitude;
    if (d.longitude !== undefined) dev.lng = d.longitude;
    if (d.height !== undefined) dev.alt = d.height;
    if (d.elevation !== undefined) dev.rel_alt = d.elevation;
    else if (d.relative_height !== undefined) dev.rel_alt = d.relative_height;

    // Trích xuất chính xác Pin máy bay Mavic 3T
    if (typeof d.battery === 'number') {
      dev.battery = d.battery;
    } else if (d.battery?.capacity_percent !== undefined) {
      dev.battery = d.battery.capacity_percent;
    } else if (d.battery?.batteries?.[0]?.capacity_percent !== undefined) {
      dev.battery = d.battery.batteries[0].capacity_percent;
    } else if (d.battery?.remain_flight_percent !== undefined) {
      dev.battery = d.battery.remain_flight_percent;
    } else if (d.battery_percent !== undefined) {
      dev.battery = d.battery_percent;
    }

    dev.speed = d.horizontal_speed !== undefined ? d.horizontal_speed : (dev.speed || 0);
    dev.yaw = d.attitude_head ?? d.attitude_yaw ?? d.yaw ?? dev.yaw ?? null;
    dev.pitch = d.attitude_pitch !== undefined ? d.attitude_pitch : (dev.pitch || 0);
    dev.roll = d.attitude_roll !== undefined ? d.attitude_roll : (dev.roll || 0);
    dev.satellites = d.position_state?.gps_number ?? d.satellites ?? dev.satellites ?? null;
    if (d.position_state?.is_fixed !== undefined) dev.is_fixed = d.position_state.is_fixed;
    if (d.mode_code !== undefined) dev.mode_code = d.mode_code;
    dev.gateway_sn = gatewayOfAircraft[sn] || dev.gateway_sn || null;
    if (Number.isSafeInteger(json.timestamp)) dev.source_timestamp = json.timestamp;
    dev.status = 'ONLINE';
    dev.last_seen = new Date();dev.last_osd_at=dev.last_seen;

    // Trích xuất thông số Camera Nhiệt Hồng Ngoại (Payload 67-0-0 của Mavic 3T)
    const payloadCam = d['67-0-0'] || {};
    if(payloadCam.gimbal_pitch!==undefined||d.gimbal_pitch!==undefined)dev.gimbal_pitch=payloadCam.gimbal_pitch??d.gimbal_pitch;
    if(payloadCam.gimbal_yaw!==undefined||d.gimbal_yaw!==undefined)dev.gimbal_yaw=payloadCam.gimbal_yaw??d.gimbal_yaw;
    if (payloadCam.thermal_global_temperature_max !== undefined) {
      dev.thermal_max = Math.round(payloadCam.thermal_global_temperature_max * 10) / 10;
      dev.thermal_min = Math.round((payloadCam.thermal_global_temperature_min || 0) * 10) / 10;

    }

    memoryStore.devices[sn] = dev;

    // Chuyến bay + telemetry vào MySQL (chạy nền, không chặn luồng realtime)
    if (isDbConnected() && dbInitDone) {
      flightTracker.onOsd(sn, { ...dev }).then(r => {
        dev.flight_session_id = r.flight_session_id;
        dev.airborne = r.airborne;
        dev.rtk_state = r.rtk;
        const st = flightTracker.snapshot().find(x => x.device_sn === sn);
        dev.ticket_id = st ? st.ticket_id : null;
        broadcastWebSocket({ type: 'osd', device_sn: sn, data: { ...dev } });
      }).catch(err => console.warn('[Chuyến bay] OSD:', err.message));
    }

    // Phát OSD chuẩn DUY NHẤT từ Máy Bay Mavic 3T tới Dashboard
    broadcastWebSocket({
      type: 'osd',
      device_sn: sn,
      data: dev
    });
  } 
  // 2. Trạng thái Remote Gateway & Cấu trúc Thiết bị (Topology)
  else if (topic.startsWith('sys/product/') && topic.endsWith('/status')) {
    memoryStore.gateways[sn] = {
      ...(memoryStore.gateways[sn]||{}),
      gateway_sn: sn,
      status: json.data?.status || 'ONLINE',
      last_seen: new Date()
    };
    broadcastWebSocket({
      type: 'gateway_status',
      sn: sn,
      data: memoryStore.gateways[sn]
    });

    // Bóc tách thiết bị con (Máy bay Mavic 3T) từ gói tin Topo
    if (json.data && Array.isArray(json.data.sub_devices)) {
      const announced=new Set(json.data.sub_devices.map(d=>d.sn));
      for(const [aircraft,gateway]of Object.entries(gatewayOfAircraft))if(gateway===sn&&!announced.has(aircraft)){delete gatewayOfAircraft[aircraft];if(memoryStore.devices[aircraft])memoryStore.devices[aircraft].status='OFFLINE';}
      if(!announced.size)memoryStore.gateways[sn].is_cloud_control_auth=false;
      json.data.sub_devices.forEach(sub => {
        if (sub.sn) {
          const uavSn = sub.sn;
          gatewayOfAircraft[uavSn] = sn;
          const dev = memoryStore.devices[uavSn] || {
            device_sn: uavSn,
            device_name: `DJI Mavic 3T (${uavSn})`,
            model: sub.type === 77 && sub.sub_type === 1 ? 'Mavic 3T' : 'DJI UAV',
            first_seen: new Date()
          };
          dev.type=sub.type;dev.sub_type=sub.sub_type;dev.gateway_sn=sn;
          dev.last_seen = new Date();
          dev.last_osd_at = dev.last_osd_at || dev.last_seen;
          dev.status = 'ONLINE';
          memoryStore.devices[uavSn] = dev;

          if (isDbConnected()) {
            query(
              `INSERT INTO uav_devices (device_sn, device_name, device_model, device_type, gateway_sn, status, last_seen)
               VALUES (?, ?, 'Mavic 3T', 'DRONE', ?, 'ONLINE', NOW())
               ON DUPLICATE KEY UPDATE gateway_sn = VALUES(gateway_sn), status = 'ONLINE', last_seen = NOW()`,
              [uavSn, dev.device_name, sn]
            ).catch(() => {});
          }

          console.log(`[UAV Detected] ✓ Đã phát hiện máy bay Mavic 3T thật từ Topo: SN = ${uavSn}`);
          broadcastWebSocket({
            type: 'osd',
            device_sn: uavSn,
            data: dev
          });
          broadcastWebSocket({
            type: 'device_status',
            device_sn: uavSn,
            status: 'ONLINE'
          });
        }
      });
    }

    // [QUAN TRỌNG] Phản hồi chấp nhận cấu trúc Topo để Pilot 2 bắt đầu kích hoạt luồng OSD
    if (json.method === 'update_topo') {
      const replyTopic = `sys/product/${sn}/status_reply`;
      const replyPayload = {
        tid: json.tid || ('tid_' + Date.now()),
        bid: json.bid || ('bid_' + Date.now()),
        timestamp: Date.now(),
        method: 'update_topo',
        data: {
          result: 0
        }
      };
      if (mqttClient) {
        mqttClient.publish(replyTopic, JSON.stringify(replyPayload));
        console.log(`[Topo Reply] ✓ Đã phản hồi status_reply (result: 0) tới Gateway ${sn}`);
      }
    }
  }
  // 2.1 Xử lý topic state của máy bay hoặc gateway
  else if (topic.endsWith('/state')) {
    const d = json.data || {};
    const oldState=stateTimestamps.get(sn);
    if(Number.isSafeInteger(json.timestamp)&&oldState!=null&&json.timestamp<oldState)return;
    if(Number.isSafeInteger(json.timestamp)){if(stateTimestamps.size>=1000&&!stateTimestamps.has(sn))stateTimestamps.delete(stateTimestamps.keys().next().value);stateTimestamps.set(sn,json.timestamp);}
    if(typeof d.is_cloud_control_auth==='boolean') memoryStore.gateways[sn]={...memoryStore.gateways[sn],gateway_sn:sn,is_cloud_control_auth:d.is_cloud_control_auth};
    if(Array.isArray(d.live_status)&&memoryStore.gateways[sn])memoryStore.gateways[sn].live_status=d.live_status;
    if (d.live_capacity) {
      memoryStore.gateways[sn] = { ...memoryStore.gateways[sn], gateway_sn: sn, live_capacity: d.live_capacity };
    }
    if (d.hms) monitoring.hms(sn, { ...json, data: { hms: d.hms } }, gatewayOfAircraft[sn] || sn).catch(err => console.warn('[HMS]', err.message));
    if (memoryStore.devices[sn] || d.aircraft) {
      const uavSn = sn;
      const dev = memoryStore.devices[uavSn] || {
        device_sn: uavSn,
        device_name: `DJI Mavic 3T (${uavSn})`,
        model: 'Mavic 3T',
        status: 'ONLINE',
        last_seen: new Date()
      };
      if (d.battery != null) {
        if (typeof d.battery === 'number') dev.battery = d.battery;
        else if (typeof d.battery === 'object') {
          dev.battery = d.battery.capacity_percent ?? d.battery.remain_flight_percent ?? d.battery.percent ?? (Array.isArray(d.battery) && d.battery[0]?.capacity_percent) ?? dev.battery;
        }
      }
      if (d.latitude !== undefined) dev.lat = d.latitude;
      if (d.longitude !== undefined) dev.lng = d.longitude;
      if (d.height !== undefined) dev.alt = d.height;
      dev.status = 'ONLINE';
      dev.last_seen = new Date();
      memoryStore.devices[uavSn] = dev;

      broadcastWebSocket({
        type: 'osd',
        device_sn: uavSn,
        data: dev
      });
    }
  }
  // 3. Xử lý yêu cầu đồng bộ ảnh Media Fast Upload hoặc Cấu hình Storage từ Pilot 2
  else if (topic.endsWith('/requests')) {
    const method = json.method;
    const replyTopic = `thing/product/${sn}/requests_reply`;

    if (method === 'storage_config_get') {
      console.log(`[Storage Config] Cấp cấu hình lưu trữ ảnh cho UAV/Gateway ${sn}`);
      let output=null,result=503;
      try{
        let session=await mediaIngest.activeSession(sn);
        if(!session) session=await mediaIngest.activeSession(null);
        if(session){
          output=await require('./src/services/objectStorage').grant(session);
          result=0;
        }
      }catch(e){console.warn('[Storage] Chưa cấp được STS:', e.message);}
      const replyData={tid:json.tid,bid:json.bid,timestamp:Date.now(),method,data:{result,...(output?{output}:{})}};
      if(mqttClient)mqttClient.publish(replyTopic,JSON.stringify(replyData));
    }
    else if (method === 'media_fast_upload' || method === 'fileupload') {
      console.log(`[Media Upload Request] Nhận yêu cầu upload ảnh từ UAV ${sn}`);
      const replyData = {
        tid: json.tid,
        bid: json.bid,
        timestamp: Date.now(),
        method: method,
        data: {
          result: 0,
          upload_url: `http://${HOST_IP}:${PORT}/api/media/upload`
        }
      };
      if (mqttClient) mqttClient.publish(replyTopic, JSON.stringify(replyData));
    }
  }
  // 4. Xử lý phản hồi lệnh dịch vụ (services_reply) từ Pilot 2 hoặc Mavic 3T
  else if (topic.endsWith('/services_reply')) {
    deviceCommands.reply(sn,json);
    const resCode = json.data?.result !== undefined ? json.data.result : (json.result !== undefined ? json.result : 0);
    const method = json.method || 'service_call';
    console.log(`[Services Reply] Nhận phản hồi lệnh '${method}' từ ${sn}: result = ${resCode}`);
    broadcastWebSocket({
      type: 'services_reply',
      sn: sn,
      method: method,
      result: resCode,
      data: json.data || json,
      timestamp: new Date().toLocaleTimeString()
    });
  }
  // 5. Xử lý sự kiện (events) từ Pilot 2 / Mavic 3T (như HMS, Photo status, v.v.)
  else if (topic.endsWith('/events')) {
    const event = json.data?.event || json.method || 'event';
    if(event==='cloud_control_auth_notify'){const allowed=json.data?.result!==0||['failed','canceled'].includes(json.data?.output?.status)?false:json.data?.is_cloud_control_auth;if(typeof allowed==='boolean')memoryStore.gateways[sn]={...memoryStore.gateways[sn],gateway_sn:sn,is_cloud_control_auth:allowed};}
    if(json.need_reply===1&&mqttClient?.connected)mqttClient.publish(`thing/product/${sn}/events_reply`,JSON.stringify({tid:json.tid,bid:json.bid,timestamp:Date.now(),method:json.method,data:{result:0}}),{qos:1});
    if (event === 'hms') {
      monitoring.hms(sn, json, gatewayOfAircraft[sn] || sn).catch(err => console.warn('[HMS]', err.message));
    }
    broadcastWebSocket({
      type: 'device_event',
      sn: sn,
      event: event,
      data: json.data || json,
      timestamp: new Date().toLocaleTimeString()
    });
  }
}

// WebSocket broadcast
function broadcastWebSocket(data) {
  for(const c of wss.clients){
    if(c.readyState!==1)continue;
    // Một chuỗi trên từng socket giữ thứ tự bản tin qua kiểm tra quyền async.
    c.delivery=(c.delivery||Promise.resolve()).then(async()=>{
      const user=await userForToken(c.authToken);
      if(!user){c.close(1008,'Phiên đã hết hạn');return;}
      if(await require('./src/services/socketAccess').eventAllowed(user,data) && c.readyState===1)c.send(JSON.stringify(data));
    }).catch(()=>{});
  }
}

// Ảnh mới nhận (Pilot 2 / thẻ nhớ): cập nhật danh sách trong bộ nhớ và báo dashboard
mediaUploadRouter.setOnUploadEvent(broadcastWebSocket);
mediaUploadRouter.setOnIngested((media) => {
  memoryStore.mediaFiles.unshift(media);
  broadcastWebSocket({ type: 'media_synced', data: media });
});

// ===================================================================
// REST API CHO ĐIỀU KHIỂN & QUẢN LÝ THỦ CÔNG TRÊN WEB
// ===================================================================

// 1. Danh sách phiếu đang thực hiện cho màn hình đăng nhập Pilot 2
app.get('/api/pilot/tickets', async (req, res) => {
  try {
    const all = await listActiveTickets();
    const tickets = (!req.user || require('./src/services/authorization').allScopes(req.user)) ? all : all.filter(t => (req.user.plant_ids || []).includes(t.plant_id) && req.user.unit_id != null && t.unit_id === req.user.unit_id);
    res.json({
      code: 0,
      data: tickets.map(t => ({
        ticket_id: t.ticket_id,
        ticket_code: t.ticket_code,
        ticket_name: t.ticket_name,
        inspection_type: t.inspection_type,
        status: t.status
      }))
    });
  } catch (err) {
    sendDbError(res, err);
  }
});

app.get('/api/pilot/remember',async(req,res)=>{
 try{const u=await require('./src/services/pilotRemember').user(req);res.json({code:0,data:{available:!!u,username:u?.username||null}});}catch(e){sendDbError(res,e);}
});
app.post('/api/pilot/remember/forget',async(req,res)=>{
 try{await require('./src/services/pilotRemember').forget(req,res);res.json({code:0,data:{}});}catch(e){sendDbError(res,e);}
});

// 1.0 Endpoint đăng nhập Pilot 2: kiểm tra tài khoản và phiếu trong MySQL
app.post('/api/pilot/login', loginLimit, async (req, res) => {
  const { username, password, ticketId, rc_sn: rcSn, aircraft_sn: aircraftSn } = req.body || {};
  console.log(`[Pilot 2 Login] Remote yêu cầu đăng nhập: User=${username}, TicketID=${ticketId}`);

  let auth;
  let ticket;
  try {
    auth = req.body.use_saved_login===true ? await require('./src/services/pilotRemember').authenticate(req) : await verifyLogin(username, password);
    if (!auth.ok) {
      return res.status(auth.status).json({ code: auth.status, message: auth.message });
    }
    if(auth.user.must_change_password)return res.status(428).json({code:428,message:'Đổi mật khẩu trên Web trước khi kết nối Pilot'});
    const actor=await userForToken(auth.token);
    if(!actor)return res.status(401).json({code:401,message:'Phiên không hợp lệ'});
    req.user=actor;
    if (!ticketId || String(ticketId).trim() === '') {
      return res.status(400).json({ code: 400, message: 'Vui lòng chọn phiếu kiểm tra để kết nối phiên bay.' });
    }
    try{await require('./src/services/authorization').ticket(actor,Number(ticketId));}catch(e){return res.status(403).json({code:403,message:'Không có quyền với phiếu này'});}
    ticket = await findTicketById(ticketId);
    if (!ticket) {
      return res.status(400).json({ code: 400, message: 'Vui lòng chọn phiếu kiểm tra hợp lệ.' });
    }
    if (!['PENDING', 'ASSIGNED', 'EXECUTING'].includes(ticket.status)) {
      return res.status(409).json({ code: 409, message: `Phiếu ${ticket.ticket_code} đã ${ticket.status === 'COMPLETED' ? 'hoàn thành' : 'hủy'}, chọn phiếu khác.` });
    }
  } catch (err) {
    return sendDbError(res, err);
  }

  // Ghi phiên đăng nhập: ảnh tự tải lên sau đó được gắn vào phiếu này
  let sessionId = null;
  let ticketRouteList = [];
  let liveStream = null;
  let pilotToken = null;
  let uploadNamespace = null;
  let mqttCredentials=null;
  let publishQuery=null;
  try {
    const sn = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(v) ? v : null);
    sessionId = await mediaIngest.startPilotSession({ user: auth.user, ticketId: ticket.ticket_id, rcSn: sn(rcSn), aircraftSn: sn(aircraftSn) });
    const streamDevice = sn(aircraftSn) || sn(rcSn);
    if (streamDevice && ticket.ticket_id) liveStream = await monitoring.ensureStream(ticket.ticket_id, streamDevice);
    ticketRouteList = ticket.ticket_id ? await require('./src/services/ticketRoutes').routesOfTicket(ticket.ticket_id) : [];
    uploadNamespace = (await query('SELECT upload_namespace FROM pilot_sessions WHERE session_id=?',[sessionId]))[0].upload_namespace;
    pilotToken=await issuePilotToken(auth.user,sessionId,systemConfig.workspace_id);
    const pilotUser=await userForToken(pilotToken);
    mqttCredentials=await require('./src/services/mqttAccess').credentials(sessionId,pilotUser);
    if(liveStream&&process.env.LIVE_STREAM_ENABLED==='true')publishQuery=require('./src/services/streamAccess').mint(liveStream.streamPath,'publish',pilotUser);
  } catch (err) {
    return sendDbError(res, err);
  }

  // THÔNG BÁO TỨC THÌ LÊN DASHBOARD TRÊN MÁY TÍNH
  broadcastWebSocket({
    type: 'client_connected',
    source: 'pilot2_http_login',
    user: auth.user.username,
    ticket: ticket.ticket_code,
    workspace: systemConfig.workspace_name,
    timestamp: new Date().toLocaleTimeString()
  });

  try{if(req.body.remember===true)await require('./src/services/pilotRemember').save(req,res,auth.user);else await require('./src/services/pilotRemember').forget(req,res);}catch(e){return sendDbError(res,e);}
  const firstRoute = ticketRouteList[0] || null;
  res.json({
    code: 0,
    message: 'Login successful',
    data: {
      workspace_name: systemConfig.workspace_name,
      workspace_id: systemConfig.workspace_id,
      ticket_id: ticket.ticket_id,
      pilot_session_id: sessionId,
      remembered: req.body.remember===true,
      upload_prefix: `media/${uploadNamespace}/`,
      assigned_ticket: `${ticket.ticket_code} - ${ticket.ticket_name}`,
      user: auth.user,
      license: systemConfig.dji_license,
      token: pilotToken,
      mqtt: {
        host: process.env.MQTT_PUBLIC_URL || `tcp://${HOST_IP}:${MQTT_PORT}`,
        username: 'pilot',
        password: 'pilot_password',
        clientId: `pilot_${Date.now()}`
      },
      livestream: liveStream&&publishQuery ? { ...liveStream, rtmpUrl: `${process.env.RTMP_PUBLIC_BASE_URL || 'rtmp://'+HOST_IP+':'+(process.env.RTMP_PORT||systemConfig.rtmp_port||1935)}${liveStream.streamPath}?${publishQuery}` } : null,
      // Tuyến đầu tiên của phiếu (null nếu phiếu chưa gán tuyến): Pilot 2 thấy đủ các tuyến trong thư viện đường bay
      route: firstRoute ? {
        id: firstRoute.route_uuid,
        name: firstRoute.route_name,
        url: `http://${HOST_IP}:${PORT}/uploads/waylines/${encodeURIComponent(firstRoute.kmz_file_name)}`
      } : null,
      route_count: ticketRouteList.length
    }
  });
});

app.get('/api/pilot/connection',(req,res)=>{
 const s=req.pilotSession;if(!s)return res.status(403).json({code:403,message:'Cần token phiên Pilot'});
 const dev=memoryStore.devices[s.aircraft_sn],connection=require('./src/services/mqttAccess').connectionState(s.session_id);
 res.json({code:0,data:{rc_sn:s.rc_sn,aircraft_sn:s.aircraft_sn,ticket_id:s.ticket_id,mqtt_connected:connection.connected,mqtt_auth:connection.auth,last_osd_at:dev?.last_osd_at||null}});
});

app.post('/api/pilot/identity',async(req,res)=>{
 if(!req.pilotSession)return res.status(403).json({code:403,message:'Cần token phiên Pilot'});
 const {rc_sn,aircraft_sn}=req.body||{},valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{4,64}$/.test(v);
 if(!valid(rc_sn)||(aircraft_sn!=null&&!valid(aircraft_sn))||rc_sn===aircraft_sn)return res.status(400).json({code:400,message:'Serial thiết bị không hợp lệ'});
 const old=req.pilotSession;
 if((old.rc_sn&&old.rc_sn!==rc_sn)||(old.aircraft_sn&&aircraft_sn&&old.aircraft_sn!==aircraft_sn))return res.status(409).json({code:409,message:'Thiết bị đã gắn khác phiên này; đăng nhập lại.'});
 try{if(memoryStore.gateways[rc_sn])memoryStore.gateways[rc_sn].is_cloud_control_auth=false;await query('UPDATE pilot_sessions SET ended_at=NOW() WHERE rc_sn=? AND session_id<>? AND ended_at IS NULL',[rc_sn,old.session_id]);await query('UPDATE pilot_sessions SET rc_sn=?,aircraft_sn=COALESCE(aircraft_sn,?) WHERE session_id=?',[rc_sn,aircraft_sn||null,old.session_id]);res.json({code:0,data:{rc_sn,aircraft_sn:aircraft_sn||null}});}catch(e){sendDbError(res,e);}
});

// 1.1 Tiếp nhận log từ màn hình tay cầm RC truyền về
app.post('/api/pilot/log', (req, res) => {
  const { message, time } = req.body;
  console.log(`[RC Log] ${message}`);
  broadcastWebSocket({
    type: 'raw_mqtt',
    log: {
      topic: 'rc/dji_bridge/log',
      data: { message: message },
      time: time || new Date().toLocaleTimeString(),
      timestamp: Date.now()
    }
  });
  res.json({ code: 0 });
});

// Phiếu kiểm tra: xem src/routes/tickets.js (lưu trong MySQL, /api/tickets)

// 4. Danh sách Đường bay KMZ (thư viện trong MySQL; chi tiết: /api/flight-plans)
app.get('/api/routes', async (req, res) => {
  try {
    const rows = await query('SELECT route_id, route_uuid, route_name, route_kind, kmz_file_name, waypoint_count, altitude_m, created_at FROM flight_routes ORDER BY route_id DESC');
    res.json(rows.map(r => ({ ...r, file_name: r.kmz_file_name, file_url: `/uploads/waylines/${r.kmz_file_name}` })));
  } catch (err) {
    sendDbError(res, err);
  }
});

// 5. Nạp thủ công file đường bay KMZ (vẽ bằng DJI Pilot 2 / phần mềm khác) vào thư viện
app.post('/api/routes/upload', uploadWayline.single('kmz_file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: 'Chưa chọn file KMZ!' });
  }
  if (!/\.kmz$/i.test(req.file.originalname)) {
    fs.rm(req.file.path, { force: true }, () => {});
    return res.status(400).json({ code: 400, message: 'Chỉ nhận file .kmz' });
  }
  try {
    const name = String((req.body && req.body.route_name) || '').trim().slice(0, 150) || routeLibrary.nameFromFile(req.file.originalname);
    await routeLibrary.addKmz({ fileName: req.file.filename, routeName: name, kind: 'MANUAL', description: 'Tải lên thủ công' });
    await routeLibrary.flagUnsafeHeight(); // file tải lên dùng độ cao theo mực nước biển → gắn nhãn cảnh báo
    const route = (await query('SELECT * FROM flight_routes WHERE kmz_file_name = ?', [req.file.filename]))[0];
    console.log(`[Wayline Uploaded] Đã nạp file đường bay: ${route.route_name}`);
    res.json({ code: 0, message: 'Nạp đường bay KMZ thành công', data: route });
  } catch (err) {
    fs.rm(req.file.path, { force: true }, () => {});
    sendDbError(res, err);
  }
});

// 5.1 Sinh KMZ từ bộ vẽ tay trên dashboard (Mission planner) → lưu vào thư viện đường bay (MySQL).
//     Dùng wpmlBuilder: độ cao so với điểm cất cánh (code cũ dùng EGM96 = so với mực nước biển, sai).
app.post('/api/routes/generate-kmz', async (req, res) => {
  const b = req.body || {};
  const num = (x, lo, hi, def) => {
    const n = x === undefined || x === null || x === '' ? def : Number(x);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
  };
  const routeName = String(b.route_name || 'Tuyến vẽ tay').trim().slice(0, 150);
  const altitude = num(b.altitude, 2, 500, 30);
  const speed = num(b.speed, 0.5, 15, 3.5);
  const trigger = num(b.trigger_distance, 0, 500, 0);
  const wps = Array.isArray(b.waypoints) ? b.waypoints : [];
  const bad = wps.length < 2 || wps.length > 1000 || [altitude, speed, trigger].some(Number.isNaN) ||
    wps.some(w => !w || !(Math.abs(Number(w.lat)) <= 90) || !(Math.abs(Number(w.lng)) <= 180) ||
      (w.gimbalPitch != null && !(Number(w.gimbalPitch) >= -90 && Number(w.gimbalPitch) <= 35)));
  if (bad) {
    return res.status(400).json({ code: 400, message: 'Dữ liệu tuyến không hợp lệ: cần 2–1000 điểm, độ cao 2–500 m, tốc độ 0,5–15 m/s, gimbal −90…35°' });
  }
  try {
    const isDcl = b.route_type === 'SUBSTATION_DISCONNECTOR';
    const kmz = wpmlBuilder.buildManualKmz({
      name: routeName,
      waypoints: wps.map(w => ({ lat: Number(w.lat), lng: Number(w.lng), alt: w.alt != null ? Number(w.alt) : null, gimbalPitch: w.gimbalPitch != null ? Number(w.gimbalPitch) : null })),
      altitude, speed,
      triggerDistance: isDcl ? 0 : trigger,
      gimbalPitch: isDcl ? 0 : -90
    });
    fs.mkdirSync(routeLibrary.WAYLINE_DIR, { recursive: true });
    const safe = routeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60) || 'route';
    const fileName = `DJI_Mission_${Date.now()}_${safe}.kmz`;
    fs.writeFileSync(path.join(routeLibrary.WAYLINE_DIR, fileName), kmz.buffer);
    const route = await routeLibrary.addKmz({ fileName, routeName, kind: 'MANUAL', waypointCount: kmz.waypointCount, altitude, description: 'Vẽ tay trên dashboard' });
    if (b.ticket_id) await require('./src/services/ticketRoutes').addRoute(b.ticket_id, route.route_id);
    console.log(`[KMZ] Đã tạo tuyến vẽ tay ${fileName} (${kmz.waypointCount} điểm)`);
    res.json({
      code: 0,
      message: 'Đã tạo file KMZ và lưu vào thư viện đường bay',
      data: {
        ...route,
        file_name: fileName,
        file_url: `/uploads/waylines/${fileName}`,
        full_url: `http://${HOST_IP}:${PORT}/uploads/waylines/${encodeURIComponent(fileName)}`,
        md5: route.kmz_md5,
        waypoint_count: kmz.waypointCount
      }
    });
  } catch (err) {
    sendDbError(res, err);
  }
});

// 5.2 Bắn lệnh nạp đường bay KMZ trực tiếp vào Drone / DJI Pilot 2 qua DJI Cloud API
app.post('/api/routes/push-to-drone', (req,res) => res.status(410).json({code:410,message:'Thao tác này không thuộc luồng M3T/Pilot 2 đã hỗ trợ. Dùng hồ sơ chụp KMZ và vận hành trên Pilot 2; server chỉ nhận ảnh gốc.'}));

app.use('/api/control',require('./src/routes/deviceControl').createRouter({
 commands:deviceCommands,devices:memoryStore.devices,gateways:memoryStore.gateways,gatewayOfAircraft,
 activeSession:mediaIngest.activeSession,monitoring,streamAccess:require('./src/services/streamAccess'),getClient:()=>mqttClient,
 liveEnabled:()=>process.env.LIVE_STREAM_ENABLED==='true',liveReady:()=>!!nmsServer,revalidate:req=>userForToken(tokenOf(req)),
 rtmpBase:()=>process.env.RTMP_PUBLIC_BASE_URL||`rtmp://${HOST_IP}:${process.env.RTMP_PORT||systemConfig.rtmp_port||1935}`
}));

// 7.0 Tiếp nhận ảnh chụp tức thời (Live Stream Realtime Snapshot) từ giao diện Web
app.post('/api/media/snapshot', async (req, res) => {
  try {
    const { image_base64, mode = 'thermal', lat, lng, alt, max_temperature, ticket_id } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ code: -1, message: 'Thiếu dữ liệu hình ảnh base64' });
    }

    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const suffix = mode === 'thermal' ? '_T' : (mode === 'wide' ? '_W' : '_Z');
    const fileName = `SNAP_${Date.now()}${suffix}.JPG`;
    const uploadDir = mediaUploadRouter.MEDIA_DIR;
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const localFilePath = path.join(uploadDir, fileName);

    fs.writeFileSync(localFilePath, buffer);
    console.log(`[Snapshot Realtime] ✓ Đã lưu ảnh tức thời từ luồng Live: ${fileName}`);

    const isThermal = mode === 'thermal' || fileName.includes('_T');
    const isZoom = mode === 'zoom';
    const mediaType = isThermal ? 'THERMAL_PHOTO' : (isZoom ? 'ZOOM_PHOTO' : 'RGB_PHOTO');

    const targetSn = Object.keys(memoryStore.devices)[0] || '1581F5FJC243K00DNRRT';
    const dev = memoryStore.devices[targetSn] || {};
    const num = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    let record = null;
    try {
      const ing = await mediaIngest.ingestFile({
        localPath: localFilePath, fileName, originalName: fileName, source: 'MANUAL',
        ticketId: num(ticket_id), deviceSn: targetSn || undefined
      });
      const lens = isThermal ? 'IR' : (isZoom ? 'ZOOM' : 'WIDE');
      const fields = {
        latitude: num(lat) ?? (dev.lat ?? null),
        longitude: num(lng) ?? (dev.lng ?? null),
        relative_altitude: num(alt) ?? (dev.rel_alt ?? null),
        max_temperature: num(max_temperature) ?? (isThermal ? (dev.thermal_max ?? null) : null),
        lens, media_type: mediaType
      };
      if (isDbConnected()) {
        await query(
          'UPDATE media_files SET latitude = ?, longitude = ?, relative_altitude = ?, max_temperature = ?, lens = ?, media_type = ? WHERE media_id = ?',
          [fields.latitude, fields.longitude, fields.relative_altitude, fields.max_temperature, fields.lens, fields.media_type, ing.media.media_id]
        );
      }
      record = { ...ing.media, ...fields };
    } catch (e) {
      record = {
        file_name: fileName,
        file_url: `/uploads/media/${fileName}`,
        latitude: num(lat) ?? (dev.lat ?? null),
        longitude: num(lng) ?? (dev.lng ?? null),
        relative_altitude: num(alt) ?? (dev.rel_alt ?? null),
        max_temperature: num(max_temperature) ?? (isThermal ? (dev.thermal_max ?? null) : null),
        media_type: mediaType,
        created_at: new Date()
      };
    }

    if (!memoryStore.mediaFiles) memoryStore.mediaFiles = [];
    memoryStore.mediaFiles.unshift(record);

    broadcastWebSocket({
      type: 'media_synced',
      data: record
    });

    res.json({
      code: 0,
      message: 'Đã chụp và lưu ảnh hiện trường thành công vào kho ảnh!',
      data: record
    });
  } catch (err) {
    console.error('[Snapshot Error]', err);
    res.status(500).json({ code: 500, message: 'Lỗi lưu ảnh chụp: ' + err.message });
  }
});

// 9.1 Bắn gói tin MQTT thử nghiệm vào Broker 1883 và broadcast ra Live Console
app.post('/api/mqtt/test-publish', (req, res) => {
  if(process.env.ENABLE_MQTT_DEBUG!=='true')return res.status(410).json({code:410,message:'MQTT debug tắt'});
  const { topic, payload } = req.body;
  if (!topic) {
    return res.status(400).json({ code: 400, message: 'Vui lòng nhập Topic MQTT!' });
  }

  let dataObj = payload;
  if (typeof payload === 'string') {
    try { dataObj = JSON.parse(payload); } catch(e) { dataObj = payload; }
  }

  const logEntry = {
    topic: topic.trim(),
    data: dataObj,
    time: new Date().toLocaleTimeString(),
    timestamp: Date.now()
  };

  if (!memoryStore.rawMqttLogs) memoryStore.rawMqttLogs = [];
  memoryStore.rawMqttLogs.unshift(logEntry);
  if (memoryStore.rawMqttLogs.length > 500) memoryStore.rawMqttLogs.pop();

  if (mqttClient) {
    const payloadStr = typeof dataObj === 'object' ? JSON.stringify(dataObj) : String(dataObj);
    mqttClient.publish(topic.trim(), payloadStr);
  }

  broadcastWebSocket({
    type: 'raw_mqtt',
    log: logEntry
  });

  res.json({
    code: 0,
    message: `Đã bắn gói tin thành công lên topic [${topic.trim()}]`,
    data: logEntry
  });
});

// 10. Nhận ảnh dạng form: xem src/routes/mediaUpload.js

// 11. Lấy danh sách ảnh kiểm tra (Ưu tiên từ Database, kèm đường dẫn PC local)
app.get('/api/media', async (req, res) => {
  const ticketId = req.query.ticket_id;
  try {
    let sql = 'SELECT * FROM media_files';
    let params = [];
    if (ticketId) {
      sql += ' WHERE ticket_id = ?';
      params.push(ticketId);
    }
    sql += ' ORDER BY captured_at DESC, media_id DESC';
    const rows = await query(sql, params);
    if (rows) {
      return res.json(rows);
    }
  } catch (err) {
    console.warn('[DB Media Fetch]', err.message);
  }

  // Fallback bộ nhớ đệm
  if (ticketId) {
    res.json(memoryStore.mediaFiles.filter(m => m.ticket_id == ticketId));
  } else {
    res.json(memoryStore.mediaFiles);
  }
});

// 11.1 Xóa tất cả ảnh trong thư viện (Cả trên đĩa và Database)
app.delete('/api/media/all', async (req, res) => {
  try {
    const uploadDir = mediaUploadRouter.MEDIA_DIR;
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      files.forEach(f => {
        try { fs.unlinkSync(path.join(uploadDir, f)); } catch(e){}
      });
    }
    await query('DELETE FROM media_files').catch(e => console.warn('[DB Delete Media All]', e.message));
    memoryStore.mediaFiles = [];
    broadcastWebSocket({ type: 'media_cleared' });
    console.log('[Media] ✓ Đã xóa sạch toàn bộ ảnh trong hệ thống');
    res.json({ code: 0, message: 'Đã xóa toàn bộ ảnh trong thư viện thành công!' });
  } catch (err) {
    res.status(500).json({ code: 500, message: 'Lỗi xóa ảnh: ' + err.message });
  }
});

// 11.2 Xóa một ảnh cụ thể
app.delete('/api/media/:id', async (req, res) => {
  const mediaId = req.params.id;
  try {
    const item = memoryStore.mediaFiles.find(m => String(m.media_id) === String(mediaId));
    if (item && item.file_name) {
      const targetFile = path.join(mediaUploadRouter.MEDIA_DIR, item.file_name);
      if (fs.existsSync(targetFile)) {
        try { fs.unlinkSync(targetFile); } catch(e){}
      }
    }
    await query('DELETE FROM media_files WHERE media_id = ?', [mediaId]).catch(e => console.warn('[DB Delete Media]', e.message));
    memoryStore.mediaFiles = memoryStore.mediaFiles.filter(m => String(m.media_id) !== String(mediaId));
    broadcastWebSocket({ type: 'media_deleted', media_id: mediaId });
    console.log(`[Media] ✓ Đã xóa ảnh ID: ${mediaId}`);
    res.json({ code: 0, message: 'Đã xóa ảnh thành công!' });
  } catch (err) {
    res.status(500).json({ code: 500, message: 'Lỗi xóa ảnh: ' + err.message });
  }
});

// 11.3 Trích xuất siêu dữ liệu nhiệt độ thật (Radiometric Metadata) từ file R-JPEG của Mavic 3T
app.get('/api/media/thermal-meta', (req, res) => {
  const fileName = req.query.file;
  const mediaId = req.query.id;
  let targetFile = null;

  if (fileName) {
    targetFile = path.join(mediaUploadRouter.MEDIA_DIR, path.basename(fileName));
  } else if (mediaId) {
    const item = memoryStore.mediaFiles.find(m => String(m.media_id) === String(mediaId));
    if (item && item.file_name) {
      targetFile = path.join(mediaUploadRouter.MEDIA_DIR, item.file_name);
    }
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    return res.status(404).json({ code: 404, message: 'Không tìm thấy file ảnh' });
  }

  const data = parseDjiThermalJpeg(targetFile);
  if (!data) {
    return res.json({
      code: 0,
      has_thermal_raw: false,
      message: 'Ảnh không chứa dữ liệu nhiệt độ hồng ngoại Radiometric APP3'
    });
  }

  res.json({
    code: 0,
    has_thermal_raw: true,
    width: data.width,
    height: data.height,
    min_temp: data.minTemp,
    max_temp: data.maxTemp,
    center_temp: data.centerTemp,
    avg_temp: data.avgTemp,
    emissivity: data.emissivity,
    distance: data.distance,
    ambient_temp: data.ambientTemp,
    reflected_temp: data.reflectedTemp
  });
});

// 11.4 Tải ma trận nhiệt độ nhị phân thô (640x512 Int16: Temp * 10)
app.get('/api/media/thermal-matrix', (req, res) => {
  const fileName = req.query.file;
  const mediaId = req.query.id;
  let targetFile = null;

  if (fileName) {
    targetFile = path.join(mediaUploadRouter.MEDIA_DIR, path.basename(fileName));
  } else if (mediaId) {
    const item = memoryStore.mediaFiles.find(m => String(m.media_id) === String(mediaId));
    if (item && item.file_name) {
      targetFile = path.join(mediaUploadRouter.MEDIA_DIR, item.file_name);
    }
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    return res.status(404).send('Không tìm thấy file');
  }

  const data = parseDjiThermalJpeg(targetFile);
  if (!data || !data.tempMatrixBuffer) {
    return res.status(400).send('Không có ma trận nhiệt');
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Thermal-Width', data.width);
  res.setHeader('X-Thermal-Height', data.height);
  res.setHeader('X-Thermal-Min', data.minTemp);
  res.setHeader('X-Thermal-Max', data.maxTemp);
  res.setHeader('X-Thermal-Center', data.centerTemp);
  res.send(data.tempMatrixBuffer);
});

// 11.5 Tra cứu nhiệt độ chính xác tại điểm (x, y) trên ảnh
app.get('/api/media/thermal-point', (req, res) => {
  const fileName = req.query.file;
  const x = parseFloat(req.query.x) || 0;
  const y = parseFloat(req.query.y) || 0;

  if (!fileName) {
    return res.status(400).json({ code: 400, message: 'Thiếu tên file' });
  }

  const targetFile = path.join(mediaUploadRouter.MEDIA_DIR, path.basename(fileName));
  const pt = getPixelTemperature(targetFile, x, y);
  if (!pt) {
    return res.status(404).json({ code: 404, message: 'Không thể đọc nhiệt độ tại điểm này' });
  }

  res.json({
    code: 0,
    ...pt
  });
});

// 12. Danh sách thiết bị và CRUD thiết bị bay UAV
app.get('/api/devices', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM uav_devices ORDER BY device_sn ASC');
    const result = (rows || []).map(d => {
      const seen=memoryStore.devices[d.device_sn]||memoryStore.gateways[d.device_sn];
      const isOnline=seen?.status!=='OFFLINE'&&seen?.last_seen&&Date.now()-new Date(seen.last_seen).getTime()<30000;
      return {
        ...d,
        status: isOnline ? 'ONLINE' : 'OFFLINE'
      };
    });
    res.json({ code: 0, data: result });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

app.post('/api/devices', async (req, res) => {
  try {
    const { device_sn, device_name, device_model = 'Mavic 3T', device_type = 'DRONE' } = req.body;
    if (!device_sn || !device_name) {
      return res.status(400).json({ code: 400, message: 'Vui lòng nhập Mã SN và Tên thiết bị' });
    }
    await query(
      `INSERT INTO uav_devices (device_sn, device_name, device_model, device_type, status, last_battery)
       VALUES (?, ?, ?, ?, 'OFFLINE', 100)
       ON DUPLICATE KEY UPDATE device_name = VALUES(device_name), device_model = VALUES(device_model), device_type = VALUES(device_type)`,
      [device_sn, device_name, device_model, device_type]
    );
    res.json({ code: 0, message: 'Đã thêm thiết bị thành công' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

app.put('/api/devices/:sn', async (req, res) => {
  try {
    const sn = req.params.sn;
    const { device_name, device_model, device_type } = req.body;
    await query(
      `UPDATE uav_devices SET device_name = ?, device_model = ?, device_type = ? WHERE device_sn = ?`,
      [device_name, device_model, device_type, sn]
    );
    res.json({ code: 0, message: 'Cập nhật thiết bị thành công' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

app.delete('/api/devices/:sn', async (req, res) => {
  try {
    const sn = req.params.sn;
    await query(`DELETE FROM uav_devices WHERE device_sn = ?`, [sn]);
    res.json({ code: 0, message: 'Đã xóa thiết bị thành công' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 14. API Cài Đặt Hệ Thống (Settings)
app.get('/api/settings', (req, res) => {
  res.json({ code: 0, data: systemConfig });
});

app.post('/api/settings', (req, res) => {
  const newConfig = req.body;
  systemConfig = { ...systemConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(systemConfig, null, 2), 'utf-8');
    console.log('[Settings] Đã cập nhật cấu hình hệ thống thành công');
    broadcastWebSocket({
      type: 'settings_updated',
      data: systemConfig
    });
    res.json({ code: 0, message: 'Lưu cấu hình hệ thống thành công!', data: systemConfig });
  } catch (err) {
    console.error('[Settings] Lỗi ghi config.json:', err.message);
    res.status(500).json({ code: -1, message: 'Lỗi ghi cấu hình: ' + err.message });
  }
});

// 14.1 Cập nhật nhanh tọa độ Văn Phòng / Tòa Nhà
app.post('/api/settings/office-location', (req, res) => {
  const { lat, lng, name, zoom } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ code: -1, message: 'Thiếu tọa độ lat/lng' });
  }
  systemConfig.office_location = {
    name: name || (systemConfig.office_location && systemConfig.office_location.name) || 'Nhà Điều Hành / Văn Phòng Dự Án',
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    zoom: zoom ? parseInt(zoom) : 19
  };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(systemConfig, null, 2), 'utf-8');
    console.log(`[Office Location] Đã lưu tọa độ văn phòng mới: [${lat}, ${lng}]`);
    broadcastWebSocket({
      type: 'settings_updated',
      data: systemConfig
    });
    res.json({ code: 0, message: 'Đã lưu vị trí văn phòng thành công!', data: systemConfig.office_location });
  } catch (err) {
    res.status(500).json({ code: -1, message: 'Lỗi ghi cấu hình: ' + err.message });
  }
});


// C. Thư viện đường bay cho DJI Pilot 2: xem src/routes/pilotWaylines.js (MySQL, theo phiếu đang bay)
app.use(require('./src/routes/pilotWaylines'));

// ===================================================================
// D. DJI CLOUD API - MEDIA SERVICE (HỨNG ẢNH THẬT 100% TỪ MAVIC 3T)
// ===================================================================

// D1–D2 (fast-upload, tiny-fingerprints): xem src/routes/mediaUpload.js

// D3. Cấp STS Token upload (Chuẩn MinIO/S3 cho DJI Pilot 2)
app.all(['/storage/api/v1/workspaces/:workspace_id/sts','/media/api/v1/workspaces/:workspace_id/storage-configs'],async(req,res)=>{
 if(!['GET','POST'].includes(req.method))return res.sendStatus(405);
 if(!req.pilotSession)return res.status(403).json({code:403,message:'Cần phiên Pilot hợp lệ để cấp storage'});
 try{return res.json({code:0,message:'success',data:await require('./src/services/objectStorage').grant(req.pilotSession)});}catch(e){return res.status(503).json({code:503,message:'Chưa sẵn sàng S3/MinIO STS. Cấu hình storage hoặc nhập ảnh gốc trên Web.'});}
});

// D3.1, D4, D5 (PUT S3, upload form, upload-callback): xem src/routes/mediaUpload.js

// D6. Danh sách ảnh cho Pilot 2 Media Library
app.get(['/media/api/v1/workspaces/:workspace_id/files', '/manage/api/v1/workspaces/:workspace_id/files'], (req, res) => {
  const list = memoryStore.mediaFiles.filter(m=>req.pilotSession?m.ticket_id===req.pilotSession.ticket_id:require('./src/services/authorization').allScopes(req.user)).map(m => ({
    id: String(m.media_id),
    name: m.file_name,
    file_url: `http://${HOST_IP}:${PORT}${m.file_url}`,
    create_time: new Date(m.captured_at || Date.now()).getTime()
  }));

  res.json({
    code: 0,
    message: 'success',
    data: {
      pagination: { page: 1, total: list.length, total_page: 1 },
      list: list
    }
  });
});

// Chuyển hướng root về Dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// ===================================================================
// THEO DÕI KẾT NỐI CSDL: nâng cấp schema & nạp ảnh khi kết nối lần đầu
// ===================================================================
let dbInitDone = false;
let visionStop = null;
let dbInitRunning = false;
const MIGRATION_RETRY_MS = 30000;

/** Nâng cấp schema rồi nạp thư viện ảnh. Lỗi thì tự thử lại sau 30 giây. */
async function initDatabase() {
  if (dbInitDone || dbInitRunning || !isDbConnected()) return;
  dbInitRunning = true;
  try {
    await runMigrations(dbConfig);
    if (!visionStop && process.env.VISION_ENABLED === 'true') {
      const endpoint = process.env.VISION_ENDPOINT, publicBase = process.env.VISION_PUBLIC_BASE_URL, secret = process.env.VISION_WEBHOOK_SECRET;
      if (!endpoint || !publicBase || !secret) console.warn('[Vision] Chưa đủ VISION_ENDPOINT, VISION_PUBLIC_BASE_URL, VISION_WEBHOOK_SECRET; worker tắt.');
      else {
        const allowedUrl = value => { try { const u = new URL(value); return !u.username && !u.password && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname))); } catch(e) { return false; } };
        if (!allowedUrl(endpoint) || !allowedUrl(publicBase)) console.warn('[Vision] Dùng HTTPS hoặc loopback cho endpoint và public base.');
        else visionStop = require('./src/services/visionJobs').startWorker({ endpoint, publicBase, secret, apiToken: process.env.VISION_API_TOKEN });
      }
    }

    const dangling = await flightTracker.closeDangling();
    if (dangling) console.log(`[Chuyến bay] Đóng ${dangling} chuyến còn mở từ lần chạy trước.`);
    // Vừa khởi động: chưa nhận OSD nào nên mọi máy đều OFFLINE (tránh kẹt ONLINE ảo từ lần chạy trước)
    await query("UPDATE uav_devices SET status = 'OFFLINE' WHERE status <> 'OFFLINE'");
    // Làm sạch ảnh nhận bằng code cũ (giá trị gán cứng) – chỉ chạm các dòng chưa có sha256
    const imported = await routeLibrary.importDiskKmz();
    if (imported) console.log(`[Đường bay] Đã đưa ${imported} file KMZ cũ trong uploads/waylines vào thư viện.`);
    const unsafe = await routeLibrary.flagUnsafeHeight();
    if (unsafe) console.warn(`[Đường bay] ⚠ ${unsafe} tuyến có độ cao theo mực nước biển – đã gắn nhãn, cần tạo lại trước khi bay.`);
    const legacy = await mediaIngest.backfillLegacy();
    if (legacy.fixed || legacy.missing) {
      console.log(`[Ảnh] Làm sạch dữ liệu cũ: đọc lại ${legacy.fixed} ảnh từ file, xóa giá trị giả của ${legacy.missing} ảnh mất file.`);
    }
    await initMediaLibraryFromDbAndDisk();
    dbInitDone = true;
  } catch (err) {
    console.error(`[Migration] ✗ Lỗi nâng cấp CSDL, thử lại sau ${MIGRATION_RETRY_MS / 1000}s:`, err.message);
    setTimeout(initDatabase, MIGRATION_RETRY_MS).unref();
  } finally {
    dbInitRunning = false;
  }
}

onDbStatusChange((status) => {
  broadcastWebSocket({ type: 'db_status', data: status });
  if (status.connected) initDatabase();
});

// ===================================================================
// KHỞI ĐỘNG SERVER
// ===================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================================================');
  console.log(`  DJI CLOUD API ALL-IN-ONE SERVER ĐÃ KHỞI CHẠY TRÊN WI-FI!`);
  console.log('=================================================================');
  console.log(`  - Dashboard Giám Sát : http://${HOST_IP}:${PORT}/dashboard`);
  console.log(`  - DJI Pilot 2 Login   : http://${HOST_IP}:${PORT}/pilot-login`);
  console.log(`  - MQTT Broker TCP     : tcp://${HOST_IP}:${MQTT_PORT}`);
  console.log(`  - WebSocket Live OSD  : ws://${HOST_IP}:${PORT}/ws`);
  console.log('=================================================================');

  setupMqtt();
  setupRtmpServer();
  testConnection().catch(err => console.warn('[DB Init]', err.message));
  // startMapHealthCheck(broadcastWebSocket); // Không thăm dò OSM internet khi chạy hệ thống bản đồ thật nội bộ
});
