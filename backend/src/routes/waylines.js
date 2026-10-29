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
  // Single validated planner pipeline. Do not issue Dock flighttask commands to Pilot 2.
  router.post('/generate-kmz',(req,res,next)=>{
    const b=req.body||{};
    req.body={...b,points:(b.waypoints||[]).map(p=>({lat:p.lat,lng:p.lng,altitude_m:p.alt??b.altitude??30,speed_mps:p.speed??b.speed??3,gimbal_pitch:p.gimbalPitch??b.gimbal_pitch??-90,hover_seconds:p.hoverTime??1,lenses:p.lenses||b.lenses||'wide,ir'}))};
    req.url='/';return require('./flightPlans').handle(req,res,next);
  });
  router.post('/push-to-drone',(req,res)=>res.status(422).json({code:422,message:'Mavic 3T / Pilot 2 dùng thư viện đường bay mission. Tải và thực hiện tuyến trên Pilot; không gửi flighttask_prepare dành cho Dock.'}));

  return router;
}

module.exports = { createRouter };
