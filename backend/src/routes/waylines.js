/**
 * Router quản lý đường bay KMZ và nạp tự động xuống Mavic 3T (Giai đoạn 2 & 3)
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/db');
const { buildManualKmz } = require('../services/wpmlBuilder');

const WAYLINE_DIR = path.join(__dirname, '..', '..', 'uploads', 'waylines');
if (!fs.existsSync(WAYLINE_DIR)) {
  fs.mkdirSync(WAYLINE_DIR, { recursive: true });
}

function createRouter({ getMqttClient }) {
  const router = express.Router();

  // 1. Lấy danh sách đường bay trong thư viện
  router.get('/', async (req, res) => {
    try {
      const rows = await query('SELECT * FROM flight_routes ORDER BY route_id DESC LIMIT 100');
      res.json({ code: 0, data: rows });
    } catch (err) {
      res.status(500).json({ code: 500, message: err.message });
    }
  });

  // 2. Tạo và đóng gói file KMZ chuẩn Mavic 3T
  router.post('/generate-kmz', async (req, res) => {
    try {
      const {
        route_name = 'Tuyen_Bay_Mavic_3T',
        route_type = 'SOLAR_FARM_MAPPING',
        altitude = 30,
        speed = 3.5,
        trigger_distance = 0,
        gimbal_pitch = -90,
        lenses = 'ir,wide',
        waypoints = [],
        ticket_id = null
      } = req.body;

      if (!waypoints || waypoints.length < 2) {
        return res.status(400).json({ code: 400, message: 'Đường bay bắt buộc phải có ít nhất 2 điểm Waypoint' });
      }

      const routeUuid = crypto.randomUUID();
      const fileName = `${route_name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.kmz`;
      const filePath = path.join(WAYLINE_DIR, fileName);

      // Chuẩn hóa danh sách waypoints cho wpmlBuilder
      const wps = waypoints.map((p, idx) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        alt: p.alt != null ? Number(p.alt) : Number(altitude),
        speed: p.speed != null ? Number(p.speed) : Number(speed),
        gimbalPitch: p.gimbalPitch != null ? Number(p.gimbalPitch) : Number(gimbal_pitch),
        hoverTime: p.hoverTime != null ? Number(p.hoverTime) : 1
      }));

      // Đóng gói WPML / KMZ
      const packResult = buildManualKmz({
        name: route_name,
        waypoints: wps,
        altitude: Number(altitude),
        speed: Number(speed),
        lenses: lenses,
        triggerDistance: Number(trigger_distance) || 0,
        gimbalPitch: Number(gimbal_pitch)
      });

      // Ghi file KMZ ra đĩa
      fs.writeFileSync(filePath, packResult.buffer);

      // Tính mã băm MD5 fingerprint (chữ thường)
      const fingerprint = crypto.createHash('md5').update(packResult.buffer).digest('hex').toLowerCase();

      // Tính khoảng cách sơ bộ và thời gian bay
      let totalDist = 0;
      for (let i = 0; i < wps.length - 1; i++) {
        const dLat = (wps[i+1].lat - wps[i].lat) * 111320;
        const dLng = (wps[i+1].lng - wps[i].lng) * 111320 * Math.cos(wps[i].lat * Math.PI / 180);
        totalDist += Math.sqrt(dLat * dLat + dLng * dLng);
      }
      const durationSeconds = Math.round(totalDist / (Number(speed) || 3.5));
      const photoCount = Number(trigger_distance) > 0 ? Math.ceil(totalDist / Number(trigger_distance)) : wps.length;

      // Lưu vào database bảng flight_routes
      const planJson = JSON.stringify({
        waypoints: wps,
        distance_m: Math.round(totalDist),
        duration_s: durationSeconds,
        photo_count: photoCount
      });

      let validRouteType = 'SOLAR_FARM_MAPPING';
      if (['SOLAR_FARM_MAPPING', 'SUBSTATION_DISCONNECTOR', 'TRANSMISSION_LINE', 'CUSTOM'].includes(route_type)) {
        validRouteType = route_type;
      }

      const insertResult = await query(
        `INSERT INTO flight_routes (
          route_name, route_type, kmz_file_name, kmz_file_path, waypoint_count,
          route_uuid, kmz_md5, altitude_m, photo_count, duration_s, plan_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          route_name, validRouteType, fileName, filePath, wps.length,
          routeUuid, fingerprint, altitude, photoCount, durationSeconds, planJson
        ]
      );

      const routeId = insertResult.insertId;

      // Nếu có ticket_id gán kèm: cập nhật vào phiếu kiểm tra
      if (ticket_id) {
        await query('UPDATE inspection_tickets SET assigned_route_id = ? WHERE ticket_id = ?', [routeId, ticket_id]);
      }

      const fileUrl = `/uploads/waylines/${fileName}`;

      res.json({
        code: 0,
        message: 'Đã tạo và đóng gói KMZ thành công',
        data: {
          route_id: routeId,
          route_uuid: routeUuid,
          file_name: fileName,
          file_url: fileUrl,
          fingerprint: fingerprint,
          waypoint_count: wps.length,
          distance_m: Math.round(totalDist),
          duration_s: durationSeconds
        }
      });

    } catch (err) {
      console.error('[GENERATE KMZ ERROR]:', err);
      res.status(500).json({ code: 500, message: 'Lỗi đóng gói KMZ: ' + err.message });
    }
  });

  // 3. Nạp đường bay xuống tay cầm RC (flighttask_prepare)
  router.post('/push-to-drone', async (req, res) => {
    try {
      const { route_id, gateway_sn, flight_id } = req.body;
      if (!route_id || !gateway_sn) {
        return res.status(400).json({ code: 400, message: 'Thiếu route_id hoặc gateway_sn (Serial tay cầm RC)' });
      }

      const routes = await query('SELECT * FROM flight_routes WHERE route_id = ? LIMIT 1', [route_id]);
      if (!routes.length) {
        return res.status(404).json({ code: 404, message: 'Không tìm thấy đường bay' });
      }
      const route = routes[0];

      // Tạo link HTTP công khai tải file KMZ
      const host = req.get('host');
      const protocol = req.protocol;
      const kmzUrl = `${protocol}://${host}/uploads/waylines/${route.kmz_file_name}`;

      const client = getMqttClient ? getMqttClient() : null;
      if (!client) {
        return res.status(500).json({ code: 500, message: 'MQTT Client chưa sẵn sàng trên máy chủ' });
      }

      const tid = crypto.randomUUID();
      const bid = crypto.randomUUID();
      const taskId = flight_id || `TASK_${Date.now()}`;

      const payload = {
        tid: tid,
        bid: bid,
        timestamp: Date.now(),
        method: 'flighttask_prepare',
        data: {
          flight_id: taskId,
          execute_time: Date.now(),
          task_type: 0,
          wayline_type: 0,
          file: {
            url: kmzUrl,
            fingerprint: route.kmz_md5
          },
          rth_altitude: 60,
          out_of_control_action: 0
        }
      };

      const topic = `thing/product/${gateway_sn}/services`;
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          return res.status(500).json({ code: 500, message: 'Lỗi gửi MQTT: ' + err.message });
        }
        console.log(`[WAYLINE] Đã gửi lệnh flighttask_prepare xuống tay cầm ${gateway_sn} (Task: ${taskId})`);
        res.json({
          code: 0,
          message: `Đã nạp đường bay ${route.route_name} xuống tay cầm ${gateway_sn}`,
          data: {
            task_id: taskId,
            fingerprint: route.kmz_md5,
            kmz_url: kmzUrl
          }
        });
      });

    } catch (err) {
      console.error('[PUSH KMZ ERROR]:', err);
      res.status(500).json({ code: 500, message: 'Lỗi nạp đường bay: ' + err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
